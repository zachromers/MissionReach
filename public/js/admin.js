// Admin panel — user management with search, detail modal, and audit logging

// --- Registration toggle ---
const regCheckbox = document.getElementById('admin-allow-registration');
async function loadRegistrationSetting() {
  try {
    const data = await api('api/admin/settings/registration');
    regCheckbox.checked = data.allow_registration;
  } catch (err) {
    console.error('Error loading registration setting:', err);
  }
}

regCheckbox.addEventListener('change', async () => {
  try {
    await api('api/admin/settings/registration', {
      method: 'PUT',
      body: { allow_registration: regCheckbox.checked },
    });
  } catch (err) {
    regCheckbox.checked = !regCheckbox.checked;
    alert('Error updating registration setting: ' + err.message);
  }
});

// --- Model setting ---
const modelSelect = document.getElementById('admin-model-select');
async function loadModelSetting() {
  try {
    const data = await api('api/admin/settings/model');
    modelSelect.value = data.claude_model || 'sonnet';
  } catch (err) {
    console.error('Error loading model setting:', err);
  }
}

modelSelect.addEventListener('change', async () => {
  const previous = modelSelect.dataset.previous || 'sonnet';
  modelSelect.dataset.previous = modelSelect.value;
  try {
    await api('api/admin/settings/model', {
      method: 'PUT',
      body: { claude_model: modelSelect.value },
    });
  } catch (err) {
    modelSelect.value = previous;
    modelSelect.dataset.previous = previous;
    alert('Error updating model setting: ' + err.message);
  }
});

// --- Search with debounce ---
let _adminSearchTimer = null;
const adminSearchInput = document.getElementById('admin-search');

adminSearchInput.addEventListener('input', () => {
  if (_adminSearchTimer) clearTimeout(_adminSearchTimer);
  _adminSearchTimer = setTimeout(() => loadAdminUsers(), 300);
});

// --- User list ---
async function loadAdminUsers() {
  try {
    const search = adminSearchInput.value.trim();
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    const users = await api(`api/admin/users${query}`);
    const tbody = document.getElementById('admin-users-tbody');
    tbody.innerHTML = '';

    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:24px;">No users found.</td></tr>';
      return;
    }

    for (const user of users) {
      const tr = document.createElement('tr');
      tr.dataset.userId = user.id;
      tr.innerHTML = `
        <td><strong>${escapeHtml(user.username)}</strong></td>
        <td>${escapeHtml(user.email || '\u2014')}</td>
        <td>${escapeHtml(user.display_name || '\u2014')}</td>
        <td><span class="role-badge role-badge-${user.role}">${escapeHtml(user.role)}</span></td>
        <td>${user.last_login ? formatDate(user.last_login) : '<span style="color:var(--gray-400)">Never</span>'}</td>
        <td>${user.must_change_password ? '<span class="status-indicator status-indicator-warning">Must change pwd</span>' : '<span class="status-indicator status-indicator-ok">Active</span>'}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error('Error loading users:', err);
  }
}

// --- Click on user row to open detail ---
document.getElementById('admin-users-tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-user-id]');
  if (tr) {
    openUserDetail(Number(tr.dataset.userId));
  }
});

// --- Add user button opens modal in create mode ---
document.getElementById('btn-add-user').addEventListener('click', () => {
  openUserCreateModal();
});

// --- Modal close handlers ---
document.getElementById('admin-user-modal').addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay') || e.target.classList.contains('modal-close')) {
    hideModal('admin-user-modal');
  }
});

// --- Audit action formatting ---
const AUDIT_ACTIONS = {
  login_success: { label: 'Login', css: 'audit-action-success' },
  login_failure: { label: 'Failed Login', css: 'audit-action-failure' },
  password_changed: { label: 'Password Changed', css: 'audit-action-warning' },
  password_reset_by_admin: { label: 'Password Reset (Admin)', css: 'audit-action-warning' },
  user_created: { label: 'User Created', css: 'audit-action-info' },
  user_updated: { label: 'User Updated', css: 'audit-action-info' },
  user_deleted: { label: 'User Deleted', css: 'audit-action-failure' },
  role_changed: { label: 'Role Changed', css: 'audit-action-warning' },
  settings_changed: { label: 'Settings Changed', css: 'audit-action-info' },
};

function formatAuditAction(action) {
  const info = AUDIT_ACTIONS[action] || { label: action, css: 'audit-action-info' };
  return `<span class="audit-action-badge ${info.css}">${escapeHtml(info.label)}</span>`;
}

function formatDateTime(dateStr) {
  if (!dateStr) return '\u2014';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getUserInitials(user) {
  if (user.display_name) {
    const parts = user.display_name.trim().split(/\s+/);
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  return (user.username || '?')[0].toUpperCase();
}

// --- Open user detail modal ---
async function openUserDetail(userId) {
  try {
    const [user, auditLog, queryHistory] = await Promise.all([
      api(`api/admin/users/${userId}`),
      api(`api/admin/users/${userId}/audit-log`),
      api(`api/admin/users/${userId}/query-history`),
    ]);

    renderUserModal(user, auditLog, queryHistory);
    showModal('admin-user-modal');
  } catch (err) {
    alert('Error loading user: ' + err.message);
  }
}

function renderUserModal(user, auditLog, queryHistory) {
  document.getElementById('admin-modal-title').textContent = user.display_name || user.username;
  const body = document.getElementById('admin-modal-body');

  const isSelf = user.id === currentUser.id;

  body.innerHTML = `
    <!-- Header -->
    <div class="admin-user-header">
      <div class="admin-user-avatar">${getUserInitials(user)}</div>
      <div class="admin-user-header-info">
        <h3>${escapeHtml(user.display_name || user.username)}</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span class="role-badge role-badge-${user.role}">${escapeHtml(user.role)}</span>
          ${user.must_change_password ? '<span class="status-indicator status-indicator-warning">Must change password</span>' : ''}
        </div>
      </div>
    </div>

    <!-- Account Stats -->
    <div class="admin-stat-cards">
      <div class="stat-card">
        <div class="stat-card-value">${user.login_count}</div>
        <div class="stat-card-label">Total Logins</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${user.contact_count}</div>
        <div class="stat-card-label">Contacts</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${user.query_count}</div>
        <div class="stat-card-label">AI Queries</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${user.last_login ? formatDate(user.last_login) : 'Never'}</div>
        <div class="stat-card-label">Last Login</div>
      </div>
    </div>

    <!-- Edit Form -->
    <h3 class="section-title">Edit User</h3>
    <form id="admin-edit-form" data-id="${user.id}">
      <div class="contact-form-grid">
        <div class="form-group">
          <label>Username</label>
          <input type="text" name="username" value="${escapeHtml(user.username)}" required>
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" value="${escapeHtml(user.email || '')}">
        </div>
        <div class="form-group">
          <label>Display Name</label>
          <input type="text" name="display_name" value="${escapeHtml(user.display_name || '')}">
        </div>
        <div class="form-group">
          <label>Role</label>
          <select name="role">
            <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </div>
        <div class="form-group full-width">
          <label>Reset Password</label>
          <input type="password" name="password" placeholder="Leave blank to keep current password" autocomplete="new-password">
          <small style="color:var(--gray-400);">Minimum 6 characters. User will be forced to change on next login.</small>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button type="submit" class="btn btn-primary">Save Changes</button>
        ${!isSelf ? `<button type="button" class="btn btn-danger" id="admin-btn-delete" data-id="${user.id}" data-username="${escapeHtml(user.username)}">Delete User</button>` : ''}
      </div>
      <div id="admin-edit-message" class="hidden" style="margin-top:8px;"></div>
    </form>

    <!-- Account Info -->
    <h3 class="section-title">Account Info</h3>
    <div style="font-size:13px;color:var(--gray-500);display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;">
      <div>Created: <strong>${formatDateTime(user.created_at)}</strong></div>
      <div>Updated: <strong>${formatDateTime(user.updated_at)}</strong></div>
      <div>Last login: <strong>${user.last_login ? formatDateTime(user.last_login) : 'Never'}</strong></div>
      <div>User ID: <strong>${user.id}</strong></div>
    </div>

    <!-- Login History -->
    <h3 class="section-title">Login History</h3>
    ${renderLoginHistory(auditLog)}

    <!-- AI Query History -->
    <h3 class="section-title">AI Query History (${queryHistory.length})</h3>
    ${renderQueryHistory(queryHistory)}

    <!-- Security Log -->
    <h3 class="section-title">Security Log</h3>
    ${renderAuditLog(auditLog)}
  `;

  // Edit form handler
  body.querySelector('#admin-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msgEl = form.querySelector('#admin-edit-message');
    msgEl.classList.add('hidden');

    const data = {};
    const fd = new FormData(form);
    for (const [k, v] of fd.entries()) {
      if (k === 'password' && !v) continue;
      data[k] = v;
    }

    try {
      await api(`api/admin/users/${form.dataset.id}`, { method: 'PUT', body: data });
      // Refresh modal
      openUserDetail(Number(form.dataset.id));
      loadAdminUsers();
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.className = 'error';
      msgEl.classList.remove('hidden');
    }
  });

  // Delete handler
  const deleteBtn = body.querySelector('#admin-btn-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const username = deleteBtn.dataset.username;
      if (!confirm(`Delete user "${username}" and ALL their data? This cannot be undone.`)) return;
      try {
        await api(`api/admin/users/${deleteBtn.dataset.id}`, { method: 'DELETE' });
        hideModal('admin-user-modal');
        loadAdminUsers();
      } catch (err) {
        alert('Error deleting user: ' + err.message);
      }
    });
  }
}

function renderLoginHistory(auditLog) {
  const logins = auditLog.filter(e => e.action === 'login_success' || e.action === 'login_failure');
  if (logins.length === 0) {
    return '<p style="color:var(--gray-400);font-size:14px;">No login history.</p>';
  }
  return `<div class="timeline">${logins.slice(0, 20).map(e => `
    <div class="timeline-item">
      <div class="timeline-icon">${e.action === 'login_success' ? '\u{2705}' : '\u{274C}'}</div>
      <div class="timeline-content">
        <div class="timeline-date">${formatDateTime(e.created_at)}</div>
        <div class="timeline-subject">${e.action === 'login_success' ? 'Successful login' : 'Failed login attempt'}${e.ip_address ? ` &middot; IP: ${escapeHtml(e.ip_address)}` : ''}</div>
      </div>
    </div>
  `).join('')}</div>`;
}

function renderQueryHistory(queries) {
  if (queries.length === 0) {
    return '<p style="color:var(--gray-400);font-size:14px;">No AI queries.</p>';
  }
  return `<table class="audit-table">
    <thead><tr><th>Date</th><th>Prompt</th><th>Response</th></tr></thead>
    <tbody>${queries.map(q => `
      <tr>
        <td style="white-space:nowrap;">${formatDateTime(q.created_at)}</td>
        <td>${escapeHtml((q.prompt_text || '').substring(0, 120))}${(q.prompt_text || '').length > 120 ? '...' : ''}</td>
        <td>${escapeHtml((q.response_summary || '').substring(0, 120))}${(q.response_summary || '').length > 120 ? '...' : ''}</td>
      </tr>
    `).join('')}</tbody>
  </table>`;
}

function renderAuditLog(auditLog) {
  if (auditLog.length === 0) {
    return '<p style="color:var(--gray-400);font-size:14px;">No security events.</p>';
  }
  return `<table class="audit-table">
    <thead><tr><th>Date</th><th>Action</th><th>By</th><th>IP</th><th>Detail</th></tr></thead>
    <tbody>${auditLog.map(e => {
      let detail = '';
      if (e.detail) {
        try {
          const d = JSON.parse(e.detail);
          if (d.setting) detail = `${d.setting}: ${d.value}`;
          else if (d.from && d.to) detail = `${d.from} \u2192 ${d.to}`;
          else if (d.username) detail = d.username;
          else if (d.fields) detail = d.fields.join(', ');
        } catch (_) {
          detail = e.detail;
        }
      }
      return `<tr>
        <td style="white-space:nowrap;">${formatDateTime(e.created_at)}</td>
        <td>${formatAuditAction(e.action)}</td>
        <td>${escapeHtml(e.actor_username || '\u2014')}</td>
        <td>${escapeHtml(e.ip_address || '\u2014')}</td>
        <td>${escapeHtml(detail)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// --- Create user modal ---
function openUserCreateModal() {
  document.getElementById('admin-modal-title').textContent = 'Add New User';
  const body = document.getElementById('admin-modal-body');

  body.innerHTML = `
    <form id="admin-create-form">
      <div class="contact-form-grid">
        <div class="form-group">
          <label>Username</label>
          <input type="text" name="username" required>
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" required>
        </div>
        <div class="form-group">
          <label>Display Name</label>
          <input type="text" name="display_name">
        </div>
        <div class="form-group">
          <label>Role</label>
          <select name="role">
            <option value="user" selected>User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
      <p style="color:var(--gray-500);font-size:13px;margin-top:12px;">New users will be assigned the default password <strong>password123</strong> and must change it on first login.</p>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button type="submit" class="btn btn-primary">Create User</button>
        <button type="button" class="btn" id="admin-btn-cancel-create">Cancel</button>
      </div>
      <div id="admin-create-message" class="hidden" style="margin-top:8px;"></div>
    </form>
  `;

  body.querySelector('#admin-btn-cancel-create').addEventListener('click', () => {
    hideModal('admin-user-modal');
  });

  body.querySelector('#admin-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msgEl = form.querySelector('#admin-create-message');
    msgEl.classList.add('hidden');

    const data = Object.fromEntries(new FormData(form));

    try {
      const created = await api('api/admin/users', { method: 'POST', body: data });
      hideModal('admin-user-modal');
      loadAdminUsers();
      // Open the newly created user's detail
      openUserDetail(created.id);
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.className = 'error';
      msgEl.classList.remove('hidden');
    }
  });

  showModal('admin-user-modal');
}
