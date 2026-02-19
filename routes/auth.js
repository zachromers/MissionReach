const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/database');
const { getJwtSecret, requireAuth } = require('../middleware/auth');
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
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PRODUCTION,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const username = stripHtml(req.body.username);
    const password = req.body.password;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

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

// POST /api/auth/register — self-registration (public)
router.post('/register', (req, res) => {
  try {
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

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    if (password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const db = getDb();

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

    const hash = bcrypt.hashSync(password, 10);
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
router.put('/password', requireAuth, (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    const valid = bcrypt.compareSync(current_password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = bcrypt.hashSync(new_password, 10);
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

    logger.info('password_changed', { userId: req.user.id, requestId: req.requestId });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  }
});

module.exports = router;
