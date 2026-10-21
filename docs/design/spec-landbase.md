# Spec — the Lands tab

What was decided, and why, after
[research-landbase.md](research-landbase.md) established what was possible.
Where that document disagrees with this one, this one is the decision.

The tab has two reasons to exist, and it is worth saying which is which. The
first is the one Archidekt has: a way to *find* lands, by cycle and by play
rate, without leaving the deck. The second is the one it does not: a way to know
whether the mana base you ended up with **works**, and a button that fixes the
part of it a button can fix.

## The shape

A third tab, `Lands`, in the drawer that already holds Search and EDHREC. Three
regions, stacked, top to bottom:

| region | what it is | ships |
|---|---|---|
| **the check** | per colour: sources the deck has, sources it wants, the gap | second |
| **fix it** | the lands that would close a gap, the group's copies first | second |
| **browse** | the cycles, collapsed, in colour identity | **first** |

Browse ships first. It is the thing that was asked for, it is the thing that
gets opened every session, and it makes the tab useful before the judgement
calls underneath the check have to be right. The check drops into the top of a
tab that by then exists.

The `+` on a card means what it already means everywhere else in the drawer, and
goes wherever the drawer's "Add to" says. `dbDrawerTile()`
([deckview-panels.js:198](../../public/js/deckview-panels.js#L198)) is reused
whole — the grid, the "already in Deck ×1" badge, the ownership mark, all of it.

### How the drawer is reached

A third tab makes the drawer three ways of finding a card rather than one search
box, and that changed where it is opened from. It had a row under the menu's
"Look at", written when there was only the search box; `ab1435d` replaced that
row with **a magnifier on the control strip**, `#dbFindBtn`, in the cluster with
the ☰, the fold and the `?`.

The menu row **went**, deliberately: one drawer, one place to press for it. The
menu's own argument is that it holds what the strip has no room for, and the
strip had room — on a phone it already wrapped to a second line, so a fourth
button makes that 2+2 rather than 3+1. `/` and the readout's mana figure open
the drawer exactly as they did; this adds a way in and removes a duplicate, and
takes nothing away.

The button reports `aria-expanded` the way the menu button does, and the state
is written inside `dbOpenSearchPanel()` / `dbCloseSearchPanel()` rather than by
whoever pressed, because three different things open this drawer.

### What this replaces

The readout's mana panel is **absorbed**. It draws pips against sources per
colour; the check draws pips against sources per colour with the requirement
beside it and the fix underneath. Two of those on one screen, ten pixels apart,
is the same information twice. So `dbManaPanel` goes, and `dbStatLands` becomes
a door that opens this tab instead of its own panel.

The **Mana Base Calculator tab stays**, untouched. It is the only thing in the
app that works with no deck loaded, which [lands.js:44](../../public/js/lands.js#L44)
already says out loud, and this tab does not serve that case. It keeps one quiet
inbound link from here, worded as what it now is: the way to work a mana base by
hand, or to work one out for a deck that does not exist yet. `landsUseDeck()` and
`dbManaForCalculator()` keep their shape and their fields.

**One of the calculator's numbers did move, and this line used to deny it.** The
pips it is filled with are read by `_dbManaCostOf()`, which now sums every face
of a card rather than trusting its top-level `mana_cost`. For most cards the two
are the same string. For an Adventure they are not: Bonecrusher Giant's own
field says `{2}{R}`, and Stomp — a second cost on the same card, paid at its own
moment — is invisible to it. Both are red mana somebody had to have, so both are
counted, and a deck of Adventures fills the calculator with more pips than it
used to. This is wanted: the old reading was short, not different. `dbCostFaces()`
is where "what are a card's costs" is answered, for the check and for this tab
alike, and test/deckmana.test.js pins the Adventure at the calculator's own
boundary so that the change stays deliberate rather than incidental.

## Both formats

`dbDeckFormat()` ([deckview-legality.js:123](../../public/js/deckview-legality.js#L123))
knows two formats and the deck record carries no third. Both get the tab.

- **The check** reads the table row for the deck's land count, whatever the deck
  size. The 99-card and 60-card tables are different rows of the same idea, not
  different features.
- **The browser** filters on the commander's colour identity when there is a
  commander, and on the union of the deck's own colours when there is not. The
  second is a worse filter than the first. It is not nothing, and "show me the
  shocklands I could run" does not need a commander to be a fair question.

## The check

### Lands only

The lookup is fed the deck's **land** sources and nothing else. `dbDeckMana()`
counts anything carrying `produced_mana`, which is the right answer to "what
makes mana in this deck" and the wrong input here: the simulation behind the
numbers sleeves lands and blanks, so a source count inflated by Signets and
dorks reports a consistency the model never claimed.

Rocks and dorks are still said out loud, on their own line — "and 9 other
sources the table does not count" — so nobody thinks we failed to notice them.

Weighting a two-mana rock as some fraction of a land is where this probably ends
up eventually. Every fraction found for it traces to a blog rather than a
simulation, and putting an invented number inside a real one is worse than
leaving it out.

### The bar, and the card that set it

Per colour, the bar is the most demanding cost the deck actually runs, and the
check **names the card that set it**:

> blue: 21 sources — wants 27, for Cryptic Command

Naming it is the whole point. One `{U}{U}{U}` card in an otherwise fine deck
demands 34 blue sources, and a bare number would make the check scream at a deck
that plays fine. Seeing which card set the bar is how a person decides the bar
is wrong. The per-card list — every card the deck's sources cannot support —
sits behind it, for when they want to argue.

### What the panel says about itself

The numbers are a floor to argue with, not a verdict, and the reasons are on the
panel rather than hidden: the table assumes every source is untapped, so a deck
full of taplands overstates itself; Commander is multiplayer, where the
turn-three deadline is softer than the model's.

They sit behind **how this is read**, one press, the same way the per-card list
sits behind the headline — small print is disclosed, not published: four lines
of prose standing over three bars is a wall in front of the finding. Two things
stay in the open regardless, because both change what the bars *mean*: the
sources the table does not count, and the cards it could not read.

## The fix

The table above gives this region one line — *"the lands that would close a
gap, the group's copies first"* — and that is the whole of what it asks for.
Three rules that shape what the reader actually sees were added while building
it, and none of them is in this spec or in #57's acceptance criteria. They are
wanted, and they are written down here because a rule nobody can find is a rule
nobody can argue with.

The query is `t:land produces:<colour> -t:basic`, narrowed by `id<=` the deck's
colours where there are any. `t:land` rather than anything with `produced_mana`,
because the check counts land sources and nothing else: a Signet offered here
could not move the number it was offered to move.

**No basics.** `-t:basic` is on the query. The order this region sorts in is
play rate, and Island is the most played card in Magic that makes blue, so
without it every list of what makes a colour opens with its own basic. A deck
short of a colour's basics does not need a search for one — it needs the
optimizer two sections up, which splits them. The two halves of the tab would
otherwise be answering the same question in different voices.

**Nothing the deck is already full of.** A land the deck runs to its copy limit
cannot close a gap, so it is dropped. The limit is `dbCopyLimit()` in
[deckview-legality.js](../../public/js/deckview-legality.js) rather than a
second reading of the rule, so that the Lands tab and the legality panel cannot
disagree about what a deck may run: four in a 60-card deck, one in Commander,
and whatever a card that says so allows. The maybeboard does not count against
the limit, because a card set aside is a card you have not played.

**A dozen, and it says so.** `DB_FIX_SHOWN = 12` — about four rows of tiles in
the drawer, which is a list somebody reads, where a hundred and forty-one is a
list somebody scrolls past. Two things survive the cut whatever their play rate:
everything somebody in the house has a copy of, because that is this region's
one claim over Archidekt's and cutting it to keep the ranking tidy would be
cutting the answer. And where anything was cut — or where Scryfall's first page
of 175 never held it — the region says what it is showing out of: *"Showing 12
of the 141 lands that make blue in these colours."* Twelve of a hundred and
forty-one presented silently would read as the whole answer.

## Optimize basics

A button in the tab. It asks **how many basics**, splits that number across the
colours, shows what it would do, and applies it on a second press.

It lives in `public/js/deckview-basics.js`, its own file, served immediately
after `deckview-landbase.js`. Everything else on this tab is a reading of a
deck; this is the only thing that writes one, and it owns state and a history
reason nothing else in the tab touches. The dependency runs one way: the
optimizer is built on the check's tables and requires them, while the land base
module asks whether the optimizer is loaded before drawing its control — so a
tab drawn without the file is three readings and no Apply button. Both halves of
that are asserted in `test/decklands.test.js`.

### It asks for basics, not for lands

The number is a budget, not a remainder. Different decks want different amounts
of basic land, and typing the number directly is what stops the split from
crowding out the rest of the list — which is the entire reason the control
exists. The deck's non-basic count is not an input; the deck's total land count
is not an input.

The field is prefilled with what the deck runs now, so the default press means
"re-balance the basics I already have" and changes the split without changing
the deck's size.

### Proportional, then honest

The split is `landsDistribute()`'s existing maths: proportional to pips, by
largest remainder, so the numbers always add up. Afterwards the check runs over
the result and says which colours are still short.

Gap-driven solving — pour basics into whichever colour is furthest below its bar
— was considered and rejected. The total is fixed, so every Plains added to fix
white removes a source of something else; it thrashes, and in a three-colour
deck there is frequently no basic-only split that clears every bar, because the
answer is duals. The proportional split is close to optimal for balance. The
check underneath is where the truth about what it could not fix goes.

### Plain basics, and the ones we do not manage

Six names, from `DB_MANA_COLORS[].basic`. No snow, no printing selection — a
deck running Snow-Covered Forests is an edge case its owner can fix by hand.

But `dbIsBasic()` reads the type line, and `Basic Snow Land — Island` and
`Basic Land` (Wastes) both pass it. So the deck's basic count includes cards the
optimizer will not write to, and left alone that turns "I asked for 14" into a
deck that grew by three.

So: **basics the optimizer does not manage come off the budget and are named in
the preview.**

> 3 Snow-Covered Forests aren't touched — 11 to split

Wastes is the one name on both sides of that line, and which side it falls on is
decided by the same rule the split runs on (below): **Wastes is managed only
where the split would put `{C}` weight on it** — a deck whose pips are
colourless ones. Anywhere a colour could take the slot, `{C}` is given none, so
a Wastes counted as managed is a row the split takes to nought and the write
then deletes; an Eldrazi-splash deck would lose its Wastes to the default
re-balance press. So in a deck with a colour in it Wastes comes off the budget
and is named as untouched, like a snow basic; in a colourless one it is the
whole split.

The deck with neither — all-generic costs, no `{C}` pip anywhere — asks for
nothing, and the optimizer already says so rather than splitting a budget over
it (`nowhere`, below). Its Wastes being spare is the same answer said about the
basics: there is nothing here to work out.

The number typed therefore means total basics in the deck *after* this, the deck
never silently grows, and the edge case we chose not to build for is at least
visible to the person who has to fix it.

### Colourless

`{C}` is excluded from the split. A Commander deck with two colourless pips does
not want two Wastes, and a proportional split that hands one a slot takes it from
a colour that needed it. `{C}` is still counted in the check.

**Unless the deck has no coloured pips at all** — a Kozilek or Karn deck — in
which case Wastes is the whole split. This completes the rule rather than
contradicting it: `{C}` never competes with a colour, and with no colour to
compete against, Wastes is simply the answer. It is also the rule that decides
whether Wastes is a basic the optimizer manages at all — `_dbBasicsHeld()` reads
`_dbBasicsWant()` rather than keeping a second opinion about `{C}`.

### The toggle

**"At least 1 basic of every colour"** — off by default, remembered across decks
in `localStorage` the way `dbAddTo()` is
([deckview-panels.js:124](../../public/js/deckview-panels.js#L124)).

"Every colour" means every colour the deck has **pips** in, not the commander's
identity: a Golgari commander whose black never appears in a mana cost would
otherwise get a forced Swamp for a colour nothing asks for.

Off by default because the proportional split is the honest answer and this is
the override. But the preview flags the moment it would have mattered —

> green rounded to 0 basics, and nothing else in the deck makes green

You find out when it bites rather than having to know to flick a switch first.

**Not off the `unmade` signal, though this spec first said it would be.** That
signal is the colours a deck asks for that *nothing in the deck makes*, read off
the deck as it stands ([deckview-mana.js:246](../../public/js/deckview-mana.js#L246)),
and the deck as it stands is the wrong deck to ask about. A deck holding four
Forests makes green right up to the moment of the write, so `unmade` never names
green — and a split that takes those four Forests to nought is precisely the
case this flag exists to catch. It would have fired on nothing.

`_dbBasicsStarved()` recomputes the condition instead, in two halves. Rounded to
nothing is the split's answer rather than the deck's current basics, because the
row moving from 4 to 0 is the finding. Nothing else makes it is the deck's
sources of that colour with the basics this optimizer manages taken back out —
what would still make green once the write has landed. It is scoped to the
colours a split may place, so the flag and the toggle agree about `{C}`. The
reasoning is argued in full in the commit message of `ac9515c`.

### Preview, then apply

Two presses. The preview shows three things:

```
Plains    8 → 11
Island    9 →  7
Forest    6 →  5
deck 99 → 102 · lands 37 → 40
still short: blue 4 — a land, not a basic
```

The rows, the resulting deck size and land total, and the resulting check
verdict. The size line is there because growing the basics count means other
cards have to go; the verdict line is there because the case worth catching is
the one where the split cost three spells and fixed nothing.

It is the first thing in the app to write a calculation into a deck, and it
writes to the least-noticed cards in the list. Silent would mean finding out
three games later.

### How Apply writes

`qty` set on rows directly — **not** a loop of `dbAddCard()`, which adds one copy
at a time, is async, re-fetches card data and re-renders on each.

- an existing row keeps its category, so a Plains someone filed under a custom
  "Mana Base" stays there;
- a genuinely new row gets `dbAutoCategory()`, which sends anything with `land`
  in its type to `'Lands'` ([deckview-core.js:747](../../public/js/deckview-core.js#L747));
- a colour going to **zero** is `dbRemoveCard()`, because `dbChangeQty()` clamps
  at `Math.max(1, …)` and nothing in the app currently takes a row to nothing in
  bulk;
- one render and one autosave at the end, not fifteen.

This is a second write path into `dbCards`, so it owes the same hooks the edit
module calls — `dbManaChanged()`, autosave, the snapshot — or the readout goes
stale behind it. Gated on `isMyPlayer(dbDeck.playerId)` like every other edit.

## The browser

~20 cycles, one Scryfall `is:` query each, through the existing proxy
([routes/scryfall-proxy.js:52](../../routes/scryfall-proxy.js#L52)).

**Sections start collapsed and load on first expand.** Firing all twenty on tab
open would be twenty calls into a queue paced at ~9/s for the whole house, which
stalls somebody else's search for two seconds to populate cycles they did not
ask for. Lazy means zero requests when the tab opens, one when you actually want
shocklands, and the proxy's ten-minute cache means the second person in the house
to open shocklands pays nothing. It also makes the full cycle list affordable, so
we never have to litigate which eight cycles matter.

Cycle membership is not in the card response, so fetching all lands once and
grouping client-side is not available.

### The predicate trap

An `is:` value Scryfall does not recognise is **silently ignored**, not refused:
`is:bogusfoo t:land` returns 1224 cards, which is every land in Magic. A typo in
the cycle list does not produce an error — it produces a section headed
"Shocklands" holding all 1224.

## Tests — `test/decklands.test.js`

Five subjects:

1. the requirement lookup at its boundaries;
2. the split — largest remainder, the toggle, the `{C}` rule and its
   all-colourless exception;
3. the unmanaged-basics subtraction;
4. the write path — categories and quantities preserved, zero going through
   removal;
5. the cycle list.

The fifth carries a limitation worth writing into the file's header comment, the
way `cardquery.js` writes down which filters it refuses and why. **The counts are
pinned as constants, and no test touches the network.** Every one of the repo's
24 test files runs locally, and `offline.test.js` exists to assert the app owes
nothing to a route out — a test that asked Scryfall would fail on the machine
this app is designed for, for a reason that is not a regression in our code.

Constants plus a documented re-probe command catch the case that matters:
somebody edits the cycle list and typos a name. They honestly cannot catch
Scryfall renaming a predicate underneath us. That is the trade, and it is
written down rather than assumed.

## Not in scope

- **Taplands.** "How many of these enter tapped" is the second question every
  Commander mana base asks. `oracle_text` is in the local cache, so a regex is
  possible and would be wrong on Pathways and check lands specifically. Its own
  ticket.
- **Snow basics**, beyond being named in the preview so they can be fixed by
  hand.
- **Fractional weights for rocks and dorks**, until there is a simulation behind
  a number rather than a blog.
- **Budget filters.** Prices already render elsewhere; the ownership scope
  answers most of what a price filter would be for.
