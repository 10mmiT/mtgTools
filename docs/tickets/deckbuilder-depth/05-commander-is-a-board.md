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

**Status:** done

- [x] The commander draws at the head of the mat and not as a category
- [x] A deck with two commanders shows both, and neither is in a category
- [x] `Commander` is gone from the default categories for new decks
- [x] Existing decks migrate: the card that was in the Commander category is in the commander board, and the category is gone
- [x] A deck with a Commander category but no commander on its record ends up with one, not with a lost card
- [x] The commander is still excluded from the deck's card count, and still drives colour identity and the recommendations panel
- [x] The commander board shows and hides from the toolbar like any other board
- [x] A deck with no commander shows no commander board and is otherwise unchanged
- [x] Sorting, grouping and bulk-moving the mainboard never touch the commander
- [x] Works in all five themes and at every breakpoint
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

## What was built

### One value, and one flag on it

`DB_BOARDS` gained `{ id: 'commander', label: 'Commander', head: true }`, which
is the change ticket 04 built that file to make possible: the toggle, the
region on the mat, the drop target, the Move to… entry and the reveal are all
written over the list and none of them names a board, so they were already
written for this one.

`head` is the only thing about it that is new, and it means three things that
are one statement — *this board is the head of the deck rather than a holding
area beside it*:

- it is drawn **before** the deck's categories instead of after them;
- it is **on by default whenever it holds anything**, where a maybeboard stays
  off until it is asked for;
- a card landing on it **switches it on**, because a commander that vanished
  into a switched-off region would be a card thrown away.

A format that later wants a companion zone takes the same flag.

### Which boards are showing is stored as what differs from the default

`dbShownBoards` used to be remembered as a list of the boards that were *on*.
That cannot say "this deck's commander board is hidden" at all, and a board
that came back every time you closed it is not a board that hides.

So what is written to `mtgtools_boards` is now the boards that **differ from
their default**. Every entry written before this ticket goes on meaning exactly
what it meant — a maybeboard's default is off, so its name in the list still
reads as on — and the migration is that the same value is read the other way
round for a head board. `_dbLoadShownBoards()` is called after the deck's cards
arrive rather than before, because a head board's default asks whether it holds
anything.

The one place that needed care is a commander board switched on by hand while
empty and *then* filled: the default flips underneath the stored entry, which
would start reading as "hidden". `_dbRevealHeadBoard()` rewrites the preference
whenever a card lands, so it heals itself.

### The category's four jobs, reassigned

| what it did | who does it now |
|---|---|
| held the commander | the board |
| kept it out of the count | the board — `dbMainCards()` never sees it |
| `dbAutoCategory()` answering `'Commander'` for the named card | `dbAddCard()`, one level coarser: the board is chosen, then the pile |
| could not be renamed or deleted | nothing. `Commander` is an ordinary category name from now on |

The deck's readout says the rest of it. The commander is no longer subtracted
from the mainboard, because it is not in it — and the target is `100` minus
however many commanders the deck holds, so **partners are a deck of
ninety-eight** rather than a deck reading one over. A deck whose record names a
commander it holds no card for is still a Commander deck, at ninety-nine.

### Three things the ticket did not settle

- **Select-all leaves it alone.** `dbSelectAllVisible()` skips head boards even
  when they are showing. It is the first half of a bulk move, and a sweep over
  the deck that can file the commander under Lands has taken the one card the
  deck is built around. Moving it deliberately — its card menu, the Move to…
  list, carrying it — is untouched.
- **The commander is exported.** Both exports read the mainboard alone, which
  is ticket 04's rule and the right one; a Commander list without its commander
  is not a list anybody can play. So the commander board is the one board that
  is exported, at the head, under `// Commander` — and a list pasted back in
  reads that heading and puts it where it came from.
- **Archidekt's Commander is a board, not a category.** It was mapped into
  `_ARCH_CAT` and would have arrived as a pile. Two commanders import as two
  cards.

### The migration is two statements and a walk

`UPDATE deck_cards SET board = 'commander' WHERE category = 'Commander'`, and
`DELETE FROM deck_categories WHERE name = 'Commander'`. It is guarded by a
marker row in `app_state` rather than by looking for the category, because the
name is an ordinary one from now on and a migration that ran twice would take
it off whoever made one.

The walk is the deck records, which live in the `app_state` blob rather than in
a table: a deck holding the category but naming no commander adopts the first
of them, since the field still has two jobs afterwards — the tile art and the
EDHREC lookup — and an empty one does neither. `version` goes up with the
write, so a browser left open across the restart is told to refresh rather than
allowed to save the old records back over it.

Then one more pass, which the ticket did not ask for and the live data did.
**The count this replaces never read the category** — it subtracted the card
the deck record names, wherever in the deck it had been filed. One real deck
had its commander sitting in `Lands`, and would have silently gone from 116/99
to 117/99. So a deck whose commander board is still empty afterwards has the
record-named card taken out of the mainboard by that same old rule, one last
time. A deck that had *both* — the category naming one card and the record
another — keeps counting the one it was already counting.

## How it was checked

`test/deckcommander.test.js` — 37 tests in the three layers
`test/deckboards.test.js` uses. The migration runs against a database built in
the old shape, with five decks in it covering every case above, and is asserted
through `available-db.js` itself. The mat is the shipped modules in a `vm`
sandbox. The frame is the stylesheet read as text.

Then the real app in headless Firefox against a snapshot of the live database —
63 decks, 14 of them with a commander in the category — because a `vm` sandbox
cannot catch wiring that only exists in the page. The migration moved 14
commanders (including a split card, `Kuja, Genome Sorcerer // Trance Kuja, Fate
Defied`) and one loose one, deleted 29 categories, and left every deck's count
reading what it read before. In the page: the commander board at the head of
the mat above fourteen categories, `99/99 cards`, its toggle on the strip
reading `aria-pressed="true"`, hiding it from the toolbar and finding it still
hidden after a full reload, and a deck with no card for its commander drawing
the region hidden — nothing at the head of the mat, and the same count it had.
A pass at 390px found no sideways scroll and every target at least 44×44.

## What was left

**The colour identity check is still the record's.** The search panel's
`ci<=` injection reads `dbDeck.commander`, as it did. The ticket names the
identity, the bracket and the out-of-identity check as things that belong to
the commander board *later*; the board is where they will go, and nothing here
had to move for that to be true.
