/* The commander is a board.
 *
 * It used to be a category holding one card, and nearly every deck in the app
 * paid a header, a pile and a row of mat for it — to display a card that never
 * moves, never sorts, and that the deck already knew about: the record names
 * it, the count leaves it out, the recommendations key off it.
 *
 * As a board it is one of the things ticket 04 built, and what is asserted
 * here is mostly that being one of them is enough: that two commanders are
 * simply two cards in it, that the deck's own numbers go on being the
 * mainboard's, and that a deck which never had a commander is not given a
 * region for one.
 *
 * Three layers, all against the shipped files:
 *
 *   the migration   a database with the old category in it, opened by
 *                   available-db.js — cards, categories and the deck records
 *   the mat         the deck-builder modules in a vm sandbox, as
 *                   test/deckboards.test.js runs them
 *   the frame       the stylesheet, read as text where what matters is that a
 *                   rule exists
 *
 * What is not asserted is what the head of the mat looks like. That is the
 * eye's.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── The migration ─────────────────────────────────────────────────────────
// A database from after boards and before this: every commander is a card in
// the mainboard filed under a category called Commander, and one of the decks
// holding one names no commander on its record.

/** A database in the old shape, with three decks in it, at a path of its own. */
function categoryDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgcommander-'));
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
      ('d1', 'Atraxa, Praetors'' Voice', 1, 'Commander', 'main',  0),
      ('d1', 'Sol Ring',                 1, 'Ramp',      'main',  1),
      ('d1', 'Black Lotus',              1, 'Ramp',      'maybe', 2),
      ('d2', 'Krark, the Thumbless',     1, 'Commander', 'main',  0),
      ('d2', 'Sakashima of a Thousand Faces', 1, 'Commander', 'main', 1),
      ('d2', 'Forest',                   7, 'Lands',     'main',  2),
      ('d3', 'Lightning Bolt',           4, 'Instants',  'main',  0),
      ('d4', 'Ragavan, Nimble Pilferer',  1, 'Creatures', 'main',  0),
      ('d4', 'Mountain',                 30, 'Lands',     'main',  1),
      ('d5', 'Crystalline Crawler',       1, 'Commander', 'main',  0),
      ('d5', 'Kilo, Apogee Mind',         1, 'Creatures', 'main',  1);
    INSERT INTO deck_categories (deck_id, name, position) VALUES
      ('d1', 'Commander', 0), ('d1', 'Ramp', 1),
      ('d2', 'Commander', 0), ('d2', 'Lands', 1),
      ('d3', 'Commander', 0), ('d3', 'Instants', 1),
      ('d4', 'Creatures', 0), ('d4', 'Lands', 1);
    INSERT INTO app_state (key, value_json, version) VALUES ('state', '${JSON.stringify({
      players: [{ id: 'p1', name: 'Tim', decks: [
        { id: 'd1', name: 'Atraxa', commander: "Atraxa, Praetors' Voice" },
        { id: 'd2', name: 'Krark',  commander: '' },
        { id: 'd3', name: 'Burn' },
        { id: 'd4', name: 'Ragavan', commander: 'Ragavan, Nimble Pilferer' },
        { id: 'd5', name: 'Kilo',    commander: 'Kilo, Apogee Mind' },
      ] }],
    }).replace(/'/g, "''")}', 3);
  `);
  db.close();
  return dir;
}

/* One process, one available-db: the module binds to DATA_FILE as it loads, so
 * the old database is put in place first and opened by requiring it. */
const legacyDir = categoryDb();
process.env.DATA_FILE = path.join(legacyDir, 'state.json');
const { db } = require('../available-db');

const cardsOf = deckId => db.prepare(
  'SELECT card_name, qty, category, board FROM deck_cards WHERE deck_id = ? ORDER BY position, card_name'
).all(deckId);
const catsOf = deckId => db.prepare(
  'SELECT name FROM deck_categories WHERE deck_id = ? ORDER BY position'
).all(deckId).map(r => r.name);
const stateRow = () => db.prepare("SELECT value_json, version FROM app_state WHERE key = 'state'").get();
const deckRecord = id => JSON.parse(stateRow().value_json).players[0].decks.find(d => d.id === id);

test('the card that was in the Commander category is in the commander board', () => {
  assert.deepStrictEqual(cardsOf('d1'), [
    { card_name: "Atraxa, Praetors' Voice", qty: 1, category: 'Commander', board: 'commander' },
    { card_name: 'Sol Ring',                qty: 1, category: 'Ramp',      board: 'main' },
    { card_name: 'Black Lotus',             qty: 1, category: 'Ramp',      board: 'maybe' },
  ], 'the migration moved a card it had no business moving, or left the commander in the deck');
});

test('and the category is gone, while the deck’s own categories are untouched', () => {
  assert.deepStrictEqual(catsOf('d1'), ['Ramp']);
  assert.deepStrictEqual(catsOf('d3'), ['Instants'],
    'a deck that never had a commander kept a category for one');
});

test('two commanders migrate as two cards in one board', () => {
  // Partners, a Background, a Doctor's Companion: nothing about the deck's
  // single-string commander field has to be decided, because the board holds
  // however many the format allows.
  const board = cardsOf('d2').filter(c => c.board === 'commander').map(c => c.card_name);
  assert.deepStrictEqual(board, ['Krark, the Thumbless', 'Sakashima of a Thousand Faces']);
});

test('a deck with the category and no commander on its record adopts one', () => {
  // Rather than losing it. The record's field still has two jobs after this —
  // the tile art and the EDHREC lookup — and an empty one does neither.
  assert.strictEqual(deckRecord('d2').commander, 'Krark, the Thumbless',
    'the first of them was not adopted');
  assert.strictEqual(deckRecord('d1').commander, "Atraxa, Praetors' Voice",
    'a deck that already named its commander had it overwritten');
  assert.strictEqual(deckRecord('d3').commander, undefined,
    'a deck with no commander at all was given one');
});

test('a commander that was never in the category comes out of the deck too', () => {
  /* The count this replaces never read the category — it subtracted the card
   * the record names, wherever it had been filed. A deck whose commander had
   * drifted into Lands was still a deck of ninety-nine, and it stays one. */
  assert.deepStrictEqual(cardsOf('d4'), [
    { card_name: 'Ragavan, Nimble Pilferer', qty: 1, category: 'Creatures', board: 'commander' },
    { card_name: 'Mountain',                qty: 30, category: 'Lands',     board: 'main' },
  ]);
});

test('but a deck that had both keeps counting the one it was already counting', () => {
  // The category named one card and the record another. Taking both out would
  // move a number that has not changed.
  assert.deepStrictEqual(cardsOf('d5'), [
    { card_name: 'Crystalline Crawler', qty: 1, category: 'Commander', board: 'commander' },
    { card_name: 'Kilo, Apogee Mind',   qty: 1, category: 'Creatures', board: 'main' },
  ]);
});

test('the deck records were written as a new version, so an open browser refreshes', () => {
  assert.strictEqual(stateRow().version, 4);
});

test('running it again leaves a category somebody made called Commander alone', () => {
  // This is why the guard is a marker row and not "is there a Commander
  // category?": the name is an ordinary one from now on, and a migration that
  // ran twice would take it off whoever made it.
  db.prepare('INSERT INTO deck_categories (deck_id, name, position) VALUES (?,?,?)')
    .run('d3', 'Commander', 2);
  db.prepare('INSERT INTO deck_cards (deck_id, card_name, qty, category, board, position) VALUES (?,?,?,?,?,?)')
    .run('d3', 'Goblin Guide', 4, 'Commander', 'main', 1);
  delete require.cache[require.resolve('../available-db')];
  require('../available-db');
  assert.ok(catsOf('d3').includes('Commander'), 'the category was taken away again');
  assert.strictEqual(cardsOf('d3').find(c => c.card_name === 'Goblin Guide').board, 'main',
    'and a card was moved onto the commander board behind somebody’s back');
});

// ── The mat ───────────────────────────────────────────────────────────────
// The deck-builder modules over a deck, with the network and the drawing
// surface stubbed. State is seeded by assignment rather than through the
// sandbox, because js/deckview-core.js declares the deck with `let` and a
// property of the same name would be shadowed by it.

/** The tab, loaded whole, over a deck that may have a commander. */
function loadTab(cards, { commander = '', cats = ['Ramp', 'Lands'], stored = {} } = {}) {
  const store = new Map(Object.entries(stored));
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
      sandbox.calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    calls: [], saves: 0,
    esc: s => String(s),
    jsAttr: s => String(s),
    renderMana: () => '', renderPrice: () => '', sfCardOwnership: () => '',
    /* What js/deckview-owned.js reaches outside the tab for: the collections,
       whose each of them is, and who you are. None of these decks is owned by
       anybody here — that is test/deckowned.test.js's subject — so the shelf is
       empty, nothing is owned, and the ownership chip is off. */
    state: { collections: [], players: [] },
    myPlayerId: () => null, colOwner: () => null, playerColor: () => '',
    scryfallMetaCache: new Map(),
    openCardByName() {},
    animateCardMove: (_el, paint) => paint(),
  };
  sandbox.setTimeout = fn => { sandbox.saves++; return 1; };
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  for (const file of ['sortui.js', 'cardstack.js', 'deckview-boards.js',
                      'deckview-core.js', 'deckview-render.js',
                      'deckview-edit.js', 'deckview-panels.js', 'deckview-history.js',
                      'deckview-owned.js', 'deckview-totals.js', 'deckview-legality.js',
                      'deckview-mana.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`dbDeck = { id: 'd1', playerId: 'p1', name: 'A deck', commander: ${JSON.stringify(commander)} }`);
  run(`dbCards = ${JSON.stringify(cards.map((c, i) => ({ qty: 1, board: 'main', position: i, ...c })))}`);
  run(`dbCats = ${JSON.stringify(cats.map((name, i) => ({ name, position: i })))}`);
  run(`_dbLoadShownBoards('d1')`);
  run(`dbCardData = new Map(${JSON.stringify([
    ['Atraxa',     { name: 'Atraxa',     type_line: 'Legendary Creature — Phyrexian Angel Horror', cmc: 4, color_identity: ['W','U','B','G'] }],
    ['Krark',      { name: 'Krark',      type_line: 'Legendary Creature — Goblin Wizard', cmc: 2, color_identity: ['R'] }],
    ['Sakashima',  { name: 'Sakashima',  type_line: 'Legendary Creature — Human Rogue', cmc: 4, color_identity: ['U'] }],
    ['Sol Ring',   { name: 'Sol Ring',   type_line: 'Artifact', cmc: 1, color_identity: [] }],
    ['Doom Blade', { name: 'Doom Blade', type_line: 'Instant',  cmc: 2, color_identity: ['B'] }],
    ['Forest',     { name: 'Forest',     type_line: 'Basic Land — Forest', cmc: 0, color_identity: ['G'] }],
  ])})`);

  return {
    run, answer, mat, store, el,
    cards: () => answer('dbCards').map(c => `${c.board}/${c.card_name}×${c.qty}:${c.category}`).sort(),
    at:    (board, name) => answer(`dbFindCard(dbPlace(${JSON.stringify(board)}, ${JSON.stringify(name)})) || null`),
    paint: () => { run('dbRender()'); return mat.innerHTML; },
    calls: () => sandbox.calls,
  };
}

/** One board's region of the mat, cut out of it. The commander board is drawn
 *  at the *head*, so everything after it is the deck — the region ends where
 *  the next section on the mat begins. */
function boardRegion(html, id) {
  // Split at the sections themselves and not at their headings, which the mat
  // spells `dv-section-hdr` — hence the lookahead.
  return html.split(/<div class="dv-section(?=[ "])/)
    .find(part => part.includes(`data-board="${id}"`)) || '';
}

const DECK = [
  { card_name: 'Sol Ring',   category: 'Ramp' },
  { card_name: 'Doom Blade', category: 'Removal' },
  { card_name: 'Forest',     category: 'Lands', qty: 4 },
];
const CMD  = { card_name: 'Atraxa', category: 'Creatures', board: 'commander' };
const CMD2 = { card_name: 'Krark',     category: 'Creatures', board: 'commander' };
const CMD3 = { card_name: 'Sakashima', category: 'Creatures', board: 'commander' };

// ── Where it is drawn ─────────────────────────────────────────────────

test('the commander draws at the head of the mat, and not as a category', () => {
  const tab = loadTab([CMD, ...DECK], { commander: 'Atraxa' });
  const html = tab.paint();
  assert.ok(html.includes('data-board="commander"'), 'there is no commander on the mat');
  assert.ok(html.indexOf('data-board="commander"') < html.indexOf('data-cat='),
    'the commander is drawn somewhere below the deck');
  assert.ok(!html.includes('data-cat="Commander"'), 'the commander is still a category');
  assert.ok(html.indexOf('data-board="commander"') < html.indexOf('data-board="maybe"'),
    'the head of the deck is drawn among the boards lying beside it');
});

test('a deck with two commanders shows both, and neither is in a category', () => {
  const tab = loadTab([CMD2, CMD3, ...DECK], { commander: 'Krark' });
  const html = tab.paint();
  assert.ok(html.includes('data-carry="commander/Krark"'));
  assert.ok(html.includes('data-carry="commander/Sakashima"'));
  assert.strictEqual(tab.answer(`dbMainCards().filter(c => c.card_name === 'Krark').length`), 0,
    'a commander was counted as being in the deck');
  const region = boardRegion(html, 'commander');
  assert.strictEqual((region.match(/dv-section-hdr/g) || []).length, 1,
    'the commander board grew headings of its own');
});

test('the commander board is drawn as the head of the deck rather than as a holding area', () => {
  const tab = loadTab([CMD, ...DECK], { commander: 'Atraxa' });
  const html = tab.paint();
  const region = boardRegion(html, 'commander');
  assert.ok(region.startsWith(' db-board db-board-head'),
    'nothing says this board is the head of the deck');
});

test('Commander is gone from the default categories a new deck is given', () => {
  const tab = loadTab(DECK);
  assert.ok(!tab.answer('DB_DEFAULT_CATS').includes('Commander'),
    'a new deck still arrives with a category for the commander');
  // And the same list on the other side, for a deck that has never been opened
  // in the tab: two copies of one sentence is two places for it to drift.
  const routes = read('routes/decks.js');
  const list = routes.match(/const DEFAULT_CATEGORIES = \[[\s\S]*?\];/)[0];
  assert.ok(!list.includes("'Commander'"), 'the server still hands out a Commander category');
});

test('a card is filed by what it is, even when it is the deck’s commander', () => {
  // dbAutoCategory used to answer "Commander" for the named one. Where the
  // commander goes is a board now, and that is asked a level up.
  const tab = loadTab(DECK, { commander: 'Atraxa' });
  assert.strictEqual(tab.answer(`dbAutoCategory('Atraxa')`), 'Creatures');
});

// ── What the deck says about itself ───────────────────────────────────

test('the commander is left out of the count, and the deck is a deck of ninety-nine', () => {
  const tab = loadTab([CMD, ...DECK], { commander: 'Atraxa' });
  tab.run('dbRenderStats()');
  assert.match(tab.el('dbStatCards').innerHTML, />6<\/strong> cards|6\/99/,
    'the commander was counted as one of the ninety-nine');
  assert.match(tab.el('dbStatCards').innerHTML, /6\/99/);
});

test('two commanders make it a deck of ninety-eight', () => {
  // A Commander deck is a hundred cards including whoever leads it, so the
  // target is what is left after them rather than a number that only ever
  // knew about one.
  const tab = loadTab([CMD2, CMD3, ...DECK], { commander: 'Krark' });
  tab.run('dbRenderStats()');
  assert.match(tab.el('dbStatCards').innerHTML, /6\/98/);
});

test('a deck that names a commander it holds no card for is still ninety-nine', () => {
  const tab = loadTab(DECK, { commander: 'Atraxa' });
  tab.run('dbRenderStats()');
  assert.match(tab.el('dbStatCards').innerHTML, /6\/99/);
});

test('and a deck with no commander at all is sixty, as it always was', () => {
  const tab = loadTab(DECK);
  tab.run('dbRenderStats()');
  assert.match(tab.el('dbStatCards').innerHTML, /6\/60/);
});

test('the curve and the average mana value are the deck’s, not the commander’s', () => {
  const bare = loadTab(DECK, { commander: 'Atraxa' });
  bare.run('dbRenderStats()');
  const led = loadTab([CMD, ...DECK], { commander: 'Atraxa' });
  led.run('dbRenderStats()');
  assert.strictEqual(led.el('dbCurve').innerHTML,  bare.el('dbCurve').innerHTML);
  assert.strictEqual(led.el('dbStatCmc').innerHTML, bare.el('dbStatCmc').innerHTML,
    'a four-drop that is not in the deck moved the deck’s average');
});

test('the recommendations still key off the commander', () => {
  const tab = loadTab([CMD, ...DECK], { commander: '' });
  tab.run('dbLoadEdhrec()');
  assert.ok(tab.calls().some(c => c.url.includes('/api/edhrec/commander/Atraxa')),
    'EDHREC was not asked about the card on the commander board');
});

test('and a deck with nothing on the board falls back to what its record names', () => {
  const tab = loadTab(DECK, { commander: 'Atraxa' });
  tab.run('dbLoadEdhrec()');
  assert.ok(tab.calls().some(c => c.url.includes('/api/edhrec/commander/Atraxa')));
});

test('the export has the commander at the head of it', () => {
  // A Commander list without its commander is not a list anybody can play.
  const tab = loadTab([CMD2, CMD3, ...DECK], { commander: 'Krark' });
  const text = tab.run('_dbExportText()');
  assert.ok(text.startsWith('// Commander\n1 Krark\n1 Sakashima\n'), text);
  assert.ok(text.includes('1 Sol Ring'));
});

test('and a list pasted back in puts the commander where it came from', async () => {
  const tab = loadTab([], { cats: [] });
  await tab.run(`_dbImportCards(_dbParseTextList('// Commander\\n1 Krark\\n\\n// Ramp\\n1 Sol Ring'))`);
  assert.strictEqual(tab.at('commander', 'Krark').qty, 1);
  assert.strictEqual(tab.at('main', 'Sol Ring').category, 'Ramp');
  assert.ok(!tab.answer('dbCats.map(c => c.name)').includes('Commander'),
    'the pasted heading made a category for it after all');
});

// ── Moving it, and not moving it ──────────────────────────────────────

test('adding the deck’s commander by name puts it where the commander goes', () => {
  const tab = loadTab(DECK, { commander: 'Atraxa' });
  tab.run(`dbAddCard('Atraxa')`);
  assert.strictEqual(tab.at('commander', 'Atraxa').qty, 1);
  assert.strictEqual(tab.at('main', 'Atraxa'), null, 'it went into the deck as an ordinary creature');
});

test('and any other card added by name still goes into the deck', () => {
  const tab = loadTab(DECK, { commander: 'Atraxa' });
  tab.run(`dbAddCard('Doom Blade')`);
  assert.strictEqual(tab.at('main', 'Doom Blade').qty, 2);
  assert.strictEqual(tab.at('commander', 'Doom Blade'), null);
});

test('the Move to… list offers the commander board like any other', () => {
  // Which is the only way to make one on a phone: a finger never picks a card
  // up, because the mat is scrolled with it.
  const tab = loadTab(DECK, { commander: 'Atraxa' });
  tab.run(`dbShowMoveCard('main/Doom Blade')`);
  assert.ok(tab.el('dbMoveCatList').innerHTML.includes(`dbConfirmMoveCard('commander')`));
});

test('a card carried onto the commander board keeps its pile for when it comes back', () => {
  const tab = loadTab(DECK, { commander: '' });
  assert.strictEqual(tab.run(`cardCarryDrop(['main/Doom Blade'], 'commander')`), true);
  assert.strictEqual(tab.at('commander', 'Doom Blade').category, 'Removal');
  assert.strictEqual(tab.run(`cardCarryDrop(['commander/Doom Blade'], 'main')`), true);
  assert.strictEqual(tab.at('main', 'Doom Blade').category, 'Removal');
});

test('selecting everything visible never takes the commander with it', () => {
  // Select-all is the first half of a bulk move, and a sweep over the deck
  // that could file the commander under Lands is a sweep that has taken the
  // one card the deck is built around.
  const tab = loadTab([CMD, ...DECK], { commander: 'Atraxa' });
  tab.run('dbSelectAllVisible()');
  const picked = tab.answer('[...dbSelectedCards]');
  assert.ok(!picked.includes('commander/Atraxa'), 'a bulk move would have moved the commander');
  assert.ok(picked.includes('main/Sol Ring'), 'and it stopped picking up the deck');
});

test('sorting and grouping the mainboard never see it', () => {
  const tab = loadTab([CMD, ...DECK], { commander: 'Atraxa' });
  tab.run(`dbSelectCategory('Creatures')`);
  assert.deepStrictEqual(tab.answer('[...dbSelectedCards]'), [],
    'the commander was selected by the category it is filed under');
  const html = tab.paint();
  const deck = html.slice(html.indexOf('data-cat='));
  assert.ok(!deck.includes('commander/Atraxa'), 'the commander was drawn into a pile of the deck');
});

test('a category called Commander is now an ordinary category', () => {
  // It was the one that could not be renamed or deleted, because the deck kept
  // its commander in it.
  const tab = loadTab([{ card_name: 'Sol Ring', category: 'Commander' }], { cats: ['Commander'] });
  tab.run(`dbDeleteCategory('Commander')`);
  assert.deepStrictEqual(tab.answer('dbCats.map(c => c.name)'), ['Uncategorised']);
});

// ── Showing it and hiding it ──────────────────────────────────────────

test('a deck with a commander shows the board without being asked', () => {
  const tab = loadTab([CMD, ...DECK], { commander: 'Atraxa' });
  assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), ['commander']);
  const html = tab.paint();
  const region = boardRegion(html, 'commander');
  assert.ok(!region.includes('db-board-off'), 'the commander is on the mat but hidden');
});

test('a deck with no commander shows no commander board', () => {
  const tab = loadTab(DECK);
  assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), []);
  const html = tab.paint();
  const region = boardRegion(html, 'commander');
  assert.ok(region.includes('db-board-off'),
    'a deck that never had a commander was given a region for one');
  assert.ok(region.includes('data-drop="commander"'),
    'and there is no way to make one, because the region cannot be dropped on');
});

test('the commander board hides from the toolbar, and stays hidden', () => {
  const tab = loadTab([CMD, ...DECK], { commander: 'Atraxa' });
  tab.run(`dbToggleBoard('commander')`);
  assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), []);
  // What is stored is what differs from the default, which is the only way a
  // board that is on by default can be remembered as off.
  assert.deepStrictEqual(JSON.parse(tab.store.get('mtgtools_boards')), { d1: ['commander'] });
  tab.run(`_dbLoadShownBoards('d1')`);
  assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), [], 'it came back the moment the deck was reopened');
});

test('and a maybeboard is still off until it is asked for, stored the same way', () => {
  const tab = loadTab(DECK);
  tab.run(`dbToggleBoard('maybe')`);
  assert.deepStrictEqual(JSON.parse(tab.store.get('mtgtools_boards')), { d1: ['maybe'] });
  tab.run(`_dbLoadShownBoards('d1')`);
  assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), ['maybe'],
    'an entry written before this ticket stopped meaning "on"');
});

test('a commander dropped onto a hidden board brings the board with it', () => {
  // Otherwise the card goes out of the hand and nowhere: the region it landed
  // in was only visible because something was being carried.
  const tab = loadTab(DECK);
  tab.run(`cardCarryDrop(['main/Doom Blade'], 'commander')`);
  assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), ['commander']);
  assert.deepStrictEqual(JSON.parse(tab.store.get('mtgtools_boards') || '{}'), {},
    'showing a board that is showing by default was stored as a deviation from it');
});

test('a board switched on by hand and then filled is not read back as hidden', () => {
  // The default flips under the stored preference the moment a card lands, so
  // the preference is rewritten with it.
  const tab = loadTab(DECK);
  tab.run(`dbToggleBoard('commander')`);
  assert.deepStrictEqual(JSON.parse(tab.store.get('mtgtools_boards')), { d1: ['commander'] });
  tab.run(`cardCarryDrop(['main/Doom Blade'], 'commander')`);
  tab.run(`_dbLoadShownBoards('d1')`);
  assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), ['commander']);
});

test('the toggle is on the strip with the rest of the boards', () => {
  const tab = loadTab([CMD, ...DECK], { commander: 'Atraxa' });
  const html = tab.el('dbBoardMount').innerHTML;
  assert.ok(html.includes('Commander'), 'there is no way to hide the commander board');
  assert.ok(html.includes(`dbToggleBoard('commander')`));
  assert.ok(html.includes('aria-pressed="true"'), 'the button does not say it is showing');
});

// ── The frame ─────────────────────────────────────────────────────────

test('the head of the deck is not drawn as a holding area beside it', () => {
  const CSS = read('public/css/tabs.css');
  assert.match(CSS, /\.db-board-head > \.db-board-hdr \{[^}]*border-bottom-style:\s*solid/,
    'the commander’s heading is dashed, which is how a board says it is not in the deck');
});
