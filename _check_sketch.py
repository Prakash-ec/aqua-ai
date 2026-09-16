s = open('esp32/aqua_ai_esp32.ino', encoding='utf-8').read()
checks = {
    'uses /readings/ingest': '/readings/ingest' in s,
    'uses X-Device-Token': 'X-Device-Token' in s,
    'no 127.0.0.1 (ignoring prohibition comment)': not any(
        ln.strip() and '127.0.0.1' in ln and 'NEVER' not in ln.upper() and 'not use' not in ln.lower()
        for ln in s.splitlines()
    ),
    'wifi reconnect present': 'reconnect' in s.lower() or 'WiFi.begin' in s,
    'millis() cadence': 'millis()' in s,
    'http status code handling': ('httpCode' in s) or ('httpCode' in s.lower()) or ('code == 200' in s) or ('HTTP_CODE_OK' in s) or re.search(r'code\s*==\s*2\d\d', s) is not None,
}
print('sketch lines:', s.count('\n') + 1)
for k, v in checks.items():
    print(('PASS ' if v else 'FAIL ') + k)
print('random() used (should be False):', 'random(' in s)
