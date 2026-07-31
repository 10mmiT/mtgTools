# 12 — Full-bleed layout and sidebar default

**What to build:** The cards get the room. Three changes together take horizontal chrome from roughly a fifth of the window to about a twentieth.

The fixed maximum content width is removed, replaced by two behaviours: **wide** for card grids and data tables, which use the entire available width; and **prose** for rules text, rulings, forms, admin screens, login and empty states, which keep a comfortable reading measure. A wide monitor now genuinely shows more cards, while long text does not stretch into unreadable ribbons.

The sidebar defaults to its narrow icon-only state. The collapse mechanism and its persistence already exist — only the default changes. Hover must **not** auto-expand it; that causes the layout to move while someone is scanning a grid.

The Deck Builder's bespoke full-width mechanism is replaced by the shared wide behaviour.

**Blocked by:** 07, 10

**Status:** ready-for-agent

- [ ] Card grids and tables use the full width, with no cap, on an ultrawide display
- [ ] No prose line exceeds the reading measure
- [ ] The sidebar starts collapsed, expands on click, and remembers an expanded choice
- [ ] Crossing the sidebar with the pointer does not change the layout
- [ ] Horizontal chrome measures under 80 pixels at a 1440-pixel window
