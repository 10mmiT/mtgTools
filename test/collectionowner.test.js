/* A collection has an owner.
 *
 * The app already knew which player you are and that players own decks and
 * want lists; a collection belonged to nobody. So it could say "this card is
 * owned" and not "you own this card", which is the question somebody building
 * a deck is actually asking.
 *
 * What is asserted here is the whole of the distinction and the two ways it
 * can be got wrong: an owner that is really optional (a shared box is the
 * group's, and never any one person's), and an owner that never costs a
 * collection its existence — not when the column is added under a database
 * that predates it, not when a collection is refreshed, and not when the
 * player who owned it is removed.
 *
 * Three layers, all against the shipped files:
 *
 *   the column   a database made before owners, opened by available-db.js,
 *                and the routes that read and write the new field
 *   the tab      js/collections.js in a vm sandbox, as test/deckfilter.test.js
 *                runs the deck-builder modules
 *   the frame    the markup and the stylesheet, read as text where what
 *                matters is a control that must exist
 */

'use strict';

const { test, describe, before } = require('node:test');
const assert    = require('node:assert/strict');
const supertest = require('supertest');
const fs        = require('node:fs');
const os        = require('node:os');
const path      = require('node:path');
const vm        = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── The column ────────────────────────────────────────────────────────────
/* A database in the shape collections were stored in before anybody owned
 * one, with a collection already in it. Written first, then opened by the
 * module that owns the schema — so the migration under test is the shipped
 * one and not a copy of its SQL. */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgowner-'));
{
  const Database = require('better-sqlite3');
  const legacy = new Database(path.join(tmpDir, 'available.db'));
  legacy.exec(`
    CREATE TABLE collections (
      key        TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      source     TEXT NOT NULL,
      col_id     TEXT,
      color      TEXT NOT NULL,
      cards_json TEXT NOT NULL DEFAULT '{}',
      entries    INTEGER NOT NULL DEFAULT 0,
      total      INTEGER,
      saved_at   TEXT
    );
    INSERT INTO collections (key, name, source, col_id, color, cards_json, entries, total, saved_at)
      VALUES ('csv:old', 'The shelf', 'csv-moxfield', NULL, '#a855f7',
              '{"Sol Ring":{"name":"Sol Ring","qty":2}}', 1, 1, '2026-01-01T00:00:00.000Z');
  `);
  legacy.close();
}

process.env.DATA_FILE            = path.join(tmpDir, 'state.json');
process.env.ADMIN_PASSWORD       = 'testpass';
process.env.PORT                 = '0';
process.env.AUTH_RATE_LIMIT_MAX  = '1000';
process.env.MTGTOOLS_NO_BACKGROUND = '1';

const { app }  = require('../server');
const { db }   = require('../available-db');
const request  = supertest(app);

async function adminCookie() {
  const res = await request.post('/api/auth/login')
    .send({ username: 'admin', password: 'testpass' })
    .set('Content-Type', 'application/json');
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw.map(c => c.split(';')[0]).join('; ') : raw;
}

const TIM  = { id: 'p-tim',  name: 'Tim',  colorIdx: 0, wantList: [], decks: [] };
const ANNA = { id: 'p-anna', name: 'Anna', colorIdx: 1, wantList: [], decks: [] };

/** Put a player list in place, as the client does — the whole state, replaced. */
async function setPlayers(cookie, players) {
  const version = (await request.get('/api/state').set('Cookie', cookie)).body.version;
  const res = await request.post('/api/state').set('Cookie', cookie)
    .send({ players, version }).set('Content-Type', 'application/json');
  assert.equal(res.status, 200, 'the state would not save');
}

/** One collection, as it comes back from the server. */
async function collection(cookie, key) {
  const res = await request.get('/api/state').set('Cookie', cookie);
  return res.body.collections.find(c => c.key === key);
}

describe('the column', () => {
  let cookie;
  before(async () => { cookie = await adminCookie(); await setPlayers(cookie, [TIM, ANNA]); });

  test('a collection stored before owners existed keeps everything it had', () => {
    const row = db.prepare('SELECT * FROM collections WHERE key = ?').get('csv:old');
    assert.equal(row.name, 'The shelf');
    assert.equal(row.source, 'csv-moxfield');
    assert.equal(row.entries, 1);
    assert.equal(row.saved_at, '2026-01-01T00:00:00.000Z');
    assert.deepEqual(JSON.parse(row.cards_json), { 'Sol Ring': { name: 'Sol Ring', qty: 2 } });
  });

  test('and has no owner, which is the group’s', async () => {
    assert.equal(db.prepare('SELECT owner_player_id FROM collections WHERE key = ?')
      .get('csv:old').owner_player_id, null);
    assert.equal((await collection(cookie, 'csv:old')).owner, null,
      'the tab is not told whose a collection is');
  });

  test('a collection can be added with an owner, or without one', async () => {
    for (const [key, owner] of [['csv:tim', TIM.id], ['csv:box', null]]) {
      const res = await request.post('/api/collections').set('Cookie', cookie)
        .send({ key, name: key, source: 'csv-moxfield', cards: {}, owner })
        .set('Content-Type', 'application/json');
      assert.equal(res.status, 200);
      assert.equal((await collection(cookie, key)).owner, owner);
    }
  });

  test('the owner can be changed afterwards, and given back to the group', async () => {
    let res = await request.put('/api/collections/csv%3Atim/owner').set('Cookie', cookie)
      .send({ owner: ANNA.id }).set('Content-Type', 'application/json');
    assert.equal(res.status, 200);
    assert.equal((await collection(cookie, 'csv:tim')).owner, ANNA.id);

    res = await request.put('/api/collections/csv%3Atim/owner').set('Cookie', cookie)
      .send({ owner: null }).set('Content-Type', 'application/json');
    assert.equal(res.status, 200);
    assert.equal((await collection(cookie, 'csv:tim')).owner, null,
      'a collection cannot be handed back to the group');
  });

  test('an owner nobody answers to is refused rather than stored', async () => {
    await request.put('/api/collections/csv%3Atim/owner').set('Cookie', cookie)
      .send({ owner: TIM.id }).set('Content-Type', 'application/json');
    const res = await request.put('/api/collections/csv%3Atim/owner').set('Cookie', cookie)
      .send({ owner: 'p-nobody' }).set('Content-Type', 'application/json');
    assert.equal(res.status, 400);
    assert.equal((await collection(cookie, 'csv:tim')).owner, TIM.id,
      'the refused write went through anyway');
  });

  test('a collection that is not there cannot be given an owner', async () => {
    const res = await request.put('/api/collections/csv%3Aghost/owner').set('Cookie', cookie)
      .send({ owner: TIM.id }).set('Content-Type', 'application/json');
    assert.equal(res.status, 404);
  });

  /* The save path is a whole-collection write — adding one, refreshing one,
   * re-importing a CSV. A client that does not mention the owner must not
   * have it cleared as a side effect of a refresh. */
  test('refreshing a collection does not cost it its owner', async () => {
    const res = await request.post('/api/collections').set('Cookie', cookie)
      .send({ key: 'csv:tim', name: 'csv:tim', source: 'csv-moxfield',
              cards: { 'Sol Ring': { name: 'Sol Ring', qty: 1 } }, entries: 1 })
      .set('Content-Type', 'application/json');
    assert.equal(res.status, 200);
    assert.equal((await collection(cookie, 'csv:tim')).owner, TIM.id);
  });

  test('and a refresh that does mention it can still change it', async () => {
    await request.post('/api/collections').set('Cookie', cookie)
      .send({ key: 'csv:tim', name: 'csv:tim', source: 'csv-moxfield', cards: {}, owner: null })
      .set('Content-Type', 'application/json');
    assert.equal((await collection(cookie, 'csv:tim')).owner, null);
  });

  /* The cards are still in the house. */
  test('removing a player leaves their collection where it was, as the group’s', async () => {
    await request.put('/api/collections/csv%3Atim/owner').set('Cookie', cookie)
      .send({ owner: TIM.id }).set('Content-Type', 'application/json');
    await request.put('/api/collections/csv%3Aold/owner').set('Cookie', cookie)
      .send({ owner: ANNA.id }).set('Content-Type', 'application/json');

    await setPlayers(cookie, [ANNA]);

    const tims = await collection(cookie, 'csv:tim');
    assert.ok(tims, 'the collection went with the player');
    assert.equal(tims.owner, null, 'the collection still names a player who is gone');
    assert.equal(tims.entries, 0, 'the collection was rewritten rather than disowned');
    assert.equal((await collection(cookie, 'csv:old')).owner, ANNA.id,
      'somebody else’s collection was disowned too');
  });
});

// ── The tab ───────────────────────────────────────────────────────────────
/* js/collections.js, loaded whole over a state the app could be in a moment
 * after the collections have arrived. What is stubbed is everything outside
 * the tab: the pictures, the deck panel, the network. */
function loadTab({ collections, players, user, remembered } = {}) {
  const store = new Map();
  if (remembered) store.set('avail_name', remembered);
  const els = new Map();

  const fakeEl = () => {
    const el = {
      innerHTML: '', textContent: '', title: '', value: '', disabled: false,
      dataset: {}, attrs: {}, classes: new Set(),
      style: { setProperty() {} },
      classList: {
        add:    n => el.classes.add(n),
        remove: n => el.classes.delete(n),
        toggle: (n, on) => (on ? el.classes.add(n) : el.classes.delete(n)),
        contains: n => el.classes.has(n),
      },
      setAttribute(k, v) { el.attrs[k] = v; },
      getAttribute(k) { return el.attrs[k]; },
      addEventListener() {}, removeEventListener() {}, focus() {},
      querySelector() { return fakeEl(); },
      querySelectorAll() { return []; },
      appendChild() {},
      getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0 }; },
      closest() { return null; },
    };
    return el;
  };
  const el = id => {
    if (!els.has(id)) els.set(id, fakeEl());
    return els.get(id);
  };

  const sandbox = {
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    document: {
      addEventListener() {}, querySelectorAll: () => [], createElement: () => fakeEl(),
      getElementById: el,
      body: { appendChild() {}, style: {} },
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    console,
    alert() {}, confirm: () => true, clearTimeout() {}, setTimeout: fn => 1,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    // Outside the tab: the deck panel, the pictures, the card facts.
    renderDeck() {}, openDrawer() {}, closeDrawers() {},
    ensureScryfallImages: async () => {},
    scryfallCache: new Map(), scryfallMetaCache: new Map(),
    deck: null, deckFilter: false,
  };
  vm.createContext(sandbox);
  for (const file of ['state.js', 'sortui.js', 'cardquery.js', 'cardstack.js',
                      'auth.js', 'collections.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`currentUser = ${JSON.stringify(user || null)}`);
  run(`hydrateState(${JSON.stringify({ players: players || [], collections: collections || [] })})`);
  run(`viewMode = 'list'`);

  return {
    run, answer, el,
    /** The collections whose cards the tab is showing, in its own order. */
    shelf: () => answer('colShelf().map(c => c.key)'),
    /** The chip row, drawn. */
    chips() { run('renderCollections()'); return el('collectionsChips').innerHTML; },
    /** The table, drawn: its quantity columns and its rows. */
    table() {
      run('renderResults()');
      return {
        columns: [...el('headerRow').innerHTML.matchAll(/>([^<]+)<\/th>/g)].map(m => m[1]),
        rows: [...el('resultsBody').innerHTML.matchAll(/data-name="([^"]+)"/g)].map(m => m[1]),
        totals: [...el('resultsBody').innerHTML.matchAll(/td-total">(\d+)</g)].map(m => +m[1]),
        empty: (el('resultsBody').innerHTML.match(/class="empty-state">([^<]*)/) || [, ''])[1],
      };
    },
    scopeHidden: () => el('colScopeMount').classes.has('scope-mount-hidden'),
  };
}

const SHELVES = [
  { key: 'c:tim',   name: 'Tim’s box',  source: 'csv-moxfield', color: '#a855f7',
    owner: 'p-tim',  cards: { 'Sol Ring': { name: 'Sol Ring', qty: 1 } } },
  { key: 'c:anna',  name: 'Anna’s box', source: 'csv-moxfield', color: '#3b82f6',
    owner: 'p-anna', cards: { 'Sol Ring': { name: 'Sol Ring', qty: 2 },
                              'Cultivate': { name: 'Cultivate', qty: 1 } } },
  { key: 'c:group', name: 'The cupboard', source: 'csv-moxfield', color: '#10b981',
    owner: null,     cards: { 'Sol Ring': { name: 'Sol Ring', qty: 4 } } },
];
const PLAYERS = [{ id: 'p-tim', name: 'Tim', decks: [] }, { id: 'p-anna', name: 'Anna', decks: [] }];
const AS_TIM  = { username: 'tim', role: 'player', playerId: 'p-tim' };
const AS_GUEST = { username: 'guest', role: 'admin', playerId: null };

describe('who you are', () => {
  test('a logged-in account is its linked player', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_TIM });
    assert.equal(tab.run('myPlayerId()'), 'p-tim');
  });

  /* Open mode has no logged-in player at all — no ADMIN_PASSWORD, so the
   * session is `guest` with no id. The name behind Available@'s "Who are
   * you?" bar is the identity the app already keeps for exactly this case. */
  test('open mode falls back to the browser-remembered name', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_GUEST,
                          remembered: '  anna ' });
    assert.equal(tab.run('myPlayerId()'), 'p-anna', 'the name was not matched to a player');
  });

  test('and matches it however it was typed', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_GUEST,
                          remembered: 'TIM' });
    assert.equal(tab.run('myPlayerId()'), 'p-tim');
  });

  test('a name matching nobody is nobody, and so is no name at all', () => {
    for (const remembered of ['Gandalf', '', '   ']) {
      const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_GUEST, remembered });
      assert.equal(tab.run('myPlayerId()'), null, `"${remembered}" resolved to a player`);
    }
  });

  /* An account with no linked player has an identity — it just is not a
   * player yet. Reading a name out of its browser would hand it somebody
   * else's shelf. */
  test('a logged-in account with no player does not borrow a remembered name', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, remembered: 'Tim',
                          user: { username: 'newbie', role: 'player', playerId: null } });
    assert.equal(tab.run('myPlayerId()'), null);
  });
});

describe('one shelf or everyone’s', () => {
  test('everyone’s is every loaded collection', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_TIM });
    assert.deepEqual(tab.shelf(), ['c:tim', 'c:anna', 'c:group']);
  });

  /* The null case is the whole point: a shared box belongs to the group, so
   * it counts as the group's and never as any one person's. */
  test('mine is mine — not the group’s box, and not anybody else’s', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_TIM });
    tab.run(`setColScope('mine')`);
    assert.deepEqual(tab.shelf(), ['c:tim']);
  });

  test('the choice is remembered', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_TIM });
    tab.run(`setColScope('mine')`);
    const key = tab.run('COL_SCOPE_KEY');
    assert.equal(tab.run(`localStorage.getItem(${JSON.stringify(key)})`), 'mine');
    assert.equal(tab.run('colScope()'), 'mine');
  });

  test('the table is the shelf: its columns, its cards and its totals', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_TIM });
    const everyones = tab.table();
    assert.deepEqual(everyones.columns,
      ['Card Name', 'Tim’s box', 'Anna’s box', 'The cupboard', 'Total']);
    assert.deepEqual(everyones.rows, ['Cultivate', 'Sol Ring']);
    assert.deepEqual(everyones.totals, [1, 7], 'the Total column counts the shelf');

    tab.run(`setColScope('mine')`);
    const mine = tab.table();
    assert.deepEqual(mine.columns, ['Card Name', 'Tim’s box', 'Total']);
    assert.deepEqual(mine.rows, ['Sol Ring'], 'a card only somebody else owns is on my shelf');
    assert.deepEqual(mine.totals, [1]);
  });

  /* A player with no collection of their own is an ordinary thing to be. */
  test('a shelf with nothing on it says so, and is not an error', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS,
                          user: { username: 'anna', role: 'player', playerId: 'p-anna' } });
    tab.run(`state.collections = state.collections.filter(c => c.key !== 'c:anna')`);
    tab.run(`setColScope('mine')`);
    const table = tab.table();
    assert.deepEqual(table.rows, []);
    assert.match(table.empty, /None of the loaded collections is yours/);
  });

  /* Hiding a column is not removing a collection: the sort naming it has to
   * survive being scoped away and come back with it. */
  test('scoping away a collection does not throw away a sort that names it', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_TIM });
    tab.run(`saveSortChain('collections', { criteria: [{ field: colQtyField('c:anna'), dir: -1 }], edited: true })`);
    tab.run(`setColScope('mine')`);
    tab.table();
    tab.run(`setColScope('all')`);
    assert.deepEqual(tab.answer('colSortCriteria()'),
      [{ field: tab.run(`colQtyField('c:anna')`), dir: -1 }],
      'the stored sort was reconciled away by a scope it was only hidden from');
  });
});

describe('no way to say who you are', () => {
  const noIdentity = () => loadTab({ collections: SHELVES, players: PLAYERS, user: AS_GUEST });

  test('the distinction is not offered at all', () => {
    const tab = noIdentity();
    tab.table();
    assert.ok(tab.scopeHidden(), 'the shelf control is on the strip with nothing to mean');
  });

  test('and everything reads as the group’s', () => {
    const tab = noIdentity();
    tab.run(`setColScope('mine')`);
    assert.equal(tab.run('colScope()'), 'all', 'a stored preference hid every collection');
    assert.deepEqual(tab.shelf(), ['c:tim', 'c:anna', 'c:group']);
  });

  test('typing a name into the “Who are you?” bar offers it', () => {
    const tab = noIdentity();
    tab.table();
    assert.ok(tab.scopeHidden());
    tab.run(`localStorage.setItem('avail_name', 'Tim'); colIdentityChanged()`);
    assert.ok(!tab.scopeHidden(), 'the control did not appear when the app learned who you are');
  });
});

describe('the chip', () => {
  test('says whose it is, and says nothing where nobody owns it', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_TIM });
    const chips = tab.chips();
    assert.match(chips, /chip-owner">Tim</);
    assert.match(chips, /chip-owner">Anna</);
    assert.equal(chips.match(/chip-owner/g).length, 2, 'the group’s box was given an owner');
  });

  /* The ⋯ menu is where an owner is set, so a collection whose cards are off
   * the shelf keeps its chip — otherwise a mis-set owner could never be
   * fixed from the tab it was set on. */
  test('every loaded collection keeps its chip, and one off the shelf says so', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_TIM });
    tab.run(`setColScope('mine')`);
    const chips = tab.chips();
    assert.equal(chips.match(/<span class="chip[ "]/g).length, 3, 'a collection lost its chip');
    assert.equal(chips.match(/chip--off/g).length, 2, 'the chips off the shelf do not say so');
    assert.match(chips, /not on the shelf you are looking at/);
  });

  test('the overflow menu offers the group and every player, ticking the one it is', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_TIM });
    const chips = tab.chips();
    assert.match(chips, /setCollectionOwner\('c:tim', null\)/);
    assert.match(chips, /setCollectionOwner\('c:tim', 'p-anna'\)/);
    assert.match(chips, /✓ Tim/, 'the owner it has is not marked');
    assert.match(chips, /✓ The group/, 'an unowned collection is not marked as the group’s');
  });

  test('an id naming a player who has gone reads as the group’s', () => {
    const tab = loadTab({ collections: SHELVES, players: PLAYERS, user: AS_TIM });
    tab.run(`state.players = state.players.filter(p => p.id !== 'p-anna')`);
    const chips = tab.chips();
    assert.equal(chips.match(/chip-owner/g).length, 1, 'a chip still names a player who is gone');
  });
});

// ── The frame ─────────────────────────────────────────────────────────────
describe('the frame', () => {
  const markup = read('public/index.html');

  test('the shelf control is on the strip, and can be hidden', () => {
    assert.match(markup, /id="colScopeMount"/);
    const sel = markup.match(/<select id="colScopeSel"[\s\S]*?<\/select>/)[0];
    assert.match(sel, /onchange="setColScope\(this\.value\)"/);
    assert.match(sel, /value="mine"/);
    assert.match(sel, /aria-label=/, 'the control says what it is to a screen reader');
    assert.match(read('public/css/components.css'), /\.scope-mount-hidden \{ display: none; \}/);
  });

  test('a collection is given an owner where it is added', () => {
    const sel = markup.match(/<select id="ownerInput"[\s\S]*?<\/select>/)[0];
    assert.match(sel, /value=""[^>]*>The group/, 'the null case is not offered');
    assert.match(markup, /onclick="openAddCollection\(\)"/,
      'the + Add button opens the drawer without filling its player list');
  });
});
