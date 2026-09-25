/*
 * Live check of the FRONTEND clock formula against the real backend.
 *
 * Uses the exact same arithmetic the UI uses in frontend/app.js
 * (remaining = next_eligible_at - Date.now(), refreshed every second, and
 * resynced from GET /alerts/auto-status), and prints the mm:ss string that
 * the Automatic Alert card renders.
 *
 * Usage: node backend/tests/live_verify_frontend_clock.js [iterations]
 */
const BASE = process.env.AQUA_BASE_URL || "http://127.0.0.1:8002";
const ITERATIONS = Number(process.argv[2] || 20);

function format(seconds) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

async function fetchStatus() {
  const response = await fetch(`${BASE}/alerts/auto-status`);
  if (!response.ok) throw new Error(`auto-status HTTP ${response.status}`);
  return response.json();
}

(async () => {
  let status = await fetchStatus();
  let deadline = status.overall && status.overall.next_eligible_at
    ? Date.parse(status.overall.next_eligible_at)
    : 0;
  console.log(`latest_status=${status.latest_status} cooldown_active=${status.overall.cooldown_active} next_eligible_at=${status.overall.next_eligible_at}`);
  const samples = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    if (i > 0 && i % 8 === 0) {
      // periodic backend resync (frontend does this every 8s)
      status = await fetchStatus();
      deadline = status.overall.next_eligible_at ? Date.parse(status.overall.next_eligible_at) : 0;
    }
    const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const display = format(remaining);
    samples.push(display);
    console.log(`display ${display}  (remaining=${remaining}s)`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const distinct = new Set(samples);
  console.log(`distinct_display_values=${distinct.size}`);
  const decreasing = samples.every((value, index) => index === 0 || samples[index - 1] >= value);
  console.log(decreasing ? "CLOCK_OK: values tick down once per second" : "CLOCK_FAIL: values not monotonic");
  process.exit(distinct.size >= 5 && decreasing ? 0 : 1);
})().catch((error) => {
  console.error(`frontend clock demo failed: ${error.message}`);
  process.exit(2);
});
