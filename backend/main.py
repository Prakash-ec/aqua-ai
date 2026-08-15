from fastapi import FastAPI

from backend.routes.devices import router as devices_router
from backend.routes.readings import router as readings_router
from backend.routes.camera import router as camera_router


app = FastAPI(
    title="Aqua AI API",
    description="Smart Water Quality Monitoring API",
    version="1.0.0"
)


app.include_router(devices_router)

app.include_router(readings_router)

app.include_router(camera_router)


@app.get("/")
def root():

    return {
        "message": "Aqua AI backend is running",
        "camera_endpoint": "/camera/analyze",
        "docs": "/docs"
    }