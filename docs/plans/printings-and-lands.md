# Printings, Land Base, Playtest — the plan

Written before the work, on branch `feat/printings-and-lands`. Four features were
asked for; this is what each one turns out to involve once the code is read, in the
order they have to happen. `docs/records/` is where the counterpart goes afterwards —
what actually got built, which is allowed to disagree with this.

Nothing here is implemented yet. The branch holds this document and nothing else.

## The four

| | Feature | Decision taken | Depends on |
|---|---|---|---|
| 1 | Collections know the printing of a card | **Printing-aware throughout** — ownership, wants, Available and the Sets tab all become per-printing | — |
| 2 | "Land Base" tab beside Search and EDHREC | **Both** — Archidekt-style land suggestions *and* the pip calculator | — |
| 3 | Optimize a deck's printings | Cheapest and most expensive; a third mode falls out of 1 | 1, 2 |
| 4 | Playtest a deck | Own branch off `main`, specced separately | — |

---

## What is already here

Read before planning, so the estimates below are about what is missing rather than
about what sounds hard.

### Decks already track printings

`deck_cards.printing` is a JSON column, and there is a whole shape around it:

- `PRINTING_FIELDS` in `available-db.js:421` — `id`, `set`, `set_name`,
  `collector_number`, `image`, `price_eur`, `chosen_at`
- `readPrinting` / `writePrinting` / `deckCardRow` (`available-db.js:433–464`) are the
  only ways in and out, and all three are total
- The per-card picker is `card.js:334`, drawn from `prints_search_uri`
- `deckview-totals.js:116` already prices a deck off `card.printing.price_eur`

So feature 3 is mostly a bulk pass over machinery that exists, and its payoff is
visible the moment it runs: the deck total moves.

### Archidekt already sends us the printing, and we throw it away

Every row of the collection API carries it. Confirmed against collection 702530:

```
item.card.uid                  ea20208b-1939-4c69-8cfd-c0a42f9dc427   ← Scryfall id
item.card.edition.editioncode  thb
item.card.edition.editionname  Theros Beyond Death
item.card.collectorNumber      13
item.card.prices               { … }
item.foil                      false
item.condition                 1
item.language                  (per row)
```

`collection-import.js` currently reduces all of that to
`{ name, type, mana, qty }` and merges rows by name. **No new API calls are needed
for feature 1** — only a wider `parseCard` and a wider stored shape.

The same is not yet confirmed for Moxfield, and the CSV path reads only two columns
(`collections.js:24` — quantity and name), though Archidekt and Moxfield CSV exports
do carry edition and collector-number columns. Both need checking against a real
export before they can be promised.

### There is already a Mana Base Calculator

`public/js/lands.js` is a top-level tab: pip counts in, basic-land split out
(`landsDistribute`, `landsRecalc`), and it can already read the open deck
(`landsUseDeck`). It does **not** suggest which nonbasics to run, which is the half
Archidekt's Land Base does and this one does not. Hence "both" for feature 2.

### Prices are EUR everywhere

`card.js:208`, `deckview-totals.js:243`, `sortui.js:98`, `collections.js:1093`. So
"cheapest" means cheapest in EUR, and no currency selector is in scope.

### The local card cache holds no printings

`scryfall-db.js` caches Scryfall's `oracle_cards` bulk file — one row per *name*.
Printings therefore come over the wire per card, through `/api/scryfall`
(`ALLOWED = /^(cards|sets)/`, so `cards/search` passes) and the shared pacer in
`scryfall-queue.js` at ~9 requests a second.

---

## The architecture decision

Every consumer reads a collection's cards through the same narrow interface — a
`Map` keyed by name, touched only via `.has(name)`, `.get(name).qty`, `.keys()` and
`.values()`. There are 15 such call sites in 7 files:

| File | Lines |
|---|---|
| `public/js/collections.js` | 461, 466, 525, 630, 834, 854, 867 |
| `public/js/deckview-owned.js` | 103, 120, 222, 225 |
| `public/js/deckview-panels.js` | 300 |
| `public/js/players.js` | 907 |
| `public/js/scryfall.js` | 204, 206 |
| `public/js/sets.js` | 198 |
| `public/js/sortui.js` | 139, 168 |

> **Keep the name as the key. Hang the printings underneath it. Add printing-aware
> queries alongside the name-level ones.**

Re-keying the map by printing would break all fifteen at once for a question most of
them never ask — the chip row wants a total, not a breakdown. Hanging an array off
each entry gets the same semantics ("I own the deck, but not in those printings")
while every existing reader goes on working untouched, and each consumer becomes
printing-aware when it is that consumer's turn rather than all in one commit.

The stored entry becomes:

```js
{
  name: 'Sol Ring',
  type: 'Artifact',
  mana: '{1}',
  qty:  3,                    // still the total: nothing that reads .qty changes
  printings: [                // new, and absent on every collection stored so far
    { id: '…', set: 'c21', set_name: 'Commander 2021',
      collector_number: '263', foil: false, condition: 1, lang: 'en', qty: 2 },
    { id: '…', set: '2xm', set_name: 'Double Masters',
      collector_number: '319', foil: true,  condition: 1, lang: 'en', qty: 1 },
  ],
}
```

`qty` stays the sum, so it is never a second source of truth to be reconciled — the
printings are a breakdown of it, and a collection with no printings recorded is a
collection whose breakdown is simply unknown.

### The backfill problem

There is no migration for this. The printing data was never stored, so it cannot be
recovered from what is on disk — **every collection has to be re-imported to gain
printings**, which is now a four-minute server-side job per collection and no longer
something that has to be babysat. Until then a collection reports `printings: []`,
which must read as *unknown*, never as *owns none*. Every printing-aware branch needs
that third state or it will quietly tell people they own nothing.

---

## Step 1 — Collections carry printings

Foundation. Nothing else in this document works without it.

- `collection-import.js` — widen `parseCard` to keep id, set, set name, collector
  number, foil, condition and language; accumulate a per-printing breakdown instead
  of only summing quantities
- `available-db.js` — no schema change needed (`cards_json` is a blob), but the
  printing shape wants the same read/write discipline `readPrinting` has, so that
  it is one shape rather than a convention
- `public/js/state.js` — `hydrateState` carries `printings` through
- `public/js/collections.js` — the CSV path gains printings where the export has
  the columns; check a real Archidekt and Moxfield export first
- Moxfield: confirm the collection API's per-row printing fields

**Test:** a re-imported collection reports the printings it owns; a collection stored
before this change reports unknown and its `qty` is unchanged.

## Step 2 — Printing-aware ownership

The semantics that were actually asked for.

- A query layer over the shelf: `ownedQty(name)` (unchanged), plus
  `ownedPrintings(name)` and `ownsPrinting(name, id)`
- `deckview-owned.js` (103, 120, 222, 225) — the ownership readout distinguishes
  *own it*, *own it in another printing*, and *do not own it*
- `deckview-panels.js:300` — the "cards I own" search scope
- `wants.js`, `sets.js:198`, Available — per-printing where it means something
- `collections.js` — a Printing column, and the card view showing which ones are on
  the shelf

**Test:** a deck whose cards are all owned but in the wrong printings reads as
owned-in-another-printing, not as unowned — and a collection with no printing data
reads as owned, not as a mismatch.

## Step 3 — Optimize a deck's printings

- Three modes: **cheapest**, **most expensive**, and — only possible after step 2 —
  **prefer printings I already own**, falling back to cheapest
- Data path: prints per card over `/api/scryfall`, paced by `scryfall-queue.js`.
  A 100-card deck is ~100 requests at ~9/s ≈ **11 seconds**, so this is a progress
  bar, not a spinner, but nothing like the Archidekt import
- Writes through `dbChoosePrinting` (`deckview-edit.js:148`) so each change lands in
  the deck's history the same way a manual pick does
- Undo matters: this rewrites every card in the deck at once. The History panel
  already exists and should be the answer, which needs checking against how it
  records a bulk change

**Test:** cheapest and dearest pick the right printing from a known price set; the
deck total moves the way the sum of the picks says it should; a card with no prices
is left alone rather than cleared.

## Step 4 — Land Base tab

Third tab beside Search and EDHREC. Touchpoints: `public/index.html:1078`,
`dbSetLeftTab` (`deckview-panels.js:508`), `.db-ltab` (`tabs.css:2159`).

Two panels in one tab:

1. **Suggestions** — read the deck's colour identity and pip weights, query Scryfall
   for lands that produce those colours, and group them (duals, fetches, triomes,
   utility). Each row gets a `+` and, from step 2, a ✓ if it is on the shelf. This is
   the half that does not exist today
2. **The calculator** — `lands.js` wired to the open deck, for the basics split

Worth deciding while building: whether the top-level Mana Base Calculator tab stays
as well, or whether this replaces it. Two copies of one control is the thing the
codebase has removed twice before (see the `.pick-chip` note in `components.css`).

## Playtest — separate branch

Agreed to be its own branch off `main`, not this one. Not specced here; it needs its
own document, because "playtest" spans anything from a goldfish draw-and-mulligan up
to a full board state with turns, phases, the stack and tokens. The scope question
is the whole of the work.

---

## Risks

- **The backfill.** Everyone must re-import before any printing feature says anything
  true. The unknown state has to be honest everywhere, and that is the easiest thing
  in this document to get wrong
- **Two land tools.** Step 4 risks leaving the app with a Mana Base Calculator in two
  places
- **Bulk printing changes and history.** Step 3 edits every card in a deck at once;
  how that lands in the History panel needs checking before it ships, not after
- **CSV and Moxfield** may not be able to carry printings at all. Archidekt's API
  certainly can; the other paths are unconfirmed and should not be promised
