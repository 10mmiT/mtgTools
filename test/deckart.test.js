/* Which picture a deck card shows.
 *
 * The mat draws a card three times over — as a tile in a grid, as a card in a
 * spread pile, and as the face of a pile that has settled into a stack — and
 * each of them used to work the picture out for itself from the by-name oracle
 * cache. Soon a card will be able to carry a printing of its own, and that
 * printing's art has to win everywhere the card is drawn, which it cannot do
 * while there are three answers to the question.
 *
 * So there is one: a helper that is handed the deck's card and hands back the
 * picture. What is asserted here is that all three views go through it and that
 * all three hand it the card rather than the card's name — because a helper the
 * grid does not call, or one the pile calls with a string, is exactly how a
 * chosen printing would come to show in two views out of three.
 *
 * The list row is the fourth way the mat draws a card and it draws no picture
 * at all: its artwork is the app-wide hover preview, which is keyed by name and
 * shared with Collections, Wants and the Set Browser. That is asserted too, so
 * that the row's not being here is a recorded fact rather than an oversight.
 *
 * Against the shipped files, in the vm sandbox test/deckboards.test.js runs the
 * mat in.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const SOL_RING_ART = 'https://cards.scryfall.io/normal/sol-ring.jpg';
const DELVER_ART   = 'https://cards.scryfall.io/normal/delver.jpg';
const VALAKUT_FRONT = 'https://cards.scryfall.io/normal/valakut-awakening.jpg';
const VALAKUT_BACK  = 'https://cards.scryfall.io/normal/valakut-stoneforge.jpg';

/* The oracle cache as the tab holds it: one entry per name. Sol Ring has its
 * picture on the card, Delver of Secrets has it on its first face — the two
 * shapes Scryfall answers in — and Doom Blade has none at all, which is what a
 * card whose data has not arrived looks like. */
const ORACLE = [
  ['Sol Ring', { name: 'Sol Ring', type_line: 'Artifact', cmc: 1, color_identity: [],
                 image_uris: { normal: SOL_RING_ART } }],
  ['Delver of Secrets', { name: 'Delver of Secrets', type_line: 'Creature — Human Wizard',
                          cmc: 1, color_identity: ['U'],
                          card_faces: [{ name: 'Delver of Secrets',
                                         image_uris: { normal: DELVER_ART } }] }],
  ['Doom Blade', { name: 'Doom Blade', type_line: 'Instant', cmc: 2, color_identity: ['B'] }],
  /* Two pictures and one piece of cardboard — the shape Delver above is not,
     since a face with no picture of its own is not a side you can be shown. */
  ['Valakut Awakening', { name: 'Valakut Awakening // Valakut Stoneforge',
                          type_line: 'Instant // Land', cmc: 3, color_identity: ['R'],
                          card_faces: [{ name: 'Valakut Awakening',
                                         image_uris: { normal: VALAKUT_FRONT } },
                                       { name: 'Valakut Stoneforge',
                                         image_uris: { normal: VALAKUT_BACK } }] }],
];

/** The tab over a deck, with the network and the drawing surface stubbed. */
function loadTab(cards, cats = ['Ramp']) {
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
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    /* main.js's escapers and the card-shaped helpers the mat draws through.
       What each of them produces is asserted where it lives. */
    esc: s => String(s),
    jsAttr: s => String(s),
    renderMana: () => '', renderPrice: () => '', sfCardOwnership: () => '',
    state: { collections: [], players: [] },
    myPlayerId: () => null, colOwner: () => null, playerColor: () => '',
    scryfallMetaCache: new Map(),
    openCardByName() {},
    animateCardMove: (_el, paint) => paint(),
  };
  sandbox.setTimeout = fn => 1;
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  /* scryfall.js and cardturn.js for real, not stubbed: "has this card a back"
     and "what does a card wearing its turn control look like" are answered
     once for the whole app, and a mat that agreed with a stub here while
     disagreeing with them is exactly the failure worth catching. */
  for (const file of ['scryfall.js', 'cardturn.js', 'sortui.js', 'cardstack.js', 'deckview-boards.js',
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
  run(`dbShownBoards = new Set()`);
  run(`dbCardData = new Map(${JSON.stringify(ORACLE)})`);

  return {
    run, answer,
    /** The mat in one of its three views, drawn. A category named to `settled`
     *  is one that has been tidied back into a stack. */
    paint: (view, settled = null) => {
      run(`dbView = ${JSON.stringify(view)}`);
      run(`dbSettledCats.clear()`);
      if (settled) run(`dbSettledCats.add(${JSON.stringify(settled)})`);
      run('dbRender()');
      return mat.innerHTML;
    },
  };
}

const DECK = [{ card_name: 'Sol Ring', category: 'Ramp' }];

/** The `src` of every picture on the mat, in the order they are drawn. */
const pictures = html => [...html.matchAll(/<img[^>]*\bsrc="([^"]*)"/g)].map(m => m[1]);

// ── The one helper ────────────────────────────────────────────────────────

test('the picture a card shows is asked of the card, not of its name', () => {
  // The whole of the prefactor. A helper that takes a name can only ever answer
  // from the oracle cache; one that takes the deck's card can be taught to
  // prefer a printing that card is carrying, which is what comes next.
  const tab = loadTab(DECK);
  assert.strictEqual(tab.answer(`_dbCardImg({ card_name: 'Sol Ring' })`), SOL_RING_ART);
});

test('a two-faced card shows its front, as it always did', () => {
  const tab = loadTab(DECK);
  assert.strictEqual(tab.answer(`_dbCardImg({ card_name: 'Delver of Secrets' })`), DELVER_ART);
});

test('a card whose picture has not arrived has no picture, not a broken one', () => {
  const tab = loadTab(DECK);
  assert.strictEqual(tab.answer(`_dbCardImg({ card_name: 'Doom Blade' })`), '',
    'a card with no artwork');
  assert.strictEqual(tab.answer(`_dbCardImg({ card_name: 'Nothing By This Name' })`), '',
    'a card the cache has never heard of');
});

// ── The three views that draw one ─────────────────────────────────────────
// Each asserted twice over: that the picture on the mat is the one the helper
// gave, and that the helper was handed the card. The stub answers out of the
// card it is passed, so a view that still passes a name draws "art:undefined"
// and a view that never calls it draws the oracle cache's picture instead.

const STUB = `_dbCardImg = card => 'art:' + card.card_name`;

test('the grid tile draws the picture the helper gives it', () => {
  const tab = loadTab(DECK);
  tab.run(STUB);
  assert.deepStrictEqual(pictures(tab.paint('grid')), ['art:Sol Ring']);
});

test('a card in a spread pile draws the picture the helper gives it', () => {
  const tab = loadTab(DECK);
  tab.run(STUB);
  assert.deepStrictEqual(pictures(tab.paint('pile')), ['art:Sol Ring']);
});

test('the face of a settled stack is the picture the helper gives it', () => {
  const tab = loadTab(DECK);
  tab.run(STUB);
  assert.deepStrictEqual(pictures(tab.paint('pile', 'Ramp')), ['art:Sol Ring']);
});

// ── What the mat looks like, before and after ─────────────────────────────
// The prefactor changes nothing anybody can see, so what a card with a picture
// draws and what a card without one falls back to are pinned in all three
// views.

test('a card with artwork draws it, in every view', () => {
  const tab = loadTab(DECK);
  assert.deepStrictEqual(pictures(tab.paint('grid')), [SOL_RING_ART]);
  assert.deepStrictEqual(pictures(tab.paint('pile')), [SOL_RING_ART]);
  assert.deepStrictEqual(pictures(tab.paint('pile', 'Ramp')), [SOL_RING_ART]);
});

test('a card without artwork falls back to a surface, in every view', () => {
  // Not a card that pretends to be one: each view keeps the placeholder it has
  // always drawn, and none of them draws an <img> with nothing in it.
  const tab = loadTab([{ card_name: 'Doom Blade', category: 'Ramp' }]);

  const grid = tab.paint('grid');
  assert.deepStrictEqual(pictures(grid), [], 'the grid drew a picture it does not have');
  assert.match(grid, /sf-thumb-ph/);

  const pile = tab.paint('pile');
  assert.deepStrictEqual(pictures(pile), [], 'the pile drew a picture it does not have');
  assert.match(pile, /card-stack-blank/);

  const stack = tab.paint('pile', 'Ramp');
  assert.deepStrictEqual(pictures(stack), [], 'the stack drew a picture it does not have');
  assert.match(stack, /card-stack-face card-stack-blank/);
});

// ── The other side of it ──────────────────────────────────────────────────
// A card with two sides is drawn front-first here as everywhere else, and the
// way to see the other side is the control it wears — which `f` presses for
// the card under the pointer. The mat drew neither, so a double-faced card in
// a deck was the one place in the app where a card could not be turned over,
// and the tab's own note said it could.
//
// Where it is drawn is a size rather than a list of views, which is
// js/cardturn.js's rule: the grid tile and the card in a spread pile are cards
// big enough to read, the list row's thumbnail is an index, and a settled
// stack is not a card at all but the whole category standing in for one.

const TURNABLE = [{ card_name: 'Valakut Awakening', category: 'Ramp' }];

test('a two-faced card in the grid wears the control that turns it', () => {
  const tab  = loadTab(TURNABLE);
  const grid = tab.paint('grid');
  assert.match(grid, /class="card-turnable/, 'the grid tile draws no turn control');
  assert.match(grid, new RegExp(`data-turn="${VALAKUT_BACK}"`),
    'the control carries no other side to show');
});

test('and so does one lying in a spread pile', () => {
  const tab  = loadTab(TURNABLE);
  const pile = tab.paint('pile');
  assert.match(pile, /class="card-turnable/, 'a card in a spread pile draws no turn control');
  assert.match(pile, new RegExp(`data-turn="${VALAKUT_BACK}"`));
});

test('a card with one side wears nothing, in either view', () => {
  // The affordance means something precisely because it is not offered where
  // it would mean nothing — including on Delver, whose second face carries no
  // picture of its own.
  for (const name of ['Sol Ring', 'Delver of Secrets']) {
    const tab = loadTab([{ card_name: name, category: 'Ramp' }]);
    assert.doesNotMatch(tab.paint('grid'), /card-turnable|card-turn/, `${name}'s grid tile`);
    assert.doesNotMatch(tab.paint('pile'), /card-turnable|card-turn/, `${name} in a pile`);
  }
});

test('a settled stack does not turn over: it is a category, not a card', () => {
  /* The face of a stack stands for every card under it, and turning it would
   * be turning the pile over. Collections and the Set Browser draw their
   * settled stacks the same way, from the same helper. */
  const tab = loadTab(TURNABLE);
  assert.doesNotMatch(tab.paint('pile', 'Ramp'), /card-turnable|card-turn/);
});

test('the picture under the control is still the helper’s', () => {
  // The wrapper goes round the picture the mat already drew, so a chosen
  // printing's art is what is on the front of a card that turns over.
  const tab = loadTab(TURNABLE);
  tab.run(`_dbCardImg = card => 'art:' + card.card_name`);
  assert.deepStrictEqual(pictures(tab.paint('grid')), ['art:Valakut Awakening']);
  assert.deepStrictEqual(pictures(tab.paint('pile')), ['art:Valakut Awakening']);
});

// ── The fourth view ───────────────────────────────────────────────────────

test('the list row draws no picture of its own, and never did', () => {
  /* The row is a line of text: its picture is the hover preview main.js opens
   * over any .card-link, which is keyed by name and shared with every other tab
   * that lists cards. So there is nothing here for the helper to answer, and a
   * chosen printing reaching that preview is a decision about the whole app
   * rather than about the mat. */
  const tab = loadTab(DECK);
  const list = tab.paint('list');
  assert.deepStrictEqual(pictures(list), []);
  assert.match(list, /class="dv-name card-link" href="#" data-name="Sol Ring"/,
    'the row still hands the hover preview the name it looks a picture up by');
});
