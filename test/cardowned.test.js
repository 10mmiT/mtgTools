/* Whether we own this, said on the card itself.
 *
 * Every grid in the app draws a card, and until now only some of them said
 * anything about whose shelf it is on — the Search / EDHREC drawer, the one
 * place you are actually *choosing* what to add, said nothing at all. This is
 * the mark that fixes that, and what is asserted here is the three ways it can
 * quietly become a lie:
 *
 * It must be *scoped*, and to the same shelf the deck builder's readout counts
 * — a bar meaning "somebody owns this" beside a readout meaning "you own this"
 * is two answers to one question, and that split is the reason the ladder was
 * lifted out of the deck tab in the first place.
 *
 * It must say nothing when nobody has the card. The third state is *absence*,
 * because a page of Scryfall results is mostly cards nobody owns and a marker
 * on every one of them is a page of markers rather than a signal.
 *
 * And it must find the card on the shelf under the name the shelf filed it
 * under, which is not always the name it is asked about: an importer writes
 * "Delver of Secrets // Insectile Aberration" where EDHREC says "Delver of
 * Secrets", and a shelf holding the card would otherwise answer "no" to a
 * question about the card.
 *
 * Three layers, all against the shipped files:
 *
 *   the shelf   js/owned.js over collections in the shape the app hydrates
 *               them into, with the real js/auth.js and js/collections.js
 *               beside it — whose a collection is and who you are are the two
 *               questions this is built on, and a stubbed answer to either
 *               would be a test of this file's opinion of them
 *   the card    js/cardturn.js's wrapper rule: a card is wrapped when
 *               something sits on it, and a plain card nobody owns is still
 *               the tile it has always been
 *   the frame   the stylesheet and the render sites, read as text, where what
 *               matters is that a grid cannot quietly ship without the mark
 *
 * What is not asserted is what it looks like. That is the eye's, and
 * docs/design/proto-owned-flag.html is where it was looked at.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* Two people and a shared box, which is the smallest arrangement in which
 * "mine" and "the group's" are different questions. */
const PLAYERS = [
  { id: 'p-tim',  name: 'Tim',  colorIdx: 0 },
  { id: 'p-kari', name: 'Kari', colorIdx: 3 },
];

const COLLECTIONS = [
  { key: 'c-tim',   name: 'Tim’s binder', owner: 'p-tim',  color: '#a855f7',
    cards: { 'Sol Ring': { qty: 3 }, 'Delver of Secrets // Insectile Aberration': { qty: 1 } } },
  { key: 'c-kari',  name: 'Kari’s binder', owner: 'p-kari', color: '#3b82f6',
    cards: { 'Rhystic Study': { qty: 1 }, 'Sol Ring': { qty: 1 } } },
  { key: 'c-house', name: 'The house box', owner: null,     color: '#10b981',
    cards: { 'Cultivate': { qty: 2 } } },
];

function loadShelf({ who = 'p-tim', collections = COLLECTIONS } = {}) {
  const store = new Map();
  const fakeEl = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, addEventListener() {},
    appendChild() {}, querySelector: () => null, querySelectorAll: () => [],
  });

  const sandbox = {
    console,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    document: {
      addEventListener() {}, querySelectorAll: () => [], createElement: fakeEl,
      getElementById: fakeEl, body: { appendChild() {}, style: {} },
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    alert() {}, confirm: () => true, setTimeout: () => 1, clearTimeout() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    // Outside this ticket: the pictures, the deck panel, the card facts.
    renderDeck() {}, openDrawer() {}, closeDrawers() {},
    ensureScryfallImages: async () => {},
    scryfallCache: new Map(), scryfallMetaCache: new Map(),
    deck: null, deckFilter: false,
  };
  vm.createContext(sandbox);
  for (const file of ['state.js', 'sortui.js', 'cardquery.js', 'cardstack.js',
                      'auth.js', 'collections.js', 'owned.js', 'cardturn.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox, { filename: file });
  }
  const run = expr => vm.runInContext(expr, sandbox);

  run(`currentUser = ${JSON.stringify({ username: 'tim', role: 'user', playerId: who })}`);
  run(`hydrateState(${JSON.stringify({ players: PLAYERS, collections })})`);

  return {
    run,
    store,
    /** The mark drawn on a card, as a tile would interpolate it. */
    mark: name => run(`cardOwnMark(${JSON.stringify(name)})`),
    scope: s => run(`setOwnScope(${JSON.stringify(s)})`),
  };
}

// ── The three states ──────────────────────────────────────────────────────

test('a card on your own shelf wears the solid mark, and says how many', () => {
  const app = loadShelf();
  const mark = app.mark('Sol Ring');
  assert.match(mark, /class="card-own card-own-mine"/,
    'a card in your own collection is yours, not somebody else’s');
  assert.match(mark, /title="[^"]*Tim’s binder ×3/,
    'the quantity is on the title rather than on the face — ×3 is illegible at 118px');
});

test('a card only somebody else has wears the broken mark, in their colour', () => {
  const app = loadShelf();
  const mark = app.mark('Rhystic Study');
  assert.match(mark, /card-own-their/, 'Kari’s copy is not yours');
  assert.match(mark, /--own-ink:var\(--player-3\)/,
    'the holder’s colour is a slot reference, so a theme change repaints it');
  assert.match(mark, /title="[^"]*Kari/, 'who to ask is the whole point of the state');
});

test('a card nobody has wears nothing at all', () => {
  const app = loadShelf();
  assert.equal(app.mark('Mana Crypt'), '',
    'the third state is absence: a mark on every unowned card is a page of markers');
});

// ── Whose shelf, and the one place that decides it ────────────────────────

test('the scope is the app’s, so the group’s box is yours only at the group’s scope', () => {
  const app = loadShelf();

  assert.match(app.mark('Cultivate'), /card-own-their/,
    'at "mine", the house box is somebody else’s — it is not your shelf');
  app.scope('group');
  assert.match(app.mark('Cultivate'), /card-own-mine/,
    'at "the group’s", a box nobody owns is one you can sleeve from tonight');
  app.scope('all');
  assert.match(app.mark('Rhystic Study'), /card-own-mine/,
    'at "everyone’s", every loaded collection counts');
});

test('the scope is remembered under the person, not the browser', () => {
  const app = loadShelf();
  app.scope('all');
  assert.equal(app.store.get('mtgtools_db_own_scope:p-tim'), 'all',
    'two people share a browser in open mode, and "mine" means a different shelf to each');
  assert.equal(app.store.get('mtgtools_db_own_scope:p-kari'), undefined);
});

test('an app that cannot say who you are reads the group’s, and marks accordingly', () => {
  const app = loadShelf({ who: null });
  assert.equal(app.run('ownScope()'), 'group',
    'with nobody to be, every shelf is the group’s — the honest answer, not a broken one');
  assert.match(app.mark('Rhystic Study'), /card-own-mine/,
    'and every loaded collection is counted, rather than none of them');
});

// ── The two ways the lookup goes quietly wrong ────────────────────────────

test('a two-faced card is found under the name the shelf filed it under', () => {
  const app = loadShelf();
  /* EDHREC and Scryfall's card_faces[0] both say the short name; the importer
     wrote the long one. Both have to find the card. */
  assert.match(app.mark('Delver of Secrets // Insectile Aberration'), /card-own-mine/,
    'the name as the shelf holds it');
  assert.match(app.mark('Delver of Secrets'), /card-own-mine/,
    'and the front face on its own, which is what a recommendation is named by');
});

test('a collection still loading is not a collection with nothing in it', () => {
  const loading = COLLECTIONS.map(c =>
    (c.key === 'c-tim' ? { ...c, status: 'loading' } : c));
  const app = loadShelf();
  /* hydrateState marks everything loaded, so the state is set the way a
     half-arrived import leaves it: the shelf is what has finished. */
  app.run(`state.collections.find(c => c.key === 'c-tim').status = 'loading'`);
  assert.equal(app.mark('Delver of Secrets // Insectile Aberration'), '',
    'a card known only to a collection that has not landed is not yet owned');
  assert.doesNotMatch(app.mark('Sol Ring'), /Tim’s binder/,
    'and half a collection is not a smaller shelf, it is a wrong answer');
  assert.ok(loading.length === 3);
});

// ── The card, and what is allowed to sit on it ────────────────────────────

test('a card is wrapped when something sits on it, and not otherwise', () => {
  const app = loadShelf();
  const plain = app.run(`cardArtHtml('<img>', {})`);
  assert.equal(plain, '<img>',
    'a one-sided card nobody owns is the tile it has always been');

  const owned = app.run(`cardArtHtml('<img>', { own: cardOwnMark('Sol Ring') })`);
  assert.match(owned, /class="card-turnable"/, 'the mark needs the box');
  assert.match(owned, /card-own/);

  const both = app.run(`cardArtHtml('<img>', { back: 'b.jpg', own: cardOwnMark('Sol Ring') })`);
  assert.match(both, /card-turn"/,  'the control that turns it over');
  assert.match(both, /card-own/,    'and the mark, in one box');
});

test('the old two-argument form still means what it meant', () => {
  const app = loadShelf();
  assert.equal(app.run(`cardTurnableHtml('<img>', '')`), '<img>');
  assert.match(app.run(`cardTurnableHtml('<img>', 'b.jpg')`), /card-turnable/);
});

// ── The frame ─────────────────────────────────────────────────────────────

test('the stylesheet draws the mark, and lets the card through it', () => {
  const css = read('public/css/components.css');
  assert.match(css, /\.card-own \{/, 'the mark has a rule');
  const block = css.slice(css.indexOf('.card-own {'), css.indexOf('.card-own-their'));
  assert.match(block, /pointer-events:\s*none/,
    'it states something and is not a control — the card underneath keeps its whole area');
  assert.match(block, /border-radius:\s*var\(--radius-card\)/,
    'the clip inherits the card’s own curve, which is a percentage and not a pixel count');
  assert.match(css, /\.card-own-their::before[\s\S]*repeating-linear-gradient/,
    'somebody else’s is the same object with its fill interrupted');
});

test('every grid that draws a card asks whose it is', () => {
  /* The mark reaching one tab and not the next is exactly the split this work
     existed to end, so the render sites are named here: a new grid that draws
     card art without asking is a grid this list will not cover. */
  for (const [file, what] of [
    ['public/js/deckview-panels.js', 'the Search / EDHREC drawer'],
    ['public/js/search.js',          'the Scryfall search'],
    ['public/js/sets.js',            'the Set Browser'],
    ['public/js/wants.js',           'the want lists'],
    ['public/js/collections.js',     'the Collections grid'],
    ['public/js/deckview-render.js', 'the deck mat'],
    ['public/js/card.js',            'the Card Detail tab'],
    ['public/js/cardstack.js',       'a card in a fanned pile'],
  ]) {
    assert.match(read(file), /cardOwnMark\(/, `${what} draws no ownership mark`);
  }
});

test('the module is loaded before the tabs that draw the mark', () => {
  const html  = read('public/index.html');
  /* The tag and not the name: index.html names js/deckview-owned.js in two
     comments long before it loads anything, and a substring search would read
     those as the script. */
  const at = file => html.indexOf(`<script src="js/${file}">`);
  assert.ok(at('owned.js') > 0, 'js/owned.js is served');
  assert.ok(at('owned.js') > at('auth.js') && at('owned.js') > at('collections.js'),
    'whose a collection is and who you are are resolved before the shelf is');
  for (const tab of ['search.js', 'sets.js', 'wants.js', 'deckview-owned.js']) {
    assert.ok(at('owned.js') < at(tab), `js/${tab} is loaded before js/owned.js`);
  }
});
