// ── Stacks ────────────────────────────────────────────────────────────────
// A group of cards drawn as a pile on a table: a face card lying on top with
// the edges of the cards beneath it showing, a thickness that grows with the
// count, and the small rotations that make a stack look stacked rather than
// printed.
//
// One renderer, three callers. The Deck Builder's category piles are the
// first; Collections' and the Set Browser's stack views are the same
// component, grouped by whatever those tabs are sorted by. Nothing here knows
// about categories, sort fields or decks: it is handed cards and hands back
// markup, and the caller wires up what clicking one means.
//
// Two decisions live in this file and both are written as functions of their
// inputs so that they can be asserted rather than eyeballed:
//
//   stackLayers()  how many card edges are drawn, from how many cards are
//                  held. Bounded, so a four-hundred-card stack costs the same
//                  to paint as a forty-card one.
//   stackJitter()  the angle a card lies at, from its name. Stable, so the
//                  same card sits the same way on every render.
//
// Randomness at render time was considered and is refused: a mat that
// reshuffles itself every time a quantity changes is worse than a tidy one,
// and a pile drawn from Math.random() cannot be tested at all.
//
// The face card is a plain .card-img, so it is picked up by js/cardlift.js
// like every other card in the app — the top card of a pile is the one your
// hand reaches, and it lifts off the stack it is lying on.

/* How many edges may be drawn beneath the face card. This is the whole cost
 * ceiling: a stack is at most this many elements plus the face, whatever it
 * holds. Ten reads as a thick pile at the sizes cards are drawn here without
 * the deepest edge sliding out from under a card's own shadow. */
const STACK_LAYERS_MAX = 10;

/* How far from square a card may lie, in degrees. Small on purpose: this is a
 * pile put down by hand, not a spread. */
const STACK_JITTER_MAX = 2.5;

/* How thick one card is, as a fraction of the card's own width. A Magic card
 * is about 0.3mm on a 63mm width, which would be invisible; this is a stack
 * seen from slightly in front, where the edges show. It tracks the width
 * rather than being a fixed pixel count so that the card-size control makes
 * thick stacks thicker and thin ones thinner, instead of making big cards
 * look like they are printed on tissue. */
const STACK_CARD_EDGE = 0.0125;

/* A stable number from a card's name — FNV-1a, which is short, has no
 * dependencies and spreads names that differ by one letter. What matters here
 * is only that it is a pure function of the string: the same name has to give
 * the same angle in this render, in the next one, and on another device. */
function stackHash(name) {
  const text = String(name == null ? '' : name);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/* The angle a named card lies at, in degrees, never further from square than
 * STACK_JITTER_MAX. Rounded to a tenth of a degree because that is more
 * precision than an eye or a stylesheet needs, and it keeps the inline style
 * short in a mat that may carry a hundred of them.
 *
 * `|| 0` is the sign of nothing: the middle of the range rounds to -0, which
 * is the same angle written as a different number. */
function stackJitter(name) {
  const spread = STACK_JITTER_MAX * 2;
  const turn = (stackHash(name) % 1001) / 1000 * spread - STACK_JITTER_MAX;
  return Math.round(turn * 10) / 10 || 0;
}

/* How many edges to draw beneath the face card, from the number of cards the
 * stack holds. Three things bound it, and the smallest wins:
 *
 *   STACK_LAYERS_MAX  the cost ceiling — four hundred cards paint like ten
 *   cards - 1         a stack cannot show more edges than it has cards under
 *                     the top one, or a pair would look like a brick
 *   2·log₂(cards)     the shape: thickness that grows quickly at the sizes a
 *                     deck's categories actually are (four cards to forty)
 *                     and then flattens, the way a real pile does — the
 *                     difference between four and thirty is obvious, and the
 *                     difference between three hundred and four hundred is
 *                     not worth drawing.
 *
 * Each of the three is non-decreasing in the count, so the whole is: adding a
 * card to a stack can never make it look thinner. */
function stackLayers(count) {
  const cards = Math.floor(Number(count) || 0);
  if (cards < 2) return 0;
  return Math.min(STACK_LAYERS_MAX, cards - 1, Math.round(2 * Math.log2(cards)));
}

/* The markup for one stack.
 *
 *   cards   [{ name, img }] in the order they lie, face first. The names of
 *           the cards under the face are what their edges are angled by; a
 *           stack holding more copies than distinct cards runs through them
 *           again, since a pile of thirty Forests really is a pile of one
 *           card thirty times.
 *   count   what the stack says it holds, when that is not simply how many
 *           entries it was given — the Deck Builder counts copies, not rows.
 *   attrs   markup for the stack element itself: what clicking it does, and
 *           what it is a stack of. The renderer has no opinion on either.
 *
 * The depth and the angles travel as custom properties rather than as written
 * pixels, so the geometry stays in the stylesheet where the card-size control
 * can reach it. */
function cardStackHtml(cards, { count, attrs = '' } = {}) {
  if (!cards || !cards.length) return '';
  const held  = Number.isFinite(count) ? count : cards.length;
  const depth = stackLayers(held);

  /* Deepest first, so the pile is drawn from the table upwards. */
  const layers = [];
  for (let i = depth; i >= 1; i--) {
    const under = cards[i % cards.length];
    layers.push(`<div class="card-stack-layer" style="--stack-i:${i};--stack-turn:${stackJitter(under.name)}deg"></div>`);
  }

  const face = cards[0];
  /* A card that has no artwork is not a card, so it does not pretend to be
   * one: the placeholder keeps the hairline and fill that a card refuses,
   * exactly as the grids' does. */
  const faceHtml = face.img
    ? `<img class="card-img card-stack-face" src="${face.img}" loading="lazy" alt="${esc(face.name)}">`
    : `<div class="card-stack-face card-stack-blank"></div>`;

  return `<div class="card-stack" style="--stack-depth:${depth};--stack-turn:${stackJitter(face.name)}deg" ${attrs}>
    ${layers.join('')}
    ${faceHtml}
    <span class="card-stack-count">${held}</span>
  </div>`;
}
