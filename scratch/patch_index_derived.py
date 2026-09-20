import re

with open('frontend/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# I will find the <!-- Parameter Assessment --> and add <!-- Derived Parameters --> after it.
derived_params_html = """
                    <!-- Derived Parameters -->
                    <article class="content-card">
                        <div class="content-card-header">
                            <div>
                                <h3>Derived Parameters</h3>
                                <p>Calculated from measured sensor parameters.</p>
                            </div>
                        </div>
                        <div id="analysisDerivedParams" style="padding-top: 16px;"></div>
                    </article>
"""

if 'id="analysisDerivedParams"' not in html:
    html = html.replace(
        '<!-- Application Suitability -->',
        derived_params_html + '\n                    <!-- Application Suitability -->'
    )

with open('frontend/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
