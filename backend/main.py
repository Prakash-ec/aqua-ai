from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routes.devices import router as devices_router
from backend.routes.readings import router as readings_router
from backend.routes.camera import router as camera_router


# ============================================================
# APP
# ============================================================

app = FastAPI(
    title="Aqua AI API",
    description="AI-powered water quality monitoring backend",
    version="1.0.0"
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,

    allow_origins=["*"],

    allow_credentials=False,

    allow_methods=["*"],

    allow_headers=["*"],
)


# ============================================================
# ROUTES
# ============================================================

app.include_router(devices_router)

app.include_router(readings_router)

app.include_router(camera_router)


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():

    return {
        "message": "Aqua AI Backend is running",
        "status": "online"
    }


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
def health():

    return {
        "status": "healthy"
    }