with open('D:/aqua-ai/frontend/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Analysis page elements
elements = [
    'id="page-analysis"',
    'id="analysisReadingTime"',
    'id="overallStatusBadge"',
    'id="overallStatusTitle"',
    'id="overallStatusDescription"',
    'id="paramTempValue"', 'id="paramTempCondition"',
    'id="paramPhValue"', 'id="paramPhCondition"',
    'id="paramTurbidityValue"', 'id="paramTurbidityCondition"',
    'id="paramTdsValue"', 'id="paramTdsCondition"',
    'id="derivedPhCondition"',
    'id="derivedTdsCondition"',
    'id="derivedSalinityIndication"',
    'id="derivedTurbidityCondition"',
    'id="derivedTempCondition"',
    'id="derivedDataQuality"',
    'id="derivedDataFreshness"',
    'id="tabAnalysisAgriculture"',
    'id="tabAnalysisIndustry"',
    'id="tabAnalysisGeneral"',
    'id="tabAnalysisDrinking"',
    'id="panelAnalysisAgriculture"',
    'id="panelAnalysisIndustry"',
    'id="panelAnalysisGeneral"',
    'id="panelAnalysisDrinking"',
    'id="analysisAgricultureContent"',
    'id="analysisIndustryContent"',
    'id="analysisGeneralContent"',
    'id="analysisDrinkingContent"',
    'id="whyResultContent"',
    'id="concernsContent"',
    'id="recommendationsDetailedContent"',
]

print('=== Analysis Page Elements ===')
for el in elements:
    idx = content.find(el)
    print(f'  {el}: {"Found" if idx != -1 else "MISSING"}')

# Check water usage removed
print('\n=== Water Usage Removed ===')
for el in ['waterUsageCard', 'waterUsageAgriculture', 'waterUsageIndustry', 'waterUsageGeneral', 'tabAgriculture', 'tabIndustry', 'tabGeneral']:
    idx = content.find(el)
    print(f'  {el}: {"REMOVED" if idx == -1 else "STILL PRESENT"}')