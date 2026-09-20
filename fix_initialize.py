with open(r'D:\aqua-ai\frontend\app.js', 'r') as f:
    content = f.read()

old = """async function initializeApp() {
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


    // Check demo auth state from localStorage
    const authenticated = checkDemoAuth();
    if (authenticated) {
        updateUserInterface();
        const initialPage =
            window.location.hash.replace("#", "") || "dashboard";
        navigateTo(initialPage);
        await refreshDashboard();
    } else {
        isAuthenticated = false;
        currentUser = null;
        clearUserState();
        updateUserInterface();
        navigateTo("dashboard");
        openLoginModal("Please sign in to continue.");
    }

    startAutoRefresh();
}"""

new = """async function initializeApp() {
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

content = content.replace(old, new)

with open(r'D:\aqua-ai\frontend\app.js', 'w') as f:
    f.write(content)

print('Done')