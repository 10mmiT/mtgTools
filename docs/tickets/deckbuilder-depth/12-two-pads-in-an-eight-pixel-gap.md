# 12 — Two 44px pads in an eight-pixel gap

**What to build:** a category heading whose controls stop eating each other's touch targets.
`npm run measure:mobile` fails on the **deckview** tab and has done since before this effort
started: fifteen `button.pile-toggle` controls report a 36–41px hit area against the 44px floor.
It is the last checkbox on every other ticket in this directory, so until it is fixed no ticket
here can honestly claim to be done.

**This is not a button that is too small.** The toggle already carries the "padded rather than
grown" `::after` that the mobile rule asks for, and the pad is the right size. The failure is what
is next to it.

`.dv-section-hdr` is a flex row with `gap: var(--space-2)` — eight pixels. In it sit the 22px
chevron, whose invisible pad reaches eleven pixels past each of its edges, and then
`.dv-section-title.db-collapsible`, the category name, which is *also* a control and carries a pad
of its own by the same rule (`tabs.css`, the phone block). Eight pixels is not enough room for two
pads that each want twenty-two. They overlap in the gutter, and the title — later in DOM order, at
the same stacking level — is what `document.elementFromPoint()` returns there. The chevron keeps
its whole pad on the left, where nothing contests it, and loses the right-hand half.

That is the whole of the 36–41px spread, too: the title's pad is `width: 100%; min-width: 44px`,
centred on the title. A long category name's pad starts at its own left edge, eight pixels away,
and the chevron measures 41. A short one — *Ramp*, *Draw* — has a pad wider than its text, which
reaches back into the gutter and stops a pixel short of the chevron, and the chevron measures 36.
**The shorter the category name, the worse it gets.**

**Nobody has noticed because both controls do the same thing.** The chevron and the title both call
`dbToggleCat(catName)`, so a finger landing anywhere in the contested strip folds the category
either way. What is broken today is therefore the measurement's honesty rather than anyone's
thumb — and the collision is a pattern, not an incident. The same two-pads-in-one-row shape with
two *different* actions in it is a control that silently cannot be pressed, and there is nothing in
the token contract or the mobile rule that would catch it being written.

**Collections' pile view passes the same measurement**, which is the confirmation: its header is
the same `pileToggleHtml()` beside `.card-pile-label`, a plain span with no pad and no click. One
padded control in a row is fine. Two is not.

**The likely fix, not prescribed.** The chevron and the heading are one control drawn as two
pieces, so the honest shape is one target: make the header row itself the thing that folds the
category, and take both pads away. Raising the chevron's pad over the title's with a `z-index` only
moves the theft in the other direction, and widening the gutter to twenty-two pixels spends mat
width in a column that is one card wide — the reason the pads exist instead of 44px boxes in the
first place. Whoever takes this should also check the other places the same technique sits next to
something clickable: `.deck-tile-link` in a deck tile's top row, and the search drawer's
colour-identity checkbox and its label.

Not from `spec-deckbuilder-depth.md` — this is a pre-existing failure that the effort's own
acceptance criterion trips over, found while building ticket 02 and written up rather than
absorbed. Ticket 02 records the same finding under *What was left*.

**Blocked by:** None — can start immediately. Blocks the last checkbox of every other ticket in
this directory.

**Status:** done

- [x] `npm run measure:mobile` reports the deckview tab clean, with no undersized targets
- [x] A category folds from the chevron and from its name, as it does today
- [x] The fix is one target rather than two competing ones, or the ticket records why not
- [x] A one-word category name is measured, since that is the worst case
- [x] Pile view, list view and grid view all still fold a category on a phone
- [x] The other adjacent uses of the pad technique are checked, and either cleared or fixed
- [x] Nothing on the mat moves on desktop — this is a phone-only rule and the headings are tight already
- [x] Works in all five themes
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

## What was built

`.dv-section-fold` — a wrapper around the three pieces of a category heading that
fold it, being the chevron, the name and the count. The click lives on the wrapper;
none of the three carries a handler of its own any more, and neither of the two pads
survives. The heading is one target, which is what it always was to a finger.

**It costs nothing above the touch breakpoint, because up there it is not a box.**
`.dv-section-fold` is `display: contents` by default and becomes a flex box with
`min-height: 44px` only inside `@media (width < 900px)` — the same block the rest of
the mobile target rules live in. With `display: contents` the three pieces stay direct
children of the header's flex line and lay out exactly as they did when they were
written there literally, so *"nothing on the mat moves on desktop"* is true by
construction rather than by care. It was checked anyway: every box in all fifteen
headings, measured to a tenth of a pixel at 1440px either side of the change, is
identical.

**The "⋯" menu stays outside the fold, and that is a decision rather than an
oversight.** It is a different action, so it is a different target — but the reason it
could not have gone in even if it were the same action is that
`scripts/measure-mobile.js` treats a control nested inside a control as one target and
skips the inner one. Folding the kebab into the row would have stopped the measurement
looking at it. It is 44×44 today and it is still measured saying so.

### The other places the same technique sits next to something

Both checked, both cleared, neither changed:

- **`.deck-tile-link`** — "View ↗" in a deck tile's top row. Its two row-mates are
  `.deck-source-badge` and the bracket badge, which are text and not targets, so the
  pad has the row to itself. That is the condition this technique needs, and the
  comment above the rule now says so instead of naming the heading it no longer covers.
- **`.db-ci-toggle`** — the search drawer's colour-identity checkbox. Its neighbour is
  its own `<label>`, and the pad *is* the label's, stretched over the row: the two are
  one control, so there is nothing for them to steal from each other.

### What was measured

`npm run measure:mobile` is clean on all sixteen views, deckview included. Beyond
what it can answer, driven in headless Firefox at 390px against the capture fixture:

- a category folds from the chevron, from its name **and** from its count, in grid,
  list and pile view — and does *not* fold from the "⋯" button, whose menu still opens
- all five themes fold, and every colour in the heading still comes from a token
- the short names are the ones that were worst — *Draw* measured 36px, against 41px
  for the long ones — and *Draw* is in the fixture and now measures clean
