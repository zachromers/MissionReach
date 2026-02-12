// Search & Filter page logic

let lastSearchResults = [];
let searchSort = 'last_name';
let searchOrder = 'asc';
let searchDebounceTimer = null;

function initSearch() {
  loadSearchResults();
}

function gatherSearchFilters() {
  const params = new URLSearchParams();
  document.querySelectorAll('#page-search .filter-input').forEach(input => {
    const key = input.dataset.filter;
    const val = input.value.trim();
    if (key && val) params.set(key, val);
  });
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
    loadSearchResults();
  }
});

// Clear Filters
document.addEventListener('click', (e) => {
  if (!e.target.matches('#btn-search-clear')) return;
  document.querySelectorAll('#page-search .filter-input').forEach(input => {
    input.value = '';
  });
  searchSort = 'last_name';
  searchOrder = 'asc';
  document.querySelectorAll('#page-search .search-col-headers th').forEach(h => {
    h.classList.remove('sort-asc', 'sort-desc');
  });
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
