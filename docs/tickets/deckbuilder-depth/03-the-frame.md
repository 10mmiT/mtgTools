# 03 — The frame: chrome that folds, and a pile that isn't there yet

**What to build:** two changes to what the mat *is*, so that everything the rest of this effort adds
has somewhere to go. They ship together because they are the same argument — the cards are the
content, and the tab should be able to say so.

**The toolbar folds away, in two tiers.** Everything you act *with* — view toggle, size slider,
sort, filter, the More menu, and the board and scope controls later tickets add — hides on the
first press. Not a narrower toolbar; gone. What stays is one thin line of what the deck *is*: its
count, and later its legality, bracket, price and ownership. That line is the half you want while
building rather than in between. A second press hides that too, for a mat with nothing on it but
cards. Both states are remembered per view, the way sort and size already are, so a deck read at
full mat comes back at full mat. Analysis beyond that one line — the curve, and the panels later
tickets add — expands out of the toolbar and is never a permanent strip.

**A card dropped on the ghost pile makes a category.** A permanent empty outline sits after the
last category, faint at rest and lit while a card is being carried. Drop on it and it becomes a real
category with that card in it, named in place. Being permanent is the point: the affordance is
visible when your hands are empty, so it can be found rather than stumbled into. It lives on the
mat and never in the toolbar, because a drop target inside chrome that can be hidden is a drop
target that cannot be reached.

**Dropping on empty mat must go on meaning cancel.** Released anywhere loose, the carried cards
return and nothing changes — that safety is what makes carrying cards feel free, and this ticket
must not spend it. `ui.md` asked for empty-mat-creates-a-category; that is the rejected design, and
the spec records why.

From `spec-deckbuilder-depth.md` → First, the frame. Rejected there: reveal-on-hover near the top
edge (it would fire mid-carry), and floating the readout over the mat as an overlay.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] One press hides every control; the readout line remains
- [x] A second press hides the readout too, leaving only cards and a way back
- [x] Both states persist per view and survive a reload
- [x] Carrying a card near the top of the mat never reveals hidden chrome
- [x] The ghost pile is visible at rest, lights while a card is carried, and turns a dropped card into a named category
- [x] Dropping a carried card on empty mat still cancels and changes nothing
- [x] A carried selection dropped on the ghost pile moves the whole selection into the new category
- [x] The new category persists, and appears in the Move to… list afterwards
- [x] Every control that hides is reachable again without a mouse
- [x] Works in all five themes; below 900px every control this ticket adds meets the touch-target rule
- [x] `npm test`, `npm run lint:tokens` and `npm run check:contrast` are green. `npm run measure:mobile` reports the same fifteen `pile-toggle` findings ticket 12 owns, and no new ones — see *What was left*

## What was built

### The fold: one attribute, three states, one button

`DB_FOLDS = ['full', 'readout', 'bare']` in `deckview-core.js`, written onto the pane as
`data-db-fold` and hidden by `tabs.css`. A ring rather than a pair of toggles: the third
press brings everything back, which is what makes **one** button enough and means nothing
is ever more than one press from being reachable. The button is the only thing on the
strip that never hides — a mat with no way out of it is a mat you have to reload the page
to leave — and `f` does the same thing from the keyboard.

**The tiers are drawn by the stylesheet, not by a dozen `style.display` writes**, for the
reason `[data-db-mode]` already is one attribute: two tiers spread across a dozen calls
are two tiers that will disagree the first time something is added to the strip.

Three decisions the ticket did not settle:

- **The bulk bar and the add-category row fold with the controls.** The spec's own list of
  what the tab spends screen on names the bulk-action bar, and it is the strongest
  offender against "nothing on the mat but cards" because it appears unbidden. A folded
  mat can still move a selection: right-click is what a card's actions are asked for with.
- **The save status folds with the *readout*, not with the controls.** It says what the
  deck's data is doing rather than offering to do something, which is the line the two
  tiers are drawn on.
- **Folding does nothing until a deck is loaded.** The rules are gated on
  `[data-db-mode="deck"]` — folded with no deck, the deck picker would be hidden, and the
  picker is the one control that gets you a deck. The preference is kept and simply does
  not apply to an empty tab.

The state is stored by `getChromeFold()` / `saveChromeFold()` in `sortui.js`, beside the
sort, the columns and the card size, in the same `{ view: value }` shape under
`mtgtools_fold`. It is written as the press happens rather than on the way out, so a
browser closed a moment later comes back folded. A stored value that is not one of the
three names is no fold at all — `localStorage` is a string store shared with older
versions of this app and with whatever anyone types into a console.

**Nothing is revealed by pointing at it.** There is no hover rule anywhere near
`data-db-fold`, and a test asserts there is not: the mat is a drag surface, and a card
carried towards a category high on the screen would trip a reveal every time.

### The curve came off the readout

The ticket asks for one thin line of what the deck *is*, and *"analysis beyond that one
line expands out of the toolbar and is never a permanent strip"*. So `#dbCurve` moved out
of `#dbStatsBar` into `#dbAnalysis`, expanded by a **Curve** button on the strip. It is
where the panels proposals 9, 10 and 11 add will go.

It is the phone that gains most: the curve was `display:none` below 900px, because a
permanent strip had nowhere to put it. Opt-in, it fits.

The panel's open state is deliberately **not** stored. A panel you opened to look at
something is not a preference — it is inside the tier that folds away with the rest of the
controls, and the collapsed categories on this same mat are not stored either.

### The ghost pile is the pile with no name on it yet

`data-drop`'s value is *where the cards would go*. The ghost's is the **empty string**,
because the category it stands for does not exist until something lands on it — and that
is also what makes it safe to tell apart from a real pile, since a category name is
trimmed and non-empty everywhere one is made. No sentinel, no second attribute, and
`js/carddrag.js` needed no change at all.

**The pile is real before it is named.** `_dbDropOnGhost()` makes the category with a
placeholder name, moves the cards through the same `dbMoveCardsTo()` every other move goes
through, and leaves a name box open in the heading. A category with a placeholder name is
a category; a category with *no* name yet would be a state the save, the Move to… list,
the sort and the group-by would all have to know about. Typing over it is then an ordinary
rename — `_dbRenameCategory()`, extracted from the rename modal so both ways in are one
change to the deck.

Escape, an empty box, or a name another pile already answers to all leave the placeholder
standing. **The cards have already landed either way** — cancelling a name is not
cancelling the drop — and the "that name is taken" conversation belongs in the ⋯ menu's
Rename rather than in an alert over a box you are typing in.

A drop that moves nothing takes the category back with it. Otherwise a fumbled drop leaves
an empty pile on the mat with a name box open in it, which is worse than the drop that
failed.

**It is not a button.** A click on it would have to make an *empty* category, and an empty
category is not drawn — a press with nothing to show for it. The New category field below
the mat is the keyboard and finger route, and it always was.

**Dropping on empty mat still means cancel**, untouched: the mat carries no `data-drop` of
its own, so a point on it belongs to no zone. `ui.md`'s empty-mat-creates-a-category is the
rejected design and a test says so by counting the drop targets the mat writes.

## How it was checked

`test/deckframe.test.js` — 26 tests over the shipped files in a `vm` sandbox, the way
`test/carddrag.test.js` runs the carry: the fold ring and its store, the two tiers as CSS
rules that must exist and must not, and the ghost drop through the real panel and edit
modules.

Then the real app in headless Firefox, driven with `scripts/capture-screens.js`'s own
plumbing against a snapshot of the live database, because a `vm` sandbox cannot catch
wiring that only exists in the page. It confirmed the fold cycling and surviving a reload,
the curve's eight bars expanding out of the strip, a card carried onto the mat's edge
changing nothing, and a card carried onto the ghost pile making a pile, focusing its name
box, and turning up in the Move to… list under the name typed into it.

## What was left

`npm run measure:mobile` still fails on the **deckview** tab with the same fifteen
`button.pile-toggle` findings ticket 02 recorded, at the same widths. Nothing here added a
finding: the fold button hit-tests **47×44** at 390px, the Curve button **75×44**, and the
ghost pile is 328px wide inside a 390px window.

It now has a ticket of its own — **12 — Two 44px pads in an eight-pixel gap** — which is
where the diagnosis and the fix belong. Measuring it from this side agreed with it
independently: the toggle's pad is exactly 44px wide and is not covered by the heading
*text* but by the heading's own pad, `.dv-section-title.db-collapsible` being given a pad
by the same phone block and winning the hit test where the two overlap.

One thing this ticket can hand over. The mat now draws a **second** padded thing on a row
of its own — the ghost pile — and it is deliberately **not** a control: it carries no
`onclick`, so it neither wants a 44px target nor contests anybody else's.

**Since fixed.** Ticket 12 is done: the heading is one target, both pads are gone, and
`npm run measure:mobile` reports deckview — and every other view — clean.
