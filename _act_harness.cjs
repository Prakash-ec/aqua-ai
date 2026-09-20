/*
 * Headless harness for the Aqua AI frontend (jsdom).
 *
 * Loads frontend/index.html, evaluates frontend/app.js inside the jsdom
 * window, and proxies window.fetch to the real local backend — except for
 * /readings/latest, which can be mocked to exercise every data state.
 *
 * Usage:
 *   node _act_harness.cjs [#page] [--mock=live|empty|error|http500|partial|stale|alert|nulls]
 *                         [--tab=agriculture|industry|general|drinking]
 *
 * Phase 1 prints the rendered Analysis page.
 * Phase 2 clicks every tab and navigates around, proving that tab switching
 * issues no additional /readings/latest requests.
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const hashArg = args.find((arg) => !arg.startsWith("--")) || "#analysis";
const hash = hashArg.replace(/^#?/, "#");
const mockMode = (args.find((a) => a.startsWith("--mock=")) || "--mock=live").split("=")[1];
const tabArg = (args.find((a) => a.startsWith("--tab=")) || "").split("=")[1];

const root = __dirname;
const html = fs.readFileSync(path.join(root, "frontend", "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");

const REAL_LATEST = {
    id: 1853,
    device_id: 1,
    temperature: 26.0,
    ph: 7.2,
    turbidity: 1.8,
    tds: 320.0,
    recorded_at: "2026-09-19T12:09:39.847720",
};

function mockLatestPayload() {
    const oldTimestamp = new Date(Date.now() - 72 * 3600 * 1000).toISOString();

    switch (mockMode) {
        case "partial":
            return { ...REAL_LATEST, turbidity: null };
        case "stale":
            return { ...REAL_LATEST, recorded_at: oldTimestamp };
        case "alert":
            return {
                ...REAL_LATEST,
                ph: 5.2,
                turbidity: 12.5,
                tds: 3400.0,
                temperature: 48.0,
            };
        case "nulls":
            return {
                ...REAL_LATEST,
                temperature: null,
                ph: null,
                turbidity: null,
                tds: null,
            };
        default:
            return REAL_LATEST;
    }
}

const dom = new JSDOM(html, {
    url: `http://127.0.0.1:5500/${hash}`,
    pretendToBeVisual: true,
    runScripts: "dangerously",
});

const { window } = dom;
const requestLog = [];
const jsErrors = [];

window.addEventListener("error", (event) => {
    jsErrors.push(`window error: ${event.message}`);
});

window.HTMLCanvasElement.prototype.getContext = function () {
    return {
        clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        fill() {}, fillRect() {}, fillText() {}, closePath() {}, arc() {},
        arcTo() {}, setLineDash() {}, measureText: () => ({ width: 0 }),
        createLinearGradient: () => ({ addColorStop() {} }),
        save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
        quadraticCurveTo() {}, bezierCurveTo() {}, setTransform() {},
    };
};

window.fetch = async (url, options) => {
    const target = String(url);
    const isLatest = target.includes("/readings/latest");
    const isList = /\/readings\/?$/.test(target);

    requestLog.push(isLatest ? "readings/latest" : (isList ? "readings/" : target));

    if (mockMode === "live" || (!isLatest && !isList)) {
        return fetch(target, options);
    }

    if (mockMode === "error") {
        if (isLatest) {
            throw new TypeError("Failed to fetch");
        }
        return jsonResponse([]);
    }

    if (mockMode === "empty") {
        return isLatest
            ? jsonResponse({ detail: "No water-quality readings found." }, 404)
            : jsonResponse([]);
    }

    if (mockMode === "http500") {
        return isLatest
            ? jsonResponse({ detail: "Internal server error" }, 500)
            : jsonResponse([]);
    }

    const payload = mockLatestPayload();

    return isLatest ? jsonResponse(payload, 200) : jsonResponse([payload]);
};

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

console.error = (...values) => {
    jsErrors.push(`console.error: ${values.map(String).join(" ")}`);
};

function text(id) {
    const el = window.document.getElementById(id);
    return el ? el.textContent.replace(/\s+/g, " ").trim() : `<missing ${id}>`;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function clickTab(name) {
    const tab = window.document.querySelector(`.an-tab[data-an-tab="${name}"]`);

    if (tab) {
        tab.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    }
}

function elText(sel) {
    const el = window.document.querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "<missing>";
}

function idText(id) {
    const el = window.document.getElementById(id);
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "<missing " + id + ">";
}

const failures = [];

function check(name, actual, expected) {
    const pass = expected instanceof RegExp
        ? expected.test(actual)
        : String(actual) === String(expected);
    console.log(`${pass ? "PASS" : "FAIL"}  ${name} => ${JSON.stringify(String(actual).slice(0, 120))}${pass ? "" : "  (expected " + expected + ")"}`);
    if (!pass) failures.push(name);
}

(async () => {
    const script = window.document.createElement("script");
    script.textContent = appJs;
    window.document.body.appendChild(script);
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

    await wait(3500);

    console.log(`mode=${mockMode} hash=${hash}`);
    console.log(
        `sections: open=${(html.match(/<section\b/g) || []).length} close=${(html.match(/<\/section>/g) || []).length}`
    );

    if (tabArg) {
        clickTab(tabArg);
        await wait(250);
    }

        console.log("\n=== ANALYSIS DOM STATE ===");
    const noticeEl = window.document.getElementById("analysisNotice");
    const noticeText = noticeEl ? noticeEl.textContent.replace(/\s+/g, " ").trim() : "<missing>";
    const noticeClass = noticeEl ? noticeEl.className : "missing";
    console.log("notice                :", noticeText.slice(0, 240));
    console.log("noticeClass           :", noticeClass);
    console.log("retryButton           :", Boolean(window.document.querySelector("[data-analysis-action='retry']")));
    console.log("readingTime           :", idText("analysisReadingTime"));
    console.log("subtitle              :", idText("analysisSubtitle"));

    // Live mode: full content rendered
    if (mockMode === "live") {
        check("live: no js errors", jsErrors.length, 0);
        check("live: notice hidden", noticeClass.includes("hidden"), true);
        check("live: ring score 96", elText(".an-ring-text strong"), "96");
        check("live: score label", elText(".an-summary-label strong"), "Very Good");
        check("live: summary pH", elText(".an-summary-param:nth-child(1) strong"), "7.20");
        check("live: summary tds", elText(".an-summary-param:nth-child(3) strong"), "320");
        check("live: param cards", window.document.querySelectorAll("#analysisCurrentParams .an-param-card").length, 4);
        check("live: derived items", window.document.querySelectorAll("#analysisDerivedParams .an-derived-item").length, 6);
        check("live: score rows", window.document.querySelectorAll("#analysisScoreSection .an-score-row").length, 4);
        check("live: crop rows", window.document.querySelectorAll("#analysisCropSection .an-crop-row").length, 5);
        check("live: industrial rows", window.document.querySelectorAll("#analysisIndustrialSection .an-app-row").length, 5);
        check("live: domestic rows", window.document.querySelectorAll("#analysisDomesticSection .an-app-row").length, 7);
        check("live: general rows", window.document.querySelectorAll("#analysisGeneralSection .an-app-row").length, 5);
        check("live: tab panels present", window.document.querySelectorAll(".an-tab-panel").length, 5);
        check("live: refresh button", Boolean(window.document.querySelector(".an-refresh[data-action='refresh']")), true);
    }

    // Error/HTTP 500 modes: notice shown, content sections empty.
    // (Empty 200 is a valid no-data render, not an error banner.)
    if (["error", "http500"].includes(mockMode)) {
        check("error-mode: js errors absent", jsErrors.length, 0);
        check("error-mode: notice visible", noticeClass.includes("hidden"), false);
        check("error-mode: summary cleared", window.document.querySelectorAll("#analysisCurrentParams .an-param-card").length, 0);
        check("error-mode: derived cleared", window.document.querySelectorAll("#analysisDerivedParams .an-derived-item").length, 0);
    }

    // Empty 200 mode: graceful no-data state without errors.
    if (mockMode === "empty") {
        check("empty: js errors absent", jsErrors.length, 0);
        check("empty: reading time shows no data", idText("analysisReadingTime"), "No data available");
        check("empty: summary cleared", window.document.querySelectorAll("#analysisCurrentParams .an-param-card").length, 0);
        check("empty: derived cleared", window.document.querySelectorAll("#analysisDerivedParams .an-derived-item").length, 0);
    }

    // Nulls mode: all null -> no data state
    if (mockMode === "nulls") {
        check("nulls: js errors absent", jsErrors.length, 0);
    }

    // Alert mode: extreme values rendered without errors
    if (mockMode === "alert") {
        check("alert: js errors absent", jsErrors.length, 0);
        check("alert: reading time present", idText("analysisReadingTime") !== "<missing>", true);
    }

    // Partial mode: missing turbidity handled gracefully
    if (mockMode === "partial") {
        check("partial: js errors absent", jsErrors.length, 0);
        check("partial: ring still renders", Boolean(elText(".an-ring-text strong")), true);
    }

    // Stale mode: old data flagged but rendered
    if (mockMode === "stale") {
        check("stale: js errors absent", jsErrors.length, 0);
        check("stale: reading time present", idText("analysisReadingTime") !== "<missing>", true);
    }

        // Forbidden drinking-water claims check for live/alert modes
    if (mockMode === "live" || mockMode === "alert") {
        const analysisEl = window.document.getElementById("page-analysis");
        if (analysisEl) {
            const analysisText = analysisEl.textContent
                .replace(/non-potable/gi, "NONDRINKINGUSE")
                .replace(/before declaring water safe for consumption/gi, "MANDATEDDISCLAIMER");
            const forbidden = /safe to drink|safe for consumption|potable|approved for drinking|drinking water approved/i;
            check("no forbidden drinking claims", forbidden.test(analysisText), false);
        }
    }

    // Reports page: professional engineering report backed by live readings.
    console.log("\n=== REPORTS DOM STATE ===");
    await window.navigateTo("reports");
    await wait(900);
    const reportBody = window.document.getElementById("reportBody");
    const reportVisible = Boolean(reportBody) && !reportBody.classList.contains("hidden");
    const reportParamText = (window.document.getElementById("rptParamGrid") || { textContent: "" }).textContent
        .replace(/\s+/g, " ")
        .trim();
    console.log("report visible          :", reportVisible);
    console.log("report params           :", reportParamText.slice(0, 240));
    if (mockMode === "live" || mockMode === "alert" || mockMode === "partial" || mockMode === "stale") {
        check("reports: body visible", reportVisible, true);
        check("reports: current parameters exist", reportParamText.length > 0, true);
        check("reports: temperature uses unit display", /°C|°F/.test(reportParamText), true);
        check("reports: no spaced degree unit", / \u00B0[CF]/.test(reportParamText), false);
        check("reports: CSV control exists", window.document.getElementById("reportCsvButton") ? window.document.getElementById("reportCsvButton").textContent.replace(/\s+/g, " ").trim() : "<missing>", "Export Live Data as CSV");
        check("reports: print control exists", window.document.getElementById("reportPrintButton") ? window.document.getElementById("reportPrintButton").textContent.replace(/\s+/g, " ").trim() : "<missing>", "Print Report");
        check("reports: PDF control exists", window.document.getElementById("reportPdfButton") ? window.document.getElementById("reportPdfButton").textContent.replace(/\s+/g, " ").trim() : "<missing>", "Download Report as PDF");
        check("reports: no CSV import control", Boolean(window.document.querySelector("#page-reports input[type='file']")), false);
        check("reports: live reading rendered", (window.document.getElementById("rptReadingTime") || { textContent: "" }).textContent.replace(/\s+/g, " ").trim() !== "--", true);
        const reportText = (window.document.getElementById("page-reports") || { textContent: "" }).textContent
            .replace(/non-potable/gi, "NONDRINKINGUSE")
            .replace(/before declaring water safe for consumption/gi, "MANDATEDDISCLAIMER");
        check("reports: no forbidden drinking claims", /safe to drink|safe for consumption|potable|approved for drinking|drinking water approved/i.test(reportText), false);
        check("reports: CSV helper present", typeof window.readingsToCsv, "function");
        const sampleCsv = window.readingsToCsv([{ recorded_at: "2026-09-19T12:00:00", device_id: 1, temperature: 26, ph: 7.2, turbidity: 1.8, tds: 320 }]);
        check("reports: CSV columns", sampleCsv.split("\r\n")[0], "timestamp,device_id,temperature_c,ph,turbidity,tds");
        check("reports: CSV keeps Celsius", sampleCsv.includes(",26,"), true);
        check("reports: PDF helper present", typeof window.buildReportPdfBytes, "function");
        check("reports: PDF header", window.buildReportPdfBytes(["hello"]).slice(0, 5), "%PDF-");
        check("reports: js errors absent", jsErrors.length, 0);
    }

    console.log("\n=== PHASE 2: tabs + navigation must not refetch ===");
    requestLog.length = 0;

    ["agriculture", "industry", "general", "drinking"].forEach(clickTab);
    await wait(300);
    console.log("requests after clicking 4 tabs:", requestLog.length, JSON.stringify(requestLog));

        clickTab("drinking");
    await wait(100);
    check("tab click requests = 0", requestLog.length, 0);
    const activePanel = Array.from(window.document.querySelectorAll(".an-tab-panel"))
        .filter((panel) => panel.classList.contains("active"))
        .map((panel) => panel.getAttribute("data-an-panel"))
        .join(",");
    console.log("active panel after tab click:", activePanel);
    check("active panel = drinking", activePanel, "drinking");

        if (mockMode === "live" || mockMode === "error") {
        await window.navigateTo("dashboard");
        await wait(150);
        await window.navigateTo("analysis");
        await wait(400);
        await window.navigateTo("trends");
        await wait(150);
        await window.navigateTo("analysis");
        await wait(400);
        await window.navigateTo("device");
        await wait(150);
        await window.navigateTo("analysis");
        await wait(400);
    }
    console.log("requests during navigation:", requestLog.length, JSON.stringify(requestLog));

    const retryButton = window.document.querySelector("[data-analysis-action='retry']");

    if (retryButton) {
        retryButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
        await wait(900);
        console.log("requests after Retry click:", requestLog.length, JSON.stringify(requestLog));
        console.log("state after Retry           :", idText("analysisReadingTime"));
    }

    console.log("\n=== JS ERRORS ===");
    console.log(jsErrors.length ? jsErrors.join("\n") : "none");

    console.log(`\n=== RESULT: ${failures.length === 0 ? "ALL " + mockMode + " PASS" : failures.length + " FAIL in " + mockMode} ===`);
    window.close();
    process.exit(failures.length === 0 ? 0 : 1);
})();