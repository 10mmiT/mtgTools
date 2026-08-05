// ── Carrying a card ───────────────────────────────────────────────────────
// A card being moved from one pile to another is carried there. What the
// browser's own drag-and-drop gave instead was a translucent screenshot of a
// whole tile — footer, buttons and all — sliding under the cursor with no
// weight to it, and a drop that teleported the card into its new pile with
// nothing in between.
//
// What is carried here is the card itself. Not a copy of it, not a picture of
// it: the element the card already is, translated under the pointer and left
// in its own place in the layout, so the mat does not reflow around a hole and
// so the card that lands is the card that was picked up.
//
// That is also what makes the landing free. js/cardmove.js already animates
// every re-render of the mat by measuring where each card was before the
// rebuild and where it is after — and a carried card *is* where the hand is,
// because the transform that put it there is part of what the browser measures.
// So releasing a card over a pile needs no animation of its own: the mat is
// told to move the card, and the card's journey home from the hand is the
// journey the mat was going to draw anyway. Ticket 08 said this would be what
// let a dropped card land rather than teleport, and this is that.
//
// Three decisions live here, all written as functions of their inputs so that
// they can be asserted rather than eyeballed:
//
//   cardCarryStep()    where a card that is following the pointer has got to
//   cardCarryLean()    how far it leans, from how far behind it is
//   cardCarryTarget()  which pile would receive it, from where the pointer is
//
// The markup contract is two attributes, in the spirit of js/cardmove.js's
// data-moves — the value of each says what the thing *is*, not what to do
// about it:
//
//   data-carry   a thing that can be picked up. Its value is what it is: a
//                card's name.
//   data-drop    a place something can be put down. Its value is where that
//                is: a category.
//
// What a card released on a pile *means* is not this file's to know. It calls
// cardCarryDrop(), which the tab that owns the piles defines — the Deck
// Builder, in js/deckview-panels.js — and reads the answer: it took the card,
// or it did not and the card has to go back where it came from. The category
// assignment and the autosave stay in the deck's own edit module, which is
// where they were.
//
// Dragging is for pointing devices. A touch pointer never begins a carry, and
// no press-and-hold gesture is introduced to give it one: a delay between a
// finger and the mat scrolling is a worse thing than a phone having one way to
// recategorise instead of two, and the "Move to…" modal is that way. A stylus
// is a pointing device and carries a card like a mouse.
//
// Motion is asked on every frame rather than read once at the start, as the
// lift asks it: unticking "Cards move" mid-carry takes the lag and the lean
// away and leaves the card exactly under the pointer, which is dragging
// without motion rather than no dragging.

/* How far the pointer has to travel with the button down before a press
 * becomes a carry. Below this a press is a click — selecting a card, opening
 * a stack — and a hand is never perfectly still while it clicks. */
const CARD_CARRY_START = 4;

/* How much of the distance to the pointer a carried card covers each frame.
 * This is the whole of the lag, and it is a fraction rather than a speed so
 * that the card is always heading for where the pointer is now: it eases in
 * behind a hand that stops and never sails past it. */
const CARD_CARRY_EASE = 0.22;

/* Close enough to be there, in pixels. Without it the card approaches the
 * pointer forever in ever smaller fractions, which is a style write every
 * frame for a card nobody can see moving. */
const CARD_CARRY_ARRIVED = 1;

/* How far behind the pointer a card has to be to lean as far as it may, in
 * pixels. Roughly a card's width: at that distance the hand is moving fast
 * enough that a card in it would swing. */
const CARD_CARRY_LAG = 150;

/* How long the way back takes at most, in milliseconds — the same kind of
 * number as CARD_MOVE_SETTLE_MS in js/cardmove.js and for the same reason.
 * The duration itself is in components.css; this is only when to stop
 * expecting the card to have arrived, and it is deliberately longer than the
 * transition, because what it cleans up carries no appearance of its own. */
const CARD_CARRY_HOME_MS = 600;

/* Where a card that is following the pointer has got to, one frame on.
 *
 * `at` and `to` are displacements from where the card lies on the mat rather
 * than positions on the page: the card never leaves its own place in the
 * layout, so what is animated is how far it is from home, and the arithmetic
 * needs to know nothing about where home is.
 *
 * It closes a fraction of the gap each frame and snaps the last pixel, so a
 * hand that stops is caught up with rather than approached forever. An ease of
 * 1 is no lag at all, which is what a card is given when cards may not move. */
function cardCarryStep(at, to, ease) {
  const fraction = Math.min(1, Math.max(0, ease));
  const along = (from, toward) => {
    const gap = toward - from;
    return Math.abs(gap) <= CARD_CARRY_ARRIVED ? toward : from + gap * fraction;
  };
  return { x: along(at.x, to.x), y: along(at.y, to.y) };
}

/* How far a carried card leans, in degrees, given how far behind the pointer
 * it is across the mat. A card hurried sideways swings; a card held still
 * hangs square. This is the weight in "so it has weight" — the lag says the
 * card is heavy and the lean says which way it is being pulled.
 *
 * The derivation is the lift's, deliberately: cardPointerOffset() clamps and
 * centres the fraction and CARD_TILT_MAX bounds the angle, both in
 * js/cardlift.js, so a card leans no further in the hand than it does under
 * the pointer and there is one number in the app for how far a card may lean.
 * Here the fraction is of a distance rather than of a card's width, and the
 * card is the thing that is behind rather than the thing being pointed at.
 *
 * A card exactly under the pointer has no direction to lean in and is given
 * none: `|| 0` is there because negating a fraction of zero gives -0, and the
 * one angle a still card has is worth writing as one number. */
function cardCarryLean(behind) {
  const { across } = cardPointerOffset(CARD_CARRY_LAG + behind, 0, CARD_CARRY_LAG * 2, 0);
  return across * CARD_TILT_MAX || 0;
}

/* Which place would receive a card released at this point, or null for
 * nowhere. Points are in the page's coordinates, as the zones are, so that
 * scrolling the mat mid-carry moves neither.
 *
 * The edges belong to the pile: a pile's bounds are where it ends, and a point
 * on the boundary is a point on the pile rather than a point in the gap beside
 * it. Where two zones overlap the later one wins, because later is what the
 * page paints on top and what the eye would call the pile the card is over. */
function cardCarryTarget(x, y, zones) {
  let found = null;
  for (const zone of zones || []) {
    if (x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom) found = zone.key;
  }
  return found;
}

// ── The wiring ────────────────────────────────────────────────────────────

/* Every place a card can be put down, measured once when the carry begins.
 * The mat cannot change while a card is in hand — a re-render would take the
 * carried card with it — so one measurement holds for the whole journey, and
 * taking it once is what keeps a carry from measuring the mat on every frame.
 *
 * In the page's coordinates rather than the window's, for js/cardmove.js's
 * reason: the page can be scrolled while a card is in hand, and a pile does
 * not move because the page did. */
function cardCarryZones(root) {
  const pageX = window.scrollX || 0;
  const pageY = window.scrollY || 0;
  const zones = [];
  for (const el of (root || document).querySelectorAll('[data-drop]')) {
    const box = el.getBoundingClientRect();
    zones.push({
      el, key: el.dataset.drop,
      left:   box.left   + pageX, right:  box.right  + pageX,
      top:    box.top    + pageY, bottom: box.bottom + pageY,
    });
  }
  return zones;
}

let carryPress  = null;   // a pointer down on a card that has not moved far enough yet
let carry       = null;   // the card in hand
let carryZones  = [];     // where it could be put down
let carryOffer  = null;   // the pile currently showing that it would take it
let carryFrame  = 0;

/* Which pile is showing that it would receive the card. Only ever one, and
 * never the pile the card came from — dropping a card back where it already is
 * does nothing, and a pile that lit up for it would be saying otherwise. */
function offerCarryTo(zone) {
  if (carryOffer === zone) return;
  if (carryOffer) carryOffer.classList.remove('card-drop-target');
  if (zone) zone.classList.add('card-drop-target');
  carryOffer = zone;
}

/* One write per frame, and a frame asked for as long as the card is in hand:
 * the card goes on catching up after the pointer has stopped, which is the
 * back half of the lag. */
function paintCarry() {
  carryFrame = 0;
  if (!carry) return;

  /* Asked here rather than when the card was picked up, so that unticking
   * "Cards move" — or a system that starts asking for less movement — puts the
   * card straight under the pointer and leaves it draggable. */
  const moving = cardMotionOn();
  carry.at = cardCarryStep(carry.at, carry.to, moving ? CARD_CARRY_EASE : 1);
  carry.el.style.translate = `${carry.at.x.toFixed(1)}px ${carry.at.y.toFixed(1)}px`;

  const lean = moving ? cardCarryLean(carry.to.x - carry.at.x) : 0;
  if (lean) carry.el.style.rotate = `${lean.toFixed(2)}deg`;
  else carry.el.style.removeProperty('rotate');

  carryFrame = requestAnimationFrame(paintCarry);
}

/* Pick it up. The card keeps its place in the layout and is drawn above its
 * neighbours from there, so nothing on the mat shifts to acknowledge that a
 * card has been lifted off it.
 *
 * The pointer is captured so that the rest of the journey arrives here whatever
 * the card is dragged over — and so that nothing else sees a pointer crossing
 * it, which is what stops a carried card from leaving a trail of lifted cards
 * behind it. */
function beginCarry(press) {
  const zone = press.el.closest('[data-drop]');
  carry = {
    el:   press.el,
    id:   press.id,
    name: press.el.dataset.carry,
    from: zone ? zone.dataset.drop : null,
    at:   { x: 0, y: 0 },
    to:   { x: 0, y: 0 },
    point: { x: press.x, y: press.y },
    grab:  { x: press.x, y: press.y },
  };
  carryZones = cardCarryZones();
  carry.el.classList.add('card-carried');
  document.documentElement.classList.add('card-carrying');
  try { carry.el.setPointerCapture(press.id); } catch { /* the pointer is already gone */ }
  if (!carryFrame) carryFrame = requestAnimationFrame(paintCarry);
}

/* Everything the carry wrote, taken back off. The element may already have
 * been replaced by a re-render, which is harmless to write to — it is no
 * longer in the page. */
function endCarry(el) {
  el.classList.remove('card-carried', 'card-returning');
  el.style.removeProperty('translate');
  el.style.removeProperty('rotate');
}

/* Back where it came from, changing nothing: what releasing a card over
 * nothing means, and what a pile that will not take it means too. The card
 * travels home rather than snapping back, because it is a card being put down
 * and the eye should be able to follow it there. It stays above its neighbours
 * until it has landed. */
function returnCarry(el) {
  el.classList.add('card-returning');
  el.style.translate = '0px 0px';
  el.style.removeProperty('rotate');
  setTimeout(() => endCarry(el), CARD_CARRY_HOME_MS);
}

/* Let go. The pile under the pointer is what receives the card — the pointer
 * rather than the card, because the card is behind the hand by design and the
 * hand is what is being aimed.
 *
 * The lean comes off before the drop and the displacement does not: what the
 * mat measures next is this element where it is now, which is the hand, and
 * that is the position the card's landing is drawn from. Straight, because a
 * card measured while leaning reports the box its corners reach rather than
 * the box it covers. */
function releaseCarry() {
  const el = carry.el;
  const key = cardCarryTarget(carry.point.x, carry.point.y, carryZones);
  const to  = key !== null && key !== carry.from ? key : null;

  offerCarryTo(null);
  cancelAnimationFrame(carryFrame);
  carryFrame = 0;
  carry = null;
  carryZones = [];
  document.documentElement.classList.remove('card-carrying');

  el.style.removeProperty('rotate');
  const taken = to !== null && typeof cardCarryDrop === 'function'
    && cardCarryDrop(el.dataset.carry, to);
  /* Taken means the mat has been rebuilt and this element is not in the page
   * any more: there is nothing left to clean up and nothing to bring home. */
  if (!taken) returnCarry(el);
}

// ── The pointer ───────────────────────────────────────────────────────────

function onCarryPointerDown(e) {
  /* Whatever is left armed from the last carry is spent: the click it was
   * waiting for has either happened or is never going to, and a swallow left
   * lying about would eat a click somebody meant. */
  document.removeEventListener('click', swallowCarryClick, true);
  /* A finger never picks a card up. It is not that a carry on touch would be
   * hard to draw — it is that the gesture is already spoken for: the mat is
   * scrolled with it, and there is no way to tell a drag from a scroll without
   * waiting to see, which means a delay between a finger and the page moving.
   * The "Move to…" modal is the way to recategorise there, as it has always
   * had to be. */
  if (e.pointerType === 'touch') return;
  /* The primary button, and only while nothing else is held: a right-click is
   * a context menu and a middle-click is a scroll. */
  if (e.button !== 0) return;
  const target = e.target;
  if (!target || !target.closest) return;
  /* A control on a card is a control, not a handle. The buttons on a card —
   * the info button, the quantity steppers, remove, move — are small and are
   * pressed with the pointer already moving off them. */
  if (target.closest('button')) return;
  const el = target.closest('[data-carry]');
  if (!el) return;
  carryPress = { el, id: e.pointerId, x: e.clientX + (window.scrollX || 0), y: e.clientY + (window.scrollY || 0) };
}

function onCarryPointerMove(e) {
  const x = e.clientX + (window.scrollX || 0);
  const y = e.clientY + (window.scrollY || 0);

  if (!carry) {
    if (!carryPress || e.pointerId !== carryPress.id) return;
    if (Math.abs(x - carryPress.x) < CARD_CARRY_START
     && Math.abs(y - carryPress.y) < CARD_CARRY_START) return;
    beginCarry(carryPress);
    carryPress = null;
  } else if (e.pointerId !== carry.id) {
    /* A second pointer crossing the page while a card is in hand is not the
     * hand that is carrying it. */
    return;
  }

  carry.point = { x, y };
  carry.to    = { x: x - carry.grab.x, y: y - carry.grab.y };

  const key  = cardCarryTarget(x, y, carryZones);
  const zone = key !== null && key !== carry.from
    ? carryZones.find(z => z.key === key) : null;
  offerCarryTo(zone ? zone.el : null);

  if (!carryFrame) carryFrame = requestAnimationFrame(paintCarry);
}

function onCarryPointerUp() {
  carryPress = null;
  if (carry) releaseCarry();
}

/* The pointer taken away rather than lifted — a system gesture, a window
 * losing it. The card was never dropped anywhere, so it goes home. */
function cancelCarry() {
  carryPress = null;
  if (!carry) return;
  const el = carry.el;
  offerCarryTo(null);
  cancelAnimationFrame(carryFrame);
  carryFrame = 0;
  carry = null;
  carryZones = [];
  document.documentElement.classList.remove('card-carrying');
  returnCarry(el);
}

/* The click that a release fires on the card it was released over. A carry is
 * not a click on the card it started from — it would toggle the selection of
 * the card that had just been carried somewhere — so the next one is swallowed,
 * in the capture phase, before the card's own handler is reached. One click
 * only: a real click after the carry is a real click. */
function swallowCarryClick(e) {
  document.removeEventListener('click', swallowCarryClick, true);
  e.stopPropagation();
  e.preventDefault();
}

document.addEventListener('pointerdown', onCarryPointerDown, true);
document.addEventListener('pointermove', onCarryPointerMove);
document.addEventListener('pointerup', () => {
  const carried = !!carry;
  onCarryPointerUp();
  if (carried) document.addEventListener('click', swallowCarryClick, true);
});
document.addEventListener('pointercancel', cancelCarry);
window.addEventListener('blur', cancelCarry);

/* The browser's own drag, refused. An <img> is draggable without being asked,
 * so a card dragged by its artwork would start a native drag alongside this
 * one — a ghost image under the cursor and a carried card underneath it. */
document.addEventListener('dragstart', e => {
  if (carry || (e.target && e.target.closest && e.target.closest('[data-carry]'))) e.preventDefault();
});
