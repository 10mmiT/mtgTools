# Cards on a Table — what was done

A record of the work on `feat/cards-as-objects` (14 commits, `33a9486..6ae9a40`), written after
delivery. It supersedes the 11 tickets it was driven from — `01-motion-preference` through
`11-card-context-menu` — and stands beside the PRD (`docs/design/spec-cards-as-objects.md`), which is
what the work was specified from. Where this document and a ticket disagree, this one is what
happened.

It also largely closes `docs/design/ui.md`, the "Cards on a Table" interactivity brief that the UI redesign wrote
and did not build. All three of its deliverables are here — the hover-to-lift, the Deck Builder as a
playmat of piles, and the card-size control — with one clause of the second left undone: dragging a
card onto empty mat space does not create a category. See "What this cost" below.

---

## The principle

> A card is an object lying on a table, not a picture in a box.

Everything below is that sentence applied to a specific surface. The app is personal software for a
playgroup: vanilla JavaScript, no build step, no framework, served from someone's own machine. None
of that changed. Five new files carry all of it, and each is written against a class or an attribute
rather than against a tab:

| file | what it is |
|---|---|
| `public/js/motion.js` | Whether cards move: the preference, resolved against the operating system |
| `public/js/cardlift.js` | Picking a card up — the lift, the lean and the sheen, on `.card-img` |
| `public/js/cardstack.js` | Drawing a group of cards as a stack — thickness from count, angle from name |
| `public/js/cardmove.js` | Cards travelling to where a re-render put them, on `data-moves` |
| `public/js/carddrag.js` | Carrying a card, or a handful, on `data-carry` and `data-drop` |

No tab imports any of them. A card image gets the lift by being a `.card-img`; a pile receives a
carried card by being a `data-drop`. That is what let one renderer serve the Deck Builder,
Collections and the Set Browser without any of the three learning about the others.

---

## What the numbers say

Every figure here is from a run on the final commit, in headless Firefox against a copy of a real
database, not from a claim in a ticket.

| | before | after |
|---|---|---|
| Transitions honouring `prefers-reduced-motion` | 0 of 58 | **58 of 58**, linted |
| Moving elements under reduced motion | — | **0** of 926 on the app page, 0 of 49 on login |
| Card artwork drawn in a framed tile | 16 images, 9 files | **0** — one `.card-img`, stated once |
| Card-size control | Deck Builder only | **five tabs**, remembered per tab *and* per view |
| XL view | 4 near-identical renderers | **deleted** — the slider runs 80–300px |
| Views that draw stacks | 1 (Deck Builder) | **3** (+ Collections, Set Browser) |
| Deck Builder drag | browser drag-and-drop, teleporting drop | **pointer events**, carried and landed |
| Re-renders that animate | 0 | **all of them**, bounded to a screenful |
| Buttons on a grid tile or pile card | 3 | **0** — a right-click asks instead |
| Tests | 125, across 7 files | **276, across 15** |

Restacking a 12,788-card collection costs **41–111ms**, against the list view's 95ms and the grid's
117ms. The stack view is the cheapest of the three, because it draws eleven cards per pile whatever
the pile holds.

---

## The work, in the order it landed

### 1–2 · Motion gets a preference, and a contract

**The switch is kept with the person, not the browser.** `card_motion` on `user_prefs`, through the
same try/catch `ALTER TABLE` migration and the same patch endpoint the playmat already used, and
`js/motion.js` loaded in `<head>` beside `js/playmat.js` — a page that paints and then discovers
motion is off has already moved. In open mode there is nobody to hang it on, so the browser is the
whole record and the response says so.

**Two values reach `<html>`, not one.** `data-motion-pref` is what the person chose;`data-motion` is
what they get. The resolution rule is one function of two inputs and it only ever subtracts — the
operating system can take motion away, never add it back. CSS reads the result as a multiplier;
`cardMotionOn()` reads the same attribute rather than a variable of its own, so the two cannot
disagree. The `prefers-reduced-motion` rule is last in the file at equal specificity, which is how it
beats a preference of `on` without the `!important` this codebase bans — and it stands alone if no
script ever runs.

**The switch shows the preference, not the effective value.** Someone whose system asks for less
motion has not turned this off, and a box that unticked itself would tell them they had. A note below
it says what happened instead.

**Then the whole app came under the guard.** 55 transitions and 3 animations across five files,
`login.html`'s own `<style>` block included. The global wildcard override — the usual recipe — was
rejected twice over: it needs `!important`, and a blanket override cannot be verified rule by rule.
Instead the guard is `calc(var(--motion-ui) * .15s)`, one duration stated once, collapsing to `0s`
when the multiplier is zero, and `scripts/lint-tokens.js` gained a `motion` rule that fails the build
on any transition or animation not written that way. Its escape hatch is a ratchet shaped like the
existing `!important` allowlist: an entry that is no longer needed is itself a failure.

**Two multipliers, not one.** `--motion` is the "Cards move" preference. `--motion-ui` is the
interface's own movement — drawers, chevrons — which a switch labelled *Cards move* is not entitled
to freeze. A system asking for less movement is asking the whole app, so the reduced-motion query
zeroes both.

### 3–4 · A card stops being a tile, and can be picked up

**One class, `.card-img`, worn by every image of card artwork in the app** — 16 of them across nine
files — with the treatment stated once in `components.css`. The tiles came off all of them: the two
grids, the printings list, the pile, the list thumbnails, the card tooltip and the Deck Builder's
hover preview, four of which were also casting a rectangle's shadow around artwork that carries its
own rounded black frame.

**The lit and shaded edges are borders, not a second shadow.** Painted outside the silhouette they
would sit on the page, where a white hairline is invisible on a light theme and a black one on a dark
theme; inside, they read against the card's own frame in all five. An inset `box-shadow` cannot do it
at all — on a replaced element it is painted under the image and never shows.

**Two tokens rather than an exemption.** `--radius-card: 4.75% / 3.5%` is a physical card's corner as
a ratio; it joined the radius scale and *retired* an inline exemption `.card-detail-img` had been
carrying for exactly that value. `--card-cast` / `--card-lit` / `--card-shade` are per-palette, with
the drop-shadow geometry stated once. The linter needed no new rule and granted no new escape —
`filter` is the property the elevation rule does not govern, which is why a card may carry both an
edge and a shadow.

**Pointing at a card picks it up.** One pointer listener on the document, in `js/cardlift.js`,
written against `.card-img` — so it belongs to every card image in the app and to any added later,
rather than to six tabs' markup. The image takes the transform; the wrapper takes a stacking context
and draws the sheen as its `::after`, so picking a card up puts nothing into the page.

The layout box never changes, because the whole lift is one transform. That is what stops the pointer
falling off a card that grew underneath it, stops the grid reflowing, and lets a card settle the
instant the pointer leaves — crossing a grid quickly leaves no trail of half-animated cards. The lean
is measured against the card's *laid-out* box (`offsetLeft`/`offsetWidth`), never
`getBoundingClientRect()`: a lean computed from an already-leaning box feeds back on itself and the
card drifts under a pointer that has stopped moving.

**The switch divides the treatment rather than switching it off.** `.card-held` is the card being
reached for and takes the deeper shadow, which is a state and not a movement, so it survives "Cards
move" being unticked. That mark is made from the pointer handler rather than by `:hover`, which is
what keeps it off a touchscreen — a hover state there outlives the finger that caused it, and CSS
cannot be asked what kind of pointer is on the card. A touch pointer never lifts anything.

### 5–7 · Stacks, sizing, and the stack view

**`js/cardstack.js` is handed cards and hands back markup**, knowing nothing about categories, decks
or sort fields — which is what let the browsing tabs call it. It carries two decisions, both pure
functions asserted through the vm seam: `stackLayers()` from the count and `stackJitter()` from the
card's name.

Thickness is `min(cap, cards − 1, 2·log₂ cards)`. All three terms are non-decreasing, so adding a
card can never make a pile look thinner; the cap is the cost ceiling and `cards − 1` is what stops a
pair being drawn as a brick. Four cards draw three edges and thirty draw ten. The edges are empty
divs rather than more card images: a pile of ten costs ten divs and no extra fetches. The face card
is left an ordinary `.card-img`, so the top card of a pile is the one your hand reaches and it lifts
off the stack it is lying on.

The angles are stable — derived from the card's name, so the same card sits at the same angle on
every render. A mat that visibly reshuffles itself every time a quantity changes is worse than a tidy
one. A fanned card keeps the angle its edge had while the stack was settled, so fanning spreads the
pile that was lying there rather than a tidier one.

**The size control became a shared component.** `mountSizeControl()` sits beside the sort control and
the columns menu in `sortui.js`, because that is what this preference is: how a view is drawn,
remembered per view. The Deck Builder's private slider, its `dbScale` key and its `--db-card-width`
are gone; that tab is now the fourth caller of the component it used to be the sole owner of, and one
`--card-width` is what the grids, the piles and the stacks all read. The store is keyed on tab *and*
view, which is what stops scanning a collection at thumbnails from shrinking the view you keep for
reading a card.

**XL was deleted.** It was this question answered once, at 220px, and nailed to a button; a slider
running 80–300 says that and everything between. Four near-identical renderers and `.sf-grid-xl` went
with it, a browser left in the XL view comes back in the grid, and the sizes stored against `*:xl`
are pruned from the store.

**The stack view groups by whatever the tab is sorted by.** Both browsing tabs already share one sort
vocabulary through the shared sort control, so the view needs no second control and no new stored
setting: sort by rarity and a collection becomes four stacks of visibly different heights, sort by
mana value and it becomes your curve standing up off the table, sort by name and it buckets on the
initial letter. `groupLabel()` is one `switch` on the field the tab is already sorted by;
`cardGroups()` collects a sorted list into piles in the order the labels first appear — so reversing
the sort turns the row of stacks around without being asked.

Two fields are bucketed rather than grouped — price into the four bands a binder is sorted into,
collector number into hundreds — because both are unique per card, and grouping on the value itself
would draw four hundred stacks of one, which is a grid with worse spacing. Everything the app has not
been told is one pile labelled `—`, not one pile each.

Two decisions the ticket did not name had to be made, because its criteria could not be met without
them:

- **A pile in a table is drawn as a share of the tallest pile, not as thick as it is.**
  `stackLayers()` draws its difference across four cards to forty, the range a deck's categories
  occupy — and *every* pile on a browsing tab is past the cap. A collection stacked by rarity was four
  identical bricks and its curve was a flat row, which is the acceptance criterion inverted.
  `pileLayers()` is that share, still bounded by `stackLayers()`. The Deck Builder is untouched: its
  mat asks the absolute question and gets the absolute answer.
- **A fanned pile spreads at most sixty cards.** A settled stack costs the same whatever it holds, but
  a fan is real cards, and Collections hands this view its whole twelve thousand. The fan says
  `60 of 4,214` where it is not the whole pile.

### 8–10 · Things move because something moved them

**The mat animates its own re-renders.** `js/cardmove.js` records every card's position before the
rebuild and again after, and every card that ended up somewhere new travels there. So a sort, a move,
a removal — any re-render — animates, rather than only a drag. Cards are matched across renders by
name. What is animated is not what the mat holds but what can be *seen* of it: a journey that begins
and ends off the screen is not drawn, so a deck of four hundred cards animates at the price of a
screenful and a deck of four thousand at the same price.

**Dragging was rebuilt on pointer events, and the card itself is what is carried.** Not a copy of it
and not the browser's translucent screenshot of a whole tile, footer and all: the element the card
already is, translated under the pointer and left in its own place in the layout — so the mat does not
close up around a hole, and the card that lands is the card that was picked up.

That is also what makes the landing free. A carried card *is* where the hand is, because the transform
that put it there is part of what `getBoundingClientRect()` measures — so the drop needs no animation
of its own. The mat is told to move the card and the journey from the hand to the new pile is the
journey `cardmove.js` was going to draw anyway. What the drop adds is the last of it: `.card-landed`
gives that one card a timing function that goes a fraction past the mark and back, while every other
card the drop moved eases into place around it.

**The markup contract is two attributes**, each saying what a thing *is* rather than what to do about
it: `data-carry` is a thing that can be picked up and its value is a card's name; `data-drop` is a
place something can be put down and its value is a category. `js/carddrag.js` knows nothing else about
the mat. What a card released on a pile *means*, it asks `cardCarryDrop()`, which the Deck Builder
defines. The move itself is `dbMoveCardsTo()`, which the "Move to…" modal and the bulk bar also call,
so a card moved by hand and a card moved from a list are one piece of code and one autosave.

**Dragging is for pointing devices.** A touch pointer never begins a drag, so scrolling the mat with a
finger stays instant and unambiguous, and "Move to…" remains the way to recategorise on a phone —
which is exactly the previous behaviour, since browser drag-and-drop has never worked on touch. No
press-and-hold gesture was introduced, deliberately: it would put a delay between a finger and the
deck list. A stylus is a pointing device and drags like a mouse.

**A handful is the cards themselves, again.** Dragging a card that is part of the selection carries
the whole selection as a fan — not a badge and not a picture of a fan, but every selected card lifted
out of wherever on the mat it was lying and gathered to the hand. The gathering was free: ticket 09
gave a carried card an `at` and a `to` and closed a fraction of the gap each frame, and a handful is
that arithmetic once per card. Nothing was added to make twenty cards fly in from across the mat.

Dragging a card that is *not* selected carries that card alone and leaves the selection untouched —
picking up one card is never a way to accidentally move twenty.

Five decisions are written as functions of their inputs, all asserted through the vm seam:
`cardCarryStep()` (where a card following the pointer has got to), `cardCarryLean()` (how far it
leans), `cardCarryTarget()` (which pile would receive it), `cardCarryFan()` (where each card lies in
the handful) and `cardCarryAim()` (how far each has to move to be there). The lean is the lift's
derivation reused, so there is one number in the app for how far a card may lean, in the hand or under
the pointer. The fan's spread is the *whole* fan rather than the step between two cards, so a hand
holds what it holds: twenty cards are the same handful as three, only packed tighter. It is a fraction
of the narrow way across the thing being carried, because in the list view a card is a row as wide as
the mat — so a handful of rows is a stack of papers and a handful of cards is a fan.

**Where a handful came from.** A drop is refused on the pile a card is already in, and `from` is what
that is written against. A handful gathered out of several piles came from nowhere in particular, so
`from` is the pile they *all* came from, and nothing when they differ. A handful holding a card the
mat is not drawing has no home either, read the other way: that card may be lying anywhere, so the
pile the hand reached into is a real move and is offered.

**A selection carried somewhere is a selection spent**, the way the bulk bar's move spends it. It is
cleared before the move, so the render that draws the cards in their new pile draws them unselected —
and put back if nothing moved, which costs no render because nothing was drawn in between.

### 11 · What can be done to a card

Not from the spec: from using it. The ⓘ on a grid tile was unreachable — pointing at a card lifts it,
and the lift draws the picture over the furniture lying on it, so the one button you had to point at
to press was the one that pointing hid.

**So the actions came off the card and became a question.** What is *on* a card is what a card has —
its name, its price, how many you own, how many are in the hand carrying it. What can be *done* to it
is asked by right-clicking, or by holding a finger on it, and answered by the same `.col-menu` the
rest of the app opens, placed at a point instead of under the control that opened it, because there
is no control: the card is the control. Grid tiles and pile cards now carry no buttons at all. List
rows keep theirs.

Which card is asked of the mat rather than of a new attribute. `cardmove.js` already names everything
on the mat `data-moves="kind:name"` so it can be recognised across a rebuild, so `_dbCardAt()` reads
the identity the mat already publishes and the markup gained nothing.

`dbMenuPlacement()` is the one decision written as a function of its inputs. A menu asked for near the
bottom opens *upwards from the point* rather than being clamped to the edge, because clamping puts the
items under the hand that asked for them. A menu bigger than the window has nowhere to flip to and
goes in the corner, which is the one place it can be. The items are written each time rather than
shown and hidden, because what can be done to a card depends on whose deck it is: anybody may look a
card up, only the owner may move or remove one.

---

## What was found by using it

Six things the tickets did not predict, each found by driving the real app rather than by reading it:

**`fetchCardCollection()` was silently losing cards.** The local endpoint answers the first five
hundred names and says nothing about the rest — neither as cards nor as `not_found` — so a caller
asking for eight hundred took the silence for "no such card" and marked three hundred of them
permanently unresolved. That is **4,762 of a 12,788-card collection**, and it was the difference
between a rarity stacking with four piles and one with five. A pre-existing bug in a shared helper,
visible all along as `—` in the list view's rarity column; the stack view is only what made it
obvious. It now asks in batches of five hundred.

**A list thumbnail whose artwork failed to load was a 0-height touch target.** Caught by
`measure:mobile` while checking the card treatment; it is 58×81 regardless now.

**A carried card was being pulled back down into the pile it came out of.** `.card-fan > :hover`
raises the card being pointed at, and the pointer is on the carried card too — so in a fanned pile the
fan's rule, later in the stylesheet and of equal weight, beat `.card-carried` and a card in hand drew
at the level of a card merely being pointed at. The fan's rule now says `:hover:not(.card-carried)`: a
card in hand is a level of its own, and a higher one.

**A card dropped on a settled stack had nowhere to land.** A settled pile draws no cards — it is one
stack standing for a whole category — so the card vanished out of the hand and a number under a stack
went up. Dropping now spreads the pile the card was put into, which gives the card somewhere to land
and answers the question the drop asks: where did it go?

**The context menu was opening as wide as the window.** `.col-menu` pins itself to `right: 0` under
the control that opened it; with a `left` set and `right: 0` still in force, that is a box stretched
from the point to the window's edge, and the placement arithmetic was being handed a 1424px width to
flip. Only visible if you measure the menu rather than look at it, because its background is dark on
dark and its items are left-aligned.

**A card in a fanned pile is not where it was measured.** Not a bug — a note for whoever drives this
next. Hovering a card in a spread pile lifts it, which moves it out from under the pointer, so a press
aimed at a card's box can land on the card beneath. The harness hovers, waits, and asks the page what
is actually under the pointer before pressing. A hand does this without thinking.

---

## Where the build departed from the plan

Each of these was a deliberate reversal during implementation, and the reason is worth keeping:

- **A quantity change does not animate, and the ticket was wrong to promise it.** A quantity is drawn
  as a `×N` badge and a settled stack's thickness is a transform, so neither is layout and nothing has
  a new position to travel to. The pile closing up is what *removing* a card does, and that animates —
  41 cards, measured. A category rename is the same story. Making a quantity change move cards would
  mean making stack thickness affect layout, which would have piles shoving their neighbours around
  every time a number changed. The mechanism animates whatever moved; in those two cases nothing did.
- **Collections' strip loses the word "Size".** The stack view's button was the width that broke it —
  the strip fitted at two views and wrapped to two rows at three, and the fold that tab is measured on
  went from 102px to 149px against a 105px budget. That strip carries more controls than any other in
  the least room, since the deck column takes the right-hand third of the window the fold is measured
  in. The label goes at every width, the way every strip loses it on a phone and for the same reason;
  the slider keeps its tooltip and its accessible name, and the other tabs keep the label.
- **Want Lists and the removal of XL were done immediately after ticket 06 rather than in it**, at the
  owner's request. Both are recorded in §5–7 above.
- **The buttons were removed rather than re-layered.** `.card-lift-host` is `z-index: 3` and
  `.db-tile-info-wrap` was `z-index: 2`; move and remove had already been given `z-index: 11` to
  escape it and the ⓘ never was. Removing the buttons is what the answer turned out to be, so the
  number is gone rather than raised.

---

## What this cost, and what it did not

- **Keyboard, on two views.** A grid tile or a pile card has no focusable control on it now, so
  inspect / move / remove are not reachable by keyboard there. They are in the list view, which keeps
  its buttons, and "Move to…" is also on the bulk bar for a selection. The mat deserves a proper
  keyboard path; this work did not have one.
- **The context menu acts on the card it was opened on**, even when that card is part of a selection —
  which is what the buttons it replaces did. A menu saying "Move 3 cards…" would be a reasonable thing
  to want, and the bulk bar is the place that already says it.
- **The browser's own menu is refused only over a card.** Everywhere else on the page — a name to
  copy, an image to save — it is still the browser's to offer.
- **A fanned category is much taller than its settled neighbours**, so the mat's flex-wrap pushes the
  stacks after it onto a row below. Likewise a row of stacks wider than the pane wraps: a nine-pile
  curve at 150px cards runs onto a second row on a 1440px window. The size control is how a row is
  made to fit. Stacks changed how a pile is drawn, not how the mat is arranged.
- **Want Lists and Scryfall Search draw cards and have no stack view.** Neither was in scope; each is
  one call away.
- **Dropping a card on empty mat space does not create a category.** `docs/design/ui.md` §2 asks for it and no
  ticket in this set carried it, so it was not built. The pieces are in place — `data-drop` is how a
  place says it can receive a card, and "Move to…" already creates a category and moves into it in one
  step — so it is a drop zone on the mat and a call to code that exists. Piles and categories are
  already one piece of state, which is the part of that clause the brief cared most about.
- **`button.pile-toggle` on the Deck Builder at 390px.** The arrow that spreads a pile has a 44×44 pad
  drawn as its `::after`; the pad reaches under the category name beside it, and the name — painted
  later, being the next element along — takes the taps. Giving the pad a `z-index` moves the failure
  rather than fixing it: the name is itself a control and is then the one measuring under 44px. Both
  cannot have 44px in a header where the name's box is about 45px wide, so the fix is a phone layout
  change to the mat's section header. It reproduced during ticket 09 and did not during ticket 10;
  recorded rather than claimed either way.
- **One "Save failed ✗", seen once and not reproduced.** A harness run removing cards in three views
  in quick succession. A clean sequence saves fine, and the app has a rate limiter in front of it,
  which is the likeliest explanation. Recorded rather than claimed fixed, since it was not chased down.

---

## How it is kept

Five checks, all runnable locally, all green on the final commit:

```
npm test                # 276 tests across 15 files, up from 125 across 7
npm run lint:tokens     # the token contract, motion rule included, over the delivered CSS
npm run check:contrast  # every text/surface pair, in all five themes
npm run measure:layout  # chrome, content width, grid width, fold, prose measure
npm run measure:mobile  # hit-tests every control at 390px
npm run capture-screens # 110 views for human review
```

Eight of the fifteen test files are this work's: `motion`, `cardlift`, `cardstack`, `cardgroups`,
`cardsize`, `cardmove`, `carddrag` and `cardmenu`. They use a third seam beside the two the redesign
established. The **HTTP seam** carries the preference, because that is request/response behaviour. The
**static seam** — the token linter — carries the reduced-motion contract, because it is a property of
the delivered stylesheet. The **vm seam** is new: the shipped browser file is loaded into a `vm`
context and its pure decisions are called directly, so `stackLayers()`, `stackJitter()`, `cardTilt()`,
`cardGroups()`, `cardCarryTarget()`, `cardCarryFan()`, `cardCarryAim()` and `dbMenuPlacement()` are
asserted at their boundaries rather than eyeballed through a browser.

That is the pattern worth keeping: **every decision this work makes about where something goes is a
pure function of its inputs, exported from the file that ships.** Nothing is asserted about markup —
this work churned markup deliberately — and nothing is asserted about which function called which.

What the seams cannot see was driven in headless Firefox over WebDriver BiDi, with a real pointer,
against a copy of the live database, in all three views and with cards' motion both on and off. Those
runs are what the tables in the retired tickets recorded and what the "found by using it" section
above came out of. They are not automated; there is no browser in `npm test` by design.

`capture-screens` and `measure-*` need a populated database — pass
`--data .scratch/ui-redesign/capture-data/available.db`, and always use a copy, since the app writes
to whatever database it is given.
