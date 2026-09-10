# Research — cards from a scanner, and a card at a time

**Not built.** This is the assessment written before anything was decided, for
two asks that arrived together — with *Decided*, below, written afterwards
and authoritative wherever it and this body disagree:

- a collection scanned in a phone app — **Delver Lens** here, **ManaBox** for
  other people in the playgroup, and three more the field says are worth
  reading — should get onto a shelf
- **one card** should be addable to a collection from where you are already
  looking at it: a search result, a card in a deck, the Card tab

They are one document because they turn out to share a problem, and it is not
the one either of them looks like from the outside.

---

## The thing they share

The shelf's model already has room for both. A collection card is a name, a
quantity and a breakdown of which printings the copies are
([available-db.js:552](available-db.js#L552)), and `namesPrinting`
([available-db.js:576](available-db.js#L576)) already accepts a bare Scryfall
id as a whole printing — which is exactly what a scanner writes down. Nothing
about the data needs to change for either ask.

What neither has is a **way to write to a shelf that is not a whole-shelf
replace**, and a **shelf that is not a mirror of somebody else's website**.
Every collection this app holds today is a copy of an Archidekt collection or
of an export somebody downloaded, and the only write is
`POST /api/collections` ([routes/state.js:386](routes/state.js#L386)), which
puts every card of a shelf on the wire at once and overwrites what was there.
That is right for a mirror and wrong for both of these.

## What the app already has

**The printing model, and it is the right shape.** A row that says
`{ id: <scryfall uuid>, qty: 2 }` is a printing. A row that says a set and a
collector number and no id is the same printing said the other way round. A row
that says neither lands in the unknown entry, counted and never guessed at.
Of the five scanners below, three name a Scryfall id and two name a set and a
collector number — so **every one of them lands in a real printing**, and none
of them needs the unknown entry at all.

**CSV import is already a table of formats, not a parser per site.**
`CSV_FORMATS` ([public/js/collections.js:48](public/js/collections.js#L48)) is
two rows of column names, read by header rather than by position, and
`importCSV` ([public/js/collections.js:83](public/js/collections.js#L83)) is
format-agnostic below that. A new format is, in principle, one entry in that
array. *Five findings*, below, is why "in principle" is doing work in that
sentence — three of the five apps need something the table cannot express.

**Scryfall's batch lookup is already proxied.**
`POST /api/scryfall/cards/collection`
([routes/scryfall-proxy.js:79](routes/scryfall-proxy.js#L79)) takes up to 75
identifiers a request — `{"id": …}` and `{"set": …, "collector_number": …}`
among them — through the shared rate-limited queue. This is the only way to
turn a bare printing id into a card name, and it already exists.

**The local card cache cannot do that lookup.** `scryfall.db` is Scryfall's
`oracle_cards` bulk file, one row per card *name*
([scryfall-db.js:24](scryfall-db.js#L24)); the `id` on each row is one
arbitrary printing's. It can answer "what is this card" and never "which card
is this printing".

**Other tabs catch up for free.** Nine triggers move the state revision on
every write to the `collections` table, so a shelf changed by any new route is
picked up by every open tab's next poll with nothing extra written — see *The
state revision* in [architecture.md](architecture.md).

---

# Part one — the scanner exports

## Which scanners, and how sure we are

There is no reliable public count of who uses what, and the "best MTG scanner
in 2026" roundups are all published *by* scanner apps, so they are marketing
rather than evidence. Three better signals agree with each other:

- **What the destination sites bothered to support.** Archidekt's collection
  import is a dropdown of source apps: Cardsphere, Deck Box, **Delver Lens**,
  **Dragonshield**, **Helvault**, **ManaBox** (twice — single folder and whole
  selection), Moxfield. A site does not write a parser for a format nobody
  brings it.
- **What third-party bridging tools were built for.** MtgCsvHelper exists, in
  its author's words, to bridge card-scanner exports — naming ManaBox and
  Dragon Shield — into the mainstream managers.
- **Install counts, where they are visible at all.** Delver Lens is 100,000+
  on Google Play (one aggregator estimates ~360,000); it is Android-only.
  ManaBox and Dragon Shield are on both stores and publish no comparable
  figure.

Taking those together, the five worth designing for are **ManaBox**, **Delver
Lens**, **Dragon Shield MTG Card Manager**, **the TCGplayer app** and
**Helvault**, with TopDecked and MTGGoldfish as a near tier and a long tail of
2025–26 newcomers (CardCastle, Lotus Scan, Scrytics) that nothing should be
built for yet. Treat this ranking as *good enough to choose what to parse* and
not as a fact — the only usage figure that actually matters here is question 1
below, which is what your playgroup has on their phones.

## What each one exports

Every column list below is from a format definition or a vendor FAQ, not from a
file in hand — see *Sources*, and see question 1.

| app | quantity | card name | Scryfall id | set | number | finish | gotcha |
|---|---|---|---|---|---|---|---|
| Archidekt *(have)* | `Quantity` | `Name` | `Scryfall ID` | `Edition Code` | `Collector Number` | `Finish`: Normal/Foil/Etched | — |
| Moxfield *(have)* | `Count` | `Name` | — | `Edition` | `Collector Number` | `Foil`: ''/foil/etched | no id anywhere |
| **ManaBox** | `Quantity` | `Name` | `Scryfall ID` | `Set code` | `Collector number` | `Foil`: normal/foil/etched | collides with Archidekt's sniff |
| **Delver Lens** | *chosen* | *optional* | *chosen* | *optional* | *optional* | *chosen* | no fixed header at all |
| **Dragon Shield** | `Quantity` | `Card Name` | — | `Set Code` | `Card Number` | `Printing`: Normal/Foil | file **begins `sep=,`** |
| **TCGplayer** | `Quantity` | `Simple Name` | — | `Set Code` | `Card Number` | `Printing`: Normal/Foil | `Name` is *not* the card's name |
| **Helvault** | `quantity` | `name` | `scryfall_id` | PRO export only | — | reported as `TRUE`/`FALSE` | lower-case headers |

Read across it: **five apps, five spellings of the same seven facts.** Three of
the five carry a Scryfall id and two carry none — and those two carry a set
code and a collector number, which `namesPrinting` already accepts as the same
identity said the other way round. **Every one of the five names a printing.**
None of them needs anything the model cannot already hold.

## Five findings

### 1. ManaBox is nearly free, and would be silently wrong today

Its columns map onto the existing table almost one for one: `Quantity`, `Name`,
`Scryfall ID`, `Set code`, `Set name`, `Collector number`, `Foil` (`normal` /
`foil` / `etched` — the same three words Archidekt's `Finish` uses, so
`CSV_FINISHES` at
[public/js/collections.js:74](public/js/collections.js#L74) already reads them),
`Condition`, `Language`. One new entry in `CSV_FORMATS`.

**But the format sniff breaks.** Formats are told apart by the column holding
the quantity — `CSV_FORMATS.find(f => header.includes(f.cols.qty))`
([public/js/collections.js:87](public/js/collections.js#L87)) — and that works
only because "Quantity" and "Count" are each unique to one of two files.
ManaBox calls its column **Quantity** as well. A ManaBox export dropped in
today is therefore matched as Archidekt and then read with Archidekt's column
names: `Name` and `Quantity` hit, `Edition Code` and `Collector Number` miss
(ManaBox says *Set code* and *Collector number*)… and the shelf imports with
every card's quantity right and **every printing unknown**. No error, no
warning — the exact failure `test/collectioncsv.test.js` was written to
prevent, arriving by a different door.

So the discriminator has to become a column unique to each format rather than
the quantity column: `ManaBox ID` or `Set code` for ManaBox, `Edition Code` for
Archidekt, `Count` for Moxfield. Cheap, but it is a change to the mechanism
rather than a row in a table, and it needs the unrecognised-format message
rewording.

### 2. Delver Lens has no format to add

Its CSV export is a dialog: you choose which fields to include, in what order,
with which separator, or you pick a preset aimed at a destination site
(Archidekt, Deckbox, TappedOut, EchoMTG, MTGGoldfish, MTGstand and others). A
guide for one such site tells people to tick exactly `Condition, Foil,
Language, Quantity, Scryfall ID` — five fields, no card name at all — and a
support thread on Archidekt shows a 46,000-card import done as two columns,
`QTY, SCRYFALLID`.

There is no "Delver Lens format" to write down. Three ways out:

- **Name a recipe.** Tell people in the FAQ which fields to tick, and rely on
  the header. *Unverified and load-bearing:* whether Delver Lens writes a
  header line at all. None of the sources say, and a headerless file defeats a
  header-driven parser entirely. **A real export answers this in ten seconds
  and nothing should be built before it does.**
- **Ask, as Archidekt does.** Archidekt's own collection import is a dropdown
  of source apps — Cardsphere, Deck Box, Delver Lens, Dragonshield, Helvault,
  ManaBox (twice: single folder, whole selection), Moxfield. The site with the
  most experience of this problem concluded it cannot sniff, and asks. That is
  a real data point, and it argues for a source picker beside the file picker
  rather than more cleverness inside `importCSV`.
- **Use a preset we already read.** Delver Lens can export *in Archidekt's
  shape*, and Archidekt's shape is a format this app has parsed and tested
  against a real 6,004-row export since the printings work. If that preset
  produces Archidekt's header, **Delver Lens already works today and the whole
  ask is a sentence in the FAQ.** This is the cheapest possible answer and the
  first thing to test.

### 3. Three of the five need a change to the parser, not a row in the table

`CSV_FORMATS` is a table of column names because the two formats it was written
for are otherwise identical files. The other three are not, each in a small
way, and each way is a few lines somewhere the table cannot reach:

- **Dragon Shield's file begins `sep=,`** — a separator declaration Excel
  understands and CSV parsers do not. `parseCSVRows` hands that back as row
  zero, so `importCSV` reads *it* as the header, finds no quantity column and
  refuses the file. That is at least a loud failure rather than a silent one,
  but it makes a supported format look unsupported. The fix is to drop a
  leading `sep=` line before taking the header.
- **TCGplayer's `Name` is not the card's name.** It carries the marketplace's
  product name — the variant and finish spelled into it — and the plain card
  name is in `Simple Name`. Reading the obvious column would key the shelf
  under names Scryfall has never heard of, and every one of them would read as
  a card nobody owns everywhere else in the app.
- **Helvault writes lower-case headers, and its foil column is reported as
  `TRUE`/`FALSE`.** The header case is free — `importCSV` already lower-cases
  the header line — but `CSV_FINISHES` maps `''`, `normal`, `foil` and
  `etched`, so `true` would fall through to its default and file every foil as
  an ordinary copy. That is precisely the bug the Archidekt API import was
  fixed for (`item.foil` was false on every row), arriving from a different
  direction, and it should get the same treatment: never guess, and never let
  an unrecognised word quietly mean "ordinary".

### 4. Columns cannot be guessed by synonym — the sites' own names collide

The tempting simplification, once there are five formats, is to stop writing a
row per app and read any file by a table of synonyms: quantity is
`quantity|count|qty`, the set is `set code|edition code|edition|set id`, and so
on. It does not work, and one column proves it: **Moxfield's `Edition` holds a
set *code* and Deckbox's `Edition` holds a set *name*** (Deckbox puts the code
in `Edition Code` beside it). The same header means two different things in two
files this app may be handed, and getting it wrong writes a shelf whose
printings all name a set that does not exist.

So the per-format row stays, and the argument for **asking** which app a file
came from — Archidekt's answer — gets stronger rather than weaker. A sniff can
still do the work when a format is unambiguous, with the picker as the way to
override it.

### 5. A row that names only an id has no card name, and the shelf is keyed by name

A collection is stored as an object keyed by card name
([available-db.js:654](available-db.js#L654) and the `cards_json` column), and
every reader in the app — ownership marks, the deck's owned count, the Set
Browser's counts, want lists — asks it by name. A `QTY, SCRYFALLID` file has no
name in it anywhere.

Resolving them is a real request budget but not a large one: `cards/collection`
takes 75 identifiers a call, so 3,000 distinct printings is 40 calls — a few
seconds at the shared queue's pace, through a proxy that already exists. It
probably belongs where the Archidekt import lives, on the server and
checkpointed, though the file only exists in the browser, which is the same
tension [collection-import.js](collection-import.js) opens with. A first slice
could do it in the tab and pay the cost of a refresh losing the work.

Two things must be decided about the answers rather than fallen into:

- **Ids that resolve to nothing.** Delver Lens has been observed handing out
  Scryfall ids that 404 — stale printings from its own card database. Those
  rows must be *reported* ("41 rows named a printing Scryfall does not know"),
  never dropped silently, and never completed from anything else. The app's
  standing rule — a printing is recorded as the source spells it, or it is the
  unknown entry — covers the data; the reporting is new.
- **Whether the id→name answers are kept.** Nothing caches printing ids today.
  A small table in `scryfall.db` keyed by printing id would make a re-import
  free, at the cost of a second thing in that database that is not the bulk
  file. Worth doing only if re-imports of scanner files turn out to be common.

## Condition and language get five vocabularies

Every app spells these differently: Archidekt writes `NM`, `LP`, `MP`, `HP`,
`D` and `EN`; ManaBox writes `near_mint`, `light_played`, … and `en`; Dragon
Shield and TCGplayer write `Near Mint` and `English`; TopDecked writes
`slightly played`. Today both fields are recorded verbatim, and the model says
out loud that they carry no information yet and that nothing may be built that
depends on them varying
([available-db.js:539](available-db.js#L539)). That promise is what makes five
vocabularies harmless: the field becomes genuinely heterogeneous and nothing
breaks, because nothing reads it.

The decision to make deliberately is: keep recording verbatim (cheap, keeps the
existing rule, defers a normalisation nobody has asked for), or normalise on the
way in — which is a different proposition at five sources than it was at two,
and the point at which a condition becomes worth *showing* is the point at
which it has to be one vocabulary. This document's recommendation is still
verbatim, with the promise restated in whatever new parser is written, and
normalisation kept as its own piece of work with its own reason to exist.

Note that **finish is not in this bucket and never was.** It is part of a
copy's identity — a foil and an ordinary copy are two entries on the shelf —
so every one of the five spellings above (`Normal`/`Foil`/`Etched`,
`normal`/`foil`/`etched`, `''`/`foil`/`etched`, `TRUE`/`FALSE`,
`regular`/`foil`/`foil_etched`) has to be mapped correctly at the door, and an
unrecognised word must be visible rather than quietly meaning "ordinary".

## The `.dlens` file — looked at, not recommended

Delver Lens's own backup is a `.dlens` file, which is a SQLite database with a
`cards` table; at least two third-party tools open it and write Deckbox-shaped
CSV. Reading SQLite in a browser with no build step is a non-starter, and doing
it on the server means a binary upload path this app does not have. Out of scope
unless the CSV route proves unworkable.

---

# Part two — a card at a time

## Every shelf today is a mirror, and that is the problem

A collection knows how it comes back: fetched, or from a file somebody chooses
([public/js/collections.js:694](public/js/collections.js#L694)). Both replace
the shelf wholesale — a Refresh deliberately starts over rather than resuming,
so that cards removed on Archidekt do not live forever. A card added by hand to
an Archidekt shelf is therefore a card that is there until the next Refresh and
then quietly is not, with nothing to say it went. That is worse than not
offering the button.

**So a single-card add wants a shelf of its own: a new source, a shelf nothing
re-imports.** The encouraging part is that the code already behaves correctly
for a source it has never heard of — `colReimportBy` answers `null`, which means
no Refresh in the `⋯` menu and no re-import offer above the table, "both of
which would be buttons that do nothing", as the comment there says. That is the
sign this is the right seam rather than a new special case. What needs checking
around it:

- `sourceLabel` ([public/js/collections.js:169](public/js/collections.js#L169))
  needs a word for it
- the import-start route already refuses anything that is not Archidekt
  ([routes/state.js:451](routes/state.js#L451)) — nothing to do
- the "shelf does not know its printings" offer skips empty collections, and a
  hand-built shelf starts empty and knows every printing on it, so it should
  never be offered one — worth an assertion

## The write is a delta, not a shelf

Adding one card by re-posting six thousand is wasteful, and two tabs doing it at
once means whichever writes second wins and the other's card is gone. The shape
that fits:

```
POST /api/collections/:key/cards   { name,
                                     printing: { id, set, set_name,
                                                 collector_number, finish,
                                                 lang, condition },
                                     qty: 1 }        # negative to take one off
→ { ok: true, card: <collectionCardRow of the merged card> }
```

The merge is `addCardPrinting` ([available-db.js:647](available-db.js#L647)) —
the same fold the Archidekt import does page by page, so a shelf built a card at
a time and a shelf imported in one go agree about what makes two copies the same
card. One transaction, and the rev triggers do the rest.

A negative quantity is not a nicety: without it a mis-scan or a fat-finger is
unfixable from the page where it was made.

## Where the press goes

| site | what it already knows | precedent it borrows |
|---|---|---|
| **Card tab, "On the shelf"** ([public/js/card.js:400](public/js/card.js#L400)) | the card, the printings held, whose shelf | it is already the printing-level answer, written out in full |
| **the printings gallery** ([public/js/card.js:513](public/js/card.js#L513)) | every printing, and a finish-split tile already written | `forDeck` already turns the gallery from a way to look into a way to choose |
| Search / Set Browser grids | the card, not the printing | the want-list `+` |
| the Deck Builder mat | the card, the deck's printing, and that you *don't* own it | the missing-card marks |

The first two are the first slice. The gallery is the striking one: `forDeck`
splits a printing into one tile per finish because "a foil is a different thing
to run and a different thing to pay for" — and a foil is a different thing to
*own*, so the split, the ring and the per-tile press are all already the right
shape for a third mode. The grids know a name and not a printing, which makes a
press there an add of an unknown printing — see the open questions.

## What a press has to decide

- **which shelf.** Yours if you have one, the group's if you don't, a chooser
  once there is more than one. Whose shelf you may write to is a rule this app
  has already made once, for the re-import offer: your own and the group's, all
  of them for an admin. Same rule.
- **which finish.** Scryfall's `finishes` for that printing, which
  `cardPrintFinishes` already reads.
- **how many**, defaulting to one.
- **condition and language** — nothing, rather than a guess. An unfilled field
  stays unfilled; that is the model's own rule, and it is why an add and an
  import produce the same row.

---

## Decided — 10 September 2026

Every open question below was worked through; these are the answers, and they
are authoritative wherever they and the body of this document disagree.

**The shape.** A scanner file *seeds* a shelf this app owns, hand-adds extend
it, and nothing re-imports it. That collapses the two halves of this document
into one feature: the new source of part two is not an independent half at the
back of the plan, it is the destination every scanner import lands in. All file
imports become one-time loads — the file-mirror idea retires, `COL_FILE_SOURCES`
empties, and existing `csv-archidekt` and `csv-moxfield` shelves keep working
as mirrors until they are re-created rather than being migrated. Which app
seeded a shelf is recorded as provenance, for `sourceLabel` and for debugging a
bad import: a label, not a source anything acts on. Archidekt API shelves are
untouched and become the legacy tier, because the point of the whole exercise
is one outside app rather than two.

**Which formats.** All five — ManaBox, Delver Lens, Dragon Shield, TCGplayer,
Helvault — with the mechanism built so that a sixth is cheap. Each against a
real export; nothing ships for an app nobody can produce a file from. Helvault
is a slice-3 format after all and not a reason for slice 5: its free export
carries `name`, `scryfall_id` and `quantity`, which is a whole identity.

**Sniff, then ask.** Sniff first, with a source picker beside the file picker
as the override and as the fallback when the sniff is ambiguous. The
discriminator is fixed by *refusal* rather than by finding a more unique
column: a header carrying a format's quantity column but not its other required
columns is not that format, and the file is refused by name. One rule, which
handles ManaBox and every scanner not yet met, where "a column unique to each
format" gets harder with every format added. Worth doing on its own whatever
else is decided — the ManaBox misread is a live silent-corruption path today.

**Formats stay data.** Each quirk finding 3 describes becomes a declarative
field on the format row — a leading `sep=,` to drop, which column holds the
card's name, which finish vocabulary to read — and never a per-format transform
function. The first format that gets a function is the last one anybody can
reason about as a table, and a field that turns out to be missing can be added
when a sixth format needs it.

**Every Scryfall id is resolved at import**, through the batch proxy that
already exists, so all five formats land on the shelf in one shape. This is a
correction to finding 5, which had the trigger backwards: resolution is needed
not when a format arrives without card *names* but when one arrives without a
**set and collector number**, because that is what the interface labels a
printing with. `cardShelfRowHtml` ([public/js/card.js:371](card.js#L371))
builds its label from `set`, `set_name` and `collector_number` and never from
the id, so a Helvault shelf would import perfectly and then read "Unknown set"
on every row. Resolution therefore belongs in the import mechanism rather than
in an optional late slice.

**An id Scryfall does not know** keeps its copies, lands in the unknown entry,
and is reported by count. Nothing is completed from the card's name; the
standing rule holds and a newest-printing guess was considered and rejected —
it would state a falsehood confidently, it has no answer for the many cards
with no standard printing, and it would make an import and a hand-add produce
different rows. What changes instead is the label: a printing that named an id
nobody recognises should say "printing not recognised" rather than "Unknown
set", which is the honest version of the same news.

**Condition and language stay verbatim**, with the promise restated in whatever
new parser is written.

**Corrections.** A second import *adds*; it never replaces. The interface has
to say so in those words, because a full re-scan imported twice would double a
collection silently. Undo is per import and goes through a **ledger** — a row
recording the shelf, the file, the time and the parsed rows — so that the
printing model is untouched and an undo can fail visibly when copies have since
been sold. Provenance on the printing entry itself was rejected: it would put
bookkeeping inside the identity key and quietly stop merging copies that are
genuinely the same card, which is the one invariant the model is built around.

**The press.** The Card tab's shelf section and the printings gallery first,
both of which already know a printing rather than a name. The target is your
owned shelf where there is one and a chooser where there is more than one,
remembered after the first press; whose shelf you may write to stays the rule
the re-import offer already made. No "one more, printing not known" add from
the search grids in this work — the app-owned shelf is the collection of
record, and an entry point that makes it deliberately vaguer than the Card tab
one press away is the wrong default.

**Delver Lens** gets a named recipe including the card name alongside the id,
so that a row survives an id that 404s. Whether its export writes a header line
at all is the one thing no decision can settle, and with the picker in place
both answers work: a header makes it a format like any other, and no header
makes it the one format read by position.

---

## The test pile — ten cards, one batch, five exports

Every app can add a card to a list by hand, so none of these has to be owned.
Add them in **these printings** — the set and the number are the point — and
export the *same* pile from all five apps. Five files of the same ten cards is
what allows a column-by-column diff; five different piles only test each app
against itself. Set codes and collector numbers below are checked against
Scryfall.

| # | card | printing | what it stresses |
|---|---|---|---|
| 1 | Sol Ring | `SLD` #1074 | **etched** — the finish that separates a three-value column from Helvault's `TRUE`/`FALSE` |
| 2 | Sol Ring | `MSC` #211, **twice: one nonfoil, one foil** | finish as identity — two rows that must stay two entries |
| 3 | Sol Ring | `SOC` #128 (**Japanese**) | the language column, and a non-ASCII name where an app localises it |
| 4 | Island | `PLST` #**MKM-279** | a collector number that is not a number, and a basic land where a wrong printing is invisible |
| 5 | Yawgmoth, Thran Physician | `DMR` #110 | a comma in the name — CSV quoting |
| 6 | Krark's Thumb | `MRD` #190 | an apostrophe |
| 7 | Wear // Tear | `MOC` #343 | `//` in the name — a split card |
| 8 | Delver of Secrets // Insectile Aberration | `MID` #47 | `//` again, but double-faced — apps differ on front face alone or both |
| 9 | Lim-Dûl's Vault | `ALL` #107 | non-ASCII `û`, a hyphen and an apostrophe, in a 1996 set: the row most likely to expose a Latin-1 file |
| 10 | \_\_\_\_\_ Goblin | `UNF` #107 | leading underscores — a name that looks like an empty field to anything sloppy |

Set one card's quantity to **3**: that catches an importer counting rows rather
than reading the column, which is a bug this repository has already had once.

Sol Ring is four rows across three printings and two languages, and it is the
most valuable thing in the pile — one name exercising `addCardPrinting`'s fold,
finish-as-identity and the name key at the same time. An eleventh, where an app
makes it easy: a datestamped prerelease promo, whose collector number ends in
`s` (`PTLA` #278s, for instance).

What to look for as the files arrive, in the order it matters: whether there is
a header line at all — the Delver Lens unknown — then the encoding and the
separator, a leading `sep=,`, how each app writes the double-faced name, and
what the foil column says about the etched Sol Ring.

---

## Open questions — answered

Every one of these has an answer in *Decided* above. They are kept as written
because the reasoning under each is what the answer was chosen against.

1. **Which of the five does the playgroup actually have?** You are Delver Lens
   and you know of ManaBox. The other three are on the list because Archidekt
   supports them, not because anyone here uses them — and a format nobody
   brings is a parser nobody tests. Ask the group before slice 2 is scoped.
2. **Can you produce a real export from each app that survives question 1?**
   Every column list in this document is inference from documentation. The two
   formats the app reads today are trusted only because real 6,004-row and
   4,314-row exports were checked column by column
   (`test/collectioncsv.test.js`), and the same bar should apply here.
3. **Does the Delver Lens → Archidekt preset already work?** If it produces
   Archidekt's header, the scanner ask is largely already built and the rest is
   an FAQ entry. Test this before anything else.
4. **Sniff, or ask?** Archidekt asks, with a dropdown, and finding 4 is why.
   A source picker beside the file picker is more honest and less clever;
   sniffing keeps the flow to one press. A sniff with the picker as an override
   is probably the answer, and either way the discriminator needs fixing.
5. **One shelf per file, or a shelf a scanner file keeps updating?** ManaBox
   and Dragon Shield exports both carry the binder/folder name, which could
   name the shelf — and Dragon Shield's is *per row*, so one file can hold
   several binders. Re-importing a scanned shelf would be a file you pick,
   which is the path a CSV shelf already has.
6. **Where does a single-card add land when you have three shelves?** A stored
   preference ("my scanned box"), or a chooser every time.
7. **Should an add ever be able to say "one more, printing not known"?** From a
   search grid that is all it can honestly say. It is a legal row in the model —
   it is the unknown entry — but it would be the first time this app *creates*
   one rather than inheriting it from somebody's export.
8. **Condition and language: verbatim, or normalised?** The recommendation
   above is verbatim.

## A plausible slicing, once those are answered

*Superseded in part by* Decided *above: the new source (6) is the destination
every import lands in and comes first, and id resolution (5) moves into the
parser work rather than being an optional late slice.*

1. **Fix the format discriminator**, with a test that a ManaBox header is not
   read as Archidekt's. Standalone, and a latent bug today.
2. **Make the parser able to hold five formats**: drop a leading `sep=` line,
   let a format name which column holds the card's name rather than assuming
   `Name`, and make an unrecognised finish visible instead of ordinary. No new
   format ships in this slice — it is the three findings the table cannot
   express, paid once.
3. **The formats themselves**, one commit each, each against a real export with
   a fixture and a test in the shape of `test/collectioncsv.test.js`. Order
   them by question 1: what the group actually has, first.
4. **Delver Lens**: whichever of the three routes question 3 leaves standing —
   possibly nothing but an FAQ entry.
5. **Id-only rows**: batch resolution through the existing proxy, and the
   report of the ids that resolved to nothing. Needed only if a format in
   slice 3 or 4 arrives without card names.
6. **The new source** — a shelf nothing re-imports — and the delta route.
7. **The press**, on the Card tab's shelf section and in the gallery.

Steps 1–5 and 6–7 are independent of each other, and 6–7 is the smaller half.
Slice 1 is worth doing whatever else is decided.

---

## Sources

- [Import and export the collection — ManaBox](https://www.manabox.app/guides/collection/import-export/)
- [MtgCsvHelper `appsettings.json` — column mappings for ManaBox, Archidekt, Deckbox and others](https://github.com/StepKie/MtgCsvHelper)
- [MTGstand collection import guide — the Delver Lens field picker and its presets](https://www.mtgstand.com/collection-import-guide)
- [MythicHub import help — the Delver Lens fields it asks for](https://mythichub.com/help/importing-collection?section=importing-from-manabox)
- [Archidekt forum — a Delver Lens `QTY,SCRYFALLID` import, and the ids that 404](https://archidekt.com/forum/thread/10004802)
- [Archidekt forum — the source-app dropdown its collection import offers](https://archidekt.com/forum/thread/15700538)
- [Helvault FAQ — its `extras, name, scryfall_id, quantity` format, and the PRO export](http://www.vitorcesco.com/helvault/faq.html)
- [Archidekt forum — Helvault's foil column exports as TRUE/FALSE](https://archidekt.com/forum/thread/6974834/1)
- [MtgCsvHelper issue #7 — Dragon Shield's leading `sep=,` line](https://github.com/StepKie/MtgCsvHelper/issues/7)
- [dlensExporter — what a `.dlens` file is](https://github.com/Jertzukka/dlensExporter)
- [MTG Card Scanner Delver Lens on Google Play — the 100,000+ install band](https://play.google.com/store/apps/details?id=delverlab.delverlens)

The 2026 "best scanner app" roundups (Scrytics, Lotus Scan / scanyourmtg,
TCGLens, CardPriceIQ, GrimDeck) were read and are deliberately not cited as
evidence: each is published by a scanner app that ranks itself at or near the
top. They are useful only for the names they all have in common, which is the
five above.
