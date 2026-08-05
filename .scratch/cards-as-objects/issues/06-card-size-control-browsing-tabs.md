# 06 — The card-size control on the browsing tabs

**What to build:** Collections, Scryfall Search and the Set Browser get the card-size control the Deck
Builder already has, so a big collection can be scanned at small card sizes and a single card can be
looked at properly at large ones. It appears in each tab's strip, only for the image-based views, and
the chosen size persists per view and per tab the way the existing sort and column preferences do.

This is the third of `ui.md`'s three deliverables. It is already built and persisted in the Deck
Builder; this extends it rather than inventing a second control.

The strip must not grow a row to hold it — the redesign measures each tab on how far down the page
the first card starts, and that figure must not regress.

From `spec-cards-as-objects.md` → Implementation Decisions, "One stack renderer, three callers", and
Further Notes.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Collections, Scryfall Search and the Set Browser each carry a card-size control in their strip
- [x] The control is shown for the image-based views and hidden for the list view
- [x] Both Grid and XL respond to it
- [x] The chosen size persists per view and per tab, and survives a reload
- [x] The control meets the 44×44 floor on a phone, and `npm run measure:mobile` stays at 0
- [x] The strip does not gain a row: the fold measurement for each affected tab does not regress
- [x] `npm test`, `npm run lint:tokens` and `npm run measure:layout` are green

**Built as:** one `mountSizeControl()` beside the sort control and the columns
menu in `sortui.js`, because that is what this preference is — how a view is
drawn, remembered per view. The Deck Builder's slider, its `dbScale` key and
its `--db-card-width` are gone: that tab is now the fourth caller of the
component it used to be the only owner of, and `--card-width` is one variable
that `.card-grid`, `.sf-grid`, `.sf-grid-xl`, the piles and `.card-stack` all
read. The two rules the Deck Builder kept for restating the grids with a
variable in them are deleted; the variable is in the grids themselves.

The store is keyed on tab *and* view — `collections:grid` is not
`collections:xl` is not `sets:grid` — which is what stops scanning a
collection at thumbnails from shrinking the XL view you keep for reading a
card. Each view opens where the stylesheet already drew it (grid 150, XL 220,
pile 150), so XL is still XL before anyone touches the slider, and a size that
is not a number or not in 80–300 is brought back into range on the way out of
the store rather than being handed to a grid. Those are the assertions in
`test/cardsize.test.js`, run against the shipped file through the vm seam.

A tab tells the control when its view changes and the control answers with the
size that view remembers; the whole mount is hidden in list view rather than
the slider inside it, since an emptied host is still an item in the strip's
flex row. It is hidden by a class and not an inline style because the Deck
Builder's mount is already hidden with no deck loaded and the Set Browser's
with no set chosen, and an inline display would overrule both.

Verified in the real app against a copy of the live snapshot: Collections
opens its grid at 150 and holds 240 across a switch to list and back and
across a reload; Scryfall Search takes its grid to 110 and its XL to 300 and
each comes back to its own number; the Set Browser goes to 90 with no sideways
scroll; the Deck Builder's stacks take their width from the same slider
(150 → 220) while its grid keeps the 150 it was left at. The fold is unmoved —
Collections 102 against its 105 budget, Scryfall Search and the Set Browser 60
against 70, the same three numbers as before the change — and
`npm run measure:mobile` is 0 on every tab, the slider included: Collections
arrives as a grid on a phone, so the control is measured there.

Known and left alone: Collections offers List and Grid but no XL, so "Grid and
XL" is met on the two tabs that have both. Want Lists has Grid and XL views
and no size control; it is not one of the three tabs this ticket names, and
adding it is one `mountSizeControl` call whenever it is wanted.

**Followed by:** both of those, immediately, at the owner's request — Want
Lists got the call, and the XL view was removed everywhere. XL was this
ticket's question answered once, at 220px, and nailed to a button; a slider
that runs 80–300 says that and everything between. So the toggle is List /
Grid (/ Pile), the four near-identical XL renderers and `.sf-grid-xl` are
gone, a browser left in the XL view comes back in the grid, and the sizes
stored against `*:xl` are pruned from the store. What XL also drew — a
`large` image rather than a `normal` one, and the mana cost and type line
under the art — is not kept: the slider's own top end is 300px, which
`normal` serves, and a card drawn that big shows its cost and its type line
itself.
