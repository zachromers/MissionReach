const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { validateDonation, sanitizeDonationFields } = require('../middleware/validate');

// GET /api/contacts/:id/donations — mounted at /api/donations but we handle contact-scoped routes in contacts router
// This router handles /api/donations/:id and /api/contacts/:contactId/donations

// POST /api/contacts/:contactId/donations — add donation (mounted via contacts prefix)
router.post('/contacts/:contactId/donations', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ? AND user_id = ?').get(req.params.contactId, userId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const errors = validateDonation(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const sanitized = sanitizeDonationFields(req.body);
    const { amount, date, method, recurring, notes } = sanitized;

    const result = db.prepare(
      'INSERT INTO donations (contact_id, amount, date, method, recurring, notes, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.params.contactId, amount, date, method || null, recurring ? 1 : 0, notes || null, userId);

    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(donation);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// GET /api/contacts/:contactId/donations
router.get('/contacts/:contactId/donations', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ? AND user_id = ?').get(req.params.contactId, userId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const donations = db.prepare('SELECT * FROM donations WHERE contact_id = ? ORDER BY date DESC').all(req.params.contactId);
    res.json(donations);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// PUT /api/donations/:id
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const existing = db.prepare('SELECT * FROM donations WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!existing) return res.status(404).json({ error: 'Donation not found' });

    // Validate provided fields (merge with existing for required field checks)
    const merged = { amount: existing.amount, date: existing.date, ...req.body };
    const errors = validateDonation(merged);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const sanitized = sanitizeDonationFields(req.body);
    const fields = ['amount', 'date', 'method', 'recurring', 'notes'];
    const updates = [];
    const params = [];

    for (const field of fields) {
      if (sanitized[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(field === 'recurring' ? (sanitized[field] ? 1 : 0) : sanitized[field]);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id, userId);
    db.prepare(`UPDATE donations SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);

    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
    res.json(donation);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// DELETE /api/donations/:id
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const existing = db.prepare('SELECT * FROM donations WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!existing) return res.status(404).json({ error: 'Donation not found' });

    db.prepare('DELETE FROM donations WHERE id = ? AND user_id = ?').run(req.params.id, userId);
    res.json({ message: 'Donation deleted' });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

module.exports = router;
