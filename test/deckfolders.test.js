/* Folders — the shelves your decks sit on.
 *
 * The Mine grid arrived as one flat run of built decks (#36). This ticket gives
 * a player flat, per-player folders: made, renamed and removed from the grid,
 * with a deck moved between them from its ⋯ menu. Loose decks — the ones in no
 * folder — sit above the folder sections, and a `folderId` naming a folder that
 * no longer exists reads as loose, which is what makes removing a folder need
 * no migration.
 *
 * What is asserted, against the shipped js/players.js in a vm sandbox:
 *
 *   the store    addFolder / renameFolder / removeFolder mutate
 *                state.players[].folders and fire the whole-state save.
 *   the layout   the Mine grid draws the loose zone, then a section per folder
 *                in `position` order; the Everyone view folders each player's
 *                section the same way.
 *   the move     moveDeckToFolder sets folderId and saves that player's decks;
 *                the tile's ⋯ offers every folder and "Remove from folder".
 *   the gate     folder controls appear only where you may edit the player.
 *
 * Not here: drag and drop (#39), the private toggle and lock badge (#38), and
 * the server's rules for who may edit whose folders — POST /api/state already
 * compares `folders` as part of a player (routes/state.js normalizePlayer), and
 * deckfields.test.js proves both halves of that: renaming another player's
 * folder is a 403, editing your own deck's folderId round-trips.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* Tim has three built decks and two folders; one deck is loose, one is filed,
 * and one names a folder that is not there — the no-migration case. Anna is
 * somebody else, whose decks and folders belong to the Everyone view. */
const PLAYERS = [
  { id: 'p-tim', name: 'Tim', colorIdx: 0, wantList: [],
    folders: [
      { id: 'f-cmd',     name: 'Commander', position: 0 },
      { id: 'f-retired', name: 'Retired',   position: 1 },
    ],
    decks: [
      { id: 'd-loose',  source: 'manual', name: 'Loose',   folderId: null },
      { id: 'd-filed',  source: 'manual', name: 'Filed',   folderId: 'f-cmd' },
      { id: 'd-orphan', source: 'manual', name: 'Orphan',  folderId: 'f-gone' },
    ] },
  { id: 'p-anna', name: 'Anna', colorIdx: 1, wantList: [],
    folders: [{ id: 'f-anna', name: 'Hers', position: 0 }],
    decks: [{ id: 'd-anna', source: 'manual', name: 'Atraxa', folderId: 'f-anna' }] },
];

const COUNTS = { 'd-loose': 60, 'd-filed': 99, 'd-orphan': 100, 'd-anna': 60 };

const AS_TIM   = { username: 'tim',   role: 'player', playerId: 'p-tim' };
const AS_ANNA  = { username: 'anna',  role: 'player', playerId: 'p-anna' };
const AS_ADMIN = { username: 'admin', role: 'admin',  playerId: null };

function loadTab({ players = PLAYERS, deckCardCounts = COUNTS, user = AS_TIM,
                   answers = [], agrees = true } = {}) {
  const store  = new Map();
  const asked  = [];      // what prompt() was asked, in order
  const saved  = [];      // { url, body } per fetch
  const alerts = [];

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
    alert: msg => alerts.push(String(msg)),
    confirm: msg => { asked.push(String(msg)); return agrees; },
    prompt: msg => { asked.push(String(msg)); return answers.length ? answers.shift() : null; },
    clearTimeout() {}, setTimeout: fn => 1,
    fetch: async (url, opts = {}) => {
      saved.push({ url, body: JSON.parse(opts.body || '{}') });
      return { ok: true, status: 200, json: async () => ({ ok: true, version: 7 }) };
    },
    // Outside this ticket: the kebab menu's markup, the bracket badge, the
    // sibling tabs. The kebab is echoed as JSON so a test can read the rows it
    // was handed without parsing the shipped markup.
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
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`currentUser = ${JSON.stringify(user)}`);
  run(`hydrateState(${JSON.stringify({ players, deckCardCounts })})`);

  return {
    run, answer, el, store, asked, saved, alerts,
    folders: (playerId = 'p-tim') =>
      answer(`state.players.find(p => p.id === '${playerId}').folders`),
    html() { run('renderPlayers()'); return el('playersList').innerHTML; },
    /** The zones the tab drew, in order — { folder, decks }, '' being loose.
     *  Scoped to one player where the view draws more than one. */
    layout(playerId) {
      const zones = zonesOf(this.html());
      return playerId ? zones.filter(z => z.player === playerId).map(({ player, ...z }) => z) : zones;
    },
    /** The rows one deck tile's ⋯ menu was built from. */
    menuFor(deckId) { return menuIn(this.html(), `data-deck-id="${deckId}"`); },
    /** What each folder header says, in order. */
    headers() {
      return [...this.html().matchAll(/folder-name">([^<]*)<[\s\S]*?folder-count">([^<]*)</g)]
        .map(m => ({ name: m[1], count: m[2] }));
    },
    /** The rows one folder header's ⋯ menu was built from. */
    folderMenuFor(folderId) { return menuIn(this.html(), `data-folder-id="${folderId}"`); },
  };
}

/* Read the rendered tab back as zones. Each zone announces the folder it is
 * (`data-folder-id`, empty for loose) and holds the tiles up to the next one. */
function zonesOf(html) {
  const marks = [...html.matchAll(/data-player-id="([^"]*)" data-folder-id="([^"]*)"/g)];
  return marks.map((m, i) => {
    const slice = html.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : html.length);
    return {
      player: m[1],
      folder: m[2],
      decks: [...slice.matchAll(/data-deck-id="([^"]+)"/g)].map(d => d[1]),
    };
  });
}

/* The rows behind one thing's ⋯ — the stub kebab echoes what it was handed, so
 * a test reads the menu rather than the markup around it. Bounded to the thing
 * itself: a deck or folder offered no menu must not answer with its
 * neighbour's, which is how a missing menu would read as present. */
function menuIn(html, marker) {
  const from = html.indexOf(marker);
  if (from < 0) return null;
  const rest = html.slice(from + marker.length);
  const next = rest.search(/data-deck-id="|data-player-id="/);
  const mine = next < 0 ? rest : rest.slice(0, next);
  const match = mine.match(/<span class="kebab">(\[.*?\])<\/span>/s);
  return match ? JSON.parse(match[1]) : null;
}

// ── The store ───────────────────────────────────────────────────────────────

test('+ New folder adds a folder named what you typed', () => {
  const tab = loadTab({ answers: ['Brews'] });
  tab.run(`addFolder('p-tim')`);

  assert.deepStrictEqual(tab.folders().map(f => f.name), ['Commander', 'Retired', 'Brews'],
    'the folder you asked for is not on the end of the list');
});

test('a folder you cancel out of is never made', () => {
  const tab = loadTab({ answers: [null] });
  tab.run(`addFolder('p-tim')`);
  assert.strictEqual(tab.folders().length, 2, 'saying nothing made a folder anyway');
  assert.deepStrictEqual(tab.saved, [], 'nothing changed, so nothing should have been sent');
});

test('renaming a folder keeps its id, and its decks with it', () => {
  const tab = loadTab({ answers: ['Brews'] });
  tab.run(`renameFolder('p-tim', 'f-cmd')`);

  const [first] = tab.folders();
  assert.strictEqual(first.name, 'Brews');
  assert.strictEqual(first.id, 'f-cmd', 'a rename that changes the id orphans every deck in it');
  assert.strictEqual(tab.answer(`state.players[0].decks.find(d => d.id === 'd-filed').folderId`),
    'f-cmd', 'the deck lost the folder it was in');
});

test('removing a folder leaves the decks that were in it alone', () => {
  const tab = loadTab();
  tab.run(`removeFolder('p-tim', 'f-cmd')`);

  assert.deepStrictEqual(tab.folders().map(f => f.id), ['f-retired']);
  assert.strictEqual(tab.answer(`state.players[0].decks.find(d => d.id === 'd-filed').folderId`),
    'f-cmd', 'the removal rewrote the decks — a folderId with no folder is meant to read as loose');
});

test('removing a folder asks first, and takes no for an answer', () => {
  const tab = loadTab({ agrees: false });
  tab.run(`removeFolder('p-tim', 'f-cmd')`);

  assert.match(tab.asked.join(' '), /Commander/, 'the question does not say which folder it means');
  assert.deepStrictEqual(tab.folders().map(f => f.id), ['f-cmd', 'f-retired'],
    'the folder went anyway');
});

test('a folder change is on the screen before the server has answered', () => {
  const tab = loadTab({ answers: ['Brews'] });
  tab.run(`addFolder('p-tim')`);

  assert.match(tab.el('playersList').innerHTML, /Brews/,
    'the grid waited for the save before drawing the folder');
  assert.deepStrictEqual(tab.saved.map(s => s.url), ['/api/state'],
    'a folder belongs to the player, so it rides the whole-state save');
  assert.deepStrictEqual(
    tab.saved[0].body.players.find(p => p.id === 'p-tim').folders.map(f => f.name),
    ['Commander', 'Retired', 'Brews']);
});

// ── The layout ──────────────────────────────────────────────────────────────

test('the grid is the loose zone, then a folder section each', () => {
  const tab = loadTab();
  assert.deepStrictEqual(tab.layout('p-tim'), [
    { folder: '',          decks: ['d-loose', 'd-orphan'] },
    { folder: 'f-cmd',     decks: ['d-filed'] },
    { folder: 'f-retired', decks: [] },
  ]);
});

test('a deck in a folder that was removed is loose again, unrewritten', () => {
  const tab = loadTab();
  tab.run(`removeFolder('p-tim', 'f-cmd')`);
  assert.deepStrictEqual(tab.layout('p-tim'), [
    { folder: '',          decks: ['d-loose', 'd-filed', 'd-orphan'] },
    { folder: 'f-retired', decks: [] },
  ], 'a deck whose folder went is meant to fall back to loose');
});

test('folders are drawn in position order, not the order they were stored in', () => {
  const tab = loadTab({ players: [{ ...PLAYERS[0], folders: [
    { id: 'f-retired', name: 'Retired',   position: 1 },
    { id: 'f-cmd',     name: 'Commander', position: 0 },
  ] }] });
  assert.deepStrictEqual(tab.layout('p-tim').map(z => z.folder), ['', 'f-cmd', 'f-retired']);
});

test('a folder header says its name and how many decks are in it', () => {
  const tab = loadTab();
  assert.deepStrictEqual(tab.headers(), [
    { name: 'Commander', count: '1 deck' },
    { name: 'Retired',   count: '0 decks' },
  ]);
});

// ── The move ────────────────────────────────────────────────────────────────

test('moving a deck into a folder files it, and saves that player’s decks', () => {
  const tab = loadTab();
  tab.run(`moveDeckToFolder('p-tim', 'd-loose', 'f-cmd')`);

  assert.deepStrictEqual(tab.layout('p-tim'), [
    { folder: '',          decks: ['d-orphan'] },
    { folder: 'f-cmd',     decks: ['d-loose', 'd-filed'] },
    { folder: 'f-retired', decks: [] },
  ]);
  assert.deepStrictEqual(tab.saved.map(s => s.url), ['/api/players/p-tim/decks'],
    'which folder a deck is in is a change to the deck, not to the player');
  assert.strictEqual(tab.saved[0].body.decks.find(d => d.id === 'd-loose').folderId, 'f-cmd');
});

test('moving a deck out of a folder makes it loose', () => {
  const tab = loadTab();
  tab.run(`moveDeckToFolder('p-tim', 'd-filed', null)`);
  assert.deepStrictEqual(tab.layout('p-tim')[0], { folder: '', decks: ['d-loose', 'd-filed', 'd-orphan'] });
});

test('the ⋯ menu offers every folder, ticking the one the deck is in', () => {
  const tab = loadTab();
  const labels = tab.menuFor('d-filed').map(i => i.label || i.section || '—');

  // 'Make private' is the privacy toggle (#38), which sits with Edit above the
  // folder rows. Asserted whole so a row appearing between them is caught here.
  assert.deepStrictEqual(labels, [
    'Edit', 'Make private', '—', 'Move to folder', '✓ Commander', 'Retired', 'Remove from folder', '—', 'Remove',
  ]);
  const commander = tab.menuFor('d-loose').find(i => i.label === 'Commander');
  assert.strictEqual(commander.onclick, `moveDeckToFolder('p-tim','d-loose','f-cmd')`);
});

test('a loose deck is not offered a folder to be removed from', () => {
  const tab = loadTab();
  const labels = tab.menuFor('d-loose').map(i => i.label || i.section || '—');
  assert.strictEqual(labels.includes('Remove from folder'), false,
    'a deck in no folder was offered a way out of one');
});

// ── Everyone's sections, foldered the same way ──────────────────────────────

test('the Everyone view folders each player’s section', () => {
  const tab = loadTab();
  tab.run(`setDeckScope('all')`);

  assert.deepStrictEqual(tab.layout('p-tim'), [
    { folder: '',          decks: ['d-loose', 'd-orphan'] },
    { folder: 'f-cmd',     decks: ['d-filed'] },
    { folder: 'f-retired', decks: [] },
  ]);
  assert.deepStrictEqual(tab.layout('p-anna'), [
    { folder: '',       decks: [] },
    { folder: 'f-anna', decks: ['d-anna'] },
  ], 'somebody else’s folders are theirs to see, in their own section');
});

// ── The gate ────────────────────────────────────────────────────────────────

test('you are not offered folders on a player you cannot edit', () => {
  const tab = loadTab({ user: AS_ANNA });
  tab.run(`setDeckScope('all')`);
  const html = tab.html();
  const tim  = html.slice(html.indexOf('data-player-id="p-tim"'), html.indexOf('data-player-id="p-anna"'));

  assert.strictEqual(/folder-add/.test(tim), false, 'Anna was offered a new folder on Tim’s decks');
  assert.strictEqual(tab.folderMenuFor('f-cmd'), null, 'Tim’s folder took rename/remove from Anna');
  assert.strictEqual(tab.menuFor('d-filed'), null, 'Tim’s deck offered Anna its ⋯ menu');
});

test('you are offered them on your own', () => {
  const tab = loadTab({ user: AS_ANNA });
  tab.run(`setDeckScope('all')`);

  assert.match(tab.html(), /addFolder\('p-anna'\)/);
  assert.deepStrictEqual(tab.folderMenuFor('f-anna').map(i => i.label || '—'),
    ['Rename', '—', 'Remove folder']);
  assert.ok(tab.menuFor('d-anna').some(i => i.label === 'Remove from folder'));
});

test('an admin may fold anybody’s decks', () => {
  const tab = loadTab({ user: AS_ADMIN });
  tab.run(`setDeckScope('all')`);

  assert.match(tab.html(), /addFolder\('p-tim'\)/);
  assert.ok(tab.folderMenuFor('f-cmd'), 'an admin was refused a folder they may edit');
});

test('a grid with folders but nothing built says so, rather than blaming the folders', () => {
  const tab = loadTab({ deckCardCounts: {} });
  const html = tab.html();
  assert.match(html, /No decks yet/,
    'a person with no built decks was told every deck is in a folder');
  assert.match(html, /addFolder\('p-tim'\)/, 'the folders they already have became unmanageable');
});

// ── What the review caught ──────────────────────────────────────────────────

test('a folder section is never itself a tile in a grid of tiles', () => {
  const tab = loadTab();
  tab.run(`setDeckScope('all')`);
  const html = tab.html();

  // Each zone opens a grid of its own. The box a player's zones sit in must
  // not be one too, or every zone — and the + New folder button — is laid out
  // as a 260px column beside the tiles instead of a heading over them.
  const box = html.match(/<div class="([^"]*)"[^>]*id="pb-player-p-tim"/);
  assert.ok(box, 'the Everyone view stopped drawing a box per player');
  assert.strictEqual(box[1].includes('deck-tiles-grid'), false,
    `folder zones are nested in a grid of tiles (class="${box[1]}")`);
});

test('somebody with folders and no decks still has them in the Everyone view', () => {
  const tab = loadTab({ players: [{ ...PLAYERS[0], decks: [] }] });
  tab.run(`setDeckScope('all')`);
  assert.deepStrictEqual(tab.layout('p-tim').map(z => z.folder), ['', 'f-cmd', 'f-retired'],
    'their folders became unreachable in the view that is meant to show them');
  assert.match(tab.html(), /addFolder\('p-tim'\)/);
});

test('a player added in this session can be given a folder straight away', () => {
  const tab = loadTab({ answers: ['Brews'] });
  tab.run(`addPlayerByName('Newcomer')`);
  const id = tab.answer(`state.players.find(p => p.name === 'Newcomer').id`);
  tab.run(`addFolder('${id}')`);

  assert.deepStrictEqual(tab.folders(id).map(f => f.name), ['Brews'],
    'a player who arrived after the last load had nowhere to put a folder');
});

test('positions stay distinct once a folder in the middle has gone', () => {
  const tab = loadTab({ answers: ['Brews'] });
  tab.run(`removeFolder('p-tim', 'f-cmd')`);
  tab.run(`addFolder('p-tim')`);

  const positions = tab.folders().map(f => f.position);
  assert.strictEqual(new Set(positions).size, positions.length,
    `two folders claim the same place in the order: ${JSON.stringify(tab.folders())}`);
});
