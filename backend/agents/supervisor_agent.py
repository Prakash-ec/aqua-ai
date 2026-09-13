
from backend.agents.sensor_agent import SensorAgent
from backend.agents.camera_agent import CameraAgent


class SupervisorAgent:
    """
    Supervisor Agent:
    Routes the user's request to the appropriate agent.
    """

    def __init__(self, db):
        self.db = db
        self.sensor_agent = SensorAgent(db)
        self.camera_agent = CameraAgent()

    def detect_agent(self, question: str):
        """
        Identify which agent should handle the question.
        """

        question_lower = question.lower()

        camera_keywords = [
            "image",
            "photo",
            "picture",
            "camera",
            "algae",
            "foam",
            "scum",
            "floating particles",
            "visual analysis",
            "pollution appearance",
            "green water"
        ]

        sensor_keywords = [
            "temperature",
            "pH",
            "ph",
            "tds",
            "turbidity",
            "sensor",
            "reading",
            "latest value",
            "current value",
            "water quality"
        ]

        for keyword in camera_keywords:
            if keyword in question_lower:
                return "camera_agent"

        for keyword in sensor_keywords:
            if keyword in question_lower:
                return "sensor_agent"

        return "sensor_agent"

    def route_question(
        self,
        question: str,
        device_id: int | None = None,
        camera_analysis=None
    ):
        """
        Route the question to the correct agent.
        """

        selected_agent = self.detect_agent(question)

        if selected_agent == "camera_agent":
            if camera_analysis is None:
                return {
                    "success": False,
                    "agent": "supervisor_agent",
                    "message": (
                        "No camera analysis is available. "
                        "Please analyze an image first."
                    )
                }

            result = self.camera_agent.answer_question(
                question=question,
                analysis=camera_analysis
            )

        else:
            result = self.sensor_agent.answer_question(
                question=question,
                device_id=device_id
            )

        return {
            "success": result.get("success", False),
            "agent": selected_agent,
            "answer": result.get("answer"),
            "reading": result.get("reading"),
            "analysis": result.get("analysis"),
            "message": result.get("message")
        }