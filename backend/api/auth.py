import logging
import re
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.database import get_db
from backend.config import settings
from backend.models.auth_event import AuthEvent
from backend.models.user import User
from backend.utils.helpers import (
    get_password_hash,
    verify_password,
    create_access_token,
    verify_token,
    oauth2_scheme,
)

logger = logging.getLogger("chess_analyzer.auth")
router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


def _client_ip(request: Request) -> Optional[str]:
    if not request.client:
        return None
    return request.client.host


async def _persist_auth_event(
    db: AsyncSession,
    request: Request,
    event_type: str,
    user: User,
) -> None:
    try:
        db.add(
            AuthEvent(
                user_id=user.id,
                event_type=event_type,
                email=user.email,
                username=user.username,
                ip_address=_client_ip(request),
                user_agent=request.headers.get("user-agent"),
            )
        )
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to persist auth event: %s", event_type)


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_-]+$")
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class GoogleAuthRequest(BaseModel):
    id_token: str = Field(..., min_length=10)


class UserResponse(BaseModel):
    id: int
    username: str
    email: str


class GoogleConfigResponse(BaseModel):
    enabled: bool
    client_id: str


def _sanitize_username(raw: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "_", raw or "")
    cleaned = cleaned.strip("_")
    return cleaned[:50] if cleaned else "user"


async def _build_unique_username(db: AsyncSession, base: str) -> str:
    normalized = _sanitize_username(base)
    if len(normalized) < 3:
        normalized = f"user_{normalized}"

    candidate = normalized[:50]
    counter = 1

    while True:
        result = await db.execute(select(User).where(User.username == candidate))
        existing = result.scalar_one_or_none()
        if not existing:
            return candidate

        suffix = f"_{counter}"
        max_base_length = max(3, 50 - len(suffix))
        candidate = f"{normalized[:max_base_length]}{suffix}"
        counter += 1


def _verify_google_id_token(token: str) -> dict:
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is not configured",
        )
    try:
        return google_id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            settings.google_client_id,
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google token",
        )
    except Exception:
        logger.exception("Google token verification failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in verification is temporarily unavailable",
        )


@router.post("/register", response_model=TokenResponse)
@limiter.limit("30/minute")
async def register(request_body: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    # Check if username already exists
    result = await db.execute(select(User).where(User.username == request_body.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already registered")

    # Check if email already exists
    result = await db.execute(select(User).where(User.email == request_body.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    # Create user
    user = User(
        username=request_body.username,
        email=request_body.email,
        hashed_password=get_password_hash(request_body.password),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # Handles race-condition duplicates gracefully.
        raise HTTPException(status_code=400, detail="Username or email already registered")
    except Exception:
        await db.rollback()
        logger.exception("Registration failed")
        raise HTTPException(status_code=500, detail="Registration failed. Please try again.")
    await db.refresh(user)
    await _persist_auth_event(db, request, "signup", user)

    logger.info(f"New user registered: {user.username}")
    token = create_access_token({"sub": str(user.id), "username": user.username})
    return TokenResponse(access_token=token)


@router.get("/google-config", response_model=GoogleConfigResponse)
async def google_config():
    return GoogleConfigResponse(
        enabled=bool(settings.google_client_id),
        client_id=settings.google_client_id or "",
    )


@router.post("/google", response_model=TokenResponse)
@limiter.limit("10/minute")
async def google_auth(request_body: GoogleAuthRequest, request: Request, db: AsyncSession = Depends(get_db)):
    payload = _verify_google_id_token(request_body.id_token)

    email = payload.get("email")
    email_verified = payload.get("email_verified")
    if not email or not email_verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account email is not verified",
        )

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    is_new_user = False

    if not user:
        base_username = payload.get("name") or email.split("@")[0]
        username = await _build_unique_username(db, base_username)
        user = User(
            username=username,
            email=email,
            # Random non-recoverable password hash for social login accounts.
            hashed_password=get_password_hash(secrets.token_urlsafe(32)),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        is_new_user = True

    await _persist_auth_event(db, request, "google_signup" if is_new_user else "google_login", user)

    logger.info("Google auth success: %s", user.username)
    token = create_access_token({"sub": str(user.id), "username": user.username})
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request_body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == request_body.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(request_body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    logger.info(f"User logged in: {user.username}")
    await _persist_auth_event(db, request, "login", user)
    token = create_access_token({"sub": str(user.id), "username": user.username})
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
):
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    payload = verify_token(token)
    user_id = payload.get("sub")

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return UserResponse(id=user.id, username=user.username, email=user.email)
