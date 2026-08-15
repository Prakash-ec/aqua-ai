import os
import base64
import json

from fastapi import APIRouter, UploadFile, File, HTTPException
from openai import OpenAI

router = APIRouter(
    prefix="/camera",
    tags=["Camera AI"]
)

# ============================================================
# OPENROUTER CONFIGURATION
# ============================================================

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

if not OPENROUTER_API_KEY:
    raise RuntimeError(
        "OPENROUTER_API_KEY environment variable is not set"
    )

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY
)

# ============================================================
# STRONGER FREE VISION MODEL
# ============================================================

MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"


# ============================================================
# AQUA AI PROMPT
# ============================================================

PROMPT = """
You are Aqua AI, an AI-assisted water-surface visual
screening system.

Analyze the uploaded image carefully.

Your task is ONLY visual screening.
Do not claim that a chemical contaminant has been
scientifically confirmed from an image.

============================================================
STEP 1 — DETERMINE WHETHER THIS IS A WATER IMAGE
============================================================

First determine whether a visible water surface exists.

If the image is NOT a water image, return:

{
  "is_water_image": false,
  "overall_observation": "...",
  "oil_sheen": "Not applicable",
  "algae": "Not applicable",
  "foam": "Not applicable",
  "floating_particles": "Not applicable",
  "water_appearance": "No water visible",
  "pollution_concern": "Cannot determine",
  "confidence": 0,
  "recommendation": "Please upload a clear image of a water surface.",
  "limitations": "Visual screening cannot chemically confirm pollution and does not replace laboratory testing."
}

============================================================
STEP 2 — WATER SURFACE ANALYSIS
============================================================

If water is visible, examine these categories separately.

------------------------------------------------------------
A. OIL SHEEN
------------------------------------------------------------

Look specifically for:

- rainbow or iridescent colors
- thin multicolored surface films
- metallic-looking surface reflections
- smooth glossy patches
- swirling film patterns
- colors that change across the surface

Important:

Normal reflections from sunlight, sky, buildings,
vegetation or camera exposure can resemble an oil sheen.

Therefore:

DO NOT say "oil confirmed".

Use:

"Possible oil sheen"

when the visual characteristics could indicate oil.

Use:

"Not visually detected"

when there is no convincing visual evidence.

Use:

"Uncertain"

when the image quality is insufficient.

------------------------------------------------------------
B. ALGAE
------------------------------------------------------------

Look for:

- green floating material
- brown/green mats
- visible biological growth
- surface scum
- concentrated patches of algae-like material

Do not classify normal green reflections as algae.

------------------------------------------------------------
C. FOAM
------------------------------------------------------------

Look for:

- white foam
- froth
- bubbles
- persistent foam patches

Do not classify normal water bubbles as pollution automatically.

------------------------------------------------------------
D. FLOATING PARTICLES / DEBRIS
------------------------------------------------------------

Look for:

- plastic
- leaves
- visible particles
- floating dirt
- trash
- organic debris
- sediment-like material

Only report what is visually supported.

------------------------------------------------------------
E. WATER APPEARANCE
------------------------------------------------------------

Describe:

- clear
- cloudy
- muddy
- dark
- greenish
- brownish
- unusual coloration
- visible surface film
- normal-looking

Do not infer chemical composition from color alone.

============================================================
POLLUTION CONCERN
============================================================

Use:

"Low"

when no obvious visual pollution indicator exists.

"Moderate"

when there are some suspicious visual indicators.

"High"

when strong visible pollution indicators exist.

"Uncertain"

when image quality or scene ambiguity prevents
a reliable visual assessment.

============================================================
CONFIDENCE
============================================================

Give an overall visual confidence from 0 to 100.

This is NOT a laboratory accuracy measurement.

============================================================
RECOMMENDATION
============================================================

Give a practical recommendation based ONLY on
the visible evidence.

For suspicious water:

Recommend further inspection and appropriate
laboratory testing.

For possible oil sheen:

Recommend avoiding direct contact and obtaining
appropriate environmental/water testing.

============================================================
OUTPUT FORMAT
============================================================

Return ONLY valid JSON.

Do NOT return markdown.

Do NOT return explanations outside the JSON.

Do NOT return <think>.

Use exactly:

{
  "is_water_image": true,
  "overall_observation": "...",
  "oil_sheen": "...",
  "algae": "...",
  "foam": "...",
  "floating_particles": "...",
  "water_appearance": "...",
  "pollution_concern": "...",
  "confidence": 0,
  "recommendation": "...",
  "limitations": "Visual screening cannot chemically confirm pollution and does not replace laboratory testing."
}
"""


# ============================================================
# REMOVE MODEL THINKING / MARKDOWN
# ============================================================

def clean_model_response(text: str) -> str:

    if not text:
        return ""

    text = text.strip()

    # Remove <think>...</think>
    if "<think>" in text:

        if "</think>" in text:

            text = text.split(
                "</think>",
                1
            )[1].strip()

    # Remove markdown JSON block
    if text.startswith("```json"):

        text = text[len("```json"):].strip()

    elif text.startswith("```"):

        text = text[len("```"):].strip()

    if text.endswith("```"):

        text = text[:-3].strip()

    return text


# ============================================================
# TRY TO EXTRACT JSON
# ============================================================

def parse_json_response(text: str):

    text = clean_model_response(text)

    if not text:
        return None

    try:

        return json.loads(text)

    except json.JSONDecodeError:

        pass

    # Try extracting JSON object from surrounding text
    start = text.find("{")
    end = text.rfind("}")

    if start != -1 and end != -1 and end > start:

        possible_json = text[
            start:end + 1
        ]

        try:

            return json.loads(possible_json)

        except json.JSONDecodeError:

            return None

    return None


# ============================================================
# POST /camera/analyze
# ============================================================

@router.post("/analyze")
async def analyze_water_image(
    file: UploadFile = File(...)
):

    # --------------------------------------------------------
    # FILE VALIDATION
    # --------------------------------------------------------

    if not file.content_type:

        raise HTTPException(
            status_code=400,
            detail="Could not determine uploaded file type."
        )

    if not file.content_type.startswith("image/"):

        raise HTTPException(
            status_code=400,
            detail="Please upload an image file."
        )

    # --------------------------------------------------------
    # READ IMAGE
    # --------------------------------------------------------

    image_bytes = await file.read()

    if not image_bytes:

        raise HTTPException(
            status_code=400,
            detail="Uploaded image is empty."
        )

    # --------------------------------------------------------
    # BASE64 IMAGE
    # --------------------------------------------------------

    image_base64 = base64.b64encode(
        image_bytes
    ).decode("utf-8")

    image_url = (
        f"data:{file.content_type};base64,{image_base64}"
    )

    # --------------------------------------------------------
    # CALL OPENROUTER
    # --------------------------------------------------------

    try:

        response = client.chat.completions.create(

            model=MODEL,

            messages=[
                {
                    "role": "user",

                    "content": [

                        {
                            "type": "text",
                            "text": PROMPT
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

            max_tokens=1200
        )

        # ----------------------------------------------------
        # CHECK CHOICES
        # ----------------------------------------------------

        if not response.choices:

            raise Exception(
                "OpenRouter returned no choices."
            )

        message = response.choices[0].message

        # ----------------------------------------------------
        # GET CONTENT
        # ----------------------------------------------------

        result = message.content

        # Some reasoning models may return unusual
        # content structures. Handle the normal case first.

        if result is None:

            raise Exception(
                "OpenRouter returned an empty response."
            )

        # ----------------------------------------------------
        # CLEAN RESPONSE
        # ----------------------------------------------------

        result = clean_model_response(result)

        if not result:

            raise Exception(
                "OpenRouter returned empty text after cleaning."
            )

        # ----------------------------------------------------
        # PARSE JSON
        # ----------------------------------------------------

        analysis = parse_json_response(result)

        # ----------------------------------------------------
        # IF MODEL DID NOT RETURN JSON
        # ----------------------------------------------------

        if analysis is None:

            analysis = {

                "is_water_image": True,

                "overall_observation": result,

                "oil_sheen": "Uncertain",

                "algae": "Uncertain",

                "foam": "Uncertain",

                "floating_particles": "Uncertain",

                "water_appearance": "Unable to structure response",

                "pollution_concern": "Uncertain",

                "confidence": 0,

                "recommendation": (
                    "Please inspect the image manually "
                    "and consider laboratory testing."
                ),

                "limitations": (
                    "Visual screening cannot chemically "
                    "confirm pollution and does not replace "
                    "laboratory testing."
                )
            }

        # ----------------------------------------------------
        # NORMALIZE CONFIDENCE
        # ----------------------------------------------------

        if "confidence" in analysis:

            try:

                confidence = float(
                    analysis["confidence"]
                )

                confidence = max(
                    0,
                    min(100, confidence)
                )

                analysis["confidence"] = confidence

            except (ValueError, TypeError):

                analysis["confidence"] = 0

        # ----------------------------------------------------
        # RETURN RESULT
        # ----------------------------------------------------

        return {

            "success": True,

            "model": MODEL,

            "analysis": analysis

        }

    # --------------------------------------------------------
    # ERROR HANDLING
    # --------------------------------------------------------

    except Exception as e:

        raise HTTPException(

            status_code=500,

            detail=f"AI analysis failed: {str(e)}"

        )