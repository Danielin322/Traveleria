from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import AppError, parse_body

# Mirrors traveleria/constants/profileOptions.ts and the CHECK constraints in
# sql/004_user_preferences.sql. Validating here as well as in the database gives
# the client a readable error instead of a raw constraint violation.
GENDER_VALUES = {"male", "female", "non_binary", "prefer_not_to_say"}

DIETARY_VALUES = {
    "vegetarian",
    "vegan",
    "pescatarian",
    "keto",
    "halal",
    "kosher",
    "gluten_free",
    "lactose_intolerant",
    "nut_allergy",
}


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


def _clean_gender(body):
    """
    Returns None to mean "leave unchanged", since the UPDATE below uses
    COALESCE. Clearing gender back to NULL is deliberately not supported:
    the picker offers "prefer_not_to_say" for declining, and it has no
    deselect affordance, so the client never needs to unset it.
    """
    gender = body.get("gender")
    if gender in (None, ""):
        return None
    if gender not in GENDER_VALUES:
        raise AppError(f"Invalid gender value: {gender}")
    return gender


def _clean_dietary(body):
    """
    Absent means "leave unchanged". An empty list DOES clear the selection,
    because an empty array is not NULL and so survives the COALESCE.
    """
    if "dietary" not in body:
        return None
    dietary = body.get("dietary")
    if dietary is None:
        return None
    if not isinstance(dietary, list):
        raise AppError("dietary must be a list of values")
    invalid = [d for d in dietary if d not in DIETARY_VALUES]
    if invalid:
        raise AppError(f"Invalid dietary values: {', '.join(map(str, invalid))}")
    # De-duplicate while preserving the order the user picked them in.
    return list(dict.fromkeys(dietary))


def _get_profile(current_user):
    with get_db() as db:
        db.execute(
            """
            SELECT full_name, country, language, age, interests, gender, dietary,
                   (SELECT COUNT(*) FROM trips WHERE owner_user_id = %s) AS trips_count
            FROM users WHERE id = %s
            """,
            (current_user["id"], current_user["id"]),
        )
        row = db.fetchone()
    return success({
        "email": current_user["email"], "full_name": row["full_name"],
        "country": row["country"], "language": row["language"],
        "age": row["age"], "interests": row["interests"],
        "gender": row["gender"], "dietary": row["dietary"] or [],
        "trips_count": row["trips_count"],
    })


def _update_profile(event, current_user):
    body = parse_body(event)
    gender = _clean_gender(body)
    dietary = _clean_dietary(body)
    with get_db() as db:
        db.execute(
            """
            UPDATE users
            SET full_name=COALESCE(%s, full_name), country=COALESCE(%s, country),
                language=COALESCE(%s, language), age=COALESCE(%s, age),
                interests=COALESCE(%s, interests), gender=COALESCE(%s, gender),
                dietary=COALESCE(%s, dietary), updated_at=NOW()
            WHERE id=%s
            RETURNING full_name, country, language, age, interests, gender, dietary
            """,
            (body.get("full_name"), body.get("country"), body.get("language"),
             body.get("age"), body.get("interests"), gender, dietary,
             current_user["id"]),
        )
        row = db.fetchone()
    return success({
        "full_name": row["full_name"], "country": row["country"],
        "language": row["language"], "age": row["age"],
        "interests": row["interests"], "gender": row["gender"],
        "dietary": row["dietary"] or [],
    })
