import requests
r = requests.get('http://127.0.0.1:5500/app.js')
print('Has analysisLoading:', 'analysisLoading' in r.text)
print('Has analysisLoadError:', 'analysisLoadError' in r.text)
print('Has console.log in loadAnalysisLatestReading:', 'console.log' in r.text)
print('navigateTo is async:', 'async function navigateTo' in r.text)

idx = r.text.find('if (page === "analysis")')
if idx > 0:
    snippet = r.text[idx:idx+500]
    print('Analysis section in navigateTo:')
    print(snippet)