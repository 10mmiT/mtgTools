# 22 — Playmat from Scryfall card art

**What to build:** The app becomes personal. Pick any Magic card and its artwork becomes the background you play on.

Because the panel boxes are gone by this point, the playmat is what card grids sit on — visible through the gaps between cards. Cards on a table.

Artwork is fetched through the **existing** card proxy and image cache; no new external requests. The card picker reuses the existing want-list autocomplete. The **art crop** is used rather than the full card image, because it is the artwork without frame or text box, which is precisely what a playmat is.

A theme-tuned veil always sits between the playmat and the content. It is **not optional and not user-adjustable**: card artwork has no controlled range of brightness — a bright Plains and a black Swamp need opposite treatments — so a fixed per-theme veil is what makes arbitrary artwork safe. Data tables, forms, the toolbar and the sidebar stay fully opaque so dense text is never laid over artwork.

On phones the playmat is off by default, since it costs bandwidth and paint time for something almost entirely hidden behind a full-width grid; it can be switched on explicitly. A reduced-data preference suppresses it.

**Blocked by:** 21, 10

**Status:** done

- [x] Any card can be searched and set as a playmat, and it persists across devices
- [x] The playmat shows through the gaps in a card grid
- [x] Text remains legible on every theme with both a very bright and a very dark artwork
- [x] Tables and forms are fully opaque over the playmat
- [x] The playmat can be removed, returning to a plain background
- [x] It does not load by default on a phone, and is suppressed under a reduced-data preference
- [x] No image flash occurs on page load

**How it landed**

- [playmat.js](public/js/playmat.js) is the one script loaded in `<head>` rather than at the
  foot of the body. That is the whole answer to the flash: a background applied after first
  paint is a background the user watches appear, and the preference that decides it is a fetch
  away. Boot paints from `localStorage`, `syncPlaymat()` corrects it from the server once there
  is a session — the two halves `initTheme`/`syncPrefs` already split the theme into.
- Two fixed layers at the top of [layout.css](public/css/layout.css): the art at `z-index: -2`
  and the veil at `-1`, both pseudo-elements of the body, both switched by one `data-playmat`
  attribute. The spec's second variable holding a `display` value would not have worked — a
  variable set inline on `<html>` beats any stylesheet rule, so the mobile and reduced-data
  defaults could not have been media queries without an `!important` the token contract bans.
- The mobile default is `display: none`, not a script guard, because that is what stops the
  browser fetching the image at all. Its opt-in (`mtgtools_playmat_mobile`) is the one
  appearance preference kept per browser: it is about this device's data plan, not about taste.
- **The veil's alpha is now measured, not chosen.** [check-contrast.js](scripts/check-contrast.js)
  composites `--scrim` over white and over black — no artwork is outside those — and holds
  `--text` and `--text-muted` to their floors against both, in `npm test`. The repaint's `.82`
  and `.84` failed it; every theme now carries the lowest alpha that passes (`.86` dark and
  dusk, `.90` contrast, `.92` light and sepia), since anything above that is artwork nobody
  can see. `--text-subtle` is excluded because all four of its uses sit inside opaque fills;
  `--border` is excluded for a reason worth reading in the comment there — on the light themes
  the veiled backdrop passes straight through the hairline's own lightness, and no alpha below
  `.99` recovers its floor.
- The Appearance popover (§10.7) moved to body level and is positioned against whichever button
  opened it. The sidebar's theme button and the phone's theme-cycling button are both
  "Appearance" now, opening the same menu — the phone had no way to reach a picker before, and
  no way to name the theme it was cycling to.
- `playmat_ref` holds the card's **name**, not the Scryfall id the schema comment names: a name
  is what identifies a card everywhere else here, and it is what the popover prints back.
- The Want List's autocomplete became `mountCardAutocomplete()` in
  [sortui.js](public/js/sortui.js), beside the other `mount*` components. Reusing it, as the
  ticket asks, meant extracting it — and the shared version builds its rows as elements, so a
  card with an apostrophe no longer needs escaping to survive an `onclick`.
- Tests: [test/playmat.test.js](test/playmat.test.js) runs the shipped boot script against stub
  globals (the URL guard, the storage mirror, the per-device switch) and asserts the properties
  that live in the stylesheet — that the two layers are only ever switched together, that the
  phone rule is `display: none`, and that reduced-data comes last. No endpoint tests: this
  issue adds no endpoints, and issue 21's cover the ones it writes through.

**Verified in a browser**, driving the real app through the screenshot harness's plumbing:
setting a card through the picker paints it and survives a reload; the mat shows through the
gutters of the Set Browser's tiles and the search results' rows while their own surfaces stay
opaque; a phone shows `display: none` by default and `scroll` attachment once opted in;
Remove returns the plain background. No console errors.
