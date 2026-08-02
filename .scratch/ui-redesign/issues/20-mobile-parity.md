# 20 — Mobile parity pass

**What to build:** Everything above, designed rather than merely surviving, on a phone.

The app has substantial existing mobile behaviour — a bottom navigation bar, a week-list calendar, grid as the default view, a capped result count. None of it may regress. But several decisions taken for desktop are meaningless or wrong on a phone: full width, a collapsed sidebar, and a large background image all need explicit mobile answers rather than inherited ones.

**Blocked by:** 13, 14, 15, 16, 17, 18, 19

**Status:** done

- [x] Every tab reviewed at phone width across all five themes — 55 phone screens, plus the
      three surfaces the harness cannot reach on its own: the Deck Builder with a deck loaded,
      its search drawer, and the nav dropdown
- [x] All touch targets are at least 44 by 44 pixels — 507 undersized controls down to none,
      measured by hit test rather than by bounding box
- [x] Bottom navigation, the week-list calendar, the default grid view and the capped result
      count all behave as before — no JavaScript was changed; all four confirmed on screen
- [x] No horizontal overflow on any tab — it was already zero on all eleven, and still is
- [x] Dense tables remain usable and scroll within their own container

**Delivered:** a stated touch-target rule with a ruler that can check it, the three inherited
desktop decisions written down, and two real defects the pass turned up on the way.

**Everything failing was a touch target.** The first measurement said the sideways-scroll
criterion was already met — zero on all eleven tabs — and that 507 controls were under 44px.
Those 507 are 24 distinct controls repeated down lists: 186 card names in search results, 82 ✕
buttons in the Want Lists matrix, 63 kebabs on deck tiles, 22 mana-base steppers. Almost all of
them were exactly `N × 44`, because the rule that existed set `min-height` and nothing else, so
every control in the app was already tall enough and none of them was wide enough.

**One rule, two ways of obeying it.** Which way a control takes is the design decision, and the
rule in `components.css` now says so. A control standing on its own in a strip — the view
toggle, the sort direction, a kebab, the steppers — **grows**, because bigger is easier to see
as well as to hit. A control set into dense content — the ✕ on a chip, a card name in a table
row — keeps its painted box and **pads** its hit area with a centred `::after` sized
`max(own, 44)` on each axis, because growing it would pull the content apart. The pad has no
fill, border or shadow, so §7.3 has nothing to say about it.

**Inputs were the whole control vocabulary nobody had checked.** Every text field in the app was
38px tall — six under the minimum, on every form, on every tab. They are in the height rule now.
Checkboxes are not: a 44px checkbox is a design rather than a target, and the app's two are
padded from their labels instead. The colour-identity toggle's label is a sibling rather than a
wrapper, so the pad stretches the label over the whole row — which is the behaviour you wanted
anyway, since on a phone the row is the switch.

**A rule that had never matched anything.** The 44px guarantee for Available@'s month and week
arrows named `.avail-nav-btn`, `.cal-nav button` and `.cal-nav-btn`. The app has never put any
of those three classes in its markup. The arrows are `.nav-btn`, and they measured 32 wide.

**Two defects the pass found rather than caused.** A deck tile lays its three rows out inside an
absolutely-positioned overlay against a 160px minimum, so the tile's height is fixed whatever is
in it: making the top row a proper control row pushed Compare and Build out through the
`overflow: hidden`. On a phone the overlay is back in flow and 160px is a floor rather than a
ceiling — which also settles a tile whose commander line wraps to two lines, and those were
being clipped the same way before any of this. And the builder's search drawer is
`min(50vw, 95vw)`: half the screen at 1440 is 720px of results, but at 390 it is 195px, and a
195px drawer renders the Scryfall query box as the word "Scryfall" with nowhere left to type.
It takes 92vw on a phone, near enough what the RSS panel's fixed 310px already amounts to here.

**A sticky strip now leaves room under itself.** The toolbar sits at the top of eight tabs and
is painted over whatever scrolls beneath it — which, on a phone, is a 44px tap target whose top
half is empty space around a line of text. Flush against the first row it ate the top of that
target, making the first result in a list the hardest one to hit. One step of clearance.

**The three inherited decisions, answered in `layout.css`.** *Full width* inherits cleanly and
is kept; what changes is the gutter, which drops a step below 640 because 16px either side of a
390px window is 8% of it. *The collapsed sidebar* does not survive the trip and does not need
to: there is no sidebar below 900px, and every rule reserving room for one already lives inside
the `(width >= 900px)` block, so a phone never pays for a control it cannot see. *The playmat
image* has to be answered where it is built — the app has no background image yet, issues 22 and
23 add it, and the off-by-default-on-mobile decision travels with them. A rule guarding a token
that is still a flat colour would guard nothing.

**A note on the ticket's own wording.** "Bottom navigation bar" describes something the app does
not have. Below 900px the nav is `.mob-nav`, a dropdown at the *top* of the page; `.tab-bar` is
the sidebar and is `display: none`. The redesign document says it too — §4's breakpoint table
calls 900px the point where the nav switches "bottom bar ↔ sidebar", and §8.2 promises an
"unchanged bottom nav" below it — and it has never been true of the app. Nothing was changed
here: the criterion was read as "the mobile nav must not regress", and it has not.

**The ruler: `scripts/measure-mobile.js`, and `npm run measure:mobile`.** Sibling of
`measure-layout.js`, same plumbing, same shape — the two mobile criteria are numbers and a
contact sheet cannot produce a number. What it measures for targets is the area a finger can
land on rather than the box the control paints, because after this pass those are deliberately
not the same thing: it hit-tests with `elementFromPoint` and bisects outwards from the centre.
That sees pads, and it catches the two failures a bounding rect cannot see at all — a target
with something painted over it, and two neighbours whose pads overlap so that one swallows the
other's edge. Both happened.

**Two of them are worth recording, because they are what a rect-based ruler would have shipped.**
A card name long enough to wrap is an inline box split across two lines, and the pad hangs off
the first fragment only — the middle of the name, exactly where a thumb lands, still belonged to
the table cell behind it. `display: inline-block` makes it one box. And a padded name needs a
row tall enough to hold the pad, or two successive names' pads overlap and the wrong card opens.

**Which is a height on the `tr`, and it took three tries to get right.** A step of extra cell
padding derives 44 from a line box and lands on 42 or 43 depending on the name — and pays for
the miss a second time on every row tall enough already. The same height on the `td` stops being
a minimum and becomes a cap: Admin's rows came out 45px tall with a 44px Edit button inside
them, spilling over the dividers. On the row it is a true minimum — a short row is lifted to
exactly 44, and a row holding a wrapped card name or an Edit button still grows past it. Dense
tables stay dense across, which is the axis they are dense on.

**One pixel of slack, and it is the ruler's rather than the design's.** Firefox snaps the far
edge of a hit region down to a whole pixel, so a control laid out on a fractional boundary —
which at these widths is most of them — hit-tests up to a pixel narrower than the 44 its
computed style says it is. An earlier version of the script reported a true 44px pad as 43.7 and
failed it; that is the browser's rasterisation, not a design fault.

**Three views have no tab of their own** and are measured as extra passes. The builder's search
drawer and the RSS panel are full-height surfaces on a phone carrying controls nothing else does
— the RSS header's two buttons were 28 wide — and each is scoped to itself, since the page
behind an open drawer is unreachable by design and counting its controls as unhittable would
report the drawer working as a fault. Collections' list view is there for the opposite reason: a
tab is measured as it arrives, and Collections arrives as a grid of card art, so the densest
table in the app was not being looked at at all. It was hiding rows two pixels short. The sweep
still sees every other tab in its default view only, which is written into the README along with
how to add one.

**Verification.** 67/67 tests, token contract clean, contrast clean, layout clean — chrome 78px,
folds and prose unchanged, since none of this is visible above 900px. `measure:mobile` reports
zero sideways scroll and zero undersized targets across all thirteen views. All 55 desktop
screens recaptured and compared byte-for-byte against `post-players-admin`: 50 identical, the
other five being Available@ in all five themes, which draws a calendar around today and
straddled midnight — the second of the README's two harness caveats. The two changes that
landed after that comparison were re-checked the same way at 1440 and at 960, byte-identical
again, which is what a rule living inside `(width < 900px)` should be. Phone screens
recaptured in all five themes; the Deck Builder with a deck, its drawer, the nav dropdown and
the RSS drawer shot separately, since the harness reaches none of them.
