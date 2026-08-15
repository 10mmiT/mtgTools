// ── Turning a card over ───────────────────────────────────────────────────
// A transforming card, a modal double-faced one, a battle: two pictures and
// one piece of cardboard. Every grid in this app draws the front of it and
// stops there, so the only way to see the other side is to leave the view you
// are in. This turns it over where it lies.
//
// What has a back is not a list of layouts kept here. It is _scryfallFaces()
// in js/scryfall.js — the same answer the hover preview draws two pictures
// from — which asks the card what pictures it has rather than what layout it
// claims. A split card and a Room have faces and one picture, so they
// correctly answer "one" and get no control, and neither does an ordinary
// card. The affordance means something precisely because it is not offered
// where it would mean nothing.
//
// Where the control is drawn is a size rather than a list of views: the grids
// and the fanned piles, where a card is drawn big enough to read. A list row's
// 58px thumbnail is not a card you turn over, it is an index — and it is
// exactly the size the hover preview exists for, which already lays both faces
// out beside each other. That is tipWanted()'s rule in js/main.js, said as a
// place instead of as a number.
//
// The turn itself is two halves with the picture swapped at the edge, because
// that is what turning something over is: the front goes away from you, there
// is one moment where neither side faces you, and the back comes towards you.
// A cross-fade would be two pictures swapping. This is one card with two
// sides.
//
// Written against `rotate` rather than `transform`, for the reason the carry
// and the travel are: cards already carry transforms of their own — the angle
// a card lies at in a fanned pile, the lean of a card being pointed at — and
// the individual properties compose where transform would overwrite. A card
// can be turned over while lying at the angle its pile gave it.
//
// Nothing here is stored. The turned state is a class on the card image, the
// way .card-held is: it lasts as long as you are looking at the card, and a
// re-render forgets it. Turning a card over is closer to holding one than to a
// preference.
//
// And it survives "Cards move" being unticked. The movement is the
// preference's to refuse; the other side of the card is not — a switch about
// animation must not cost anybody information — so with motion off the face
// swaps and nothing turns. cardMotionOn() (js/motion.js) is asked at the
// moment of the click rather than at load, as the lift asks it, so the answer
// is always the one on screen.

/* The classes the two halves of the turn are drawn by, and the one the card
 * wears while it is showing its back. The stylesheet holds the angles; what is
 * here is the order they happen in. */
const TURN_AWAY   = 'card-turning-away';
const TURN_BACK   = 'card-turning-back';
const TURN_SHOWN  = 'card-turned';
/* Perspective belongs to the element a rotating thing hangs in rather than to
 * the thing itself, so it is put on and taken off with the turn — the same
 * two-element split, and the same leave-nothing-behind rule, as the lift's
 * .card-lift-host. */
const TURN_HOST   = 'card-turn-host';

/* The control, or nothing at all. A card with one picture is a card with no
 * other side, and a button that turned it over would be a button that meant
 * nothing.
 *
 * It is empty, and its name comes from its title, for .pile-toggle's reasons:
 * the glyph inside it is a shape components.css draws rather than a character
 * typed into eight render sites. The back's URL travels on the button because
 * the tile that drew it already knew it — asking a cache at click time would
 * work in Collections, which fills one, and not in the two tabs that render
 * Scryfall's answer directly. */
function cardTurnHtml(back) {
  if (!back) return '';
  return `<button type="button" class="card-turn" aria-pressed="false"
    title="Turn over" data-turn="${esc(back)}"></button>`;
}

/* A picture and the control that turns it, or the picture exactly as the tile
 * drew it. A one-sided card is not wrapped at all — the overwhelming majority
 * of cards are one-sided, and a tile that cannot be turned over should be the
 * tile it has always been.
 *
 * The control is a sibling of the link rather than a child of it, which is not
 * a style preference: every one of these pictures is wrapped in an <a>, and a
 * link may not contain a button. The wrapper is what gives the two of them a
 * box to share and the control something to be positioned against. */
function cardTurnableHtml(picture, back, { cls = '', style = '' } = {}) {
  const turn = cardTurnHtml(back);
  if (!turn) return picture;
  return `<div class="card-turnable${cls ? ' ' + cls : ''}"` +
    `${style ? ` style="${style}"` : ''}>${picture}${turn}</div>`;
}

// ── The turn ──────────────────────────────────────────────────────────────

/* The card a control belongs to. One control and one picture share a
 * .card-turnable and nothing else does, so this is exact wherever the wrapper
 * is used — over a grid tile's link, over a fanned pile's card — without this
 * file knowing what any of those tiles look like. */
function cardTurnPicture(btn) {
  return btn.closest('.card-turnable')?.querySelector('img.card-img') || null;
}

/* Show the other side. The front is remembered on the picture the first time
 * it is turned away from, so the card carries its own way back and there is no
 * second map to keep in step with the DOM.
 *
 * This is the whole of the feature. Everything below it is the movement, which
 * is why it is a function of its own: with "Cards move" unticked, or a system
 * asking for less of it, this happens and nothing else does. */
function showOtherFace(img, btn) {
  const turned = !img.classList.contains(TURN_SHOWN);
  if (turned) {
    if (!img.dataset.cardFront) img.dataset.cardFront = img.getAttribute('src');
    img.src = btn.dataset.turn;
  } else {
    img.src = img.dataset.cardFront;
  }
  img.classList.toggle(TURN_SHOWN, turned);
  /* The state is the card's, and the button says it out loud: a control whose
     state is carried only by a class beside it is a control a screen reader
     has no way to read. Both are written here, from one answer. */
  btn.setAttribute('aria-pressed', turned ? 'true' : 'false');
}

/* Turn it over.
 *
 * The picture is swapped at the halfway point rather than at the start,
 * because the halfway point is where the card is edge-on and neither side is
 * facing you — the one moment in a turn when a swap cannot be seen. The second
 * half then starts from the far side of edge-on, which is where the back of a
 * card really is once the front has gone past you.
 *
 * A turn already under way is left alone. Two of them racing would swap the
 * picture twice and land the card on the side it started on, which is a card
 * that ignored you rather than a card that turned twice. */
function turnCard(btn) {
  const img = cardTurnPicture(btn);
  if (!img || !btn.dataset.turn) return;
  if (img.classList.contains(TURN_AWAY) || img.classList.contains(TURN_BACK)) return;

  if (!cardMotionOn()) { showOtherFace(img, btn); return; }

  /* The back has usually never been fetched, and an <img> whose src changed a
     moment ago is a blank rectangle until it lands. Asking for it now gives it
     the first half of the turn to arrive in, and it is the browser's own cache
     that the swap below then reads from. */
  if (!img.dataset.cardFront) new Image().src = btn.dataset.turn;

  const host = img.parentElement;
  host?.classList.add(TURN_HOST);
  img.classList.add(TURN_AWAY);

  img.addEventListener('animationend', () => {
    /* Both class changes in one go, so there is no frame between them for the
       card to be drawn flat in. */
    img.classList.remove(TURN_AWAY);
    showOtherFace(img, btn);
    img.classList.add(TURN_BACK);
    img.addEventListener('animationend', () => {
      img.classList.remove(TURN_BACK);
      host?.classList.remove(TURN_HOST);
    }, { once: true });
  }, { once: true });
}

/* One listener for the whole app, on the control rather than on the card: a
 * click on the card itself already means "open this card", everywhere, and the
 * turn is not allowed to take that gesture away from it. The control sits
 * outside the link, so the delegated .card-open handler in js/main.js never
 * sees this click at all — there is no ordering between two document listeners
 * to get right. */
document.addEventListener('click', e => {
  const btn = e.target.closest?.('.card-turn');
  if (!btn) return;
  e.preventDefault();
  turnCard(btn);
});

// ── The key ───────────────────────────────────────────────────────────────
// `f`, with the pointer on a card, turns it over.
//
// It adds no turn of its own: it finds the control the card is already wearing
// and presses it. Everything above — what has a back, what happens with "Cards
// move" unticked, what to do about a turn already under way — is therefore
// inherited rather than decided a second time, and a card with one face
// correctly does nothing because it has no control to find. A second path that
// knew how to turn a card over would be a second place for those three answers
// to drift apart.

/* The card the pointer is on, asked of the document rather than tracked. Live,
 * so it needs no state and cannot go stale; and because it is a question about
 * a class rather than about a view, the key works in every view that draws the
 * control — the two grids, the fanned piles, the set browser, the card detail
 * — and in the seventh one drawn next year, with no list of views anywhere.
 *
 * With the pointer over no card at all, the card open in the detail dialog is
 * the one meant: it is the one place in the app where a card is the subject of
 * the screen without being under the hand, because you opened it to read it
 * and the pointer has moved off into the text. Closed, the dialog's markup is
 * still in the page, which is why the display is asked about — the same
 * question js/main.js's Escape asks of it. */
function cardTurnWanted() {
  const hovered = document.querySelector('.card-turnable:hover .card-turn');
  if (hovered) return hovered;
  const modal = document.getElementById('cardModal');
  if (!modal || modal.style.display === 'none') return null;
  return modal.querySelector('.card-turn');
}

/* Where a letter is a letter rather than a shortcut. Typing "goblin" into the
 * Deck Builder's filter has to filter for goblins. */
function cardTurnTyping(target) {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)
    || !!target?.isContentEditable;
}

document.addEventListener('keydown', e => {
  /* The character the key produced, not the key: a layout that puts f
     somewhere else than the third key of the home row still reaches this. Caps
     lock is the same character shouted, and means the same thing. */
  if (e.key !== 'f' && e.key !== 'F') return;
  /* Ctrl+F is find and Cmd+F is find. A card under the pointer must not cost
     anybody the browser's own keyboard. */
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (cardTurnTyping(e.target)) return;
  const btn = cardTurnWanted();
  if (!btn) return;
  e.preventDefault();
  turnCard(btn);
});
