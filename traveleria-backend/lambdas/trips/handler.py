"""
Trips, and who is allowed to edit them.

This function owns two things that look separate but are not: the trips
themselves, and the co-editing list attached to each one. They live together
because every collaborator route is a route *on a trip* — the same access
check, the same 404 convention, the same shared helpers — and a seventh Lambda
for six endpoints would cost a function, a role, an environment, and one more
thing to remember to redeploy.

/invitations is the one endpoint here that is not addressed by a trip id. It is
still trip data, and splitting it out would buy nothing but another deployment
target.
"""

import os
import re

import boto3
from botocore.config import Config

from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import (
    AppError,
    TRIP_ACCESS_PREDICATE,
    format_trip_date,
    parse_body,
    parse_trip_dates,
    parse_uuid,
    require_trip_access,
    serialize_trip,
)

# Avatars live in the wallet bucket, one key per user, exactly as the users
# Lambda writes them. Reading them here is best-effort: a lab where
# traveleria-trips has no WALLET_BUCKET still serves the members list, just
# without pictures, rather than failing the whole request over a decoration.
BUCKET = os.getenv("WALLET_BUCKET", "")
AVATAR_VIEW_TTL_SECONDS = 15 * 60
_s3 = boto3.client("s3", config=Config(signature_version="s3v4"))

# Matches the shape the signup screen validates against, and the one in
# traveleria/utils/validation.ts. Deliberately permissive: the authority on
# whether an address exists is whether its owner ever signs in with it.
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# Not a product limit — a guard against a client in a loop filling a trip with
# invitations. Raise it freely.
MAX_COLLABORATORS = 10


def lambda_handler(event, context):
    method = event.get("httpMethod", "GET")
    resource = event.get("resource", "")
    try:
        current_user = get_current_user(event)

        if resource == "/trips/{trip_id}":
            if method == "PUT":
                return _update_trip(event, current_user)
            if method == "DELETE":
                return _delete_trip(event, current_user)
        elif resource == "/trips/{trip_id}/collaborators":
            if method == "GET":
                return _list_collaborators(event, current_user)
            if method == "POST":
                return _add_collaborator(event, current_user)
        elif resource == "/trips/{trip_id}/collaborators/{collaborator_id}":
            if method == "DELETE":
                return _remove_collaborator(event, current_user)
        elif resource == "/trips/{trip_id}/owner":
            if method == "PUT":
                return _transfer_owner(event, current_user)
        elif resource == "/invitations":
            if method == "GET":
                return _list_invitations(current_user)
        elif resource == "/invitations/{invitation_id}":
            if method == "PUT":
                return _respond_to_invitation(event, current_user)
        else:
            if method == "GET":
                return _get_trips(current_user)
            if method == "POST":
                return _create_trip(event, current_user)
        return error("Method not allowed", 405)
    except AppError as e:
        return error(e.message, e.status)
    except Exception as e:
        return error(str(e), 500)


def _trip_id_param(event):
    return parse_uuid((event.get("pathParameters") or {}).get("trip_id", ""), "trip_id")


def _avatar_url(s3_key):
    """A short-lived URL for a profile photo, or None when there is none."""
    if not s3_key or not BUCKET:
        return None
    try:
        return _s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET, "Key": s3_key},
            ExpiresIn=AVATAR_VIEW_TTL_SECONDS,
        )
    except Exception:
        # A missing bucket or a credential problem should cost the caller a
        # picture, not the members list.
        return None


def _get_trips(current_user):
    with get_db() as db:
        # Owned and shared trips come back in one list, ordered the same way as
        # before. The client sorts them by date into Upcoming/Past; a shared
        # trip is not a separate section, it is a differently coloured card.
        #
        # events_count lets the delete confirmation name what is about to go
        # with the trip. collaborators_count and role decide the card's badge.
        db.execute(
            f"""
            SELECT trips.id, trips.title, trips.location,
                   trips.start_date, trips.end_date,
                   (trips.owner_user_id = %(user_id)s) AS is_owner,
                   owner.email AS owner_email,
                   owner.full_name AS owner_name,
                   (SELECT COUNT(*) FROM day_places dp
                    JOIN trip_days td ON td.id = dp.trip_day_id
                    WHERE td.trip_id = trips.id) AS events_count,
                   (SELECT COUNT(*) FROM trip_collaborators tc2
                    WHERE tc2.trip_id = trips.id AND tc2.status = 'active')
                       AS collaborators_count
            FROM trips
            JOIN users owner ON owner.id = trips.owner_user_id
            WHERE {TRIP_ACCESS_PREDICATE}
            ORDER BY trips.created_at DESC
            """,
            {"user_id": current_user["id"]},
        )
        return success([
            {
                **serialize_trip(row),
                "events_count": row["events_count"],
                "role": "owner" if row["is_owner"] else "editor",
                "collaborators_count": row["collaborators_count"],
                # Only meaningful on a trip you do not own; the card shows
                # "Shared by …" and prefers the name when there is one.
                "owner_email": row["owner_email"],
                "owner_name": row["owner_name"],
            }
            for row in db.fetchall()
        ])


def _create_trip(event, current_user):
    body = parse_body(event)
    start_date, end_date = parse_trip_dates(body.get("date", ""))
    with get_db() as db:
        db.execute(
            "INSERT INTO trips (owner_user_id, title, location, start_date, end_date) VALUES (%s, %s, %s, %s, %s) RETURNING id, title, location, start_date, end_date",
            (current_user["id"], body["title"], body["location"], start_date, end_date),
        )
        return success({"message": "Trip added successfully", "trip": serialize_trip(db.fetchone())}, status=201)


def _update_trip(event, current_user):
    trip_uuid = _trip_id_param(event)
    body = parse_body(event)
    start_date, end_date = parse_trip_dates(body.get("date", ""))
    with get_db() as db:
        # Editors may rename a trip and move its dates; only deleting is
        # reserved to the owner. The check is its own statement now rather than
        # a clause on the UPDATE, because "can you touch this trip" has one
        # definition and it lives in shared/utils.py.
        require_trip_access(db, trip_uuid, current_user["id"])

        db.execute(
            """
            UPDATE trips SET title=%s, location=%s, start_date=%s, end_date=%s, updated_at=NOW()
            WHERE id=%s
            RETURNING id, title, location, start_date, end_date
            """,
            (body["title"], body["location"], start_date, end_date, trip_uuid),
        )
        row = db.fetchone()

        # Narrowing the dates does not delete anything. Events left outside the
        # new range keep their trip_days row and still show in the daily plan,
        # which builds its sections from the union of trip days and event days.
        db.execute(
            """
            SELECT COUNT(*) AS n FROM day_places dp
            JOIN trip_days td ON td.id = dp.trip_day_id
            WHERE td.trip_id = %s AND (td.day_date < %s OR td.day_date > %s)
            """,
            (trip_uuid, start_date, end_date),
        )
        outside = db.fetchone()["n"]

    return success({
        "message": "Trip updated successfully",
        "trip": serialize_trip(row),
        "events_outside_range": outside,
    })


def _delete_trip(event, current_user):
    trip_uuid = _trip_id_param(event)
    with get_db() as db:
        # Owner only. A collaborator gets a 403 telling them to leave instead —
        # the one place a 403 is right, because they can demonstrably see the
        # trip already, so it confirms nothing they did not know.
        require_trip_access(db, trip_uuid, current_user["id"], owner_only=True)

        # places is ON DELETE RESTRICT from day_places and every event owns a
        # private places row, so the cascade below would strand them all.
        # Collect the ids first; they are unreachable once day_places is gone.
        db.execute(
            """
            SELECT DISTINCT dp.place_id FROM day_places dp
            JOIN trip_days td ON td.id = dp.trip_day_id
            WHERE td.trip_id = %s
            """,
            (trip_uuid,),
        )
        place_ids = [r["place_id"] for r in db.fetchall()]

        # Cascades trip_days, then day_places — and now also trip_collaborators
        # and every collaborator's chat_messages for this trip. The client's
        # confirmation copy says so.
        db.execute("DELETE FROM trips WHERE id = %s", (trip_uuid,))

        if place_ids:
            # NOT EXISTS keeps a place that some other trip still points at.
            db.execute(
                """
                DELETE FROM places WHERE id = ANY(%s)
                AND NOT EXISTS (SELECT 1 FROM day_places WHERE place_id = places.id)
                """,
                (place_ids,),
            )
    return success({"message": "Trip deleted successfully"})


# ---------------------------------------------------------------------------
# Collaborators
# ---------------------------------------------------------------------------


def _serialize_collaborator(row, current_user):
    return {
        "id": str(row["id"]),
        "email": row["email"],
        "full_name": row["full_name"],
        "avatar_url": _avatar_url(row["avatar_s3_key"]),
        "status": row["status"],
        # Computed here rather than in the app: the server already knows who is
        # asking, and the alternative is plumbing the signed-in identity
        # through the client just to compare two strings.
        "is_you": row["user_id"] is not None and row["user_id"] == current_user["id"],
    }


def _list_collaborators(event, current_user):
    trip_uuid = _trip_id_param(event)
    with get_db() as db:
        role = require_trip_access(db, trip_uuid, current_user["id"])

        db.execute(
            """
            SELECT u.id, u.email, u.full_name, u.avatar_s3_key
            FROM trips JOIN users u ON u.id = trips.owner_user_id
            WHERE trips.id = %s
            """,
            (trip_uuid,),
        )
        owner = db.fetchone()

        db.execute(
            """
            SELECT tc.id, tc.email, tc.status, tc.user_id,
                   u.full_name, u.avatar_s3_key
            FROM trip_collaborators tc
            LEFT JOIN users u ON u.id = tc.user_id
            WHERE tc.trip_id = %s
            ORDER BY tc.created_at
            """,
            (trip_uuid,),
        )
        collaborators = [_serialize_collaborator(row, current_user) for row in db.fetchall()]

    return success({
        "owner": {
            "email": owner["email"],
            "full_name": owner["full_name"],
            "avatar_url": _avatar_url(owner["avatar_s3_key"]),
            "is_you": owner["id"] == current_user["id"],
        },
        "collaborators": collaborators,
        "your_role": role,
    })


def _clean_email(body) -> str:
    email = (body.get("email") or "").strip().lower()
    if not email:
        raise AppError("An email address is required")
    if not _EMAIL.match(email):
        raise AppError("Enter a valid email address, e.g. name@example.com.")
    return email


def _add_collaborator(event, current_user):
    trip_uuid = _trip_id_param(event)
    email = _clean_email(parse_body(event))

    with get_db() as db:
        require_trip_access(db, trip_uuid, current_user["id"], owner_only=True)

        if email == (current_user["email"] or "").lower():
            raise AppError("You already have access to this trip.")

        db.execute(
            "SELECT u.email FROM trips JOIN users u ON u.id = trips.owner_user_id WHERE trips.id = %s",
            (trip_uuid,),
        )
        if db.fetchone()["email"].lower() == email:
            raise AppError("They already have access to this trip.")

        db.execute(
            """
            SELECT COUNT(*) AS n FROM trip_collaborators
            WHERE trip_id = %s AND status <> 'declined' AND email <> %s
            """,
            (trip_uuid, email),
        )
        if db.fetchone()["n"] >= MAX_COLLABORATORS:
            raise AppError(
                f"A trip can have up to {MAX_COLLABORATORS} people on it. "
                "Remove someone before adding another."
            )

        # The invitee may or may not have an account yet. Either way the row is
        # 'pending' — having an account is not consent.
        db.execute("SELECT id FROM users WHERE LOWER(email) = %s", (email,))
        existing = db.fetchone()
        invitee_id = existing["id"] if existing else None

        # Re-inviting is an upsert, not an error. A declined invitation is
        # reset to pending, which is how someone gets a second chance without a
        # second endpoint; an active or already-pending row is returned as it
        # stands, so a double tap does nothing. COALESCE on user_id keeps an
        # existing claim and fills one in if the invitee has since signed up.
        db.execute(
            """
            INSERT INTO trip_collaborators (trip_id, user_id, email, invited_by_user_id)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (trip_id, email) DO UPDATE SET
                status = CASE WHEN trip_collaborators.status = 'declined'
                              THEN 'pending' ELSE trip_collaborators.status END,
                responded_at = CASE WHEN trip_collaborators.status = 'declined'
                                    THEN NULL ELSE trip_collaborators.responded_at END,
                user_id = COALESCE(trip_collaborators.user_id, EXCLUDED.user_id)
            RETURNING id, email, status, user_id
            """,
            (trip_uuid, invitee_id, email, current_user["id"]),
        )
        row = db.fetchone()

        profile = None
        if row["user_id"]:
            db.execute(
                "SELECT full_name, avatar_s3_key FROM users WHERE id = %s",
                (row["user_id"],),
            )
            profile = db.fetchone()

    collaborator = {
        "id": str(row["id"]),
        "email": row["email"],
        "full_name": profile["full_name"] if profile else None,
        "avatar_url": _avatar_url(profile["avatar_s3_key"]) if profile else None,
        "status": row["status"],
        "is_you": False,
    }

    # Both outcomes are a success, worded differently. Nothing here tells the
    # caller whether the address belongs to a registered user, so the endpoint
    # cannot be used to find out who has an account.
    if row["status"] == "active":
        message = f"{email} already has access to this trip."
    elif invitee_id:
        message = f"{email} has been invited."
    else:
        message = f"{email} will see the invitation when they sign in with that address."

    return success({"collaborator": collaborator, "message": message}, status=201)


def _remove_collaborator(event, current_user):
    params = event.get("pathParameters") or {}
    trip_uuid = parse_uuid(params.get("trip_id", ""), "trip_id")
    collaborator_uuid = parse_uuid(params.get("collaborator_id", ""), "collaborator_id")

    with get_db() as db:
        role = require_trip_access(db, trip_uuid, current_user["id"])

        db.execute(
            "SELECT id, user_id FROM trip_collaborators WHERE id = %s AND trip_id = %s",
            (collaborator_uuid, trip_uuid),
        )
        row = db.fetchone()
        if not row:
            raise AppError("Collaborator not found", status=404)

        # The owner removes anyone; a collaborator may only remove themselves,
        # which is what "Leave trip" is underneath.
        is_self = row["user_id"] is not None and row["user_id"] == current_user["id"]
        if role != "owner" and not is_self:
            raise AppError("Only the trip owner can remove other people.", status=403)

        # Deleted outright rather than marked declined: leaving should not
        # leave a tombstone in the owner's members list. Their chat_messages
        # rows stay — unreadable while they have no access, and there again if
        # they are ever re-invited.
        db.execute("DELETE FROM trip_collaborators WHERE id = %s", (collaborator_uuid,))

    return success({"message": "Left the trip" if is_self else "Removed from trip"})


def _transfer_owner(event, current_user):
    trip_uuid = _trip_id_param(event)
    body = parse_body(event)
    collaborator_uuid = parse_uuid(body.get("collaborator_id", ""), "collaborator_id")

    with get_db() as db:
        require_trip_access(db, trip_uuid, current_user["id"], owner_only=True)

        db.execute(
            """
            SELECT tc.id, tc.user_id, tc.email, u.full_name
            FROM trip_collaborators tc JOIN users u ON u.id = tc.user_id
            WHERE tc.id = %s AND tc.trip_id = %s AND tc.status = 'active'
            """,
            (collaborator_uuid, trip_uuid),
        )
        new_owner = db.fetchone()
        if not new_owner:
            raise AppError(
                "That person is not an active member of this trip.", status=404
            )

        # Insert before delete, so the trip is never momentarily without the
        # person who is about to own it. The outgoing owner stays on as an
        # editor: silently removing someone from their own trip would be worse
        # than not offering transfer at all.
        db.execute(
            """
            INSERT INTO trip_collaborators
                (trip_id, user_id, email, status, responded_at, invited_by_user_id)
            VALUES (%s, %s, LOWER(%s), 'active', NOW(), %s)
            ON CONFLICT (trip_id, email) DO UPDATE SET
                status = 'active',
                responded_at = NOW(),
                user_id = EXCLUDED.user_id
            """,
            (trip_uuid, current_user["id"], current_user["email"], current_user["id"]),
        )
        db.execute("DELETE FROM trip_collaborators WHERE id = %s", (collaborator_uuid,))
        db.execute(
            "UPDATE trips SET owner_user_id = %s, updated_at = NOW() WHERE id = %s",
            (new_owner["user_id"], trip_uuid),
        )

    name = new_owner["full_name"] or new_owner["email"]
    return success({"message": f"{name} is now the owner of this trip."})


# ---------------------------------------------------------------------------
# Invitations
# ---------------------------------------------------------------------------


def _list_invitations(current_user):
    """
    Invitations waiting on the signed-in user.

    Matched on user_id, never on email: attaching a person to an invitation is
    the claim step in shared/auth.py, and it has already run for this request.
    """
    with get_db() as db:
        db.execute(
            """
            SELECT tc.id, tc.created_at,
                   t.title, t.location, t.start_date, t.end_date,
                   inviter.email AS inviter_email,
                   inviter.full_name AS inviter_name,
                   inviter.avatar_s3_key AS inviter_avatar
            FROM trip_collaborators tc
            JOIN trips t ON t.id = tc.trip_id
            LEFT JOIN users inviter ON inviter.id = tc.invited_by_user_id
            WHERE tc.user_id = %s AND tc.status = 'pending'
            ORDER BY tc.created_at DESC
            """,
            (current_user["id"],),
        )
        rows = db.fetchall()

    return success([
        {
            "id": str(row["id"]),
            "trip": {
                "title": row["title"],
                "location": row["location"],
                "date": format_trip_date(row["start_date"], row["end_date"]),
            },
            "invited_by": {
                "email": row["inviter_email"],
                "full_name": row["inviter_name"],
                "avatar_url": _avatar_url(row["inviter_avatar"]),
            },
            "created_at": row["created_at"].isoformat(),
        }
        for row in rows
    ])


def _respond_to_invitation(event, current_user):
    invitation_uuid = parse_uuid(
        (event.get("pathParameters") or {}).get("invitation_id", ""), "invitation_id"
    )
    action = (parse_body(event).get("action") or "").strip().lower()
    if action not in ("accept", "decline"):
        raise AppError("action must be 'accept' or 'decline'")

    status = "active" if action == "accept" else "declined"

    with get_db() as db:
        # Only the invitee may answer, and only while it is still pending.
        # Anyone else gets the same 404 a missing invitation would produce.
        db.execute(
            """
            UPDATE trip_collaborators
            SET status = %s, responded_at = NOW()
            WHERE id = %s AND user_id = %s AND status = 'pending'
            RETURNING trip_id
            """,
            (status, invitation_uuid, current_user["id"]),
        )
        row = db.fetchone()
        if not row:
            raise AppError("Invitation not found", status=404)

        if action == "decline":
            return success({"message": "Invitation declined"})

        # Accepting returns the trip in the same shape GET /trips uses, so the
        # home list can absorb it without a second round trip.
        db.execute(
            """
            SELECT trips.id, trips.title, trips.location,
                   trips.start_date, trips.end_date,
                   owner.email AS owner_email, owner.full_name AS owner_name,
                   (SELECT COUNT(*) FROM day_places dp
                    JOIN trip_days td ON td.id = dp.trip_day_id
                    WHERE td.trip_id = trips.id) AS events_count,
                   (SELECT COUNT(*) FROM trip_collaborators tc2
                    WHERE tc2.trip_id = trips.id AND tc2.status = 'active')
                       AS collaborators_count
            FROM trips JOIN users owner ON owner.id = trips.owner_user_id
            WHERE trips.id = %s
            """,
            (row["trip_id"],),
        )
        trip = db.fetchone()

    return success({
        "message": "You can now edit this trip",
        "trip": {
            **serialize_trip(trip),
            "events_count": trip["events_count"],
            "role": "editor",
            "collaborators_count": trip["collaborators_count"],
            "owner_email": trip["owner_email"],
            "owner_name": trip["owner_name"],
        },
    })
