# 10 — Dragging a selection as a fan

**What to build:** moving several cards at once feels like moving a handful of cards rather than
firing an invisible command. Starting a drag on a card that is part of the current multi-selection
carries the whole selection as a small fan, showing how many cards are in hand, and releasing it on a
pile applies the existing bulk move to all of them.

Starting a drag on a card that is *not* selected carries that card alone and leaves the selection
untouched — picking up one card is never a way to accidentally move twenty.

The bulk-actions bar and its existing move-to-category path keep working; this adds a second way to
do the same thing, not a replacement.

From `spec-cards-as-objects.md` → Implementation Decisions, "Multi-select drags a fan".

**Blocked by:** 09 — Carrying a card.

**Status:** done — `public/js/carddrag.js`, on `cardCarryHandful()` and `cardCarryDrop()`

- [x] Starting a drag on a selected card carries the whole selection as a fan
- [x] The fan shows how many cards are being carried
- [x] Releasing on a pile moves every selected card into that category, through the existing bulk-move logic
- [x] Starting a drag on an unselected card carries that card alone and leaves the selection untouched
- [x] Releasing outside any pile changes nothing and leaves the selection intact
- [x] The bulk-actions bar and its move-to-category path continue to work
- [x] The bulk drop is asserted through the vm seam to move the whole selection
- [x] Autosave fires once for the move, as it does for a bulk move today
- [x] `npm test`, `npm run lint:tokens` and `npm run measure:mobile` are green

**Built as:** the cards themselves, again. A handful is not a badge on the card you grabbed and it is
not a picture of a fan: it is every selected card, lifted out of wherever on the mat it was lying and
gathered to the hand. That is the same decision ticket 09 made for one card, and it pays the same way
— `js/cardmove.js` measures each card where it is when the drop rebuilds the mat, and each of them is
in the hand, so a handful lands for the same reason one card does and needs no animation of its own.

The gathering is free too. Ticket 09 gave a carried card an `at` and a `to` and closed a fraction of
the gap each frame; a handful is that arithmetic, once per card. Each card starts at its own place
and is aimed at the hand, so the same lag that makes one card trail the pointer makes twenty fly in
from across the mat and settle into a fan. Nothing was added to make them travel.

Two questions the mat answers, where before there was one. `cardCarryDrop()` now takes the names it
is putting down rather than a name, and `cardCarryHandful()` is new: given the card the hand closed
on, which cards come with it. The Deck Builder's answer is one line — a selected card brings the
selection, any other card brings itself — and `js/carddrag.js` still knows nothing about what a
selection is. The move is `dbMoveCardsTo()`, which the "Move to…" modal and the bulk bar were already
calling, so a handful moved by hand and a handful moved from the bar are one change to the deck and
one autosave.

Two decisions are written as functions of their inputs, beside the three from 09:

- `cardCarryFan(index, count, width, height)` — where each card lies in the handful. The spread is
  the *whole* fan rather than the step between two cards, so a hand holds what it holds: twenty cards
  are the same handful as three, only packed tighter. It is a fraction of the card rather than a
  number of pixels, so it follows the size control; and the fraction is of the narrow way across the
  thing being carried, because in the list view a card is a row as wide as the mat. The turn is bound
  by the same shape — eight degrees on a card sweeps its corner, eight degrees on a row sweeps its far
  end off the page — so a handful of rows is a stack of papers and a handful of cards is a fan.
- `cardCarryAim(hand, origin, fan)` — how far each card has to move to be there. A carry writes
  displacements, not positions, because a carried card keeps its place in the layout; this is the
  subtraction that lets a card at the far end of the mat and a card beside the hand be aimed at the
  same place.

**Where a handful came from.** Ticket 09 refuses to drop a card on the pile it is already in, and
`from` is what that is written against. A handful gathered out of several piles came from nowhere in
particular — every pile on the mat is somewhere new for at least one of its cards — so `from` is the
pile they *all* came from, and nothing when they differ. A handful holding a card the mat is not
drawing (a settled pile, a card the search has filtered out) has no home either, read the other way:
that card may be lying anywhere, so the pile the hand reached into is a real move and is offered.

**A selection carried somewhere is a selection spent**, the way the bulk bar's move spends it. The
cards have just been put where they were wanted; leaving them lit would make the next thing done on
the mat act on a handful nobody is holding. It is cleared before the move, so the render that draws
the cards in their new pile draws them unselected — and put back if nothing moved, which costs no
render because nothing was drawn in between.

The count is an attribute and a `::after`, not an element: `data-carry-count` on the card in the hand,
written only when there is more than one. What is carried is the cards themselves, and a number is not
one of them — so there is nothing for the mat to build, track or take away again.

## What was observed

Driven against a real deck (100 cards, 10 piles) in headless Firefox at 1440×900 with a real pointer
over WebDriver BiDi, in all three views, with cards' motion on and off. **132 checks, all green**,
and 24 more for the two `from` rules in the three views.

| gesture | what happened |
| --- | --- |
| three cards selected by clicking, then one of them dragged | all three in hand, `data-carry-count="3"`, badge drawn in `--primary` |
| the fan, at rest under the hand | 3 cards across 61–66px of a 175–183px card in the piles, 42px of a 155px card in the grid, 15–25px in the list |
| what each card is doing | `none` / `4deg` / `8deg` — the card in the hand square, the fan turning behind it |
| the same, hurried sideways | `0.05deg` / `8.05deg`, and `1.01` / `5.01` / `9.01` — the hand's lean added to each card's place in the fan |
| a handful of list rows | 0.11–0.37° across the whole fan: a stack of papers, not a spray |
| released on another pile | every card in the handful in the new category, one autosave, selection empty |
| an unselected card, dragged | carried alone, no count, the selection untouched and still three |
| released off the mat | nothing offered, nothing moved, nothing saved, three still selected, and nothing of the carry left behind |
| a handful all out of one pile, over that pile | nothing offers; letting go changes nothing and the selection survives |
| a mixed handful, over the pile the hand reached into | that pile offers, and the card that was elsewhere moves in — one autosave |
| a finger | never picks a handful up: nothing carried, nothing lit, nothing moved |
| cards' motion off | the handful gathers instantly and holds its fan; no lean, no lag |

The bulk bar is untouched and still says "3 cards selected · Move to… · Clear selection" while a
handful is in the air.

## What was found by using it

**A carried card in a fanned pile is not where it was measured.** Not a bug in the fan — a note for
whoever drives this next. Hovering a card in a spread pile lifts it, which moves it out from under the
pointer, so a press aimed at a card's box can land on the card beneath. The harness hovers, waits and
asks the page what is actually under the pointer before pressing. A hand does this without thinking.

## The check that was not green last time

`npm run measure:mobile` passes here — the five `button.pile-toggle` problems ticket 09 recorded do
not reproduce on this tree, with or without this ticket's changes. Nothing in this ticket touched
that header, so it is reported rather than claimed.
