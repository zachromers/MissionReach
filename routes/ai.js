const express = require('express');
const router = express.Router();
const { processPrompt } = require('../services/aiService');
const { getDb } = require('../db/database');

// POST /api/ai/prompt
router.post('/prompt', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const result = await processPrompt(prompt);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/stats — dashboard stats
router.get('/stats', (req, res) => {
  try {
    const db = getDb();

    const totalContacts = db.prepare('SELECT COUNT(*) as cnt FROM contacts').get().cnt;

    const settings = {};
    for (const row of db.prepare('SELECT * FROM settings').all()) {
      settings[row.key] = row.value;
    }
    const staleDays = parseInt(settings.default_stale_days) || 90;

    const staleContacts = db.prepare(`
      SELECT COUNT(*) as cnt FROM contacts c
      WHERE NOT EXISTS (
        SELECT 1 FROM outreaches o WHERE o.contact_id = c.id
        AND o.date >= datetime('now', '-' || ? || ' days')
      )
    `).get(staleDays).cnt;

    const currentYear = new Date().getFullYear();
    const ytdDonations = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM donations
      WHERE date >= ?
    `).get(`${currentYear}-01-01`).total;

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const outreachesThisMonth = db.prepare(`
      SELECT COUNT(*) as cnt FROM outreaches WHERE date >= ?
    `).get(monthStart).cnt;

    res.json({
      totalContacts,
      staleContacts,
      ytdDonations,
      outreachesThisMonth,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
