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
        _claim_invitations(db, user["id"], user["email"])

    return {"id": user["id"], "email": user["email"], "cognito_sub": user["cognito_sub"]}


def _claim_invitations(db, user_id, email: str) -> None:
    """
    Attach this user to any trip invitation addressed to their email.

    A trip can be shared with someone who has no account yet, so the invitation
    is stored against the address alone and picked up the first time that
    address signs in. It runs on every authenticated request and matches
    nothing at all in the overwhelming majority of them, which
    idx_trip_collaborators_email_unclaimed makes cheap.

    Note what this deliberately does NOT touch: `status`. Claiming means "this
    invitation now has a person attached", not "this person is on the trip".
    Access still requires them to accept it, which is a separate act on a
    separate screen.

    The email here is the verified Cognito one. When the token carries no email
    claim, get_current_user substitutes {sub}@cognito.local — a synthetic
    address that can never match a real invitation, so the fallback is safe.
    """
    db.execute(
        """
        UPDATE trip_collaborators
        SET user_id = %s
        WHERE user_id IS NULL AND email = LOWER(%s)
        """,
        (user_id, email),
    )
