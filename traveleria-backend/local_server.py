"""Local dev server that emulates API Gateway + the 5 Lambda functions.

Not used in production/deployment — deploy_cloudshell.sh still deploys the
real Lambdas. This just lets you hit the same handler code over plain HTTP
while developing, using the same DATABASE_URL / Cognito config from .env.

Run with:  python local_server.py
"""
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lambdas.health.handler import lambda_handler as health_handler
from lambdas.trips.handler import lambda_handler as trips_handler
from lambdas.itinerary.handler import lambda_handler as itinerary_handler
from lambdas.users.handler import lambda_handler as users_handler
from lambdas.chat.handler import lambda_handler as chat_handler

# (method, path regex, handler, API Gateway "resource" template, path param names)
ROUTES = [
    ("GET", re.compile(r"^/$"), health_handler, "/", []),
    ("GET", re.compile(r"^/trips$"), trips_handler, "/trips", []),
    ("POST", re.compile(r"^/trips$"), trips_handler, "/trips", []),
    ("GET", re.compile(r"^/trips/([^/]+)/itinerary$"), itinerary_handler,
     "/trips/{trip_id}/itinerary", ["trip_id"]),
    ("POST", re.compile(r"^/trips/([^/]+)/itinerary$"), itinerary_handler,
     "/trips/{trip_id}/itinerary", ["trip_id"]),
    ("PUT", re.compile(r"^/trips/([^/]+)/itinerary/([^/]+)$"), itinerary_handler,
     "/trips/{trip_id}/itinerary/{event_id}", ["trip_id", "event_id"]),
    ("DELETE", re.compile(r"^/trips/([^/]+)/itinerary/([^/]+)$"), itinerary_handler,
     "/trips/{trip_id}/itinerary/{event_id}", ["trip_id", "event_id"]),
    ("GET", re.compile(r"^/users/me$"), users_handler, "/users/me", []),
    ("PATCH", re.compile(r"^/users/me$"), users_handler, "/users/me", []),
    ("POST", re.compile(r"^/chat$"), chat_handler, "/chat", []),
]


class Handler(BaseHTTPRequestHandler):
    def _dispatch(self, method):
        path = urlsplit(self.path).path
        for route_method, pattern, fn, resource, param_names in ROUTES:
            if route_method != method:
                continue
            match = pattern.match(path)
            if not match:
                continue
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw_body = self.rfile.read(length).decode("utf-8") if length else None
            event = {
                "httpMethod": method,
                "resource": resource,
                "path": path,
                "pathParameters": dict(zip(param_names, match.groups())) or None,
                "headers": dict(self.headers.items()),
                "body": raw_body,
            }
            try:
                result = fn(event, None)
            except Exception as exc:
                result = {
                    "statusCode": 500,
                    "headers": {"Content-Type": "application/json"},
                    "body": json.dumps({"detail": str(exc)}),
                }
            self._send(result)
            return
        self._send({
            "statusCode": 404,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"detail": f"No route for {method} {path}"}),
        })

    def _send(self, result):
        body = (result.get("body") or "").encode("utf-8")
        self.send_response(result.get("statusCode", 200))
        for key, value in (result.get("headers") or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_PATCH(self):
        self._dispatch("PATCH")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}")


if __name__ == "__main__":
    PORT = 8000
    print(f"Traveleria local dev server on http://localhost:{PORT}")
    print("Routes: GET / | GET,POST /trips | GET,POST /trips/{trip_id}/itinerary | "
          "PUT,DELETE /trips/{trip_id}/itinerary/{event_id} | GET,PATCH /users/me | POST /chat")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
