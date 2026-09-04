import json
import uuid
from datetime import date, datetime


class AppError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def parse_body(event: dict) -> dict:
    body = event.get("body") or "{}"
    return json.loads(body) if isinstance(body, str) else body


def parse_uuid(value: str, field_name: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, TypeError):
        raise AppError(f"{field_name} must be a valid UUID")


def parse_trip_dates(date_range: str) -> tuple[date, date]:
    parts = [p.strip() for p in date_range.split(" - ", 1)]
    if len(parts) != 2:
        raise AppError("Trip date must use the format DD.MM.YYYY - DD.MM.YYYY")
    try:
        start = datetime.strptime(parts[0], "%d.%m.%Y").date()
        end = datetime.strptime(parts[1], "%d.%m.%Y").date()
    except ValueError:
        raise AppError("Trip date must use the format DD.MM.YYYY - DD.MM.YYYY")
    if end < start:
        raise AppError("Trip end date must be after the start date")
    return start, end


def parse_event_date(value: str) -> date:
    """One day, in the same DD.MM.YYYY format the trip date range uses."""
    try:
        return datetime.strptime(value.strip(), "%d.%m.%Y").date()
    except (ValueError, TypeError, AttributeError):
        raise AppError("Event date must use the format DD.MM.YYYY")


def format_event_date(value: date) -> str:
    return value.strftime("%d.%m.%Y")


def format_trip_date(start: date, end: date) -> str:
    return f"{start.strftime('%d.%m.%Y')} - {end.strftime('%d.%m.%Y')}"


def serialize_trip(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "location": row["location"],
        "date": format_trip_date(row["start_date"], row["end_date"]),
    }


# ---------------------------------------------------------------------------
# Access
#
# A trip is reachable by its owner and by anyone holding an ACCEPTED invitation
# to it. `tc.status = 'active'` below is the whole permission model: a pending
# or declined invitation is invisible to every trip, itinerary and chat query.
#
# Everything goes through these two functions rather than appending
# `AND owner_user_id = %s` to individual queries, so there is one definition of
# who may touch a trip and one place to change it.
# ---------------------------------------------------------------------------

TRIP_ACCESS_PREDICATE = """
    (trips.owner_user_id = %(user_id)s
     OR EXISTS (SELECT 1 FROM trip_collaborators tc
                WHERE tc.trip_id = trips.id
                  AND tc.user_id = %(user_id)s
                  AND tc.status = 'active'))
"""


def get_trip_access(db, trip_id: uuid.UUID, user_id: uuid.UUID) -> str | None:
    """The caller's relationship to a trip: "owner", "editor", or None."""
    db.execute(
        f"""
        SELECT CASE WHEN trips.owner_user_id = %(user_id)s THEN 'owner'
                    ELSE 'editor' END AS role
        FROM trips
        WHERE trips.id = %(trip_id)s AND {TRIP_ACCESS_PREDICATE}
        """,
        {"trip_id": trip_id, "user_id": user_id},
    )
    row = db.fetchone()
    return row["role"] if row else None


def require_trip_access(
    db, trip_id: uuid.UUID, user_id: uuid.UUID, owner_only: bool = False
) -> str:
    """
    get_trip_access, raising instead of returning None.

    A trip that does not exist and a trip belonging to someone else are both
    404, which is the convention every handler already followed — a 403 there
    would confirm the trip exists.

    owner_only is the deliberate exception: the caller can demonstrably see the
    trip, so 403 leaks nothing, and "you can leave instead" is the only useful
    thing to tell them.
    """
    role = get_trip_access(db, trip_id, user_id)
    if role is None:
        raise AppError("Trip not found", status=404)
    if owner_only and role != "owner":
        raise AppError(
            "Only the trip owner can do that. You can leave the trip instead.",
            status=403,
        )
    return role


def touch_trip(db, trip_id: uuid.UUID) -> None:
    """
    Bump the trip's updated_at after a change to anything inside it.

    Without this, editing an event leaves the trip row untouched, so there is
    no single value that answers "has anything in this trip changed?" — which
    is what a co-editor's client needs in order to know it should refetch.
    """
    db.execute("UPDATE trips SET updated_at = NOW() WHERE id = %s", (trip_id,))


def get_or_create_trip_day_for_date(
    db, trip_id: uuid.UUID, user_id: uuid.UUID, day_date: date
) -> uuid.UUID:
    """
    Resolves the trip_days row for one calendar date, creating it on demand.

    The access check must stay ahead of the write: a trip that is missing and a
    trip nobody has shared with you look identical from here, and both are
    answered with 404.
    """
    require_trip_access(db, trip_id, user_id)

    db.execute("SELECT start_date, end_date FROM trips WHERE id = %s", (trip_id,))
    trip = db.fetchone()

    if not trip["start_date"] <= day_date <= trip["end_date"]:
        raise AppError(
            "Event date must fall inside the trip dates "
            f"({format_trip_date(trip['start_date'], trip['end_date'])})"
        )

    # trip_days_trip_date_unique makes this a single-statement upsert with no
    # read-then-write race — which now matters for real, because two people can
    # be adding events to the same day at the same moment. DO UPDATE rather
    # than DO NOTHING, because DO NOTHING returns no row on conflict.
    db.execute(
        """
        INSERT INTO trip_days (trip_id, day_date) VALUES (%s, %s)
        ON CONFLICT (trip_id, day_date) DO UPDATE SET updated_at = NOW()
        RETURNING id
        """,
        (trip_id, day_date),
    )
    return db.fetchone()["id"]


def resolve_trip_day(
    db, trip_id: uuid.UUID, user_id: uuid.UUID, body: dict
) -> tuple[uuid.UUID, date]:
    """
    The trip day an event belongs on, from an optional "date" in the body.
    Returns both the row id and the resolved date, so callers can echo the
    date back without knowing which branch was taken.

    Without a date we fall back to the trip's first day, which is what every
    event got before per-day scheduling existed. That keeps app builds from
    before that change working against the updated Lambda.
    """
    raw_date = body.get("date")
    if raw_date in (None, ""):
        trip_day_id = get_or_create_default_trip_day(db, trip_id, user_id)
        db.execute("SELECT day_date FROM trip_days WHERE id = %s", (trip_day_id,))
        return trip_day_id, db.fetchone()["day_date"]

    day_date = parse_event_date(raw_date)
    return (
        get_or_create_trip_day_for_date(db, trip_id, user_id, day_date),
        day_date,
    )


def get_or_create_default_trip_day(db, trip_id: uuid.UUID, user_id: uuid.UUID) -> uuid.UUID:
    require_trip_access(db, trip_id, user_id)

    db.execute(
        "SELECT id FROM trip_days WHERE trip_id = %s ORDER BY day_date LIMIT 1",
        (trip_id,),
    )
    row = db.fetchone()
    if row:
        return row["id"]

    db.execute(
        """
        INSERT INTO trip_days (trip_id, day_date)
        SELECT id, start_date FROM trips WHERE id = %s
        RETURNING id
        """,
        (trip_id,),
    )
    return db.fetchone()["id"]
