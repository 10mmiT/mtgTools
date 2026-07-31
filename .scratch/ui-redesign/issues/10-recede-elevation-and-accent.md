# 10 — Recede: elevation, sections, headings, accent

**What to build:** The change that makes the interface stop competing with the cards. One rule drives it:

> A surface gets either a border or a shadow — never both, and never both plus a background step.

Flat surfaces get a hairline and no shadow. Only floating things — menus, modals, tooltips, drag previews, a lifted card — cast shadows, and they carry no border. Card images get neither at rest; the artwork is its own edge.

Panels lose their box treatment entirely and become plain sections, with an opt-in boxed variant for the few things that genuinely need containment. Section headings drop uppercase, letterspacing and their coloured bars.

The per-tab Magic colour accent **survives but shrinks to state only** — the active navigation item, focus rings, active view toggles, selected filter chips. It is removed from heading bars, hover tints, hover borders and tinted shadows. Magic colour used as *data* — mana symbols, mana-curve charts — is untouched.

**Blocked by:** 06, 09

**Status:** ready-for-agent

- [ ] No flat surface carries both a border and a shadow
- [ ] A screen at rest displays no accent colour except the active navigation item
- [ ] Section headings are sentence case with no coloured bar
- [ ] Focus is a single consistent, clearly visible indicator everywhere
- [ ] Mana symbols and charts keep their colour identity
