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

    try {
      db.prepare('INSERT INTO audit_log (user_id, actor_id, action, detail, ip_address) VALUES (NULL, ?, ?, ?, ?)').run(
        req.user.id, 'settings_changed', JSON.stringify({ setting: 'allow_registration', value: allow === '1' }), req.ip
      );
    } catch (_) {}

    logger.info('registration_setting_changed', { adminId: req.user.id, allow_registration: allow === '1', requestId: req.requestId });
    res.json({ allow_registration: allow === '1' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/settings/model — check global Claude model setting
router.get('/settings/model', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE user_id = 0 AND key = 'claude_model'").get();
    res.json({ claude_model: row ? row.value : 'sonnet' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/settings/model — set global Claude model
router.put('/settings/model', (req, res) => {
  try {
    const valid = ['haiku', 'sonnet', 'opus'];
    const model = req.body.claude_model;
    if (!valid.includes(model)) {
      return res.status(400).json({ error: 'Invalid model. Must be one of: ' + valid.join(', ') });
    }
    const db = getDb();
    db.prepare("INSERT INTO settings (user_id, key, value) VALUES (0, 'claude_model', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").run(model);

    try {
      db.prepare('INSERT INTO audit_log (user_id, actor_id, action, detail, ip_address) VALUES (NULL, ?, ?, ?, ?)').run(
        req.user.id, 'settings_changed', JSON.stringify({ setting: 'claude_model', value: model }), req.ip
      );
    } catch (_) {}

    logger.info('model_setting_changed', { adminId: req.user.id, claude_model: model, requestId: req.requestId });
    res.json({ claude_model: model });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/users — list all users (with optional search)
router.get('/users', (req, res) => {
  try {
    const db = getDb();
    const search = (req.query.search || '').trim();
    let users;
    if (search) {
      const pattern = `%${search}%`;
      users = db.prepare(
        `SELECT u.id, u.username, u.display_name, u.email, u.role, u.must_change_password, u.created_at, u.updated_at,
                (SELECT MAX(a.created_at) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'login_success') as last_login
         FROM users u
         WHERE u.username LIKE ? OR u.email LIKE ? OR u.display_name LIKE ?
         ORDER BY u.id`
      ).all(pattern, pattern, pattern);
    } else {
      users = db.prepare(
        `SELECT u.id, u.username, u.display_name, u.email, u.role, u.must_change_password, u.created_at, u.updated_at,
                (SELECT MAX(a.created_at) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'login_success') as last_login
         FROM users u ORDER BY u.id`
      ).all();
    }
    res.json(users);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// GET /api/admin/users/:id — single user detail
router.get('/users/:id', (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, username, display_name, email, role, must_change_password, created_at, updated_at FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const loginCount = db.prepare("SELECT COUNT(*) as cnt FROM audit_log WHERE user_id = ? AND action = 'login_success'").get(req.params.id).cnt;
    const lastLogin = db.prepare("SELECT MAX(created_at) as ts FROM audit_log WHERE user_id = ? AND action = 'login_success'").get(req.params.id).ts;
    const contactCount = db.prepare('SELECT COUNT(*) as cnt FROM contacts WHERE user_id = ?').get(req.params.id).cnt;
    const queryCount = db.prepare('SELECT COUNT(*) as cnt FROM ai_prompts WHERE user_id = ?').get(req.params.id).cnt;

    res.json({
      ...user,
      login_count: loginCount,
      last_login: lastLogin,
      contact_count: contactCount,
      query_count: queryCount,
    });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// GET /api/admin/users/:id/audit-log — security events for a user
router.get('/users/:id/audit-log', (req, res) => {
  try {
    const db = getDb();
    const events = db.prepare(
      `SELECT a.*, actor.username as actor_username
       FROM audit_log a
       LEFT JOIN users actor ON actor.id = a.actor_id
       WHERE a.user_id = ? OR a.actor_id = ?
       ORDER BY a.created_at DESC LIMIT 100`
    ).all(req.params.id, req.params.id);
    res.json(events);
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// GET /api/admin/users/:id/query-history — AI prompt history for a user
router.get('/users/:id/query-history', (req, res) => {
  try {
    const db = getDb();
    const prompts = db.prepare(
      'SELECT id, prompt_text, response_summary, created_at FROM ai_prompts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(req.params.id);
    res.json(prompts);
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

    // Audit log: user_created
    try {
      db.prepare('INSERT INTO audit_log (user_id, actor_id, action, detail, ip_address) VALUES (?, ?, ?, ?, ?)').run(
        user.id, req.user.id, 'user_created', JSON.stringify({ username, role: validRole }), req.ip
      );
    } catch (_) {}

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

    // Audit log: user_updated, password_reset_by_admin, role_changed
    try {
      const targetId = Number(req.params.id);
      db.prepare('INSERT INTO audit_log (user_id, actor_id, action, detail, ip_address) VALUES (?, ?, ?, ?, ?)').run(
        targetId, req.user.id, 'user_updated', JSON.stringify({ fields: Object.keys(req.body).filter(k => k !== 'password') }), req.ip
      );
      if (password) {
        db.prepare('INSERT INTO audit_log (user_id, actor_id, action, ip_address) VALUES (?, ?, ?, ?)').run(
          targetId, req.user.id, 'password_reset_by_admin', req.ip
        );
      }
      if (role && role !== user.role) {
        db.prepare('INSERT INTO audit_log (user_id, actor_id, action, detail, ip_address) VALUES (?, ?, ?, ?, ?)').run(
          targetId, req.user.id, 'role_changed', JSON.stringify({ from: user.role, to: role === 'admin' ? 'admin' : 'user' }), req.ip
        );
      }
    } catch (_) {}

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

    // Audit log: user_deleted (record before user data is gone)
    try {
      db.prepare('INSERT INTO audit_log (user_id, actor_id, action, detail, ip_address) VALUES (NULL, ?, ?, ?, ?)').run(
        req.user.id, 'user_deleted', JSON.stringify({ deleted_user_id: userId, username: user.username }), req.ip
      );
    } catch (_) {}

    logger.info('admin_user_deleted', { adminId: req.user.id, deletedUserId: userId, deletedUsername: user.username, requestId: req.requestId });
    res.json({ message: 'User and all associated data deleted' });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

module.exports = router;
