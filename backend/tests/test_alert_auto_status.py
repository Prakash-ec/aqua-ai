"""Automatic alert status: per-parameter cooldown, normal handling, failure semantics.

Extends backend/tests/test_alert_new_recipient.py (same sqlite harness).
Covers: normal sends nothing, critical sends when eligible, cooldown
suppresses repeats, per-parameter independence, expiry re-arms, normal
resolves, failure does not arm cooldown, manual bypasses cooldown,
and the read-only auto-status state (browser never required).
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/alert_auto_status_tests.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base
import backend.models  # noqa: F401
from backend.models import Alert, AlertConfiguration, Device, WaterReading
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
    from backend.models import AlertContact
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
        return {"success": True, "status": "sent", "id": "stub-id"}


def patch_sender(monkeypatch, sender):
    monkeypatch.setattr(svc, "send_combined_critical_alert", sender.combined)


def active_alerts(db, device_id):
    return db.query(Alert).filter(Alert.device_id == device_id, Alert.status == "active").all()


def test_1_normal_reading_sends_nothing(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "normal-dev")
    add_contact(db, "A", "a@example.com")
    svc.process_reading_alerts(db, add_reading(db, dev.id))
    assert sender.calls == []
    assert active_alerts(db, dev.id) == []
    st = svc.get_auto_status(db)
    assert st["latest_status"] == "normal"
    assert st["cooldowns"] == []
    db.close()


def test_2_critical_sends_when_eligible(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "crit-dev")
    add_contact(db, "A", "a@example.com")
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    assert len(sender.calls) == 1
    assert sender.calls[0][1] == ["tds"]
    st = svc.get_auto_status(db)
    assert st["latest_status"] == "critical"
    assert st["overall"]["cooldown_active"] is True
    assert st["overall"]["next_eligible_in_seconds"] > 0
    db.close()


def test_3_repeat_critical_within_cooldown_suppressed(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "repeat-dev")
    add_contact(db, "A", "a@example.com")
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    assert len(sender.calls) == 1
    sender.calls.clear()
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2600.0))
    assert sender.calls == []
    db.close()


def test_4_other_parameter_independent_during_cooldown(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "perparam-dev")
    add_contact(db, "A", "a@example.com")
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    assert [c[1] for c in sender.calls] == [["tds"]]
    sender.calls.clear()
    # TDS back to normal, pH newly critical -> pH has no cooldown -> sends
    svc.process_reading_alerts(db, add_reading(db, dev.id, ph=4.0))
    assert [c[1] for c in sender.calls] == [["ph"]]
    # TDS alert resolved because the latest reading is normal for TDS
    params = {a.parameter: a.status for a in db.query(Alert).filter(Alert.device_id == dev.id).all() if a.parameter == "tds"}
    assert "resolved" in params.values()
    db.close()


def test_5_expiry_allows_next_critical(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "expiry-dev")
    add_contact(db, "A", "a@example.com")
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    assert len(sender.calls) == 1
    for al in active_alerts(db, dev.id):
        al.last_notified_at = _now() - timedelta(minutes=10)
    db.commit()
    sender.calls.clear()
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2500.0))
    assert len(sender.calls) == 1
    db.close()


def test_6_critical_then_normal_resolves_without_email(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "resolve-dev")
    add_contact(db, "A", "a@example.com")
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    assert len(sender.calls) == 1
    sender.calls.clear()
    svc.process_reading_alerts(db, add_reading(db, dev.id))
    assert sender.calls == []
    assert active_alerts(db, dev.id) == []
    st = svc.get_auto_status(db)
    assert st["latest_status"] == "normal"
    # Cooldown is timestamp-based and survives NORMAL readings / restarts:
    # the DB still holds last_notified_at until the 5-minute window expires.
    assert st["overall"]["cooldown_active"] is True
    assert st["overall"]["next_eligible_in_seconds"] > 0
    assert st["overall"]["next_eligible_at"] is not None
    db.close()


def test_7_normal_then_critical_eligible_again(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "renew-dev")
    add_contact(db, "A", "a@example.com")
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    # Normal reading arrives, alert resolves
    svc.process_reading_alerts(db, add_reading(db, dev.id))
    # Cooldown expires (stale cooldown)
    for al in db.query(Alert).filter(Alert.device_id == dev.id).all():
        al.last_notified_at = _now() - timedelta(minutes=10)
    db.commit()
    sender.calls.clear()
    # New critical condition after normal: old stale cooldown must not suppress it
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2600.0))
    assert len(sender.calls) == 1
    db.close()


def test_8_total_failure_does_not_arm_cooldown(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender(fail_for={"a@example.com"})
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "fail-dev")
    add_contact(db, "A", "a@example.com")
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    assert len(sender.calls) == 1
    for al in active_alerts(db, dev.id):
        assert al.email_status == "failed"
        assert al.last_notified_at is None
    st = svc.get_auto_status(db)
    assert st["overall"]["cooldown_active"] is False
    # Retry with working provider sends immediately (no false cooldown)
    sender2 = Sender()
    patch_sender(monkeypatch, sender2)
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2500.0))
    assert len(sender2.calls) == 1
    db.close()


def test_9_not_configured_never_reports_sent(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender(not_configured_for={"a@example.com"})
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "noconfig-dev")
    add_contact(db, "A", "a@example.com")
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    for al in active_alerts(db, dev.id):
        assert al.email_status == "not_configured"
        assert al.last_notified_at is None
    db.close()


def test_10_manual_bypasses_automatic_cooldown(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    from backend.models import AlertContact
    dev = make_device(db, "manual-dev")
    add_contact(db, "A", "a@example.com")
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    assert len(sender.calls) == 1
    # Manual path reads latest DB reading itself and ignores cooldown
    import backend.services.email_service as email_service
    monkeypatch.setattr(email_service, "send_email", lambda *a, **k: {"success": True, "status": "sent"})
    out = svc.send_manual_status(db)
    assert out.get("success") is True
    assert out.get("email_sent", 0) >= 1
    db.close()


def test_11_auto_status_read_only_and_combined(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "combined-dev")
    add_contact(db, "A", "a@example.com")
    # Several params critical at once -> ONE combined email, not three
    svc.process_reading_alerts(db, add_reading(db, dev.id, ph=4.0, tds=2450.0, turbidity=50.0))
    assert len(sender.calls) == 1
    assert sorted(sender.calls[0][1]) == ["ph", "tds", "turbidity"]
    before = len(sender.calls)
    st = svc.get_auto_status(db)
    assert len(sender.calls) == before  # read-only: no email from status check
    assert st["latest_status"] == "critical"
    assert {c["parameter"] for c in st["cooldowns"]} == {"ph", "tds", "turbidity"}
    assert st["cooldown_seconds"] == st["cooldown_minutes"] * 60
    assert st["overall"]["cooldown_active"] is True
    db.close()


def test_12_browser_closed_backend_still_alerts(monkeypatch):
    # No frontend, no browser, no localStorage: service-level ingestion path
    # alone must generate the automatic email.
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "headless-dev")
    add_contact(db, "A", "a@example.com")
    r = add_reading(db, dev.id, tds=2450.0)
    svc.process_reading_alerts(db, r)
    assert len(sender.calls) == 1
    db.close()


def test_13_active_cooldown_not_hidden_by_newer_suppressed_rows(monkeypatch):
    """Regression (found by live verification, live check H1).

    Sequence: critical (email + cooldown) -> NORMAL (resolves the alerts) ->
    critical again while the cooldown is still running (suppressed, so the new
    alert rows carry last_notified_at = None).

    get_auto_status() must keep reporting the REAL remaining time from the
    database timestamp; the newer suppressed rows must never make the UI fall
    back to "READY / no cooldown" while the cooldown is still active.
    """
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "shadow-dev")
    add_contact(db, "A", "a@example.com")

    # 1. critical -> real email + cooldown
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    assert len(sender.calls) == 1
    first = svc.get_auto_status(db)["overall"]
    stamped = {al.parameter: al.last_notified_at for al in active_alerts(db, dev.id)}
    assert first["cooldown_active"] is True

    # 2. normal -> alerts resolved, cooldown must survive untouched
    svc.process_reading_alerts(db, add_reading(db, dev.id))
    mid = svc.get_auto_status(db)
    assert mid["latest_status"] == "normal"
    assert mid["overall"]["cooldown_active"] is True
    assert mid["overall"]["next_eligible_at"] == first["next_eligible_at"]

    # 3. critical again while the cooldown runs -> suppressed, new rows created
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2600.0))
    assert len(sender.calls) == 1  # still no second email
    late = svc.get_auto_status(db)
    assert late["latest_status"] == "critical"
    assert late["overall"]["cooldown_active"] is True
    assert late["overall"]["next_eligible_at"] == first["next_eligible_at"]
    assert 0 < late["overall"]["next_eligible_in_seconds"] <= late["cooldown_seconds"]
    # Cooldown start timestamp (source of truth) unchanged by the suppression:
    # exactly one row per parameter ever records a successful notification, and
    # the new suppressed rows carry no timestamp.
    sent_rows = (
        db.query(Alert)
        .filter(
            Alert.device_id == dev.id,
            Alert.parameter == "tds",
            Alert.last_notified_at.isnot(None),
        )
        .all()
    )
    assert len(sent_rows) == 1
    assert sent_rows[0].last_notified_at == stamped["tds"]
    db.close()

