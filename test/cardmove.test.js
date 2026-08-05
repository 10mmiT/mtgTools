/* The mat animating its own re-renders: the decisions inside it.
 *
 * Which cards travel and how far, whether a journey is one anybody is
 * watching, and where a thing on the table actually is, are all functions of
 * two measurements and a window, and they are written as functions of exactly
 * that so they can be asserted here rather than eyeballed in a browser. What
 * is not asserted is what a card sliding across the mat looks like — that is
 * the eye's, for the reason the redesign already recorded.
 *
 * The shipped public/js/cardmove.js is run against stub browser globals, the
 * way test/cardlift.test.js runs the lift, so these assert on the code the
 * browser is served rather than on a copy of it.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Nothing in the file touches the document as it loads, so what it needs is
 *  a window to measure against and an answer to "may cards move?" — the one
 *  js/motion.js gives the whole app. */
function loadCardMove({ motion = true, innerHeight = 900, scrollY = 0 } = {}) {
  const sandbox = {
    window: { scrollX: 0, scrollY, innerHeight },
    cardMotionOn: () => motion,
    setTimeout:   () => 1,
    clearTimeout: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/cardmove.js'), sandbox);
  /* Answers come back as JSON: an array built in there is built from that
   *  realm's Array, which nothing here would compare equal to one of ours. */
  const evaluate = expr => vm.runInContext(expr, sandbox);
  const answer   = expr => JSON.parse(evaluate(`JSON.stringify(${expr})`));
  return {
    sandbox, evaluate, answer,
    min:   evaluate('CARD_MOVE_MIN'),
    reach: evaluate('CARD_MOVE_REACH'),
    /** Which of these things travelled, and how far back each has to be put. */
    moves: (before, after, view) => answer(
      `cardMoveList(new Map(${JSON.stringify(before)}), new Map(${JSON.stringify(after)}),
                    ${JSON.stringify(view)})`),
  };
}

const app = loadCardMove();

/** A thing on the mat, at a place, drawn as tall as a card of that width. */
const at = (left, top, extra = {}) => ({ left, top, height: 210, ...extra });

/** The window as the page sees it when it has not been scrolled. */
const WINDOW = { top: 0, bottom: 900 };

// ── Which cards travel, and how far ───────────────────────────────────

test('a card that ended up somewhere new is put back where it was', () => {
  // The whole thing: the offset is the old place minus the new one — what the
  // card has to be displaced by *now* in order to be drawn where it was
  // *then*. Letting go of that offset is the journey.
  const moves = app.moves(
    [['card:Sol Ring', at(20, 40)]],
    [['card:Sol Ring', at(320, 640)]],
    WINDOW);
  assert.strictEqual(moves.length, 1);
  assert.strictEqual(moves[0].key, 'card:Sol Ring');
  assert.strictEqual(moves[0].dx, 20 - 320);
  assert.strictEqual(moves[0].dy, 40 - 640);
});

test('a card that stayed where it was is not moved', () => {
  const here = [['card:Forest', at(20, 40)]];
  assert.deepStrictEqual(app.moves(here, here, WINDOW), []);
});

test('a card that shifted by less than a pixel is not moved either', () => {
  // A rebuild can land a card a fraction of a pixel from where it was — a
  // scrollbar rounding differently, a font metric settling. A card that
  // travels half a pixel is a card that flickers.
  assert.ok(app.min > 0 && app.min <= 2, `${app.min}px is a rounding, not a move`);
  const moves = app.moves(
    [['card:Forest', at(20, 40)]],
    [['card:Forest', at(20.4, 40.3)]],
    WINDOW);
  assert.deepStrictEqual(moves, [], 'a fraction of a pixel is not somewhere else');
});

test('cards are recognised by what they are, not by which element they are', () => {
  // A re-render replaces the mat wholesale: not one element survives it, and
  // the card name is the only thing both renders agree on. What travels is
  // the element the *new* render made, since that is the one in the page.
  const moves = app.moves(
    [['card:Sol Ring', at(0, 0,   { el: 'the old one' })]],
    [['card:Sol Ring', at(0, 300, { el: 'the new one' })]],
    WINDOW);
  assert.strictEqual(moves.length, 1, 'the same card across two renders is one card');
  assert.strictEqual(moves[0].el, 'the new one');
});

test('a card added to the deck arrives rather than travelling from nowhere', () => {
  // It has no old position, and inventing one would be inventing a story
  // about where it came from. It is simply there.
  const moves = app.moves(
    [['card:Forest', at(0, 0)]],
    [['card:Forest', at(0, 0)], ['card:Sol Ring', at(0, 300)]],
    WINDOW);
  assert.deepStrictEqual(moves, []);
});

test('a card removed from the deck is not left travelling', () => {
  // Nothing to strand: by the time this is asked the card has no element in
  // the page at all, so it cannot be caught halfway anywhere.
  const moves = app.moves(
    [['card:Forest', at(0, 0)], ['card:Sol Ring', at(0, 300)]],
    [['card:Forest', at(0, 0)]],
    WINDOW);
  assert.deepStrictEqual(moves, []);
});

test('the cards a change did not touch stay still while the ones it did travel', () => {
  // Changing a quantity closes the pile up around it: the cards after it move
  // and the cards before it do not, which is what makes the change legible.
  const before = [
    ['card:A', at(0, 0)], ['card:B', at(0, 300)], ['card:C', at(0, 600)], ['card:D', at(0, 900)],
  ];
  const after = [
    ['card:A', at(0, 0)], ['card:C', at(0, 300)], ['card:D', at(0, 600)],
  ];
  const moves = app.moves(before, after, { top: 0, bottom: 1200 });
  assert.deepStrictEqual(moves.map(m => m.key), ['card:C', 'card:D']);
  assert.ok(moves.every(m => m.dy === 300), 'and each of them by the height of the card that went');
});

test('a settled stack travels as itself, and cannot be mistaken for a card', () => {
  // In pile view the thing that moves is not always a card: a settled stack
  // stands for a whole category, and a category may be named after a card.
  const moves = app.moves(
    [['stack:Forest', at(0, 0)], ['card:Forest', at(400, 0)]],
    [['stack:Forest', at(0, 0)], ['card:Forest', at(400, 300)]],
    WINDOW);
  assert.deepStrictEqual(moves.map(m => m.key), ['card:Forest'],
    'the card moved and the category of the same name did not');
});

// ── Which journeys are worth drawing ──────────────────────────────────
// The cost ceiling. A deck of several hundred cards has to animate at the
// price of a screenful, and what bounds that is the window rather than the
// deck: a card whose whole journey happens off the screen is a journey nobody
// watched.

test('a journey that begins and ends off the screen is not drawn', () => {
  const moves = app.moves(
    [['card:Forest', at(0, 8000)]],
    [['card:Forest', at(0, 9000)]],
    WINDOW);
  assert.deepStrictEqual(moves, []);
});

test('a card leaving the screen, or arriving on it, still travels', () => {
  // Half a journey is still watched — the eye follows the last of it out and
  // the first of it in — so either end being in view is enough.
  const out = app.moves([['card:Forest', at(0, 400)]], [['card:Forest', at(0, 9000)]], WINDOW);
  const in_ = app.moves([['card:Forest', at(0, 9000)]], [['card:Forest', at(0, 400)]], WINDOW);
  assert.strictEqual(out.length, 1, 'a card sent off the bottom of the mat is seen leaving');
  assert.strictEqual(in_.length, 1, 'and one brought back is seen arriving');
});

test('the reach beyond the window is generous rather than exact', () => {
  // A card just past the fold has been half-watched; cutting it at the pixel
  // would stop cards dead at the edge of the screen. Both ends of this
  // journey are below the window, and it is still drawn.
  assert.ok(app.reach >= 100, `${app.reach}px is a cut, not a margin`);
  const near = app.moves(
    [['card:Forest', at(0, WINDOW.bottom + 50)]],
    [['card:Forest', at(0, WINDOW.bottom + app.reach - 10)]],
    WINDOW);
  const past = app.moves(
    [['card:Forest', at(0, WINDOW.bottom + app.reach + 100)]],
    [['card:Forest', at(0, WINDOW.bottom + app.reach + 400)]],
    WINDOW);
  assert.strictEqual(near.length, 1, 'just past the fold is still nearly watched');
  assert.strictEqual(past.length, 0, 'and well past it is not');
});

test('what animates is bounded by the window and not by the size of the deck', () => {
  // The promise the whole file has to keep: several hundred cards re-render
  // without stutter. Every card in this deck moves, and the number that are
  // drawn moving is a screenful of them however long the deck gets.
  const deck = n => Array.from({ length: n }, (_, i) => [`card:Card ${i}`, at(0, i * 240)]);
  const shifted = n => deck(n).map(([key, box]) => [key, at(box.left, box.top + 240)]);
  const drawn = n => app.moves(deck(n), shifted(n), WINDOW).length;

  assert.ok(drawn(400) < 20, `a four-hundred-card deck drew ${drawn(400)} cards moving`);
  assert.strictEqual(drawn(400), drawn(4000),
    'and a deck ten times the size draws exactly as many');
});

test('a window that reports no size is treated as seeing everything', () => {
  // A missing measurement must never be the thing that quietly switches the
  // movement off — that is a bug you cannot see, only fail to see.
  for (const view of [null, undefined, { top: 0, bottom: 0 }, { top: 500, bottom: 500 }]) {
    const moves = app.moves(
      [['card:Forest', at(0, 8000)]],
      [['card:Forest', at(0, 9000)]],
      view);
    assert.strictEqual(moves.length, 1, `${JSON.stringify(view)} saw nothing at all`);
  }
});

// ── Where a thing on the table is ─────────────────────────────────────

/** A mat, as the DOM would answer questions about it: things with a name and
 *  a box, measured the way the browser measures — from the top of the window
 *  rather than the top of the page. */
const matBoxes = (app, things) => app.answer(
  `Object.fromEntries(cardMoveBoxes({ querySelectorAll: () => ${JSON.stringify(things)}.map(t => ({
      dataset: { moves: t.key },
      getBoundingClientRect: () => ({ left: t.left, top: t.top, height: t.height }),
    })) }))`);

test('a thing on the mat is measured against the page, not against the window', () => {
  // Removing a card can shorten the page enough that the browser scrolls it.
  // Measured against the window every card on screen would then appear to
  // have moved at once, and the mat would slide about under a change that
  // moved one card.
  const near = loadCardMove({ scrollY: 0 });
  const far  = loadCardMove({ scrollY: 600 });
  const thing = [{ key: 'card:Forest', left: 20, top: 40, height: 210 }];

  assert.strictEqual(matBoxes(near, thing)['card:Forest'].top, 40);
  assert.strictEqual(matBoxes(far,  thing)['card:Forest'].top, 640,
    'the same card, six hundred pixels further down a page scrolled six hundred pixels');
});

test('the mat scrolling under a card is not the card moving', () => {
  // The two halves of the same fact: the same place on the page, measured at
  // two scroll positions, is one place and not two.
  const before = matBoxes(loadCardMove({ scrollY: 0 }),
    [{ key: 'card:Forest', left: 20, top: 340, height: 210 }]);
  const after = matBoxes(loadCardMove({ scrollY: 300 }),
    [{ key: 'card:Forest', left: 20, top: 40, height: 210 }]);
  assert.deepStrictEqual(before, after);
});

test('a mat with nothing on it measures to nothing rather than to an error', () => {
  assert.deepStrictEqual(app.answer('Object.fromEntries(cardMoveBoxes(null))'), {});
  assert.deepStrictEqual(matBoxes(app, []), {});
});

// ── Asking whether cards may move at all ──────────────────────────────

/** One re-render of a mat holding `things`, which all move by `by` pixels,
 *  reporting what was done to the page along the way. */
function reRender(app, { things, by }) {
  return app.answer(`(() => {
    const made = (top, i) => ({
      dataset: { moves: 'card:Card ' + i },
      style: {
        translate: null,
        removeProperty(name) { this[name] = null; },
      },
      classList: {
        names: [],
        add(name) { this.names.push(name); },
        remove(name) { this.names = this.names.filter(n => n !== name); },
      },
      getBoundingClientRect: () => ({ left: 0, top, height: 210 }),
    });
    let rebuilt = 0, measured = 0, painted = [];
    const tops = ${JSON.stringify(things)};
    const root = {
      get offsetHeight() { return 1; },
      querySelectorAll() {
        measured++;
        painted = tops.map((top, i) => made(rebuilt ? top + ${by} : top, i));
        return painted;
      },
    };
    animateCardMove(root, () => { rebuilt++; });
    return {
      rebuilt, measured,
      moving:    painted.filter(el => el.classList.names.includes('card-moving')).length,
      displaced: painted.filter(el => el.style.translate).length,
    };
  })()`);
}

test('with cards’ motion off the mat is rebuilt and nothing is measured', () => {
  // Not "measured and then not moved": a mat that cannot animate does not pay
  // for the measurement either, and the render is the render it always was.
  const still = loadCardMove({ motion: false });
  const done  = reRender(still, { things: [0, 300, 600], by: 300 });
  assert.strictEqual(done.rebuilt, 1, 'the mat is rebuilt exactly once');
  assert.strictEqual(done.measured, 0, 'and never measured');
  assert.strictEqual(done.moving, 0);
});

test('with cards’ motion on the cards are put back, let go, and left clean', () => {
  // The displacement is written and then taken straight off again: what is
  // left on the card when this returns is a transition and no offset, which
  // is a card on its way to where it already is.
  const done = reRender(loadCardMove(), { things: [0, 300, 600], by: 300 });
  assert.strictEqual(done.rebuilt, 1, 'the render still runs once');
  assert.strictEqual(done.measured, 2, 'measured before the rebuild and after it');
  assert.strictEqual(done.moving, 3, 'all three cards travel');
  assert.strictEqual(done.displaced, 0, 'and none is left holding an offset');
});

test('a mat that was empty before the render animates nothing into place', () => {
  // Opening a deck fills an empty mat. Every card in it is arriving, and a
  // hundred cards flying in from the top-left corner is not an explanation of
  // anything.
  const done = reRender(loadCardMove(), { things: [], by: 300 });
  assert.strictEqual(done.rebuilt, 1);
  assert.strictEqual(done.moving, 0);
});
