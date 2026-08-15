/* Which notes you have seen, kept with the person.
 *
 * The per-tab note opens itself once and then never again, and "never again"
 * has to mean on the laptop too. So seen-ness is a set of tab ids on the
 * account beside the theme, the playmat and card motion — not a flag in one
 * browser's storage, which would re-open all seven on the next device.
 *
 * Nothing reads it yet. That is the point of asserting it on its own: every
 * piece built on top of it asks one question ("have they read this?"), and
 * the answer has to already be right on every device before there is a dialog
 * to be wrong about.
 *
 * Three layers, all against the shipped files:
 *
 *   the column   a database made before the set existed, opened by
 *                available-db.js, as test/collectionowner.test.js does
 *   the seam     the real /api/prefs, driven over HTTP: the round trip, the
 *                ids it refuses, and what a patch leaves alone
 *   the browser  public/js/state.js in a vm sandbox, which is where the
 *                comma-separated string becomes a list the client can read
 */

'use strict';

const { test, describe, before } = require('node:test');
const assert    = require('node:assert/strict');
const supertest = require('supertest');
const bcrypt    = require('bcryptjs');
const fs        = require('node:fs');
const os        = require('node:os');
const path      = require('node:path');
const vm        = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── The column ────────────────────────────────────────────────────────────
/* A database in the shape preferences were stored in before any note had been
 * written, with somebody's appearance already in it. Written first, then
 * opened by the module that owns the schema — so the migration under test is
 * the shipped one and not a copy of its SQL. */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgfaq-'));
{
  const Database = require('better-sqlite3');
  const legacy = new Database(path.join(tmpDir, 'available.db'));
  legacy.exec(`
    CREATE TABLE users (
      username      TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'player',
      player_id     TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE user_prefs (
      username     TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
      theme        TEXT    NOT NULL DEFAULT 'dark',
      playmat_kind TEXT    NOT NULL DEFAULT 'none',
      playmat_ref  TEXT,
      playmat_url  TEXT,
      card_motion  TEXT    NOT NULL DEFAULT 'on',
      updated_at   INTEGER NOT NULL
    );
  `);
  legacy.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run('olive', bcrypt.hashSync('opw', 10), 'player');
  legacy.prepare(`INSERT INTO user_prefs
      (username, theme, playmat_kind, playmat_ref, playmat_url, card_motion, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('olive', 'sepia', 'scryfall', 'abc-123', 'https://img.example/art.jpg', 'off', 1);
  legacy.close();
}

process.env.DATA_FILE              = path.join(tmpDir, 'state.json');
process.env.ADMIN_PASSWORD         = 'testpass';
process.env.PORT                   = '0';
process.env.AUTH_RATE_LIMIT_MAX    = '1000';
process.env.MTGTOOLS_NO_BACKGROUND = '1';

const { app } = require('../server');
const { db }  = require('../available-db');
const request = supertest(app);

function addUser(username, password) {
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, bcrypt.hashSync(password, 10), 'player');
}

async function loginAs(username, password) {
  const res = await request.post('/api/auth/login')
    .send({ username, password }).set('Content-Type', 'application/json');
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw.map(c => c.split(';')[0]).join('; ') : raw;
}

const get = cookie => request.get('/api/prefs').set('Cookie', cookie);
const put = (cookie, body) => request.put('/api/prefs').set('Cookie', cookie).send(body);

describe('the column', () => {
  test('a preference row written before the set existed has seen nothing', async () => {
    const cookie = await loginAs('olive', 'opw');
    const res = await get(cookie);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.faqSeen, [],
      'the migration must default to the same empty set a new row starts at');
  });

  test('and keeps every preference it already had', async () => {
    const cookie = await loginAs('olive', 'opw');
    const res = await get(cookie);
    assert.equal(res.body.theme, 'sepia');
    assert.equal(res.body.playmatKind, 'scryfall');
    assert.equal(res.body.playmatRef, 'abc-123');
    assert.equal(res.body.cardMotion, 'off');
  });

  test('the column is not nullable, so no row can read back as a null', () => {
    const col = db.prepare("SELECT * FROM pragma_table_info('user_prefs') WHERE name = 'faq_seen'").get();
    assert.ok(col, 'user_prefs has no faq_seen column');
    assert.equal(col.notnull, 1);
    assert.equal(col.dflt_value, "''", 'the default is the empty set, not a null');
  });
});

// ── The seam ──────────────────────────────────────────────────────────────
describe('the seam', () => {
  before(() => { addUser('alice', 'apw'); addUser('bob', 'bpw'); });

  test('someone who has never dismissed a note gets an empty list', async () => {
    const cookie = await loginAs('alice', 'apw');
    const res = await get(cookie);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.faqSeen, [],
      'a null is not something the client can walk, and neither is a bare string');
  });

  test('a note dismissed on one device is dismissed on the next sign-in', async () => {
    const first = await loginAs('alice', 'apw');
    const set   = await put(first, { faqSeen: ['deckview'] });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body.faqSeen, ['deckview']);

    // A second session is the other device: same person, a cookie that has
    // never seen the first one, and no browser storage in the picture at all.
    const second = await loginAs('alice', 'apw');
    assert.notEqual(second, first);
    assert.deepEqual((await get(second)).body.faqSeen, ['deckview']);
  });

  test('the tabs are independent — reading one note does not mark another', async () => {
    const cookie = await loginAs('alice', 'apw');
    await put(cookie, { faqSeen: [] });
    await put(cookie, { faqSeen: ['sets'] });
    const res = await put(cookie, { faqSeen: ['sets', 'lands'] });
    assert.deepEqual(res.body.faqSeen, ['sets', 'lands']);
    assert.deepEqual((await get(cookie)).body.faqSeen, ['sets', 'lands'],
      'the other five are still unread');
  });

  test('every one of the seven tabs is storable', async () => {
    const cookie = await loginAs('alice', 'apw');
    const all = ['available', 'collections', 'scryfall', 'sets', 'pick', 'lands', 'deckview'];
    const res = await put(cookie, { faqSeen: all });
    assert.equal(res.status, 200, `one of ${all.join(', ')} was refused`);
    assert.deepEqual([...res.body.faqSeen].sort(), [...all].sort());
  });

  test('a tab id no note belongs to is rejected rather than stored', async () => {
    const cookie = await loginAs('alice', 'apw');
    await put(cookie, { faqSeen: ['sets'] });
    // `wants`, `card`, `players` and `admin` are tabs the app really has and
    // the spec deliberately leaves without a note — a stored id for one of
    // them would be a note that can never open, on every device.
    for (const bad of ['wants', 'players', 'card', 'admin', 'DECKVIEW', '', 'sets,lands']) {
      const res = await put(cookie, { faqSeen: [bad] });
      assert.equal(res.status, 400, `${JSON.stringify(bad)} should not be storable`);
    }
    assert.deepEqual((await get(cookie)).body.faqSeen, ['sets'],
      'a rejected write must leave what was there alone');
  });

  test('a set that is not a list of ids is rejected', async () => {
    const cookie = await loginAs('alice', 'apw');
    for (const bad of ['sets', 42, true, null, { sets: true }, ['sets', 7]]) {
      const res = await put(cookie, { faqSeen: bad });
      assert.equal(res.status, 400, `${JSON.stringify(bad)} should not be storable`);
    }
  });

  test('the same tab twice is one tab', async () => {
    const cookie = await loginAs('alice', 'apw');
    const res = await put(cookie, { faqSeen: ['pick', 'pick'] });
    assert.deepEqual(res.body.faqSeen, ['pick'],
      'a set, not a log — dismissing twice cannot grow the row forever');
  });

  test('marking a note read leaves theme, playmat and card motion alone', async () => {
    const cookie = await loginAs('bob', 'bpw');
    await put(cookie, {
      theme: 'contrast', cardMotion: 'off',
      playmatKind: 'scryfall', playmatRef: 'abc-123', playmatUrl: 'https://img.example/art.jpg',
    });
    const res = await put(cookie, { faqSeen: ['available'] });
    assert.deepEqual(res.body.faqSeen, ['available']);
    assert.equal(res.body.theme, 'contrast');
    assert.equal(res.body.cardMotion, 'off');
    assert.equal(res.body.playmatKind, 'scryfall');
    assert.equal(res.body.playmatRef, 'abc-123');
  });

  test('setting any other preference leaves the set alone', async () => {
    const cookie = await loginAs('bob', 'bpw');
    await put(cookie, { faqSeen: ['available', 'scryfall'] });

    assert.deepEqual((await put(cookie, { theme: 'light' })).body.faqSeen,
      ['available', 'scryfall']);
    assert.deepEqual((await put(cookie, { cardMotion: 'on' })).body.faqSeen,
      ['available', 'scryfall']);
    // And clearing the mat, which rewrites the row from a different branch.
    assert.deepEqual((await put(cookie, { playmatKind: 'none' })).body.faqSeen,
      ['available', 'scryfall']);
    assert.deepEqual((await get(cookie)).body.faqSeen, ['available', 'scryfall']);
  });

  test('one person can neither read nor write another\'s', async () => {
    const alice = await loginAs('alice', 'apw');
    const bob   = await loginAs('bob',   'bpw');
    await put(alice, { faqSeen: ['lands'] });
    await put(bob,   { faqSeen: ['deckview'] });

    assert.deepEqual((await get(alice)).body.faqSeen, ['lands']);
    assert.deepEqual((await get(bob)).body.faqSeen, ['deckview']);

    // There is no path parameter to name someone else's row with, and naming
    // one in the body reaches nothing either.
    await put(bob, { faqSeen: ['sets'], username: 'alice', user_id: 'alice' });
    assert.deepEqual((await get(alice)).body.faqSeen, ['lands']);
  });

  test('reading it needs a session', async () => {
    assert.equal((await request.get('/api/prefs')).status, 401);
    assert.equal((await request.put('/api/prefs').send({ faqSeen: ['sets'] })).status, 401);
  });

  test('it is one column of ids, not a row per note', async () => {
    const cookie = await loginAs('alice', 'apw');
    await put(cookie, { faqSeen: ['sets', 'lands'] });
    const row = db.prepare('SELECT faq_seen FROM user_prefs WHERE username = ?').get('alice');
    assert.equal(row.faq_seen, 'sets,lands');
    // Which is exactly why the seam hands back a list: the storage shape is
    // the server's business and no client should have to split a string.
    assert.ok(Array.isArray((await get(cookie)).body.faqSeen));
  });
});

// ── The browser's copy ────────────────────────────────────────────────────
/* The client half, run from the shipped state.js rather than described. In
 * open mode there is no row to hold the set, so the browser is the whole
 * record — the same two-sided arrangement card motion has, and the reason
 * `stored` is on every response. */
/* state.js in a context that looks enough like a browser to run: storage of
 * the test's choosing, and an /api/prefs that answers the way the real one
 * does — a GET of the record, and a PUT that merges the patch and says whether
 * it kept it. That contract is not assumed here; it is what the seam tests
 * above drive the real endpoint for.
 *
 * `evaluate` rather than reading the sandbox object, because a top-level
 * `const` in a classic script is a lexical binding of the context and not a
 * property of its global — the same way test/motion.test.js reaches into the
 * shipped motion.js. */
function loadState({ stored = true, faqSeen = [], local = null } = {}) {
  const store = new Map();
  if (local !== null) store.set('mtgtools_faq_seen', local);

  const record = {
    theme: 'dark', playmatKind: 'none', playmatRef: null, playmatUrl: null,
    cardMotion: 'on', faqSeen,
  };

  const sandbox = {
    console,
    localStorage: {
      getItem:    k => (store.has(k) ? store.get(k) : null),
      setItem:    (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    window: { innerWidth: 1280 },
    async fetch(_url, init) {
      if (init?.method === 'PUT') Object.assign(record, JSON.parse(init.body));
      return { ok: true, json: async () => ({ ...record, stored }) };
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/state.js'), sandbox, { filename: 'state.js' });

  const evaluate = expr => vm.runInContext(expr, sandbox);
  // Read back through JSON: an array built inside the context has that
  // context's Array.prototype, and a strict deep-equal against a host array
  // fails on the prototype rather than on anything this test cares about.
  const seen = () => JSON.parse(evaluate('JSON.stringify(prefs.faqSeen)'));
  return { evaluate, seen, store };
}

describe('the browser\'s copy', () => {
  test('prefs carry the set as a list before anything has been fetched', () => {
    const { evaluate, seen } = loadState();
    assert.deepEqual(seen(), [],
      'the client must be able to walk it on the first frame, fetch or no fetch');
  });

  test('a signed-in person\'s set is the server\'s, and is mirrored locally', async () => {
    const { evaluate, seen, store } = loadState({ stored: true, faqSeen: ['sets'] });
    await evaluate('loadPrefs()');
    evaluate('syncFaqSeen()');
    assert.deepEqual(seen(), ['sets']);
    assert.equal(store.get('mtgtools_faq_seen'), 'sets',
      'the browser copy is what the next load reads before the fetch lands');
  });

  test('in open mode the browser copy is the record, and is read back', async () => {
    const { evaluate, seen } = loadState({ stored: false, faqSeen: [], local: 'lands,pick' });
    await evaluate('loadPrefs()');
    evaluate('syncFaqSeen()');
    assert.deepEqual(seen(), ['lands', 'pick'],
      'without an account the reload has nowhere else to remember it');
  });

  test('marking a note read writes the browser copy, so a reload survives it', async () => {
    const { evaluate, seen, store } = loadState({ stored: false, faqSeen: [] });
    await evaluate('saveFaqSeen("deckview")');
    assert.deepEqual(seen(), ['deckview']);
    assert.equal(store.get('mtgtools_faq_seen'), 'deckview');

    await evaluate('saveFaqSeen("sets")');
    assert.deepEqual(seen(), ['deckview', 'sets'],
      'a second note joins the set rather than replacing it');
  });

  test('a tab id the client does not know is not written either', async () => {
    const { evaluate, seen, store } = loadState({ stored: false, faqSeen: [] });
    await evaluate('saveFaqSeen("players")');
    assert.deepEqual(seen(), []);
    assert.equal(store.has('mtgtools_faq_seen'), false,
      'the server refuses it, and the browser copy must not disagree with the server');
  });

  test('junk in browser storage is ignored rather than believed', async () => {
    const { evaluate, seen } = loadState({ stored: false, faqSeen: [], local: 'sets,players,,42' });
    await evaluate('loadPrefs()');
    evaluate('syncFaqSeen()');
    assert.deepEqual(seen(), ['sets'],
      'anything hand-edited into storage would otherwise be sent to the server');
  });
});
