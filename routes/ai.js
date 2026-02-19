const express = require('express');
const router = express.Router();
const { processPrompt, generateWarmthScores, generateOutreachDraft } = require('../services/aiService');
const { getDb } = require('../db/database');

// POST /api/ai/prompt
router.post('/prompt', async (req, res) => {
  try {
    const { prompt, excludeIds } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const result = await processPrompt(prompt, excludeIds || [], req.user.id);
    res.json(result);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// GET /api/ai/stats — dashboard stats
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    const totalContacts = db.prepare('SELECT COUNT(*) as cnt FROM contacts WHERE user_id = ?').get(userId).cnt;

    const rows = db.prepare('SELECT * FROM settings WHERE user_id = ?').all(userId);
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    const staleDays = parseInt(settings.default_stale_days) || 90;

    const staleContacts = db.prepare(`
      SELECT COUNT(*) as cnt FROM contacts c
      WHERE c.user_id = ? AND NOT EXISTS (
        SELECT 1 FROM outreaches o WHERE o.contact_id = c.id
        AND o.date >= datetime('now', '-' || ? || ' days')
      )
    `).get(userId, staleDays).cnt;

    const currentYear = new Date().getFullYear();
    const ytdDonations = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM donations
      WHERE user_id = ? AND date >= ?
    `).get(userId, `${currentYear}-01-01`).total;

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const outreachesThisMonth = db.prepare(`
      SELECT COUNT(*) as cnt FROM outreaches WHERE user_id = ? AND date >= ?
    `).get(userId, monthStart).cnt;

    res.json({
      totalContacts,
      staleContacts,
      ytdDonations,
      outreachesThisMonth,
      staleDays,
    });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// POST /api/ai/warmth-scores — batch update warmth scores
router.post('/warmth-scores', async (req, res) => {
  try {
    const result = await generateWarmthScores({ userId: req.user.id });
    res.json(result);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// POST /api/ai/warmth-scores/recalculate-all — recalculate all warmth scores
router.post('/warmth-scores/recalculate-all', async (req, res) => {
  try {
    const result = await generateWarmthScores({ forceAll: true, userId: req.user.id });
    res.json(result);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// POST /api/ai/generate-outreach/:contactId — generate outreach draft for a single contact
router.post('/generate-outreach/:contactId', async (req, res) => {
  try {
    const { mode } = req.body;
    const result = await generateOutreachDraft(parseInt(req.params.contactId), mode || 'email', req.user.id);
    res.json(result);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

module.exports = router;
