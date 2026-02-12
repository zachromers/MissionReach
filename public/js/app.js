// Main app — tab switching and initialization

document.addEventListener('DOMContentLoaded', () => {
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
      if (target === 'settings') loadSettings();
    });
  });

  // Modal close handlers
  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
    el.addEventListener('click', () => {
      el.closest('.modal').classList.add('hidden');
    });
  });

  // Initialize home page
  initHome();
});
