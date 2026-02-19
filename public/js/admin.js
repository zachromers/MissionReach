// Admin panel — user management

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
    // Revert on failure
    regCheckbox.checked = !regCheckbox.checked;
    alert('Error updating registration setting: ' + err.message);
  }
});

async function loadAdminUsers() {
  try {
    const users = await api('api/admin/users');
    const tbody = document.getElementById('admin-users-tbody');
    tbody.innerHTML = '';

    for (const user of users) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(user.username)}</strong></td>
        <td>${escapeHtml(user.email || '—')}</td>
        <td>${escapeHtml(user.display_name || '—')}</td>
        <td><span class="tag-pill">${escapeHtml(user.role)}</span></td>
        <td>${formatDate(user.created_at)}</td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm" data-edit-user="${user.id}">Edit</button>
            ${user.id !== currentUser.id ? `<button class="btn btn-sm btn-danger" data-delete-user="${user.id}" data-username="${escapeHtml(user.username)}">Delete</button>` : ''}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error('Error loading users:', err);
  }
}

function showUserForm(title, user) {
  document.getElementById('admin-form-title').textContent = title;
  document.getElementById('admin-user-id').value = user ? user.id : '';
  document.getElementById('admin-username').value = user ? user.username : '';
  document.getElementById('admin-email').value = user ? (user.email || '') : '';
  document.getElementById('admin-password').value = '';
  document.getElementById('admin-display-name').value = user ? (user.display_name || '') : '';
  document.getElementById('admin-role').value = user ? user.role : 'user';
  document.getElementById('admin-form-message').classList.add('hidden');

  const passwordGroup = document.getElementById('admin-password-group');
  const defaultPwdNote = document.getElementById('admin-default-password-note');
  const hint = document.getElementById('admin-password-hint');
  if (user) {
    // Editing — show password field for optional reset, hide default note
    passwordGroup.classList.remove('hidden');
    defaultPwdNote.classList.add('hidden');
    hint.textContent = 'Leave blank to keep current password. Setting a new password will force the user to change it on next login.';
    document.getElementById('admin-password').removeAttribute('required');
  } else {
    // Creating — hide password field, show default password note
    passwordGroup.classList.add('hidden');
    defaultPwdNote.classList.remove('hidden');
  }

  document.getElementById('admin-user-form-wrap').classList.remove('hidden');
}

function hideUserForm() {
  document.getElementById('admin-user-form-wrap').classList.add('hidden');
}

async function editUser(userId) {
  try {
    const users = await api('api/admin/users');
    const user = users.find(u => u.id === userId);
    if (user) showUserForm('Edit User', user);
  } catch (err) {
    console.error('Error fetching user:', err);
  }
}

async function deleteUser(userId, username) {
  if (!confirm(`Delete user "${username}" and ALL their data? This cannot be undone.`)) return;

  try {
    await api(`api/admin/users/${userId}`, { method: 'DELETE' });
    loadAdminUsers();
  } catch (err) {
    alert('Error deleting user: ' + err.message);
  }
}

// Event delegation for edit/delete buttons (inline onclick blocked by CSP)
document.getElementById('admin-users-tbody').addEventListener('click', (e) => {
  const editBtn = e.target.closest('[data-edit-user]');
  if (editBtn) {
    editUser(Number(editBtn.dataset.editUser));
    return;
  }
  const deleteBtn = e.target.closest('[data-delete-user]');
  if (deleteBtn) {
    deleteUser(Number(deleteBtn.dataset.deleteUser), deleteBtn.dataset.username);
  }
});

// Event listeners
document.getElementById('btn-add-user').addEventListener('click', () => {
  showUserForm('Add User', null);
});

document.getElementById('btn-cancel-user').addEventListener('click', hideUserForm);

document.getElementById('admin-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('admin-form-message');
  msgEl.classList.add('hidden');

  const userId = document.getElementById('admin-user-id').value;
  const data = {
    username: document.getElementById('admin-username').value.trim(),
    email: document.getElementById('admin-email').value.trim(),
    display_name: document.getElementById('admin-display-name').value.trim(),
    role: document.getElementById('admin-role').value,
  };

  const password = document.getElementById('admin-password').value;
  if (password) data.password = password;

  try {
    if (userId) {
      await api(`api/admin/users/${userId}`, { method: 'PUT', body: data });
    } else {
      // New user — server assigns default password 'password123'
      await api('api/admin/users', { method: 'POST', body: data });
    }
    hideUserForm();
    loadAdminUsers();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = 'error';
    msgEl.classList.remove('hidden');
  }
});
