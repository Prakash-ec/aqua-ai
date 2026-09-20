with open('D:/aqua-ai/frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the DOMContentLoaded handler
idx = content.find('document.addEventListener("DOMContentLoaded"')
print(content[idx:idx+200])

# Also find the end of initializeApp
idx2 = content.find('function initializeApp()')
# Find the end of initializeApp by looking for the next function at top level
# or the end of the file
print("\n--- initializeApp start ---")
print(content[idx2:idx2+100])