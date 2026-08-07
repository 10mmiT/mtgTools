# Piles land expanded — what was done

A record of the one ticket in `docs/tickets/piles-expanded/`, written after delivery. It supersedes
that ticket and stands beside `docs/records/cards-as-objects.md`, which built the piles this changes
the default of. Where this document and the ticket disagree, this one is what happened.

---

## The change

> A table of stacks arrives with every pile already spread. Settling a pile is the thing you do.

Three views draw a table of piles — the Deck Builder's categories, Collections' stack view and the
Set Browser's — and all three arrived tidy: every pile a settled stack, every card hidden, one arrow
at a time to see anything. A view of cards that shows none of them until it is operated is a view
that has to be operated before it says anything, so the default is now the other way.

**The set is inverted rather than seeded.** Each tab kept a set of the labels that were *spread*,
and each started empty. Seeding those sets with every label on each render would have fought the
model: a pile you settled would spring back open the moment a quantity edit re-rendered the table,
and a pile that appeared because the sort changed would have to be seeded too or arrive settled. So
each tab now tracks the labels it has been asked to **settle**, and absence means spread. All three
behaviours fall out of that rather than being arranged: a new pile is open because nothing has
settled it, a settled pile stays settled because the set is not rebuilt, and `togglePile` kept the
shape it had.

| was | is |
|---|---|
| `dbExpandedCats` | `dbSettledCats` |
| `_colFannedPiles` | `_colSettledPiles` |
| `setFanned` | `setSettled` |
| `settleGonePiles(spread, groups)` | `forgetGonePiles(settled, groups)` |
| `cardPilesHtml(groups, { fanned })` | `cardPilesHtml(groups, { settled })` |

Nothing is persisted, exactly as nothing was before: a reload gives you the table fully spread again.
`STACK_FAN_MAX` is unchanged at 60, and still bounds each fan.

**A label that goes away is forgotten**, so a label that comes back for different cards comes back
spread. On the two browsing tabs that is `forgetGonePiles` against the piles the sort just cut, which
is where `settleGonePiles` already ran. The Deck Builder now calls it too, against `dbCats` rather
than against the sections actually drawn — a category the search has emptied is still a category of
that deck, and clearing the search should find it lying the way it was left rather than sprung open.

---

## What the numbers say

Every figure is from a run on the finished branch, in headless Firefox at 1440×900 against a snapshot
of the live database: six collections merging to **12,788 cards**. Collections' stack view, in every
grouping the tab offers, five renders each, fastest and slowest kept.

`build` is `renderResults()` returning — the markup built and in the document. `layout` is the
browser laying it out, forced by reading a geometry property. First paint is both.

| grouping | piles | cards drawn | elements | build (ms) | layout (ms) | first paint |
|---|---|---|---|---|---|---|
| **name** | 28 | **1,507** | **4,690** | 64–76 | 54–63 | **118–139ms** |
| qty | 40 | 855 | 2,806 | 49–87 | 31–42 | 80–129ms |
| toughness | 18 | 635 | 2,014 | 59–69 | 21–23 | 80–92ms |
| power | 18 | 621 | 1,972 | 59–83 | 20–23 | 79–106ms |
| cmc | 8 | 480 | 1,489 | 53–63 | 16–20 | 69–83ms |
| type | 9 | 435 | 1,360 | 115–149 | 14–16 | **129–165ms** |
| color | 7 | 420 | 1,303 | 111–135 | 15–19 | 126–154ms |
| price | 5 | 300 | 931 | 44–73 | 10–12 | 54–85ms |
| rarity | 5 | 246 | 769 | 52–64 | 8–11 | 60–75ms |

**The worst grouping is by name** — the initial, which is what a shelf of binders does and what the
tab is sorted by when it arrives. 28 piles, 60 cards each, **1,507 card elements against the 27 that
were there before**, and a page 12,000px tall. The ticket's estimate was "on the order of 1,600 card
elements where there were 27", which is what it turned out to be.

**The worst first paint is not the worst table.** Grouping by type or by colour costs 115–149ms
before a single pile is drawn, because bucketing 12,788 cards by type line is the expensive part and
those tables are small. Spreading them is nearly free by comparison. Sorting by name is the reverse:
cheap to cut, expensive to draw.

Against the same collection in the same tab, sorted by name:

| view | build | layout | first paint | elements |
|---|---|---|---|---|
| stack, spread | 64–76ms | 54–63ms | **118–139ms** | 4,690 |
| stack, settled *(before this change)* | 30–42ms | 2–3ms | **32–45ms** | 274 |
| list, first 500 rows | 43–51ms | 32–34ms | 75–85ms | 5,013 |
| grid, first 200 cards | 35–63ms | 9–12ms | 44–75ms | 1,811 |

So: **the stack view stopped being the cheapest of the three.** `cards-as-objects.md` recorded it as
costing 41–111ms against the list's 95ms and the grid's 117ms, "because it draws eleven cards per
pile whatever the pile holds". That sentence is now false. Spread, it costs about three times what it
did and roughly one and a half times the list view — 139ms at its worst, on a collection larger than
anyone in the playgroup has. That is the price of the view saying something on arrival, and it was
paid deliberately.

The bound is still real, and it is the thing that makes this affordable at all: a table draws its
piles times 60, never its cards. The 12,788-card collection and a 500-card one both draw 1,507 cards
when they cut into 28 piles.

### How to take it again

There is no permanent script — this is a number about a decision, not a floor to hold. It was taken
with a throwaway driver over `scripts/capture-screens.js`'s browser plumbing (`startServer`,
`startFirefox`, `BidiSession`), which is the same harness `measure-layout.js` and `measure-mobile.js`
are built on. Point the app at a real database (`DATA_FILE`), open Collections, switch to the stack
view, then for each field set `state.sort.field` and time `renderResults()` and a forced layout.

---

## What else had to change

**A fan card holds its own height before the picture arrives.** This is the one thing that broke, and
it broke because of scale rather than logic. `.card-fan-card img` had a width and no height, so a
card whose artwork had not loaded was not a thin card — it was a card of *no* height, with every card
after it in the fan lying exactly on top of it. One pile opened by hand never showed it: sixty
pictures land quickly and usually from cache. A table that arrives spread asks for fifteen hundred at
once, all lazily loaded, and on a phone 323 of 1,507 fan cards were still 2–8px tall with the rest of
the fan piled on them. `npm run measure:mobile` caught it as 275 unhittable cards and 16 unhittable
pile arrows at 390px.

The fix is the one the grid already uses: `aspect-ratio: 5/7` on the card's own box, so the space is
card-shaped whether or not the picture is in it (`.card-fan-card` in `components.css`,
`.db-pile-card img` in `tabs.css`). The mobile measurement is clean afterwards.

**The mobile harness stopped opening a pile.** `measure-mobile.js`'s `collections-pile` prep clicked
the first pile to fan one out, "since a fan is taller and wider". The view arrives that way now, so
the click is gone and what is measured is the arrival state — which is the dense one.

---

## What this cost, beyond the milliseconds

- **A mat with holes in it.** Both pile layouts are `flex-wrap: wrap` with `align-items: flex-start`,
  so a wrapped line is as tall as the tallest pile on it. With one pile ever open that was a shape
  nobody saw; with a deck's every category spread, a line carrying 51 Lands leaves several hundred
  pixels of empty mat under the categories holding two cards. It is the layout behaving as it always
  did, arriving where it used to have to be asked for. Left alone: packing the columns is a change to
  how the mat is laid out, which is a decision of its own and not this ticket's.
- **The Deck Builder is denser on arrival**, which is the point, but a 116-card deck is now ~116 card
  images on the mat rather than 13 stacks. It was not measured — a deck is two orders of magnitude
  smaller than a collection, and the collection number bounds it.
- **`cardstack.js` was overruled and says so.** The file recorded that opening piles is "a thing
  somebody does one arrow at a time", which was the argument for the per-pile fan cap rather than a
  table-wide one. The cap survives and the argument does not; the comment now says the cap is the
  whole table's bound as well as one pile's.

---

## Tests

`test/cardstack.test.js`'s "which piles are spread" section became "which piles are settled": the
table now arrives spread (asserted), a pile the sort has just cut arrives spread whatever else was
settled, a settled pile survives three consecutive renders, and a whole table of 27 piles of 500
cards draws 27 × 60 cards and no more. `test/carddrag.test.js` gained the drop onto a pile that was
already spread — the common case now — beside the one onto a settled pile.

`npm test` is 280 tests across 15 files, green, along with `lint:tokens`, `check:contrast` and
`measure:mobile`.
