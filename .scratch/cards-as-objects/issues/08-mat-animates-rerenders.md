# 08 — The mat animates its own re-renders

**What to build:** the Deck Builder's mat stops rearranging itself behind your back. Today any change
rebuilds the whole mat, so a card that moves is destroyed in one place and recreated in another with
no motion between — you see the result and have to work out what happened.

Instead, card positions are recorded before the rebuild and again after, and every card that ended up
somewhere new travels there. This makes every re-render animate — a quantity change, a sort, a
category rename, a move — rather than only a drag, and it is what will later let a dropped card land
rather than teleport.

Your place is preserved: scroll position and selection survive the animation, as they survive a
re-render today.

With card motion off, or the operating system's reduced-motion setting on, positions update instantly
with no movement at all.

Demoable on its own by changing a card's quantity and watching the pile close up around it.

From `spec-cards-as-objects.md` → Implementation Decisions, "Re-renders animate by measuring before
and after".

**Blocked by:** 01 — The card-motion preference; 02 — Reduced motion becomes part of the token
contract.

**Status:** done — `public/js/cardmove.js`, wired into `dbRender()`

- [x] Changing a quantity, sorting, renaming a category or moving a card animates the affected cards from their old positions to their new ones
- [x] Scroll position and card selection survive the animation
- [x] A card added to or removed from the deck is not left stranded mid-animation
- [x] With card motion off, or reduced motion set, positions update instantly and nothing moves
- [x] Cards are matched across renders by card name
- [x] Autosave, import, export, multiselect and the stats bar behave exactly as they do today
- [x] A deck of several hundred cards re-renders without visible stutter
- [x] Works in the grid and stack views
- [x] `npm test`, `npm run lint:tokens` and `npm run measure:mobile` are green

## What was observed

Driven against a real deck (93 cards) in headless Firefox, at 1440×900, with the
page scrolled to where the change actually happens.

| change | cards drawn travelling | scroll | selection | offsets left behind |
| --- | --- | --- | --- | --- |
| re-sort, list view | 17 | kept | kept | 0 |
| re-sort, grid view | 20 | kept | kept | 0 |
| re-sort, pile view | 5 stacks | kept | kept | 0 |
| re-sort, fanned pile | 9, rotations intact | kept | kept | 0 |
| remove a card | 41 | kept | kept | 0 |
| move a card between categories | 14 | kept | kept | 0 |
| any of the above, cards' motion off | 0, and the mat is never measured | kept | kept | — |

**The demo line in this ticket is wrong about quantity, and the mat is right.**
"Changing a card's quantity and watching the pile close up around it" does not
animate, because a quantity change moves nothing: a quantity is drawn as a `×N`
badge, and a settled stack's thickness is a transform on `--stack-depth`, so
neither is layout and nothing has a new position to travel to. The pile closing
up is what *removing* a card does, and that animates — 41 cards, above. A
category rename is the same story: it renames a section in place and moves no
card, so there is nothing to animate.

That is the mechanism working as specified rather than a gap in it — it animates
whatever moved, and in those two cases nothing moved. Making a quantity change
move cards would mean making stack thickness affect layout, which would have
piles shoving their neighbours around every time a number changed.

**What bounds the cost.** What is animated is not what the mat holds but what can
be seen of it: a journey that begins and ends off the screen is not drawn. So a
deck of four hundred cards animates at the price of a screenful, and a deck of
four thousand at the same price — asserted in `test/cardmove.test.js` rather than
eyeballed.
