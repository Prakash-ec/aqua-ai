import re

with open('frontend/app.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i in [229, 676, 694, 2785, 2803]:
    if 'parseApiTimestamp(value)' in lines[i]:
        lines[i] = lines[i].replace('parseApiTimestamp(value)', 'value')

with open('frontend/app.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)
