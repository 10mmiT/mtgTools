# 14 — Scryfall Search and Set Browser

**What to build:** Both tabs get the same treatment: their search row and view toolbar merge into one strip, and results lose the box drawn around them so cards sit directly on the page.

The Set Browser's set picker additionally becomes a grid of set tiles showing code, name and how many cards are owned, replacing the current list. The owned-count figure moves into the toolbar as the result count.

**Blocked by:** 12

**Status:** done

- [x] Full Scryfall query syntax still works, searching on demand rather than while typing
- [x] Every view mode still works on both tabs
- [x] Collection ownership and price still show on results
- [x] The one-click add-to-want-list action still works
- [x] Set filtering and the ownership filter still work

**Delivered:** two boxes down to one strip on each tab — a 60px fold on both,
against Collections' 102 — and a server that can answer a question the browser
could not.

**The owned count had no source.** The tile is meant to say how much of a set
you own, and nothing in the app knew: a collection is card names and
quantities, since the importer drops the edition Archidekt and Moxfield both
report, and the bulk cache is Scryfall's `oracle_cards` — one entry per card
*name*, so it knows a name's set and not a set's names. Four ways out were put
to the user, who chose the one that actually answers it: `set-index.js`, two
tables in `scryfall.db` holding one row per (set, card name), filled by a
background sweep of Scryfall's search API and thereafter permanent, because a
released set does not change. About 1,400 paged requests for the 315 browsable
sets, roughly twenty minutes, once. A set that *does* change — a spoiler-season
set growing week by week — is re-indexed when Scryfall's `card_count` for it
moves.

**The two sides of the number are computed independently and are asserted to
agree.** The tile's figure comes from the index, server-side; the toolbar's
comes from counting ownership badges over the cards Scryfall just returned in
the browser. Both ask `unique=cards`, so a tile reading "176 / 286 owned" opens
onto 286 cards with 176 badges — checked in the browser, not reasoned about.

**The picker is the tab's landing view.** A hundred and twenty tiles cannot sit
permanently above a card grid the way a 220px scrolling box of pills could.
Choosing a set replaces them with its cards and puts the set on the toolbar as
a `.chip` whose ✕ goes back, so the strip has two shapes — and the controls
that act on cards (ownership, view, sort) exist only in the second, which is
one CSS rule on a `data-set-mode` attribute rather than four display toggles in
sets.js.

**The queue had to become shared before any of this was safe.** Scryfall's rate
limit is per IP, so a second module fetching on its own would have put the
server at 18 req/s against a limit of 10. `scryfall-queue.js` is the proxy's
queue, extracted; the sweep waits for each request before making the next, so
the queue never holds more than one background job and a search someone is
waiting for is never behind more than the job already in flight.

**A set not yet indexed says how big it is, not that you own none of it.** The
endpoint returns `owned: null` rather than 0 for those, the tile shows "262
cards" in the muted weight, and the toolbar count says how far the sweep has
got — the one place in the UI that admits the index is still filling. The tab
re-reads the list every fifteen seconds while that is true and it is the tab on
screen.

**The box around the results was already gone.** §9.2 asks for it to be
removed; what actually wrapped either tab was a `.section` around the *control
rows*, and `.section` stopped being a box in issue 10. Deleting the wrapper is
the merge, and the visible change on these two tabs is one strip where there
were two rows. Said plainly here because the ticket's wording implies a box
that a screenshot from before this branch would not show.

**The syntax tip moved into the empty state** rather than the `⋯` menu §7.3
would send it to. It is for the person who has not searched yet, which is
exactly who is looking at an empty results area; for everyone else it is gone
instead of occupying a permanent second row. `sfDebounce()` went with it —
already unreachable since the input lost its `oninput`, and search-while-typing
is the thing the first criterion forbids, so it is deleted rather than left as
an invitation.

**The fold is measured for both tabs now.** `FOLD_BUDGETS` gains `scryfall: 70`
and `sets: 70`, and `scripts/measure-layout.js` gains `FOLD_PREP` — these two
tabs show nothing until asked, so it asks: a query typed and entered, a set
tile clicked. Its fold selector also learned `.sf-grid`, which is why the Want
Lists tab now reports 229px: the app has two card grids and §7.7 describes them
as one, which they are not yet. That number is issue 15's starting point.

**Verification.** 66/66 tests — five new ones over `/api/sets`, seeding both
sides of the join by hand, including the case-insensitive match a hand-rolled
CSV needs and the null-not-zero rule. Token contract clean, contrast clean,
layout clean: chrome 78px across all eleven tabs, folds 60/60/102, no prose
past the measure. Thirty interaction checks driven in a real browser against a
throwaway copy of the snapshot database — every criterion above, plus the
picker filter, the chip's ✕, the tile/toolbar agreement, and the fold.

All 110 views recaptured against `post-collections`: 30 changed, 80
byte-identical. Twenty of the thirty are this ticket — every `scryfall--*` and
`sets--*` view — and the other ten are the `available` views, which the README
already lists as drifting on their own because that tab draws a calendar around
today and the captures are a day apart. The capture ran against a scryfall.db
whose index had been filled first, since a half-filled one shows "262 cards"
where a complete one shows "249 / 280 owned"; that is now written into the
README's note on the harness.
