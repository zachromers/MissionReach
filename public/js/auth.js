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
  document.getElementById('register-page').classList.add('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('force-password-page').classList.add('hidden');
}

function showRegister() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('register-page').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('force-password-page').classList.add('hidden');
  document.getElementById('register-display-name').focus();
}

function showForcePasswordChange() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('register-page').classList.add('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('force-password-page').classList.remove('hidden');
  document.getElementById('force-new-password').focus();
}

function showApp() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('register-page').classList.add('hidden');
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
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
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
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
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

async function handleRegister(e) {
  e.preventDefault();
  const errorEl = document.getElementById('register-error');
  errorEl.classList.add('hidden');

  const display_name = document.getElementById('register-display-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  const confirm_password = document.getElementById('register-confirm-password').value;

  if (!display_name || !email || !username || !password || !confirm_password) {
    errorEl.textContent = 'Please fill in all fields.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (password.length < 6) {
    errorEl.textContent = 'Password must be at least 6 characters.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (password !== confirm_password) {
    errorEl.textContent = 'Passwords do not match.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch('api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ username, email, display_name, password, confirm_password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Registration failed.';
      errorEl.classList.remove('hidden');
      return;
    }
    currentUser = data;

    // Clear form
    document.getElementById('register-display-name').value = '';
    document.getElementById('register-email').value = '';
    document.getElementById('register-username').value = '';
    document.getElementById('register-password').value = '';
    document.getElementById('register-confirm-password').value = '';

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
    await fetch('api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'fetch' } });
  } catch {}
  currentUser = null;
  showLogin();
}

// Set up login form and logout button listeners
// --- Real-time registration field validation ---

function setFieldError(inputId, errorId, message) {
  const input = document.getElementById(inputId);
  const error = document.getElementById(errorId);
  if (message) {
    input.classList.add('input-invalid');
    error.textContent = message;
    error.classList.remove('hidden');
  } else {
    input.classList.remove('input-invalid');
    error.textContent = '';
    error.classList.add('hidden');
  }
}

function validateDisplayName() {
  const val = document.getElementById('register-display-name').value.trim();
  if (!val) { setFieldError('register-display-name', 'error-display-name', ''); return; }
  if (val.length > 128) {
    setFieldError('register-display-name', 'error-display-name', 'Max 128 characters.');
  } else {
    setFieldError('register-display-name', 'error-display-name', '');
  }
}

function validateEmail() {
  const val = document.getElementById('register-email').value.trim();
  if (!val) { setFieldError('register-email', 'error-email', ''); return; }
  if (val.length > 255) {
    setFieldError('register-email', 'error-email', 'Max 255 characters.');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    setFieldError('register-email', 'error-email', 'Invalid email format.');
  } else {
    setFieldError('register-email', 'error-email', '');
  }
}

function validateUsername() {
  const val = document.getElementById('register-username').value.trim();
  if (!val) { setFieldError('register-username', 'error-username', ''); return; }
  if (val.length > 64) {
    setFieldError('register-username', 'error-username', 'Max 64 characters.');
  } else if (!/^[a-zA-Z0-9_.-]+$/.test(val)) {
    setFieldError('register-username', 'error-username', 'Only letters, numbers, underscores, hyphens, and dots.');
  } else {
    setFieldError('register-username', 'error-username', '');
  }
}

function validatePassword() {
  const val = document.getElementById('register-password').value;
  const hint = document.getElementById('hint-password');
  if (!val) {
    setFieldError('register-password', 'error-password', '');
    hint.classList.remove('hidden');
    return;
  }
  if (val.length < 6) {
    hint.classList.add('hidden');
    setFieldError('register-password', 'error-password', 'Must be at least 6 characters.');
  } else {
    setFieldError('register-password', 'error-password', '');
    hint.classList.add('hidden');
  }
  // Re-validate confirm if it has a value
  const confirmVal = document.getElementById('register-confirm-password').value;
  if (confirmVal) validateConfirmPassword();
}

function validateConfirmPassword() {
  const confirmVal = document.getElementById('register-confirm-password').value;
  if (!confirmVal) { setFieldError('register-confirm-password', 'error-confirm-password', ''); return; }
  const passVal = document.getElementById('register-password').value;
  if (confirmVal !== passVal) {
    setFieldError('register-confirm-password', 'error-confirm-password', 'Passwords do not match.');
  } else {
    setFieldError('register-confirm-password', 'error-confirm-password', '');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('register-form').addEventListener('submit', handleRegister);
  document.getElementById('force-password-form').addEventListener('submit', handleForcePasswordChange);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
  document.getElementById('link-show-register').addEventListener('click', (e) => { e.preventDefault(); showRegister(); });
  document.getElementById('link-show-login').addEventListener('click', (e) => { e.preventDefault(); showLogin(); });

  // Wire up real-time validation on registration fields
  document.getElementById('register-display-name').addEventListener('input', validateDisplayName);
  document.getElementById('register-email').addEventListener('input', validateEmail);
  document.getElementById('register-username').addEventListener('input', validateUsername);
  document.getElementById('register-password').addEventListener('input', validatePassword);
  document.getElementById('register-confirm-password').addEventListener('input', validateConfirmPassword);
});
