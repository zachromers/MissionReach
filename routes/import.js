const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { parseFile, autoDetectMapping, applyMapping } = require('../services/importService');
const { validateContact, sanitizeContactFields } = require('../middleware/validate');

// Server-side store for uploaded file paths — keyed by opaque token.
// Prevents clients from supplying arbitrary file paths (path traversal).
const pendingUploads = new Map();
const UPLOAD_TTL_MS = 30 * 60 * 1000; // 30 minutes

function storeUploadPath(filePath) {
  const token = crypto.randomBytes(24).toString('hex');
  pendingUploads.set(token, { filePath, createdAt: Date.now() });
  return token;
}

function consumeUploadPath(token) {
  const entry = pendingUploads.get(token);
  if (!entry) return null;
  pendingUploads.delete(token);
  return entry.filePath;
}

// Periodically clean up expired tokens
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of pendingUploads) {
    if (now - entry.createdAt > UPLOAD_TTL_MS) {
      // Clean up the file if it still exists
      try { fs.unlinkSync(entry.filePath); } catch {}
      pendingUploads.delete(token);
    }
  }
}, 5 * 60 * 1000).unref();

const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.xlsx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and XLSX files are supported'));
    }
  }
});

// POST /api/import/preview
router.post('/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Rename file to keep its extension
    const ext = path.extname(req.file.originalname).toLowerCase();
    const newPath = req.file.path + ext;
    fs.renameSync(req.file.path, newPath);

    const { headers, rows } = await parseFile(newPath);
    const mapping = autoDetectMapping(headers);
    const previewRows = rows.slice(0, 5);

    // Store path server-side and return an opaque token to the client
    const fileToken = storeUploadPath(newPath);

    res.json({
      fileToken,
      fileName: req.file.originalname,
      headers,
      mapping,
      previewRows,
      totalRows: rows.length,
    });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// Check a single contact for duplicates against existing DB contacts
function findDuplicatesForContact(db, contact, userId) {
  const duplicates = new Map(); // id -> { contact, reasons[] }

  // 1. Name match (case-insensitive)
  if (contact.first_name && contact.last_name) {
    const rows = db.prepare(
      `SELECT * FROM contacts WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) AND user_id = ?`
    ).all(contact.first_name.trim(), contact.last_name.trim(), userId);
    for (const r of rows) {
      if (!duplicates.has(r.id)) duplicates.set(r.id, { contact: r, reasons: [] });
      duplicates.get(r.id).reasons.push('name');
    }
  }

  // 2. Email match (case-insensitive, non-empty only)
  if (contact.email && contact.email.trim()) {
    const rows = db.prepare(
      `SELECT * FROM contacts WHERE LOWER(email) = LOWER(?) AND email IS NOT NULL AND email != '' AND user_id = ?`
    ).all(contact.email.trim(), userId);
    for (const r of rows) {
      if (!duplicates.has(r.id)) duplicates.set(r.id, { contact: r, reasons: [] });
      duplicates.get(r.id).reasons.push('email');
    }
  }

  // 3. Phone match (using normalize_phone)
  if (contact.phone && contact.phone.trim()) {
    const normalized = contact.phone.replace(/\D/g, '');
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
  if (contact.address_line1 && contact.address_line1.trim()) {
    const rows = db.prepare(
      `SELECT * FROM contacts WHERE LOWER(address_line1) = LOWER(?) AND address_line1 IS NOT NULL AND address_line1 != '' AND user_id = ?`
    ).all(contact.address_line1.trim(), userId);
    for (const r of rows) {
      if (!duplicates.has(r.id)) duplicates.set(r.id, { contact: r, reasons: [] });
      duplicates.get(r.id).reasons.push('address');
    }
  }

  return Array.from(duplicates.values());
}

// Insert contacts into the database and merge their tags
function insertContacts(db, contacts, userId) {
  const insert = db.prepare(`
    INSERT INTO contacts (first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, country, organization, relationship, notes, tags, user_id)
    VALUES (@first_name, @last_name, @email, @phone, @address_line1, @address_line2, @city, @state, @zip, @country, @organization, @relationship, @notes, @tags, @user_id)
  `);

  const insertMany = db.transaction((rows) => {
    for (const contact of rows) {
      insert.run({
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email || null,
        phone: contact.phone || null,
        address_line1: contact.address_line1 || null,
        address_line2: contact.address_line2 || null,
        city: contact.city || null,
        state: contact.state || null,
        zip: contact.zip || null,
        country: contact.country || 'US',
        organization: contact.organization || null,
        relationship: contact.relationship || null,
        notes: contact.notes || null,
        tags: contact.tags || null,
        user_id: userId,
      });
    }
  });

  insertMany(contacts);
  mergeTags(db, contacts, userId);
}

// Merge tags from contacts into the user's available_tags setting
function mergeTags(db, contacts, userId) {
  try {
    const tagSet = new Set();
    for (const c of contacts) {
      if (c.tags) {
        c.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
      }
    }
    if (tagSet.size > 0) {
      const existingRow = db.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'available_tags'").get(userId);
      const existing = existingRow ? JSON.parse(existingRow.value) : [];
      const merged = new Map();
      for (const t of existing) merged.set(t.toLowerCase(), t);
      for (const t of tagSet) {
        if (!merged.has(t.toLowerCase())) merged.set(t.toLowerCase(), t);
      }
      const sorted = Array.from(merged.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      db.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'available_tags', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").run(userId, JSON.stringify(sorted));
    }
  } catch (tagErr) {
    console.error('Warning: failed to merge imported tags:', tagErr.message);
  }
}

// POST /api/import/execute
router.post('/execute', async (req, res) => {
  try {
    const { fileToken, mapping } = req.body;
    const userId = req.user.id;

    if (!fileToken || !mapping) {
      return res.status(400).json({ error: 'fileToken and mapping are required' });
    }

    // Look up the real path from the server-side store — never trust client paths
    const filePath = consumeUploadPath(fileToken);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(400).json({ error: 'Uploaded file not found or expired. Please re-upload.' });
    }

    const { rows } = await parseFile(filePath);
    const result = applyMapping(rows, mapping);

    const db = getDb();

    // Check each contact for duplicates against existing DB contacts
    const cleanContacts = [];
    const duplicateEntries = [];

    for (const contact of result.contacts) {
      const matches = findDuplicatesForContact(db, contact, userId);
      if (matches.length > 0) {
        duplicateEntries.push({ contact, matches });
      } else {
        cleanContacts.push(contact);
      }
    }

    // Insert only non-duplicate contacts
    if (cleanContacts.length > 0) {
      insertContacts(db, cleanContacts, userId);
    }

    // Clean up uploaded file
    try { fs.unlinkSync(filePath); } catch {}

    res.json({
      imported: cleanContacts.length,
      skipped: result.skipped,
      errors: result.errors,
      duplicates: duplicateEntries,
    });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// POST /api/import/force — import contacts that the user confirmed despite duplicates
router.post('/force', (req, res) => {
  try {
    const { contacts } = req.body;
    const userId = req.user.id;

    if (!contacts || !contacts.length) {
      return res.json({ imported: 0 });
    }

    // Validate and sanitize each contact before insertion
    const validContacts = [];
    const errors = [];
    for (let i = 0; i < contacts.length; i++) {
      const validationErrors = validateContact(contacts[i]);
      if (validationErrors.length > 0) {
        errors.push(`Contact ${i + 1}: ${validationErrors.join('; ')}`);
        continue;
      }
      validContacts.push(sanitizeContactFields(contacts[i]));
    }

    const db = getDb();
    if (validContacts.length > 0) {
      insertContacts(db, validContacts, userId);
    }

    res.json({ imported: validContacts.length, errors });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

module.exports = router;
