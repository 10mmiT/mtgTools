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
 *   layers  how thick to draw it, when the caller knows something this does
 *           not — see pileLayers(). Never thicker than the count allows,
 *           whatever is asked for.
 *   attrs   markup for the stack element itself: what clicking it does, and
 *           what it is a stack of. The renderer has no opinion on either.
 *
 * The depth and the angles travel as custom properties rather than as written
 * pixels, so the geometry stays in the stylesheet where the card-size control
 * can reach it. */
function cardStackHtml(cards, { count, layers, attrs = '' } = {}) {
  if (!cards || !cards.length) return '';
  const held  = Number.isFinite(count) ? count : cards.length;
  const depth = Math.min(stackLayers(held), Number.isFinite(layers) ? Math.max(0, layers) : Infinity);

  /* Deepest first, so the pile is drawn from the table upwards. */
  const edges = [];
  for (let i = depth; i >= 1; i--) {
    const under = cards[i % cards.length];
    edges.push(`<div class="card-stack-layer" style="--stack-i:${i};--stack-turn:${stackJitter(under.name)}deg"></div>`);
  }

  const face = cards[0];
  /* A card that has no artwork is not a card, so it does not pretend to be
   * one: the placeholder keeps the hairline and fill that a card refuses,
   * exactly as the grids' does. */
  const faceHtml = face.img
    ? `<img class="card-img card-stack-face" src="${face.img}" loading="lazy" alt="${esc(face.name)}">`
    : `<div class="card-stack-face card-stack-blank"></div>`;

  return `<div class="card-stack" style="--stack-depth:${depth};--stack-turn:${stackJitter(face.name)}deg" ${attrs}>
    ${edges.join('')}
    ${faceHtml}
    <span class="card-stack-count">${held.toLocaleString()}</span>
  </div>`;
}

// ── A table of stacks ──────────────────────────────────────────────────────
// What the browsing tabs' stack view is: the cards laid out in labelled piles,
// spread out so that the cards in them can be seen, and settled one at a time
// into stacks by whoever wants the shape of the table instead. The piles come
// in already made — js/sortui.js cuts them from the current sort — so this
// still knows nothing about sort fields, and the two tabs that call it differ
// only in what a card's picture and its one number are.

/* How many cards a fanned pile spreads at once. The settled stack is bounded
 * by STACK_LAYERS_MAX and costs nothing whatever it holds, but a fan is real
 * cards: spreading four thousand commons would be the one place this view
 * could cost something, so it does not. The rest of the pile is reachable the
 * way it always was — narrow the search, or sort by a field that cuts finer.
 *
 * With every pile arriving spread this is the whole table's bound as well as
 * one pile's: a table is at most its number of piles times this. That is the
 * cost the spread-by-default decision buys, and it is measured rather than
 * assumed — see docs/records/piles-expanded.md. */
const STACK_FAN_MAX = 60;

/* How thick one pile in a table of them is drawn: in proportion to the tallest
 * pile on the table, rather than to what it holds outright.
 *
 * This is the difference between a mat and a table. A deck's categories run
 * from four cards to forty, which is exactly the range stackLayers() draws a
 * difference across, so the Deck Builder asks it and gets a mat whose piles
 * are as thick as they really are. A browsing tab's piles run from four to
 * twelve thousand, and every one of them is past the cap: a collection stacked
 * by rarity would be four identical bricks, and stacked by mana value it would
 * be a flat row where the curve should be. The shape of the row is the whole
 * reason to look at it, so a pile is drawn as its share of the biggest one.
 *
 * Still bounded by stackLayers(), which keeps both of that function's promises
 * here: no pile shows more edges than it has cards under the face, and none is
 * drawn thicker than the cap. Adding a card to a pile can still never make it
 * look thinner — though adding cards to the *biggest* pile now thins the rest,
 * which is what being a proportion means and what makes a curve a curve. */
function pileLayers(count, tallest) {
  const held = Math.floor(Number(count) || 0);
  const top  = Math.floor(Number(tallest) || 0);
  if (held < 2) return 0;
  if (top <= 0) return stackLayers(held);
  /* At least one edge: a pile drawn as a single card is a pile that has been
   * rounded away, and every pile on the table holds at least two cards. */
  const share = Math.max(1, Math.round(STACK_LAYERS_MAX * held / top));
  return Math.min(stackLayers(held), share);
}

// ── Which piles are settled ────────────────────────────────────────────────
// A table of stacks arrives spread. Every pile is open on the first paint, on
// all three views that draw one, and settling a pile is the thing somebody
// does — the opposite of what this was. A table of piles is a way of looking
// at cards, and a view of cards that shows none of them until you ask it to,
// one arrow at a time, is a view that has to be operated before it says
// anything.
//
// So the set each tab keeps is the labels it has been asked to *settle*, and
// absence means spread. Seeding a set of spread labels with every label on
// each render would fight the model rather than change it: a pile you settled
// would spring back open the moment a quantity edit re-rendered the table, and
// a pile that appeared because the sort changed would have to be seeded too or
// arrive settled. Inverted, all three fall out — a new pile is open because
// nothing has settled it, a settled pile stays settled because the set is not
// rebuilt, and the arrow keeps the shape it had.
//
// The set is still a set rather than one label, because piles are read against
// each other. Standing the curve up off the table and then wanting to see what
// is actually in the two tallest columns is the whole reason to look at a
// table of piles, and it cannot be done one pile at a time. Nothing here
// settles a pile you did not ask to settle, and nothing spreads one you
// settled: a table somebody has tidied down to two open piles is an
// arrangement made on purpose, and a stray click on the background is not an
// instruction to undo it.
//
// The set is the caller's, each tab keeps its own, and it is not persisted:
// reloading gives you the table fully spread again, which is the state the
// view is meant to arrive in.

/* Settle this pile, or spread it. */
function togglePile(settled, label) {
  if (settled.has(label)) settled.delete(label);
  else settled.add(label);
  return settled;
}

/* Forget the piles that are no longer on the table. A search, a filter or a
 * re-sort can cut the piles again and leave a label nothing answers to; a set
 * that kept it would be holding a pile settled for cards that have gone. It
 * also answers what happens when the label comes back for different cards: it
 * comes back spread, like any pile the table has not been asked to settle. */
function forgetGonePiles(settled, groups) {
  const here = new Set(groups.map(group => group.label));
  for (const label of settled) if (!here.has(label)) settled.delete(label);
  return settled;
}

/* The arrow that spreads a pile and settles it again.
 *
 * It is a real button with a real box rather than a character prefixed to a
 * heading, because it is the only control a pile has and the way you find a
 * control is that it looks like one. It says which way it is pointing through
 * aria-expanded rather than through a class, so the stylesheet and a screen
 * reader are reading the same fact — and there is nothing else for the state
 * to disagree with.
 *
 * The words are the caller's. This draws an arrow and has no opinion on what
 * unfolding means: on a table of piles it spreads one, and on the Deck
 * Builder's list and grid the same arrow in the same place shows a category's
 * cards, which is not a sentence this file could write.
 *
 * The button is empty because the arrow inside it is a shape components.css
 * draws rather than a character typed here — see .pile-toggle for why. Its
 * name comes from the title, which every one of these carries. */
function pileToggleHtml(open, { title = '', attrs = '' } = {}) {
  return `<button class="pile-toggle" aria-expanded="${open ? 'true' : 'false'}"
    title="${esc(title)}" ${attrs}></button>`;
}

/* One card in a fanned pile: the picture, its one number, and the click every
 * other card image in the app has. It keeps the angle its name gave its edge
 * while the stack was settled, so fanning spreads the pile that was lying
 * there rather than replacing it with a tidier one. */
function cardFanHtml({ name, img, badge, href }) {
  const picture = img
    ? `<img class="card-img" src="${img}" loading="lazy" alt="${esc(name)}">`
    : `<div class="card-stack-blank"></div>`;
  return `<a class="card-fan-card card-open" style="--stack-turn:${stackJitter(name)}deg"
    data-name="${esc(name)}" href="${href || '#'}" target="_blank" rel="noopener" title="${esc(name)}">
    ${picture}
    ${badge ? `<span class="card-fan-badge">${esc(badge)}</span>` : ''}
  </a>`;
}

/* The markup for a row of piles.
 *
 *   groups  [{ label, cards }] as sortui.js's cardGroups() cuts them
 *   settled the labels of the piles that have been settled — a set, and empty
 *           is the table as it arrives: every pile spread
 *   cardOf  a card, as this tab holds it, seen as { name, img, badge, href }
 *
 * A settled pile says how many cards it holds on the stack itself; a fanned
 * one has no stack left to say it, so the label carries the count instead —
 * and says how much of the pile is spread when it is more than a fan.
 *
 * The cap on a fan is per pile and stays that way with the whole table open.
 * Capping the table as a whole would mean a pile spreading fewer cards
 * because of a pile somewhere else on it — the number in a pile would stop
 * being a fact about that pile — and the bound that matters is the one on a
 * single fan, which is what keeps four thousand commons from being four
 * thousand elements.
 */
function cardPilesHtml(groups, { settled = new Set(), cardOf } = {}) {
  const tallest = groups.reduce((most, group) => Math.max(most, group.cards.length), 0);
  const piles = groups.map(group => {
    const open  = !settled.has(group.label);
    const held  = group.cards.length;
    const shown = open ? group.cards.slice(0, STACK_FAN_MAX) : [];
    const count = !open ? ''
      : `<span class="card-pile-count">${shown.length < held
          ? `${shown.length} of ${held.toLocaleString()}` : held.toLocaleString()}</span>`;
    /* A settled pile is drawn from its first STACK_LAYERS_MAX + 1 cards and
       told how many it stands for. That is not a shortcut: a stack draws the
       face and its bounded edges and nothing else, so those are every card it
       can possibly show, and a collection of twelve thousand costs the same to
       lay out as a pile of eleven. */
    const body = open
      ? `<div class="card-fan">${shown.map(card => cardFanHtml(cardOf(card))).join('')}</div>`
      : cardStackHtml(group.cards.slice(0, STACK_LAYERS_MAX + 1).map(cardOf),
                      { count: held, layers: pileLayers(held, tallest) });
    return `<div class="card-pile${open ? ' card-pile-open' : ''}" data-pile="${esc(group.label)}">
      <div class="card-pile-hdr">
        ${pileToggleHtml(open, {
          title: open ? `Settle ${group.label}` : `Spread ${group.label} out`,
        })}
        <span class="card-pile-label">${esc(group.label)}</span>${count}
      </div>
      ${body}
    </div>`;
  }).join('');
  return `<div class="card-piles">${piles}</div>`;
}
