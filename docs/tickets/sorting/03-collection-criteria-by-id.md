# 03 — A collection criterion is stored by id

**What to build:** the per-collection quantity criterion stops being positional.

`col_<i>` is an index into `state.collections`, so deleting the first collection silently turns a
stored `col_2` into a different collection's quantities — a sort that is not wrong so much as
quietly about something else. A criterion names the **collection's id** instead, and resolves to a
column when it is read.

A criterion whose collection no longer exists is **dropped silently**. It cannot be honoured, and a
message about it is a modal nobody wants; the sort becomes the two remaining words. Renaming a
collection changes the criterion's label and nothing else. Reordering collections changes nothing
at all, which is the whole point.

From `docs/design/spec-sorting.md` → "A collection criterion is stored by id".

**Blocked by:** 02 — Every field is a real criterion.

**Status:** todo

- [ ] A per-collection criterion is identified by the collection's id, not its position
- [ ] Reordering collections leaves every stored criterion meaning what it meant
- [ ] Renaming a collection updates the criterion's label and nothing else
- [ ] Deleting a collection drops any criterion naming it, silently, leaving the rest of the chain intact
- [ ] A chain reduced to nothing by deletions falls back to name ascending
- [ ] Any `col_<i>` value already in localStorage is migrated to the id at that index, or dropped if the index no longer resolves
- [ ] `test/cardsort.test.js` asserts drop-on-delete and stability under reorder
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
