import json

_CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*",
}


def success(body, status=200):
    return {"statusCode": status, "headers": _CORS, "body": json.dumps(body)}


def error(message, status=500):
    return {"statusCode": status, "headers": _CORS, "body": json.dumps({"detail": message})}
