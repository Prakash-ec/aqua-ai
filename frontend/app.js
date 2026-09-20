
"use strict";

/*
    Aqua AI Frontend Application
    --------------------------------
    Backend:
    http://127.0.0.1:8001 during local development

    Any deployed (non-local) HTTPS origin automatically targets the
    production backend https://aqua-ai-wz4s.onrender.com.
*/

const DEFAULT_LOCAL_API_URL = "http://127.0.0.1:8001";

/*
 * Production backend matched to known frontend origins so the app works
 * without requiring the user to configure `aqua_api_url` in Settings.
 */
const PRODUCTION_API_URL_BY_ORIGIN = {
    "https://vacproject.netlify.app": "https://aqua-ai-wz4s.onrender.com",
    "https://aqua-ai.netlify.app": "https://aqua-ai-wz4s.onrender.com",
    "https://aqua-ai-frontend.netlify.app": "https://aqua-ai-wz4s.onrender.com",
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
    "http://localhost:8001",
    "http://127.0.0.1:8001",
]);

/*
 * True when the current window origin points at a local development
 * host (localhost, loopback IP, or a localhost port range).
 */
function isLocalOrigin(origin) {
    return LOCAL_ORIGINS.has(origin);
}

let API_BASE_URL =
    localStorage.getItem("aqua_api_url") ||
    DEFAULT_LOCAL_API_URL;

const REFRESH_INTERVAL = 15000;

/*
 * Determine the API base URL, in priority order:
 *   1. User-configured `aqua_api_url` in localStorage (Settings).
 *   2. Production backend matched to the current frontend origin.
 *   3. Robust production fallback for any non-local deployed origin
 *      (e.g. future Netlify or other hosting domains).
 *   4. Default local backend for local development.
 */
function getApiBaseUrl() {
    const stored = localStorage.getItem("aqua_api_url");
    if (stored && stored.trim() !== "") {
        return stored.replace(/\/+$/, "");
    }

    const origin = window.location.origin;

    const productionUrl = PRODUCTION_API_URL_BY_ORIGIN[origin];
    if (productionUrl) {
        return productionUrl;
    }

    if (window.location.protocol === "https:" && !isLocalOrigin(origin)) {
        return PRODUCTION_API_URL;
    }

    return DEFAULT_LOCAL_API_URL;
}

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
let trendParameter = "quality";
let chatHistory = [];
let cameraChatHistory = [];

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

    const date = new Date(value);

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
    const url = `${getApiBaseUrl()}${path}`;

    const response = await fetch(url,
        {
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.body instanceof FormData
                    ? {}
                    : { "Content-Type": "application/json" }),
                ...(options.headers || {})
            }
        }
    );

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
            const dateA = new Date(a.recorded_at || 0).getTime();
            const dateB = new Date(b.recorded_at || 0).getTime();

            return dateB - dateA;
        });
}

async function loadDevices() {
    try {
        const data = await apiRequest("/devices/");

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
    const date = new Date(value);
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
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "--";
    }
    return date.toLocaleTimeString("en-GB", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    });
}

function isDashboardReadingStale(reading) {
    if (!reading || !reading.recorded_at) {
        return { stale: false, ageHours: null };
    }
    const time = new Date(reading.recorded_at).getTime();
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
            `<ul><li>The Aqua AI backend is currently unavailable.</li>` +
            `<li>Check the backend connection and try again.</li></ul>` +
            `<button class="secondary-button dashboard-retry-button" data-dashboard-retry type="button">` +
            `<i class="ri-refresh-line"></i>Retry</button>`
    );
}

async function loadLatestReading() {
    try {
        const data = await apiRequest("/readings/latest");

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

async function loadAllReadings() {
    try {
        const data = await apiRequest("/readings/");

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

async function checkBackend() {
    try {
        const data = await apiRequest("/health");

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

async function refreshDashboard() {
    if (dashboardRefreshing) {
        return;
    }
    dashboardRefreshing = true;
    const refreshButtons = queryAll(
        "#refreshButton, #manualRefresh, #globalRefreshButton, #dashboardRefreshButton, [data-action='refresh']"
    );

    refreshButtons.forEach((button) => {
        button.disabled = true;
        button.classList.add("loading");
    });
    setDashboardLoading(true);

    try {
        const backendOnline = await checkBackend();

        if (!backendOnline) {
            dashboardBackendReachable = false;
            setDashboardLoading(false);
            if (!latestReading) {
                renderDashboardEmpty();
                updateDashboardSensorPill("offline");
            }
            renderDashboardOffline();
            return;
        }

        await loadDevices();
        await loadLatestReading();
        if (!dashboardBackendReachable) {
            setDashboardLoading(false);
            return;
        }
        await loadAllReadings();
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
        setDashboardLoading(false);
        refreshButtons.forEach((button) => {
            button.disabled = false;
            button.classList.remove("loading");
        });
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
            circle.setAttribute("aria-label", `Aqua AI analytical score ${rounded === null ? "unavailable" : rounded + " of 100"}`);
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
    updateSensorDetailPages(reading);
}

function updateSensorDetailPages(reading) {
    setText("temperatureDetailValue", formatTempDisplay(reading.temperature, 1));
    setText("phDetailValue", formatNumber(reading.ph, 2));
    setText("turbidityDetailValue", formatNumber(reading.turbidity, 2));
    setText("tdsDetailValue", formatNumber(reading.tds, 2));

    setText("temperatureCurrent", formatTempDisplay(reading.temperature, 1));
    setText("phCurrent", formatNumber(reading.ph, 2));
    setText("turbidityCurrent", formatNumber(reading.turbidity, 2));
    setText("tdsCurrent", formatNumber(reading.tds, 2));
}

function computeReadingQuality(reading) {
    let temperatureScore = 100;
    let phScore = 100;
    let turbidityScore = 100;
    let tdsScore = 100;

    if (reading.temperature !== null) {
        const temperature = Number(reading.temperature);

        if (temperature < 10 || temperature > 35) {
            temperatureScore = 35;
        } else if (temperature < 15 || temperature > 30) {
            temperatureScore = 70;
        }
    } else {
        temperatureScore = null;
    }

    if (reading.ph !== null) {
        const ph = Number(reading.ph);

        if (ph < 6 || ph > 9) {
            phScore = 25;
        } else if (ph < 6.5 || ph > 8.5) {
            phScore = 70;
        }
    } else {
        phScore = null;
    }

    if (reading.turbidity !== null) {
        const turbidity = Number(reading.turbidity);

        if (turbidity > 10) {
            turbidityScore = 25;
        } else if (turbidity > 5) {
            turbidityScore = 65;
        }
    } else {
        turbidityScore = null;
    }

    if (reading.tds !== null) {
        const tds = Number(reading.tds);

        if (tds > 1000) {
            tdsScore = 25;
        } else if (tds > 500) {
            tdsScore = 65;
        }
    } else {
        tdsScore = null;
    }

    const availableScores = [
        temperatureScore,
        phScore,
        turbidityScore,
        tdsScore
    ].filter((value) => value !== null);

    if (availableScores.length === 0) {
        return {
            score: null,
            status: "unknown",
            title: "No sensor data available",
            description:
                "Connect a device to view the water-quality assessment."
        };
    }

    const score = Math.round(
        availableScores.reduce((sum, value) => sum + value, 0) /
            availableScores.length
    );

    let status = "safe";
    let title = "Good water quality";
    let description =
        "The available sensor readings are within the configured safe ranges.";

    if (score < 50) {
        status = "alert";
        title = "Poor water quality";
        description =
            "One or more sensor readings are outside the configured safe limits.";
    } else if (score < 80) {
        status = "watch";
        title = "Needs attention";
        description =
            "Some readings are approaching or exceeding the recommended ranges.";
    }

    return {
        score,
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

        const timestamp = new Date(reading.recorded_at).getTime();

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
            time: reading.recorded_at ? new Date(reading.recorded_at).getTime() : NaN
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

    const sameDay =
        date.toDateString() === new Date().toDateString();

    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        ...(sameDay ? {} : {}),
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
        reading.recorded_at ? new Date(reading.recorded_at).getTime() : NaN
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

                const x = xForReading(reading);

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

    const chartTop = 45;
    const chartBottom = 215;
    const chartWidth = 700;
    const chartHeight = chartBottom - chartTop;

    const points = filtered
        .map((reading, index) => {
            const value = getTrendSeriesValue(reading, trendParameter);

            if (value === null) {
                return null;
            }

            const x =
                filtered.length === 1
                    ? chartWidth / 2
                    : (index / (filtered.length - 1)) * chartWidth;

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

    const chartTop = 40;
    const chartBottom = 220;
    const chartHeight = chartBottom - chartTop;

    const points = filtered
        .map((reading, index) => {
            const value = getTrendSeriesValue(reading, trendParameter);

            if (value === null) {
                return null;
            }

            const x =
                filtered.length === 1
                    ? 350
                    : (index / (filtered.length - 1)) * 700;

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
        const timestamp = new Date(reading.recorded_at).getTime();
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
    return number.toFixed(digits === undefined ? 2 : digits);
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

function formatTrendTime(value) {
    if (!value) {
        return "--";
    }
    const date = new Date(value);
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
        const time = reading?.recorded_at
            ? new Date(reading.recorded_at).getTime()
            : NaN;
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
        .map((reading) => (reading.recorded_at ? new Date(reading.recorded_at).getTime() : NaN))
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
    const date = new Date(value);
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
    const date = new Date(value);
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
    const time = new Date(latest.recorded_at).getTime();
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
        .map((reading) => (reading?.recorded_at ? new Date(reading.recorded_at).getTime() : NaN))
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
            `<ul><li>The Aqua AI backend could not be reached.</li>` +
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
        "dashboard", "temperature", "ph", "turbidity", "tds",
        "camera", "analysis", "trends", "device",
        "reports", "settings", "profile"
    ]);

    if (!knownPages.has(page)) {
        page = "dashboard";
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

        const isActive = sectionName === page;

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
        temperature: [
            "Temperature Monitoring",
            "Track water temperature readings from your device."
        ],
        ph: [
            "pH Monitoring",
            "Monitor acidity and alkalinity levels."
        ],
        turbidity: [
            "Turbidity Monitoring",
            "Track water clarity and suspended particles."
        ],
        tds: [
            "TDS Monitoring",
            "Monitor total dissolved solids in the water."
        ],
        camera: [
            "Camera Analysis",
            "Upload or capture a water image to screen visible water characteristics."
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
        ]
    };

    if (pageHeadings[page]) {
        setText("pageTitle", pageHeadings[page][0]);
        setText("pageDescription", pageHeadings[page][1]);
    }

    const pageLabels = {
        dashboard: "Dashboard",
        temperature: "Temperature",
        ph: "pH",
        turbidity: "Turbidity",
        tds: "TDS",
        camera: "Camera",
        device: "Device",
        trends: "Trends",
        analysis: "Analysis",
        settings: "Settings",
        reports: "Reports",
        profile: "Profile"
    };

    setText("breadcrumbCurrent", pageLabels[page] || "Dashboard");

    if (window.location.hash !== `#${page}`) {
        history.replaceState(null, "", `#${page}`);
    }

    if (typeof closeMobileSidebar === "function") {
        closeMobileSidebar();
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
    const resultText = $("cameraResultText");
    const statusBadge = $("cameraResultStatus");
    const emptyState = $("cameraResultEmpty");
    const resultContent = $("cameraResultContent");
    const tagsElement = $("cameraResultTags");

    if (analyzeButton) {
        analyzeButton.disabled = true;
        analyzeButton.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 0.8s linear infinite"></i> Analyzing...';
    }
    if (resultContent) resultContent.classList.remove("hidden");
    if (emptyState) emptyState.classList.add("hidden");
    if (tagsElement) tagsElement.innerHTML = "";
    if (resultText) {
        resultText.innerHTML = '<div class="cam-loading"><span class="spinner" style="display:inline-block;width:16px;height:16px;border:2px solid #dcefeb;border-top-color:var(--primary);border-radius:50%;animation:spinnerRotate 0.8s linear infinite"></span> Analyzing visual characteristics — this may take a few seconds...</div>';
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
            analyzeButton.innerHTML = '<i class="ri-sparkling-2-line"></i> Analyze image';
        }
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

function camQualityBadge(quality) {
    const q = String(quality || "Unclear");
    const colors = { Good: "var(--status-normal)", Fair: "var(--status-monitor)", Poor: "var(--status-critical)", Unclear: "var(--status-unknown)" };
    const bg = { Good: "var(--status-normal-bg)", Fair: "var(--status-monitor-bg)", Poor: "var(--status-critical-bg)", Unclear: "var(--status-unknown-bg)" };
    const border = { Good: "var(--status-normal-border)", Fair: "var(--status-monitor-border)", Poor: "var(--status-critical-border)", Unclear: "var(--status-unknown-border)" };
    const c = colors[q] || colors.Unclear;
    return '<span style="display:inline-flex;align-items:center;padding:3px 9px;border-radius:6px;font-size:11px;font-weight:600;letter-spacing:0.4px;color:' + c + ';background:' + (bg[q]||bg.Unclear) + ';border:1px solid ' + (border[q]||border.Unclear) + '">' + escapeHtml(q) + '</span>';
}
function camConfidenceLabel(level, numeric) {
    const lvl = String(level || "").toLowerCase();
    const map = { high: "High", moderate: "Medium", medium: "Medium", low: "Low" };
    const label = map[lvl] || (numeric >=0.7?"High": numeric>=0.4?"Medium":"Low");
    const pct = numeric != null && isFinite(numeric) ? " (" + Math.round(numeric*100) + "%)" : "";
    return escapeHtml(label) + pct;
}
function renderCameraResult(data) {
    if (!data) return;
    const analysis = data?.analysis || data?.result || data?.prediction || data;
    const sensorContext = data?.sensor_context || null;
    const imageQuality = data?.metadata?.image_quality || null;
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
        const isPoorQuality = analysis?.visual_quality === "Poor" || analysis?.image_quality === "Poor" || (imageQuality && imageQuality.visual_quality === "Poor");
        statusBadge.textContent = isPoorQuality ? "Poor image quality" : "Analysis complete";
        statusBadge.classList.remove("analysis-failed");
        statusBadge.classList.add("analysis-complete");
        if (isPoorQuality) { statusBadge.style.background=""; statusBadge.style.color=""; statusBadge.style.borderColor=""; statusBadge.classList.add("result-status-badge"); }
        else { statusBadge.style.background=""; statusBadge.style.color=""; statusBadge.style.borderColor=""; }
    }

    const overall = getCameraAnalysisField(analysis, "overall_visual_assessment", "overall_observation", "observation", "summary") || "Visual assessment completed.";
    const visualQuality = getCameraAnalysisField(analysis, "visual_quality", "image_quality") || (imageQuality?.visual_quality) || "Unclear";
    const observations = Array.isArray(analysis?.observations) ? analysis.observations : [];
    const indicators = Array.isArray(analysis?.potential_visual_indicators) ? analysis.potential_visual_indicators : [];
    const riskLevel = getCameraAnalysisField(analysis, "risk_level", "risk");
    const confidence = getCameraAnalysisField(analysis, "confidence", "score");
    const confidenceLevel = getCameraAnalysisField(analysis, "confidence_level") || "";
    const limitations = getCameraAnalysisField(analysis, "limitations", "limitation") || "This is visual screening only and cannot determine chemical or microbiological water quality.";
    const safetyDisclaimer = getCameraAnalysisField(analysis, "safety_disclaimer") || "This is visual screening only and does not replace laboratory water testing.";
    const waterColor = getCameraAnalysisField(analysis, "water_color");
    const cloudiness = getCameraAnalysisField(analysis, "cloudiness");
    const visibleDebris = getCameraAnalysisField(analysis, "visible_debris");
    const colorAbnormalities = getCameraAnalysisField(analysis, "color_abnormalities");

    if (titleElement) {
        const rq = riskLevel ? " — " + escapeHtml(riskLevel) + " visual risk" : "";
        titleElement.textContent = "Camera analysis" + rq;
    }

    if (textElement) {
        const obsItems = observations.length ? observations.map(o => "<li>" + escapeHtml(String(o)) + "</li>").join("") : "<li>" + escapeHtml(String(overall)) + "</li>";
        const indItems = indicators.length ? indicators.map(i => "<li>" + escapeHtml(String(i)) + "</li>").join("") : "<li style='color:var(--text-muted)'>No distinct visual indicators noted — water appears without obvious foam, algae, oil-like film or major particles.</li>";

        const boolRows = [
            ["Foam", analysis?.foam_detected],
            ["Algae-like material", analysis?.algae_detected],
            ["Visible particles", analysis?.particles_detected],
            ["Possible microplastics*", analysis?.possible_microplastics],
            ["Oil-like film", analysis?.oil_layer_detected],
        ].map(([label, val]) => {
            const icon = val ? '<i class="ri-eye-line" style="color:var(--amber)"></i>' : '<i class="ri-eye-close-line" style="color:var(--text-muted)"></i>';
            const txt = val === true ? "May be visible" : val === false ? "Not observed" : "Not assessed";
            const cls = val ? "color:var(--text-primary);font-weight:600" : "color:var(--text-muted)";
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:12px"><span style="display:flex;align-items:center;gap:6px">' + icon + escapeHtml(label) + '</span><span style="' + cls + '">' + escapeHtml(txt) + '</span></div>';
        }).join("");

        const extraDetails = [];
        if (waterColor && waterColor !== "Not clearly determined." && waterColor !== "Not assessed.") extraDetails.push('<div style="font-size:12px;color:var(--text-secondary);margin-top:4px"><strong>Water color:</strong> ' + escapeHtml(String(waterColor)) + '</div>');
        if (cloudiness && cloudiness !== "not assessed") extraDetails.push('<div style="font-size:12px;color:var(--text-secondary)"><strong>Cloudiness:</strong> ' + escapeHtml(String(cloudiness)) + '</div>');
        if (colorAbnormalities && colorAbnormalities !== "Not assessed." && colorAbnormalities !== "null") extraDetails.push('<div style="font-size:12px;color:var(--text-secondary)"><strong>Color notes:</strong> ' + escapeHtml(String(colorAbnormalities)) + '</div>');
        if (visibleDebris && visibleDebris !== "Not assessed." && visibleDebris !== "null" && visibleDebris !== "None") extraDetails.push('<div style="font-size:12px;color:var(--text-secondary)"><strong>Debris:</strong> ' + escapeHtml(String(visibleDebris)) + '</div>');

        const isPoor = visualQuality === "Poor" || (imageQuality && imageQuality.visual_quality === "Poor");
        const poorBanner = isPoor ? '<div class="cam-poor-banner" style="margin-bottom:12px;padding:10px 12px;border:1px solid var(--status-monitor-border);background:var(--status-monitor-bg);border-radius:8px;color:var(--status-monitor);font-size:12px;line-height:1.6"><i class="ri-error-warning-line"></i> <strong>Image quality is insufficient.</strong> ' + escapeHtml(imageQuality?.reason || analysis?.image_quality_reason || "Please retake a clearer, well-lit image with the water surface filling most of the frame.") + '</div>' : "";

        let sensorHtml = "";
        if (sensorContext && (sensorContext.temperature!=null || sensorContext.ph!=null || sensorContext.turbidity!=null || sensorContext.tds!=null)) {
            const fmt = (v,d) => v!=null ? Number(v).toFixed(d) : "--";
            sensorHtml = '<div style="margin-top:14px;padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-soft)"><div style="font-size:11px;font-weight:600;letter-spacing:0.6px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px"><i class="ri-sensor-line"></i> SENSOR DATA — measured parameters (separate from camera)</div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:12px"><div><span style="color:var(--text-muted)">Temperature:</span> <strong>' + escapeHtml(fmt(sensorContext.temperature,1)) + ' °C</strong></div><div><span style="color:var(--text-muted)">pH:</span> <strong>' + escapeHtml(fmt(sensorContext.ph,2)) + '</strong></div><div><span style="color:var(--text-muted)">Turbidity:</span> <strong>' + escapeHtml(fmt(sensorContext.turbidity,2)) + ' NTU</strong></div><div><span style="color:var(--text-muted)">TDS:</span> <strong>' + escapeHtml(fmt(sensorContext.tds,0)) + ' mg/L</strong></div></div><div style="font-size:11px;color:var(--text-muted);margin-top:6px">Recorded: ' + escapeHtml(sensorContext.recorded_at ? new Date(sensorContext.recorded_at).toLocaleString() : "--") + ' · CAMERA = visual evidence · SENSORS = measured parameters</div></div>';
        } else if (sensorContext === null) {
            sensorHtml = '<div style="margin-top:14px;padding:10px 12px;border:1px dashed var(--border-color);border-radius:8px;background:var(--bg-soft);font-size:11px;color:var(--text-muted)"><i class="ri-information-line"></i> No recent sensor readings available — camera result is visual-only. Sensor readings will appear here when a device has sent data.</div>';
        }

        const savedNote = saved === false ? '<div style="margin-top:8px;font-size:11px;color:var(--amber-dark)"><i class="ri-database-2-line"></i> Analysis was not saved to database but is displayed.</div>' : saved === true ? '<div style="margin-top:8px;font-size:11px;color:var(--text-muted)"><i class="ri-check-line"></i> Saved to database</div>' : "";

        textElement.innerHTML =
            poorBanner +
            '<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:600;letter-spacing:0.5px;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px">Overall visual assessment</div><p style="color:var(--text-primary);font-size:13px;line-height:1.7;background:var(--bg-soft);padding:12px;border-radius:8px;border:1px solid var(--border-subtle)">' + escapeHtml(String(overall)) + '</p></div>' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12px"><span style="color:var(--text-muted);font-weight:600">Visual quality:</span> ' + camQualityBadge(visualQuality) + ' <span style="color:var(--text-muted);margin-left:8px">Confidence:</span> <span style="font-weight:600;color:var(--text-primary)">' + camConfidenceLabel(confidenceLevel, confidence) + '</span></div>' +
            '<div style="margin-bottom:10px"><div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:4px"><i class="ri-eye-line"></i> Observations</div><ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.7;color:var(--text-secondary)">' + obsItems + '</ul></div>' +
            '<div style="margin-bottom:10px"><div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:4px"><i class="ri-flag-line"></i> Potential visual indicators</div><ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.7;color:var(--text-secondary)">' + indItems + '</ul><div style="font-size:11px;color:var(--text-muted);margin-top:4px">* Microplastics cannot be confirmed from an ordinary image — microscopy/lab required.</div></div>' +
            '<div style="margin:10px 0">' + boolRows + '</div>' +
            (extraDetails.length ? '<div style="margin:8px 0;padding:8px;background:var(--bg-soft);border-radius:6px">' + extraDetails.join("") + '</div>' : '') +
            '<div style="margin-top:12px;padding:10px 12px;border:1px solid var(--border-subtle);background:var(--bg-soft);border-radius:8px;font-size:11px;line-height:1.6;color:var(--text-secondary)"><i class="ri-information-line"></i> <strong>Limitations:</strong> ' + escapeHtml(String(limitations)) + '<br><span style="color:var(--text-muted)">' + escapeHtml(String(safetyDisclaimer)) + '</span></div>' +
            sensorHtml + savedNote;
    }

    if (tagsElement) {
        const tags = [];
        if (riskLevel) {
            const riskColors = { Low:"#16a34a", Medium:"#d97706", High:"#dc2626", Unknown:"#64748b" };
            const c = riskColors[riskLevel] || "#64748b";
            tags.push('<span class="result-tag" style="border-color:' + c + '33;color:' + c + ';background:' + c + '11">Visual risk: ' + escapeHtml(String(riskLevel)) + '</span>');
        }
        tagsElement.innerHTML = tags.join(" ");
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
    if (value < idealMin && value >= lowerLimit) return clamp(100 * (value - lowerLimit) / (idealMin - lowerLimit), 0, 100);
    if (value > idealMax && value <= upperLimit) return clamp(100 * (upperLimit - value) / (upperLimit - idealMax), 0, 100);
    return 0;
}

function scoreClarity(turbidity) {
    if (turbidity === null) return null;
    if (turbidity <= 1) return 100;
    if (turbidity <= 5) return clamp(Math.round(100 * (5 - turbidity) / 4), 0, 100);
    return Math.max(0, 50 - ((turbidity - 5) / 10) * 50);
}

function scoreTDS(tds, tdsLimit) {
    if (tds === null) return null;
    if (tds <= tdsLimit * 0.5) return 100;
    if (tds <= tdsLimit) return Math.max(0, 100 * (tdsLimit - tds) / (tdsLimit * 0.5));
    return Math.max(0, 30 * (tdsLimit * 2 - tds) / tdsLimit);
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
    if (ec <= 2 * ecTolerance) return clamp(100 * (2 * ecTolerance - ec) / ecTolerance, 0, 100);
    return clamp(20 - 20 * (ec - 2 * ecTolerance) / ecTolerance, 0, 20);
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
    if (phScore !== null) { parts.push(w.ph * phScore); wParts.push(w.ph); }
    if (tdsScore !== null) { parts.push(w.tds * tdsScore); wParts.push(w.tds); }
    if (turbScore !== null) { parts.push(w.turbidity * turbScore); wParts.push(w.turbidity); }
    if (tempScore !== null) { parts.push(w.temperature * tempScore); wParts.push(w.temperature); }
    var suitability = null;
    if (parts.length > 0) {
        var totalW = wParts.reduce(function(s, v) { return s + v; }, 0);
        if (totalW > 0) suitability = clamp(parts.reduce(function(s, v) { return s + v; }, 0) / totalW, 0, 100);
    }
    var paramScores = { 'pH': phScore, 'TDS': tdsScore, 'Turbidity': turbScore, 'Temperature': tempScore };
    var paramNames = { 'pH': 'pH', 'TDS': 'TDS/salinity', 'Turbidity': 'Turbidity', 'Temperature': 'Temperature' };
    return { name: profile.name, phScore: phScore, tdsScore: tdsScore, turbidityScore: turbScore, temperatureScore: tempScore, suitability: suitability, reason: generateReason(paramScores, paramNames) };
}

function calculateCropScore(reading, crop) {
    var salinityScore = calculateSalinityScore(reading, crop.ecwFullYield);
    var phScore = calculatePHScore(reading, crop.phMin, crop.phMax, crop.phMin - 2.0, crop.phMax + 2.0);
    var tempScore = calculateTemperatureScore(reading, crop.temperatureMin, crop.temperatureMax, crop.temperatureMin - 10, crop.temperatureMax + 10);
    var turbScore = calculateTurbidityScore(reading);
    var cw = ANALYSIS_CONFIG.weights.crop;
    var parts = [], wParts = [];
    if (salinityScore !== null) { parts.push(cw.salinity * salinityScore); wParts.push(cw.salinity); }
    if (phScore !== null) { parts.push(cw.ph * phScore); wParts.push(cw.ph); }
    if (tempScore !== null) { parts.push(cw.temperature * tempScore); wParts.push(cw.temperature); }
    if (turbScore !== null) { parts.push(cw.turbidity * turbScore); wParts.push(cw.turbidity); }
    var suitability = null;
    if (parts.length > 0) {
        var totalW = wParts.reduce(function(s, v) { return s + v; }, 0);
        if (totalW > 0) suitability = clamp(parts.reduce(function(s, v) { return s + v; }, 0) / totalW, 0, 100);
    }
    var paramScores = { 'Salinity': salinityScore, 'pH': phScore, 'Temperature': tempScore, 'Turbidity': turbScore };
    var paramNames = { 'Salinity': 'Salinity/EC', 'pH': 'pH', 'Temperature': 'Temperature', 'Turbidity': 'Turbidity' };
    return { crop: crop.name, salinityScore: salinityScore, phScore: phScore, temperatureScore: tempScore, turbidityScore: turbScore, suitability: suitability, reason: generateReason(paramScores, paramNames) };
}

function calculateDrinkingScreening(reading) {
    var dk = ANALYSIS_CONFIG.drinking;
    var phScore = calculatePHScore(reading, dk.phMin, dk.phMax, dk.phMin - 2.0, dk.phMax + 2.0);
    var tdsScore = calculateTDSScore(reading, dk.tdsReference);
    var turbScore = calculateTurbidityScore(reading);
    var w = dk.weights;
    var parts = [], wParts = [];
    if (phScore !== null) { parts.push(w.ph * phScore); wParts.push(w.ph); }
    if (tdsScore !== null) { parts.push(w.tds * tdsScore); wParts.push(w.tds); }
    if (turbScore !== null) { parts.push(w.turbidity * turbScore); wParts.push(w.turbidity); }
    var score = null;
    if (parts.length > 0) {
        var totalW = wParts.reduce(function(s, v) { return s + v; }, 0);
        if (totalW > 0) score = clamp(parts.reduce(function(s, v) { return s + v; }, 0) / totalW, 0, 100);
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
    return { score: score, params: params, reason: generateReason(paramScores, paramNames) };
}

/* SCORE LABELS */

function scoreLabel(score) {
    if (score === null) return 'Unavailable';
    if (score >= 85) return 'Highly Suitable';
    if (score >= 70) return 'Suitable';
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
    var date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return String(isoString);
    return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function getParameterCondition(key, value) {
    if (value === null) return { text: 'Unavailable', level: 'unknown' };
    switch (key) {
        case 'temperature':
            if (value >= 15 && value <= 30) return { text: 'Good', level: 'good' };
            if (value >= 5 && value <= 35) return { text: 'Normal', level: 'caution' };
            return { text: 'High', level: 'alert' };
        case 'ph':
            if (value >= 6.5 && value <= 8.4) return { text: 'Good', level: 'good' };
            if (value >= 6.0 && value <= 9.0) return { text: 'Normal', level: 'caution' };
            return { text: 'Extreme', level: 'alert' };
        case 'turbidity':
            if (value <= 1) return { text: 'Good', level: 'good' };
            if (value <= 5) return { text: 'Moderate', level: 'caution' };
            return { text: 'High', level: 'alert' };
        case 'tds':
            if (value <= 450) return { text: 'Good', level: 'good' };
            if (value <= 2000) return { text: 'Moderate', level: 'caution' };
            return { text: 'High', level: 'alert' };
        default: return { text: 'Normal', level: 'good' };
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
    html += '<div class="an-summary-label"><strong>' + label + '</strong><span>Aqua AI Analytical Score</span></div>';
    html += '</div>';
    html += '<div class="an-summary-params">';
    items.forEach(function(item) {
        html += '<div class="an-summary-param"><span class="an-summary-param-label">' + item.label + '</span><strong>' + item.value + '</strong><span class="an-summary-param-unit">' + item.unit + '</span></div>';
    });
    html += '</div></div>';
    setAnalysisHtml('analysisSummary', html);
}

/* MAIN UPDATE FUNCTION */

function updateAnalysisPage() {
    if (typeof analysisLoading !== 'undefined' && analysisLoading) {
        setAnalysisNotice('<div class="analysis-notice-content"><i class="ri-loader-4-line"></i><div><strong>Loading...</strong></div></div>', 'unknown');
        setText('analysisReadingTime', 'Loading...');
        return;
    }
    if (typeof analysisLoadError !== 'undefined' && analysisLoadError && !latestReading) {
        setAnalysisNotice('<div class="analysis-notice-content"><i class="ri-error-warning-line"></i><div><strong>Unable to load.</strong><span>Check the backend connection.</span></div></div>', 'alert');
        return;
    }
    if (!latestReading) {
        setText('analysisReadingTime', 'No data available');
        setText('analysisSubtitle', 'Connect a device to view analysis.');
        ['analysisSummary','analysisCurrentParams','analysisDerivedParams','analysisScoreSection','analysisCropSection','analysisIndustrialSection','analysisDomesticSection','analysisGeneralSection','analysisDrinkingSection'].forEach(function(id) { setAnalysisHtml(id, ''); });
        setAnalysisNotice('');
        return;
    }
    var reading = latestReading;
    setAnalysisNotice('');
    setText('analysisReadingTime', reading.recorded_at ? formatTimestamp(reading.recorded_at) : 'No timestamp');
    var derived = calculateDerivedParameters(reading);
    var tempCond = getParameterCondition('temperature', derived.temperature);
    var phCond = getParameterCondition('ph', derived.ph);
    var turbCond = getParameterCondition('turbidity', derived.turbidity);
    var tdsCond = getParameterCondition('tds', derived.tds);
    renderSummary(derived);
    var h = '<div class="an-param-cards">';
    h += renderParamCard('pH', derived.ph !== null ? formatNumber(derived.ph, 2) : '--', '', phCond);
    h += renderParamCard('Turbidity', derived.turbidity !== null ? formatNumber(derived.turbidity, 2) : '--', ' NTU', turbCond);
    h += renderParamCard('TDS', derived.tds !== null ? formatNumber(derived.tds, 0) : '--', ' mg/L', tdsCond);
    h += renderParamCard('Temperature', derived.temperature !== null ? formatTempDisplay(derived.temperature, 1) : '--', '', tempCond);
    h += '</div>';
    setAnalysisHtml('analysisCurrentParams', h);
    var dh = '<div class="an-derived-grid">';
    dh += '<div class="an-derived-item"><span class="an-derived-label">Estimated EC</span><strong class="an-derived-val">' + (derived.estimatedEC !== null ? formatNumber(derived.estimatedEC, 2) + ' dS/m' : '--') + '</strong><span class="an-derived-note">Estimated from TDS</span></div>';
    dh += '<div class="an-derived-item"><span class="an-derived-label">H+ Concentration</span><strong class="an-derived-val">' + formatScientific(derived.hydrogenIonConcentration) + '</strong><span class="an-derived-note">mol/L</span></div>';
    dh += '<div class="an-derived-item"><span class="an-derived-label">Salinity</span><strong class="an-derived-val">' + derived.salinityClass + '</strong><span class="an-derived-note">FAO TDS classification</span></div>';
    dh += '<div class="an-derived-item"><span class="an-derived-label">Clarity</span><strong class="an-derived-val">' + (derived.clarityIndex !== null ? Math.round(derived.clarityIndex) + '%' : '--') + '</strong><span class="an-derived-note">Calculated from turbidity</span></div>';
    dh += '<div class="an-derived-item"><span class="an-derived-label">pH Index</span><strong class="an-derived-val">' + (derived.phIndex !== null ? Math.round(derived.phIndex) + '%' : '--') + '</strong><span class="an-derived-note">Calculated index</span></div>';
    dh += '<div class="an-derived-item"><span class="an-derived-label">Temperature Index</span><strong class="an-derived-val">' + (derived.temperatureIndex !== null ? Math.round(derived.temperatureIndex) + '%' : '--') + '</strong><span class="an-derived-note">Calculated index</span></div>';
    dh += '</div>';
    setAnalysisHtml('analysisDerivedParams', dh);
    var breakdownRows = [
        { label: 'pH', value: derived.phIndex },
        { label: 'Salinity', value: derived.salinityIndex },
        { label: 'Clarity', value: derived.clarityIndex },
        { label: 'Temperature', value: derived.temperatureIndex }
    ].filter(function(row) { return row.value !== null; });
    var sh = '<div class="an-breakdown">';
    breakdownRows.forEach(function(row) { sh += renderScoreBar(row.label, row.value); });
    sh += '</div>';
    sh += '<p class="an-breakdown-note">' + scoreLimitingNote(breakdownRows) + '</p>';
    setAnalysisHtml('analysisScoreSection', sh);
    var cropResults = CROP_PROFILES.map(function(crop) { return calculateCropScore(reading, crop); }).sort(function(a, b) { return (b.suitability || 0) - (a.suitability || 0); });
    var topCrops = cropResults.slice(0, 5);
    var ch = '<div class="an-crop-list">';
    topCrops.forEach(function(r, index) { ch += renderCropRow(r, index + 1); });
    ch += '</div>';
    setAnalysisHtml('analysisCropSection', ch);
    var indResults = INDUSTRIAL_PROFILES.map(function(p) { return calculateApplicationScore(reading, p); }).sort(function(a, b) { return (b.suitability || 0) - (a.suitability || 0); });
    var ih = '<div class="an-app-list">';
    indResults.forEach(function(r) { ih += renderApplicationRow(r); });
    ih += '</div>';
    setAnalysisHtml('analysisIndustrialSection', ih);
    var domResults = DOMESTIC_PROFILES.map(function(p) { return calculateApplicationScore(reading, p); }).sort(function(a, b) { return (b.suitability || 0) - (a.suitability || 0); });
    var domh = '<div class="an-app-list">';
    domResults.forEach(function(r) { domh += renderApplicationRow(r); });
    domh += '</div>';
    setAnalysisHtml('analysisDomesticSection', domh);
    var genResults = GENERAL_PROFILES.map(function(p) { return calculateApplicationScore(reading, p); }).sort(function(a, b) { return (b.suitability || 0) - (a.suitability || 0); });
    var gh = '<div class="an-app-list">';
    genResults.forEach(function(r) { gh += renderApplicationRow(r); });
    gh += '</div>';
    setAnalysisHtml('analysisGeneralSection', gh);
    var drinking = calculateDrinkingScreening(reading);
    setAnalysisHtml('analysisDrinkingSection', renderDrinkingScreening(drinking));
}

/* TAB SWITCHING + RETRY */

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

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function setupSensorChat() {
    const form = $("chatForm") || $("sensorChatForm");
    const input = $("chatInput") || $("sensorChatInput");
    const messages = $("chatMessages") || $("sensorChatMessages");
    const sendButton = $("sendChatButton") || $("chatSendButton");
    if (!form || !input || !messages) return;

    // Update header to spec: Aqua AI Assistant + subtitle
    const card = form.closest(".chatbot-card");
    if (card) {
        const heading = card.querySelector(".chatbot-heading h3");
        const sub = card.querySelector(".chatbot-heading p");
        if (heading) heading.textContent = "Aqua AI Assistant";
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
            return {
                question,
                device_id: latestReading?.device_id || latestDevice?.id || null,
                provider: localStorage.getItem("aqua_ai_provider") || null,
                model: localStorage.getItem("aqua_ai_model") || null
            };
        },
        extractAnswer(response) {
            return response?.answer || response?.response || response?.message || "I could not generate an answer.";
        },
        history: chatHistory,
        storageKey: "aqua_ai_chat_history",
        welcomeMessage: "**Aqua AI Assistant**\n• Hello! Ask me about pH, TDS, turbidity, temperature or water quality.\n• Try: Current water quality, Latest pH, Agriculture suitability.",
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

function setupCameraChat() {
    const form =
        $("cameraChatForm") ||
        $("visionChatForm");

    const input =
        $("cameraChatInput") ||
        $("visionChatInput");

    const messages =
        $("cameraChatMessages") ||
        $("visionChatMessages");

    const sendButton =
        $("sendCameraChatButton") ||
        $("cameraChatSendButton");

    if (!form || !input || !messages) {
        return;
    }

    createChatManager({
        form,
        input,
        messages,
        sendButton,
        endpoint: "/agents/camera/question",
        buildPayload(question) {
            return {
                question,
                analysis: latestCameraAnalysis
            };
        },
        extractAnswer(response) {
            const agentResponse = response?.response || response || {};
            return (
                agentResponse?.answer ||
                agentResponse?.response ||
                response?.answer ||
                response?.message ||
                "I could not generate an answer."
            );
        },
        history: cameraChatHistory,
        storageKey: "aqua_ai_camera_chat_history",
        welcomeMessage:
            "Upload and analyse a water image first, then I can help explain the visible characteristics.",
        emptyGuard() {
            if (!latestCameraAnalysis) {
                return "Please analyze a water image first so I can answer questions about it.";
            }
            return null;
        },
        errorPrefix: "Camera assistant error"
    });
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

    /* Camera chat context */
    const cameraCtx = $("cameraChatContext");
    if (cameraCtx) {
        const dot = cameraCtx.querySelector(".context-dot");
        const label = cameraCtx.querySelector(".context-label");
        if (dot && label) {
            if (latestCameraAnalysis) {
                dot.className = "context-dot online";
                label.textContent = "Using latest analysis";
            } else {
                dot.className = "context-dot offline";
                label.textContent = "No analysis available yet";
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
        if ([15000, 30000, 60000].includes(ms)) {
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
            refreshDashboard();
        }
    }, getRefreshIntervalMs());
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

        const ageMs = Date.now() - new Date(latest.recorded_at).getTime();
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
                overall === null ? "Aqua AI score unavailable" : `Aqua AI score ${overall} of 100`
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
        triggerBrowserDownload(blob, "Aqua_AI_Readings_" + exportDateStamp(new Date()) + ".csv");
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

function buildReportPdfBytes(lines) {
    const safeLines = (Array.isArray(lines) ? lines : []).map((line) => escapePdfText(line));
    const contentParts = ["BT", "/F1 16 Tf", "56 780 Td"];
    safeLines.forEach((line, index) => {
        if (index === 0) {
            contentParts.push("(" + line + ") Tj");
        } else {
            contentParts.push("0 -22 Td (" + line + ") Tj");
        }
    });
    contentParts.push("ET");
    const content = contentParts.join("\n");
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream"
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((body, index) => {
        offsets.push(pdf.length);
        pdf += (index + 1) + " 0 obj\n" + body + "\nendobj\n";
    });
    const xref = pdf.length;
    pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
    for (let i = 1; i <= objects.length; i += 1) {
        pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    }
    pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
    return pdf;
}

function currentReportPdfLines() {
    const reading = latestReading;
    const derived = reading ? calculateDerivedParameters(reading) : null;
    const overall = derived && derived.analyticalWaterScore !== null
        ? Math.round(derived.analyticalWaterScore)
        : null;
    const prefs = getPrefs();
    const deviceText = reading && reading.device_id !== null && reading.device_id !== undefined
        ? String(reading.device_id)
        : "--";
    return [
        "Aqua AI - Water Quality Engineering Report",
        "Generated: " + new Date().toLocaleString(),
        "Source: LIVE DATA / DATABASE READING",
        "Device: " + deviceText,
        "Latest reading: " + (reading ? formatReadingTime(reading.recorded_at) : "--"),
        "Aqua AI score: " + (overall === null ? "Unavailable" : overall + "/100 (" + waterScoreLabel(overall) + ")"),
        "Temperature: " + (reading ? formatTempDisplay(reading.temperature, 1) : "--"),
        "pH: " + (reading && reading.ph !== null && reading.ph !== undefined ? formatNumber(reading.ph, 2) : "--"),
        "Turbidity: " + (reading && reading.turbidity !== null && reading.turbidity !== undefined ? formatNumber(reading.turbidity, 2) + " NTU" : "--"),
        "TDS: " + (reading && reading.tds !== null && reading.tds !== undefined ? formatNumber(reading.tds, 0) + " mg/L" : "--"),
        "Display unit: temperature " + (prefs.tempUnit === "F" ? "Fahrenheit" : "Celsius") + " (database remains Celsius)",
        "Drinking assessment: screening only; not a certification of potability.",
        "Aqua AI - Generated from live sensor/database readings"
    ];
}

async function downloadReportPdf(button) {
    if (pdfExportInFlight) {
        return;
    }
    const originalLabel = button ? button.innerHTML : null;
    pdfExportInFlight = true;
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="ri-loader-4-line"></i> Generating...';
    }
    try {
        if (!latestReading) {
            await renderReportPage();
        }
        if (!latestReading) {
            showToast("No live report data is available yet.", "warning");
            return;
        }
        const pdfText = buildReportPdfBytes(currentReportPdfLines());
        const bytes = new Uint8Array(pdfText.split("").map((ch) => ch.charCodeAt(0) & 0xff));
        const blob = new Blob([bytes], { type: "application/pdf" });
        triggerBrowserDownload(blob, "Aqua_AI_Water_Quality_Report_" + exportDateStamp(new Date()) + ".pdf");
        showToast("Report PDF downloaded.", "success");
    } catch (error) {
        showToast("PDF download failed. Please try again.", "error");
    } finally {
        pdfExportInFlight = false;
        if (button) {
            button.disabled = false;
            if (originalLabel !== null) {
                button.innerHTML = originalLabel;
            }
        }
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
            if ([15000, 30000, 60000].includes(ms)) {
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
                "Reset Aqua AI display preferences in this browser? " +
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
    setupAuth();
    setupReadingForm();
    setupCameraUpload();
    setupSensorChat();
    setupCameraChat();
    setupClearSensorChat();
    updateChatContextIndicators();
    setupReports();
    setupProfile();
    setupSimulator();
    setupAnalysisTabs();
    setupTrendsPage();
    setupDevicePage();


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
    cameraChatHistory.length = 0;
    try {
        sessionStorage.removeItem("aqua_ai_chat_history");
        sessionStorage.removeItem("aqua_ai_camera_chat_history");
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
    const cameraMessages = $("cameraChatMessages");
    if (cameraMessages) {
        renderChatMessages(cameraMessages, cameraChatHistory, "Sign in, analyze an image, and I can explain the result.");
    }
    updateChatContextIndicators();
}

document.addEventListener("DOMContentLoaded", initializeApp);
