/* A deck card can carry a printing, and keeps it.
 *
 * The walking skeleton for chosen printings: a deck row holds a trimmed
 * snapshot of one real Scryfall printing, and nothing in the interface sets
 * one yet. So what is worth asserting is entirely about survival — the road,
 * before anything travels on it.
 *
 * A printing is null on every deck that exists today and that has to go on
 * meaning what it has always meant: the card is a name and the app picks the
 * printing. The column arrives by an ALTER on a table whose primary key does
 * not change, which is the cheap migration rather than the table copy the
 * board column needed, and this file is where that is held to.
 *
 * Two layers, both against the shipped files:
 *
 *   the migration   a database in the pre-printing shape, opened by
 *                   available-db.js — its rows, and the rows themselves rather
 *                   than copies of them
 *   the tab         the deck-builder modules in a vm sandbox, as
 *                   test/deckboards.test.js runs them: a printing loaded with
 *                   a deck is still on the card when the deck is saved back,
 *                   restored, moved and re-counted
 *
 * The route is asserted in test/server.test.js and the snapshot in
 * test/deckhistory.test.js, each beside the rest of its own layer.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** A printing as the client will hand one over: trimmed, and taken on a day. */
const RAV_SOL_RING = {
  id: '6e9f2eb0-8ca1-4e9d-9f2b-0a1b2c3d4e5f',
  set: 'rav',
  set_name: 'Ravnica: City of Guilds',
  collector_number: '266',
  image: 'https://cards.scryfall.io/normal/rav-sol-ring.jpg',
  price_eur: '4.50',
  chosen_at: '2026-08-14',
};

// ── The migration ─────────────────────────────────────────────────────────
// A database from after boards and before this: six card rows across two
// decks, none of which knows anything about a printing.

/** A database in the old shape, at a path of its own. */
function preprintingDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgprinting-'));
  const Database = require('better-sqlite3');
  const db = new Database(path.join(dir, 'available.db'));
  db.exec(`
    CREATE TABLE deck_cards (
      deck_id   TEXT NOT NULL,
      card_name TEXT NOT NULL,
      qty       INTEGER NOT NULL DEFAULT 1,
      category  TEXT NOT NULL DEFAULT '',
      board     TEXT NOT NULL DEFAULT 'main',
      position  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (deck_id, board, card_name)
    );
    CREATE TABLE deck_categories (
      deck_id  TEXT NOT NULL,
      name     TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (deck_id, name)
    );
    CREATE TABLE app_state (
      key        TEXT PRIMARY KEY,
      value_json TEXT NOT NULL DEFAULT '{}',
      version    INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO deck_cards (deck_id, card_name, qty, category, board, position) VALUES
      ('d1', 'Sol Ring',     1, 'Ramp',  'main',  0),
      ('d1', 'Forest',       9, 'Lands', 'main',  1),
      ('d1', 'Black Lotus',  1, 'Ramp',  'maybe', 2),
      ('d2', 'Lightning Bolt', 4, 'Instants', 'main', 0),
      ('d2', 'Mountain',      20, 'Lands',    'main', 1),
      ('d2', 'Sol Ring',       1, 'Ramp',     'main', 2);
    INSERT INTO deck_categories (deck_id, name, position) VALUES
      ('d1', 'Ramp', 0), ('d1', 'Lands', 1),
      ('d2', 'Instants', 0), ('d2', 'Lands', 1);
    INSERT INTO app_state (key, value_json, version) VALUES ('state', '{"players":[]}', 3);
  `);
  /* What the rows are, and *which* rows they are. An ALTER leaves both alone;
   * a table copy keeps the first and silently renumbers the second, so the
   * rowids are how "no rebuild" is asserted rather than assumed. */
  const before = db.prepare(
    'SELECT rowid, deck_id, card_name, qty, category, board, position FROM deck_cards ORDER BY rowid'
  ).all();
  db.close();
  return { dir, before };
}

/* One process, one available-db: the module binds to DATA_FILE as it loads, so
 * the old database is put in place first and opened by requiring it. */
const legacy = preprintingDb();
process.env.DATA_FILE = path.join(legacy.dir, 'state.json');
const { db } = require('../available-db');

const rows = () => db.prepare(
  'SELECT rowid, deck_id, card_name, qty, category, board, position FROM deck_cards ORDER BY rowid'
).all();
const columns = () => db.prepare('PRAGMA table_info(deck_cards)').all().map(c => c.name);
const printingOf = (deckId, name) => db.prepare(
  'SELECT printing FROM deck_cards WHERE deck_id = ? AND board = ? AND card_name = ?'
).get(deckId, 'main', name)?.printing;

test('a database from before printings gains the column', () => {
  assert.ok(columns().includes('printing'), 'deck_cards has nowhere to put a printing');
});

test('and every row that was in it is untouched', () => {
  // Six cards across two decks, with their quantities, piles, boards and
  // order. A migration that loses one of these loses somebody's deck.
  assert.deepStrictEqual(rows(), legacy.before);
});

test('every existing card is a name, which is what it has always been', () => {
  const chosen = db.prepare('SELECT COUNT(*) AS n FROM deck_cards WHERE printing IS NOT NULL').get();
  assert.strictEqual(chosen.n, 0, 'the migration invented a printing for somebody');
});

test('the table was altered, not rebuilt', () => {
  /* The primary key does not change — (deck_id, board, card_name) says what it
   * said before — so this is an ALTER guarded by PRAGMA table_info, in the
   * pattern owner_player_id used, rather than the copy the board column
   * needed. The rowids in the assertion above are the proof of that; this one
   * says why it matters, by holding the key itself. */
  const sql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'deck_cards'").get().sql;
  assert.match(sql, /PRIMARY KEY\s*\(\s*deck_id,\s*board,\s*card_name\s*\)/,
    'the key grew the printing, and every path that finds a card by name is now wrong');
});

test('opening it a second time leaves a printing that has been chosen alone', () => {
  // The guard is the column's own presence, so this is what a restart is.
  db.prepare('UPDATE deck_cards SET printing = ? WHERE deck_id = ? AND card_name = ?')
    .run(JSON.stringify(RAV_SOL_RING), 'd1', 'Sol Ring');
  delete require.cache[require.resolve('../available-db')];
  require('../available-db');
  assert.deepStrictEqual(JSON.parse(printingOf('d1', 'Sol Ring')), RAV_SOL_RING,
    'a second open wiped a chosen printing');
});

// ── What the column holds ─────────────────────────────────────────────────
// One column of trimmed JSON rather than six columns: nothing on the server
// side queries these fields, and the row is carried whole. The shape is a
// decision — it is what the mat, the price and the export all read — so the
// two functions that cross the column are what keep it one.

const { readPrinting, writePrinting } = require('../available-db');

test('a printing goes into the column as JSON and comes back as itself', () => {
  assert.deepStrictEqual(readPrinting(writePrinting(RAV_SOL_RING)), RAV_SOL_RING);
});

test('a card that is only a name has no printing, however it says so', () => {
  // Null is the column's own answer, undefined is a client that has never
  // chosen one, and the empty string is neither.
  for (const nothing of [null, undefined, '', 'null', {}, [], 42, 'not json at all']) {
    assert.strictEqual(readPrinting(nothing), null, `${JSON.stringify(nothing)} named a printing`);
    assert.strictEqual(writePrinting(nothing), null, `${JSON.stringify(nothing)} was written down`);
  }
});

test('a printing with no id is not a printing', () => {
  // The id is what makes the snapshot point at a real card. Without one there
  // is nothing to re-price later and nothing to have chosen.
  assert.strictEqual(readPrinting({ ...RAV_SOL_RING, id: '' }), null);
});

test('what arrives with more on it than the shape is trimmed to the shape', () => {
  /* The whole Scryfall record is 4 KB and this is seven fields of it. A row
   * that carried the rest would be a cache nothing refreshes, in a column
   * nothing queries. */
  const fat = { ...RAV_SOL_RING, oracle_text: 'T: Add C.', legalities: { modern: 'legal' }, foil: true };
  assert.deepStrictEqual(readPrinting(fat), RAV_SOL_RING);
});

test('and what arrives with less is what it says, not a shape padded out', () => {
  // A printing Cardmarket has no price for is a printing with no price. The
  // field is absent rather than an empty string, so "unknown" stays tellable
  // from "free" — the rule the deck's total already lives by.
  const unpriced = { id: RAV_SOL_RING.id, set: 'rav', collector_number: '266' };
  assert.deepStrictEqual(readPrinting(unpriced), unpriced);
});

test('a printing is read back the same way whoever wrote it down', () => {
  /* The column's text and the client's object are the same printing, and the
   * deck's history compares two states by serialising them. Two orderings of
   * seven keys would be two states, and the panel would show a change nobody
   * made. */
  const shuffled = {};
  for (const key of Object.keys(RAV_SOL_RING).reverse()) shuffled[key] = RAV_SOL_RING[key];
  assert.strictEqual(JSON.stringify(readPrinting(shuffled)), JSON.stringify(readPrinting(RAV_SOL_RING)));
  assert.strictEqual(writePrinting(shuffled), writePrinting(JSON.stringify(RAV_SOL_RING)));
});

// ── The tab ───────────────────────────────────────────────────────────────
// The deck-builder modules over a deck, with the network and the drawing
// surface stubbed, as test/deckboards.test.js runs them. State is seeded by
// assignment rather than through the sandbox, because js/deckview-core.js
// declares the deck with `let` and a property of the same name would be
// shadowed by it.

/** The tab, loaded whole, over a deck whose cards may carry printings.
 *
 *  `served` is what the cards endpoint answers with — this is the one harness
 *  here that goes through the load rather than seeding dbCards directly,
 *  because "arrives from the server and is still there on the way back" is the
 *  whole of what the client half asserts. */
function loadTab(served = []) {
  const store = new Map();
  const mat   = { innerHTML: '', classList: { toggle() {} } };
  const els   = {};
  const el = id => (els[id] ||= {
    innerHTML: '', textContent: '', title: '', value: '', style: {},
    setAttribute(k, v) { (this.attrs ||= {})[k] = v; },
    classList: { toggle() {}, add() {}, remove() {} },
  });

  const sandbox = {
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    document: {
      addEventListener() {}, querySelectorAll: () => [], createElement: () => el('made'),
      getElementById: id => (id === 'dbDeckContent' ? mat : el(id)),
      body: { appendChild() {}, style: {} },
      scrollingElement: { scrollTop: 0 },
      documentElement:  { scrollTop: 0 },
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    isMyPlayer: id => id === 'p1',
    confirm: () => true,
    alert: () => {},
    clearTimeout() {},
    fetch: async (url, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : null;
      sandbox.calls.push({ url, method: opts.method || 'GET', body });
      const cards = url.endsWith('/cards') && !opts.method
        ? { cards: served, categories: [{ name: 'Ramp', position: 0 }] }
        : { ok: true };
      return { ok: true, status: 200, json: async () => cards };
    },
    calls: [],
    esc: s => String(s),
    jsAttr: s => String(s),
    renderMana: () => '', renderPrice: () => '', sfCardOwnership: () => '',
    /* One player with one deck, because the load is asked for by name here —
     * dbLoadDeck reads the deck off the state before it asks the server for
     * its cards. Nothing else in this file needs the shelf, and none of these
     * decks is owned by anybody: that is test/deckowned.test.js's subject. */
    state: { collections: [], players: [{ id: 'p1', name: 'P1', decks: [{ id: 'd1', name: 'A deck' }] }] },
    myPlayerId: () => 'p1', colOwner: () => null, playerColor: () => '',
    scryfallMetaCache: new Map(),
    openCardByName() {},
    animateCardMove: (_el, paint) => paint(),
  };
  sandbox.setTimeout = () => 1;
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  for (const file of ['sortui.js', 'cardstack.js', 'deckview-boards.js',
                      'deckview-core.js', 'deckview-render.js',
                      'deckview-edit.js', 'deckview-panels.js', 'deckview-history.js',
                      'deckview-owned.js', 'deckview-totals.js', 'deckview-legality.js',
                      'deckview-mana.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`dbDeck = { id: 'd1', playerId: 'p1', name: 'A deck', commander: '' }`);
  run(`dbCards = ${JSON.stringify(served)}`);
  run(`dbCats = [{ name: 'Ramp', position: 0 }]`);
  run(`dbShownBoards = new Set()`);
  run(`dbCardData = new Map(${JSON.stringify([
    ['Sol Ring', { name: 'Sol Ring', type_line: 'Artifact', cmc: 1, color_identity: [] }],
    ['Forest',   { name: 'Forest',   type_line: 'Basic Land — Forest', cmc: 0, color_identity: ['G'] }],
  ])})`);

  return {
    run, answer,
    /** The deck as the tab holds it. */
    cards: () => answer('dbCards'),
    /** The printing on one card of it, wherever that card has got to. */
    printing: name => answer(
      `dbCards.find(c => c.card_name === ${JSON.stringify(name)})?.printing || null`),
    /** What the last save sent, or null if nothing has been saved. */
    saved: async () => {
      await run('_dbSaveNow()');
      const put = sandbox.calls.filter(c => c.method === 'PUT').pop();
      return put ? put.body : null;
    },
    calls: () => sandbox.calls,
  };
}

const SOL_RING = { card_name: 'Sol Ring', qty: 1, category: 'Ramp', board: 'main', position: 0,
                   printing: RAV_SOL_RING };
const FOREST   = { card_name: 'Forest', qty: 9, category: 'Ramp', board: 'main', position: 1 };

test('a printing arrives with the deck and is on the card the tab holds', async () => {
  const tab = loadTab([SOL_RING, FOREST]);
  tab.run(`dbCards = []`);
  await tab.run(`dbSelectDeck('p1|d1')`);
  assert.deepStrictEqual(tab.printing('Sol Ring'), RAV_SOL_RING);
  assert.strictEqual(tab.printing('Forest'), null, 'a card that is a name was given a printing');
});

test('and it goes back to the server on the next save', async () => {
  // The deck's ordinary debounced save is what carries a chosen printing; the
  // choosing itself writes nothing.
  const tab  = loadTab([SOL_RING, FOREST]);
  const body = await tab.saved();
  assert.deepStrictEqual(body.cards[0].printing, RAV_SOL_RING);
  assert.strictEqual(body.cards[1].printing, undefined,
    'a card with no printing sent one anyway');
});

test('a quantity, a pile and a board change all leave it where it was', async () => {
  /* Three of the four things that happen to a card in a deck, none of which is
   * a printing change. Each rebuilds or rewrites the card entry somewhere, and
   * a field dropped in the rebuild is a printing that vanishes when somebody
   * adds a second copy. */
  const tab = loadTab([SOL_RING, FOREST]);
  tab.run(`dbChangeQty(dbPlace('main', 'Sol Ring'), 2)`);
  assert.deepStrictEqual(tab.printing('Sol Ring'), RAV_SOL_RING, 'a quantity change took it');
  tab.run(`dbMoveCardsTo([dbPlace('main', 'Sol Ring')], 'main/Lands')`);
  assert.deepStrictEqual(tab.printing('Sol Ring'), RAV_SOL_RING, 'a pile change took it');
  tab.run(`dbMoveCardsTo([dbPlace('main', 'Sol Ring')], 'maybe')`);
  assert.deepStrictEqual(tab.printing('Sol Ring'), RAV_SOL_RING, 'a board change took it');
});

test('a restored snapshot brings the printings back with it', () => {
  // The board is put back the same way, and for the same reason: a deck
  // restored without what its cards were is not the deck that was restored.
  const tab = loadTab([]);
  tab.run(`_dbApplyRestored(${JSON.stringify([SOL_RING, FOREST])}, [{ name: 'Ramp', position: 0 }])`);
  assert.deepStrictEqual(tab.printing('Sol Ring'), RAV_SOL_RING);
  assert.strictEqual(tab.printing('Forest'), null);
});

test('and a snapshot taken by the tab carries them out', () => {
  const tab  = loadTab([SOL_RING, FOREST]);
  const body = tab.answer(`_dbSnapshotBody('edit')`);
  assert.deepStrictEqual(body.cards[0].printing, RAV_SOL_RING);
});
