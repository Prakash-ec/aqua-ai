import requests
r = requests.get('http://127.0.0.1:5500/app.js')
# Verify no auth-related code
patterns = [
    'credentials: "include"',
    '/auth/me',
    '/auth/login',
    '/auth/logout',
    'DEMO_AUTH_KEY',
    'checkDemoAuth',
    'performDemoLogin',
    'performDemoLogout',
    'isAuthenticated = false',
    'currentUser = null'
]
for p in patterns:
    found = p in r.text
    print(f'{p}: {"FOUND - BAD" if found else "removed"}')