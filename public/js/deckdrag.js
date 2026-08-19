// ── Dragging a deck into a folder ───────────────────────────────────────────
// The mouse accelerator over the ⋯ menu's "Move to folder" (js/players.js), not
// a replacement for it: the menu is the path that works on a phone, and the
// path that works without knowing the tiles move at all. Everything here is
// additive — take it away and filing a deck still works.
//
// The browser's own drag-and-drop, unlike the Deck Builder's hand-rolled carry
// (js/carddrag.js). The carry exists because a card being moved between piles
// wants weight and a landing; a deck tile being filed wants neither, and the
// native drag brings its own ghost, its own cursor and its own escape key.

/* What is in hand, and what is lit under it — grouped the way js/carddrag.js
 * groups the same two facts about a carried card.
 *
 * The drag is kept here rather than read back off the event because the
 * browser seals a drag's payload until the drop — a dragover can see the
 * *types* being carried and not the values — and deciding whether a zone would
 * take this deck is exactly a dragover's job. */
let deckDrag     = null;   // { playerId, deckId, folderId }, folderId being where it was picked up
let deckDropZone = null;   // the zone currently showing that it would take it

/* The attributes that make a tile a thing you can pick up. Gated on the same
 * `canEdit` as the ⋯ menu: the drag is a shortcut to a menu row, so it is
 * offered exactly where that row is. */
function deckDragAttrs(playerId, deckId, canEdit) {
  if (!canEdit) return '';
  return ` draggable="true"` +
    ` ondragstart="deckDragStart(event,'${jsAttr(playerId)}','${jsAttr(deckId)}')"` +
    ` ondragend="deckDragEnd(event)"`;
}

/* The attributes that make a zone — a folder section, or the loose zone above
 * them — somewhere to put one down. Same gate again: a zone you may not edit
 * is drawn, and is inert. */
function deckZoneAttrs(canEdit) {
  if (!canEdit) return '';
  return ` ondragover="deckDragOver(event)"` +
    ` ondragleave="deckDragLeave(event)"` +
    ` ondrop="deckDrop(event)"`;
}

/* Which move a drop on this zone would make, or null for a drop that would
 * move nothing. The whole decision, in one place, as a function of what is in
 * hand and what is under it — a dragover asks it to decide whether to offer
 * the drop, and the drop asks it again rather than trusting the offer.
 *
 * Two refusals. A deck onto *another player's* shelf: a deck belongs to the
 * player it is drawn under, moveDeckToFolder looks it up there, and a
 * cross-player drop would quietly find nothing — an admin, who may edit
 * everybody, is exactly who could make that gesture. And the zone the deck is
 * already in: dropping a deck back where it lies is not a move, so that zone
 * does not light up as somewhere to put it. */
function deckDropMove(drag, zone) {
  if (!drag || !zone) return null;
  if (drag.playerId !== zone.playerId) return null;
  const folderId = zone.folderId || null;
  if (folderId === (drag.folderId || null)) return null;
  return { playerId: drag.playerId, deckId: drag.deckId, folderId };
}

/* A zone as the decision reads it. The two attributes the tab already draws on
 * it — which player's shelf, and which folder ('' being loose). */
function deckZoneOf(el) {
  if (!el || !el.dataset) return null;
  return { playerId: el.dataset.playerId, folderId: el.dataset.folderId || null };
}

/* Picked up. The folder it came from is read from the deck rather than from
 * the tile: the tile knows where it was drawn, the deck knows where it is, and
 * they are the same answer only until something else moves it. */
function deckDragStart(e, playerId, deckId) {
  // Emptied first: a pick-up that finds nothing has still ended whatever was
  // in hand before it, and leaving that there would file *it* on the next drop.
  deckDrag = null;
  const deck = state.players.find(p => p.id === playerId)?.decks.find(d => d.id === deckId);
  if (!deck) return;
  deckDrag = { playerId, deckId, folderId: deck.folderId || null };
  const dt = e && e.dataTransfer;
  if (!dt) return;
  dt.effectAllowed = 'move';
  // Firefox starts no drag at all unless the payload is set, so it is set —
  // and set to the deck's name, which is the useful thing to hand anywhere
  // else on the machine that takes dropped text.
  dt.setData('text/plain', deck.name);
}

/* Which zone is showing that it would take the deck. Only ever one, so
 * lighting the next puts the last one out — offerCarryTo (js/carddrag.js) is
 * the same function about a pile. */
function offerDeckDropTo(zone) {
  if (deckDropZone === zone) return;
  if (deckDropZone) deckDropZone.classList.remove('deck-drop-target');
  if (zone) zone.classList.add('deck-drop-target');
  deckDropZone = zone;
}

/* Held over a zone. preventDefault is how a drop target says yes; a zone that
 * would not move anything says nothing, and the browser draws the "no" cursor
 * over it. */
function deckDragOver(e) {
  const zone = e.currentTarget;
  if (!deckDropMove(deckDrag, deckZoneOf(zone))) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  offerDeckDropTo(zone);
}

/* Let go. Asked again rather than trusting the hover: the drop is the event
 * that changes something, so it is the one that has to be sure. */
function deckDrop(e) {
  const move = deckDropMove(deckDrag, deckZoneOf(e.currentTarget));
  offerDeckDropTo(null);
  deckDrag = null;
  if (!move) return;
  // Kept from the browser's own drop — a tile dropped on a zone must not also
  // be a link the page then follows.
  e.preventDefault();
  moveDeckToFolder(move.playerId, move.deckId, move.folderId);
}

/* Left. A dragleave also fires on the way *into* a tile inside the zone — the
 * enter and the leave both bubble — so a leave that lands on something the
 * zone still contains is not a leave at all, and putting the light out for it
 * would make the zone flicker under the pointer. */
function deckDragLeave(e) {
  const zone = e.currentTarget;
  if (e.relatedTarget && zone.contains && zone.contains(e.relatedTarget)) return;
  if (deckDropZone === zone) offerDeckDropTo(null);
}

/* Put down, wherever that was — on a zone, on nothing, or on the escape key.
 * The drop has usually cleared this already; what is left for the end is the
 * drag that ended somewhere else, which must not leave a zone lit or a deck
 * still in hand. */
function deckDragEnd() {
  offerDeckDropTo(null);
  deckDrag = null;
}
