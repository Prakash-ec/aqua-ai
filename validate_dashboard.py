#!/usr/bin/env python3
"""
validate_dashboard.py

A repeatable validation script for the Aqua AI frontend.

Checks implemented:
1. HTML div tag balance (opening vs closing count)
2. Structural tag balance (section, main, aside, nav, form, article)
3. Duplicate HTML IDs detection
4. CSS variable usage check (undefined variables)
5. API endpoint consistency check
6. JavaScript syntax check (via node --check)
7. Git whitespace check (via git diff --check)

Usage:
    python validate_dashboard.py
"""

import re
import os
import subprocess
import sys

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
INDEX_HTML = os.path.join(FRONTEND_DIR, "index.html")
APP_JS = os.path.join(FRONTEND_DIR, "app.js")
STYLE_CSS = os.path.join(FRONTEND_DIR, "style.css")

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
# ------------------------------------------------------------------
# 1. HTML div tag balance
# ------------------------------------------------------------------
if os.path.exists(INDEX_HTML):
    with open(INDEX_HTML, "r", encoding="utf-8") as f:
        html_content = f.read()

    open_divs = len(re.findall(r'<div\b[^>]*>', html_content))
    close_divs = len(re.findall(r'</div>', html_content))
    check("HTML div balance", open_divs == close_divs,
          f"opens={open_divs}, closes={close_divs}")
else:
    check("HTML file exists", False, f"{INDEX_HTML} not found")

# ------------------------------------------------------------------
# 2. Structural tag balance
# ------------------------------------------------------------------
if os.path.exists(INDEX_HTML):
    for tag in ["section", "main", "aside", "nav", "form", "article",
                "table", "thead", "tbody", "tr", "footer", "header"]:
        open_count = len(re.findall(rf'<{tag}\b[^>]*>', html_content))
        close_count = len(re.findall(rf'</{tag}>', html_content))
        check(f"HTML <{tag}> balance", open_count == close_count,
              f"opens={open_count}, closes={close_count}")

# ------------------------------------------------------------------
# 3. Duplicate HTML IDs
# ------------------------------------------------------------------
if os.path.exists(INDEX_HTML):
    ids = re.findall(r'\bid=["\']([^"\'\\s]+)["\']', html_content)
    id_counts = {}
    for id_val in ids:
        id_counts[id_val] = id_counts.get(id_val, 0) + 1

    duplicates = {k: v for k, v in id_counts.items() if v > 1}
    check("Duplicate IDs", len(duplicates) == 0,
          f"Duplicates: {duplicates}" if duplicates else "No duplicates found")
# ------------------------------------------------------------------
# 4. CSS variable usage check
# ------------------------------------------------------------------
if os.path.exists(STYLE_CSS) and os.path.exists(INDEX_HTML):
    with open(STYLE_CSS, "r", encoding="utf-8") as f:
        css_content = f.read()

    # Find all CSS variable definitions anywhere in CSS
    all_defined_vars = set()
    for m in re.finditer(r'--([a-zA-Z][\w-]*)\s*:', css_content):
        all_defined_vars.add(m.group(1))

    # Find every var() call in CSS - both with and without fallback
    # Capture the variable name and whether it has a fallback
    css_var_usages = []
    for m in re.finditer(r'var\((--[^,\s)]+)(?:\s*,\s*([^)]*))?\)', css_content):
        name = m.group(1).lstrip('-')
        has_fallback = m.group(2) is not None
        css_var_usages.append((name, has_fallback))

    # Find every var() call in HTML
    html_var_usages = []
    for m in re.finditer(r'var\((--[^,\s)]+)(?:\s*,\s*([^)]*))?\)', html_content):
        name = m.group(1).lstrip('-')
        has_fallback = m.group(2) is not None
        html_var_usages.append((name, has_fallback))

    # Combine usages
    all_usages = css_var_usages + html_var_usages

    # A variable is "effectively defined" if:
    #   1. It is explicitly defined in CSS (--var-name: value), OR
    #   2. It is used *everywhere* with a fallback value
    # A variable is "undefined" if it is used somewhere WITHOUT a fallback
    # and is NOT defined in CSS.
    usage_without_fallback = set()
    usage_anywhere = set()
    for name, has_fallback in all_usages:
        usage_anywhere.add(name)
        if not has_fallback:
            usage_without_fallback.add(name)

    undefined_vars = {v for v in usage_without_fallback if v not in all_defined_vars}

    check("Undefined CSS variables", len(undefined_vars) == 0,
          f"Undefined: {sorted(undefined_vars)}" if undefined_vars else "No undefined CSS variables found")
else:
    check("CSS/HTML files exist for variable check", False, "Missing files")

# ------------------------------------------------------------------
# 5. API endpoint consistency
# ------------------------------------------------------------------
KNOWN_ENDPOINTS = [
    "/readings/latest",
    "/readings/",
    "/readings",
    "/devices/",
    "/health",
    "/chat/water",
    "/agents/camera/question",
    "/camera/analyze",
]

if os.path.exists(APP_JS):
    with open(APP_JS, "r", encoding="utf-8") as f:
        js_content = f.read()

    for endpoint in KNOWN_ENDPOINTS:
        count = len(re.findall(re.escape(endpoint), js_content))
        check(f"API endpoint '{endpoint}' present", count > 0,
              f"Found {count} time(s)")
else:
    check("app.js exists for endpoint check", False, f"{APP_JS} not found")

# ------------------------------------------------------------------
# 6. JavaScript syntax check
# ------------------------------------------------------------------
if os.path.exists(APP_JS):
    try:
        result = subprocess.run(
            ["node", "--check", APP_JS],
            capture_output=True,
            text=True,
            timeout=15
        )
        syntax_ok = result.returncode == 0
        detail = result.stderr.strip() if not syntax_ok else ""
        check("JavaScript syntax", syntax_ok, detail)
    except FileNotFoundError:
        check("JavaScript syntax (node not found)", False,
              "node command not available")
    except subprocess.TimeoutExpired:
        check("JavaScript syntax (timeout)", False, "check timed out")
else:
    check("app.js exists for syntax check", False, f"{APP_JS} not found")

# ------------------------------------------------------------------
# 7. Git whitespace check
# ------------------------------------------------------------------
try:
    result = subprocess.run(
        ["git", "--no-pager", "diff", "--check"],
        capture_output=True,
        text=True,
        timeout=15,
        cwd=os.path.dirname(os.path.abspath(__file__))
    )
    ws_ok = result.returncode == 0
    detail = result.stdout.strip() if not ws_ok else ""
    check("Git whitespace check", ws_ok, detail)
except FileNotFoundError:
    check("Git whitespace check (git not found)", True, "git not available, skipped")
except subprocess.TimeoutExpired:
    check("Git whitespace check (timeout)", False, "check timed out")
# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
print()
print("=" * 70)
print("  AQUA AI DASHBOARD VALIDATION REPORT")
print("=" * 70)
print()
print(f"  Total checks:  {passed + failed}")
print(f"  Passed:        {passed}")
print(f"  Failed:        {failed}")
print()
print("-" * 70)
print("  DETAILED RESULTS")
print("-" * 70)
print()

for status, name, detail in check_results:
    icon = "+" if status == "PASS" else "!"
    print(f"  [{icon}] {name}")
    if detail:
        print(f"       {detail}")
    print()

print("=" * 70)

sys.exit(0 if failed == 0 else 1)