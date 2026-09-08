import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend import models  # noqa: F401 - registers SQLAlchemy models
from backend.database import Base, engine
from backend.routes.devices import router as devices_router
from backend.routes.readings import router as readings_router
from backend.routes.camera import router as camera_router
from backend.routes.chat import router as chat_router
from backend.routes.ai import router as ai_router


# =========================================================
# APP
# =========================================================

app = FastAPI(
    title="Aqua AI API",
    description="Smart Water Quality Monitoring and AI Camera Analysis",
    version="1.0.0",
)


# =========================================================
# CORS
# =========================================================

DEFAULT_CORS_ORIGINS = {
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "https://vac-project-ver1.netlify.app",
    "https://vac-project-vers2.netlify.app",
}

configured_origins = {
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(DEFAULT_CORS_ORIGINS | configured_origins),

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],
)


# =========================================================
# ROUTES
# =========================================================

app.include_router(devices_router)
app.include_router(readings_router)
app.include_router(camera_router)
app.include_router(chat_router)
app.include_router(ai_router)


# =========================================================
# FRONTEND
# =========================================================

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


@app.on_event("startup")
def initialize_database() -> None:
    """Create the initial tables when the service starts on a fresh database."""

    Base.metadata.create_all(bind=engine)


# =========================================================
# ROOT
# =========================================================

@app.get("/", include_in_schema=False)
def dashboard():
    """Serve the production dashboard from the same origin as the API."""

    return FileResponse(FRONTEND_DIR / "index.html")


# =========================================================
# HEALTH
# =========================================================

@app.get("/health")
def health():

    return {
        "success": True,
        "status": "healthy",
        "service": "Aqua AI",
    }


# Keep this mount last: API, docs, and health routes above take precedence.
app.mount(
    "/",
    StaticFiles(directory=FRONTEND_DIR, html=True),
    name="frontend",
)
