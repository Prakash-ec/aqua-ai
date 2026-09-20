import re

with open('frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# First, let's remove ALL instances of `renderCompactRow` so we don't have dangling ones.
def remove_func(func_name, text):
    while True:
        pattern = r"function\s+" + func_name + r"\s*\([^)]*\)\s*\{"
        match = re.search(pattern, text)
        if not match:
            break
        start_idx = match.start()
        braces = 0
        in_func = False
        end_idx = -1
        for i in range(start_idx, len(text)):
            if text[i] == '{':
                braces += 1
                in_func = True
            elif text[i] == '}':
                braces -= 1
            if in_func and braces == 0:
                end_idx = i + 1
                break
        if end_idx != -1:
            text = text[:start_idx] + text[end_idx:]
        else:
            break
    return text

content = remove_func('renderCompactRow', content)
content = remove_func('updateAnalysisPage', content)

# Now, insert our new functions at the bottom before any initialization logic (or just append them)
# But it's better to insert them where `updateAnalysisPage` used to be. Wait, I deleted it, so I can just append to the file or insert after some known function.
# Let's just find `function switchAnalysisTab` and insert before it.

insertion_point = content.find('function switchAnalysisTab')

new_code = """
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
        ['analysisSummary','analysisCurrentParams','analysisDerivedParams','analysisScoreSection','analysisKeyLimitingFactor','analysisCropSection','analysisIndustrialSection','analysisDomesticSection','analysisGeneralSection','analysisDrinkingSection','analysisCategorySummary'].forEach(function(id) { setAnalysisHtml(id, ''); });
        setAnalysisNotice('');
        return;
    }
    
    var reading = latestReading;
    setAnalysisNotice('');
    var timeStr = reading.recorded_at ? formatTimestamp(reading.recorded_at) : 'No timestamp';
    setText('analysisReadingTime', timeStr);
    
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

    // 1. OVERALL WATER QUALITY HERO CARD
    var summaryHtml = `
        <div style="display: flex; flex-direction: column; gap: 16px; padding: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px;">
                    <span style="font-size: 48px; font-weight: 700; color: ${quality.score >= 80 ? 'var(--status-normal)' : (quality.score >= 50 ? 'var(--status-monitor)' : 'var(--status-critical)')}; line-height: 1;">${quality.score}%</span>
                    <span style="font-size: 16px; font-weight: 600; color: var(--text-primary);">${quality.title}</span>
                </div>
                <div style="text-align: right; font-size: 12px; color: var(--text-muted);">
                    Based on 4 measured parameters<br>
                    Latest reading: ${timeStr}
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; background: rgba(0,0,0,0.02); padding: 16px; border-radius: 8px; border: 1px solid var(--border-light); margin-top: 8px;">
                <div style="display: flex; justify-content: space-between;"><span style="color: var(--text-secondary);">pH</span><strong style="color: var(--text-primary);">${phScore !== null ? Math.round(phScore) + '%' : '--'}</strong></div>
                <div style="display: flex; justify-content: space-between;"><span style="color: var(--text-secondary);">TDS / Salinity</span><strong style="color: var(--text-primary);">${derived.salinityIndex !== null ? Math.round(derived.salinityIndex) + '%' : '--'}</strong></div>
                <div style="display: flex; justify-content: space-between;"><span style="color: var(--text-secondary);">Clarity</span><strong style="color: var(--text-primary);">${derived.clarityIndex !== null ? Math.round(derived.clarityIndex) + '%' : '--'}</strong></div>
                <div style="display: flex; justify-content: space-between;"><span style="color: var(--text-secondary);">Temp</span><strong style="color: var(--text-primary);">${derived.temperatureIndex !== null ? Math.round(derived.temperatureIndex) + '%' : '--'}</strong></div>
            </div>
        </div>
    `;
    setAnalysisHtml('analysisSummary', summaryHtml);

    // 2. CURRENT PARAMETERS
    var curParams = [
        { name: 'pH', value: ph !== null ? formatNumber(ph, 2) : '--', unit: '', icon: 'ri-test-tube-line', stat: getStatus(phScore) },
        { name: 'Turbidity', value: turb !== null ? formatNumber(turb, 2) : '--', unit: 'NTU', icon: 'ri-contrast-drop-2-line', stat: getStatus(turbScore) },
        { name: 'TDS', value: tds !== null ? formatNumber(tds, 0) : '--', unit: 'mg/L', icon: 'ri-flask-line', stat: getStatus(tdsScore) },
        { name: 'Temperature', value: t !== null ? formatNumber(t, 1) : '--', unit: '°C', icon: 'ri-temp-hot-line', stat: getStatus(tScore) }
    ];
    
    var curHtml = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">';
    curParams.forEach(function(p) {
        curHtml += `
            <div style="background: var(--bg-soft); border-radius: 12px; padding: 20px; border: 1px solid var(--border-light); box-shadow: 0 2px 4px rgba(0,0,0,0.02); display: flex; flex-direction: column; justify-content: space-between;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="${p.icon}" style="font-size: 20px; color: var(--text-muted);"></i>
                        <span style="font-size: 14px; color: var(--text-secondary); font-weight: 500;">${p.name}</span>
                    </div>
                </div>
                <div style="display: flex; align-items: baseline; gap: 6px; margin-bottom: 8px;">
                    <span style="font-size: 28px; font-weight: 700; color: var(--text-primary);">${p.value}</span>
                    <span style="font-size: 14px; color: var(--text-muted);">${p.unit}</span>
                </div>
                <div style="font-size: 14px; font-weight: 600; color: ${p.stat.color}; display: flex; align-items: center; gap: 6px;">
                    <div style="width: 8px; height: 8px; border-radius: 50%; background: ${p.stat.color};"></div>
                    ${p.stat.text}
                </div>
            </div>
        `;
    });
    curHtml += '</div>';
    setAnalysisHtml('analysisCurrentParams', curHtml);
    
    // 3. DERIVED PARAMETERS
    var derivedHtml = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px;">';
    var derivedItems = [
        { name: 'Estimated EC', value: derived.estimatedEC !== null ? formatNumber(derived.estimatedEC, 2) : '--', unit: 'dS/m', sub: 'Estimated from TDS' },
        { name: 'H⁺ Concentration', value: derived.hydrogenIonConcentration !== null ? formatScientific(derived.hydrogenIonConcentration) : '--', unit: 'mol/L', sub: '' },
        { name: 'Salinity', value: derived.salinityClass || '--', unit: '', sub: '' },
        { name: 'Clarity', value: derived.clarityIndex !== null ? Math.round(derived.clarityIndex) + '%' : '--', unit: '', sub: '' },
        { name: 'pH Index', value: derived.phIndex !== null ? Math.round(derived.phIndex) + '%' : '--', unit: '', sub: '' },
        { name: 'Temperature Index', value: derived.temperatureIndex !== null ? Math.round(derived.temperatureIndex) + '%' : '--', unit: '', sub: '' }
    ];
    
    derivedItems.forEach(function(item) {
        derivedHtml += `
            <div style="background: var(--bg-soft); border-radius: 12px; padding: 16px; border: 1px solid var(--border-light); box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; font-weight: 500;">${item.name}</div>
                <div style="display: flex; align-items: baseline; gap: 6px;">
                    <span style="font-size: 18px; font-weight: 600; color: var(--text-primary);">${item.value}</span>
                    <span style="font-size: 12px; color: var(--text-muted);">${item.unit}</span>
                </div>
                ${item.sub ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">${item.sub}</div>` : ''}
            </div>
        `;
    });
    derivedHtml += '</div>';
    setAnalysisHtml('analysisDerivedParams', derivedHtml);
    
    // 4. SCORE BREAKDOWN
    var scoreItems = [
        { name: 'pH', score: phScore },
        { name: 'Salinity', score: derived.salinityIndex },
        { name: 'Clarity', score: derived.clarityIndex },
        { name: 'Temperature', score: derived.temperatureIndex }
    ];
    
    var breakHtml = '<div style="display: flex; flex-direction: column; gap: 20px; max-width: 600px;">';
    scoreItems.forEach(function(p) {
        var sValNum = p.score !== null ? Math.round(p.score) : 0;
        var sVal = p.score !== null ? sValNum + '%' : '--';
        var barColor = 'var(--text-muted)';
        if (p.score !== null) {
            if (p.score >= 80) barColor = 'var(--status-normal)';
            else if (p.score >= 50) barColor = 'var(--status-monitor)';
            else barColor = 'var(--status-critical)';
        }
        
        breakHtml += `
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; justify-content: space-between; font-size: 15px; align-items: baseline;">
                    <strong style="color: var(--text-primary);">${p.name}</strong>
                    <span style="color: var(--text-primary); font-weight: 700;">${sVal}</span>
                </div>
                <div style="height: 12px; background: rgba(128,128,128,0.15); border-radius: 6px; overflow: hidden; width: 100%;">
                    <div style="height: 100%; width: ${p.score !== null ? Math.max(0, Math.min(100, p.score)) : 0}%; background: ${barColor}; transition: width 0.5s ease; border-radius: 6px;"></div>
                </div>
            </div>
        `;
    });
    breakHtml += '<p style="font-size: 13px; color: var(--text-muted); margin-top: 16px; border-top: 1px solid var(--border-light); padding-top: 16px;">These component scores are calculated from the available measured parameters using Aqua AI\\'s configured analytical model.</p>';
    breakHtml += '</div>';
    setAnalysisHtml('analysisScoreSection', breakHtml);
    
    // Application Profiles Data Enrichment
    var cropResults = CROP_PROFILES.map(function(crop) { 
        var r = calculateCropScore(reading, crop); 
        r.profile = crop; r.reading = reading; r.type = 'agriculture'; 
        return r; 
    }).sort(function(a, b) { return (b.suitability || 0) - (a.suitability || 0); });
    
    var indResults = INDUSTRIAL_PROFILES.map(function(p) { 
        var r = calculateApplicationScore(reading, p); 
        r.profile = p; r.reading = reading; r.type = 'industry'; 
        return r; 
    }).sort(function(a, b) { return (b.suitability || 0) - (a.suitability || 0); });
    
    var domResults = DOMESTIC_PROFILES.map(function(p) { 
        var r = calculateApplicationScore(reading, p); 
        r.profile = p; r.reading = reading; r.type = 'domestic'; 
        return r; 
    }).sort(function(a, b) { return (b.suitability || 0) - (a.suitability || 0); });
    
    var genResults = GENERAL_PROFILES.map(function(p) { 
        var r = calculateApplicationScore(reading, p); 
        r.profile = p; r.reading = reading; r.type = 'utility'; 
        return r; 
    }).sort(function(a, b) { return (b.suitability || 0) - (a.suitability || 0); });
    
    // 5. Category Summary
    var summaryHtmlCat = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px;">
            <div style="background: var(--bg-soft); border-radius: 8px; padding: 16px; border: 1px solid var(--border-light); box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 8px; letter-spacing: 0.5px;">Agriculture</div>
                <div style="color: var(--text-secondary); font-size: 13px; margin-bottom: 4px;">Top configured match</div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong style="color: var(--text-primary); font-size: 16px;">${cropResults.length > 0 ? cropResults[0].crop : '--'}</strong>
                    <span style="color: var(--text-primary); font-weight: 700; font-size: 16px;">${cropResults.length > 0 && cropResults[0].suitability !== null ? Math.round(cropResults[0].suitability) + '%' : '--'}</span>
                </div>
            </div>
            <div style="background: var(--bg-soft); border-radius: 8px; padding: 16px; border: 1px solid var(--border-light); box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 8px; letter-spacing: 0.5px;">Industry</div>
                <div style="color: var(--text-secondary); font-size: 13px; margin-bottom: 4px;">Top configured match</div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong style="color: var(--text-primary); font-size: 16px;">${indResults.length > 0 ? indResults[0].name : '--'}</strong>
                    <span style="color: var(--text-primary); font-weight: 700; font-size: 16px;">${indResults.length > 0 && indResults[0].suitability !== null ? Math.round(indResults[0].suitability) + '%' : '--'}</span>
                </div>
            </div>
            <div style="background: var(--bg-soft); border-radius: 8px; padding: 16px; border: 1px solid var(--border-light); box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 8px; letter-spacing: 0.5px;">Domestic</div>
                <div style="color: var(--text-secondary); font-size: 13px; margin-bottom: 4px;">Top configured match</div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong style="color: var(--text-primary); font-size: 16px;">${domResults.length > 0 ? domResults[0].name : '--'}</strong>
                    <span style="color: var(--text-primary); font-weight: 700; font-size: 16px;">${domResults.length > 0 && domResults[0].suitability !== null ? Math.round(domResults[0].suitability) + '%' : '--'}</span>
                </div>
            </div>
            <div style="background: var(--bg-soft); border-radius: 8px; padding: 16px; border: 1px solid var(--border-light); box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 8px; letter-spacing: 0.5px;">General Utility</div>
                <div style="color: var(--text-secondary); font-size: 13px; margin-bottom: 4px;">Top configured match</div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong style="color: var(--text-primary); font-size: 16px;">${genResults.length > 0 ? genResults[0].name : '--'}</strong>
                    <span style="color: var(--text-primary); font-weight: 700; font-size: 16px;">${genResults.length > 0 && genResults[0].suitability !== null ? Math.round(genResults[0].suitability) + '%' : '--'}</span>
                </div>
            </div>
        </div>
    `;
    setAnalysisHtml('analysisCategorySummary', summaryHtmlCat);

    // 6. Application Cards
    var ch = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">';
    cropResults.slice(0, 5).forEach(function(r, i) { ch += renderDetailedApplicationCard(r, 'crop' + i, '🌾 '); });
    ch += '</div>';
    setAnalysisHtml('analysisCropSection', ch);
    
    var ih = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">';
    indResults.forEach(function(r, i) { ih += renderDetailedApplicationCard(r, 'ind' + i, '🏭 '); });
    ih += '</div>';
    setAnalysisHtml('analysisIndustrialSection', ih);
    
    var domh = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">';
    domResults.forEach(function(r, i) { domh += renderDetailedApplicationCard(r, 'dom' + i, '🏡 '); });
    domh += '</div>';
    setAnalysisHtml('analysisDomesticSection', domh);
    
    var gh = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">';
    genResults.forEach(function(r, i) { gh += renderDetailedApplicationCard(r, 'gen' + i, '🔧 '); });
    gh += '</div>';
    setAnalysisHtml('analysisGeneralSection', gh);
    
    // 7. Drinking Screening
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
        <div style="background: var(--bg-soft); border-radius: 12px; padding: 24px; border: 1px solid var(--border-light); box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px;">
                <strong style="font-size: 18px; color: var(--text-primary);">🚰 Drinking Water Screening</strong>
                <span style="font-weight: 700; font-size: 20px; color: var(--text-primary);">${drinkScoreStr}</span>
            </div>
            <div style="margin-bottom: 16px;">
                <div style="height: 12px; background: rgba(128,128,128,0.15); border-radius: 6px; overflow: hidden; width: 100%;">
                    <div style="height: 100%; width: ${drinking.score !== null ? Math.max(0, Math.min(100, drinking.score)) : 0}%; background: ${dColor}; transition: width 0.5s ease; border-radius: 6px;"></div>
                </div>
            </div>
            <p style="font-size: 15px; font-weight: 600; color: ${dColor}; margin: 0 0 12px 0;">${drinking.title}</p>
            <p style="font-size: 14px; color: var(--text-secondary); margin: 0 0 16px 0; line-height: 1.5;">${drinking.description}</p>
            <div style="font-size: 13px; color: var(--text-muted); margin: 0; border-top: 1px solid var(--border-light); padding-top: 16px;">
                <strong>Limiting Factors:</strong> ${drinking.reason}<br>
                <em style="display: block; margin-top: 8px;">Screening based only on the available sensor parameters.</em>
            </div>
        </div>
    `;
    setAnalysisHtml('analysisDrinkingSection', drinkHtml);
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
            btn.innerHTML = '[ Why does this suit the water? &#9660; ]';
            btn.setAttribute('aria-expanded', 'false');
        }
    }
};

function renderDetailedApplicationCard(resultObj, uid, icon) {
    var name = resultObj.crop || resultObj.name;
    var score = resultObj.suitability;
    
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
    
    var minSc = 101;
    var minParams = [];
    var params = [];
    
    if (resultObj.type === 'agriculture') {
        if (resultObj.salinityScore !== undefined) params.push({ name: 'Salinity', score: resultObj.salinityScore, key: 'salinity' });
    } else {
        if (resultObj.tdsScore !== undefined) params.push({ name: 'TDS / Salinity', score: resultObj.tdsScore, key: 'tds' });
    }
    
    if (resultObj.phScore !== undefined) params.push({ name: 'pH', score: resultObj.phScore, key: 'ph' });
    if (resultObj.temperatureScore !== undefined) params.push({ name: 'Temperature', score: resultObj.temperatureScore, key: 'temp' });
    if (resultObj.turbidityScore !== undefined) params.push({ name: 'Clarity', score: resultObj.turbidityScore, key: 'turb' });
    
    params.forEach(function(p) {
        if (p.score !== null && p.score < minSc) {
            minSc = p.score;
        }
    });
    
    var limitingMsg = "No major limiting factor identified within the configured analytical parameters.";
    if (minSc < 85) {
        params.forEach(function(p) {
            if (p.score !== null && Math.abs(p.score - minSc) < 1) {
                if (minParams.indexOf(p.name) === -1) minParams.push(p.name);
            }
        });
        if (minParams.length > 0) {
            if (minParams.length === 1) {
                limitingMsg = minParams[0] + " has the lowest component score for this application.";
            } else {
                limitingMsg = "Main limiting factors: " + minParams.join(' + ');
            }
        }
    }

    var detailsHtml = '<div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border-light); display: flex; flex-direction: column; gap: 24px;">';
    detailsHtml += '<strong style="font-size: 14px; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px;">Why does ' + escapeHtml(name) + ' suit this water?</strong>';
    
    var r = resultObj.reading;
    var prof = resultObj.profile;
    var d = calculateDerivedParameters(r);

    params.forEach(function(p) {
        var pColor = 'var(--text-muted)';
        if (p.score !== null) {
            if (p.score >= 80) pColor = 'var(--status-normal)';
            else if (p.score >= 50) pColor = 'var(--status-monitor)';
            else pColor = 'var(--status-critical)';
        }
        
        var expl = '';
        if (resultObj.type === 'agriculture') {
            if (p.key === 'salinity') {
                expl = `Estimated EC: ${d.estimatedEC !== null ? formatNumber(d.estimatedEC, 2) : '--'} dS/m.<br>`;
                if (d.estimatedEC !== null && prof.ecwFullYield !== undefined) {
                    if (d.estimatedEC > prof.ecwFullYield) {
                        expl += `Estimated EC is above the configured ${prof.ecwFullYield} dS/m full-yield reference for this crop. Therefore the salinity component is reduced by the Aqua AI analytical model.`;
                    } else {
                        expl += `Estimated EC is below or equal to the configured ${prof.ecwFullYield} dS/m full-yield reference, resulting in a high salinity score.`;
                    }
                }
            } else if (p.key === 'ph') {
                expl = `Measured pH: ${r.ph !== null ? formatNumber(r.ph, 2) : '--'}.<br>`;
                if (r.ph !== null && prof.phMin !== undefined && prof.phMax !== undefined) {
                    if (r.ph >= prof.phMin && r.ph <= prof.phMax) {
                        expl += `This is within the configured preferred pH range for this crop.`;
                    } else {
                        expl += `This is outside the configured preferred pH range for this crop, reducing the pH component score.`;
                    }
                }
            } else if (p.key === 'temp') {
                expl = `Measured temperature: ${r.temperature !== null ? formatNumber(r.temperature, 1) : '--'}°C.<br>`;
                if (r.temperature !== null && prof.temperatureMin !== undefined && prof.temperatureMax !== undefined) {
                    if (r.temperature >= prof.temperatureMin && r.temperature <= prof.temperatureMax) {
                        expl += `This is within the configured preferred analytical range.`;
                    } else {
                        expl += `This is outside the configured preferred analytical range, producing a lower temperature score.`;
                    }
                }
            } else if (p.key === 'turb') {
                expl = `Measured turbidity: ${r.turbidity !== null ? formatNumber(r.turbidity, 2) : '--'} NTU.<br>`;
                expl += `This value contributes to the clarity component of the application model.`;
            }
        } else {
            if (p.key === 'tds') {
                expl = `Current TDS: ${r.tds !== null ? formatNumber(r.tds, 0) : '--'} mg/L.<br>`;
                expl += `The current TDS produces the existing salinity/TDS component score for this application.`;
            } else if (p.key === 'ph') {
                expl = `Current pH: ${r.ph !== null ? formatNumber(r.ph, 2) : '--'}.<br>`;
                expl += `This produces the existing pH component score.`;
            } else if (p.key === 'temp') {
                expl = `Current temperature: ${r.temperature !== null ? formatNumber(r.temperature, 1) : '--'}°C.<br>`;
                expl += `This value is compared with the application's configured temperature range.`;
            } else if (p.key === 'turb') {
                expl = `Current turbidity: ${r.turbidity !== null ? formatNumber(r.turbidity, 2) : '--'} NTU.<br>`;
                expl += `This produces the existing clarity component score.`;
            }
        }
        
        detailsHtml += `
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <strong style="font-size: 14px; color: var(--text-primary);">${p.name}</strong>
                <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 4px;">${expl}</div>
                
                <div style="display: flex; justify-content: space-between; font-size: 13px; align-items: baseline;">
                    <span style="color: var(--text-muted);">Component score</span>
                    <span style="color: var(--text-primary); font-weight: 600;">${p.score !== null ? Math.round(p.score) + '%' : '--'}</span>
                </div>
                <div style="height: 6px; background: rgba(128,128,128,0.15); border-radius: 3px; overflow: hidden; width: 100%;">
                    <div style="height: 100%; width: ${p.score !== null ? Math.max(0, Math.min(100, p.score)) : 0}%; background: ${pColor}; transition: width 0.5s ease; border-radius: 3px;"></div>
                </div>
            </div>
        `;
    });
    
    detailsHtml += `
        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--border-light);">
            <strong style="font-size: 14px; color: var(--text-primary);">Why the final score?</strong>
            <p style="font-size: 13px; color: var(--text-secondary); margin: 8px 0; line-height: 1.5;">The final suitability score combines the configured component scores using the existing application weighting model.</p>
            <div style="font-size: 13px; color: var(--text-muted); margin-top: 16px; font-style: italic;">
                Application suitability is an analytical prediction based on the available sensor parameters and Aqua AI's configured profiles. It is not a guarantee of real-world performance.
                ${resultObj.type === 'agriculture' ? ' Actual crop performance also depends on soil properties, climate, irrigation practices, crop variety and other agronomic conditions.' : ''}
            </div>
        </div>
    `;
    
    detailsHtml += '</div>';
    
    return `
        <div style="display: flex; flex-direction: column; padding: 24px; background: var(--bg-soft); border-radius: 16px; border: 1px solid var(--border-light); box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <strong style="font-size: 18px; color: var(--text-primary);">${icon}${name}</strong>
                <span style="font-weight: 700; font-size: 20px; color: var(--text-primary);">${sValStr}</span>
            </div>
            <div style="font-size: 15px; font-weight: 600; color: ${color}; margin-top: 4px; margin-bottom: 16px;">${label}</div>
            
            <div style="height: 12px; background: rgba(128,128,128,0.15); border-radius: 6px; overflow: hidden; width: 100%; margin-bottom: 20px;">
                <div style="height: 100%; width: ${score !== null ? Math.max(0, Math.min(100, score)) : 0}%; background: ${color}; transition: width 0.5s ease; border-radius: 6px;"></div>
            </div>
            
            <div style="font-size: 13px; color: var(--text-muted); padding-top: 16px; border-top: 1px solid var(--border-light);">
                <strong style="color: var(--text-secondary);">Main limiting factor</strong><br>
                <div style="margin-top: 4px; line-height: 1.4;">${minSc < 85 ? (minParams.length === 1 ? minParams[0] : minParams.join(' + ')) : limitingMsg}</div>
            </div>
            
            <button id="details-btn-${uid}" onclick="window.toggleAnalysisDetails('details-${uid}')" aria-expanded="false" style="background: none; border: none; padding: 0; margin: 20px 0 0 0; font-size: 13px; font-weight: 600; color: var(--primary-color); cursor: pointer; text-align: left; outline-offset: 2px;">
                [ Why does this suit the water? &#9660; ]
            </button>
            
            <div id="details-${uid}" style="display: none;">
                ${detailsHtml}
            </div>
        </div>
    `;
}
"""

if insertion_point != -1:
    content = content[:insertion_point] + new_code + "\n" + content[insertion_point:]

with open('frontend/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

