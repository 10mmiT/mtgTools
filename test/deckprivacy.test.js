/* Private decks — the server enforcement (read side).
 *
 * A private deck is visible to its owner and to admins, and to nobody else: the
 * server withholds both its metadata (from the players array) and its size
 * (from deckCardCounts) on GET /api/state. This file covers the read cases
 * ticket #33 delivers; the POST-merge rule and the deck-card/snapshot route
 * guards are later tickets that will append here. Open mode's inert-flag read
 * case lives in deckprivacy-open.test.js, since open mode is fixed at require
 * time.
 *
 * Account mode (ADMIN_PASSWORD set).
 */
'use strict';
const { test, describe, beforeEach, after } = require('node:test');
const assert    = require('node:assert/strict');
const supertest = require('supertest');
const fs        = require('node:fs');
const path      = require('node:path');
const os        = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgprivacy-'));
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

function addCards(deckId, qty) {
  dbModule.db.prepare(
    'INSERT INTO deck_cards (deck_id, card_name, qty, category, board, position) VALUES (?,?,?,?,?,?)'
  ).run(deckId, 'Card ' + deckId, qty, 'Other', 'main', 0);
}

const decksOf = (body, playerId) => body.players.find(p => p.id === playerId).decks;
const deckIds = (body, playerId) => decksOf(body, playerId).map(d => d.id);

describe('GET /api/state withholds other players’ private decks', () => {
  let meId, otherId, meCookie, adminCookie;

  beforeEach(async () => {
    resetDb();
    const db = dbModule.db;
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    meId    = uuidv4();
    otherId = uuidv4();

    // Me: a public deck and a private one of my own. Other: a public deck and a
    // private one I must not see.
    db.prepare("INSERT OR REPLACE INTO app_state (key, value_json, version) VALUES ('state', ?, 0)")
      .run(JSON.stringify({ players: [
        { id: meId, name: 'Me', wantList: [], folders: [], decks: [
          { id: 'mpub', name: 'My public', source: 'manual' },
          { id: 'mpriv', name: 'My secret', source: 'manual', private: true },
        ] },
        { id: otherId, name: 'Other', wantList: [], folders: [], decks: [
          { id: 'opub', name: 'Their public', source: 'manual' },
          { id: 'opriv', name: 'Their secret', source: 'manual', private: true },
        ] },
      ] }));
    addCards('mpub', 1); addCards('mpriv', 2); addCards('opub', 3); addCards('opriv', 4);

    const h = bcrypt.hashSync('pp', 10);
    db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES ('me', ?, 'player', ?)").run(h, meId);
    meCookie    = await loginAs('me', 'pp');
    adminCookie = await loginAs('admin', 'testpass');
  });

  test('a non-admin does not receive another player’s private deck in the players array', async () => {
    const res = await request.get('/api/state').set('Cookie', meCookie);
    assert.equal(res.status, 200);
    assert.deepEqual(deckIds(res.body, otherId), ['opub'],
      'the other player’s private deck is absent entirely, not just flagged');
  });

  test('a non-admin does not receive that deck’s deckCardCounts entry', async () => {
    const res = await request.get('/api/state').set('Cookie', meCookie);
    assert.equal('opriv' in res.body.deckCardCounts, false);
    assert.equal(res.body.deckCardCounts.opub, 3, 'their public deck is still counted');
  });

  test('the requester’s own private deck is always present, metadata and count', async () => {
    const res = await request.get('/api/state').set('Cookie', meCookie);
    assert.deepEqual(deckIds(res.body, meId).sort(), ['mpriv', 'mpub']);
    assert.equal(res.body.deckCardCounts.mpriv, 2);
  });

  test('an admin sees every private deck and its count', async () => {
    const res = await request.get('/api/state').set('Cookie', adminCookie);
    assert.deepEqual(deckIds(res.body, otherId).sort(), ['opriv', 'opub']);
    assert.equal(res.body.deckCardCounts.opriv, 4);
    assert.equal(res.body.deckCardCounts.mpriv, 2);
  });
});

describe('POST /api/state keeps other players’ private decks through a non-admin write', () => {
  let meId, otherId, meCookie, adminCookie;

  beforeEach(async () => {
    resetDb();
    const db = dbModule.db;
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    meId    = uuidv4();
    otherId = uuidv4();

    db.prepare("INSERT OR REPLACE INTO app_state (key, value_json, version) VALUES ('state', ?, 0)")
      .run(JSON.stringify({ players: [
        { id: meId, name: 'Me', wantList: [], folders: [], decks: [
          { id: 'mpub', name: 'My public', source: 'manual' },
          { id: 'mpriv', name: 'My secret', source: 'manual', private: true },
        ] },
        { id: otherId, name: 'Other', wantList: [], folders: [], decks: [
          { id: 'opub', name: 'Their public', source: 'manual' },
          { id: 'opriv', name: 'Their secret', source: 'manual', private: true },
        ] },
      ] }));
    addCards('mpub', 1); addCards('mpriv', 2); addCards('opub', 3); addCards('opriv', 4);

    const h = bcrypt.hashSync('pp', 10);
    db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES ('me', ?, 'player', ?)").run(h, meId);
    meCookie    = await loginAs('me', 'pp');
    adminCookie = await loginAs('admin', 'testpass');
  });

  // Fetch state as the client would, optionally edit the blob, and save it back.
  // A non-admin's GET is already missing other players' private decks (#33), so
  // this reproduces the exact blob the browser posts.
  async function roundTrip(cookie, mutate) {
    const got  = await request.get('/api/state').set('Cookie', cookie);
    const body = { players: got.body.players, version: got.body.version };
    if (mutate) mutate(body);
    return request.post('/api/state').set('Cookie', cookie).send(body);
  }

  test('a neighbour’s save keeps the private deck it never received', async () => {
    const res = await roundTrip(meCookie);
    assert.equal(res.status, 200, res.text);

    const admin = await request.get('/api/state').set('Cookie', adminCookie);
    assert.deepEqual(deckIds(admin.body, otherId).sort(), ['opriv', 'opub'],
      'the other player’s private deck survives the neighbour’s write');
    assert.equal(admin.body.deckCardCounts.opriv, 4, 'and its card count with it');
  });

  test('the permission check does not 403 on the absent private deck', async () => {
    // A legitimate change to my own player, with Other’s private deck missing
    // from the blob, must be allowed — not read as my having deleted it.
    const res = await roundTrip(meCookie, body => {
      body.players.find(p => p.id === meId)
        .decks.push({ id: 'mnew', name: 'A new deck', source: 'manual' });
    });
    assert.equal(res.status, 200, res.text);
  });

  test('only the requester’s own player is taken from the blob', async () => {
    // A private deck smuggled onto Other passes the visible-only check but is
    // discarded by the merge: Other’s stored decks are kept verbatim.
    const res = await roundTrip(meCookie, body => {
      body.players.find(p => p.id === otherId)
        .decks.push({ id: 'oinject', name: 'Injected', source: 'manual', private: true });
    });
    assert.equal(res.status, 200, res.text);

    const admin = await request.get('/api/state').set('Cookie', adminCookie);
    assert.deepEqual(deckIds(admin.body, otherId).sort(), ['opriv', 'opub'],
      'the injected deck was not written');
  });

  test('a visible change to another player is still refused', async () => {
    const res = await roundTrip(meCookie, body => {
      body.players.find(p => p.id === otherId).name = 'Hacked';
    });
    assert.equal(res.status, 403);
  });

  test('the owner round-trips their own private deck losslessly', async () => {
    const res = await roundTrip(meCookie, body => {
      body.players.find(p => p.id === meId)
        .decks.find(d => d.id === 'mpriv').name = 'My renamed secret';
    });
    assert.equal(res.status, 200, res.text);

    const mine = await request.get('/api/state').set('Cookie', meCookie);
    const priv = decksOf(mine.body, meId).find(d => d.id === 'mpriv');
    assert.equal(priv.name, 'My renamed secret');
    assert.equal(priv.private, true, 'still private after the round-trip');
  });

  test('an admin write applies the whole blob unchanged', async () => {
    const got  = await request.get('/api/state').set('Cookie', adminCookie);
    const body = { players: got.body.players, version: got.body.version };
    const other = body.players.find(p => p.id === otherId);
    other.decks = other.decks.filter(d => d.id !== 'opriv');

    const res = await request.post('/api/state').set('Cookie', adminCookie).send(body);
    assert.equal(res.status, 200, res.text);

    const after = await request.get('/api/state').set('Cookie', adminCookie);
    assert.deepEqual(deckIds(after.body, otherId), ['opub'],
      'an admin’s wholesale write does remove it');
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
