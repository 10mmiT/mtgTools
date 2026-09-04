/* The land cycles, browsed.
 *
 * The drawer's third tab lists Magic's land cycles — shocks, fetches, triomes
 * and the rest — as sections that arrive closed, and fetches one cycle when
 * one section is opened. What is asserted here is the two halves of that: the
 * grid, which is the drawer's own tile and therefore inherits the +, the
 * ownership mark and the "already in Deck" badge whole; and the *paying*, which
 * is the part with a cost to somebody else in the house.
 *
 * Opening the tab must ask Scryfall nothing. Twenty cycles fired on open would
 * be twenty jobs in a queue paced at ~9/s for the whole process, which is
 * somebody else's search stalling for two seconds to fill in cycles nobody
 * asked to see. Opening a section must ask exactly once, and opening it again
 * must ask no more.
 *
 * ── Why the cycle counts below are constants ──────────────────────────────
 *
 * A cycle is a Scryfall `is:` predicate, and an `is:` value Scryfall does not
 * recognise is *silently ignored* rather than refused: `is:shocklnd t:land`
 * returns 1224 cards, which is every land in Magic. So a typo in
 * DB_LAND_CYCLES does not produce an error — it produces a section headed
 * "Shocklands" holding twelve hundred cards, and nothing at runtime can tell
 * that apart from an unusually generous cycle.
 *
 * CYCLE_SIZES is that guard, and it is deliberately a table of numbers rather
 * than a query. No test in this repo touches the network — every one of them
 * runs on the machine the app is installed on, which frequently has no route
 * out, and test/offline.test.js exists to assert the app owes nothing to one.
 * A test that asked Scryfall would fail there for a reason that is not a
 * regression in our code.
 *
 * What that trade catches: somebody edits the cycle list and mistypes a name,
 * or drops one, or adds one without recording what it holds. What it honestly
 * cannot catch: Scryfall renaming a predicate underneath us, which turns a
 * working section into every land in Magic with this file none the wiser. That
 * is the cost of not asking the network, and it is written down here rather
 * than assumed.
 *
 * ── Re-probing the counts by hand ─────────────────────────────────────────
 *
 * The numbers below were probed on 2026-09-04. To check them again, from a
 * machine with a route out:
 *
 *   for c in fetchland shockland dual triome painland checkland fastland \
 *            slowland scryland battleland pathway surveilland cycleland \
 *            triland filterland bounceland gainland canopyland storageland \
 *            creatureland; do
 *     printf '%s ' "$c"
 *     curl -s "https://api.scryfall.com/cards/search?q=is:$c&unique=cards" |
 *       grep -o '"total_cards":[0-9]*'
 *     sleep 0.2
 *   done
 *
 * A cycle that comes back in the hundreds is a predicate Scryfall no longer
 * knows. A cycle that is one or two larger than the number here is a new
 * printing joining it, which is the ordinary case: update the number.
 *
 * Three layers, all against the shipped files:
 *
 *   the list    js/deckview-landbase.js's cycles, against the table below
 *   the tab     the whole drawer in a vm sandbox, with Scryfall stubbed and
 *               every request it makes recorded
 *   the frame   the markup, read as text where what matters is that a pane
 *               and a button exist for the switcher to reach
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

/* Every cycle the tab offers, and how many cards Scryfall had in it when the
 * list was written. Keyed by the predicate, because the predicate is the thing
 * that can be mistyped. */
const CYCLE_SIZES = {
  fetchland: 10, shockland: 10, dual: 10, triome: 10, painland: 10,
  checkland: 10, fastland: 10, slowland: 10, scryland: 10, battleland: 10,
  pathway: 10, surveilland: 10, cycleland: 10, triland: 10, filterland: 22,
  bounceland: 17, gainland: 15, canopyland: 6, storageland: 12,
  creatureland: 49,
};

// ── The tab ───────────────────────────────────────────────────────────────

const CARDS = {
  'Chulane, Teller of Tales': {
    name: 'Chulane, Teller of Tales', type_line: 'Legendary Creature — Human Druid',
    cmc: 5, mana_cost: '{2}{G}{W}{U}', color_identity: ['W', 'U', 'G'] },
  'Kozilek, Butcher of Truth': {
    name: 'Kozilek, Butcher of Truth', type_line: 'Legendary Creature — Eldrazi',
    cmc: 10, mana_cost: '{10}', color_identity: [] },
  'Hallowed Fountain': { name: 'Hallowed Fountain', type_line: 'Land — Plains Island',
    cmc: 0, color_identity: ['W', 'U'] },
  'Breeding Pool': { name: 'Breeding Pool', type_line: 'Land — Forest Island',
    cmc: 0, color_identity: ['G', 'U'] },
  'Temple Garden': { name: 'Temple Garden', type_line: 'Land — Forest Plains',
    cmc: 0, color_identity: ['G', 'W'] },
  'Cultivate': { name: 'Cultivate', type_line: 'Sorcery', cmc: 3, color_identity: ['G'] },
  'Sol Ring': { name: 'Sol Ring', type_line: 'Artifact', cmc: 1, color_identity: [] },
};

/* The deck already holds one of the three shocklands, which is the case the
 * tile has to say something about. */
const DECK = [
  { card_name: 'Cultivate',         category: 'Ramp' },
  { card_name: 'Sol Ring',          category: 'Ramp' },
  { card_name: 'Hallowed Fountain', category: 'Lands' },
];

const COMMANDER = { card_name: 'Chulane, Teller of Tales', category: 'Creatures',
                    board: 'commander' };

const PLAYERS = [{ id: 'p-tim', name: 'Tim', colorIdx: 0, wantList: [], decks: [] }];

/* One shelf, holding one of the three cards a section comes back with, so the
 * ownership mark has both answers to give. */
const SHELVES = [
  { key: 'c:tim', name: 'Tim’s box', source: 'csv-moxfield', color: '#a855f7', owner: 'p-tim',
    cards: { 'Breeding Pool': { name: 'Breeding Pool', qty: 1 } } },
];

const AS_TIM  = { username: 'tim',  role: 'player', playerId: 'p-tim' };
const AS_ANNA = { username: 'anna', role: 'player', playerId: 'p-anna' };

/** A card as Scryfall hands one back, which is more than the deck cache holds. */
const sfCard = name => ({ ...CARDS[name], image_uris: { normal: `/img/${name}.jpg` } });

/* What Scryfall answers, by the query it is asked. Anything not on this list
 * is answered the way Scryfall answers a query that matches nothing, which is
 * a 404 rather than an empty list — a mono-white deck asking about triomes is
 * the ordinary case, not a failure. */
const ANSWERS = {
  'is:shockland id<=wug': ['Hallowed Fountain', 'Breeding Pool', 'Temple Garden'],
  'is:shockland id<=wu':  ['Hallowed Fountain'],
  'is:shockland':         ['Hallowed Fountain', 'Breeding Pool', 'Temple Garden'],
};

function loadTab({ deck = DECK, commander = COMMANDER, user = AS_TIM,
                   answers = ANSWERS, collections = SHELVES } = {}) {
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
    asked: [],
    /* Another query Scryfall knows the answer to, taught to it mid-test —
       for the cases where what changes is the question rather than the deck. */
    answersFor: (q, names) => { answers = { ...answers, [q]: names }; },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, version: 1 }) }),
    // Outside this ticket: the pictures, the prices, the mana symbols.
    renderMana: () => '', renderPrice: () => '',
    openCardByName() {}, openDrawer() {}, closeDrawers() {}, renderDeck() {},
    ensureScryfallImages: async () => {},
    scryfallCache: new Map(), scryfallMetaCache: new Map(),
    deck: null, deckFilter: false, viewMode: 'list',
    animateCardMove: (_el, paint) => paint(),
  };

  /* Scryfall itself, stubbed at the one function the app is allowed to reach
     it through — every request the tab makes is recorded here, because the
     count of them is half of what this file is about. js/scryfall.js is not
     loaded beside it: what is being asserted is which queries this tab asks
     and how often, not the pacer they would go through. */
  sandbox.scryfallFetch = async url => {
    sandbox.asked.push(url);
    const q    = new URL(url, 'http://x').searchParams.get('q');
    const hit  = answers[q];
    const body = hit
      ? { object: 'list', total_cards: hit.length, data: hit.map(sfCard) }
      : { object: 'error', status: 404, code: 'not_found',
          details: 'Your query didn’t match any cards.' };
    return { ok: !!hit, status: hit ? 200 : 404, json: async () => body };
  };
  sandbox.setTimeout = fn => 1;
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  for (const file of ['state.js', 'sortui.js', 'cardturn.js', 'cardstack.js', 'cardquery.js',
                      'auth.js', 'collections.js', 'owned.js',
                      'deckview-boards.js', 'deckview-core.js', 'deckview-render.js',
                      'deckview-edit.js', 'deckview-panels.js', 'deckview-history.js',
                      'deckview-owned.js', 'deckview-totals.js', 'deckview-legality.js',
                      'deckview-mana.js', 'deckview-landbase.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`currentUser = ${JSON.stringify(user)}`);
  run(`hydrateState(${JSON.stringify({ players: PLAYERS, collections })})`);
  run(`dbDeck = { id: 'd1', playerId: 'p-tim', name: 'A deck', commander: '' }`);
  run(`dbCards = ${JSON.stringify(
    [...deck, ...(commander ? [commander] : [])]
      .map((c, i) => ({ qty: 1, board: 'main', position: i, ...c })))}`);
  run(`dbCats = ${JSON.stringify(['Ramp', 'Lands', 'Creatures'].map((name, i) => ({ name, position: i })))}`);
  run(`dbCardData = new Map(${JSON.stringify(Object.entries(CARDS))})`);

  return {
    run, answer, el,
    /** Every Scryfall query the tab has asked, in order. */
    asked: () => sandbox.asked.map(u => new URL(u, 'http://x').searchParams.get('q')),
    /** The tab, switched to. */
    open() { run(`dbSetLeftTab('lands')`); return el('dbLandsContent').innerHTML; },
    html: () => el('dbLandsContent').innerHTML,
    /** A section, pressed — settled by the time this resolves. */
    toggle(id) { return run(`dbToggleLandCycle('${id}')`); },
    /** The tab drawn again, and whatever that made it go and ask for. */
    render() {
      run('_dbRenderLands()');
      return run('Promise.all([..._dbLandAsking.values()])');
    },
    /** Which cycles are drawn open. */
    openCycles: () => [...el('dbLandsContent').innerHTML
      .matchAll(/aria-expanded="true"[\s\S]*?db-land-name">([^<]+)/g)].map(m => m[1]),
    /** The card names in the grid of whatever is open. */
    tiles: () => [...el('dbLandsContent').innerHTML
      .matchAll(/class="sf-card-lg-name card-link" href="#" data-name="([^"]+)"/g)].map(m => m[1]),
  };
}

// ── The cycle list ────────────────────────────────────────────────────────

test('every cycle the tab offers has a pinned size, and every pinned size a cycle', () => {
  /* The pairing is the assertion. A predicate mistyped in DB_LAND_CYCLES is a
     predicate Scryfall ignores, and a section holding every land in Magic
     looks exactly like a section that worked — so the spelling is checked
     against a list written down at a moment somebody had asked Scryfall. */
  const tab = loadTab();
  const ids = tab.answer('DB_LAND_CYCLES.map(c => c.id)');
  assert.deepStrictEqual([...ids].sort(), Object.keys(CYCLE_SIZES).sort(),
    'the cycle list and the pinned counts have drifted apart — see this file’s header');
});

test('the counts are pinned as numbers, and no test here asks Scryfall for them', () => {
  for (const [id, size] of Object.entries(CYCLE_SIZES)) {
    assert.ok(Number.isInteger(size) && size > 0, `${id}: ${size} is not a count`);
    /* Every cycle is small. The trap is a section that comes back with all
       1224 lands, so a pinned count anywhere near that would be the typo
       already written down as if it were correct. */
    assert.ok(size < 100, `${id}: ${size} is too many for a cycle — is that predicate real?`);
  }
});

test('a cycle is drawn under a name of ours and asked for under Scryfall’s', () => {
  const tab = loadTab();
  const cycles = tab.answer('DB_LAND_CYCLES');
  for (const { id, label } of cycles) {
    assert.match(id, /^[a-z]+$/, `${id} is not a bare is: predicate`);
    assert.ok(label && label !== id, `${id} is drawn without a readable name`);
  }
  assert.strictEqual(tab.answer(`dbLandQuery('shockland', 'WUG')`), 'is:shockland id<=wug',
    'the query is the predicate and the colours, and nothing else');
});

// ── Opening the tab costs nothing ─────────────────────────────────────────

test('the tab opens with every section closed and asks Scryfall nothing', () => {
  const tab = loadTab();
  const html = tab.open();
  assert.deepStrictEqual(tab.asked(), [],
    'the tab fired requests for cycles nobody asked to see');
  assert.deepStrictEqual(tab.openCycles(), [], 'a section arrived open');
  assert.ok(html.includes('Shocklands'), 'the cycles are not listed');
  assert.ok(!html.includes('sf-grid'), 'a closed section drew a grid');
});

test('switching to the tab and away leaves the other halves of the drawer alone', () => {
  const tab = loadTab();
  tab.open();
  assert.ok(tab.el('db-left-lands').style.display === '', 'the Lands pane stayed hidden');
  assert.ok(tab.el('db-ltab-lands').classList.contains('active'), 'the Lands tab is not lit');
  assert.strictEqual(tab.el('db-left-search').style.display, 'none', 'Search stayed showing');

  tab.run(`dbSetLeftTab('search')`);
  assert.strictEqual(tab.el('db-left-lands').style.display, 'none', 'the Lands pane stayed showing');
  assert.ok(!tab.el('db-ltab-lands').classList.contains('active'), 'the Lands tab stayed lit');
  assert.strictEqual(tab.el('db-left-search').style.display, '', 'Search did not come back');
});

// ── Opening a section costs one request ───────────────────────────────────

test('expanding a section asks for that one cycle, in the commander’s colours', async () => {
  const tab = loadTab();
  tab.open();
  await tab.toggle('shockland');
  assert.deepStrictEqual(tab.asked(), ['is:shockland id<=wug'],
    'the one cycle asked for was not the one opened, or not in the deck’s colours');
  assert.deepStrictEqual(tab.tiles(), ['Hallowed Fountain', 'Breeding Pool', 'Temple Garden'],
    'the cycle’s cards are not in the section');
  assert.deepStrictEqual(tab.openCycles(), ['Shocklands'], 'the wrong section opened');
});

test('re-expanding a section does not ask again', async () => {
  const tab = loadTab();
  tab.open();
  await tab.toggle('shockland');
  await tab.toggle('shockland');           // closed
  assert.deepStrictEqual(tab.tiles(), [], 'a closed section kept its grid');
  await tab.toggle('shockland');           // and open again
  assert.strictEqual(tab.asked().length, 1,
    'the second look at a cycle cost the house a second request');
  assert.deepStrictEqual(tab.tiles(), ['Hallowed Fountain', 'Breeding Pool', 'Temple Garden']);
});

test('a second section is a second request, and the first stays open', async () => {
  const tab = loadTab();
  tab.open();
  await tab.toggle('shockland');
  await tab.toggle('triome');
  assert.deepStrictEqual(tab.asked(), ['is:shockland id<=wug', 'is:triome id<=wug']);
  assert.deepStrictEqual(tab.openCycles(), ['Shocklands', 'Triomes'],
    'opening one section closed another');
});

test('a deck in other colours asks again, because it is a different question', async () => {
  const tab = loadTab();
  tab.open();
  await tab.toggle('shockland');
  /* The commander comes off the board, and an Azorius one goes on. */
  tab.run(`dbCards = dbCards.filter(c => c.board !== 'commander').concat([
    { card_name: 'Hallowed Fountain', qty: 1, board: 'commander', category: 'Creatures', position: 9 }])`);
  await tab.toggle('shockland');   // closed
  await tab.toggle('shockland');   // opened, in new colours
  assert.deepStrictEqual(tab.asked(), ['is:shockland id<=wug', 'is:shockland id<=wu'],
    'the new colours were answered out of the old ones’ cache');
  assert.deepStrictEqual(tab.tiles(), ['Hallowed Fountain']);
});

test('an open section follows the deck into its new colours', async () => {
  /* The colours are half the question, so a section left open while they
     change is a section holding the answer to a question nobody is asking any
     more. It asks again where it stands rather than waiting to be closed and
     reopened — which is also the difference between re-asking and sitting on
     "Loading…" for ever, because nothing else was going to make the request. */
  const tab = loadTab({ commander: null, deck: [{ card_name: 'Cultivate', category: 'Ramp' }] });
  tab.run(`answersFor('is:shockland id<=g', []);
           answersFor('is:shockland id<=wug', ['Temple Garden'])`);
  tab.open();
  await tab.toggle('shockland');
  assert.deepStrictEqual(tab.asked(), ['is:shockland id<=g']);

  /* A white-blue land goes into the deck, and it is three colours. */
  tab.run(`dbCards.push({ card_name: 'Hallowed Fountain', qty: 1, board: 'main',
                          category: 'Lands', position: 9 })`);
  await tab.render();
  assert.deepStrictEqual(tab.asked(), ['is:shockland id<=g', 'is:shockland id<=wug'],
    'the open section did not follow the deck into its new colours');
  assert.deepStrictEqual(tab.tiles(), ['Temple Garden']);
  assert.ok(!tab.html().includes('Loading…'), 'the section was left waiting on nothing');
});

// ── What the filter is ────────────────────────────────────────────────────

test('with no commander, the filter is the union of the deck’s own colours', () => {
  const tab = loadTab({ commander: null });
  /* Cultivate is green and the Hallowed Fountain in the deck is white-blue. */
  assert.strictEqual(tab.answer('dbLandIdentity()'), 'WUG',
    'the deck’s own colours were not read off its cards');
  assert.ok(tab.open().includes('No commander'), 'the tab did not say the filter is the weaker one');
});

test('a colourless commander is colourless, not unfiltered', async () => {
  /* An empty identity and no identity are different answers. Kozilek may play
     colourless lands; a deck nothing can be said about may play anything. */
  const tab = loadTab({ commander: { card_name: 'Kozilek, Butcher of Truth',
                                     category: 'Creatures', board: 'commander' } });
  assert.strictEqual(tab.answer('dbLandIdentity()'), 'C');
  tab.open();
  await tab.toggle('shockland');
  assert.deepStrictEqual(tab.asked(), ['is:shockland id<=c']);
});

test('a deck with nothing in it yet is every cycle, unfiltered', async () => {
  const tab = loadTab({ deck: [], commander: null });
  assert.strictEqual(tab.answer('dbLandIdentity()'), '');
  tab.open();
  await tab.toggle('shockland');
  assert.deepStrictEqual(tab.asked(), ['is:shockland'], 'an empty filter was sent as one');
});

// ── The cards are the drawer’s own tiles ──────────────────────────────────

test('a card in the section is the same tile Search draws — the +, the mark, the badge', async () => {
  const tab = loadTab();
  tab.open();
  await tab.toggle('shockland');
  const html = tab.html();

  assert.match(html, /dbAddFromDrawer\('Breeding Pool'\)/,
    'the + does not add through the drawer’s own add');
  /* The deck already holds a Hallowed Fountain, so its + says so rather than
     reading as a card you have not got. */
  assert.match(html, /dbAddFromDrawer\('Hallowed Fountain'\)[\s\S]*?>✓</,
    'a card already in the deck did not say so');
  /* Breeding Pool is in Tim's box and Temple Garden is in nobody's. */
  assert.ok(html.includes('Breeding Pool'), 'the owned card is missing from the grid');
  assert.notStrictEqual(tab.answer(`cardOwnMark('Breeding Pool')`), '',
    'the ownership mark has nothing to say about a card on the shelf');
  assert.strictEqual(tab.answer(`cardOwnMark('Temple Garden')`), '',
    'a card nobody owns was marked as owned');
});

test('the + honours the drawer’s "Add to", the way it does on the other halves', async () => {
  const tab = loadTab();
  tab.run(`dbSetAddTo('maybe')`);
  tab.open();
  await tab.toggle('shockland');
  assert.match(tab.html(), /title="Add to Maybeboard"/,
    'the tile offered to add somewhere other than where the drawer is pointing');

  await tab.run(`dbAddFromDrawer('Temple Garden')`);
  assert.deepStrictEqual(
    tab.answer(`dbCards.filter(c => c.card_name === 'Temple Garden').map(c => c.board)`),
    ['maybe'], 'the + put the card somewhere the drawer was not pointing');
  /* And the grid it was pressed in redraws, so the tile now says the card is
     there — the whole of why _dbRefreshDrawer() exists. */
  assert.match(tab.html(), /dbAddFromDrawer\('Temple Garden'\)[\s\S]*?>✓</,
    'the section did not redraw around the card it just added');
});

test('somebody else’s deck is a tab you can read and not one you can add from', async () => {
  const tab = loadTab({ user: AS_ANNA });
  tab.open();
  await tab.toggle('shockland');
  assert.deepStrictEqual(tab.tiles(), ['Hallowed Fountain', 'Breeding Pool', 'Temple Garden'],
    'the cards are the same cards whoever is looking');
  assert.ok(!tab.html().includes('dbAddFromDrawer'), 'a + was drawn on a deck that is not ours');
});

// ── The nothings ──────────────────────────────────────────────────────────

test('a cycle with nothing in these colours says so, rather than reading as broken', async () => {
  /* Scryfall answers a query that matches no cards with a 404, which is the
     correct answer to "the triomes a Dimir deck may play" and not a failure. */
  const tab = loadTab();
  tab.open();
  await tab.toggle('triome');
  assert.match(tab.html(), /Nothing in this cycle is in these colours/);
  assert.ok(!tab.html().includes('error-msg'), 'an empty cycle was drawn as an error');
});

test('a cycle that came back empty is not asked for twice either', async () => {
  const tab = loadTab();
  tab.open();
  await tab.toggle('triome');
  await tab.toggle('triome');
  await tab.toggle('triome');
  assert.strictEqual(tab.asked().length, 1, 'a settled nothing was re-fetched');
});

test('a section that fails says why, and lets you ask again', async () => {
  /* A settled nothing is an answer and is kept. A failure is not: a second of
     no connection must not cost that cycle for as long as the deck is open. */
  const tab = loadTab();
  tab.run(`_realFetch = scryfallFetch;
           scryfallFetch = async () => { throw new Error('offline'); }`);
  tab.open();
  await tab.toggle('shockland');
  assert.match(tab.html(), /error-msg[\s\S]*offline/, 'the failure was swallowed');

  tab.run('scryfallFetch = _realFetch');
  await tab.toggle('shockland');   // read, and closed
  await tab.toggle('shockland');   // asked again
  assert.deepStrictEqual(tab.tiles(), ['Hallowed Fountain', 'Breeding Pool', 'Temple Garden'],
    'the section was stuck with a failure it could not be asked out of');
});

// ── Between decks ─────────────────────────────────────────────────────────

test('a new deck arrives with the sections closed, and does not pay for them again', async () => {
  const tab = loadTab();
  tab.open();
  await tab.toggle('shockland');
  tab.run('_dbLandsClose()');
  assert.deepStrictEqual(tab.openCycles(), [],
    'the last deck’s open sections were still spread out');

  await tab.toggle('shockland');
  assert.strictEqual(tab.asked().length, 1,
    'what a cycle holds is a fact about Magic and was fetched twice anyway');
});

test('changing decks is what closes them', async () => {
  /* Driven through dbSelectDeck() rather than through the hook: putting no
     deck on the mat is the one of its three paths that is a function call and
     not a page of loading, and it is a deck change like any other. */
  const tab = loadTab();
  tab.open();
  await tab.toggle('shockland');
  assert.deepStrictEqual(tab.openCycles(), ['Shocklands']);

  await tab.run(`dbSelectDeck('')`);
  assert.deepStrictEqual(tab.openCycles(), [],
    'the last deck’s open sections were still spread out over the next one');
});

// ── The frame ─────────────────────────────────────────────────────────────

test('the drawer has a Lands tab and a pane for it', () => {
  const html = read('public/index.html');
  assert.match(html, /id="db-ltab-lands"[^>]*onclick="dbSetLeftTab\('lands'\)"/,
    'there is no button to reach the tab by');
  assert.match(html, /id="db-left-lands"[^>]*style="display:none"/,
    'the pane is missing, or the drawer opens on it');
  assert.match(html, /id="dbLandsContent"/, 'nothing for the sections to be written into');
  assert.match(html, /<script src="js\/deckview-landbase\.js">/, 'the module is not loaded');
});
