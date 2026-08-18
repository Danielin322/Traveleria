import os

from openai import OpenAI

from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import AppError, parse_body, parse_uuid

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is not set.")

_client = OpenAI(api_key=OPENAI_API_KEY)
MODEL = "gpt-4.1-nano"
HISTORY_LIMIT = 6

SYSTEM_PROMPT = (
    "You are Traveleria's in-app travel assistant. Help the user plan and enjoy "
    "their trip: suggest places, food, and activities, and answer trip-related "
    "questions. Keep replies short and conversational."
)


def lambda_handler(event, context):
    try:
        current_user = get_current_user(event)
        body = parse_body(event)
        text = (body.get("text") or "").strip()
        if not text:
            raise AppError("text is required")
        trip_uuid = parse_uuid(body.get("trip_id", ""), "trip_id")

        with get_db() as db:
            _assert_trip_owner(db, trip_uuid, current_user["id"])
            history = _load_history(db, trip_uuid, current_user["id"])
            reply = _generate_reply(history, text)
            _save_message(db, trip_uuid, current_user["id"], "user", text)
            _save_message(db, trip_uuid, current_user["id"], "assistant", reply)

        return success({"text": reply})
    except AppError as e:
        return error(e.message, e.status)
    except Exception as e:
        return error(str(e), 500)


def _assert_trip_owner(db, trip_id, user_id):
    db.execute("SELECT id FROM trips WHERE id = %s AND owner_user_id = %s", (trip_id, user_id))
    if not db.fetchone():
        raise AppError("Trip not found", status=404)


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


def _generate_reply(history, text):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history, {"role": "user", "content": text}]
    response = _client.chat.completions.create(model=MODEL, messages=messages)
    return response.choices[0].message.content


def _save_message(db, trip_id, user_id, role, content):
    db.execute(
        "INSERT INTO chat_messages (trip_id, user_id, role, content) VALUES (%s, %s, %s, %s)",
        (trip_id, user_id, role, content),
    )
