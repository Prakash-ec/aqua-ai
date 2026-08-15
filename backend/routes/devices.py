from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Device

router = APIRouter(
    prefix="/devices",
    tags=["Devices"]
)


@router.post("/")
def create_device(
    name: str,
    device_type: str,
    location: str | None = None,
    db: Session = Depends(get_db)
):
    device = Device(
        name=name,
        device_type=device_type,
        location=location
    )

    db.add(device)
    db.commit()
    db.refresh(device)

    return {
        "id": device.id,
        "name": device.name,
        "device_type": device.device_type,
        "location": device.location
    }


@router.get("/")
def get_devices(db: Session = Depends(get_db)):
    devices = db.query(Device).all()

    return [
        {
            "id": device.id,
            "name": device.name,
            "device_type": device.device_type,
            "location": device.location
        }
        for device in devices
    ]
