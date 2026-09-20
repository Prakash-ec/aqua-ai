with open('D:/aqua-ai/frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find('function setupAnalysisTabs() {')
context = content[max(0, idx-5000):idx]

# Check for control structures that might wrap the function
import re
keywords = ['if \\(', 'try \\{', 'catch', 'function ', 'const ', 'let ', 'var ']
for kw in keywords:
    matches = list(re.finditer(kw, context))
    if matches:
        last = matches[-1].start()
        print(f'Last {kw} before setupAnalysisTabs at offset {last}: ...{context[max(0,last-50):last+50]}...')