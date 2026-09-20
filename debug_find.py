with open('D:/aqua-ai/frontend/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the start
start = content.find('id="page-analysis"')
print('Start:', start)
if start != -1:
    print(content[start:start+200])

# Find the end
end = content.find('TRENDS PAGE')
print('End search:', end)
if end != -1:
    print(content[end-200:end+100])