/* The Deck Builder's front door, after opening moved to the Decks tab.
 *
 * The tab used to open with a `<select>` of every deck the group owns — a
 * chooser standing in front of a mat with nothing on it. Choosing among many
 * decks belongs with the gallery of decks, so the empty mat becomes a
 * signpost: a line of text and a button that switches to the Decks tab. New
 * deck stays, because creating one blank deck belongs where you build it.
 *
 * What survives of the old dropdown is a switcher, and only once a deck is
 * open: your own built decks, to step between without leaving the tab.
 *
 * Two layers, both against the shipped files:
 *
 *   the signpost   the markup, read as text — what the empty mat says, what it
 *                  offers, and that the picker is not on it
 *   the switcher   js/deckview-core.js in a vm sandbox: what the control is
 *                  populated with, and that a tile pressed on the Decks tab
 *                  opens its deck whether or not the switcher would list it
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const MARKUP = read('public/index.html');

// The mat as it ships empty — the block js/deckview-core.js takes _dbEmptyMat
// from at boot, so this is also what putting a deck down lands on.
const EMPTY_MAT = MARKUP.match(/<div id="dbDeckContent"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)[0];

// ── The signpost ──────────────────────────────────────────────────────────

test('the empty mat sends you to the Decks tab, and does not choose for you', () => {
  assert.match(EMPTY_MAT, /Open a deck from the Decks tab/,
    'the empty mat does not say where decks are opened');
  /* The tab is named Decks and its pane is still #tab-players — the rename was
   * of the label, not of the id every other caller of setTab already uses. */
  assert.match(EMPTY_MAT, /<button[^>]*onclick="setTab\('players'\)"/,
    'nothing on the empty mat takes you to the Decks tab');
  assert.match(MARKUP, /id="tab-btn-players"[\s\S]*?<span class="tab-btn-label">Decks<\/span>/,
    'the button goes somewhere that is not called Decks');
});

test('the one deck you can still start from here is a new one', () => {
  assert.match(EMPTY_MAT, /onclick="dbShowNewDeck\(\)"/,
    'New deck left the empty mat with the chooser');
  assert.ok(!/<select/.test(EMPTY_MAT), 'the open-existing dropdown is still on the empty mat');
});

test('the picker is not on a tab with no deck at all', () => {
  // The strip's select survives as a switcher, so it goes behind the same
  // attribute as every other control that needs a deck to act on. Which strip
  // it is on is test/deckframe.test.js's question, not this one's.
  const sel = MARKUP.match(/<select id="dbDeckSel"[^>]*>/)[0];
  assert.match(sel, /class="[^"]*db-when-deck/,
    'the empty tab still opens with a chooser in front of the mat');
});

// ── The switcher ──────────────────────────────────────────────────────────
/* Tim has two built decks and a draft — a name and a link he has never opened
 * — and Anna has one built deck of her own. Between them: what belongs on the
 * switcher, what does not because it was never built, and what does not
 * because it is somebody else's. */
const PLAYERS = [
  { id: 'p-tim', name: 'Tim', decks: [
    { id: 'd-krenko', name: 'Krenko',  commander: 'Krenko, Mob Boss' },
    { id: 'd-tymna',  name: 'Tymna',   commander: '' },
    { id: 'd-draft',  name: 'Someday', commander: '' },
  ] },
  { id: 'p-anna', name: 'Anna', decks: [
    { id: 'd-atraxa', name: 'Atraxa', commander: 'Atraxa, Praetors’ Voice' },
  ] },
];

const COUNTS = { 'd-krenko': 100, 'd-tymna': 99, 'd-atraxa': 99 };  // d-draft has no rows

/** A `<select>` as far as this code can tell one apart: options are appended
 *  and cleared, and a value naming no option of its own does not stick — which
 *  is what makes "the control shows the open deck" a real assertion. */
function makeSelect() {
  return {
    options: [], _value: '',
    set innerHTML(html) { if (!html) this.options.length = 0; },
    get innerHTML() { return ''; },
    set value(v) { this._value = this.options.some(o => o.value === v) ? v : ''; },
    get value() { return this._value; },
    appendChild(opt) { this.options.push(opt); },
  };
}

/** The strip's control, written by the shipped js/deckview-core.js over a deck
 *  that is open (or none). `me` is what myPlayerId() answers — null is a
 *  deployment that cannot say who you are. */
function loadStrip({ players = PLAYERS, deckCardCounts = COUNTS, me = 'p-tim', open = null } = {}) {
  const sel   = makeSelect();
  const owner = makeSelect();
  const els   = { dbDeckSel: sel, dbNewDeckPlayer: owner };

  const sandbox = {
    document: {
      addEventListener() {}, querySelectorAll: () => [],
      createElement: () => ({ value: '', textContent: '' }),
      getElementById: id => els[id] || null,
      body: { appendChild() {}, style: {} },
    },
    window: { addEventListener() {}, innerWidth: 1200 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    state: { players, deckCardCounts, collections: [] },
    myPlayerId: () => me,
    currentUser: { username: 'tim', role: 'player', playerId: me },
    isMyPlayer: id => id === me,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/deckview-core.js'), sandbox);
  const run = expr => vm.runInContext(expr, sandbox);
  if (open) run(`dbDeck = ${JSON.stringify(open)}`);
  run('dbPopulateDeckSel()');
  return { sel, run, listed: sel.options.map(o => o.textContent), values: sel.options.map(o => o.value) };
}

const OPEN_KRENKO = { id: 'd-krenko', playerId: 'p-tim', name: 'Krenko', commander: 'Krenko, Mob Boss' };

test('the switcher is your built decks, and says which one you are on', () => {
  const strip = loadStrip({ open: OPEN_KRENKO });
  assert.deepStrictEqual(strip.listed,
    ['— Close deck —', 'Krenko (Krenko, Mob Boss)', 'Tymna'],
    'the switcher is not the decks you have built');
  assert.strictEqual(strip.sel.value, 'p-tim|d-krenko',
    'the control does not show the deck the mat is showing');
});

test('a deck you opened from somebody else’s section is on it, named as theirs', () => {
  // Build on a tile in the Everyone view opens a deck the switcher's own rule
  // would leave off. A control that cannot name the open deck reads as the
  // wrong deck's, so it is listed — and prefixed, because it is not yours.
  const strip = loadStrip({ open: { id: 'd-atraxa', playerId: 'p-anna', name: 'Atraxa', commander: 'Atraxa, Praetors’ Voice' } });
  assert.deepStrictEqual(strip.listed,
    ['— Close deck —', 'Krenko (Krenko, Mob Boss)', 'Tymna', 'Anna · Atraxa (Atraxa, Praetors’ Voice)']);
  assert.strictEqual(strip.sel.value, 'p-anna|d-atraxa');
});

test('a deck made a moment ago is on it before it has saved a card', () => {
  // + New deck lands you on a deck with no deck_cards rows, so "built" has not
  // caught up with it yet. It is what the mat is showing all the same.
  const strip = loadStrip({ open: { id: 'd-draft', playerId: 'p-tim', name: 'Someday', commander: '' } });
  assert.deepStrictEqual(strip.listed,
    ['— Close deck —', 'Krenko (Krenko, Mob Boss)', 'Tymna', 'Someday']);
  assert.strictEqual(strip.sel.value, 'p-tim|d-draft');
});

test('with nobody to be, it is every built deck, each said whose it is', () => {
  // Open mode with no remembered name: myPlayerId() is null, so there is no
  // "yours" to narrow to and no name to leave implicit either.
  const strip = loadStrip({ me: null, open: OPEN_KRENKO });
  assert.deepStrictEqual(strip.listed,
    ['— Close deck —', 'Tim · Krenko (Krenko, Mob Boss)', 'Tim · Tymna', 'Anna · Atraxa (Atraxa, Praetors’ Voice)']);
});

test('with no deck open the control is on none of them', () => {
  const strip = loadStrip();
  assert.deepStrictEqual(strip.listed, ['— Close deck —', 'Krenko (Krenko, Mob Boss)', 'Tymna']);
  assert.strictEqual(strip.sel.value, '', 'a tab with no deck says it is on one');
});

/* The whole tab, as test/deckboards.test.js loads it: every deck-builder
 *  module in one sandbox, with the network and the drawing surface stubbed, so
 *  what opening a deck does to the strip is asserted through the real open. */
function loadTab({ players = PLAYERS, deckCardCounts = COUNTS, me = 'p-tim' } = {}) {
  const sel   = makeSelect();
  const store = new Map();
  const mat   = { innerHTML: '', classList: { toggle() {} }, addEventListener() {} };
  const els   = {};
  const el = id => (els[id] ||= {
    innerHTML: '', textContent: '', title: '', value: '', style: {},
    setAttribute(k, v) { (this.attrs ||= {})[k] = v; },
    getAttribute(k) { return (this.attrs ||= {})[k]; },
    addEventListener() {}, appendChild() {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  });

  const sandbox = {
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    document: {
      addEventListener() {}, querySelectorAll: () => [],
      createElement: () => ({ value: '', textContent: '', style: {}, appendChild() {} }),
      getElementById: id => (id === 'dbDeckSel' ? sel : id === 'dbDeckContent' ? mat : el(id)),
      body: { appendChild() {}, style: {} },
      scrollingElement: { scrollTop: 0 },
      documentElement:  { scrollTop: 0 },
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    state: { players, deckCardCounts, collections: [] },
    myPlayerId: () => me,
    currentUser: { username: 'tim', role: 'player', playerId: me },
    isMyPlayer: id => id === me,
    confirm: () => true, alert: () => {}, clearTimeout() {},
    setTimeout: fn => 1,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ cards: [], categories: [] }) }),
    esc: s => String(s), jsAttr: s => String(s),
    renderMana: () => '', renderPrice: () => '', sfCardOwnership: () => '',
    colOwner: () => null, playerColor: () => '',
    scryfallMetaCache: new Map(), openCardByName() {},
    animateCardMove: (_el, paint) => paint(),
    console,
  };
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  for (const file of ['sortui.js', 'cardstack.js', 'deckview-boards.js',
                      'deckview-core.js', 'deckview-render.js', 'deckview-edit.js',
                      'deckview-panels.js', 'deckview-history.js', 'deckview-owned.js',
                      'deckview-totals.js', 'deckview-legality.js', 'deckview-mana.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run = expr => vm.runInContext(expr, sandbox);
  return { sel, run, listed: () => sel.options.map(o => o.textContent) };
}

test('opening a deck writes the control around the deck it opened', async () => {
  const tab = loadTab();
  await tab.run(`dbSelectDeck('p-anna|d-atraxa')`);
  assert.strictEqual(tab.sel.value, 'p-anna|d-atraxa',
    'the strip does not say which deck the mat is showing');
  assert.ok(tab.listed().includes('Anna · Atraxa (Atraxa, Praetors’ Voice)'),
    'the open deck is not even on the list it is meant to be selected in');
});

test('closing the deck puts the control back to nothing', async () => {
  const tab = loadTab();
  await tab.run(`dbSelectDeck('p-tim|d-krenko')`);
  await tab.run(`dbSelectDeck('')`);
  assert.strictEqual(tab.sel.value, '', 'the strip still names a deck that is not on the mat');
});

// ── The way in from the Decks tab ─────────────────────────────────────────

/** js/players.js's route into the Builder, with the tab switch and the open
 *  itself recorded rather than performed. */
function loadDecksTab() {
  const opened = [];
  const tabs   = [];
  const sandbox = {
    /* js/players.js hooks the CSV file input as it loads, so the sandbox has
     * to hand it something rather than nothing. */
    document: { addEventListener() {}, querySelectorAll: () => [],
                getElementById: () => ({ addEventListener() {}, value: '', style: {} }),
                body: { appendChild() {}, style: {} } },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    state: { players: PLAYERS, deckCardCounts: COUNTS, collections: [] },
    setTab: tab => tabs.push(tab),
    dbSelectDeck: value => { opened.push(value); },
    myPlayerId: () => 'p-tim', isMyPlayer: id => id === 'p-tim',
    currentUser: { username: 'tim', role: 'player', playerId: 'p-tim' },
    esc: s => String(s), jsAttr: s => String(s), console,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/players.js'), sandbox);
  return { opened, tabs, run: expr => vm.runInContext(expr, sandbox) };
}

test('Build on a tile opens that deck, not whatever the switcher would list', () => {
  /* The route in used to go through the picker's options, and would silently
   * do nothing for a deck the picker did not hold — which, now that the picker
   * is your own built decks, is every other player's tile on the Everyone
   * view and every draft's Build. */
  const decks = loadDecksTab();
  decks.run(`openInDeckView('p-anna', 'd-atraxa')`);
  assert.deepStrictEqual(decks.tabs, ['deckview']);
  assert.deepStrictEqual(decks.opened, ['p-anna|d-atraxa'],
    'pressing Build on somebody else’s deck lands you on an empty mat');
});

test('a deck you built this session is on the switcher before the next poll', async () => {
  /* The built signal comes from the server, and the client's copy of it is
   * only as fresh as the last refreshState — half a minute away. A deck made,
   * filled and closed inside that window would drop off the list it had just
   * earned a place on. */
  const tab = loadTab();
  await tab.run(`dbSelectDeck('p-tim|d-draft')`);
  tab.run(`dbCards = [{ card_name: 'Sol Ring', qty: 1, board: 'main', category: 'Ramp' }]`);
  await tab.run('_dbSaveNow()');
  await tab.run(`dbSelectDeck('')`);
  assert.ok(tab.listed().includes('Someday'),
    'the deck you just filled with cards fell off the switcher when you closed it');
});
