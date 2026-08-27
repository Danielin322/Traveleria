import json
import os
import uuid
from datetime import timedelta

import httpx
from openai import OpenAI

from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import (
    AppError,
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
    num_days = (trip_end - trip_start).days + 1
    day_list = "\n".join(
        f"Day {i + 1}: {(trip_start + timedelta(days=i)).strftime('%d.%m.%Y')}"
        for i in range(num_days)
    )
    return (
        "You are Traveleria's in-app travel assistant. Help the user plan and enjoy "
        "their trip: suggest places, food, and activities, and answer trip-related "
        "questions. Keep replies short and conversational.\n\n"
        f"The trip's days are:\n{day_list}\n\n"
        "When the user refers to a day by number (e.g. \"day 3\"), use the exact date "
        "from this list above — do not calculate it yourself.\n\n"
        "If the user agrees to add a place you suggested to their itinerary, ask for "
        "the exact visit time AND which day of the trip if they haven't given both, "
        "then call add_itinerary_item once you have the place name, the day (in "
        "DD.MM.YYYY format, taken from the list above), and the time. "
        "If the user asks you to plan multiple things at once (e.g. a full day), call "
        "add_itinerary_item once per item, all in the same turn. When summarizing "
        "multiple items in your reply, format each one EXACTLY like this example, "
        "with a blank line between items, and do NOT use a numbered list or bullet points:\n\n"
        "08:30 – Meiji Jingu:\n"
        "A peaceful start among the shrine's tree-lined paths before the city wakes up.\n\n"
        "10:00 – Coffee and pastry:\n"
        "Head toward Harajuku for a relaxed coffee break at a local café.\n\n"
        "If the user wants to remove or cancel an itinerary item, call remove_itinerary_item "
        "with the place name they mention. If several items match and it's unclear which one, "
        "ask the user to clarify before trying again."
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

REMOVE_ITEM_TOOL = {
    "type": "function",
    "function": {
        "name": "remove_itinerary_item",
        "description": "Remove a place from the user's trip itinerary.",
        "parameters": {
            "type": "object",
            "properties": {
                "place": {"type": "string", "description": "Name (or partial name) of the place to remove, as the user describes it"},
                "day": {"type": "string", "description": "Optional: visit date in DD.MM.YYYY format, to disambiguate if multiple items match"},
            },
            "required": ["place"],
        },
    },
}

TOOLS = [ADD_ITEM_TOOL, REMOVE_ITEM_TOOL]


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
            reply, added_items, removed_ids = _run_conversation(db, trip_uuid, current_user["id"], trip, history, text)
            _save_message(db, trip_uuid, current_user["id"], "user", text)
            _save_message(db, trip_uuid, current_user["id"], "assistant", reply)

        response_body = {"text": reply}
        if added_items:
            response_body["added_items"] = added_items
        if removed_ids:
            response_body["removed_item_ids"] = removed_ids
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
    response = _client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS, temperature=0.3)
    choice = response.choices[0].message

    if not choice.tool_calls:
        return choice.content, [], []

    messages.append({
        "role": "assistant",
        "content": choice.content,
        "tool_calls": [
            {
                "id": call.id,
                "type": "function",
                "function": {"name": call.function.name, "arguments": call.function.arguments},
            }
            for call in choice.tool_calls
        ],
    })

    added_items = []
    removed_ids = []
    for call in choice.tool_calls:
        args = json.loads(call.function.arguments)
        try:
            if call.function.name == "add_itinerary_item":
                item = _add_itinerary_item(db, trip_id, user_id, trip, args)
                added_items.append(item)
                result = {"status": "added", "item": item}
            elif call.function.name == "remove_itinerary_item":
                result = _remove_itinerary_item(db, trip_id, user_id, args)
                if result.get("status") == "removed":
                    removed_ids.append(result["removed_id"])
            else:
                result = {"status": "error", "message": "Unknown tool"}
        except AppError as e:
            result = {"status": "error", "message": e.message}
        messages.append({
            "role": "tool",
            "tool_call_id": call.id,
            "content": json.dumps(result),
        })

    followup = _client.chat.completions.create(model=MODEL, messages=messages, temperature=0.3)
    return followup.choices[0].message.content, added_items, removed_ids


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


def _remove_itinerary_item(db, trip_id, user_id, args):
    place_query = args["place"]
    day_str = args.get("day")
    day = parse_single_date(day_str, "day") if day_str else None

    query = """
        SELECT dp.id, dp.place_id, p.name, dp.visit_time, td.day_date
        FROM day_places dp
        JOIN trip_days td ON td.id = dp.trip_day_id
        JOIN trips t ON t.id = td.trip_id
        JOIN places p ON p.id = dp.place_id
        WHERE td.trip_id = %s AND t.owner_user_id = %s AND p.name ILIKE %s
    """
    params = [trip_id, user_id, f"%{place_query}%"]
    if day:
        query += " AND td.day_date = %s"
        params.append(day)

    db.execute(query, params)
    rows = db.fetchall()

    if not rows:
        return {"status": "not_found", "message": f"No itinerary item matching '{place_query}' was found."}

    if len(rows) > 1:
        candidates = [
            {"place": row["name"], "day": row["day_date"].strftime("%d.%m.%Y"), "time": row["visit_time"]}
            for row in rows
        ]
        return {"status": "ambiguous", "candidates": candidates}

    row = rows[0]
    db.execute("DELETE FROM day_places WHERE id = %s", (row["id"],))
    db.execute("DELETE FROM places WHERE id = %s", (row["place_id"],))
    return {"status": "removed", "removed_id": str(row["id"])}


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
