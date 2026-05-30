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


def format_trip_date(start: date, end: date) -> str:
    return f"{start.strftime('%d.%m.%Y')} - {end.strftime('%d.%m.%Y')}"


def serialize_trip(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "location": row["location"],
        "date": format_trip_date(row["start_date"], row["end_date"]),
    }


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
