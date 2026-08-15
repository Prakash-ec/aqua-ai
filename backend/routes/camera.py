import os
import json
import base64
import re

from fastapi import APIRouter, UploadFile, File, HTTPException
from openai import OpenAI


router = APIRouter(
    prefix="/camera",
    tags=["Camera AI"]
)


# =========================================================
# CONFIGURATION
# =========================================================

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


# =========================================================
# CHECK API KEY
# =========================================================

if not OPENROUTER_API_KEY:
    print("WARNING: OPENROUTER_API_KEY is not configured")


# =========================================================
# CLIENT
# =========================================================

client = None

if OPENROUTER_API_KEY:

    client = OpenAI(
        api_key=OPENROUTER_API_KEY,
        base_url=OPENROUTER_BASE_URL
    )


# =========================================================
# AI PROMPT
# =========================================================

SYSTEM_PROMPT = """
You are Aqua AI, a water-surface visual screening system.

Analyze ONLY what can reasonably be observed in the supplied image.

Your task is to identify visual indicators related to:

1. Oil sheen
2. Algae
3. Foam
4. Floating particles or debris
5. General water appearance

IMPORTANT:

This is visual screening only.

Do NOT claim that oil, microplastics, chemicals,
bacteria, heavy metals, or other pollutants are chemically
confirmed from an image.

For oil:
Use "Possible oil sheen" when rainbow-like,
iridescent, reflective, thin-film patterns could indicate oil.

For algae:
Look for visually apparent green, brown, or biological
growth patterns or mats.

For foam:
Look for visible white or bubbly foam.

For floating particles:
Look for clearly visible particles, debris, suspended material,
or floating objects.

Consider lighting, reflections, glare, and image quality.

Return ONLY valid JSON.

Use exactly this structure:

{
  "is_water_image": true,
  "overall_observation": "...",
  "oil_sheen": "Possible oil sheen / Not visually detected / Uncertain",
  "algae": "Detected / Not visually detected / Uncertain",
  "foam": "Detected / Not visually detected / Uncertain",
  "floating_particles": "Detected / Not visually detected / Uncertain",
  "water_appearance": "...",
  "pollution_concern": "Low / Moderate / High / Uncertain",
  "confidence": 0,
  "recommendation": "...",
  "limitations": "Visual screening cannot chemically confirm pollution and does not replace laboratory testing."
}

Confidence must be an integer from 0 to 100.

Be conservative.
Do not treat color alone as proof of pollution.
"""


# =========================================================
# HELPER: EXTRACT JSON
# =========================================================

def extract_json(text: str):

    if not text:
        return None

    text = text.strip()

    # Direct JSON
    try:
        return json.loads(text)
    except Exception:
        pass

    # Remove markdown code fences
    text = re.sub(
        r"```json\s*",
        "",
        text,
        flags=re.IGNORECASE
    )

    text = re.sub(
        r"```\s*",
        "",
        text
    )

    text = text.strip()

    try:
        return json.loads(text)
    except Exception:
        pass

    # Find first JSON object
    start = text.find("{")
    end = text.rfind("}")

    if start != -1 and end != -1 and end > start:

        candidate = text[start:end + 1]

        try:
            return json.loads(candidate)
        except Exception:
            pass

    return None


# =========================================================
# CAMERA ANALYSIS
# =========================================================

@router.post("/analyze")
async def analyze_water_image(
    image: UploadFile = File(...)
):

    # -----------------------------------------------------
    # Check API
    # -----------------------------------------------------

    if client is None:

        raise HTTPException(
            status_code=500,
            detail="OPENROUTER_API_KEY is not configured on the server."
        )


    # -----------------------------------------------------
    # Check file
    # -----------------------------------------------------

    if not image.content_type:

        raise HTTPException(
            status_code=400,
            detail="Image content type is missing."
        )


    if not image.content_type.startswith("image/"):

        raise HTTPException(
            status_code=400,
            detail="Please upload an image file."
        )


    # -----------------------------------------------------
    # Read image
    # -----------------------------------------------------

    image_bytes = await image.read()


    if not image_bytes:

        raise HTTPException(
            status_code=400,
            detail="Uploaded image is empty."
        )


    # -----------------------------------------------------
    # Convert image to Base64
    # -----------------------------------------------------

    encoded_image = base64.b64encode(
        image_bytes
    ).decode("utf-8")


    image_url = (
        f"data:{image.content_type};base64,{encoded_image}"
    )


    # -----------------------------------------------------
    # Call OpenRouter
    # -----------------------------------------------------

    try:

        response = client.chat.completions.create(

            model=MODEL,

            messages=[

                {
                    "role": "system",
                    "content": SYSTEM_PROMPT
                },

                {
                    "role": "user",

                    "content": [

                        {
                            "type": "text",

                            "text":
                                "Analyze this water image "
                                "and return only the requested JSON."
                        },

                        {
                            "type": "image_url",

                            "image_url": {
                                "url": image_url
                            }
                        }

                    ]
                }

            ],

            temperature=0.1,

            max_tokens=1000

        )


    except Exception as e:

        print(
            "OpenRouter error:",
            repr(e)
        )

        raise HTTPException(
            status_code=502,
            detail=f"AI provider error: {str(e)}"
        )


    # -----------------------------------------------------
    # Get AI response
    # -----------------------------------------------------

    try:

        content = response.choices[0].message.content

    except Exception:

        content = None


    if not content:

        raise HTTPException(
            status_code=502,
            detail="OpenRouter returned an empty response."
        )


    print(
        "AI RAW RESPONSE:",
        content
    )


    # -----------------------------------------------------
    # Parse JSON
    # -----------------------------------------------------

    result = extract_json(content)


    if result is None:

        raise HTTPException(
            status_code=502,
            detail="AI returned invalid JSON."
        )


    # -----------------------------------------------------
    # Add model information
    # -----------------------------------------------------

    result["model"] = MODEL


    # -----------------------------------------------------
    # Normalize confidence
    # -----------------------------------------------------

    confidence = result.get(
        "confidence",
        0
    )

    try:

        confidence = int(confidence)

    except Exception:

        confidence = 0


    confidence = max(
        0,
        min(100, confidence)
    )


    result["confidence"] = confidence


    # -----------------------------------------------------
    # Final response
    # -----------------------------------------------------

    return {

        "success": True,

        "model": MODEL,

        "analysis": result

    }