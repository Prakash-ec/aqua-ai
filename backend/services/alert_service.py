import os
import threading
import time
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

def _cooldown_seconds(cfg=None) -> int:
    if cfg is not None and hasattr(cfg, 'cooldown_minutes'):
        try:
            return max(0, int(cfg.cooldown_minutes) * 60)
        except (TypeError, ValueError):
            pass
    return ALERT_COOLDOWN_SECONDS

def _param_cooldown_remaining(db: Session, device_id: int, parameter: str, cfg=None, quiet: bool = False) -> int:
    """Remaining cooldown seconds for one device + parameter. 0 means eligible.

    Only a successfully delivered notification (email_status sent/partial with
    last_notified_at set) arms the cooldown. Failures and unconfigured
    providers never suppress a retry.
    Checks the latest notification event for (device_id, parameter) regardless
    of whether an alert record was resolved.
    """
    cooldown = _cooldown_seconds(cfg)
    if cooldown <= 0:
        return 0

    last_sent = (
        db.query(Alert)
        .filter(
            Alert.device_id == device_id,
            Alert.parameter == parameter,
            Alert.email_status.in_(["sent", "partial"]),
            Alert.last_notified_at.isnot(None),
        )
        .order_by(Alert.last_notified_at.desc(), Alert.id.desc())
        .first()
    )

    if not last_sent or not last_sent.last_notified_at:
        if not quiet:
            print(f"[AUTO ALERT] parameter={parameter} cooldown_remaining=0 eligible=true")
        return 0

    elapsed = (_now_utc() - last_sent.last_notified_at).total_seconds()
    remaining = cooldown - elapsed
    if remaining > 0:
        if not quiet:
            print(f"[AUTO ALERT] parameter={parameter} cooldown_remaining={int(remaining)} eligible=false")
        return int(remaining)

    if not quiet:
        print(f"[AUTO ALERT] parameter={parameter} cooldown_remaining=0 eligible=true")
    return 0

def _should_send_combined(db: Session, device_id: int, cfg=None) -> bool:
    """Legacy device-level check kept for compatibility."""
    active = db.query(Alert).filter(Alert.device_id==device_id, Alert.status=="active").all()
    if not active:
        return True
    return any(_param_cooldown_remaining(db, device_id, a.parameter, cfg) == 0 for a in active)

def _send_combined_for_reading(db: Session, reading: WaterReading, device_name: str, critical_structs: list):
    """Send ONE combined email covering only cooldown-eligible parameters.

    Parameters still inside their own device + parameter cooldown are left
    out of this email. Only parameters actually included in a successful
    (or partially successful) delivery get last_notified_at armed; total failure
    or unconfigured provider arms nothing so the next reading can retry immediately.
    """
    cfg = get_effective_config(db)
    eligible = [
        p for p in critical_structs
        if _param_cooldown_remaining(db, reading.device_id, p["parameter"], cfg, quiet=True) == 0
    ]
    print(f"[AUTO ALERT] reading_id={reading.id} device_id={reading.device_id} "
          f"critical_parameters={[p['parameter'] for p in critical_structs]}")
    for p in critical_structs:
        _param_cooldown_remaining(db, reading.device_id, p["parameter"], cfg, quiet=False)
    if not eligible:
        try:
            _rem = _param_cooldown_remaining(db, reading.device_id, critical_structs[0]["parameter"], cfg, quiet=True)
        except Exception:
            _rem = "?"
        print(f"[AUTO ALERT] cooldown active remaining_seconds={_rem} email suppressed")
        return {"status": "cooldown"}

    email_contacts = get_active_email_contacts(db)
    if not email_contacts:
        print(f"[AUTO ALERT] no active email contacts: cooldown NOT started")
        for param in [p["parameter"] for p in eligible]:
            al = (
                db.query(Alert)
                .filter(Alert.device_id == reading.device_id, Alert.parameter == param, Alert.status == "active")
                .order_by(Alert.id.desc())
                .first()
            )
            if al:
                al.email_status = "not_configured"
        return {"status": "not_configured"}

    eligible_param_names = [p["parameter"] for p in eligible]
    print(f"[AUTO ALERT] sending email...")

    results = []
    message_ids = []
    for c in email_contacts:
        res = send_combined_critical_alert(device_name, reading, eligible, c.email)
        results.append(res)
        _mid = res.get("id") or res.get("message_id")
        if _mid:
            message_ids.append(_mid)

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
    now = _now_utc()
    cooldown_sec = _cooldown_seconds(cfg)
    next_iso = _iso_utc(now + timedelta(seconds=cooldown_sec))

    for param in eligible_param_names:
        al = (
            db.query(Alert)
            .filter(Alert.device_id == reading.device_id, Alert.parameter == param, Alert.status == "active")
            .order_by(Alert.id.desc())
            .first()
        )
        if al is None:
            continue
        if status in ("sent", "partial"):
            if al.last_notified_at is not None:
                # Repeat notification after cooldown expiry: preserve the
                # previous send as immutable history. Resolve the old row
                # (it keeps its original reading_id + timestamps) and open
                # a fresh active row for the new send, so the email-history
                # list grows instead of being overwritten in place.
                al.status = "resolved"
                al.resolved_at = now
                db.flush()
                fresh = Alert(
                    device_id=reading.device_id,
                    reading_id=reading.id,
                    parameter=al.parameter,
                    severity=al.severity or "critical",
                    current_value=al.current_value,
                    threshold_value=al.threshold_value,
                    message=al.message,
                    status="active",
                    created_at=now,
                    last_notified_at=now,
                    email_status=status,
                )
                db.add(fresh)
                print(f"[AUTO ALERT] email sent successfully message_id={message_ids[0] if message_ids else 'n/a'}")
                print(f"[AUTO ALERT] cooldown started last_notified_at={_iso_utc(now)} next_eligible_at={next_iso}")
            else:
                al.email_status = status
                al.reading_id = reading.id
                al.last_notified_at = now
                if al.created_at is None:
                    al.created_at = now
                print(f"[AUTO ALERT] email sent successfully message_id={message_ids[0] if message_ids else 'n/a'}")
                print(f"[AUTO ALERT] cooldown started last_notified_at={_iso_utc(now)} next_eligible_at={next_iso}")
        else:
            al.email_status = status
            print(f"[AUTO ALERT] email failed cooldown NOT started")

    return {
        "status": status,
        "results": results,
        "message_id": message_ids[0] if message_ids else None,
        "last_notified_at": _iso_utc(now) if status in ("sent", "partial") else None,
        "next_eligible_at": next_iso if status in ("sent", "partial") else None,
    }

def process_reading_alerts(db: Session, reading: WaterReading):
    """Evaluate reading, create/update alerts, handle combined cooldown and notifications, resolve recovered params.

    Returns a JSON-safe outcome summary so backend-driven callers (for
    example the startup check) can log the real decision:
    ``{"reading_id", "device_id", "status", "critical_parameters",
    "message_id", "last_notified_at", "next_eligible_at"}``.
    """
    outcome = {
        "reading_id": getattr(reading, "id", None),
        "device_id": getattr(reading, "device_id", None),
        "status": "normal",
        "critical_parameters": [],
        "message_id": None,
        "last_notified_at": None,
        "next_eligible_at": None,
    }
    try:
        cfg = get_effective_config(db)
        alerts_enabled = getattr(cfg, 'alerts_enabled', True)
        device = db.query(Device).filter(Device.id == reading.device_id).first()
        device_name = device.name if device else f"Device {reading.device_id}"
        crits = evaluate_reading(reading, cfg)
        crit_params = set(p for p,_,_,_,_ in crits)
        outcome["critical_parameters"] = [p for p,_,_,_,_ in crits]

        if not crit_params:
            print(f"[AUTO ALERT] reading_id={reading.id} device_id={reading.device_id} status=NORMAL no email")
        elif not alerts_enabled:
            outcome["status"] = "alerts_disabled"

        # Build structured critical params for combined email
        critical_structs = []
        for param, cur, thr_val, thr_str, msg in crits:
            direction = "below" if param == "ph" and cur < cfg.ph_min else "above"
            critical_structs.append({
                "parameter": param, "current_value": cur, "threshold": thr_val,
                "direction": direction, "threshold_str": thr_str, "message": msg
            })

        # Create/update individual alert records.
        # A row that already records a successful notification keeps its
        # original reading_id + last_notified_at + email_status untouched
        # here: a suppressed reading (still inside cooldown) must only
        # refresh the live values, never move the history entry that the
        # email-history list is grouped by. The send path above re-points
        # (or rolls) the row only when a new email actually goes out.
        for param, cur, thr_val, thr_str, msg in crits:
            existing = (
                db.query(Alert)
                .filter(Alert.device_id == reading.device_id, Alert.parameter == param, Alert.status == "active")
                .order_by(Alert.id.desc())
                .first()
            )
            if existing:
                existing.current_value = cur
                existing.threshold_value = thr_val
                existing.message = msg
                if existing.last_notified_at is None:
                    existing.reading_id = reading.id
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
                    created_at=_now_utc(),
                )
                db.add(new_alert)
                db.commit()

        # Log debug information for each critical parameter
        for s in critical_structs:
            _param_cooldown_remaining(db, reading.device_id, s["parameter"], cfg, quiet=False)

        # Decide on combined email
        if critical_structs and alerts_enabled:
            eligible_params = [
                p["parameter"] for p in critical_structs
                if _param_cooldown_remaining(db, reading.device_id, p["parameter"], cfg, quiet=True) == 0
            ]
            if eligible_params:
                send_out = _send_combined_for_reading(db, reading, device_name, critical_structs)
                db.commit()
                outcome["status"] = (send_out or {}).get("status", "unknown")
                outcome["message_id"] = (send_out or {}).get("message_id")
                outcome["last_notified_at"] = (send_out or {}).get("last_notified_at")
                outcome["next_eligible_at"] = (send_out or {}).get("next_eligible_at")
            else:
                _rem0 = _param_cooldown_remaining(db, reading.device_id, critical_structs[0]["parameter"], cfg, quiet=True)
                print(f"[AUTO ALERT] cooldown active remaining_seconds={_rem0} email suppressed")
                outcome["status"] = "cooldown"
                outcome["remaining_seconds"] = _rem0

        # Resolve alerts for params that are now normal
        all_active = db.query(Alert).filter(Alert.device_id == reading.device_id, Alert.status == "active").all()
        for al in all_active:
            if al.parameter not in crit_params:
                al.status = "resolved"
                al.resolved_at = _now_utc()
                db.commit()

    except Exception as e:
        try: db.rollback()
        except: pass
        print(f"[ALERT SERVICE] Error processing alerts: {e}")
        outcome["status"] = "error"
        outcome["error"] = f"{type(e).__name__}: {e}"

    return outcome

# =========================================================
# BACKEND-STARTUP AUTOMATIC ALERT CHECK
# =========================================================

def run_startup_auto_alert_check(db: Session) -> dict:
    """Evaluate the LATEST stored reading as soon as the backend is live.

    Automatic alerts are backend-driven and must never depend on the browser.
    When the backend becomes live the newest reading of every device is
    evaluated immediately: if it is critical and the (device, parameter)
    cooldown is not active, the REAL email is sent at once instead of waiting
    for another reading to be ingested.

    Cooldown honesty is preserved:
      * an active cooldown (persisted ``last_notified_at`` in the database)
        suppresses the email and is NEVER reset by a restart,
      * expiry alone still sends nothing while the backend keeps running —
        the next critical reading is what triggers the next email,
      * a failed/unconfigured email arms no cooldown, so the next check may
        retry immediately.

    Timestamps are only written by the sending path in
    :func:`process_reading_alerts` after the provider confirms delivery, so
    this check is safe to run repeatedly.
    """
    summary = {"checked": 0, "results": []}
    try:
        cfg = get_effective_config(db)
        alerts_enabled = bool(getattr(cfg, "alerts_enabled", True))
        print("[AUTO ALERT] startup check: evaluating latest stored reading")

        device_ids = [
            row[0]
            for row in db.query(WaterReading.device_id).distinct().all()
            if row[0] is not None
        ]
        if not device_ids:
            print("[AUTO ALERT] startup check: no readings stored nothing to do")
            return summary

        for device_id in sorted(device_ids):
            reading = (
                db.query(WaterReading)
                .filter(WaterReading.device_id == device_id)
                .order_by(WaterReading.id.desc())
                .first()
            )
            if reading is None:
                continue
            summary["checked"] += 1
            critical_params = [p for p, _, _, _, _ in evaluate_reading(reading, cfg)]
            reading_age = None
            try:
                recorded = getattr(reading, "recorded_at", None)
                if recorded is not None:
                    reading_age = int((_now_utc() - recorded).total_seconds())
            except Exception:
                reading_age = None

            if not critical_params:
                print(f"[AUTO ALERT] startup check reading_id={reading.id} "
                      f"device_id={device_id} status=NORMAL no email")
                summary["results"].append({
                    "device_id": device_id, "reading_id": reading.id,
                    "status": "normal", "critical_parameters": [],
                })
                continue

            if not alerts_enabled:
                print(f"[AUTO ALERT] startup check reading_id={reading.id} "
                      f"device_id={device_id} status=alerts_disabled no email")
                summary["results"].append({
                    "device_id": device_id, "reading_id": reading.id,
                    "status": "alerts_disabled", "critical_parameters": critical_params,
                })
                continue

            eligible = [
                p for p in critical_params
                if _param_cooldown_remaining(db, device_id, p, cfg, quiet=True) == 0
            ]
            if not eligible:
                remaining = max(
                    _param_cooldown_remaining(db, device_id, p, cfg, quiet=True)
                    for p in critical_params
                )
                print(f"[AUTO ALERT] startup check reading_id={reading.id} "
                      f"device_id={device_id} critical_parameters={critical_params}")
                print(f"[AUTO ALERT] startup check cooldown active "
                      f"remaining_seconds={remaining} email suppressed "
                      f"(timestamp from DB, cooldown preserved)")
                summary["results"].append({
                    "device_id": device_id, "reading_id": reading.id,
                    "status": "cooldown", "critical_parameters": critical_params,
                    "remaining_seconds": remaining,
                })
                continue

            print(f"[AUTO ALERT] startup check reading_id={reading.id} "
                  f"device_id={device_id} reading_age_seconds={reading_age} "
                  f"critical_parameters={critical_params} "
                  f"eligible={eligible}")
            print("[AUTO ALERT] startup check: latest reading is critical "
                  "with no active cooldown, sending email immediately")
            send_result = process_reading_alerts(db, reading) or {}
            summary["results"].append({
                "device_id": device_id, "reading_id": reading.id,
                "reading_age_seconds": reading_age,
                "status": send_result.get("status", "unknown"),
                "critical_parameters": critical_params,
                "message_id": send_result.get("message_id"),
                "last_notified_at": send_result.get("last_notified_at"),
                "next_eligible_at": send_result.get("next_eligible_at"),
            })
    except Exception as error:
        try:
            db.rollback()
        except Exception:
            pass
        print(f"[AUTO ALERT] startup check error: {type(error).__name__}: {error}")
    return summary


def start_startup_auto_alert_check(session_factory=None):
    """Run :func:`run_startup_auto_alert_check` in a background daemon thread.

    Called from the FastAPI lifespan so the email network call never delays
    API startup and the check works with no browser attached.
    ``session_factory`` defaults to the application ``SessionLocal``; tests
    inject their own factory.
    """
    def _worker():
        factory = session_factory
        db = None
        try:
            if factory is None:
                from backend.database import SessionLocal
                factory = SessionLocal
            db = factory()
            run_startup_auto_alert_check(db)
        except Exception as error:
            print(f"[AUTO ALERT] startup check skipped: {type(error).__name__}: {error}")
        finally:
            if db is not None:
                try:
                    db.close()
                except Exception:
                    pass

    thread = threading.Thread(target=_worker, name="aqua-auto-alert-startup", daemon=True)
    thread.start()
    print("[AUTO ALERT] startup check scheduled (backend-driven, browser not required)")
    return thread


def start_startup_auto_alert_watcher(interval_seconds=None, session_factory=None):
    """Backend-driven watcher that re-runs the startup check on an interval.

    ENABLED BY DEFAULT: the watcher runs every 10 seconds when
    ``AUTO_ALERT_WATCHER_INTERVAL_SECONDS`` is not set. Set it explicitly to 0
    (or pass ``interval_seconds=0``) to disable it.

    Why it exists: the documented automatic-alert contract is that the *next
    critical reading* triggers the next email, so cooldown expiry on its own
    sends nothing. With the watcher enabled the backend keeps re-evaluating the
    latest stored reading while it runs, so a latest critical reading is
    notified as soon as the cooldown is over, with no new reading and no
    browser involved. Cooldown suppression is identical either way.

    A short default interval keeps the gap between cooldown expiry and the
    next email to a few seconds. Each iteration uses a FRESH database
    session (created inside the loop) so newly ingested readings and
    newly written notification timestamps are always visible; a single
    failed iteration never kills the loop.
    """
    if interval_seconds is None:
        raw = os.getenv("AUTO_ALERT_WATCHER_INTERVAL_SECONDS", "10").strip()
        try:
            interval_seconds = int(float(raw))
        except (TypeError, ValueError):
            interval_seconds = 0
    if not interval_seconds or interval_seconds <= 0:
        print("[AUTO ALERT] watcher disabled (AUTO_ALERT_WATCHER_INTERVAL_SECONDS=0)")
        return None

    def _loop():
        factory = session_factory
        if factory is None:
            try:
                from backend.database import SessionLocal
                factory = SessionLocal
            except Exception as error:
                print(f"[AUTO ALERT] watcher stopped: {type(error).__name__}: {error}")
                return
        print(f"[AUTO ALERT] watcher started interval_seconds={interval_seconds} "
              "(backend-driven, browser not required)")
        while True:
            db = None
            try:
                db = factory()
                run_startup_auto_alert_check(db)
            except Exception as error:
                print(f"[AUTO ALERT] watcher iteration skipped: {type(error).__name__}: {error}")
            finally:
                if db is not None:
                    try:
                        db.close()
                    except Exception:
                        pass
            time.sleep(interval_seconds)

    thread = threading.Thread(target=_loop, name="aqua-auto-alert-watcher", daemon=True)
    thread.start()
    return thread


def _iso_utc(value):
    """Serialize a naive-UTC datetime as ISO-8601 with Z suffix. None stays None."""
    if value is None:
        return None
    try:
        return value.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return str(value)

def get_auto_status(db: Session) -> dict:
    """Authoritative automatic-alert state for the frontend countdown clock.

    Read-only: never creates alerts and never sends email. Backend/db
    timestamps are the source of truth — the frontend must compute the
    live display from next_eligible_at - Date.now() and resync via this
    endpoint every few seconds. Cooldowns come from persisted
    last_notified_at (per device + parameter), so a NORMAL reading or a
    backend restart does NOT lose the countdown.
    """
    from backend.services.email_service import is_email_configured
    cfg = get_effective_config(db)
    cooldown_sec = _cooldown_seconds(cfg)
    alerts_enabled = bool(getattr(cfg, 'alerts_enabled', True))
    reading = db.query(WaterReading).order_by(WaterReading.id.desc()).first()
    if not reading:
        return {
            "success": True,
            "alerts_enabled": alerts_enabled,
            "provider_configured": is_email_configured(),
            "cooldown_minutes": getattr(cfg, 'cooldown_minutes', ALERT_COOLDOWN_SECONDS // 60),
            "cooldown_seconds": cooldown_sec,
            "latest_reading": None,
            "latest_status": "unknown",
            "critical_parameters": [],
            "cooldowns": [],
            "overall": {"cooldown_active": False, "next_eligible_in_seconds": 0, "next_eligible_at": None, "ready": False},
        }
    device = db.query(Device).filter(Device.id == reading.device_id).first()
    crits = evaluate_reading(reading, cfg)
    critical_structs = []
    for param, cur, thr_val, thr_str, msg in crits:
        direction = "below" if param == "ph" and cur < cfg.ph_min else "above"
        critical_structs.append({
            "parameter": param, "current_value": cur, "threshold": thr_val,
            "direction": direction, "message": msg,
        })
    cooldowns = []
    PARAMS = ("ph", "turbidity", "tds", "temperature")
    overall_last_iso = None
    overall_last_dt = None
    overall_remaining = 0
    overall_next_iso = None
    for param in PARAMS:
        # Authoritative per-parameter lookup. Only rows that actually recorded a
        # successful AUTOMATIC notification (last_notified_at set by the
        # sending path with email_status sent/partial) may drive the clock:
        # a newer alert row created for a SUPPRESSED reading has
        # last_notified_at = None and must never hide a cooldown that the
        # database still says is running, and MANUAL history rows
        # (email_status sent_manual) must never arm the automatic cooldown.
        # Remaining time is always recalculated from the current UTC time,
        # never read from a stored counter.
        al = (
            db.query(Alert)
            .filter(
                Alert.device_id == reading.device_id,
                Alert.parameter == param,
                Alert.email_status.in_(["sent", "partial"]),
                Alert.last_notified_at.isnot(None),
            )
            .order_by(Alert.last_notified_at.desc(), Alert.id.desc())
            .first()
        )
        remaining = _param_cooldown_remaining(db, reading.device_id, param, cfg, quiet=True)
        if al is None and remaining <= 0:
            continue
        last_dt = al.last_notified_at if al is not None else None
        last_iso = _iso_utc(last_dt)
        next_iso = None
        if remaining > 0 and last_dt is not None:
            try:
                next_iso = _iso_utc(last_dt + timedelta(seconds=cooldown_sec))
            except Exception:
                next_iso = None
        cooldowns.append({
            "device_id": reading.device_id,
            "parameter": param,
            "email_status": al.email_status if al is not None else None,
            "last_notified_at": last_iso,
            "next_eligible_at": next_iso,
            "next_eligible_in_seconds": remaining,
            "remaining_seconds": remaining,
            "cooldown_active": remaining > 0,
        })
        if last_dt is not None and (overall_last_dt is None or last_dt > overall_last_dt):
            overall_last_dt = last_dt
            overall_last_iso = last_iso
        if remaining > overall_remaining:
            overall_remaining = remaining
            overall_next_iso = next_iso
    overall = {
        "cooldown_active": overall_remaining > 0,
        "notified_recently": overall_remaining > 0,
        "last_notified_at": overall_last_iso,
        "next_eligible_at": overall_next_iso,
        "next_eligible_in_seconds": overall_remaining,
        "ready": len(critical_structs) > 0 and overall_remaining == 0,
    }
    return {
        "success": True,
        "alerts_enabled": alerts_enabled,
        "provider_configured": is_email_configured(),
        "cooldown_minutes": getattr(cfg, 'cooldown_minutes', ALERT_COOLDOWN_SECONDS // 60),
        "cooldown_seconds": cooldown_sec,
        "latest_reading": {
            "id": reading.id,
            "device_id": reading.device_id,
            "device_name": device.name if device else f"Device {reading.device_id}",
            "temperature": reading.temperature,
            "ph": reading.ph,
            "turbidity": reading.turbidity,
            "tds": reading.tds,
            "recorded_at": _iso_utc(reading.recorded_at),
        },
        "latest_status": "critical" if critical_structs else "normal",
        "critical_parameters": critical_structs,
        "cooldowns": cooldowns,
        "overall": overall,
    }

def send_manual_status(db: Session):
    """Send current status to all active contacts, ignoring cooldown and alerts_enabled.

    Manual alerts are independent of the automatic-alert toggle: they use the
    latest DB reading, bypass the automatic cooldown, and must NOT be blocked
    simply because automatic alerts are OFF. Only the automatic watcher/
    startup paths respect alerts_enabled.
    """
    cfg = get_effective_config(db)
    reading = db.query(WaterReading).order_by(WaterReading.id.desc()).first()
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
        # Record manual sends as immutable email-history rows WITHOUT arming
        # the automatic cooldown: email_status "sent_manual" is deliberately
        # excluded from the cooldown queries (which only honour sent/partial),
        # while the history UI lists every row with last_notified_at set.
        if email_sent > 0:
            try:
                now = _now_utc()
                for param, cur, thr_val, thr_str, msg in crits:
                    db.add(Alert(
                        device_id=reading.device_id,
                        reading_id=reading.id,
                        parameter=param,
                        severity="critical",
                        current_value=cur,
                        threshold_value=thr_val,
                        message=f"Manual status email: {msg}",
                        status="resolved",
                        created_at=now,
                        resolved_at=now,
                        last_notified_at=now,
                        email_status="sent_manual",
                    ))
                db.commit()
            except Exception:
                try:
                    db.rollback()
                except Exception:
                    pass
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

    if email_sent > 0:
        try:
            now = _now_utc()
            db.add(Alert(
                device_id=reading.device_id,
                reading_id=reading.id,
                parameter="status",
                severity="info",
                current_value=None,
                threshold_value=None,
                message=f"Manual status email for {device_name}",
                status="resolved",
                created_at=now,
                resolved_at=now,
                last_notified_at=now,
                email_status="sent_manual",
            ))
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass

    return {"success": True, "email_sent": email_sent, "email_failed": email_failed, "email_not_configured": email_not_configured}
