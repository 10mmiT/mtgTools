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

**Status:** todo

- [ ] A stored `{ field, dir }` reads back as a list of exactly one criterion
- [ ] No chain is seeded from a migrated value
- [ ] The stored entry is not rewritten until the sort is next changed
- [ ] A stored value of the wrong shape, or naming an unsupported field, falls back to the view's default
- [ ] A stored list longer than three is truncated to three
- [ ] Reading the entry never throws, whatever is in it
- [ ] Each of the five views migrates independently — one broken entry does not affect the others
- [ ] `test/cardsort.test.js` covers the old shape, the new shape, and a spread of malformed ones
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
