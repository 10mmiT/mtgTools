/* Private decks — open mode ignores the flag entirely.
 *
 * With no ADMIN_PASSWORD there is no server-side identity, so the server cannot
 * tell owner from stranger and cannot enforce privacy. The decision: the
 * `private` flag is inert — GET /api/state returns every deck's metadata and
 * every deck's deckCardCounts entry to everyone. (The guest session is role
 * 'admin', which is what makes the account-mode filter no-op here.)
 *
 * Its own file because open mode is decided once, when middleware/auth reads
 * the environment at require time. node:test runs each file in its own process.
 */
'use strict';
const { test, describe, after } = require('node:test');
const assert    = require('node:assert/strict');
const supertest = require('supertest');
const fs        = require('node:fs');
const path      = require('node:path');
const os        = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgprivacy-open-'));
process.env.DATA_FILE = path.join(tmpDir, 'state.json');
delete process.env.ADMIN_PASSWORD;   // ← the whole point: no accounts exist
delete process.env.APP_PASSWORD;
process.env.PORT = '0';
process.env.MTGTOOLS_NO_BACKGROUND = '1';

const dbModule = require('../available-db');
const { app, server: getServer } = require('../server');
const request  = supertest(app);

describe('Open mode: the private flag is inert on read', () => {
  const meId = 'p_me', otherId = 'p_other';

  test('every deck’s metadata and count is returned to everyone', async () => {
    const db = dbModule.db;
    db.exec('DELETE FROM app_state; DELETE FROM deck_cards;');
    db.prepare("INSERT OR REPLACE INTO app_state (key, value_json, version) VALUES ('state', ?, 0)")
      .run(JSON.stringify({ players: [
        { id: meId, name: 'Me', wantList: [], folders: [], decks: [
          { id: 'mine', name: 'Mine', source: 'manual', private: true },
        ] },
        { id: otherId, name: 'Other', wantList: [], folders: [], decks: [
          { id: 'theirs', name: 'Theirs', source: 'manual', private: true },
        ] },
      ] }));
    db.prepare('INSERT INTO deck_cards (deck_id, card_name, qty, category, board, position) VALUES (?,?,?,?,?,?)')
      .run('theirs', 'Island', 5, 'Lands', 'main', 0);

    // No cookie at all — open mode needs no session.
    const res = await request.get('/api/state');
    assert.equal(res.status, 200);

    const other = res.body.players.find(p => p.id === otherId);
    assert.deepEqual(other.decks.map(d => d.id), ['theirs'],
      'a private deck is still returned to a stranger in open mode');
    assert.equal(res.body.deckCardCounts.theirs, 5,
      'and so is its count — the flag has no effect without server identity');
  });
});

after((_, done) => {
  const srv = getServer && getServer();
  function finish() {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    done();
    setImmediate(() => process.exit(0));
  }
  if (srv && srv.listening) srv.close(finish); else finish();
});
