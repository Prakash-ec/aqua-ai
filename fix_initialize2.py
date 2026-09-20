import re

with open(r'D:\aqua-ai\frontend\app.js', 'r') as f:
    content = f.read()

# Pattern to match the old initializeApp
pattern = r'async function initializeApp\(\) \{(?:[\s\S]*?)startAutoRefresh\(\);\s*\}'

replacement = """async function initializeApp() {
    setupNavigation();
    setupMobileMenu();
    setupRangeFilters();
    setupRefreshButton();
    setupSettings();
    setupAddDevice();
    setupAuth();
    setupReadingForm();
    setupCameraUpload();
    setupSensorChat();
    setupCameraChat();
    setupClearSensorChat();
    updateChatContextIndicators();
    setupReports();
    setupProfile();
    setupSimulator();
    setupWindowEvents();
    setupAnalysisTabs();


    // No authentication required - load dashboard immediately
    updateUserInterface();
    const initialPage =
        window.location.hash.replace("#", "") || "dashboard";
    navigateTo(initialPage);
    await refreshDashboard();

    startAutoRefresh();
}"""

new_content = re.sub(pattern, replacement, content)

with open(r'D:\aqua-ai\frontend\app.js', 'w') as f:
    f.write(new_content)

print('Done')