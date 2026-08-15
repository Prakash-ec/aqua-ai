from datetime import datetime

from pydantic import BaseModel, ConfigDict


class WaterReadingCreate(BaseModel):
    device_id: int
    temperature: float | None = None
    ph: float | None = None
    turbidity: float | None = None
    tds: float | None = None


class WaterReadingResponse(WaterReadingCreate):
    id: int
    recorded_at: datetime

    model_config = ConfigDict(from_attributes=True)
