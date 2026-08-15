/* What can be done to a card: the decisions inside the card menu.
 *
 * Three of them are functions of their inputs and are written as exactly that
 * so they can be asserted here rather than eyeballed in a browser: which card a
 * point on the mat is on, where a menu asked for at a point on the screen is
 * drawn, and which entries the menu holds. How the menu *looks* is still the
 * eye's, for the reason the redesign already recorded; what is on it is not a
 * matter of taste — it is what may be done to this card, and it is asserted.
 *
 * The shipped public/js/deckview-render.js is run against stub browser
 * globals, the way test/carddrag.test.js runs the carry, so these assert on
 * the code the browser is served rather than on a copy of it.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** The Deck Builder's render module. Nothing in it touches the document as it
 *  loads; what it needs is somewhere for the functions to live. */
function loadRender() {
  const sandbox = {
    document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
    window:   { innerWidth: 1440, innerHeight: 900, addEventListener() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/deckview-render.js'), sandbox);
  const answer = expr => JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, sandbox));
  return {
    /** Where a menu of this size, asked for at this point, is drawn. */
    place: (point, menu, view) => answer(
      `dbMenuPlacement(${JSON.stringify(point)}, ${JSON.stringify(menu)}, ${JSON.stringify(view)})`),
    /** The entries the menu holds for a card in this situation. The ref and the
     *  name arrive already written for a script attribute, the way the menu's
     *  own caller hands them over — the escaping is the door's job and not
     *  this function's, so nothing here has to be stubbed to ask what is on
     *  the menu. */
    items: card => vm.runInContext(`dbCardMenuItems(${JSON.stringify(card)})`, sandbox),
    /** Which card an element on the mat belongs to. */
    cardAt: moves => vm.runInContext(
      `_dbCardAt({ closest: sel => ${JSON.stringify(moves)} === null ? null
         : (${JSON.stringify(moves)}.startsWith('card:') ? { dataset: { moves: ${JSON.stringify(moves)} } } : null) })`,
      sandbox),
  };
}

const app  = loadRender();
const MENU = { width: 170, height: 120 };
const VIEW = { width: 1440, height: 900 };

// ── Where the menu opens ──────────────────────────────────────────────

test('a menu opens at the card it was asked about', () => {
  // Down and to the right of the pointer, which is where a menu comes out of
  // the thing that was asked — and where every other menu on this page opens.
  assert.deepStrictEqual(app.place({ x: 300, y: 400 }, MENU, VIEW), { left: 300, top: 400 });
});

test('a menu asked for near the bottom opens upwards instead', () => {
  // Not clamped to the edge: the pointer stays on the corner of the menu, and
  // the menu is the other way up. Clamping would put the items under the hand.
  const at = app.place({ x: 300, y: 860 }, MENU, VIEW);
  assert.strictEqual(at.top, 860 - MENU.height);
  assert.strictEqual(at.left, 300, 'and the side it fits on is untouched');
});

test('and one near the right edge opens leftwards', () => {
  const at = app.place({ x: 1400, y: 400 }, MENU, VIEW);
  assert.strictEqual(at.left, 1400 - MENU.width);
  assert.strictEqual(at.top, 400);
});

test('a card in the far corner gets a menu that is still on the screen', () => {
  // Both flips at once, which is the corner where two off-by-ones would meet.
  // A pointer two pixels from the edge flips *and* is held off the edge, so
  // the menu comes to rest against the corner rather than bleeding into it.
  const at = app.place({ x: 1438, y: 898 }, MENU, VIEW);
  assert.ok(at.left < 1438 && at.top < 898, 'it opened up and back rather than down and out');
  assert.deepStrictEqual(at, { left: VIEW.width - MENU.width - 4, top: VIEW.height - MENU.height - 4 });
});

test('a menu is never drawn off any edge, wherever it is asked for', () => {
  for (const x of [-50, 0, 1, 700, 1439, 1440, 3000]) {
    for (const y of [-50, 0, 1, 450, 899, 900, 3000]) {
      const at = app.place({ x, y }, MENU, VIEW);
      assert.ok(at.left >= 0 && at.left + MENU.width <= VIEW.width,
        `asked at ${x},${y} it was drawn from ${at.left} to ${at.left + MENU.width}`);
      assert.ok(at.top >= 0 && at.top + MENU.height <= VIEW.height,
        `asked at ${x},${y} it was drawn from ${at.top} to ${at.top + MENU.height}`);
    }
  }
});

test('a menu with nowhere to fit is put in the corner rather than off the page', () => {
  // A phone in landscape, a menu taller than the window: there is no placement
  // that shows all of it, and the top-left is the one that shows the most.
  const at = app.place({ x: 200, y: 200 }, { width: 400, height: 700 }, { width: 390, height: 300 });
  assert.ok(at.left >= 0 && at.top >= 0, `${at.left},${at.top} is off the page`);
});

// ── What is on the menu ───────────────────────────────────────────────
// A card in the ordinary case: one copy of it, lying in a pile, in a deck of
// your own. Each test below says which single fact about the card it changes.
const A_CARD = {
  ref: 'main:Sol Ring', name: 'Sol Ring',
  canEdit: true, isCommander: false, canPartner: false, qty: 1,
};
const menuFor = over => app.items({ ...A_CARD, ...over });

test('the count is one line with the number between the two presses', () => {
  // How many the deck runs of a card is a number you push up and down, not two
  // verbs to read: one row — − ×3 + — where a pair of entries would have been.
  // Until now the count could only be changed in the list view, which left the
  // two views that draw a card as a picture with no way to say "and another
  // one".
  const menu = menuFor({ qty: 3 });
  assert.match(menu, /dbStepQty\('main:Sol Ring',\s*-1\)/, 'a press that takes one away');
  assert.match(menu, /×3/, 'the number it is at');
  assert.match(menu, /dbStepQty\('main:Sol Ring',\s*1\)/, 'and a press that adds one');
});

test('a press on the stepper does not put the menu away', () => {
  // The reason it is a stepper: a deck wants four of a card, and four presses
  // should be four presses rather than four right-clicks. Every other entry
  // here closes the menu on the way out, because every other entry is done
  // when it has happened.
  const presses = menuFor({ qty: 3 }).match(/onclick="[^"]*dbStepQty[^"]*"/g) || [];
  assert.strictEqual(presses.length, 2, 'the stepper is two presses');
  for (const press of presses) {
    assert.doesNotMatch(press, /dbCloseCardMenu/, `${press} closes the menu`);
  }
});

test('the deck’s only copy is still a press away from going', () => {
  // No special case in the markup: at one copy the stepper reads − ×1 +, and
  // what the press does about there being no copy left to take is
  // dbStepQty()'s, asserted below where the deck can be seen to change.
  const menu = menuFor({ qty: 1 });
  assert.match(menu, /dbStepQty\('main:Sol Ring',\s*-1\)/);
  assert.match(menu, /×1/);
});

test('a commander is one card, and is offered no count at all', () => {
  // The board holds the card the deck is built around, and there is no second
  // copy of that in a deck: a Commander deck is singleton where it matters
  // most.
  assert.doesNotMatch(menuFor({ isCommander: true, qty: 2 }), /dbStepQty/);
});

test('somebody else’s deck is read, not counted up or down', () => {
  const menu = menuFor({ canEdit: false, qty: 4 });
  assert.doesNotMatch(menu, /dbStepQty/);
  assert.match(menu, /Inspect/, 'anybody may still look the card up');
});

// ── What a press on the stepper does ──────────────────────────────────
// The entries above are markup; this is the deck changing. The deck-builder
// modules are loaded over a deck the way test/deckcommander.test.js loads
// them, with the drawing surface and the network stubbed, so what is asserted
// is the shipped dbStepQty() against the shipped dbCards.

/** The tab, over a deck of three cards, with the card menu open on one of
 *  them. The menu is a real element as far as the code is concerned: it
 *  remembers whether it is open and what was written into it. */
function loadTabWithMenu(cards) {
  const count = { textContent: '' };
  const menu = {
    innerHTML: '', style: {},
    open: false,
    writes: 0,
    set html(v) { menu.innerHTML = v; },
    classList: {
      add(c)    { if (c === 'open') menu.open = true; },
      remove(c) { if (c === 'open') menu.open = false; },
      contains(c) { return c === 'open' && menu.open; },
    },
    /* The one part of an open menu that a press changes. */
    querySelector: sel => (sel.includes('db-step-count') ? count : null),
    getBoundingClientRect: () => ({ width: 170, height: 120, left: 0, top: 0 }),
  };
  menu.count = count;
  const mat = { innerHTML: '', classList: { toggle() {} } };
  const els = {};
  const el = id => (els[id] ||= {
    innerHTML: '', textContent: '', title: '', value: '', style: {},
    setAttribute() {}, classList: { toggle() {}, add() {}, remove() {} },
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }),
  });

  const sandbox = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      addEventListener() {}, querySelectorAll: () => [], createElement: () => el('made'),
      getElementById: id => (id === 'dbCardMenu' ? menu : id === 'dbDeckContent' ? mat : el(id)),
      body: { appendChild() {}, style: {} },
      scrollingElement: { scrollTop: 0 }, documentElement: { scrollTop: 0 },
    },
    window: { addEventListener() {}, innerWidth: 1440, innerHeight: 900 },
    isMyPlayer: id => id === 'p1',
    confirm: () => true, alert: () => {}, clearTimeout() {},
    setTimeout: fn => 1,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    esc: s => String(s), jsAttr: s => String(s),
    renderMana: () => '', renderPrice: () => '', sfCardOwnership: () => '',
    openCardByName() {},
    animateCardMove: (_el, paint) => paint(),
    myPlayerId: () => 'p1', colOwner: () => null, playerColor: () => '',
    scryfallMetaCache: new Map(), scryfallArtCache: new Map(),
    renderPlayers() {}, savePlayerDecks: async () => {}, ensureScryfallImages: async () => {},
    state: { collections: [], players: [{ id: 'p1', name: 'Someone', decks: [{ id: 'd1', name: 'A deck' }] }] },
  };
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  for (const file of ['sortui.js', 'cardstack.js', 'deckview-boards.js',
                      'deckview-core.js', 'deckview-render.js', 'deckview-edit.js',
                      'deckview-panels.js', 'deckview-history.js', 'deckview-owned.js',
                      'deckview-totals.js', 'deckview-legality.js', 'deckview-mana.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run = expr => vm.runInContext(expr, sandbox);
  run(`dbDeck = { id: 'd1', playerId: 'p1', name: 'A deck', commander: '' }`);
  run(`dbCards = ${JSON.stringify(cards.map((c, i) => ({ qty: 1, board: 'main', position: i, ...c })))}`);
  run(`dbCats = [{ name: 'Ramp', position: 0 }]`);
  run(`dbCardData = new Map()`);

  return {
    run, menu,
    open: name => run(`dbOpenCardMenu(100, 100, dbPlace('main', ${JSON.stringify(name)}))`),
    press: (name, delta) => run(`dbStepQty(dbPlace('main', ${JSON.stringify(name)}), ${delta})`),
    qtyOf: name => JSON.parse(run(
      `JSON.stringify(dbCards.find(c => c.card_name === ${JSON.stringify(name)})?.qty ?? null)`)),
  };
}

const DECK = [
  { card_name: 'Sol Ring',   category: 'Ramp' },
  { card_name: 'Arcane Signet', category: 'Ramp', qty: 3 },
];

test('a press adds a copy and leaves the menu standing', () => {
  const tab = loadTabWithMenu(DECK);
  tab.open('Sol Ring');
  tab.press('Sol Ring', 1);
  assert.strictEqual(tab.qtyOf('Sol Ring'), 2, 'the deck runs two of it now');
  assert.ok(tab.menu.open, 'and the menu is still there to press again');
});

test('the menu says the number it has just been pushed to', () => {
  const tab = loadTabWithMenu(DECK);
  tab.open('Sol Ring');
  tab.press('Sol Ring', 1);
  assert.strictEqual(tab.menu.count.textContent, '×2');
  tab.press('Sol Ring', 1);
  assert.strictEqual(tab.menu.count.textContent, '×3');
});

test('a press writes the number and nothing else', () => {
  /* The button that was pressed has to still be in the menu when the press
   * finishes. A click that lands on a card menu bubbles on to the document,
   * where the deck builder asks whether it happened inside the menu in order
   * to decide whether to put the menu away — and a button that has been
   * replaced in the meantime is attached to nothing, so that question answers
   * "outside", and the menu closes under the hand that was pressing it. Only
   * the number changes, so only the number is written. */
  const tab = loadTabWithMenu(DECK);
  tab.open('Sol Ring');
  const asOpened = tab.menu.innerHTML;
  tab.press('Sol Ring', 1);
  assert.strictEqual(tab.menu.innerHTML, asOpened,
    'the menu was rewritten, which takes the pressed button out of the page');
});

test('a press down leaves the rest of the copies where they were', () => {
  const tab = loadTabWithMenu(DECK);
  tab.open('Arcane Signet');
  tab.press('Arcane Signet', -1);
  assert.strictEqual(tab.qtyOf('Arcane Signet'), 2);
  assert.ok(tab.menu.open);
});

test('taking away the last copy takes the card off the mat', () => {
  // Zero copies of a card is not a card the deck runs none of — it is a card
  // the deck does not have. And with the card gone there is nothing left for
  // the menu to be about, so it goes with it.
  const tab = loadTabWithMenu(DECK);
  tab.open('Sol Ring');
  tab.press('Sol Ring', -1);
  assert.strictEqual(tab.qtyOf('Sol Ring'), null, 'the card is off the mat');
  assert.ok(!tab.menu.open, 'and the menu that was about it has gone');
});

test('each press is half the menu wide, with the count between them', () => {
  // A stepper that is pressed four times in a row has to be easy to hit four
  // times: the two presses take the width the entries around them take, rather
  // than being the 18px pair the list view sets into a dense row. That also
  // settles the phone, where every button is already 44 tall and what was
  // missing was the width.
  const css = read('public/css/tabs.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = sel => (css.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
  assert.match(rule('.db-menu-step'), /display:\s*flex/, 'the row is a row');
  assert.match(rule('.db-step-btn'), /flex:\s*1/, 'and the presses share what it leaves');
  assert.match(rule('.db-step-count'), /text-align:\s*center/, 'the number sits between them');
});

// ── Which card was asked about ────────────────────────────────────────

test('a card on the mat answers with its name', () => {
  // The mat already says what each thing on it is, for js/cardmove.js; the
  // menu asks the same question rather than a second attribute saying it again.
  assert.strictEqual(app.cardAt('card:Sol Ring'), 'Sol Ring');
});

test('a card whose name has a colon in it keeps all of it', () => {
  assert.strictEqual(app.cardAt('card:Kongming, "Sleeping Dragon"'), 'Kongming, "Sleeping Dragon"');
  assert.strictEqual(app.cardAt('card:Ratonhnhaké:ton'), 'Ratonhnhaké:ton',
    'only the first "card:" is the kind; the rest is the name');
});

test('a stack is not a card, and neither is the mat around it', () => {
  // A settled stack stands for a whole category and has its own control — the
  // arrow that spreads it. Nothing here has anything to say about one.
  assert.strictEqual(app.cardAt('stack:Creatures'), null);
  assert.strictEqual(app.cardAt(null), null, 'and a point on the mat itself is on no card');
});
