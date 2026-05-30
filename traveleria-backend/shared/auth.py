import os

import jwt
from jwt import PyJWKClient, PyJWTError

from .database import get_db
from .utils import AppError


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is not set.")
    return value


COGNITO_REGION = _require_env("COGNITO_REGION")
COGNITO_USER_POOL_ID = _require_env("COGNITO_USER_POOL_ID")
COGNITO_APP_CLIENT_ID = _require_env("COGNITO_APP_CLIENT_ID")
COGNITO_ISSUER = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"
JWKS_URL = f"{COGNITO_ISSUER}/.well-known/jwks.json"

_jwks_client = PyJWKClient(JWKS_URL)


def _verify_token(token: str) -> dict:
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=COGNITO_APP_CLIENT_ID,
            issuer=COGNITO_ISSUER,
        )
    except PyJWTError as exc:
        raise AppError("Invalid Cognito token", status=401) from exc
    if claims.get("token_use") != "id":
        raise AppError("Expected a Cognito ID token", status=401)
    return claims


def get_current_user(event: dict) -> dict:
    """Extract and validate the Bearer token from an API Gateway event, then upsert the user."""
    headers = event.get("headers") or {}
    auth_header = headers.get("Authorization") or headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise AppError("Missing Authorization header", status=401)

    claims = _verify_token(auth_header[7:])
    cognito_sub = claims["sub"]
    email = claims.get("email") or f"{cognito_sub}@cognito.local"

    with get_db() as db:
        db.execute(
            """
            INSERT INTO users (email, cognito_sub)
            VALUES (%s, %s)
            ON CONFLICT (cognito_sub) DO UPDATE
                SET email = EXCLUDED.email, updated_at = NOW()
            RETURNING id, email, cognito_sub
            """,
            (email, cognito_sub),
        )
        user = db.fetchone()

    return {"id": user["id"], "email": user["email"], "cognito_sub": user["cognito_sub"]}
