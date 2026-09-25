"""Live verification: backend-driven startup alert + real timestamp cooldown.

Runs against a REAL backend (default http://127.0.0.1:8002), the REAL
database and the REAL email provider. No mocks, no fakes.

Modes
-----
``--mode=full`` (default)
    Full live sequence against the running backend:
      * suppression while a persisted cooldown is active (no second email)
      * live countdown samples (remaining = next_eligible_at - now)
      * expiry: remaining reaches 0, no email is sent by expiry itself
      * NORMAL reading: no email, cooldown preserved
      * CRITICAL reading after expiry: REAL email + new cooldown
      * CRITICAL reading during cooldown: suppressed, timestamp preserved
      * writes evidence JSON for the restart check
``--mode=restart-check``
    Run after restarting the backend: proves the cooldown was reconstructed
    from the database (same next_eligible_at, lower remaining, no new email).

Usage
-----
python backend/tests/live_verify_startup_alert.py --mode=full
"""
import argparse
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE = os.getenv("AQUA_BASE_URL", "http://127.0.0.1:8002").rstrip("/")
EVIDENCE_PATH = os.getenv(
    "AQUA_LIVE_EVIDENCE",
    os.path.join(tempfile.gettempdir(), "aqua_live_startup_alert_evidence.json"),
)
DEVICE_ID = int(os.getenv("AQUA_LIVE_DEVICE_ID", "1"))

NORMAL_READING = {"device_id": DEVICE_ID, "temperature": 28.5, "ph": 7.2, "tds": 245.0, "turbidity": 3.4}
CRITICAL_READING = {"device_id": DEVICE_ID, "temperature": 45.0, "ph": 4.5, "tds": 1800.0, "turbidity": 15.0}

CHECKS = []


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(message):
    print(f"[LIVE {now_iso()}] {message}", flush=True)


def record(name, ok, detail=""):
    CHECKS.append({"check": name, "ok": bool(ok), "detail": detail})
    log(f"{'PASS' if ok else 'FAIL'} {name} :: {detail}")
    return bool(ok)


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def post(path, body):
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:  # pragma: no cover - live path
        return error.code, error.read().decode("utf-8", "replace")


def overall():
    return get("/alerts/auto-status")["overall"]


def notified_map():
    """Latest successful notification timestamp per parameter, device-scoped."""
    out = {}
    for row in get("/alerts?status=all"):
        param = row.get("parameter")
        last = row.get("last_notified_at")
        if row.get("device_id") != DEVICE_ID:
            continue
        if not param or not last:
            continue
        if param not in out or last > out[param]:
            out[param] = last
    return out


def _parse_utc(value):
    return datetime.strptime(str(value)[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)


def device_cooldown(cooldown_seconds):
    """Device-scoped cooldown derived from the persisted notification timestamp.

    remaining = next_eligible_at - now, where
    next_eligible_at = max(last_notified_at for this device) + cooldown.
    Independent of other devices, so it is a reliable cross-check for the
    public GET /alerts/auto-status payload.
    """
    latest = notified_map()
    if not latest:
        return {"last_notified_at": None, "next_eligible_at": None, "remaining": 0}
    newest = max(latest.values())
    deadline = _parse_utc(newest) + timedelta(seconds=cooldown_seconds)
    now = datetime.now(timezone.utc)
    remaining = max(0, int(round((deadline - now).total_seconds())))
    return {
        "last_notified_at": newest,
        "next_eligible_at": deadline.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "remaining": remaining,
        "params": latest,
    }


def ingest(payload):
    status_code, body = post("/readings/ingest", payload)
    reading_id = body.get("id") if isinstance(body, dict) else None
    log(f"ingest http={status_code} reading_id={reading_id} payload={json.dumps(payload)}")
    return status_code, body


def wait_for_expiry(max_seconds, cooldown_seconds, samples=None, step=2.0):
    """Poll until the DEVICE cooldown expires (device-scoped, drift-proof)."""
    started = time.time()
    last = None
    while time.time() - started < max_seconds:
        state = get("/alerts/auto-status")
        api_overall = state["overall"]
        derived = device_cooldown(cooldown_seconds)
        last = {"api": api_overall, "derived": derived, "latest_status": state.get("latest_status")}
        if samples is not None:
            samples.append({
                "t": now_iso(),
                "api_remaining": api_overall.get("next_eligible_in_seconds"),
                "api_cooldown_active": api_overall.get("cooldown_active"),
                "api_next_eligible_at": api_overall.get("next_eligible_at"),
                "derived_remaining": derived["remaining"],
                "derived_next_eligible_at": derived["next_eligible_at"],
                "latest_status": state.get("latest_status"),
            })
            log(f"countdown api_remaining={api_overall.get('next_eligible_in_seconds')}s "
                f"derived_remaining={derived['remaining']}s "
                f"next_eligible_at={derived['next_eligible_at']} "
                f"latest_status={state.get('latest_status')}")
        if derived["remaining"] <= 0:
            return last
        time.sleep(step)
    return last


def run_full(max_wait=None):
    evidence = {"started_at": now_iso(), "base": BASE, "device_id": DEVICE_ID}
    log("=== AQUA AI LIVE VERIFY: backend-driven startup alert + real cooldown ===")
    config = get("/alerts/config")
    cooldown_seconds = int(config["cooldown_minutes"]) * 60
    if not max_wait:
        max_wait = cooldown_seconds + 150
    log(f"configured cooldown_minutes={config['cooldown_minutes']} ({cooldown_seconds}s) "
        f"alerts_enabled={config['alerts_enabled']}")
    evidence["config"] = config
    evidence["cooldown_seconds"] = cooldown_seconds

    # ---------- PHASE A: act on the REAL persisted state (read-only probe) ----------
    baseline_notified = notified_map()
    state = overall()
    evidence["start_overall"] = state
    evidence["baseline_notified"] = baseline_notified
    start_cooldown = device_cooldown(cooldown_seconds)
    evidence["start_device_cooldown"] = start_cooldown
    log(f"device cooldown from persisted DB timestamps: {json.dumps(start_cooldown)}")

    if start_cooldown["remaining"] > 0:
        # A real cooldown is running: another critical reading must be suppressed.
        before_next = device_cooldown(cooldown_seconds)["next_eligible_at"]
        ingest(CRITICAL_READING)
        after_map = notified_map()
        after_next = device_cooldown(cooldown_seconds)["next_eligible_at"]
        record(
            "A1 critical during cooldown sends NO second email",
            after_map == baseline_notified,
            f"last_notified_at unchanged {json.dumps(baseline_notified)}",
        )
        record(
            "A2 critical during cooldown does NOT reset the timer",
            after_next == before_next,
            f"next_eligible_at {before_next} -> {after_next}",
        )
        evidence["suppression"] = {
            "next_eligible_at_before": before_next,
            "next_eligible_at_after": after_next,
            "notified_before": baseline_notified,
            "notified_after": after_map,
        }
    else:
        # Eligible (latest reading normal, or cooldown already expired):
        # a critical reading must now produce a REAL email and a new cooldown.
        log("backend reports no active cooldown for this device: a critical reading must send now")
        status_code, _ = ingest(CRITICAL_READING)
        state = get("/alerts/auto-status")
        first_map = notified_map()
        record(
            "A1 critical with no active cooldown sent a REAL email and armed a cooldown",
            status_code == 201
            and state["overall"].get("cooldown_active") is True
            and first_map != baseline_notified
            and first_map != {},
            f"cooldown_active={state['overall'].get('cooldown_active')} "
            f"next_eligible_at={state['overall'].get('next_eligible_at')} "
            f"last_notified={json.dumps(first_map)}",
        )
        evidence["first_critical"] = {"overall": state["overall"], "notified": first_map}

    # ---------- PHASE B: live countdown until expiry ----------
    pre_expiry_notified = notified_map()
    samples = []
    expired = wait_for_expiry(max(30, max_wait), cooldown_seconds, samples=samples, step=2.0)
    evidence["countdown_samples"] = samples
    distinct = sorted(
        {s["derived_remaining"] for s in samples if s["derived_remaining"] is not None},
        reverse=True,
    )
    record(
        "B1 countdown decreases in real time (backend timestamps)",
        len(distinct) >= 3,
        f"observed remaining values: {distinct[:12]}",
    )
    if expired["derived"]["remaining"] > 0:
        leftover = expired["derived"]["remaining"]
        log(f"cooldown still active with {leftover}s left after {max_wait}s of sampling; "
            f"remaining phases skipped - re-run with a larger --max-wait to finish")
        evidence["pending_expiry"] = True
        evidence["checks"] = CHECKS
        with open(EVIDENCE_PATH, "w", encoding="utf-8") as handle:
            json.dump(evidence, handle, indent=2)
        return 3
    notified_at_expiry = notified_map()
    api_after_expiry = overall()
    record(
        "B2 cooldown expired (derived from DB timestamps, api agrees)",
        expired["derived"]["remaining"] == 0
        and api_after_expiry.get("cooldown_active") is False
        and (api_after_expiry.get("next_eligible_in_seconds") or 0) == 0,
        f"derived_remaining={expired['derived']['remaining']} "
        f"api_cooldown_active={api_after_expiry.get('cooldown_active')} "
        f"api_remaining={api_after_expiry.get('next_eligible_in_seconds')}",
    )
    record(
        "B3 expiry alone sends NO email (READY, not sent)",
        notified_at_expiry == pre_expiry_notified,
        f"last_notified_at after expiry: {json.dumps(notified_at_expiry)}",
    )
    evidence["expiry"] = {
        "derived": expired["derived"],
        "api": api_after_expiry,
        "notified_at_expiry": notified_at_expiry,
    }

    # ---------- PHASE C: NORMAL reading after expiry ----------
    ingest(NORMAL_READING)
    normal_state = get("/alerts/auto-status")
    normal_overall = normal_state["overall"]
    normal_map = notified_map()
    record(
        "C1 NORMAL reading: no email, no new cooldown",
        normal_map == notified_at_expiry and normal_overall.get("cooldown_active") is False,
        f"latest_status={normal_state.get('latest_status')} "
        f"cooldown_active={normal_overall.get('cooldown_active')}",
    )
    evidence["normal_after_expiry"] = {"overall": normal_overall, "notified": normal_map}

    # ---------- PHASE D: CRITICAL reading after expiry -> REAL email ----------
    status_code, _ = ingest(CRITICAL_READING)
    d_state = get("/alerts/auto-status")
    d_overall = d_state["overall"]
    d_map = notified_map()
    record(
        "D1 reading saved (HTTP 201)",
        status_code == 201,
        f"http={status_code}",
    )
    record(
        "D2 CRITICAL after expiry sent a REAL email",
        d_map != normal_map,
        f"last_notified_at {json.dumps(normal_map)} -> {json.dumps(d_map)}",
    )
    record(
        "D3 new cooldown armed from next_eligible_at - last_notified_at",
        d_overall.get("cooldown_active") is True
        and (d_overall.get("next_eligible_in_seconds") or 0) > 0,
        f"next_eligible_at={d_overall.get('next_eligible_at')} "
        f"remaining={d_overall.get('next_eligible_in_seconds')}",
    )
    evidence["critical_after_expiry"] = {"overall": d_overall, "notified": d_map, "http": status_code}

    # ---------- PHASE E: live countdown samples of the NEW cooldown ----------
    tick_samples = []
    for _ in range(12):
        tick_samples.append(overall().get("next_eligible_in_seconds"))
        time.sleep(1.0)
    evidence["new_cooldown_ticks"] = tick_samples
    record(
        "E1 new cooldown counts down every second without a refresh",
        len({v for v in tick_samples}) >= 5 and tick_samples[0] > tick_samples[-1],
        f"observed seconds: {tick_samples}",
    )

    # ---------- PHASE F: CRITICAL during the new cooldown -> suppressed ----------
    before_suppress = overall()
    before_suppress_map = notified_map()
    status_code, _ = ingest(CRITICAL_READING)
    after_suppress = overall()
    after_suppress_map = notified_map()
    record(
        "F1 critical during cooldown sends NO second email",
        after_suppress_map == before_suppress_map,
        f"last_notified_at unchanged {json.dumps(before_suppress_map)}",
    )
    record(
        "F2 cooldown NOT reset by the suppressed reading",
        after_suppress.get("next_eligible_at") == before_suppress.get("next_eligible_at"),
        f"next_eligible_at {before_suppress.get('next_eligible_at')} -> "
        f"{after_suppress.get('next_eligible_at')}",
    )
    evidence["suppression_after_expiry"] = {
        "http": status_code,
        "next_eligible_at": after_suppress.get("next_eligible_at"),
        "remaining": after_suppress.get("next_eligible_in_seconds"),
        "notified": after_suppress_map,
    }

    # ---------- PHASE G: NORMAL during cooldown keeps the cooldown ----------
    ingest(NORMAL_READING)
    g_state = get("/alerts/auto-status")
    g_map = notified_map()
    record(
        "G1 NORMAL during cooldown: no email, cooldown preserved",
        g_map == after_suppress_map and g_state["overall"].get("cooldown_active") is True,
        f"latest_status={g_state.get('latest_status')} "
        f"cooldown_active={g_state['overall'].get('cooldown_active')} "
        f"next_eligible_at={g_state['overall'].get('next_eligible_at')}",
    )
    evidence["normal_during_cooldown"] = {"overall": g_state["overall"], "notified": g_map}

    # ---------- PHASE H: leave a CRITICAL latest reading during the cooldown ----------
    # This is the state the backend restart test needs: on startup the check
    # must find a critical latest reading AND an active persisted cooldown.
    status_code, _ = ingest(CRITICAL_READING)
    h_state = get("/alerts/auto-status")
    h_map = notified_map()
    record(
        "H1 critical latest reading stored while cooldown active (restart fixture)",
        status_code == 201
        and h_state["latest_status"] == "critical"
        and h_map == after_suppress_map
        and h_state["overall"].get("cooldown_active") is True,
        f"http={status_code} latest_status={h_state['latest_status']} "
        f"cooldown_active={h_state['overall'].get('cooldown_active')} "
        f"next_eligible_at={h_state['overall'].get('next_eligible_at')}",
    )

    evidence["finished_at"] = now_iso()
    evidence["checks"] = CHECKS
    evidence["restart_expectation"] = {
        "next_eligible_at": h_state["overall"].get("next_eligible_at"),
        "remaining_seconds": h_state["overall"].get("next_eligible_in_seconds"),
        "last_notified_at": h_map,
        "cooldown_seconds": cooldown_seconds,
        "latest_status": h_state.get("latest_status"),
    }
    with open(EVIDENCE_PATH, "w", encoding="utf-8") as handle:
        json.dump(evidence, handle, indent=2)
    log(f"evidence written to {EVIDENCE_PATH}")
    failed = [c for c in CHECKS if not c["ok"]]
    log(f"=== FULL MODE finished: {len(CHECKS) - len(failed)}/{len(CHECKS)} checks passed ===")
    for item in failed:
        log(f"FAILED CHECK: {item['check']} :: {item['detail']}")
    return 1 if failed else 0


def build_restart_expectation():
    """The state recorded by ``--mode=full`` that the restart check compares to."""
    if not os.path.exists(EVIDENCE_PATH):
        return None, None
    with open(EVIDENCE_PATH, "r", encoding="utf-8") as handle:
        evidence = json.load(handle)
    return evidence, evidence.get("restart_expectation")


def run_restart_check():
    """Run AFTER restarting the backend, while the cooldown is still active.

    Proves the cooldown is reconstructed from the database:
      * the latest reading is still critical,
      * the startup check did NOT send another email and did NOT reset the timer,
      * next_eligible_at is unchanged while remaining seconds went DOWN,
      * remaining is always next_eligible_at - now (never a full 5:00 again).
    """
    log("=== AQUA AI LIVE VERIFY: backend restart reconstruction ===")
    evidence, expected = build_restart_expectation()
    if not expected:
        record("R0 restart fixture present", False,
               f"run --mode=full first (missing {EVIDENCE_PATH})")
        return 1
    log(f"expectation from pre-restart run: {json.dumps(expected)}")

    state = get("/alerts/auto-status")
    overall_now = state["overall"]
    notified_now = notified_map()
    record(
        "R1 latest reading still critical after restart",
        state.get("latest_status") == expected.get("latest_status"),
        f"latest_status={state.get('latest_status')} "
        f"expected={expected.get('latest_status')}",
    )
    record(
        "R2 cooldown reconstructed from the database (still active)",
        overall_now.get("cooldown_active") is True
        and overall_now.get("next_eligible_at") == expected.get("next_eligible_at"),
        f"next_eligible_at={overall_now.get('next_eligible_at')} "
        f"expected={expected.get('next_eligible_at')}",
    )
    previous_remaining = expected.get("remaining_seconds")
    now_remaining = overall_now.get("next_eligible_in_seconds")
    record(
        "R3 remaining time came DOWN (timer NOT reset to the full cooldown)",
        now_remaining is not None
        and previous_remaining is not None
        and 0 < now_remaining < previous_remaining,
        f"{previous_remaining}s before restart -> {now_remaining}s after restart "
        f"(full cooldown would be {expected.get('cooldown_seconds')}s)",
    )
    record(
        "R4 remaining is not the full configured cooldown",
        now_remaining is not None and now_remaining < expected.get("cooldown_seconds", 0),
        f"remaining={now_remaining}s cooldown_seconds={expected.get('cooldown_seconds')}",
    )
    record(
        "R5 restart sent NO duplicate email (cooldown preserved)",
        notified_now == expected.get("last_notified_at"),
        f"last_notified_at {json.dumps(expected.get('last_notified_at'))} -> "
        f"{json.dumps(notified_now)}",
    )

    # Independent cross-check: fields exist in the payload the frontend uses.
    record(
        "R6 auto-status exposes timestamp fields for the frontend clock",
        overall_now.get("next_eligible_at") is not None
        and overall_now.get("last_notified_at") is not None
        and isinstance(overall_now.get("next_eligible_in_seconds"), int),
        f"payload keys={sorted(overall_now.keys())}",
    )

    if evidence is not None:
        evidence["restart_check"] = {
            "ran_at": now_iso(),
            "overall": overall_now,
            "notified": notified_now,
            "checks": [c for c in CHECKS if c["check"].startswith("R")],
        }
        with open(EVIDENCE_PATH, "w", encoding="utf-8") as handle:
            json.dump(evidence, handle, indent=2)
        log(f"restart evidence merged into {EVIDENCE_PATH}")

    failed = [c for c in CHECKS if not c["ok"]]
    log(f"=== RESTART MODE finished: {len(CHECKS) - len(failed)}/{len(CHECKS)} checks passed ===")
    for item in failed:
        log(f"FAILED CHECK: {item['check']} :: {item['detail']}")
    return 1 if failed else 0


def main():
    parser = argparse.ArgumentParser(description="Live verification of the automatic alert system")
    parser.add_argument("--mode", choices=("full", "restart-check"), default="full")
    args = parser.parse_args()
    try:
        if args.mode == "restart-check":
            return run_restart_check()
        return run_full()
    except urllib.error.URLError as error:
        log(f"FAILED: backend not reachable at {BASE} ({error})")
        return 2


if __name__ == "__main__":
    sys.exit(main())
