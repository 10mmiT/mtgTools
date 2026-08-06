# 08 — The table header is a shortcut into the same model

**What to build:** in Collections' list view, a plain header click **replaces the whole sort with
that column's seeded chain**, and a shift-click **appends** that column as the next criterion, up
to three. Clicking the column that is already first flips its direction, as it does today.

The header stops being a second sorting system. Today it writes fields into `mtgtools_sort` that
the select cannot display — which is the only reason `syncColSortControl()` exists, and that
function goes with this ticket.

The sorted-column indicators have to say more than they do. A header carrying the first criterion
is marked as it is now; a header carrying a later one needs to show that it is in the chain and
where — otherwise shift-click is an invisible feature and a user who used it cannot tell why their
cards are in that order.

From `docs/design/spec-sorting.md` → "The table header is a shortcut into the same model".

**Blocked by:** 04 — Choosing a field seeds the sentence; 06 — The control says the sentence.

**Status:** todo

- [ ] A plain header click replaces the chain with that column's seeded chain
- [ ] A shift-click appends that column as the next criterion
- [ ] Shift-clicking at three criteria is a no-op, or replaces the last, and which is stated
- [ ] Shift-clicking a column already in the chain moves or flips it rather than duplicating it
- [ ] Clicking the column that is already the first criterion flips its direction
- [ ] Every header click leaves the sort control's label showing the same chain
- [ ] A header carrying a later criterion is visibly marked, and its position in the chain is legible
- [ ] `syncColSortControl()` is gone
- [ ] The per-collection quantity columns work through the same path as every other column
- [ ] Correct in all five themes, using existing tokens only
- [ ] Shift-click has a reachable equivalent for keyboard and touch, or the sort control is documented as that path
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
