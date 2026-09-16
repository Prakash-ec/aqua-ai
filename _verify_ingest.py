#!/usr/bin/env python3
"""Final verification for ESP32 ingestion endpoint and sketch."""
import os, sys, re, json, io, base64
from PIL import Image
from fastapi.testclient import TestClient
from backend.main import app

PASS = 0
FAIL = 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS: {name}" + (f"  - {detail}" if detail else ""))
    else:
        FAIL += 1
        print(f"  FAIL: {name}" + (f"  - {detail}" if detail else ""))

print("=" * 70)
print("ESP32 INGESTION - FINAL VERIFICATION")
print("=" * 70)

print("\n[1] SYNTAX / IMPORT CHECKS")
try:
    import subprocess
    for fn in ["backend/routes/readings.py", "backend/models.py", "backend/migrations.py"]:
        r = subprocess.run([sys.executable, "-m", "py_compile", fn],
                           cwd="D:/aqua-ai", capture_output=True, text=True)
        check(f"{fn} compiles", r.returncode == 0, r.stderr.strip() or "ok")
    r = subprocess.run(["node", "--check", "frontend/app.js"],
                       cwd="D:/aqua-ai", capture_output=True, text=True)
    check("frontend/app.js JS syntax", r.returncode == 0, r.stderr.strip() or "ok")
except Exception as e:
    check("syntax checks", False, str(e))
