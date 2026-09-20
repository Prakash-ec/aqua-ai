with open('D:/aqua-ai/frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find('function renderCameraResult(data) {')
end_idx = content.find('function prettifyKey(key) {')
func_content = content[idx:end_idx]

backtick_char = chr(96)  # backtick
backticks = func_content.count(backtick_char)
print('Backticks in renderCameraResult:', backticks)
if backticks % 2 != 0:
    print('UNMATCHED BACKTICKS!')
else:
    print('Backticks matched')