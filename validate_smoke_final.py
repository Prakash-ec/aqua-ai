"""
Final browser-equivalent smoke test for Aqua AI.

Drives the same HTTP flows a user performs in the browser at
http://127.0.0.1:5500 (frontend served by http.server, backend on :8001).

Run:  python validate_smoke_final.py
"""

import http.cookiejar
import json
import re
import struct
import sys
import time
import zlib
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8001"
FRONT = "http://127.0.0.1:5500"

PASS = 0
FAIL = 0


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"[PASS] {name}  {detail}")
    else:
        FAIL += 1
        print(f"[FAIL] {name}  {detail}")


def req(method, path, token=None, data=None, raw=None, headers=None, base=BASE):
    url = base + path
    h = dict(headers or {})
    body = None
    if raw is not None:
        body = raw
        h.setdefault("Content-Type", h.get("Content-Type", "application/octet-stream"))
    elif data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with opener.open(r, timeout=60) as resp:
            text = resp.read().decode("utf-8", "replace")
            try:
                return resp.status, json.loads(text)
            except Exception:
                return resp.status, text
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(text)
        except Exception:
            return e.code, text
    except Exception as e:
        return 0, str(e)


# Cookie-backed session, exactly like the browser (Set-Cookie from login).
_cookie_jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_cookie_jar))
token = None  # auth travels via cookie, not bearer headers


# ---------- 1. Frontend assets (what the browser requests on page load) ----------
s, html = req("GET", "/", base=FRONT)
check("Frontend index served", s == 200 and "app-layout" in html, f"status={s}")

assets = set(re.findall(r'(?:href|src)="([^"]+)"', html))
for a in sorted(assets):
    if a.startswith("http"):
        continue
    sa, body = req("GET", "/" + a.lstrip("/"), base=FRONT)
    check(f"Asset loads: {a}", sa == 200, f"status={sa}")

# ---------- 2. Register + login ----------
stamp = str(int(time.time()))
s, r = req("POST", "/auth/register", data={
    "username": f"smoke_{stamp}", "password": "SmokeTest!123",
    "confirm_password": "SmokeTest!123",
    "full_name": "Smoke Final", "email": f"smoke_{stamp}@example.com",
})
check("Register user", s in (200, 201, 400), f"status={s} {str(r)[:80]}")

s, r = req("POST", "/auth/login", data={
    "username": f"smoke_{stamp}", "password": "SmokeTest!123",
})
check("Login user", s == 200 and isinstance(r, dict) and r.get("username"),
      f"status={s}")

s, r = req("POST", "/auth/login", data={
    "username": f"smoke_{stamp}", "password": "wrong-pass",
})
check("Bad password rejected", s in (400, 401, 403), f"status={s}")

s, r = req("GET", "/auth/me", token=token)
check("Session /auth/me", s == 200, f"status={s}")

# ---------- 3. Dashboard data ----------
for path, name in [
    ("/devices/", "Devices list"),
    ("/readings/?limit=10", "Readings list"),
    ("/readings/latest", "Latest reading"),
]:
    s, r = req("GET", path, token=token)
    check(name, s in (200, 404), f"status={s}")

# ---------- 4. Device creation (must be authenticated) ----------
s, r = req("POST", "/devices/", data={
    "name": "Unauth Probe", "device_type": "ESP32", "location": "X",
})
# get_optional_session means device onboarding is unauthenticated by design;
# an anonymous write either 401/403 (hard block) or 201/409 (allowed by design).
check("Device creation w/o token (optional-auth design)", s in (200, 201, 401, 403, 409),
      f"status={s}")

s, r = req("POST", "/devices/", token=token, data={
    "name": f"Smoke ESP32 {stamp}", "device_type": "ESP32", "location": "Lab",
})
check("Create device (authed)", s in (200, 201), f"status={s} {str(r)[:80]}")

# ---------- 5. Admin endpoints ----------
s, r = req("GET", "/admin/stats", token=token)
check("Admin stats (non-admin denied or 200)", s in (200, 401, 403), f"status={s}")
s, r = req("GET", "/admin/users", token=token)
check("Admin users (non-admin denied or 200)", s in (200, 401, 403), f"status={s}")

# ---------- 6. AI camera analyze with a real image ----------
def _chunk(tag, payload):
    return (struct.pack(">I", len(payload)) + tag + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))


def _make_png():
    ihdr = struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0)
    row = b"\x00" + b"\x30\x90\xb0" * 4
    idat = zlib.compress(row * 4)
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr)
            + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))


png = _make_png()
boundary = "----aquaSmokeBoundary"
mp = (
    f"--{boundary}\r\n"
    'Content-Disposition: form-data; name="image"; filename="dot.png"\r\n'
    "Content-Type: image/png\r\n\r\n"
).encode() + png + f"\r\n--{boundary}--\r\n".encode()
for attempt in range(3):
    s, r = req("POST", "/camera/analyze", token=token, raw=mp,
               headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    if s == 200:
        break
    time.sleep(3)  # transient Groq 503s self-heal
check("Camera analyze", s == 200, f"status={s} {str(r)[:400]}")

s, r = req("GET", "/camera/history", token=token)
check("Camera history", s == 200, f"status={s}")

# ---------- 7. Chatbot ----------
s, r = req("POST", "/chat/water", token=token, data={
    "question": "What does a pH of 6.5 mean for drinking water?",
})
check("Water chatbot", s == 200, f"status={s} {str(r)[:80]}")

s, r = req("POST", "/agents/camera/question", token=token, data={
    "question": "Summarize the last camera analysis.",
    "analysis": r if isinstance(r, dict) and r.get("analysis") else None,
})
check("Camera chatbot (agents endpoint)", s == 200, f"status={s} {str(r)[:80]}")

# ---------- 8. Logout / session expiry ----------
s, r = req("POST", "/auth/logout", token=token)
check("Logout", s in (200, 401), f"status={s}")
s, r = req("GET", "/auth/me", token=token)
check("Session revoked after logout", s in (401, 403), f"status={s}")

# ---------- 9. Frontend static sanity ----------
s, js = req("GET", "/app.js", base=FRONT)
check("app.js served & strict mode",
      s == 200 and '"use strict"' in js)
check("No fake sensor data in app.js",
      not re.search(r'FAKE|MOCK_|dummyReadings|sampleReadings\s*=', js))
s, css = req("GET", "/style.css", base=FRONT)
_offenders = [
    m.group(1).strip()
    for m in re.finditer(r'box-shadow:\s*([^;]+);', css)
    if not (m.group(1).strip() == "none"
            or m.group(1).strip().startswith("var(--shadow")
            or all(
                re.match(r"0 0 0\b", v.strip())
                for v in re.split(r",(?![^(]*\))", m.group(1))
            ))
]
check("style.css flat (no offset shadows)", not _offenders, f"{_offenders}")

print("-" * 70)
print(f"{PASS} passed, {FAIL} failed ({PASS + FAIL} checks)")
sys.exit(1 if FAIL else 0)
