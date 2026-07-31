# 22 — Playmat from Scryfall card art

**What to build:** The app becomes personal. Pick any Magic card and its artwork becomes the background you play on.

Because the panel boxes are gone by this point, the playmat is what card grids sit on — visible through the gaps between cards. Cards on a table.

Artwork is fetched through the **existing** card proxy and image cache; no new external requests. The card picker reuses the existing want-list autocomplete. The **art crop** is used rather than the full card image, because it is the artwork without frame or text box, which is precisely what a playmat is.

A theme-tuned veil always sits between the playmat and the content. It is **not optional and not user-adjustable**: card artwork has no controlled range of brightness — a bright Plains and a black Swamp need opposite treatments — so a fixed per-theme veil is what makes arbitrary artwork safe. Data tables, forms, the toolbar and the sidebar stay fully opaque so dense text is never laid over artwork.

On phones the playmat is off by default, since it costs bandwidth and paint time for something almost entirely hidden behind a full-width grid; it can be switched on explicitly. A reduced-data preference suppresses it.

**Blocked by:** 21, 10

**Status:** ready-for-agent

- [ ] Any card can be searched and set as a playmat, and it persists across devices
- [ ] The playmat shows through the gaps in a card grid
- [ ] Text remains legible on every theme with both a very bright and a very dark artwork
- [ ] Tables and forms are fully opaque over the playmat
- [ ] The playmat can be removed, returning to a plain background
- [ ] It does not load by default on a phone, and is suppressed under a reduced-data preference
- [ ] No image flash occurs on page load
