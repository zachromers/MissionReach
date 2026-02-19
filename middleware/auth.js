const jwt = require('jsonwebtoken');
const { getDb } = require('../db/database');

function getJwtSecret() {
  const envSecret = process.env.JWT_SECRET;
  if (envSecret) return envSecret;

  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE user_id = 0 AND key = 'jwt_secret'").get();
  if (row) return row.value;

  // Auto-generate and store a secret
  const crypto = require('crypto');
  const secret = crypto.randomBytes(64).toString('hex');
  db.prepare("INSERT INTO settings (user_id, key, value) VALUES (0, 'jwt_secret', ?)").run(secret);
  return secret;
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    const db = getDb();
    const user = db.prepare('SELECT id, username, display_name, role, token_version FROM users WHERE id = ?').get(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check token_version — reject tokens issued before a password change
    if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== user.token_version) {
      return res.status(401).json({ error: 'Token has been invalidated. Please log in again.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, getJwtSecret };
