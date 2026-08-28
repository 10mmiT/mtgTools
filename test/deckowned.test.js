/* The deck says what you own.
 *
 * Every card on the mat has worn an ownership badge for a long time and the
 * deck had no answer of its own: you could see that *this* card is in
 * somebody's box and not that eighty-seven of your ninety-nine are in yours.
 *
 * What is asserted here is the number, the twelve behind it, and — most of it —
 * the three ways this can quietly become wrong. It must count *copies*, so four
 * Forests with two on the shelf is short by two. It must count the *mainboard*,
 * so a maybeboard cannot flatter it. And it must never take a card off the mat:
 * scoping changes the question the readout and the badges answer, and a deck
 * builder that hid cards which are in your deck would be hiding your deck.
 *
 * Three layers, all against the shipped files:
 *
 *   the shelf   js/deckview-owned.js over collections in the shape the app
 *               hydrates them into, in a vm sandbox
 *   the mat     the whole tab in that sandbox — the readout, the badges, the
 *               chip and the missing list, drawn
 *   the frame   the markup and the stylesheet, read as text where what matters
 *               is a control that must exist
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

// ── The tab ───────────────────────────────────────────────────────────────
/* Loaded whole, and with the *real* js/collections.js and js/auth.js beside
 * the builder's own modules rather than stubs of them: whose a collection is
 * and who you are are exactly the two questions this ticket is built on, and a
 * stubbed answer to either would be a test of this file's opinion of them. */

/* Each of them carries the printing Scryfall hands back for the name, because
 * the real cache does — one card object per oracle id, and it is a real
 * printing with a set and a collector number on it. A deck that has chosen no
 * printing runs this one, so a fixture without it would put the whole
 * printing question out of reach of every test here. */
const CARDS = {
  'Sol Ring': { name: 'Sol Ring', type_line: 'Artifact', cmc: 1, color_identity: [],
                id: 'sr-c21', set: 'c21', set_name: 'Commander 2021', collector_number: '263' },
  'Cultivate': { name: 'Cultivate', type_line: 'Sorcery', cmc: 3, color_identity: ['G'],
                 id: 'cu-c21', set: 'c21', set_name: 'Commander 2021', collector_number: '188' },
  'Krenko, Mob Boss': { name: 'Krenko, Mob Boss', type_line: 'Legendary Creature — Goblin',
                        cmc: 4, color_identity: ['R'],
                        id: 'kr-m13', set: 'm13', set_name: 'Magic 2013', collector_number: '140' },
  'Forest': { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, color_identity: ['G'],
              id: 'fo-unf', set: 'unf', set_name: 'Unfinity', collector_number: '239' },
  'Mox Diamond': { name: 'Mox Diamond', type_line: 'Artifact', cmc: 0, color_identity: [],
                   id: 'mo-stw', set: 'stw', set_name: 'Stronghold', collector_number: '138' },
};

/* Four cards in the deck and eight Forests, so that "copies, not rows" has
 * something to be wrong about. */
const DECK = [
  { card_name: 'Sol Ring',         category: 'Ramp' },
  { card_name: 'Cultivate',        category: 'Ramp' },
  { card_name: 'Krenko, Mob Boss', category: 'Creatures' },
  { card_name: 'Mox Diamond',      category: 'Ramp' },
  { card_name: 'Forest',           category: 'Lands', qty: 8 },
];

const PLAYERS = [
  { id: 'p-tim',  name: 'Tim',  colorIdx: 0, wantList: [], decks: [] },
  { id: 'p-anna', name: 'Anna', colorIdx: 1, wantList: [], decks: [] },
];

/* Three shelves, one of each kind: mine, somebody else's, and the box in the
 * cupboard that belongs to nobody. Between them they put every card of the
 * deck into exactly one interesting case. */
const SHELVES = [
  { key: 'c:tim', name: 'Tim’s box', source: 'csv-moxfield', color: '#a855f7', owner: 'p-tim',
    cards: { 'Sol Ring': { name: 'Sol Ring', qty: 1 },
             'Forest':   { name: 'Forest',   qty: 6 } } },
  { key: 'c:anna', name: 'Anna’s box', source: 'csv-moxfield', color: '#3b82f6', owner: 'p-anna',
    cards: { 'Krenko, Mob Boss': { name: 'Krenko, Mob Boss', qty: 1 },
             'Forest':           { name: 'Forest',           qty: 4 } } },
  { key: 'c:box', name: 'The cupboard', source: 'csv-moxfield', color: '#10b981', owner: null,
    cards: { 'Cultivate': { name: 'Cultivate', qty: 2 } } },
];

const AS_TIM   = { username: 'tim', role: 'player', playerId: 'p-tim' };
const AS_GUEST = { username: 'guest', role: 'admin', playerId: null };

function loadTab({ deck = DECK, collections = SHELVES, players = PLAYERS,
                   user = AS_TIM, remembered = '' } = {}) {
  const store = new Map();
  if (remembered) store.set('avail_name', remembered);
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
    calls: [], saves: 0,
    fetch: async (url, opts = {}) => {
      sandbox.calls.push({ url, method: opts.method || 'GET',
                           body: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true, status: 200, json: async () => ({ ok: true, version: 7 }) };
    },
    // Outside this ticket: the pictures, the prices, the drawers, the mana.
    renderMana: () => '', renderPrice: () => '',
    openCardByName() {}, openDrawer() {}, closeDrawers() {}, renderDeck() {},
    ensureScryfallImages: async () => {},
    scryfallCache: new Map(), scryfallMetaCache: new Map(),
    deck: null, deckFilter: false, viewMode: 'list',
    animateCardMove: (_el, paint) => paint(),
  };
  sandbox.setTimeout = fn => { sandbox.saves++; return 1; };
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

  run(`currentUser = ${JSON.stringify(user)}`);
  run(`hydrateState(${JSON.stringify({ players, collections })})`);
  run(`dbDeck = { id: 'd1', playerId: 'p-tim', name: 'A deck', commander: '' }`);
  run(`dbCards = ${JSON.stringify(deck.map((c, i) => ({ qty: 1, board: 'main', position: i, ...c })))}`);
  run(`dbCats = ${JSON.stringify(['Ramp', 'Creatures', 'Lands'].map((name, i) => ({ name, position: i })))}`);
  run(`dbCardData = new Map(${JSON.stringify(Object.entries(CARDS))})`);

  return {
    run, answer, mat, el, store,
    calls: () => sandbox.calls,
    /** The keys of the collections the current scope counts. */
    shelf: () => answer('dbOwnShelf().map(c => c.key)'),
    /** The whole answer: how many copies, and what is short. */
    owned: () => answer('dbDeckOwnership()'),
    /** The readout line, drawn. */
    readout() { run('dbRenderStats()'); return el('dbStatOwned').innerHTML; },
    /** The missing list, opened and drawn. */
    panel() { run('_dbOwnedPanelOpen = true; _dbSyncOwnedPanel()'); return el('dbOwnedPanel').innerHTML; },
    /** Which cards the mat is drawing, in the order it drew them. */
    onMat() {
      run('dbRender()');
      return [...mat.innerHTML.matchAll(/data-moves="card:main\/([^"]+)"/g)].map(m => m[1]);
    },
  };
}

// ── The shelf ─────────────────────────────────────────────────────────────

test('the three scopes widen: mine, then the group’s, then everyone’s', () => {
  // A ladder rather than three unrelated shelves — the group's includes yours,
  // because a shared box belongs to everybody and is not a *different* set of
  // cards from your own, it is more of them.
  const tab = loadTab();
  assert.deepStrictEqual(tab.shelf(), ['c:tim'], 'mine is not mine');
  tab.run(`dbSetOwnScope('group')`);
  assert.deepStrictEqual(tab.shelf(), ['c:tim', 'c:box'],
    'the group’s is not yours plus the box nobody owns');
  tab.run(`dbSetOwnScope('all')`);
  assert.deepStrictEqual(tab.shelf(), ['c:tim', 'c:anna', 'c:box']);
});

test('yours is the default, and the choice is remembered against you', () => {
  const tab = loadTab();
  assert.strictEqual(tab.run('dbOwnScope()'), 'mine');
  tab.run(`dbSetOwnScope('all')`);
  assert.strictEqual(tab.run(`localStorage.getItem(DB_OWN_SCOPE_KEY + ':p-tim')`), 'all');
  assert.strictEqual(tab.run('dbOwnScope()'), 'all');
});

/* Two people share a browser in open mode, where being somebody is a name
 * typed into Available@'s bar. "Mine" means something different to each of
 * them, so one's scope must not follow the other. */
test('and against them, not against the browser', () => {
  const tab = loadTab({ user: AS_GUEST, remembered: 'Tim' });
  tab.run(`dbSetOwnScope('mine')`);
  assert.strictEqual(tab.run('dbOwnScope()'), 'mine');
  tab.run(`localStorage.setItem('avail_name', 'Anna')`);
  assert.strictEqual(tab.run('dbOwnScope()'), 'mine',
    'a scope stored under one person is read as a default, not as theirs');
  assert.deepStrictEqual(tab.shelf(), ['c:anna'], 'and mine is now Anna’s');
});

test('a collection still loading is not counted', () => {
  // Half a collection is not a smaller shelf, it is a wrong answer — the rule
  // sfCardOwnership() has always followed.
  const tab = loadTab();
  tab.run(`state.collections.find(c => c.key === 'c:tim').status = 'loading'`);
  assert.deepStrictEqual(tab.shelf(), []);
  assert.strictEqual(tab.owned().owned, 0);
});

// ── The number ────────────────────────────────────────────────────────────

test('the readout counts copies, not rows', () => {
  // Tim has one Sol Ring and six of the eight Forests the deck asks for. Seven
  // of twelve, and a readout that called eight Forests "owned" would be lying
  // about the only thing it is for.
  const tab = loadTab();
  const { total, owned } = tab.owned();
  assert.strictEqual(total, 12, 'the deck is four singles and eight Forests');
  assert.strictEqual(owned, 7, 'one Sol Ring and six Forests');
});

test('and never counts more copies than the deck asks for', () => {
  const tab = loadTab();
  tab.run(`state.collections.find(c => c.key === 'c:tim').cards.get('Sol Ring').qty = 40`);
  assert.strictEqual(tab.owned().owned, 7, 'a shelf full of Sol Rings inflated the deck');
});

test('the mainboard is the deck: a maybeboard cannot flatter it', () => {
  const tab = loadTab();
  const before = tab.owned();
  tab.run(`dbCards.push({ card_name: 'Mox Diamond', qty: 1, category: 'Ramp', board: 'maybe', position: 9 })`);
  tab.run(`dbCards.push({ card_name: 'Sol Ring', qty: 1, category: 'Ramp', board: 'commander', position: 10 })`);
  assert.deepStrictEqual(tab.owned(), before,
    'a card that is not in the deck moved a number about the deck');
});

test('what is missing is separated into what somebody has and what nobody has', () => {
  const tab = loadTab();
  const short = tab.owned().short;
  assert.deepStrictEqual(short.map(s => s.name),
    ['Cultivate', 'Forest', 'Krenko, Mob Boss', 'Mox Diamond']);

  const by = Object.fromEntries(short.map(s => [s.name, s]));
  assert.deepStrictEqual(by['Krenko, Mob Boss'].holders.map(h => h.who), ['Anna'],
    'the person who could lend it is not named');
  assert.deepStrictEqual(by['Cultivate'].holders.map(h => h.who), ['The group'],
    'the box nobody owns is not the group’s');
  assert.deepStrictEqual(by['Mox Diamond'].holders, [],
    'a card in no collection at all is an error rather than nobody’s');
  assert.strictEqual(by['Forest'].need - by['Forest'].have, 2,
    'a card you are two copies short of is not two copies short');
});

test('a card nobody has anywhere is nobody’s, not a failure', () => {
  const tab = loadTab({ collections: [] });
  const { owned, total, short } = tab.owned();
  assert.strictEqual(owned, 0);
  assert.strictEqual(total, 12);
  assert.strictEqual(short.length, 5);
  assert.ok(short.every(s => s.holders.length === 0));
});

test('the line says how many, and whose', () => {
  const tab = loadTab();
  assert.match(tab.readout(), /7<\/strong> of 12 you own/);
  /* Everyone's finds Anna's Krenko, her four Forests — which fill the two the
     deck was short of — and the cupboard's Cultivate: eleven of twelve, with
     only the Mox nobody has left over. */
  tab.run(`dbSetOwnScope('all')`);
  assert.match(tab.readout(), /11<\/strong> of 12 we own/,
    'widening the scope neither changed the word nor found what the others have');
});

// ── Nobody to be ──────────────────────────────────────────────────────────

test('with no way to say who you are the readout is the group’s, and does not break', () => {
  const tab = loadTab({ user: AS_GUEST });
  assert.strictEqual(tab.run('myPlayerId()'), null);
  assert.strictEqual(tab.run('dbOwnScope()'), 'group');
  assert.deepStrictEqual(tab.shelf(), ['c:tim', 'c:anna', 'c:box'],
    'with nobody to be, every shelf is the group’s');
  assert.match(tab.readout(), /the group owns/);
});

test('and the distinction is not offered at all', () => {
  const tab = loadTab({ user: AS_GUEST });
  tab.run('dbSyncOwnScope()');
  assert.ok(tab.el('dbOwnScopeMount').classes.has('scope-mount-hidden'),
    'the scope control is on the strip with nothing to mean');
});

test('a stored scope from a browser that once knew cannot hide anything', () => {
  const tab = loadTab({ user: AS_GUEST });
  tab.run(`localStorage.setItem(DB_OWN_SCOPE_KEY + ':', 'mine')`);
  assert.strictEqual(tab.run('dbOwnScope()'), 'group');
  assert.deepStrictEqual(tab.shelf(), ['c:tim', 'c:anna', 'c:box']);
});

test('typing a name into the “Who are you?” bar makes the distinction real', () => {
  const tab = loadTab({ user: AS_GUEST, remembered: 'anna' });
  assert.strictEqual(tab.run('myPlayerId()'), 'p-anna');
  assert.strictEqual(tab.run('dbOwnScope()'), 'mine');
  assert.deepStrictEqual(tab.shelf(), ['c:anna']);
});

// ── The mat ───────────────────────────────────────────────────────────────

test('every card in the deck stays on the mat at every scope', () => {
  // The heart of the ticket. Scoping changes the *question* the readout and
  // the badges answer; it never takes a card off the mat, because a deck
  // builder that hides cards which are in your deck is hiding your deck.
  const tab = loadTab();
  const all = ['Cultivate', 'Forest', 'Krenko, Mob Boss', 'Mox Diamond', 'Sol Ring'];
  for (const scope of ['mine', 'group', 'all']) {
    tab.run(`dbSetOwnScope('${scope}')`);
    assert.deepStrictEqual(tab.onMat().sort(), all, `the ${scope} scope hid a card`);
  }
});

test('the badges answer the scope’s question, and name whoever else has it', () => {
  const tab = loadTab();
  tab.onMat();
  const mine = tab.mat.innerHTML;
  assert.match(mine, /Tim’s box ×1/, 'a card you own does not say so');
  assert.match(mine, /db-badge-elsewhere[\s\S]*?Anna ×1/,
    'a card only Anna has is not shown as Anna’s');
  tab.run(`dbSetOwnScope('all')`);
  tab.onMat();
  assert.match(tab.mat.innerHTML, /Anna’s box ×1/,
    'widened to everyone’s, Anna’s box is a shelf like any other');
  assert.doesNotMatch(tab.mat.innerHTML, /db-badge-elsewhere/,
    'nothing is somebody else’s when the scope is everybody');
});

test('the chip is off until it is pressed, and one at a time', () => {
  const tab = loadTab();
  assert.strictEqual(tab.run('dbOwnChip'), null);
  assert.strictEqual(tab.onMat().length, 5);

  tab.run(`dbToggleOwnChip('missing')`);
  assert.deepStrictEqual(tab.onMat().sort(),
    ['Cultivate', 'Forest', 'Krenko, Mob Boss', 'Mox Diamond'],
    'six of eight Forests is not short of two');

  tab.run(`dbToggleOwnChip('owned')`);
  assert.deepStrictEqual(tab.onMat(), ['Sol Ring'], 'pressing one chip left the other on');

  tab.run(`dbToggleOwnChip('elsewhere')`);
  assert.deepStrictEqual(tab.onMat().sort(), ['Cultivate', 'Forest', 'Krenko, Mob Boss'],
    'a card nobody has is not borrowable');

  tab.run(`dbToggleOwnChip('elsewhere')`);
  assert.strictEqual(tab.onMat().length, 5, 'pressing a chip again did not switch it off');
});

test('putting a deck down clears the chip with it', () => {
  // A mat left showing only what you are missing, over a deck you own all of,
  // is a deck that looks empty.
  const tab = loadTab();
  tab.run(`dbToggleOwnChip('missing')`);
  tab.run(`dbSelectDeck('')`);
  assert.strictEqual(tab.run('dbOwnChip'), null);
});

test('the filter box can ask the same question, and it composes', () => {
  const tab = loadTab();
  tab.run(`dbSetFilter('is:owned')`);
  assert.deepStrictEqual(tab.onMat(), ['Sol Ring']);
  tab.run(`dbSetFilter('-is:owned t:artifact')`);
  assert.deepStrictEqual(tab.onMat(), ['Mox Diamond']);
});

// ── The missing list ──────────────────────────────────────────────────────

test('the panel is two lists, and names who has what', () => {
  const tab = loadTab();
  const html = tab.panel();
  assert.match(html, /Somebody else has these/);
  assert.match(html, /Nobody has these/);
  assert.match(html, /5 of 12 missing/, 'the header does not count copies');
  // Anna is named, in her own player colour rather than in her box's.
  assert.match(html, /--player-1[\s\S]*?Anna/);
  assert.match(html, /Mox Diamond/);
});

test('a deck you own every copy of says so instead', () => {
  const tab = loadTab({ deck: [{ card_name: 'Sol Ring', category: 'Ramp' }] });
  assert.match(tab.panel(), /Every one of the 1 is on the shelf/);
});

test('the missing can be sent to the want list in one action, and arrive', async () => {
  const tab = loadTab();
  tab.panel();
  assert.match(tab.el('dbOwnedPanel').innerHTML, /Want all 4/);

  await tab.run('dbWantAllMissing(null)');
  const posts = tab.calls().filter(c => c.method === 'POST' && /\/wants$/.test(c.url));
  assert.deepStrictEqual(posts.map(p => p.body.cardName),
    ['Cultivate', 'Forest', 'Krenko, Mob Boss', 'Mox Diamond']);
  assert.ok(posts.every(p => p.url.includes('p-tim')), 'they went onto somebody else’s list');
  assert.deepStrictEqual(tab.answer(`state.players.find(p => p.id === 'p-tim').wantList`),
    ['Cultivate', 'Forest', 'Krenko, Mob Boss', 'Mox Diamond']);
});

test('a card already wanted is not sent a second time', () => {
  const tab = loadTab();
  tab.run(`state.players.find(p => p.id === 'p-tim').wantList = ['Cultivate']`);
  assert.deepStrictEqual(tab.answer('dbMissingUnwanted()'),
    ['Forest', 'Krenko, Mob Boss', 'Mox Diamond']);
  assert.match(tab.panel(), /Want all 3/);
});

test('with nobody to be there is nobody to want the card', () => {
  const tab = loadTab({ user: AS_GUEST });
  const html = tab.panel();
  assert.doesNotMatch(html, /Want all/);
  assert.doesNotMatch(html, /db-owned-want/);
});

// ── Choosing what to add ──────────────────────────────────────────────────

test('the search drawer asks the shelf rather than discarding Scryfall’s answer', async () => {
  const tab = loadTab();
  tab.el('dbSearchInput').value = 't:artifact';
  tab.el('dbSearchOwned').value = 'mine';
  tab.el('dbCiToggle').checked = false;
  /* The facts a `t:` needs, in the cache the Collections tab fills — the same
     one the local search reads. */
  tab.run(`scryfallMetaCache.set('Sol Ring', { type: 'Artifact', cmc: 1 })`);
  tab.run(`scryfallMetaCache.set('Forest', { type: 'Basic Land — Forest', cmc: 0 })`);

  await tab.run('dbSearch()');
  assert.deepStrictEqual(tab.answer('dbSrResults.map(c => c.name)'), ['Sol Ring'],
    'the shelf was not searched, or the query was not run over it');
  assert.ok(!tab.calls().some(c => /scryfall/i.test(c.url)),
    'a search of our own cards went to Scryfall');
});

test('and it means the same shelves the readout means', async () => {
  const tab = loadTab();
  tab.el('dbSearchInput').value = 'cultivate';
  tab.el('dbSearchOwned').value = 'mine';
  tab.el('dbCiToggle').checked = false;
  await tab.run('dbSearch()');
  assert.deepStrictEqual(tab.answer('dbSrResults.map(c => c.name)'), [],
    'a card only the cupboard has is on my own shelf');

  tab.el('dbSearchOwned').value = 'group';
  await tab.run('dbSearch()');
  assert.deepStrictEqual(tab.answer('dbSrResults.map(c => c.name)'), ['Cultivate']);
});

test('with the narrowing off the box is Scryfall’s again', () => {
  const tab = loadTab();
  assert.strictEqual(tab.run(`_dbSearchOwnScope()`), '',
    'the drawer opens narrowed to a shelf');
});

// ── The frame ─────────────────────────────────────────────────────────────

test('the readout carries an ownership line, and it opens', () => {
  const markup = read('public/index.html');
  const btn = markup.match(/<button id="dbStatOwned"[\s\S]*?>/)[0];
  assert.match(btn, /onclick="dbToggleOwnedPanel\(\)"/);
  assert.match(btn, /aria-controls="dbOwnedPanel"/);
  assert.match(markup, /<div id="dbOwnedPanel"/);
  // Inside the bar, so it rises out of the line it belongs to and goes with it
  // on the second fold.
  const bar = markup.match(/<div class="db-stats-bar[\s\S]*?\n  <\/div>/)[0];
  assert.ok(bar.includes('dbOwnedPanel'), 'the missing list is not anchored to the readout');
});

test('the scope control is on the strip and can be hidden', () => {
  const markup = read('public/index.html');
  const sel = markup.match(/<select id="dbOwnScopeSel"[\s\S]*?<\/select>/)[0];
  assert.match(sel, /onchange="dbSetOwnScope\(this\.value\)"/);
  assert.match(sel, /aria-label=/, 'the control says what it is to a screen reader');
  for (const scope of ['mine', 'group', 'all']) {
    assert.match(sel, new RegExp(`value="${scope}"`), `no way to ask for ${scope}`);
  }
  assert.match(markup, /id="dbOwnScopeMount"/);
  assert.match(read('public/css/components.css'), /\.scope-mount-hidden \{ display: none; \}/);
});

test('the mat has a place for its chips, and the drawer for its scope', () => {
  const markup = read('public/index.html');
  assert.match(markup, /id="dbOwnChips"/);
  const sel = markup.match(/<select id="dbSearchOwned"[\s\S]*?<\/select>/)[0];
  assert.match(sel, /onchange="dbSearch\(\)"/);
  assert.match(sel, /<option value="">/, 'all of Magic is not the option it opens on');
});

test('the phone can hit everything this ticket added', () => {
  // The readout line is a button now, and the missing list carries a close and
  // a want button per row. The 44px floor is scripts/measure-mobile.js's to
  // enforce; what is asserted here is that a rule exists to be measured.
  const css = read('public/css/tabs.css');
  const phone = css.slice(css.indexOf('── The phone, per tab ──'));
  for (const rule of ['.db-stat-owned', '.db-owned-close', '.db-owned-want']) {
    assert.match(phone, new RegExp(`\\${rule}[^}]*min-(width|height): 44px`),
      `${rule} has no floor on a phone`);
  }
  // And the bar the missing list hangs off has to be a position ancestor at
  // that width, or the list rises out of the page instead.
  assert.match(phone, /\.db-stats-bar \{ position: relative;/);
});

// ── Which printing, not just which card ───────────────────────────────────
/* The sharper question. A deck that reads as fully owned may still be a deck
 * you cannot sleeve, because the shelf holds a different edition of half of
 * it — so ownership answers four things rather than two: you own the printing
 * this deck runs, you own the card in another printing, you own it and nobody
 * recorded which, or you do not own it.
 *
 * The third is the one that must not be got wrong. Every collection in
 * existence is in it until it is re-imported, and reading it as either of the
 * other two would tell a whole playgroup their shelves are wrong. */

const SR = {
  c21:  { id: 'sr-c21', set: 'c21', set_name: 'Commander 2021', collector_number: '263' },
  foil: { id: 'sr-c21', set: 'c21', set_name: 'Commander 2021', collector_number: '263',
          finish: 'foil' },
  ltc:  { id: 'sr-ltc', set: 'ltc', set_name: 'Tales of Middle-earth', collector_number: '284' },
};

/** Tim's box, holding exactly these copies of Sol Ring and nothing else. */
const timsSolRings = (...printings) => [{
  key: 'c:tim', name: 'Tim’s box', source: 'archidekt', color: '#a855f7', owner: 'p-tim',
  cards: { 'Sol Ring': {
    name: 'Sol Ring',
    qty: printings.reduce((n, p) => n + p.qty, 0),
    printings,
  } },
}];

/** A one-card deck running one named printing of the Sol Ring. */
const ringDeck = printing => [{ card_name: 'Sol Ring', category: 'Ramp', printing }];

// ── The query layer ───────────────────────────────────────────────────────

test('the shelf can be asked which printings of a card it holds', () => {
  const tab = loadTab({
    collections: timsSolRings({ ...SR.c21, qty: 2 }, { ...SR.ltc, qty: 1 }),
    deck: ringDeck(SR.c21),
  });
  assert.deepStrictEqual(
    tab.answer(`dbOwnedPrintings('Sol Ring').map(p => [p.set, p.qty])`),
    [['c21', 2], ['ltc', 1]]);
  assert.deepStrictEqual(tab.answer(`dbOwnedPrintings('Mox Diamond')`), [],
    'a card on no shelf holds no printings, rather than an unknown one');
});

test('and whether it holds one in particular', () => {
  const tab = loadTab({ collections: timsSolRings({ ...SR.c21, qty: 1 }) });
  assert.strictEqual(tab.answer(`dbOwnsPrinting('Sol Ring', ${JSON.stringify(SR.c21)})`), true);
  assert.strictEqual(tab.answer(`dbOwnsPrinting('Sol Ring', ${JSON.stringify(SR.ltc)})`), false);
});

test('a printing is owned whatever language it is in and whatever state it is in', () => {
  // A lightly played German copy is still the card. Language and condition are
  // part of a copy's identity on the shelf; they are not a reason to call it a
  // different card when somebody asks whether they own it.
  const tab = loadTab({
    collections: timsSolRings({ ...SR.c21, lang: 'de', condition: 'LP', qty: 1 }),
  });
  assert.strictEqual(
    tab.answer(`dbOwnsPrinting('Sol Ring', ${JSON.stringify({ ...SR.c21, lang: 'en' })})`), true);
  assert.deepStrictEqual(
    tab.answer(`dbOwnedPrintings('Sol Ring').map(p => [p.set, p.qty])`), [['c21', 1]],
    'two conditions of one printing came back as two printings');
});

test('but a foil and an ordinary copy are not the same printing', () => {
  // Not a printing of its own in Scryfall's model — a finish on the same id,
  // priced separately — which is exactly why it cannot roll up.
  const tab = loadTab({ collections: timsSolRings({ ...SR.foil, qty: 1 }) });
  assert.strictEqual(tab.answer(`dbOwnsPrinting('Sol Ring', ${JSON.stringify(SR.foil)})`), true);
  assert.strictEqual(tab.answer(`dbOwnsPrinting('Sol Ring', ${JSON.stringify(SR.c21)})`), false,
    'the foil answered for the ordinary copy somebody paid rather less for');
});

test('a shelf that recorded nothing owns no printing anybody can name', () => {
  const tab = loadTab({ collections: timsSolRings({ id: null, qty: 3 }) });
  assert.strictEqual(tab.answer(`dbOwnsPrinting('Sol Ring', ${JSON.stringify(SR.c21)})`), false);
  assert.deepStrictEqual(tab.answer(`dbOwnedPrintings('Sol Ring').map(p => [p.id, p.qty])`),
    [[null, 3]], 'the copies nobody can attribute are not an empty answer');
});

// ── The four states ───────────────────────────────────────────────────────

test('a deck whose cards are owned in the printings it runs reads as owned', () => {
  const tab = loadTab({
    collections: timsSolRings({ ...SR.c21, qty: 1 }), deck: ringDeck(SR.c21),
  });
  assert.strictEqual(tab.answer(`dbPrintingState(dbMainCards()[0])`), 'owned');
  assert.deepStrictEqual(tab.answer('dbPrintingCounts()'),
    { owned: 1, other: 0, unknown: 0, none: 0 });
});

test('a deck owned only in other printings reads as owned in another printing', () => {
  const tab = loadTab({
    collections: timsSolRings({ ...SR.ltc, qty: 1 }), deck: ringDeck(SR.c21),
  });
  assert.strictEqual(tab.answer(`dbPrintingState(dbMainCards()[0])`), 'other');
  assert.deepStrictEqual(tab.answer('dbPrintingCounts()'),
    { owned: 0, other: 1, unknown: 0, none: 0 });
});

test('and that is distinct from both owning it and not owning it', () => {
  const state = (collections, deck) =>
    loadTab({ collections, deck }).answer(`dbPrintingState(dbMainCards()[0])`);
  assert.notStrictEqual(state(timsSolRings({ ...SR.ltc, qty: 1 }), ringDeck(SR.c21)),
                        state(timsSolRings({ ...SR.c21, qty: 1 }), ringDeck(SR.c21)));
  assert.notStrictEqual(state(timsSolRings({ ...SR.ltc, qty: 1 }), ringDeck(SR.c21)),
                        state([], ringDeck(SR.c21)));
  assert.strictEqual(state([], ringDeck(SR.c21)), 'none');
});

test('a shelf with no printing data reads as unknown — never as unowned, never as a mismatch', () => {
  // Every collection in existence is here until it is re-imported. Reading it
  // as *not owned* would tell people their shelves are empty; reading it as
  // *the wrong printing* would tell them to buy a card they already have.
  const tab = loadTab({
    collections: timsSolRings({ id: null, qty: 1 }), deck: ringDeck(SR.c21),
  });
  assert.strictEqual(tab.answer(`dbPrintingState(dbMainCards()[0])`), 'unknown');
  assert.deepStrictEqual(tab.answer('dbPrintingCounts()'),
    { owned: 0, other: 0, unknown: 1, none: 0 });
});

test('and so does a shelf that knows some of its copies and not the rest', () => {
  // Two Sol Rings, one of them the wrong set and one nobody wrote down. The
  // one nobody wrote down could be the printing the deck runs, so it is not a
  // mismatch and cannot be reported as one.
  const tab = loadTab({
    collections: timsSolRings({ ...SR.ltc, qty: 1 }, { id: null, qty: 1 }),
    deck: ringDeck(SR.c21),
  });
  assert.strictEqual(tab.answer(`dbPrintingState(dbMainCards()[0])`), 'unknown');
});

/* A Moxfield CSV shelf: every copy has an edition and a collector number and
   none of them has a Scryfall id. Those copies *might* be the printing the
   deck runs — nothing here can tell without asking Scryfall — so they are the
   unknown answer and never the mismatch that would send somebody out to buy a
   card they already own. */
test('copies known only by set and number are unknown, not a mismatch', () => {
  const tab = loadTab({
    collections: timsSolRings({ set: 'c21', collector_number: '263', qty: 1 }),
    deck: ringDeck(SR.c21),
  });
  assert.strictEqual(tab.answer(`dbPrintingState(dbMainCards()[0])`), 'unknown');
  assert.deepStrictEqual(tab.answer('dbPrintingCounts()'),
    { owned: 0, other: 0, unknown: 1, none: 0 });
});

/* They are still two printings to look at, and the card page lists them —
   folding them into one row would put one copy's set over the other's. */
test('and two of them stay two, rather than folding into one unknown', () => {
  const tab = loadTab({ collections: timsSolRings(
    { set: 'c21', collector_number: '263', qty: 1 },
    { set: 'ltc', collector_number: '284', qty: 2 },
  ) });
  assert.deepStrictEqual(
    tab.answer(`dbOwnedPrintings('Sol Ring').map(p => [p.set, p.collector_number, p.qty])`),
    [['c21', '263', 1], ['ltc', '284', 2]]);
});

test('a matching copy is the answer whatever else is on the shelf', () => {
  const tab = loadTab({
    collections: timsSolRings({ ...SR.c21, qty: 1 }, { ...SR.ltc, qty: 1 }, { id: null, qty: 4 }),
    deck: ringDeck(SR.c21),
  });
  assert.strictEqual(tab.answer(`dbPrintingState(dbMainCards()[0])`), 'owned');
});

test('a deck that names no printing runs the one Scryfall hands back', () => {
  // A deck nobody has hand-picked art in is not a deck running no printing —
  // it is a deck running the default, which is the printing the mat has been
  // drawing all along. Almost every deck is this one, so a question it could
  // not be asked would be a question nearly nothing could be asked.
  const on = printings =>
    loadTab({ collections: timsSolRings(...printings), deck: ringDeck(undefined) })
      .answer(`dbPrintingState(dbMainCards()[0])`);
  // CARDS['Sol Ring'] is the C21 one.
  assert.strictEqual(on([{ ...SR.c21, qty: 1 }]), 'owned');
  assert.strictEqual(on([{ ...SR.ltc, qty: 1 }]), 'other',
    'the shelf’s Middle-earth copy answered for the default the deck draws');
  assert.strictEqual(on([{ id: null, qty: 1 }]), 'unknown');
  assert.strictEqual(on([]), 'none');
});

test('and a chosen printing beats the default', () => {
  const tab = loadTab({
    collections: timsSolRings({ ...SR.ltc, qty: 1 }), deck: ringDeck(SR.ltc),
  });
  assert.strictEqual(tab.answer(`dbPrintingState(dbMainCards()[0])`), 'owned',
    'the deck was measured against the default it was told not to run');
});

test('a name the app has no card data for is asked nothing', () => {
  // The data is merely late — or the card is one live Scryfall has never heard
  // of. Either way there is no printing to hold the shelf against, and marking
  // the card over that would be the app reporting its own latency.
  const tab = loadTab({
    collections: [{ key: 'c:tim', name: 'Tim’s box', source: 'archidekt',
                    color: '#a855f7', owner: 'p-tim',
                    cards: { 'Ancestral Recall': { name: 'Ancestral Recall', qty: 1,
                                                   printings: [{ ...SR.ltc, qty: 1 }] } } }],
    deck: [{ card_name: 'Ancestral Recall', category: 'Ramp' }],
  });
  assert.strictEqual(tab.answer(`dbCardPrinting(dbMainCards()[0])`), null);
  assert.strictEqual(tab.answer(`dbPrintingState(dbMainCards()[0])`), 'owned');
  tab.onMat();
  assert.doesNotMatch(tab.mat.innerHTML, /db-print-mark/);
});

test('the name-level counts are exactly what they were', () => {
  // The whole of this ticket hangs off the shelf gaining printings, and the
  // number that has been on the readout for a fortnight must not move by a
  // single copy because of it.
  const plain   = loadTab().owned();
  const printed = loadTab({
    collections: SHELVES.map(c => ({ ...c, cards: Object.fromEntries(
      Object.entries(c.cards).map(([name, card]) => [name, { ...card,
        printings: [{ ...SR.ltc, id: `x-${name}`, qty: card.qty }] }]))})),
  }).owned();
  assert.deepStrictEqual(printed, plain, 'recording the printings moved the owned count');
});

// ── What the mat and the readout say ──────────────────────────────────────

const drawnFor = (collections, printing = SR.c21) => {
  const tab = loadTab({ collections, deck: ringDeck(printing) });
  tab.onMat();
  return tab.mat.innerHTML;
};

test('the mat says which of the four it is', () => {
  assert.match(drawnFor(timsSolRings({ ...SR.c21, qty: 1 })), /Tim’s box ×1/);
  assert.doesNotMatch(drawnFor(timsSolRings({ ...SR.c21, qty: 1 })), /db-print-mark/,
    'the printing the deck runs was marked as a problem');

  assert.match(drawnFor(timsSolRings({ ...SR.ltc, qty: 1 })), /db-print-mark-other/);
  assert.match(drawnFor(timsSolRings({ ...SR.ltc, qty: 1 })), /not the C21 this deck runs/,
    'the mark says nothing about what is wrong with it');

  assert.match(drawnFor(timsSolRings({ id: null, qty: 1 })), /db-print-mark-unknown/);
  assert.doesNotMatch(drawnFor(timsSolRings({ id: null, qty: 1 })), /db-print-mark-other/,
    'a shelf that recorded nothing was called a mismatch');

  assert.doesNotMatch(drawnFor([]), /sf-badge/,
    'a card on nobody’s shelf is wearing a badge');
});

/* The mark is right for a Moxfield CSV shelf — those copies might be the one
   the deck runs — but the sentence under it must not tell somebody nobody
   recorded printings the app is listing by set and number two tabs away. */
test('and the mark over a shelf with no ids does not call it a blank one', () => {
  const html = drawnFor(timsSolRings({ set: 'c21', collector_number: '263', qty: 1 }));
  assert.match(html, /db-print-mark-unknown/);
  assert.doesNotMatch(html, /Nobody recorded/,
    'a shelf that named its editions was told it had recorded nothing');
  assert.match(html, /You have C21/);
});

test('and marks a deck that chose nothing against the default it draws', () => {
  assert.doesNotMatch(drawnFor(timsSolRings({ ...SR.c21, qty: 1 }), null), /db-print-mark/,
    'the default the deck draws is on the shelf, and was marked anyway');
  assert.match(drawnFor(timsSolRings({ ...SR.ltc, qty: 1 }), null), /db-print-mark-other/);
  assert.match(drawnFor(timsSolRings({ ...SR.ltc, qty: 1 }), null), /this deck defaults to/,
    'a printing nobody chose was described as one the deck runs');
  assert.match(drawnFor(timsSolRings({ ...SR.c21, qty: 1 }), SR.foil), /this deck runs/,
    'a printing somebody chose was described as one the deck fell into');
});

/* The mark is the shelf's answer and not one box's. Two boxes, one of them
 * holding the printing the deck runs: the deck can be sleeved out of the pair
 * of them, the readout says so, and a ⇄ on the other box would be the mat
 * contradicting the line above it. */
test('one box having the printing settles it for the whole shelf', () => {
  const shelves = [
    ...timsSolRings({ ...SR.ltc, qty: 1 }),
    { key: 'c:box', name: 'The cupboard', source: 'archidekt', color: '#10b981', owner: null,
      cards: { 'Sol Ring': { name: 'Sol Ring', qty: 1, printings: [{ ...SR.c21, qty: 1 }] } } },
  ];
  const tab = loadTab({ collections: shelves, deck: ringDeck(SR.c21) });
  tab.run(`dbSetOwnScope('group')`);
  assert.deepStrictEqual(tab.shelf(), ['c:tim', 'c:box'], 'the scope is not both boxes');
  tab.onMat();
  assert.match(tab.mat.innerHTML, /The cupboard ×1/);
  assert.doesNotMatch(tab.mat.innerHTML, /db-print-mark/,
    'a box holding another printing warned about a card the shelf can sleeve');
  assert.doesNotMatch(tab.readout(), /another printing/, 'and the line disagreed with the mat');
});

/* The two rollup rules, read off the mat rather than off the query layer —
 * these are what somebody actually sees, and they are the two acceptance
 * criteria most easily got wrong in the rendering rather than in the rule. */
test('a German lightly-played copy is the printing the deck runs', () => {
  assert.doesNotMatch(
    drawnFor(timsSolRings({ ...SR.c21, lang: 'de', condition: 'LP', qty: 1 })),
    /db-print-mark/, 'a language and a crease were read as another printing');
});

test('and a foil is not the ordinary copy', () => {
  assert.match(drawnFor(timsSolRings({ ...SR.c21, qty: 1 }), SR.foil), /db-print-mark-other/,
    'a deck running the foil was told the ordinary copy would do');
  assert.match(drawnFor(timsSolRings({ ...SR.foil, qty: 1 })), /db-print-mark-other/,
    'a deck running the ordinary copy was answered with the foil');
});

test('the readout says how many the deck runs in a printing you have not got', () => {
  const tab = loadTab({ collections: timsSolRings({ ...SR.ltc, qty: 1 }), deck: ringDeck(SR.c21) });
  assert.match(tab.readout(), /1<\/strong> of 1 you own/, 'the name-level count moved');
  assert.match(tab.readout(), /1 card in another printing/,
    'the line counts copies beside it, so this one has to say what it counts');

  const ok = loadTab({ collections: timsSolRings({ ...SR.c21, qty: 1 }), deck: ringDeck(SR.c21) });
  assert.doesNotMatch(ok.readout(), /another printing/,
    'a deck you can sleeve as it stands is carrying a warning');
  assert.doesNotMatch(loadTab().readout(), /another printing/,
    'a shelf that knows nothing about its printings is reported as a mismatch');
});

test('the missing list has a third section for them, and names both printings', () => {
  const tab = loadTab({ collections: timsSolRings({ ...SR.ltc, qty: 1 }), deck: ringDeck(SR.c21) });
  const html = tab.panel();
  assert.match(html, /You have these in another printing/);
  assert.match(html, /C21/, 'the printing the deck runs is not named');
  assert.match(html, /LTC/, 'the printing you actually have is not named');
});

test('a deck you own every copy of in the right printing says only that', () => {
  const tab = loadTab({ collections: timsSolRings({ ...SR.c21, qty: 1 }), deck: ringDeck(SR.c21) });
  assert.match(tab.panel(), /Every one of the 1 is on the shelf/);
  assert.doesNotMatch(tab.panel(), /another printing/);
});
