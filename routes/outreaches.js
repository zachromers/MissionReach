const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// POST /api/contacts/:contactId/outreaches
router.post('/contacts/:contactId/outreaches', (req, res) => {
  try {
    const db = getDb();
    const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.contactId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const { mode, direction, subject, content, date, ai_generated, status } = req.body;
    if (!mode) return res.status(400).json({ error: 'mode is required' });

    const result = db.prepare(
      'INSERT INTO outreaches (contact_id, mode, direction, subject, content, date, ai_generated, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      req.params.contactId, mode, direction || 'outgoing', subject || null, content || null,
      date || new Date().toISOString(), ai_generated ? 1 : 0, status || 'completed'
    );

    const outreach = db.prepare('SELECT * FROM outreaches WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(outreach);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contacts/:contactId/outreaches
router.get('/contacts/:contactId/outreaches', (req, res) => {
  try {
    const db = getDb();
    const outreaches = db.prepare('SELECT * FROM outreaches WHERE contact_id = ? ORDER BY date DESC').all(req.params.contactId);
    res.json(outreaches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/outreaches/:id
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM outreaches WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Outreach not found' });

    const fields = ['mode', 'direction', 'subject', 'content', 'date', 'ai_generated', 'status'];
    const updates = [];
    const params = [];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(field === 'ai_generated' ? (req.body[field] ? 1 : 0) : req.body[field]);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id);
    db.prepare(`UPDATE outreaches SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const outreach = db.prepare('SELECT * FROM outreaches WHERE id = ?').get(req.params.id);
    res.json(outreach);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/outreaches/:id
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM outreaches WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Outreach not found' });

    db.prepare('DELETE FROM outreaches WHERE id = ?').run(req.params.id);
    res.json({ message: 'Outreach deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
