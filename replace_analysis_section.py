with open('D:/aqua-ai/frontend/index.html', 'r') as f:
    content = f.read()

# Find the Analysis section start and end
start_marker = '''                <!-- =========================================
                     ANALYSIS PAGE
                 ========================================== -->
                <section
                    class="page-section"
                    id="page-analysis"
                    data-page-section="analysis"
                >'''

end_marker = '''                </section>

                <!-- =========================================
                     TRENDS PAGE'''

start = content.find(start_marker)
end = content.find(end_marker)

if start != -1 and end != -1:
    new_analysis_section = '''                <!-- =========================================
                     ANALYSIS PAGE
                 ========================================== -->
                <section
                    class="page-section"
                    id="page-analysis"
                    data-page-section="analysis"
                >

                    <div class="page-heading-row">

                        <div>
                            <p class="page-eyebrow">Analysis</p>
                            <h2>Water Quality Analysis</h2>
                            <p class="page-description">
                                Sensor-based water quality assessment and use screening.
                            </p>
                        </div>

                        <div class="page-heading-actions">
                            <div class="last-updated" id="analysisLastUpdated">
                                <i class="ri-time-line"></i>
                                <span>Latest reading:</span>
                                <strong id="analysisReadingTime">--</strong>
                            </div>
                        </div>

                    </div>

                    <!-- Overall Assessment -->
                    <article class="content-card analysis-overall-card">
                        <div class="content-card-header">
                            <div>
                                <h3>Overall Assessment</h3>
                                <p>Preliminary sensor assessment summary.</p>
                            </div>
                        </div>
                        <div class="overall-assessment-content">
                            <span class="overall-status-badge unknown" id="overallStatusBadge">UNKNOWN</span>
                            <h4 id="overallStatusTitle">Waiting for readings</h4>
                            <p id="overallStatusDescription">Connect a sensor device to generate an assessment.</p>
                        </div>
                    </article>

                    <!-- Current Parameters -->
                    <article class="content-card analysis-parameters-detailed-card">
                        <div class="content-card-header">
                            <div>
                                <h3>Current Parameters</h3>
                                <p>Latest sensor readings with condition indicators.</p>
                            </div>
                        </div>
                        <div class="parameter-cards-grid">
                            <div class="parameter-card temperature-card" id="paramTempCard">
                                <div class="parameter-card-icon"><i class="ri-temp-hot-line"></i></div>
                                <div class="parameter-card-label">Temperature</div>
                                <div class="parameter-card-value">
                                    <strong id="paramTempValue">--</strong>
                                    <span>°C</span>
                                </div>
                                <div class="parameter-card-condition" id="paramTempCondition">Waiting</div>
                            </div>
                            <div class="parameter-card ph-card" id="paramPhCard">
                                <div class="parameter-card-icon"><i class="ri-test-tube-line"></i></div>
                                <div class="parameter-card-label">pH</div>
                                <div class="parameter-card-value">
                                    <strong id="paramPhValue">--</strong>
                                    <span>pH</span>
                                </div>
                                <div class="parameter-card-condition" id="paramPhCondition">Waiting</div>
                            </div>
                            <div class="parameter-card turbidity-card" id="paramTurbidityCard">
                                <div class="parameter-card-icon"><i class="ri-contrast-drop-2-line"></i></div>
                                <div class="parameter-card-label">Turbidity</div>
                                <div class="parameter-card-value">
                                    <strong id="paramTurbidityValue">--</strong>
                                    <span>NTU</span>
                                </div>
                                <div class="parameter-card-condition" id="paramTurbidityCondition">Waiting</div>
                            </div>
                            <div class="parameter-card tds-card" id="paramTdsCard">
                                <div class="parameter-card-icon"><i class="ri-flask-line"></i></div>
                                <div class="parameter-card-label">TDS</div>
                                <div class="parameter-card-value">
                                    <strong id="paramTdsValue">--</strong>
                                    <span>mg/L</span>
                                </div>
                                <div class="parameter-card-condition" id="paramTdsCondition">Waiting</div>
                            </div>
                        </div>
                    </article>

                    <!-- Derived Parameters -->
                    <article class="content-card analysis-derived-card">
                        <div class="content-card-header">
                            <div>
                                <h3>Derived Parameters</h3>
                                <p>Calculated assessments from raw sensor values.</p>
                            </div>
                        </div>
                        <div class="derived-parameters-grid">
                            <div class="derived-item">
                                <span class="derived-label">pH Condition</span>
                                <strong id="derivedPhCondition" class="derived-value">--</strong>
                            </div>
                            <div class="derived-item">
                                <span class="derived-label">TDS Condition</span>
                                <strong id="derivedTdsCondition" class="derived-value">--</strong>
                            </div>
                            <div class="derived-item">
                                <span class="derived-label">TDS-based Salinity Indication</span>
                                <strong id="derivedSalinityIndication" class="derived-value">--</strong>
                            </div>
                            <div class="derived-item">
                                <span class="derived-label">Turbidity Condition</span>
                                <strong id="derivedTurbidityCondition" class="derived-value">--</strong>
                            </div>
                            <div class="derived-item">
                                <span class="derived-label">Temperature Condition</span>
                                <strong id="derivedTempCondition" class="derived-value">--</strong>
                            </div>
                            <div class="derived-item">
                                <span class="derived-label">Data Quality</span>
                                <strong id="derivedDataQuality" class="derived-value">--</strong>
                            </div>
                            <div class="derived-item">
                                <span class="derived-label">Data Freshness</span>
                                <strong id="derivedDataFreshness" class="derived-value">--</strong>
                            </div>
                        </div>
                    </article>

                    <!-- Water Use Analysis Tabs -->
                    <article class="content-card analysis-water-use-card">
                        <div class="content-card-header">
                            <div>
                                <h3>Water Use Analysis</h3>
                                <p>Screening assessments for different water uses.</p>
                            </div>
                        </div>

                        <div class="analysis-tabs" role="tablist" aria-label="Water use categories">
                            <button class="analysis-tab active" role="tab" aria-selected="true" data-analysis-tab="agriculture" id="tabAnalysisAgriculture">
                                <span>🌱 Agriculture</span>
                            </button>
                            <button class="analysis-tab" role="tab" aria-selected="false" data-analysis-tab="industry" id="tabAnalysisIndustry">
                                <span>🏭 Industry</span>
                            </button>
                            <button class="analysis-tab" role="tab" aria-selected="false" data-analysis-tab="general" id="tabAnalysisGeneral">
                                <span>🏠 General / Non-potable</span>
                            </button>
                            <button class="analysis-tab" role="tab" aria-selected="false" data-analysis-tab="drinking" id="tabAnalysisDrinking">
                                <span>🚰 Drinking Screening</span>
                            </button>
                        </div>

                        <div class="analysis-tab-panels">
                            <div class="analysis-tab-panel active" role="tabpanel" aria-labelledby="tabAnalysisAgriculture" id="panelAnalysisAgriculture">
                                <div class="analysis-panel-content" id="analysisAgricultureContent"></div>
                            </div>
                            <div class="analysis-tab-panel" role="tabpanel" aria-labelledby="tabAnalysisIndustry" id="panelAnalysisIndustry">
                                <div class="analysis-panel-content" id="analysisIndustryContent"></div>
                            </div>
                            <div class="analysis-tab-panel" role="tabpanel" aria-labelledby="tabAnalysisGeneral" id="panelAnalysisGeneral">
                                <div class="analysis-panel-content" id="analysisGeneralContent"></div>
                            </div>
                            <div class="analysis-tab-panel" role="tabpanel" aria-labelledby="tabAnalysisDrinking" id="panelAnalysisDrinking">
                                <div class="analysis-panel-content" id="analysisDrinkingContent"></div>
                            </div>
                        </div>
                    </article>

                    <!-- Why This Result? -->
                    <article class="content-card analysis-why-card">
                        <div class="content-card-header">
                            <div>
                                <h3>Why This Result?</h3>
                                <p>Explanation based on the actual sensor readings.</p>
                            </div>
                        </div>
                        <div class="why-result-content" id="whyResultContent">
                            <p class="why-placeholder">Waiting for readings...</p>
                        </div>
                    </article>

                    <!-- Key Concerns -->
                    <article class="content-card analysis-concerns-card">
                        <div class="content-card-header">
                            <div>
                                <h3>Key Concerns</h3>
                                <p>Parameters requiring attention.</p>
                            </div>
                        </div>
                        <div class="concerns-content" id="concernsContent">
                            <p class="concerns-placeholder">No major concern identified within the configured sensor screening parameters.</p>
                        </div>
                    </article>

                    <!-- Recommendations -->
                    <article class="content-card analysis-recommendations-detailed-card">
                        <div class="content-card-header">
                            <div>
                                <h3>Recommendations</h3>
                                <p>Suggested actions based on the analysis.</p>
                            </div>
                        </div>
                        <div class="recommendations-detailed-content" id="recommendationsDetailedContent">
                            <p class="recommendations-placeholder">Waiting for readings...</p>
                        </div>
                    </article>

                    <!-- Limitations -->
                    <article class="content-card analysis-limitations-card">
                        <div class="content-card-header">
                            <div>
                                <h3>Limitations</h3>
                                <p>Scientific and practical limitations of this assessment.</p>
                            </div>
                        </div>
                        <div class="limitations-content">
                            <ul class="limitations-list">
                                <li>This analysis is a preliminary sensor-based screening assessment. The available sensors measure pH, temperature, TDS, and turbidity. They do not measure all chemical or microbiological contaminants.</li>
                                <li>Use-specific suitability may require additional laboratory, soil, process, or regulatory testing.</li>
                                <li><strong>Agriculture:</strong> Crop suitability also depends on soil characteristics, crop tolerance, climate, irrigation method, and additional water parameters (electrical conductivity, sodium/SAR, chloride, boron).</li>
                                <li><strong>Industry:</strong> Requirements vary greatly by process. Sensitive applications (boiler feedwater, cooling systems, electronics, pharmaceuticals, food processing, high-purity processes) require process-specific treatment and water-quality testing.</li>
                                <li><strong>Drinking:</strong> Chemical and microbiological testing is required before declaring water safe for consumption. Sensors cannot determine bacteria, viruses, pathogens, heavy metals, pesticides, many dissolved contaminants, or complete chemical composition.</li>
                            </ul>
                        </div>
                    </article>

                </section>'''

    new_content = content[:start] + new_analysis_section + content[end:]
    with open('D:/aqua-ai/frontend/index.html', 'w') as f:
        f.write(new_content)
    print('Replaced Analysis section successfully')
else:
    print('Could not find boundaries')
    print('Start:', start)
    print('End:', end)