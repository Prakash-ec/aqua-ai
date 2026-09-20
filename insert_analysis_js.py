with open('D:/aqua-ai/frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the position after renderCameraResult function ends (before prettifyKey)
insert_marker = '}\n\nfunction prettifyKey(key) {'
insert_pos = content.find(insert_marker)

if insert_pos != -1:
    # Insert before prettifyKey
    analysis_js = '''

// =========================================================
// ANALYSIS PAGE LOGIC
// =========================================================

// Reference thresholds (centralized for maintainability)
const ANALYSIS_THRESHOLDS = {
    ph: {
        irrigation: { min: 6.5, max: 8.4 },
        drinking: { min: 6.5, max: 8.5 },
        acidic: 6.5,
        alkaline: 8.4
    },
    tds: {
        irrigation: { low: 450, moderate: 2000 },
        drinking_secondary: 500,
        condition: { low: 300, moderate: 600, high: 1200, veryHigh: 1200 }
    },
    turbidity: {
        drinking_target: 1,
        drinking_acceptable: 5,
        condition: { low: 1, moderate: 5, high: 5 }
    },
    temperature: {
        normal_max: 30,
        elevated: 30,
        veryElevated: 35
    },
    dataFreshnessHours: 24  // Consider data stale after 24 hours
};

// Crop groups with salinity tolerance (FAO-based)
const CROP_GROUPS = [
    { name: "Rice", category: "Cereals", salinityTolerance: "moderate" },
    { name: "Wheat", category: "Cereals", salinityTolerance: "moderate" },
    { name: "Maize", category: "Cereals", salinityTolerance: "moderate" },
    { name: "Cotton", category: "Fiber", salinityTolerance: "high" },
    { name: "Vegetables", category: "Horticulture", salinityTolerance: "low" },
    { name: "Fruits", category: "Horticulture", salinityTolerance: "low" },
    { name: "Pulses", category: "Legumes", salinityTolerance: "low" },
    { name: "Oilseeds", category: "Oil Crops", salinityTolerance: "moderate" }
];

function analyzePh(value) {
    if (value === null || value === undefined) {
        return { condition: "unavailable", assessment: "pH analysis unavailable.", withinIrrigation: null, withinDrinking: null };
    }
    const ph = Number(value);
    let condition, assessment;
    const withinIrrigation = ph >= ANALYSIS_THRESHOLDS.ph.irrigation.min && ph <= ANALYSIS_THRESHOLDS.ph.irrigation.max;
    const withinDrinking = ph >= ANALYSIS_THRESHOLDS.ph.drinking.min && ph <= ANALYSIS_THRESHOLDS.ph.drinking.max;

    if (ph < ANALYSIS_THRESHOLDS.ph.acidic) {
        condition = "Acidic";
        assessment = `pH ${ph.toFixed(2)} is acidic (below ${ANALYSIS_THRESHOLDS.ph.acidic}).`;
    } else if (ph > ANALYSIS_THRESHOLDS.ph.alkaline) {
        condition = "Alkaline";
        assessment = `pH ${ph.toFixed(2)} is alkaline (above ${ANALYSIS_THRESHOLDS.ph.alkaline}).`;
    } else {
        condition = "Within reference range";
        assessment = `pH ${ph.toFixed(2)} is within the normal irrigation reference range (${ANALYSIS_THRESHOLDS.ph.irrigation.min}–${ANALYSIS_THRESHOLDS.ph.irrigation.max}).`;
    }
    return { condition, assessment, withinIrrigation, withinDrinking, value: ph };
}

function analyzeTds(value) {
    if (value === null || value === undefined) {
        return { condition: "unavailable", assessment: "TDS-based salinity analysis unavailable.", salinityIndication: "unavailable", irrigationCategory: null };
    }
    const tds = Number(value);
    let condition, assessment, salinityIndication, irrigationCategory;

    if (tds < ANALYSIS_THRESHOLDS.tds.condition.low) {
        condition = "Low";
        assessment = `TDS ${tds.toFixed(1)} mg/L is low.`;
        salinityIndication = "Non-saline";
        irrigationCategory = "none";
    } else if (tds < ANALYSIS_THRESHOLDS.tds.condition.moderate) {
        condition = "Moderate";
        assessment = `TDS ${tds.toFixed(1)} mg/L is moderate.`;
        salinityIndication = "Slightly saline";
        irrigationCategory = "none";
    } else if (tds < ANALYSIS_THRESHOLDS.tds.condition.high) {
        condition = "High";
        assessment = `TDS ${tds.toFixed(1)} mg/L is high.`;
        salinityIndication = "Moderately saline";
        irrigationCategory = "slight-moderate";
    } else {
        condition = "Very high";
        assessment = `TDS ${tds.toFixed(1)} mg/L is very high.`;
        salinityIndication = "Strongly saline";
        irrigationCategory = "severe";
    }

    // FAO irrigation categories
    if (tds < ANALYSIS_THRESHOLDS.tds.irrigation.low) {
        irrigationCategory = "none";
    } else if (tds <= ANALYSIS_THRESHOLDS.tds.irrigation.moderate) {
        irrigationCategory = "slight-moderate";
    } else {
        irrigationCategory = "severe";
    }

    return { condition, assessment, salinityIndication, irrigationCategory, value: tds };
}

function analyzeTurbidity(value) {
    if (value === null || value === undefined) {
        return { condition: "unavailable", assessment: "Turbidity analysis unavailable.", withinDrinkingTarget: null, withinDrinkingAcceptable: null };
    }
    const turb = Number(value);
    let condition, assessment;
    const withinDrinkingTarget = turb < ANALYSIS_THRESHOLDS.turbidity.drinking_target;
    const withinDrinkingAcceptable = turb < ANALYSIS_THRESHOLDS.turbidity.drinking_acceptable;

    if (turb < ANALYSIS_THRESHOLDS.turbidity.condition.low) {
        condition = "Low";
        assessment = `Turbidity ${turb.toFixed(2)} NTU is low (clear water).`;
    } else if (turb < ANALYSIS_THRESHOLDS.turbidity.condition.high) {
        condition = "Moderate";
        assessment = `Turbidity ${turb.toFixed(2)} NTU is moderate.`;
    } else {
        condition = "High";
        assessment = `Turbidity ${turb.toFixed(2)} NTU is high (cloudy water).`;
    }
    return { condition, assessment, withinDrinkingTarget, withinDrinkingAcceptable, value: turb };
}

function analyzeTemperature(value) {
    if (value === null || value === undefined) {
        return { condition: "unavailable", assessment: "Temperature analysis unavailable." };
    }
    const temp = Number(value);
    let condition, assessment;

    if (temp <= ANALYSIS_THRESHOLDS.temperature.normal_max) {
        condition = "Normal";
        assessment = `Temperature ${temp.toFixed(1)}°C is within normal range.`;
    } else if (temp <= ANALYSIS_THRESHOLDS.temperature.veryElevated) {
        condition = "Elevated";
        assessment = `Temperature ${temp.toFixed(1)}°C is elevated (above ${ANALYSIS_THRESHOLDS.temperature.normal_max}°C).`;
    } else {
        condition = "Very elevated";
        assessment = `Temperature ${temp.toFixed(1)}°C is very elevated (above ${ANALYSIS_THRESHOLDS.temperature.veryElevated}°C).`;
    }
    return { condition, assessment, value: temp };
}

function analyzeAgriculture(phResult, tdsResult, turbResult, tempResult) {
    const concerns = [];
    const reasons = [];

    // pH
    if (phResult.condition === "unavailable") {
        concerns.push("pH data missing");
    } else if (!phResult.withinIrrigation) {
        concerns.push(`pH ${phResult.value.toFixed(2)} outside irrigation reference range (${ANALYSIS_THRESHOLDS.ph.irrigation.min}–${ANALYSIS_THRESHOLDS.ph.irrigation.max})`);
        reasons.push(`pH is ${phResult.condition.toLowerCase()}`);
    } else {
        reasons.push("pH within irrigation reference range");
    }

    // TDS/Salinity
    if (tdsResult.condition === "unavailable") {
        concerns.push("TDS data missing");
    } else {
        if (tdsResult.irrigationCategory === "severe") {
            concerns.push(`TDS ${tdsResult.value.toFixed(1)} mg/L indicates severe salinity restriction for irrigation`);
            reasons.push("TDS indicates severe salinity restriction");
        } else if (tdsResult.irrigationCategory === "slight-moderate") {
            concerns.push(`TDS ${tdsResult.value.toFixed(1)} mg/L indicates slight-to-moderate salinity restriction`);
            reasons.push("TDS indicates slight-to-moderate salinity restriction");
        } else {
            reasons.push("TDS below FAO salinity restriction threshold");
        }
    }

    // Turbidity
    if (turbResult.condition === "unavailable") {
        concerns.push("Turbidity data missing");
    } else if (turbResult.condition === "High") {
        concerns.push(`Turbidity ${turbResult.value.toFixed(2)} NTU is elevated`);
        reasons.push("Elevated turbidity may affect irrigation systems");
    } else {
        reasons.push("Turbidity does not indicate major clarity concern");
    }

    // Temperature
    if (tempResult.condition === "unavailable") {
        concerns.push("Temperature data missing");
    } else if (tempResult.condition === "Elevated" || tempResult.condition === "Very elevated") {
        concerns.push(`Temperature ${tempResult.value.toFixed(1)}°C is ${tempResult.condition.toLowerCase()}`);
        reasons.push("Temperature is elevated");
    } else {
        reasons.push("Temperature does not trigger thermal warning");
    }

    // Determine status
    let status;
    if (concerns.some(c => c.includes("severe") || c.includes("pH"))) {
        status = "Restricted";
    } else if (concerns.length > 0) {
        status = "Use caution";
    } else if (phResult.condition === "unavailable" || tdsResult.condition === "unavailable" || turbResult.condition === "unavailable" || tempResult.condition === "unavailable") {
        status = "Analysis incomplete";
    } else {
        status = "Potentially suitable based on available parameters";
    }

    // Determine potentially suitable crop groups
    const suitableCrops = [];
    CROP_GROUPS.forEach(crop => {
        if (tdsResult.condition !== "unavailable") {
            if (tdsResult.irrigationCategory === "none") {
                suitableCrops.push(crop);
            } else if (tdsResult.irrigationCategory === "slight-moderate" && crop.salinityTolerance !== "low") {
                suitableCrops.push(crop);
            } else if (tdsResult.irrigationCategory === "severe" && crop.salinityTolerance === "high") {
                suitableCrops.push(crop);
            }
        }
    });

    return {
        status,
        concerns,
        reasons,
        phAssessment: phResult.assessment,
        tdsAssessment: tdsResult.assessment,
        turbidityAssessment: turbResult.assessment,
        tempAssessment: tempResult.assessment,
        suitableCrops
    };
}

function analyzeIndustry(phResult, tdsResult, turbResult, tempResult) {
    const concerns = [];
    const applications = [];

    // Non-critical applications
    const nonCriticalApps = [
        { name: "General cleaning", suitable: true, reason: "Low visual contamination acceptable" },
        { name: "Outdoor washing", suitable: true, reason: "Non-critical use" },
        { name: "Construction (concrete, dust suppression)", suitable: true, reason: "Acceptable for non-critical use" },
        { name: "Non-critical manufacturing", suitable: true, reason: "Low visual quality concerns" }
    ];

    if (phResult.condition !== "unavailable") {
        if (phResult.condition === "Acidic" || phResult.condition === "Alkaline") {
            concerns.push(`pH ${phResult.value.toFixed(2)} may cause corrosion/scaling concerns`);
            nonCriticalApps.forEach(app => { app.suitable = false; app.reason = "pH outside typical process range"; });
        }
    }

    if (tdsResult.condition !== "unavailable") {
        if (tdsResult.condition === "High" || tdsResult.condition === "Very high") {
            concerns.push(`TDS ${tdsResult.value.toFixed(1)} mg/L indicates possible scaling/corrosion`);
            nonCriticalApps.forEach(app => { app.suitable = false; app.reason = "High TDS causes scaling/corrosion"; });
        }
    }

    if (turbResult.condition !== "unavailable") {
        if (turbResult.condition === "High") {
            concerns.push(`Turbidity ${turbResult.value.toFixed(2)} NTU indicates suspended solids`);
            nonCriticalApps.forEach(app => { app.suitable = false; app.reason = "High suspended solids"; });
        }
    }

    applications.push({ category: "Non-critical applications", items: nonCriticalApps });
    applications.push({
        category: "Sensitive applications — testing required",
        items: [
            "Boiler feedwater — requires chemical testing for scaling/corrosion potential",
            "Cooling systems — requires controlled chemistry",
            "Electronics manufacturing — ultra-pure water standards",
            "Pharmaceutical manufacturing — full validation required",
            "Food processing — microbiological and chemical validation required",
            "High-purity processes — process-specific treatment required"
        ]
    });

    return { concerns, applications };
}

function analyzeGeneralUse(phResult, tdsResult, turbResult, tempResult) {
    const concerns = [];
    const uses = [
        { name: "Gardening / Irrigation", suitable: true, reason: "Potentially suitable for non-potable use" },
        { name: "Landscaping / Ornamental", suitable: true, reason: "Low visual risk for ornamental use" },
        { name: "Toilet Flushing", suitable: true, reason: "Non-contact use; visual quality less critical" },
        { name: "Outdoor Cleaning (Paths, Equipment)", suitable: true, reason: "Acceptable for non-contact cleaning" },
        { name: "Vehicle / Equipment Washing", suitable: true, reason: "Acceptable for general washing" }
    ];

    if (tdsResult.condition !== "unavailable" && (tdsResult.condition === "High" || tdsResult.condition === "Very high")) {
        concerns.push("High TDS may affect sensitive plants");
        uses[0].suitable = false; uses[0].reason = "High TDS may affect plants";
        uses[1].suitable = false; uses[1].reason = "High TDS may affect plants";
    }

    if (turbResult.condition !== "unavailable" && turbResult.condition === "High") {
        concerns.push("High turbidity indicates suspended solids");
        uses[3].suitable = false; uses[3].reason = "Suspended solids may leave residue";
        uses[4].suitable = false; uses[4].reason = "May leave residue on paint";
    }

    if (phResult.condition !== "unavailable" && (phResult.condition === "Acidic" || phResult.condition === "Alkaline")) {
        concerns.push("pH outside neutral range");
        uses[0].suitable = false; uses[0].reason = "pH may affect soil/plants";
    }

    return { concerns, uses };
}

function analyzeDrinkingScreening(phResult, tdsResult, turbResult, tempResult) {
    const params = [];

    // pH
    if (phResult.condition !== "unavailable") {
        params.push({
            name: "pH",
            value: phResult.value.toFixed(2),
            reference: `${ANALYSIS_THRESHOLDS.ph.drinking.min}–${ANALYSIS_THRESHOLDS.ph.drinking.max}`,
            assessment: phResult.withinDrinking ? "Within screening range" : "Outside screening range"
        });
    } else {
        params.push({ name: "pH", value: "—", reference: `${ANALYSIS_THRESHOLDS.ph.drinking.min}–${ANALYSIS_THRESHOLDS.ph.drinking.max}`, assessment: "Data unavailable" });
    }

    // TDS
    if (tdsResult.condition !== "unavailable") {
        params.push({
            name: "TDS",
            value: `${tdsResult.value.toFixed(1)} mg/L`,
            reference: `Secondary reference: ${ANALYSIS_THRESHOLDS.tds.drinking_secondary} mg/L`,
            assessment: tdsResult.value < ANALYSIS_THRESHOLDS.tds.drinking_secondary ? "Below reference" : "Above reference"
        });
    } else {
        params.push({ name: "TDS", value: "—", reference: `Secondary reference: ${ANALYSIS_THRESHOLDS.tds.drinking_secondary} mg/L`, assessment: "Data unavailable" });
    }

    // Turbidity
    if (turbResult.condition !== "unavailable") {
        params.push({
            name: "Turbidity",
            value: `${turbResult.value.toFixed(2)} NTU`,
            reference: `Target: <${ANALYSIS_THRESHOLDS.turbidity.drinking_target} NTU`,
            assessment: turbResult.withinDrinkingTarget ? "Below target" : "Above target"
        });
    } else {
        params.push({ name: "Turbidity", value: "—", reference: `Target: <${ANALYSIS_THRESHOLDS.turbidity.drinking_target} NTU`, assessment: "Data unavailable" });
    }

    // Temperature
    if (tempResult.condition !== "unavailable") {
        params.push({
            name: "Temperature",
            value: `${tempResult.value.toFixed(1)}°C`,
            reference: "No health-based limit",
            assessment: "Contextual only"
        });
    } else {
        params.push({ name: "Temperature", value: "—", reference: "No health-based limit", assessment: "Data unavailable" });
    }

    return { params };
}

function buildOverallAssessment(phResult, tdsResult, turbResult, tempResult, agricultureResult) {
    const missingCount = [phResult, tdsResult, turbResult, tempResult].filter(r => r.condition === "unavailable").length;

    if (missingCount === 4) {
        return { status: "unknown", title: "No sensor data available", description: "Connect a device to generate an assessment." };
    }

    if (missingCount > 0) {
        return { status: "watch", title: "Partial data", description: "Some sensor readings are missing. Assessment is based on available parameters only." };
    }

    // Check for major concerns
    const majorConcerns = [];
    if (phResult.condition === "Acidic" || phResult.condition === "Alkaline") majorConcerns.push("pH");
    if (tdsResult.irrigationCategory === "severe") majorConcerns.push("TDS (severe salinity)");
    if (turbResult.condition === "High") majorConcerns.push("Turbidity");
    if (tempResult.condition === "Very elevated") majorConcerns.push("Temperature");

    if (majorConcerns.length > 0) {
        return {
            status: "alert",
            title: "Attention required",
            description: `Key parameters need review: ${majorConcerns.join(", ")}.`
        };
    }

    return {
        status: "safe",
        title: "Sensor parameters within screening references",
        description: "Available sensor readings are within the configured screening ranges."
    };
}

function formatTimestamp(isoString) {
    if (!isoString) return "--";
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function isDataStale(isoString) {
    if (!isoString) return true;
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return true;
    const hoursDiff = (Date.now() - date.getTime()) / (1000 * 60 * 60);
    return hoursDiff > ANALYSIS_THRESHOLDS.dataFreshnessHours;
}

function updateAnalysisPage() {
    if (!latestReading) {
        // Reset to waiting state
        setText("analysisReadingTime", "--");
        setText("overallStatusTitle", "Waiting for readings");
        setText("overallStatusDescription", "Connect a sensor device to generate an assessment.");
        $("overallStatusBadge").className = "overall-status-badge unknown";
        $("overallStatusBadge").textContent = "UNKNOWN";

        ["paramTempValue", "paramPhValue", "paramTurbidityValue", "paramTdsValue"].forEach(id => setText(id, "--"));
        ["paramTempCondition", "paramPhCondition", "paramTurbidityCondition", "paramTdsCondition"].forEach(id => setText(id, "Waiting"));

        ["derivedPhCondition", "derivedTdsCondition", "derivedSalinityIndication", "derivedTurbidityCondition", "derivedTempCondition", "derivedDataQuality", "derivedDataFreshness"].forEach(id => setText(id, "--"));

        ["whyResultContent", "concernsContent", "recommendationsDetailedContent"].forEach(id => {
            const el = $(id);
            if (el) {
                if (id === "whyResultContent") el.innerHTML = '<p class="why-placeholder">Waiting for readings...</p>';
                if (id === "concernsContent") el.innerHTML = '<p class="concerns-placeholder">No major concern identified within the configured sensor screening parameters.</p>';
                if (id === "recommendationsDetailedContent") el.innerHTML = '<p class="recommendations-placeholder">Waiting for readings...</p>';
            }
        });

        // Clear tab panels
        ["analysisAgricultureContent", "analysisIndustryContent", "analysisGeneralContent", "analysisDrinkingContent"].forEach(id => {
            const el = $(id);
            if (el) el.innerHTML = "";
        });

        return;
    }

    const reading = latestReading;

    // Update reading time
    setText("analysisReadingTime", formatTimestamp(reading.recorded_at));

    // Analyze each parameter
    const phResult = analyzePh(reading.ph);
    const tdsResult = analyzeTds(reading.tds);
    const turbResult = analyzeTurbidity(reading.turbidity);
    const tempResult = analyzeTemperature(reading.temperature);

    // Update parameter cards
    setText("paramTempValue", formatNumber(reading.temperature, 1));
    setText("paramTempCondition", tempResult.condition);
    setText("paramPhValue", formatNumber(reading.ph, 2));
    setText("paramPhCondition", phResult.condition);
    setText("paramTurbidityValue", formatNumber(reading.turbidity, 2));
    setText("paramTurbidityCondition", turbResult.condition);
    setText("paramTdsValue", formatNumber(reading.tds, 1));
    setText("paramTdsCondition", tdsResult.condition);

    // Update derived parameters
    setText("derivedPhCondition", phResult.condition);
    setText("derivedTdsCondition", tdsResult.condition);
    setText("derivedSalinityIndication", tdsResult.salinityIndication);
    setText("derivedTurbidityCondition", turbResult.condition);
    setText("derivedTempCondition", tempResult.condition);

    // Data quality
    const availableParams = [reading.ph, reading.tds, reading.turbidity, reading.temperature].filter(v => v !== null && v !== undefined).length;
    setText("derivedDataQuality", availableParams === 4 ? "Complete" : `Incomplete (${availableParams}/4)`);

    // Data freshness
    const stale = isDataStale(reading.recorded_at);
    setText("derivedDataFreshness", stale ? "Data may be stale" : "Fresh");

    // Overall assessment
    const overall = buildOverallAssessment(phResult, tdsResult, turbResult, tempResult);
    setText("overallStatusTitle", overall.title);
    setText("overallStatusDescription", overall.description);
    const badge = $("overallStatusBadge");
    badge.className = `overall-status-badge ${overall.status}`;
    badge.textContent = overall.status.toUpperCase();

    // Analyze water uses
    const agriculture = analyzeAgriculture(phResult, tdsResult, turbResult, tempResult);
    const industry = analyzeIndustry(phResult, tdsResult, turbResult, tempResult);
    const general = analyzeGeneralUse(phResult, tdsResult, turbResult, tempResult);
    const drinking = analyzeDrinkingScreening(phResult, tdsResult, turbResult, tempResult);

    // Render tab panels
    renderAgricultureTab(agriculture, phResult, tdsResult, turbResult, tempResult);
    renderIndustryTab(industry, phResult, tdsResult, turbResult, tempResult);
    renderGeneralTab(general, phResult, tdsResult, turbResult, tempResult);
    renderDrinkingTab(drinking, phResult, tdsResult, turbResult, tempResult);

    // Why This Result?
    renderWhyResult(phResult, tdsResult, turbResult, tempResult, agriculture, industry, general, drinking);

    // Key Concerns
    renderKeyConcerns(phResult, tdsResult, turbResult, tempResult, agriculture, industry, general, stale);

    // Recommendations
    renderRecommendations(agriculture, industry, general, drinking, phResult, tdsResult, turbResult, tempResult, stale);
}

function renderAgricultureTab(agriculture, phResult, tdsResult, turbResult, tempResult) {
    const el = $("analysisAgricultureContent");
    if (!el) return;

    let html = `
        <div class="analysis-panel-section">
            <h5>Irrigation Screening</h5>
            <p class="analysis-status ${agriculture.status.toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(agriculture.status)}</p>
        </div>
    `;

    html += `
        <div class="analysis-panel-section">
            <h5>Parameter Assessments</h5>
            <div class="analysis-assessment-grid">
                <div><strong>pH:</strong> ${escapeHtml(phResult.assessment)}</div>
                <div><strong>TDS/Salinity:</strong> ${escapeHtml(tdsResult.assessment)} (${escapeHtml(tdsResult.salinityIndication)})</div>
                <div><strong>Turbidity:</strong> ${escapeHtml(turbResult.assessment)}</div>
                <div><strong>Temperature:</strong> ${escapeHtml(tempResult.assessment)}</div>
            </div>
        </div>
    `;

    if (agriculture.suitableCrops.length > 0) {
        html += `
            <div class="analysis-panel-section">
                <h5>Potentially Suitable Crop Groups</h5>
                <p class="crop-disclaimer">Based on salinity tolerance only. Crop-specific suitability requires additional assessment (soil, climate, EC, SAR, chloride, boron, irrigation method).</p>
                <div class="crop-groups-grid">
                    ${agriculture.suitableCrops.map(crop => `<span class="crop-tag">${escapeHtml(crop.name)} (${escapeHtml(crop.category)})</span>`).join("")}
                </div>
            </div>
        `;
    } else {
        html += `
            <div class="analysis-panel-section">
                <h5>Crop Groups</h5>
                <p>No crop groups identified as potentially suitable based on current salinity levels. Further assessment needed.</p>
            </div>
        `;
    }

    el.innerHTML = html;
}

function renderIndustryTab(industry, phResult, tdsResult, turbResult, tempResult) {
    const el = $("analysisIndustryContent");
    if (!el) return;

    let html = `
        <div class="analysis-panel-section">
            <h5>Industrial Screening</h5>
            <p class="industry-disclaimer">Industry requirements vary greatly by process. This is a preliminary screening based on four sensor parameters only.</p>
        </div>
    `;

    industry.applications.forEach(app => {
        if (app.items && Array.isArray(app.items)) {
            html += `
                <div class="analysis-panel-section">
                    <h5>${escapeHtml(app.category)}</h5>
                    <ul class="analysis-list">
                        ${app.items.map(item => {
                            if (typeof item === "object") {
                                return `<li><strong>${escapeHtml(item.name)}:</strong> ${escapeHtml(item.suitable ? "Potentially suitable" : "Not recommended")} — ${escapeHtml(item.reason)}</li>`;
                            }
                            return `<li>${escapeHtml(item)}</li>`;
                        }).join("")}
                    </ul>
                </div>
            `;
        }
    });

    if (industry.concerns.length > 0) {
        html += `
            <div class="analysis-panel-section">
                <h5>Concerns</h5>
                <ul class="analysis-list concerns-list">
                    ${industry.concerns.map(c => `<li>${escapeHtml(c)}</li>`).join("")}
                </ul>
            </div>
        `;
    }

    el.innerHTML = html;
}

function renderGeneralTab(general, phResult, tdsResult, turbResult, tempResult) {
    const el = $("analysisGeneralContent");
    if (!el) return;

    let html = `
        <div class="analysis-panel-section">
            <h5>General / Non-Potable Use Screening</h5>
            <p class="general-disclaimer">Preliminary assessment based on available sensor parameters. Does not guarantee suitability.</p>
        </div>
    `;

    html += `
        <div class="analysis-panel-section">
            <h5>Potential Applications</h5>
            <div class="general-use-grid">
                ${general.uses.map(use => `
                    <div class="general-use-card ${use.suitable ? "suitable" : "caution"}">
                        <h6>${escapeHtml(use.name)}</h6>
                        <span class="suitability-badge">${use.suitable ? "Potentially suitable" : "Use caution"}</span>
                        <p>${escapeHtml(use.reason)}</p>
                    </div>
                `).join("")}
            </div>
        </div>
    `;

    if (general.concerns.length > 0) {
        html += `
            <div class="analysis-panel-section">
                <h5>Concerns</h5>
                <ul class="analysis-list concerns-list">
                    ${general.concerns.map(c => `<li>${escapeHtml(c)}</li>`).join("")}
                </ul>
            </div>
        `;
    }

    html += `
        <div class="analysis-panel-section drinking-warning">
            <h5><i class="ri-water-flash-line"></i> Drinking & Cooking</h5>
            <p><strong>These sensors cannot determine drinking-water safety.</strong> Microbiological and chemical testing is required. Visual assessment cannot detect pathogens, dissolved chemicals, heavy metals, or other contaminants.</p>
        </div>
    `;

    el.innerHTML = html;
}

function renderDrinkingTab(drinking, phResult, tdsResult, turbResult, tempResult) {
    const el = $("analysisDrinkingContent");
    if (!el) return;

    let html = `
        <div class="analysis-panel-section">
            <h5>Drinking-Water Parameter Screening</h5>
            <p class="drinking-disclaimer">This is a screening assessment only. It does NOT determine if water is safe to drink.</p>
        </div>

        <div class="analysis-panel-section">
            <h5>Parameter Comparison</h5>
            <div class="drinking-params-table">
                <table>
                    <thead>
                        <tr><th>Parameter</th><th>Measured</th><th>Reference / Target</th><th>Assessment</th></tr>
                    </thead>
                    <tbody>
                        ${drinking.params.map(p => `
                            <tr>
                                <td>${escapeHtml(p.name)}</td>
                                <td>${escapeHtml(p.value)}</td>
                                <td>${escapeHtml(p.reference)}</td>
                                <td class="${p.assessment.includes("Below") || p.assessment.includes("Within") ? "good" : (p.assessment.includes("Data unavailable") ? "unavailable" : "attention")}">${escapeHtml(p.assessment)}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="analysis-panel-section drinking-conclusion">
            <h5>Drinking-Water Conclusion</h5>
            <p><strong>These measurements provide a screening assessment only.</strong> Chemical and microbiological testing is required before declaring water safe for consumption.</p>
            <p>The available sensors (pH, temperature, TDS, turbidity) cannot determine:</p>
            <ul>
                <li>Bacteria, viruses, pathogens</li>
                <li>Heavy metals (lead, arsenic, mercury, etc.)</li>
                <li>Pesticides and organic contaminants</li>
                <li>Many dissolved chemicals</li>
                <li>Complete chemical composition</li>
            </ul>
        </div>
    `;

    el.innerHTML = html;
}

function renderWhyResult(phResult, tdsResult, turbResult, tempResult, agriculture, industry, general, drinking) {
    const el = $("whyResultContent");
    if (!el) return;

    const items = [];

    if (phResult.condition !== "unavailable") {
        if (phResult.withinIrrigation) {
            items.push(`<span class="why-item good">✓ pH ${phResult.value.toFixed(2)} is within the irrigation reference range (${ANALYSIS_THRESHOLDS.ph.irrigation.min}–${ANALYSIS_THRESHOLDS.ph.irrigation.max})</span>`);
        } else {
            items.push(`<span class="why-item warning">⚠ pH ${phResult.value.toFixed(2)} is ${phResult.condition.toLowerCase()} (outside irrigation reference ${ANALYSIS_THRESHOLDS.ph.irrigation.min}–${ANALYSIS_THRESHOLDS.ph.irrigation.max})</span>`);
        }
    } else {
        items.push(`<span class="why-item unavailable">— pH data unavailable</span>`);
    }

    if (tdsResult.condition !== "unavailable") {
        if (tdsResult.irrigationCategory === "none") {
            items.push(`<span class="why-item good">✓ TDS ${tdsResult.value.toFixed(1)} mg/L is below the FAO slight/moderate restriction threshold (${ANALYSIS_THRESHOLDS.tds.irrigation.low} mg/L)</span>`);
        } else if (tdsResult.irrigationCategory === "slight-moderate") {
            items.push(`<span class="why-item warning">⚠ TDS ${tdsResult.value.toFixed(1)} mg/L indicates slight-to-moderate salinity restriction for irrigation</span>`);
        } else {
            items.push(`<span class="why-item warning">⚠ TDS ${tdsResult.value.toFixed(1)} mg/L indicates severe salinity restriction for irrigation</span>`);
        }
    } else {
        items.push(`<span class="why-item unavailable">— TDS data unavailable</span>`);
    }

    if (turbResult.condition !== "unavailable") {
        if (turbResult.condition === "Low") {
            items.push(`<span class="why-item good">✓ Turbidity ${turbResult.value.toFixed(2)} NTU is low (no major clarity concern)</span>`);
        } else {
            items.push(`<span class="why-item warning">⚠ Turbidity ${turbResult.value.toFixed(2)} NTU is ${turbResult.condition.toLowerCase()}</span>`);
        }
    } else {
        items.push(`<span class="why-item unavailable">— Turbidity data unavailable</span>`);
    }

    if (tempResult.condition !== "unavailable") {
        if (tempResult.condition === "Normal") {
            items.push(`<span class="why-item good">✓ Temperature ${tempResult.value.toFixed(1)}°C is within normal range</span>`);
        } else {
            items.push(`<span class="why-item warning">⚠ Temperature ${tempResult.value.toFixed(1)}°C is ${tempResult.condition.toLowerCase()}</span>`);
        }
    } else {
        items.push(`<span class="why-item unavailable">— Temperature data unavailable</span>`);
    }

    el.innerHTML = `<div class="why-result-list">${items.join("")}</div>`;
}

function renderKeyConcerns(phResult, tdsResult, turbResult, tempResult, agriculture, industry, general, stale) {
    const el = $("concernsContent");
    if (!el) return;

    const concerns = [];

    if (phResult.condition === "Acidic" || phResult.condition === "Alkaline") {
        concerns.push(`pH ${phResult.value.toFixed(2)} is ${phResult.condition.toLowerCase()}`);
    }

    if (tdsResult.condition !== "unavailable" && (tdsResult.condition === "High" || tdsResult.condition === "Very high")) {
        concerns.push(`Elevated TDS (${tdsResult.value.toFixed(1)} mg/L) — ${tdsResult.salinityIndication}`);
    }

    if (turbResult.condition !== "unavailable" && turbResult.condition === "High") {
        concerns.push(`High turbidity (${turbResult.value.toFixed(2)} NTU)`);
    }

    if (tempResult.condition !== "unavailable" && (tempResult.condition === "Elevated" || tempResult.condition === "Very elevated")) {
        concerns.push(`Elevated temperature (${tempResult.value.toFixed(1)}°C)`);
    }

    if (stale) {
        concerns.push("Sensor data may be stale (older than 24 hours)");
    }

    if (phResult.condition === "unavailable") concerns.push("pH data missing");
    if (tdsResult.condition === "unavailable") concerns.push("TDS data missing");
    if (turbResult.condition === "unavailable") concerns.push("Turbidity data missing");
    if (tempResult.condition === "unavailable") concerns.push("Temperature data missing");

    if (concerns.length === 0) {
        el.innerHTML = '<p class="concerns-placeholder">No major concern identified within the configured sensor screening parameters.</p>';
    } else {
        el.innerHTML = `
            <ul class="concerns-list">
                ${concerns.map(c => `<li>⚠ ${escapeHtml(c)}</li>`).join("")}
            </ul>
        `;
    }
}

function renderRecommendations(agriculture, industry, general, drinking, phResult, tdsResult, turbResult, tempResult, stale) {
    const el = $("recommendationsDetailedContent");
    if (!el) return;

    const recs = [];

    // Agriculture
    if (agriculture.status === "Potentially suitable based on available parameters") {
        recs.push({
            title: "Agriculture",
            text: "Potentially suitable for preliminary irrigation consideration based on the available sensor parameters. Crop-specific suitability requires additional assessment (EC, SAR, chloride, boron, soil, crop tolerance).",
            type: "good"
        });
    } else if (agriculture.status === "Use caution") {
        recs.push({
            title: "Agriculture",
            text: "Additional water-quality testing is recommended before irrigation. Salinity and/or pH may require management.",
            type: "caution"
        });
    } else if (agriculture.status === "Restricted") {
        recs.push({
            title: "Agriculture",
            text: "Not recommended for direct irrigation based on current sensor parameters. Treatment and further testing required.",
            type: "alert"
        });
    } else {
        recs.push({
            title: "Agriculture",
            text: "Irrigation assessment incomplete due to missing sensor data.",
            type: "caution"
        });
    }

    // Industry
    recs.push({
        title: "Industry",
        text: "Process-specific treatment and water-quality testing are required for sensitive applications (boilers, cooling, electronics, pharma, food, high-purity). Non-critical uses may be suitable depending on parameters.",
        type: "info"
    });

    // General
    recs.push({
        title: "General / Non-potable",
        text: "Potentially suitable for consideration based on the available sensor parameters (gardening, landscaping, toilet flushing, outdoor cleaning).",
        type: "good"
    });

    // Drinking
    recs.push({
        title: "Drinking",
        text: "Drinking-water safety cannot be established from these sensor measurements alone. Chemical and microbiological testing is required.",
        type: "alert"
    });

    if (stale) {
        recs.push({
            title: "Data Freshness",
            text: "Sensor data may be stale. Consider refreshing readings for current conditions.",
            type: "caution"
        });
    }

    let html = `<div class="recommendations-grid">`;
    recs.forEach(r => {
        html += `
            <div class="recommendation-card ${r.type}">
                <h6>${escapeHtml(r.title)}</h6>
                <p>${escapeHtml(r.text)}</p>
            </div>
        `;
    });
    html += `</div>`;

    el.innerHTML = html;
}

function setupAnalysisTabs() {
    document.addEventListener("click", (e) => {
        const tab = e.target.closest(".analysis-tab");
        if (tab) {
            const tabName = tab.dataset.analysisTab;
            switchAnalysisTab(tabName);
        }
    });
}

function switchAnalysisTab(tabName) {
    const tabs = document.querySelectorAll(".analysis-tab");
    const panels = document.querySelectorAll(".analysis-tab-panel");

    tabs.forEach(t => {
        const isActive = t.dataset.analysisTab === tabName;
        t.classList.toggle("active", isActive);
        t.setAttribute("aria-selected", isActive);
    });

    panels.forEach(panel => {
        panel.classList.toggle("active", panel.id === `panelAnalysis${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
    });
}

// Call setupAnalysisTabs during initialization
// This will be called from initializeApp

''';

    new_content = content[:insert_pos] + analysis_js + content[insert_pos:]
    with open('D:/aqua-ai/frontend/app.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print('Inserted Analysis JavaScript successfully')
else:
    print('Could not find insert position')