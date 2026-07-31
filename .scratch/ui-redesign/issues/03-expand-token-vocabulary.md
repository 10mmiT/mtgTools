# 03 — Expand: add the new token vocabulary

**What to build:** The full set of new design tokens, added *beside* the existing ones. Nothing consumes them yet and nothing is removed, so this ticket cannot break anything — it is the "expand" half of an expand–contract refactor.

Tokens are semantic, naming the job a value does rather than the value itself, so they can be repainted per theme without renaming.

Covers: the surface and text ramp; border, primary, and status colours including the two that never existed (owned/success and warning); an eight-colour per-player categorical palette; seven type steps; six spacing steps; three radii; the elevation set; three breakpoints; and the prose measure.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Every token in the design spec's contract is defined, for all five themes
- [ ] The success, warning and per-player tokens exist per theme — these have no equivalents today
- [ ] No existing token is removed or changed
- [ ] Screenshots are unchanged from ticket 02
