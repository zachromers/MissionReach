// Authentication — login form, session check, logout

let currentUser = null;

async function checkAuth() {
  try {
    const res = await fetch('api/auth/me');
    if (!res.ok) {
      showLogin();
      return false;
    }
    currentUser = await res.json();
    if (currentUser.must_change_password) {
      showForcePasswordChange();
      return false;
    }
    showApp();
    return true;
  } catch (err) {
    showLogin();
    return false;
  }
}

function showLogin() {
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('force-password-page').classList.add('hidden');
}

function showForcePasswordChange() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('force-password-page').classList.remove('hidden');
  document.getElementById('force-new-password').focus();
}

function showApp() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  document.getElementById('force-password-page').classList.add('hidden');

  // Update user display in nav
  const userDisplay = document.getElementById('nav-user-display');
  if (userDisplay && currentUser) {
    userDisplay.textContent = currentUser.display_name || currentUser.username;
  }

  // Show/hide admin tab
  const adminTab = document.getElementById('nav-tab-admin');
  if (adminTab) {
    if (currentUser && currentUser.role === 'admin') {
      adminTab.classList.remove('hidden');
    } else {
      adminTab.classList.add('hidden');
    }
  }

  // Hide the default-password banner (now handled by force screen)
  const banner = document.getElementById('default-password-banner');
  if (banner) banner.classList.add('hidden');
}

async function handleLogin(e) {
  e.preventDefault();
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    errorEl.textContent = 'Please enter username and password.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch('api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Login failed.';
      errorEl.classList.remove('hidden');
      return;
    }
    currentUser = data;
    document.getElementById('login-password').value = '';

    if (currentUser.must_change_password) {
      showForcePasswordChange();
      return;
    }

    showApp();

    // Always reset to home tab on login
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="home"]').classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-home').classList.add('active');
    initHome();
  } catch (err) {
    errorEl.textContent = 'Connection error. Please try again.';
    errorEl.classList.remove('hidden');
  }
}

async function handleForcePasswordChange(e) {
  e.preventDefault();
  const errorEl = document.getElementById('force-password-error');
  errorEl.classList.add('hidden');

  const currentPwd = document.getElementById('force-current-password').value;
  const newPwd = document.getElementById('force-new-password').value;
  const confirmPwd = document.getElementById('force-confirm-password').value;

  if (!currentPwd || !newPwd) {
    errorEl.textContent = 'Please fill in all fields.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (newPwd.length < 6) {
    errorEl.textContent = 'New password must be at least 6 characters.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (newPwd !== confirmPwd) {
    errorEl.textContent = 'New passwords do not match.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch('api/auth/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Failed to change password.';
      errorEl.classList.remove('hidden');
      return;
    }

    // Clear form
    document.getElementById('force-current-password').value = '';
    document.getElementById('force-new-password').value = '';
    document.getElementById('force-confirm-password').value = '';

    // Re-check auth — must_change_password should now be false
    currentUser.must_change_password = false;
    showApp();

    // Reset to home tab
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="home"]').classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-home').classList.add('active');
    initHome();
  } catch (err) {
    errorEl.textContent = 'Connection error. Please try again.';
    errorEl.classList.remove('hidden');
  }
}

async function handleLogout() {
  try {
    await fetch('api/auth/logout', { method: 'POST' });
  } catch {}
  currentUser = null;
  showLogin();
}

// Set up login form and logout button listeners
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('force-password-form').addEventListener('submit', handleForcePasswordChange);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
});
