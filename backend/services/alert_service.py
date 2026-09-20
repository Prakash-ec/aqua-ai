from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from backend.models import Alert, AlertContact, Device, WaterReading
from backend.models import AlertConfiguration
from backend.services.alert_config import (
    PH_CRITICAL_LOW, PH_CRITICAL_HIGH,
    TURBIDITY_CRITICAL_HIGH, TDS_CRITICAL_HIGH, TEMPERATURE_CRITICAL_HIGH,
    ALERT_COOLDOWN_SECONDS
)
from backend.services.email_service import send_email, build_critical_email, build_status_email, build_combined_critical_email, send_combined_critical_alert

def get_effective_config(db=None):
    """Return AlertConfiguration from DB or defaults. Creates row if missing."""
    defaults = {
        "ph_min": PH_CRITICAL_LOW,
        "ph_max": PH_CRITICAL_HIGH,
        "turbidity_max": TURBIDITY_CRITICAL_HIGH,
        "tds_max": TDS_CRITICAL_HIGH,
        "temperature_max": TEMPERATURE_CRITICAL_HIGH,
        "cooldown_minutes": ALERT_COOLDOWN_SECONDS // 60,
        "alerts_enabled": True,
    }
    if db is None:
        return type("Cfg", (), defaults)()
    try:
        cfg = db.query(AlertConfiguration).first()
        if not cfg:
            cfg = AlertConfiguration(**defaults)
            db.add(cfg)
            db.commit()
            db.refresh(cfg)
        return cfg
    except Exception:
        try: db.rollback()
        except: pass
        return type("Cfg", (), defaults)()

def get_active_email_contacts(db: Session):
    """Return CURRENT active email contacts from the database.

    Always queried live at alert-processing time — never cached — so a
    newly added recipient is included in the very next automatic email.
    NULL ``email_enabled`` (legacy rows created before the column existed)
    is treated as enabled; only an explicit ``False`` opts a contact out.
    """
    contacts = db.query(AlertContact).filter(AlertContact.active == True).all()
    return [c for c in contacts if c.email and c.email_enabled is not False]

def _now_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None)

def evaluate_reading(reading: WaterReading, cfg=None):
    """Return list of (param, current, threshold_value, threshold_str, message) for critical params. Uses DB config if provided."""
    if cfg is None:
        # fallback to defaults (no DB)
        ph_min, ph_max = PH_CRITICAL_LOW, PH_CRITICAL_HIGH
        turb_max, tds_max, temp_max = TURBIDITY_CRITICAL_HIGH, TDS_CRITICAL_HIGH, TEMPERATURE_CRITICAL_HIGH
    else:
        ph_min, ph_max = cfg.ph_min, cfg.ph_max
        turb_max, tds_max, temp_max = cfg.turbidity_max, cfg.tds_max, cfg.temperature_max
    crits = []
    if reading.ph is not None:
        if reading.ph < ph_min:
            crits.append(("ph", reading.ph, ph_min, f"below {ph_min}", f"Critical threshold exceeded: pH {reading.ph} below {ph_min}"))
        elif reading.ph > ph_max:
            crits.append(("ph", reading.ph, ph_max, f"above {ph_max}", f"Critical threshold exceeded: pH {reading.ph} above {ph_max}"))
    if reading.turbidity is not None and reading.turbidity > turb_max:
        crits.append(("turbidity", reading.turbidity, turb_max, f"above {turb_max} NTU", f"Critical threshold exceeded: Turbidity {reading.turbidity} NTU above {turb_max}"))
    if reading.tds is not None and reading.tds > tds_max:
        crits.append(("tds", reading.tds, tds_max, f"above {tds_max} mg/L", f"Critical threshold exceeded: TDS {reading.tds} mg/L above {tds_max}"))
    if reading.temperature is not None and reading.temperature > temp_max:
        crits.append(("temperature", reading.temperature, temp_max, f"above {temp_max} °C", f"Critical threshold exceeded: Temperature {reading.temperature} °C above {temp_max}"))
    return crits

def _should_send_combined(db: Session, device_id: int, cfg=None) -> bool:
    """Device-level cooldown: if any active alert for device has last_notified within cooldown, suppress."""
    if cfg is None:
        cfg = get_effective_config(db)
    cooldown = (cfg.cooldown_minutes * 60) if hasattr(cfg, 'cooldown_minutes') else ALERT_COOLDOWN_SECONDS
    active = db.query(Alert).filter(Alert.device_id==device_id, Alert.status=="active").all()
    if not active:
        return True
    notified = [a for a in active if a.last_notified_at is not None]
    if not notified:
        return True
    latest = max(a.last_notified_at for a in notified)
    elapsed = (_now_utc() - latest).total_seconds()
    return elapsed >= cooldown

def _send_combined_for_reading(db: Session, reading: WaterReading, device_name: str, critical_structs: list):
    """Send ONE combined email to all active contacts, update all involved alerts' status."""
    email_contacts = get_active_email_contacts(db)
    if not email_contacts:
        # mark all involved alerts as not_configured
        for param in [p["parameter"] for p in critical_structs]:
            al = db.query(Alert).filter(Alert.device_id==reading.device_id, Alert.parameter==param, Alert.status=="active").first()
            if al:
                al.email_status = "not_configured"
        return {"status": "not_configured"}

    results = []
    for c in email_contacts:
        res = send_combined_critical_alert(device_name, reading, critical_structs, c.email)
        results.append(res)

    def agg(results):
        successes = sum(1 for r in results if r.get("success"))
        not_config = sum(1 for r in results if r.get("status") == "not_configured")
        if successes == len(results):
            return "sent"
        if not_config == len(results):
            return "not_configured"
        if successes == 0:
            return "failed"
        return "partial"
    status = agg(results)
    # Update all involved alerts with same status. Only a successful (or
    # partially successful) delivery arms the device-level cooldown: a total
    # failure must NOT suppress the next attempt, otherwise a recipient added
    # (or a provider fixed) after a failure would be blocked by a cooldown
    # that was armed without any email actually going out.
    now = _now_utc()
    for param in [p["parameter"] for p in critical_structs]:
        al = db.query(Alert).filter(Alert.device_id==reading.device_id, Alert.parameter==param, Alert.status=="active").first()
        if al:
            al.email_status = status
            if status in ("sent", "partial"):
                al.last_notified_at = now
    return {"status": status, "results": results}

def process_reading_alerts(db: Session, reading: WaterReading):
    """Evaluate reading, create/update alerts, handle combined cooldown and notifications, resolve recovered params."""
    try:
        cfg = get_effective_config(db)
        # If alerts disabled, still detect/store critical conditions but do not send email
        alerts_enabled = getattr(cfg, 'alerts_enabled', True)
        device = db.query(Device).filter(Device.id == reading.device_id).first()
        device_name = device.name if device else f"Device {reading.device_id}"
        readings_dict = {"temperature": reading.temperature, "ph": reading.ph, "turbidity": reading.turbidity, "tds": reading.tds}
        crits = evaluate_reading(reading, cfg)
        crit_params = set(p for p,_,_,_,_ in crits)

        # Build structured critical params for combined email
        critical_structs = []
        for param, cur, thr_val, thr_str, msg in crits:
            # direction based on cfg thresholds
            direction = "below" if param=="ph" and cur < cfg.ph_min else "above"
            critical_structs.append({"parameter": param, "current_value": cur, "threshold": thr_val, "direction": direction, "threshold_str": thr_str, "message": msg})

        # Create/update individual alert records (no per-param email yet) — always stored even if alerts disabled
        for param, cur, thr_val, thr_str, msg in crits:
            existing = db.query(Alert).filter(Alert.device_id==reading.device_id, Alert.parameter==param, Alert.status=="active").first()
            if existing:
                existing.current_value = cur
                existing.reading_id = reading.id
                existing.threshold_value = thr_val
                existing.message = msg
                db.commit()
            else:
                new_alert = Alert(
                    device_id=reading.device_id,
                    reading_id=reading.id,
                    parameter=param,
                    severity="critical",
                    current_value=cur,
                    threshold_value=thr_val,
                    message=msg,
                    status="active",
                )
                db.add(new_alert)
                db.commit()

        # After records are up to date, decide on combined email (only if alerts enabled)
        if critical_structs and alerts_enabled:
            if _should_send_combined(db, reading.device_id, cfg):
                _send_combined_for_reading(db, reading, device_name, critical_structs)
                db.commit()
            else:
                # cooldown active: do not send, but keep alerts active
                pass

        # Resolve alerts for params that are now normal
        all_active = db.query(Alert).filter(Alert.device_id==reading.device_id, Alert.status=="active").all()
        for al in all_active:
            if al.parameter not in crit_params:
                al.status = "resolved"
                al.resolved_at = _now_utc()
                db.commit()
    except Exception as e:
        try: db.rollback()
        except: pass
        print(f"[ALERT SERVICE] Error processing alerts: {e}")

def send_manual_status(db: Session):
    """Send current status to all active contacts, ignoring cooldown. Email only. Combined. Respects alerts_enabled."""
    cfg = get_effective_config(db)
    if not getattr(cfg, 'alerts_enabled', True):
        return {"success": False, "error": "Email alerts are currently disabled. Enable alerts in Alert Settings to send notifications."}
    reading = db.query(WaterReading).order_by(WaterReading.recorded_at.desc()).first()
    if not reading:
        return {"success": False, "error": "No readings available"}
    device = db.query(Device).filter(Device.id == reading.device_id).first()
    device_name = device.name if device else f"Device {reading.device_id}"
    readings_dict = {"temperature": reading.temperature, "ph": reading.ph, "turbidity": reading.turbidity, "tds": reading.tds}
    email_contacts = get_active_email_contacts(db)
    if not email_contacts:
        return {"success": False, "error": "No active email contacts"}

    # If currently critical, send combined critical email (bypass cooldown)
    crits = evaluate_reading(reading, cfg)
    if crits:
        critical_structs = []
        for param, cur, thr_val, thr_str, msg in crits:
            direction = "below" if param=="ph" and cur < cfg.ph_min else "above"
            critical_structs.append({"parameter": param, "current_value": cur, "threshold": thr_val, "direction": direction})
        # send combined critical
        email_sent = email_failed = 0
        email_not_configured = 0
        for c in email_contacts:
            res = send_combined_critical_alert(device_name, reading, critical_structs, c.email)
            if res.get("success"):
                email_sent+=1
            elif res.get("status")=="not_configured":
                email_not_configured+=1
                email_failed+=1
            else:
                email_failed+=1
        return {"success": True, "email_sent": email_sent, "email_failed": email_failed, "email_not_configured": email_not_configured}

    # otherwise status email (one per contact)
    email_sent = email_failed = 0
    email_not_configured = 0
    for c in email_contacts:
        subj, html, text = build_status_email(reading, device_name, readings_dict)
        from backend.services.email_service import send_email
        res = send_email(c.email, subj, html, text)
        if res.get("success"):
            email_sent+=1
        elif res.get("status")=="not_configured":
            email_not_configured+=1
            email_failed+=1
        else:
            email_failed+=1

    return {"success": True, "email_sent": email_sent, "email_failed": email_failed, "email_not_configured": email_not_configured}
