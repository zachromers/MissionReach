// Import page logic

let importState = {
  fileToken: null,
  headers: [],
  mapping: {},
  totalRows: 0,
  previewRows: [],
};

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('import-file');
const uploadBtn = document.getElementById('btn-upload-preview');

// Click to select file
dropZone.addEventListener('click', () => fileInput.click());

// Drag and drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    handleFileSelected();
    uploadBtn.click();
  }
});

fileInput.addEventListener('change', handleFileSelected);

function handleFileSelected() {
  if (fileInput.files.length) {
    const fileName = fileInput.files[0].name;
    dropZone.querySelector('p').textContent = `Selected: ${fileName}`;
    uploadBtn.disabled = false;
  }
}

// Upload & Preview
uploadBtn.addEventListener('click', async () => {
  if (!fileInput.files.length) return;

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';

  try {
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    const res = await fetch('api/import/preview', { method: 'POST', body: formData, headers: { 'X-Requested-With': 'fetch' } });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    importState.fileToken = data.fileToken;
    importState.headers = data.headers;
    importState.mapping = data.mapping;
    importState.totalRows = data.totalRows;
    importState.previewRows = data.previewRows;

    renderPreview(data);
    renderImportPreview();

    document.getElementById('import-step1').classList.add('hidden');
    document.getElementById('import-step2').classList.remove('hidden');
    document.querySelector('.import-section').classList.add('wide');
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload & Preview';
  }
});

const DB_FIELDS = [
  { value: '__skip__', label: '-- skip this column --' },
  { value: 'full_name', label: 'full_name (split by space)' },
  { value: 'first_name', label: 'first_name' },
  { value: 'last_name', label: 'last_name' },
  { value: 'email', label: 'email' },
  { value: 'phone', label: 'phone' },
  { value: 'full_address', label: 'full_address (split by comma)' },
  { value: 'address_line1', label: 'address_line1' },
  { value: 'address_line2', label: 'address_line2' },
  { value: 'city', label: 'city' },
  { value: 'state', label: 'state' },
  { value: 'zip', label: 'zip' },
  { value: 'country', label: 'country' },
  { value: 'organization', label: 'organization' },
  { value: 'relationship', label: 'relationship' },
  { value: 'notes', label: 'notes' },
  { value: 'tags', label: 'tags' },
];

function renderPreview(data) {
  const table = document.getElementById('preview-table');
  const { headers, mapping, previewRows } = data;

  const mapped = Object.values(mapping).filter(v => v !== '__skip__').length;
  const skipped = headers.length - mapped;
  document.getElementById('import-summary').textContent = `${data.totalRows} rows found. ${mapped} columns mapped, ${skipped} columns skipped.`;

  let html = '<thead><tr>';
  for (const h of headers) {
    const options = DB_FIELDS.map(f =>
      `<option value="${f.value}" ${mapping[h] === f.value ? 'selected' : ''}>${f.label}</option>`
    ).join('');
    html += `<th>
      <div style="font-size:11px;color:var(--gray-400);margin-bottom:4px;">${escapeHtml(h)}</div>
      <select class="mapping-select" data-header="${escapeHtml(h)}">${options}</select>
    </th>`;
  }
  html += '</tr></thead><tbody>';

  for (const row of previewRows) {
    html += '<tr>';
    for (const h of headers) {
      html += `<td>${escapeHtml(String(row[h] || ''))}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  table.innerHTML = html;

  // Update mapping on change
  table.querySelectorAll('.mapping-select').forEach(sel => {
    sel.addEventListener('change', () => {
      importState.mapping[sel.dataset.header] = sel.value;
      updateImportSummary();
      renderImportPreview();
    });
  });
}

function updateImportSummary() {
  const mapped = Object.values(importState.mapping).filter(v => v !== '__skip__').length;
  const skipped = importState.headers.length - mapped;
  document.getElementById('import-summary').textContent =
    `${importState.totalRows} rows found. ${mapped} columns mapped, ${skipped} columns skipped.`;
}

// Execute import
document.getElementById('btn-import-execute').addEventListener('click', async () => {
  const btn = document.getElementById('btn-import-execute');
  btn.disabled = true;
  btn.textContent = 'Importing...';

  try {
    const data = await api('api/import/execute', {
      method: 'POST',
      body: {
        fileToken: importState.fileToken,
        mapping: importState.mapping,
      },
    });

    importState.lastImportResult = data;

    if (data.duplicates && data.duplicates.length > 0) {
      // Show duplicate review step
      showDuplicateReview(data);
    } else {
      // No duplicates — go straight to results
      showImportResults(data.imported, data.skipped, data.errors);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import Contacts';
  }
});

const REASON_LABELS = { name: 'Name', email: 'Email', phone: 'Phone', address: 'Address' };

const DUP_PAGE_SIZE = 25;
let dupCurrentPage = 1;
// Track resolved status per duplicate index: { resolved: true, action: 'imported'|'skipped' }
let dupResolved = [];
let dupChecked = []; // Track checkbox state across pages
let dupExtraImported = 0;

function showDuplicateReview(data) {
  document.getElementById('import-step2').classList.add('hidden');
  document.getElementById('import-step-duplicates').classList.remove('hidden');

  // Reset pagination and resolution state
  dupCurrentPage = 1;
  dupResolved = data.duplicates.map(() => ({ resolved: false, action: null }));
  dupChecked = data.duplicates.map(() => true);
  dupExtraImported = 0;

  updateDupSummary(data);
  renderDupPage(data);
  renderDupPagination(data);
  initDupSelectAll(data);
}

function updateDupSummary(data) {
  const total = data.duplicates.length;
  const resolved = dupResolved.filter(r => r.resolved).length;
  const pending = total - resolved;
  const imported = dupResolved.filter(r => r.action === 'imported').length;
  const skipped = dupResolved.filter(r => r.action === 'skipped').length;

  let summary = `<strong>${data.imported + dupExtraImported}</strong> contact${(data.imported + dupExtraImported) !== 1 ? 's' : ''} imported successfully. `;
  summary += `<strong>${total}</strong> potential duplicate${total !== 1 ? 's' : ''} found`;
  if (resolved > 0) {
    summary += ` &mdash; <strong>${imported}</strong> imported, <strong>${skipped}</strong> skipped, <strong>${pending}</strong> remaining`;
  }
  summary += '.';

  document.getElementById('import-dup-summary').innerHTML = summary;
}

function renderDupPage(data) {
  const duplicates = data.duplicates;
  const totalPages = Math.ceil(duplicates.length / DUP_PAGE_SIZE);
  if (dupCurrentPage > totalPages) dupCurrentPage = totalPages || 1;

  const start = (dupCurrentPage - 1) * DUP_PAGE_SIZE;
  const end = Math.min(start + DUP_PAGE_SIZE, duplicates.length);

  let html = '';
  for (let idx = start; idx < end; idx++) {
    const entry = duplicates[idx];
    const c = entry.contact;
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
    const res = dupResolved[idx];
    const resolvedClass = res.resolved ? ' dup-resolved' : '';

    html += `<div class="duplicate-match-card${resolvedClass}" data-dup-idx="${idx}" style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <input type="checkbox" class="import-dup-check" data-idx="${idx}" ${res.resolved ? 'disabled' : (dupChecked[idx] ? 'checked' : '')}>
        <strong>${escapeHtml(name)}</strong>
        ${c.email ? `<span style="color:var(--gray-500);font-size:13px;">${escapeHtml(c.email)}</span>` : ''}
        ${c.phone ? `<span style="color:var(--gray-500);font-size:13px;">${escapeHtml(c.phone)}</span>` : ''}`;

    if (res.resolved) {
      const badgeClass = res.action === 'imported' ? 'imported' : 'skipped';
      const label = res.action === 'imported' ? 'Imported' : 'Skipped';
      html += `<span class="dup-resolved-badge ${badgeClass}">${label}</span>`;
    }

    html += `<div class="dup-card-actions">`;
    if (!res.resolved) {
      html += `<button class="btn btn-sm btn-import-one" data-idx="${idx}">Import</button>`;
      html += `<button class="btn btn-sm btn-skip-one" data-idx="${idx}">Skip</button>`;
    }
    html += `</div></div>`;

    html += `<div style="font-size:13px;color:var(--gray-500);margin-bottom:6px;">Matches existing contact${entry.matches.length > 1 ? 's' : ''}:</div>`;

    for (const match of entry.matches) {
      const mc = match.contact;
      const reasons = match.reasons.map(r => REASON_LABELS[r] || r);
      html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--gray-50);border-radius:6px;margin-bottom:4px;">
        <span>${escapeHtml(mc.first_name)} ${escapeHtml(mc.last_name)}</span>
        ${mc.email ? `<span style="font-size:12px;color:var(--gray-400);">${escapeHtml(mc.email)}</span>` : ''}
        <span class="duplicate-match-reasons">
          ${reasons.map(r => `<span class="duplicate-reason-pill">${r} match</span>`).join('')}
        </span>
      </div>`;
    }

    html += `</div>`;
  }

  document.getElementById('import-dup-list').innerHTML = html;
  syncSelectAllState();
}

function renderDupPagination(data) {
  const total = data.duplicates.length;
  const totalPages = Math.ceil(total / DUP_PAGE_SIZE);
  const container = document.getElementById('import-dup-pagination');

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const start = (dupCurrentPage - 1) * DUP_PAGE_SIZE + 1;
  const end = Math.min(dupCurrentPage * DUP_PAGE_SIZE, total);

  let html = '<div class="dup-pagination">';
  html += `<button class="dup-page-prev" ${dupCurrentPage <= 1 ? 'disabled' : ''}>&laquo; Prev</button>`;

  // Show page numbers with ellipsis for large ranges
  const pages = paginationRange(dupCurrentPage, totalPages);
  for (const p of pages) {
    if (p === '...') {
      html += `<span class="dup-page-info">...</span>`;
    } else {
      html += `<button class="dup-page-num ${p === dupCurrentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }
  }

  html += `<button class="dup-page-next" ${dupCurrentPage >= totalPages ? 'disabled' : ''}>Next &raquo;</button>`;
  html += `<span class="dup-page-info">${start}-${end} of ${total}</span>`;
  html += '</div>';

  container.innerHTML = html;

  // Bind pagination events
  container.querySelector('.dup-page-prev')?.addEventListener('click', () => {
    if (dupCurrentPage > 1) { dupCurrentPage--; renderDupPage(data); renderDupPagination(data); }
  });
  container.querySelector('.dup-page-next')?.addEventListener('click', () => {
    if (dupCurrentPage < totalPages) { dupCurrentPage++; renderDupPage(data); renderDupPagination(data); }
  });
  container.querySelectorAll('.dup-page-num').forEach(btn => {
    btn.addEventListener('click', () => {
      dupCurrentPage = Number(btn.dataset.page);
      renderDupPage(data);
      renderDupPagination(data);
    });
  });
}

function paginationRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  pages.push(1);
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

function initDupSelectAll(data) {
  const selectAll = document.getElementById('import-dup-select-all');
  // Remove old listener by replacing element
  const newSelectAll = selectAll.cloneNode(true);
  selectAll.parentNode.replaceChild(newSelectAll, selectAll);

  newSelectAll.addEventListener('change', () => {
    const isChecked = newSelectAll.checked;
    // Update all unresolved items across all pages
    for (let i = 0; i < dupChecked.length; i++) {
      if (!dupResolved[i].resolved) dupChecked[i] = isChecked;
    }
    document.querySelectorAll('.import-dup-check:not(:disabled)').forEach(cb => {
      cb.checked = isChecked;
    });
  });
}

function syncSelectAllState() {
  const selectAll = document.getElementById('import-dup-select-all');
  if (!selectAll) return;
  const all = document.querySelectorAll('.import-dup-check:not(:disabled)');
  const checked = document.querySelectorAll('.import-dup-check:not(:disabled):checked');
  if (all.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  } else {
    selectAll.checked = checked.length === all.length;
    selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
  }
}

// Delegate click events for per-card Import/Skip buttons and checkbox changes
document.getElementById('import-dup-list').addEventListener('click', async (e) => {
  const data = importState.lastImportResult;
  if (!data) return;

  const btn = e.target.closest('.btn-import-one, .btn-skip-one');
  if (!btn) return;

  const idx = Number(btn.dataset.idx);
  const card = btn.closest('.duplicate-match-card');

  if (btn.classList.contains('btn-import-one')) {
    // Import this single contact
    btn.disabled = true;
    btn.textContent = 'Importing...';
    try {
      const result = await api('api/import/force', {
        method: 'POST',
        body: { contacts: [data.duplicates[idx].contact] },
      });
      dupExtraImported += result.imported;
      dupResolved[idx] = { resolved: true, action: 'imported' };
      renderDupPage(data);
      updateDupSummary(data);
      autoFinishIfAllResolved(data);
    } catch (err) {
      alert('Error importing contact: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Import';
    }
  } else if (btn.classList.contains('btn-skip-one')) {
    dupResolved[idx] = { resolved: true, action: 'skipped' };
    renderDupPage(data);
    updateDupSummary(data);
    autoFinishIfAllResolved(data);
  }
});

// Update select-all when individual checkboxes change, and persist state
document.getElementById('import-dup-list').addEventListener('change', (e) => {
  if (e.target.classList.contains('import-dup-check')) {
    const idx = Number(e.target.dataset.idx);
    dupChecked[idx] = e.target.checked;
    syncSelectAllState();
  }
});

function autoFinishIfAllResolved(data) {
  const allResolved = dupResolved.every(r => r.resolved);
  if (allResolved) {
    const totalSkipped = data.skipped + dupResolved.filter(r => r.action === 'skipped').length;
    showImportResults(data.imported + dupExtraImported, totalSkipped, data.errors);
  }
}

// Import selected duplicates (bulk)
document.getElementById('btn-import-selected-dups').addEventListener('click', async () => {
  const btn = document.getElementById('btn-import-selected-dups');
  btn.disabled = true;
  btn.textContent = 'Importing...';

  try {
    const data = importState.lastImportResult;
    const selected = [];
    // Gather all checked, unresolved duplicates (across all pages)
    for (let i = 0; i < data.duplicates.length; i++) {
      if (!dupResolved[i].resolved && dupChecked[i]) {
        selected.push({ idx: i, contact: data.duplicates[i].contact });
      }
    }

    let extraImported = 0;
    if (selected.length > 0) {
      const result = await api('api/import/force', {
        method: 'POST',
        body: { contacts: selected.map(s => s.contact) },
      });
      extraImported = result.imported;
      dupExtraImported += extraImported;
      // Mark all selected as imported
      for (const s of selected) {
        dupResolved[s.idx] = { resolved: true, action: 'imported' };
      }
    }

    // Mark any remaining unresolved as skipped
    for (let i = 0; i < dupResolved.length; i++) {
      if (!dupResolved[i].resolved) {
        dupResolved[i] = { resolved: true, action: 'skipped' };
      }
    }

    const totalSkipped = data.skipped + dupResolved.filter(r => r.action === 'skipped').length;
    showImportResults(data.imported + dupExtraImported, totalSkipped, data.errors);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import Selected';
  }
});

// Skip all duplicates
document.getElementById('btn-skip-all-dups').addEventListener('click', () => {
  const data = importState.lastImportResult;
  // Mark all unresolved as skipped
  for (let i = 0; i < dupResolved.length; i++) {
    if (!dupResolved[i].resolved) {
      dupResolved[i] = { resolved: true, action: 'skipped' };
    }
  }
  const totalSkipped = data.skipped + dupResolved.filter(r => r.action === 'skipped').length;
  showImportResults(data.imported + dupExtraImported, totalSkipped, data.errors);
});

function showImportResults(imported, skipped, errors) {
  document.getElementById('import-step2').classList.add('hidden');
  document.getElementById('import-step-duplicates').classList.add('hidden');
  document.getElementById('import-step3').classList.remove('hidden');
  document.querySelector('.import-section').classList.remove('wide');

  let html = `<p style="margin-bottom:12px;">Successfully imported <strong>${imported}</strong> contacts. <strong>${skipped}</strong> rows skipped.</p>`;
  if (errors && errors.length > 0) {
    html += '<ul style="font-size:13px;color:var(--gray-600);">';
    for (const err of errors) {
      html += `<li>${escapeHtml(err)}</li>`;
    }
    html += '</ul>';
  }
  document.getElementById('import-results').innerHTML = html;
}

// Back button
document.getElementById('btn-import-back').addEventListener('click', () => {
  document.getElementById('import-step2').classList.add('hidden');
  document.getElementById('import-step1').classList.remove('hidden');
  document.querySelector('.import-section').classList.remove('wide');
});

// Go to contacts
document.getElementById('btn-goto-contacts').addEventListener('click', () => {
  document.querySelector('.nav-tab[data-tab="contacts"]').click();
  // Reset import UI
  document.getElementById('import-step3').classList.add('hidden');
  document.getElementById('import-step-duplicates').classList.add('hidden');
  document.getElementById('import-step1').classList.remove('hidden');
  document.querySelector('.import-section').classList.remove('wide');
  dropZone.querySelector('p').textContent = 'Drag & drop a file here, or click to select';
  uploadBtn.disabled = true;
  fileInput.value = '';
  importState.lastImportResult = null;
  dupResolved = [];
  dupChecked = [];
  dupExtraImported = 0;
  dupCurrentPage = 1;
});

// --- Client-side parsing for live preview ---

function clientParseFullName(fullName) {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return {};
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { first_name: trimmed };
  return {
    first_name: trimmed.substring(0, spaceIdx),
    last_name: trimmed.substring(spaceIdx + 1).trim(),
  };
}

function clientParseFullAddress(fullAddress) {
  const parts = (fullAddress || '').split(',').map(p => p.trim()).filter(p => p);
  if (parts.length === 0) return {};

  const result = {};
  let idx = parts.length - 1;

  const countryNames = ['united states', 'usa', 'us', 'canada', 'uk', 'united kingdom', 'australia', 'mexico'];
  if (idx >= 2 && (countryNames.includes(parts[idx].toLowerCase()) || /^[a-zA-Z]{2,3}$/.test(parts[idx]))) {
    result.country = parts[idx];
    idx--;
  }

  if (idx >= 2 && /^\d{5}(-\d{4})?$/.test(parts[idx])) {
    result.zip = parts[idx];
    idx--;
  }

  if (idx >= 1) {
    const m = parts[idx].match(/^([a-zA-Z]{2})\s+(\d{5}(-\d{4})?)$/);
    if (m) {
      result.state = m[1];
      if (!result.zip) result.zip = m[2];
      idx--;
    } else if (/^[a-zA-Z]{2}$/.test(parts[idx])) {
      result.state = parts[idx];
      idx--;
    }
  }

  if (idx >= 1) {
    result.city = parts[idx];
    idx--;
  }

  if (idx >= 0) {
    result.address_line1 = parts[0];
    if (idx >= 1) result.address_line2 = parts.slice(1, idx + 1).join(', ');
  }

  return result;
}

function applyMappingToRow(row) {
  const mapping = importState.mapping;
  const contact = {};

  const explicitName = new Set();
  const explicitAddr = new Set();
  for (const f of Object.values(mapping)) {
    if (['first_name', 'last_name'].includes(f)) explicitName.add(f);
    if (['address_line1', 'address_line2', 'city', 'state', 'zip', 'country'].includes(f)) explicitAddr.add(f);
  }

  for (const [sourceCol, targetField] of Object.entries(mapping)) {
    if (targetField === '__skip__') continue;
    const value = row[sourceCol] != null ? String(row[sourceCol]).trim() : '';

    if (targetField === 'full_name') {
      if (value) {
        const parsed = clientParseFullName(value);
        for (const [field, val] of Object.entries(parsed)) {
          if (!explicitName.has(field)) contact[field] = val;
        }
      }
    } else if (targetField === 'full_address') {
      if (value) {
        const parsed = clientParseFullAddress(value);
        for (const [field, val] of Object.entries(parsed)) {
          if (!explicitAddr.has(field)) contact[field] = val;
        }
      }
    } else {
      contact[targetField] = value;
    }
  }

  return contact;
}

function renderImportPreview() {
  const tbody = document.getElementById('import-preview-tbody');
  const rows = importState.previewRows;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--gray-400);">No preview data available.</td></tr>';
    return;
  }

  let html = '';
  for (const row of rows) {
    const c = applyMappingToRow(row);
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
    html += `<tr>
      <td><strong>${escapeHtml(name)}</strong></td>
      <td>${escapeHtml(c.email || '')}</td>
      <td>${escapeHtml(c.phone || '')}</td>
      <td>${escapeHtml(c.city || '')}</td>
      <td>${escapeHtml(c.state || '')}</td>
      <td>${escapeHtml(c.organization || '')}</td>
      <td>${escapeHtml(c.relationship || '')}</td>
      <td>${renderTags(c.tags || '')}</td>
      <td>\u2014</td>
      <td>\u2014</td>
      <td>\u2014</td>
    </tr>`;
  }
  tbody.innerHTML = html;
}
