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

**Status:** ready-for-agent

- [ ] The calculator can be filled from the open deck in one action
- [ ] Pips are counted from mana costs, not from colour identity, and a hybrid or phyrexian symbol is counted defensibly
- [ ] Non-basic lands are counted from the deck rather than typed in
- [ ] The panel compares the pips the deck demands against the sources its lands produce, per colour
- [ ] Cards that make mana without being lands are counted as sources
- [ ] The comparison is reachable from inside the Deck Builder, and the standalone calculator tab still works with nothing loaded
- [ ] A colourless or single-colour deck produces a sensible answer rather than a division by zero
- [ ] Changing the deck updates the panel; rendering the mat does not recompute it
- [ ] Works in all five themes and at every breakpoint
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
