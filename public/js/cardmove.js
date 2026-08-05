// ── Cards travel to where they end up ─────────────────────────────────────
// A mat that rebuilds itself destroys a card in one place and creates it in
// another, with nothing in between. You are shown the result and left to work
// out what happened: a card moved between categories, a sort reordered a
// column, a quantity closed a pile up. This file is what puts the journey
// back.
//
// It does not touch the render. The mat is rebuilt exactly as it was before —
// innerHTML, whole sections, everything replaced — and what happens instead is
// that the positions are read before the rebuild and again after, and every
// card that ended up somewhere new is put back where it was and let go. The
// browser draws the way back. That is why this can be a wrapper rather than a
// rewrite, and why it animates every re-render there will ever be rather than
// the handful someone remembered to animate: a caller that changes the deck
// and calls dbRender() gets the movement without knowing this file exists.
//
// Three decisions live here, all written as functions of their inputs so that
// they can be asserted rather than eyeballed:
//
//   cardMoveList()    which cards travel, and how far
//   cardMoveInView()  whether a journey is one anybody is watching
//   cardMoveBoxes()   where a thing on the table is — in the page's
//                     coordinates rather than the window's, so that the page
//                     scrolling under a card is not mistaken for the card
//                     moving. That distinction is not academic: removing a
//                     card can shorten the page enough that the browser
//                     scrolls it, and in the window's coordinates every card
//                     on screen would then appear to have moved at once.
//
// What may move is marked in the markup with data-moves, whose value is what
// the thing *is* — a card is its name, which is what makes a card the same
// card across a rebuild that shares no elements with the one before it. Only
// leaves are marked, never a section that contains them: a transform on a
// parent is inherited by its children, so a card inside a moving section would
// travel twice as far as it should.
//
// The movement itself is the `translate` property rather than `transform`,
// and that is load-bearing. Cards already carry transforms of their own — the
// angle a card lies at in a fanned pile, the lean of a card being pointed at —
// and `translate` composes with those instead of overwriting them, so a card
// can travel across the mat while still lying at the angle its name gave it.
//
// Motion is asked once per re-render, from cardMotionOn() (js/motion.js), the
// one place that question is answered for CSS and JS alike. With cards' motion
// off, or an operating system asking for less movement, nothing here runs at
// all: the mat is rebuilt and the cards are simply where they now are.

/* How far a thing has to have moved to be worth moving it back. A rebuild can
 * land a card a fraction of a pixel from where it was — a scrollbar's width
 * rounding differently, a font metric settling — and a card that travels half
 * a pixel is a card that flickers. */
const CARD_MOVE_MIN = 1;

/* How far beyond the window a journey still counts, in pixels. This is the
 * whole cost ceiling, and it is the reason a deck of several hundred cards
 * animates at the price of a screenful: what is animated is not what the mat
 * holds but what can be seen of it, which is bounded by the window however
 * large the deck gets. The margin is generous on purpose — a card that starts
 * just above the fold and lands just below it has been half-watched, and the
 * eye follows the last of it. */
const CARD_MOVE_REACH = 200;

/* When to stop calling a card moving, in milliseconds. Not the duration — the
 * duration is in components.css, where it belongs, and this is only the point
 * after which nothing can still be travelling however slow the machine. It is
 * deliberately far longer than the transition rather than equal to it: the
 * class it takes off carries no appearance of its own, so being late costs
 * nothing and being early would cut a card's journey short. */
const CARD_MOVE_SETTLE_MS = 800;

/* Where a thing on the table is, and how tall it is, in the page's
 * coordinates. Keyed by what it is rather than by which element it is, since
 * a rebuild keeps none of the elements and all of the things.
 *
 * Every reading is taken in one pass, before anything is written back, which
 * is what keeps the whole measurement to a single layout: reading a position
 * after writing one would make the browser re-lay-out the mat between every
 * pair of cards. */
function cardMoveBoxes(root) {
  const boxes = new Map();
  if (!root) return boxes;
  const pageX = window.scrollX || 0;
  const pageY = window.scrollY || 0;
  for (const el of root.querySelectorAll('[data-moves]')) {
    const box = el.getBoundingClientRect();
    boxes.set(el.dataset.moves, {
      el,
      left:   box.left + pageX,
      top:    box.top  + pageY,
      height: box.height,
    });
  }
  return boxes;
}

/* The window, in the same coordinates the boxes are in, so that the two can be
 * compared without either knowing where the page is scrolled to. */
function cardMoveWindow() {
  const top = window.scrollY || 0;
  return { top, bottom: top + (window.innerHeight || 0) };
}

/* Is any part of this box near enough the window to be worth drawing a journey
 * to or from? A view of nothing — a window with no height, which is what a
 * page that is not being looked at reports — is treated as seeing everything,
 * so a missing measurement can never silently switch the movement off. */
function cardMoveInView(box, view) {
  if (!view || !(view.bottom > view.top)) return true;
  return box.top + (box.height || 0) >= view.top - CARD_MOVE_REACH
      && box.top <= view.bottom + CARD_MOVE_REACH;
}

/* Which things travelled, and how far back each of them has to be put.
 *
 * The displacement is the old position minus the new one: what a card has to
 * be offset by *now* in order to be drawn where it was *then*. Letting go of
 * that offset is the journey.
 *
 * Three kinds of thing are deliberately not in the answer, and it is the same
 * answer for all three — no movement at all:
 *
 *   arrived   a card added to the deck has no old position to come from, so it
 *             is simply there. Inventing one would be inventing a story.
 *   left      a card removed from the deck no longer has an element, so there
 *             is nothing to strand: it is gone by the time this is asked.
 *   unwatched a journey that begins and ends off the screen. */
function cardMoveList(before, after, view) {
  const moves = [];
  for (const [key, box] of after) {
    const was = before.get(key);
    if (!was) continue;
    const dx = was.left - box.left;
    const dy = was.top  - box.top;
    if (Math.abs(dx) < CARD_MOVE_MIN && Math.abs(dy) < CARD_MOVE_MIN) continue;
    if (!cardMoveInView(was, view) && !cardMoveInView(box, view)) continue;
    moves.push({ key, el: box.el, dx, dy });
  }
  return moves;
}

// ── The wiring ────────────────────────────────────────────────────────────

/* The cards currently on their way somewhere, and when to stop expecting them
 * to arrive. One timer for the whole batch rather than one per card: they all
 * set off together and the class being taken off is not a deadline, only
 * tidying. */
let cardsMoving   = [];
let cardMoveTimer = 0;

/* Everything the movement writes onto a card, taken back off it. Elements that
 * a later rebuild has already replaced are harmless to write to — they are no
 * longer in the page — so this needs no check for them. */
function settleCardMoves() {
  cardMoveTimer = 0;
  for (const el of cardsMoving) {
    el.classList.remove('card-moving');
    el.style.removeProperty('translate');
  }
  cardsMoving = [];
}

/* Rebuild `root`, and let what moved travel there.
 *
 * `rebuild` is the render exactly as it was written, called once, at the point
 * it would have been called anyway — including whatever it does about the
 * scroll position, which has to have happened before the second measurement or
 * every card would be measured against a page that had jumped.
 *
 * The forced read between the two writes is the one line that cannot be left
 * out: without it the browser would coalesce "start here" and "end there" into
 * a single style change, and the card would be drawn only at the end. Reading
 * a layout property makes it settle the first of them first, which is what
 * gives the transition somewhere to start from. */
function animateCardMove(root, rebuild) {
  if (!root || !cardMotionOn()) { rebuild(); return; }

  const before = cardMoveBoxes(root);
  rebuild();
  if (!before.size) return;

  const moves = cardMoveList(before, cardMoveBoxes(root), cardMoveWindow());
  if (!moves.length) return;

  for (const move of moves) move.el.style.translate = `${move.dx}px ${move.dy}px`;
  void root.offsetHeight;
  for (const move of moves) {
    move.el.classList.add('card-moving');
    move.el.style.removeProperty('translate');
  }

  cardsMoving = moves.map(move => move.el);
  clearTimeout(cardMoveTimer);
  cardMoveTimer = setTimeout(settleCardMoves, CARD_MOVE_SETTLE_MS);
}
