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
  if (res.status === 401) {
    // Session expired or not authenticated — redirect to login
    if (typeof showLogin === 'function') showLogin();
    throw new Error('Session expired. Please log in again.');
  }
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
  if (contact.photo_url) {
    // Strip leading slash so URLs resolve relative to the base path
    if (contact.photo_url.startsWith('/uploads/')) return contact.photo_url.substring(1);
    return contact.photo_url;
  }
  const name = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || '?';
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4f46e5&color=fff&size=${size}&bold=true`;
}

function renderWarmthScore(score, reason) {
  if (score == null) return '<span class="warmth-badge warmth-0">\u2014</span>';
  const s = Math.max(1, Math.min(5, score));
  const titleAttr = reason ? ` title="${escapeHtml(reason)}"` : '';
  return `<span class="warmth-badge warmth-${s}"${titleAttr}>${s}</span>`;
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

// Build a mailto: link from email, subject, and body
function buildMailtoLink(email, subject, body) {
  const params = [];
  if (subject) params.push('subject=' + encodeURIComponent(subject));
  if (body) params.push('body=' + encodeURIComponent(body));
  return 'mailto:' + encodeURIComponent(email) + (params.length ? '?' + params.join('&') : '');
}

// --- Tag picker component + cache ---

let _tagsCache = null;
let _tagsCacheTime = 0;
const TAGS_CACHE_TTL = 60000; // 1 minute

async function fetchAvailableTags(forceRefresh = false) {
  if (!forceRefresh && _tagsCache && (Date.now() - _tagsCacheTime < TAGS_CACHE_TTL)) {
    return _tagsCache;
  }
  const data = await api('api/settings/tags');
  _tagsCache = data.tags || [];
  _tagsCacheTime = Date.now();
  return _tagsCache;
}

function invalidateTagsCache() {
  _tagsCache = null;
  _tagsCacheTime = 0;
}

/**
 * Render a tag picker component into a container.
 * @param {HTMLElement} container - Element to render into
 * @param {string[]} availableTags - All available tags
 * @param {string[]} selectedTags - Initially selected tags
 * @param {object} options - { onChange, allowAdd, inputName }
 * @returns {{ getSelected(), setSelected(tags) }}
 */
function renderTagPicker(container, availableTags, selectedTags, options = {}) {
  const inputName = options.inputName || 'tags';
  let selected = [...selectedTags];

  function render() {
    container.innerHTML = '';
    container.className = (container.className.replace(/\btag-picker\b/, '').trim() + ' tag-picker').trim();

    // Selected tag pills
    for (const tag of selected) {
      const pill = document.createElement('span');
      pill.className = 'tag-pill tag-picker-pill';
      pill.innerHTML = `${escapeHtml(tag)} <button type="button" class="tag-remove" data-tag="${escapeHtml(tag)}">&times;</button>`;
      pill.querySelector('.tag-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        selected = selected.filter(t => t !== tag);
        render();
        if (options.onChange) options.onChange(selected);
      });
      container.appendChild(pill);
    }

    // Dropdown to add tags
    const unselected = availableTags.filter(t => !selected.includes(t));
    if (unselected.length > 0 || options.allowAdd) {
      const select = document.createElement('select');
      select.className = 'tag-picker-dropdown';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '+ Add tag...';
      select.appendChild(defaultOpt);

      for (const tag of unselected) {
        const opt = document.createElement('option');
        opt.value = tag;
        opt.textContent = tag;
        select.appendChild(opt);
      }

      if (options.allowAdd) {
        const customOpt = document.createElement('option');
        customOpt.value = '__custom__';
        customOpt.textContent = '+ Type new tag...';
        select.appendChild(customOpt);
      }

      select.addEventListener('change', async () => {
        if (select.value === '__custom__') {
          select.value = '';
          const newTag = prompt('Enter new tag name:');
          if (newTag && newTag.trim()) {
            const trimmed = newTag.trim();
            if (!selected.includes(trimmed)) {
              selected.push(trimmed);
              // Add to available tags via API
              if (!availableTags.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
                availableTags.push(trimmed);
                availableTags.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                try {
                  await api('api/settings/tags', { method: 'PUT', body: { tags: availableTags } });
                  invalidateTagsCache();
                } catch (e) { console.error('Failed to save new tag:', e); }
              }
              render();
              if (options.onChange) options.onChange(selected);
            }
          }
        } else if (select.value) {
          selected.push(select.value);
          render();
          if (options.onChange) options.onChange(selected);
        }
      });
      container.appendChild(select);
    }

    // Hidden input for FormData compatibility
    let hiddenInput = container.querySelector(`input[name="${inputName}"]`);
    if (!hiddenInput) {
      hiddenInput = document.createElement('input');
      hiddenInput.type = 'hidden';
      hiddenInput.name = inputName;
      container.appendChild(hiddenInput);
    }
    hiddenInput.value = selected.join(',');
  }

  render();

  return {
    getSelected() { return [...selected]; },
    setSelected(tags) {
      selected = [...tags];
      render();
    }
  };
}

// --- Pagination component ---
function renderPagination(containerId, { page, limit, total, totalPages, onPageChange, onPageSizeChange }) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (total === 0) return;

  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  const wrapper = document.createElement('div');
  wrapper.className = 'pagination';

  // Previous button
  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-sm pagination-btn';
  prevBtn.textContent = 'Previous';
  prevBtn.disabled = page <= 1;
  prevBtn.addEventListener('click', () => onPageChange(page - 1));
  wrapper.appendChild(prevBtn);

  // Info
  const info = document.createElement('span');
  info.className = 'pagination-info';
  info.textContent = `Showing ${start}-${end} of ${total}`;
  wrapper.appendChild(info);

  // Next button
  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-sm pagination-btn';
  nextBtn.textContent = 'Next';
  nextBtn.disabled = page >= totalPages;
  nextBtn.addEventListener('click', () => onPageChange(page + 1));
  wrapper.appendChild(nextBtn);

  // Page size selector
  const sizeLabel = document.createElement('span');
  sizeLabel.className = 'pagination-size-label';
  sizeLabel.textContent = 'Per page:';
  wrapper.appendChild(sizeLabel);

  const sizeSelect = document.createElement('select');
  sizeSelect.className = 'pagination-size-select';
  for (const size of [25, 50, 100]) {
    const opt = document.createElement('option');
    opt.value = size;
    opt.textContent = size;
    if (size === limit) opt.selected = true;
    sizeSelect.appendChild(opt);
  }
  sizeSelect.addEventListener('change', () => onPageSizeChange(Number(sizeSelect.value)));
  wrapper.appendChild(sizeSelect);

  container.appendChild(wrapper);
}

// --- Lazy avatar loading ---
const _avatarObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      const img = entry.target;
      if (img.dataset.src) {
        img.src = img.dataset.src;
        delete img.dataset.src;
      }
      _avatarObserver.unobserve(img);
    }
  }
}, { rootMargin: '200px' });

function observeLazyAvatars(container) {
  const images = (container || document).querySelectorAll('img[data-src]');
  for (const img of images) {
    _avatarObserver.observe(img);
  }
}

const AVATAR_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="%23e2e8f0" rx="16"/><text x="16" y="20" text-anchor="middle" fill="%2394a3b8" font-size="14" font-family="sans-serif">?</text></svg>');

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
