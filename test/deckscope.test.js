/* The Decks tab lands you on your own built decks.
 *
 * The old Players tab was everybody's sections, other people's decks stacked
 * above your own. This ticket demotes that to an Everyone view behind a scope
 * toggle and makes the default a grid of *your* built decks — where "built"
 * means the server counted `deck_cards` rows for it (state.deckCardCounts).
 *
 * What is asserted, against the shipped js/players.js in a vm sandbox:
 *
 *   the scope   deckScope / setDeckScope / syncDeckScope — mirrors Collections:
 *               default Mine with an identity, forced Everyone without one, and
 *               the control hidden when there is nobody to be.
 *   the grid    the Mine view is your built decks and only those; the Everyone
 *               view is the old per-player sections, unchanged.
 *   the frame   the toolbar has the scope control and the tab is named Decks.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* Tim has two decks — one built, one only a name and a link — and Anna has one
 * built deck. Between them: a deck that must show, a deck that must not, and
 * somebody else whose decks belong to the Everyone view. */
const PLAYERS = [
  { id: 'p-tim',  name: 'Tim',  colorIdx: 0, wantList: [], decks: [
    { id: 'd-built', source: 'archidekt', name: 'Krenko',  deckId: '1', commander: 'Krenko, Mob Boss' },
    { id: 'd-draft', source: 'manual',    name: 'Someday',  commander: '' },
  ] },
  { id: 'p-anna', name: 'Anna', colorIdx: 1, wantList: [], decks: [
    { id: 'd-anna', source: 'archidekt', name: 'Atraxa', deckId: '2', commander: 'Atraxa' },
  ] },
];

const COUNTS = { 'd-built': 60, 'd-anna': 99 };  // d-draft has no deck_cards rows

const AS_TIM   = { username: 'tim',   role: 'player', playerId: 'p-tim' };
const AS_GUEST = { username: 'guest', role: 'admin', playerId: null };

function loadTab({ players = PLAYERS, deckCardCounts = COUNTS,
                   user = AS_TIM, remembered = '' } = {}) {
  const store = new Map();
  if (remembered) store.set('avail_name', remembered);

  const els = {};
  const el = id => (els[id] ||= {
    innerHTML: '', textContent: '', title: '', value: '', disabled: false,
    style: { setProperty() {}, display: '' }, attrs: {}, dataset: {}, classes: new Set(),
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener() {}, focus() {}, appendChild() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
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
      getElementById: el,
      body: { appendChild() {}, style: {} },
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800, location: {} },
    console,
    alert() {}, confirm: () => true, clearTimeout() {}, setTimeout: fn => 1,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, version: 7 }) }),
    // Outside this ticket: the kebab menu, the bracket badge, the sibling tabs.
    kebabMenuHtml: () => '<span class="kebab"></span>',
    dbBracketBadgeHtml: () => '',
    collapseState: {},
    togglePlayerSection() {}, renderWantList() {}, renderCollections() {},
    renderResults() {}, setTab() {}, ensureScryfallImages: async () => {},
    scryfallArtCache: new Map(),
    // Outside this ticket: the Collections sort chain hydrateState reconciles.
    reconcileColSorts() {},
  };
  vm.createContext(sandbox);
  // js/deckdrag.js beside them: the tile's markup asks it for the drag
  // attributes (#39), so a sandbox without it draws a tile the app does not.
  for (const file of ['state.js', 'auth.js', 'players.js', 'deckdrag.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`currentUser = ${JSON.stringify(user)}`);
  run(`hydrateState(${JSON.stringify({ players, deckCardCounts })})`);

  return {
    run, answer, el, store,
    scope: () => run('deckScope()'),
    scopeHidden: () => el('deckScopeMount').classes.has('scope-mount-hidden'),
    /** The decks the tab is drawing, in order, by their data-deck-id. */
    decks() {
      run('renderPlayers()');
      return [...el('playersList').innerHTML.matchAll(/data-deck-id="([^"]+)"/g)].map(m => m[1]);
    },
    /** The player sections the tab is drawing. */
    sections() {
      run('renderPlayers()');
      return [...el('playersList').innerHTML.matchAll(/player-name-lbl">([^<]+)</g)].map(m => m[1]);
    },
  };
}

// ── The scope ───────────────────────────────────────────────────────────────

test('Mine is the default when the app can say who you are', () => {
  const tab = loadTab();
  assert.strictEqual(tab.scope(), 'mine');
});

test('the choice is remembered under mtgtools_deck_scope', () => {
  const tab = loadTab();
  tab.run(`setDeckScope('all')`);
  assert.strictEqual(tab.run(`localStorage.getItem('mtgtools_deck_scope')`), 'all');
  assert.strictEqual(tab.scope(), 'all');
});

test('with nobody to be the scope is forced to Everyone', () => {
  const tab = loadTab({ user: AS_GUEST });
  assert.strictEqual(tab.run('myPlayerId()'), null);
  assert.strictEqual(tab.scope(), 'all');
});

test('a stored Mine from a browser that once knew cannot hide every deck', () => {
  const tab = loadTab({ user: AS_GUEST });
  tab.run(`localStorage.setItem('mtgtools_deck_scope', 'mine')`);
  assert.strictEqual(tab.scope(), 'all', 'a scope with no identity is read as Everyone');
});

test('the control is hidden when there is nobody to be, offered otherwise', () => {
  const guest = loadTab({ user: AS_GUEST });
  guest.run('renderPlayers()');
  assert.ok(guest.scopeHidden(), 'the scope control is offered with nothing to mean');

  const tim = loadTab();
  tim.run('renderPlayers()');
  assert.ok(!tim.scopeHidden(), 'the scope control is hidden from somebody who can switch it');
});

// ── The grid ────────────────────────────────────────────────────────────────

test('the Mine grid is your built decks, and only those', () => {
  const tab = loadTab();
  assert.deepStrictEqual(tab.decks(), ['d-built'],
    'the draft with no deck_cards rows, or somebody else’s deck, is on your grid');
});

test('a deck the server counts nothing for is not on the grid', () => {
  const tab = loadTab({ deckCardCounts: {} });
  assert.deepStrictEqual(tab.decks(), [], 'an unbuilt deck was called built');
});

test('the Mine grid draws no per-player sections', () => {
  const tab = loadTab();
  assert.deepStrictEqual(tab.sections(), [], 'the Mine view is sectioned like Everyone');
});

test('Everyone is the old sectioned layout — every player, every deck', () => {
  const tab = loadTab();
  tab.run(`setDeckScope('all')`);
  assert.deepStrictEqual(tab.sections(), ['Tim', 'Anna']);
  assert.deepStrictEqual(tab.decks().sort(), ['d-anna', 'd-built', 'd-draft'],
    'the Everyone view filters out an unbuilt deck it should still show');
});

// ── Identity changing under the tab ─────────────────────────────────────────

test('typing a name into the “Who are you?” bar switches the grid to theirs', () => {
  const tab = loadTab({ user: AS_GUEST, remembered: 'Tim' });
  assert.strictEqual(tab.run('myPlayerId()'), 'p-tim');
  assert.strictEqual(tab.scope(), 'mine');
  assert.deepStrictEqual(tab.decks(), ['d-built']);

  // Same browser, a different person answers the bar.
  tab.run(`localStorage.setItem('avail_name', 'Anna')`);
  tab.run('deckIdentityChanged()');
  assert.deepStrictEqual(tab.decks(), ['d-anna'], 'the grid still shows the old identity’s decks');
});

// ── The frame ───────────────────────────────────────────────────────────────

test('the tab is named Decks, on the desktop rail and the phone', () => {
  const markup = read('public/index.html');
  const railBtn = markup.match(/id="tab-btn-players"[\s\S]*?<\/button>/)[0];
  assert.match(railBtn, /tab-btn-label">Decks</, 'the desktop tab still says Players');
  assert.match(read('public/js/main.js'), /players:\s*'Decks'/,
    'the phone dropdown label still says Players');
});

test('the scope control is on the toolbar and can be hidden', () => {
  const markup = read('public/index.html');
  const sel = markup.match(/<select id="deckScopeSel"[\s\S]*?<\/select>/)[0];
  assert.match(sel, /onchange="setDeckScope\(this\.value\)"/);
  assert.match(sel, /aria-label=/, 'the control says what it is to a screen reader');
  assert.match(sel, /value="all"/);
  assert.match(sel, /value="mine"/);
  assert.match(markup, /id="deckScopeMount"/);
  assert.match(read('public/css/components.css'), /\.scope-mount-hidden \{ display: none; \}/);
});
