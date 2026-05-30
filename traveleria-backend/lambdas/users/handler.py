from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import AppError, parse_body


def lambda_handler(event, context):
    method = event.get("httpMethod", "GET")
    try:
        current_user = get_current_user(event)
        if method == "GET":
            return _get_profile(current_user)
        if method == "PATCH":
            return _update_profile(event, current_user)
        return error("Method not allowed", 405)
    except AppError as e:
        return error(e.message, e.status)
    except Exception as e:
        return error(str(e), 500)


def _get_profile(current_user):
    with get_db() as db:
        db.execute(
            """
            SELECT full_name, country, language, age, interests,
                   (SELECT COUNT(*) FROM trips WHERE owner_user_id = %s) AS trips_count
            FROM users WHERE id = %s
            """,
            (current_user["id"], current_user["id"]),
        )
        row = db.fetchone()
    return success({
        "email": current_user["email"], "full_name": row["full_name"],
        "country": row["country"], "language": row["language"],
        "age": row["age"], "interests": row["interests"], "trips_count": row["trips_count"],
    })


def _update_profile(event, current_user):
    body = parse_body(event)
    with get_db() as db:
        db.execute(
            """
            UPDATE users
            SET full_name=COALESCE(%s, full_name), country=COALESCE(%s, country),
                language=COALESCE(%s, language), age=COALESCE(%s, age),
                interests=COALESCE(%s, interests), updated_at=NOW()
            WHERE id=%s
            RETURNING full_name, country, language, age, interests
            """,
            (body.get("full_name"), body.get("country"), body.get("language"),
             body.get("age"), body.get("interests"), current_user["id"]),
        )
        row = db.fetchone()
    return success({
        "full_name": row["full_name"], "country": row["country"],
        "language": row["language"], "age": row["age"], "interests": row["interests"],
    })
