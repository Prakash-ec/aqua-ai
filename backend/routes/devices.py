from typing import Optional

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Device
from backend.routes.auth import (
    get_current_session,
    get_optional_session,
    require_device_access,
    scoped_device_query,
)


router = APIRouter(
    prefix="/devices",
    tags=["Devices"],
)


# =========================================================
# REQUEST SCHEMAS
# =========================================================

class DeviceCreate(BaseModel):
    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
    )
    device_type: str = Field(
        default="ESP32",
        min_length=1,
        max_length=100,
    )
    location: Optional[str] = Field(
        default=None,
        max_length=200,
    )


class DeviceUpdate(BaseModel):
    name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=100,
    )
    device_type: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=100,
    )
    location: Optional[str] = Field(
        default=None,
        max_length=200,
    )


# =========================================================
# CREATE DEVICE
# =========================================================

@router.post(
    "/",
    status_code=status.HTTP_201_CREATED,
)
def create_device(
    device_data: DeviceCreate,
    session: dict | None = Depends(get_optional_session),
    db: Session = Depends(get_db),
):
    """
    Register a new ESP32 or other water-monitoring device.
    """

    try:
        existing_device = (
            db.query(Device)
            .filter(Device.name == device_data.name)
            .first()
        )

        if existing_device is not None:
            raise HTTPException(
                status_code=409,
                detail="A device with this name already exists.",
            )

        device = Device(
            name=device_data.name.strip(),
            device_type=device_data.device_type.strip(),
            location=(
                device_data.location.strip()
                if device_data.location
                else None
            ),
            user_id=(
                session.get("user_id")
                if session
                else None
            ),
            created_at=datetime.now(),
        )

        db.add(device)
        db.commit()
        db.refresh(device)

        return {
            "success": True,
            "message": "Device created successfully.",
            "device": {
                "id": device.id,
                "name": device.name,
                "device_type": device.device_type,
                "location": device.location,
                "user_id": device.user_id,
                "is_active": device.is_active,
                "created_at": device.created_at.isoformat(),
            },
        }

    except HTTPException:
        raise

    except SQLAlchemyError:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="A database error occurred while creating the device.",
        )


# =========================================================
# GET ALL DEVICES
# =========================================================

@router.get("/")
def get_devices(
    session: dict = Depends(get_current_session),
    db: Session = Depends(get_db),
):
    """
    Return devices owned by the authenticated user.

    Admins see every device. Normal users see only their own.
    """

    try:
        devices = (
            scoped_device_query(session, db)
            .order_by(Device.id.asc())
            .all()
        )

        return {
            "success": True,
            "count": len(devices),
            "devices": devices,
        }

    except SQLAlchemyError:
        raise HTTPException(
            status_code=500,
            detail="A database error occurred while fetching devices.",
        )


# =========================================================
# GET ONE DEVICE
# =========================================================

@router.get("/{device_id}")
def get_device(
    device_id: int,
    session: dict = Depends(get_current_session),
    db: Session = Depends(get_db),
):
    """
    Return one device by ID for its owner (or any device for admins).
    """

    require_device_access(db, session, device_id)

    device = (
        scoped_device_query(session, db)
        .filter(Device.id == device_id)
        .first()
    )

    if device is None:
        raise HTTPException(
            status_code=404,
            detail="Device not found.",
        )

    return {
        "success": True,
        "device": device,
    }


# =========================================================
# UPDATE DEVICE
# =========================================================

@router.put("/{device_id}")
def update_device(
    device_id: int,
    device_data: DeviceUpdate,
    session: dict = Depends(get_current_session),
    db: Session = Depends(get_db),
):
    """
    Update the details of an existing device owned by the caller.
    """

    require_device_access(db, session, device_id)

    device = (
        scoped_device_query(session, db)
        .filter(Device.id == device_id)
        .first()
    )

    if device is None:
        raise HTTPException(
            status_code=404,
            detail="Device not found.",
        )

    update_values = device_data.model_dump(
        exclude_unset=True,
    )

    if "name" in update_values:
        new_name = update_values["name"].strip()

        duplicate = (
            db.query(Device)
            .filter(
                Device.name == new_name,
                Device.id != device_id,
            )
            .first()
        )

        if duplicate is not None:
            raise HTTPException(
                status_code=409,
                detail="A device with this name already exists.",
            )

        device.name = new_name

    if "device_type" in update_values:
        device.device_type = (
            update_values["device_type"].strip()
        )

    if "location" in update_values:
        location = update_values["location"]

        device.location = (
            location.strip()
            if location is not None
            else None
        )

    try:
        db.commit()
        db.refresh(device)

        return {
            "success": True,
            "message": "Device updated successfully.",
            "device": device,
        }

    except SQLAlchemyError:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="A database error occurred while updating the device.",
        )


# =========================================================
# DELETE DEVICE
# =========================================================

@router.delete("/{device_id}")
def delete_device(
    device_id: int,
    session: dict = Depends(get_current_session),
    db: Session = Depends(get_db),
):
    """
    Delete a device owned by the caller.

    This may fail if related readings or camera records are not
    configured with database cascade behavior.
    """

    require_device_access(db, session, device_id)

    device = (
        scoped_device_query(session, db)
        .filter(Device.id == device_id)
        .first()
    )

    if device is None:
        raise HTTPException(
            status_code=404,
            detail="Device not found.",
        )

    try:
        db.delete(device)
        db.commit()

        return {
            "success": True,
            "message": "Device deleted successfully.",
            "device_id": device_id,
        }

    except SQLAlchemyError:
        db.rollback()

        raise HTTPException(
            status_code=409,
            detail=(
                "The device could not be deleted. "
                "It may contain related readings or camera records."
            ),
        )