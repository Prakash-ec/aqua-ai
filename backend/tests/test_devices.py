"""Devices section audit: creation, validation, ingestion linkage, deletion.

Covers the device-management reliability contract:
- create device returns the real DB-generated ID
- whitespace-only name / device_type rejected (422), whitespace location -> None
- duplicate exact names rejected (409)
- valid reading ingested and linked to the correct device only
- invalid / deleted device IDs rejected (404), null device_id rejected (422)
- per-device latest readings isolated (no global mix-up)
- delete removes device + readings + camera predictions, preserves alerts
  as history with device_id SET NULL, and the deleted ID is then rejected
- delete of missing device returns 404 (incl. delete-twice)

Uses the same sqlite harness pattern as the alert test modules so no
production database is touched.
"""
import os
import sys
import tempfile
import time

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/device_audit_tests.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base, get_db
import backend.models  # noqa: F401
from backend.models import Alert, CameraPrediction, Device, WaterReading

_tmpfile = tempfile.mktemp(suffix=".db")
_engine = create_engine(
    f"sqlite:///{_tmpfile}",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
Base.metadata.create_all(bind=_engine)
_TestingSession = sessionmaker(bind=_engine, autocommit=False, autoflush=False)


def _override_db():
    db = _TestingSession()
    try:
        yield db
    finally:
        db.close()


from backend.main import app  # noqa: E402

app.dependency_overrides[get_db] = _override_db
client = TestClient(app, raise_server_exceptions=False)

_counter = [0]


def _unique(prefix):
    _counter[0] += 1
    return f"{prefix}-{int(time.time() * 1000)}-{_counter[0]}"


def _create_device(name=None, device_type="ESP32", location="Test Lab"):
    return client.post(
        "/devices/",
        json={
            "name": name or _unique("Aqua Test Device"),
            "device_type": device_type,
            "location": location,
        },
    )


# ---------- creation ----------

def test_create_device_returns_real_db_id():
    name = _unique("Aqua Test Device")
    response = _create_device(name=name)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["success"] is True
    device = body["device"]
    assert isinstance(device["id"], int) and device["id"] >= 1
    assert device["name"] == name
    # The ID must exist in the database.
    db = _TestingSession()
    try:
        assert db.query(Device).filter(Device.id == device["id"]).first() is not None
    finally:
        db.close()


def test_duplicate_exact_name_rejected():
    name = _unique("Aqua Test Device")
    assert _create_device(name=name).status_code == 201
    second = _create_device(name=name)
    assert second.status_code == 409, second.text


def test_whitespace_name_rejected():
    response = _create_device(name="   ")
    assert response.status_code == 422, response.text


def test_empty_name_rejected():
    response = client.post(
        "/devices/", json={"name": "", "device_type": "ESP32"}
    )
    assert response.status_code == 422, response.text


def test_whitespace_device_type_rejected():
    response = _create_device(device_type="   ")
    assert response.status_code == 422, response.text


def test_whitespace_location_normalized_to_null():
    name = _unique("Loc Device")
    response = _create_device(name=name, location="   ")
    assert response.status_code == 201, response.text
    assert response.json()["device"]["location"] is None


def test_update_whitespace_name_rejected():
    name = _unique("Upd Device")
    created = _create_device(name=name).json()["device"]
    response = client.put(f"/devices/{created['id']}", json={"name": "   "})
    assert response.status_code == 422, response.text


# ---------- ingestion / linkage ----------

def test_valid_reading_linked_to_correct_device():
    ida = _create_device().json()["device"]["id"]
    idb = _create_device().json()["device"]["id"]
    ra = client.post(
        "/readings/ingest",
        json={"device_id": ida, "temperature": 20.0, "ph": 7.0, "tds": 100, "turbidity": 1.0},
    )
    rb = client.post(
        "/readings/ingest",
        json={"device_id": idb, "temperature": 30.0, "ph": 8.0, "tds": 900, "turbidity": 9.0},
    )
    assert ra.status_code == 201, ra.text
    assert rb.status_code == 201, rb.text
    assert ra.json()["device_id"] == ida
    assert rb.json()["device_id"] == idb
    latest_a = client.get(f"/readings/device/{ida}/latest")
    latest_b = client.get(f"/readings/device/{idb}/latest")
    assert latest_a.status_code == 200 and latest_a.json()["device_id"] == ida
    assert latest_b.status_code == 200 and latest_b.json()["device_id"] == idb
    assert latest_a.json()["temperature"] == 20.0
    assert latest_b.json()["temperature"] == 30.0


def test_invalid_device_id_rejected():
    response = client.post(
        "/readings/ingest",
        json={"device_id": 999999, "temperature": 28.5, "ph": 7.2, "tds": 245, "turbidity": 3.4},
    )
    assert response.status_code == 404, response.text
    db = _TestingSession()
    try:
        assert db.query(WaterReading).filter(WaterReading.device_id == 999999).count() == 0
    finally:
        db.close()


def test_null_device_id_rejected():
    response = client.post(
        "/readings/ingest",
        json={"device_id": None, "temperature": 28.5, "ph": 7.2},
    )
    assert response.status_code == 422, response.text


def test_string_device_id_coerced_to_correct_device():
    did = _create_device().json()["device"]["id"]
    response = client.post(
        "/readings/ingest",
        json={"device_id": str(did), "temperature": 28.5, "ph": 7.2, "tds": 245, "turbidity": 3.4},
    )
    assert response.status_code == 201, response.text
    assert response.json()["device_id"] == did


# ---------- deletion ----------

def test_delete_device_without_readings():
    did = _create_device().json()["device"]["id"]
    response = client.delete(f"/devices/{did}")
    assert response.status_code == 200, response.text
    assert client.get(f"/devices/{did}").status_code == 404


def test_delete_device_with_readings_removes_them():
    did = _create_device().json()["device"]["id"]
    for _ in range(2):
        assert (
            client.post(
                "/readings/ingest",
                json={"device_id": did, "temperature": 25.0, "ph": 7.0},
            ).status_code
            == 201
        )
    assert client.delete(f"/devices/{did}").status_code == 200
    db = _TestingSession()
    try:
        assert db.query(Device).filter(Device.id == did).first() is None
        assert db.query(WaterReading).filter(WaterReading.device_id == did).count() == 0
        orphans = (
            db.query(WaterReading)
            .outerjoin(Device, Device.id == WaterReading.device_id)
            .filter(Device.id.is_(None))
            .count()
        )
        assert orphans == 0
    finally:
        db.close()


def test_delete_device_removes_camera_predictions_but_keeps_alerts():
    did = _create_device().json()["device"]["id"]
    reading_id = client.post(
        "/readings/ingest",
        json={"device_id": did, "temperature": 25.0, "ph": 7.0},
    ).json()["id"]
    db = _TestingSession()
    try:
        db.add(CameraPrediction(device_id=did, prediction="screening", confidence=0.5))
        db.add(
            Alert(
                device_id=did,
                reading_id=reading_id,
                parameter="ph",
                severity="critical",
                message="test alert",
            )
        )
        db.commit()
    finally:
        db.close()
    assert client.delete(f"/devices/{did}").status_code == 200
    db = _TestingSession()
    try:
        assert db.query(CameraPrediction).filter(CameraPrediction.device_id == did).count() == 0
        alerts = db.query(Alert).filter(Alert.message == "test alert").all()
        # Alert history is preserved; device/reading references are cleared.
        assert len(alerts) == 1
        assert alerts[0].device_id is None
        assert alerts[0].reading_id is None
    finally:
        db.close()


def test_delete_nonexistent_device_returns_404():
    assert client.delete("/devices/999999").status_code == 404


def test_delete_twice_second_returns_404():
    did = _create_device().json()["device"]["id"]
    assert client.delete(f"/devices/{did}").status_code == 200
    assert client.delete(f"/devices/{did}").status_code == 404


def test_delete_invalid_id_format_rejected():
    response = client.delete("/devices/abc")
    assert response.status_code == 422, response.text


def test_reading_after_deleted_device_rejected():
    did = _create_device().json()["device"]["id"]
    assert client.delete(f"/devices/{did}").status_code == 200
    response = client.post(
        "/readings/ingest",
        json={"device_id": did, "temperature": 28.5, "ph": 7.2, "tds": 245, "turbidity": 3.4},
    )
    assert response.status_code == 404, response.text


def test_end_to_end_create_ingest_verify_delete():
    name = _unique("E2E Device")
    created = _create_device(name=name).json()["device"]
    did = created["id"]
    ingested = client.post(
        "/readings/ingest",
        json={"device_id": did, "temperature": 26.5, "ph": 7.4, "tds": 300, "turbidity": 2.0},
    )
    assert ingested.status_code == 201, ingested.text
    assert ingested.json()["device_id"] == did
    latest = client.get(f"/readings/device/{did}/latest")
    assert latest.status_code == 200 and latest.json()["device_id"] == did
    assert client.delete(f"/devices/{did}").status_code == 200
    assert client.get(f"/devices/{did}").status_code == 404
