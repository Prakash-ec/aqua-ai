import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker


# =========================================================
# LOAD ENVIRONMENT VARIABLES
# =========================================================

from pathlib import Path as _Path
load_dotenv(_Path(__file__).resolve().parents[1] / ".env", override=True)

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. "
        "Add your PostgreSQL connection string to the .env file."
    )


# =========================================================
# DATABASE ENGINE
# =========================================================

engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
)


# =========================================================
# SESSION CONFIGURATION
# =========================================================

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


# =========================================================
# BASE MODEL
# =========================================================

Base = declarative_base()


# =========================================================
# UTC TIMESTAMP SERIALIZATION
# =========================================================
# Project convention: DateTime columns store naive UTC wall time
# (written via datetime.now(timezone.utc).replace(tzinfo=None)).
# JSON must never emit a bare naive timestamp because browsers parse
# "2026-09-23T16:35:13" as LOCAL time — a user at UTC+5:30 would see
# 4:35 pm for a reading actually stored at 10:05 pm local.
# utc_iso() stamps the explicit +00:00 offset so every consumer renders
# the true local time. Existing rows need no migration: they are
# already naive-UTC, which is exactly what this helper assumes.

from datetime import datetime as _datetime
from datetime import timezone as _timezone


def utc_iso(value) -> str | None:
    """Serialize a datetime as ISO-8601 with explicit UTC offset."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        if not isinstance(value, _datetime):
            return str(value)
        if value.tzinfo is None:
            value = value.replace(tzinfo=_timezone.utc)
        return value.isoformat()
    except Exception:
        return str(value)


# =========================================================
# DATABASE DEPENDENCY
# =========================================================

def get_db():
    """
    Create one database session for each API request.
    Close the session after the request finishes.
    """

    db = SessionLocal()

    try:
        yield db

    finally:
        db.close()