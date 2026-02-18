// Shared utility functions

async function api(url, options = {}) {
  const defaults = {
    headers: { 'Content-Type': 'application/json' },
  };
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    options.body = JSON.stringify(options.body);
  }
  if (options.body instanceof FormData) {
    delete defaults.headers['Content-Type'];
  }
  const res = await fetch(url, { ...defaults, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString();
}

function formatCurrency(amount) {
  if (amount == null) return '—';
  return '$' + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderTags(tags) {
  if (!tags) return '';
  return tags.split(',').map(t => t.trim()).filter(Boolean)
    .map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join(' ');
}

function getPhotoUrl(contact, size = 128) {
  if (contact.photo_url) return contact.photo_url;
  const name = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || '?';
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4f46e5&color=fff&size=${size}&bold=true`;
}

function renderWarmthScore(score) {
  if (score == null) return '<span class="warmth-badge warmth-0">\u2014</span>';
  const s = Math.max(1, Math.min(5, score));
  return `<span class="warmth-badge warmth-${s}">${s}</span>`;
}

const MODE_ICONS = {
  email: '\u{1F4E7}',
  sms: '\u{1F4AC}',
  call: '\u{1F4DE}',
  letter: '\u{2709}\u{FE0F}',
  in_person: '\u{1F91D}',
  social_media: '\u{1F4F1}',
  other: '\u{1F4CB}',
};

function getModeIcon(mode) {
  return MODE_ICONS[mode] || '';
}

function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function hideModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// Sync a top scrollbar div with a table wrapper's horizontal scroll
function setupTopScroll(topScrollId, tableWrapId) {
  const topScroll = document.getElementById(topScrollId);
  const tableWrap = document.getElementById(tableWrapId);
  if (!topScroll || !tableWrap) return;

  let syncing = false;
  function syncWidth() {
    topScroll.firstElementChild.style.width = tableWrap.scrollWidth + 'px';
  }

  topScroll.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    tableWrap.scrollLeft = topScroll.scrollLeft;
    syncing = false;
  });

  tableWrap.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    topScroll.scrollLeft = tableWrap.scrollLeft;
    syncing = false;
  });

  // Update width when content changes
  const observer = new MutationObserver(syncWidth);
  observer.observe(tableWrap, { childList: true, subtree: true });
  window.addEventListener('resize', syncWidth);
  syncWidth();
}

// Copy text to clipboard
async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  }
}
