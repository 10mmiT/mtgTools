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

const CARDS = {
  'Sol Ring': { name: 'Sol Ring', type_line: 'Artifact', cmc: 1, color_identity: [] },
  'Cultivate': { name: 'Cultivate', type_line: 'Sorcery', cmc: 3, color_identity: ['G'] },
  'Krenko, Mob Boss': { name: 'Krenko, Mob Boss', type_line: 'Legendary Creature — Goblin',
                        cmc: 4, color_identity: ['R'] },
  'Forest': { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, color_identity: ['G'] },
  'Mox Diamond': { name: 'Mox Diamond', type_line: 'Artifact', cmc: 0, color_identity: [] },
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
