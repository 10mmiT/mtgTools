/* The players blob's version — what a write is held to, what a tab adopts, and
 * what a poll may not undo.
 *
 * The blob is optimistic-concurrency state: a write names the version it was
 * made from and is answered with a 409 when that is no longer the stored one.
 * Three ways round that check were found by reading the code and confirmed by
 * driving the routes:
 *
 *   – the deck-list save replaced a player's whole list from the tab's copy
 *     without naming any version, so a stale tab deleted a deck another device
 *     had just added — and handed back a version the tab then adopted, which
 *     let its next whole-state save through over everything newer
 *   – the want-list patches handed back a version the tab adopted whether or
 *     not somebody else had written in between, to the same effect
 *   – the whole-state save took a missing version as "no check"
 *
 * And two on the tab's side: the thirty-second poll could land an answer cut
 * before one of the tab's own saves after it, putting the screen back and the
 * version down; and it rebuilt the Decks tab under a form being typed into.
 *
 * Two layers, both against the shipped files:
 *
 *   the server   the routes through supertest
 *   the tab      js/state.js in a vm sandbox, with main.js's poll — the
 *                "State refresh" block, cut out of the delivered file — beside it
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgversion-'));
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

const storedVersion = () =>
  dbModule.db.prepare("SELECT version FROM app_state WHERE key = 'state'").get()?.version || 0;
const storedPlayers = () =>
  JSON.parse(dbModule.db.prepare("SELECT value_json FROM app_state WHERE key = 'state'").get().value_json).players;

const anna = (decks = [], wantList = []) =>
  ({ id: 'p1', name: 'Anna', colorIdx: 0, wantList, folders: [], decks });
const deck = (id, name) => ({ id, source: 'manual', name });

// ── The server ────────────────────────────────────────────────────────────

describe('what a write is held to', () => {
  let cookie;

  beforeEach(async () => {
    resetDb();
    cookie = await loginAs('admin', 'testpass');
    const made = await request.post('/api/state').set('Cookie', cookie)
      .send({ version: 0, players: [anna([deck('d1', 'Atraxa')], ['Sol Ring'])] });
    assert.strictEqual(made.status, 200, made.text);
  });
  after(() => { try { getServer()?.close(); } catch {} });

  test('a whole-state save that does not say what it was made from is refused', async () => {
    const res = await request.post('/api/state').set('Cookie', cookie)
      .send({ players: [anna()] });
    assert.strictEqual(res.status, 400, 'a save with no version was taken as one with no check');
    assert.deepStrictEqual(storedPlayers()[0].decks.map(d => d.id), ['d1'], 'and it wrote anyway');
  });

  test('a stale whole-state save is a conflict, said as one', async () => {
    const res = await request.post('/api/state').set('Cookie', cookie)
      .send({ version: storedVersion() - 1, players: [anna()] });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.conflict, 'version',
      'the tab cannot tell this 409 from a refusal of the write itself');
  });

  test('a player whose copy is merely behind is told so, not told Forbidden', async () => {
    /* The permission rule compares every other player against the stored one,
     * and a stale copy fails that too. Asked first, it answered a tab that was
     * only behind with a 403 — which reloading does not sound like it fixes. */
    await request.post('/api/admin/users').set('Cookie', cookie)
      .send({ username: 'anna', password: 'annapass', role: 'player', playerId: 'p1' });
    const v = storedVersion();
    await request.post('/api/state').set('Cookie', cookie).send({ version: v,
      players: [anna([deck('d1', 'Atraxa')], ['Sol Ring']), { id: 'p2', name: 'Bob', colorIdx: 1, wantList: [], folders: [], decks: [] }] });

    const annaCookie = await loginAs('anna', 'annapass');
    const res = await request.post('/api/state').set('Cookie', annaCookie)
      .send({ version: v, players: [anna([], ['Sol Ring'])] });
    assert.strictEqual(res.status, 409, res.text);
    assert.strictEqual(res.body.conflict, 'version');
  });

  test('the deck-list save names its version, and a stale one cannot delete a deck it never saw', async () => {
    const seen = storedVersion();
    // Another device adds a deck…
    const elsewhere = await request.put('/api/players/p1/decks').set('Cookie', cookie)
      .send({ version: seen, decks: [deck('d1', 'Atraxa'), deck('d2', 'Krenko')] });
    assert.strictEqual(elsewhere.status, 200, elsewhere.text);
    assert.strictEqual(elsewhere.body.version, seen + 1, 'the write did not answer with the version after it');

    // …and a tab still holding the list from before saves its own copy.
    const stale = await request.put('/api/players/p1/decks').set('Cookie', cookie)
      .send({ version: seen, decks: [deck('d1', 'Atraxa (renamed)')] });
    assert.strictEqual(stale.status, 409, 'a stale deck list was taken');
    assert.strictEqual(stale.body.conflict, 'version');
    assert.deepStrictEqual(storedPlayers()[0].decks.map(d => d.id), ['d1', 'd2'],
      'the deck another device added was deleted');

    const unsaid = await request.put('/api/players/p1/decks').set('Cookie', cookie)
      .send({ decks: [deck('d1', 'Atraxa')] });
    assert.strictEqual(unsaid.status, 400, 'a deck list with no version was taken');
  });

  test('a want patch says whether it wrote, and moves the version only when it did', async () => {
    const v = storedVersion();
    const add = await request.post('/api/players/p1/wants').set('Cookie', cookie).send({ cardName: 'Mana Crypt' });
    assert.deepStrictEqual([add.body.changed, add.body.version], [true, v + 1]);

    const again = await request.post('/api/players/p1/wants').set('Cookie', cookie).send({ cardName: 'Mana Crypt' });
    assert.deepStrictEqual([again.body.changed, again.body.version], [false, v + 1],
      'a card already wanted moved the version anyway');

    const gone = await request.delete(`/api/players/p1/wants/${encodeURIComponent('Sol Ring')}`).set('Cookie', cookie);
    assert.deepStrictEqual([gone.body.changed, gone.body.version], [true, v + 2]);

    const never = await request.delete(`/api/players/p1/wants/${encodeURIComponent('Black Lotus')}`).set('Cookie', cookie);
    assert.deepStrictEqual([never.body.changed, never.body.version], [false, v + 2],
      'removing a card nobody wanted moved the version, and every other tab’s next save to a 409');
  });
});

// ── The tab ───────────────────────────────────────────────────────────────

/** main.js's poll, out of the delivered file: from its heading to the line
 *  that starts the interval, which stays behind — a test decides when to poll. */
const POLL_BLOCK = (() => {
  const src  = read('public/js/main.js');
  const from = src.indexOf('// ── State refresh');
  const to   = src.indexOf('// Poll every 30 seconds');
  assert.ok(from >= 0 && to > from, 'main.js no longer has the State refresh block this test reads');
  return src.slice(from, to);
})();

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const settle = () => new Promise(r => setImmediate(r));

/** js/state.js and the poll, over a stub page. `answer(url, opts)` is the
 *  server; every request is recorded. */
function loadTab(answer = () => reply({ ok: true })) {
  const store = new Map();
  const els   = {};
  const sandbox = {
    window: { innerWidth: 1200, location: { href: '/' } },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    document: {
      visibilityState: 'visible',
      body: { appendChild(node) { els[node.id] = node; } },
      getElementById: id => els[id] || null,
      createElement: () => ({ classList: { add() {}, remove() {} }, setAttribute() {} }),
      // An open + Add Deck form, when the test says there is one.
      querySelector: sel => (sel === '.add-deck-form.open' && sandbox.formOpen ? {} : null),
    },
    formOpen: false,
    reconcileColSorts() {},
    console: { log() {}, warn() {}, error() {} },
    alerts: [],
    alert: msg => sandbox.alerts.push(String(msg)),
    setTimeout: () => 1, clearTimeout() {},
    calls: [],
    fetch: async (url, opts = {}) => {
      sandbox.calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      return answer(url, opts);
    },
    // What renderAll draws with — counted, not drawn.
    renders: 0,
    renderPlayers() { sandbox.renders++; },
    renderCollections() {}, renderResults() {}, renderWantList() {}, renderSetCards() {},
    dbPopulateDeckSel() {}, currentSet: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/state.js'), sandbox);
  vm.runInContext(POLL_BLOCK, sandbox);
  const run    = expr => vm.runInContext(expr, sandbox);
  const answerOf = expr => JSON.parse(run(`JSON.stringify(${expr})`));
  return {
    run, answer: answerOf, sandbox, els,
    gets: () => sandbox.calls.filter(c => c.method === 'GET' && c.url.startsWith('/api/state')),
    decks: () => answerOf(`state.players[0].decks.map(d => d.name)`),
  };
}

const PAYLOAD = (version, decks, extra = {}) => ({
  collections: [], deckCardCounts: {}, imports: [], version, rev: `${version}.0.admin`,
  players: [{ id: 'p1', name: 'Anna', colorIdx: 0, wantList: [], folders: [],
              decks: decks.map((name, i) => ({ id: `d${i}`, source: 'manual', name })) }],
  ...extra,
});

describe('what the poll may not undo', () => {
  test('an answer cut before one of our saves, arriving after it, is thrown away', async () => {
    const held = deferred();
    const tab  = loadTab((url, opts) => (opts.method === 'POST'
      ? reply({ ok: true, version: 4 })
      : held.promise));
    tab.run(`hydrateState(${JSON.stringify(PAYLOAD(3, ['Atraxa']))}); state.version = 3`);

    const polling = tab.run('refreshState()');
    await settle();
    tab.run(`state.players[0].decks.push({ id: 'd9', source: 'manual', name: 'Krenko' })`);
    assert.strictEqual(await tab.run('saveToStorage()'), true);

    // The server cut this before the save landed: version 3, no Krenko.
    held.resolve(reply(PAYLOAD(3, ['Atraxa'])));
    await polling;

    assert.deepStrictEqual(tab.decks(), ['Atraxa', 'Krenko'], 'the poll put the screen back to before the save');
    assert.strictEqual(tab.run('state.version'), 4, 'the poll put the version back, so the next save is a false 409');
    assert.strictEqual(tab.sandbox.renders, 0, 'the thrown-away answer was drawn anyway');
  });

  test('nor is one landed while a save of ours is still out', async () => {
    const held = deferred();
    const tab  = loadTab(() => held.promise);
    tab.run(`hydrateState(${JSON.stringify(PAYLOAD(3, ['Atraxa']))}); state.version = 3`);
    const saving = tab.run('saveToStorage()');
    const saves  = tab.run('stateSaveSeq');
    assert.strictEqual(tab.run(`takePolledState(${JSON.stringify(PAYLOAD(3, ['Atraxa']))}, ${saves})`), false,
      'an answer was hydrated over a save still in the air');
    assert.strictEqual(tab.run('stateIsMidFlight()'), true, 'a save in the air does not hold the poll off');
    held.resolve(reply({ ok: true, version: 4 }));
    await saving;
    assert.strictEqual(tab.run('stateIsMidFlight()'), false);
  });

  test('the version is never lowered', () => {
    const tab = loadTab();
    tab.run(`hydrateState(${JSON.stringify(PAYLOAD(7, ['Atraxa']))}); state.version = 7`);
    assert.strictEqual(tab.run(`takePolledState(${JSON.stringify(PAYLOAD(5, ['Old']))}, stateSaveSeq)`), false);
    assert.strictEqual(tab.run('state.version'), 7);
    assert.deepStrictEqual(tab.decks(), ['Atraxa'], 'an answer older than what the tab holds was taken in');

    assert.strictEqual(tab.run(`takePolledState(${JSON.stringify(PAYLOAD(8, ['New']))}, stateSaveSeq)`), true);
    assert.strictEqual(tab.run('state.version'), 8);
    assert.deepStrictEqual(tab.decks(), ['New']);
  });

  test('an open edit form holds the poll off, and is still open afterwards', async () => {
    const tab = loadTab(() => reply(PAYLOAD(5, ['Renamed elsewhere'])));
    tab.run(`hydrateState(${JSON.stringify(PAYLOAD(3, ['Atraxa']))}); state.version = 3`);
    tab.run('state.players[0].decks[0].editing = true');

    await tab.run('refreshState()');
    assert.strictEqual(tab.run('state.players[0].decks[0].editing'), true, 'the poll closed the form being typed in');
    assert.deepStrictEqual(tab.decks(), ['Atraxa']);
    assert.strictEqual(tab.sandbox.renders, 0, 'the Decks tab was rebuilt under the form');

    // + Add Deck is a form in the markup rather than a flag on a deck.
    tab.run('state.players[0].decks[0].editing = false');
    tab.sandbox.formOpen = true;
    assert.strictEqual(tab.run('stateIsMidFlight()'), true, 'an open + Add Deck form does not hold the poll off');

    // Put away, the next poll lands.
    tab.sandbox.formOpen = false;
    await tab.run('refreshStateNow()');
    assert.deepStrictEqual(tab.decks(), ['Renamed elsewhere']);
    assert.strictEqual(tab.sandbox.renders, 1);
  });

  test('a form opened while the answer was on its way still holds it off', async () => {
    const held = deferred();
    const tab  = loadTab(() => held.promise);
    tab.run(`hydrateState(${JSON.stringify(PAYLOAD(3, ['Atraxa']))}); state.version = 3`);
    const polling = tab.run('refreshState()');
    await settle();
    tab.run('state.players[0].decks[0].editing = true');
    held.resolve(reply(PAYLOAD(5, ['Renamed elsewhere'])));
    await polling;
    assert.strictEqual(tab.run('state.players[0].decks[0].editing'), true);
    assert.deepStrictEqual(tab.decks(), ['Atraxa']);
  });
});

describe('a save that does not take', () => {
  test('renderAll exists, and is what a conflict redraws with', async () => {
    assert.match(read('public/js/main.js'), /^function renderAll\(\)/m, 'main.js declares no renderAll');
    const tab = loadTab((url, opts) => (opts.method === 'POST'
      ? reply({ error: 'Conflict', conflict: 'version' }, 409)
      : reply(PAYLOAD(9, ['Theirs']))));
    tab.run(`hydrateState(${JSON.stringify(PAYLOAD(3, ['Mine']))}); state.version = 3`);

    assert.strictEqual(await tab.run('saveToStorage()'), false);
    assert.deepStrictEqual(tab.decks(), ['Theirs'], 'the conflict did not reload the state');
    assert.strictEqual(tab.run('state.version'), 9);
    assert.strictEqual(tab.sandbox.renders, 1,
      'the screen was left showing the refused change under an alert saying it was gone');
    assert.strictEqual(tab.sandbox.alerts.length, 1);
  });

  test('the deck-list save names the version it was made from', async () => {
    const tab = loadTab(() => reply({ ok: true, version: 4 }));
    tab.run(`hydrateState(${JSON.stringify(PAYLOAD(3, ['Atraxa']))}); state.version = 3`);
    assert.strictEqual(await tab.run(`savePlayerDecks('p1')`), true);
    const put = tab.sandbox.calls.find(c => c.method === 'PUT');
    assert.strictEqual(put.body.version, 3, 'the deck list went without the version it was made from');
    assert.strictEqual(tab.run('state.version'), 4);
  });

  test('a refusal says the server’s reason, and puts the screen back to what it holds', async () => {
    const tab = loadTab((url, opts) => (opts.method === 'PUT'
      ? reply({ error: 'Deck d9 already belongs to another player' }, 409)
      : reply(PAYLOAD(3, ['Atraxa']))));
    tab.run(`hydrateState(${JSON.stringify(PAYLOAD(3, ['Atraxa']))}); state.version = 3`);
    tab.run(`state.players[0].decks.push({ id: 'd9', source: 'manual', name: 'Not mine' })`);

    assert.strictEqual(await tab.run(`savePlayerDecks('p1')`), false);
    assert.match(tab.els.saveNotice?.textContent || '', /Deck d9 already belongs to another player/,
      'the refusal was not said, or not in the server’s words');
    assert.deepStrictEqual(tab.decks(), ['Atraxa'], 'the refused change stayed on screen');
    assert.strictEqual(tab.sandbox.alerts.length, 0, 'a refusal was announced as somebody else’s conflict');
    assert.ok(!tab.sandbox.calls.some(c => c.method === 'POST'),
      'a refusal was sent again down the whole-state path, to be refused again');
  });

  test('a server that cannot answer leaves the change on this device, and says so', async () => {
    const tab = loadTab(() => reply({ error: 'boom' }, 500));
    tab.run(`hydrateState(${JSON.stringify(PAYLOAD(3, ['Atraxa']))}); state.version = 3`);
    assert.strictEqual(await tab.run(`savePlayerDecks('p1')`), false);
    assert.deepStrictEqual(tab.sandbox.calls.map(c => c.method), ['PUT', 'POST'],
      'a deck save the server could not answer was not tried down the whole-state path');
    assert.match(tab.els.saveNotice?.textContent || '', /only on this device/, 'a failed save was silent');
    assert.ok(tab.run(`localStorage.getItem('mtgtools_v3')`), 'the change was not kept on this device');
  });

  test('nor can one that is unreachable', async () => {
    const tab = loadTab(() => { throw new TypeError('Failed to fetch'); });
    tab.run(`hydrateState(${JSON.stringify(PAYLOAD(3, ['Atraxa']))}); state.version = 3`);
    assert.strictEqual(await tab.run('saveToStorage()'), false);
    assert.match(tab.els.saveNotice?.textContent || '', /only on this device/);
  });

  test('a session that has ended goes to the login', async () => {
    const tab = loadTab(() => reply({ error: 'Unauthorized' }, 401));
    tab.run(`hydrateState(${JSON.stringify(PAYLOAD(3, ['Atraxa']))}); state.version = 3`);
    assert.strictEqual(await tab.run('saveToStorage()'), false);
    assert.strictEqual(tab.run('window.location.href'), '/login');
  });
});

describe('the version a want patch hands back', () => {
  async function patched(answerBody, { remove = false } = {}) {
    const tab = loadTab((url, opts) => (opts.method ? reply(answerBody) : reply(PAYLOAD(9, ['Atraxa']))));
    tab.run(`hydrateState(${JSON.stringify(PAYLOAD(5, ['Atraxa']))}); state.version = 5`);
    await tab.run(`writeWant('p1', 'Sol Ring', ${remove})`);
    await settle();
    return tab;
  }

  test('is adopted when it is the one after ours', async () => {
    const tab = await patched({ ok: true, version: 6, changed: true });
    assert.strictEqual(tab.run('state.version'), 6);
    assert.deepStrictEqual(tab.gets(), [], 'a tab in step went and fetched the state anyway');
  });

  test('is ours already when there was nothing to write', async () => {
    const tab = await patched({ ok: true, version: 5, changed: false }, { remove: true });
    assert.strictEqual(tab.run('state.version'), 5);
    assert.deepStrictEqual(tab.gets(), []);
  });

  test('is not adopted when somebody else wrote in between — the state is fetched instead', async () => {
    const tab = await patched({ ok: true, version: 8, changed: true });
    assert.notStrictEqual(tab.run('state.version'), 8,
      'adopted a version this tab never synced to — its next whole-state save would overwrite the other write');
    assert.strictEqual(tab.gets().length, 1, 'the tab learnt it was behind and did nothing about it');
    assert.strictEqual(tab.run('state.version'), 9, 'the refresh it asked for did not land');
  });

  test('nor when the patch had nothing to write but the version moved anyway', async () => {
    const tab = await patched({ ok: true, version: 6, changed: false });
    assert.strictEqual(tab.gets().length, 1);
    assert.strictEqual(tab.run('state.version'), 9);
  });
});
