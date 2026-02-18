// Search & Filter page logic

let lastSearchResults = [];
let searchSort = 'last_name';
let searchOrder = 'asc';
let searchDebounceTimer = null;
let searchExtraParams = {};
let searchTagPicker = null;
let searchPage = 1;
let searchPageSize = 50;

function initSearch(extraParams) {
  // Clear any previous extra params and filter inputs
  searchExtraParams = {};
  document.querySelectorAll('#page-search .filter-input').forEach(input => {
    input.value = '';
  });
  // Clear warmth multi-select checkboxes
  clearWarmthMultiselect();

  searchSort = 'last_name';
  searchOrder = 'asc';
  searchPage = 1;
  document.querySelectorAll('#page-search .search-col-headers th').forEach(h => {
    h.classList.remove('sort-asc', 'sort-desc');
  });

  // Reset search tag picker
  if (searchTagPicker) searchTagPicker.setSelected([]);

  if (extraParams && typeof extraParams === 'object') {
    searchExtraParams = extraParams;
    // Pre-fill visible filter inputs where the key matches a data-filter attribute
    for (const [key, val] of Object.entries(extraParams)) {
      if (key === 'warmth_scores') {
        setWarmthMultiselect(String(val).split(','));
        delete searchExtraParams[key];
        continue;
      }
      if (key === 'tags_filter' && searchTagPicker) {
        searchTagPicker.setSelected(String(val).split(',').map(t => t.trim()).filter(Boolean));
        delete searchExtraParams[key];
        continue;
      }
      const input = document.querySelector(`#page-search .filter-input[data-filter="${key}"]`);
      if (input) {
        input.value = val;
        delete searchExtraParams[key]; // handled by the input now
      }
    }
  }

  updateSearchFilterBanner();

  // Initialize search tag picker
  const searchTagContainer = document.getElementById('search-tag-picker');
  if (searchTagContainer && !searchTagPicker) {
    fetchAvailableTags().then(available => {
      searchTagPicker = renderTagPicker(searchTagContainer, available, [], {
        inputName: 'tags_filter',
        onChange: () => {
          clearTimeout(searchDebounceTimer);
          searchDebounceTimer = setTimeout(loadSearchResults, 300);
        }
      });
    }).then(() => loadSearchResults());
  } else {
    loadSearchResults();
  }
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
  // Warmth multi-select
  const warmthVals = getWarmthMultiselectValues();
  if (warmthVals.length > 0) params.set('warmth_scores', warmthVals.join(','));
  // Tag picker
  if (searchTagPicker) {
    const selectedTags = searchTagPicker.getSelected();
    if (selectedTags.length > 0) params.set('tags_filter', selectedTags.join(','));
  }
  // Append any extra params from stat card navigation
  for (const [key, val] of Object.entries(searchExtraParams)) {
    if (val) params.set(key, val);
  }
  params.set('sort', searchSort);
  params.set('order', searchOrder);
  params.set('page', searchPage);
  params.set('limit', searchPageSize);
  return params;
}

async function loadSearchResults() {
  try {
    const params = gatherSearchFilters();
    const data = await api(`api/contacts?${params}`);
    lastSearchResults = data.contacts;
    renderSearchTable(data.contacts);
    document.getElementById('search-count').textContent = data.total;
    renderPagination('search-pagination', {
      page: data.page,
      limit: data.limit,
      total: data.total,
      totalPages: data.totalPages,
      onPageChange: (p) => { searchPage = p; loadSearchResults(); },
      onPageSizeChange: (s) => { searchPageSize = s; searchPage = 1; loadSearchResults(); },
    });
    setupTopScroll('search-top-scroll', 'search-table-wrap');
  } catch (err) {
    console.error('Error loading search results:', err);
  }
}

function renderSearchTable(contacts) {
  const tbody = document.getElementById('search-tbody');
  tbody.innerHTML = '';

  if (contacts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:32px;color:var(--gray-400);">No contacts match your filters.</td></tr>';
    return;
  }

  for (const c of contacts) {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => openContactDetail(c.id));
    tr.innerHTML = `
      <td><div class="contact-name-cell"><img class="avatar avatar-sm" src="${AVATAR_PLACEHOLDER}" data-src="${getPhotoUrl(c, 64)}" alt=""><span>${escapeHtml(c.first_name)} ${escapeHtml(c.last_name)}</span></div></td>
      <td>${renderWarmthScore(c.warmth_score, c.warmth_score_reason)}</td>
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

  observeLazyAvatars(tbody);
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

  searchPage = 1;
  loadSearchResults();
});

// Filter inputs — debounced
document.addEventListener('input', (e) => {
  if (!e.target.closest('#page-search') || !e.target.classList.contains('filter-input')) return;
  clearTimeout(searchDebounceTimer);
  searchPage = 1;
  searchDebounceTimer = setTimeout(loadSearchResults, 400);
});

// Date/number/select inputs — immediate on change
document.addEventListener('change', (e) => {
  if (!e.target.closest('#page-search') || !e.target.classList.contains('filter-input')) return;
  if (e.target.type === 'date' || e.target.type === 'number' || e.target.tagName === 'SELECT') {
    searchPage = 1;
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
    if (fromVal && toVal && fromVal > toVal) {
      hintEl.textContent = `"After" date must be before "before" date`;
      hintEl.classList.add('error');
    } else if (fromVal && toVal) {
      hintEl.textContent = `${label} between ${fromVal} and ${toVal}`;
      hintEl.classList.remove('error');
    } else if (fromVal) {
      hintEl.textContent = `${label} after ${fromVal}`;
      hintEl.classList.remove('error');
    } else if (toVal) {
      hintEl.textContent = `${label} before ${toVal}`;
      hintEl.classList.remove('error');
    } else {
      hintEl.textContent = '';
      hintEl.classList.remove('error');
    }
  }

  // Total donated range hint
  const minVal = document.querySelector(`.filter-input[data-filter="total_donated_min"]`).value;
  const maxVal = document.querySelector(`.filter-input[data-filter="total_donated_max"]`).value;
  const donatedHint = document.getElementById('hint-donated');
  const minNum = minVal ? Number(minVal) : null;
  const maxNum = maxVal ? Number(maxVal) : null;
  if (minNum != null && maxNum != null && minNum > maxNum) {
    donatedHint.textContent = `Min must be less than max`;
    donatedHint.classList.add('error');
  } else if (minNum != null && maxNum != null) {
    donatedHint.textContent = `Total donated between $${minNum.toFixed(2)} and $${maxNum.toFixed(2)}`;
    donatedHint.classList.remove('error');
  } else if (minNum != null) {
    donatedHint.textContent = `Total donated at least $${minNum.toFixed(2)}`;
    donatedHint.classList.remove('error');
  } else if (maxNum != null) {
    donatedHint.textContent = `Total donated at most $${maxNum.toFixed(2)}`;
    donatedHint.classList.remove('error');
  } else {
    donatedHint.textContent = '';
    donatedHint.classList.remove('error');
  }
}

// Clear Filters
document.addEventListener('click', (e) => {
  if (!e.target.matches('#btn-search-clear')) return;
  document.querySelectorAll('#page-search .filter-input').forEach(input => {
    input.value = '';
  });
  clearWarmthMultiselect();
  if (searchTagPicker) searchTagPicker.setSelected([]);
  searchSort = 'last_name';
  searchOrder = 'asc';
  searchPage = 1;
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

// --- Warmth multi-select helpers ---

function getWarmthMultiselectValues() {
  const container = document.querySelector('#page-search .warmth-multiselect');
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

function clearWarmthMultiselect() {
  const container = document.querySelector('#page-search .warmth-multiselect');
  if (!container) return;
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  updateWarmthButtonLabel(container);
}

function setWarmthMultiselect(values) {
  const container = document.querySelector('#page-search .warmth-multiselect');
  if (!container) return;
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = values.includes(cb.value);
  });
  updateWarmthButtonLabel(container);
}

function updateWarmthButtonLabel(container) {
  const btn = container.querySelector('.warmth-multiselect-btn');
  const checked = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  btn.textContent = checked.length === 0 ? 'All' : checked.join(', ');
}

// Toggle dropdown open/close
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.warmth-multiselect-btn');
  const container = btn ? btn.closest('.warmth-multiselect') : null;

  // Close all other open dropdowns
  document.querySelectorAll('.warmth-multiselect.open').forEach(el => {
    if (el !== container) el.classList.remove('open');
  });

  if (container) {
    container.classList.toggle('open');
    return;
  }

  // Close if click is outside any dropdown
  if (!e.target.closest('.warmth-multiselect-dropdown')) {
    document.querySelectorAll('.warmth-multiselect.open').forEach(el => el.classList.remove('open'));
  }
});

// Handle checkbox changes inside the warmth dropdown
document.addEventListener('change', (e) => {
  const container = e.target.closest('.warmth-multiselect');
  if (!container || e.target.type !== 'checkbox') return;
  updateWarmthButtonLabel(container);
  loadSearchResults();
});
