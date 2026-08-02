# 15 — Want Lists and Pick Night

**What to build:** Want Lists gets the toolbar merge, and its player filter chips adopt the new per-player palette — the tab where the previously-missing light-theme player colours matter most. Its table is dense text, so it is the strongest case for keeping data on a solid surface.

Pick Night collapses its two boxes into one toolbar, and its result grid uses the extra-large card size, since seeing the picked deck **is** the feature.

**Blocked by:** 12

**Status:** done

- [x] Autocomplete, import, and both export formats still work
- [x] The player filter and every sort mode still work
- [x] Player chips are legible on all five themes
- [x] Picking a deck still works and the result is prominent

**Delivered:** two rows in a box down to one strip on Want Lists (229px fold →
94), two boxes down to one strip and a drawer on Pick Night (133px) — and the
per-player palette finally connected to the tokens issue 09 defined for it.

**The palette was the real work, and it is not in the stylesheet.** Issue 09
repainted `--player-0…7` for all five themes and nothing used them: the app
painted from an eight-hex list written for the dark theme, held *in the data* —
one hex per player record, assigned at creation. So a player's colour became a
**slot**: which of the eight is the player's, what that slot looks like is the
theme's. `playerSlot()` reads either form — `colorIdx` on records written since,
the hex's index in the old list on records written before — and `playerColor()`
returns `var(--player-N)` rather than a resolved colour, so a theme switch
repaints text that is already on screen.

**That change had to pass the write guard, which is why the server derives the
slot too.** `/api/state` refuses a non-admin who alters any player but their
own, comparing every other player value-by-value after normalisation. A client
that has migrated re-sends slots where the stored record holds hexes — the same
colour, spelled differently — so with `color` still in the comparison the first
save after an upgrade would have been a 403 for everyone but an admin.
`normalizePlayer` compares `playerSlot(p)` instead, and a test asserts both
directions: the re-spelling is not a change, a different slot still is.

**The chip is one component now.** `.pick-chip` was written for Pick Night and
borrowed by the Want List's filter — two tabs, one control, one copy — so it is
`.chip--select`, a variant of issue 13's chip. Selection is carried by the fill
and the border *colour*, never the border width: a chip that thickens when
picked shifts every chip after it along the row.

**Legibility is by construction rather than by luck.** The label is `--text` on
the slot colour at 18%, not the slot colour used as its own label. All forty
label/fill pairs — eight slots on five themes — are measured by
`check-contrast.js`, whose player pairs were updated to the shape the app now
uses; the worst is 8.99:1 against a 4.5 floor. Five of them were measured again
in the browser, off the computed style of a chip that had actually been
clicked, which is where the mix and the theme override could have disagreed
with the arithmetic: 9.8 / 12.2 / 12.8 / 11.2 / 10.2.

**§7.6's opaque container went on `.table-wrap`**, so it is every table in the
app — Collections' and Admin's are the same component, and §8.5's
opaque-over-playmat requirement applies to them equally. `tbody tr:last-child`
drops its bottom border, since the container draws that line now.

**Two things deleted rather than moved.** `initCollapses()` — every section it
restored at boot has since stopped being a collapsible, and the one left
(Admin's Create User) was never restored across a visit anyway. And Pick
Night's `scrollIntoView` after a roll: it existed because the results were
below two stacked boxes and started off-screen. They are the first thing under
the strip now, and "Re-roll all" calls the same function from inside them.

**One thing added that the ticket did not ask for.** With the pool behind a
button, Pick Night before the first roll was a strip, a row of chips and an
empty page — worse than what it replaced. The results area says which step is
outstanding instead, in the terms of that step: an empty pool is a different
problem from an unchosen table, and the strip's status line is a count, not an
instruction.

**Departures from the spec, both in §9.7.** "Player select" stayed a chip row —
choosing two to six people is a multiple selection. And `.card-grid--xl`'s 220px
is a *card* width; these are landscape art tiles, so the same intent is 260px,
with `auto-fit` rather than `auto-fill` — there are never more than six results,
and auto-fill's empty tracks would hold four picks at the minimum width and
leave a third of a 1440px row blank.

**Verification.** 67/67 tests (one new, over the write guard above), token
contract clean, contrast clean, layout clean — chrome 78px across all eleven
tabs, folds 60/60/94/102/133, no prose past the measure. Thirty-seven
interaction checks driven in a real browser against a throwaway copy of the
snapshot database: every criterion above, plus the drawer's scrim, Escape, the
tab switch, and the palette's round trip through the API.

Three of those checks failed on their first run and none of the three was the
app. The strip-is-one-row check compared the *tops* of controls that are
different heights; the theme check's contrast maths read
`color(srgb 0.8 0.84 0.91)` — what `getComputedStyle` returns for a
`color-mix()` — as 0-255 components; and exclude-own-decks reported a
self-dealt deck because the check had filled the pool from a single player's
shelf, which that constraint cannot satisfy, so the roll alerted and left the
previous results standing. Written down because the middle one would have read
as this ticket's central claim failing.

All 110 views recaptured (`t15`) against `post-sets`: 55 changed, 55 identical. Forty
of the fifty-five are this ticket — every `wants--*` and `pick--*` view, the
ten `players--*` views where the header rule is now a slot colour, the ten
`admin--*` and the five desktop `collections--*` views where the table gained
its surface (the phone Collections views default to grid, so they have no
table and are byte-identical, which is the shape that change should have). The
remaining ten are the `sets--*` views, and are not this change: the set index
was still filling between the two captures — the diff is entirely owned-count
figures and the toolbar's "indexing 48 of 315", which the README's note on the
harness already covers. Both tabs captured at tablet and tablet-wide too
(`t15-tablet`), since each grew a sticky strip that has to clear the mobile
header below 900px and sit at the top of the window above it.

**One test moved with the code, and it is worth saying why.**
`themes.test.js`'s "the contrast theme is held to a higher floor" probed the
floor by dimming `--text` and asserting only the contrast theme complained.
That probe had a band — dim enough to fail 7:1, bright enough to clear 4.5:1 —
and this ticket closed it: `--text` now lands on a selected player chip, which
is the lightest backdrop it sits on in either theme, so a value dim enough to
fail contrast's body floor fails the chip pair on *both* themes and the result
says nothing about floors. It probes `--hdr-fg` instead, which has one pair per
theme against a backdrop of that theme's own choosing. Same fixture value, same
assertion, plus one more: the failure must be on the `body` floor, which is the
one that differs.
