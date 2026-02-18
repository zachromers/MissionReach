const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'missionreach.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;
let initPromise = null;

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
    if (!this._wrapper || !this._wrapper._inTransaction) _saveDb();
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
    if (!this._inTransaction) _saveDb();
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

function _saveDb() {
  if (db && db._db) {
    const data = db._db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
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

  // Run schema
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db._db.run(schema);

  // Migrate: add photo_url column if missing
  try {
    db.prepare('SELECT photo_url FROM contacts LIMIT 1').get();
  } catch (e) {
    db._db.run('ALTER TABLE contacts ADD COLUMN photo_url TEXT');
    _saveDb();
  }

  // Migrate: add warmth_score columns if missing
  try {
    db.prepare('SELECT warmth_score FROM contacts LIMIT 1').get();
  } catch (e) {
    db._db.run('ALTER TABLE contacts ADD COLUMN warmth_score INTEGER');
    db._db.run('ALTER TABLE contacts ADD COLUMN warmth_score_updated_at DATETIME');
    _saveDb();
  }

  // Migrate: add warmth_score_reason column if missing
  try {
    db.prepare('SELECT warmth_score_reason FROM contacts LIMIT 1').get();
  } catch (e) {
    db._db.run('ALTER TABLE contacts ADD COLUMN warmth_score_reason TEXT');
    _saveDb();
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

  // Seed default settings if empty
  const countResult = db.prepare('SELECT COUNT(*) as cnt FROM settings').get();
  if (countResult.cnt === 0) {
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insert.run('missionary_name', '');
    insert.run('missionary_context', '');
    insert.run('default_stale_days', '90');
    insert.run('anthropic_api_key', '');
  }

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

module.exports = { initialize: initializeAsync, getDb };
