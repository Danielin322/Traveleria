import mimetypes
import os

import boto3
from botocore.config import Config

from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import TRIP_ACCESS_PREDICATE, AppError, parse_body

# The profile photo lives in the same bucket as wallet documents, under the
# same per-user prefix. It was previously kept in device-local AsyncStorage,
# which is why every account signed in on one device showed the same picture.
BUCKET = os.getenv("WALLET_BUCKET", "")

AVATAR_VIEW_TTL_SECONDS = 15 * 60
AVATAR_UPLOAD_TTL_SECONDS = 5 * 60

ALLOWED_AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}

_s3 = boto3.client("s3", config=Config(signature_version="s3v4"))

# Mirrors traveleria/constants/profileOptions.ts and the CHECK constraints in
# sql/004_user_preferences.sql. Validating here as well as in the database gives
# the client a readable error instead of a raw constraint violation.
GENDER_VALUES = {"male", "female", "non_binary", "prefer_not_to_say"}

DIETARY_VALUES = {
    "vegetarian",
    "vegan",
    "pescatarian",
    "keto",
    "halal",
    "kosher",
    "gluten_free",
    "lactose_intolerant",
    "nut_allergy",
}


# Interests are an open set — the picker offers presets, but "Other" lets the
# user type anything — so there is no allow-list to check against, and no CHECK
# constraint in sql/005_user_interests.sql. These caps are what stands in for
# one: they keep a runaway client from filling the column with junk.
MAX_INTERESTS = 20
MAX_INTEREST_LENGTH = 30


def lambda_handler(event, context):
    method = event.get("httpMethod", "GET")
    try:
        current_user = get_current_user(event)
        if method == "GET":
            return _get_profile(current_user)
        if method == "PATCH":
            return _update_profile(event, current_user)
        return error("Method not allowed", 405)
    except AppError as e:
        return error(e.message, e.status)
    except Exception as e:
        return error(str(e), 500)


def _clean_gender(body):
    """
    Returns None to mean "leave unchanged", since the UPDATE below uses
    COALESCE. Clearing gender back to NULL is deliberately not supported:
    the picker offers "prefer_not_to_say" for declining, and it has no
    deselect affordance, so the client never needs to unset it.
    """
    gender = body.get("gender")
    if gender in (None, ""):
        return None
    if gender not in GENDER_VALUES:
        raise AppError(f"Invalid gender value: {gender}")
    return gender


def _clean_dietary(body):
    """
    Absent means "leave unchanged". An empty list DOES clear the selection,
    because an empty array is not NULL and so survives the COALESCE.
    """
    if "dietary" not in body:
        return None
    dietary = body.get("dietary")
    if dietary is None:
        return None
    if not isinstance(dietary, list):
        raise AppError("dietary must be a list of values")
    invalid = [d for d in dietary if d not in DIETARY_VALUES]
    if invalid:
        raise AppError(f"Invalid dietary values: {', '.join(map(str, invalid))}")
    # De-duplicate while preserving the order the user picked them in.
    return list(dict.fromkeys(dietary))


def _clean_interests(body):
    """
    Absent means "leave unchanged". An empty list DOES clear the selection,
    matching _clean_dietary — an empty array is not NULL, so it survives the
    COALESCE in the UPDATE.

    Unlike dietary, entries are not checked against a fixed set: anything the
    user types under "Other" is valid. Only shape and size are enforced.
    """
    if "interests" not in body:
        return None
    interests = body.get("interests")
    if interests is None:
        return None
    if not isinstance(interests, list):
        raise AppError("interests must be a list of values")
    if len(interests) > MAX_INTERESTS:
        raise AppError(f"Please choose {MAX_INTERESTS} interests or fewer")

    cleaned = []
    for raw in interests:
        if not isinstance(raw, str):
            raise AppError("Each interest must be text")
        value = raw.strip()
        if not value:
            continue
        if len(value) > MAX_INTEREST_LENGTH:
            raise AppError(
                f"Interests must be {MAX_INTEREST_LENGTH} characters or fewer: {value[:40]}"
            )
        # Control characters never belong in a user-typed label, and would
        # render as invisible junk in the chip.
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
            raise AppError("Interests cannot contain line breaks or control characters")
        cleaned.append(value)

    # De-duplicate case-insensitively, keeping the order and the casing the
    # user picked them in.
    seen = set()
    unique = []
    for value in cleaned:
        key = value.casefold()
        if key not in seen:
            seen.add(key)
            unique.append(value)
    return unique


def _avatar_view_url(s3_key):
    """A short-lived URL for reading the photo, or None when none is set."""
    if not s3_key or not BUCKET:
        return None
    return _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": s3_key},
        ExpiresIn=AVATAR_VIEW_TTL_SECONDS,
    )


def _avatar_upload(current_user, content_type):
    """
    Issues a presigned PUT for a new photo and returns (key, url).

    One key per user, overwritten in place: a profile has exactly one photo,
    and reusing the key means replacing it cannot leave the previous one
    orphaned in the bucket.
    """
    if content_type not in ALLOWED_AVATAR_TYPES:
        raise AppError(f"Unsupported image type: {content_type}")
    if not BUCKET:
        raise AppError("WALLET_BUCKET is not configured", status=500)

    extension = mimetypes.guess_extension(content_type) or ".jpg"
    s3_key = f"users/{current_user['id']}/avatar{extension}"
    url = _s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": s3_key, "ContentType": content_type},
        ExpiresIn=AVATAR_UPLOAD_TTL_SECONDS,
    )
    return s3_key, url


def _get_profile(current_user):
    with get_db() as db:
        # trips_count counts every trip the user can open, not only the ones
        # they own — otherwise the number under "Trips" on the profile
        # disagrees with the list on the home screen as soon as anything is
        # shared with them.
        db.execute(
            f"""
            SELECT full_name, country, language, age, interests, gender, dietary,
                   avatar_s3_key,
                   (SELECT COUNT(*) FROM trips WHERE {TRIP_ACCESS_PREDICATE})
                       AS trips_count
            FROM users WHERE id = %(user_id)s
            """,
            {"user_id": current_user["id"]},
        )
        row = db.fetchone()
    return success({
        "email": current_user["email"], "full_name": row["full_name"],
        "country": row["country"], "language": row["language"],
        "age": row["age"], "interests": row["interests"] or [],
        "gender": row["gender"], "dietary": row["dietary"] or [],
        "avatar_url": _avatar_view_url(row["avatar_s3_key"]),
        "trips_count": row["trips_count"],
    })


def _update_profile(event, current_user):
    body = parse_body(event)
    gender = _clean_gender(body)
    dietary = _clean_dietary(body)
    interests = _clean_interests(body)

    # Asking for an upload URL rides along on the normal profile save rather
    # than needing its own route.
    avatar_key, avatar_upload_url = None, None
    if body.get("avatar_content_type"):
        avatar_key, avatar_upload_url = _avatar_upload(
            current_user, body["avatar_content_type"]
        )

    with get_db() as db:
        db.execute(
            """
            UPDATE users
            SET full_name=COALESCE(%s, full_name), country=COALESCE(%s, country),
                language=COALESCE(%s, language), age=COALESCE(%s, age),
                interests=COALESCE(%s, interests), gender=COALESCE(%s, gender),
                dietary=COALESCE(%s, dietary),
                avatar_s3_key=COALESCE(%s, avatar_s3_key), updated_at=NOW()
            WHERE id=%s
            RETURNING full_name, country, language, age, interests, gender, dietary,
                      avatar_s3_key
            """,
            (body.get("full_name"), body.get("country"), body.get("language"),
             body.get("age"), interests, gender, dietary, avatar_key,
             current_user["id"]),
        )
        row = db.fetchone()
    return success({
        "full_name": row["full_name"], "country": row["country"],
        "language": row["language"], "age": row["age"],
        "interests": row["interests"] or [], "gender": row["gender"],
        "dietary": row["dietary"] or [],
        "avatar_url": _avatar_view_url(row["avatar_s3_key"]),
        # Present only when an upload was requested; the app PUTs the image
        # straight to S3 with this.
        "avatar_upload_url": avatar_upload_url,
    })
