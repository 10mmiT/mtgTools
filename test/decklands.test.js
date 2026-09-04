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
 * ── And the check, which sits above all of it ─────────────────────────────
 *
 * The other half of this file is the panel at the top of the tab: how many
 * sources of each colour the deck holds against how many the source-count
 * table wants, and the card that set the bar. Nothing in it touches the
 * network either — it is a lookup into a table of numbers and a walk over the
 * deck already in the sandbox — and what is asserted is the three places it
 * can be wrong: the cell it reads out of the table, the cost it decides is the
 * deck's hardest, and what it is willing to count as a source.
 *
 * The cells asserted below are copied from the gist the shipped table was
 * transcribed from, and it is worth being exact about what that does and does
 * not catch. It catches a row edited later — a digit changed, a row inserted,
 * a column count that slipped — which is the failure that actually happens to
 * a table nobody reads. It does *not* independently catch a cell that was
 * wrong the moment it was written, because the same pair of eyes copied both.
 * The structural test below is the honest guard for that: a requirement is a
 * number of the row's own lands, so a cell outside 1..lands is a typo whoever
 * made it.
 *
 * The whole table was checked cell by cell against the gist when it was
 * written, which no test here can do — every test in this repo runs on a
 * machine that frequently has no route out. To do it again by hand:
 *
 *   curl -s https://gist.githubusercontent.com/teryror/\
 *     881d60e08480a56043895d3bbb83c374/raw
 *
 * and read the two tables under "# Adjustments Based on Casting Costs" — the
 * 60-card and 99-card ones, not the mono-colour tables earlier in the page.
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
    cmc: 0, produced_mana: ['W', 'U'], color_identity: ['W', 'U'] },
  'Breeding Pool': { name: 'Breeding Pool', type_line: 'Land — Forest Island',
    cmc: 0, produced_mana: ['G', 'U'], color_identity: ['G', 'U'] },
  'Temple Garden': { name: 'Temple Garden', type_line: 'Land — Forest Plains',
    cmc: 0, produced_mana: ['G', 'W'], color_identity: ['G', 'W'] },
  'Cultivate': { name: 'Cultivate', type_line: 'Sorcery', cmc: 3, mana_cost: '{2}{G}',
    color_identity: ['G'] },
  'Sol Ring': { name: 'Sol Ring', type_line: 'Artifact', cmc: 1, mana_cost: '{1}',
    produced_mana: ['C'], color_identity: [] },
  'Lightning Bolt': { name: 'Lightning Bolt', type_line: 'Instant', cmc: 1, color_identity: ['R'] },

  /* And the cards the check is read off. The lands make mana, which the cycle
     half of this file never had to care about: a land with no `produced_mana`
     is a land that is not a source of anything. */
  'Island': { name: 'Island', type_line: 'Basic Land — Island', cmc: 0,
    produced_mana: ['U'], color_identity: [] },
  'Forest': { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0,
    produced_mana: ['G'], color_identity: [] },
  'Cryptic Command': { name: 'Cryptic Command', type_line: 'Instant', cmc: 4,
    mana_cost: '{1}{U}{U}{U}', color_identity: ['U'] },
  'Kitchen Finks': { name: 'Kitchen Finks', type_line: 'Creature — Ouphe Cleric', cmc: 3,
    mana_cost: '{1}{G/W}{G/W}', color_identity: ['G', 'W'] },
  'Wear // Tear': { name: 'Wear // Tear', type_line: 'Instant // Instant', cmc: 3,
    mana_cost: '{1}{R} // {W}', color_identity: ['R', 'W'] },
  'Birds of Paradise': { name: 'Birds of Paradise', type_line: 'Creature — Bird', cmc: 1,
    mana_cost: '{G}', produced_mana: ['W', 'U', 'B', 'R', 'G'], color_identity: ['G'] },
  /* A cost that asks for two colours at once, and a card that is two costs on
     one face-carrying object — the two shapes the table has no column for. */
  'Bedevil': { name: 'Bedevil', type_line: 'Instant', cmc: 3,
    mana_cost: '{B}{B}{R}', color_identity: ['B', 'R'] },
  'Bonecrusher Giant': { name: 'Bonecrusher Giant', type_line: 'Creature — Giant', cmc: 3,
    mana_cost: '{2}{R}', color_identity: ['R'], card_faces: [
      { name: 'Bonecrusher Giant', mana_cost: '{2}{R}', type_line: 'Creature — Giant' },
      { name: 'Stomp', mana_cost: '{1}{B}{B}', type_line: 'Instant — Adventure' }] },
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
    /** The check at the top of the tab, as figures rather than as markup. */
    check: () => answer('dbSourcesCheck()'),
    /** Every cycle the tab draws, open or shut, in the order it draws them. */
    cycles: () => [...el('dbLandsContent').innerHTML
      .matchAll(/db-land-name">([^<]+)/g)].map(m => m[1]),
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

test('a deck with no commander is given the same tab, section for section', () => {
  /* The 60-card format is not a lesser citizen of this tab. It loses the
     commander that would have said what it may play, and nothing else: the
     same cycles, in the same order, all closed, asking Scryfall nothing. */
  const drawn = tab => { tab.open(); return tab.cycles(); };
  const withOne = loadTab();
  const without = loadTab({ commander: null });
  assert.deepStrictEqual(drawn(without), drawn(withOne),
    'the deck with no commander was drawn a different list of cycles');
  assert.deepStrictEqual(without.openCycles(), [], 'a section arrived open');
  assert.deepStrictEqual(without.asked(), [], 'opening the tab cost a request');
});

test('the commander says what the deck may play; without one, the deck’s own cards do', () => {
  /* The same deck, twice, with one card in it that is outside the commander's
     colours — a red card under a Bant commander, which is a deck mid-edit or
     mid-import rather than a deck that is wrong. With a commander the answer
     is the commander's, because that is the rule the format actually has;
     without one there is no rule, and the cards themselves are all there is
     to read. */
  const deck = [...DECK, { card_name: 'Lightning Bolt', category: 'Ramp' }];
  assert.strictEqual(loadTab({ deck }).answer('dbLandIdentity()'), 'WUG',
    'a card outside the commander’s identity widened what the deck may play');
  assert.strictEqual(loadTab({ deck, commander: null }).answer('dbLandIdentity()'), 'WURG',
    'with no commander to ask, the deck’s own cards were not read');
});

test('a deck with no colours in it is colourless, not unfiltered', async () => {
  /* The same distinction the commander branch makes, on the side that has no
     commander to make it: a deck holding nothing but Sol Ring has been read,
     and what it says is "colourless". Answering that with every land in the
     cycle would be the tab saying it could not tell, about a deck it can. */
  const tab = loadTab({ deck: [{ card_name: 'Sol Ring', category: 'Ramp' }], commander: null });
  assert.strictEqual(tab.answer('dbLandIdentity()'), 'C');
  tab.open();
  await tab.toggle('shockland');
  assert.deepStrictEqual(tab.asked(), ['is:shockland id<=c'],
    'a deck that reads as colourless was shown the whole cycle');
});

test('a deck the app has only half read is not called colourless on the strength of the half', async () => {
  /* The commander branch refuses to answer out of an identity it could only
     half read — "half an identity is a wrong answer, not a smaller one" — and
     this side owes the same refusal in the one place it would change the
     answer. A deck whose Sol Ring has arrived and whose Cultivate has not is
     not a colourless deck; it is a deck we cannot say about yet. Narrowing it
     to colourless would answer every coloured section with "nothing in this
     cycle is in these colours", which is a lie told confidently.

     Only that fallback is refused. A part-read deck that does show a colour is
     still filtered on the colours it showed — a narrower answer than the whole
     truth, and the render asks again the moment the rest arrives. */
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Sol Ring',  category: 'Ramp' },
    { card_name: 'Cultivate', category: 'Ramp' }] });
  tab.run(`dbCardData.delete('Cultivate')`);
  assert.strictEqual(tab.answer('dbLandIdentity()'), '',
    'a deck read down to its colourless half was filtered as colourless');
  assert.ok(tab.open().includes('every cycle, unfiltered'),
    'the tab claimed to know colours it had not read');

  /* And when the rest of it lands, the deck is green. */
  tab.run(`dbCardData.set('Cultivate', ${JSON.stringify(CARDS.Cultivate)})`);
  assert.strictEqual(tab.answer('dbLandIdentity()'), 'G');
});

test('a deck with nothing in it yet is every cycle, unfiltered', async () => {
  /* A deck opened before a single card is in it is the only deck nothing can
     be said about, and the tab says that rather than guessing. It is still the
     whole tab — the sections are there to be opened, and one opened shows its
     cycle whole, which is a shorter list than it sounds and never every land
     in Magic. */
  const tab = loadTab({ deck: [], commander: null });
  assert.strictEqual(tab.answer('dbLandIdentity()'), '');
  const html = tab.open();
  assert.ok(html.includes('Shocklands'), 'an empty deck was drawn no cycles');
  assert.ok(!html.includes('error-msg'), 'an empty deck was drawn an error');
  assert.ok(html.includes('every cycle, unfiltered'),
    'the tab did not say it had nothing to filter on');
  await tab.toggle('shockland');
  assert.deepStrictEqual(tab.asked(), ['is:shockland'], 'an empty filter was sent as one');
  assert.deepStrictEqual(tab.tiles(), ['Hallowed Fountain', 'Breeding Pool', 'Temple Garden'],
    'the cycle came back with nothing to show for it');
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

// ── The check: the table ──────────────────────────────────────────────────
/* The lookup is a table of numbers with two ways to be wrong — a cell
 * transcribed badly, and a cell asked for that the table does not have. The
 * first is guarded by asking for cells this file names itself; the second by
 * asking for the ones off each end. */

test('a requirement is the table’s own cell, for the deck’s size and land count', () => {
  const tab = loadTab();
  /* A 36-land Commander deck wanting to cast {1}{U}{U} on curve needs 27 blue
     sources, which is the cell docs/design/spec-landbase.md quotes. */
  assert.strictEqual(tab.answer(`dbSourcesWanted('commander', 36, 3, 2)`), 27);
  assert.strictEqual(tab.answer(`dbSourcesWanted('commander', 36, 4, 3)`), 30, 'Cryptic Command');
  assert.strictEqual(tab.answer(`dbSourcesWanted('commander', 36, 1, 1)`), 20, 'a one-drop');
  /* And the same three questions of a 60-card deck, which is a different
     table rather than a scaled version of this one. */
  assert.strictEqual(tab.answer(`dbSourcesWanted('sixty', 24, 3, 2)`), 18);
  assert.strictEqual(tab.answer(`dbSourcesWanted('sixty', 24, 4, 3)`), 20);
  assert.strictEqual(tab.answer(`dbSourcesWanted('sixty', 24, 1, 1)`), 14);
});

test('a land count off either end of the table is read at the end of it', () => {
  const tab = loadTab();
  /* A deck with nine lands in it is a deck somebody is halfway through
     typing, and the table starts at 24. Answering nothing would leave the
     check blank for the whole time a deck is being built; the first row is the
     nearest true thing, and the panel says which row it read. */
  assert.strictEqual(tab.answer(`dbSourceRowLands('commander', 9)`), 24);
  assert.strictEqual(tab.answer(`dbSourcesWanted('commander', 9, 1, 1)`),
                     tab.answer(`dbSourcesWanted('commander', 24, 1, 1)`));
  assert.strictEqual(tab.answer(`dbSourceRowLands('commander', 70)`), 49);
  assert.strictEqual(tab.answer(`dbSourcesWanted('commander', 70, 1, 1)`),
                     tab.answer(`dbSourcesWanted('commander', 49, 1, 1)`));
  assert.strictEqual(tab.answer(`dbSourceRowLands('sixty', 3)`), 15);
  assert.strictEqual(tab.answer(`dbSourceRowLands('sixty', 44)`), 30);
  /* The row a deck actually has is the row it gets, which is why the clamp is
     only at the ends. */
  assert.strictEqual(tab.answer(`dbSourceRowLands('commander', 36)`), 36);
});

test('a cost past the table’s last column is read at the last column', () => {
  const tab = loadTab();
  /* Ulamog costs {10} and the table stops at 8. Nothing about a ten-drop is
     more demanding than an eight-drop of the same pips — the requirement falls
     as the turn gets later — so the last column is the conservative answer as
     well as the only one there is. */
  assert.strictEqual(tab.answer(`dbSourcesWanted('commander', 36, 12, 2)`),
                     tab.answer(`dbSourcesWanted('commander', 36, 8, 2)`));
  /* And a cost with more pips than the table has columns for is read at the
     most demanding column there is, which is every land in the deck. */
  assert.strictEqual(tab.answer(`dbSourcesWanted('commander', 36, 12, 9)`),
                     tab.answer(`dbSourcesWanted('commander', 36, 8, 8)`));
});

test('a colour a cost does not ask for asks the table for nothing', () => {
  const tab = loadTab();
  assert.strictEqual(tab.answer(`dbSourcesWanted('commander', 36, 3, 0)`), null);
  assert.strictEqual(tab.answer(`dbSourcesWanted('commander', 36, 0, 0)`), null);
});

test('every cell in the table is a count of its own row’s lands', () => {
  /* The structural guard on a table copied by hand. A requirement is a number
     of lands, so no cell can ask for more sources than the row has lands, none
     can ask for none, and every row has a cell for every shape — a row that
     came out short, or a digit that lost its neighbour, fails here rather than
     as a wrong number on somebody’s deck. */
  const tab = loadTab();
  const tables = tab.answer('DB_SOURCE_TABLES');
  for (const [id, table] of Object.entries(tables)) {
    const width = (table.maxCmc * (table.maxCmc + 1)) / 2;
    table.rows.forEach((row, i) => {
      const lands = table.from + i;
      assert.strictEqual(row.length, width, `${id} row ${lands} is not ${width} cells wide`);
      for (const cell of row) {
        assert.ok(Number.isInteger(cell) && cell > 0 && cell <= lands,
          `${id} row ${lands} holds ${cell}, which is not a number of that row’s lands`);
      }
    });
  }
});

// ── The check: the hardest cost, and the card that set it ─────────────────

test('the bar is the most demanding cost in the deck, and the card that set it', () => {
  /* Two blue cards, and the one that demands more is the one named. The
     commander is in the walk too — you cast it more often than anything else
     in the box, and a bar that ignored it would be a bar for a different
     deck. */
  const tab = loadTab({ commander: COMMANDER, deck: [
    { card_name: 'Island',          qty: 14, category: 'Lands' },
    { card_name: 'Forest',          qty: 22, category: 'Lands' },
    { card_name: 'Cryptic Command', category: 'Ramp' },
    { card_name: 'Cultivate',       category: 'Ramp' }] });
  const check = tab.check();
  const blue  = check.colours.find(c => c.id === 'U');
  assert.strictEqual(blue.want, 30, '{1}{U}{U}{U} at 36 lands is 30 blue sources');
  assert.strictEqual(blue.card, 'Cryptic Command', 'the bar was not named');
  const green = check.colours.find(c => c.id === 'G');
  assert.strictEqual(green.card, 'Cultivate', 'a {2}{G} sorcery beats the commander’s one green pip');
  assert.strictEqual(green.want, 17);
  const white = check.colours.find(c => c.id === 'W');
  assert.strictEqual(white.card, 'Chulane, Teller of Tales', 'the commander set no bar');
});

test('a hybrid symbol sets no bar, because it can be paid the other way', () => {
  /* {1}{G/W}{G/W} is not a card that demands two white sources — it is a card
     you cast off green if that is what you have. Counting it as a white
     requirement would have the check shouting for Plains at a deck that never
     needs one. It is still counted in the pips, so the colour still has a row;
     what it does not have is a bar. */
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',        qty: 24, category: 'Lands' },
    { card_name: 'Kitchen Finks', category: 'Ramp' }] });
  const check = tab.check();
  const white = check.colours.find(c => c.id === 'W');
  assert.ok(white, 'a colour the deck has pips in was left off the check');
  assert.strictEqual(white.want, null, 'a hybrid cost was read as a requirement in one of its colours');
  assert.strictEqual(white.card, null);
  assert.deepStrictEqual(check.short, [], 'a hybrid card was called uncastable');
});

test('a split card is two costs, not one card that costs both halves', () => {
  /* Scryfall writes Wear // Tear as "{1}{R} // {W}". Read as one cost it is a
     three-mana card wanting red and white at once; read as the card it is, it
     is a two-mana red spell or a one-mana white one, and each half asks the
     table its own question. */
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',       qty: 24, category: 'Lands' },
    { card_name: 'Wear // Tear', category: 'Ramp' }] });
  const check = tab.check();
  const red   = check.colours.find(c => c.id === 'R');
  const white = check.colours.find(c => c.id === 'W');
  assert.strictEqual(red.want,   tab.answer(`dbSourcesWanted('sixty', 24, 2, 1)`),
    'the red half was not read at its own cost');
  assert.strictEqual(white.want, tab.answer(`dbSourcesWanted('sixty', 24, 1, 1)`),
    'the white half was not read at its own cost');
  assert.strictEqual(red.card, 'Wear // Tear');
});

// ── The check: what counts as a source ────────────────────────────────────

test('only lands feed the lookup, and the rocks are counted on their own line', () => {
  /* The simulation behind the table sleeves lands and blanks. A Sol Ring and a
     Birds of Paradise inside the source count would report a consistency the
     model never claimed — so they are out of it, and said out loud underneath
     rather than quietly dropped. */
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',            qty: 14, category: 'Lands' },
    { card_name: 'Sol Ring',          category: 'Ramp' },
    { card_name: 'Birds of Paradise', category: 'Ramp' },
    { card_name: 'Cryptic Command',   category: 'Ramp' }] });
  const check = tab.check();
  assert.strictEqual(check.lands, 14, 'the land count is not the deck’s lands');
  const blue = check.colours.find(c => c.id === 'U');
  assert.strictEqual(blue.held, 14, 'Birds of Paradise was counted as a blue source');
  assert.strictEqual(check.other, 2, 'the rocks and dorks were not counted at all');
  assert.match(tab.open(), /2<\/strong> other source/, 'the other sources are not on the panel');
});

test('the row follows the deck’s size, so a 60-card deck gets 60-card numbers', () => {
  /* The same 24 lands and the same card, once in each format. A Commander deck
     is not a big 60-card deck: it holds ninety-nine and skips its first draw,
     and the table says so. */
  const deck = [{ card_name: 'Island', qty: 24, category: 'Lands' },
                { card_name: 'Cryptic Command', category: 'Ramp' }];
  const sixty = loadTab({ commander: null, deck }).check();
  assert.strictEqual(sixty.format, 'sixty');
  assert.strictEqual(sixty.colours.find(c => c.id === 'U').want, 20);

  const edh = loadTab({ deck }).check();
  assert.strictEqual(edh.format, 'commander');
  assert.strictEqual(edh.colours.find(c => c.id === 'U').want, 21);
});

test('a deck with fewer lands than the table has rows says which row it read', () => {
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',          qty: 4, category: 'Lands' },
    { card_name: 'Cryptic Command', category: 'Ramp' }] });
  const check = tab.check();
  assert.strictEqual(check.lands, 4);
  assert.strictEqual(check.row, 15, 'the 60-card table starts at 15 lands');
  assert.match(tab.open(), /15 lands/, 'the panel did not say which row it read');
});

// ── The check: what it says ───────────────────────────────────────────────

test('the headline is the sources held, the sources wanted, and the card', () => {
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',          qty: 14, category: 'Lands' },
    { card_name: 'Forest',          qty: 10, category: 'Lands' },
    { card_name: 'Cryptic Command', category: 'Ramp' }] });
  const html = tab.open();
  assert.match(html, /blue[\s\S]{0,300}?14[\s\S]{0,120}?20[\s\S]{0,200}?Cryptic Command/,
    'the blue line does not say held, wanted, and the card that set it');
  const blue = tab.check().colours.find(c => c.id === 'U');
  assert.strictEqual(blue.gap, 6, 'the gap is not the difference');
  /* Green is asked for by nothing, so it is not a colour of this deck at all
     and gets no line — nought against nought is not a finding. */
  assert.ok(!tab.check().colours.some(c => c.id === 'G'),
    'a colour the deck neither costs nor is short of was given a line');
});

test('the cards the sources can’t support are behind the headline', () => {
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',          qty: 10, category: 'Lands' },
    { card_name: 'Forest',          qty:  6, category: 'Lands' },
    { card_name: 'Cryptic Command', category: 'Ramp' },
    { card_name: 'Cultivate',       category: 'Ramp' }] });
  const check = tab.check();
  assert.deepStrictEqual(check.short.map(c => c.name).sort(),
    ['Cryptic Command', 'Cultivate'],
    'the list of what the deck cannot support is not the cards that are short');

  /* Closed to begin with — the headline is the finding and the list is the
     argument with it — and opened by the control on the headline. */
  assert.ok(!tab.open().includes('db-sources-short-row'), 'the list arrived open');
  tab.run('dbToggleSourcesShort()');
  const html = tab.html();
  assert.ok(html.includes('db-sources-short-row'), 'the list did not open');
  assert.match(html, /Cryptic Command/, 'the card that cannot be cast is not in the list');
});

test('the panel says what the table assumes rather than leaving it to be found out', () => {
  const html = loadTab({ commander: null, deck: [
    { card_name: 'Island',          qty: 14, category: 'Lands' },
    { card_name: 'Cryptic Command', category: 'Ramp' }] }).open();
  assert.match(html, /untapped/i, 'the untapped-sources assumption is not on the panel');
  assert.match(html, /multiplayer/i, 'the multiplayer caveat is not on the panel');
});

test('a deck with nothing to check yet says so instead of drawing an empty verdict', () => {
  const tab = loadTab({ deck: [], commander: null });
  assert.deepStrictEqual(tab.check().colours, []);
  const html = tab.open();
  assert.ok(html.includes('Shocklands'), 'the cycles went away with the check');
  assert.ok(!html.includes('db-sources-row'), 'an empty deck was drawn colour rows');
});

test('a deck edited behind the drawer redraws the check, not the deck as it was', () => {
  /* The check is a readout of the deck the way the line under the mat is, and
     the drawer can be open while the deck is edited underneath it. Every other
     half of the drawer already redraws on an edit — a card added is a ✓ on the
     tile — and this is the same promise kept for the numbers. */
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',          qty: 10, category: 'Lands' },
    { card_name: 'Cryptic Command', category: 'Ramp' }] });
  tab.open();
  assert.match(tab.html(), /<strong>10<\/strong> sources/, 'the check did not draw');

  tab.run(`dbCards.find(c => c.card_name === 'Island').qty = 20; dbRenderStats()`);
  assert.match(tab.html(), /<strong>20<\/strong> sources/,
    'the check went on answering for the deck as it was');
});

test('a cost that asks for two colours at once wants one more source of each', () => {
  /* The table has one column per shape of *a* colour, and no column at all for
     {B}{B}{R}. The gist's own instruction for those is to read each colour's
     shape separately and add one to each — Bedevil at 26 lands wants 20 black
     and 13 red, not 19 and 12. Leaving the +1 off would understate every gold
     card in the deck by a source, quietly, in the direction that matters. */
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',  qty: 13, category: 'Lands' },
    { card_name: 'Forest',  qty: 13, category: 'Lands' },
    { card_name: 'Bedevil', category: 'Ramp' }] });
  const check = tab.check();
  const black = check.colours.find(c => c.id === 'B');
  const red   = check.colours.find(c => c.id === 'R');
  assert.strictEqual(black.want, tab.answer(`dbSourcesWanted('sixty', 26, 3, 2)`) + 1,
    '{B}{B} out of a gold cost was read at the table’s bare cell');
  assert.strictEqual(red.want, tab.answer(`dbSourcesWanted('sixty', 26, 3, 1)`) + 1);

  /* And the panel says where the extra source came from, rather than showing a
     number the table does not hold and letting somebody go looking for it. */
  const html = tab.open();
  assert.match(html, /two colours at once/, 'the gold-cost rule is not disclosed');
  assert.match(html, /either colour/, 'the half of the rule we cannot show is not admitted');
});

test('a mono-coloured cost is not given the gold rule’s extra source', () => {
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',          qty: 24, category: 'Lands' },
    { card_name: 'Cryptic Command', category: 'Ramp' }] });
  assert.strictEqual(tab.check().colours.find(c => c.id === 'U').want,
                     tab.answer(`dbSourcesWanted('sixty', 24, 4, 3)`),
    'a single-colour cost was charged the gold-cost approximation');
  assert.ok(!tab.open().includes('two colours at once'),
    'a deck with no gold card was told about the gold rule');
});

test('an Adventure is two costs, the same as a card in two halves', () => {
  /* Bonecrusher Giant carries its own cost at the top level *and* a second one
     on a face — Stomp, which is the half that demands black. A reader that
     stops at the top-level cost misses it, and the deck is told nothing about
     a colour it has to be able to cast on turn three. */
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',            qty: 24, category: 'Lands' },
    { card_name: 'Bonecrusher Giant', category: 'Ramp' }] });
  const check = tab.check();
  const black = check.colours.find(c => c.id === 'B');
  assert.ok(black, 'the Adventure half of the card was never read');
  assert.strictEqual(black.card, 'Bonecrusher Giant');
  assert.strictEqual(black.want, tab.answer(`dbSourcesWanted('sixty', 24, 3, 2)`),
    'the two halves were added together instead of being read one at a time');
  const red = check.colours.find(c => c.id === 'R');
  assert.strictEqual(red.want, tab.answer(`dbSourcesWanted('sixty', 24, 3, 1)`),
    'the creature half was not read at its own cost');
});

test('a deck with no rocks in it is not told it has none', () => {
  /* "and 0 other sources — rocks and dorks" is a line answering a question
     nobody in front of it has asked. The line exists to say that the Sol Ring
     you can see in the deck is not in the number above it. */
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',          qty: 24, category: 'Lands' },
    { card_name: 'Cryptic Command', category: 'Ramp' }] });
  assert.strictEqual(tab.check().other, 0);
  assert.ok(!tab.open().includes('other source'), 'the panel counted nought rocks out loud');
});

test('the check is worked out once per deck, not once per redraw', () => {
  /* The same promise js/deckview-totals.js's pass and js/deckview-legality.js's
     make: a deck-wide walk is done when the deck changes and not when a panel
     is drawn. It is held against the mana pass it was read from rather than a
     flag of its own — that pass is already dropped when the deck changes, so
     there is no second thing to remember to invalidate. */
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',          qty: 14, category: 'Lands' },
    { card_name: 'Cryptic Command', category: 'Ramp' }] });
  assert.strictEqual(tab.run('dbSourcesCheck() === dbSourcesCheck()'), true,
    'the check was walked again for a deck that had not changed');

  tab.run(`dbCards.find(c => c.card_name === 'Island').qty = 20; dbManaChanged()`);
  assert.strictEqual(tab.check().colours.find(c => c.id === 'U').held, 20,
    'the check held on to a deck that had changed underneath it');
});
