with open('frontend/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
m = re.search(r'<section[^>]*id="page-analysis"[^>]*>.*?</section>', text, re.DOTALL)
if m:
    with open('scratch/analysis_html.txt', 'w', encoding='utf-8') as out:
        out.write(m.group(0))
