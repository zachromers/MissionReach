// Home page — AI prompt interface and dashboard

const MODEL_LABELS = { haiku: 'Claude Haiku', sonnet: 'Claude Sonnet', opus: 'Claude Opus' };

function initHome() {
  loadContactCarousel();
  loadModelIndicator();
  refreshWarmthScores();
}

async function refreshWarmthScores() {
  try {
    const statusEl = document.getElementById('warmth-status');
    if (statusEl) statusEl.classList.remove('hidden');
    const result = await api('api/ai/warmth-scores', { method: 'POST' });
    if (statusEl) statusEl.classList.add('hidden');
    // If scores were updated and contacts or search tab is visible, refresh data
    if (result.updated && result.count > 0) {
      const contactsPage = document.getElementById('page-contacts');
      const searchPage = document.getElementById('page-search');
      if (contactsPage && contactsPage.classList.contains('active')) loadContacts();
      if (searchPage && searchPage.classList.contains('active')) loadSearchResults();
    }
  } catch {
    const statusEl = document.getElementById('warmth-status');
    if (statusEl) statusEl.classList.add('hidden');
  }
}

async function loadModelIndicator() {
  try {
    const settings = await api('api/settings');
    const key = settings.claude_model || 'sonnet';
    document.getElementById('model-indicator').textContent = 'Using ' + (MODEL_LABELS[key] || MODEL_LABELS.sonnet);
  } catch {}
}

let cachedStaleDays = 90;
let carouselContacts = [];
let carouselSortDesc = true; // true = high→low, false = low→high

async function loadContactCarousel() {
  const carousel = document.getElementById('contact-carousel');
  if (!carousel) return;
  try {
    carouselContacts = await api('api/contacts');
    renderCarousel();
  } catch (err) {
    carousel.innerHTML = '<p style="color:var(--gray-400);padding:20px;">Unable to load contacts.</p>';
  }
}

function renderCarousel() {
  const carousel = document.getElementById('contact-carousel');
  if (!carousel) return;
  const sorted = [...carouselContacts].sort((a, b) => {
    return carouselSortDesc
      ? (b.warmth_score || 0) - (a.warmth_score || 0)
      : (a.warmth_score || 0) - (b.warmth_score || 0);
  });
  carousel.innerHTML = '';
  for (const c of sorted) {
    const score = c.warmth_score || 0;
    const firstName = c.first_name || '';
    const lastInitial = c.last_name ? c.last_name.charAt(0).toUpperCase() + '.' : '';
    const displayName = `${firstName} ${lastInitial}`.trim() || '?';
    const photoSrc = getPhotoUrl(c, 128);

    const tile = document.createElement('div');
    tile.className = `carousel-tile carousel-warmth-${Math.min(5, Math.max(0, score))}`;
    tile.dataset.contactId = c.id;
    tile.innerHTML = `
      <img class="carousel-photo" src="${photoSrc}" alt="${escapeHtml(displayName)}">
      <div class="carousel-name">${escapeHtml(displayName)}</div>
      <div class="carousel-score" style="display:flex;align-items:center;justify-content:center;gap:4px;"><span style="font-size:12px;color:var(--gray-500);"${c.warmth_score_reason ? ` title="${escapeHtml(c.warmth_score_reason)}"` : ''}>Warmth:</span>${renderWarmthScore(score, c.warmth_score_reason)}</div>
    `;
    tile.addEventListener('click', () => {
      if (typeof openContactDetail === 'function') openContactDetail(c.id);
    });
    carousel.appendChild(tile);
  }
  initCarouselScroll();
}

document.getElementById('carousel-sort-toggle').addEventListener('click', () => {
  carouselSortDesc = !carouselSortDesc;
  const btn = document.getElementById('carousel-sort-toggle');
  btn.textContent = carouselSortDesc ? 'Warmth: High \u2192 Low' : 'Warmth: Low \u2192 High';
  renderCarousel();
});

function initCarouselScroll() {
  const carousel = document.getElementById('contact-carousel');
  const leftBtn = document.getElementById('carousel-left');
  const rightBtn = document.getElementById('carousel-right');
  if (!carousel || !leftBtn || !rightBtn) return;

  const scrollAmount = 300;
  leftBtn.addEventListener('click', () => {
    carousel.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
  });
  rightBtn.addEventListener('click', () => {
    carousel.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  });

  function updateArrows() {
    leftBtn.classList.toggle('carousel-arrow-hidden', carousel.scrollLeft <= 0);
    rightBtn.classList.toggle('carousel-arrow-hidden', carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 1);
  }
  carousel.addEventListener('scroll', updateArrows);
  // Use setTimeout to let the browser lay out the carousel first
  setTimeout(updateArrows, 100);
}

function navigateToSearch(extraParams) {
  // Switch to Search tab
  const searchTab = document.querySelector('.nav-tab[data-tab="search"]');
  searchTab.click();
  // initSearch is called by the tab click handler, but we need to re-call with params
  initSearch(extraParams);
}

// Daily rotating prompt
const DAILY_PROMPTS = [
  "Who haven't I contacted in 3+ months?",
  "Lapsed donors from the past year",
  "New contacts I haven't reached out to yet",
  "Top donors I should thank",
  "Contacts who donated once but never again",
  "Who should I send a birthday or holiday greeting to?",
  "Contacts I've never had a phone call with",
  "People who gave last month that I should follow up with",
  "Supporters who may be interested in a newsletter update",
  "Contacts in my area I could visit in person",
  "Who has been the most consistent donor this year?",
  "People I only reached out to once and never followed up",
  "Contacts who used to give monthly but stopped",
  "New contacts added in the last 30 days I should welcome",
  "Long-time supporters I haven't thanked recently",
  "Who might be open to increasing their giving?",
  "Contacts I've only emailed but never called",
  "Donors from last year who haven't given yet this year",
  "People I should reconnect with before the end of the quarter",
];

function getDailyPrompts(count) {
  const today = new Date();
  const dayIndex = Math.floor(today.getTime() / (1000 * 60 * 60 * 24));
  const prompts = [];
  for (let i = 0; i < count; i++) {
    prompts.push(DAILY_PROMPTS[(dayIndex * count + i) % DAILY_PROMPTS.length]);
  }
  return prompts;
}

const dailyChipsContainer = document.getElementById('daily-chips');
getDailyPrompts(3).forEach(prompt => {
  const btn = document.createElement('button');
  btn.className = 'chip';
  btn.textContent = prompt;
  btn.addEventListener('click', () => {
    document.getElementById('ai-prompt').value = prompt;
  });
  dailyChipsContainer.appendChild(btn);
});

// Enter key in prompt textarea triggers generation
document.getElementById('ai-prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('btn-generate').click();
  }
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
    lastPrompt = prompt;
    excludedContactIds = [];

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

    renderAiResults(data, false);
  } catch (err) {
    loadingEl.classList.add('hidden');
    document.getElementById('btn-generate').disabled = false;
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
});

let lastAiResults = null;
let lastPrompt = '';
let excludedContactIds = [];

function renderAiResults(data, append) {
  if (append && lastAiResults) {
    lastAiResults.contacts = (lastAiResults.contacts || []).concat(data.contacts || []);
  } else {
    lastAiResults = data;
    excludedContactIds = [];
  }

  // Track all shown contact IDs for future exclusion
  for (const rec of (data.contacts || [])) {
    if (rec.contact_id && !excludedContactIds.includes(rec.contact_id)) {
      excludedContactIds.push(rec.contact_id);
    }
  }

  const resultsEl = document.getElementById('ai-results');
  const cardsEl = document.getElementById('results-cards');
  const countEl = document.getElementById('results-count');
  const reasoningEl = document.getElementById('ai-reasoning');
  const loadMoreWrap = document.getElementById('load-more-wrap');

  const allContacts = lastAiResults.contacts || [];
  countEl.textContent = allContacts.length;
  if (!append) {
    reasoningEl.textContent = data.reasoning || '';
    cardsEl.innerHTML = '';
  }

  // Show load more button if new results were returned
  const newContacts = data.contacts || [];
  if (newContacts.length > 0) {
    loadMoreWrap.classList.remove('hidden');
  } else {
    loadMoreWrap.classList.add('hidden');
  }

  for (const rec of newContacts) {
    const c = rec.contact || {};
    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || `Contact #${rec.contact_id}`;
    const emailDraft = rec.email_draft || {};
    const smsDraft = rec.sms_draft || '';

    const card = document.createElement('div');
    card.className = 'result-card';
    const photoSrc = getPhotoUrl(c, 64);
    card.innerHTML = `
      <div class="result-card-header">
        <div class="result-card-name"><img class="avatar avatar-sm" src="${photoSrc}" alt=""><h3>${escapeHtml(name)}</h3></div>
        <button class="btn btn-sm btn-log-outreach" data-contact-id="${rec.contact_id}" data-mode="email" data-email="${escapeHtml(c.email || '')}" data-subject="${escapeHtml(emailDraft.subject || '')}" data-content="${escapeHtml(emailDraft.body || '')}">Log This Outreach</button>
      </div>
      <div class="result-meta">
        <span>Warmth: ${renderWarmthScore(c.warmth_score, c.warmth_score_reason)}</span>
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
            <span class="draft-actions">
              ${c.email ? `<a class="copy-btn send-email-btn" href="${buildMailtoLink(c.email, emailDraft.subject || '', emailDraft.body || '')}" title="Open in your email client">Send Email</a>` : ''}
              <button class="copy-btn" onclick="copyToClipboard(this.closest('.draft-content').querySelector('.draft-body').textContent, this)">Copy</button>
            </span>
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
    // Attach log outreach listener to this card
    card.querySelector('.btn-log-outreach').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      document.getElementById('outreach-contact-id').value = btn.dataset.contactId;
      document.getElementById('outreach-contact-email').value = btn.dataset.email || '';
      document.getElementById('outreach-mode').value = btn.dataset.mode || 'email';
      document.getElementById('outreach-subject').value = btn.dataset.subject || '';
      document.getElementById('outreach-content').value = btn.dataset.content || '';
      updateSendEmailButton();
      showModal('outreach-modal');
    });

    cardsEl.appendChild(card);
  }

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
    loadContactCarousel();
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

// Load more contacts
document.getElementById('btn-load-more').addEventListener('click', async () => {
  if (!lastPrompt) return;

  const btn = document.getElementById('btn-load-more');
  const loadingEl = document.getElementById('load-more-loading');
  const errorEl = document.getElementById('ai-error');

  btn.disabled = true;
  loadingEl.classList.remove('hidden');

  try {
    const data = await api('api/ai/prompt', {
      method: 'POST',
      body: { prompt: lastPrompt, excludeIds: excludedContactIds },
    });

    loadingEl.classList.add('hidden');
    btn.disabled = false;

    if (data.error) {
      errorEl.textContent = data.message || data.error;
      errorEl.classList.remove('hidden');
      return;
    }

    const newContacts = data.contacts || [];
    if (newContacts.length === 0) {
      btn.textContent = 'No More Recommendations';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = 'Load More Recommendations';
        btn.disabled = false;
        document.getElementById('load-more-wrap').classList.add('hidden');
      }, 2000);
      return;
    }

    renderAiResults(data, true);
  } catch (err) {
    loadingEl.classList.add('hidden');
    btn.disabled = false;
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
});

// Update Send Email button visibility and href in outreach modal
function updateSendEmailButton() {
  const email = document.getElementById('outreach-contact-email').value;
  const mode = document.getElementById('outreach-mode').value;
  const subject = document.getElementById('outreach-subject').value;
  const content = document.getElementById('outreach-content').value;
  const btn = document.getElementById('btn-send-email');
  if (mode === 'email' && email) {
    btn.href = buildMailtoLink(email, subject, content);
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

document.getElementById('outreach-mode').addEventListener('change', updateSendEmailButton);
document.getElementById('outreach-subject').addEventListener('input', updateSendEmailButton);
document.getElementById('outreach-content').addEventListener('input', updateSendEmailButton);

// Generate outreach draft button
document.getElementById('btn-generate-outreach').addEventListener('click', async () => {
  const contactId = document.getElementById('outreach-contact-id').value;
  const mode = document.getElementById('outreach-mode').value;
  const btn = document.getElementById('btn-generate-outreach');

  if (!contactId) return;

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Generating...';

  try {
    const result = await api(`api/ai/generate-outreach/${contactId}`, {
      method: 'POST',
      body: { mode },
    });
    document.getElementById('outreach-subject').value = result.subject || '';
    document.getElementById('outreach-content').value = result.content || '';
    updateSendEmailButton();
  } catch (err) {
    alert('Error generating outreach: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
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
        status: 'completed',
      },
    });
    hideModal('outreach-modal');
    // Refresh contact detail modal if it's still open so the new outreach appears
    const contactModal = document.getElementById('contact-modal');
    if (contactModal && !contactModal.classList.contains('hidden')) {
      openContactDetail(contactId);
    }
    loadContactCarousel();
  } catch (err) {
    alert('Error: ' + err.message);
  }
});
