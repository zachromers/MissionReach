const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { logger } = require('../middleware/logger');

const DB_PATH = path.join(__dirname, 'missionreach.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const BACKUP_DIR = path.join(__dirname, 'backups');
const MAX_BACKUPS = 5;
const BACKUP_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

let db = null;
let initPromise = null;
let backupTimer = null;

// Wrapper around sql.js statement to provide a better-sqlite3-like API
class StatementWrapper {
  constructor(database, sql, wrapper) {
    this._db = database;
    this._sql = sql;
    this._wrapper = wrapper;
  }

  run(...params) {
    let flatParams;
    if (params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])) {
      // sql.js requires @ prefix on named params; better-sqlite3 does not
      const obj = params[0];
      flatParams = {};
      for (const [k, v] of Object.entries(obj)) {
        flatParams[k.startsWith('@') || k.startsWith('$') || k.startsWith(':') ? k : '@' + k] = v;
      }
    } else {
      flatParams = params;
    }
    this._db.run(this._sql, flatParams);
    const lastId = this._db.exec('SELECT last_insert_rowid() as id')[0];
    const changes = this._db.getRowsModified();
    if (!this._wrapper || !this._wrapper._inTransaction) _debouncedSave();
    return {
      lastInsertRowid: lastId ? lastId.values[0][0] : 0,
      changes,
    };
  }

  get(...params) {
    const flatParams = params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])
      ? params[0]
      : params;
    try {
      const stmt = this._db.prepare(this._sql);
      stmt.bind(flatParams);
      if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        stmt.free();
        const row = {};
        cols.forEach((c, i) => row[c] = vals[i]);
        return row;
      }
      stmt.free();
      return undefined;
    } catch (e) {
      throw e;
    }
  }

  all(...params) {
    const flatParams = params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])
      ? params[0]
      : params;
    try {
      const stmt = this._db.prepare(this._sql);
      stmt.bind(flatParams);
      const results = [];
      while (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        const row = {};
        cols.forEach((c, i) => row[c] = vals[i]);
        results.push(row);
      }
      stmt.free();
      return results;
    } catch (e) {
      throw e;
    }
  }
}

// Database wrapper providing better-sqlite3-like API
class DbWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
    this._inTransaction = false;
  }

  prepare(sql) {
    return new StatementWrapper(this._db, sql, this);
  }

  exec(sql) {
    this._db.run(sql);
    if (!this._inTransaction) _debouncedSave();
  }

  transaction(fn) {
    return (...args) => {
      this._inTransaction = true;
      this._db.run('BEGIN TRANSACTION');
      try {
        fn(...args);
        this._db.run('COMMIT');
        this._inTransaction = false;
        _saveDb();
      } catch (e) {
        this._inTransaction = false;
        try { this._db.run('ROLLBACK'); } catch (_) {}
        throw e;
      }
    };
  }
}

// Debounced save — coalesces rapid writes into a single disk flush
let _saveTimer = null;

function _saveDb() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = null;
  if (db && db._db) {
    const data = db._db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
    // sql.js export() destroys custom function registrations — re-register
    _registerCustomFunctions();
  }
}

function _registerCustomFunctions() {
  if (!db || !db._db) return;
  db._db.create_function('normalize_phone', (phone) => {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 7 ? digits : null;
  });
}

function _debouncedSave() {
  if (_saveTimer) return; // already scheduled
  _saveTimer = setTimeout(_saveDb, 100);
}

// --- Database backup ---

function backupDatabase() {
  if (!fs.existsSync(DB_PATH)) return;

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `missionreach-${timestamp}.db`);
    fs.copyFileSync(DB_PATH, backupPath);
    logger.info('database_backup_created', { path: backupPath });

    // Prune old backups — keep only the most recent MAX_BACKUPS
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('missionreach-') && f.endsWith('.db'))
      .sort()
      .reverse();

    for (let i = MAX_BACKUPS; i < backups.length; i++) {
      const oldPath = path.join(BACKUP_DIR, backups[i]);
      fs.unlinkSync(oldPath);
      logger.debug('old_backup_removed', { path: oldPath });
    }
  } catch (err) {
    logger.error('database_backup_failed', { error: err.message });
  }
}

function startPeriodicBackups() {
  if (backupTimer) return;
  backupDatabase(); // immediate backup on startup
  backupTimer = setInterval(backupDatabase, BACKUP_INTERVAL_MS);
  // Allow process to exit even if timer is pending
  if (backupTimer.unref) backupTimer.unref();
}

// Flush pending writes and close — used for graceful shutdown
function flushAndClose() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (db && db._db) {
    try {
      const data = db._db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
      _registerCustomFunctions();
      logger.info('database_flushed_on_shutdown');
    } catch (err) {
      logger.error('database_flush_failed', { error: err.message });
    }
  }
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}

function _hasColumn(tableName, columnName) {
  try {
    db.prepare(`SELECT ${columnName} FROM ${tableName} LIMIT 1`).get();
    return true;
  } catch (e) {
    return false;
  }
}

// Phone normalization helper (used by duplicate detection routes)
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

async function initialize() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new DbWrapper(new SQL.Database(fileBuffer));
  } else {
    db = new DbWrapper(new SQL.Database());
  }

  // Enable foreign keys
  db._db.run('PRAGMA foreign_keys = ON');

  // Register custom SQL functions (must re-register after every export())
  _registerCustomFunctions();

  // --- Settings table migration (must happen BEFORE schema.sql runs) ---
  // Check if the old settings table exists with single-column primary key
  const needsSettingsMigration = (() => {
    try {
      // If settings table exists but has no user_id column, it's the old format
      db.prepare('SELECT key FROM settings LIMIT 1').get();
      return !_hasColumn('settings', 'user_id');
    } catch (e) {
      return false; // table doesn't exist yet, schema.sql will create it
    }
  })();

  if (needsSettingsMigration) {
    db._db.run('CREATE TABLE settings_v2 (user_id INTEGER NOT NULL DEFAULT 0, key TEXT NOT NULL, value TEXT, PRIMARY KEY (user_id, key))');
    db._db.run('INSERT INTO settings_v2 (user_id, key, value) SELECT 1, key, value FROM settings');
    db._db.run('DROP TABLE settings');
    db._db.run('ALTER TABLE settings_v2 RENAME TO settings');
    _saveDb();
  }

  // Run schema (CREATE TABLE IF NOT EXISTS for all tables)
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db._db.run(schema);

  // Migrate: add photo_url column if missing
  if (!_hasColumn('contacts', 'photo_url')) {
    db._db.run('ALTER TABLE contacts ADD COLUMN photo_url TEXT');
    _saveDb();
  }

  // Migrate: add warmth_score columns if missing
  if (!_hasColumn('contacts', 'warmth_score')) {
    db._db.run('ALTER TABLE contacts ADD COLUMN warmth_score INTEGER');
    db._db.run('ALTER TABLE contacts ADD COLUMN warmth_score_updated_at DATETIME');
    _saveDb();
  }

  // Migrate: add warmth_score_reason column if missing
  if (!_hasColumn('contacts', 'warmth_score_reason')) {
    db._db.run('ALTER TABLE contacts ADD COLUMN warmth_score_reason TEXT');
    _saveDb();
  }

  // --- Auth migration: add user_id columns ---
  if (!_hasColumn('contacts', 'user_id')) {
    db._db.run('ALTER TABLE contacts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1');
    _saveDb();
  }

  if (!_hasColumn('donations', 'user_id')) {
    db._db.run('ALTER TABLE donations ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1');
    _saveDb();
  }

  if (!_hasColumn('outreaches', 'user_id')) {
    db._db.run('ALTER TABLE outreaches ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1');
    _saveDb();
  }

  if (!_hasColumn('ai_prompts', 'user_id')) {
    db._db.run('ALTER TABLE ai_prompts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1');
    _saveDb();
  }

  // --- Migrate: add must_change_password column if missing ---
  if (!_hasColumn('users', 'must_change_password')) {
    db._db.run('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1');
    _saveDb();
  }

  // --- Migrate: add email column to users if missing ---
  if (!_hasColumn('users', 'email')) {
    db._db.run('ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE');
    _saveDb();
  }

  // --- Migrate: add token_version column to users if missing ---
  if (!_hasColumn('users', 'token_version')) {
    db._db.run('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
    _saveDb();
  }

  // --- Performance indexes that depend on user_id migration ---
  db._db.run('CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id)');
  db._db.run('CREATE INDEX IF NOT EXISTS idx_contacts_user_last_name ON contacts(user_id, last_name)');
  db._db.run('CREATE INDEX IF NOT EXISTS idx_contacts_user_email ON contacts(user_id, email)');
  db._db.run('CREATE INDEX IF NOT EXISTS idx_contacts_user_warmth ON contacts(user_id, warmth_score)');
  db._db.run('CREATE INDEX IF NOT EXISTS idx_donations_user_id ON donations(user_id)');
  db._db.run('CREATE INDEX IF NOT EXISTS idx_outreaches_user_id ON outreaches(user_id)');
  db._db.run('CREATE INDEX IF NOT EXISTS idx_ai_prompts_user_id ON ai_prompts(user_id)');

  // --- Bootstrap admin user ---
  const adminUser = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!adminUser) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin', 10);
    db.prepare('INSERT INTO users (username, password_hash, display_name, role, must_change_password) VALUES (?, ?, ?, ?, 1)').run('admin', hash, 'Administrator', 'admin');
    console.log('Created default admin user (username: admin, password: admin)');
  }

  // Backfill: generate default avatars for contacts without a photo
  const backgrounds = ['4f46e5','7c3aed','2563eb','0891b2','059669','d97706','dc2626','be185d'];
  const noPhoto = db.prepare("SELECT id, first_name, last_name FROM contacts WHERE photo_url IS NULL OR photo_url = ''").all();
  if (noPhoto.length > 0) {
    const updatePhoto = db.prepare('UPDATE contacts SET photo_url = ? WHERE id = ?');
    for (const c of noPhoto) {
      const bg = backgrounds[c.id % backgrounds.length];
      const url = `https://ui-avatars.com/api/?name=${encodeURIComponent(c.first_name || '')}+${encodeURIComponent(c.last_name || '')}&background=${bg}&color=fff&size=128&bold=true`;
      updatePhoto.run(url, c.id);
    }
  }

  // Seed default settings for admin user (user_id = 1) if empty
  const countResult = db.prepare('SELECT COUNT(*) as cnt FROM settings WHERE user_id = 1').get();
  if (countResult.cnt === 0) {
    const insert = db.prepare('INSERT INTO settings (user_id, key, value) VALUES (1, ?, ?)');
    insert.run('missionary_name', '');
    insert.run('missionary_context', '');
    insert.run('default_stale_days', '90');
    insert.run('anthropic_api_key', '');
  }

  // Seed available_tags from existing contacts if not yet set
  const tagsRow = db.prepare("SELECT value FROM settings WHERE user_id = 1 AND key = 'available_tags'").get();
  if (!tagsRow) {
    const allContacts = db.prepare('SELECT tags FROM contacts WHERE tags IS NOT NULL AND tags != ""').all();
    const tagSet = new Set();
    for (const c of allContacts) {
      c.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
    }
    const sorted = Array.from(tagSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    db.prepare('INSERT INTO settings (user_id, key, value) VALUES (1, ?, ?)').run('available_tags', JSON.stringify(sorted));
  }

  // Ensure immediate flush after init
  _saveDb();

  // Start periodic backups
  startPeriodicBackups();

  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initialize() first.');
  }
  return db;
}

// Promise-based init for server startup
function initializeAsync() {
  if (!initPromise) {
    initPromise = initialize();
  }
  return initPromise;
}

module.exports = { initialize: initializeAsync, getDb, normalizePhone, flushAndClose, backupDatabase };
