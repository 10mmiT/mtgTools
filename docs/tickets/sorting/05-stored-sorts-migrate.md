# 05 — An existing sort is one criterion, not a chain

**What to build:** the `mtgtools_sort` entry already on every user's machine holds `{ field, dir }`
per view. It is read as a **one-criterion list and left at that** — the chain is *not* seeded from
it.

Upgrading the app must not silently reorder the collection somebody left sorted by Rarity. They get
exactly what they had; the chain seeds the first time they open the control and change something.
The new shape is written back only when the sort next changes, so a user who never touches sorting
never has their stored preference rewritten.

This is the rule the card-size migration already used when it refused to inherit the retired XL
view's 300px into the grid, and the comment in `sortui.js` explaining that refusal is the one to
match: a preference somebody chose is not an invitation to choose a different one for them.

The entry is also shared with older versions of the app and with whatever anyone types into a
console, so a stored value that is not a sort at all — a string, a number, a list of nine, a field
this view has never supported — resolves to the view's default rather than to a broken tab. The
same defensiveness `clampCardSize()` already applies.

From `docs/design/spec-sorting.md` → "An existing sort is one criterion, not a seeded chain".

**Blocked by:** 04 — Choosing a field seeds the sentence.

**Status:** done

- [x] A stored `{ field, dir }` reads back as a list of exactly one criterion — `storedCriteria()`,
      which is the one place that decides what in the entry is a sort at all
- [x] No chain is seeded from a migrated value
- [x] The stored entry is not rewritten until the sort is next changed — reading is `getSortChain()`
      and writing is `saveSortChain()`, and nothing on the read path calls the write one
- [x] A stored value of the wrong shape, or naming an unsupported field, falls back to the view's
      default — `getSortChain(view, def, fields)` takes the calling view's field list now, and all
      five views pass theirs
- [x] A stored list longer than three is truncated to three — `tidyChain`, which the read path was
      already going through
- [x] Reading the entry never throws, whatever is in it — `readPrefs()`
- [x] Each of the five views migrates independently — one broken entry does not affect the others
- [x] `test/cardsort.test.js` covers the old shape, the new shape, and a spread of malformed ones
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

Three things settled here:

- **A view's field list is what a stored sort is read against.** Falling back to the view's default
  needs somebody to know what the view supports, and `getSortChain` did not — so a Set Browser with
  a stored `qty` sorted on a column that tab has not got, while the select displayed Set Number: a
  control saying one thing and a table doing another. The list is now the third argument, the same
  one `mountSortControl` and `seedChain` already take, and each view hands over the constant it
  already declares. Collections builds its list per render, under the rule `reconcileColSorts`
  already carries: the caller must know the list is real, and it is, because the collections are
  hydrated before anything draws.
- **`total` is renamed on the way in, not dropped.** Reading against the view's fields would
  otherwise throw away the one preference this ticket exists to protect — the Collections header
  wrote `total` before it wrote `qty`, and they are one field. So there is a small alias table on the
  read path. `sortKey` still answers `total` as well: that is the floor under a value arriving from
  somewhere this table has not thought of, and it is not the thing that keeps the control's select
  honest.
- **The entry is parsed defensively, and so are the other two.** `JSON.parse` on a truncated write
  did not give the sort a bad value — it threw as `sortui.js` loaded, taking down the file every tab
  gets its sort control, its column menu and its card-size slider from. That is a blank app rather
  than a lost preference, and the same line was under `mtgtools_cols` and `mtgtools_size`, so
  `readPrefs()` is what all three read through. Verified in the real page as well as in the sandbox:
  a browser handed `{"collections":{"field":` for its sort, `[[` for its columns and `"300"` for its
  size still draws the table, mounts the slider, and sorts by name.
