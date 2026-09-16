#!/usr/bin/env python3
import sys, re
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:5500"
results = {"pass": 0, "fail": 0, "tests": []}

def test(name, condition, detail=""):
    if condition:
        results["pass"] += 1
        results["tests"].append(("PASS", name, detail))
    else:
        results["fail"] += 1
        results["tests"].append(("FAIL", name, detail))

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        logs = []
        errs = []
        page.on("console", lambda m: logs.append({"lvl": m.type, "txt": m.text}))
        page.on("pageerror", lambda e: errs.append(str(e)))

        print("--- Browser Console ---")
        page.goto(BASE_URL, wait_until="networkidle")
        test("Page no console errors", len([m for m in logs if m["lvl"] == "error"]) == 0)
        test("Page no uncaught errors", len(errs) == 0)
        test("Title correct", page.title() == "Aqua AI | Smart Water Quality Monitoring")

        print("--- SPA Navigation ---")
        for pid in ["dashboard","temperature","ph","turbidity","tds",
                     "camera","trends","device","settings","reports","profile"]:
            btn = page.locator('button.nav-item[data-page="' + pid + '"]')
            test("Nav " + pid + " button", btn.count() > 0)
            if btn.count() > 0:
                btn.click()
                page.wait_for_timeout(300)
                test("Nav " + pid + " section", page.locator('section[data-page-section="' + pid + '"]').is_visible())
                cls = btn.get_attribute("class") or ""
                test("Nav " + pid + " active", "active" in cls)
                test("Nav " + pid + " no errors", len([m for m in logs if m["lvl"] == "error"]) == 0)

        for h in ["dashboard","trends","reports","profile","camera"]:
            page.goto(BASE_URL + "/#" + h, wait_until="domcontentloaded")
            page.wait_for_timeout(300)
            test("Hash #" + h, page.locator('section[data-page-section="' + h + '"]').is_visible())

        print("--- Dashboard ---")
        page.goto(BASE_URL + "/#dashboard", wait_until="networkidle")
        page.wait_for_timeout(500)
        for eid in ["temperatureValue","phValue","turbidityValue","tdsValue",
                     "qualityScore","qualityScoreCircle","dashboardRefreshButton",
                     "readingsTableBody","dashboardTimeFilter","historyChart"]:
            test("Dashboard #" + eid, page.locator("#" + eid).count() > 0)
        btn = page.locator("#dashboardRefreshButton")
        if btn.count() > 0:
            btn.click()
            page.wait_for_timeout(500)

        print("--- Reports & Profile ---")
        page.goto(BASE_URL + "/#reports", wait_until="domcontentloaded")
        page.wait_for_timeout(500)
        for eid in ["reportsLatestTime","reportsLatestDevice","reportsTotalReadings",
                     "reportsQualityStatus","reportsQualityDescription",
                     "reportsDeviceStatus","reportsDeviceName",
                     "reportsTemperature","reportsTemperatureStatus",
                     "reportsPh","reportsPhStatus","reportsTurbidity","reportsTurbidityStatus",
                     "reportsTds","reportsTdsStatus","reportsEmptyState","reportsReadingsBody"]:
            test("Reports #" + eid, page.locator("#" + eid).count() > 0)
        page.goto(BASE_URL + "/#profile", wait_until="domcontentloaded")
        page.wait_for_timeout(500)
        for eid in ["profileDeviceName","profileDeviceStatus","profileRefreshStatus",
                     "profileDashboardRange","profileBackendUrl","profileBackendStatus"]:
            test("Profile #" + eid, page.locator("#" + eid).count() > 0)

        print("--- Chat ---")
        page.goto(BASE_URL + "/#dashboard", wait_until="domcontentloaded")
        page.wait_for_timeout(500)
        for eid in ["sensorChatForm","sensorChatInput","sensorChatMessages",
                     "cameraChatForm","cameraChatInput","cameraChatMessages",
                     "sensorChatContext","cameraChatContext"]:
            test("Chat #" + eid, page.locator("#" + eid).count() > 0)
        inp = page.locator("#sensorChatInput")
        if inp.count() > 0:
            inp.fill("hello")
            page.locator("#sensorChatForm").dispatch_event("submit")
            page.wait_for_timeout(500)

        print("--- Camera ---")
        page.goto(BASE_URL + "/#camera", wait_until="domcontentloaded")
        page.wait_for_timeout(500)
        for eid in ["cameraFileInput","cameraPreview","analyzeButton"]:
            test("Camera #" + eid, page.locator("#" + eid).count() > 0)

        print("--- Refresh ---")
        page.goto(BASE_URL + "/#dashboard", wait_until="domcontentloaded")
        page.wait_for_timeout(300)
        btn = page.locator("#dashboardRefreshButton")
        if btn.count() > 0:
            for _ in range(3):
                btn.click()
                page.wait_for_timeout(200)

        print("--- Responsive ---")
        for w, h, label in [(320,568,"320px"),(375,667,"375px"),(768,1024,"768px"),
                            (1024,768,"1024px"),(1440,900,"1440px")]:
            page.set_viewport_size({"width": w, "height": h})
            page.goto(BASE_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(500)
            ov = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            test("Resp " + label + " no overflow", ov == 0, "overflow=" + str(ov))
            test("Resp " + label + " main visible", page.locator("main").is_visible())

        browser.close()

    print()
    print("=" * 60)
    print("  TOTAL: " + str(results["pass"]+results["fail"]) + ", PASS: " + str(results["pass"]) + ", FAIL: " + str(results["fail"]))
    print("=" * 60)
    for s, n, d in results["tests"]:
        status = "OK" if s == "PASS" else "FAIL"
        detail = " - " + d if d else ""
        print("  [" + status + "] " + n + detail)
    print("=" * 60)
    return results["fail"] == 0

if __name__ == "__main__":
    sys.exit(0 if run() else 1)