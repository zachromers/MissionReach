// Settings page logic

async function loadSettings() {
  try {
    const settings = await api('/api/settings');
    document.getElementById('setting-name').value = settings.missionary_name || '';
    document.getElementById('setting-context').value = settings.missionary_context || '';
    document.getElementById('setting-stale-days').value = settings.default_stale_days || '90';

    // Show masked key
    const apiKeyInput = document.getElementById('setting-apikey');
    apiKeyInput.value = '';
    apiKeyInput.placeholder = settings.anthropic_api_key && settings.anthropic_api_key !== '' ? settings.anthropic_api_key : 'sk-ant-...';
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
    default_stale_days: document.getElementById('setting-stale-days').value,
  };

  // Only include API key if user actually typed something new
  const apiKeyVal = document.getElementById('setting-apikey').value;
  if (apiKeyVal) {
    data.anthropic_api_key = apiKeyVal;
  }

  try {
    await api('/api/settings', { method: 'PUT', body: data });
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

// Toggle API key visibility
document.getElementById('toggle-apikey').addEventListener('click', () => {
  const input = document.getElementById('setting-apikey');
  const btn = document.getElementById('toggle-apikey');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
});
