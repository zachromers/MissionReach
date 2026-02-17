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

