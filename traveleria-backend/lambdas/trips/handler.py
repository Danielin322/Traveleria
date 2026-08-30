import uuid

from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import (
    AppError,
    parse_body,
    parse_trip_dates,
    parse_uuid,
    serialize_trip,
)


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


def _get_trips(current_user):
    with get_db() as db:
        # events_count lets the delete confirmation name what is about to go
        # with the trip, rather than saying "and its events" vaguely.
        db.execute(
            """
            SELECT t.id, t.title, t.location, t.start_date, t.end_date,
                   (SELECT COUNT(*) FROM day_places dp
                    JOIN trip_days td ON td.id = dp.trip_day_id
                    WHERE td.trip_id = t.id) AS events_count
            FROM trips t WHERE t.owner_user_id = %s ORDER BY t.created_at DESC
            """,
            (current_user["id"],),
        )
        return success([
            {**serialize_trip(row), "events_count": row["events_count"]}
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
    trip_uuid = parse_uuid((event.get("pathParameters") or {}).get("trip_id", ""), "trip_id")
    body = parse_body(event)
    start_date, end_date = parse_trip_dates(body.get("date", ""))
    with get_db() as db:
        # The owner check is part of the UPDATE itself: a trip that is missing
        # and a trip belonging to someone else look identical from here, and
        # both are answered with 404.
        db.execute(
            """
            UPDATE trips SET title=%s, location=%s, start_date=%s, end_date=%s, updated_at=NOW()
            WHERE id=%s AND owner_user_id=%s
            RETURNING id, title, location, start_date, end_date
            """,
            (body["title"], body["location"], start_date, end_date, trip_uuid, current_user["id"]),
        )
        row = db.fetchone()
        if not row:
            raise AppError("Trip not found", status=404)

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
    trip_uuid = parse_uuid((event.get("pathParameters") or {}).get("trip_id", ""), "trip_id")
    with get_db() as db:
        db.execute(
            "SELECT id FROM trips WHERE id = %s AND owner_user_id = %s",
            (trip_uuid, current_user["id"]),
        )
        if not db.fetchone():
            raise AppError("Trip not found", status=404)

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

        # Cascades trip_days, then day_places.
        db.execute("DELETE FROM trips WHERE id = %s", (trip_uuid,))

        if place_ids:
            # NOT EXISTS keeps a place that some other trip still points at.
            # Nothing shares places today, but this stops that becoming a
            # data-loss bug the day place reuse is introduced.
            db.execute(
                """
                DELETE FROM places WHERE id = ANY(%s)
                AND NOT EXISTS (SELECT 1 FROM day_places WHERE place_id = places.id)
                """,
                (place_ids,),
            )
    return success({"message": "Trip deleted successfully"})
