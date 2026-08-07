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

**Status:** ready-for-agent

- [ ] One press hides every control; the readout line remains
- [ ] A second press hides the readout too, leaving only cards and a way back
- [ ] Both states persist per view and survive a reload
- [ ] Carrying a card near the top of the mat never reveals hidden chrome
- [ ] The ghost pile is visible at rest, lights while a card is carried, and turns a dropped card into a named category
- [ ] Dropping a carried card on empty mat still cancels and changes nothing
- [ ] A carried selection dropped on the ghost pile moves the whole selection into the new category
- [ ] The new category persists, and appears in the Move to… list afterwards
- [ ] Every control that hides is reachable again without a mouse
- [ ] Works in all five themes; below 900px every control still meets the touch-target rule
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
