with open('D:/aqua-ai/frontend/app.js', 'r') as f:
    content = f.read()

# Find the start and end of the water-usage code
start = content.find('function renderWaterUsage(analysis) {')
end_marker = '        } catch (error) {\n            console.warn("Could not load AI providers:", error.message);\n        }\n    })();\n\n    \n\n    const autoRefreshToggle'
end = content.find(end_marker)

if start != -1 and end != -1:
    # Include the closing brace of the IIFE
    end = end + len(end_marker)
    new_content = content[:start] + end_marker + content[end:]
    with open('D:/aqua-ai/frontend/app.js', 'w') as f:
        f.write(new_content)
    print('Removed water-usage code successfully')
else:
    print('Could not find the exact boundaries')
    print('Start:', start)
    print('End:', end)