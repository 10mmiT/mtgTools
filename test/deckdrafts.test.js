/* The decks you have not built yet.
 *
 * The Mine grid is your *built* decks — the ones the server counted
 * `deck_cards` rows for (#36). A deck that is only a name and a link, never
 * opened in the Builder, is therefore not on it, and before this ticket that
 * meant it was nowhere: added on the Everyone view and then invisible on the
 * one you land on. This ticket gives those decks the one thing they are for —
 * a muted strip under the grid, a row each, and a Build that opens the deck on
 * the mat, where an Archidekt deck imports its cards on first open and stops
 * being a draft.
 *
 * What is asserted, against the shipped js/players.js in a vm sandbox — the
 * same harness deckscope.test.js renders the tab in:
 *
 *   the strip   which decks are on it, in which view, and where it sits.
 *   the row     what a row says (name, where it came from) and the one thing
 *               it does.
 *   the grid    a draft is not a tile: not filed, not filable, not dragged.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* Tim has a folder and four decks: one built and loose, one built and filed,
 * and two never opened — one from Archidekt, one typed in by hand. Anna is
 * somebody else with a draft of her own, which is hers. */
const PLAYERS = [
  { id: 'p-tim', name: 'Tim', colorIdx: 0, wantList: [],
    folders: [{ id: 'f-cmd', name: 'Commander', position: 0 }],
    decks: [
      { id: 'd-built',   source: 'archidekt', name: 'Krenko',  deckId: '1', folderId: null },
      { id: 'd-filed',   source: 'manual',    name: 'Filed',   folderId: 'f-cmd' },
      { id: 'd-draft-a', source: 'archidekt', name: 'Someday', deckId: '2',
        deckUrl: 'https://archidekt.com/decks/2' },
      { id: 'd-draft-b', source: 'manual',    name: 'Napkin' },
    ] },
  { id: 'p-anna', name: 'Anna', colorIdx: 1, wantList: [],
    decks: [
      { id: 'd-anna',       source: 'archidekt', name: 'Atraxa', deckId: '3' },
      { id: 'd-anna-draft', source: 'manual',    name: 'Hers' },
    ] },
];

const COUNTS = { 'd-built': 60, 'd-filed': 99, 'd-anna': 99 };  // the drafts have no rows

const AS_TIM   = { username: 'tim',   role: 'player', playerId: 'p-tim' };
// Open mode: an admin session with no linked player, whose identity is the
// name behind Available@'s “Who are you?” bar.
const AS_GUEST = { username: 'guest', role: 'admin',  playerId: null };

function loadTab({ players = PLAYERS, deckCardCounts = COUNTS, user = AS_TIM } = {}) {
  const store = new Map();

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
    alert() {}, confirm: () => true, prompt: () => null,
    clearTimeout() {}, setTimeout: fn => 1,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, version: 7 }) }),
    // The ⋯ menu is written out in full here: what a draft row must *not*
    // carry is half of what this file asserts.
    kebabMenuHtml: items => `<span class="kebab">${JSON.stringify(items)}</span>`,
    dbBracketBadgeHtml: () => '',
    collapseState: {},
    togglePlayerSection() {}, renderWantList() {}, renderCollections() {},
    renderResults() {}, setTab() {}, ensureScryfallImages: async () => {},
    scryfallArtCache: new Map(),
    reconcileColSorts() {},
  };
  vm.createContext(sandbox);
  // js/deckdrag.js beside them: the tile's markup asks it for the drag
  // attributes (#39), so a sandbox without it draws a tile the app does not.
  for (const file of ['state.js', 'auth.js', 'players.js', 'deckdrag.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run = expr => vm.runInContext(expr, sandbox);

  run(`currentUser = ${JSON.stringify(user)}`);
  run(`hydrateState(${JSON.stringify({ players, deckCardCounts })})`);

  return {
    run, el,
    html() { run('renderPlayers()'); return el('playersList').innerHTML; },
    /** The strip's own markup, or null where the tab drew none. */
    strip() {
      const html = this.html();
      const at   = html.indexOf('class="deck-drafts"');
      if (at < 0) return null;
      return html.slice(html.lastIndexOf('<div', at));
    },
    /** The decks on the strip, in the order it lists them. */
    drafts() {
      const strip = this.strip();
      return strip ? [...strip.matchAll(/data-draft-id="([^"]+)"/g)].map(m => m[1]) : [];
    },
    /** One draft's row, from its opening tag to the end of the row. */
    row(deckId) {
      const strip = this.strip();
      const at    = strip?.indexOf(`data-draft-id="${deckId}"`) ?? -1;
      if (at < 0) return null;
      const from = strip.lastIndexOf('<div', at);
      const next = strip.indexOf('data-draft-id="', at + 1);
      return strip.slice(from, next < 0 ? strip.length : strip.lastIndexOf('<div', next));
    },
    /** The tiles the grid drew, which is the other half of the question. */
    tiles() {
      return [...this.html().matchAll(/data-deck-id="([^"]+)"/g)].map(m => m[1]);
    },
  };
}

// ── The strip ───────────────────────────────────────────────────────────────

test('the Mine view lists the decks you have never opened', () => {
  const tab = loadTab();
  assert.deepStrictEqual(tab.drafts(), ['d-draft-a', 'd-draft-b'],
    'the strip is not your unbuilt decks, in the order you added them');
});

test('the strip says what it is', () => {
  const tab = loadTab();
  assert.match(tab.strip(), /Not built yet/,
    'the strip is unlabelled, so a row on it reads as a deck that went missing');
});

test('a built deck is on the grid and not on the strip', () => {
  const tab = loadTab();
  assert.ok(!tab.drafts().includes('d-built'), 'a deck with cards was called a draft');
  assert.ok(tab.tiles().includes('d-built'), 'a built deck fell off the grid');
});

test('the strip ends the view — it comes after every tile', () => {
  const tab   = loadTab();
  const html  = tab.html();
  const first = html.indexOf('class="deck-drafts"');
  assert.ok(first > html.lastIndexOf('class="deck-tile"'),
    'the strip is drawn above decks that are built, which is the wrong way round');
});

test('somebody else’s unbuilt deck is not on your strip', () => {
  const tab = loadTab();
  assert.ok(!tab.drafts().includes('d-anna-draft'), 'the strip is everybody’s drafts');
});

test('build them all and the strip goes away', () => {
  const tab = loadTab({ deckCardCounts: { ...COUNTS, 'd-draft-a': 1, 'd-draft-b': 100 } });
  assert.strictEqual(tab.strip(), null, 'an empty strip was drawn with nothing to say');
  assert.deepStrictEqual(tab.tiles().sort(), ['d-built', 'd-draft-a', 'd-draft-b', 'd-filed'],
    'a deck that has just been built did not arrive on the grid');
});

test('the strip is the Mine view’s — Everyone is the old sections, unchanged', () => {
  const tab = loadTab();
  tab.run(`setDeckScope('all')`);
  assert.strictEqual(tab.strip(), null, 'the strip followed the scope into Everyone');
  assert.deepStrictEqual(tab.tiles().sort(),
    ['d-anna', 'd-anna-draft', 'd-built', 'd-draft-a', 'd-draft-b', 'd-filed'],
    'the Everyone view stopped showing a deck that has no cards yet');
});

/* Somebody who has added decks and opened none of them: an empty grid, saying
 * so, over every deck they own. The strip is what stops that being a tab that
 * has lost their decks. */
test('with nothing built yet the strip is still there, under the empty grid', () => {
  const noFolders = [{ ...PLAYERS[0], folders: [] }, PLAYERS[1]];
  const tab  = loadTab({ players: noFolders, deckCardCounts: {} });
  const html = tab.html();
  assert.match(html, /class="empty-state"/, 'a grid with nothing on it says nothing');
  assert.deepStrictEqual(tab.drafts(), ['d-built', 'd-filed', 'd-draft-a', 'd-draft-b'],
    'the only decks you have were dropped for having no cards');
});

test('the strip is drawn for whoever the app currently thinks you are', () => {
  const tab = loadTab({ user: AS_GUEST });
  assert.strictEqual(tab.run('myPlayerId()'), null, 'a nameless browser is somebody');
  tab.run(`localStorage.setItem('avail_name', 'Anna')`);
  tab.run(`setDeckScope('mine')`);
  assert.deepStrictEqual(tab.drafts(), ['d-anna-draft'],
    'the strip is somebody else\u2019s drafts');
});

// ── The row ─────────────────────────────────────────────────────────────────

test('a row names the deck and where it came from', () => {
  const tab = loadTab();
  assert.match(tab.row('d-draft-a'), /Someday/);
  assert.match(tab.row('d-draft-a'), /Archidekt/, 'an Archidekt draft does not say so');
  assert.match(tab.row('d-draft-b'), /Napkin/);
  assert.match(tab.row('d-draft-b'), /Manual/, 'a hand-typed draft does not say so');
});

test('Build opens that deck on the mat', () => {
  const tab = loadTab();
  assert.match(tab.row('d-draft-a'), /openInDeckView\('p-tim','d-draft-a'\)/,
    'the row’s one action does not open the deck in the Builder');
  assert.match(tab.row('d-draft-a'), />Build</);
});

test('a deck named in markup is written out as text', () => {
  const tab = loadTab({ players: [{ ...PLAYERS[0], decks: [
    { id: 'd-mischief', source: 'manual', name: '<img src=x onerror=alert(1)>' },
  ] }] });
  const row = tab.row('d-mischief');
  assert.ok(!row.includes('<img'), 'a deck name reached the page as markup');
  assert.match(row, /&lt;img/);
});

// ── Not a tile ──────────────────────────────────────────────────────────────

test('a draft is not on the grid at all', () => {
  const tab = loadTab();
  assert.deepStrictEqual(tab.tiles().sort(), ['d-built', 'd-filed'],
    'an unbuilt deck was drawn as a tile in the folder grid');
});

test('a draft cannot be filed until it is built', () => {
  const tab = loadTab();
  const row = tab.row('d-draft-a');
  assert.ok(!/draggable="true"/.test(row), 'an unbuilt deck can be dragged onto a folder');
  assert.ok(!/Move to folder/.test(row), 'an unbuilt deck is offered a folder to go in');
  assert.ok(!/folder-zone/.test(row), 'the strip is a drop target');
});

test('a folder counts only the decks it can hold', () => {
  const tab = loadTab();
  assert.match(tab.html(), /folder-count">1 deck</,
    'the folder counted a deck that is not built');
});

// ── The look ────────────────────────────────────────────────────────────────

test('the strip is muted, and its rows are rows', () => {
  const css = read('public/css/tabs.css');
  const at  = css.indexOf('.deck-drafts');
  assert.ok(at > 0, 'the strip has no styling of its own');
  const block = css.slice(at, at + 1200);
  assert.match(block, /--text-muted/, 'the strip is as loud as the grid above it');
});
