import requests, json, sys

def main():
    base = 'http://127.0.0.1:8002'
    # Create device
    resp = requests.post(f'{base}/devices/', json={'name': 'TestDevice', 'device_type': 'ESP32'})
    print('Create device status:', resp.status_code)
    if resp.status_code != 201:
        print('Failed to create device:', resp.text)
        sys.exit(1)
    device = resp.json()
    device_id = device.get('id')
    print('Created device id:', device_id)
    # Ingest reading
    data = {
        'device_id': device_id,
        'temperature': 32,
        'ph': 6.0,
        'tds': 900,
        'turbidity': 8
    }
    r2 = requests.post(f'{base}/readings/ingest', json=data)
    print('Ingest status:', r2.status_code)
    if r2.status_code != 200:
        print('Ingest failed:', r2.text)
        sys.exit(1)
    # Get latest reading
    r3 = requests.get(f'{base}/readings/latest', params={'device_id': device_id})
    print('Latest reading status:', r3.status_code)
    if r3.status_code == 200:
        print('Latest reading:', r3.json())
    else:
        print('Failed to get latest reading:', r3.text)

if __name__ == '__main__':
    main()
