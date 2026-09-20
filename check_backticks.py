with open('D:/aqua-ai/frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Check for unescaped backticks or template literal issues
# Look at the renderRecommendations function which is right before setupAnalysisTabs
idx = content.find('function renderRecommendations(')
end_idx = content.find('function setupAnalysisTabs()')
func_content = content[idx:end_idx]

# Count backticks
backtick_char = '`'
backticks = func_content.count(backtick_char)
print('Backticks in renderRecommendations:', backticks)
if backticks % 2 != 0:
    print('UNMATCHED BACKTICKS!')
else:
    print('Backticks matched')