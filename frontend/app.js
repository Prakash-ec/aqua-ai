
"use strict";

/*
    Aqua AI Frontend Application
    --------------------------------
    Backend:
    http://127.0.0.1:8000 during local development

    Change API_BASE_URL when using Render.
*/

let API_BASE_URL =
    localStorage.getItem("aqua_api_url") ||
    "http://127.0.0.1:8001";

const REFRESH_INTERVAL = 15000;

/*
 * Read the API base URL live from localStorage so that a backend URL saved
 * in Settings takes effect without requiring an extra page reload.
 */
function getApiBaseUrl() {
    const stored = localStorage.getItem("aqua_api_url");
    return stored && stored.trim() !== ""
        ? stored.replace(/\/+$/, "")
        : "http://127.0.0.1:8001";
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
            message || (online ? "Backend connected" : "Backend offline");
    }

    const statusLabel = $("backendStatus");

    if (statusLabel) {
        statusLabel.textContent = online ? "Online" : "Offline";
    }
}

async function apiRequest(path, options = {}) {
    const url = `${getApiBaseUrl()}${path}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            Accept: "application/json",
            ...(options.body instanceof FormData
                ? {}
                : { "Content-Type": "application/json" }),
            ...(options.headers || {})
        }
    });

    let data = null;

    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const detail =
            data?.detail ||
            data?.message ||
            `Request failed with status ${response.status}`;

        throw new Error(detail);
    }

    return data;
}

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
                <strong>No devices registered</strong>
                <p>Connect an ESP32 or another sensor device to get started.</p>
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

async function loadLatestReading() {
    try {
        let data;

        try {
            data = await apiRequest("/readings/latest");
        } catch {
            data = await apiRequest("/readings/latest/");
        }

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
        let data;

        try {
            data = await apiRequest("/readings/");
        } catch {
            data = await apiRequest("/readings");
        }

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
                ? "Backend connected"
                : "Backend online"
        );

        return true;
    } catch {
        setConnectionStatus(false, "Backend offline");
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
                "Backend unavailable",
                "unknown",
                "Could not reach the Aqua AI backend. Check the server and the API URL in Settings, then retry."
            );

            setText(
                "lastRefreshTime",
                "Retry failed - backend unreachable",
                "--"
            );

            return;
        }

        await loadDevices();
        await loadLatestReading();
        await loadAllReadings();
        updateLastRefreshTime();
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

    const filtered = filterReadingsByRange(readings, currentRange)
        .slice()
        .reverse();

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

    for (let index = 0; index <= 4; index += 1) {
        const y = padding.top + (chartHeight / 4) * index;

        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();

        context.fillText(
            `${100 - index * 25}`,
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

    series.forEach((item) => {
        const points = filtered
            .map((reading, index) => {
                const value = Number(reading[item.key]);

                if (!Number.isFinite(value)) {
                    return null;
                }

                const x =
                    filtered.length === 1
                        ? padding.left + chartWidth / 2
                        : padding.left +
                          (index / (filtered.length - 1)) *
                              chartWidth;

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
    const filtered = filterReadingsByRange(readings, currentRange).slice();

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
    const filtered = filterReadingsByRange(readings, currentRange).slice();

    if (filtered.length === 0) {
        container.innerHTML = `
            <i class="ri-line-chart-line"></i>
            <strong>Trend visualization</strong>
            <p>Historical sensor data will appear here.</p>
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
            "AI Camera Analysis",
            "Use visual AI assistance to screen visible water characteristics."
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
            "Configure backend and AI preferences."
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
        camera: "AI Camera",
        device: "Device",
        trends: "Trends",
        analysis: "Analysis",
        settings: "Settings"
    };

    setText("breadcrumbCurrent", pageLabels[page] || "Dashboard");

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
                alert("Please enter a valid backend URL.");
                return;
            }

            const normalized = value.replace(/\/+$/, "");

            localStorage.setItem(
                "aqua_api_url",
                normalized
            );

            API_BASE_URL = normalized;

            alert("Backend URL saved. The page will reload.");
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

            alert("AI settings saved.");
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
                AI is analyzing the image...
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

    if (titleElement) {
        titleElement.textContent =
            riskLevel !== undefined
                ? `Analysis: ${riskLevel} risk`
                : "Analysis completed";
    }

    if (textElement) {
        const primaryText =
            String(observation || agentAnswer || "").trim();

        textElement.textContent =
            primaryText ||
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
                <label>AI Analysis</label>
                <p>${escapeHtml(
                    String(observation || agentAnswer || "No result was returned.")
                )}</p>
            </div>
        `;
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

    chatHistory = loadStoredChat("aqua_ai_chat_history");
    renderChatMessages(messages, chatHistory);

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const question = input.value.trim();

        if (!question) {
            return;
        }

        input.value = "";

        addChatMessage(
            messages,
            chatHistory,
            "user",
            question
        );

        if (sendButton) {
            sendButton.disabled = true;
        }

        const loadingElement = addChatMessage(
            messages,
            chatHistory,
            "assistant",
            "Thinking..."
        );

        try {
            const response = await apiRequest("/chat/water", {
                method: "POST",
                body: JSON.stringify({
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
                })
            });

            removeChatMessage(loadingElement);

            const answer =
                response?.answer ||
                response?.response ||
                response?.message ||
                "I could not generate an answer.";

            addChatMessage(
                messages,
                chatHistory,
                "assistant",
                answer
            );
        } catch (error) {
            removeChatMessage(loadingElement);

            addChatMessage(
                messages,
                chatHistory,
                "assistant",
                `Unable to contact the water-quality assistant: ${error.message}`
            );
        } finally {
            if (sendButton) {
                sendButton.disabled = false;
            }
        }
    });

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            form.requestSubmit();
        }
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

    cameraChatHistory = loadStoredChat("aqua_ai_camera_chat_history");
    renderChatMessages(messages, cameraChatHistory);

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const question = input.value.trim();

        if (!question) {
            return;
        }

        input.value = "";

        addChatMessage(
            messages,
            cameraChatHistory,
            "user",
            question
        );

        if (sendButton) {
            sendButton.disabled = true;
        }

        const loadingElement = addChatMessage(
            messages,
            cameraChatHistory,
            "assistant",
            "Thinking..."
        );

        try {
            const response = await apiRequest("/agents/camera/question", {
                method: "POST",
                body: JSON.stringify({
                    question,
                    analysis: latestCameraAnalysis
                })
            });

            removeChatMessage(loadingElement);

            const agentResponse = response?.response || response || {};

            const answer =
                agentResponse?.answer ||
                agentResponse?.response ||
                response?.answer ||
                response?.message ||
                "I could not generate an answer.";

            addChatMessage(
                messages,
                cameraChatHistory,
                "assistant",
                answer
            );
        } catch (error) {
            removeChatMessage(loadingElement);

            addChatMessage(
                messages,
                cameraChatHistory,
                "assistant",
                `Camera assistant error: ${error.message}`
            );
        } finally {
            if (sendButton) {
                sendButton.disabled = false;
            }
        }
    });

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            form.requestSubmit();
        }
    });
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

function renderChatMessages(container, history) {
    container.innerHTML = "";

    if (history.length === 0) {
        const welcome = document.createElement("div");

        welcome.className = "chat-message assistant";
        welcome.textContent =
            "Hello! Ask me about the latest sensor readings, pH, temperature, turbidity, or TDS.";

        container.appendChild(welcome);
        return;
    }

    history.forEach((message) => {
        const element = document.createElement("div");

        element.className = `chat-message ${message.role}`;
        element.textContent = message.content;

        container.appendChild(element);
    });

    container.scrollTop = container.scrollHeight;
}

function addChatMessage(container, history, role, content) {
    const element = document.createElement("div");

    element.className = `chat-message ${role}`;
    element.textContent = content;

    container.appendChild(element);
    container.scrollTop = container.scrollHeight;

    const message = {
        role,
        content,
        timestamp: new Date().toISOString()
    };

    history.push(message);

    if (history === chatHistory) {
        saveStoredChat("aqua_ai_chat_history", history);
    } else if (history === cameraChatHistory) {
        saveStoredChat("aqua_ai_camera_chat_history", history);
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
        refreshDashboard();
    }, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

async function initializeApp() {
    setupNavigation();
    setupMobileMenu();
    setupRangeFilters();
    setupRefreshButton();
    setupSettings();
    setupAddDevice();
    setupReadingForm();
    setupCameraUpload();
    setupSensorChat();
    setupCameraChat();
    setupSimulator();
    setupWindowEvents();

    const initialPage =
        window.location.hash.replace("#", "") || "dashboard";

    navigateTo(initialPage);

    await refreshDashboard();

    startAutoRefresh();
}

document.addEventListener("DOMContentLoaded", initializeApp);