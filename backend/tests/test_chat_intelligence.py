"""Chatbot intelligence: data-grounded answers, thresholds, history, crop, camera.

Covers Part E chatbot tests:
1. current pH question uses DB value
2. current TDS question uses DB value
3. current temperature question uses DB value
4. critical-status question explains with measurements
5. threshold explanation lists configured thresholds
6. historical trend question uses DB history (not just latest)
7. crop suitability question grounds in Aqua AI analysis
8. missing camera result states none available
9. missing reading does not fabricate
10. AI provider failure falls back to grounded data
11. no fabricated sensor values (units + numbers present)
"""
import os
import sys
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/chat_intel_tests.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base
import backend.models  # noqa: F401
import backend.routes.chat as chat
from backend.models import Device, WaterReading


def make_db():
    f = tempfile.mktemp(suffix=".db")
    eng = create_engine(f"sqlite:///{f}", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng)
    S = sessionmaker(bind=eng, autocommit=False, autoflush=False)
    return eng, S


def seed_critical(db):
    dev = Device(name="Aqua AI Device 1")
    db.add(dev)
    db.commit()
    db.refresh(dev)
    r = WaterReading(device_id=dev.id, temperature=45.0, ph=4.5, turbidity=15.0, tds=1800.0)
    db.add(r)
    db.commit()
    db.refresh(r)
    return dev, r


def ask(db, question, **kw):
    req = chat.ChatRequest(question=question, **kw)
    return chat.chat_water(req, db=db)


def test_1_current_ph_uses_db():
    eng, S = make_db()
    db = S()
    seed_critical(db)
    out = ask(db, "What is the current pH?")
    assert out["success"] is True
    assert "4.5" in out["answer"]
    db.close()


def test_2_current_tds_uses_db():
    eng, S = make_db()
    db = S()
    seed_critical(db)
    out = ask(db, "What is my current TDS?")
    assert out["success"] is True
    assert "1800" in out["answer"]
    assert "mg/L" in out["answer"]
    db.close()


def test_3_current_temperature_uses_db():
    eng, S = make_db()
    db = S()
    seed_critical(db)
    out = ask(db, "What is my water temperature?")
    assert out["success"] is True
    assert "45" in out["answer"]
    assert "°C" in out["answer"]
    db.close()


def test_4_critical_status_explains_measurements():
    eng, S = make_db()
    db = S()
    seed_critical(db)
    out = ask(db, "Is my water currently critical? Explain using the actual measurements.")
    assert out["success"] is True
    ans = out["answer"]
    assert "4.5" in ans and "5.5" in ans  # value + threshold
    assert "1800" in ans and "1500" in ans
    assert "15" in ans and "10" in ans
    assert "45" in ans and "40" in ans
    db.close()


def test_5_threshold_explanation():
    eng, S = make_db()
    db = S()
    seed_critical(db)
    out = ask(db, "What are the critical thresholds?")
    assert out["success"] is True
    ans = out["answer"]
    for token in ("5.5", "9.0", "10", "1500", "40"):
        assert token in ans
    db.close()


def test_6_historical_trend_uses_history():
    eng, S = make_db()
    db = S()
    dev = Device(name="trend-dev")
    db.add(dev)
    db.commit()
    db.refresh(dev)
    for tds in (100.0, 200.0, 400.0):
        db.add(WaterReading(device_id=dev.id, temperature=25.0, ph=7.0, turbidity=1.0, tds=tds))
    db.commit()
    latest = db.query(WaterReading).order_by(WaterReading.id.desc()).first()
    out = ask(db, "What happened to TDS over the last few readings?")
    assert out["success"] is True
    ans = out["answer"]
    # Must reference more than the latest value: earliest + latest + direction
    assert "100" in ans and "400" in ans
    assert "ncreas" in ans or "irection" in ans
    db.close()


def test_7_crop_suitability_grounded():
    eng, S = make_db()
    db = S()
    seed_critical(db)
    out = ask(db, "Can I use this water for sugarcane?")
    assert out["success"] is True
    ans = out["answer"].lower()
    assert "sugarcane" in ans
    assert "limiting" in ans
    # Must not invent crop thresholds; screening disclaimer required
    assert "laboratory" in ans
    db.close()


def test_8_missing_camera_result():
    eng, S = make_db()
    db = S()
    seed_critical(db)
    out = ask(db, "What did the latest camera analysis detect?")
    assert out["success"] is True
    assert "no camera-analysis result" in out["answer"].lower()
    db.close()


def test_9_missing_reading_no_fabrication():
    eng, S = make_db()
    db = S()
    out = ask(db, "What is my latest water reading?")
    assert out["success"] is True
    ans = out["answer"].lower()
    assert "couldn't retrieve" in ans or "no " in ans
    # Must not contain any plausible fabricated number
    for token in ("4.5", "1800", " 7.2", "320 mg"):
        assert token not in out["answer"]
    db.close()


def test_10_provider_failure_falls_back(monkeypatch):
    eng, S = make_db()
    db = S()
    seed_critical(db)

    def boom(*a, **k):
        raise RuntimeError("All configured AI providers failed.")

    monkeypatch.setattr(chat, "ask_ai", boom)
    out = ask(db, "Tell me something interesting about my water setup and fish?")
    assert out["success"] is True
    # Grounded fallback still carries the real reading
    assert "4.5" in out["answer"] or "pH" in out["answer"]
    assert out["model"] == "fallback-grounded"
    db.close()


def test_11_units_and_numerical_evidence():
    eng, S = make_db()
    db = S()
    seed_critical(db)
    out = ask(db, "Which parameter is causing the biggest problem?")
    assert out["success"] is True
    ans = out["answer"]
    assert "mg/L" in ans and "NTU" in ans and "°C" in ans
    db.close()
