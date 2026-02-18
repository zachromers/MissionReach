const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /api/settings
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const rows = db.prepare('SELECT * FROM settings WHERE user_id = ?').all(userId);
    const settings = {};
    for (const row of rows) {
      if (row.key === 'anthropic_api_key' && row.value) {
        // Mask API key — show only last 4 characters
        settings[row.key] = row.value.length > 4
          ? '*'.repeat(row.value.length - 4) + row.value.slice(-4)
          : row.value;
      } else {
        settings[row.key] = row.value;
      }
    }
    // Let the frontend know if the API key is provided via environment variable
    settings.api_key_from_env = !!process.env.ANTHROPIC_API_KEY;
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings
router.put('/', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const upsert = db.prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value');

    const allowed = ['missionary_name', 'missionary_context', 'default_stale_days', 'anthropic_api_key', 'claude_model', 'available_tags'];
    const transaction = db.transaction((data) => {
      for (const [key, value] of Object.entries(data)) {
        if (allowed.includes(key)) {
          upsert.run(userId, key, value);
        }
      }
    });

    transaction(req.body);
    res.json({ message: 'Settings updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/tags — return available tags list
router.get('/tags', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const row = db.prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'available_tags'").get(userId);
    const tags = row ? JSON.parse(row.value) : [];
    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/tags — update available tags list
router.put('/tags', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    let tags = req.body.tags;
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: 'tags must be an array' });
    }
    // Deduplicate (case-insensitive) and sort
    const seen = new Map();
    for (const t of tags) {
      const trimmed = String(t).trim();
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        seen.set(trimmed.toLowerCase(), trimmed);
      }
    }
    const sorted = Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    db.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'available_tags', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").run(userId, JSON.stringify(sorted));
    res.json({ tags: sorted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
