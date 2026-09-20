import re
import requests

r = requests.get('http://127.0.0.1:5500/')
matches = [(m.start(), r.text[max(0,m.start()-100):m.end()+100]) for m in re.finditer('analysis', r.text)]
for start, snippet in matches[:10]:
    print(f'--- {start} ---')
    print(snippet)
    print()