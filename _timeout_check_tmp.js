const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = "C:\\VAC versions\\aqua-ai ver2";
const html = fs.readFileSync(path.join(root, "frontend", "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");

const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
window.console = console;

// Hanging backend: fetch never settles.
window.fetch = () => new Promise(() => {});

const script = window.document.createElement("script");
script.textContent = appJs;
window.document.body.appendChild(script);

setTimeout(async () => {
    try {
        // 1. Short-timeout request must fail fast with TIMEOUT, not hang.
        const start = Date.now();
        let err = null;
        try {
            await window.apiRequest("/health", { timeoutMs: 300 });
        } catch (e) { err = e; }
        const elapsed = Date.now() - start;
        console.log("TIMEOUT-ERR:", err && err.code, "| status:", err && err.status, "| ms:", elapsed);
        const t1 = err && err.code === "TIMEOUT" && elapsed < 5000;
        console.log(t1 ? "PASS: request times out fast" : "FAIL: no fast timeout");

        // 2. Silent refresh against a hanging backend must release the guard
        // (offline path) instead of freezing all future updates.
        await window.refreshDashboard({ silent: true });
        const stuck = !!window.eval("dashboardRefreshing");
        console.log("GUARD-STUCK:", stuck);
        console.log(!stuck ? "PASS: refresh guard released" : "FAIL: guard stuck");

        // 3. Default-timeout constant present.
        console.log("DEFAULTS:", window.eval("API_DEFAULT_TIMEOUT_MS"), window.eval("API_REFRESH_TIMEOUT_MS"));

        console.log(t1 && !stuck ? "ALL CHECKS PASSED" : "CHECKS FAILED");
        process.exit(t1 && !stuck ? 0 : 1);
    } catch (e) {
        console.log("HARNESS ERROR:", (e && e.stack) || e);
        process.exit(2);
    }
}, 1500);
