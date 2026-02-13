// Home page — AI prompt interface and dashboard

function initHome() {
  loadDashboardStats();
}

let cachedStaleDays = 90;

async function loadDashboardStats() {
  try {
    const stats = await api('api/ai/stats');
    document.getElementById('stat-total-contacts').textContent = stats.totalContacts;
    document.getElementById('stat-stale-contacts').textContent = stats.staleContacts;
    document.getElementById('stat-ytd-donations').textContent = formatCurrency(stats.ytdDonations);
    document.getElementById('stat-outreaches-month').textContent = stats.outreachesThisMonth;
    if (stats.staleDays) cachedStaleDays = stats.staleDays;
  } catch {}
}

function navigateToSearch(extraParams) {
  // Switch to Search tab
  const searchTab = document.querySelector('.nav-tab[data-tab="search"]');
  searchTab.click();
  // initSearch is called by the tab click handler, but we need to re-call with params
  initSearch(extraParams);
}

// Stat card clicks
document.querySelectorAll('.stat-card').forEach(card => {
  card.style.cursor = 'pointer';
  card.addEventListener('click', () => {
    const valueEl = card.querySelector('.stat-value');
    const id = valueEl ? valueEl.id : '';
    if (id === 'stat-total-contacts') {
      navigateToSearch();
    } else if (id === 'stat-stale-contacts') {
      navigateToSearch({ stale_days: String(cachedStaleDays) });
    } else if (id === 'stat-ytd-donations') {
      const yearStart = new Date().getFullYear() + '-01-01';
      navigateToSearch({ donated_since: yearStart });
    } else if (id === 'stat-outreaches-month') {
      const now = new Date();
      const monthStart = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
      navigateToSearch({ contacted_since: monthStart });
    }
  });
});

// Prompt chips
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.getElementById('ai-prompt').value = chip.dataset.prompt;
  });
});

// Generate button
document.getElementById('btn-generate').addEventListener('click', async () => {
  const prompt = document.getElementById('ai-prompt').value.trim();
  if (!prompt) return;

  const resultsEl = document.getElementById('ai-results');
  const loadingEl = document.getElementById('ai-loading');
  const errorEl = document.getElementById('ai-error');

  resultsEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  document.getElementById('btn-generate').disabled = true;

  try {
    const data = await api('api/ai/prompt', {
      method: 'POST',
      body: { prompt },
    });

    loadingEl.classList.add('hidden');
    document.getElementById('btn-generate').disabled = false;

    if (data.error) {
      errorEl.textContent = data.message || data.error;
      errorEl.classList.remove('hidden');
      return;
    }

    renderAiResults(data);
  } catch (err) {
    loadingEl.classList.add('hidden');
    document.getElementById('btn-generate').disabled = false;
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
});

let lastAiResults = null;

function renderAiResults(data) {
  lastAiResults = data;
  const resultsEl = document.getElementById('ai-results');
  const cardsEl = document.getElementById('results-cards');
  const countEl = document.getElementById('results-count');
  const reasoningEl = document.getElementById('ai-reasoning');

  const contacts = data.contacts || [];
  countEl.textContent = contacts.length;
  reasoningEl.textContent = data.reasoning || '';

  cardsEl.innerHTML = '';

  for (const rec of contacts) {
    const c = rec.contact || {};
    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || `Contact #${rec.contact_id}`;
    const emailDraft = rec.email_draft || {};
    const smsDraft = rec.sms_draft || '';

    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <div class="result-card-header">
        <h3>${escapeHtml(name)}</h3>
        <button class="btn btn-sm btn-log-outreach" data-contact-id="${rec.contact_id}" data-mode="email" data-subject="${escapeHtml(emailDraft.subject || '')}" data-content="${escapeHtml(emailDraft.body || '')}">Log This Outreach</button>
      </div>
      <div class="result-meta">
        <span>Relationship: ${escapeHtml(c.relationship || '—')}</span>
        <span>Last Contact: ${formatDate(c.last_outreach_date)}</span>
        <span>Last Donation: ${formatDate(c.last_donation_date)} ${c.last_donation_amount ? formatCurrency(c.last_donation_amount) : ''}</span>
      </div>
      <div class="result-reason">${escapeHtml(rec.reason || '')}</div>
      <details class="draft-section">
        <summary>
          <div class="draft-header">
            <span>Email Draft</span>
          </div>
        </summary>
        <div class="draft-content">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong>Subject: ${escapeHtml(emailDraft.subject || '')}</strong>
            <button class="copy-btn" onclick="copyToClipboard(this.closest('.draft-content').querySelector('.draft-body').textContent, this)">Copy</button>
          </div>
          <div class="draft-body">${escapeHtml(emailDraft.body || '')}</div>
        </div>
      </details>
      <details class="draft-section">
        <summary>
          <div class="draft-header">
            <span>SMS Draft</span>
          </div>
        </summary>
        <div class="draft-content">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span></span>
            <button class="copy-btn" onclick="copyToClipboard(this.closest('.draft-content').querySelector('.sms-body').textContent, this)">Copy</button>
          </div>
          <div class="sms-body">${escapeHtml(smsDraft)}</div>
        </div>
      </details>
    `;
    cardsEl.appendChild(card);
  }

  // Log outreach buttons
  cardsEl.querySelectorAll('.btn-log-outreach').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('outreach-contact-id').value = btn.dataset.contactId;
      document.getElementById('outreach-mode').value = btn.dataset.mode || 'email';
      document.getElementById('outreach-subject').value = btn.dataset.subject || '';
      document.getElementById('outreach-content').value = btn.dataset.content || '';
      document.getElementById('outreach-ai-generated').checked = true;
      showModal('outreach-modal');
    });
  });

  resultsEl.classList.remove('hidden');
}

// Log all as outreach
document.getElementById('btn-log-all').addEventListener('click', async () => {
  if (!lastAiResults || !lastAiResults.contacts) return;

  const btn = document.getElementById('btn-log-all');
  btn.disabled = true;
  btn.textContent = 'Logging...';

  try {
    for (const rec of lastAiResults.contacts) {
      const emailDraft = rec.email_draft || {};
      await api(`api/contacts/${rec.contact_id}/outreaches`, {
        method: 'POST',
        body: {
          mode: 'email',
          subject: emailDraft.subject || '',
          content: emailDraft.body || '',
          ai_generated: true,
          status: 'completed',
        },
      });
    }
    btn.textContent = 'All Logged!';
    setTimeout(() => {
      btn.textContent = 'Log All as Outreach';
      btn.disabled = false;
    }, 2000);
    loadDashboardStats();
  } catch (err) {
    alert('Error logging outreaches: ' + err.message);
    btn.textContent = 'Log All as Outreach';
    btn.disabled = false;
  }
});

// Export drafts
document.getElementById('btn-export-drafts').addEventListener('click', () => {
  if (!lastAiResults || !lastAiResults.contacts) return;

  let text = '';
  for (const rec of lastAiResults.contacts) {
    const c = rec.contact || {};
    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
    const emailDraft = rec.email_draft || {};

    text += `=== ${name} ===\n\n`;
    text += `EMAIL:\nSubject: ${emailDraft.subject || ''}\n\n${emailDraft.body || ''}\n\n`;
    text += `SMS:\n${rec.sms_draft || ''}\n\n`;
    text += '---\n\n';
  }

  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'outreach-drafts.txt';
  a.click();
  URL.revokeObjectURL(url);
});

// Outreach form submission
document.getElementById('outreach-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const contactId = document.getElementById('outreach-contact-id').value;

  try {
    await api(`api/contacts/${contactId}/outreaches`, {
      method: 'POST',
      body: {
        mode: document.getElementById('outreach-mode').value,
        subject: document.getElementById('outreach-subject').value,
        content: document.getElementById('outreach-content').value,
        ai_generated: document.getElementById('outreach-ai-generated').checked,
        status: 'completed',
      },
    });
    hideModal('outreach-modal');
    loadDashboardStats();
  } catch (err) {
    alert('Error: ' + err.message);
  }
});
