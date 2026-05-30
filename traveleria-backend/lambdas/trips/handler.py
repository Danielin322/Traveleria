import uuid

from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import AppError, parse_body, parse_trip_dates, serialize_trip


def lambda_handler(event, context):
    method = event.get("httpMethod", "GET")
    try:
        current_user = get_current_user(event)
        if method == "GET":
            return _get_trips(current_user)
        if method == "POST":
            return _create_trip(event, current_user)
        return error("Method not allowed", 405)
    except AppError as e:
        return error(e.message, e.status)
    except Exception as e:
        return error(str(e), 500)


def _get_trips(current_user):
    with get_db() as db:
        db.execute(
            "SELECT id, title, location, start_date, end_date FROM trips WHERE owner_user_id = %s ORDER BY created_at DESC",
            (current_user["id"],),
        )
        return success([serialize_trip(row) for row in db.fetchall()])


def _create_trip(event, current_user):
    body = parse_body(event)
    start_date, end_date = parse_trip_dates(body.get("date", ""))
    with get_db() as db:
        db.execute(
            "INSERT INTO trips (owner_user_id, title, location, start_date, end_date) VALUES (%s, %s, %s, %s, %s) RETURNING id, title, location, start_date, end_date",
            (current_user["id"], body["title"], body["location"], start_date, end_date),
        )
        return success({"message": "Trip added successfully", "trip": serialize_trip(db.fetchone())}, status=201)
