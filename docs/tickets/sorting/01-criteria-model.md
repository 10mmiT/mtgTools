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

**Status:** done

- [x] `cardComparator(criteria)` takes an ordered list of `{ field, dir }` and compares on each in turn
- [x] A criterion's `dir` affects only that criterion
- [x] The name tiebreak fires last, ascending, regardless of any criterion's direction
- [x] Sorting an already-sorted list returns the same order — the comparator is total
- [x] A list of one orders identically to today's `cardComparator(field, dir)` for every field in `SORT_FIELDS` — the replaced comparator is written out in the test as the reference the one-criterion list is held against
- [x] A list longer than three is rejected or truncated, and the choice is stated in a comment — truncated at `SORT_CRITERIA_MAX`: the first three words are still the sort you asked for, and a view that throws is a blank tab
- [x] An empty list falls back to name ascending rather than throwing — the tiebreak on its own. A criterion with no `dir` is read as ascending rather than compared against `NaN`
- [x] All five views pass a one-element list and render exactly as before — `search.js`, `sets.js`, `collections.js`, `wants.js`, `deckview-render.js`
- [x] A new `test/cardsort.test.js` asserts the above through the `vm` seam `test/cardgroups.test.js` uses
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
