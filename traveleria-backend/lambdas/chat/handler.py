from shared.auth import get_current_user
from shared.response import error, success
from shared.utils import AppError, parse_body


def lambda_handler(event, context):
    try:
        get_current_user(event)
        body = parse_body(event)
        text = body.get("text", "").lower()
        if "food" in text or "eat" in text:
            reply = "I found some great local restaurants near your location. Should I add them to your itinerary?"
        elif "weather" in text:
            reply = "The forecast for your trip looks sunny! Perfect for outdoor activities."
        else:
            reply = f"I've noted your request about '{body.get('text', '')}'. How else can I assist with your trip?"
        return success({"text": reply})
    except AppError as e:
        return error(e.message, e.status)
    except Exception as e:
        return error(str(e), 500)
