const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.dirname(process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json'));
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'available.db');
console.log(`[db] Data directory : ${dataDir}`);
console.log(`[db] SQLite database: ${dbPath}`);

// Warn when running inside a Docker container with no volume mounted at /app/data.
// The VOLUME declaration in the Dockerfile creates an anonymous volume, which Docker
// discards whenever the container is recreated (e.g. Unraid image updates / Apply).
// Map /app/data to a persistent host path to avoid data loss.
const isDocker = fs.existsSync('/.dockerenv');
const isMounted = (() => {
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    return mounts.split('\n').some(line => {
      const mp = line.split(' ')[1];
      return mp && (dataDir === mp || dataDir.startsWith(mp + '/'));
    });
  } catch { return true; } // can't tell — assume OK
})();
if (isDocker && !isMounted) {
  console.warn('[db] WARNING: /app/data does not appear to be on a mounted volume.');
  console.warn('[db]          Data will be lost when the container is recreated.');
  console.warn('[db]          Map /app/data to a persistent host path (e.g. on Unraid:');
  console.warn('[db]          Container Path=/app/data → Host Path=/mnt/user/appdata/mtgtools).');
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS calendars (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS availability (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    person_name TEXT NOT NULL,
    date        TEXT NOT NULL,
    UNIQUE(calendar_id, person_name, date)
  );
  CREATE INDEX IF NOT EXISTS idx_avail_cal ON availability(calendar_id, date);
  CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'player',
    player_id     TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS account_requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    requested_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS collections (
    key        TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    source     TEXT NOT NULL,
    col_id     TEXT,
    color      TEXT NOT NULL,
    cards_json TEXT NOT NULL DEFAULT '{}',
    entries    INTEGER NOT NULL DEFAULT 0,
    total      INTEGER,
    saved_at   TEXT
  );
`);

const DEFAULT_CAL_ID = 'default';

// Ensure the default calendar exists
const exists = db.prepare('SELECT id FROM calendars WHERE id = ?').get(DEFAULT_CAL_ID);
if (!exists) {
  db.prepare('INSERT INTO calendars (id, name, description) VALUES (?, ?, ?)').run(
    DEFAULT_CAL_ID, 'Group Availability', 'When is everyone free?'
  );
}

module.exports = { db, DEFAULT_CAL_ID };
