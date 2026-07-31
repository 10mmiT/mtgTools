# 02 — Split the stylesheet into five files

**What to build:** The single large stylesheet becomes five: tokens, base, layout, components, and per-tab rules, loaded in that order. Load order is cascade order — later files may override earlier ones, never the reverse.

This is a **pure move**. Not one declaration changes. Its whole purpose is to make the token contract auditable by looking at one small file, and to make later tickets navigable.

No build step is added. Response compression is already enabled, so the split costs extra requests rather than extra bytes.

**Blocked by:** 01 — the baseline screenshots are what prove this changed nothing.

**Status:** done

- [x] Every rule from the original stylesheet lives in exactly one of the five files
- [x] The original stylesheet is removed, not left orphaned
- [x] Screenshots are pixel-identical to the ticket 01 baseline across all 110 views
- [x] Existing tests pass

**Delivered:** `public/css/{tokens,base,layout,components,tabs}.css`, linked in
that order from `index.html`; `style.css` deleted. 633 top-level rules moved,
none rewritten. `login.html` was never affected — it carries its own inline
styles.

Three `@media` blocks were genuinely cross-cutting (the Responsive block at old
lines 1315–1381, and the Phase 5.2 mobile pass at 2523–2578). Each was split by
target file with its `@media` wrapper repeated; no declaration inside them
changed.

**How "pure move" was checked**, since eyeballing 3288 lines proves nothing:

- Every rule flattened to (media, selector, properties) before and after — 811
  both ways, nothing lost, nothing invented.
- Every pair of rules that could style the same element at equal specificity
  with a shared property was checked for a change in relative order. Nine pairs
  were flagged and reviewed by hand; all are between selectors that cannot
  match the same element (`.tab-btn.active` vs `.view-btn.active` and similar).
- All 110 views byte-identical to the 01 baseline. A control run before any edit
  confirmed the harness is deterministic, so byte equality is meaningful.

One trap this caught: `input:focus { outline: none }` and
`input:focus-visible { outline: 2px solid }` have equal specificity, so the
focus ring depends purely on order. Screenshots cannot see keyboard focus, so
had the focus-visible block been filed into `base.css` the regression would
have shipped invisibly. It is in `components.css`, after the reset.
