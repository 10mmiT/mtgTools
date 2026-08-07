# 06 — The control says the sentence

**What to build:** the select and the arrow become **one button whose label is the sort** —
`Sort: Color → Mana → Name` — opening a popover with up to three rows. Each row is a field select,
a direction toggle and a remove; an Add row greys out at three.

The label is the point. A criterion you cannot see is a criterion silently reordering your cards,
which is why keeping the select and hiding criteria two and three behind a "⋯" is not the answer.
Inline chips in the toolbar were rejected too: they grow a strip that is measured on how little of
it there is, they wrap badly on mobile, and drag-to-reorder is a gesture this app already spends on
carrying cards.

The popover is the `col-menu` pattern already in `sortui.js`, so it inherits the outside-click
handling, the styling and the escape-from-`overflow:hidden` positioning rather than inventing any
of them. Reordering criteria without dragging needs an answer — up/down affordances on each row, or
the field selects being the only way to rearrange — and whichever is chosen is stated in a comment.

`mountSortControl`'s signature keeps its shape: a container, a view, the fields that view supports,
and an apply callback. Its callers should need no more than their existing call.

From `docs/design/spec-sorting.md` → "The control says the sentence".

**Blocked by:** 04 — Choosing a field seeds the sentence; 05 — An existing sort is one criterion.

**Status:** done

- [x] The strip shows one button whose label is the current chain, readable without opening it —
      `chainLabel()`, which is the one place a chain becomes a sentence
- [x] The button opens a popover of up to three criterion rows
- [x] A row can change its field, flip its direction, and be removed
- [x] Add appends a criterion and is unavailable at three
- [x] Removing the only criterion is **prevented** — the ✕ on the last row is unavailable, and why is
      stated in the comment over `mountSortControl`
- [x] Criteria can be reordered without a drag gesture — a ↑ on every row but the first
- [x] The label updates as the chain changes, and the view re-renders on each change
- [x] The popover closes on an outside click and on Escape, and is reachable and operable by keyboard —
      Escape hands the focus back to the button, and an edit puts it back on what was clicked
- [x] The label truncates rather than growing the strip when three long field names are chosen
- [x] Correct in all five themes, using existing tokens only — no raw colour, size, space or radius
- [x] Usable at the narrowest breakpoint, with the strip's height unchanged
- [x] `mountSortControl`'s callers are unchanged apart from what tickets 02 and 03 require. What did
      change is `syncColSortControl()`, which existed only to reach into the old control's markup and
      is now the sync handle the mount returns
- [x] `npm test`, `npm run lint:tokens` and `npm run check:contrast` are green. `npm run measure:mobile`
      is unchanged: the five tabs that carry this control are clean, and the `.pile-toggle` targets it
      reports on the Deck Builder are the piles-expanded work's, measured identical in a worktree at
      `HEAD`

Six things settled here:

- **Reordering is a ↑ on each row but the first, not a drag.** Dragging is the gesture this app spends
  on carrying cards, and a row of five controls fits nowhere on a phone at 44px each. Swapping a row
  with the one above it reaches every order of three, so one button per row is the whole of it — half
  the clutter of an up/down pair, for the same reachable orders.
- **The last criterion cannot be removed, rather than falling back to name ascending.** The fallback
  reads better until you follow it through the model: `saveSortChain` would write an empty `criteria`,
  and `getSortChain` reads an empty chain as *the view's default* — so the removal would be undone by
  the render that removing it triggers. Prevented is the only one of the two that survives a round
  trip, and changing that row's field is what taking the last word away means.
- **The label's ceiling is measured, not chosen.** 240px is the widest the control can be before the
  Collections and Want List strips wrap a row earlier than the select and arrow made them. Measured in
  the real page against a worktree at `HEAD`: Collections used to wrap at 1280px and now holds to
  1000, and the Want List wraps where it always did. What clips is the end of the sentence, which is
  where the words separating the fewest cards are.
- **The popover is clamped to the window rather than pinned to an edge.** Every other `.col-menu` hangs
  from its button's right edge, which is enough for them because they open from the end of a strip or
  the corner of a tile. This one sits in the middle of a row that wraps, so on a phone either edge can
  be the wrong one — off the right at one end of the row, off the left at the other. It is offered its
  right edge and then clamped, which is the kebab menus' two lines without their `position: fixed`;
  staying absolute is what lets it travel with the strip instead of needing a close-on-scroll. It is
  placed again on every redraw, because the label is what sizes the button it hangs from.
- **The first row offers every field; the tail rows offer only what is free.** A chain cannot say the
  same field twice — `tidyChain` drops the second occurrence silently — so the rows that can avoid
  making a duplicate do. The first row cannot: the field you most want to lead with is usually already
  the last word of the sentence, and a Name you have to delete before you can sort by it is not a
  control.
- **`.sort-select` took two `!important` with it.** They had been shouting a padding and a font-size
  over a base control rule; the select they were on is gone, so the ratchet in `lint-tokens.js` went
  from 11 rules and 12 declarations to 10 and 10. The list only ever shrinks, and this is the fifth
  entry retired the way it asks for — by removing what it was fighting rather than re-scoping it.
