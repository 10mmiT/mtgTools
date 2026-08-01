# 07 — Migrate: consolidate breakpoints

**What to build:** Seven inconsistent responsive breakpoints reduce to three, so responsive behaviour is predictable rather than accidental.

This ticket carries **two deliberate behaviour changes** that must be verified at tablet width, not just desktop and phone:

- The navigation switch between bottom bar and sidebar moves from roughly 860 pixels to 900
- The card detail view's switch between modal and full page moves from roughly 1024 pixels to 900

**Blocked by:** 03

**Status:** done

- [x] Only three breakpoints appear in the stylesheet — 640, 900 and 1280, written as
      range queries (`width < 900px` / `width >= 900px`) so no boundary needs an
      off-by-one twin. 720, 860, 861, 1023 and 1024 are gone. The same numbers now
      back the JS comparisons too, via `BP_SM`/`BP_MD` in `state.js`.
- [x] Both behaviour changes verified at tablet width, in addition to the standard
      capture. Two viewports added to the harness — `tablet` (880px) and
      `tablet-wide` (960px) — which straddle 900; the default desktop/phone pair
      never crosses it. At 880: sidebar hidden, mobile nav shown, card opens as the
      full-page tab. At 960: sidebar shown, card opens as the modal, and the Card
      nav entry is hidden because the modal covers it.
- [x] The mobile bottom navigation and week-list calendar behave exactly as before —
      all 110 shots of the standard capture are byte-identical to the pre-change set.
- [x] Existing tests pass (23/23).

Also fixed by the consolidation: `.db-stats-bar` was static below 1023px but offset
for the sidebar above 861px, so between those two it got both at once.
