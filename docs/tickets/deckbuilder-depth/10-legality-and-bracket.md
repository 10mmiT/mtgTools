# 10 — Legality, and the bracket the deck is

**What to build:** the deck says whether it is actually legal, and roughly how strong it is.

**Legality** is table stakes and we have none of it. The readout gains a line for the deck's format:
legal, or the specific reason it is not — the wrong number of cards, a card outside the commander's
colour identity, a banned card, too many copies of something. Colour identity is the one that
actually bites Commander players and is the one we can already compute.

**The bracket** is the interesting half. Wizards' five-bracket system is defined largely by the Game
Changers list, with tutors, extra turns, mass land denial and two-card infinite combos as the other
inputs. Count the Game Changers in the deck, flag what can be flagged from oracle text, and place
the deck in a bracket **with the reasoning shown**.

The deck record already carries a bracket field. It is written, round-tripped and permission-checked
— and nothing has ever read or set it. That field is where the player's **declared** bracket goes,
and the estimate is shown beside it rather than instead of it. **This is an estimate and must never
read as a verdict**: Wizards' own system is a self-assessment, and a tool that tells someone their
deck is bracket 4 without saying why is picking a fight it cannot finish.

Then the payoff that only this app can have: the declared bracket becomes a **chip on the deck tile**
where the decks live, and **Pick Night can narrow its pool by bracket** — so "tonight is a bracket 2
night" becomes something the app can arrange rather than something four people negotiate.

From `spec-deckbuilder-depth.md` → proposal 3. Note that proposal 9's combo service offers a proper
bracket classification later; this ticket's heuristic is meant to be replaced by it, not defended.

**Blocked by:** 01 — The card cache learns three new facts.

**Status:** done

- [x] The readout says whether the deck is legal for its format
- [x] An illegal deck says which rule it breaks, naming the offending card where there is one
- [x] A card outside the commander's colour identity is caught
- [x] The estimated bracket is shown with the reasons that produced it
- [x] The player can declare a bracket, and it is stored on the field that already exists
- [x] Declared and estimated are visibly different things, and the estimate never overwrites the declaration
- [x] The deck tile carries the declared bracket
- [x] Pick Night can restrict its pool by bracket, and says so when the restriction empties the pool
- [x] A deck with no commander is judged against its own format rather than against Commander
- [x] A deck whose cards predate the current cache refresh does not report a false legality result
- [x] Works in all five themes and at every breakpoint
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

## What was built

`js/deckview-legality.js`, and two figures on the readout that open one panel
between them. One walk over the deck answers both questions, memoised in
`_dbCheck` and dropped by `dbCheckChanged()` beside `dbTotalsChanged()` — so the
readout, the panel and the estimate's reasoning cost one pass, twenty
`dbRender()`s cost none, and the promise ticket 09 made about the mat's
animation is the same promise here.

### Two questions with opposite obligations

**Legality has one right answer**, so the whole of the care is in never claiming
it. A card whose facts have not arrived, and a row still in the pre-ticket-01
shape whose `legalities` is the empty object `getCard()` fills in, are both
*unchecked*: counted towards the deck's size, judged for nothing, and named in
the panel. The line reads "Commander legal" in `--success` only when everything
was checked; with anything unchecked it says "legal so far · 3 unchecked" in the
plain colour. An unchecked card is never reported as banned, never as outside an
identity, and never green-ticked.

**The bracket has no right answer at all.** It is a floor rather than a
placement — four Game Changers make a deck Optimized, one makes it at least
Upgraded, an extra turn or mass land denial does the same, and a deck with none
of those is a 2 that says a 1 looks identical in a card list. Every signal
produces a reason *whether it was found or not*, because "no mass land denial"
is as much of why the answer is 2 as three Game Changers are of why it is 3; a
list of only the hits reads as an accusation rather than as reasoning. Tutors
are counted and shown and deliberately not weighed — Wizards publish no
threshold, so one here would be ours worn as theirs. The two things it cannot
see are printed under it every time: two-card infinite combos, which nothing in
a card's text can reveal, and bracket 5, which is a declaration about how a deck
is played.

The estimate is held nowhere. There is no moment at which it could overwrite the
declaration, because nothing writes `bracket` on the deck record except
`dbDeclareBracket()`, and that reads a select.

### What the deck is judged as, and why there is no format field

The deck record carries no format and this ticket does not add one. What it has
is a commander, and that is the same inference the readout has always made to
decide between 60 and 99 — so the inference moved into `dbDeckFormat()` and
`dbRenderStats()` now reads `dbDeckTarget()` rather than working the number out a
second time. Two answers to "how big should this deck be" is the one
disagreement a readout cannot survive.

That makes "its own format" two formats, not Magic's twenty: **Commander**, held
to a hundred commanders-included, singleton, colour identity and Scryfall's
`legalities.commander`; and **60-card**, held to sixty and four copies and
nothing else. A deck with no commander has not said which ban list it wants, so
none is consulted and the panel says so out loud — an absent check reading as a
passed one is the same failure as a green tick over an unknown card.

Two exceptions to the copy limit are read off the cards rather than kept as
lists: a basic land by its type line, and Relentless Rats and its cousins by
"A deck can have any number of cards named…" in their own rules text. Neither
goes stale the next time Wizards print another one.

### The declaration, and where it is read

The select is in the panel beside the estimate, guarded by `isMyPlayer()`, and it
writes the field that has been round-tripped and permission-checked since long
before anything set it. Everything else was already reading it: the chip on the
deck tile in Players & Decks and the one on tonight's picks are both
`dbBracketBadgeHtml()` now — one function, so "Bracket 3" carries what a 3 *is*
on its tooltip. A number that is not one of the five keeps its chip: Archidekt's
importer has been filling this field from `powerLevel` since before brackets
existed, and dropping a 7 would lose something somebody said about their own
deck.

**Pick Night** gained bracket chips at the head of the pool drawer, and a deck
barred by them is marked where it was chosen rather than only being absent from
a smaller number. A deck nobody has declared is in *no* bracket, which is the
honest reading and the case the strip has to explain — so the status line
distinguishes "no decks in pool" from "no deck in the pool is bracket 1 — 63
chosen, none of them declared as that", and names the restriction even when it
costs nothing.

### The frame

The two figures sit on the readout between the card count and the price, and
both open `#dbCheckPanel`, which rises out of the same line as the missing list
and closes it (and is closed by it) because they would otherwise lie on top of
each other. Below 900px the bracket figure leaves the line — two facts side by
side is the widest thing on a readout that already wraps at 390 — and nothing is
lost, because the legality figure beside it opens the same panel and the panel
is where the reasoning and the declaration live in any case.

A finding is marked by a glyph as well as by colour. `scripts/measure-mobile.js`
gained a `deckview-legality` view for the same reason ticket 09 added
`deckview-analysis`: the panel is closed when the tab arrives, so without it the
✕ and the bracket select would have passed the 44px measurement by not being on
screen.

### One thing this ticket was holding up

`js/cardquery.js` parked `is:gamechanger` on this work by name — "it is one line
when its own ticket lands". It is two: `cardMetaOf()` carries `gameChanger` now,
and `CQ_IS` reads it. Both search boxes gained it, which is the useful half —
with a bracket on the readout, "which of these are Game Changers" is a question
somebody actually has, of a shelf and of a deck, and it is asked of the same
cached field the estimate counts. A card cached before the shape carried the
list is honestly not one, which is what `false` says and what
`scryfall-db.js` fills in.

### What was measured

`npm test` (667, `fail 0`), `npm run lint:tokens`, `npm run check:contrast` and
`npm run measure:mobile` — nineteen views, no sideways scroll, every target at
least 44×44. Beyond what those can answer, driven in headless Firefox against
the live-data snapshot:

- a real 117-card deck reads as **2 problems** — seventeen over the hundred, and
  twenty-one copies of one card — with the card named and openable from the panel
- its estimate is 3, off one Game Changer, with two tutors listed and not scored
- declaring 3 lands on the record and the deck tile's chip a tab over reads
  "Bracket 3 / Upgraded — Stronger than a precon, up to three Game Changers"
- restricting Pick Night to bracket 1 over a 63-deck pool empties it, and the
  strip says which restriction did it and how many decks have no bracket at all
- at 390px the bracket figure is `display: none`, the panel still carries it, the
  declare select measures 158×44, and the page does not scroll sideways
- all five themes draw the panel's marks and ground from their own tokens —
  five distinct pairs, no hex anywhere in the module
