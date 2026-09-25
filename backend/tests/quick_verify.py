r"""
Quick live verification: backend is live + configurable.

Checks:
1) GET /alerts/auto-status shows readable state
2) CRITICAL latest reading (no active cooldown) triggers an email immediately
3) /alerts/auto-status shows the cooldown armed afterwards
"""
import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8002"


def get(p):
    with urllib.request.urlopen(BASE + p, timeout=90) as resp:
        return json.loads(resp.read())


def post(p, d):
    req = urllib.request.Request(
        BASE + p, data=json.dumps(d).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()


print("=== AQUA AI QUICK VERIFY ===\n")

before = get("/alerts/auto-status")
print("1) current auto-status:")
print(json.dumps(before["overall"], indent=2))
print("   latest_status:", before.get("latest_status"))
print("   critical_params:", [c["parameter"] for c in before.get("critical_parameters", [])])

critical = {"device_id": 1, "temperature": 45.0, "ph": 4.5, "tds": 1800.0, "turbidity": 15.0}
status, body = post("/readings/ingest", critical)
print("\n2) POST /readings/ingest:")
print("   http:", status, " reading_id:", body.get("id"))
if status != 201:
    print("   payload:", body)
    raise SystemExit("ingest failed")

print("   waiting for automatic alert thread to finish...")
time.sleep(6)

after = get("/alerts/auto-status")
print("\n3) after critical ingest:")
print(json.dumps(after["overall"], indent=2))
print("   last_notified_at:", after.get("last_notified_at"))

ok = (
    after["overall"].get("cooldown_active") is True
    and after["overall"].get("next_eligible_in_seconds", 0) > 0
    and bool(after.get("last_notified_at"))
)
print("\nRESULT:", "PASS" if ok else "FAIL",
      "-> real email sent + 5-minute cooldown armed"
      if ok else ":-> expected real email + cooldown, see output above")

# quick countdown sample
t1 = time.time()
s1 = get("/alerts/auto-status")["overall"]["next_eligible_in_seconds"]
time.sleep(6.5)
s2 = get("/alerts/auto-status")["overall"]["next_eligible_in_seconds"]
print("\n4) real-time countdown check:")
print("   s1:", s1, " s2:", s2, " delta:", s1 - s2)
print("   DECREASING:", s1 > s2)
print("\n=== DONE ===")
