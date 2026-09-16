import json, uuid, traceback
from fastapi.testclient import TestClient
from backend.main import app

with TestClient(app) as c:  # 'with' runs lifespan -> migrations
    r = c.post('/auth/login', json={'username': 'admin', 'password': 'ChangeMe123!'})
    print('admin login:', r.status_code)

    dn = 'ESP-TEST-' + uuid.uuid4().hex[:6]
    r = c.post('/devices/', json={'name': dn, 'location': 'test-bench'})
    print('device create:', r.status_code)
    if r.status_code != 201:
        print('ERROR BODY:', r.text[:600])
        raise SystemExit(1)
    d = r.json()
    print('create response keys:', sorted(d.keys()))
    dev_obj = d.get('device') or {}
    tok = d.get('device_token') or d.get('api_token') or d.get('token')
    did = dev_obj.get('id') or d.get('id')
    print('device_id:', did, '| token received:', bool(tok))

    payload = {'device_id': dn, 'temperature': 26.4, 'ph': 7.2, 'tds': 310.5, 'turbidity': 1.8}
    r = c.post('/readings/ingest', json=payload, headers={'X-Device-Token': tok})
    print('ingest valid:', r.status_code, json.dumps(r.json())[:220])
    rid = r.json().get('id')

    r1 = c.post('/readings/ingest', json=payload)
    print('missing token:', r1.status_code)
    r2 = c.post('/readings/ingest', json=payload, headers={'X-Device-Token': 'bogus-token-value'})
    print('invalid token:', r2.status_code)
    r3 = c.post('/readings/ingest', json={'device_id': 'NOPE-404', 'temperature': 1, 'ph': 7, 'tds': 10, 'turbidity': 1}, headers={'X-Device-Token': tok})
    print('nonexistent device:', r3.status_code)

    from backend.database import SessionLocal
    from backend.models import Device, WaterReading
    db = SessionLocal()
    row = db.query(WaterReading).filter(WaterReading.id == rid).first()
    print('DB row exists:', row is not None)
    if row:
        print('device match:', row.device_id == did)
        print('temperature:', row.temperature, '| ph:', row.ph, '| tds:', row.tds, '| turbidity:', row.turbidity)
        print('recorded_at (server-generated):', row.recorded_at)
    dev = db.query(Device).filter(Device.id == did).first()
    if dev and dev.token_hash:
        print('token stored as hash (not plaintext):', dev.token_hash != tok)
    else:
        print('token_hash column: MISSING or EMPTY')
    r4 = c.get('/readings/', params={'device_id': did})
    body = r4.json()
    items = body if isinstance(body, list) else None
    if items is None and isinstance(body, dict):
        for k in ('readings', 'items', 'data'):
            if k in body and isinstance(body[k], list):
                items = body[k]
                break
    found = any(x.get('id') == rid for x in items) if isinstance(items, list) else f'unrecognized: {str(body)[:120]}'
    print('GET /readings/ contains ingested row:', r4.status_code, '|', found)
    db.close()
