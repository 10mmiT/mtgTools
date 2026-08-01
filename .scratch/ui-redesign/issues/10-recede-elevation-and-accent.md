# 10 — Recede: elevation, sections, headings, accent

**What to build:** The change that makes the interface stop competing with the cards. One rule drives it:

> A surface gets either a border or a shadow — never both, and never both plus a background step.

Flat surfaces get a hairline and no shadow. Only floating things — menus, modals, tooltips, drag previews, a lifted card — cast shadows, and they carry no border. Card images get neither at rest; the artwork is its own edge.

Panels lose their box treatment entirely and become plain sections, with an opt-in boxed variant for the few things that genuinely need containment. Section headings drop uppercase, letterspacing and their coloured bars.

The per-tab Magic colour accent **survives but shrinks to state only** — the active navigation item, focus rings, active view toggles, selected filter chips. It is removed from heading bars, hover tints, hover borders and tinted shadows. Magic colour used as *data* — mana symbols, mana-curve charts — is untouched.

**Blocked by:** 06, 09

**Status:** done

- [x] No flat surface carries both a border and a shadow
- [x] A screen at rest displays no accent colour except the active navigation item
- [x] Section headings are sentence case with no coloured bar
- [x] Focus is a single consistent, clearly visible indicator everywhere
- [x] Mana symbols and charts keep their colour identity

**Delivered:** the elevation allowlist emptied, 17 → 0; `.panel` renamed to
`.section` and stripped to vertical rhythm; the accent reduced to seven state
sites; one focus rule replacing two.

**The allowlist was the deliverable.** Ticket 08 wrote the elevation rule into
the linter and parked the seventeen surfaces that broke it. Each was resolved
by deciding which of the two things it is, not by re-scoping the rule:

- **Flat** — a hairline, no shadow: `.section` (now no box at all), the mobile
  header, `.mob-nav-btn`, `.players-add-bar`, `.player-section`, `.sf-card`,
  `.sf-card-lg`, `.card-detail-info`, `.pick-result-card` (which had a shadow
  and *no* border, so it gained the hairline).
- **Floating** — a shadow, no border: `.mob-nav-menu`, `.ac-dropdown`,
  `.col-menu`, `.card-modal-box`.
- **Neither** — `.card-detail-img`. The artwork is its own edge, so both the
  shadow and the accent halo are gone.
- **Both, one at a time** — `.grid-card`, `.sf-card-lg`, `.deck-tile` and
  `.card-print-tile` carry a hairline at rest and trade it for `--shadow-lift`
  while hovered, which is §15.2's hover-lift and the elevation rule agreeing
  rather than conflicting.

**The two side drawers are flat.** `.rss-panel` and `.db-search-panel` keep
their `border-left` and lose their shadow. A drawer pinned to the edge of the
viewport has one visible edge and is not floating in the middle of the page;
the shadow tokens all cast downward, so what they actually drew was a haze
over the content rather than an edge. Both sites had a comment deferring this
to ticket 10.

**The contrast theme needed a ring.** Removing the borders from overlays
assumes the lifted surface reads as a step above the page. On `contrast` it
does not: `--bg` is `#000000` and `--surface-1` is `#0a0a0a`, 1.06:1, under a
black shadow. A borderless dropdown or modal lost its edge there — on the one
theme that can least afford it. That palette's three shadow tokens now lead
with `0 0 0 1px var(--border)`. It is a ring at the element's own edge, not a
second signal cast beneath it, which is the same distinction the linter draws
when it exempts `0 0 0 <spread>` layers; an overlay still declares one thing
and still draws no border. Checked both ways in
`.scratch/ui-redesign/overlay-check.html`, which renders the four overlays
against the real stylesheets — the harness captures tabs at rest and cannot
reach any of them.

**The accent, after.** Seven sites survive, and each is a state §4.7 permits:
the focus ring, the active nav item in all three navs, the active RSS toggle,
the active theme-picker row, and `.card-print-tile.current`. What went: the
3px bar on every heading (fifteen on one page), the 16% fill tint behind three
active nav states, the hover tints and hover borders on steppers, sort and
column buttons, the accent-tinted glow under four hovered tiles, the halo
around the card image, and the accent-tinted price badge and P/T line on the
Card tab.

Two deliberate readings. `.card-print-tile.current` and the active view toggle
are visible at rest, which the "no accent at rest" line appears to forbid and
the "selected chip / active toggle" row of §4.7 explicitly permits; selected
state won. And the view toggle is left on `--primary` rather than moved onto
the accent §4.7 allows — the repaint made `--primary` near-neutral, so leaving
it there is strictly more receded than taking the licence.

**Focus.** One rule in `base.css` replaces two that disagreed on both colour
and shape: a 3px accent-tinted `box-shadow` on inputs, and a `--primary`
outline on everything else. Written as an explicit selector list rather than
the spec's `:where()`, which has zero specificity and would have lost the
`outline` property to the typed input selectors above it. The spec's
`border-radius` is dropped: it reshapes the element while focused, squaring
off pill buttons and round avatars, and browsers already follow the element's
own radius. Legibility is covered by measurement — `check-contrast.js` already
holds every mana colour to the 4.5 text floor on `--bg` and `--surface-1`,
because they are the accent.

**Verification.** 49/49. All 110 views recaptured and reviewed against
`post-repaint`; 109 changed. The rename that preceded this was confirmed
byte-identical across all 110 first, so this diff is the visual change alone.
Re-capturing `contrast` after the ring change is byte-identical at rest, which
is the check that it touched overlays only. Mana Base now fits a 1440×900
viewport where it used to scroll, and Collections shows twelve more rows in
the same height.

Not covered by the harness, and checked another way: overlays and the card
detail. The latter got its own capture — `--tabs` now passes anything
containing `=` through as a literal hash, so `--tabs 'card=Lightning Bolt'`
captures a view with no tab of its own. The default run is still 110.

**Left for later, deliberately:** `.grid-card` keeps its fill and hairline
rather than becoming the bare image §7.7 describes — the badges have to move
onto the artwork first, which is ticket 13's surface. Which sections deserve
`--boxed` is per-tab work for 13–19; seven have it now (the four forms, the
"who are you?" bar, and the calendar/best-days pair that would otherwise merge).
