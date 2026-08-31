/* Optimizing a deck's printings.
 *
 * A deck can already say which printing of a card it runs and the readout
 * costs the deck from those printings, but choosing one is a per-card act —
 * so on a ninety-nine card deck nobody does it, and the total is an accident
 * rather than a decision. This is the one action that walks the whole deck.
 *
 * What is asserted here is the decision and its effect: given this deck, this
 * shelf, these printings and this mode, what does the run propose, and what
 * does the deck look like once it is applied. The admissibility rule and the
 * three comparators are internal and no test names them, so the modes can be
 * rewritten without touching a line of this file.
 *
 * Two layers, both against the shipped files:
 *
 *   the decision  dbOptimizePlan() in a vm sandbox, handed fixtures — the one
 *                 pure function the whole feature is, fetching nothing and
 *                 reading no globals
 *   the run       the tab loaded whole in that sandbox, as
 *                 test/deckowned.test.js loads it: the requests the fetch
 *                 really makes, the apply, and the deck's own price after it
 *
 * The three snapshot reasons are server behaviour and are asserted beside the
 * rest of it in test/deckhistory.test.js.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── The printings there are ───────────────────────────────────────────────
/* Scryfall-shaped, because that is what the run is handed: a printing carries
 * its finishes, a price per finish, the games it was printed for, and the four
 * flags and the date the pool is decided by. */

const printing = (over = {}) => ({
  id: 'x', set: 'xxx', set_name: 'A Set', collector_number: '1',
  released_at: '2021-04-23', games: ['paper', 'mtgo'],
  finishes: ['nonfoil'], prices: {},
  image_uris: { normal: `https://cards.example/${over.id || 'x'}.jpg` },
  ...over,
});

const PRINTS = {
  /* Three editions and two finishes between them, arranged so that cheapest
     and dearest cannot both be won by the same tile: the LTR foil is the
     cheapest thing here and the C21 ordinary copy the dearest, so a run that
     ignored the finish would get one of the two wrong. Revised is the pool's
     own test — half a euro, and older than the bound. */
  'Sol Ring': [
    printing({ id: 'sr-c21', set: 'c21', set_name: 'Commander 2021', collector_number: '263',
               released_at: '2021-04-23', finishes: ['nonfoil', 'foil'],
               prices: { eur: '6.00', eur_foil: '5.00' } }),
    printing({ id: 'sr-3ed', set: '3ed', set_name: 'Revised Edition', collector_number: '270',
               released_at: '1994-04-01', prices: { eur: '0.50' } }),
    printing({ id: 'sr-ltr', set: 'ltr', set_name: 'Tales of Middle-earth', collector_number: '284',
               released_at: '2023-06-23', finishes: ['nonfoil', 'foil'],
               prices: { eur: '3.00', eur_foil: '1.50' } }),
  ],
  'Cultivate': [
    printing({ id: 'cu-c21', set: 'c21', set_name: 'Commander 2021', collector_number: '188',
               prices: { eur: '1.00' } }),
    printing({ id: 'cu-m21', set: 'm21', set_name: 'Core Set 2021', collector_number: '177',
               released_at: '2020-07-03', prices: { eur: '0.30' } }),
  ],
  /* Admissible in every other way and quoted by nobody. Unknown is not free,
     so neither of these can win anything. */
  'Krenko, Mob Boss': [
    printing({ id: 'kr-m13', set: 'm13', set_name: 'Magic 2013', collector_number: '140',
               released_at: '2012-07-13', prices: { eur: null } }),
    printing({ id: 'kr-cmm', set: 'cmm', set_name: 'Commander Masters', collector_number: '175',
               released_at: '2023-08-04', prices: { eur: null } }),
  ],
  /* One printing, priced, and out of the pool twice over — Reserved List and
     five years older than the bound. */
  'Mox Diamond': [
    printing({ id: 'mo-sth', set: 'sth', set_name: 'Stronghold', collector_number: '138',
               released_at: '1998-03-02', reserved: true, prices: { eur: '400.00' } }),
  ],
  'Forest': [
    printing({ id: 'fo-unf', set: 'unf', set_name: 'Unfinity', collector_number: '239',
               prices: { eur: '0.10' } }),
    printing({ id: 'fo-jmp', set: 'jmp', set_name: 'Jumpstart', collector_number: '61',
               prices: { eur: '0.05' } }),
  ],
};

// ── What the app knows about the cards ────────────────────────────────────
/* The local oracle cache, which for an open deck already carries the type line
 * and the per-card printings URL for every name in it — so the run needs no
 * lookup pass of its own. Each card also carries the printing Scryfall hands
 * back for the name, which is the one a deck that has chosen nothing runs. */

const CARDS = {
  'Sol Ring': { name: 'Sol Ring', type_line: 'Artifact', cmc: 1, color_identity: [],
                id: 'sr-ltr', set: 'ltr', set_name: 'Tales of Middle-earth', collector_number: '284',
                prices: { eur: '3.00' }, prints_search_uri: 'https://api.scryfall.com/cards/search?q=sol' },
  'Cultivate': { name: 'Cultivate', type_line: 'Sorcery', cmc: 3, color_identity: ['G'],
                 id: 'cu-c21', set: 'c21', set_name: 'Commander 2021', collector_number: '188',
                 prices: { eur: '1.00' }, prints_search_uri: 'https://api.scryfall.com/cards/search?q=cultivate' },
  'Krenko, Mob Boss': { name: 'Krenko, Mob Boss', type_line: 'Legendary Creature — Goblin',
                        cmc: 4, color_identity: ['R'],
                        id: 'kr-cmm', set: 'cmm', set_name: 'Commander Masters', collector_number: '175',
                        prices: { eur: null }, prints_search_uri: 'https://api.scryfall.com/cards/search?q=krenko' },
  'Mox Diamond': { name: 'Mox Diamond', type_line: 'Artifact', cmc: 0, color_identity: [],
                   id: 'mo-sth', set: 'sth', set_name: 'Stronghold', collector_number: '138',
                   prices: { eur: '400.00' }, prints_search_uri: 'https://api.scryfall.com/cards/search?q=mox' },
  'Forest': { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, color_identity: ['G'],
              id: 'fo-unf', set: 'unf', set_name: 'Unfinity', collector_number: '239',
              prices: { eur: '0.10' }, prints_search_uri: 'https://api.scryfall.com/cards/search?q=forest' },
};

/* Six rows, one per interesting answer: two cards the run can move, one it
 * cannot price, one with no admissible printing, a basic, and a name the app
 * has never heard of. */
const DECK = [
  { card_name: 'Sol Ring',         board: 'main', category: 'Ramp',      qty: 1 },
  { card_name: 'Cultivate',        board: 'main', category: 'Ramp',      qty: 1 },
  { card_name: 'Krenko, Mob Boss', board: 'main', category: 'Creatures', qty: 1 },
  { card_name: 'Mox Diamond',      board: 'main', category: 'Ramp',      qty: 1 },
  { card_name: 'Forest',           board: 'main', category: 'Lands',     qty: 8 },
  { card_name: 'Ghost Card',       board: 'main', category: 'Ramp',      qty: 1 },
];

/** A held printing as the shelf hands one over — the rollup's shape, which has
 *  no language and no condition on it and may name no printing at all. */
const held = (over = {}) => ({ qty: 1, ...over });

// ── The decision ──────────────────────────────────────────────────────────
/* One function, handed everything it reads. Loaded beside the modules whose
 * vocabulary it is written in — what a printing's identity is, what a snapshot
 * of one looks like — and beside nothing else. */

function loadPlanner() {
  const sandbox = {
    console,
    // Enough of a browser for the modules to finish loading. None of it is
    // reached: the plan is a function of its arguments.
    window: { innerWidth: 1200, addEventListener() {} },
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    esc: s => String(s), jsAttr: s => String(s),
  };
  vm.createContext(sandbox);
  for (const file of ['state.js', 'card.js', 'deckview-boards.js', 'deckview-optimize.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  return sandbox;
}

const _planner = loadPlanner();

/** The plan for a deck, a shelf and a mode. Everything has a default, so a
 *  test says only the thing it is about. */
function plan({ mode = 'cheapest', cards = DECK, cardData = CARDS,
                prints = PRINTS, owned = {} } = {}) {
  const expr = `dbOptimizePlan({
    cards:    ${JSON.stringify(cards)},
    cardData: new Map(Object.entries(${JSON.stringify(cardData)})),
    prints:   new Map(Object.entries(${JSON.stringify(prints)})),
    owned:    new Map(Object.entries(${JSON.stringify(owned)})),
    mode:     ${JSON.stringify(mode)},
    today:    '2026-08-31',
  })`;
  return JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, _planner));
}

/** What the plan proposes, as name → the printing it would run, said shortly. */
const proposed = p => Object.fromEntries(
  p.picks.map(k => [k.name, `${k.to.id}${k.to.finish ? ` ${k.to.finish}` : ''}`]));

test('cheapest takes the least expensive printing-and-finish pair there is', () => {
  // Sol Ring's foil at €1.50 beats its own ordinary copy at €3.00 and every
  // other edition; Cultivate drops from Commander 2021 to Core Set 2021.
  assert.deepStrictEqual(proposed(plan({ mode: 'cheapest' })),
    { 'Sol Ring': 'sr-ltr foil', 'Cultivate': 'cu-m21' });
});

test('and dearest the most expensive one', () => {
  // The C21 ordinary copy at €6.00, not the C21 foil at €5.00 beside it — a
  // run that treated a printing as one candidate would take the wrong tile.
  assert.deepStrictEqual(proposed(plan({ mode: 'dearest' })),
    { 'Sol Ring': 'sr-c21' });
});

test('a foil wins when the foil is cheaper, and never when it is dearer', () => {
  const cheap = plan({ mode: 'cheapest' }).picks.find(p => p.name === 'Sol Ring');
  assert.strictEqual(cheap.to.finish, 'foil', 'the cheaper pair was the foil and it lost');
  assert.strictEqual(cheap.foil, true, 'a run that swaps a card to foil must say so');
  const dear = plan({ mode: 'dearest' }).picks.find(p => p.name === 'Sol Ring');
  assert.strictEqual(dear.to.finish, undefined, 'the dearer pair was not the foil');
  assert.strictEqual(dear.foil, false);
});

test('two printings at the same price settle the same way every time', () => {
  /* A run proposing one thing on Monday and another on Tuesday over an
     unchanged deck is a bug nobody can reproduce on purpose. The order the
     pages happened to arrive in is a property of the network; the Scryfall id
     is a property of the card. */
  const tie = {
    'Cultivate': [
      printing({ id: 'cu-zzz', set: 'zzz', collector_number: '1', prices: { eur: '0.30' } }),
      printing({ id: 'cu-aaa', set: 'aaa', collector_number: '2', prices: { eur: '0.30' } }),
    ],
  };
  const forwards  = plan({ mode: 'cheapest', prints: { ...PRINTS, ...tie } });
  const backwards = plan({ mode: 'cheapest',
    prints: { ...PRINTS, Cultivate: [...tie.Cultivate].reverse() } });
  assert.strictEqual(proposed(forwards)['Cultivate'], 'cu-aaa');
  assert.strictEqual(proposed(backwards)['Cultivate'], 'cu-aaa');
});

test('a printing nobody has quoted can never win', () => {
  // Both of Krenko's are admissible in every other way and neither has a
  // price. Unknown is not free, so cheapest cannot be won by one.
  for (const mode of ['cheapest', 'dearest']) {
    const p = plan({ mode });
    assert.ok(!p.picks.some(k => k.name === 'Krenko, Mob Boss'),
      `${mode} priced a card nobody is selling`);
    assert.strictEqual(p.untouched.unpriced, 1);
  }
});

test('and a printing outside the pool cannot either', () => {
  // Half a euro would win cheapest outright, and Revised is nineteen years
  // older than the bound. Mox Diamond has nothing but a Reserved List printing
  // from before it, so it has no admissible printing at all.
  const p = plan({ mode: 'cheapest' });
  assert.ok(!Object.values(proposed(p)).includes('sr-3ed'), 'the pool did not bind');
  assert.strictEqual(p.untouched.inadmissible, 1, 'Mox Diamond had a printing to buy');
});

test('a card with no admissible priced candidate keeps the printing it runs', () => {
  // The rule the whole feature is bounded by: a run must never clear a choice.
  const chosen = { id: 'kr-m13', set: 'm13', set_name: 'Magic 2013',
                   collector_number: '140', chosen_at: '2026-01-01' };
  const deck = DECK.map(c =>
    c.card_name === 'Krenko, Mob Boss' ? { ...c, printing: chosen } : c);
  const p = plan({ mode: 'cheapest', cards: deck });
  assert.ok(!p.picks.some(k => k.name === 'Krenko, Mob Boss'));
});

test('a card already running the winner is left alone and counted', () => {
  // Cultivate's dearest is the printing it already runs. Nothing to change is
  // an answer, and it is not the same answer as "there was nothing to pick".
  const p = plan({ mode: 'dearest' });
  assert.strictEqual(p.untouched.optimal, 1);
});

test('basic lands are excluded from every mode', () => {
  for (const mode of ['cheapest', 'dearest', 'owned']) {
    const p = plan({ mode });
    assert.ok(!p.picks.some(k => k.name === 'Forest'),
      `${mode} churned a row of Forests chosen for how they look`);
    assert.strictEqual(p.untouched.basic, 1, 'counted as cards, not as copies');
  }
});

test('a card the app has no data for is skipped and counted', () => {
  const p = plan({ mode: 'cheapest' });
  assert.strictEqual(p.untouched.nodata, 1);
  assert.ok(p.picks.length, 'one unknown name failed the whole run');
});

test('the pick carries the price it moves the deck by', () => {
  const p = plan({ mode: 'cheapest' });
  const sol = p.picks.find(k => k.name === 'Sol Ring');
  assert.strictEqual(sol.was, 3);
  assert.strictEqual(sol.now, 1.5);
  assert.strictEqual(sol.delta, -1.5);
  // €1.50 off the Sol Ring and €0.70 off the Cultivate, one copy of each.
  assert.strictEqual(Number(p.delta.toFixed(2)), -2.2);
});

test('and the delta counts copies, because the deck’s price does', () => {
  const deck = DECK.map(c => (c.card_name === 'Cultivate' ? { ...c, qty: 4 } : c));
  const p = plan({ mode: 'cheapest', cards: deck });
  assert.strictEqual(Number(p.delta.toFixed(2)), -4.3, '€1.50 plus four times €0.70');
});

// ── Prefer the printings I own ────────────────────────────────────────────

test('prefer-owned takes the cheapest of the printings on the shelf', () => {
  // Two Sol Rings in the box, one of them foil. The mode agrees with the
  // fallback it uses: cheapest among the ones you have.
  const p = plan({ mode: 'owned', owned: {
    'Sol Ring': [held({ id: 'sr-c21', set: 'c21', collector_number: '263' }),
                 held({ id: 'sr-c21', set: 'c21', collector_number: '263', finish: 'foil' })],
  } });
  assert.strictEqual(proposed(p)['Sol Ring'], 'sr-c21 foil', '€5.00 lost to €6.00');
});

test('and an owned printing outside the pool still wins', () => {
  // Revised is Reserved-List-adjacent in every way that matters here: older
  // than the bound, and cheapest and dearest may not send you to buy one. It
  // is in the box, so prefer-owned proposes no purchase and takes it.
  const p = plan({ mode: 'owned', owned: {
    'Sol Ring': [held({ id: 'sr-3ed', set: '3ed', collector_number: '270' })],
  } });
  assert.strictEqual(proposed(p)['Sol Ring'], 'sr-3ed');
});

test('and one nobody has priced, because owning a card is enough to run it', () => {
  const p = plan({ mode: 'owned', owned: {
    'Krenko, Mob Boss': [held({ id: 'kr-m13', set: 'm13', collector_number: '140' })],
  } });
  assert.strictEqual(proposed(p)['Krenko, Mob Boss'], 'kr-m13');
});

test('a printing the shelf knows only by set and number answers for nothing', () => {
  // A Moxfield export names no Scryfall id anywhere in the file, so nothing
  // can say whether its "C21 263" is the printing a deck means. It is not a
  // printing to settle onto, and the card falls back.
  const p = plan({ mode: 'owned', owned: {
    'Sol Ring': [held({ set: 'c21', collector_number: '263' })],
  } });
  assert.strictEqual(proposed(p)['Sol Ring'], 'sr-ltr foil', 'a set and a number were taken for an id');
});

test('a card you own none of falls back to the cheapest printing there is', () => {
  assert.deepStrictEqual(proposed(plan({ mode: 'owned' })),
    { 'Sol Ring': 'sr-ltr foil', 'Cultivate': 'cu-m21' });
});

test('a shelf that predates printings falls back for every card, and says how many', () => {
  // Every collection in existence is in this state until somebody re-imports
  // it. A disappointing run has to explain itself and name the way out.
  const unattributed = Object.fromEntries(
    DECK.map(c => [c.card_name, [held({ qty: c.qty })]]));
  const p = plan({ mode: 'owned', owned: unattributed });
  assert.strictEqual(p.unattributed, 4,
    'four cards were considered and every one of them fell back');
  assert.deepStrictEqual(proposed(p), { 'Sol Ring': 'sr-ltr foil', 'Cultivate': 'cu-m21' });
});

test('and a run that had a shelf to read reports no fallbacks', () => {
  const p = plan({ mode: 'owned', owned: {
    'Sol Ring':         [held({ id: 'sr-c21', set: 'c21', collector_number: '263' })],
    'Cultivate':        [held({ id: 'cu-m21', set: 'm21', collector_number: '177' })],
    'Krenko, Mob Boss': [held({ id: 'kr-m13', set: 'm13', collector_number: '140' })],
    'Mox Diamond':      [held({ id: 'mo-sth', set: 'sth', collector_number: '138' })],
  } });
  assert.strictEqual(p.unattributed, 0);
});

test('the other two modes never report a fallback, because they have none', () => {
  const unattributed = Object.fromEntries(
    DECK.map(c => [c.card_name, [held({ qty: c.qty })]]));
  for (const mode of ['cheapest', 'dearest']) {
    assert.strictEqual(plan({ mode, owned: unattributed }).unattributed, 0);
  }
});

// ── Every board ───────────────────────────────────────────────────────────

test('the run covers every board the deck has', () => {
  const deck = [
    { card_name: 'Sol Ring',  board: 'main',      category: 'Ramp', qty: 1 },
    { card_name: 'Cultivate', board: 'side',      category: 'Ramp', qty: 1 },
    { card_name: 'Sol Ring',  board: 'maybe',     category: 'Ramp', qty: 1 },
    { card_name: 'Cultivate', board: 'commander', category: 'Ramp', qty: 1 },
  ];
  const p = plan({ mode: 'cheapest', cards: deck });
  assert.deepStrictEqual(p.picks.map(k => k.ref).sort(),
    ['commander/Cultivate', 'main/Sol Ring', 'maybe/Sol Ring', 'side/Cultivate']);
});

test('but the delta is what the deck’s price counts, which is not every board', () => {
  // The readout costs the mainboard and the commander. A total that counted a
  // maybeboard swap would promise a move the readout will not make.
  const deck = [
    { card_name: 'Sol Ring',  board: 'main',  category: 'Ramp', qty: 1 },
    { card_name: 'Cultivate', board: 'maybe', category: 'Ramp', qty: 1 },
  ];
  const p = plan({ mode: 'cheapest', cards: deck });
  assert.strictEqual(p.delta, -1.5, 'the maybeboard’s €0.70 was promised to the readout');
});

// ── The run ───────────────────────────────────────────────────────────────
/* The tab loaded whole, as test/deckowned.test.js loads it: the requests the
 * fetch really makes, and the deck's own numbers read back after an apply.
 * The shelf, the mat, the totals and the History POST are the shipped modules;
 * only the network is stubbed. */

/* Two pages of Sol Rings, so that a loader stopping after the first would
 * silently cut the pool off — and would take the LTR foil, the cheapest tile
 * here, out of reach. */
const PAGE_TWO = 'https://api.scryfall.com/cards/search?q=sol&page=2';
const PAGED = {
  'https://api.scryfall.com/cards/search?q=sol': {
    data: PRINTS['Sol Ring'].slice(0, 2), has_more: true, next_page: PAGE_TWO,
  },
  [PAGE_TWO]: { data: PRINTS['Sol Ring'].slice(2), has_more: false },
};

const AS_TIM = { username: 'tim', role: 'player', playerId: 'p-tim' };

function loadTab({ deck = DECK, shelves = [], user = AS_TIM, deckOwner = 'p-tim' } = {}) {
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
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      addEventListener() {}, querySelectorAll: () => [], createElement: () => el('made'),
      getElementById: id => el(id),
      body: { appendChild() {}, style: {} },
      scrollingElement: { scrollTop: 0 }, documentElement: { scrollTop: 0 },
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800, location: {} },
    console, confirm: () => true, alert: () => {}, clearTimeout() {},
    calls: [], prints: [], saves: 0,
    /* Every request the run makes for a card's printings, in order — which is
       how "a basic costs nothing" is asserted as an absence rather than
       assumed. */
    scryfallFetch: async url => {
      sandbox.prints.push(url);
      const page = PAGED[url] || { data: PRINTS[Object.keys(PRINTS).find(
        n => CARDS[n]?.prints_search_uri === url)] || [], has_more: false };
      return { ok: true, status: 200, json: async () => page };
    },
    /* Every request the app made, and — for the snapshots route — a store that
       hands back what it was given. A run's undo is the whole reason it is one
       History row, so the round trip has to be drivable rather than assumed. */
    snaps: [],
    fetch: async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const body   = opts.body ? JSON.parse(opts.body) : null;
      sandbox.calls.push({ url, method, body });
      if (/\/snapshots$/.test(url) && method === 'POST') {
        const id = sandbox.snaps.push({ ...body, id: sandbox.snaps.length + 1 });
        return { ok: true, status: 200, json: async () => ({ ok: true, snapshot: { id } }) };
      }
      const one = url.match(/\/snapshots\/(\d+)$/);
      if (one) {
        const snap = sandbox.snaps[Number(one[1]) - 1];
        return { ok: true, status: 200, json: async () => snap };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, version: 7, snapshots: [], current: {} }) };
    },
    renderMana: () => '', renderPrice: () => '',
    openDrawer() {}, closeDrawers() {}, renderDeck() {},
    ensureScryfallImages: async () => {},
    /* js/scryfall.js's, stubbed rather than loaded: that file also defines
       scryfallFetch, and the run's requests are the thing this harness counts.
       A restore looks the deck's names up on its way past, and every one this
       file cares about is already in dbCardData. */
    fetchCardCollection: async () => [],
    scryfallCache: new Map(), scryfallMetaCache: new Map(),
    deck: null, deckFilter: false, viewMode: 'list',
    animateCardMove: (_el, paint) => paint(),
  };
  sandbox.setTimeout = fn => { sandbox.saves++; return 1; };
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  for (const file of ['state.js', 'sortui.js', 'cardstack.js', 'cardquery.js',
                      'auth.js', 'collections.js', 'card.js',
                      'deckview-boards.js', 'deckview-core.js', 'deckview-render.js',
                      'deckview-edit.js', 'deckview-panels.js', 'deckview-history.js',
                      'deckview-owned.js', 'deckview-totals.js', 'deckview-legality.js',
                      'deckview-mana.js', 'deckview-optimize.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`currentUser = ${JSON.stringify(user)}`);
  run(`hydrateState(${JSON.stringify({
    players: [{ id: 'p-tim', name: 'Tim', colorIdx: 0, wantList: [], decks: [] },
              { id: 'p-anna', name: 'Anna', colorIdx: 1, wantList: [], decks: [] }],
    collections: shelves,
  })})`);
  run(`dbDeck = { id: 'd1', playerId: ${JSON.stringify(deckOwner)}, name: 'A deck', commander: '' }`);
  run(`dbCards = ${JSON.stringify(deck.map((c, i) => ({ qty: 1, board: 'main', position: i, ...c })))}`);
  run(`dbCats = ${JSON.stringify(['Ramp', 'Creatures', 'Lands'].map((name, i) => ({ name, position: i })))}`);
  run(`dbCardData = new Map(${JSON.stringify(Object.entries(CARDS))})`);

  return {
    run, answer, el,
    calls:  () => sandbox.calls,
    prints: () => sandbox.prints,
    /** Open the modal and run a mode to a preview. */
    async optimize(mode) {
      run('dbShowOptimize()');
      await run(`dbOptimizeRun('${mode}')`);
      return answer('_dbOptRun.plan');
    },
    apply: () => run('dbOptimizeApply()'),
    /** Put the newest snapshot back, the way the History panel's Restore does. */
    restore: () => run('dbRestoreSnapshot(1)'),
    /** What the deck costs, as the readout reads it. */
    price: () => { run('dbRenderStats()'); return answer('dbDeckTotals().price'); },
    printingOf: name => answer(`dbCards.find(c => c.card_name === ${JSON.stringify(name)}).printing || null`),
    body: () => el('dbOptimizeBody').innerHTML,
  };
}

test('the gallery loader follows every page, so the pool is not cut off', async () => {
  const tab = loadTab();
  const plan = await tab.optimize('cheapest');
  assert.strictEqual(plan.picks.find(p => p.name === 'Sol Ring').to.id, 'sr-ltr',
    'the cheapest printing was on the second page and never arrived');
  assert.deepStrictEqual(tab.prints().filter(u => u.includes('q=sol')),
    ['https://api.scryfall.com/cards/search?q=sol', PAGE_TWO]);
});

test('a basic land costs no request at all', async () => {
  const tab = loadTab();
  await tab.optimize('cheapest');
  assert.ok(!tab.prints().some(u => u.includes('q=forest')),
    'eight Forests were looked up to be left alone');
  // And neither is a name the app has no card data for: there is nothing to
  // ask with.
  assert.strictEqual(tab.prints().filter(u => !u.includes('page=')).length, 4);
});

test('applying moves the deck’s price by the sum of the picks', async () => {
  const tab = loadTab();
  const before = tab.price();
  const plan = await tab.optimize('cheapest');
  await tab.apply();
  const after = tab.price();
  assert.strictEqual(Number((after.eur - before.eur).toFixed(2)),
                     Number(plan.delta.toFixed(2)));
  assert.strictEqual(Number(plan.delta.toFixed(2)), -2.2);
});

test('and writes the printing onto every card it named', async () => {
  const tab = loadTab();
  await tab.optimize('cheapest');
  await tab.apply();
  assert.strictEqual(tab.printingOf('Sol Ring').id, 'sr-ltr');
  assert.strictEqual(tab.printingOf('Sol Ring').finish, 'foil');
  assert.strictEqual(tab.printingOf('Cultivate').id, 'cu-m21');
  assert.strictEqual(tab.printingOf('Mox Diamond'), null, 'a card it did not name was written to');
});

test('a card that has left the deck is dropped, and the rest still apply', async () => {
  const tab = loadTab();
  await tab.optimize('cheapest');
  tab.run(`dbCards = dbCards.filter(c => c.card_name !== 'Sol Ring')`);
  const applied = await tab.apply();
  assert.strictEqual(applied, 1, 'a printing was written onto a card that is not in the deck');
  assert.strictEqual(tab.printingOf('Cultivate').id, 'cu-m21');
  assert.match(tab.body(), /1 of 2 changed/, 'a partial apply was reported as a whole one');
});

test('the whole run is one snapshot, and the row says which mode it was', async () => {
  const tab = loadTab();
  await tab.optimize('dearest');
  await tab.apply();
  const snaps = tab.calls().filter(c => c.method === 'POST' && /\/snapshots$/.test(c.url));
  assert.strictEqual(snaps.length, 1, 'a ninety-nine card run must not be ninety-nine rows');
  assert.strictEqual(snaps[0].body.reason, 'optimize-dearest');
});

test('and the snapshot goes out before the deck is touched', async () => {
  const tab = loadTab();
  await tab.optimize('cheapest');
  await tab.apply();
  const snap = tab.calls().find(c => /\/snapshots$/.test(c.url));
  const sol  = snap.body.cards.find(c => c.card_name === 'Sol Ring');
  assert.ok(!sol.printing, 'the snapshot already had the change it exists to undo');
});

test('the mat is redrawn and the deck saved once, however many cards moved', async () => {
  const tab = loadTab();
  await tab.optimize('cheapest');
  const before = tab.run('saves');
  await tab.apply();
  assert.strictEqual(tab.run('saves') - before, 1,
    'a bulk write scheduled a save per card');
});

test('prefer-owned settles the deck onto the copies in the box', async () => {
  const tab = loadTab({ shelves: [{
    key: 'c:tim', name: 'Tim’s box', source: 'archidekt', color: '#a855f7', owner: 'p-tim',
    cards: {
      'Sol Ring': { name: 'Sol Ring', qty: 1,
                    printings: [{ id: 'sr-c21', set: 'c21', collector_number: '263', qty: 1 }] },
      'Cultivate': { name: 'Cultivate', qty: 1,
                     printings: [{ id: 'cu-c21', set: 'c21', collector_number: '188', qty: 1 }] },
    },
  }] });
  const plan = await tab.optimize('owned');
  assert.deepStrictEqual(proposed(plan), { 'Sol Ring': 'sr-c21' },
    'the Cultivate on the shelf is the one the deck already runs');
  assert.strictEqual(plan.unattributed, 0);
});

test('and a shelf that predates printings says so rather than saying nothing', async () => {
  const tab = loadTab({ shelves: [{
    key: 'c:tim', name: 'Tim’s box', source: 'csv-moxfield', color: '#a855f7', owner: 'p-tim',
    cards: { 'Sol Ring':  { name: 'Sol Ring',  qty: 1 },
             'Cultivate': { name: 'Cultivate', qty: 1 } },
  }] });
  const plan = await tab.optimize('owned');
  assert.strictEqual(plan.unattributed, 2);
  assert.match(tab.body(), /Re-import the collection/);
});

test('a deck that is not yours is not offered the run at all', async () => {
  const tab = loadTab({ deckOwner: 'p-anna' });
  assert.strictEqual(tab.run('dbShowOptimize()'), false);
  assert.strictEqual(tab.run('_dbOptRun'), null);
});

test('cancelling abandons the run rather than half-answering it', async () => {
  const tab = loadTab();
  tab.run('dbShowOptimize()');
  const running = tab.run(`dbOptimizeRun('cheapest')`);
  tab.run('dbHideOptimize()');
  assert.strictEqual(await running, null, 'a cancelled run still came back with a plan');
  assert.strictEqual(tab.run('_dbOptRun'), null);
});

// ── The frame ─────────────────────────────────────────────────────────────
/* The markup and the stylesheet, read as text, where what matters is that a
 * control exists and is served. A run nobody can reach is not a feature. */

const MARKUP = read('public/index.html');
const CSS    = read('public/css/tabs.css');

test('the module is served, after the ones it speaks to', () => {
  const scripts = [...MARKUP.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.ok(scripts.includes('deckview-optimize.js'), 'the module is not served at all');
  for (const before of ['card.js', 'deckview-edit.js', 'deckview-history.js',
                        'deckview-owned.js', 'deckview-totals.js']) {
    assert.ok(scripts.indexOf('deckview-optimize.js') > scripts.indexOf(before),
      `it is loaded before ${before}, whose vocabulary it is written in`);
  }
});

test('the way in is one item in the Deck group, hidden until the deck is yours', () => {
  assert.match(MARKUP, /id="dbOptimizeBtn"[\s\S]{0,200}?onclick="dbShowOptimize\(\)"/);
  const btn = MARKUP.match(/<button[^>]*id="dbOptimizeBtn"[^>]*>/)[0];
  assert.match(btn, /style="display:none"/, 'the item is on screen before the deck is known to be yours');
  assert.match(read('public/js/deckview-core.js'), /dbOptimizeBtn/,
    'nothing ever shows it');
});

test('and the modal it opens is on the page for the module to fill', () => {
  assert.match(MARKUP, /id="dbOptimizeOverlay"[\s\S]{0,600}?id="dbOptimizeBody"/);
  assert.match(MARKUP, /id="dbOptimizeOverlay"[^>]*onclick="[^"]*dbHideOptimize\(\)"/,
    'the backdrop does not close it');
});

test('the modal has a stylesheet of its own', () => {
  for (const rule of ['.db-opt-box', '.db-opt-mode', '.db-opt-progress-bar', '.db-opt-table']) {
    assert.ok(CSS.includes(`${rule} {`) || CSS.includes(`${rule},`),
      `${rule} has no rule, so the run is drawn unstyled`);
  }
});

test('the module writes no colour and no size of its own', () => {
  const src = read('public/js/deckview-optimize.js');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(src), 'a colour was written into the module as hex');
});

test('every element the module reaches for is on the page', () => {
  /* The sandbox above hands back an element for any id asked of it, which is
     what lets the run be driven without a browser — and is exactly why a typo
     in an id would pass every test in this file. So the ids are read out of the
     module and looked for in the markup. */
  const src = read('public/js/deckview-optimize.js');
  const ids = [...src.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
  assert.ok(ids.length, 'the module reaches for nothing, which cannot be right');
  for (const id of new Set(ids)) {
    assert.ok(MARKUP.includes(`id="${id}"`), `#${id} is not on the page`);
  }
});

test('and every handler it writes into markup is a function it defines', () => {
  const src   = read('public/js/deckview-optimize.js');
  const calls = [...src.matchAll(/onclick="(\w+)\(/g)].map(m => m[1]);
  assert.ok(calls.length, 'nothing in the preview can be pressed');
  for (const fn of new Set([...calls,
      ...[...MARKUP.matchAll(/onclick="[^"]*?\b(dbShowOptimize|dbHideOptimize)\(/g)].map(m => m[1])])) {
    assert.match(src, new RegExp(`function ${fn}\\b`), `${fn}() is pressed and never defined`);
  }
});

// ── Reading the result ────────────────────────────────────────────────────

test('the preview says what the pool was, where the pool decided anything', () => {
  // The screen the four-figure Sol Ring appears on is the screen that has to
  // carry the sentence explaining it — a bound stated two screens ago is a
  // bound nobody is reading when the result provokes the question.
  const tab = loadTab();
  tab.run(`_dbOptRun = { phase: 'preview', mode: 'dearest',
    plan: dbOptimizePlan({ cards: dbCards, cardData: dbCardData, mode: 'dearest',
                           prints: new Map(), owned: new Map() }) }`);
  tab.run('_dbOptPaint()');
  assert.match(tab.body(), /8th Edition/, 'the preview does not say what it was bounded by');
});

test('and does not, where it decided nothing', () => {
  // Prefer-owned proposes no purchase, so the buying bound is not the rule it
  // followed and saying it would be an explanation of the wrong answer.
  const tab = loadTab();
  tab.run(`_dbOptRun = { phase: 'preview', mode: 'owned',
    plan: dbOptimizePlan({ cards: dbCards, cardData: dbCardData, mode: 'owned',
                           prints: new Map(), owned: new Map() }) }`);
  tab.run('_dbOptPaint()');
  assert.doesNotMatch(tab.body(), /8th Edition/);
});

test('a total over the deck says so when the table shows rows outside it', async () => {
  /* The figure is the move the price readout will make, which counts the
     mainboard and the commander. A table listing a maybeboard row beside it is
     a table that visibly does not add up, unless it says why. */
  const tab = loadTab({ deck: [
    { card_name: 'Sol Ring',  board: 'main',  category: 'Ramp', qty: 1 },
    { card_name: 'Cultivate', board: 'maybe', category: 'Ramp', qty: 1 },
  ] });
  await tab.optimize('cheapest');
  assert.match(tab.body(), /1 of them off the boards the price counts/);
});

test('and says nothing about it when every row is in the deck', async () => {
  const tab = loadTab();
  await tab.optimize('cheapest');
  assert.doesNotMatch(tab.body(), /off the boards/);
});

// ── The undo ──────────────────────────────────────────────────────────────

test('restoring the run’s History row puts every printing back', async () => {
  /* The reason a ninety-nine card run is worth one row. A restore that put
     half the printings back would be a worse loss than the run it was undoing,
     and it is a loss nobody reports — the cards are all still in the deck and
     only their art has changed. */
  const tab = loadTab();
  await tab.optimize('cheapest');
  await tab.apply();
  assert.strictEqual(tab.printingOf('Sol Ring').id, 'sr-ltr');

  await tab.restore();
  assert.strictEqual(tab.printingOf('Sol Ring'), null, 'the printing survived its own undo');
  assert.strictEqual(tab.printingOf('Cultivate'), null);
  assert.deepStrictEqual(tab.answer('dbCards.map(c => c.card_name)'),
    DECK.map(c => c.card_name), 'and the deck came back as something else');
});

test('and a run applied over a chosen printing restores that one, not nothing', async () => {
  // The row holds the deck as it was, which is not the same as a deck nobody
  // had chosen anything in.
  const chosen = { id: 'sr-c21', set: 'c21', set_name: 'Commander 2021',
                   collector_number: '263', chosen_at: '2026-01-01' };
  const tab = loadTab({ deck: DECK.map(c =>
    (c.card_name === 'Sol Ring' ? { ...c, printing: chosen } : c)) });
  await tab.optimize('cheapest');
  await tab.apply();
  assert.strictEqual(tab.printingOf('Sol Ring').id, 'sr-ltr');
  await tab.restore();
  assert.deepStrictEqual(tab.printingOf('Sol Ring'), chosen);
});
