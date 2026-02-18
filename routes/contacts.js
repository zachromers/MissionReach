const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/database');
const { generateSingleWarmthScore } = require('../services/aiService');

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

// Shared query builder for contacts list + CSV export
function buildContactQuery(query) {
  const { search, tag, sort, order,
    name_filter, email_filter, phone_filter,
    city, state, organization, relationship,
    outreach_from, outreach_to,
    donation_from, donation_to,
    total_donated_min, total_donated_max,
    has_email, has_phone,
    stale_days, donated_since, contacted_since } = query;

  let sql = `
    SELECT c.*,
      (SELECT MAX(o.date) FROM outreaches o WHERE o.contact_id = c.id) as last_outreach_date,
      (SELECT MAX(d.date) FROM donations d WHERE d.contact_id = c.id) as last_donation_date,
      (SELECT d.amount FROM donations d WHERE d.contact_id = c.id ORDER BY d.date DESC LIMIT 1) as last_donation_amount,
      (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) as total_donated
    FROM contacts c
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    sql += ` AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.organization LIKE ? OR c.phone LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term, term, term);
  }

  if (tag) {
    sql += ` AND (',' || c.tags || ',') LIKE ?`;
    params.push(`%,${tag},%`);
  }

  // Per-column LIKE filters
  if (name_filter) {
    sql += ` AND (c.first_name LIKE ? OR c.last_name LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ?)`;
    const t = `%${name_filter}%`;
    params.push(t, t, t);
  }
  if (email_filter) {
    sql += ` AND c.email LIKE ?`;
    params.push(`%${email_filter}%`);
  }
  if (phone_filter) {
    sql += ` AND c.phone LIKE ?`;
    params.push(`%${phone_filter}%`);
  }
  if (city) {
    sql += ` AND c.city LIKE ?`;
    params.push(`%${city}%`);
  }
  if (state) {
    sql += ` AND c.state LIKE ?`;
    params.push(`%${state}%`);
  }
  if (organization) {
    sql += ` AND c.organization LIKE ?`;
    params.push(`%${organization}%`);
  }
  if (relationship) {
    sql += ` AND c.relationship LIKE ?`;
    params.push(`%${relationship}%`);
  }

  // Boolean filters
  if (has_email === '1') {
    sql += ` AND c.email IS NOT NULL AND c.email != ''`;
  } else if (has_email === '0') {
    sql += ` AND (c.email IS NULL OR c.email = '')`;
  }
  if (has_phone === '1') {
    sql += ` AND c.phone IS NOT NULL AND c.phone != ''`;
  } else if (has_phone === '0') {
    sql += ` AND (c.phone IS NULL OR c.phone = '')`;
  }

  // Stale contacts: no outreach in the last N days (or never contacted)
  if (stale_days) {
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM outreaches o WHERE o.contact_id = c.id
      AND o.date >= datetime('now', '-' || ? || ' days')
    )`;
    params.push(Number(stale_days));
  }

  // Donated since a given date (any donation, not just the latest)
  if (donated_since) {
    sql += ` AND EXISTS (SELECT 1 FROM donations d WHERE d.contact_id = c.id AND d.date >= ?)`;
    params.push(donated_since);
  }

  // Contacted since a given date (any outreach)
  if (contacted_since) {
    sql += ` AND EXISTS (SELECT 1 FROM outreaches o WHERE o.contact_id = c.id AND o.date >= ?)`;
    params.push(contacted_since);
  }

  // Date range filters (on computed subqueries via HAVING-style re-filter)
  if (outreach_from) {
    sql += ` AND (SELECT MAX(o.date) FROM outreaches o WHERE o.contact_id = c.id) >= ?`;
    params.push(outreach_from);
  }
  if (outreach_to) {
    sql += ` AND (SELECT MAX(o.date) FROM outreaches o WHERE o.contact_id = c.id) <= ?`;
    params.push(outreach_to);
  }
  if (donation_from) {
    sql += ` AND (SELECT MAX(d.date) FROM donations d WHERE d.contact_id = c.id) >= ?`;
    params.push(donation_from);
  }
  if (donation_to) {
    sql += ` AND (SELECT MAX(d.date) FROM donations d WHERE d.contact_id = c.id) <= ?`;
    params.push(donation_to);
  }

  // Numeric range on total donated
  if (total_donated_min) {
    sql += ` AND (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) >= ?`;
    params.push(Number(total_donated_min));
  }
  if (total_donated_max) {
    sql += ` AND (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) <= ?`;
    params.push(Number(total_donated_max));
  }

  const allowedSorts = ['first_name', 'last_name', 'email', 'created_at', 'last_outreach_date', 'last_donation_date', 'total_donated', 'city', 'state', 'organization', 'relationship', 'phone'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'last_name';
  const sortOrder = order === 'desc' ? 'DESC' : 'ASC';
  sql += ` ORDER BY ${sortCol} ${sortOrder}`;

  return { sql, params };
}

// GET /api/contacts/export/csv — MUST be before /:id
router.get('/export/csv', (req, res) => {
  try {
    const db = getDb();
    const { sql, params } = buildContactQuery(req.query);
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
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contacts — list all, with search/tag/sort/filters
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { sql, params } = buildContactQuery(req.query);
    const contacts = db.prepare(sql).all(...params);
    res.json(contacts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contacts/:id — single contact with history
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    contact.outreaches = db.prepare('SELECT * FROM outreaches WHERE contact_id = ? ORDER BY date DESC').all(req.params.id);
    contact.donations = db.prepare('SELECT * FROM donations WHERE contact_id = ? ORDER BY date DESC').all(req.params.id);

    res.json(contact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contacts — create
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, country, organization, relationship, notes, tags } = req.body;

    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'first_name and last_name are required' });
    }

    // Generate default avatar URL
    const bg = ['4f46e5','7c3aed','2563eb','0891b2','059669','d97706','dc2626','be185d'][Math.floor(Math.random() * 8)];
    const defaultPhoto = `https://ui-avatars.com/api/?name=${encodeURIComponent(first_name)}+${encodeURIComponent(last_name)}&background=${bg}&color=fff&size=128&bold=true`;

    const result = db.prepare(`
      INSERT INTO contacts (first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, country, organization, relationship, notes, tags, photo_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(first_name, last_name, email || null, phone || null, address_line1 || null, address_line2 || null, city || null, state || null, zip || null, country || 'US', organization || null, relationship || null, notes || null, tags || null, defaultPhoto);

    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(contact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/contacts/:id — update
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    const fields = ['first_name', 'last_name', 'email', 'phone', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'country', 'organization', 'relationship', 'notes', 'tags', 'photo_url'];
    const updates = [];
    const params = [];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);

    db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    res.json(contact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    db.prepare('DELETE FROM outreaches WHERE contact_id = ?').run(req.params.id);
    db.prepare('DELETE FROM donations WHERE contact_id = ?').run(req.params.id);
    db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);

    res.json({ message: 'Contact deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Nested donation routes ---

// GET /api/contacts/:id/donations
router.get('/:id/donations', (req, res) => {
  try {
    const db = getDb();
    const donations = db.prepare('SELECT * FROM donations WHERE contact_id = ? ORDER BY date DESC').all(req.params.id);
    res.json(donations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contacts/:id/donations
router.post('/:id/donations', (req, res) => {
  try {
    const db = getDb();
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const { amount, date, method, recurring, notes } = req.body;
    if (!amount || !date) return res.status(400).json({ error: 'amount and date are required' });

    const result = db.prepare(
      'INSERT INTO donations (contact_id, amount, date, method, recurring, notes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.params.id, amount, date, method || null, recurring ? 1 : 0, notes || null);

    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(result.lastInsertRowid);
    // Fire-and-forget warmth score update
    generateSingleWarmthScore(req.params.id).catch(() => {});
    res.status(201).json(donation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Nested outreach routes ---

// GET /api/contacts/:id/outreaches
router.get('/:id/outreaches', (req, res) => {
  try {
    const db = getDb();
    const outreaches = db.prepare('SELECT * FROM outreaches WHERE contact_id = ? ORDER BY date DESC').all(req.params.id);
    res.json(outreaches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contacts/:id/outreaches
router.post('/:id/outreaches', (req, res) => {
  try {
    const db = getDb();
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const { mode, direction, subject, content, date, ai_generated, status } = req.body;
    if (!mode) return res.status(400).json({ error: 'mode is required' });

    const result = db.prepare(
      'INSERT INTO outreaches (contact_id, mode, direction, subject, content, date, ai_generated, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      req.params.id, mode, direction || 'outgoing', subject || null, content || null,
      date || new Date().toISOString(), ai_generated ? 1 : 0, status || 'completed'
    );

    const outreach = db.prepare('SELECT * FROM outreaches WHERE id = ?').get(result.lastInsertRowid);
    // Fire-and-forget warmth score update
    generateSingleWarmthScore(req.params.id).catch(() => {});
    res.status(201).json(outreach);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contacts/:id/photo — upload a photo
router.post('/:id/photo', photoUpload.single('photo'), (req, res) => {
  try {
    const db = getDb();
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    if (!req.file) return res.status(400).json({ error: 'No photo file provided' });

    // Delete old uploaded photo if it exists (don't delete external URLs)
    const oldUrl = contact.photo_url || '';
    if (oldUrl.endsWith && (oldUrl.startsWith('/uploads/photos/') || oldUrl.startsWith('uploads/photos/'))) {
      const oldPath = path.join(__dirname, '..', 'public', oldUrl.replace(/^\//, ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const photoUrl = `uploads/photos/${req.file.filename}`;
    db.prepare('UPDATE contacts SET photo_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(photoUrl, req.params.id);

    const updated = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
