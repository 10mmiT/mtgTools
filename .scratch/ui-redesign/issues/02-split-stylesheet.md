# 02 — Split the stylesheet into five files

**What to build:** The single large stylesheet becomes five: tokens, base, layout, components, and per-tab rules, loaded in that order. Load order is cascade order — later files may override earlier ones, never the reverse.

This is a **pure move**. Not one declaration changes. Its whole purpose is to make the token contract auditable by looking at one small file, and to make later tickets navigable.

No build step is added. Response compression is already enabled, so the split costs extra requests rather than extra bytes.

**Blocked by:** 01 — the baseline screenshots are what prove this changed nothing.

**Status:** ready-for-agent

- [ ] Every rule from the original stylesheet lives in exactly one of the five files
- [ ] The original stylesheet is removed, not left orphaned
- [ ] Screenshots are pixel-identical to the ticket 01 baseline across all 110 views
- [ ] Existing tests pass
