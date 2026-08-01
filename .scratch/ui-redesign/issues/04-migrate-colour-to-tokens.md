# 04 — Migrate: colour declarations onto tokens

**What to build:** Every colour decision in the app enters the theme system, so that a theme other than the default is no longer second-class.

Roughly 89 colour declarations currently sit outside the theme definitions. The most visible consequences: the eight per-player colours have **no theme variants at all**, so player chips show dark-theme colours on light backgrounds; and "you own this card" indicators are hardcoded.

Two documented exemptions survive, each carrying a comment saying so: text and controls layered over card artwork may use fixed white or black, since their backdrop is an image rather than a theme surface; and colour-mixing an existing token is permitted anywhere.

**Blocked by:** 03

**Status:** done

- [x] No raw colour value remains outside the token file except documented, commented exemptions
- [x] Player chips are legible and correct on all five themes
- [x] Ownership and warning indicators use the new status tokens throughout
- [x] Screenshots show no change beyond colours that were previously wrong on non-default themes

**Delivered:** 116 colour-bearing declarations outside `tokens.css` become 29.
All 29 survivors carry an exemption comment naming the rule they fall under.
Ninety-five of the 116 were the ticket's own count (the spec's audit said ~89);
the extra 15 were `box-shadow` rgba values, which are raw colour too and which
ticket 08's linter would reject, so they moved onto `--shadow-overlay/-modal/
-lift` as part of this batch.

**Where the colour went.** `--primary-fg` took 29 call sites — every `#fff` on
a filled surface. The mobile header is the interesting case: it is filled with
`--hdr-bg`, which is near-black on the dark themes and the brand purple/brown
on light and sepia, so all of its chrome draws in `--primary-fg`, and the
translucent variants became `color-mix()` of it. That is exact: `--primary-fg`
is `#ffffff` on all five themes, and `color-mix(… 25%, transparent)` resolves
to precisely the `rgba(255,255,255,.25)` it replaced.

`--success` took 14 — the "you own this card" dots, quantities, price badges
and the want toast, all of which were `#10b981` regardless of theme.
`--warning` took the two admin markers and the loading/bracket badges. The
`html[data-theme="light"]` overrides for `.badge-loading`/`.badge-loaded` were
**deleted**: the tokens now do that job on all five themes, not just one.

**Player chips.** `.p0`–`.p7` each name one `--player-N`; a shared rule derives
the text colour and a 20% `color-mix()` fill from it, matching the `33` alpha
the hardcoded fills used. One token now drives what was two values per chip.

**Deliberate visual changes, all of them things that were wrong before:**

- The deck-tile scrim was tinted `rgba(12,9,22,…)` with a differently-tinted
  light-theme override. Both became pure black at the same alphas, one rule.
  Its purpose is legibility for the fixed white text over artwork, so it sits
  under the artwork exemption rather than taking a token.
- `.btn-dv-tile` was indigo `#6366f1`, a hue belonging to no palette. It takes
  `--primary`. Visible on the dark theme too — unavoidable, there was no token
  equivalent to preserve.
- `.rarity-tag.r-uncommon` was `#a9b6c4`; silver-as-a-rarity is the same grey
  `--mc-c` already carries, and the neighbouring rarities were already on
  `--mc-*`.
- Modal and drawer backdrops took `--scrim`, so the light themes stop dimming
  behind a black veil.
- `lands.js` held a *second* WUBRG palette, slightly different from `--mc-*`
  and with no theme variants. It now names the mana tokens.

**Two things worth knowing for later tickets:**

- **The shadow tokens are all cast downward**, so the two right-hand drawers
  (`.rss-panel`, `.db-search-panel`) lost the leftward offset they had. Both
  still have a `border-left`. Flagged in comments; ticket 10 decides which
  surfaces cast a shadow at all, so it is the natural place to fix this.
- **`login.html` was a second, stale copy of the palette** carrying only dark
  and light — so anyone who had chosen contrast, sepia or forest was shown the
  dark theme on the way in. It now links `tokens.css`. That file needs its own
  public route in `server.js`, because the static mount sits *behind* the auth
  guard and an unauthenticated login page would otherwise render unstyled.

**Knowingly left, not exempt:** `PLAYER_COLORS`/`COLORS` in `public/js/state.js`
and `routes/state.js`. These are defaults written into stored player and
collection records, so moving them to `var(--player-N)` means migrating rows
that already hold a hex value. Ticket 15 says its player filter chips adopt the
new per-player palette, which is where that migration belongs. Both sites carry
a comment saying so.

**Verification.** Tests 23/23. A pre-change capture was confirmed byte-identical
to the ticket 03 `post-tokens` set before any edit, so the comparison is sound.
All 110 views differ, as expected — the sidebar's admin dot and the header sit
on every one — but 90 of them differ by under 0.07% of pixels, and the bottom 20
by under 0.005%. The change is concentrated exactly where intended: Players
1.6–3.4%, Deck View 0.6%, Available 0.2–0.3%.

Not covered by screenshots, because the harness captures each tab at rest:
pick-night results, card and deck-builder modals, drawers, toasts, and all
hover states. The mana-base chart is also unexercised (pip counts are 0), so
its six colours were checked separately by rendering the same markup against
the real token file on all five themes — each stays distinct and the counts
are legible on light and sepia, which they were not before. The login page was
checked against a running server with the auth guard active: `/login` and
`/css/tokens.css` both return 200 unauthenticated, while `/css/tabs.css` and
`/` still redirect.
