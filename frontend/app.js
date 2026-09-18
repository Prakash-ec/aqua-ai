
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

let isAuthenticated = false;
let currentUser = null;

const DEMO_AUTH_KEY = "aqua_admin_logged_in";

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
            credentials: "include", // Always send cookies for authentication
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
        throw new Error(
            extractApiErrorMessage(data, response.status, "Request failed.")
        );
    }

    return data;
}

/* =========================================================
   AUTHENTICATION
   ========================================================= */

async function checkAuth() {
    currentUser = await fetchCurrentUser();
    isAuthenticated = !!currentUser;
    return isAuthenticated;
}

async function fetchCurrentUser() {
    try {
        currentUser = await apiRequest("/auth/me");
        return currentUser;
    } catch {
        currentUser = null;
        return null;
    }
}

async function performLogin(username, password, rememberMe = false) {
    const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ username, password, remember_me: rememberMe }),
        credentials: "include",
    });

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        throw new Error(
            extractApiErrorMessage(data, response.status, "Login failed.")
        );
    }

    isAuthenticated = true;
    currentUser = data;
    return data;
}



let logoutInProgress = false;

async function performLogout() {
    // Prevent duplicate logout requests
    if (logoutInProgress) {
        return;
    }
    logoutInProgress = true;

    try {
        const response = await fetch(`${getApiBaseUrl()}/auth/logout`, {
            method: "POST",
            credentials: "include",
            headers: {
                Accept: "application/json",
            },
        });

        // Accept 200 (success), 401 (already logged out), and treat them the same.
        // Only throw for unexpected server errors (500) but still clear client state.
        if (response.status === 500) {
            console.error("Logout server error:", response.status);
        }
    } catch (error) {
        // Network error or server unreachable — still clear client-side state
        console.error("Logout request failed:", error);
    } finally {
        logoutInProgress = false;
    }

    // Always clear client-side auth state regardless of backend response
    isAuthenticated = false;
    currentUser = null;
    clearUserState();

    // Clear any client-side session UI
    updateUserInterface();

    // Force the protected-route view and require sign-in again.
    navigateTo("dashboard");
    openLoginModal("Signed out. Please sign in to continue.");
}

function openLoginModal(errorMessage) {
    const modal = $("loginModal");
    const errorEl = $("loginError");

    if (!modal) return;

    if (errorMessage) {
        if (errorEl) {
            errorEl.classList.remove("hidden");
            errorEl.innerHTML =
                '<i class="ri-error-warning-line"></i>' +
                escapeHtml(errorMessage);
        }
    } else if (errorEl) {
        errorEl.classList.add("hidden");
        errorEl.innerHTML = "";
    }

    modal.classList.remove("hidden");
    $("loginUsername")?.focus();
}

function closeLoginModal() {
    const modal = $("loginModal");
    const errorEl = $("loginError");

    if (!modal) return;

    modal.classList.add("hidden");
    if (errorEl) {
        errorEl.classList.add("hidden");
        errorEl.innerHTML = "";
    }

    $("loginForm")?.reset();
}

function updateUserInterface() {
    const usernameEl = $("userProfileName");
    const roleEl = $("userProfileRole");
    const avatarEl = $("userAvatar");
    const logoutItem = $("logoutItem");
    const loginItem = $("loginItem");
    const adminNavItem = $("adminNavItem");

    const isAdmin =
        isAuthenticated && currentUser && currentUser.is_admin === true;

    if (adminNavItem) {
        adminNavItem.classList.toggle("hidden", !isAdmin);
    }

    if (isAuthenticated && currentUser) {
        if (usernameEl) {
            usernameEl.textContent = currentUser.full_name || currentUser.username;
        }
        if (roleEl) {
            roleEl.textContent = currentUser.is_admin ? "ADMIN" : "User";
        }
        if (avatarEl) {
            const initials = (currentUser.full_name || currentUser.username)
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => (part && part[0] ? part[0].toUpperCase() : ""))
                .join("")
                .slice(0, 2) || "?";
            avatarEl.textContent = initials;
        }
        if (logoutItem) {
            logoutItem.classList.remove("hidden");
        }
        if (loginItem) {
            loginItem.classList.add("hidden");
        }
    } else {
        if (usernameEl) {
            usernameEl.textContent = "Guest";
        }
        if (roleEl) {
            roleEl.textContent = "Not signed in";
        }
        if (avatarEl) {
            avatarEl.textContent = "GU";
        }
        if (logoutItem) {
            logoutItem.classList.add("hidden");
        }
        if (loginItem) {
            loginItem.classList.remove("hidden");
        }
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
    // Demo login form - accepts any username/password
    const loginForm = $("loginForm");
    const submitButton = $("submitLoginButton");

    let authSubmitInProgress = false;

    function clearAuthError() {
        const errorEl = $("loginError");

        if (errorEl) {
            errorEl.classList.add("hidden");
            errorEl.textContent = "";
        }
    }

    function showAuthError(message) {
        const errorEl = $("loginError");

        if (!errorEl) {
            return;
        }

        errorEl.textContent = "";

        const icon = document.createElement("i");
        icon.className = "ri-error-warning-line";
        errorEl.appendChild(icon);
        errorEl.appendChild(document.createTextNode(String(message ?? "")));
        errorEl.classList.remove("hidden");
    }

    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            if (!submitButton || authSubmitInProgress) {
                return;
            }

            clearAuthError();

            const username = $("loginUsername")?.value.trim() || "";
            const password = $("loginPassword")?.value || "";

            if (!username || !password) {
                showAuthError("Please enter both username and password.");
                return;
            }

            authSubmitInProgress = true;
            submitButton.disabled = true;

            try {
                performDemoLogin(username, password);
            } catch (error) {
                console.error("Login error:", error);
                showAuthError(error.message || "Login failed.");
            } finally {
                authSubmitInProgress = false;
                submitButton.disabled = false;
            }
        });
    }

    // Close login modal buttons
    $("closeLoginModal")?.addEventListener("click", closeLoginModal);
    $("cancelLoginButton")?.addEventListener("click", closeLoginModal);

    // Login button
    const loginBtn = $("loginItem");
    if (loginBtn) {
        loginBtn.addEventListener("click", () => {
            openLoginModal();
        });
    }

    // Logout button
    const logoutBtn = $("logoutItem");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            performDemoLogout();
        });
    }
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
            updateDashboard(latestReading);
        }

        return latestReading;
    } catch (error) {
        console.warn("Unable to load latest reading:", error.message);
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

        return readingsCache;
    } catch (error) {
        console.warn("Unable to load readings:", error.message);
        return [];
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

        return true;
    } catch {
        setConnectionStatus(false, "Offline");
        return false;
    }
}

async function refreshDashboard() {
    const refreshButtons = queryAll(
        "#refreshButton, #manualRefresh, #globalRefreshButton, #dashboardRefreshButton, [data-action='refresh']"
    );

    refreshButtons.forEach((button) => {
        button.disabled = true;
        button.classList.add("loading");
    });

    try {
        const backendOnline = await checkBackend();

        if (!backendOnline) {
            updateQualityUI(
                null,
                "Offline",
                "unknown",
                "Could not reach the monitoring server. Check your connection in Settings, then try again."
            );

            setText(
                "lastRefreshTime",
                "Retry failed - server unreachable",
                "--"
            );

            return;
        }

        await loadDevices();
        await loadLatestReading();
        await loadAllReadings();
        updateLastRefreshTime();
        updateChatContextIndicators();
        setupReports();
        setupProfile();
    } finally {
        refreshButtons.forEach((button) => {
            button.disabled = false;
            button.classList.remove("loading");
        });
    }
}

function updateLastRefreshTime() {
    const now = new Date();

    setText(
        "lastRefreshTime",
        now.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }),
        "--"
    );
}

function updateDashboard(reading) {
    if (!reading) {
        return;
    }

    setText(
        "temperatureValue",
        reading.temperature === null
            ? "--"
            : formatNumber(reading.temperature, 1)
    );

    setText(
        "phValue",
        reading.ph === null ? "--" : formatNumber(reading.ph, 2)
    );

    setText(
        "turbidityValue",
        reading.turbidity === null
            ? "--"
            : formatNumber(reading.turbidity, 2)
    );

    setText(
        "tdsValue",
        reading.tds === null ? "--" : formatNumber(reading.tds, 2)
    );

    setText(
        "latestReadingTime",
        formatDate(reading.recorded_at),
        "--"
    );

    setText(
        "readingTimestamp",
        formatDate(reading.recorded_at),
        "--"
    );

    calculateQualityScore(reading);
    updateSensorDetailPages(reading);
}

function updateSensorDetailPages(reading) {
    setText("temperatureDetailValue", formatNumber(reading.temperature, 1));
    setText("phDetailValue", formatNumber(reading.ph, 2));
    setText("turbidityDetailValue", formatNumber(reading.turbidity, 2));
    setText("tdsDetailValue", formatNumber(reading.tds, 2));

    setText("temperatureCurrent", formatNumber(reading.temperature, 1));
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
    context.fillStyle = "#718096";
    context.strokeStyle = "#e5eaf1";
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
        context.fillStyle = "#718096";
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

        context.fillStyle = "#718096";
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
            <g stroke="#e5eaf1" stroke-width="1">
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
                fill="#718096"
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

function navigateTo(pageName) {
    const page = normalizePageName(pageName);

    if (!page) {
        return;
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
        ],
        admin: [
            "Admin Dashboard",
            "Manage registered users and monitor platform activity."
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
        profile: "Profile",
        admin: "Admin"
    };

    setText("breadcrumbCurrent", pageLabels[page] || "Dashboard");

    // Admin page is available for demo admin user
    if (page === "admin") {
        loadAdminData();
    }

    if (window.location.hash !== `#${page}`) {
        history.replaceState(null, "", `#${page}`);
    }

    if (typeof closeMobileSidebar === "function") {
        closeMobileSidebar();
    }

    if (page === "trends") {
        if (typeof updateTrendChartHeading === "function") {
            updateTrendChartHeading();
        }

        if (typeof drawTrendChart === "function") {
            drawTrendChart(readingsCache);
        }

        if (typeof renderReadingsTable === "function") {
            renderReadingsTable(readingsCache);
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

    const adminRefresh = $("adminRefreshButton");

    if (adminRefresh) {
        adminRefresh.addEventListener("click", async () => {
            adminRefresh.disabled = true;
            adminRefresh.classList.add("loading");

            try {
                await loadAdminData();
            } finally {
                adminRefresh.disabled = false;
                adminRefresh.classList.remove("loading");
            }
        });
    }
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

function renderWaterUsage(analysis) {
    if (!analysis || typeof analysis !== "object") {
        return;
    }

    const agriculturePanel = $("waterUsageAgriculture");
    const industryPanel = $("waterUsageIndustry");
    const generalPanel = $("waterUsageGeneral");
    const waterUsageCard = $("waterUsageCard");

    if (!agriculturePanel || !industryPanel || !generalPanel || !waterUsageCard) {
        return;
    }

    const riskLevel = getCameraAnalysisField(analysis, "risk_level", "risk");
    const waterColor = getCameraAnalysisField(analysis, "water_color", "color");
    const foamDetected = getCameraAnalysisField(analysis, "foam_detected", "foam");
    const algaeDetected = getCameraAnalysisField(analysis, "algae_detected", "algae");
    const particlesDetected = getCameraAnalysisField(analysis, "particles_detected", "particles");
    const microplasticsDetected = getCameraAnalysisField(analysis, "possible_microplastics", "microplastics");
    const oilLayerDetected = getCameraAnalysisField(analysis, "oil_layer_detected", "oil_layer");
    const confidence = getCameraAnalysisField(analysis, "confidence");
    const recommendation = getCameraAnalysisField(analysis, "recommendation");
    const limitations = getCameraAnalysisField(analysis, "limitations");

    const isHighRisk = riskLevel === "High";
    const isMediumRisk = riskLevel === "Medium";
    const isLowRisk = riskLevel === "Low";

    const warnings = [];
    if (oilLayerDetected) warnings.push({ type: "critical", message: "Oil layer detected. Not recommended for irrigation or sensitive uses without treatment." });
    if (microplasticsDetected) warnings.push({ type: "critical", message: "Possible microplastics detected. Avoid direct agricultural or domestic use without treatment/testing." });
    if (algaeDetected) warnings.push({ type: "caution", message: "Algae-like growth detected. May affect irrigation systems and water quality." });
    if (foamDetected) warnings.push({ type: "caution", message: "Foam detected. Possible contamination or organic matter presence." });

    function makeWarningHTML(items) {
        if (!items.length) return "";
        return items.map(w => `<div class="water-usage-warning ${w.type}"><i class="ri-${w.type === "critical" ? "error-warning-line" : "alert-line"}"></i>${escapeHtml(w.message)}</div>`).join("");
    }

    function renderAgriculture() {
        let html = "";

        if (warnings.length) {
            html += `<div class="water-usage-warnings">${makeWarningHTML(warnings)}</div>`;
        }

        html += `
            <div class="water-usage-section">
                <h5>Irrigation Suitability</h5>
                <p class="water-usage-assessment">${getIrrigationAssessment(riskLevel, oilLayerDetected, microplasticsDetected, algaeDetected)}</p>
            </div>
        `;

        html += `
            <div class="water-usage-section">
                <h5>Crop Categories</h5>
                <div class="water-usage-crops">
                    ${renderCropCategories(riskLevel, oilLayerDetected, microplasticsDetected)}
                </div>
            </div>
        `;

        html += `
            <div class="water-usage-section">
                <h5>Considerations</h5>
                <ul class="water-usage-considerations">
                    ${renderAgricultureConsiderations(riskLevel, oilLayerDetected, microplasticsDetected, algaeDetected, foamDetected)}
                </ul>
            </div>
        `;

        return html;
    }

    function getIrrigationAssessment(riskLevel, oilDetected, microplasticsDetected, algaeDetected) {
        if (oilDetected || microplasticsDetected) {
            return "Not recommended for direct irrigation based on the visual assessment. Further testing and treatment required.";
        }
        if (isHighRisk) {
            return "Not recommended for direct irrigation based on the visual assessment. Further testing is required.";
        }
        if (isMediumRisk) {
            return "Use caution. Additional water-quality testing is recommended before irrigation.";
        }
        return "Potentially suitable for preliminary irrigation consideration. Additional testing recommended.";
    }

    function renderCropCategories(riskLevel, oilDetected, microplasticsDetected) {
        const crops = [
            { name: "Rice", category: "Cereals" },
            { name: "Wheat", category: "Cereals" },
            { name: "Maize", category: "Cereals" },
            { name: "Cotton", category: "Fiber" },
            { name: "Vegetables", category: "Horticulture" },
            { name: "Fruits", category: "Horticulture" },
            { name: "Pulses", category: "Legumes" },
            { name: "Oilseeds", category: "Oil Crops" }
        ];

        const restricted = oilDetected || microplasticsDetected || isHighRisk;

        return crops.map(crop => `
            <span class="water-usage-crop ${restricted ? "restricted" : ""}">
                ${escapeHtml(crop.name)}
                ${restricted ? '<span class="crop-restriction">Testing required</span>' : '<span class="crop-ok">Potentially suitable</span>'}
            </span>
        `).join("");
    }

    function renderAgricultureConsiderations(riskLevel, oilDetected, microplasticsDetected, algaeDetected, foamDetected) {
        const items = [];
        items.push("Camera analysis cannot measure dissolved salts, heavy metals, or pathogens.");
        items.push("Chemical and microbiological testing required before agricultural use.");
        if (oilDetected) items.push("Oil layer detected — may clog irrigation systems and contaminate soil.");
        if (microplasticsDetected) items.push("Possible microplastics — long-term soil accumulation risk unknown.");
        if (algaeDetected) items.push("Algae may clog drip irrigation and affect water quality.");
        if (foamDetected) items.push("Foam indicates possible organic contamination or surfactants.");
        if (isHighRisk) items.push("High visual risk — not suitable for direct irrigation without treatment.");
        if (isMediumRisk) items.push("Medium visual risk — testing strongly recommended before use.");
        return items.map(item => `<li>${escapeHtml(item)}</li>`).join("");
    }

    function renderIndustry() {
        let html = "";

        if (warnings.length) {
            html += `<div class="water-usage-warnings">${makeWarningHTML(warnings)}</div>`;
        }

        html += `
            <div class="water-usage-section">
                <h5>Industrial Applications</h5>
                <div class="water-usage-industry-grid">
                    ${renderIndustryApplications(riskLevel, oilLayerDetected, microplasticsDetected, algaeDetected)}
                </div>
            </div>
        `;

        html += `
            <div class="water-usage-section">
                <h5>Sensitive Applications — Testing Required</h5>
                <ul class="water-usage-considerations">
                    <li>Boilers & cooling towers — require chemical testing for scaling/corrosion potential.</li>
                    <li>High-purity manufacturing — dissolved solids and microbiological testing mandatory.</li>
                    <li>Electronics manufacturing — ultra-pure water standards; visual assessment insufficient.</li>
                    <li>Food/pharmaceutical processing — full microbiological and chemical validation required.</li>
                </ul>
            </div>
        `;

        return html;
    }

    function renderIndustryApplications(riskLevel, oilDetected, microplasticsDetected, algaeDetected) {
        const apps = [
            {
                name: "Cooling / Process Water",
                suitability: oilDetected || microplasticsDetected ? "Not recommended" : (isHighRisk ? "Limited" : (isMediumRisk ? "Conditional" : "Potentially suitable")),
                reason: oilDetected ? "Oil layer causes fouling and corrosion" : microplasticsDetected ? "Particles cause system fouling" : isHighRisk ? "High visual contamination risk" : isMediumRisk ? "Moderate contamination — pre-treatment needed" : "Low visual contamination",
                testing: "Water chemistry, scaling/corrosion indices, microbiological testing"
            },
            {
                name: "Cleaning / Washing",
                suitability: oilDetected ? "Not recommended" : (isHighRisk ? "Limited" : "Potentially suitable"),
                reason: oilDetected ? "Oil residue on cleaned surfaces" : isHighRisk ? "Visible contamination may affect cleaning quality" : "Low visual contamination",
                testing: "Microbiological testing if food-contact surfaces"
            },
            {
                name: "Construction (Concrete, Dust Suppression)",
                suitability: oilDetected ? "Avoid" : (isHighRisk ? "Conditional" : "Potentially suitable"),
                reason: oilDetected ? "Oil affects concrete curing" : isHighRisk ? "Visible contamination may affect material quality" : "Acceptable for non-critical use",
                testing: "pH, suspended solids, oil/grease testing"
            },
            {
                name: "Non-Critical Manufacturing",
                suitability: oilDetected || microplasticsDetected ? "Not recommended" : (isHighRisk ? "Limited" : "Potentially suitable"),
                reason: oilDetected ? "Oil contamination in products" : microplasticsDetected ? "Particle inclusion risk" : isHighRisk ? "Visible quality concerns" : "Low visual risk",
                testing: "Depends on process sensitivity"
            }
        ];

        return apps.map(app => `
            <div class="water-usage-industry-card">
                <div class="industry-card-header">
                    <h6>${escapeHtml(app.name)}</h6>
                    <span class="industry-suitability ${getSuitabilityClass(app.suitability)}">${escapeHtml(app.suitability)}</span>
                </div>
                <div class="industry-card-body">
                    <p><strong>Reason:</strong> ${escapeHtml(app.reason)}</p>
                    <p><strong>Testing required:</strong> ${escapeHtml(app.testing)}</p>
                </div>
            </div>
        `).join("");
    }

    function getSuitabilityClass(suitability) {
        const s = suitability.toLowerCase();
        if (s.includes("not recommended") || s.includes("avoid")) return "suitability-poor";
        if (s.includes("limited") || s.includes("conditional")) return "suitability-fair";
        if (s.includes("potentially suitable")) return "suitability-good";
        return "suitability-fair";
    }

    function renderGeneral() {
        let html = "";

        if (warnings.length) {
            html += `<div class="water-usage-warnings">${makeWarningHTML(warnings)}</div>`;
        }

        html += `
            <div class="water-usage-section">
                <h5>Potential Non-Potable Uses</h5>
                <div class="water-usage-general-grid">
                    ${renderGeneralUses(riskLevel, oilLayerDetected, microplasticsDetected, algaeDetected, foamDetected)}
                </div>
            </div>
        `;

        html += `
            <div class="water-usage-section water-usage-drinking-warning">
                <h5><i class="ri-water-flash-line"></i> Drinking & Cooking</h5>
                <p class="drinking-warning">
                    <strong>Camera analysis alone cannot determine drinking-water safety.</strong>
                    Microbiological and chemical testing is required.
                    Visual assessment cannot detect pathogens, dissolved chemicals, heavy metals, or other contaminants.
                </p>
            </div>
        `;

        return html;
    }

    function renderGeneralUses(riskLevel, oilDetected, microplasticsDetected, algaeDetected, foamDetected) {
        const uses = [
            {
                name: "Gardening / Irrigation",
                suitability: oilDetected || microplasticsDetected ? "Not recommended" : (isHighRisk ? "Limited" : (isMediumRisk ? "Conditional" : "Potentially suitable")),
                reason: getGeneralReason("Gardening", oilDetected, microplasticsDetected, algaeDetected, foamDetected, isHighRisk, isMediumRisk)
            },
            {
                name: "Landscaping / Ornamental",
                suitability: oilDetected ? "Not recommended" : (isHighRisk ? "Limited" : "Potentially suitable"),
                reason: oilDetected ? "Oil damages plants and soil" : isHighRisk ? "Visible contamination risk" : "Low visual risk for ornamental use"
            },
            {
                name: "Toilet Flushing",
                suitability: "Potentially suitable",
                reason: "Non-contact use; visual quality less critical"
            },
            {
                name: "Outdoor Cleaning (Paths, Equipment)",
                suitability: oilDetected ? "Avoid" : (isHighRisk ? "Limited" : "Potentially suitable"),
                reason: oilDetected ? "Oil residue on surfaces" : isHighRisk ? "Visible contamination" : "Acceptable for non-contact cleaning"
            },
            {
                name: "Vehicle / Equipment Washing",
                suitability: oilDetected ? "Not recommended" : (isHighRisk ? "Conditional" : "Potentially suitable"),
                reason: oilDetected ? "Oil streaks on paint" : isHighRisk ? "May leave residue" : "Acceptable for general washing"
            }
        ];

        return uses.map(use => `
            <div class="water-usage-general-card ${getSuitabilityClass(use.suitability).replace("suitability-", "")}">
                <div class="general-card-header">
                    <h6>${escapeHtml(use.name)}</h6>
                    <span class="general-suitability ${getSuitabilityClass(use.suitability)}">${escapeHtml(use.suitability)}</span>
                </div>
                <p class="general-reason">${escapeHtml(use.reason)}</p>
            </div>
        `).join("");
    }

    function getGeneralReason(category, oilDetected, microplasticsDetected, algaeDetected, foamDetected, isHigh, isMedium) {
        if (oilDetected) return "Oil contamination affects all uses";
        if (microplasticsDetected) return "Microplastic accumulation risk";
        if (isHigh) return "High visual contamination — testing required";
        if (isMedium) return "Moderate visual risk — testing recommended";
        return "Low visual contamination — suitable for non-potable use";
    }

    agriculturePanel.innerHTML = renderAgriculture();
    industryPanel.innerHTML = renderIndustry();
    generalPanel.innerHTML = renderGeneral();

    waterUsageCard.hidden = false;
}

function switchWaterUsageTab(tabName) {
    const tabs = document.querySelectorAll(".water-usage-tab");
    const panels = document.querySelectorAll(".water-usage-panel");

    tabs.forEach(tab => {
        const isActive = tab.dataset.usageTab === tabName;
        tab.classList.toggle("active", isActive);
        tab.setAttribute("aria-selected", isActive);
    });

    panels.forEach(panel => {
        panel.classList.toggle("active", panel.id === `panel${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
    });
}

// Add tab click handlers
document.addEventListener("click", (e) => {
    const tab = e.target.closest(".water-usage-tab");
    if (tab) {
        switchWaterUsageTab(tab.dataset.usageTab);
    }
});
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

    // Pre-upload validation: file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(selectedCameraFile.type)) {
        alert(
            "Unsupported file type. Please select a JPEG, PNG, or WebP image."
        );
        return;
    }

    // Pre-upload validation: size limit (10 MB)
    const maxSize = 10 * 1024 * 1024;

    if (selectedCameraFile.size > maxSize) {
        alert(
            "Image is too large. Please select an image smaller than 10 MB."
        );
        return;
    }

    // Pre-upload validation: empty file
    if (selectedCameraFile.size === 0) {
        alert("The selected file appears to be empty. Please choose another.");
        return;
    }

    const analyzeButton =
        $("analyzeCameraButton") ||
        $("analyzeButton") ||
        $("cameraAnalyzeButton");

    const resultText = $("cameraResultText");
    const statusBadge = $("cameraResultStatus");
    const emptyState = $("cameraResultEmpty");
    const resultContent = $("cameraResultContent");

    if (analyzeButton) {
        analyzeButton.disabled = true;
        analyzeButton.textContent = "Analyzing...";
    }

    if (resultContent) {
        resultContent.classList.remove("hidden");
    }

    if (resultText) {
        resultText.innerHTML = `
            <div class="loading">
                <span class="spinner"></span>
                Analyzing the image...
            </div>
        `;
    }

    if (emptyState) {
        emptyState.classList.add("hidden");
    }

    if (statusBadge) {
        statusBadge.textContent = "Analyzing...";
        statusBadge.classList.remove("analysis-complete", "analysis-failed");
    }

    try {
        const formData = new FormData();

        formData.append("image", selectedCameraFile);

        if (latestDevice?.id) {
            formData.append("device_id", String(latestDevice.id));
        }

        const provider =
            localStorage.getItem("aqua_ai_provider") ||
            "auto";

        const model =
            localStorage.getItem("aqua_ai_model") || "";

        if (provider && provider !== "auto") {
            formData.append("provider", provider);
        }

        if (model) {
            formData.append("model", model);
        }

        const data = await apiRequest("/camera/analyze", {
            method: "POST",
            body: formData
        });

        latestCameraAnalysis =
            data?.analysis ||
            data?.result ||
            data?.prediction ||
            data;

        renderCameraResult(data);
        updateChatContextIndicators();
    } catch (error) {
        if (resultText) {
            resultText.innerHTML = `
                <div class="alert-box error-box">
                    <strong>Analysis failed:</strong>
                    ${escapeHtml(error.message)}
                </div>
            `;
        }

        if (statusBadge) {
            statusBadge.textContent = "Analysis failed";
            statusBadge.classList.remove("analysis-complete");
            statusBadge.classList.add("analysis-failed");
        }
    } finally {
        if (analyzeButton) {
            analyzeButton.disabled = false;
            analyzeButton.textContent = "Analyze Image";
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

function renderCameraResult(data) {
    if (!data) {
        return;
    }

    const analysis =
        data?.analysis ||
        data?.result ||
        data?.prediction ||
        data;

    const agentAnswer =
        data?.agent_answer ||
        data?.answer ||
        data?.message ||
        "";

    if (analysis && typeof analysis === "object") {
        latestCameraAnalysis = analysis;
    }

    const emptyState = $("cameraResultEmpty");
    const resultContent = $("cameraResultContent");
    const statusBadge = $("cameraResultStatus");
    const titleElement = $("cameraResultTitle");
    const textElement = $("cameraResultText");
    const tagsElement = $("cameraResultTags");

    if (emptyState) {
        emptyState.classList.add("hidden");
    }

    if (resultContent) {
        resultContent.classList.remove("hidden");
    }

    if (statusBadge) {
        statusBadge.textContent = "Analysis complete";
        statusBadge.classList.remove("analysis-failed");
        statusBadge.classList.add("analysis-complete");
    }

    const observation =
        getCameraAnalysisField(
            analysis,
            "overall_observation",
            "observation",
            "summary"
        );

    const riskLevel =
        getCameraAnalysisField(
            analysis,
            "risk_level",
            "risk"
        );

    const confidence =
        getCameraAnalysisField(
            analysis,
            "confidence",
            "score"
        );

    const cloudiness =
        getCameraAnalysisField(
            analysis,
            "cloudiness",
            "turbidity"
        );

    const colorAbnormalities =
        getCameraAnalysisField(
            analysis,
            "color_abnormalities"
        );

    const visibleDebris =
        getCameraAnalysisField(
            analysis,
            "visible_debris"
        );

    const safetyDisclaimer =
        getCameraAnalysisField(
            analysis,
            "safety_disclaimer"
        );

    const limitations =
        getCameraAnalysisField(
            analysis,
            "limitations",
            "limitation"
        );

    if (titleElement) {
        titleElement.textContent =
            riskLevel !== undefined
                ? `Analysis: ${riskLevel} risk`
                : "Analysis completed";
    }

    if (textElement) {
        const parts = [];

        if (observation) {
            parts.push(observation);
        }

        if (cloudiness && cloudiness !== "not assessed") {
            parts.push(`Cloudiness: ${cloudiness}`);
        }

        if (colorAbnormalities && colorAbnormalities !== "null" && colorAbnormalities !== "None") {
            parts.push(`Colour observations: ${colorAbnormalities}`);
        }

        if (visibleDebris && visibleDebris !== "null" && visibleDebris !== "None") {
            parts.push(`Visible debris: ${visibleDebris}`);
        }

        if (limitations) {
            parts.push(limitations);
        }

        if (safetyDisclaimer && safetyDisclaimer !== "null" && safetyDisclaimer !== "None") {
            parts.push(safetyDisclaimer);
        }

        textElement.textContent =
            parts.join("\n") ||
            String(observation || agentAnswer || "").trim() ||
            JSON.stringify(analysis, null, 2) ||
            "No result was returned.";
    }

    if (tagsElement) {
        const tags = [];

        if (confidence !== undefined) {
            tags.push(
                `<span class="result-tag">Confidence: ${formatNumber(confidence, 2)}</span>`
            );
        }

        if (riskLevel) {
            tags.push(
                `<span class="result-tag risk-${escapeHtml(String(riskLevel).toLowerCase())}">Risk: ${escapeHtml(riskLevel)}</span>`
            );
        }

        [
            ["foam", "foam_detected"],
            ["algae", "algae_detected"],
            ["particles", "particles_detected"],
            ["oil", "oil_layer_detected"]
        ].forEach(([key, detectedKey]) => {
            const value = getCameraAnalysisField(
                analysis,
                detectedKey,
                key
            );

            if (typeof value === "boolean") {
                tags.push(
                    `<span class="result-tag">${prettifyKey(key)}: ${value ? "Detected" : "Not detected"}</span>`
                );
            }
        });

        tagsElement.innerHTML = tags.join(" ");
    }

    const legacyContainer =
        $("cameraResult") ||
        $("analysisResult") ||
        query(".analysis-result");

    if (legacyContainer) {
        legacyContainer.innerHTML = `
            <div class="analysis-item">
                <label>Analysis</label>
                <p>${escapeHtml(
                    String(observation || agentAnswer || "No result was returned.")
                )}</p>
            </div>
        `;
    }

    // Render Water Usage section based on analysis
    if (analysis && typeof analysis === "object") {
        renderWaterUsage(analysis);
    }
}

function prettifyKey(key) {
    return String(key)
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    const form =
        $("chatForm") ||
        $("sensorChatForm");

    const input =
        $("chatInput") ||
        $("sensorChatInput");

    const messages =
        $("chatMessages") ||
        $("sensorChatMessages");

    const sendButton =
        $("sendChatButton") ||
        $("chatSendButton");

    if (!form || !input || !messages) {
        return;
    }

    createChatManager({
        form,
        input,
        messages,
        sendButton,
        endpoint: "/chat/water",
        buildPayload(question) {
            return {
                question,
                device_id:
                    latestReading?.device_id ||
                    latestDevice?.id ||
                    null,
                provider:
                    localStorage.getItem("aqua_ai_provider") ||
                    null,
                model:
                    localStorage.getItem("aqua_ai_model") || null
            };
        },
        extractAnswer(response) {
            return (
                response?.answer ||
                response?.response ||
                response?.message ||
                "I could not generate an answer."
            );
        },
        history: chatHistory,
        storageKey: "aqua_ai_chat_history",
        welcomeMessage:
            "Hello! Ask me about the latest sensor readings, pH, temperature, turbidity, or TDS.",
        emptyGuard: null,
        errorPrefix: "Unable to contact the water-quality assistant"
    });
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

        const loadingElement = addChatMessage(
            messages,
            history,
            "assistant",
            "Thinking...",
            storageKey
        );

        try {
            const response = await apiRequest(endpoint, {
                method: "POST",
                body: JSON.stringify(buildPayload(question))
            });

            removeChatMessage(loadingElement);

            const answer = extractAnswer(response);
            addChatMessage(messages, history, "assistant", answer, storageKey);
        } catch (error) {
            removeChatMessage(loadingElement);
            addChatMessage(
                messages,
                history,
                "assistant",
                `${errorPrefix}: ${error.message}`,
                storageKey
            );
        } finally {
            isLoading = false;
            if (sendButton) sendButton.disabled = false;
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

function renderChatMessages(container, history, welcomeMessage) {
    container.innerHTML = "";

    if (history.length === 0) {
        const welcome = document.createElement("div");
        const content = document.createElement("div");

        welcome.className = "chat-message assistant";
        content.className = "chat-message-content";
        content.textContent =
            welcomeMessage ||
            "Hello! Ask me about the latest sensor readings, pH, temperature, turbidity, or TDS.";

        welcome.appendChild(content);
        container.appendChild(welcome);
        return;
    }

    history.forEach((message) => {
        const element = document.createElement("div");
        const content = document.createElement("div");

        element.className = `chat-message ${message.role}`;
        content.className = "chat-message-content";
        content.textContent = message.content;

        element.appendChild(content);
        container.appendChild(element);
    });

    container.scrollTop = container.scrollHeight;
}

function addChatMessage(container, history, role, content, storageKey) {
    const element = document.createElement("div");
    const contentDiv = document.createElement("div");

    element.className = `chat-message ${role}`;
    contentDiv.className = "chat-message-content";
    contentDiv.textContent = content;

    element.appendChild(contentDiv);
    container.appendChild(element);
    container.scrollTop = container.scrollHeight;

    const message = {
        role,
        content,
        timestamp: new Date().toISOString()
    };

    history.push(message);

    if (storageKey) {
        saveStoredChat(storageKey, history);
    }

    return element;
}

function removeChatMessage(element) {
    if (element?.parentElement) {
        element.parentElement.removeChild(element);
    }
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
    window.addEventListener("resize", () => {
        if (readingsCache.length > 0) {
            drawTrendChart(readingsCache);
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

function startAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    refreshTimer = setInterval(() => {
        if (isAuthenticated) {
            refreshDashboard();
        }
    }, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

function setupReports() {
    const readings = readingsCache;
    const latest = latestReading;
    const device = latestDevice;

    // Summary cards
    if (latest && latest.recorded_at) {
        setText("reportsLatestTime", formatDate(latest.recorded_at));
    } else {
        setText("reportsLatestTime", "--");
    }

    if (device && device.name) {
        setText("reportsLatestDevice", device.name);
    } else {
        setText("reportsLatestDevice", latest ? "Unknown device" : "No device data");
    }

    setText("reportsTotalReadings", String(readings.length));

    if (latest) {
        const quality = computeReadingQuality(latest);
        setText("reportsQualityStatus", quality.label);
        setText("reportsQualityDescription", quality.description || "Evaluated from latest reading");
    } else {
        setText("reportsQualityStatus", "No data");
        setText("reportsQualityDescription", "Waiting for readings");
    }

    if (device) {
        setText("reportsDeviceStatus", device.is_online ? "Online" : "Offline");
        setText("reportsDeviceName", device.name || device.device_id || "Device");
    } else {
        setText("reportsDeviceStatus", "--");
        setText("reportsDeviceName", "No device");
    }

    // Sensor summary
    if (latest) {
        setText("reportsTemperature", formatNumber(latest.temperature, 1) + " °C");
        setText("reportsTemperatureStatus", latest.temperature != null ? "Measured" : "Unavailable");
        setText("reportsPh", formatNumber(latest.ph, 2) + " pH");
        setText("reportsPhStatus", latest.ph != null ? "Measured" : "Unavailable");
        setText("reportsTurbidity", formatNumber(latest.turbidity, 2) + " NTU");
        setText("reportsTurbidityStatus", latest.turbidity != null ? "Measured" : "Unavailable");
        setText("reportsTds", formatNumber(latest.tds, 2) + " mg/L");
        setText("reportsTdsStatus", latest.tds != null ? "Measured" : "Unavailable");
    }

    // Empty state / table
    const emptyState = $("reportsEmptyState");
    const tableWrapper = $("reportsTableWrapper");
    const tableBody = $("reportsReadingsBody");

    if (!emptyState || !tableBody) return;

    if (readings.length === 0) {
        showElement("reportsEmptyState");
        hideElement("reportsTableWrapper");
    } else {
        hideElement("reportsEmptyState");
        showElement("reportsTableWrapper");

        tableBody.innerHTML = "";

        const rows = readings.slice(0, 50);

        rows.forEach(function (r) {
            const row = document.createElement("tr");
            row.innerHTML =
                "<td>" + safeText(r.id) + "</td>" +
                "<td>" + safeText(r.device_id) + "</td>" +
                "<td>" + formatNumber(r.temperature, 1) + "</td>" +
                "<td>" + formatNumber(r.ph, 2) + "</td>" +
                "<td>" + formatNumber(r.turbidity, 2) + "</td>" +
                "<td>" + formatNumber(r.tds, 2) + "</td>" +
                "<td>" + formatDate(r.recorded_at) + "</td>";
            tableBody.appendChild(row);
        });
    }
}

function setupProfile() {
    const device = latestDevice;

    if (device && device.name) {
        setText("profileDeviceName", device.name);
    } else {
        setText("profileDeviceName", "No device");
    }

    if (device) {
        setText("profileDeviceStatus", device.is_online ? "Online" : "Offline");
    } else {
        setText("profileDeviceStatus", "Offline");
    }

    setText("profileRefreshStatus", refreshTimer ? "Active" : "Inactive");
    setText("profileDashboardRange", currentRange || "24H");

    const baseUrl = getApiBaseUrl();
    setText("profileBackendUrl", baseUrl);

    // Check actual backend status via the connection indicator
    const connectionDot = $("connectionDot");
    if (connectionDot) {
        const isOnline = connectionDot.classList.contains("online");
        setText("profileBackendStatus", isOnline ? "Online" : "Offline");
    } else {
        setText("profileBackendStatus", "Unknown");
    }
}
/*
 * ADMIN DASHBOARD
 * Load users + stats from admin-only endpoints. Every endpoint is also
 * enforced server-side, so a normal user calling these gets 401/403 and
 * simply sees "Unavailable".
 */
async function loadAdminData() {
    try {
        const stats = await apiRequest("/admin/stats");
        setText("adminUsersCount", String(stats?.users?.total ?? "--"));
        setText("adminActiveUsers", String(stats?.users?.active ?? "--"));
        setText(
            "adminDisabledUsers",
            String(stats?.users?.disabled ?? "--")
        );
        setText("adminAdminUsers", String(stats?.users?.admins ?? "--"));
        setText(
            "adminActiveSessions",
            String(stats?.active_sessions ?? "--")
        );
        setText(
            "adminDevicesCount",
            String(stats?.devices?.total ?? "--")
        );
        setText(
            "adminOnlineDevices",
            String(stats?.devices?.online_recent ?? "--")
        );
        setText(
            "adminTotalReadings",
            String(stats?.readings_total ?? "--")
        );
        setText(
            "adminTotalPredictions",
            String(stats?.camera_predictions_total ?? "--")
        );
    } catch (error) {
        console.warn("Admin stats unavailable:", error.message);
        ["adminUsersCount", "adminDevicesCount"].forEach((id) =>
            setText(id, "Unavailable")
        );
    }

    await renderAdminUsers();
}

async function renderAdminUsers() {
    const tableBody = $("adminUsersTableBody");

    if (!tableBody) {
        return;
    }

    tableBody.innerHTML =
        '<tr><td colspan="8">Loading users...</td></tr>';

    try {
        const data = await apiRequest("/admin/users");
        const users = Array.isArray(data?.users) ? data.users : [];

        if (users.length === 0) {
            tableBody.innerHTML =
                '<tr><td colspan="8">No users registered yet.</td></tr>';
            return;
        }

        tableBody.innerHTML = "";

        users.forEach((user) => {
            const row = document.createElement("tr");

            const roleBadge = user.is_admin
                ? '<span class="admin-role-badge admin">Admin</span>'
                : '<span class="admin-role-badge">User</span>';

            const statusBadge = user.is_active
                ? '<span class="admin-status-badge active">Active</span>'
                : '<span class="admin-status-badge disabled">Disabled</span>';

            const selfRow = user.is_admin ? " (you)" : "";

            row.innerHTML =
                "<td>" + escapeHtml(String(user.id)) + "</td>" +
                "<td>" +
                    escapeHtml(user.username || "--") +
                    escapeHtml(selfRow) +
                "</td>" +
                "<td>" + escapeHtml(user.full_name || "--") + "</td>" +
                "<td>" + escapeHtml(user.email || "--") + "</td>" +
                "<td>" + roleBadge + "</td>" +
                "<td>" + statusBadge + "</td>" +
                "<td>" + escapeHtml(formatDate(user.created_at)) + "</td>" +
                '<td class="admin-actions"></td>';

            // Disable/enable toggle (not for the signed-in admin themself)
            if (currentUser && user.id === currentUser.id) {
                row.querySelector(".admin-actions").textContent = "—";
            } else {
                const toggleButton = document.createElement("button");

                toggleButton.className = user.is_active
                    ? "admin-toggle-button disable"
                    : "admin-toggle-button enable";
                toggleButton.type = "button";
                toggleButton.textContent = user.is_active
                    ? "Disable"
                    : "Enable";

                toggleButton.addEventListener("click", async () => {
                    toggleButton.disabled = true;

                    try {
                        await apiRequest(
                            `/admin/users/${user.id}/status`,
                            {
                                method: "PATCH",
                                body: JSON.stringify({
                                    is_active: !user.is_active,
                                }),
                            }
                        );

                        showToast(
                            user.is_active
                                ? "User disabled."
                                : "User enabled.",
                            "success"
                        );
                        await renderAdminUsers();
                    } catch (error) {
                        showToast(error.message, "error");
                        toggleButton.disabled = false;
                    }
                });

                row.querySelector(".admin-actions").appendChild(toggleButton);
            }

            tableBody.appendChild(row);
        });
    } catch (error) {
        console.warn("Admin users unavailable:", error.message);
        tableBody.innerHTML =
            '<tr><td colspan="8">User list unavailable. ' +
            escapeHtml(error.message) +
            "</td></tr>";
    }
}

async function initializeApp() {
    setupNavigation();
    setupMobileMenu();
    setupRangeFilters();
    setupRefreshButton();
    setupSettings();
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
    setupWindowEvents();

    // Check demo auth state from localStorage
    const authenticated = checkDemoAuth();
    if (authenticated) {
        updateUserInterface();
        const initialPage =
            window.location.hash.replace("#", "") || "dashboard";
        navigateTo(initialPage);
        await refreshDashboard();
    } else {
        isAuthenticated = false;
        currentUser = null;
        clearUserState();
        updateUserInterface();
        navigateTo("dashboard");
        openLoginModal("Please sign in to continue.");
    }

    startAutoRefresh();
}

/*
 * Clear every client-side user artifact on logout/expiry so no private
 * state survives a session boundary.
 */
function clearUserState() {
    latestReading = null;
    latestDevice = null;
    readingsCache = [];
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