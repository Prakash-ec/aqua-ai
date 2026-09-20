/* UI verification for the redesigned Analysis page (jsdom + real backend). */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8');
const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:5500/#analysis',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
});
const { window } = dom;
const requestLog = [];
const jsErrors = [];
window.addEventListener('error', (e) => jsErrors.push('window error: ' + e.message));
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
    requestLog.push(target.includes('/readings/latest') ? 'readings/latest' : target);
    return fetch(target, options);
};
console.error = (...v) => jsErrors.push('console.error: ' + v.map(String).join(' '));
;

function text(sel) {
    const el = window.document.querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '<missing ' + sel + '>';
}
function html_(id) {
    const el = window.document.getElementById(id);
    return el ? el.innerHTML : '<missing #' + id + '>';
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function check(name, actual, expected) {
    const pass = expected instanceof RegExp
        ? expected.test(actual)
        : String(actual) === String(expected);
    console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + ' => ' + JSON.stringify(String(actual).slice(0, 120)) + (pass ? '' : '  (expected ' + expected + ')'));

}

(async () => {
    const script = window.document.createElement("script");
    script.textContent = appJs;
    window.document.body.appendChild(script);
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    await wait(3500);

    console.log("=== HEADER ===");
    check("page title", text("#page-analysis h2"), "Analysis");
    check("subtitle", text("#analysisSubtitle"), "Understand your water quality and discover suitable applications.");
    check("latest reading", text("#analysisReadingTime"), /19 Sept 2026/);
    check("refresh button", Boolean(window.document.querySelector('.an-refresh[data-action="refresh"]')), true);

    console.log("=== SUMMARY ===");
    check("ring score 96", text(".an-ring-text strong"), "96");
    check("score label", text(".an-summary-label strong"), "Very Good");
    check("summary pH", text(".an-summary-param:nth-child(1) strong"), "7.20");
    check("summary turbidity", text(".an-summary-param:nth-child(2) strong"), "1.80");
    check("summary tds", text(".an-summary-param:nth-child(3) strong"), "320");
    check("summary temp", text(".an-summary-param:nth-child(4) strong"), "26.0");
    check("ring dashoffset set", html_("analysisSummary").includes("stroke-dashoffset"), true);

    console.log("=== CURRENT PARAMETERS ===");
    const cards = window.document.querySelectorAll("#analysisCurrentParams .an-param-card");
    check("param card count", cards.length, 4);
    check("param pH", cards[0]?.textContent.replace(/\s+/g, " ").trim(), /pH\s*7\.20\s*Good/);
    check("param turbidity", cards[1]?.textContent.replace(/\s+/g, " ").trim(), /Turbidity\s*1\.80\s*NTU\s*Moderate/);
    check("param tds", cards[2]?.textContent.replace(/\s+/g, " ").trim(), /TDS\s*320\s*mg\/L\s*Good/);
    check("param temperature", cards[3]?.textContent.replace(/\s+/g, " ").trim(), /Temperature\s*26\.0\s*°C\s*Good/);

    console.log("=== DERIVED INDICATORS ===");
    const derivedText = text("#analysisDerivedParams");
    check("EC 0.49 dS/m", /Estimated EC\s*0\.49 dS\/m/.test(derivedText), true);
    check("H+ 6.31e-8", /H\+ Concentration\s*6\.31 × 10⁻⁸/.test(derivedText), true);
    check("Salinity Low", /Salinity\s*Low/.test(derivedText), true);
    check("Clarity 80%", /Clarity\s*80%/.test(derivedText), true);
    check("pH Index 100%", /pH Index\s*100%/.test(derivedText), true);
    check("Temp Index 100%", /Temperature Index\s*100%/.test(derivedText), true);
    check("derived item count", window.document.querySelectorAll("#analysisDerivedParams .an-derived-item").length, 6);

    console.log("=== SCORE BREAKDOWN ===");
    const bars = Array.from(window.document.querySelectorAll("#analysisScoreSection .an-score-row"))
        .map((row) => row.textContent.replace(/\s+/g, " ").trim());
    check("breakdown rows", bars.length, 4);
    check("pH 100", bars[0], /pH\s*100%/);
    check("Salinity 100", bars[1], /Salinity\s*100%/);
    check("Clarity 80", bars[2], /Clarity\s*80%/);
    check("Temperature 100", bars[3], /Temperature\s*100%/);
    check("limiting note", text(".an-breakdown-note"), "Clarity is currently the main factor limiting the overall analytical score.");
    check("bar fill width 80", html_("analysisScoreSection").includes("width:80%"), true);

    console.log("=== AGRICULTURE ===");
    const crops = Array.from(window.document.querySelectorAll("#analysisCropSection .an-crop-row"));
    check("top 5 crops only", crops.length, 5);
    check("crop 01 Rice 98", crops[0]?.textContent.replace(/\s+/g, " ").trim(), /01\s*Rice\s*Highly Suitable\s*98%/);
    check("crop ranks", crops.map((c) => c.querySelector(".an-rank")?.textContent).join(","), "01,02,03,04,05");
    check("crop contributions", crops[0]?.querySelectorAll(".an-contrib").length, 4);
    check("crop note", text("#page-analysis .an-panel-note"), /Prediction only — actual crop suitability depends on soil, climate and other factors\./);

    console.log("=== OTHER TABS ===");
    check("industrial rows", window.document.querySelectorAll("#analysisIndustrialSection .an-app-row").length, 5);
    check("domestic rows", window.document.querySelectorAll("#analysisDomesticSection .an-app-row").length, 7);
    check("general rows", window.document.querySelectorAll("#analysisGeneralSection .an-app-row").length, 5);
    const drinkingText = text("#analysisDrinkingSection");
    check("drinking screening label", /Meets configured screening criteria|Generally meets|Mixed screening result/.test(drinkingText), true);
    check("drinking param status wording", /Meets configured screening range/.test(drinkingText), true);
    check("drinking safety wording absent", /safe to drink|potable|certified/i.test(drinkingText.replace(/non-potable/gi, "")), false);
    check("drinking note present", /not a laboratory drinking-water certification/.test(drinkingText), true);
    check("limitations details", Boolean(window.document.querySelector(".an-limitations summary")), true);
    check("limitations text", text(".an-limitations-body"), /DO, BOD, COD, hardness, alkalinity, nitrate, phosphate, heavy metals, chlorine or microbial quality/);

    console.log("=== TABS / REQUESTS ===");
    requestLog.length = 0;
    ["industrial", "domestic", "drinking", "general", "agriculture"].forEach((name) => {
        window.document.querySelector(`.an-tab[data-an-tab="${name}"]`)
            .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await wait(250);
    check("tab click requests", requestLog.length, 0);
    check("agriculture panel active", window.document.querySelector('.an-tab-panel[data-an-panel="agriculture"]').classList.contains("active"), true);
    check("aria-selected sync", window.document.querySelector('.an-tab[data-an-tab="agriculture"]').getAttribute("aria-selected"), "true");

    console.log("=== ERRORS ===");
    console.log(jsErrors.length ? jsErrors.join("\n") : "none");
    window.close();
    process.exit(0);
})()