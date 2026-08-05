/* Picking a card up: the two decisions inside it.
 *
 * How far a card leans and where the light falls on it are functions of where
 * the pointer is within the card's own box, and they are written as functions
 * of exactly that so they can be asserted here rather than eyeballed in a
 * browser. What is not asserted is the rest of the file — the listeners, the
 * class names, the custom properties — nor what a lifted card looks like.
 * Those are the screenshot harness's and the eye's, for the reason the
 * redesign already recorded: during a visual change every intentional
 * difference is a failure, and that trains you to ignore the output.
 *
 * The shipped public/js/cardlift.js is run against stub browser globals, the
 * way test/motion.test.js runs the motion boot script, so these assert on the
 * code the browser is served rather than on a copy of it.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** The file wires itself to the document as it loads, so it needs somewhere to
 *  hang the listeners. Nothing below calls them: what is under test is the
 *  arithmetic they hand the DOM. */
function loadCardLift() {
  const sandbox = {
    document: { addEventListener() {} },
    window:   { addEventListener() {} },
    requestAnimationFrame: () => 0,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/cardlift.js'), sandbox);
  /* Copied out of the sandbox on the way back: an object built in there is
   *  built from that realm's Object, which nothing here would compare equal
   *  to one of ours however identical its contents. */
  const evaluate = expr => vm.runInContext(expr, sandbox);
  const answer = expr => ({ ...evaluate(expr) });
  return {
    evaluate,
    max: evaluate('CARD_TILT_MAX'),
    /** A card of a plausible size, pointed at somewhere within it. */
    tilt:  (x, y, w = 150, h = 210) => answer(`cardTilt(${x}, ${y}, ${w}, ${h})`),
    sheen: (x, y, w = 150, h = 210) => answer(`cardSheen(${x}, ${y}, ${w}, ${h})`),
  };
}

const app = loadCardLift();

// ── The lean ──────────────────────────────────────────────────────────

test('a card pointed at dead-on does not lean', () => {
  assert.deepStrictEqual(app.tilt(75, 105), { x: 0, y: 0 },
    'the centre of the card is the one point with no direction to lean in');
});

test('the lean is a few degrees at the edges and no more', () => {
  const { max } = app;
  assert.ok(max > 0 && max <= 10, `a lean of ${max}° is a card catching the light`);

  const corners = [[0, 0], [150, 0], [0, 210], [150, 210]];
  for (const [x, y] of corners) {
    const tilt = app.tilt(x, y);
    assert.strictEqual(Math.abs(tilt.x), max, `${x},${y} leans the most it may`);
    assert.strictEqual(Math.abs(tilt.y), max);
  }
});

test('a pointer outside the card cannot lean it further', () => {
  // Where this comes from: the pointer is over the *lifted* card, which is
  // bigger than the box the lean is measured against, so points beyond the
  // box are ordinary rather than exceptional.
  const { max } = app;
  for (const [x, y] of [[-400, -400], [900, 900], [75, -50], [-30, 105]]) {
    const tilt = app.tilt(x, y);
    assert.ok(Math.abs(tilt.x) <= max && Math.abs(tilt.y) <= max,
      `${x},${y} is off the card and still leans no more than ${max}°`);
  }
});

test('the corner nearest the pointer is the one that rises', () => {
  // Signs, in the CSS functions they are handed to: rotateX turns the card
  // about its horizontal axis, and a positive angle brings the bottom edge
  // towards the eye; rotateY turns it about its vertical one, and a negative
  // angle brings the right edge towards the eye.
  assert.ok(app.tilt(75, 210).x > 0, 'pointing low brings the bottom edge up to meet it');
  assert.ok(app.tilt(75, 0).x   < 0, 'and pointing high brings the top edge');
  assert.ok(app.tilt(150, 105).y < 0, 'pointing right brings the right edge');
  assert.ok(app.tilt(0, 105).y   > 0, 'and pointing left the left');
});

test('the lean is proportional to how far from the centre the pointer is', () => {
  const { max } = app;
  const halfway = app.tilt(150 * 0.75, 105).y;
  assert.strictEqual(halfway, -max / 2,
    'halfway to the right edge is half the lean of the edge itself');
});

test('the same pointer on the same card leans it the same way, every time', () => {
  // The lean is read on every frame of a pointer crossing a grid; a card that
  // answered differently on the second reading would shiver under the hand.
  const first = app.tilt(31, 187);
  for (let i = 0; i < 5; i++) assert.deepStrictEqual(app.tilt(31, 187), first);
});

test('a card with no size does not lean at all', () => {
  // An image that has not loaded, or one measured while its tab is hidden,
  // measures zero — which is a division by zero away from a lean of NaN, and a
  // transform of NaN is a card that vanishes.
  assert.deepStrictEqual(app.tilt(0, 0, 0, 0), { x: 0, y: 0 });
  assert.deepStrictEqual(app.tilt(40, 210, 0, 210), { x: app.max, y: 0 },
    'and an axis with no size is the only one that stops answering');
});

// ── The light ─────────────────────────────────────────────────────────

test('the light crosses the card straight when it is pointed at dead-on', () => {
  assert.deepStrictEqual(app.sheen(75, 105), { angle: 0, pos: 50 },
    'the centre has no direction to give, so it is given one rather than ' +
    'left to whatever atan2 says about it');
});

test('the light comes from the direction of the pointer', () => {
  // CSS gradient angles: 0 points up the card, and they grow clockwise.
  assert.strictEqual(app.sheen(150, 105).angle, 90,  'pointing right');
  assert.strictEqual(app.sheen(0, 105).angle,  -90,  'pointing left');
  assert.strictEqual(app.sheen(75, 0).angle,     0,  'pointing up');
  assert.strictEqual(app.sheen(75, 210).angle, 180,  'pointing down');
  assert.strictEqual(app.sheen(150, 0).angle,   45,  'and the corner between two of them');
});

test('the band of light slides towards the pointer and stays on the card', () => {
  const centre = app.sheen(75, 105).pos;
  const near   = app.sheen(112, 105).pos;
  const edge   = app.sheen(150, 105).pos;
  assert.ok(centre < near && near < edge, 'it follows the pointer out');
  assert.ok(edge <= 100, 'and never slides off the face it is meant to be crossing');
  assert.ok(app.sheen(150, 210).pos <= 100, 'not even at a corner, where it reaches furthest');
});
