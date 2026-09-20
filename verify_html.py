import html
with open('D:/aqua-ai/frontend/index.html', 'r', encoding='utf-8') as f:
    content = f.read()
print('HTML length:', len(content))
# Check for analysis section
idx = content.find('id="page-analysis"')
print('Analysis page found at:', idx)
if idx != -1:
    print('Context:', content[idx:idx+200])

# Check water usage tabs removed
idx2 = content.find('water-usage-tab')
print('water-usage-tab found:', idx2 != -1)

# Check analysis tabs
idx3 = content.find('analysis-tab')
print('analysis-tab found:', idx3 != -1)

# Check camera result
idx4 = content.find('renderCameraResult')
print('renderCameraResult in HTML:', idx4 != -1)