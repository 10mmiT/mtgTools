/* state.json, the file the app kept everything in before SQLite, is read
 * into the database once.
 *
 * It used to be read whenever the collections table was empty — which is
 * also what deleting every collection leaves. So: boot, delete them all,
 * restart, and the shelf from the old file was back. Each boot here is a
 * process of its own, because the migration runs as the module loads.
 */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const os       = require('node:os');
const path     = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/** Start the app's state module against `dir`, run `sql`, and say how many
 *  collections and players there are. */
function boot(dir, sql = '') {
  const script = `
    const { db } = require('./available-db');
    require('./routes/state');
    ${sql ? `db.exec(${JSON.stringify(sql)});` : ''}
    const players = JSON.parse(db.prepare("SELECT value_json FROM app_state WHERE key = 'state'").get()?.value_json || '{"players":[]}').players;
    process.stdout.write('@@' + JSON.stringify({
      collections: db.prepare('SELECT COUNT(*) AS n FROM collections').get().n,
      players: players.length,
    }));`;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: ROOT, env: { ...process.env, DATA_FILE: path.join(dir, 'state.json') },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(String(out).split('@@').pop());
}

function legacyDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtglegacy-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    players: [{ id: 'p-old', name: 'Old', decks: [], wantList: [] }],
    collections: [{ key: 'csv:old', name: 'The old shelf', source: 'csv-archidekt',
                    cards: { 'Sol Ring': { name: 'Sol Ring', qty: 1 } }, entries: 1 }],
  }));
  return dir;
}

test('the old file is read on the first boot', () => {
  const dir = legacyDir();
  assert.deepEqual(boot(dir), { collections: 1, players: 1 });
});

test('and a shelf emptied afterwards stays empty across a restart', () => {
  const dir = legacyDir();
  boot(dir);
  assert.equal(boot(dir, 'DELETE FROM collections').collections, 0);
  assert.equal(boot(dir).collections, 0, 'the old shelf came back from state.json');
});

test('an install that imported it before the marker existed is not read again', () => {
  // What an install upgrading to this build looks like: players already in
  // SQLite, no marker row, and every collection since deleted.
  const dir = legacyDir();
  boot(dir, "DELETE FROM app_state WHERE key = 'migration:state-json'; DELETE FROM collections");
  assert.equal(boot(dir).collections, 0);
});
