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
      if (target === 'admin') loadAdminUsers();
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

  // Initialize home page
  initHome();
});
