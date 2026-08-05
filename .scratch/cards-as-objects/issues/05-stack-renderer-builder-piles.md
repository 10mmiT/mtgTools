# 05 — Stacks, and the Deck Builder's piles

**What to build:** a Deck Builder category stops being a perfectly aligned fan and becomes a stack of
cards on a table. The face card sits on top with the edges of the cards beneath showing; the stack
gets visibly thicker as the category grows, so you can read the shape of a deck without counting; and
the cards sit at slight angles to one another, the way a pile put down by hand does.

Those angles are stable. The same card sits at the same angle on every render, derived from its name,
because a mat that visibly reshuffles itself on every quantity change is worse than a tidy one.

Clicking a stack fans it out so every card in it can be inspected, and clicking away settles it —
tidying, not hiding. The existing card-width control sizes stacks as it sizes the grid.

The number of drawn layers is capped, so a very large category costs no more to paint than a small
one, and the two decisions that make this work — layers from count, angle from name — are written as
pure functions so they can be asserted rather than eyeballed. This ticket delivers the renderer that
tickets 07 reuses.

From `spec-cards-as-objects.md` → Implementation Decisions, "Stack jitter is deterministic", "A stack
draws a bounded number of layers" and "One stack renderer, three callers".

**Blocked by:** 03 — Cards stop being tiles. A stack is made of cards, so the card treatment settles
first.

**Status:** done

- [x] A category renders as a stack showing the edges of the cards beneath the face card
- [x] A thirty-card stack is visibly thicker than a four-card one
- [x] The number of drawn layers is capped, so a very large category paints no more slowly than a small one
- [x] Cards in a stack sit at slight angles, and the same card sits at the same angle on every render
- [x] Clicking a stack fans it out so every card in it can be seen and acted on; clicking away settles it
- [x] A stack shows its card count
- [x] The existing card-width control sizes stacks
- [x] Dropping a card onto a stack still moves it into that category, by the existing drag path this ticket does not change
- [x] Collapsing and expanding a category still works, and the stats bar is unaffected
- [x] Layer count and jitter are pure functions asserted through the vm seam: layers monotonic in count and bounded above, jitter stable per card name and within its permitted range
- [x] The stack overlap's exemption comment names the spacing rule and states that the overlap tracks the card's own width
- [x] `npm test`, `npm run lint:tokens` and `npm run measure:mobile` are green

**Built as:** a new `js/cardstack.js` that is handed cards and hands back
markup, knowing nothing about categories, decks or sort fields — which is what
lets tickets 06 and 07 call it. It carries the two decisions: `stackLayers()`
from the count and `stackJitter()` from the card's name.

Thickness is `min(cap, cards − 1, 2·log₂ cards)`. All three terms are
non-decreasing, so adding a card can never make a pile look thinner; the cap is
the cost ceiling and `cards − 1` is what stops a pair being drawn as a brick.
Four cards draw three edges and thirty draw ten, which is the difference the
eye is meant to read.

The edges are empty divs rather than more card images: a pile of ten costs ten
divs and no extra fetches. The face card is left an ordinary `.card-img`, so it
takes the corner, the lit edge, the shadow and ticket 04's lift with every
other card in the app — the top card of a pile is the one your hand reaches,
and it lifts off the stack it is lying on. One card's thickness is a fraction
of the card's own *width*, so the size control makes thick piles thicker rather
than making big cards look printed on tissue, and it is spent as a `transform`
rather than a margin, which is why the settled stack needs no spacing
exemption of its own. The count hangs below the deepest edge on the mat instead
of sitting on the artwork, so it needs no colour exemption either; the section
header stops repeating it while a stack is drawn, and says it again when the
pile is folded away or fanned out.

Fanning is one document listener rather than a handler per stack: the mat is
rebuilt on every change, and "click away to settle" is a question about the
whole page. What makes it work is that the clicks meaning something else to a
card — selecting it, its ⓘ, its ⇄ — already stop before they reach the
document, so a fanned stack can be acted on without settling under the hand
acting on it. Dropping onto a stack was untouched: the drop target is the
category section, which a settled stack sits inside.

A fanned-out card keeps the angle its name gave its edge while the stack was
settled, so fanning spreads the pile that was lying there rather than a tidier
one.

Verified in the real app against a copy of the live snapshot, in dark, light
and contrast: eight categories draw eight stacks of depth 0, 1, 4, 6, 6, 8, 9
and 10 for counts of 1, 2, 5, 7, 8, 18, 26 and 34; the angles are identical
across a re-render; clicking a stack fans all 26 of its cards and leaves the
other seven stacked; selecting a card inside it does not settle it and clicking
the page does; the size slider takes a stack from 150px to 240px and its
thickness with it; collapsing still folds the pile away with the stats bar
unmoved; the existing drag path still lands a card in the category it was
dropped on; and the face card still lifts, leans within its six degrees and
leaves its layout box at 150×211. On a phone the mat does not scroll sideways
and a tap fans a stack without leaving anything held.

Known and left alone: a fanned-out category is much taller than its settled
neighbours, so the mat's existing flex-wrap pushes the stacks after it onto a
row below. Stacks replace how a pile is drawn, not how the mat is arranged,
which this ticket's spec puts out of scope.
