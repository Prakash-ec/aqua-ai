import io
import json
import re
from datetime import datetime
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
from backend.models import CameraPrediction, Device, WaterReading
from backend.services.ai_provider import (
    VisionProviderError,
    ask_vision_ai,
    classify_provider_error,
)


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
# SYSTEM PROMPT — visual screening only
# =========================================================

SYSTEM_PROMPT = """
You are Aqua AI — a VISUAL water-screening assistant. You analyze ONLY what is visibly observable in the image.

CRITICAL CAPABILITY BOUNDARIES — NEVER VIOLATE:
- An ordinary camera image CANNOT measure: pH, TDS, EC, salinity, temperature, dissolved oxygen, BOD, COD, hardness, alkalinity, nitrate, phosphate, heavy metals, chlorine, microbial contamination, or any chemical/microbiological parameter.
- NEVER report numeric values for pH, TDS, EC, temperature, turbidity NTU, or any sensor parameter based on the image.
- NEVER state "safe to drink", "unsafe to drink", "contains bacteria", "contains heavy metals", "contains pathogens" based solely on image.
- NEVER claim laboratory-level identification of microorganisms, microplastics, or contaminants. Microplastics in particular cannot be confirmed from an ordinary image.

WHAT YOU MAY REPORT (visual observation only):
- visible foam, visible algae/green material, unusual coloration, visible suspended particles, visible sediment, surface film/oily appearance, visible debris, apparent water clarity/turbidity description (qualitative: clear / slightly cloudy / very cloudy / not assessed), obvious visual contamination indicators.

LANGUAGE RULES — observation vs inference:
- Separate observation from interpretation.
- Use qualified language: "appears", "visible", "may indicate", "visually consistent with", "cannot be confirmed from the image", "possibly", "suggests".
- GOOD: "Visible green surface material is present, which may be consistent with algae."
- BAD: "Algae contamination confirmed."
- GOOD: "The water appears cloudy with visible suspended particles."
- BAD: "Turbidity is 8.4 NTU."
- GOOD: "A thin reflective surface layer is visible and may be consistent with an oily film."
- BAD: "The water contains oil."
- State uncertainty when image is unclear. Never fabricate confidence. Avoid assuming unusual color automatically means contamination. Avoid assuming clear water is safe.

STRUCTURE RULES:
- For each visual indicator state whether it is "clearly visible", "possible", or "not observed".
- Distinguish three confidence levels: high / moderate / low. Use low when image quality is poor or evidence is ambiguous.
- If image quality is poor (dark, blurry, glare, too little water visible), say so and set confidence to low.

Return ONLY one valid JSON object. No markdown fences. No reasoning/thinking text.

Use exactly this structure (all fields required):

{
  "overall_visual_assessment": "2-3 sentence visual-only description of what is seen. No chemical values.",
  "overall_observation": "Same as overall_visual_assessment for backward compatibility",
  "visual_quality": "Good | Fair | Poor | Unclear",
  "water_color": "Description of visible water color",
  "foam_detected": false,
  "algae_detected": false,
  "particles_detected": false,
  "possible_microplastics": false,
  "oil_layer_detected": false,
  "observations": ["Visible observation 1", "Visible observation 2"],
  "potential_visual_indicators": ["Possible indicator 1 qualified with may/visible language"],
  "risk_level": "Low",
  "confidence": 0.75,
  "confidence_level": "high | moderate | low",
  "recommendation": "Suggested next action — sensor/lab follow-up, never drinkability claim",
  "recommended_action": "Same as recommendation for backward compatibility",
  "limitations": "This is visual screening only and cannot determine chemical or microbiological water quality. Does not replace laboratory testing.",
  "color_abnormalities": "Description or null",
  "cloudiness": "Clear | slightly cloudy | very cloudy | not assessed",
  "visible_debris": "Description or null",
  "safety_disclaimer": "This is visual screening only and does not replace laboratory water testing."
}

Rules:
- Boolean fields true/false strictly.
- confidence 0..1.
- risk_level exactly Low, Medium, or High. Use High only when strong visible indicators are clearly visible; otherwise Low or Medium.
- confidence_level one of high, moderate, low (lowercase).
- visual_quality one of Good, Fair, Poor, Unclear.
- observations: 2-5 short factual visible observations.
- potential_visual_indicators: only items with qualified language; leave empty if none.
- Keep every text field concise 1-2 sentences.
- IMPORTANT: Reply with ONLY the JSON object.
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
# IMAGE QUALITY CHECK (before AI call)
# =========================================================

def check_image_quality(image_bytes: bytes) -> dict[str, Any]:
    """
    Heuristic image quality check using Pillow.
    Returns dict with is_suitable, visual_quality, reason, details.
    Does not invent contamination — only checks technical quality.
    """
    try:
        from PIL import Image, ImageFilter, ImageStat
    except ImportError:
        return {
            "is_suitable": True,
            "visual_quality": "Good",
            "reason": "",
            "details": {"pillow_available": False},
        }

    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()
        # Ensure RGB for stats
        width, height = img.size
        min_side = min(width, height)
        # Extremely low resolution
        if width < 80 or height < 80 or min_side < 80:
            return {
                "is_suitable": False,
                "visual_quality": "Poor",
                "reason": "Image resolution is extremely low. Please capture a higher-resolution image with the water surface/container clearly visible.",
                "details": {"width": width, "height": height, "issue": "low_resolution"},
            }
        if width < 200 or height < 200:
            # Not blocking but flag as Fair
            low_res_warning = True
        else:
            low_res_warning = False

        # Convert to grayscale for brightness/contrast
        gray = img.convert("L")
        stat = ImageStat.Stat(gray)
        mean_brightness = stat.mean[0] if stat.mean else 128
        # stdev via stddev[0] not always; use extrema and mean for variance approx
        # Pillow ImageStat gives stddev
        try:
            stdev = stat.stddev[0] if stat.stddev else 0
        except Exception:
            stdev = 0

        # Extremely dark
        if mean_brightness < 25:
            return {
                "is_suitable": False,
                "visual_quality": "Poor",
                "reason": "Image quality is insufficient for reliable visual analysis. The image appears extremely dark. Please capture a clearer image with adequate lighting and the water surface/container visible.",
                "details": {"mean_brightness": round(mean_brightness, 1), "issue": "too_dark"},
            }
        # Excessive glare / overexposed (almost white)
        if mean_brightness > 245 and stdev < 30:
            return {
                "is_suitable": False,
                "visual_quality": "Poor",
                "reason": "Image quality is insufficient for reliable visual analysis. The image appears overexposed or dominated by glare. Please retake with diffuse lighting avoiding direct glare.",
                "details": {"mean_brightness": round(mean_brightness, 1), "issue": "glare"},
            }
        # Blur detection via edge variance — only flag extremely low edge content
        # on images that have moderate brightness range (avoid false positives on
        # uniform synthetic images; real water photos have container edges/texture).
        # Threshold conservative to avoid blocking valid clear-water images.
        try:
            edges = gray.filter(ImageFilter.FIND_EDGES)
            edge_stat = ImageStat.Stat(edges)
            edge_mean = edge_stat.mean[0] if edge_stat.mean else 0
            if edge_mean < 1.2 and mean_brightness > 30 and stdev > 10:
                return {
                    "is_suitable": False,
                    "visual_quality": "Poor",
                    "reason": "Image quality is insufficient for reliable visual analysis. The image appears severely blurry or out of focus. Please capture a clearer, well-focused image.",
                    "details": {"edge_mean": round(edge_mean, 2), "mean_brightness": round(mean_brightness, 1), "issue": "blurry"},
                }
        except Exception:
            pass

        # If low_res_warning and slightly dark, downgrade quality
        if low_res_warning:
            return {
                "is_suitable": True,
                "visual_quality": "Fair",
                "reason": "Image resolution is low; analysis may be less reliable. A higher-resolution, well-lit image is recommended.",
                "details": {"width": width, "height": height, "mean_brightness": round(mean_brightness, 1)},
            }
        if mean_brightness < 45:
            return {
                "is_suitable": True,
                "visual_quality": "Fair",
                "reason": "",
                "details": {"mean_brightness": round(mean_brightness, 1), "note": "dim"},
            }

        return {
            "is_suitable": True,
            "visual_quality": "Good",
            "reason": "",
            "details": {"width": width, "height": height, "mean_brightness": round(mean_brightness, 1)},
        }
    except Exception as e:
        # If Pillow fails to decode, treat as not suitable to avoid sending corrupt image to AI
        return {
            "is_suitable": True,
            "visual_quality": "Unclear",
            "reason": "",
            "details": {"error": str(e)[:120]},
        }


def build_poor_quality_analysis(quality: dict[str, Any]) -> dict[str, Any]:
    reason = quality.get("reason") or "Image quality is insufficient for reliable visual analysis. Please capture a clearer image with the water surface/container visible and adequate lighting."
    return {
        "overall_visual_assessment": reason,
        "overall_observation": reason,
        "visual_quality": quality.get("visual_quality", "Poor"),
        "water_color": "Not assessed — image quality insufficient for reliable color analysis.",
        "foam_detected": False,
        "algae_detected": False,
        "particles_detected": False,
        "possible_microplastics": False,
        "oil_layer_detected": False,
        "observations": [
            "Image quality is insufficient for reliable visual screening.",
            reason,
        ],
        "potential_visual_indicators": [],
        "risk_level": "Unknown",
        "confidence": 0.15,
        "confidence_level": "low",
        "recommendation": "Retake the image with good lighting, focus on the water surface/container filling most of the frame, avoid glare or darkness, then re-analyze.",
        "recommended_action": "Retake the image with good lighting and adequate framing of the water, then retry.",
        "limitations": "This is visual screening only and cannot determine chemical or microbiological water quality. Image-based screening requires adequate image quality.",
        "color_abnormalities": "Not assessed due to insufficient image quality.",
        "cloudiness": "not assessed",
        "visible_debris": "Not assessed due to insufficient image quality.",
        "safety_disclaimer": "This is visual screening only and does not replace laboratory water testing.",
        "image_quality": quality.get("visual_quality", "Poor"),
        "image_quality_reason": reason,
        "image_quality_details": quality.get("details", {}),
    }


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
        "unknown": "Unknown",
    }

    return risk_map.get(risk, "Unknown")


def normalize_visual_quality(value: Any) -> str:
    q = str(value or "").strip().lower()
    mapping = {"good": "Good", "fair": "Fair", "poor": "Poor", "unclear": "Unclear"}
    return mapping.get(q, "Unclear")


def normalize_confidence_level(value: Any) -> str:
    cl = str(value or "").strip().lower()
    if cl in ("high", "moderate", "medium", "low"):
        if cl == "medium":
            return "moderate"
        return cl
    return "low"


def normalize_list(value: Any, max_items: int = 8, max_len: int = 400) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        # Single string -> one-item list if not empty
        s = value.strip()
        return [s[:max_len]] if s else []
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value[:max_items]:
        if item is None:
            continue
        s = str(item).strip()
        if s:
            out.append(s[:max_len])
    return out


def normalize_analysis(
    analysis: dict[str, Any],
) -> dict[str, Any]:
    """
    Ensure a stable camera-analysis response schema.
    Supports both legacy fields and new visual-screening fields.
    """
    overall = normalize_text(
        analysis.get("overall_visual_assessment")
        or analysis.get("overall_observation"),
        "No clear visual observation was returned.",
    )
    # Ensure backward-compat alias
    recommendation = normalize_text(
        analysis.get("recommendation") or analysis.get("recommended_action"),
        "Use additional sensor measurements or laboratory testing.",
    )
    limitations = normalize_text(
        analysis.get("limitations"),
        "This is visual screening only and cannot determine chemical or microbiological water quality. It does not replace laboratory water testing.",
    )
    # Enforce visual-screening limitation phrase if missing
    if "visual screening only" not in limitations.lower():
        limitations = limitations + " This is visual screening only and cannot determine chemical or microbiological water quality."

    # Confidence level derived from numeric confidence if missing
    raw_cl = analysis.get("confidence_level")
    if raw_cl is None:
        c = normalize_confidence(analysis.get("confidence"))
        if c >= 0.70:
            raw_cl = "high"
        elif c >= 0.40:
            raw_cl = "moderate"
        else:
            raw_cl = "low"

    return {
        # Core visual observation (new + legacy)
        "overall_visual_assessment": overall,
        "overall_observation": normalize_text(
            analysis.get("overall_observation") or overall,
            overall,
        ),
        "visual_quality": normalize_visual_quality(
            analysis.get("visual_quality") or analysis.get("image_quality") or "Unclear"
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
        # New structured fields
        "observations": normalize_list(
            analysis.get("observations"),
            max_items=6,
        ) or [overall],
        "potential_visual_indicators": normalize_list(
            analysis.get("potential_visual_indicators"),
            max_items=6,
        ),
        "risk_level": normalize_risk_level(
            analysis.get("risk_level")
        ),
        "confidence": normalize_confidence(
            analysis.get("confidence")
        ),
        "confidence_level": normalize_confidence_level(raw_cl),
        "recommendation": recommendation,
        "recommended_action": normalize_text(
            analysis.get("recommended_action") or recommendation,
            recommendation,
        ),
        "limitations": limitations,
        # Legacy extras (keep for frontend)
        "color_abnormalities": normalize_text(
            analysis.get("color_abnormalities"),
            "Not assessed.",
        ),
        "cloudiness": normalize_text(
            analysis.get("cloudiness"),
            "not assessed",
        ),
        "visible_debris": normalize_text(
            analysis.get("visible_debris"),
            "Not assessed.",
        ),
        "safety_disclaimer": normalize_text(
            analysis.get("safety_disclaimer"),
            "This is visual screening only and does not replace laboratory water testing.",
        ),
        # Pass-through image quality if present
        "image_quality": normalize_visual_quality(
            analysis.get("image_quality") or analysis.get("visual_quality") or "Unclear"
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


def get_latest_sensor_context(db: Session) -> dict[str, Any] | None:
    """
    Fetch latest sensor reading for separate SENSOR DATA context.
    Never mixes with camera visual assessment.
    """
    try:
        row = (
            db.query(WaterReading)
            .order_by(WaterReading.recorded_at.desc())
            .first()
        )
        if row is None:
            return None
        return {
            "device_id": row.device_id,
            "temperature": row.temperature,
            "ph": row.ph,
            "turbidity": row.turbidity,
            "tds": row.tds,
            "recorded_at": row.recorded_at.isoformat() if row.recorded_at else None,
        }
    except Exception:
        return None


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

    No authentication required — public API for demo/local use.
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
        # Image quality check BEFORE calling vision model
        # -------------------------------------------------
        quality = check_image_quality(image_bytes)

        # If image is clearly unsuitable, return structured poor-quality analysis
        # without spending provider quota — still save to DB optionally
        if not quality.get("is_suitable"):
            analysis = build_poor_quality_analysis(quality)
            # Ensure analysis goes through normalizer for stable schema
            analysis = normalize_analysis(analysis)
            try:
                agent_answer = camera_agent.answer(analysis)
            except Exception as agent_error:
                print("[CAMERA AGENT ERROR]", str(agent_error))
                agent_answer = {
                    "summary": analysis["overall_observation"],
                    "risk_level": analysis["risk_level"],
                    "recommendations": [analysis["recommendation"]],
                }
            # Try saving even poor-quality result
            prediction_id = None
            try:
                prediction = CameraPrediction(
                    device_id=validated_device_id,
                    user_id=None,
                    image_path=safe_filename,
                    prediction=analysis["overall_observation"],
                    confidence=analysis["confidence"],
                    details=json.dumps(analysis, ensure_ascii=False),
                    created_at=datetime.now(),
                )
                db.add(prediction)
                db.commit()
                db.refresh(prediction)
                prediction_id = prediction.id
            except SQLAlchemyError as database_error:
                db.rollback()
                print("[CAMERA DATABASE ERROR] Failed to save poor-quality prediction:", str(database_error))

            sensor_context = get_latest_sensor_context(db)

            response = {
                "success": True,
                "message": quality.get("reason", "Image quality is insufficient for reliable visual analysis."),
                "analysis": analysis,
                "agent_answer": agent_answer,
                "metadata": {
                    "filename": safe_filename,
                    "content_type": content_type,
                    "provider_requested": (provider.strip() if provider else "automatic"),
                    "model_requested": (model.strip() if model else None),
                    "provider_used": "image_quality_check",
                    "model_used": "image_quality_check",
                    "device_id": validated_device_id,
                    "image_size_bytes": len(image_bytes),
                    "image_quality": quality,
                },
                "sensor_context": sensor_context,
            }
            if prediction_id is not None:
                response["prediction_id"] = prediction_id
                response["saved_to_database"] = True
            else:
                response["saved_to_database"] = False
            # Return with HTTP 200 but structured to indicate poor quality — frontend shows warning
            return response

        # -------------------------------------------------
        # Call the vision-provider interface
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
        # Overlay image quality check result as visual_quality if AI omitted or if we had a Fair warning
        if quality.get("visual_quality") == "Fair" and analysis.get("visual_quality") == "Unclear":
            analysis["visual_quality"] = "Fair"
            analysis["image_quality"] = "Fair"

        # Defensive post-processing: strip any hallucinated chemical claims that may still appear
        # in overall_observation text. We do not modify booleans, just ensure no numeric pH/TDS etc.
        # The prompt already forbids this, but we add a safety scrub.
        forbidden_phrases = [
            "ph is", "ph:", "tds is", "tds:", "ec is", "temperature is",
            "safe to drink", "unsafe to drink", "contains bacteria", "contains heavy metals",
            "bacteria detected", "heavy metals detected", "nitrate", "phosphate", " bod ", " cod ",
        ]
        obs_lower = analysis.get("overall_observation", "").lower()
        for phrase in forbidden_phrases:
            if phrase.strip() in obs_lower and "visual" not in obs_lower:
                # Add limitation reminder instead of removing whole observation
                if "visual screening only" not in analysis["limitations"].lower():
                    analysis["limitations"] += " Visual screening cannot determine chemical or microbiological properties."

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
        # Save prediction (optional - don't block response on DB failure)
        # -------------------------------------------------

        prediction_id = None
        try:
            prediction = CameraPrediction(
                device_id=validated_device_id,
                user_id=None,
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
                created_at=datetime.now(),
            )

            db.add(prediction)
            db.commit()
            db.refresh(prediction)
            prediction_id = prediction.id

        except SQLAlchemyError as database_error:
            db.rollback()
            print(
                "[CAMERA DATABASE ERROR] Failed to save prediction (continuing anyway):",
                str(database_error),
            )
            # Don't raise - the AI analysis succeeded, return it anyway

        # -------------------------------------------------
        # Return result (always return AI analysis, even if DB save failed)
        # -------------------------------------------------

        sensor_context = get_latest_sensor_context(db)

        response = {
            "success": True,
            "message": "Image analyzed successfully.",
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
                "image_quality": quality,
            },
            "sensor_context": sensor_context,
        }

        if prediction_id is not None:
            response["prediction_id"] = prediction_id
            response["saved_to_database"] = True
        else:
            response["saved_to_database"] = False
            response["message"] = "Image analyzed successfully (database save failed, but analysis is returned)."

        return response

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

    except VisionProviderError as vision_error:
        db.rollback()

        error_text = str(vision_error)
        error_code = (
            vision_error.error_code
            or classify_provider_error(error_text)
        )
        status_code = 503

        if error_code == "AI_PROVIDER_AUTH_FAILED":
            status_code = 502
        elif error_code == "AI_PROVIDER_RATE_LIMITED":
            status_code = 429
        elif error_code == "AI_MODEL_UNAVAILABLE":
            status_code = 502
        elif error_code == "AI_MODEL_VISION_UNSUPPORTED":
            status_code = 502

        print(
            "[CAMERA VISION ERROR]",
            f"{type(vision_error).__name__}:",
            error_text,
            f"error_code={error_code}",
        )

        # Keep detail as a readable string for older frontend code
        # while exposing a machine-readable header for newer code.
        raise HTTPException(
            status_code=status_code,
            detail=error_text,
            headers={
                "X-Aqua-Error-Code": error_code,
            },
        ) from vision_error

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
            headers={
                "X-Aqua-Error-Code": "VISION_RESPONSE_INVALID",
            },
        ) from parsing_error

    except Exception as error:
        db.rollback()

        print(
            "[CAMERA ANALYSIS ERROR]",
            f"{type(error).__name__}:",
            str(error),
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Camera AI analysis is currently unavailable. "
                "Please try again later."
            ),
            headers={
                "X-Aqua-Error-Code": classify_provider_error(
                    str(error)
                ),
            },
        ) from error


# =========================================================
# CAMERA PREDICTION HISTORY
# =========================================================

@router.get("/history")
def camera_history(
    device_id: int | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """
    Return camera predictions.

    No authentication required — public API for demo/local use.
    """

    query = db.query(CameraPrediction)

    if device_id is not None:
        query = query.filter(CameraPrediction.device_id == device_id)

    rows = (
        query
        .order_by(CameraPrediction.created_at.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )

    return {
        "success": True,
        "count": len(rows),
        "predictions": [
            {
                "id": row.id,
                "device_id": row.device_id,
                "image_path": row.image_path,
                "prediction": row.prediction,
                "confidence": row.confidence,
                "details": row.details,
                "created_at": (
                    row.created_at.isoformat()
                    if row.created_at is not None
                    else None
                ),
            }
            for row in rows
        ],
    }
