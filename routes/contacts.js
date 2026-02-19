const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/database');
const { generateSingleWarmthScore } = require('../services/aiService');
const { validateContact, sanitizeContactFields, validateDonation, sanitizeDonationFields, validateOutreach, sanitizeOutreachFields } = require('../middleware/validate');
const { logger } = require('../middleware/logger');

// Configure multer for contact photo uploads
const photosDir = path.join(__dirname, '..', 'public', 'uploads', 'photos');
if (!fs.existsSync(photosDir)) {
  fs.mkdirSync(photosDir, { recursive: true });
}

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, photosDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `contact-${req.params.id}-${Date.now()}${ext}`);
  },
});

const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, png, gif, webp) are allowed'));
    }
  },
});

// Validate uploaded file's actual content by checking magic bytes.
// Returns the real image type or null if the bytes don't match any known signature.
function validateImageMagicBytes(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);

  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  // GIF: 47 49 46 38 (GIF8)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  // WebP: RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';

  return null;
}

// Shared query builder for contacts list + CSV export
function buildContactQuery(query, userId, { paginate = true } = {}) {
  const { search, tag, sort, order, page, limit,
    name_filter, email_filter, phone_filter,
    city, state, organization, relationship,
    outreach_from, outreach_to,
    donation_from, donation_to,
    total_donated_min, total_donated_max,
    has_email, has_phone,
    warmth_min, warmth_scores, tags_filter,
    stale_days, donated_since, contacted_since } = query;

  // Build WHERE clause (shared between data + count queries)
  let where = `WHERE c.user_id = ?`;
  const whereParams = [userId];

  if (search) {
    where += ` AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.organization LIKE ? OR c.phone LIKE ?)`;
    const term = `%${search}%`;
    whereParams.push(term, term, term, term, term);
  }

  if (tag) {
    const tags = tag.split(',').map(t => t.trim()).filter(Boolean);
    for (const t of tags) {
      where += ` AND (',' || c.tags || ',') LIKE ?`;
      whereParams.push(`%,${t},%`);
    }
  }

  // Per-column LIKE filters
  if (name_filter) {
    where += ` AND (c.first_name LIKE ? OR c.last_name LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ?)`;
    const t = `%${name_filter}%`;
    whereParams.push(t, t, t);
  }
  if (email_filter) {
    where += ` AND c.email LIKE ?`;
    whereParams.push(`%${email_filter}%`);
  }
  if (phone_filter) {
    where += ` AND c.phone LIKE ?`;
    whereParams.push(`%${phone_filter}%`);
  }
  if (city) {
    where += ` AND c.city LIKE ?`;
    whereParams.push(`%${city}%`);
  }
  if (state) {
    where += ` AND c.state LIKE ?`;
    whereParams.push(`%${state}%`);
  }
  if (organization) {
    where += ` AND c.organization LIKE ?`;
    whereParams.push(`%${organization}%`);
  }
  if (relationship) {
    where += ` AND c.relationship LIKE ?`;
    whereParams.push(`%${relationship}%`);
  }
  if (warmth_scores) {
    const scores = String(warmth_scores).split(',').map(Number).filter(n => n >= 1 && n <= 5);
    if (scores.length > 0) {
      where += ` AND c.warmth_score IN (${scores.map(() => '?').join(',')})`;
      whereParams.push(...scores);
    }
  } else if (warmth_min) {
    where += ` AND c.warmth_score >= ?`;
    whereParams.push(Number(warmth_min));
  }
  if (tags_filter) {
    const filterTags = tags_filter.split(',').map(t => t.trim()).filter(Boolean);
    for (const t of filterTags) {
      where += ` AND (',' || c.tags || ',') LIKE ?`;
      whereParams.push(`%,${t},%`);
    }
  }

  // Boolean filters
  if (has_email === '1') {
    where += ` AND c.email IS NOT NULL AND c.email != ''`;
  } else if (has_email === '0') {
    where += ` AND (c.email IS NULL OR c.email = '')`;
  }
  if (has_phone === '1') {
    where += ` AND c.phone IS NOT NULL AND c.phone != ''`;
  } else if (has_phone === '0') {
    where += ` AND (c.phone IS NULL OR c.phone = '')`;
  }

  // Stale contacts: no outreach in the last N days (or never contacted)
  if (stale_days) {
    where += ` AND NOT EXISTS (
      SELECT 1 FROM outreaches o WHERE o.contact_id = c.id
      AND o.date >= datetime('now', '-' || ? || ' days')
    )`;
    whereParams.push(Number(stale_days));
  }

  // Donated since a given date (any donation, not just the latest)
  if (donated_since) {
    where += ` AND EXISTS (SELECT 1 FROM donations d WHERE d.contact_id = c.id AND d.date >= ?)`;
    whereParams.push(donated_since);
  }

  // Contacted since a given date (any outreach)
  if (contacted_since) {
    where += ` AND EXISTS (SELECT 1 FROM outreaches o WHERE o.contact_id = c.id AND o.date >= ?)`;
    whereParams.push(contacted_since);
  }

  // Date range filters (on computed subqueries via HAVING-style re-filter)
  if (outreach_from) {
    where += ` AND (SELECT MAX(o.date) FROM outreaches o WHERE o.contact_id = c.id) >= ?`;
    whereParams.push(outreach_from);
  }
  if (outreach_to) {
    where += ` AND (SELECT MAX(o.date) FROM outreaches o WHERE o.contact_id = c.id) <= ?`;
    whereParams.push(outreach_to);
  }
  if (donation_from) {
    where += ` AND (SELECT MAX(d.date) FROM donations d WHERE d.contact_id = c.id) >= ?`;
    whereParams.push(donation_from);
  }
  if (donation_to) {
    where += ` AND (SELECT MAX(d.date) FROM donations d WHERE d.contact_id = c.id) <= ?`;
    whereParams.push(donation_to);
  }

  // Numeric range on total donated
  if (total_donated_min) {
    where += ` AND (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) >= ?`;
    whereParams.push(Number(total_donated_min));
  }
  if (total_donated_max) {
    where += ` AND (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) <= ?`;
    whereParams.push(Number(total_donated_max));
  }

  const allowedSorts = ['first_name', 'last_name', 'email', 'created_at', 'last_outreach_date', 'last_donation_date', 'total_donated', 'city', 'state', 'organization', 'relationship', 'phone', 'warmth_score', 'tags'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'last_name';
  const sortOrder = order === 'desc' ? 'DESC' : 'ASC';

  // Count query (cheap — no correlated subqueries)
  const countSql = `SELECT COUNT(*) as total FROM contacts c ${where}`;
  const countParams = [...whereParams];

  // Data query (with correlated subqueries for computed columns)
  let sql = `
    SELECT c.*,
      (SELECT MAX(o.date) FROM outreaches o WHERE o.contact_id = c.id) as last_outreach_date,
      (SELECT MAX(d.date) FROM donations d WHERE d.contact_id = c.id) as last_donation_date,
      (SELECT d.amount FROM donations d WHERE d.contact_id = c.id ORDER BY d.date DESC LIMIT 1) as last_donation_amount,
      (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) as total_donated
    FROM contacts c
    ${where}
    ORDER BY ${sortCol} ${sortOrder}
  `;
  const params = [...whereParams];

  // Pagination
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  if (paginate) {
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, (pageNum - 1) * limitNum);
  }

  return { sql, params, countSql, countParams, pageNum, limitNum };
}

// GET /api/contacts/export/csv — MUST be before /:id
router.get('/export/csv', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const { sql, params } = buildContactQuery(req.query, userId, { paginate: false });
    const contacts = db.prepare(sql).all(...params);

    // Fetch full donation history for all exported contacts
    const donationStmt = db.prepare('SELECT date, amount, method, recurring, notes FROM donations WHERE contact_id = ? ORDER BY date DESC');

    const headers = ['first_name', 'last_name', 'email', 'phone', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'country', 'organization', 'relationship', 'notes', 'tags', 'last_outreach_date', 'last_donation_date', 'last_donation_amount', 'total_donated', 'donation_history'];
    const csvRows = [headers.join(',')];

    for (const c of contacts) {
      const donations = donationStmt.all(c.id);
      c.donation_history = donations.map(d => {
        const parts = [d.date, `$${Number(d.amount).toFixed(2)}`];
        if (d.method) parts.push(d.method);
        if (d.recurring) parts.push('recurring');
        if (d.notes) parts.push(d.notes);
        return parts.join(' | ');
      }).join('; ');

      const row = headers.map(h => {
        const val = c[h] != null ? c[h] : '';
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      csvRows.push(row.join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.send(csvRows.join('\n'));
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// GET /api/contacts — paginated list with search/tag/sort/filters
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const { sql, params, countSql, countParams, pageNum, limitNum } = buildContactQuery(req.query, userId);
    const contacts = db.prepare(sql).all(...params);
    const { total } = db.prepare(countSql).get(...countParams);
    res.json({
      contacts,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// GET /api/contacts/carousel — lightweight endpoint for home page carousel
router.get('/carousel', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const contacts = db.prepare(`
      SELECT id, first_name, last_name, photo_url, warmth_score, warmth_score_reason
      FROM contacts WHERE user_id = ?
      ORDER BY warmth_score DESC
      LIMIT 50
    `).all(userId);
    res.json(contacts);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// GET /api/contacts/find-all-duplicates — scan all contacts for duplicate pairs (SQL-based)
router.get('/find-all-duplicates', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    // Find duplicate pairs using SQL self-joins
    const pairRows = db.prepare(`
      SELECT a.id as id_a, b.id as id_b, 'name' as reason
      FROM contacts a JOIN contacts b ON a.id < b.id
        AND a.user_id = ? AND b.user_id = ?
        AND a.first_name IS NOT NULL AND a.last_name IS NOT NULL
        AND LOWER(a.first_name) = LOWER(b.first_name)
        AND LOWER(a.last_name) = LOWER(b.last_name)
      UNION ALL
      SELECT a.id, b.id, 'email'
      FROM contacts a JOIN contacts b ON a.id < b.id
        AND a.user_id = ? AND b.user_id = ?
        AND a.email IS NOT NULL AND a.email != ''
        AND LOWER(TRIM(a.email)) = LOWER(TRIM(b.email))
      UNION ALL
      SELECT a.id, b.id, 'phone'
      FROM contacts a JOIN contacts b ON a.id < b.id
        AND a.user_id = ? AND b.user_id = ?
        AND normalize_phone(a.phone) IS NOT NULL
        AND normalize_phone(a.phone) = normalize_phone(b.phone)
      UNION ALL
      SELECT a.id, b.id, 'address'
      FROM contacts a JOIN contacts b ON a.id < b.id
        AND a.user_id = ? AND b.user_id = ?
        AND a.address_line1 IS NOT NULL AND a.address_line1 != ''
        AND LOWER(TRIM(a.address_line1)) = LOWER(TRIM(b.address_line1))
    `).all(userId, userId, userId, userId, userId, userId, userId, userId);

    // Group by pair, collect reasons
    const pairMap = new Map();
    for (const row of pairRows) {
      const key = `${row.id_a}-${row.id_b}`;
      if (!pairMap.has(key)) {
        pairMap.set(key, { id_a: row.id_a, id_b: row.id_b, reasons: [] });
      }
      pairMap.get(key).reasons.push(row.reason);
    }

    if (pairMap.size === 0) {
      return res.json({ pairs: [] });
    }

    // Fetch all involved contact records in one query
    const allIds = new Set();
    for (const p of pairMap.values()) {
      allIds.add(p.id_a);
      allIds.add(p.id_b);
    }
    const idList = Array.from(allIds);
    const placeholders = idList.map(() => '?').join(',');
    const contactRows = db.prepare(`SELECT * FROM contacts WHERE id IN (${placeholders})`).all(...idList);
    const contactMap = new Map();
    for (const c of contactRows) contactMap.set(c.id, c);

    const pairs = [];
    for (const p of pairMap.values()) {
      pairs.push({
        contactA: contactMap.get(p.id_a),
        contactB: contactMap.get(p.id_b),
        reasons: p.reasons,
      });
    }

    res.json({ pairs });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// GET /api/contacts/:id — single contact with history
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    contact.outreaches = db.prepare('SELECT * FROM outreaches WHERE contact_id = ? ORDER BY date DESC').all(req.params.id);
    contact.donations = db.prepare('SELECT * FROM donations WHERE contact_id = ? ORDER BY date DESC').all(req.params.id);

    res.json(contact);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// POST /api/contacts/check-duplicates — find potential duplicates before creating
router.post('/check-duplicates', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const { first_name, last_name, email, phone, address_line1 } = req.body;
    const duplicates = new Map(); // id -> { contact, reasons[] }

    // 1. Name match (case-insensitive)
    if (first_name && last_name) {
      const rows = db.prepare(
        `SELECT * FROM contacts WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) AND user_id = ?`
      ).all(first_name.trim(), last_name.trim(), userId);
      for (const r of rows) {
        if (!duplicates.has(r.id)) duplicates.set(r.id, { contact: r, reasons: [] });
        duplicates.get(r.id).reasons.push('name');
      }
    }

    // 2. Email match (case-insensitive, non-empty only)
    if (email && email.trim()) {
      const rows = db.prepare(
        `SELECT * FROM contacts WHERE LOWER(email) = LOWER(?) AND email IS NOT NULL AND email != '' AND user_id = ?`
      ).all(email.trim(), userId);
      for (const r of rows) {
        if (!duplicates.has(r.id)) duplicates.set(r.id, { contact: r, reasons: [] });
        duplicates.get(r.id).reasons.push('email');
      }
    }

    // 3. Phone match (SQL-based using normalize_phone)
    if (phone && phone.trim()) {
      const normalized = phone.replace(/\D/g, '');
      if (normalized.length >= 7) {
        const rows = db.prepare(
          `SELECT * FROM contacts WHERE normalize_phone(phone) = ? AND user_id = ?`
        ).all(normalized, userId);
        for (const r of rows) {
          if (!duplicates.has(r.id)) duplicates.set(r.id, { contact: r, reasons: [] });
          duplicates.get(r.id).reasons.push('phone');
        }
      }
    }

    // 4. Address match (case-insensitive on address_line1, non-empty only)
    if (address_line1 && address_line1.trim()) {
      const rows = db.prepare(
        `SELECT * FROM contacts WHERE LOWER(address_line1) = LOWER(?) AND address_line1 IS NOT NULL AND address_line1 != '' AND user_id = ?`
      ).all(address_line1.trim(), userId);
      for (const r of rows) {
        if (!duplicates.has(r.id)) duplicates.set(r.id, { contact: r, reasons: [] });
        duplicates.get(r.id).reasons.push('address');
      }
    }

    const results = Array.from(duplicates.values());
    res.json({ duplicates: results });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// POST /api/contacts — create
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    const errors = validateContact(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const sanitized = sanitizeContactFields(req.body);
    const { first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, country, organization, relationship, notes, tags } = sanitized;

    // Generate default avatar URL
    const bg = ['4f46e5','7c3aed','2563eb','0891b2','059669','d97706','dc2626','be185d'][Math.floor(Math.random() * 8)];
    const defaultPhoto = `https://ui-avatars.com/api/?name=${encodeURIComponent(first_name)}+${encodeURIComponent(last_name)}&background=${bg}&color=fff&size=128&bold=true`;

    const result = db.prepare(`
      INSERT INTO contacts (first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, country, organization, relationship, notes, tags, photo_url, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(first_name, last_name, email || null, phone || null, address_line1 || null, address_line2 || null, city || null, state || null, zip || null, country || 'US', organization || null, relationship || null, notes || null, tags || null, defaultPhoto, userId);

    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(contact);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// PUT /api/contacts/:id — update
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const existing = db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    const errors = validateContact(req.body, { isUpdate: true });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const sanitized = sanitizeContactFields(req.body);
    // Replace req.body references with sanitized for field extraction
    const fields = ['first_name', 'last_name', 'email', 'phone', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'country', 'organization', 'relationship', 'notes', 'tags', 'photo_url'];
    const updates = [];
    const params = [];

    for (const field of fields) {
      if (sanitized[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(sanitized[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id, userId);

    db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    res.json(contact);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const existing = db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    db.prepare('DELETE FROM outreaches WHERE contact_id = ?').run(req.params.id);
    db.prepare('DELETE FROM donations WHERE contact_id = ?').run(req.params.id);
    db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);

    res.json({ message: 'Contact deleted' });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// --- Nested donation routes ---

// GET /api/contacts/:id/donations
router.get('/:id/donations', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const donations = db.prepare('SELECT * FROM donations WHERE contact_id = ? ORDER BY date DESC').all(req.params.id);
    res.json(donations);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// POST /api/contacts/:id/donations
router.post('/:id/donations', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const errors = validateDonation(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const sanitized = sanitizeDonationFields(req.body);
    const { amount, date, method, recurring, notes } = sanitized;

    const result = db.prepare(
      'INSERT INTO donations (contact_id, amount, date, method, recurring, notes, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.params.id, amount, date, method || null, recurring ? 1 : 0, notes || null, userId);

    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(result.lastInsertRowid);
    // Fire-and-forget warmth score update
    generateSingleWarmthScore(req.params.id, userId).catch(() => {});
    res.status(201).json(donation);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// --- Nested outreach routes ---

// GET /api/contacts/:id/outreaches
router.get('/:id/outreaches', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const outreaches = db.prepare('SELECT * FROM outreaches WHERE contact_id = ? ORDER BY date DESC').all(req.params.id);
    res.json(outreaches);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// POST /api/contacts/:id/outreaches
router.post('/:id/outreaches', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const errors = validateOutreach(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const sanitized = sanitizeOutreachFields(req.body);
    const { mode, direction, subject, content, date, ai_generated, status } = sanitized;

    const result = db.prepare(
      'INSERT INTO outreaches (contact_id, mode, direction, subject, content, date, ai_generated, status, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      req.params.id, mode, direction || 'outgoing', subject || null, content || null,
      date || new Date().toISOString(), ai_generated ? 1 : 0, status || 'completed', userId
    );

    const outreach = db.prepare('SELECT * FROM outreaches WHERE id = ?').get(result.lastInsertRowid);
    // Fire-and-forget warmth score update
    generateSingleWarmthScore(req.params.id, userId).catch(() => {});
    res.status(201).json(outreach);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// POST /api/contacts/:id/photo — upload a photo
router.post('/:id/photo', photoUpload.single('photo'), (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    if (!req.file) return res.status(400).json({ error: 'No photo file provided' });

    // Validate the file's actual content matches a real image format
    const detectedType = validateImageMagicBytes(req.file.path);
    if (!detectedType) {
      // Not a valid image — delete the uploaded file and reject
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'Uploaded file is not a valid image. Only JPEG, PNG, GIF, and WebP are accepted.' });
    }

    // Delete old uploaded photo if it exists (don't delete external URLs)
    const oldUrl = contact.photo_url || '';
    if (oldUrl.endsWith && (oldUrl.startsWith('/uploads/photos/') || oldUrl.startsWith('uploads/photos/'))) {
      const oldPath = path.join(__dirname, '..', 'public', oldUrl.replace(/^\//, ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const photoUrl = `uploads/photos/${req.file.filename}`;
    db.prepare('UPDATE contacts SET photo_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(photoUrl, req.params.id, userId);

    const updated = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

module.exports = router;
