// Import page logic

let importState = {
  filePath: null,
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

    const res = await fetch('api/import/preview', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    importState.filePath = data.filePath;
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
        filePath: importState.filePath,
        mapping: importState.mapping,
      },
    });

    document.getElementById('import-step2').classList.add('hidden');
    document.getElementById('import-step3').classList.remove('hidden');
    document.querySelector('.import-section').classList.remove('wide');

    let html = `<p style="margin-bottom:12px;">Successfully imported <strong>${data.imported}</strong> contacts. <strong>${data.skipped}</strong> rows skipped.</p>`;
    if (data.errors && data.errors.length > 0) {
      html += '<ul style="font-size:13px;color:var(--gray-600);">';
      for (const err of data.errors) {
        html += `<li>${escapeHtml(err)}</li>`;
      }
      html += '</ul>';
    }
    document.getElementById('import-results').innerHTML = html;
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import Contacts';
  }
});

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
  document.getElementById('import-step1').classList.remove('hidden');
  document.querySelector('.import-section').classList.remove('wide');
  dropZone.querySelector('p').textContent = 'Drag & drop a file here, or click to select';
  uploadBtn.disabled = true;
  fileInput.value = '';
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
