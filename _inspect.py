import json

content = open('frontend/index.html', 'r', encoding='utf-8').read()

start = content.find('id="page-analysis"')
section_start = content.rfind('<section', 0, start)
section_end = content.find('</section>', start)

section = content[section_start:section_end+10]
print(f'Analysis section length: {len(section)} chars')
print(f'Section start: {section_start}')
print()

# Print key elements in the section
import re
# Find all IDs
ids = re.findall(r'id="([^"]+)', section)
print('IDs in analysis section:')
for i in ids:
    print(f'  {i}')

print()
# Find all class names
classes = re.findall(r'class="([^"]+)', section)
print('Classes in analysis section:')
for c in classes:
    for cls in c.split():
        print(f'  {cls}')
