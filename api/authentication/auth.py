import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from common.config import settings, API_USERS

bearer = HTTPBearer(auto_error=False)


def authenticate(username: str, password: str) -> dict | None:
    # Demo-grade: constant-time compare of env-configured credentials.
    # Production: store salted hashes (bcrypt/argon2) and verify those.
    user = API_USERS.get(username)
    if user and secrets.compare_digest(str(password), str(user["password"])):
        return {"sub": username, "role": user["role"]}
    return None


def create_access_token(claims: dict) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_ttl_minutes)
    return jwt.encode({**claims, "exp": expire}, settings.jwt_secret,
                      algorithm=settings.jwt_algo)


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    try:
        return jwt.decode(creds.credentials, settings.jwt_secret,
                          algorithms=[settings.jwt_algo])
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")


def require_role(*roles):
    def checker(user: dict = Depends(get_current_user)) -> dict:
        if roles and user.get("role") not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"requires role in {roles}")
        return user
    return checker
