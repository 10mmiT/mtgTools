// ── Picking a card up ─────────────────────────────────────────────────────
// Pointing at a card lifts it off the table: it rises, grows a little, leans
// towards the pointer, and a band of light crosses its face.
//
// One listener for the whole app. The lift is written against .card-img — the
// class every card image already wears — rather than against six tabs' markup,
// so a card picked up in Collections, in Scryfall Search, in the Set Browser,
// in Want Lists, in Pick Night or in the Deck Builder is picked up the same
// way, and so is a card image added to a seventh place next year.
//
// What is here and what is in components.css: the two constants of the lift —
// how far a card rises and how much it grows — are tokens, because they are
// the same for every card. The lean is not a constant. It is a function of
// where in the card the pointer is, which is a question CSS cannot ask, so
// cardTilt() answers it and hands the answer over as two custom properties on
// the wrapper; cardSheen() does the same for the angle of the light. Those two
// are the decisions in this file, and they are written as functions of their
// inputs so that they can be asserted rather than eyeballed.
//
// Nothing here changes a layout box. The transform is drawn from the card's
// laid-out box and applied to the card's own pixels, so the grid never reflows
// and the pointer cannot fall off a card that grew under it.
//
// Motion is asked on every move rather than read once at load, so unticking
// "Cards move" — or an operating system that starts asking for less movement
// mid-session — stops the lift with no listener to unwind. cardMotionOn()
// (js/motion.js) is the one place that question is answered, for CSS and for
// JS alike.
//
// What the switch does not turn off is the card knowing it is being reached
// for: the pointer's card is marked either way, and takes the deeper shadow of
// something held rather than lying down. A shadow is a state and not a
// movement. That mark is made here rather than by a :hover rule so that the
// kind of pointer decides it — CSS cannot ask, and a hover state on a
// touchscreen outlives the finger that caused it.

/* How far a card may lean, in degrees. Small on purpose: this is a card
 * catching the light, not a card being turned over. */
const CARD_TILT_MAX = 6;

/* Where the pointer is within a card's own box, as two fractions running from
 * -1 at the left and top edges through 0 at the centre to 1 at the right and
 * bottom. A point outside the box is clamped to its edge, which is what keeps
 * everything derived from this bounded whatever it is asked; a box with no
 * size answers "the centre" rather than dividing by zero. */
function cardPointerOffset(x, y, width, height) {
  const fraction = (along, size) =>
    (size > 0 ? Math.min(1, Math.max(0, along / size)) * 2 - 1 : 0);
  return { across: fraction(x, width), down: fraction(y, height) };
}

/* The lean, in degrees about the two axes in the card's own plane: the corner
 * nearest the pointer rises to meet it. Zero at the centre — a card pointed at
 * dead-on is square to the eye — and never further from it than CARD_TILT_MAX.
 *
 * x is the rotation about the horizontal axis and y the one about the
 * vertical, named for the CSS functions they are handed to. */
function cardTilt(x, y, width, height) {
  const { across, down } = cardPointerOffset(x, y, width, height);
  /* `|| 0` is the sign of nothing: negating a fraction of zero gives -0, the
   * same angle written as a different number, and the centre is worth stating
   * as one value rather than two. */
  return { x: down * CARD_TILT_MAX || 0, y: -across * CARD_TILT_MAX || 0 };
}

/* Where the light falls: a band across the card's face, running through the
 * pointer. Its angle is the direction from the centre of the card to the
 * pointer, in the angle a CSS gradient takes — zero pointing up, growing
 * clockwise — and the band itself slides along that direction as the pointer
 * moves out towards an edge, so the light sweeps the face rather than pivoting
 * about the middle of it.
 *
 * The centre is the one input with no direction to give, and the one atan2
 * would answer arbitrarily, so it is answered here instead: a band straight
 * across the card. */
function cardSheen(x, y, width, height) {
  const { across, down } = cardPointerOffset(x, y, width, height);
  const reach = Math.min(1, Math.hypot(across, down));
  if (!reach) return { angle: 0, pos: 50 };
  return {
    angle: Math.round(Math.atan2(across, -down) * 180 / Math.PI),
    pos: Math.round(50 + reach * 26),
  };
}

// ── The wiring ────────────────────────────────────────────────────────────

/* Everything the lift writes onto the wrapper, so that putting the card down
 * leaves nothing behind. */
const LIFT_VARS = [
  '--lift-tilt-x', '--lift-tilt-y',
  '--lift-left', '--lift-top', '--lift-width', '--lift-height',
  '--sheen-angle', '--sheen-pos',
];

let heldImg     = null;   // the card image under the pointer, or null
let liftedHost  = null;   // the element it hangs in, marked while it may move
let liftedPosed = false;  // whether that element was positioned by us
let pendingLift = null;   // the newest pointer reading, waiting for a frame
let liftFrame   = 0;

/* The card's box as it is laid out rather than as it is drawn. offsetLeft and
 * its siblings are layout, which a transform does not touch;
 * getBoundingClientRect() would measure the lifted card, and a lean computed
 * from an already-leaning box feeds back on itself — the card would go on
 * drifting under a pointer that had stopped moving.
 *
 * The offsets are relative to the wrapper, which the lift has just made a
 * positioning context, and which draws no border of its own — a card wears its
 * own edge and the tiles around them are gone. */
function cardRestBox(img) {
  const origin = img.offsetParent || img.parentElement;
  const box = origin.getBoundingClientRect();
  return {
    left:   box.left + img.offsetLeft,
    top:    box.top  + img.offsetTop,
    width:  img.offsetWidth,
    height: img.offsetHeight,
  };
}

/* The card the pointer is on. This much happens whether or not cards may
 * move: a card being reached for drops a deeper shadow, which is a change of
 * state rather than a movement, and is what the lift leaves behind when
 * motion is off. It is marked from here rather than with :hover so that a
 * finger cannot leave it marked — a touch pointer never reaches this far. */
function holdCard(img) {
  img.classList.add('card-held');
  heldImg = img;
}

/* And the rest of it, which is movement and so is the preference's to refuse:
 * the image, which is what moves, and the wrapper it hangs in, which holds the
 * sheen and the stacking context that puts the card in front of its
 * neighbours. */
function raiseCard(img) {
  const host = img.parentElement;
  if (!host) return false;
  /* The sheen is drawn as the wrapper's ::after and is placed against it, so
   * the wrapper has to be a positioning context — but only where it is not one
   * already. Overwriting a position the app chose would be a real bug rather
   * than a cosmetic one: the card detail's image column is sticky, and a
   * relative one does not stick. */
  liftedPosed = getComputedStyle(host).position === 'static';
  if (liftedPosed) host.style.position = 'relative';
  host.classList.add('card-lift-host');
  img.classList.add('card-lifted');
  liftedHost = host;
  return true;
}

/* Back onto the table, still under the pointer: what happens when the answer
 * to "may cards move?" changes while a card is up. */
function lowerCard() {
  if (!liftedHost) return;
  if (heldImg) heldImg.classList.remove('card-lifted');
  liftedHost.classList.remove('card-lift-host');
  for (const name of LIFT_VARS) liftedHost.style.removeProperty(name);
  if (liftedPosed) liftedHost.style.removeProperty('position');
  liftedHost = null;
}

/* Let go of it altogether, leaving the markup as it was found. */
function dropCard() {
  lowerCard();
  if (!heldImg) return;
  heldImg.classList.remove('card-held');
  heldImg = null;
}

/* One write per frame however many moves arrive in it: a grid is a hundred
 * cards, and a pointer crossing it reports far more often than the screen can
 * show. */
function paintCardLift() {
  liftFrame = 0;
  const move = pendingLift;
  if (!move) return;

  if (move.img !== heldImg) {
    dropCard();
    holdCard(move.img);
  }
  /* Motion off is the pointer still being on the card and the card staying
   * where it is: held, not lifted. Asked here rather than at the door so that
   * unticking the preference with a card already up puts it down. */
  if (!move.moving) { lowerCard(); return; }
  if (!liftedHost && !raiseCard(move.img)) return;

  const box   = cardRestBox(move.img);
  const x     = move.x - box.left;
  const y     = move.y - box.top;
  const tilt  = cardTilt(x, y, box.width, box.height);
  const sheen = cardSheen(x, y, box.width, box.height);

  const set = (name, value) => liftedHost.style.setProperty(name, value);
  set('--lift-tilt-x', `${tilt.x.toFixed(2)}deg`);
  set('--lift-tilt-y', `${tilt.y.toFixed(2)}deg`);
  set('--lift-left',   `${move.img.offsetLeft}px`);
  set('--lift-top',    `${move.img.offsetTop}px`);
  set('--lift-width',  `${box.width}px`);
  set('--lift-height', `${box.height}px`);
  set('--sheen-angle', `${sheen.angle}deg`);
  set('--sheen-pos',   `${sheen.pos}%`);
}

function onCardPointerMove(e) {
  /* A finger is not a pointer that hovers. It arrives on the card it is about
   * to tap and then leaves the page altogether, so a card lifted by a touch
   * would stay lifted after the finger had gone — the one hover state a
   * touchscreen has no way to clear. Dragging on touch is out of scope for the
   * same reason; a mouse and a pen are both welcome here. */
  if (e.pointerType === 'touch') return;

  const img = e.target && e.target.closest ? e.target.closest('.card-img') : null;
  if (!img) { dropCard(); return; }

  /* Read on every move rather than once at load: the preference can be
   * changed and the operating system's can change under it, both while the
   * page is open and neither with anything to unwind here. */
  pendingLift = { img, x: e.clientX, y: e.clientY, moving: cardMotionOn() };
  if (!liftFrame) liftFrame = requestAnimationFrame(paintCardLift);
}

document.addEventListener('pointermove', onCardPointerMove, { passive: true });

/* The ways a pointer can leave a card without moving off it: out of the
 * window, taken away by the system, gone to drag something, or the window
 * losing focus under it. A card left lifted with nothing pointing at it is
 * exactly the trail this is not allowed to leave. */
document.addEventListener('pointerleave', dropCard);
document.addEventListener('pointercancel', dropCard);
document.addEventListener('dragstart', dropCard);
window.addEventListener('blur', dropCard);
