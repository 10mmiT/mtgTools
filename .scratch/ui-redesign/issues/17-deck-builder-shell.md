# 17 — Deck Builder shell and toolbar

**What to build:** The Deck Builder joins the rest of the app. Its bespoke full-width mechanism is replaced by the shared one and the pane returns to the normal application shell; its top bar adopts the shared toolbar.

Its mat surface gains a dedicated per-theme token — the groundwork for later unifying it with the user's chosen playmat.

This ticket changes **appearance only**. The builder's interaction — drag and drop, multi-select, autosave, category management, statistics — is untouched here, and the pile-based rebuild lives in the separate interactivity brief.

**Blocked by:** 12

**Status:** done

- [x] Autosave still works
- [x] Drag and drop, multi-select and bulk moves still work
- [x] Import and export still work
- [x] The statistics bar still works
- [x] The mat surface is theme-aware on all five themes

**Delivered:** three control rows down to one strip, and the cards onto a mat
that is a token rather than the page it happened to sit on.

**The shell half was already done** — issue 12 folded the pane back inside it
and `.db-full-width` became `.db-pane`, one declaration. What was left of this
ticket is the strip and the mat.

**The strip is one step past the spec's sentence.** §9.5 says `.db-topbar`
adopts `.toolbar`, but the topbar was one of *three* control rows — the deck
picker, the view/sort/filter row, and the add-card row — and converting the
first alone would have left a bordered sticky strip with two loose rows under
it, which is the stacking this phase exists to remove. All three are the one
strip, in the Set Browser's two shapes (§9.3): `[data-db-mode]` on the pane,
`.db-when-deck` on everything that acts on a deck's cards. 44px, one row, at
1440.

**Two things left the strip for the `⋯`,** which is where §7.3 sends anything
that is not search, count, view, size, sort or columns. "New Deck" is done
rarely and is now the menu's first item; "Search / EDHREC" is a drawer button
and keeps its magnifier without the words. Everything else in that menu is
`.db-when-deck` too, because every one of those actions already returned early
without a deck — a menu of eight items that all do nothing is not a menu.

**The save status is the strip's `.result-info`,** in the slot every other tab
gives its result count. A deck's counts are on the stats bar, three of them,
and what this tab has to say about the state of its data is whether the last
edit is saved. It is the flexible spacer as well, so it ellipsises rather than
pushing the strip onto a second row.

**`[data-db-mode]` replaced six `style.display` writes.** `_dbShowDeckUI` and
`_dbHideDeckUI` set one attribute; the CSS says what that means. The
alternative was to keep a list of element ids in the JS in step with the
markup, which is how `dbCategoriesBtn` came to be toggled in two places. One
exception stays in JS: the delete button also depends on *whose* deck it is,
which no attribute on the pane knows.

**The mat is `#dbDeckContent` on `--mat`** — a fill, a hairline, `--radius-md`
and `--space-3` of padding. It is the one filled box left on the tab, and
deliberately so: §7.1 took the fill off sections precisely so that a surface
which really is a surface can mean something. The token was defined for all
five themes by issue 09 and had no user until now; `check-contrast.js` was
already walking body text against it, so the five themes needed no new
measurement, only a first use of what it had been measuring.

**The empty state gained a button,** because "New Deck" left the strip and a
first-time user with no decks would otherwise have to find the `⋯` to make
one. It is the same markup in both places by construction rather than by
copy: `_dbEmptyMat` is read out of the pane at boot, so putting a deck down
lands on exactly what a cold load shows.

**Category columns went to `--space-3`** (§9.5), a step tighter than the
`--space-4` they had: on a wide mat that is another column of piles rather
than another lane of empty mat between them.

**Three corrections while in here.** `.dv-row` had **seven** grid tracks for
eight cells, so the move and remove buttons wrapped onto an implicit second
row under every card's name and each row of the list view was twice as tall as
it needed to be — it has eight now. (Below 640px the row genuinely is two
rows, which is what that media query is for, and it is untouched.) And
`.db-body`, `.db-left-panel` and `.db-right-panel` are deleted: they were the
40/60 split from before the search panel became a drawer, with no element
wearing any of them, and their comments still pointed at `.db-full-width`.
`.btn-outline` goes with them: the Search / EDHREC button was its only user in
the app, and §7.4 names four button treatments, of which it is not one.

**Mobile is better but not finished,** the same sentence issue 13 wrote about
Collections. The strip wraps to four rows on a 390px phone. Folding sort and
view behind an overflow there is issue 20's business and touches five tabs at
once.

**Verification.** 67/67 tests, token contract clean, contrast clean, layout
clean — chrome 78px, folds 16/60/60/94/102/133 unchanged, no prose past the
measure at either window.

Thirty interaction checks driven in a real browser against a throwaway copy of
the snapshot database: every acceptance criterion above, plus the two shapes,
the strip's row count at 1440, autosave proved by reload rather than by its
own status line, both import paths and both export files taken off the ⋯ menu
through an intercepted download, and the mat's computed background against its
theme's own token on all five themes.

Two of those failed first and neither was the app: the row-count check compared
the *tops* of controls that a centred strip leaves at different heights — the
same mistake issue 15 made, now measured off centre lines — and the CSV import
appeared to add nothing because the Scryfall queue was in a 60-second 429
back-off, so it waits on the card rather than on a guess.

All 110 views recaptured against `pre-db-shell`: twenty changed, ninety
byte-identical. Ten of the twenty are the `deckview--*` views and are this
ticket. The other ten are `sets--*` and are not: the set-index sweep filled
from 91 of 315 sets to 155 across the session, so those tiles' owned-counts
moved on their own, which is the first of the README's two harness caveats.

**The ten standard deckview views are the empty mat,** because a deck is chosen
from a `<select>` and no URL says which — the tab with a deck in it cannot be
reached by hash routing, exactly as the card detail could not in issue 16.
Eleven deck-loaded views were driven and captured separately (`t17-deck`):
list, grid and pile on the dark theme, one view on each of the other four, two
on a phone, and one either side of 900px — the width where the stats bar stops
being fixed and the strip starts clearing the mobile header instead of the top
of the window.
