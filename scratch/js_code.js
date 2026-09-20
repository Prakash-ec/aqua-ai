let currentAnalysisResults = { agriculture: [], industrial: [], domestic: [], general: [] };
let activeAnalysisCategory = 'agriculture';

window.switchAnalysisCategoryTab = function(category) {
    activeAnalysisCategory = category;
    document.querySelectorAll('.an-tab').forEach(function(tab) {
        if (tab.dataset.anTab === category) {
            tab.classList.add('active');
            tab.style.borderBottom = '2px solid var(--accent-primary)';
            tab.style.color = 'var(--text-primary)';
            tab.setAttribute('aria-selected', 'true');
        } else {
            tab.classList.remove('active');
            tab.style.borderBottom = '2px solid transparent';
            tab.style.color = 'var(--text-secondary)';
            tab.setAttribute('aria-selected', 'false');
        }
    });

    var results = currentAnalysisResults[category] || [];
    var ch = '';
    var icons = { 'agriculture': '🌾 ', 'industrial': '🏭 ', 'domestic': '🏡 ', 'general': '⚙️ ' };
    var icon = icons[category] || '📌 ';
    
    if (results.length > 0) {
        var topMatch = results[0];
        var topName = topMatch.result.crop || topMatch.result.name;
        var topScore = topMatch.result.suitability !== null ? Math.round(topMatch.result.suitability) : 0;
        var catTitles = { 'agriculture': 'AGRICULTURE', 'industrial': 'INDUSTRY', 'domestic': 'DOMESTIC', 'general': 'GENERAL UTILITY' };
        var sumHtml = '<div style="margin-bottom: 8px; padding: 12px; background: var(--bg-soft); border-radius: 8px;">' +
            '<div style="font-size: 11px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.5px;">' + catTitles[category] + ' SUMMARY</div>' +
            '<div style="font-size: 13px; color: var(--text-primary); margin-top: 4px;">Top configured match: <strong>' + escapeHtml(topName) + ' (' + topScore + '%)</strong></div>' +
            '</div>';
        setAnalysisHtml('analysisCategorySummary', sumHtml);
        
        var displayResults = category === 'agriculture' ? results.slice(0, 5) : results;
        displayResults.forEach(function(r, i) {
            ch += renderDetailedApplicationCard(r, category + '-' + i, icon);
        });
    } else {
        setAnalysisHtml('analysisCategorySummary', '');
    }
    setAnalysisHtml('analysisApplicationContent', ch);
};

window.toggleAnalysisDetails = function(id) {
    var el = document.getElementById(id);
    var btn = document.getElementById(id + '-btn');
    if (el) {
        var isHidden = el.classList.contains('hidden');
        if (isHidden) {
            document.querySelectorAll('.analysis-detail-dropdown').forEach(function(d) { d.classList.add('hidden'); });
            document.querySelectorAll('.analysis-detail-btn').forEach(function(b) {
                b.setAttribute('aria-expanded', 'false');
                b.innerHTML = 'Why does this suit the water? ▾';
            });
            el.classList.remove('hidden');
            if (btn) {
                btn.setAttribute('aria-expanded', 'true');
                btn.innerHTML = 'Close explanation ▴';
            }
        } else {
            el.classList.add('hidden');
            if (btn) {
                btn.setAttribute('aria-expanded', 'false');
                btn.innerHTML = 'Why does this suit the water? ▾';
            }
        }
    }
};

function renderDetailedApplicationCard(item, idPrefix, icon) {
    var profile = item.profile;
    var result = item.result;
    var type = item.type;
    var currentDerived = item.currentDerived;
    var currentReading = item.currentReading;
    
    var name = result.crop || result.name;
    var score = result.suitability !== null ? Math.round(result.suitability) : 0;
    
    var clsInfo = getQualityClass(score);
    var label = clsInfo.label;
    var color = clsInfo.color;
    
    var phScore = result.phScore;
    var turbScore = result.turbidityScore;
    var tempScore = result.temperatureScore;
    
    var salLabel, salScore, salCurrent, salRef, salReason;
    if (type === 'agriculture') {
        salScore = result.salinityScore;
        salLabel = "EC";
        salCurrent = currentDerived.estimatedEC !== null ? formatNumber(currentDerived.estimatedEC, 2) : "--";
        salRef = profile.ecwFullYield !== undefined ? formatNumber(profile.ecwFullYield, 2) : "--";
        var isHigh = currentDerived.estimatedEC > profile.ecwFullYield;
        salReason = salScore !== null && salScore < 100 && isHigh ? "EC is above the reference → salinity score is reduced." : (salScore === 100 ? "EC is within optimal range." : "EC affects score.");
    } else {
        salScore = result.tdsScore;
        salLabel = "TDS";
        salCurrent = currentReading.tds !== null ? formatNumber(currentReading.tds, 0) : "--";
        salRef = profile.tdsMaximum !== undefined ? formatNumber(profile.tdsMaximum, 0) : "--";
        var isHighTDS = currentReading.tds > profile.tdsMaximum;
        salReason = salScore !== null && salScore < 100 && isHighTDS ? "TDS is above the reference → salinity score is reduced." : (salScore === 100 ? "TDS is within optimal range." : "TDS affects score.");
    }
    
    var scores = [
        { name: 'pH', score: phScore },
        { name: salLabel === 'EC' ? 'Salinity / EC' : 'Salinity / TDS', score: salScore },
        { name: 'Clarity', score: turbScore },
        { name: 'Temperature', score: tempScore }
    ];
    
    var minScore = 100;
    var limitingFactor = null;
    scores.forEach(function(s) {
        if (s.score !== null && s.score < minScore) {
            minScore = s.score;
            limitingFactor = s;
        }
    });
    
    var limHtml = '';
    if (limitingFactor && minScore < 85) {
        limHtml = '<div style="margin-top: 12px; font-size: 12px; color: var(--text-secondary);"><div style="font-weight: 600; font-size: 11px; text-transform: uppercase; color: var(--text-muted);">Main Limiting Factor</div><div style="margin-top: 4px;"><span style="font-weight: 600;">' + limitingFactor.name + ' — ' + Math.round(limitingFactor.score) + '%</span></div><div style="margin-top: 2px;">' + limitingFactor.name + ' is the strongest limiting parameter for this profile.</div></div>';
    } else {
        limHtml = '<div style="margin-top: 12px; font-size: 12px; color: var(--text-secondary);"><div style="font-weight: 600; font-size: 11px; text-transform: uppercase; color: var(--text-muted);">Main Limiting Factor</div><div style="margin-top: 4px;">Available sensor parameters are within the configured range for this application.</div></div>';
    }
    
    var rowFmt = function(label, cur, ref, sc) {
        return '<div style="display: flex; justify-content: space-between; font-size: 12px; padding: 4px 0; border-bottom: 1px solid var(--border-subtle);">' +
            '<span style="flex: 1;">' + label + '</span>' +
            '<span style="flex: 1; text-align: right; color: var(--text-muted);">' + cur + '</span>' +
            '<span style="flex: 1; text-align: right; font-weight: 600; color: ' + getQualityClass(sc !== null ? sc : 0).color + ';">' + (sc !== null ? Math.round(sc) + '%' : '--') + '</span>' +
            '</div>';
    };
    
    var phCurrent = currentReading.ph !== null ? formatNumber(currentReading.ph, 2) : '--';
    var turbCurrent = currentReading.turbidity !== null ? formatNumber(currentReading.turbidity, 2) : '--';
    var tempCurrent = currentReading.temperature !== null ? formatNumber(currentReading.temperature, 1) : '--';
    
    var expHtml = '<div id="' + idPrefix + '-exp" class="analysis-detail-dropdown hidden" style="margin-top: 16px; padding: 16px; background: var(--bg-soft); border-radius: 8px; border: 1px solid var(--border-subtle);">' +
        '<div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">' +
        '<span style="flex: 1;">Parameter</span><span style="flex: 1; text-align: right;">Current</span><span style="flex: 1; text-align: right;">Score</span></div>' +
        rowFmt('pH', phCurrent, profile.phMax, phScore) +
        rowFmt(salLabel, salCurrent, salRef, salScore) +
        rowFmt('Turbidity', turbCurrent, profile.turbidityMaximum, turbScore) +
        rowFmt('Temperature', tempCurrent, profile.temperatureMax, tempScore) +
        '<div style="margin-top: 12px; font-size: 12px; font-weight: 600; color: var(--text-primary);">Configured Reference</div>' +
        '<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Reference ' + salLabel + ': ' + salRef + '</div>' +
        '<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px; font-style: italic;">' + salReason + '</div>' +
        '<div style="margin-top: 12px; font-size: 11px; color: var(--text-muted);">' + (type === 'agriculture' ? 'Prediction based on available water parameters; field conditions also influence crop performance.' : 'Analytical suitability estimate based on available water parameters.') + '</div>' +
        '</div>';
        
    return '<div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; display: flex; flex-direction: column;">' +
        '<div style="display: flex; justify-content: space-between; align-items: flex-start;">' +
        '<div><div style="font-size: 16px; font-weight: 600;">' + icon + escapeHtml(name) + '</div>' +
        '<div style="font-size: 13px; font-weight: 600; color: ' + color + '; margin-top: 4px;">' + label + '</div></div>' +
        '<div style="font-size: 28px; font-weight: 700; color: ' + color + ';">' + score + '%</div>' +
        '</div>' +
        '<div style="margin-top: 16px; height: 6px; background: var(--bg-soft); border-radius: 3px; overflow: hidden;">' +
        '<div style="height: 100%; width: ' + score + '%; background: ' + color + '; transition: width 0.3s ease;"></div>' +
        '</div>' +
        limHtml +
        '<button id="' + idPrefix + '-btn" class="analysis-detail-btn" type="button" aria-expanded="false" aria-controls="' + idPrefix + '-exp" onclick="toggleAnalysisDetails(\'' + idPrefix + '-exp\')" style="margin-top: 16px; width: 100%; padding: 8px; background: transparent; border: 1px solid var(--border-subtle); border-radius: 6px; font-size: 12px; font-weight: 600; color: var(--text-secondary); cursor: pointer; transition: all 0.2s;">Why does this suit the water? ▾</button>' +
        expHtml +
        '</div>';
}

function updateAnalysisPage() {
    var reading = latestReading;
    if (!reading) return;

    var derived = deriveParameters(reading);
    
    // 1. Hero Ring Score
    var overallScore = Math.round(derived.analyticalWaterScore);
    var cls = getQualityClass(overallScore);
    var heroHtml = '<div style="display: flex; align-items: center; gap: 24px;">' +
        '<div style="position: relative; width: 100px; height: 100px; border-radius: 50%; background: conic-gradient(' + cls.color + ' ' + overallScore + '%, var(--border-subtle) 0); display: flex; align-items: center; justify-content: center;">' +
        '<div style="position: absolute; width: 84px; height: 84px; border-radius: 50%; background: var(--bg-card); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; color: var(--text-primary);">' + overallScore + '%</div>' +
        '</div>' +
        '<div><h3 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">' + cls.label + '</h3><p style="font-size: 13px; color: var(--text-secondary);">Overall analytical water quality score</p></div>' +
        '</div>';
    setAnalysisHtml('analysisSummary', heroHtml);

    // 2. Current Parameters (Measured)
    var fmt = function(v, d) { return v !== null ? formatNumber(v, d) : '--'; };
    var stat = function(v, min, max, l, u) { 
        if (v === null) return {t: 'Unknown', c: 'var(--text-muted)'};
        if (v >= min && v <= max) return {t: 'Optimal', c: 'var(--emerald-400)'};
        if (v >= l && v <= u) return {t: 'Moderate', c: 'var(--amber-400)'};
        return {t: 'Limiting', c: 'var(--rose-400)'};
    };
    var stPH = stat(reading.ph, ANALYSIS_CONFIG.ph.optimalMin, ANALYSIS_CONFIG.ph.optimalMax, ANALYSIS_CONFIG.ph.acceptableMin, ANALYSIS_CONFIG.ph.acceptableMax);
    var stTDS = stat(reading.tds, ANALYSIS_CONFIG.tds.optimalMax - 200, ANALYSIS_CONFIG.tds.optimalMax, ANALYSIS_CONFIG.tds.optimalMax, ANALYSIS_CONFIG.tds.absoluteMax);
    var stTurb = stat(reading.turbidity, 0, ANALYSIS_CONFIG.turbidity.optimalMax, 0, ANALYSIS_CONFIG.turbidity.acceptableMax);
    var stTemp = stat(reading.temperature, ANALYSIS_CONFIG.temperature.optimalMin, ANALYSIS_CONFIG.temperature.optimalMax, ANALYSIS_CONFIG.temperature.acceptableMin, ANALYSIS_CONFIG.temperature.acceptableMax);
    
    var cpH = '<div style="background: var(--bg-soft); border-radius: 12px; padding: 16px;">' +
        '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">pH</div>' +
        '<div style="font-size: 20px; font-weight: 600; margin-bottom: 8px;">' + fmt(reading.ph, 2) + '</div>' +
        '<div style="font-size: 11px; font-weight: 600; color: ' + stPH.c + ';">● ' + stPH.t + '</div></div>';
        
    var cTDS = '<div style="background: var(--bg-soft); border-radius: 12px; padding: 16px;">' +
        '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">TDS (mg/L)</div>' +
        '<div style="font-size: 20px; font-weight: 600; margin-bottom: 8px;">' + fmt(reading.tds, 0) + '</div>' +
        '<div style="font-size: 11px; font-weight: 600; color: ' + stTDS.c + ';">● ' + stTDS.t + '</div></div>';
        
    var cTurb = '<div style="background: var(--bg-soft); border-radius: 12px; padding: 16px;">' +
        '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Turbidity (NTU)</div>' +
        '<div style="font-size: 20px; font-weight: 600; margin-bottom: 8px;">' + fmt(reading.turbidity, 2) + '</div>' +
        '<div style="font-size: 11px; font-weight: 600; color: ' + stTurb.c + ';">● ' + stTurb.t + '</div></div>';
        
    var cTemp = '<div style="background: var(--bg-soft); border-radius: 12px; padding: 16px;">' +
        '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Temperature (°C)</div>' +
        '<div style="font-size: 20px; font-weight: 600; margin-bottom: 8px;">' + fmt(reading.temperature, 1) + '</div>' +
        '<div style="font-size: 11px; font-weight: 600; color: ' + stTemp.c + ';">● ' + stTemp.t + '</div></div>';

    setAnalysisHtml('analysisCurrentParams', '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px;">' + cpH + cTurb + cTDS + cTemp + '</div>');

    // 3. Derived
    var dEC = '<div style="padding: 12px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between;"><span style="color: var(--text-secondary); font-size: 13px;">Estimated EC</span><span style="font-weight: 600;">' + fmt(derived.estimatedEC, 2) + ' dS/m</span></div>';
    var dH = '<div style="padding: 12px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between;"><span style="color: var(--text-secondary); font-size: 13px;">H⁺ Concentration</span><span style="font-weight: 600;">' + (derived.hydrogenIonConcentration ? derived.hydrogenIonConcentration.toExponential(2) : '--') + ' mol/L</span></div>';
    var dSal = '<div style="padding: 12px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between;"><span style="color: var(--text-secondary); font-size: 13px;">Salinity Index</span><span style="font-weight: 600;">' + Math.round(derived.salinityIndex || 0) + '%</span></div>';
    var dClar = '<div style="padding: 12px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between;"><span style="color: var(--text-secondary); font-size: 13px;">Clarity Index</span><span style="font-weight: 600;">' + Math.round(derived.clarityIndex || 0) + '%</span></div>';
    var dpH = '<div style="padding: 12px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between;"><span style="color: var(--text-secondary); font-size: 13px;">pH Index</span><span style="font-weight: 600;">' + Math.round(derived.phIndex || 0) + '%</span></div>';
    var dTemp = '<div style="padding: 12px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between;"><span style="color: var(--text-secondary); font-size: 13px;">Temperature Index</span><span style="font-weight: 600;">' + Math.round(derived.temperatureIndex || 0) + '%</span></div>';
    
    setAnalysisHtml('analysisDerivedParams', '<div style="background: var(--bg-soft); border-radius: 12px; overflow: hidden;">' + dEC + dH + dSal + dClar + dpH + dTemp + '</div>');

    // 4. Score Breakdown
    var bdRow = function(name, val) {
        var v = val !== null ? Math.round(val) : 0;
        var cl = getQualityClass(v);
        return '<div style="margin-bottom: 16px;"><div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; margin-bottom: 6px;"><span>' + name + '</span><span style="color: ' + cl.color + ';">' + v + '%</span></div>' +
            '<div style="height: 6px; background: var(--bg-soft); border-radius: 3px; overflow: hidden;"><div style="height: 100%; width: ' + v + '%; background: ' + cl.color + ';"></div></div></div>';
    };
    setAnalysisHtml('analysisScoreSection', bdRow('pH', derived.phIndex) + bdRow('Salinity / EC', derived.salinityIndex) + bdRow('Clarity', derived.clarityIndex) + bdRow('Temperature', derived.temperatureIndex));
    setAnalysisHtml('analysisKeyLimitingFactor', ''); // Clear limiting factor global text

    // 5. Application Suitability Tabs
    currentAnalysisResults.agriculture = CROP_PROFILES.map(function(c) {
        return { profile: c, result: calculateCropScore(reading, c), type: 'agriculture', currentDerived: derived, currentReading: reading };
    }).sort(function(a, b) { return (b.result.suitability || 0) - (a.result.suitability || 0); });
    
    currentAnalysisResults.industrial = INDUSTRIAL_PROFILES.map(function(p) {
        return { profile: p, result: calculateApplicationScore(reading, p), type: 'industrial', currentDerived: derived, currentReading: reading };
    }).sort(function(a, b) { return (b.result.suitability || 0) - (a.result.suitability || 0); });
    
    currentAnalysisResults.domestic = DOMESTIC_PROFILES.map(function(p) {
        return { profile: p, result: calculateApplicationScore(reading, p), type: 'domestic', currentDerived: derived, currentReading: reading };
    }).sort(function(a, b) { return (b.result.suitability || 0) - (a.result.suitability || 0); });
    
    currentAnalysisResults.general = UTILITY_PROFILES.map(function(p) {
        return { profile: p, result: calculateApplicationScore(reading, p), type: 'general', currentDerived: derived, currentReading: reading };
    }).sort(function(a, b) { return (b.result.suitability || 0) - (a.result.suitability || 0); });

    var tabs = document.querySelectorAll('.an-tab');
    if (tabs.length > 0 && !tabs[0].hasAttribute('data-listener')) {
        tabs.forEach(function(t) {
            t.setAttribute('data-listener', 'true');
            t.addEventListener('click', function(e) {
                switchAnalysisCategoryTab(e.target.dataset.anTab);
            });
        });
    }

    switchAnalysisCategoryTab(activeAnalysisCategory);

    // 6. Drinking Screening
    var dr = DRINKING_PROFILE;
    var dRes = calculateApplicationScore(reading, dr);
    var dScore = dRes.suitability !== null ? Math.round(dRes.suitability) : 0;
    var dCls = getQualityClass(dScore);
    var dhHtml = '<div style="background: var(--bg-soft); border-radius: 12px; padding: 20px;">' +
        '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">' +
        '<div><div style="font-size: 16px; font-weight: 600;">Overall Screening Score</div><div style="font-size: 13px; font-weight: 600; color: ' + dCls.color + '; margin-top: 4px;">' + dCls.label + '</div></div>' +
        '<div style="font-size: 28px; font-weight: 700; color: ' + dCls.color + ';">' + dScore + '%</div>' +
        '</div>' +
        '<div style="height: 6px; background: var(--bg-card); border-radius: 3px; overflow: hidden; margin-bottom: 16px;"><div style="height: 100%; width: ' + dScore + '%; background: ' + dCls.color + ';"></div></div>' +
        '<div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase;">' +
        '<span style="flex: 1;">Parameter</span><span style="flex: 1; text-align: right;">Current</span><span style="flex: 1; text-align: right;">Reference</span><span style="flex: 1; text-align: right;">Score</span></div>' +
        '<div style="display: flex; justify-content: space-between; font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--border-subtle);"><span style="flex: 1;">pH</span><span style="flex: 1; text-align: right; color: var(--text-secondary);">' + fmt(reading.ph, 2) + '</span><span style="flex: 1; text-align: right; color: var(--text-secondary);">' + dr.phMin + '-' + dr.phMax + '</span><span style="flex: 1; text-align: right; font-weight: 600;">' + Math.round(dRes.phScore !== null ? dRes.phScore : 0) + '%</span></div>' +
        '<div style="display: flex; justify-content: space-between; font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--border-subtle);"><span style="flex: 1;">TDS</span><span style="flex: 1; text-align: right; color: var(--text-secondary);">' + fmt(reading.tds, 0) + '</span><span style="flex: 1; text-align: right; color: var(--text-secondary);">' + dr.tdsMaximum + ' max</span><span style="flex: 1; text-align: right; font-weight: 600;">' + Math.round(dRes.tdsScore !== null ? dRes.tdsScore : 0) + '%</span></div>' +
        '<div style="display: flex; justify-content: space-between; font-size: 12px; padding: 6px 0;"><span style="flex: 1;">Turbidity</span><span style="flex: 1; text-align: right; color: var(--text-secondary);">' + fmt(reading.turbidity, 2) + '</span><span style="flex: 1; text-align: right; color: var(--text-secondary);">' + dr.turbidityMaximum + ' max</span><span style="flex: 1; text-align: right; font-weight: 600;">' + Math.round(dRes.turbidityScore !== null ? dRes.turbidityScore : 0) + '%</span></div>' +
        '<div style="margin-top: 16px; font-size: 11px; color: var(--text-muted); line-height: 1.5;">Screening assessment based on available sensor parameters; laboratory verification is separate.</div>' +
        '</div>';
    setAnalysisHtml('analysisDrinkingSection', dhHtml);
}
