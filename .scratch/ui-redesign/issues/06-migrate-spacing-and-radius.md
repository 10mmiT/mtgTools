# 06 — Migrate: spacing and radius scales

**What to build:** The app gains a consistent rhythm, so that it reads as built rather than assembled. 22 distinct gap values and 99 distinct padding declarations collapse onto six spacing steps; eight different corner sizes collapse onto three radii.

Largest blast radius of the four migration batches — expect this to touch the most call sites.

**Blocked by:** 03

**Status:** done

- [x] Every gap, padding and margin comes from the spacing scale
- [x] Every corner radius comes from the radius scale
- [x] Screenshots reviewed for layout breakage, especially dense tables and toolbars
- [x] Existing tests pass

**Delivered:** 544 spacing declarations across **53** distinct raw values become 543
across the six `--space-*` steps; 127 radius declarations across **16** raw values
become 127 across the three `--radius-*` steps. (The ticket's counts — 22 gaps,
99 paddings, 8 radii — were the stylesheets alone and counted whole declarations
rather than the values inside them. Inline `style=` attributes in `index.html`,
`login.html` and eleven `js/` files hold 206 of the total, and they moved in the
same pass, as they did in 05.) The steps land as space-1 162, space-2 191,
space-3 111, space-4 118, space-5 20, space-6 21; radius-sm 47, radius-md 62,
radius-full 22.

**The mapping rule was "nearest step, ties round down."** Ties go *down* because
the redesign tightens the interface rather than loosening it — `1.25rem`/20px
(the container and every panel) lands on `--space-4`/16px rather than 24px, and
28px lands on 24px. Two consequences worth stating:

- **A gap or margin never rounds to zero, but padding may.** Two things
  separated by a 2px gap are separated for a reason, and 0 would merge them —
  so gaps and margins floor at `--space-1`. That is what widens the mana-curve
  bars, the calendar cells and the mana-cost pips from 2–3px to 4px. Padding has
  no such risk: an element keeps its content box either way, so the eleven sites
  under 2px (badges, chips, the pile quantity tag) become `0` on their vertical
  axis. Badges lose ~3px of height and gain ~2px of width; checked on screen,
  they still read as pills.
- **`--radius` (the legacy 10px token) went with them.** Its seven call sites
  take `--radius-md`, so panels, the mobile nav and the card-detail box are 8px
  rather than 10px. Nothing refers to `--radius` now; 08 deletes it.

**`50%` and `999px` corners both became `--radius-full`.** Every one of the 16
`50%` sites is a square element — dots, avatars, icon buttons, the toggle knob —
so 999px draws the identical circle, and the token is named for exactly this.
`.tog-pill`'s 9px on a 17px-tall track is the same case and took the same token.

**Eight declarations stay raw, all of them measured sizes rather than rhythm**,
each with a comment saying so:

- `padding-left: 186px` / `46px` on `.site-main` must equal `.tab-bar`'s fixed
  width or the content slides under the sidebar.
- Four `margin-bottom: -2px` / `margin-right: -2px` pull a tab's border on top
  of its bar's 2px border, so they must equal that border width.
- `.card-detail-img`'s `4.75% / 3.5%` is the corner ratio of a physical Magic
  card, which has to scale with the image. Same reasoning as the card-artwork
  colour exemption.
- `.db-pile-card`'s negative `margin-top` is a fraction of the card's own width,
  which is how a pile fans.

Three fixed-element clearances became sums of steps rather than literals:
`.db-body` and `.db-full-width` (48px, clearing the fixed stats bar; the two
disagreed at 48 and 72 before) and `.rss-panel-hdr` (56px, clearing the mobile
header). That last one shrank by exactly the 4px the header itself shrank by, so
its relationship to the header is unchanged — it was 12px short of the header's
real height before and it still is, which is invisible because the drawer's top
strip is padding.

**Verification.** Tests 23/23. All 110 views differ, which is expected of a
spacing pass — `.container`, `.panel` and every table cell sit on all of them.
Nothing broke: 35 views got **shorter** and none got taller, which is the whole
point. The biggest movers are Available on phone (−115px) and Pick Night on
desktop, which now fits the viewport instead of scrolling. The large diff
percentages (up to 50% on Collections phone) are vertical reflow, not damage —
everything below the first changed row shifts up and every subsequent pixel
counts as different.

Reviewed on screen at full size, before against after: the Collections results
table and its toolbar, the Wants table with its filter chips and price pills,
the Players deck-tile grid, the Mana Base pip grid and the Collections list on
phone. Table rows gain ~1.6px (td padding 7.2 → 8px), panels lose 4px of
horizontal padding, and nothing misaligns.

**Checked outside the harness**, since the card detail tab captures empty: two
cards on dark and light, before and after. Lightning Bolt for the prose and
legality chips, and Kenrith for mana symbols — its cost has two pips and its
oracle text has five inline ones. `.card-oracle .ms` lost its `margin: 0 1px`
rather than taking a step: 1px of letter-spacing on an icon glyph inside a
sentence is typography, and `--space-1` would have been four times too wide
between adjacent pips. At 4× zoom the pips are a hair tighter and still clearly
separate circles. Still unexercised: modals, drawers, toasts and hover states.
