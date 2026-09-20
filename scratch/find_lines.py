with open('frontend/index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()
for i, line in enumerate(lines):
    if 'page-analysis' in line:
        print(f'{i}: {line.strip()}')
