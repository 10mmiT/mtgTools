/* The state poll's change detection: a revision instead of the whole payload.
 *
 * Every thirty seconds the page asked the server for all of it — every
 * collection, every card on every shelf — and then stringified the answer to
 * find out whether anything had moved. Nothing usually had. That is a full
 * serialisation on the server and another in the tab, twice a minute, to learn
 * nothing; on a phone it is the most expensive thing the page does while
 * sitting still.
 *
 * So the poll asks with a revision and the server answers "no" cheaply. The
 * revision is two counters: the version the app_state blob already keeps for
 * optimistic concurrency, and a second one the shelf, the built decks and the
 * imports in flight push along, since those live in tables of their own that
 * the blob's version knows nothing about.
 *
 * Two layers, both against the shipped files:
 *
 *   the server   GET /api/state through supertest — what the revision moves
 *                for, what an unchanged poll costs, and that `version` still
 *                means what the concurrency check needs it to mean
 *   the client   js/state.js in a vm sandbox: what the poll asks with, what it
 *                does with "unchanged", and that no payload is ever stringified
 */

'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert    = require('node:assert');
const supertest = require('supertest');
const fs        = require('node:fs');
const path      = require('node:path');
const os        = require('node:os');
const vm        = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgpoll-'));
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
    DELETE FROM collections;
    DELETE FROM collection_imports;
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
  const res = await request.post('/api/auth/login')
    .send({ username, password }).set('Content-Type', 'application/json');
  const set = res.headers['set-cookie'];
  const raw = Array.isArray(set) ? set[0] : set;
  return raw.split(';')[0];
}

// ── The server's revision ─────────────────────────────────────────────────

describe('the revision the poll asks with', () => {
  let cookie;

  beforeEach(async () => { resetDb(); cookie = await loginAs('admin', 'testpass'); });
  after(() => { try { getServer()?.close(); } catch {} });

  const getState = since => request
    .get('/api/state' + (since ? `?since=${encodeURIComponent(since)}` : ''))
    .set('Cookie', cookie);

  test('a poll holding the current revision is answered without the state', async () => {
    const first = await getState();
    assert.strictEqual(typeof first.body.rev, 'string', 'the state arrives with no revision to poll with');

    const again = await getState(first.body.rev);
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.unchanged, true, 'a poll that changed nothing was answered with the whole state');
    assert.ok(!('collections' in again.body), 'the unchanged answer carried the collections anyway');
    assert.ok(!('players' in again.body),     'the unchanged answer carried the players anyway');
  });

  test('an unchanged poll does not read the shelf at all', async () => {
    /* The proof, rather than an assertion about the answer's shape: the
     * collections table is taken away for the length of one poll. A route that
     * still reads it cannot answer; one that short-circuits on the revision
     * never notices it is gone. This is the acceptance criterion — no full
     * serialisation of application state — asserted where it is felt. */
    const first = await getState();
    const db = dbModule.db;
    db.exec('ALTER TABLE collections RENAME TO collections_away');
    let body;
    try { body = (await getState(first.body.rev)).body; }
    finally { db.exec('ALTER TABLE collections_away RENAME TO collections'); }
    assert.strictEqual(body.unchanged, true, 'the poll read every collection in order to say nothing had changed');
  });

  test('a poll holding no revision, or a stale one, gets the whole state', async () => {
    const whole = await getState();
    assert.ok(Array.isArray(whole.body.collections), 'the first load did not get the collections');

    const stale = await getState('0.0.nobody');
    assert.ok(!stale.body.unchanged, 'a stale revision was answered "unchanged"');
    assert.ok(Array.isArray(stale.body.collections), 'a stale revision did not get the collections');
  });

  test('a player, a deck or a want list changing moves it', async () => {
    const before = (await getState()).body;
    const save = await request.post('/api/state').set('Cookie', cookie).send({
      version: before.version,
      players: [{ id: 'p1', name: 'Anna', colorIdx: 0, wantList: [], folders: [],
                  decks: [{ id: 'd1', source: 'manual', name: 'Atraxa' }] }],
    });
    assert.strictEqual(save.status, 200);

    const after = (await getState(before.rev)).body;
    assert.ok(!after.unchanged, 'a new player was still being reported as "nothing changed"');
    assert.strictEqual(after.players.length, 1);

    const want = await request.post('/api/players/p1/wants').set('Cookie', cookie).send({ cardName: 'Sol Ring' });
    assert.strictEqual(want.status, 200);
    assert.ok(!(await getState(after.rev)).body.unchanged,
      'a want list added to elsewhere was still being reported as "nothing changed"');
  });

  test('a collection changing moves it, and does not move the concurrency version', async () => {
    const before = (await getState()).body;
    const add = await request.post('/api/collections').set('Cookie', cookie).send({
      key: 'k1', name: 'Anna’s shelf', source: 'csv', color: '#a855f7',
      cards: { 'Sol Ring': 1 }, entries: 1,
    });
    assert.strictEqual(add.status, 200);

    const after = (await getState(before.rev)).body;
    assert.ok(!after.unchanged, 'a collection added on another device never arrived');
    assert.strictEqual(after.collections.length, 1);
    assert.strictEqual(after.version, before.version,
      'the shelf moved the blob version, which is the concurrency check’s and not its to move');

    const settled = (await getState(after.rev)).body;
    assert.strictEqual(settled.unchanged, true);
    await request.delete('/api/collections/k1').set('Cookie', cookie);
    assert.ok(!(await getState(after.rev)).body.unchanged, 'a collection deleted elsewhere stayed on the shelf');
  });

  test('a deck being built moves it — the built-deck counts are in the payload', async () => {
    // The counts are filtered to decks the requester may see, so the deck has
    // to belong to somebody before its cards can be counted.
    await request.post('/api/state').set('Cookie', cookie).send({
      players: [{ id: 'p1', name: 'Anna', colorIdx: 0, wantList: [], folders: [],
                  decks: [{ id: 'd1', source: 'manual', name: 'Atraxa' }] }],
    });
    const before = (await getState()).body;
    dbModule.db.prepare(
      'INSERT INTO deck_cards (deck_id, card_name, qty, category, board, position) VALUES (?,?,?,?,?,?)'
    ).run('d1', 'Sol Ring', 1, 'Ramp', 'main', 0);

    const after = (await getState(before.rev)).body;
    assert.ok(!after.unchanged, 'a deck filled with cards elsewhere never reached the switcher');
    assert.strictEqual(after.deckCardCounts.d1, 1);
  });

  test('an import started on another device moves it', async () => {
    /* The imports list rides along in the payload so a tab that did not start
     * one still shows it — which it can only do if an import appearing moves
     * the revision. A tab watching an import polls /api/imports instead, but
     * a tab that has never heard of it has nothing to watch with. */
    const before = (await getState()).body;
    dbModule.db.prepare(`
      INSERT INTO collection_imports (key, name, source, col_id, color, status, next_page, entries)
      VALUES ('k1', 'Anna’s shelf', 'archidekt', '123', '#a855f7', 'running', 1, 0)
    `).run();

    const after = (await getState(before.rev)).body;
    assert.ok(!after.unchanged, 'an import running on another device never showed up here');
    assert.strictEqual(after.imports.length, 1);
  });

  test('the owner route still tells a missing collection from a renamed one', async () => {
    /* The revision is pushed along by triggers on the writes themselves, and a
     * trigger's own row changes must not be counted as the statement's — this
     * route reads `changes` to decide whether there was anything to rename. */
    await request.post('/api/collections').set('Cookie', cookie).send({
      key: 'k1', name: 'A shelf', source: 'csv', color: '#a855f7', cards: {}, entries: 0,
    });
    assert.strictEqual((await request.put('/api/collections/k1/owner')
      .set('Cookie', cookie).send({ owner: null })).status, 200);
    assert.strictEqual((await request.put('/api/collections/nope/owner')
      .set('Cookie', cookie).send({ owner: null })).status, 404);
  });

  test('what one person may see is part of it', async () => {
    /* Two sessions holding the same revision are not owed the same payload:
     * private decks are filtered per requester. A revision that ignored who
     * was asking would answer "unchanged" to somebody whose role had just
     * changed under them, and the decks they had earned would never appear. */
    await request.post('/api/state').set('Cookie', cookie).send({
      players: [{ id: 'p1', name: 'Anna', colorIdx: 0, wantList: [], folders: [], decks: [] }],
    });
    await request.post('/api/admin/users').set('Cookie', cookie)
      .send({ username: 'anna', password: 'annapass', role: 'player', playerId: 'p1' });
    const annaCookie = await loginAs('anna', 'annapass');

    const mine  = (await request.get('/api/state').set('Cookie', annaCookie)).body;
    const admin = (await getState()).body;
    assert.notStrictEqual(mine.rev, admin.rev, 'two people owed different payloads share one revision');

    const again = await request.get(`/api/state?since=${encodeURIComponent(mine.rev)}`).set('Cookie', annaCookie);
    assert.strictEqual(again.body.unchanged, true, 'a revision did not work as its own holder’s revision');
  });
});

// ── The client's ask ──────────────────────────────────────────────────────
// state.js loaded on its own, the way test/deckfields.test.js loads it: it
// names only `window.innerWidth` and `reconcileColSorts` outside itself.

function loadState({ payload = {}, ok = true } = {}) {
  const store = new Map();
  const sandbox = {
    window: { innerWidth: 1200 },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    reconcileColSorts() {},
    console: { log() {}, warn() {}, error() {} },
    asked: [],
    fetch: async url => {
      sandbox.asked.push(url);
      return { ok, status: ok ? 200 : 500, json: async () => payload };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/state.js'), sandbox);
  return { run: expr => vm.runInContext(expr, sandbox), asked: () => sandbox.asked };
}

describe('what the tab asks for', () => {
  test('the first ask has no revision to offer; later ones carry the one it was given', async () => {
    const s = loadState({ payload: { collections: [], players: [], version: 3, rev: '3.7.a' } });
    await s.run('fetchStateIfChanged()');
    assert.deepStrictEqual(s.asked(), ['/api/state'], 'a tab with nothing yet still haggled over a revision');

    s.run(`hydrateState({ collections: [], players: [], version: 3, rev: '3.7.a' })`);
    await s.run('fetchStateIfChanged()');
    assert.strictEqual(s.asked()[1], '/api/state?since=3.7.a',
      'the tab threw away the revision it was handed and asked for everything again');
  });

  test('"nothing changed" is nothing to render', async () => {
    const s = loadState({ payload: { unchanged: true, rev: '3.7.a' } });
    s.run(`state.players = [{ id: 'p1', name: 'Anna', colorIdx: 0, wantList: [], folders: [], decks: [] }]`);
    assert.strictEqual(await s.run('fetchStateIfChanged()'), null,
      'an unchanged poll handed back a payload to re-render from');
    assert.strictEqual(s.run('state.players.length'), 1, 'an unchanged poll hydrated over the state anyway');
  });

  test('a payload that cannot be stringified still comes through', async () => {
    /* The point of the whole ticket, asserted the one way that cannot drift:
     * a payload nothing can serialise. If any part of the poll still reaches
     * for JSON.stringify to decide whether anything changed, this throws. */
    const s = loadState();
    s.run(`_circular = { collections: [], players: [], version: 1, rev: '1.1.a' };
           _circular.self = _circular;
           fetch = async () => ({ ok: true, status: 200, json: async () => _circular })`);
    assert.ok(await s.run('fetchStateIfChanged()'),
      'the poll could not carry a payload that does not survive JSON.stringify');
  });

  test('a server that will not answer is not a change', async () => {
    const s = loadState({ ok: false });
    assert.strictEqual(await s.run('fetchStateIfChanged()'), null);
  });

  test('a collection or a deck still arriving holds the poll off', async () => {
    /* Hydrating a poll over a CSV import halfway through reading the file, or
     * over a deck whose name has not landed, throws away the half that is only
     * in memory. The reasons live next to the state they are about. */
    const s = loadState();
    assert.strictEqual(s.run('stateIsMidFlight()'), false, 'a settled tab would not poll at all');

    for (const c of [{ status: 'loading' }, { status: 'updating' }, { status: 'loaded', updating: true }]) {
      s.run(`state.collections = [${JSON.stringify(c)}]`);
      assert.strictEqual(s.run('stateIsMidFlight()'), true,
        `a collection that is ${JSON.stringify(c)} would have been hydrated over`);
    }
    s.run('state.collections = []');
    s.run(`state.players = [{ id: 'p1', decks: [{ id: 'd1', nameStatus: 'loading' }] }]`);
    assert.strictEqual(s.run('stateIsMidFlight()'), true,
      'a deck still fetching its name would have been hydrated over');
  });
});

// ── The poll itself ───────────────────────────────────────────────────────

test('the poll no longer stringifies the state to notice a change', () => {
  /* The static seam, for the same reason the token linter is one: what this
   * asserts is a property of the delivered file that no other seam can reach.
   * refreshState is the tab's half of the cost, and the cost is the ticket —
   * a serialisation of the whole payload here is the thing being removed, and
   * it would come back invisibly, since a poll that stringifies what it was
   * given behaves exactly like one that does not. */
  const refresh = read('public/js/main.js').match(/async function refreshState\(\)[\s\S]*?\n}/)[0];
  assert.ok(!/JSON\.stringify/.test(refresh), 'refreshState still serialises the whole payload to compare it');
});
