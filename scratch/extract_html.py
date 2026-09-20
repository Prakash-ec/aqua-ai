import re
with open('frontend/index.html', 'r', encoding='utf-8') as f:
    c = f.read()
m = re.search(r'<section\s+class="page-section"[^>]*id="page-analysis".*?</section>', c, re.DOTALL)
if m:
    with open('scratch/analysis.html', 'w', encoding='utf-8') as out:
        out.write(m.group(0))
