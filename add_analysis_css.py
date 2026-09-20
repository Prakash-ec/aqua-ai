with open('D:/aqua-ai/frontend/style.css', 'r', encoding='utf-8') as f:
    content = f.read()

analysis_css = '''

/* =========================================================
   ANALYSIS PAGE STYLES
   ========================================================= */

.analysis-overall-card {
    margin-bottom: 20px;
}

.overall-assessment-content {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
}

.overall-status-badge {
    display: inline-flex;
    align-items: center;
    padding: 6px 14px;
    border-radius: var(--radius-full);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
}

.overall-status-badge.unknown {
    background: var(--bg-soft);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
}

.overall-status-badge.safe {
    background: var(--status-normal-bg);
    color: var(--status-normal);
    border: 1px solid var(--status-normal-border);
}

.overall-status-badge.watch {
    background: var(--status-monitor-bg);
    color: var(--status-monitor);
    border: 1px solid var(--status-monitor-border);
}

.overall-status-badge.alert {
    background: var(--status-critical-bg);
    color: var(--status-critical);
    border: 1px solid var(--status-critical-border);
}

.overall-assessment-content h4 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
}

.overall-assessment-content p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 14px;
}

/* Current Parameters - Card Grid */
.parameter-cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin-top: 16px;
}

.parameter-card {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 20px;
    text-align: center;
    transition: var(--transition);
}

.parameter-card:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-sm);
}

.parameter-card-icon {
    width: 44px;
    height: 44px;
    margin: 0 auto 12px;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: var(--primary-dark);
    background: var(--primary-light);
}

.parameter-card.temperature-card .parameter-card-icon {
    background: rgba(245, 158, 11, 0.15);
    color: #d97706;
}

.parameter-card.ph-card .parameter-card-icon {
    background: rgba(59, 130, 246, 0.15);
    color: #2563eb;
}

.parameter-card.turbidity-card .parameter-card-icon {
    background: rgba(139, 92, 246, 0.15);
    color: #7c3aed;
}

.parameter-card.tds-card .parameter-card-icon {
    background: rgba(14, 165, 164, 0.15);
    color: #0d9488;
}

.parameter-card-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
}

.parameter-card-value {
    font-size: 28px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
    margin-bottom: 8px;
}

.parameter-card-value span {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-left: 4px;
}

.parameter-card-condition {
    display: inline-block;
    padding: 4px 12px;
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.parameter-card-condition:contains("Normal"),
.parameter-card-condition:contains("Within reference"),
.parameter-card-condition:contains("Low"),
.parameter-card-condition:contains("good") {
    background: var(--status-normal-bg);
    color: var(--status-normal);
}

.parameter-card-condition:contains("Elevated"),
.parameter-card-condition:contains("Moderate"),
.parameter-card-condition:contains("Attention"),
.parameter-card-condition:contains("caution") {
    background: var(--status-monitor-bg);
    color: var(--status-monitor);
}

.parameter-card-condition:contains("High"),
.parameter-card-condition:contains("Very high"),
.parameter-card-condition:contains("Very elevated"),
.parameter-card-condition:contains("Acidic"),
.parameter-card-condition:contains("Alkaline"),
.parameter-card-condition:contains("alert"),
.parameter-card-condition:contains("Outside") {
    background: var(--status-critical-bg);
    color: var(--status-critical);
}

.parameter-card-condition:contains("Waiting"),
.parameter-card-condition:contains("unavailable"),
.parameter-card-condition:contains("unknown") {
    background: var(--bg-soft);
    color: var(--text-secondary);
}

/* Derived Parameters */
.derived-parameters-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-top: 16px;
}

.derived-item {
    background: var(--bg-soft);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 16px;
}

.derived-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
}

.derived-value {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
}

/* Water Use Analysis Tabs */
.analysis-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 20px 0 16px;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 8px;
}

.analysis-tab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    transition: var(--transition);
    cursor: pointer;
}

.analysis-tab:hover:not(.active) {
    color: var(--text-primary);
    background: var(--bg-hover);
    border-color: var(--border-strong);
}

.analysis-tab.active {
    color: var(--primary-dark);
    background: var(--primary-light);
    border-color: var(--primary);
}

.analysis-tab-panel {
    display: none;
    animation: fadeIn 0.2s ease;
}

.analysis-tab-panel.active {
    display: block;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
}

.analysis-panel-content {
    min-height: 200px;
}

.analysis-panel-section {
    margin-bottom: 24px;
}

.analysis-panel-section h5 {
    margin: 0 0 12px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
}

.analysis-status {
    display: inline-block;
    padding: 8px 16px;
    border-radius: var(--radius-md);
    font-size: 13px;
    font-weight: 600;
}

.analysis-status.potentially-suitable {
    background: var(--status-normal-bg);
    color: var(--status-normal);
}

.analysis-status.use-caution {
    background: var(--status-monitor-bg);
    color: var(--status-monitor);
}

.analysis-status.restricted {
    background: var(--status-critical-bg);
    color: var(--status-critical);
}

.analysis-status.analysis-incomplete {
    background: var(--bg-soft);
    color: var(--text-secondary);
}

.analysis-assessment-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
}

.analysis-assessment-grid div {
    padding: 12px;
    background: var(--bg-soft);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    font-size: 13px;
}

.analysis-assessment-grid strong {
    display: block;
    margin-bottom: 4px;
    color: var(--text-primary);
}

.crop-disclaimer {
    font-size: 12px;
    color: var(--text-secondary);
    margin: 0 0 12px;
    font-style: italic;
}

.crop-groups-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.crop-tag {
    display: inline-block;
    padding: 6px 12px;
    background: var(--primary-light);
    color: var(--primary-dark);
    border-radius: var(--radius-full);
    font-size: 12px;
    font-weight: 500;
    border: 1px solid var(--primary);
}

.industry-disclaimer,
.general-disclaimer,
.drinking-disclaimer {
    font-size: 12px;
    color: var(--text-secondary);
    margin: 0 0 16px;
    font-style: italic;
}

.analysis-list {
    margin: 0;
    padding-left: 20px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.8;
}

.analysis-list li {
    margin-bottom: 6px;
}

.concerns-list li {
    color: var(--status-critical);
}

.general-use-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
}

.general-use-card {
    padding: 16px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    background: var(--bg-card);
}

.general-use-card.suitable {
    border-color: var(--status-normal-border);
    background: var(--status-normal-bg);
}

.general-use-card.caution {
    border-color: var(--status-monitor-border);
    background: var(--status-monitor-bg);
}

.general-use-card h6 {
    margin: 0 0 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
}

.suitability-badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    margin-bottom: 8px;
}

.general-use-card.suitable .suitability-badge {
    background: var(--status-normal);
    color: white;
}

.general-use-card.caution .suitability-badge {
    background: var(--status-monitor);
    color: white;
}

.general-use-card p {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
}

.drinking-warning {
    margin-top: 24px;
    padding: 16px;
    background: var(--status-critical-bg);
    border: 1px solid var(--status-critical-border);
    border-radius: var(--radius-md);
    color: var(--status-critical);
}

.drinking-warning h5 {
    margin: 0 0 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--status-critical);
}

.drinking-warning p {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
}

.drinking-warning ul {
    margin: 10px 0 0;
    padding-left: 20px;
    font-size: 12px;
}

.drinking-warning li {
    margin-bottom: 4px;
}

/* Drinking Tab */
.drinking-params-table {
    overflow-x: auto;
}

.drinking-params-table table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}

.drinking-params-table th,
.drinking-params-table td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
}

.drinking-params-table th {
    background: var(--bg-soft);
    font-weight: 600;
    color: var(--text-secondary);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.drinking-params-table td.good {
    color: var(--status-normal);
    font-weight: 600;
}

.drinking-params-table td.attention {
    color: var(--status-critical);
    font-weight: 600;
}

.drinking-params-table td.unavailable {
    color: var(--text-secondary);
}

.drinking-conclusion {
    padding: 16px;
    background: var(--bg-soft);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
}

.drinking-conclusion h5 {
    margin: 0 0 10px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
}

.drinking-conclusion p {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
}

.drinking-conclusion ul {
    margin: 0;
    padding-left: 20px;
    font-size: 12px;
    color: var(--text-secondary);
}

.drinking-conclusion li {
    margin-bottom: 4px;
}

/* Why This Result */
.why-result-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.why-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 16px;
    border-radius: var(--radius-md);
    font-size: 13px;
    line-height: 1.5;
}

.why-item.good {
    background: var(--status-normal-bg);
    color: var(--status-normal);
    border: 1px solid var(--status-normal-border);
}

.why-item.warning {
    background: var(--status-monitor-bg);
    color: var(--status-monitor);
    border: 1px solid var(--status-monitor-border);
}

.why-item.unavailable {
    background: var(--bg-soft);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
}

/* Key Concerns */
.concerns-list {
    margin: 0;
    padding-left: 20px;
    list-style: none;
}

.concerns-list li {
    position: relative;
    padding-left: 24px;
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--text-primary);
    line-height: 1.5;
}

.concerns-list li::before {
    content: "⚠";
    position: absolute;
    left: 0;
    top: 0;
    font-size: 14px;
}

.concerns-placeholder {
    color: var(--status-normal);
    font-size: 13px;
    margin: 0;
}

/* Recommendations */
.recommendations-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
    margin-top: 8px;
}

.recommendation-card {
    padding: 18px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
}

.recommendation-card.good {
    background: var(--status-normal-bg);
    border-color: var(--status-normal-border);
}

.recommendation-card.caution {
    background: var(--status-monitor-bg);
    border-color: var(--status-monitor-border);
}

.recommendation-card.alert {
    background: var(--status-critical-bg);
    border-color: var(--status-critical-border);
}

.recommendation-card.info {
    background: var(--bg-soft);
    border-color: var(--border-color);
}

.recommendation-card h6 {
    margin: 0 0 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
}

.recommendation-card p {
    margin: 0;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
}

/* Limitations */
.limitations-list {
    margin: 0;
    padding-left: 20px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.7;
}

.limitations-list li {
    margin-bottom: 10px;
}

.limitations-list strong {
    color: var(--text-primary);
}

/* Responsive */
@media (max-width: 768px) {
    .parameter-cards-grid {
        grid-template-columns: 1fr 1fr;
    }

    .derived-parameters-grid {
        grid-template-columns: 1fr 1fr;
    }

    .analysis-tabs {
        gap: 6px;
    }

    .analysis-tab {
        padding: 8px 12px;
        font-size: 12px;
    }

    .recommendations-grid {
        grid-template-columns: 1fr;
    }

    .general-use-grid {
        grid-template-columns: 1fr;
    }

    .analysis-assessment-grid {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 480px) {
    .parameter-cards-grid {
        grid-template-columns: 1fr;
    }

    .derived-parameters-grid {
        grid-template-columns: 1fr;
    }
}
'''

# Append to end of file
new_content = content.rstrip() + '\n' + analysis_css + '\n'

with open('D:/aqua-ai/frontend/style.css', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Added Analysis CSS successfully')