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


def get_or_create_trip_day_for_date(
    db, trip_id: uuid.UUID, owner_user_id: uuid.UUID, day_date: date
) -> uuid.UUID:
    """
    Resolves the trip_days row for one calendar date, creating it on demand.

    The SELECT doubles as the ownership check, so it must stay ahead of the
    write: a trip that is missing or belongs to someone else looks identical
    here, and both are answered with 404.
    """
    db.execute(
        "SELECT start_date, end_date FROM trips WHERE id = %s AND owner_user_id = %s",
        (trip_id, owner_user_id),
    )
    trip = db.fetchone()
    if not trip:
        raise AppError("Trip not found", status=404)

    if not trip["start_date"] <= day_date <= trip["end_date"]:
        raise AppError(
            "Event date must fall inside the trip dates "
            f"({format_trip_date(trip['start_date'], trip['end_date'])})"
        )

    # trip_days_trip_date_unique makes this a single-statement upsert with no
    # read-then-write race. DO UPDATE rather than DO NOTHING, because DO
    # NOTHING returns no row on conflict.
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
    db, trip_id: uuid.UUID, owner_user_id: uuid.UUID, body: dict
) -> tuple[uuid.UUID, date]:
    """
    The trip day an event belongs on, from an optional "date" in the body.
    Returns both the row id and the resolved date, so callers can echo the
    date back without knowing which branch was taken.

    Without a date we fall back to the trip's first day, which is what every
    event got before per-day scheduling existed. That keeps app builds from
    before this change working against the updated Lambda.
    """
    raw_date = body.get("date")
    if raw_date in (None, ""):
        trip_day_id = get_or_create_default_trip_day(db, trip_id, owner_user_id)
        db.execute("SELECT day_date FROM trip_days WHERE id = %s", (trip_day_id,))
        return trip_day_id, db.fetchone()["day_date"]

    day_date = parse_event_date(raw_date)
    return (
        get_or_create_trip_day_for_date(db, trip_id, owner_user_id, day_date),
        day_date,
    )


def get_or_create_default_trip_day(db, trip_id: uuid.UUID, owner_user_id: uuid.UUID) -> uuid.UUID:
    db.execute(
        """
        SELECT trip_days.id FROM trip_days
        JOIN trips ON trips.id = trip_days.trip_id
        WHERE trip_days.trip_id = %s AND trips.owner_user_id = %s
        ORDER BY trip_days.day_date LIMIT 1
        """,
        (trip_id, owner_user_id),
    )
    row = db.fetchone()
    if row:
        return row["id"]
    db.execute(
        """
        INSERT INTO trip_days (trip_id, day_date)
        SELECT id, start_date FROM trips
        WHERE id = %s AND owner_user_id = %s
        RETURNING id
        """,
        (trip_id, owner_user_id),
    )
    row = db.fetchone()
    if not row:
        raise AppError("Trip not found", status=404)
    return row["id"]
