
from sqlalchemy.orm import Session

from backend.models import WaterReading


class SensorAgent:
    """
    Agent responsible for reading sensor data from PostgreSQL.
    """

    def __init__(self, db: Session):
        self.db = db

    def get_latest_reading(self, device_id: int | None = None):
        """
        Get the most recent water reading.
        """

        query = self.db.query(WaterReading)

        if device_id is not None:
            query = query.filter(
                WaterReading.device_id == device_id
            )

        reading = (
            query
            .order_by(WaterReading.recorded_at.desc())
            .first()
        )

        if reading is None:
            return {
                "success": False,
                "message": "No sensor readings found."
            }

        return {
            "success": True,
            "reading": {
                "id": reading.id,
                "device_id": reading.device_id,
                "temperature": reading.temperature,
                "ph": reading.ph,
                "turbidity": reading.turbidity,
                "tds": reading.tds,
                "recorded_at": (
                    reading.recorded_at.isoformat()
                    if reading.recorded_at
                    else None
                )
            }
        }

    def answer_question(
        self,
        question: str,
        device_id: int | None = None
    ):
        """
        Answer basic sensor-related questions.
        """

        result = self.get_latest_reading(device_id)

        if not result["success"]:
            return result

        reading = result["reading"]
        question_lower = question.lower()

        if "ph" in question_lower:
            answer = (
                f"The latest pH value is {reading['ph']}."
            )

        elif "temperature" in question_lower:
            answer = (
                f"The latest water temperature is "
                f"{reading['temperature']} °C."
            )

        elif "turbidity" in question_lower:
            answer = (
                f"The latest turbidity value is "
                f"{reading['turbidity']} NTU."
            )

        elif "tds" in question_lower:
            answer = (
                f"The latest TDS value is "
                f"{reading['tds']} mg/L."
            )

        elif (
            "reading" in question_lower
            or "sensor" in question_lower
            or "water quality" in question_lower
        ):
            answer = (
                "Latest water readings:\n"
                f"- Temperature: {reading['temperature']} °C\n"
                f"- pH: {reading['ph']}\n"
                f"- Turbidity: {reading['turbidity']} NTU\n"
                f"- TDS: {reading['tds']} mg/L"
            )

        else:
            answer = (
                "I can provide the latest temperature, pH, "
                "turbidity, and TDS readings."
            )

        return {
            "success": True,
            "agent": "sensor_agent",
            "answer": answer,
            "reading": reading
        }