import requests
import subprocess

print('=== BACKEND API TESTS ===')
tests = [
    ('GET /health', 'GET', 'http://127.0.0.1:8001/health'),
    ('GET /devices/', 'GET', 'http://127.0.0.1:8001/devices/'),
    ('GET /readings/latest', 'GET', 'http://127.0.0.1:8001/readings/latest'),
    ('GET /readings/', 'GET', 'http://127.0.0.1:8001/readings/'),
    ('POST /readings/ingest', 'POST', 'http://127.0.0.1:8001/readings/ingest'),
]
for name, method, url in tests:
    if method == 'GET':
        r = requests.get(url)
    else:
        r = requests.post(url, json={'device_id': 1, 'temperature': 26.0, 'ph': 7.2, 'turbidity': 1.8, 'tds': 320.0})
    status = 'OK' if r.status_code in (200, 201) else 'FAIL'
    print(f'{name}: {r.status_code} {status}')

print()
print('=== FRONTEND TESTS ===')
r = requests.get('http://127.0.0.1:5500')
print(f'Frontend HTML: {r.status_code}')

r = requests.get('http://127.0.0.1:5500/app.js')
print(f'Frontend JS: {r.status_code}')
print(f'Has loadAnalysisLatestReading: {"loadAnalysisLatestReading" in r.text}')
print(f'Has analysisLoading: {"analysisLoading" in r.text}')
print(f'Has analysisLoadError: {"analysisLoadError" in r.text}')
print(f'Has async navigateTo: {"async function navigateTo" in r.text}')
print(f'Has await loadAnalysisLatestReading: {"await loadAnalysisLatestReading" in r.text}')

print()
print('=== CORS TEST ===')
headers = {'Origin': 'http://127.0.0.1:5500'}
r = requests.get('http://127.0.0.1:8001/readings/latest', headers=headers)
print(f'API from frontend origin: {r.status_code}')
data = r.json()
print(f'Data: temp={data["temperature"]}, ph={data["ph"]}, turbidity={data["turbidity"]}, tds={data["tds"]}, recorded_at={data["recorded_at"]}')

print()
print('=== SYNTAX CHECKS ===')
result = subprocess.run(['node', '--check', 'D:/aqua-ai/frontend/app.js'], capture_output=True, text=True)
print(f'node --check frontend/app.js: {"PASS" if result.returncode == 0 else "FAIL"}')

result = subprocess.run(['python', '-m', 'compileall', 'D:/aqua-ai/backend'], capture_output=True, text=True)
print(f'python -m compileall backend: {"PASS" if result.returncode == 0 else "FAIL"}')