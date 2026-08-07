# 02 — Every field is a real criterion

**What to build:** the fields that sort themselves outside `sortKey()` come inside it, so that any
field can sit in any slot of a chain.

`sortKey` grows a third argument — a context object the calling view supplies, `{ wants,
collections }` or whatever that view has — and `cardComparator(criteria, ctx)` threads it through.
It stays a pure function of `(field, card, ctx)`, which is what the test seam depends on.

Three things move:

- `wanted` and `player` are in `SORT_FIELDS` today but not in `sortKey`, so they fall through to
  the name default while `wants.js` sorts them with two bespoke comparators. Those comparators
  become `sortKey` cases reading the want map off the context, and `wants.js` stops branching on
  the field entirely.
- `qty` only works if the caller stamped `_sortQty` onto every row first. It reads the collection
  index off the context instead, and `_sortQty` goes.
- `total` and `col_<i>` never reach `sortui.js` at all — they are Collections table-header state.
  They become real fields, which makes a view's field list **dynamic**: one entry per collection,
  rebuilt when collections change. Ticket 03 settles how a collection criterion is identified.

The test is whether the app can express *most wanted, then mana value*. Want Lists is where the
second criterion is most obviously missing, because Most Wanted produces enormous ties by
construction.

From `docs/design/spec-sorting.md` → "A criterion is a criterion" and "Context is threaded, not
registered".

**Blocked by:** 01 — A sort is a list of criteria.

**Status:** done

- [x] `sortKey(field, card, ctx)` handles `wanted`, `player`, `qty`, `total` and per-collection counts
- [x] `cardComparator(criteria, ctx)` passes the context to every criterion it evaluates
- [x] `wants.js` no longer branches on the sort field and its two bespoke comparators are gone
- [x] `_sortQty` is gone from `sortui.js` and from `collections.js`
- [x] A view's field list is built at mount time and includes one entry per collection where that applies —
      `colSortFields()`, rebuilt on any render where the collections no longer match the mounted list, so
      adding or removing one re-labels the select
- [x] Sorting on a field whose context is missing degrades to a stable order rather than throwing — every
      card scores alike and the name tiebreak orders them, and the rest of the chain still fires
- [x] Want Lists can sort by Most Wanted, then Mana Value, and the ties resolve — the model can say it;
      the control still asks for one criterion until 04
- [x] Every view's existing single-field sorts produce the order they produced before, with two ties
      resolved differently on purpose: Most Wanted tiebroke on `localeCompare` and now uses the same
      lowercased name tiebreak as every other field, and Player had no tiebreak at all, so its ties were
      left in whatever order they arrived in
- [x] `test/cardsort.test.js` covers each newly-absorbed field, with the context supplied as a plain object
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

Two things settled here that the ticket left open:

- **Quantity and Total are one field.** They were always the same number — how many of a card are owned
  altogether — under two names, and the table header now writes the one the sort control can say. `total`
  stays in `sortKey` because it is what earlier versions wrote into the stored sort.
- **A collection is still `col_<i>`.** Positional, as the header has always written it; 03 makes it an id.
  A `col_<i>` past the end of the list is one of the missing-context cases above rather than a crash.
