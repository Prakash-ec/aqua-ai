"""
Aqua AI Authentication Routes
------------------------------
Professional Admin Login system with session-based authentication.

Endpoints:
- POST /auth/login          — Admin login with username/password
- POST /auth/logout         — Logout current session
- GET  /auth/session        — Get current session info
- GET  /auth/me             — Get current user details (session check)
"""

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import (
    CameraPrediction,
    Device,
    User,
    UserSession,
    WaterReading,
)

load_dotenv()

router = APIRouter(prefix="/auth", tags=["authentication"])

# ---------------------------------------------------------------------------
# Password hashing (bcrypt directly, no passlib dependency)
# ---------------------------------------------------------------------------

BCRYPT_ROUNDS = int(os.getenv("BCRYPT_ROUNDS", "12").strip() or "12")
# Clamp rounds to a safe range
BCRYPT_ROUNDS = max(4, min(BCRYPT_ROUNDS, 16))


def hash_password(plain_password: str) -> str:
    """Hash a password using bcrypt."""
    if not plain_password:
        raise ValueError("password must not be empty")
    # bcrypt has a 72-byte limit; pre-hash long passwords with SHA-256
    password_bytes = _prepare_password_bytes(plain_password)
    return bcrypt.hashpw(password_bytes, bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a bcrypt hash."""
    if not plain_password or not hashed_password:
        return False
    try:
        password_bytes = _prepare_password_bytes(plain_password)
        return bcrypt.checkpw(password_bytes, hashed_password.encode("utf-8"))
    except Exception:
        return False


def _prepare_password_bytes(password: str) -> bytes:
    """Prepare password bytes for bcrypt, handling the 72-byte limit."""
    encoded = password.encode("utf-8")
    if len(encoded) > 72:
        # Pre-hash with SHA-256 to handle passwords longer than 72 bytes
        encoded = hashlib.sha256(encoded).digest()
    return encoded


# ---------------------------------------------------------------------------
# Database-backed session management with Remember Me support
# ---------------------------------------------------------------------------

DEFAULT_SESSION_HOURS = 24
REMEMBER_ME_SESSION_DAYS = 30


def _compute_expires_at(remember_me: bool = False) -> datetime:
    """Return session expiry time based on Remember Me flag and env config."""
    if remember_me:
        days = REMEMBER_ME_SESSION_DAYS
        try:
            days = int(os.getenv("REMEMBER_ME_DAYS", str(days)).strip() or str(days))
            if days <= 0:
                days = REMEMBER_ME_SESSION_DAYS
            if days > 90:
                days = 90
        except (ValueError, TypeError):
            days = REMEMBER_ME_SESSION_DAYS
        return datetime.now(timezone.utc) + timedelta(days=days)

    try:
        hours = float(os.getenv("AUTH_SESSION_HOURS", str(DEFAULT_SESSION_HOURS)).strip() or str(DEFAULT_SESSION_HOURS))
        if hours <= 0:
            hours = DEFAULT_SESSION_HOURS
        if hours > 168:
            hours = 168
    except (ValueError, TypeError):
        hours = DEFAULT_SESSION_HOURS
    return datetime.now(timezone.utc) + timedelta(hours=hours)


def _hash_token(token: str) -> str:
    """Hash a session token for database storage using SHA-256."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session_token(
    user: User,
    db: Session,
    remember_me: bool = False,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> str:
    """
    Create a new database-backed session for a user and return the raw token.

    Only a SHA-256 hash of the token is stored in the database so a database
    leak does not expose live session tokens.
    """
    raw_token = secrets.token_urlsafe(48)
    token_hash = _hash_token(raw_token)
    expires_at = _compute_expires_at(remember_me)

    session = UserSession(
        user_id=user.id,
        session_token_hash=token_hash,
        expires_at=expires_at,
        remember_me=remember_me,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(session)
    db.commit()
    return raw_token


def validate_session_token(token: str, db: Session | None = None) -> dict | None:
    """
    Validate a session token and return a session dict, or None.

    For Remember Me sessions the expiry is extended on every successful
    validation (sliding window) so active users are not logged out.
    """
    if not token or not isinstance(token, str) or db is None:
        return None

    token_hash = _hash_token(token)
    # Use naive UTC now because the DateTime column stores naive datetimes.
    now = datetime.utcnow()

    user_session = db.execute(
        select(UserSession).where(
            UserSession.session_token_hash == token_hash,
            UserSession.is_revoked == False,
        )
    ).scalar_one_or_none()

    if user_session is None:
        return None

    # Expired?
    if user_session.expires_at <= now:
        user_session.is_revoked = True
        db.commit()
        return None

    # Remember Me: extend expiry on activity (sliding window)
    if user_session.remember_me:
        user_session.expires_at = _compute_expires_at(remember_me=True)

    user_session.last_used_at = now  # already naive UTC from datetime.utcnow()
    db.commit()

    return {
        "user_id": user_session.user_id,
        "username": user_session.user.username,
        "full_name": user_session.user.full_name,
        "email": user_session.user.email,
        "is_admin": user_session.user.is_admin,
        "is_active": user_session.user.is_active,
        "session_id": user_session.id,
        "remember_me": user_session.remember_me,
        "expires_at": user_session.expires_at.isoformat(),
    }


def revoke_session(token: str, db: Session) -> bool:
    """Revoke a session by its raw token. Returns True if a session was found."""
    if not token:
        return False
    token_hash = _hash_token(token)
    user_session = db.execute(
        select(UserSession).where(UserSession.session_token_hash == token_hash)
    ).scalar_one_or_none()
    if user_session is None:
        return False
    user_session.is_revoked = True
    db.commit()
    return True


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    username: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Admin username",
    )
    password: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Admin password",
    )
    remember_me: bool = Field(
        default=False,
        description="Whether to create a long-lived Remember Me session",
    )


class LoginResponse(BaseModel):
    success: bool
    username: str
    full_name: str | None = None
    email: str | None = None
    is_admin: bool
    expires_at: str


class SessionResponse(BaseModel):
    authenticated: bool
    username: str | None = None
    full_name: str | None = None
    email: str | None = None
    is_admin: bool = False
    expires_at: str | None = None


class MeResponse(BaseModel):
    id: int
    username: str
    full_name: str | None = None
    email: str | None = None
    is_admin: bool
    is_active: bool
    created_at: str


# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------

AUTH_COOKIE_NAME = "aqua_auth_token"
AUTH_COOKIE_PATH = "/"
AUTH_COOKIE_HTTP_ONLY = True
# Secure flag: True in production (HTTPS), False in development (HTTP)
_auth_secure_env = os.getenv("AUTH_COOKIE_SECURE", "").strip().lower()
if _auth_secure_env in ("1", "true", "yes", "on"):
    AUTH_COOKIE_SECURE = True
elif _auth_secure_env in ("0", "false", "no", "off"):
    AUTH_COOKIE_SECURE = False
else:
    # Auto-detect: secure if ENVIRONMENT=production
    AUTH_COOKIE_SECURE = os.getenv("ENVIRONMENT", "development").strip().lower() == "production"
AUTH_COOKIE_SAMESITE = os.getenv(
    "AUTH_COOKIE_SAMESITE",
    # "lax" is correct when the frontend is served from the same site as the
    # API. A frontend on a different site (for example a local dev server on
    # http://127.0.0.1:5500 calling the Render backend) does NOT receive a
    # Lax cookie, so the session would be lost immediately after login.
    # Browsers only accept SameSite=None together with Secure=True, so the
    # default follows the Secure flag and stays "lax" for local HTTP.
    "none" if AUTH_COOKIE_SECURE else "lax",
).strip().lower()
# Validate SameSite value
if AUTH_COOKIE_SAMESITE not in ("strict", "lax", "none"):
    AUTH_COOKIE_SAMESITE = "lax"
# Partitioned (CHIPS): key the cookie jar by top-level site so the session
# cookie keeps working for cross-site API calls once browsers block
# third-party cookies by default. The CHIPS spec only accepts the attribute
# for Secure cookies with SameSite=None, so it follows both flags.
AUTH_COOKIE_PARTITIONED = (
    AUTH_COOKIE_SECURE and AUTH_COOKIE_SAMESITE == "none"
)


def _emit_partitioned(response: Response) -> None:
    """
    Append the CHIPS ``Partitioned`` attribute to the last Set-Cookie header.

    Starlette can only emit ``Partitioned`` on Python 3.14+, but Render runs
    3.11, so the attribute is appended to the raw header instead. It is a
    pure extension attribute: browsers that understand it partition the
    cookie per top-level site (keeping cross-site sessions alive under
    third-party-cookie blocking) and older clients simply ignore it.
    """
    if not AUTH_COOKIE_PARTITIONED:
        return
    for index in range(len(response.raw_headers) - 1, -1, -1):
        name, value = response.raw_headers[index]
        if name.lower() == b"set-cookie":
            if b"; Partitioned" not in value:
                response.raw_headers[index] = (
                    name,
                    value.rstrip().rstrip(b";") + b"; Partitioned",
                )
            return


def _set_auth_cookie(response: Response, token: str, remember_me: bool = False) -> None:
    """Set the auth cookie with a max_age matching the session expiry."""
    expires_at = _compute_expires_at(remember_me)
    max_age = int(os.getenv(
        "AUTH_SESSION_MAX_AGE_SECONDS",
        str(int((expires_at - datetime.now(timezone.utc)).total_seconds())),
    ))
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        path=AUTH_COOKIE_PATH,
        httponly=AUTH_COOKIE_HTTP_ONLY,
        secure=AUTH_COOKIE_SECURE,
        samesite=AUTH_COOKIE_SAMESITE,
        max_age=max_age,
    )
    _emit_partitioned(response)


def _clear_auth_cookie(response: Response) -> None:
    # Use set_cookie directly (not delete_cookie) so that a Partitioned
    # cookie can be cleared from the same partitioned jar it was created in.
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value="",
        path=AUTH_COOKIE_PATH,
        httponly=AUTH_COOKIE_HTTP_ONLY,
        secure=AUTH_COOKIE_SECURE,
        samesite=AUTH_COOKIE_SAMESITE,
        max_age=0,
        expires=0,
    )
    _emit_partitioned(response)


def _extract_token(request: Request) -> str | None:
    """Extract session token from Authorization header or cookie."""
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return request.cookies.get(AUTH_COOKIE_NAME)


# ---------------------------------------------------------------------------
# Dependency: get current session
# ---------------------------------------------------------------------------


async def get_current_session(
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    """Dependency that returns the current session or raises 401."""
    token = _extract_token(request)
    session = validate_session_token(token, db) if token else None
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return session


async def get_current_admin(session: dict = Depends(get_current_session)) -> dict:
    """Dependency that returns the session only for admin users."""
    if not session.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    if not session.get("is_active"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )
    return session


async def get_optional_session(
    request: Request,
    db: Session = Depends(get_db),
) -> dict | None:
    """
    Dependency that returns the current session when one is valid, or None.

    Unlike ``get_current_session`` this never raises 401, so it can be used
    to attach ownership information without requiring every endpoint to be
    behind a login wall.
    """
    token = _extract_token(request)
    return validate_session_token(token, db) if token else None

# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Authenticate an admin user with username and password.

    On success the session token is stored in an HttpOnly cookie.
    The token is NOT returned in the response body for security.

    When ``remember_me`` is ``True`` the session lasts REMEMBER_ME_DAYS
    (default 30) instead of AUTH_SESSION_HOURS (default 24) and the expiry
    is extended on every request (sliding window).
    """
    user = db.execute(
        select(User).where(User.username == body.username)
    ).scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )

    token = create_session_token(
        user,
        db,
        remember_me=body.remember_me,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    _set_auth_cookie(response, token, remember_me=body.remember_me)

    # Update last_login timestamp (naive UTC to match DateTime column)
    user.last_login = datetime.utcnow()
    db.commit()

    expires_at = _compute_expires_at(body.remember_me)
    return LoginResponse(
        success=True,
        username=user.username,
        full_name=user.full_name,
        email=user.email,
        is_admin=user.is_admin,
        expires_at=expires_at.isoformat(),
    )

# ---------------------------------------------------------------------------
# Single-user initialization (prakash)
# ---------------------------------------------------------------------------


def ensure_prakash_user(db: Session) -> User:
    """
    Create or update the single admin user ``prakash``.

    The bootstrap password is read from the ``AUTH_BOOTSTRAP_PASSWORD``
    environment variable. On every startup the stored hash is refreshed
    from that variable so the configured password always wins. The
    environment variable must be set — the application refuses to start
    if it is missing.
    """
    bootstrap_password = os.getenv("AUTH_BOOTSTRAP_PASSWORD", "")

    if not bootstrap_password.strip():
        raise RuntimeError(
            "AUTH_BOOTSTRAP_PASSWORD must be set to bootstrap the admin user."
        )

    hashed = hash_password(bootstrap_password)

    user = db.execute(
        select(User).where(User.username == "prakash")
    ).scalar_one_or_none()

    if user is None:
        user = User(
            username="prakash",
            hashed_password=hashed,
            full_name="Administrator",
            email=None,
            is_admin=True,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    else:
        # Idempotent: refresh the hash every startup so that the
        # configured password always wins over any legacy value.
        user.hashed_password = hashed
        user.is_admin = True
        user.is_active = True
        db.add(user)
        db.commit()

    return user



@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Invalidate the current session and clear the auth cookie.

    This endpoint does NOT require a valid session.  It always succeeds:
    if a valid session token is present it is revoked, and the cookie is
    cleared regardless.  This means logout works even when the session
    has already expired or was revoked elsewhere.
    """
    token = _extract_token(request)
    if token:
        revoke_session(token, db)
    _clear_auth_cookie(response)
    return {"success": True, "message": "Logged out"}


@router.get("/session", response_model=SessionResponse)
async def get_session(
    request: Request,
    session: dict = Depends(get_current_session),
):
    """Return the current session info (requires authentication)."""
    return SessionResponse(
        authenticated=True,
        username=session.get("username"),
        full_name=session.get("full_name"),
        email=session.get("email"),
        is_admin=session.get("is_admin", False),
        expires_at=session.get("expires_at"),
    )


@router.get("/me", response_model=MeResponse)
async def get_me(
    request: Request,
    session: dict = Depends(get_current_session),
    db: Session = Depends(get_db),
):
    """Return the full profile of the currently authenticated user."""
    user = db.execute(
        select(User).where(User.username == session.get("username"))
    ).scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session user not found",
        )

    return MeResponse(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        email=user.email,
        is_admin=user.is_admin,
        is_active=user.is_active,
        created_at=user.created_at.isoformat(),
    )


# =========================================================================
# USER REGISTRATION
# =========================================================================

class RegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=255)
    username: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=8, max_length=200)
    confirm_password: str = Field(..., min_length=8, max_length=200)


@router.post("/register")
async def register(
    body: RegisterRequest,
    db: Session = Depends(get_db),
):
    """
    Registration is disabled in this single-user deployment.
    """
    raise HTTPException(
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        detail="Registration is disabled in this deployment.",
        headers={"Allow": ""},
    )


# =========================================================================
# OWNERSHIP / ACCESS HELPERS
# =========================================================================

def _owns_device(db: Session, user_id: int, device_id: int | None) -> bool:
    """Return True when ``user_id`` owns ``device_id`` (or it is unset)."""
    if device_id is None:
        return True
    device = (
        db.execute(
            select(Device).where(Device.id == device_id)
        ).scalar_one_or_none()
    )
    if device is None:
        return True  # let the route produce its 404 "Device not found"
    return device.user_id == user_id


def require_device_access(
    db: Session,
    session: dict,
    device_id: int | None,
) -> None:
    """
    Enforce per-user device isolation.

    Admins pass through silently.  A normal user requesting a device owned
    by someone else receives HTTP 404 (not 403) so that device existence
    is not revealed.
    """
    if session.get("is_admin"):
        return
    if not _owns_device(
        db,
        user_id=session.get("user_id"),
        device_id=device_id,
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found.",
        )


async def require_reading_access(
    db: Session,
    session: dict,
    reading: WaterReading,
) -> None:
    """Enforce ownership for a single stored reading."""
    if session.get("is_admin"):
        return
    if reading.user_id != session.get("user_id"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reading not found.",
        )


def scoped_device_query(session: dict, db: Session):
    """Return a Device query limited to the session owner unless admin."""
    query = db.query(Device)
    if not session.get("is_admin"):
        query = query.filter(Device.user_id == session.get("user_id"))
    return query


def scoped_reading_query(session: dict, db: Session):
    """Return a WaterReading query limited to the session owner unless admin."""
    query = db.query(WaterReading)
    if not session.get("is_admin"):
        query = query.filter(WaterReading.user_id == session.get("user_id"))
    return query


def scoped_camera_query(session: dict, db: Session):
    """Return a CameraPrediction query scoped to the owner unless admin."""
    query = db.query(CameraPrediction)
    if not session.get("is_admin"):
        query = query.filter(
            CameraPrediction.user_id == session.get("user_id")
        )
    return query

