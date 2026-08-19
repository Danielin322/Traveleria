import json
import os
import uuid

import httpx
from openai import OpenAI

from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import (
    AppError,
    format_trip_date,
    get_or_create_trip_day_for_date,
    parse_body,
    parse_single_date,
    parse_uuid,
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is not set.")
GOOGLE_PLACES_API_KEY = os.getenv("GOOGLE_PLACES_API_KEY")

_client = OpenAI(api_key=OPENAI_API_KEY)
MODEL = "gpt-4.1-nano"
HISTORY_LIMIT = 6

def _build_system_prompt(trip_start, trip_end):
    date_range = format_trip_date(trip_start, trip_end)
    return (
        "You are Traveleria's in-app travel assistant. Help the user plan and enjoy "
        "their trip: suggest places, food, and activities, and answer trip-related "
        f"questions. The trip runs from {date_range} (DD.MM.YYYY). Keep replies short "
        "and conversational. "
        "If the user agrees to add a place you suggested to their itinerary, ask for "
        "the exact visit time AND which day of the trip (a date within the trip's range, "
        "in DD.MM.YYYY format) if they haven't given both, then call add_itinerary_item "
        "once you have the place name, the day, and the time."
    )


ADD_ITEM_TOOL = {
    "type": "function",
    "function": {
        "name": "add_itinerary_item",
        "description": "Add a place to the user's trip itinerary on a specific day and time.",
        "parameters": {
            "type": "object",
            "properties": {
                "place": {"type": "string", "description": "Name of the place, restaurant, or activity"},
                "day": {"type": "string", "description": "Visit date in DD.MM.YYYY format, within the trip's date range"},
                "time": {"type": "string", "description": "Visit time in 24h HH:MM format"},
                "address": {"type": "string", "description": "Address or area, if known"},
                "notes": {"type": "string", "description": "Any extra notes about the visit"},
            },
            "required": ["place", "day", "time"],
        },
    },
}


def lambda_handler(event, context):
    try:
        current_user = get_current_user(event)
        body = parse_body(event)
        text = (body.get("text") or "").strip()
        if not text:
            raise AppError("text is required")
        trip_uuid = parse_uuid(body.get("trip_id", ""), "trip_id")

        with get_db() as db:
            trip = _get_owned_trip(db, trip_uuid, current_user["id"])
            history = _load_history(db, trip_uuid, current_user["id"])
            reply, added_item = _run_conversation(db, trip_uuid, current_user["id"], trip, history, text)
            _save_message(db, trip_uuid, current_user["id"], "user", text)
            _save_message(db, trip_uuid, current_user["id"], "assistant", reply)

        response_body = {"text": reply}
        if added_item:
            response_body["added_item"] = added_item
        return success(response_body)
    except AppError as e:
        return error(e.message, e.status)
    except Exception as e:
        return error(str(e), 500)


def _get_owned_trip(db, trip_id, user_id):
    db.execute(
        "SELECT location, start_date, end_date FROM trips WHERE id = %s AND owner_user_id = %s",
        (trip_id, user_id),
    )
    row = db.fetchone()
    if not row:
        raise AppError("Trip not found", status=404)
    return row


def _load_history(db, trip_id, user_id):
    db.execute(
        """
        SELECT role, content FROM chat_messages
        WHERE trip_id = %s AND user_id = %s
        ORDER BY created_at DESC LIMIT %s
        """,
        (trip_id, user_id, HISTORY_LIMIT),
    )
    rows = db.fetchall()
    return [{"role": row["role"], "content": row["content"]} for row in reversed(rows)]


def _run_conversation(db, trip_id, user_id, trip, history, text):
    system_prompt = _build_system_prompt(trip["start_date"], trip["end_date"])
    messages = [{"role": "system", "content": system_prompt}, *history, {"role": "user", "content": text}]
    response = _client.chat.completions.create(model=MODEL, messages=messages, tools=[ADD_ITEM_TOOL])
    choice = response.choices[0].message

    if not choice.tool_calls:
        return choice.content, None

    call = choice.tool_calls[0]
    args = json.loads(call.function.arguments)
    item = _add_itinerary_item(db, trip_id, user_id, trip, args)

    messages.append({
        "role": "assistant",
        "content": choice.content,
        "tool_calls": [{
            "id": call.id,
            "type": "function",
            "function": {"name": call.function.name, "arguments": call.function.arguments},
        }],
    })
    messages.append({
        "role": "tool",
        "tool_call_id": call.id,
        "content": json.dumps({"status": "added", "item": item}),
    })
    followup = _client.chat.completions.create(model=MODEL, messages=messages)
    return followup.choices[0].message.content, item


def _add_itinerary_item(db, trip_id, user_id, trip, args):
    place = args["place"]
    time = args["time"]
    address = args.get("address") or ""
    notes = args.get("notes")

    day = parse_single_date(args["day"], "day")
    if not (trip["start_date"] <= day <= trip["end_date"]):
        raise AppError(
            f"day must be between {trip['start_date'].strftime('%d.%m.%Y')} "
            f"and {trip['end_date'].strftime('%d.%m.%Y')}"
        )

    lat, lng, resolved_address = _lookup_place(place, trip["location"])
    if resolved_address:
        address = resolved_address

    trip_day_id = get_or_create_trip_day_for_date(db, trip_id, user_id, day)
    db.execute(
        "INSERT INTO places (name, address, google_place_id, lat, lng) VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (place, address, f"chat:{uuid.uuid4()}", lat, lng),
    )
    place_id = db.fetchone()["id"]
    db.execute(
        "INSERT INTO day_places (trip_day_id, place_id, visit_time, notes) VALUES (%s, %s, %s, %s) "
        "RETURNING id, visit_time AS time",
        (trip_day_id, place_id, time, notes),
    )
    row = db.fetchone()
    return {
        "id": str(row["id"]), "time": row["time"], "place": place,
        "address": address, "lat": lat, "lng": lng, "notes": notes,
    }


def _lookup_place(place, trip_location):
    if not GOOGLE_PLACES_API_KEY:
        return None, None, None
    query = f"{place} in {trip_location}" if trip_location else place
    try:
        resp = httpx.get(
            "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
            params={
                "input": query,
                "inputtype": "textquery",
                "fields": "geometry,formatted_address",
                "key": GOOGLE_PLACES_API_KEY,
            },
            timeout=5.0,
        )
        candidates = resp.json().get("candidates") or []
        if not candidates:
            return None, None, None
        top = candidates[0]
        location = top.get("geometry", {}).get("location", {})
        return location.get("lat"), location.get("lng"), top.get("formatted_address")
    except Exception:
        return None, None, None


def _save_message(db, trip_id, user_id, role, content):
    db.execute(
        "INSERT INTO chat_messages (trip_id, user_id, role, content) VALUES (%s, %s, %s, %s)",
        (trip_id, user_id, role, content),
    )
