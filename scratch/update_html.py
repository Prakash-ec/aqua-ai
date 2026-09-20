import re

# 1. Update index.html
with open('frontend/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

new_analysis_html = """
                <section class="page-section" id="page-analysis" data-page-section="analysis">
                    
                    <div class="page-heading-row">
                        <div>
                            <p class="page-eyebrow">Intelligence</p>
                            <h2>WATER QUALITY ANALYSIS</h2>
                            <p class="page-description">
                                Technical assessment based on the latest sensor reading.
                            </p>
                        </div>
                        <div class="page-heading-actions">
                            <div class="last-updated" id="analysisLastUpdated">
                                <i class="ri-time-line"></i>
                                <span>Latest reading</span>
                                <strong id="analysisReadingTime">--</strong>
                            </div>
                            <button class="primary-button" type="button" data-action="refresh" aria-label="Refresh analysis data">
                                <i class="ri-refresh-line"></i> Refresh
                            </button>
                        </div>
                    </div>

                    <div class="analysis-notice hidden" id="analysisNotice" role="status" aria-live="polite"></div>

                    <!-- 1. Hero / Overall -->
                    <article class="content-card">
                        <div id="analysisSummary" style="padding: 16px 0;"></div>
                    </article>

                    <!-- 2. Current Parameters -->
                    <article class="content-card">
                        <div class="content-card-header">
                            <div>
                                <span style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; font-weight: 600;">MEASURED</span>
                                <h3>Current Parameters</h3>
                            </div>
                        </div>
                        <div id="analysisCurrentParams" style="padding-top: 16px;"></div>
                    </article>

                    <!-- 3. Derived Parameters -->
                    <article class="content-card">
                        <div class="content-card-header">
                            <div>
                                <span style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; font-weight: 600;">CALCULATED</span>
                                <h3>Derived Parameters</h3>
                            </div>
                        </div>
                        <div id="analysisDerivedParams" style="padding-top: 16px;"></div>
                    </article>
                    
                    <!-- 4. Score Breakdown -->
                    <article class="content-card">
                        <div class="content-card-header">
                            <div>
                                <span style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; font-weight: 600;">ANALYTICAL SCORE</span>
                                <h3>Score Breakdown</h3>
                            </div>
                        </div>
                        <div id="analysisScoreSection" style="padding-top: 16px;"></div>
                        <div id="analysisKeyLimitingFactor" style="margin-top: 16px;"></div>
                    </article>

                    <!-- 5. Application Suitability -->
                    <article class="content-card">
                        <div class="content-card-header">
                            <div>
                                <h3>APPLICATION SUITABILITY</h3>
                                <p style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">How the current water profile compares with configured application references.</p>
                            </div>
                        </div>

                        <div class="an-tabs" role="tablist" aria-label="Application categories" style="margin-top: 16px; display: flex; gap: 8px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px; overflow-x: auto;">
                            <button class="an-tab active" role="tab" aria-selected="true" data-an-tab="agriculture" type="button" style="padding: 8px 16px; border: none; background: transparent; color: var(--text-primary); font-weight: 600; cursor: pointer; border-bottom: 2px solid var(--accent-primary);">Agriculture</button>
                            <button class="an-tab" role="tab" aria-selected="false" data-an-tab="industrial" type="button" style="padding: 8px 16px; border: none; background: transparent; color: var(--text-secondary); font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent;">Industry</button>
                            <button class="an-tab" role="tab" aria-selected="false" data-an-tab="domestic" type="button" style="padding: 8px 16px; border: none; background: transparent; color: var(--text-secondary); font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent;">Domestic</button>
                            <button class="an-tab" role="tab" aria-selected="false" data-an-tab="general" type="button" style="padding: 8px 16px; border: none; background: transparent; color: var(--text-secondary); font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent;">General Utility</button>
                        </div>
                        
                        <div id="analysisCategorySummary" style="padding: 16px 0 8px 0;"></div>

                        <div id="analysisApplicationContent" style="padding-top: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
                        </div>
                    </article>
                    
                    <!-- 6. Drinking Screening -->
                    <article class="content-card">
                        <div class="content-card-header">
                            <div>
                                <h3>DRINKING WATER SCREENING</h3>
                            </div>
                        </div>
                        <div id="analysisDrinkingSection" style="padding-top: 16px;"></div>
                    </article>
                    
                    <!-- 7. Assessment Basis -->
                    <article class="content-card" style="background: transparent; border: none; box-shadow: none; padding: 0;">
                        <div class="technical-limitations">
                            <h4 style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">ASSESSMENT BASIS</h4>
                            <p style="font-size: 12px; color: var(--text-muted); line-height: 1.5;">
                                Assessment based on the available sensor parameters and configured application references.
                            </p>
                        </div>
                    </article>

                </section>
"""

html = re.sub(r'<section[^>]*id="page-analysis"[^>]*>.*?</section>', new_analysis_html, html, flags=re.DOTALL)
with open('frontend/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
