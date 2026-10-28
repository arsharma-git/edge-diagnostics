const Database = require('better-sqlite3');
const path = require('path');
const logger = require('./middleware/logging');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'reports.db');

let db;

function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      reference_error_id TEXT,
      http_status INTEGER,
      error_class TEXT,
      origin_hostname TEXT,
      edge_ip TEXT,
      edge_location TEXT,
      request_url TEXT,
      client_ip TEXT,
      outcome TEXT DEFAULT 'inconclusive',
      notes TEXT,
      UNIQUE(reference_error_id)
    );

    CREATE TABLE IF NOT EXISTS tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      test_type TEXT NOT NULL,
      target TEXT,
      success INTEGER DEFAULT 0,
      duration_ms INTEGER,
      result_json TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(http_status);
    CREATE INDEX IF NOT EXISTS idx_sessions_origin ON sessions(origin_hostname);
    CREATE INDEX IF NOT EXISTS idx_sessions_ref ON sessions(reference_error_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_outcome ON sessions(outcome);
    CREATE INDEX IF NOT EXISTS idx_tests_session ON tests(session_id);
    CREATE INDEX IF NOT EXISTS idx_tests_type ON tests(test_type);
    CREATE INDEX IF NOT EXISTS idx_webhooks_source ON webhooks(source);
  `);

  logger.info('Database initialized at ' + DB_PATH);
   return db;
}

function getDb() {
  if (!db) {
    initDb();
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
    logger.info('Database closed');
  }
}

module.exports = {
  getDb,
  closeDb,
  db: getDb
};
