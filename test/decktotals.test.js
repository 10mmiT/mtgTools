/* What the deck costs, and what finishing it costs.
 *
 * Every card has shown its own price for a long time and the deck showed no
 * total, which is the wrong way round — nobody adds up ninety-nine numbers.
 * What is asserted here is the two figures that puts on the readout, the rest
 * of what the readout should have been saying all along, and the four ways any
 * of it can quietly become wrong.
 *
 * The money counts the mainboard **and the commander**, because a deck you
 * cannot sit down with is not finished; everything else counts the mainboard
 * alone, because that is the deck. A maybeboard moves neither.
 *
 * A card with no Cardmarket price is *unknown*, never nought: a total quietly
 * short by however many of those the deck holds looks exactly like a total that
 * is right.
 *
 * And none of it runs on render. The mat's animation is bounded to what is on
 * screen, and a deck-wide pass beside it would undo that — so the pass is
 * counted here, not assumed.
 *
 * Three layers, all against the shipped files:
 *
 *   the pass    js/deckview-totals.js over a deck and a shelf, in a vm sandbox
 *   the strip   the readout and the analysis section, drawn
 *   the frame   the markup and the stylesheet, read as text where what matters
 *               is an element that must exist
 *
 * What is not asserted is what any of it looks like. That is the eye's.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* Prices in euros, because the app is Cardmarket-oriented throughout and this
 * ticket deliberately does not grow a currency selector. Mox Diamond has none
 * at all — Scryfall does that, and it is the case the "unpriced" count is for. */
const CARDS = {
  'Sol Ring':         { name: 'Sol Ring', type_line: 'Artifact', cmc: 1,
                        colors: [], color_identity: [], prices: { eur: '1.50' } },
  'Cultivate':        { name: 'Cultivate', type_line: 'Sorcery', cmc: 3,
                        colors: ['G'], color_identity: ['G'], prices: { eur: '0.50' } },
  'Krenko, Mob Boss': { name: 'Krenko, Mob Boss', type_line: 'Legendary Creature — Goblin',
                        cmc: 4, colors: ['R'], color_identity: ['R'], prices: { eur: '2.00' } },
  'Lightning Bolt':   { name: 'Lightning Bolt', type_line: 'Instant', cmc: 1,
                        colors: ['R'], color_identity: ['R'], prices: { eur: '1.00' } },
  'Forest':           { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0,
                        colors: [], color_identity: ['G'], prices: { eur: '0.10' } },
  'Mox Diamond':      { name: 'Mox Diamond', type_line: 'Artifact', cmc: 0,
                        colors: [], color_identity: [], prices: { eur: null } },
  'Atraxa, Praetors’ Voice': {
                        name: 'Atraxa, Praetors’ Voice', type_line: 'Legendary Creature — Phyrexian Angel Horror',
                        cmc: 4, colors: ['W','U','B','G'], color_identity: ['W','U','B','G'],
                        prices: { eur: '12.00' } },
};

/* Thirteen cards: one of each interesting type, eight Forests so that copies
 * have something to be wrong about, and one card nobody can price. */
const DECK = [
  { card_name: 'Sol Ring',         category: 'Ramp' },
  { card_name: 'Cultivate',        category: 'Ramp' },
  { card_name: 'Krenko, Mob Boss', category: 'Creatures' },
  { card_name: 'Lightning Bolt',   category: 'Removal' },
  { card_name: 'Mox Diamond',      category: 'Ramp' },
  { card_name: 'Forest',           category: 'Lands', qty: 8 },
];

const COMMANDER = { card_name: 'Atraxa, Praetors’ Voice', category: 'Creatures', board: 'commander' };

const PLAYERS = [
  { id: 'p-tim',  name: 'Tim',  colorIdx: 0, wantList: [], decks: [] },
  { id: 'p-anna', name: 'Anna', colorIdx: 1, wantList: [], decks: [] },
];

/* Mine, somebody else's, and the box in the cupboard that belongs to nobody —
 * the same three shelves the ownership ticket is asserted over, so that "the
 * missing figure follows the scope" has all three scopes to move between. */
const SHELVES = [
  { key: 'c:tim', name: 'Tim’s box', source: 'csv-moxfield', color: '#a855f7', owner: 'p-tim',
    cards: { 'Sol Ring': { name: 'Sol Ring', qty: 1 },
             'Forest':   { name: 'Forest',   qty: 6 } } },
  { key: 'c:anna', name: 'Anna’s box', source: 'csv-moxfield', color: '#3b82f6', owner: 'p-anna',
    cards: { 'Krenko, Mob Boss': { name: 'Krenko, Mob Boss', qty: 1 } } },
  { key: 'c:box', name: 'The cupboard', source: 'csv-moxfield', color: '#10b981', owner: null,
    cards: { 'Cultivate': { name: 'Cultivate', qty: 2 } } },
];

const AS_TIM = { username: 'tim', role: 'player', playerId: 'p-tim' };

function loadTab({ deck = DECK, cards = CARDS, collections = SHELVES,
                   players = PLAYERS, commander = '' } = {}) {
  const store = new Map();
  const mat = { innerHTML: '', classList: { toggle() {} } };
  const els = {};
  const el = id => (els[id] ||= {
    innerHTML: '', textContent: '', title: '', value: '', disabled: false,
    style: { setProperty() {} }, attrs: {}, dataset: {}, classes: new Set(),
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener() {}, focus() {}, appendChild() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
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
      getElementById: id => (id === 'dbDeckContent' ? mat : el(id)),
      body: { appendChild() {}, style: {} },
      scrollingElement: { scrollTop: 0 },
      documentElement:  { scrollTop: 0 },
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800, location: {} },
    console,
    confirm: () => true, alert: () => {}, clearTimeout() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, version: 1 }) }),
    // Outside this ticket: the pictures, the drawers, the mana.
    renderMana: () => '', renderPrice: () => '',
    openCardByName() {}, openDrawer() {}, closeDrawers() {}, renderDeck() {},
    ensureScryfallImages: async () => {},
    scryfallCache: new Map(), scryfallMetaCache: new Map(),
    deck: null, deckFilter: false, viewMode: 'list',
    animateCardMove: (_el, paint) => paint(),
  };
  sandbox.setTimeout = fn => 1;
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  for (const file of ['state.js', 'sortui.js', 'cardstack.js', 'cardquery.js',
                      'auth.js', 'collections.js',
                      'deckview-boards.js', 'deckview-core.js', 'deckview-render.js',
                      'deckview-edit.js', 'deckview-panels.js', 'deckview-history.js',
                      'deckview-owned.js', 'deckview-totals.js', 'deckview-legality.js',
                      'deckview-mana.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`currentUser = ${JSON.stringify(AS_TIM)}`);
  run(`hydrateState(${JSON.stringify({ players, collections })})`);
  run(`dbDeck = ${JSON.stringify({ id: 'd1', playerId: 'p-tim', name: 'A deck', commander })}`);
  run(`dbCards = ${JSON.stringify(deck.map((c, i) => ({ qty: 1, board: 'main', position: i, ...c })))}`);
  run(`dbCats = ${JSON.stringify(['Ramp', 'Creatures', 'Removal', 'Lands'].map((name, i) => ({ name, position: i })))}`);
  run(`dbCardData = new Map(${JSON.stringify(Object.entries(cards))})`);

  /* The pass, counted rather than assumed. A function declaration in this
   * sandbox is a property of its global, so wrapping it is enough to see every
   * call — including the ones made from the other module. */
  run(`
    _dbPasses = 0;
    _dbRealCompute = _dbComputeTotals;
    _dbComputeTotals = () => { _dbPasses++; return _dbRealCompute(); };
  `);

  return {
    run, answer, mat, el,
    /** The whole pass, as it comes out. */
    totals: () => answer('dbDeckTotals()'),
    /** The mat in one of its views, drawn — for the price a card is quoted at
     *  where you look at the card rather than at the deck. */
    paint: view => { run(`dbView = ${JSON.stringify(view)}`); run('dbRender()'); return mat.innerHTML; },
    /** The readout and the analysis strip, drawn. */
    render() { run('dbRenderStats()'); },
    passes: () => run('_dbPasses'),
    price:  () => el('dbStatPrice').innerHTML,
    curve:  () => el('dbCurve').innerHTML,
    types:  () => el('dbTypes').innerHTML,
    split:  () => el('dbSplit').innerHTML,
  };
}

/** The numbers out of a drawn line, so an assertion reads like the line does. */
const nums = html => (html.match(/[\d.]+/g) || []).map(Number);

// ── What the deck costs ───────────────────────────────────────────────────

test('the deck has a total, and it is the sum of what is in it', () => {
  // 1.50 + 0.50 + 2.00 + 1.00 + eight Forests at 0.10.
  const tab = loadTab();
  assert.strictEqual(tab.totals().price.eur.toFixed(2), '5.80');
});

test('and the commander is in it, because a deck without one is not finished', () => {
  /* The one place the commander counts. It is still not in the ninety-nine —
     "87 of 99 you own" goes on being the deck — but you cannot sleeve the deck
     without buying it, and what finishing costs is what this figure is for. */
  const tab = loadTab({ deck: [...DECK, COMMANDER] });
  assert.strictEqual(tab.totals().price.eur.toFixed(2), '17.80');
});

test('a maybeboard costs nothing, because it is not in the deck', () => {
  const tab = loadTab();
  const before = tab.totals();
  tab.run(`dbCards.push({ card_name: 'Krenko, Mob Boss', qty: 3, category: 'Creatures', board: 'maybe', position: 9 })`);
  tab.run(`dbCards.push({ card_name: 'Sol Ring', qty: 2, category: 'Ramp', board: 'side', position: 10 })`);
  tab.run('dbTotalsChanged()');
  assert.deepStrictEqual(tab.totals().price, before.price,
    'six euros of cards nobody has put in the deck moved what the deck costs');
});

test('copies, not rows: eight Forests cost eight Forests', () => {
  const tab = loadTab();
  const before = tab.totals().price.eur;
  tab.run(`dbCards.find(c => c.card_name === 'Forest').qty = 9`);
  tab.run('dbTotalsChanged()');
  assert.strictEqual((tab.totals().price.eur - before).toFixed(2), '0.10');
});

// ── What finishing it costs ───────────────────────────────────────────────

test('the missing figure is the copies you are short of, and only those', () => {
  /* Tim has the Sol Ring and six of the eight Forests. What is left is
     Cultivate, Krenko, the Bolt, two Forests — and the Mox, which nobody can
     price. */
  const tab = loadTab();
  const { missing } = tab.totals();
  assert.strictEqual(missing.eur.toFixed(2), '3.70');
  assert.strictEqual(missing.unknown, 1, 'the card with no price was costed');
});

test('and it follows the ownership scope, exactly as “87 of 99” does', () => {
  const tab = loadTab();
  assert.strictEqual(tab.totals().missing.eur.toFixed(2), '3.70');

  // The cupboard belongs to nobody, so the group's shelf holds its Cultivate.
  tab.run(`dbSetOwnScope('group')`);
  assert.strictEqual(tab.totals().missing.eur.toFixed(2), '3.20');

  // Everyone's adds Anna's Krenko on top of that.
  tab.run(`dbSetOwnScope('all')`);
  assert.strictEqual(tab.totals().missing.eur.toFixed(2), '1.20');
});

test('a commander you do not own is part of what finishing costs', () => {
  const tab = loadTab({ deck: [...DECK, COMMANDER] });
  assert.strictEqual(tab.totals().missing.eur.toFixed(2), '15.70',
    'the twelve-euro commander nobody has is not in what the deck still needs');
});

test('nothing missing is nothing to say', () => {
  const tab = loadTab({ collections: [{
    key: 'c:tim', name: 'Tim’s box', source: 'csv-moxfield', color: '#a855f7', owner: 'p-tim',
    cards: Object.fromEntries(Object.keys(CARDS).map(n => [n, { name: n, qty: 8 }])),
  }] });
  const { missing } = tab.totals();
  assert.strictEqual(missing.eur, 0);
  assert.strictEqual(missing.unknown, 0);
  tab.render();
  assert.ok(!tab.price().includes('to finish'),
    'a deck already on the shelf was quoted a price for finishing it');
});

// ── The card nobody can price ─────────────────────────────────────────────

test('a card with no price is unknown, never nought', () => {
  const tab = loadTab();
  const { price } = tab.totals();
  assert.strictEqual(price.unknown, 1);
  assert.strictEqual(price.priced, 12, 'thirteen cards, one of them unpriceable');
});

test('and the total says so rather than being quietly short', () => {
  const tab = loadTab();
  tab.render();
  assert.match(tab.price(), /1 unpriced/,
    'the readout claimed a total it could not stand behind');
});

test('a deck nothing can be priced at is a dash, not €0.00', () => {
  const bare = Object.fromEntries(
    Object.entries(CARDS).map(([n, c]) => [n, { ...c, prices: undefined }]));
  const tab = loadTab({ cards: bare });
  tab.render();
  assert.ok(tab.price().includes('—'), 'nothing priced was drawn as free');
  assert.ok(!tab.price().includes('€0.00'));
});

test('a price Scryfall sends as something other than a number is unknown too', () => {
  const tab = loadTab();
  tab.run(`dbCardData.get('Sol Ring').prices.eur = ''`);
  tab.run('dbTotalsChanged()');
  const { price } = tab.totals();
  assert.strictEqual(price.eur.toFixed(2), '4.30');
  assert.strictEqual(price.unknown, 2);
});

// ── The printing the deck runs ────────────────────────────────────────────
// A card that has been given a printing of its own is costed at that printing.
// The deck runs the Ravnica Sol Ring, so the Ravnica Sol Ring is what buying
// the deck costs — a total added up off whichever printing Scryfall calls the
// default is a total for a deck nobody is holding.
//
// What the snapshot says is the whole of the answer: it was taken on the day
// the printing was chosen and nothing has re-priced it since, which
// docs/design/spec-printings.md states rather than hides. So the oracle cache
// is not consulted behind it, not even when the snapshot has no price at all.

const RAVNICA_SOL_RING = {
  id: '00000000-0000-4000-8000-000000000001', set: 'rav',
  set_name: 'Ravnica: City of Guilds', collector_number: '266',
  image: 'https://cards.scryfall.io/normal/rav-sol-ring.jpg',
  price_eur: '4.50', chosen_at: '2026-08-15',
};

/** The deck, with one card given a printing to run. */
const running = (cardName, printing) =>
  DECK.map(c => (c.card_name === cardName ? { ...c, printing } : c));

test('a chosen printing is what the deck is counted at, not the one the app would pick', () => {
  // 5.80 with the Sol Ring the cache holds at 1.50; the Ravnica one is 4.50.
  const tab = loadTab({ deck: running('Sol Ring', RAVNICA_SOL_RING) });
  assert.strictEqual(tab.totals().price.eur.toFixed(2), '8.80');
});

test('copies are copies of the printing you chose', () => {
  // Eight Forests at 0.60 rather than at the cache's 0.10.
  const tab = loadTab({ deck: running('Forest', { ...RAVNICA_SOL_RING, price_eur: '0.60' }) });
  assert.strictEqual(tab.totals().price.eur.toFixed(2), '9.80');
});

test('a chosen printing nobody is selling is unknown, not the price of another one', () => {
  const tab = loadTab({ deck: running('Sol Ring', { ...RAVNICA_SOL_RING, price_eur: null }) });
  const { price } = tab.totals();
  assert.strictEqual(price.eur.toFixed(2), '4.30',
    'the deck was costed at a printing it does not run');
  assert.strictEqual(price.unknown, 2, 'Mox Diamond, and a Sol Ring nobody is selling');
});

// ── And what the card itself is quoted at ─────────────────────────────────
// The tile and the row draw the same preference the total is added up by. A
// tile quoting the default printing's price beside art that is a different
// printing's is the mat disagreeing with itself about which card this is.

/* The stub answers out of what it is handed, so a view still passing the oracle
 * cache's card draws that card's price rather than the chosen printing's. */
const PRICE_STUB = `renderPrice = card => '<b>eur:' + (card?.prices?.eur ?? 'none') + '</b>'`;

/** Every price on the mat, in the order they are drawn. */
const quoted = html => [...html.matchAll(/<b>eur:([^<]*)<\/b>/g)].map(m => m[1]);

/* Ramp, Creatures, Removal, Lands, each sorted by name — the mat's order, not
 * the deck array's. Sol Ring is the third of them. */
const AS_THE_CACHE_HAS_IT   = ['0.50', 'none', '1.50', '2.00', '1.00', '0.10'];
const AS_THE_DECK_RUNS_THEM = ['0.50', 'none', '4.50', '2.00', '1.00', '0.10'];

test('the grid tile is quoted at the printing the deck runs', () => {
  const tab = loadTab({ deck: running('Sol Ring', RAVNICA_SOL_RING) });
  tab.run(PRICE_STUB);
  assert.deepStrictEqual(quoted(tab.paint('grid')), AS_THE_DECK_RUNS_THEM);
});

test('and so is the list row', () => {
  const tab = loadTab({ deck: running('Sol Ring', RAVNICA_SOL_RING) });
  tab.run(PRICE_STUB);
  assert.deepStrictEqual(quoted(tab.paint('list')), AS_THE_DECK_RUNS_THEM);
});

test('a card nobody has chosen a printing for is quoted where it always was', () => {
  const tab = loadTab();
  tab.run(PRICE_STUB);
  assert.deepStrictEqual(quoted(tab.paint('grid')), AS_THE_CACHE_HAS_IT);
  assert.deepStrictEqual(quoted(tab.paint('list')), AS_THE_CACHE_HAS_IT);
});

// ── The type breakdown and the split ──────────────────────────────────────

const typeCount = (totals, id) => totals.types.find(t => t.id === id).n;

test('the breakdown buckets each card once, and adds up to the deck', () => {
  const tab = loadTab();
  const totals = tab.totals();
  assert.strictEqual(typeCount(totals, 'creature'), 1);
  assert.strictEqual(typeCount(totals, 'instant'), 1);
  assert.strictEqual(typeCount(totals, 'sorcery'), 1);
  assert.strictEqual(typeCount(totals, 'artifact'), 2);
  assert.strictEqual(typeCount(totals, 'land'), 8);
  assert.strictEqual(totals.types.reduce((n, t) => n + t.n, 0), totals.cards,
    'a card was counted twice, or not at all');
});

test('and it reads the piles’ way round: an artifact creature is a creature', () => {
  // The same order dbAutoCategory() tests in, so the breakdown never disagrees
  // with the categories on the mat by four. A card the function-category list
  // has never heard of, so what is being compared is the type order alone.
  const tab = loadTab();
  tab.run(`
    dbCardData.set('Steel Overseer', { name: 'Steel Overseer',
      type_line: 'Artifact Creature — Construct', cmc: 2,
      colors: [], color_identity: [], prices: { eur: '3.00' } });
    dbCards.push({ card_name: 'Steel Overseer', qty: 1, category: 'Creatures',
                   board: 'main', position: 9 });
  `);
  tab.run('dbTotalsChanged()');
  const totals = tab.totals();
  assert.strictEqual(typeCount(totals, 'creature'), 2);
  assert.strictEqual(typeCount(totals, 'artifact'), 2, 'and it was counted as both');
  assert.strictEqual(tab.run(`dbAutoCategory('Steel Overseer')`), 'Creatures',
    'the breakdown and the auto-category stopped agreeing');
});

test('the split is permanents, spells and lands, and it adds up too', () => {
  const tab = loadTab();
  const { permanents, spells, lands, cards } = tab.totals();
  assert.strictEqual(permanents, 3, 'Krenko, Sol Ring and the Mox');
  assert.strictEqual(spells, 2, 'the Bolt and the Cultivate');
  assert.strictEqual(lands, 8);
  assert.strictEqual(permanents + spells + lands, cards);
});

test('the breakdown is the deck’s: neither the commander nor a maybeboard is in it', () => {
  const tab = loadTab();
  const before = tab.totals();
  tab.run(`dbCards.push(${JSON.stringify({ ...COMMANDER, qty: 1, position: 9 })})`);
  tab.run(`dbCards.push({ card_name: 'Lightning Bolt', qty: 4, category: 'Removal', board: 'maybe', position: 10 })`);
  tab.run('dbTotalsChanged()');
  const after = tab.totals();
  assert.deepStrictEqual(after.types, before.types);
  assert.strictEqual(after.permanents, before.permanents);
  assert.strictEqual(after.spells, before.spells);
});

test('both are drawn into the strip that expands out of the toolbar', () => {
  const tab = loadTab();
  tab.render();
  assert.match(tab.types(), /<strong>8<\/strong> lands/);
  assert.match(tab.split(), /<strong>2<\/strong> spells/);
});

test('and one of a thing is one of it, not one of them', () => {
  // These lines are read at a glance, and "1 sorceries" is where the eye stops.
  const tab = loadTab();
  tab.render();
  assert.match(tab.types(), /<strong>1<\/strong> sorcery\b/);
  assert.match(tab.types(), /<strong>1<\/strong> creature\b/);
  assert.ok(!/1<\/strong> (sorceries|creatures|lands)/.test(tab.types()));
});

// ── The curve ─────────────────────────────────────────────────────────────

test('the curve is the deck’s non-lands, as it always was', () => {
  const tab = loadTab();
  assert.deepStrictEqual(tab.totals().curve.map(b => b.n), [1, 2, 0, 1, 1, 0, 0, 0]);
});

test('and it can be cut into the colours it is made of', () => {
  const tab = loadTab();
  tab.render();
  const merged = tab.curve();
  assert.ok(!merged.includes('db-curve-band'), 'the curve arrives merged');

  tab.run('dbToggleCurveColors()');
  const split = tab.curve();
  assert.match(split, /db-curve-stack/);
  assert.match(split, /background:var\(--mc-r\)/, 'the red band names the theme’s red');
  assert.match(split, /1 red, 1 colourless/, 'the bar does not say what it is made of');

  tab.run('dbToggleCurveColors()');
  assert.strictEqual(tab.curve(), merged, 'turning it back gave a different curve');
});

test('a gold card is one band, not one band per colour it is', () => {
  /* Otherwise the bars add up to more than the deck, and a curve that does not
     add up to the deck is not a curve. */
  const tab = loadTab();
  tab.run(`dbCards.push({ card_name: 'Atraxa, Praetors’ Voice', qty: 1, category: 'Creatures', board: 'main', position: 9 })`);
  tab.run('dbTotalsChanged()');
  const bar = tab.totals().curve[4];
  assert.strictEqual(bar.n, 2, 'Krenko and Atraxa');
  assert.strictEqual(bar.bands.M, 1, 'the four-colour commander is not one multicolour card');
  assert.strictEqual(bar.bands.W, 0, 'and it was counted under its colours as well');
  assert.strictEqual(Object.values(bar.bands).reduce((a, b) => a + b, 0), bar.n);
});

test('the bands stack to the height the merged bar had', () => {
  // One shape read two ways, not two charts.
  const tab = loadTab();
  tab.render();
  const heights = html => (html.match(/height:(\d+)px/g) || []);
  const merged = heights(tab.curve());
  tab.run('dbToggleCurveColors()');
  assert.deepStrictEqual(heights(tab.curve()), merged);
});

test('what a card costs to cast decides its band, not what a deck may hold', () => {
  /* A colourless artifact with one green activation has G in its identity and
     belongs in the colourless band: the curve is about casting things. */
  const tab = loadTab();
  tab.run(`dbCardData.get('Sol Ring').color_identity = ['G']`);
  tab.run('dbTotalsChanged()');
  assert.strictEqual(tab.totals().curve[1].bands.C, 1);
});

test('a transforming card is banded by the face you cast', () => {
  // Scryfall keeps no top-level `colors` on those; the front face has them.
  const tab = loadTab();
  tab.run(`
    const sf = dbCardData.get('Cultivate');
    delete sf.colors;
    sf.card_faces = [{ name: 'Cultivate', colors: ['U'] }];
  `);
  tab.run('dbTotalsChanged()');
  assert.strictEqual(tab.totals().curve[3].bands.U, 1);
});

// ── One pass, and none of it on render ────────────────────────────────────

test('the readout and the whole analysis strip cost one pass between them', () => {
  const tab = loadTab();
  tab.render();
  assert.strictEqual(tab.passes(), 1,
    'the price, the curve, the types and the split each counted the deck again');
});

test('drawing the mat costs none at all', () => {
  /* The mat's animation is bounded to what is on screen, and this is the
     promise that keeps it that way. */
  const tab = loadTab();
  tab.render();
  const after = tab.passes();
  for (let i = 0; i < 20; i++) tab.run('dbRender()');
  assert.strictEqual(tab.passes(), after, 'the mat recounted the deck to draw itself');
});

test('and so does opening the strip and turning the curve over', () => {
  const tab = loadTab();
  tab.render();
  const after = tab.passes();
  tab.run('dbToggleAnalysis()');
  tab.run('dbToggleCurveColors()');
  tab.run('dbToggleCurveColors()');
  tab.run('dbToggleAnalysis()');
  assert.strictEqual(tab.passes(), after,
    'a different way of drawing the same count did the count again');
});

test('a deck that changes is counted again', () => {
  const tab = loadTab();
  tab.render();
  const before = tab.totals().cards;
  tab.run(`dbCards.find(c => c.card_name === 'Forest').qty = 20`);
  tab.render();
  assert.strictEqual(tab.totals().cards, before + 12, 'the readout went stale');
  assert.strictEqual(tab.passes(), 2, 'once per change, and once only');
});

test('a shelf arriving is counted again too — the missing figure depends on it', () => {
  const tab = loadTab();
  tab.render();
  const before = tab.totals().missing.eur;
  tab.run(`state.collections.find(c => c.key === 'c:tim').cards.set('Cultivate', { name: 'Cultivate', qty: 1 })`);
  tab.run('dbOwnershipChanged()');
  assert.ok(tab.totals().missing.eur < before,
    'a card that arrived on the shelf is still being costed');
});

test('four hundred cards is still one pass', () => {
  const many = [];
  for (let i = 0; i < 100; i++) {
    for (const c of DECK) many.push({ ...c, card_name: c.card_name, position: many.length });
  }
  const tab = loadTab({ deck: many });
  tab.render();
  assert.strictEqual(tab.passes(), 1);
  for (let i = 0; i < 20; i++) tab.run('dbRender()');
  assert.strictEqual(tab.passes(), 1, 'a big deck was recounted to draw the mat');
});

// ── The frame ─────────────────────────────────────────────────────────────

const MARKUP = read('public/index.html');
const CSS    = read('public/css/tabs.css');

test('the price sits on the readout, not on a strip of its own', () => {
  const bar = MARKUP.match(/<div class="db-stats-bar[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(bar, 'the readout is gone');
  assert.match(bar[0], /id="dbStatPrice"/);
});

test('the breakdown and the split expand out of the toolbar with the curve', () => {
  assert.match(MARKUP, /id="dbAnalysis"[\s\S]*?id="dbCurve"[\s\S]*?id="dbTypes"[\s\S]*?id="dbSplit"[\s\S]*?<\/div>/,
    'the analysis strip does not hold all three');
  assert.match(MARKUP, /id="dbCurveModeBtn"[^>]*aria-pressed=/,
    'the curve’s colour toggle does not say whether it is on');
});

/* The order the page loads its scripts in, off the script tags alone. Not the
   position of the filename anywhere in the file: these modules name each other
   in comments, and a comment is not a load order. */
const SCRIPTS = [...MARKUP.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);

test('the module is served', () => {
  assert.ok(SCRIPTS.includes('deckview-totals.js'));
  assert.ok(SCRIPTS.indexOf('deckview-totals.js') > SCRIPTS.indexOf('deckview-owned.js'),
    'the totals are loaded before the shelf they ask about what is missing');
});

test('a colour band is drawn in the theme’s mana palette, never in hex', () => {
  const totals = read('public/js/deckview-totals.js');
  assert.match(totals, /var\(--mc-gold\)/, 'multicolour is not on the mana palette');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(totals), 'a colour was written into the module as hex');
  assert.match(CSS, /\.db-curve-stack/, 'the stacked bar has no rule');
});
