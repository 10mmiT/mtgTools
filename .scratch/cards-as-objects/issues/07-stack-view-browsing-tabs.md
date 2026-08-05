# 07 — The stack view on Collections and the Set Browser

**What to build:** a third view on both card-browsing tabs, alongside list and grid, that draws
what you are looking at as stacks of cards on a table.

Stacks are grouped by whatever the tab is currently sorted by. Both tabs already share one sort-field
vocabulary through the shared sort control, so the stack view needs no second control and no new
stored setting: sort by rarity and the collection becomes four stacks of visibly different heights,
sort by mana value and it becomes your curve standing up off the table, sort by name and it buckets
on the initial letter. Changing the sort restacks the view.

The stacks are the renderer from ticket 05 and the sizing is the control from ticket 06 — nothing new
is invented here beyond the grouping.

This must not cost anything. A four-hundred-card set stays responsive, and the list view stays exactly
as fast and as plain as it is today: the stack view is an option, never a tax.

From `spec-cards-as-objects.md` → Implementation Decisions, "Stacks on browsing tabs are grouped by
the current sort field".

**Blocked by:** 05 — Stacks, and the Deck Builder's piles; 06 — The card-size control on the browsing
tabs.

**Status:** done

- [x] Collections and the Set Browser each offer a stack view alongside list and grid
- [x] Stacks are grouped by the tab's current sort field, and changing the sort restacks the view
- [x] No second control and no new stored setting is introduced for grouping
- [x] Sorting by rarity gives stacks of visibly different heights; by mana value, a row of stacks that reads as the curve; by name, buckets on the initial letter
- [x] Each stack shows its count and fans out on click
- [x] A four-hundred-card set stays responsive in the stack view
- [x] The list view is untouched and no slower
- [x] The card-size control sizes stacks on both tabs
- [x] The chosen view persists exactly as the existing view toggle already does
- [x] Works in all five themes and at 390px; `npm run measure:mobile` stays at 0
- [x] `npm test`, `npm run lint:tokens` and `npm run measure:layout` are green

**Built as:** the grouping in `sortui.js` beside the sort keys, and a table of
piles in `cardstack.js` beside the pile. That split is the ticket's own
sentence: the piles are cut by the sort vocabulary and drawn by the stack
renderer, and neither file learns anything about the other. `groupLabel()` is
one `switch` on the field the tab is already sorted by, and `cardGroups()`
collects a sorted list into piles in the order the labels first appear — so
reversing the sort turns the row of stacks around without being asked, and a
label that is not strictly monotonic in its sort key draws one pile rather than
the same label twice.

The labels are short because a row of stacks is read at a glance and the sort
control directly above says which field they are stacked by: mana value is
`0…7+`, not `Mana Value 3`. Two fields are bucketed rather than grouped —
price into the four bands a binder is sorted into, collector number into
hundreds — because both are unique per card and grouping on the value itself
would draw four hundred stacks of one, which is a grid with worse spacing.
Everything the app has not been told is one pile labelled `—`, not one pile
each.

Two decisions were made that the ticket did not name, both because the
criteria could not be met without them:

*A pile in a table is drawn as a share of the tallest pile, not as thick as it
is.* `stackLayers()` draws its difference across four cards to forty, which is
the range a deck's categories occupy — and every pile on a browsing tab is past
the cap. A collection stacked by rarity was four identical bricks and its curve
was a flat row, which is the acceptance criterion inverted. `pileLayers()` is
that share, still bounded by `stackLayers()`, so a pile never shows more edges
than it has cards under the face and never more than the cap. The Deck Builder
is untouched: its mat asks the absolute question and gets the absolute answer.

*A fanned pile spreads at most sixty cards.* A settled stack costs the same
whatever it holds, but a fan is real cards, and Collections hands this view its
whole twelve thousand. The fan says `60 of 4,214` where it is not the whole
pile.

Nothing else is new. A pile is `cardStackHtml()`, a fan is the spread the Deck
Builder's fanned category already draws — that rule moved to `.card-fan` in
components.css and the Deck Builder is now a caller of it — and the size
control sizes both through the `--card-width` it already sets. Neither tab
stores anything: the view is remembered exactly as list and grid are, which on
these two tabs means for as long as the page is open.

Verified in the real app against a copy of the live snapshot. A 12,788-card
collection stacks by rarity into 5,127 / 3,983 / 3,005 / 667 / 6 at depths
10 / 8 / 6 / 1 / 1, and by mana value into a curve of 2 / 4 / 10 / 10 / 7 / 4 /
2 / 1; by name it buckets on the initial, including one `#` pile and one `É`.
Restacking the whole collection takes 41–111ms against the list view's 95ms and
the grid's 117ms, and a 375-card set restacks in 3ms — the stack view is the
cheapest of the three, since it draws eleven cards per pile whatever the pile
holds. The angles are identical across a re-render; clicking a stack fans it and
clicking a card in the fan opens that card without settling the pile under the
hand; clicking the page settles it; the slider takes a stack from 151 to 242px.
Checked in all five themes, and at 390px, where two piles sit side by side and
a fanned one of sixty spreads without the page scrolling sideways. The Deck
Builder's mat still stacks, still fans, and still keeps its own thicknesses.

Two things had to give way, both recorded here because neither is this
ticket's subject:

- **Collections' strip loses the word "Size".** The stack view's button was the
  width that broke it — the strip fitted at two views and wrapped to two rows at
  three, and the fold this tab is measured on went from 102px to 149px against a
  105px budget. That tab's strip carries more controls than any other in the
  least room, since the deck column takes the right-hand third of the window
  the fold is measured in. The label goes there at every width, the way every
  strip loses it on a phone and for the same reason; the slider keeps its
  tooltip and its accessible name, and the other three tabs keep the label.
- **`fetchCardCollection()` now asks in batches of five hundred.** The local
  endpoint answers the first five hundred names and says nothing about the
  rest — neither as cards nor as `not_found` — so a caller asking for eight
  hundred took the silence for "no such card" and marked three hundred of them
  permanently unresolved. That is 4,762 of this collection's 12,788 cards, and
  it was the difference between a rarity stacking with four piles and one with
  five. It is a pre-existing bug in a shared helper, visible today as `—` in
  the list view's rarity column; the stack view is only what made it obvious.

Known and left alone: a row of stacks wider than the pane wraps, so a
nine-pile curve at 150px cards runs onto a second row on a 1440px window — the
size control is how the whole row is made to fit, and a mat that wraps is what
the Deck Builder does too. Want Lists and Scryfall Search draw cards and have
no stack view; they are not this ticket's tabs, and each is one call away.
