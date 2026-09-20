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

    # Ownership: the user that registered this device. Nullable so existing
    # devices and the seeded admin backfill are not forced to change.
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
        ),
        nullable=True,
        index=True,
    )

    # SHA-256 hash of the device API token used by the ESP32 to ingest
    # readings. The raw token is shown once at creation and never stored.
    token_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        index=True,
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

    user: Mapped["User | None"] = relationship(
        "User",
        back_populates="devices",
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

    # The user who owns the device this reading belongs to (derived at insert).
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
        ),
        nullable=True,
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

    # Ownership: the user who requested this analysis.
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "users.id",
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


# =========================================================
# USER / ADMIN MODEL
# =========================================================

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    username: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
        index=True,
    )

    hashed_password: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    full_name: Mapped[str | None] = mapped_column(
        String(200),
        nullable=True,
        default=None,
    )

    email: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        default=None,
    )

    is_admin: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
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

    last_login: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
        default=None,
    )

    # Relationships for per-user ownership.
    devices: Mapped[list["Device"]] = relationship(
        "Device",
        back_populates="user",
    )


# =========================================================
# ALERT CONTACT MODEL
# =========================================================

class AlertContact(Base):
    __tablename__ = "alert_contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=True)
    # Legacy SMS columns remain in DB but are no longer used
    phone_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sms_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="TRUE")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="TRUE")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


# =========================================================
# ALERT MODEL
# =========================================================

class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True)
    reading_id: Mapped[int | None] = mapped_column(ForeignKey("water_readings.id", ondelete="SET NULL"), nullable=True, index=True)
    parameter: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="critical")
    current_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    threshold_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    email_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sms_status: Mapped[str | None] = mapped_column(String(20), nullable=True)

    device: Mapped["Device | None"] = relationship("Device")
    reading: Mapped["WaterReading | None"] = relationship("WaterReading")


# =========================================================
# ALERT CONFIGURATION MODEL
# =========================================================

class AlertConfiguration(Base):
    __tablename__ = "alert_configuration"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ph_min: Mapped[float] = mapped_column(Float, nullable=False, default=5.5)
    ph_max: Mapped[float] = mapped_column(Float, nullable=False, default=9.0)
    turbidity_max: Mapped[float] = mapped_column(Float, nullable=False, default=10.0)
    tds_max: Mapped[float] = mapped_column(Float, nullable=False, default=1500.0)
    temperature_max: Mapped[float] = mapped_column(Float, nullable=False, default=40.0)
    cooldown_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    alerts_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


# =========================================================
# USER SESSION MODEL (for database-backed sessions)
# =========================================================


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    session_token_hash: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        unique=True,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        index=True,
    )

    last_used_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    remember_me: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    is_revoked: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    ip_address: Mapped[str | None] = mapped_column(
        String(45),
        nullable=True,
    )

    user_agent: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    user: Mapped["User"] = relationship(
        "User",
        backref="sessions",
    )
