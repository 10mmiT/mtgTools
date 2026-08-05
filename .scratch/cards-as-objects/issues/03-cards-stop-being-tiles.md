# 03 — Cards stop being tiles

**What to build:** a card at rest reads as an object lying on a surface rather than a picture in a
box. The app currently draws a filled, hairlined tile around artwork that already carries the card's
own black rounded frame, casts the card's shadow from that tile's rectangle, and clips the artwork's
corners to the tile's radius.

The frame comes off. The shadow is cast by the card's own silhouette instead of a rectangle, so it
hugs the rounded corners and reads as thickness, while still falling from the same light as every
other shadow in the app. A hairline of light along the top edge and a darker one along the bottom
give the card a lit edge. Corners match a real card's corner at the size it is drawn.

This lands once, on the shared card-image classes, so Collections, Scryfall Search, the Set Browser,
Want Lists, Pick Night and the Deck Builder all inherit it — a card is one kind of thing wherever you
meet it. No motion is added here; this ticket is materials only.

From `spec-cards-as-objects.md` → Implementation Decisions, "The card is the element; the tile is
deleted around it" and "Shadows on cards are drawn with `filter: drop-shadow()`".

**Blocked by:** 02 — Reduced motion becomes part of the token contract. Any transition this ticket
touches must be written already guarded.

**Status:** done

- [x] A card image on every tab that shows one is drawn with no fill and no hairline framing the artwork
- [x] A card's shadow follows its rounded silhouette, not a rectangle, and falls from the same light as the app's other shadows
- [x] A card carries a lit top edge and a shaded bottom edge, correct in all five themes — a light theme does not get a dark theme's lighting
- [x] Card corners match a real card's corner at the sizes cards are drawn here
- [x] A card whose image is missing or has failed to load still shows a placeholder with a hairline: a placeholder is a surface, not a card
- [x] Every piece of card metadata legible today is still legible
- [x] Any exemption introduced names the rule it escapes and the reason
- [x] `npm run measure:mobile` stays at 0 undersized targets
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:layout` are green
- [x] Screens captured across five themes and two viewports, before and after, and reviewed

**Built as:** one class, `.card-img`, worn by every `<img>` of card artwork in
the app — 16 of them across nine files — with the treatment stated once in
components.css. The tiles came off around all of them: the two grids, the
printings list, the pile, the list thumbnails, the card tooltip and the deck
builder's hover preview, four of which were also casting a rectangle's shadow.

The lit and shaded edges are *borders*, not a second drop-shadow. Painting them
outside the silhouette would have put them on the page, where a white hairline
is invisible on a light theme and a black one on a dark theme; inside, they read
against the card's own frame in all five. An inset `box-shadow` cannot do it —
on a replaced element it is painted under the image and never shows.

Two tokens rather than an exemption: `--radius-card: 4.75% / 3.5%` is a physical
card's corner as a ratio, which joins the radius scale and *retires* the inline
exemption `.card-detail-img` was carrying for exactly that value; and
`--card-cast` / `--card-lit` / `--card-shade` per palette, with the drop-shadow
geometry stated once. The linter needed no new rule and granted no new escape —
`filter` is the property the elevation rule does not govern, which is why a card
may carry both an edge and a shadow.

Verified: of the 110 captured screens, five differ — the Collections grid on the
phone, the only default view in the set that draws card artwork. The card detail
was captured separately (`--tabs 'card=Sol Ring'`) in five themes and two
viewports. The harness has no route to the grid, XL and pile views (they are
click state, not URL state), so those were reviewed on a page built from the
renderers' own markup against the real stylesheets, screenshotted in all five
themes. `measure:mobile` caught one real bug on the way: a list thumbnail whose
artwork fails to load was a 0-height touch target, and is now 58×81 regardless.
