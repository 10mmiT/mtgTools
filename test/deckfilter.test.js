/* What the Deck Builder's filter box understands.
 *
 * It used to be one substring test against name and oracle text, which answers
 * one question. It reads Scryfall's query language now — the same
 * js/cardquery.js the Collections search box reads, run against the deck in
 * front of you rather than against the shelf.
 *
 * What is asserted here is what the box rests on: a bare word still means what
 * it has always meant here, every filter reads the deck's own card data, a
 * query that cannot mean anything says so *and leaves the deck alone*, and the
 * filter never touches anything but what is drawn — not the deck, not the
 * saves, not the numbers on the readout.
 *
 * Two layers, both against the shipped files, the way test/deckboards.test.js
 * runs them: the mat is the deck-builder modules in a vm sandbox, and the
 * frame is the markup and the stylesheet read as text where what matters is a
 * rule that must exist.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── The mat ───────────────────────────────────────────────────────────────
/* Card data in the shape the server sends it — trimmed Scryfall objects — so
 * that what the filter reads is what cardMetaOf() makes of a real card and not
 * a hand-built row of the fields this test happens to want. */
const CARDS = {
  'Sol Ring': {
    name: 'Sol Ring', type_line: 'Artifact', cmc: 1, mana_cost: '{1}',
    colors: [], color_identity: [], rarity: 'uncommon', layout: 'normal',
    oracle_text: '{T}: Add {C}{C}.', prices: { eur: '1.20' },
  },
  'Goblin Guide': {
    name: 'Goblin Guide', type_line: 'Creature — Goblin Scout', cmc: 1, mana_cost: '{R}',
    colors: ['R'], color_identity: ['R'], rarity: 'rare', layout: 'normal', power: '2',
    toughness: '2', oracle_text: 'Haste\nWhenever Goblin Guide attacks, defending player draws a card.',
    prices: { eur: '9.00' },
  },
  'Krenko, Mob Boss': {
    name: 'Krenko, Mob Boss', type_line: 'Legendary Creature — Goblin Warrior', cmc: 4,
    mana_cost: '{2}{R}{R}', colors: ['R'], color_identity: ['R'], rarity: 'rare',
    layout: 'normal', power: '3', toughness: '3',
    oracle_text: '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
    prices: { eur: '3.50' },
  },
  'Cultivate': {
    name: 'Cultivate', type_line: 'Sorcery', cmc: 3, mana_cost: '{2}{G}',
    colors: ['G'], color_identity: ['G'], rarity: 'common', layout: 'normal',
    oracle_text: 'Search your library for up to two basic land cards…',
    prices: { eur: '0.30' },
  },
  'Mountain': {
    name: 'Mountain', type_line: 'Basic Land — Mountain', cmc: 0, mana_cost: '',
    colors: [], color_identity: ['R'], rarity: 'common', layout: 'normal',
    oracle_text: '{T}: Add {R}.', prices: { eur: '0.10' },
  },
};

const DECK = [
  { card_name: 'Sol Ring',         category: 'Ramp' },
  { card_name: 'Goblin Guide',     category: 'Creatures' },
  { card_name: 'Krenko, Mob Boss', category: 'Creatures' },
  { card_name: 'Cultivate',        category: 'Ramp' },
  { card_name: 'Mountain',         category: 'Lands', qty: 8 },
];

const CATS = ['Creatures', 'Ramp', 'Lands', 'Enchantments'];

/** The tab, loaded whole, over a deck with card data in hand — the state a
 *  deck is in a moment after it is opened, since the mat fetches every card's
 *  facts as it loads the deck. */
function loadTab(cards = DECK, cats = CATS, data = CARDS) {
  const store = new Map();
  const mat   = { innerHTML: '', classList: { toggle() {} } };
  const els   = {};
  const el = id => (els[id] ||= {
    innerHTML: '', textContent: '', title: '', value: '', style: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    classes: new Set(),
    classList: {
      toggle(name, on) { on ? els[id].classes.add(name) : els[id].classes.delete(name); },
      add(name) { els[id].classes.add(name); },
      remove(name) { els[id].classes.delete(name); },
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
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    isMyPlayer: id => id === 'p1',
    confirm: () => true,
    alert: () => {},
    clearTimeout() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    saves: 0,
    esc: s => String(s),
    jsAttr: s => String(s),
    renderMana: () => '', renderPrice: () => '', sfCardOwnership: () => '',
    /* What js/deckview-owned.js reaches outside the tab for: the collections,
       whose each of them is, and who you are. None of these decks is owned by
       anybody here — that is test/deckowned.test.js's subject — so the shelf is
       empty, nothing is owned, and the ownership chip is off. */
    state: { collections: [], players: [] },
    myPlayerId: () => null, colOwner: () => null, playerColor: () => '',
    scryfallMetaCache: new Map(),
    openCardByName() {},
    animateCardMove: (_el, paint) => paint(),
  };
  sandbox.setTimeout = fn => { sandbox.saves++; return 1; };
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  for (const file of ['sortui.js', 'cardstack.js', 'cardquery.js', 'deckview-boards.js',
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
  run(`dbCardData = new Map(${JSON.stringify(Object.entries(data))})`);

  return {
    run, answer, mat, el,
    /** Type into the box, and read back which cards are on the mat. */
    filter(text) {
      run(`dbSetFilter(${JSON.stringify(text)})`);
      return this.shown();
    },
    /** The card names the mat is drawing, in the order it drew them. */
    shown: () => [...mat.innerHTML.matchAll(/data-name="([^"]+)"/g)].map(m => m[1]),
    /** Which of the deck's categories are on the mat. The boards carry a
     *  heading of their own and are not categories, so this reads the
     *  attribute a category is a drop target by rather than the heading. */
    cats: () => [...mat.innerHTML.matchAll(/data-cat="([^"]*)"/g)].map(m => m[1]),
    error: () => (mat.innerHTML.match(/class="db-filter-error">([^<]*)/) || [, ''])[1],
    box: () => el('dbFilterInput'),
    cards: () => answer('dbCards').map(c => `${c.card_name}×${c.qty}`).sort(),
    saves: () => sandbox.saves,
  };
}

// ── A bare word is what it was ────────────────────────────────────────────
/* The whole reason the parser grew an option. Typing a word into this box has
 * always searched the name and the rules text, and it still does: nobody has
 * to learn a query language to type "goblin". */
test('a bare word still searches name and rules text', () => {
  const tab = loadTab();
  assert.deepStrictEqual(tab.filter('goblin'), ['Goblin Guide', 'Krenko, Mob Boss'],
    'a name search stopped finding a name');
  assert.deepStrictEqual(tab.filter('draws'), ['Goblin Guide'],
    'a bare word stopped reading the rules text');
  assert.deepStrictEqual(tab.filter('KRENKO'), ['Krenko, Mob Boss'], 'case mattered');
});

test('clearing the box brings every card back', () => {
  const tab = loadTab();
  tab.filter('goblin');
  assert.deepStrictEqual(tab.filter(''), tab.filter('   '), 'a box of spaces is an empty box');
  assert.strictEqual(tab.filter('').length, 5, 'a card did not come back');
});

// ── The rest of the language ──────────────────────────────────────────────
/* Read in the order the mat draws them, which is the deck's categories in
 * their own order — Creatures, Ramp, Lands — and the sort within each. */
test('the filters read the deck’s own card data', () => {
  const tab = loadTab();
  assert.deepStrictEqual(tab.filter('t:creature'), ['Goblin Guide', 'Krenko, Mob Boss']);
  assert.deepStrictEqual(tab.filter('c:g'),        ['Cultivate']);
  assert.deepStrictEqual(tab.filter('mv<=1'),      ['Goblin Guide', 'Sol Ring', 'Mountain']);
  assert.deepStrictEqual(tab.filter('o:tokens'),   ['Krenko, Mob Boss']);
  assert.deepStrictEqual(tab.filter('r:rare'),     ['Goblin Guide', 'Krenko, Mob Boss']);
  assert.deepStrictEqual(tab.filter('eur>=3'),     ['Goblin Guide', 'Krenko, Mob Boss']);
  assert.deepStrictEqual(tab.filter('is:land'),    ['Mountain']);
  assert.deepStrictEqual(tab.filter('pow>2'),      ['Krenko, Mob Boss']);
});

test('negation, OR and parentheses work, and lower-case or is a word', () => {
  const tab = loadTab();
  assert.deepStrictEqual(tab.filter('-t:creature'), ['Cultivate', 'Sol Ring', 'Mountain']);
  assert.deepStrictEqual(tab.filter('t:land OR t:sorcery'), ['Cultivate', 'Mountain']);
  assert.deepStrictEqual(tab.filter('(t:creature OR t:artifact) mv<=1'),
    ['Goblin Guide', 'Sol Ring']);
  assert.deepStrictEqual(tab.filter('t:land or t:sorcery'), [],
    'lower-case or was read as an operator');
});

test('a card whose facts have not arrived answers about its name and nothing else', () => {
  // Every card in the deck, and a cache with nothing in it — which is the tab
  // for the moment between opening a deck and its data landing.
  const tab = loadTab(DECK, CATS, {});
  assert.deepStrictEqual(tab.filter('goblin'), ['Goblin Guide'],
    'a name search stopped working while the data was in flight');
  assert.deepStrictEqual(tab.filter('t:creature'), [], 'a fact was invented');
});

// ── A query that cannot mean anything ─────────────────────────────────────
/* The failure mode this replaces: a filter the local cache cannot answer used
 * to be a substring nothing contained, so `f:commander` looked exactly like a
 * deck with nothing legal in it. It is refused by name now — and the deck goes
 * on being drawn, because the box is typed into a character at a time and half
 * of `c:pink` is a colour that isn't one. */
test('a filter the local card data cannot answer is refused by name', () => {
  const tab = loadTab();
  const shown = tab.filter('f:commander');
  assert.match(tab.error(), /format legality/, 'it did not say which filter, or why');
  assert.strictEqual(shown.length, 5, 'the deck was filtered by a query that never compiled');
});

test('an unknown filter says it is unknown rather than matching nothing', () => {
  const tab = loadTab();
  const shown = tab.filter('zzz:1');
  assert.match(tab.error(), /Unknown filter "zzz:"/);
  assert.strictEqual(shown.length, 5);
});

test('a half-typed filter is not an error, and does not empty the mat', () => {
  const tab = loadTab();
  assert.strictEqual(tab.filter('t:').length, 5, 'a filter with nothing in it yet filtered');
  assert.strictEqual(tab.error(), '', 'typing was reported as a mistake');
  assert.strictEqual(tab.filter('c:').length, 5);
  // …and one that is momentarily wrong on the way to being right: `c:pin` is
  // three keystrokes into `c:pink`, and neither of them is a colour.
  assert.strictEqual(tab.filter('c:pin').length, 5, 'the mat emptied mid-word');
  assert.match(tab.error(), /not a colour/);
});

test('the box says it too, and stops saying it when the query means something', () => {
  const tab = loadTab();
  tab.filter('f:commander');
  assert.ok(tab.box().classes.has('is-invalid'), 'the box that is wrong does not look it');
  assert.strictEqual(tab.box().attrs['aria-invalid'], 'true');
  tab.filter('t:creature');
  assert.ok(!tab.box().classes.has('is-invalid'), 'a good query left the box marked bad');
  assert.strictEqual(tab.box().attrs['aria-invalid'], 'false');
});

// ── What the filter is allowed to touch ───────────────────────────────────
test('filtering hides cards and changes nothing else', () => {
  const tab = loadTab();
  const before = tab.cards();
  const saves  = tab.saves();
  tab.filter('t:creature');
  assert.deepStrictEqual(tab.cards(), before, 'the filter edited the deck');
  assert.strictEqual(tab.saves(), saves, 'the filter saved the deck');
});

test('the deck’s readout counts the deck, not the search', () => {
  const tab = loadTab();
  tab.filter('t:creature');
  tab.run('dbRenderStats()');
  assert.match(tab.el('dbStatCards').innerHTML, />12\/60</,
    'the readout described the search instead of the deck');
  assert.match(tab.el('dbStatLands').innerHTML, />8</, 'the lands were counted by the search');
});

test('a card in a board the filter matches is still in that board', () => {
  // The filter runs over the mainboard and the boards alike; what it must not
  // do is move a card between them.
  const tab = loadTab([...DECK, { card_name: 'Cultivate', board: 'maybe', category: 'Ramp' }]);
  tab.run(`dbShownBoards = new Set(['maybe'])`);
  assert.strictEqual(tab.filter('cultivate').length, 2, 'both copies should be on the mat');
  assert.deepStrictEqual(tab.cards().filter(c => c.startsWith('Cultivate')),
    ['Cultivate×1', 'Cultivate×1']);
});

test('the filter composes with the sort', () => {
  const tab = loadTab();
  tab.run(`saveSortChain('deckbuild', { criteria: [{ field: 'cmc', dir: -1 }] })`);
  assert.deepStrictEqual(tab.filter('t:creature'), ['Krenko, Mob Boss', 'Goblin Guide'],
    'the sort was ignored, or the filter was');
});

// ── A category the filter emptied ─────────────────────────────────────────
test('a category the filter empties stays on the mat', () => {
  const tab = loadTab();
  tab.filter('t:creature');
  assert.deepStrictEqual(tab.cats(), ['Creatures', 'Ramp', 'Lands'],
    'a category of this deck disappeared while a search was running');
  assert.match(tab.mat.innerHTML, /db-cat-filtered/, 'the empty pile does not say why it is empty');
});

test('a category the deck itself has emptied is still a header and a gap', () => {
  const tab = loadTab();
  tab.filter('');
  assert.deepStrictEqual(tab.cats(), ['Creatures', 'Ramp', 'Lands'],
    'an empty category was drawn with no filter running');
});

test('a search that matches nothing anywhere says so once', () => {
  const tab = loadTab();
  assert.deepStrictEqual(tab.filter('t:planeswalker'), []);
  assert.deepStrictEqual(tab.cats(), [], 'every category said “no matches” separately');
  assert.match(tab.mat.innerHTML, /No cards match your search/);
});

/* The two empty mats say different things, and which is which is the filter's
 * to know: a deck with no cards in it has nothing to find. */
test('a deck with nothing in it still says it has nothing in it', () => {
  const tab = loadTab([]);
  tab.filter('');
  assert.match(tab.mat.innerHTML, /No cards yet/);
  tab.filter('goblin');
  assert.match(tab.mat.innerHTML, /No cards match your search/);
});

// ── Another deck's search is not this one's ───────────────────────────────
test('putting a deck down clears the filter with it', () => {
  const tab = loadTab();
  tab.filter('t:creature');
  tab.run(`state = { players: [] }; currentUser = null`);
  tab.run(`dbSelectDeck('')`);
  assert.strictEqual(tab.run('dbFilterText'), '', 'the next deck opens under the last one’s search');
  assert.strictEqual(tab.box().value, '', 'the box still reads what was typed over another deck');
});

// ── The frame ─────────────────────────────────────────────────────────────
test('the box is on the strip, and says what it now understands', () => {
  const markup = read('public/index.html');
  const box = markup.match(/<input[^>]*id="dbFilterInput"[^>]*>/)[0];
  assert.match(box, /oninput="dbSetFilter\(this\.value\)"/, 'the box is wired to the old filter');
  assert.match(box, /placeholder="[^"]*t:creature/,
    'the box does not say that it reads the query language');
});

test('one language, one syntax tip', () => {
  // Collections used to carry its own copy. Two copies are two syntaxes as
  // soon as one of them gains a filter.
  assert.match(read('public/js/cardquery.js'), /const CQ_SYNTAX_HELP/);
  assert.ok(!read('public/js/collections.js').includes('const COL_SYNTAX_HELP'),
    'the tip is spelled out twice');
});

test('the mat has somewhere to put both of the filter’s answers', () => {
  const css = read('public/css/tabs.css');
  assert.match(css, /\.db-filter-error\s*\{/, 'a refused query has nowhere to be shown');
  assert.match(css, /\.db-cat-filtered\s*\{/, 'an emptied pile has nowhere to say so');
  assert.match(read('public/css/components.css'), /\.search-input\.is-invalid/,
    'a box holding something that is not a query looks like one that is');
});
