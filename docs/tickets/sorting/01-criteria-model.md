# 01 — A sort is a list of criteria

**What to build:** the model underneath everything else. A sort stops being `{ field, dir }` and
becomes an ordered list of up to three `{ field, dir }` criteria, and `cardComparator` takes that
list instead of a field and a direction.

The comparator walks the criteria in order, returning on the first that separates two cards, and
falls through to the name tiebreak that is already there — still ascending whatever any criterion's
direction says, because that is what makes the order total and the render order stable. A
one-criterion list must behave exactly as `cardComparator(field, dir)` behaves today.

Nothing in the app changes shape yet. Every caller passes a list of one, built from the sort it
already reads, and every view renders identically to how it renders now. This ticket is the seam
the other eight are built on.

From `docs/design/spec-sorting.md` → "A sort is a sentence" and "The name tiebreak stays, and stays
invisible".

**Blocked by:** nothing.

**Status:** todo

- [ ] `cardComparator(criteria)` takes an ordered list of `{ field, dir }` and compares on each in turn
- [ ] A criterion's `dir` affects only that criterion
- [ ] The name tiebreak fires last, ascending, regardless of any criterion's direction
- [ ] Sorting an already-sorted list returns the same order — the comparator is total
- [ ] A list of one orders identically to today's `cardComparator(field, dir)` for every field in `SORT_FIELDS`
- [ ] A list longer than three is rejected or truncated, and the choice is stated in a comment
- [ ] An empty list falls back to name ascending rather than throwing
- [ ] All five views pass a one-element list and render exactly as before
- [ ] A new `test/cardsort.test.js` asserts the above through the `vm` seam `test/cardgroups.test.js` uses
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
