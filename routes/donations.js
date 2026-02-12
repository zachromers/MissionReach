const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /api/contacts/:id/donations — mounted at /api/donations but we handle contact-scoped routes in contacts router
// This router handles /api/donations/:id and /api/contacts/:contactId/donations

// POST /api/contacts/:contactId/donations — add donation (mounted via contacts prefix)
router.post('/contacts/:contactId/donations', (req, res) => {
  try {
    const db = getDb();
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.contactId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const { amount, date, method, recurring, notes } = req.body;
    if (!amount || !date) return res.status(400).json({ error: 'amount and date are required' });

    const result = db.prepare(
      'INSERT INTO donations (contact_id, amount, date, method, recurring, notes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.params.contactId, amount, date, method || null, recurring ? 1 : 0, notes || null);

    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(donation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contacts/:contactId/donations
router.get('/contacts/:contactId/donations', (req, res) => {
  try {
    const db = getDb();
    const donations = db.prepare('SELECT * FROM donations WHERE contact_id = ? ORDER BY date DESC').all(req.params.contactId);
    res.json(donations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/donations/:id
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Donation not found' });

    const fields = ['amount', 'date', 'method', 'recurring', 'notes'];
    const updates = [];
    const params = [];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(field === 'recurring' ? (req.body[field] ? 1 : 0) : req.body[field]);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id);
    db.prepare(`UPDATE donations SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
    res.json(donation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/donations/:id
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Donation not found' });

    db.prepare('DELETE FROM donations WHERE id = ?').run(req.params.id);
    res.json({ message: 'Donation deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
