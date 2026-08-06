# 01 — Piles land expanded

**What to build:** a table of stacks arrives with every pile already spread, on all three views that
draw one — the Deck Builder's categories, Collections' stack view and the Set Browser's. Settling a
pile becomes the thing you do, rather than spreading one.

Today the opposite is true, and it is a state model as much as a default: each tab keeps a set of
the labels that are spread — `dbExpandedCats`, `_colFannedPiles`, `setFanned` — and every one of
them starts empty, so absence means settled. Flipping the default by seeding those sets with every
label on each render fights the model: a pile you settled would spring back open the moment
anything re-rendered, and a pile that appears because the sort changed would have to be seeded too.

**Invert the set instead.** Each tab tracks the labels it has been asked to *settle*; absence means
spread. A new pile is open because nothing has settled it, a settled pile stays settled across
re-renders, and `togglePile` keeps the shape it has. The set stays in memory and is not persisted,
as it is not persisted today: a reload gives you the table fully spread again.

Nothing about `STACK_FAN_MAX` changes — a single fan still spreads at most 60 cards, and the rest of
a pile is still reached by narrowing the search or sorting by a field that cuts finer.

**What this costs, accepted deliberately.** `cardstack.js` records that a settled stack is bounded
by `STACK_LAYERS_MAX` and costs nothing whatever it holds, while a fan is real cards — and that
opening piles is "a thing somebody does one arrow at a time". This ticket overrules that for the
first paint. A collection stacked by rarity now arrives as four fans, and stacked by name as
twenty-seven, each up to 60 cards: on the order of 1,600 card elements where there were 27. The
decision is to ship it and measure it rather than to cap which piles open, so the measurement below
is the part of this ticket that is not optional.

**Blocked by:** nothing.

**Status:** todo

- [ ] Deck Builder categories, Collections' stack view and the Set Browser's arrive with every pile spread
- [ ] Each tab tracks settled labels rather than spread ones, and absence means spread
- [ ] Settling a pile survives a re-render, a sort change and a quantity edit
- [ ] A pile that appears because the sort changed arrives spread
- [ ] A label that is settled and then stops existing does not keep a pile settled if the label returns for different cards, or the chosen behaviour is stated
- [ ] `togglePile` and the pile toggle's `aria-expanded` still say what is true
- [ ] Nothing is persisted — a reload returns the table to fully spread
- [ ] `STACK_FAN_MAX` is unchanged and still bounds each fan
- [ ] First paint of Collections' stack view on a large collection is measured, in the worst grouping the app offers, and the number is recorded in the record
- [ ] Card motion, the hover lift and the card menu behave on a fanned card exactly as on a settled pile's face card
- [ ] Correct in all five themes, and at the narrowest breakpoint
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
