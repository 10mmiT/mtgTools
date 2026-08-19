/* Deck fields: folderId, private, folders through the whitelists.
 *
 * This is the plumbing every later Decks-tab ticket stands on: a deck's
 * `folderId` and `private`, and a player's `folders` list, must survive a full
 * client/server round-trip. No user-visible behaviour yet — just that a deck
 * saved with `private: true` and a `folderId` comes back identical after a
 * reload.
 *
 * The fields pass through four explicit whitelists, and anything not on one is
 * silently dropped. Two of those live client-side (state.js), two server-side
 * (routes/state.js), and this file asserts against both against the shipped
 * files:
 *
 *   the client   stateToJSON / hydrateState / savePlayerDecks in a vm sandbox
 *   the server   normalizeDeck / normalizePlayer, seen through the permission
 *                check on POST /api/state, plus a real save-then-reload
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── The client whitelists ─────────────────────────────────────────────────
// state.js loaded on its own: it names only `window.innerWidth` and
// `reconcileColSorts` outside itself at load, so the sandbox stubs those and
// nothing else. The state blob is seeded by assignment, then read back through
// the module's own stateToJSON / hydrateState.

function loadState(stored = {}) {
  const store = new Map(Object.entries(stored));
  const sandbox = {
    window: { innerWidth: 1200 },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    reconcileColSorts() {},
    console: { log() {}, warn() {}, error() {} },
    calls: [],
    fetch: async (url, opts = {}) => {
      sandbox.calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true, status: 200, json: async () => ({ ok: true, version: 1 }) };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/state.js'), sandbox);
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));
  return { run, answer, calls: () => sandbox.calls };
}

test('stateToJSON carries a player’s folders and a deck’s folderId + private', () => {
  const s = loadState();
  s.run(`state.players = [{
    id: 'p1', name: 'P1', colorIdx: 0, wantList: [],
    folders: [{ id: 'f1', name: 'Commander', position: 0 }],
    decks: [{ id: 'd1', source: 'manual', name: 'A deck', folderId: 'f1', private: true }],
  }]`);
  const json = s.answer('stateToJSON()');
  assert.deepStrictEqual(json.players[0].folders, [{ id: 'f1', name: 'Commander', position: 0 }]);
  assert.strictEqual(json.players[0].decks[0].folderId, 'f1');
  assert.strictEqual(json.players[0].decks[0].private, true);
});

test('hydrateState fills the defaults a record written before these fields lacks', () => {
  const s = loadState();
  // A player and a deck with none of the new fields — the old shape.
  s.run(`hydrateState({ players: [{ id: 'p1', name: 'P1', decks: [{ id: 'd1', name: 'Old deck' }] }] })`);
  assert.deepStrictEqual(s.answer('state.players[0].folders'), []);
  assert.strictEqual(s.answer('state.players[0].decks[0].folderId'), null);
  assert.strictEqual(s.answer('state.players[0].decks[0].private'), false);
});

test('the fields survive stateToJSON → hydrateState (a client-side reload)', () => {
  const s = loadState();
  s.run(`state.players = [{
    id: 'p1', name: 'P1', colorIdx: 0, wantList: [],
    folders: [{ id: 'f1', name: 'Retired', position: 3 }],
    decks: [{ id: 'd1', source: 'manual', name: 'A deck', folderId: 'f1', private: true }],
  }]`);
  s.run(`hydrateState(stateToJSON())`);
  assert.deepStrictEqual(s.answer('state.players[0].folders'), [{ id: 'f1', name: 'Retired', position: 3 }]);
  assert.strictEqual(s.answer('state.players[0].decks[0].folderId'), 'f1');
  assert.strictEqual(s.answer('state.players[0].decks[0].private'), true);
});

test('savePlayerDecks sends folderId and private in its whitelist', async () => {
  const s = loadState();
  s.run(`state.players = [{
    id: 'p1', name: 'P1', colorIdx: 0, wantList: [], folders: [],
    decks: [{ id: 'd1', source: 'manual', name: 'A deck', folderId: 'f1', private: true }],
  }]`);
  await s.run(`savePlayerDecks('p1')`);
  const put = s.calls().find(c => c.method === 'PUT');
  assert.ok(put, 'the granular deck save never fired');
  assert.strictEqual(put.body.decks[0].folderId, 'f1');
  assert.strictEqual(put.body.decks[0].private, true);
});

// ── The server whitelists ──────────────────────────────────────────────────
// normalizeDeck / normalizePlayer is what the non-admin permission check
// compares stored-against-incoming through. If a field is absent from the
// normal form, a change to it reads as no change — so the proof it is on the
// whitelist is that flipping it on another player's record is refused, and the
// proof it round-trips is a real save-then-reload.

const { test: stest, describe, beforeEach } = require('node:test');
const supertest = require('supertest');
const Database  = require('better-sqlite3');
const os        = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgfields-'));
process.env.DATA_FILE      = path.join(tmpDir, 'state.json');
process.env.ADMIN_PASSWORD = 'testpass';
process.env.PORT           = '0';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.MTGTOOLS_NO_BACKGROUND = '1';

const dbModule = require('../available-db');
const { app }  = require('../server');
const request  = supertest(app);

function resetDb() {
  const db = dbModule.db;
  db.exec(`
    DELETE FROM sessions;
    DELETE FROM users WHERE username != 'admin';
    DELETE FROM account_requests;
    DELETE FROM app_state;
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

describe('deck fields through the server whitelists', () => {
  let meId, otherId, meCookie, adminCookie;

  beforeEach(async () => {
    resetDb();
    const db = dbModule.db;
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    meId    = uuidv4();
    otherId = uuidv4();

    // Another player owns a private deck in a folder — the record whose fields
    // the check must see, and preserve, when I re-send state without editing it.
    db.prepare("INSERT OR REPLACE INTO app_state (key, value_json, version) VALUES ('state', ?, 0)")
      .run(JSON.stringify({ players: [
        { id: meId, name: 'Me', decks: [], wantList: [], folders: [] },
        { id: otherId, name: 'Other', wantList: [], folders: [{ id: 'f9', name: 'Theirs', position: 0 }],
          decks: [{ id: 'od1', name: 'Their secret', source: 'manual', folderId: 'f9', private: true }] },
      ] }));

    const h = bcrypt.hashSync('pp', 10);
    db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES ('me', ?, 'player', ?)").run(h, meId);
    meCookie    = await loginAs('me', 'pp');
    adminCookie = await loginAs('admin', 'testpass');
  });

  const send = (cookie, players, version = 0) =>
    request.post('/api/state').set('Cookie', cookie).send({ players, version });

  stest('a non-admin re-sending another player’s decks and folders unchanged is accepted', async () => {
    const res = await send(meCookie, [
      { id: meId, name: 'Me', decks: [], wantList: [], folders: [] },
      { id: otherId, name: 'Other', wantList: [], folders: [{ id: 'f9', name: 'Theirs', position: 0 }],
        decks: [{ id: 'od1', name: 'Their secret', source: 'manual', folderId: 'f9', private: true }] },
    ]);
    assert.strictEqual(res.status, 200);
  });

  stest('flipping another player’s deck to public is a change the check catches (private is on the whitelist)', async () => {
    const res = await send(meCookie, [
      { id: meId, name: 'Me', decks: [], wantList: [], folders: [] },
      { id: otherId, name: 'Other', wantList: [], folders: [{ id: 'f9', name: 'Theirs', position: 0 }],
        decks: [{ id: 'od1', name: 'Their secret', source: 'manual', folderId: 'f9', private: false }] },
    ]);
    assert.strictEqual(res.status, 403);
  });

  stest('moving another player’s deck to a different folder is a change too (folderId is on the whitelist)', async () => {
    const res = await send(meCookie, [
      { id: meId, name: 'Me', decks: [], wantList: [], folders: [] },
      { id: otherId, name: 'Other', wantList: [], folders: [{ id: 'f9', name: 'Theirs', position: 0 }],
        decks: [{ id: 'od1', name: 'Their secret', source: 'manual', folderId: 'f-elsewhere', private: true }] },
    ]);
    assert.strictEqual(res.status, 403);
  });

  stest('renaming another player’s folder is a change (folders is on the whitelist)', async () => {
    const res = await send(meCookie, [
      { id: meId, name: 'Me', decks: [], wantList: [], folders: [] },
      { id: otherId, name: 'Other', wantList: [], folders: [{ id: 'f9', name: 'Renamed', position: 0 }],
        decks: [{ id: 'od1', name: 'Their secret', source: 'manual', folderId: 'f9', private: true }] },
    ]);
    assert.strictEqual(res.status, 403);
  });

  stest('a player editing their own deck’s folderId and private is accepted, and it round-trips', async () => {
    const res = await send(meCookie, [
      { id: meId, name: 'Me', wantList: [], folders: [{ id: 'fm', name: 'Mine', position: 0 }],
        decks: [{ id: 'md1', name: 'My deck', source: 'manual', folderId: 'fm', private: true }] },
      { id: otherId, name: 'Other', wantList: [], folders: [{ id: 'f9', name: 'Theirs', position: 0 }],
        decks: [{ id: 'od1', name: 'Their secret', source: 'manual', folderId: 'f9', private: true }] },
    ]);
    assert.strictEqual(res.status, 200);

    // Save-then-reload: the fields are stored verbatim and come back on GET.
    const back = await request.get('/api/state').set('Cookie', adminCookie);
    const me   = back.body.players.find(p => p.id === meId);
    assert.deepStrictEqual(me.folders, [{ id: 'fm', name: 'Mine', position: 0 }]);
    assert.strictEqual(me.decks[0].folderId, 'fm');
    assert.strictEqual(me.decks[0].private, true);
  });
});
