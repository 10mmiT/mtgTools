# 18 — Available@ and Mana Base

**What to build:** Two tabs whose content is currently buried in boxes.

Available@ becomes a two-column layout on wide displays — calendar beside the best-upcoming-days panel — collapsing to one column below. The "who are you?" bar, which only appears for admins and in open mode, becomes a toolbar item rather than its own section. Availability markers adopt the per-player palette.

Mana Base has the second-worst chrome ratio in the app: four boxes and five headings. These collapse to two columns of plain sections. Its charts keep saturated Magic colour, because there the colour is **card data, not interface chrome**.

**Blocked by:** 12

**Status:** done

- [x] Toggling availability still works and still persists — driven in a browser, and
      checked against the server's own data rather than against the tab that wrote it
- [x] The best-upcoming-days ranking still works — the rendered order matches a recount
      of the API's data, day for day and count for count
- [x] The mobile week-list calendar behaves exactly as before — seven rows, this week
      not walkable backwards, next week reachable, a day toggling from the list
- [x] Mana Base calculations and charts are unchanged and remain colour-identifiable —
      a 100-card deck with 10 W and 5 U pips and 3 duals gives 38 / 3 / 35 and splits
      23 Plains to 12 Islands, with every bar and count drawn from `--mc-*`

**Delivered:** three boxes down to one strip on Available@, and a person's colour made
the same one everywhere. Mana Base's boxes were already gone — what it needed was the
fifth heading and the width.

**The strip is the tab's own.** §9.8 says the name bar "becomes a toolbar item, not its
own section", which reads as though there were a toolbar to put it on. There is not:
this tab has no search, no result count and no view toggle, so the one field it has is
the whole strip. It is `.toolbar` unchanged — sticky, `--bg`, the same hairline every
other tab's strip draws — with the label, the field, the hint in the `.result-info` slot
and "Remove me" pushed to the right where every other tab keeps its actions.

**Where the 106px went**, at 1440: the calendar grid starts 104px down the window,
from 210. The name box was ~110px of fill, hairline and padding around a single input;
the strip is 57. The two remaining boxes cost nothing to remove — §7.1 had already
decided that a section is a grouping and not a container, and these two were among the
last in the app still opting into `.section--boxed`. The best-days heading dropped the
inline `--text-md`/700 that made it a page title and is a `.section-title` like the rest.

**The colour was the real work, and it is the same shape issue 15 found.** §9.8 says
"availability dots use `--player-N`", and they did — through eight `.pN` classes in
tabs.css. But the *N* was the name's position in a sorted list of whoever had marked a
day, so a person was one colour here and another on the four tabs that call
`playerColor()`, and a new name early in the alphabet repainted everybody. The slot is
the player's own now (§5.6, `playerSlot()`), and `.name-tag` takes `--player` inline the
way every other tab hands a colour to a chip, a dot or a column rule — so the eight
classes are deleted rather than kept as a parallel mechanism.

Open mode is why this needs a fallback at all: anyone can type any name, and a name with
no player record gets a hash of the name itself. That is `playerSlot()`'s own fallback,
over the name rather than over an id these entries do not have — stable for that person
on every device, which a position in a list is not.

**`.btn-danger` existed in two rules and no stylesheet.** components.css named it in the
44px touch-target list and in the press feedback, against a class nothing defined and no
element wore — so both were matching nothing. "Remove me" was that treatment written out
under a private name (`.avail-remove-btn`: a `--danger-soft` fill, a `--danger` label),
which is §7.4's fourth row exactly. It is the class now, and the pair it draws was
already being measured by check-contrast.js.

**Mana Base had had three of its four sentences delivered by other tickets.** §7.1 took
the boxes off every section in the app, issue 04 put the charts on `--mc-*`, and the two
columns were the tab's own layout from before the redesign. What was left was one
heading and the width.

The heading: "Total Lands" was a `.section-title` floating inside the deck-size section,
held off it by an inline `margin-top`. It is a section of its own, so the tab's five
headings are five sections. With that, the column's spacing is the app's `--space-5`
section rhythm rather than that plus a `--space-4` flex gap on top.

**The width is where §9.10 is wrong, and the ticket says so rather than following it.**
It asks for two `.content-wide` columns. A calculator is a form, and §8.3 gives forms the
reading behaviour, not the wide one — uncapped, a 2560px window put the six pip fields
against one edge and the answer they produce against the other, **1318px apart** with
nothing in between. The layout is capped at 1240px: the pip row, which is the widest
thing on the left, plus the results column and the gap. The distance from the last pip
field to the answer is 76px at any width above the cap, and the pips stay on one row.

Three smaller things while in there: the answer follows the inputs down the page (sticky
above 900px, static below, where it is the end of the page and has nothing to follow),
"Reset all" is as wide as its label rather than the full column, and the tab's remaining
inline styles — a sticky offset written as `4.5rem` for a header that no longer exists at
that width, two field widths, a fit-content wrapper — are classes.

**Verification.** 67/67 tests, token contract clean, contrast clean, layout clean —
chrome 78px at both windows, no prose past the measure, folds 94 and 133 unchanged. The
default `measure-layout` run reports two fold problems on Want Lists and Pick Night;
those are the repo's own empty `data/` directory, which has no cards to make a grid
from, and both tabs measure clean against the snapshot database.

Twenty-eight interaction checks driven in a real browser against a throwaway copy of that
snapshot: every acceptance criterion above, plus persistence proved by reload and by the
API rather than by the tab's own render, the shake when a day is clicked with no name,
"Remove me" through an answered `confirm()`, the strip's three visibility states (open
mode, a player linked to a record, an unlinked account), the toolbar stopping under the
mobile header at `--hdr-h` below 900px, the steppers, Reset all, and a custom deck size
beating the preset.

All 110 views recaptured against `post-db-shell`: thirty changed, eighty byte-identical.
Twenty of the thirty are the `available--*` and `lands--*` views and are this ticket. The
other ten are `sets--*` and are not — the set-index sweep filled from the 155 sets issue
17 left it at to 301 of 315 by this capture, so those tiles' owned counts moved on their
own, which is the first of the README's two harness caveats. The strip with a name in it was captured separately
(`t18-strip`), on three themes and a phone: it is the only view that shows "Remove me",
and no URL can ask for it. The Mana Base chart was captured the same way (`t18-lands`),
on two themes, a phone and a 2560px window: the standard views open with the tab empty,
which is precisely the view that has no chart in it.
