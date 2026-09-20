with open('D:/aqua-ai/frontend/style.css', 'r', encoding='utf-8') as f:
    content = f.read()

checks = ['analysis-overall-card', 'parameter-cards-grid', 'parameter-card', 
          'derived-parameters-grid', 'analysis-tabs', 'analysis-tab-panel',
          'why-result-list', 'concerns-list', 'recommendations-grid',
          'crop-tag', 'drinking-params-table', 'general-use-grid']
for check in checks:
    idx = content.find('.' + check)
    print(f'.{check}: {"Found" if idx != -1 else "MISSING"}')

idx = content.find('water-usage-card')
print(f'water-usage-card: {"Found" if idx != -1 else "REMOVED"}')