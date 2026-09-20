import os
os.chdir('D:/aqua-ai')
with open('backend/main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Check if diagnostic logging is in place
if 'traceback.print_exc()' in content:
    print('Diagnostic logging: PRESENT in health_check')
else:
    print('Diagnostic logging: MISSING')

# Check the exact health_check function
import re
match = re.search(r'@app.get\("/health"\).*?def health_check\(\):.*?(?=\n@|\ndef |\nclass |\Z)', content, re.DOTALL)
if match:
    print('--- health_check function ---')
    print(match.group()[:1500])