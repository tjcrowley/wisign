'use strict';
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.FTSIGN_DB || path.join(__dirname, '..', 'ftsign.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS screens (
    id TEXT PRIMARY KEY,
    device_id TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL DEFAULT 'Unnamed Screen',
    location TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    platform TEXT DEFAULT 'unknown',
    capabilities TEXT DEFAULT '{}',
    status TEXT DEFAULT 'offline',
    last_seen_at TEXT,
    current_assignment TEXT DEFAULT NULL,
    notes TEXT DEFAULT '',
    software_version TEXT DEFAULT '',
    ip TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS signs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'raw_html',
    html TEXT DEFAULT '',
    url TEXT DEFAULT '',
    assets TEXT DEFAULT '[]',
    version INTEGER DEFAULT 1,
    published INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    items TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'sign',
    ref_id TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    starts_at TEXT,
    ends_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Insert sample sign if none exist
const count = db.prepare('SELECT COUNT(*) as c FROM signs').get();
if (count.c === 0) {
  const { v4: uuidv4 } = require('uuid');
  db.prepare(`INSERT INTO signs (id, name, type, html) VALUES (?, ?, ?, ?)`).run(
    uuidv4(),
    'Welcome Sign',
    'raw_html',
    `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    color: #e94560;
    font-family: 'Segoe UI', sans-serif;
    display: flex; align-items: center; justify-content: center;
    height: 100vh; text-align: center;
  }
  h1 { font-size: 6vw; margin-bottom: 1rem; text-shadow: 0 0 40px #e94560; }
  p { font-size: 2.5vw; color: #a8dadc; }
  .clock { font-size: 3vw; margin-top: 2rem; color: #fff; }
</style>
</head>
<body>
  <div>
    <h1>Welcome</h1>
    <p>Digital Signage Powered by FTSign</p>
    <div class="clock" id="clock"></div>
  </div>
  <script>
    function tick() {
      document.getElementById('clock').textContent = new Date().toLocaleTimeString();
    }
    tick(); setInterval(tick, 1000);
  </script>
</body>
</html>`
  );
}

// Migrations — safe to run repeatedly
try { db.exec(`ALTER TABLE screens   ADD COLUMN orientation TEXT DEFAULT 'landscape'`); } catch {}
try { db.exec(`ALTER TABLE screens   ADD COLUMN group_id    TEXT DEFAULT NULL`);        } catch {}
try { db.exec(`ALTER TABLE playlists ADD COLUMN group_ids   TEXT DEFAULT '[]'`);        } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS device_config (
    id           TEXT PRIMARY KEY,
    display_name TEXT DEFAULT '',
    group_id     TEXT DEFAULT NULL,
    notes        TEXT DEFAULT '',
    updated_at   TEXT DEFAULT (datetime('now'))
  );
`);

module.exports = db;
