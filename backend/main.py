from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ==========================================
# ROUTE IMPORTS
# ==========================================

from backend.routes.devices import router as devices_router
from backend.routes.readings import router as readings_router
from backend.routes.camera import router as camera_router
from backend.routes.chat import router as chat_router


# ==========================================
# CREATE FASTAPI APP
# ==========================================

app = FastAPI(
    title="Aqua AI API",
    description="Smart Water Quality Monitoring and AI Camera Analysis",
    version="1.0.0",
)


# ==========================================
# CORS CONFIGURATION
# ==========================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# REGISTER ROUTES
# ==========================================

app.include_router(devices_router)
app.include_router(readings_router)
app.include_router(camera_router)
app.include_router(chat_router)


# ==========================================
# ROOT ENDPOINT
# ==========================================

@app.get("/")
def root():
    return {
        "success": True,
        "message": "Aqua AI backend is running",
        "version": "1.0.0",
        "endpoints": {
            "docs": "/docs",
            "health": "/health",
            "devices": "/devices/",
            "readings": "/readings/",
            "camera": "/camera/analyze",
        },
    }


# ==========================================
# HEALTH CHECK
# ==========================================

@app.get("/health")
def health():
    return {
        "success": True,
        "status": "healthy",
        "service": "Aqua AI",
    }