// Profile page logic

function loadProfile() {
  // Populate user info
  if (window.currentUser) {
    document.getElementById('profile-display-name').textContent = currentUser.display_name || currentUser.username;
    document.getElementById('profile-username').textContent = currentUser.username;
    document.getElementById('profile-email').textContent = currentUser.email || 'No email set';
  }

  // Disable delete for admins
  const deleteBtn = document.getElementById('btn-delete-account');
  if (window.currentUser && currentUser.role === 'admin') {
    deleteBtn.disabled = true;
    deleteBtn.title = 'Admin accounts cannot be self-deleted';
  } else {
    deleteBtn.disabled = false;
    deleteBtn.title = '';
  }

  loadAiHistory();
}

async function loadAiHistory(page = 1) {
  const listEl = document.getElementById('ai-history-list');
  const paginationEl = document.getElementById('ai-history-pagination');

  try {
    const data = await api(`api/auth/ai-history?page=${page}&limit=25`);

    if (data.prompts.length === 0) {
      listEl.innerHTML = '<p style="color:var(--gray-400);font-size:14px;">No AI queries yet.</p>';
      paginationEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = data.prompts.map(p => {
      const date = formatDate(p.created_at);
      const promptText = escapeHtml(p.prompt_text || '');
      const summary = escapeHtml(p.ai_summary || '');
      const contactCount = p.contact_count != null ? p.contact_count : '—';
      return `<div class="result-card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
          <p style="font-size:14px;font-weight:500;color:var(--gray-800);flex:1;">${promptText}</p>
          <span style="font-size:12px;color:var(--gray-400);white-space:nowrap;">${date}</span>
        </div>
        ${summary ? `<p style="font-size:13px;color:var(--gray-500);margin-top:6px;">${summary}</p>` : ''}
        <p style="font-size:12px;color:var(--gray-400);margin-top:4px;">Contacts returned: ${contactCount}</p>
      </div>`;
    }).join('');

    renderPagination('ai-history-pagination', {
      page: data.page,
      limit: data.limit,
      total: data.total,
      totalPages: data.totalPages,
      onPageChange: (newPage) => loadAiHistory(newPage),
    });
  } catch (err) {
    listEl.innerHTML = `<p style="color:var(--red-500);font-size:14px;">Failed to load AI history: ${escapeHtml(err.message)}</p>`;
    paginationEl.innerHTML = '';
  }
}

// Password change form on Profile page
document.getElementById('profile-change-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('profile-password-message');
  msgEl.classList.add('hidden');

  const currentPwd = document.getElementById('profile-current-password').value;
  const newPwd = document.getElementById('profile-new-password').value;
  const confirmPwd = document.getElementById('profile-confirm-password').value;

  if (!currentPwd || !newPwd) {
    msgEl.textContent = 'Please fill in all password fields.';
    msgEl.className = 'error';
    msgEl.classList.remove('hidden');
    return;
  }

  if (newPwd.length < 8) {
    msgEl.textContent = 'New password must be at least 8 characters.';
    msgEl.className = 'error';
    msgEl.classList.remove('hidden');
    return;
  }

  if (newPwd !== confirmPwd) {
    msgEl.textContent = 'New passwords do not match.';
    msgEl.className = 'error';
    msgEl.classList.remove('hidden');
    return;
  }

  try {
    await api('api/auth/password', {
      method: 'PUT',
      body: { current_password: currentPwd, new_password: newPwd },
    });
    msgEl.textContent = 'Password updated successfully.';
    msgEl.className = 'success';
    msgEl.classList.remove('hidden');
    document.getElementById('profile-current-password').value = '';
    document.getElementById('profile-new-password').value = '';
    document.getElementById('profile-confirm-password').value = '';

    // Hide default password banner if it was showing
    const banner = document.getElementById('default-password-banner');
    if (banner) banner.classList.add('hidden');

    // Refresh session to update is_default_password
    if (typeof checkAuth === 'function') checkAuth();

    setTimeout(() => msgEl.classList.add('hidden'), 5000);
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = 'error';
    msgEl.classList.remove('hidden');
  }
});

// Delete account handler
document.getElementById('btn-delete-account').addEventListener('click', async () => {
  if (!confirm('Are you sure you want to delete your account? This will permanently remove ALL your data including contacts, donations, and outreach history.')) {
    return;
  }

  const password = prompt('Enter your password to confirm account deletion:');
  if (!password) return;

  if (!confirm('This is your final warning. Your account and all data will be permanently deleted. Continue?')) {
    return;
  }

  const msgEl = document.getElementById('profile-delete-message');
  try {
    await api('api/auth/account', {
      method: 'DELETE',
      body: { password },
    });
    if (typeof showLogin === 'function') showLogin();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = 'error';
    msgEl.classList.remove('hidden');
  }
});
