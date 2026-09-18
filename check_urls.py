import re

with open('frontend/app.js', 'r') as f:
    content = f.read()

urls = re.findall(r'https?://[^\s"\'\)]+', content)
print('URLs found in app.js:')
for url in urls:
    print(f'  {url}')

print()
if '127.0.0.1' in content or 'localhost' in content:
    print('WARNING: Found localhost/127.0.0.1 references')
    for i, line in enumerate(content.split('\n'), 1):
        if '127.0.0.1' in line or 'localhost' in line:
            print(f'  Line {i}: {line.strip()}')