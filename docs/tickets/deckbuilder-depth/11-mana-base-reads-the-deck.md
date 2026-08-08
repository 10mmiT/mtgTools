# 11 — The mana base reads the deck

**What to build:** the Mana Base Calculator stops asking you to type in numbers the app already
knows.

The calculator does the right maths — basics distributed proportionally by pip count, by largest
remainder so the totals always add up — and then makes a person count the white pips in their deck
by hand and type them in, while the deck holding every one of those numbers sits one tab away. Two
features that share a domain, not speaking. It is the most embarrassing gap in the app precisely
because the hard part is already written.

**Use this deck** fills the calculator from the open deck. The pips come off the cards' actual mana
costs — *not* colour identity, which is what the readout currently counts and is the wrong number
for this question: a card that costs one generic and one green demands one green pip, whatever its
identity says. Non-basic lands are counted off the deck's own lands.

Then the other half of the question, which the calculator has never been able to ask: **sources
against pips.** *Your spells want thirty-four white pips and twelve blue; your lands make eighteen
white sources and nineteen blue.* That comparison is the single most useful thing this kind of panel
can say, and it needs the mana-production fact that ticket 01 adds to the cache.

The result folds back into the Deck Builder as a panel expanding out of the readout, rather than
living only on its own tab. **The calculator tab stays** — working out a mana base before there is a
deck to read is a real thing to want.

From `spec-deckbuilder-depth.md` → proposal 4.

**Blocked by:** 01 — The card cache learns three new facts.

**Status:** done

- [x] The calculator can be filled from the open deck in one action
- [x] Pips are counted from mana costs, not from colour identity, and a hybrid or phyrexian symbol is counted defensibly
- [x] Non-basic lands are counted from the deck rather than typed in
- [x] The panel compares the pips the deck demands against the sources its lands produce, per colour
- [x] Cards that make mana without being lands are counted as sources
- [x] The comparison is reachable from inside the Deck Builder, and the standalone calculator tab still works with nothing loaded
- [x] A colourless or single-colour deck produces a sensible answer rather than a division by zero
- [x] Changing the deck updates the panel; rendering the mat does not recompute it
- [x] Works in all five themes and at every breakpoint
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

## What was built

`js/deckview-mana.js`, one pass over the deck for both halves of the question,
memoised in `_dbMana` and dropped by `dbManaChanged()` beside
`dbTotalsChanged()` and `dbCheckChanged()`. The readout's lands figure opens the
panel it draws; the calculator tab gained one button; nothing else moved.

### A pip is a symbol in a cost

The ticket's own sentence is the whole of the module: colour identity is what a
deck may hold and a mana cost is what it asks for, and only one of them can tell
you how many Plains. So the pips are read out of `mana_cost`, symbol by symbol,
and **every symbol is worth one pip shared equally between the ways it can be
paid**. `{G/U}` is half a green and half a blue — either will do, and a whole pip
of each would make a deck of hybrid cards demand twice the mana it does.
`{2/W}` and `{W/P}` are half a white, the other payment being two generic and
two life. Generic and `{X}` are not pips at all: they say how much, not which.

That is a convention rather than a fact, which is why the panel says it out loud
underneath the numbers rather than hedging it into every row. What it protects is
the one property the maths downstream depends on — the pips of a deck add up to
the symbols in its costs, so the proportional split of basics is a split of
something real.

The awkward shapes are each read where they keep their cost: a split card's one
string holds both halves and both are counted, because you may cast either; a
transforming card keeps none of its own and is read off its faces; **the
commander is counted**, which is the one place this disagrees with the readout
above it. You cast it from the command zone more often than anything else in the
box, and a mana base that ignores what it costs is a mana base for a different
deck. The panel says which deck it counted.

### Sources, and the halves that are honest about themselves

A source is any card whose `produced_mana` names a colour — ticket 01's third
field, spent here. A dual land is a source of each of its two colours, Birds of
Paradise of all five, Sol Ring of colourless and it is not a land at all. They
are counted by copies, so two Command Towers are two of everything, and the
shares are therefore shares of *source slots* rather than of cards — said beside
the numbers, because a percentage whose denominator is a surprise is worse than
no percentage.

The comparison itself is two shares and a shape: the share of the deck's pips a
colour is, over the share of its sources, both drawn in that colour's own ink.
**One finding is called a fault and no other is**: the deck asks for a colour and
nothing in it makes that colour. Everything else is a person reading two numbers,
which is what a mana base is. There is no threshold here for the same reason
ticket 10 counts tutors and refuses to weigh them — a number we invented and wore
as Wizards' would be the one thing this panel could not defend.

A card whose facts have not arrived is counted in neither half and named. A deck
reported as wanting no white because eleven of its cards are still in flight is
the one kind of wrong a mana base cannot survive, and it is the same rule the
legality line follows for the same seconds of the same cache refresh.

### One answer to what a land is

`_dbTypeOf()` in `js/deckview-totals.js` became `dbCardType()` and is what this
module asks. It matters for exactly one card in a thousand — an artifact land is
bucketed under artifacts by the app's one type ladder, which is what the
breakdown and the piles on the mat read — and the point is that the panel and the
line that opens it can never disagree about how many lands the deck has. The
basics are counted off the type line, the non-basics are the remainder, and those
two are what the calculator's fields get.

While the readout was open: `totals.pips` was counting *cards by colour identity*
under a name that says pips, drawn beside mana symbols where it reads as a pip
count. It is `totals.colorCards` now, with a tooltip that says which question it
answers. The number on the line has not changed; what it claims has.

### The two tabs speaking

**Use this deck** fills the calculator's every field: the size the deck is built
to rather than how far along it is, its lands, its non-basics, and its pips
rounded to whole numbers — rounded there and nowhere else, because the fields are
integers and half a pip cannot move a basic, while the panel keeps the halves
because that is where the number is read rather than used. The three non-basic
boxes are summed and never told apart, so the deck's non-basics go into "other"
rather than this app inventing a definition of a fetch land. What was taken is
said on the line beside the button, including how many cards it could not read.

It is one direction only. Nothing writes back, everything can be typed over, and
the tab works with no deck loaded — which is why it is still a tab. The way in
from the builder is the panel's own button, which fills the fields and goes
there.

### The frame

The third panel to rise out of the readout, and the third to put the other two
away when it opens — they are anchored to the same edge of the same bar. It opens
off **the lands figure** rather than the row of colour symbols beside it for one
reason worth writing down: those symbols leave the line below 900px, and a panel
whose only door is hidden on a phone is a panel a phone does not have.
`scripts/measure-mobile.js` gained a `deckview-mana` view for the reason tickets
09 and 10 added theirs — the panel is closed when the tab arrives, so its ✕ and
its way through to the calculator would have passed the 44px measurement by not
being on screen.

### What was measured

`npm test` (722, `fail 0`), `npm run lint:tokens`, `npm run check:contrast` and
`npm run measure:mobile` — twenty views, no sideways scroll, every target at
least 44×44. Beyond what those can answer, driven in headless Firefox against the
live-data snapshot:

- a real 100-card Dimir deck reads **36.5 blue pips against 49 blue sources** and
  **35 black against 42** — the halves are Kitchen-Finks-shaped cards in the
  deck, not rounding
- its red, green and colourless sources sit at 5–6% of the deck's sources against
  0% of its pips, which is what fixing lands in a two-colour deck looks like and
  is exactly the reading the panel is for
- 54 lands, 10 basic and 44 not, matching the figure on the line that opened it
- **Open in the calculator** lands on the lands tab with 100 cards, 54 lands, 44
  non-basics and W 10 / U 37 / B 35 in the pip fields, and the calculator splits
  the ten remaining basic slots 1 Plains / 5 Islands / 4 Swamps
- opening this panel closes the missing list, and opening the missing list closes
  this one
- all five themes draw the bars, the ground and the captions from their own
  tokens — five distinct sets, no hex anywhere in the module
