// Import page logic

let importState = {
  filePath: null,
  headers: [],
  mapping: {},
  totalRows: 0,
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

    renderPreview(data);

    document.getElementById('import-step1').classList.add('hidden');
    document.getElementById('import-step2').classList.remove('hidden');
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload & Preview';
  }
});

const DB_FIELDS = [
  { value: '__skip__', label: '-- skip this column --' },
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
});

// Go to contacts
document.getElementById('btn-goto-contacts').addEventListener('click', () => {
  document.querySelector('.nav-tab[data-tab="contacts"]').click();
  // Reset import UI
  document.getElementById('import-step3').classList.add('hidden');
  document.getElementById('import-step1').classList.remove('hidden');
  dropZone.querySelector('p').textContent = 'Drag & drop a file here, or click to select';
  uploadBtn.disabled = true;
  fileInput.value = '';
});
