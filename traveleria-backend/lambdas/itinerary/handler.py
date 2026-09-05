import uuid

from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import (
    AppError,
    format_event_date,
    parse_body,
    parse_uuid,
    require_trip_access,
    resolve_trip_day,
    touch_trip,
)


def lambda_handler(event, context):
    method = event.get("httpMethod", "GET")
    resource = event.get("resource", "")
    try:
        current_user = get_current_user(event)
        if resource == "/trips/{trip_id}/itinerary":
            if method == "GET":
                return _get_itinerary(event, current_user)
            if method == "POST":
                return _create_item(event, current_user)
        elif resource == "/trips/{trip_id}/itinerary/{event_id}":
            if method == "PUT":
                return _update_item(event, current_user)
            if method == "DELETE":
                return _delete_item(event, current_user)
        return error("Method not allowed", 405)
    except AppError as e:
        return error(e.message, e.status)
    except Exception as e:
        return error(str(e), 500)


def _get_itinerary(event, current_user):
    trip_uuid = parse_uuid((event.get("pathParameters") or {}).get("trip_id", ""), "trip_id")
    with get_db() as db:
        # Access is its own statement rather than a clause on the query, so
        # "not yours" and "does not exist" stay indistinguishable (both 404)
        # while the definition of "yours" lives in one place.
        require_trip_access(db, trip_uuid, current_user["id"])
        db.execute(
            """
            SELECT dp.id, dp.visit_time AS time, dp.notes, td.day_date,
                   p.name AS place, COALESCE(p.address, '') AS address, p.lat, p.lng,
                   dp.created_by_user_id,
                   author.full_name AS author_name, author.email AS author_email
            FROM day_places dp
            JOIN trip_days td ON td.id = dp.trip_day_id
            JOIN places p ON p.id = dp.place_id
            LEFT JOIN users author ON author.id = dp.created_by_user_id
            WHERE td.trip_id = %s
            ORDER BY td.day_date, dp.visit_time, p.name
            """,
            (trip_uuid,),
        )
        return success([
            {"id": str(row["id"]), "date": format_event_date(row["day_date"]),
             "time": row["time"], "place": row["place"],
             "address": row["address"], "lat": row["lat"], "lng": row["lng"],
             "notes": row["notes"],
             # Null on events that predate authorship, which the client renders
             # as no attribution at all rather than as "unknown".
             "added_by": _author_label(row),
             "added_by_you": row["created_by_user_id"] == current_user["id"]}
            for row in db.fetchall()
        ])


def _author_label(row):
    if not row["created_by_user_id"]:
        return None
    return row["author_name"] or row["author_email"]


def _create_item(event, current_user):
    trip_uuid = parse_uuid((event.get("pathParameters") or {}).get("trip_id", ""), "trip_id")
    body = parse_body(event)
    with get_db() as db:
        trip_day_id, day_date = resolve_trip_day(db, trip_uuid, current_user["id"], body)
        db.execute(
            "INSERT INTO places (name, address, google_place_id, lat, lng) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (body["place"], body.get("address", ""), f"manual:{uuid.uuid4()}", body.get("lat"), body.get("lng")),
        )
        place_id = db.fetchone()["id"]
        db.execute(
            "INSERT INTO day_places (trip_day_id, place_id, visit_time, notes, created_by_user_id) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id, visit_time AS time",
            (trip_day_id, place_id, body["time"], body.get("notes"), current_user["id"]),
        )
        row = db.fetchone()
        touch_trip(db, trip_uuid)
    return success({"message": "Event added successfully", "item": {
        "id": str(row["id"]), "date": format_event_date(day_date),
        "time": row["time"], "place": body["place"],
        "address": body.get("address", ""), "lat": body.get("lat"),
        "lng": body.get("lng"), "notes": body.get("notes"),
        "added_by": None, "added_by_you": True,
    }}, status=201)


def _update_item(event, current_user):
    params = event.get("pathParameters") or {}
    trip_uuid = parse_uuid(params.get("trip_id", ""), "trip_id")
    event_uuid = parse_uuid(params.get("event_id", ""), "event_id")
    body = parse_body(event)
    with get_db() as db:
        require_trip_access(db, trip_uuid, current_user["id"])
        db.execute(
            """
            SELECT dp.id, dp.place_id FROM day_places dp
            JOIN trip_days td ON td.id = dp.trip_day_id
            WHERE dp.id = %s AND td.trip_id = %s
            """,
            (event_uuid, trip_uuid),
        )
        row = db.fetchone()
        if not row:
            # Also what a co-editor sees when the other person deleted this
            # event a moment ago; the client says so rather than showing a
            # generic failure.
            raise AppError("Event not found", status=404)
        db.execute(
            "UPDATE places SET name=%s, address=%s, lat=%s, lng=%s, updated_at=NOW() WHERE id=%s",
            (body["place"], body.get("address", ""), body.get("lat"), body.get("lng"), row["place_id"]),
        )
        # Moving an event to another day is just a new trip_day_id. Only
        # touched when the client sent a date, so an older build that omits it
        # leaves the event on the day it is already on.
        if body.get("date"):
            trip_day_id, day_date = resolve_trip_day(db, trip_uuid, current_user["id"], body)
            db.execute(
                "UPDATE day_places SET trip_day_id=%s, visit_time=%s, notes=%s, updated_at=NOW() WHERE id=%s",
                (trip_day_id, body["time"], body.get("notes"), event_uuid),
            )
        else:
            day_date = None
            db.execute(
                "UPDATE day_places SET visit_time=%s, notes=%s, updated_at=NOW() WHERE id=%s",
                (body["time"], body.get("notes"), event_uuid),
            )
        touch_trip(db, trip_uuid)
    return success({
        "message": "Event updated successfully",
        "date": format_event_date(day_date) if day_date else None,
    })


def _delete_item(event, current_user):
    params = event.get("pathParameters") or {}
    trip_uuid = parse_uuid(params.get("trip_id", ""), "trip_id")
    event_uuid = parse_uuid(params.get("event_id", ""), "event_id")
    with get_db() as db:
        require_trip_access(db, trip_uuid, current_user["id"])
        db.execute(
            """
            SELECT dp.id, dp.place_id FROM day_places dp
            JOIN trip_days td ON td.id = dp.trip_day_id
            WHERE dp.id = %s AND td.trip_id = %s
            """,
            (event_uuid, trip_uuid),
        )
        row = db.fetchone()
        if not row:
            raise AppError("Event not found", status=404)
        # Anyone on the trip may delete any event on it — editors are equal.
        # The assistant is the one caller that asks first, because there a
        # fuzzy name match stands between the user and the deletion.
        db.execute("DELETE FROM day_places WHERE id = %s", (event_uuid,))
        db.execute("DELETE FROM places WHERE id = %s", (row["place_id"],))
        touch_trip(db, trip_uuid)
    return success({"message": "Event deleted successfully"})
