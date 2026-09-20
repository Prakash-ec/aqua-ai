import json
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Device, WaterReading
from backend.services.ai_provider import ask_ai
from backend.services.water_quality import calculate_water_quality


# =========================================================
# ROUTER
# =========================================================

router = APIRouter(
    prefix="/chat",
    tags=["Chat"],
)


# =========================================================
# REQUEST / RESPONSE MODELS
# =========================================================

class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    provider: Optional[str] = None
    model: Optional[str] = None
    device_id: Optional[int] = Field(default=None, ge=1)


class ChatResult(BaseModel):
    success: bool
    answer: str
    model: str


# =========================================================
# SYSTEM PROMPT — bullet-style professional assistant
# =========================================================

SYSTEM_PROMPT = """
You are Aqua AI Assistant — a professional water-quality assistant.

You receive measured sensor data (PostgreSQL) and derived Aqua AI scores.

CRITICAL RULES — follow exactly:

- Answer in concise bullet points. Avoid long paragraphs.
- Use short bold headings (e.g. **Current Water Quality**) followed by 3-6 bullets.
- Answer the question first. Keep each bullet short (one line if possible).
- Use measured sensor values EXACTLY as provided. Never invent numbers.
- Missing values: say "Unavailable". No measured value → no number.
- Distinguish measured values from Aqua AI calculated scores. Calculated scores come from the existing deterministic Aqua AI analysis logic — do NOT recalculate your own.
- Supported measured parameters ONLY: pH, TDS (mg/L), Turbidity (NTU), Temperature (°C). Estimated EC / salinity class / clarity index etc. are derived — label them as calculated/estimated.
- Unsupported parameters (nitrate, phosphate, dissolved oxygen, BOD, COD, hardness, alkalinity, heavy metals, chlorine, microbial/bacteria/coliform, etc.): say the current sensors do not measure that parameter. Never invent a value. Optionally offer to explain what it means.
- Drinking questions: provide screening only. List pH / TDS / Turbidity status vs configured ranges. Include Important: Aqua AI provides screening only; sensors do not measure microbiological and several chemical parameters. Never state "safe to drink" or "unsafe to drink".
- Never claim laboratory certification.
- Do not repeat the user's question. No unnecessary intro like "As an AI...".
- No raw JSON, no tables unless genuinely useful, no emojis.
- Default structure: 1 short heading + 3-6 bullets, optional second heading + 2-4 bullets.

Example good response for "What is my pH?":
**Latest pH**
• pH: 7.20
• Status: Within configured range
• Recorded: 19 Sep 2026, 10:30 am

Example for "What is my current water quality?":
**Current Water Quality**
• pH: 7.20
• TDS: 320 mg/L
• Turbidity: 1.80 NTU
• Temperature: 26.0°C
**Aqua AI Analysis**
• Score: 96/100
• pH: Good
• Salinity: Good
• Clarity: Moderate
• Temperature: Good
**Main observation**
• Turbidity is the main limiting factor.

Return ONLY the final answer text (headings + bullets).
"""


# =========================================================
# HELPER FUNCTIONS
# =========================================================

def format_value(
    value: Any,
    decimals: int = 2,
) -> str:
    if value is None:
        return "Unavailable"
    try:
        return f"{float(value):.{decimals}f}"
    except (TypeError, ValueError):
        return "Unavailable"


def format_ts(ts: Any) -> str:
    if ts is None:
        return "Unavailable"
    try:
        from datetime import datetime
        if isinstance(ts, str):
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        else:
            dt = ts
        return dt.strftime("%d %b %Y, %I:%M %p")
    except Exception:
        return str(ts)


def normalize_question(question: str) -> str:
    return re.sub(r"\s+", " ", question.strip().lower())


def reading_to_dict(
    reading: Optional[WaterReading],
) -> Optional[dict[str, Any]]:
    if reading is None:
        return None
    return {
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
        ),
    }


# ---- Definition detection (educational) ----

def detect_definition_question(question: str) -> Optional[str]:
    q = normalize_question(question)
    if re.search(r"\bwhat\s+is\s+(the\s+)?p\s*h\b", q) or "define ph" in q or "meaning of ph" in q or "explain ph" in q:
        # Avoid conflict with "what is my pH" (contains my)
        if "my ph" not in q and "my p h" not in q and "latest ph" not in q and "current ph" not in q:
            return "ph"
        # If contains "what is ph" but also "my/current/latest" it is direct sensor, not definition
        if re.search(r"what\s+is\s+ph\??$", q.strip()):
            return "ph"
    if re.search(r"\bwhat\s+is\s+(the\s+)?p\s*h\b", q) and "my " not in q and "current" not in q and "latest" not in q:
        # Already handled
        pass
    if any(p in q for p in ["what is temperature", "what is water temperature", "define temperature", "meaning of temperature", "explain temperature"]):
        if "my temperature" not in q and "current temperature" not in q and "latest temperature" not in q:
            return "temperature"
        if re.search(r"what\s+is\s+temperature\??$", q.strip()):
            return "temperature"
    if any(p in q for p in ["what is turbidity", "define turbidity", "meaning of turbidity", "explain turbidity", "what does turbidity mean"]):
        if "my turbidity" not in q and "current turbidity" not in q:
            return "turbidity"
        if re.search(r"what\s+is\s+turbidity\??$", q.strip()):
            return "turbidity"
    if any(p in q for p in ["what is tds", "what is total dissolved solids", "define tds", "meaning of tds", "explain tds"]):
        if "my tds" not in q and "current tds" not in q:
            return "tds"
        if re.search(r"what\s+is\s+tds\??$", q.strip()):
            return "tds"
    # More precise regex for what is X?
    if re.search(r"^\s*what\s+is\s+turbidity\s*\??\s*$", q):
        return "turbidity"
    if re.search(r"^\s*what\s+is\s+ph\s*\??\s*$", q):
        return "ph"
    if re.search(r"^\s*what\s+is\s+tds\s*\??\s*$", q):
        return "tds"
    if re.search(r"^\s*what\s+is\s+temperature\s*\??\s*$", q):
        return "temperature"
    # Generic what is / explain
    if "what is turbidity" in q and "my" not in q:
        return "turbidity"
    if "what is ph" in q and "my" not in q and "latest" not in q and "current" not in q:
        return "ph"
    # Use tighter check to avoid false on latest
    return None


def definition_answer(question: str) -> Optional[str]:
    sensor_type = detect_definition_question(question)
    if sensor_type == "ph":
        return (
            "**pH**\n"
            "• pH indicates how acidic or alkaline water is.\n"
            "• Scale is 0–14; 7 is neutral, below 7 acidic, above 7 alkaline.\n"
            "• Aqua AI reports pH as a measured sensor value."
        )
    if sensor_type == "temperature":
        return (
            "**Temperature**\n"
            "• Temperature indicates how warm the water is.\n"
            "• Aqua AI measures it in °C.\n"
            "• It influences chemical reactions and aquatic life."
        )
    if sensor_type == "turbidity":
        return (
            "**Turbidity**\n"
            "• Turbidity indicates how cloudy or clear water is.\n"
            "• Higher turbidity generally means more suspended material.\n"
            "• Aqua AI measures it in NTU."
        )
    if sensor_type == "tds":
        return (
            "**TDS**\n"
            "• TDS means Total Dissolved Solids.\n"
            "• It represents dissolved substances in water.\n"
            "• Aqua AI reports it in mg/L."
        )
    # Generic turbidity meaning
    q = normalize_question(question)
    if "what does turbidity mean" in q or "explain turbidity" in q:
        return (
            "**Turbidity**\n"
            "• Turbidity indicates how cloudy or clear water is.\n"
            "• Higher turbidity generally means more suspended material.\n"
            "• Aqua AI measures it in NTU."
        )
    return None


# ---- Unsupported parameters ----

UNSUPPORTED_PARAMS = {
    "nitrate": "Nitrate",
    "nitrite": "Nitrite",
    "phosphate": "Phosphate",
    "dissolved oxygen": "Dissolved oxygen",
    "do": "Dissolved oxygen",
    "bod": "BOD",
    "cod": "COD",
    "hardness": "Hardness",
    "alkalinity": "Alkalinity",
    "heavy metal": "Heavy metals",
    "heavy metals": "Heavy metals",
    "lead": "Heavy metals",
    "arsenic": "Heavy metals",
    "mercury": "Heavy metals",
    "chlorine": "Chlorine",
    "fluoride": "Fluoride",
    "microbial": "Microbiological quality",
    "bacteria": "Microbiological quality",
    "bacterial": "Microbiological quality",
    "coliform": "Coliform bacteria",
    "e. coli": "E. coli",
    "ecoli": "E. coli",
    "pathogen": "Pathogens",
    "salmonella": "Pathogens",
}

def detect_unsupported(question: str) -> Optional[str]:
    q = normalize_question(question)
    for key, label in UNSUPPORTED_PARAMS.items():
        # word boundary for short keys like "do" and "bod"
        if key in ("do", "bod", "cod"):
            if re.search(rf"\b{re.escape(key)}\b", q):
                # avoid false positive "do you" but if question asks about level/measurement, treat as unsupported
                if any(w in q for w in ["level", "value", "measure", "what is", "how much", "concentration"]):
                    return label
                # If explicitly asks "what is do" etc
                if key in q:
                    # Need extra check: "do" alone is ambiguous, only if contains "dissolved oxygen" or "do level"
                    if "dissolved oxygen" in q or "do level" in q or "do value" in q:
                        return label
                    continue
        else:
            if key in q:
                return label
    return None

def unsupported_answer(param_label: str) -> str:
    return (
        f"**{param_label}**\n"
        f"• {param_label} is not measured by the current Aqua AI sensors.\n"
        "• No measured value is available.\n"
        "• I can explain what it means if you want."
    )


# ---- Direct sensor detection (expanded) ----

def detect_direct_sensor_question(question: str) -> Optional[str]:
    q = normalize_question(question)
    if detect_definition_question(q):
        return None
    # If unsupported param present, don't treat as direct
    if detect_unsupported(q):
        return None
    # Exact simple forms
    if re.search(r"^\s*what\s+is\s+my\s+p\s*h\s*\??\s*$", q):
        return "ph"
    if re.search(r"^\s*what\s+is\s+my\s+tds\s*\??\s*$", q) or re.search(r"^\s*what\s+is\s+my\s+total\s+dissolved\s+solids", q):
        return "tds"
    if re.search(r"^\s*what\s+is\s+my\s+temperature\s*\??\s*$", q) or re.search(r"^\s*what\s+is\s+my\s+temp\s*\??\s*$", q):
        return "temperature"
    if re.search(r"^\s*what\s+is\s+my\s+turbidity\s*\??\s*$", q):
        return "turbidity"
    # pH questions with current/latest/my
    if re.search(r"\bp\s*h\b", q):
        if any(phrase in q for phrase in ["my ph", "my p h", "current ph", "latest ph", "ph reading", "ph value", "ph level"]):
            return "ph"
        if re.search(r"\bwhat(?:'s| is)\s+(the\s+)?p\s*h\b", q):
            # Only if not asking what is ph definition without my
            if "my" in q or "current" in q or "latest" in q or "value" in q or "reading" in q:
                return "ph"
    if any(phrase in q for phrase in ["current temperature", "latest temperature", "temperature reading", "temperature value", "my temperature", "water temperature"]):
        if "what is temperature" not in q or "my temperature" in q or "current temperature" in q:
            if any(w in q for w in ["what", "current", "latest", "my", "value", "reading"]):
                # Ensure not definition
                if not re.search(r"^\s*what\s+is\s+temperature\s*\??\s*$", q):
                    return "temperature"
    if any(phrase in q for phrase in ["current turbidity", "latest turbidity", "turbidity reading", "turbidity value", "my turbidity", "current cloudiness"]):
        return "turbidity"
    if any(phrase in q for phrase in ["current tds", "latest tds", "tds reading", "tds value", "my tds", "current total dissolved solids"]):
        return "tds"
    # All readings
    if re.search(r"what\s+is\s+my\s+(current\s+)?water\s+quality", q) or re.search(r"current\s+water\s+quality", q):
        return "all"
    if any(phrase in q for phrase in ["current water quality", "latest water quality", "overall water quality"]):
        return "all"
    has_time_word = any(word in q for word in ["current", "latest", "now", "today"])
    has_reading_word = any(word in q for word in ["reading", "readings", "values", "sensors", "sensor data"])
    if has_time_word and has_reading_word:
        return "all"
    return None


def _status_label(quality: Optional[dict], param: str) -> str:
    if not quality or "parameters" not in quality:
        return "Unavailable"
    p = quality["parameters"].get(param)
    if not p:
        return "Unavailable"
    return p.get("status", "Unavailable")


def direct_sensor_answer(
    question: str,
    latest: Optional[WaterReading],
    quality: Optional[dict] = None,
) -> Optional[str]:
    sensor_type = detect_direct_sensor_question(question)
    if sensor_type is None:
        return None
    if latest is None:
        return (
            "**Sensor data**\n"
            "• No water-quality readings available yet.\n"
            "• Please ensure your Aqua AI device has submitted a reading."
        )
    ts = format_ts(latest.recorded_at)
    if sensor_type == "ph":
        status = _status_label(quality, "ph")
        return (
            "**Latest pH**\n"
            f"• pH: {format_value(latest.ph)}\n"
            f"• Status: {status}\n"
            f"• Recorded: {ts}"
        )
    if sensor_type == "temperature":
        status = _status_label(quality, "temperature")
        return (
            "**Latest Temperature**\n"
            f"• Temperature: {format_value(latest.temperature,1)} °C\n"
            f"• Status: {status}\n"
            f"• Recorded: {ts}"
        )
    if sensor_type == "turbidity":
        status = _status_label(quality, "turbidity")
        return (
            "**Latest Turbidity**\n"
            f"• Turbidity: {format_value(latest.turbidity)} NTU\n"
            f"• Status: {status}\n"
            f"• Recorded: {ts}"
        )
    if sensor_type == "tds":
        status = _status_label(quality, "tds")
        return (
            "**Latest TDS**\n"
            f"• TDS: {format_value(latest.tds)} mg/L\n"
            f"• Status: {status}\n"
            f"• Recorded: {ts}"
        )
    if sensor_type == "all":
        return build_water_quality_answer(latest, quality)
    return None


def build_water_quality_answer(latest: WaterReading, quality: Optional[dict]) -> str:
    if latest is None:
        return "**Sensor data**\n• No readings available."
    # Main block
    lines = []
    lines.append("**Current Water Quality**")
    lines.append(f"• pH: {format_value(latest.ph)}")
    lines.append(f"• TDS: {format_value(latest.tds)} mg/L")
    lines.append(f"• Turbidity: {format_value(latest.turbidity)} NTU")
    lines.append(f"• Temperature: {format_value(latest.temperature,1)} °C")
    if quality and quality.get("quality_score") is not None:
        lines.append("")
        lines.append("**Aqua AI Analysis**")
        lines.append(f"• Score: {quality['quality_score']}/100")
        params = quality.get("parameters", {})
        for key, label in [("ph","pH"), ("tds","Salinity"), ("turbidity","Clarity"), ("temperature","Temperature")]:
            st = params.get(key, {}).get("status", "Unavailable")
            # Map tds -> Salinity label already
            lines.append(f"• {label}: {st}")
        # Main observation
        warnings = quality.get("warnings", [])
        # Find main limiting factor: first warning param or lowest status
        if warnings:
            # warnings contain "Ph: Value is outside..." — extract param
            main = warnings[0].split(":")[0] if ":" in warnings[0] else "A parameter"
            # But better use parameter with worst status
            # Find Critical first, then Warning
            worst = None
            for k in ["turbidity","ph","tds","temperature"]:
                s = params.get(k, {}).get("status")
                if s == "Critical":
                    worst = k
                    break
            if not worst:
                for k in ["turbidity","ph","tds","temperature"]:
                    if params.get(k, {}).get("status") == "Warning":
                        worst = k
                        break
            if worst:
                label_map = {"ph":"pH","tds":"TDS/Salinity","turbidity":"Turbidity","temperature":"Temperature"}
                lines.append("")
                lines.append("**Main observation**")
                # Use same wording as spec: Turbidity is main limiting factor etc
                pretty = label_map.get(worst, worst)
                lines.append(f"• {pretty} is the main limiting factor.")
            else:
                lines.append("")
                lines.append("**Main observation**")
                lines.append("• Parameters are mostly within configured ranges.")
        else:
            lines.append("")
            lines.append("**Main observation**")
            lines.append("• Parameters are within configured ranges.")
    else:
        lines.append("")
        lines.append("**Note**")
        lines.append("• Aqua AI score unavailable (no complete reading).")
    return "\n".join(lines)


def detect_water_quality_overall(question: str) -> bool:
    q = normalize_question(question)
    return bool(re.search(r"water\s+quality|overall\s+quality|how\s+is\s+my\s+water|current\s+quality", q))


def detect_why_score(question: str) -> bool:
    q = normalize_question(question)
    return bool(re.search(r"why.*score.*low|why.*low.*score|why.*score|limiting\s+factor|main\s+limitation|what.*limiting|why.*quality.*low", q))


def why_score_answer(latest: WaterReading, quality: Optional[dict]) -> str:
    if latest is None or not quality:
        return "**Aqua AI Score**\n• No score available — no sensor readings."
    score = quality.get("quality_score")
    params = quality.get("parameters", {})
    lines = []
    lines.append("**Why the score is lower**")
    # Provide per-param bullet
    for key, label, unit in [("ph","pH",""), ("tds","Salinity/TDS"," mg/L"), ("turbidity","Turbidity"," NTU"), ("temperature","Temperature"," °C")]:
        val = getattr(latest, key) if hasattr(latest, key) else None
        # For tds, label salinity
        if val is None:
            lines.append(f"• {label}: Unavailable")
        else:
            status = params.get(key, {}).get("status", "Unavailable")
            # Format value
            if key == "temperature":
                v = format_value(val,1) + " °C"
            elif key == "turbidity":
                v = format_value(val) + " NTU"
            elif key == "tds":
                v = format_value(val) + " mg/L"
            else:
                v = format_value(val)
            lines.append(f"• {label}: {v} — {status}")
    # Main limitation
    warnings = quality.get("warnings", [])
    # Find worst
    worst = None
    for k in ["turbidity","ph","tds","temperature"]:
        if params.get(k, {}).get("status") in ("Critical","Warning"):
            worst = k
            break
    if worst is None and quality.get("quality_status") in ("Good",):
        lines.append("")
        lines.append("**Main limitation**")
        lines.append("• No major limitation — score is high.")
    else:
        label_map = {"ph":"pH","tds":"Salinity/TDS","turbidity":"Turbidity","temperature":"Temperature"}
        main = label_map.get(worst, "A parameter") if worst else "Turbidity"
        lines.append("")
        lines.append("**Main limitation**")
        lines.append(f"• {main} is the main limiting factor.")
    if score is not None:
        lines.append(f"• Score: {score}/100")
    return "\n".join(lines)


def detect_agriculture(question: str) -> bool:
    q = normalize_question(question)
    return bool(re.search(r"agricultur|suitab.*farm|crop|irrigat|farming", q))


def agriculture_answer(latest: WaterReading, quality: Optional[dict]) -> str:
    if latest is None or not quality:
        return "**Agriculture**\n• No sensor readings available for suitability check."
    params = quality.get("parameters", {})
    score = quality.get("quality_score")
    # Determine suitability via score
    if score is None:
        overall = "Unavailable"
    elif score >= 80:
        overall = "Highly suitable"
    elif score >= 60:
        overall = "Suitable"
    elif score >= 40:
        overall = "Moderately suitable"
    else:
        overall = "Low suitability"
    # Best matching crop logic simple: based on best param
    # Find best status
    best = None
    for k in ["ph","turbidity","tds","temperature"]:
        if params.get(k, {}).get("status") == "Good":
            best = k
            break
    crop_map = {"ph":"pH-sensitive crops","tds":"Salt-tolerant crops","turbidity":"General crops","temperature":"Warm-season crops"}
    best_crop = crop_map.get(best, "General crops") if best else "General crops — check limiting factor"
    # Limiting factor
    worst = None
    for k in ["turbidity","tds","ph","temperature"]:
        if params.get(k, {}).get("status") in ("Critical","Warning"):
            worst = k
            break
    label_map = {"ph":"pH","tds":"Salinity/TDS","turbidity":"Turbidity","temperature":"Temperature"}
    limiting = label_map.get(worst, "None — all good") if worst else "None"
    lines = []
    lines.append("**Agriculture**")
    lines.append(f"• Overall suitability: {overall} ({score if score is not None else '--'}/100)")
    lines.append(f"• Best matching: {best_crop}")
    lines.append(f"• Main limiting factor: {limiting}")
    lines.append("")
    lines.append("**Why**")
    for key, label in [("ph","pH"), ("tds","Salinity"), ("turbidity","Turbidity"), ("temperature","Temperature")]:
        st = params.get(key, {}).get("status", "Unavailable")
        lines.append(f"• {label}: {st}")
    return "\n".join(lines)


def detect_drinking(question: str) -> bool:
    q = normalize_question(question)
    return bool(re.search(r"safe\s+to\s+drink|drinkable|drinking\s+water|potable|safe.*drink|can\s+i\s+drink", q))


def drinking_answer(latest: WaterReading, quality: Optional[dict]) -> str:
    if latest is None:
        return "**Drinking-Water Screening**\n• No sensor readings available."
    params = quality.get("parameters", {}) if quality else {}
    lines = []
    lines.append("**Drinking-Water Screening**")
    # List params
    ph_v = format_value(latest.ph)
    tds_v = format_value(latest.tds)
    turb_v = format_value(latest.turbidity)
    ph_s = params.get("ph", {}).get("status", "Unavailable") if params else "Unavailable"
    tds_s = params.get("tds", {}).get("status", "Unavailable") if params else "Unavailable"
    turb_s = params.get("turbidity", {}).get("status", "Unavailable") if params else "Unavailable"
    lines.append(f"• pH: {ph_v} — {ph_s}")
    lines.append(f"• TDS: {tds_v} mg/L — {tds_s}")
    lines.append(f"• Turbidity: {turb_v} NTU — {turb_s}")
    # Screening result based on score or statuses
    if quality and quality.get("quality_score") is not None:
        sc = quality["quality_score"]
        if sc >= 80:
            res = "Meets configured screening ranges for measured parameters"
        elif sc >= 60:
            res = "Generally meets screening ranges"
        else:
            res = "Below configured screening ranges"
        lines.append(f"• Screening result: {res}")
    else:
        lines.append("• Screening result: Unavailable")
    lines.append("")
    lines.append("**Important**")
    lines.append("• Aqua AI provides screening only.")
    lines.append("• Current sensors do not measure microbiological and several chemical parameters.")
    lines.append("• Do not state \"safe to drink\" or \"unsafe to drink\" — lab testing required.")
    return "\n".join(lines)


def detect_history(question: str) -> Optional[str]:
    q = normalize_question(question)
    if re.search(r"has\s+my\s+tds\s+increas|tds\s+increas|tds\s+trend|tds\s+change|has\s+tds", q):
        return "tds"
    if re.search(r"has\s+my\s+ph\s+increas|ph\s+trend|ph\s+change", q):
        return "ph"
    if re.search(r"has\s+my\s+turbidity\s+increas|turbidity\s+trend|turbidity\s+change", q):
        return "turbidity"
    if re.search(r"has\s+my\s+temperature\s+increas|temperature\s+trend|temperature\s+change", q):
        return "temperature"
    if re.search(r"has\s+my.*increas|trend|history|change\s+over\s+time", q):
        # Generic trend without param -> use tds as default? Better return generic
        return "generic"
    return None


def history_answer(param: str, recent: list[WaterReading], latest: WaterReading) -> str:
    if not recent or len(recent) < 1:
        return "**Trend**\n• Not enough readings to compare."
    # recent is ordered desc (latest first). Earliest is last.
    latest_val = getattr(latest, param, None) if param != "generic" else None
    earliest = recent[-1]
    earliest_val = getattr(earliest, param, None) if param != "generic" else None
    if param == "generic":
        # Show all
        lines = []
        lines.append("**Trend**")
        lines.append(f"• Earlier: {format_ts(earliest.recorded_at)}")
        lines.append(f"• Latest: {format_ts(latest.recorded_at)}")
        lines.append("• Specify a parameter (pH, TDS, turbidity, temperature) for detailed change.")
        return "\n".join(lines)
    if latest_val is None or earliest_val is None:
        return f"**{param.upper()} Trend**\n• Not enough data for {param}."
    try:
        diff = float(latest_val) - float(earliest_val)
    except:
        diff = 0
    direction = "Increased" if diff > 0 else "Decreased" if diff < 0 else "No change"
    unit = {"ph":"", "tds":" mg/L", "turbidity":" NTU", "temperature":" °C"}.get(param, "")
    decimals = 2 if param != "temperature" else 1
    lines = []
    label = param.upper() if param != "temperature" else "Temperature"
    # Add TDS special
    lines.append(f"**{label} Trend**")
    lines.append(f"• Earlier {label}: {format_value(earliest_val, decimals)}{unit}")
    lines.append(f"• Latest {label}: {format_value(latest_val, decimals)}{unit}")
    lines.append(f"• Change: {format_value(diff, decimals)}{unit}")
    lines.append(f"• Direction: {direction}")
    lines.append("")
    lines.append("**What it means**")
    if abs(diff) < 0.01:
        lines.append(f"• {label} has remained stable.")
    elif direction == "Increased":
        if param == "tds":
            lines.append("• Higher TDS indicates more dissolved solids.")
        elif param == "turbidity":
            lines.append("• Higher turbidity means cloudier water.")
        elif param == "ph":
            lines.append("• Higher pH means more alkaline.")
        else:
            lines.append(f"• {label} has risen — monitor the trend.")
    else:
        lines.append(f"• {label} has decreased — monitor the trend.")
    return "\n".join(lines)


def build_quality_context(reading: Optional[WaterReading]) -> Optional[dict[str, Any]]:
    if reading is None:
        return None
    return calculate_water_quality(
        temperature=reading.temperature,
        ph=reading.ph,
        turbidity=reading.turbidity,
        tds=reading.tds,
    )


# =========================================================
# CHAT ENDPOINT
# =========================================================

@router.post(
    "/water",
    response_model=ChatResult,
)
def chat_water(
    request: ChatRequest,
    db: Session = Depends(get_db),
):
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    try:
        reading_query = db.query(WaterReading)
        if request.device_id is not None:
            reading_query = reading_query.filter(WaterReading.device_id == request.device_id)
            device = db.query(Device).filter(Device.id == request.device_id).first()
            if device is None:
                raise HTTPException(status_code=404, detail="Device not found.")
        else:
            device = None
        latest = reading_query.order_by(WaterReading.recorded_at.desc()).first()
        if latest is not None and device is None:
            device = db.query(Device).filter(Device.id == latest.device_id).first()

        # Build quality early for direct handlers needing status
        quality_result = build_quality_context(latest)

        # 1. Unsupported parameters first (highest priority for nitrate etc)
        unsupported = detect_unsupported(question)
        if unsupported:
            return {"success": True, "answer": unsupported_answer(unsupported), "model": "aqua-ai-grounded"}

        # 2. Definition / educational
        definition = definition_answer(question)
        if definition is not None:
            return {"success": True, "answer": definition, "model": "aqua-ai-definition"}

        # 3. Drinking screening
        if detect_drinking(question):
            if latest is None:
                return {"success": True, "answer": "**Drinking-Water Screening**\n• No sensor readings available.", "model": "postgresql"}
            return {"success": True, "answer": drinking_answer(latest, quality_result), "model": "postgresql-grounded"}

        # 4. Agriculture suitability
        if detect_agriculture(question):
            if latest is None:
                return {"success": True, "answer": "**Agriculture**\n• No sensor readings available.", "model": "postgresql"}
            return {"success": True, "answer": agriculture_answer(latest, quality_result), "model": "postgresql-grounded"}

        # 5. Why score low
        if detect_why_score(question):
            if latest is None:
                return {"success": True, "answer": "**Aqua AI Score**\n• No readings available.", "model": "postgresql"}
            return {"success": True, "answer": why_score_answer(latest, quality_result), "model": "postgresql-grounded"}

        # 6. History / trend
        hist_param = detect_history(question)
        if hist_param:
            if latest is None:
                return {"success": True, "answer": "**Trend**\n• No readings available.", "model": "postgresql"}
            recent_query = db.query(WaterReading)
            if request.device_id is not None:
                recent_query = recent_query.filter(WaterReading.device_id == request.device_id)
            recent = recent_query.order_by(WaterReading.recorded_at.desc()).limit(12).all()
            return {"success": True, "answer": history_answer(hist_param, recent, latest), "model": "postgresql-grounded"}

        # 7. Overall water quality
        if detect_water_quality_overall(question):
            if latest is None:
                return {"success": True, "answer": "**Sensor data**\n• No readings available yet.", "model": "postgresql"}
            return {"success": True, "answer": build_water_quality_answer(latest, quality_result), "model": "postgresql-grounded"}

        # 8. Direct sensor questions (simple)
        direct_answer = direct_sensor_answer(question=question, latest=latest, quality=quality_result)
        if direct_answer is not None:
            return {"success": True, "answer": direct_answer, "model": "postgresql-direct"}

        # 9. No data guard
        if latest is None:
            return {"success": True, "answer": "**Sensor data**\n• No water-quality readings available yet.\n• Please ensure your Aqua AI device has submitted a reading.", "model": "postgresql"}

        # 10. Fallback to LLM for remaining questions
        recent_query = db.query(WaterReading)
        if request.device_id is not None:
            recent_query = recent_query.filter(WaterReading.device_id == request.device_id)
        recent = recent_query.order_by(WaterReading.recorded_at.desc()).limit(12).all()

        latest_dict = reading_to_dict(latest)
        recent_dict = [reading_to_dict(r) for r in recent]
        quality_result = build_quality_context(latest)
        device_dict = None
        if device is not None:
            device_dict = {"id": device.id, "name": device.name, "location": device.location, "device_type": device.device_type}
        context = {
            "latest_reading": latest_dict,
            "recent_readings": recent_dict,
            "device": device_dict,
            "calculated_quality": quality_result,
        }
        user_content = f"""
USER QUESTION:
{question}

AQUA AI SENSOR DATA:
{json.dumps(context, indent=2, default=str)}

INSTRUCTIONS:
- Answer in concise bullet points with bold headings.
- Use measured values exactly as provided.
- For unsupported parameters, say not measured.
- For drinking, give screening only, never safe/unsafe.
- Distinguish measured vs calculated.
"""

        try:
            ai_result = ask_ai(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                provider=request.provider,
                model=request.model,
            )
            answer_text = str(ai_result.get("answer") or "").strip()
            if not answer_text:
                raise RuntimeError("Empty AI response")
            return {"success": True, "answer": answer_text, "model": ai_result.get("model") or "unknown"}
        except Exception as llm_error:
            # Provider failure fallback — still return grounded data if possible
            print(f"Aqua AI chat LLM fallback: {type(llm_error).__name__}: {llm_error}")
            # Try to give grounded summary instead of error
            if detect_direct_sensor_question(question) or detect_water_quality_overall(question):
                # Already handled above; this shouldn't happen
                fallback = build_water_quality_answer(latest, quality_result)
            else:
                fallback = (
                    "**AI Assistant**\n"
                    "• Sensor data is available.\n"
                    "• The AI explanation service is temporarily unavailable.\n"
                    "• Please try again shortly.\n"
                    "\n"
                    + build_water_quality_answer(latest, quality_result)
                )
            return {"success": True, "answer": fallback, "model": "fallback-grounded"}

    except HTTPException:
        raise
    except SQLAlchemyError:
        print("Aqua AI chat database error.")
        raise HTTPException(status_code=500, detail="A database error occurred while retrieving water-quality information.")
    except Exception as error:
        print(f"Aqua AI chat provider error: {type(error).__name__}: {error}")
        raise HTTPException(status_code=503, detail="The Aqua AI chatbot is temporarily unavailable. Please try again later.")
