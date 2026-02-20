// Main app — tab switching and initialization

document.addEventListener('DOMContentLoaded', async () => {
  // Check authentication before anything else
  const authenticated = await checkAuth();
  if (!authenticated) return;

  // Tab navigation
  const tabs = document.querySelectorAll('.nav-tab');
  const pages = document.querySelectorAll('.page');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      pages.forEach(p => {
        p.classList.remove('active');
        if (p.id === `page-${target}`) p.classList.add('active');
      });

      // Trigger page-specific init
      if (target === 'home') initHome();
      if (target === 'contacts') loadContacts();
      if (target === 'search') initSearch();
      if (target === 'settings') loadSettings();
      if (target === 'admin') { loadAdminUsers(); loadRegistrationSetting(); loadModelSetting(); }
    });
  });

  // Modal close handlers
  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
    el.addEventListener('click', () => {
      el.closest('.modal').classList.add('hidden');
    });
  });

  // Brand link — always navigates to home
  document.getElementById('nav-brand-link').addEventListener('click', (e) => {
    e.preventDefault();
    tabs.forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="home"]').classList.add('active');
    pages.forEach(p => p.classList.remove('active'));
    document.getElementById('page-home').classList.add('active');
    initHome();
  });

  // "Change Password" banner button — navigate to settings and focus password field
  document.getElementById('btn-change-password-banner').addEventListener('click', () => {
    document.querySelector('[data-tab="settings"]').click();
    document.getElementById('current-password').focus();
  });

  // Handle Gmail OAuth callback redirect
  const urlParams = new URLSearchParams(window.location.search);
  const gmailParam = urlParams.get('gmail');
  if (gmailParam) {
    // Clean the URL
    window.history.replaceState({}, '', window.location.pathname);
    if (gmailParam === 'connected') {
      // Navigate to settings to show the connected state
      document.querySelector('[data-tab="settings"]').click();
      setTimeout(() => {
        const statusEl = document.getElementById('gmail-status-text');
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--green-600);font-weight:600;">Gmail connected successfully!</span>';
      }, 500);
    } else if (gmailParam === 'denied') {
      alert('Gmail connection was cancelled.');
    } else if (gmailParam === 'error') {
      alert('There was an error connecting Gmail. Please try again.');
    }
  }

  // Initialize home page
  initHome();
});
