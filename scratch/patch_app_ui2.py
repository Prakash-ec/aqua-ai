import re

with open('frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

new_update_analysis = """function updateAnalysisPage() {
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
        ['analysisSummary','analysisCurrentParams','analysisDerivedParams','analysisScoreSection','analysisKeyLimitingFactor','analysisCropSection','analysisIndustrialSection','analysisDomesticSection','analysisGeneralSection','analysisDrinkingSection','analysisCategorySummary'].forEach(function(id) { setAnalysisHtml(id, ''); });
        setAnalysisNotice('');
        return;
    }
    
    var reading = latestReading;
    setAnalysisNotice('');
    setText('analysisReadingTime', reading.recorded_at ? formatTimestamp(reading.recorded_at) : 'No timestamp');
    
    // Calculate raw and scores
    var quality = computeReadingQuality(reading);
    var t = analysisNumber(reading.temperature);
    var ph = analysisNumber(reading.ph);
    var turb = analysisNumber(reading.turbidity);
    var tds = analysisNumber(reading.tds);
    var derived = calculateDerivedParameters(reading);
    
    var tScore = t !== null ? scoreTargetRange(t, 15, 30, 5, 40) : null;
    var phScore = ph !== null ? scoreTargetRange(ph, 6.5, 8.5, 4.5, 10.5) : null;
    var turbScore = turb !== null ? scoreClarity(turb) : null;
    var tdsScore = tds !== null ? scoreTDS(tds, 1000) : null;
    
    var getStatus = function(sc) {
        if (sc === null) return { text: 'Unknown', color: 'var(--text-muted)' };
        if (sc >= 85) return { text: 'Optimal', color: 'var(--status-normal)' };
        if (sc >= 70) return { text: 'Good', color: 'var(--status-normal)' };
        if (sc >= 50) return { text: 'Moderate', color: 'var(--status-monitor)' };
        if (sc >= 30) return { text: 'Limiting', color: 'var(--status-critical)' };
        return { text: 'Poor', color: 'var(--status-critical)' };
    };

    // 1. Water Quality Summary
    var summaryHtml = `
        <div style="display: flex; align-items: center; gap: 24px; padding-bottom: 8px;">
            <div style="width: 80px; height: 80px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: ${quality.score >= 80 ? 'var(--status-normal-bg)' : (quality.score >= 50 ? 'var(--status-monitor-bg)' : 'var(--status-critical-bg)')}; border: 2px solid ${quality.score >= 80 ? 'var(--status-normal)' : (quality.score >= 50 ? 'var(--status-monitor)' : 'var(--status-critical)')};">
                <span style="font-size: 28px; font-weight: 700; color: var(--text-primary); line-height: 1;">${quality.score}%</span>
                <span style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase;">Score</span>
            </div>
            <div>
                <h4 style="font-size: 18px; margin: 0 0 4px 0; color: var(--text-primary);">${quality.title}</h4>
                <p style="margin: 0; color: var(--text-secondary); font-size: 14px;">${quality.description}</p>
            </div>
        </div>
    `;
    setAnalysisHtml('analysisSummary', summaryHtml);

    // 2. Current Parameters
    var curParams = [
        { name: 'pH', value: ph !== null ? formatNumber(ph, 2) : '--', unit: '', icon: 'ri-test-tube-line', stat: getStatus(phScore) },
        { name: 'Turbidity', value: turb !== null ? formatNumber(turb, 2) : '--', unit: 'NTU', icon: 'ri-contrast-drop-2-line', stat: getStatus(turbScore) },
        { name: 'TDS', value: tds !== null ? formatNumber(tds, 0) : '--', unit: 'mg/L', icon: 'ri-flask-line', stat: getStatus(tdsScore) },
        { name: 'Temperature', value: t !== null ? formatNumber(t, 1) : '--', unit: '°C', icon: 'ri-temp-hot-line', stat: getStatus(tScore) }
    ];
    
    var curHtml = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">';
    curParams.forEach(function(p) {
        curHtml += `
            <div style="background: var(--bg-soft); border-radius: 12px; padding: 16px; border: 1px solid var(--border-light); box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="${p.icon}" style="font-size: 18px; color: var(--text-muted);"></i>
                        <span style="font-size: 13px; color: var(--text-secondary); font-weight: 500;">${p.name}</span>
                    </div>
                </div>
                <div style="display: flex; align-items: baseline; gap: 4px; margin-bottom: 4px;">
                    <span style="font-size: 24px; font-weight: 600; color: var(--text-primary);">${p.value}</span>
                    <span style="font-size: 13px; color: var(--text-muted);">${p.unit}</span>
                </div>
                <div style="font-size: 13px; font-weight: 500; color: ${p.stat.color}; margin-top: 4px;">${p.stat.text}</div>
            </div>
        `;
    });
    curHtml += '</div>';
    setAnalysisHtml('analysisCurrentParams', curHtml);
    
    // 3. Derived Parameters
    var derivedHtml = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px;">';
    var derivedItems = [
        { name: 'Estimated EC', value: derived.estimatedEC !== null ? formatNumber(derived.estimatedEC, 2) : '--', unit: 'dS/m' },
        { name: 'H⁺ Concentration', value: derived.hydrogenIonConcentration !== null ? formatScientific(derived.hydrogenIonConcentration) : '--', unit: 'mol/L' },
        { name: 'Salinity', value: derived.salinityClass || '--', unit: '' },
        { name: 'Clarity', value: derived.clarityIndex !== null ? Math.round(derived.clarityIndex) + '%' : '--', unit: '' },
        { name: 'pH Index', value: derived.phIndex !== null ? Math.round(derived.phIndex) + '%' : '--', unit: '' },
        { name: 'Temperature Index', value: derived.temperatureIndex !== null ? Math.round(derived.temperatureIndex) + '%' : '--', unit: '' }
    ];
    
    derivedItems.forEach(function(item) {
        derivedHtml += `
            <div style="background: var(--bg-soft); border-radius: 12px; padding: 12px; border: 1px solid var(--border-light); box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; font-weight: 500;">${item.name}</div>
                <div style="display: flex; align-items: baseline; gap: 4px;">
                    <span style="font-size: 16px; font-weight: 600; color: var(--text-primary);">${item.value}</span>
                    <span style="font-size: 11px; color: var(--text-muted);">${item.unit}</span>
                </div>
            </div>
        `;
    });
    derivedHtml += '</div>';
    setAnalysisHtml('analysisDerivedParams', derivedHtml);
    
    // 4. Score Breakdown
    var scoreItems = [
        { name: 'pH', score: phScore },
        { name: 'Salinity', score: derived.salinityIndex },
        { name: 'Clarity', score: derived.clarityIndex },
        { name: 'Temperature', score: derived.temperatureIndex }
    ];
    
    var minParam = null;
    var minVal = 101;
    var breakHtml = '<div style="display: flex; flex-direction: column; gap: 16px; max-width: 600px;">';
    breakHtml += '<p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">Overall analytical score is calculated from the available measured parameters using Aqua AI\\'s configured scoring model.</p>';
    
    scoreItems.forEach(function(p) {
        if (p.score !== null && p.score < minVal) {
            minVal = p.score;
            minParam = p.name;
        }
        var sValNum = p.score !== null ? Math.round(p.score) : 0;
        var sVal = p.score !== null ? sValNum + '%' : '--';
        var barColor = 'var(--text-muted)';
        if (p.score !== null) {
            if (p.score >= 80) barColor = 'var(--status-normal)';
            else if (p.score >= 50) barColor = 'var(--status-monitor)';
            else barColor = 'var(--status-critical)';
        }
        
        breakHtml += `
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <div style="display: flex; justify-content: space-between; font-size: 14px; align-items: baseline;">
                    <strong style="color: var(--text-primary);">${p.name}</strong>
                    <span style="color: var(--text-primary); font-weight: 700;">${sVal}</span>
                </div>
                <div style="height: 10px; background: rgba(128,128,128,0.15); border-radius: 5px; overflow: hidden; width: 100%;">
                    <div style="height: 100%; width: ${p.score !== null ? Math.max(0, Math.min(100, p.score)) : 0}%; background: ${barColor}; transition: width 0.5s ease; border-radius: 5px;"></div>
                </div>
            </div>
        `;
    });
    breakHtml += '</div>';
    setAnalysisHtml('analysisScoreSection', breakHtml);
    
    // Application Profiles
    var cropResults = CROP_PROFILES.map(function(crop) { return calculateCropScore(reading, crop); }).sort(function(a, b) { return (b.suitability || 0) - (a.suitability || 0); });
    var indResults = INDUSTRIAL_PROFILES.map(function(p) { return calculateApplicationScore(reading, p); }).sort(function(a, b) { return (b.suitability || 0) - (a.suitability || 0); });
    var domResults = DOMESTIC_PROFILES.map(function(p) { return calculateApplicationScore(reading, p); }).sort(function(a, b) { return (b.suitability || 0) - (a.suitability || 0); });
    var genResults = GENERAL_PROFILES.map(function(p) { return calculateApplicationScore(reading, p); }).sort(function(a, b) { return (b.suitability || 0) - (a.suitability || 0); });
    
    // 5. Category Summary
    var summaryHtmlCat = `
        <div style="background: var(--bg-soft); border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid var(--border-light);">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
                <div style="display: flex; justify-content: space-between; font-size: 13px;">
                    <span style="color: var(--text-secondary);">Agriculture</span>
                    <span style="color: var(--text-primary);">Top match: <strong>${cropResults.length > 0 ? cropResults[0].crop : '--'}</strong> ${cropResults.length > 0 && cropResults[0].suitability !== null ? Math.round(cropResults[0].suitability) + '%' : ''}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px;">
                    <span style="color: var(--text-secondary);">Industry</span>
                    <span style="color: var(--text-primary);">Top match: <strong>${indResults.length > 0 ? indResults[0].name : '--'}</strong> ${indResults.length > 0 && indResults[0].suitability !== null ? Math.round(indResults[0].suitability) + '%' : ''}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px;">
                    <span style="color: var(--text-secondary);">Domestic</span>
                    <span style="color: var(--text-primary);">Top match: <strong>${domResults.length > 0 ? domResults[0].name : '--'}</strong> ${domResults.length > 0 && domResults[0].suitability !== null ? Math.round(domResults[0].suitability) + '%' : ''}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px;">
                    <span style="color: var(--text-secondary);">Utility</span>
                    <span style="color: var(--text-primary);">Top match: <strong>${genResults.length > 0 ? genResults[0].name : '--'}</strong> ${genResults.length > 0 && genResults[0].suitability !== null ? Math.round(genResults[0].suitability) + '%' : ''}</span>
                </div>
            </div>
        </div>
    `;
    setAnalysisHtml('analysisCategorySummary', summaryHtmlCat);

    var ch = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">';
    cropResults.slice(0, 5).forEach(function(r, i) { ch += renderCompactRow(r.crop, r.suitability, r, 'crop' + i); });
    ch += '</div>';
    setAnalysisHtml('analysisCropSection', ch);
    
    var ih = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">';
    indResults.forEach(function(r, i) { ih += renderCompactRow(r.name, r.suitability, r, 'ind' + i); });
    ih += '</div>';
    setAnalysisHtml('analysisIndustrialSection', ih);
    
    var domh = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">';
    domResults.forEach(function(r, i) { domh += renderCompactRow(r.name, r.suitability, r, 'dom' + i); });
    domh += '</div>';
    setAnalysisHtml('analysisDomesticSection', domh);
    
    var gh = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">';
    genResults.forEach(function(r, i) { gh += renderCompactRow(r.name, r.suitability, r, 'gen' + i); });
    gh += '</div>';
    setAnalysisHtml('analysisGeneralSection', gh);
    
    // 6. Drinking Screening
    var drinking = calculateDrinkingScreening(reading);
    var drinkScoreNum = drinking.score !== null ? Math.round(drinking.score) : 0;
    var drinkScoreStr = drinking.score !== null ? drinkScoreNum + '%' : '--';
    var dColor = 'var(--text-muted)';
    if (drinking.score !== null) {
        if (drinking.score >= 85) dColor = 'var(--status-normal)';
        else if (drinking.score >= 70) dColor = 'var(--status-normal)';
        else if (drinking.score >= 50) dColor = 'var(--status-monitor)';
        else if (drinking.score >= 30) dColor = 'var(--status-critical)';
        else dColor = 'var(--status-critical)';
    }

    var drinkHtml = `
        <div style="background: var(--bg-soft); border-radius: 12px; padding: 20px; border: 1px solid var(--border-light); box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
                <strong style="font-size: 16px; color: var(--text-primary);">Drinking Water Screening</strong>
                <span style="font-weight: 700; font-size: 18px; color: var(--text-primary);">${drinkScoreStr}</span>
            </div>
            <div style="margin-bottom: 12px;">
                <div style="height: 10px; background: rgba(128,128,128,0.15); border-radius: 5px; overflow: hidden; width: 100%;">
                    <div style="height: 100%; width: ${drinking.score !== null ? Math.max(0, Math.min(100, drinking.score)) : 0}%; background: ${dColor}; transition: width 0.5s ease; border-radius: 5px;"></div>
                </div>
            </div>
            <p style="font-size: 14px; font-weight: 500; color: ${dColor}; margin: 0 0 8px 0;">${drinking.title}</p>
            <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 12px 0;">${drinking.description}</p>
            <p style="font-size: 12px; color: var(--text-muted); margin: 0; border-top: 1px solid var(--border-light); padding-top: 12px;"><strong>Limiting Factors:</strong> ${drinking.reason}</p>
        </div>
    `;
    setAnalysisHtml('analysisDrinkingSection', drinkHtml);
    
    // Add event listeners for expand/collapse (using event delegation globally in a real app, but we will use inline onclick for simplicity here or add listeners dynamically).
}

window.toggleAnalysisDetails = function(id) {
    var el = document.getElementById(id);
    var btn = document.getElementById(id + '-btn');
    if (el && btn) {
        if (el.style.display === 'none') {
            el.style.display = 'block';
            btn.innerHTML = '[ Hide score details &#9650; ]';
            btn.setAttribute('aria-expanded', 'true');
        } else {
            el.style.display = 'none';
            btn.innerHTML = '[ View score details &#9660; ]';
            btn.setAttribute('aria-expanded', 'false');
        }
    }
};

function renderCompactRow(name, score, resultObj, uid) {
    var sValNum = score !== null ? Math.round(score) : 0;
    var sValStr = score !== null ? sValNum + '%' : '--';
    
    var color = 'var(--text-muted)';
    var label = 'Unknown';
    if (score !== null) {
        if (sValNum >= 85) { color = 'var(--status-normal)'; label = 'Highly Suitable'; }
        else if (sValNum >= 70) { color = 'var(--status-normal)'; label = 'Suitable'; }
        else if (sValNum >= 50) { color = 'var(--status-monitor)'; label = 'Moderately Suitable'; }
        else if (sValNum >= 30) { color = 'var(--status-critical)'; label = 'Low Suitability'; }
        else { color = 'var(--status-critical)'; label = 'Poor Match'; }
    }
    
    // Determine limiting factor
    var limitingMsg = "The available sensor parameters are within the configured range for this application.";
    var minSc = 101;
    var minParams = [];
    
    var params = [];
    if (resultObj.phScore !== undefined) params.push({ name: 'pH', score: resultObj.phScore });
    if (resultObj.tdsScore !== undefined) params.push({ name: 'TDS/salinity', score: resultObj.tdsScore });
    if (resultObj.salinityScore !== undefined) params.push({ name: 'TDS/salinity', score: resultObj.salinityScore });
    if (resultObj.turbidityScore !== undefined) params.push({ name: 'Turbidity', score: resultObj.turbidityScore });
    if (resultObj.temperatureScore !== undefined) params.push({ name: 'Temperature', score: resultObj.temperatureScore });
    
    params.forEach(function(p) {
        if (p.score !== null && p.score < minSc) {
            minSc = p.score;
        }
    });
    
    if (minSc < 85) {
        params.forEach(function(p) {
            if (p.score !== null && Math.abs(p.score - minSc) < 1) {
                if (minParams.indexOf(p.name) === -1) minParams.push(p.name);
            }
        });
        if (minParams.length > 0) {
            limitingMsg = minParams.join(' + ') + " is the main limiting factor.";
        }
    }

    var detailsHtml = '<div style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">';
    params.forEach(function(p) {
        var pColor = 'var(--text-muted)';
        if (p.score !== null) {
            if (p.score >= 80) pColor = 'var(--status-normal)';
            else if (p.score >= 50) pColor = 'var(--status-monitor)';
            else pColor = 'var(--status-critical)';
        }
        detailsHtml += `
            <div>
                <div style="display: flex; justify-content: space-between; font-size: 13px; align-items: baseline;">
                    <span style="color: var(--text-secondary);">${p.name}</span>
                    <span style="color: var(--text-primary); font-weight: 600;">${p.score !== null ? Math.round(p.score) + '%' : '--'}</span>
                </div>
                <div style="height: 4px; background: rgba(128,128,128,0.15); border-radius: 2px; overflow: hidden; width: 100%; margin-top: 2px;">
                    <div style="height: 100%; width: ${p.score !== null ? Math.max(0, Math.min(100, p.score)) : 0}%; background: ${pColor}; transition: width 0.5s ease; border-radius: 2px;"></div>
                </div>
            </div>
        `;
    });
    detailsHtml += '</div>';
    
    return `
        <div style="display: flex; flex-direction: column; padding: 16px; background: var(--bg-soft); border-radius: 12px; border: 1px solid var(--border-light); box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <strong style="font-size: 15px; color: var(--text-primary);">${name}</strong>
                <span style="font-weight: 700; font-size: 16px; color: var(--text-primary);">${sValStr}</span>
            </div>
            <div style="font-size: 13px; font-weight: 500; color: ${color}; margin-top: 2px; margin-bottom: 8px;">${label}</div>
            
            <div style="height: 10px; background: rgba(128,128,128,0.15); border-radius: 5px; overflow: hidden; width: 100%;">
                <div style="height: 100%; width: ${score !== null ? Math.max(0, Math.min(100, score)) : 0}%; background: ${color}; transition: width 0.5s ease; border-radius: 5px;"></div>
            </div>
            
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-light);">
                <strong>Main limiting factor:</strong><br>
                ${minSc < 85 ? minParams.join(' + ') : limitingMsg}
            </div>
            
            <button id="details-btn-${uid}" onclick="window.toggleAnalysisDetails('details-${uid}')" aria-expanded="false" style="background: none; border: none; padding: 0; margin: 12px 0 0 0; font-size: 12px; color: var(--primary-color); cursor: pointer; text-align: left; outline-offset: 2px;">
                [ View score details &#9660; ]
            </button>
            
            <div id="details-${uid}" style="display: none;">
                ${detailsHtml}
            </div>
        </div>
    `;
}
"""

pattern = r"function\s+updateAnalysisPage\s*\([^)]*\)\s*\{"
match = re.search(pattern, content)
if match:
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
        content = content[:start_idx] + new_update_analysis + content[end_idx:]

pattern2 = r"function\s+renderCompactRow\s*\([^)]*\)\s*\{"
match2 = re.search(pattern2, content)
if match2:
    start_idx2 = match2.start()
    braces = 0
    in_func = False
    end_idx2 = -1
    for i in range(start_idx2, len(content)):
        if content[i] == '{':
            braces += 1
            in_func = True
        elif content[i] == '}':
            braces -= 1
        
        if in_func and braces == 0:
            end_idx2 = i + 1
            break
            
    if end_idx2 != -1:
        content = content[:start_idx2] + content[end_idx2:]

with open('frontend/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
