const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /api/settings
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM settings').all();
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
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    const allowed = ['missionary_name', 'missionary_context', 'default_stale_days', 'anthropic_api_key'];
    const transaction = db.transaction((data) => {
      for (const [key, value] of Object.entries(data)) {
        if (allowed.includes(key)) {
          upsert.run(key, value);
        }
      }
    });

    transaction(req.body);
    res.json({ message: 'Settings updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
