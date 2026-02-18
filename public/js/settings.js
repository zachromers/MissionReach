// Settings page logic

async function loadSettings() {
  try {
    const settings = await api('api/settings');
    document.getElementById('setting-name').value = settings.missionary_name || '';
    document.getElementById('setting-context').value = settings.missionary_context || '';
    document.getElementById('setting-model').value = settings.claude_model || 'sonnet';
    document.getElementById('setting-stale-days').value = settings.default_stale_days || '90';
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

// Save settings
document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const messageEl = document.getElementById('settings-message');

  const data = {
    missionary_name: document.getElementById('setting-name').value,
    missionary_context: document.getElementById('setting-context').value,
    claude_model: document.getElementById('setting-model').value,
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
      statusEl.textContent = 'No contacts found to update. Make sure you have an API key configured.';
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

