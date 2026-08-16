import os
import json
import base64
import traceback
import re

from fastapi import (
    APIRouter,
    UploadFile,
    File,
    Form,
    HTTPException,
)

from dotenv import load_dotenv
from openai import OpenAI


# =========================================================
# LOAD ENVIRONMENT
# =========================================================

load_dotenv()


# =========================================================
# GROQ CONFIGURATION
# =========================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

GROQ_VISION_MODEL = "qwen/qwen3.6-27b"


# =========================================================
# GROQ CLIENT
# =========================================================

groq_client = None

if GROQ_API_KEY:

    groq_client = OpenAI(
        api_key=GROQ_API_KEY,
        base_url="https://api.groq.com/openai/v1",
    )

    print("GROQ_API_KEY loaded successfully")

else:

    print("WARNING: GROQ_API_KEY is not configured")


# =========================================================
# ROUTER
# =========================================================

router = APIRouter(
    prefix="/camera",
    tags=["Camera AI"],
)


# =========================================================
# SYSTEM PROMPT
# =========================================================

CAMERA_SYSTEM_PROMPT = """
You are Aqua AI Vision.

Analyze the uploaded water image.

RETURN ONLY A VALID JSON OBJECT.

Do not provide reasoning.
Do not use <think>.
Do not use markdown.
Do not use code fences.
Do not provide explanations before or after the JSON.

The response must contain EXACTLY these fields:

{
  "confidence": 0,
  "overall_observation": "",
  "oil_sheen": "",
  "algae": "",
  "foam": "",
  "floating_particles": "",
  "water_appearance": "",
  "pollution_concern": "",
  "recommendation": "",
  "limitations": ""
}

RULES:

1. Only describe characteristics visible in the photograph.

2. Never invent sensor measurements.

3. Never claim to measure:
   - pH
   - TDS
   - temperature
   - turbidity
   - dissolved oxygen
   - chemical concentration
   - bacteria
   - pathogens
   - heavy metals
   - toxins

4. Never claim that the water is safe to drink.

5. Do not provide medical advice or diagnosis.

6. Do not claim laboratory accuracy.

7. A normal photograph cannot reliably detect microplastics.

8. A photograph cannot reliably determine dissolved chemicals.

9. If something cannot be determined, use exactly:

"Not determinable from image"

10. confidence must be an integer between 0 and 100.

11. Keep descriptions concise.

12. Recommendation should suggest laboratory or sensor testing when appropriate.

13. Return the JSON immediately.

14. Do not output reasoning.
"""


# =========================================================
# REQUIRED FIELDS
# =========================================================

REQUIRED_FIELDS = [
    "confidence",
    "overall_observation",
    "oil_sheen",
    "algae",
    "foam",
    "floating_particles",
    "water_appearance",
    "pollution_concern",
    "recommendation",
    "limitations",
]


# =========================================================
# CLEAN JSON RESPONSE
# =========================================================

def clean_json_response(text: str) -> str:

    if not text:

        raise ValueError(
            "Vision model returned an empty response."
        )

    text = text.strip()

    # -----------------------------------------------------
    # Remove <think> blocks if model accidentally returns
    # reasoning despite the API setting.
    # -----------------------------------------------------

    text = re.sub(
        r"<think>.*?</think>",
        "",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # If an unfinished <think> block appears,
    # remove everything before the first JSON object.
    if "<think>" in text.lower():

        think_start = re.search(
            r"<think>",
            text,
            flags=re.IGNORECASE,
        )

        if think_start:

            text = text[
                think_start.end():
            ]

    text = text.strip()

    # -----------------------------------------------------
    # Remove markdown code fences
    # -----------------------------------------------------

    text = re.sub(
        r"```json",
        "",
        text,
        flags=re.IGNORECASE,
    )

    text = text.replace(
        "```",
        "",
    )

    text = text.strip()

    # -----------------------------------------------------
    # Find JSON object
    # -----------------------------------------------------

    start = text.find("{")
    end = text.rfind("}")

    if start == -1 or end == -1 or end <= start:

        raise ValueError(
            "Vision model did not return a JSON object."
        )

    json_text = text[
        start:end + 1
    ]

    return json_text.strip()


# =========================================================
# VALIDATE ANALYSIS
# =========================================================

def validate_analysis(data: dict) -> dict:

    if not isinstance(data, dict):

        raise ValueError(
            "Vision response is not a JSON object."
        )

    # -----------------------------------------------------
    # Add missing fields
    # -----------------------------------------------------

    for field in REQUIRED_FIELDS:

        if field not in data:

            if field == "confidence":

                data[field] = 0

            else:

                data[field] = (
                    "Not determinable from image"
                )

    # -----------------------------------------------------
    # Validate confidence
    # -----------------------------------------------------

    try:

        confidence = float(
            data["confidence"]
        )

        confidence = max(
            0,
            min(
                100,
                confidence,
            ),
        )

        data["confidence"] = int(
            confidence
        )

    except Exception:

        data["confidence"] = 0

    # -----------------------------------------------------
    # Validate text fields
    # -----------------------------------------------------

    for field in REQUIRED_FIELDS:

        if field == "confidence":
            continue

        value = data.get(field)

        if value is None:

            value = (
                "Not determinable from image"
            )

        data[field] = str(value).strip()

        if not data[field]:

            data[field] = (
                "Not determinable from image"
            )

    # -----------------------------------------------------
    # Return ONLY required fields
    # -----------------------------------------------------

    return {
        field: data[field]
        for field in REQUIRED_FIELDS
    }


# =========================================================
# CAMERA ANALYSIS
# =========================================================

@router.post("/analyze")
async def analyze_camera(
    image: UploadFile = File(...),
    provider: str | None = Form(None),
    model: str | None = Form(None),
):

    # =====================================================
    # DETERMINE VISION MODEL
    # =====================================================

    selected_provider = (provider or "").strip().lower()
    selected_model = (model or "").strip()
    effective_provider = "groq"
    effective_model = GROQ_VISION_MODEL

    if selected_provider in {"groq", "automatic", ""}:
        effective_provider = "groq"
    else:
        effective_provider = "groq"

    if selected_model and selected_model != "automatic":
        effective_model = selected_model

    # =====================================================
    # CHECK API KEY
    # =====================================================

    if not GROQ_API_KEY or groq_client is None:

        raise HTTPException(
            status_code=503,
            detail=(
                "GROQ_API_KEY is not configured."
            ),
        )

    # =====================================================
    # VALIDATE IMAGE TYPE
    # =====================================================

    if not image.content_type:

        raise HTTPException(
            status_code=400,
            detail="Image content type is missing.",
        )

    if not image.content_type.startswith("image/"):

        raise HTTPException(
            status_code=400,
            detail="Only image files are allowed.",
        )

    try:

        # =================================================
        # READ IMAGE
        # =================================================

        image_bytes = await image.read()

        if not image_bytes:

            raise HTTPException(
                status_code=400,
                detail="Uploaded image is empty.",
            )

        # =================================================
        # SIZE LIMIT
        # =================================================

        max_size = 10 * 1024 * 1024

        if len(image_bytes) > max_size:

            raise HTTPException(
                status_code=413,
                detail=(
                    "Image is too large. "
                    "Maximum size is 10 MB."
                ),
            )

        # =================================================
        # BASE64 ENCODE
        # =================================================

        base64_image = base64.b64encode(
            image_bytes
        ).decode("utf-8")

        image_url = (
            f"data:{image.content_type};base64,"
            f"{base64_image}"
        )

        # =================================================
        # LOG REQUEST
        # =================================================

        print("")
        print("========================================")
        print("AQUA AI VISION ANALYSIS")
        print("========================================")
        print(
            "Filename:",
            image.filename,
        )
        print(
            "Content type:",
            image.content_type,
        )
        print(
            "Size:",
            len(image_bytes),
            "bytes",
        )
        print(
            "Provider:",
            effective_provider,
        )
        print(
            "Model:",
            effective_model,
        )
        print(
            "Reasoning: disabled"
        )
        print(
            "JSON mode: enabled"
        )
        print("========================================")

        # =================================================
        # GROQ VISION REQUEST
        # =================================================

        response = groq_client.chat.completions.create(

            model=effective_model,

            messages=[

                {
                    "role": "system",

                    "content": CAMERA_SYSTEM_PROMPT,
                },

                {
                    "role": "user",

                    "content": [

                        {
                            "type": "text",

                            "text": (
                                "Analyze this water image "
                                "and return ONLY the JSON object."
                            ),
                        },

                        {
                            "type": "image_url",

                            "image_url": {
                                "url": image_url,
                            },
                        },

                    ],
                },

            ],

            # -------------------------------------------------
            # Deterministic output
            # -------------------------------------------------

            temperature=0,

            # -------------------------------------------------
            # Disable Qwen reasoning
            # -------------------------------------------------

            reasoning_effort="none",

            # -------------------------------------------------
            # Force JSON response
            # -------------------------------------------------

            response_format={
                "type": "json_object"
            },

            # -------------------------------------------------
            # Enough tokens for the JSON
            # -------------------------------------------------

            max_tokens=700,
        )

        # =================================================
        # CHECK RESPONSE
        # =================================================

        if not response.choices:

            raise ValueError(
                "Groq returned no response choices."
            )

        raw_answer = (
            response
            .choices[0]
            .message
            .content
        )

        # =================================================
        # LOG RAW RESPONSE
        # =================================================

        print("")
        print("VISION RAW RESPONSE:")
        print(raw_answer)
        print("")

        # =================================================
        # CLEAN RESPONSE
        # =================================================

        cleaned = clean_json_response(
            raw_answer
        )

        print("")
        print("CLEANED JSON:")
        print(cleaned)
        print("")

        # =================================================
        # PARSE JSON
        # =================================================

        try:

            analysis = json.loads(
                cleaned
            )

        except json.JSONDecodeError as e:

            print("")
            print(
                "JSON PARSE ERROR:",
                str(e),
            )

            print(
                "CLEANED RESPONSE:",
                cleaned,
            )

            raise ValueError(
                "Vision model returned invalid JSON."
            )

        # =================================================
        # VALIDATE
        # =================================================

        analysis = validate_analysis(
            analysis
        )

        # =================================================
        # SUCCESS LOG
        # =================================================

        print("========================================")
        print("VISION ANALYSIS SUCCESS")
        print("========================================")

        print(
            json.dumps(
                analysis,
                indent=2,
                ensure_ascii=False,
            )
        )

        print("========================================")
        print("")

        # =================================================
        # RETURN RESPONSE
        # =================================================

        return {

            "success": True,

            "analysis": analysis,

            "filename": image.filename,

            "content_type": image.content_type,

            "size_bytes": len(image_bytes),

            "provider": effective_provider,

            "model": effective_model,

        }

    # =====================================================
    # HTTP ERROR
    # =====================================================

    except HTTPException:

        raise

    # =====================================================
    # AI ERROR
    # =====================================================

    except Exception as e:

        print("")
        print("========================================")
        print("AQUA AI VISION ERROR")
        print("========================================")

        print(
            "ERROR TYPE:",
            type(e).__name__,
        )

        print("")

        print(
            "ERROR:",
            str(e),
        )

        print("")

        print("TRACEBACK:")

        traceback.print_exc()

        print("========================================")
        print("")

        raise HTTPException(

            status_code=503,

            detail=(
                "Vision AI analysis failed. "
                "Check the backend terminal for details."
            ),
        )