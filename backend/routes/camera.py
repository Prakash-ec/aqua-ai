import json
import re
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.agents.camera_agent import CameraAgent
from backend.database import get_db
from backend.models import CameraPrediction, Device
from backend.services.ai_provider import ask_vision_ai


# =========================================================
# ROUTER
# =========================================================

router = APIRouter(
    prefix="/camera",
    tags=["Camera AI"],
)

camera_agent = CameraAgent()


# =========================================================
# CONFIGURATION
# =========================================================

MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}

ALLOWED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
}


# =========================================================
# SYSTEM PROMPT
# =========================================================

SYSTEM_PROMPT = """
You are Aqua AI, an assistant for visible water-quality image screening.

Analyze only visible indicators such as:

- Foam
- Algae-like growth
- Unusual water coloration
- Floating particles
- Suspended materials
- Possible microplastic-like particles
- Oil-like surface layers
- Visible waste
- Possible contamination indicators

Important rules:

- Do not claim that contamination is confirmed from an image alone.
- Do not claim that particles are definitely microplastics.
- Use cautious language such as "possible" or "visible indication".
- If the image is unclear, say so.
- This is visual screening, not laboratory testing.
- Return only one valid JSON object.
- Do not use Markdown code fences.

Use exactly this structure:

{
    "overall_observation": "Short description of visible water conditions",
    "water_color": "Description of visible water color",
    "foam_detected": false,
    "algae_detected": false,
    "particles_detected": false,
    "possible_microplastics": false,
    "oil_layer_detected": false,
    "risk_level": "Low",
    "confidence": 0.75,
    "recommendation": "Suggested next action",
    "limitations": "Explain the limitations of image-based analysis"
}

Rules:

- Boolean fields must be true or false.
- confidence must be a number from 0 to 1.
- risk_level must be exactly Low, Medium, or High.
"""


# =========================================================
# FILE HELPERS
# =========================================================

def get_safe_filename(filename: str | None) -> str:
    """
    Create a safe filename for metadata storage.
    The actual image is not stored on the server.
    """

    if not filename:
        return "uploaded_image"

    filename = filename.replace("\\", "/")
    filename = filename.split("/")[-1]

    filename = re.sub(
        r"[^a-zA-Z0-9._-]",
        "_",
        filename,
    )

    return filename[:255] or "uploaded_image"


def validate_image_signature(
    image_bytes: bytes,
    content_type: str,
) -> bool:
    """
    Perform basic image-signature validation.
    """

    if content_type == "image/jpeg":
        return image_bytes.startswith(b"\xff\xd8\xff")

    if content_type == "image/png":
        return image_bytes.startswith(
            b"\x89PNG\r\n\x1a\n"
        )

    if content_type == "image/webp":
        return (
            len(image_bytes) >= 12
            and image_bytes[:4] == b"RIFF"
            and image_bytes[8:12] == b"WEBP"
        )

    return False


async def read_and_validate_image(
    image: UploadFile,
) -> tuple[bytes, str, str]:
    """
    Validate the uploaded image and return:

    image_bytes, content_type, safe_filename
    """

    content_type = (
        image.content_type or ""
    ).strip().lower()

    safe_filename = get_safe_filename(
        image.filename
    )

    extension = ""

    if "." in safe_filename:
        extension = (
            "."
            + safe_filename.rsplit(".", 1)[-1].lower()
        )

    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image type. Upload JPG, PNG, or WEBP.",
        )

    if extension and extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image extension. Upload JPG, PNG, or WEBP.",
        )

    image_bytes = await image.read(
        MAX_IMAGE_SIZE_BYTES + 1
    )

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="Uploaded image is empty.",
        )

    if len(image_bytes) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Image size must not exceed 10 MB.",
        )

    if not validate_image_signature(
        image_bytes=image_bytes,
        content_type=content_type,
    ):
        raise HTTPException(
            status_code=400,
            detail="The uploaded file does not appear to be a valid image.",
        )

    return image_bytes, content_type, safe_filename


# =========================================================
# JSON HELPERS
# =========================================================

def extract_json_from_response(
    raw_response: str,
) -> dict[str, Any]:
    """
    Extract one JSON object from the AI response.
    """

    if not isinstance(raw_response, str):
        raise ValueError("AI response must be text.")

    cleaned = raw_response.strip()

    if not cleaned:
        raise ValueError("AI returned an empty response.")

    cleaned = re.sub(
        r"^```(?:json)?\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )

    cleaned = re.sub(
        r"\s*```$",
        "",
        cleaned,
    ).strip()

    start_index = cleaned.find("{")
    end_index = cleaned.rfind("}")

    if start_index == -1 or end_index == -1:
        raise ValueError(
            "AI response did not contain a JSON object."
        )

    if end_index <= start_index:
        raise ValueError(
            "AI response contained an invalid JSON range."
        )

    json_text = cleaned[
        start_index:end_index + 1
    ]

    try:
        parsed = json.loads(json_text)

    except json.JSONDecodeError as error:
        raise ValueError(
            f"Could not parse AI JSON response: {error}"
        ) from error

    if not isinstance(parsed, dict):
        raise ValueError(
            "AI response must be a JSON object."
        )

    return parsed


# =========================================================
# NORMALIZATION HELPERS
# =========================================================

def normalize_boolean(value: Any) -> bool:
    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        return bool(value)

    if isinstance(value, str):
        return value.strip().lower() in {
            "true",
            "yes",
            "1",
            "detected",
            "present",
        }

    return False


def normalize_text(
    value: Any,
    default: str,
    max_length: int = 2000,
) -> str:
    if value is None:
        return default

    text = str(value).strip()

    if not text:
        return default

    return text[:max_length]


def normalize_confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        confidence = 0.0

    if confidence != confidence:
        confidence = 0.0

    return max(
        0.0,
        min(1.0, confidence),
    )


def normalize_risk_level(value: Any) -> str:
    risk = str(value or "").strip().lower()

    risk_map = {
        "low": "Low",
        "medium": "Medium",
        "moderate": "Medium",
        "high": "High",
    }

    return risk_map.get(risk, "Unknown")


def normalize_analysis(
    analysis: dict[str, Any],
) -> dict[str, Any]:
    """
    Ensure a stable camera-analysis response schema.
    """

    return {
        "overall_observation": normalize_text(
            analysis.get("overall_observation"),
            "No clear visual observation was returned.",
        ),
        "water_color": normalize_text(
            analysis.get("water_color"),
            "Not clearly determined.",
        ),
        "foam_detected": normalize_boolean(
            analysis.get("foam_detected")
        ),
        "algae_detected": normalize_boolean(
            analysis.get("algae_detected")
        ),
        "particles_detected": normalize_boolean(
            analysis.get("particles_detected")
        ),
        "possible_microplastics": normalize_boolean(
            analysis.get("possible_microplastics")
        ),
        "oil_layer_detected": normalize_boolean(
            analysis.get("oil_layer_detected")
        ),
        "risk_level": normalize_risk_level(
            analysis.get("risk_level")
        ),
        "confidence": normalize_confidence(
            analysis.get("confidence")
        ),
        "recommendation": normalize_text(
            analysis.get("recommendation"),
            "Use additional sensor measurements or laboratory testing.",
        ),
        "limitations": normalize_text(
            analysis.get("limitations"),
            (
                "Image analysis cannot confirm contamination "
                "or replace laboratory water-quality testing."
            ),
        ),
    }


# =========================================================
# DEVICE VALIDATION
# =========================================================

def validate_device_id(
    device_id: int | None,
    db: Session,
) -> int | None:
    """
    Validate an optional device ID.
    """

    if device_id is None:
        return None

    if device_id < 1:
        raise HTTPException(
            status_code=400,
            detail="device_id must be a positive integer.",
        )

    device = (
        db.query(Device)
        .filter(Device.id == device_id)
        .first()
    )

    if device is None:
        raise HTTPException(
            status_code=404,
            detail=f"Device with ID {device_id} was not found.",
        )

    return device_id


# =========================================================
# CAMERA ANALYSIS ENDPOINT
# =========================================================

@router.post("/analyze")
async def analyze_camera(
    image: UploadFile = File(...),
    provider: str | None = Form(None),
    model: str | None = Form(None),
    device_id: int | None = Form(None),
    db: Session = Depends(get_db),
):
    """
    Analyze an uploaded water image using the vision provider service.
    """

    try:
        # -------------------------------------------------
        # Validate optional device
        # -------------------------------------------------

        validated_device_id = validate_device_id(
            device_id=device_id,
            db=db,
        )

        # -------------------------------------------------
        # Read and validate image
        # -------------------------------------------------

        image_bytes, content_type, safe_filename = (
            await read_and_validate_image(image)
        )

        # -------------------------------------------------
        # Call the new vision-provider interface
        # -------------------------------------------------

        provider_response = ask_vision_ai(
            image_bytes=image_bytes,
            prompt=SYSTEM_PROMPT,
            provider=provider,
            model=model,
            content_type=content_type,
        )

        if not isinstance(provider_response, dict):
            raise ValueError(
                "Vision provider returned an invalid response."
            )

        raw_response = provider_response.get("answer")

        if not isinstance(raw_response, str):
            raise ValueError(
                "Vision provider did not return text analysis."
            )

        used_provider = provider_response.get(
            "provider",
            "unknown",
        )

        used_model = provider_response.get(
            "model",
            "unknown",
        )

        # -------------------------------------------------
        # Parse and normalize AI result
        # -------------------------------------------------

        raw_analysis = extract_json_from_response(
            raw_response
        )

        analysis = normalize_analysis(
            raw_analysis
        )

        # -------------------------------------------------
        # Generate camera-agent response
        # -------------------------------------------------

        try:
            agent_answer = camera_agent.answer(
                analysis
            )

        except Exception as agent_error:
            print(
                "[CAMERA AGENT ERROR]",
                str(agent_error),
            )

            agent_answer = {
                "summary": analysis[
                    "overall_observation"
                ],
                "risk_level": analysis[
                    "risk_level"
                ],
                "recommendations": [
                    analysis["recommendation"]
                ],
            }

        # -------------------------------------------------
        # Save prediction
        # -------------------------------------------------

        prediction = CameraPrediction(
            device_id=validated_device_id,
            image_path=safe_filename,
            prediction=analysis[
                "overall_observation"
            ],
            confidence=analysis[
                "confidence"
            ],
            details=json.dumps(
                analysis,
                ensure_ascii=False,
            ),
        )

        db.add(prediction)
        db.commit()
        db.refresh(prediction)

        # -------------------------------------------------
        # Return result
        # -------------------------------------------------

        return {
            "success": True,
            "message": "Image analyzed successfully.",
            "prediction_id": prediction.id,
            "analysis": analysis,
            "agent_answer": agent_answer,
            "metadata": {
                "filename": safe_filename,
                "content_type": content_type,
                "provider_requested": (
                    provider.strip()
                    if provider
                    else "automatic"
                ),
                "model_requested": (
                    model.strip()
                    if model
                    else None
                ),
                "provider_used": used_provider,
                "model_used": used_model,
                "device_id": validated_device_id,
                "image_size_bytes": len(image_bytes),
            },
        }

    except HTTPException:
        raise

    except SQLAlchemyError as database_error:
        db.rollback()

        print(
            "[CAMERA DATABASE ERROR]",
            str(database_error),
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "The image was analyzed, but the result "
                "could not be saved."
            ),
        ) from database_error

    except ValueError as parsing_error:
        db.rollback()

        print(
            "[CAMERA RESPONSE ERROR]",
            type(parsing_error).__name__ + ":",
            str(parsing_error),
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "The AI vision provider returned an invalid "
                "analysis response and is temporarily unavailable. "
                "Please try again later."
            ),
        ) from parsing_error

    except Exception as error:
        db.rollback()

        print(
            "[CAMERA ANALYSIS ERROR]",
            str(error),
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Camera AI analysis is currently unavailable. "
                "Please try again later."
            ),
        ) from error