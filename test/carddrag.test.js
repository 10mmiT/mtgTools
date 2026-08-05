/* Carrying a card: the decisions inside it.
 *
 * Where a card following the pointer has got to, how far it leans from how far
 * behind it is, and which pile would receive it, are all functions of a
 * position and some boxes, and they are written as functions of exactly that
 * so they can be asserted here rather than eyeballed in a browser. So is what
 * a drop does to the deck, which is the one thing in this ticket that can
 * break something that already worked. What is not asserted is what a card in
 * hand looks like — that is the eye's, for the reason the redesign already
 * recorded.
 *
 * The shipped files are run against stub browser globals, the way
 * test/cardmove.test.js runs the mat's movement, so these assert on the code
 * the browser is served rather than on a copy of it.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** The carry hangs its listeners as it loads, so it needs somewhere to hang
 *  them. js/cardlift.js is loaded beside it because the lean is the lift's
 *  derivation — the same clamped fraction and the same bound — and the browser
 *  serves both, so a test that stubbed cardPointerOffset() would be asserting
 *  a lean the app does not have. */
function loadCardDrag() {
  const sandbox = {
    document: { addEventListener() {}, removeEventListener() {} },
    window:   { addEventListener() {}, scrollX: 0, scrollY: 0 },
    requestAnimationFrame: () => 0,
    cardMotionOn: () => true,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/cardlift.js'), sandbox);
  vm.runInContext(read('public/js/carddrag.js'), sandbox);
  const evaluate = expr => vm.runInContext(expr, sandbox);
  const answer   = expr => JSON.parse(evaluate(`JSON.stringify(${expr})`));
  return {
    evaluate, answer,
    start:   evaluate('CARD_CARRY_START'),
    ease:    evaluate('CARD_CARRY_EASE'),
    arrived: evaluate('CARD_CARRY_ARRIVED'),
    lag:     evaluate('CARD_CARRY_LAG'),
    maxLean: evaluate('CARD_TILT_MAX'),
    /** One frame of following the pointer. */
    step: (at, to, ease = evaluate('CARD_CARRY_EASE')) =>
      answer(`cardCarryStep(${JSON.stringify(at)}, ${JSON.stringify(to)}, ${ease})`),
    /** How far the card leans, being this far behind where it is going. */
    lean: behind => evaluate(`cardCarryLean(${behind})`),
    /** Which pile would take a card released here. */
    target: (x, y, zones) => evaluate(`cardCarryTarget(${x}, ${y}, ${JSON.stringify(zones)})`),
  };
}

const app = loadCardDrag();

/** A pile on the mat, as a box on the page. */
const pile = (key, left, top, width = 174, height = 400) =>
  ({ key, left, top, right: left + width, bottom: top + height });

/** Two piles side by side with a gutter between them, which is where the mat
 *  shows through. */
const MAT = [pile('Creatures', 100, 200), pile('Lands', 300, 200)];

// ── Following the pointer ─────────────────────────────────────────────
// The lag, which is the whole of the weight: a card is behind the hand that is
// carrying it, and catches up when the hand stops.

test('a carried card moves towards the pointer without reaching it', () => {
  const at = app.step({ x: 0, y: 0 }, { x: 100, y: 200 });
  assert.ok(at.x > 0 && at.x < 100, `${at.x} is not between the card and the hand`);
  assert.ok(at.y > 0 && at.y < 200, `${at.y} is not between the card and the hand`);
  assert.strictEqual(at.x / 100, at.y / 200, 'and it covers as much of each axis, so it does not curve');
});

test('a card never overshoots the hand, however far behind it starts', () => {
  // The ease is a fraction of what is left rather than a speed, which is what
  // makes this true by construction — and true of a pointer that has just
  // jumped the width of the screen as much as of one that crept a pixel.
  for (const gap of [1, 2, 5, 40, 300, 4000]) {
    for (const ease of [0, app.ease, 0.5, 1]) {
      const at = app.step({ x: 0, y: 0 }, { x: gap, y: -gap }, ease);
      assert.ok(at.x >= 0 && at.x <= gap, `${at.x} is past a hand ${gap} away`);
      assert.ok(at.y <= 0 && at.y >= -gap, `${at.y} is past a hand ${gap} away`);
    }
  }
});

test('a card catches up with a hand that has stopped', () => {
  // The back half of the lag: the pointer stops and the card arrives a few
  // frames later, which is what makes it read as something with mass rather
  // than something glued to the cursor.
  const to = { x: 240, y: -120 };
  let at = { x: 0, y: 0 }, frames = 0;
  while ((at.x !== to.x || at.y !== to.y) && frames < 200) { at = app.step(at, to); frames++; }
  assert.deepStrictEqual(at, to, `after ${frames} frames the card was still on its way`);
  assert.ok(frames < 60, `arriving took ${frames} frames — a second of a card drifting after the hand`);
});

test('the last pixel is snapped rather than approached forever', () => {
  // Otherwise a card that has visibly arrived is still being written to on
  // every frame, in fractions of a pixel nobody can see.
  assert.ok(app.arrived > 0 && app.arrived <= 2, `${app.arrived}px is a gap, not an arrival`);
  assert.deepStrictEqual(app.step({ x: 0, y: 0 }, { x: app.arrived, y: -app.arrived }),
    { x: app.arrived, y: -app.arrived });
});

test('with no lag at all the card is exactly where the pointer is', () => {
  // Which is what cards' motion being off means here: dragging still works,
  // and the card neither lags nor leans. An ease of 1 is the whole of that.
  assert.deepStrictEqual(app.step({ x: 0, y: 0 }, { x: 640, y: -480 }, 1), { x: 640, y: -480 });
  assert.strictEqual(app.lean(0), 0, 'and a card that is never behind never leans');
});

test('a card already under the pointer stays there', () => {
  assert.deepStrictEqual(app.step({ x: 12, y: 12 }, { x: 12, y: 12 }), { x: 12, y: 12 });
});

// ── The lean ──────────────────────────────────────────────────────────

test('a card that is not behind anything hangs square', () => {
  assert.strictEqual(app.lean(0), 0,
    'a card under the pointer has no direction to lean in, and is given none');
});

test('a card leans the way it is being pulled', () => {
  assert.ok(app.lean(80) > 0,  'hurried to the right, it swings that way');
  assert.ok(app.lean(-80) < 0, 'and to the left, the other');
});

test('the lean is bounded by the same angle a card may lean anywhere', () => {
  // The lift's bound, deliberately: one number in the app for how far a card
  // may lean, whether it is being pointed at or carried.
  for (const behind of [0, 10, app.lag, app.lag * 4, 100000, -100000]) {
    assert.ok(Math.abs(app.lean(behind)) <= app.maxLean,
      `${behind}px behind leaned ${app.lean(behind)}°, past the ${app.maxLean}° a card may lean`);
  }
  assert.strictEqual(app.lean(app.lag), app.maxLean,
    'and a card a full lag behind leans as far as it may');
});

test('the lean is proportional to how far behind the card is', () => {
  assert.strictEqual(app.lean(app.lag / 2), app.maxLean / 2);
  assert.ok(app.lean(20) < app.lean(60) && app.lean(60) < app.lean(app.lag),
    'a hand moving faster drags the card further round');
});

test('the same card behind by the same distance leans the same, every time', () => {
  // Read every frame of a carry; a card that answered differently on the
  // second reading would shiver in the hand.
  const first = app.lean(37);
  for (let i = 0; i < 5; i++) assert.strictEqual(app.lean(37), first);
});

// ── Which pile would take it ──────────────────────────────────────────

test('a card released over a pile goes to that pile', () => {
  assert.strictEqual(app.target(150, 300, MAT), 'Creatures');
  assert.strictEqual(app.target(350, 300, MAT), 'Lands');
});

test('a card released over the mat between two piles goes nowhere', () => {
  // The gutter is not a pile, and a card let go over it has been let go over
  // nothing: it goes back where it came from and the deck does not change.
  assert.strictEqual(app.target(280, 300, MAT), null, 'the gutter between the piles');
  assert.strictEqual(app.target(150, 100, MAT), null, 'the mat above them');
  assert.strictEqual(app.target(150, 700, MAT), null, 'and the mat below');
  assert.strictEqual(app.target(-4000, -4000, MAT), null, 'and the page beyond the mat entirely');
});

test('the edges belong to the pile', () => {
  // A pile's bounds are where the pile ends. A point on the boundary is on the
  // pile rather than in the gap beside it — and the corner is on it too, which
  // is where two off-by-ones would meet.
  const [creatures] = MAT;
  assert.strictEqual(app.target(creatures.left, creatures.top, MAT), 'Creatures');
  assert.strictEqual(app.target(creatures.right, creatures.bottom, MAT), 'Creatures');
  assert.strictEqual(app.target(creatures.right + 1, creatures.top, MAT), null,
    'and a pixel past the edge is past the pile');
});

test('a mat with no piles on it takes nothing', () => {
  // An empty deck, or a deck that is not mine to edit: no pile carries a
  // data-drop, so there is nowhere to put a card down.
  for (const zones of [[], null, undefined]) {
    assert.strictEqual(app.target(150, 300, zones), null);
  }
});

test('where two piles overlap, the one on top takes the card', () => {
  // Piles are laid out side by side and do not overlap, but a fanned pile is
  // taller than the column it stands in and the mat is a wrapping row of them.
  // Later is what the page paints on top and what the eye calls the pile the
  // card is over.
  const overlapping = [pile('Ramp', 100, 200), pile('Removal', 150, 250)];
  assert.strictEqual(app.target(200, 300, overlapping), 'Removal');
  assert.strictEqual(app.target(120, 220, overlapping), 'Ramp', 'and only where they overlap');
});

// ── What a drop does to the deck ───────────────────────────────────────
// The one thing here that can break something that already worked: the deck's
// categories, and the autosave that follows them. The move logic is the edit
// module's, called by the carry rather than reimplemented in it, so this is
// asserted where it lives.

/** The Deck Builder's editing module, over a deck. The render is stubbed, since
 *  what a mat looks like is not this file's question — but the autosave is the
 *  module's own _dbScheduleSave(), and what is counted is the deferred write it
 *  actually schedules, so "the autosave fires as it does today" is asserted
 *  against the path that saves rather than against a stand-in for it. */
function loadDeck(cards) {
  const sandbox = {
    dbDeck:  { id: 'd1', playerId: 'p1' },
    dbCards: cards.map(c => ({ qty: 1, ...c })),
    dbSaveTimer: 0,
    isMyPlayer: id => id === 'p1',
    document: { getElementById: () => null },
    clearTimeout() {},
    renders: 0, saves: 0,
  };
  sandbox.dbRender   = () => { sandbox.renders++; };
  sandbox.setTimeout = () => { sandbox.saves++; return 1; };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/deckview-edit.js'), sandbox);
  return {
    sandbox,
    /** A card carried onto a pile, as cardCarryDrop() spends it. */
    move: (names, cat) => vm.runInContext(
      `dbMoveCardsTo(${JSON.stringify(names)}, ${JSON.stringify(cat)})`, sandbox),
    categories: () => Object.fromEntries(sandbox.dbCards.map(c => [c.card_name, c.category])),
    renders: () => sandbox.renders,
    saves:   () => sandbox.saves,
  };
}

const DECK = [
  { card_name: 'Sol Ring',    category: 'Ramp' },
  { card_name: 'Doom Blade',  category: 'Removal' },
  { card_name: 'Forest',      category: 'Lands' },
];

test('a card dropped on a pile moves into it, and only it', () => {
  const deck = loadDeck(DECK);
  assert.strictEqual(deck.move(['Sol Ring'], 'Lands'), true, 'the drop reports that it took the card');
  assert.deepStrictEqual(deck.categories(), {
    'Sol Ring': 'Lands', 'Doom Blade': 'Removal', 'Forest': 'Lands',
  });
  assert.strictEqual(deck.renders(), 1, 'the mat is redrawn once');
  assert.strictEqual(deck.saves(), 1, 'and the deck is saved once, as it is for a move from the modal');
});

test('a card dropped on the pile it is already in does nothing at all', () => {
  // Not "moves it to where it is": nothing is written, the mat is not redrawn
  // and the deck is not saved, so a card put back down where it was picked up
  // is not a change to the deck. The carry needs the false to know the card is
  // still in its hand and has to travel home.
  const deck = loadDeck(DECK);
  assert.strictEqual(deck.move(['Sol Ring'], 'Ramp'), false);
  assert.deepStrictEqual(deck.categories(), {
    'Sol Ring': 'Ramp', 'Doom Blade': 'Removal', 'Forest': 'Lands',
  });
  assert.strictEqual(deck.renders(), 0);
  assert.strictEqual(deck.saves(), 0, 'and nothing is saved for a deck that did not change');
});

test('a deck that is not mine to edit takes nothing', () => {
  const deck = loadDeck(DECK);
  deck.sandbox.dbDeck = { id: 'd1', playerId: 'someone-else' };
  assert.strictEqual(deck.move(['Sol Ring'], 'Lands'), false);
  assert.deepStrictEqual(deck.categories(), {
    'Sol Ring': 'Ramp', 'Doom Blade': 'Removal', 'Forest': 'Lands',
  });
  assert.strictEqual(deck.saves(), 0);
});

test('a card the deck does not have cannot be moved into it', () => {
  const deck = loadDeck(DECK);
  assert.strictEqual(deck.move(['Black Lotus'], 'Ramp'), false);
  assert.strictEqual(deck.renders(), 0);
  assert.strictEqual(deck.saves(), 0);
});

test('a handful of cards moves as one change to the deck', () => {
  // The bulk move the modal already does, and the shape a fan of carried cards
  // will drop through: several cards, one render, one save.
  const deck = loadDeck(DECK);
  assert.strictEqual(deck.move(['Sol Ring', 'Doom Blade', 'Forest'], 'Ramp'), true);
  assert.deepStrictEqual(deck.categories(), {
    'Sol Ring': 'Ramp', 'Doom Blade': 'Ramp', 'Forest': 'Ramp',
  });
  assert.strictEqual(deck.renders(), 1);
  assert.strictEqual(deck.saves(), 1, 'one autosave for the move, not one per card');
});

test('the cards in a handful that were already there do not stop the rest', () => {
  const deck = loadDeck(DECK);
  assert.strictEqual(deck.move(['Sol Ring', 'Forest'], 'Ramp'), true);
  assert.deepStrictEqual(deck.categories(), {
    'Sol Ring': 'Ramp', 'Doom Blade': 'Removal', 'Forest': 'Ramp',
  });
  assert.strictEqual(deck.saves(), 1);
});

// ── The gate on the gesture ───────────────────────────────────────────

test('a press becomes a carry only after the hand has moved', () => {
  // A hand is never perfectly still while it clicks, and a click on a card
  // selects it. The threshold is what keeps selecting a card from carrying it
  // a pixel and back.
  assert.ok(app.start >= 2 && app.start <= 8,
    `${app.start}px is either a hand that cannot click or a hand that cannot drag`);
});
