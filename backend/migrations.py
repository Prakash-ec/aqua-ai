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

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    Integer,
    Numeric,
    String,
    Text,
    inspect,
    text,
)
from sqlalchemy.engine import Engine


def _column_exists(engine: Engine, table: str, column: str) -> bool:
    """Return True if ``table.column`` already exists on the live schema."""
    try:
        inspector = inspect(engine)
        return column in {c["name"] for c in inspector.get_columns(table)}
    except Exception:
        return False


def _fix_camera_prediction_column(engine: Engine) -> None:
    """
    Fix camera_predictions.prediction column type from VARCHAR(100) to TEXT.
    
    The production database was created with VARCHAR(100) but the model
    expects TEXT (unlimited length). AI analysis observations can exceed
    100 characters, causing data truncation errors on INSERT.
    """
    try:
        inspector = inspect(engine)
        if "camera_predictions" not in inspector.get_table_names():
            return
        
        columns = {c["name"]: c for c in inspector.get_columns("camera_predictions")}
        pred_col = columns.get("prediction")
        
        if pred_col is None:
            return
        
        # Check if the column type is VARCHAR with limited length
        col_type = str(pred_col["type"]).upper()
        if "VARCHAR" in col_type and "100" in col_type:
            with engine.begin() as connection:
                connection.execute(
                    text("ALTER TABLE camera_predictions ALTER COLUMN prediction TYPE TEXT")
                )
            print("Fixed camera_predictions.prediction: VARCHAR(100) -> TEXT")
    except Exception as error:
        print(f"Migration warning for camera_predictions.prediction: {type(error).__name__}")


def run_migrations(engine: Engine, metadata=None) -> None:
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

    # ---- Fix camera_predictions.prediction column type ----
    _fix_camera_prediction_column(engine)

    # ---- Generic, model-driven repair of every remaining missing column ----
    # ``Base.metadata.create_all`` cannot alter a table that already exists,
    # so a production database created from an older model version can be
    # missing columns the current code selects (for example
    # ``devices.is_active``).  This pass adds any missing column/index that
    # the current models define, without touching existing rows.
    if metadata is None:
        from backend.database import Base

        metadata = Base.metadata

    sync_schema_with_models(engine, metadata)

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


# =========================================================
# MODEL-DRIVEN SCHEMA SYNC
# =========================================================

# Columns that must default to TRUE (not the type-based FALSE) so that
# pre-existing rows keep working after the column is added.  Existing
# devices must stay active and existing users must stay admins.
_TRUE_DEFAULT_COLUMNS = {
    ("devices", "is_active"),
    ("users", "is_active"),
    ("users", "is_admin"),
}


def _default_sql_for(table_name: str, column) -> str | None:
    """
    Return a safe SQL default used to backfill a newly added NOT NULL column.

    Nullable columns are added without a default so existing rows stay NULL.
    """
    if (table_name, column.name) in _TRUE_DEFAULT_COLUMNS:
        return "TRUE"

    server_default = getattr(column, "server_default", None)

    if server_default is not None:
        arg = getattr(server_default, "arg", None)

        if isinstance(arg, str) and arg:
            return arg

        if arg is not None:
            rendered = str(arg)

            if rendered:
                return rendered

        return "CURRENT_TIMESTAMP"

    if isinstance(column.type, Boolean):
        return "FALSE"

    if isinstance(column.type, DateTime):
        return "CURRENT_TIMESTAMP"

    if isinstance(column.type, (Integer, Float, Numeric)):
        return "0"

    if isinstance(column.type, (String, Text)):
        return "''"

    return None


def _add_model_column(engine: Engine, table_name: str, column) -> None:
    """Add a single missing column using the current model definition."""
    try:
        column_type = column.type.compile(dialect=engine.dialect)
    except Exception as error:  # pragma: no cover - defensive
        print(
            f"Migration warning: unsupported type for "
            f"{table_name}.{column.name} ({type(error).__name__})"
        )
        return

    statement = f"ALTER TABLE {table_name} ADD COLUMN {column.name} {column_type}"

    if column.nullable is False:
        backfill = _default_sql_for(table_name, column)

        if backfill:
            statement = f"{statement} DEFAULT {backfill}"

    try:
        with engine.begin() as connection:
            connection.execute(text(statement))

        print(f"Added column {table_name}.{column.name} ({column_type})")
    except Exception as error:  # pragma: no cover - defensive
        # A concurrent worker may have added it first; never abort startup.
        print(
            f"Migration warning for {table_name}.{column.name}: "
            f"{type(error).__name__}"
        )
        return

    if column.nullable is False:
        try:
            with engine.begin() as connection:
                connection.execute(
                    text(
                        f"ALTER TABLE {table_name} "
                        f"ALTER COLUMN {column.name} SET NOT NULL"
                    )
                )
        except Exception as error:  # pragma: no cover - defensive
            print(
                f"Migration note: {table_name}.{column.name} left nullable "
                f"({type(error).__name__})"
            )


def sync_schema_with_models(engine: Engine, metadata) -> None:
    """
    Add every column/index that the current models define but the live
    database is missing.

    Idempotent and strictly additive: it never drops a column, never drops a
    table, and never rewrites existing values (except the DEFAULT backfill
    applied while adding a NOT NULL column).  Brand-new tables are left to
    ``Base.metadata.create_all``.
    """
    try:
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
    except Exception as error:  # pragma: no cover - defensive
        print(
            "Migration warning: could not list tables "
            f"({type(error).__name__})"
        )
        return

    added_columns = []

    for table in metadata.sorted_tables:
        if table.name not in existing_tables:
            # New table: create_all() owns it.
            continue

        try:
            existing_columns = {
                column["name"]
                for column in inspector.get_columns(table.name)
            }
        except Exception as error:  # pragma: no cover - defensive
            print(
                f"Migration warning: could not read {table.name} "
                f"({type(error).__name__})"
            )
            continue

        for column in table.columns:
            if column.name in existing_columns:
                continue

            _add_model_column(engine, table.name, column)
            added_columns.append(f"{table.name}.{column.name}")

        for column in table.columns:
            if column.index:
                _add_index_if_missing(engine, table.name, column.name)

    if added_columns:
        print(
            "Aqua AI schema sync added:",
            ", ".join(added_columns),
        )
    else:
        print("Aqua AI schema sync: no missing columns detected.")