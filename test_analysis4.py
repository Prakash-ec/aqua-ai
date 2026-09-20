import re
import requests

r = requests.get('http://127.0.0.1:5500/')
# Get more of the analysis page section
start = r.text.find('data-page-section="analysis"')
if start > 0:
    print(r.text[start:start+2000])