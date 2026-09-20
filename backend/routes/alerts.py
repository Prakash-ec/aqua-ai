import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Alert, AlertContact, Device, WaterReading, AlertConfiguration
from backend.services.alert_service import send_manual_status, get_effective_config, get_active_email_contacts
from backend.services.email_service import is_email_configured, get_email_config_status, send_email, build_status_email
from backend.services.alert_config import ALERT_COOLDOWN_SECONDS

router = APIRouter(prefix="/alerts", tags=["Alerts"])

class ContactCreate(BaseModel):
    name: str
    email: str
    active: bool = True
    email_enabled: bool = True

class ContactUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    active: bool | None = None
    email_enabled: bool | None = None

def validate_contact(data: dict):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    email = (data.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        raise HTTPException(status_code=400, detail="Invalid email format")
    return name, email

@router.get("/contacts")
def list_contacts(db: Session = Depends(get_db)):
    return db.query(AlertContact).order_by(AlertContact.created_at.desc()).all()

@router.post("/contacts", status_code=201)
def create_contact(payload: ContactCreate, db: Session = Depends(get_db)):
    name, email = validate_contact(payload.model_dump())
    c = AlertContact(name=name, email=email, active=payload.active if payload.active is not None else True, email_enabled=payload.email_enabled if payload.email_enabled is not None else True)
    # legacy columns set to defaults
    c.phone_number = None
    c.sms_enabled = False
    db.add(c); db.commit(); db.refresh(c)
    return c

@router.put("/contacts/{cid}")
def update_contact(cid: int, payload: ContactUpdate, db: Session = Depends(get_db)):
    c = db.query(AlertContact).filter(AlertContact.id==cid).first()
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    merged = {"name": data.get("name", c.name), "email": data.get("email", c.email)}
    name, email = validate_contact(merged)
    for k,v in data.items():
        setattr(c, k, v)
    c.name = name; c.email = email
    db.commit(); db.refresh(c)
    return c

@router.delete("/contacts/{cid}")
def delete_contact(cid: int, db: Session = Depends(get_db)):
    c = db.query(AlertContact).filter(AlertContact.id==cid).first()
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    c.active = False
    db.commit()
    return {"success": True, "deactivated": True}

@router.get("")
def list_alerts(status: str = "all", db: Session = Depends(get_db)):
    cfg = get_effective_config(db)
    cooldown_sec = (cfg.cooldown_minutes * 60) if hasattr(cfg, 'cooldown_minutes') else ALERT_COOLDOWN_SECONDS
    q = db.query(Alert).order_by(Alert.created_at.desc())
    if status in ("active","resolved"):
        q = q.filter(Alert.status==status)
    alerts = q.limit(200).all()
    out=[]
    for a in alerts:
        cooldown_remaining = 0
        if a.status=="active" and a.last_notified_at:
            import datetime as dt
            now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
            elapsed = (now - a.last_notified_at).total_seconds()
            remaining = cooldown_sec - elapsed
            if remaining>0:
                cooldown_remaining = int(remaining)
        out.append({
            "id": a.id, "device_id": a.device_id, "reading_id": a.reading_id, "parameter": a.parameter,
            "severity": a.severity, "current_value": a.current_value, "threshold_value": a.threshold_value,
            "message": a.message, "status": a.status, "created_at": a.created_at, "resolved_at": a.resolved_at,
            "last_notified_at": a.last_notified_at, "email_status": a.email_status,
            "cooldown_remaining": cooldown_remaining, "cooldown_seconds": cooldown_sec
        })
    return out

@router.get("/active")
def list_active(db: Session = Depends(get_db)):
    return list_alerts(status="active", db=db)

class ConfigUpdate(BaseModel):
    ph_min: float
    ph_max: float
    turbidity_max: float
    tds_max: float
    temperature_max: float
    cooldown_minutes: int
    alerts_enabled: bool

def _validate_config_payload(data: dict):
    # basic range checks
    for k in ["ph_min","ph_max","turbidity_max","tds_max","temperature_max","cooldown_minutes"]:
        v = data.get(k)
        if v is None:
            raise HTTPException(status_code=400, detail=f"{k} is required")
        if not isinstance(v, (int,float)) or isinstance(v, bool):
            raise HTTPException(status_code=400, detail=f"{k} must be a number")
        if v != v or v in [float('inf'), float('-inf')]:
            raise HTTPException(status_code=400, detail=f"{k} must be finite")
    if data["ph_min"] >= data["ph_max"]:
        raise HTTPException(status_code=400, detail="pH minimum must be less than maximum")
    if not (0 <= data["ph_min"] <= 14 and 0 <= data["ph_max"] <= 14):
        raise HTTPException(status_code=400, detail="pH thresholds must be 0-14")
    if data["turbidity_max"] < 0 or data["turbidity_max"] > 100000:
        raise HTTPException(status_code=400, detail="Turbidity must be 0-100000")
    if data["tds_max"] < 0 or data["tds_max"] > 100000:
        raise HTTPException(status_code=400, detail="TDS must be 0-100000")
    if data["temperature_max"] < -50 or data["temperature_max"] > 150:
        raise HTTPException(status_code=400, detail="Temperature must be -50 to 150")
    if data["cooldown_minutes"] < 0 or data["cooldown_minutes"] > 1440:
        raise HTTPException(status_code=400, detail="Cooldown must be 0-1440 minutes")

@router.get("/config")
def get_config(db: Session = Depends(get_db)):
    cfg = get_effective_config(db)
    return {
        "ph_min": cfg.ph_min,
        "ph_max": cfg.ph_max,
        "turbidity_max": cfg.turbidity_max,
        "tds_max": cfg.tds_max,
        "temperature_max": cfg.temperature_max,
        "cooldown_minutes": cfg.cooldown_minutes,
        "alerts_enabled": cfg.alerts_enabled,
        "updated_at": getattr(cfg, "updated_at", None),
        "created_at": getattr(cfg, "created_at", None),
    }

@router.put("/config")
def update_config(payload: ConfigUpdate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    _validate_config_payload(data)
    cfg = get_effective_config(db)
    # get_effective_config already creates row if missing
    # need to fetch actual DB object to update
    db_cfg = db.query(AlertConfiguration).first()
    if not db_cfg:
        db_cfg = AlertConfiguration(**data)
        db.add(db_cfg)
    else:
        for k,v in data.items():
            setattr(db_cfg, k, v)
    db.commit()
    db.refresh(db_cfg)
    return {
        "ph_min": db_cfg.ph_min,
        "ph_max": db_cfg.ph_max,
        "turbidity_max": db_cfg.turbidity_max,
        "tds_max": db_cfg.tds_max,
        "temperature_max": db_cfg.temperature_max,
        "cooldown_minutes": db_cfg.cooldown_minutes,
        "alerts_enabled": db_cfg.alerts_enabled,
        "updated_at": db_cfg.updated_at,
    }


@router.get("/{aid}")
def get_alert(aid: int, db: Session = Depends(get_db)):
    a = db.query(Alert).filter(Alert.id==aid).first()
    if not a:
        raise HTTPException(status_code=404, detail="Alert not found")
    return a

@router.post("/{aid}/resolve")
def resolve_alert(aid: int, db: Session = Depends(get_db)):
    a = db.query(Alert).filter(Alert.id==aid).first()
    if not a:
        raise HTTPException(status_code=404, detail="Alert not found")
    if a.status=="active":
        from datetime import timezone, datetime
        a.status="resolved"
        a.resolved_at=datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit(); db.refresh(a)
    return a

@router.post("/send-current-status")
def send_current_status(db: Session = Depends(get_db)):
    result = send_manual_status(db)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error","Failed"))
    return result

@router.post("/test-email")
def test_email(db: Session = Depends(get_db)):
    contacts = get_active_email_contacts(db)
    if not contacts:
        raise HTTPException(status_code=400, detail="No active email contacts")
    if not is_email_configured():
        raise HTTPException(status_code=400, detail="Email provider not configured")
    reading = db.query(WaterReading).order_by(WaterReading.recorded_at.desc()).first()
    readings_dict = {"temperature": reading.temperature if reading else "--", "ph": reading.ph if reading else "--", "turbidity": reading.turbidity if reading else "--", "tds": reading.tds if reading else "--"}
    device_name = "Aqua AI Test"
    if reading:
        dev = db.query(Device).filter(Device.id==reading.device_id).first()
        if dev: device_name = dev.name
    subj, html, text = build_status_email(reading or type('obj',(),readings_dict)(), device_name, readings_dict)
    subj = "[TEST] " + subj
    results=[]
    for c in contacts:
        if c.email:
            r = send_email(c.email, subj, html, text)
            results.append({"contact": c.name, "email": c.email, "result": r})
    return {"success": True, "results": results, "provider": get_email_config_status()}

@router.get("/provider/status")
def provider_status():
    return {"email": get_email_config_status()}
