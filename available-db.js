const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.dirname(process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json'));
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'available.db'));
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
