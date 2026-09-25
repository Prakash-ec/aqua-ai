"""Clear email history: resolved rows deleted, active rows keep live state.

Same sqlite harness as the other alert service tests. Covers: history is
emptied, active critical rows survive with values intact, and the cooldown
resets so the next critical reading sends immediately.
"""
import os
import sys
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/alert_clear_history_tests.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base
import backend.models  # noqa: F401
from backend.models import Alert, Device, WaterReading
import backend.services.alert_service as svc
import backend.routes.alerts as routes


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
    def __init__(self):
        self.calls = []

    def combined(self, device_name, reading, critical_structs, recipient_email):
        self.calls.append(recipient_email)
        return {"success": True, "status": "sent", "id": "stub-id"}


def patch_sender(monkeypatch, sender):
    monkeypatch.setattr(svc, "send_combined_critical_alert", sender.combined)


def test_clear_history_empties_list_but_keeps_live_alerts(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "clear-dev")
    add_contact(db, "A", "a@example.com")

    # Critical -> email + cooldown, then normal -> resolved history row.
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    assert len(sender.calls) == 1
    svc.process_reading_alerts(db, add_reading(db, dev.id))
    assert db.query(Alert).count() >= 1

    out = routes.clear_email_history(db)
    assert out["success"] is True
    assert out["deleted"] >= 1

    # No row records a notification any more -> email history is empty.
    assert db.query(Alert).filter(Alert.last_notified_at.isnot(None)).count() == 0
    assert svc.get_auto_status(db)["overall"]["cooldown_active"] is False
    db.close()


def test_clear_history_resets_cooldown_for_active_critical(monkeypatch):
    eng, S = make_db()
    db = S()
    sender = Sender()
    patch_sender(monkeypatch, sender)
    dev = make_device(db, "clear-active-dev")
    add_contact(db, "A", "a@example.com")

    # Still critical: active alert with a live cooldown.
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2450.0))
    assert svc.get_auto_status(db)["overall"]["cooldown_active"] is True

    out = routes.clear_email_history(db)
    assert out["success"] is True

    # Active row survives with its live values, notification stripped.
    remaining = db.query(Alert).filter(Alert.status == "active").all()
    assert len(remaining) == 1
    assert remaining[0].parameter == "tds"
    assert remaining[0].current_value == 2450.0
    assert remaining[0].last_notified_at is None

    # Cooldown reset: the next critical reading sends immediately.
    sender.calls.clear()
    svc.process_reading_alerts(db, add_reading(db, dev.id, tds=2600.0))
    assert len(sender.calls) == 1
    db.close()
