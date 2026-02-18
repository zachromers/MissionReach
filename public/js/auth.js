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
}

function showApp() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

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

  // Show default password warning
  const banner = document.getElementById('default-password-banner');
  if (banner) {
    if (currentUser && currentUser.is_default_password) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }
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
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
});
