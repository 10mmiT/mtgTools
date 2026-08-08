/* The frame: chrome that folds in two tiers, and the pile that is not there
 * yet.
 *
 * Both halves are the same argument — the cards are the content — and both are
 * asserted against the shipped files rather than a copy of them, the way
 * test/carddrag.test.js runs the carry: the JS is run in a vm sandbox with the
 * browser globals it reaches for stubbed, and the CSS and markup are read as
 * text where what matters is a rule that must exist or must not.
 *
 * What is not asserted is what a folded mat looks like, or how faint a ghost
 * pile is at rest. That is the eye's, for the reason the redesign recorded.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const CSS    = read('public/css/tabs.css');
const MARKUP = read('public/index.html');

// ── The fold ──────────────────────────────────────────────────────────
// Three states in a ring, remembered per view. The store is sortui.js's, the
// same one the sort, the columns and the card size are kept in, so the fold is
// loaded from the file that owns that entry rather than from a stand-in.

/** The preference store over a localStorage that is only a Map, so what is
 *  asserted is what would survive a reload rather than what a stub remembered. */
function loadPrefs(seed = {}) {
  const store = new Map(Object.entries(seed));
  const sandbox = {
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
    window: { addEventListener() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/sortui.js'), sandbox);
  const run = expr => vm.runInContext(expr, sandbox);
  return {
    store,
    get:  (view, folds) => run(`getChromeFold(${JSON.stringify(view)}, ${JSON.stringify(folds)})`),
    save: (view, fold)  => run(`saveChromeFold(${JSON.stringify(view)}, ${JSON.stringify(fold)})`),
  };
}

const FOLDS = ['full', 'readout', 'bare'];

test('a tab nobody has folded is showing everything', () => {
  assert.strictEqual(loadPrefs().get('deckbuild', FOLDS), 'full');
});

test('a fold survives the reload', () => {
  // The whole of "a deck read at full mat comes back at full mat": the state
  // is written to the same entry the sort and the size live in, and read back
  // out of a fresh load of the file.
  const first = loadPrefs();
  first.save('deckbuild', 'bare');
  assert.strictEqual(loadPrefs(Object.fromEntries(first.store)).get('deckbuild', FOLDS), 'bare');
});

test('each view folds on its own', () => {
  const prefs = loadPrefs();
  prefs.save('deckbuild', 'readout');
  assert.strictEqual(prefs.get('deckbuild', FOLDS), 'readout');
  assert.strictEqual(prefs.get('collections', FOLDS), 'full',
    'a tab nobody folded is not folded because another one was');
});

test('a stored fold that is not a fold is no fold at all', () => {
  // localStorage is a string store shared with older versions of this app and
  // with whatever anyone types into a console. A tab told to be "bare " or 7
  // shows everything rather than half of something.
  for (const junk of ['bare ', 'BARE', '', '7', 'null']) {
    const prefs = loadPrefs({ mtgtools_fold: JSON.stringify({ deckbuild: junk }) });
    assert.strictEqual(prefs.get('deckbuild', FOLDS), 'full', `${junk} was taken for a fold`);
  }
  for (const junk of ['[]', 'null', '{', 'undefined']) {
    const prefs = loadPrefs({ mtgtools_fold: junk });
    assert.strictEqual(prefs.get('deckbuild', FOLDS), 'full', `${junk} took the whole file down`);
  }
});

/** The Deck Builder's own module, over a pane that only remembers what was
 *  written on it. The fold is one attribute and one label, so what is read back
 *  is the attribute the stylesheet acts on and the title the button carries. */
function loadTab(seed = {}, { width = 1400 } = {}) {
  const store = new Map(Object.entries(seed));
  const pane = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const stub = () => ({
    title: '', attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    classList: { toggle() {} },
  });
  const button = stub();
  const menuButton = stub();
  const panel = { style: { display: 'none' } };
  const sandbox = {
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      getElementById: id => ({
        'tab-deckview': pane, dbFoldBtn: button, dbAnalysis: panel, dbCurveBtn: button,
        dbMenuBtn: menuButton,
      }[id] || null),
    },
    window: { addEventListener() {}, innerWidth: width },
    dbDeck: { id: 'd1', playerId: 'p1' },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/sortui.js'), sandbox);
  vm.runInContext(read('public/js/deckview-core.js'), sandbox);
  const run = expr => vm.runInContext(expr, sandbox);
  return {
    store, pane, button, menuButton, panel, run,
    press:  () => run('dbFoldChrome()'),
    fold:   () => pane.attrs['data-db-fold'],
    labels: () => JSON.parse(run('JSON.stringify(DB_FOLD_LABELS)')),
    /** The menu beside the mat, as the stylesheet is told about it. */
    arrive: () => run('_dbLoadMenu()'),
    menu:   () => pane.attrs['data-db-menu'],
  };
}

test('one press hides the controls, a second hides the readout, a third brings both back', () => {
  // The ring is what makes one button enough: nothing is ever more than one
  // press from being reachable, and the way back needs no second control.
  const tab = loadTab();
  tab.run("dbSetFold('full')");
  assert.strictEqual(tab.fold(), 'full');
  tab.press(); assert.strictEqual(tab.fold(), 'readout');
  tab.press(); assert.strictEqual(tab.fold(), 'bare');
  tab.press(); assert.strictEqual(tab.fold(), 'full');
});

test('the button says what the next press does, in every state', () => {
  const tab = loadTab();
  const labels = tab.labels();
  for (const fold of FOLDS) {
    tab.run(`dbSetFold(${JSON.stringify(fold)})`);
    assert.strictEqual(tab.button.title, labels[fold], `the button lied in the ${fold} state`);
    assert.strictEqual(tab.button.attrs['aria-label'], labels[fold],
      'and a screen reader was told something else again');
  }
});

test('folding is remembered as it happens, not on the way out', () => {
  // Nothing has to be flushed when the tab is left, and a browser closed a
  // moment after the press comes back folded.
  const tab = loadTab();
  tab.press();
  assert.deepStrictEqual(JSON.parse(tab.store.get('mtgtools_fold')), { deckbuild: 'readout' });
});

test('the fold on the pane is the one thing the stylesheet is told', () => {
  // Two tiers spread across a dozen style.display writes are two tiers that
  // will disagree. What the pane carries is the whole of the state.
  const tab = loadTab();
  tab.run("dbSetFold('bare')");
  assert.deepStrictEqual(tab.pane.attrs, { 'data-db-fold': 'bare' });
});

test('the controls hide, the readout survives the first press and not the second', () => {
  // The rules themselves, because this tier is drawn by the stylesheet: the
  // toolbar's contents and the bars that are controls go on the first press,
  // and the readout line goes only on the second.
  const controls = CSS.match(/^\.db-pane\[data-db-mode="deck"\]:not\(\[data-db-fold="full"\]\)[^{]*\{[^}]*\}/ms);
  assert.ok(controls, 'nothing hides the controls');
  for (const part of ['.toolbar >', '.db-analysis', '.db-bulk-bar', '.db-add-cat-row']) {
    assert.ok(controls[0].includes(part), `${part} is not folded away with the controls`);
  }
  assert.ok(!controls[0].includes('.db-stats-bar'),
    'the readout went with the controls, and it is the half you want while building');

  const bare = CSS.match(/^\.db-pane\[data-db-mode="deck"\]\[data-db-fold="bare"\][^{]*\{[^}]*\}/ms);
  assert.ok(bare && bare[0].includes('.db-stats-bar'), 'the second press left the readout up');
});

test('the way back is never one of the things that hides', () => {
  // A mat with no way out of it is a mat you have to reload the page to leave.
  const hidden = CSS.match(/:not\(\[data-db-fold="full"\]\) \.toolbar > :not\(([^)]*)\)/);
  assert.ok(hidden && hidden[1].includes('.db-fold'), 'the fold button folds itself away');
  assert.match(MARKUP, /id="dbFoldBtn"[^>]*onclick="dbFoldChrome\(\)"/,
    'and it is a real button, so it is reachable by tabbing to it');
});

test('nothing folded away is brought back by pointing at it', () => {
  // The mat is a drag surface: a card carried towards a category high on the
  // screen would trip a reveal-on-hover every time. Folding is asked for, and
  // the only way to ask is the button and the key beside it.
  for (const rule of CSS.split('}')) {
    if (!rule.includes('data-db-fold')) continue;
    const selector = rule.split('{')[0];
    assert.ok(!/:hover|:focus-within/.test(selector),
      `a fold rule fires on the pointer: ${selector.trim()}`);
  }
});

test('a folded tab with no deck on it still has its picker', () => {
  // Folded, then reloaded onto an empty tab: the preference is kept, and the
  // one control that gets you a deck is not hidden by it.
  for (const rule of CSS.split('}')) {
    const selector = rule.split('{')[0];
    if (!/data-db-fold="(readout|bare)"|:not\(\[data-db-fold="full"\]\)/.test(selector)) continue;
    if (!/\.toolbar|\.db-add-cat-row|\.db-bulk-bar|\.db-analysis|\.db-stats-bar/.test(selector)) continue;
    assert.match(selector, /\[data-db-mode="deck"\]/,
      `${selector.trim()} hides a control on a tab that has no deck to fold`);
  }
});

// ── The menu beside the mat ───────────────────────────────────────────
// The strip had grown to fourteen controls and wrapped to three rows. What is
// not the picker, the add field or the filter is a column at the right-hand
// edge of the mat now — one that *pushes* rather than covers, because every
// control in it is answered by the mat.

test('the menu is a column beside the mat, not a panel over it', () => {
  /* The whole argument for a column over the drawer shell already on this tab:
     change the size and the cards resize, press a board and a region appears.
     A panel you have to close to see what it did is one you use twice. */
  assert.match(MARKUP, /<div class="db-body">[\s\S]*?id="dbDeckContent"[\s\S]*?<aside id="dbMenu"/,
    'the mat and the menu are not laid out as one row');
  assert.match(CSS, /\.db-body \{[^}]*display: flex;/, 'the mat and the menu do not sit side by side');
  const menu = CSS.match(/^\.db-menu \{[^}]*\}/ms);
  assert.ok(menu, 'the menu has no rule at all');
  assert.ok(!/position: (fixed|absolute)/.test(menu[0]), 'the menu is lying over the mat');
  assert.ok(!/\.db-menu[^{]*\{[^}]*var\(--scrim\)/.test(CSS), 'the menu has a scrim behind it');
});

test('the mat gets the width the menu is not using', () => {
  assert.match(CSS, /\.db-body > \.db-mat \{[^}]*min-width: 0/,
    'the mat will not give the column its width');
});

test('it arrives open, and how it was left is remembered', () => {
  const fresh = loadTab();
  fresh.arrive();
  assert.strictEqual(fresh.menu(), 'open',
    'the controls that used to be on the strip are hidden until asked for');

  fresh.run('dbToggleMenu()');
  assert.strictEqual(fresh.menu(), 'closed');
  const again = loadTab(Object.fromEntries(fresh.store));
  again.arrive();
  assert.strictEqual(again.menu(), 'closed', 'a closed menu came back open');
});

test('a phone arrives closed, and is not told what a desktop preferred', () => {
  /* At this width the row becomes a column and the menu takes the top of the
     page, which is a screenful. The stored preference is a desktop preference
     being read on a phone — so it is not applied, and not overwritten either. */
  const tab = loadTab({}, { width: 390 });
  tab.arrive();
  assert.strictEqual(tab.menu(), 'closed');
  assert.strictEqual(tab.store.get('dbMenu'), undefined,
    'a phone wrote a preference nobody expressed');

  assert.match(CSS, /@media \(width < 900px\) \{\s*\.db-body \{ flex-direction: column; \}/,
    'the row does not become a column where there is nothing to push into');
  assert.match(CSS, /\.db-menu \{ order: -1;/, 'the menu is under the mat on a phone');
});

test('the button says whether it is open, and the key does what it does', () => {
  const tab = loadTab();
  tab.arrive();
  assert.strictEqual(tab.menuButton.attrs['aria-expanded'], 'true');
  tab.run('dbToggleMenu()');
  assert.strictEqual(tab.menuButton.attrs['aria-expanded'], 'false');
  assert.match(MARKUP, /id="dbMenuBtn"[^>]*aria-controls="dbMenu"/,
    'the button does not say what it opens');
  assert.match(read('public/js/deckview-core.js'), /e\.key === 'm' \|\| e\.key === 'M'/,
    'the column that holds every control has no key of its own');
});

test('the menu folds away with the rest of the controls, because it is them', () => {
  assert.match(CSS, /:not\(\[data-db-fold="full"\]\) \.db-menu \{\s*display: none;/,
    'the first press of the fold leaves the controls standing');
});

test('what the ⋯ popover held is in the menu, and the popover is gone', () => {
  /* A popover inside a strip is what you build when the strip has no room. */
  const menu = MARKUP.match(/<aside id="dbMenu"[\s\S]*?<\/aside>/)[0];
  for (const item of ['dbShowNewDeck', 'dbShowImportText', 'dbExportCsv', 'dbDeleteDeck',
                      'dbOpenHistoryPanel', 'dbShowCategoriesModal', 'dbLoadForComparison',
                      'dbOpenSearchPanel', 'dbToggleAnalysis']) {
    assert.ok(menu.includes(item), `${item} is not reachable from the menu`);
  }
  assert.ok(!MARKUP.includes('dbMoreMenu'), 'the ⋯ popover is still in the markup');
  assert.ok(!read('public/js/deckview-panels.js').includes('function dbToggleMoreMenu'),
    'and its handler is still being served');
});

test('a tab with no deck still offers the one action that gets you one', () => {
  // The menu itself is not .db-when-deck: "New deck…" is in it, and a tab with
  // no deck is exactly when that is wanted.
  const menu = MARKUP.match(/<aside id="dbMenu"[\s\S]*?<\/aside>/)[0];
  assert.ok(!/<aside id="dbMenu"[^>]*db-when-deck/.test(menu),
    'the whole menu disappears on a tab with no deck');
  const deckGroup = menu.match(/<div class="db-menu-group">[\s\S]*?<\/div>\s*<\/aside>/)[0];
  assert.match(deckGroup, /onclick="dbShowNewDeck\(\)"/);
  assert.ok(!/class="db-menu-item"[^>]*dbShowNewDeck/.test(deckGroup) ||
            !/db-when-deck[^>]*dbShowNewDeck/.test(deckGroup),
    'the way to a first deck needs a deck');
});

test('the strip keeps what is used while building, and nothing else', () => {
  const strip = MARKUP.match(/<div class="toolbar">[\s\S]*?<!-- The mat and the menu/)[0];
  for (const id of ['dbDeckSel', 'dbAddCardInput', 'dbFilterInput', 'dbMenuBtn', 'dbFoldBtn']) {
    assert.ok(strip.includes(`id="${id}"`), `${id} left the strip`);
  }
  for (const id of ['dbViewMount', 'dbSizeMount', 'dbSortMount', 'dbBoardMount',
                    'dbOwnChips', 'dbOwnScopeMount', 'dbCurveBtn']) {
    assert.ok(!strip.includes(`id="${id}"`), `${id} is still crowding the strip`);
  }
});

test('the curve is not a permanent strip on the mat', () => {
  // Analysis beyond the one line expands out of the toolbar. It used to be
  // nailed to the readout, where it cost a band of mat on every deck and was
  // hidden outright on a phone.
  const readout = MARKUP.match(/<div class="db-stats-bar[^>]*>([\s\S]*?)<\/div>\s*<!--/);
  assert.ok(readout, 'the readout line is gone');
  assert.ok(!readout[1].includes('dbCurve'), 'the curve is still nailed to the readout');
  assert.match(MARKUP, /id="dbAnalysis"[\s\S]*?id="dbCurve"/,
    'and it is not in a panel that expands either');
  assert.match(MARKUP, /id="dbCurveBtn"[^>]*aria-controls="dbAnalysis"/,
    'the control that expands it does not say what it expands');
});

// ── The ghost pile ────────────────────────────────────────────────────
// A permanent empty outline after the last category. Drop cards on it and it
// is a real category with those cards in it, named in place.

/** The mat's two answers to the carry, as test/carddrag.test.js loads them,
 *  plus the constants js/deckview-core.js declares for the ghost. Everything
 *  the drop touches is the shipped code: the category is made by the panel, the
 *  cards are moved by the edit module, and what is counted is the render and
 *  the deferred write that module really schedules. */
function loadMat(cards, cats = [], selected = []) {
  const sandbox = {
    dbDeck:  { id: 'd1', playerId: 'p1' },
    dbCards: cards.map(c => ({ qty: 1, board: 'main', ...c })),
    dbCats:  cats.map((name, i) => ({ name, position: i })),
    dbSelectedCards: new Set(selected.map(n => `main/${n}`)),
    dbSettledCats:   new Set(),
    dbShownBoards:   new Set(),
    dbView: 'list',
    dbCardData: new Map(),
    _dbLandedCards: null,
    _dbNamingCat: null,
    dbSaveTimer: 0,
    isMyPlayer: id => id === 'p1',
    document: { addEventListener() {}, getElementById: () => null },
    window:   { addEventListener() {} },
    clearTimeout() {},
    fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    renders: 0, saves: 0,
  };
  sandbox.dbRender   = () => { sandbox.renders++; };
  /* deckview-core.js's: a card landing on the head of the deck puts that board
   * on the mat. Which board is showing is not this file's question. */
  sandbox._dbRevealHeadBoard = () => {};
  sandbox.setTimeout = () => { sandbox.saves++; return 1; };
  vm.createContext(sandbox);
  /* The ghost's own constant, and the grammar a place is written in, out of
   * the module that declares them rather than out of a stub beside them. */
  vm.runInContext(read('public/js/deckview-boards.js'), sandbox);
  vm.runInContext(read('public/js/deckview-edit.js'), sandbox);
  vm.runInContext(read('public/js/deckview-panels.js'), sandbox);
  vm.runInContext(read('public/js/deckview-history.js'), sandbox);
  const run = expr => vm.runInContext(expr, sandbox);
  const ref = name => run(`dbPlace(DB_MAIN_BOARD, ${JSON.stringify(name)})`);
  return {
    sandbox, run,
    /** Letting a handful go over the ghost pile: the mainboard's pile with no
     *  name on it yet. */
    drop: names => run(
      `cardCarryDrop(${JSON.stringify(names.map(ref))}, dbPlace(DB_MAIN_BOARD, DB_GHOST_PILE))`),
    /** And typing a name into the box that opens. */
    name: text => run(`dbCommitCatName({ value: ${JSON.stringify(text)} })`),
    cats:       () => sandbox.dbCats.map(c => c.name),
    categories: () => Object.fromEntries(sandbox.dbCards.map(c => [c.card_name, c.category])),
    naming:     () => run('_dbNamingCat'),
    selection:  () => [...sandbox.dbSelectedCards].map(r => run(`dbReadRef(${JSON.stringify(r)}).name`)),
    renders: () => sandbox.renders,
    saves:   () => sandbox.saves,
  };
}

const DECK = [
  { card_name: 'Sol Ring',   category: 'Ramp' },
  { card_name: 'Doom Blade', category: 'Removal' },
  { card_name: 'Forest',     category: 'Lands' },
];

test('a card dropped on the ghost pile makes a category with that card in it', () => {
  const mat = loadMat(DECK, ['Ramp', 'Removal', 'Lands']);
  assert.strictEqual(mat.drop(['Sol Ring']), true, 'the ghost did not take the card');
  assert.deepStrictEqual(mat.cats(), ['Ramp', 'Removal', 'Lands', 'New category'],
    'the new pile goes after the last one, which is where the ghost was standing');
  assert.strictEqual(mat.categories()['Sol Ring'], 'New category');
  assert.strictEqual(mat.renders(), 1, 'the mat is redrawn once');
  assert.strictEqual(mat.saves(), 1, 'and the deck saved once, as it is for any other move');
});

test('the new pile is named in place, and the name is the box that opens', () => {
  const mat = loadMat(DECK, ['Ramp']);
  mat.drop(['Sol Ring']);
  assert.strictEqual(mat.naming(), 'New category', 'nothing is waiting to be named');
  assert.strictEqual(mat.name('Fast mana'), true);
  assert.deepStrictEqual(mat.cats(), ['Ramp', 'Fast mana']);
  assert.strictEqual(mat.categories()['Sol Ring'], 'Fast mana',
    'the cards in it are filed under the name it was given');
  assert.strictEqual(mat.naming(), null, 'and the box is closed');
});

test('a pile that could not be named keeps the name it was given', () => {
  // Clicking away without typing, typing nothing, or typing the name of a pile
  // the deck already has. The cards have landed either way — cancelling a name
  // is not cancelling the drop — and renaming it again is the ⋯ menu's.
  for (const typed of ['', '   ', 'Ramp']) {
    const mat = loadMat(DECK, ['Ramp']);
    mat.drop(['Doom Blade']);
    assert.strictEqual(mat.name(typed), false);
    assert.deepStrictEqual(mat.cats(), ['Ramp', 'New category'], `"${typed}" took a pile away`);
    assert.strictEqual(mat.categories()['Doom Blade'], 'New category');
    assert.strictEqual(mat.naming(), null);
  }
});

test('committing a name twice renames nothing the second time', () => {
  // The render that closes the box takes the box out of the page, and a box
  // taken out of the page may blur on its way. The second commit is the same
  // press arriving twice, and it must not rename the pile it is standing on.
  const mat = loadMat(DECK, ['Ramp']);
  mat.drop(['Sol Ring']);
  mat.name('Fast mana');
  assert.strictEqual(mat.name('Fast mana'), false);
  assert.deepStrictEqual(mat.cats(), ['Ramp', 'Fast mana']);
});

test('a second ghost drop makes a second pile rather than colliding with the first', () => {
  const mat = loadMat(DECK, []);
  mat.drop(['Sol Ring']);
  mat.run('_dbNamingCat = null');
  mat.drop(['Doom Blade']);
  assert.deepStrictEqual(mat.cats(), ['New category', 'New category 2']);
  assert.deepStrictEqual(mat.categories(), {
    'Sol Ring': 'New category', 'Doom Blade': 'New category 2', 'Forest': 'Lands',
  });
});

test('a selection carried onto the ghost pile moves the whole selection into it', () => {
  const mat = loadMat(DECK, ['Ramp'], ['Sol Ring', 'Forest']);
  assert.strictEqual(mat.drop(['Sol Ring', 'Forest']), true);
  assert.deepStrictEqual(mat.categories(), {
    'Sol Ring': 'New category', 'Forest': 'New category', 'Doom Blade': 'Removal',
  });
  assert.strictEqual(mat.renders(), 1, 'one render for the whole handful');
  assert.strictEqual(mat.saves(), 1, 'and one autosave, not one per card');
  assert.deepStrictEqual(mat.selection(), [],
    'a selection carried somewhere is a selection spent, as it is for any other pile');
});

test('the new category is one the deck keeps, and one the Move to… list offers', () => {
  // dbCats is what the save writes and what the modal lists, so a pile made by
  // hand is a pile every other way of moving a card can aim at.
  const mat = loadMat(DECK, ['Ramp']);
  mat.drop(['Sol Ring']);
  mat.name('Fast mana');
  assert.ok(mat.sandbox.dbCats.some(c => c.name === 'Fast mana'));
  assert.strictEqual(
    mat.run("dbMoveCardsTo([dbPlace(DB_MAIN_BOARD, 'Doom Blade')], dbPlace(DB_MAIN_BOARD, 'Fast mana'))"),
    true, 'the pile cannot be moved into');
});

test('a deck that is not mine to edit grows no piles', () => {
  const mat = loadMat(DECK, ['Ramp']);
  mat.sandbox.dbDeck = { id: 'd1', playerId: 'someone-else' };
  assert.strictEqual(mat.drop(['Sol Ring']), false);
  assert.deepStrictEqual(mat.cats(), ['Ramp'], 'a category was made on somebody else’s deck');
  assert.strictEqual(mat.naming(), null);
  assert.strictEqual(mat.saves(), 0);
});

test('a drop that moves nothing leaves no empty pile standing', () => {
  // A card the deck does not have. The category has to go back with the move,
  // or the mat is left carrying a pile nobody asked for with a name box open
  // in it.
  const mat = loadMat(DECK, ['Ramp'], ['Sol Ring']);
  assert.strictEqual(mat.drop(['Black Lotus']), false);
  assert.deepStrictEqual(mat.cats(), ['Ramp']);
  assert.strictEqual(mat.naming(), null);
  assert.deepStrictEqual(mat.selection(), ['Sol Ring'], 'and the selection is exactly as it was');
  assert.strictEqual(mat.renders(), 0);
  assert.strictEqual(mat.saves(), 0);
});

test('the ghost is told apart from a pile by a name no pile can have', () => {
  // Every category name in this app is trimmed and non-empty, so the empty
  // string is the one value a drop target can carry that no real pile ever
  // will. If that ever stops being true, a card dropped on a category would
  // make a new one instead of moving into it.
  const mat = loadMat(DECK, ['Ramp']);
  assert.strictEqual(mat.run('DB_GHOST_PILE'), '');
  assert.strictEqual(mat.run("_dbAddCategoryByName('   ')"), false,
    'a category can be named nothing at all');
  assert.deepStrictEqual(mat.cats(), ['Ramp']);
});

test('the ghost is on the mat, and the mat is what it is drawn into', () => {
  // A drop target inside chrome that folds away is a drop target that cannot
  // be reached, so it is written into the deck's content rather than into the
  // strip above it — and it carries the one attribute js/carddrag.js reads.
  const render = read('public/js/deckview-render.js');
  assert.match(render,
    /function _dbGhostPileHtml\(\)[\s\S]*?data-drop="\$\{esc\(dbPlace\(DB_MAIN_BOARD, DB_GHOST_PILE\)\)\}"/,
    'the ghost is not a drop target');
  assert.match(render, /_dbContent\.innerHTML =[\s\S]*?_dbGhostPileHtml\(\)/,
    'the ghost is not drawn onto the mat');
  assert.ok(!MARKUP.includes('db-ghost'), 'the ghost is furniture in the markup, not mat');
});

test('the ghost is drawn at rest and lit while a card is carried', () => {
  // Permanent is the point: an affordance you can see with your hands empty is
  // one that can be found, where one that appears only mid-drag is one you
  // have to already know about.
  const rest = CSS.match(/^\.db-ghost \{[^}]*\}/ms);
  assert.ok(rest, 'the ghost has no appearance of its own');
  assert.match(rest[0], /border:[^;]*dashed/, 'an empty outline is what it is');
  assert.match(CSS, /\.card-carrying \.db-ghost \{[^}]*\}/,
    'nothing about it changes while a card is in hand');
  assert.match(CSS, /\.db-ghost\.card-drop-target/,
    'and it does not light up as the pile that would take the cards');
});

test('a card released over the mat itself still means cancel', () => {
  // The safety that makes carrying cards feel free, and this ticket must not
  // spend it: ui.md asked for empty-mat-creates-a-category and that is the
  // rejected design. The mat carries no data-drop of its own — only the piles
  // and the ghost do — so a point on it belongs to no zone.
  const render = read('public/js/deckview-render.js');
  const onTheMat = MARKUP.match(/<div id="dbDeckContent"[^>]*>/);
  assert.ok(onTheMat && !onTheMat[0].includes('data-drop'), 'the mat itself takes cards');
  const zones = render.match(/data-drop=/g) || [];
  assert.strictEqual(zones.length, 3,
    'something other than a pile, a board and the ghost takes a card');
});
