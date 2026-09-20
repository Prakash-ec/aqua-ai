import re

with open(r'D:\aqua-ai\frontend\app.js', 'r') as f:
    content = f.read()

# Replace the entire AUTHENTICATION section
old_auth = """/* =========================================================
   AUTHENTICATION
   ========================================================= */

async function checkAuth() {
    currentUser = await fetchCurrentUser();
    isAuthenticated = !!currentUser;
    return isAuthenticated;
}

async function fetchCurrentUser() {
    try {
        currentUser = await apiRequest("/auth/me");
        return currentUser;
    } catch {
        currentUser = null;
        return null;
    }
}

async function performLogin(username, password, rememberMe = false) {
    const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ username, password, remember_me: rememberMe }),
        credentials: "include",
    });

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        throw new Error(
            extractApiErrorMessage(data, response.status, "Login failed.")
        );
    }

    isAuthenticated = true;
    currentUser = data;
    return data;
}


let logoutInProgress = false;

async function performLogout() {
    // Prevent duplicate logout requests
    if (logoutInProgress) {
        return;
    }
    logoutInProgress = true;

    try {
        const response = await fetch(`${getApiBaseUrl()}/auth/logout`, {
            method: "POST",
            credentials: "include",
            headers: {
                Accept: "application/json",
            },
        });

        // Accept 200 (success), 401 (already logged out), and treat them the same.
        // Only throw for unexpected server errors (500) but still clear client state.
        if (response.status === 500) {
            console.error("Logout server error:", response.status);
        }
    } catch (error) {
        // Network error or server unreachable — still clear client-side state
        console.error("Logout request failed:", error);
    } finally {
        logoutInProgress = false;
    }

    // Always clear client-side auth state regardless of backend response
    isAuthenticated = false;
    currentUser = null;
    clearUserState();

    // Clear any client-side session UI
    updateUserInterface();

    // Force the protected-route view and require sign-in again.
    navigateTo("dashboard");
    openLoginModal("Signed out. Please sign in to continue.");
}

function checkDemoAuth() {
    const authState = localStorage.getItem(DEMO_AUTH_KEY);
    if (authState === "true") {
        isAuthenticated = true;
        currentUser = { username: "prakash", is_admin: true };
        return true;
    }
    isAuthenticated = false;
    currentUser = null;
    return false;
}

async function performDemoLogin(username, password) {
    if (username !== "prakash") {
        throw new Error("Invalid username. Only 'prakash' is allowed.");
    }
    if (!password) {
        throw new Error("Password is required.");
    }

    const bootstrapPassword = "DPvel123@";

    try {
        const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                username: "prakash",
                password: bootstrapPassword,
                remember_me: true
            }),
            credentials: "include",
        });

        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }

        if (!response.ok) {
            throw new Error(
                extractApiErrorMessage(data, response.status, "Login failed.")
            );
        }

        localStorage.setItem(DEMO_AUTH_KEY, "true");
        isAuthenticated = true;
        currentUser = { username: "prakash", is_admin: true };
        closeLoginModal();
        updateUserInterface();
        const initialPage = window.location.hash.replace("#", "") || "dashboard";
        navigateTo(initialPage);
        await refreshDashboard();
    } catch (error) {
        console.error("Backend login failed:", error);
        throw error;
    }
}

async function performDemoLogout() {
    try {
        await fetch(`${getApiBaseUrl()}/auth/logout`, {
            method: "POST",
            credentials: "include",
            headers: {
                Accept: "application/json",
            },
        });
    } catch (error) {
        console.error("Backend logout failed:", error);
    }

    localStorage.removeItem(DEMO_AUTH_KEY);
    isAuthenticated = false;
    currentUser = null;
    clearUserState();
    updateUserInterface();
    navigateTo("dashboard");
    openLoginModal("Signed out. Please sign in to continue.");
}

function openLoginModal(errorMessage) {
    const modal = $("loginModal");
    const errorEl = $("loginError");

    if (!modal) return;

    if (errorMessage) {
        if (errorEl) {
            errorEl.classList.remove("hidden");
            errorEl.innerHTML =
                '<i class="ri-error-warning-line"></i>' +
                escapeHtml(errorMessage);
        }
    } else if (errorEl) {
        errorEl.classList.add("hidden");
        errorEl.innerHTML = "";
    }

    modal.classList.remove("hidden");
    $("loginUsername")?.focus();
}

function closeLoginModal() {
    const modal = $("loginModal");
    const errorEl = $("loginError");

    if (!modal) return;

    modal.classList.add("hidden");
    if (errorEl) {
        errorEl.classList.add("hidden");
        errorEl.innerHTML = "";
    }

    $("loginForm")?.reset();
}

function updateUserInterface() {
    const usernameEl = $("userProfileName");
    const roleEl = $("userProfileRole");
    const avatarEl = $("userAvatar");
    const logoutItem = $("logoutItem");
    const loginItem = $("loginItem");
    const adminNavItem = $("adminNavItem");

    const isAdmin =
        isAuthenticated && currentUser && currentUser.is_admin === true;

    if (adminNavItem) {
        adminNavItem.classList.toggle("hidden", !isAdmin);
    }

    if (isAuthenticated && currentUser) {
        if (usernameEl) {
            usernameEl.textContent = currentUser.full_name || currentUser.username;
        }
        if (roleEl) {
            roleEl.textContent = currentUser.is_admin ? "ADMIN" : "User";
        }
        if (avatarEl) {
            const initials = (currentUser.full_name || currentUser.username)
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => (part && part[0] ? part[0].toUpperCase() : ""))
                .join("")
                .slice(0, 2) || "?";
            avatarEl.textContent = initials;
        }
        if (logoutItem) {
            logoutItem.classList.remove("hidden");
        }
        if (loginItem) {
            loginItem.classList.add("hidden");
        }
    } else {
        if (usernameEl) {
            usernameEl.textContent = "Guest";
        }
        if (roleEl) {
            roleEl.textContent = "Not signed in";
        }
        if (avatarEl) {
            avatarEl.textContent = "GU";
        }
        if (logoutItem) {
            logoutItem.classList.add("hidden");
        }
        if (loginItem) {
            loginItem.classList.remove("hidden");
        }
    }
}"""

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
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => (part && part[0] ? part[0].toUpperCase() : ""))
            .join("")
            .slice(0, 2) || "?";
        avatarEl.textContent = initials;
    }
}"""

content = content.replace(old_auth, new_auth)

with open(r'D:\aqua-ai\frontend\app.js', 'w') as f:
    f.write(content)

print('Done')