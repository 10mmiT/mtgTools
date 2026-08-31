# Printings, Land Base, Playtest — the plan

Written before the work, on branch `feat/printings-and-lands`, and revised on
2026-08-27 after the decisions below were argued out one by one. `docs/records/` is
where the counterpart goes afterwards — what actually got built, which is allowed to
disagree with this.

Nothing here is implemented yet. The branch holds this document and nothing else.

## The four

| | Feature | Decision | Depends on |
|---|---|---|---|
| 1 | Collections know the printing of a card | Full physical identity — id + finish + language + condition | — |
| 2 | Printing-aware ownership | Deck ownership and the collections table only | 1 |
| 3 | Optimize a deck's printings | Cheapest and dearest, over one bounded pool | 1, 2 |
| 4 | "Land Base" tab beside Search and EDHREC | Suggestions *and* a deck-bound calculator | — |
| — | Playtest a deck | Own branch off `main`, specced separately | — |

An earlier draft numbered the Land Base tab 2 and then said feature 3 depended on
"1, 2", which read as depending on the tab. The order above is the real one: 1 → 2 → 3
is a chain, 4 is independent of all of it.

---

## What was measured

Facts first, because three of them changed a decision.

| Question | Answer |
|---|---|
| Is Archidekt's `card.uid` a Scryfall id? | **Yes** — resolves to `thb #13`, Elspeth Conquers Death |
| Is foil a separate printing? | **No** — `finishes: ["nonfoil","foil"]` on one id, priced separately (€0.62 / €1.61) |
| Does storing printings blow up the payload? | **No.** Raw 0.40 → 1.15 MB (2.8×), but **gzipped 78 → 87 KB (1.1×)** — the fields repeat, so they compress away, and `compression()` is already on |
| What does full physical identity cost? | **One extra entry per 500 rows.** 500 sampled rows → 499 distinct by id, 500 by id+finish+language+condition |
| Do condition and language carry information? | **Not today.** Both are `1` for all 500 sampled rows. Only *finish* varies — 13 foils, 2.6% |
| Which field is the finish? | **`item.modifier`**, not `item.foil` — `Normal` / `Foil` / `Etched`, the three `card.options` enumerates. `item.foil` is `false` on all 3,319 rows of a sampled collection, its 16 foils included |
| Do all printings have a price? | **No.** Sol Ring: 135 prints, 5 digital-only, and only **96 of 130 paper prints** carry a EUR price |

### The bound that did not bind

"Most expensive" unbounded picks Summer Magic Sol Ring at €3,521, so a bound was
asked for: exclude Reserved List, pre-Modern sets and oversized. Measured, it does not
work:

| Rule | Pairs surviving | Dearest Sol Ring |
|---|---|---|
| Unbounded | 149 | `ltc #408z` foil **€5,716.97** |
| Not reserved, not oversized, released ≥ 8ED | 143 | `ltc #408z` foil **€5,716.97** — unchanged |
| **…plus not serialized** | 140 | `ltc #408` nonfoil €1,957.52 |
| …plus not boosterfun | 134 | €1,957.52 — no further effect |
| `booster: true` only | 10 | €3,521.30 — worse, and guts the pool |

`ltc #408z` is a **2023** card: black border, modern frame, not promo, not reserved,
not oversized. Its marker is `promo_types: ["boosterfun","serialized",…]` and
`booster: false`. The expensive outliers in modern Magic are serialized and
special-treatment variants from recent sets, not old cards. Hence the amendment.

---

## The decisions

| | Decision |
|---|---|
| **Printing identity** | Scryfall id + finish + language + condition. Costs one extra entry per 500 rows; only finish carries information today, so that is the part the UI leans on |
| **qty vs printings** | `printings` is authoritative and always sums to `qty`. Anything unattributed goes in an explicit `{ id: null }` *unknown* entry, so the unknown state is a row in the data rather than a case fifteen call sites must remember |
| **Change detection** | `refreshState` stops stringifying the whole payload to decide whether anything changed; it uses the server's existing `version` / an ETag. Tripling per-poll CPU on a phone is not worth it |
| **Unknown state** | A distinct third reading — *owned, printing unknown* — wherever ownership is shown, plus a one-time banner offering to re-import. A third state with no way out is just nagging |
| **Deck printing shape** | `PRINTING_FIELDS` gains `finish`, appended last and omitted when absent, so decks stored before the change serialise byte-for-byte and no phantom History rows appear |
| **Optimize: pool** | ~~Paper only. Not reserved, not oversized, released ≥ 2003-07-28, **not serialized**. One pool shared by both modes — admissibility is a property of the printing, not of which button was pressed~~ **Amended by #53 — see below.** The pool itself is unchanged; what it governs is |
| **Optimize: finish** | Finish follows price: cheapest may pick a foil when the foil is cheaper, dearest likewise. This is why the deck shape needed `finish` |
| **Optimize: unpriced** | Skipped. A printing with no price is unknown, not free, and must never win "cheapest" — but it never clears an existing choice either |
| **Optimize: dearest** | Bounded as above and otherwise honest. It still lands on a €1,957 Sol Ring, because that is genuinely the most expensive admissible printing |
| **Scope of printing-awareness** | Deck ownership and the collections table. Want lists, the Sets tab and the "cards I own" search scope stay name-level until a use case asks otherwise. Available@ is a calendar and was never in scope |
| **Collections table** | One row per card, with a Printings column summarising (`3 — c21, 2xm ✦`). One row per physical copy triples the table to answer a rarer question; the card view is where a printing gets looked at |
| **Bulk change history** | One History entry per bulk run — "Set 99 printings to cheapest" — restorable as a single undo. One action the user took is one row they can revert |
| **Re-import** | Offered per collection, with a bulk action available. Collections belong to different people; re-importing someone else's shelf uninvited is not ours to do, and nothing starts itself on boot |
| **Land suggestions** | Colour identity computed from the deck's cards, so a 60-card deck gets suggestions too. A curated cycle list is the grouping spine; EDHREC's ranking goes on top when there *is* a commander |
| **Both land tools stay** | The standalone Mana Base Calculator is kept deliberately — it is used for draft and sealed, where no deck is built on the site at all. The drawer copy is deck-bound; they share the maths and diverge in what they read from |
| **Playtest** | Its own branch, its own document |

---

## What is already here

### Decks already track printings

`deck_cards.printing` is a JSON column with a whole shape around it:
`PRINTING_FIELDS` at `available-db.js:421` (`id`, `set`, `set_name`,
`collector_number`, `image`, `price_eur`, `chosen_at`), `readPrinting` /
`writePrinting` / `deckCardRow` as the only ways in and out, the per-card picker at
`card.js:334`, and `deckview-totals.js:116` already pricing a deck off it.

So feature 3 is largely a bulk pass over machinery that exists, and its payoff is
visible the moment it runs: the deck total moves.

### Archidekt already sends the printing, and the import throws it away

```
item.card.uid                  ea20208b-…   ← a Scryfall id, confirmed
item.card.edition.editioncode  thb
item.card.edition.editionname  Theros Beyond Death
item.card.collectorNumber      13
item.modifier                  Normal       ← the finish; the only one that varies
item.foil                      false        ← dead: false on every row, foils included
item.condition                 1
item.language                  1
```

`item.foil` was read as the finish and is not one. Measured over all 3,319 rows of a
public collection it is `false` everywhere, including on all 16 rows whose `modifier`
says `Foil`. The finish is `item.modifier`, whose three values are the three
`item.card.options` enumerates — `Normal`, `Foil`, `Etched` — which are Scryfall's
`nonfoil`, `foil` and `etched`. See #52.

`collection-import.js` reduces all of it to `{ name, type, mana, qty }` and merges by
name. **No new API calls are needed for feature 1** — only a wider parse and a wider
stored shape.

Moxfield is unconfirmed, and the CSV path reads only two columns
(`collections.js:24`), though both exports carry edition and collector-number columns.
Neither should be promised before it is checked against a real export.

### There is already a Mana Base Calculator

`public/js/lands.js` is a top-level tab: pip counts in, basic-land split out, and it
can already read the open deck. It does not suggest which nonbasics to run, which is
the half Archidekt's Land Base does. It stays as it is — see the decision above.

### Two smaller facts

- Prices are **EUR** everywhere (`card.js:208`, `deckview-totals.js:243`,
  `sortui.js:98`, `collections.js:1093`), so "cheapest" means cheapest in euros
- The local card cache is Scryfall's *oracle* bulk file — one row per name, no
  printings. Printings come over the wire per card via `/api/scryfall`, paced by
  `scryfall-queue.js` at ~9 requests a second

---

## The architecture decision

Every consumer reads a collection's cards through one narrow interface — a `Map` keyed
by name, touched only via `.has(name)`, `.get(name).qty`, `.keys()` and `.values()`.
Fifteen call sites in seven files:

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

Re-keying by printing would break all fifteen at once for a question most never ask —
the chip row wants a total, not a breakdown. Hanging an array off each entry gets the
semantics while every existing reader goes on working untouched.

```js
{
  name: 'Sol Ring',
  qty:  3,                     // printings always sum to this
  printings: [
    { id: '…', set: 'c21', collector_number: '263',
      finish: 'nonfoil', lang: 'en', condition: 'nm', qty: 2 },
    { id: null, qty: 1 },      // unknown: imported before printings existed
  ],
}
```

The unknown entry is the point. It makes "we do not know" a value rather than an
absence, so no reader can forget to handle it — and the plan's biggest risk is exactly
that someone gets told they own nothing.

### The backfill

There is no migration. The data was never stored, so it cannot be recovered from disk
— **every collection must be re-imported to gain printings**, which is now a
four-minute server-side job that survives a closed tab. Until then a collection's
copies sit in the unknown entry, and every printing-aware readout must say *unknown*,
never *owns none*.

---

## Step 1 — Collections carry printings

Foundation. Nothing else works without it.

- `collection-import.js` — widen the parse to keep id, set, set name, collector
  number, finish, language and condition; accumulate a per-identity breakdown that
  sums to `qty`, with the unknown entry absorbing anything unattributed
- `available-db.js` — the collection printing shape gets the same read/write
  discipline `readPrinting` already has, so it is one shape rather than a convention.
  `PRINTING_FIELDS` gains `finish`, appended last, omitted when absent
- `public/js/state.js` — hydration carries `printings` through
- `public/js/main.js` — `refreshState` swaps the whole-payload stringify for the
  server's `version` / an ETag
- Confirm Moxfield's per-row printing fields, and a real CSV export's columns

**Test:** a re-imported collection reports the printings it owns and they sum to
`qty`; a collection stored before this change reports one unknown entry equal to
`qty`; an existing deck snapshot serialises byte-for-byte after `finish` is added.

## Step 2 — Printing-aware ownership

- A query layer over the shelf: `ownedQty(name)` unchanged, plus `ownedPrintings(name)`
  and `ownsPrinting(name, id)` — the latter rolling up across language and condition,
  which are identity but not a reason to call it a different card
- `deckview-owned.js` — the readout distinguishes *own it*, *own it in another
  printing*, *printing unknown*, and *do not own it*
- `collections.js` — a Printings column, one row per card
- A one-time banner offering to re-import collections that predate printings; per
  collection, with a bulk action for someone who owns them all

**Test:** a deck whose cards are all owned but in the wrong printings reads as
owned-in-another-printing; a collection with no printing data reads as unknown, not as
a mismatch and not as unowned.

## Step 3 — Optimize a deck's printings

> **Amended by #53, and this is what shipped.** The row in the decisions table above says
> "one pool shared by both modes", which was written when there were two. There are three,
> and the third proposes no purchase — so the rule is now: **the pool decides what the app
> will send you to buy, not what it will let you keep.** Cheapest and dearest are bounded by
> it; prefer-owned is not, and settles on a printing already on the shelf even where that
> printing is Reserved List, serialized, older than the bound or unpriced. The pool's own
> membership is exactly as specified below.

- Modes: **cheapest**, **most expensive**, and **prefer printings I own** falling back
  to cheapest
- The admissible pool, which bounds the two buying modes: paper, priced, not reserved, not
  oversized, released ≥ 2003-07-28, not serialized. Every (printing, finish) pair is a separate
  candidate with its own price
- Basic lands are excluded from every mode, decided from the local card data before any
  request goes out — the printing of a basic is chosen for how it looks and never for money
- Prints per card over `/api/scryfall`, paced by the shared queue. A hundred-card deck
  is ~100 requests at ~9/s ≈ **11 seconds** — a progress bar, not a spinner
- Writes through `dbChoosePrintings` (`deckview-edit.js`) — a bulk sibling of
  `dbChoosePrinting`, sharing its guards, that renders the mat once and schedules one save
  however many cards moved — but the run lands in History as **one entry**, restorable as a
  single undo. Three reasons rather than one (`optimize-cheapest`, `optimize-dearest`,
  `optimize-owned`), because cheapest and dearest are opposites and the row has to say which
  ran
- The shared printings loader follows Scryfall's paging to the end. It stopped after the
  first page, which cut the pool off at 175 candidates — and cut the card gallery off at the
  same place, which was a bug nobody had reported

**Test:** cheapest and dearest pick the right pair from a known price set; a foil wins
when the foil is cheaper; unpriced and inadmissible printings are never chosen and
never clear an existing choice; the deck total moves by the sum of the picks; the run
is one History row and restoring it puts every printing back.

## Step 4 — Land Base tab

Third tab beside Search and EDHREC — `public/index.html:1078`, `dbSetLeftTab`
(`deckview-panels.js:508`), `.db-ltab` (`tabs.css:2159`). Two panels:

1. **Suggestions** — colour identity computed from the deck's own cards, so a
   60-card deck is served as well as a commander one. A curated cycle list gives the
   grouping (duals, fetches, triomes, utility); EDHREC's ranking goes on top when
   there is a commander. Each row gets a `+` and, from step 2, a ✓ when it is on the
   shelf
2. **The calculator** — `lands.js` maths, bound to the open deck

The standalone Mana Base Calculator tab stays. It is used for draft and sealed, where
no deck is built on the site at all, so the two are not duplicates of one control —
they share the maths and differ in what they read from.

## Playtest — separate branch

Its own branch off `main` and its own document. "Playtest" spans anything from a
goldfish draw-and-mulligan to full turns, phases, the stack and tokens; the scope
question is the whole of the work, and none of the decisions above depend on it.

---

## Risks

- **The backfill.** Everyone must re-import before any printing feature says anything
  true, and the unknown state has to stay honest everywhere. The unknown entry in the
  data is the mitigation; it is still the easiest thing here to get wrong
- **"Most expensive" is still eye-watering.** Bounded, it lands on a €1,957 Sol Ring.
  That is the correct answer to the question, but it will look like a bug
- **Finish following price will surprise someone.** Cheapest can swap a card to foil.
  It was chosen deliberately; it should be visible in the result, not silent
- **Bulk edits and History.** One entry per run is the decision; whether the panel can
  actually restore a 99-card printing change wants proving early, not late
- **CSV and Moxfield** may not carry printings at all. Archidekt's API certainly does;
  the other two paths are unconfirmed and should not be promised
- **Condition and language are dead fields today.** Both are constant across the
  sample. They are in the identity because they were asked for, but nothing should be
  built that depends on them varying until they do
