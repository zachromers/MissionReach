const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

// All admin routes require admin role (requireAuth is applied at server level)
router.use(requireAdmin);

// GET /api/admin/users — list all users
router.get('/users', (req, res) => {
  try {
    const db = getDb();
    const users = db.prepare('SELECT id, username, display_name, role, created_at, updated_at FROM users ORDER BY id').all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users — create a user
router.post('/users', (req, res) => {
  try {
    const { username, display_name, role } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const DEFAULT_PASSWORD = 'password123';
    const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
    const validRole = role === 'admin' ? 'admin' : 'user';
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, display_name, role, must_change_password) VALUES (?, ?, ?, ?, 1)'
    ).run(username, hash, display_name || null, validRole);

    const user = db.prepare('SELECT id, username, display_name, role, created_at, updated_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id — update a user
router.put('/users/:id', (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { username, password, display_name, role } = req.body;

    if (username && username !== user.username) {
      const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(username, req.params.id);
      if (existing) {
        return res.status(409).json({ error: 'Username already exists' });
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
      params.push(bcrypt.hashSync(password, 10));
      // Force user to change password on next login
      updates.push('must_change_password = 1');
    }
    if (display_name !== undefined) {
      updates.push('display_name = ?');
      params.push(display_name || null);
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

    const updated = db.prepare('SELECT id, username, display_name, role, created_at, updated_at FROM users WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    res.json({ message: 'User and all associated data deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
