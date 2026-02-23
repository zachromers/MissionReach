const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/database');
const { getJwtSecret, requireAuth, requirePasswordChanged } = require('../middleware/auth');
const { logger } = require('../middleware/logger');

// Input sanitization helpers
function stripHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
}
function validateUsername(u) {
  return /^[a-zA-Z0-9_.-]+$/.test(u);
}

const TOKEN_EXPIRY = '7d';
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV !== 'development',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const username = stripHtml(req.body.username);
    const password = req.body.password;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);

    // Always run bcrypt compare to prevent timing-based user enumeration
    const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) {
      // Record login failure
      try {
        db.prepare('INSERT INTO audit_log (user_id, actor_id, action, detail, ip_address) VALUES (?, NULL, ?, ?, ?)').run(
          user ? user.id : null, 'login_failure', JSON.stringify({ username }), req.ip
        );
      } catch (_) {}
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Record login success
    try {
      db.prepare('INSERT INTO audit_log (user_id, actor_id, action, ip_address) VALUES (?, ?, ?, ?)').run(
        user.id, user.id, 'login_success', req.ip
      );
    } catch (_) {}

    const secret = getJwtSecret();
    const token = jwt.sign(
      { userId: user.id, tokenVersion: user.token_version || 0 },
      secret,
      { expiresIn: TOKEN_EXPIRY, algorithm: 'HS256' }
    );

    logger.info('user_login', { userId: user.id, username: user.username, requestId: req.requestId });

    res.cookie('token', token, COOKIE_OPTIONS);
    res.json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      email: user.email || null,
      role: user.role,
      must_change_password: !!user.must_change_password,
    });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// GET /api/auth/registration-status — check if self-registration is enabled (public)
router.get('/registration-status', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE user_id = 0 AND key = 'allow_registration'").get();
    res.json({ allowed: row ? row.value === '1' : false });
  } catch (err) {
    res.json({ allowed: false });
  }
});

// POST /api/auth/register — self-registration (public, must be enabled by admin)
router.post('/register', async (req, res) => {
  try {
    // Check if self-registration is enabled
    const db = getDb();
    const regSetting = db.prepare("SELECT value FROM settings WHERE user_id = 0 AND key = 'allow_registration'").get();
    if (!regSetting || regSetting.value !== '1') {
      return res.status(403).json({ error: 'Self-registration is disabled. Contact an administrator.' });
    }

    const username = stripHtml(req.body.username);
    const email = stripHtml(req.body.email);
    const display_name = stripHtml(req.body.display_name);
    const { password, confirm_password } = req.body;

    if (!username || !email || !display_name || !password || !confirm_password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (username.length > 64 || email.length > 255 || display_name.length > 128) {
      return res.status(400).json({ error: 'Input exceeds maximum length' });
    }

    if (!validateUsername(username)) {
      return res.status(400).json({ error: 'Username may only contain letters, numbers, underscores, hyphens, and dots' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    // Check username uniqueness
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Check email uniqueness
    const existingEmail = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
    if (existingEmail) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, display_name, email, role, must_change_password) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(username, hash, display_name, email, 'user');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

    const secret = getJwtSecret();
    const token = jwt.sign(
      { userId: user.id, tokenVersion: user.token_version || 0 },
      secret,
      { expiresIn: TOKEN_EXPIRY, algorithm: 'HS256' }
    );

    logger.info('user_registered', { userId: user.id, username: user.username, requestId: req.requestId });

    res.cookie('token', token, COOKIE_OPTIONS);
    res.status(201).json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
      must_change_password: false,
    });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', COOKIE_OPTIONS);
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me — check current session
router.get('/me', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      email: user.email || null,
      role: user.role,
      must_change_password: !!user.must_change_password,
    });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// PUT /api/auth/password — change own password
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    // Increment token_version to invalidate all existing tokens
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, req.user.id);

    // Issue a new token with the updated token_version
    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const secret = getJwtSecret();
    const newToken = jwt.sign(
      { userId: updatedUser.id, tokenVersion: updatedUser.token_version },
      secret,
      { expiresIn: TOKEN_EXPIRY, algorithm: 'HS256' }
    );
    res.cookie('token', newToken, COOKIE_OPTIONS);

    // Record password change in audit log
    try {
      db.prepare('INSERT INTO audit_log (user_id, actor_id, action, ip_address) VALUES (?, ?, ?, ?)').run(
        req.user.id, req.user.id, 'password_changed', req.ip
      );
    } catch (_) {}

    logger.info('password_changed', { userId: req.user.id, requestId: req.requestId });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// GET /api/auth/ai-history — paginated list of user's own AI prompts
router.get('/ai-history', requireAuth, requirePasswordChanged, (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as count FROM ai_prompts WHERE user_id = ?').get(req.user.id).count;
    const prompts = db.prepare('SELECT * FROM ai_prompts WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(req.user.id, limit, offset);

    res.json({
      prompts,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

// DELETE /api/auth/account — self-deletion with cascade
router.delete('/account', requireAuth, requirePasswordChanged, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required to confirm account deletion' });
    }

    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admin accounts cannot be self-deleted. Another admin must remove your account.' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Password is incorrect' });
    }

    // Cascade delete all user data
    db.prepare('DELETE FROM outreaches WHERE contact_id IN (SELECT id FROM contacts WHERE user_id = ?)').run(req.user.id);
    db.prepare('DELETE FROM donations WHERE contact_id IN (SELECT id FROM contacts WHERE user_id = ?)').run(req.user.id);
    db.prepare('DELETE FROM contacts WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM ai_prompts WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM settings WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM gmail_tokens WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);

    logger.info('account_deleted', { userId: req.user.id, username: user.username, requestId: req.requestId });

    res.clearCookie('token', COOKIE_OPTIONS);
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

module.exports = router;
