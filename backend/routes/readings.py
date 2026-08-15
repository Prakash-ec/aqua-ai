from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Device, WaterReading
from backend.schemas import WaterReadingCreate, WaterReadingResponse

router = APIRouter(
    prefix="/readings",
    tags=["Water Readings"]
)


@router.post("/", response_model=WaterReadingResponse)
def create_reading(
    reading: WaterReadingCreate,
    db: Session = Depends(get_db)
):
    device = db.query(Device).filter(Device.id == reading.device_id).first()

    if not device:
        raise HTTPException(
            status_code=404,
            detail="Device not found"
        )

    new_reading = WaterReading(
        device_id=reading.device_id,
        temperature=reading.temperature,
        ph=reading.ph,
        turbidity=reading.turbidity,
        tds=reading.tds
    )

    db.add(new_reading)
    db.commit()
    db.refresh(new_reading)

    return new_reading


@router.get("/", response_model=list[WaterReadingResponse])
def get_readings(db: Session = Depends(get_db)):
    return db.query(WaterReading).order_by(
        WaterReading.recorded_at.desc()
    ).all()
