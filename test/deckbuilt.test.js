/* The built-deck signal: GET /api/state gains `deckCardCounts`.
 *
 * `deckCardCounts[deck_id]` is SUM(qty) of that deck's rows in `deck_cards` —
 * the count the Decks grid keys off (`> 0` is "imported/built"), preferred over
 * the metadata `cardCount` which is Archidekt's number, not what was built. A
 * deck with no rows is absent, and the map is ownership-filtered: a requester
 * never learns the size of a deck they may not see.
 *
 * Account mode (ADMIN_PASSWORD set). The open-mode "flag is inert" read case
 * lives in deckprivacy-open.test.js, since open mode is decided once at
 * require time.
 */
'use strict';
const { test, describe, beforeEach, after } = require('node:test');
const assert    = require('node:assert/strict');
const supertest = require('supertest');
const fs        = require('node:fs');
const path      = require('node:path');
const os        = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgbuilt-'));
process.env.DATA_FILE      = path.join(tmpDir, 'state.json');
process.env.ADMIN_PASSWORD = 'testpass';
process.env.PORT           = '0';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.MTGTOOLS_NO_BACKGROUND = '1';

const dbModule = require('../available-db');
const { app, server: getServer } = require('../server');
const request  = supertest(app);

function resetDb() {
  const db = dbModule.db;
  db.exec(`
    DELETE FROM sessions;
    DELETE FROM users WHERE username != 'admin';
    DELETE FROM account_requests;
    DELETE FROM app_state;
    DELETE FROM deck_cards;
  `);
  const bcrypt = require('bcryptjs');
  const hash   = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
  db.prepare(`
    INSERT INTO users (username, password_hash, role, player_id) VALUES ('admin', ?, 'admin', NULL)
    ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin'
  `).run(hash);
}

async function loginAs(username, password) {
  const res = await request.post('/api/auth/login').send({ username, password }).set('Content-Type', 'application/json');
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return null;
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return raw.split(';')[0];
}

function addCards(deckId, rows) {
  const stmt = dbModule.db.prepare(
    'INSERT INTO deck_cards (deck_id, card_name, qty, category, board, position) VALUES (?,?,?,?,?,?)'
  );
  rows.forEach((r, i) => stmt.run(deckId, r.name, r.qty, r.category || 'Other', r.board || 'main', i));
}

describe('deckCardCounts on GET /api/state', () => {
  let meId, otherId, meCookie, adminCookie;

  beforeEach(async () => {
    resetDb();
    const db = dbModule.db;
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    meId    = uuidv4();
    otherId = uuidv4();

    // Me: one built deck (md1) and one metadata-only draft (draft1, no rows).
    // Other: a built public deck (ob1) and a built *private* deck (od1).
    db.prepare("INSERT OR REPLACE INTO app_state (key, value_json, version) VALUES ('state', ?, 0)")
      .run(JSON.stringify({ players: [
        { id: meId, name: 'Me', wantList: [], folders: [], decks: [
          { id: 'md1', name: 'My built', source: 'manual' },
          { id: 'draft1', name: 'My draft', source: 'manual' },
        ] },
        { id: otherId, name: 'Other', wantList: [], folders: [], decks: [
          { id: 'ob1', name: 'Their public', source: 'manual' },
          { id: 'od1', name: 'Their secret', source: 'manual', private: true },
        ] },
      ] }));

    addCards('md1', [{ name: 'Sol Ring', qty: 1 }, { name: 'Island', qty: 3 }]);   // 4
    addCards('ob1', [{ name: 'Forest', qty: 10 }]);                                 // 10
    addCards('od1', [{ name: 'Black Lotus', qty: 1 }, { name: 'Swamp', qty: 6 }]);  // 7

    const h = bcrypt.hashSync('pp', 10);
    db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES ('me', ?, 'player', ?)").run(h, meId);
    meCookie    = await loginAs('me', 'pp');
    adminCookie = await loginAs('admin', 'testpass');
  });

  test('counts SUM(qty) per deck_id, across boards', async () => {
    const res = await request.get('/api/state').set('Cookie', adminCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.deckCardCounts.md1, 4);
    assert.equal(res.body.deckCardCounts.ob1, 10);
    assert.equal(res.body.deckCardCounts.od1, 7);
  });

  test('omits decks with no deck_cards rows', async () => {
    const res = await request.get('/api/state').set('Cookie', adminCookie);
    assert.equal('draft1' in res.body.deckCardCounts, false,
      'a metadata-only deck was never built, so it has no count');
  });

  test('reflects a build immediately', async () => {
    const before = await request.get('/api/state').set('Cookie', adminCookie);
    assert.equal('draft1' in before.body.deckCardCounts, false);

    addCards('draft1', [{ name: 'Plains', qty: 2 }]);

    const after = await request.get('/api/state').set('Cookie', adminCookie);
    assert.equal(after.body.deckCardCounts.draft1, 2);
  });

  test('never counts a deck the requester may not see', async () => {
    const res = await request.get('/api/state').set('Cookie', meCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.deckCardCounts.md1, 4, 'my own built deck is counted');
    assert.equal(res.body.deckCardCounts.ob1, 10, 'another player’s public deck is counted');
    assert.equal('od1' in res.body.deckCardCounts, false,
      'another player’s private deck leaks neither its existence nor its size');
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
