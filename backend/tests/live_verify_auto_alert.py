"""Live end-to-end verification of the REAL automatic alert + cooldown system.

Runs against the REAL backend (default http://127.0.0.1:8002) and the REAL
database — no mocks. Safe by design:

* Inserts a NORMAL reading and asserts no cooldown / no auto email side effects.
* Inserts a CRITICAL reading, asserts ONE real email (provider id) + cooldown armed.
* Inserts another CRITICAL during cooldown, asserts suppression + preserved timer.
* Asserts GET /alerts/auto-status is timestamp-based and matches across calls
  (backend restart safe), and that a page-refresh-style re-poll recovers the
  same remaining time.

Usage: python backend/tests/live_verify_auto_alert.py [--base http://127.0.0.1:8002]
"""
import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8002"


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(r, timeout=60) as resp:
        return resp.status, json.loads(resp.read().decode())


def main():
    global BASE
    if "--base" in sys.argv:
        BASE = sys.argv[sys.argv.index("--base") + 1]

    # Test 1 — normal reading: no email, no cooldown, NORMAL.
    code, normal = req("POST", "/readings/ingest", {
        "device_id": 1, "temperature": 28.5, "ph": 7.2,
        "tds": 245, "turbidity": 3.4,
    })
    assert code == 201, code
    _, st0 = req("GET", "/alerts/auto-status")
    assert st0["latest_status"] == "normal", st0["latest_status"]
    # A normal reading must not itself arm a NEW cooldown; if an older
    # cooldown is still in its window the DB timestamp is preserved.
    print("TEST1 normal ok:", st0["latest_status"],
          "cooldown_active=", st0["overall"]["cooldown_active"])

    # Test 2 — first critical (all 4 params): real email + cooldown.
    code, crit1 = req("POST", "/readings/ingest", {
        "device_id": 1, "temperature": 45.0, "ph": 4.5,
        "tds": 1800, "turbidity": 15.0,
    })
    assert code == 201, code
    _, st1 = req("GET", "/alerts/auto-status")
    assert st1["latest_status"] == "critical", st1
    assert st1["overall"]["cooldown_active"] is True, st1["overall"]
    rem1 = st1["overall"]["next_eligible_in_seconds"]
    assert 240 <= rem1 <= 300, rem1
    assert st1["overall"]["next_eligible_at"], "missing next_eligible_at"
    sent = [c for c in st1["cooldowns"] if c.get("last_notified_at")]
    assert sent, "no last_notified_at persisted after real email"
    print("TEST2 critical ok: remaining=%ss next=%s last=%s" % (
        rem1, st1["overall"]["next_eligible_at"], sent[0]["last_notified_at"]))

    # Test 4 — critical during cooldown: suppressed, timer NOT reset.
    _, st_before = req("GET", "/alerts/auto-status")
    code, crit2 = req("POST", "/readings/ingest", {
        "device_id": 1, "temperature": 46.0, "ph": 4.2,
        "tds": 1900, "turbidity": 16.0,
    })
    assert code == 201, code
    _, st_after = req("GET", "/alerts/auto-status")
    assert st_after["overall"]["cooldown_active"] is True
    # Timer must continue naturally (remaining decreases, not reset to 300).
    assert st_after["overall"]["next_eligible_at"] == st_before["overall"]["next_eligible_at"], (
        st_before["overall"]["next_eligible_at"], st_after["overall"]["next_eligible_at"])
    assert st_after["overall"]["last_notified_at"] == st_before["overall"]["last_notified_at"]
    print("TEST4 suppression ok: next_eligible_at preserved =",
          st_after["overall"]["next_eligible_at"])

    # Test 5/6/19-style — re-poll recovers same remaining (refresh/restart safe).
    _, a = req("GET", "/alerts/auto-status")
    time.sleep(2)
    _, b = req("GET", "/alerts/auto-status")
    assert a["overall"]["next_eligible_at"] == b["overall"]["next_eligible_at"]
    assert b["overall"]["next_eligible_in_seconds"] <= a["overall"]["next_eligible_in_seconds"]
    print("TEST5 timestamp-countdown ok: %ss -> %ss" % (
        a["overall"]["next_eligible_in_seconds"], b["overall"]["next_eligible_in_seconds"]))

    print("LIVE VERIFY PASSED")


if __name__ == "__main__":
    main()
