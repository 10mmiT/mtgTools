# 07 — Migrate: consolidate breakpoints

**What to build:** Seven inconsistent responsive breakpoints reduce to three, so responsive behaviour is predictable rather than accidental.

This ticket carries **two deliberate behaviour changes** that must be verified at tablet width, not just desktop and phone:

- The navigation switch between bottom bar and sidebar moves from roughly 860 pixels to 900
- The card detail view's switch between modal and full page moves from roughly 1024 pixels to 900

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Only three breakpoints appear in the stylesheet
- [ ] Both behaviour changes verified at tablet width, in addition to the standard capture
- [ ] The mobile bottom navigation and week-list calendar behave exactly as before
- [ ] Existing tests pass
