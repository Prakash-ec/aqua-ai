/* =========================================================
   AQUA AI FRONTEND
   ========================================================= */

"use strict";


/* =========================================================
   CONFIGURATION
   ========================================================= */

const API_BASE =
    "https://aqua-ai-wz4s.onrender.com";

const READINGS_ENDPOINT =
    `${API_BASE}/readings/`;

const CAMERA_ENDPOINT =
    `${API_BASE}/camera/analyze`;

const CHAT_ENDPOINT =
    `${API_BASE}/chat/water`;


/* =========================================================
   STATE
   ========================================================= */

let latestReading = null;

let readingsHistory = [];

let cameraStream = null;

let selectedImage = null;

let dashboardChart = null;

let temperatureChart = null;

let phChart = null;

let turbidityChart = null;

let tdsChart = null;


/* =========================================================
   DOM HELPERS
   ========================================================= */

function $(id) {
    return document.getElementById(id);
}


function setText(id, value) {

    const element = $(id);

    if (element) {
        element.textContent =
            value ?? "--";
    }
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function setupNavigation() {

    const navButtons =
        document.querySelectorAll(".nav-item");

    navButtons.forEach(button => {

        button.addEventListener(
            "click",
            () => {

                const page =
                    button.dataset.page;

                showPage(page);

            }
        );

    });


    const pageLinks =
        document.querySelectorAll("[data-page-link]");

    pageLinks.forEach(button => {

        button.addEventListener(
            "click",
            () => {

                showPage(
                    button.dataset.pageLink
                );

            }
        );

    });

}


function showPage(pageName) {

    document
        .querySelectorAll(".page")
        .forEach(page => {

            page.classList.remove(
                "active-page"
            );

        });


    const selectedPage =
        $(`page-${pageName}`);

    if (selectedPage) {

        selectedPage.classList.add(
            "active-page"
        );

    }


    document
        .querySelectorAll(".nav-item")
        .forEach(button => {

            button.classList.toggle(
                "active",
                button.dataset.page === pageName
            );

        });


    if (pageName === "temperature") {

        updateParameterChart(
            "temperature"
        );

    }

    if (pageName === "ph") {

        updateParameterChart(
            "ph"
        );

    }

    if (pageName === "turbidity") {

        updateParameterChart(
            "turbidity"
        );

    }

    if (pageName === "tds") {

        updateParameterChart(
            "tds"
        );

    }

}


/* =========================================================
   CONNECTION STATUS
   ========================================================= */

function setConnectionStatus(
    connected,
    message = ""
) {

    const dot =
        $("connectionDot");

    const text =
        $("connectionText");

    const time =
        $("connectionTime");


    if (!dot || !text) {
        return;
    }


    if (connected) {

        dot.classList.remove(
            "offline"
        );

        dot.classList.add(
            "online"
        );

        text.textContent =
            "Backend Connected";

        if (time) {

            time.textContent =
                message ||
                "Aqua AI server online";

        }

    } else {

        dot.classList.remove(
            "online"
        );

        dot.classList.add(
            "offline"
        );

        text.textContent =
            "Backend Offline";

        if (time) {

            time.textContent =
                message ||
                "Unable to connect";

        }

    }

}


/* =========================================================
   FETCH READINGS
   ========================================================= */

async function fetchReadings() {

    // indicate loading in header
    const headerStamp = $("headerLastUpdated");
    if (headerStamp) headerStamp.textContent = 'Updating...';

    try {

        // lightweight console message only on debug builds

        const response = await fetch(READINGS_ENDPOINT, { method: 'GET', headers: { Accept: 'application/json' } });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        setConnectionStatus(true, `Updated ${new Date().toLocaleTimeString()}`);

        normalizeReadings(data);

        if (headerStamp) headerStamp.textContent = `Last updated: ${new Date().toLocaleString()}`;

    } catch (error) {

        // user-friendly error handling
        setConnectionStatus(false, 'Unable to reach backend');

        setText('qualityTitle', 'Unable to read sensor data');
        setText('qualityMessage', 'Check the Aqua AI backend and ESP32 connection.');

        const header = $("headerLastUpdated");
        if (header) header.textContent = 'Last update failed';

    }

}


/* =========================================================
   NORMALIZE READINGS
   ========================================================= */

function normalizeReadings(data) {

    let rows = [];


    if (Array.isArray(data)) {

        rows = data;

    } else if (
        data &&
        Array.isArray(data.readings)
    ) {

        rows = data.readings;

    } else if (
        data &&
        Array.isArray(data.data)
    ) {

        rows = data.data;

    } else if (
        data &&
        data.reading
    ) {

        rows = [data.reading];

    } else if (
        data &&
        typeof data === "object"
    ) {

        rows = [data];

    }


    rows = rows.filter(
        item =>
            item &&
            typeof item === "object"
    );


    if (!rows.length) {

        console.warn(
            "No readings found."
        );

        return;
    }


    rows = rows.map(
        normalizeReading
    );


    rows.sort(
        (a, b) =>
            getTimestamp(b) -
            getTimestamp(a)
    );


    readingsHistory =
        rows;


    latestReading =
        rows[0];


    updateDashboard();

    updateCharts();

    updateReadingsTable();

}


/* =========================================================
   NORMALIZE SINGLE READING
   ========================================================= */

function normalizeReading(row) {

    return {

        id:
            row.id ??
            row.reading_id ??
            row.readingId ??
            null,

        device_id:
            row.device_id ??
            row.deviceId ??
            null,

        temperature:
            numberOrNull(
                row.temperature
            ),

        ph:
            numberOrNull(
                row.ph ??
                row.pH
            ),

        turbidity:
            numberOrNull(
                row.turbidity
            ),

        tds:
            numberOrNull(
                row.tds ??
                row.TDS
            ),

        recorded_at:
            row.recorded_at ??
            row.recordedAt ??
            row.timestamp ??
            row.created_at ??
            null,

        location:
            row.location ??
            null,

        device_name:
            row.device_name ??
            row.deviceName ??
            null

    };

}


/* =========================================================
   NUMBER HELPER
   ========================================================= */

function numberOrNull(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {

        return null;

    }


    const number =
        Number(value);


    return Number.isFinite(number)
        ? number
        : null;

}


/* =========================================================
   TIMESTAMP
   ========================================================= */

function getTimestamp(reading) {

    if (!reading) {
        return 0;
    }


    const value =
        reading.recorded_at;


    if (!value) {
        return 0;
    }


    const timestamp =
        new Date(value).getTime();


    return Number.isFinite(timestamp)
        ? timestamp
        : 0;

}


/* =========================================================
   FORMAT TIME
   ========================================================= */

function formatTime(value) {

    if (!value) {
        return "--";
    }


    const date =
        new Date(value);


    if (Number.isNaN(
        date.getTime()
    )) {

        return String(value);

    }


    return date.toLocaleString();

}


/* =========================================================
   DASHBOARD
   ========================================================= */

function updateDashboard() {

    if (!latestReading) {
        return;
    }


    const r =
        latestReading;


    setText(
        "temperatureValue",
        formatNumber(r.temperature)
    );

    setText(
        "phValue",
        formatNumber(r.ph)
    );

    setText(
        "turbidityValue",
        formatNumber(r.turbidity)
    );

    setText(
        "tdsValue",
        formatNumber(r.tds)
    );


    setText(
        "temperatureTime",
        formatTime(r.recorded_at)
    );

    setText(
        "phTime",
        formatTime(r.recorded_at)
    );

    setText(
        "turbidityTime",
        formatTime(r.recorded_at)
    );

    setText(
        "tdsTime",
        formatTime(r.recorded_at)
    );


    setText(
        "temperatureDetail",
        `${formatNumber(r.temperature)} °C`
    );

    setText(
        "phDetail",
        formatNumber(r.ph)
    );

    setText(
        "turbidityDetail",
        `${formatNumber(r.turbidity)} NTU`
    );

    setText(
        "tdsDetail",
        `${formatNumber(r.tds)} ppm`
    );


    updateParameterStatus(
        r
    );


    updateDeviceInformation(
        r
    );


    updateQuality(
        r
    );

    // update trend indicators based on the most recent two readings
    updateTrendIndicators();

    // header last-updated stamp
    const last = $("headerLastUpdated");
    if (last) last.textContent = `Last updated: ${new Date().toLocaleString()}`;

}


/* =========================================================
   FORMAT NUMBER
   ========================================================= */

function formatNumber(value) {

    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(Number(value))
    ) {

        return "--";

    }


    return Number(value)
        .toFixed(2)
        .replace(/\.00$/, "");

}


/* =========================================================
   PARAMETER STATUS
   ========================================================= */

function updateParameterStatus(r) {

    const temperatureStatus =
        temperatureState(
            r.temperature
        );

    const phStatus =
        phState(
            r.ph
        );

    const turbidityStatus =
        turbidityState(
            r.turbidity
        );

    const tdsStatus =
        tdsState(
            r.tds
        );


    setStatusPill(
        "temperatureStatus",
        temperatureStatus
    );

    setStatusPill(
        "phStatus",
        phStatus
    );

    setStatusPill(
        "turbidityStatus",
        turbidityStatus
    );

    setStatusPill(
        "tdsStatus",
        tdsStatus
    );


    setText(
        "temperatureDetailStatus",
        temperatureStatus
    );

    setText(
        "phDetailStatus",
        phStatus
    );

    setText(
        "turbidityDetailStatus",
        turbidityStatus
    );

    setText(
        "tdsDetailStatus",
        tdsStatus
    );

}


function setStatusPill(
    id,
    status
) {

    const element =
        $(id);

    if (!element) {
        return;
    }


    element.textContent =
        status.label;

}


/* =========================================================
   PARAMETER LOGIC
   ========================================================= */

function temperatureState(value) {

    if (value === null) {

        return {
            label: "NO DATA",
            level: "unknown"
        };

    }


    if (
        value >= 20 &&
        value <= 30
    ) {

        return {
            label: "NORMAL",
            level: "good"
        };

    }


    if (
        value >= 15 &&
        value <= 35
    ) {

        return {
            label: "WATCH",
            level: "warning"
        };

    }


    return {
        label: "HIGH",
        level: "danger"
    };

}


function phState(value) {

    if (value === null) {

        return {
            label: "NO DATA",
            level: "unknown"
        };

    }


    if (
        value >= 6.5 &&
        value <= 8.5
    ) {

        return {
            label: "NORMAL",
            level: "good"
        };

    }


    if (
        value >= 6 &&
        value <= 9
    ) {

        return {
            label: "WATCH",
            level: "warning"
        };

    }


    return {
        label: "ABNORMAL",
        level: "danger"
    };

}


function turbidityState(value) {

    if (value === null) {

        return {
            label: "NO DATA",
            level: "unknown"
        };

    }


    if (value <= 5) {

        return {
            label: "CLEAR",
            level: "good"
        };

    }


    if (value <= 10) {

        return {
            label: "WATCH",
            level: "warning"
        };

    }


    return {
        label: "HIGH",
        level: "danger"
    };

}


function tdsState(value) {

    if (value === null) {

        return {
            label: "NO DATA",
            level: "unknown"
        };

    }


    if (value <= 300) {

        return {
            label: "GOOD",
            level: "good"
        };

    }


    if (value <= 600) {

        return {
            label: "WATCH",
            level: "warning"
        };

    }


    return {
        label: "HIGH",
        level: "danger"
    };

}


/* =========================================================
   QUALITY SCORE
   ========================================================= */

function updateQuality(r) {

    const states = [

        temperatureState(
            r.temperature
        ),

        phState(
            r.ph
        ),

        turbidityState(
            r.turbidity
        ),

        tdsState(
            r.tds
        )

    ];


    let score = 100;


    states.forEach(
        state => {

            if (
                state.level === "warning"
            ) {

                score -= 15;

            }

            if (
                state.level === "danger"
            ) {

                score -= 30;

            }

            if (
                state.level === "unknown"
            ) {

                score -= 20;

            }

        }
    );


    score =
        Math.max(
            0,
            Math.min(
                100,
                score
            )
        );


    setText(
        "qualityScore",
        score
    );


    const badge =
        $("qualityBadge");

    const title =
        $("qualityTitle");

    const message =
        $("qualityMessage");


    if (
        !badge ||
        !title ||
        !message
    ) {

        return;

    }


    badge.className =
        "quality-badge";


    if (score >= 80) {

        badge.classList.add(
            "good"
        );

        badge.textContent =
            "GOOD";

        title.textContent =
            "Water parameters look good";

        message.textContent =
            "The available sensor parameters are currently within the configured monitoring ranges.";

    } else if (score >= 55) {

        badge.classList.add(
            "warning"
        );

        badge.textContent =
            "WATCH";

        title.textContent =
            "Some parameters need attention";

        message.textContent =
            "One or more readings are outside the preferred range. Continue monitoring.";

    } else {

        badge.classList.add(
            "danger"
        );

        badge.textContent =
            "ALERT";

        title.textContent =
            "Water quality requires attention";

        message.textContent =
            "Multiple sensor parameters indicate values outside the configured monitoring ranges.";

    }

}


/* =========================================================
   DEVICE
   ========================================================= */

function updateDeviceInformation(r) {

    setText(
        "deviceId",
        r.device_id
    );

    setText(
        "readingId",
        r.id
    );

    setText(
        "recordedAt",
        formatTime(r.recorded_at)
    );

    setText(
        "updatedAt",
        new Date().toLocaleString()
    );


    setText(
        "dashboardDeviceId",
        r.device_id
    );

    setText(
        "dashboardReadingId",
        r.id
    );

    setText(
        "dashboardLocation",
        r.location || "Coimbatore"
    );

    setText(
        "dashboardUpdated",
        formatTime(r.recorded_at)
    );

    setText(
        "deviceName",
        r.device_name ||
        "Aqua ESP32"
    );

    setText(
        "deviceLocation",
        r.location ||
        "Coimbatore"
    );


    const badge =
        $("deviceStatusBadge");


    if (badge) {

        badge.className =
            "quality-badge good";

        badge.textContent =
            "ONLINE";

    }


    setText(
        "backendStatusText",
        "Backend Connected"
    );

    setText(
        "backendStatusMessage",
        "Connected to Aqua AI Render server."
    );

}


/* =========================================================
   READINGS TABLE
   ========================================================= */

function updateReadingsTable() {

    const tbody =
        $("readingsTableBody");


    if (!tbody) {
        return;
    }


    if (!readingsHistory.length) {

        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-table">
                    No readings available.
                </td>
            </tr>
        `;

        return;
    }


    const rows =
        readingsHistory
            .slice(0, 10)
            .map(
                reading => {

                    return `
                        <tr>
                            <td>
                                ${escapeHTML(
                                    reading.id
                                )}
                            </td>

                            <td>
                                ${formatNumber(
                                    reading.temperature
                                )} °C
                            </td>

                            <td>
                                ${formatNumber(
                                    reading.ph
                                )}
                            </td>

                            <td>
                                ${formatNumber(
                                    reading.turbidity
                                )} NTU
                            </td>

                            <td>
                                ${formatNumber(
                                    reading.tds
                                )} ppm
                            </td>

                            <td>
                                ${escapeHTML(
                                    formatTime(
                                        reading.recorded_at
                                    )
                                )}
                            </td>
                        </tr>
                    `;

                }
            )
            .join("");


    tbody.innerHTML =
        rows;

}


/* =========================================================
   ESCAPE HTML
   ========================================================= */

function escapeHTML(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return "--";

    }


    return String(value)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );

}


/* =========================================================
   CHART DATA
   ========================================================= */

function historyLabels() {

    return readingsHistory
        .slice()
        .reverse()
        .map(
            reading =>
                formatShortTime(
                    reading.recorded_at
                )
        );

}


function formatShortTime(value) {

    if (!value) {
        return "--";
    }


    const date =
        new Date(value);


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "--";

    }


    return date.toLocaleTimeString(
        [],
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );

}


function valuesFor(parameter) {

    return readingsHistory
        .slice()
        .reverse()
        .map(
            reading =>
                reading[parameter]
        );

}


/* =========================================================
   CHART CREATOR
   ========================================================= */

function createChart(
    canvasId,
    parameter,
    label,
    unit
) {

    const canvas =
        $(canvasId);


    if (!canvas) {
        return null;
    }


    if (
        typeof Chart ===
        "undefined"
    ) {

        console.warn(
            "Chart.js not loaded."
        );

        return null;

    }


    const existing =
        Chart.getChart(canvas);


    if (existing) {

        existing.destroy();

    }


    return new Chart(
        canvas,
        {

            type: "line",

            data: {

                labels:
                    historyLabels(),

                datasets: [

                    {

                        label:
                            `${label} (${unit})`,

                        data:
                            valuesFor(
                                parameter
                            ),

                        borderColor:
                            "#087f8c",

                        backgroundColor:
                            "rgba(8,127,140,0.08)",

                        fill: true,

                        tension: 0.35,

                        pointRadius: 3,

                        pointHoverRadius: 5

                    }

                ]

            },

            options: {

                responsive: true,

                maintainAspectRatio:
                    false,

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

                        beginAtZero:
                            false,

                        grid: {

                            color:
                                "#edf1f4"

                        }

                    },

                    x: {

                        grid: {

                            display:
                                false

                        }

                    }

                }

            }

        }
    );

}


/* =========================================================
   UPDATE CHARTS
   ========================================================= */

function updateCharts() {

    if (!readingsHistory.length) {
        return;
    }


    dashboardChart =
        createChart(
            "dashboardChart",
            "temperature",
            "Temperature",
            "°C"
        );


    updateParameterChart(
        "temperature"
    );

    updateParameterChart(
        "ph"
    );

    updateParameterChart(
        "turbidity"
    );

    updateParameterChart(
        "tds"
    );

}


function updateParameterChart(
    parameter
) {

    if (!readingsHistory.length) {
        return;
    }


    if (parameter === "temperature") {

        temperatureChart =
            createChart(
                "temperatureChart",
                "temperature",
                "Temperature",
                "°C"
            );

    }


    if (parameter === "ph") {

        phChart =
            createChart(
                "phChart",
                "ph",
                "pH",
                "pH"
            );

    }


    if (parameter === "turbidity") {

        turbidityChart =
            createChart(
                "turbidityChart",
                "turbidity",
                "Turbidity",
                "NTU"
            );

    }


    if (parameter === "tds") {

        tdsChart =
            createChart(
                "tdsChart",
                "tds",
                "TDS",
                "ppm"
            );

    }

}


/* =========================================================
   CHART FILTERS & TREND HELPERS
   ========================================================= */

/* =========================================================
   CHATBOT (Dashboard)
   ========================================================= */

const CHAT_SESSION_KEY = 'aqua_ai_chat_history';

function loadChatHistory() {
    try {
        const raw = sessionStorage.getItem(CHAT_SESSION_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function saveChatHistory(history) {
    try {
        // keep last 20 messages to limit storage
        const truncated = history.slice(-40);
        sessionStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(truncated));
    } catch (e) {
        // ignore
    }
}

function renderConversation() {
    const container = $('chatMessages');
    if (!container) return;
    const history = loadChatHistory();
    container.innerHTML = history.map(item => {
        const who = item.role === 'user' ? 'user' : 'ai';
        const time = item.time || '';
        const meta = item.role === 'user' ? 'You' : 'Aqua AI';
        const text = escapeHTML(item.text).replace(/\n/g, '<br>');
        if (who === 'user') {
            return `<div class="chat-message user"><div class="meta">${meta} ${time}</div><div class="bubble">${text}</div></div>`;
        } else {
            return `<div class="chat-message ai"><div class="meta">${meta} ${time}</div><div class="bubble">${text}</div></div>`;
        }
    }).join('');

    // scroll to bottom
    container.scrollTop = container.scrollHeight;
}

async function sendChatMessage(text) {
    const input = $('chatInput');
    const sendBtn = $('chatSendButton');
    const loading = $('chatLoading');
    if (!text || !text.trim()) return;

    // update history with user message
    const history = loadChatHistory();
    const userMsg = { role: 'user', text: text.trim(), time: new Date().toLocaleString() };
    history.push(userMsg);
    saveChatHistory(history);
    renderConversation();

    // show loading
    sendBtn.disabled = true;
    loading.classList.remove('hidden');

    try {
        const response = await fetch(CHAT_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ question: text.trim() })
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(errText || `HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data || !data.success) {
            const msg = data && data.answer ? data.answer : 'AI did not return a valid response.';
            throw new Error(msg);
        }

        const aiMsg = { role: 'ai', text: data.answer || 'No answer', time: new Date().toLocaleString(), model: data.model };
        const newHistory = loadChatHistory();
        newHistory.push(aiMsg);
        saveChatHistory(newHistory);
        renderConversation();

    } catch (error) {
        const historyErr = loadChatHistory();
        historyErr.push({ role: 'ai', text: 'Error: Unable to get answer. ' + (error.message || ''), time: new Date().toLocaleString() });
        saveChatHistory(historyErr);
        renderConversation();
    } finally {
        sendBtn.disabled = false;
        loading.classList.add('hidden');
        if (input) input.focus();
    }
}

function setupChat() {
    const input = $('chatInput');
    const sendBtn = $('chatSendButton');

    renderConversation();

    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            const val = input ? input.value : '';
            if (val && val.trim()) {
                if (input) input.value = '';
                sendChatMessage(val);
            }
        });
    }

    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const val = input.value;
                if (val && val.trim()) {
                    input.value = '';
                    sendChatMessage(val);
                }
            }
        });
    }
}

/* =========================================================
   CHART FILTERS & TREND HELPERS
   ========================================================= */

function computeTrend(parameter) {
    if (!readingsHistory || readingsHistory.length < 2) return "--";
    const latest = numberOrNull(readingsHistory[0][parameter]);
    const prev = numberOrNull(readingsHistory[1][parameter]);
    if (latest === null || prev === null) return "--";
    if (prev === 0) return "--";
    const pct = ((latest - prev) / Math.abs(prev)) * 100;
    const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
    return `${arrow} ${Math.abs(pct).toFixed(1)}%`;
}

function updateTrendIndicators() {
    try {
        setText('temperatureTrend', computeTrend('temperature'));
        setText('phTrend', computeTrend('ph'));
        setText('turbidityTrend', computeTrend('turbidity'));
        setText('tdsTrend', computeTrend('tds'));
    } catch (e) {
        // silent fail - non-critical UI enhancement
    }
}

function filterHistoryByRange(rangeKey) {
    if (!readingsHistory || readingsHistory.length === 0) return [];
    const now = Date.now();
    let cutoff = 0;
    switch (rangeKey) {
        case '1H': cutoff = now - 1000 * 60 * 60; break;
        case '6H': cutoff = now - 1000 * 60 * 60 * 6; break;
        case '24H': cutoff = now - 1000 * 60 * 60 * 24; break;
        case '7D': cutoff = now - 1000 * 60 * 60 * 24 * 7; break;
        case '30D': cutoff = now - 1000 * 60 * 60 * 24 * 30; break;
        default: cutoff = 0;
    }

    if (cutoff === 0) return readingsHistory.slice();

    return readingsHistory.filter(r => {
        const ts = getTimestamp(r);
        return ts >= cutoff;
    });
}

function createChartFromHistory(canvasId, parameter, label, unit, history) {
    const canvas = $(canvasId);
    if (!canvas) return null;
    if (typeof Chart === 'undefined') return null;

    const source = history || readingsHistory || [];
    const labels = source.slice().reverse().map(r => formatShortTime(r.recorded_at));
    const data = source.slice().reverse().map(r => r[parameter]);

    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    const cfg = {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: `${label} (${unit})`,
                    data,
                    borderColor: '#087f8c',
                    backgroundColor: 'rgba(8,127,140,0.08)',
                    fill: true,
                    tension: 0.35,
                    pointRadius: 3,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: { legend: { display: true } },
            scales: {
                y: { beginAtZero: false, grid: { color: '#edf1f4' } },
                x: { grid: { display: false } }
            }
        }
    };

    return new Chart(canvas, cfg);
}

function applyDashboardTimeFilter(filterKey) {
    const history = filterHistoryByRange(filterKey);
    // update dashboard quick chart (temperature) using filtered history if available
    dashboardChart = createChartFromHistory('dashboardChart', 'temperature', 'Temperature', '°C', history);
    // update trends page charts if user navigates there
    createChartFromHistory('trendsTemperatureChart', 'temperature', 'Temperature', '°C', history);
    createChartFromHistory('trendsPhChart', 'ph', 'pH', 'pH', history);
    createChartFromHistory('trendsTurbidityChart', 'turbidity', 'Turbidity', 'NTU', history);
    createChartFromHistory('trendsTdsChart', 'tds', 'TDS', 'ppm', history);
}

/* =========================================================
   CAMERA MODE
   ========================================================= */

function setupCameraModes() {

    const uploadButton =
        $("uploadModeButton");

    const liveButton =
        $("liveModeButton");


    uploadButton?.addEventListener(
        "click",
        () => {

            uploadButton.classList.add(
                "active"
            );

            liveButton.classList.remove(
                "active"
            );


            $("uploadMode")
                ?.classList.add(
                    "active"
                );

            $("liveMode")
                ?.classList.remove(
                    "active"
                );

        }
    );


    liveButton?.addEventListener(
        "click",
        () => {

            liveButton.classList.add(
                "active"
            );

            uploadButton.classList.remove(
                "active"
            );


            $("liveMode")
                ?.classList.add(
                    "active"
                );

            $("uploadMode")
                ?.classList.remove(
                    "active"
                );

        }
    );

}


/* =========================================================
   IMAGE UPLOAD
   ========================================================= */

function setupImageUpload() {

    const input = $("imageInput");
    const uploadArea = $("uploadArea");
    const previewContainer = $("imagePreviewContainer");
    const previewImage = $("imagePreview");
    const clearBtn = $("clearImageButton");
    const modelSelect = $("aiModelSelector");

    if (modelSelect) {
        // only one model available for now - mark as active
        modelSelect.disabled = true;
    }

    if (!input || !uploadArea) return;

    input.addEventListener('change', event => {
        const file = event.target.files?.[0];
        handleSelectedFile(file);
    });

    // drag and drop support
    uploadArea.addEventListener('dragover', ev => {
        ev.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', ev => {
        uploadArea.classList.remove('dragover');
    });
    uploadArea.addEventListener('drop', ev => {
        ev.preventDefault();
        uploadArea.classList.remove('dragover');
        const file = ev.dataTransfer.files?.[0];
        handleSelectedFile(file);
    });

    function handleSelectedFile(file) {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showAIError('Please select an image file.');
            return;
        }
        selectedImage = file;
        const url = URL.createObjectURL(file);
        if (previewImage) previewImage.src = url;
        if (previewContainer) previewContainer.classList.remove('hidden');
        clearAIResult();
    }

    $("analyzeUploadButton")?.addEventListener('click', () => {
        if (!selectedImage) {
            showAIError('Please select an image first.');
            return;
        }
        analyzeImage(selectedImage);
    });

    clearBtn?.addEventListener('click', () => {
        selectedImage = null;
        if (previewImage) previewImage.src = '';
        previewContainer?.classList.add('hidden');
        clearAIError();
        clearAIResult();
        $("imageInput").value = '';
    });

}


/* =========================================================
   LIVE CAMERA
   ========================================================= */

function setupLiveCamera() {

    $("startCameraButton")
        ?.addEventListener(
            "click",
            startCamera
        );


    $("captureButton")
        ?.addEventListener(
            "click",
            captureAndAnalyze
        );


    $("stopCameraButton")
        ?.addEventListener(
            "click",
            stopCamera
        );

}


async function startCamera() {

    try {

        clearAIError();


        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia
        ) {

            throw new Error(
                "Camera access is not supported by this browser."
            );

        }


        cameraStream =
            await navigator.mediaDevices
                .getUserMedia(
                    {
                        video: {
                            facingMode:
                                "environment"
                        },

                        audio: false
                    }
                );


        const video =
            $("cameraVideo");


        video.srcObject =
            cameraStream;


        video.style.display =
            "block";


        $("cameraPlaceholder")
            ?.classList.add(
                "hidden"
            );


        $("captureButton").disabled =
            false;

        $("stopCameraButton").disabled =
            false;

        $("startCameraButton").disabled =
            true;


    } catch (error) {

        console.error(
            "Camera error:",
            error
        );


        showAIError(
            `Camera error: ${error.message}`
        );

    }

}


function stopCamera() {

    if (cameraStream) {

        cameraStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );

        cameraStream =
            null;

    }


    const video =
        $("cameraVideo");


    if (video) {

        video.srcObject =
            null;

        video.style.display =
            "none";

    }


    $("cameraPlaceholder")
        ?.classList.remove(
            "hidden"
        );


    $("captureButton").disabled =
        true;

    $("stopCameraButton").disabled =
        true;

    $("startCameraButton").disabled =
        false;

}


async function captureAndAnalyze() {

    const video =
        $("cameraVideo");

    const canvas =
        $("cameraCanvas");


    if (
        !video ||
        !canvas
    ) {

        return;

    }


    if (
        video.videoWidth === 0 ||
        video.videoHeight === 0
    ) {

        showAIError(
            "Camera image is not ready."
        );

        return;

    }


    canvas.width =
        video.videoWidth;

    canvas.height =
        video.videoHeight;


    const context =
        canvas.getContext(
            "2d"
        );


    context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
    );


    canvas.toBlob(
        blob => {

            if (!blob) {

                showAIError(
                    "Unable to capture camera image."
                );

                return;

            }


            const file =
                new File(
                    [blob],
                    "camera-capture.jpg",
                    {
                        type:
                            "image/jpeg"
                    }
                );


            analyzeImage(
                file
            );

        },
        "image/jpeg",
        0.88
    );

}


/* =========================================================
   AI ANALYSIS
   ========================================================= */

async function analyzeImage(
    file
) {

    clearAIError();

    showAILoading(true);

    clearAIResult();


    try {

        const formData =
            new FormData();


        formData.append(
            "image",
            file
        );


        console.log(
            "Sending image to:",
            CAMERA_ENDPOINT
        );


        const response =
            await fetch(
                CAMERA_ENDPOINT,
                {
                    method: "POST",
                    body: formData
                }
            );


        console.log(
            "AI HTTP status:",
            response.status
        );


        let data;


        try {

            data =
                await response.json();

        } catch {

            throw new Error(
                "Server returned an invalid response."
            );

        }


        console.log(
            "AI response:",
            data
        );


        if (!response.ok) {

            throw new Error(
                data.detail ||
                `AI request failed (${response.status})`
            );

        }


        if (!data.success) {

            throw new Error(
                "AI analysis was not successful."
            );

        }


        const analysis =
            data.analysis ||
            data;


        displayAIResult(
            analysis
        );


    } catch (error) {

        console.error(
            "AI analysis error:",
            error
        );


        showAIError(
            error.message ||
            "Unable to analyze image."
        );

    } finally {

        showAILoading(false);

    }

}


/* =========================================================
   DISPLAY AI RESULT
   ========================================================= */

function displayAIResult(
    result
) {

    $("aiResult")
        ?.classList.remove(
            "hidden"
        );


    setText(
        "aiConfidence",
        `${result.confidence ?? 0}%`
    );


    setText(
        "aiObservation",
        result.overall_observation ||
        "--"
    );


    setText(
        "aiOil",
        result.oil_sheen ||
        "--"
    );


    setText(
        "aiAlgae",
        result.algae ||
        "--"
    );


    setText(
        "aiFoam",
        result.foam ||
        "--"
    );


    setText(
        "aiParticles",
        result.floating_particles ||
        "--"
    );


    setText(
        "aiAppearance",
        result.water_appearance ||
        "--"
    );


    setText(
        "aiConcern",
        result.pollution_concern ||
        "--"
    );


    setText(
        "aiRecommendation",
        result.recommendation ||
        "--"
    );


    setText(
        "aiLimitations",
        result.limitations ||
        "--"
    );


    $("aiResult")
        ?.scrollIntoView(
            {
                behavior:
                    "smooth",
                block:
                    "start"
            }
        );

}


/* =========================================================
   AI UI
   ========================================================= */

function showAILoading(
    visible
) {

    $("aiLoading")
        ?.classList.toggle(
            "hidden",
            !visible
        );

}


function showAIError(
    message
) {

    const box =
        $("aiError");


    if (!box) {
        return;
    }


    box.textContent =
        message;


    box.classList.remove(
        "hidden"
    );

}


function clearAIError() {

    $("aiError")
        ?.classList.add(
            "hidden"
        );

}


function clearAIResult() {

    $("aiResult")
        ?.classList.add(
            "hidden"
        );

}


/* =========================================================
   REFRESH
   ========================================================= */

function setupRefresh() {

    async function doRefresh(buttonId) {
        const button = $(buttonId);
        if (button) {
            button.disabled = true;
            button.textContent = "↻ Loading...";
        }
        try {
            await fetchReadings();
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = buttonId === 'headerRefreshButton' ? '↻ Refresh' : '↻ Refresh';
            }
        }
    }

    $("refreshButton")?.addEventListener("click", () => doRefresh('refreshButton'));

    // header refresh button (new)
    $("headerRefreshButton")?.addEventListener("click", () => doRefresh('headerRefreshButton'));

    // Time filter buttons (dashboard)
    document.querySelectorAll('.time-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.time-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filter = btn.dataset.filter;
            applyDashboardTimeFilter(filter);
        });
    });

}


/* =========================================================
   AUTO REFRESH
   ========================================================= */

function startAutoRefresh() {

    setInterval(
        fetchReadings,
        15000
    );

}


/* =========================================================
   INITIALIZATION
   ========================================================= */

async function initialize() {

    console.log(
        "Aqua AI frontend starting..."
    );


    setupNavigation();

    setupCameraModes();

    setupImageUpload();

    setupLiveCamera();

    setupRefresh();


    await fetchReadings();

    // initialize chat panel
    setupChat();

    // apply a sensible default time filter if there is data
    applyDashboardTimeFilter('24H');

    startAutoRefresh();


    console.log(
        "Aqua AI frontend ready."
    );

}


/* =========================================================
   START
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    initialize
);