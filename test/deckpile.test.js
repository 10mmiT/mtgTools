/* Reaching into a pile.
 *
 * A spread pile overlaps its own cards — each one lies over the one before it
 * with a sliver of the card underneath showing — so the card under the pointer
 * is the only one you can see whole. Pointing at a card pushes the cards under
 * it down out of the way, the way a hand does to look at one card in a spread.
 *
 * That is CSS: a hover rule and one number. What is asserted here is not what
 * it looks like — that is the eye's, for the reason the redesign recorded — but
 * the four things about it that can go quietly wrong in a stylesheet: the cards
 * move by exactly the amount they overlap by, they keep the angle they were
 * lying at, a finger cannot leave a pile propped open, and nothing shifts under
 * a card that is in hand. All read from the delivered CSS.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const COMPONENTS = read('public/css/components.css');
const TABS       = read('public/css/tabs.css');

/** Every rule block in a stylesheet, as { selector, body }. Comments go first,
 *  so a rule someone commented out cannot answer for the live one. Nested
 *  blocks (@media) yield their inner rules, which is what a selector question
 *  wants; where the wrapper matters, mediaBody() hands over just that block. */
function rules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body: body.trim() }));
}

/** The inside of an at-rule block, brace-balanced, so that "is this rule inside
 *  that query?" is answered by containment rather than by proximity in the
 *  file. */
function mediaBody(css, header) {
  const at = css.indexOf(header);
  if (at < 0) return '';
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', at) + 1, i);
  }
  return '';
}

/** The rule that pushes the rest of a pile down: the cards that follow the one
 *  under the pointer. */
function shiftRule(css) {
  return rules(css).find(r => /\.db-pile-card:hover\s*~/.test(r.selector));
}

/** The level a card under the pointer is drawn at. The fan decides it, in
 *  components.css, shared with the two browsing tabs — so it is the level the
 *  push has to reckon with rather than one this tab set. */
function fanHoverRule(css) {
  return rules(css).find(r => /^\.card-fan\s*>\s*:hover/.test(r.selector));
}

/** A rule's z-index as a number, or NaN if it does not state one. */
function zIndex(rule) {
  return Number((rule.body.match(/z-index:\s*(-?\d+)/) || [])[1]);
}

// ── The push ──────────────────────────────────────────────────────────

test('the cards under the one being pointed at are pushed down', () => {
  const rule = shiftRule(TABS);
  assert.ok(rule, 'the cards after the hovered one have a rule that moves them');
  assert.match(rule.body, /translateY\(/, 'and what it does to them is move them down');
});

test('they move by exactly what the fan overlaps them by', () => {
  // One number, named once. The overlap is what hides the cards underneath, so
  // a push shorter than it leaves the card you are looking at still covered and
  // a push longer than it opens a gap the pile does not have. Two literals in
  // two files is how those drift apart, so the fan states it and the push
  // names it.
  const fan = rules(COMPONENTS).find(r => r.selector === '.card-fan');
  assert.ok(fan, 'the fan is still where the overlap is decided');
  assert.match(fan.body, /--fan-overlap:/, 'and it says how much it overlaps by');

  const overlapped = rules(COMPONENTS).find(r => r.selector === '.card-fan > *');
  assert.match(overlapped.body, /margin-top:\s*calc\(-1 \* var\(--fan-overlap\)\)/,
    'the cards lie that far over each other');
  assert.match(shiftRule(TABS).body, /translateY\(var\(--fan-overlap\)\)/,
    'and are pushed down by the same');
});

test('the cards being pushed stay over the card they are uncovering', () => {
  // What uncovers a card here is the pile getting out of its way, and the cards
  // that lie on it are on it until they have travelled: they slide down across
  // its face and off its bottom edge, the way a hand pushes a spread aside.
  //
  // Drawn under it instead, they leave its face on the first frame of the
  // movement and finish their travel behind it, which is the card jumping out
  // of the pile to meet the pointer rather than the pile opening. Same picture
  // at rest, different gesture: only the middle of it can tell them apart, so
  // this is the whole of what makes the reveal read as movement.
  const hovered = fanHoverRule(COMPONENTS);
  assert.ok(hovered, 'a card under the pointer is still raised by the fan');
  assert.ok(zIndex(shiftRule(TABS)) > zIndex(hovered),
    'and the cards after it are drawn above it for the whole of the push');
});

test('a card pushed down keeps the angle it was lying at', () => {
  // The resting angle is a transform, and a transform is one declaration: a
  // rule that says only translateY would tidy every card under the pointer
  // square to the table, which is the pile straightening itself out as you
  // reach into it.
  assert.match(shiftRule(TABS).body, /rotate\(var\(--stack-turn/,
    'the push restates the angle it is displacing');
});

test('the pile being reached into is drawn over the piles around it', () => {
  // A pushed-down card is displaced, not re-laid-out — the mat is a set of
  // piles put down at measured positions, and a pile that grew would move every
  // pile after it. So the cards under the pointer travel past the foot of their
  // own pile and into the one laid out below, and without this they would go
  // *under* it: the pile that was reached into would be the one card the
  // gesture is meant to reveal, half swallowed by its neighbour.
  const lifted = rules(mediaBody(TABS, '@media (hover: hover)'))
    .find(r => /\.dv-section:has\(/.test(r.selector) && /:hover/.test(r.selector));
  assert.ok(lifted, 'a pile with a card being pointed at is raised');
  assert.match(lifted.body, /z-index:/);
});

// ── When it does not happen ───────────────────────────────────────────

test('a pile opens only for a pointer that can hover', () => {
  // A finger arrives on a card and then leaves the page altogether — there is
  // nothing to clear the hover it left behind, so on a touchscreen this would
  // be a pile propped open until something else was tapped. The lift refuses
  // touch for the same reason, in js/cardlift.js.
  const hoverable = mediaBody(TABS, '@media (hover: hover)');
  assert.ok(shiftRule(hoverable), 'the push is asked only where a pointer hovers');
});

test('nothing opens under a card that is in hand', () => {
  // While a card is being carried the pointer is over the mat holding
  // something, and js/cardmove.js is measuring where the piles are to land it.
  // A pile that opened under the hand would move the target as it was aimed at.
  assert.match(shiftRule(TABS).selector, /:root:not\(\.card-carrying\)/);
});

test('the push answers to “Cards move”', () => {
  // Cards, not chrome: this is the card layer, so it is the card duration and
  // the switch that reaches it — with motion off the pile still opens, it just
  // does not travel there.
  const card = rules(TABS).find(r => r.selector === '.db-pile-card' && /transition/.test(r.body));
  assert.ok(card, 'a pile card states how it travels');
  assert.match(card.body, /transition:\s*transform var\(--dur-card\)/);
});
