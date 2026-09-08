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
 * ── And the fix, which sits between them ──────────────────────────────────
 *
 * The third region: for a colour the check calls short, the lands that would
 * close it, the copies somebody in the house already has first. It asks
 * Scryfall the way the cycles do — one query, when a section is opened — so
 * what is asserted is that query, and then the *order*, which is the part no
 * other tab in the app could produce: the shelves are ours and the play rate
 * is Scryfall's, and the region is the two of them read together.
 *
 * The shelves it reads are the fixtures below, so this half touches the
 * network no more than the other two do.
 *
 * ── And the optimizer, which is the one half that writes ─────────────────
 *
 * The control between the check and the fix: a budget of basics, split across
 * the deck's colours by pips, previewed and then applied. It is the first
 * thing in the app to write a calculation into a deck, and the five things
 * asserted are the five places it can be wrong — the split, the basics it is
 * not allowed to touch, the two rules about {C}, the override beside it, and
 * the write.
 *
 * The override is "at least 1 basic of every colour", and what is asserted
 * about it is both of its states, because it has two jobs and only one of them
 * is the switch. On, it seats every colour the deck has *pips* in — pips, not
 * the commander's identity, which is a Golgari commander's black never getting
 * a Swamp for a colour nothing in the deck asks for — and the split still adds
 * up, because the floor is repaired into a finished largest-remainder split
 * rather than reserved out in front of one. That is also asserted as the
 * property it was chosen for: on a deck where every colour already has basics
 * the switch changes nothing at all.
 *
 * Off, which is the default, the preview says the moment it would have
 * mattered — a colour rounded to nought in a deck where nothing else makes it.
 * Both halves of that are asserted, because a flag that read the deck's
 * current sources straight would call white fine on its way out of the deck.
 *
 * And the two sentences are asserted as two. A budget of three cannot give
 * five colours one each, so the switch can be on and still leave a colour at
 * nought — and telling somebody that in the off state's words would be the
 * switch failing quietly, which is the one thing a switch must never do.
 *
 * The split's expected numbers are worked out in the comment above the deck
 * they are read off, by hand, rather than lifted from a run of the code. That
 * is the whole reason to write them down: a test that records what the
 * implementation did is a test that agrees with it forever.
 *
 * The two refusals are asserted the same way. A budget with nowhere to go and
 * a deck whose facts have not all arrived are the same hazard wearing two
 * faces — a plan made against a deck this cannot see — and in both the split
 * moves every basic to nought, so a button that wrote would empty the deck
 * while the panel above it said why it could not. Neither is pressable, both
 * are drawn, and the press that draws a preview is the one that goes and
 * fetches what is missing, so the refusal is a wait rather than a dead end.
 *
 * The write is asserted against the deck in the sandbox — categories kept,
 * quantities set, a colour going to nought removed rather than clamped — and
 * against the hooks it owes: one redraw, one save, and a snapshot out in front
 * of it. The mat's redraw and the autosave are wrapped and counted at load,
 * because "one render and one save however many rows moved" is a promise that
 * can only be held to by counting.
 *
 * ── And the two ends of it ────────────────────────────────────────────────
 *
 * The way in is the readout's lands figure, which used to raise a mana panel
 * of its own out of that line. The check absorbed it — the panel drew pips
 * against sources per colour, and the check draws the same comparison with the
 * requirement beside it and the fix underneath — so the figure is a door now.
 * What the panel used to say is asserted here; test/deckmana.test.js keeps the
 * pass those numbers are read off.
 *
 * The way out is the Mana Base Calculator, which was *not* absorbed: it is the
 * only thing in the app that works with no deck loaded, and every number on
 * this tab is read off the deck on the mat. It keeps one line at the foot of
 * the tab, and that line has to survive the empty deck, which is the case it
 * exists for.
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
  /* Two more lands that make blue, for the fix region: one nobody in the house
     has, and one whose colours a Bant deck may play. */
  'Command Tower': { name: 'Command Tower', type_line: 'Land', cmc: 0,
    produced_mana: ['W', 'U', 'B', 'R', 'G'], color_identity: [] },
  'Yavimaya Coast': { name: 'Yavimaya Coast', type_line: 'Land', cmc: 0,
    produced_mana: ['G', 'U', 'C'], color_identity: ['G', 'U'] },
  /* A Golgari commander whose black is in an activated ability rather than in
     its cost — the spec's own example of why "every colour" cannot mean the
     commander's identity. */
  'Nemata, Primeval Warden': { name: 'Nemata, Primeval Warden',
    type_line: 'Legendary Creature — Treefolk Warrior', cmc: 5, mana_cost: '{4}{G}',
    color_identity: ['B', 'G'] },
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

  /* And the rest of the six the optimizer writes to, plus the two basics a
     coloured deck's budget leaves alone: a snow basic, which _dbIsBasic()
     passes and no colour on the split names, and Wastes, which is one of the
     six but is only managed where {C} is what the split is made of. The pair
     is what keeps "unmanaged" from being a hand-wave about snow. */
  'Plains': { name: 'Plains', type_line: 'Basic Land — Plains', cmc: 0,
    produced_mana: ['W'], color_identity: [] },
  'Swamp': { name: 'Swamp', type_line: 'Basic Land — Swamp', cmc: 0,
    produced_mana: ['B'], color_identity: [] },
  'Mountain': { name: 'Mountain', type_line: 'Basic Land — Mountain', cmc: 0,
    produced_mana: ['R'], color_identity: [] },
  'Wastes': { name: 'Wastes', type_line: 'Basic Land', cmc: 0,
    produced_mana: ['C'], color_identity: [] },
  'Snow-Covered Forest': { name: 'Snow-Covered Forest', type_line: 'Basic Snow Land — Forest',
    cmc: 0, produced_mana: ['G'], color_identity: [] },
  /* A cost with a {C} pip in it, which is not the same thing as a generic one:
     the split has a rule about {C} and a deck with no way to ask for one could
     not exercise it. */
  'Warping Wail': { name: 'Warping Wail', type_line: 'Instant', cmc: 2,
    mana_cost: '{1}{C}', color_identity: [] },
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
const sfCard = name => ({ name, ...CARDS[name], image_uris: { normal: `/img/${name}.jpg` } });

/* What Scryfall answers, by the query it is asked. Anything not on this list
 * is answered the way Scryfall answers a query that matches nothing, which is
 * a 404 rather than an empty list — a mono-white deck asking about triomes is
 * the ordinary case, not a failure. */
const ANSWERS = {
  'is:shockland id<=wug': ['Hallowed Fountain', 'Breeding Pool', 'Temple Garden'],
  'is:shockland id<=wu':  ['Hallowed Fountain'],
  'is:shockland':         ['Hallowed Fountain', 'Breeding Pool', 'Temple Garden'],
  /* And what makes blue in this deck's colours, in the order Scryfall returns
     it — which is play rate, because that is what the tab asks it to order by.
     Breeding Pool is the one on Tim's shelf; Hallowed Fountain is the one the
     deck already runs. */
  't:land produces:u -t:basic id<=wug':
    ['Hallowed Fountain', 'Command Tower', 'Breeding Pool', 'Yavimaya Coast'],
};

function loadTab({ deck = DECK, commander = COMMANDER, user = AS_TIM,
                   answers = ANSWERS, collections = SHELVES,
                   /* The browser's own store, handed in — which is how a
                      preference that outlives one visit is asserted at all: a
                      second load over the same Map is the next reload. */
                   store = new Map() } = {}) {
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
    /* Every request the app makes that is not Scryfall's — which on this tab
       is the snapshot the optimizer takes in front of its write, and nothing
       else. Recorded rather than merely answered: whether a snapshot went out
       before the deck changed is half of what "it owes the same hooks the edit
       module calls" means. */
    posted: [],
    fetch: async (url, opts) => {
      sandbox.posted.push({ url, ...opts });
      return { ok: true, status: 200, json: async () => ({ ok: true, version: 1 }) };
    },
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
  /* The facts, as the app's own load path hands them over — for the tests that
     take a card out of the cache and then need it to come back. */
  sandbox.CARD_FACTS = CARDS;
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  for (const file of ['state.js', 'sortui.js', 'cardturn.js', 'cardstack.js', 'cardquery.js',
                      'auth.js', 'collections.js', 'owned.js', 'lands.js',
                      'deckview-boards.js', 'deckview-core.js', 'deckview-render.js',
                      'deckview-edit.js', 'deckview-panels.js', 'deckview-history.js',
                      'deckview-owned.js', 'deckview-totals.js', 'deckview-legality.js',
                      'deckview-mana.js', 'deckview-landbase.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));
  /* The preview as the tab drew it, for the reads that happen before anything
     has patched it in place. */
  const _preview = () =>
    (el('dbLandsContent').innerHTML.match(
      /<div id="dbBasicsPreview"[^>]*>([\s\S]*?)<\/div>\s*<div class="db-sources-limit">/) || [, ''])[1];

  run(`currentUser = ${JSON.stringify(user)}`);
  run(`hydrateState(${JSON.stringify({ players: PLAYERS, collections })})`);
  run(`dbDeck = { id: 'd1', playerId: 'p-tim', name: 'A deck', commander: '' }`);
  run(`dbCards = ${JSON.stringify(
    [...deck, ...(commander ? [commander] : [])]
      .map((c, i) => ({ qty: 1, board: 'main', position: i, ...c })))}`);
  run(`dbCats = ${JSON.stringify(['Ramp', 'Lands', 'Creatures'].map((name, i) => ({ name, position: i })))}`);
  run(`dbCardData = new Map(${JSON.stringify(Object.entries(CARDS))})`);

  /* The mat's redraw and the autosave, counted. The optimizer's promise is one
     of each however many rows it moves, and the only way to hold it to that is
     to count them. Wrapped rather than replaced, so what they do still
     happens. */
  run(`_dbRenderCalls = 0; _dbSaveCalls = 0;
       { const r = dbRender;         dbRender = (...a) => { _dbRenderCalls++; return r(...a); };
         const s = _dbScheduleSave;  _dbScheduleSave = (...a) => { _dbSaveCalls++; return s(...a); }; }`);

  return {
    run, answer, el, store,
    /** Every Scryfall query the tab has asked, in order. */
    asked: () => sandbox.asked.map(u => new URL(u, 'http://x').searchParams.get('q')),
    /** The tab, switched to. */
    open() { run(`dbSetLeftTab('lands')`); return el('dbLandsContent').innerHTML; },
    /** The check's small print, spread out — "how this is read", pressed. */
    how() { run('dbToggleSourcesFoot()'); return el('dbLandsContent').innerHTML; },
    html: () => el('dbLandsContent').innerHTML,
    /** A section, pressed — settled by the time this resolves. */
    toggle(id) { return run(`dbToggleLandSection('${id}')`); },
    /** The tab drawn again, and whatever that made it go and ask for. */
    render() {
      run('_dbRenderLands()');
      return run('Promise.all([..._dbLandAsking.values()])');
    },
    /** The check at the top of the tab, as figures rather than as markup. */
    check: () => answer('dbSourcesCheck()'),

    // ── The optimizer ─────────────────────────────────────────────────────
    /** What it would do for a budget, as figures. */
    plan: n => answer(`dbBasicsPlan(${n})`),
    /** The split on its own, for the rules that are about the split alone. */
    split: (slots, pips) => answer(`dbBasicsSplit(${slots}, ${JSON.stringify(pips)})`),
    /** A number typed into the field — which is what a person does, not a call. */
    type(n) { el('dbBasicsN').value = String(n); run('dbBasicsTyped()'); },
    /** The "at least 1 basic of every colour" box, ticked or cleared. */
    oneEach(on) { el('dbBasicsEachBox').checked = on; run(`dbSetBasicsOneEach(${!!on})`); },
    /* The preview on its own. In the browser it is a child of the tab, so
       patching it is patching what you see; here they are two objects, and
       this is the one the repaint writes to — so it, where it has anything,
       is the freshest answer. */
    preview: () => el('dbBasicsPreview').innerHTML || _preview(),
    /** The word on the button, which says which press the next one is. */
    button: () => el('dbBasicsGo').textContent,
    /** The button. */
    press() { return run('dbBasicsPress()'); },
    /** The deck as it stands, and the piles it is filed into. */
    cards: () => answer('dbCards'),
    cats:  () => answer('dbCats.map(c => c.name)'),
    /** How many times the mat has been redrawn and the save scheduled. */
    renders: () => run('_dbRenderCalls'),
    saves:   () => run('_dbSaveCalls'),
    /** The reason on every snapshot taken, in order. */
    snapshots: () => sandbox.posted
      .filter(p => /\/snapshots$/.test(p.url))
      .map(p => JSON.parse(p.body).reason),
    /** The rows the preview is showing, as it writes them. */
    previewRows: () => [...(el('dbBasicsPreview').innerHTML || _preview())
      .matchAll(/db-basics-card">([^<]+)<\/span>\s*<span class="db-basics-fig">([\s\S]*?)<\/span>/g)]
      .map(m => `${m[1]} ${m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()}`),
    /** The colours the fix region offers to close, as it labels them. */
    fixes: () => [...el('dbLandsContent').innerHTML
      .matchAll(/db-fix-name">([^<]+)/g)].map(m => m[1]),
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

test('the readout’s lands figure is what opens the tab', () => {
  /* The figure used to raise a mana panel out of the readout, which drew pips
     against sources per colour. The check above draws the same comparison with
     the requirement beside it and the fix underneath, so the figure is a door
     here rather than a second reading ten pixels away. */
  const tab = loadTab();
  assert.notStrictEqual(tab.run('dbLeftTab'), 'lands', 'the drawer arrives on this tab');
  tab.run('dbOpenLandsTab()');
  assert.strictEqual(tab.run('dbLeftTab'), 'lands');
  assert.ok(tab.el('dbSearchPanel').classList.contains('open'),
    'the tab was switched to inside a drawer nobody opened');
  assert.ok(tab.html().includes('db-sources-row'), 'and it arrived without its check');
});

test('the tab keeps one line out to the calculator, and keeps it with no deck', () => {
  /* The Mana Base Calculator was not absorbed and will not be: it is the only
     thing in the app that works with no deck loaded, which is exactly the case
     every number on this tab cannot serve. So the line is at the foot of the
     tab whatever the deck is — including the deck that is not there yet, which
     is what it is for. */
  const tab = loadTab();
  tab.open();
  assert.strictEqual((tab.html().match(/dbOpenInCalculator\(\)/g) || []).length, 1,
    'the tab has no way out to the calculator, or more than one');
  assert.match(tab.html(), /Mana Base Calculator/);

  const empty = loadTab({ deck: [], commander: null });
  empty.open();
  assert.ok(!empty.html().includes('db-sources-row'), 'an empty deck was drawn a check');
  assert.match(empty.html(), /dbOpenInCalculator\(\)/,
    'the way out went away with the check, in the one case it is most wanted');
});

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
  tab.open();
  assert.match(tab.how(), /15 lands/, 'the panel did not say which row it read');
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
  /* Small print, so it is folded — but folded is not missing: one press on
     "how this is read" and the assumptions are there, the same way the
     per-card list is one press behind the headline. */
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Island',          qty: 14, category: 'Lands' },
    { card_name: 'Cryptic Command', category: 'Ramp' }] });
  assert.doesNotMatch(tab.open(), /untapped/i, 'the small print arrived spread out');
  const html = tab.how();
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
     number the table does not hold and letting somebody go looking for it. It
     is small print, so it is behind "how this is read" — but it is there. */
  tab.open();
  const html = tab.how();
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
  tab.open();
  assert.ok(!tab.how().includes('two colours at once'),
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

// ── Fix it ────────────────────────────────────────────────────────────────
/* The region between the check and the cycles, and the one the spec says
 * could not exist on Archidekt: for a colour the check calls short, the lands
 * that would close it, with the copies somebody in the house already has at
 * the front. A suggestion you can play tonight beats a better one you would
 * have to buy. */

test('a colour the check calls short is offered a way to close it', () => {
  /* One section per short colour, named for the gap it would close — the
     check's own figure, said again where the fix for it is, so the two halves
     of the panel cannot disagree about how short blue is. */
  const tab = loadTab();
  tab.open();
  assert.deepStrictEqual(tab.fixes(), ['white — 10 short', 'blue — 10 short', 'green — 13 short'],
    'the short colours are not offered, or not in the order the check reports them');
});

test('a deck that clears every bar is told so, rather than shown nothing', () => {
  /* An empty region under a heading reads as a region that failed to load.
     "Nothing to fix" is a finding, and it is the one the whole tab is for. */
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Forest',    qty: 20, category: 'Lands' },
    { card_name: 'Cultivate', category: 'Ramp' }] });
  const html = tab.open();
  assert.deepStrictEqual(tab.fixes(), [], 'a colour that clears its bar was offered a fix');
  assert.ok(/nothing to fix/i.test(html), 'the region went quiet instead of saying it is resolved');
});

test('opening the tab still asks Scryfall nothing, fix sections and all', () => {
  const tab = loadTab();
  tab.open();
  assert.deepStrictEqual(tab.asked(), [],
    'the fix region fired requests for colours nobody had opened');
  assert.ok(!tab.open().includes('sf-grid'), 'a closed fix section drew a grid');
});

test('a short colour is asked about under Scryfall’s spelling', () => {
  /* The sentence itself, the way the cycles' is: `produces:` is what makes a
     land a source of a colour, `t:land` keeps a Signet out of a list the
     check would not count it in, and `-t:basic` keeps Island off the top of
     every list of what makes blue. */
  const tab = loadTab();
  assert.strictEqual(tab.answer(`dbFixQuery('U', 'WUG')`),
    't:land produces:u -t:basic id<=wug');
  assert.strictEqual(tab.answer(`dbFixQuery('C', 'C')`), 't:land produces:c -t:basic id<=c',
    'a colourless deck short of colourless was asked a different question');
  assert.strictEqual(tab.answer(`dbFixQuery('G', '')`), 't:land produces:g -t:basic',
    'an empty filter was sent as one');
});

test('opening a short colour asks for the lands that make it, in the deck’s colours', async () => {
  /* One request, and the same colour filter the cycles are asked under: a
     land the deck may not play is not a fix for anything. Basics are left out
     — every deck can add those, and sorted by play rate they would be the top
     of every list. */
  const tab = loadTab();
  tab.open();
  await tab.toggle('fix:U');
  assert.deepStrictEqual(tab.asked(), ['t:land produces:u -t:basic id<=wug'],
    'the fix asked Magic the wrong question');
  assert.ok(tab.tiles().includes('Command Tower'), 'the lands that make blue are not in the section');
});

test('a land somebody has sorts above one nobody has, and play rate does the rest', async () => {
  /* The whole reason this region could not exist on Archidekt. Breeding Pool
     is the only one of them on a shelf in the house and the third most played,
     so it goes first; the rest keep the order Scryfall gave them, which is
     play rate. (The Hallowed Fountain Scryfall also answered with is already
     in the deck, and a singleton deck cannot hold a second — see below.) */
  const tab = loadTab();
  tab.open();
  await tab.toggle('fix:U');
  assert.deepStrictEqual(tab.tiles(), ['Breeding Pool', 'Command Tower', 'Yavimaya Coast'],
    'the copy in the box did not come first, or play rate stopped ordering the rest');
});

test('somebody else’s box is a copy in the house too', async () => {
  /* "Owned" here is the group's shelves and not the scope the rest of the app
     is on: the mark on the tile already says whose, and a land in Anna's box
     is one this table can be sat down with tonight. */
  const tab = loadTab({ collections: [
    { key: 'c:tim', name: 'Tim’s box', source: 'csv-moxfield', color: '#a855f7', owner: 'p-tim',
      cards: { 'Breeding Pool': { name: 'Breeding Pool', qty: 1 } } },
    { key: 'c:anna', name: 'Anna’s box', source: 'csv-moxfield', color: '#22d3ee', owner: 'p-anna',
      cards: { 'Yavimaya Coast': { name: 'Yavimaya Coast', qty: 1 } } },
  ] });
  tab.open();
  await tab.toggle('fix:U');
  assert.deepStrictEqual(tab.tiles(), ['Breeding Pool', 'Yavimaya Coast', 'Command Tower'],
    'a land in somebody else’s box was sorted as one nobody has');
});

test('a suggestion is the drawer’s own tile, with a + that adds', async () => {
  /* The same tile the cycles and Search draw, so a land found because blue
     was short and a land found by searching for it are the same card in the
     same grid — the mark on it, the price, and a + that goes wherever the
     drawer's "Add to" points. */
  const tab = loadTab();
  tab.open();
  await tab.toggle('fix:U');
  assert.match(tab.html(), /dbAddFromDrawer\('Command Tower'\)/,
    'the + does not add through the drawer’s own add');

  await tab.run(`dbAddFromDrawer('Command Tower')`);
  assert.deepStrictEqual(
    tab.answer(`dbCards.filter(c => c.card_name === 'Command Tower').map(c => c.board)`),
    ['main'], 'the + did not put the land in the deck');
  assert.notStrictEqual(tab.answer(`cardOwnMark('Breeding Pool')`), '',
    'the ownership mark has nothing to say about a card on the shelf');
});

test('a land the deck already runs is not offered as the fix for a singleton deck', async () => {
  /* The deck holds the Hallowed Fountain, and Commander is singleton, so it
     cannot be added again: a suggestion that cannot be taken is not one. The
     copy limit is the legality tab's, so a land a card lets you run any
     number of stays offered. */
  const tab = loadTab();
  tab.open();
  await tab.toggle('fix:U');
  assert.ok(!tab.tiles().includes('Hallowed Fountain'),
    'a land the deck cannot hold a second of was offered as the fix');
});

test('a 60-card deck is offered a second copy of a land it already runs', async () => {
  /* Four is the limit there, so one Hallowed Fountain in the deck is three
     more blue sources somebody can still add. */
  const tab = loadTab({ commander: null, deck: [
    { card_name: 'Cultivate',         category: 'Ramp' },
    { card_name: 'Cryptic Command',   category: 'Ramp' },
    { card_name: 'Hallowed Fountain', category: 'Lands' }] });
  tab.open();
  await tab.toggle('fix:U');
  assert.deepStrictEqual(tab.asked(), ['t:land produces:u -t:basic id<=wug'],
    'a deck with no commander was not asked about in its own colours');
  assert.ok(tab.tiles().includes('Hallowed Fountain'),
    'a deck that may run four of them was told it could run no more');
});

/* Twenty lands that make green, more than a region meant to be read can show,
 * with the two on a shelf lying well down the play-rate order. */
const GREENS = Array.from({ length: 20 }, (_, i) => `Green ${i + 1}`);

test('a long list is cut to what can be read, and everything somebody has survives the cut', async () => {
  /* The cut is the region's whole claim, so it is made in the order the
     region sorts in: a copy in a box is never the thing dropped to make room
     for a land nobody has. */
  const tab = loadTab({
    answers: { ...ANSWERS, 't:land produces:g -t:basic id<=wug': GREENS },
    collections: [{ key: 'c:tim', name: 'Tim’s box', source: 'csv-moxfield',
                    color: '#a855f7', owner: 'p-tim', cards: {
                      'Green 15': { name: 'Green 15', qty: 1 },
                      'Green 20': { name: 'Green 20', qty: 1 } } }],
  });
  tab.open();
  await tab.toggle('fix:G');
  assert.deepStrictEqual(tab.tiles(),
    ['Green 15', 'Green 20', ...GREENS.slice(0, 10)],
    'the cut dropped a land somebody has, or stopped following play rate');
  assert.match(tab.html(), /Showing 12 of the 20 lands that make green/,
    'the region showed twelve of twenty without saying so');
});

test('a list that fits is shown whole, and says nothing about what it left out', async () => {
  /* Three of the four Scryfall answered with, and the fourth is only missing
     because the deck already runs it — so there is nothing this list is a
     slice of, and a line saying what it left out would be a line about
     nothing. */
  const tab = loadTab();
  tab.open();
  await tab.toggle('fix:U');
  assert.ok(!/Showing/.test(tab.html()),
    'a region showing everything it had claimed there was more');
});

test('a colour that has been fixed stops being offered', async () => {
  /* The region is read off the check, and the check is read off the deck, so
     a land added while the section is open is a section that closes itself.
     Twenty Islands is more blue than the table wants. */
  const tab = loadTab();
  tab.open();
  await tab.toggle('fix:U');
  assert.ok(tab.fixes().some(f => f.startsWith('blue')), 'blue was not short to begin with');

  tab.run(`dbCards.push({ card_name: 'Island', qty: 20, board: 'main',
                          category: 'Lands', position: 9 }); dbManaChanged()`);
  await tab.render();
  assert.ok(!tab.fixes().some(f => f.startsWith('blue')),
    'a colour that clears its bar was still offered a fix for it');
  assert.ok(!tab.tiles().includes('Command Tower'),
    'the grid for a fixed colour was left standing under it');
});

test('a new deck arrives with the fix sections shut, and the argument with it', async () => {
  /* Which colours you had spread out is a fact about the deck you were
     building — as is whether you had gone looking for the cards behind the
     headline. */
  const tab = loadTab();
  tab.open();
  await tab.toggle('fix:U');
  tab.run('dbToggleSourcesShort()');
  assert.ok(tab.html().includes('db-sources-short-row'), 'the per-card list did not open');

  tab.run('_dbLandsClose()');
  assert.deepStrictEqual(tab.tiles(), [], 'the last deck’s fix sections were still spread out');
  assert.ok(!tab.html().includes('db-sources-short-row'),
    'the last deck’s argument was still spread out over the next one');
});

test('a colour whose every land is already in the deck says that, not "nothing makes it"', async () => {
  /* The two nothings are different findings. "Nothing that makes blue is in
     these colours" is Magic's answer; "you already run all of them" is the
     deck's, and telling somebody the first when the second is true sends them
     looking for a card that is on the mat in front of them. */
  const tab = loadTab({
    answers: { ...ANSWERS, 't:land produces:u -t:basic id<=wug': ['Hallowed Fountain'] },
  });
  tab.open();
  await tab.toggle('fix:U');
  assert.deepStrictEqual(tab.tiles(), [], 'a land the deck already runs was offered anyway');
  assert.match(tab.html(), /already in the deck/i,
    'the deck was told Magic has nothing, when what it has is all of it');
});

// ── Optimize basics: the budget, split ────────────────────────────────────
/* The control the spec puts underneath the check, and the first thing in the
 * app to write a calculation into a deck. Four things are asserted, which are
 * the four places it can be wrong: the split, the basics it is not allowed to
 * touch, the two rules about {C}, and the write.
 *
 * The deck below is the worked example. Chulane costs {2}{G}{W}{U}, Cryptic
 * Command {1}{U}{U}{U} and Cultivate {2}{G}, so the deck's pips are one white,
 * four blue and two green — seven of them — and 23 basics split by largest
 * remainder is 3 Plains, 13 Islands and 7 Forests. Those numbers are worked
 * out here rather than read off the implementation, which is the whole reason
 * to write them down. */
const BASICS_DECK = [
  { card_name: 'Cryptic Command', category: 'Spells' },
  { card_name: 'Cultivate',       category: 'Ramp' },
  { card_name: 'Plains',          category: 'Lands', qty: 8 },
  { card_name: 'Island',          category: 'Lands', qty: 9 },
  { card_name: 'Forest',          category: 'Lands', qty: 6 },
];

/** The deck's basic rows, as name → quantity. */
const basicsOf = tab => Object.fromEntries(tab.cards()
  .filter(c => ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'].includes(c.card_name))
  .map(c => [c.card_name, c.qty]));

test('the split is proportional to the deck’s pips and sums to the budget', () => {
  const tab  = loadTab({ deck: BASICS_DECK });
  const plan = tab.plan(23);
  const to   = Object.fromEntries(plan.rows.map(r => [r.name, r.to]));
  assert.deepStrictEqual(to, { Plains: 3, Island: 13, Forest: 7 },
    'the split is not proportional to one white, four blue and two green pips');
  assert.strictEqual(Object.values(to).reduce((n, v) => n + v, 0), 23,
    'the split does not add up to the budget');
});

test('the odd basic goes to the largest remainder, so nothing is lost to rounding', () => {
  const tab = loadTab({ deck: BASICS_DECK });
  /* 23 over 1:4:2 is 3.29, 13.14, 6.57 — the floors are 22, and the one left
     over belongs to green, whose fraction is the largest. A split that dropped
     it, or handed it to the biggest colour instead of the biggest remainder,
     is the failure this catches. */
  assert.deepStrictEqual(tab.split(23, { W: 1, U: 4, B: 0, R: 0, G: 2, C: 0 }),
    { W: 3, U: 13, B: 0, R: 0, G: 7, C: 0 });
  for (const budget of [0, 1, 7, 14, 23, 40, 99]) {
    const split = tab.split(budget, { W: 1, U: 4, B: 0, R: 0, G: 2, C: 0 });
    assert.strictEqual(Object.values(split).reduce((n, v) => n + v, 0), budget,
      `a budget of ${budget} did not come out whole`);
  }
});

test('{C} sits out of the split, and takes no slot from a colour', () => {
  const tab = loadTab({ deck: BASICS_DECK });
  /* Two colourless pips do not want two Wastes. The slot a proportional split
     would hand one is a slot taken from a colour that needed it. */
  assert.deepStrictEqual(tab.split(23, { W: 1, U: 4, B: 0, R: 0, G: 2, C: 5 }),
    { W: 3, U: 13, B: 0, R: 0, G: 7, C: 0 },
    'colourless pips moved basics away from the colours');
});

test('a deck with no coloured pips at all splits entirely into Wastes', () => {
  const tab = loadTab({ deck: BASICS_DECK });
  /* The rule completed rather than contradicted: {C} never competes with a
     colour, and with no colour to compete against it is simply the answer. */
  assert.deepStrictEqual(tab.split(12, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 }),
    { W: 0, U: 0, B: 0, R: 0, G: 0, C: 12 });
});

test('a deck that asks for no colour at all has nowhere to put a budget, and says so', () => {
  const tab = loadTab({ deck: [{ card_name: 'Plains', category: 'Lands', qty: 5 }], commander: null });
  const plan = tab.plan(10);
  assert.strictEqual(plan.nowhere, true, 'a budget was split over a deck with no pips in it');
  assert.ok(Object.values(tab.split(10, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }))
    .every(n => n === 0), 'basics were invented for a deck that asks for nothing');
});

test('a budget of nought is a deck with no basics in it', () => {
  const tab  = loadTab({ deck: BASICS_DECK });
  const plan = tab.plan(0);
  assert.deepStrictEqual(plan.rows.map(r => r.to), [0, 0, 0],
    'a budget of nought left basics behind');
});

// ── At least 1 basic of every colour ─────────────────────────────────────
/* The one override beside the optimizer, and the reason it can afford to be
 * off by default: the preview says the moment it would have mattered.
 *
 * The numbers below are worked out by hand from the same seven pips the split
 * tests above are read off — one white, four blue, two green. A budget of 3
 * over 1:4:2 is 0.43, 1.71, 0.86: the floors are 1, the two left over go to
 * the two largest fractions, green and blue, and white comes out at nought.
 * That is the deck this section is about.
 */

test('the toggle is off until it is turned on, and is still on for the next deck', () => {
  /* Read off the attribute rather than off the tag, because the handler beside
     it is written `dbSetBasicsOneEach(this.checked)` and a looser match would
     find the word there. */
  const ticked = html => /id="dbBasicsEachBox" checked/.test(html);

  const first = loadTab({ deck: BASICS_DECK });
  assert.match(first.open(), /id="dbBasicsEachBox"/, 'the override is not on the tab at all');
  assert.strictEqual(ticked(first.html()), false,
    'the override arrived already on, which makes the proportional split the override');

  first.oneEach(true);
  assert.strictEqual(ticked(first.open()), true,
    'the box did not come back ticked in the tab it was ticked in');

  /* A different deck, in a later visit — a second load over the same store is
     the next reload, and DECK is a different list from the one it was ticked
     on. It is kept the way dbAddTo() is kept because it is the same kind of
     thing: a way of working, not a fact about any one list. */
  const later = loadTab({ deck: DECK, store: first.store });
  assert.strictEqual(ticked(later.open()), true,
    'the override was forgotten between decks, or between visits');
  assert.strictEqual(first.store.get('mtgtools_db_basics_one_each'), '1');
});

test('on, every colour the deck has pips in gets one, and the split still adds up', () => {
  const tab = loadTab({ deck: BASICS_DECK });
  tab.oneEach(true);
  assert.deepStrictEqual(tab.split(3, { W: 1, U: 4, B: 0, R: 0, G: 2, C: 0 }),
    { W: 1, U: 1, B: 0, R: 0, G: 1, C: 0 },
    'a colour the deck asks for was left with no basic at all');
  for (const budget of [3, 4, 7, 14, 23, 40, 99]) {
    const split = tab.split(budget, { W: 1, U: 4, B: 0, R: 0, G: 2, C: 0 });
    assert.strictEqual(Object.values(split).reduce((n, v) => n + v, 0), budget,
      `a budget of ${budget} did not come out whole with the floor on`);
    for (const id of ['W', 'U', 'G']) {
      assert.ok(split[id] >= 1, `${id} went without at a budget of ${budget}`);
    }
    assert.strictEqual(split.B + split.R + split.C, 0,
      `a colour with no pips in it was given a basic at a budget of ${budget}`);
  }
});

test('a split that already seats every colour is left exactly as it was', () => {
  /* The property that makes this an override rather than a second algorithm.
     Reserving a slot per colour up front and splitting the remainder would
     turn 3/13/7 into 4/12/7 on a deck that never had a colour at risk, which
     is a switch nobody can predict the effect of. */
  const tab = loadTab({ deck: BASICS_DECK });
  const pips = { W: 1, U: 4, B: 0, R: 0, G: 2, C: 0 };
  const off  = tab.split(23, pips);
  tab.oneEach(true);
  assert.deepStrictEqual(tab.split(23, pips), off);
  assert.deepStrictEqual(off, { W: 3, U: 13, B: 0, R: 0, G: 7, C: 0 });
});

test('the basic comes off the colour furthest above its share, not off the largest', () => {
  const tab = loadTab({ deck: BASICS_DECK });
  tab.oneEach(true);
  /* 6 over 1:9:8 is 0.33, 3.00, 2.67 — floors 0, 3, 2, and the one left over
     goes to black, whose fraction is the largest. So white needs a basic and
     blue and black are level on three apiece. Blue is exactly on its share and
     black is a third of a basic above it, holding the slot rounding just gave
     it, so black is the one that pays. A rule that took from the largest pile
     would have to toss a coin here. */
  assert.deepStrictEqual(tab.split(6, { W: 1, U: 9, B: 8, R: 0, G: 0, C: 0 }),
    { W: 1, U: 3, B: 2, R: 0, G: 0, C: 0 });
});

test('a colour is never starved to feed another one', () => {
  const tab = loadTab({ deck: BASICS_DECK });
  tab.oneEach(true);
  /* Two slots and three colours: there is no split that honours the floor, and
     a repair that took blue's last basic to give white one would only move the
     hole. The colours the deck asks for most are the ones seated, and the
     preview is where white being unmakeable gets said. */
  const split = tab.split(2, { W: 1, U: 4, B: 0, R: 0, G: 2, C: 0 });
  assert.deepStrictEqual(split, { W: 0, U: 1, B: 0, R: 0, G: 1, C: 0 });
  assert.strictEqual(Object.values(split).reduce((n, v) => n + v, 0), 2,
    'the budget stopped adding up where it could not be honoured');
});

test('an override that could not be honoured says so in its own words', () => {
  /* The failure this catches is the quiet one. White is at nought under a
     ticked box, and the sentence the off state would use for that — "white
     rounded to 0 basics" — reads as the proportional split having chosen it.
     A switch that is on and not keeping its promise has to say which. */
  const tab = loadTab({ deck: BASICS_DECK });
  tab.open();
  tab.oneEach(true);
  tab.type(2);
  tab.press();
  assert.deepStrictEqual(tab.plan(2).unseated.map(c => c.id), ['W']);
  assert.match(tab.preview(),
    /a budget of 2 cannot give every colour one — white goes without/,
    'the override ran out of budget and did not say so');
});

test('with the override off, nothing is ever reported as unseated', () => {
  /* The pair with the test above: off, a colour at nought is the split's
     answer and not a promise broken, and the preview has its own sentence for
     it. Two findings, two states, and neither borrows the other's words. */
  const tab = loadTab({ deck: BASICS_DECK });
  assert.deepStrictEqual(tab.plan(2).unseated, []);
  assert.deepStrictEqual(tab.plan(3).starved.map(c => c.id), ['W']);
});

test('“every colour” is the colours with pips, not the commander’s identity', () => {
  /* Nemata is a Golgari commander whose black is an activated ability. Nothing
     in this deck costs black, so a forced Swamp would be a basic for a colour
     nothing asks for — which is the whole reason the rule is written in pips. */
  const tab = loadTab({
    deck: [{ card_name: 'Cultivate', category: 'Ramp' },
           { card_name: 'Forest', category: 'Lands', qty: 10 }],
    commander: { card_name: 'Nemata, Primeval Warden', category: 'Creatures',
                 board: 'commander' },
  });
  tab.oneEach(true);
  const to = Object.fromEntries(tab.plan(10).rows.map(r => [r.name, r.to]));
  assert.deepStrictEqual(to, { Forest: 10 },
    'a colour the commander merely permits was given a basic of its own');
});

test('the whole budget goes in on the second press, one basic of each colour and all', async () => {
  const tab = loadTab({ deck: BASICS_DECK });
  tab.open();
  tab.oneEach(true);
  tab.type(3);
  await tab.press();
  await tab.press();
  assert.deepStrictEqual(basicsOf(tab), { Plains: 1, Island: 1, Forest: 1 },
    'the override was previewed and then not written');
});

// ── Off, and the moment it would have mattered ────────────────────────────

test('a colour that rounds to nothing, in a deck that cannot otherwise make it, is said', () => {
  const tab = loadTab({ deck: BASICS_DECK });
  const plan = tab.plan(3);
  assert.deepStrictEqual(plan.starved.map(c => c.id), ['W'],
    'white was about to leave the deck and the plan did not notice');

  tab.open();
  tab.type(3);
  tab.press();
  assert.match(tab.preview(),
    /white rounded to 0 basics, and nothing else in the deck makes white/,
    'the preview let a colour out of the deck without saying so');
});

test('a colour something else makes is not flagged for rounding to nothing', () => {
  /* The other half of the rule, and the reason it is not simply "this row went
     to nought": a deck with a Temple Garden in it can still cast its white
     card. What the flag is about is the deck being unable to make a colour at
     all, which is the one finding the mana panel was ever willing to call a
     fault. */
  const tab = loadTab({ deck: [...BASICS_DECK, { card_name: 'Temple Garden', category: 'Lands' }] });
  assert.deepStrictEqual(tab.plan(3).starved, [],
    'a colour with a dual behind it was called unmakeable');
});

test('a basic the split is about to remove does not count as making its colour', () => {
  /* The trap the other way round: the Plains this is about to take out of the
     deck are green-lit sources right up until the write, so a flag that read
     dbDeckMana() straight would report white fine on its way out the door. */
  const tab = loadTab({ deck: BASICS_DECK });
  assert.strictEqual(tab.check().colours.find(c => c.id === 'W').held > 0, true,
    'the deck under test has no white sources to be fooled by');
  assert.deepStrictEqual(tab.plan(3).starved.map(c => c.id), ['W']);
});

test('the toggle repaints the plan without taking the field away mid-number', () => {
  const tab = loadTab({ deck: BASICS_DECK });
  tab.open();
  tab.type(3);
  tab.press();
  assert.match(tab.preview(), /white rounded to 0 basics/);

  tab.oneEach(true);
  assert.doesNotMatch(tab.preview(), /white rounded to 0 basics/,
    'the preview still showed the answer the toggle had just changed');
  assert.deepStrictEqual(tab.previewRows(),
    ['Plains 8 → 1', 'Island 9 → 1', 'Forest 6 → 1']);
  assert.strictEqual(tab.el('dbBasicsN').value, '3',
    'the number typed was thrown away by the flick of a switch');
  assert.strictEqual(tab.button(), 'Apply',
    'the plan on screen was no longer the one the next press would write');
});

// ── The basics the optimizer does not manage ──────────────────────────────

test('a snow basic comes off the budget and is named as untouched', () => {
  const tab = loadTab({ deck: [...BASICS_DECK,
    { card_name: 'Snow-Covered Forest', category: 'Lands', qty: 3 }] });
  const plan = tab.plan(14);
  assert.strictEqual(plan.extra, 3, 'the snow basics were not counted');
  assert.strictEqual(plan.slots, 11, 'the snow basics did not come off the budget');
  assert.strictEqual(plan.rows.reduce((n, r) => n + r.to, 0), 11,
    'the deck would have grown by three behind the number typed');
  assert.deepStrictEqual(plan.spare, [{ name: 'Snow-Covered Forest', qty: 3 }]);

  tab.open();
  tab.type(14);
  tab.press();
  assert.match(tab.html(), /3 Snow-Covered Forests aren’t touched — 11 to split/,
    'the preview did not name the basics it will not write to');
});

test('a deck with coloured pips keeps its Wastes through a re-split', () => {
  /* The pair with the test above is the point, and Wastes is the harder half
     of it: it is one of the six names, but {C} sits out of the split of a
     coloured deck — so a slot the split is not allowed to give it is a slot it
     must not be made to give up either. Managed by name and unwanted by the
     split is a row written to nought, which is the deck losing cards it was
     promised nobody would touch. */
  const tab = loadTab({ deck: [...BASICS_DECK, { card_name: 'Wastes', category: 'Lands', qty: 2 }] });
  const plan = tab.plan(23);
  assert.strictEqual(plan.extra, 2, 'the Wastes did not come off the budget');
  assert.strictEqual(plan.slots, 21, 'the deck would have grown by two behind the number typed');
  assert.deepStrictEqual(plan.rows.filter(r => r.name === 'Wastes'), [],
    'a deck with no colourless pips was about to lose its Wastes');
  assert.deepStrictEqual(plan.spare, [{ name: 'Wastes', qty: 2 }]);

  tab.open();
  tab.type(23);
  tab.press();
  assert.match(tab.html(), /2 Wastes aren’t touched — 21 to split/,
    'the preview did not name the Wastes it will not write to');
});

test('the write leaves those Wastes in the deck', async () => {
  /* The plan says untouched; this is the row still being there afterwards,
     because the branch that removes a colour going to nought is a different
     piece of code from the one that decides which colours there are. */
  const tab = loadTab({ deck: [...BASICS_DECK, { card_name: 'Wastes', category: 'Lands', qty: 2 }] });
  tab.open();
  tab.type(25);
  tab.press();
  await tab.press();
  assert.deepStrictEqual(basicsOf(tab), { Plains: 3, Island: 13, Forest: 7, Wastes: 2 },
    'the optimizer deleted the Wastes it had named as untouched');
});

test('a colourless deck’s Wastes is managed, and the split writes to it', async () => {
  /* The other side of the rule. Kozilek's deck has no colour for {C} to take a
     slot from, so Wastes is the whole split — and Wastes off the budget there
     would be a budget with nowhere at all to go. */
  const tab = loadTab({
    deck: [{ card_name: 'Warping Wail', category: 'Spells' },
           { card_name: 'Wastes', category: 'Lands', qty: 2 }],
    commander: { card_name: 'Kozilek, Butcher of Truth', category: 'Creatures',
                 board: 'commander' },
  });
  const plan = tab.plan(12);
  assert.strictEqual(plan.extra, 0, 'Wastes came off a budget with nowhere else to go');
  assert.deepStrictEqual(plan.spare, []);
  assert.deepStrictEqual(plan.rows,
    [{ id: 'C', name: 'Wastes', label: 'colourless', from: 2, to: 12 }],
    'the one basic a colourless deck can play was left out of its own split');

  tab.open();
  tab.type(12);
  tab.press();
  await tab.press();
  assert.deepStrictEqual(basicsOf(tab), { Wastes: 12 },
    'the split a colourless deck previewed was not written');
});

test('a deck that asks for no pip at all is inert, and its Wastes stays put', async () => {
  /* The deck between the two: all-generic Eldrazi, no colour and no {C} pip
     either. _dbBasicsWant() has no weight to give anything, so this is the
     "nowhere to put these" answer the optimizer already had — and the Wastes
     being spare is that same answer said about the basics rather than a second
     rule. What it must not be is a row on its way to nought. */
  const tab = loadTab({
    deck: [{ card_name: 'Sol Ring', category: 'Ramp' },
           { card_name: 'Wastes', category: 'Lands', qty: 2 }],
    commander: { card_name: 'Kozilek, Butcher of Truth', category: 'Creatures',
                 board: 'commander' },
  });
  const plan = tab.plan(12);
  assert.strictEqual(plan.nowhere, true, 'a budget was split over a deck that asks for nothing');
  assert.deepStrictEqual(plan.rows, [], 'a deck with nothing to split was given rows anyway');
  assert.deepStrictEqual(plan.spare, [{ name: 'Wastes', qty: 2 }]);

  tab.open();
  tab.type(12);
  await tab.press();
  await tab.press();
  assert.deepStrictEqual(basicsOf(tab), { Wastes: 2 },
    'the deck the optimizer had nothing to say about was written to anyway');
});

test('more unmanaged basics than the budget leaves nothing to split, and says that', () => {
  const tab = loadTab({ deck: [...BASICS_DECK,
    { card_name: 'Snow-Covered Forest', category: 'Lands', qty: 6 }] });
  const plan = tab.plan(4);
  assert.strictEqual(plan.over, true, 'the budget was not called for what it is');
  assert.strictEqual(plan.slots, 0, 'a negative number of basics was split');
  assert.strictEqual(plan.rows.reduce((n, r) => n + r.to, 0), 0);

  tab.open();
  tab.type(4);
  tab.press();
  assert.match(tab.html(), /already more than 4/,
    'the preview implied a budget it cannot reach');
});

// ── The preview ───────────────────────────────────────────────────────────

test('the field is prefilled with the basics the deck runs now', () => {
  const tab = loadTab({ deck: [...BASICS_DECK,
    { card_name: 'Snow-Covered Forest', category: 'Lands', qty: 3 }] });
  const html = tab.open();
  /* 8 + 9 + 6 + 3. The default press means "re-balance the basics I already
     have", which is only true if the number in the field is all of them. */
  assert.match(html, /id="dbBasicsN"[^>]*value="26"/,
    'the field did not arrive holding what the deck runs');
});

test('the preview shows the rows, the deck size and the land total', () => {
  const tab = loadTab({ deck: BASICS_DECK });
  tab.open();
  tab.type(26);
  tab.press();
  /* 26 over 1:4:2 is 3.71, 14.86, 7.43 — floors 3, 14, 7 with two left over,
     to the two largest remainders. */
  assert.deepStrictEqual(tab.previewRows(),
    ['Plains 8 → 4', 'Island 9 → 15', 'Forest 6 → 7']);
  /* Twenty-five cards, twenty-three of them lands; three more basics is three
     more of each. The size line is on the panel because growing the basics is
     what makes other cards have to go. */
  assert.match(tab.html(), /deck 25 → <strong>28<\/strong>[\s\S]*?lands 23 → <strong>26<\/strong>/,
    'the preview did not say what the deck would come to');
});

test('the preview says what the check would still call short', () => {
  const tab = loadTab({ deck: BASICS_DECK });
  tab.open();
  tab.type(23);
  tab.press();
  /* Cryptic Command is {1}{U}{U}{U}, which wants far more blue than 23 basics
     split three ways can make. The line is the reason the preview exists: the
     case worth catching is the split that cost three spells and fixed nothing. */
  const plan = tab.plan(23);
  assert.ok(plan.still.some(c => c.id === 'U' && c.gap > 0),
    'the deck was told a split it cannot make would clear blue');
  assert.match(tab.html(), /still short: [^<]*\bblue \d+[^<]*— lands, not basics/,
    'the preview did not say which colour the split could not reach');
});

test('a split that clears every bar is told so rather than left silent', () => {
  /* A deck whose only demand is one green pip, and enough basics to bury it. */
  const tab = loadTab({
    deck: [{ card_name: 'Cultivate', category: 'Ramp' },
           { card_name: 'Forest', category: 'Lands', qty: 30 }],
    commander: null,
  });
  tab.open();
  tab.type(30);
  tab.press();
  assert.match(tab.html(), /every colour clears its bar/,
    'a split that fixed everything said nothing about it');
});

// ── Two presses ───────────────────────────────────────────────────────────

test('nothing is written to the deck until a second, explicit press', () => {
  const tab = loadTab({ deck: BASICS_DECK });
  tab.open();
  tab.type(26);
  tab.press();
  assert.deepStrictEqual(basicsOf(tab), { Plains: 8, Island: 9, Forest: 6 },
    'the first press wrote to the deck');
  assert.strictEqual(tab.saves(), 0, 'the first press scheduled a save');
  assert.match(tab.html(), /id="dbBasicsGo"[^>]*>\s*Apply/,
    'the button did not become the one that writes');

  tab.press();
  assert.deepStrictEqual(basicsOf(tab), { Plains: 4, Island: 15, Forest: 7 },
    'the second press did not write the split that was on screen');
});

test('typing a different number takes the plan down, so the second press is never the first answer', () => {
  const tab = loadTab({ deck: BASICS_DECK });
  tab.open();
  tab.type(26);
  tab.press();
  assert.match(tab.html(), /id="dbBasicsGo"[^>]*>\s*Apply/);

  tab.type(14);
  assert.strictEqual(tab.el('dbBasicsPreview').innerHTML, '',
    'the plan for the old number stayed on screen');
  assert.strictEqual(tab.el('dbBasicsGo').textContent, 'Preview',
    'the button still offered to write the plan that is gone');

  tab.press();
  assert.deepStrictEqual(basicsOf(tab), { Plains: 8, Island: 9, Forest: 6 },
    'a number typed over a preview was applied without being previewed');
});

test('a press that would change nothing does not become a press that writes', () => {
  const tab = loadTab({ deck: [
    { card_name: 'Cryptic Command', category: 'Spells' },
    { card_name: 'Cultivate',       category: 'Ramp' },
    { card_name: 'Plains',          category: 'Lands', qty: 3 },
    { card_name: 'Island',          category: 'Lands', qty: 13 },
    { card_name: 'Forest',          category: 'Lands', qty: 7 },
  ] });
  tab.open();
  tab.type(23);
  tab.press();
  assert.match(tab.html(), /id="dbBasicsGo"[^>]*>\s*Preview/,
    'a plan that moves nothing offered to write itself');
  tab.press();
  assert.strictEqual(tab.saves(), 0, 'a deck already at its split was saved anyway');
});

// ── The write ─────────────────────────────────────────────────────────────

test('applying keeps each existing row where it was filed', async () => {
  const tab = loadTab({ deck: [...BASICS_DECK.filter(c => c.card_name !== 'Plains'),
    { card_name: 'Plains', category: 'Mana Base', qty: 8 }] });
  tab.open();
  tab.type(26);
  tab.press();
  await tab.press();
  const plains = tab.cards().find(c => c.card_name === 'Plains');
  assert.strictEqual(plains.category, 'Mana Base',
    'a Plains filed under a custom pile was refiled by the optimizer');
  assert.strictEqual(plains.qty, 4, 'the quantity was not set on the row that was already there');
});

test('a genuinely new row is filed as a land', async () => {
  /* A deck that wants black and holds no Swamp: the row has to be made, and
     dbAutoCategory() is what decides where it goes. */
  const tab = loadTab({
    deck: [{ card_name: 'Bedevil', category: 'Spells' },
           { card_name: 'Mountain', category: 'Lands', qty: 10 }],
    commander: null,
  });
  tab.open();
  tab.type(12);
  tab.press();
  await tab.press();
  const swamp = tab.cards().find(c => c.card_name === 'Swamp');
  assert.ok(swamp, 'the colour the deck wants was never given a basic');
  assert.strictEqual(swamp.category, 'Lands', 'a new basic was not filed as a land');
  assert.strictEqual(swamp.board, 'main', 'a new basic did not go into the deck');
  assert.ok(tab.cats().includes('Lands'), 'the pile it was filed into does not exist');
});

test('a colour going to nought is removed, not clamped at one', async () => {
  /* dbChangeQty() clamps at Math.max(1, …), and nothing else in the app takes
     a row to nothing in bulk. A Plains the split does not want has to go. */
  const tab = loadTab({ deck: [
    { card_name: 'Cryptic Command', category: 'Spells' },
    { card_name: 'Plains',  category: 'Lands', qty: 4 },
    { card_name: 'Island',  category: 'Lands', qty: 10 },
  ], commander: null });
  tab.open();
  tab.type(14);
  tab.press();
  await tab.press();
  assert.deepStrictEqual(basicsOf(tab), { Island: 14 },
    'a colour nothing in the deck asks for was left one lonely basic');
});

test('applying is one render and one save, however many rows moved', async () => {
  const tab = loadTab({ deck: BASICS_DECK });
  tab.open();
  tab.type(26);
  tab.press();
  const renders = tab.renders(), saves = tab.saves();
  await tab.press();
  assert.strictEqual(tab.renders() - renders, 1,
    'the mat was redrawn once per row instead of once per press');
  assert.strictEqual(tab.saves() - saves, 1, 'the deck was saved more than once');
});

test('a snapshot goes out in front of the write, and it names what it was taken for', async () => {
  const tab = loadTab({ deck: BASICS_DECK });
  tab.open();
  tab.type(26);
  tab.press();
  assert.deepStrictEqual(tab.snapshots(), [], 'a preview took a snapshot');
  await tab.press();
  assert.deepStrictEqual(tab.snapshots(), ['basics'],
    'the write went out without a copy of the deck it replaced');
});

test('the check redraws off the deck the write made, not the deck as it was', async () => {
  const tab = loadTab({ deck: BASICS_DECK });
  tab.open();
  assert.strictEqual(tab.check().colours.find(c => c.id === 'U').held, 9,
    'the fixture is not the deck this test thinks it is');
  tab.type(26);
  tab.press();
  await tab.press();
  /* Fifteen Islands and nothing else in the deck makes blue, so the number the
     check reports is the number the write made. A stale mana pass behind the
     drawer is the failure this catches. */
  assert.strictEqual(tab.check().colours.find(c => c.id === 'U').held, 15,
    'the check is still reading the deck from before the split');
  assert.match(tab.html(), /id="dbBasicsN"[^>]*value="26"/,
    'the field did not come back holding what the deck now runs');
  assert.strictEqual(tab.el('dbBasicsPreview').innerHTML, '',
    'the plan stayed on screen after it had been applied');
});

test('somebody else’s deck is a tab with no optimizer on it', () => {
  const tab = loadTab({ deck: BASICS_DECK, user: AS_ANNA });
  const html = tab.open();
  assert.ok(!html.includes('db-basics'), 'a deck that is not yours offered to rewrite its basics');
  assert.ok(html.includes('The check'), 'the readings went with the edit');

  tab.press();
  assert.deepStrictEqual(basicsOf(tab), { Plains: 8, Island: 9, Forest: 6 },
    'somebody else’s deck was rewritten by calling the function outright');
});

// ── The deck it cannot see ────────────────────────────────────────────────
/* Two ways the same hazard bites: a plan worked out against a deck the app has
 * not finished reading. The budget is the deck's total basics *after* this, so
 * a deck half of which is still in flight is a deck whose other half this
 * would quietly empty — which is the one kind of wrong a mana base cannot
 * survive, and the reason the check panel names its unknowns too. */

test('a deck that asks for no colour is not offered a press that empties it', async () => {
  /* Nothing in the deck has a pip, so the split can place nothing — and every
     basic already in it moves to nought. Drawing "there is nowhere to put
     these" over a button that would delete five Plains is the preview saying
     one thing and the press doing another. */
  const tab = loadTab({ deck: [{ card_name: 'Plains', category: 'Lands', qty: 5 }], commander: null });
  tab.open();
  tab.type(10);
  tab.press();
  assert.match(tab.html(), /id="dbBasicsGo"[^>]*>\s*Preview/,
    'a budget with nowhere to go offered to write itself');
  await tab.press();
  assert.deepStrictEqual(basicsOf(tab), { Plains: 5 },
    'the deck’s basics were thrown away for a split that could place none of them');
});

test('a basic whose facts have not arrived still comes off the budget', async () => {
  /* _dbBasicsHeld() reads the type line to know a Snow-Covered Forest is a
     basic, and a cache mid-refresh does not have one. Left alone that is
     exactly the failure the unmanaged-basics rule exists to prevent: "I asked
     for 12" becoming a deck of fifteen. */
  const tab = loadTab({ deck: [
    { card_name: 'Cryptic Command',    category: 'Spells' },
    { card_name: 'Island',             category: 'Lands', qty: 9 },
    { card_name: 'Snow-Covered Forest', category: 'Lands', qty: 3 },
  ], commander: null });
  tab.run(`dbCardData.delete('Snow-Covered Forest')`);
  /* And Scryfall never answering, which is the state this has to be safe in:
     a cache mid-refresh, a name the batch lookup does not come back with. */
  tab.run(`dbFetchCardData = async () => {}`);
  tab.open();
  tab.type(12);
  await tab.press();
  assert.match(tab.html(), /id="dbBasicsGo"[^>]*>\s*Preview/,
    'a plan drawn over a half-read deck offered to write itself');
  assert.match(tab.html(), /Snow-Covered Forest/,
    'the card the plan could not read was not named');
  await tab.press();
  assert.deepStrictEqual(basicsOf(tab), { Island: 9 },
    'a budget of 12 was written against a deck it could not fully see');
});

test('the facts are asked for on the press, so the block lifts by itself', async () => {
  /* The refusal above must not be a dead end. The press that draws a preview
     is what goes and gets what the app is missing, so the second press is
     against a deck it can see all of. */
  const tab = loadTab({ deck: [
    { card_name: 'Cryptic Command',     category: 'Spells' },
    { card_name: 'Island',              category: 'Lands', qty: 9 },
    { card_name: 'Snow-Covered Forest', category: 'Lands', qty: 3 },
  ], commander: null });
  tab.run(`dbCardData.delete('Snow-Covered Forest')`);
  /* Scryfall answering, the way the deck's own load path answers. */
  tab.run(`dbFetchCardData = async names => {
    for (const n of names) if (CARD_FACTS[n]) dbCardData.set(n, CARD_FACTS[n]);
  }`);
  tab.open();
  tab.type(12);
  await tab.press();
  assert.match(tab.html(), /3 Snow-Covered Forests aren’t touched — 9 to split/,
    'the facts arrived and the budget still did not account for them');
  await tab.press();
  assert.deepStrictEqual(basicsOf(tab), { Island: 9 },
    'nine blue pips’ worth of budget did not come out as nine Islands');
});
