const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/database');

const SECRET_FILE = path.join(__dirname, '..', '.jwt-secret');

let _cachedSecret = null;

function getJwtSecret() {
  if (_cachedSecret) return _cachedSecret;

  // 1. Environment variable takes priority
  if (process.env.JWT_SECRET) {
    _cachedSecret = process.env.JWT_SECRET;
    return _cachedSecret;
  }

  // 2. Read from dedicated secret file (outside the database)
  if (fs.existsSync(SECRET_FILE)) {
    _cachedSecret = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
    if (_cachedSecret) return _cachedSecret;
  }

  // 3. Migrate from database if a secret was stored there previously
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE user_id = 0 AND key = 'jwt_secret'").get();
    if (row && row.value) {
      _cachedSecret = row.value;
      fs.writeFileSync(SECRET_FILE, _cachedSecret, { mode: 0o600 });
      // Remove from database now that it's in the file
      db.prepare("DELETE FROM settings WHERE user_id = 0 AND key = 'jwt_secret'").run();
      return _cachedSecret;
    }
  } catch {}

  // 4. Generate a new secret and persist to file
  _cachedSecret = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(SECRET_FILE, _cachedSecret, { mode: 0o600 });
  return _cachedSecret;
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
    const user = db.prepare('SELECT id, username, display_name, role, token_version, must_change_password FROM users WHERE id = ?').get(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check token_version — reject tokens issued before a password change
    // Treat missing tokenVersion claim as invalid (legacy tokens before versioning)
    if ((decoded.tokenVersion ?? -1) !== user.token_version) {
      return res.status(401).json({ error: 'Token has been invalidated. Please log in again.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requirePasswordChanged(req, res, next) {
  if (req.user && req.user.must_change_password) {
    return res.status(403).json({ error: 'Password change required before accessing this resource.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requirePasswordChanged, requireAdmin, getJwtSecret };
