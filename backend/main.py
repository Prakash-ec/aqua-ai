from fastapi import FastAPI

from backend.routes.devices import router as devices_router
from backend.routes.readings import router as readings_router

app = FastAPI(
    title="Aqua AI API",
    description="AI + IoT Water Quality Monitoring System",
    version="1.0.0"
)

app.include_router(devices_router)
app.include_router(readings_router)


@app.get("/")
def root():
    return {
        "message": "Aqua AI Backend is running",
        "status": "online"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }