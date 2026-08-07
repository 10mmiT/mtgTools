# 05 — The commander is a board

**What to build:** the commander stops being a category holding one card and becomes a board of its
own, drawn at the head of the mat.

Today a Commander deck spends a full category header, a pile and a row of mat saying something the
deck already knows — the commander is set when the deck is created, the count already excludes it,
the recommendations panel already keys off it, and the deck's colour identity comes from it. That
cost is paid by nearly every deck in the app to display one card that never moves and never sorts.

Once boards exist the commander is simply one of them, which is how Moxfield models it, and three
things fall out for free. **Partners, Backgrounds and Doctor's Companions work** — two commanders
are two cards in that board, so nothing has to be decided about the single-string commander field on
the deck record, which goes on doing its real job of naming the tile art and the recommendations
lookup. **Showing and hiding it** is the board control from ticket 04. And **the migration is one
statement**, turning the existing Commander category into the board, with `Commander` coming out of
the default category list.

A deck that has cards in the old category but no commander named on its record adopts the first as
its commander, rather than losing it.

The commander board is where the things genuinely *about* the commander belong later: the deck's
colour identity, the bracket, and the check that a card outside the identity has snuck in.

From `spec-deckbuilder-depth.md` → First, the frame → "The commander is a board, not a zone".
Rejected there: special-casing the category's rendering, and making the commander field an array.

**Blocked by:** 04 — Boards: a maybeboard and a sideboard on the mat.

**Status:** ready-for-agent

- [ ] The commander draws at the head of the mat and not as a category
- [ ] A deck with two commanders shows both, and neither is in a category
- [ ] `Commander` is gone from the default categories for new decks
- [ ] Existing decks migrate: the card that was in the Commander category is in the commander board, and the category is gone
- [ ] A deck with a Commander category but no commander on its record ends up with one, not with a lost card
- [ ] The commander is still excluded from the deck's card count, and still drives colour identity and the recommendations panel
- [ ] The commander board shows and hides from the toolbar like any other board
- [ ] A deck with no commander shows no commander board and is otherwise unchanged
- [ ] Sorting, grouping and bulk-moving the mainboard never touch the commander
- [ ] Works in all five themes and at every breakpoint
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
