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
 *   the panel   the readout's lands figure and the panel it opens, drawn
 *   the fill    js/lands.js's fields, written from the deck
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
                      'deckview-boards.js', 'deckview-core.js', 'deckview-render.js',
                      'deckview-edit.js', 'deckview-panels.js', 'deckview-history.js',
                      'deckview-owned.js', 'deckview-totals.js', 'deckview-legality.js',
                      'deckview-mana.js']) {
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
    /** The panel, opened. */
    open()  { run('dbToggleManaPanel()'); return el('dbManaPanel').innerHTML; },
    panel:  () => el('dbManaPanel').innerHTML,
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
     deciding what a land is would put a different number in the panel from the
     one on the line that opens it. */
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
    'the panel and the readout disagree about how many lands the deck has');
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
  assert.match(tab.open(), /no facts yet/, 'the panel claimed a comparison it could not make');
  assert.match(tab.panel(), /Wrath of God/, 'and did not say which card it could not read');
});

// ── The comparison ────────────────────────────────────────────────────────

test('the panel puts the pips of a colour against the sources of it', () => {
  const tab = loadTab();
  tab.render();
  const html = tab.open();
  assert.match(html, /<strong>2\.5<\/strong> pips/, 'the white pips are not on the panel');
  assert.match(html, /<strong>6<\/strong> sources/, 'nor the white sources');
  assert.match(html, /% of pips · \d+% of sources/, 'the two shares are not compared');
});

test('a colour the deck asks for and nothing makes is said, on the panel and on the line', () => {
  /* The one finding this panel is willing to call a fault, because it is the
     only one that is not a matter of taste. */
  const tab = loadTab({ deck: [
    { card_name: 'Lightning Bolt', category: 'Removal' },
    { card_name: 'Plains',         category: 'Lands', qty: 4 },
  ], commander: '' });
  assert.deepStrictEqual(tab.mana().unmade, ['R']);
  tab.render();
  assert.match(tab.lands(), /1 colour unmade/, 'the readout said nothing about it');
  assert.match(tab.open(), /nothing makes it/);
});

test('a colour the deck makes and never asks for is not a fault, and gets its row', () => {
  const tab = loadTab({ deck: [
    { card_name: 'Lightning Bolt',  category: 'Removal' },
    { card_name: 'Command Tower',   category: 'Lands' },
  ], commander: '' });
  assert.deepStrictEqual(tab.mana().unmade, [], 'a source with no demand was called a gap');
  assert.match(tab.open(), /ms-w/, 'the white the Tower makes is not on the panel');
});

test('a colourless deck is a sensible answer rather than a division by nought', () => {
  const tab = loadTab({ deck: [{ card_name: 'Sol Ring', category: 'Ramp' }], commander: '' });
  const mana = tab.mana();
  assert.strictEqual(mana.totalPips, 0);
  tab.render();
  const html = tab.open();
  assert.ok(!/NaN|Infinity/.test(html), 'the panel divided by nought');
  assert.match(html, /<strong>1<\/strong> sources/, 'the Sol Ring is not on it');
});

test('a deck with nothing in it says so rather than drawing six empty rows', () => {
  const tab = loadTab({ deck: [], commander: '' });
  tab.render();
  assert.match(tab.open(), /Nothing in this deck costs or makes coloured mana/);
});

test('the panel says how it counted, every time it is read', () => {
  /* A convention that is not written down is a claim. The halves and the
     double-counted dual are both conventions. */
  const tab = loadTab();
  const html = tab.open();
  assert.match(html, /hybrid symbol is half a pip/);
  assert.match(html, /shares are of source slots/);
  assert.match(html, /commander included/);
});

// ── One pass, and none of it on render ────────────────────────────────────

test('the readout and the panel cost one pass between them', () => {
  const tab = loadTab();
  tab.render();
  tab.open();
  assert.strictEqual(tab.passes(), 1, 'the panel counted the deck a second time to draw itself');
});

test('drawing the mat costs none at all', () => {
  const tab = loadTab();
  tab.render();
  const after = tab.passes();
  for (let i = 0; i < 20; i++) tab.run('dbRender()');
  assert.strictEqual(tab.passes(), after, 'the mat recounted the deck’s mana to draw itself');
});

test('opening and closing the panel costs none either', () => {
  const tab = loadTab();
  tab.render();
  const after = tab.passes();
  tab.run('dbToggleManaPanel()');
  tab.run('dbToggleManaPanel()');
  tab.run('dbToggleManaPanel()');
  assert.strictEqual(tab.passes(), after);
});

test('a deck that changes is counted again', () => {
  const tab = loadTab();
  tab.render();
  const before = tab.mana().sources.W;
  tab.run(`dbCards.find(c => c.card_name === 'Plains').qty = 12`);
  tab.render();
  assert.strictEqual(tab.mana().sources.W, before + 8, 'the panel went stale');
  assert.strictEqual(tab.passes(), 2, 'once per change, and once only');
});

test('and a panel standing open while cards move is redrawn', () => {
  const tab = loadTab();
  tab.render();
  tab.open();
  tab.run(`dbCards.find(c => c.card_name === 'Plains').qty = 12`);
  tab.render();
  assert.match(tab.panel(), /<strong>14<\/strong> sources/,
    'the open panel went on showing the mana base the deck used to have');
});

// ── One of the three panels, and only one ─────────────────────────────────

test('opening this panel puts the other two away', () => {
  const tab = loadTab();
  tab.render();
  tab.run('dbToggleOwnedPanel()');
  tab.run('dbToggleManaPanel()');
  assert.strictEqual(tab.el('dbOwnedPanel').style.display, 'none');
  tab.run('dbToggleCheckPanel()');
  assert.strictEqual(tab.el('dbManaPanel').style.display, 'none',
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

test('the panel’s one action fills the calculator from inside the builder', () => {
  const tab = loadTab();
  tab.run('initLands()');
  tab.run('dbOpenInCalculator()');
  assert.strictEqual(tab.field('landsCount'), 7,
    'the way through from the deck did not carry the deck with it');
});

// ── The frame ─────────────────────────────────────────────────────────────

const MARKUP = read('public/index.html');
const CSS    = read('public/css/tabs.css');
const MODULE = read('public/js/deckview-mana.js');

test('the panel rises out of the readout, off the lands figure', () => {
  const bar = MARKUP.match(/<div class="db-stats-bar[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(bar, 'the readout is gone');
  assert.match(bar[0], /id="dbManaPanel"/, 'the panel is not a child of the line it opens from');
  assert.match(bar[0], /id="dbStatLands"[^>]*aria-controls="dbManaPanel"/,
    'the lands figure does not say what it opens');
});

test('the lands figure is the door, because the colour row is not there on a phone', () => {
  assert.match(CSS, /#dbStatColors \{ display: none; \}/,
    'the colour row is on the readout at every width now, which changes this argument');
  assert.ok(!/#dbStatLands \{ display: none/.test(CSS), 'the way into the panel is hidden on a phone');
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

test('the panel has a stylesheet, and the phone has its targets', () => {
  assert.match(CSS, /\.db-mana-panel \{/);
  assert.match(CSS, /\.db-mana-bar \{/, 'the comparison bars have no rule');
  assert.match(CSS, /\.db-mana-close \{ min-width: 44px; min-height: 44px; \}/);
  assert.match(CSS, /\.db-mana-calc\s+\{ min-height: 44px; \}/);
});

test('a colour is drawn in the theme’s mana palette, never in hex', () => {
  assert.match(MODULE, /var\(--mc-w\)/, 'white is not on the mana palette');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(MODULE), 'a colour was written into the module as hex');
});

test('the phone measurement knows about the panel', () => {
  // The panel is closed when the tab arrives, so without its own view its ✕ and
  // its way through to the calculator would pass by not being on screen.
  assert.match(read('scripts/measure-mobile.js'), /'deckview-mana':\s*'deckview'/);
});
