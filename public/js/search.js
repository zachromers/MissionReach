// Search & Filter page logic

let lastSearchResults = [];
let searchSort = 'last_name';
let searchOrder = 'asc';
let searchDebounceTimer = null;
let searchExtraParams = {};

function initSearch(extraParams) {
  // Clear any previous extra params and filter inputs
  searchExtraParams = {};
  document.querySelectorAll('#page-search .filter-input').forEach(input => {
    input.value = '';
  });
  searchSort = 'last_name';
  searchOrder = 'asc';
  document.querySelectorAll('#page-search .search-col-headers th').forEach(h => {
    h.classList.remove('sort-asc', 'sort-desc');
  });

  if (extraParams && typeof extraParams === 'object') {
    searchExtraParams = extraParams;
    // Pre-fill visible filter inputs where the key matches a data-filter attribute
    for (const [key, val] of Object.entries(extraParams)) {
      const input = document.querySelector(`#page-search .filter-input[data-filter="${key}"]`);
      if (input) {
        input.value = val;
        delete searchExtraParams[key]; // handled by the input now
      }
    }
  }

  updateSearchFilterBanner();
  loadSearchResults();
}

function updateSearchFilterBanner() {
  let banner = document.getElementById('search-filter-banner');
  const labels = {
    stale_days: 'Stale Contacts',
    donated_since: 'Donors Since',
    contacted_since: 'Contacted Since',
  };
  const active = Object.keys(searchExtraParams).filter(k => searchExtraParams[k]);
  if (active.length === 0) {
    if (banner) banner.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'search-filter-banner';
    banner.className = 'search-filter-banner';
    const header = document.querySelector('#page-search .search-header');
    header.after(banner);
  }
  const desc = active.map(k => labels[k] || k).join(', ');
  banner.innerHTML = `Filtered: <strong>${escapeHtml(desc)}</strong> <button class="btn btn-sm" id="btn-search-clear-special" style="margin-left:8px;">Remove</button>`;
  document.getElementById('btn-search-clear-special').addEventListener('click', () => {
    searchExtraParams = {};
    updateSearchFilterBanner();
    loadSearchResults();
  });
}

function gatherSearchFilters() {
  const params = new URLSearchParams();
  document.querySelectorAll('#page-search .filter-input').forEach(input => {
    const key = input.dataset.filter;
    const val = input.value.trim();
    if (key && val) params.set(key, val);
  });
  // Append any extra params from stat card navigation
  for (const [key, val] of Object.entries(searchExtraParams)) {
    if (val) params.set(key, val);
  }
  params.set('sort', searchSort);
  params.set('order', searchOrder);
  return params;
}

async function loadSearchResults() {
  try {
    const params = gatherSearchFilters();
    const contacts = await api(`api/contacts?${params}`);
    lastSearchResults = contacts;
    renderSearchTable(contacts);
    document.getElementById('search-count').textContent = contacts.length;
    setupTopScroll('search-top-scroll', 'search-table-wrap');
  } catch (err) {
    console.error('Error loading search results:', err);
  }
}

function renderSearchTable(contacts) {
  const tbody = document.getElementById('search-tbody');
  tbody.innerHTML = '';

  if (contacts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:32px;color:var(--gray-400);">No contacts match your filters.</td></tr>';
    return;
  }

  for (const c of contacts) {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => openContactDetail(c.id));
    tr.innerHTML = `
      <td>${escapeHtml(c.first_name)} ${escapeHtml(c.last_name)}</td>
      <td>${escapeHtml(c.email || '')}</td>
      <td>${escapeHtml(c.phone || '')}</td>
      <td>${escapeHtml(c.city || '')}</td>
      <td>${escapeHtml(c.state || '')}</td>
      <td>${escapeHtml(c.organization || '')}</td>
      <td>${escapeHtml(c.relationship || '')}</td>
      <td>${renderTags(c.tags)}</td>
      <td>${formatDate(c.last_outreach_date)}</td>
      <td>${formatDate(c.last_donation_date)}</td>
      <td>${c.total_donated ? formatCurrency(c.total_donated) : '$0.00'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// Sort headers
document.addEventListener('click', (e) => {
  const th = e.target.closest('#page-search .search-col-headers th[data-sort]');
  if (!th) return;

  const col = th.dataset.sort;
  if (searchSort === col) {
    searchOrder = searchOrder === 'asc' ? 'desc' : 'asc';
  } else {
    searchSort = col;
    searchOrder = 'asc';
  }

  // Update arrow indicators
  document.querySelectorAll('#page-search .search-col-headers th').forEach(h => {
    h.classList.remove('sort-asc', 'sort-desc');
  });
  th.classList.add(searchOrder === 'asc' ? 'sort-asc' : 'sort-desc');

  loadSearchResults();
});

// Filter inputs — debounced
document.addEventListener('input', (e) => {
  if (!e.target.closest('#page-search') || !e.target.classList.contains('filter-input')) return;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(loadSearchResults, 400);
});

// Date/number inputs — immediate on change
document.addEventListener('change', (e) => {
  if (!e.target.closest('#page-search') || !e.target.classList.contains('filter-input')) return;
  if (e.target.type === 'date' || e.target.type === 'number') {
    updateDateHints();
    loadSearchResults();
  }
});

function updateDateHints() {
  const pairs = [
    { from: 'outreach_from', to: 'outreach_to', hint: 'hint-outreach', label: 'Last contact' },
    { from: 'donation_from', to: 'donation_to', hint: 'hint-donation', label: 'Last donation' },
  ];
  for (const { from, to, hint, label } of pairs) {
    const fromVal = document.querySelector(`.filter-input[data-filter="${from}"]`).value;
    const toVal = document.querySelector(`.filter-input[data-filter="${to}"]`).value;
    const hintEl = document.getElementById(hint);
    if (fromVal && !toVal) {
      hintEl.textContent = `${label} after ${fromVal}`;
    } else if (!fromVal && toVal) {
      hintEl.textContent = `${label} before ${toVal}`;
    } else {
      hintEl.textContent = '';
    }
  }
}

// Clear Filters
document.addEventListener('click', (e) => {
  if (!e.target.matches('#btn-search-clear')) return;
  document.querySelectorAll('#page-search .filter-input').forEach(input => {
    input.value = '';
  });
  searchSort = 'last_name';
  searchOrder = 'asc';
  searchExtraParams = {};
  document.querySelectorAll('#page-search .search-col-headers th').forEach(h => {
    h.classList.remove('sort-asc', 'sort-desc');
  });
  updateSearchFilterBanner();
  updateDateHints();
  loadSearchResults();
});

// Export CSV with current filters
document.addEventListener('click', async (e) => {
  if (!e.target.matches('#btn-search-export-csv')) return;
  try {
    const params = gatherSearchFilters();
    const res = await fetch(`api/contacts/export/csv?${params}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Error exporting: ' + err.message);
  }
});

// Copy Emails
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('#btn-search-copy-emails');
  if (!btn) return;
  const emails = lastSearchResults
    .map(c => c.email)
    .filter(Boolean)
    .join('\n');
  await copyToClipboard(emails, btn);
});

// Copy Phones
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('#btn-search-copy-phones');
  if (!btn) return;
  const phones = lastSearchResults
    .map(c => c.phone)
    .filter(Boolean)
    .join('\n');
  await copyToClipboard(phones, btn);
});
