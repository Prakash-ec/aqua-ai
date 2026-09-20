}

// =========================================================
// ANALYSIS PAGE LOGIC
// ---------------------------------------------------------
// Data flow:
//   PostgreSQL -> GET /readings/latest -> apiRequest() ->
//   normalizeReadings() -> latestReading -> analysis calculations -> UI.
//
// Every screening reference used by this page lives in ANALYSIS_THRESHOLDS
// so the thresholds can be reviewed and adjusted in one place. Missing
// sensor values are never replaced with 0 and never invented.
// =========================================================

const ANALYSIS_THRESHOLDS = {
    ph: {
        min: 6.5,
        max: 8.5,
        cautionLow: 6.0,
        cautionHigh: 9.0
    },

    agriculturePh: {
        min: 6.5,
        max: 8.4
    },

    turbidity: {
        preferred: 1,
        acceptable: 5
    },

    tds: {
        reference: 500,
        agricultureModerate: 450,
        agricultureHigh: 2000
    },

    temperature: {
        monitoringMin: 5,
        monitoringMax: 35,
        alertMin: 0,
        alertMax: 45
    },

    dataFreshnessHours: 24
};

/* Sensor parameters exposed by the readings API. */
const ANALYSIS_PARAMETER_KEYS = ["temperature", "ph", "turbidity", "tds"];

/* ---- shared helpers ------------------------------------------------ */

/* Coerce a raw sensor value to a finite number; null when it is absent. */
function analysisNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function analysisRange(min, max) {
    return `${min}–${max}`;
}

function setAnalysisCondition(id, text, level) {
    const element = $(id);

    if (!element) {
        return;
    }

    element.textContent = text;
    element.className = `parameter-card-condition status-${level}`;
}

function setDerivedValue(id, text, level, detail = "") {
    const element = $(id);

    if (!element) {
        return;
    }

    element.textContent = text;
    element.className = `derived-value status-${level}`;

    if (detail) {
        element.title = detail;
    } else {
        element.removeAttribute("title");
    }
}

function setAnalysisHtml(id, html) {
    const element = $(id);

    if (element) {
        element.innerHTML = html;
    }
}

function setAnalysisNotice(html, level = "unknown") {
    const notice = $("analysisNotice");

    if (!notice) {
        return;
    }

    if (!html) {
        notice.className = "analysis-notice hidden";
        notice.innerHTML = "";
        return;
    }

    notice.className = `analysis-notice ${level}`;
    notice.innerHTML = html;
}

/* ---- parameter screening (transparent thresholds) ------------------ */

function analyzePh(value) {
    const ph = analysisNumber(value);
    const limits = ANALYSIS_THRESHOLDS.ph;

    if (ph === null) {
        return {
            key: "ph",
            name: "pH",
            available: false,
            value: null,
            condition: "Unavailable",
            level: "unknown",
            summary: "pH is not available in the latest reading."
        };
    }

    if (ph >= limits.min && ph <= limits.max) {
        return {
            key: "ph",
            name: "pH",
            available: true,
            value: ph,
            condition: "Normal",
            level: "good",
            summary: `pH ${ph.toFixed(2)} falls within the configured general screening range (${analysisRange(limits.min, limits.max)}).`
        };
    }

    const condition = ph < limits.min ? "Acidic" : "Alkaline";
    const direction = ph < limits.min ? "below" : "above";
    const withinCautionBand =
        ph >= limits.cautionLow && ph <= limits.cautionHigh;

    return {
        key: "ph",
        name: "pH",
        available: true,
        value: ph,
        condition,
        level: withinCautionBand ? "caution" : "alert",
        summary: withinCautionBand
            ? `pH ${ph.toFixed(2)} is ${direction} the configured general screening range (${analysisRange(limits.min, limits.max)}).`
            : `pH ${ph.toFixed(2)} is well ${direction} the configured general screening range (${analysisRange(limits.min, limits.max)}).`
    };
}

function analyzeTds(value) {
    const tds = analysisNumber(value);
    const limits = ANALYSIS_THRESHOLDS.tds;

    if (tds === null) {
        return {
            key: "tds",
            name: "TDS",
            available: false,
            value: null,
            condition: "Unavailable",
            level: "unknown",
            salinityIndication: "Unavailable",
            summary: "TDS is not available in the latest reading."
        };
    }

    let condition = "Normal";
    let level = "good";
    let salinityIndication = "No salinity restriction indicated";
    let summary = `TDS ${tds.toFixed(1)} mg/L is at or below the configured ${limits.reference} mg/L reference level.`;

    if (tds > limits.agricultureHigh) {
        condition = "High";
        level = "alert";
        salinityIndication = "Significant salinity concern";
        summary = `TDS ${tds.toFixed(1)} mg/L is above the configured ${limits.agricultureHigh} mg/L TDS-based salinity screening level.`;
    } else if (tds > limits.reference) {
        condition = "Elevated";
        level = "caution";
        salinityIndication = "Possible salinity concern";
        summary = `TDS ${tds.toFixed(1)} mg/L is above the configured ${limits.reference} mg/L reference level (elevated dissolved solids).`;
    } else if (tds > limits.agricultureModerate) {
        salinityIndication = "Possible salinity concern";
        summary = `TDS ${tds.toFixed(1)} mg/L is below the configured ${limits.reference} mg/L reference level, but above the configured ${limits.agricultureModerate} mg/L TDS-based salinity screening level.`;
    }

    return {
        key: "tds",
        name: "TDS",
        available: true,
        value: tds,
        condition,
        level,
        salinityIndication,
        summary
    };
}

function analyzeTurbidity(value) {
    const turbidity = analysisNumber(value);
    const limits = ANALYSIS_THRESHOLDS.turbidity;

    if (turbidity === null) {
        return {
            key: "turbidity",
            name: "Turbidity",
            available: false,
            value: null,
            condition: "Unavailable",
            level: "unknown",
            summary: "Turbidity is not available in the latest reading."
        };
    }

    if (turbidity <= limits.preferred) {
        return {
            key: "turbidity",
            name: "Turbidity",
            available: true,
            value: turbidity,
            condition: "Good",
            level: "good",
            summary: `Turbidity ${turbidity.toFixed(2)} NTU is at or below the preferred ${limits.preferred} NTU clarity target.`
        };
    }

    if (turbidity <= limits.acceptable) {
        return {
            key: "turbidity",
            name: "Turbidity",
            available: true,
            value: turbidity,
            condition: "Caution",
            level: "caution",
            summary: `Turbidity ${turbidity.toFixed(2)} NTU is above the preferred ${limits.preferred} NTU target, but within the broader ${limits.acceptable} NTU reference level.`
        };
    }

    return {
        key: "turbidity",
        name: "Turbidity",
        available: true,
        value: turbidity,
        condition: "Alert",
        level: "alert",
        summary: `Turbidity ${turbidity.toFixed(2)} NTU is above the broader ${limits.acceptable} NTU reference level, indicating elevated suspended material.`
    };
}

function analyzeTemperature(value) {
    const temperature = analysisNumber(value);
    const limits = ANALYSIS_THRESHOLDS.temperature;

    if (temperature === null) {
        return {
            key: "temperature",
            name: "Temperature",
            available: false,
            value: null,
            condition: "Unavailable",
            level: "unknown",
            summary: "Temperature is not available in the latest reading."
        };
    }

    if (
        temperature >= limits.monitoringMin &&
        temperature <= limits.monitoringMax
    ) {
        return {
            key: "temperature",
            name: "Temperature",
            available: true,
            value: temperature,
            condition: "Normal",
            level: "good",
            summary: `Temperature ${temperature.toFixed(1)} °C is within the configured general monitoring range (${analysisRange(limits.monitoringMin, limits.monitoringMax)} °C). Temperature is a monitoring indicator, not a universal safety standard.`
        };
    }

    const withinAlertBand =
        temperature >= limits.alertMin && temperature <= limits.alertMax;

    return {
        key: "temperature",
        name: "Temperature",
        available: true,
        value: temperature,
        condition: withinAlertBand ? "Caution" : "Alert",
        level: withinAlertBand ? "caution" : "alert",
        summary: withinAlertBand
            ? `Temperature ${temperature.toFixed(1)} °C is outside the configured general monitoring range (${analysisRange(limits.monitoringMin, limits.monitoringMax)} °C).`
            : `Temperature ${temperature.toFixed(1)} °C is well outside the configured general monitoring range (${analysisRange(limits.monitoringMin, limits.monitoringMax)} °C).`
    };
}

/* ---- derived parameters ------------------------------------------- */

function getDataQuality(reading) {
    const total = ANALYSIS_PARAMETER_KEYS.length;
    const available = ANALYSIS_PARAMETER_KEYS.filter(
        (key) => analysisNumber(reading ? reading[key] : null) !== null
    ).length;

    if (available === 0) {
        return {
            state: "Unavailable",
            level: "unknown",
            available,
            total,
            summary: "No sensor parameters are present in the latest reading."
        };
    }

    if (available < total) {
        return {
            state: "Partial",
            level: "caution",
            available,
            total,
            summary: `${available} of ${total} sensor parameters are present in the latest reading.`
        };
    }

    return {
        state: "Complete",
        level: "good",
        available,
        total,
        summary: "All 4 sensor parameters are present in the latest reading."
    };
}

function formatAnalysisAge(hours) {
    if (!Number.isFinite(hours)) {
        return "an unknown period";
    }

    if (hours < 1) {
        return `${Math.round(hours * 60)} minute(s)`;
    }

    if (hours < 48) {
        return `${hours.toFixed(1)} hour(s)`;
    }

    return `${(hours / 24).toFixed(1)} day(s)`;
}

function getDataFreshness(isoString) {
    const threshold = ANALYSIS_THRESHOLDS.dataFreshnessHours;

    if (!isoString) {
        return {
            state: "Unavailable",
            level: "unknown",
            ageHours: null,
            summary: "The reading timestamp is not available."
        };
    }

    const date = new Date(isoString);

    if (Number.isNaN(date.getTime())) {
        return {
            state: "Unavailable",
            level: "unknown",
            ageHours: null,
            summary: "The reading timestamp could not be interpreted."
        };
    }

    const ageHours = Math.max(0, (Date.now() - date.getTime()) / 3600000);

    if (ageHours > threshold) {
        return {
            state: "Stale",
            level: "caution",
            ageHours,
            summary: `The latest reading is ${formatAnalysisAge(ageHours)} old, which is older than the configured ${threshold} hour freshness threshold.`
        };
    }

    return {
        state: "Fresh",
        level: "good",
        ageHours,
        summary: `The latest reading is ${formatAnalysisAge(ageHours)} old (within the configured ${threshold} hour freshness threshold).`
    };
}

/* Kept for compatibility with earlier callers. */
function isDataStale(isoString) {
    return getDataFreshness(isoString).state === "Stale";
}

function formatTimestamp(isoString) {
    if (!isoString) {
        return "--";
    }

    const date = new Date(isoString);

    if (Number.isNaN(date.getTime())) {
        return String(isoString);
    }

    return date.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

/* ---- overall assessment ------------------------------------------- */

function buildOverallAssessment(phResult, tdsResult, turbResult, tempResult) {
    const results = [phResult, tdsResult, turbResult, tempResult];
    const available = results.filter((result) => result.available);

    if (available.length === 0) {
        return {
            status: "unknown",
            title: "No usable sensor readings",
            description:
                "No sensor values are available in the latest reading, so no assessment can be generated."
        };
    }

    const alerts = available.filter((result) => result.level === "alert");
    const cautions = available.filter((result) => result.level === "caution");
    const names = (list) => list.map((item) => item.name).join(", ");
    const partialNote =
        available.length < results.length
            ? ` Based on ${available.length} of ${results.length} available sensor parameters.`
            : "";

    if (alerts.length > 0) {
        return {
            status: "alert",
            title: "Alert",
            description: `Outside the configured screening references: ${names(alerts)}. Review the parameter details and the recommended actions below.${partialNote}`
        };
    }

    if (cautions.length > 0) {
        return {
            status: "caution",
            title: "Caution",
            description: `Outside the preferred screening references: ${names(cautions)}. The remaining parameters are within their configured references.${partialNote}`
        };
    }

    return {
        status: "good",
        title: "Good",
        description: `All available sensor parameters are within the configured screening references. This does not confirm drinking-water safety.${partialNote}`
    };
}

/* Map a screening level onto the explanation (why-item) style names. */
function analysisWhyLevel(level) {
    if (level === "good") {
        return "good";
    }

    if (level === "alert") {
        return "alert";
    }

    if (level === "caution") {
        return "warning";
    }

    return "unavailable";
}

/* ---- agriculture --------------------------------------------------- */

function analyzeAgriculture(phResult, tdsResult, turbResult, tempResult) {
    const limits = ANALYSIS_THRESHOLDS;
    const irrigationRange = analysisRange(
        limits.agriculturePh.min,
        limits.agriculturePh.max
    );
    const why = [];
    const concerns = [];
    const recommendations = [];

    const ph = phResult.value;
    const tds = tdsResult.value;
    const turbidity = turbResult.value;
    const temperature = tempResult.value;

    let status = "Insufficient data";
    let level = "unknown";

    if (tds !== null && tds > limits.tds.agricultureHigh) {
        status = "High TDS-based salinity concern";
        level = "alert";
    } else if (tds !== null && tds > limits.tds.agricultureModerate) {
        status = "Possible slight/moderate TDS-based salinity concern";
        level = "caution";
    } else if (
        ph !== null &&
        (ph < limits.agriculturePh.min || ph > limits.agriculturePh.max)
    ) {
        status = "pH outside the general agricultural screening range";
        level = "caution";
    } else if (tds !== null || ph !== null) {
        status = "No major salinity concern indicated by TDS screening";
        level = "good";
    }

    if (ph !== null) {
        const withinRange =
            ph >= limits.agriculturePh.min && ph <= limits.agriculturePh.max;

        why.push({
            level: withinRange ? "good" : "warning",
            text: withinRange
                ? `pH ${ph.toFixed(2)} is within the general irrigation screening range (${irrigationRange}).`
                : `pH ${ph.toFixed(2)} is outside the general irrigation screening range (${irrigationRange}).`
        });

        if (!withinRange) {
            concerns.push(
                `pH is outside the general agricultural screening range (${irrigationRange}).`
            );
        }
    } else {
        why.push({
            level: "unavailable",
            text: "pH data is unavailable, so the irrigation pH screening could not be applied."
        });
    }

    if (tds !== null) {
        why.push({
            level: analysisWhyLevel(tdsResult.level),
            text: `TDS ${tds.toFixed(1)} mg/L is ${tds > limits.tds.agricultureModerate ? "above" : "at or below"} the configured ${limits.tds.agricultureModerate} mg/L TDS-based salinity screening level.`
        });

        if (tds > limits.tds.agricultureHigh) {
            concerns.push(
                `TDS is above ${limits.tds.agricultureHigh} mg/L and indicates a high TDS-based salinity concern for irrigation screening.`
            );
        } else if (tds > limits.tds.agricultureModerate) {
            concerns.push(
                `TDS is above ${limits.tds.agricultureModerate} mg/L and indicates a possible slight/moderate salinity concern.`
            );
        }
    } else {
        why.push({
            level: "unavailable",
            text: "TDS data is unavailable, so the TDS-based salinity screening could not be applied."
        });
    }

    if (turbidity !== null) {
        why.push({
            level: analysisWhyLevel(turbResult.level),
            text: `Turbidity ${turbidity.toFixed(2)} NTU ${turbidity > limits.turbidity.preferred ? "exceeds" : "is at or below"} the preferred ${limits.turbidity.preferred} NTU target for irrigation water clarity.`
        });

        if (turbidity > limits.turbidity.acceptable) {
            concerns.push(
                `Turbidity is above ${limits.turbidity.acceptable} NTU; suspended material may clog emitters and reduce soil infiltration.`
            );
        }
    } else {
        why.push({
            level: "unavailable",
            text: "Turbidity data is unavailable, so the suspended-material screening could not be applied."
        });
    }

    if (temperature !== null) {
        why.push({
            level: analysisWhyLevel(tempResult.level),
            text: `Temperature ${temperature.toFixed(1)} °C is a general monitoring indicator (configured range ${analysisRange(limits.temperature.monitoringMin, limits.temperature.monitoringMax)} °C) and is not a crop-specific standard.`
        });
    }

    concerns.push(
        "Electrical conductivity (EC), sodium/SAR, chloride and boron are not measured by the available sensors."
    );

    recommendations.push(
        "Check EC, SAR, sodium, chloride and boron before making irrigation decisions."
    );
    recommendations.push(
        "Confirm the crop tolerance, soil characteristics, climate and irrigation method for the intended crop."
    );

    if (tds !== null && tds > limits.tds.agricultureModerate) {
        recommendations.push(
            "Investigate dissolved-solids sources and consider blending or appropriate treatment for irrigation use."
        );
    }

    if (turbidity !== null && turbidity > limits.turbidity.preferred) {
        recommendations.push(
            "Investigate the source of suspended particles and consider filtration or settling where appropriate."
        );
    }

    if (
        ph !== null &&
        (ph < limits.agriculturePh.min || ph > limits.agriculturePh.max)
    ) {
        recommendations.push(
            "Investigate the source of the pH deviation and verify it with a calibrated instrument or laboratory test."
        );
    }

    recommendations.push(
        "Continue monitoring the water quality regularly before and during irrigation."
    );

    return {
        status,
        level,
        why,
        concerns,
        recommendations,
        note: "Sensor values do not indicate crop suitability by themselves. Crop suitability requires additional parameters (EC, SAR, sodium, chloride, boron), soil characteristics, crop tolerance, climate and irrigation method."
    };
}

/* ---- industry ------------------------------------------------------ */

function analyzeIndustry(phResult, tdsResult, turbResult, tempResult) {
    const limits = ANALYSIS_THRESHOLDS;
    const results = [phResult, tdsResult, turbResult, tempResult];
    const available = results.filter((result) => result.available);
    const why = [];
    const concerns = [];
    const recommendations = [];

    let status = "Insufficient data";
    let level = "unknown";

    if (available.length === 0) {
        status = "Insufficient data";
        level = "unknown";
    } else if (available.some((result) => result.level === "alert")) {
        status = "Process-specific testing required";
        level = "alert";
    } else if (
        available.some((result) => result.level === "caution") ||
        available.length < results.length
    ) {
        status = "Further treatment/testing recommended";
        level = "caution";
    } else {
        status = "Generally manageable for non-critical applications";
        level = "good";
    }

    available.forEach((result) => {
        why.push({
            level: analysisWhyLevel(result.level),
            text: result.summary
        });
    });

    if (available.length < results.length) {
        why.push({
            level: "unavailable",
            text: `${results.length - available.length} of ${results.length} sensor parameters are unavailable, so this industry screening is incomplete.`
        });
    }

    if (available.some((result) => result.level === "alert")) {
        concerns.push(
            "One or more parameters are outside the configured screening references and may not meet process water specifications without treatment."
        );
    }

    if (
        turbResult.available &&
        turbResult.value > limits.turbidity.acceptable
    ) {
        concerns.push(
            `Turbidity ${turbResult.value.toFixed(2)} NTU may affect filtration, heat transfer or product quality in sensitive processes.`
        );
    }

    if (tdsResult.available && tdsResult.value > limits.tds.reference) {
        concerns.push(
            `TDS ${tdsResult.value.toFixed(1)} mg/L may contribute to scaling and corrosion in boilers and cooling systems.`
        );
    }

    if (phResult.available && phResult.level !== "good") {
        concerns.push(
            `pH ${phResult.value.toFixed(2)} may affect corrosion control, chemical dosing and process chemistry.`
        );
    }

    if (tempResult.available && tempResult.level !== "good") {
        concerns.push(
            `Temperature ${tempResult.value.toFixed(1)} °C may affect cooling efficiency and biological growth in process water.`
        );
    }

    concerns.push(
        "Industry requirements vary by process, and the available sensors do not cover the full process water specification."
    );

    recommendations.push(
        "Compare the measured values against the specific process water specification."
    );
    recommendations.push(
        "Sensitive applications — boiler feedwater, cooling systems, electronics, pharmaceuticals, food processing and high-purity processes — require process-specific treatment and water-quality testing."
    );
    recommendations.push(
        "For non-critical applications, review the measured parameters and re-test before changing the process water source."
    );

    if (
        turbResult.available &&
        turbResult.value > limits.turbidity.preferred
    ) {
        recommendations.push(
            "Investigate the source of suspended particles and consider filtration or settling where appropriate."
        );
    }

    if (tdsResult.available && tdsResult.value > limits.tds.reference) {
        recommendations.push(
            "Investigate dissolved-solids sources and consider appropriate treatment for the intended use."
        );
    }

    if (phResult.available && phResult.level !== "good") {
        recommendations.push(
            "Investigate the source of the pH deviation and verify it with a calibrated instrument or laboratory test."
        );
    }

    return { status, level, why, concerns, recommendations };
}

/* ---- general / non-potable ---------------------------------------- */

function analyzeGeneralUse(phResult, tdsResult, turbResult, tempResult) {
    const limits = ANALYSIS_THRESHOLDS;
    const results = [phResult, tdsResult, turbResult, tempResult];
    const available = results.filter((result) => result.available);
    const why = [];
    const concerns = [];
    const recommendations = [];

    const hasAlert = available.some((result) => result.level === "alert");
    const hasCaution = available.some((result) => result.level === "caution");

    let status = "Insufficient data";
    let level = "unknown";

    if (available.length === 0) {
        status = "Insufficient data";
        level = "unknown";
    } else if (hasAlert) {
        status = "Use caution — one or more parameters are outside the configured references";
        level = "alert";
    } else if (hasCaution || available.length < results.length) {
        status = "Use caution";
        level = "caution";
    } else {
        status =
            "Potentially usable for general non-potable purposes based on the available sensor readings, subject to the specific application and contamination source.";
        level = "good";
    }

    available.forEach((result) => {
        why.push({ level: analysisWhyLevel(result.level), text: result.summary });
    });

    if (available.length < results.length) {
        why.push({
            level: "unavailable",
            text: `${results.length - available.length} of ${results.length} sensor parameters are unavailable, so this screening is partial.`
        });
    }

    const useLevel = hasAlert ? "alert" : (hasCaution ? "caution" : "good");
    const useReason = [];

    if (turbResult.available) {
        useReason.push(`turbidity ${turbResult.value.toFixed(2)} NTU`);
    }
    if (tdsResult.available) {
        useReason.push(`TDS ${tdsResult.value.toFixed(1)} mg/L`);
    }
    if (phResult.available) {
        useReason.push(`pH ${phResult.value.toFixed(2)}`);
    }

    const measuredSummary = useReason.length
        ? `Measured values: ${useReason.join(", ")}.`
        : "No sensor parameters are available.";

    const uses = [
        {
            name: "Gardening and ornamental plants",
            level: useLevel,
            reason: `${measuredSummary} Elevated turbidity or TDS can affect plant appearance and soil condition.`
        },
        {
            name: "Landscaping",
            level: useLevel,
            reason: `${measuredSummary} Elevated dissolved solids may leave deposits on surfaces and soil over time.`
        },
        {
            name: "Outdoor cleaning",
            level: useLevel,
            reason: `${measuredSummary} Elevated turbidity or dissolved solids may reduce cleaning effectiveness and leave residues.`
        },
        {
            name: "Toilet flushing",
            level: useLevel,
            reason: `${measuredSummary} Non-potable plumbing use still requires protection from cross-connection with drinking-water lines.`
        }
    ];

    if (turbResult.available && turbResult.value > limits.turbidity.preferred) {
        concerns.push(
            `Turbidity is above the preferred ${limits.turbidity.preferred} NTU target, which may leave residues and reduce the effectiveness of general non-potable uses.`
        );
    }

    if (tdsResult.available && tdsResult.value > limits.tds.reference) {
        concerns.push(
            `TDS is above the configured ${limits.tds.reference} mg/L reference level, which may cause deposits and affect general non-potable uses.`
        );
    }

    if (phResult.available && phResult.level !== "good") {
        concerns.push(
            `pH is outside the configured general screening range (${analysisRange(limits.ph.min, limits.ph.max)}).`
        );
    }

    if (tempResult.available && tempResult.level !== "good") {
        concerns.push(
            `Temperature is outside the configured general monitoring range (${analysisRange(limits.temperature.monitoringMin, limits.temperature.monitoringMax)} °C).`
        );
    }

    concerns.push(
        "The available sensors do not identify microbiological contamination, so the contamination source cannot be assessed from these measurements."
    );

    recommendations.push(
        "Use the water only for the intended non-potable purpose (gardening, landscaping, outdoor cleaning or toilet flushing)."
    );
    recommendations.push(
        "Confirm that the water source is protected from contamination such as runoff, wastewater or industrial discharge before general non-potable use."
    );

    if (turbResult.available && turbResult.value > limits.turbidity.preferred) {
        recommendations.push(
            "Investigate the source of suspended particles and consider filtration or settling where appropriate."
        );
    }

    if (tdsResult.available && tdsResult.value > limits.tds.reference) {
        recommendations.push(
            "Investigate dissolved-solids sources and consider appropriate treatment for the intended use."
        );
    }

    if (phResult.available && phResult.level !== "good") {
        recommendations.push(
            "Investigate the source of the pH deviation and verify it with a calibrated instrument or laboratory test."
        );
    }

    recommendations.push(
        "Do not use this water for drinking, cooking or personal hygiene without laboratory chemical and microbiological testing."
    );

    return { status, level, why, concerns, recommendations, uses };
}

/* ---- drinking-water screening (screening only) --------------------- */

function analyzeDrinkingScreening(phResult, tdsResult, turbResult, tempResult) {
    const limits = ANALYSIS_THRESHOLDS;
    const phRange = analysisRange(limits.ph.min, limits.ph.max);
    const tempRange = analysisRange(
        limits.temperature.monitoringMin,
        limits.temperature.monitoringMax
    );

    const params = [];

    params.push({
        name: "pH",
        value: phResult.available ? `${phResult.value.toFixed(2)} pH` : "--",
        reference: `General reference range ${phRange}`,
        assessment: phResult.available
            ? phResult.level === "good"
                ? "Within general reference range"
                : "Outside general reference range"
            : "Data unavailable",
        assessmentClass: phResult.available
            ? phResult.level === "good"
                ? "good"
                : "attention"
            : "unavailable"
    });

    let turbidityAssessment = "Data unavailable";
    let turbidityClass = "unavailable";

    if (turbResult.available) {
        if (turbResult.value <= limits.turbidity.preferred) {
            turbidityAssessment = "At or below preferred target";
            turbidityClass = "good";
        } else if (turbResult.value <= limits.turbidity.acceptable) {
            turbidityAssessment = "Above target, within broader reference";
            turbidityClass = "attention";
        } else {
            turbidityAssessment = "Above broader reference level";
            turbidityClass = "attention";
        }
    }

    params.push({
        name: "Turbidity",
        value: turbResult.available
            ? `${turbResult.value.toFixed(2)} NTU`
            : "--",
        reference: `Target <${limits.turbidity.preferred} NTU (broader reference <${limits.turbidity.acceptable} NTU)`,
        assessment: turbidityAssessment,
        assessmentClass: turbidityClass
    });

    let tdsAssessment = "Data unavailable";
    let tdsClass = "unavailable";

    if (tdsResult.available) {
        if (tdsResult.value <= limits.tds.reference) {
            tdsAssessment = "At or below reference level";
            tdsClass = "good";
        } else if (tdsResult.value <= limits.tds.agricultureHigh) {
            tdsAssessment = "Above reference level";
            tdsClass = "attention";
        } else {
            tdsAssessment = "Well above reference level";
            tdsClass = "attention";
        }
    }

    params.push({
        name: "TDS",
        value: tdsResult.available ? `${tdsResult.value.toFixed(1)} mg/L` : "--",
        reference: `${limits.tds.reference} mg/L secondary/reference level`,
        assessment: tdsAssessment,
        assessmentClass: tdsClass
    });

    params.push({
        name: "Temperature",
        value: tempResult.available
            ? `${tempResult.value.toFixed(1)} °C`
            : "--",
        reference: `Monitoring indicator ${tempRange} °C`,
        assessment: tempResult.available
            ? tempResult.level === "good"
                ? "Within monitoring range"
                : "Outside monitoring range"
            : "Data unavailable",
        assessmentClass: tempResult.available
            ? tempResult.level === "good"
                ? "good"
                : "attention"
            : "unavailable"
    });

    const why = [];
    const recommendations = [];

    [phResult, tdsResult, turbResult, tempResult].forEach((result) => {
        if (result.available) {
            why.push({
                level: analysisWhyLevel(result.level),
                text: result.summary
            });
        }
    });

    const total = 4;
    const availableCount = why.length;

    if (availableCount < total) {
        why.push({
            level: "unavailable",
            text: `The assessment is incomplete because ${total - availableCount} of ${total} sensor parameters are unavailable.`
        });
    }

    const attention = params.filter(
        (param) => param.assessmentClass === "attention"
    );

    let status;
    let level;

    if (availableCount === 0) {
        status = "Insufficient data";
        level = "unknown";
    } else if (attention.length > 0) {
        status =
            "Sensor parameters are outside the general reference ranges — additional investigation, treatment and laboratory testing are required.";
        level = "alert";
    } else {
        status =
            "Sensor parameters are within the general reference ranges, but these sensors cannot confirm drinking-water safety. Laboratory testing is still required.";
        level = "caution";
    }

    const cannotDetect = [
        "Bacteria, viruses and other pathogens",
        "Heavy metals such as lead, arsenic and mercury",
        "Pesticides and other organic contaminants",
        "Many dissolved chemicals that do not change pH, TDS or turbidity",
        "The complete chemical composition of the water"
    ];

    recommendations.push(
        "Perform laboratory chemical and microbiological testing before consumption."
    );
    recommendations.push(
        "Do not treat these sensor values as confirmation of drinking-water safety."
    );

    if (turbResult.available && turbResult.value > limits.turbidity.preferred) {
        recommendations.push(
            "Investigate the source of suspended particles and consider filtration or settling, then verify with laboratory testing."
        );
    }

    if (tdsResult.available && tdsResult.value > limits.tds.reference) {
        recommendations.push(
            "Investigate dissolved-solids sources and consider appropriate treatment, then verify with laboratory testing."
        );
    }

    if (phResult.available && phResult.level !== "good") {
        recommendations.push(
            "Investigate the source of the pH deviation and verify it with a calibrated instrument or laboratory test."
        );
    }

    return {
        status,
        level,
        why,
        recommendations,
        params,
        cannotDetect,
        conclusion:
            "Laboratory chemical and microbiological testing is required before declaring water safe for consumption."
    };
}

/* ---- rendering helpers -------------------------------------------- */

function analysisPanelSection(title, content) {
    return `<div class="analysis-panel-section"><h5>${escapeHtml(title)}</h5>${content}</div>`;
}

function analysisStatusBadge(text, level) {
    return `<p class="analysis-status ${level}">${escapeHtml(text)}</p>`;
}

function analysisWhyList(items) {
    if (!items || items.length === 0) {
        return '<p class="why-placeholder">No explanation is available for the current reading.</p>';
    }

    return `<div class="why-result-list">${items
        .map(
            (item) =>
                `<span class="why-item ${item.level}">${escapeHtml(item.text)}</span>`
        )
        .join("")}</div>`;
}

function analysisConcernList(items) {
    if (!items || items.length === 0) {
        return '<p class="concerns-placeholder">No major concern identified within the configured sensor screening parameters.</p>';
    }

    return `<ul class="concerns-list">${items
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ul>`;
}

function analysisBulletList(items) {
    if (!items || items.length === 0) {
        return '<p class="concerns-placeholder">No specific recommendation for the current reading.</p>';
    }

    return `<ul class="analysis-list">${items
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ul>`;
}

/* ---- water-use tab panels ----------------------------------------- */

function renderAgricultureTab(agriculture) {
    const el = $("analysisAgricultureContent");

    if (!el) {
        return;
    }

    el.innerHTML =
        analysisPanelSection(
            "Agriculture screening",
            analysisStatusBadge(agriculture.status, agriculture.level)
        ) +
        analysisPanelSection("Why", analysisWhyList(agriculture.why)) +
        analysisPanelSection(
            "Concerns",
            analysisConcernList(agriculture.concerns)
        ) +
        analysisPanelSection(
            "Recommendations",
            analysisBulletList(agriculture.recommendations)
        ) +
        `<p class="crop-disclaimer">${escapeHtml(agriculture.note)}</p>`;
}

function renderIndustryTab(industry) {
    const el = $("analysisIndustryContent");

    if (!el) {
        return;
    }

    el.innerHTML =
        analysisPanelSection(
            "Preliminary industry screening",
            analysisStatusBadge(industry.status, industry.level) +
                '<p class="industry-disclaimer">Industry requirements vary by process. This is a preliminary screening based on the available sensor parameters only.</p>'
        ) +
        analysisPanelSection("Why", analysisWhyList(industry.why)) +
        analysisPanelSection(
            "Concerns",
            analysisConcernList(industry.concerns)
        ) +
        analysisPanelSection(
            "Recommendations",
            analysisBulletList(industry.recommendations)
        );
}

function renderGeneralTab(general) {
    const el = $("analysisGeneralContent");

    if (!el) {
        return;
    }

    const useCard = (item) => {
        const cardClass = item.level === "good" ? "suitable" : item.level;
        const badgeText =
            item.level === "good"
                ? "Potentially suitable"
                : item.level === "caution"
                    ? "Use caution"
                    : item.level === "alert"
                        ? "Not indicated"
                        : "Unavailable";

        return `<div class="general-use-card ${cardClass}">
            <span class="suitability-badge">${escapeHtml(badgeText)}</span>
            <h6>${escapeHtml(item.name)}</h6>
            <p>${escapeHtml(item.reason)}</p>
        </div>`;
    };

    el.innerHTML =
        analysisPanelSection(
            "General / non-potable screening",
            analysisStatusBadge(general.status, general.level)
        ) +
        analysisPanelSection("Why", analysisWhyList(general.why)) +
        analysisPanelSection(
            "Possible uses",
            `<div class="general-use-grid">${general.uses
                .map(useCard)
                .join("")}</div>`
        ) +
        analysisPanelSection(
            "Concerns",
            analysisConcernList(general.concerns)
        ) +
        analysisPanelSection(
            "Recommendations",
            analysisBulletList(general.recommendations)
        );
}

function renderDrinkingTab(drinking) {
    const el = $("analysisDrinkingContent");

    if (!el) {
        return;
    }

    const rows = drinking.params
        .map(
            (param) => `
            <tr>
                <td>${escapeHtml(param.name)}</td>
                <td>${escapeHtml(param.value)}</td>
                <td>${escapeHtml(param.reference)}</td>
                <td class="${param.assessmentClass}">${escapeHtml(param.assessment)}</td>
            </tr>`
        )
        .join("");

    el.innerHTML =
        analysisPanelSection(
            "Preliminary Drinking-Water Screening",
            analysisStatusBadge(drinking.status, drinking.level)
        ) +
        analysisPanelSection("Why", analysisWhyList(drinking.why)) +
        analysisPanelSection(
            "Parameter comparison",
            `<div class="drinking-params-table">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">Parameter</th>
                            <th scope="col">Measured</th>
                            <th scope="col">Reference / target</th>
                            <th scope="col">Assessment</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`
        ) +
        analysisPanelSection(
            "Recommendations",
            analysisBulletList(drinking.recommendations)
        ) +
        `<div class="analysis-panel-section drinking-warning">
            <h5><i class="ri-error-warning-line" aria-hidden="true"></i> Screening only — this is not a safety determination</h5>
            <p><strong>${escapeHtml(drinking.conclusion)}</strong></p>
            <p>These sensors alone cannot determine drinking-water safety. They cannot detect:</p>
            <ul>${drinking.cannotDetect
                .map((item) => `<li>${escapeHtml(item)}</li>`)
                .join("")}</ul>
        </div>`;
}

/* ---- page-level explanation, concerns and recommendations ---------- */

function buildWhyNarrative(phResult, tdsResult, turbResult, tempResult) {
    const limits = ANALYSIS_THRESHOLDS;
    const sentences = [];

    if (phResult.available) {
        if (phResult.level === "good") {
            sentences.push(
                `The current pH is ${phResult.value.toFixed(2)}, which falls within the configured general screening range (${analysisRange(limits.ph.min, limits.ph.max)}).`
            );
        } else {
            sentences.push(
                `The current pH is ${phResult.value.toFixed(2)}, which is ${phResult.value < limits.ph.min ? "below" : "above"} the configured general screening range (${analysisRange(limits.ph.min, limits.ph.max)}).`
            );
        }
    }

    if (turbResult.available) {
        if (turbResult.level === "good") {
            sentences.push(
                `Turbidity is ${turbResult.value.toFixed(2)} NTU, which is at or below the preferred ${limits.turbidity.preferred} NTU target.`
            );
        } else if (turbResult.level === "caution") {
            sentences.push(
                `Turbidity is ${turbResult.value.toFixed(2)} NTU, which indicates some suspended-material concern compared with the ${limits.turbidity.preferred} NTU target.`
            );
        } else {
            sentences.push(
                `Turbidity is ${turbResult.value.toFixed(2)} NTU, which is above the broader ${limits.turbidity.acceptable} NTU reference level.`
            );
        }
    }

    if (tdsResult.available) {
        if (tdsResult.level === "good") {
            sentences.push(
                `TDS is ${tdsResult.value.toFixed(1)} mg/L, which is at or below the configured ${limits.tds.reference} mg/L reference level.`
            );
        } else if (tdsResult.level === "caution") {
            sentences.push(
                `TDS is ${tdsResult.value.toFixed(1)} mg/L, which is above the configured ${limits.tds.reference} mg/L reference level.`
            );
        } else {
            sentences.push(
                `TDS is ${tdsResult.value.toFixed(1)} mg/L, which is above the configured ${limits.tds.agricultureHigh} mg/L TDS-based salinity screening level.`
            );
        }
    }

    if (tempResult.available) {
        sentences.push(
            `Temperature is ${tempResult.value.toFixed(1)} °C, which is ${tempResult.level === "good" ? "within" : "outside"} the configured general monitoring range (${analysisRange(limits.temperature.monitoringMin, limits.temperature.monitoringMax)} °C).`
        );
    }

    const missing = [phResult, tdsResult, turbResult, tempResult].filter(
        (result) => !result.available
    ).length;

    if (missing > 0) {
        sentences.push(
            "The assessment is incomplete because one or more sensor parameters are unavailable."
        );
    }

    if (sentences.length === 0) {
        sentences.push(
            "No sensor parameters are available in the latest reading, so no explanation can be generated."
        );
    }

    return sentences.join(" ");
}

function renderWhyResult(phResult, tdsResult, turbResult, tempResult, quality, freshness) {
    const el = $("whyResultContent");

    if (!el) {
        return;
    }

    const items = [phResult, tdsResult, turbResult, tempResult]
        .filter((result) => result.available)
        .map((result) => ({
            level: analysisWhyLevel(result.level),
            text: result.summary
        }));

    items.push({
        level: analysisWhyLevel(quality.level),
        text: `Data quality: ${quality.state} — ${quality.summary}`
    });

    items.push({
        level: analysisWhyLevel(freshness.level),
        text: `Data freshness: ${freshness.state} — ${freshness.summary}`
    });

    el.innerHTML =
        `<p class="why-narrative">${escapeHtml(buildWhyNarrative(phResult, tdsResult, turbResult, tempResult))}</p>` +
        analysisWhyList(items);
}

function renderKeyConcerns(phResult, tdsResult, turbResult, tempResult, quality, freshness) {
    const el = $("concernsContent");

    if (!el) {
        return;
    }

    const limits = ANALYSIS_THRESHOLDS;
    const concerns = [];

    if (phResult.available && phResult.value < limits.ph.min) {
        concerns.push("pH is below the configured screening range.");
    }

    if (phResult.available && phResult.value > limits.ph.max) {
        concerns.push("pH is above the configured screening range.");
    }

    if (turbResult.available && turbResult.value > limits.turbidity.preferred) {
        concerns.push(
            turbResult.value > limits.turbidity.acceptable
                ? "Turbidity is well above the preferred screening target."
                : "Turbidity is above the preferred screening target."
        );
    }

    if (tdsResult.available && tdsResult.value > limits.tds.reference) {
        concerns.push(
            "TDS is elevated and may indicate increased dissolved solids."
        );
    }

    if (tempResult.available && tempResult.level !== "good") {
        concerns.push("Temperature is outside the configured monitoring range.");
    }

    if (quality.state === "Partial") {
        concerns.push(
            `Only ${quality.available} of ${quality.total} sensor parameters are available, so the assessment is incomplete.`
        );
    }

    if (quality.state === "Unavailable") {
        concerns.push("No sensor parameters are available in the latest reading.");
    }

    if (freshness.state === "Stale") {
        concerns.push(
            "Data is stale. The latest reading is older than the configured freshness threshold, so it may not represent current conditions."
        );
    }

    if (freshness.state === "Unavailable") {
        concerns.push(
            "The reading timestamp is unavailable, so data freshness could not be verified."
        );
    }

    el.innerHTML = analysisConcernList(concerns);
}

function renderRecommendations(phResult, tdsResult, turbResult, tempResult, agriculture, industry, general, drinking, quality, freshness) {
    const el = $("recommendationsDetailedContent");

    if (!el) {
        return;
    }

    const limits = ANALYSIS_THRESHOLDS;
    const cards = [];

    const available = [phResult, tdsResult, turbResult, tempResult].filter(
        (result) => result.available
    );
    const allWithinReferences =
        available.length > 0 &&
        available.every((result) => result.level === "good");

    cards.push({
        title: "Monitoring",
        level: allWithinReferences ? "good" : "info",
        text: allWithinReferences
            ? "Continue monitoring the water quality regularly."
            : "Continue monitoring the water quality regularly and compare new readings against the configured screening references."
    });

    if (turbResult.available && turbResult.value > limits.turbidity.preferred) {
        cards.push({
            title: "Turbidity",
            level:
                turbResult.value > limits.turbidity.acceptable
                    ? "alert"
                    : "caution",
            text: "Investigate the source of suspended particles and consider filtration or settling where appropriate."
        });
    }

    if (tdsResult.available && tdsResult.value > limits.tds.reference) {
        cards.push({
            title: "Total dissolved solids (TDS)",
            level:
                tdsResult.value > limits.tds.agricultureHigh
                    ? "alert"
                    : "caution",
            text: "Investigate dissolved-solids sources and consider appropriate treatment for the intended use."
        });
    }

    if (phResult.available && phResult.level !== "good") {
        cards.push({
            title: "pH",
            level: phResult.level === "alert" ? "alert" : "caution",
            text: "Investigate the source of the pH deviation and verify with a calibrated instrument or laboratory test."
        });
    }

    if (tempResult.available && tempResult.level !== "good") {
        cards.push({
            title: "Temperature",
            level: tempResult.level === "alert" ? "alert" : "caution",
            text: "Investigate the temperature change and confirm the reading with a second measurement or a calibrated instrument."
        });
    }

    cards.push({
        title: "Agriculture",
        level: agriculture.level === "unknown" ? "info" : agriculture.level,
        text: "Check EC, SAR, sodium, chloride and boron before making irrigation decisions."
    });

    cards.push({
        title: "Industry",
        level: industry.level === "unknown" ? "info" : industry.level,
        text: "Compare the measured values against the specific process water specification. Sensitive applications require process-specific treatment and testing."
    });

    cards.push({
        title: "General / non-potable",
        level: general.level === "unknown" ? "info" : general.level,
        text: "Review the intended non-potable use and the contamination source before use."
    });

    cards.push({
        title: "Drinking screening",
        level: drinking.level === "unknown" ? "info" : drinking.level,
        text: "Perform laboratory chemical and microbiological testing before consumption."
    });

    if (freshness.state === "Stale") {
        cards.push({
            title: "Data freshness",
            level: "caution",
            text: "The latest reading is stale. Ingest a new reading before acting on this assessment."
        });
    }

    if (quality.state !== "Complete") {
        cards.push({
            title: "Data quality",
            level: "info",
            text: `Only ${quality.available} of ${quality.total} sensor parameters are available. Ingest readings with all four parameters for a complete assessment.`
        });
    }

    el.innerHTML = `<div class="recommendations-grid">${cards
        .map(
            (card) => `
            <div class="recommendation-card ${card.level}">
                <h6>${escapeHtml(card.title)}</h6>
                <p>${escapeHtml(card.text)}</p>
            </div>`
        )
        .join("")}</div>`;
}

/* ---- page state handling ------------------------------------------ */

function renderAnalysisUnavailableState(config) {
    setAnalysisNotice(
        config.noticeHtml || "",
        config.noticeLevel || "unknown"
    );

    setText("analysisReadingTime", config.readingTime || "No data available");
    setText("overallStatusTitle", config.title);
    setText("overallStatusDescription", config.description);

    const badge = $("overallStatusBadge");

    if (badge) {
        badge.className = `overall-status-badge ${config.badgeLevel}`;
        badge.textContent = config.badge;
    }

    setText("paramTempValue", "--");
    setText("paramPhValue", "--");
    setText("paramTurbidityValue", "--");
    setText("paramTdsValue", "--");

    [
        "paramTempCondition",
        "paramPhCondition",
        "paramTurbidityCondition",
        "paramTdsCondition"
    ].forEach((id) => setAnalysisCondition(id, config.conditionText, config.conditionLevel));

    [
        "derivedPhCondition",
        "derivedTdsCondition",
        "derivedSalinityIndication",
        "derivedTurbidityCondition",
        "derivedTempCondition",
        "derivedDataQuality",
        "derivedDataFreshness"
    ].forEach((id) =>
        setDerivedValue(
            id,
            config.derivedText || "Unavailable",
            config.derivedLevel || "unknown"
        )
    );

    setAnalysisHtml(
        "whyResultContent",
        `<p class="why-placeholder">${escapeHtml(config.whyText)}</p>`
    );
    setAnalysisHtml(
        "concernsContent",
        `<p class="concerns-placeholder">${escapeHtml(config.concernsText)}</p>`
    );
    setAnalysisHtml(
        "recommendationsDetailedContent",
        `<p class="recommendations-placeholder">${escapeHtml(config.recommendationsText)}</p>`
    );

    [
        "analysisAgricultureContent",
        "analysisIndustryContent",
        "analysisGeneralContent",
        "analysisDrinkingContent"
    ].forEach((id) => setAnalysisHtml(id, ""));
}

function renderAnalysisLoadingState() {
    renderAnalysisUnavailableState({
        badge: "LOADING",
        badgeLevel: "unknown",
        title: "Loading the latest reading",
        description: "Fetching the latest sensor reading from the database.",
        readingTime: "Loading...",
        conditionText: "Loading",
        conditionLevel: "unknown",
        derivedText: "Loading",
        derivedLevel: "unknown",
        whyText: "Loading the latest reading...",
        concernsText: "Waiting for the latest reading...",
        recommendationsText: "Waiting for the latest reading..."
    });
}

function renderAnalysisErrorState() {
    renderAnalysisUnavailableState({
        badge: "UNKNOWN",
        badgeLevel: "unknown",
        title: "Unable to load the latest reading",
        description:
            "The analysis could not be generated because the latest reading request failed.",
        readingTime: "No data available",
        conditionText: "Unavailable",
        conditionLevel: "unknown",
        noticeLevel: "alert",
        noticeHtml: `<div class="analysis-notice-content">
                <i class="ri-error-warning-line" aria-hidden="true"></i>
                <div>
                    <strong>Unable to load the latest reading.</strong>
                    <span>Check the backend connection and try again.</span>
                </div>
                <button type="button" class="secondary-button" data-analysis-action="retry">Retry</button>
            </div>`,
        whyText:
            "The latest reading could not be loaded, so no explanation is available.",
        concernsText: "Check the backend connection and try again.",
        recommendationsText: "Retry the request to generate a fresh assessment."
    });
}

function renderAnalysisNoDataState() {
    renderAnalysisUnavailableState({
        badge: "UNKNOWN",
        badgeLevel: "unknown",
        title: "No readings available",
        description: "No sensor readings have been recorded yet.",
        readingTime: "No data available",
        conditionText: "Unavailable",
        conditionLevel: "unknown",
        noticeLevel: "unknown",
        noticeHtml: `<div class="analysis-notice-content">
                <i class="ri-information-line" aria-hidden="true"></i>
                <div>
                    <strong>No sensor readings available.</strong>
                    <span>Connect a sensor device or ingest a reading to generate an assessment.</span>
                </div>
            </div>`,
        whyText: "No sensor readings available yet.",
        concernsText: "No readings available.",
        recommendationsText:
            "Connect a sensor device or ingest a reading to generate an assessment."
    });
}

/* ---- main analysis render ----------------------------------------- */

function updateAnalysisPage() {
    if (analysisLoading) {
        renderAnalysisLoadingState();
        return;
    }

    if (analysisLoadError && !latestReading) {
        renderAnalysisErrorState();
        return;
    }

    if (!latestReading) {
        renderAnalysisNoDataState();
        return;
    }

    const reading = latestReading;
    const quality = getDataQuality(reading);
    const freshness = getDataFreshness(reading.recorded_at);

    setText(
        "analysisReadingTime",
        reading.recorded_at
            ? formatTimestamp(reading.recorded_at)
            : "No data available"
    );

    // Screen each parameter with the configured thresholds.
    const phResult = analyzePh(reading.ph);
    const tdsResult = analyzeTds(reading.tds);
    const turbResult = analyzeTurbidity(reading.turbidity);
    const tempResult = analyzeTemperature(reading.temperature);

    // Current parameters (missing values stay "--", never 0).
    setText(
        "paramTempValue",
        tempResult.available ? formatNumber(tempResult.value, 1) : "--"
    );
    setText(
        "paramPhValue",
        phResult.available ? formatNumber(phResult.value, 2) : "--"
    );
    setText(
        "paramTurbidityValue",
        turbResult.available ? formatNumber(turbResult.value, 2) : "--"
    );
    setText(
        "paramTdsValue",
        tdsResult.available ? formatNumber(tdsResult.value, 1) : "--"
    );

    setAnalysisCondition(
        "paramTempCondition",
        tempResult.condition,
        tempResult.level
    );
    setAnalysisCondition("paramPhCondition", phResult.condition, phResult.level);
    setAnalysisCondition(
        "paramTurbidityCondition",
        turbResult.condition,
        turbResult.level
    );
    setAnalysisCondition(
        "paramTdsCondition",
        tdsResult.condition,
        tdsResult.level
    );

    // Derived parameters.
    setDerivedValue(
        "derivedPhCondition",
        phResult.condition,
        phResult.level,
        phResult.summary
    );
    setDerivedValue(
        "derivedTdsCondition",
        tdsResult.condition,
        tdsResult.level,
        tdsResult.summary
    );
    setDerivedValue(
        "derivedSalinityIndication",
        tdsResult.salinityIndication,
        tdsResult.level,
        "TDS-based salinity indication. TDS is not a direct measurement of salinity or electrical conductivity and is used here only as a screening indication."
    );
    setDerivedValue(
        "derivedTurbidityCondition",
        turbResult.condition,
        turbResult.level,
        turbResult.summary
    );
    setDerivedValue(
        "derivedTempCondition",
        tempResult.condition,
        tempResult.level,
        tempResult.summary
    );
    setDerivedValue(
        "derivedDataQuality",
        quality.state,
        quality.level,
        quality.summary
    );
    setDerivedValue(
        "derivedDataFreshness",
        freshness.state,
        freshness.level,
        freshness.summary
    );

    // Overall assessment.
    const overall = buildOverallAssessment(
        phResult,
        tdsResult,
        turbResult,
        tempResult
    );

    setText("overallStatusTitle", overall.title);
    setText("overallStatusDescription", overall.description);

    const badge = $("overallStatusBadge");

    if (badge) {
        badge.className = `overall-status-badge ${overall.status}`;
        badge.textContent = overall.status.toUpperCase();
    }

    // Stale data must stay visible without hiding the analysis.
    if (freshness.state === "Stale") {
        setAnalysisNotice(
            `<div class="analysis-notice-content">
                <i class="ri-history-line" aria-hidden="true"></i>
                <div>
                    <strong>Data is stale.</strong>
                    <span>${escapeHtml(freshness.summary)}</span>
                </div>
            </div>`,
            "caution"
        );
    } else if (freshness.state === "Unavailable") {
        setAnalysisNotice(
            `<div class="analysis-notice-content">
                <i class="ri-question-line" aria-hidden="true"></i>
                <div>
                    <strong>Data freshness could not be verified.</strong>
                    <span>${escapeHtml(freshness.summary)}</span>
                </div>
            </div>`,
            "unknown"
        );
    } else {
        setAnalysisNotice("");
    }

    // Water-use analyses (all reuse the same latestReading).
    const agriculture = analyzeAgriculture(
        phResult,
        tdsResult,
        turbResult,
        tempResult
    );
    const industry = analyzeIndustry(
        phResult,
        tdsResult,
        turbResult,
        tempResult
    );
    const general = analyzeGeneralUse(
        phResult,
        tdsResult,
        turbResult,
        tempResult
    );
    const drinking = analyzeDrinkingScreening(
        phResult,
        tdsResult,
        turbResult,
        tempResult
    );

    renderAgricultureTab(agriculture);
    renderIndustryTab(industry);
    renderGeneralTab(general);
    renderDrinkingTab(drinking);

    renderWhyResult(phResult, tdsResult, turbResult, tempResult, quality, freshness);
    renderKeyConcerns(
        phResult,
        tdsResult,
        turbResult,
        tempResult,
        quality,
        freshness
    );
    renderRecommendations(
        phResult,
        tdsResult,
        turbResult,
        tempResult,
        agriculture,
        industry,
        general,
        drinking,
        quality,
        freshness
    );
}

/* ---- retry + tab interaction -------------------------------------- */

/* Force a fresh /readings/latest request and re-render the page. */
async function retryAnalysisLoad() {
    latestReading = null;
    analysisLoadError = null;
    analysisLoading = true;
    updateAnalysisPage();

    await loadAnalysisLatestReading();
    updateAnalysisPage();
}

/* Delegated retry handling; registered once so re-rendering never leaks
   duplicate listeners. */
function setupAnalysisNotice() {
    const notice = $("analysisNotice");

    if (!notice || notice.dataset.analysisNoticeReady === "true") {
        return;
    }

    notice.dataset.analysisNoticeReady = "true";

    notice.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-analysis-action='retry']");

        if (!button) {
            return;
        }

        button.disabled = true;
        await retryAnalysisLoad();
    });
}

/* Tab switching only toggles panels — it never triggers an API request,
   because all four uses reuse the latestReading already loaded. */
function setupAnalysisTabs() {
    if (document.body.dataset.analysisTabsReady !== "true") {
        document.body.dataset.analysisTabsReady = "true";

        document.addEventListener("click", (event) => {
            const tab = event.target.closest(".analysis-tab");

            if (tab && tab.dataset.analysisTab) {
                switchAnalysisTab(tab.dataset.analysisTab);
            }
        });

        document.addEventListener("keydown", (event) => {
            const tab = event.target.closest(".analysis-tab");

            if (
                !tab ||
                (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
            ) {
                return;
            }

            const tabs = Array.from(
                document.querySelectorAll(".analysis-tab")
            );
            const index = tabs.indexOf(tab);
            const nextIndex =
                event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : (index - 1 + tabs.length) % tabs.length;
            const nextTab = tabs[nextIndex];

            if (nextTab) {
                event.preventDefault();
                switchAnalysisTab(nextTab.dataset.analysisTab);
                nextTab.focus();
            }
        });
    }

    setupAnalysisNotice();
}

function switchAnalysisTab(tabName) {
    if (!tabName) {
        return;
    }

    const panelId = `panelAnalysis${tabName.charAt(0).toUpperCase()}${tabName.slice(1)}`;

    document.querySelectorAll(".analysis-tab").forEach((tab) => {
        const isActive = tab.dataset.analysisTab === tabName;
        tab.classList.toggle("active", isActive);
        tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    document.querySelectorAll(".analysis-tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === panelId);
    });
}
