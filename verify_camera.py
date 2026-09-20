with open('D:/aqua-ai/frontend/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Camera page elements
elements = [
    'id="page-camera"',
    'id="cameraDropzone"',
    'id="cameraFileInput"',
    'id="cameraPreviewContainer"',
    'id="cameraPreviewImage"',
    'id="removeCameraPreviewButton"',
    'id="analyzeCameraButton"',
    'id="clearCameraButton"',
    'id="cameraResultEmpty"',
    'id="cameraResultContent"',
    'id="cameraResultStatus"',
    'id="cameraResultTitle"',
    'id="cameraResultText"',
    'id="cameraResultTags"',
    'id="cameraChatForm"',
    'id="cameraChatInput"',
    'id="cameraChatMessages"',
]

print('=== Camera Page Elements ===')
for el in elements:
    idx = content.find(el)
    print(f'  {el}: {"Found" if idx != -1 else "MISSING"}')