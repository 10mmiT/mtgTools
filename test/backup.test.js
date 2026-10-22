/* A copy of available.db a day, and the last week of them kept. */

'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgbackup-'));
process.env.DATA_FILE = path.join(tmpDir, 'state.json');
delete process.env.MTGTOOLS_BACKUP_DAYS;

const { db } = require('../available-db');
const backup = require('../backup');
const Database = require('better-sqlite3');

const dir   = path.join(tmpDir, 'backups');
const files = () => fs.readdirSync(dir).sort();
const day   = n => new Date(Date.UTC(2026, 9, n, 12));

beforeEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.MTGTOOLS_BACKUP_DAYS;
});

test('writes a copy that opens and holds what the database held', async () => {
  db.prepare("INSERT OR REPLACE INTO app_state (key, value_json) VALUES ('backup-probe', '{\"x\":1}')").run();
  const file = await backup.backupNow(day(22));
  assert.equal(path.basename(file), 'available-2026-10-22.db');
  const copy = new Database(file, { readonly: true });
  try {
    assert.equal(copy.prepare("SELECT value_json FROM app_state WHERE key = 'backup-probe'").get().value_json, '{"x":1}');
  } finally { copy.close(); }
});

test('is one a day, however often it is asked', async () => {
  assert.ok(await backup.backupNow(day(22)));
  assert.equal(await backup.backupNow(day(22)), null);
  assert.deepEqual(files(), ['available-2026-10-22.db']);
});

test('keeps the newest seven and only those', async () => {
  for (let d = 1; d <= 10; d++) await backup.backupNow(day(d));
  assert.deepEqual(files(), [4, 5, 6, 7, 8, 9, 10].map(d => `available-2026-10-${String(d).padStart(2, '0')}.db`));
});

test('leaves files it did not write alone', async () => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'before-the-upgrade.db'), 'mine');
  for (let d = 1; d <= 9; d++) await backup.backupNow(day(d));
  assert.ok(files().includes('before-the-upgrade.db'));
});

test('MTGTOOLS_BACKUP_DAYS sets the count, and 0 turns it off', async () => {
  process.env.MTGTOOLS_BACKUP_DAYS = '2';
  for (let d = 1; d <= 4; d++) await backup.backupNow(day(d));
  assert.deepEqual(files(), ['available-2026-10-03.db', 'available-2026-10-04.db']);

  process.env.MTGTOOLS_BACKUP_DAYS = '0';
  assert.equal(await backup.backupNow(day(5)), null);
});

test('is not started when the background jobs are switched off', () => {
  // server.js is what starts it, behind the same switch as the Scryfall jobs.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const guarded = src.slice(src.indexOf("if (process.env.MTGTOOLS_NO_BACKGROUND !== '1')"));
  assert.match(guarded.slice(0, guarded.indexOf('}')), /require\('\.\/backup'\)\.init\(\)/);
});
