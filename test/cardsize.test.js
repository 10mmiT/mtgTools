/* How big cards are drawn, and where that choice is kept.
 *
 * The card-size control is one component with four callers, and the thing
 * worth asserting about it is not its slider but its memory: which tab and
 * which view a chosen size belongs to, what a view opens at before anyone has
 * chosen, and what happens to a stored value that is not a size at all. All
 * four are functions of their inputs and a store, so they are asserted here
 * rather than by dragging a slider in a browser. What is not asserted is the
 * markup the control renders or how a grid looks at 80px — those are the
 * screenshot harness's and the eye's.
 *
 * The shipped public/js/sortui.js is run against stub browser globals, the way
 * test/cardstack.test.js runs the stack renderer, so these assert on the code
 * the browser is served rather than on a copy of it.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** A browser's localStorage, as much of it as this file touches: string keys,
 *  string values, and it outlives the page. Handed in from outside so that a
 *  second load of the file — a reload — reads what the first one wrote. */
function fakeStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
}

/** The file reads its stored preferences and hangs two listeners as it loads,
 *  so it needs a store and somewhere to hang them. Nothing below calls the
 *  listeners: what is under test is what the file remembers. */
function loadSortUi(storage) {
  const sandbox = { localStorage: storage, document: { addEventListener() {} } };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/sortui.js'), sandbox);
  const evaluate = expr => vm.runInContext(expr, sandbox);
  return {
    evaluate,
    min:     evaluate('CARD_SIZE_MIN'),
    max:     evaluate('CARD_SIZE_MAX'),
    get:  (view, mode) => evaluate(`getCardSize(${JSON.stringify(view)}, ${JSON.stringify(mode)})`),
    save: (view, mode, px) =>
      evaluate(`saveCardSize(${JSON.stringify(view)}, ${JSON.stringify(mode)}, ${JSON.stringify(px)})`),
  };
}

/** One browser: a store, and the app loaded against it. */
function browser(seed) {
  const storage = fakeStorage(seed);
  return { storage, app: loadSortUi(storage), reload: () => loadSortUi(storage) };
}

// ── Where a view starts ───────────────────────────────────────────────

test('a view opens somewhere a card is legible and the slider can reach', () => {
  const { app } = browser();
  for (const mode of ['grid', 'pile']) {
    const px = app.get('collections', mode);
    assert.ok(px >= app.min && px <= app.max,
      `the ${mode} view opens at ${px}px, outside the ${app.min}–${app.max} the slider offers`);
  }
});

test('every tab opens a given view at the same size', () => {
  const { app } = browser();
  const grid = app.get('collections', 'grid');
  for (const view of ['scryfall', 'sets', 'deckbuild']) {
    assert.strictEqual(app.get(view, 'grid'), grid,
      `${view} opens its grid somewhere else`);
  }
});

// ── What is remembered, and by whom ───────────────────────────────────

test('a size chosen in one view leaves the others where they were', () => {
  const { app } = browser();
  const before = app.get('deckbuild', 'pile');
  app.save('deckbuild', 'grid', 90);
  assert.strictEqual(app.get('deckbuild', 'grid'), 90);
  assert.strictEqual(app.get('deckbuild', 'pile'), before,
    'scanning a deck at thumbnails is not a request to shrink its piles');
});

test('a size chosen on one tab leaves the other tabs where they were', () => {
  const { app } = browser();
  const before = app.get('sets', 'grid');
  app.save('collections', 'grid', 260);
  assert.strictEqual(app.get('collections', 'grid'), 260);
  assert.strictEqual(app.get('sets', 'grid'), before,
    'a collection browsed at large cards is not a set browsed at large cards');
});

test('a chosen size survives a reload', () => {
  const { app, reload } = browser();
  app.save('scryfall', 'grid', 300);
  app.save('wants', 'grid', 110);
  const reloaded = reload();
  assert.strictEqual(reloaded.get('scryfall', 'grid'), 300);
  assert.strictEqual(reloaded.get('wants', 'grid'), 110);
});

test('the Deck Builder remembers alongside the browsing tabs, not instead of them', () => {
  // Five callers, one store: the tab that built this control is one of them.
  const { app, reload } = browser();
  app.save('deckbuild', 'pile', 200);
  app.save('sets', 'grid', 120);
  const reloaded = reload();
  assert.strictEqual(reloaded.get('deckbuild', 'pile'), 200);
  assert.strictEqual(reloaded.get('sets', 'grid'), 120);
});

test('the sizes stored against the XL view are dropped, and nothing else is', () => {
  // XL is gone — the slider is how "how big?" is asked now — so a size kept
  // against it is for a view nobody can reach. What was chosen for a grid is
  // still what that person wants their grid at.
  const { app, storage } = browser({
    mtgtools_size: JSON.stringify({
      'collections:xl': 300, 'collections:grid': 130, 'deckbuild:pile': 200,
    }),
  });
  assert.strictEqual(app.get('collections', 'grid'), 130);
  assert.strictEqual(app.get('deckbuild', 'pile'), 200);
  assert.deepStrictEqual(
    Object.keys(JSON.parse(storage.getItem('mtgtools_size'))).sort(),
    ['collections:grid', 'deckbuild:pile'],
    'the dead key is gone from the store, not just ignored on the way out of it');
});

// ── What a stored size may be ─────────────────────────────────────────

test('a stored size is brought back into the range whatever is in the store', () => {
  // localStorage is a shared, editable, string-typed store, and a grid told
  // to lay itself out at 4000px is a broken tab rather than a preference.
  const { app } = browser({
    mtgtools_size: JSON.stringify({ 'collections:grid': 4000, 'sets:grid': 1 }),
  });
  assert.strictEqual(app.get('collections', 'grid'), app.max);
  assert.strictEqual(app.get('sets', 'grid'), app.min);
});

test('a stored size that is not a number falls back to where the view starts', () => {
  const { app } = browser({
    mtgtools_size: JSON.stringify({ 'collections:grid': 'huge' }),
  });
  assert.strictEqual(app.get('collections', 'grid'),
    loadSortUi(fakeStorage()).evaluate('cardSizeDefault("grid")'));
});

test('a size arrives as the string a range input hands over', () => {
  // Every caller of saveCardSize passes slider.value, which is a string.
  const { app } = browser();
  app.save('sets', 'grid', '170');
  assert.strictEqual(app.get('sets', 'grid'), 170);
});
