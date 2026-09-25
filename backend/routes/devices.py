from typing import Optional

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.database import get_db, utc_iso
from backend.models import Alert, Device, WaterReading


router = APIRouter(
    prefix="/devices",
    tags=["Devices"],
)


def _device_dict(device) -> dict:
    """Serialize a device with an explicit UTC offset on timestamps."""
    return {
        "id": device.id,
        "name": device.name,
        "device_type": device.device_type,
        "location": device.location,
        "user_id": device.user_id,
        "is_active": device.is_active,
        "created_at": utc_iso(device.created_at),
    }


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


def _clean_name(value: str | None) -> str | None:
    """Strip whitespace; whitespace-only becomes empty string."""
    if value is None:
        return None
    return value.strip()


def _clean_location(value: str | None) -> str | None:
    """Strip whitespace; empty/whitespace-only becomes None."""
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


# =========================================================
# CREATE DEVICE
# =========================================================

@router.post(
    "/",
    status_code=status.HTTP_201_CREATED,
)
def create_device(
    device_data: DeviceCreate,
    db: Session = Depends(get_db),
):
    """
    Register a new ESP32 or other water-monitoring device.

    No authentication required — public API for demo/local use.
    """

    name = _clean_name(device_data.name)
    if not name:
        raise HTTPException(
            status_code=422,
            detail="Device name must not be empty or whitespace only.",
        )

    device_type = _clean_name(device_data.device_type)
    if not device_type:
        raise HTTPException(
            status_code=422,
            detail="Device type must not be empty or whitespace only.",
        )

    location = _clean_location(device_data.location)

    try:
        existing_device = (
            db.query(Device)
            .filter(Device.name == name)
            .first()
        )

        if existing_device is not None:
            raise HTTPException(
                status_code=409,
                detail="A device with this name already exists.",
            )

        device = Device(
            name=name,
            device_type=device_type,
            location=location,
            user_id=None,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
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
                "created_at": utc_iso(device.created_at),
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
    db: Session = Depends(get_db),
):
    """
    Return all devices.

    No authentication required — public API for demo/local use.
    """

    try:
        devices = (
            db.query(Device)
            .order_by(Device.id.asc())
            .all()
        )

        return {
            "success": True,
            "count": len(devices),
            "devices": [_device_dict(d) for d in devices],
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
    db: Session = Depends(get_db),
):
    """
    Return one device by ID.

    No authentication required — public API for demo/local use.
    """

    device = (
        db.query(Device)
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
        "device": _device_dict(device),
    }


# =========================================================
# UPDATE DEVICE
# =========================================================

@router.put("/{device_id}")
def update_device(
    device_id: int,
    device_data: DeviceUpdate,
    db: Session = Depends(get_db),
):
    """
    Update the details of an existing device.

    No authentication required — public API for demo/local use.
    """

    device = (
        db.query(Device)
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
        new_name = _clean_name(update_values["name"])
        if not new_name:
            raise HTTPException(
                status_code=422,
                detail="Device name must not be empty or whitespace only.",
            )

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
        new_type = _clean_name(update_values["device_type"])
        if not new_type:
            raise HTTPException(
                status_code=422,
                detail="Device type must not be empty or whitespace only.",
            )
        device.device_type = new_type

    if "location" in update_values:
        device.location = _clean_location(update_values["location"])

    try:
        db.commit()
        db.refresh(device)

        return {
            "success": True,
            "message": "Device updated successfully.",
            "device": _device_dict(device),
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
    db: Session = Depends(get_db),
):
    """
    Delete a device and its device-owned data.

    No authentication required — public API for demo/local use.

    Deletion policy (matches models.py relationships):
    - water_readings for this device are deleted (CASCADE / delete-orphan).
    - camera_predictions for this device are deleted (delete-orphan).
    - alerts are preserved as history with device_id set to NULL
      (SET NULL), so deleting a device never destroys alert history.
    After deletion, readings ingestion with the deleted device ID
    returns 404 and no reading is stored.
    """

    device = (
        db.query(Device)
        .filter(Device.id == device_id)
        .first()
    )

    if device is None:
        raise HTTPException(
            status_code=404,
            detail="Device not found.",
        )

    try:
        # Preserve alert history explicitly (portable across databases —
        # does not rely on the DB enforcing ON DELETE SET NULL).
        db.query(Alert).filter(Alert.device_id == device_id).update(
            {"device_id": None},
            synchronize_session=False,
        )
        reading_ids = [
            row[0]
            for row in db.query(WaterReading.id)
            .filter(WaterReading.device_id == device_id)
            .all()
        ]
        if reading_ids:
            db.query(Alert).filter(Alert.reading_id.in_(reading_ids)).update(
                {"reading_id": None},
                synchronize_session=False,
            )

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