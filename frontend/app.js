// ==========================================
// AQUA AI FRONTEND
// ==========================================

// Render backend
const API_URL = "https://aqua-ai-wz4s.onrender.com";


// ==========================================
// LOAD LATEST READING
// ==========================================

async function loadData() {

    try {

        console.log("Fetching Aqua AI data...");

        const response = await fetch(
            `${API_URL}/readings/`
        );

        if (!response.ok) {
            throw new Error(
                `Backend returned HTTP ${response.status}`
            );
        }

        const readings = await response.json();

        console.log("Backend data:", readings);


        // --------------------------------------
        // Check data
        // --------------------------------------

        if (!Array.isArray(readings) || readings.length === 0) {
            throw new Error("No readings found");
        }


        // Backend already sends newest first
        const latest = readings[0];

        console.log("LATEST READING:", latest);


        // --------------------------------------
        // SENSOR VALUES
        // --------------------------------------

        setValue(
            "temperature",
            Number(latest.temperature).toFixed(1)
        );

        setValue(
            "ph",
            Number(latest.ph).toFixed(2)
        );

        setValue(
            "turbidity",
            Number(latest.turbidity).toFixed(1)
        );

        setValue(
            "tds",
            Number(latest.tds).toFixed(0)
        );


        // --------------------------------------
        // DEVICE INFORMATION
        // --------------------------------------

        setValue(
            "deviceId",
            latest.device_id
        );

        setValue(
            "readingId",
            latest.id
        );

        setValue(
            "recordedAt",
            formatDate(latest.recorded_at)
        );

        setValue(
            "updatedAt",
            new Date().toLocaleTimeString()
        );


        // --------------------------------------
        // CONNECTION STATUS
        // --------------------------------------

        const connection =
            document.getElementById("connectionStatus");

        if (connection) {

            connection.textContent = "● LIVE";

            connection.className = "status online";
        }


        // --------------------------------------
        // QUALITY STATUS
        // --------------------------------------

        updateQuality(
            Number(latest.temperature),
            Number(latest.ph),
            Number(latest.turbidity),
            Number(latest.tds)
        );


        console.log("Aqua AI dashboard updated successfully.");

    }

    catch (error) {

        console.error(
            "Aqua AI error:",
            error
        );


        // --------------------------------------
        // OFFLINE
        // --------------------------------------

        const connection =
            document.getElementById("connectionStatus");

        if (connection) {

            connection.textContent = "● OFFLINE";

            connection.className = "status offline";
        }


        setValue(
            "qualityStatus",
            "NO DATA"
        );

        setValue(
            "qualityMessage",
            "Unable to connect to Aqua AI backend."
        );
    }
}


// ==========================================
// SAFE HTML UPDATE
// ==========================================

function setValue(id, value) {

    const element =
        document.getElementById(id);

    if (element) {

        element.textContent = value;

    } else {

        console.warn(
            `HTML element #${id} not found`
        );
    }
}


// ==========================================
// FORMAT DATE
// ==========================================

function formatDate(dateString) {

    if (!dateString) {
        return "--";
    }

    const date =
        new Date(dateString);

    if (isNaN(date.getTime())) {
        return dateString;
    }

    return date.toLocaleString();
}


// ==========================================
// WATER QUALITY CHECK
// ==========================================

function updateQuality(
    temperature,
    ph,
    turbidity,
    tds
) {

    let status = "NORMAL";

    let message =
        "Current readings are within the configured test range.";


    // Demonstration thresholds only.
    // These are NOT official drinking-water standards.

    if (
        ph < 6.5 ||
        ph > 8.5 ||
        turbidity > 5 ||
        tds > 500
    ) {

        status = "WARNING";

        message =
            "One or more parameters are outside the configured test range.";
    }


    const badge =
        document.getElementById(
            "qualityStatus"
        );

    const messageElement =
        document.getElementById(
            "qualityMessage"
        );


    if (badge) {

        badge.textContent = status;

        if (status === "NORMAL") {

            badge.style.background = "#d9f7df";

            badge.style.color = "#14752a";

        } else {

            badge.style.background = "#fff1c7";

            badge.style.color = "#8a6200";
        }
    }


    if (messageElement) {

        messageElement.textContent =
            message;
    }
}


// ==========================================
// INITIAL LOAD
// ==========================================

loadData();


// ==========================================
// LIVE UPDATE
// ==========================================

// Fetch latest reading every 5 seconds

setInterval(
    loadData,
    5000
);