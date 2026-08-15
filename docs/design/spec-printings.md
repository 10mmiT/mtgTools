# Spec — Which printing of a card the deck runs

A deck card is a name. The mat draws whichever printing Scryfall calls the card's default, the
price is that printing's price, and an exported list says `1 Sol Ring` and lets the other site
decide. This is the spec for letting the deck say *which* Sol Ring.

`spec-deckbuilder-depth.md` listed printings as the most expensive item on it and deferred it
with "the database decision is the whole of it". This document answers that decision by making
the feature smaller than the one that spec priced: it is about **the art on the mat, the price
of the deck, and an exported list that names real cards**. It is explicitly *not* about
ownership — collections stay keyed by name, and "105 of 122 the group owns" goes on meaning
exactly what it means today.

---

## What is being built

Right-click a card in your deck → **ⓘ Inspect** → the card detail's *Other Printings & Alt-Art*
gallery, which now knows it was opened from a deck you can edit. Pressing a tile makes that
printing the deck's: the mat draws that art, the deck's price counts that printing's price, and
an export names that set and collector number. The deck's current printing is ringed.

Opened from anywhere else — the Scryfall tab, a collection, a want list — the gallery behaves
exactly as it does today, and a press navigates to the printing.

## Decisions, and what each one beat

**One printing per card, not per copy.** A card in a deck is one row with one chosen printing,
however many copies it holds; ten Forests are ten of the same Forest. The alternative — five of
one art and five of another as separate entries — is what a real basic-land package looks like,
and it costs the primary key: `(deck_id, board, card_name)` would have to grow the printing, and
every path that finds a card by name (the carry, the filter, the legality pass, the 4-of rule,
dedupe on import, the comparison) would have to learn that a name is no longer unique. Not worth
it for basics. The schema below leaves the door open: the primary key does not change, so
extending it later is additive.

**The printing is snapshotted onto the deck row, not looked up.** When you choose one, the row
records the printing's id, set, collector number, image and price. The mat and the readout then
need nothing they do not already have.

The alternative was to store only the id and cache each chosen printing's live record
server-side, refreshed nightly beside the oracle cache. That keeps the price current; this does
not. **The consequence is stated rather than hidden: a chosen printing's price is the price on
the day you chose it.** The snapshot carries the date it was taken so the readout can say so and
so a later "refresh printings" pass has something to work from. The local cache is
`oracle_cards` — one row per card, no printings — and the cost of the alternative is a new
table, a batch endpoint and a nightly job, on a box in someone's house.

**A press on the tile is the choice.** Arriving from a deck changes what the gallery is *for*,
so the tile does the thing you came to do rather than growing a second control in its corner or
asking you to confirm. A mis-aimed press is undone by pressing the right one, and by the deck's
own history.

**Exports name a printing only where you chose one.** `1 Sol Ring (RAV) 266` for a card you
picked, `1 Arcane Signet` for one you never touched. An export then says exactly what you
decided and nothing you did not — and a deck nobody has touched exports byte-for-byte as it does
today, which is what keeps this from being a change to a feature people already rely on.

## The data

`deck_cards` gains one nullable column:

```sql
ALTER TABLE deck_cards ADD COLUMN printing TEXT;   -- trimmed JSON, or NULL
```

holding

```json
{ "id": "…scryfall uuid…", "set": "rav", "set_name": "Ravnica: City of Guilds",
  "collector_number": "266", "image": "https://cards.scryfall.io/normal/…",
  "price_eur": "4.50", "chosen_at": "2026-08-14" }
```

One column of trimmed JSON rather than six columns, because nothing on the server side ever
queries these fields — the export, the mat and the readout are all client-side, and the row is
carried whole. It is the shape `scryfall.db` already uses for a cached card, so it is the
familiar one here. `NULL` means what it has always meant: the card is a name, and the app picks
the printing.

The primary key does not change, so this is an `ALTER TABLE` guarded by `PRAGMA table_info`, in
the pattern `available-db.js` uses for `owner_player_id` — not the table copy the board column
needed. Every existing row gets `NULL` and nothing moves.

**`deck-history.js` must be changed with it.** Its snapshot selects an explicit column list
(`deck-history.js:87`); a new column that is not added there is a column every undo silently
drops. This is the one place where forgetting is quiet, so it is named here.

`routes/decks.js` carries the field through three of its four card paths:

- `GET …/cards` selects `printing` and hands it back parsed.
- `PUT …/cards` (the full replace the client saves through) writes `JSON.stringify` of it, or
  `NULL`.
- `POST …/cards/add` and `PATCH …/cards/:cardName` leave it alone: a card added by name has no
  printing, and quantity and category changes are not printing changes.

## The gallery

`loadPrints()` in `js/card.js` already fetches every printing through the proxy and draws the
tiles. Two things change.

**It knows who it is choosing for.** `openCardByName(name, forDeck)` takes an optional context —
`{ deckId, playerId, deckName, ref }` — which the deck's own Inspect entry supplies and every
other opener in the app does not, so opening a card from anywhere else clears it. The context is
checked again at the moment of the press, not trusted from when the gallery was drawn: the deck
must still be the open one and the card must still be in it, or the press does nothing.

**In that mode the tiles choose rather than navigate.** The section says which deck it is
choosing for, each tile carries its set, collector number and price, and the deck's printing is
ringed — the `.card-print-tile.current` class that already exists, pointed at a different fact.
A press writes the snapshot onto the deck's card, moves the ring, and lets the deck's ordinary
debounced save carry it to the server. The mat is redrawn behind the modal, so closing it shows
the new art with nothing further to press.

## The mat, the price and the export

**The art.** `_dbCardImg()` takes the card entry rather than its name and prefers
`card.printing.image`. Its callers are the pile tile and the settled stack; the grid tile and
the list row read `dbCardData` directly for the same picture and move onto the same helper, so
that "which picture is this card" is answered in one place for all four views.

**The price.** `_dbCardEur()` in `js/deckview-totals.js` prefers `card.printing.price_eur` and
falls back to the oracle card's, which means it takes the card entry rather than a name too. Its
"null is not nought" rule is untouched: a chosen printing with no Cardmarket price is unknown,
exactly as a default printing with none is. `renderPrice()` on the grid tile follows the same
preference.

**The export.** `_dbExportText()` writes `1 Sol Ring (RAV) 266` where a printing was chosen and
`1 Sol Ring` where none was. The CSV grows two columns — `qty,name,set,collector_number` — left
empty on rows with no chosen printing: a spreadsheet whose rows have different widths is worse
than one with blanks in it.

## Not in this

- **Ownership stays by name.** Choosing the Ravnica Sol Ring does not make the Commander 2021
  one you own stop counting.
- **Foils.** A separate flag on the same row, and a separate decision; nothing here forecloses
  it.
- **The mat does not mark which cards have a chosen printing.** The art is the mark.
- **The deck tile's art on Players & Decks** goes on coming from `commanderImg`, so choosing your
  commander's printing does not repaint the tile.
- **Imports set no printing.** The CSV, paste and Archidekt paths add cards by name as they do
  now, even where Archidekt's own data carries a printing.
- **Nothing refreshes a snapshot.** A "re-price the printings in this deck" pass is a later
  ticket; `chosen_at` is what it will read.

## How it is tested

Each layer against the shipped files, in the pattern the repo already uses:

- **The migration** — a database written in the old shape, opened by `available-db.js`, gains the
  column and loses nothing (`test/deckcommander.test.js` builds an old database this way).
- **The route** — `PUT` then `GET` returns the printing it was given, `POST /add` leaves it null,
  `PATCH` on quantity does not disturb it (`test/server.test.js`).
- **The history** — a snapshot taken over a deck with chosen printings restores them, which is
  the failure this spec expects to be made once (`test/deckhistory.test.js`).
- **The mat** — a card with a printing draws that image in all four views, and a card without one
  draws what it always drew (`test/deckboards.test.js`'s sandbox).
- **The price** — a chosen printing's price is what the deck totals, and an unpriced printing is
  unknown rather than free (`test/decktotals.test.js`).
- **The export** — the two line shapes, and the CSV's blank columns (`test/deckboards.test.js` or
  a new `test/deckexport.test.js`).
- **The gallery** — the deck context is used only when the deck is still open and the card is
  still in it, and a gallery opened without a context still navigates (`test/cardmenu.test.js`
  has the harness; the tile markup is a function of its inputs the way the card menu's is).

`npm test` and `npm run lint:tokens` gate all of it, and the whole path gets one run through the
headless-Firefox harness against a real deck: choose a printing, see the mat change, reload the
page, see it still chosen.
