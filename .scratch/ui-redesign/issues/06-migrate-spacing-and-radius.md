# 06 — Migrate: spacing and radius scales

**What to build:** The app gains a consistent rhythm, so that it reads as built rather than assembled. 22 distinct gap values and 99 distinct padding declarations collapse onto six spacing steps; eight different corner sizes collapse onto three radii.

Largest blast radius of the four migration batches — expect this to touch the most call sites.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Every gap, padding and margin comes from the spacing scale
- [ ] Every corner radius comes from the radius scale
- [ ] Screenshots reviewed for layout breakage, especially dense tables and toolbars
- [ ] Existing tests pass
