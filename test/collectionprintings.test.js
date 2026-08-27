/* Which printings a collection holds, and the honest answer where it holds
 * none of that information.
 *
 * A collection knew that you own three Sol Rings and not *which* three. The
 * breakdown that answers it arrives here — but no collection on any shelf has
 * it yet, and none will until it is re-imported. So the failure this file
 * exists to prevent is not a mis-parsed printing: it is a shelf full of cards
 * reading as owned-none because "no printing recorded" was mistaken for "owns
 * nothing", which is the app telling somebody their collection has been wiped.
 *
 * Hence the shape: the unknown is a row in the data — `{ id: null, qty }` —
 * rather than an absent field every reader has to remember. What is asserted
 * is that it is always there, that it always adds up to the quantity that was
 * already on screen, and that nothing anybody could see about an existing
 * collection moved a millimetre.
 *
 * Two layers, both against the shipped files:
 *
 *   the shelf as stored  a database written before printings existed, opened
 *                        by available-db.js, read back through the route the
 *                        tab reads — so the shape helpers under test are the
 *                        shipped ones and not a copy of them
 *   the tab              js/collections.js in a vm sandbox, as
 *                        test/collectionowner.test.js runs it
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

// ── The shelf as stored ───────────────────────────────────────────────────
/* A database holding collections in the shape they were stored in before any
 * of this: a name, a type, a mana cost and a running quantity, and not one
 * word about which printing any of it is. Written first, then opened by the
 * module that owns the schema. */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgprint-'));
const LEGACY_CARDS = {
  'Sol Ring':  { name: 'Sol Ring',  type: 'Artifact', mana: '{1}', qty: 3 },
  'Cultivate': { name: 'Cultivate', type: 'Sorcery',  mana: '{2}{G}', qty: 1 },
};
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
  `);
  legacy.prepare(`
    INSERT INTO collections (key, name, source, col_id, color, cards_json, entries, total, saved_at)
    VALUES ('archidekt:1', 'The shelf', 'archidekt', '1', '#a855f7', ?, 2, 4, '2026-01-01T00:00:00.000Z')
  `).run(JSON.stringify(LEGACY_CARDS));
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

async function adminCookie() {
  const res = await request.post('/api/auth/login')
    .send({ username: 'admin', password: 'testpass' })
    .set('Content-Type', 'application/json');
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw.map(c => c.split(';')[0]).join('; ') : raw;
}

/** One collection, as it comes back from the server. */
async function collection(cookie, key) {
  const res = await request.get('/api/state').set('Cookie', cookie);
  return res.body.collections.find(c => c.key === key);
}

const storedCards = key =>
  JSON.parse(db.prepare('SELECT cards_json FROM collections WHERE key = ?').get(key).cards_json);

/** One printing of a card, as Archidekt will describe one. */
const C21 = { id: 'p-c21', set: 'c21', set_name: 'Commander 2021',
              collector_number: '263', finish: 'nonfoil', lang: 'en', condition: 'nm' };
const XM  = { id: 'p-xm', set: 'xm', set_name: 'Mystical Archive',
              collector_number: '5', finish: 'foil', lang: 'en', condition: 'nm' };

describe('a collection stored before printings existed', () => {
  let cookie;
  before(async () => { cookie = await adminCookie(); });

  test('reads as one unknown entry per card, equal to the quantity it had', async () => {
    const col = await collection(cookie, 'archidekt:1');
    assert.deepEqual(col.cards['Sol Ring'].printings, [{ id: null, qty: 3 }]);
    assert.deepEqual(col.cards['Cultivate'].printings, [{ id: null, qty: 1 }]);
  });

  /* The one way this feature breaks badly enough to matter. */
  test('never as owning none, and never as an empty breakdown', async () => {
    const col = await collection(cookie, 'archidekt:1');
    for (const [name, card] of Object.entries(col.cards)) {
      assert.ok(Array.isArray(card.printings) && card.printings.length,
        `${name} has no breakdown at all`);
      assert.ok(card.printings.some(p => p.qty > 0), `${name} reads as owning none`);
    }
  });

  test('and everything it already showed is exactly where it was', async () => {
    const col = await collection(cookie, 'archidekt:1');
    assert.equal(col.name, 'The shelf');
    assert.equal(col.entries, 2);
    assert.equal(col.total, 4);
    assert.equal(col.savedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(col.cards['Sol Ring'].qty, 3);
    assert.equal(col.cards['Sol Ring'].type, 'Artifact');
    assert.equal(col.cards['Sol Ring'].mana, '{1}');
    assert.equal(col.cards['Cultivate'].qty, 1);
  });

  /* An unknown breakdown says nothing a quantity did not already say, so it
   * is not written down — which is what keeps re-saving a collection that
   * predates printings from rewriting every row in it. */
  test('is not rewritten on disk to say it knows nothing', () => {
    assert.deepEqual(storedCards('archidekt:1'), LEGACY_CARDS);
  });
});

describe('a collection that does know its printings', () => {
  let cookie;
  before(async () => { cookie = await adminCookie(); });

  const save = (cards, key = 'archidekt:2') => request.post('/api/collections').set('Cookie', cookie)
    .send({ key, name: 'A re-imported shelf', source: 'archidekt', cards, entries: 1, total: 1 })
    .set('Content-Type', 'application/json');

  test('keeps the breakdown it was given, printing by printing', async () => {
    const res = await save({ 'Sol Ring': { name: 'Sol Ring', qty: 3, printings: [
      { ...C21, qty: 2 }, { ...XM, qty: 1 },
    ] } });
    assert.equal(res.status, 200);
    const card = (await collection(cookie, 'archidekt:2')).cards['Sol Ring'];
    assert.equal(card.qty, 3);
    assert.deepEqual(card.printings, [{ ...C21, qty: 2 }, { ...XM, qty: 1 }]);
  });

  /* The printings are the authoritative half, so a breakdown accounting for
   * more copies than the quantity claimed is the answer — the quantity was
   * the one that had not caught up. Under-counting is a different question,
   * and the test below it is the one that answers it. */
  test('the quantity is the sum of the printings where they say more than it did', async () => {
    await save({ 'Sol Ring': { name: 'Sol Ring', qty: 1, printings: [
      { ...C21, qty: 2 }, { ...XM, qty: 1 },
    ] } });
    assert.equal((await collection(cookie, 'archidekt:2')).cards['Sol Ring'].qty, 3);
  });

  /* Half an answer is still half an answer: the copies that could not be
   * attributed are the unknown entry, not a rounding error. */
  test('copies it cannot attribute go to the unknown entry', async () => {
    await save({ 'Sol Ring': { name: 'Sol Ring', qty: 5, printings: [{ ...C21, qty: 2 }] } });
    const card = (await collection(cookie, 'archidekt:2')).cards['Sol Ring'];
    assert.equal(card.qty, 5);
    assert.deepEqual(card.printings, [{ ...C21, qty: 2 }, { id: null, qty: 3 }]);
  });

  test('the same printing named twice is one entry with both copies', async () => {
    await save({ 'Sol Ring': { name: 'Sol Ring', qty: 2, printings: [
      { ...C21, qty: 1 }, { ...C21, qty: 1 },
    ] } });
    assert.deepEqual((await collection(cookie, 'archidekt:2')).cards['Sol Ring'].printings,
      [{ ...C21, qty: 2 }]);
  });

  /* Foil is a finish on the same Scryfall id, not an id of its own, so a
   * foil and an ordinary copy collapse into one entry unless the finish is
   * part of what makes a printing itself. */
  test('a foil is not folded into the ordinary copy of the same card', async () => {
    await save({ 'Sol Ring': { name: 'Sol Ring', qty: 2, printings: [
      { ...C21, qty: 1 }, { ...C21, finish: 'foil', qty: 1 },
    ] } });
    const printings = (await collection(cookie, 'archidekt:2')).cards['Sol Ring'].printings;
    assert.equal(printings.length, 2, 'the foil was counted as an ordinary copy');
    assert.deepEqual(printings.map(p => p.finish), ['nonfoil', 'foil']);
  });

  test('a breakdown that names no printing at all is the unknown entry', async () => {
    await save({ 'Sol Ring': { name: 'Sol Ring', qty: 2, printings: [{ qty: 2 }] } });
    assert.deepEqual((await collection(cookie, 'archidekt:2')).cards['Sol Ring'].printings,
      [{ id: null, qty: 2 }]);
  });

  test('and is stored as the quantity it always was, not as a made-up breakdown', async () => {
    await save({ 'Sol Ring': { name: 'Sol Ring', qty: 2, printings: [{ qty: 2 }] } });
    assert.deepEqual(storedCards('archidekt:2'), { 'Sol Ring': { name: 'Sol Ring', qty: 2 } });
  });

  /* The shape helpers are total — anything that is not a breakdown is the
   * unknown entry — and a row of unreadable JSON must not be quietly read as
   * a collection with no cards in it. That is this feature's own worst
   * failure wearing a different hat: a shelf that reads as empty. */
  test('a collection whose cards cannot be read at all is dropped, not emptied', async () => {
    db.prepare(`
      INSERT INTO collections (key, name, source, col_id, color, cards_json, entries, total)
      VALUES ('archidekt:broken', 'Broken', 'archidekt', '9', '#a855f7', '{not json', 3, 3)
    `).run();
    assert.equal(await collection(cookie, 'archidekt:broken'), undefined,
      'a collection nobody can read came back as a shelf with nothing on it');
  });

  test('a card nobody owns any copies of has an empty breakdown, not a phantom one', async () => {
    await save({ 'Sol Ring': { name: 'Sol Ring', qty: 0 } });
    const card = (await collection(cookie, 'archidekt:2')).cards['Sol Ring'];
    assert.equal(card.qty, 0);
    assert.deepEqual(card.printings, []);
  });
});

// ── The tab ───────────────────────────────────────────────────────────────
/* js/collections.js, loaded whole over a state the app could be in a moment
 * after the collections have arrived — the same sandbox
 * test/collectionowner.test.js drives. What is stubbed is everything outside
 * the tab: the pictures, the deck panel, the network. */
function loadTab({ collections, players, user } = {}) {
  const store = new Map();
  const els   = new Map();

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
    /** The table, drawn: its columns, its rows, and what each says it holds. */
    table() {
      run('renderResults()');
      const body = el('resultsBody').innerHTML;
      return {
        columns: [...el('headerRow').innerHTML.matchAll(/>([^<]+)<\/th>/g)].map(m => m[1]),
        header:  el('headerRow').innerHTML,
        rows:    [...body.matchAll(/data-name="([^"]+)"/g)].map(m => m[1]),
        totals:  [...body.matchAll(/td-total">(\d+)</g)].map(m => +m[1]),
        // The Printings cell of each row, tags stripped — what a person reads.
        printings: [...body.matchAll(/<td class="td-print[^"]*">([\s\S]*?)<\/td>/g)]
          .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()),
        // The detail the summary hands to a tooltip rather than to the row.
        printingTitles: [...body.matchAll(/<td class="td-print[^"]*">([\s\S]*?)<\/td>/g)]
          .map(m => [...m[1].matchAll(/title="([^"]*)"/g)].map(t => t[1])),
        empty: (body.match(/class="empty-state">([^<]*)/) || [, ''])[1],
      };
    },
  };
}

const PLAYERS = [{ id: 'p-tim', name: 'Tim', decks: [] }];
const AS_TIM  = { username: 'tim', role: 'player', playerId: 'p-tim' };

/** A shelf as the server hands one over: printings materialised, unknown and all. */
const shelf = (key, cards) => ({
  key, name: key, source: 'archidekt', color: '#a855f7', owner: 'p-tim', cards,
});

const OLD_SHELF = shelf('c:old', {
  'Sol Ring':  { name: 'Sol Ring',  type: 'Artifact', mana: '{1}', qty: 3,
                 printings: [{ id: null, qty: 3 }] },
  'Cultivate': { name: 'Cultivate', type: 'Sorcery', mana: '{2}{G}', qty: 1,
                 printings: [{ id: null, qty: 1 }] },
});

describe('the Printings column', () => {
  test('is on the table, and the table is still one row per card', () => {
    const table = loadTab({ collections: [OLD_SHELF], players: PLAYERS, user: AS_TIM }).table();
    assert.deepEqual(table.columns, ['Card Name', 'Printings', 'c:old', 'Total']);
    assert.deepEqual(table.rows, ['Cultivate', 'Sol Ring'],
      'the table grew a row per physical copy');
  });

  test('reads “unknown” for a shelf that has not been re-imported', () => {
    const table = loadTab({ collections: [OLD_SHELF], players: PLAYERS, user: AS_TIM }).table();
    assert.deepEqual(table.printings, ['unknown', 'unknown']);
  });

  /* The quantities are the same numbers they always were. */
  test('and costs the quantities beside it nothing', () => {
    const table = loadTab({ collections: [OLD_SHELF], players: PLAYERS, user: AS_TIM }).table();
    assert.deepEqual(table.totals, [1, 3]);
  });

  /* A collection the client has built itself — a CSV parsed in the browser —
   * has never been near the server's shape helpers. */
  test('reads “unknown” for a card carrying no breakdown at all', () => {
    const bare = shelf('c:bare', { 'Sol Ring': { name: 'Sol Ring', qty: 2 } });
    const table = loadTab({ collections: [bare], players: PLAYERS, user: AS_TIM }).table();
    assert.deepEqual(table.printings, ['unknown']);
    assert.deepEqual(table.totals, [2]);
  });

  test('says which printings a re-imported shelf holds, and how many of each', () => {
    const known = shelf('c:new', { 'Sol Ring': { name: 'Sol Ring', qty: 3, printings: [
      { ...C21, qty: 2 }, { ...XM, qty: 1 },
    ] } });
    const table = loadTab({ collections: [known], players: PLAYERS, user: AS_TIM }).table();
    assert.match(table.printings[0], /2× C21/);
    assert.match(table.printings[0], /1× XM/);
    assert.doesNotMatch(table.printings[0], /unknown/);
  });

  test('marks a foil as one, so the copy somebody paid extra for is not an ordinary one', () => {
    const known = shelf('c:new', { 'Sol Ring': { name: 'Sol Ring', qty: 2, printings: [
      { ...C21, qty: 1 }, { ...C21, finish: 'foil', qty: 1 },
    ] } });
    const table = loadTab({ collections: [known], players: PLAYERS, user: AS_TIM }).table();
    assert.match(table.printings[0], /✦/, 'nothing on the row says one of them is a foil');
  });

  /* A set code is not a printing. One set holds the ordinary Sol Ring and its
   * extended-art twin, and both read C21 on this row — so the detail behind
   * the row has to name both numbers, rather than asserting the first one's
   * over a copy that is not it. */
  test('does not claim a collector number it cannot be sure of', () => {
    const twins = shelf('c:twins', { 'Sol Ring': { name: 'Sol Ring', qty: 2, printings: [
      { ...C21, qty: 1 },
      { ...C21, id: 'p-c21-alt', collector_number: '514', qty: 1 },
    ] } });
    const table = loadTab({ collections: [twins], players: PLAYERS, user: AS_TIM }).table();
    assert.match(table.printings[0], /2× C21/);
    const title = table.printingTitles[0][0];
    assert.match(title, /#263/);
    assert.match(title, /#514/, 'the row names one twin’s number over both of them');
  });

  /* Half re-imported is a real state: a shelf whose CSV rows carry no edition
   * beside API rows that do. */
  test('says so where only some of the copies are accounted for', () => {
    const part = shelf('c:part', { 'Sol Ring': { name: 'Sol Ring', qty: 3, printings: [
      { ...C21, qty: 2 }, { id: null, qty: 1 },
    ] } });
    const table = loadTab({ collections: [part], players: PLAYERS, user: AS_TIM }).table();
    assert.match(table.printings[0], /2× C21/);
    assert.match(table.printings[0], /1× unknown/);
  });

  /* One row per card, and the row is the whole shelf — so the breakdown is
   * every collection on it, added up the way the Total column is. */
  test('adds up across every collection on the shelf', () => {
    const a = shelf('c:a', { 'Sol Ring': { name: 'Sol Ring', qty: 1, printings: [{ ...C21, qty: 1 }] } });
    const b = shelf('c:b', { 'Sol Ring': { name: 'Sol Ring', qty: 2, printings: [{ ...C21, qty: 2 }] } });
    const table = loadTab({ collections: [a, b], players: PLAYERS, user: AS_TIM }).table();
    assert.deepEqual(table.totals, [3]);
    assert.match(table.printings[0], /3× C21/);
  });

  test('can be turned off, like every other column on this table', () => {
    const tab = loadTab({ collections: [OLD_SHELF], players: PLAYERS, user: AS_TIM });
    tab.run(`toggleCol('collections', 'printings', COL_COLUMNS)`);
    const table = tab.table();
    assert.deepEqual(table.columns, ['Card Name', 'c:old', 'Total']);
    assert.deepEqual(table.printings, []);
  });
});

describe('everything that worked before', () => {
  /* Nothing about this table's sort may have changed: the column carries no
   * sort of its own, and the header gesture must not offer one — a click that
   * hands the sort control a field it cannot name is a table sorted on
   * nothing. */
  test('the Printings column is not a sort, and does not claim to be', () => {
    const tab = loadTab({ collections: [OLD_SHELF], players: PLAYERS, user: AS_TIM });
    const table = tab.table();
    assert.ok(!/data-sort="printings"/.test(table.header),
      'the column offers a sort the control cannot say');
    assert.ok(!tab.answer('colSortFields()').some(f => (f.key || f) === 'printings'),
      'the sort control offers a field the table cannot order by');
  });

  test('sorting still orders the rows it always did', () => {
    const tab = loadTab({ collections: [OLD_SHELF], players: PLAYERS, user: AS_TIM });
    tab.run(`saveSortChain('collections', { criteria: [{ field: 'qty', dir: -1 }], edited: true })`);
    assert.deepEqual(tab.table().rows, ['Sol Ring', 'Cultivate']);
  });

  test('searching still finds the cards it always did', () => {
    const tab = loadTab({ collections: [OLD_SHELF], players: PLAYERS, user: AS_TIM });
    tab.run(`document.getElementById('searchInput').value = 'sol'`);
    const table = tab.table();
    assert.deepEqual(table.rows, ['Sol Ring']);
    assert.deepEqual(table.printings, ['unknown'], 'a filtered row lost its breakdown');
  });
});
