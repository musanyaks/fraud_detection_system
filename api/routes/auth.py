from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.authentication.auth import authenticate, create_access_token

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/token")
def login(body: LoginRequest):
    claims = authenticate(body.username, body.password)
    if not claims:
        raise HTTPException(401, "Invalid credentials")
    return {"access_token": create_access_token(claims), "token_type": "bearer",
            "role": claims["role"]}