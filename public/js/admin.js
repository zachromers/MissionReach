// Admin panel — user management

async function loadAdminUsers() {
  try {
    const users = await api('api/admin/users');
    const tbody = document.getElementById('admin-users-tbody');
    tbody.innerHTML = '';

    for (const user of users) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(user.username)}</strong></td>
        <td>${escapeHtml(user.display_name || '—')}</td>
        <td><span class="tag-pill">${escapeHtml(user.role)}</span></td>
        <td>${formatDate(user.created_at)}</td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm" onclick="editUser(${user.id})">Edit</button>
            ${user.id !== currentUser.id ? `<button class="btn btn-sm btn-danger" onclick="deleteUser(${user.id}, '${escapeHtml(user.username)}')">Delete</button>` : ''}
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
  document.getElementById('admin-password').value = '';
  document.getElementById('admin-display-name').value = user ? (user.display_name || '') : '';
  document.getElementById('admin-role').value = user ? user.role : 'user';
  document.getElementById('admin-form-message').classList.add('hidden');

  const hint = document.getElementById('admin-password-hint');
  if (user) {
    hint.textContent = 'Leave blank to keep current password.';
    document.getElementById('admin-password').removeAttribute('required');
  } else {
    hint.textContent = 'Minimum 6 characters.';
    document.getElementById('admin-password').setAttribute('required', '');
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
    display_name: document.getElementById('admin-display-name').value.trim(),
    role: document.getElementById('admin-role').value,
  };

  const password = document.getElementById('admin-password').value;
  if (password) data.password = password;

  try {
    if (userId) {
      await api(`api/admin/users/${userId}`, { method: 'PUT', body: data });
    } else {
      if (!password) {
        msgEl.textContent = 'Password is required for new users.';
        msgEl.className = 'error';
        msgEl.classList.remove('hidden');
        return;
      }
      data.password = password;
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
