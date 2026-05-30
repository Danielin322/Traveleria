import uuid

from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import AppError, get_or_create_default_trip_day, parse_body, parse_uuid


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
        db.execute(
            """
            SELECT dp.id, dp.visit_time AS time, dp.notes,
                   p.name AS place, COALESCE(p.address, '') AS address, p.lat, p.lng
            FROM day_places dp
            JOIN trip_days td ON td.id = dp.trip_day_id
            JOIN trips t ON t.id = td.trip_id
            JOIN places p ON p.id = dp.place_id
            WHERE td.trip_id = %s AND t.owner_user_id = %s
            ORDER BY td.day_date, dp.visit_time, p.name
            """,
            (trip_uuid, current_user["id"]),
        )
        return success([
            {"id": str(row["id"]), "time": row["time"], "place": row["place"],
             "address": row["address"], "lat": row["lat"], "lng": row["lng"], "notes": row["notes"]}
            for row in db.fetchall()
        ])


def _create_item(event, current_user):
    trip_uuid = parse_uuid((event.get("pathParameters") or {}).get("trip_id", ""), "trip_id")
    body = parse_body(event)
    with get_db() as db:
        trip_day_id = get_or_create_default_trip_day(db, trip_uuid, current_user["id"])
        db.execute(
            "INSERT INTO places (name, address, google_place_id, lat, lng) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (body["place"], body.get("address", ""), f"manual:{uuid.uuid4()}", body.get("lat"), body.get("lng")),
        )
        place_id = db.fetchone()["id"]
        db.execute(
            "INSERT INTO day_places (trip_day_id, place_id, visit_time, notes) VALUES (%s, %s, %s, %s) RETURNING id, visit_time AS time",
            (trip_day_id, place_id, body["time"], body.get("notes")),
        )
        row = db.fetchone()
    return success({"message": "Event added successfully", "item": {
        "id": str(row["id"]), "time": row["time"], "place": body["place"],
        "address": body.get("address", ""), "lat": body.get("lat"),
        "lng": body.get("lng"), "notes": body.get("notes"),
    }}, status=201)


def _update_item(event, current_user):
    params = event.get("pathParameters") or {}
    trip_uuid = parse_uuid(params.get("trip_id", ""), "trip_id")
    event_uuid = parse_uuid(params.get("event_id", ""), "event_id")
    body = parse_body(event)
    with get_db() as db:
        db.execute(
            """
            SELECT dp.id, dp.place_id FROM day_places dp
            JOIN trip_days td ON td.id = dp.trip_day_id
            JOIN trips t ON t.id = td.trip_id
            WHERE dp.id = %s AND td.trip_id = %s AND t.owner_user_id = %s
            """,
            (event_uuid, trip_uuid, current_user["id"]),
        )
        row = db.fetchone()
        if not row:
            raise AppError("Event not found", status=404)
        db.execute(
            "UPDATE places SET name=%s, address=%s, lat=%s, lng=%s, updated_at=NOW() WHERE id=%s",
            (body["place"], body.get("address", ""), body.get("lat"), body.get("lng"), row["place_id"]),
        )
        db.execute(
            "UPDATE day_places SET visit_time=%s, notes=%s, updated_at=NOW() WHERE id=%s",
            (body["time"], body.get("notes"), event_uuid),
        )
    return success({"message": "Event updated successfully"})


def _delete_item(event, current_user):
    params = event.get("pathParameters") or {}
    trip_uuid = parse_uuid(params.get("trip_id", ""), "trip_id")
    event_uuid = parse_uuid(params.get("event_id", ""), "event_id")
    with get_db() as db:
        db.execute(
            """
            SELECT dp.id, dp.place_id FROM day_places dp
            JOIN trip_days td ON td.id = dp.trip_day_id
            JOIN trips t ON t.id = td.trip_id
            WHERE dp.id = %s AND td.trip_id = %s AND t.owner_user_id = %s
            """,
            (event_uuid, trip_uuid, current_user["id"]),
        )
        row = db.fetchone()
        if not row:
            raise AppError("Event not found", status=404)
        db.execute("DELETE FROM day_places WHERE id = %s", (event_uuid,))
        db.execute("DELETE FROM places WHERE id = %s", (row["place_id"],))
    return success({"message": "Event deleted successfully"})
