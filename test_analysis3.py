import re
import requests

r = requests.get('http://127.0.0.1:5500/')
# Find the analysis page section
matches = [(m.start(), r.text[m.start():m.end()+500]) for m in re.finditer('data-page-section="analysis"', r.text)]
for start, snippet in matches:
    print(f'--- {start} ---')
    print(snippet)
    print()