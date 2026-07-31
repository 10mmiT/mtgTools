# 03 — Expand: add the new token vocabulary

**What to build:** The full set of new design tokens, added *beside* the existing ones. Nothing consumes them yet and nothing is removed, so this ticket cannot break anything — it is the "expand" half of an expand–contract refactor.

Tokens are semantic, naming the job a value does rather than the value itself, so they can be repainted per theme without renaming.

Covers: the surface and text ramp; border, primary, and status colours including the two that never existed (owned/success and warning); an eight-colour per-player categorical palette; seven type steps; six spacing steps; three radii; the elevation set; three breakpoints; and the prose measure.

**Blocked by:** 02

**Status:** done

- [x] Every token in the design spec's contract is defined, for all five themes
- [x] The success, warning and per-player tokens exist per theme — these have no equivalents today
- [x] No existing token is removed or changed
- [x] Screenshots are unchanged from ticket 02

**Delivered:** `public/css/tokens.css` grows from 122 custom-property declarations
to 284. 41 colour tokens × 5 themes, plus 22 theme-invariant scale tokens (seven
type steps, two leadings, six spacing steps, three radii, three breakpoints, the
prose measure) in their own `:root` block ahead of the palettes.

**Values were chosen to keep today's appearance, not §5's repaint.** Ticket 04
must move call sites onto tokens without changing anything that was already
right, and ticket 09 is what repaints. So:

- Where an exact equivalent exists the new name aliases the old one —
  `--surface-1: var(--card)`, `--text-muted: var(--muted)`,
  `--danger-soft: var(--danger-lt)`. This makes 04 provably pixel-neutral and
  leaves 08 a mechanical inlining step when the old names are deleted.
- `--success` and `--warning` take the values that were hardcoded through the
  sheet (`#10b981`, `#fbbf24`) on the dark theme, so 04 changes nothing there,
  and get purpose-built values on the four themes where they were simply wrong.
- `--player-0…7` take today's eight `.p0`–`.p7` *text* colours on dark, and
  same-hue variants tuned per theme elsewhere. One token now does the job of
  today's two values (a base at `33` alpha for the chip background, a lighter
  one for the text); the chip background becomes a `color-mix()` of it in 04.

Genuinely new, with no equivalent to preserve: `--surface-3`, `--border-strong`,
`--text-subtle`, `--primary-fg` (`#fff` on every theme — that is what the call
sites use today), the `--*-fg` on-colour text tokens, `--scrim`, `--mat`, and
the three overlay shadows. Light themes carry roughly half the shadow alpha.

**Two things worth knowing for later tickets:**

- **Breakpoint tokens cannot be used by `@media`.** Custom properties are not
  permitted in a media query, so ticket 07 has to repeat the literals 640/900/
  1280px. The tokens are still the single written-down definition and are
  readable from the computed style; the constraint is noted in the file.
- **`--text-2xs…--text-xl` are sizes, `--text`/`--text-muted`/`--text-subtle`
  are colours.** The collision comes from the spec's own §4.2 and §4.3; a
  comment flags it.

**Verification.** A script parsed old and new into (selector, property) → value
pairs: all 122 prior declarations present and byte-identical, 0 removed, 0
changed. A second script asserted the contract is complete — 41 tokens present
in all five theme blocks, 22 scale tokens in `:root`. All 110 views byte-identical
to the ticket 02 `post-split` set, and to a control run captured the same day.
Tests 23/23.

One trap: the first capture pair was run without `--data`, which renders every
tab empty (1440×900, no scroll) and so proves almost nothing about a stylesheet.
The README says to always pass it. Both sets were recaptured against a copy of
the populated snapshot.
