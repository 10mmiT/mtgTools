/* The want list, as cards.
 *
 * The tab draws a card twice over — a row in a table, and a tile of artwork in
 * the grid — and only one of them is a card you can look at: the row's picture
 * is the app-wide hover preview, which already lays a double-faced card's two
 * faces out side by side, and the tile's is the card itself at the size the
 * slider left it.
 *
 * So what is asserted here is the tile carrying the control that turns it, on
 * the same rule js/cardturn.js states for every other view that draws a card
 * big enough to read: a card with two pictures wears it, a card with one — a
 * split card, a Room, an ordinary card — does not, and the answer to which is
 * which is scryfallBackFace()'s rather than this tab's.
 *
 * The shipped public/js/wants.js is run in a vm against stub browser globals,
 * the way the deck tab's tests run the mat, with js/scryfall.js and
 * js/cardturn.js loaded for real: a stub that agreed with the tile about what
 * has a back would assert nothing.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const SOL_RING_ART  = 'https://cards.scryfall.io/normal/sol-ring.jpg';
const VALAKUT_FRONT = 'https://cards.scryfall.io/normal/valakut-awakening.jpg';
const VALAKUT_BACK  = 'https://cards.scryfall.io/normal/valakut-stoneforge.jpg';

/* The three shapes Scryfall answers in: a card whose picture is its own, a
 * card with two faces and two pictures, and a card with two faces and one —
 * which is a split card or a Room, one piece of cardboard that does not turn
 * over. */
const CARDS = [
  ['Sol Ring', { name: 'Sol Ring', type_line: 'Artifact', cmc: 1,
                 image_uris: { normal: SOL_RING_ART } }],
  ['Valakut Awakening // Valakut Stoneforge',
   { name: 'Valakut Awakening // Valakut Stoneforge', type_line: 'Instant // Land', cmc: 3,
     card_faces: [{ name: 'Valakut Awakening',  image_uris: { normal: VALAKUT_FRONT } },
                  { name: 'Valakut Stoneforge', image_uris: { normal: VALAKUT_BACK } }] }],
  ['Fire // Ice', { name: 'Fire // Ice', type_line: 'Instant // Instant', cmc: 2,
                    image_uris: { normal: 'https://cards.scryfall.io/normal/fire-ice.jpg' },
                    card_faces: [{ name: 'Fire' }, { name: 'Ice' }] }],
];

/** The tab over one player's want list, drawn into a stub document. */
function loadWants(wanted) {
  const store = new Map();
  const els   = {};
  const el = id => (els[id] ||= {
    id, innerHTML: '', textContent: '', value: '', style: {},
    addEventListener() {}, setAttribute() {}, appendChild() {},
    classList: { add() {}, remove() {}, toggle() {} },
  });

  const sandbox = {
    console,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    document: {
      addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
      createElement: () => el('made'),
      getElementById: id => el(id),
      body: { style: {}, appendChild() {} },
    },
    window: { addEventListener() {}, innerWidth: 1440 },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    setTimeout: () => 1, clearTimeout() {},
    esc: s => String(s), jsAttr: s => String(s),
    renderPrice: () => '', sfCardOwnership: () => '',
    playerColor: () => '#888', isMyPlayer: () => true,
    currentUser: { role: 'admin', playerId: 'p1' },
    state: { collections: [], players: [{ id: 'p1', name: 'Tim', wantList: wanted }] },
    scryfallMetaCache: new Map(),
  };
  vm.createContext(sandbox);
  for (const file of ['scryfall.js', 'cardturn.js', 'sortui.js', 'wants.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox, { filename: file });
  }
  const run = expr => vm.runInContext(expr, sandbox);

  /* The controls are mounted from the render and want a toolbar to mount on;
     they are not what is under test, and the flag is the tab's own way of
     saying they are already up. */
  run('_wantControlsMounted = true');
  run(`wantCardData = new Map(${JSON.stringify(CARDS)})`);

  return {
    run,
    /** The grid, drawn. */
    grid: async () => {
      run(`wantView = 'grid'`);
      await run('renderWantList()');
      return els.wantResults.innerHTML;
    },
    /** And the table, which draws no artwork of its own. */
    list: async () => {
      run(`wantView = 'list'`);
      await run('renderWantList()');
      return els.wantResults.innerHTML;
    },
  };
}

test('a two-faced card in the grid wears the control that turns it', async () => {
  const tab  = loadWants(['Valakut Awakening // Valakut Stoneforge']);
  const grid = await tab.grid();
  assert.match(grid, /class="card-turnable/, 'the tile draws no turn control');
  assert.match(grid, new RegExp(`data-turn="${VALAKUT_BACK}"`),
    'the control carries no other side to show');
  assert.match(grid, new RegExp(`src="${VALAKUT_FRONT}"`),
    'and the card is still drawn front first');
});

test('a card with one picture wears nothing, however many faces it has', async () => {
  // Fire // Ice is two faces and one piece of cardboard: it has no other side
  // to be shown, and a control offering one would mean nothing.
  for (const name of ['Sol Ring', 'Fire // Ice']) {
    const tab  = loadWants([name]);
    const grid = await tab.grid();
    assert.doesNotMatch(grid, /card-turnable|card-turn/, `${name}'s tile`);
  }
});

test('the table draws no picture, so there is nothing on it to turn', async () => {
  /* The row's card is the hover preview main.js opens over any .card-link,
   * which draws both faces of a double-faced card at once — the same reason
   * the deck builder's list row carries no control either. */
  const tab  = loadWants(['Valakut Awakening // Valakut Stoneforge']);
  const list = await tab.list();
  assert.doesNotMatch(list, /card-turnable|card-turn/);
  assert.match(list, /card-link/, 'the row still hands the preview a name to draw');
});
