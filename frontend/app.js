
"use strict";

/*
    Aqua Sense Frontend Application
    --------------------------------
    Backend:
    http://127.0.0.1:8001 during local development

    Any deployed (non-local) HTTPS origin automatically targets the
    production backend https://aqua-ai-wz4s.onrender.com.
*/

const DEFAULT_LOCAL_API_URL = "http://127.0.0.1:8002";

/*
 * Production backend matched to known frontend origins so the app works
 * without requiring the user to configure `aqua_api_url` in Settings.
 */
const PRODUCTION_API_URL_BY_ORIGIN = {
    "https://vacprojectv1.netlify.app": "https://aqua-ai-wz4s.onrender.com",
    "https://spectacular-blini-861768.netlify.app": "https://aqua-ai-wz4s.onrender.com",
    "https://vacproject.netlify.app": "https://aqua-ai-wz4s.onrender.com",
    "https://aqua-ai.netlify.app": "https://aqua-ai-wz4s.onrender.com",
    "https://aqua-ai-frontend.netlify.app": "https://aqua-ai-wz4s.onrender.com",
    "https://aqua-sense-vac.netlify.app": "https://aqua-ai-wz4s.onrender.com",
};

const PRODUCTION_API_URL = "https://aqua-ai-wz4s.onrender.com";

/*
 * Treat these as local development origins where the default local
 * backend should be used instead of the hosted production API.
 */
const LOCAL_ORIGINS = new Set([
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:5501",
    "http://127.0.0.1:5501",
    "http://localhost:8001",
    "http://127.0.0.1:8001",
    "http://localhost:8002",
    "http://127.0.0.1:8002",
]);

/*
 * True when the current window origin points at a local development
 * host (localhost, loopback IP, or a localhost port range).
 */
function isLocalOrigin(origin) {
    if (!origin) return false;
    try {
        const u = new URL(origin);
        return (
            u.hostname === "localhost" ||
            u.hostname === "127.0.0.1" ||
            u.hostname === "[::1]" ||
            u.hostname === "0.0.0.0"
        );
    } catch (_) {
        return (
            LOCAL_ORIGINS.has(origin) ||
            origin.includes("localhost") ||
            origin.includes("127.0.0.1")
        );
    }
}

const REFRESH_INTERVAL = 15000;

// All refresh cadences offered in Settings. Fast 2–5s options are for live
// sensor watching; the dashboard paints them silently (no shimmer) so values
// swap instantly instead of flickering every cycle.
const REFRESH_INTERVALS_MS = [2000, 3000, 5000, 15000, 30000, 60000];

// Default network timeout for API calls. The silent auto-refresh passes a
// shorter budget so a slow cycle fails fast and the next tick retries.
const API_DEFAULT_TIMEOUT_MS = 30000;
const API_REFRESH_TIMEOUT_MS = 10000;

/*
 * Determine the API base URL, in priority order:
 *   1. User-configured `aqua_api_url` in localStorage (Settings),
 *      ignoring stale local addresses if running on production HTTPS.
 *   2. Production backend matched to the current frontend origin.
 *   3. Robust production fallback for any non-local deployed origin
 *      (e.g. future Netlify or other hosting domains).
 *   4. Default local backend for local development.
 */
function getApiBaseUrl() {
    const origin = window.location.origin;
    const isLocal = isLocalOrigin(origin);

    const stored = localStorage.getItem("aqua_api_url");
    if (stored && stored.trim() !== "") {
        const trimmed = stored.trim().replace(/\/+$/, "");
        const isStoredLocal =
            trimmed.includes("127.0.0.1") ||
            trimmed.includes("localhost");

        if (isLocal && isStoredLocal && (trimmed.endsWith(":8001") || trimmed.endsWith(":8000"))) {
            return DEFAULT_LOCAL_API_URL;
        }

        // Stale local values in localStorage must not override production HTTPS.
        if (isLocal || !isStoredLocal) {
            return trimmed;
        }
    }

    const productionUrl = PRODUCTION_API_URL_BY_ORIGIN[origin];
    if (productionUrl) {
        return productionUrl;
    }

    if (window.location.protocol === "https:" || !isLocal) {
        return PRODUCTION_API_URL;
    }

    return DEFAULT_LOCAL_API_URL;
}

let API_BASE_URL = getApiBaseUrl();

/*
 * Show a transient toast in #toastContainer.
 *
 * This function was previously missing entirely even though seven call
 * sites referenced it (including every login / register / logout path),
 * so each of those paths threw "showToast is not defined".
 */
function showToast(message, type = "success") {
    const container = $("toastContainer");

    if (!container) {
        return;
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    const icon = document.createElement("i");
    if (type === "error") {
        icon.className = "ri-error-warning-line";
    } else if (type === "warning") {
        icon.className = "ri-alert-line";
    } else {
        icon.className = "ri-checkbox-circle-line";
    }

    const text = document.createElement("span");
    text.textContent = String(message ?? "");

    toast.appendChild(icon);
    toast.appendChild(text);
    container.appendChild(toast);

    const removeToast = () => {
        if (toast.parentNode === container) {
            container.removeChild(toast);
        }
    };

    toast.addEventListener("click", removeToast);
    window.setTimeout(removeToast, 4500);
}

/*
 * Convert any FastAPI error body into one readable sentence.
 *
 * FastAPI returns "detail" as a string for HTTPException, but as a LIST of
 * validation objects for 422 responses. Passing that list into
 * new Error(...) produced "[object Object]" in the UI.
 */
function extractApiErrorMessage(data, status, fallbackPrefix = "Request failed.") {
    const detail = data?.detail ?? data?.message;

    if (typeof detail === "string" && detail.trim()) {
        return detail.trim();
    }

    if (Array.isArray(detail)) {
        const parts = detail
            .map((item) => {
                if (typeof item === "string") {
                    return item.trim();
                }

                if (item && typeof item === "object") {
                    const field = Array.isArray(item.loc)
                        ? item.loc.filter((part) => part !== "body").join(".")
                        : "";
                    const message = item.msg || item.message || "";

                    return [field, message].filter(Boolean).join(": ");
                }

                return "";
            })
            .filter(Boolean);

        if (parts.length > 0) {
            return parts.join(" ");
        }
    }

    if (detail && typeof detail === "object") {
        const message = detail.msg || detail.message;

        if (typeof message === "string" && message.trim()) {
            return message.trim();
        }
    }

    return `${fallbackPrefix} (HTTP ${status})`;
}

let currentPage = "dashboard";
let currentRange = "24H";
let refreshTimer = null;
let latestReading = null;
let latestDevice = null;
let readingsCache = [];
let selectedCameraFile = null;
let latestCameraAnalysis = null;
let cameraStream = null;
let cameraCaptureSource = null; // 'live' | 'upload'
let trendParameter = "quality";
let chatHistory = [];

// Analysis loading state
let analysisLoading = false;
let analysisLoadError = null;

// Dashboard refresh reliability state (dashboard only)
let dashboardRefreshing = false;
let dashboardBackendReachable = true;
let dashboardHasLoadedOnce = false;

// No authentication required - public API for demo/local use
let isAuthenticated = true;
let currentUser = { username: "admin", is_admin: false };

const $ = (id) => document.getElementById(id);

const query = (selector) => document.querySelector(selector);

const queryAll = (selector) => document.querySelectorAll(selector);

function safeText(value, fallback = "--") {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }

    return String(value);
}

function formatNumber(value, digits = 2) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "--";
    }

    return number.toFixed(digits);
}

function formatDate(value) {
    if (!value) {
        return "--";
    }

    const date = parseApiDate(value);

    if (Number.isNaN(date.getTime())) {
        return safeText(value);
    }

    return date.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function setText(id, value, fallback = "--") {
    const element = $(id);

    if (!element) {
        return;
    }

    element.textContent = safeText(value, fallback);
}

function showElement(id) {
    const element = $(id);

    if (element) {
        element.classList.remove("hidden");
    }
}

function hideElement(id) {
    const element = $(id);

    if (element) {
        element.classList.add("hidden");
    }
}

function setConnectionStatus(online, message = "") {
    const dots = queryAll(
        "#connectionDot, .connection-dot, .status-dot"
    );
    const connectionText =
        $("connectionText") ||
        $("connectionStatusText") ||
        query(".connection-status span");

    dots.forEach((dot) => {
        dot.classList.remove("online", "offline", "error");

        if (online) {
            dot.classList.add("online");
        } else {
            dot.classList.add("offline");
        }
    });

    const miniDots = queryAll(".mini-status-dot");

    miniDots.forEach((dot) => {
        dot.classList.remove("online", "offline");

        if (online) {
            dot.classList.add("online");
        } else {
            dot.classList.add("offline");
        }
    });

    if (connectionText) {
        connectionText.textContent =
            message || (online ? "Connected" : "Offline");
    }

    const statusLabel = $("backendStatus");

    if (statusLabel) {
        statusLabel.textContent = online ? "Online" : "Offline";
    }
}

async function apiRequest(path, options = {}) {
    // Every request carries a timeout: without one a hung backend leaves
    // fetch pending forever, and the 2s auto-refresh guard
    // (dashboardRefreshing) would then block all future updates until the
    // user reloads the page. Callers can override per request (the silent
    // dashboard refresh uses a short timeout so a slow cycle fails fast and
    // the next 2s tick retries instead of piling up).
    const { timeoutMs = API_DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
    const url = `${getApiBaseUrl()}${path}`;

    const headers = {
        Accept: "application/json",
        ...(fetchOptions.headers || {})
    };

    if (fetchOptions.body && !(fetchOptions.body instanceof FormData) && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (fetchOptions.signal) {
        // A caller-provided signal also aborts this request.
        fetchOptions.signal.addEventListener(
            "abort",
            () => controller.abort(),
            { once: true }
        );
    }

    let response;

    try {
        response = await fetch(url, {
            ...fetchOptions,
            headers,
            signal: controller.signal
        });
    } catch (error) {
        clearTimeout(timer);
        if (error && error.name === "AbortError" && !fetchOptions.signal?.aborted) {
            const timeoutError = new Error("Request timed out.");
            timeoutError.status = 0;
            timeoutError.code = "TIMEOUT";
            throw timeoutError;
        }
        throw error;
    }

    clearTimeout(timer);

    let data = null;

    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const error = new Error(
            extractApiErrorMessage(data, response.status, "Request failed.")
        );

        // Attach the HTTP status so callers can distinguish "no data yet"
        // (404) from a genuine transport or server failure.
        error.status = response.status;

        throw error;
    }

    return data;
}

/* =========================================================
   AUTHENTICATION (DISABLED - Public API)
   ========================================================= */

// Authentication is disabled - the API is public for demo/local use
// These functions are kept as no-op stubs for compatibility

async function checkAuth() {
    return true;
}

async function fetchCurrentUser() {
    return currentUser;
}

async function performLogin(username, password, rememberMe = false) {
    // No-op - authentication disabled
    return currentUser;
}

async function performLogout() {
    // No-op - authentication disabled
}

function checkDemoAuth() {
    return true;
}

async function performDemoLogin(username, password) {
    // No-op - authentication disabled
}

async function performDemoLogout() {
    // No-op - authentication disabled
}

function openLoginModal(errorMessage) {
    // No-op - authentication disabled
}

function closeLoginModal() {
    // No-op - authentication disabled
}

function updateUserInterface() {
    const usernameEl = $("userProfileName");
    const roleEl = $("userProfileRole");
    const avatarEl = $("userAvatar");
    const logoutItem = $("logoutItem");
    const loginItem = $("loginItem");

    // Hide auth-related UI elements since authentication is disabled
    if (logoutItem) {
        logoutItem.classList.add("hidden");
    }
    if (loginItem) {
        loginItem.classList.add("hidden");
    }

    if (usernameEl) {
        usernameEl.textContent = "Admin";
    }
    if (roleEl) {
        roleEl.textContent = "System User";
    }
    if (avatarEl) {
        avatarEl.textContent = "AD";
    }
}

/* =========================================================
   API REQUEST
   ========================================================= */

function getReadingValue(reading, ...keys) {
    for (const key of keys) {
        if (
            reading &&
            reading[key] !== undefined &&
            reading[key] !== null
        ) {
            return reading[key];
        }
    }

    return null;
}

function normalizeReading(reading) {
    if (!reading) {
        return null;
    }

    return {
        id: reading.id,
        device_id: reading.device_id,
        temperature: getReadingValue(
            reading,
            "temperature",
            "temperature_c"
        ),
        ph: getReadingValue(reading, "ph", "pH"),
        turbidity: getReadingValue(
            reading,
            "turbidity",
            "turbidity_ntu"
        ),
        tds: getReadingValue(reading, "tds", "tds_ppm"),
        recorded_at:
            reading.recorded_at ||
            reading.created_at ||
            reading.timestamp
    };
}

function normalizeReadings(data) {
    let rows = [];

    if (Array.isArray(data)) {
        rows = data;
    } else if (Array.isArray(data?.items)) {
        rows = data.items;
    } else if (Array.isArray(data?.readings)) {
        rows = data.readings;
    } else if (data && typeof data === "object") {
        rows = [data];
    }

    return rows
        .map(normalizeReading)
        .filter(Boolean)
        .sort((a, b) => {
            // Newest first by real UTC timestamps (naive backend strings are
            // UTC by project convention — plain new Date() would misread
            // them as local time and misorder mixed formats).
            const timeA = parseApiTimestamp(a.recorded_at);
            const timeB = parseApiTimestamp(b.recorded_at);

            if (Number.isNaN(timeA) && Number.isNaN(timeB)) {
                return 0;
            }
            if (Number.isNaN(timeA)) {
                return 1;
            }
            if (Number.isNaN(timeB)) {
                return -1;
            }

            return timeB - timeA;
        });
}

let lastDevicesSignature = "";

async function loadDevices(options) {
    const silent = !!(options && options.silent);
    const timeoutMs = options && options.timeoutMs;
    try {
        const data = await apiRequest("/devices/", { timeoutMs });

        let devices = [];

        if (Array.isArray(data)) {
            devices = data;
        } else if (Array.isArray(data?.items)) {
            devices = data.items;
        } else if (Array.isArray(data?.devices)) {
            devices = data.devices;
        }

        if (devices.length > 0) {
            latestDevice = devices[0];
        }

        // Silent auto-refresh must not rebuild the device list every 2–5s:
        // identical data re-renders innerHTML, drops scroll/focus and reads
        // as flicker. Repaint only when something actually changed.
        const signature = JSON.stringify(
            devices.map((device) => [
                device.id,
                device.name,
                device.device_type,
                device.location,
                device.is_active,
            ])
        );
        if (silent && signature === lastDevicesSignature) {
            return devices;
        }
        lastDevicesSignature = signature;

        populateDeviceInformation(devices);
        renderDeviceList(devices);

        return devices;
    } catch (error) {
        console.warn("Unable to load devices:", error.message);
        return [];
    }
}

function renderDeviceList(devices) {
    const listElement = $("deviceList");

    if (!listElement) {
        return;
    }

    const items = Array.isArray(devices) ? devices : [];

    if (items.length === 0) {
        listElement.innerHTML = `
            <div class="device-list-empty">
                <i class="ri-wifi-off-line"></i>
                <strong>No devices yet</strong>
                <p>Add a device to start receiving readings.</p>
            </div>
        `;
        return;
    }

    listElement.innerHTML = "";

    items.forEach((device) => {
        const item = document.createElement("div");

        item.className = "device-list-item";

        const isActive = device.is_active !== false;

        item.innerHTML = `
            <div class="device-list-item-icon">
                <i class="ri-cpu-line"></i>
            </div>
            <div class="device-list-item-details">
                <strong>${escapeHtml(device.name || `Device ${device.id}`)}</strong>
                <span>${escapeHtml(device.device_type || "ESP32")}${device.location ? ` &middot; ${escapeHtml(device.location)}` : ""}</span>
            </div>
            <span class="device-list-item-status ${isActive ? "active" : ""}">${isActive ? "Active" : "Offline"}</span>
        `;

        item.addEventListener("click", () => {
            latestDevice = device;

            queryAll(".device-list-item").forEach((other) => {
                other.classList.remove("selected");
            });

            item.classList.add("selected");

            populateDeviceInformation(items);
        });

        listElement.appendChild(item);
    });
}

function populateDeviceInformation(devices) {
    const device = latestDevice;

    if (!device) {
        return;
    }

    setText(
        "summaryDeviceName",
        device.name || device.device_name,
        "Unknown device"
    );
    setText("deviceName", device.name || device.device_name, "Unknown device");
    setText("selectedDeviceName", device.name || device.device_name, "No device selected");

    setText(
        "summaryDeviceLocation",
        device.location,
        "Location unavailable"
    );
    setText("deviceLocation", device.location, "Location unavailable");
    setText("selectedDeviceLocation", device.location, "Location unavailable");

    setText(
        "summaryDeviceType",
        device.device_type || device.type,
        "ESP32"
    );
    setText("deviceType", device.device_type || device.type, "ESP32");
    setText("selectedDeviceType", device.device_type || device.type, "--");
    setText("selectedDeviceId", device.id, "--");
    setText("deviceId", device.id, "--");

    const deviceStatusDot = $("deviceStatusDot");
    const isActive = device.is_active !== false;

    if (deviceStatusDot) {
        deviceStatusDot.classList.remove("online", "offline");
        deviceStatusDot.classList.add(isActive ? "online" : "offline");
    }

    setText("deviceStatusText", isActive ? "Connected" : "Disconnected");

    const deviceBadge = $("deviceBadge");

    if (deviceBadge) {
        deviceBadge.textContent = isActive ? "ACTIVE" : "INACTIVE";

        deviceBadge.classList.remove("safe", "watch", "alert", "unknown");
        if (isActive) {
            deviceBadge.classList.add("safe");
        } else {
            deviceBadge.classList.add("alert");
        }
    }

    const selectedDeviceStatus = $("selectedDeviceStatus");

    if (selectedDeviceStatus) {
        selectedDeviceStatus.textContent = isActive ? "Online" : "Offline";
        selectedDeviceStatus.classList.remove("online", "offline");
        selectedDeviceStatus.classList.add(isActive ? "online" : "offline");
    }

    const deviceSelects = queryAll(
        "#deviceSelect, #readingDeviceId, select[name='device_id']"
    );

    deviceSelects.forEach((select) => {
        if (select.options.length === 0) {
            devices.forEach((item) => {
                const option = document.createElement("option");
                option.value = item.id;
                option.textContent =
                    item.name || `Device ${item.id}`;
                select.appendChild(option);
            });
        }
    });
}

async function setupAuth() {
    // Authentication disabled - public API for demo/local use
    // Hide login/logout UI elements
    const loginItem = $("loginItem");
    const logoutItem = $("logoutItem");
    const loginModal = $("loginModal");

    if (loginItem) loginItem.classList.add("hidden");
    if (logoutItem) logoutItem.classList.add("hidden");
    if (loginModal) loginModal.classList.add("hidden");
}

/* =========================================================
   DASHBOARD HELPERS (dashboard only — deterministic, no LLM)
   Uses the EXISTING Analysis scoring engine:
   calculateDerivedParameters / waterScoreLabel / scoreLevel /
   getParameterCondition. No new scoring formula.
   ========================================================= */

function formatReadingTime(value) {
    if (!value) {
        return "--";
    }
    const date = parseApiDate(value);
    if (Number.isNaN(date.getTime())) {
        return "--";
    }
    return date.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    });
}

function formatRecentTime(value) {
    if (!value) {
        return "--";
    }
    const date = parseApiDate(value);
    if (Number.isNaN(date.getTime())) {
        return "--";
    }
    return date.toLocaleTimeString("en-GB", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    });
}

function isDashboardReadingStale(reading) {
    if (!reading || !reading.recorded_at) {
        return { stale: false, ageHours: null };
    }
    const time = parseApiDate(reading.recorded_at).getTime();
    if (Number.isNaN(time)) {
        return { stale: false, ageHours: null };
    }
    const freshnessHours =
        (typeof ANALYSIS_CONFIG !== "undefined" &&
            ANALYSIS_CONFIG.dataFreshnessHours) ||
        24;
    const ageHours = (Date.now() - time) / (1000 * 60 * 60);
    return { stale: ageHours > freshnessHours, ageHours };
}

function showDashboardNotice(type, html) {
    const notice = $("dashboardNotice");
    if (!notice) {
        return;
    }
    if (!html) {
        notice.className = "dashboard-notice hidden";
        notice.innerHTML = "";
        return;
    }
    notice.className = `dashboard-notice ${type}`;
    notice.innerHTML = html;
    const retryButton = notice.querySelector("[data-dashboard-retry]");
    if (retryButton) {
        retryButton.addEventListener("click", () => {
            refreshDashboard();
        });
    }
}

function hideDashboardNotice() {
    showDashboardNotice(null, "");
}

function setDashboardLoading(isLoading) {
    document.body.classList.toggle("dashboard-loading", isLoading);
    const pill = $("dashboardSensorPill");
    if (pill) {
        pill.classList.toggle("is-loading", isLoading);
    }
    if (isLoading && !dashboardHasLoadedOnce && !latestReading) {
        ["temperatureValue", "phValue", "turbidityValue", "tdsValue"].forEach((id) => {
            const el = $(id);
            if (el) {
                el.textContent = "--";
            }
        });
    }
}

function updateDashboardSensorPill(state, reading) {
    const dot = $("dashboardSensorDot");
    const text = $("dashboardSensorText");
    if (!dot || !text) {
        return;
    }
    dot.classList.remove("online", "stale", "offline", "checking");
    if (state === "connected") {
        dot.classList.add("online");
        text.textContent = "Sensor connected";
    } else if (state === "stale") {
        dot.classList.add("stale");
        text.textContent = "Data may be stale";
    } else if (state === "empty") {
        dot.classList.add("offline");
        text.textContent = "No readings yet";
    } else if (state === "offline") {
        dot.classList.add("offline");
        text.textContent = "Backend unavailable";
    } else {
        dot.classList.add("checking");
        text.textContent = "Checking…";
    }
}

function setSensorCardStatus(statusId, text, level) {
    const el = $(statusId);
    if (!el) {
        return;
    }
    const mapped =
        level === "good"
            ? "good"
            : level === "caution"
              ? "warning"
              : level === "alert"
                ? "danger"
                : "neutral";
    el.classList.remove("good", "warning", "danger", "neutral");
    el.classList.add(mapped);
    el.textContent = text;
}

function dashboardScoreStatus(analyticalScore) {
    const level =
        typeof scoreLevel === "function"
            ? scoreLevel(analyticalScore)
            : "unknown";
    if (level === "good") {
        return { badge: "safe", label: "GOOD" };
    }
    if (level === "caution") {
        return { badge: "watch", label: "WATCH" };
    }
    if (level === "alert") {
        return { badge: "alert", label: "ALERT" };
    }
    return { badge: "unknown", label: "UNKNOWN" };
}

function renderDashboardBreakdown(derived) {
    const container = $("qualityBreakdown");
    if (!container) {
        return;
    }
    if (!derived || derived.analyticalWaterScore === null) {
        container.innerHTML = "";
        return;
    }
    const rows = [
        { label: "pH", value: derived.phIndex },
        { label: "Salinity", value: derived.salinityIndex },
        { label: "Clarity", value: derived.clarityIndex },
        { label: "Temp", value: derived.temperatureIndex }
    ];
    container.innerHTML = rows
        .map((row) => {
            const display =
                row.value === null || row.value === undefined
                    ? "--"
                    : String(Math.round(row.value));
            const level =
                typeof scoreLevel === "function"
                    ? scoreLevel(row.value)
                    : "unknown";
            const dotClass =
                level === "good"
                    ? "good"
                    : level === "caution"
                      ? "caution"
                      : level === "alert"
                        ? "alert"
                        : "unknown";
            return (
                `<div class="score-breakdown-row">` +
                `<span class="score-breakdown-label"><i class="score-dot ${dotClass}"></i>${escapeHtml(row.label)}</span>` +
                `<strong>${escapeHtml(display)}</strong>` +
                `</div>`
            );
        })
        .join("");
}

function renderDashboardSummary(reading, derived) {
    const list = $("dashboardQualitySummary");
    if (!list) {
        return;
    }
    if (!reading || !derived) {
        list.innerHTML = `<li class="wq-summary-empty">Waiting for readings…</li>`;
        return;
    }
    const phCond = getParameterCondition("ph", derived.ph);
    const tdsCond = getParameterCondition("tds", derived.tds);
    const turbCond = getParameterCondition("turbidity", derived.turbidity);
    const tempCond = getParameterCondition("temperature", derived.temperature);

    const bullets = [];
    if (derived.ph === null) {
        bullets.push("pH is unavailable.");
    } else if (phCond.level === "good") {
        bullets.push("pH is within the configured range.");
    } else {
        bullets.push(`pH is ${phCond.text.toLowerCase()} — outside the configured range.`);
    }

    if (derived.tds === null) {
        bullets.push("TDS is unavailable.");
    } else if (derived.salinityClass === "Low") {
        bullets.push("TDS indicates relatively low salinity.");
    } else if (derived.salinityClass === "Moderate") {
        bullets.push("TDS indicates moderate salinity.");
    } else if (derived.salinityClass === "High") {
        bullets.push("TDS indicates high salinity.");
    } else {
        bullets.push(`TDS status: ${tdsCond.text}.`);
    }

    const components = [
        { label: "pH", value: derived.phIndex },
        { label: "Salinity", value: derived.salinityIndex },
        { label: "Clarity", value: derived.clarityIndex },
        { label: "Temperature", value: derived.temperatureIndex }
    ].filter((row) => row.value !== null && row.value !== undefined);
    let limiting = null;
    components.forEach((row) => {
        if (!limiting || row.value < limiting.value) {
            limiting = row;
        }
    });
    if (derived.turbidity === null) {
        bullets.push("Turbidity is unavailable.");
    } else if (limiting && limiting.label === "Clarity" && limiting.value < 100) {
        bullets.push("Turbidity is the main limiting factor.");
    } else if (turbCond.level === "good") {
        bullets.push("Turbidity indicates good clarity.");
    } else {
        bullets.push(`Turbidity is ${turbCond.text.toLowerCase()} — clarity indicator.`);
    }

    if (derived.temperature === null) {
        bullets.push("Temperature is unavailable.");
    } else if (tempCond.level === "good") {
        bullets.push("Temperature is within the configured range.");
    } else {
        bullets.push(`Temperature is ${tempCond.text.toLowerCase()} for monitoring.`);
    }

    list.innerHTML = bullets
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("");
}

function renderDashboardRecent(readings) {
    const body = $("dashboardRecentTableBody");
    if (!body) {
        return;
    }
    const rows = Array.isArray(readings) ? readings.slice(0, 5) : [];
    if (rows.length === 0) {
        body.innerHTML = `<tr class="recent-empty-row"><td colspan="5">No readings yet</td></tr>`;
        return;
    }
    body.innerHTML = rows
        .map((reading) => {
            const time = escapeHtml(formatRecentTime(reading.recorded_at));
            const ph = escapeHtml(formatNumber(reading.ph, 2));
            const tds =
                reading.tds === null || reading.tds === undefined
                    ? "--"
                    : escapeHtml(formatNumber(reading.tds, 0));
            const turbidity = escapeHtml(formatNumber(reading.turbidity, 2));
            const temp = escapeHtml(formatTempDisplay(reading.temperature, 1));
            return (
                `<tr><td>${time}</td><td>${ph}</td><td>${tds}</td>` +
                `<td>${turbidity}</td><td>${temp}</td></tr>`
            );
        })
        .join("");
}

function renderDashboardEmpty() {
    ["temperatureValue", "phValue", "turbidityValue", "tdsValue"].forEach((id) => {
        setText(id, "--");
    });
    ["temperatureStatus", "phStatus", "turbidityStatus", "tdsStatus"].forEach((id) => {
        setSensorCardStatus(id, "No data", "unknown");
    });
    setText("temperatureDescription", "Awaiting first reading");
    setText("phDescription", "Awaiting first reading");
    setText("turbidityDescription", "Awaiting first reading");
    setText("tdsDescription", "Awaiting first reading");
    setText("qualityScore", "--");
    setText("qualityStatusText", "No sensor data");
    setText("qualityDescription", "Connect your ESP32/device and send a reading to see water-quality values here.");
    const badge = $("qualityStatusBadge");
    if (badge) {
        badge.textContent = "UNKNOWN";
        badge.classList.remove("safe", "watch", "alert", "unknown");
        badge.classList.add("unknown");
    }
    const progress = $("qualityScaleProgress");
    if (progress) {
        progress.style.width = "0%";
    }
    const circle = $("qualityScoreCircle");
    if (circle) {
        circle.style.setProperty("--quality-progress", "0%");
    }
    document.body.classList.remove("quality-safe", "quality-watch", "quality-alert", "quality-unknown");
    document.body.classList.add("quality-unknown");
    renderDashboardBreakdown(null);
    renderDashboardSummary(null, null);
    renderDashboardRecent([]);
    setText("dashboardReadingTime", "--");
    setText("lastUpdatedTime", "--");
    const stale = $("staleBadge");
    if (stale) {
        stale.classList.add("hidden");
    }
    updateDashboardSensorPill("empty");
    showDashboardNotice(
        "empty",
        `<strong>No sensor readings yet</strong>` +
            `<ul><li>Connect your ESP32/device and send a reading.</li>` +
            `<li>Once data is received, the latest water-quality values will appear here.</li></ul>`
    );
}

function renderDashboardOffline() {
    updateDashboardSensorPill("offline");
    showDashboardNotice(
        "error",
        `<strong>Unable to retrieve sensor data</strong>` +
            `<ul><li>The Aqua Sense backend is currently unavailable.</li>` +
            `<li>Check the backend connection and try again.</li></ul>` +
            `<button class="secondary-button dashboard-retry-button" data-dashboard-retry type="button">` +
            `<i class="ri-refresh-line"></i>Retry</button>`
    );
}

async function loadLatestReading(options) {
    const timeoutMs = options && options.timeoutMs;
    try {
        const data = await apiRequest("/readings/latest", { timeoutMs });

        const normalized = normalizeReadings(data);

        if (normalized.length > 0) {
            latestReading = normalized[0];
        } else if (data && !Array.isArray(data)) {
            latestReading = normalizeReading(data);
        }

        if (latestReading) {
            dashboardBackendReachable = true;
            dashboardHasLoadedOnce = true;
            updateDashboard(latestReading);
        } else {
            dashboardBackendReachable = true;
            renderDashboardEmpty();
        }

        return latestReading;
    } catch (error) {
        if (error && error.status === 404) {
            dashboardBackendReachable = true;
            if (!latestReading) {
                renderDashboardEmpty();
            }
            return latestReading;
        }
        dashboardBackendReachable = false;
        if (!latestReading) {
            setDashboardLoading(false);
            updateDashboardSensorPill("offline");
            renderDashboardOffline();
        } else {
            renderDashboardOffline();
        }
        return latestReading;
    }
}

async function loadAnalysisLatestReading() {
    // Reuse the reading the dashboard already loaded when one exists, so the
    // Analysis page never issues a duplicate /readings/latest request.
    if (latestReading) {
        analysisLoading = false;
        analysisLoadError = null;
        return latestReading;
    }

    analysisLoading = true;
    analysisLoadError = null;

    try {
        const data = await apiRequest("/readings/latest");
        const normalized = normalizeReadings(data);

        if (normalized.length > 0) {
            latestReading = normalized[0];
        } else if (data && !Array.isArray(data)) {
            latestReading = normalizeReading(data);
        }

        analysisLoading = false;
        return latestReading;
    } catch (error) {
        analysisLoading = false;
        latestReading = null;

        // A 404 means the database simply has no readings yet. That is the
        // "no readings available" state, not a connection failure.
        analysisLoadError =
            error.status === 404
                ? null
                : error.message || "Unable to load the latest reading.";

        if (error.status !== 404) {
            console.warn(
                "Unable to load the latest reading for Analysis:",
                analysisLoadError
            );
        }

        return null;
    }
}

async function loadAllReadings(options) {
    const timeoutMs = options && options.timeoutMs;
    try {
        // Full 1000-reading window (backend max), same as the Trends page,
        // so the dashboard history chart covers 7D/30D ranges fully.
        const data = await apiRequest("/readings/?limit=1000", { timeoutMs });

        readingsCache = normalizeReadings(data);

        if (!latestReading && readingsCache.length > 0) {
            latestReading = readingsCache[0];
            updateDashboard(latestReading);
        }

        drawTrendChart(readingsCache);
        renderReadingsTable(readingsCache);
        renderDashboardRecent(readingsCache);

        return readingsCache;
    } catch (error) {
        renderDashboardRecent(readingsCache);
        return readingsCache;
    }
}

async function checkBackend(timeoutMs) {
    try {
        const data = await apiRequest("/health", { timeoutMs });

        setConnectionStatus(
            true,
            data?.status === "healthy"
                ? "Connected"
                : "Connected"
        );

        return data?.status === "healthy";
    } catch {
        setConnectionStatus(false, "Offline");
        return false;
    }
}

async function refreshDashboard(options) {
    // Silent auto-refresh (the 2–5s timer) swaps values instantly: no button
    // disabling and no dashboard shimmer, so numbers change in place instead
    // of blanking/flickering every cycle. Manual refresh stays loud so the
    // user gets clear loading feedback.
    const silent = !!(options && options.silent);
    if (dashboardRefreshing) {
        return;
    }
    dashboardRefreshing = true;
    // Silent cycles fail fast (short timeout) so the next 2s tick retries
    // instead of piling slow requests on top of each other.
    const timeoutMs = silent ? API_REFRESH_TIMEOUT_MS : API_DEFAULT_TIMEOUT_MS;
    const refreshButtons = silent
        ? []
        : queryAll(
              "#refreshButton, #manualRefresh, #globalRefreshButton, #dashboardRefreshButton, [data-action='refresh']"
          );

    refreshButtons.forEach((button) => {
        button.disabled = true;
        button.classList.add("loading");
    });
    if (!silent) {
        setDashboardLoading(true);
    }

    try {
        const backendOnline = await checkBackend(timeoutMs);

        if (!backendOnline) {
            dashboardBackendReachable = false;
            if (!silent) {
                setDashboardLoading(false);
            }
            if (!latestReading) {
                renderDashboardEmpty();
                updateDashboardSensorPill("offline");
            }
            renderDashboardOffline();
            return;
        }

        // Fetch devices + latest reading concurrently so all values paint in
        // one pass instead of staggering in over serial round trips.
        await Promise.all([
            loadDevices({ silent, timeoutMs }),
            loadLatestReading({ timeoutMs })
        ]);
        if (!dashboardBackendReachable) {
            if (!silent) {
                setDashboardLoading(false);
            }
            return;
        }
        await loadAllReadings({ timeoutMs });
        updateLastRefreshTime();

        // Keep an open Analysis page in sync with the freshly loaded reading
        // without issuing an extra /readings/latest request.
        if (currentPage === "analysis" && typeof updateAnalysisPage === "function") {
            updateAnalysisPage();
        }

        updateChatContextIndicators();
        setupReports();
        setupProfile();
    } finally {
        dashboardRefreshing = false;
        if (!silent) {
            setDashboardLoading(false);
            refreshButtons.forEach((button) => {
                button.disabled = false;
                button.classList.remove("loading");
            });
        }
    }
}

function updateLastRefreshTime() {
    if (latestReading && latestReading.recorded_at) {
        const human = formatReadingTime(latestReading.recorded_at);
        setText("lastUpdatedTime", human, "--");
        setText("lastRefreshTime", human, "--");
        return;
    }
    if (!dashboardHasLoadedOnce) {
        setText("lastUpdatedTime", "--");
    }
}

function updateDashboard(reading) {
    if (!reading) {
        renderDashboardEmpty();
        return;
    }

    hideDashboardNotice();

    setText(
        "temperatureValue",
        reading.temperature === null || reading.temperature === undefined
            ? "--"
            : formatTempDisplay(reading.temperature, 1)
    );

    setText(
        "phValue",
        reading.ph === null || reading.ph === undefined ? "--" : formatNumber(reading.ph, 2)
    );

    setText(
        "turbidityValue",
        reading.turbidity === null || reading.turbidity === undefined
            ? "--"
            : formatNumber(reading.turbidity, 2)
    );

    setText(
        "tdsValue",
        reading.tds === null || reading.tds === undefined ? "--" : formatNumber(reading.tds, 0)
    );

    const humanTime = formatReadingTime(reading.recorded_at);
    setText("latestReadingTime", humanTime, "--");
    setText("readingTimestamp", humanTime, "--");
    setText("dashboardReadingTime", humanTime, "--");
    setText("lastUpdatedTime", humanTime, "--");
    setText("lastRefreshTime", humanTime, "--");

    const derived =
        typeof calculateDerivedParameters === "function"
            ? calculateDerivedParameters(reading)
            : null;

    if (derived) {
        const score = derived.analyticalWaterScore;
        const rounded = score === null ? null : Math.round(score);
        const label =
            typeof waterScoreLabel === "function"
                ? waterScoreLabel(score)
                : "Good";
        const status = dashboardScoreStatus(score);
        const title =
            score === null ? "No sensor data" : `${label} water quality`;
        const description =
            score === null
                ? "Connect your device to calculate the water-quality score."
                : score >= 80
                  ? "The available sensor readings are within the configured ranges."
                  : score >= 60
                    ? "Some readings are outside the preferred ranges."
                    : "One or more sensor readings need attention.";

        const scoreNumber = $("qualityScore");
        if (scoreNumber) {
            scoreNumber.textContent =
                rounded === null || rounded === undefined ? "--" : String(rounded);
        }
        setText("qualityStatusText", title);
        setText("qualityDescription", description);
        const badge = $("qualityStatusBadge");
        if (badge) {
            badge.textContent = status.label;
            badge.classList.remove("safe", "watch", "alert", "unknown");
            badge.classList.add(status.badge);
        }
        const progress = $("qualityScaleProgress");
        if (progress) {
            const numeric = rounded === null ? 0 : Number(rounded);
            progress.style.width = `${Math.max(0, Math.min(100, numeric))}%`;
        }
        const circle = $("qualityScoreCircle");
        if (circle) {
            const numeric = rounded === null ? 0 : Number(rounded);
            circle.style.setProperty("--quality-progress", `${Math.max(0, Math.min(100, numeric))}%`);
            circle.setAttribute("aria-label", `Aqua Sense analytical score ${rounded === null ? "unavailable" : rounded + " of 100"}`);
        }
        const bodyStatus =
            status.badge === "safe"
                ? "safe"
                : status.badge === "watch"
                  ? "watch"
                  : status.badge === "alert"
                    ? "alert"
                    : "unknown";
        document.body.classList.remove(
            "quality-safe",
            "quality-watch",
            "quality-alert",
            "quality-unknown"
        );
        document.body.classList.add(`quality-${bodyStatus}`);

        const phCond = getParameterCondition("ph", derived.ph);
        const tdsCond = getParameterCondition("tds", derived.tds);
        const turbCond = getParameterCondition("turbidity", derived.turbidity);
        const tempCond = getParameterCondition("temperature", derived.temperature);

        setSensorCardStatus("phStatus", phCond.text, phCond.level);
        setSensorCardStatus("tdsStatus", tdsCond.text, tdsCond.level);
        setSensorCardStatus("turbidityStatus", turbCond.text, turbCond.level);
        setSensorCardStatus("temperatureStatus", tempCond.text, tempCond.level);

        setText(
            "phDescription",
            derived.ph === null
                ? "Awaiting pH reading"
                : phCond.level === "good"
                  ? "Within configured range"
                  : `Outside preferred range (${phCond.text.toLowerCase()})`
        );
        setText(
            "tdsDescription",
            derived.tds === null
                ? "Awaiting TDS reading"
                : derived.salinityClass === "Low"
                  ? "Current measured value · low salinity"
                  : derived.salinityClass === "Moderate"
                    ? "Current measured value · moderate salinity"
                    : "Current measured value · high salinity"
        );
        setText(
            "turbidityDescription",
            derived.turbidity === null
                ? "Awaiting turbidity reading"
                : turbCond.level === "good"
                  ? "Clarity indicator · clear"
                  : "Clarity indicator · cloudy"
        );
        setText(
            "temperatureDescription",
            derived.temperature === null
                ? "Awaiting temperature reading"
                : tempCond.level === "good"
                  ? "Current measured value · in range"
                  : "Current measured value · check range"
        );

        renderDashboardBreakdown(derived);
        renderDashboardSummary(reading, derived);

        const staleInfo = isDashboardReadingStale(reading);
        const staleBadge = $("staleBadge");
        if (staleBadge) {
            staleBadge.classList.toggle("hidden", !staleInfo.stale);
        }
        if (staleInfo.stale) {
            updateDashboardSensorPill("stale", reading);
            showDashboardNotice(
                "stale",
                `<strong>Data may be stale</strong>` +
                    `<ul><li>Last reading: ${escapeHtml(humanTime)}.</li>` +
                    `<li>Values are shown as measured — send a new reading for current conditions.</li></ul>`
            );
        } else {
            updateDashboardSensorPill("connected", reading);
            hideDashboardNotice();
        }
    } else {
        calculateQualityScore(reading);
        updateDashboardSensorPill("connected", reading);
    }
    renderDashboardRecent(readingsCache);
}

function computeReadingQuality(reading) {
    const t = analysisNumber(reading.temperature);
    const ph = analysisNumber(reading.ph);
    const turb = analysisNumber(reading.turbidity);
    const tds = analysisNumber(reading.tds);

    let tScore = t !== null ? scoreTargetRange(t, 15, 30, 5, 40) : null;
    let phScore = ph !== null ? scoreTargetRange(ph, 6.5, 8.5, 4.5, 10.5) : null;
    let turbScore = turb !== null ? scoreClarity(turb) : null;
    let tdsScore = tds !== null ? scoreTDS(tds, 1000) : null;

    const availableScores = [tScore, phScore, turbScore, tdsScore].filter((v) => v !== null);

    if (availableScores.length === 0) {
        return {
            score: null,
            status: "unknown",
            title: "No sensor data available",
            description: "Connect a device to view the water-quality assessment."
        };
    }

    const avgScore = availableScores.reduce((sum, val) => sum + val, 0) / availableScores.length;
    let finalScore = Math.round(avgScore);
    
    const minScore = Math.min(...availableScores);
    if (minScore === 0) {
        finalScore = Math.min(finalScore, 20);
    }

    let status = "safe";
    let title = "Good water quality";
    let description = "The available sensor readings are within the configured safe ranges.";

    if (finalScore < 50) {
        status = "alert";
        title = "Poor water quality";
        description = "One or more sensor readings are critically outside configured safe limits. Aqua Sense analytical safeguard applied.";
    } else if (finalScore < 80) {
        status = "watch";
        title = "Needs attention";
        description = "Some readings are approaching or exceeding the recommended ranges.";
    }

    return {
        score: finalScore,
        status,
        title,
        description
    };
}

function calculateQualityScore(reading) {
    const result = computeReadingQuality(reading);

    updateQualityUI(
        result.score,
        result.title,
        result.status,
        result.description
    );

    return result;
}

function updateQualityUI(
    score,
    title = "Waiting for readings",
    status = "unknown",
    description = "Connect a device to view the water-quality assessment."
) {
    const scoreNumber =
        $("qualityScore") ||
        $("scoreNumber") ||
        $("analysisScore");

    if (scoreNumber) {
        scoreNumber.textContent =
            score === null || score === undefined ? "--" : score;
    }

    setText("qualityTitle", title);
    setText("qualityStatusText", title);
    setText("analysisStatusTitle", title);
    setText("qualityDescription", description);
    setText("analysisStatusDescription", description);

    const badgeLabel =
        status === "safe"
            ? "GOOD"
            : status === "watch"
              ? "WATCH"
              : status === "alert"
                ? "ALERT"
                : "WAITING";

    const badges = queryAll(
        "#qualityStatusBadge, #analysisStatusBadge, .quality-status-badge"
    );

    badges.forEach((badge) => {
        badge.textContent = badgeLabel;
        badge.classList.remove("safe", "watch", "alert", "unknown");
        badge.classList.add(status);
    });

    const numericScore =
        score === null || score === undefined ? 0 : Number(score);

    const progress = $("qualityScaleProgress");

    if (progress) {
        const isSvgCircle =
            typeof progress.style.strokeDasharray === "string";

        if (isSvgCircle) {
            const circumference = 377;

            progress.style.strokeDasharray = String(circumference);
            progress.style.strokeDashoffset = String(
                circumference - (circumference * numericScore) / 100
            );

            if (status === "alert") {
                progress.style.stroke = "#ef4444";
            } else if (status === "watch") {
                progress.style.stroke = "#f59e0b";
            } else if (status === "safe") {
                progress.style.stroke = "#16a34a";
            } else {
                progress.style.stroke = "#94a3b8";
            }
        } else {
            progress.style.width = `${Math.max(0, Math.min(100, numericScore))}%`;

            if (status === "alert") {
                progress.style.background = "#ef4444";
            } else if (status === "watch") {
                progress.style.background = "#f59e0b";
            } else if (status === "safe") {
                progress.style.background = "#16a34a";
            } else {
                progress.style.background = "#94a3b8";
            }
        }
    }

    document.body.classList.remove(
        "quality-safe",
        "quality-watch",
        "quality-alert",
        "quality-unknown"
    );

    document.body.classList.add(`quality-${status}`);
}

function filterReadingsByRange(readings, range) {
    if (!Array.isArray(readings)) {
        return [];
    }

    if (range === "ALL") {
        return readings;
    }

    const hours = {
        "1H": 1,
        "6H": 6,
        "24H": 24,
        "7D": 24 * 7,
        "30D": 24 * 30
    }[range];

    if (!hours) {
        return readings;
    }

    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    const filtered = readings.filter((reading) => {
        if (!reading.recorded_at) {
            return true;
        }

        const timestamp = parseApiTimestamp(reading.recorded_at);

        return Number.isNaN(timestamp) || timestamp >= cutoff;
    });

    return filtered.length > 0 ? filtered : readings.slice(0, 20);
}

/**
 * Sort readings chronologically (oldest → newest) by their actual
 * timestamp so every chart plots real time positions regardless of
 * the order the API returned. Readings without a valid timestamp are
 * placed last and still plotted in sequence (no time is invented).
 */
function sortReadingsChronologically(readings) {
    if (!Array.isArray(readings)) {
        return [];
    }

    return readings
        .map((reading, index) => ({
            reading,
            index,
            time: parseApiTimestamp(reading.recorded_at)
        }))
        .sort((a, b) => {
            const aValid = !Number.isNaN(a.time);
            const bValid = !Number.isNaN(b.time);

            if (aValid && bValid) {
                return a.time - b.time;
            }

            if (aValid !== bValid) {
                return aValid ? -1 : 1;
            }

            return a.index - b.index;
        })
        .map((item) => item.reading);
}
/**
 * Format a timestamp for chart axis labels / tooltips using the real
 * reading time (never an invented one).
 */
function formatChartTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return "--";
    }

    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

const CHART_UNITS = {
    temperature: "°C",
    ph: "pH",
    turbidity: "NTU",
    tds: "mg/L"
};

/* Theme-aware chart chrome: canvas cannot use CSS vars directly. */
function themeChartTick() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--chart-tick");
    return (v && v.trim()) || "#718096";
}

function themeChartGrid() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--chart-grid");
    return (v && v.trim()) || "#e5eaf1";
}

function drawTrendChart(readings = readingsCache) {
    const container =
        $("trendChart") ||
        $("readingsChart") ||
        $("dashboardChart");

    // Real <canvas> element: use the canvas renderer.
    if (container && typeof container.getContext === "function") {
        renderCanvasChart(container, readings);
        return;
    }

    // Dashboard SVG chart (#historyChart): update the SVG paths.
    const svgChart = $("historyChart");

    if (svgChart) {
        renderSvgChart(svgChart, readings);
        return;
    }

    // Div placeholder (#trendsChart): render an inline SVG chart.
    const divChart = $("trendsChart");

    if (divChart) {
        renderDivChart(divChart, readings);
    }
}

function getTrendSeriesValue(reading, parameter = "quality") {
    if (parameter === "quality") {
        const result = computeReadingQuality(reading);

        return result.score;
    }

    const value = Number(reading[parameter]);

    return Number.isFinite(value) ? value : null;
}

function renderCanvasChart(canvas, readings) {
    const context = canvas.getContext("2d");

    if (!context) {
        return;
    }

    const filtered = sortReadingsChronologically(
        filterReadingsByRange(readings, currentRange)
    );

    const width = canvas.clientWidth || 700;
    const height = 270;
    const devicePixelRatio = window.devicePixelRatio || 1;

    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;

    context.setTransform(
        devicePixelRatio,
        0,
        0,
        devicePixelRatio,
        0,
        0
    );

    context.clearRect(0, 0, width, height);

    const padding = {
        left: 45,
        right: 20,
        top: 25,
        bottom: 40
    };

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    context.font = "11px Inter, Arial, sans-serif";
    context.fillStyle = themeChartTick();
    context.strokeStyle = themeChartGrid();
    context.lineWidth = 1;

    // Timestamps for time-proportional X positions. Readings without a
    // valid timestamp keep their sequence position (no time is invented).
    const times = filtered.map((reading) =>
        parseApiTimestamp(reading.recorded_at)
    );
    const validTimes = times.filter((time) => !Number.isNaN(time));
    const useTimeScale = validTimes.length >= 2;
    const timeMin = useTimeScale ? Math.min(...validTimes) : 0;
    const timeMax = useTimeScale
        ? Math.max(...validTimes, timeMin + 1)
        : 1;

    function xForIndex(index) {
        if (filtered.length === 1) {
            return padding.left + chartWidth / 2;
        }

        if (useTimeScale && !Number.isNaN(times[index])) {
            return (
                padding.left +
                ((times[index] - timeMin) / (timeMax - timeMin)) *
                    chartWidth
            );
        }

        return (
            padding.left + (index / (filtered.length - 1)) * chartWidth
        );
    }

    // X-axis time labels at ~4 evenly spaced ticks (only when time-scaled).
    if (useTimeScale && filtered.length > 1) {
        const tickCount = Math.min(4, filtered.length - 1);

        for (let tick = 0; tick <= tickCount; tick += 1) {
            const time =
                timeMin + ((timeMax - timeMin) / tickCount) * tick;
            const label = formatChartTime(new Date(time));
            const labelWidth = context.measureText(label).width;
            let x =
                padding.left +
                (chartWidth * tick) / tickCount;

            x = Math.min(
                Math.max(x, padding.left + labelWidth / 2),
                width - padding.right - labelWidth / 2
            );

            context.fillText(label, x - labelWidth / 2, height - 8);
        }
    }

    const series = [
        {
            key: "temperature",
            color: "#f59e0b",
            label: "Temperature"
        },
        {
            key: "ph",
            color: "#3b82f6",
            label: "pH"
        },
        {
            key: "turbidity",
            color: "#8b5cf6",
            label: "Turbidity"
        },
        {
            key: "tds",
            color: "#0ea5a4",
            label: "TDS"
        }
    ];

    // Compute the real value scale from actual readings so the Y axis
    // reflects true data instead of a fixed 0–100 range.
    const values = [];

    filtered.forEach((reading) => {
        series.forEach((item) => {
            const value = Number(reading[item.key]);

            if (Number.isFinite(value)) {
                values.push(value);
            }
        });
    });

    let minimum = values.length ? Math.min(...values) : 0;
    let maximum = values.length ? Math.max(...values) : 100;

    if (minimum === maximum) {
        minimum -= 1;
        maximum += 1;
    }

    const margin = (maximum - minimum) * 0.12;

    minimum -= margin;
    maximum += margin;

    // Presentation only: all plotted series are nonnegative measurements,
    // so the axis must never imply negative values.
    minimum = Math.max(0, minimum);
    if (maximum <= 0) {
        maximum = 1;
    }

    for (let index = 0; index <= 4; index += 1) {
        const y = padding.top + (chartHeight / 4) * index;

        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();

        // Label from the computed scale (top = max, bottom = min).
        const scaleValue = maximum - ((maximum - minimum) / 4) * index;

        context.fillText(
            Number.isInteger(scaleValue)
                ? String(scaleValue)
                : scaleValue.toFixed(1),
            12,
            y + 4
        );
    }

    if (filtered.length === 0) {
        context.fillStyle = themeChartTick();
        context.textAlign = "center";
        context.fillText(
            "No readings available",
            width / 2,
            height / 2
        );
        context.textAlign = "left";
        return;
    }

    series.forEach((item) => {
        const points = filtered
            .map((reading, index) => {
                const value = Number(reading[item.key]);

                if (!Number.isFinite(value)) {
                    return null;
                }

                const x = xForIndex(index);

                const y =
                    padding.top +
                    chartHeight -
                    ((value - minimum) / (maximum - minimum)) *
                        chartHeight;

                return { x, y, value };
            })
            .filter(Boolean);

        if (points.length === 0) {
            return;
        }

        context.beginPath();
        context.strokeStyle = item.color;
        context.lineWidth = 2.5;

        points.forEach((point, index) => {
            if (index === 0) {
                context.moveTo(point.x, point.y);
            } else {
                context.lineTo(point.x, point.y);
            }
        });

        context.stroke();

        points.forEach((point) => {
            context.beginPath();
            context.fillStyle = item.color;
            context.arc(point.x, point.y, 3, 0, Math.PI * 2);
            context.fill();
        });
    });

    context.font = "10px Inter, Arial, sans-serif";

    const legendY = height - 12;
    let legendX = padding.left;

    series.forEach((item) => {
        context.fillStyle = item.color;
        context.fillRect(legendX, legendY - 9, 10, 10);

        context.fillStyle = themeChartTick();
        context.fillText(item.label, legendX + 15, legendY);

        legendX += item.label.length * 6 + 48;
    });

    updateTrendSummary(filtered);
}

function renderSvgChart(svg, readings) {
    const filtered = sortReadingsChronologically(
        filterReadingsByRange(readings, currentRange)
    );

    const line = $("historyChartLine");
    const area = $("historyChartArea");
    const point = $("historyChartPoint");

    if (!line) {
        return;
    }

    const values = [];

    filtered.forEach((reading) => {
        const value = getTrendSeriesValue(reading, trendParameter);

        if (value !== null) {
            values.push(value);
        }
    });

    if (values.length === 0) {
        const dataNoteEmpty = $("chartDataNote");

        if (dataNoteEmpty) {
            dataNoteEmpty.classList.remove("live");
        }

        return;
    }

    let minimum = Math.min(...values);
    let maximum = Math.max(...values);

    if (minimum === maximum) {
        minimum -= 1;
        maximum += 1;
    }

    const margin = (maximum - minimum) * 0.15;

    minimum -= margin;
    maximum += margin;

    // Presentation only: quality scores and sensor measurements are
    // nonnegative, so the axis must never imply negative values.
    minimum = Math.max(0, minimum);
    if (maximum <= 0) {
        maximum = 1;
    }

    const chartTop = 45;
    const chartBottom = 215;
    const chartWidth = 700;
    const chartHeight = chartBottom - chartTop;

    // Time-proportional X positions from real reading timestamps so the
    // line shape matches the timeline (irregular gaps stay gaps instead of
    // being squeezed into even spacing). Readings without a valid timestamp
    // keep their sequence position — no time is invented.
    const times = filtered.map((reading) =>
        parseApiTimestamp(reading.recorded_at)
    );
    const validTimes = times.filter((time) => !Number.isNaN(time));
    const useTimeScale = validTimes.length >= 2;
    const timeMin = useTimeScale ? Math.min(...validTimes) : 0;
    const timeMax = useTimeScale
        ? Math.max(...validTimes, timeMin + 1)
        : 1;

    function xForReadingIndex(index) {
        if (filtered.length === 1) {
            return chartWidth / 2;
        }
        if (useTimeScale && !Number.isNaN(times[index])) {
            return ((times[index] - timeMin) / (timeMax - timeMin)) * chartWidth;
        }
        return (index / (filtered.length - 1)) * chartWidth;
    }

    const points = filtered
        .map((reading, index) => {
            const value = getTrendSeriesValue(reading, trendParameter);

            if (value === null) {
                return null;
            }

            const x = xForReadingIndex(index);

            const y =
                chartBottom -
                ((value - minimum) / (maximum - minimum)) *
                    chartHeight;

            return { x, y, value };
        })
        .filter(Boolean);

    if (points.length === 0) {
        return;
    }

    const pathData = points
        .filter(
            (item) =>
                Number.isFinite(item.x) && Number.isFinite(item.y)
        )
        .map(
            (item, index) =>
                `${index === 0 ? "M" : "L"} ${item.x.toFixed(1)},${item.y.toFixed(1)}`
        )
        .join(" ");

    if (pathData === "") {
        return;
    }

    line.setAttribute("d", pathData);

    if (area) {
        area.setAttribute(
            "d",
            `${pathData} L700,260 L0,260 Z`
        );
    }

    if (point && points.length > 0) {
        const last = points[points.length - 1];

        point.setAttribute("cx", last.x.toFixed(1));
        point.setAttribute("cy", last.y.toFixed(1));
    }

    // Live timeline axis: replace the static placeholder labels with the
    // real time window (oldest → newest) and the real value scale, so the
    // axes always agree with the plotted line and the selected range.
    try {
        const container = svg.closest(".history-chart-container");

        if (container) {
            const xLabels = container.querySelector(".chart-x-labels");

            if (xLabels) {
                const tickCount = 4;
                let labels = [];

                if (filtered.length === 1 || !useTimeScale) {
                    const only = useTimeScale
                        ? formatChartTime(new Date(timeMax))
                        : formatChartTime(
                              parseApiDate(filtered[filtered.length - 1].recorded_at)
                          );
                    labels = [only];
                } else {
                    for (let tick = 0; tick <= tickCount; tick += 1) {
                        const time =
                            timeMin + ((timeMax - timeMin) / tickCount) * tick;
                        labels.push(formatChartTime(new Date(time)));
                    }
                }

                xLabels.innerHTML = labels
                    .map((label) => `<span>${escapeHtml(label)}</span>`)
                    .join("");
            }

            const yLabels = container.querySelector(".chart-y-labels");

            if (yLabels) {
                const rows = 5;
                let html = "";

                for (let row = 0; row < rows; row += 1) {
                    const scaleValue =
                        maximum - ((maximum - minimum) / (rows - 1)) * row;
                    const text = Number.isInteger(scaleValue)
                        ? String(scaleValue)
                        : scaleValue.toFixed(1);
                    html += `<span>${escapeHtml(text)}</span>`;
                }

                yLabels.innerHTML = html;
            }
        }
    } catch {
        // Axis labels are decoration — never break the chart itself.
    }

    const dataNote = $("chartDataNote");

    if (dataNote) {
        const latestTime = useTimeScale
            ? formatChartTime(new Date(timeMax))
            : "--";
        dataNote.textContent =
            `Live · ${points.length} reading${points.length === 1 ? "" : "s"}` +
            ` · ${currentRange}` +
            (latestTime !== "--" ? ` · latest ${latestTime}` : "");
        dataNote.classList.add("live");
    }

    updateTrendSummary(filtered);
}

function updateTrendSummary(readings) {
    const values = [];

    readings.forEach((reading) => {
        const value = getTrendSeriesValue(reading, trendParameter);

        if (value !== null && Number.isFinite(value)) {
            values.push(value);
        }
    });

    if (values.length === 0) {
        setText("trendAverage", "--");
        setText("trendMinimum", "--");
        setText("trendMaximum", "--");
        return;
    }

    const average =
        values.reduce((sum, value) => sum + value, 0) / values.length;

    setText("trendAverage", formatNumber(average, 2), "--");
    setText("trendMinimum", formatNumber(Math.min(...values), 2), "--");
    setText("trendMaximum", formatNumber(Math.max(...values), 2), "--");
}

function trendsParameterTitle(parameter) {
    return String(parameter || "")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderDivChart(container, readings) {
    const filtered = sortReadingsChronologically(
        filterReadingsByRange(readings, currentRange)
    );

    if (filtered.length === 0) {
        container.innerHTML = `
            <i class="ri-line-chart-line"></i>
            <strong>Trend visualization</strong>
            <p>No readings in this time range yet.</p>
        `;
        return;
    }

    const values = [];

    filtered.forEach((reading) => {
        const value = getTrendSeriesValue(reading, trendParameter);

        if (value !== null) {
            values.push(value);
        }
    });

    if (values.length === 0) {
        container.innerHTML = `
            <i class="ri-line-chart-line"></i>
            <strong>Trend visualization</strong>
            <p>Not enough data for the selected parameter.</p>
        `;
        return;
    }

    let minimum = Math.min(...values);
    let maximum = Math.max(...values);

    if (minimum === maximum) {
        minimum -= 1;
        maximum += 1;
    }

    const margin = (maximum - minimum) * 0.12;
    const seriesColor = trendsSeriesColor(trendParameter);

    minimum -= margin;
    maximum += margin;

    // Presentation only: quality scores and sensor measurements are
    // nonnegative, so the axis must never imply negative values.
    minimum = Math.max(0, minimum);
    if (maximum <= 0) {
        maximum = 1;
    }

    const chartTop = 40;
    const chartBottom = 220;
    const chartHeight = chartBottom - chartTop;

    // Time-proportional X, same as the main history chart: real gaps stay
    // gaps instead of being squeezed into even spacing.
    const divTimes = filtered.map((reading) =>
        parseApiTimestamp(reading.recorded_at)
    );
    const divValidTimes = divTimes.filter((time) => !Number.isNaN(time));
    const divUseTimeScale = divValidTimes.length >= 2;
    const divTimeMin = divUseTimeScale ? Math.min(...divValidTimes) : 0;
    const divTimeMax = divUseTimeScale
        ? Math.max(...divValidTimes, divTimeMin + 1)
        : 1;

    const points = filtered
        .map((reading, index) => {
            const value = getTrendSeriesValue(reading, trendParameter);

            if (value === null) {
                return null;
            }

            let x;

            if (filtered.length === 1) {
                x = 350;
            } else if (divUseTimeScale && !Number.isNaN(divTimes[index])) {
                x =
                    ((divTimes[index] - divTimeMin) /
                        (divTimeMax - divTimeMin)) *
                    700;
            } else {
                x = (index / (filtered.length - 1)) * 700;
            }

            const y =
                chartBottom -
                ((value - minimum) / (maximum - minimum)) *
                    chartHeight;

            return { x, y, value };
        })
        .filter(Boolean);

    if (points.length === 0) {
        return;
    }

    const pathData = points
        .filter(
            (item) =>
                Number.isFinite(item.x) && Number.isFinite(item.y)
        )
        .map(
            (item, index) =>
                `${index === 0 ? "M" : "L"} ${item.x.toFixed(1)},${item.y.toFixed(1)}`
        )
        .join(" ");

    if (pathData === "") {
        return;
    }

    const dots = points
        .map(
            (item) =>
                `<circle cx="${item.x.toFixed(1)}" cy="${item.y.toFixed(1)}" r="3" fill="${seriesColor}"></circle>`
        )
        .join("");

    const lastPoint = points[points.length - 1];

    container.innerHTML = `
        <svg
            class="inline-chart"
            viewBox="0 0 700 260"
            preserveAspectRatio="none"
            role="img"
            aria-label="Sensor trend chart"
        >
            <g stroke="var(--chart-grid, #e5eaf1)" stroke-width="1">
                <line x1="0" y1="85" x2="700" y2="85"></line>
                <line x1="0" y1="130" x2="700" y2="130"></line>
                <line x1="0" y1="175" x2="700" y2="175"></line>
                <line x1="0" y1="220" x2="700" y2="220"></line>
            </g>
            <path
                d="${pathData}"
                fill="none"
                stroke="${seriesColor}"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
            ></path>
            ${dots}
            <text
                x="${Math.min(650, lastPoint.x + 8)}"
                y="${Math.max(24, lastPoint.y - 10)}"
                fill="${themeChartTick()}"
                font-size="12"
            >${formatNumber(lastPoint.value, 1)}</text>
        </svg>
    `;

    updateTrendSummary(filtered);
}

function trendsSeriesColor(parameter) {
    if (parameter === "temperature") {
        return "#f59e0b";
    }

    if (parameter === "ph") {
        return "#3b82f6";
    }

    if (parameter === "turbidity") {
        return "#8b5cf6";
    }

    if (parameter === "tds") {
        return "#0ea5a4";
    }

    return "#10b981";
}

/* =========================================================
   TRENDS PAGE — historical sensor readings (measurements only)
   Data: actual PostgreSQL WaterReading rows via GET /readings/.
   No scoring, no invented values, no chart framework.
   ========================================================= */

let trendsCache = [];
let trendsRange = "24H";
let trendsLoading = false;
let trendsLoadedOnce = false;

const TRENDS_RANGE_HOURS = {
    "1H": 1,
    "6H": 6,
    "24H": 24,
    "7D": 24 * 7,
    "ALL": null
};

const TRENDS_PARAMS = [
    {
        key: "ph",
        label: "pH",
        unit: "",
        digits: 2,
        nonnegative: true,
        color: "#3b82f6",
        chartId: "trendsChartPh",
        statIds: {
            latest: "trendsPhLatest",
            average: "trendsPhAverage",
            minimum: "trendsPhMinimum",
            maximum: "trendsPhMaximum"
        },
        noteId: "trendsNotePh"
    },
    {
        key: "tds",
        label: "TDS",
        unit: " mg/L",
        digits: 0,
        nonnegative: true,
        color: "#0ea5a4",
        chartId: "trendsChartTds",
        statIds: {
            latest: "trendsTdsLatest",
            average: "trendsTdsAverage",
            minimum: "trendsTdsMinimum",
            maximum: "trendsTdsMaximum"
        },
        noteId: "trendsNoteTds"
    },
    {
        key: "turbidity",
        label: "Turbidity",
        unit: " NTU",
        digits: 2,
        nonnegative: true,
        color: "#8b5cf6",
        chartId: "trendsChartTurbidity",
        statIds: {
            latest: "trendsTurbidityLatest",
            average: "trendsTurbidityAverage",
            minimum: "trendsTurbidityMinimum",
            maximum: "trendsTurbidityMaximum"
        },
        noteId: "trendsNoteTurbidity"
    },
    {
        key: "temperature",
        label: "Temperature",
        unit: "",
        useTempDisplay: true,
        digits: 1,
        nonnegative: true,
        color: "#f59e0b",
        chartId: "trendsChartTemperature",
        statIds: {
            latest: "trendsTemperatureLatest",
            average: "trendsTemperatureAverage",
            minimum: "trendsTemperatureMinimum",
            maximum: "trendsTemperatureMaximum"
        },
        noteId: "trendsNoteTemperature"
    }
];

function filterTrendsByRange(readings, range) {
    if (!Array.isArray(readings) || readings.length === 0) {
        return [];
    }
    if (range === "ALL") {
        return readings.slice();
    }
    const hours = TRENDS_RANGE_HOURS[range];
    if (!hours) {
        return readings.slice();
    }
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return readings.filter((reading) => {
        if (!reading || !reading.recorded_at) {
            return true;
        }
        const timestamp = parseApiTimestamp(reading.recorded_at);
        return Number.isNaN(timestamp) || timestamp >= cutoff;
    });
}

function trendNumericValue(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function formatTrendNumber(value, digits) {
    const number = trendNumericValue(value);
    if (number === null) {
        return "--";
    }
    const resolvedDigits = digits === undefined ? 2 : digits;
    // Presentation only: group thousands for whole-number displays (e.g. TDS "2,500").
    if (resolvedDigits === 0) {
        return Math.round(number).toLocaleString("en-US");
    }
    return number.toFixed(resolvedDigits);
}

function computeTrendStats(readings, key) {
    const values = [];
    readings.forEach((reading) => {
        if (!reading) {
            return;
        }
        const value = trendNumericValue(reading[key]);
        if (value !== null) {
            values.push(value);
        }
    });
    let latest = null;
    if (readings.length > 0) {
        latest = trendNumericValue(readings[readings.length - 1]?.[key]);
    }
    if (values.length === 0) {
        return { latest, average: null, minimum: null, maximum: null, count: 0 };
    }
    const sum = values.reduce((total, value) => total + value, 0);
    return {
        latest,
        average: sum / values.length,
        minimum: Math.min(...values),
        maximum: Math.max(...values),
        count: values.length
    };
}


function parseApiTimestamp(timestampStr) {
    if (!timestampStr) return NaN;
    if (typeof timestampStr === 'number') return timestampStr;
    let str = String(timestampStr).trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
        str += "Z";
    } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
        str = str.replace(" ", "T") + "Z";
    }
    return new Date(str).getTime();
}

/* Parse any backend timestamp into a Date.
 * Backend datetimes are UTC (explicit +00:00/Z, or legacy naive ISO
 * which is UTC by project convention). Constructing Date objects any
 * other way misreads them as local time and shifts displayed times by
 * the browser's UTC offset. Date instances and epoch numbers pass
 * through unchanged. */
function parseApiDate(value) {
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === "number") {
        return new Date(value);
    }
    const time = parseApiTimestamp(value);
    return new Date(time);
}

function formatTrendTime(value) {
    if (!value) {
        return "--";
    }
    const date = new Date(parseApiTimestamp(value));
    if (Number.isNaN(date.getTime())) {
        return "--";
    }
    return date.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    });
}

function showTrendsNotice(type, html) {
    const notice = $("trendsNotice");
    if (!notice) {
        return;
    }
    if (!html) {
        notice.className = "trends-notice hidden";
        notice.innerHTML = "";
        return;
    }
    notice.className = `trends-notice ${type}`;
    notice.innerHTML = html;
    const retryButton = notice.querySelector("[data-trends-retry]");
    if (retryButton) {
        retryButton.addEventListener("click", () => {
            loadTrends({ showLoading: true });
        });
    }
    const allButton = notice.querySelector("[data-trends-view-all]");
    if (allButton) {
        allButton.addEventListener("click", () => {
            const select = $("trendsRangeSelect");
            if (select) {
                select.value = "ALL";
            }
            trendsRange = "ALL";
            renderTrendsPage();
        });
    }
}

function hideTrendsNotice() {
    showTrendsNotice(null, "");
}

function setTrendsLoading(isLoading) {
    document.body.classList.toggle("trends-loading", isLoading);
    const button = $("trendsRefreshButton");
    if (button) {
        button.disabled = isLoading;
        button.classList.toggle("loading", isLoading);
    }
    const select = $("trendsRangeSelect");
    if (select) {
        select.disabled = isLoading;
    }
}

function renderTrendChart(param, readings) {
    const container = $(param.chartId);
    if (!container) {
        return;
    }
    const points = [];
    readings.forEach((reading, index) => {
        const value = trendNumericValue(reading?.[param.key]);
        if (value === null) {
            return;
        }
        const time = parseApiTimestamp(reading?.recorded_at);
        points.push({ value, time, index, recordedAt: reading.recorded_at });
    });

    const note = $(param.noteId);
    if (points.length === 0) {
        container.innerHTML = `
            <div class="trend-chart-empty">
                <i class="ri-line-chart-line"></i>
                <strong>No readings in this period</strong>
                <p>There are no ${escapeHtml(param.label.toLowerCase())} readings available for the selected time range.</p>
            </div>
        `;
        if (note) {
            note.classList.add("hidden");
            note.textContent = "";
        }
        return;
    }

    const values = points.map((point) => point.value);
    let minimum = Math.min(...values);
    let maximum = Math.max(...values);
    if (minimum === maximum) {
        const delta = Math.abs(minimum) * 0.05 || 1;
        minimum -= delta;
        maximum += delta;
    }
    const margin = (maximum - minimum) * 0.15 || 1;
    minimum -= margin;
    maximum += margin;
    // Presentation only: nonnegative measurements (TDS, turbidity,
    // temperature, pH) must never render a negative y-axis baseline.
    if (param.nonnegative) {
        minimum = Math.max(0, minimum);
        if (maximum <= 0) {
            maximum = 1;
        }
    }

    const validTimes = points
        .map((point) => point.time)
        .filter((time) => !Number.isNaN(time));
    const useTimeScale = validTimes.length >= 2;
    const timeMin = useTimeScale ? Math.min(...validTimes) : 0;
    const timeMax = useTimeScale
        ? Math.max(...validTimes, timeMin + 1)
        : 1;

    const width = 700;
    const height = 240;
    const padding = { left: 52, right: 16, top: 14, bottom: 34 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    function xForPoint(point, position) {
        if (points.length === 1) {
            return padding.left + chartWidth / 2;
        }
        if (useTimeScale && !Number.isNaN(point.time)) {
            return padding.left + ((point.time - timeMin) / (timeMax - timeMin)) * chartWidth;
        }
        return padding.left + (position / (points.length - 1)) * chartWidth;
    }

    function yForValue(value) {
        return padding.top + chartHeight - ((value - minimum) / (maximum - minimum)) * chartHeight;
    }

    const coords = points.map((point, position) => ({
        x: xForPoint(point, position),
        y: yForValue(point.value),
        value: point.value,
        recordedAt: point.recordedAt
    }));

    const pathData = coords
        .map((point, position) => `${position === 0 ? "M" : "L"} ${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(" ");

    const gridLines = [0, 1, 2, 3]
        .map((line) => {
            const y = padding.top + (chartHeight / 3) * line;
            const gridValue = maximum - ((maximum - minimum) / 3) * line;
            return { y, label: gridValue };
        });

    const gridSvg = gridLines
        .map((line) => `
            <line x1="${padding.left}" y1="${line.y.toFixed(1)}" x2="${width - padding.right}" y2="${line.y.toFixed(1)}" stroke="var(--chart-grid, #e5eaf1)" stroke-width="1"></line>
            <text x="${padding.left - 8}" y="${(line.y + 4).toFixed(1)}" fill="${themeChartTick()}" font-size="11" text-anchor="end">${escapeHtml(formatTrendNumber(line.label, param.digits))}</text>
        `)
        .join("");

    let tickSvg = "";
    if (points.length === 1) {
        const label = escapeHtml(formatTrendTime(coords[0].recordedAt));
        tickSvg = `<text x="${width / 2}" y="${height - 8}" fill="${themeChartTick()}" font-size="11" text-anchor="middle">${label}</text>`;
    } else if (useTimeScale) {
        const tickCount = Math.min(3, points.length - 1);
        for (let tick = 0; tick <= tickCount; tick += 1) {
            const time = timeMin + ((timeMax - timeMin) / tickCount) * tick;
            const label = escapeHtml(formatTrendTime(new Date(time).toISOString()));
            const x = padding.left + (chartWidth * tick) / tickCount;
            const anchor = tick === 0 ? "start" : tick === tickCount ? "end" : "middle";
            tickSvg += `<text x="${x.toFixed(1)}" y="${height - 8}" fill="${themeChartTick()}" font-size="11" text-anchor="${anchor}">${label}</text>`;
        }
    } else {
        const first = escapeHtml(formatTrendTime(coords[0].recordedAt));
        const last = escapeHtml(formatTrendTime(coords[coords.length - 1].recordedAt));
        tickSvg =
            `<text x="${padding.left}" y="${height - 8}" fill="${themeChartTick()}" font-size="11" text-anchor="start">${first}</text>` +
            `<text x="${width - padding.right}" y="${height - 8}" fill="${themeChartTick()}" font-size="11" text-anchor="end">${last}</text>`;
    }

    const dots = coords
        .map((point) => {
            const tooltip = `${formatTrendTime(point.recordedAt)} — ${param.label}: ${formatTrendNumber(point.value, param.digits)}${param.unit}`;
            return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="${param.color}" stroke="#ffffff" stroke-width="1.5"><title>${escapeHtml(tooltip)}</title></circle>`;
        })
        .join("");

    container.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(param.label)} trend chart">
            ${gridSvg}
            <path d="${pathData}" fill="none" stroke="${param.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
            ${dots}
            ${tickSvg}
        </svg>
    `;

    if (note) {
        if (points.length === 1) {
            note.textContent = "• Only one reading is available for this period.";
            note.classList.remove("hidden");
        } else {
            note.classList.add("hidden");
            note.textContent = "";
        }
    }
}

function renderTrendsPage() {
    const filtered = sortReadingsChronologically(
        filterTrendsByRange(trendsCache, trendsRange)
    );

    if (filtered.length === 0) {
        setText("trendsCount", "0");
        setText("trendsPeriod", "--");
        setText("trendsLastReading", "--");
        TRENDS_PARAMS.forEach((param) => {
            setText(param.statIds.latest, "--");
            setText(param.statIds.average, "--");
            setText(param.statIds.minimum, "--");
            setText(param.statIds.maximum, "--");
            renderTrendChart(param, []);
        });
        if (trendsCache.length === 0) {
            showTrendsNotice(
                "empty",
                `<strong>No sensor readings yet</strong>` +
                    `<ul><li>Connect your device and send a reading.</li>` +
                    `<li>Once data is received, historical trends will appear here.</li></ul>`
            );
        } else {
            showTrendsNotice(
                "empty",
                `<strong>No readings in this period</strong>` +
                    `<ul><li>There are no sensor readings available for the selected time range.</li>` +
                    `<li>Try selecting a longer period.</li></ul>` +
                    `<button class="secondary-button trends-view-all-button" data-trends-view-all type="button">View All Available</button>`
            );
        }
        return;
    }

    hideTrendsNotice();

    const validTimes = filtered
        .map((reading) => (parseApiTimestamp(reading.recorded_at)))
        .filter((time) => !Number.isNaN(time));
    setText("trendsCount", String(filtered.length));
    if (validTimes.length >= 1) {
        const earliest = new Date(Math.min(...validTimes));
        const latestTime = new Date(Math.max(...validTimes));
        setText(
            "trendsPeriod",
            `${formatTrendTime(earliest.toISOString())} → ${formatTrendTime(latestTime.toISOString())}`
        );
        setText("trendsLastReading", formatTrendTime(latestTime.toISOString()));
    } else {
        setText("trendsPeriod", `${filtered.length} reading(s) without timestamps`);
        setText("trendsLastReading", "--");
    }

    TRENDS_PARAMS.forEach((param) => {
        const stats = computeTrendStats(filtered, param.key);
        const suffix = param.unit || "";
        const formatStat = (value) =>
            value === null
                ? "--"
                : param.useTempDisplay
                  ? formatTempDisplay(value, param.digits)
                  : `${formatTrendNumber(value, param.digits)}${suffix}`;
        setText(param.statIds.latest, formatStat(stats.latest));
        setText(param.statIds.average, formatStat(stats.average));
        setText(param.statIds.minimum, formatStat(stats.minimum));
        setText(param.statIds.maximum, formatStat(stats.maximum));
        renderTrendChart(param, filtered);
    });
}

async function loadTrends(options = {}) {
    const showLoading = options.showLoading !== false;
    if (trendsLoading) {
        return;
    }
    trendsLoading = true;
    if (showLoading) {
        setTrendsLoading(true);
    }
    try {
        const data = await apiRequest("/readings/?limit=1000");
        trendsCache = normalizeReadings(data);
        trendsLoadedOnce = true;
        renderTrendsPage();
    } catch (error) {
        if (trendsCache.length > 0) {
            renderTrendsPage();
            showTrendsNotice(
                "error",
                `<strong>Refresh failed — showing previous data</strong>` +
                    `<ul><li>Sensor history could not be retrieved.</li>` +
                    `<li>Please try again.</li></ul>` +
                    `<button class="secondary-button trends-retry-button" data-trends-retry type="button">` +
                    `<i class="ri-refresh-line"></i>Retry</button>`
            );
        } else {
            ["trendsCount", "trendsLastReading"].forEach((id) => setText(id, "--"));
            setText("trendsPeriod", "--");
            TRENDS_PARAMS.forEach((param) => {
                setText(param.statIds.latest, "--");
                setText(param.statIds.average, "--");
                setText(param.statIds.minimum, "--");
                setText(param.statIds.maximum, "--");
                const container = $(param.chartId);
                if (container) {
                    container.innerHTML = "";
                }
            });
            showTrendsNotice(
                "error",
                `<strong>Unable to load trends</strong>` +
                    `<ul><li>Sensor history could not be retrieved.</li>` +
                    `<li>Please try again.</li></ul>` +
                    `<button class="secondary-button trends-retry-button" data-trends-retry type="button">` +
                    `<i class="ri-refresh-line"></i>Retry</button>`
            );
        }
    } finally {
        trendsLoading = false;
        setTrendsLoading(false);
    }
}

function setupTrendsPage() {
    const select = $("trendsRangeSelect");
    if (select && !select.dataset.trendsReady) {
        select.dataset.trendsReady = "true";
        select.value = trendsRange;
        select.addEventListener("change", () => {
            trendsRange = select.value || "24H";
            renderTrendsPage();
        });
    }
    const refreshButton = $("trendsRefreshButton");
    if (refreshButton && !refreshButton.dataset.trendsReady) {
        refreshButton.dataset.trendsReady = "true";
        refreshButton.addEventListener("click", () => {
            loadTrends({ showLoading: true });
        });
    }
}

/* =========================================================
   DEVICE PAGE — ESP32/data activity from ACTUAL backend data
   Reports DATA ACTIVITY only (never physical connectivity):
   Data Active / Data Stale / No Readings / Backend Unavailable.
   Uses existing GET /devices/ and GET /readings/ endpoints.
   ========================================================= */

let devicePageDevices = [];
let devicePageSelectedId = null;
let devicePageReadings = [];
let deviceRefreshing = false;
let deviceLoadedOnce = false;

const DEVICE_STALE_HOURS = 24;
const DEVICE_READINGS_LIMIT = 1000;

function deviceNumericValue(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function formatDeviceNumber(value, digits) {
    const number = deviceNumericValue(value);
    if (number === null) {
        return null;
    }
    return number.toFixed(digits === undefined ? 2 : digits);
}

function formatDeviceTime(value) {
    if (!value) {
        return "--";
    }
    const date = parseApiDate(value);
    if (Number.isNaN(date.getTime())) {
        return "--";
    }
    return date.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    });
}

function formatDeviceShortTime(value) {
    if (!value) {
        return "--";
    }
    const date = parseApiDate(value);
    if (Number.isNaN(date.getTime())) {
        return "--";
    }
    return date.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    });
}

function showDeviceNotice(type, html) {
    const notice = $("deviceNotice");
    if (!notice) {
        return;
    }
    if (!html) {
        notice.className = "device-notice hidden";
        notice.innerHTML = "";
        return;
    }
    notice.className = `device-notice ${type}`;
    notice.innerHTML = html;
    const retryButton = notice.querySelector("[data-device-retry]");
    if (retryButton) {
        retryButton.addEventListener("click", () => {
            loadDevicePage({ showLoading: true });
        });
    }
}

function hideDeviceNotice() {
    showDeviceNotice(null, "");
}

function setDeviceLoading(isLoading) {
    document.body.classList.toggle("device-loading", isLoading);
    const button = $("deviceRefreshButton");
    if (button) {
        button.disabled = isLoading;
        button.classList.toggle("loading", isLoading);
    }
    const select = $("deviceSelector");
    if (select) {
        select.disabled = isLoading;
    }
}

function deviceDataStatus(latest) {
    if (!latest || !latest.recorded_at) {
        return "none";
    }
    const time = parseApiDate(latest.recorded_at).getTime();
    if (Number.isNaN(time)) {
        return "none";
    }
    const ageHours = (Date.now() - time) / (1000 * 60 * 60);
    return ageHours > DEVICE_STALE_HOURS ? "stale" : "active";
}

function parseDevicesPayload(data) {
    if (Array.isArray(data)) {
        return data;
    }
    if (Array.isArray(data?.devices)) {
        return data.devices;
    }
    if (Array.isArray(data?.items)) {
        return data.items;
    }
    return [];
}

function renderDeviceSelector(devices) {
    const select = $("deviceSelector");
    if (!select) {
        return;
    }
    select.innerHTML = "";
    devices.forEach((device) => {
        if (!device) {
            return;
        }
        const option = document.createElement("option");
        option.value = String(device.id);
        option.textContent = device.name || `Device ${device.id}`;
        select.appendChild(option);
    });
    if (devicePageSelectedId !== null && devicePageSelectedId !== undefined) {
        select.value = String(devicePageSelectedId);
    }
    select.classList.toggle("hidden", devices.length <= 1);
}

function renderDeviceStatus(device, latest, readingsAvailable) {
    const badge = $("deviceDataBadge");
    const message = $("deviceStatusMessage");
    if (!badge) {
        return "unknown";
    }
    badge.classList.remove("safe", "watch", "alert", "unknown");
    let state = "unknown";
    if (!readingsAvailable) {
        state = "unavailable";
        badge.textContent = "BACKEND UNAVAILABLE";
        badge.classList.add("alert");
        setText("deviceLastReading", "--");
        if (message) {
            message.textContent = "Device information could not be retrieved.";
        }
    } else if (!latest) {
        state = "none";
        badge.textContent = "NO READINGS";
        badge.classList.add("unknown");
        setText("deviceLastReading", "--");
        if (message) {
            message.textContent = "No sensor data has been received from this device yet.";
        }
    } else {
        const status = deviceDataStatus(latest);
        setText("deviceLastReading", formatDeviceTime(latest.recorded_at));
        if (status === "active") {
            state = "active";
            badge.textContent = "DATA ACTIVE";
            badge.classList.add("safe");
            if (message) {
                message.textContent = "Data received recently from this device.";
            }
        } else if (status === "stale") {
            state = "stale";
            badge.textContent = "DATA STALE";
            badge.classList.add("watch");
            if (message) {
                message.textContent = "No recent sensor reading has been received.";
            }
        } else {
            state = "none";
            badge.textContent = "NO READINGS";
            badge.classList.add("unknown");
            if (message) {
                message.textContent = "No sensor data has been received from this device yet.";
            }
        }
    }
    return state;
}

function renderDeviceInfo(device) {
    if (!device) {
        setText("deviceInfoName", "--");
        setText("deviceInfoId", "--");
        setText("deviceInfoType", "--");
        setText("deviceInfoLocation", "--");
        return;
    }
    setText("deviceInfoName", device.name || `Device ${device.id}`, "--");
    setText("deviceInfoId", device.id === null || device.id === undefined ? "--" : String(device.id));
    setText("deviceInfoType", device.device_type || device.type || "ESP32", "--");
    setText("deviceInfoLocation", device.location || "Location unavailable", "--");
}

function renderDeviceSensors(latest, readingsAvailable) {
    const specs = [
        { id: "devicePh", key: "ph", digits: 2, unit: "" },
        { id: "deviceTds", key: "tds", digits: 0, unit: " mg/L", useTemp: false },
        { id: "deviceTurbidity", key: "turbidity", digits: 2, unit: " NTU", useTemp: false },
        { id: "deviceTemperature", key: "temperature", digits: 1, unit: "", useTemp: true }
    ];
    specs.forEach((spec) => {
        if (spec.useTemp) {
            setText(spec.id, formatTempDisplay(latest ? latest[spec.key] : null, spec.digits));
            return;
        }
        const formatted = latest ? formatDeviceNumber(latest[spec.key], spec.digits) : null;
        if (formatted === null) {
            setText(spec.id, readingsAvailable ? "Not available" : "--");
        } else {
            setText(spec.id, `${formatted}${spec.unit}`);
        }
    });
}

function renderDeviceActivity(readings) {
    const rows = Array.isArray(readings) ? readings : [];
    if (rows.length === 0) {
        setText("deviceTotalReadings", "--");
        setText("deviceFirstReading", "--");
        setText("deviceLatestReading", "--");
        setText("deviceLast24h", "--");
        return;
    }
    const validTimes = rows
        .map((reading) => (parseApiTimestamp(reading?.recorded_at)))
        .filter((time) => !Number.isNaN(time));
    const capped = rows.length >= DEVICE_READINGS_LIMIT;
    setText("deviceTotalReadings", capped ? `${rows.length}+` : String(rows.length));
    if (validTimes.length > 0) {
        const earliest = new Date(Math.min(...validTimes));
        const latestTime = new Date(Math.max(...validTimes));
        setText("deviceFirstReading", formatDeviceTime(earliest.toISOString()));
        setText("deviceLatestReading", formatDeviceTime(latestTime.toISOString()));
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const recent = validTimes.filter((time) => time >= cutoff).length;
        setText("deviceLast24h", String(recent));
    } else {
        setText("deviceFirstReading", "--");
        setText("deviceLatestReading", "--");
        setText("deviceLast24h", String(0));
    }
}

function renderDeviceRecent(readings) {
    const body = $("deviceRecentBody");
    if (!body) {
        return;
    }
    const rows = Array.isArray(readings) ? readings.slice(0, 8) : [];
    if (rows.length === 0) {
        body.innerHTML = `<tr class="recent-empty-row"><td colspan="5">No readings yet</td></tr>`;
        return;
    }
    body.innerHTML = rows
        .map((reading) => {
            const time = escapeHtml(formatDeviceShortTime(reading?.recorded_at));
            const ph = escapeHtml(formatDeviceNumber(reading?.ph, 2) ?? "--");
            const tdsValue = formatDeviceNumber(reading?.tds, 0);
            const tds = escapeHtml(tdsValue === null ? "--" : tdsValue);
            const turbidity = escapeHtml(formatDeviceNumber(reading?.turbidity, 2) ?? "--");
            const tempValue = formatTempDisplay(reading?.temperature, 1);
            const temp = escapeHtml(tempValue === "--" ? "--" : tempValue);
            return `<tr><td>${time}</td><td>${ph}</td><td>${tds}</td><td>${turbidity}</td><td>${temp}</td></tr>`;
        })
        .join("");
}

function renderDevicePage() {
    const devices = devicePageDevices;
    if (devices.length === 0) {
        renderDeviceInfo(null);
        renderDeviceStatus(null, null, true);
        renderDeviceSensors(null, true);
        renderDeviceActivity([]);
        renderDeviceRecent([]);
        showDeviceNotice(
            "empty",
            `<strong>No devices registered</strong>` +
                `<ul><li>No ESP32/device is registered in the backend yet.</li>` +
                `<li>Add a device to begin monitoring.</li></ul>`
        );
        return;
    }
    const device = devices.find((item) => item && String(item.id) === String(devicePageSelectedId)) || devices[0];
    devicePageSelectedId = device ? device.id : null;
    renderDeviceSelector(devices);
    const readings = devicePageReadings;
    const latest = readings.length > 0 ? readings[0] : null;
    const state = deviceDataStatus(latest);

    renderDeviceInfo(device);
    renderDeviceStatus(device, latest, true);
    renderDeviceSensors(latest, true);
    renderDeviceActivity(readings);
    renderDeviceRecent(readings);
    hideDeviceNotice();

    if (state === "none") {
        showDeviceNotice(
            "empty",
            `<strong>No readings for this device</strong>` +
                `<ul><li>The device is registered, but no sensor readings have been received yet.</li>` +
                `<li>Send a reading from the ESP32 to begin monitoring.</li></ul>`
        );
    } else if (state === "stale") {
        showDeviceNotice(
            "stale",
            `<strong>Data may be stale</strong>` +
                `<ul><li>Last reading: ${escapeHtml(formatDeviceTime(latest?.recorded_at))}.</li>` +
                `<li>Values are shown as measured — send a new reading for current conditions.</li></ul>`
        );
    }
}

function renderDeviceOffline() {
    renderDeviceStatus(null, null, false);
    renderDeviceSensors(null, false);
    showDeviceNotice(
        "error",
        `<strong>Unable to load device data</strong>` +
            `<ul><li>The Aqua Sense backend could not be reached.</li>` +
            `<li>Please try again.</li></ul>` +
            `<button class="secondary-button device-retry-button" data-device-retry type="button">` +
            `<i class="ri-refresh-line"></i>Retry</button>`
    );
}

async function loadDevicePage(options = {}) {
    const showLoading = options.showLoading !== false;
    if (deviceRefreshing) {
        return;
    }
    deviceRefreshing = true;
    if (showLoading) {
        setDeviceLoading(true);
    }
    try {
        const devicesData = await apiRequest("/devices/");
        const devices = parseDevicesPayload(devicesData);
        devicePageDevices = devices;
        if (devices.length === 0) {
            devicePageSelectedId = null;
            devicePageReadings = [];
            deviceLoadedOnce = true;
            renderDevicePage();
            return;
        }
        const stillExists = devices.some((item) => item && String(item.id) === String(devicePageSelectedId));
        if (devicePageSelectedId === null || devicePageSelectedId === undefined || !stillExists) {
            if (latestDevice && devices.some((item) => item && String(item.id) === String(latestDevice.id))) {
                devicePageSelectedId = latestDevice.id;
            } else {
                devicePageSelectedId = devices[0].id;
            }
        }
        try {
            const readingsData = await apiRequest(
                `/readings/?device_id=${encodeURIComponent(String(devicePageSelectedId))}&limit=${DEVICE_READINGS_LIMIT}`
            );
            devicePageReadings = normalizeReadings(readingsData);
        } catch (readingsError) {
            devicePageReadings = [];
            deviceLoadedOnce = true;
            renderDevicePage();
            renderDeviceSensors(null, false);
            renderDeviceOffline();
            return;
        }
        deviceLoadedOnce = true;
        renderDevicePage();
    } catch (error) {
        if (devicePageDevices.length > 0) {
            renderDevicePage();
        } else {
            renderDeviceInfo(null);
            renderDeviceSensors(null, false);
            renderDeviceActivity([]);
            renderDeviceRecent([]);
            const select = $("deviceSelector");
            if (select) {
                select.classList.add("hidden");
            }
        }
        renderDeviceOffline();
    } finally {
        deviceRefreshing = false;
        setDeviceLoading(false);
    }
}

function setupDevicePage() {
    const refreshButton = $("deviceRefreshButton");
    if (refreshButton && !refreshButton.dataset.deviceReady) {
        refreshButton.dataset.deviceReady = "true";
        refreshButton.addEventListener("click", () => {
            loadDevicePage({ showLoading: true });
        });
    }
    const select = $("deviceSelector");
    if (select && !select.dataset.deviceReady) {
        select.dataset.deviceReady = "true";
        select.addEventListener("change", () => {
            const value = select.value;
            devicePageSelectedId = value === "" ? null : (Number.isNaN(Number(value)) ? value : Number(value));
            loadDevicePage({ showLoading: true });
        });
    }
}

function renderReadingsTable(readings) {
    const body =
        $("readingsTableBody") ||
        $("readingsBody") ||
        query("tbody[data-readings]");

    if (!body) {
        return;
    }

    body.innerHTML = "";

    const rows = readings.slice(0, 50);

    if (rows.length === 0) {
        body.innerHTML = `
            <tr>
                <td colspan="7">No readings available</td>
            </tr>
        `;
        return;
    }

    rows.forEach((reading) => {
        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${safeText(reading.id)}</td>
            <td>${safeText(reading.device_id)}</td>
            <td>${formatNumber(reading.temperature, 1)}</td>
            <td>${formatNumber(reading.ph, 2)}</td>
            <td>${formatNumber(reading.turbidity, 2)}</td>
            <td>${formatNumber(reading.tds, 2)}</td>
            <td>${formatDate(reading.recorded_at)}</td>
        `;

        body.appendChild(row);
    });
}

function setupNavigation() {
    const navigationItems = document.querySelectorAll(
        ".nav-item[data-page], [data-page-target], [data-action='navigate']"
    );

    navigationItems.forEach((item) => {
        if (item.dataset.navigationReady === "true") {
            return;
        }

        item.dataset.navigationReady = "true";

        item.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();

            const targetPage =
                item.dataset.page ||
                item.dataset.pageTarget ||
                item.getAttribute("href");

            if (targetPage) {
                navigateTo(targetPage);
            }
        });
    });
}
function normalizePageName(pageName) {
    return String(pageName || "")
        .replace(/^#/, "")
        .replace(/^page-/, "")
        .trim()
        .toLowerCase();
}

async function navigateTo(pageName) {
    let page = normalizePageName(pageName);

    if (!page) {
        return;
    }

    const knownPages = new Set([
        "dashboard", "chat",
        "camera", "analysis", "trends", "device",
        "reports", "settings", "profile", "alerts"
    ]);

    if (!knownPages.has(page)) {
        page = "dashboard";
    }

    if (page !== "camera" && typeof stopCameraStream === "function") {
        stopCameraStream();
    }

    currentPage = page;

    const pageSections = document.querySelectorAll(
        ".page-section, .page, [data-page-section], section[id^='page-']"
    );

    pageSections.forEach((section) => {
        const sectionName = normalizePageName(
            section.dataset.pageSection ||
            section.dataset.page ||
            section.id
        );

        const isActive = sectionName === page || (page === "chat" && sectionName === "dashboard");

        section.classList.toggle("active", isActive);

        if (isActive) {
            section.removeAttribute("hidden");
            section.style.display = "";
        } else {
            section.setAttribute("hidden", "hidden");
            section.style.display = "none";
        }
    });

    const navigationItems = document.querySelectorAll(
        ".nav-item[data-page], [data-page-target], [data-action='navigate']"
    );

    navigationItems.forEach((item) => {
        const targetPage = normalizePageName(
            item.dataset.page ||
            item.dataset.pageTarget ||
            item.getAttribute("href")
        );

        item.classList.toggle("active", targetPage === page);
    });

    const pageHeadings = {
        dashboard: [
            "Water Quality Dashboard",
            "Monitor your water-quality readings in real time."
        ],
        camera: [
            "Camera Analysis",
            "Upload or capture a water image to screen visible water characteristics."
        ],
        chat: [
            "AI Assistant",
            "Ask questions about your water-quality readings and sensors."
        ],
        device: [
            "Device Management",
            "View and manage connected water-quality devices."
        ],
        trends: [
            "Trends and History",
            "Explore historical sensor readings."
        ],
        analysis: [
            "Water Quality Analysis",
            "Review sensor-based quality insights."
        ],
        settings: [
            "Settings",
            "Manage your connection and analysis preferences."
        ],
        reports: [
            "Water Quality Reports",
            "Review water-quality readings and summaries from your connected device."
        ],
        profile: [
            "Profile",
            "View local monitoring preferences and application information."
        ],
        alerts: [
            "Alert Notifications",
            "Automatic water-quality threshold alerts and real-time cooldown."
        ]
    };

    if (pageHeadings[page]) {
        setText("pageTitle", pageHeadings[page][0]);
        setText("pageDescription", pageHeadings[page][1]);
    }

    const pageLabels = {
        dashboard: "Dashboard",
        camera: "Camera",
        chat: "AI Chat",
        device: "Device",
        trends: "Trends",
        analysis: "Analysis",
        settings: "Settings",
        reports: "Reports",
        profile: "Profile",
        alerts: "Alerts"
    };

    setText("breadcrumbCurrent", pageLabels[page] || "Dashboard");

    if (window.location.hash !== `#${page}`) {
        history.replaceState(null, "", `#${page}`);
    }

    if (typeof closeMobileSidebar === "function") {
        closeMobileSidebar();
    }

    if (page === "chat") {
        setTimeout(() => {
            const chatCard = query(".sensor-chatbot-card") || $("sensorChatForm");
            if (chatCard) {
                chatCard.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            const chatInput = $("sensorChatInput");
            if (chatInput) {
                chatInput.focus();
            }
        }, 80);
    }

    if (page === "trends") {
        if (typeof setupTrendsPage === "function") {
            setupTrendsPage();
        }

        if (typeof loadTrends === "function") {
            if (!trendsLoadedOnce && !trendsLoading) {
                loadTrends({ showLoading: true });
            } else if (typeof renderTrendsPage === "function") {
                renderTrendsPage();
            }
        }
    }

    if (page === "device") {
        if (typeof setupDevicePage === "function") {
            setupDevicePage();
        }

        if (typeof loadDevicePage === "function") {
            if (!deviceLoadedOnce && !deviceRefreshing) {
                loadDevicePage({ showLoading: true });
            } else if (typeof renderDevicePage === "function" && devicePageDevices.length > 0) {
                renderDevicePage();
            }
        }
    }

    if (page === "analysis") {
        if (typeof loadAnalysisLatestReading === "function") {
            await loadAnalysisLatestReading();
        }
        if (typeof updateAnalysisPage === "function") {
            updateAnalysisPage();
        }
        if (typeof setupAnalysisTabs === "function") {
            setupAnalysisTabs();
        }
    }

    if (page === "reports") {
        if (typeof renderReportPage === "function") {
            renderReportPage();
        }
    }

    if (page === "settings") {
        if (typeof renderSettingsState === "function") {
            renderSettingsState();
        }
    }

    if (page === "profile") {
        if (typeof renderProfilePage === "function") {
            renderProfilePage();
        }
    }

    if (page === "alerts") {
        if (typeof loadCurrentStatus === "function") loadCurrentStatus();
        if (typeof loadAlerts === "function") loadAlerts();
        if (typeof loadContacts === "function") loadContacts();
        if (typeof loadProviderStatus === "function") loadProviderStatus();
        if (typeof loadAlertConfig === "function") loadAlertConfig();
        if (typeof loadAutoStatus === "function") loadAutoStatus();
    }
}
function setupMobileMenu() {
    const menuButton =
        $("mobileMenuButton") ||
        $("mobileMenuBtn") ||
        query(".mobile-menu-btn");

    const sidebar =
        $("sidebar") ||
        query(".sidebar");

    const overlay =
        $("sidebarOverlay") ||
        query(".sidebar-overlay");

    if (!menuButton || !sidebar) {
        return;
    }

    menuButton.addEventListener("click", () => {
        sidebar.classList.toggle("open");

        if (overlay) {
            overlay.classList.toggle(
                "visible",
                sidebar.classList.contains("open")
            );
        }
    });

    if (overlay) {
        overlay.addEventListener("click", closeMobileSidebar);
    }
}

function closeMobileSidebar() {
    const sidebar =
        $("sidebar") ||
        query(".sidebar");

    const overlay =
        $("sidebarOverlay") ||
        query(".sidebar-overlay");

    sidebar?.classList.remove("open");
    overlay?.classList.remove("visible");
}

function setupRangeFilters() {
    const buttons = queryAll(
        ".filter-btn, [data-range]"
    );

    buttons.forEach((button) => {
        const range =
            button.dataset.range ||
            button.textContent.trim().toUpperCase();

        if (!["1H", "6H", "24H", "7D", "30D", "ALL"].includes(range)) {
            return;
        }

        button.addEventListener("click", () => {
            currentRange = range;

            buttons.forEach((item) => {
                const itemRange =
                    item.dataset.range ||
                    item.textContent.trim().toUpperCase();

                if (["1H", "6H", "24H", "7D", "30D", "ALL"].includes(itemRange)) {
                    item.classList.toggle(
                        "active",
                        itemRange === currentRange
                    );
                }
            });

            drawTrendChart(readingsCache);
            setupReports();
        });
    });

    // The markup highlights 1H by default while the chart state starts at
    // 24H — sync the buttons to the real state so the timeline label never
    // disagrees with the plotted window.
    buttons.forEach((item) => {
        const itemRange =
            item.dataset.range ||
            item.textContent.trim().toUpperCase();

        if (["1H", "6H", "24H", "7D", "30D", "ALL"].includes(itemRange)) {
            item.classList.toggle(
                "active",
                itemRange === currentRange
            );
        }
    });

    const parameterSelect =
        $("trendParameterSelect");

    if (parameterSelect) {
        parameterSelect.value = trendParameter;
        parameterSelect.addEventListener("change", () => {
            trendParameter = parameterSelect.value || "quality";
            updateTrendChartHeading();
            drawTrendChart(readingsCache);
        });
    }
}

function updateTrendChartHeading() {
    const parameter =
        trendParameter === "quality"
            ? "Quality score"
            : trendsParameterTitle(trendParameter);

    setText(
        "trendChartTitle",
        `${parameter} trend`
    );

    const descriptions = {
        quality: "Historical quality score data.",
        temperature: "Historical temperature readings in °C.",
        ph: "Historical pH readings.",
        turbidity: "Historical turbidity readings in NTU.",
        tds: "Historical TDS readings in mg/L."
    };

    setText(
        "trendChartDescription",
        descriptions[trendParameter] || "Historical sensor data."
    );
}

function setupRefreshButton() {
    const buttons = queryAll(
        "#refreshButton, #manualRefresh, #globalRefreshButton, #dashboardRefreshButton, [data-action='refresh']"
    );

    buttons.forEach((button) => {
        button.addEventListener("click", refreshDashboard);
    });
}

function setupSettings() {
    const apiInput =
        $("backendUrlInput") ||
        $("apiBaseUrl") ||
        $("apiUrl") ||
        $("backendUrl");

    const backendForm = $("backendSettingsForm");

    if (apiInput) {
        apiInput.value = getApiBaseUrl();
    }

    if (backendForm && apiInput) {
        backendForm.addEventListener("submit", (event) => {
            event.preventDefault();

            const value = apiInput.value.trim();

            if (!value) {
                alert("Please enter a valid server address.");
                return;
            }

            const normalized = value.replace(/\/+$/, "");

            localStorage.setItem(
                "aqua_api_url",
                normalized
            );

            API_BASE_URL = normalized;

            alert("Connection saved. The page will reload.");
            window.location.reload();
        });
    }

    const providerSelect =
        $("aiProviderSelect") ||
        $("aiProvider") ||
        $("providerSelect");

    const modelInput =
        $("aiModelInput") ||
        $("aiModel") ||
        $("modelInput");

    const aiForm = $("aiSettingsForm");

    if (providerSelect) {
        providerSelect.value =
            localStorage.getItem("aqua_ai_provider") ||
            providerSelect.value ||
            "auto";

        providerSelect.addEventListener("change", () => {
            localStorage.setItem(
                "aqua_ai_provider",
                providerSelect.value
            );
        });
    }

    if (modelInput) {
        modelInput.value =
            localStorage.getItem("aqua_ai_model") ||
            modelInput.value ||
            "";

        modelInput.addEventListener("change", () => {
            localStorage.setItem(
                "aqua_ai_model",
                modelInput.value
            );
        });
    }

    if (aiForm) {
        aiForm.addEventListener("submit", (event) => {
            event.preventDefault();

            if (providerSelect) {
                localStorage.setItem(
                    "aqua_ai_provider",
                    providerSelect.value
                );
            }

            if (modelInput) {
                localStorage.setItem(
                    "aqua_ai_model",
                    modelInput.value.trim()
                );
            }

            alert("Preferences saved.");
        });
    }

    // Populate provider options from the live backend configuration.
    (async function populateProviderOptions() {
        try {
            const data = await apiRequest("/ai/providers");
            const providers = data?.providers;
            if (providers && providerSelect) {
                // Remove existing options except the first (auto).
                while (providerSelect.options.length > 1) {
                    providerSelect.remove(1);
                }
                for (const p of providers) {
                    const option = document.createElement("option");
                    option.value = p.id;
                    option.textContent =
                        p.name + (p.available ? "" : " (unavailable)");
                    if (p.available) {
                        option.title = p.model || "";
                    }
                    providerSelect.appendChild(option);
                }
                const stored = localStorage.getItem("aqua_ai_provider");
                if (stored && [...providerSelect.options].some((o) => o.value === stored)) {
                    providerSelect.value = stored;
}
}

        } catch (error) {
            console.warn("Could not load AI providers:", error.message);
        }
    })();

    

    const autoRefreshToggle = $("autoRefreshToggle");

    if (autoRefreshToggle) {
        autoRefreshToggle.addEventListener("change", () => {
            if (autoRefreshToggle.checked) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });
    }

    const chatHistoryToggle = $("chatHistoryToggle");

    if (chatHistoryToggle && !chatHistoryToggle.checked) {
        try {
            sessionStorage.removeItem("aqua_ai_chat_history");
            sessionStorage.removeItem("aqua_ai_camera_chat_history");
        } catch (error) {
            // Browsers may block storage access; ignore.
        }
    }
}

function setupAddDevice() {
    const modal = $("addDeviceModal");
    const form = $("addDeviceForm");
    const openButton = $("addDeviceButton");
    const closeButton = $("closeAddDeviceModal");
    const cancelButton = $("cancelAddDeviceButton");
    const nameInput = $("newDeviceName");
    const typeInput = $("newDeviceType");
    const locationInput = $("newDeviceLocation");

    if (!form) {
        return;
    }

    // Open modal
    if (openButton) {
        openButton.addEventListener("click", () => {
            if (modal) {
                modal.classList.remove("hidden");
            }
        });
    }

    // Close modal helpers
    function closeModal() {
        if (modal) {
            modal.classList.add("hidden");
        }
        if (form) {
            form.reset();
        }
    }

    if (closeButton) {
        closeButton.addEventListener("click", closeModal);
    }

    if (cancelButton) {
        cancelButton.addEventListener("click", closeModal);
    }

    // Close on backdrop click
    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                closeModal();
            }
        });
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const name = (nameInput?.value || "").trim();
        if (!name) {
            alert("Device name is required.");
            return;
        }

        const payload = {
            name,
            device_type: (typeInput?.value || "ESP32").trim(),
            location: (locationInput?.value || "").trim() || null,
        };

        try {
            await apiRequest("/devices/", {
                method: "POST",
                body: JSON.stringify(payload),
            });

            alert("Device added successfully.");
            closeModal();
            await loadDevices();
            await refreshDashboard();
        } catch (error) {
            alert(`Unable to add device: ${error.message}`);
        }
    });
}
function setupDeviceDelete() {
    const modal = $("deleteDeviceModal");
    const message = $("deleteDeviceMessage");
    const openButton = $("deleteDeviceButton");
    const closeButton = $("closeDeleteDeviceModal");
    const cancelButton = $("cancelDeleteDeviceButton");
    const confirmButton = $("confirmDeleteDeviceButton");

    if (!openButton || !modal || !confirmButton) {
        return;
    }

    function selectedDeviceForDelete() {
        const devices = devicePageDevices;
        if (!devices || devices.length === 0) {
            return null;
        }
        return (
            devices.find(
                (item) => item && String(item.id) === String(devicePageSelectedId)
            ) || devices[0]
        );
    }

    function closeModal() {
        modal.classList.add("hidden");
    }

    openButton.addEventListener("click", () => {
        const device = selectedDeviceForDelete();
        if (!device) {
            alert("No device selected.");
            return;
        }
        const label = device.name || `Device ${device.id}`;
        if (message) {
            message.textContent =
                `Delete "${label}" (ID ${device.id})? ` +
                "This will permanently remove the device, its readings, and its camera predictions. " +
                "Alert history is kept, with the device reference cleared.";
        }
        modal.classList.remove("hidden");
    });

    if (closeButton) {
        closeButton.addEventListener("click", closeModal);
    }

    if (cancelButton) {
        cancelButton.addEventListener("click", closeModal);
    }

    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });

    confirmButton.addEventListener("click", async () => {
        const device = selectedDeviceForDelete();
        if (!device) {
            closeModal();
            return;
        }
        const deletedId = device.id;
        confirmButton.disabled = true;
        try {
            await apiRequest(`/devices/${encodeURIComponent(String(deletedId))}`, {
                method: "DELETE",
            });
            closeModal();
            devicePageDevices = devicePageDevices.filter(
                (item) => item && String(item.id) !== String(deletedId)
            );
            if (String(devicePageSelectedId) === String(deletedId)) {
                devicePageSelectedId =
                    devicePageDevices.length > 0 ? devicePageDevices[0].id : null;
            }
            if (latestDevice && String(latestDevice.id) === String(deletedId)) {
                latestDevice =
                    devicePageDevices.length > 0 ? devicePageDevices[0] : null;
            }
            if (latestReading && String(latestReading.device_id) === String(deletedId)) {
                latestReading = null;
            }
            devicePageReadings = [];
            deviceLoadedOnce = false;
            await loadDevicePage({ showLoading: true });
            await refreshDashboard();
        } catch (error) {
            alert(`Unable to delete device: ${error.message}`);
        } finally {
            confirmButton.disabled = false;
        }
    });
}
function setupDeviceRename() {
    const modal = $("renameDeviceModal");
    const form = $("renameDeviceForm");
    const nameInput = $("renameDeviceName");
    const errEl = $("renameDeviceFormError");
    const openButton = $("renameDeviceButton");
    const closeButton = $("closeRenameDeviceModal");
    const cancelButton = $("cancelRenameDeviceButton");
    const saveButton = $("saveRenameDeviceButton");

    if (!openButton || !modal || !form) {
        return;
    }

    function selectedDeviceForRename() {
        const devices = devicePageDevices;
        if (!devices || devices.length === 0) {
            return null;
        }
        return (
            devices.find(
                (item) => item && String(item.id) === String(devicePageSelectedId)
            ) || devices[0]
        );
    }

    function closeModal() {
        modal.classList.add("hidden");
        modal.style.display = "none";
    }

    openButton.addEventListener("click", () => {
        const device = selectedDeviceForRename();
        if (!device) {
            showToast("No device selected.", "error");
            return;
        }
        if (nameInput) {
            nameInput.value = device.name || "";
        }
        if (errEl) {
            errEl.textContent = "";
        }
        modal.classList.remove("hidden");
        modal.style.display = "flex";
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
    });

    if (closeButton) {
        closeButton.addEventListener("click", closeModal);
    }

    if (cancelButton) {
        cancelButton.addEventListener("click", closeModal);
    }

    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const device = selectedDeviceForRename();
        if (!device) {
            closeModal();
            return;
        }
        const name = nameInput ? nameInput.value.trim() : "";
        if (!name) {
            if (errEl) {
                errEl.textContent = "Device name must not be empty.";
            } else {
                showToast("Device name must not be empty.", "error");
            }
            return;
        }
        if (saveButton) {
            saveButton.disabled = true;
        }
        if (errEl) {
            errEl.textContent = "";
        }
        try {
            await apiRequest(`/devices/${encodeURIComponent(String(device.id))}`, {
                method: "PUT",
                body: JSON.stringify({ name })
            });
            closeModal();
            showToast(`Device renamed to "${name}".`, "success");
            await loadDevicePage({ showLoading: true });
            await refreshDashboard();
        } catch (error) {
            if (errEl) {
                errEl.textContent = error.message || "Unable to rename device.";
            } else {
                showToast(error.message || "Unable to rename device.", "error");
            }
        } finally {
            if (saveButton) {
                saveButton.disabled = false;
            }
        }
    });
}
function setupReadingForm() {
    const form =
        $("readingForm") ||
        $("sensorReadingForm");

    if (!form) {
        return;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const formData = new FormData(form);

        const payload = {
            device_id: Number(
                formData.get("device_id") ||
                formData.get("deviceId") ||
                latestDevice?.id ||
                1
            ),
            temperature: parseOptionalNumber(
                formData.get("temperature")
            ),
            ph: parseOptionalNumber(
                formData.get("ph")
            ),
            turbidity: parseOptionalNumber(
                formData.get("turbidity")
            ),
            tds: parseOptionalNumber(
                formData.get("tds")
            )
        };

        try {
            await apiRequest("/readings/", {
                method: "POST",
                body: JSON.stringify(payload)
            });

            alert("Reading saved successfully.");
            form.reset();
            await refreshDashboard();
        } catch (error) {
            alert(`Unable to save reading: ${error.message}`);
        }
    });
}

function parseOptionalNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}

function setupCameraUpload() {
    const input =
        $("cameraFileInput") ||
        $("cameraInput") ||
        $("imageInput");

    const dropzone =
        $("cameraDropzone") ||
        query(".camera-dropzone");

    const preview =
        $("cameraPreviewImage") ||
        $("imagePreview") ||
        query(".image-preview");

    const previewContainer = $("cameraPreviewContainer");

    const analyzeButton =
        $("analyzeCameraButton") ||
        $("analyzeButton") ||
        $("cameraAnalyzeButton");

    if (!input) {
        return;
    }

    input.addEventListener("change", () => {
        const file = input.files?.[0];

        if (file) {
            handleCameraFile(file);
        }
    });

    if (dropzone) {
        dropzone.addEventListener("dragover", (event) => {
            event.preventDefault();
            dropzone.classList.add("dragover");
        });

        dropzone.addEventListener("dragleave", () => {
            dropzone.classList.remove("dragover");
        });

        dropzone.addEventListener("drop", (event) => {
            event.preventDefault();
            dropzone.classList.remove("dragover");

            const file = event.dataTransfer?.files?.[0];

            if (file) {
                handleCameraFile(file);
            }
        });

        dropzone.addEventListener("click", (event) => {
            const target = event.target;

            if (
                target &&
                target.tagName &&
                target.tagName.toLowerCase() !== "button" &&
                target.tagName.toLowerCase() !== "input"
            ) {
                input.click();
            }
        });
    }

    if (analyzeButton) {
        analyzeButton.addEventListener("click", analyzeCameraImage);
    }

    const chooseButton = $("chooseCameraFileButton");

    if (chooseButton) {
        chooseButton.addEventListener("click", () => {
            input.click();
        });
    }

    const removePreviewButton = $("removeCameraPreviewButton");

    if (removePreviewButton) {
        removePreviewButton.addEventListener("click", () => {
            resetCameraSelection();
        });
    }

    const clearButton = $("clearCameraButton");

    if (clearButton) {
        clearButton.addEventListener("click", () => {
            resetCameraSelection();
        });
    }

    function resetCameraSelection() {
        selectedCameraFile = null;
        input.value = "";

        if (preview) {
            preview.removeAttribute("src");
            preview.classList.add("hidden");
        }

        if (previewContainer) {
            previewContainer.classList.add("hidden");
        }

        setText("selectedFileName", "No file selected");
        setText("cameraFileName", "No file selected");

        if (analyzeButton) {
            analyzeButton.disabled = true;
        }
    }

    function handleCameraFile(file) {
        if (!file || !file.type.startsWith("image/")) {
            alert("Please select a valid image file.");
            return;
        }

        selectedCameraFile = file;
        cameraCaptureSource = 'upload';
        var capWrap=$("capturedPreviewWrap");
        if(capWrap) capWrap.classList.add("hidden");

        if (preview) {
            if (typeof URL.createObjectURL === "function") {
                preview.src = URL.createObjectURL(file);
                preview.onload = () => {
                    URL.revokeObjectURL(preview.src);
                };
            } else {
                preview.classList.add("hidden");
            }

            preview.classList.remove("hidden");
        }

        if (previewContainer) {
            previewContainer.classList.remove("hidden");
        }

        setText("selectedFileName", file.name);
        setText("cameraFileName", file.name);

        if (analyzeButton) {
            analyzeButton.disabled = false;
        }
    }
}

function stopCameraStream(){
    if(cameraStream){
        try{ cameraStream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){}
        cameraStream=null;
    }
    var v=$("liveCameraVideo");
    if(v){ try{ v.srcObject=null; }catch(e){} v.style.display="none"; }
    var ph=$("liveCameraPlaceholder");
    if(ph) ph.style.display="block";
    var badge=$("liveCameraLiveBadge");
    if(badge) badge.classList.add("hidden");
    var capBtn=$("captureCameraButton");
    if(capBtn) capBtn.disabled=true;
    var stopBtn=$("stopCameraButton");
    if(stopBtn) stopBtn.disabled=true;
}
async function startLiveCamera(){
    var errEl=$("cameraPermissionError");
    if(errEl) errEl.classList.add("hidden");
    if(cameraStream){ stopCameraStream(); }
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        if(errEl){ errEl.innerHTML='<i class="ri-error-warning-line" style="font-size:24px;margin-bottom:8px"></i><strong>Camera not supported in this browser.</strong><p style="font-size:12px;margin-top:6px">Use Upload Image instead.</p>'; errEl.classList.remove("hidden"); }
        return;
    }
    try{
        cameraStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}}, audio:false});
        var v=$("liveCameraVideo");
        var ph=$("liveCameraPlaceholder");
        var badge=$("liveCameraLiveBadge");
        if(v){
            v.srcObject=cameraStream;
            v.style.display="block";
            try{ await v.play(); }catch(e){}
        }
        if(ph) ph.style.display="none";
        if(badge) badge.classList.remove("hidden");
        var capBtn=$("captureCameraButton");
        if(capBtn) capBtn.disabled=false;
        var stopBtn=$("stopCameraButton");
        if(stopBtn) stopBtn.disabled=false;
        if(errEl) errEl.classList.add("hidden");
    }catch(e){
        stopCameraStream();
        if(errEl){
            var msg = e && e.name==="NotAllowedError" ? "Camera access was not granted." : e && e.name==="NotFoundError" ? "No camera was found." : "Camera unavailable.";
            errEl.innerHTML='<i class="ri-error-warning-line" style="font-size:24px;margin-bottom:8px"></i><strong>'+escapeHtml(msg)+'</strong><p style="font-size:12px;margin-top:6px">Use Upload Image instead.</p>';
            errEl.classList.remove("hidden");
        }
    }
}
function captureSample(){
    var v=$("liveCameraVideo");
    var canvas=$("liveCameraCanvas");
    if(!v || !canvas || !cameraStream) return;
    var w=v.videoWidth || 1280;
    var h=v.videoHeight || 720;
    canvas.width=w; canvas.height=h;
    var ctx=canvas.getContext("2d");
    if(!ctx) return;
    ctx.drawImage(v,0,0,w,h);
    canvas.toBlob(function(blob){
        if(!blob) return;
        var file=new File([blob], "capture-"+Date.now()+".jpg", {type:"image/jpeg"});
        selectedCameraFile=file;
        cameraCaptureSource='live';
        var img=$("capturedPreviewImage");
        if(img){
            try{ img.src=URL.createObjectURL(blob); }catch(e){ img.src=canvas.toDataURL("image/jpeg",0.9); }
        }
        var wrap=$("capturedPreviewWrap");
        if(wrap) wrap.classList.remove("hidden");
        var preview=$("cameraPreviewContainer");
        if(preview) preview.classList.add("hidden");
        // keep stream paused visually but stop tracks to avoid background? keep preview image, stop live
        stopCameraStream();
        var analyzeBtn=$("analyzeCameraButton");
        if(analyzeBtn) analyzeBtn.disabled=false;
        // also enable captured analyze
    }, "image/jpeg", 0.92);
}
function setupLiveCamera(){
    var liveBtn=$("liveCameraModeButton");
    var upBtn=$("uploadModeButton");
    var liveC=$("liveCameraContainer");
    var upC=$("uploadModeContainer");
    function setMode(mode){
        if(mode==='live'){
            if(liveBtn){ liveBtn.classList.add("active"); liveBtn.setAttribute("aria-selected","true"); }
            if(upBtn){ upBtn.classList.remove("active"); upBtn.setAttribute("aria-selected","false"); }
            if(liveC) liveC.classList.remove("hidden");
            if(upC) upC.classList.add("hidden");
        } else {
            if(upBtn){ upBtn.classList.add("active"); upBtn.setAttribute("aria-selected","true"); }
            if(liveBtn){ liveBtn.classList.remove("active"); liveBtn.setAttribute("aria-selected","false"); }
            if(upC) upC.classList.remove("hidden");
            if(liveC) liveC.classList.add("hidden");
            stopCameraStream();
        }
    }
    if(liveBtn) liveBtn.addEventListener("click", function(){ setMode('live'); });
    if(upBtn) upBtn.addEventListener("click", function(){ setMode('upload'); });
    var startBtn=$("startLiveCameraButton");
    if(startBtn) startBtn.addEventListener("click", startLiveCamera);
    var capBtn=$("captureCameraButton");
    if(capBtn) capBtn.addEventListener("click", captureSample);
    var stopBtn=$("stopCameraButton");
    if(stopBtn) stopBtn.addEventListener("click", stopCameraStream);
    var retakeBtn=$("retakeCameraButton");
    if(retakeBtn) retakeBtn.addEventListener("click", function(){
        var wrap=$("capturedPreviewWrap");
        if(wrap) wrap.classList.add("hidden");
        var img=$("capturedPreviewImage");
        if(img) img.removeAttribute("src");
        selectedCameraFile=null;
        cameraCaptureSource=null;
        var ab=$("analyzeCameraButton");
        if(ab) ab.disabled=true;
        startLiveCamera();
    });
    var analyzeCapBtn=$("analyzeCapturedButton");
    if(analyzeCapBtn) analyzeCapBtn.addEventListener("click", function(){ analyzeCameraImage(); });
    // stop stream when leaving camera page
    window.addEventListener("hashchange", function(){
        if(window.location.hash!=="#camera") stopCameraStream();
    });
    // initial mode live
    setMode('live');
}

async function analyzeCameraImage() {
    if (!selectedCameraFile) {
        alert("Please select an image first.");
        return;
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(selectedCameraFile.type)) {
        alert("Unsupported file type. Please select a JPEG, PNG, or WebP image.");
        return;
    }
    const maxSize = 10 * 1024 * 1024;
    if (selectedCameraFile.size > maxSize) {
        alert("Image is too large. Please select an image smaller than 10 MB.");
        return;
    }
    if (selectedCameraFile.size === 0) {
        alert("The selected file appears to be empty. Please choose another.");
        return;
    }

    const analyzeButton = $("analyzeCameraButton") || $("analyzeButton") || $("cameraAnalyzeButton");
    const analyzeCapBtn = $("analyzeCapturedButton");
    const resultText = $("cameraResultText");
    const statusBadge = $("cameraResultStatus");
    const emptyState = $("cameraResultEmpty");
    const resultContent = $("cameraResultContent");
    const tagsElement = $("cameraResultTags");

    if (analyzeButton) {
        analyzeButton.disabled = true;
        analyzeButton.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 0.8s linear infinite"></i> Analyzing visual indicators...';
    }
    if (analyzeCapBtn) { analyzeCapBtn.disabled = true; analyzeCapBtn.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 0.8s linear infinite"></i> Analyzing...'; }
    if (resultContent) resultContent.classList.remove("hidden");
    if (emptyState) emptyState.classList.add("hidden");
    if (tagsElement) tagsElement.innerHTML = "";
    if (resultText) {
        resultText.innerHTML = '<div class="cam-loading" style="text-align:center;padding:20px"><div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:8px">Analyzing the captured image...</div><div style="font-size:11px;color:var(--text-muted)">Scanning visual indicators · Checking coloration and particles</div><div style="margin-top:12px"><span class="spinner" style="display:inline-block;width:20px;height:20px;border:2px solid var(--border-color);border-top-color:var(--primary);border-radius:50%;animation:spinnerRotate 0.8s linear infinite"></span></div></div>';
    }
    if (statusBadge) {
        statusBadge.textContent = "Analyzing...";
        statusBadge.classList.remove("analysis-complete", "analysis-failed");
        statusBadge.style.background = "var(--bg-soft)";
    }

    try {
        const formData = new FormData();
        formData.append("image", selectedCameraFile);
        if (latestDevice?.id) formData.append("device_id", String(latestDevice.id));
        const provider = localStorage.getItem("aqua_ai_provider") || "auto";
        const model = localStorage.getItem("aqua_ai_model") || "";
        if (provider && provider !== "auto") formData.append("provider", provider);
        if (model) formData.append("model", model);

        const data = await apiRequest("/camera/analyze", { method: "POST", body: formData });

        latestCameraAnalysis = data?.analysis || data?.result || data?.prediction || data;
        renderCameraResult(data);
        updateChatContextIndicators();
        if (data?.saved_to_database === false) {
            showToast("Analysis returned but could not be saved to database.", "warning");
        } else {
            try {
                if (getPrefs().notif.camera) {
                    showToast("Camera analysis complete.", "success");
                }
            } catch {
                // Preference unavailable — skip the confirmation toast.
            }
        }
    } catch (error) {
        if (resultText) {
            const isRateLimited = /429|rate limit|quota|credit/i.test(error.message);
            const hint = isRateLimited ? "<p style='margin-top:8px;font-size:12px;color:var(--text-muted)'>All vision providers are temporarily rate-limited. Please wait a minute and retry.</p>" : "";
            resultText.innerHTML = '<div class="alert-box error-box" style="padding:12px;border:1px solid var(--status-critical-border);background:var(--status-critical-bg);border-radius:8px;color:var(--status-critical)"><strong>Analysis failed:</strong> ' + escapeHtml(error.message) + hint + '<br><button class="secondary-button" style="margin-top:10px" onclick="analyzeCameraImage()" type="button"><i class="ri-refresh-line"></i> Retry</button></div>';
        }
        if (statusBadge) {
            statusBadge.textContent = "Analysis failed";
            statusBadge.classList.remove("analysis-complete");
            statusBadge.classList.add("analysis-failed");
        }
    } finally {
        if (analyzeButton) {
            analyzeButton.disabled = false;
            analyzeButton.innerHTML = '<i class="ri-sparkling-2-line"></i> Analyze Water Appearance';
        }
        var acb2=$("analyzeCapturedButton");
        if(acb2){ acb2.disabled=false; acb2.innerHTML='<i class="ri-sparkling-2-line"></i> Analyze Water Appearance'; }
    }
}

function getCameraAnalysisField(analysis, ...keys) {
    if (!analysis || typeof analysis !== "object") {
        return undefined;
    }

    for (const key of keys) {
        if (key === null) {
            continue;
        }

        const value = analysis[key];

        if (value !== null && value !== undefined && value !== "") {
            return value;
        }
    }

    return undefined;
}

function renderCameraResult(data) {
    if (!data) return;
    const analysis = data?.analysis || data?.result || data?.prediction || data;
    const sensorContext = data?.sensor_context || null;
    const saved = data?.saved_to_database;

    if (analysis && typeof analysis === "object") latestCameraAnalysis = analysis;

    const emptyState = $("cameraResultEmpty");
    const resultContent = $("cameraResultContent");
    const statusBadge = $("cameraResultStatus");
    const titleElement = $("cameraResultTitle");
    const textElement = $("cameraResultText");
    const tagsElement = $("cameraResultTags");

    if (emptyState) emptyState.classList.add("hidden");
    if (resultContent) resultContent.classList.remove("hidden");
    if (statusBadge) {
        statusBadge.textContent = "Analysis complete";
        statusBadge.classList.remove("analysis-failed");
        statusBadge.classList.add("analysis-complete");
        statusBadge.style.background=""; statusBadge.style.color=""; statusBadge.style.borderColor="";
    }

    const overall = getCameraAnalysisField(analysis, "overall_visual_assessment", "overall_observation", "observation", "summary") || "Visual assessment completed.";
    const observations = Array.isArray(analysis?.observations) ? analysis.observations : [];
    const indicators = Array.isArray(analysis?.potential_visual_indicators) ? analysis.potential_visual_indicators : [];
    const riskLevel = getCameraAnalysisField(analysis, "risk_level", "risk");
    const waterColor = getCameraAnalysisField(analysis, "water_color");
    const cloudiness = getCameraAnalysisField(analysis, "cloudiness");
    const visibleDebris = getCameraAnalysisField(analysis, "visible_debris");
    const colorAbnormalities = getCameraAnalysisField(analysis, "color_abnormalities");

    // Source label
    var sourceLabel = cameraCaptureSource === 'live' ? 'Live camera capture' : cameraCaptureSource === 'upload' ? 'Uploaded image' : 'Captured image';

    if (titleElement) {
        titleElement.textContent = "Visual Water Inspection";
    }

    if (textElement) {
        // Observed indicator chips — only true detections, careful wording
        var chips = [];
        if(analysis?.algae_detected === true) chips.push('<span class="cam-chip cam-chip-algae"><i class="ri-leaf-line"></i> Algae-like coloration</span>');
        if(analysis?.foam_detected === true) chips.push('<span class="cam-chip cam-chip-foam"><i class="ri-water-flash-line"></i> Surface foam</span>');
        if(analysis?.particles_detected === true) chips.push('<span class="cam-chip cam-chip-particles"><i class="ri-contrast-drop-2-line"></i> Suspended particles</span>');
        if(analysis?.oil_layer_detected === true) chips.push('<span class="cam-chip cam-chip-oil"><i class="ri-drop-line"></i> Oil-like film</span>');
        if(analysis?.possible_microplastics === true){
            // careful: do not claim microplastics, show particle-like
            chips.push('<span class="cam-chip cam-chip-micro"><i class="ri-bubble-line"></i> Particle-like structures</span>');
        } else if(analysis?.particles_detected === true && analysis?.possible_microplastics !== false){
            // generic visible particles already covered
        }
        // Also include any string indicators that are not booleans but supported
        var extraIndicators = indicators.filter(function(s){ return typeof s==="string" && s.trim() && !/microplastic/i.test(s); }).slice(0,4);
        extraIndicators.forEach(function(s){
            if(chips.length<6) chips.push('<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:var(--bg-soft);border:1px solid var(--border-color);color:var(--text-secondary);font-size:11px;font-weight:600">'+escapeHtml(s)+'</span>');
        });
        var chipsHtml = chips.length ? '<div style="display:flex;flex-wrap:wrap;gap:8px">'+chips.join("")+'</div>' : '<p style="font-size:12px;color:var(--text-muted);line-height:1.6">No major visual indicators were identified in the captured image.</p>';

        // Water appearance rows
        var colorText = waterColor && waterColor!=="Not clearly determined." && waterColor!=="Not assessed." ? String(waterColor) : "Not visually identified";
        var surfaceText = analysis?.foam_detected===true ? "Surface foam observed" : analysis?.foam_detected===false ? "No obvious foam observed" : "Not visually identified";
        var particlesText = analysis?.particles_detected===true ? "Visible particles observed" : analysis?.particles_detected===false ? "Not visibly detected" : "Not visually identified";
        if(analysis?.oil_layer_detected===true) surfaceText += " · Oil-like film may be present";
        var appearanceHtml = '<div style="display:grid;grid-template-columns:110px 1fr;gap:8px;font-size:12px">'
            +'<span style="color:var(--text-muted);font-weight:600">Color</span><span style="color:var(--text-primary)">'+escapeHtml(colorText)+'</span>'
            +'<span style="color:var(--text-muted);font-weight:600">Surface</span><span style="color:var(--text-primary)">'+escapeHtml(surfaceText)+'</span>'
            +'<span style="color:var(--text-muted);font-weight:600">Particles</span><span style="color:var(--text-primary)">'+escapeHtml(particlesText)+'</span>'
            +'</div>';
        if(cloudiness && cloudiness!=="not assessed" && cloudiness!=="Not assessed") appearanceHtml += '<div style="margin-top:6px;font-size:12px;color:var(--text-secondary)"><strong>Clarity impression:</strong> '+escapeHtml(String(cloudiness))+'</div>';
        if(colorAbnormalities && colorAbnormalities!=="Not assessed." && colorAbnormalities!=="null") appearanceHtml += '<div style="font-size:12px;color:var(--text-secondary)"><strong>Color notes:</strong> '+escapeHtml(String(colorAbnormalities))+'</div>';
        if(visibleDebris && visibleDebris!=="Not assessed." && visibleDebris!=="null" && visibleDebris!=="None") appearanceHtml += '<div style="font-size:12px;color:var(--text-secondary)"><strong>Debris:</strong> '+escapeHtml(String(visibleDebris))+'</div>';

        // Key finding — use overall as concise statement
        var keyFinding = String(overall).trim();
        if(!keyFinding || keyFinding==="Visual assessment completed.") {
            if(observations.length) keyFinding = String(observations[0]);
            else if(chips.length) keyFinding = "Visible indicators were identified in the captured sample.";
            else keyFinding = "No major visual indicators were identified in the captured image.";
        }

        // Sensor context
        let sensorHtml = "";
        if (sensorContext && (sensorContext.temperature!=null || sensorContext.ph!=null || sensorContext.turbidity!=null || sensorContext.tds!=null)) {
            const fmt = (v,d) => v!=null ? Number(v).toFixed(d) : "--";
            sensorHtml = '<div style="margin-top:16px;padding:14px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-soft)">'
                +'<div style="font-size:11px;font-weight:700;letter-spacing:0.6px;color:var(--text-muted);text-transform:uppercase;margin-bottom:10px"><i class="ri-sensor-line"></i> Visual + Sensor Context</div>'
                +'<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;font-size:12px"><div><span style="color:var(--text-muted)">pH</span><br><strong style="font-size:14px">'+escapeHtml(fmt(sensorContext.ph,2))+'</strong></div><div><span style="color:var(--text-muted)">Turbidity</span><br><strong style="font-size:14px">'+escapeHtml(fmt(sensorContext.turbidity,2))+' NTU</strong></div><div><span style="color:var(--text-muted)">TDS</span><br><strong style="font-size:14px">'+escapeHtml(fmt(sensorContext.tds,0))+' mg/L</strong></div><div><span style="color:var(--text-muted)">Temperature</span><br><strong style="font-size:14px">'+escapeHtml(fmt(sensorContext.temperature,1))+' \u00B0C</strong></div></div>'
                +'<div style="font-size:11px;color:var(--text-muted);margin-top:8px">Visual observations should be interpreted together with sensor measurements.</div>'
                +'</div>';
        } else if (sensorContext === null) {
            sensorHtml = '<div style="margin-top:16px;padding:10px 12px;border:1px dashed var(--border-color);border-radius:8px;background:var(--bg-soft);font-size:11px;color:var(--text-muted)"><i class="ri-information-line"></i> No recent sensor readings available — camera result is visual-only.</div>';
        }

        var microNote = (analysis?.possible_microplastics===true || analysis?.particles_detected===true) ? '<div style="font-size:11px;color:var(--text-muted);margin-top:6px"><i class="ri-information-line"></i> Visual inspection alone cannot establish that visible particles are microplastics.</div>' : '';
        var algaeNote = analysis?.algae_detected===true ? '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Algae-like coloration observed — visual classification, not laboratory confirmation.</div>' : '';
        var foamNote = analysis?.foam_detected===true ? '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Foam appearance may have multiple causes and should be interpreted with water-quality measurements.</div>' : '';

        var savedNote = saved === false ? '<div style="margin-top:10px;font-size:11px;color:var(--amber-dark)"><i class="ri-database-2-line"></i> Analysis was not saved to database but is displayed.</div>' : saved === true ? '<div style="margin-top:10px;font-size:11px;color:var(--text-muted)"><i class="ri-check-line"></i> Saved to database</div>' : "";

        textElement.innerHTML =
            '<div style="margin-bottom:14px;padding:14px;border-radius:10px;background:linear-gradient(135deg,var(--primary-light),var(--bg-soft));border:1px solid var(--border-color)"><div style="font-size:11px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;color:var(--primary);margin-bottom:6px">AI Visual Inspection · Water Appearance Analysis</div><div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Source: '+escapeHtml(sourceLabel)+'</div><p style="color:var(--text-primary);font-size:13px;line-height:1.6;margin:0">'+escapeHtml(String(overall))+'</p></div>' +
            '<div style="margin-top:16px"><div style="font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Key Visual Finding</div><div style="padding:12px;border-left:3px solid var(--primary);background:var(--bg-soft);border-radius:0 8px 8px 0"><p style="margin:0;color:var(--text-primary);font-size:13px;line-height:1.6;font-weight:500">'+escapeHtml(keyFinding)+'</p></div></div>' +
            '<div style="margin-top:16px"><div style="font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Observed Indicators</div>'+chipsHtml + microNote + algaeNote + foamNote + '</div>' +
            '<div style="margin-top:16px"><div style="font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Water Appearance</div><div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card)">'+appearanceHtml+'</div></div>' +
            (observations.length ? '<div style="margin-top:16px"><div style="font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">Key Observations</div><ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.7;color:var(--text-secondary)">'+observations.map(function(o){return "<li>"+escapeHtml(String(o))+"</li>";}).join("")+'</ul></div>' : '') +
            '<div style="margin-top:16px;padding:12px;border:1px solid var(--border-subtle);background:var(--bg-soft);border-radius:8px"><div style="font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">Possible Interpretation</div><p style="margin:0;font-size:12px;line-height:1.6;color:var(--text-secondary)">Visible coloration can be associated with biological growth, suspended material, or other environmental factors. Sensor and laboratory measurements are needed to determine the cause.</p></div>' +
            sensorHtml +
            '<div style="margin-top:16px;padding:12px;border:1px solid var(--border-subtle);background:var(--bg-soft);border-radius:8px"><div style="font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">Recommended Next Step</div><p style="margin:0;font-size:12px;line-height:1.6;color:var(--text-secondary)">Compare this visual observation with the current pH, turbidity, TDS and temperature readings.</p></div>' +
            '<div style="margin-top:12px;padding:8px 10px;border:1px solid var(--border-subtle);background:var(--bg-soft);border-radius:6px;font-size:11px;line-height:1.5;color:var(--text-muted);text-align:center"><i class="ri-information-line"></i> AI visual assessment based on the captured image.</div>' +
            savedNote;
    }

    if (tagsElement) {
        tagsElement.innerHTML = "";
    }

    const legacyContainer = $("cameraResult") || $("analysisResult") || query(".analysis-result");
    if (legacyContainer) {
        legacyContainer.innerHTML = '<div class="analysis-item"><label>Analysis</label><p>' + escapeHtml(String(overall || "No result was returned.")) + '</p></div>';
    }
}

// =========================================================
// ANALYSIS PAGE - CENTRALIZED PREDICTION ENGINE
// =========================================================
// Scoring: RAW SENSOR -> NORMALIZED SCORES (0-100)
//   -> APPLICATION WEIGHTS -> WEIGHTED SCORE -> CLAMP -> LABEL -> REASON
// =========================================================

const ANALYSIS_CONFIG = {
    ec: { tdsConversionFactor: 650 },
    irrigation: { tdsNone: 450, tdsModerate: 2000, ecNone: 0.7, ecSevere: 3.0, phMin: 6.5, phMax: 8.4 },
    phIndex: { lowerOuter: 4.5, upperOuter: 10.4 },
    temperature: { preferredMin: 15, preferredMax: 30, lowerBound: 5, upperBound: 40 },
    turbidity: { preferred: 1, moderate: 5 },
    drinking: { phMin: 6.5, phMax: 8.5, tdsReference: 500, turbidityTarget: 1, turbidityBroader: 5, weights: { ph: 0.40, tds: 0.35, turbidity: 0.25 } },
    weights: {
        overall: { ph: 0.35, salinity: 0.30, turbidity: 0.20, temperature: 0.15 },
        crop: { salinity: 0.45, ph: 0.25, temperature: 0.20, turbidity: 0.10 }
    },
    dataFreshnessHours: 24
};

const ANALYSIS_PARAMETER_KEYS = ["temperature", "ph", "turbidity", "tds"];

const CROP_PROFILES = [
    { name: "Rice", ecwFullYield: 2.0, phMin: 5.5, phMax: 8.0, temperatureMin: 20, temperatureMax: 35, turbidityPreferred: 5 },
    { name: "Wheat", ecwFullYield: 4.0, phMin: 6.0, phMax: 8.0, temperatureMin: 10, temperatureMax: 30, turbidityPreferred: 5 },
    { name: "Maize", ecwFullYield: 1.1, phMin: 5.8, phMax: 7.5, temperatureMin: 18, temperatureMax: 32, turbidityPreferred: 5 },
    { name: "Sugarcane", ecwFullYield: 1.1, phMin: 6.0, phMax: 8.0, temperatureMin: 20, temperatureMax: 38, turbidityPreferred: 10 },
    { name: "Tomato", ecwFullYield: 1.7, phMin: 6.0, phMax: 7.5, temperatureMin: 18, temperatureMax: 29, turbidityPreferred: 5 },
    { name: "Cucumber", ecwFullYield: 1.7, phMin: 5.5, phMax: 7.5, temperatureMin: 18, temperatureMax: 32, turbidityPreferred: 5 },
    { name: "Potato", ecwFullYield: 1.1, phMin: 5.0, phMax: 6.5, temperatureMin: 15, temperatureMax: 25, turbidityPreferred: 5 },
    { name: "Pepper", ecwFullYield: 1.0, phMin: 5.5, phMax: 7.0, temperatureMin: 18, temperatureMax: 30, turbidityPreferred: 5 },
    { name: "Lettuce", ecwFullYield: 0.9, phMin: 6.0, phMax: 7.5, temperatureMin: 10, temperatureMax: 25, turbidityPreferred: 3 },
    { name: "Carrot", ecwFullYield: 0.7, phMin: 6.0, phMax: 7.0, temperatureMin: 10, temperatureMax: 25, turbidityPreferred: 3 },
    { name: "Bean", ecwFullYield: 0.7, phMin: 6.0, phMax: 7.5, temperatureMin: 15, temperatureMax: 30, turbidityPreferred: 5 },
    { name: "Onion", ecwFullYield: 0.8, phMin: 6.0, phMax: 7.5, temperatureMin: 13, temperatureMax: 30, turbidityPreferred: 5 }
];

const INDUSTRIAL_PROFILES = [
    { name: "General Cleaning", phMin: 5.5, phMax: 9.0, phLower: 3.0, phUpper: 12.0, tdsPreferred: 500, tdsMaximum: 1500, turbidityPreferred: 5, turbidityMaximum: 20, temperatureMin: 5, temperatureMax: 40, temperatureLower: 0, temperatureUpper: 50, weights: { ph: 0.25, tds: 0.25, turbidity: 0.35, temperature: 0.15 } },
    { name: "Cooling Water", phMin: 6.5, phMax: 8.5, phLower: 4.5, phUpper: 10.5, tdsPreferred: 500, tdsMaximum: 1000, turbidityPreferred: 1, turbidityMaximum: 10, temperatureMin: 10, temperatureMax: 40, temperatureLower: 0, temperatureUpper: 50, weights: { ph: 0.25, tds: 0.3, turbidity: 0.3, temperature: 0.15 } },
    { name: "Utility / Process Water", phMin: 6.0, phMax: 8.5, phLower: 4.0, phUpper: 11.0, tdsPreferred: 500, tdsMaximum: 1500, turbidityPreferred: 5, turbidityMaximum: 15, temperatureMin: 5, temperatureMax: 40, temperatureLower: 0, temperatureUpper: 50, weights: { ph: 0.3, tds: 0.3, turbidity: 0.25, temperature: 0.15 } },
    { name: "Boiler-Related Screening", phMin: 7.0, phMax: 8.5, phLower: 5.0, phUpper: 10.0, tdsPreferred: 200, tdsMaximum: 500, turbidityPreferred: 1, turbidityMaximum: 5, temperatureMin: 10, temperatureMax: 35, temperatureLower: 0, temperatureUpper: 45, weights: { ph: 0.35, tds: 0.35, turbidity: 0.2, temperature: 0.1 } },
    { name: "General Manufacturing / Process Use", phMin: 6.0, phMax: 8.5, phLower: 4.0, phUpper: 11.0, tdsPreferred: 500, tdsMaximum: 1500, turbidityPreferred: 5, turbidityMaximum: 20, temperatureMin: 5, temperatureMax: 40, temperatureLower: 0, temperatureUpper: 50, weights: { ph: 0.3, tds: 0.25, turbidity: 0.3, temperature: 0.15 } }
];

const DOMESTIC_PROFILES = [
    { name: "Gardening", phMin: 5.5, phMax: 8.0, phLower: 3.5, phUpper: 10.5, tdsPreferred: 500, tdsMaximum: 1500, turbidityPreferred: 5, turbidityMaximum: 20, temperatureMin: 5, temperatureMax: 38, temperatureLower: 0, temperatureUpper: 45, weights: { ph: 0.3, tds: 0.4, turbidity: 0.2, temperature: 0.1 } },
    { name: "Home Plants", phMin: 5.5, phMax: 7.5, phLower: 3.5, phUpper: 10.0, tdsPreferred: 400, tdsMaximum: 1200, turbidityPreferred: 3, turbidityMaximum: 15, temperatureMin: 10, temperatureMax: 32, temperatureLower: 0, temperatureUpper: 42, weights: { ph: 0.35, tds: 0.4, turbidity: 0.15, temperature: 0.1 } },
    { name: "Lawn / Landscape Watering", phMin: 5.5, phMax: 8.5, phLower: 3.5, phUpper: 11.0, tdsPreferred: 500, tdsMaximum: 1500, turbidityPreferred: 5, turbidityMaximum: 20, temperatureMin: 5, temperatureMax: 38, temperatureLower: 0, temperatureUpper: 45, weights: { ph: 0.25, tds: 0.45, turbidity: 0.2, temperature: 0.1 } },
    { name: "Outdoor / Floor Cleaning", phMin: 5.0, phMax: 9.0, phLower: 3.0, phUpper: 12.0, tdsPreferred: 800, tdsMaximum: 2000, turbidityPreferred: 10, turbidityMaximum: 30, temperatureMin: 0, temperatureMax: 45, temperatureLower: 0, temperatureUpper: 50, weights: { ph: 0.15, tds: 0.2, turbidity: 0.5, temperature: 0.15 } },
    { name: "Toilet Flushing", phMin: 5.5, phMax: 9.0, phLower: 3.5, phUpper: 11.0, tdsPreferred: 500, tdsMaximum: 1500, turbidityPreferred: 5, turbidityMaximum: 15, temperatureMin: 5, temperatureMax: 40, temperatureLower: 0, temperatureUpper: 50, weights: { ph: 0.15, tds: 0.25, turbidity: 0.45, temperature: 0.15 } },
    { name: "Vehicle Washing", phMin: 5.5, phMax: 8.5, phLower: 3.5, phUpper: 11.0, tdsPreferred: 400, tdsMaximum: 1200, turbidityPreferred: 3, turbidityMaximum: 10, temperatureMin: 5, temperatureMax: 38, temperatureLower: 0, temperatureUpper: 45, weights: { ph: 0.15, tds: 0.3, turbidity: 0.4, temperature: 0.15 } },
    { name: "General Non-Potable Household", phMin: 5.5, phMax: 9.0, phLower: 3.5, phUpper: 11.0, tdsPreferred: 500, tdsMaximum: 2000, turbidityPreferred: 10, turbidityMaximum: 30, temperatureMin: 0, temperatureMax: 45, temperatureLower: 0, temperatureUpper: 50, weights: { ph: 0.25, tds: 0.3, turbidity: 0.35, temperature: 0.1 } }
];

const GENERAL_PROFILES = [
    { name: "Landscaping", phMin: 5.5, phMax: 8.5, phLower: 3.5, phUpper: 11.0, tdsPreferred: 500, tdsMaximum: 1500, turbidityPreferred: 5, turbidityMaximum: 20, temperatureMin: 5, temperatureMax: 38, temperatureLower: 0, temperatureUpper: 45, weights: { ph: 0.25, tds: 0.45, turbidity: 0.2, temperature: 0.1 } },
    { name: "Outdoor Cleaning", phMin: 5.0, phMax: 9.5, phLower: 3.0, phUpper: 12.0, tdsPreferred: 800, tdsMaximum: 2000, turbidityPreferred: 10, turbidityMaximum: 30, temperatureMin: 0, temperatureMax: 45, temperatureLower: 0, temperatureUpper: 50, weights: { ph: 0.15, tds: 0.2, turbidity: 0.5, temperature: 0.15 } },
    { name: "General Utility Water", phMin: 5.5, phMax: 9.0, phLower: 3.5, phUpper: 11.0, tdsPreferred: 500, tdsMaximum: 2000, turbidityPreferred: 10, turbidityMaximum: 30, temperatureMin: 0, temperatureMax: 45, temperatureLower: 0, temperatureUpper: 50, weights: { ph: 0.2, tds: 0.3, turbidity: 0.4, temperature: 0.1 } },
    { name: "Toilet Flushing (Utility)", phMin: 5.5, phMax: 9.0, phLower: 3.5, phUpper: 11.0, tdsPreferred: 500, tdsMaximum: 1500, turbidityPreferred: 5, turbidityMaximum: 15, temperatureMin: 5, temperatureMax: 40, temperatureLower: 0, temperatureUpper: 50, weights: { ph: 0.15, tds: 0.25, turbidity: 0.45, temperature: 0.15 } },
    { name: "Non-Potable Use", phMin: 5.5, phMax: 9.0, phLower: 3.5, phUpper: 11.0, tdsPreferred: 500, tdsMaximum: 2000, turbidityPreferred: 10, turbidityMaximum: 30, temperatureMin: 0, temperatureMax: 45, temperatureLower: 0, temperatureUpper: 50, weights: { ph: 0.2, tds: 0.3, turbidity: 0.4, temperature: 0.1 } }
];
const UTILITY_PROFILES = GENERAL_PROFILES;

function getQualityClass(score){
    var n = score===null||score===undefined?null:Number(score);
    if(n===null||!Number.isFinite(n)) return {label:'Unavailable', color:'var(--text-muted)', bg:'var(--status-unknown-bg)', level:'unknown'};
    if(n>=90) return {label:'Highly Suitable', color:'var(--status-normal)', bg:'var(--status-normal-bg)', level:'good'};
    if(n>=75) return {label:'Suitable', color:'var(--amber)', bg:'var(--amber-light)', level:'good'};
    if(n>=50) return {label:'Moderately Suitable', color:'var(--status-monitor)', bg:'var(--status-monitor-bg)', level:'caution'};
    if(n>=30) return {label:'Low Suitability', color:'var(--status-monitor)', bg:'var(--status-monitor-bg)', level:'caution'};
    return {label:'Poor Match', color:'var(--status-critical)', bg:'var(--status-critical-bg)', level:'alert'};
}
function deriveParameters(reading){ return calculateDerivedParameters(reading); }
function formatAnalysisTime(value){
    if(!value) return '--';
    var t = parseApiTimestamp(value);
    if(Number.isNaN(t)) return '--';
    return new Date(t).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
}
const DRINKING_PROFILE = { name: "Drinking Water Screening", phMin: 6.5, phMax: 8.5, phLower: 4.5, phUpper: 10.5, tdsPreferred: 250, tdsMaximum: 500, turbidityPreferred: 1, turbidityMaximum: 5, temperatureMin: 5, temperatureMax: 30, temperatureLower: 0, temperatureUpper: 40, weights: { ph: 0.40, tds: 0.35, turbidity: 0.25, temperature: 0.0 } };


const ANALYSIS_THRESHOLDS = {
    ph: { min: 6.5, max: 8.5, cautionLow: 6.0, cautionHigh: 9.0 },
    agriculturePh: { min: 6.5, max: 8.4 },
    turbidity: { preferred: 1, acceptable: 5 },
    tds: { reference: 500, agricultureModerate: 450, agricultureHigh: 2000 },
    temperature: { monitoringMin: 5, monitoringMax: 35, alertMin: 0, alertMax: 45 },
    dataFreshnessHours: 24
};
/* SCORING ENGINE */

function analysisNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function scoreTargetRange(value, idealMin, idealMax, lowerLimit, upperLimit) {
    if (value === null) return null;
    if (value >= idealMin && value <= idealMax) return 100;
    
    var lowerRange = Math.max(0.01, idealMin - lowerLimit);
    var upperRange = Math.max(0.01, upperLimit - idealMax);
    
    if (value < idealMin && value >= lowerLimit) {
        return clamp(100 * (value - lowerLimit) / lowerRange, 0, 100);
    }
    if (value > idealMax && value <= upperLimit) {
        return clamp(100 * (upperLimit - value) / upperRange, 0, 100);
    }
    return 0;
}

function scoreClarity(turbidity) {
    if (turbidity === null) return null;
    if (turbidity <= 1) return 100;
    if (turbidity <= 5) {
        return clamp(100 - 40 * (turbidity - 1) / 4, 60, 100);
    }
    if (turbidity <= 20) {
        return clamp(60 - 60 * (turbidity - 5) / 15, 0, 60);
    }
    return 0;
}

function scoreTDS(tds, tdsLimit) {
    if (tds === null) return null;
    var halfLimit = tdsLimit * 0.5;
    if (tds <= halfLimit) return 100;
    if (tds <= tdsLimit) {
        return clamp(100 - 40 * (tds - halfLimit) / halfLimit, 60, 100);
    }
    if (tds <= 2 * tdsLimit) {
        return clamp(60 - 60 * (tds - tdsLimit) / tdsLimit, 0, 60);
    }
    return 0;
}

function calculatePHScore(reading, idealMin, idealMax, lowerLimit, upperLimit) {
    var ph = analysisNumber(reading.ph);
    if (ph === null) return null;
    return scoreTargetRange(ph, idealMin, idealMax, lowerLimit, upperLimit);
}

function calculateTDSScore(reading, tdsLimit) {
    var tds = analysisNumber(reading.tds);
    if (tds === null) return null;
    return scoreTDS(tds, tdsLimit);
}

function calculateTurbidityScore(reading) {
    var t = analysisNumber(reading.turbidity);
    if (t === null) return null;
    return scoreClarity(t);
}

function calculateTemperatureScore(reading, idealMin, idealMax, lowerLimit, upperLimit) {
    var temp = analysisNumber(reading.temperature);
    if (temp === null) return null;
    return scoreTargetRange(temp, idealMin, idealMax, lowerLimit, upperLimit);
}

function calculateSalinityScore(reading, ecTolerance) {
    var tds = analysisNumber(reading.tds);
    if (tds === null) return null;
    var ec = tds / ANALYSIS_CONFIG.ec.tdsConversionFactor;
    if (ec <= ecTolerance) return 100;
    if (ec <= 2 * ecTolerance) {
        return clamp(100 - 40 * (ec - ecTolerance) / ecTolerance, 60, 100);
    }
    if (ec <= 3 * ecTolerance) {
        return clamp(60 - 60 * (ec - 2 * ecTolerance) / ecTolerance, 0, 60);
    }
    return 0;
}

function generateReason(scores, paramNames) {
    var keys = Object.keys(scores);
    if (keys.length === 0) return 'Sensor data not available.';
    var allHigh = keys.every(function(k) { return scores[k] !== null && scores[k] >= 85; });
    if (allHigh) return 'All sensor parameters are within the configured range for this application.';
    var lowest = null;
    var lowestVal = 101;
    keys.forEach(function(k) {
        if (scores[k] !== null && scores[k] < lowestVal) { lowestVal = scores[k]; lowest = k; }
    });
    if (lowest && paramNames && paramNames[lowest]) return paramNames[lowest] + ' is the main limiting factor.';
    if (lowest) return lowest + ' is the main limiting factor.';
    return 'Some parameters are outside the preferred range.';
}

function calculateApplicationScore(reading, profile) {
    var phScore = calculatePHScore(reading, profile.phMin, profile.phMax, profile.phLower, profile.phUpper);
    var tdsScore = calculateTDSScore(reading, profile.tdsMaximum);
    var turbScore = calculateTurbidityScore(reading);
    var tempScore = calculateTemperatureScore(reading, profile.temperatureMin, profile.temperatureMax, profile.temperatureLower, profile.temperatureUpper);
    var w = profile.weights;
    var parts = [], wParts = [];
    var minScore = 100;
    
    if (phScore !== null) { parts.push(w.ph * phScore); wParts.push(w.ph); minScore = Math.min(minScore, phScore); }
    if (tdsScore !== null) { parts.push(w.tds * tdsScore); wParts.push(w.tds); minScore = Math.min(minScore, tdsScore); }
    if (turbScore !== null) { parts.push(w.turbidity * turbScore); wParts.push(w.turbidity); minScore = Math.min(minScore, turbScore); }
    if (tempScore !== null) { parts.push(w.temperature * tempScore); wParts.push(w.temperature); minScore = Math.min(minScore, tempScore); }
    
    var suitability = null;
    if (parts.length > 0) {
        var totalW = wParts.reduce(function(s, v) { return s + v; }, 0);
        if (totalW > 0) suitability = clamp(parts.reduce(function(s, v) { return s + v; }, 0) / totalW, 0, 100);
        if (minScore === 0) suitability = Math.min(suitability, 20);
    }
    var paramScores = { 'pH': phScore, 'TDS': tdsScore, 'Turbidity': turbScore, 'Temperature': tempScore };
    var paramNames = { 'pH': 'pH', 'TDS': 'TDS', 'Turbidity': 'Turbidity', 'Temperature': 'Temperature' };
    return { name: profile.name, phScore: phScore, tdsScore: tdsScore, turbidityScore: turbScore, temperatureScore: tempScore, suitability: suitability, reason: generateReason(paramScores, paramNames) };
}

function calculateCropScore(reading, crop) {
    var salinityScore = calculateSalinityScore(reading, crop.ecwFullYield);
    var phScore = calculatePHScore(reading, crop.phMin, crop.phMax, crop.phMin - 2.0, crop.phMax + 2.0);
    var tempScore = calculateTemperatureScore(reading, crop.temperatureMin, crop.temperatureMax, crop.temperatureMin - 10, crop.temperatureMax + 10);
    var turbScore = calculateTurbidityScore(reading);
    var cw = ANALYSIS_CONFIG.weights.crop;
    var parts = [], wParts = [];
    var minScore = 100;
    
    if (salinityScore !== null) { parts.push(cw.salinity * salinityScore); wParts.push(cw.salinity); minScore = Math.min(minScore, salinityScore); }
    if (phScore !== null) { parts.push(cw.ph * phScore); wParts.push(cw.ph); minScore = Math.min(minScore, phScore); }
    if (tempScore !== null) { parts.push(cw.temperature * tempScore); wParts.push(cw.temperature); minScore = Math.min(minScore, tempScore); }
    if (turbScore !== null) { parts.push(cw.turbidity * turbScore); wParts.push(cw.turbidity); minScore = Math.min(minScore, turbScore); }
    
    var suitability = null;
    if (parts.length > 0) {
        var totalW = wParts.reduce(function(s, v) { return s + v; }, 0);
        if (totalW > 0) suitability = clamp(parts.reduce(function(s, v) { return s + v; }, 0) / totalW, 0, 100);
        if (minScore === 0) suitability = Math.min(suitability, 20);
    }
    var paramScores = { 'Salinity': salinityScore, 'pH': phScore, 'Temperature': tempScore, 'Turbidity': turbScore };
    var paramNames = { 'Salinity': 'Estimated EC', 'pH': 'pH', 'Temperature': 'Temperature', 'Turbidity': 'Turbidity' };
    return { crop: crop.name, salinityScore: salinityScore, phScore: phScore, temperatureScore: tempScore, turbidityScore: turbScore, suitability: suitability, reason: generateReason(paramScores, paramNames) };
}

function calculateDrinkingScreening(reading) {
    var dk = ANALYSIS_CONFIG.drinking;
    var phScore = calculatePHScore(reading, dk.phMin, dk.phMax, dk.phMin - 2.0, dk.phMax + 2.0);
    var tdsScore = calculateTDSScore(reading, dk.tdsReference);
    var turbScore = calculateTurbidityScore(reading);
    var w = dk.weights;
    var parts = [], wParts = [];
    var minScore = 100;
    
    if (phScore !== null) { parts.push(w.ph * phScore); wParts.push(w.ph); minScore = Math.min(minScore, phScore); }
    if (tdsScore !== null) { parts.push(w.tds * tdsScore); wParts.push(w.tds); minScore = Math.min(minScore, tdsScore); }
    if (turbScore !== null) { parts.push(w.turbidity * turbScore); wParts.push(w.turbidity); minScore = Math.min(minScore, turbScore); }
    
    var score = null;
    if (parts.length > 0) {
        var totalW = wParts.reduce(function(s, v) { return s + v; }, 0);
        if (totalW > 0) score = clamp(parts.reduce(function(s, v) { return s + v; }, 0) / totalW, 0, 100);
        if (minScore === 0) score = Math.min(score, 20);
    }
    var ph = analysisNumber(reading.ph);
    var tds = analysisNumber(reading.tds);
    var turbidity = analysisNumber(reading.turbidity);
    var temperature = analysisNumber(reading.temperature);
    var params = [];
    params.push({ name: 'pH', value: ph, unit: '', refRange: dk.phMin + ' - ' + dk.phMax, met: ph !== null ? (ph >= dk.phMin && ph <= dk.phMax) : null });
    params.push({ name: 'TDS', value: tds, unit: ' mg/L', refRange: '< ' + dk.tdsReference + ' mg/L', met: tds !== null ? (tds <= dk.tdsReference) : null });
    params.push({ name: 'Turbidity', value: turbidity, unit: ' NTU', refRange: '< ' + dk.turbidityBroader + ' NTU', met: turbidity !== null ? (turbidity < dk.turbidityBroader) : null });
    params.push({ name: 'Temperature', value: temperature, unit: ' \u00B0C', refRange: 'Contextual', met: temperature !== null ? true : null });
    var paramScores = { 'pH': phScore, 'TDS': tdsScore, 'Turbidity': turbScore };
    var paramNames = { 'pH': 'pH', 'TDS': 'TDS', 'Turbidity': 'Turbidity' };
    
    var status = "safe";
    var title = "Meets screening criteria";
    var description = "Sensor data generally meets baseline screening criteria. Note: this does not assess pathogens or heavy metals.";
    
    if (score < 50) {
        status = "alert";
        title = "Below screening criteria";
        description = "One or more parameters are critically outside screening limits. Aqua Sense analytical safeguard applied.";
    } else if (score < 80) {
        status = "watch";
        title = "Mixed screening result";
        description = "Some parameters approach or exceed screening boundaries.";
    }
    
    return { score: score, params: params, reason: generateReason(paramScores, paramNames), status: status, title: title, description: description };
}

/* SCORE LABELS */

function getApplicationWhyLabel(score){
    var s = score===null||score===undefined ? 0 : Number(score);
    if (s >= 90) return 'Why does this suit the water? \u25BE';
    if (s >= 75) return 'Why is this a suitable match? \u25BE';
    if (s >= 50) return 'Why is this a moderate match? \u25BE';
    if (s >= 30) return 'Why is this a low match? \u25BE';
    return 'Why is this a poor match? \u25BE';
}
function scoreLabel(score) {
    if (score === null) return 'Unavailable';
    if (score >= 90) return 'Highly Suitable';
    if (score >= 75) return 'Suitable';
    if (score >= 50) return 'Moderately Suitable';
    if (score >= 30) return 'Low Suitability';
    return 'Poor Match';
}

function scoreLevel(score) {
    if (score === null) return 'unknown';
    if (score >= 70) return 'good';
    if (score >= 50) return 'caution';
    return 'alert';
}

function waterScoreLabel(score) {
    if (score === null) return 'Unavailable';
    if (score >= 80) return 'Very Good';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Moderate';
    return 'Low';
}

function drinkingScoreLabel(score) {
    if (score === null) return 'Unavailable';
    if (score >= 85) return 'Meets configured screening criteria';
    if (score >= 70) return 'Generally meets screening criteria';
    if (score >= 50) return 'Mixed screening result';
    if (score >= 30) return 'Below screening criteria';
    return 'Does not meet configured screening criteria';
}

function formatScientific(value) {
    if (value === null) return '--';
    if (value === 0) return '0';
    var exp = Math.floor(Math.log10(Math.abs(value)));
    var mantissa = value / Math.pow(10, exp);
    var sup = {'0':'\u2070','1':'\u00B9','2':'\u00B2','3':'\u00B3','4':'\u2074','5':'\u2075','6':'\u2076','7':'\u2077','8':'\u2078','9':'\u2079','-':'\u207B'};
    var expStr = String(exp).split('').map(function(ch) { return sup[ch] || ch; }).join('');
    return mantissa.toFixed(2) + ' \u00D7 10' + expStr;
}

function formatNumber(value, digits) {
    if (value === null || value === undefined) return '--';
    return Number(value).toFixed(digits == null ? 2 : digits);
}

function progressBar(score) {
    if (score === null) return '<span class="an-bar"><span class="an-bar-fill unknown" style="width:0%"></span></span>';
    var filled = Math.round(clamp(score, 0, 100));
    var cls = 'good';
    if (score < 40) cls = 'alert';
    else if (score < 60) cls = 'caution';
    return '<span class="an-bar"><span class="an-bar-fill ' + cls + '" style="width:' + filled + '%"></span></span>';
}

/* DERIVED PARAMETERS */

function calculateDerivedParameters(reading) {
    var tds = analysisNumber(reading.tds);
    var ph = analysisNumber(reading.ph);
    var turbidity = analysisNumber(reading.turbidity);
    var temperature = analysisNumber(reading.temperature);
    var estimatedEC = tds !== null ? tds / ANALYSIS_CONFIG.ec.tdsConversionFactor : null;
    var hydrogenIonConcentration = ph !== null ? Math.pow(10, -ph) : null;
    var salinityClass = 'Unavailable';
    if (tds !== null) {
        if (tds < ANALYSIS_CONFIG.irrigation.tdsNone) salinityClass = 'Low';
        else if (tds <= ANALYSIS_CONFIG.irrigation.tdsModerate) salinityClass = 'Moderate';
        else salinityClass = 'High';
    }
    var salinityIndex = null;
    if (tds !== null) {
        var cfg = ANALYSIS_CONFIG.irrigation;
        if (tds <= cfg.tdsNone) salinityIndex = 100;
        else if (tds <= cfg.tdsModerate) salinityIndex = 100 * (cfg.tdsModerate - tds) / (cfg.tdsModerate - cfg.tdsNone);
        else salinityIndex = Math.max(0, 40 * (3000 - tds) / 1000);
        salinityIndex = clamp(salinityIndex, 0, 100);
    }
    var phIndex = null;
    if (ph !== null) {
        var ir = ANALYSIS_CONFIG.irrigation;
        var pi = ANALYSIS_CONFIG.phIndex;
        if (ph >= ir.phMin && ph <= ir.phMax) phIndex = 100;
        else if (ph < ir.phMin) phIndex = Math.max(0, 100 * (ph - pi.lowerOuter) / (ir.phMin - pi.lowerOuter));
        else phIndex = Math.max(0, 100 * (pi.upperOuter - ph) / (pi.upperOuter - ir.phMax));
        phIndex = clamp(phIndex, 0, 100);
    }
    var clarityIndex = scoreClarity(turbidity);
    var temperatureIndex = null;
    if (temperature !== null) {
        var tc = ANALYSIS_CONFIG.temperature;
        if (temperature >= tc.preferredMin && temperature <= tc.preferredMax) temperatureIndex = 100;
        else if (temperature < tc.preferredMin) temperatureIndex = Math.max(0, 100 * (temperature - tc.lowerBound) / (tc.preferredMin - tc.lowerBound));
        else temperatureIndex = Math.max(0, 100 * (tc.upperBound - temperature) / (tc.upperBound - tc.preferredMax));
        temperatureIndex = clamp(temperatureIndex, 0, 100);
    }
    var analyticalWaterScore = null;
    var w = ANALYSIS_CONFIG.weights.overall;
    var components = [], weightParts = [];
    if (phIndex !== null) { components.push(w.ph * phIndex); weightParts.push(w.ph); }
    if (salinityIndex !== null) { components.push(w.salinity * salinityIndex); weightParts.push(w.salinity); }
    if (clarityIndex !== null) { components.push(w.turbidity * clarityIndex); weightParts.push(w.turbidity); }
    if (temperatureIndex !== null) { components.push(w.temperature * temperatureIndex); weightParts.push(w.temperature); }
    if (components.length > 0) {
        var totalWeight = weightParts.reduce(function(s, v) { return s + v; }, 0);
        if (totalWeight > 0) analyticalWaterScore = clamp(components.reduce(function(s, v) { return s + v; }, 0) / totalWeight, 0, 100);
    }
    return { estimatedEC: estimatedEC, hydrogenIonConcentration: hydrogenIonConcentration, salinityClass: salinityClass, salinityIndex: salinityIndex, phIndex: phIndex, clarityIndex: clarityIndex, temperatureIndex: temperatureIndex, analyticalWaterScore: analyticalWaterScore, tds: tds, ph: ph, turbidity: turbidity, temperature: temperature };
}

/* UI HELPERS */

function setAnalysisHtml(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

function setAnalysisNotice(html, level) {
    level = level || 'unknown';
    var notice = document.getElementById('analysisNotice');
    if (!notice) return;
    if (!html) { notice.className = 'analysis-notice hidden'; notice.innerHTML = ''; return; }
    notice.className = 'analysis-notice ' + level;
    notice.innerHTML = html;
}

function setText(id, value, fallback) {
    fallback = fallback || '--';
    var el = document.getElementById(id);
    if (el) el.textContent = (value !== null && value !== undefined && value !== '') ? value : fallback;
}

function formatTimestamp(isoString) {
    if (!isoString) return '--';
    var date = parseApiDate(isoString);
    if (Number.isNaN(date.getTime())) return String(isoString);
    return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function getParameterCondition(key, value) {
    if (value === null) return { text: 'Unavailable', level: 'unknown' };
    switch (key) {
        case 'temperature':
            if (value >= 15 && value <= 30) return { text: 'Within range', level: 'good' };
            if (value >= 5 && value <= 35) return { text: 'Moderate', level: 'caution' };
            return { text: 'Needs attention', level: 'alert' };
        case 'ph':
            if (value >= 6.5 && value <= 8.4) return { text: 'Within range', level: 'good' };
            if (value >= 6.0 && value <= 9.0) return { text: 'Moderate', level: 'caution' };
            return { text: 'Needs attention', level: 'alert' };
        case 'turbidity':
            if (value <= 1) return { text: 'Within range', level: 'good' };
            if (value <= 5) return { text: 'Moderate', level: 'caution' };
            return { text: 'Needs attention', level: 'alert' };
        case 'tds':
            if (value <= 450) return { text: 'Within range', level: 'good' };
            if (value <= 2000) return { text: 'Moderate', level: 'caution' };
            return { text: 'Needs attention', level: 'alert' };
        default: return { text: 'Within range', level: 'good' };
    }
}

/* RENDER FUNCTIONS */

function renderParamCard(label, value, unit, cond) {
    return '<div class="an-param-card">' +
        '<span class="an-param-label">' + label + '</span>' +
        '<div class="an-param-value"><strong>' + value + '</strong>' + (unit ? '<span>' + unit + '</span>' : '') + '</div>' +
        '<span class="an-param-cond status-' + cond.level + '"><i class="an-dot" aria-hidden="true"></i>' + cond.text + '</span>' +
        '</div>';
}

function renderScoreBar(label, value, note) {
    note = note || '';
    var v = value !== null ? Math.round(value) : null;
    var vText = v !== null ? v + '%' : '--';
    return '<div class="an-score-row">' +
        '<span class="an-score-label">' + label + (note ? '<span class="an-score-note">' + note + '</span>' : '') + '</span>' +
        progressBar(value) +
        '<span class="an-score-value">' + vText + '</span>' +
        '</div>';
}

/* Deterministic: names the lowest-scoring component of the existing
   analytical score. No invented data. */
function scoreLimitingNote(rows) {
    if (!rows || rows.length === 0) {
        return 'Component scores appear when sensor values are available.';
    }
    var lowest = null;
    rows.forEach(function (row) {
        if (!lowest || row.value < lowest.value) lowest = row;
    });
    if (lowest.value >= 100) {
        return 'All scored components are within their preferred ranges.';
    }
    return lowest.label + ' is currently the main factor limiting the overall analytical score.';
}

function renderApplicationRow(result) {
    var v = result.suitability !== null ? Math.round(result.suitability) : null;
    var vText = v !== null ? v + '%' : '--';
    var lbl = scoreLabel(result.suitability);
    var reason = result.reason || '';
    return '<div class="an-app-row">' +
        '<div class="an-app-top"><span class="an-app-name">' + result.name + '</span>' +
        '<span class="an-app-badge ' + scoreLevel(result.suitability) + '">' + lbl + '</span>' +
        '<span class="an-app-value">' + vText + '</span></div>' +
        progressBar(result.suitability) +
        (reason ? '<p class="an-app-reason">' + reason + '</p>' : '') +
        '</div>';
}

/* Ranked crop list: rank number, score, contribution breakdown. */
function renderCropRow(result, rank) {
    var v = result.suitability !== null ? Math.round(result.suitability) : null;
    var vText = v !== null ? v + '%' : '--';
    var lbl = scoreLabel(result.suitability);
    var contributions = [
        { label: 'pH', value: result.phScore },
        { label: 'Salinity', value: result.salinityScore },
        { label: 'Temp', value: result.temperatureScore },
        { label: 'Turbidity', value: result.turbidityScore }
    ];
    var chips = '';
    contributions.forEach(function (c) {
        chips += '<span class="an-contrib"><span>' + c.label + '</span><strong>' +
            (c.value !== null ? Math.round(c.value) : '--') + '</strong></span>';
    });
    return '<div class="an-crop-row">' +
        '<span class="an-rank" aria-hidden="true">' + String(rank).padStart(2, '0') + '</span>' +
        '<div class="an-crop-main">' +
        '<div class="an-crop-top"><span class="an-app-name">' + result.crop + '</span>' +
        '<span class="an-app-badge ' + scoreLevel(result.suitability) + '">' + lbl + '</span>' +
        '<span class="an-app-value">' + vText + '</span></div>' +
        progressBar(result.suitability) +
        '<div class="an-crop-contrib">' + chips + '</div>' +
        (result.reason ? '<p class="an-app-reason">' + result.reason + '</p>' : '') +
        '</div></div>';
}

function renderDrinkingScreening(screening) {
    var score = screening.score;
    var v = score !== null ? Math.round(score) : null;
    var vText = v !== null ? v + '%' : '--';
    var lbl = drinkingScoreLabel(score);
    var html = '<div class="an-drinking">';
    html += '<div class="an-drinking-score">' +
        '<span class="an-drinking-score-val">' + vText + '</span>' +
        '<span class="an-drinking-score-label">' + lbl + '</span></div>';
    html += '<div class="an-drinking-params">';
    screening.params.forEach(function(p) {
        var metCls = p.met === true ? 'met' : p.met === false ? 'not-met' : 'na';
        var valText = p.value !== null ? p.value + p.unit : '--';
        var statusText;
        if (p.met === true) statusText = 'Meets configured screening range';
        else if (p.met === false) statusText = 'Outside configured screening range';
        else statusText = 'Contextual — not a screening criterion';
        var icon = p.met === true
            ? '<i class="ri-check-line" aria-hidden="true"></i>'
            : p.met === false
                ? '<i class="ri-close-line" aria-hidden="true"></i>'
                : '<i class="ri-subtract-line" aria-hidden="true"></i>';
        html += '<div class="an-drinking-param ' + metCls + '">' +
            '<span class="an-drinking-param-name">' + p.name + '</span>' +
            '<span class="an-drinking-param-val">' + valText + '</span>' +
            '<span class="an-drinking-param-ref">Target: ' + p.refRange + '</span>' +
            '<span class="an-drinking-param-status">' + icon + statusText + '</span>' +
            '</div>';
    });
    html += '</div>';
    if (screening.reason) html += '<p class="an-drinking-reason">' + screening.reason + '</p>';
    html += '<p class="an-drinking-note">Screening based only on the available sensor parameters. This is not a laboratory drinking-water certification.</p>';
    html += '</div>';
    return html;
}

/* Water quality summary: ring score + compact parameter strip. */
function renderSummary(derived) {
    var score = derived.analyticalWaterScore;
    var v = score !== null ? Math.round(score) : null;
    var level = scoreLevel(score);
    var label = waterScoreLabel(score);
    var circumference = 2 * Math.PI * 52;
    var pct = v !== null ? clamp(v, 0, 100) : 0;
    var dash = circumference * (1 - pct / 100);
    var tempDisplay = derived.temperature !== null ? formatTempDisplay(derived.temperature, 1) : '--';
    var items = [
        { label: 'pH', value: derived.ph !== null ? formatNumber(derived.ph, 2) : '--', unit: '' },
        { label: 'Turbidity', value: derived.turbidity !== null ? formatNumber(derived.turbidity, 2) : '--', unit: ' NTU' },
        { label: 'TDS', value: derived.tds !== null ? formatNumber(derived.tds, 0) : '--', unit: ' mg/L' },
        { label: 'Temperature', value: tempDisplay, unit: '' }
    ];

    var html = '<div class="an-summary">';
    html += '<div class="an-summary-score">';
    html += '<div class="an-ring level-' + level + '" role="img" aria-label="Analytical score ' + (v !== null ? v : 'unavailable') + ' of 100">';
    html += '<svg viewBox="0 0 120 120" aria-hidden="true">';
    html += '<circle class="an-ring-track" cx="60" cy="60" r="52"></circle>';
    html += '<circle class="an-ring-value" cx="60" cy="60" r="52" stroke-dasharray="' + circumference.toFixed(1) + '" stroke-dashoffset="' + dash.toFixed(1) + '"></circle>';
    html += '</svg>';
    html += '<div class="an-ring-text"><strong>' + (v !== null ? v : '--') + '</strong><span>/ 100</span></div>';
    html += '</div>';
    html += '<div class="an-summary-label"><strong>' + label + '</strong><span>Aqua Sense Analytical Score</span></div>';
    html += '</div>';
    html += '<div class="an-summary-params">';
    items.forEach(function(item) {
        html += '<div class="an-summary-param"><span class="an-summary-param-label">' + item.label + '</span><strong>' + item.value + '</strong><span class="an-summary-param-unit">' + item.unit + '</span></div>';
    });
    html += '</div></div>';
    setAnalysisHtml('analysisSummary', html);
}

/* MAIN UPDATE FUNCTION */

























let currentAnalysisResults = { agriculture: [], industrial: [], domestic: [], general: [] };
let activeAnalysisCategory = 'agriculture';

window.switchAnalysisCategoryTab = function(category) {
    activeAnalysisCategory = category;
    document.querySelectorAll('.an-tab').forEach(function(tab) {
        if (tab.dataset.anTab === category) {
            tab.classList.add('active');
            tab.style.borderBottom = '2px solid var(--accent-primary)';
            tab.style.color = 'var(--text-primary)';
            tab.setAttribute('aria-selected', 'true');
        } else {
            tab.classList.remove('active');
            tab.style.borderBottom = '2px solid transparent';
            tab.style.color = 'var(--text-secondary)';
            tab.setAttribute('aria-selected', 'false');
        }
    });

    var results = currentAnalysisResults[category] || [];
    var ch = '';
    var icons = { 'agriculture': '🌾 ', 'industrial': '🏭 ', 'domestic': '🏡 ', 'general': '⚙️ ' };
    var icon = icons[category] || '📌 ';
    
    if (results.length > 0) {
        var topMatch = results[0];
        var topName = topMatch.result.crop || topMatch.result.name;
        var topScore = topMatch.result.suitability !== null ? Math.round(topMatch.result.suitability) : 0;
        var catTitles = { 'agriculture': 'AGRICULTURE', 'industrial': 'INDUSTRY', 'domestic': 'DOMESTIC', 'general': 'GENERAL UTILITY' };
        var sumHtml = '<div style="margin-bottom: 8px; padding: 12px; background: var(--bg-soft); border-radius: 8px;">' +
            '<div style="font-size: 11px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.5px;">' + catTitles[category] + ' SUMMARY</div>' +
            '<div style="font-size: 13px; color: var(--text-primary); margin-top: 4px;">Top configured match: <strong>' + escapeHtml(topName) + ' (' + topScore + '%)</strong></div>' +
            '</div>';
        setAnalysisHtml('analysisCategorySummary', sumHtml);
        
        var displayResults = category === 'agriculture' ? results.slice(0, 5) : results;
        displayResults.forEach(function(r, i) {
            ch += renderDetailedApplicationCard(r, category + '-' + i, icon);
        });
    } else {
        setAnalysisHtml('analysisCategorySummary', '');
    }
    setAnalysisHtml('analysisApplicationContent', ch);
};

window.toggleAnalysisDetails = function(id) {
    var el = document.getElementById(id);
    var btn = document.getElementById(id + '-btn');
    if (el) {
        var isHidden = el.classList.contains('hidden');
        if (isHidden) {
            document.querySelectorAll('.analysis-detail-dropdown').forEach(function(d) { d.classList.add('hidden'); });
            document.querySelectorAll('.analysis-detail-btn, .analysis-application-row').forEach(function(b) {
                b.setAttribute('aria-expanded', 'false');
                var orig = b.getAttribute('data-why-label');
                if(orig && b.classList.contains('analysis-application-row')){
                    var chev = b.querySelector('.an-row-chevron');
                    if(chev) chev.textContent = '\u25BE';
                    var whySpan = b.querySelector('.an-row-why');
                    if(whySpan) whySpan.textContent = orig.replace(' \u25BE','') + ' \u25BE';
                } else if(orig){
                    b.innerHTML = orig;
                }
            });
            el.classList.remove('hidden');
            if (btn) {
                btn.setAttribute('aria-expanded', 'true');
                if(btn.classList.contains('analysis-application-row')){
                    var ch = btn.querySelector('.an-row-chevron');
                    if(ch) ch.textContent = '\u25B4';
                    var ws = btn.querySelector('.an-row-why');
                    if(ws) ws.textContent = 'Close \u25B4';
                } else {
                    btn.innerHTML = 'Close explanation \u25B4';
                }
            }
        } else {
            el.classList.add('hidden');
            if (btn) {
                btn.setAttribute('aria-expanded', 'false');
                if(btn.classList.contains('analysis-application-row')){
                    var ch2 = btn.querySelector('.an-row-chevron');
                    if(ch2) ch2.textContent = '\u25BE';
                    var ws2 = btn.querySelector('.an-row-why');
                    var orig2b = btn.getAttribute('data-why-label') || 'Why does this suit the water? \u25BE';
                    if(ws2) ws2.textContent = orig2b.replace(' \u25BE','') + ' \u25BE';
                } else {
                    var orig2 = btn.getAttribute('data-why-label') || 'Why does this suit the water? \u25BE';
                    btn.innerHTML = orig2;
                }
            }
        }
    }
};

function formatProfileRef(profile, type, param){
    if(type==='agriculture'){
        if(param==='ph') return profile.phMin.toFixed(1)+' \u2013 '+profile.phMax.toFixed(1)+' (ideal), outer '+(profile.phMin-2).toFixed(1)+' \u2013 '+(profile.phMax+2).toFixed(1);
        if(param==='ec') return '\u2264 '+Number(profile.ecwFullYield).toFixed(2)+' dS/m (full-yield threshold)';
        if(param==='turbidity') return '\u2264 '+profile.turbidityPreferred+' NTU preferred';
        if(param==='temperature') return profile.temperatureMin+' \u2013 '+profile.temperatureMax+'\u00B0C ideal';
    } else {
        if(param==='ph') return profile.phMin.toFixed(1)+' \u2013 '+profile.phMax.toFixed(1)+' ideal ('+profile.phLower.toFixed(1)+' \u2013 '+profile.phUpper.toFixed(1)+' outer)';
        if(param==='tds') return '\u2264 '+profile.tdsMaximum+' mg/L max (preferred \u2264 '+profile.tdsPreferred+')';
        if(param==='turbidity') return '\u2264 '+profile.turbidityPreferred+' NTU preferred, \u2264 '+profile.turbidityMaximum+' NTU max';
        if(param==='temperature') return profile.temperatureMin+' \u2013 '+profile.temperatureMax+'\u00B0C ideal';
    }
    return '--';
}
function getParameterInterpretation(opts){
    var score = opts.score, current = opts.current, ref = opts.ref, param = opts.param;
    if(score===null || current===null) return {text:'Not available', tone:'neutral'};
    if(score>=85) return {text: param==='ec' || param==='tds' ? 'Within configured target range' : 'Within configured target range', tone:'good'};
    if(score>=70) return {text:'Close to configured limit \u2014 reduces suitability slightly', tone:'caution'};
    if(score>=50) return {text:'Outside preferred range \u2014 contributes to reduced suitability', tone:'caution'};
    if(score>=30) return {text:'Well outside preferred range \u2014 strongly limiting', tone:'alert'};
    return {text:'Outside suitability range \u2014 severely limiting', tone:'alert'};
}
/* Numeric deviation of a reading from its reference, e.g. "+20 mg/L over".
 * Slightly-over values reduce suitability gradually (the scoring engine
 * ramps down) — this makes the exact excess visible next to the score. */
function formatDeviation(current, low, high, unit, digits){
    if(current===null || current===undefined || !Number.isFinite(Number(current))) return {text:'--', tone:'neutral'};
    var d = (digits===undefined) ? 2 : digits;
    var val = Number(current);
    function num(x){ return Number(x).toFixed(d); }
    if(val < low) return {text: num(low-val)+unit+' under', tone:'alert'};
    if(val > high){
        var over = val-high;
        var pct = high > 0 ? (over/high)*100 : 100;
        return {text: '+'+num(over)+unit+' over', tone: pct <= 10 ? 'caution' : 'alert'};
    }
    return {text:'Within reference', tone:'good'};
}
function deviationToneColor(tone){
    if(tone==='good') return 'var(--status-normal)';
    if(tone==='caution') return 'var(--amber)';
    if(tone==='alert') return 'var(--status-critical)';
    return 'var(--text-muted)';
}
/* Sentence-style delta against a profile bound for application cards, e.g.
 * "+20 mg/L over the 500 mg/L maximum". Empty string when within bounds. */
function deviationNote(key, current, profile, type){
    if(current===null || current===undefined || !Number.isFinite(Number(current)) || !profile) return '';
    var val = Number(current);
    if(key==='ph'){
        if(val < profile.phMin) return (profile.phMin-val).toFixed(2)+' under the '+profile.phMin.toFixed(1)+' minimum';
        if(val > profile.phMax) return '+'+(val-profile.phMax).toFixed(2)+' over the '+profile.phMax.toFixed(1)+' maximum';
        return '';
    }
    if(key==='ec' && type==='agriculture'){
        if(val > profile.ecwFullYield) return '+'+(val-profile.ecwFullYield).toFixed(2)+' dS/m over the '+profile.ecwFullYield.toFixed(2)+' dS/m full-yield threshold';
        return '';
    }
    if(key==='tds'){
        if(val > profile.tdsMaximum) return '+'+Math.round(val-profile.tdsMaximum)+' mg/L over the '+profile.tdsMaximum+' mg/L maximum';
        return '';
    }
    if(key==='turbidity'){
        var max = (type==='agriculture') ? null : profile.turbidityMaximum;
        if(max !== null && val > max) return '+'+(val-max).toFixed(2)+' NTU over the '+max+' NTU maximum';
        if(val > profile.turbidityPreferred) return '+'+(val-profile.turbidityPreferred).toFixed(2)+' NTU above the '+profile.turbidityPreferred+' NTU preferred limit';
        return '';
    }
    if(key==='temperature'){
        if(val < profile.temperatureMin) return (profile.temperatureMin-val).toFixed(1)+'\u00B0C under the '+profile.temperatureMin+'\u00B0C minimum';
        if(val > profile.temperatureMax) return '+'+(val-profile.temperatureMax).toFixed(1)+'\u00B0C over the '+profile.temperatureMax+'\u00B0C maximum';
        return '';
    }
    return '';
}
function describeCurrentVsRef(current, profile, type, param){
    if(current===null) return 'Not available';
    if(type==='agriculture' && param==='ec'){
        var ec = current;
        if(ec <= profile.ecwFullYield) return 'Current EC '+ec.toFixed(2)+' dS/m is at or below the '+profile.ecwFullYield.toFixed(2)+' dS/m full-yield threshold \u2014 within range.';
        if(ec <= profile.ecwFullYield*2) return 'Current EC '+ec.toFixed(2)+' dS/m is above the '+profile.ecwFullYield.toFixed(2)+' dS/m threshold \u2014 salinity score reduced.';
        return 'Current EC '+ec.toFixed(2)+' dS/m is well above the threshold \u2014 suitability strongly reduced.';
    }
    if(param==='ph'){
        if(current >= profile.phMin && current <= profile.phMax) return 'Current pH '+current.toFixed(2)+' is within the configured ideal range '+profile.phMin.toFixed(1)+' \u2013 '+profile.phMax.toFixed(1)+'.';
        if(current >= profile.phMin-2 && current <= profile.phMax+2) return 'Current pH '+current.toFixed(2)+' is outside the ideal '+profile.phMin.toFixed(1)+' \u2013 '+profile.phMax.toFixed(1)+' but within outer tolerance.';
        return 'Current pH '+current.toFixed(2)+' is outside the suitability range.';
    }
    if(param==='tds'){
        if(current <= profile.tdsMaximum) return 'Current TDS '+Math.round(current)+' mg/L is at or below the '+profile.tdsMaximum+' mg/L maximum.';
        return 'Current TDS '+Math.round(current)+' mg/L is above the '+profile.tdsMaximum+' mg/L maximum.';
    }
    if(param==='turbidity'){
        if(current <= profile.turbidityPreferred) return 'Current turbidity '+current.toFixed(2)+' NTU is within the preferred limit.';
        if(current <= profile.turbidityMaximum) return 'Current turbidity '+current.toFixed(2)+' NTU is above the preferred '+profile.turbidityPreferred+' NTU but below the '+profile.turbidityMaximum+' NTU maximum.';
        return 'Current turbidity '+current.toFixed(2)+' NTU exceeds the maximum.';
    }
    if(param==='temperature'){
        if(current >= profile.temperatureMin && current <= profile.temperatureMax) return 'Current temperature '+current.toFixed(1)+'\u00B0C is within the ideal '+profile.temperatureMin+'\u2013'+profile.temperatureMax+'\u00B0C.';
        if(current >= profile.temperatureLower && current <= profile.temperatureUpper) return 'Current temperature '+current.toFixed(1)+'\u00B0C is outside the ideal but within outer tolerance.';
        return 'Current temperature '+current.toFixed(1)+'\u00B0C is outside the suitability range.';
    }
    return '';
}
function renderDetailedApplicationCard(item, idPrefix, icon) {
    var profile = item.profile;
    var result = item.result;
    var type = item.type;
    var currentDerived = item.currentDerived;
    var currentReading = item.currentReading;
    var name = result.crop || result.name;
    var score = result.suitability !== null ? Math.round(result.suitability) : 0;
    var clsInfo = getQualityClass(score);
    var label = clsInfo.label;
    var color = clsInfo.color;
    var phScore = result.phScore;
    var turbScore = result.turbidityScore;
    var tempScore = result.temperatureScore;
    var salScore, salLabel, salCurrentRaw;
    if (type === 'agriculture') {
        salScore = result.salinityScore;
        salLabel = "EC";
        salCurrentRaw = currentDerived.estimatedEC;
    } else {
        salScore = result.tdsScore;
        salLabel = "TDS";
        salCurrentRaw = currentReading.tds;
    }
    var phCurrentRaw = currentReading.ph;
    var turbCurrentRaw = currentReading.turbidity;
    var tempCurrentRaw = currentReading.temperature;
    var components = [
        { key:'ph', name:'pH', score: phScore, current: phCurrentRaw, ref: formatProfileRef(profile, type, 'ph') },
        { key: salLabel==='EC'?'ec':'tds', name: salLabel==='EC' ? 'Salinity / EC' : 'Salinity / TDS', score: salScore, current: salCurrentRaw, ref: formatProfileRef(profile, type, salLabel==='EC'?'ec':'tds') },
        { key:'turbidity', name:'Clarity', score: turbScore, current: turbCurrentRaw, ref: formatProfileRef(profile, type, 'turbidity') },
        { key:'temperature', name:'Temperature', score: tempScore, current: tempCurrentRaw, ref: formatProfileRef(profile, type, 'temperature') }
    ];
    var minScore = 101;
    var limitingFactor = null;
    components.forEach(function(c){ if(c.score!==null && c.score < minScore){ minScore=c.score; limitingFactor=c; }});
    var alsoReducing = [];
    if(limitingFactor) alsoReducing = components.filter(function(c){ return c!==limitingFactor && c.score!==null && c.score<70; }).sort(function(a,b){return a.score-b.score;}).slice(0,2);
    var whyLabel = getApplicationWhyLabel(score);
    var headingText = (score>=90) ? 'WHY THIS APPLICATION SUITS THE WATER' : (score>=75) ? 'WHY THIS APPLICATION IS A SUITABLE MATCH' : (score>=50) ? 'WHY THIS APPLICATION IS A MODERATE MATCH' : (score>=30) ? 'WHY THIS APPLICATION IS A LOW MATCH' : 'WHY THIS APPLICATION IS A POOR MATCH';
    var helping = components.filter(function(c){ return c.score!==null && c.score>=70; });
    var reducing = components.filter(function(c){ return c.score!==null && c.score<70; });
    var limitLine = limitingFactor ? 'Main limiting factor: '+escapeHtml(limitingFactor.name)+' \u2014 '+Math.round(limitingFactor.score)+'%' : 'Main limiting factor: Not available';
    if(alsoReducing.length) limitLine += '<span style="color:var(--text-muted);font-weight:400"> \u00B7 Also reducing: '+alsoReducing.map(function(c){return escapeHtml(c.name)+' \u2014 '+Math.round(c.score)+'%';}).join(', ')+'</span>';
    var weights = type==='agriculture' ? {salinity:0.45, ph:0.25, temperature:0.20, turbidity:0.10} : profile.weights;
    var weightMap = {};
    if(type==='agriculture'){ weightMap={'pH': weights.ph, 'Salinity / EC': weights.salinity, 'Clarity': weights.turbidity, 'Temperature': weights.temperature}; }
    else { weightMap={'pH': weights.ph, 'Salinity / TDS': weights.tds, 'Clarity': weights.turbidity, 'Temperature': weights.temperature}; }
    var weightSentence = 'Weighted score: '+Object.keys(weightMap).map(function(k){return k.toLowerCase()+' '+Math.round(weightMap[k]*100)+'%';}).join(' \u00B7 ')+'.';
    // Build expanded short block
    var helpLines = helping.map(function(c){
        var cur = c.current===null ? 'Not available' : (c.key==='ec' ? formatNumber(c.current,2)+' dS/m' : c.key==='tds' ? formatNumber(c.current,0)+' mg/L' : c.key==='ph' ? formatNumber(c.current,2) : c.key==='turbidity' ? formatNumber(c.current,2)+' NTU' : formatNumber(c.current,1)+'\u00B0C');
        var refShort = c.ref.split('(')[0].trim();
        var dev = deviationNote(c.key, c.current, profile, type);
        var state = dev ? 'just outside '+escapeHtml(refShort)+' \u00B7 '+escapeHtml(dev) : 'within '+escapeHtml(refShort);
        return '\u2022 '+escapeHtml(c.name)+' '+escapeHtml(cur)+' \u2014 '+state+' ('+Math.round(c.score)+'%)';
    }).join('<br>');
    var reduceLines = reducing.map(function(c){
        var cur = c.current===null ? 'Not available' : (c.key==='ec' ? formatNumber(c.current,2)+' dS/m' : c.key==='tds' ? formatNumber(c.current,0)+' mg/L' : c.key==='ph' ? formatNumber(c.current,2) : c.key==='turbidity' ? formatNumber(c.current,2)+' NTU' : formatNumber(c.current,1)+'\u00B0C');
        var interp = escapeHtml(getParameterInterpretation({param:c.key, current:c.current, score:c.score}).text.toLowerCase());
        var dev = deviationNote(c.key, c.current, profile, type);
        return '\u2022 '+escapeHtml(c.name)+' '+escapeHtml(cur)+' \u2014 '+interp+' ('+Math.round(c.score)+'%)'+(dev ? ' \u00B7 <strong>'+escapeHtml(dev)+'</strong>' : '');
    }).join('<br>');
    var expHtml = '<div id="' + idPrefix + '-exp" class="analysis-detail-dropdown hidden" style="margin-top:0;padding:14px 16px;background:var(--bg-soft);border-top:1px solid var(--border-subtle)">'
        +'<div style="font-size:11px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-primary);margin-bottom:10px">'+headingText+'</div>'
        +(helping.length ? '<div style="font-size:11px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;color:var(--status-normal);margin-bottom:4px">Helping the score</div><div style="font-size:12px;line-height:1.7;color:var(--text-secondary)">'+helpLines+'</div>' : '')
        +(reducing.length ? '<div style="font-size:11px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;color:var(--status-critical);margin-top:10px;margin-bottom:4px">Reducing suitability</div><div style="font-size:12px;line-height:1.7;color:var(--text-secondary)">'+reduceLines+'</div>' : '')
        +'<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border-subtle)"><div style="font-size:11px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;color:var(--text-muted)">Main limiting factor</div><div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-top:2px">'+escapeHtml(limitingFactor ? limitingFactor.name+' \u2014 '+Math.round(limitingFactor.score)+'%' : 'Not available')+'</div></div>'
        +'<div style="margin-top:10px;font-size:12px;color:var(--text-secondary)"><strong>Overall:</strong> '+score+'% \u2014 '+escapeHtml(label)+'</div>'
        +'<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">'+escapeHtml(weightSentence)+'</div>'
        +'<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">'+ (type === 'agriculture' ? 'Prediction based on available water parameters; field conditions also influence crop performance.' : 'Analytical suitability estimate based on available water parameters.') +'</div>'
        +'</div>';
    // Simple row
    return '<div class="an-app-row-wrap" style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;overflow:hidden">'
        +'<button id="' + idPrefix + '-btn" class="analysis-application-row" type="button" aria-expanded="false" aria-controls="' + idPrefix + '-exp" data-why-label="'+escapeHtml(whyLabel)+'" onclick="toggleAnalysisDetails(\'' + idPrefix + '-exp\')" style="width:100%;text-align:left;background:transparent;border:none;padding:14px 16px;cursor:pointer;display:flex;flex-direction:column;gap:8px">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%">'
        +'<span style="font-size:14px;font-weight:600;color:var(--text-primary)">'+escapeHtml(name)+'</span>'
        +'<span style="display:flex;align-items:center;gap:10px;flex-shrink:0"><span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;background:'+(clsInfo.bg||'var(--status-critical-bg)')+';color:'+color+';border:1px solid currentColor">'+escapeHtml(label)+'</span><span style="font-size:14px;font-weight:700;color:'+color+'">'+score+'%</span><span class="an-row-chevron" style="font-size:12px;color:var(--text-muted)">\u25BE</span></span>'
        +'</div>'
        +'<div style="height:4px;background:var(--bg-soft);border-radius:2px;overflow:hidden;width:100%"><div style="height:100%;width:'+score+'%;background:'+color+'"></div></div>'
        +'<div style="display:flex;justify-content:space-between;align-items:center;width:100%;font-size:11px;color:var(--text-secondary)"><span>'+limitLine+'</span><span class="an-row-why" style="color:var(--text-muted);font-size:11px">'+escapeHtml(whyLabel.replace(' \u25BE',''))+' \u25BE</span></div>'
        +'</button>'
        +expHtml
        +'</div>';
}


function buildSvgRing(score, size){
    size = size||120;
    var v = score===null||score===undefined?null:Math.round(Number(score));
    var pct = v===null?0:Math.max(0,Math.min(100,v));
    var level = (function(s){ if(s===null) return 'unknown'; if(s>=70) return 'good'; if(s>=50) return 'caution'; return 'alert'; })(v);
    var circ = 2*Math.PI*52;
    var dash = circ*(1-pct/100);
    var label = (function(s){ if(s===null) return 'Unavailable'; if(s>=80) return 'Very Good'; if(s>=60) return 'Good'; if(s>=40) return 'Moderate'; return 'Low'; })(v);
    var display = v===null?'--':String(v);
    return '<div class="an-ring level-'+level+'" role="img" aria-label="Analytical score '+(v===null?'unavailable':v+' of 100')+'">'
        +'<svg viewBox="0 0 120 120" aria-hidden="true"><circle class="an-ring-track" cx="60" cy="60" r="52"></circle>'
        +'<circle class="an-ring-value" cx="60" cy="60" r="52" stroke-dasharray="'+circ.toFixed(1)+'" stroke-dashoffset="'+dash.toFixed(1)+'"></circle></svg>'
        +'<div class="an-ring-text"><strong>'+display+'</strong><span>/ 100</span></div></div>'
        +'<div class="an-hero-text"><strong class="an-hero-label">'+label+'</strong><span class="an-hero-sub">Aqua Sense Analytical Score</span></div>';
}
function renderAnParamCard(label, value, unit, cond){
    var lvl = cond&&cond.level?cond.level:'unknown';
    var txt = cond&&cond.text?cond.text:'--';
    var unitHtml = unit ? '<span class="an-param-unit" style="margin-left:4px">'+escapeHtml(unit)+'</span>' : '';
    return '<div class="an-param-card an-param-'+lvl+'"><span class="an-param-label">'+escapeHtml(label)+'</span><div class="an-param-value"><strong>'+escapeHtml(value)+'</strong>'+unitHtml+'</div><span class="an-param-cond status-'+lvl+'"><i class="an-dot" aria-hidden="true"></i>'+escapeHtml(txt)+'</span></div>';
}
function renderAnDerivedRow(label, value, hint){
    var hintHtml = hint ? '<span class="an-derived-hint" style="display:block;font-size:11px;color:var(--text-muted);margin-top:2px;text-transform:capitalize">'+escapeHtml(hint)+'</span>' : '';
    return '<div class="an-derived-item" style="display:flex;flex-direction:column;gap:4px;padding:10px"><div><span class="an-derived-label" style="font-size:12px;color:var(--text-secondary)">'+escapeHtml(label)+'</span>'+hintHtml+'</div><strong class="an-derived-val" style="font-size:14px">'+escapeHtml(value)+'</strong></div>';
}
function normalizeAppResult(item){
    var r=item.result, p=item.profile;
    var phScore = r.phScore!==undefined?r.phScore:r.phScore;
    var tdsScore = r.tdsScore!==undefined?r.tdsScore:null;
    var turbScore = r.turbidityScore!==undefined?r.turbidityScore:r.turbScore;
    var tempScore = r.temperatureScore!==undefined?r.temperatureScore:null;
    var salScore = null, salLabel='Salinity', salRef='--';
    if(item.type==='agriculture'){
        salScore = r.salinityScore!==undefined?r.salinityScore:null;
        salLabel='Salinity / EC';
        salRef = p.ecwFullYield!==undefined?Number(p.ecwFullYield).toFixed(2)+' dS/m':'--';
    } else {
        salScore = tdsScore;
        salLabel='Salinity / TDS';
        salRef = p.tdsMaximum!==undefined?String(p.tdsMaximum)+' mg/L':'--';
    }
    return { name: r.crop||r.name||p.name, suitability:r.suitability, phScore:phScore, tdsScore:tdsScore, turbScore:turbScore, tempScore:tempScore, salScore:salScore, salLabel:salLabel, salRef:salRef };
}

function updateAnalysisPage() {
    var reading = latestReading;
    var notice = document.getElementById('analysisNotice');
    var timeEl = document.getElementById('analysisReadingTime');
    if(timeEl) timeEl.textContent = reading?formatAnalysisTime(reading.recorded_at):'--';
    if(!reading){
        setAnalysisHtml('analysisSummary','<div class="an-empty"><i class="ri-drop-line" aria-hidden="true"></i><strong>No water-quality reading available</strong><p>Connect your device and refresh to see the analytical assessment.</p></div>');
        setAnalysisHtml('analysisCurrentParams','<div class="an-empty small">No sensor data available.</div>');
        setAnalysisHtml('analysisDerivedParams','<div class="an-empty small">Derived values appear when a reading is available.</div>');
        setAnalysisHtml('analysisScoreSection','<div class="an-empty small">Score breakdown appears when data is available.</div>');
        setAnalysisHtml('analysisKeyLimitingFactor','');
        setAnalysisHtml('analysisCategorySummary','');
        setAnalysisHtml('analysisApplicationContent','<div class="an-empty small">Application results appear when data is available.</div>');
        setAnalysisHtml('analysisDrinkingSection','<div class="an-empty small">Drinking screening appears when data is available.</div>');
        if(notice){ notice.className='analysis-notice hidden'; notice.innerHTML=''; }
        return;
    }
    var derived = calculateDerivedParameters(reading);
    if(!derived){
        if(notice){ notice.className='analysis-notice alert'; notice.innerHTML='<strong>Unable to calculate derived parameters for this reading.</strong>'; }
        return;
    }
    if(notice){ notice.className='analysis-notice hidden'; notice.innerHTML=''; }
    // Hero
    var overall = derived.analyticalWaterScore;
    var hero = '<div class="an-hero-inner">'+buildSvgRing(overall)+'</div>';
    setAnalysisHtml('analysisSummary', hero);
    // Measured
    var phCond = getParameterCondition('ph', derived.ph);
    var tdsCond = getParameterCondition('tds', derived.tds);
    var turbCond = getParameterCondition('turbidity', derived.turbidity);
    var tempCond = getParameterCondition('temperature', derived.temperature);
    var fmt = function(v,d){ return v!==null&&v!==undefined?Number(v).toFixed(d):'--'; };
    var phVal = derived.ph!==null?fmt(derived.ph,2):'--';
    var tdsVal = derived.tds!==null?fmt(derived.tds,0):'--';
    var turbVal = derived.turbidity!==null?fmt(derived.turbidity,2):'--';
    var tempVal = derived.temperature!==null?formatTempDisplay(derived.temperature,1):'--';
    var measuredHtml = renderAnParamCard('pH', phVal, '', phCond)
        + renderAnParamCard('Turbidity', turbVal, 'NTU', turbCond)
        + renderAnParamCard('TDS', tdsVal, 'mg/L', tdsCond)
        + renderAnParamCard('Temperature', tempVal, '', tempCond);
    setAnalysisHtml('analysisCurrentParams', measuredHtml);
    // Derived
    var ecVal = derived.estimatedEC!==null?fmt(derived.estimatedEC,2)+' dS/m':'Not available';
    var hVal = derived.hydrogenIonConcentration!==null?Number(derived.hydrogenIonConcentration).toExponential(2)+' mol/L':'Not available';
    var salIdx = derived.salinityIndex!==null?Math.round(derived.salinityIndex)+'%':'Not available';
    var clarIdx = derived.clarityIndex!==null?Math.round(derived.clarityIndex)+'%':'Not available';
    var phIdx = derived.phIndex!==null?Math.round(derived.phIndex)+'%':'Not available';
    var tempIdx = derived.temperatureIndex!==null?Math.round(derived.temperatureIndex)+'%':'Not available';
    var derivedHtml = renderAnDerivedRow('Estimated EC', ecVal, 'Calculated')
        + renderAnDerivedRow('H+ Concentration', hVal, '')
        + renderAnDerivedRow('Salinity', salIdx, derived.salinityClass||'')
        + renderAnDerivedRow('Clarity', clarIdx, '')
        + renderAnDerivedRow('pH Index', phIdx, '')
        + renderAnDerivedRow('Temperature Index', tempIdx, '');
    setAnalysisHtml('analysisDerivedParams', derivedHtml);
    // Score breakdown
    var rows = [
        {label:'pH', value:derived.phIndex},
        {label:'Salinity', value:derived.salinityIndex},
        {label:'Clarity', value:derived.clarityIndex},
        {label:'Temperature', value:derived.temperatureIndex}
    ];
    var breakdownHtml = rows.map(function(r){
        var v = r.value!==null?Math.round(r.value):null;
        var txt = v!==null?v+'%':'Not available';
        var lvl = (function(s){ if(s===null) return 'unknown'; if(s>=70) return 'good'; if(s>=50) return 'caution'; return 'alert'; })(v);
        var w = v!==null?v:0;
        return '<div class="an-score-row"><span class="an-score-label">'+r.label+'</span><span class="an-bar" aria-hidden="true"><span class="an-bar-fill '+lvl+'" style="width:'+w+'%"></span></span><strong class="an-score-value">'+txt+'</strong></div>';
    }).join('');
    setAnalysisHtml('analysisScoreSection', breakdownHtml);
    // Key finding
    var bestRows = rows.filter(function(r){return r.value!==null;});
    var limiting = null;
    bestRows.forEach(function(r){ if(!limiting||r.value<limiting.value) limiting=r; });
    var limitingHtml = '';
    if(limiting){
        if(limiting.value>=100) limitingHtml='<div class="an-limiting good"><strong>Key finding</strong><p>All component scores are within their preferred ranges.</p></div>';
        else limitingHtml='<div class="an-limiting"><strong>Key finding — Overall limiting component: '+escapeHtml(limiting.label)+' — '+Math.round(limiting.value)+'%</strong><p>'+escapeHtml(limiting.label)+' is the strongest limiting parameter for the overall analytical score (distinct from application-specific limiting factors below).</p></div>';
    } else limitingHtml='<div class="an-limiting"><p>Component scores appear when sensor values are available.</p></div>';
    setAnalysisHtml('analysisKeyLimitingFactor', limitingHtml);
    // Applications
    currentAnalysisResults.agriculture = CROP_PROFILES.map(function(c){ return {profile:c, result:calculateCropScore(reading,c), type:'agriculture', currentDerived:derived, currentReading:reading}; }).sort(function(a,b){return (b.result.suitability||0)-(a.result.suitability||0);});
    currentAnalysisResults.industrial = INDUSTRIAL_PROFILES.map(function(p){ return {profile:p, result:calculateApplicationScore(reading,p), type:'industrial', currentDerived:derived, currentReading:reading}; }).sort(function(a,b){return (b.result.suitability||0)-(a.result.suitability||0);});
    currentAnalysisResults.domestic = DOMESTIC_PROFILES.map(function(p){ return {profile:p, result:calculateApplicationScore(reading,p), type:'domestic', currentDerived:derived, currentReading:reading}; }).sort(function(a,b){return (b.result.suitability||0)-(a.result.suitability||0);});
    currentAnalysisResults.general = GENERAL_PROFILES.map(function(p){ return {profile:p, result:calculateApplicationScore(reading,p), type:'general', currentDerived:derived, currentReading:reading}; }).sort(function(a,b){return (b.result.suitability||0)-(a.result.suitability||0);});
    var tabs = document.querySelectorAll('.an-tab');
    if(tabs.length>0 && !tabs[0].hasAttribute('data-an-bound')){
        tabs.forEach(function(t){ t.setAttribute('data-an-bound','true'); t.addEventListener('click', function(e){ switchAnalysisCategoryTab(e.currentTarget.dataset.anTab); }); });
    }
    switchAnalysisCategoryTab(activeAnalysisCategory);
    // Drinking
    var dr = DRINKING_PROFILE;
    var dRes = calculateApplicationScore(reading, dr);
    var dScore = dRes.suitability;
    var dV = dScore!==null?Math.round(dScore):null;
    var dLbl = scoreLabel(dScore);
    var dLevel = (function(s){ if(s===null) return 'unknown'; if(s>=70) return 'good'; if(s>=50) return 'caution'; return 'alert'; })(dScore);
    var phScoreTxt = dRes.phScore!==null?Math.round(dRes.phScore)+'%':'Not available';
    var tdsScoreTxt = dRes.tdsScore!==null?Math.round(dRes.tdsScore)+'%':'Not available';
    var turbScoreTxt = dRes.turbidityScore!==null?Math.round(dRes.turbidityScore)+'%':'Not available';
    var devCell = function(dev){ return '<span style="font-weight:600;color:'+deviationToneColor(dev.tone)+'">'+escapeHtml(dev.text)+'</span>'; };
    var drinkingHtml = '<div class="an-drinking-head"><div><strong class="an-drinking-score">'+(dV!==null?dV+'%':'Not available')+'</strong><span class="an-drinking-label '+dLevel+'">'+dLbl+'</span></div><span class="an-bar" aria-hidden="true" style="max-width:220px"><span class="an-bar-fill '+dLevel+'" style="width:'+(dV!==null?dV:0)+'%"></span></span></div>'
        +'<div class="an-table-scroll"><div class="an-drinking-table" role="table" aria-label="Drinking screening parameters">'
        +'<div class="an-drinking-row head" role="row"><span role="columnheader">Parameter</span><span role="columnheader">Current</span><span role="columnheader">Reference</span><span role="columnheader">Difference</span><span role="columnheader">Score</span></div>'
        +'<div class="an-drinking-row" role="row"><span>pH</span><span>'+(derived.ph!==null?fmt(derived.ph,2):'Not available')+'</span><span>6.5 – 8.5</span><span>'+devCell(formatDeviation(derived.ph, 6.5, 8.5, '', 2))+'</span><span>'+phScoreTxt+'</span></div>'
        +'<div class="an-drinking-row" role="row"><span>TDS</span><span>'+(derived.tds!==null?fmt(derived.tds,0)+' mg/L':'Not available')+'</span><span>&lt; '+dr.tdsMaximum+' mg/L</span><span>'+devCell(formatDeviation(derived.tds, 0, dr.tdsMaximum, ' mg/L', 0))+'</span><span>'+tdsScoreTxt+'</span></div>'
        +'<div class="an-drinking-row" role="row"><span>Turbidity</span><span>'+(derived.turbidity!==null?fmt(derived.turbidity,2)+' NTU':'Not available')+'</span><span>&lt; '+dr.turbidityMaximum+' NTU</span><span>'+devCell(formatDeviation(derived.turbidity, 0, dr.turbidityMaximum, ' NTU', 2))+'</span><span>'+turbScoreTxt+'</span></div>'
        +'</div></div>'
        +'<p class="an-drinking-note">Screening assessment based on available sensor parameters; laboratory verification is separate.</p>';
    setAnalysisHtml('analysisDrinkingSection', drinkingHtml);
}

function escapeHtml(value)
 {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function retryAnalysisLoad() {
    latestReading = null;
    analysisLoadError = null;
    analysisLoading = true;
    updateAnalysisPage();
    await loadAnalysisLatestReading();
    updateAnalysisPage();
}

function setupAnalysisNotice() {
    var notice = document.getElementById('analysisNotice');
    if (!notice || notice.dataset.analysisNoticeReady === 'true') return;
    notice.dataset.analysisNoticeReady = 'true';
    notice.addEventListener('click', async function(event) {
        var button = event.target.closest('[data-analysis-action="retry"]');
        if (!button) return;
        button.disabled = true;
        await retryAnalysisLoad();
    });
}

function setupAnalysisTabs() {
    if (document.body.dataset.analysisTabsReady !== 'true') {
        document.body.dataset.analysisTabsReady = 'true';
        document.addEventListener('click', function(event) {
            var tab = event.target.closest('.an-tab');
            if (tab && tab.dataset.anTab) switchAnalysisTab(tab.dataset.anTab);
        });
    }
    setupAnalysisNotice();
}

function switchAnalysisTab(tabName) {
    if (!tabName) return;
    document.querySelectorAll('.an-tab').forEach(function(tab) {
        tab.classList.toggle('active', tab.dataset.anTab === tabName);
    });
    document.querySelectorAll('.an-tab-panel').forEach(function(panel) {
        panel.classList.toggle('active', panel.dataset.anPanel === tabName);
    });
}

function setupSensorChat() {
    const form = $("chatForm") || $("sensorChatForm");
    const input = $("chatInput") || $("sensorChatInput");
    const messages = $("chatMessages") || $("sensorChatMessages");
    const sendButton = $("sendChatButton") || $("chatSendButton");
    if (!form || !input || !messages) return;

    // Update header to spec: Aqua Sense Assistant + subtitle
    const card = form.closest(".chatbot-card");
    if (card) {
        const heading = card.querySelector(".chatbot-heading h3");
        const sub = card.querySelector(".chatbot-heading p");
        if (heading) heading.textContent = "Aqua Sense Assistant";
        if (sub) sub.textContent = "Water quality insights from your sensor data";
        // Add status line if not present
        let statusLine = card.querySelector(".chat-header-status");
        if (!statusLine) {
            statusLine = document.createElement("div");
            statusLine.className = "chat-header-status";
            statusLine.innerHTML = '<span class="status-dot"></span> <span class="status-text">Sensor data connected</span>';
            const header = card.querySelector(".content-card-header");
            if (header) header.appendChild(statusLine);
        }
    }

    // Inject quick chips above input if not already present
    const existingChips = card ? card.querySelector(".chat-quick-chips") : null;
    if (card && !existingChips) {
        const chipContainer = document.createElement("div");
        chipContainer.className = "chat-quick-chips-container";
        card.insertBefore(chipContainer, form);
        buildQuickChips(chipContainer, (q) => {
            input.value = q;
            input.focus();
            // Auto send
            form.requestSubmit();
        });
    }

    createChatManager({
        form, input, messages, sendButton,
        endpoint: "/chat/water",
        buildPayload(question) {
            // Conversation memory: last 10 turns as secondary context.
            // Backend treats current DB values as authoritative over history.
            var hist = [];
            try{
                hist = (chatHistory || []).slice(-10).map(function(m){
                    return {role: m.role, content: String(m.content || "").slice(0, 2000)};
                }).filter(function(m){ return (m.role==="user"||m.role==="assistant") && m.content; });
            }catch(e){ hist = []; }
            return {
                question,
                device_id: latestReading?.device_id || latestDevice?.id || null,
                provider: localStorage.getItem("aqua_ai_provider") || null,
                model: localStorage.getItem("aqua_ai_model") || null,
                history: hist,
                // Browser timezone so stored UTC timestamps render in local time.
                tz_offset_minutes: new Date().getTimezoneOffset()
            };
        },
        extractAnswer(response) {
            return response?.answer || response?.response || response?.message || "I could not generate an answer.";
        },
        history: chatHistory,
        storageKey: "aqua_ai_chat_history",
        welcomeMessage: "**Aqua Sense Assistant**\n• Hello! Ask me about pH, TDS, turbidity, temperature or water quality.\n• Try: Current water quality, Latest pH, Agriculture suitability.",
        emptyGuard: null,
        errorPrefix: "Unable to contact the water-quality assistant"
    });

    // Update header status based on reading
    const updateHeaderStatus = () => {
        const dot = card ? card.querySelector(".chat-header-status .status-dot") : null;
        const txt = card ? card.querySelector(".chat-header-status .status-text") : null;
        if (!dot || !txt) return;
        if (latestReading) {
            dot.classList.add("online"); dot.classList.remove("offline");
            txt.textContent = "Sensor data connected";
        } else {
            dot.classList.add("offline"); dot.classList.remove("online");
            txt.textContent = "No sensor data yet";
        }
    };
    updateHeaderStatus();
    // Hook to refresh on new readings
    const origUpdate = updateChatContextIndicators;
    if (typeof origUpdate === "function") {
        const orig = updateChatContextIndicators;
        updateChatContextIndicators = function() { orig(); updateHeaderStatus(); };
    }
}

function setupClearSensorChat() {
    const clearButton = $("clearSensorChatButton");
    if (!clearButton) return;

    clearButton.addEventListener("click", () => {
        chatHistory.length = 0;
        sessionStorage.removeItem("aqua_ai_chat_history");
        const messages = $("sensorChatMessages");
        if (messages) {
            renderChatMessages(
                messages,
                chatHistory,
                "Hello! I can help you understand your current temperature, pH, turbidity, and TDS readings. What would you like to know?"
            );
        }
        updateChatContextIndicators();
    });
}

function updateChatContextIndicators() {
    /* Sensor chat context */
    const sensorCtx = $("sensorChatContext");
    if (sensorCtx) {
        const dot = sensorCtx.querySelector(".context-dot");
        const label = sensorCtx.querySelector(".context-label");
        if (dot && label) {
            if (latestReading) {
                dot.className = "context-dot online";
                label.textContent = "Using latest reading";
            } else {
                dot.className = "context-dot offline";
                label.textContent = "No readings available yet";
            }
        }
    }

}

/**
 * Create a reusable chat manager to avoid duplicating submit + keydown logic.
 *
 * @param {Object} config
 * @param {HTMLFormElement}  config.form             The chat <form>.
 * @param {HTMLTextAreaElement} config.input         The <textarea>.
 * @param {HTMLElement}       config.messages        The message container.
 * @param {HTMLElement|null}  config.sendButton      The submit button (optional).
 * @param {string}            config.endpoint        API path, e.g. "/chat/water".
 * @param {Function}          config.buildPayload    (question) => object for JSON body.
 * @param {Function}          config.extractAnswer   (response) => answer string.
 * @param {Array}             config.history         The chat history array (mutable ref).
 * @param {string}            config.storageKey      sessionStorage key for persistence.
 * @param {string}            config.welcomeMessage  Shown when history is empty.
 * @param {Function|null}     config.emptyGuard      Optional (question) => error string or null.
 * @param {string}            config.errorPrefix     Prefix for network-error messages.
 * @returns {{destroy: Function}} Control handle.
 */
function createChatManager(config) {
    const {
        form,
        input,
        messages,
        sendButton,
        endpoint,
        buildPayload,
        extractAnswer,
        history,
        storageKey,
        welcomeMessage,
        emptyGuard,
        errorPrefix
    } = config;

    /* ---- Guard: missing DOM ---- */
    if (!form || !input || !messages) {
        return { destroy: () => {} };
    }

    /* ---- Load stored history & render ---- */
    const stored = loadStoredChat(storageKey);
    history.length = 0;
    stored.forEach((msg) => history.push(msg));
    renderChatMessages(messages, history, welcomeMessage);

    /* ---- Track loading state ---- */
    let isLoading = false;

    /* ---- Auto-resize textarea as user types ---- */
    function autoResize() {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 120) + "px";
    }
    input.addEventListener("input", autoResize);

    /*
     * Single send path shared by the form submit handler AND the Enter key.
     * Guarding here (isLoading + empty) prevents duplicate submissions and
     * makes Enter-to-send reliable without relying on requestSubmit().
     */
    async function sendMessage() {
        if (isLoading) return;

        const question = input.value.trim();
        if (!question) return;

        /* Optional guard (e.g. camera chat requires an analysis first) */
        if (typeof emptyGuard === "function") {
            const guardMessage = emptyGuard(question);
            if (guardMessage) {
                input.value = "";
                autoResize();
                addChatMessage(messages, history, "assistant", guardMessage, storageKey);
                input.focus();
                return;
            }
        }

        input.value = "";
        autoResize();
        input.focus();

        addChatMessage(messages, history, "user", question, storageKey);

        isLoading = true;
        if (sendButton) sendButton.disabled = true;
        form.classList.add("chat-loading");

        // Create loading placeholder without saving to history
        const loadingElement = document.createElement("div");
        loadingElement.className = "chat-message assistant loading";
        const loadingBubble = document.createElement("div");
        loadingBubble.className = "chat-message-bubble";
        loadingBubble.innerHTML = '<span class="chat-typing"><span></span><span></span><span></span></span> Thinking...';
        loadingElement.appendChild(loadingBubble);
        messages.appendChild(loadingElement);
        messages.scrollTop = messages.scrollHeight;

        try {
            const response = await apiRequest(endpoint, {
                method: "POST",
                body: JSON.stringify(buildPayload(question))
            });
            removeChatMessage(loadingElement);
            const answer = extractAnswer(response);
            // Ensure answer is rendered as safe markdown (assistant path handles it)
            addChatMessage(messages, history, "assistant", answer, storageKey);
        } catch (error) {
            removeChatMessage(loadingElement);
            // Clean error: do not show stack trace, use bullet fallback per spec
            const cleanMsg = String(error.message || "").replace(/^\s*\[.*?\]\s*/, "");
            const isProviderErr = /503|temporarily unavailable|provider/i.test(cleanMsg);
            let fallback;
            if (isProviderErr) {
                fallback = "**AI Assistant**\n• Sensor data is available.\n• The AI explanation service is temporarily unavailable.\n• Please try again shortly.";
            } else {
                fallback = `${errorPrefix}: ${escapeHtmlSafe(cleanMsg)}`;
            }
            addChatMessage(messages, history, "assistant", fallback, storageKey);
        } finally {
            isLoading = false;
            if (sendButton) sendButton.disabled = false;
            form.classList.remove("chat-loading");
            input.focus();
        }
    }

    /* ---- Form submit: Enter in a <textarea> does not natively submit,
           so the keydown handler drives the flow, but clicking Send must
           also work. This handler covers both. ---- */
    let inSubmit = false;
    function onFormSubmit(event) {
        event.preventDefault();
        if (inSubmit) return;
        inSubmit = true;
        try {
            sendMessage();
        } finally {
            inSubmit = false;
        }
    }

    /* ---- Keydown: Enter to send, Shift+Enter for newline ----
       - preventDefault ONLY for a plain Enter (no Shift, not composing).
       - Shift+Enter is left to the browser to insert a newline. */
    function onInputKeydown(event) {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            if (isLoading) return; // safe: ignore Enter while sending
            form.requestSubmit();
        }
    }

    form.addEventListener("submit", onFormSubmit);
    input.addEventListener("keydown", onInputKeydown);

    return {
        destroy() {
            form.removeEventListener("submit", onFormSubmit);
            input.removeEventListener("keydown", onInputKeydown);
            input.removeEventListener("input", autoResize);
        }
    };
}

function loadStoredChat(key) {
    try {
        const stored = sessionStorage.getItem(key);

        if (!stored) {
            return [];
        }

        const parsed = JSON.parse(stored);

        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveStoredChat(key, history) {
    try {
        sessionStorage.setItem(key, JSON.stringify(history.slice(-40)));
    } catch {
        console.warn("Unable to save chat history.");
    }
}

function escapeHtmlSafe(s) {
    return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function renderSafeMarkdown(text) {
    // Escape first, then render controlled markdown
    const escaped = escapeHtmlSafe(text);
    // Convert **bold** to <strong> (safe because escaped)
    const withBold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const lines = withBold.split("\n");
    let html = "";
    let inList = false;
    function closeList() { if (inList) { html += "</ul>"; inList = false; } }
    for (let raw of lines) {
        const line = raw.trim();
        if (!line) { closeList(); html += ""; continue; }
        // Heading: line is exactly <strong>...</strong>
        if (/^<strong>.+<\/strong>$/.test(line)) {
            closeList();
            const inner = line.replace(/^<strong>(.+)<\/strong>$/, "$1");
            html += '<div class="chat-heading">' + inner + "</div>";
            continue;
        }
        // Bullet: starts with • or - or * (after escape, • stays)
        if (/^[•\-\*]\s+/.test(line) || line.startsWith("•")) {
            const content = line.replace(/^[•\-\*]\s+/, "").replace(/^•\s*/, "");
            if (!inList) { html += '<ul class="chat-bullets">'; inList = true; }
            html += "<li>" + content + "</li>";
            continue;
        }
        // Numbered
        if (/^\d+\.\s+/.test(line)) {
            const content = line.replace(/^\d+\.\s+/, "");
            if (!inList) { html += '<ul class="chat-bullets numbered">'; inList = true; }
            html += "<li>" + content + "</li>";
            continue;
        }
        closeList();
        html += '<div class="chat-paragraph">' + line + "</div>";
    }
    closeList();
    return html || '<div class="chat-paragraph">' + withBold + "</div>";
}

function renderChatMessages(container, history, welcomeMessage) {
    container.innerHTML = "";
    if (history.length === 0) {
        const welcome = document.createElement("div");
        welcome.className = "chat-message assistant";
        const bubble = document.createElement("div");
        bubble.className = "chat-message-bubble";
        const def = welcomeMessage || "Hello! Ask me about the latest sensor readings, pH, temperature, turbidity, or TDS.";
        bubble.innerHTML = renderSafeMarkdown(def);
        welcome.appendChild(bubble);
        container.appendChild(welcome);
        return;
    }
    history.forEach((message) => {
        const element = document.createElement("div");
        element.className = `chat-message ${message.role}`;
        const bubble = document.createElement("div");
        bubble.className = "chat-message-bubble";
        if (message.role === "assistant") {
            bubble.innerHTML = renderSafeMarkdown(message.content);
        } else {
            bubble.textContent = message.content;
        }
        element.appendChild(bubble);
        container.appendChild(element);
    });
    container.scrollTop = container.scrollHeight;
}

function addChatMessage(container, history, role, content, storageKey) {
    const element = document.createElement("div");
    element.className = `chat-message ${role}`;
    const bubble = document.createElement("div");
    bubble.className = "chat-message-bubble";
    if (role === "assistant") {
        bubble.innerHTML = renderSafeMarkdown(content);
    } else {
        bubble.textContent = content;
    }
    element.appendChild(bubble);
    container.appendChild(element);
    container.scrollTop = container.scrollHeight;
    const message = { role, content, timestamp: new Date().toISOString() };
    history.push(message);
    if (storageKey) saveStoredChat(storageKey, history);
    return element;
}

function removeChatMessage(element) {
    if (element?.parentElement) element.parentElement.removeChild(element);
    // Also remove from history if it was the loading placeholder (contains "Thinking")
    // Caller handles history separately — we keep history in sync by not saving loading placeholder
}

function buildQuickChips(container, onPick) {
    const chips = [
        ["Current water quality", "What is my current water quality?"],
        ["Latest pH", "What is my pH?"],
        ["TDS status", "What is my TDS?"],
        ["Agriculture suitability", "Is this water suitable for agriculture?"],
        ["Explain turbidity", "What is turbidity?"],
    ];
    const wrap = document.createElement("div");
    wrap.className = "chat-quick-chips";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Quick questions");
    chips.forEach(([label, q]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chat-chip";
        b.textContent = label;
        b.addEventListener("click", () => onPick(q));
        wrap.appendChild(b);
    });
    container.appendChild(wrap);
    return wrap;
}

function setupSimulator() {
    const simulatorButton =
        $("startSimulator") ||
        $("simulatorStartButton");

    const stopButton =
        $("stopSimulator") ||
        $("simulatorStopButton");

    const scoreElement =
        $("simulatorScore") ||
        $("simulationScore");

    let simulatorTimer = null;
    let simulatorValue = 0;
    let simulatorDirection = 1;

    function updateSimulator() {
        simulatorValue += simulatorDirection * 2;

        if (simulatorValue >= 100) {
            simulatorValue = 100;
            simulatorDirection = -1;
        }

        if (simulatorValue <= 0) {
            simulatorValue = 0;
            simulatorDirection = 1;
        }

        if (scoreElement) {
            scoreElement.textContent = simulatorValue;
        }

        const simulatorProgress =
            $("simulatorProgress") ||
            query(".simulator-progress");

        if (simulatorProgress) {
            simulatorProgress.style.width = `${simulatorValue}%`;
        }
    }

    if (simulatorButton) {
        simulatorButton.addEventListener("click", () => {
            if (simulatorTimer) {
                return;
            }

            simulatorTimer = setInterval(updateSimulator, 100);
        });
    }

    if (stopButton) {
        stopButton.addEventListener("click", () => {
            clearInterval(simulatorTimer);
            simulatorTimer = null;
        });
    }
}

function setupWindowEvents() {
    let trendsResizeTimer = null;
    window.addEventListener("resize", () => {
        if (readingsCache.length > 0) {
            drawTrendChart(readingsCache);
        }
        if (currentPage === "trends" && trendsCache.length > 0) {
            if (trendsResizeTimer) {
                clearTimeout(trendsResizeTimer);
            }
            trendsResizeTimer = setTimeout(() => {
                renderTrendsPage();
            }, 200);
        }
    });

    window.addEventListener("online", () => {
        checkBackend();
    });

    window.addEventListener("offline", () => {
        setConnectionStatus(false, "Network offline");
    });

    // Browser back / forward navigation support. When the URL hash
    // changes (or a hash history entry is restored), switch pages.
    window.addEventListener("popstate", () => {
        const page =
            window.location.hash.replace("#", "") || "dashboard";

        navigateTo(page);
    });

    window.addEventListener("hashchange", () => {
        const page =
            window.location.hash.replace("#", "") || "dashboard";

        navigateTo(page);
    });
}

function getRefreshIntervalMs() {
    try {
        const prefs = getPrefs();
        const ms = Number(prefs.refreshIntervalMs);
        if (REFRESH_INTERVALS_MS.includes(ms)) {
            return ms;
        }
    } catch {
        // fall through to default
    }
    return REFRESH_INTERVAL;
}

function startAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    refreshTimer = setInterval(() => {
        if (isAuthenticated) {
            // Silent: values swap instantly with no shimmer/buttons flicker.
            refreshDashboard({ silent: true });
            // Keep the open Trends page live at the same cadence instead of
            // letting it go stale while the dashboard refreshes underneath.
            if (currentPage === "trends" && typeof loadTrends === "function") {
                loadTrends({ showLoading: false });
            }
        }
    }, getRefreshIntervalMs());

    // Apply instantly — don't make the user wait a full interval after
    // changing the setting or toggling auto-refresh back on.
    if (isAuthenticated && !dashboardRefreshing) {
        refreshDashboard({ silent: true });
    }
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}
/* =========================================================
   FRONTEND PREFERENCES (localStorage only — no backend)
   ========================================================= */

const AQUA_PREFS_KEY = "aqua_prefs";

const AQUA_DEFAULT_PREFS = {
    theme: "system",
    tempUnit: "C",
    autoRefresh: true,
    refreshIntervalMs: 15000,
    chatHistory: true,
    notif: {
        quality: true,
        stale: true,
        camera: true
    }
};

function getPrefs() {
    try {
        const raw = localStorage.getItem(AQUA_PREFS_KEY);
        if (!raw) {
            return JSON.parse(JSON.stringify(AQUA_DEFAULT_PREFS));
        }
        const parsed = JSON.parse(raw);
        const merged = Object.assign(
            {},
            AQUA_DEFAULT_PREFS,
            parsed
        );
        merged.notif = Object.assign(
            {},
            AQUA_DEFAULT_PREFS.notif,
            parsed.notif || {}
        );
        return merged;
    } catch {
        return JSON.parse(JSON.stringify(AQUA_DEFAULT_PREFS));
    }
}

function savePrefs(prefs) {
    try {
        localStorage.setItem(AQUA_PREFS_KEY, JSON.stringify(prefs));
    } catch {
        // Storage blocked — preferences simply won't persist.
    }
}

function resolveTheme(theme) {
    if (theme === "dark" || theme === "light") {
        return theme;
    }
    if (window.matchMedia) {
        return window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
    }
    return "light";
}

function applyTheme(theme) {
    document.documentElement.setAttribute(
        "data-theme",
        resolveTheme(theme)
    );
}

function applyPrefsToRefresh() {
    const prefs = getPrefs();
    if (prefs.autoRefresh) {
        startAutoRefresh();
    } else {
        stopAutoRefresh();
    }
}

function formatTempDisplay(celsius, digits) {
    if (celsius === null || celsius === undefined || celsius === "") {
        return "--";
    }
    const value = Number(celsius);
    if (!Number.isFinite(value)) {
        return "--";
    }
    const places = digits === undefined ? 1 : digits;
    let prefs = null;
    try {
        prefs = getPrefs();
    } catch {
        prefs = null;
    }
    if (prefs && prefs.tempUnit === "F") {
        return ((value * 9) / 5 + 32).toFixed(places) + "°F";
    }
    return value.toFixed(places) + "°C";
}

function reportParamStatus(index) {
    if (index === null || index === undefined) {
        return "Unavailable";
    }
    if (index >= 85) {
        return "Good";
    }
    if (index >= 50) {
        return "Moderate";
    }
    return "Poor";
}

function reportStatusClass(status) {
    const s = String(status || "").toLowerCase();
    if (s === "good" || s === "current") {
        return "safe";
    }
    if (s === "moderate" || s === "data stale") {
        return "watch";
    }
    if (s === "poor") {
        return "alert";
    }
    return "unknown";
}

function trendDeltaText(latestValue, previousValue, unit, digits) {
    const latest = Number(latestValue);
    const previous = Number(previousValue);
    if (
        latestValue === null || latestValue === undefined ||
        previousValue === null || previousValue === undefined ||
        !Number.isFinite(latest) || !Number.isFinite(previous)
    ) {
        return "No previous reading";
    }
    if (previous === 0) {
        return "No previous reading";
    }
    const change = ((latest - previous) / Math.abs(previous)) * 100;
    if (!Number.isFinite(change)) {
        return "No previous reading";
    }
    const arrow = change > 0.05 ? "↑" : change < -0.05 ? "↓" : "→";
    const places = digits === undefined ? 1 : digits;
    return `${arrow} ${Math.abs(change).toFixed(places)}% vs previous reading`;
}

let reportLoading = false;

function setReportState(state) {
    const loading = $("reportLoading");
    const error = $("reportError");
    const body = $("reportBody");
    if (loading) {
        loading.classList.toggle("hidden", state !== "loading");
    }
    if (error) {
        error.classList.toggle("hidden", state !== "error");
    }
    if (body) {
        body.classList.toggle("hidden", state !== "ready");
    }
}

function showReportError(title, message) {
    setReportState("error");
    setText("reportErrorTitle", title, "Unable to load report data");
    setText("reportErrorMessage", message, "Check the backend connection and try again.");
}

async function renderReportPage() {
    if (reportLoading) {
        return;
    }
    const content = $("reportContent");
    if (!content) {
        return;
    }
    reportLoading = true;
    setReportState("loading");

    try {
        const latest = await apiRequest("/readings/latest");
        let recent = [];
        try {
            const data = await apiRequest("/readings/?limit=12");
            recent = normalizeReadings(data);
        } catch {
            recent = [];
        }

        if (!latest || !latest.recorded_at) {
            showReportError(
                "No sensor readings available",
                "No sensor readings are available yet."
            );
            return;
        }

        let deviceName = "Unknown device";
        if (latestDevice && latestDevice.id === latest.device_id && latestDevice.name) {
            deviceName = latestDevice.name;
        } else {
            try {
                const devices = parseDevicesPayload(await apiRequest("/devices/"));
                const match = devices.find((d) => d && d.id === latest.device_id);
                if (match && match.name) {
                    deviceName = match.name;
                }
            } catch {
                // Device name stays generic — never blocks the report.
            }
        }

        const prefs = getPrefs();
        const derived = calculateDerivedParameters(latest);
        const overall = derived.analyticalWaterScore === null
            ? null
            : Math.round(derived.analyticalWaterScore);

        // ---- Header ----
        setText("rptDeviceName", deviceName);
        setText("rptReadingTime", formatTimestamp(latest.recorded_at));
        setText("rptGeneratedAt", new Date().toLocaleString());
        setText("rptReadingCount", String((recent || []).length));

        const ageMs = Date.now() - parseApiDate(latest.recorded_at).getTime();
        const ageHours = Number.isFinite(ageMs) ? ageMs / (1000 * 60 * 60) : null;
        const isStale = ageHours === null || ageHours > 24;

        let statusText = "Current";
        if (isStale) {
            statusText = "Data stale";
        }
        setText("rptStatus", statusText);
        const statusEl = $("rptStatus");
        if (statusEl) {
            statusEl.className = "report-status-" + (
                isStale
                    ? (prefs.notif.stale ? "stale" : "muted")
                    : "current"
            );
        }

        let freshnessText = "--";
        if (ageHours !== null && Number.isFinite(ageHours)) {
            if (ageHours < 1) {
                freshnessText = `${Math.max(1, Math.round(ageHours * 60))} min ago`;
            } else if (ageHours < 48) {
                freshnessText = `${Math.round(ageHours)} h ago`;
            } else {
                freshnessText = `${Math.round(ageHours / 24)} days ago`;
            }
        }
        setText("rptFreshness", freshnessText);

        // ---- Score ring ----
        setText("rptScore", overall === null ? "--" : String(overall));
        setText("rptScoreLabel", overall === null ? "Unavailable" : waterScoreLabel(overall));
        const arc = $("rptScoreArc");
        if (arc) {
            const circumference = 2 * Math.PI * 52;
            const filled = overall === null ? 0 : Math.max(0, Math.min(100, overall));
            arc.style.strokeDasharray = String(circumference);
            arc.style.strokeDashoffset = String(circumference * (1 - filled / 100));
            arc.setAttribute("class", "score-ring-fill " + scoreLevel(overall));
        }
        const ring = $("rptScoreRing");
        if (ring) {
            ring.setAttribute(
                "aria-label",
                overall === null ? "Aqua Sense score unavailable" : `Aqua Sense score ${overall} of 100`
            );
        }

        // ---- Executive summary (deterministic) ----
        const summaryItems = [];
        const paramSummary = [
            { key: "ph", label: "pH", index: derived.phIndex },
            { key: "tds", label: "TDS/salinity", index: derived.salinityIndex },
            { key: "turbidity", label: "Turbidity", index: derived.clarityIndex },
            { key: "temperature", label: "Temperature", index: derived.temperatureIndex }
        ];
        paramSummary.forEach((item) => {
            if (item.index === null) {
                summaryItems.push(`${item.label} was not measured in this reading.`);
            } else if (item.index >= 85) {
                summaryItems.push(`${item.label} is within the configured preferred range.`);
            } else if (item.index >= 50) {
                summaryItems.push(`${item.label} is outside the preferred range — monitor closely.`);
            } else {
                summaryItems.push(`${item.label} is well outside the preferred range and limits the score.`);
            }
        });
        renderReportBullets("rptSummaryBullets", summaryItems.slice(0, 4));

        // ---- Current parameters ----
        const previous = recent.length > 1 ? recent[1] : null;
        const paramCards = [
            {
                name: "pH",
                icon: "ri-test-tube-line",
                value: latest.ph === null || latest.ph === undefined ? "--" : formatNumber(latest.ph, 2),
                index: derived.phIndex,
                trend: trendDeltaText(latest.ph, previous ? previous.ph : null, "", 1),
                hint: "Acidity / alkalinity of the water."
            },
            {
                name: "TDS",
                icon: "ri-flask-line",
                value: latest.tds === null || latest.tds === undefined ? "--" : formatNumber(latest.tds, 0) + " mg/L",
                index: derived.salinityIndex,
                trend: trendDeltaText(latest.tds, previous ? previous.tds : null, "mg/L", 1),
                hint: "Total dissolved solids."
            },
            {
                name: "Turbidity",
                icon: "ri-contrast-drop-2-line",
                value: latest.turbidity === null || latest.turbidity === undefined ? "--" : formatNumber(latest.turbidity, 2) + " NTU",
                index: derived.clarityIndex,
                trend: trendDeltaText(latest.turbidity, previous ? previous.turbidity : null, "NTU", 1),
                hint: "Cloudiness / suspended material."
            },
            {
                name: "Temperature",
                icon: "ri-temp-hot-line",
                value: formatTempDisplay(latest.temperature, 1),
                index: derived.temperatureIndex,
                trend: trendDeltaText(latest.temperature, previous ? previous.temperature : null, "", 1),
                hint: "Water temperature."
            }
        ];
        const paramGrid = $("rptParamGrid");
        if (paramGrid) {
            paramGrid.innerHTML = "";
            paramCards.forEach((card) => {
                const status = reportParamStatus(card.index);
                const item = document.createElement("div");
                item.className = "report-param-card status-" + status.toLowerCase();
                const title = document.createElement("span");
                title.className = "report-param-name";
                title.title = card.hint;
                title.innerHTML = `<i class="${card.icon}"></i> ${escapeHtml(card.name)}`;
                const value = document.createElement("strong");
                value.className = "report-param-value";
                value.textContent = card.value;
                const statusEl2 = document.createElement("span");
                statusEl2.className = "report-param-status " + reportStatusClass(status);
                statusEl2.textContent = status;
                const trend = document.createElement("span");
                trend.className = "report-param-trend";
                trend.textContent = card.trend;
                item.appendChild(title);
                item.appendChild(value);
                item.appendChild(statusEl2);
                item.appendChild(trend);
                paramGrid.appendChild(item);
            });
        }

        // ---- Quality breakdown (existing engine) ----
        const breakdownRows = [
            { label: "pH", score: derived.phIndex },
            { label: "Salinity", score: derived.salinityIndex },
            { label: "Clarity", score: derived.clarityIndex },
            { label: "Temperature", score: derived.temperatureIndex },
            { label: "Overall", score: overall }
        ];
        const breakdown = $("rptBreakdown");
        if (breakdown) {
            breakdown.innerHTML = "";
            breakdownRows.forEach((row) => {
                const value = row.score === null || row.score === undefined
                    ? null
                    : Math.round(row.score);
                const wrap = document.createElement("div");
                wrap.className = "report-breakdown-row";
                const label = document.createElement("span");
                label.className = "report-breakdown-label";
                label.textContent = row.label;
                const bar = document.createElement("span");
                bar.className = "report-breakdown-bar";
                bar.innerHTML = progressBar(value);
                const score = document.createElement("strong");
                score.className = "report-breakdown-score";
                score.textContent = value === null ? "Unavailable" : `${value} / 100`;
                wrap.appendChild(label);
                wrap.appendChild(bar);
                wrap.appendChild(score);
                breakdown.appendChild(wrap);
            });
        }

        // ---- Attention / going well ----
        const attention = [];
        const goingWell = [];
        const attentionNames = { ph: "pH", tds: "TDS/salinity", turbidity: "Turbidity", temperature: "Temperature" };
        [
            { key: "ph", index: derived.phIndex },
            { key: "tds", index: derived.salinityIndex },
            { key: "turbidity", index: derived.clarityIndex },
            { key: "temperature", index: derived.temperatureIndex }
        ].forEach((item) => {
            if (item.index === null) {
                attention.push(`${attentionNames[item.key]} was not measured — check the sensor.`);
            } else if (item.index < 70) {
                attention.push(`${attentionNames[item.key]} is below the preferred range (sub-score ${Math.round(item.index)}/100).`);
            } else if (item.index >= 85) {
                goingWell.push(`${attentionNames[item.key]} is comfortably within range.`);
            }
        });
        if (attention.length === 0) {
            attention.push("All measured parameters are within their preferred ranges.");
        }
        if (goingWell.length === 0) {
            goingWell.push("No parameter is comfortably within range yet.");
        }
        renderReportBullets("rptAttentionList", attention.slice(0, 4));
        renderReportBullets("rptGoodList", goingWell.slice(0, 4));
        const attentionCard = $("rptAttentionCard");
        if (attentionCard) {
            attentionCard.classList.toggle("hidden", !prefs.notif.quality);
        }

        // ---- Application insights (existing Analysis calculations) ----
        const insights = [];
        try {
            const cropScores = CROP_PROFILES
                .map((crop) => calculateCropScore(latest, crop))
                .filter((s) => s.suitability !== null)
                .sort((a, b) => b.suitability - a.suitability);
            if (cropScores.length > 0) {
                const best = cropScores[0];
                insights.push({
                    title: "Agriculture",
                    icon: "ri-leaf-line",
                    line: `${best.crop} — ${scoreLabel(best.suitability)}`,
                    detail: best.reason
                });
            }
        } catch {
            // Insight skipped — never blocks the report.
        }
        try {
            const scored = INDUSTRIAL_PROFILES
                .map((p) => calculateApplicationScore(latest, p))
                .filter((s) => s.suitability !== null)
                .sort((a, b) => b.suitability - a.suitability);
            if (scored.length > 0) {
                insights.push({
                    title: "Industry",
                    icon: "ri-factory-line",
                    line: `${scored[0].name} — ${scoreLabel(scored[0].suitability)}`,
                    detail: scored[0].reason
                });
            }
        } catch { /* skip */ }
        try {
            const scored = DOMESTIC_PROFILES
                .map((p) => calculateApplicationScore(latest, p))
                .filter((s) => s.suitability !== null)
                .sort((a, b) => b.suitability - a.suitability);
            if (scored.length > 0) {
                insights.push({
                    title: "Domestic",
                    icon: "ri-home-4-line",
                    line: `${scored[0].name} — ${scoreLabel(scored[0].suitability)}`,
                    detail: scored[0].reason
                });
            }
        } catch { /* skip */ }
        try {
            const screening = calculateDrinkingScreening(latest);
            if (screening.score !== null) {
                insights.push({
                    title: "Drinking Screening",
                    icon: "ri-drop-line",
                    line: `${drinkingScoreLabel(screening.score)} (${Math.round(screening.score)}/100)`,
                    detail: screening.reason
                });
            }
        } catch { /* skip */ }
        try {
            const scored = GENERAL_PROFILES
                .map((p) => calculateApplicationScore(latest, p))
                .filter((s) => s.suitability !== null)
                .sort((a, b) => b.suitability - a.suitability);
            if (scored.length > 0) {
                insights.push({
                    title: "General Utility",
                    icon: "ri-tools-line",
                    line: `${scored[0].name} — ${scoreLabel(scored[0].suitability)}`,
                    detail: scored[0].reason
                });
            }
        } catch { /* skip */ }
        const insightsEl = $("rptInsights");
        if (insightsEl) {
            insightsEl.innerHTML = "";
            if (insights.length === 0) {
                insightsEl.innerHTML = '<p class="report-muted">Application insights are unavailable for this reading.</p>';
            } else {
                insights.forEach((item) => {
                    const card = document.createElement("div");
                    card.className = "report-insight-card";
                    const title = document.createElement("strong");
                    title.innerHTML = `<i class="${item.icon}"></i> ${escapeHtml(item.title)}`;
                    const line = document.createElement("span");
                    line.className = "report-insight-line";
                    line.textContent = item.line;
                    const detail = document.createElement("span");
                    detail.className = "report-insight-detail";
                    detail.textContent = item.detail;
                    card.appendChild(title);
                    card.appendChild(line);
                    card.appendChild(detail);
                    insightsEl.appendChild(card);
                });
            }
        }

        // ---- Key observations (data-supported only) ----
        const observations = [];
        const scoredParams = [
            { label: "pH", index: derived.phIndex },
            { label: "TDS/salinity", index: derived.salinityIndex },
            { label: "Turbidity", index: derived.clarityIndex },
            { label: "Temperature", index: derived.temperatureIndex }
        ].filter((p) => p.index !== null);
        if (scoredParams.length > 0) {
            const worst = scoredParams.slice().sort((a, b) => a.index - b.index)[0];
            if (worst.index < 85) {
                observations.push(`${worst.label} is the main limiting factor (sub-score ${Math.round(worst.index)}/100).`);
            } else {
                observations.push("All measured parameters are within their preferred ranges.");
            }
        }
        if (latest.turbidity !== null && latest.turbidity !== undefined) {
            const t = Number(latest.turbidity);
            if (Number.isFinite(t)) {
                observations.push(
                    t <= 5
                        ? "Water clarity is relatively good based on the measured turbidity."
                        : "Elevated turbidity indicates visibly cloudier water."
                );
            }
        }
        if (latest.tds !== null && latest.tds !== undefined) {
            const tds = Number(latest.tds);
            if (Number.isFinite(tds)) {
                observations.push(
                    tds <= 500
                        ? "TDS is within the configured screening range."
                        : "TDS is above the configured screening range."
                );
            }
        }
        if (isStale) {
            observations.push("This reading is older than 24 hours — treat it as stale until the device sends new data.");
        }
        renderReportBullets(
            "rptObservations",
            observations.length > 0 ? observations.slice(0, 4) : ["Not enough data to form observations yet."]
        );

        setReportState("ready");
    } catch (error) {
        const status = error && error.status;
        if (status === 404) {
            showReportError(
                "No sensor readings available",
                "No sensor readings are available yet."
            );
        } else {
            showReportError(
                "Unable to load report data",
                "Unable to load report data. Check the backend connection and try again."
            );
        }
    } finally {
        reportLoading = false;
    }
}

function renderReportBullets(id, items) {
    const list = $(id);
    if (!list) {
        return;
    }
    list.innerHTML = "";
    (items || []).forEach((text) => {
        const item = document.createElement("li");
        item.textContent = String(text);
        list.appendChild(item);
    });
}

/* CSV export: live database readings -> browser download (read-only). */
let csvExportInFlight = false;
let pdfExportInFlight = false;

function escapeCsvField(value) {
    if (value === null || value === undefined) {
        return "";
    }
    const text = String(value);
    if (/[",\r\n]/.test(text)) {
        return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
}

function readingsToCsv(rows) {
    const header = ["timestamp", "device_id", "temperature_c", "ph", "turbidity", "tds"];
    const lines = [header.join(",")];
    (rows || []).forEach((reading) => {
        const timestamp = reading && reading.recorded_at ? reading.recorded_at : "";
        const cells = [
            escapeCsvField(timestamp),
            escapeCsvField(reading ? reading.device_id : ""),
            escapeCsvField(reading && reading.temperature !== null && reading.temperature !== undefined ? reading.temperature : ""),
            escapeCsvField(reading && reading.ph !== null && reading.ph !== undefined ? reading.ph : ""),
            escapeCsvField(reading && reading.turbidity !== null && reading.turbidity !== undefined ? reading.turbidity : ""),
            escapeCsvField(reading && reading.tds !== null && reading.tds !== undefined ? reading.tds : "")
        ];
        lines.push(cells.join(","));
    });
    return lines.join("\r\n") + "\r\n";
}

function exportDateStamp(now) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
}

function triggerBrowserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
        if (link.parentNode) {
            link.parentNode.removeChild(link);
        }
        URL.revokeObjectURL(url);
    }, 500);
}

async function exportLiveReadingsCsv(button) {
    if (csvExportInFlight) {
        return;
    }
    const originalLabel = button ? button.innerHTML : null;
    csvExportInFlight = true;
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="ri-loader-4-line"></i> Exporting...';
    }
    try {
        const rows = normalizeReadings(await apiRequest("/readings/?limit=1000"));
        if (!rows || rows.length === 0) {
            showToast("No live readings are available to export yet.", "warning");
            return;
        }
        const csv = readingsToCsv(rows);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        triggerBrowserDownload(blob, "Aqua_Sense_Readings_" + exportDateStamp(new Date()) + ".csv");
        showToast("Exported " + rows.length + " live reading(s) to CSV.", "success");
    } catch (error) {
        showToast("CSV export failed. Check the backend connection and try again.", "error");
    } finally {
        csvExportInFlight = false;
        if (button) {
            button.disabled = false;
            if (originalLabel !== null) {
                button.innerHTML = originalLabel;
            }
        }
    }
}

function escapePdfText(value) {
    return String(value === null || value === undefined ? "" : value)
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")
        .replace(/[^\x20-\x7E]/g, "?");
}
function getReportContext(){
    var reading = latestReading;
    var derived = reading?calculateDerivedParameters(reading):null;
    var device = latestDevice;
    var overall = derived && derived.analyticalWaterScore!==null?Math.round(derived.analyticalWaterScore):null;
    return { reading: reading, derived: derived, device: device, overall: overall };
}
function sanitizeFilename(name){
    return String(name||"").replace(/[^a-zA-Z0-9_\-]/g,"_").replace(/_+/g,"_").slice(0,40)||"Report";
}
function formatPdfDate(value){
    if(!value) return "Not available";
    var t = parseApiTimestamp(value);
    if(Number.isNaN(t)) return "Not available";
    return new Date(t).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
}
function formatPdfNow(){
    return new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
}
function pdfSafe(val, fallback){
    if(val===null||val===undefined||val==="") return fallback||"Not available";
    var n=Number(val);
    if(typeof val==="number" && !Number.isFinite(n)) return fallback||"Not available";
    return String(val);
}
function buildProfessionalPdf(){
    var ctx = getReportContext();
    var reading = ctx.reading;
    var derived = ctx.derived;
    var device = ctx.device;
    var overall = ctx.overall;
    var jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if(!jsPDF){
        var lines = [
            "Aqua Sense - Water Quality Analysis Report",
            "Generated: "+formatPdfNow(),
            "Latest reading: "+(reading?formatPdfDate(reading.recorded_at):"Not available"),
            "Overall: "+(overall===null?"Not available":overall+"/100 "+waterScoreLabel(overall))
        ];
        var content = ["BT","/F1 14 Tf","56 780 Td"];
        lines.forEach(function(l,i){ content.push((i===0?"":"0 -20 Td ")+"("+escapePdfText(l)+") Tj"); });
        content.push("ET");
        var body = content.join("\n");
        var objs = ["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Length "+body.length+" >>\nstream\n"+body+"\nendstream"];
        var pdf="%PDF-1.4\n", off=[0];
        objs.forEach(function(b,i){ off.push(pdf.length); pdf+=(i+1)+" 0 obj\n"+b+"\nendobj\n"; });
        var xref=pdf.length; pdf+="xref\n0 "+(objs.length+1)+"\n0000000000 65535 f \n";
        for(var i=1;i<=objs.length;i++) pdf+=String(off[i]).padStart(10,"0")+" 00000 n \n";
        pdf+="trailer\n<< /Size "+(objs.length+1)+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF";
        return { save: function(name){ var blob=new Blob([new Uint8Array(pdf.split("").map(function(c){return c.charCodeAt(0)&255;}))],{type:"application/pdf"}); triggerBrowserDownload(blob,name); }, internal:{getNumberOfPages:function(){return 1;}} };
    }
    var doc = new jsPDF({unit:"pt", format:"a4", orientation:"portrait"});
    var W = doc.internal.pageSize.getWidth();
    var H = doc.internal.pageSize.getHeight();
    var M = 48;
    var CW = W - 2*M;
    var FOOT = 56;
    var NAVY=[15,36,48], TEAL=[14,124,149], TEALD=[10,95,115], GREEN=[22,148,74],
        AMBER=[178,112,8], RED=[185,30,30], GRAY=[100,116,139], BODY=[45,55,65],
        FAINT=[245,248,250], LINEC=[214,228,236];
    var y = 0;

    function statusRGB(level){
        if(level==="good") return GREEN;
        if(level==="caution") return AMBER;
        if(level==="alert") return RED;
        return [130,130,130];
    }
    function newPage(){ doc.addPage(); y = 52; }
    function need(h){ if(y + h > H - FOOT){ newPage(); } }
    function rule(color, width){
        doc.setDrawColor(color[0],color[1],color[2]);
        doc.setLineWidth(width||0.7);
        doc.line(M, y, W-M, y);
        y += 10;
    }
    function h2(num, title, sub){
        need(66);
        doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
        doc.setTextColor(TEAL[0],TEAL[1],TEAL[2]);
        doc.text("SECTION "+num, M, y); y += 14;
        doc.setFontSize(14); doc.setTextColor(NAVY[0],NAVY[1],NAVY[2]);
        doc.text(title, M, y); y += 9;
        if(sub){
            doc.setFont("helvetica","normal"); doc.setFontSize(8);
            doc.setTextColor(GRAY[0],GRAY[1],GRAY[2]);
            var sl = doc.splitTextToSize(sub, CW);
            need(sl.length*12);
            doc.text(sl, M, y); y += sl.length*12;
        }
        doc.setDrawColor(TEAL[0],TEAL[1],TEAL[2]); doc.setLineWidth(1.4);
        doc.line(M, y, M+30, y); doc.setLineWidth(0.5);
        y += 14;
    }
    function h2cont(num, title){
        need(40);
        doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
        doc.setTextColor(TEAL[0],TEAL[1],TEAL[2]);
        doc.text("SECTION "+num+" - CONTINUED", M, y); y += 14;
        doc.setFontSize(14); doc.setTextColor(NAVY[0],NAVY[1],NAVY[2]);
        doc.text(title, M, y); y += 9;
        doc.setDrawColor(TEAL[0],TEAL[1],TEAL[2]); doc.setLineWidth(1.4);
        doc.line(M, y, M+30, y); doc.setLineWidth(0.5);
        y += 14;
    }
    function h3(title){
        need(32);
        doc.setFont("helvetica","bold"); doc.setFontSize(10.5);
        doc.setTextColor(NAVY[0],NAVY[1],NAVY[2]);
        doc.text(title, M, y); y += 15;
    }
    function para(txt, opt){
        opt = opt||{};
        var size = opt.size||8.5, lh = size*1.52;
        doc.setFont("helvetica", opt.bold?"bold":"normal"); doc.setFontSize(size);
        var c = opt.color||BODY; doc.setTextColor(c[0],c[1],c[2]);
        var lines = doc.splitTextToSize(String(txt), CW - (opt.indent||0));
        need(lines.length*lh + 4);
        doc.text(lines, M + (opt.indent||0), y);
        y += lines.length*lh + (opt.after===undefined?5:opt.after);
    }
    function bullets(items){
        doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
        items.forEach(function(it){
            var lines = doc.splitTextToSize(String(it), CW-16);
            var lh = 8.5*1.5;
            need(lines.length*lh + 3);
            doc.setTextColor(TEAL[0],TEAL[1],TEAL[2]);
            doc.text("\u2022", M+2, y);
            doc.setTextColor(BODY[0],BODY[1],BODY[2]);
            doc.text(lines, M+14, y);
            y += lines.length*lh + 2;
        });
        y += 5;
    }
    function callout(title, lines){
        doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
        var wrapped = [];
        lines.forEach(function(l){ wrapped = wrapped.concat(doc.splitTextToSize(String(l), CW-40)); });
        var boxH = 30 + wrapped.length*13;
        need(boxH + 6);
        doc.setFillColor(232,244,248);
        doc.setDrawColor(TEAL[0],TEAL[1],TEAL[2]); doc.setLineWidth(0.8);
        doc.roundedRect(M, y, CW, boxH, 5, 5, "FD");
        doc.setFillColor(TEAL[0],TEAL[1],TEAL[2]);
        doc.roundedRect(M, y, 4, boxH, 2, 2, "F");
        var by = y + 17;
        doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
        doc.setTextColor(TEALD[0],TEALD[1],TEALD[2]);
        doc.text(title.toUpperCase(), M+14, by); by += 13;
        doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
        doc.setTextColor(BODY[0],BODY[1],BODY[2]);
        wrapped.forEach(function(l){ doc.text(l, M+14, by); by += 13; });
        y += boxH + 10;
    }
    function fmtVal(v, digits){
        if(v===null||v===undefined) return "Not available";
        var n = Number(v);
        if(!Number.isFinite(n)) return "Not available";
        return n.toFixed(digits===undefined?2:digits);
    }
    /* Professional table: header repeats on page break, rows never split,
       row height derived from the tallest wrapped cell. */
    function proTable(headers, rows, widths, opt){
        opt = opt||{};
        var fs = opt.fontSize||8, lh = fs*1.45, pad = 5, headH = 21;
        var x0 = [];
        (function(){ var x=M; for(var i=0;i<widths.length;i++){ x0.push(x); x+=widths[i]; } })();
        function drawHead(){
            need(headH+4);
            doc.setFillColor(NAVY[0],NAVY[1],NAVY[2]);
            doc.rect(M, y, CW, headH, "F");
            doc.setFont("helvetica","bold"); doc.setFontSize(fs+0.5);
            doc.setTextColor(255,255,255);
            headers.forEach(function(h,i){
                doc.text(String(h), x0[i]+6, y+13.5, {maxWidth: widths[i]-12});
            });
            y += headH;
        }
        drawHead();
        doc.setFontSize(fs);
        rows.forEach(function(row, ri){
            var wrapped = row.map(function(cell,i){
                return doc.splitTextToSize(pdfSafe(cell,"Not available"), widths[i]-12);
            });
            var maxL = 1;
            wrapped.forEach(function(w){ if(w.length>maxL) maxL=w.length; });
            var rh = Math.max(20, maxL*lh + pad*2);
            need(rh);
            if(ri%2===1){ doc.setFillColor(247,250,252); doc.rect(M, y, CW, rh, "F"); }
            doc.setDrawColor(LINEC[0],LINEC[1],LINEC[2]); doc.setLineWidth(0.5);
            doc.rect(M, y, CW, rh, "S");
            for(var c=1;c<widths.length;c++){ doc.line(x0[c], y, x0[c], y+rh); }
            row.forEach(function(cell, ci){
                var col = BODY;
                if(opt.statusCol===ci){
                    var lv = String(cell).toLowerCase();
                    col = (lv.indexOf("within")>=0||lv.indexOf("highly suitable")>=0||lv.indexOf("suitable")>=0||lv.indexOf("good")>=0||lv.indexOf("meets")>=0) ? GREEN
                        : ((lv.indexOf("moderate")>=0||lv.indexOf("mixed")>=0||lv.indexOf("watch")>=0) ? AMBER
                        : ((lv.indexOf("attention")>=0||lv.indexOf("poor")>=0||lv.indexOf("below")>=0||lv.indexOf("low")>=0||lv.indexOf("high")>=0) ? RED : BODY));
                }
                if(opt.colorCol && ci===(opt.colorColIdx||widths.length-1)) col = opt.colorCol[ri];
                doc.setTextColor(col[0],col[1],col[2]);
                doc.setFont("helvetica",(opt.boldCol===ci||(opt.boldFirst&&ci===0))?"bold":"normal");
                doc.text(wrapped[ci], x0[ci]+6, y+pad+fs*0.85);
            });
            y += rh;
            if(y > H - FOOT - 24 && ri < rows.length-1){ drawHead(); }
        });
        y += 10;
    }
    function scoreBar(score, x, w, hgt){
        hgt = hgt||7;
        var col = score===null?[200,200,200]:(score>=70?GREEN:(score>=50?AMBER:RED));
        doc.setFillColor(232,238,243);
        doc.roundedRect(x, y, w, hgt, 2, 2, "F");
        if(score!==null){
            doc.setFillColor(col[0],col[1],col[2]);
            doc.roundedRect(x, y, Math.max(3, w*score/100), hgt, 2, 2, "F");
        }
        return col;
    }
    /* Four-across compact stat cards (single row). */
    function statCards4(cards){
        var gap = 8, bw = (CW-3*gap)/4, bh = 66;
        need(bh+6);
        cards.forEach(function(cd, i){
            var cx = M + i*(bw+gap);
            doc.setFillColor(255,255,255); doc.setDrawColor(LINEC[0],LINEC[1],LINEC[2]);
            doc.setLineWidth(0.6); doc.roundedRect(cx, y, bw, bh, 5, 5, "FD");
            doc.setFillColor(cd.color[0],cd.color[1],cd.color[2]);
            doc.rect(cx+1, y+8, 3, bh-16, "F");
            doc.setFont("helvetica","bold"); doc.setFontSize(6.5);
            doc.setTextColor(GRAY[0],GRAY[1],GRAY[2]);
            doc.text(cd.label.toUpperCase(), cx+10, y+15);
            doc.setFontSize(cd.big||12); doc.setTextColor(cd.color[0],cd.color[1],cd.color[2]);
            doc.text(String(cd.value).slice(0,20), cx+10, y+36);
            doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
            doc.text(String(cd.sub).slice(0,22), cx+10, y+51);
        });
        y += bh + 10;
    }
    /* Horizontal impact bars (label + bar + value). impact 0-100. */
    function impactBars(rows){
        var rh = 17, labelW = 110, valW = 44, bw = CW-labelW-valW-8;
        need(rows.length*rh + 8);
        doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
        rows.forEach(function(r){
            doc.setTextColor(BODY[0],BODY[1],BODY[2]);
            doc.text(String(r.label).slice(0,20), M, y+11);
            var bx = M+labelW;
            doc.setFillColor(232,238,243);
            doc.roundedRect(bx, y+3, bw, 9, 2, 2, "F");
            var imp = Math.max(0, Math.min(100, r.impact));
            if(imp>0){
                doc.setFillColor(r.color[0],r.color[1],r.color[2]);
                doc.roundedRect(bx, y+3, Math.max(3, bw*imp/100), 9, 2, 2, "F");
            }
            doc.setFont("helvetica","bold"); doc.setFontSize(8);
            doc.setTextColor(r.color[0],r.color[1],r.color[2]);
            doc.text(String(r.value), bx+bw+6, y+11);
            doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
            y += rh;
        });
        y += 8;
    }
    /* Score-flow: 4 component boxes, arrow to overall band, then crop band. */
    function scoreFlow(comps, overallVal, overallLabel, cropName, cropScore, cropLabel){
        var gap = 6, bw = (CW-3*gap)/4, bh = 62;
        var totalH = bh + 12 + 44 + 10 + 34;
        need(totalH + 6);
        var cols = comps.map(function(c){
            if(c.score===null) return [150,150,150];
            return c.score>=70?GREEN:(c.score>=50?AMBER:RED);
        });
        comps.forEach(function(c, i){
            var cx = M + i*(bw+gap);
            doc.setFillColor(255,255,255); doc.setDrawColor(LINEC[0],LINEC[1],LINEC[2]);
            doc.setLineWidth(0.6); doc.roundedRect(cx, y, bw, bh, 5, 5, "FD");
            doc.setFont("helvetica","bold"); doc.setFontSize(7);
            doc.setTextColor(GRAY[0],GRAY[1],GRAY[2]);
            doc.text(c.label.toUpperCase(), cx+8, y+13);
            doc.setFont("helvetica","normal"); doc.setFontSize(7.5);
            doc.setTextColor(BODY[0],BODY[1],BODY[2]);
            doc.text(String(c.measured).slice(0,22), cx+8, y+25);
            doc.setFont("helvetica","bold"); doc.setFontSize(11);
            doc.setTextColor(cols[i][0],cols[i][1],cols[i][2]);
            doc.text(c.score===null?"n/a":Math.round(c.score)+"%", cx+8, y+43);
            doc.setFont("helvetica","normal"); doc.setFontSize(6.5);
            doc.setTextColor(GRAY[0],GRAY[1],GRAY[2]);
            doc.text("component", cx+8, y+53);
            if(i<3){
                doc.setFont("helvetica","bold"); doc.setFontSize(12);
                doc.setTextColor(TEAL[0],TEAL[1],TEAL[2]);
                doc.text("+", cx+bw+1, y+34);
            }
        });
        y += bh + 4;
        doc.setFont("helvetica","bold"); doc.setFontSize(11);
        doc.setTextColor(TEAL[0],TEAL[1],TEAL[2]);
        doc.text("\u25BC", M+CW/2-4, y+8);
        y += 16;
        /* overall band */
        var oc = overallVal===null?[130,130,130]:(overallVal>=70?GREEN:(overallVal>=50?AMBER:RED));
        doc.setFillColor(NAVY[0],NAVY[1],NAVY[2]);
        doc.roundedRect(M, y, CW, 44, 5, 5, "F");
        doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
        doc.setTextColor(170,200,212);
        doc.text("OVERALL WATER QUALITY", M+12, y+16);
        doc.setFontSize(17); doc.setTextColor(255,255,255);
        doc.text(overallVal===null?"n/a":(overallVal+" / 100"), M+12, y+35);
        doc.setFontSize(10);
        doc.text(overallLabel, M+110, y+35);
        doc.setFillColor(120,150,165);
        doc.roundedRect(M+CW-192, y+18, 180, 8, 2, 2, "F");
        if(overallVal!==null){
            doc.setFillColor(oc[0],oc[1],oc[2]);
            doc.roundedRect(M+CW-192, y+18, Math.max(3,180*overallVal/100), 8, 2, 2, "F");
        }
        y += 54;
        /* crop band */
        var cc = cropScore===null?[130,130,130]:(cropScore>=75?GREEN:(cropScore>=50?AMBER:RED));
        doc.setFillColor(FAINT[0],FAINT[1],FAINT[2]);
        doc.setDrawColor(LINEC[0],LINEC[1],LINEC[2]); doc.setLineWidth(0.6);
        doc.roundedRect(M, y, CW, 34, 5, 5, "FD");
        doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
        doc.setTextColor(GRAY[0],GRAY[1],GRAY[2]);
        doc.text("CROP SUITABILITY", M+12, y+14);
        doc.setFontSize(11); doc.setTextColor(cc[0],cc[1],cc[2]);
        doc.text((cropName||"n/a")+"  "+(cropScore===null?"n/a":Math.round(cropScore)+"%")+"  -  "+cropLabel, M+12, y+27);
        y += 44;
    }
    /* Crop suitability bar chart (compact rows). */
    function cropBars(rows){
        var rh = 15, labelW = 120, pctW = 46, bw = CW-labelW-pctW-10;
        need(rows.length*rh + 10);
        rows.forEach(function(r){
            doc.setFont("helvetica","normal"); doc.setFontSize(8);
            doc.setTextColor(BODY[0],BODY[1],BODY[2]);
            doc.text(String(r.label).slice(0,22), M, y+10);
            var bx = M+labelW;
            doc.setFillColor(232,238,243);
            doc.roundedRect(bx, y+2, bw, 8, 2, 2, "F");
            if(r.score!==null){
                var col = r.score>=75?GREEN:(r.score>=50?AMBER:RED);
                doc.setFillColor(col[0],col[1],col[2]);
                doc.roundedRect(bx, y+2, Math.max(2, bw*r.score/100), 8, 2, 2, "F");
            }
            doc.setFont("helvetica","bold"); doc.setFontSize(8);
            doc.setTextColor(BODY[0],BODY[1],BODY[2]);
            doc.text(r.score===null?"n/a":Math.round(r.score)+"%", bx+bw+6, y+10);
            y += rh;
        });
        y += 8;
    }
    function formulaBox(id, title, formulaLines, whereLines, resultText, whyText){
        var inner = [];
        doc.setFont("courier","bold"); doc.setFontSize(9);
        formulaLines.forEach(function(f){ inner = inner.concat(doc.splitTextToSize(f, CW-40)); });
        doc.setFont("helvetica","normal"); doc.setFontSize(8);
        var wl = [];
        (whereLines||[]).forEach(function(f){ wl = wl.concat(doc.splitTextToSize(f, CW-40)); });
        var rl = resultText ? doc.splitTextToSize(resultText, CW-40) : [];
        var yl = whyText ? doc.splitTextToSize(whyText, CW-40) : [];
        var boxH = 34 + inner.length*13 + (wl.length? 6 + wl.length*12 : 0) + (rl.length? 8 + rl.length*12 : 0) + (yl.length? 10 + yl.length*12 : 0);
        need(boxH + 8);
        doc.setFillColor(FAINT[0],FAINT[1],FAINT[2]);
        doc.setDrawColor(LINEC[0],LINEC[1],LINEC[2]); doc.setLineWidth(0.6);
        doc.roundedRect(M, y, CW, boxH, 5, 5, "FD");
        var by = y + 17;
        doc.setFont("helvetica","bold"); doc.setFontSize(8);
        doc.setTextColor(TEALD[0],TEALD[1],TEALD[2]);
        doc.text(id+"  -  "+title.toUpperCase(), M+14, by); by += 13;
        doc.setFont("courier","bold"); doc.setFontSize(9.5);
        doc.setTextColor(NAVY[0],NAVY[1],NAVY[2]);
        inner.forEach(function(f){ doc.text(f, M+14, by); by += 13; });
        if(wl.length){
            by += 3;
            doc.setFont("helvetica","normal"); doc.setFontSize(8);
            doc.setTextColor(BODY[0],BODY[1],BODY[2]);
            wl.forEach(function(f){ doc.text(f, M+14, by); by += 12; });
        }
        if(rl.length){
            by += 4;
            doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
            doc.setTextColor(GREEN[0],GREEN[1],GREEN[2]);
            rl.forEach(function(f){ doc.text(f, M+14, by); by += 12; });
        }
        if(yl.length){
            by += 4;
            doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
            doc.setTextColor(GRAY[0],GRAY[1],GRAY[2]);
            doc.text("WHY IT MATTERS", M+14, by); by += 11;
            doc.setFont("helvetica","normal"); doc.setFontSize(8);
            doc.setTextColor(BODY[0],BODY[1],BODY[2]);
            yl.forEach(function(f){ doc.text(f, M+14, by); by += 12; });
        }
        y += boxH + 10;
    }
    /* Half-width trend chart for 2x2 dashboard. Returns after spacing. */
    function halfChart(bx, bw, title, unit, points, refMin, refMax){
        var boxH = 118;
        doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
        doc.setTextColor(NAVY[0],NAVY[1],NAVY[2]);
        doc.text(title + (unit ? " ("+unit+")" : ""), bx, y);
        var cy = y + 5;
        doc.setFillColor(255,255,255); doc.setDrawColor(LINEC[0],LINEC[1],LINEC[2]);
        doc.setLineWidth(0.6);
        doc.roundedRect(bx, cy, bw, boxH, 5, 5, "FD");
        var px=bx+34, pw=bw-42, py=cy+10, ph=boxH-40;
        var vals = points.map(function(p){return p.v;});
        var lo=Math.min.apply(null,vals), hi=Math.max.apply(null,vals);
        if(refMin!==null&&refMin!==undefined) lo=Math.min(lo,refMin);
        if(refMax!==null&&refMax!==undefined) hi=Math.max(hi,refMax);
        if(hi-lo<1e-9){ hi=lo+1; }
        var pad=(hi-lo)*0.15; lo-=pad; hi+=pad;
        function X(i){ return px + (points.length===1?pw/2:pw*i/(points.length-1)); }
        function Y(v){ return py+ph - (v-lo)/(hi-lo)*ph; }
        if(refMin!==null&&refMin!==undefined&&refMax!==null&&refMax!==undefined){
            doc.setFillColor(232,245,240);
            doc.rect(px, Y(refMax), pw, Y(refMin)-Y(refMax), "F");
        }
        doc.setDrawColor(190,200,210); doc.setLineWidth(0.5);
        for(var g=0; g<=2; g++){ var gy = py + ph*g/2; doc.line(px, gy, px+pw, gy); }
        doc.setFont("helvetica","normal"); doc.setFontSize(6.5);
        doc.setTextColor(GRAY[0],GRAY[1],GRAY[2]);
        for(var g2=0; g2<=2; g2++){
            var gv = hi - (hi-lo)*g2/2;
            doc.text(gv.toFixed(1), px-3, py+ph*g2/2+2, {align:"right"});
        }
        doc.text(points.length+" pts", px, py+ph+12);
        doc.setDrawColor(TEAL[0],TEAL[1],TEAL[2]); doc.setLineWidth(1.2);
        var started=false, lx=0, ly=0;
        points.forEach(function(p,i){
            var cx=X(i), cyy=Y(p.v);
            if(!started){ started=true; } else { doc.line(lx,ly,cx,cyy); }
            lx=cx; ly=cyy;
        });
        doc.setFillColor(TEAL[0],TEAL[1],TEAL[2]);
        points.forEach(function(p,i){ doc.circle(X(i), Y(p.v), 1.3, "F"); });
        doc.setFillColor(NAVY[0],NAVY[1],NAVY[2]);
        doc.circle(lx, ly, 2, "F");
        doc.setFont("helvetica","bold"); doc.setFontSize(7);
        doc.text("Now: "+vals[vals.length-1].toFixed(1), px+pw, py+ph+12, {align:"right"});
    }
    function trendRow(titleA, unitA, sA, refA, titleB, unitB, sB, refB, cap){
        need(150);
        halfChart(M, (CW-10)/2, titleA, unitA, sA, refA[0], refA[1]);
        var _y = y;
        halfChart(M+(CW+10)/2, (CW-10)/2, titleB, unitB, sB, refB[0], refB[1]);
        y = _y + 5 + 118 + 16;
        if(cap){ para(cap, {size:7.5, color:GRAY, after:6}); }
    }

    /* ---------- derived context ---------- */
    var devName = (device&&device.name) || (reading&&reading.device_id!==null&&reading.device_id!==undefined ? "Device "+reading.device_id : "Not available");
    var cfg = (typeof ANALYSIS_CONFIG!=="undefined") ? ANALYSIS_CONFIG : null;
    var crops = (typeof CROP_PROFILES!=="undefined") ? CROP_PROFILES : [];
    var scored = [];
    try{
        scored = crops.map(function(c){ return {crop:c, res:calculateCropScore(reading,c)}; })
            .filter(function(x){ return x.res && x.res.suitability!==null; })
            .sort(function(a,b){ return b.res.suitability-a.res.suitability; });
    }catch(e){ scored=[]; }
    var top = scored.length? scored[0] : null;
    /* Single source of dataset size: the readings cache actually held by the app.
       Charts show the most recent CHART_N of these; captions state both numbers. */
    var CHART_N = 30;
    var cacheCount = (typeof readingsCache!=="undefined" && readingsCache) ? readingsCache.length : 0;
    var datasetSize = cacheCount;
    if(!datasetSize){
        var rcEl = (typeof document!=="undefined") ? document.getElementById("rptReadingCount") : null;
        var rcTxt = rcEl&&rcEl.textContent.trim() ? rcEl.textContent.trim() : "";
        var m = rcTxt.match(/(\d+)/);
        datasetSize = m ? parseInt(m[1],10) : 0;
    }
    var hist = (typeof readingsCache!=="undefined" && readingsCache.length) ? readingsCache.slice(0,CHART_N).reverse() : [];
    var histLabel = !hist.length ? "no historical readings"
        : (datasetSize>hist.length ? (hist.length+" most recent of "+datasetSize+" in dataset") : ("all "+hist.length+" in dataset"));
    var cam = (typeof latestCameraAnalysis!=="undefined") ? latestCameraAnalysis : null;
    var figures = (typeof window!=="undefined" && window.__aquaReportFigures) ? window.__aquaReportFigures : [];

    function condOf(key, v){ try{ return getParameterCondition(key, v); }catch(e){ return {text:"Not available", level:"unknown"}; } }
    function devText(v, unit, digits){
        if(v===null||v===undefined) return "Not available";
        return fmtVal(v, digits)+(unit?" "+unit:"");
    }
    function signed(n, digits){ return (n>0?"+":n<0?"-":"")+fmtVal(Math.abs(n), digits===undefined?2:digits); }
    function deviation(measured, rMin, rMax, unit, digits){
        if(measured===null||measured===undefined) return "Not available";
        if(rMin===null||rMin===undefined||rMax===null||rMax===undefined) return "Reference not available";
        if(measured>=rMin&&measured<=rMax) return "Within range";
        var d = measured<rMin ? measured-rMin : measured-rMax;
        var edge = measured<rMin ? ("from lower limit "+rMin) : ("from upper limit "+rMax);
        return signed(d,digits)+" "+(unit||"")+" "+edge;
    }
    function riskOf(s){
        if(s===null||s===undefined) return {t:"UNKNOWN", c:[130,130,130]};
        if(s>=70) return {t:"LOW", c:GREEN};
        if(s>=50) return {t:"MODERATE", c:AMBER};
        return {t:"HIGH", c:RED};
    }

    /* ================= COVER ================= */
    y = 60;
    doc.setFillColor(TEAL[0],TEAL[1],TEAL[2]);
    doc.rect(0, 0, W, 8, "F");
    doc.setFont("helvetica","bold"); doc.setFontSize(10);
    doc.setTextColor(TEAL[0],TEAL[1],TEAL[2]);
    doc.text("A Q U A   A I", M, y); y += 8;
    doc.setFont("helvetica","normal"); doc.setFontSize(8);
    doc.setTextColor(GRAY[0],GRAY[1],GRAY[2]);
    doc.text("Agricultural water-quality intelligence", M, y); y += 24;
    doc.setFont("helvetica","bold"); doc.setFontSize(27);
    doc.setTextColor(NAVY[0],NAVY[1],NAVY[2]);
    doc.text("Water Quality &", M, y); y += 29;
    doc.text("Crop Suitability", M, y); y += 29;
    doc.setTextColor(TEAL[0],TEAL[1],TEAL[2]);
    doc.text("Analysis Report", M, y); y += 20;
    rule(TEAL, 1.2);
    /* cover score strip: water / crop / risk */
    var risk = riskOf(overall);
    var covCards = [
        {label:"Water quality", value: overall===null?"n/a":overall+" / 100", sub: overall===null?"Unavailable":waterScoreLabel(overall), color: overall===null?[130,130,130]:(overall>=70?GREEN:(overall>=50?AMBER:RED))},
        {label:"Crop suitability", value: top?(Math.round(top.res.suitability)+"%"):"n/a", sub: top?scoreLabel(top.res.suitability):"Unavailable", color: top?(top.res.suitability>=75?GREEN:(top.res.suitability>=50?AMBER:RED)):[130,130,130]},
        {label:"Risk", value: risk.t, sub: top?top.crop.name:"No crop scored", color: risk.c}
    ];
    (function(){
        var gap=8, bw=(CW-2*gap)/3, bh=64;
        need(bh+6);
        covCards.forEach(function(cd,i){
            var cx=M+i*(bw+gap);
            doc.setFillColor(NAVY[0],NAVY[1],NAVY[2]);
            doc.roundedRect(cx, y, bw, bh, 6, 6, "F");
            doc.setFont("helvetica","bold"); doc.setFontSize(7);
            doc.setTextColor(150,185,198);
            doc.text(cd.label.toUpperCase(), cx+12, y+16);
            doc.setFontSize(16); doc.setTextColor(255,255,255);
            doc.text(String(cd.value).slice(0,18), cx+12, y+38);
            doc.setFontSize(8); doc.setTextColor(cd.color[0],cd.color[1],cd.color[2]);
            doc.text(String(cd.sub).slice(0,24), cx+12, y+53);
        });
        y += bh + 12;
    })();
    /* cover metadata: compact lines, no table */
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
    var meta = [
        ["Selected crop", top?top.crop.name:"Not available"],
        ["Reading / sample ID", reading&&reading.id!==undefined?("#"+reading.id):"Not available"],
        ["Device", pdfSafe(devName).slice(0,44)+(reading&&reading.device_id!==undefined?("  (ID "+reading.device_id+")"):"")],
        ["Analysis date", formatPdfNow()]
    ];
    meta.forEach(function(mm){
        doc.setFont("helvetica","bold"); doc.setTextColor(GRAY[0],GRAY[1],GRAY[2]);
        doc.text(mm[0].toUpperCase(), M, y);
        doc.setFont("helvetica","normal"); doc.setTextColor(BODY[0],BODY[1],BODY[2]);
        doc.text(String(mm[1]).slice(0,60), M+150, y);
        y += 13;
    });
    y += 4;
    para("This report follows the water from measurement to recommendation: readings are compared against configured references, converted to component scores, combined into an overall water score, ranked per crop, and traced to limiting factors and actions.", {size:8, color:GRAY});

    /* ================= 01 EXECUTIVE SUMMARY ================= */
    h2("01", "Executive Summary", "Decision dashboard - the whole assessment at a glance.");
    statCards4([
        {label:"Water quality", value: overall===null?"n/a":overall+" / 100", sub: overall===null?"Unavailable":waterScoreLabel(overall), color: overall===null?[130,130,130]:(overall>=70?GREEN:(overall>=50?AMBER:RED))},
        {label:"Crop suitability", value: top?(Math.round(top.res.suitability)+"%"):"n/a", sub: top?scoreLabel(top.res.suitability):"Unavailable", color: top?(top.res.suitability>=75?GREEN:(top.res.suitability>=50?AMBER:RED)):[130,130,130], big:11},
        {label:"Selected crop", value: top?top.crop.name:"n/a", sub: top?("EC tol. "+top.crop.ecwFullYield+" dS/m"):"No data", color: NAVY, big:11},
        {label:"Risk", value: risk.t, sub: overall===null?"Unknown":(overall>=70?"In preferred ranges":(overall>=50?"Some drift":"Action advised")), color: risk.c}
    ]);
    h3("Key findings");
    var sumBullets = [];
    if(derived){
        var cPh=condOf("ph",derived.ph), cTd=condOf("tds",derived.tds),
            cTb=condOf("turbidity",derived.turbidity), cTp=condOf("temperature",derived.temperature);
        if(cPh.level!=="good") sumBullets.push("pH "+fmtVal(reading.ph,2)+" is outside the preferred irrigation range (6.5-8.4).");
        if(cTd.level==="alert") sumBullets.push("TDS "+fmtVal(reading.tds,0)+" mg/L indicates elevated dissolved solids.");
        else if(cTd.level==="caution") sumBullets.push("TDS "+fmtVal(reading.tds,0)+" mg/L is above the preferred level.");
        if(cTb.level==="alert") sumBullets.push("Turbidity "+fmtVal(reading.turbidity,2)+" NTU is significantly elevated.");
        else if(cTb.level==="caution") sumBullets.push("Turbidity "+fmtVal(reading.turbidity,2)+" NTU is above the preferred band.");
        if(cTp.level!=="good"&&derived.temperature!==null) sumBullets.push("Temperature "+fmtVal(reading.temperature,1)+" C is outside the configured crop envelope.");
        if(!sumBullets.length) sumBullets.push("All measured parameters sit within their preferred bands.");
    } else {
        sumBullets.push("No sensor readings are available yet; connect a device to begin monitoring.");
    }
    bullets(sumBullets.slice(0,5));
    h3("Top limiting factors");
    if(derived){
        var comps = [
            {label:"Temperature", score:derived.temperatureIndex},
            {label:"Turbidity", score:derived.clarityIndex},
            {label:"pH", score:derived.phIndex},
            {label:"Salinity / EC", score:derived.salinityIndex}
        ].filter(function(c){return c.score!==null;})
         .sort(function(a,b){return a.score-b.score;})
         .slice(0,4);
        impactBars(comps.map(function(c){
            var imp = 100-c.score;
            return {label:c.label, impact:imp, value:Math.round(c.score)+"%",
                color: c.score>=70?GREEN:(c.score>=50?AMBER:RED)};
        }));
        para("Bars show constraint impact (100 minus component score): longer bars constrain the final score more.", {size:7.5, color:GRAY});
    }

    /* ================= 02 SCORE FLOW ================= */
    h2("02", "How the Score Was Reached", "Measured values become component scores, then one water score, then crop suitability.");
    if(derived && reading){
        var ecV = derived.estimatedEC;
        scoreFlow([
            {label:"pH", measured:"Measured "+fmtVal(reading.ph,2), score:derived.phIndex},
            {label:"Salinity", measured:"EC "+(ecV!==null?fmtVal(ecV,2)+" dS/m":"n/a"), score:derived.salinityIndex},
            {label:"Turbidity", measured:fmtVal(reading.turbidity,2)+" NTU", score:derived.clarityIndex},
            {label:"Temperature", measured:fmtVal(reading.temperature,1)+" C", score:derived.temperatureIndex}
        ], overall, overall===null?"Unavailable":waterScoreLabel(overall),
           top?top.crop.name:null, top?Math.round(top.res.suitability):null, top?scoreLabel(top.res.suitability):"Unavailable");
        para("Component scores use the application's target-range and piecewise formulas (Section 07). The weighted combination and crop step are detailed there; this diagram shows the values flowing through them.", {size:7.5, color:GRAY});
    } else {
        para("Score flow cannot be drawn without sensor data.", {});
    }

    /* ================= 03 SAMPLE & DEVICE ================= */
    h2("03", "Sample & Device Information", "Provenance of the analysed data.");
    proTable(["Field","Value"], [
        ["Device", pdfSafe(devName).slice(0,60)],
        ["Device ID / type / location", (reading&&reading.device_id!==undefined?String(reading.device_id):"--")+" / "+((device&&device.device_type)||"ESP32")+" / "+((device&&device.location)||"Not available")],
        ["Reading ID / recorded", (reading&&reading.id!==undefined?("#"+reading.id):"--")+" / "+(reading?formatPdfDate(reading.recorded_at):"Not available")],
        ["Dataset", datasetSize? (datasetSize+" readings") : "Not available"],
        ["Generated", formatPdfNow()]
    ], [170, CW-170], {fontSize:8});

    /* ================= 04 MEASUREMENTS ================= */
    h2("04", "Water Quality Measurements", "Direct sensor readings with references, deviations and status.");
    proTable(["Parameter","Measured","Unit","Reference","Deviation","Status"], [
        ["pH", (reading&&reading.ph!==null&&reading.ph!==undefined)?fmtVal(reading.ph,2):"Not available", "--", "6.5-8.4", deviation(reading?reading.ph:null,6.5,8.4,"",2), derived?condOf("ph",derived.ph).text:"Not available"],
        ["TDS", (reading&&reading.tds!==null&&reading.tds!==undefined)?fmtVal(reading.tds,0):"Not available", "mg/L", "<=450 good / <=2000 moderate", (function(){ if(!reading||reading.tds===null||reading.tds===undefined) return "Not available"; if(reading.tds<=450) return "Within range"; return "+"+fmtVal(reading.tds-450,0)+" mg/L from preferred"; })(), derived?condOf("tds",derived.tds).text:"Not available"],
        ["Turbidity", (reading&&reading.turbidity!==null&&reading.turbidity!==undefined)?fmtVal(reading.turbidity,2):"Not available", "NTU", "<=1 good / <=5 moderate", (function(){ if(!reading||reading.turbidity===null||reading.turbidity===undefined) return "Not available"; if(reading.turbidity<=1) return "Within range"; return "+"+fmtVal(reading.turbidity-1,2)+" NTU from good threshold"; })(), derived?condOf("turbidity",derived.turbidity).text:"Not available"],
        ["Temperature", (reading&&reading.temperature!==null&&reading.temperature!==undefined)?fmtVal(reading.temperature,1):"Not available", "C", "15-30 preferred", deviation(reading?reading.temperature:null,15,30,"C",1), derived?condOf("temperature",derived.temperature).text:"Not available"]
    ], [78, 62, 42, 128, 108, CW-418], {statusCol:5, fontSize:7.5});

    /* ================= 05 CROP REFERENCES ================= */
    h2("05", "Crop Reference Standards", "General irrigation references are distinct from the selected crop's scoring requirements.");
    h3("General irrigation reference");
    proTable(["Parameter","Reference"], [
        ["pH", "6.5 - 8.4 preferred (moderate 6.0 - 9.0)"],
        ["TDS", "<= 450 mg/L good; <= 2000 mg/L moderate"],
        ["Turbidity", "<= 1 NTU good; <= 5 NTU moderate"],
        ["Temperature", "15 - 30 C preferred"]
    ], [150, CW-150], {fontSize:8});
    var ecMeas2 = derived?derived.estimatedEC:null;
    callout("Important distinction - TDS vs EC",
        ["TDS is used for the general irrigation reference above.",
         "EC is used by the crop scoring engine for salinity tolerance: EC = TDS / 650.",
         "This sample: TDS "+devText(reading?reading.tds:null,"mg/L",0)+"  ->  EC "+(ecMeas2!==null?fmtVal(ecMeas2,2)+" dS/m":"Not available")+"."]);
    if(top){
        h3("Selected crop requirements - "+top.crop.name);
        var cr = top.crop, cres = top.res;
        proTable(["Parameter","Crop requirement","Measured","Difference","Status"], [
            ["pH", cr.phMin+" - "+cr.phMax, devText(reading?reading.ph:null,"",2), deviation(reading?reading.ph:null, cr.phMin, cr.phMax, "", 2), cres.phScore!==null?scoreLabel(cres.phScore):"Unavailable"],
            ["Salinity (EC)", "<= "+cr.ecwFullYield+" dS/m", ecMeas2!==null?fmtVal(ecMeas2,2)+" dS/m":"Not available", (function(){ if(ecMeas2===null) return "Not available"; if(ecMeas2<=cr.ecwFullYield) return "Within tolerance"; return "+"+fmtVal(ecMeas2-cr.ecwFullYield,2)+" dS/m above tolerance"; })(), cres.salinityScore!==null?scoreLabel(cres.salinityScore):"Unavailable"],
            ["Temperature", cr.temperatureMin+" - "+cr.temperatureMax+" C", devText(reading?reading.temperature:null,"C",1), deviation(reading?reading.temperature:null, cr.temperatureMin, cr.temperatureMax, "C", 1), cres.temperatureScore!==null?scoreLabel(cres.temperatureScore):"Unavailable"],
            ["Turbidity", "<= "+cr.turbidityPreferred+" NTU", devText(reading?reading.turbidity:null,"NTU",2), (function(){ if(!reading||reading.turbidity===null||reading.turbidity===undefined) return "Not available"; if(reading.turbidity<=cr.turbidityPreferred) return "Within range"; return "+"+fmtVal(reading.turbidity-cr.turbidityPreferred,2)+" NTU above"; })(), cres.turbidityScore!==null?scoreLabel(cres.turbidityScore):"Unavailable"]
        ], [100, 110, 100, 120, CW-430], {statusCol:4, fontSize:7.5});
        para("Source: in-application CROP_PROFILES dataset. Requirement values above are the exact references used by the crop-scoring engine.", {size:7.5, color:GRAY});
    }

    /* ================= 06 CROP COMPARISON ================= */
    h2("06", "Crop Comparison", "All configured crops ranked for this sample - visual and compact table carry the same data once.");
    if(scored.length){
        h3("Suitability ranking");
        cropBars(scored.map(function(x){ return {label:x.crop.name, score:x.res.suitability}; }));
        var _pct0 = function(v){ return (v===null||v===undefined)?"n/a":Math.round(v)+"%"; };
        proTable(["Crop","Score","Status","Main limiting factor"], scored.map(function(x){
            var parts = [["Salinity",x.res.salinityScore],["pH",x.res.phScore],["Temperature",x.res.temperatureScore],["Turbidity",x.res.turbidityScore]]
                .filter(function(p){return p[1]!==null;}).sort(function(a,b){return a[1]-b[1];});
            return [x.crop.name, _pct0(x.res.suitability), scoreLabel(x.res.suitability), parts.length?(parts[0][0]+" ("+Math.round(parts[0][1])+"%)"):"No data"];
        }), [110, 60, 130, CW-300], {statusCol:2, fontSize:7.5});
    } else {
        para("Crop ranking is unavailable for this sample (insufficient sensor data).", {});
    }

    /* ================= 07 METHODOLOGY ================= */
    h2("07", "Calculation Methodology", "Exact formulas executed by the application (ANALYSIS_CONFIG). Nothing here is illustrative.");
    if(cfg){
        var ecF = cfg.ec.tdsConversionFactor;
        formulaBox("F1", "Electrical conductivity (EC)",
            ["EC  =  TDS / "+ecF],
            ["TDS = measured total dissolved solids ("+devText(reading?reading.tds:null,"mg/L",0)+")",
             ecF+" = configured TDS-to-EC conversion factor"],
            "Result: EC = "+(derived&&derived.estimatedEC!==null?fmtVal(derived.estimatedEC,2)+" dS/m":"Not available"),
            "EC is the salinity input to the crop scoring engine; each crop defines an EC tolerance.");
        formulaBox("F2", "Hydrogen ion concentration",
            ["[H+]  =  10^(-pH)"],
            ["pH = measured value ("+devText(reading?reading.ph:null,"",2)+")"],
            "Result: [H+] = "+(derived&&derived.hydrogenIonConcentration!==null?derived.hydrogenIonConcentration.toExponential(2)+" mol/L":"Not available"),
            "Reports acidity on the chemical concentration scale behind the pH reading.");
        formulaBox("F3", "Clarity index from turbidity (piecewise linear)",
            ["100 at turbidity <= 1 NTU;",
             "ramps 100 -> 60 from 1 to 5 NTU;",
             "ramps 60 -> 0 from 5 to 20 NTU; 0 above 20 NTU"],
            ["turbidity = measured "+devText(reading?reading.turbidity:null,"NTU",2)],
            "Result: clarity = "+(derived&&derived.clarityIndex!==null?Math.round(derived.clarityIndex)+"%":"Not available"),
            "Translates optical cloudiness into a 0-100 component used by both overall and crop scores.");
        formulaBox("F4", "Target-range score (pH, salinity, temperature)",
            ["100 inside the ideal range;",
             "linear ramp to 0 at the outer limits; 0 beyond"],
            ["Ideal/outer limits are the configured irrigation, pH-index and temperature bands",
             "This sample: pH "+(derived&&derived.phIndex!==null?Math.round(derived.phIndex)+"%":"n/a")+", salinity "+(derived&&derived.salinityIndex!==null?Math.round(derived.salinityIndex)+"%":"n/a")+", temperature "+(derived&&derived.temperatureIndex!==null?Math.round(derived.temperatureIndex)+"%":"n/a")],
            null,
            "The shared scoring primitive behind every range-based component.");
        /* F5 with explicit contribution breakdown (mirrors code incl. renormalisation) */
        var w = cfg.weights.overall;
        var avail = [];
        if(derived){
            if(derived.phIndex!==null) avail.push({label:"pH", w:w.ph, v:derived.phIndex});
            if(derived.salinityIndex!==null) avail.push({label:"Salinity", w:w.salinity, v:derived.salinityIndex});
            if(derived.clarityIndex!==null) avail.push({label:"Clarity", w:w.turbidity, v:derived.clarityIndex});
            if(derived.temperatureIndex!==null) avail.push({label:"Temperature", w:w.temperature, v:derived.temperatureIndex});
        }
        var totW = avail.reduce(function(s,a){return s+a.w;},0);
        var totC = avail.reduce(function(s,a){return s+a.w*a.v;},0);
        var f5where = avail.map(function(a){
            return a.label+": "+a.w.toFixed(2)+" x "+fmtVal(a.v,1)+" = "+fmtVal(a.w*a.v,1);
        });
        f5where.push("Missing parameters are excluded and weights renormalised over "+fmtVal(totW,2)+".");
        formulaBox("F5", "Overall analytical score (weighted mean)",
            ["Score  =  sum(weight x component) / sum(available weights)"],
            f5where.length?f5where:["No components available"],
            "Result: "+fmtVal(totC,1)+" / "+fmtVal(totW,2)+" = "+(overall===null?"Not available":("~ "+overall+" / 100 ("+waterScoreLabel(overall)+")")),
            "Configured weights: pH 0.35, salinity 0.30, turbidity 0.20, temperature 0.15. Displayed total is rounded to the reported score.");
        /* F6 with crop contribution breakdown + cap rule */
        var cw = cfg.weights.crop;
        if(top){
            var cav = [];
            if(top.res.salinityScore!==null) cav.push({label:"Salinity", w:cw.salinity, v:top.res.salinityScore});
            if(top.res.phScore!==null) cav.push({label:"pH", w:cw.ph, v:top.res.phScore});
            if(top.res.temperatureScore!==null) cav.push({label:"Temperature", w:cw.temperature, v:top.res.temperatureScore});
            if(top.res.turbidityScore!==null) cav.push({label:"Turbidity", w:cw.turbidity, v:top.res.turbidityScore});
            var ctotW = cav.reduce(function(s,a){return s+a.w;},0);
            var f6where = cav.map(function(a){
                return a.label+": "+a.w.toFixed(2)+" x "+fmtVal(a.v,1)+" = "+fmtVal(a.w*a.v,1);
            });
            var minC = cav.length?Math.min.apply(null, cav.map(function(a){return a.v;})):null;
            f6where.push("Critical-cap rule: if any component scores 0, suitability is capped at 20"+(minC===0?" - CAP ACTIVE for "+top.crop.name:" - not triggered (minimum "+fmtVal(minC,0)+")")+".");
            formulaBox("F6", "Crop suitability - "+top.crop.name,
                ["Suitability  =  sum(weight x component) / sum(available weights)",
                 "Configured crop weights: salinity 0.45, pH 0.25, temperature 0.20, turbidity 0.10"],
                f6where,
                "Result: "+Math.round(top.res.suitability)+"% ("+scoreLabel(top.res.suitability)+")",
                "Salinity uses the crop EC tolerance; pH uses crop range +/- 2.0; temperature uses crop range +/- 10 C.");
        } else {
            formulaBox("F6", "Crop suitability (weighted mean with critical-cap rule)",
                ["Suitability  =  (0.45 x salinity + 0.25 x pH + 0.20 x temperature + 0.10 x turbidity) / available weight",
                 "If any component scores 0, suitability is capped at 20."],
                ["Insufficient data for substitution"],
                "Result: Not available",
                "Per-crop EC tolerance, pH range and temperature range come from CROP_PROFILES.");
        }
        para("Score bands - water: 80+ Very Good, 60+ Good, 40+ Moderate, below 40 Low. Suitability: 90+ Highly Suitable, 75+ Suitable, 50+ Moderately Suitable, 30+ Low Suitability, below 30 Poor Match.", {size:8});
    } else {
        para("Configuration data is unavailable; formulas cannot be displayed.", {});
    }

    /* ================= 08 PARAMETER BLOCKS ================= */
    h2("08", "Parameter Analysis", "One block per parameter: value, reference, deviation, component, interpretation.");
    function paramBlock(title, key, unit, digits, refTxt, devTxt, compScore, interp){
        if(!reading || reading[key]===null || reading[key]===undefined) return;
        var c = condOf(key, derived?derived[key]:null);
        var col = statusRGB(c.level);
        var boxH = 86;
        need(boxH + 30);
        h3(title);
        y -= 6;
        doc.setFillColor(255,255,255); doc.setDrawColor(LINEC[0],LINEC[1],LINEC[2]);
        doc.setLineWidth(0.6); doc.roundedRect(M, y, CW, boxH, 5, 5, "FD");
        doc.setFillColor(col[0],col[1],col[2]); doc.roundedRect(M, y, 4, boxH, 2, 2, "F");
        doc.setFont("helvetica","bold"); doc.setFontSize(8);
        doc.setTextColor(NAVY[0],NAVY[1],NAVY[2]);
        var L1 = "Measured "+fmtVal(reading[key],digits)+(unit?" "+unit:"")+"   |   Reference "+refTxt;
        var L2 = "Deviation "+devTxt+"   |   Component "+(compScore===null?"n/a":Math.round(compScore)+"%");
        doc.text(doc.splitTextToSize(L1, CW-90), M+12, y+17);
        doc.text(doc.splitTextToSize(L2, CW-90), M+12, y+31);
        doc.setFontSize(9); doc.setTextColor(col[0],col[1],col[2]);
        doc.text(c.text.toUpperCase(), M+CW-12, y+24, {align:"right"});
        doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
        doc.setTextColor(BODY[0],BODY[1],BODY[2]);
        var il = doc.splitTextToSize(interp, CW-28).slice(0,2);
        doc.text(il, M+12, y+48);
        y += boxH + 10;
    }
    if(reading){
        paramBlock("pH", "ph", "", 2, "6.5 - 8.4",
            deviation(reading.ph,6.5,8.4,"",2), derived?derived.phIndex:null,
            (reading.ph<6.5||reading.ph>8.4)?"Outside the irrigation band; verify with a calibrated meter before sensitive plantings.":"Inside the irrigation band; pH does not constrain this sample.");
        paramBlock("TDS / EC", "tds", "mg/L", 0, "<= 450 good, <= 2000 moderate",
            (reading.tds===null||reading.tds===undefined)?"Not available":(reading.tds<=450?"Within range":"+"+fmtVal(reading.tds-450,0)+" mg/L from preferred"),
            derived?derived.salinityIndex:null,
            "EC "+(derived&&derived.estimatedEC!==null?fmtVal(derived.estimatedEC,2)+" dS/m":"unavailable")+" (salinity class "+(derived?derived.salinityClass:"unavailable")+"). "+((reading.tds>2000)?"Above the moderate ceiling; sensitive crops lose suitability first.":(reading.tds>450?"Above preferred but moderate; consider blending or leaching.":"Preferred band.")));
        paramBlock("Turbidity", "turbidity", "NTU", 2, "<= 1 good, <= 5 moderate",
            (reading.turbidity===null||reading.turbidity===undefined)?"Not available":(reading.turbidity<=1?"Within range":"+"+fmtVal(reading.turbidity-1,2)+" NTU from good threshold"),
            derived?derived.clarityIndex:null,
            (reading.turbidity>5)?"High suspended load; settle or filter before irrigation to protect drip lines.":(reading.turbidity>1?"Slight cloudiness, acceptable for most field crops.":"Optically clear."));
        paramBlock("Temperature", "temperature", "C", 1, "15 - 30 preferred",
            deviation(reading.temperature,15,30,"C",1), derived?derived.temperatureIndex:null,
            (reading.temperature<5||reading.temperature>35)?"Outside the tolerable envelope; re-measure in cooler conditions.":((reading.temperature<15||reading.temperature>30)?"Tolerable but outside preferred; heat-sensitive stages are most affected.":"Preferred band."));
    } else {
        para("No readings available for parameter analysis.", {});
    }

    /* ================= 09 SELECTED CROP ================= */
    h2("09", "Selected Crop Assessment", "Why this crop leads for this sample, and what holds it back.");
    if(top){
        h3(top.crop.name+" - "+Math.round(top.res.suitability)+"% ("+scoreLabel(top.res.suitability)+")");
        var _sy2 = y;
        scoreBar(Math.round(top.res.suitability), M, 260, 8);
        y = _sy2 + 16;
        para(top.res.reason, {});
        proTable(["Component","Score","Crop reference used"], [
            ["Salinity", top.res.salinityScore!==null?Math.round(top.res.salinityScore)+"%":"n/a", "EC tolerance "+top.crop.ecwFullYield+" dS/m"],
            ["pH", top.res.phScore!==null?Math.round(top.res.phScore)+"%":"n/a", "Range "+top.crop.phMin+" - "+top.crop.phMax],
            ["Temperature", top.res.temperatureScore!==null?Math.round(top.res.temperatureScore)+"%":"n/a", "Range "+top.crop.temperatureMin+" - "+top.crop.temperatureMax+" C"],
            ["Turbidity", top.res.turbidityScore!==null?Math.round(top.res.turbidityScore)+"%":"n/a", "Preferred <="+top.crop.turbidityPreferred+" NTU"]
        ], [130, 80, CW-210], {fontSize:8});
    } else {
        para("No crop assessment is possible without sensor data.", {});
    }

    /* ================= 10 TRENDS ================= */
    function seriesOf(key){
        return hist.map(function(r){ return {v:(r&&r[key]!==null&&r[key]!==undefined)?Number(r[key]):null}; })
            .filter(function(p){ return p.v!==null && Number.isFinite(p.v); });
    }
    var sPh = seriesOf("ph"), sTds = seriesOf("tds"), sTb = seriesOf("turbidity"), sTp = seriesOf("temperature");
    var trendPairs = [];
    if(sPh.length>=2) trendPairs.push(["pH trend","",sPh,[6.5,8.4]]);
    if(sTds.length>=2) trendPairs.push(["TDS trend","mg/L",sTds,[0,450]]);
    if(sTb.length>=2) trendPairs.push(["Turbidity trend","NTU",sTb,[0,1]]);
    if(sTp.length>=2) trendPairs.push(["Temperature trend","C",sTp,[15,30]]);
    if(trendPairs.length){
        h2("10", "Historical Trends", "Compact dashboard ("+histLabel+"). Shaded bands mark preferred ranges.");
        for(var ti=0; ti<trendPairs.length; ti+=2){
            var A = trendPairs[ti], B = trendPairs[ti+1];
            if(B){
                trendRow(A[0],A[1],A[2],A[3], B[0],B[1],B[2],B[3], null);
            } else {
                need(150);
                halfChart(M, (CW-10)/2, A[0], A[1], A[2], A[3][0], A[3][1]);
                y += 5 + 118 + 10;
            }
        }
        h3("Trend interpretation");
        var tint = [];
        function bandShare(s, lo, hi){
            var out = s.filter(function(p){return p.v<lo||p.v>hi;}).length;
            return s.length? out/s.length : 0;
        }
        if(sPh.length>=2){
            var sh = bandShare(sPh,6.5,8.4);
            tint.push("pH ("+sPh.length+" pts): "+(sh>0.5?"repeated excursions outside 6.5-8.4.":(sh>0?"occasional excursions outside 6.5-8.4.":"remains within 6.5-8.4.")));
        }
        if(sTds.length>=2){
            var sh2 = bandShare(sTds,0,450);
            tint.push("TDS ("+sTds.length+" pts): "+(sh2>0.5?"remains elevated above 450 mg/L.":(sh2>0?"partly above the preferred level.":"remains within the preferred level.")));
        }
        if(sTb.length>=2){
            var sh3 = bandShare(sTb,0,1);
            tint.push("Turbidity ("+sTb.length+" pts): "+(sh3>0.5?"remains above the 1 NTU preferred band.":(sh3>0?"partly above the preferred band.":"remains clear.")));
        }
        if(sTp.length>=2){
            var sh4 = bandShare(sTp,15,30);
            tint.push("Temperature ("+sTp.length+" pts): "+(sh4>0.5?"repeatedly outside 15-30 C.":(sh4>0?"occasional excursions outside 15-30 C.":"remains within 15-30 C.")));
        }
        bullets(tint);
    }

    /* ================= 11 CAMERA ================= */
    if(cam && (cam.prediction || cam.overall_observation || cam.summary)){
        h2("11", "AI / Camera Findings", "Visual screening only - not a laboratory result.");
        para(String(cam.prediction || cam.overall_observation || cam.summary || ""), {});
        if(cam.confidence!==undefined&&cam.confidence!==null) para("Reported confidence: "+Math.round(Number(cam.confidence)*100)+"%.", {size:8.5});
        para("Camera analysis cannot measure pH, TDS, temperature, turbidity or contaminants; it complements but never replaces sensor data.", {size:7.5, color:GRAY});
    }

    /* ================= FIGURES ================= */
    if(figures && figures.length){
        h2("12", "Annexed Figures", "Supporting imagery attached to this report.");
        figures.forEach(function(f, i){
            var src = f.src||f.dataUrl||f, cap = f.caption||("Figure "+(i+1));
            try{
                var img = doc.getImageProperties(src);
                var maxW = CW, maxH = H-FOOT-y-60;
                if(maxH < 140){ newPage(); maxH = H-FOOT-y-60; }
                var r = Math.min(maxW/img.width, maxH/img.height);
                var iw = img.width*r, ih = img.height*r;
                need(ih+34);
                doc.addImage(src, "JPEG", M+(CW-iw)/2, y, iw, ih);
                y += ih + 5;
                doc.setFont("helvetica","italic"); doc.setFontSize(7.5);
                doc.setTextColor(GRAY[0],GRAY[1],GRAY[2]);
                doc.text("Figure "+(i+1)+". "+cap, M, y);
                y += 14;
            }catch(e){
                para("Figure "+(i+1)+" ("+cap+") could not be embedded.", {size:8});
            }
        });
    }

    /* ================= 13 RECOMMENDATIONS ================= */
    h2("13", "Recommendations", "Grouped actions derived from the limiting parameters above.");
    var imm = [], mon = [];
    if(derived){
        var cPh2 = condOf("ph", derived.ph), cTd2 = condOf("tds", derived.tds),
            cTb2 = condOf("turbidity", derived.turbidity), cTp2 = condOf("temperature", derived.temperature);
        if(cPh2.level!=="good"&&derived.ph!==null) imm.push("Verify pH ("+fmtVal(reading.ph,2)+") with a calibrated instrument before sensitive plantings.");
        if(cTb2.level==="alert"&&derived.turbidity!==null) imm.push("Address turbidity ("+fmtVal(reading.turbidity,2)+" NTU) - settle or filter before irrigation.");
        if(cTp2.level==="alert"&&derived.temperature!==null) imm.push("Re-measure temperature ("+fmtVal(reading.temperature,1)+" C) during cooler conditions.");
        if(cTd2.level!=="good"&&derived.tds!==null) mon.push("Track TDS/EC ("+fmtVal(reading.tds,0)+" mg/L); prefer salt-tolerant crops and consider blending.");
        if(cTb2.level==="caution") mon.push("Monitor turbidity; confirm drip lines stay clear.");
        mon.push("Continue sensor monitoring on the regular schedule.");
        if(top) mon.push("Monitor crop response for "+top.crop.name+" against the constraints above.");
    } else {
        imm.push("Collect sensor readings before acting.");
    }
    if(imm.length){ h3("Immediate actions"); bullets(imm); }
    if(mon.length){ h3("Monitoring actions"); bullets(mon); }
    h3("Validation");
    bullets(["Laboratory analysis is recommended before major agricultural decisions."]);

    /* ================= 14 FINAL ================= */
    h2("14", "Final Assessment & Limitations", "Closing judgement, scope and constraints - kept with the conclusion.");
    (function(){
        var gap=8, bw=(CW-2*gap)/3, bh=62;
        var frows = top?[["Salinity",top.res.salinityScore],["pH",top.res.phScore],["Temperature",top.res.temperatureScore],["Turbidity",top.res.turbidityScore]].filter(function(p){return p[1]!==null;}).sort(function(a,b){return a[1]-b[1];}):[];
        need(bh+40);
        var fc = [
            {t:"WATER", v: overall===null?"n/a":overall+" / 100", s: overall===null?"Unavailable":waterScoreLabel(overall)},
            {t:"CROP", v: top?top.crop.name:"n/a", s: top?(Math.round(top.res.suitability)+"% "+scoreLabel(top.res.suitability)):"Unavailable"},
            {t:"CONSTRAINT", v: frows.length?frows[0][0]:"n/a", s: frows.length?("strongest limit"):"No data"}
        ];
        fc.forEach(function(cd,i){
            var cx=M+i*(bw+gap);
            doc.setFillColor(NAVY[0],NAVY[1],NAVY[2]);
            doc.roundedRect(cx, y, bw, bh, 6, 6, "F");
            doc.setFont("helvetica","bold"); doc.setFontSize(7);
            doc.setTextColor(150,185,198);
            doc.text(cd.t, cx+10, y+15);
            doc.setFontSize(12); doc.setTextColor(255,255,255);
            doc.text(String(cd.v).slice(0,20), cx+10, y+35);
            doc.setFontSize(7.5); doc.setTextColor(170,200,212);
            doc.text(String(cd.s).slice(0,24), cx+10, y+50);
        });
        y += bh + 10;
    })();
    if(overall!==null){
        para("The sample scores "+overall+"/100 ("+waterScoreLabel(overall)+"). "+(top?("Strongest match is "+top.crop.name+" at "+Math.round(top.res.suitability)+"% ("+scoreLabel(top.res.suitability)+"). "+top.res.reason+" "):"")+"Judgement is limited to the sensed parameters and the configured references cited below.", {});
    } else {
        para("No assessment is possible until sensor readings are available.", {});
    }
    h3("Report limitations");
    bullets([
        "Data source: live sensor / database. Measured: pH, TDS, turbidity, temperature. Derived: EC, ion concentration, indexes and scores.",
        "Reference source: the application's configured dataset (ANALYSIS_CONFIG, CROP_PROFILES, drinking-screening profile). No external citation database is stored in the project.",
        "EC is estimated from TDS (factor 650), not directly measured. Sensor accuracy and calibration are outside this report's scope.",
        "Camera findings, where present, are visual screening only and never replace laboratory testing.",
        "This report is a prototype assessment aid, not a laboratory certification."
    ]);
    h3("References");
    bullets([
        "CROP_PROFILES (12 crops: Rice, Wheat, Maize, Sugarcane, Tomato, Cucumber, Potato, Pepper, Lettuce, Carrot, Bean, Onion) - EC tolerance, pH/temperature ranges, turbidity preference.",
        "ANALYSIS_CONFIG - EC factor 650; irrigation bands TDS 450/2000 mg/L, pH 6.5-8.4; temperature 15-30 C; overall weights 0.35/0.30/0.20/0.15; crop weights 0.45/0.25/0.20/0.10.",
        "Drinking-screening profile (pH 6.5-8.5, TDS < 500 mg/L, turbidity < 5 NTU) - screening only.",
        "Sample: device "+pdfSafe(devName).slice(0,40)+(reading&&reading.device_id!==undefined?(" (ID "+reading.device_id+")"):"")+", reading "+(reading&&reading.id!==undefined?("#"+reading.id):"n/a")+" recorded "+(reading?formatPdfDate(reading.recorded_at):"n/a")+"."
    ]);

    /* ---------- single-pass header/footer ---------- */
    var total = doc.internal.getNumberOfPages();
    for(var p=1;p<=total;p++){
        doc.setPage(p);
        doc.setFont("helvetica","normal"); doc.setFontSize(7);
        doc.setTextColor(130,130,130);
        if(p>1){
            doc.setFont("helvetica","bold");
            doc.text("AQUA SENSE", M, 30);
            doc.setFont("helvetica","normal");
            doc.text("Water Quality & Crop Suitability Analysis", M+52, 30);
            doc.setDrawColor(220,220,220); doc.setLineWidth(0.5);
            doc.line(M, 35, W-M, 35);
        }
        doc.text("Aqua Sense  |  Water Quality & Crop Suitability Analysis", M, H-22);
        doc.text("Page "+p+" of "+total, W-M, H-22, {align:"right"});
        doc.text("Generated: "+formatPdfNow(), W/2, H-12, {align:"center"});
    }
    return doc;
}
function currentReportPdfLines(){
    var ctx=getReportContext();
    var r=ctx.reading, d=ctx.derived;
    return [
        "Aqua Sense - Water Quality Analysis Report",
        "Generated: "+formatPdfNow(),
        "Latest: "+(r?formatPdfDate(r.recorded_at):"Not available"),
        "Overall: "+(d&&d.analyticalWaterScore!==null?Math.round(d.analyticalWaterScore)+"/100":"Not available")
    ];
}
function buildReportPdfBytes(lines){ var doc=buildProfessionalPdf(); return doc; }
async function downloadReportPdf(button){
    if(typeof pdfExportInFlight!=="undefined" && pdfExportInFlight) return;
    var originalLabel = button?button.innerHTML:null;
    if(typeof pdfExportInFlight!=="undefined") pdfExportInFlight=true; else window.pdfExportInFlight=true;
    if(button){ button.disabled=true; button.innerHTML='<i class="ri-loader-4-line"></i> Generating...'; }
    try{
        if(!latestReading){ await renderReportPage(); }
        if(!latestReading){ showToast("No live report data is available yet.","warning"); return; }
        var doc = buildProfessionalPdf();
        var fname = "Aqua_Sense";
        try{
            var devName = latestDevice&&latestDevice.name?sanitizeFilename(latestDevice.name):null;
            if(devName) fname += "_"+devName;
        }catch(e){}
        fname += "_Water_Quality_Report_"+exportDateStamp(new Date())+".pdf";
        doc.save(fname);
        showToast("Report PDF downloaded.","success");
    }catch(error){
        console.error(error);
        showToast("PDF download failed. Please try again.","error");
    }finally{
        if(typeof pdfExportInFlight!=="undefined") pdfExportInFlight=false; else window.pdfExportInFlight=false;
        if(button){ button.disabled=false; if(originalLabel!==null) button.innerHTML=originalLabel; }
    }
}
function setupReports() {
    // Legacy report hooks removed with the report redesign.
    // Rendering is handled by renderReportPage when the page opens.
    const refreshButton = $("reportRefreshButton");
    if (refreshButton && !refreshButton.dataset.reportReady) {
        refreshButton.dataset.reportReady = "true";
        refreshButton.addEventListener("click", () => {
            renderReportPage();
        });
    }

    const printButton = $("reportPrintButton");
    if (printButton && !printButton.dataset.reportReady) {
        printButton.dataset.reportReady = "true";
        printButton.addEventListener("click", () => {
            window.print();
        });
    }

    const csvButton = $("reportCsvButton");
    if (csvButton && !csvButton.dataset.reportReady) {
        csvButton.dataset.reportReady = "true";
        csvButton.addEventListener("click", () => {
            exportLiveReadingsCsv(csvButton);
        });
    }

    const pdfButton = $("reportPdfButton");
    if (pdfButton && !pdfButton.dataset.reportReady) {
        pdfButton.dataset.reportReady = "true";
        pdfButton.addEventListener("click", () => {
            downloadReportPdf(pdfButton);
        });
    }

    const retryButton = $("reportRetryButton");
    if (retryButton && !retryButton.dataset.reportReady) {
        retryButton.dataset.reportReady = "true";
        retryButton.addEventListener("click", () => {
            renderReportPage();
        });
    }
}

function syncPrefControls() {
    const prefs = getPrefs();

    document.querySelectorAll("[data-theme-value]").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.themeValue === prefs.theme
        );
    });

    document.querySelectorAll("[data-temp-value]").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.tempValue === prefs.tempUnit
        );
    });

    const autoToggle = $("autoRefreshToggle");
    if (autoToggle) {
        autoToggle.checked = prefs.autoRefresh;
    }
    const profileAuto = $("profileAutoRefreshToggle");
    if (profileAuto) {
        profileAuto.checked = prefs.autoRefresh;
    }

    const interval = $("refreshIntervalSelect");
    if (interval) {
        interval.value = String(prefs.refreshIntervalMs);
    }

    const chatToggle = $("chatHistoryToggle");
    if (chatToggle) {
        chatToggle.checked = prefs.chatHistory;
    }

    const profileNotif = $("profileNotifToggle");
    if (profileNotif) {
        profileNotif.checked = prefs.notif.quality;
    }

    const notifQuality = $("notifQualityToggle");
    if (notifQuality) {
        notifQuality.checked = prefs.notif.quality;
    }
    const notifStale = $("notifStaleToggle");
    if (notifStale) {
        notifStale.checked = prefs.notif.stale;
    }
    const notifCamera = $("notifCameraToggle");
    if (notifCamera) {
        notifCamera.checked = prefs.notif.camera;
    }
}

function renderProfilePage() {
    syncPrefControls();
}

function renderSettingsState() {
    syncPrefControls();

    const env = $("appEnvironment");
    if (env) {
        env.textContent = window.location.protocol === "https:" ? "Production" : "Local";
    }

    // Live AI availability (informational only — no secrets exposed).
    (async () => {
        try {
            const health = await apiRequest("/ai/health");
            setText(
                "aiAssistantStatus",
                health && health.text_ai_available ? "Available" : "Unavailable"
            );
            setText(
                "cameraAiStatus",
                health && health.vision_ai_available ? "Available" : "Unavailable"
            );
        } catch {
            setText("aiAssistantStatus", "Unavailable");
            setText("cameraAiStatus", "Unavailable");
        }
    })();

    // Live backend status.
    (async () => {
        try {
            const ok = await checkBackend();
            setText("appBackendStatus", ok ? "Connected" : "Unavailable");
        } catch {
            setText("appBackendStatus", "Unavailable");
        }
    })();
}

function setupProfile() {
    // Rendering is handled by renderProfilePage when the page opens.
}

function setupPreferenceControls() {
    document.querySelectorAll("[data-theme-value]").forEach((button) => {
        if (button.dataset.prefReady) {
            return;
        }
        button.dataset.prefReady = "true";
        button.addEventListener("click", () => {
            const prefs = getPrefs();
            prefs.theme = button.dataset.themeValue;
            savePrefs(prefs);
            applyTheme(prefs.theme);
            syncPrefControls();
        });
    });

    document.querySelectorAll("[data-temp-value]").forEach((button) => {
        if (button.dataset.prefReady) {
            return;
        }
        button.dataset.prefReady = "true";
        button.addEventListener("click", () => {
            const prefs = getPrefs();
            prefs.tempUnit = button.dataset.tempValue;
            savePrefs(prefs);
            syncPrefControls();
            if (currentPage === "reports") {
                renderReportPage();
            }
        });
    });

    const bindToggle = (id, apply) => {
        const el = $(id);
        if (!el || el.dataset.prefReady) {
            return;
        }
        el.dataset.prefReady = "true";
        el.addEventListener("change", () => {
            const prefs = getPrefs();
            apply(prefs, el.checked);
            savePrefs(prefs);
            syncPrefControls();
            applyPrefsToRefresh();
            if (currentPage === "reports") {
                renderReportPage();
            }
        });
    };

    bindToggle("autoRefreshToggle", (prefs, checked) => {
        prefs.autoRefresh = checked;
    });
    bindToggle("profileAutoRefreshToggle", (prefs, checked) => {
        prefs.autoRefresh = checked;
    });
    bindToggle("profileNotifToggle", (prefs, checked) => {
        prefs.notif.quality = checked;
        prefs.notif.stale = checked;
        prefs.notif.camera = checked;
    });
    bindToggle("notifQualityToggle", (prefs, checked) => {
        prefs.notif.quality = checked;
    });
    bindToggle("notifStaleToggle", (prefs, checked) => {
        prefs.notif.stale = checked;
    });
    bindToggle("notifCameraToggle", (prefs, checked) => {
        prefs.notif.camera = checked;
    });
    bindToggle("chatHistoryToggle", (prefs, checked) => {
        prefs.chatHistory = checked;
    });

    const interval = $("refreshIntervalSelect");
    if (interval && !interval.dataset.prefReady) {
        interval.dataset.prefReady = "true";
        interval.addEventListener("change", () => {
            const prefs = getPrefs();
            const ms = Number(interval.value);
            if (REFRESH_INTERVALS_MS.includes(ms)) {
                prefs.refreshIntervalMs = ms;
                savePrefs(prefs);
            }
            syncPrefControls();
            applyPrefsToRefresh();
        });
    }

    const resetButton = $("resetPrefsButton");
    if (resetButton && !resetButton.dataset.prefReady) {
        resetButton.dataset.prefReady = "true";
        resetButton.addEventListener("click", () => {
            const confirmed = window.confirm(
                "Reset Aqua Sense display preferences in this browser? " +
                "Readings, devices and backend data are not affected."
            );
            if (!confirmed) {
                return;
            }
            try {
                localStorage.removeItem(AQUA_PREFS_KEY);
                localStorage.removeItem("aqua_ai_provider");
                localStorage.removeItem("aqua_ai_model");
            } catch {
                // Storage blocked — nothing to clear.
            }
            const prefs = getPrefs();
            applyTheme(prefs.theme);
            applyPrefsToRefresh();
            syncPrefControls();
            renderSettingsState();
            showToast("Preferences reset to defaults.", "success");
        });
    }
}
/* Alerts — Email Alert Center */
let alertsFilter = "active";
let allAlertsCache = [];
let allContactsCache = [];

async function loadAlerts(){
    try{
        // Fetch the FULL set (active + resolved): the email-history list is
        // grouped from every row that recorded a notification, and resolved
        // history rows must never be hidden by the active/resolved filter.
        // The alerts list itself is still filtered client-side.
        const all = await apiRequest(`/alerts?status=all`);
        allAlertsCache = all || [];
        var visible = allAlertsCache;
        if(alertsFilter === "active") visible = allAlertsCache.filter(function(a){return a.status==="active";});
        else if(alertsFilter === "resolved") visible = allAlertsCache.filter(function(a){return a.status==="resolved";});
        renderAlerts(visible);
        renderEmailHistory(allAlertsCache);
        renderHistory(visible);
        updateSummary();
    }catch(e){ const el=$("alertsList"); if(el) el.innerHTML=`<p style="color:var(--red)">Failed to load alerts: ${escapeHtml(e.message)}</p>`; }
    loadAutoStatus();
}
function updateSummary(){
    const a = allAlertsCache.filter(function(x){return x.status==="active";}).length;
    const r = allAlertsCache.filter(function(x){return x.status==="resolved";}).length;
    const sa=$("summaryActive"); if(sa) sa.textContent = a;
    const sr=$("summaryResolved"); if(sr) sr.textContent = r;
}

function renderAlerts(alerts){
    const list=$("alertsList"); const empty=$("alertsEmpty");
    if(!list) return;
    if(!alerts||alerts.length===0){ list.innerHTML=""; if(empty) empty.classList.remove("hidden"); return; }
    if(empty) empty.classList.add("hidden");
    list.innerHTML = alerts.map(function(a){
        var isActive = a.status==="active";
        var dotClass = isActive ? "active" : "resolved";
        var badgeClass = isActive ? "alert" : "unknown";
        var created = a.created_at ? parseApiDate(a.created_at).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "--";
        var last = a.last_notified_at ? parseApiDate(a.last_notified_at).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "Never";
        var cooldown = a.cooldown_remaining>0 ? Math.floor(a.cooldown_remaining/60)+"m "+(a.cooldown_remaining%60)+"s" : "Ready";
        var thr = a.threshold_value!=null ? a.threshold_value : "--";
        var cur = a.current_value!=null ? a.current_value : "--";
        var emailSt = a.email_status || "--";
        var emailBadge = emailSt==="sent" ? "ok" : emailSt==="failed" ? "bad" : "";
        return `<div class="alert-row" onclick="toggleAlertDetails(${a.id})" role="button" tabindex="0" aria-expanded="false" aria-controls="alert-detail-${a.id}" onkeydown="if(event.key==='Enter'||event.key===' ') {event.preventDefault(); toggleAlertDetails(${a.id});}">
            <div class="alert-row-header">
                <div class="alert-row-main"><span class="alert-row-dot ${dotClass}"></span><div><div style="font-weight:700;font-size:13px;color:var(--text-primary)">${escapeHtml(a.parameter)} <span style="font-weight:400;color:var(--text-muted);font-size:11px">· Critical threshold exceeded</span></div><div style="font-size:11px;color:var(--text-muted)">${escapeHtml(a.message||"")}</div></div></div>
                <div style="text-align:right;flex-shrink:0"><div style="font-size:12px;font-weight:700">${escapeHtml(String(cur))} <span style="font-weight:400;color:var(--text-muted)">/ Threshold ${escapeHtml(String(thr))}</span></div><div style="font-size:11px;color:var(--text-muted)">${escapeHtml(created)}</div></div>
                <div style="text-align:right;flex-shrink:0"><span class="quality-status-badge ${badgeClass}" style="font-size:10px">${escapeHtml(a.status)}</span><div style="font-size:11px;margin-top:4px"><span class="provider-pill ${emailBadge}" style="font-size:10px;padding:2px 6px">✉ ${escapeHtml(emailSt)}</span></div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">${isActive? "Cooldown "+cooldown : "Resolved"}</div></div>
            </div>
            <div id="alert-detail-${a.id}" class="hidden" style="margin-top:10px;padding:10px;background:var(--bg-soft);border-radius:8px;border:1px solid var(--border-color);font-size:12px;line-height:1.6">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                    <div><span style="color:var(--text-muted)">Parameter</span><br><strong>${escapeHtml(a.parameter)}</strong></div>
                    <div><span style="color:var(--text-muted)">Current value</span><br><strong>${escapeHtml(String(cur))}</strong></div>
                    <div><span style="color:var(--text-muted)">Critical threshold</span><br><strong>${escapeHtml(String(thr))}</strong></div>
                    <div><span style="color:var(--text-muted)">Device</span><br><strong>${escapeHtml(String(a.device_id||"--"))}</strong></div>
                    <div><span style="color:var(--text-muted)">Reading ID</span><br><strong>${escapeHtml(String(a.reading_id||"--"))}</strong></div>
                    <div><span style="color:var(--text-muted)">Alert created</span><br><strong>${escapeHtml(created)}</strong></div>
                    <div><span style="color:var(--text-muted)">Last notification</span><br><strong>${escapeHtml(last)}</strong></div>
                    <div><span style="color:var(--text-muted)">Email status</span><br><strong>${escapeHtml(emailSt)}</strong></div>
                </div>
                <div style="margin-top:8px;font-size:11px;color:var(--text-muted)">Cooldown remaining: ${escapeHtml(cooldown)} · ${a.status==="active"?"Active — will resolve when parameter returns to normal":"Resolved at "+(a.resolved_at? parseApiDate(a.resolved_at).toLocaleString():"--")}</div>
                <div style="margin-top:6px;font-size:11px;color:var(--text-muted)">${escapeHtml(a.parameter)} is ${a.parameter==="ph" && a.current_value < 5.5 ? "below" : "above"} the configured critical threshold of ${escapeHtml(String(thr))}.</div>
            </div>
        </div>`;
    }).join("");
}
window.toggleAlertDetails = function(id){
    var el=$("alert-detail-"+id);
    if(!el) return;
    var isHidden=el.classList.contains("hidden");
    if(isHidden){ el.classList.remove("hidden"); var row=el.closest(".alert-row"); if(row) row.setAttribute("aria-expanded","true"); }
    else { el.classList.add("hidden"); var row2=el.closest(".alert-row"); if(row2) row2.setAttribute("aria-expanded","false"); }
};


/* ---- Automatic Alert Status (backend is authoritative; frontend only displays) ---- */
var autoClockTimer = null;
var autoClockDeadlineMs = 0;
var autoStatusCache = null;

var autoStatusSeq = 0;
async function loadAutoStatus(){
    var mySeq = ++autoStatusSeq;
    try{
        const s = await apiRequest("/alerts/auto-status");
        if(mySeq !== autoStatusSeq) return; // stale response: a newer sync already started
        autoStatusCache = s;
        renderAutoStatus(s);
    }catch(e){
        if(mySeq !== autoStatusSeq) return;
        var badge=$("autoStatusBadge");
        if(badge){ badge.textContent="UNKNOWN"; badge.className="quality-status-badge unknown"; }
        var em=$("autoEmailState"); if(em) em.textContent="Status unavailable";
    }
}
function renderAutoStatus(s){
    var badge=$("autoStatusBadge");
    var emailEl=$("autoEmailState");
    var critWrap=$("autoCritParams");
    var clockWrap=$("autoCooldownWrap");
    var clockEl=$("autoCooldownClock");
    var subEl=$("autoCooldownSub");
    var readyEl=$("autoReadyMsg");
    var normalEl=$("autoNormalMsg");
    var cfgEl=$("autoCooldownCfg");
    var lastEl=$("autoLastNotified");
    if(!badge) return;
    var status = s.latest_status || "unknown";
    var isCrit = status==="critical";
    var isNormal = status==="normal";
    badge.textContent = isCrit ? "CRITICAL" : isNormal ? "NORMAL" : "UNKNOWN";
    badge.className = "quality-status-badge " + (isCrit ? "alert" : isNormal ? "safe" : "unknown");
    // Automatic email state: Enabled / Disabled / Provider not configured
    if(emailEl){
        if(!s.alerts_enabled){ emailEl.textContent="Disabled"; emailEl.style.color="var(--status-critical)"; }
        else if(!s.provider_configured){ emailEl.textContent="Provider not configured"; emailEl.style.color="var(--status-critical)"; }
        else { emailEl.textContent="Enabled"; emailEl.style.color="var(--status-normal)"; }
    }
    // Critical parameters (may be several; one combined email covers them)
    if(critWrap){
        critWrap.innerHTML = isCrit ? (s.critical_parameters||[]).map(function(p){
            var unit = p.parameter==="ph" ? "" : p.parameter==="turbidity" ? " NTU" : p.parameter==="tds" ? " mg/L" : p.parameter==="temperature" ? " °C" : "";
            return `<span class="provider-pill bad" style="font-size:11px">${escapeHtml(p.parameter)} ${escapeHtml(String(p.current_value))}${escapeHtml(unit)} (threshold ${escapeHtml(String(p.threshold))})</span>`;
        }).join("") : "";
    }
    if(cfgEl) cfgEl.textContent = "Cooldown: " + (s.cooldown_minutes!=null ? s.cooldown_minutes + " minute" + (s.cooldown_minutes==1?"":"s") : "—");
    // Latest successful notification time across per-parameter cooldowns
    var lastMs = 0;
    (s.cooldowns||[]).forEach(function(c){
        if(c.last_notified_at){
            var m = parseApiTimestamp(c.last_notified_at);
            if(!isNaN(m) && m > lastMs) lastMs = m;
        }
    });
    if(lastEl) lastEl.textContent = "Last email: " + (lastMs ? new Date(lastMs).toLocaleString() : "—");

    // Clock / ready / normal messaging.
    // Backend timestamps are authoritative. remaining = next_eligible_at - now.
    // The countdown survives NORMAL readings, browser refresh, and backend
    // restarts because last_notified_at lives in the database.
    // When automatic alerts are OFF, the historical cooldown timestamps are
    // preserved in the DB but NO countdown is presented as operational.
    var alertsOn = s.alerts_enabled !== false;
    if(!alertsOn){
        stopAutoClock();
        if(clockWrap) clockWrap.classList.add("hidden");
        if(readyEl) readyEl.classList.add("hidden");
        if(normalEl){
            normalEl.classList.remove("hidden");
            normalEl.textContent = "Automatic Alerts — OFF · Automatic alert processing is disabled.";
        }
        if(subEl) subEl.textContent = "";
        return;
    }
    var cdActive = !!(s.overall && s.overall.cooldown_active);
    var cdSecs = (s.overall && s.overall.next_eligible_in_seconds) || 0;
    var cdIso = s.overall && s.overall.next_eligible_at;
    if(cdActive && cdSecs > 0){
        if(readyEl) readyEl.classList.add("hidden");
        if(normalEl) normalEl.classList.add("hidden");
        if(clockWrap) clockWrap.classList.remove("hidden");
        if(subEl){
            var perParam = (s.cooldowns||[]).filter(function(c){return (c.next_eligible_in_seconds||c.remaining_seconds||0)>0;})
                .map(function(c){return c.parameter;}).join(", ");
            subEl.textContent = "Cooldown active" + (perParam ? " · " + perParam : "") + " · Next critical reading eligible after cooldown";
        }
        syncAutoClockFromIso(cdIso, cdSecs);
    } else if(isCrit){
        // Cooldown expired (or never started) while the latest reading is
        // still critical: NEVER sit idle on "Ready..." — fire the backend
        // re-check immediately so the next email goes out with no gap, then
        // refresh the alerts list + email history from the authoritative
        // result. The backend cooldown still suppresses duplicates, so this
        // is safe to attempt on every eligible render (debounced inside).
        stopAutoClock();
        if(clockWrap) clockWrap.classList.add("hidden");
        if(normalEl) normalEl.classList.add("hidden");
        if(readyEl){
            readyEl.classList.remove("hidden");
            if(!s.provider_configured){
                readyEl.textContent = "Automatic email paused — provider not configured";
            } else if(autoResendInFlight){
                readyEl.textContent = "Cooldown expired — sending next critical email…";
            } else {
                readyEl.textContent = "Cooldown expired — sending next critical email…";
            }
        }
        if(s.provider_configured && !autoResendInFlight){
            triggerAutoResendAfterCooldown("eligible-critical");
        }
    } else if(isNormal){
        stopAutoClock();
        if(clockWrap) clockWrap.classList.add("hidden");
        if(readyEl) readyEl.classList.add("hidden");
        if(normalEl){
            normalEl.classList.remove("hidden");
            normalEl.textContent = "Automatic Alerts — Normal — No cooldown active";
        }
    }
}
/* Authoritative display: remaining = next_eligible_at - Date.now().
 * ISO timestamp is preferred (robust to refresh/restart/drift); the
 * numeric fallback keeps older payloads working. Periodic resync from
 * GET /alerts/auto-status corrects any local drift. */
function syncAutoClockFromIso(nextEligibleIso, fallbackSecs){
    var targetDeadline = 0;
    if(nextEligibleIso){
        var parsed = Date.parse(nextEligibleIso);
        if(!isNaN(parsed)) targetDeadline = parsed;
    }
    if(!targetDeadline) targetDeadline = Date.now() + Math.max(0, fallbackSecs || 0) * 1000;
    if(!autoClockTimer || Math.abs(autoClockDeadlineMs - targetDeadline) > 1500){
        autoClockDeadlineMs = targetDeadline;
    }
    if(!autoClockTimer){
        tickAutoClock();
        autoClockTimer = setInterval(tickAutoClock, 1000);
    }
}
function syncAutoClock(serverSecs){
    syncAutoClockFromIso(null, serverSecs);
}
function startAutoClock(secs){
    syncAutoClockFromIso(null, secs);
}
function tickAutoClock(){
    var clockEl=$("autoCooldownClock");
    var remaining = Math.max(0, Math.round((autoClockDeadlineMs - Date.now())/1000));
    var mm = String(Math.floor(remaining/60)).padStart(2,"0");
    var ss = String(remaining%60).padStart(2,"0");
    var display = mm+":"+ss;
    if(clockEl){
        clockEl.textContent = display;
    }

    if(remaining<=0){
        stopAutoClock();
        // No gap: the moment the cooldown hits zero, run the backend
        // re-check (it sends immediately when the latest reading is still
        // critical) and refresh alerts + email history + status together.
        var readyEl = $("autoReadyMsg");
        var clockWrap = $("autoCooldownWrap");
        if(clockWrap) clockWrap.classList.add("hidden");
        if(readyEl){
            readyEl.classList.remove("hidden");
            readyEl.textContent = "Cooldown expired — sending next critical email…";
        }
        triggerAutoResendAfterCooldown("cooldown-expired");
    }
}
/* No-gap resend: ask the backend to re-evaluate the latest stored reading
 * right now (POST /alerts/run-startup-check sends the REAL email when the
 * reading is critical and the cooldown is not active), then refresh the
 * alerts list, the email history, and the authoritative status together.
 * Debounced per eligible window so polling renders can never spam sends;
 * the backend cooldown is the final duplicate guard. */
var autoResendInFlight = false;
var lastAutoResendSig = "";
var lastAutoResendMs = 0;
async function triggerAutoResendAfterCooldown(reason){
    if(autoResendInFlight) return;
    var s = autoStatusCache || {};
    var readingId = (s.latest_reading && s.latest_reading.id) || "";
    var paramsSig = ((s.critical_parameters||[]).map(function(p){return p.parameter;}).sort().join(","));
    var sig = readingId + "|" + paramsSig;
    var nowMs = Date.now();
    if(sig && sig === lastAutoResendSig && (nowMs - lastAutoResendMs) < 30000) return;
    autoResendInFlight = true;
    lastAutoResendSig = sig;
    lastAutoResendMs = nowMs;
    try{
        await apiRequest("/alerts/run-startup-check", {method:"POST"});
    }catch(e){
        // A failed re-check must never leave the card stuck: fall through
        // to the authoritative refresh below.
    }
    autoResendInFlight = false;
    try{
        await loadAlerts();
    }catch(e){
        try{ await loadAutoStatus(); }catch(_){}
    }
    if(typeof loadCurrentStatus === "function"){ try{ loadCurrentStatus(); }catch(e){} }
}
function stopAutoClock(){
    if(autoClockTimer){
        try{ clearInterval(autoClockTimer); }catch(e){}
        autoClockTimer = null;
    }
}

function renderEmailHistory(alerts){
    const list=$("emailHistoryList"); const empty=$("emailHistoryEmpty");
    const fallback=$("alertHistoryBody");
    // Group one combined email per reading: every parameter row notified for
    // the same reading shares one send time. Compare REAL timestamps (never
    // raw strings — mixed "Z" / "+00:00" suffixes do not sort as strings)
    // and keep the LATEST time of the group. Backend timestamps are UTC so
    // parseApiDate renders the true local time.
    var groups={};
    (alerts||[]).forEach(function(a){
        if(!a.last_notified_at) return;
        var key = (a.reading_id!=null ? "r"+a.reading_id : "t"+a.last_notified_at);
        if(!groups[key]) groups[key]={time:a.last_notified_at, timeMs:parseApiTimestamp(a.last_notified_at), device:a.device_id, reading_id:a.reading_id, params:[], email_status: a.email_status, created_at:a.created_at};
        groups[key].params.push(a);
        var m = parseApiTimestamp(a.last_notified_at);
        if(!isNaN(m) && (isNaN(groups[key].timeMs) || m > groups[key].timeMs)){ groups[key].time=a.last_notified_at; groups[key].timeMs=m; }
        if(groups[key].email_status!=="sent" && groups[key].email_status!=="partial" && groups[key].email_status!=="sent_manual"){
            groups[key].email_status = a.email_status;
        }
    });
    function emailKindLabel(st){
        return st==="sent_manual" ? "Manual" : "Automatic";
    }
    function recipientLabel(){
        var active = (allContactsCache||[]).filter(function(c){return c.active && c.email;});
        if(active.length===0) return "Active recipients";
        if(active.length===1) return active[0].email;
        return active[0].email + " +" + (active.length-1) + " more";
    }
    var grouped = Object.values(groups).sort(function(a,b){ return (b.timeMs||0)-(a.timeMs||0); }).slice(0,20);
    if(list){
        if(grouped.length===0){ list.innerHTML=""; if(empty) empty.classList.remove("hidden"); }
        else {
            if(empty) empty.classList.add("hidden");
            list.innerHTML = grouped.map(function(g){
                var t = g.time ? parseApiDate(g.time).toLocaleString() : "--";
                var paramsText = g.params.map(function(p){ return p.parameter; }).join(" · ");
                var count = g.params.length;
                var status = g.email_status || g.params[0].email_status || "--";
                var badgeClass = (status==="sent"||status==="sent_manual"||status==="partial") ? "ok" : status==="failed" ? "bad" : "";
                var device = g.device || "--";
                var recipient = recipientLabel();
                var kind = emailKindLabel(status);
                var statusText = status==="sent_manual" ? "sent" : status;
                return `<div class="email-history-row" onclick="openEmailHistoryDetail('${g.reading_id||''}')" role="button" tabindex="0">
                    <div style="flex:1;min-width:0">
                        <div style="font-size:12px;font-weight:600;color:var(--text-primary)"><i class="ri-mail-send-line" style="color:var(--primary)"></i> ${escapeHtml(kind)} Alert · ${count} parameter${count!=1?"s":""}</div>
                        <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t)} · ${escapeHtml(String(device))} · Reading #${escapeHtml(String(g.reading_id||"--"))}</div>
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">${escapeHtml(paramsText)}</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                        <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(recipient)}</div>
                        <span class="provider-pill ${badgeClass}" style="font-size:10px;margin-top:4px;display:inline-block">✉ ${escapeHtml(kind)} | ${escapeHtml(statusText)}</span>
                    </div>
                </div>`;
            }).join("");
        }
    }
    if(fallback){
        if(!grouped.length){ fallback.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No email history</td></tr>'; }
        else {
            fallback.innerHTML = grouped.map(function(g){
                var t=g.time? parseApiDate(g.time).toLocaleString():"--";
                var params=g.params.map(function(p){return p.parameter;}).join(", ");
                var rec=recipientLabel();
                var st=g.email_status||g.params[0].email_status||"--";
                var kind=emailKindLabel(st);
                return `<tr><td>${escapeHtml(t)}</td><td>${escapeHtml(String(g.device||"--"))}</td><td>${escapeHtml(params)}</td><td>critical</td><td>${escapeHtml(kind)} | ${escapeHtml(st==="sent_manual"?"sent":st)}</td><td>${escapeHtml(rec)}</td></tr>`;
            }).join("");
        }
    }
}
window.openEmailHistoryDetail = function(readingId){
    var groups={};
    (allAlertsCache||[]).forEach(function(a){
        if(!a.last_notified_at) return;
        var key=(a.reading_id!=null ? "r"+a.reading_id : "t"+a.last_notified_at);
        if(!groups[key]) groups[key]={time:a.last_notified_at, timeMs:parseApiTimestamp(a.last_notified_at), device:a.device_id, reading_id:a.reading_id, params:[]};
        groups[key].params.push(a);
        var m = parseApiTimestamp(a.last_notified_at);
        if(!isNaN(m) && (isNaN(groups[key].timeMs) || m > groups[key].timeMs)){ groups[key].time=a.last_notified_at; groups[key].timeMs=m; }
    });
    var g=Object.values(groups).find(function(x){ return String(x.reading_id)===String(readingId); });
    if(!g) return;
    var body=$("emailHistoryDetailBody");
    if(!body) return;
    var t=g.time? parseApiDate(g.time).toLocaleString():"--";
    var active=(allContactsCache||[]).filter(function(c){return c.active && c.email;});
    var recipient= active.length===0 ? "Active recipients" : active.map(function(c){return c.email;}).join(", ");
    var rows=g.params.map(function(p){
        var thr=p.threshold_value!=null? p.threshold_value : "--";
        var cur=p.current_value!=null? p.current_value : "--";
        var cond = p.parameter==="ph" && p.current_value < 5.5 ? "Below threshold" : "Above threshold";
        return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-color);font-size:13px"><span><strong>${escapeHtml(p.parameter)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${escapeHtml(p.message||"")}</span></span><span style="text-align:right"><strong>${escapeHtml(String(cur))}</strong> → threshold ${escapeHtml(String(thr))}<br><span style="font-size:11px;color:var(--text-muted)">${cond}</span></span></div>`;
    }).join("");
    body.innerHTML = `<div style="font-size:12px;color:var(--text-muted)">To: <strong style="color:var(--text-primary)">${escapeHtml(recipient)}</strong></div>
        <div style="font-size:12px;color:var(--text-muted)">Device: <strong>${escapeHtml(String(g.device||"--"))}</strong> · Reading #${escapeHtml(String(g.reading_id||"--"))}</div>
        <div style="font-size:12px;color:var(--text-muted)">Sent: ${escapeHtml(t)}</div>
        <div style="margin-top:12px"><div style="font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-muted)">Critical parameters</div>${rows}</div>
        <div style="margin-top:12px;padding:8px;background:var(--bg-soft);border-radius:8px;font-size:11px;color:var(--text-muted)"><strong>Notification:</strong> 1 combined email for ${g.params.length} parameter${g.params.length!=1?"s":""} · Status: ${escapeHtml(g.params[0].email_status||"--")}</div>`;
    var modal=$("emailHistoryDetailModal");
    if(modal){ modal.classList.remove("hidden"); modal.style.display="flex"; }
};
function renderHistory(alerts){
    // legacy fallback kept for compatibility
    const body=$("alertHistoryBody");
    if(!body) return;
    if(!alerts||alerts.length===0){ body.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No history</td></tr>'; return; }
    body.innerHTML = alerts.slice(0,50).map(function(a){
        var t=a.created_at? parseApiDate(a.created_at).toLocaleString():"--";
        return `<tr><td>${escapeHtml(t)}</td><td>${a.device_id||"--"}</td><td>${escapeHtml(a.parameter)}</td><td>${escapeHtml(a.severity)}</td><td>${escapeHtml(a.email_status||"--")}</td><td>${escapeHtml(a.status)}</td></tr>`;
    }).join("");
}


async function loadCurrentStatus(){
    try{
        const reading = await apiRequest("/readings/latest");
        setText("alertPh", reading.ph!=null? Number(reading.ph).toFixed(2):"--");
        setText("alertTurbidity", reading.turbidity!=null? Number(reading.turbidity).toFixed(2):"--");
        setText("alertTds", reading.tds!=null? Number(reading.tds).toFixed(0):"--");
        setText("alertTemp", reading.temperature!=null? Number(reading.temperature).toFixed(1):"--");
        const crit = (reading.ph!=null && (reading.ph<5.5 || reading.ph>9.0)) || (reading.turbidity!=null && reading.turbidity>10) || (reading.tds!=null && reading.tds>1500) || (reading.temperature!=null && reading.temperature>40);
        const badge=$("alertStatusBadge");
        const msg=$("alertCurrentMessage");
        if(badge){ badge.textContent = crit ? "CRITICAL" : "NORMAL"; badge.className = "quality-status-badge " + (crit?"alert":"safe"); }
        if(msg) msg.textContent = crit ? "Critical threshold exceeded." : "Water parameters within normal range.";
    }catch(e){
        setText("alertPh","--"); setText("alertTurbidity","--"); setText("alertTds","--"); setText("alertTemp","--");
        const badge=$("alertStatusBadge"); if(badge){ badge.textContent="UNKNOWN"; badge.className="quality-status-badge unknown"; }
    }
}
async function loadProviderStatus(){
    try{
        const s=await apiRequest("/alerts/provider/status");
        const ep=$("emailProviderPill");
        if(ep){ ep.textContent = "Email: " + (s.email.configured ? "Configured" : "Not configured"); ep.className="provider-pill "+(s.email.configured?"ok":"bad"); }
        const badge=$("emailProviderBadge");
        if(badge){ badge.innerHTML = (s.email.configured?'<span class="dot" style="background:var(--status-normal)"></span> Connected' : '<span class="dot" style="background:var(--status-critical)"></span> Not configured'); badge.className="provider-status-badge "+(s.email.configured?"ok":"bad"); }
        const apiKeyEl=$("providerApiKey");
        if(apiKeyEl) apiKeyEl.textContent = s.email.configured ? "Configured" : "Not configured";
        const fromEl=$("providerFromEmail");
        if(fromEl) fromEl.textContent = s.email.configured ? "onboarding@resend.dev" : "—";
        const sumProv=$("summaryProvider");
        if(sumProv) sumProv.textContent = s.email.configured ? "Connected" : "Not configured";
        const sumSub=$("summaryProviderSub");
        if(sumSub) sumSub.textContent = s.email.configured ? "Resend" : "Check .env";
        const opBadge=$("emailAlertsOperational");
        if(opBadge) opBadge.style.display = s.email.configured ? "inline-flex" : "none";
    }catch(e){}
}
var alertConfigSeq = 0;
async function loadAlertConfig(){
    const statusEl=$("alertConfigStatus");
    const errEl=$("alertConfigError");
    var mySeq = ++alertConfigSeq;
    // Loading state: never default the UI to ON before backend state is known.
    // Backend is the single source of truth — no localStorage involved.
    var togglePre=$("alertsEnabledToggle");
    if(togglePre) togglePre.disabled=true;
    var statusPre=$("alertsEnabledStatus");
    if(statusPre){ statusPre.textContent="Loading…"; statusPre.style.color="var(--text-muted)"; }
    var descPre=$("alertsEnabledDesc");
    if(descPre) descPre.textContent="Loading alert state…";
    if(statusEl) statusEl.textContent="Loading alert configuration…";
    if(errEl) errEl.textContent="";
    try{
        const cfg=await apiRequest("/alerts/config");
        if(mySeq !== alertConfigSeq) return; // stale response guard
        const setVal=(id,v)=>{ var el=$(id); if(el) el.value=v; };
        setVal("cfgPhMin", cfg.ph_min);
        setVal("cfgPhMax", cfg.ph_max);
        setVal("cfgTurbidityMax", cfg.turbidity_max);
        setVal("cfgTdsMax", cfg.tds_max);
        setVal("cfgTempMax", cfg.temperature_max);
        setVal("cfgCooldown", cfg.cooldown_minutes);
        var toggle=$("alertsEnabledToggle");
        if(toggle){ toggle.checked=!!cfg.alerts_enabled; toggle.disabled=false; }
        var statusTxt=$("alertsEnabledStatus");
        if(statusTxt) { statusTxt.textContent=cfg.alerts_enabled?"ON":"OFF"; statusTxt.style.color=cfg.alerts_enabled?"var(--status-normal)":"var(--status-critical)"; }
        var desc=$("alertsEnabledDesc");
        if(desc) desc.textContent=cfg.alerts_enabled?"Automatic email notifications for critical conditions":"Automatic alert processing is disabled.";
        var notice=$("alertsDisabledNotice");
        if(notice){ if(cfg.alerts_enabled) notice.classList.add("hidden"); else notice.classList.remove("hidden"); }
        // Manual alert stays available regardless of the automatic toggle.
        var sendBtn=$("sendCurrentStatusBtn");
        if(sendBtn){ sendBtn.disabled=false; sendBtn.title=""; }
        if(statusEl){
            var t=cfg.updated_at? parseApiDate(cfg.updated_at).toLocaleString() : "—";
            statusEl.textContent="Last updated: "+t;
        }
        // also update current status critical check to use new thresholds for display? Keep simple.
    }catch(e){
        if(mySeq !== alertConfigSeq) return;
        var toggleErr=$("alertsEnabledToggle");
        if(toggleErr) toggleErr.disabled=false;
        if(statusEl) statusEl.textContent="Unable to load alert configuration.";
        if(errEl) errEl.textContent= e.message || "Failed to load";
    }
}
async function persistAlertsEnabled(on){
    // Single-toggle persistence: backend owns alerts_enabled. Read the current
    // backend config, flip only alerts_enabled, PUT it back, and render the
    // confirmed backend state (never just the local checkbox).
    var toggle=$("alertsEnabledToggle");
    var statusTxt=$("alertsEnabledStatus");
    var desc=$("alertsEnabledDesc");
    var notice=$("alertsDisabledNotice");
    var sendBtn=$("sendCurrentStatusBtn");
    if(toggle) toggle.disabled=true;
    if(statusTxt){ statusTxt.textContent="Saving…"; statusTxt.style.color="var(--text-muted)"; }
    try{
        const current=await apiRequest("/alerts/config");
        var payload={
            ph_min: current.ph_min, ph_max: current.ph_max,
            turbidity_max: current.turbidity_max, tds_max: current.tds_max,
            temperature_max: current.temperature_max, cooldown_minutes: current.cooldown_minutes,
            alerts_enabled: !!on
        };
        const res=await apiRequest("/alerts/config",{method:"PUT", body:JSON.stringify(payload)});
        if(toggle){ toggle.checked=!!res.alerts_enabled; toggle.disabled=false; }
        if(statusTxt){ statusTxt.textContent=res.alerts_enabled?"ON":"OFF"; statusTxt.style.color=res.alerts_enabled?"var(--status-normal)":"var(--status-critical)"; }
        if(desc) desc.textContent=res.alerts_enabled?"Automatic email notifications for critical conditions":"Automatic alert processing is disabled.";
        if(notice){ if(res.alerts_enabled) notice.classList.add("hidden"); else notice.classList.remove("hidden"); }
        if(sendBtn){ sendBtn.disabled=false; sendBtn.title=""; }
        showToast(res.alerts_enabled?"Automatic alerts enabled":"Automatic alerts disabled","success");
        loadAutoStatus(); // resync authoritative cooldown state immediately
        loadAlertConfig(); // refresh "last updated" + thresholds from backend
    }catch(e){
        if(toggle){ toggle.checked=!on; toggle.disabled=false; } // revert optimistic change
        if(statusTxt){ statusTxt.textContent=(!on)?"ON":"OFF"; }
        showToast(e.message||"Unable to save alert state","error");
    }
}
async function saveAlertConfig(){
    const errEl=$("alertConfigError");
    const statusEl=$("alertConfigStatus");
    if(errEl) errEl.textContent="";
    var payload={
        ph_min: parseFloat($("cfgPhMin").value),
        ph_max: parseFloat($("cfgPhMax").value),
        turbidity_max: parseFloat($("cfgTurbidityMax").value),
        tds_max: parseFloat($("cfgTdsMax").value),
        temperature_max: parseFloat($("cfgTempMax").value),
        cooldown_minutes: parseInt($("cfgCooldown").value,10),
        alerts_enabled: $("alertsEnabledToggle")? $("alertsEnabledToggle").checked : true
    };
    // frontend validation
    if(isNaN(payload.ph_min)||isNaN(payload.ph_max)||isNaN(payload.turbidity_max)||isNaN(payload.tds_max)||isNaN(payload.temperature_max)||isNaN(payload.cooldown_minutes)){
        if(errEl) errEl.textContent="Please fill all threshold fields with valid numbers.";
        return;
    }
    if(payload.ph_min >= payload.ph_max){ if(errEl) errEl.textContent="pH minimum must be less than maximum."; return; }
    if(payload.turbidity_max<0||payload.tds_max<0||payload.temperature_max < -50){ if(errEl) errEl.textContent="Thresholds must be sensible positive values."; return; }
    if(payload.cooldown_minutes<0||payload.cooldown_minutes>1440){ if(errEl) errEl.textContent="Cooldown must be 0–1440 minutes."; return; }
    var saveBtn=$("saveAlertConfigBtn");
    if(saveBtn){ saveBtn.disabled=true; saveBtn.textContent="Saving…"; }
    try{
        const res=await apiRequest("/alerts/config",{method:"PUT", body:JSON.stringify(payload)});
        showToast("Alert settings saved","success");
        // update UI with returned config
        if(statusEl) statusEl.textContent="Last updated: "+(res.updated_at? parseApiDate(res.updated_at).toLocaleString():"just now");
        var toggle=$("alertsEnabledToggle");
        if(toggle){ toggle.checked=!!res.alerts_enabled; }
        var statusTxt=$("alertsEnabledStatus");
        if(statusTxt){ statusTxt.textContent=res.alerts_enabled?"ON":"OFF"; statusTxt.style.color=res.alerts_enabled?"var(--status-normal)":"var(--status-critical)"; }
        var notice=$("alertsDisabledNotice");
        if(notice){ if(res.alerts_enabled) notice.classList.add("hidden"); else notice.classList.remove("hidden"); }
        var sendBtn=$("sendCurrentStatusBtn");
        if(sendBtn){ sendBtn.disabled=false; sendBtn.title=""; }
        // refresh alerts to reflect new thresholds + authoritative auto state
        loadAlerts();
        loadCurrentStatus();
        loadAutoStatus();
    }catch(e){
        if(errEl) errEl.textContent=e.message||"Unable to save";
        showToast(e.message,"error");
    } finally {
        if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent="Save Alert Settings"; }
    }
}
async function resetAlertConfig(){
    if(!confirm("Reset alert thresholds to defaults?\n\npH 5.5/9.0\nTurbidity 10\nTDS 1500\nTemperature 40\nCooldown 5 minutes\nAlerts ON")) return;
    var payload={ph_min:5.5, ph_max:9.0, turbidity_max:10, tds_max:1500, temperature_max:40, cooldown_minutes:5, alerts_enabled:true};
    var errEl=$("alertConfigError");
    try{
        const res=await apiRequest("/alerts/config",{method:"PUT", body:JSON.stringify(payload)});
        showToast("Alert settings reset to defaults","success");
        // populate fields
        $("cfgPhMin").value=res.ph_min;
        $("cfgPhMax").value=res.ph_max;
        $("cfgTurbidityMax").value=res.turbidity_max;
        $("cfgTdsMax").value=res.tds_max;
        $("cfgTempMax").value=res.temperature_max;
        $("cfgCooldown").value=res.cooldown_minutes;
        var toggle=$("alertsEnabledToggle");
        if(toggle) toggle.checked=!!res.alerts_enabled;
        var statusTxt=$("alertsEnabledStatus");
        if(statusTxt){ statusTxt.textContent=res.alerts_enabled?"ON":"OFF"; }
        loadAlertConfig();
        loadAlerts();
    }catch(e){
        if(errEl) errEl.textContent=e.message;
        showToast(e.message,"error");
    }
}
async function loadContacts(){
    try{
        const data=await apiRequest("/alerts/contacts");
        allContactsCache = data || [];
        renderContacts(data);
        const sc=$("summaryContacts");
        if(sc) sc.textContent = (data||[]).filter(function(c){return c.active;}).length;
    }catch(e){ const el=$("contactsList"); if(el) el.innerHTML=`<p style="color:var(--red)">Failed to load contacts</p>`; }
}
function renderContacts(contacts){
    const list=$("contactsList"); const empty=$("contactsEmpty");
    if(!list) return;
    if(!contacts||contacts.length===0){ list.innerHTML=""; if(empty) empty.classList.remove("hidden"); return; }
    const active = contacts.filter(function(c){return c.active;});
    if(active.length===0){ list.innerHTML=""; if(empty) empty.classList.remove("hidden"); return; }
    if(empty) empty.classList.add("hidden");
    list.innerHTML = active.map(function(c){
        return `<div class="alert-card" style="padding:14px"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:700;font-size:14px">`+escapeHtml(c.name)+`</div><div style="font-size:13px;color:var(--text-secondary);margin-top:2px">✉️ `+escapeHtml(c.email||"--")+`</div></div><span style="font-size:11px;padding:3px 8px;border-radius:999px;background:var(--status-normal-bg);color:var(--status-normal);border:1px solid var(--status-normal-border)">Active</span></div><div style="display:flex;gap:8px;margin-top:10px"><button class="secondary-button" onclick="editContact(`+c.id+`)" type="button" style="padding:6px 12px;font-size:12px">Edit</button><button class="secondary-button" onclick="deleteContact(`+c.id+`)" type="button" style="padding:6px 12px;font-size:12px">Deactivate</button></div></div>`;
    }).join("");
}
window.editContact = async function(id){
    try{
        const contacts=await apiRequest("/alerts/contacts");
        const c=contacts.find(function(x){return x.id===id;});
        if(!c) return;
        $("contactId").value=c.id; $("contactName").value=c.name; $("contactEmail").value=c.email||"";
        $("contactModalTitle").textContent="Edit Email Recipient"; $("saveContactBtn").textContent="Save"; $("contactModal").classList.remove("hidden");
        $("contactModal").style.display="flex";
    }catch(e){ showToast(e.message,"error"); }
};
window.deleteContact = async function(id){
    if(!confirm("Deactivate this contact?")) return;
    try{ await apiRequest(`/alerts/contacts/${id}`,{method:"DELETE"}); showToast("Recipient deactivated","success"); loadContacts(); }catch(e){ showToast(e.message,"error"); }
};
function setupAlertsPage(){
    const sendBtn=$("sendCurrentStatusBtn");
    if(sendBtn && !sendBtn.dataset.bound){
        sendBtn.dataset.bound="1";
        sendBtn.addEventListener("click", async function(){
            if(!confirm("Send the current status to all active email recipients?")) return;
            sendBtn.disabled=true; var orig=sendBtn.innerHTML; sendBtn.innerHTML='<i class="ri-loader-4-line"></i> Sending...';
            try{ const r=await apiRequest("/alerts/send-current-status",{method:"POST"}); showToast(`Current status email sent — Email ${r.email_sent}/${r.email_sent+(r.email_failed||0)}`,"success"); loadAlerts(); }catch(e){ showToast(e.message,"error"); } finally{ sendBtn.disabled=false; sendBtn.innerHTML=orig; }
        });
    }
    document.querySelectorAll("[data-alert-filter]").forEach(function(b){
        if(b.dataset.bound) return; b.dataset.bound="1";
        b.addEventListener("click", function(){
            document.querySelectorAll("[data-alert-filter]").forEach(function(x){x.classList.remove("active"); x.setAttribute("aria-selected","false");});
            b.classList.add("active"); b.setAttribute("aria-selected","true");
            alertsFilter=b.dataset.alertFilter;
            loadAlerts();
        });
    });
    const refreshBtn=$("alertsRefreshBtn");
    if(refreshBtn && !refreshBtn.dataset.bound){ refreshBtn.dataset.bound="1"; refreshBtn.addEventListener("click", function(){ loadCurrentStatus(); loadAlerts(); loadContacts(); loadProviderStatus(); loadAlertConfig(); loadAutoStatus(); }); }
    const clearHistBtn=$("clearEmailHistoryBtn");
    if(clearHistBtn && !clearHistBtn.dataset.bound){
        clearHistBtn.dataset.bound="1";
        clearHistBtn.addEventListener("click", async function(){
            if(!confirm("Clear the email history?\n\nThis deletes all past notification records and resets the email cooldown, so the next critical reading will send immediately.")) return;
            clearHistBtn.disabled=true;
            try{
                const r=await apiRequest("/alerts/history",{method:"DELETE"});
                const removed=(r.deleted||0)+(r.reset||0);
                showToast(removed>0?`Email history cleared (${removed} record(s) removed).`:"Email history is already empty.","success");
                loadAlerts();
            }catch(e){ showToast(e.message||"Unable to clear email history","error"); }
            finally{ clearHistBtn.disabled=false; }
        });
    }
    const addBtn=$("addContactBtn");
    const modal=$("contactModal");
    const closeBtn=$("closeContactModal");
    const cancelBtn=$("cancelContactBtn");
    if(addBtn && !addBtn.dataset.bound){ addBtn.dataset.bound="1"; addBtn.addEventListener("click", function(){ $("contactForm").reset(); $("contactId").value=""; $("contactModalTitle").textContent="Add Email Recipient"; $("saveContactBtn").textContent="Add Recipient"; $("contactFormError").textContent=""; modal.classList.remove("hidden"); modal.style.display="flex"; }); }
    function closeModal(){ if(modal){ modal.classList.add("hidden"); modal.style.display="none"; } }
    if(closeBtn && !closeBtn.dataset.bound){ closeBtn.dataset.bound="1"; closeBtn.addEventListener("click", closeModal); }
    if(cancelBtn && !cancelBtn.dataset.bound){ cancelBtn.dataset.bound="1"; cancelBtn.addEventListener("click", closeModal); }
    if(modal && !modal.dataset.bound){ modal.dataset.bound="1"; modal.addEventListener("click", function(e){ if(e.target===modal) closeModal(); }); }
    const form=$("contactForm");
    if(form && !form.dataset.bound){
        form.dataset.bound="1";
        form.addEventListener("submit", async function(e){
            e.preventDefault();
            const errEl=$("contactFormError"); if(errEl) errEl.textContent="";
            const saveBtn=$("saveContactBtn"); if(saveBtn) { saveBtn.disabled=true; saveBtn.textContent="Saving..."; }
            const payload={name:$("contactName").value.trim(), email:$("contactEmail").value.trim(), active:true, email_enabled:true};
            const id=$("contactId").value;
            try{
                if(id) await apiRequest(`/alerts/contacts/${id}`,{method:"PUT", body:JSON.stringify(payload)});
                else await apiRequest("/alerts/contacts",{method:"POST", body:JSON.stringify(payload)});
                closeModal(); showToast(id?"Recipient updated":"Recipient added","success"); await loadContacts();
            }catch(err){ if(errEl) errEl.textContent=err.message; else showToast(err.message,"error"); } finally { if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent= id?"Save":"Add Recipient"; } }
        });
    }
    const testE=$("testEmailBtn");
    if(testE && !testE.dataset.bound){ testE.dataset.bound="1"; testE.addEventListener("click", async function(){ testE.disabled=true; var orig=testE.innerHTML; testE.innerHTML='<i class="ri-loader-4-line"></i> Sending...'; try{ const r=await apiRequest("/alerts/test-email",{method:"POST"}); if(r.results && r.results.some(function(x){return !x.result.success;})){ showToast("Email sent to some recipients, but one or more failed. Check details.","warning"); } else { showToast("Test email sent to "+r.results.length+" recipient(s)","success"); } }catch(e){ showToast(e.message,"error"); } finally{ testE.disabled=false; testE.innerHTML=orig; }}); }
    const toggle=$("alertsEnabledToggle");
    if(toggle && !toggle.dataset.bound){
        toggle.dataset.bound="1";
        toggle.addEventListener("change", function(){
            persistAlertsEnabled(toggle.checked);
        });
    }
    const saveBtn=$("saveAlertConfigBtn");
    if(saveBtn && !saveBtn.dataset.bound){ saveBtn.dataset.bound="1"; saveBtn.addEventListener("click", saveAlertConfig); }
    const resetBtn=$("resetAlertConfigBtn");
    if(resetBtn && !resetBtn.dataset.bound){ resetBtn.dataset.bound="1"; resetBtn.addEventListener("click", resetAlertConfig); }
    // initial load of config when page is set up
    loadAlertConfig();
    const closeHist=$("closeEmailHistoryModal");
    const histModal=$("emailHistoryDetailModal");
    if(closeHist && histModal && !closeHist.dataset.bound){ closeHist.dataset.bound="1"; closeHist.addEventListener("click", function(){ histModal.classList.add("hidden"); histModal.style.display="none"; }); if(!histModal.dataset.bound){ histModal.dataset.bound="1"; histModal.addEventListener("click", function(e){ if(e.target===histModal){ histModal.classList.add("hidden"); histModal.style.display="none"; }}); } }
    const observer = new MutationObserver(function(){
        const sec=$("page-alerts");
        if(sec && sec.classList.contains("active")){ loadCurrentStatus(); loadAlerts(); loadContacts(); loadProviderStatus(); loadAlertConfig(); loadAutoStatus(); }
    });
    const pageAlerts=$("page-alerts");
    if(pageAlerts) observer.observe(pageAlerts, {attributes:true, attributeFilter:["class"]});
    if (!window.autoStatusPollTimer) {
        // Backend is authoritative: resync every 8s so browser drift,
        // tab suspension, or refresh never corrupts the countdown.
        window.autoStatusPollTimer = setInterval(function(){
            const sec = $("page-alerts");
            if (sec && sec.classList.contains("active")) {
                loadAutoStatus();
            }
        }, 8000);
    }

}

async function initializeApp() {
    applyTheme(getPrefs().theme);
    if (window.matchMedia) {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
            if (getPrefs().theme === "system") {
                applyTheme("system");
            }
        });
    }
    setupNavigation();
    setupMobileMenu();
    setupRangeFilters();
    setupRefreshButton();
    setupSettings();
    setupPreferenceControls();
    setupAddDevice();
    setupDeviceDelete();
    setupDeviceRename();
    setupAuth();
    setupReadingForm();
    setupCameraUpload();
    setupLiveCamera();
    setupSensorChat();
    setupClearSensorChat();
    updateChatContextIndicators();
    setupReports();
    setupProfile();
    setupSimulator();
    setupAnalysisTabs();
    setupTrendsPage();
    setupDevicePage();
    setupAlertsPage();


    // No authentication required - load dashboard immediately
    updateUserInterface();
    await refreshDashboard();
    const initialPage =
        window.location.hash.replace("#", "") || "dashboard";
    navigateTo(initialPage);
    setupWindowEvents();

    applyPrefsToRefresh();
}

/*
 * Clear every client-side user artifact on logout/expiry so no private
 * state survives a session boundary.
 */
function clearUserState() {
    latestReading = null;
    latestDevice = null;
    readingsCache = [];
    trendsCache = [];
    trendsLoadedOnce = false;
    devicePageDevices = [];
    devicePageSelectedId = null;
    devicePageReadings = [];
    deviceLoadedOnce = false;
    selectedCameraFile = null;
    latestCameraAnalysis = null;
    chatHistory.length = 0;
    try {
        sessionStorage.removeItem("aqua_ai_chat_history");
    } catch {
        // sessionStorage unavailable — nothing to clear
    }
    renderCameraClearedState();
}

/*
 * Reset the camera UI to its empty state after logout so a previous
 * user's image/result is never left on screen.
 */
function renderCameraClearedState() {
    const input = $("cameraFileInput") || $("cameraInput") || $("imageInput");
    if (input) {
        input.value = "";
    }
    const preview =
        $("cameraPreviewImage") || $("imagePreview") || document.querySelector(".image-preview");
    if (preview) {
        preview.removeAttribute("src");
        preview.classList.add("hidden");
    }
    const previewContainer = $("cameraPreviewContainer");
    if (previewContainer) {
        previewContainer.classList.add("hidden");
    }
    setText("selectedFileName", "No file selected");
    setText("cameraFileName", "No file selected");
    const analyzeButton =
        $("analyzeCameraButton") || $("analyzeButton") || $("cameraAnalyzeButton");
    if (analyzeButton) {
        analyzeButton.disabled = true;
    }
    const emptyState = $("cameraResultEmpty");
    if (emptyState) {
        emptyState.classList.remove("hidden");
    }
    const resultContent = $("cameraResultContent");
    if (resultContent) {
        resultContent.classList.add("hidden");
    }
    const sensorMessages = $("sensorChatMessages");
    if (sensorMessages) {
        renderChatMessages(sensorMessages, chatHistory, "Hello! Sign in to start chatting about your water-quality readings.");
    }
    updateChatContextIndicators();
}

document.addEventListener("DOMContentLoaded", initializeApp);
