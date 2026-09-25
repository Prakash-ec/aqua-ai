"""Part 1: helpers + tests A,B."""
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/alert_tests.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from backend.database import Base
import backend.models  # noqa: F401
from backend.models import Alert, AlertConfiguration, AlertContact, Device, WaterReading
import backend.services.alert_service as svc
import backend.services.email_service as email_service
import backend.routes.alerts as routes
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
    db.add(d); db.commit(); db.refresh(d)
    return d
def add_contact(db, name, email, **kw):
    payload = {"name": name, "email": email}
    payload.update(kw)
    return routes.create_contact(routes.ContactCreate(**payload), db)
def add_critical_reading(db, device_id, ph=4.0):
    r = WaterReading(device_id=device_id, ph=ph, temperature=25.0, turbidity=1.0, tds=100.0)
    db.add(r); db.commit(); db.refresh(r)
    return r
class Sender:
    def __init__(self, fail_for=()):
        self.calls = []
        self.fail_for = set(fail_for)
    def combined(self, device_name, reading, critical_structs, recipient_email):
        self.calls.append(recipient_email)
        if recipient_email in self.fail_for:
            return {"success": False, "status": "failed", "error": "boom"}
        return {"success": True, "status": "sent", "id": "stub-id"}
    def plain(self, to_email, subject, html, text=None):
        self.calls.append(to_email)
        if to_email in self.fail_for:
            return {"success": False, "status": "failed", "error": "boom"}
        return {"success": True, "status": "sent"}
def patch_sender(monkeypatch, sender):
    monkeypatch.setattr(svc, "send_combined_critical_alert", sender.combined)
    monkeypatch.setattr(routes, "send_email", sender.plain)
    monkeypatch.setattr(email_service, "send_email", sender.plain)
def active_alerts(db, device_id):
    return db.query(Alert).filter(Alert.device_id == device_id, Alert.status == "active").all()
def test_A_new_recipient_receives_next_critical(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "a-dev")
    c = add_contact(db, "B", "b@example.com")
    assert c.active is True
    fetched = db.query(AlertContact).filter_by(email="b@example.com").first()
    assert fetched is not None and fetched.active is True
    r = add_critical_reading(db, dev.id)
    svc.process_reading_alerts(db, r)
    assert sender.calls == ["b@example.com"]
    db.close()
def test_B_multiple_recipients_one_combined_each(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "b-dev")
    add_contact(db, "A", "a@example.com")
    add_contact(db, "B", "b@example.com")
    r = add_critical_reading(db, dev.id)
    svc.process_reading_alerts(db, r)
    assert sorted(sender.calls) == ["a@example.com", "b@example.com"]
    assert len(sender.calls) == 2
    db.close()


def test_C_inactive_excluded(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "c-dev")
    add_contact(db, "A", "a@example.com")
    off = add_contact(db, "Off", "off@example.com")
    routes.delete_contact(off.id, db)
    r = add_critical_reading(db, dev.id)
    svc.process_reading_alerts(db, r)
    assert sender.calls == ["a@example.com"]
    db.close()
def test_C_email_enabled_false_excluded(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "c2-dev")
    add_contact(db, "A", "a@example.com")
    add_contact(db, "NoMail", "nomail@example.com", email_enabled=False)
    r = add_critical_reading(db, dev.id)
    svc.process_reading_alerts(db, r)
    assert sender.calls == ["a@example.com"]
    db.close()
def test_C_legacy_null_email_enabled_included(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "c3-dev")
    legacy = AlertContact(name="legacy", email="legacy@example.com", active=True, email_enabled=None)
    db.add(legacy); db.commit()
    r = add_critical_reading(db, dev.id)
    svc.process_reading_alerts(db, r)
    assert sender.calls == ["legacy@example.com"]
    db.close()
def test_D_new_recipient_during_cooldown_suppressed(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "d-dev")
    add_contact(db, "A", "a@example.com")
    r1 = add_critical_reading(db, dev.id)
    svc.process_reading_alerts(db, r1)
    assert sender.calls == ["a@example.com"]
    add_contact(db, "B", "b@example.com")
    sender.calls.clear()
    r2 = add_critical_reading(db, dev.id)
    svc.process_reading_alerts(db, r2)
    assert sender.calls == []
    db.close()
def test_E_both_receive_after_cooldown(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "e-dev")
    add_contact(db, "A", "a@example.com")
    svc.process_reading_alerts(db, add_critical_reading(db, dev.id))
    add_contact(db, "B", "b@example.com")
    sender.calls.clear()
    svc.process_reading_alerts(db, add_critical_reading(db, dev.id))
    assert sender.calls == []
    for al in active_alerts(db, dev.id):
        al.last_notified_at = _now() - timedelta(minutes=10)
    db.commit()
    sender.calls.clear()
    svc.process_reading_alerts(db, add_critical_reading(db, dev.id))
    assert sorted(sender.calls) == ["a@example.com", "b@example.com"]
    db.close()
def test_F_empty_then_add_then_critical(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "f-dev")
    r1 = add_critical_reading(db, dev.id)
    svc.process_reading_alerts(db, r1)
    assert sender.calls == []
    add_contact(db, "B", "b@example.com")
    sender.calls.clear()
    svc.process_reading_alerts(db, add_critical_reading(db, dev.id))
    assert sender.calls == ["b@example.com"]
    db.close()
def test_G_partial_failure(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender(fail_for={"bad@example.com"})
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "g-dev")
    add_contact(db, "Good", "good@example.com")
    add_contact(db, "Bad", "bad@example.com")
    r = add_critical_reading(db, dev.id)
    rid = r.id
    svc.process_reading_alerts(db, r)
    assert sorted(sender.calls) == ["bad@example.com", "good@example.com"]
    assert db.query(WaterReading).filter_by(id=rid).first() is not None
    assert len(active_alerts(db, dev.id)) > 0
    db.close()
def test_G_total_failure_does_not_arm_cooldown(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender(fail_for={"a@example.com"})
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "g2-dev")
    add_contact(db, "A", "a@example.com")
    svc.process_reading_alerts(db, add_critical_reading(db, dev.id))
    for al in active_alerts(db, dev.id):
        assert al.last_notified_at is None
    add_contact(db, "B", "b@example.com")
    sender2 = Sender()
    patch_sender(monkeypatch, sender2)
    svc.process_reading_alerts(db, add_critical_reading(db, dev.id))
    assert sorted(sender2.calls) == ["a@example.com", "b@example.com"]
    db.close()
def test_H_test_email_includes_new_recipient(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    monkeypatch.setattr(email_service, "is_email_configured", lambda: True)
    monkeypatch.setattr("backend.routes.alerts.is_email_configured", lambda: True)
    dev = make_device(db, "h-dev")
    add_critical_reading(db, dev.id)
    add_contact(db, "New", "new@example.com")
    sender.calls.clear()
    out = routes.test_email(db)
    assert out["success"] is True
    assert [r["email"] for r in out["results"]] == ["new@example.com"]
    db.close()
def test_I_contacts_survive_new_session(monkeypatch):
    eng, S = make_db()
    db = S()
    add_contact(db, "A", "a@example.com")
    db.close()
    db2 = S()
    got = db2.query(AlertContact).filter_by(email="a@example.com").first()
    assert got is not None and got.active is True
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db2, "i-dev")
    svc.process_reading_alerts(db2, add_critical_reading(db2, dev.id))
    assert sender.calls == ["a@example.com"]
    db2.close()
def test_J_alerts_off_blocks_auto_manual_still_works(monkeypatch):
    # Contract (Parts B/C): alerts_enabled=OFF stops AUTOMATIC emails, but the
    # MANUAL alert stays independent — it uses the latest DB reading, bypasses
    # the automatic cooldown, and is never blocked by the automatic toggle.
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "j-dev")
    add_contact(db, "A", "a@example.com")
    cfg = db.query(AlertConfiguration).first()
    if cfg is None:
        cfg = AlertConfiguration(alerts_enabled=False)
        db.add(cfg)
    else:
        cfg.alerts_enabled = False
    db.commit()
    svc.process_reading_alerts(db, add_critical_reading(db, dev.id))
    assert sender.calls == []
    out = svc.send_manual_status(db)
    assert out.get("success") is True
    assert sender.calls != []
    db.close()
def test_J_manual_bypasses_cooldown(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "j2-dev")
    add_contact(db, "A", "a@example.com")
    add_contact(db, "B", "b@example.com")
    svc.process_reading_alerts(db, add_critical_reading(db, dev.id))
    assert len(sender.calls) == 2
    sender.calls.clear()
    out = svc.send_manual_status(db)
    assert out.get("success") is True
    assert sorted(sender.calls) == ["a@example.com", "b@example.com"]
    db.close()

