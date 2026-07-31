# 01 — Screenshot and theme-override harness

**What to build:** A way to see every screen of the app at once, so that every later change can be judged against what came before instead of trusted. Two parts: a URL parameter that selects a theme directly, and a capture script that renders every tab in every theme at desktop and phone widths.

The theme override is independently useful — a bad stored theme preference currently cannot be cleared without developer tools.

Use the browser already installed on the machine and the app's existing URL-based tab routing. No new dependencies.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A theme can be selected by URL parameter, validated against the known theme ids, taking precedence over the stored preference
- [x] An invalid theme value falls back to the stored preference rather than breaking the page
- [x] A capture script produces all 110 views (11 tabs × 5 themes × 2 viewports) in one run
- [x] The script runs against open mode so no login is required
- [x] Captured output is excluded from version control
- [x] A baseline set is captured and kept for comparison

**Delivered:** `?theme=` in `public/js/main.js`; `scripts/capture-screens.js`
(`npm run capture-screens`), which starts the server in open mode and drives the
installed Firefox headless over WebDriver BiDi — no new dependencies. Baseline
set of 110 views plus a contact sheet in `.scratch/ui-redesign/shots/baseline/`.

The baseline was captured against a snapshot of the production database, so the
panes show real collections, decks and availability rather than empty states.
The snapshot lives in `.scratch/ui-redesign/capture-data/` and is passed with
`--data`; refresh it before a phase that needs to be judged on current content.

Tall pages are clipped to 4000px — Collections is 18,049px on desktop and
22,866px on phone, which is neither reviewable nor thumbnailable. Raise or
remove the cap with `--max-height` when a specific pane needs its full length.
