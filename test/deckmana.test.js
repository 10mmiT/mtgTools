/* What the deck's spells want, against what its lands make.
 *
 * The Mana Base Calculator has done the right maths since long before this
 * ticket and made a person type every number into it by hand, while the deck
 * holding all of them sat one tab away. What is asserted here is the two of
 * them speaking: the pass that counts pips off mana costs and sources off
 * `produced_mana`, the panel that puts one against the other, and the fill that
 * lands in the calculator's fields.
 *
 * The pips are the half that can quietly be wrong. A colour identity is not a
 * cost — a card costing {1}{G} demands one green pip and a card costing
 * {G}{G}{G} demands three, and the readout's row of symbols has always counted
 * cards. So every shape a cost comes in is asserted: hybrid, phyrexian, split,
 * transforming, generic, and the commander, which is cast more often than
 * anything else in the box and is in nobody else's count.
 *
 * And none of it runs on render, for the reason js/deckview-totals.js and
 * js/deckview-legality.js do not: the mat's animation is bounded to what is on
 * screen, and a deck-wide pass beside it would undo that.
 *
 * Three layers, all against the shipped files:
 *
 *   the pass    js/deckview-mana.js over a deck, in a vm sandbox
 *   the door    the readout's lands figure, and the Lands tab it opens
 *   the fill    js/lands.js's fields, written from the deck
 *
 * The panel that used to rise out of that figure is gone: it drew pips against
 * sources per colour, and the Lands tab's check draws the same comparison with
 * the requirement beside it and the fix underneath. What it said is asserted
 * where it now lives — test/decklands.test.js — and what is left here is the
 * pass those numbers are read off, the figure that opens the tab, and the fill.
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

/* One card of every shape a mana cost comes in, and one of every shape a mana
 * source comes in. `produced_mana` is ticket 01's field and is absent on a card
 * that makes no mana, which is Scryfall's own shape and the case the pass has
 * to survive. */
const CARDS = {
  'Plains':          { name: 'Plains', type_line: 'Basic Land — Plains', cmc: 0,
                       mana_cost: '', colors: [], color_identity: ['W'], produced_mana: ['W'] },
  'Island':          { name: 'Island', type_line: 'Basic Land — Island', cmc: 0,
                       mana_cost: '', colors: [], color_identity: ['U'], produced_mana: ['U'] },
  'Command Tower':   { name: 'Command Tower', type_line: 'Land', cmc: 0,
                       mana_cost: '', colors: [], color_identity: [],
                       produced_mana: ['W','U','B','R','G'] },
  'Sol Ring':        { name: 'Sol Ring', type_line: 'Artifact', cmc: 1,
                       mana_cost: '{1}', colors: [], color_identity: [], produced_mana: ['C'] },
  'Birds of Paradise': { name: 'Birds of Paradise', type_line: 'Creature — Bird', cmc: 1,
                       mana_cost: '{G}', colors: ['G'], color_identity: ['G'],
                       produced_mana: ['W','U','B','R','G'] },
  'Lightning Bolt':  { name: 'Lightning Bolt', type_line: 'Instant', cmc: 1,
                       mana_cost: '{R}', colors: ['R'], color_identity: ['R'] },
  'Boros Charm':     { name: 'Boros Charm', type_line: 'Instant', cmc: 2,
                       mana_cost: '{R}{W}', colors: ['R','W'], color_identity: ['R','W'] },
  // Hybrid: either colour will pay it.
  'Kitchen Finks':   { name: 'Kitchen Finks', type_line: 'Creature — Ouphe', cmc: 3,
                       mana_cost: '{1}{G/W}', colors: ['G','W'], color_identity: ['G','W'] },
  // Phyrexian: the other way to pay is two life.
  'Gitaxian Probe':  { name: 'Gitaxian Probe', type_line: 'Sorcery', cmc: 1,
                       mana_cost: '{U/P}', colors: ['U'], color_identity: ['U'] },
  // Colourless, which is a pip and is why the calculator has a Wastes field.
  'Matter Reshaper': { name: 'Matter Reshaper', type_line: 'Creature — Eldrazi', cmc: 3,
                       mana_cost: '{2}{C}', colors: [], color_identity: [] },
  // A split card, whose one cost string holds both halves.
  'Fire // Ice':     { name: 'Fire // Ice', type_line: 'Instant // Instant', cmc: 4,
                       mana_cost: '{1}{R} // {1}{U}', colors: ['R','U'], color_identity: ['R','U'] },
  // A transforming card, which keeps no cost of its own.
  'Delver of Secrets': { name: 'Delver of Secrets', type_line: 'Creature — Human Wizard', cmc: 1,
                       mana_cost: '', colors: ['U'], color_identity: ['U'],
                       card_faces: [{ name: 'Delver of Secrets', mana_cost: '{U}' },
                                    { name: 'Insectile Aberration', mana_cost: null }] },
  /* An Adventure: two costs on one card, and both are cast off real mana. Its
     top-level mana_cost is the creature's alone, so a reading that trusts that
     field sees one red pip where the card asks for two. */
  'Bonecrusher Giant': { name: 'Bonecrusher Giant', cmc: 3,
                       type_line: 'Creature — Giant // Instant — Adventure',
                       mana_cost: '{2}{R}', colors: ['R'], color_identity: ['R'],
                       card_faces: [{ name: 'Bonecrusher Giant', mana_cost: '{2}{R}' },
                                    { name: 'Stomp', mana_cost: '{1}{R}' }] },
  'Atraxa, Praetors’ Voice': {
                       name: 'Atraxa, Praetors’ Voice', type_line: 'Legendary Creature — Angel',
                       cmc: 4, mana_cost: '{G}{W}{U}{B}', colors: ['W','U','B','G'],
                       color_identity: ['W','U','B','G'] },
};

/* Seven lands — six basic, one not — and one card of each awkward cost. */
const DECK = [
  { card_name: 'Plains',            category: 'Lands', qty: 4 },
  { card_name: 'Island',            category: 'Lands', qty: 2 },
  { card_name: 'Command Tower',     category: 'Lands' },
  { card_name: 'Sol Ring',          category: 'Ramp' },
  { card_name: 'Birds of Paradise', category: 'Ramp' },
  { card_name: 'Lightning Bolt',    category: 'Removal' },
  { card_name: 'Boros Charm',       category: 'Removal' },
  { card_name: 'Kitchen Finks',     category: 'Creatures' },
  { card_name: 'Gitaxian Probe',    category: 'Removal' },
  { card_name: 'Matter Reshaper',   category: 'Creatures' },
  { card_name: 'Fire // Ice',       category: 'Removal' },
  { card_name: 'Delver of Secrets', category: 'Creatures' },
];

const COMMANDER = { card_name: 'Atraxa, Praetors’ Voice', category: 'Creatures', board: 'commander' };

const PLAYERS = [{ id: 'p-tim', name: 'Tim', colorIdx: 0, wantList: [], decks: [] }];
const AS_TIM  = { username: 'tim', role: 'player', playerId: 'p-tim' };

function loadTab({ deck = [...DECK, COMMANDER], cards = CARDS, commander = 'Atraxa, Praetors’ Voice' } = {}) {
  const store = new Map();
  const mat = { innerHTML: '', classList: { toggle() {} } };
  const els = {};
  const stub = () => {
    const el = {
      innerHTML: '', textContent: '', title: '', value: '', placeholder: '',
      disabled: false, min: '', max: '',
      style: { setProperty() {} }, attrs: {}, dataset: {}, classes: new Set(),
      setAttribute(k, v) { el.attrs[k] = v; },
      getAttribute(k) { return el.attrs[k]; },
      addEventListener() {}, focus() {}, appendChild() {}, dispatchEvent() {},
      querySelector: () => null, querySelectorAll: () => [], closest: () => null,
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
      classList: {
        toggle(name, on) { on ? el.classes.add(name) : el.classes.delete(name); },
        add(name) { el.classes.add(name); },
        remove(name) { el.classes.delete(name); },
        contains(name) { return el.classes.has(name); },
      },
    };
    return el;
  };
  const el = id => (els[id] ||= stub());

  /* The calculator's three deck-size presets, which are the one part of that
     tab that is a set of elements rather than a field with an id. */
  const presets = [40, 60, 100].map(size => {
    const b = stub();
    b.dataset.size = String(size);
    if (size === 60) b.classes.add('active');   // the tab arrives on 60
    return b;
  });

  const sandbox = {
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    document: {
      addEventListener() {}, createElement: () => stub(),
      getElementById: id => (id === 'dbDeckContent' ? mat : el(id)),
      querySelectorAll: sel => (sel === '.land-preset-btn' ? presets : []),
      querySelector: sel => (sel === '.land-preset-btn.active'
        ? presets.find(b => b.classList.contains('active')) || null : null),
      body: { appendChild() {}, style: {} },
      scrollingElement: { scrollTop: 0 },
      documentElement:  { scrollTop: 0 },
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800, location: {} },
    console,
    confirm: () => true, alert: () => {}, clearTimeout() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, version: 1 }) }),
    // Outside this ticket: the pictures, the drawers, the mana symbols.
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
                      'auth.js', 'collections.js', 'lands.js',
                      'owned.js', 'cardturn.js', 'deckview-boards.js', 'deckview-core.js', 'deckview-render.js',
                      'deckview-edit.js', 'deckview-panels.js', 'deckview-history.js',
                      'deckview-owned.js', 'deckview-totals.js', 'deckview-legality.js',
                      'deckview-mana.js', 'deckview-landbase.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`currentUser = ${JSON.stringify(AS_TIM)}`);
  run(`hydrateState(${JSON.stringify({ players: PLAYERS, collections: [] })})`);
  run(`dbDeck = ${JSON.stringify({ id: 'd1', playerId: 'p-tim', name: 'Atraxa', commander })}`);
  run(`dbCards = ${JSON.stringify(deck.map((c, i) => ({ qty: 1, board: 'main', position: i, ...c })))}`);
  run(`dbCats = ${JSON.stringify(['Ramp', 'Creatures', 'Removal', 'Lands'].map((name, i) => ({ name, position: i })))}`);
  run(`dbCardData = new Map(${JSON.stringify(Object.entries(cards))})`);

  /* The pass, counted rather than assumed — the same wrapping the totals are
     asserted with, and for the same promise about the mat. */
  run(`
    _dbManaPasses = 0;
    _dbRealComputeMana = _dbComputeMana;
    _dbComputeMana = () => { _dbManaPasses++; return _dbRealComputeMana(); };
  `);

  return {
    run, answer, el, presets,
    /** The whole pass, as it comes out. */
    mana: () => answer('dbDeckMana()'),
    /** The readout, drawn. */
    render() { run('dbRenderStats()'); },
    passes: () => run('_dbManaPasses'),
    lands:  () => el('dbStatLands').innerHTML,
    /** The lands figure, pressed. */
    press() { run('dbOpenLandsTab()'); },
    /** Where that put you: the drawer's half, and whether the drawer is open. */
    leftTab:    () => run('dbLeftTab'),
    drawerOpen: () => el('dbSearchPanel').classList.contains('open'),
    /** The Lands tab, drawn — which is where the panel's readings went. */
    tab:    () => el('dbLandsContent').innerHTML,
    /** What the calculator holds. */
    field:  id => el(id).value,
    note:   () => el('landsDeckNote').textContent,
  };
}

/** Near enough, for numbers that are halves by construction. */
const about = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-9, `${why}: ${a} is not ${b}`);

// ── Pips are what the deck costs ──────────────────────────────────────────

test('a pip is a symbol in a cost, not a colour the deck is allowed to hold', () => {
  /* The whole of why this module exists. Every card in this deck with green in
     its identity would count once on the readout's colour row; what the deck
     actually asks for is Birds' one green, half of Kitchen Finks' hybrid, and
     Atraxa's one. */
  const tab = loadTab();
  const { pips } = tab.mana();
  about(pips.G, 2.5, 'the green pips');
  assert.strictEqual(tab.answer('dbDeckTotals().colorCards').G, 2,
    'the readout stopped counting cards by identity, which is its own question');
});

test('a hybrid symbol is half a pip to each of the colours that pays it', () => {
  /* Either will do. Counting {G/W} as a whole pip of each would make a deck of
     hybrid cards demand twice the mana it does, and the basics it splits are
     split out of a total that has to be real. */
  const tab = loadTab({ deck: [{ card_name: 'Kitchen Finks', category: 'Creatures' }], commander: '' });
  const { pips, totalPips } = tab.mana();
  about(pips.G, 0.5, 'the green half');
  about(pips.W, 0.5, 'the white half');
  about(totalPips, 1, 'one symbol became more than one pip');
});

test('and so is a phyrexian one, because the other way to pay it is life', () => {
  const tab = loadTab({ deck: [{ card_name: 'Gitaxian Probe', category: 'Removal' }], commander: '' });
  about(tab.mana().pips.U, 0.5, 'the blue half of {U/P}');
});

test('generic mana is not a pip: it says how much, not which', () => {
  const tab = loadTab({ deck: [{ card_name: 'Sol Ring', category: 'Ramp' }], commander: '' });
  assert.strictEqual(tab.mana().totalPips, 0, '{1} was counted as a demand for a colour');
});

test('colourless is a pip, and is why the calculator has a Wastes field', () => {
  const tab = loadTab({ deck: [{ card_name: 'Matter Reshaper', category: 'Creatures' }], commander: '' });
  const { pips, totalPips } = tab.mana();
  assert.strictEqual(pips.C, 1, '{C} is a symbol like any other');
  assert.strictEqual(totalPips, 1, 'the {2} beside it was counted too');
});

test('a split card asks for both halves, because you may cast either', () => {
  const tab = loadTab({ deck: [{ card_name: 'Fire // Ice', category: 'Removal' }], commander: '' });
  const { pips } = tab.mana();
  assert.strictEqual(pips.R, 1);
  assert.strictEqual(pips.U, 1);
});

test('a transforming card is read off the face that has a cost', () => {
  // Scryfall keeps no top-level mana_cost on those; the front face has it.
  const tab = loadTab({ deck: [{ card_name: 'Delver of Secrets', category: 'Creatures' }], commander: '' });
  assert.strictEqual(tab.mana().pips.U, 1, 'a card with no cost of its own asked for nothing');
});

test('copies count: four Plains are four white sources, and four cards', () => {
  const tab = loadTab();
  assert.strictEqual(tab.mana().sources.W, 6, 'four Plains, the Tower and the Birds');
  tab.run(`dbCards.find(c => c.card_name === 'Plains').qty = 8`);
  tab.run('dbManaChanged()');
  assert.strictEqual(tab.mana().sources.W, 10);
});

test('the commander is in both halves, because you cast it more than anything', () => {
  /* A different rule from the count on the readout, which leaves it out because
     it is not one of the ninety-nine. A mana base that ignores what the
     commander costs is a mana base for a different deck. */
  const tab = loadTab();
  const withIt = tab.mana();
  const without = loadTab({ deck: DECK, commander: '' }).mana();
  about(withIt.pips.B - without.pips.B, 1, 'Atraxa’s black pip');
  assert.strictEqual(without.pips.B, 0, 'nothing else in the deck costs black');
});

// ── Sources are what the deck makes ───────────────────────────────────────

test('a land is a source of each colour it makes, so a dual is two', () => {
  const tab = loadTab();
  const { sources } = tab.mana();
  assert.strictEqual(sources.B, 2, 'the Command Tower and the Birds');
  assert.strictEqual(sources.R, 2);
});

test('a card that makes mana without being a land is a source too', () => {
  const tab = loadTab();
  const { sourceCards, landSources, otherSources, sources } = tab.mana();
  assert.strictEqual(otherSources, 2, 'Sol Ring and Birds of Paradise');
  assert.strictEqual(landSources, 7);
  assert.strictEqual(sourceCards, 9);
  assert.strictEqual(sources.C, 1, 'the Sol Ring makes colourless and nothing else does');
});

test('a card that makes no mana is not a source', () => {
  const tab = loadTab();
  const before = tab.mana().totalSources;
  tab.run(`dbCards.push({ card_name: 'Lightning Bolt', qty: 3, category: 'Removal', board: 'main', position: 90 })`);
  tab.run('dbManaChanged()');
  assert.strictEqual(tab.mana().totalSources, before, 'a card with no produced_mana was counted');
});

test('a card cached before produced_mana existed makes nothing, and does not throw', () => {
  const tab = loadTab();
  tab.run(`delete dbCardData.get('Command Tower').produced_mana`);
  tab.run('dbManaChanged()');
  assert.strictEqual(tab.mana().sources.B, 1, 'only the Birds are left making black');
});

// ── The lands, and the one answer to what a land is ───────────────────────

test('the lands are counted, and split into basics and the rest', () => {
  const tab = loadTab();
  assert.deepStrictEqual(tab.mana().lands, { total: 7, basic: 6, nonBasic: 1 });
});

test('and what counts as a land is the readout’s answer, not a second one', () => {
  /* An artifact land is bucketed under artifacts by the app's one type ladder,
     which is what the breakdown and the piles on the mat read. Two ways of
     deciding what a land is would put a different number on the Lands tab from
     the one on the figure that opens it. */
  const tab = loadTab();
  tab.run(`
    dbCardData.set('Darksteel Citadel', { name: 'Darksteel Citadel',
      type_line: 'Artifact Land', cmc: 0, mana_cost: '', colors: [],
      color_identity: [], produced_mana: ['C'] });
    dbCards.push({ card_name: 'Darksteel Citadel', qty: 1, category: 'Lands',
                   board: 'main', position: 91 });
  `);
  tab.render();
  assert.strictEqual(tab.mana().lands.total, tab.answer('dbDeckTotals().lands'),
    'the pass and the readout disagree about how many lands the deck has');
  assert.strictEqual(tab.mana().sources.C, 2,
    'and it is still a source of colourless, which is what produced_mana says');
});

// ── The card nobody has facts for ─────────────────────────────────────────

test('a card whose facts have not arrived is counted in neither, and named', () => {
  /* A deck reported as wanting no white because eleven of its cards are still
     in flight is the one kind of wrong a mana base cannot survive. */
  const tab = loadTab();
  tab.run(`dbCards.push({ card_name: 'Wrath of God', qty: 1, category: 'Removal', board: 'main', position: 92 })`);
  tab.run('dbManaChanged()');
  const { unknown } = tab.mana();
  assert.deepStrictEqual(unknown, ['Wrath of God']);
  /* And said where the comparison is now read, rather than only counted there:
     the check's foot names them, which is how somebody tells a deck that wants
     no white apart from a deck whose white is still in flight. */
  tab.press();
  assert.match(tab.tab(), /no facts yet/, 'the check claimed a comparison it could not make');
  assert.match(tab.tab(), /Wrath of God/, 'and did not say which card it could not read');
});

// ── The comparison ────────────────────────────────────────────────────────
/* One pass, two halves: what a colour costs the deck and what the deck makes
 * of it. Reading one against the other is the Lands tab's job now — the shape
 * of that reading is asserted in test/decklands.test.js — and what is asserted
 * here is that the pass hands it two halves that are actually different
 * questions. */

test('the pass puts the pips of a colour against the sources of it', () => {
  const tab = loadTab();
  const mana = tab.mana();
  about(mana.pips.W, 2.5, 'the white pips');
  assert.strictEqual(mana.sources.W, 6, 'the white sources');
  assert.strictEqual(mana.fromLands.W, 5,
    'and the lands among them, which is the half the check is allowed to count');
});

test('a colour the deck asks for and nothing makes is said, on the line and on the tab', () => {
  /* The one finding this pass is willing to call a fault, because it is the
     only one that is not a matter of taste. The line carries it as a caption
     and the tab behind it as a colour with no sources at all. */
  const tab = loadTab({ deck: [
    { card_name: 'Lightning Bolt', category: 'Removal' },
    { card_name: 'Plains',         category: 'Lands', qty: 4 },
  ], commander: '' });
  assert.deepStrictEqual(tab.mana().unmade, ['R']);
  tab.render();
  assert.match(tab.lands(), /1 colour unmade/, 'the readout said nothing about it');
  tab.press();
  assert.match(tab.tab(), /<strong>0<\/strong> sources/, 'the check found red somewhere');
});

test('a colour the deck makes and never asks for is not a fault', () => {
  /* The panel gave it a row; the check does not, and deliberately — its rule
     is one row per colour the deck's *costs* ask for, so a Tower in a mono-red
     deck is not five findings. What survives the move is the pass's answer:
     white is made, and not being asked for is not a gap. */
  const tab = loadTab({ deck: [
    { card_name: 'Lightning Bolt',  category: 'Removal' },
    { card_name: 'Command Tower',   category: 'Lands' },
  ], commander: '' });
  assert.deepStrictEqual(tab.mana().unmade, [], 'a source with no demand was called a gap');
  assert.strictEqual(tab.mana().sources.W, 1, 'the white the Tower makes went uncounted');
  tab.press();
  assert.ok(!/ms-w/.test(tab.tab()), 'a colour nothing in the deck costs was given a line');
});

test('a colourless deck is a sensible answer rather than a division by nought', () => {
  const tab = loadTab({ deck: [{ card_name: 'Sol Ring', category: 'Ramp' }], commander: '' });
  const mana = tab.mana();
  assert.strictEqual(mana.totalPips, 0);
  assert.strictEqual(mana.sources.C, 1, 'the Sol Ring makes nothing');
  tab.render();
  tab.press();
  assert.ok(!/NaN|Infinity/.test(tab.tab()), 'the tab divided by nought');
  /* And no verdict either. Nothing in the deck costs coloured mana, so the
     check has no colour to have a finding about — a row of nought against
     nought is not one. */
  assert.ok(!/db-sources-row/.test(tab.tab()), 'a deck that asks for nothing was given rows');
});

test('a deck with nothing in it draws no rows rather than six empty ones', () => {
  const tab = loadTab({ deck: [], commander: '' });
  tab.render();
  tab.press();
  assert.ok(!/db-sources-row/.test(tab.tab()), 'an empty deck was drawn colour rows');
});

test('the tab says what it assumes, every time it is read', () => {
  /* A convention that is not written down is a claim. What the table assumes
     about a source is the convention that matters most here, and the check
     carries it — folded under "how this is read", one press away, rather than
     standing over the bars on every deck. See test/decklands.test.js for the
     rest of what it says. */
  const tab = loadTab();
  tab.render();
  tab.press();
  tab.run('dbToggleSourcesFoot()');
  assert.match(tab.tab(), /untapped/i);
  assert.match(tab.tab(), /multiplayer/i);
});

// ── One pass, and none of it on render ────────────────────────────────────

test('the readout and the tab cost one pass between them', () => {
  const tab = loadTab();
  tab.render();
  tab.press();
  assert.strictEqual(tab.passes(), 1, 'the tab counted the deck a second time to draw itself');
});

test('drawing the mat costs none at all', () => {
  const tab = loadTab();
  tab.render();
  const after = tab.passes();
  for (let i = 0; i < 20; i++) tab.run('dbRender()');
  assert.strictEqual(tab.passes(), after, 'the mat recounted the deck’s mana to draw itself');
});

test('going to the tab and back costs none either', () => {
  const tab = loadTab();
  tab.render();
  const after = tab.passes();
  tab.press();
  tab.run(`dbSetLeftTab('search')`);
  tab.press();
  assert.strictEqual(tab.passes(), after);
});

test('a deck that changes is counted again', () => {
  const tab = loadTab();
  tab.render();
  const before = tab.mana().sources.W;
  tab.run(`dbCards.find(c => c.card_name === 'Plains').qty = 12`);
  tab.render();
  assert.strictEqual(tab.mana().sources.W, before + 8, 'the pass went stale');
  assert.strictEqual(tab.passes(), 2, 'once per change, and once only');
});

test('and the tab standing open while cards move is redrawn', () => {
  const tab = loadTab();
  tab.render();
  tab.press();
  tab.run(`dbCards.find(c => c.card_name === 'Plains').qty = 12`);
  tab.render();
  assert.match(tab.tab(), /<strong>13<\/strong> sources/,
    'the open tab went on showing the mana base the deck used to have');
});

// ── The door, and what it does not disturb ────────────────────────────────
/* The lands figure used to raise a third panel out of the readout, which is
 * why the other two put each other away. It opens the drawer now, and the two
 * that are left are still a pair. */

test('the lands figure opens the Lands tab, drawer and all', () => {
  const tab = loadTab();
  tab.render();
  assert.ok(!tab.drawerOpen(), 'the drawer arrived open');
  tab.press();
  assert.strictEqual(tab.leftTab(), 'lands', 'the drawer was left on whichever half it was on');
  assert.ok(tab.drawerOpen(), 'the tab was switched to inside a drawer nobody opened');
});

test('the door raises nothing out of the readout, so the two panels are untouched', () => {
  const tab = loadTab();
  tab.render();
  tab.run('dbToggleOwnedPanel()');
  tab.press();
  assert.notStrictEqual(tab.el('dbOwnedPanel').style.display, 'none',
    'a panel was put away by something that no longer lies over it');
});

test('and the two that are left still put each other away', () => {
  const tab = loadTab();
  tab.render();
  tab.run('dbToggleOwnedPanel()');
  tab.run('dbToggleCheckPanel()');
  assert.strictEqual(tab.el('dbOwnedPanel').style.display, 'none');
  tab.run('dbToggleOwnedPanel()');
  assert.strictEqual(tab.el('dbCheckPanel').style.display, 'none',
    'two panels anchored to the same edge were open at once');
});

// ── The calculator, filled ────────────────────────────────────────────────

test('one press fills every field the calculator used to ask you to count', () => {
  const tab = loadTab();
  tab.run('initLands()');
  tab.run('landsUseDeck()');

  assert.strictEqual(tab.field('landsCount'), 7, 'the lands');
  assert.strictEqual(tab.field('nb-other'), 1, 'the non-basics');
  assert.strictEqual(tab.field('pip-R'), 3, 'the red pips');
  assert.strictEqual(tab.field('pip-B'), 1, 'the commander’s black pip');
  assert.strictEqual(tab.field('pip-C'), 1, 'the colourless one');
  assert.strictEqual(tab.field('pip-W'), 3, 'the white pips, rounded to a whole one');
});

test('an Adventure’s two costs both reach the calculator, because both are cast', () => {
  /* The pass reads a card's costs through dbCostFaces(), which gives an
     Adventure two of them, so Bonecrusher Giant asks for two red pips rather
     than the one its top-level mana_cost carries. The Giant's {2}{R} and
     Stomp's {1}{R} are both red mana somebody had to have.

     Pinned at this boundary rather than at the pass because this is where the
     difference shows to anyone reading the app: the calculator's numbers moved
     when the faces began to be summed, and docs/design/spec-landbase.md had
     said this tab was being left alone. The spec says what happened now, and
     this is the assertion that keeps it deliberate. */
  const tab = loadTab({ deck: [{ card_name: 'Bonecrusher Giant', category: 'Creatures' }], commander: '' });
  tab.run('initLands()');
  tab.run('landsUseDeck()');
  assert.strictEqual(tab.field('pip-R'), 2, 'only one of the Adventure’s two costs reached the calculator');
});

test('a colour the deck does not ask for is left blank, not typed in as nought', () => {
  // Blank is what this tab has always meant by "none of this colour", and only
  // one of the two looks like an answer.
  const tab = loadTab({ deck: [{ card_name: 'Lightning Bolt', category: 'Removal' }], commander: '' });
  tab.run('initLands()');
  tab.run('landsUseDeck()');
  assert.strictEqual(tab.field('pip-R'), 1);
  assert.strictEqual(tab.field('pip-W'), '');
});

test('the deck size it fills in is what the deck is for, not how far along it is', () => {
  /* A half-built Commander deck is still a hundred cards, and the recommended
     land count that comes off this number is advice about the finished thing. */
  const tab = loadTab();
  tab.run('initLands()');
  tab.run('landsUseDeck()');
  assert.strictEqual(tab.run('landsGetDeckSize()'), 100);
  assert.ok(tab.presets[2].classList.contains('active'), 'the hundred-card preset is not pressed');
  assert.ok(!tab.presets[1].classList.contains('active'), 'and the sixty is still pressed');
});

test('and a size with no preset goes in the custom box', () => {
  const tab = loadTab({ commander: '' });   // no commander: a sixty-card deck
  tab.run(`dbCards = dbCards.filter(c => c.board !== 'commander')`);
  tab.run('dbRenderStats()');
  tab.run('initLands()');
  tab.run('landsUseDeck()');
  assert.strictEqual(tab.run('landsGetDeckSize()'), 60);
  assert.ok(tab.presets[1].classList.contains('active'));
});

test('the fill says where it came from, and what it could not read', () => {
  const tab = loadTab();
  tab.run('initLands()');
  tab.run('landsUseDeck()');
  assert.match(tab.note(), /Atraxa/, 'nothing said which deck these numbers are');
  assert.match(tab.note(), /7 lands \(1 non-basic\)/);

  tab.run(`dbCards.push({ card_name: 'Wrath of God', qty: 1, category: 'Removal', board: 'main', position: 92 })`);
  tab.run('dbManaChanged()');
  tab.run('landsUseDeck()');
  assert.match(tab.note(), /1 card had no facts yet and went uncounted/,
    'a fill that came in short said nothing about why');
});

test('the calculator still works with nothing loaded, which is why it is a tab', () => {
  const tab = loadTab();
  tab.run('dbDeck = null');
  tab.run('initLands()');
  assert.strictEqual(tab.el('landsUseDeckBtn').disabled, true);
  assert.match(tab.note(), /Open a deck in the Deck Builder/);

  // And the maths it has always done still runs off what is typed into it.
  tab.el('pip-W').value = '10';
  tab.el('pip-U').value = '10';
  tab.run('landsRecalc()');
  assert.match(tab.el('landsResultRows').innerHTML, /Plains/);
  tab.run('landsUseDeck()');
  assert.strictEqual(tab.el('pip-W').value, '10', 'a fill from no deck emptied the fields');
});

test('resetting the calculator drops what the deck put in it, and says so', () => {
  const tab = loadTab();
  tab.run('initLands()');
  tab.run('landsUseDeck()');
  tab.run('landsReset()');
  assert.strictEqual(tab.field('pip-R'), '');
  assert.ok(!/Filled from/.test(tab.note()),
    'the line went on describing numbers that had been cleared');
});

test('the Lands tab’s one way out fills the calculator from inside the builder', () => {
  /* The calculator was not absorbed and will not be: it is the only thing in
     the app that works with no deck loaded, which is the case the Lands tab
     cannot serve. So the tab keeps one line through to it, and the line
     carries the deck. */
  const tab = loadTab();
  tab.run('initLands()');
  tab.press();
  tab.run('dbOpenInCalculator()');
  assert.strictEqual(tab.field('landsCount'), 7,
    'the way through from the deck did not carry the deck with it');
  assert.ok(!tab.drawerOpen(),
    'the drawer was left open, holding the body’s scroll lock over the tab it sent you to');
});

// ── The frame ─────────────────────────────────────────────────────────────

const MARKUP = read('public/index.html');
const CSS    = read('public/css/tabs.css');
const MODULE = read('public/js/deckview-mana.js');

test('the lands figure is a door to the tab, and the panel it used to raise is gone', () => {
  assert.match(MARKUP, /id="dbStatLands"[^>]*onclick="dbOpenLandsTab\(\)"/,
    'the lands figure does not open the Lands tab');
  /* Nothing anywhere still opens it, which is the other half of "the panel
     goes": a div left in the markup with no door is dead weight, and a
     function left in the module is a second reading of the same numbers
     waiting for somebody to call it. */
  assert.ok(!/dbManaPanel/.test(MARKUP), 'the panel is still in the markup');
  assert.ok(!/ManaPanel/.test(MODULE), 'the panel is still in the module');
  for (const file of ['deckview-owned.js', 'deckview-legality.js', 'deckview-render.js']) {
    assert.ok(!/ManaPanel/.test(read(`public/js/${file}`)),
      `js/${file} still reaches for a panel that is gone`);
  }
});

test('the lands figure is the door, because the colour row is not there on a phone', () => {
  assert.match(CSS, /#dbStatColors \{ display: none; \}/,
    'the colour row is on the readout at every width now, which changes this argument');
  assert.ok(!/#dbStatLands \{ display: none/.test(CSS), 'the way to the tab is hidden on a phone');
});

test('the calculator carries the control, and the module is served', () => {
  assert.match(MARKUP, /id="landsUseDeckBtn"[^>]*onclick="landsUseDeck\(\)"/);
  /* Off the script tags alone: these modules name each other in comments, and
     a comment is not a load order. */
  const scripts = [...MARKUP.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.ok(scripts.includes('deckview-mana.js'), 'the module is not served at all');
  assert.ok(scripts.indexOf('deckview-mana.js') > scripts.indexOf('deckview-totals.js'),
    'the mana module is loaded before the totals it asks what a land is');
});

test('the readout’s caption keeps its rule, and the panel’s rules went with it', () => {
  assert.match(CSS, /\.db-mana-gap \{/, 'the unmade-colours caption on the readout has no rule');
  assert.ok(!/\.db-mana-panel|\.db-mana-row|\.db-mana-bar/.test(CSS),
    'the stylesheet still dresses a panel nothing draws');
});

test('the tab’s two quiet controls are thumb targets on a phone', () => {
  /* Both are lines of text by design on a desktop — the way into the per-card
     list, and the way out to the calculator — which is exactly the kind that
     arrives on a phone too short to hit. */
  assert.match(CSS, /\.db-sources-more\s+\{ min-height: 44px; \}/);
  assert.match(CSS, /\.db-lands-calc-link \{ min-height: 44px; \}/);
});

test('a colour is drawn in the theme’s mana palette, never in hex', () => {
  assert.match(MODULE, /var\(--mc-w\)/, 'white is not on the mana palette');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(MODULE), 'a colour was written into the module as hex');
});

test('the phone measurement follows the controls to the tab they moved to', () => {
  /* The panel had a view of its own because it was closed when the deck tab
     arrived, so its ✕ and its way through to the calculator would otherwise
     pass by not being on screen. Both went to the Lands tab, which has a view
     of its own for the same reason — and there is nothing left to measure
     where the panel was. */
  const measure = read('scripts/measure-mobile.js');
  assert.ok(!/'deckview-mana'/.test(measure), 'a view still opens a panel that is gone');
  assert.match(measure, /'deckview-lands':\s*'deckview'/, 'the tab it moved to has no view');
});

