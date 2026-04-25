import os

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt import PyJWKClient, PyJWTError

from database import get_db


security = HTTPBearer(auto_error=False)

COGNITO_REGION = os.getenv("COGNITO_REGION", "us-east-1")
COGNITO_USER_POOL_ID = os.getenv("COGNITO_USER_POOL_ID", "us-east-1_hxHdB32mE")
COGNITO_APP_CLIENT_ID = os.getenv(
    "COGNITO_APP_CLIENT_ID",
    "34stji8pnkourf7ficq7prt0a0",
)
COGNITO_ISSUER = (
    f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/"
    f"{COGNITO_USER_POOL_ID}"
)
JWKS_URL = f"{COGNITO_ISSUER}/.well-known/jwks.json"
jwks_client = PyJWKClient(JWKS_URL)


def verify_cognito_token(token: str) -> dict:
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=COGNITO_APP_CLIENT_ID,
            issuer=COGNITO_ISSUER,
        )
    except PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid Cognito token") from exc

    if claims.get("token_use") != "id":
        raise HTTPException(status_code=401, detail="Expected a Cognito ID token")

    return claims


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    claims = verify_cognito_token(credentials.credentials)
    cognito_sub = claims["sub"]
    email = claims.get("email") or f"{cognito_sub}@cognito.local"

    with get_db() as db:
        db.execute(
            """
            INSERT INTO users (email, cognito_sub)
            VALUES (%s, %s)
            ON CONFLICT (cognito_sub) DO UPDATE
                SET email = EXCLUDED.email,
                    updated_at = NOW()
            RETURNING id, email, cognito_sub
            """,
            (email, cognito_sub),
        )
        user = db.fetchone()

    return {
        "id": user["id"],
        "email": user["email"],
        "cognito_sub": user["cognito_sub"],
    }
