import re

with open('frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

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

content = remove_func('renderDetailedApplicationCard', content)
content = remove_func('updateAnalysisPage', content)

# Remove any stray toggleAnalysisDetails assignments
content = re.sub(r'window\.toggleAnalysisDetails\s*=\s*function.*?\};', '', content, flags=re.DOTALL)

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

    var drinkParams = [
        { name: 'pH', score: phScore },
        { name: 'TDS', score: tdsScore },
        { name: 'Turbidity', score: turbScore }
    ];
    var drinkMin = 101;
    var drinkMinName = "";
    drinkParams.forEach(function(p) {
        if (p.score !== null && p.score < drinkMin) { drinkMin = p.score; drinkMinName = p.name; }
    });
    
    var drinkDetailsHtml = '<div style="margin-top: 16px; display: flex; flex-direction: column; gap: 16px;">';
    
    // Compact Parameter Table
    drinkDetailsHtml += `
        <div style="font-size: 13px; color: var(--text-primary);">
            <div style="display: grid; grid-template-columns: 1fr 1fr 60px; font-weight: 700; color: var(--text-secondary); border-bottom: 1px solid var(--border-light); padding-bottom: 4px; margin-bottom: 8px;">
                <span>Parameter</span><span>Current</span><span>Score</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 60px; gap: 4px; margin-bottom: 4px;">
                <span>pH</span><span>${ph !== null ? formatNumber(ph, 2) : '--'}</span><span>${phScore !== null ? Math.round(phScore) + '%' : '--'}</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 60px; gap: 4px; margin-bottom: 4px;">
                <span>TDS</span><span>${tds !== null ? formatNumber(tds, 0) + ' mg/L' : '--'}</span><span>${tdsScore !== null ? Math.round(tdsScore) + '%' : '--'}</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 60px; gap: 4px; margin-bottom: 8px;">
                <span>Turbidity</span><span>${turb !== null ? formatNumber(turb, 2) + ' NTU' : '--'}</span><span>${turbScore !== null ? Math.round(turbScore) + '%' : '--'}</span>
            </div>
        </div>
    `;
    
    // Limiting reason
    if (drinkMin < 85 && drinkMinName !== "") {
        drinkDetailsHtml += `<div style="font-size: 13px; color: var(--text-muted);">${drinkMinName} is the main factor reducing the screening result.</div>`;
    }

    // Main Limiting Factor Block
    drinkDetailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 12px;">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 4px;">MAIN LIMITING FACTOR</div>
            <div style="font-size: 13px; color: var(--text-primary); font-weight: 600;">
                ${drinkMin < 85 && drinkMinName !== "" ? drinkMinName + ' — ' + Math.round(drinkMin) + '%' : 'None identified'}
            </div>
        </div>
    `;

    // Disclaimer
    drinkDetailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 12px;">
            <div style="font-size: 12px; color: var(--text-muted); font-style: italic; line-height: 1.4;">
                This is a screening assessment, not laboratory certification or a determination of drinking-water safety.
            </div>
        </div>
    `;
    
    drinkDetailsHtml += '</div>';

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
            
            <button id="details-btn-drink" onclick="window.toggleAnalysisDetails('details-card-container-drink', 'details-btn-drink')" aria-expanded="false" aria-controls="details-card-container-drink" style="background: none; border: none; padding: 0; margin: 12px 0 0 0; font-size: 13px; font-weight: 600; color: var(--primary-color); cursor: pointer; text-align: left; outline-offset: 2px;">
                [ Why does this suit the water? &#9660; ]
            </button>
            
            <div id="details-card-container-drink" style="display: none; width: 100%;">
                ${drinkDetailsHtml}
            </div>
        </div>
    `;
    setAnalysisHtml('analysisDrinkingSection', drinkHtml);
}

function renderDetailedApplicationCard(resultObj, uid, icon) {
    var name = resultObj.crop || resultObj.name;
    var score = resultObj.suitability;
    var r = resultObj.reading;
    var prof = resultObj.profile;
    var type = resultObj.type;
    var d = calculateDerivedParameters(r);
    
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
    
    if (type === 'agriculture') {
        if (resultObj.salinityScore !== undefined) params.push({ name: 'EC', score: resultObj.salinityScore, key: 'salinity' });
    } else {
        if (resultObj.tdsScore !== undefined) params.push({ name: 'TDS', score: resultObj.tdsScore, key: 'tds' });
    }
    
    if (resultObj.phScore !== undefined) params.push({ name: 'pH', score: resultObj.phScore, key: 'ph' });
    if (resultObj.temperatureScore !== undefined) params.push({ name: 'Temperature', score: resultObj.temperatureScore, key: 'temp' });
    if (resultObj.turbidityScore !== undefined) params.push({ name: 'Clarity', score: resultObj.turbidityScore, key: 'turb' });
    
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
    }

    var detailsHtml = '<div style="margin-top: 16px; display: flex; flex-direction: column; gap: 16px;">';
    
    // OVERALL REASON (Short)
    detailsHtml += `
        <div style="font-size: 13px; color: var(--text-primary);">
            ${escapeHtml(name)} scores ${sValStr} because the current water conditions are ${sValNum >= 70 ? 'generally compatible' : 'less compatible'} with the configured profile.
        </div>
    `;

    // COMPACT TABLE
    var salName = type === 'agriculture' ? 'EC' : 'TDS';
    var salVal = type === 'agriculture' ? (d.estimatedEC !== null ? formatNumber(d.estimatedEC, 2) + ' dS/m' : '--') : (r.tds !== null ? formatNumber(r.tds, 0) + ' mg/L' : '--');
    var salScoreStr = (type === 'agriculture' ? resultObj.salinityScore : resultObj.tdsScore) !== null ? Math.round(type === 'agriculture' ? resultObj.salinityScore : resultObj.tdsScore) + '%' : '--';
    
    detailsHtml += `
        <div style="font-size: 13px; color: var(--text-primary); margin-top: 8px;">
            <div style="display: grid; grid-template-columns: 100px 1fr 50px; font-weight: 700; color: var(--text-secondary); border-bottom: 1px solid var(--border-light); padding-bottom: 4px; margin-bottom: 8px;">
                <span>Parameter</span><span>Current</span><span>Score</span>
            </div>
            <div style="display: grid; grid-template-columns: 100px 1fr 50px; gap: 4px; margin-bottom: 4px;">
                <span>pH</span><span>${r.ph !== null ? formatNumber(r.ph, 2) : '--'}</span><span>${resultObj.phScore !== null ? Math.round(resultObj.phScore) + '%' : '--'}</span>
            </div>
            <div style="display: grid; grid-template-columns: 100px 1fr 50px; gap: 4px; margin-bottom: 4px;">
                <span>${salName}</span><span>${salVal}</span><span>${salScoreStr}</span>
            </div>
            <div style="display: grid; grid-template-columns: 100px 1fr 50px; gap: 4px; margin-bottom: 4px;">
                <span>Turbidity</span><span>${r.turbidity !== null ? formatNumber(r.turbidity, 2) + ' NTU' : '--'}</span><span>${resultObj.turbidityScore !== null ? Math.round(resultObj.turbidityScore) + '%' : '--'}</span>
            </div>
            <div style="display: grid; grid-template-columns: 100px 1fr 50px; gap: 4px; margin-bottom: 8px;">
                <span>Temp</span><span>${r.temperature !== null ? formatNumber(r.temperature, 1) + '°C' : '--'}</span><span>${resultObj.temperatureScore !== null ? Math.round(resultObj.temperatureScore) + '%' : '--'}</span>
            </div>
        </div>
    `;

    // SHORT INTERPRETATIONS
    var salRef = type === 'agriculture' ? prof.ecwFullYield : prof.tdsMaximum;
    var refStr = salRef !== undefined ? formatNumber(salRef, type === 'agriculture' ? 2 : 0) + (type === 'agriculture' ? ' dS/m' : ' mg/L') : '--';
    detailsHtml += `<div style="font-size: 13px; color: var(--text-muted); margin-bottom: 4px;"><strong>${salName} reference:</strong> ${refStr}</div>`;
    
    var interpHtml = '';
    
    // Salinity logic
    if (salRef !== undefined) {
        var cVal = type === 'agriculture' ? d.estimatedEC : r.tds;
        if (cVal !== null) {
            if (cVal > salRef) {
                interpHtml += `<div>${salName} is above the reference &rarr; salinity score is reduced.</div>`;
            } else if (type === 'agriculture' && cVal > (salRef - 0.2)) {
                interpHtml += `<div>${salName} is close to the reference &rarr; moderate salinity impact.</div>`;
            } else {
                interpHtml += `<div>${salName} is below or equal to the reference &rarr; salinity is not strongly limiting.</div>`;
            }
        }
    }
    
    // pH logic
    if (r.ph !== null && prof.phMin !== undefined && prof.phMax !== undefined) {
        if (r.ph < prof.phMin) {
            interpHtml += `<div>pH is below the configured range &rarr; pH score is reduced.</div>`;
        } else if (r.ph > prof.phMax) {
            interpHtml += `<div>pH is above the configured range &rarr; pH score is reduced.</div>`;
        }
    }
    
    // Temp logic
    if (r.temperature !== null && prof.temperatureMin !== undefined && prof.temperatureMax !== undefined) {
        if (r.temperature < prof.temperatureMin || r.temperature > prof.temperatureMax) {
            interpHtml += `<div>Temperature is outside the preferred range &rarr; score is reduced.</div>`;
        }
    }
    
    if (interpHtml !== '') {
        detailsHtml += `<div style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.4;">${interpHtml}</div>`;
    }

    // COMPONENT BREAKDOWN (Compact Bars)
    var breakHtml = '';
    params.forEach(function(p) {
        var pColor = 'var(--text-muted)';
        if (p.score !== null) {
            if (p.score >= 80) pColor = 'var(--status-normal)';
            else if (p.score >= 50) pColor = 'var(--status-monitor)';
            else pColor = 'var(--status-critical)';
        }
        breakHtml += `
            <div style="display: flex; align-items: center; gap: 12px; font-size: 13px; margin-bottom: 6px;">
                <span style="width: 70px; color: var(--text-secondary);">${p.name}</span>
                <div style="flex-grow: 1; height: 6px; background: rgba(128,128,128,0.15); border-radius: 3px; overflow: hidden;">
                    <div style="height: 100%; width: ${p.score !== null ? Math.max(0, Math.min(100, p.score)) : 0}%; background: ${pColor}; border-radius: 3px;"></div>
                </div>
                <span style="width: 30px; text-align: right; color: var(--text-primary); font-weight: 600;">${p.score !== null ? Math.round(p.score) + '%' : '--'}</span>
            </div>
        `;
    });

    detailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 12px; margin-bottom: 12px;">
            ${breakHtml}
        </div>
    `;
    
    // MAIN LIMITING FACTOR
    var limScoreStr = minSc < 101 ? Math.round(minSc) + '%' : '--';
    detailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 12px;">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 4px;">Main limiting factor</div>
            <div style="font-size: 13px; color: var(--text-primary); font-weight: 600;">
                ${minSc < 85 && minParams.length > 0 ? (minParams.join(' + ') === 'EC' ? 'Salinity / EC' : minParams.join(' + ')) + ' — ' + limScoreStr : 'None identified'}
            </div>
        </div>
    `;
    
    // MODEL NOTE
    detailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 12px; margin-top: 8px;">
            <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4; font-style: italic;">
                Analytical prediction based on available sensor parameters${type === 'agriculture' ? '; actual crop performance also depends on soil, climate and irrigation conditions.' : '.'}
            </div>
        </div>
    `;
    
    detailsHtml += '</div>'; // End container
    
    return `
        <div style="display: flex; flex-direction: column; padding: 24px; background: var(--bg-soft); border-radius: 16px; border: 1px solid var(--border-light); box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <strong style="font-size: 18px; color: var(--text-primary);">${icon}${escapeHtml(name)}</strong>
                <span style="font-weight: 700; font-size: 20px; color: var(--text-primary);">${sValStr}</span>
            </div>
            <div style="font-size: 15px; font-weight: 600; color: ${color}; margin-top: 4px; margin-bottom: 16px;">${label}</div>
            
            <div style="height: 12px; background: rgba(128,128,128,0.15); border-radius: 6px; overflow: hidden; width: 100%; margin-bottom: 20px;">
                <div style="height: 100%; width: ${score !== null ? Math.max(0, Math.min(100, score)) : 0}%; background: ${color}; transition: width 0.5s ease; border-radius: 6px;"></div>
            </div>
            
            <div style="font-size: 13px; color: var(--text-muted); padding-top: 16px; border-top: 1px solid var(--border-light);">
                <strong style="color: var(--text-secondary);">Main limiting factor</strong><br>
                <div style="margin-top: 4px; line-height: 1.4;">${minSc < 85 ? (minParams.length === 1 ? (minParams[0] === 'EC' ? 'Salinity / EC' : minParams[0]) : minParams.join(' + ')) : "No major limiting factor"}</div>
            </div>
            
            <button id="details-btn-${uid}" onclick="window.toggleAnalysisDetails('details-card-container-${uid}', 'details-btn-${uid}')" aria-expanded="false" aria-controls="details-card-container-${uid}" style="background: none; border: none; padding: 0; margin: 20px 0 0 0; font-size: 13px; font-weight: 600; color: var(--primary-color); cursor: pointer; text-align: left; outline-offset: 2px;">
                [ Why does this suit the water? &#9660; ]
            </button>
            
            <div id="details-card-container-${uid}" style="display: none; width: 100%;">
                ${detailsHtml}
            </div>
        </div>
    `;
}

window.toggleAnalysisDetails = function(contentId, btnId) {
    var el = document.getElementById(contentId);
    var btn = document.getElementById(btnId);
    if (el && btn) {
        if (el.style.display === 'none') {
            el.style.display = 'block';
            btn.innerHTML = '[ Hide details &#9650; ]';
            btn.setAttribute('aria-expanded', 'true');
        } else {
            el.style.display = 'none';
            btn.innerHTML = '[ Why does this suit the water? &#9660; ]';
            btn.setAttribute('aria-expanded', 'false');
        }
    }
};
"""

if insertion_point != -1:
    content = content[:insertion_point] + new_code + "\n" + content[insertion_point:]

with open('frontend/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
