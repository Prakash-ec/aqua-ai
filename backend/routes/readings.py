from typing import Optional

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Device, WaterReading
from backend.schemas import WaterReadingCreate, WaterReadingResponse


router = APIRouter(
    prefix="/readings",
    tags=["Water Readings"],
)


# =========================================================
# VALIDATION
# =========================================================

def validate_reading_values(reading: WaterReadingCreate) -> None:
    """Validate incoming sensor values."""

    if reading.temperature is not None:
        if not -50 <= reading.temperature <= 150:
            raise HTTPException(
                status_code=400,
                detail="Temperature must be between -50 °C and 150 °C.",
            )

    if reading.ph is not None:
        if not 0 <= reading.ph <= 14:
            raise HTTPException(
                status_code=400,
                detail="pH must be between 0 and 14.",
            )

    if reading.turbidity is not None:
        if not 0 <= reading.turbidity <= 100000:
            raise HTTPException(
                status_code=400,
                detail="Turbidity must be between 0 and 100000 NTU.",
            )

    if reading.tds is not None:
        if not 0 <= reading.tds <= 100000:
            raise HTTPException(
                status_code=400,
                detail="TDS must be between 0 and 100000 mg/L.",
            )

    if all(
        value is None
        for value in [
            reading.temperature,
            reading.ph,
            reading.turbidity,
            reading.tds,
        ]
    ):
        raise HTTPException(
            status_code=400,
            detail="At least one sensor value must be provided.",
        )


# =========================================================
# CREATE READING
# =========================================================

@router.post(
    "/",
    response_model=WaterReadingResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_reading(
    reading: WaterReadingCreate,
    db: Session = Depends(get_db),
):
    """Save a new water-quality reading."""

    validate_reading_values(reading)

    device = (
        db.query(Device)
        .filter(Device.id == reading.device_id)
        .first()
    )

    if device is None:
        raise HTTPException(
            status_code=404,
            detail="Device not found.",
        )

    new_reading = WaterReading(
        device_id=reading.device_id,
        temperature=reading.temperature,
        ph=reading.ph,
        turbidity=reading.turbidity,
        tds=reading.tds,
        # Set explicitly so saving never depends on a DB-level default.
        recorded_at=datetime.now(),
    )

    try:
        db.add(new_reading)
        db.commit()
        db.refresh(new_reading)

        return new_reading

    except SQLAlchemyError:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="Could not save the water-quality reading.",
        )


# =========================================================
# GET ALL READINGS
# =========================================================

@router.get(
    "/",
    response_model=list[WaterReadingResponse],
)
def get_readings(
    device_id: Optional[int] = Query(default=None, ge=1),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """Return recent readings, newest first."""

    query = db.query(WaterReading)

    if device_id is not None:
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

        query = query.filter(
            WaterReading.device_id == device_id
        )

    return (
        query
        .order_by(WaterReading.recorded_at.desc())
        .limit(limit)
        .all()
    )


# =========================================================
# GET LATEST READING
# =========================================================

@router.get(
    "/latest",
    response_model=WaterReadingResponse,
)
def get_latest_reading(
    device_id: Optional[int] = Query(default=None, ge=1),
    db: Session = Depends(get_db),
):
    """Return the latest reading globally or for one device."""

    query = db.query(WaterReading)

    if device_id is not None:
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

        query = query.filter(
            WaterReading.device_id == device_id
        )

    latest = (
        query
        .order_by(WaterReading.recorded_at.desc())
        .first()
    )

    if latest is None:
        raise HTTPException(
            status_code=404,
            detail="No water-quality readings found.",
        )

    return latest


# =========================================================
# GET DEVICE READINGS
# =========================================================

@router.get(
    "/device/{device_id}",
    response_model=list[WaterReadingResponse],
)
def get_device_readings(
    device_id: int,
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """Return readings belonging to a specific device."""

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

    return (
        db.query(WaterReading)
        .filter(WaterReading.device_id == device_id)
        .order_by(WaterReading.recorded_at.desc())
        .limit(limit)
        .all()
    )


# =========================================================
# GET LATEST DEVICE READING
# =========================================================

@router.get(
    "/device/{device_id}/latest",
    response_model=WaterReadingResponse,
)
def get_latest_device_reading(
    device_id: int,
    db: Session = Depends(get_db),
):
    """Return the latest reading from a specific device."""

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

    latest = (
        db.query(WaterReading)
        .filter(WaterReading.device_id == device_id)
        .order_by(WaterReading.recorded_at.desc())
        .first()
    )

    if latest is None:
        raise HTTPException(
            status_code=404,
            detail="No readings found for this device.",
        )

    return latest