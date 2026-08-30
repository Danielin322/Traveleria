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


# Interests are an open set — the picker offers presets, but "Other" lets the
# user type anything — so there is no allow-list to check against, and no CHECK
# constraint in sql/005_user_interests.sql. These caps are what stands in for
# one: they keep a runaway client from filling the column with junk.
MAX_INTERESTS = 20
MAX_INTEREST_LENGTH = 30


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


def _clean_interests(body):
    """
    Absent means "leave unchanged". An empty list DOES clear the selection,
    matching _clean_dietary — an empty array is not NULL, so it survives the
    COALESCE in the UPDATE.

    Unlike dietary, entries are not checked against a fixed set: anything the
    user types under "Other" is valid. Only shape and size are enforced.
    """
    if "interests" not in body:
        return None
    interests = body.get("interests")
    if interests is None:
        return None
    if not isinstance(interests, list):
        raise AppError("interests must be a list of values")
    if len(interests) > MAX_INTERESTS:
        raise AppError(f"Please choose {MAX_INTERESTS} interests or fewer")

    cleaned = []
    for raw in interests:
        if not isinstance(raw, str):
            raise AppError("Each interest must be text")
        value = raw.strip()
        if not value:
            continue
        if len(value) > MAX_INTEREST_LENGTH:
            raise AppError(
                f"Interests must be {MAX_INTEREST_LENGTH} characters or fewer: {value[:40]}"
            )
        # Control characters never belong in a user-typed label, and would
        # render as invisible junk in the chip.
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
            raise AppError("Interests cannot contain line breaks or control characters")
        cleaned.append(value)

    # De-duplicate case-insensitively, keeping the order and the casing the
    # user picked them in.
    seen = set()
    unique = []
    for value in cleaned:
        key = value.casefold()
        if key not in seen:
            seen.add(key)
            unique.append(value)
    return unique


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
        "age": row["age"], "interests": row["interests"] or [],
        "gender": row["gender"], "dietary": row["dietary"] or [],
        "trips_count": row["trips_count"],
    })


def _update_profile(event, current_user):
    body = parse_body(event)
    gender = _clean_gender(body)
    dietary = _clean_dietary(body)
    interests = _clean_interests(body)
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
             body.get("age"), interests, gender, dietary,
             current_user["id"]),
        )
        row = db.fetchone()
    return success({
        "full_name": row["full_name"], "country": row["country"],
        "language": row["language"], "age": row["age"],
        "interests": row["interests"] or [], "gender": row["gender"],
        "dietary": row["dietary"] or [],
    })
