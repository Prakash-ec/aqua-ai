import re
import requests

r = requests.get('http://127.0.0.1:5500/')
# Find the page section for analysis
matches = [(m.start(), r.text[max(0,m.start()-200):m.end()+200]) for m in re.finditer('data-page[=-]"analysis"', r.text)]
for start, snippet in matches:
    print(f'--- {start} ---')
    print(snippet)
    print()

# Also check for page-section
matches2 = [(m.start(), r.text[max(0,m.start()-200):m.end()+200]) for m in re.finditer('page[-]section', r.text)]
for start, snippet in matches2[:5]:
    print(f'--- page-section {start} ---')
    print(snippet)
    print()