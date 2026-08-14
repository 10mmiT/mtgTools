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

test('a card in your own deck can be run in another copy', () => {
  // The count is a fact about this card in this deck, so it is asked for where
  // everything else about the card is asked for. Until now it could only be
  // changed in the list view, which left the two views that draw the card as a
  // picture with no way to say "and another one".
  const menu = menuFor({});
  assert.match(menu, /Add a copy/);
  assert.match(menu, /dbChangeQty\('main:Sol Ring',\s*1\)/);
});

test('a card the deck runs several of can be run in one fewer', () => {
  const menu = menuFor({ qty: 3 });
  assert.match(menu, /Remove a copy/);
  assert.match(menu, /dbChangeQty\('main:Sol Ring',\s*-1\)/);
});

test('a card the deck runs one of is not offered a copy to take away', () => {
  // At one copy there is no copy to remove — there is only the card, and the
  // entry at the foot of the menu already says that. The menu writes what
  // applies and nothing else, the way it leaves out "Make commander" on the
  // commander and "Add as partner" where there is no room for one.
  const menu = menuFor({ qty: 1 });
  assert.doesNotMatch(menu, /Remove a copy/);
  assert.match(menu, /× Remove</, 'and the card itself can still be taken off the mat');
});

test('a commander is one card, and is offered no copies of itself', () => {
  // The board holds the card the deck is built around, and there is no second
  // copy of that in a deck: a Commander deck is singleton where it matters
  // most. Both entries go, not just the one that would add.
  const menu = menuFor({ isCommander: true, qty: 2 });
  assert.doesNotMatch(menu, /Add a copy/);
  assert.doesNotMatch(menu, /Remove a copy/);
});

test('somebody else’s deck is read, not counted up or down', () => {
  const menu = menuFor({ canEdit: false, qty: 4 });
  assert.doesNotMatch(menu, /dbChangeQty/);
  assert.match(menu, /Inspect/, 'anybody may still look the card up');
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
