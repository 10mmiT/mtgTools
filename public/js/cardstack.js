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
function cardFanHtml({ name, img, badge, href, back }) {
  const picture = img
    ? `<img class="card-img" src="${img}" loading="lazy" alt="${esc(name)}">`
    : `<div class="card-stack-blank"></div>`;
  const spin = `--stack-turn:${stackJitter(name)}deg`;
  const turnable = !!back;
  const card = `<a class="card-fan-card card-open"${turnable ? '' : ` style="${spin}"`}
    data-name="${esc(name)}" href="${href || '#'}" target="_blank" rel="noopener" title="${esc(name)}">
    ${picture}
    ${badge ? `<span class="card-fan-badge">${esc(badge)}</span>` : ''}
  </a>`;
  /* A card with a back is the same card in a slot. The angle it lies at moves
     out to the slot with it, because the overlap and the angle are the fan's
     rules about its own direct children — and the control has to be outside
     the link, which is not allowed to contain a button. A card with one side
     is not wrapped, so a fan of ordinary cards is the fan it always was. */
  return turnable ? cardTurnableHtml(card, back, { cls: 'card-fan-slot', style: spin }) : card;
}

/* The markup for a row of piles.
 *
 *   groups  [{ label, cards }] as sortui.js's cardGroups() cuts them
 *   settled the labels of the piles that have been settled — a set, and empty
 *           is the table as it arrives: every pile spread
 *   cardOf  a card, as this tab holds it, seen as
 *           { name, img, badge, href, back } — `back` being the card's other
 *           picture when it has one, which is what a fanned card is turned
 *           over to show and what decides whether it can be turned at all
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

// ── Where the piles go ─────────────────────────────────────────────────────
// A pile starts where the pile above it ended.
//
// Piles wrapped as flex items before this, and a wrapped row is as tall as the
// tallest thing in it: a table sorted by mana value put its two-card pile of
// eights beside its forty-card pile of twos, and the next row began below the
// forty. Every short pile paid for the tallest one on its row, and a table of
// twelve piles could be most of a screen of nothing. What was wanted is what a
// real table does — you put the next pile down in the first gap, not in the
// next row.
//
// Both tables get it, because they are the same arrangement: the Deck Builder's
// categories and the browsing tabs' stacks. The layout is measured and written
// rather than declared, because there is no stylesheet that does this — CSS
// masonry is still not something that can be shipped, and multi-column would
// fill down each column in turn, which would take the row of piles the sort
// cut left-to-right and read it top-to-bottom instead. The order piles are in
// is the whole meaning of a table of them: by mana value it is the curve.
//
// The decision is pileMasonryPlan(), a function of the sizes it is given and
// nothing else, so it can be asserted rather than eyeballed. layOutPiles() is
// the measuring and the writing around it.

/* The class the stylesheet reads: while it is on, the container positions its
 * own children and nothing else does. Off — no script, or a view that is not
 * piles — and the flex wrap underneath it is still a table of piles, just one
 * with the gaps back. */
const PILE_LAID_OUT = 'piles-laid-out';

/* Where each pile goes, from how big they are and how much room there is.
 *
 *   items    [{ width, height }] in the order they are to be read
 *   width    the room across
 *   column   what one pile column is wide — the piles are all this wide, and
 *            anything wider is something else on the table (a message about
 *            the filter, an empty mat) rather than a pile
 *   gap      between columns
 *   lead     between one pile and the next one under it; the same as the gap
 *            unless the stylesheet says otherwise
 *
 * One rule, and the two cases fall out of it: an item takes as many columns as
 * it is wide, and goes in the leftmost run of that many columns whose lowest
 * point is highest. A pile is one column wide, so that reads "the shortest
 * column, and the leftmost of them when two are level" — which is what puts
 * the first row left-to-right in the order the sort cut them. Something as
 * wide as the table takes every column, so it goes below everything on the
 * table and everything after it goes below that: a band, without a rule of its
 * own.
 *
 * `height` is the table's, which is what the container has to be told: with
 * every pile positioned, nothing is left in the flow to give it one. */
function pileMasonryPlan(items, { width, column, gap = 0, lead = gap } = {}) {
  const step    = Math.max(1, (column || 0) + gap);
  const columns = Math.max(1, Math.floor((Math.max(0, width) + gap) / step));
  const bottoms = new Array(columns).fill(0);

  const places = (items || []).map(item => {
    const span = Math.min(columns,
      Math.max(1, Math.round(((item.width || column || 0) + gap) / step)));
    let at = 0;
    let top = Infinity;
    for (let first = 0; first + span <= columns; first++) {
      let lowest = 0;
      for (let i = first; i < first + span; i++) lowest = Math.max(lowest, bottoms[i]);
      /* Half a pixel, so that two columns a rounding apart still count as
       * level and the leftmost of them wins — the reading order is worth more
       * than a fraction of a pixel of tidiness. */
      if (lowest < top - 0.5) { top = lowest; at = first; }
    }
    if (!Number.isFinite(top)) top = 0;
    for (let i = at; i < at + span; i++) bottoms[i] = top + (item.height || 0) + lead;
    return { left: at * step, top, span };
  });

  /* The trailing lead is under the lowest pile and not part of the table. */
  return { columns, places, height: Math.max(0, Math.max(0, ...bottoms) - lead) };
}

/* Lay the piles out, and keep them laid out.
 *
 * Every measurement is taken before anything is written, which keeps the whole
 * pass to one layout: reading a height after writing a position would make the
 * browser settle the table between every pair of piles.
 *
 * The class goes on *first*, because it is what decides some of the sizes
 * being measured — a band is as wide as the table only once it is positioned.
 * Nothing is painted in between: the reading and the writing are one turn.
 *
 * A container with no width has nothing to lay out and is left alone, which is
 * also what a hidden tab and a mat that is not drawn yet look like. */
function layOutPiles(container) {
  if (!container || !container.children || typeof getComputedStyle !== 'function') return;
  const kids = [...container.children];
  const room = container.clientWidth;
  if (!(room > 0) || !kids.length) return;

  container.classList.add(PILE_LAID_OUT);
  const style = getComputedStyle(container);
  const gap   = parseFloat(style.columnGap) || 0;
  const lead  = parseFloat(style.rowGap)    || 0;
  const items = kids.map(kid => ({ width: kid.offsetWidth, height: kid.offsetHeight }));
  /* What a pile column is wide, asked of the piles rather than of the
   * stylesheet: they are all one width, and the narrowest thing on the table
   * is one of them whenever there is one at all. */
  const column = Math.min(...items.map(item => item.width));

  const plan = pileMasonryPlan(items, { width: room, column, gap, lead });
  kids.forEach((kid, i) => {
    kid.style.left = `${plan.places[i].left}px`;
    kid.style.top  = `${plan.places[i].top}px`;
  });
  container.style.height = `${plan.height}px`;

  _watchPiles(container, kids);
}

/* Give the table back to the stylesheet: the view is no longer piles, or the
 * tab has been emptied. Everything this wrote comes back off, including the
 * watch — a container whose children are gone has nothing to keep in place.
 *
 * A table that was never laid out has nothing to give back, which is the same
 * answer for a list view that has always been a list and for a mat that is not
 * a drawing surface at all. */
function clearPileLayout(container) {
  if (!container?.classList?.contains?.(PILE_LAID_OUT)) return;
  container.classList.remove(PILE_LAID_OUT);
  container._pileWatch?.disconnect();
  container._pileWatched = null;
  container.style.removeProperty('height');
  for (const kid of container.children || []) {
    kid.style.removeProperty('left');
    kid.style.removeProperty('top');
  }
}

/* What makes the table lay itself out again, and it is not a render.
 *
 * Two things move a pile without redrawing one. The table gets narrower or
 * wider — a window resized, or the Deck Builder's menu pushing the mat, which
 * is not a window resize at all — and the piles get taller or shorter, which
 * is the card-size slider: it writes one custom property and every card on the
 * table changes size without a single element being replaced.
 *
 * So both are watched, the container for the first and each pile for the
 * second.
 *
 * Only ever re-hung when the piles themselves have been replaced, and that is
 * load-bearing rather than an optimisation: observing a thing reports its size
 * once straight away, so a watch re-hung on every pass would answer its own
 * callback for ever. Re-laying an unchanged table changes no size this reacts
 * to, so a resize settles after a single repeat instead of chasing itself. */
function _watchPiles(container, kids) {
  if (typeof ResizeObserver !== 'function') return;
  const watched = container._pileWatched;
  if (watched && watched.length === kids.length && watched.every((el, i) => el === kids[i])) return;

  const watch = container._pileWatch ||= new ResizeObserver(() => layOutPiles(container));
  watch.disconnect();
  watch.observe(container);
  for (const kid of kids) watch.observe(kid);
  container._pileWatched = kids;
}
