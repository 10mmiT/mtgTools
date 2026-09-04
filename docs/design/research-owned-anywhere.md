# Research — do we own this, everywhere

**Built.** The edge bar shipped across every grid in the app; what follows is
the assessment it was cut from, kept because the reasoning is still the reasoning.
Where it differs from what happened:

- The wrapper does **not** wrap unconditionally. `cardArtHtml()` wraps a card
  when *something sits on it* — a back to turn to, or a mark — so a one-sided
  card nobody owns is still handed back exactly as the tile drew it, and the
  tests asserting that stayed green.
- The name fallback goes **both ways**. This document only anticipated the long
  name being asked of a shelf holding the short one; the common case is the
  opposite — EDHREC asks "Delver of Secrets" of an Archidekt export holding
  "Delver of Secrets // Insectile Aberration" — which needs an index of the
  shelf and not a string split.
- The list rows were left alone. The bar lives on card *art*, and a 58px
  thumbnail in a table row is an index rather than a card — the same rule
  `js/cardturn.js` already states for the turn control. Those rows keep the
  text badges, which have room to say more.

`test/cardowned.test.js` is the ticket's, `docs/design/proto-owned-flag.html`
is where the three shapes were compared, and the sections below are unchanged.

---

This is an assessment of what it would take
to answer "is this card on one of our shelves" at every place the app draws a
card — in particular the Search / EDHREC drawer, which is the one card grid in
the app that says nothing about ownership at all.

The prompt was Archidekt's corner strip on a card image. The finding is that we
do not need to copy it, because we already own every piece of it except the
mark itself: the data is in the browser, the scoping question has been answered
once already, and there is a single wrapper that nine of the app's ten card
renders pass through.

The constraints are `ui.md`'s: no framework, no build step, no new network call
if one can be avoided, colour only from `tokens.css`, and every duration through
a motion token. `scripts/lint-tokens.js` enforces the last two.

## What the app already knows

**Ownership is a local Map lookup, not a request.** `/api/state` ships every
collection's `cards_json` whole ([routes/state.js:197](routes/state.js#L197))
and `hydrateState` turns each into a `Map` of name → `{ qty }`
([public/js/state.js:111](public/js/state.js#L111)). Every collection is in the
browser from boot, on every tab, whether or not Collections has been opened. So
a corner mark on two hundred and forty EDHREC recommendations costs two hundred
and forty `Map.get` calls and no round trip.

**The question has two answers already, and they disagree on purpose.**

| | who it counts | where it is drawn |
|---|---|---|
| `sfCardOwnership(name)` [scryfall.js:202](public/js/scryfall.js#L202) | every loaded collection | Scryfall search, Set Browser, Want lists |
| `dbCardOwnership(name)` [deckview-owned.js:220](public/js/deckview-owned.js#L220) | the shelf in scope, else who *else* has it | the Deck Builder mat |

The second is the better answer and the newer one. It knows about the three
scopes — Mine, The group's, Everyone's
([deckview-owned.js:40](public/js/deckview-owned.js#L40)) — and when the shelf
in scope has none of a card it names whoever does, dimmed. That is exactly the
"personal and group" distinction this feature asks for. It is already built,
already tested (`test/deckowned.test.js`), and already stored per person rather
than per browser.

Its only problem is where it lives: `dbOwnShelf()` is a Deck Builder module's,
and the scope is stored under `mtgtools_db_own_scope:<playerId>` as that tab's
preference.

## Where it is drawn today, and where it is not

Ten places draw card artwork. Six say something about ownership; four say
nothing.

| render site | ownership today |
|---|---|
| Collections grid + table | implicit — everything there is owned |
| Scryfall search, small + large [search.js:134](public/js/search.js#L134) | text badges |
| Set Browser [sets.js:285](public/js/sets.js#L285) | text badges |
| Want lists [wants.js:298](public/js/wants.js#L298) | text badges |
| Deck Builder mat [deckview-render.js:730](public/js/deckview-render.js#L730) | scoped badges + the Missing/Owned/Borrowable chip |
| **Search / EDHREC drawer** [deckview-panels.js:198](public/js/deckview-panels.js#L198) | **nothing** |
| **Card Detail tab** [card.js:193](public/js/card.js#L193) | **nothing** |
| **Alt-art printings row** [card.js:369](public/js/card.js#L369) | **nothing** |
| **Hover preview** [main.js:578](public/js/main.js#L578) | **nothing** |

The drawer tile carries a price and a want button on the Search half, a synergy
percentage and a deck count on the EDHREC half
([deckview-panels.js:378](public/js/deckview-panels.js#L378) and
[:605](public/js/deckview-panels.js#L605)), and on both halves a quiet chip
saying which board of *this deck* already holds it. It knows everything about
the card except whether it is in a box in the room.

So the request is precise and it is correct: the place where you are choosing
what to add is the one place the app forgot to answer.

## The mark

Archidekt puts a coloured strip in the corner of the card image. What we should
take from that is the *position* — on the art, not under it — and nothing else,
because a strip has one dimension and the answer we have has two: whether the
shelf in scope holds it, and whether anybody else does. The mat already says
both, in words. The mark is the same sentence made small enough to survive at
118 pixels.

**Three states, and one of them is nothing.**

| state | mark | means |
|---|---|---|
| on your shelf | solid mark, `--success` | you can sleeve it tonight |
| only somebody else's | broken mark, the holder's player colour | you would have to ask |
| nobody's | *no mark* | |

The second state is the *same shape* as the first with its fill interrupted,
rather than a second colour to be learnt. Colour says *whose*; fill says
*whether you have to ask*.

Absence carrying the third state is deliberate. A grid of Scryfall results is
mostly cards nobody owns, and a marker on every one of them is a grid of
markers. The existing text badges already work this way — `.sf-not-owned` says
"Not in any collection" only where there is a row with room for it, and prints
an em dash on the grid tile.

**Quantity goes on the title, not on the face.** `×3` is legible on the mat's
big tiles and illegible in the drawer. The flag's `title` can carry the whole
sentence the mat's badges spell out — "Tim's binder ×3" — for free.

**Where it goes: the top-left edge — and it should be a bar, not a corner.**
Two corners of a card image are already taken: bottom-left is the turn control
([components.css:678](public/css/components.css#L678)) and top-right is the
drawer's `+` ([tabs.css:2349](public/css/tabs.css#L2349)), which leaves the top
left. Three shapes were drawn there and photographed on real cards —
`proto-owned-flag.html` beside this document, which links the app's own
stylesheets so the pictures are the app's:

| | verdict |
|---|---|
| **wedge** — a filled triangle in the corner, nearest to Archidekt | loudest, and the only one legible across a room. But it sits *on the card's printed title*, and its hollow variant reads as a rendering fault |
| **pip** — a 20px scrimmed circle, `.card-turn`'s twin at the opposite corner | most native to the app, and the only one that can carry a glyph. Covers even more of the title, and the holder's initial is unreadable at 118px |
| **edge bar** — a 6px strip along the top edge, solid for yours and dashed for somebody else's | **the one to build** |

The bar wins on a fact none of this was designed around: **a Magic card has a
black border, and the bar fits inside it.** It covers no artwork, no title and
no mana cost — at any tile size, on any card. In a grid it reads as a row of
marks rather than a row of badges, which is exactly the register this wants: a
grid of Scryfall results should not look like it has been annotated. And the
dashed variant is unmistakably the same object with its fill interrupted, so
the two states survive being seen out of the corner of the eye.

That was not the expected answer. The wedge is the better *mockup* and the bar
is the better *feature*, and the difference only appeared once it was drawn on
a real card at the real size.

**Colour must come from tokens.** `--success` / `--success-soft` and the eight
`--player-N` slots all exist and are defined in all five themes; the lint
refuses anything else. Note that the "somebody else has it" state wants the
*holder's* colour, which is already `playerColor(player)` returning a `var()`
reference rather than a hex ([state.js:42](public/js/state.js#L42)) — so a
theme switch repaints it, which a stored hex would not.

## How to build it — and the seam that already exists

The obvious shape is a helper called at each render site, the way
`wantBtnHtml()` ([auth.js:169](public/js/auth.js#L169)) and `renderPrice()`
are. The obstacle is that a corner mark needs a positioning context, and the
grid tiles do not have one: `.sf-thumb` and the `<a class="card-open">` around
`.sf-card-lg-img` are unpositioned ([tabs.css:514](public/css/tabs.css#L514),
[tabs.css:569](public/css/tabs.css#L569)). Adding `position: relative` to five
wrappers across three stylesheets is how this feature becomes a diff nobody can
review.

**But the positioning context is already there, for a different reason.**
`cardTurnableHtml(picture, back)`
([cardturn.js:83](public/js/cardturn.js#L83)) wraps a card picture in
`.card-turnable { position: relative }` so the turn control has something to
hang in — and it is called from nine sites, which is every card render in the
app except the drawer tile and the hover preview:

```
card.js:193   cardstack.js:279   collections.js:1265
deckview-render.js:782, :859     search.js:166
sets.js:317   wants.js:381
```

It wraps *conditionally* — `if (!turn) return picture` — because a one-sided
card has nothing to turn. Make it wrap unconditionally and take overlays, and
one edit gives every card in the app a corner to put things in:

```js
cardArtHtml(picture, { back, name })   // ← .card-turnable, always
```

That is a rename and a widened contract, not a new abstraction, and it pays for
itself twice: the drawer tile's hand-rolled `.db-find-art { position: relative }`
([tabs.css:2344](public/css/tabs.css#L2344)) becomes the same wrapper as
everything else, and the next thing anyone wants to put on a card face has a
place to go.

The alternative — a delegated decorator in the shape of `cardlift.js`, walking
`img.card-img` and marking each image's parent by its `alt` text — was
considered and is worse here. It would cover the hover preview and any future
grid for free, but it makes the card's *name* an attribute scraped off the DOM,
needs a `MutationObserver` to survive re-renders, and has to coexist with
`cardlift.js`'s `.card-lift-host` and `cardmove.js`'s measured re-renders on the
same elements. `cardlift.js` is delegated because a lift is a *pointer* fact
that no render site knows. Ownership is not: every one of those nine sites has
the card's name in hand at the moment it writes the tile.

## The part that is actually a decision

Everything above is mechanical. This is not:

**Whose shelf does a mark on a Scryfall search result count?**

The Deck Builder's answer is a control on the deck's strip, remembered per
person. Search, Set Browser and Want lists have no such control and currently
count every loaded collection — which means today, on two adjacent surfaces,
the same card can wear a badge that means "somebody owns this" and one that
means "*you* own this".

Two ways out:

1. **Lift the ladder.** Move `DB_OWN_SCOPES` / `dbOwnShelf()` / `dbOwnScope()`
   out of `deckview-owned.js` into a shared module — `js/owned.js`, loaded
   before the tabs — and let one preference answer for the whole app. The deck
   strip keeps being the control that sets it; every other tab inherits it.
   The storage key stays per-player, which it already is and for the right
   reason (two people share a browser in open mode).

2. **Say both facts at once and never ask.** The flag is filled for *your*
   shelf and outlined for anyone else's, so the scope stops being a question
   the grid has to be told the answer to. Only the Deck Builder — where "87 of
   99" is a *count* and a count has to be of something — keeps the selector.

**Recommend both, in that order.** (2) is what the mark should say regardless;
(1) is what stops the deck strip's setting from being contradicted by the
drawer two inches away from it, and it is a move-and-rename rather than new
logic. Doing (1) first also means `test/deckowned.test.js` keeps passing
against the same functions in a new file, which is a cheap way to know the lift
was faithful.

## What it would cost

| | |
|---|---|
| new module `public/js/owned.js` | ~90 lines, most of it moved from `deckview-owned.js` |
| `cardturn.js` → always wrap, take overlays | ~15 lines changed, 9 call sites touched |
| CSS — the flag, three states, five themes | ~30 lines in `components.css` |
| drawer tile adopts the shared wrapper | ~10 lines in `deckview-panels.js` |
| `test/cardowned.test.js` | in the shape of `test/deckowned.test.js` — the states, the name matching, the not-yet-loaded case |

No server change. No new endpoint. No extra request. Nothing on the critical
path of a render that is not already there.

## Four ways this quietly goes wrong

**Names, not printings.** A collection is card names and quantities — the
importer drops the edition, which is the whole reason `set-index.js` exists
([architecture.md](../architecture.md)). So the flag answers "we have *a* copy
of this card", never "we have this printing". On the Card Detail tab's alt-art
printings row that distinction is the entire point of the row, so either every
printing wears the same flag (honest, and says so in the title) or that row is
left out of the first pass. Leave it out.

**Two-faced cards.** `sfCardOwnership` does an exact-name lookup. Collections
store whatever the importer wrote; EDHREC's `cardviews` and Scryfall's
`card_faces[0].name` do not always agree with it. The drawer already works
around this by caching card data under both names
([deckview-panels.js:274](public/js/deckview-panels.js#L274)); the ownership
lookup needs the same fallback — full name, then front-face name — in one place
rather than at nine call sites.

**A collection that has not loaded is not an empty collection.** Both existing
helpers filter to `status === 'loaded'` and the comment at
[deckview-owned.js:79](public/js/deckview-owned.js#L79) says why: a flag that
appears card-by-card while pages arrive is worse than one that appears once.
Any new code inherits that rule or it will show "nobody owns this" during a
refresh.

**Copies are the deck's question, not the grid's.** Eight Forests in a deck
against four on the shelf is `dbShortOf()`'s answer and it needs a deck to be
asked about. A search result can only say "we have some". Do not let the flag
imply otherwise — it is why the quantity belongs in the title and the mark
stays binary.

## The other reading of "anywhere"

If "anywhere" means edhrec.com itself, or Moxfield, or Scryfall in a browser
tab, that is a different piece of software: a userscript or browser extension,
plus a CORS-enabled `GET /api/owned?names=…` returning
`{ name: { mine, group } }`, plus an auth story for a caller that is not the
app's own session, plus a DOM scraper per site that breaks whenever those sites
ship. It is buildable — the endpoint is twenty lines over the same Maps — but
it is a maintenance commitment against three third parties who owe us nothing.

It is also probably unnecessary for the stated case. The most important place
named in the request, EDHREC recommendations, is *already inside the app*
([routes/proxy.js:39](routes/proxy.js#L39) proxies
`json.edhrec.com/pages/commanders/<slug>.json` and the drawer draws all 240 of
them). The in-app version of this feature covers it. Build that, use it for a
few weeks, and see whether the browser still gets opened.

## Suggested order

1. Lift the scope ladder into `js/owned.js`; `deckowned` tests stay green.
2. `cardTurnableHtml` → `cardArtHtml`, always wrapping, accepting overlays.
3. The flag: CSS, the two states, the title, the name fallback. Ship it on the
   Search / EDHREC drawer only.
4. Roll it across the other eight sites, which by then is one argument each.
5. Card Detail tab. Printings row deliberately excluded, and a note saying why.
