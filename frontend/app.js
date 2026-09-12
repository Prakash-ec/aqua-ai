"use strict";

/* =========================================================
   AQUA AI FRONTEND
   ========================================================= */

const DEFAULT_API_BASE =
    "https://aqua-ai-wz4s.onrender.com";

let API_BASE =
    localStorage.getItem("aqua_ai_api_base") ||
    window.AQUA_API_BASE_URL ||
    DEFAULT_API_BASE;

let REFRESH_INTERVAL =
    Number(localStorage.getItem("aqua_ai_refresh_interval")) || 15;

const state = {
    initialized: false,
    readings: [],
    latest: null,
    selectedPage: "dashboard",
    selectedImage: null,
    imagePreviewUrl: null,
    cameraStream: null,
    charts: {},
    refreshTimer: null
};

const $ = (id) => document.getElementById(id);

const endpoints = {
    readings: "/readings/",
    camera: "/camera/analyze",
    chat: "/chat/water"
};

/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener("DOMContentLoaded", init);

function init() {
    if (state.initialized) {
        return;
    }

    state.initialized = true;

    setupNavigation();
    setupRefresh();
    setupCameraControls();
    setupChat();
    setupSettings();
    setupChartControls();
    setupImageUpload();

    loadSettingsIntoForm();
    loadReadings();

    startAutoRefresh();
}

/* =========================================================
   NAVIGATION
   ========================================================= */

function setupNavigation() {
    document.querySelectorAll(".nav-item").forEach((button) => {
        button.addEventListener("click", () => {
            const page = button.dataset.page;
            showPage(page);
        });
    });

    $("menuButton").addEventListener("click", () => {
        $("sidebar").classList.toggle("open");
    });
}

function showPage(pageName) {
    state.selectedPage = pageName;

    document.querySelectorAll(".nav-item").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.page === pageName
        );
    });

    document.querySelectorAll(".page").forEach((page) => {
        page.classList.remove("active-page");
    });

    const selectedPage = $(`page-${pageName}`);

    if (selectedPage) {
        selectedPage.classList.add("active-page");
    }

    const titleMap = {
        dashboard: "Dashboard",
        temperature: "Temperature",
        ph: "pH Level",
        turbidity: "Turbidity",
        tds: "TDS",
        camera: "AI Camera",
        chat: "Water Chat",
        device: "Device",
        trends: "Trends",
        analysis: "Analysis",
        settings: "Settings"
    };

    $("pageTitle").textContent = titleMap[pageName] || "Dashboard";

    $("sidebar").classList.remove("open");

    if (pageName === "temperature") {
        renderParameterChart("temperature");
    }

    if (pageName === "ph") {
        renderParameterChart("ph");
    }

    if (pageName === "turbidity") {
        renderParameterChart("turbidity");
    }

    if (pageName === "tds") {
        renderParameterChart("tds");
    }

    if (pageName === "trends") {
        renderTrendsChart();
    }
}

/* =========================================================
   API REQUESTS
   ========================================================= */

async function apiRequest(path, options = {}) {
    const url = `${API_BASE.replace(/\/$/, "")}${path}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            Accept: "application/json",
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `Request failed: ${response.status} ${errorText}`
        );
    }

    return response.json();
}

/* =========================================================
   LOAD SENSOR READINGS
   ========================================================= */

async function loadReadings() {
    setConnectionState("connecting");

    try {
        const data = await apiRequest(endpoints.readings);

        const readings = extractReadings(data);

        state.readings = readings;
        state.latest = readings.length ? readings[0] : null;

        renderDashboard();
        renderAllCharts();
        renderAnalysis();
        renderDevice();

        setConnectionState("online");

        $("lastUpdated").textContent =
            `Updated ${formatDateTime(new Date())}`;
    } catch (error) {
        console.error("Reading error:", error);

        setConnectionState("offline");

        $("lastUpdated").textContent = "Backend unavailable";
    }
}

function extractReadings(data) {
    let values = [];

    if (Array.isArray(data)) {
        values = data;
    } else if (Array.isArray(data.readings)) {
        values = data.readings;
    } else if (Array.isArray(data.data)) {
        values = data.data;
    } else if (data.latest) {
        values = [data.latest];
    } else if (data.id || data.reading_id) {
        values = [data];
    }

    return values
        .map(normalizeReading)
        .filter((reading) => reading !== null)
        .sort((a, b) => {
            return new Date(b.recordedAt) - new Date(a.recordedAt);
        });
}

function normalizeReading(item) {
    if (!item || typeof item !== "object") {
        return null;
    }

    const temperature = firstNumber(
        item.temperature,
        item.temperature_c,
        item.temp
    );

    const ph = firstNumber(
        item.ph,
        item.pH,
        item.ph_value
    );

    const turbidity = firstNumber(
        item.turbidity,
        item.turbidity_ntu
    );

    const tds = firstNumber(
        item.tds,
        item.tds_value,
        item.total_dissolved_solids
    );

    const recordedAt =
        item.recorded_at ||
        item.recordedAt ||
        item.timestamp ||
        item.created_at ||
        new Date().toISOString();

    return {
        id: item.id || item.reading_id || item.readingId || "--",
        deviceId: item.device_id || item.deviceId || "--",
        temperature,
        ph,
        turbidity,
        tds,
        recordedAt,
        location: item.location || item.device_location || "Unknown"
    };
}

function firstNumber(...values) {
    for (const value of values) {
        if (value !== null && value !== undefined && value !== "") {
            const number = Number(value);

            if (Number.isFinite(number)) {
                return number;
            }
        }
    }

    return null;
}

/* =========================================================
   DASHBOARD RENDERING
   ========================================================= */

function renderDashboard() {
    const latest = state.latest;

    if (!latest) {
        return;
    }

    setText("temperatureValue", formatNumber(latest.temperature));
    setText("phValue", formatNumber(latest.ph));
    setText("turbidityValue", formatNumber(latest.turbidity));
    setText("tdsValue", formatNumber(latest.tds));

    setText("temperatureStatus", temperatureStatus(latest.temperature));
    setText("phStatus", phStatus(latest.ph));
    setText("turbidityStatus", turbidityStatus(latest.turbidity));
    setText("tdsStatus", tdsStatus(latest.tds));

    setText("temperatureTrend", getTrend("temperature"));
    setText("phTrend", getTrend("ph"));
    setText("turbidityTrend", getTrend("turbidity"));
    setText("tdsTrend", getTrend("tds"));

    setText("dashboardDeviceId", latest.deviceId);
    setText("dashboardReadingId", `Reading ${latest.id}`);
    setText("dashboardLocation", latest.location);
    setText("deviceLocationDetails", latest.location);
    setText("deviceReadingDetails", latest.id);
    setText("dashboardUpdated", formatDateTime(latest.recordedAt));

    const score = calculateQualityScore(latest);

    setText("qualityScore", score);

    $("qualityMeterFill").style.width = `${score}%`;

    const quality = getQualityInfo(score);

    setText("qualityTitle", quality.title);
    setText("qualityMessage", quality.message);

    const qualityBadge = $("deviceStatusBadge");
    qualityBadge.textContent = quality.badge;
    qualityBadge.className = `status-badge ${quality.className}`;

    renderRecentTable();
}

function renderRecentTable() {
    const body = $("readingsTableBody");

    body.innerHTML = "";

    if (!state.readings.length) {
        body.innerHTML = `
            <tr>
                <td colspan="5">No readings available.</td>
            </tr>
        `;
        return;
    }

    state.readings.slice(0, 10).forEach((reading) => {
        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${escapeHtml(formatDateTime(reading.recordedAt))}</td>
            <td>${escapeHtml(formatNumber(reading.temperature))} °C</td>
            <td>${escapeHtml(formatNumber(reading.ph))}</td>
            <td>${escapeHtml(formatNumber(reading.turbidity))} NTU</td>
            <td>${escapeHtml(formatNumber(reading.tds))} mg/L</td>
        `;

        body.appendChild(row);
    });
}

/* =========================================================
   QUALITY CALCULATION
   ========================================================= */

function calculateQualityScore(reading) {
    const scores = [];

    if (reading.temperature !== null) {
        const difference = Math.abs(reading.temperature - 25);
        scores.push(Math.max(0, 100 - difference * 4));
    }

    if (reading.ph !== null) {
        const difference = Math.abs(reading.ph - 7);
        scores.push(Math.max(0, 100 - difference * 25));
    }

    if (reading.turbidity !== null) {
        scores.push(Math.max(0, 100 - reading.turbidity * 5));
    }

    if (reading.tds !== null) {
        scores.push(Math.max(0, 100 - Math.max(0, reading.tds - 300) * 0.15));
    }

    if (!scores.length) {
        return 0;
    }

    return Math.round(
        scores.reduce((sum, value) => sum + value, 0) / scores.length
    );
}

function getQualityInfo(score) {
    if (score >= 80) {
        return {
            title: "Water quality looks good",
            message: "The available sensor values are within a generally acceptable range.",
            badge: "GOOD CONDITION",
            className: "good"
        };
    }

    if (score >= 55) {
        return {
            title: "Water quality needs attention",
            message: "Some sensor values may need monitoring or further investigation.",
            badge: "NEEDS ATTENTION",
            className: "warning"
        };
    }

    return {
        title: "Water quality alert",
        message: "One or more sensor values may be outside the expected range.",
        badge: "ALERT",
        className: "danger"
    };
}

/* =========================================================
   SENSOR STATUS
   ========================================================= */

function temperatureStatus(value) {
    if (value === null) return "No data";
    if (value >= 15 && value <= 35) return "Normal range";
    return "Check temperature";
}

function phStatus(value) {
    if (value === null) return "No data";
    if (value >= 6.5 && value <= 8.5) return "Acceptable range";
    return "Check pH level";
}

function turbidityStatus(value) {
    if (value === null) return "No data";
    if (value <= 5) return "Clear condition";
    return "High turbidity";
}

function tdsStatus(value) {
    if (value === null) return "No data";
    if (value <= 300) return "Low dissolved solids";
    if (value <= 600) return "Moderate dissolved solids";
    return "High dissolved solids";
}

function getTrend(parameter) {
    if (state.readings.length < 2) {
        return "Not enough data";
    }

    const latest = state.readings[0][parameter];
    const previous = state.readings[1][parameter];

    if (latest === null || previous === null) {
        return "No trend available";
    }

    const difference = latest - previous;

    if (Math.abs(difference) < 0.01) {
        return "→ Stable";
    }

    return difference > 0
        ? `↑ Increased by ${Math.abs(difference).toFixed(2)}`
        : `↓ Decreased by ${Math.abs(difference).toFixed(2)}`;
}

/* =========================================================
   CHARTS
   ========================================================= */

function setupChartControls() {
    $("chartMetric").addEventListener("change", renderDashboardChart);
}

function renderAllCharts() {
    renderDashboardChart();
    renderParameterChart("temperature");
    renderParameterChart("ph");
    renderParameterChart("turbidity");
    renderParameterChart("tds");
    renderTrendsChart();
}

function getChartData(parameter) {
    const values = [...state.readings].reverse();

    return {
        labels: values.map((reading) =>
            new Date(reading.recordedAt).toLocaleTimeString()
        ),
        values: values.map((reading) => reading[parameter])
    };
}

function renderDashboardChart() {
    const selected = $("chartMetric").value;

    const datasets = [];

    const parameters = selected === "all"
        ? ["temperature", "ph", "turbidity", "tds"]
        : [selected];

    parameters.forEach((parameter) => {
        const chartData = getChartData(parameter);

        datasets.push({
            label: parameter.toUpperCase(),
            data: chartData.values,
            borderWidth: 2,
            tension: 0.35,
            fill: false
        });
    });

    createChart("dashboardChart", {
        type: "line",
        data: {
            labels: state.readings
                .slice()
                .reverse()
                .map((reading) =>
                    new Date(reading.recordedAt).toLocaleTimeString()
                ),
            datasets
        },
        options: chartOptions()
    });
}

function renderParameterChart(parameter) {
    const canvasId = `${parameter}Chart`;

    const chartData = getChartData(parameter);

    createChart(canvasId, {
        type: "line",
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: parameter.toUpperCase(),
                    data: chartData.values,
                    borderWidth: 3,
                    tension: 0.35,
                    fill: false
                }
            ]
        },
        options: chartOptions()
    });

    const latest = state.latest;

    if (!latest) {
        return;
    }

    const pageValueMap = {
        temperature: `${formatNumber(latest.temperature)} °C`,
        ph: formatNumber(latest.ph),
        turbidity: `${formatNumber(latest.turbidity)} NTU`,
        tds: `${formatNumber(latest.tds)} mg/L`
    };

    setText(`${parameter}PageValue`, pageValueMap[parameter]);

    const statusMap = {
        temperature: temperatureStatus(latest.temperature),
        ph: phStatus(latest.ph),
        turbidity: turbidityStatus(latest.turbidity),
        tds: tdsStatus(latest.tds)
    };

    setText(`${parameter}PageStatus`, statusMap[parameter]);
}

function renderTrendsChart() {
    const labels = state.readings
        .slice()
        .reverse()
        .map((reading) =>
            new Date(reading.recordedAt).toLocaleTimeString()
        );

    createChart("trendsChart", {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Temperature",
                    data: state.readings.slice().reverse().map((r) => r.temperature),
                    borderWidth: 2,
                    tension: 0.35
                },
                {
                    label: "pH",
                    data: state.readings.slice().reverse().map((r) => r.ph),
                    borderWidth: 2,
                    tension: 0.35
                },
                {
                    label: "Turbidity",
                    data: state.readings.slice().reverse().map((r) => r.turbidity),
                    borderWidth: 2,
                    tension: 0.35
                },
                {
                    label: "TDS",
                    data: state.readings.slice().reverse().map((r) => r.tds),
                    borderWidth: 2,
                    tension: 0.35
                }
            ]
        },
        options: chartOptions()
    });
}

function createChart(canvasId, configuration) {
    const canvas = $(canvasId);

    if (!canvas) {
        return;
    }

    if (state.charts[canvasId]) {
        state.charts[canvasId].destroy();
    }

    state.charts[canvasId] = new Chart(canvas, configuration);
}

function chartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            intersect: false,
            mode: "index"
        },
        plugins: {
            legend: {
                display: true
            }
        },
        scales: {
            y: {
                beginAtZero: false,
                grid: {
                    color: "#e8eef3"
                }
            },
            x: {
                grid: {
                    display: false
                }
            }
        }
    };
}

/* =========================================================
   CAMERA UPLOAD
   ========================================================= */

function setupImageUpload() {
    $("imageInput").addEventListener("change", (event) => {
        const file = event.target.files[0];

        if (!file) {
            return;
        }

        state.selectedImage = file;

        if (state.imagePreviewUrl) {
            URL.revokeObjectURL(state.imagePreviewUrl);
        }

        state.imagePreviewUrl = URL.createObjectURL(file);

        $("imagePreview").src = state.imagePreviewUrl;
        $("imagePreviewContainer").classList.remove("hidden");
        $("uploadArea").classList.add("hidden");
    });

    $("clearImageButton").addEventListener("click", clearSelectedImage);
}

function clearSelectedImage() {
    state.selectedImage = null;

    if (state.imagePreviewUrl) {
        URL.revokeObjectURL(state.imagePreviewUrl);
        state.imagePreviewUrl = null;
    }

    $("imageInput").value = "";
    $("imagePreview").src = "";
    $("imagePreviewContainer").classList.add("hidden");
    $("uploadArea").classList.remove("hidden");
}

/* =========================================================
   LIVE CAMERA
   ========================================================= */

function setupCameraControls() {
    $("uploadModeButton").addEventListener("click", () => {
        $("uploadModeButton").classList.add("active");
        $("liveModeButton").classList.remove("active");

        $("uploadMode").classList.remove("hidden");
        $("liveMode").classList.add("hidden");
    });

    $("liveModeButton").addEventListener("click", () => {
        $("liveModeButton").classList.add("active");
        $("uploadModeButton").classList.remove("active");

        $("liveMode").classList.remove("hidden");
        $("uploadMode").classList.add("hidden");
    });

    $("startCameraButton").addEventListener("click", startCamera);
    $("captureCameraButton").addEventListener("click", captureCamera);
    $("stopCameraButton").addEventListener("click", stopCamera);
    $("analyzeImageButton").addEventListener("click", analyzeImage);
}

async function startCamera() {
    try {
        state.cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "environment"
            },
            audio: false
        });

        $("cameraVideo").srcObject = state.cameraStream;

        $("startCameraButton").disabled = true;
        $("captureCameraButton").disabled = false;
        $("stopCameraButton").disabled = false;
    } catch (error) {
        showCameraError("Unable to access the camera. Check browser permissions.");
        console.error(error);
    }
}

function captureCamera() {
    const video = $("cameraVideo");
    const canvas = $("cameraCanvas");

    if (!state.cameraStream) {
        return;
    }

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const context = canvas.getContext("2d");

    context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
    );

    canvas.toBlob((blob) => {
        if (!blob) {
            return;
        }

        state.selectedImage = new File(
            [blob],
            "camera-capture.jpg",
            {
                type: "image/jpeg"
            }
        );

        showCameraError("");
        analyzeImage();
    }, "image/jpeg", 0.9);
}

function stopCamera() {
    if (state.cameraStream) {
        state.cameraStream.getTracks().forEach((track) => track.stop());
        state.cameraStream = null;
    }

    $("cameraVideo").srcObject = null;

    $("startCameraButton").disabled = false;
    $("captureCameraButton").disabled = true;
    $("stopCameraButton").disabled = true;
}

function showCameraError(message) {
    const element = $("aiError");

    if (!message) {
        element.textContent = "";
        element.classList.add("hidden");
        return;
    }

    element.textContent = message;
    element.classList.remove("hidden");
}

/* =========================================================
   AI IMAGE ANALYSIS
   ========================================================= */

async function analyzeImage() {
    if (!state.selectedImage) {
        showCameraError("Please select or capture an image first.");
        return;
    }

    const formData = new FormData();

    formData.append("image", state.selectedImage);

    const provider = $("cameraProviderSelect").value;
    const model = $("aiModelSelector").value.trim();

    if (provider) {
        formData.append("provider", provider);
    }

    if (model) {
        formData.append("model", model);
    }

    $("aiLoading").classList.remove("hidden");
    $("aiResult").classList.add("hidden");
    showCameraError("");

    try {
        const result = await apiRequest(endpoints.camera, {
            method: "POST",
            body: formData,
            headers: {}
        });

        const answer =
            result.analysis ||
            result.result ||
            result.response ||
            result.message ||
            result.text ||
            JSON.stringify(result, null, 2);

        $("aiResultText").textContent = answer;
        $("aiResult").classList.remove("hidden");
    } catch (error) {
        console.error("Camera analysis error:", error);
        showCameraError(error.message);
    } finally {
        $("aiLoading").classList.add("hidden");
    }
}

/* =========================================================
   WATER CHAT
   ========================================================= */

function setupChat() {
    $("chatForm").addEventListener("submit", async (event) => {
        event.preventDefault();

        const input = $("chatInput");
        const question = input.value.trim();

        if (!question) {
            return;
        }

        addChatMessage(question, "user");

        input.value = "";

        const loadingMessage = addChatMessage(
            "Thinking...",
            "assistant"
        );

        try {
            const result = await apiRequest(endpoints.chat, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    question,
                    message: question,
                    prompt: question
                })
            });

            const answer =
                result.answer ||
                result.response ||
                result.message ||
                result.reply ||
                JSON.stringify(result, null, 2);

            loadingMessage.textContent = answer;
        } catch (error) {
            loadingMessage.textContent =
                "Unable to contact the water assistant. Please check the backend.";
            console.error("Chat error:", error);
        }

        scrollChatToBottom();
    });
}

function addChatMessage(message, type) {
    const element = document.createElement("div");

    element.className = `chat-message ${type}`;
    element.textContent = message;

    $("chatMessages").appendChild(element);

    scrollChatToBottom();

    return element;
}

function scrollChatToBottom() {
    const container = $("chatMessages");

    container.scrollTop = container.scrollHeight;
}

/* =========================================================
   DEVICE INFORMATION
   ========================================================= */

function renderDevice() {
    const latest = state.latest;

    if (!latest) {
        return;
    }

    setText("devicePageId", latest.deviceId);
    setText("devicePageName", "Aqua AI Device");
    setText("devicePageType", "ESP32");
    setText("devicePageLocation", latest.location);
    setText("devicePageStatus", "Connected");
}

/* =========================================================
   ANALYSIS PAGE
   ========================================================= */

function renderAnalysis() {
    const latest = state.latest;

    if (!latest) {
        return;
    }

    const score = calculateQualityScore(latest);
    const quality = getQualityInfo(score);

    setText(
        "analysisSummary",
        `${quality.title}. Current calculated score: ${score}/100.`
    );

    $("analysisContent").innerHTML = `
        <p><strong>Temperature:</strong> ${formatNumber(latest.temperature)} °C — ${escapeHtml(temperatureStatus(latest.temperature))}</p>
        <p><strong>pH:</strong> ${formatNumber(latest.ph)} — ${escapeHtml(phStatus(latest.ph))}</p>
        <p><strong>Turbidity:</strong> ${formatNumber(latest.turbidity)} NTU — ${escapeHtml(turbidityStatus(latest.turbidity))}</p>
        <p><strong>TDS:</strong> ${formatNumber(latest.tds)} mg/L — ${escapeHtml(tdsStatus(latest.tds))}</p>
        <br>
        <p>This score is an indicative frontend interpretation and should not replace certified laboratory water testing.</p>
    `;
}

/* =========================================================
   SETTINGS
   ========================================================= */

function setupSettings() {
    $("saveSettingsButton").addEventListener("click", () => {
        const newApiBase = $("apiBaseInput").value.trim();
        const newInterval = Number($("refreshIntervalInput").value);

        if (!newApiBase) {
            $("settingsMessage").textContent =
                "Please enter a valid backend URL.";
            return;
        }

        if (!Number.isFinite(newInterval) || newInterval < 5) {
            $("settingsMessage").textContent =
                "Refresh interval must be at least 5 seconds.";
            return;
        }

        API_BASE = newApiBase.replace(/\/$/, "");
        REFRESH_INTERVAL = newInterval;

        localStorage.setItem("aqua_ai_api_base", API_BASE);
        localStorage.setItem(
            "aqua_ai_refresh_interval",
            String(REFRESH_INTERVAL)
        );

        $("settingsMessage").textContent =
            "Settings saved successfully.";

        startAutoRefresh();
        loadReadings();
    });
}

function loadSettingsIntoForm() {
    $("apiBaseInput").value = API_BASE;
    $("refreshIntervalInput").value = REFRESH_INTERVAL;
}

/* =========================================================
   REFRESH
   ========================================================= */

function setupRefresh() {
    $("refreshButton").addEventListener("click", loadReadings);
}

function startAutoRefresh() {
    if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
    }

    state.refreshTimer = setInterval(
        loadReadings,
        REFRESH_INTERVAL * 1000
    );
}

/* =========================================================
   CONNECTION STATUS
   ========================================================= */

function setConnectionState(status) {
    const dot = $("connectionDot");
    const text = $("connectionText");
    const subtext = $("connectionSubtext");

    dot.classList.remove("online", "offline");

    if (status === "online") {
        dot.classList.add("online");
        text.textContent = "Backend online";
        subtext.textContent = "Sensor data available";
    } else if (status === "offline") {
        dot.classList.add("offline");
        text.textContent = "Backend offline";
        subtext.textContent = "Unable to load readings";
    } else {
        text.textContent = "Connecting...";
        subtext.textContent = "Checking backend";
    }
}

/* =========================================================
   UTILITIES
   ========================================================= */

function setText(id, value) {
    const element = $(id);

    if (element) {
        element.textContent =
            value === null || value === undefined
                ? "--"
                : String(value);
    }
}

function formatNumber(value) {
    if (value === null || value === undefined) {
        return "--";
    }

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "--";
    }

    return number.toFixed(2);
}

function formatDateTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "--";
    }

    return date.toLocaleString();
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}