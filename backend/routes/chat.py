import json
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Device, WaterReading

# Reuse OpenRouter client and configuration from camera.py
from backend.routes.camera import client as openrouter_client, MODEL as OPENROUTER_MODEL, OPENROUTER_API_KEY


router = APIRouter(
    prefix="/chat",
    tags=["Chat"]
)


class ChatRequest(BaseModel):
    question: str


class ChatResult(BaseModel):
    success: bool
    answer: str
    model: str


SYSTEM_PROMPT = """
You are Aqua AI's water-quality assistant. Use only the structured sensor data provided in the user message to answer user questions about the most recent water quality readings.
Be concise, factual, and conservative. Do NOT invent values. If the data is insufficient to answer, say you do not have enough data and list what would be needed.
Do NOT provide medical, legal, or safety certification statements. Only describe observations based on the provided sensor numbers and how they compare with typical monitoring ranges.
Return a short, clear natural-language answer.
"""


@router.post("/water", response_model=ChatResult)
def chat_water(request: ChatRequest, db: Session = Depends(get_db)):
    # Ensure AI client is configured
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="AI service is not configured on the server.")

    if openrouter_client is None:
        raise HTTPException(status_code=500, detail="AI client is not initialized.")

    try:
        # Retrieve latest reading and recent history
        latest: Optional[WaterReading] = (
            db.query(WaterReading).order_by(WaterReading.recorded_at.desc()).first()
        )

        recent: List[WaterReading] = (
            db.query(WaterReading).order_by(WaterReading.recorded_at.desc()).limit(12).all()
        )

        device = None
        if latest:
            device = db.query(Device).filter(Device.id == latest.device_id).first()

        def reading_to_dict(r: WaterReading):
            if not r:
                return None
            return {
                "id": r.id,
                "device_id": r.device_id,
                "temperature": r.temperature,
                "ph": r.ph,
                "turbidity": r.turbidity,
                "tds": r.tds,
                "recorded_at": r.recorded_at.isoformat() if r.recorded_at else None,
            }

        context = {
            "latest_reading": reading_to_dict(latest) if latest else None,
            "recent_readings": [reading_to_dict(r) for r in recent] if recent else [],
            "device": {
                "id": device.id,
                "name": device.name,
                "location": device.location,
                "device_type": device.device_type,
            } if device else None,
            "note": "All values are direct sensor readings; timestamps are ISO 8601."
        }

        user_content = (
            "Answer the user's question using ONLY the provided sensor data and the rules in the system prompt. "
            "If the data is insufficient, say so and explain what additional data is needed.\n\n"
            "QUESTION: " + request.question + "\n\n"
            "SENSOR_CONTEXT (JSON):\n" + json.dumps(context, indent=2)
        )

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        # Query OpenRouter (same pattern as camera route)
        response = openrouter_client.chat.completions.create(
            model=OPENROUTER_MODEL,
            messages=messages,
            temperature=0.2,
            max_tokens=600,
        )

        # Extract the assistant content
        try:
            answer_text = response.choices[0].message.content
        except Exception:
            answer_text = getattr(response, "text", None)

        if not answer_text:
            raise HTTPException(status_code=502, detail="AI provider returned an empty reply.")

        return {"success": True, "answer": answer_text, "model": OPENROUTER_MODEL}

    except HTTPException:
        raise

    except Exception as e:
        # Log server-side error without exposing secrets
        print("/chat/water error:", repr(e))
        raise HTTPException(status_code=500, detail="Unable to process chat request.")
