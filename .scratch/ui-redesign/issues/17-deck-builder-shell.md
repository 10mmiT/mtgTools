# 17 — Deck Builder shell and toolbar

**What to build:** The Deck Builder joins the rest of the app. Its bespoke full-width mechanism is replaced by the shared one and the pane returns to the normal application shell; its top bar adopts the shared toolbar.

Its mat surface gains a dedicated per-theme token — the groundwork for later unifying it with the user's chosen playmat.

This ticket changes **appearance only**. The builder's interaction — drag and drop, multi-select, autosave, category management, statistics — is untouched here, and the pile-based rebuild lives in the separate interactivity brief.

**Blocked by:** 12

**Status:** ready-for-agent

- [ ] Autosave still works
- [ ] Drag and drop, multi-select and bulk moves still work
- [ ] Import and export still work
- [ ] The statistics bar still works
- [ ] The mat surface is theme-aware on all five themes
