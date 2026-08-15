from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Device, WaterReading
from backend.schemas import WaterReadingCreate, WaterReadingResponse

router = APIRouter(
    prefix="/readings",
    tags=["Water Readings"]
)


# --------------------------------------------------
# CREATE A NEW WATER READING
# ESP32 uses this endpoint
# --------------------------------------------------
@router.post("/", response_model=WaterReadingResponse)
def create_reading(
    reading: WaterReadingCreate,
    db: Session = Depends(get_db)
):
    # Check whether the device exists
    device = db.query(Device).filter(
        Device.id == reading.device_id
    ).first()

    if not device:
        raise HTTPException(
            status_code=404,
            detail="Device not found"
        )

    # Create new reading
    new_reading = WaterReading(
        device_id=reading.device_id,
        temperature=reading.temperature,
        ph=reading.ph,
        turbidity=reading.turbidity,
        tds=reading.tds
    )

    # Save to database
    db.add(new_reading)
    db.commit()
    db.refresh(new_reading)

    return new_reading


# --------------------------------------------------
# GET ALL WATER READINGS
# Useful for history / charts
# --------------------------------------------------
@router.get("/", response_model=list[WaterReadingResponse])
def get_readings(
    db: Session = Depends(get_db)
):
    return db.query(WaterReading).order_by(
        WaterReading.recorded_at.desc()
    ).all()


# --------------------------------------------------
# GET LATEST WATER READING
# Useful for LIVE dashboard
# --------------------------------------------------
@router.get("/latest", response_model=WaterReadingResponse)
def get_latest_reading(
    db: Session = Depends(get_db)
):
    latest = db.query(WaterReading).order_by(
        WaterReading.recorded_at.desc()
    ).first()

    if not latest:
        raise HTTPException(
            status_code=404,
            detail="No readings found"
        )

    return latest