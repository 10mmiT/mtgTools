# 04 — Boards: a maybeboard and a sideboard on the mat

**What to build:** somewhere to put a card that is not in the deck. Today a card you are considering
either goes in and breaks the count, or lives in your head.

A card in a deck gains a **board** — mainboard, maybeboard, sideboard, and a commander board that
ticket 05 uses. The same card can sit in the maybeboard while a copy is in the deck, so the card's
identity within a deck is no longer its name alone. The count, the curve, the export and the
legality check all read the mainboard only.

**Non-main boards render flat** — one spread pile with a count, no category headers. A maybeboard is
a holding area, not a second deck, and giving it ten headers to scroll past defeats the point of
having somewhere to put things. Each card keeps its category as it sits there, so one promoted into
the mainboard lands where it belongs instead of arriving uncategorised.

A board is another region of the mat, worked with the carry that already exists — not a modal, not a
second tab. Boards are **hidden by default and toggled from the toolbar**, remembered per deck, and
a hidden board **reveals while a card is being carried**, so a board you toggled off is still
somewhere you can put something.

The set of boards must stay open — a format that wants another one later should cost a new value and
not a migration.

From `spec-deckbuilder-depth.md` → proposal 2. Rejected there: a separate table per board, and
giving every board its own categories.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A card can be carried into the maybeboard or sideboard and back, and it stays there across a reload
- [ ] The same card can be in the maybeboard and the mainboard at once, with independent quantities
- [ ] The card count, curve, average mana value and export all ignore non-main boards
- [ ] Non-main boards draw as one flat spread pile with a count, and no category headers
- [ ] A card promoted from a board into the mainboard arrives in the category it was carrying
- [ ] Boards are off by default, toggle from the toolbar, and the choice is remembered per deck
- [ ] A hidden board appears while a card is being carried and hides again afterwards
- [ ] Existing decks are unaffected by the migration — every card is in the mainboard and nothing moved
- [ ] Adding a further board later needs no schema change
- [ ] Works in all five themes; below 900px the board region and its toggle meet the touch-target rule
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
