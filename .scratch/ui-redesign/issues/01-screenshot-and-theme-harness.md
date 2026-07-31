# 01 — Screenshot and theme-override harness

**What to build:** A way to see every screen of the app at once, so that every later change can be judged against what came before instead of trusted. Two parts: a URL parameter that selects a theme directly, and a capture script that renders every tab in every theme at desktop and phone widths.

The theme override is independently useful — a bad stored theme preference currently cannot be cleared without developer tools.

Use the browser already installed on the machine and the app's existing URL-based tab routing. No new dependencies.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A theme can be selected by URL parameter, validated against the known theme ids, taking precedence over the stored preference
- [ ] An invalid theme value falls back to the stored preference rather than breaking the page
- [ ] A capture script produces all 110 views (11 tabs × 5 themes × 2 viewports) in one run
- [ ] The script runs against open mode so no login is required
- [ ] Captured output is excluded from version control
- [ ] A baseline set is captured and kept for comparison
