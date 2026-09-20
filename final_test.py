import requests
# Test all endpoints
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

# Test frontend syntax
import subprocess
result = subprocess.run(['node', '--check', 'D:/aqua-ai/frontend/app.js'], capture_output=True, text=True)
print(f'node --check frontend/app.js: {"PASS" if result.returncode == 0 else "FAIL"}')
if result.stderr:
    print(result.stderr)

# Test backend compile
result = subprocess.run(['python', '-m', 'compileall', 'D:/aqua-ai/backend'], capture_output=True, text=True)
print(f'python -m compileall backend: {"PASS" if result.returncode == 0 else "FAIL"}')
if result.stderr:
    print(result.stderr)