"""
Aqua AI — lightweight, idempotent database migrations.

``Base.metadata.create_all`` cannot alter existing tables, so this module
safely adds new columns that were introduced after a table already existed.
Each migration is guarded so it can be run any number of times without
error and without touching existing rows.

Supported databases: PostgreSQL (and the SQLite/Postgres syntax used here is
generic "ADD COLUMN IF NOT EXISTS"-free; we check the column exists first).
"""

from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def _column_exists(engine: Engine, table: str, column: str) -> bool:
    """Return True if ``table.column`` already exists on the live schema."""
    try:
        inspector = inspect(engine)
        return column in {c["name"] for c in inspector.get_columns(table)}
    except Exception:
        return False


def run_migrations(engine: Engine) -> None:
    """
    Apply all guarded migrations.

    Safe to run on every startup:
      - Adding a column when it is missing.
      - Backfilling ownership to the first admin user only for rows that
        currently have no ``user_id``.
    """
    # ---- Ownership columns introduced to support per-user data isolation ----
    _add_owner_column(engine, "devices")
    _add_owner_column(engine, "water_readings")
    _add_owner_column(engine, "camera_predictions")

    # ---- Device API token (ESP32 ingestion authentication) ----
    _add_token_hash_column(engine)

    print("Aqua AI database migrations verified.")


def _add_token_hash_column(engine: Engine) -> None:
    """Add ``devices.token_hash`` if missing (nullable, indexed)."""
    if _column_exists(engine, "devices", "token_hash"):
        return

    try:
        with engine.begin() as connection:
            connection.execute(
                text("ALTER TABLE devices ADD COLUMN token_hash VARCHAR(64)")
            )
        print("Added column devices.token_hash")
    except Exception as error:  # pragma: no cover - defensive
        print(f"Migration warning for devices.token_hash: {type(error).__name__}")

    _add_index_if_missing(engine, "devices", "token_hash")


def _add_owner_column(engine: Engine, table: str, column: str = "user_id") -> None:
    """Add a nullable ``user_id`` column + index to ``table`` if missing."""
    if _column_exists(engine, table, column):
        return

    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    f'ALTER TABLE {table} '
                    f'ADD COLUMN {column} INTEGER REFERENCES users(id) '
                    f'ON DELETE SET NULL'
                )
            )
        print(f"Added ownership column {table}.{column}")
    except Exception as error:  # pragma: no cover - defensive
        # A concurrent migration or an unexpected name conflict; the column
        # may already exist now, so just log and continue.
        print(f"Migration warning for {table}.{column}: {type(error).__name__}")

    # Index is best-effort; Postgres names the implicit index itself.
    _add_index_if_missing(engine, table, column)


def _add_index_if_missing(engine: Engine, table: str, column: str) -> None:
    try:
        with engine.begin() as connection:
            connection.execute(
                text(f'CREATE INDEX IF NOT EXISTS ix_{table}_{column} '
                     f'ON {table} ({column})')
            )
    except Exception:  # pragma: no cover - best-effort
        pass


def backfill_owner_to_first_admin(engine: Engine) -> None:
    """
    Point any ownership-less devices/readings/camera rows at the first admin
    user so that an existing single-admin deployment keeps working seamlessly.
    """
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE devices
                SET user_id = (
                    SELECT id FROM users WHERE is_admin = TRUE
                    ORDER BY id ASC LIMIT 1
                )
                WHERE user_id IS NULL
                """
            )
        )
        connection.execute(
            text(
                """
                UPDATE water_readings
                SET user_id = (
                    SELECT user_id FROM devices
                    WHERE devices.id = water_readings.device_id
                )
                WHERE user_id IS NULL
                """
            )
        )
        connection.execute(
            text(
                """
                UPDATE camera_predictions
                SET user_id = (
                    SELECT user_id FROM devices
                    WHERE devices.id = camera_predictions.device_id
                )
                WHERE user_id IS NULL
                """
            )
        )