import requests
r = requests.get('http://127.0.0.1:5500/')
elements = ['analysisReadingTime', 'overallStatusTitle', 'overallStatusDescription', 'paramTempValue', 'paramPhValue', 'paramTurbidityValue', 'paramTdsValue', 'whyResultContent', 'concernsContent', 'recommendationsDetailedContent', 'analysisAgricultureContent', 'analysisIndustryContent', 'analysisGeneralContent', 'analysisDrinkingContent']
for el in elements:
    search = 'id="' + el + '"'
    found = search in r.text
    print(el + ': ' + ('FOUND' if found else 'MISSING'))