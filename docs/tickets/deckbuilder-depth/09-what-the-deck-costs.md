# 09 — What the deck costs, and what finishing it costs

**What to build:** the readout starts carrying the numbers a deck is usually judged by, and the one
number this app is uniquely placed to give.

Every card already shows its own price and the deck shows no total, which is the wrong way round —
nobody adds up ninety-nine numbers. So: **the deck's total**, and, because ticket 08 knows what you
are missing, **the total of what's missing**. That second figure is the one that matters. It is not
what the deck is worth, it is what finishing it costs, and it is the number the group actually
argues about.

Alongside it, the rest of what the readout should have been saying all along: the **type
breakdown** — creatures, instants, sorceries and the rest — the **spell-versus-permanent split**,
and the **curve split by colour** rather than one merged set of bars. The curve exists already; it
just answers a coarser question than it could.

All of it belongs in the readout line and its expanding section from ticket 03, not in a new strip.

The app is Cardmarket- and euro-oriented throughout and this should stay that way rather than
growing a currency selector.

**This must not make the mat slower.** These are deck-wide passes, and the mat's animation is
carefully bounded to what is on screen. Recompute when the deck changes, not when it renders.

From `spec-deckbuilder-depth.md` → proposal 8.

**Blocked by:** 08 — The deck says what you own.

**Status:** done

- [x] The readout shows the deck's total price
- [x] It also shows the total of the cards you do not own, and that figure follows the ownership scope
- [x] A card with no price is counted as unknown rather than as zero, and the total says so
- [x] The type breakdown and the spell/permanent split are available from the readout
- [x] The curve can be read split by colour as well as merged
- [x] Totals count the mainboard and the commander, and exclude the maybeboard
- [x] Nothing recomputes on render — only when the deck changes
- [x] A four-hundred-card deck costs no more per render than it did before this ticket
- [x] Works in all five themes and at every breakpoint
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

## What was built

`public/js/deckview-totals.js` — one pass over the deck, and every number the
readout and the analysis strip say is a field of it. `dbRenderStats()` stopped
counting anything and became drawing: it drops the pass on the way in, asks for
it once, and hands the pieces out.

### Two figures, and which deck each of them counts

`€177.66 (19 unpriced) · €4.08 to finish` sits between "87 of 99 you own" and
the land count. The second half only appears when the deck is short of
something, and it follows whichever shelf the readout is scoped to — it is
`dbShortOf()` from ticket 08 rather than a second opinion of what "missing"
means, so the readout cannot give two answers to one question.

**The money counts the mainboard and the commander; everything else counts the
mainboard alone.** That looks like an inconsistency and is the one real decision
in the ticket. "What does finishing this cost" is a question about a box you can
sleeve, and a deck you cannot legally sit down with because you have not bought
its commander is not finished. But the commander is still not one of the
ninety-nine — ticket 05 settled that the curve and the average mana value are the
deck's and not the commander's, and it is asserted — so the count, the curve, the
type breakdown and the split all leave it out. The two numbers on the line answer
two different questions on purpose. The maybeboard is in neither.

### Unknown, never nought

`_dbCardEur()` returns `null` rather than `0` for a card Scryfall has no
Cardmarket price for, and `_dbPriceOf()` carries `{ eur, priced, unknown }`
rather than a single sum. A real deck off the live database has **19 of 116**
cards with no EUR price, so this is not a corner: a total quietly short by
nineteen cards looks exactly like a total that is right. A deck where *nothing*
can be priced draws `—`, not `€0.00`.

### The type breakdown reads the piles' way round

`DB_TYPES` tests in `dbAutoCategory()`'s order, so an Artifact Creature is a
creature in both and the breakdown never disagrees with the piles on the mat.
Each card lands in exactly one bucket, which is what lets it add up to the deck.

The split is **permanents / spells / lands**, three buckets rather than two.
Lands are permanents by the rules and are pulled out anyway: a Commander deck is
a third lands, so a line that buried thirty-seven of them in the first number
would say the same thing about every deck ever built. Taken out, the split says
the thing it is for — of the cards you cast, how many stay on the table.

### One curve, read two ways

The Colour toggle cuts each bar into bands of `--mc-w … --mc-gold` and keeps the
height it had merged, so it is one shape read two ways rather than two charts.
**One band per card, not one per colour it is**: a gold card counted under each of
its colours would make the bars add up to more than the deck, so multicolour is a
band of its own. The band comes from `colors` — what a card costs to cast — and
not `color_identity`, because a colourless artifact with one green activation
belongs in the colourless band of a curve; a transforming card is banded by its
front face, which is the one you cast.

### Nothing on render

The pass is memoised in `_dbTotals` and dropped by `dbTotalsChanged()`, which
`dbRenderStats()` calls — being called *is* what "the deck changed" means on this
tab. What that buys is asserted rather than assumed: the test wraps
`_dbComputeTotals` and counts. The readout and the whole analysis strip cost
**one** pass between them; twenty `dbRender()`s cost none; opening the strip and
turning the curve over and back costs none; a four-hundred-card deck is still
one pass and still nothing on render.

### The frame

The analysis section from ticket 03 now holds three parts and wraps, so the
toolbar button is *Analysis* rather than *Curve*. A text part sits its label on
the same baseline as its counts; the curve is the exception, because bars have no
baseline, and lines up on the bottom of the tallest bar instead.

`scripts/measure-mobile.js` gained a `deckview-analysis` view. The strip is
closed when the tab arrives, so without it the colour toggle would have passed
the 44px measurement by not being on screen — the same reason ticket 08 added
`deckview-owned`.
