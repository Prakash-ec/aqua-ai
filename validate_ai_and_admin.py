#!/usr/bin/env python3
"""
validate_ai_and_admin.py

A repeatable validation script for the Aqua AI AI-provider, camera and
auth/admin backend.

Checks implemented:
1. Configured Groq vision model is actually offered by Groq
   (regression guard for the camera "503 unavailable" outage)
2. /ai/providers exposes a vision-capable provider
3. Health endpoint responds
4. Auth: logged-out 401s, bad credentials 401, admin login 200
5. Admin: /admin/users + /admin/stats reachable as admin, 403 as a
   normal user
6. Logout invalidates the session; a double logout is safe
7. Camera: /camera/analyze rejects a missing file (422) and analyzes a
   real PNG (200) through the vision provider
8. Camera history is reachable while authenticated
9. Model attribute audit: every `<Model>.<attr>` reference under
   backend/ resolves to a real SQLAlchemy mapper attribute

Usage:
    python validate_ai_and_admin.py
"""

import ast
import os
import pathlib
import struct
import sys
import uuid
import zlib

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from fastapi.testclient import TestClient  # noqa: E402

from backend import models  # noqa: E402
from backend.main import app  # noqa: E402
from backend.services import ai_provider  # noqa: E402

passed = 0
failed = 0
check_results = []


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        check_results.append(("PASS", name, detail))
    else:
        failed += 1
        check_results.append(("FAIL", name, detail))


def make_png(width=320, height=240):
    """Build a valid RGB PNG using only the standard library."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw += bytes(((x * 3) % 256, (y * 5) % 256, ((x + y) * 2) % 256))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


# ------------------------------------------------------------------
# 1. Configured Groq vision model must be a model Groq actually serves
# ------------------------------------------------------------------
# This is the regression guard for the camera 503 outage: .env carried
# GROQ_VISION_MODEL=qwen/qwen3.6-27b, a slug Groq does not host, so
# every /camera/analyze call failed with "Camera AI analysis is
# currently unavailable".
configured_model = (ai_provider.GROQ_VISION_MODEL or "").strip()
check("GROQ_VISION_MODEL is configured", bool(configured_model),
      f"value={configured_model!r}")

groq_models = []
model_list_error = ""
if ai_provider.GROQ_API_KEY:
    try:
        from openai import OpenAI

        probe = OpenAI(
            api_key=ai_provider.GROQ_API_KEY,
            base_url="https://api.groq.com/openai/v1",
            timeout=30.0,
            max_retries=0,
        )
        groq_models = sorted(m.id for m in probe.models.list().data)
    except Exception as error:  # network / auth problems
        model_list_error = f"{type(error).__name__}: {error}"
else:
    model_list_error = "GROQ_API_KEY not set"

if model_list_error:
    check("Groq model list reachable", False, model_list_error)
else:
    check("Groq model list reachable", True, f"{len(groq_models)} models")
    check(
        "Configured GROQ_VISION_MODEL exists on Groq",
        configured_model in groq_models,
        f"{configured_model!r} in Groq catalog = "
        f"{configured_model in groq_models}",
    )

# ------------------------------------------------------------------
# 2. /ai/providers must expose a vision-capable provider
# ------------------------------------------------------------------
client = TestClient(app)

r = client.get("/health")
check("GET /health -> 200", r.status_code == 200, f"{r.status_code}")

r = client.get("/ai/providers")
check("GET /ai/providers -> 200", r.status_code == 200, f"{r.status_code}")

vision_providers = []
if r.status_code == 200:
    for provider in r.json().get("providers", []):
        if provider.get("supports_vision") and provider.get("available"):
            vision_providers.append(provider)

check(
    "At least one vision provider is available",
    bool(vision_providers),
    f"vision_providers={[p['id'] for p in vision_providers]}",
)

# ------------------------------------------------------------------
# 3. Auth: logged-out behaviour and login
# ------------------------------------------------------------------
r = client.get("/auth/me")
check("GET /auth/me (logged out) -> 401", r.status_code == 401,
      f"{r.status_code}")

r = client.get("/auth/check")
check("GET /auth/check (logged out) -> 401", r.status_code == 401,
      f"{r.status_code}")

r = client.post("/auth/login",
                json={"username": "nosuchuser", "password": "wrong"})
check("POST /auth/login (bad creds) -> 401", r.status_code == 401,
      f"{r.status_code}")

admin_user = os.getenv("ADMIN_USERNAME", "admin")
admin_pass = os.getenv("ADMIN_PASSWORD", "").strip() or "ChangeMe123!"

admin_client = TestClient(app)
r = admin_client.post("/auth/login",
                      json={"username": admin_user, "password": admin_pass})
check("POST /auth/login (admin) -> 200", r.status_code == 200,
      f"{r.status_code}")

r = admin_client.get("/auth/me")
check(
    "GET /auth/me (admin) reports is_admin true",
    r.status_code == 200 and r.json().get("is_admin") is True,
    f"{r.status_code}",
)

# ------------------------------------------------------------------
# 4. Admin endpoints: allowed for admins, refused for normal users
# ------------------------------------------------------------------
r = admin_client.get("/admin/users")
check("GET /admin/users (admin) -> 200", r.status_code == 200,
      f"{r.status_code}")

r = admin_client.get("/admin/stats")
check("GET /admin/stats (admin) -> 200", r.status_code == 200,
      f"{r.status_code}")

normal_name = "val_" + uuid.uuid4().hex[:8]
normal_client = TestClient(app)
r = normal_client.post(
    "/auth/register",
    json={
        "full_name": "Validation User",
        "email": f"{normal_name}@example.com",
        "username": normal_name,
        "password": "TestPass123!",
        "confirm_password": "TestPass123!",
    },
)
check("POST /auth/register (normal user)", r.status_code in (200, 201),
      f"{r.status_code}")

r = normal_client.post(
    "/auth/login",
    json={"username": normal_name, "password": "TestPass123!"},
)
check("POST /auth/login (normal user) -> 200", r.status_code == 200,
      f"{r.status_code}")

r = normal_client.get("/admin/users")
check("GET /admin/users (normal user) -> 403", r.status_code == 403,
      f"{r.status_code}")

r = normal_client.get("/admin/stats")
check("GET /admin/stats (normal user) -> 403", r.status_code == 403,
      f"{r.status_code}")

# ------------------------------------------------------------------
# 5. Logout invalidates the session; double logout is safe
# ------------------------------------------------------------------
r = admin_client.post("/auth/logout")
check("POST /auth/logout (admin) -> 200", r.status_code == 200,
      f"{r.status_code}")

r = admin_client.get("/auth/me")
check("GET /auth/me after logout -> 401", r.status_code == 401,
      f"{r.status_code}")

r = admin_client.get("/admin/users")
check("GET /admin/users after logout -> 401/403",
      r.status_code in (401, 403), f"{r.status_code}")

r = admin_client.post("/auth/logout")
check("POST /auth/logout twice -> 200 (must not crash)",
      r.status_code == 200, f"{r.status_code}")

# ------------------------------------------------------------------
# 6. Chat requires authentication
# ------------------------------------------------------------------
r = client.post("/chat/water", json={"question": "What is the pH?"})
check("POST /chat/water (logged out) -> 401", r.status_code == 401,
      f"{r.status_code}")

r = normal_client.post("/chat/water", json={"question": ""})
check("POST /chat/water (empty question) -> 422", r.status_code == 422,
      f"{r.status_code}")

# ------------------------------------------------------------------
# 7. Camera analysis end to end (the previously-broken feature)
# ------------------------------------------------------------------
r = client.post("/camera/analyze")
check("POST /camera/analyze (no file) -> 422", r.status_code == 422,
      f"{r.status_code}")

camera_client = TestClient(app)
camera_client.post(
    "/auth/login",
    json={"username": admin_user, "password": admin_pass},
)

r = camera_client.post(
    "/camera/analyze",
    files={"image": ("validate.png", make_png(), "image/png")},
)

analysis_ok = False
provider_used = None
if r.status_code == 200:
    body = r.json()
    analysis = body.get("analysis") or {}
    analysis_ok = bool(analysis.get("overall_observation"))
    provider_used = (body.get("metadata") or {}).get("provider_used")

check(
    "POST /camera/analyze (real image) -> 200 with analysis",
    r.status_code == 200 and analysis_ok,
    f"{r.status_code} {r.text[:140]}",
)
check(
    "POST /camera/analyze reports the vision provider used",
    bool(provider_used),
    f"provider_used={provider_used!r}",
)

r = camera_client.get("/camera/history?limit=3")
check("GET /camera/history (authed) -> 200", r.status_code == 200,
      f"{r.status_code}")

# ------------------------------------------------------------------
# 8. Model attribute audit
# ------------------------------------------------------------------
# Guards against the class of bug found in admin.py, where
# `UserSession.revoked` and `WaterReading.timestamp` did not exist
# (causing /admin/stats to raise AttributeError at runtime).
MODEL_ATTRS = {}
for name in dir(models):
    candidate = getattr(models, name)
    mapper = getattr(candidate, "__mapper__", None)
    if mapper is None:
        continue
    attrs = set(mapper.attrs.keys())
    attrs |= {"metadata", "registry", "query", "__table__",
              "__tablename__", "__mapper__"}
    MODEL_ATTRS[name] = attrs

backend_root = pathlib.Path(BASE_DIR) / "backend"
attr_problems = []
files_scanned = 0

for path in sorted(backend_root.rglob("*.py")):
    if "__pycache__" in path.parts:
        continue
    files_scanned += 1
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError as error:
        attr_problems.append(f"{path}: syntax error {error}")
        continue
    for node in ast.walk(tree):
        if not isinstance(node, ast.Attribute):
            continue
        base = node.value
        if not isinstance(base, ast.Name) or base.id not in MODEL_ATTRS:
            continue
        if node.attr not in MODEL_ATTRS[base.id]:
            attr_problems.append(
                f"{path.name}:{node.lineno}: {base.id}.{node.attr}"
            )

check(
    "Model attribute audit: all attribute references resolve",
    not attr_problems,
    f"scanned {files_scanned} files, {len(attr_problems)} problem(s)"
    + (f": {attr_problems[:5]}" if attr_problems else ""),
)

# ------------------------------------------------------------------
# SUMMARY
# ------------------------------------------------------------------
print("=" * 70)
print("AQUA AI AI-PROVIDER + AUTH/ADMIN VALIDATION")
print("=" * 70)
for status, name, detail in check_results:
    suffix = f"  {detail}" if detail else ""
    print(f"[{status}] {name}{suffix}")
print("-" * 70)
print(f"{passed} passed, {failed} failed ({passed + failed} checks)")
print("=" * 70)

sys.exit(1 if failed else 0)

