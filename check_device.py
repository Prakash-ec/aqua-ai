import requests, json, sys
base='http://127.0.0.1:8002'
resp = requests.post(f'{base}/devices/', json={'name':'CheckDevice','device_type':'ESP32'})
print('Status', resp.status_code)
print('Text', resp.text)
try:
    data = resp.json()
    print('JSON', json.dumps(data, indent=2))
except Exception as e:
    print('JSON parse error', e)
