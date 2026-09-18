import re

with open('frontend/index.html', 'r') as f:
    content = f.read()

scripts = re.findall(r'<script[^>]*src=[^>]*>', content)
print('Script tags:')
for s in scripts:
    print(f'  {s}')

urls = re.findall(r'https?://[^\s"\'\)]+', content)
print()
print('URLs in index.html:')
for url in urls:
    print(f'  {url}')