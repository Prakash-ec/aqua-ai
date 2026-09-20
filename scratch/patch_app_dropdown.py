import re

with open('frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

new_render_func = """
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
                ${escapeHtml(name)} scores <strong>${sValStr}</strong> for the current water based on the configured Aqua AI analytical model. This indicates a <strong>${label.toLowerCase()}</strong> match.
            </div>
        </div>
    `;

    // SALINITY / EC
    var salKey = type === 'agriculture' ? 'Salinity / EC' : 'TDS / Salinity';
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
                salExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The estimated EC is substantially above the configured ${escapeHtml(name)} full-yield reference of ${formatNumber(ecRef, 2)} dS/m. Therefore, salinity becomes an important limiting factor in the model, significantly reducing the salinity score.</div>`;
            } else if (diff > 0) {
                salExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The estimated EC is slightly above the configured ${escapeHtml(name)} reference. Therefore, the Aqua AI salinity component is reduced rather than receiving the maximum salinity score.</div>`;
            } else if (diff > -0.5) {
                salExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The estimated EC is close to the configured reference, so salinity has a moderate influence on the suitability score.</div>`;
            } else {
                salExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The estimated EC is well below the configured reference, so salinity is not strongly limiting this crop under the configured model.</div>`;
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
            phExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The measured pH is below the configured preferred range. The model therefore reduces the pH component score rather than treating pH as ideal.</div>`;
        } else if (phVal > phMax) {
            phExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The measured pH is above the configured preferred range, reducing the pH component score.</div>`;
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
            tExpl += `<div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The current temperature is below the preferred analytical range, reducing the temperature contribution to the suitability score.</div>`;
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
        <div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">The measured turbidity is evaluated through the existing Aqua AI clarity scoring model. Therefore, clarity contributes to the final suitability according to the configured weight.</div>
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
                ${limitingMsg}
            </div>
        </div>
    `;
    
    // MODEL NOTE
    detailsHtml += `
        <div style="margin-top: 8px; padding-top: 16px; border-top: 1px solid var(--border-light);">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px;">MODEL NOTE</div>
            <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5; font-style: italic;">
                Overall, the suitability is determined from the weighted combination of pH, salinity/EC, clarity and temperature. The result is an analytical prediction based only on the available sensor parameters. 
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

# Replace the existing renderDetailedApplicationCard and toggleAnalysisDetails
pattern = r"function\s+renderDetailedApplicationCard\s*\([^)]*\)\s*\{"
match = re.search(pattern, content)
if match:
    start_idx = match.start()
    
    # We must also remove `window.toggleAnalysisDetails` before it
    toggle_pattern = r"window\.toggleAnalysisDetails\s*=\s*function[^)]*\)\s*\{"
    match_toggle = re.search(toggle_pattern, content)
    if match_toggle and match_toggle.start() < start_idx:
        start_idx = match_toggle.start()

    # Find the end of renderDetailedApplicationCard
    end_idx = -1
    braces = 0
    in_func = False
    
    # Skip until we find the start of renderDetailedApplicationCard itself
    # Actually just iterate from the original match
    match_render = re.search(pattern, content[start_idx:])
    if match_render:
        render_start = start_idx + match_render.start()
        for i in range(render_start, len(content)):
            if content[i] == '{':
                braces += 1
                in_func = True
            elif content[i] == '}':
                braces -= 1
            if in_func and braces == 0:
                end_idx = i + 1
                break
    
    if end_idx != -1:
        content = content[:start_idx] + new_render_func + "\n" + content[end_idx:]

with open('frontend/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
