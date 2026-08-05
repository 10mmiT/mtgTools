# 04 — Picking a card up

**What to build:** pointing at a card picks it up. It lifts and scales, tilts a few degrees towards
the pointer, and a soft sheen sweeps its face as though light were catching a laminated surface. It
draws above its neighbours instead of pushing them aside.

The critical constraint is that the element's layout box never changes size. The card grows only as
a visual transform, so the pointer cannot fall off a card that grew underneath it, the grid never
reflows, and the card settles back the instant the pointer leaves — crossing a grid quickly leaves no
trail of half-animated cards.

The switch from ticket 01 turns all of it off, and the guard from ticket 02 turns it off for anyone
whose operating system asked. With motion off a card still shows that it is interactive; it simply
does not move.

From `spec-cards-as-objects.md` → Implementation Decisions, "Tilt is bounded and pointer-derived" and
"The sheen is a gradient overlay". This is `ui.md` §1 delivered.

**Blocked by:** 01 — The card-motion preference; 03 — Cards stop being tiles.

**Status:** done

- [x] Pointing at a card lifts, scales and tilts it towards the pointer, with a sheen crossing its face
- [x] The card's layout box does not change size, and the pointer never loses the card it is over
- [x] The lifted card draws above its neighbours and the grid does not reflow
- [x] Pointing away settles the card immediately
- [x] Tilt is bounded to a few degrees, is zero at the card's centre, and derives from the pointer's position within the card's own box
- [x] With card motion off, no lift, scale, tilt or sheen occurs, and the card still reads as interactive
- [x] With the operating system's reduced-motion setting on, the same, whatever the preference says
- [x] The sheen's exemption comment names the colour rule and states that it sits over card artwork
- [x] The tilt angle is a pure function of pointer position and box, asserted through the vm seam at the extremes and at the centre
- [x] Correct in all five themes, and no hover state sticks on after a touch
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

**Built as:** one pointer listener on the document, in a new `js/cardlift.js`,
written against `.card-img` — so it belongs to every card image in the app and
to any added later, rather than to six tabs' markup. It marks the card the
pointer is on and, if cards may move, the image and the element it hangs in.
The image takes the transform; the wrapper takes a stacking context and draws
the sheen as its `::after`, so picking a card up puts nothing into the page.

The layout box is untouched because the whole lift is one transform — the rise
and the scale from tokens, the lean from `cardTilt()`. The lean is measured
against the card's *laid-out* box (`offsetLeft`/`offsetWidth`), never
`getBoundingClientRect()`: a lean computed from an already-leaning box feeds
back on itself, and the card drifts under a pointer that has stopped moving.

The wrapper is only positioned where it is not positioned already. The card
detail's image column is `sticky`, and a `relative` one does not stick.

The switch divides the treatment rather than switching it off: `.card-held` is
the card being reached for and takes the deeper shadow, which is a state and
not a movement, so it survives "Cards move" being unticked. That mark is made
from the pointer handler rather than by `:hover`, which is what keeps it off a
touchscreen — a hover state there outlives the finger that caused it, and CSS
cannot be asked which kind of pointer is on the card. A touch pointer never
lifts anything.

The three-pixel nudge came off the four tiles that did it — the two grids, the
printings list and the pile — since the card itself is what is picked up now.
The pile keeps its `z-index` on hover: those cards overlap by design, so the
one being pointed at has to come out in front of the cards after it too, which
a stacking context inside it cannot do.

Verified in the real app on Collections' grid, the Deck Builder's pile, the
Scryfall XL grid and the card detail: the lean holds within ±6° and reverses
across the card, every other card stays exactly where it was, and the wrapper
is left as it was found. With `ui.prefersReducedMotion` on, a card is held and
does not move, whatever the preference says; a synthetic tap leaves nothing
marked, during or after. All 110 captured screens are byte-identical to the
previous ticket's — a screen at rest is what it was, which is the point.
