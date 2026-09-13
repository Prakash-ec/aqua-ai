from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.agents.camera_agent import CameraAgent


router = APIRouter(
    prefix="/agents",
    tags=["Agents"],
)


camera_agent = CameraAgent()


# =========================================================
# REQUEST SCHEMAS
# =========================================================

class CameraAnalysisRequest(BaseModel):
    analysis: dict[str, Any] = Field(
        ...,
        description="Structured result returned by the camera AI.",
    )


class CameraQuestionRequest(BaseModel):
    question: str = Field(
        ...,
        min_length=1,
        max_length=2000,
    )
    analysis: dict[str, Any] | None = None


# =========================================================
# CAMERA ANALYSIS AGENT
# =========================================================

@router.post("/camera/analyze")
def process_camera_analysis(
    request: CameraAnalysisRequest,
):
    """
    Convert structured camera-AI output into a user-friendly
    explanation and recommendations.
    """

    try:
        result = camera_agent.answer(request.analysis)

        return {
            "success": True,
            "agent": "camera",
            "response": result,
        }

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="The camera analysis agent could not process the result.",
        )


# =========================================================
# CAMERA QUESTION AGENT
# =========================================================

@router.post("/camera/question")
def ask_camera_question(
    request: CameraQuestionRequest,
):
    """
    Answer a question about a previously generated camera analysis.
    """

    try:
        result = camera_agent.answer_question(
            question=request.question,
            analysis=request.analysis,
        )

        return {
            "success": True,
            "agent": "camera",
            "response": result,
        }

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="The camera question agent could not answer the question.",
        )


# =========================================================
# AGENT HEALTH CHECK
# =========================================================

@router.get("/health")
def agent_health():
    """
    Check whether the application agents are available.
    """

    return {
        "success": True,
        "agents": {
            "camera": {
                "available": True,
                "endpoints": [
                    "/agents/camera/analyze",
                    "/agents/camera/question",
                ],
            }
        },
    }