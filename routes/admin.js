const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { logger } = require('../middleware/logger');

// Input sanitization helpers
function stripHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
}
function validateUsername(u) {
  return /^[a-zA-Z0-9_.-]+$/.test(u);
}

// All admin routes require admin role (requireAuth is applied at server level)
router.use(requireAdmin);

// GET /api/admin/settings/registration — check registration setting
router.get('/settings/registration', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE user_id = 0 AND key = 'allow_registration'").get();
    res.json({ allow_registration: row ? row.value === '1' : false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/settings/registration — toggle registration
router.put('/settings/registration', (req, res) => {
  try {
    const db = getDb();
    const allow = req.body.allow_registration ? '1' : '0';
    db.prepare("INSERT INTO settings (user_id, key, value) VALUES (0, 'allow_registration', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").run(allow);
    logger.info('registration_setting_changed', { adminId: req.user.id, allow_registration: allow === '1', requestId: req.requestId });
    res.json({ allow_registration: allow === '1' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/users — list all users
router.get('/users', (req, res) => {
  try {
    const db = getDb();
    const users = db.prepare('SELECT id, username, display_name, email, role, created_at, updated_at FROM users ORDER BY id').all();
    res.json(users);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// POST /api/admin/users — create a user
router.post('/users', async (req, res) => {
  try {
    const username = stripHtml(req.body.username);
    const email = stripHtml(req.body.email);
    const display_name = stripHtml(req.body.display_name || '');
    const { role } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (username.length > 64 || email.length > 255 || display_name.length > 128) {
      return res.status(400).json({ error: 'Input exceeds maximum length' });
    }

    if (!validateUsername(username)) {
      return res.status(400).json({ error: 'Username may only contain letters, numbers, underscores, hyphens, and dots' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const existingEmail = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
    if (existingEmail) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const DEFAULT_PASSWORD = 'password123';
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const validRole = role === 'admin' ? 'admin' : 'user';
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, display_name, email, role, must_change_password) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(username, hash, display_name || null, email, validRole);

    const user = db.prepare('SELECT id, username, display_name, email, role, created_at, updated_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    logger.info('admin_user_created', { adminId: req.user.id, createdUserId: user.id, username, requestId: req.requestId });
    res.status(201).json(user);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// PUT /api/admin/users/:id — update a user
router.put('/users/:id', async (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const username = req.body.username ? stripHtml(req.body.username) : undefined;
    const email = req.body.email !== undefined ? stripHtml(req.body.email) : undefined;
    const display_name = req.body.display_name !== undefined ? stripHtml(req.body.display_name) : undefined;
    const { password, role } = req.body;

    if (username && username.length > 64) {
      return res.status(400).json({ error: 'Username exceeds maximum length' });
    }
    if (email && email.length > 255) {
      return res.status(400).json({ error: 'Email exceeds maximum length' });
    }
    if (display_name && display_name.length > 128) {
      return res.status(400).json({ error: 'Display name exceeds maximum length' });
    }

    if (username && !validateUsername(username)) {
      return res.status(400).json({ error: 'Username may only contain letters, numbers, underscores, hyphens, and dots' });
    }

    if (username && username !== user.username) {
      const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(username, req.params.id);
      if (existing) {
        return res.status(409).json({ error: 'Username already exists' });
      }
    }

    if (email !== undefined && email !== null && email !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      const existingEmail = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?').get(email, req.params.id);
      if (existingEmail) {
        return res.status(409).json({ error: 'Email already in use' });
      }
    }

    const updates = [];
    const params = [];

    if (username) {
      updates.push('username = ?');
      params.push(username);
    }
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      updates.push('password_hash = ?');
      params.push(await bcrypt.hash(password, 10));
      // Force user to change password on next login and invalidate existing tokens
      updates.push('must_change_password = 1');
      updates.push('token_version = token_version + 1');
    }
    if (display_name !== undefined) {
      updates.push('display_name = ?');
      params.push(display_name || null);
    }
    if (email !== undefined) {
      updates.push('email = ?');
      params.push(email || null);
    }
    if (role) {
      updates.push('role = ?');
      params.push(role === 'admin' ? 'admin' : 'user');
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT id, username, display_name, email, role, created_at, updated_at FROM users WHERE id = ?').get(req.params.id);
    logger.info('admin_user_updated', { adminId: req.user.id, targetUserId: Number(req.params.id), requestId: req.requestId });
    res.json(updated);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// DELETE /api/admin/users/:id — delete a user and all their data
router.delete('/users/:id', (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent deleting yourself
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Delete all user data
    const userId = Number(req.params.id);
    const contacts = db.prepare('SELECT id FROM contacts WHERE user_id = ?').all(userId);
    const contactIds = contacts.map(c => c.id);

    if (contactIds.length > 0) {
      for (const cid of contactIds) {
        db.prepare('DELETE FROM outreaches WHERE contact_id = ?').run(cid);
        db.prepare('DELETE FROM donations WHERE contact_id = ?').run(cid);
      }
      db.prepare(`DELETE FROM contacts WHERE user_id = ?`).run(userId);
    }

    db.prepare('DELETE FROM ai_prompts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM settings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    logger.info('admin_user_deleted', { adminId: req.user.id, deletedUserId: userId, deletedUsername: user.username, requestId: req.requestId });
    res.json({ message: 'User and all associated data deleted' });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

module.exports = router;
