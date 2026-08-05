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
// What is picked up may be more than one card. A card that is part of a
// selection brings the rest of it with it, as a handful: the card the hand
// closed on stays under the pointer and the others gather to it and spread
// into a small fan, so that moving twenty cards looks like moving twenty
// cards. They are the cards themselves as well — each one lifted out of
// wherever on the mat it was lying — so the landing is free for a handful for
// the same reason it is free for one.
//
// Five decisions live here, all written as functions of their inputs so that
// they can be asserted rather than eyeballed:
//
//   cardCarryStep()    where a card that is following the pointer has got to
//   cardCarryLean()    how far it leans, from how far behind it is
//   cardCarryTarget()  which pile would receive it, from where the pointer is
//   cardCarryFan()     where a card lies in the handful it is part of
//   cardCarryAim()     where that puts it, from where it was lying
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
// Builder, in js/deckview-panels.js — and reads the answer: it took the cards,
// or it did not and they have to go back where they came from. Which cards a
// card brings with it is the same tab's answer, through cardCarryHandful():
// what a selection is belongs to the mat that has one, and this file only
// knows that a hand may close on several cards at once. The category
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

/* How far a handful spreads, as a fraction of the size of the card being
 * carried — across the fan and up it. This is the whole spread rather than
 * the step between two cards: a hand holds what it holds, so a handful of
 * twenty is the same size as a handful of three and only packed tighter. */
const CARD_FAN_REACH = 0.42;
const CARD_FAN_RISE  = 0.10;

/* And how far round the fan turns, in degrees, from the card in the hand to
 * the last card behind it. Not a lean: a leaning card is one being pulled
 * through the air and CARD_TILT_MAX is how far it may go, where this is the
 * shape of a handful standing still. The two add up on the same card, which
 * is what a fan of cards swung sideways does. */
const CARD_FAN_TURN = 8;

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

/* Where the index-th card of a handful of `count` lies, relative to the card
 * in the hand. Card 0 *is* the card in the hand: it stays exactly where it was
 * grabbed, square and under the pointer, and the rest fan out behind it.
 *
 * The spread is a fraction of the card rather than a number of pixels, so a
 * handful is the same handful whatever the card-size control is set to. Which
 * measurement of the card, though, depends on what the mat is drawing: in the
 * grid and the piles a card is a card and its width is the smaller way across
 * it, but in the list view a card is a row as wide as the mat, and a fan
 * spread across *that* would be cards thrown down a table. The narrow way
 * across the thing being carried is a card's width in the one case and a row's
 * height in the other, and both are the size of the thing in the hand.
 *
 * The turn is bounded by the same shape, for the same reason from the other
 * side: eight degrees on a card sweeps its corner a few pixels, and eight
 * degrees on a row as wide as the mat sweeps its far end off the page. A wide
 * thing turns less, in proportion to how card-shaped it is, so a handful of
 * rows is a neat stack of papers and a handful of cards is a fan. */
function cardCarryFan(index, count, width, height) {
  if (index <= 0 || count <= 1) return { x: 0, y: 0, turn: 0 };
  const along = Math.min(index, count - 1) / (count - 1);
  const size  = Math.min(width, height);
  const card  = width > 0 ? Math.min(1, height / width) : 1;
  return {
    x:     along * CARD_FAN_REACH * size,
    y:    -along * CARD_FAN_RISE  * size,
    turn:  along * CARD_FAN_TURN  * card,
  };
}

/* How far a card has to be moved to be in the hand, given where the hand is,
 * where the card is lying and where in the fan it belongs.
 *
 * Everything a carry writes is a displacement rather than a position, because
 * a carried card keeps its own place in the layout — so a card at the far end
 * of the mat and a card lying beside the hand are aimed at the same place and
 * given very different numbers to get there. This is that subtraction, and it
 * is the whole of what makes a handful gather: every card is told where the
 * hand is, and each one answers with its own way there. */
function cardCarryAim(hand, origin, fan) {
  return { x: hand.x + fan.x - origin.x, y: hand.y + fan.y - origin.y };
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
let carry       = null;   // the handful in hand
let carryZones  = [];     // where it could be put down
let carryOffer  = null;   // the pile currently showing that it would take it
let carryFrame  = 0;

/* Which cards come with the one being picked up. The mat is asked, because
 * what a selection is belongs to the mat that has one; a tab with no answer
 * carries one card, which is what every tab did before there was a question.
 *
 * An answer the card itself is not in is an answer to a different question —
 * the card in the hand is the card being carried — so it is refused rather
 * than patched, and the hand closes on the one card. */
function carryHandful(name) {
  const asked = typeof cardCarryHandful === 'function' ? cardCarryHandful(name) : null;
  return Array.isArray(asked) && asked.includes(name) ? asked : [name];
}

/* The handful's cards, in the order they are held: the one that was picked up
 * first, and the rest in the order the mat draws them.
 *
 * A name with nothing on the mat to it is still in the handful — a card in a
 * settled pile, or one the search is filtering out, is selected and will be
 * moved — there is simply nothing of it to carry. So this can be shorter than
 * the handful, and what is dropped is the names rather than what was drawn. */
function carryHandfulCards(lead, names) {
  const wanted = new Set(names);
  const els = [lead];
  for (const el of document.querySelectorAll('[data-carry]')) {
    if (el !== lead && wanted.has(el.dataset.carry)) els.push(el);
  }
  return els;
}

/* The pile a handful came from, which is the pile every one of its cards came
 * from. Dropping a card back where it already is does nothing, and that is
 * what `from` is for — but a handful gathered out of several piles came from
 * nowhere in particular, and every pile on the mat is somewhere new for at
 * least one of its cards.
 *
 * A handful with a card the mat is not drawing has no home either, for the
 * same reason read the other way: that card may be lying in any category at
 * all, so dropping the handful on the pile the hand reached into is a real
 * move and has to be offered. */
function carryHandfulFrom(els, names) {
  if (els.length !== names.length) return null;
  let from = null;
  for (const el of els) {
    const zone = el.closest('[data-drop]');
    if (!zone) return null;
    if (from === null) from = zone.dataset.drop;
    else if (from !== zone.dataset.drop) return null;
  }
  return from;
}

/* Which pile is showing that it would receive the card. Only ever one, and
 * never the pile the card came from — dropping a card back where it already is
 * does nothing, and a pile that lit up for it would be saying otherwise. */
function offerCarryTo(zone) {
  if (carryOffer === zone) return;
  if (carryOffer) carryOffer.classList.remove('card-drop-target');
  if (zone) zone.classList.add('card-drop-target');
  carryOffer = zone;
}

/* One write per frame per card, and a frame asked for as long as the handful
 * is in hand: the cards go on catching up after the pointer has stopped, which
 * is the back half of the lag.
 *
 * Every card in a handful is following the same hand with the same lag, so
 * they arrive together and lean together — one hand, moving one way. What each
 * card has of its own is where it is coming from and where in the fan it is
 * going, and the fan's turn is added to the hand's lean rather than replacing
 * it, so a handful hurried sideways swings as one fanned thing. */
function paintCarry() {
  carryFrame = 0;
  if (!carry) return;

  /* Asked here rather than when the cards were picked up, so that unticking
   * "Cards move" — or a system that starts asking for less movement — puts the
   * hand straight under the pointer and leaves it draggable. The fan itself
   * stays: how a handful is arranged is not motion, any more than the angle a
   * card lies at in a pile is. */
  const moving = cardMotionOn();
  const ease   = moving ? CARD_CARRY_EASE : 1;
  const lead   = carry.cards[0];

  lead.at = cardCarryStep(lead.at, lead.to, ease);
  const lean = moving ? cardCarryLean(lead.to.x - lead.at.x) : 0;

  for (const card of carry.cards) {
    if (card !== lead) card.at = cardCarryStep(card.at, card.to, ease);
    card.el.style.translate = `${card.at.x.toFixed(1)}px ${card.at.y.toFixed(1)}px`;
    const turn = lean + card.fan.turn;
    if (turn) card.el.style.rotate = `${turn.toFixed(2)}deg`;
    else card.el.style.removeProperty('rotate');
  }

  carryFrame = requestAnimationFrame(paintCarry);
}

/* Where the handful is going, from where the hand is. The card that was picked
 * up is aimed at the pointer by the point on it that was grabbed, so it stays
 * under the hand exactly where it was taken hold of; every other card is aimed
 * at that card's place in the page plus its own place in the fan.
 *
 * Written on each move rather than each frame: it is a function of where the
 * pointer is, and the frames in between are the cards catching up with it. */
function aimCarry(x, y) {
  const lead = carry.cards[0];
  carry.point = { x, y };
  lead.to = { x: x - carry.grab.x, y: y - carry.grab.y };

  const hand = { x: lead.origin.x + lead.to.x, y: lead.origin.y + lead.to.y };
  for (const card of carry.cards) {
    if (card !== lead) card.to = cardCarryAim(hand, card.origin, card.fan);
  }
}

/* Pick it up. Each card keeps its place in the layout and is drawn above its
 * neighbours from there, so nothing on the mat shifts to acknowledge that a
 * card has been lifted off it — and the mat does not close up behind a handful
 * that may yet come back.
 *
 * Where every card is lying is measured now, once, for the same reason the
 * piles are: the mat cannot change while cards are in hand, and a carry that
 * measured the page every frame would be a carry that stuttered.
 *
 * The pointer is captured by the card that was grabbed, so that the rest of
 * the journey arrives here whatever the handful is dragged over — and so that
 * nothing else sees a pointer crossing it, which is what stops a carried card
 * from leaving a trail of lifted cards behind it. */
function beginCarry(press) {
  const names = carryHandful(press.el.dataset.carry);
  const els   = carryHandfulCards(press.el, names);
  const box   = press.el.getBoundingClientRect();
  const pageX = window.scrollX || 0;
  const pageY = window.scrollY || 0;

  carry = {
    id:    press.id,
    names,
    from:  carryHandfulFrom(els, names),
    point: { x: press.x, y: press.y },
    grab:  { x: press.x, y: press.y },
    cards: els.map((el, i) => {
      const at = el.getBoundingClientRect();
      return {
        el,
        origin: { x: at.left + pageX, y: at.top + pageY },
        fan:    cardCarryFan(i, els.length, box.width, box.height),
        at:     { x: 0, y: 0 },
        to:     { x: 0, y: 0 },
      };
    }),
  };
  carryZones = cardCarryZones();
  for (const card of carry.cards) card.el.classList.add('card-carried');
  /* The card the hand closed on is the card on top of the handful, and the one
   * that says how many cards are in it — the whole handful, including the ones
   * the mat is not drawing, because they are going where it goes. */
  press.el.classList.add('card-carried-lead');
  if (names.length > 1) press.el.dataset.carryCount = names.length;
  document.documentElement.classList.add('card-carrying');
  try { press.el.setPointerCapture(press.id); } catch { /* the pointer is already gone */ }
  if (!carryFrame) carryFrame = requestAnimationFrame(paintCarry);
}

/* Everything the carry wrote, taken back off. The element may already have
 * been replaced by a re-render, which is harmless to write to — it is no
 * longer in the page. */
function endCarry(el) {
  el.classList.remove('card-carried', 'card-carried-lead', 'card-returning');
  delete el.dataset.carryCount;
  el.style.removeProperty('translate');
  el.style.removeProperty('rotate');
}

/* Back where it came from, changing nothing: what releasing a card over
 * nothing means, and what a pile that will not take it means too. The card
 * travels home rather than snapping back, because it is a card being put down
 * and the eye should be able to follow it there. It stays above its neighbours
 * until it has landed. */
function returnCarry(el) {
  /* No longer in anybody's hand, so no longer the card on top of one and no
   * longer the one saying how many there are: what is left of the carry is a
   * card on its way back to where it was lying. */
  el.classList.remove('card-carried-lead');
  delete el.dataset.carryCount;
  el.classList.add('card-returning');
  el.style.translate = '0px 0px';
  el.style.removeProperty('rotate');
  setTimeout(() => endCarry(el), CARD_CARRY_HOME_MS);
}

/* Let go. The pile under the pointer is what receives the handful — the
 * pointer rather than the cards, because they are behind the hand by design
 * and the hand is what is being aimed.
 *
 * What is dropped is the names, not the elements: a handful can hold cards the
 * mat is not drawing, and they go where the hand goes. The lean comes off
 * before the drop and the displacement does not: what the mat measures next is
 * these elements where they are now, which is the hand, and that is the
 * position each card's landing is drawn from. Straight, because a card
 * measured while leaning reports the box its corners reach rather than the box
 * it covers. */
function releaseCarry() {
  const cards = carry.cards;
  const names = carry.names;
  const key   = cardCarryTarget(carry.point.x, carry.point.y, carryZones);
  const to    = key !== null && key !== carry.from ? key : null;

  offerCarryTo(null);
  cancelAnimationFrame(carryFrame);
  carryFrame = 0;
  carry = null;
  carryZones = [];
  document.documentElement.classList.remove('card-carrying');

  for (const card of cards) card.el.style.removeProperty('rotate');
  const taken = to !== null && typeof cardCarryDrop === 'function'
    && cardCarryDrop(names, to);
  /* Taken means the mat has been rebuilt and these elements are not in the
   * page any more: there is nothing left to clean up and nothing to bring
   * home. Not taken means every one of them goes back, including the ones that
   * were never going to move. */
  if (!taken) for (const card of cards) returnCarry(card.el);
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
    /* A second pointer crossing the page while cards are in hand is not the
     * hand that is carrying them. */
    return;
  }

  aimCarry(x, y);

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
 * losing it. The cards were never dropped anywhere, so they go home. */
function cancelCarry() {
  carryPress = null;
  if (!carry) return;
  const cards = carry.cards;
  offerCarryTo(null);
  cancelAnimationFrame(carryFrame);
  carryFrame = 0;
  carry = null;
  carryZones = [];
  document.documentElement.classList.remove('card-carrying');
  for (const card of cards) returnCarry(card.el);
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
