/* Private decks — the whole rule, server and tile.
 *
 * A private deck is visible to its owner and to admins, and to nobody else: the
 * server withholds both its metadata (from the players array) and its size
 * (from deckCardCounts) on GET /api/state, keeps it through a neighbour's POST,
 * and 404s its cards and snapshots for anyone else. Those three are the first
 * three describes, over a real server. The last four are the half a person
 * touches — the ⋯ row that sets the flag, the badge that says it is set, and
 * both of them absent in open mode — driven against the shipped js/players.js
 * in a vm sandbox, which needs no server and no environment.
 *
 * Open mode's inert-flag *read* case lives in deckprivacy-open.test.js, since
 * the server decides that once, when middleware/auth reads the environment at
 * require time. The client decides it per render off the session, so its open
 * mode is a fixture rather than a process.
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
const vm        = require('node:vm');   // the tile half, below, loads js/players.js

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

describe('Deck-card and snapshot reads 404 a private deck for a non-owner', () => {
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
          { id: 'mpriv', name: 'My secret', source: 'manual', private: true },
        ] },
        { id: otherId, name: 'Other', wantList: [], folders: [], decks: [
          { id: 'opub', name: 'Their public', source: 'manual' },
          { id: 'opriv', name: 'Their secret', source: 'manual', private: true },
        ] },
      ] }));
    addCards('mpriv', 2); addCards('opub', 3); addCards('opriv', 4);

    const h = bcrypt.hashSync('pp', 10);
    db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES ('me', ?, 'player', ?)").run(h, meId);
    meCookie    = await loginAs('me', 'pp');
    adminCookie = await loginAs('admin', 'testpass');
  });

  const cardsUrl = (playerId, deckId) => `/api/players/${playerId}/decks/${deckId}/cards`;
  const snapsUrl = (playerId, deckId) => `/api/players/${playerId}/decks/${deckId}/snapshots`;

  test('GET …/cards 404s for a non-owner on a private deck', async () => {
    const res = await request.get(cardsUrl(otherId, 'opriv')).set('Cookie', meCookie);
    assert.equal(res.status, 404, 'existence is hidden, not confirmed with a 403');
  });

  test('GET …/cards succeeds for the owner of a private deck', async () => {
    const res = await request.get(cardsUrl(meId, 'mpriv')).set('Cookie', meCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.cards[0].qty, 2);
  });

  test('GET …/cards succeeds for an admin on another player’s private deck', async () => {
    const res = await request.get(cardsUrl(otherId, 'opriv')).set('Cookie', adminCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.cards[0].qty, 4);
  });

  test('GET …/cards is unaffected for a public deck', async () => {
    const res = await request.get(cardsUrl(otherId, 'opub')).set('Cookie', meCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.cards[0].qty, 3);
  });

  test('GET …/snapshots 404s for a non-owner on a private deck', async () => {
    const res = await request.get(snapsUrl(otherId, 'opriv')).set('Cookie', meCookie);
    assert.equal(res.status, 404);
  });

  test('GET …/snapshots succeeds for the owner of a private deck', async () => {
    const res = await request.get(snapsUrl(meId, 'mpriv')).set('Cookie', meCookie);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.snapshots));
  });

  test('GET …/snapshots succeeds for an admin on another player’s private deck', async () => {
    const res = await request.get(snapsUrl(otherId, 'opriv')).set('Cookie', adminCookie);
    assert.equal(res.status, 200);
  });

  test('GET …/snapshots/:id 404s for a non-owner on a private deck', async () => {
    const res = await request.get(snapsUrl(otherId, 'opriv') + '/1').set('Cookie', meCookie);
    assert.equal(res.status, 404);
  });
});

/* ── The tile: the private toggle and the lock badge ─────────────────────────
 *
 * Everything above is the server's half — what a stranger's GET and POST may
 * see and keep. This is the half a person touches: the ⋯ row that sets the
 * flag, the badge that says it is set, and the two of them absent in open
 * mode, where the server cannot enforce the flag and so the app must not offer
 * it (docs/design/spec-deck-grid-and-folders.md, "Open mode — the flag is
 * ignored").
 *
 * Asserted against the shipped js/players.js in a vm sandbox, the seam
 * deckscope/deckfolders use: the tab is loaded with a state and a session, and
 * read back as the markup it drew and the writes it sent.
 */

const ROOT    = path.join(__dirname, '..');
const readSrc = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* Tim has one public deck and one private one — the two the ⋯ must speak
 * differently to. Anna is somebody else, whose private deck reaches an admin
 * (and nobody else) and must wear the badge in their Everyone view. */
const UI_PLAYERS = [
  { id: 'p-tim', name: 'Tim', colorIdx: 0, wantList: [], folders: [], decks: [
    { id: 'd-open',   source: 'manual', name: 'Krenko' },
    { id: 'd-secret', source: 'manual', name: 'The brew', private: true },
  ] },
  { id: 'p-anna', name: 'Anna', colorIdx: 1, wantList: [], folders: [], decks: [
    { id: 'd-anna', source: 'manual', name: 'Atraxa', private: true },
  ] },
];

const UI_COUNTS = { 'd-open': 60, 'd-secret': 99, 'd-anna': 60 };

const AS_TIM   = { username: 'tim',   role: 'player', playerId: 'p-tim' };
const AS_ADMIN = { username: 'admin', role: 'admin',  playerId: null };
// Open mode's session: no account exists, so everybody is `guest` — and the
// guest is role admin, which is what makes the server-side filter a no-op.
// Who you are there is the name remembered behind Available@'s "Who are you?".
const AS_GUEST = { username: 'guest', role: 'admin',  playerId: null };

/* `serverTakesIt`:
 *   true       every write is accepted.
 *   false      every write is refused, down to the localStorage fallback.
 *   'conflict' the granular write is refused and the whole-state POST behind it
 *              409s, which is the one failure that reloads the state — the GET
 *              answers with `reload`, standing for what another session did. */
function loadTab({ players = UI_PLAYERS, deckCardCounts = UI_COUNTS, user = AS_TIM,
                   remembered = '', serverTakesIt = true, reload = null } = {}) {
  const store  = new Map();
  if (remembered) store.set('avail_name', remembered);
  const saved  = [];      // { url, body } per fetch
  const alerts = [];

  const els = {};
  const el = id => (els[id] ||= {
    innerHTML: '', textContent: '', title: '', value: '', disabled: false,
    style: { setProperty() {}, display: '' }, attrs: {}, dataset: {}, classes: new Set(),
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener() {}, focus() {}, appendChild() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    classList: {
      toggle(name, on) { on ? els[id].classes.add(name) : els[id].classes.delete(name); },
      add(name) { els[id].classes.add(name); },
      remove(name) { els[id].classes.delete(name); },
      contains(name) { return els[id].classes.has(name); },
    },
  });

  const sandbox = {
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    document: {
      addEventListener() {}, querySelectorAll: () => [], createElement: () => el('made'),
      getElementById: el,
      body: { appendChild() {}, style: {} },
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800, location: {} },
    console,
    alert: msg => alerts.push(String(msg)),
    confirm: () => true, prompt: () => null,
    clearTimeout() {}, setTimeout: fn => 1,
    fetch: async (url, opts = {}) => {
      saved.push({ url, method: opts.method || 'GET', body: JSON.parse(opts.body || '{}') });
      // The re-read a 409 triggers, answering with the state as another session
      // left it.
      if (!opts.method) {
        return { ok: true, status: 200,
                 json: async () => ({ players: reload || players, deckCardCounts, version: 9 }) };
      }
      if (serverTakesIt === 'conflict') {
        return url === '/api/state'
          ? { ok: false, status: 409, json: async () => ({ error: 'conflict' }) }
          : { ok: false, status: 500, json: async () => ({ error: 'nope' }) };
      }
      return serverTakesIt
        ? { ok: true,  status: 200, json: async () => ({ ok: true, version: 7 }) }
        : { ok: false, status: 500, json: async () => ({ error: 'nope' }) };
    },
    // Outside this ticket: the kebab menu's markup, the bracket badge, the
    // sibling tabs. The kebab is echoed as JSON so a test can read the rows it
    // was handed without parsing the shipped markup.
    kebabMenuHtml: items => `<span class="kebab">${JSON.stringify(items)}</span>`,
    dbBracketBadgeHtml: () => '',
    collapseState: {},
    togglePlayerSection() {}, renderWantList() {}, renderCollections() {},
    renderResults() {}, setTab() {}, ensureScryfallImages: async () => {},
    scryfallArtCache: new Map(),
    reconcileColSorts() {},
  };
  vm.createContext(sandbox);
  // js/deckdrag.js beside them: the tile's markup asks it for the drag
  // attributes (#39), so a sandbox without it draws a tile the app does not.
  for (const file of ['state.js', 'auth.js', 'players.js', 'deckdrag.js']) {
    vm.runInContext(readSrc(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`currentUser = ${JSON.stringify(user)}`);
  run(`hydrateState(${JSON.stringify({ players, deckCardCounts })})`);

  return {
    run, answer, el, store, saved, alerts,
    deck: (deckId, playerId = 'p-tim') =>
      answer(`state.players.find(p => p.id === '${playerId}').decks.find(d => d.id === '${deckId}')`),
    html() { run('renderPlayers()'); return el('playersList').innerHTML; },
    /** The rows one deck tile's ⋯ menu was built from. */
    menuFor(deckId) { return menuIn(this.html(), deckId); },
    /** Whether one deck's tile is wearing the lock badge. */
    lockOn(deckId) { return /deck-private-badge/.test(tileOf(this.html(), deckId)); },
  };
}

/* One tile's markup, bounded to itself: a badge or a menu belonging to the
 * next tile along must not read as this one's. */
function tileOf(html, deckId) {
  const marker = `data-deck-id="${deckId}"`;
  const from   = html.indexOf(marker);
  if (from < 0) return '';
  const rest = html.slice(from + marker.length);
  const next = rest.search(/data-deck-id="|data-player-id="/);
  return next < 0 ? rest : rest.slice(0, next);
}

/* The rows behind one tile's ⋯ — the stub kebab echoes what it was handed, so
 * a test reads the menu rather than the markup around it. */
function menuIn(html, deckId) {
  const mine  = tileOf(html, deckId);
  const match = mine.match(/<span class="kebab">(\[.*?\])<\/span>/s);
  return match ? JSON.parse(match[1]) : null;
}

const labels = menu => (menu || []).map(row => row.label).filter(Boolean);

describe('The ⋯ menu turns a deck private and back', () => {
  test('a public deck is offered Make private, a private one Make public', () => {
    const tab = loadTab();
    assert.ok(labels(tab.menuFor('d-open')).includes('Make private'),
      'a public deck of your own offers no way to make it private');
    assert.equal(labels(tab.menuFor('d-open')).includes('Make public'), false,
      'a public deck offers to make it public, which is what it already is');
    assert.ok(labels(tab.menuFor('d-secret')).includes('Make public'),
      'a private deck offers no way back');
  });

  test('the tile is private before the server has answered, and rides savePlayerDecks', async () => {
    const tab = loadTab();
    const done = tab.run(`setDeckPrivate('p-tim','d-open',true)`);

    assert.equal(tab.deck('d-open').private, true, 'the flag waited for the server');
    assert.ok(tab.lockOn('d-open'), 'the grid waited for the server before drawing the badge');

    await done;
    assert.deepEqual(tab.saved.map(s => s.url), ['/api/players/p-tim/decks'],
      'the flag is a fact about the deck, so it rides the granular deck save');
    assert.equal(tab.saved[0].body.decks.find(d => d.id === 'd-open').private, true,
      'the save went without the flag it was made for');
  });

  test('Make public clears the flag and saves that too', async () => {
    const tab = loadTab();
    await tab.run(`setDeckPrivate('p-tim','d-secret',false)`);

    assert.equal(tab.deck('d-secret').private, false);
    assert.equal(tab.saved[0].body.decks.find(d => d.id === 'd-secret').private, false);
  });

  test('a save the server will not take puts the deck back, and says so', async () => {
    const tab = loadTab({ serverTakesIt: false });
    await tab.run(`setDeckPrivate('p-tim','d-open',true)`);

    assert.equal(tab.deck('d-open').private, false,
      'a deck left looking private the server never agreed to is the worst of both');
    assert.equal(tab.lockOn('d-open'), false, 'the badge stayed on a deck that is not private');
    assert.equal(tab.alerts.length, 1, 'the rollback happened silently');
  });

  test('a refused save leaves no trace of the change in the offline cache', async () => {
    // The refused save writes the whole blob to localStorage on its way past —
    // the copy an unreachable server is loaded from next time. If the rollback
    // stops at memory, that cache still says private, and the change the app
    // just disowned comes back on the next offline load.
    const tab = loadTab({ serverTakesIt: false });
    await tab.run(`setDeckPrivate('p-tim','d-open',true)`);

    const cached = JSON.parse(tab.store.get('mtgtools_v3'));
    const deck   = cached.players.find(p => p.id === 'p-tim').decks.find(d => d.id === 'd-open');
    assert.equal(deck.private, false,
      'the offline cache kept the change the person was told had not been saved');
  });

  test('a save that lost a race leaves the state the reload brought back', async () => {
    // Another session made the same deck private while this one was deciding
    // to. The write 409s, the state is re-read, and the rollback must not put
    // this browser's older answer back over it.
    const theirs = [{ ...UI_PLAYERS[0], decks: [
      { id: 'd-open', source: 'manual', name: 'Krenko', private: true },
      ...UI_PLAYERS[0].decks.slice(1),
    ] }, UI_PLAYERS[1]];
    const tab = loadTab({ serverTakesIt: 'conflict', reload: theirs });

    await tab.run(`setDeckPrivate('p-tim','d-open',true)`);

    assert.equal(tab.deck('d-open').private, true,
      'the rollback overwrote what the re-read had just learned');
    assert.equal(tab.alerts.length, 1,
      'the conflict was announced twice — once by the reload and once by the rollback');
  });

  test('setting the flag it already has changes nothing and saves nothing', async () => {
    const tab = loadTab();
    await tab.run(`setDeckPrivate('p-tim','d-secret',true)`);
    assert.deepEqual(tab.saved, [], 'a no-op wrote to the server anyway');
  });
});

describe('A private deck says so on its tile', () => {
  test('the badge is on the private deck and not on the public one', () => {
    const tab = loadTab();
    assert.ok(tab.lockOn('d-secret'), 'a private deck of your own wears no badge');
    assert.equal(tab.lockOn('d-open'), false, 'a public deck is wearing the badge');
  });

  test('an admin sees the badge on another player’s private deck', () => {
    const tab = loadTab({ user: AS_ADMIN });
    assert.ok(tab.lockOn('d-anna'),
      'the one session that receives somebody else’s private deck cannot tell it is private');
  });
});

describe('Open mode: the flag is inert, so the tile neither offers nor shows it', () => {
  test('no deck is offered Make private', () => {
    const tab = loadTab({ user: AS_GUEST, remembered: 'tim' });
    assert.equal(tab.run('myPlayerId()'), 'p-tim', 'the fixture is not the open-mode identity it claims');
    assert.equal(labels(tab.menuFor('d-open')).includes('Make private'), false,
      'open mode offered a flag the server cannot enforce');
    assert.equal(labels(tab.menuFor('d-secret')).includes('Make public'), false);
  });

  test('a deck already marked private wears no badge', () => {
    const tab = loadTab({ user: AS_GUEST, remembered: 'tim' });
    assert.equal(tab.lockOn('d-secret'), false,
      'a badge in open mode claims a privacy nobody is keeping');
    assert.equal(tab.deck('d-secret').private, true,
      'the flag is meant to be ignored, not erased — a deployment that gains accounts keeps it');
  });
});

describe('A new deck is public', () => {
  test('+ Add Deck makes a deck nobody has to un-hide', async () => {
    const tab = loadTab();
    const form   = tab.el('adf_p-tim');
    const inputs = {
      '[name="deckname"]':  { value: 'Fresh',  style: {} },
      '[name="commander"]': { value: '',       style: {} },
      '[name="deckurl"]':   { value: '',       style: {} },
    };
    form.querySelector = sel => inputs[sel] || null;

    await tab.run(`confirmAddDeck('p-tim')`);

    const made = tab.answer(`state.players[0].decks.find(d => d.name === 'Fresh')`);
    assert.equal(made.private, false, 'privacy is meant to be a deliberate act, not a default');
    const put = tab.saved.find(s => s.url === '/api/players/p-tim/decks');
    assert.equal(put.body.decks.find(d => d.name === 'Fresh').private, false);
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
