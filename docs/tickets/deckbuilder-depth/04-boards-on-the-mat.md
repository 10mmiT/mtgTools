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

**Status:** done

- [x] A card can be carried into the maybeboard or sideboard and back, and it stays there across a reload
- [x] The same card can be in the maybeboard and the mainboard at once, with independent quantities
- [x] The card count, curve, average mana value and export all ignore non-main boards
- [x] Non-main boards draw as one flat spread pile with a count, and no category headers
- [x] A card promoted from a board into the mainboard arrives in the category it was carrying
- [x] Boards are off by default, toggle from the toolbar, and the choice is remembered per deck
- [x] A hidden board appears while a card is being carried and hides again afterwards
- [x] Existing decks are unaffected by the migration — every card is in the mainboard and nothing moved
- [x] Adding a further board later needs no schema change
- [x] Works in all five themes; below 900px the board region and its toggle meet the touch-target rule
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

## What was built

### A card's place in a deck is two things now, and one of them is coarse

`deck_cards` gained a `board`, defaulting to `'main'`, and the primary key
widened to `(deck_id, board, card_name)` — a table copy rather than an `ALTER`,
because SQLite cannot alter a key in place and the key is the whole point: the
old one said a card is in a deck once, and a maybeboard is the case where it is
in it twice. The migration is guarded by the column rather than by a version
number, so opening a database that already has it is a no-op, and it runs inside
one transaction, so a process that dies halfway still has its old table. Every
existing row becomes `'main'`: a card in a deck was a card in the deck.

`board` is `TEXT` with **no `CHECK`**, and the server validates nothing — it
fills in `'main'` for a row that names none and stores whatever else arrives.
That is what "the set of boards stays open" means in practice, and a test writes
a row on a board called `considering` to say so.

### The set of boards is one list, in one new file

`public/js/deckview-boards.js` holds `DB_BOARDS` and nothing else that changes:
no state of its own, so the modules that move cards can be loaded and asserted
without a mat to draw them on. Adding a board is an entry in that list —
the toggle, the region, the drop target, the Move to… entry and the reveal are
all written over it, and none of them names a board.

`Commander` is deliberately **not** in the list yet. Ticket 05 adds it, and
adding it is exactly the one-value change this file exists to make possible.

### Two strings, one grammar: `board`, then the thing on it

The change the rest of the tab pays for is that **a card's identity within a
deck is no longer its name**. So there are two strings, both split at the
*first* slash:

| | |
|---|---|
| a card's **ref** | `main/Sol Ring`, `maybe/Sol Ring` — two cards, two quantities |
| a **place** | `main/Lands` a pile · `main/` the ghost · `maybe` a whole board |

**A place with no slash in it is a whole board.** That is what tells the two
apart without a sentinel, and it is why the ghost pile could keep the empty
category ticket 03 gave it. The split is at the first slash because card names
have slashes in them — `Fire // Ice` — and so may a category.

`data-carry` and `data-moves` carry refs, `data-drop` carries places, and
`js/carddrag.js` reads neither: its header now says the value of both belongs to
the tab that drew them. Every name-keyed thing on the mat became ref-keyed —
the selection, the card menu, the row buttons, the quantity steppers, the Move
to… modal, the landing flourish.

### Three decisions the ticket did not settle

- **A move onto a board that already holds the card is a merge.** Two rows of
  one card on one board is a deck claiming to hold it twice, which the key will
  not allow — so the row that arrives is spent into the row that was there, and
  the copies add up. It is the only way a carry can produce a save the database
  would refuse, so it is handled where the card is put down rather than at the
  save.
- **The boards are at the head of the Move to… list.** A board is meant to be
  worked with the carry, and on a phone there is no carry: a finger scrolls the
  mat, by design. A maybeboard reachable only by dragging is a maybeboard half
  the app cannot use. Choosing a board keeps the card's category — which makes
  *Mainboard* the promote — and choosing a category says which pile, which is
  the same question from the other side and why they are one list.
- **A deleted category is cleared from every board, not just the mainboard.**
  Otherwise a card set aside goes on carrying a name no pile answers to, and
  brings the deleted category back with it the moment it is promoted.

### The reveal cost one line in the carry

A hidden board is drawn into the mat and hidden by the stylesheet, so revealing
it is a rule off `.card-carrying` rather than a re-render — the mat cannot be
rebuilt while cards are in hand. But `beginCarry()` measured the drop zones
*before* it said a card was in hand, so the board would have been measured while
still `display:none` — a box of no size that nothing can be dropped on. The
class is now added first. That is the whole change to `js/carddrag.js`, and a
test asserts the order.

### What the deck says about itself

The count, the lands, the average mana value, the pips, the curve, both exports,
Compare, the search panel's "already in deck" ✓ and EDHREC's "not in the deck
yet" all read `dbMainCards()`. So does the History panel's size — a row saying
*104 cards* for a deck of 99 and five maybes would be describing something
nobody is building. What is in the other boards is still snapshotted, still
diffed and still restored; it is simply not what "how big" means.

The snapshot diff is keyed by board and name for the same reason the deck is: a
card moved between boards reads as one leaving and one arriving, which is what
it is, and each entry carries the board so the panel can say which.

## How it was checked

`test/deckboards.test.js` — 36 tests in three layers. The migration is asserted
against a database built in the *old* shape and opened by `available-db.js`
itself. The mat is the shipped modules in a `vm` sandbox, loaded whole —
`sortui`, `cardstack`, and all five `deckview-*` files — with state seeded by
assignment rather than through the sandbox, because `deckview-core.js` declares
the deck with `let` and a sandbox property of the same name would be shadowed by
it. The frame is the stylesheet and the markup read as text. `server.test.js`
gained nine tests over the round-trip: two rows sharing a name, an unknown board
value, add and delete keyed by board.

Then the real app in headless Firefox against a snapshot of the live database,
because a `vm` sandbox cannot catch wiring that only exists in the page. It
confirmed the toggles mounting onto the strip off `DB_BOARDS`, a hidden board
measuring zero at rest and non-zero the moment `.card-carrying` lands, a card
carried out of a 116-card deck onto the maybeboard, the deck's count not moving
when it did, and — after a full reload — the card still in the maybeboard, the
board still showing, and promoting it landing it back in `Draw`, the pile it had
been carrying. A second pass at 390px switched a board on in all three views:
no sideways scroll, and every toggle at least 44×44.

## What was left

**A card crossing boards lands rather than travels.** `js/cardmove.js`
recognises a card across a rebuild by its `data-moves`, which is now its ref —
so a card that changes board changes identity on the mat and has no "before" box
to travel from. It still arrives with the landing flourish, because the landed
set is built from where the cards are *going* rather than where they were
carried from. Giving it the full journey would mean keying the animation by name
and teaching it that two elements can share one, which is the trade this ticket
declined.

**The Archidekt import stopped throwing cards away.** It skipped anything in a
sideboard or maybeboard category, because there was nowhere in a deck to put a
card that is not in it. There is now, so those cards arrive on the board they
were already on, carrying their category.
