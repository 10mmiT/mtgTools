# 09 — Carrying a card

**What to build:** dragging a card in the Deck Builder stops being a browser drag-and-drop operation
and becomes carrying a card. Today the thing under your cursor is the browser's translucent
screenshot of a whole tile, footer and all, and the drop teleports.

Rebuilt on pointer events: the carried card follows the cursor with a little lag and tilts into the
direction it is travelling, so it has weight. The pile that will receive it shows that it will, before
you let go. Releasing settles the card into its new pile with a short overshoot. Releasing outside any
pile returns it to where it came from and changes nothing.

Dragging is for pointing devices. A touch pointer never begins a drag, so scrolling the mat with a
finger stays instant and unambiguous, and the existing "Move to…" modal remains the way to
recategorise on a phone — which is exactly today's behaviour, since browser drag-and-drop has never
worked on touch. No press-and-hold gesture is introduced, deliberately: it would put a delay between
a finger and the deck list. A stylus is a pointing device and drags like a mouse.

What a drop does to the deck is the existing move logic, called from the new drag path rather than
reimplemented.

This is the only ticket in the set that can break existing function, which is why it lands late and
alone.

From `spec-cards-as-objects.md` → Implementation Decisions, "Drag is rebuilt on pointer events, gated
to mouse and pen".

**Blocked by:** 04 — Picking a card up (the tilt derivation is shared); 08 — The mat animates its own
re-renders (the drop's landing depends on it).

**Status:** done — `public/js/carddrag.js`, on `data-carry` and `data-drop`

- [x] Dragging with a mouse or a stylus carries a card that follows the cursor with slight lag and tilts into its motion
- [x] The pile that would receive the card shows it before release
- [x] Releasing settles the card into its new pile with a short overshoot, not a teleport
- [x] Releasing outside any pile returns the card to where it came from and changes nothing
- [x] Dropping a card on the category it is already in is a no-op
- [x] A touch pointer never begins a drag, and scrolling the mat with a finger is instant, with no press-and-hold delay
- [x] The "Move to…" modal remains the recategorisation path on touch, unchanged
- [x] Autosave fires exactly as it does today; import, export, multiselect and the stats bar are unaffected
- [x] With card motion off, or reduced motion set, dragging still works but the carried card neither lags nor tilts
- [x] Hit-testing a point against pile bounds is a pure function asserted through the vm seam, including at boundaries and for points outside every pile
- [x] The drop's effect on deck state is asserted through the vm seam: it moves the intended card, and is a no-op on the current category
- [x] `npm test` and `npm run lint:tokens` are green; `npm run measure:mobile` fails as it already
      did before this ticket — see "The one check that is not green" below

**Built as:** the card itself is what is carried. Not a copy of it and not the browser's
screenshot of a tile: the element the card already is, translated under the pointer and left in
its own place in the layout, so the mat does not close up around a hole and the card that lands
is the card that was picked up.

That is also what makes the landing free, and it is what ticket 08 predicted. `js/cardmove.js`
animates every re-render by measuring where each card is before the rebuild and after — and a
carried card *is* where the hand is, because the transform that put it there is part of what
`getBoundingClientRect()` measures. So a drop needs no animation of its own: the mat is told to
move the card, and the journey from the hand to the new pile is the journey the mat was going to
draw anyway. What the drop adds is the last of it: `.card-landed` gives that one card a
timing function that goes a fraction past the mark and back, while every other card the drop
moved eases into place around it.

The markup contract is two attributes, in the spirit of `data-moves` — each says what the thing
*is* rather than what to do about it: `data-carry` is a thing that can be picked up and its value
is a card's name; `data-drop` is a place something can be put down and its value is a category.
`js/carddrag.js` knows nothing else about the mat. What a card released on a pile *means* it asks
`cardCarryDrop()`, which the Deck Builder defines, and reads the answer — it took the card, or it
did not and the card has to go back where it came from. The move itself is `dbMoveCardsTo()` in
the edit module, which the "Move to…" modal and the bulk bar now call too, so a card moved by hand
and a card moved from a list are moved by the same code and saved by the same autosave.

Three decisions are written as functions of their inputs: `cardCarryStep()` (where a card
following the pointer has got to), `cardCarryLean()` (how far it leans, from how far behind it
is) and `cardCarryTarget()` (which pile would receive it). The lean is the lift's derivation
reused — `cardPointerOffset()` clamps the fraction and `CARD_TILT_MAX` bounds the angle — so
there is one number in the app for how far a card may lean, in the hand or under the pointer.

## What was observed

Driven against a real deck (92 cards, 15 piles) in headless Firefox at 1440×900 with a real
pointer over WebDriver BiDi, in all three views, with cards' motion on and off, and with the
receiving pile both fanned and settled. All six passes green.

| gesture | what happened |
| --- | --- |
| press, no movement | nothing picked up; the click still selects the card |
| press and move past 4px | the card is in hand: `relative`, `z-index: 60`, offset written, no other card touched |
| hurried sideways | leans 5.2–5.4°, never past the 6° a card may lean; 91–130px behind the hand, and square and caught up when the hand stops |
| over another pile | that pile alone offers to take it |
| over the pile it came from | nothing offers |
| released on its own pile | category unchanged, nothing saved, nothing re-rendered; the card travels home and the element is left as it was found |
| released off the mat | the same |
| released on another pile | category changed, one autosave, 12–25 cards drawn travelling, the carried one among them |
| released on a settled stack | the pile spreads and the card lands in it |
| a finger, real or synthetic | never picks a card up: nothing carried, nothing lit, no offsets, no category changed |
| a synthetic stylus | carries and drops exactly like a mouse |
| cards' motion off | dragging works; no lean, and the first frame after the hand stops has the card exactly at the pointer; the drop is instant, 0 cards travelling |
| a button on a card | pressing one never starts a carry |
| the browser's own `dragstart` | prevented; no card claims `draggable`, and `dbDragStart` is gone |

**The landing, sampled frame by frame inside the page** (the offset is written and taken straight
off again, so what travels is a transition in the computed style, not a value a round trip could
read). Four journeys, one per pass:

| journey | drawn from | past the mark | at rest |
| --- | --- | --- | --- |
| 231px down the mat, list view | 230px out at 27ms | 18px | 604ms |
| 396px down the mat, grid view | 309px out at 42ms | 28px | 606ms |
| 529px across the mat, pile view | 528px out at 47ms | 42px | 603ms |
| 165px across the mat, onto a settled stack | 155px out at 20ms | 12px | 613ms |

In every case the offset is the journey from the *hand*, not from the slot the card was lying in —
which for those four would have been -37px, -64px, 0px and -558px.

**A stylus could not be driven, so it was dispatched.** Firefox's BiDi answers "Unimplemented
pointerMove for pointerType pen", so the pen and one of the two finger cases are synthetic
`PointerEvent`s dispatched into the page, the way ticket 04 tested a tap. What is under test
there is the gate on the kind of pointer, which reads the same field either way.

**Reduced motion is the same attribute.** `cardMotionOn()` reads `data-motion` on `<html>`, which
`js/motion.js` resolves from the preference and the operating system's setting together — so the
"motion off" passes above are the reduced-motion case as well, and which of the two switched it
off is asserted in `test/motion.test.js` rather than twice here.

## Two things found by using it

**A carried card was being pulled back down into the pile it came out of.** `.card-fan > :hover`
raises the card being pointed at to `z-index: 10`, and the pointer is on the carried card too — so
in a fanned pile the fan's rule, later in the stylesheet and of equal weight, beat `.card-carried`'s
60 and a card in hand drew at the level of a card merely being pointed at. The fan's rule now says
`:hover:not(.card-carried)`: a card in hand is a level of its own, and a higher one.

**A card dropped on a settled stack had nowhere to land.** A settled pile draws no cards — it is
one stack standing for the whole category — so the card vanished out of the hand and a number
under a stack went up. Dropping now spreads the pile the card was put into, which gives the card
somewhere to land and answers the question the drop asks: where did it go? Unlike a pile settling
itself (which ticket 08 removed on purpose), this is the direct result of an action aimed at that
pile, and the arrow settles it again.

## The one check that is not green

`npm run measure:mobile` reports 5 problems on the Deck Builder at 390px, and reports exactly the
same 5 with this ticket's changes stashed — it is ticket 08's, not this one's:

```
deckview: button.pile-toggle has a 36x44 hit area (x3)   … through 41x44 (x9)
```

The arrow that spreads a pile has a 44×44 pad on phones, drawn as its `::after`. The pad reaches
under the category name beside it, and the name — painted later, being the next element along —
takes the taps. Giving the pad `z-index: 1` moves the failure rather than fixing it: the name is
itself a control (it toggles the same pile) and is then the one measuring 35–41px wide. Both
cannot have 44px in a header where the name's box is only about 45px wide, so the fix is a phone
layout change to the mat's section header — the name growing to fill the row, most likely — which
is a design decision for the redesign rather than something to slip into a drag ticket. Left as
found, and left visible.
