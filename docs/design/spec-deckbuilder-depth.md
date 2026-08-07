# Spec — What the Deck Builder still can't do

A survey of what the established deck builders — Moxfield, Archidekt, Deckstats, ManaStack,
Manabox — give a builder that ours does not, a frame to put it in, and ten proposals for
closing the gap. Written
after `spec-cards-as-objects.md` shipped: the mat now *feels* right, and the question this
document asks is what it should be able to *tell you*.

**This is a PRD, not a record.** Nothing here is built. Where a proposal is expensive or
uncertain the cost is named rather than buried, and where an obvious-looking alternative was
rejected the reason is given.

The frame and proposals 1, 2 and 5 have been through a round of grilling and their open
questions are settled — those sections state decisions, not options, and each names the
alternative it beat. The rest are still proposals. **Dependencies between them are stated
explicitly** (see *Dependencies* before the running order) so this can be cut into tickets
without re-deriving what has to come first.

---

## Problem Statement

Our Deck Builder is a very good place to *arrange* a deck and a poor place to *evaluate* one.

Everything the tab does well is spatial. Cards are objects, categories are piles, a move is a
thing you watch happen, the sort is a sentence, and the pile view reads a deck's shape without
counting. That work is genuinely ahead of the field — Archidekt advertises that its builder is
"designed to simulate the tactile feel of brewing with physical cards" and ours does it better.

But ask the tab a question about the deck and it has four answers: how many cards, how many
lands, the average mana value, and the curve. That is the entire analysis surface. It cannot
tell you whether the deck is legal, whether it can cast its own spells, what it costs, what it
does, what it used to be, whether you own it, or what happens when you draw seven.

The competition answers all of those, and has for years:

| | Moxfield | Archidekt | Deckstats | **mtgTools** |
|---|---|---|---|---|
| Sideboard / maybeboard | ✅ | ✅ (pinned) | ✅ | ❌ |
| Format legality validation | ✅ | ✅ | ✅ | ❌ |
| Commander brackets / Game Changers | ✅ | ✅ | — | ❌ (field exists, unused) |
| Deck price total | ✅ | ✅ | ✅ | ❌ (per-card only) |
| Sample hands / playtest | ✅ | ✅ | ✅ | ❌ |
| Draw probability (hypergeometric) | ✅ | — | ✅ | ❌ |
| Mana source vs. pip analysis | ✅ | ✅ | ✅ | ❌ (separate tab, typed by hand) |
| Deck history / versioning | ✅ | ✅ | — | ❌ |
| Combo detection | via Spellbook | ✅ | — | ❌ |
| Primer / notes | ✅ | ✅ | ✅ | ❌ |
| Printing & foil selection | ✅ | ✅ | ✅ | ❌ |
| Scryfall-syntax filter inside the deck | ✅ | ✅ | — | ❌ (substring only) |
| Tactile pile-based editing | — | partial | — | ✅ |
| Ownership across a *group's* shelves | — | — | — | ✅ (per card, not rolled up) |
| Chrome that folds away entirely | — | — | — | ❌ (see *the frame*) |

The last two rows are the interesting ones. We are ahead on feel, and we are the only tool in
the list that knows what a whole playgroup physically owns — because we are the only one that
was built for a playgroup rather than for an account. Several proposals below are only good
*because* of that; they are not catch-up, they are the thing this app can do that Moxfield
structurally cannot.

## Ground truth — what exists today

**The data.** A deck is `deck_cards(deck_id, card_name, qty, category, position)` with primary
key `(deck_id, card_name)`, plus `deck_categories(deck_id, name, position)`. Saving is
`PUT …/cards`, which deletes every row for the deck and re-inserts — a full destructive
replace inside one transaction. Deck metadata (name, commander, art, url, and an unused
`bracket` field) lives in the `app_state` JSON blob, versioned with an optimistic-concurrency
counter.

Consequences worth stating plainly, because most of the proposals below run into them:

- A card exists **once** per deck. There is no board, no second copy in a different category,
  and no way to say "this is the version I'm considering".
- A card is a **name**, not a printing. No set, no collector number, no foil flag.
- There is **no history**, and `_dbScheduleSave()` debounces at **800 ms** before firing the
  full-replace `PUT`. A mis-click, a bad paste-import or a deleted category is gone about a
  second later. That debounce is also why "snapshot on every save" is not a viable history
  rule — see proposal 5.
- **A commander is a single string** (`commander` on the deck record, alongside
  `commanderImg`). Partners, Backgrounds and Doctor's Companions — two commanders — are not
  representable in it.
- **Deck cards are fetched one deck at a time** (`GET …/decks/:deckId/cards`). Nothing loads
  the whole group's decks at once, which is what contention in proposal 1 needs.

**Identity.** A session carries a `playerId` (`middleware/auth.js`), and players own decks and
want lists. Two gaps matter below: **`collections` has no owner column at all** — it is `key,
name, source, col_id, color`, and `sfCardOwnership()` simply walks every loaded collection, so
the app cannot currently say which shelf is whose. And in **open mode** (no `ADMIN_PASSWORD`)
`getSession()` returns `playerId: null` outright, so there is no logged-in player to be. Open
mode does have a browser-remembered identity — `availName` in localStorage, which the
Available@ tab's "Who are you?" bar writes — but it is a free-text name, not a player id.

**Carrying a card.** `cardCarryDrop(cardNames, targetCategory)` in `deckview-panels.js` only
ever accepts an **existing** category. `ui.md` specified the other half — *"dragging a card
onto empty mat space (or a 'new pile' drop zone) creates a new category from it and moves the
card in"* — and it was scoped out and never shipped. A drop that lands anywhere other than a
category currently means **cancel**: the cards go back where they came from and nothing
changes. That gesture is worth protecting, and the frame section below does.

**The card facts.** `scryfall-db.js` keeps a daily copy of Scryfall's `oracle_cards` bulk file
in SQLite, trimmed by `trimCard()` to the fields the client uses. It carries name, mana cost,
cmc, type line, oracle text, colors, colour identity, power/toughness, rarity, set, collector
number, prices (usd/eur, normal and foil), and images. It does **not** carry `legalities`,
`keywords`, `produced_mana`, `game_changer`, `edhrec_rank`, or `reserved`. Those are four
lines in `trimCard` away and cost a few MB of database.

`oracle_cards` is one row per *oracle card*, not per printing — which is why "choose your
printing" is the one expensive proposal here.

**The analysis.** `dbRenderStats()` in `deckview-render.js`, about fifty lines: card count vs.
a target of 60 or 99, land count by type-line substring, average CMC excluding lands and
commander, colour-identity pip tallies, and an eight-bucket curve. Nothing else.

**The filter.** `_dbMatchesFilter()` is `name.includes(q) || oracle_text.includes(q)`.

**What we already have that these proposals reuse.** `cardquery.js` (new, uncommitted) is a
full Scryfall-syntax parser that runs against the local card cache — built for Collections,
directly reusable. `sfCardOwnership()` already answers "who owns this card" per card. The
EDHREC proxy in `routes/proxy.js` is the exact shape a Commander Spellbook proxy would take.
The mat already animates arbitrary card movement via FLIP. The Mana Base Calculator already
does the pip-proportional land maths — it just makes you type the pips in by hand.

---

## First, the frame

This section did not come out of the competitive survey. It comes out of reading the ten
proposals below together and noticing what they do to the tab.

**The tab already spends a lot of screen on not-cards.** A toolbar, a More menu, a filter box,
a sort control, a size slider, a view toggle, a stats bar, a bulk-action bar when something is
selected, and a drawer. Now add what follows: a legality line, a bracket chip, an ownership
readout, a price total, a type breakdown, a colour-split curve, a sources-vs-pips panel, a
combos list, a notes panel, a history panel, a maybeboard region, a sideboard region. Added
one strip at a time, each of them reasonable, the mat ends up in a letterbox — and the whole
premise of `spec-cards-as-objects.md` is that the cards are the content.

So the frame comes first, and everything above lands inside it.

### One toolbar, hidden in two tiers

Everything that is not a card lives in **one toolbar**, and that toolbar folds away — but not
all of it at once, because "chrome" turns out to be two different things.

**What you act *with* hides on the first press:** view toggle, size slider, sort, filter,
More, the board toggles, the ownership scope control. All of it, gone — not a narrower
toolbar.

**What the deck *is* stays:** one thin line of readout — `87/99 · legal · B3 · €340 · 34
owned`. That is where every number the proposals below produce ends up, and it is the half you
want *while* building rather than in between. **A second press hides that too**, for a true
cards-only mat.

The line is principled rather than a compromise, and the markup already draws it: `#dbStatsBar`
is a separate element from the toolbar today. Controls are the interface; the readout is the
deck describing itself.

- Analysis beyond that one line — the curve, the sources-vs-pips panel, the type breakdown —
  is a section of the toolbar that *expands*, never a permanent strip.
- Both collapse states persist per view in the same prefs store `sortui.js` already uses for
  sort, size and columns, so a deck you read at full mat comes back at full mat.
- It matters most on a phone, where the chrome currently costs proportionally the most and the
  cards the least.

The existing sidebar already does exactly this — collapse to icons, state remembered across
reloads — so this is a pattern the app has, applied to the tab that needs it most.

**Rejected:** reveal-on-hover-near-the-top-edge. The mat is a drag surface, and carrying a
card towards a category high on the screen would trigger reveals nobody asked for — the
accidental-hover problem `spec-cards-as-objects.md` was careful to design out. Also rejected:
floating the readout over the mat as an overlay, which needs a token-rule exemption for text
over the felt and sits on top of the cards it is describing.

### Board visibility is a toolbar toggle

Boards (proposal 2) are the clearest case for the above. A maybeboard is consulted
occasionally and would otherwise hold permanent mat space for cards that are *not in the
deck*. So the toolbar carries **show/hide toggles per board**, off by default, remembered per
deck. Turn one on and its region appears on the mat; turn it off and the deck is the deck
again.

This is what keeps proposal 2 cheap to live with: the board exists in the data whether or not
it is on screen, and nothing about the mainboard's layout depends on whether you are looking
at it.

**A hidden board still reveals while you are carrying a card.** Otherwise a board you toggled
off is a place you cannot put anything, and the only route into it is the Move to… modal — which
is the opposite of what the mat is for.

### The ghost pile — dropping a card to make a category

`ui.md` asked for this and it never shipped: `cardCarryDrop()` only accepts categories that
already exist, so the only way to make one is the modal.

**Build:** a permanent **ghost pile** — an empty outline sitting after the last category, faint
at rest and lit while a card is being carried. Drop on it and it becomes a real category with
the card in it, named in place. Being permanent is the point: the affordance is visible when
your hands are empty, so it can be discovered rather than stumbled into.

It lives **on the mat, never in the toolbar** — a drop target inside chrome that can be hidden
is a drop target you cannot reach.

**Rejected:** `ui.md`'s own first suggestion, that dropping on empty mat space creates the
category. Empty mat already means *cancel* — released anywhere loose, the cards go back and
nothing changes — and that safety is exactly what makes carrying cards feel free. Overloading
it would turn every fumbled drop into a junk category, and moving cancel onto Esc trades a
gesture that needs no explanation for one that does.

### The commander is a board, not a zone

**Today a commander is a category holding one card.** It takes a full category header, a pile,
and a row of mat to say something the deck already knows — `dbDeck.commander` is set when the
deck is created, the stats bar already excludes it from the 99, EDHREC already keys its whole
panel off it, and colour identity comes from it.

**Build:** once proposal 2 introduces `board`, the commander is simply `board='commander'` —
which is how Moxfield models it. That is the whole design:

- **Partners, Backgrounds and Doctor's Companions are free.** Two commanders are two rows in
  that board. Nothing has to be decided about whether `commander` becomes an array, and the
  single-string field on the deck record is left alone to go on doing its real job: the tile
  art and the EDHREC slug.
- **The show/hide control is free**, because boards already have one.
- **Migration is one statement** — `UPDATE deck_cards SET board='commander' WHERE
  category='Commander'` — and `Commander` comes out of `DEFAULT_CATEGORIES` in
  `routes/decks.js`. A deck with cards in that category but no commander on the record adopts
  the first as its commander.
- It renders at the head of the mat, and it is where the things that are genuinely *about* the
  commander belong: colour identity, the bracket estimate, the EDHREC link, and the legality
  check that a card outside the identity has snuck in.

**This makes proposal 2 a prerequisite of the commander zone**, and the running order below
reflects that — they are one piece of work, not two.

**Rejected:** keeping `Commander` as a category and special-casing its rendering. The category
is what makes it cost space and take part in sorts, group-bys and bulk moves it has no
business being in; half-removing it leaves every one of those special-cased forever. Also
rejected: making `commander` an array on the deck record, which would ship without waiting for
boards but leaves two places — the record and `deck_cards` — both claiming to say who the
commander is.

---

## The ten

Ordered by value per unit of work. Each says what the field does, what we'd build, why it
belongs *here* specifically, and what it costs. All of it lands inside the frame above.

### 1. The deck knows what the group owns

**The field:** Archidekt lets you "build with only cards that you own" against your own
collection. Moxfield has nothing comparable. Neither has ever seen a second person's shelf.

**Today:** every card in the mat already wears an ownership badge from `sfCardOwnership()`.
That is the per-card answer. There is no deck-level one, and no way to act on it.

**Build:**

**The default is *your* cards, not the group's** — but it scopes what "owned" *means*, it does
not filter the mat. Every card in the deck stays on the mat, always. What changes is that the
badges and the readout answer against your collection rather than totting up everyone's,
because "can I sleeve this tonight" is the question a person building a deck is actually
asking. The group's shelf is the *second* question — "who could lend me this" — and it is one
click away rather than the thing you read past.

Three scopes, **Mine** (default) → **Ours** → **All collections**, as a control in the toolbar
beside the readout, remembered per user.

**Rejected:** defaulting the *mat* to only cards you own. A deck builder that hides cards which
are in your deck is hiding your deck — the count, the curve and the pile shape all stop
describing the thing you are building, and the stats bar would have to caption which of three
numbers it meant. Also rejected: dimming unowned cards on the mat, which is a third card state
to reconcile with lift and selected across five themes, for information the readout already
gives.

- A **deck ownership readout** in the stats bar — *"87 of 99 owned"*, meaning owned **by
  you** — that opens a panel breaking the missing twelve out: nine sitting in someone else's
  collection (named, in their identity colour), three that nobody in the group owns.
- **Filtering belongs in search, not on the mat.** The Search drawer — where you are choosing
  what to *add* — gets an **owned by me / owned by the group** toggle. That is Archidekt's
  "build with only cards you own", put at the point where it helps.
  **It queries the local shelf, not Scryfall:** run `cardquery.js` over the loaded collections
  rather than post-filtering Scryfall pages, or a page of 175 results yields three owned cards
  and reads as broken. "Find me a card I own that does X" is a question about our shelf, not
  about Magic.
- A **filter chip** on the mat is still available — *Missing*, *Owned*, *Owned by someone
  else* — just off by default. It reuses the existing filter pipeline, so it composes with the
  search box and the sort.
- **Send missing to my want list** — one action, straight into the Want Lists tab, which
  already exists and already knows how to hold a per-player list of cards.
- **Contention**: *"Sol Ring is in four other decks and the group owns one."* Compute it by
  intersecting `deck_cards` across every deck against the collection totals.

**Prerequisite — collections have no owner.** This has to be built before any of the above can
mean anything, and it is useful well past this proposal: an **`owner_player_id`** column on
`collections`, set when a collection is added and editable from the "⋯" menu that already
exists on each collection row. One collection, one owner.

Nullable, and the null case is real rather than a loophole: a shared box belongs to the group,
so it counts in **Ours** and never in **Mine**. With the column in place *Mine* is a filter on
a field, and the Collections tab gets the same scope control for free.

**Rejected:** a `collection_owners` join table. It models a jointly-owned box faithfully, but
it is a many-to-many plus its editing UI for a relationship that is almost always one-to-one,
and owner-null already expresses the shared box honestly. Also rejected: storing "which
collections are mine" as a per-user preference — it needs no schema change, but then nothing in
the database knows whose shelf is whose, and *"nine are in someone else's collection, here's
who"* is half of what makes this proposal worth building.

**Open mode has no logged-in player.** `getSession()` returns `playerId: null` when there is no
`ADMIN_PASSWORD`, so "Mine" has no referent. Fall back to the identity the app already keeps
for exactly this case: `availName`, the browser-remembered name behind Available@'s "Who are
you?" bar. Match it to a player by name; if it matches nothing, the scope control does not
render at all and everything is **Ours**. No new identity concept, and open mode is a
single-household deployment where "ours" is very often the honest answer anyway.

**Why here:** this is the feature that justifies the app existing. A playgroup that shares
physical cards has exactly two recurring problems — *what do we need to buy* and *whose deck
loses the Sol Ring tonight* — and no commercial builder can answer either, because none of
them knows there is a group. Contention in particular ties the Deck Builder to Players & Decks
and Pick Night: if tonight's six picked decks collectively need three copies of a card the
group owns one of, the app is the only thing in the room that knows before someone sits down.

**Cost:** the roll-up is small — the open deck and the collections are already client-side, so
"87 of 99" is a reduce over data in hand, and the scope control is a filter on the new column.

**Contention is the expensive half, and it is a separate ticket.** Deck cards are fetched one
deck at a time (`GET …/decks/:deckId/cards`); nothing ever loads the whole group's decks. So
"Sol Ring is in four other decks" needs a **new server-side endpoint** that answers the
question in SQL — one `GROUP BY card_name` across `deck_cards` joined against collection
totals — rather than the client pulling sixty decks to count them. That is the right shape
anyway: the server already has every row, and the answer is a few hundred bytes.

No new external calls. One column added to `collections`, one new read endpoint.

---

### 2. Boards — maybeboard, sideboard, considering

**The field:** universal. Moxfield has mainboard/sideboard/maybeboard as first-class sections;
Archidekt has "pinning", a visual clipboard of up to 150 cards you can filter, sort, and drop
into any deck; Deckstats has a sideboard.

**Today:** we have none of it. A card you are considering has to either go into the deck and
break the count, or live in your head.

**Build:** a `board` column on `deck_cards` — **`'commander' | 'main' | 'side' | 'maybe'`**,
default `'main'` — with the primary key widened to `(deck_id, board, card_name)` so the same
card can sit in the maybeboard while a copy is in the deck. The stats bar, the export, the
legality check and the ownership roll-up all read the mainboard only (plus the commander
board, where the format wants it).

`board` is a `TEXT` column, so the set of boards is open: a format that wants another one
later costs a new value, not a migration.

**Non-main boards render flat** — one spread pile with a count, no category headers. A
maybeboard is a holding area, not a second deck, and giving it ten headers to scroll past
defeats the point of having somewhere to put things. The `category` value still rides along on
the row, so a card promoted into the mainboard lands back where it belongs instead of arriving
uncategorised.

In the UI a board is **another region of the mat** — a strip below the categories, worked with
the same carry you already have. Not a modal, not a second tab. The pile metaphor already says
exactly the right thing about a maybeboard: it is a stack of cards sitting to one side of the
table.

It is **hidden by default and toggled from the toolbar**, per the frame above, and **reveals
while a card is being carried** so a hidden board is still somewhere you can put something.

**The commander board is the same mechanism** — see the frame. That is what makes this
proposal load-bearing rather than merely useful: it is the prerequisite for the commander
zone, and the two ship together.

**Why here:** it is the single most-used feature we lack, and the mat is a better home for it
than a sidebar list. It also unblocks proposal 5 — a "considering" pile is where a card goes
when you undo it out of the deck rather than deleting it.

**Cost:** small–medium. One migration (`ALTER TABLE ADD COLUMN` plus a PK rebuild — SQLite
needs a table copy, and `available-db.js` already has a migrations section that does this kind
of thing), plus the one-line `UPDATE` that turns the old `Commander` category into a board,
one field threaded through the save/load path, and mat regions that reuse `_dbRenderSection`.

**Rejected:** a separate `deck_maybe` table. Two tables that hold the same shape means every
read, every move and every export forks. The board is an attribute of the card's placement,
which is what a column is for. Also rejected: giving every board its own categories — it
reuses `_dbRenderSection` wholesale so it is barely more code, but it doubles the vertical
space a shown board costs, which is the thing the frame exists to fight.

---

### 3. Legality, brackets, and Game Changers

**The field:** every builder validates format legality and says *why* a deck fails. Since
February 2025 both Moxfield and Archidekt also implement WotC's official five-bracket
Commander system — Exhibition, Core, Upgraded, Optimized, cEDH — which is defined largely by
the **Game Changers** list (53 cards as of the February 2026 update), plus tutors, extra
turns, mass land denial and two-card infinite combos.

**Today:** nothing. Notably, `normalizeDeck()` in `routes/state.js` already carries a
`bracket` field on every deck record. It is written, round-tripped, permission-checked — and
never read or set by anything. Someone meant to do this.

**Build:**

- Add `legalities` and `game_changer` to `trimCard()`. Scryfall exposes `game_changer: true`
  on the card object and `is:gamechanger` in search; both come free in the bulk file we
  already download nightly.
- A **legality line** in the stats bar for the deck's format: legal, or the specific reason —
  wrong count, colour identity violation, banned card, too many copies. Colour-identity
  violation is the one that actually bites Commander players and we can already compute it.
- A **bracket estimate**: count Game Changers, flag mass land denial and extra-turn effects by
  oracle text, and place the deck in a bracket with the reasoning shown. Four or more Game
  Changers forces bracket 4; three or fewer allows bracket 3. Store the player's *declared*
  bracket in the field that already exists, and show the estimate beside it.
- Surface the declared bracket as a **chip on the deck tile** in Players & Decks, and let Pick
  Night **filter the pool by bracket** — so "tonight is a bracket 2 night" is a thing the app
  can arrange.

**Why here:** legality is table stakes. The bracket is the interesting half: a playgroup's
recurring argument is about power level, and this app is where the playgroup's decks already
live. Pick Night filtering by bracket is a cross-tab payoff no other tool is positioned to
give.

**Cost:** small. Two fields in the bulk trim, one comparison function, one chip. The bracket
heuristic is imperfect by nature — WotC's own system is a self-assessment — so it must be
presented as *estimate, and here's why*, never as a verdict.

---

### 4. The Mana Base Calculator reads the deck

**The field:** Moxfield gives per-colour curves, a colour-ratio analysis comparing the pips
your cards demand against the sources your lands produce, average CMC with and without lands,
and opening-hand land statistics. Archidekt offers landbase suggestions.

**Today:** we have a **Mana Base Calculator tab** that does the right maths — proportional
basics by pip count, largest-remainder so the numbers add up — and makes you **type the pips
in by hand**, one number per colour, while the deck holding every one of those numbers sits
one tab away.

**Build:**

- A **"Use this deck"** control that fills the calculator from the open deck: pips counted off
  actual mana costs (not colour identity, which is what the stats bar currently counts and is
  the wrong number for this question), non-basic lands counted off the deck's own land
  category.
- Add `produced_mana` to `trimCard()` and show the other half: **sources vs. pips**. *Your
  spells want 34 white pips and 12 blue; your lands make 18 white sources and 19 blue.* That
  comparison is the single most useful thing an analysis panel can say, and it is the one
  Moxfield users cite.
- Fold the result back as an inline panel in the Deck Builder rather than only living on its
  own tab — the calculator tab stays, for the case where you are working out a mana base
  before there is a deck.

**Why here:** it is the most embarrassing gap in the app, because we already wrote the hard
part. Two features that share a domain sit in two tabs and don't speak.

**Cost:** small. One field in the trim, one pip-counting pass, one panel. No new UI concepts.

---

### 5. Deck history

**The field:** Moxfield tracks every card change on a History page. Archidekt calls its
version history "an incredible deckbuilding time machine".

**Today:** `PUT …/cards` deletes every row and re-inserts. Autosave fires on a debounce. A
deleted category, a mis-aimed bulk move, or a paste-import into the wrong deck is
unrecoverable the instant that fires. This is the one gap on the list that can *lose work*.

**Build:** a `deck_snapshots(deck_id, taken_at, cards_json, reason)` table. The save path is
already a full replace of a known shape, which is precisely the shape that snapshots trivially
— no diffing engine needed.

**When it writes is the whole design**, because `_dbScheduleSave()` debounces at 800 ms:
snapshotting every save would write a row a second and a 50-row cap would then hold about
eight minutes of history, silently evicting the state you actually wanted back. So:

- **One snapshot per editing burst.** Changes settle, ~30 s of idle passes — or you switch
  deck, or the tab unloads — and one row is written. That is the natural unit: *what the deck
  looked like when I sat down.* Roughly a handful of rows an hour rather than thousands.
- **Plus a forced snapshot immediately before anything bulk or destructive** — paste-import,
  CSV import, delete category, bulk move, delete deck — tagged with the reason. Those are the
  operations that lose work, and the pre-import state is captured exactly rather than
  approximately.
- Cap per deck (say 50) and by age (say 90 days), whichever bites first. At this write rate a
  cap of 50 is months of real history rather than one session's.

Then:

- A **History panel**: a list of saves, each showing what changed relative to the one before
  (computed on read, cheaply, since both sides are small JSON), and **Restore**.
- Restore writes a new snapshot first, so undoing an undo works.

**Rejected:** snapshot-on-every-save, for the eviction reason above. Also rejected: manual
"save version" buttons as the only mechanism — every stored version is then meaningful and
named, which is nice, but it protects only the people who remembered to press it, and the
mis-click you want to undo is by definition the one you did not see coming. A manual "name
this version" can sit on top of the automatic rule later.

**Why here:** every other proposal makes the tab do more. This one makes it safe to do more.
It is also the cheapest insurance available given the destructive-replace save we already
have, and it pairs with proposal 2 — restoring a card to the maybeboard rather than the deck.

**Cost:** small–medium. One table, one insert on the existing save path, one panel. The
diff-on-read is a set comparison over a few hundred names.

**Rejected:** an in-memory undo stack. It dies on refresh, doesn't survive the tab switch that
the app is built around, and cannot answer "what did this deck look like last month".

---

### 6. Sample hands on the mat

**The field:** everyone. Moxfield deals sample hands of seven and has a full sandbox with
hotkeys; Archidekt's playtester has hand/battlefield/graveyard/exile zones, counters, life
totals, and fifteen-plus keybinds; Deckstats has starting hands plus automatic draw
probabilities.

**Today:** nothing. You cannot see what this deck opens on without shuffling the physical
cards — which, for a deck you have not built yet, is the whole problem.

**Build:** **not a playtester.** A sample hand.

- **Draw 7** clears the mat to a hand of seven real cards, laid out at the size the slider is
  already set to, using the lift and the shadow the cards already have.
- **Mulligan** with a counter; **Draw one more** to keep goldfishing; **Reshuffle**.
- A line under it: *"3 lands · avg MV 2.4 · castable on curve: 4 of 7."*
- Beside it, a **hypergeometric calculator** — *"what are the odds of at least N of a group in
  my opening hand"* — seeded from the deck's own numbers rather than made you fill in a form.
  This is a request Moxfield users have filed and the maths is twenty lines.

**Why here:** it is the natural next thing for a mat that already treats cards as physical
objects and already animates them moving. Dealing seven cards onto the table is the animation
we have built and not yet used for anything. And it is a *deck-building* question — is this
mana base right, does this curve work — which is what this tab is for.

**Cost:** medium. The maths is trivial; the mat state (a temporary "hand" layout that isn't a
category) is the real work, and it must not be able to touch the saved deck.

**Rejected:** a full playtester with zones, counters and a battlefield. It is a different
application — Archidekt's is criticised for exactly the friction that comes with the scope —
and this is a self-hosted tool for a playgroup that plays in person. They have a table.

---

### 7. Scryfall syntax inside the deck

**The field:** Archidekt supports Scryfall syntax filters inside the deck editor (`o:target`
and so on), alongside filters for type, colour, tags, and collection status.

**Today:** `_dbMatchesFilter()` is a substring test against name and oracle text.

**Build:** point the Deck Builder's filter box at `parseCardQuery()` from `cardquery.js`. The
parser is already written, already runs against the same local card cache the mat reads
through `cardMetaOf`, already compiles once per keystroke, and already refuses unanswerable
filters by name rather than returning nothing. Keep bare words as the substring search they
are today, so nobody has to learn a language to type "goblin".

Then the filter composes with proposal 1: `-owned`, `is:gamechanger`, `mv>=5 t:creature`.

**Why here:** it is nearly free. The module exists, the cache it needs exists, and Collections
is about to prove it works on a far larger row count than any deck will ever have.

**Cost:** trivial. Wire one function; add the ownership and Game Changer predicates as new
`is:` terms.

---

### 8. Deck totals and price

**The field:** every builder shows a deck's total cost, usually in several currencies and
against several vendors, and most break it down by board.

**Today:** each card shows its own price. The deck shows no total. The app is otherwise
thoroughly EUR/Cardmarket-oriented, which is right for the audience.

**Build:** a price figure in the stats bar — deck total, and (with proposal 1) **the total of
what's missing**, which is the number that actually matters: not what the deck is worth but
what finishing it costs. Sortable and filterable through the same query. Both `eur` and
`eur_foil` are already in the local cache, so this is a reduce.

Alongside it, the rest of the counts the stats bar should be carrying: type breakdown
(creatures / instants / sorceries / …), spell-vs-permanent split, and the curve split by
colour rather than one merged set of bars.

**Why here:** cheap, obvious, and "what does finishing this deck cost" is the group's actual
question.

**Cost:** trivial to small.

---

### 9. Combo and interaction detection

**The field:** Commander Spellbook is the shared backend — Archidekt integrates it, and it is
one of Moxfield's most-requested features. Its `find-my-combos` endpoint takes a decklist and
returns the combos in it; there is also an `estimate-bracket` endpoint that does the bracket
classification from proposal 3 properly rather than heuristically.

**Today:** nothing. The app can tell you a deck's curve but not that it contains an infinite
loop.

**Build:** a server-side proxy in the shape of the EDHREC one already in `routes/proxy.js` —
same cache, same TTL, same rate discipline — plus a **Combos** panel in the search drawer
listing what the deck can do, and a *"you are two cards from X"* section, which is the genuinely
generative half: near-miss combos are deck-building suggestions.

Feed `estimate-bracket` into proposal 3 so the bracket estimate stops being our heuristic.

**Why here:** it answers the one question about a deck that neither the curve nor the pile
shape can — *what does it actually do* — and it is the deck-building equivalent of the EDHREC
panel we already built and already like.

**Cost:** medium. The proxy is a copy of code we have. The mapping from our card names to
Spellbook's card ids, and the near-miss UI, are the real work. It adds a second external
dependency to a tab that currently has one, so it must degrade to "combos unavailable" as
cleanly as the EDHREC panel does.

---

### 10. Notes and primers

**The field:** Moxfield has a full Markdown primer editor with syntax highlighting, split
preview and an auto-generated table of contents. Archidekt and Deckstats both support deck
descriptions. Archidekt adds community deck-help threads.

**Today:** a deck has a name, a commander, and a link. Nowhere to write down what it does.

**Build:** a **Notes** panel on the deck — plain Markdown, rendered, saved with the deck. Not
a rich editor; a textarea and a preview. Then surface it where it pays off: the deck tile in
Players & Decks gets a note indicator, and **Pick Night shows the primer when it assigns you
someone else's deck** — which is the moment in this app when a person most needs to know how a
deck is supposed to work.

Optionally, per-card notes — *"in for the Doubling Season line"* — which is what a maybeboard
card usually needs more than a category.

**Why here:** Pick Night makes it different from every other primer feature. On Moxfield a
primer is content you publish for strangers. Here it is a handover note to the four people who
are going to play your deck.

**Cost:** small, if the Markdown rendering stays minimal — headings, lists, bold, links, card
names. A dependency-free renderer is a couple of hundred lines and the app has no build step,
so pulling in a library is not free the way it would be elsewhere.

---

## The one that isn't worth it yet — printings and foils

Every competitor lets you pick which printing of a card is in your deck, see the price of that
specific printing, mark it foil, and see the deck as the art you actually own. It is the most
visible remaining difference between our mat and Archidekt's, because on a tab whose entire
premise is *cards as objects*, showing the wrong art is showing the wrong object.

It is also the most expensive thing on this list, and the cost is structural:

- `deck_cards` keys on `card_name`. Printings mean a `scryfall_id` (or set + collector number)
  on every row, and everything that joins on name — import, paste, export, comparison,
  ownership, want lists — has to learn that a name is no longer the identity.
- The local cache is Scryfall's `oracle_cards` bulk file: **one row per card, not per
  printing.** Printings need `default_cards`, which is roughly an order of magnitude larger,
  and the trim, the indexes, the nightly refresh and the disk budget all move with it. That
  cost lands on a self-hosted box in someone's house.
- Collections are name-keyed too, so "show me the deck in the art I own" needs the collection
  importers to start carrying set codes.

Worth doing eventually. Not worth doing before the ten above, and worth its own spec when it
is — the database decision is the whole of it.

---

## Dependencies

Everything not listed here is independent and can be picked up in any order.

| This | needs | because |
|---|---|---|
| Commander zone (frame) | **boards (2)** | the commander *is* `board='commander'` |
| Board toggles (frame) | **boards (2)** | nothing to toggle otherwise |
| Ghost pile (frame) | — | independent; only touches `cardCarryDrop` |
| Toolbar hiding (frame) | — | independent; ships before there's much to hide |
| Ownership readout (1) | `owner_player_id` column | "Mine" has no meaning without it |
| Search owned-toggle (1) | `owner_player_id`, `cardquery.js` | scope needs an owner; query needs the parser |
| Contention (1) | new all-decks endpoint | deck cards are fetched one deck at a time |
| Missing-cards price (8) | ownership readout (1) | needs to know what's missing |
| Deck filter (7) | `cardquery.js` landing | it is the parser |
| `-owned` / `is:gamechanger` in filter (7) | (1) and (3) respectively | the predicates come from those |
| Bracket estimate (3) | `game_changer` in `trimCard` | the list is the input |
| Sources vs. pips (4) | `produced_mana` in `trimCard` | the sources are the input |
| Legality line (3) | `legalities` in `trimCard` | ditto |
| Spellbook bracket (9 → 3) | combos proxy (9) | replaces our heuristic, doesn't block it |
| Everything visual | the frame | it is where the readouts go |

The three `trimCard` additions — `legalities`, `game_changer`, `produced_mana` — are one small
ticket that unblocks three proposals, and worth doing first for that reason alone.

## Suggested order

**First, because it can lose your work:** deck history (5). Independent of everything, small,
and the only item here that is insurance rather than capability.

**Then the frame and boards, as one piece.** Commander-as-board welds them: the board column,
the commander zone, maybe/sideboard, the two-tier toolbar and the ghost pile are a single
coherent change to what the mat *is*. Doing the frame late would mean retro-fitting a dozen
readouts into a toolbar designed around four; doing boards late would mean building the
commander zone twice.

**Then the cheap wins, mostly wiring things we already built to each other:** the three
`trimCard` fields, then the Scryfall filter (7), the mana base reading the deck (4), deck
totals (8), legality and brackets (3).

**Then ownership (1), which is three tickets and not one:** the `owner_player_id` column and
its editing UI; then the deck readout and scope control; then contention, which needs its own
endpoint. The first is worth having on its own — it improves the Collections tab regardless.

**Then the ones that are their own projects:** sample hands (6), combos (9), notes (10).

Printings when the database question has an answer.

## Constraints that apply to all of it

Everything in `docs/design/ui.md` still holds and is not restated here — no framework, no
build step, no bundler; colours, spacing, type and radii from tokens only; five themes; three
breakpoints; 44px touch targets below 900; every animation under a `prefers-reduced-motion`
guard; the token linter fails the build rather than filing a review comment.

Two more specific to this document:

- **No new browser→internet calls.** Combos and any bracket API go through the server proxy
  with a cache and the shared queue, exactly as EDHREC does. The browser never talks to a
  third party directly.
- **Nothing here may make the mat slower.** The FLIP animation is bounded to what is on
  screen, and a deck-wide analysis pass that runs on every render would undo that. Analysis
  recomputes on deck change, not on render.

## Sources

- [Draftsim — Reviewed: The Best Deck Builder for MTG](https://draftsim.com/best-mtg-deck-builder/)
- [Moxfield — Features wiki](https://github.com/moxfield/moxfield-public/wiki/Features)
- [EDHREC — How to Use Archidekt](https://edhrec.com/guides/how-to-use-archidekt-the-mtg-deckbuilding-site)
- [Archidekt — Site info](https://archidekt.com/landing)
- [Wizards — Introducing Commander Brackets Beta](https://magic.wizards.com/en/news/announcements/introducing-commander-brackets-beta)
- [Scryfall — `is:gamechanger`](https://scryfall.com/search?q=is%3Agamechanger)
- [Commander Spellbook — Find My Combos](https://commanderspellbook.com/find-my-combos/)
- [Commander Spellbook — API schema](https://backend.commanderspellbook.com/schema/swagger/)
- [Moxfield feedback — Hypergeometric calculations](https://moxfield.nolt.io/547)
