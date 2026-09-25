"""
Aqua AI — Administrator routes (public for demo/local use).

Endpoint           Description
-----------------  -------------------------------------------
GET  /admin/users  List registered users (no password data)
GET  /admin/stats  High-level platform statistics
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.database import get_db, utc_iso
from backend.models import User
from backend.services.ai_provider import get_provider_debug_info


router = APIRouter(
    prefix="/admin",
    tags=["Admin"],
)


class UserStatusUpdate(BaseModel):
    is_active: bool


class UserAdminOut(BaseModel):
    id: int
    username: str
    full_name: str | None = None
    email: str | None = None
    is_admin: bool
    is_active: bool
    created_at: str | None = None

    class Config:
        from_attributes = True


def _serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "email": user.email,
        "is_admin": user.is_admin,
        "is_active": user.is_active,
        "created_at": utc_iso(user.created_at),
    }


@router.get("/users")
def list_users(
    db: Session = Depends(get_db),
):
    """Return all registered users. Password hashes are never included.

    No authentication required — public API for demo/local use.
    """
    users = db.execute(
        select(User).order_by(User.id.asc())
    ).scalars().all()

    return {
        "success": True,
        "count": len(users),
        "users": [_serialize_user(user) for user in users],
    }


@router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: int,
    payload: UserStatusUpdate,
    db: Session = Depends(get_db),
):
    """Enable or disable a user account.

    No authentication required — public API for demo/local use.
    """
    user = db.execute(
        select(User).where(User.id == user_id)
    ).scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    user.is_active = payload.is_active
    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "success": True,
        "message": (
            "User enabled." if payload.is_active else "User disabled."
        ),
        "user": _serialize_user(user),
    }


@router.get("/stats")
def admin_stats(
    db: Session = Depends(get_db),
):
    """High-level platform statistics for the admin dashboard.

    No authentication required — public API for demo/local use.
    """
    from backend.models import CameraPrediction, Device, UserSession, WaterReading

    users = db.execute(select(User)).scalars().all()
    total_users = len(users)
    active_users = sum(1 for u in users if u.is_active)
    admin_users = sum(1 for u in users if u.is_admin)

    total_devices = db.execute(
        select(func.count(Device.id))
    ).scalar() or 0
    total_readings = db.execute(
        select(func.count(WaterReading.id))
    ).scalar() or 0
    total_predictions = db.execute(
        select(func.count(CameraPrediction.id))
    ).scalar() or 0
    active_sessions = db.execute(
        select(func.count(UserSession.id)).where(
            UserSession.is_revoked == False,  # noqa: E712
            UserSession.expires_at > datetime.utcnow(),
        )
    ).scalar() or 0

    # Devices considered online: latest reading within the last 15 minutes.
    online_cutoff = datetime.utcnow() - timedelta(minutes=15)
    online_devices = 0
    devices = db.execute(select(Device)).scalars().all()
    for device in devices:
        last = db.execute(
            select(WaterReading.recorded_at)
            .where(WaterReading.device_id == device.id)
            .order_by(WaterReading.recorded_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if last is not None:
            last_dt = last if isinstance(last, datetime) else None
            if last_dt is not None and last_dt.tzinfo is None:
                online_devices += 1 if last_dt >= online_cutoff else 0

    return {
        "success": True,
        "users": {
            "total": total_users,
            "active": active_users,
            "disabled": total_users - active_users,
            "admins": admin_users,
        },
        "devices": {
            "total": total_devices,
            "online_recent": online_devices,
        },
        "readings_total": total_readings,
        "camera_predictions_total": total_predictions,
        "active_sessions": active_sessions,
        "providers": get_provider_debug_info(),
    }