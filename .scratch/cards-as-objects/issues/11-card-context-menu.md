# 11 — What can be done to a card

**What to build:** a card's actions stop hanging off the card. The ⓘ, ⇄ and × that appeared on a
grid tile or a pile card when the pointer arrived become a menu, asked for by right-clicking the card
— inspect, move to a category, remove — and by holding a finger on it on touch. List rows keep their
own row of buttons.

Not from the spec: from using it. The ⓘ was unreachable — pointing at a card lifts it, and the lift
draws the picture over the furniture lying on it, so the one button you had to point at to press was
the one that pointing hid.

**Blocked by:** nothing. It lands on top of 09 and 10, whose carry it must not disturb.

**Status:** done — `public/js/deckview-render.js`, on `#dbCardMenu`

- [x] Right-clicking a card on the mat opens a menu at the pointer with inspect, move and remove
- [x] Holding a finger on a card opens the same menu under the finger
- [x] The menu is clamped to the window: asked for near an edge, it opens back over the point
- [x] It closes on a click away, on Escape, on the mat scrolling, and on a press elsewhere
- [x] Right-clicking neither selects the card nor disturbs a selection already made
- [x] Grid tiles and pile cards carry no buttons; list rows keep theirs
- [x] Inspect, move and remove do what the buttons they replace did, and save the same way
- [x] The carry and the handful still work, from a card with no buttons on it
- [x] `npm test`, `npm run lint:tokens` and `npm run measure:mobile` are green

**Built as:** a question, where there was furniture. What is *on* a card is what a card has — its
name, its price, how many you own, how many are in the hand carrying it. What can be *done* to it is
a question, and the answer is the same `.col-menu` the rest of the app opens, placed at a point
instead of under the control that opened it, because there is no control: the card is the control.

Which card is asked of the mat rather than of a new attribute. `js/cardmove.js` already names
everything on the mat `data-moves="kind:name"` so it can be recognised across a rebuild, and a card
is the one kind that has anything to answer here — a settled stack stands for a whole category and
its control is the arrow. So `_dbCardAt()` reads the identity the mat already publishes, and the
markup gained nothing.

`dbMenuPlacement()` is the one decision written as a function of its inputs: where a menu of a given
size, asked for at a given point in a given window, is drawn. At the point, so it comes out of the
card — but a menu asked for near the bottom opens *upwards from the point* rather than being clamped
to the edge, because clamping puts the items under the hand that asked for them. A menu bigger than
the window has nowhere to flip to and goes in the corner, which is the one place it can be.

The items are written each time rather than shown and hidden, because what can be done to a card
depends on whose deck it is: anybody may look a card up, and only the owner may move or remove one.

## What was observed

Driven against a real deck in headless Firefox with a real pointer at 1440×900, in all three views:
**45 checks green**, plus 4 for the menu beside a selection and 6 for the long press.

| gesture | what happened |
| --- | --- |
| right-click a card | menu at the pointer, exactly: `menu at 153,207 for a press at 153,207` |
| the menu itself | `fixed`, z-index 100 — above the mat and above a card in hand, below the modals it opens |
| right-click near the right edge | asked at 1395, drawn 1235–1395 of 1440: flipped back over the point |
| click away / Escape / scroll the mat | closed, each time, in each view |
| right-click while two cards are selected | menu opens, both cards still selected |
| inspect | the card modal opens on that card, the menu closes |
| move to… | the move modal opens titled with that card |
| remove | the card goes from the deck and off the mat; `PUT 200`, "Saved ✓" |
| a grid tile or a pile card | `{"info":0,"btns":0}` — no buttons on it at all |
| a list row | 288 buttons on the mat, as before |
| hold a finger on a card (390×844) | menu 160×145 under the finger, on screen, three items, nothing selected |
| tap a card | selects it, as it always did; no menu |
| pick a card up and carry it | still carries and lands; a selected card still carries the handful, badge and all |

**The bug that started it, in one line.** `.card-lift-host` is `z-index: 3` and `.db-tile-info-wrap`
was `z-index: 2`, so a lifted card drew over its own inspect button. The move and remove buttons in
pile view had already been given `z-index: 11` to escape it; the ⓘ never was. Removing the buttons
is what the answer turned out to be, so the number is gone rather than raised.

**A second one, found by driving it.** The menu was opening as wide as the window: `.col-menu` pins
itself to `right: 0` under the control that opened it, and this menu overrides `position` and sets a
`left` — with `right: 0` still in force, that is a box stretched from the point to the window's edge,
and the placement arithmetic was being handed a 1424px width to flip. `right: auto; top: auto` and a
`width: max-content` is the fix. It is only visible if you measure the menu rather than look at it,
because its background is dark on dark and its items are left-aligned.

## What this costs, and what it does not

**Keyboard.** A grid tile or a pile card now has no focusable control on it, so the three actions are
not reachable by keyboard on those two views. They are in the list view, which keeps its buttons, and
"Move to…" is also on the bulk bar for a selection. Worth a proper keyboard path for the mat later;
it is not one this ticket had.

**The selection.** The menu acts on the card it was opened on, even when that card is part of a
selection — which is what the buttons it replaces did. A menu that said "Move 3 cards…" on a selected
card would be a reasonable thing to want, and the bulk bar is the place that already says it.

**The browser's own menu** is refused only over a card. Everywhere else on the page — a name to copy,
an image to save — it is still the browser's to offer.

## One thing seen once and not reproduced

A run that removed cards in three views in quick succession showed "Save failed ✗" in the toolbar
once. A clean sequence saves fine — `PUT 200`, "Saved ✓", asserted above — and the app has a rate
limiter in front of it, which is the likeliest explanation for a harness making a dozen writes in a
few seconds. Recorded rather than claimed fixed, since it was not chased down.
