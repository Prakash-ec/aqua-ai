with open(r'D:\aqua-ai\frontend\app.js', 'r') as f:
    content = f.read()

# Replace content from position 8556 to 16018
start_idx = 8556
end_idx = 16018

new_auth = """/* =========================================================
   AUTHENTICATION (DISABLED - Public API)
   ========================================================= */

// Authentication is disabled - the API is public for demo/local use
// These functions are kept as no-op stubs for compatibility

async function checkAuth() {
    return true;
}

async function fetchCurrentUser() {
    return currentUser;
}

async function performLogin(username, password, rememberMe = false) {
    // No-op - authentication disabled
    return currentUser;
}

async function performLogout() {
    // No-op - authentication disabled
}

function checkDemoAuth() {
    return true;
}

async function performDemoLogin(username, password) {
    // No-op - authentication disabled
}

async function performDemoLogout() {
    // No-op - authentication disabled
}

function openLoginModal(errorMessage) {
    // No-op - authentication disabled
}

function closeLoginModal() {
    // No-op - authentication disabled
}

function updateUserInterface() {
    const usernameEl = $("userProfileName");
    const roleEl = $("userProfileRole");
    const avatarEl = $("userAvatar");
    const logoutItem = $("logoutItem");
    const loginItem = $("loginItem");
    const adminNavItem = $("adminNavItem");

    // Hide auth-related UI elements since authentication is disabled
    if (logoutItem) {
        logoutItem.classList.add("hidden");
    }
    if (loginItem) {
        loginItem.classList.add("hidden");
    }
    if (adminNavItem) {
        adminNavItem.classList.remove("hidden");
    }

    if (usernameEl) {
        usernameEl.textContent = currentUser.username || "Guest";
    }
    if (roleEl) {
        roleEl.textContent = "Public Access";
    }
    if (avatarEl) {
        const initials = (currentUser.username || "Guest")
            .split(/\\s+/)
            .slice(0, 2)
            .map((part) => (part && part[0] ? part[0].toUpperCase() : ""))
            .join("")
            .slice(0, 2) || "?";
        avatarEl.textContent = initials;
    }
}"""

new_content = content[:start_idx] + new_auth + content[end_idx:]

with open(r'D:\aqua-ai\frontend\app.js', 'w') as f:
    f.write(new_content)

print('Done')