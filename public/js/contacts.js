// Contacts page logic

let currentSort = 'last_name';
let currentOrder = 'asc';
let currentTags = new Set();

async function loadContacts() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('contacts-search').value;
    if (search) params.set('search', search);
    if (currentTags.size > 0) params.set('tag', Array.from(currentTags).join(','));
    params.set('sort', currentSort);
    params.set('order', currentOrder);

    const contacts = await api(`api/contacts?${params}`);
    renderContactsTable(contacts);
    renderTagFilters();
    setupTopScroll('contacts-top-scroll', 'contacts-table-wrap');
  } catch (err) {
    console.error('Error loading contacts:', err);
  }
}

async function renderTagFilters() {
  const container = document.getElementById('tag-filters');
  container.innerHTML = '';

  let allTags;
  try {
    allTags = await fetchAvailableTags();
  } catch (e) {
    allTags = [];
  }

  // Show active tags first
  for (const tag of currentTags) {
    const btn = document.createElement('button');
    btn.className = 'tag-filter active';
    btn.textContent = `${tag} \u00D7`;
    btn.addEventListener('click', () => { currentTags.delete(tag); loadContacts(); });
    container.appendChild(btn);
  }

  for (const tag of allTags) {
    if (currentTags.has(tag)) continue;
    const btn = document.createElement('button');
    btn.className = 'tag-filter';
    btn.textContent = tag;
    btn.addEventListener('click', () => { currentTags.add(tag); loadContacts(); });
    container.appendChild(btn);
  }
}

function renderContactsTable(contacts) {
  const tbody = document.getElementById('contacts-tbody');
  tbody.innerHTML = '';

  if (contacts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--gray-400);">No contacts found. Add or import contacts to get started.</td></tr>';
    return;
  }

  for (const c of contacts) {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => openContactDetail(c.id));
    tr.innerHTML = `
      <td><div class="contact-name-cell"><img class="avatar avatar-sm" src="${getPhotoUrl(c, 64)}" alt=""><strong>${escapeHtml(c.first_name)} ${escapeHtml(c.last_name)}</strong></div></td>
      <td>${renderWarmthScore(c.warmth_score, c.warmth_score_reason)}</td>
      <td>${escapeHtml(c.email || '')}</td>
      <td>${escapeHtml(c.phone || '')}</td>
      <td>${formatDate(c.last_outreach_date)}</td>
      <td>${formatDate(c.last_donation_date)}${c.last_donation_amount ? ' ' + formatCurrency(c.last_donation_amount) : ''}</td>
      <td>${renderTags(c.tags)}</td>
    `;
    tbody.appendChild(tr);
  }
}

// Search
let searchTimeout;
document.getElementById('contacts-search').addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadContacts, 300);
});

// Sort
document.querySelectorAll('.contacts-table th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (currentSort === col) {
      currentOrder = currentOrder === 'asc' ? 'desc' : 'asc';
    } else {
      currentSort = col;
      currentOrder = 'asc';
    }
    loadContacts();
  });
});

// Add new contact
document.getElementById('btn-add-contact').addEventListener('click', () => {
  openContactForm(null);
});

// Find all duplicates
document.getElementById('btn-find-duplicates').addEventListener('click', async () => {
  const btn = document.getElementById('btn-find-duplicates');
  btn.disabled = true;
  btn.textContent = 'Scanning...';
  try {
    const { pairs } = await api('api/contacts/find-all-duplicates');
    if (!pairs || pairs.length === 0) {
      document.getElementById('modal-title').textContent = 'Duplicate Check';
      document.getElementById('modal-body').innerHTML = `
        <div style="text-align:center;padding:32px;">
          <div style="font-size:48px;margin-bottom:16px;">&#x2705;</div>
          <h3 style="margin-bottom:8px;">No duplicates found</h3>
          <p style="color:var(--gray-500);">All contacts appear to be unique.</p>
        </div>
      `;
      showModal('contact-modal');
    } else {
      openDuplicateReview(pairs);
    }
  } catch (err) {
    alert('Error scanning for duplicates: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check for Duplicates';
  }
});

// Export CSV
document.getElementById('btn-export-csv').addEventListener('click', async () => {
  try {
    const res = await fetch('api/contacts/export/csv');
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

// Open contact detail
async function openContactDetail(id) {
  try {
    const contact = await api(`api/contacts/${id}`);
    renderContactModal(contact);
    showModal('contact-modal');
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function renderContactModal(contact) {
  document.getElementById('modal-title').textContent = `${contact.first_name} ${contact.last_name}`;
  const body = document.getElementById('modal-body');

  const outreaches = contact.outreaches || [];
  const donations = contact.donations || [];
  const totalDonated = donations.reduce((sum, d) => sum + d.amount, 0);

  body.innerHTML = `
    <div class="contact-photo-section">
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;">
        <div class="contact-photo-wrapper">
          <img class="avatar avatar-lg" id="contact-photo" src="${getPhotoUrl(contact, 256)}" alt="">
          <label class="photo-upload-btn" title="Upload photo">
            <input type="file" id="photo-upload-input" accept="image/*" hidden>
            <span class="photo-upload-icon">&#x1F4F7;</span>
          </label>
        </div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding-left:16px;">
        <div>
          <span style="font-size:12px;color:var(--gray-500);margin-right:4px;">Warmth:</span>${renderWarmthScore(contact.warmth_score, contact.warmth_score_reason)}
        </div>
        ${contact.warmth_score_reason ? `<p style="margin:6px 0 0;font-size:12px;color:var(--gray-500);line-height:1.5;">${escapeHtml(contact.warmth_score_reason)}</p>` : ''}
      </div>
    </div>
    <form id="contact-edit-form" data-id="${contact.id}">
      <div class="contact-form-grid">
        <div class="form-group">
          <label>First Name</label>
          <input type="text" name="first_name" value="${escapeHtml(contact.first_name)}" required>
        </div>
        <div class="form-group">
          <label>Last Name</label>
          <input type="text" name="last_name" value="${escapeHtml(contact.last_name)}" required>
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" value="${escapeHtml(contact.email || '')}">
        </div>
        <div class="form-group">
          <label>Phone</label>
          <input type="text" name="phone" value="${escapeHtml(contact.phone || '')}">
        </div>
        <div class="form-group">
          <label>Address Line 1</label>
          <input type="text" name="address_line1" value="${escapeHtml(contact.address_line1 || '')}">
        </div>
        <div class="form-group">
          <label>Address Line 2</label>
          <input type="text" name="address_line2" value="${escapeHtml(contact.address_line2 || '')}">
        </div>
        <div class="form-group">
          <label>City</label>
          <input type="text" name="city" value="${escapeHtml(contact.city || '')}">
        </div>
        <div class="form-group">
          <label>State</label>
          <input type="text" name="state" value="${escapeHtml(contact.state || '')}">
        </div>
        <div class="form-group">
          <label>ZIP</label>
          <input type="text" name="zip" value="${escapeHtml(contact.zip || '')}">
        </div>
        <div class="form-group">
          <label>Country</label>
          <input type="text" name="country" value="${escapeHtml(contact.country || 'US')}">
        </div>
        <div class="form-group">
          <label>Organization</label>
          <input type="text" name="organization" value="${escapeHtml(contact.organization || '')}">
        </div>
        <div class="form-group">
          <label>Relationship</label>
          <input type="text" name="relationship" value="${escapeHtml(contact.relationship || '')}">
        </div>
        <div class="form-group full-width">
          <label>Tags</label>
          <div id="edit-tag-picker-container"></div>
        </div>
        <div class="form-group full-width">
          <label>Notes</label>
          <textarea name="notes" rows="3">${escapeHtml(contact.notes || '')}</textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button type="submit" class="btn btn-primary">Save Changes</button>
        <button type="button" class="btn" id="btn-add-outreach" data-id="${contact.id}">Add Outreach</button>
        <button type="button" class="btn" id="btn-add-donation" data-id="${contact.id}">Add Donation</button>
        <button type="button" class="btn btn-danger" id="btn-delete-contact" data-id="${contact.id}">Delete Contact</button>
      </div>
    </form>

    <h3 class="section-title">Outreach Timeline (${outreaches.length})</h3>
    <div class="timeline">
      ${outreaches.length === 0 ? '<p style="color:var(--gray-400);font-size:14px;">No outreach history yet.</p>' :
        outreaches.map(o => `
          <div class="timeline-item">
            <div class="timeline-icon">${getModeIcon(o.mode)}</div>
            <div class="timeline-content">
              <div class="timeline-date">${formatDate(o.date)} &middot; ${o.direction} &middot; ${o.mode}${o.ai_generated ? ' (AI)' : ''}</div>
              <div class="timeline-subject">${escapeHtml(o.subject || '')}</div>
              <div style="font-size:13px;color:var(--gray-500);margin-top:2px;">${escapeHtml((o.content || '').substring(0, 200))}${(o.content || '').length > 200 ? '...' : ''}</div>
            </div>
          </div>
        `).join('')}
    </div>

    <h3 class="section-title">Donation History (${donations.length})</h3>
    ${donations.length === 0 ? '<p style="color:var(--gray-400);font-size:14px;">No donations recorded.</p>' : `
      <table class="donation-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Recurring</th><th>Notes</th></tr></thead>
        <tbody>
          ${donations.map(d => `
            <tr>
              <td>${formatDate(d.date)}</td>
              <td>${formatCurrency(d.amount)}</td>
              <td>${escapeHtml(d.method || '')}</td>
              <td>${d.recurring ? 'Yes' : 'No'}</td>
              <td>${escapeHtml(d.notes || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="donation-total">Total: ${formatCurrency(totalDonated)}</div>
    `}
  `;

  // Initialize tag picker for edit form
  const editTagContainer = body.querySelector('#edit-tag-picker-container');
  const existingTags = contact.tags ? contact.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  fetchAvailableTags().then(available => {
    renderTagPicker(editTagContainer, available, existingTags, { allowAdd: true });
  });

  // Edit form handler
  body.querySelector('#contact-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form));
    try {
      await api(`api/contacts/${form.dataset.id}`, { method: 'PUT', body: data });
      hideModal('contact-modal');
      loadContacts();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // Delete
  body.querySelector('#btn-delete-contact').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete this contact and all related records?')) return;
    try {
      await api(`api/contacts/${contact.id}`, { method: 'DELETE' });
      hideModal('contact-modal');
      loadContacts();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // Photo upload
  body.querySelector('#photo-upload-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('photo', file);
    try {
      const updated = await api(`api/contacts/${contact.id}/photo`, { method: 'POST', body: formData });
      document.getElementById('contact-photo').src = getPhotoUrl(updated, 256);
      loadContacts();
    } catch (err) {
      alert('Error uploading photo: ' + err.message);
    }
  });

  // Add outreach
  body.querySelector('#btn-add-outreach').addEventListener('click', () => {
    document.getElementById('outreach-contact-id').value = contact.id;
    document.getElementById('outreach-contact-email').value = contact.email || '';
    document.getElementById('outreach-mode').value = 'email';
    document.getElementById('outreach-subject').value = '';
    document.getElementById('outreach-content').value = '';
    updateSendEmailButton();
    showModal('outreach-modal');
  });

  // Add donation
  body.querySelector('#btn-add-donation').addEventListener('click', () => {
    openDonationForm(contact.id);
  });
}

function openContactForm(contact) {
  document.getElementById('modal-title').textContent = contact ? 'Edit Contact' : 'New Contact';
  const body = document.getElementById('modal-body');

  body.innerHTML = `
    <form id="contact-new-form">
      <div class="contact-form-grid">
        <div class="form-group">
          <label>First Name *</label>
          <input type="text" name="first_name" required>
        </div>
        <div class="form-group">
          <label>Last Name *</label>
          <input type="text" name="last_name" required>
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email">
        </div>
        <div class="form-group">
          <label>Phone</label>
          <input type="text" name="phone">
        </div>
        <div class="form-group">
          <label>Address Line 1</label>
          <input type="text" name="address_line1">
        </div>
        <div class="form-group">
          <label>Address Line 2</label>
          <input type="text" name="address_line2">
        </div>
        <div class="form-group">
          <label>City</label>
          <input type="text" name="city">
        </div>
        <div class="form-group">
          <label>State</label>
          <input type="text" name="state">
        </div>
        <div class="form-group">
          <label>ZIP</label>
          <input type="text" name="zip">
        </div>
        <div class="form-group">
          <label>Country</label>
          <input type="text" name="country" value="US">
        </div>
        <div class="form-group">
          <label>Organization</label>
          <input type="text" name="organization">
        </div>
        <div class="form-group">
          <label>Relationship</label>
          <input type="text" name="relationship">
        </div>
        <div class="form-group full-width">
          <label>Tags</label>
          <div id="new-tag-picker-container"></div>
        </div>
        <div class="form-group full-width">
          <label>Notes</label>
          <textarea name="notes" rows="3"></textarea>
        </div>
      </div>
      <button type="submit" class="btn btn-primary" style="margin-top:16px;">Create Contact</button>
    </form>
  `;

  // Initialize tag picker for new contact form
  const newTagContainer = body.querySelector('#new-tag-picker-container');
  fetchAvailableTags().then(available => {
    renderTagPicker(newTagContainer, available, [], { allowAdd: true });
  });

  body.querySelector('#contact-new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));

    try {
      // Check for duplicates first
      const { duplicates } = await api('api/contacts/check-duplicates', { method: 'POST', body: data });

      if (duplicates && duplicates.length > 0) {
        showDuplicateWarning(data, duplicates);
        return;
      }

      // No duplicates — create directly
      await api('api/contacts', { method: 'POST', body: data });
      hideModal('contact-modal');
      loadContacts();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  showModal('contact-modal');
}

function showDuplicateWarning(newContactData, duplicates) {
  const body = document.getElementById('modal-body');
  document.getElementById('modal-title').textContent = 'Potential Duplicate Found';

  const reasonLabels = {
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    address: 'Address',
  };

  body.innerHTML = `
    <div class="duplicate-warning">
      <div class="duplicate-warning-banner">
        <span class="duplicate-warning-icon">&#x26A0;</span>
        <div>
          <strong>Possible duplicate contact${duplicates.length > 1 ? 's' : ''} detected</strong>
          <p>The contact you're adding matches ${duplicates.length} existing contact${duplicates.length > 1 ? 's' : ''}. Please review before continuing.</p>
        </div>
      </div>

      <div class="duplicate-new-contact">
        <h4>You're adding:</h4>
        <div class="duplicate-contact-summary">
          <strong>${escapeHtml(newContactData.first_name)} ${escapeHtml(newContactData.last_name)}</strong>
          ${newContactData.email ? `<span>${escapeHtml(newContactData.email)}</span>` : ''}
          ${newContactData.phone ? `<span>${escapeHtml(newContactData.phone)}</span>` : ''}
          ${newContactData.address_line1 ? `<span>${escapeHtml(newContactData.address_line1)}</span>` : ''}
        </div>
      </div>

      <h4 style="margin: 16px 0 8px;">Existing match${duplicates.length > 1 ? 'es' : ''}:</h4>
      ${duplicates.map(d => {
        const c = d.contact;
        const reasons = d.reasons.map(r => reasonLabels[r] || r);
        return `
          <div class="duplicate-match-card">
            <div class="duplicate-match-header">
              <div class="contact-name-cell">
                <img class="avatar avatar-sm" src="${getPhotoUrl(c, 64)}" alt="">
                <strong>${escapeHtml(c.first_name)} ${escapeHtml(c.last_name)}</strong>
              </div>
              <div class="duplicate-match-reasons">
                ${reasons.map(r => `<span class="duplicate-reason-pill">${r} match</span>`).join('')}
              </div>
            </div>
            <div class="duplicate-match-details">
              ${c.email ? `<span>Email: ${escapeHtml(c.email)}</span>` : ''}
              ${c.phone ? `<span>Phone: ${escapeHtml(c.phone)}</span>` : ''}
              ${c.address_line1 ? `<span>Address: ${escapeHtml(c.address_line1)}${c.city ? ', ' + escapeHtml(c.city) : ''}${c.state ? ', ' + escapeHtml(c.state) : ''}</span>` : ''}
            </div>
            <button type="button" class="btn btn-sm btn-edit-existing" data-id="${c.id}">Edit This Contact</button>
          </div>
        `;
      }).join('')}

      <div class="duplicate-actions">
        <button type="button" class="btn" id="btn-dup-back">Back to Form</button>
        <button type="button" class="btn btn-primary" id="btn-dup-add-anyway">Add as New Contact</button>
      </div>
    </div>
  `;

  // "Edit This Contact" buttons — open the existing contact detail
  body.querySelectorAll('.btn-edit-existing').forEach(btn => {
    btn.addEventListener('click', () => {
      openContactDetail(Number(btn.dataset.id));
    });
  });

  // "Back to Form" — re-open the new contact form with data preserved
  body.querySelector('#btn-dup-back').addEventListener('click', () => {
    openContactForm(null);
    // Re-populate form fields after the form renders
    setTimeout(() => {
      const form = document.getElementById('contact-new-form');
      if (form) {
        for (const [key, val] of Object.entries(newContactData)) {
          if (key === 'tags') continue; // handled by tag picker
          const input = form.querySelector(`[name="${key}"]`);
          if (input) input.value = val;
        }
        // Reinitialize tag picker with preserved tags
        const tagContainer = document.getElementById('new-tag-picker-container');
        if (tagContainer && newContactData.tags) {
          const preservedTags = newContactData.tags.split(',').map(t => t.trim()).filter(Boolean);
          fetchAvailableTags().then(available => {
            renderTagPicker(tagContainer, available, preservedTags, { allowAdd: true });
          });
        }
      }
    }, 0);
  });

  // "Add as New Contact" — skip duplicate check and create
  body.querySelector('#btn-dup-add-anyway').addEventListener('click', async () => {
    try {
      await api('api/contacts', { method: 'POST', body: newContactData });
      hideModal('contact-modal');
      loadContacts();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
}

function openDonationForm(contactId) {
  const body = document.getElementById('modal-body');
  // Append donation form at the bottom of the modal
  const existing = document.getElementById('donation-inline-form');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = 'donation-inline-form';
  div.innerHTML = `
    <h3 class="section-title">Add Donation</h3>
    <form id="donation-form-inner">
      <div class="contact-form-grid">
        <div class="form-group">
          <label>Amount *</label>
          <input type="number" name="amount" step="0.01" required>
        </div>
        <div class="form-group">
          <label>Date *</label>
          <input type="date" name="date" value="${new Date().toISOString().split('T')[0]}" required>
        </div>
        <div class="form-group">
          <label>Method</label>
          <select name="method">
            <option value="">—</option>
            <option value="check">Check</option>
            <option value="online">Online</option>
            <option value="cash">Cash</option>
            <option value="bank transfer">Bank Transfer</option>
          </select>
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="recurring"> Recurring</label>
        </div>
        <div class="form-group full-width">
          <label>Notes</label>
          <textarea name="notes" rows="2"></textarea>
        </div>
      </div>
      <button type="submit" class="btn btn-primary">Add Donation</button>
    </form>
  `;
  body.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });

  div.querySelector('#donation-form-inner').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(e.target));
    formData.recurring = formData.recurring === 'on';
    try {
      await api(`api/contacts/${contactId}/donations`, { method: 'POST', body: formData });
      // Reload contact detail
      openContactDetail(contactId);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
}

// --- Bulk duplicate review ---

function openDuplicateReview(pairs) {
  let currentIndex = 0;
  let activePairs = [...pairs];

  function renderCurrentPair() {
    if (currentIndex >= activePairs.length) {
      showReviewComplete();
      return;
    }

    const pair = activePairs[currentIndex];
    const a = pair.contactA;
    const b = pair.contactB;
    const reasons = pair.reasons;

    const reasonLabels = { name: 'Name', email: 'Email', phone: 'Phone', address: 'Address' };
    const reasonPills = reasons.map(r => `<span class="duplicate-reason-pill">${reasonLabels[r] || r} match</span>`).join('');

    document.getElementById('modal-title').textContent = 'Review Duplicates';
    const body = document.getElementById('modal-body');

    body.innerHTML = `
      <div class="dup-review-progress">
        <span>Pair ${currentIndex + 1} of ${activePairs.length}</span>
        <div class="dup-review-progress-bar">
          <div class="dup-review-progress-fill" style="width:${((currentIndex) / activePairs.length) * 100}%"></div>
        </div>
      </div>

      <div class="dup-review-reasons">${reasonPills}</div>

      <div class="dup-review-compare">
        <div class="dup-review-card" id="dup-card-a">
          <div class="dup-review-card-header">
            <img class="avatar avatar-sm" src="${getPhotoUrl(a, 64)}" alt="">
            <strong>${escapeHtml(a.first_name)} ${escapeHtml(a.last_name)}</strong>
          </div>
          ${renderCompareFields(a, b, reasons)}
          <button type="button" class="btn btn-primary btn-sm dup-keep-btn" id="btn-keep-a">Keep This, Delete Other</button>
        </div>
        <div class="dup-review-card" id="dup-card-b">
          <div class="dup-review-card-header">
            <img class="avatar avatar-sm" src="${getPhotoUrl(b, 64)}" alt="">
            <strong>${escapeHtml(b.first_name)} ${escapeHtml(b.last_name)}</strong>
          </div>
          ${renderCompareFields(b, a, reasons)}
          <button type="button" class="btn btn-primary btn-sm dup-keep-btn" id="btn-keep-b">Keep This, Delete Other</button>
        </div>
      </div>

      <div class="duplicate-actions">
        <button type="button" class="btn btn-sm" id="btn-dup-skip">Keep Both &amp; Skip</button>
      </div>
    `;

    showModal('contact-modal');

    // Keep A, delete B
    body.querySelector('#btn-keep-a').addEventListener('click', () => deleteAndAdvance(b.id));
    // Keep B, delete A
    body.querySelector('#btn-keep-b').addEventListener('click', () => deleteAndAdvance(a.id));
    // Skip
    body.querySelector('#btn-dup-skip').addEventListener('click', () => {
      currentIndex++;
      renderCurrentPair();
    });
  }

  async function deleteAndAdvance(deleteId) {
    if (!confirm('Are you sure? This will permanently delete the contact and all related outreaches and donations.')) return;
    try {
      await api(`api/contacts/${deleteId}`, { method: 'DELETE' });
      // Remove all remaining pairs that involve the deleted contact
      activePairs = activePairs.filter((p, idx) => {
        if (idx <= currentIndex) return true; // keep past entries for index stability
        return p.contactA.id !== deleteId && p.contactB.id !== deleteId;
      });
      currentIndex++;
      renderCurrentPair();
    } catch (err) {
      alert('Error deleting contact: ' + err.message);
    }
  }

  function showReviewComplete() {
    document.getElementById('modal-title').textContent = 'Duplicate Check Complete';
    document.getElementById('modal-body').innerHTML = `
      <div style="text-align:center;padding:32px;">
        <div style="font-size:48px;margin-bottom:16px;">&#x2705;</div>
        <h3 style="margin-bottom:8px;">All duplicates reviewed</h3>
        <p style="color:var(--gray-500);">You've worked through all ${pairs.length} potential duplicate pair${pairs.length > 1 ? 's' : ''}.</p>
        <button type="button" class="btn btn-primary" id="btn-dup-done" style="margin-top:16px;">Done</button>
      </div>
    `;
    document.getElementById('btn-dup-done').addEventListener('click', () => {
      hideModal('contact-modal');
      loadContacts();
    });
  }

  renderCurrentPair();
}

function renderCompareFields(contact, other, reasons) {
  const fields = [
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'address_line1', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'ZIP' },
    { key: 'organization', label: 'Organization' },
    { key: 'relationship', label: 'Relationship' },
    { key: 'tags', label: 'Tags' },
    { key: 'notes', label: 'Notes' },
  ];

  const reasonFieldMap = { name: ['first_name', 'last_name'], email: ['email'], phone: ['phone'], address: ['address_line1'] };
  const matchingFields = new Set();
  for (const r of reasons) {
    for (const f of (reasonFieldMap[r] || [])) matchingFields.add(f);
  }

  let html = '<div class="dup-review-fields">';
  for (const f of fields) {
    const val = contact[f.key] || '';
    const isMatch = matchingFields.has(f.key);
    html += `<div class="dup-review-field${isMatch ? ' dup-field-match' : ''}">
      <span class="dup-field-label">${f.label}</span>
      <span class="dup-field-value">${escapeHtml(val) || '<span style="color:var(--gray-300);">\u2014</span>'}</span>
    </div>`;
  }
  html += '</div>';
  return html;
}
