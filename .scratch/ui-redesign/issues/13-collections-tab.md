# 13 — Collections tab

**What to build:** The worst offender, fixed. Today someone opening their collection scrolls past four stacked boxes — an Add Collection form, a list of loaded collections, a search row, and a view toolbar — before reaching a single card, roughly 400 pixels down the page.

Afterwards: one toolbar and one row of collection chips, then cards. The Add Collection form moves into a drawer opened on demand, because it is a task performed rarely that currently occupies space used constantly. Each collection becomes a chip showing its name and card count, keeping its existing refresh, re-import and remove actions in an overflow menu. The search row and view toolbar merge into a single strip.

The Deck Comparison panel stays alongside on wide displays and becomes a drawer below that.

**Blocked by:** 12

**Status:** done

- [x] Card art is visible within roughly 100 pixels of the top of the viewport —
      102px at a 1440 window, from ~400px before
- [x] Adding a collection by URL and by file import both still work, from the drawer
- [x] Refresh, re-import and remove still work per collection
- [x] Deck comparison still works, including the filter-to-deck-cards toggle
- [x] Sorting, column selection and the view toggle behave as before

**Delivered:** four boxes down to one strip and one row of chips — and three
components the next five tickets inherit: `.toolbar` (§7.3), `.chip` and
`.drawer`.

**The fold is a number, so it is measured.** `scripts/measure-layout.js` grew a
fourth question beside chrome, prose and grid width: how far down the window
the first card sits. It clicks the tab's own view toggle to grid first, because
the criterion is about card *art* and the desktop default is the list view,
which has none. Budgeted per tab in `FOLD_BUDGETS` — only Collections has a
written-down number so far. 102px against a budget of 105.

**Where the ~300px went**, at 1440: the Add Collection form (~190px) into a
drawer, the collections list (~150px for six) into a 34px chip row, and the
search row and view toolbar (two boxes, ~110px) into a 44px strip. What is
left above the cards is 16px of page padding, the strip, 8px, and the chips.

**The toolbar is one step tighter than §7.3's snippet** — `--space-1` block
padding, not `--space-2`. The controls are 36px tall themselves, so the padding
is the entire discretionary part of the strip, and this ticket is measured on
that number. The spec's own §9.1 predicts ~96px, which its §7.3 padding cannot
reach; the annotation in the spec records the departure.

**The chip row scrolls sideways rather than wrapping.** It is the last thing
above the cards, so it has to cost one line whatever is in it — a seventh
collection must not push the grid down. The kebab menus inside it already
position themselves fixed when open (sortui.js), so nothing is clipped by that
overflow.

**The status badges and the progress bar are gone rather than moved.** A chip
is the name, one number and the `⋯` menu. The count *is* the progress bar —
while pages come in it reads "1,240 / 5,600" and the left number climbs — and
its colour is the status: `--warning` while loading, `--danger` for a
collection that failed, with the reason on the chip's tooltip along with the
source and the update time. Nothing else in the app used `.col-row`,
`.badge-source`, `.badge-loading/loaded/error` or `.progress-bar`, so they are
deleted, not orphaned.

**The deck comparison is one element in two shapes.** Below 1280px it is a
right-edge drawer opened from the toolbar; at 1280 and above it is the sticky
column it always was. `--bp-lg` was defined by issue 07 and marked "not yet
used"; this is its first use. The narrow shape is the base rule and the wide
one is the media query, because the narrow case is now the common one — a
1280px laptop no longer spends 272px on a panel that is empty until someone
loads a deck.

**A drawer is `[data-drawer]`, not a class**, so the deck column can be one
without inheriting `.drawer`'s geometry only to undo all of it at 1280. One
scrim sits behind whichever is open, and `closeDrawers()` is what the scrim,
the ✕, Escape and a tab switch all call. The tab switch matters: a drawer is
inside its tab's pane and hides with it, but the scrim is not, and would have
been left veiling the next tab with nothing under it to dismiss.

**A `visibility` transition is a trap.** The drawers are `visibility: hidden`
when closed so a closed form cannot be tabbed into. Transitioning that
property with a *duration* holds the old value for its whole length, so for
200ms after opening, the drawer was still un-focusable and the first field
could not take focus — typing into a just-opened drawer would have lost its
first characters. It is `visibility 0s .2s` closing and `visibility 0s`
opening: instant on the way in, delayed on the way out so the slide is seen.

**`--hdr-h`.** The toolbar sticks to the top of the window, but below 900px
the mobile header is sticky and opaque and gets there first. That header's
height is its contents' — 69px today — so `js/main.js` measures it at boot and
on resize into `--hdr-h` rather than a constant that would quietly stop
matching. Verified by scrolling: the toolbar's top and the header's bottom
agree to the pixel.

**Mobile is better but not finished.** The strip wraps to four rows on a 390px
phone, which is 205px of chrome where the desktop spends 60 — down from
roughly 800px, but the remaining rows want Sort and Columns folded into an
overflow menu, which is issue 20's business and touches five tabs at once.

**Verification.** 61/61 tests, token contract clean, contrast clean, layout
clean — chrome 78px, fold 102px, no prose past the measure. All 110 views
recaptured against `post-fullbleed`: exactly the ten Collections views changed
and the other hundred are byte-identical, which is the shape a single-tab
ticket should have. Tablet and tablet-wide captured as well, since the panel
straddles both remaining boundaries. Nineteen interaction checks driven in a
real browser against a throwaway copy of the snapshot database — every
acceptance criterion above, plus Escape, the scrim, the error path, and the
1280px switch in both directions.
