const fs = require('fs');

let appJs = fs.readFileSync('frontend/app.js', 'utf8');

const mocks = `
window = { location: { hash: '' }, addEventListener: () => {} };
document = {
    getElementById: () => ({ classList: { add:()=>{}, remove:()=>{}, toggle:()=>{} }, innerHTML: '', appendChild: ()=>{}, textContent: '', style: {} }),
    querySelector: () => ({ classList: { add:()=>{}, remove:()=>{}, toggle:()=>{} }, innerHTML: '', appendChild: ()=>{}, textContent: '', style: {} }),
    querySelectorAll: () => [],
    addEventListener: () => {}
};
Chart = function() { return { update: ()=>{}, destroy: ()=>{} } };
`;

try {
    eval(mocks + appJs);
} catch (e) {
    console.log("Eval error:", e.message);
}

const tests = {
    "EXCELLENT": { temperature: 26, ph: 7.2, turbidity: 1.8, tds: 320 },
    "GOOD": { temperature: 30, ph: 6.8, turbidity: 2.5, tds: 700 },
    "MEDIUM": { temperature: 34, ph: 6.2, turbidity: 5, tds: 1100 },
    "POOR": { temperature: 42, ph: 4.2, turbidity: 15, tds: 2500 },
    "EXTREME": { temperature: 0, ph: 0, turbidity: 0, tds: 0 },
    "EXTREME2": { temperature: 100, ph: 14, turbidity: 1000, tds: 10000 }
};

for (const [name, reading] of Object.entries(tests)) {
    const q = computeReadingQuality(reading);
    console.log(`\n--- ${name} ---`);
    console.log(`Quality Score: ${q.score}, Status: ${q.status}, Title: ${q.title}`);
}

console.log("\n--- Monotonicity Test (TDS) ---");
let lastScore = 1000;
for (let tds=300; tds<=2500; tds+=100) {
    let r = { temperature: 26, ph: 7.2, turbidity: 1.8, tds: tds };
    let sc = computeReadingQuality(r).score;
    let monotonic = sc <= lastScore;
    console.log(`TDS: ${tds}, Score: ${sc} -> ${monotonic ? 'OK' : 'FAIL'}`);
    lastScore = sc;
}

console.log("\n--- Turbidity Continuity Test ---");
for (let t of [0.5, 1, 1.1, 4.9, 5, 5.1, 10, 19.9, 20, 20.1]) {
    console.log(`Turbidity ${t} -> Score: ${scoreClarity(t)}`);
}

console.log("\n--- App Score Safeguard Test ---");
const appRes = calculateApplicationScore({ temperature: 26, ph: 7.2, turbidity: 1.8, tds: 5000 }, GENERAL_PROFILES[0]);
console.log(`General Utility with fatal TDS: Suitability = ${appRes.suitability}`);

console.log("Done.");
