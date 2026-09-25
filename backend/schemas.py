from datetime import datetime, timezone
from typing import Annotated

from pydantic import BaseModel, ConfigDict, PlainSerializer


def _serialize_utc(value: datetime | None) -> str | None:
    """Serialize datetimes with an explicit UTC offset.

    ORM columns hold naive UTC; a bare ISO string would be parsed as
    local time by browsers, shifting displayed times by the UTC offset.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return value


UtcDateTime = Annotated[datetime, PlainSerializer(_serialize_utc, return_type=str)]


class WaterReadingCreate(BaseModel):
    device_id: int

    temperature: float | None = None
    ph: float | None = None
    turbidity: float | None = None
    tds: float | None = None


class WaterReadingResponse(WaterReadingCreate):
    id: int
    recorded_at: UtcDateTime

    model_config = ConfigDict(from_attributes=True)