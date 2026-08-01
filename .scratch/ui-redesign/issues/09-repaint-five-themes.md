# 09 — Repaint the five themes

**What to build:** All five themes get new palettes. They keep their slots but differ by **temperature rather than hue**: a cool dark, a warm dark, a cool light, a warm light, and high contrast. Surfaces go near-neutral so that card artwork and the per-tab Magic colour are the only saturated things on screen.

The primary action colour becomes near-neutral too — a near-white fill on dark themes, near-black on light — so it stops competing with the Magic colour accent.

The warm-dark theme is **renamed**, because the repainted theme is warm-neutral rather than green and the old name would misdescribe it. A stored preference for the old name must map to the new one on read, or existing users of that theme silently fall back to the default.

The high-contrast theme targets AAA contrast for body text and AA for all interface text. Where contrast and aesthetics conflict there, contrast wins.

**Blocked by:** 04 — repainting only works once colour is fully tokenised.

**Status:** done

- [x] All five themes render coherently across all eleven tabs
- [x] The high-contrast theme meets AAA for body text and AA for interface text, verified by measurement not by eye
- [x] A stored preference for the old theme name resolves to the renamed theme
- [x] The full screenshot set is reviewed for any pane that is illegible on any theme

**Delivered:** five repainted palettes in `tokens.css`; `forest` retired in favour of
`dusk`; `scripts/check-contrast.js` plus `test/themes.test.js`, both wired into
`npm test` (49 tests, all passing).

**The measurement is the deliverable, not the palette.** `check-contrast.js`
reads the palettes out of the delivered stylesheet, resolves the 72 foreground/
background pairs the app actually puts on screen — including the 20% `color-mix()`
wash under a player chip, which is a composite, not a token — and reports the WCAG
ratio for each. 360 measurements across the five themes. Four roles carry four
floors: **body** text (4.5, and **7 in the contrast theme**), **ui** text (4.5
everywhere — labels, status, badges, mana glyphs, text on a fill), **subtle**
(3, and 4.5 in the contrast theme — placeholders and disabled, which WCAG
exempts), and **chrome**, which is not text (1.15, and 3 in the contrast theme,
where the hairline is a real boundary rather than a faint divider).

The first pass put 44 pairs under their floor, and the design brief's own values
were the source of most of them. Fixed by moving the colour, not the floor:

- Seven of the eight light-theme player colours and six of the sepia ones sat at
  3.3–4.5:1 against their own chip wash. Darkened until each cleared 4.6.
- `--mc-w` and `--mc-gold` on both light themes — yellow on white is the hardest
  case in the set; `--mc-gold` was 3.3:1. Darkened.
- `--text-subtle` on `--surface-2/3`, light and sepia, at 2.7–3.0.
- Light `--success` and `--warning` against their own soft badges, at 4.4.
- The contrast theme's `--border`, 2.66:1 on `--surface-1` — the one place the
  brief's value was too dark rather than too light. `#555` → `#6a6a6a`.

The one floor that moved was `chrome` on the four non-contrast themes: a hairline
at 1.2:1 is what "recede" asks for, and holding a divider to a text ratio would
have undone ticket 10's work before it started. The contrast theme keeps 3.

**What the near-neutral primary broke, and how.** `--primary-fg` now flips with
the theme — near-black on the dark themes — and three things were relying on it
being white on all five:

- **The mobile header.** Filled with `--hdr-bg` and drawn entirely in
  `--primary-fg`: logo, theme button, user badge, RSS toggle, and their
  `color-mix()` translucent fills. It now names its own ink, `--hdr-fg`, and
  `--hdr-bg` became a theme surface rather than a saturated brand bar.
- **The deck-filter toggle knob**, which has to read against two tracks:
  `--border` when off and `--primary` when on. One colour cannot do both any
  more, so off uses `--text-subtle` and on uses `--primary-fg`.
- **`.btn-dv-tile`**, the "Build" button on a deck tile. Ticket 04 moved it onto
  `--primary` from an indigo that belonged to no palette; a near-white wash under
  white text over artwork is unreadable, so it joins its neighbours on the
  white-alpha over-art exemption — which is what the design brief asked for.
  `.db-tile-move`/`.db-tile-del` hover to a theme fill over the same artwork, so
  they now swap their ink with it instead of keeping the scrim's fixed `#fff`.

`--primary-lt`/`--primary-tx` (the soft selected fill and its text) went from a
purple tint to a neutral one, and `--success-fg`/`--warning-fg`/`--danger-fg` went
dark on the dark themes: the status fills are light there, and white on them was
about 2:1.

**The rename.** `forest` → `dusk`, mapped in `applyTheme()` rather than
`initTheme()` so the retired id is rewritten in storage and the mapping is paid
once per user. `?theme=forest` resolves too. `login.html` repeats the two-line
mapping rather than reusing it, because it reads the preference before any app
code has run — both sites say so. `test/themes.test.js` runs the *shipped* theme
code for this: the section between main.js's own banners is sliced out and
evaluated in a `vm` context with stub browser globals, so the assertions are
against the real logic rather than a copy of it.

**One thing fixed that predates this ticket.** The dark themes were framed by
white scrollbars — plainly visible in the Set Browser in the ticket 08 screenshots.
Each palette now declares `color-scheme` and `scrollbar-color`. `color-scheme`
alone did not do it in the captured Firefox, so both are set; `color-scheme` is
still right for select menus and form controls.

**Verification.** 49/49 tests. All 110 views recaptured to
`.scratch/ui-redesign/shots/post-repaint/`. Every one was reviewed — twelve at
full size, the rest as per-theme montages of the top 700px (desktop) and the top
viewport (phone), which is where all the chrome is. No pane is illegible on any
theme. Not covered, because the harness captures each tab at rest: modals,
drawers, toasts, hover states, and the mana-curve chart (pip counts are 0).
Those colours are covered by the contrast measurement instead, which does not
care whether a pair is currently on screen.

**Left for later, deliberately:** the accent still appears on hover tints, panel
heading bars and card hover borders — that is ticket 10, not this one. The deck
tile's over-art controls are legible but low-contrast against pale artwork;
ticket 13 owns that surface.
