"""Alert toggle persistence + cooldown display semantics (Parts B/C/F).

Covers:
1. Toggle ON persists across re-read (refresh simulation)
2. Toggle OFF persists across re-read
3. Toggle OFF stops automatic watcher emails (process + startup check)
4. Cooldown timestamps preserved when toggled OFF (never deleted/reset)
5. Refresh while OFF keeps OFF (repeat read)
6. Re-enable during active cooldown returns correct remaining time
7. Re-enable after expiry reports ready (no cooldown)
8. Manual alert works while automatic alerts are OFF
9. Backend authoritative over stale opposite value (simulated localStorage)
10. Repeated refresh reads create no duplicate config rows
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/alert_toggle_tests.db"
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


def add_contact(db, name="A", email="a@example.com"):
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


def set_toggle(db, on: bool):
    cfg = svc.get_effective_config(db)
    row = db.query(AlertConfiguration).first()
    row.alerts_enabled = bool(on)
    db.commit()
    db.refresh(row)
    return row


class Sender:
    def __init__(self):
        self.calls = []

    def combined(self, device_name, reading, critical_structs, recipient_email):
        self.calls.append(recipient_email)
        return {"success": True, "status": "sent", "id": "stub-id"}


def test_1_toggle_on_persists(monkeypatch):
    eng, S = make_db()
    db = S()
    set_toggle(db, True)
    # Simulate refresh: new session re-reads backend state
    db.close()
    db2 = S()
    assert svc.get_effective_config(db2).alerts_enabled is True
    assert svc.get_auto_status(db2)["alerts_enabled"] is True
    db2.close()


def test_2_toggle_off_persists():
    eng, S = make_db()
    db = S()
    set_toggle(db, False)
    db.close()
    db2 = S()
    assert svc.get_effective_config(db2).alerts_enabled is False
    assert svc.get_auto_status(db2)["alerts_enabled"] is False
    db2.close()


def test_3_toggle_off_stops_automatic_emails(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    monkeypatch.setattr(svc, "send_combined_critical_alert", sender.combined)
    dev = make_device(db, "off-dev")
    add_contact(db)
    set_toggle(db, False)
    out = svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    assert sender.calls == []
    assert out["status"] == "alerts_disabled"
    # Startup path also respects OFF
    summary = svc.run_startup_auto_alert_check(db)
    assert sender.calls == []
    assert summary["results"][0]["status"] == "alerts_disabled"
    db.close()


def test_4_cooldown_preserved_when_toggled_off(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    monkeypatch.setattr(svc, "send_combined_critical_alert", sender.combined)
    dev = make_device(db, "cd-dev")
    add_contact(db)
    set_toggle(db, True)
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    assert len(sender.calls) == 1
    before = svc.get_auto_status(db)["overall"]["next_eligible_at"]
    stamped = {a.parameter: a.last_notified_at for a in db.query(Alert).all()}
    set_toggle(db, False)  # must NOT delete/reset timestamps
    rows = db.query(Alert).filter(Alert.last_notified_at.isnot(None)).all()
    assert len(rows) >= 1
    assert {a.parameter: a.last_notified_at for a in db.query(Alert).all()} == stamped
    after = svc.get_auto_status(db)
    assert after["overall"]["next_eligible_at"] == before
    assert after["alerts_enabled"] is False
    db.close()


def test_5_refresh_while_off_keeps_off():
    eng, S = make_db()
    db = S()
    set_toggle(db, False)
    for _ in range(3):  # repeated refresh reads
        db.close()
        db = S()
        assert svc.get_effective_config(db).alerts_enabled is False
        assert svc.get_auto_status(db)["alerts_enabled"] is False
    db.close()


def test_6_reenable_during_cooldown_shows_remaining(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    monkeypatch.setattr(svc, "send_combined_critical_alert", sender.combined)
    dev = make_device(db, "re-dev")
    add_contact(db)
    set_toggle(db, True)
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    set_toggle(db, False)
    set_toggle(db, True)
    st = svc.get_auto_status(db)
    assert st["alerts_enabled"] is True
    assert st["overall"]["cooldown_active"] is True
    assert 0 < st["overall"]["next_eligible_in_seconds"] <= st["cooldown_seconds"]
    db.close()


def test_7_reenable_after_expiry_reports_ready(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    monkeypatch.setattr(svc, "send_combined_critical_alert", sender.combined)
    dev = make_device(db, "exp-dev")
    add_contact(db)
    set_toggle(db, True)
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    for al in db.query(Alert).all():
        al.last_notified_at = _now() - timedelta(minutes=10)
    db.commit()
    set_toggle(db, False)
    set_toggle(db, True)
    st = svc.get_auto_status(db)
    assert st["alerts_enabled"] is True
    assert st["overall"]["cooldown_active"] is False
    assert st["overall"]["ready"] is True
    db.close()


def test_8_manual_works_while_automatic_off(monkeypatch):
    eng, S = make_db()
    db = S()
    dev = make_device(db, "man-dev")
    add_contact(db)
    add_reading(db, dev.id, tds=2450.0)
    set_toggle(db, False)
    import backend.services.email_service as email_service
    monkeypatch.setattr(email_service, "send_email", lambda *a, **k: {"success": True, "status": "sent"})
    monkeypatch.setattr(svc, "send_combined_critical_alert",
                        lambda *a, **k: {"success": True, "status": "sent", "id": "x"})
    out = svc.send_manual_status(db)
    assert out.get("success") is True
    db.close()


def test_9_backend_authoritative_over_stale_value():
    eng, S = make_db()
    db = S()
    set_toggle(db, False)
    stale_frontend_value = True  # simulated opposite localStorage
    assert svc.get_effective_config(db).alerts_enabled is False
    assert svc.get_auto_status(db)["alerts_enabled"] is False
    assert stale_frontend_value is not svc.get_auto_status(db)["alerts_enabled"]
    db.close()


def test_10_no_duplicate_config_on_refresh():
    eng, S = make_db()
    db = S()
    for _ in range(5):
        svc.get_effective_config(db)
        svc.get_auto_status(db)
    assert db.query(AlertConfiguration).count() == 1
    db.close()
