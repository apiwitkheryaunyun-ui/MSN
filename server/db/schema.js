'use strict';

/**
 * Unified async database adapter.
 * - Local dev  : SQLite via better-sqlite3  (no DATABASE_URL)
 * - Production : PostgreSQL via pg           (DATABASE_URL set by Heroku)
 *
 * Public API (all methods return Promises):
 *   db.get(sql, params[])  → single row | undefined
 *   db.all(sql, params[])  → row[]
 *   db.run(sql, params[])  → { lastID, changes }
 *   db.exec(sql)           → void
 *   db.init()              → void  (create tables)
 */

// Tables whose INSERT should return the auto-generated id (for PG RETURNING id)
const TABLES_WITH_ID = new Set(['users', 'friends', 'conversations', 'messages']);

function extractTableName(sql) {
  const m = sql.match(/INTO\s+(\w+)/i);
  return m ? m[1].toLowerCase() : null;
}

const isPG = !!process.env.DATABASE_URL;
let adapter;

const SHARED_SCHEMA = {
  pg: {
    create: `
      CREATE TABLE IF NOT EXISTS users (
        id           SERIAL PRIMARY KEY,
        msn_id       TEXT    NOT NULL UNIQUE,
        username     TEXT    NOT NULL,
        email        TEXT    NOT NULL UNIQUE,
        password     TEXT    NOT NULL,
        display_name TEXT    NOT NULL DEFAULT '',
        status       TEXT    NOT NULL DEFAULT 'offline',
        status_msg   TEXT    NOT NULL DEFAULT '',
        avatar_url   TEXT    NOT NULL DEFAULT '',
        created_at   INTEGER NOT NULL DEFAULT FLOOR(EXTRACT(EPOCH FROM NOW()))::INTEGER,
        last_seen    INTEGER NOT NULL DEFAULT FLOOR(EXTRACT(EPOCH FROM NOW()))::INTEGER
      );
      CREATE TABLE IF NOT EXISTS friends (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status     TEXT    NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL DEFAULT FLOOR(EXTRACT(EPOCH FROM NOW()))::INTEGER,
        UNIQUE(user_id, friend_id)
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id         SERIAL PRIMARY KEY,
        kind       TEXT    NOT NULL DEFAULT 'direct',
        title      TEXT    NOT NULL DEFAULT '',
        owner_id   INTEGER,
        created_at INTEGER NOT NULL DEFAULT FLOOR(EXTRACT(EPOCH FROM NOW()))::INTEGER
      );
      CREATE TABLE IF NOT EXISTS conversation_members (
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (conversation_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id              SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content         TEXT    NOT NULL,
        msg_type        TEXT    NOT NULL DEFAULT 'text',
        attachment_name TEXT    NOT NULL DEFAULT '',
        attachment_type TEXT    NOT NULL DEFAULT '',
        attachment_size INTEGER NOT NULL DEFAULT 0,
        attachment_data TEXT    NOT NULL DEFAULT '',
        sent_at         INTEGER NOT NULL DEFAULT FLOOR(EXTRACT(EPOCH FROM NOW()))::INTEGER,
        is_read         INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        theme                 TEXT    NOT NULL DEFAULT 'classic',
        sounds_enabled        INTEGER NOT NULL DEFAULT 1,
        allow_friend_requests INTEGER NOT NULL DEFAULT 1,
        allow_file_transfer   INTEGER NOT NULL DEFAULT 1,
        privacy_mode          TEXT    NOT NULL DEFAULT 'everyone'
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, sent_at);
      CREATE INDEX IF NOT EXISTS idx_friends_user  ON friends(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_users_msn_id  ON users(msn_id);
    `,
    migrations: [
      "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'direct'",
      "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS owner_id INTEGER',
      "ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_size INTEGER NOT NULL DEFAULT 0',
      "ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_data TEXT NOT NULL DEFAULT ''",
      `CREATE TABLE IF NOT EXISTS user_settings (
        user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        theme                 TEXT    NOT NULL DEFAULT 'classic',
        sounds_enabled        INTEGER NOT NULL DEFAULT 1,
        allow_friend_requests INTEGER NOT NULL DEFAULT 1,
        allow_file_transfer   INTEGER NOT NULL DEFAULT 1,
        privacy_mode          TEXT    NOT NULL DEFAULT 'everyone'
      )`,
      'CREATE INDEX IF NOT EXISTS idx_conv_kind ON conversations(kind, created_at)'
    ]
  },
  sqlite: {
    create: `
      CREATE TABLE IF NOT EXISTS users (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        msn_id       TEXT    NOT NULL UNIQUE,
        username     TEXT    NOT NULL,
        email        TEXT    NOT NULL UNIQUE,
        password     TEXT    NOT NULL,
        display_name TEXT    NOT NULL DEFAULT '',
        status       TEXT    NOT NULL DEFAULT 'offline',
        status_msg   TEXT    NOT NULL DEFAULT '',
        avatar_url   TEXT    NOT NULL DEFAULT '',
        created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        last_seen    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS friends (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status     TEXT    NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        UNIQUE(user_id, friend_id)
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        kind       TEXT    NOT NULL DEFAULT 'direct',
        title      TEXT    NOT NULL DEFAULT '',
        owner_id   INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS conversation_members (
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (conversation_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content         TEXT    NOT NULL,
        msg_type        TEXT    NOT NULL DEFAULT 'text',
        attachment_name TEXT    NOT NULL DEFAULT '',
        attachment_type TEXT    NOT NULL DEFAULT '',
        attachment_size INTEGER NOT NULL DEFAULT 0,
        attachment_data TEXT    NOT NULL DEFAULT '',
        sent_at         INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        is_read         INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        theme                 TEXT    NOT NULL DEFAULT 'classic',
        sounds_enabled        INTEGER NOT NULL DEFAULT 1,
        allow_friend_requests INTEGER NOT NULL DEFAULT 1,
        allow_file_transfer   INTEGER NOT NULL DEFAULT 1,
        privacy_mode          TEXT    NOT NULL DEFAULT 'everyone'
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, sent_at);
      CREATE INDEX IF NOT EXISTS idx_friends_user  ON friends(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_users_msn_id  ON users(msn_id);
    `,
    columns: [
      ['conversations', 'kind', "TEXT NOT NULL DEFAULT 'direct'"],
      ['conversations', 'title', "TEXT NOT NULL DEFAULT ''"],
      ['conversations', 'owner_id', 'INTEGER'],
      ['messages', 'attachment_name', "TEXT NOT NULL DEFAULT ''"],
      ['messages', 'attachment_type', "TEXT NOT NULL DEFAULT ''"],
      ['messages', 'attachment_size', 'INTEGER NOT NULL DEFAULT 0'],
      ['messages', 'attachment_data', "TEXT NOT NULL DEFAULT ''"]
    ]
  }
};

/* ══════════════════════════════════════════════════════
   PostgreSQL adapter
══════════════════════════════════════════════════════ */
if (isPG) {
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
  });

  // Convert ? placeholders → $1 $2 ... for PostgreSQL
  function toPositional(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  // Translate SQLite-specific functions to PostgreSQL equivalents
  function pgAdapt(sql) {
    return sql.replace(/strftime\('%s','now'\)/g,
      "FLOOR(EXTRACT(EPOCH FROM NOW()))::INTEGER");
  }

  adapter = {
    isPG: true,
    async init() {
      await pool.query(SHARED_SCHEMA.pg.create);
      for (const statement of SHARED_SCHEMA.pg.migrations) {
        await pool.query(statement);
      }
      console.log('PostgreSQL schema ready');
    },
    async get(sql, params = []) {
      const { rows } = await pool.query(toPositional(pgAdapt(sql)), params);
      return rows[0];
    },
    async all(sql, params = []) {
      const { rows } = await pool.query(toPositional(pgAdapt(sql)), params);
      return rows;
    },
    async run(sql, params = []) {
      let s = pgAdapt(sql);
      const isInsert = /^\s*INSERT/i.test(s);
      const tbl = isInsert ? extractTableName(s) : null;
      if (isInsert && tbl && TABLES_WITH_ID.has(tbl) && !/RETURNING/i.test(s)) {
        s += ' RETURNING id';
      }
      const result = await pool.query(toPositional(s), params);
      return {
        lastID: (isInsert && result.rows[0]) ? result.rows[0].id : undefined,
        changes: result.rowCount,
      };
    },
    async exec(sql) { await pool.query(sql); },
  };

/* ══════════════════════════════════════════════════════
   SQLite adapter  (local development)
══════════════════════════════════════════════════════ */
} else {
  const Database = require('better-sqlite3');
  const path = require('path');
  const fs = require('fs');

  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/msn.db');
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  function hasColumn(table, column) {
    const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((row) => row.name === column);
  }

  function ensureColumn(table, column, definition) {
    if (!hasColumn(table, column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  adapter = {
    isPG: false,
    init() {
      sqlite.exec(SHARED_SCHEMA.sqlite.create);
      SHARED_SCHEMA.sqlite.columns.forEach(([table, column, definition]) => {
        ensureColumn(table, column, definition);
      });
      sqlite.exec('CREATE INDEX IF NOT EXISTS idx_conv_kind ON conversations(kind, created_at)');
      console.log('SQLite schema ready');
      return Promise.resolve();
    },
    get(sql, params = []) {
      return Promise.resolve(sqlite.prepare(sql).get(params));
    },
    all(sql, params = []) {
      return Promise.resolve(sqlite.prepare(sql).all(params));
    },
    run(sql, params = []) {
      const info = sqlite.prepare(sql).run(params);
      return Promise.resolve({ lastID: info.lastInsertRowid, changes: info.changes });
    },
    exec(sql) {
      sqlite.exec(sql);
      return Promise.resolve();
    },
  };
}

module.exports = adapter;
