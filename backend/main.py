import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables before importing application modules.
# Use explicit path + override so newly added RESEND_* vars are picked up even if process was started before .env was updated.
BASE_DIR_PRELOAD = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR_PRELOAD / ".env", override=True)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from backend import models  # noqa: F401
from backend.database import Base, engine

from backend.routes.devices import router as devices_router
from backend.routes.readings import router as readings_router
from backend.routes.alerts import router as alerts_router
from backend.routes.camera import router as camera_router
from backend.routes.chat import router as chat_router
from backend.routes.ai import router as ai_router
from backend.routes.water_quality import router as water_quality_router
from backend.routes.agents import router as agents_router
from backend.routes.admin import router as admin_router


# =========================================================
# PATHS
# =========================================================

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
FRONTEND_INDEX = FRONTEND_DIR / "index.html"


# =========================================================
# CORS CONFIGURATION
# =========================================================

allowed_origins = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:8001",
    "http://127.0.0.1:8001",
    "https://vacprojectv1.netlify.app",
    "https://spectacular-blini-861768.netlify.app",
    "https://vacproject.netlify.app",
    "https://aqua-ai.netlify.app",
    "https://aqua-ai-frontend.netlify.app",
    "https://aqua-sense-vac.netlify.app",
    "http://127.0.0.1:5501",
    "http://localhost:5501",
]

extra_origins = os.getenv("CORS_ORIGINS", "").strip()

if extra_origins:
    allowed_origins.extend(
        origin.strip()
        for origin in extra_origins.split(",")
        if origin.strip()
    )

# Remove duplicate origins while preserving order.
allowed_origins = list(dict.fromkeys(allowed_origins))


# =========================================================
# DATABASE STARTUP
# =========================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Verify the database connection and create missing tables.

    Existing tables are not deleted or automatically migrated.
    """

    print("Starting Aqua AI backend...")

    try:
        # Verify database connectivity.
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        # Create tables that do not already exist.  A failure here must not
        # stop the additive column migrations below, which repair tables that
        # were created by an older version of the models.
        try:
            Base.metadata.create_all(bind=engine)
        except Exception as create_error:  # pragma: no cover - defensive
            print(
                "Aqua AI table creation warning:",
                type(create_error).__name__,
                "-",
                str(create_error)[:200],
            )

        # Apply guarded, additive migrations so the live schema matches the
        # current models before any request can query the affected tables.
        from backend.migrations import run_migrations

        run_migrations(engine)

        print("Aqua AI database connection successful.")
        print("Aqua AI database tables verified.")

        # Report AI provider configuration status.
        # Only booleans are printed - API key values are never logged.
        from backend.services.ai_provider import (
            get_provider_debug_info,
        )

        info = get_provider_debug_info()
        print("Aqua AI provider keys loaded:")
        print(
            "  openrouter:",
            "yes" if info.get("openrouter_key_loaded") else "no",
        )
        print(
            "  groq:",
            "yes" if info.get("groq_key_loaded") else "no",
        )
        print(
            "  deepseek:",
            "yes" if info.get("deepseek_key_loaded") else "no",
        )
        print(
            "  groq vision model:",
            info.get("groq_vision_model") or "not set",
        )
        print(
            "  openrouter vision model:",
            info.get("openrouter_vision_model") or "not set",
        )

        vision = info.get("vision_providers") or []
        if vision:
            print(
                "Aqua AI vision providers available:",
                ", ".join(
                    f"{v['id']} ({v['model']})" for v in vision
                ),
            )
        else:
            print(
                "Aqua AI vision providers available: none "
                "(camera analysis will be unavailable until an "
                "API key is configured in .env)"
            )

    except Exception as error:
        print(
            "Aqua AI database initialization failed:",
            type(error).__name__,
            str(error),
        )

    # ---------------------------------------------------------
    # AUTOMATIC ALERT STARTUP CHECK (backend-driven)
    # ---------------------------------------------------------
    # The automatic alert system must never depend on the browser. As soon as
    # the backend is live the LATEST stored reading of every device is
    # evaluated: a critical latest reading with no active cooldown sends the
    # real email immediately instead of waiting for another reading to be
    # ingested. An active cooldown is reconstructed from the database
    # timestamps and is never reset by a restart.
    # Runs in a daemon thread so the email call does not delay API startup.
    try:
        from backend.services.alert_service import (
            start_startup_auto_alert_check,
            start_startup_auto_alert_watcher,
        )

        start_startup_auto_alert_check()

        # Optional continuous monitoring loop (disabled unless
        # AUTO_ALERT_WATCHER_INTERVAL_SECONDS > 0).
        start_startup_auto_alert_watcher()

    except Exception as error:
        print(
            "Aqua AI automatic alert startup check skipped:",
            type(error).__name__,
            str(error)[:200],
        )


    yield

    print("Aqua AI backend shutdown complete.")


# =========================================================
# FASTAPI APPLICATION
# =========================================================

app = FastAPI(
    title="Aqua AI API",
    description=(
        "Smart water-quality monitoring API with sensor data, "
        "water-quality analysis, AI chatbot, camera analysis, "
        "AI providers, and intelligent agents. "
        "No authentication required — public API for demo/local use."
    ),
    version="1.0.0",
    lifespan=lifespan,
)


# =========================================================
# MIDDLEWARE
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    allow_headers=["*"],
)


# =========================================================
# ROUTERS
# =========================================================

app.include_router(devices_router)
app.include_router(readings_router)
app.include_router(alerts_router)
app.include_router(camera_router)
app.include_router(chat_router)
app.include_router(ai_router)
app.include_router(water_quality_router)
app.include_router(agents_router)
app.include_router(admin_router)


# =========================================================
# BASIC ENDPOINTS
# =========================================================

@app.get("/", include_in_schema=False)
def root():
    """
    Serve the frontend homepage if it exists.
    Otherwise, return a backend status response.
    """

    if FRONTEND_INDEX.exists():
        return FileResponse(FRONTEND_INDEX)

    return {
        "success": True,
        "message": "Aqua AI backend is running.",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health", tags=["System"])
def health_check():
    """
    Check whether the API and database are available.
    """

    database_status = "unavailable"

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        database_status = "connected"

    except Exception as error:
        import traceback
        print(f"[HEALTH CHECK ERROR] {type(error).__name__}: {error}")
        traceback.print_exc()
        database_status = f"error: {type(error).__name__}"

    if database_status != "connected":
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "status": "degraded",
                "service": "Aqua AI API",
                "database": database_status,
            },
        )

    return {
        "success": True,
        "status": "healthy",
        "service": "Aqua AI API",
        "database": database_status,
    }


# =========================================================
# FRONTEND STATIC FILES
# =========================================================

if FRONTEND_DIR.exists():
    app.mount(
        "/frontend",
        StaticFiles(directory=FRONTEND_DIR),
        name="frontend",
    )

    # Also serve the frontend at the root so that relative asset
    # references such as "app.js" and "style.css" resolve when the
    # homepage is opened at "/". This mount is registered last, so all
    # API routes above keep precedence.
    app.mount(
        "/",
        StaticFiles(directory=FRONTEND_DIR, html=True),
        name="frontend-root",
    )