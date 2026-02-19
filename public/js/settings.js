// Settings page logic

async function loadSettings() {
  try {
    const settings = await api('api/settings');
    document.getElementById('setting-name').value = settings.missionary_name || '';
    document.getElementById('setting-context').value = settings.missionary_context || '';
    document.getElementById('setting-stale-days').value = settings.default_stale_days || '90';
    loadTagManagement();
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function loadTagManagement() {
  const listEl = document.getElementById('tag-manage-list');
  const statusEl = document.getElementById('tag-manage-status');
  if (!listEl) return;

  try {
    const availableTags = await fetchAvailableTags(true);
    // Fetch all contacts to see which tags are in use
    const usedTags = new Set();
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const res = await api(`api/contacts?limit=200&page=${page}`);
      for (const c of res.contacts) {
        if (c.tags) {
          c.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => usedTags.add(t));
        }
      }
      totalPages = res.totalPages;
      page++;
    }

    listEl.innerHTML = '';
    if (availableTags.length === 0) {
      listEl.innerHTML = '<span style="color:var(--gray-400);font-size:13px;">No tags defined yet.</span>';
      return;
    }

    for (const tag of availableTags) {
      const pill = document.createElement('span');
      const inUse = usedTags.has(tag);
      pill.className = 'tag-manage-pill' + (inUse ? ' in-use' : '');
      if (inUse) {
        pill.innerHTML = `${escapeHtml(tag)}`;
        pill.title = 'In use — cannot remove';
      } else {
        pill.innerHTML = `${escapeHtml(tag)} <button type="button" class="tag-remove-btn" data-tag="${escapeHtml(tag)}" title="Remove tag">&times;</button>`;
        pill.querySelector('.tag-remove-btn').addEventListener('click', async () => {
          const updated = availableTags.filter(t => t !== tag);
          try {
            await api('api/settings/tags', { method: 'PUT', body: { tags: updated } });
            invalidateTagsCache();
            loadTagManagement();
          } catch (err) {
            showTagStatus('Error removing tag: ' + err.message, 'error');
          }
        });
      }
      listEl.appendChild(pill);
    }
  } catch (err) {
    listEl.innerHTML = '<span style="color:var(--red-500);font-size:13px;">Failed to load tags.</span>';
  }
}

function showTagStatus(message, type) {
  const statusEl = document.getElementById('tag-manage-status');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = type || '';
  statusEl.classList.remove('hidden');
  if (type === 'success') {
    setTimeout(() => statusEl.classList.add('hidden'), 3000);
  }
}

// Add Tag button
document.getElementById('btn-add-tag').addEventListener('click', async () => {
  const input = document.getElementById('tag-manage-input');
  const tagName = input.value.trim();
  if (!tagName) return;

  try {
    const current = await fetchAvailableTags(true);
    if (current.some(t => t.toLowerCase() === tagName.toLowerCase())) {
      showTagStatus('Tag already exists.', 'error');
      return;
    }
    const updated = [...current, tagName];
    await api('api/settings/tags', { method: 'PUT', body: { tags: updated } });
    invalidateTagsCache();
    input.value = '';
    showTagStatus('Tag added.', 'success');
    loadTagManagement();
  } catch (err) {
    showTagStatus('Error: ' + err.message, 'error');
  }
});

// Allow Enter key in tag input
document.getElementById('tag-manage-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('btn-add-tag').click();
  }
});

// Save settings
document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const messageEl = document.getElementById('settings-message');

  const data = {
    missionary_name: document.getElementById('setting-name').value,
    missionary_context: document.getElementById('setting-context').value,
    default_stale_days: document.getElementById('setting-stale-days').value,
  };

  try {
    await api('api/settings', { method: 'PUT', body: data });
    messageEl.textContent = 'Settings saved successfully.';
    messageEl.className = 'success';
    messageEl.classList.remove('hidden');
    setTimeout(() => messageEl.classList.add('hidden'), 3000);
  } catch (err) {
    messageEl.textContent = 'Error: ' + err.message;
    messageEl.className = 'error';
    messageEl.classList.remove('hidden');
  }
});

// Change password form
document.getElementById('change-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('password-message');
  msgEl.classList.add('hidden');

  const currentPwd = document.getElementById('current-password').value;
  const newPwd = document.getElementById('new-password').value;
  const confirmPwd = document.getElementById('confirm-password').value;

  if (!currentPwd || !newPwd) {
    msgEl.textContent = 'Please fill in all password fields.';
    msgEl.className = 'error';
    msgEl.classList.remove('hidden');
    return;
  }

  if (newPwd.length < 6) {
    msgEl.textContent = 'New password must be at least 6 characters.';
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
    document.getElementById('current-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';

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

// Recalculate all warmth scores
document.getElementById('btn-recalculate-warmth').addEventListener('click', async () => {
  const btn = document.getElementById('btn-recalculate-warmth');
  const statusEl = document.getElementById('recalculate-warmth-status');

  btn.disabled = true;
  btn.textContent = 'Recalculating...';
  statusEl.className = '';
  statusEl.textContent = 'Recalculating warmth scores for all contacts. This may take a moment...';
  statusEl.classList.remove('hidden');

  try {
    const result = await api('api/ai/warmth-scores/recalculate-all', { method: 'POST' });
    if (result.updated) {
      statusEl.textContent = `Done! Updated warmth scores for ${result.count} contact${result.count === 1 ? '' : 's'}.`;
      statusEl.className = 'success';
    } else {
      statusEl.textContent = 'No contacts found to update. Make sure the ANTHROPIC_API_KEY environment variable is set.';
      statusEl.className = 'error';
    }
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.className = 'error';
  } finally {
    statusEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Recalculate All Warmth Scores';
  }
});

