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
    format_event_date,
    get_or_create_trip_day_for_date,
    parse_body,
    parse_event_date,
    parse_uuid,
    require_trip_access,
    touch_trip,
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is not set.")
GOOGLE_PLACES_API_KEY = os.getenv("GOOGLE_PLACES_API_KEY")

_client = OpenAI(api_key=OPENAI_API_KEY)
MODEL = "gpt-4.1-mini"

# Ten exchanges. Six messages — three exchanges — could not survive the flow
# this assistant exists for: suggest places, pick one, agree a day and time,
# add it. The question it had just asked would fall out of the window before
# the answer arrived, so it asked again. Several rules in the system prompt
# ("if you have already asked once in this conversation") are only enforceable
# because the model can still see that it asked.
#
# A message count is a crude ruler — replies here run from five tokens to four
# hundred — so this is a stand-in for a token budget, not a substitute for one.
HISTORY_LIMIT = 20

# How many times the model may call tools before it has to answer in prose.
# Three covers the sequence this exists for — read the itinerary, write to it,
# summarise — and the cap is what stands between a confused model and an
# unbounded run of OpenAI calls inside a Lambda holding a database connection
# open. After the last round we make one more call with no tools attached, so
# there is always a reply to return.
MAX_TOOL_ROUNDS = 3

def _build_system_prompt(location, trip_start, trip_end, profile, people):
    num_days = (trip_end - trip_start).days + 1
    day_list = "\n".join(
        f"Day {i + 1}: {(trip_start + timedelta(days=i)).strftime('%d.%m.%Y')}"
        for i in range(num_days)
    )

    # The trip's destination, which this prompt went without for a long time:
    # the column was read for the Google Places lookup and never passed here,
    # so the model only knew where the trip was if the city happened to appear
    # in the last few messages, and recommended generically once it scrolled
    # out. `location` is nullable, and a trip without one is the single case
    # where the assistant must not fill the gap itself.
    place = (location or "").strip()
    if place:
        opening = (
            "You are Traveleria's in-app travel assistant, helping plan a trip "
            f"to {place}."
        )
        here = place
    else:
        opening = (
            "You are Traveleria's in-app travel assistant. This trip has no "
            "destination set yet — ask the user where they are going before "
            "making any location-specific suggestion, and never guess."
        )
        here = "the destination"

    profile_lines = []
    if profile.get("gender") and profile["gender"] != "prefer_not_to_say":
        profile_lines.append(
            f"- Gender: {profile['gender']}. In Hebrew, use grammatically "
            "correct gender-matched verb forms consistently — to a male user "
            "\"מה תרצה לעשות?\", to a female user \"מה תרצי לעשות?\"."
        )
    if profile.get("dietary"):
        # This used to say to ask, before every food suggestion, whether to
        # filter by the saved preference. The intent was a vegan travelling
        # with a non-vegan; the effect was the same question every time the
        # subject came up, which is most of what this assistant talks about.
        profile_lines.append(
            f"- Dietary: {', '.join(profile['dietary'])}. Apply this to food "
            "suggestions by default and say so in one short line (\"all "
            "vegan-friendly\") rather than asking permission first. Ask only "
            "when they need somewhere that also works for a companion who "
            "eats differently — and if you have already asked once in this "
            "conversation, never ask again."
        )
    if profile.get("interests"):
        profile_lines.append(
            f"- Interests: {', '.join(profile['interests'])}. Lean toward "
            "these when a natural option comes up, but keep suggestions "
            "varied — never limit yourself to only these categories."
        )
    profile_block = (
        "\n\n## About this traveler\n" + "\n".join(profile_lines)
    ) if profile_lines else ""

    # On a shared trip the plan is not only this user's. Saying so stops the
    # assistant talking as though it and the user built everything, and makes
    # "who added this?" a question it can actually answer.
    if people:
        shared_block = (
            f"\n\n## This trip is shared with {', '.join(people)}.\n"
            "They can add and change events too, so the itinerary may contain "
            "things this user did not put there. Never assume an event was "
            "added by the person you are talking to — get_itinerary tells you "
            "who added each one."
        )
    else:
        shared_block = ""

    return (
        f"{opening}\n\n"
        f"The trip's days are:\n{day_list}\n\n"
        "Always reply in the same language the user just wrote in — English "
        "for an English message, Hebrew for a Hebrew message. Keep replies "
        f"short and direct: no filler, no pleasantries.{profile_block}\n\n"
        "## Recommendations\n"
        f"Lead with 2-3 concrete, specific suggestions in {here}. Never open "
        "with a clarifying question. After the suggestions you may ask at most "
        "ONE short follow-up — never two, and never about price range, "
        "atmosphere, or neighborhood unless the user raised it first.\n\n"
        "Example of the shape:\n\n"
        "Two vegan spots in Rome, different styles:\n\n"
        "Buddy Veggy (near Campo de' Fiori) — plant-based takes on Roman "
        "classics: carbonara, cacio e pepe, pizza.\n\n"
        "Ops! (Salario, near Villa Borghese) — pay-by-weight vegan buffet, "
        "Mediterranean dishes and warm mains.\n\n"
        "Want me to put one of these on a day?\n\n"
        "## Reading the itinerary\n"
        "You do not know what is planned unless you look. Call get_itinerary "
        "before answering any question about what is scheduled, before "
        "proposing a time so you do not clash with something already there, "
        "and before removing an item you are not certain about.\n\n"
        "## Adding\n"
        "Never call add_itinerary_item while brainstorming — only when the "
        "user explicitly asks or confirms.\n\n"
        "You need three things before adding: the place, the day (DD.MM.YYYY, "
        "taken from the list above), and the time. If the day or the time is "
        "missing, ask for both in a single message (\"Which day and what time "
        "works?\") and wait. Never guess either one. If you suggested several "
        "places and it is unclear which they mean, ask that first.\n\n"
        "When the user says \"day 3\", use the exact date from the list above "
        "— do not calculate it yourself.\n\n"
        "To plan several things at once, call add_itinerary_item once per "
        "item, all in the same turn.\n\n"
        "When summarizing multiple added items, format exactly like this — a "
        "blank line between items, no bullets, no numbering:\n\n"
        "08:30 – Meiji Jingu:\n"
        "A peaceful start among the shrine's tree-lined paths before the city "
        "wakes up.\n\n"
        "10:00 – Coffee and pastry:\n"
        "Head toward Harajuku for a relaxed coffee break at a local café.\n\n"
        "## Removing\n"
        "Call remove_itinerary_item with the place name the user mentions, "
        "then react to what comes back:\n"
        "- \"ambiguous\" → ask which one, naming the day and time of each.\n"
        "- \"needs_confirmation\" → the event belongs to someone else. Do not "
        "call it again yet. Say who added it, name the place, day and time, "
        "and ask whether to remove it anyway. Only after they agree, call it "
        "again with confirm set to true.\n"
        "- \"removed\" → say what was removed: place, day and time."
        + shared_block
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
                "confirm": {"type": "boolean", "description": "Set to true only after the user has agreed to remove an event that someone else added"},
            },
            "required": ["place"],
        },
    },
}

GET_ITINERARY_TOOL = {
    "type": "function",
    "function": {
        "name": "get_itinerary",
        "description": (
            "Read the trip's current itinerary: every planned event with its day, "
            "time, place and who added it. Call this before answering questions "
            "about what is planned, before suggesting a time so you do not clash "
            "with something already scheduled, and before removing an item."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "day": {
                    "type": "string",
                    "description": "Optional visit date in DD.MM.YYYY format, to read one day instead of the whole trip",
                },
            },
        },
    },
}

TOOLS = [GET_ITINERARY_TOOL, ADD_ITEM_TOOL, REMOVE_ITEM_TOOL]


def lambda_handler(event, context):
    try:
        current_user = get_current_user(event)

        if event.get("httpMethod") == "GET":
            trip_uuid = parse_uuid((event.get("queryStringParameters") or {}).get("trip_id", ""), "trip_id")
            return _get_chat_history(trip_uuid, current_user["id"])

        body = parse_body(event)
        if body.get("warmup"):
            return success({})
        text = (body.get("text") or "").strip()
        if not text:
            raise AppError("text is required")
        trip_uuid = parse_uuid(body.get("trip_id", ""), "trip_id")

        with get_db() as db:
            trip = _get_trip(db, trip_uuid, current_user["id"])
            profile = _get_user_profile(db, current_user["id"])
            people = _get_other_people(db, trip_uuid, current_user["id"])
            history = _load_history(db, trip_uuid, current_user["id"])
            reply, added_items, removed_ids = _run_conversation(
                db, trip_uuid, current_user["id"], trip, profile, people, history, text
            )
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


def _get_trip(db, trip_id, user_id):
    """
    The trip, if the caller may see it at all.

    Owner or accepted collaborator — the check is the same one the trips and
    itinerary Lambdas use. Before co-editing this asked for ownership, which
    would have made the chat the first place a collaborator hit a 404.
    """
    require_trip_access(db, trip_id, user_id)
    db.execute(
        "SELECT location, start_date, end_date FROM trips WHERE id = %s",
        (trip_id,),
    )
    return db.fetchone()


def _get_other_people(db, trip_id, user_id):
    """
    Everyone else on the trip, as display names, for the system prompt.

    Empty on a solo trip, which is what keeps the shared-trip paragraph and
    per-event attribution out of the prompt entirely when there is nobody to
    attribute anything to.
    """
    db.execute(
        """
        SELECT u.id, u.full_name, u.email FROM users u
        JOIN trips t ON t.owner_user_id = u.id
        WHERE t.id = %(trip_id)s
        UNION
        SELECT u.id, u.full_name, u.email FROM trip_collaborators tc
        JOIN users u ON u.id = tc.user_id
        WHERE tc.trip_id = %(trip_id)s AND tc.status = 'active'
        """,
        {"trip_id": trip_id},
    )
    return [
        row["full_name"] or row["email"]
        for row in db.fetchall()
        if row["id"] != user_id
    ]


def _get_chat_history(trip_id, user_id):
    with get_db() as db:
        require_trip_access(db, trip_id, user_id)
        # Filtered by user_id as well as trip_id, and it must stay that way:
        # two people planning one trip have two separate conversations.
        db.execute(
            "SELECT id, role, content FROM chat_messages WHERE trip_id = %s AND user_id = %s ORDER BY created_at",
            (trip_id, user_id),
        )
        rows = db.fetchall()
    return success([
        {"id": str(row["id"]), "text": row["content"], "isUser": row["role"] == "user"}
        for row in rows
    ])


def _get_user_profile(db, user_id):
    db.execute("SELECT gender, dietary, interests FROM users WHERE id = %s", (user_id,))
    return db.fetchone()


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


def _run_conversation(db, trip_id, user_id, trip, profile, people, history, text):
    """
    One turn: call the model, run whatever tools it asks for, repeat.

    This was a single exchange plus one tool-free follow-up, which is enough
    when every tool is a write — the call *is* the action, and nothing has to
    happen afterwards. get_itinerary broke that: reading is only useful if the
    model can then act on what it read, so the follow-up has to carry the tools
    too, which makes it a loop.
    """
    system_prompt = _build_system_prompt(
        trip["location"], trip["start_date"], trip["end_date"], profile, people
    )
    messages = [{"role": "system", "content": system_prompt}, *history, {"role": "user", "content": text}]

    added_items = []
    removed_ids = []

    for _ in range(MAX_TOOL_ROUNDS):
        response = _client.chat.completions.create(
            model=MODEL, messages=messages, tools=TOOLS, temperature=0.3
        )
        choice = response.choices[0].message

        if not choice.tool_calls:
            return choice.content, added_items, removed_ids

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

        for call in choice.tool_calls:
            args = json.loads(call.function.arguments)
            try:
                if call.function.name == "get_itinerary":
                    result = _get_itinerary_for_model(db, trip_id, user_id, trip, bool(people), args)
                elif call.function.name == "add_itinerary_item":
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

    # Out of rounds. One more call with no tools attached, so the model has to
    # answer in words and the user is never left with silence.
    final = _client.chat.completions.create(model=MODEL, messages=messages, temperature=0.3)
    reply = final.choices[0].message.content
    return (
        reply or "I could not finish that — could you say it a different way?",
        added_items,
        removed_ids,
    )


def _get_itinerary_for_model(db, trip_id, user_id, trip, shared, args):
    """
    The trip's events, day by day, for the model to read.

    Days with nothing on them are included: the model needs to see a gap to
    suggest filling it, and inferring absence from a list of what exists is
    exactly the kind of reasoning it gets wrong.

    `added_by` is omitted entirely on a solo trip — attribution nobody can use
    is just tokens.
    """
    one_day = parse_event_date(args["day"]) if args.get("day") else None

    sql = """
        SELECT td.day_date, dp.visit_time AS time, p.name AS place,
               dp.created_by_user_id,
               author.full_name AS author_name, author.email AS author_email
        FROM day_places dp
        JOIN trip_days td ON td.id = dp.trip_day_id
        JOIN places p ON p.id = dp.place_id
        LEFT JOIN users author ON author.id = dp.created_by_user_id
        WHERE td.trip_id = %s
    """
    params = [trip_id]
    if one_day:
        sql += " AND td.day_date = %s"
        params.append(one_day)
    sql += " ORDER BY td.day_date, dp.visit_time"

    db.execute(sql, params)

    by_date = {}
    for row in db.fetchall():
        event = {"time": row["time"], "place": row["place"]}
        if shared:
            if not row["created_by_user_id"]:
                event["added_by"] = "unknown"
            elif row["created_by_user_id"] == user_id:
                event["added_by"] = "you"
            else:
                event["added_by"] = row["author_name"] or row["author_email"]
        by_date.setdefault(row["day_date"], []).append(event)

    if one_day:
        dates = [one_day]
    else:
        span = (trip["end_date"] - trip["start_date"]).days + 1
        dates = [trip["start_date"] + timedelta(days=i) for i in range(span)]

    return {
        "days": [
            {"date": format_event_date(d), "events": by_date.get(d, [])}
            for d in dates
        ]
    }


def _add_itinerary_item(db, trip_id, user_id, trip, args):
    place = args["place"]
    time = args["time"]
    address = args.get("address") or ""
    notes = args.get("notes")

    day = parse_event_date(args["day"])

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
        "INSERT INTO day_places (trip_day_id, place_id, visit_time, notes, created_by_user_id) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id, visit_time AS time",
        (trip_day_id, place_id, time, notes, user_id),
    )
    row = db.fetchone()
    touch_trip(db, trip_id)
    return {
        "id": str(row["id"]), "date": format_event_date(day), "time": row["time"], "place": place,
        "address": address, "lat": lat, "lng": lng, "notes": notes,
    }


def _remove_itinerary_item(db, trip_id, user_id, args):
    place_query = args["place"]
    day_str = args.get("day")
    day = parse_event_date(day_str) if day_str else None

    # Access was checked once for this whole request, so the trip id is enough
    # to scope the search. It used to be scoped by ownership as well, which on
    # a shared trip would have hidden a co-editor's events from removal while
    # leaving them fully visible everywhere else.
    query = """
        SELECT dp.id, dp.place_id, p.name, dp.visit_time, td.day_date,
               dp.created_by_user_id,
               author.full_name AS author_name, author.email AS author_email
        FROM day_places dp
        JOIN trip_days td ON td.id = dp.trip_day_id
        JOIN places p ON p.id = dp.place_id
        LEFT JOIN users author ON author.id = dp.created_by_user_id
        WHERE td.trip_id = %s AND p.name ILIKE %s
    """
    params = [trip_id, f"%{place_query}%"]
    if day:
        query += " AND td.day_date = %s"
        params.append(day)

    db.execute(query, params)
    rows = db.fetchall()

    if not rows:
        return {"status": "not_found", "message": f"No itinerary item matching '{place_query}' was found."}

    if len(rows) > 1:
        candidates = [
            {"place": row["name"], "day": format_event_date(row["day_date"]),
             "time": row["visit_time"], "added_by": _author_label(row, user_id)}
            for row in rows
        ]
        return {"status": "ambiguous", "candidates": candidates}

    row = rows[0]
    details = {
        "place": row["name"],
        "day": format_event_date(row["day_date"]),
        "time": row["visit_time"],
    }

    # Deleting someone else's event on a fuzzy name match is the one thing here
    # that cannot be undone and was never asked for. Editors are equal, so the
    # answer may well be yes — it just must not be silent.
    author = row["created_by_user_id"]
    if author and author != user_id and not args.get("confirm"):
        return {
            "status": "needs_confirmation",
            "created_by": _author_label(row, user_id),
            **details,
        }

    db.execute("DELETE FROM day_places WHERE id = %s", (row["id"],))
    db.execute("DELETE FROM places WHERE id = %s", (row["place_id"],))
    touch_trip(db, trip_id)
    return {"status": "removed", "removed_id": str(row["id"]), **details}


def _author_label(row, user_id):
    if not row["created_by_user_id"]:
        return "unknown"
    if row["created_by_user_id"] == user_id:
        return "you"
    return row["author_name"] or row["author_email"]


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
