"""
Wallet documents, stored in S3 with one prefix per user.

Files never pass through this Lambda. It issues presigned URLs and the app
talks to S3 directly, because proxying bytes would cap an upload at roughly
6 MB once base64-encoded through API Gateway, and burn Lambda time on transfer.

Isolation is enforced here, not by the key layout. Every request resolves its
user from the validated Cognito token, and every query is scoped by user_id.
The `users/<id>/` prefix is a naming convention for humans reading the bucket;
a client never gets to choose its own key.
"""

import mimetypes
import os
import re
import uuid

import boto3
from botocore.config import Config

from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import AppError, parse_body, parse_uuid

BUCKET = os.getenv("WALLET_BUCKET", "")

# Long enough to open and read a document, short enough that a URL which
# escapes somewhere is not a standing grant. The list is refetched when the
# screen regains focus, so these refresh on their own.
VIEW_URL_TTL_SECONDS = 15 * 60

# An upload starts immediately after the URL is issued, so this only has to
# cover the transfer itself.
UPLOAD_URL_TTL_SECONDS = 5 * 60

MAX_UPLOAD_BYTES = 25 * 1024 * 1024

# Mirrors WALLET_ICONS in traveleria/constants/walletIcons.ts. Kept here rather
# than as a CHECK constraint because the set is a UI concern that will change
# as icons are added or renamed, and a constraint would make every rename a
# migration. Same reasoning as the open interests set in sql/005.
WALLET_ICONS = frozenset({
    # Travel
    "airplane", "boat", "train", "bus", "car-sport", "bicycle", "subway",
    # Stay
    "bed", "home", "business", "key",
    # Money
    "card", "cash", "pricetag", "receipt",
    # Documents
    "document-text", "id-card", "shield-checkmark", "newspaper", "qr-code",
    # Activities
    "restaurant", "ticket", "musical-notes", "camera", "map", "football",
    # Health
    "medkit", "fitness",
    # Fallbacks the client infers from mime_type for documents saved before
    # icons existed. Accepted so a client can persist what it is showing.
    "image", "document",
})

_HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")

# SigV4 is required for presigned URLs to validate in every region.
_s3 = boto3.client("s3", config=Config(signature_version="s3v4"))


def lambda_handler(event, context):
    method = event.get("httpMethod", "GET")
    resource = event.get("resource", "")
    try:
        if not BUCKET:
            raise AppError("WALLET_BUCKET is not configured", status=500)
        current_user = get_current_user(event)

        if resource == "/wallet":
            if method == "GET":
                return _list_documents(current_user)
            if method == "POST":
                return _create_document(event, current_user)
        elif resource == "/wallet/{document_id}":
            if method == "PUT":
                return _update_document(event, current_user)
            if method == "DELETE":
                return _delete_document(event, current_user)
        return error("Method not allowed", 405)
    except AppError as e:
        return error(e.message, e.status)
    except Exception as e:
        return error(str(e), 500)


def _clean_icon(body):
    """Absent means "leave unchanged", which suits the COALESCE in the UPDATE."""
    if "icon" not in body:
        return None
    icon = body.get("icon")
    if icon in (None, ""):
        return None
    if icon not in WALLET_ICONS:
        raise AppError(f"Unknown icon: {icon}")
    return icon


def _clean_color(body):
    """
    Six-digit hex only. Whatever is stored here ends up as a React Native
    backgroundColor, so it is validated rather than passed through — and
    lowercased, so #FF3B30 and #ff3b30 do not become two stored values for
    the same colour.
    """
    if "color" not in body:
        return None
    color = body.get("color")
    if color in (None, ""):
        return None
    if not isinstance(color, str) or not _HEX_COLOR.match(color):
        raise AppError(f"Colour must be a hex value like #2f6deb, got: {color}")
    return color.lower()


def _extension_for(file_name: str, mime_type: str) -> str:
    """
    Keeps a sensible extension on the S3 key so the bucket stays browsable.
    The name is never used to build the key itself — only its suffix — so a
    crafted filename cannot influence where the object lands.
    """
    if file_name and "." in file_name:
        suffix = file_name.rsplit(".", 1)[1]
        if suffix.isalnum() and len(suffix) <= 10:
            return f".{suffix.lower()}"
    return mimetypes.guess_extension(mime_type or "") or ""


def _view_url(s3_key: str) -> str:
    return _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": s3_key},
        ExpiresIn=VIEW_URL_TTL_SECONDS,
    )


def _list_documents(current_user):
    with get_db() as db:
        # Rows still 'pending' after an hour are uploads that never completed;
        # hiding them keeps a failed attempt from showing as a broken card.
        db.execute(
            """
            SELECT id, title, color, icon, mime_type, file_name, s3_key, created_at
            FROM wallet_documents
            WHERE user_id = %s
              AND (upload_status = 'ready' OR created_at > NOW() - INTERVAL '1 hour')
            ORDER BY created_at DESC
            """,
            (current_user["id"],),
        )
        rows = db.fetchall()

    return success([
        {
            "id": str(row["id"]),
            "title": row["title"],
            "color": row["color"],
            "icon": row["icon"],
            "mimeType": row["mime_type"],
            "fileName": row["file_name"],
            "url": _view_url(row["s3_key"]),
        }
        for row in rows
    ])


def _create_document(event, current_user):
    body = parse_body(event)

    title = (body.get("title") or "").strip()
    if not title:
        raise AppError("Document name is required")
    if len(title) > 80:
        raise AppError("Document name must be 80 characters or fewer")

    mime_type = body.get("mimeType") or "application/octet-stream"
    file_name = (body.get("fileName") or "").strip()
    icon = _clean_icon(body)
    color = _clean_color(body)

    size = body.get("size")
    if isinstance(size, int) and size > MAX_UPLOAD_BYTES:
        raise AppError(f"Files must be {MAX_UPLOAD_BYTES // (1024 * 1024)} MB or smaller")

    document_id = uuid.uuid4()
    s3_key = f"users/{current_user['id']}/wallet/{document_id}{_extension_for(file_name, mime_type)}"

    with get_db() as db:
        db.execute(
            """
            INSERT INTO wallet_documents
                (id, user_id, document_type, s3_key, title, color, icon, mime_type, file_name, upload_status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending')
            RETURNING id
            """,
            (document_id, current_user["id"], mime_type, s3_key, title,
             color, icon, mime_type, file_name),
        )
        db.fetchone()

    # ContentType is pinned into the signature, so the URL cannot be reused to
    # upload a different kind of file than the one that was declared.
    upload_url = _s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": s3_key, "ContentType": mime_type},
        ExpiresIn=UPLOAD_URL_TTL_SECONDS,
    )

    return success({
        "id": str(document_id),
        "uploadUrl": upload_url,
        "contentType": mime_type,
    }, status=201)


def _update_document(event, current_user):
    document_uuid = parse_uuid(
        (event.get("pathParameters") or {}).get("document_id", ""), "document_id"
    )
    body = parse_body(event)

    # Marking an upload complete and renaming a card are the same request
    # shape, so one endpoint covers both.
    confirm = bool(body.get("confirmUpload"))
    icon = _clean_icon(body)
    color = _clean_color(body)

    title = body.get("title")
    if title is not None:
        title = title.strip()
        if not title:
            raise AppError("Document name is required")
        if len(title) > 80:
            raise AppError("Document name must be 80 characters or fewer")

    with get_db() as db:
        db.execute(
            """
            UPDATE wallet_documents
            SET title = COALESCE(%s, title),
                color = COALESCE(%s, color),
                icon = COALESCE(%s, icon),
                upload_status = CASE WHEN %s THEN 'ready' ELSE upload_status END,
                updated_at = NOW()
            WHERE id = %s AND user_id = %s
            RETURNING id, title, color, icon, mime_type, file_name, s3_key
            """,
            (title, color, icon, confirm, document_uuid, current_user["id"]),
        )
        row = db.fetchone()
        if not row:
            # Missing and belonging-to-someone-else look identical from here,
            # and both are answered the same way.
            raise AppError("Document not found", status=404)

    return success({
        "id": str(row["id"]),
        "title": row["title"],
        "color": row["color"],
        "icon": row["icon"],
        "mimeType": row["mime_type"],
        "fileName": row["file_name"],
        "url": _view_url(row["s3_key"]),
    })


def _delete_document(event, current_user):
    document_uuid = parse_uuid(
        (event.get("pathParameters") or {}).get("document_id", ""), "document_id"
    )
    with get_db() as db:
        db.execute(
            "SELECT s3_key FROM wallet_documents WHERE id = %s AND user_id = %s",
            (document_uuid, current_user["id"]),
        )
        row = db.fetchone()
        if not row:
            raise AppError("Document not found", status=404)

        # Object first: a failure here leaves the row in place and the delete
        # can be retried. The other order would orphan the object silently,
        # with nothing left pointing at it.
        _s3.delete_object(Bucket=BUCKET, Key=row["s3_key"])
        db.execute("DELETE FROM wallet_documents WHERE id = %s", (document_uuid,))

    return success({"message": "Document deleted successfully"})
