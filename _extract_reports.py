import re

content = open('frontend/index.html', 'r', encoding='utf-8').read()
start = content.find('id="page-reports"')
section_start = content.rfind('<section', 0, start)
end_marker = '<!-- ====='
section_end = content.find(end_marker, section_start + 5000)
section = content[section_start:section_end]

with open('_reports_html.txt', 'w', encoding='utf-8') as f:
    f.write(section)

print(f'Reports section: {section_start} to {section_end}, {len(section)} chars')
ids = re.findall(r'id="([^"]+)"', section)
print(f'IDs ({len(ids)}):')
for i in ids:
    print(f'  {i}')
