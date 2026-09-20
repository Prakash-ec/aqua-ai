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
content = remove_func('renderCompactRow', content)

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

    // Determine limiting factor for drinking
    var drinkParams = [
        { name: 'pH', score: phScore },
        { name: 'TDS', score: tdsScore },
        { name: 'Turbidity', score: turbScore }
    ];
    var drinkMin = 101;
    var drinkMinParams = [];
    drinkParams.forEach(function(p) {
        if (p.score !== null && p.score < drinkMin) drinkMin = p.score;
    });
    if (drinkMin < 85) {
        drinkParams.forEach(function(p) {
            if (p.score !== null && Math.abs(p.score - drinkMin) < 1) drinkMinParams.push(p.name);
        });
    }
    
    var drinkDetailsHtml = '<div style="margin-top: 16px; display: flex; flex-direction: column; gap: 24px;">';
    
    drinkDetailsHtml += `
        <div>
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px;">OVERALL REASON</div>
            <div style="font-size: 14px; color: var(--text-primary); line-height: 1.5;">
                This is a screening assessment based on the configured pH, TDS and turbidity reference values. It is NOT a laboratory certification and does not establish potability or drinking-water safety.
            </div>
        </div>
    `;
    
    // pH explanation for drinking
    drinkDetailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">pH</div>
            </div>
            <div style="display: grid; grid-template-columns: 120px 1fr; gap: 4px; font-size: 13px; margin-bottom: 8px;">
                <span style="color: var(--text-secondary);">Current pH</span><span style="color: var(--text-primary); font-weight: 600;">${ph !== null ? formatNumber(ph, 2) : '--'}</span>
            </div>
            <div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">
                The measured pH contributes to the drinking screening score based on standard acceptable ranges.
            </div>
        </div>
    `;

    // TDS explanation for drinking
    drinkDetailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">TDS</div>
            </div>
            <div style="display: grid; grid-template-columns: 120px 1fr; gap: 4px; font-size: 13px; margin-bottom: 8px;">
                <span style="color: var(--text-secondary);">Current TDS</span><span style="color: var(--text-primary); font-weight: 600;">${tds !== null ? formatNumber(tds, 0) + ' mg/L' : '--'}</span>
            </div>
            <div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">
                The measured TDS is compared against configured screening thresholds for potability indicators.
            </div>
        </div>
    `;
    
    // Turbidity explanation for drinking
    drinkDetailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">Turbidity</div>
            </div>
            <div style="display: grid; grid-template-columns: 120px 1fr; gap: 4px; font-size: 13px; margin-bottom: 8px;">
                <span style="color: var(--text-secondary);">Current</span><span style="color: var(--text-primary); font-weight: 600;">${turb !== null ? formatNumber(turb, 2) + ' NTU' : '--'}</span>
            </div>
            <div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">
                High turbidity indicates suspended particles and reduces the screening score.
            </div>
        </div>
    `;
    
    // COMPONENT BREAKDOWN
    var drinkBreakHtml = '';
    drinkParams.forEach(function(p) {
        var pColor = 'var(--text-muted)';
        if (p.score !== null) {
            if (p.score >= 80) pColor = 'var(--status-normal)';
            else if (p.score >= 50) pColor = 'var(--status-monitor)';
            else pColor = 'var(--status-critical)';
        }
        drinkBreakHtml += `
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <div style="display: flex; justify-content: space-between; font-size: 13px; align-items: baseline;">
                    <span style="color: var(--text-primary); font-weight: 500;">${p.name}</span>
                    <span style="color: var(--text-primary); font-weight: 600;">${p.score !== null ? Math.round(p.score) + '%' : '--'}</span>
                </div>
                <div style="height: 6px; background: rgba(128,128,128,0.15); border-radius: 3px; overflow: hidden; width: 100%;">
                    <div style="height: 100%; width: ${p.score !== null ? Math.max(0, Math.min(100, p.score)) : 0}%; background: ${pColor}; transition: width 0.5s ease; border-radius: 3px;"></div>
                </div>
            </div>
        `;
    });

    drinkDetailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 16px;">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px; margin-bottom: 12px;">COMPONENT BREAKDOWN</div>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                ${drinkBreakHtml}
            </div>
        </div>
    `;
    
    drinkDetailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 16px;">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px;">MAIN LIMITING FACTOR</div>
            <div style="font-size: 14px; color: var(--text-primary); font-weight: 600; margin-bottom: 4px;">
                ${drinkMin < 85 && drinkMinParams.length > 0 ? drinkMinParams.join(' + ') + ' — ' + Math.round(drinkMin) + '%' : 'None identified'}
            </div>
            <div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">
                ${drinkMin < 85 && drinkMinParams.length > 0 ? (drinkMinParams.length === 1 ? drinkMinParams[0] + ' has the lowest component score for this screening.' : 'Main limiting factors: ' + drinkMinParams.join(' + ')) : 'No major limiting factor identified within the configured analytical parameters.'}
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
        if (resultObj.salinityScore !== undefined) params.push({ name: 'Salinity / EC', score: resultObj.salinityScore, key: 'salinity' });
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
    var limitingName = "";
    if (minSc < 85) {
        params.forEach(function(p) {
            if (p.score !== null && Math.abs(p.score - minSc) < 1) {
                if (minParams.indexOf(p.name) === -1) minParams.push(p.name);
            }
        });
        if (minParams.length > 0) {
            limitingName = minParams.join(' + ');
            if (minParams.length === 1) {
                limitingMsg = minParams[0] + " has the lowest component score for this application.";
            } else {
                limitingMsg = "Main limiting factors: " + minParams.join(' + ');
            }
        }
    }

    var detailsHtml = '<div style="margin-top: 16px; display: flex; flex-direction: column; gap: 24px;">';
    
    // OVERALL REASON
    detailsHtml += `
        <div>
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px;">OVERALL REASON</div>
            <div style="font-size: 14px; color: var(--text-primary); line-height: 1.5;">
                ${escapeHtml(name)} has a suitability score of <strong>${sValStr}</strong> for the current water based on the configured Aqua AI analytical model. This indicates a <strong>${label.toLowerCase()}</strong> match.
            </div>
        </div>
    `;

    // SALINITY / EC
    var salKey = type === 'agriculture' ? 'SALINITY / EC' : 'TDS / SALINITY';
    var salScore = type === 'agriculture' ? resultObj.salinityScore : resultObj.tdsScore;
    var salColor = salScore >= 80 ? 'var(--status-normal)' : (salScore >= 50 ? 'var(--status-monitor)' : 'var(--status-critical)');
    var salExpl = '';
    
    if (type === 'agriculture') {
        var ecVal = d.estimatedEC !== null ? d.estimatedEC : null;
        var ecRef = prof.ecwFullYield;
        var diff = ecVal !== null && ecRef !== undefined ? ecVal - ecRef : null;
        
        salExpl += `
            <div style="display: grid; grid-template-columns: 120px 1fr; gap: 4px; font-size: 13px; margin-bottom: 8px;">
                <span style="color: var(--text-secondary);">Current EC</span><span style="color: var(--text-primary); font-weight: 600;">${ecVal !== null ? formatNumber(ecVal, 2) + ' dS/m' : '--'}</span>
                <span style="color: var(--text-secondary);">Crop reference</span><span style="color: var(--text-primary);">${ecRef !== undefined ? formatNumber(ecRef, 2) + ' dS/m' : '--'}</span>
                ${diff !== null ? `<span style="color: var(--text-secondary);">Difference</span><span style="color: ${diff > 0 ? 'var(--status-critical)' : 'var(--status-normal)'};">${diff > 0 ? '+' : ''}${formatNumber(diff, 2)} dS/m</span>` : ''}
            </div>
        `;
        
        if (ecVal !== null && ecRef !== undefined) {
            if (diff > 0.5) {
                salExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The estimated EC of ${formatNumber(ecVal, 2)} dS/m is substantially above the configured ${escapeHtml(name)} full-yield reference of ${formatNumber(ecRef, 2)} dS/m. Therefore, salinity becomes an important limiting factor in the model, significantly reducing the salinity score.</div>`;
            } else if (diff > 0) {
                salExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The estimated EC of ${formatNumber(ecVal, 2)} dS/m is slightly above the configured ${escapeHtml(name)} reference of ${formatNumber(ecRef, 2)} dS/m. Therefore, the Aqua AI salinity component is reduced rather than receiving the maximum salinity score.</div>`;
            } else if (diff > -0.2) {
                salExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The estimated EC is close to the configured reference, so salinity has a moderate influence on the suitability score.</div>`;
            } else {
                salExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The estimated EC of ${formatNumber(ecVal, 2)} dS/m is below the configured reference of ${formatNumber(ecRef, 2)} dS/m, so salinity is not strongly limiting this crop under the configured model.</div>`;
            }
        }
    } else {
        var tdsVal = r.tds !== null ? r.tds : null;
        var tdsRef = prof.tdsMaximum;
        
        salExpl += `
            <div style="display: grid; grid-template-columns: 120px 1fr; gap: 4px; font-size: 13px; margin-bottom: 8px;">
                <span style="color: var(--text-secondary);">Current TDS</span><span style="color: var(--text-primary); font-weight: 600;">${tdsVal !== null ? formatNumber(tdsVal, 0) + ' mg/L' : '--'}</span>
                <span style="color: var(--text-secondary);">Reference max</span><span style="color: var(--text-primary);">${tdsRef !== undefined ? formatNumber(tdsRef, 0) + ' mg/L' : '--'}</span>
            </div>
        `;
        
        if (tdsVal !== null && tdsRef !== undefined) {
            if (tdsVal > tdsRef) {
                salExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The current TDS is above the configured maximum reference of ${formatNumber(tdsRef, 0)} mg/L, reducing the salinity contribution for this application.</div>`;
            } else {
                salExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The current TDS is below the configured reference maximum, producing a strong salinity component score.</div>`;
            }
        } else {
            salExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The current TDS produces the existing salinity component score for this application based on the configured model.</div>`;
        }
    }

    detailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">${salKey}</div>
            </div>
            ${salExpl}
        </div>
    `;
    
    // pH
    var phScore = resultObj.phScore;
    var phColor = phScore >= 80 ? 'var(--status-normal)' : (phScore >= 50 ? 'var(--status-monitor)' : 'var(--status-critical)');
    var phExpl = '';
    var phVal = r.ph !== null ? r.ph : null;
    var phMin = prof.phMin;
    var phMax = prof.phMax;
    
    phExpl += `
        <div style="display: grid; grid-template-columns: 120px 1fr; gap: 4px; font-size: 13px; margin-bottom: 8px;">
            <span style="color: var(--text-secondary);">Current pH</span><span style="color: var(--text-primary); font-weight: 600;">${phVal !== null ? formatNumber(phVal, 2) : '--'}</span>
            <span style="color: var(--text-secondary);">Preferred range</span><span style="color: var(--text-primary);">${phMin !== undefined && phMax !== undefined ? formatNumber(phMin, 1) + '–' + formatNumber(phMax, 1) : '--'}</span>
        </div>
    `;
    
    if (phVal !== null && phMin !== undefined && phMax !== undefined) {
        if (phVal < phMin) {
            phExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The measured pH of ${formatNumber(phVal, 2)} is slightly below the configured preferred range. The model therefore reduces the pH component score rather than treating pH as ideal.</div>`;
        } else if (phVal > phMax) {
            phExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The measured pH of ${formatNumber(phVal, 2)} is above the configured preferred range, reducing the pH component score.</div>`;
        } else {
            phExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The measured pH falls within the configured preferred range, so pH receives the maximum configured score.</div>`;
        }
    }

    detailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">pH</div>
            </div>
            ${phExpl}
        </div>
    `;
    
    // TEMPERATURE
    var tScore = resultObj.temperatureScore;
    var tExpl = '';
    var tVal = r.temperature !== null ? r.temperature : null;
    var tMin = prof.temperatureMin;
    var tMax = prof.temperatureMax;
    
    tExpl += `
        <div style="display: grid; grid-template-columns: 120px 1fr; gap: 4px; font-size: 13px; margin-bottom: 8px;">
            <span style="color: var(--text-secondary);">Current</span><span style="color: var(--text-primary); font-weight: 600;">${tVal !== null ? formatNumber(tVal, 1) + '°C' : '--'}</span>
            <span style="color: var(--text-secondary);">Preferred range</span><span style="color: var(--text-primary);">${tMin !== undefined && tMax !== undefined ? formatNumber(tMin, 1) + '–' + formatNumber(tMax, 1) + '°C' : '--'}</span>
        </div>
    `;
    
    if (tVal !== null && tMin !== undefined && tMax !== undefined) {
        if (tVal < tMin) {
            tExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The current temperature is below the preferred analytical range, reducing the temperature contribution to the crop suitability score.</div>`;
        } else if (tVal > tMax) {
            tExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The current temperature is above the preferred range, reducing the temperature contribution to the suitability score.</div>`;
        } else {
            tExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The current temperature is within the preferred analytical range, resulting in a favorable temperature score.</div>`;
        }
    }

    detailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">TEMPERATURE</div>
            </div>
            ${tExpl}
        </div>
    `;
    
    // CLARITY
    var turbExpl = '';
    var turbVal = r.turbidity !== null ? r.turbidity : null;
    
    turbExpl += `
        <div style="display: grid; grid-template-columns: 120px 1fr; gap: 4px; font-size: 13px; margin-bottom: 8px;">
            <span style="color: var(--text-secondary);">Turbidity</span><span style="color: var(--text-primary); font-weight: 600;">${turbVal !== null ? formatNumber(turbVal, 2) + ' NTU' : '--'}</span>
        </div>
        <div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The measured turbidity reduces the clarity component of the model. Therefore, clarity contributes to the final suitability according to the configured weight.</div>
    `;

    detailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">CLARITY</div>
            </div>
            ${turbExpl}
        </div>
    `;
    
    // COMPONENT BREAKDOWN
    var breakHtml = '';
    params.forEach(function(p) {
        var pColor = 'var(--text-muted)';
        if (p.score !== null) {
            if (p.score >= 80) pColor = 'var(--status-normal)';
            else if (p.score >= 50) pColor = 'var(--status-monitor)';
            else pColor = 'var(--status-critical)';
        }
        breakHtml += `
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <div style="display: flex; justify-content: space-between; font-size: 13px; align-items: baseline;">
                    <span style="color: var(--text-primary); font-weight: 500;">${p.name}</span>
                    <span style="color: var(--text-primary); font-weight: 600;">${p.score !== null ? Math.round(p.score) + '%' : '--'}</span>
                </div>
                <div style="height: 6px; background: rgba(128,128,128,0.15); border-radius: 3px; overflow: hidden; width: 100%;">
                    <div style="height: 100%; width: ${p.score !== null ? Math.max(0, Math.min(100, p.score)) : 0}%; background: ${pColor}; transition: width 0.5s ease; border-radius: 3px;"></div>
                </div>
            </div>
        `;
    });

    detailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 16px;">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px; margin-bottom: 12px;">COMPONENT BREAKDOWN</div>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                ${breakHtml}
            </div>
        </div>
    `;
    
    // MAIN LIMITING FACTOR
    var limScoreStr = minSc < 101 ? Math.round(minSc) + '%' : '--';
    detailsHtml += `
        <div style="border-top: 1px solid var(--border-light); padding-top: 16px;">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px;">MAIN LIMITING FACTOR</div>
            <div style="font-size: 14px; color: var(--text-primary); font-weight: 600; margin-bottom: 4px;">
                ${minSc < 85 && limitingName !== '' ? limitingName + ' — ' + limScoreStr : 'None identified'}
            </div>
            <div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">
                ${minSc < 85 && limitingName !== '' ? (minParams.length === 1 ? 'The current ' + minParams[0].toLowerCase() + ' configuration limits this application the most.' : limitingMsg) : limitingMsg}
            </div>
        </div>
    `;
    
    // MODEL NOTE
    detailsHtml += `
        <div style="margin-top: 8px; padding-top: 16px; border-top: 1px solid var(--border-light);">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px;">MODEL NOTE</div>
            <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5; font-style: italic;">
                Overall, the crop's suitability is determined from the weighted combination of pH, salinity/EC, clarity and temperature. The result is an analytical prediction based only on the available sensor parameters. 
                ${type === 'agriculture' ? 'Actual crop performance also depends on soil properties, irrigation management, climate, drainage and other agronomic conditions that are not measured by this system.' : ''}
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
                <div style="margin-top: 4px; line-height: 1.4;">${minSc < 85 ? (minParams.length === 1 ? minParams[0] : minParams.join(' + ')) : "No major limiting factor"}</div>
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
