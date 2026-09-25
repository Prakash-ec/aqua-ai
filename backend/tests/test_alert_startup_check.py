"""Backend-startup automatic alert check.

The automatic alert system is backend-driven: when the backend becomes live
it must evaluate the LATEST stored reading and send the REAL email
immediately when that reading is critical and no (device, parameter) cooldown
is active. No browser and no new reading are required.

Same sqlite harness as backend/tests/test_alert_auto_status.py.
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/alert_startup_check_tests.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base
import backend.models  # noqa: F401
from backend.models import Alert, AlertContact, AlertConfiguration, Device, WaterReading
import backend.services.alert_service as svc


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def make_db():
    f = tempfile.mktemp(suffix=".db")
    eng = create_engine(f"sqlite:///{f}", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng)
    S = sessionmaker(bind=eng, autocommit=False, autoflush=False)
    return eng, S


def make_device(db, name="dev"):
    d = Device(name=name)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


def add_contact(db, name, email):
    c = AlertContact(name=name, email=email, active=True, email_enabled=True)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def add_reading(db, device_id, **values):
    base = {"temperature": 25.0, "ph": 7.0, "turbidity": 1.0, "tds": 100.0}
    base.update(values)
    r = WaterReading(device_id=device_id, **base)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


class Sender:
    """Captures provider calls; only a confirmed send counts as success."""

    def __init__(self, fail_for=(), not_configured_for=()):
        self.calls = []
        self.fail_for = set(fail_for)
        self.not_configured_for = set(not_configured_for)

    def combined(self, device_name, reading, critical_structs, recipient_email):
        self.calls.append((recipient_email, sorted(p["parameter"] for p in critical_structs)))
        if recipient_email in self.not_configured_for:
            return {"success": False, "status": "not_configured", "error": "no key"}
        if recipient_email in self.fail_for:
            return {"success": False, "status": "failed", "error": "boom"}
        return {"success": True, "status": "sent", "id": "provider-msg-id"}


def patch_sender(monkeypatch, sender):
    monkeypatch.setattr(svc, "send_combined_critical_alert", sender.combined)


def active_alerts(db, device_id):
    return db.query(Alert).filter(Alert.device_id == device_id, Alert.status == "active").all()


def test_1_no_readings_stored_sends_nothing(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    add_contact(db, "A", "a@example.com")
    out = svc.run_startup_auto_alert_check(db)
    assert out["checked"] == 0
    assert sender.calls == []
    db.close()


def test_2_latest_reading_normal_no_email(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "startup-normal")
    add_contact(db, "A", "a@example.com")
    add_reading(db, dev.id)
    out = svc.run_startup_auto_alert_check(db)
    assert out["results"][0]["status"] == "normal"
    assert sender.calls == []
    st = svc.get_auto_status(db)
    assert st["overall"]["cooldown_active"] is False
    db.close()


def test_3_critical_latest_reading_sends_immediately(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "startup-critical")
    add_contact(db, "A", "a@example.com")
    r = add_reading(db, dev.id, temperature=45.0, ph=4.5, tds=1800.0, turbidity=15.0)
    out = svc.run_startup_auto_alert_check(db)
    assert out["results"][0]["reading_id"] == r.id
    assert out["results"][0]["status"] == "sent"
    assert sorted(out["results"][0]["critical_parameters"]) == ["ph", "tds", "temperature", "turbidity"]
    # ONE grouped email, all critical parameters listed
    assert len(sender.calls) == 1
    assert sender.calls[0][1] == ["ph", "tds", "temperature", "turbidity"]
    # Cooldown armed only after the provider confirmed delivery
    for al in active_alerts(db, dev.id):
        assert al.email_status == "sent"
        assert al.last_notified_at is not None
    st = svc.get_auto_status(db)
    assert st["latest_status"] == "critical"
    assert st["overall"]["cooldown_active"] is True
    assert 0 < st["overall"]["next_eligible_in_seconds"] <= st["cooldown_seconds"]
    db.close()


def test_4_restart_during_cooldown_suppressed_and_preserved(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "startup-cooldown")
    add_contact(db, "A", "a@example.com")
    add_reading(db, dev.id, tds=2450.0)
    assert svc.run_startup_auto_alert_check(db)["results"][0]["status"] == "sent"
    assert len(sender.calls) == 1
    stamped = {al.parameter: al.last_notified_at for al in active_alerts(db, dev.id)}
    # Simulated restart: brand new session, same database
    db.close()
    db2 = S()
    out = svc.run_startup_auto_alert_check(db2)
    assert out["results"][0]["status"] == "cooldown"
    assert out["results"][0]["remaining_seconds"] > 0
    assert len(sender.calls) == 1  # no second email
    for al in active_alerts(db2, dev.id):
        assert al.last_notified_at == stamped[al.parameter]  # cooldown NOT reset
    db2.close()


def test_5_restart_after_expiry_with_stale_critical_reading(monkeypatch):
    """A restart is a fresh check, so an expired cooldown re-arms on the
    latest (still critical) stored reading. That is what makes "do not wait
    for another critical reading" literally true. While the backend keeps
    running, expiry alone still sends nothing (see test_7)."""
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "startup-expired")
    add_contact(db, "A", "a@example.com")
    add_reading(db, dev.id, tds=2450.0)
    assert svc.run_startup_auto_alert_check(db)["results"][0]["status"] == "sent"
    # Force the persisted cooldown into the past (timestamp, not a counter)
    past = _now() - timedelta(minutes=6)
    for al in active_alerts(db, dev.id):
        al.last_notified_at = past
    db.commit()
    db.close()
    db2 = S()
    out = svc.run_startup_auto_alert_check(db2)
    assert out["results"][0]["status"] == "sent"
    assert len(sender.calls) == 2
    st = svc.get_auto_status(db2)
    assert st["overall"]["cooldown_active"] is True
    assert st["overall"]["next_eligible_in_seconds"] > 0
    db2.close()


def test_6_status_check_alone_does_not_send(monkeypatch):
    """Run-once flag semantics keep startup/expiry from spamming: only the
    ingest path and an explicit restart check send email."""
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "startup-readonly")
    add_contact(db, "A", "a@example.com")
    add_reading(db, dev.id, tds=2450.0)
    svc.run_startup_auto_alert_check(db)
    assert len(sender.calls) == 1
    for _ in range(3):
        st = svc.get_auto_status(db)
        assert st["overall"]["cooldown_active"] is True
    assert len(sender.calls) == 1
    db.close()


def test_7_failed_email_arms_no_cooldown_on_startup(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender(fail_for={"a@example.com"})
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "startup-fail")
    add_contact(db, "A", "a@example.com")
    add_reading(db, dev.id, tds=2450.0)
    svc.run_startup_auto_alert_check(db)
    assert len(sender.calls) == 1
    for al in active_alerts(db, dev.id):
        assert al.email_status == "failed"
        assert al.last_notified_at is None
    assert svc.get_auto_status(db)["overall"]["cooldown_active"] is False
    # A later check may retry immediately because no cooldown was armed
    sender2 = Sender()
    patch_sender(monkeypatch, sender2)
    out = svc.run_startup_auto_alert_check(db)
    assert out["results"][0]["status"] == "sent"
    assert len(sender2.calls) == 1
    db.close()


def test_8_not_configured_provider_arms_no_cooldown(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender(not_configured_for={"a@example.com"})
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "startup-noconfig")
    add_contact(db, "A", "a@example.com")
    add_reading(db, dev.id, tds=2450.0)
    svc.run_startup_auto_alert_check(db)
    for al in active_alerts(db, dev.id):
        assert al.email_status == "not_configured"
        assert al.last_notified_at is None
    assert svc.get_auto_status(db)["overall"]["cooldown_active"] is False
    db.close()


def test_9_alerts_disabled_startup_sends_nothing(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "startup-disabled")
    add_contact(db, "A", "a@example.com")
    dev_cfg = AlertConfiguration(alerts_enabled=False)
    db.add(dev_cfg)
    db.commit()
    add_reading(db, dev.id, tds=2450.0)
    out = svc.run_startup_auto_alert_check(db)
    assert out["results"][0]["status"] == "alerts_disabled"
    assert sender.calls == []
    db.close()


def test_10_per_device_startup_cooldowns_do_not_suppress_each_other(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev_a = make_device(db, "startup-dev-a")
    dev_b = make_device(db, "startup-dev-b")
    add_contact(db, "A", "a@example.com")
    add_reading(db, dev_a.id, tds=2450.0)          # critical
    add_reading(db, dev_b.id)                      # normal latest
    # Device A gets its real email + cooldown; device B stays silent
    svc.run_startup_auto_alert_check(db)
    assert len(sender.calls) == 1
    # Second run: device A is inside cooldown, nothing new may be sent
    out = svc.run_startup_auto_alert_check(db)
    statuses = {r["device_id"]: r["status"] for r in out["results"]}
    assert statuses[dev_a.id] == "cooldown"
    assert statuses[dev_b.id] == "normal"
    assert len(sender.calls) == 1
    # Device A cooldown must not block a newly critical device B
    add_reading(db, dev_b.id, ph=4.2)
    svc.run_startup_auto_alert_check(db)
    assert len(sender.calls) == 2
    assert sender.calls[1][1] == ["ph"]
    db.close()


def test_11_thread_wrapper_runs_with_own_session(monkeypatch):
    eng, S = make_db()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    db = S()
    dev = make_device(db, "startup-thread")
    add_contact(db, "A", "a@example.com")
    add_reading(db, dev.id, turbidity=42.0)
    db.close()
    thread = svc.start_startup_auto_alert_check(session_factory=S)
    thread.join(timeout=15)
    assert not thread.is_alive()
    assert len(sender.calls) == 1
    assert sender.calls[0][1] == ["turbidity"]


def test_12_watcher_enabled_by_default_and_explicit_zero_disables(monkeypatch):
    # Default: when AUTO_ALERT_WATCHER_INTERVAL_SECONDS is not set, the
    # watcher is ENABLED with a 60-second interval (not disabled).
    monkeypatch.delenv("AUTO_ALERT_WATCHER_INTERVAL_SECONDS", raising=False)
    thread = svc.start_startup_auto_alert_watcher()
    assert thread is not None, "watcher must be enabled by default (60s)"
    # NOTE: the watcher is a daemon loop (re-check + sleep); a correctly
    # running watcher thread is expected to stay alive, so liveness after a
    # short join must NOT be asserted here.
    thread.join(timeout=2)

    # Explicit 0 still intentionally disables the watcher.
    monkeypatch.setenv("AUTO_ALERT_WATCHER_INTERVAL_SECONDS", "0")
    assert svc.start_startup_auto_alert_watcher() is None


def test_13_enabled_watcher_sends_once_then_suppresses(monkeypatch):
    """When enabled, the watcher re-checks the latest reading on an interval.

    A critical latest reading is emailed once; every following iteration sees
    the active cooldown and stays silent (no repeat emails, timer preserved).
    """
    import time as _time
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "watcher-dev")
    add_contact(db, "A", "a@example.com")
    add_reading(db, dev.id, tds=2450.0)
    db.close()
    thread = svc.start_startup_auto_alert_watcher(interval_seconds=1, session_factory=S)
    assert thread is not None
    _time.sleep(4)
    assert len(sender.calls) == 1  # sent exactly once across several iterations
    db2 = S()
    st = svc.get_auto_status(db2)
    assert st["overall"]["cooldown_active"] is True
    assert st["overall"]["next_eligible_in_seconds"] > 0
    db2.close()

