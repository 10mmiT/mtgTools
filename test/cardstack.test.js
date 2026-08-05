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
    pile:   (count, tallest) =>
      evaluate(`pileLayers(${JSON.stringify(count)}, ${JSON.stringify(tallest)})`),
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

// ── How thick a pile in a row of piles is ─────────────────────────────
// A deck's categories run from four cards to forty and are drawn as thick as
// they are. A browsing tab's piles run to twelve thousand, where that would
// draw every pile at the cap — so on a table of piles thickness is a share of
// the biggest one, and what is asserted is that the row keeps its shape.

test('a row of piles reads as the shape of what it holds', () => {
  // A collection's mana curve, which is the whole reason to stand it up off
  // the table: drawn outright, every one of these is past the cap and the
  // curve is a flat row of identical bricks.
  const curve   = [438, 869, 1909, 1916, 1357, 850, 423, 266];
  const tallest = Math.max(...curve);
  const drawn   = curve.map(n => app.pile(n, tallest));
  assert.deepStrictEqual(curve.map(n => app.layers(n)), new Array(curve.length).fill(app.maxLayers),
    'the premise: drawn outright these are all the same pile');
  assert.strictEqual(new Set(drawn).size > 5, true, `the curve came out as ${drawn.join(',')}`);
  assert.strictEqual(Math.max(...drawn), app.maxLayers, 'the biggest pile is drawn at the cap');
  // The shape itself. Two piles a few cards apart may well be drawn the same —
  // ten edges cannot say more than ten things — but the row never goes the
  // wrong way, and a pile holding half again what its neighbour holds is
  // visibly thicker than it.
  for (let i = 1; i < curve.length; i++) {
    const said = `${curve[i - 1]} and ${curve[i]} cards came out as ${drawn[i - 1]} and ${drawn[i]} edges`;
    if (curve[i] >= curve[i - 1]) assert.ok(drawn[i] >= drawn[i - 1], said);
    else                          assert.ok(drawn[i] <= drawn[i - 1], said);
    if (curve[i] >= curve[i - 1] * 1.5) assert.ok(drawn[i] > drawn[i - 1], said);
    if (curve[i] * 1.5 <= curve[i - 1]) assert.ok(drawn[i] < drawn[i - 1], said);
  }
});

test('a pile in a row is still bounded by what it holds and by the cap', () => {
  // The two promises stackLayers makes, kept here whatever the proportion says.
  for (const [count, tallest] of [[2, 2], [3, 4], [4, 4], [11, 12], [400, 400], [12000, 12000]]) {
    assert.ok(app.pile(count, tallest) <= app.layers(count),
      `${count} of ${tallest} drew ${app.pile(count, tallest)} edges, more than it has cards`);
    assert.ok(app.pile(count, tallest) <= app.maxLayers);
  }
  assert.strictEqual(app.pile(1, 4000), 0, 'a single card is a card');
  assert.strictEqual(app.pile(0, 4000), 0);
});

test('a pile is never rounded away to a bare card', () => {
  // Four cards beside four thousand is still a pile, not a card lying alone.
  assert.ok(app.pile(4, 4000) >= 1, 'a small pile beside a huge one is still a pile');
});

test('adding a card to a pile never makes that pile look thinner', () => {
  for (const tallest of [40, 4000]) {
    let previous = 0;
    for (let count = 0; count <= tallest; count++) {
      const drawn = app.pile(count, tallest);
      assert.ok(drawn >= previous, `${count} of ${tallest} drew ${drawn}, fewer than ${previous}`);
      previous = drawn;
    }
  }
});

test('with nothing to be a share of, a pile is drawn as thick as it is', () => {
  for (const count of [0, 1, 4, 30, 4000]) {
    assert.strictEqual(app.pile(count, 0), app.layers(count));
  }
});

// ── What a table of piles costs ───────────────────────────────────────
// The stack view's promise is that it is an option and never a tax: a browsing
// tab may hand it every card it holds, so what is drawn has to be bounded by
// the cap rather than by the pile. The markup itself is not asserted — that is
// the screenshot harness's and the eye's — only how much of it there is.

const cardsNamed = n => Array.from({ length: n }, (_, i) => ({ name: `Card ${i}` }));
/** `spread` is the labels of the piles that are open — any number of them. */
const pilesHtml = (groups, opts) => app.evaluate(
  `cardPilesHtml(${JSON.stringify(groups)}, {
     fanned: new Set(${JSON.stringify(opts?.spread ?? [])}),
     cardOf: card => ({ name: card.name, img: 'i.png' }) })`);
const countOf = (html, needle) => html.split(needle).length - 1;

test('a settled pile costs the same whether it holds four hundred cards or twelve thousand', () => {
  const set  = pilesHtml([{ label: 'Common', cards: cardsNamed(400) }]);
  const huge = pilesHtml([{ label: 'Common', cards: cardsNamed(12000) }]);
  assert.strictEqual(countOf(huge, '<img'), 1, 'a pile is one picture, however many cards are in it');
  assert.strictEqual(countOf(huge, 'card-stack-layer'), app.maxLayers);
  assert.strictEqual(countOf(set, 'card-stack-layer'), countOf(huge, 'card-stack-layer'),
    'a whole collection is drawn with what a set is drawn with');
  assert.ok(huge.includes((12000).toLocaleString()), 'and it says what it holds');
});

test('a fanned pile spreads a bounded number of cards, and says how many of them', () => {
  const cap  = app.evaluate('STACK_FAN_MAX');
  const html = pilesHtml([{ label: 'Common', cards: cardsNamed(4000) }], { spread: ['Common'] });
  assert.strictEqual(countOf(html, '<img'), cap,
    `spreading four thousand commons drew ${countOf(html, '<img')} cards`);
  assert.ok(html.includes(`${cap} of 4,000`), 'a fan that is not the whole pile says so');
});

test('the piles that were spread are spread and the rest stay stacked', () => {
  const html = pilesHtml([
    { label: 'Common', cards: cardsNamed(30) },
    { label: 'Rare',   cards: cardsNamed(20) },
  ], { spread: ['Rare'] });
  assert.strictEqual(countOf(html, 'card-fan"'), 1, 'the one that was asked for is spread');
  assert.strictEqual(countOf(html, 'card-stack"'), 1, 'and the other is still a stack');
});

// ── Which piles are spread ────────────────────────────────────────────
// A set of labels rather than one label. A table of piles is read by holding
// them up against each other, which cannot be done one at a time: by the time
// the second is open the first has closed and there is nothing to compare.

test('several piles can be spread at once', () => {
  const table = [
    { label: 'Common',   cards: cardsNamed(30) },
    { label: 'Uncommon', cards: cardsNamed(20) },
    { label: 'Rare',     cards: cardsNamed(10) },
    { label: 'Mythic',   cards: cardsNamed(4) },
  ];
  const html = pilesHtml(table, { spread: ['Uncommon', 'Mythic'] });
  assert.strictEqual(countOf(html, 'card-fan"'), 2, 'both of the piles asked for are open');
  assert.strictEqual(countOf(html, 'card-stack"'), 2, 'and the two that were not are stacks');
  assert.strictEqual(countOf(pilesHtml(table, { spread: table.map(g => g.label) }), 'card-fan"'), 4,
    'and the whole table can be spread at once');
});

test('a spread pile is drawn the same whatever else is open beside it', () => {
  // What "the cap is per pile" means: a pile does not spread fewer cards
  // because of a pile somewhere else on the table.
  const table = [
    { label: 'Common', cards: cardsNamed(200) },
    { label: 'Rare',   cards: cardsNamed(200) },
  ];
  const cap   = app.evaluate('STACK_FAN_MAX');
  const alone = pilesHtml(table, { spread: ['Common'] });
  const both  = pilesHtml(table, { spread: ['Common', 'Rare'] });
  assert.strictEqual(countOf(alone, '<img'), cap + 1, 'one fan, and one face on the pile beside it');
  assert.strictEqual(countOf(both, '<img'), cap * 2,
    'the second pile spreading costs a second fan and takes nothing off the first');
});

test('a settled table is every pile stacked', () => {
  const html = pilesHtml([
    { label: 'Common', cards: cardsNamed(30) },
    { label: 'Rare',   cards: cardsNamed(20) },
  ]);
  assert.strictEqual(countOf(html, 'card-fan"'), 0);
  assert.strictEqual(countOf(html, 'card-stack"'), 2);
});

test('every pile carries the arrow, saying which way it is lying', () => {
  // The one control a pile has, in the same place on all three tabs. Which
  // way it points is aria-expanded, so the stylesheet and a screen reader are
  // reading one fact rather than two copies of it.
  const html = pilesHtml([
    { label: 'Common', cards: cardsNamed(30) },
    { label: 'Rare',   cards: cardsNamed(20) },
  ], { spread: ['Rare'] });
  assert.strictEqual(countOf(html, 'pile-toggle'), 2, 'one arrow per pile, open or not');
  assert.strictEqual(countOf(html, 'aria-expanded="true"'), 1);
  assert.strictEqual(countOf(html, 'aria-expanded="false"'), 1);
  assert.ok(html.includes('Spread Common out') && html.includes('Settle Rare'),
    'and each says what clicking it will do rather than what it is');
});

const spreadAfter = (labels, calls) => JSON.parse(app.evaluate(
  `JSON.stringify([...${calls.reduce(
    (expr, label) => `togglePile(${expr}, ${JSON.stringify(label)})`,
    `new Set(${JSON.stringify(labels)})`)}])`));

test('the arrow opens a settled pile and settles an open one', () => {
  assert.deepStrictEqual(spreadAfter([], ['Rare']), ['Rare']);
  assert.deepStrictEqual(spreadAfter(['Rare'], ['Rare']), []);
  assert.deepStrictEqual(spreadAfter([], ['Rare', 'Rare']), [], 'twice is back where it started');
});

test('opening one pile leaves the others where they were', () => {
  // The whole point of the set: no pile closes because another opened.
  assert.deepStrictEqual(spreadAfter(['Common'], ['Rare']), ['Common', 'Rare']);
  assert.deepStrictEqual(spreadAfter(['Common', 'Rare'], ['Common']), ['Rare']);
});

const kept = (labels, groups) => JSON.parse(app.evaluate(
  `JSON.stringify([...settleGonePiles(new Set(${JSON.stringify(labels)}),
     ${JSON.stringify(groups.map(label => ({ label, cards: [] })))})])`));

test('a pile the table no longer has is forgotten rather than held open', () => {
  // A search, a filter or a re-sort cuts the piles again. A label nothing
  // answers to would be the table holding a place for nothing.
  assert.deepStrictEqual(kept(['Common', 'Rare'], ['Common', 'Uncommon']), ['Common']);
  assert.deepStrictEqual(kept(['Common'], []), []);
  assert.deepStrictEqual(kept([], ['Common']), []);
  assert.deepStrictEqual(kept(['Common', 'Rare'], ['Rare', 'Common']), ['Common', 'Rare'],
    'and a table that still has them all keeps them all');
});
