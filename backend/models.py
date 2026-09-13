from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


# =========================================================
# DEVICE MODEL
# =========================================================

class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
        index=True,
    )

    device_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="ESP32",
    )

    location: Mapped[str | None] = mapped_column(
        String(200),
        nullable=True,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    readings: Mapped[list["WaterReading"]] = relationship(
        "WaterReading",
        back_populates="device",
        cascade="all, delete-orphan",
    )

    camera_predictions: Mapped[
        list["CameraPrediction"]
    ] = relationship(
        "CameraPrediction",
        back_populates="device",
        cascade="all, delete-orphan",
    )


# =========================================================
# WATER READING MODEL
# =========================================================

class WaterReading(Base):
    __tablename__ = "water_readings"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    device_id: Mapped[int] = mapped_column(
        ForeignKey(
            "devices.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    temperature: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    ph: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    turbidity: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    tds: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    recorded_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        index=True,
    )

    device: Mapped["Device"] = relationship(
        "Device",
        back_populates="readings",
    )


# =========================================================
# CAMERA PREDICTION MODEL
# =========================================================

class CameraPrediction(Base):
    __tablename__ = "camera_predictions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    device_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "devices.id",
            ondelete="SET NULL",
        ),
        nullable=True,
        index=True,
    )

    image_path: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    prediction: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    confidence: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    details: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        index=True,
    )

    device: Mapped["Device | None"] = relationship(
        "Device",
        back_populates="camera_predictions",
    )