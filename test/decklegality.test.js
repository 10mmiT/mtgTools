/* Whether the deck is legal, and what bracket it looks like.
 *
 * Two features with opposite obligations, which is most of what is asserted
 * here. Legality has one right answer and the app must never claim it without
 * having checked: a card whose facts have not arrived is *unknown*, and a
 * green tick over a card nobody looked at is this feature's worst failure.
 * The bracket has no right answer at all, so what is asserted about it is that
 * it never touches the number the player declared, never reaches 5, and always
 * comes with the reasoning that produced it — including what it looked for and
 * did not find.
 *
 * Four layers, all against the shipped files:
 *
 *   the pass    js/deckview-legality.js over a deck, in a vm sandbox
 *   the strip   the readout and the panel that opens out of it, drawn
 *   the night   js/pick.js restricting tonight's pool by bracket
 *   the frame   the markup and the stylesheet, read as text where what matters
 *               is an element or a rule that must exist
 *
 * What is not asserted is whether the heuristic is *right*. It cannot be:
 * Wizards' brackets are a self-assessment. What can be asserted is that it says
 * what it did.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* Cards as this app caches them — Scryfall's shape, trimmed. `legalities` and
 * `game_changer` are the two fields ticket 01 added for exactly this, and they
 * are copied verbatim there, so `not_legal` and `false` are what a card that is
 * neither banned nor a Game Changer actually says. */
const legal = (over = {}) => ({
  standard: 'not_legal', modern: 'not_legal', legacy: 'legal',
  vintage: 'legal', commander: 'legal', ...over,
});

const CARDS = {
  'Omnath, Locus of Mana': {
    name: 'Omnath, Locus of Mana', type_line: 'Legendary Creature — Elemental',
    cmc: 3, colors: ['G'], color_identity: ['G'], oracle_text: 'Green mana doesn’t empty from your mana pool as steps and phases end.',
    legalities: legal(), game_changer: false },
  'Forest': {
    name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0,
    colors: [], color_identity: ['G'], oracle_text: '({T}: Add {G}.)',
    legalities: legal(), game_changer: false },
  'Sol Ring': {
    name: 'Sol Ring', type_line: 'Artifact', cmc: 1, colors: [], color_identity: [],
    oracle_text: '{T}: Add {C}{C}.', legalities: legal(), game_changer: false },
  'Cultivate': {
    name: 'Cultivate', type_line: 'Sorcery', cmc: 3, colors: ['G'], color_identity: ['G'],
    oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    legalities: legal(), game_changer: false },
  'Worldly Tutor': {
    name: 'Worldly Tutor', type_line: 'Instant', cmc: 1, colors: ['G'], color_identity: ['G'],
    oracle_text: 'Search your library for a creature card, reveal it, then shuffle and put that card on top.',
    legalities: legal(), game_changer: false },
  'Rhystic Study': {
    name: 'Rhystic Study', type_line: 'Enchantment', cmc: 3, colors: ['U'], color_identity: ['U'],
    oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    legalities: legal(), game_changer: true },
  'Time Warp': {
    name: 'Time Warp', type_line: 'Sorcery', cmc: 5, colors: ['U'], color_identity: ['U'],
    oracle_text: 'Target player takes an extra turn after this one.',
    legalities: legal(), game_changer: false },
  'Armageddon': {
    name: 'Armageddon', type_line: 'Sorcery', cmc: 4, colors: ['W'], color_identity: ['W'],
    oracle_text: 'Destroy all lands.', legalities: legal(), game_changer: false },
  'Slime Against Humanity': {
    name: 'Slime Against Humanity', type_line: 'Sorcery', cmc: 2, colors: ['G'], color_identity: ['G'],
    oracle_text: 'Create a 0/0 green Ooze creature token…\nA deck can have any number of cards named Slime Against Humanity.',
    legalities: legal(), game_changer: false },
  /* Two commanders, and the cards that let a deck have two. Real oracle text,
     because what judges a pair reads the cards rather than a list of pairs —
     a fixture that paraphrased them would be asserting against a paraphrase.
     Both of these first two are mono-green so that a deck of Forests stays
     inside their identity and the pair is the only thing under test. */
  'Gilanra, Caller of Wirewood': {
    name: 'Gilanra, Caller of Wirewood', type_line: 'Legendary Creature — Elf Druid',
    cmc: 3, colors: ['G'], color_identity: ['G'],
    oracle_text: '{T}: Add {G}. When you spend this mana to cast a spell with mana value 6 or greater, draw a card.\nPartner (You can have two commanders if both have partner.)',
    legalities: legal(), game_changer: false },
  'Numa, Joraga Chieftain': {
    name: 'Numa, Joraga Chieftain', type_line: 'Legendary Creature — Elf Warrior',
    cmc: 3, colors: ['G'], color_identity: ['G'],
    oracle_text: 'At the beginning of combat on your turn, you may pay {X}{X}. When you do, distribute X +1/+1 counters among any number of target Elves.\nPartner (You can have two commanders if both have partner.)',
    legalities: legal(), game_changer: false },
  'Pir, Imaginative Rascal': {
    name: 'Pir, Imaginative Rascal', type_line: 'Legendary Creature — Human',
    cmc: 3, colors: ['G'], color_identity: ['G'],
    oracle_text: 'Partner with Toothy, Imaginary Friend (When this creature enters, target player may put Toothy into their hand from their library, then shuffle.)\nIf one or more counters would be put on a permanent your team controls, that many plus one of each of those kinds of counters are put on that permanent instead.',
    legalities: legal(), game_changer: false },
  'Toothy, Imaginary Friend': {
    name: 'Toothy, Imaginary Friend', type_line: 'Legendary Creature — Illusion',
    cmc: 4, colors: ['U'], color_identity: ['U'],
    oracle_text: 'Partner with Pir, Imaginative Rascal (When this creature enters, target player may put Pir into their hand from their library, then shuffle.)\nWhenever you draw a card, put a +1/+1 counter on Toothy.',
    legalities: legal(), game_changer: false },
  /* Restricted partner — four kinds of it exist, and each pairs only with its
     own kind. Two of them here, so that "the same keyword" can be told apart
     from "the word Partner". */
  'Sarah Jane Smith': {
    name: 'Sarah Jane Smith', type_line: 'Legendary Creature — Human Detective',
    cmc: 3, colors: ['G'], color_identity: ['G'],
    oracle_text: 'Partner—Friends forever (You can have two commanders if both have friends forever.)',
    legalities: legal(), game_changer: false },
  'Ellie and Alan': {
    name: 'Ellie and Alan', type_line: 'Legendary Creature — Human Scout',
    cmc: 3, colors: ['G'], color_identity: ['G'],
    oracle_text: 'Partner—Survivors (You can have two commanders if both have Partner—Survivors.)',
    legalities: legal(), game_changer: false },
  /* The two asymmetric mechanics: one card takes a second commander of a kind,
     and the other is of that kind. */
  'Wilson, Refined Grizzly': {
    name: 'Wilson, Refined Grizzly', type_line: 'Legendary Creature — Bear Warrior',
    cmc: 4, colors: ['G'], color_identity: ['G'],
    oracle_text: 'Ward {2}\nChoose a Background (You can have a Background as a second commander.)',
    legalities: legal(), game_changer: false },
  'Raised by Giants': {
    name: 'Raised by Giants', type_line: 'Legendary Enchantment — Background',
    cmc: 4, colors: ['G'], color_identity: ['G'],
    oracle_text: 'Commander creatures you own are Giants in addition to their other types and have base power and toughness 10/10.',
    legalities: legal(), game_changer: false },
  'Romana II': {
    name: 'Romana II', type_line: 'Legendary Creature — Time Lord Doctor',
    cmc: 3, colors: ['G'], color_identity: ['G'],
    oracle_text: 'Whenever you attack, you may pay {1}. When you do, draw a card.',
    legalities: legal(), game_changer: false },
  'K9, Mark I': {
    name: 'K9, Mark I', type_line: 'Legendary Artifact Creature — Robot Dog',
    cmc: 3, colors: [], color_identity: [],
    oracle_text: 'Doctor’s companion (You can have two commanders if the other is the Doctor.)',
    legalities: legal(), game_changer: false },
  'Relentless Rats': {
    name: 'Relentless Rats', type_line: 'Creature — Rat', cmc: 3, colors: ['B'], color_identity: ['B'],
    oracle_text: 'Relentless Rats gets +1/+1 for each other creature on the battlefield named Relentless Rats.\nA deck can have any number of cards named Relentless Rats.',
    legalities: legal(), game_changer: false },
  'Black Lotus': {
    name: 'Black Lotus', type_line: 'Artifact', cmc: 0, colors: [], color_identity: [],
    oracle_text: '{T}, Sacrifice this artifact: Add three mana of any one color.',
    legalities: legal({ commander: 'banned' }), game_changer: false },
  'Shahrazad': {
    name: 'Shahrazad', type_line: 'Sorcery', cmc: 4, colors: ['W'], color_identity: ['W'],
    oracle_text: 'Players play a Magic subgame.',
    legalities: legal({ commander: 'not_legal' }), game_changer: false },
  'Lightning Bolt': {
    name: 'Lightning Bolt', type_line: 'Instant', cmc: 1, colors: ['R'], color_identity: ['R'],
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    legalities: legal(), game_changer: false },
  /* A row imported before the trimmed shape carried legalities. `getCard()`
     fills the empty object on the way out, so this is what a consumer sees on a
     cache that believes it is up to date. */
  'Old Row': {
    name: 'Old Row', type_line: 'Artifact', cmc: 2, colors: [], color_identity: [],
    oracle_text: '', legalities: {}, game_changer: false },
};

/* A legal mono-green Commander deck: ninety-nine and the one it is built
 * around. Forests carry the bulk, because a basic land is the exception to the
 * singleton rule and a deck of ninety-seven of them is where that has to hold. */
const DECK = [
  { card_name: 'Forest',    category: 'Lands', qty: 97 },
  { card_name: 'Sol Ring',  category: 'Ramp' },
  { card_name: 'Cultivate', category: 'Ramp' },
];
const COMMANDER = { card_name: 'Omnath, Locus of Mana', category: 'Creatures', board: 'commander' };

/** A pair the rules actually allow: both have plain Partner, both mono-green. */
const PARTNERS = [
  { card_name: 'Gilanra, Caller of Wirewood', category: 'Creatures', board: 'commander' },
  { card_name: 'Numa, Joraga Chieftain',      category: 'Creatures', board: 'commander' },
];

const PLAYERS = [
  { id: 'p-tim',  name: 'Tim',  colorIdx: 0, wantList: [],
    decks: [{ id: 'd1', name: 'Omnath', commander: 'Omnath, Locus of Mana', bracket: null }] },
  { id: 'p-anna', name: 'Anna', colorIdx: 1, wantList: [],
    decks: [{ id: 'd2', name: 'Anna’s deck', commander: '', bracket: 3 }] },
];

const AS_TIM = { username: 'tim', role: 'player', playerId: 'p-tim' };

function loadTab({ deck = [...DECK, COMMANDER], cards = CARDS,
                   players = PLAYERS, commander = 'Omnath, Locus of Mana',
                   as = AS_TIM } = {}) {
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

  const saved = [];
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
    renderMana: () => '', renderPrice: () => '',
    openCardByName() {}, openDrawer() {}, closeDrawers() {}, renderDeck() {},
    ensureScryfallImages: async () => {},
    scryfallCache: new Map(), scryfallMetaCache: new Map(),
    deck: null, deckFilter: false, viewMode: 'list',
    animateCardMove: (_el, paint) => paint(),
    /* The deck tile is another tab's, and drawing it is another tab's job.
       What matters here is that declaring a bracket asks for it. */
    renderPlayers: () => { sandbox._tilesDrawn++; },
    _tilesDrawn: 0,
    _saved: saved,
  };
  sandbox.setTimeout = fn => 1;
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  for (const file of ['state.js', 'sortui.js', 'cardstack.js', 'cardquery.js',
                      'auth.js', 'collections.js',
                      'deckview-boards.js', 'deckview-core.js', 'deckview-render.js',
                      'deckview-edit.js', 'deckview-panels.js', 'deckview-history.js',
                      'deckview-owned.js', 'deckview-totals.js', 'deckview-legality.js',
                      'deckview-mana.js', 'pick.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`currentUser = ${JSON.stringify(as)}`);
  run(`hydrateState(${JSON.stringify({ players, collections: [] })})`);
  run(`dbDeck = ${JSON.stringify({ id: 'd1', playerId: 'p-tim', name: 'Omnath', commander })}`);
  run(`dbCards = ${JSON.stringify(deck.map((c, i) => ({ qty: 1, board: 'main', position: i, ...c })))}`);
  run(`dbCats = ${JSON.stringify(['Ramp', 'Creatures', 'Lands'].map((name, i) => ({ name, position: i })))}`);
  run(`dbCardData = new Map(${JSON.stringify(Object.entries(cards))})`);

  /* The pass, counted rather than assumed — the same wrapping js/deckview-
     totals.js is asserted through, because this walk is a second one over the
     same deck and the promise that neither runs on render is the same promise. */
  run(`
    _dbChecks = 0;
    _dbRealCheck = _dbComputeCheck;
    _dbComputeCheck = () => { _dbChecks++; return _dbRealCheck(); };
  `);

  return {
    run, answer, el, sandbox,
    check:    () => answer('dbDeckCheck()'),
    legality: () => answer('dbDeckCheck().legality'),
    bracket:  () => answer('dbDeckCheck().bracket'),
    render()  { run('dbRenderStats()'); },
    checks:   () => run('_dbChecks'),
    legalLine:   () => el('dbStatLegal').innerHTML,
    bracketLine: () => el('dbStatBracket').innerHTML,
    panel:    () => { run('dbToggleCheckPanel()'); return el('dbCheckPanel').innerHTML; },
    record:   () => answer(`dbDeckRecord()`),
    tiles:    () => sandbox._tilesDrawn,
  };
}

/** The problem ids a check produced, which is what most of these assert. */
const ids = legality => legality.problems.map(p => p.id);
const problem = (legality, id) => legality.problems.find(p => p.id === id);

// ── What the deck is judged as ────────────────────────────────────────────

test('a deck with a commander is judged as Commander, and one without is not', () => {
  assert.strictEqual(loadTab().check().format.id, 'commander');
  assert.strictEqual(
    loadTab({ deck: DECK, commander: '' }).check().format.id, 'sixty',
    'a deck with no commander was held to Commander’s rules');
});

test('a commander named on the record but not yet on the mat is still Commander', () => {
  // Every Archidekt import arrives this way for as long as the cards take.
  const tab = loadTab({ deck: DECK, commander: 'Omnath, Locus of Mana' });
  assert.strictEqual(tab.check().format.id, 'commander');
  assert.strictEqual(tab.run('dbDeckTarget()'), 99, 'a deck of ninety-nine was asked for a hundred');
});

test('the readout and the legality line agree about how big the deck should be', () => {
  /* Two answers to "how many cards should this have" is the one thing a
     readout cannot survive, so the number is asked of one place. */
  const tab = loadTab();
  tab.render();
  assert.match(tab.el('dbStatCards').innerHTML, /99\/99/);
  assert.deepStrictEqual(ids(tab.legality()), [], 'the same deck read as the wrong size');
});

test('a pair of partners is a deck of ninety-eight, and a hundred all told', () => {
  const tab = loadTab({ deck: [...DECK.slice(1), ...PARTNERS,
    { card_name: 'Forest', category: 'Lands', qty: 96 }] });
  assert.strictEqual(tab.run('dbDeckTarget()'), 98);
  assert.deepStrictEqual(ids(tab.legality()), []);
});

// ── Legal, or the reason it is not ────────────────────────────────────────

test('a legal deck says so, and says nothing else', () => {
  const tab = loadTab();
  const legality = tab.legality();
  assert.strictEqual(legality.legal, true);
  assert.deepStrictEqual(legality.problems, []);
  assert.deepStrictEqual(legality.unchecked, []);
  tab.render();
  assert.match(tab.legalLine(), /Commander legal/);
  assert.match(tab.legalLine(), /var\(--success\)/, 'a checked, legal deck is not marked as one');
});

test('a deck of the wrong size says by how much', () => {
  const tab = loadTab();
  tab.run(`dbCards.find(c => c.card_name === 'Forest').qty = 94`);
  tab.run('dbCheckChanged()');
  const p = problem(tab.legality(), 'size');
  assert.ok(p, 'a deck of ninety-seven passed as a hundred');
  assert.match(p.text, /3 short of the 100/);
});

test('a second copy of something is named, and a hundredth Forest is not', () => {
  const tab = loadTab();
  tab.run(`
    dbCards.find(c => c.card_name === 'Forest').qty = 95;
    dbCards.push({ card_name: 'Worldly Tutor', qty: 2, category: 'Ramp', board: 'main', position: 9 });
  `);
  tab.run('dbCheckChanged()');
  const p = problem(tab.legality(), 'copies');
  assert.deepStrictEqual(p.cards, ['Worldly Tutor']);
  assert.match(p.text, /singleton/);
});

test('and a card that says a deck may have any number of it is allowed to be', () => {
  const tab = loadTab();
  tab.run(`
    dbCards.find(c => c.card_name === 'Forest').qty = 90;
    dbCards.push({ card_name: 'Slime Against Humanity', qty: 7, category: 'Creatures', board: 'main', position: 9 });
  `);
  tab.run('dbCheckChanged()');
  assert.deepStrictEqual(ids(tab.legality()), [],
    'the card that says it in its own rules text was counted against the singleton rule');
});

test('a card outside the commander’s colour identity is caught, and named', () => {
  const tab = loadTab();
  tab.run(`
    dbCards.find(c => c.card_name === 'Forest').qty = 96;
    dbCards.push({ card_name: 'Lightning Bolt', qty: 1, category: 'Ramp', board: 'main', position: 9 });
  `);
  tab.run('dbCheckChanged()');
  const p = problem(tab.legality(), 'identity');
  assert.deepStrictEqual(p.cards, ['Lightning Bolt']);
  assert.match(p.text, /\(G\)/, 'the identity the deck is held to is not said');
});

test('a colourless card is inside every identity', () => {
  // Sol Ring is in the deck above and is not one of the cards named.
  const tab = loadTab();
  assert.deepStrictEqual(ids(tab.legality()), []);
});

test('a banned card and a card that is not legal at all are two different sentences', () => {
  const tab = loadTab();
  tab.run(`
    dbCards.find(c => c.card_name === 'Forest').qty = 95;
    dbCards.push({ card_name: 'Black Lotus', qty: 1, category: 'Ramp', board: 'main', position: 9 });
    dbCards.push({ card_name: 'Shahrazad', qty: 1, category: 'Ramp', board: 'main', position: 10 });
  `);
  tab.run('dbCheckChanged()');
  const legality = tab.legality();
  assert.deepStrictEqual(problem(legality, 'banned').cards, ['Black Lotus']);
  assert.deepStrictEqual(problem(legality, 'notlegal').cards, ['Shahrazad']);
  /* Shahrazad is outside a green commander's identity too, which is a second
     true thing about it and is said as one. */
  assert.ok(problem(legality, 'identity').cards.includes('Shahrazad'));
});

test('every problem is drawn into the panel, with the cards that cause it', () => {
  const tab = loadTab();
  tab.run(`
    dbCards.find(c => c.card_name === 'Forest').qty = 96;
    dbCards.push({ card_name: 'Black Lotus', qty: 1, category: 'Ramp', board: 'main', position: 9 });
  `);
  tab.render();
  assert.match(tab.legalLine(), /1 problem\b/);
  const panel = tab.panel();
  assert.match(panel, /banned in Commander/);
  assert.match(panel, /data-name="Black Lotus"/, 'the offending card is not openable from the panel');
});

// ── The half-refreshed cache ──────────────────────────────────────────────

test('a card whose legality this app has no answer for is unknown, never legal', () => {
  /* Ticket 01 fills `legalities: {}` on a row still in the old shape, so this
     is exactly what a consumer sees on a cache that believes it is current. */
  const tab = loadTab();
  tab.run(`
    dbCards.find(c => c.card_name === 'Forest').qty = 96;
    dbCards.push({ card_name: 'Old Row', qty: 1, category: 'Ramp', board: 'main', position: 9 });
  `);
  tab.run('dbCheckChanged()');
  const legality = tab.legality();
  assert.deepStrictEqual(legality.unchecked, ['Old Row']);
  assert.deepStrictEqual(ids(legality), [], 'an unknown card was reported as breaking a rule');
});

test('and the readout stops short of saying the deck is legal', () => {
  const tab = loadTab();
  tab.run(`
    dbCards.find(c => c.card_name === 'Forest').qty = 96;
    dbCards.push({ card_name: 'Old Row', qty: 1, category: 'Ramp', board: 'main', position: 9 });
  `);
  tab.render();
  assert.match(tab.legalLine(), /legal so far/);
  assert.match(tab.legalLine(), /1 unchecked/);
  assert.ok(!tab.legalLine().includes('var(--success)'),
    'a deck with an unchecked card in it was ticked green');
});

test('a card whose facts have not arrived is counted, and judged for nothing', () => {
  // The batch lookup has not come back yet: the name is on the mat, the card
  // is not in hand. It is still a card in the deck.
  const tab = loadTab();
  tab.run(`
    dbCards.find(c => c.card_name === 'Forest').qty = 96;
    dbCards.push({ card_name: 'Some Card', qty: 1, category: 'Ramp', board: 'main', position: 9 });
  `);
  tab.run('dbCheckChanged()');
  const legality = tab.legality();
  assert.strictEqual(tab.check().cards, 100, 'a card nothing is known about was left out of the count');
  assert.deepStrictEqual(legality.unchecked, ['Some Card']);
  assert.deepStrictEqual(ids(legality), []);
});

test('a commander named but not in hand leaves colour identity unchecked, not broken', () => {
  /* The alternative is every card in the deck reported as outside a colourless
     commander's identity, which is a hundred problems and no information. */
  const tab = loadTab({ deck: DECK, cards: { ...CARDS, 'Omnath, Locus of Mana': undefined } });
  tab.run(`dbCardData.delete('Omnath, Locus of Mana')`);
  tab.run('dbCheckChanged()');
  assert.strictEqual(tab.run('dbCommanderIdentity()'), null);
  assert.ok(!ids(tab.legality()).includes('identity'));
});

// ── A deck with no commander ──────────────────────────────────────────────

test('a sixty-card deck is judged as sixty cards, not against Commander', () => {
  const tab = loadTab({
    deck: [{ card_name: 'Forest', category: 'Lands', qty: 52 },
           { card_name: 'Lightning Bolt', category: 'Ramp', qty: 4 },
           { card_name: 'Black Lotus', category: 'Ramp', qty: 4 }],
    commander: '' });
  const legality = tab.legality();
  assert.strictEqual(tab.check().format.id, 'sixty');
  assert.deepStrictEqual(ids(legality), [],
    'four of a card, a red card among green ones and a card banned in Commander — ' +
    'three things sixty cards has nothing to say about');
  assert.strictEqual(legality.checked, false, 'a ban list was consulted for a format nobody named');
});

test('and it says out loud that no ban list was consulted', () => {
  const tab = loadTab({ deck: [{ card_name: 'Forest', category: 'Lands', qty: 60 }], commander: '' });
  tab.render();
  assert.match(tab.panel(), /no ban list was consulted/);
});

test('a fifth copy is over the limit there, and a fifth Forest is not', () => {
  const tab = loadTab({
    deck: [{ card_name: 'Forest', category: 'Lands', qty: 55 },
           { card_name: 'Lightning Bolt', category: 'Ramp', qty: 5 }],
    commander: '' });
  const p = problem(tab.legality(), 'copies');
  assert.deepStrictEqual(p.cards, ['Lightning Bolt']);
  assert.match(p.text, /4 is the limit/);
});

test('fifty-four cards is short of sixty', () => {
  const tab = loadTab({ deck: [{ card_name: 'Forest', category: 'Lands', qty: 54 }], commander: '' });
  assert.match(problem(tab.legality(), 'size').text, /6 short of the 60/);
});

test('there is no bracket on a deck that is not a Commander deck', () => {
  const tab = loadTab({ deck: [{ card_name: 'Forest', category: 'Lands', qty: 60 }], commander: '' });
  assert.strictEqual(tab.bracket(), null);
  tab.render();
  assert.strictEqual(tab.el('dbStatBracket').style.display, 'none',
    'the bracket line stood on the readout saying nothing');
});

// ── The bracket, estimated ────────────────────────────────────────────────

/* A deck with a given set of extra cards in it, at the right size. */
function withCards(names) {
  const tab = loadTab();
  tab.run(`dbCards.find(c => c.card_name === 'Forest').qty = ${97 - names.length}`);
  for (const [i, name] of names.entries()) {
    tab.run(`dbCards.push({ card_name: ${JSON.stringify(name)}, qty: 1, category: 'Ramp', board: 'main', position: ${20 + i} })`);
  }
  tab.run('dbCheckChanged()');
  return tab;
}

test('a deck with none of the signals is a 2, and says a 1 looks the same', () => {
  const tab = loadTab();
  const bracket = tab.bracket();
  assert.strictEqual(bracket.n, 2);
  assert.strictEqual(bracket.label, 'Core');
  assert.ok(bracket.limits.some(l => /a 1 look the same/.test(l)));
});

test('one Game Changer makes it Upgraded, and four make it Optimized', () => {
  const one = withCards(['Rhystic Study']);
  assert.strictEqual(one.bracket().n, 3);

  /* Four of them. Rhystic Study is the only Game Changer in the fixture, so the
     other three are made here — what is being asserted is the threshold, not
     the list, and the list is Scryfall's. */
  const four = loadTab();
  four.run(`
    dbCards.find(c => c.card_name === 'Forest').qty = 93;
    for (const n of ['Gc One', 'Gc Two', 'Gc Three', 'Gc Four']) {
      dbCardData.set(n, { name: n, type_line: 'Artifact', cmc: 2, colors: [], color_identity: [],
                          oracle_text: '', legalities: { commander: 'legal' }, game_changer: true });
      dbCards.push({ card_name: n, qty: 1, category: 'Ramp', board: 'main', position: dbCards.length });
    }
  `);
  four.run('dbCheckChanged()');
  const bracket = four.bracket();
  assert.strictEqual(bracket.n, 4);
  assert.strictEqual(bracket.label, 'Optimized');
  assert.match(bracket.reasons[0].text, /4 Game Changers/);
  assert.strictEqual(bracket.reasons[0].cards.length, 4, 'the four are not named');
});

test('an extra turn or mass land denial lifts a deck with no Game Changers', () => {
  assert.strictEqual(withCards(['Time Warp']).bracket().n, 3);
  assert.strictEqual(withCards(['Armageddon']).bracket().n, 3);
});

test('the estimate never reaches 5, and says why', () => {
  const tab = withCards(['Rhystic Study', 'Time Warp', 'Armageddon']);
  assert.ok(tab.bracket().n <= 4);
  assert.ok(tab.bracket().limits.some(l => /cEDH is a declaration/.test(l)));
});

test('and it says what it cannot look for at all', () => {
  assert.ok(loadTab().bracket().limits.some(l => /infinite combos are not looked for/.test(l)));
});

test('tutors are counted and shown, and move the number not at all', () => {
  const tab = withCards(['Worldly Tutor']);
  assert.strictEqual(tab.bracket().n, 2, 'a tutor was scored against a threshold nobody published');
  const tutors = tab.bracket().reasons.find(r => /tutor/.test(r.text));
  assert.deepStrictEqual(tutors.cards, ['Worldly Tutor']);
});

test('ramp is not a tutor, however much it reads like one', () => {
  // "Search your library for up to two basic land cards" is Cultivate, which is
  // in the deck already — and counting it would make the reasoning unreadable.
  const reasons = loadTab().bracket().reasons.find(r => /tutor/.test(r.text));
  assert.deepStrictEqual(reasons.cards, []);
  assert.match(reasons.text, /No tutors/);
});

test('what was looked for and not found is a reason too', () => {
  /* A list of only the hits reads as an accusation. The whole point of showing
     the reasoning is that it can be argued with. */
  const said = loadTab().bracket().reasons.map(r => r.text).join(' | ');
  assert.match(said, /No cards from the Game Changers list/);
  assert.match(said, /Nothing that takes an extra turn/);
  assert.match(said, /No mass land denial/);
});

test('the reasoning is in the panel, beside the estimate', () => {
  const tab = withCards(['Rhystic Study']);
  tab.render();
  const panel = tab.panel();
  assert.match(panel, /an estimate, and here is why/);
  assert.match(panel, /estimate: <strong>3<\/strong> Upgraded/);
  assert.match(panel, /data-name="Rhystic Study"/);
});

// ── Declared, and estimated ───────────────────────────────────────────────

test('the player declares a bracket, and it lands on the field that already exists', () => {
  const tab = loadTab();
  tab.render();
  assert.strictEqual(tab.record().bracket, null);
  tab.run(`dbDeclareBracket('2')`);
  assert.strictEqual(tab.record().bracket, 2);
  assert.ok(tab.tiles() > 0, 'the deck tile was not asked to redraw its chip');
});

test('and can take it back', () => {
  const tab = loadTab();
  tab.run(`dbDeclareBracket('4')`);
  tab.run(`dbDeclareBracket('')`);
  assert.strictEqual(tab.record().bracket, null);
});

test('the estimate never overwrites the declaration', () => {
  /* The one promise this feature has to keep. A deck declared 2 whose cards
     estimate at 4 stays declared 2, however many times it is redrawn. */
  const tab = withCards(['Rhystic Study', 'Time Warp']);
  tab.run(`dbDeclareBracket('2')`);
  for (let i = 0; i < 5; i++) tab.render();
  assert.strictEqual(tab.record().bracket, 2);
  assert.strictEqual(tab.bracket().n, 3, 'and the estimate stopped being the estimate');
});

test('the two are drawn as different things', () => {
  const tab = withCards(['Rhystic Study']);
  tab.run(`dbDeclareBracket('2')`);
  tab.render();
  assert.match(tab.bracketLine(), /badge-bracket/, 'the declared bracket is not the app’s bracket chip');
  assert.match(tab.bracketLine(), /Bracket 2/);
  assert.match(tab.bracketLine(), /est 3/);
});

test('a deck nobody has declared says so rather than borrowing the estimate', () => {
  const tab = withCards(['Rhystic Study']);
  tab.render();
  assert.match(tab.bracketLine(), /not declared/);
  assert.ok(!/Bracket 3/.test(tab.bracketLine()),
    'the estimate was drawn as though somebody had declared it');
});

test('somebody else’s deck is read, not changed', () => {
  const tab = loadTab({ as: { username: 'anna', role: 'player', playerId: 'p-anna' } });
  assert.strictEqual(tab.run('dbCanDeclare()'), false);
  tab.render();
  const panel = tab.panel();
  assert.ok(!panel.includes('dbBracketSel'), 'a deck that is not yours offered a declaration control');
  tab.run(`dbDeclareBracket('5')`);
  assert.strictEqual(tab.record().bracket, null, 'and took one anyway');
});

test('an admin may declare on anybody’s deck', () => {
  const tab = loadTab({ as: { username: 'root', role: 'admin', playerId: null } });
  assert.strictEqual(tab.run('dbCanDeclare()'), true);
});

// ── One pass, and none of it on render ────────────────────────────────────

test('the readout costs one pass, and drawing the mat costs none', () => {
  const tab = loadTab();
  tab.render();
  assert.strictEqual(tab.checks(), 1, 'the two lines counted the deck twice');
  for (let i = 0; i < 20; i++) tab.run('dbRender()');
  assert.strictEqual(tab.checks(), 1, 'the mat re-checked the deck to draw itself');
});

test('opening the panel costs none either', () => {
  const tab = loadTab();
  tab.render();
  tab.run('dbToggleCheckPanel()');
  tab.run('dbToggleCheckPanel()');
  assert.strictEqual(tab.checks(), 1);
});

test('a deck that changes is checked again', () => {
  const tab = loadTab();
  tab.render();
  tab.run(`dbCards.find(c => c.card_name === 'Forest').qty = 50`);
  tab.render();
  assert.strictEqual(tab.checks(), 2, 'once per change, and once only');
  assert.match(problem(tab.legality(), 'size').text, /47 short/);
});

test('the two panels on the readout do not lie on top of each other', () => {
  const tab = loadTab();
  tab.render();
  tab.run('dbToggleCheckPanel()');
  tab.run('dbToggleOwnedPanel()');
  assert.strictEqual(tab.run('_dbCheckPanelOpen'), false);
  tab.run('dbToggleCheckPanel()');
  assert.strictEqual(tab.run('_dbOwnedPanelOpen'), false);
});

// ── Tonight is a bracket 2 night ──────────────────────────────────────────

/* Pick Night reads the same records the builder writes, so its half is asserted
 * in the same sandbox: four decks over two players, with brackets on them. */
function pickTab() {
  const tab = loadTab({ players: [
    { id: 'p-tim', name: 'Tim', colorIdx: 0, wantList: [], decks: [
      { id: 'd1', name: 'Omnath', bracket: 2 },
      { id: 'd2', name: 'Rats',   bracket: 4 },
    ] },
    { id: 'p-anna', name: 'Anna', colorIdx: 1, wantList: [], decks: [
      { id: 'd3', name: 'Bolt',    bracket: 3 },
      { id: 'd4', name: 'Unrated', bracket: null },
    ] },
  ] });
  tab.run(`pickIncludedDeckIds = new Set(['d1', 'd2', 'd3', 'd4'])`);
  tab.run(`pickSelected = new Set(['p-tim', 'p-anna'])`);
  return tab;
}

const poolNames = tab => tab.answer('_allPickDecks().map(d => d.deck.name)');

test('with no restriction the pool is every deck chosen, as it always was', () => {
  assert.deepStrictEqual(poolNames(pickTab()), ['Omnath', 'Rats', 'Bolt', 'Unrated']);
});

test('a bracket restricts the draw to the decks declared as it', () => {
  const tab = pickTab();
  tab.run('pickToggleBracket(3)');
  assert.deepStrictEqual(poolNames(tab), ['Bolt']);
  tab.run('pickToggleBracket(2)');
  assert.deepStrictEqual(poolNames(tab), ['Omnath', 'Bolt'], 'two brackets is one evening');
  tab.run('pickToggleBracket(3)');
  assert.deepStrictEqual(poolNames(tab), ['Omnath'], 'pressing it again did not turn it off');
});

test('a deck nobody has declared a bracket for is in none of them', () => {
  const tab = pickTab();
  for (const n of [1, 2, 3, 4, 5]) tab.run(`pickToggleBracket(${n})`);
  assert.ok(!poolNames(tab).includes('Unrated'),
    'a deck with no declared bracket was dealt into a bracketed night');
});

test('and the strip says so when the restriction empties the pool', () => {
  const tab = pickTab();
  tab.run('pickToggleBracket(1)');
  tab.run('renderPickSetup()');
  const said = tab.el('pickPoolInfo').textContent;
  assert.match(said, /No deck in the pool is bracket 1/);
  assert.match(said, /4 chosen/, 'the four decks that are in the pool are not accounted for');
});

test('and when it merely shortens it', () => {
  const tab = pickTab();
  tab.run('pickToggleBracket(2)');
  tab.run('renderPickSetup()');
  assert.match(tab.el('pickPoolInfo').textContent, /only 1 at bracket 2/);
});

test('a restriction that costs nothing is still on the strip', () => {
  // A pool that has quietly halved is the same surprise as one that has
  // emptied, arriving later.
  const tab = pickTab();
  tab.run('pickToggleBracket(2)');
  tab.run('pickToggleBracket(3)');
  tab.run('renderPickSetup()');
  assert.match(tab.el('pickPoolInfo').textContent, /brackets 2 or 3/);
});

test('the chips say which brackets they are, and the note says what they cost', () => {
  const tab = pickTab();
  tab.run('renderPickPool()');
  assert.match(tab.el('pickBracketChips').innerHTML, /2 · Core/);
  assert.match(tab.el('pickBracketNote').textContent, /Every deck in the pool/);
  tab.run('pickToggleBracket(2)');
  assert.match(tab.el('pickBracketNote').textContent, /1 of 4 chosen decks are bracket 2/);
  assert.match(tab.el('pickBracketNote').textContent, /1 have no declared bracket/);
});

test('a deck barred by tonight’s bracket is marked where it was chosen', () => {
  const tab = pickTab();
  tab.run('pickToggleBracket(2)');
  tab.run('renderPickPool()');
  const chips = tab.el('pickPoolDeckList').innerHTML;
  assert.match(chips, /pick-pool-chip-barred/);
  assert.match(chips, /B4/, 'a deck’s own bracket is not on its chip');
});

// ── Asking the mat which of them they are ─────────────────────────────────

test('the deck’s filter box can ask which cards are Game Changers', () => {
  /* js/cardquery.js parked `is:gamechanger` on this ticket: the list arrived
     with the cache's shape version 2 and nothing had a use for it until the
     bracket turned on counting them. This is the end of that wiring — the
     filter reads it off the same cached card the estimate does. */
  const tab = withCards(['Rhystic Study', 'Worldly Tutor']);
  tab.run(`dbSetFilter('is:gamechanger')`);
  assert.strictEqual(tab.run(`dbFilterError`), '', 'the filter box refused the question');
  const kept = tab.answer(`dbCards.filter(_dbMatchesFilter).map(c => c.card_name)`);
  assert.deepStrictEqual(kept, ['Rhystic Study']);
});

// ── The chip a bracket wears ──────────────────────────────────────────────

test('the chip names what the number means', () => {
  const tab = loadTab();
  assert.match(tab.run(`dbBracketBadgeHtml(3)`), /Bracket 3/);
  assert.match(tab.run(`dbBracketBadgeHtml(3)`), /Upgraded/);
  assert.strictEqual(tab.run(`dbBracketBadgeHtml(null)`), '');
});

test('and a power level imported from elsewhere keeps its chip', () => {
  /* Archidekt's importer has filled this field from `powerLevel` since before
     brackets existed. Dropping a 7 because it is not one of Wizards' five would
     lose what somebody said about their own deck. */
  const tab = loadTab();
  assert.match(tab.run(`dbBracketBadgeHtml(7)`), /Bracket 7/);
  assert.match(tab.run(`dbBracketBadgeHtml(7)`), /not one of Wizards/);
});

// ── The frame ─────────────────────────────────────────────────────────────

const MARKUP = read('public/index.html');
const CSS    = read('public/css/tabs.css');

test('both figures sit on the readout and open the same panel', () => {
  const bar = MARKUP.match(/<div class="db-stats-bar[\s\S]*?<\/div>\s*<\/div>/)[0];
  assert.match(bar, /id="dbStatLegal"[^>]*aria-controls="dbCheckPanel"/);
  assert.match(bar, /id="dbStatBracket"[^>]*aria-controls="dbCheckPanel"/);
  assert.match(bar, /id="dbCheckPanel"/, 'the panel is not a child of the line it rises out of');
});

test('the module is served, after the modules it reads', () => {
  const tag  = file => MARKUP.indexOf(`<script src="js/${file}.js"></script>`);
  assert.ok(tag('deckview-legality') > 0, 'the module is not served at all');
  assert.ok(tag('deckview-legality') > tag('deckview-boards'),
    'the check is loaded before the boards it asks what the commander is');
  assert.ok(tag('deckview-legality') < tag('pick'),
    'Pick Night reads DB_BRACKETS and is loaded before it exists');
});

test('the deck pool has somewhere to say what tonight is for', () => {
  const drawer = MARKUP.match(/<div class="drawer" data-drawer id="pickPoolDrawer"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)[0];
  assert.match(drawer, /id="pickBracketChips"/);
  assert.match(drawer, /id="pickBracketNote"/);
  assert.ok(drawer.indexOf('pickBracketChips') < drawer.indexOf('pickPoolDeckList'),
    'the restriction is drawn under the decks it restricts');
});

test('the panel rises out of the readout, as the missing list does', () => {
  const rule = CSS.match(/\.db-check-panel \{[^}]*\}/)[0];
  assert.match(rule, /position: absolute/);
  assert.match(rule, /bottom: 100%/);
});

test('a finding is marked by a glyph and not by colour alone', () => {
  const totals = read('public/js/deckview-legality.js');
  assert.match(totals, /DB_CHECK_MARKS = \{[^}]*bad: '✕'/);
  assert.match(CSS, /\.db-check-mark-bad\s*\{\s*color: var\(--danger\)/);
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(totals), 'a colour was written into the module as hex');
});

test('a barred deck chip is not the same thing as an unchosen one', () => {
  assert.match(CSS, /\.pick-pool-chip-barred \{/);
  assert.match(CSS, /\.pick-pool-chip-off \{/);
});

test('the phone can hit everything this ticket added', () => {
  const phone = CSS.slice(CSS.indexOf('── The phone, per tab ──'));
  for (const rule of ['.db-stat-open', '.db-check-close']) {
    assert.match(phone, new RegExp(`\\${rule}[^}]*min-(width|height): 44px`),
      `${rule} has no floor on a phone`);
  }
});

test('a card named in a finding is a target you can hit, and see the edges of', () => {
  /* The app-wide rule pads a card name by centring a 44px box on it, which
     works where a name has room around it and fails here: these sit in a
     wrapping row four pixels apart, sixty-eight of them in a commander deck,
     so each pad reaches into the row above and below rather than into empty
     space. The hit test at the centre of one name returns a different name.

     A pad cannot fix a row this tight — the box has to be the size it
     claims. Both axes, because a name too short to fill 44 across spills
     sideways into its neighbour for the same reason. */
  const phone = CSS.slice(CSS.indexOf('── The phone, per tab ──'));
  const rule  = phone.match(/\.db-check-card \{[^}]*\}/)?.[0];
  assert.ok(rule, '.db-check-card has no floor on a phone');
  assert.match(rule, /min-height: 44px/, 'a name can be missed vertically');
  assert.match(rule, /min-width: 44px/,  'a short name spills its pad sideways');
  /* And a target you cannot see the edge of is still a target you tap the
     wrong half of, which is the half of this the measurement cannot read. */
  assert.match(rule, /border: 1px solid var\(--border\)/,
    'nothing draws where one name ends and the next begins');
});

test('the bracket line leaves the readout on a phone, and the panel keeps it', () => {
  /* Two facts side by side is the widest thing on a line that already wraps at
     390px — and nothing is lost, because the item beside it opens the panel
     where the estimate's reasoning and the declaration both live. */
  const narrow = CSS.slice(CSS.indexOf('@media (width < 900px)', CSS.indexOf('.db-stats-bar {')));
  assert.match(narrow, /#dbStatBracket \{ display: none; \}/);
  assert.match(narrow, /\.db-stat-sep-bracket \{ display: none; \}/);
});

test('the mobile measurement knows the panel exists', () => {
  const script = read('scripts/measure-mobile.js');
  assert.match(script, /'deckview-legality': 'deckview'/);
  assert.match(script, /dbToggleCheckPanel/);
});

// ── What lets a deck have two commanders ──────────────────────────────────
// The commander board has always held two. What is judged now is whether the
// two on it are a pair Magic allows — three rules, read off the cards, and
// asserted here against real oracle text rather than against a list of pairs.

/** What pairs these two, by name, or null. */
const pairing = (a, b) => {
  const tab = loadTab();
  return tab.run(`(() => {
    const p = dbPartnerPairing(dbCardData.get(${JSON.stringify(a)}),
                               dbCardData.get(${JSON.stringify(b)}));
    return p ? p.how : null;
  })()`);
};

test('two cards with the same partner keyword are a pair', () => {
  assert.strictEqual(pairing('Gilanra, Caller of Wirewood', 'Numa, Joraga Chieftain'), 'partner');
});

test('and restricted partner pairs only with its own kind', () => {
  /* Four kinds of it are printed — Friends forever, Character select,
     Survivors, Father & son — and the rule that gets all four right is that
     the whole keyword line has to match, not that the word "Partner" appears
     in both. */
  assert.strictEqual(pairing('Sarah Jane Smith', 'Sarah Jane Smith'), 'partner—friends forever');
  assert.strictEqual(pairing('Sarah Jane Smith', 'Ellie and Alan'), null,
    'a Friends forever was paired with a Survivor');
  assert.strictEqual(pairing('Sarah Jane Smith', 'Gilanra, Caller of Wirewood'), null,
    'a restricted partner was paired with a plain one');
});

test('Partner with is a pair, read from either card', () => {
  assert.strictEqual(pairing('Pir, Imaginative Rascal', 'Toothy, Imaginary Friend'), 'partner with');
  assert.strictEqual(pairing('Toothy, Imaginary Friend', 'Pir, Imaginative Rascal'), 'partner with');
});

test('but only with the card it names', () => {
  assert.strictEqual(pairing('Pir, Imaginative Rascal', 'Gilanra, Caller of Wirewood'), null);
});

test('a Background and a Doctor’s companion are the two asymmetric pairs', () => {
  // One card may take a second commander of a kind, and the other is of that
  // kind — which is a different shape of sentence from the two above, and the
  // only one that needs a table.
  assert.strictEqual(pairing('Wilson, Refined Grizzly', 'Raised by Giants'), 'a Background');
  assert.strictEqual(pairing('Raised by Giants', 'Wilson, Refined Grizzly'), 'a Background');
  assert.strictEqual(pairing('K9, Mark I', 'Romana II'), 'a Doctor');
  assert.strictEqual(pairing('Romana II', 'K9, Mark I'), 'a Doctor');
});

test('and neither pairs with another of itself', () => {
  // Two Backgrounds are not a deck, and neither are two companions: each of
  // these rules needs one of each side.
  assert.strictEqual(pairing('Raised by Giants', 'Raised by Giants'), null);
  assert.strictEqual(pairing('K9, Mark I', 'K9, Mark I'), null);
});

test('two ordinary legends are not a pair, and neither is a legend and a Sol Ring', () => {
  assert.strictEqual(pairing('Omnath, Locus of Mana', 'Relentless Rats'), null);
  assert.strictEqual(pairing('Omnath, Locus of Mana', 'Sol Ring'), null);
});

test('a deck with two commanders that cannot pair is told so, and told first', () => {
  /* Before the size line, because a pair that is not a pair is a deck of
     ninety-nine and one — so the arithmetic underneath, which counts it as
     ninety-eight and two, is about a deck that does not exist yet. */
  const tab = loadTab({ deck: [...DECK.slice(1), { ...COMMANDER },
    { card_name: 'Relentless Rats', category: 'Creatures', board: 'commander' },
    { card_name: 'Forest', category: 'Lands', qty: 96 }] });
  assert.strictEqual(ids(tab.legality())[0], 'partners');
  assert.deepStrictEqual(problem(tab.legality(), 'partners').cards,
    ['Omnath, Locus of Mana', 'Relentless Rats'],
    'the two it is about were not named');
});

test('one commander is never asked the question', () => {
  assert.ok(!ids(loadTab().legality()).includes('partners'));
});

test('nor is a pair whose cards this app has no facts for', () => {
  /* The same principle as the ban list: unknown is unknown, and a confident
     wrong answer is the failure worth avoiding. */
  const tab = loadTab({ deck: [...DECK.slice(1), { ...COMMANDER },
    { card_name: 'A Card From Nowhere', category: 'Creatures', board: 'commander' },
    { card_name: 'Forest', category: 'Lands', qty: 96 }] });
  assert.ok(!ids(tab.legality()).includes('partners'),
    'a card nobody has facts for was judged unable to partner');
  assert.ok(tab.legality().unchecked.includes('A Card From Nowhere'));
});

test('the pair that is a pair says nothing at all', () => {
  const tab = loadTab({ deck: [...DECK.slice(1), ...PARTNERS,
    { card_name: 'Forest', category: 'Lands', qty: 96 }] });
  assert.strictEqual(tab.legality().legal, true);
});
