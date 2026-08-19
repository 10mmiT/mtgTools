/* Dragging a deck onto a folder.
 *
 * The ⋯ menu (#37) is the way to file a deck that works everywhere — on a
 * phone, and without knowing the tiles move at all. This ticket adds the mouse
 * accelerator over it: pick a tile up, drop it on a folder or on the loose
 * zone above them, and that is where it lives. The menu is untouched.
 *
 * What is asserted, against the shipped js/players.js + js/deckdrag.js in a vm
 * sandbox — the same harness deckfolders.test.js renders the tab in:
 *
 *   the offer     which tiles are draggable and which zones will take one,
 *                 which is the gate: only where you may edit the player.
 *   the decision  deckDropMove — the pure answer to "would a drop here move
 *                 anything", which is what a dragover has to ask, the browser
 *                 having sealed the payload until the drop.
 *   the move      a drop files the deck and fires that player's deck save.
 *
 * The events are stubs. What a tile looks like mid-drag is the browser's, and
 * the eye's; what is testable is which deck was picked up, which zone would
 * take it, and what happened to the state when it landed.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* Tim has two folders and three decks — one loose, one filed, one naming a
 * folder that is gone (which reads as loose). Anna is somebody else, whose
 * shelves are hers. */
const PLAYERS = [
  { id: 'p-tim', name: 'Tim', colorIdx: 0, wantList: [],
    folders: [
      { id: 'f-cmd',     name: 'Commander', position: 0 },
      { id: 'f-retired', name: 'Retired',   position: 1 },
    ],
    decks: [
      { id: 'd-loose',  source: 'manual', name: 'Loose',  folderId: null },
      { id: 'd-filed',  source: 'manual', name: 'Filed',  folderId: 'f-cmd' },
      { id: 'd-orphan', source: 'manual', name: 'Orphan', folderId: 'f-gone' },
    ] },
  { id: 'p-anna', name: 'Anna', colorIdx: 1, wantList: [],
    folders: [{ id: 'f-anna', name: 'Hers', position: 0 }],
    decks: [{ id: 'd-anna', source: 'manual', name: 'Atraxa', folderId: 'f-anna' }] },
];

const COUNTS = { 'd-loose': 60, 'd-filed': 99, 'd-orphan': 100, 'd-anna': 60 };

const AS_TIM   = { username: 'tim',   role: 'player', playerId: 'p-tim' };
const AS_ANNA  = { username: 'anna',  role: 'player', playerId: 'p-anna' };
const AS_ADMIN = { username: 'admin', role: 'admin',  playerId: null };

function loadTab({ players = PLAYERS, deckCardCounts = COUNTS, user = AS_TIM } = {}) {
  const store = new Map();
  const saved = [];      // { url, body } per fetch

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
    fetch: async (url, opts = {}) => {
      saved.push({ url, body: JSON.parse(opts.body || '{}') });
      return { ok: true, status: 200, json: async () => ({ ok: true, version: 7 }) };
    },
    kebabMenuHtml: items => `<span class="kebab">${JSON.stringify(items)}</span>`,
    dbBracketBadgeHtml: () => '',
    collapseState: {},
    togglePlayerSection() {}, renderWantList() {}, renderCollections() {},
    renderResults() {}, setTab() {}, ensureScryfallImages: async () => {},
    scryfallArtCache: new Map(),
    reconcileColSorts() {},
  };
  vm.createContext(sandbox);
  for (const file of ['state.js', 'auth.js', 'players.js', 'deckdrag.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`currentUser = ${JSON.stringify(user)}`);
  run(`hydrateState(${JSON.stringify({ players, deckCardCounts })})`);

  return {
    run, answer, el, saved, sandbox,
    html() { run('renderPlayers()'); return el('playersList').innerHTML; },
    /** The opening tag of one deck's tile, which is where the drag is offered
     *  (or not). */
    tile(deckId) {
      const html = this.html();
      const at   = html.indexOf(`data-deck-id="${deckId}"`);
      if (at < 0) return null;
      const from = html.lastIndexOf('<div', at);
      return html.slice(from, html.indexOf('>', at) + 1);
    },
    /** The opening tag of one player's zone — '' being the loose zone. */
    zoneTag(playerId, folderId) {
      const html = this.html();
      const at   = html.indexOf(`data-player-id="${playerId}" data-folder-id="${folderId}"`);
      if (at < 0) return null;
      return html.slice(html.lastIndexOf('<div', at), html.indexOf('>', at) + 1);
    },
    /** One zone as the drop handlers meet it: what the tab drew, read back as
     *  the two data attributes they go by, plus somewhere to record the class
     *  a lit zone wears. */
    zone(playerId, folderId) {
      assert.ok(this.zoneTag(playerId, folderId), `no ${folderId || 'loose'} zone was drawn`);
      const classes = new Set();
      return {
        dataset: { playerId, folderId },
        classList: {
          add: n => classes.add(n), remove: n => classes.delete(n),
          contains: n => classes.has(n),
        },
        contains: () => false,
        lit: () => classes.has('deck-drop-target'),
      };
    },
    /** A stub drag event on that zone, remembering whether the handler took it
     *  — a dragover that does not preventDefault is a zone saying "not here". */
    event(zone) {
      const e = {
        currentTarget: zone, defaultPrevented: false,
        dataTransfer: { data: {}, effectAllowed: '', dropEffect: '',
          setData(type, value) { this.data[type] = value; } },
        preventDefault() { e.defaultPrevented = true; },
      };
      return e;
    },
    /** The gesture, end to end: pick the deck up, hover the zone, let go on
     *  it. Answers what the hover said — a dragover that does not
     *  preventDefault is the zone refusing, which is how the browser draws the
     *  "no" cursor. The handlers are reached as the shipped functions they
     *  are, called with stub events. */
    dragTo(deckId, zone, { fromPlayer = 'p-tim', release = true } = {}) {
      const start = run('deckDragStart'), over = run('deckDragOver'), drop = run('deckDrop');
      start(this.event(null), fromPlayer, deckId);
      const hover = this.event(zone);
      over(hover);
      if (release) drop(this.event(zone));
      return { offered: hover.defaultPrevented, lit: zone.lit() };
    },
    folderOf: (deckId, playerId = 'p-tim') =>
      answer(`state.players.find(p => p.id === '${playerId}')` +
             `.decks.find(d => d.id === '${deckId}').folderId`),
  };
}

// ── The offer ───────────────────────────────────────────────────────────────

test('a deck you may edit is a tile you can pick up', () => {
  const tab  = loadTab();
  const tile = tab.tile('d-loose');

  assert.match(tile, /draggable="true"/, 'the tile cannot be picked up at all');
  assert.match(tile, /ondragstart="deckDragStart\(event,'p-tim','d-loose'\)"/,
    'the tile does not say which deck is in hand');
});

test('a deck you may not edit is not offered the drag', () => {
  const tab  = loadTab({ user: AS_ANNA });
  tab.run(`setDeckScope('all')`);
  const tile = tab.tile('d-filed');

  assert.ok(tile, 'Tim’s deck is not on Anna’s screen at all');
  assert.strictEqual(/draggable/.test(tile), false,
    'Anna can pick up a deck she has no ⋯ menu for');
});

test('a folder, and the loose zone above it, will take one', () => {
  const tab = loadTab();

  for (const folderId of ['', 'f-cmd', 'f-retired']) {
    const zone = tab.zoneTag('p-tim', folderId);
    assert.match(zone, /ondragover="deckDragOver\(event\)"/,  `${folderId || 'loose'} refuses the hover`);
    assert.match(zone, /ondrop="deckDrop\(event\)"/,          `${folderId || 'loose'} refuses the drop`);
    assert.match(zone, /ondragleave="deckDragLeave\(event\)"/, `${folderId || 'loose'} never lets go`);
  }
});

test('somebody else’s zones are not drop targets on your screen', () => {
  const tab = loadTab({ user: AS_ANNA });
  tab.run(`setDeckScope('all')`);

  assert.strictEqual(/ondrop/.test(tab.zoneTag('p-tim', 'f-cmd')), false,
    'Anna is offered a drop on a folder she may not edit');
  assert.match(tab.zoneTag('p-anna', 'f-anna'), /ondrop/, 'Anna’s own folder refuses her');
});

// ── The move ────────────────────────────────────────────────────────────────

test('dropping a loose deck on a folder files it there', () => {
  const tab  = loadTab();
  const zone = tab.zone('p-tim', 'f-cmd');
  const { offered } = tab.dragTo('d-loose', zone);

  assert.strictEqual(offered, true, 'the folder would not take the deck');
  assert.strictEqual(tab.folderOf('d-loose'), 'f-cmd', 'the deck is not in the folder');
  assert.deepStrictEqual(tab.saved.map(s => s.url), ['/api/players/p-tim/decks'],
    'which folder a deck is in is a fact about the deck, so it rides the deck save');
  assert.strictEqual(
    tab.saved[0].body.decks.find(d => d.id === 'd-loose').folderId, 'f-cmd',
    'the save did not carry the folder');
});

test('dropping a filed deck on the loose zone takes it out of the folder', () => {
  const tab = loadTab();
  tab.dragTo('d-filed', tab.zone('p-tim', ''));

  assert.strictEqual(tab.folderOf('d-filed'), null, 'the deck is still filed');
});

test('the tile is in its new folder before the server has answered', () => {
  const tab = loadTab();
  tab.dragTo('d-loose', tab.zone('p-tim', 'f-retired'));

  const zones = [...tab.html().matchAll(/data-folder-id="([^"]*)"([\s\S]*?)(?=<div class="folder-zone|$)/g)]
    .map(m => ({ folder: m[1], decks: [...m[2].matchAll(/data-deck-id="([^"]+)"/g)].map(d => d[1]) }));
  const retired = zones.find(z => z.folder === 'f-retired');
  assert.deepStrictEqual(retired.decks, ['d-loose'],
    'the grid waited for the save before drawing the move');
});

// ── The refusals ────────────────────────────────────────────────────────────

test('the folder a deck is already in is not somewhere to put it', () => {
  const tab  = loadTab();
  const home = tab.zone('p-tim', 'f-cmd');
  const { offered, lit } = tab.dragTo('d-filed', home);

  assert.strictEqual(offered, false, 'the deck was offered a move it is not a move');
  assert.strictEqual(lit, false, 'the folder it came from lit up as somewhere to go');
  assert.deepStrictEqual(tab.saved, [], 'a deck was saved without having moved');
});

test('a deck whose folder is gone can still be dropped on the loose zone… or rather, is already there', () => {
  const tab = loadTab();
  // d-orphan names a folder that no longer exists, which the grid reads as
  // loose. The loose zone is therefore where it already is.
  const { offered } = tab.dragTo('d-orphan', tab.zone('p-tim', ''));
  assert.strictEqual(offered, true,
    'a deck drawn loose could not be dropped loose, so its stale folderId is stuck');
  assert.strictEqual(tab.folderOf('d-orphan'), null,
    'the drop did not clear the folder that is not there');
});

test('a deck cannot be dropped on another player’s shelf', () => {
  const tab = loadTab({ user: AS_ADMIN });
  tab.run(`setDeckScope('all')`);
  const hers = tab.zone('p-anna', 'f-anna');
  const { offered } = tab.dragTo('d-loose', hers);

  assert.strictEqual(offered, false, 'an admin was offered a move between players');
  assert.strictEqual(tab.folderOf('d-loose'), null, 'the deck left its owner');
  assert.deepStrictEqual(tab.saved, [], 'a move that cannot happen was saved anyway');
});

test('a drop with nothing in hand does nothing', () => {
  const tab  = loadTab();
  const drop = tab.run('deckDrop');
  drop(tab.event(tab.zone('p-tim', 'f-cmd')));
  assert.deepStrictEqual(tab.saved, [], 'a stray drop saved something');
});

// ── The light ───────────────────────────────────────────────────────────────

test('the zone under the deck lights up, and only that one', () => {
  const tab   = loadTab();
  const cmd   = tab.zone('p-tim', 'f-cmd');
  const rtd   = tab.zone('p-tim', 'f-retired');
  const start = tab.run('deckDragStart'), over = tab.run('deckDragOver');

  start(tab.event(null), 'p-tim', 'd-loose');
  over(tab.event(cmd));
  assert.strictEqual(cmd.lit(), true, 'the zone under the deck is not lit');

  over(tab.event(rtd));
  assert.strictEqual(rtd.lit(), true, 'the deck moved on and the new zone stayed dark');
  assert.strictEqual(cmd.lit(), false, 'two zones claim the deck at once');
});

test('the light goes out when the deck leaves, and when it lands', () => {
  const tab   = loadTab();
  const cmd   = tab.zone('p-tim', 'f-cmd');
  const start = tab.run('deckDragStart'), over = tab.run('deckDragOver');
  const leave = tab.run('deckDragLeave'), drop = tab.run('deckDrop');

  start(tab.event(null), 'p-tim', 'd-loose');
  over(tab.event(cmd));
  leave(tab.event(cmd));
  assert.strictEqual(cmd.lit(), false, 'a zone the deck left is still lit');

  over(tab.event(cmd));
  drop(tab.event(cmd));
  assert.strictEqual(cmd.lit(), false, 'the zone stayed lit after the deck landed on it');
});

test('crossing a tile inside the zone does not put its light out', () => {
  const tab   = loadTab();
  const cmd   = tab.zone('p-tim', 'f-cmd');
  cmd.contains = () => true;   // the pointer moved onto a tile within it
  const start = tab.run('deckDragStart'), over = tab.run('deckDragOver');
  const leave = tab.run('deckDragLeave');

  start(tab.event(null), 'p-tim', 'd-loose');
  over(tab.event(cmd));
  const inner = tab.event(cmd);
  inner.relatedTarget = { inside: true };
  leave(inner);

  assert.strictEqual(cmd.lit(), true,
    'the zone flickers as the pointer crosses the tiles in it');
});

test('a drag abandoned mid-air leaves nothing lit and nothing in hand', () => {
  const tab   = loadTab();
  const cmd   = tab.zone('p-tim', 'f-cmd');
  const start = tab.run('deckDragStart'), over = tab.run('deckDragOver');
  const end   = tab.run('deckDragEnd'), drop = tab.run('deckDrop');

  start(tab.event(null), 'p-tim', 'd-loose');
  over(tab.event(cmd));
  end();
  assert.strictEqual(cmd.lit(), false, 'the abandoned drag left a zone lit');

  drop(tab.event(cmd));
  assert.deepStrictEqual(tab.saved, [], 'the abandoned deck was still in hand and got filed');
});

// ── Additive ────────────────────────────────────────────────────────────────

test('the ⋯ menu still files a deck, on the very tiles that now drag', () => {
  const tab  = loadTab();
  const html = tab.html();
  const at   = html.indexOf('data-deck-id="d-loose"');
  const tile = html.slice(at, html.indexOf('data-deck-id="d-filed"'));
  const menu = JSON.parse(tile.match(/<span class="kebab">(\[.*?\])<\/span>/s)[1]);

  assert.match(tab.tile('d-loose'), /draggable="true"/);
  assert.ok(menu.some(i => i.onclick === `moveDeckToFolder('p-tim','d-loose','f-cmd')`),
    'the drag replaced the menu row instead of shortcutting it');
});

test('the link on a tile is not a second thing to drag off it', () => {
  const decks = [{ id: 'd-link', source: 'manual', name: 'Linked', folderId: null,
                   deckUrl: 'https://archidekt.com/decks/1' }];
  const tab   = loadTab({
    players: [{ ...PLAYERS[0], decks }],
    deckCardCounts: { 'd-link': 60 },
  });
  const link = tab.html().match(/<a class="deck-tile-link"[^>]*>/)[0];

  assert.match(link, /draggable="false"/,
    'dragging View ↗ starts a drag of the URL over the drag of the deck');
});

test('a pick-up that finds no deck leaves nothing in hand', () => {
  const tab   = loadTab();
  const start = tab.run('deckDragStart'), drop = tab.run('deckDrop');

  start(tab.event(null), 'p-tim', 'd-loose');
  start(tab.event(null), 'p-tim', 'd-gone');     // a tile the state no longer has
  drop(tab.event(tab.zone('p-tim', 'f-cmd')));

  assert.strictEqual(tab.folderOf('d-loose'), null,
    'the deck still in hand from the last drag was filed by this one');
  assert.deepStrictEqual(tab.saved, [], 'a deck nobody dragged was saved');
});
