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

**Status:** ready-for-agent

- [ ] The readout shows the deck's total price
- [ ] It also shows the total of the cards you do not own, and that figure follows the ownership scope
- [ ] A card with no price is counted as unknown rather than as zero, and the total says so
- [ ] The type breakdown and the spell/permanent split are available from the readout
- [ ] The curve can be read split by colour as well as merged
- [ ] Totals count the mainboard and the commander, and exclude the maybeboard
- [ ] Nothing recomputes on render — only when the deck changes
- [ ] A four-hundred-card deck costs no more per render than it did before this ticket
- [ ] Works in all five themes and at every breakpoint
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
