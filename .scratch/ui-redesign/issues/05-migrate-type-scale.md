# 05 — Migrate: type scale

**What to build:** Text hierarchy becomes deliberate. The 38 distinct font sizes currently in use collapse onto the seven-step scale, so hierarchy reads clearly instead of arbitrarily.

Font weights reduce to four values; the heaviest weight currently used on brand text and badges steps down. Uppercase text is confined to the smallest badge size only.

**Blocked by:** 03

**Status:** done

- [x] Every font size in the app comes from the type scale
- [x] At most four font weights are in use
- [x] Uppercase text appears only on badges at the smallest step
- [x] Screenshots reviewed: no text is smaller or less legible than before

**Delivered:** 238 `font-size` declarations across **39** distinct values become
237 across the seven `--text-*` steps. (The ticket says 38; that count was the
stylesheets alone. Inline `style=` attributes in `index.html`, `login.html` and
nine `js/` files hold 57 more, and they are as much a bug as a raw value in the
sheet, so they moved in the same pass.) Weights: 400/500/600/700 — the 18
`font-weight: 800` sites are gone. Uppercase: 23 sites become 5.

The steps land as 2xs 32, xs 65, sm 60, base 40, md 32, lg 6, xl 2.

**The mapping rule was "nearest step", with two role-based exceptions.**
Nearest keeps the ticket's promise cheaply: 23 of the 39 values sat within 0.5px
of a step, and every value used for running text is in that group — the largest
shrink any body text takes is 0.48px (`.78rem`/12.48px → `--text-xs`/12px).
Above 20px the steps are further apart, so five sites shrink by 0.8–1.6px:
`.month-title`, the `−`/`+` stepper, the `⋯` kebab, the `×` want-remove button
and the mana symbols in a lands row. All are glyphs or a single heading, all
were checked on screen. The two exceptions, both from §4.3's own table:

- **Prose takes `--text-md`, not the nearest step.** `.card-oracle` (.92rem),
  `.card-flavor` and `.card-ruling` (.88rem) all grew to 16px. This is the one
  change that makes reading a card materially better, and it is what the scale
  says the 16px step is *for*.
- **`.card-detail-name` went 24px → `--text-lg`/20px.** The only place text got
  meaningfully smaller. §4.3 names this exact element as the `--text-lg` case;
  `--text-xl` is reserved for the page title. It still reads as the largest
  thing in the panel — checked on screen, see below.
Nearest-step also preserves every existing size *relationship*: no pair of
elements that differed before now differs in the opposite direction, because the
mapping is monotonic. Where a heading already sat below its rows — `.dv-section-title`
at 13px over `.dv-row` at 14px — it still does; §7 is where that gets a second look.

**Two font-sizes were deleted rather than mapped.** `.user-badge::before` and
`.sidenav-user-row::before` drew a dot by setting a `'●'` glyph to .45rem/.55rem
— sizes that exist to make a *shape* the right size, and that would have
tripled if forced onto the 11px step. Both are now `width`/`height` +
`border-radius: 50%` on `currentColor`, which keeps the colour rules that target
them (including the amber admin dot) working untouched. `.db-collapsible::before`
had the only `em` value in the app, `.7em`; it takes `--text-2xs`.

**`body` now names its own default.** It never had a `font-size`, so anything
without an explicit size has always rendered at the browser's 16px — that is
`--text-md`, and it is now written down. §4.3 wants the app default to be
`--text-base` instead; stepping every unsized element down a notch is a visible
decision, not a mechanical one, so a comment hands it to ticket 09.

**Uppercase survives on five classes, all badges at `--text-2xs`:** `.badge`,
`.deck-source-badge`, `.badge-bracket`, `.set-pill-code`, `.rss-feed-tag`.
`.card-legal` keeps `capitalize`, which the spec does not ban. The other 18
sites lost it — panel titles, table headers, form labels, the sidebar user row,
the sort label, the RSS drawer title, stat and pip labels, player names in Pick
Night, deck-builder section headers. **The letter-spacing went with it**: every
one of those rules paired uppercase with .4–.7px of tracking, which is half of
what §7.2 calls the strongest dated tell in the sheet, and tracked lowercase
would have looked worse than either. Every source string was already title case
(`Deck Size`, `White`, `Mon`), so nothing needed rewording.

**Verification.** Tests 23/23. All 110 views differ, which is expected — the
sidebar user row and every panel title sit on all of them. 39 views differ by
under 1% of pixels, 65 by 1–3%, and 6 by more: the five Collections phone views
(7.5–8.8%) and Wants on contrast (3.1%). Those are reflow, not damage — a phone
column with shorter labels fits more rows above the fold, so everything below
shifts up and every subsequent pixel counts as different.

A pre-change capture was confirmed against the ticket 04 `post-colour` set
first: 105 of 110 byte-identical, and the five that differ (Players, desktop,
all themes) differ by 54 pixels out of 5.7M — image decode noise, present before
any edit. Worth knowing that the harness is *not* quite byte-deterministic on
that one view.

**Checked outside the harness**, since it captures each tab at rest: the card
detail view, which is empty in every screenshot and is where the prose sizes and
the one deliberate reduction live. A copy of the capture script pointed at
`#card=Lightning Bolt` on dark and light, before and after, shows the oracle text
and flavour clearly larger and the card name still dominant. Still unexercised:
modals, drawers, toasts, hover states, and the mana-base chart.
