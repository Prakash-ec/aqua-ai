with open('D:/aqua-ai/frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

funcs = ['updateAnalysisPage', 'analyzePh', 'analyzeTds', 'analyzeTurbidity', 'analyzeTemperature', 
         'analyzeAgriculture', 'analyzeIndustry', 'analyzeGeneralUse', 'analyzeDrinkingScreening',
         'buildOverallAssessment', 'renderAgricultureTab', 'renderIndustryTab', 
         'renderGeneralTab', 'renderDrinkingTab', 'renderWhyResult', 'renderKeyConcerns',
         'renderRecommendations', 'setupAnalysisTabs', 'switchAnalysisTab']
for func in funcs:
    idx = content.find('function ' + func)
    print(f'{func}: {"Found" if idx != -1 else "MISSING"}')

# Check for call to updateAnalysisPage in navigateTo
idx = content.find('if (page === "analysis")')
print(f'navigateTo analysis call: {"Found" if idx != -1 else "MISSING"}')

# Check renderWaterUsage removed
idx2 = content.find('renderWaterUsage')
print(f'renderWaterUsage: {"Found" if idx2 != -1 else "REMOVED"}')

# Check switchWaterUsageTab removed
idx3 = content.find('switchWaterUsageTab')
print(f'switchWaterUsageTab: {"Found" if idx3 != -1 else "REMOVED"}')