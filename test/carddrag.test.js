/* Carrying a card, and carrying a handful of them: the decisions inside it.
 *
 * Where a card following the pointer has got to, how far it leans from how far
 * behind it is, which pile would receive it, where each card of a handful lies
 * in the fan and how far that is from where it was lying, are all functions of
 * a position and some boxes, and they are written as functions of exactly that
 * so they can be asserted here rather than eyeballed in a browser. So is what
 * a drop does to the deck and to the selection, which is the one thing in
 * these two tickets that can break something that already worked. What is not
 * asserted is what a card in hand looks like — that is the eye's, for the
 * reason the redesign already recorded.
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
    maxTurn: evaluate('CARD_FAN_TURN'),
    /** One frame of following the pointer. */
    step: (at, to, ease = evaluate('CARD_CARRY_EASE')) =>
      answer(`cardCarryStep(${JSON.stringify(at)}, ${JSON.stringify(to)}, ${ease})`),
    /** How far the card leans, being this far behind where it is going. */
    lean: behind => evaluate(`cardCarryLean(${behind})`),
    /** Which pile would take a card released here. */
    target: (x, y, zones) => evaluate(`cardCarryTarget(${x}, ${y}, ${JSON.stringify(zones)})`),
    /** Where the index-th card of a handful lies, relative to the one in hand. */
    fan: (index, count, { width, height }) =>
      answer(`cardCarryFan(${index}, ${count}, ${width}, ${height})`),
    /** How far that card has to be moved to get there. */
    aim: (hand, origin, fan) => answer(
      `cardCarryAim(${JSON.stringify(hand)}, ${JSON.stringify(origin)}, ${JSON.stringify(fan)})`),
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

// ── The shape of a handful ────────────────────────────────────────────
// Several cards carried at once are carried as a handful: the card the hand
// closed on under the pointer, the rest fanned out behind it.

/** A card as the grid and the piles draw one, and a card as the list view
 *  draws one: the same card, one of them as wide as the mat. */
const CARD = { width: 150, height: 210 };
const ROW  = { width: 900, height: 34 };

test('the card in the hand is where the hand is, whatever it is holding', () => {
  // Card 0 is the one that was picked up. It stays exactly where it was
  // grabbed — square, under the pointer — and the fan is what is behind it.
  for (const count of [1, 2, 3, 20]) {
    assert.deepStrictEqual(app.fan(0, count, CARD), { x: 0, y: 0, turn: 0 },
      `a handful of ${count} moved the card being carried`);
  }
});

test('a card carried on its own is not a fan', () => {
  assert.deepStrictEqual(app.fan(0, 1, CARD), { x: 0, y: 0, turn: 0 });
});

test('each card further back is further out and further round', () => {
  const fan = [0, 1, 2, 3, 4].map(i => app.fan(i, 5, CARD));
  for (let i = 1; i < fan.length; i++) {
    assert.ok(fan[i].x > fan[i - 1].x,    `card ${i} is not further across than card ${i - 1}`);
    assert.ok(fan[i].y < fan[i - 1].y,    `card ${i} is not further up than card ${i - 1}`);
    assert.ok(fan[i].turn > fan[i - 1].turn, `card ${i} is not turned further than card ${i - 1}`);
  }
});

test('a hand holds what it holds: twenty cards spread no further than three', () => {
  // The spread is the whole fan rather than the step between two cards, so a
  // bigger handful is a denser one and not a wider one. Otherwise picking up a
  // selection of forty would throw a fan the width of the mat.
  const three  = app.fan(2, 3, CARD);
  const twenty = app.fan(19, 20, CARD);
  assert.deepStrictEqual(twenty, three);
  assert.ok(three.x < CARD.width, 'and the whole handful is narrower than one card is wide');
});

test('the fan is a fraction of the card, so it follows the size control', () => {
  // Cards are drawn at whatever width the tab's slider says. A fan measured in
  // pixels would be a wide spread of small cards and a tight bunch of big ones.
  const small = app.fan(1, 2, { width: 100, height: 140 });
  const big   = app.fan(1, 2, { width: 200, height: 280 });
  assert.strictEqual(big.x, small.x * 2);
  assert.strictEqual(big.y, small.y * 2);
  assert.strictEqual(big.turn, small.turn, 'and the angle is the angle: it does not scale');
});

test('a handful of list rows is a stack of papers, not a fan', () => {
  // A row is a card as wide as the mat. Spread across *that* the cards would
  // be thrown down a table, and turned by the full angle the far end of a row
  // would swing off the page — so the spread is the narrow way across the
  // thing being carried, and the turn is bounded by how card-shaped it is.
  const row  = app.fan(1, 2, ROW);
  const card = app.fan(1, 2, CARD);
  assert.ok(row.x < ROW.height, `${row.x}px is a spread of rows, not a stack of them`);
  assert.ok(row.turn > 0 && row.turn < card.turn / 10,
    `a row turned ${row.turn}°, where a card turns ${card.turn}°`);
});

test('a fan never turns further than a fan may', () => {
  for (const shape of [CARD, ROW, { width: 60, height: 400 }]) {
    for (const [i, n] of [[1, 2], [3, 4], [99, 100]]) {
      const { turn } = app.fan(i, n, shape);
      assert.ok(turn >= 0 && turn <= app.maxTurn,
        `card ${i} of ${n} turned ${turn}°, past the ${app.maxTurn}° a handful spreads`);
    }
  }
});

test('a handful of things with no size is still a handful', () => {
  // A card whose image has not loaded measures nothing. It is carried like the
  // rest of them rather than to some undefined place off the page.
  const { x, y, turn } = app.fan(1, 2, { width: 0, height: 0 });
  for (const n of [x, y, turn]) assert.ok(Number.isFinite(n), `${n} is not a place`);
});

// ── Where that puts each card ─────────────────────────────────────────
// Every card in a handful is aimed at the same hand and given a different
// number to get there, because what a carry writes is a displacement: a card
// keeps its own place in the layout and is drawn out of it.

test('cards from anywhere on the mat are aimed at the same hand', () => {
  const hand = { x: 700, y: 400 };
  const fan  = { x: 12, y: -4 };
  for (const origin of [{ x: 20, y: 30 }, { x: 690, y: 380 }, { x: 1400, y: 2000 }]) {
    const to = app.aim(hand, origin, fan);
    assert.deepStrictEqual({ x: origin.x + to.x, y: origin.y + to.y },
      { x: hand.x + fan.x, y: hand.y + fan.y },
      'a card put where it was told to go is not in the hand');
  }
});

test('a card already lying where it is wanted is not moved', () => {
  assert.deepStrictEqual(app.aim({ x: 300, y: 200 }, { x: 300, y: 200 }, { x: 0, y: 0 }),
    { x: 0, y: 0 });
});

test('the card in the hand is aimed at the hand itself', () => {
  // Its fan is nothing, so wherever it was lying, what it is asked to cover is
  // exactly the distance from there to the pointer.
  const to = app.aim({ x: 500, y: 100 }, { x: 120, y: 640 }, { x: 0, y: 0 });
  assert.deepStrictEqual(to, { x: 380, y: -540 });
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
    dbCards: cards.map(c => ({ qty: 1, board: 'main', ...c })),
    dbCats:  [],
    dbShownBoards: new Set(),
    dbSaveTimer: 0,
    isMyPlayer: id => id === 'p1',
    document: { getElementById: () => null },
    clearTimeout() {},
    /* Moving a handful of cards is one of the operations the deck is
     * snapshotted in front of, so the history module is loaded beside the
     * edit module and its request is answered rather than stubbed out — a
     * drop that quietly stopped taking one would still pass here otherwise.
     * What the snapshot contains is test/deckhistory.test.js's question. */
    fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    renders: 0, saves: 0,
  };
  sandbox.dbRender   = () => { sandbox.renders++; };
  /* deckview-core.js's: a card landing on the head of the deck puts that board
   * on the mat. Which board is showing is not this file's question. */
  sandbox._dbRevealHeadBoard = () => {};
  sandbox.setTimeout = () => { sandbox.saves++; return 1; };
  vm.createContext(sandbox);
  /* What a card's place in a deck is — the boards, and the two strings that
   * name a card and a pile. Loaded rather than stubbed, so that the refs and
   * places these tests hand the edit module are the ones the mat writes. */
  vm.runInContext(read('public/js/deckview-boards.js'), sandbox);
  vm.runInContext(read('public/js/deckview-edit.js'), sandbox);
  vm.runInContext(read('public/js/deckview-history.js'), sandbox);
  const run = expr => vm.runInContext(expr, sandbox);
  /* These decks are decks: every card in them is in the mainboard, and every
   * pile named here is a pile of it. What boards add is asserted in
   * test/deckboards.test.js; what is needed here is that the carry's names go
   * on meaning what they meant. */
  const ref   = name => run(`dbPlace(DB_MAIN_BOARD, ${JSON.stringify(name)})`);
  const place = cat  => run(`dbPlace(DB_MAIN_BOARD, ${JSON.stringify(cat)})`);
  return {
    sandbox,
    /** A card carried onto a pile, as cardCarryDrop() spends it. */
    move: (names, cat) => run(
      `dbMoveCardsTo(${JSON.stringify(names.map(ref))}, ${JSON.stringify(place(cat))})`),
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

// ── A handful, dropped ────────────────────────────────────────────────
// Which cards a card brings with it, and what putting them down does to the
// deck and to the selection. Both are the mat's answers rather than the
// carry's — js/carddrag.js asks cardCarryHandful() and cardCarryDrop() and
// knows nothing else about what a selection is — so both are asserted where
// they are answered: the Deck Builder's panel module, over the edit module it
// moves cards through.

/** The Deck Builder's two answers to the carry, over a deck and a selection.
 *  Both shipped modules are run together in one sandbox, because the panel's
 *  answer is only true if the move underneath it is: what is counted is the
 *  render and the deferred write the edit module really schedules. */
function loadMat(cards, selected = []) {
  const sandbox = {
    dbDeck:  { id: 'd1', playerId: 'p1' },
    dbCards: cards.map(c => ({ qty: 1, board: 'main', ...c })),
    dbCats:  [],
    dbSelectedCards: new Set(selected.map(n => `main/${n}`)),
    dbSettledCats:   new Set(),
    dbShownBoards:   new Set(),
    dbView: 'list',
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
  vm.runInContext(read('public/js/deckview-boards.js'), sandbox);
  vm.runInContext(read('public/js/deckview-edit.js'), sandbox);
  vm.runInContext(read('public/js/deckview-panels.js'), sandbox);
  vm.runInContext(read('public/js/deckview-history.js'), sandbox);
  const run = expr => vm.runInContext(expr, sandbox);
  /* Every card on this mat is in the deck, so the ref of one is its name on
   * the mainboard and a pile named here is a pile of the mainboard. Built by
   * asking the module rather than by spelling the grammar out a second time. */
  const ref   = name => run(`dbPlace(DB_MAIN_BOARD, ${JSON.stringify(name)})`);
  const named = r    => run(`dbReadRef(${JSON.stringify(r)}).name`);
  return {
    sandbox,
    /** What the hand closes on, picking this card up. */
    handful: name => JSON.parse(run(
      `JSON.stringify(cardCarryHandful(${JSON.stringify(ref(name))}))`)).map(named),
    /** And what letting go of it over a pile does. */
    drop: (names, cat) => run(
      `cardCarryDrop(${JSON.stringify(names.map(ref))}, ${JSON.stringify(ref(cat))})`),
    categories: () => Object.fromEntries(sandbox.dbCards.map(c => [c.card_name, c.category])),
    selection:  () => [...sandbox.dbSelectedCards].map(named),
    renders: () => sandbox.renders,
    saves:   () => sandbox.saves,
  };
}

test('a selected card brings the whole selection with it', () => {
  const mat = loadMat(DECK, ['Sol Ring', 'Forest']);
  assert.deepStrictEqual(mat.handful('Sol Ring').sort(), ['Forest', 'Sol Ring']);
  assert.deepStrictEqual(mat.handful('Forest').sort(), ['Forest', 'Sol Ring'],
    'either of them picks up both');
});

test('an unselected card is carried alone, and the selection is left alone', () => {
  // Picking one card up is never a way to move twenty by accident: that takes
  // selecting them first, which is a thing you can see you have done.
  const mat = loadMat(DECK, ['Sol Ring', 'Forest']);
  assert.deepStrictEqual(mat.handful('Doom Blade'), ['Doom Blade']);
  assert.deepStrictEqual(mat.selection().sort(), ['Forest', 'Sol Ring'],
    'and asking cost the selection nothing');
});

test('a card carried on a mat with nothing selected is a handful of one', () => {
  const mat = loadMat(DECK);
  assert.deepStrictEqual(mat.handful('Sol Ring'), ['Sol Ring']);
});

test('a handful dropped on a pile moves every card in it, as one change', () => {
  // The bulk move the modal has always done, arrived at by hand: several
  // cards, one render, one autosave.
  const mat = loadMat(DECK, ['Sol Ring', 'Doom Blade']);
  assert.strictEqual(mat.drop(mat.handful('Sol Ring'), 'Lands'), true);
  assert.deepStrictEqual(mat.categories(), {
    'Sol Ring': 'Lands', 'Doom Blade': 'Lands', 'Forest': 'Lands',
  });
  assert.strictEqual(mat.renders(), 1, 'the mat is redrawn once for the whole handful');
  assert.strictEqual(mat.saves(), 1, 'and the deck saved once, as it is for a bulk move today');
});

test('a selection carried somewhere is a selection spent', () => {
  // The bulk bar's move clears it too. Cards that have just been put where they
  // were wanted are not still being chosen, and leaving them lit would make the
  // next thing done on the mat act on a handful nobody is holding.
  const mat = loadMat(DECK, ['Sol Ring', 'Doom Blade']);
  mat.drop(['Sol Ring', 'Doom Blade'], 'Lands');
  assert.deepStrictEqual(mat.selection(), []);
});

test('a card carried alone out of a mat with a selection leaves it standing', () => {
  const mat = loadMat(DECK, ['Doom Blade', 'Forest']);
  assert.strictEqual(mat.drop(['Sol Ring'], 'Lands'), true);
  assert.deepStrictEqual(mat.selection().sort(), ['Doom Blade', 'Forest'],
    'the cards nobody picked up are still selected');
  assert.strictEqual(mat.categories()['Sol Ring'], 'Lands');
});

test('a drop that moves nothing leaves the selection exactly as it was', () => {
  // Released over a pile every card in the handful is already in, or on a deck
  // that is not mine: nothing moved, nothing was saved, and the cards are on
  // their way back to where they were picked up from — selected, because
  // nothing happened.
  const mat = loadMat(DECK, ['Sol Ring']);
  assert.strictEqual(mat.drop(['Sol Ring'], 'Ramp'), false);
  assert.deepStrictEqual(mat.selection(), ['Sol Ring']);
  assert.strictEqual(mat.renders(), 0);
  assert.strictEqual(mat.saves(), 0);

  mat.sandbox.dbDeck = { id: 'd1', playerId: 'someone-else' };
  assert.strictEqual(mat.drop(['Sol Ring'], 'Lands'), false);
  assert.deepStrictEqual(mat.selection(), ['Sol Ring'], 'a deck I may not edit takes nothing');
});

test('a handful put into a settled pile spreads it, so the cards have somewhere to land', () => {
  // A settled pile draws no cards. Dropping a handful into one without
  // spreading it would be twenty cards vanishing out of the hand and a number
  // under a stack going up.
  const mat = loadMat(DECK, ['Sol Ring', 'Doom Blade']);
  mat.sandbox.dbView = 'pile';
  mat.sandbox.dbSettledCats.add('Lands');
  mat.drop(['Sol Ring', 'Doom Blade'], 'Lands');
  assert.deepStrictEqual([...mat.sandbox.dbSettledCats], [],
    'the pile the cards were put into is the one that is no longer settled');
});

test('a handful put into a pile that was already spread leaves the mat as it was', () => {
  // Piles arrive spread, so this is the common drop: the target is already
  // open and there is nothing to reopen. What must not happen is the drop
  // settling anything, or reaching for a set that does not have the label.
  const mat = loadMat(DECK, ['Sol Ring']);
  mat.sandbox.dbView = 'pile';
  mat.sandbox.dbSettledCats.add('Ramp');
  mat.drop(['Doom Blade'], 'Lands');
  assert.deepStrictEqual([...mat.sandbox.dbSettledCats], ['Ramp'],
    'the pile somebody settled elsewhere on the mat stays settled');
});

// ── The gate on the gesture ───────────────────────────────────────────

test('a press becomes a carry only after the hand has moved', () => {
  // A hand is never perfectly still while it clicks, and a click on a card
  // selects it. The threshold is what keeps selecting a card from carrying it
  // a pixel and back.
  assert.ok(app.start >= 2 && app.start <= 8,
    `${app.start}px is either a hand that cannot click or a hand that cannot drag`);
});
