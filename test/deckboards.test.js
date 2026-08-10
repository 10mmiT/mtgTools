/* Boards: a maybeboard and a sideboard on the mat.
 *
 * Somewhere to put a card that is not in the deck — and the whole of what that
 * costs is that a card's identity in a deck stops being its name. So what is
 * asserted here is mostly about *two* Sol Rings: that the deck can hold one in
 * the mainboard and one beside it, that touching either never touches the
 * other, and that every number the tab prints about the deck goes on counting
 * only the deck.
 *
 * Three layers, all against the shipped files:
 *
 *   the migration   a database made before boards, opened by available-db.js
 *   the mat         the deck-builder modules in a vm sandbox, as
 *                   test/carddrag.test.js and test/deckframe.test.js run them
 *   the frame       the stylesheet and the markup, read as text where what
 *                   matters is a rule that must exist
 *
 * What is not asserted is what a maybeboard looks like. That is the eye's.
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
// A database written before boards existed, opened by the module that owns the
// schema. Every card in it is a card in a deck, so every card in it is in the
// mainboard — and the key it is stored under has to have widened, or the
// second Sol Ring below could never be written at all.

/** A database in the old shape, with a deck in it, at a path of its own. */
function legacyDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgboards-'));
  const Database = require('better-sqlite3');
  const db = new Database(path.join(dir, 'available.db'));
  db.exec(`
    CREATE TABLE deck_cards (
      deck_id   TEXT NOT NULL,
      card_name TEXT NOT NULL,
      qty       INTEGER NOT NULL DEFAULT 1,
      category  TEXT NOT NULL DEFAULT '',
      position  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (deck_id, card_name)
    );
    INSERT INTO deck_cards (deck_id, card_name, qty, category, position)
      VALUES ('d1', 'Sol Ring', 1, 'Ramp', 0), ('d1', 'Forest', 4, 'Lands', 1);
  `);
  db.close();
  return dir;
}

/* One process, one available-db: the module binds to DATA_FILE as it loads, so
 * the old database is put in place first and opened by requiring it. Every
 * assertion about the migration therefore runs against the real one rather
 * than against a copy of its SQL. */
const legacyDir = legacyDb();
process.env.DATA_FILE = path.join(legacyDir, 'state.json');
const { db } = require('../available-db');

test('a deck written before boards comes back with every card in the mainboard', () => {
  const cards = db.prepare('SELECT card_name, qty, category, board FROM deck_cards ORDER BY position').all();
  assert.deepStrictEqual(cards, [
    { card_name: 'Sol Ring', qty: 1, category: 'Ramp',  board: 'main' },
    { card_name: 'Forest',   qty: 4, category: 'Lands', board: 'main' },
  ], 'the migration moved a card, or lost one');
});

test('and the key widened, so the same card can be in two boards', () => {
  db.prepare('INSERT INTO deck_cards (deck_id, card_name, qty, category, board, position) VALUES (?,?,?,?,?,?)')
    .run('d1', 'Sol Ring', 3, 'Ramp', 'maybe', 2);
  const rows = db.prepare("SELECT board, qty FROM deck_cards WHERE card_name = 'Sol Ring' ORDER BY board").all();
  assert.deepStrictEqual(rows, [{ board: 'main', qty: 1 }, { board: 'maybe', qty: 3 }],
    'the second copy collided with the first');
});

test('a board nobody has heard of yet needs no schema change', () => {
  // The set of boards is open on purpose: TEXT and no CHECK, so a format that
  // wants another one later costs a value in DB_BOARDS and nothing here.
  db.prepare('INSERT INTO deck_cards (deck_id, card_name, qty, category, board, position) VALUES (?,?,?,?,?,?)')
    .run('d1', 'Island', 1, 'Lands', 'considering', 3);
  assert.strictEqual(
    db.prepare("SELECT board FROM deck_cards WHERE card_name = 'Island'").get().board, 'considering');
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'deck_cards'").get().sql;
  assert.ok(!/CHECK/i.test(sql), 'the boards were nailed down in the schema');
});

test('running the migration again changes nothing', () => {
  // It is guarded by the column rather than by a version number, so opening a
  // database that already has one has to be a no-op.
  const before = db.prepare('SELECT COUNT(*) AS n FROM deck_cards').get().n;
  delete require.cache[require.resolve('../available-db')];
  const { db: again } = require('../available-db');
  assert.strictEqual(again.prepare('SELECT COUNT(*) AS n FROM deck_cards').get().n, before);
});

// ── The mat ───────────────────────────────────────────────────────────────
// The deck-builder modules over a deck, with the network and the drawing
// surface stubbed. State is seeded by assignment rather than through the
// sandbox, because js/deckview-core.js declares the deck with `let` and a
// property of the same name would be shadowed by it — so what these tests
// hold is the tab's own state, in the tab's own bindings.

/** The tab, loaded whole: the boards, the deck, the render, the edits and the
 *  answers the carry asks for. */
function loadTab(cards, cats = ['Ramp', 'Lands'], shown = [], stored = {}) {
  /* Seeded before the modules load, because the preference store is read as
   * js/sortui.js loads: what a stored entry does has to be asserted through
   * the reading of it. */
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
      /* The mat freezes the page's scroll across a rebuild, so a render needs
       * somewhere to read it from and put it back. */
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
    // main.js's escapers and the card-shaped helpers the mat draws through.
    // What each of them produces is asserted where it lives.
    esc: s => String(s),
    jsAttr: s => String(s),
    renderMana: () => '', renderPrice: () => '', sfCardOwnership: () => '',
    /* What js/deckview-owned.js reaches outside the tab for: the collections,
       whose each of them is, and who you are. None of these decks is owned by
       anybody here — that is test/deckowned.test.js's subject — so the shelf is
       empty, nothing is owned, and the ownership chip is off. */
    state: { collections: [], players: [] },
    myPlayerId: () => null, colOwner: () => null, playerColor: () => '',
    /* What js/sortui.js sorts by beyond the card itself — prices and the like,
     * which these decks have none of. */
    scryfallMetaCache: new Map(),
    openCardByName() {},
    /* js/cardmove.js measures the mat around a render; what is wanted here is
     * the render. */
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

  run(`dbDeck = { id: 'd1', playerId: 'p1', name: 'A deck', commander: '' }`);
  run(`dbCards = ${JSON.stringify(cards.map((c, i) => ({ qty: 1, board: 'main', position: i, ...c })))}`);
  run(`dbCats = ${JSON.stringify(cats.map((name, i) => ({ name, position: i })))}`);
  run(`dbShownBoards = new Set(${JSON.stringify(shown)})`);
  /* Type data for the cards these decks are made of, so that the curve and the
   * land count have something to read. */
  run(`dbCardData = new Map(${JSON.stringify([
    ['Sol Ring',   { name: 'Sol Ring',   type_line: 'Artifact', cmc: 1, color_identity: [] }],
    ['Doom Blade', { name: 'Doom Blade', type_line: 'Instant',  cmc: 2, color_identity: ['B'] }],
    ['Forest',     { name: 'Forest',     type_line: 'Basic Land — Forest', cmc: 0, color_identity: ['G'] }],
  ])})`);

  return {
    run, answer, mat, store, el,
    ref:   (board, name) => run(`dbPlace(${JSON.stringify(board)}, ${JSON.stringify(name)})`),
    cards: () => answer('dbCards').map(c => `${c.board}/${c.card_name}×${c.qty}:${c.category}`).sort(),
    at:    (board, name) => answer(`dbFindCard(dbPlace(${JSON.stringify(board)}, ${JSON.stringify(name)})) || null`),
    paint: () => { run('dbRender()'); return mat.innerHTML; },
    saves: () => sandbox.saves,
    calls: () => sandbox.calls,
  };
}

const DECK = [
  { card_name: 'Sol Ring',   category: 'Ramp' },
  { card_name: 'Doom Blade', category: 'Removal' },
  { card_name: 'Forest',     category: 'Lands', qty: 4 },
];

// ── Where a card is, and where it is going ────────────────────────────

test('a place is a board, or a pile on one, and the two cannot be confused', () => {
  // The whole grammar. It splits at the first slash because a card name has
  // slashes in it — "Fire // Ice" — and a category may have too.
  const tab = loadTab(DECK);
  assert.strictEqual(tab.ref('main', 'Lands'), 'main/Lands');
  assert.deepStrictEqual(tab.answer(`dbReadPlace('main/Lands')`), { board: 'main', category: 'Lands' });
  assert.deepStrictEqual(tab.answer(`dbReadPlace('maybe')`), { board: 'maybe', category: null },
    'a place with no slash in it is a whole board');
  assert.deepStrictEqual(tab.answer(`dbReadRef('main/Fire // Ice')`), { board: 'main', name: 'Fire // Ice' },
    'a split card lost half its name');
  assert.deepStrictEqual(tab.answer(`dbReadPlace('main/Odd/Name')`), { board: 'main', category: 'Odd/Name' },
    'a category with a slash in it was cut in two');
});

test('a card with no board on it is a card in the deck', () => {
  const tab = loadTab(DECK);
  tab.run(`dbCards = [{ card_name: 'Sol Ring', qty: 1, category: 'Ramp', position: 0 }]`);
  assert.strictEqual(tab.answer(`dbCardRef(dbCards[0])`), 'main/Sol Ring');
  assert.strictEqual(tab.answer('dbMainCards().length'), 1);
});

// ── Carrying a card into a board, and back ────────────────────────────

test('a card carried onto the maybeboard goes there and stops being in the deck', () => {
  const tab = loadTab(DECK);
  assert.strictEqual(tab.run(`cardCarryDrop(['main/Sol Ring'], 'maybe')`), true);
  assert.strictEqual(tab.at('main', 'Sol Ring'), null, 'the card is still in the deck');
  assert.strictEqual(tab.at('maybe', 'Sol Ring').category, 'Ramp',
    'and it dropped the category it was filed under on the way');
  assert.strictEqual(tab.saves(), 1, 'the deck was not saved, so the card is not there after a reload');
});

test('and carried back onto the mainboard it lands in the category it was carrying', () => {
  // The whole reason the category rides along while a card sits in a board:
  // promoting one puts it back where it belongs rather than in "Other".
  const tab = loadTab(DECK);
  tab.run(`cardCarryDrop(['main/Sol Ring'], 'maybe')`);
  assert.strictEqual(tab.run(`cardCarryDrop(['maybe/Sol Ring'], 'main')`), true);
  assert.strictEqual(tab.at('main', 'Sol Ring').category, 'Ramp');
});

test('a card promoted while its pile is gone brings the pile back with it', () => {
  // It has been lying in a board while the mat moved on. Arriving under a
  // category the deck does not draw would be a card that has gone missing.
  const tab = loadTab(DECK);
  tab.run(`cardCarryDrop(['main/Sol Ring'], 'maybe')`);
  tab.run(`dbCats = dbCats.filter(c => c.name !== 'Ramp')`);
  tab.run(`cardCarryDrop(['maybe/Sol Ring'], 'main')`);
  assert.ok(tab.answer('dbCats.map(c => c.name)').includes('Ramp'));
});

test('a card dropped on a pile of the deck is promoted into that pile', () => {
  const tab = loadTab(DECK);
  tab.run(`cardCarryDrop(['main/Sol Ring'], 'maybe')`);
  assert.strictEqual(tab.run(`cardCarryDrop(['maybe/Sol Ring'], 'main/Lands')`), true);
  assert.strictEqual(tab.at('main', 'Sol Ring').category, 'Lands');
});

test('a card dropped on the board it is already lying in does nothing at all', () => {
  const tab = loadTab(DECK);
  tab.run(`cardCarryDrop(['main/Sol Ring'], 'maybe')`);
  const before = tab.saves();
  assert.strictEqual(tab.run(`cardCarryDrop(['maybe/Sol Ring'], 'maybe')`), false);
  assert.strictEqual(tab.saves(), before, 'a drop that changed nothing saved the deck');
});

// ── Two of the same card ──────────────────────────────────────────────

test('the same card sits in the maybeboard and the deck at once, with its own quantity', () => {
  const tab = loadTab(DECK);
  tab.run(`dbCards.push({ card_name: 'Sol Ring', qty: 3, category: 'Ramp', board: 'maybe', position: 9 })`);
  tab.run(`dbChangeQty('maybe/Sol Ring', 1)`);
  assert.strictEqual(tab.at('main',  'Sol Ring').qty, 1, 'the copy in the deck went up too');
  assert.strictEqual(tab.at('maybe', 'Sol Ring').qty, 4);
});

test('removing one copy of it leaves the other standing', () => {
  const tab = loadTab(DECK);
  tab.run(`dbCards.push({ card_name: 'Sol Ring', qty: 3, category: 'Ramp', board: 'maybe', position: 9 })`);
  tab.run(`dbRemoveCard('maybe/Sol Ring')`);
  assert.ok(tab.at('main', 'Sol Ring'), 'removing a maybe removed the card from the deck');
  assert.strictEqual(tab.at('maybe', 'Sol Ring'), null);
});

test('adding a card by name adds it to the deck, not to whatever is set aside', () => {
  const tab = loadTab([]);
  tab.run(`dbCards = [{ card_name: 'Sol Ring', qty: 1, category: 'Ramp', board: 'maybe', position: 0 }]`);
  tab.run(`dbAddCard('Sol Ring')`);
  assert.strictEqual(tab.at('maybe', 'Sol Ring').qty, 1, 'the card in the maybeboard went up');
  assert.strictEqual(tab.at('main', 'Sol Ring').qty, 1);
});

test('a card carried onto a board holding a copy of it is spent into that copy', () => {
  // Two rows of the same card on one board is a deck claiming to hold it
  // twice, which is the one thing the key will not allow. So the row that
  // arrives is added to the row that was there.
  const tab = loadTab(DECK);
  tab.run(`dbCards.push({ card_name: 'Sol Ring', qty: 2, category: 'Ramp', board: 'maybe', position: 9 })`);
  assert.strictEqual(tab.run(`cardCarryDrop(['main/Sol Ring'], 'maybe')`), true);
  assert.strictEqual(tab.at('maybe', 'Sol Ring').qty, 3, 'three copies, in one row');
  assert.strictEqual(tab.at('main', 'Sol Ring'), null);
  assert.strictEqual(tab.answer(`dbCards.filter(c => c.card_name === 'Sol Ring').length`), 1);
});

test('and a card promoted onto a pile holding a copy of it takes that pile', () => {
  const tab = loadTab(DECK);
  tab.run(`dbCards.push({ card_name: 'Sol Ring', qty: 1, category: 'Ramp', board: 'maybe', position: 9 })`);
  tab.run(`cardCarryDrop(['maybe/Sol Ring'], 'main/Lands')`);
  assert.strictEqual(tab.at('main', 'Sol Ring').qty, 2);
  assert.strictEqual(tab.at('main', 'Sol Ring').category, 'Lands');
});

// ── What the deck says about itself ───────────────────────────────────

test('the count, the lands, the curve and the average mana value are the deck’s alone', () => {
  const tab = loadTab(DECK);
  tab.run('dbRenderStats()');
  const deck = {
    cards:  tab.el('dbStatCards').innerHTML,
    lands:  tab.el('dbStatLands').innerHTML,
    cmc:    tab.el('dbStatCmc').innerHTML,
    curve:  tab.el('dbCurve').innerHTML,
    colors: tab.el('dbStatColors').innerHTML,
  };
  // The same deck, with a maybeboard beside it that would move every one of
  // those numbers if it counted.
  tab.run(`dbCards.push({ card_name: 'Forest', qty: 7, category: 'Lands', board: 'maybe', position: 9 })`);
  tab.run(`dbCards.push({ card_name: 'Doom Blade', qty: 2, category: 'Removal', board: 'side', position: 10 })`);
  tab.run('dbRenderStats()');
  assert.strictEqual(tab.el('dbStatCards').innerHTML, deck.cards, 'the count read the maybeboard');
  assert.strictEqual(tab.el('dbStatLands').innerHTML, deck.lands);
  assert.strictEqual(tab.el('dbStatCmc').innerHTML,   deck.cmc);
  assert.strictEqual(tab.el('dbCurve').innerHTML,     deck.curve);
  assert.strictEqual(tab.el('dbStatColors').innerHTML, deck.colors);
  assert.match(deck.cards, /6\/60/, 'six cards in the deck, and it is not a Commander deck');
});

test('the export is the deck, and nothing that is only being considered', () => {
  const tab = loadTab(DECK);
  tab.run(`dbCards.push({ card_name: 'Black Lotus', qty: 1, category: 'Ramp', board: 'maybe', position: 9 })`);
  const text = tab.run('_dbExportText()');
  assert.ok(text.includes('Sol Ring'));
  assert.ok(!text.includes('Black Lotus'), 'a card that is not in the deck was exported as though it were');
});

// ── The regions on the mat ────────────────────────────────────────────

test('a board draws as one flat region with a count, and no category headers', () => {
  const tab = loadTab(DECK, ['Ramp', 'Lands'], ['maybe']);
  tab.run(`dbCards.push({ card_name: 'Black Lotus', qty: 2, category: 'Ramp', board: 'maybe', position: 9 })`);
  tab.run(`dbCards.push({ card_name: 'Island', qty: 1, category: 'Lands', board: 'maybe', position: 10 })`);
  const html = tab.paint();
  const region = html.split('<div class="dv-section db-board').find(part => part.includes('data-board="maybe"'));
  assert.ok(region, 'there is no maybeboard on the mat');
  assert.ok(region.includes('Maybeboard'), 'the region does not say which board it is');
  assert.match(region, /dv-section-count">3</, 'three cards, counted as copies rather than rows');
  assert.ok(!/data-cat=/.test(region), 'the board grew categories of its own');
  assert.strictEqual((region.match(/dv-section-hdr/g) || []).length, 1,
    'a holding area with more than one heading in it is a second deck');
});

test('a board is a place cards can be put down, and the place is the board', () => {
  const tab = loadTab(DECK, ['Ramp', 'Lands'], ['maybe']);
  const html = tab.paint();
  assert.ok(html.includes('data-drop="maybe"'), 'nothing can be dropped on the maybeboard');
  assert.ok(html.includes('data-drop="main/Ramp"'), 'a pile no longer says which board it is on');
});

test('a card on the mat is named by its board as well as its name', () => {
  // Two rows of the same card are two things on the mat: what is carried,
  // clicked and animated has to be able to tell them apart.
  const tab = loadTab(DECK, ['Ramp', 'Lands'], ['maybe']);
  tab.run(`dbCards.push({ card_name: 'Sol Ring', qty: 1, category: 'Ramp', board: 'maybe', position: 9 })`);
  const html = tab.paint();
  assert.ok(html.includes('data-carry="main/Sol Ring"'));
  assert.ok(html.includes('data-carry="maybe/Sol Ring"'));
  assert.ok(html.includes('data-moves="card:maybe/Sol Ring"'));
});

test('a board that is off is still drawn, so that it can appear while a card is carried', () => {
  const tab = loadTab(DECK);
  const html = tab.paint();
  assert.ok(html.includes('db-board-off'), 'a board switched off is not on the mat at all');
  assert.ok(html.includes('data-drop="maybe"'),
    'and there is nothing to reveal, so a hidden board is a place you cannot put anything');
});

test('a board that is on is drawn without the class that hides it', () => {
  const tab = loadTab(DECK, ['Ramp', 'Lands'], ['maybe']);
  const html = tab.paint();
  /* This one board's opening tag, and not everything from the first board on
     the mat up to it: the commander board is drawn at the *head* now, and it
     is switched off in this deck. */
  const region = html.match(/<div class="dv-section db-board[^>]*data-board="maybe"/);
  assert.ok(region && !region[0].includes('db-board-off'));
});

test('selecting everything visible leaves a board nobody has switched on out of it', () => {
  const tab = loadTab(DECK);
  tab.run(`dbCards.push({ card_name: 'Black Lotus', qty: 1, category: 'Ramp', board: 'maybe', position: 9 })`);
  tab.run('dbSelectAllVisible()');
  assert.ok(!tab.answer('[...dbSelectedCards]').includes('maybe/Black Lotus'),
    'a bulk move would have taken a card nobody could see with it');
  tab.run(`dbShownBoards.add('maybe')`);
  tab.run('dbSelectAllVisible()');
  assert.ok(tab.answer('[...dbSelectedCards]').includes('maybe/Black Lotus'));
});

// ── Showing a board ───────────────────────────────────────────────────

test('boards are off until they are asked for, and the asking is per deck', () => {
  const tab = loadTab(DECK);
  tab.run(`_dbLoadShownBoards('d1')`);
  assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), [], 'a deck arrived with a board switched on');

  tab.run(`dbToggleBoard('maybe')`);
  assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), ['maybe']);
  tab.run(`_dbLoadShownBoards('d2')`);
  assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), [],
    'one deck’s boards were taken for another’s');
  tab.run(`_dbLoadShownBoards('d1')`);
  assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), ['maybe'], 'and this one forgot its own');
});

test('a board switched on is remembered as the press happens', () => {
  // Not on the way out: a browser closed a moment later comes back showing
  // the same boards, which is the same rule the fold is stored by.
  const tab = loadTab(DECK);
  tab.run(`dbToggleBoard('side')`);
  assert.deepStrictEqual(JSON.parse(tab.store.get('mtgtools_boards')), { d1: ['side'] });
  tab.run(`dbToggleBoard('side')`);
  assert.deepStrictEqual(JSON.parse(tab.store.get('mtgtools_boards')), {},
    'a deck showing nothing but its deck is worth no entry at all');
});

test('a stored board that is not a board is no board at all', () => {
  // localStorage is a string store shared with older versions of this app and
  // with whatever anyone types into a console.
  for (const junk of ['"maybe"', '7', '{"a":1}', 'null']) {
    const tab = loadTab(DECK, ['Ramp'], [], { mtgtools_boards: `{"d1":${junk}}` });
    tab.run(`_dbLoadShownBoards('d1')`);
    assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), [], `${junk} was taken for a board`);
  }
  for (const junk of ['[]', 'null', '{', 'undefined']) {
    const tab = loadTab(DECK, ['Ramp'], [], { mtgtools_boards: junk });
    tab.run(`_dbLoadShownBoards('d1')`);
    assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), [], `${junk} took the whole file down`);
  }
  const tab = loadTab(DECK, ['Ramp'], [], { mtgtools_boards: '{"d1":["maybe","the moon"]}' });
  tab.run(`_dbLoadShownBoards('d1')`);
  assert.deepStrictEqual(tab.answer('[...dbShownBoards]'), ['maybe'],
    'a board this app does not have was drawn anyway');
});

test('the toggles are written from the list of boards, and the deck has none', () => {
  const tab = loadTab(DECK);
  tab.run(`_dbLoadShownBoards('d1')`);
  const html = tab.el('dbBoardMount').innerHTML;
  assert.ok(html.includes('Maybeboard') && html.includes('Sideboard'));
  assert.ok(!html.includes('Mainboard'), 'the deck itself can be switched off');
  assert.ok(html.includes('aria-pressed="false"'), 'the button does not say it is a state');
  tab.run(`dbToggleBoard('maybe')`);
  assert.ok(tab.el('dbBoardMount').innerHTML.includes('aria-pressed="true"'));
});

// ── The Move to… list, which is the phone’s way into a board ──────────

test('the Move to… list offers the boards as well as the piles', () => {
  // A finger never picks a card up — the mat is scrolled with it — so this
  // list is the only way into a board on a phone.
  const tab = loadTab(DECK);
  tab.run(`dbShowMoveCard('main/Sol Ring')`);
  const html = tab.el('dbMoveCatList').innerHTML;
  assert.ok(html.includes(`dbConfirmMoveCard('maybe')`), 'there is no way to reach the maybeboard');
  assert.ok(html.includes(`dbConfirmMoveCard('main')`), 'nor any way back into the deck');
  assert.ok(html.includes(`dbConfirmMoveCard('main/Lands')`), 'and a pile is no longer a place');
});

test('and moving a card through it puts it on the board it names', () => {
  const tab = loadTab(DECK);
  tab.run(`dbShowMoveCard('main/Sol Ring')`);
  tab.run(`dbConfirmMoveCard('side')`);
  assert.strictEqual(tab.at('side', 'Sol Ring').category, 'Ramp');
});

// ── What is saved, and what comes back ────────────────────────────────

test('the board goes to the server with the card, so it is still there after a reload', async () => {
  const tab = loadTab(DECK);
  tab.run(`cardCarryDrop(['main/Sol Ring'], 'maybe')`);
  await tab.run('_dbSaveNow()');
  const save = tab.calls().find(c => c.method === 'PUT');
  assert.ok(save, 'nothing was saved');
  const sent = save.body.cards.find(c => c.card_name === 'Sol Ring');
  assert.strictEqual(sent.board, 'maybe');
  assert.strictEqual(sent.category, 'Ramp', 'and it kept the pile it will go back to');
});

test('a restored deck comes back with its boards', () => {
  const tab = loadTab(DECK);
  tab.run(`_dbApplyRestored(
    [{ card_name: 'Sol Ring', qty: 1, category: 'Ramp', board: 'maybe' },
     { card_name: 'Forest', qty: 1, category: 'Lands' }],
    [{ name: 'Ramp', position: 0 }, { name: 'Lands', position: 1 }])`);
  assert.deepStrictEqual(tab.cards(), ['main/Forest×1:Lands', 'maybe/Sol Ring×1:Ramp']);
});

// ── The frame ─────────────────────────────────────────────────────────

test('a hidden board comes back for as long as a card is in hand', () => {
  const CSS = read('public/css/tabs.css');
  assert.match(CSS, /\.db-board-off \{[^}]*display:\s*none/,
    'a board that is off is not hidden at all');
  assert.match(CSS, /\.card-carrying \.db-board-off \{[^}]*display:\s*block/,
    'a board you switched off is a place you cannot put anything');
});

test('the mat is measured as it will be while a card is carried, not as it was', () => {
  // The reveal is a stylesheet rule off .card-carrying, so the class has to be
  // on the page *before* the zones are measured — a board measured while it
  // was still hidden is a box of no size that nothing can be dropped on.
  const drag = read('public/js/carddrag.js');
  const begin = drag.match(/function beginCarry\([\s\S]*?\n\}/)[0];
  assert.ok(begin.indexOf("classList.add('card-carrying')") < begin.indexOf('cardCarryZones()'),
    'the zones are measured before the mat is told a card is in hand');
});

test('the toggles are in the menu, and fold away with the rest of the controls', () => {
  /* Not on the mat: they are controls. They were on the strip until the strip
     had fourteen things on it; they are in the column beside the mat now, which
     the frame hides on the same first press for the same reason — it is that
     column that is "the controls" these days. */
  const markup = read('public/index.html');
  const menu   = markup.match(/<aside id="dbMenu"[\s\S]*?<\/aside>/)[0];
  assert.ok(menu.includes('id="dbBoardMount"'), 'the board toggles are not in the deck menu');
  assert.ok(!markup.includes('db-board-toggle"'),
    'the toggles are written by the tab from DB_BOARDS, not spelled out in the markup');

  const css = read('public/css/tabs.css');
  assert.match(css, /:not\(\[data-db-fold="full"\]\) \.db-menu\s*\{/,
    'the menu holding them does not fold away with the controls');
});

test('a board region is on the mat, where a drop target has to be', () => {
  const render = read('public/js/deckview-render.js');
  assert.match(render, /function _dbRenderBoard\([\s\S]*?data-drop="\$\{esc\(dbPlace\(board\.id, null\)\)\}"/,
    'a board is not somewhere cards can be put');
  assert.match(render, /_dbContent\.innerHTML = \w+ \+ head[\s\S]*?\+ beside;/,
    'the boards are not drawn onto the mat');
});

// ── Adding a card somewhere other than the deck ───────────────────────────
// The drawer's Search and EDHREC halves both hand back a grid with a + on
// every card, and what the + meant was the deck and only the deck — so a card
// you were merely considering had to go into the ninety-nine and be dragged
// back out, which is the deck being broken on the way to not breaking it.

test('the boards a card can be added to are the boards, less the head of the deck', () => {
  // A rule about the flag rather than a list of ids: the commander is chosen
  // from the mat, by ♛ Make commander on a card in front of you, and offering
  // it here would be a second answer to a question already answered better.
  const tab = loadTab(DECK);
  assert.deepStrictEqual(tab.answer('dbAddBoards().map(b => b.id)'), ['main', 'maybe', 'side']);
});

test('a card added to the maybeboard goes to the maybeboard, and not into the deck', async () => {
  // The deck already runs a Doom Blade, which is the case worth asserting: the
  // copy being considered is a row of its own and the deck's is untouched.
  const tab = loadTab(DECK);
  await tab.run(`dbAddCard('Doom Blade', 'maybe')`);
  assert.strictEqual(tab.at('maybe', 'Doom Blade')?.qty, 1);
  assert.strictEqual(tab.at('main', 'Doom Blade')?.qty, 1,
    'the deck’s own copy went up, or moved');
});

test('and the board it landed in is on the mat, because nothing else said where it went', () => {
  /* A card added by name has none of what a card put there by hand has — no
     carry, no board lighting up to receive it — so a maybeboard that stayed
     switched off would answer the press with a deck that looks unchanged. */
  const tab = loadTab(DECK, ['Ramp', 'Lands'], []);
  assert.ok(!tab.answer('[...dbShownBoards]').includes('maybe'), 'it was already showing');
  tab.run(`dbAddCard('Doom Blade', 'maybe')`);
  assert.ok(tab.answer('[...dbShownBoards]').includes('maybe'));
  assert.deepStrictEqual(JSON.parse(tab.store.get('mtgtools_boards')).d1, ['maybe'],
    'the deck did not remember that its maybeboard is open');
});

test('but carrying one onto a hidden board still leaves it hidden', () => {
  /* Deliberately not the same rule. A hidden board shows itself for as long as
     a card is in hand and goes back to hidden when you let go — that is what
     makes a board you switched off still somewhere you can put something, and
     it is a decision about carrying rather than about adding. */
  const tab = loadTab(DECK, ['Ramp', 'Lands'], []);
  tab.run(`dbMoveCardsTo(['main/Doom Blade'], 'maybe')`);
  assert.strictEqual(tab.at('maybe', 'Doom Blade')?.card_name, 'Doom Blade');
  assert.ok(!tab.answer('[...dbShownBoards]').includes('maybe'),
    'the drop path started switching boards on');
});

test('an asked-for board beats the guess about where a bare name belongs', async () => {
  // Adding your commander by name puts it where the commander goes — unless
  // you have said where. A guess does not overrule an instruction.
  const tab = loadTab(DECK);
  tab.run(`dbDeck.commander = 'Doom Blade'`);
  await tab.run(`dbAddCard('Doom Blade', 'maybe')`);
  assert.strictEqual(tab.at('maybe', 'Doom Blade')?.qty, 1);
  assert.strictEqual(tab.at('commander', 'Doom Blade'), null);
});

test('and with nothing asked for, the guess is the one it always was', async () => {
  // The toolbar's Add a card field passes no board, and must go on behaving
  // exactly as it did.
  const tab = loadTab(DECK);
  tab.run(`dbDeck.commander = 'Doom Blade'`);
  await tab.run(`dbAddCard('Doom Blade')`);
  assert.strictEqual(tab.at('commander', 'Doom Blade')?.qty, 1);
  await tab.run(`dbAddCard('Forest')`);
  assert.strictEqual(tab.at('main', 'Forest')?.qty, 5,
    'a plain add stopped going into the deck — the deck already ran four');
});

test('a board nothing answers to is the deck', async () => {
  const tab = loadTab(DECK);
  await tab.run(`dbAddCard('Doom Blade', 'nowhere')`);
  assert.strictEqual(tab.at('main', 'Doom Blade')?.qty, 2);
});

test('the same card in the deck and in the maybeboard is two rows with two quantities', async () => {
  // The whole of what a second copy is for, now reachable from the drawer.
  const tab = loadTab(DECK);
  await tab.run(`dbAddCard('Doom Blade', 'maybe')`);
  await tab.run(`dbAddCard('Doom Blade', 'maybe')`);
  assert.strictEqual(tab.at('maybe', 'Doom Blade')?.qty, 2);
  assert.strictEqual(tab.at('main', 'Doom Blade')?.qty, 1, 'the deck’s copy moved with it');
});

// ── Where the + puts things ───────────────────────────────────────────────

test('the drawer puts cards in the deck until it is told otherwise', () => {
  assert.strictEqual(loadTab(DECK).run('dbAddTo()'), 'main');
});

test('and remembers being told, because filling a maybeboard is an evening’s work', () => {
  const tab = loadTab(DECK);
  tab.run(`dbSetAddTo('side')`);
  assert.strictEqual(tab.store.get('mtgtools_db_add_to'), 'side');
  assert.strictEqual(tab.run('dbAddTo()'), 'side');
});

test('a stored destination that is not a board is the deck', () => {
  // localStorage's usual reason: a stored id nothing answers to must not
  // become a region of the mat nobody can reach.
  const tab = loadTab(DECK, ['Ramp'], [], { mtgtools_db_add_to: 'nowhere' });
  assert.strictEqual(tab.run('dbAddTo()'), 'main');
  const head = loadTab(DECK, ['Ramp'], [], { mtgtools_db_add_to: 'commander' });
  assert.strictEqual(head.run('dbAddTo()'), 'main',
    'the drawer offered to add straight to the commander board');
});

test('a card the deck already holds says so on its tile, and says where', async () => {
  /* Pressing + used to change nothing you could see, so a second press was the
     obvious thing to do and it silently made two copies. */
  const tab = loadTab(DECK);
  const tile = () => tab.run(`_dbDrawerTile('Sol Ring', { img: '', canAdd: true })`);
  assert.ok(tile().includes('✓'), 'a card already in the deck offers a bare +');

  tab.run(`dbSetAddTo('maybe')`);
  assert.ok(!tile().includes('✓'),
    'a card in the deck reads as already in the maybeboard');
  assert.ok(tile().includes('Deck'), 'the tile does not say where the deck has it');

  await tab.run(`dbAddCard('Sol Ring', 'maybe')`);
  assert.ok(tile().includes('✓'), 'adding it to the maybeboard did not show on the tile');
});

test('the + says what pressing it will do', () => {
  const tab = loadTab(DECK);
  tab.run(`dbSetAddTo('side')`);
  assert.ok(tab.run(`_dbDrawerTile('Doom Blade', { img: '', canAdd: true })`)
    .includes('Add to Sideboard'));
});

test('somebody else’s deck gets no + at all', () => {
  const tab = loadTab(DECK);
  assert.ok(!tab.run(`_dbDrawerTile('Doom Blade', { img: '', canAdd: false })`)
    .includes('dbAddFromDrawer'));
});
