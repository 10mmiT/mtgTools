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

**Status:** done

- [x] A per-collection criterion is identified by the collection's id, not its position — `col:<id>`
- [x] Reordering collections leaves every stored criterion meaning what it meant
- [x] Renaming a collection updates the criterion's label and nothing else
- [x] Deleting a collection drops any criterion naming it, silently, leaving the rest of the chain intact —
      `liveCriteria()` drops it from the chain, and `reconcileColSorts()` drops it from the stored sort
- [x] A chain reduced to nothing by deletions falls back to name ascending
- [x] Any `col_<i>` value already in localStorage is migrated to the id at that index, or dropped if the index no longer resolves
- [x] `test/cardsort.test.js` asserts drop-on-delete and stability under reorder
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

Four things settled here:

- **The id is `key`.** A collection carries two: `key` — `archidekt:12345`, `csv:1699…` — which is
  unique, is the server's primary key and is what the chip's Remove passes; and `id`, the source's
  own, which is null for a CSV and not unique across sources. A criterion names the `key`. The
  field is `col:<key>`, and because a key contains colons of its own the prefix is stripped rather
  than the field split.
- **Dropped means dropped from the stored sort too**, not only from the chain the comparator walks.
  A criterion that survives in localStorage naming a collection nobody has is one that comes back
  the next time that view is opened.
- **The migration runs from `hydrateState`**, not from the Collections tab. `col_<i>` can only be
  read against the list it indexed, and a tab that renders before its collections have arrived
  would read every criterion naming one as naming a collection that is gone — and throw away a
  preference that was never wrong. Hydration is the moment the list becomes known; the tab
  reconciles again when a collection is added or removed under it.
- **Renaming has no UI to reach it.** A collection is named when it is added and nothing edits that
  afterwards, so today a rename means editing the database. The behaviour is asserted at the unit
  level rather than in the tab: the field is the key and the label is the name, so a name that
  changes changes the word in the select and the table header and nothing else.
