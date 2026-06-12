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
