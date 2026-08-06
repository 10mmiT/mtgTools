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

**Status:** todo

- [ ] The strip shows one button whose label is the current chain, readable without opening it
- [ ] The button opens a popover of up to three criterion rows
- [ ] A row can change its field, flip its direction, and be removed
- [ ] Add appends a criterion and is unavailable at three
- [ ] Removing the only criterion is either prevented or falls back to name ascending, and which is stated
- [ ] Criteria can be reordered without a drag gesture
- [ ] The label updates as the chain changes, and the view re-renders on each change
- [ ] The popover closes on an outside click and on Escape, and is reachable and operable by keyboard
- [ ] The label truncates rather than growing the strip when three long field names are chosen
- [ ] Correct in all five themes, using existing tokens only — no raw colour, size, space or radius
- [ ] Usable at the narrowest breakpoint, with the strip's height unchanged
- [ ] `mountSortControl`'s callers are unchanged apart from what tickets 02 and 03 require
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
