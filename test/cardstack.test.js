/* Stacks: the two decisions inside one.
 *
 * How thick a stack is drawn and what angle a card lies at are functions of
 * how many cards there are and of the card's name, and they are written as
 * functions of exactly that so they can be asserted here rather than
 * eyeballed in a browser. What is not asserted is the markup the renderer
 * returns, nor what a pile looks like — those are the screenshot harness's and
 * the eye's, for the reason the redesign already recorded.
 *
 * The shipped public/js/cardstack.js is run against stub browser globals, the
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

/** The file wires nothing to the document — it is asked for markup and hands
 *  it back — so it needs only esc(), which state.js provides in the app. */
function loadCardStack() {
  const sandbox = { esc: s => String(s) };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/cardstack.js'), sandbox);
  const evaluate = expr => vm.runInContext(expr, sandbox);
  return {
    evaluate,
    maxLayers: evaluate('STACK_LAYERS_MAX'),
    maxJitter: evaluate('STACK_JITTER_MAX'),
    layers: count => evaluate(`stackLayers(${JSON.stringify(count)})`),
    jitter: name  => evaluate(`stackJitter(${JSON.stringify(name)})`),
  };
}

const app = loadCardStack();

// ── How thick a stack is drawn ────────────────────────────────────────

test('a stack of thirty is visibly thicker than a stack of four', () => {
  // The point of the whole thing: reading the shape of a deck without
  // counting it.
  assert.ok(app.layers(30) > app.layers(4),
    `thirty cards draw ${app.layers(30)} edges and four draw ${app.layers(4)}`);
  assert.ok(app.layers(4) > 0, 'and four cards are already a pile rather than a card');
});

test('adding a card never makes a stack look thinner', () => {
  let previous = 0;
  for (let count = 0; count <= 500; count++) {
    const layers = app.layers(count);
    assert.ok(layers >= previous,
      `${count} cards draw ${layers} edges, fewer than the ${previous} of ${count - 1}`);
    previous = layers;
  }
});

test('no stack draws more than the cap, however large it gets', () => {
  // What makes a four-hundred-card set browsable: the number of drawn
  // elements is bounded, so a large stack costs no more to paint than a
  // small one.
  const { maxLayers } = app;
  assert.ok(maxLayers > 0 && maxLayers <= 20, `${maxLayers} edges is a pile, not a wall`);
  for (const count of [40, 100, 400, 4000, 1e6]) {
    assert.strictEqual(app.layers(count), maxLayers,
      `${count} cards draw the same ${maxLayers} edges as any other large stack`);
  }
});

test('a stack never draws more edges than it has cards under the face', () => {
  // Otherwise a pair would be drawn as a brick, and the thickness would stop
  // being something the count can be read off.
  for (let count = 0; count <= 30; count++) {
    assert.ok(app.layers(count) <= Math.max(0, count - 1),
      `${count} cards cannot show ${app.layers(count)} edges beneath the top one`);
  }
});

test('a stack of one card is a card, and nothing is nothing', () => {
  assert.strictEqual(app.layers(1), 0, 'one card has nothing lying under it');
  assert.strictEqual(app.layers(0), 0);
});

test('a count that is not a count draws no edges rather than NaN of them', () => {
  // A category whose quantities have not loaded, or a caller that passed a
  // string: a stack of NaN cards is a stack drawn at no size at all.
  for (const count of [-3, null, undefined, NaN, 'twelve', {}]) {
    assert.strictEqual(app.layers(count), 0, `${String(count)} is not a number of cards`);
  }
  assert.strictEqual(app.layers(7.6), app.layers(7), 'and half a card is not half an edge');
});

// ── What angle a card lies at ─────────────────────────────────────────

test('the same card lies at the same angle every time it is asked', () => {
  // The whole reason the angle comes from a hash rather than from
  // Math.random(): a mat that reshuffles itself on every quantity change is
  // worse than a tidy one.
  const first = app.jitter('Lightning Bolt');
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(app.jitter('Lightning Bolt'), first);
  }
  assert.strictEqual(app.jitter('Lightning Bolt'), loadCardStack().jitter('Lightning Bolt'),
    'and the same angle in the next render of the page as in this one');
});

test('no card lies further from square than it may', () => {
  const { maxJitter } = app;
  assert.ok(maxJitter > 0 && maxJitter <= 5, `${maxJitter}° is a pile, not a spread`);
  const names = [
    '', 'A', 'Sol Ring', 'Forest', 'Island', 'Krark-Clan Ironworks',
    'Asmoranomardicadaistinaculdacar', 'Borborygmos Enraged', 'Jace, the Mind Sculptor',
    'Æther Vial', "Ach! Hans, Run!", '大あくま', '  ', 'x'.repeat(400),
  ];
  for (const name of names) {
    const turn = app.jitter(name);
    assert.ok(Number.isFinite(turn), `${name} has an angle at all`);
    assert.ok(Math.abs(turn) <= maxJitter, `${name} lies at ${turn}°`);
  }
});

test('a card with no name at all still has an angle', () => {
  // The renderer is handed whatever the deck holds; a missing name is a
  // rotation of NaN, which is a card drawn nowhere.
  for (const name of [undefined, null, 0, NaN]) {
    assert.ok(Number.isFinite(app.jitter(name)), `${String(name)} lies flat rather than nowhere`);
  }
});

test('cards do not all lie the same way', () => {
  // A pile whose cards share an angle is a rotated brick — the hash has to
  // spread names across the range, not merely be stable.
  const names = Array.from({ length: 60 }, (_, i) => `Card number ${i}`);
  const angles = names.map(app.jitter);
  assert.ok(new Set(angles).size > 20, `60 cards took only ${new Set(angles).size} angles`);
  assert.ok(angles.some(a => a < 0) && angles.some(a => a > 0),
    'and they lean both ways rather than all one way');
});
