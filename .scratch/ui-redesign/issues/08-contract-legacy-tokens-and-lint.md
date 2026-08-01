# 08 — Contract: delete legacy tokens, add the linter

**What to build:** The "contract" half of the refactor. With every call site migrated, the superseded tokens are deleted — and a linter lands to stop the drift from ever recurring.

The linter is the project's second test seam. It asserts a machine-checkable property of the delivered stylesheet, which is the only automated guarantee the visual redesign can have.

**Blocked by:** 04, 05, 06, 07 — every migration batch must land before the old forms can be removed.

**Status:** done

- [x] Every superseded token is deleted, with no remaining references
- [x] The linter fails on: raw colour outside the token file without an exemption comment; off-scale font sizes; off-scale spacing; off-scale radii; shadows on non-overlay surfaces; and uses of the importance override beyond a declared allowlist
- [x] The linter passes on the current codebase
- [x] The allowlist starts at the current count of importance overrides and is documented as shrinking to zero
- [~] Screenshots unchanged — **not achievable alongside the first box.** 92 of 110 views
      differ, every one of them by at most 27/255 on a single channel. See below.

**Delivered:** six tokens deleted — `--card`, `--card-2`, `--muted`, `--danger-lt`,
`--radius`, `--shadow` — across all five themes and all 233 call sites.
`scripts/lint-tokens.js` (`npm run lint:tokens`, and `npm test` runs it via
`test/tokens.test.js`). Tests 23 → 39.

**The rename was provably pixel-neutral; deleting `--shadow` was not.**

Four of the six were aliases ticket 03 created precisely so this step could be
mechanical: `--surface-1: var(--card)` and friends. Call sites moved to the new
name and the alias was replaced by the literal it resolved to. A script parsed
old and new into per-theme token maps, resolved every `var()` chain, and
confirmed that all 45 surviving tokens and all four renames resolve to
byte-identical values on all five themes. `--radius` had no references left.

`--shadow` is the exception, and it could not be avoided. Ticket 03 deliberately
created **no** `--shadow-raised`: the elevation rule says flat surfaces get a
hairline, so the only shadows in the vocabulary are the three overlay ones.
`--shadow` therefore has no equal-valued successor, and its ten call sites — all
flat, bordered surfaces that ticket 10 will strip entirely — went to
`--shadow-overlay`, which is softer and doubly-layered. That is the whole of the
visual change: **92 views differ, none by more than 27/255 on any channel, with
no reflow and no content difference.** Reviewed at full size before/after on the
Lands panel and the Available sidebar; the two are indistinguishable at 1:1.

The alternative was to keep a superseded token alive purely to hold a pixel
still, which is the drift this ticket exists to end.

**A trap in the screenshot harness, worth knowing.** The first comparison showed
ten Sets views differing by up to 245/255 — far too much for a shadow. It was
not the change: **the Set Browser's list comes from the live Scryfall API**
(`sets.js:18`), not the local snapshot, so two 2026 sets swapped order upstream
between the two capture runs. Confirmed by capturing Sets with the *pre-change*
CSS after the fact: it matched the post-change ordering and differed from it only
by the 27/255 shadow. The baseline was then recaptured in full at the current
data state, which is the `pre-contract` set on disk. **The harness is not
reproducible across time on the Sets tab**; capture its before and after close
together, or discount that tab.

**What the linter checks.** Six rules — `colour`, `type`, `space`, `radius`,
`shadow`, `important` — over the five CSS files *and* the inline `style=`
attributes in the two HTML files and all nineteen JS files, which is where drift
would actually reappear. The scales are read out of `tokens.css` at startup
rather than duplicated in the script, so that file stays the single written-down
definition. It is a plain-Node CSS parser; no dependency was added.

Two decisions worth recording:

- **"Shadows on non-overlay surfaces" needed a machine-checkable form.** Nothing
  in CSS says what an overlay is. It became two checks: a `box-shadow` may only
  be built from the `--shadow-*` tokens, and no rule may declare a border *and*
  a shadow — which is the spec's elevation rule stated exactly. A `0 0 0 <n>`
  layer is treated as a ring, not a shadow: it paints at the element's own edge,
  it is how every focus ring here is drawn, and the accent is explicitly
  permitted on focus rings.
- **A second allowlist was unavoidable.** With that rule live, seventeen
  surfaces fail it — `.panel` and everything that copies it, plus four
  accent-tinted glows. Fixing them *is* ticket 10, and doing it here would be a
  visual change under a ticket that is supposed not to make one. So the rule
  lands now and the violations are held in an `ELEVATION_ALLOWLIST` that
  shrinks to zero in 10, exactly like the `!important` one.

**The `!important` count is 16, not 15.** The spec said fifteen; that is the
number of *source lines*. It is 14 rules and 16 declarations — `.sort-select`
spends two lines on one rule and the admin form packs two onto one line. 16 is
the number to watch down to zero. A test asserts both allowlist sizes, so
neither can grow quietly, and the linter also fails if an entry reserves more
than the code still uses.

**Exemption comments got a scope.** The five that existed were prose: one said
"everything from here to `.deck-tile-edit`", which no script can act on. A
comment now escapes only the rule it *names* ("EXEMPT from the radius scale"),
and only within the enclosing rule, the next rule, or an explicit
`EXEMPT-BEGIN`/`EXEMPT-END` span. Naming no rule escapes everything, which is
almost never wanted — and the `.card-detail-img` comment turned out to be doing
exactly that by accident, because its prose mentioned the word "colour". An
unclosed `EXEMPT-BEGIN` is itself a lint failure; silently switching the linter
off for the rest of a file is the one failure mode that must not be quiet.
`!important` can never be excused by a comment — the allowlist is the only route,
so the count stays visible in one place.

**Eleven genuine one-offs were found and commented** rather than forced onto a
scale: four `-2px` border overlaps (a tab underline sitting on the bar's own
border), the two literal sidebar widths in `.site-main`, the pile-fan offset
that tracks card width, and the artwork overlays that ticket 04 left
uncommented. `calc(var(--space-6) + var(--space-4))` is accepted as on-scale —
two steps added is not a new value — but `calc(var(--space-6) + 3px)` is not.

**Verification.** Tests 39/39 (23 server, 16 contract). The contract suite has
two halves and needs both: one asserts the real CSS is clean, the other asserts
each rule *fires*, against synthetic sources. A linter that passes because it
checks nothing is worse than no linter, because it reads as a guarantee. There
is also a test that greps the whole of `public/` for the six deleted tokens,
independent of the linter.

Still unexercised by the harness, as in every prior ticket: modals, drawers,
toasts, hover states.
