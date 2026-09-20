import re

with open('frontend/app.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if line.startswith('function updateAnalysisPage()'):
        start_idx = i
    elif line.startswith('function escapeHtml('):
        end_idx = i
        break

with open('scratch/js_code.js', 'r', encoding='utf-8') as f:
    js_code = f.read()

lines = lines[:start_idx] + [js_code, '\n'] + lines[end_idx:]

with open('frontend/app.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)
