with open('D:/aqua-ai/frontend/style.css', 'r') as f:
    content = f.read()

# Find the start and end of the water-usage CSS
start = content.find('/* =========================================================\n   WATER USAGE SECTION\n   ========================================================= */')
end = content.find('@media (max-width: 650px) {\n    .water-usage-tabs {\n        gap: 6px;\n    }\n\n    .water-usage-tab {\n        padding: 8px 12px;\n        font-size: 12px;\n    }\n\n    .water-usage-tab i {\n        font-size: 14px;\n    }\n\n    .water-usage-industry-grid,\n    .water-usage-general-grid {\n        grid-template-columns: 1fr;\n    }\n\n    .water-usage-limitation {\n        font-size: 11px;\n        padding: 12px 14px;\n    }\n}')

if start != -1 and end != -1:
    end = end + len('@media (max-width: 650px) {\n    .water-usage-tabs {\n        gap: 6px;\n    }\n\n    .water-usage-tab {\n        padding: 8px 12px;\n        font-size: 12px;\n    }\n\n    .water-usage-tab i {\n        font-size: 14px;\n    }\n\n    .water-usage-industry-grid,\n    .water-usage-general-grid {\n        grid-template-columns: 1fr;\n    }\n\n    .water-usage-limitation {\n        font-size: 11px;\n        padding: 12px 14px;\n    }\n}')
    new_content = content[:start] + content[end:]
    with open('D:/aqua-ai/frontend/style.css', 'w') as f:
        f.write(new_content)
    print('Removed water-usage CSS successfully')
else:
    print('Could not find the exact boundaries')
    print('Start:', start)
    print('End:', end)