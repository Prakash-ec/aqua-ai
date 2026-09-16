from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Device, WaterReading
from backend.routes.auth import (
    get_current_session,
    require_device_access,
    scoped_reading_query,
)
from backend.services.water_quality import calculate_water_quality


router = APIRouter(
    prefix="/water-quality",
    tags=["Water Quality"],
)


# =========================================================
# WATER-QUALITY ANALYSIS
# =========================================================

@router.get("/latest")
def get_latest_water_quality(
    device_id: Optional[int] = None,
    session: dict = Depends(get_current_session),
    db: Session = Depends(get_db),
):
    """
    Calculate the application-specific water-quality indicator
    from the latest reading owned by the authenticated user.
    """

    try:
        query = scoped_reading_query(session, db)

        if device_id is not None:
            require_device_access(db, session, device_id)

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

        quality = calculate_water_quality(
            temperature=latest.temperature,
            ph=latest.ph,
            turbidity=latest.turbidity,
            tds=latest.tds,
        )

        return {
            "success": True,
            "device_id": latest.device_id,
            "reading_id": latest.id,
            "recorded_at": latest.recorded_at,
            "sensor_values": {
                "temperature": latest.temperature,
                "ph": latest.ph,
                "turbidity": latest.turbidity,
                "tds": latest.tds,
            },
            "quality": quality,
        }

    except HTTPException:
        raise

    except SQLAlchemyError:
        raise HTTPException(
            status_code=500,
            detail=(
                "A database error occurred while calculating "
                "water quality."
            ),
        )

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not calculate water quality.",
        )