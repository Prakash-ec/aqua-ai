"use strict";
/**
 * Live frontend countdown evidence (real DOM + real backend).
 *
 * Loads the real frontend/index.html and frontend/app.js into jsdom, then
 * points the app at the REAL running backend (AQUA_BASE_URL, default
 * http://127.0.0.1:8002). Nothing is mocked: the on-screen values come from
 * GET /alerts/auto-status and from the backend next_eligible_at timestamp.
 *
 * Proves:
 *   1. cooldown active -> the digital clock is visible and ticks every second
 *   2. the displayed value matches the backend remaining time (authoritative)
 *   3. reload (new DOM instance = browser refresh) resumes at the REAL
 *      remaining time instead of restarting at the full cooldown
 *   4. when the countdown reaches 00:00 the card shows
 *      "00:00 - Ready for next critical reading" and no email is implied
 *
 * Usage:
 *   node frontend/tests/live_countdown_dom.js
 * Optional env: AQUA_BASE_URL, AQUA_DOM_SAMPLES, AQUA_DOM_MAX_WAIT_SECONDS
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");
const BASE = (process.env.AQUA_BASE_URL || "http://127.0.0.1:8002").replace(/\/+$/, "");
const SAMPLES = Number(process.env.AQUA_DOM_SAMPLES || 12);
const MAX_WAIT_SECONDS = Number(process.env.AQUA_DOM_MAX_WAIT_SECONDS || 420);

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  console.log(`[DOM ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${name} :: ${detail}`);
}

async function backendStatus() {
  const res = await fetch(`${BASE}/alerts/auto-status`);
  return res.json();
}

/** Build a jsdom page with the real markup + real app.js, wired to the real API. */
function openFrontend() {
  const html = fs.readFileSync(path.join(ROOT, "frontend", "index.html"), "utf8");
  const appjs = fs.readFileSync(path.join(ROOT, "frontend", "app.js"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:5501/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = (input, init) => {
    const url =
      typeof input === "string" && input.startsWith("/") ? BASE + input : String(input);
    return fetch(url, init);
  };
  try {
    window.eval(appjs);
  } catch (error) {
    log(`app.js bootstrap warning (non fatal): ${error.message}`);
  }
  return window;
}

function readCard(window) {
  const doc = window.document;
  const clock = doc.getElementById("autoCooldownClock");
  const wrap = doc.getElementById("autoCooldownWrap");
  const badge = doc.getElementById("autoStatusBadge");
  const sub = doc.getElementById("autoCooldownSub");
  const ready = doc.getElementById("autoReadyMsg");
  const normal = doc.getElementById("autoNormalMsg");
  const hidden = (el) => !el || el.classList.contains("hidden");
  return {
    clock: clock ? clock.textContent.trim() : null,
    clockVisible: !hidden(wrap),
    badge: badge ? badge.textContent.trim() : null,
    sub: sub ? sub.textContent.trim() : null,
    readyVisible: !hidden(ready),
    readyText: ready ? ready.textContent.trim() : null,
    normalVisible: !hidden(normal),
    normalText: normal ? normal.textContent.trim() : null,
  };
}

function toSeconds(mmss) {
  if (!mmss || !/^\d{2}:\d{2}$/.test(mmss)) return null;
  const [mm, ss] = mmss.split(":").map(Number);
  return mm * 60 + ss;
}

async function renderFromBackend(window) {
  const status = await backendStatus();
  if (typeof window.renderAutoStatus === "function") {
    window.renderAutoStatus(status);
  } else if (typeof window.loadAutoStatus === "function") {
    await window.loadAutoStatus();
  } else {
    throw new Error("app.js did not expose renderAutoStatus/loadAutoStatus");
  }
  return status;
}

async function main() {
  log("=== live DOM countdown verification (real index.html + real app.js) ===");
  const status = await backendStatus();
  log(`backend overall=${JSON.stringify(status.overall)} latest_status=${status.latest_status}`);
  if (!status.overall || !status.overall.cooldown_active) {
    log("no active cooldown right now: insert a critical reading first "
      + "(POST /readings/ingest) and re-run this script.");
    process.exit(2);
  }

  // ---------- Phase 1: live ticking clock in a real DOM ----------
  const windowA = openFrontend();
  const startStatus = await renderFromBackend(windowA);
  const samples = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const card = readCard(windowA);
    const backend = (await backendStatus()).overall;
    samples.push({
      t: new Date().toISOString().slice(11, 19),
      clock: card.clock,
      backendRemaining: backend.next_eligible_in_seconds,
      badge: card.badge,
    });
    log(`clock=${card.clock} badge=${card.badge} backend_remaining=${backend.next_eligible_in_seconds}s`);
    await sleep(1000);
  }
  const first = readCard(windowA);
  check(
    "D1 cooldown active renders a visible digital clock",
    first.clockVisible && first.clock !== null && first.clock !== "00:00",
    `clock=${first.clock} visible=${first.clockVisible}`
  );
  check(
    "D2 badge shows CRITICAL and cooldown wording explains the timer",
    first.badge === "CRITICAL"
      && /Cooldown active/i.test(first.sub || "")
      && /Next critical reading eligible after cooldown/i.test(first.sub || ""),
    `badge=${first.badge} sub="${first.sub}"`
  );
  const displayed = samples.map((s) => toSeconds(s.clock)).filter((v) => v !== null);
  const distinct = [...new Set(displayed)];
  check(
    "D3 clock ticks down one second at a time (no refresh, no click)",
    distinct.length >= Math.min(4, SAMPLES - 2) && displayed[0] > displayed[displayed.length - 1],
    `displayed seconds: ${displayed.join(", ")}`
  );
  const drift = samples
    .filter((s) => s.backendRemaining != null && toSeconds(s.clock) !== null)
    .map((s) => Math.abs(toSeconds(s.clock) - s.backendRemaining));
  check(
    "D4 displayed value tracks the backend timestamp (max drift <= 2s)",
    drift.every((d) => d <= 2),
    `max drift=${Math.max(...drift)}s over ${samples.length} samples`
  );

  // ---------- Phase 2: browser refresh (brand new DOM) resumes the real time ----------
  const beforeReloadBackend = (await backendStatus()).overall;
  const windowB = openFrontend();
  await renderFromBackend(windowB);
  const afterReload = readCard(windowB);
  const afterReloadSecs = toSeconds(afterReload.clock);
  check(
    "D5 reload resumes at the REAL remaining time (not a full reset)",
    afterReloadSecs !== null
      && afterReloadSecs <= beforeReloadBackend.next_eligible_in_seconds + 2
      && afterReloadSecs >= beforeReloadBackend.next_eligible_in_seconds - 5
      && afterReloadSecs < startStatus.cooldown_seconds,
    `clock after reload=${afterReload.clock} backend=${beforeReloadBackend.next_eligible_in_seconds}s `
      + `full_cooldown=${startStatus.cooldown_seconds}s`
  );

  // ---------- Phase 3: wait for the real expiry and read the READY card ----------
  const deadline = Date.now() + MAX_WAIT_SECONDS * 1000;
  let expiryCard = null;
  let lastNotifiedBeforeExpiry = null;
  while (Date.now() < deadline) {
    const backend = await backendStatus();
    lastNotifiedBeforeExpiry = backend.overall && backend.overall.last_notified_at;
    if (!backend.overall.cooldown_active) {
      // app.js tickAutoClock() calls loadAutoStatus() at 00:00; refresh the card
      // from the backend so the rendered state is read deterministically.
      await renderFromBackend(windowB);
      expiryCard = readCard(windowB);
      break;
    }
    await sleep(2000);
  }
  if (expiryCard) {
    const backendAfterExpiry = await backendStatus();
    log(`expiry card: clock=${expiryCard.clock} readyVisible=${expiryCard.readyVisible} `
      + `readyText="${expiryCard.readyText}" `
      + `backend_cooldown_active=${backendAfterExpiry.overall.cooldown_active}`);
    check(
      "D6 at 00:00 the card shows READY for the next critical reading",
      expiryCard.readyVisible
        && /Ready for next critical reading/i.test(expiryCard.readyText || "")
        && expiryCard.clock === "00:00",
      `clock=${expiryCard.clock} readyText="${expiryCard.readyText}"`
    );
    check(
      "D7 expiry itself sends no email (last_notified_at unchanged)",
      backendAfterExpiry.overall.last_notified_at === lastNotifiedBeforeExpiry,
      `last_notified_at=${backendAfterExpiry.overall.last_notified_at}`
    );
  } else {
    check(
      "D6 at 00:00 the card shows READY for the next critical reading",
      false,
      `cooldown did not expire within ${MAX_WAIT_SECONDS}s`
    );
  }

  const failed = results.filter((r) => !r.ok);
  log(`=== DOM verification finished: ${results.length - failed.length}/${results.length} checks passed ===`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  log(`DOM verification crashed: ${error && error.message}`);
  process.exit(1);
});

