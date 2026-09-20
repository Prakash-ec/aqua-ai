import re
import sys

with open('frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

def replace_func(func_name, new_code):
    global content
    pattern = r"function\s+" + func_name + r"\s*\([^)]*\)\s*\{"
    match = re.search(pattern, content)
    if not match:
        print(f"Could not find {func_name}")
        return
    start_idx = match.start()
    braces = 0
    in_func = False
    end_idx = -1
    for i in range(start_idx, len(content)):
        if content[i] == '{':
            braces += 1
            in_func = True
        elif content[i] == '}':
            braces -= 1
        
        if in_func and braces == 0:
            end_idx = i + 1
            break
            
    if end_idx != -1:
        content = content[:start_idx] + new_code + content[end_idx:]
        print(f"Replaced {func_name}")
    else:
        print(f"Could not find end of {func_name}")

score_target_range = """function scoreTargetRange(value, idealMin, idealMax, lowerLimit, upperLimit) {
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
}"""

score_clarity = """function scoreClarity(turbidity) {
    if (turbidity === null) return null;
    if (turbidity <= 1) return 100;
    if (turbidity <= 5) {
        return clamp(100 - 40 * (turbidity - 1) / 4, 60, 100);
    }
    if (turbidity <= 20) {
        return clamp(60 - 60 * (turbidity - 5) / 15, 0, 60);
    }
    return 0;
}"""

score_tds = """function scoreTDS(tds, tdsLimit) {
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
}"""

calculate_salinity_score = """function calculateSalinityScore(reading, ecTolerance) {
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
}"""

compute_reading_quality = """function computeReadingQuality(reading) {
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
        description = "One or more sensor readings are critically outside configured safe limits. Aqua AI analytical safeguard applied.";
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
}"""

calculate_app_score = """function calculateApplicationScore(reading, profile) {
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
}"""

calculate_crop_score = """function calculateCropScore(reading, crop) {
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
}"""

calculate_drinking = """function calculateDrinkingScreening(reading) {
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
    params.push({ name: 'Temperature', value: temperature, unit: ' \\u00B0C', refRange: 'Contextual', met: temperature !== null ? true : null });
    var paramScores = { 'pH': phScore, 'TDS': tdsScore, 'Turbidity': turbScore };
    var paramNames = { 'pH': 'pH', 'TDS': 'TDS', 'Turbidity': 'Turbidity' };
    
    var status = "safe";
    var title = "Meets screening criteria";
    var description = "Sensor data generally meets baseline screening criteria. Note: this does not assess pathogens or heavy metals.";
    
    if (score < 50) {
        status = "alert";
        title = "Below screening criteria";
        description = "One or more parameters are critically outside screening limits. Aqua AI analytical safeguard applied.";
    } else if (score < 80) {
        status = "watch";
        title = "Mixed screening result";
        description = "Some parameters approach or exceed screening boundaries.";
    }
    
    return { score: score, params: params, reason: generateReason(paramScores, paramNames), status: status, title: title, description: description };
}"""

replace_func('scoreTargetRange', score_target_range)
replace_func('scoreClarity', score_clarity)
replace_func('scoreTDS', score_tds)
replace_func('calculateSalinityScore', calculate_salinity_score)
replace_func('computeReadingQuality', compute_reading_quality)
replace_func('calculateApplicationScore', calculate_app_score)
replace_func('calculateCropScore', calculate_crop_score)
replace_func('calculateDrinkingScreening', calculate_drinking)

with open('frontend/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
