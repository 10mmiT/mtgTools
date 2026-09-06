# Spec — Printing-aware collections and ownership

Covers steps 1 and 2 of [printings-and-lands.md](printings-and-lands.md). Steps 3
(optimize a deck's printings) and 4 (Land Base tab) are specced separately once this
lands; playtest has its own branch and document.

## Problem Statement

A collection knows that you own three Sol Rings. It does not know *which* Sol Rings.

That gap shows up wherever the app answers an ownership question. The Deck Builder can
tell you that a card in your deck is on someone's shelf, but not whether it is the
printing the deck actually runs — so a deck that reads as fully owned may still be a
deck you cannot physically assemble from the cards in the box, because the shelf holds
a different edition of half of it. Someone checking what to buy has no way to see the
difference, and ends up ordering a card they already own in another set, or failing to
order one they don't.

The information exists. Archidekt sends the printing on every row of its collection
API — the Scryfall id, the set, the collector number, whether it is foil — and the
import discards all of it, keeping only the name and a running quantity.

## Solution

A collection records the printings it holds, not just the names and counts. Each card
carries a breakdown of the physical copies behind its quantity: which edition, which
collector number, which finish, which language, which condition.

Ownership then answers a sharper question. The Deck Builder distinguishes four states
instead of two — you own the printing this deck runs; you own the card but in a
different printing; we do not know which printing you own; you do not own it at all.
The Collections tab shows, per card, which printings are on the shelf.

The fourth state matters as much as the others. No collection has this data until it
is re-imported, and a collection that has not been re-imported must read as *unknown*,
never as *owns none*. Re-importing is offered per collection, and it is a job the
server runs, so it survives closing the page.

## User Stories

1. As someone who owns a collection, I want the app to record which printing of each card I own, so that "I have a Sol Ring" becomes "I have the Commander 2021 Sol Ring".
2. As someone who owns a collection, I want my foils recorded as distinct from my regular copies, so that a foil I paid extra for is not counted as an ordinary one.
3. As someone who owns a collection, I want the printing breakdown to always add up to the quantity I had before, so that gaining this detail never changes how many cards the app thinks I own.
4. As a deck builder, I want to know whether I own the exact printing my deck runs, so that I can tell whether the deck can be built from cards already in the box.
5. As a deck builder, I want to be told when I own a card but in a different printing, so that I can decide whether to change the deck's printing or buy the one it names.
6. As a deck builder, I want the "own it in another printing" state to look different from both "own it" and "do not own it", so that I do not misread a deck as ready to sleeve.
7. As a deck builder, I want ownership to keep working exactly as it does today for collections that have no printing data, so that the feature arriving does not make my existing decks read as unowned.
8. As someone whose collection predates this feature, I want to be told the printing is unknown rather than that I own nothing, so that I do not think my collection has been wiped.
9. As someone whose collection predates this feature, I want an obvious way to re-import it, so that I do not have to work out for myself why the new column is empty.
10. As someone whose collection predates this feature, I want the offer to re-import to appear once and go away when I have acted on it, so that the app is not nagging me forever.
11. As a member of a group, I do not want someone else's collection re-imported on my say-so, so that I am not spending their time or changing their data.
12. As an admin who does own all the collections, I want one action that re-imports all of them, so that I do not have to start each one by hand.
13. As anyone at all, I do not want a re-import to start by itself when the server boots, so that a long job never begins without a person asking for it.
14. As someone re-importing, I want to close the page and come back, so that a four-minute job does not hold my phone awake.
15. As someone browsing the Collections tab, I want to see at a glance which printings a card is owned in, so that I can answer "which one have I got" without opening the card.
16. As someone browsing the Collections tab, I want the table to stay one row per card, so that a shelf of five thousand cards does not become a list of every physical copy.
17. As someone looking at a specific card, I want to see the printings of it that are on the shelf, so that the detailed answer has a home even though the table gives the summary.
18. As someone who searches or sorts their collection, I want everything that worked before to go on working, so that gaining printings costs me none of the existing behaviour.
19. As someone using the want list, the Sets tab or the "cards I own" search scope, I want them to keep answering by card name, so that nothing changes in the places where the printing is not the question.
20. As someone on a phone, I do not want the app to get slower or heavier, so that the extra detail is not paid for on every poll.
21. As someone with a deck history, I do not want new entries to appear for changes nobody made, so that the History panel stays a record of what people did.
22. As someone whose collection came from a CSV rather than the API, I want it to be honest about not knowing the printings, so that a limitation of the export does not look like a bug in the app.
23. As someone who imports from Moxfield, I want the same treatment as Archidekt where the data allows it, so that the choice of site does not silently downgrade the feature.
24. As someone re-importing a collection, I want the previously saved copy to stay readable until the new one lands, so that I am never left with nothing.
25. As someone with the same card in several printings, I want the quantities per printing to be right, so that "two of these and one of those" is recorded as such.
26. As someone whose Archidekt collection records no condition or language, I want the app not to invent a distinction, so that cards are not split apart on fields that carry no information.

## Implementation Decisions

**Printing identity.** A printing is identified by Scryfall id plus finish plus
language plus condition. Foil is not a separate printing in Scryfall's model — it is a
finish on the same id, with its own price — so finish must be part of identity or a
foil and a regular copy collapse into one. Measured against a real collection, full
identity costs one extra entry per five hundred rows.

**Language and condition carry no information today.** Both come back as a constant
code for every row sampled. They are part of identity because they were asked for, and
nothing may be built that depends on them varying until they do.

**The stored shape.** Each card entry keeps its existing fields and gains a breakdown.
This shape encodes the central decision and is given precisely because prose cannot:

```
{
  name: 'Sol Ring',
  qty:  3,                     // the printings always sum to this
  printings: [
    { id, set, collector_number, finish, lang, condition, qty: 2 },
    { id: null, qty: 1 },      // unknown: imported before printings existed
  ],
}
```

**The printings are authoritative; the quantity is their sum.** Anything that cannot be
attributed to a printing goes into an explicit unknown entry with a null id. This makes
"we do not know" a value in the data rather than an absence, so no reader can forget to
handle it — which is the single most likely way this feature breaks.

**The collection map stays keyed by card name.** Every consumer in the app reads a
collection through one narrow interface: a map keyed by name, touched only through
membership, a quantity lookup, and iteration of keys and values. Fifteen call sites
across seven modules use it. Re-keying by printing would break all fifteen at once to
answer a question most of them never ask. The printings hang underneath each entry, and
printing-aware queries are added alongside the name-level ones.

**The ownership query layer.** The existing name-level quantity lookup keeps its
behaviour and its meaning. Two queries are added: the printings owned of a named card,
and whether a specific printing is owned. The second rolls up across language and
condition — those are identity for storage, but a lightly-played German copy is not a
different card for the purpose of "do I own this".

**Deck printings gain a finish.** The deck's printing shape has no finish field, so a
deck cannot currently say it runs the foil. Finish is appended to the end of that
field list and omitted when absent. The order of those fields is load-bearing: deck
history decides whether a state changed by serialising it, so appending rather than
inserting, and omitting rather than defaulting, is what keeps every existing snapshot
byte-identical and stops phantom history rows.

**The import.** The Archidekt collection API already carries the Scryfall id, the set
code and name, the collector number, the foil flag, the condition and the language on
every row. No new API calls are needed. The importer accumulates a per-identity
breakdown as pages land instead of only summing quantities. Moxfield's per-row fields
and a real CSV export's columns must be confirmed before either is promised; where a
source cannot supply printings, its rows go to the unknown entry.

**The migration.** There is none, and there cannot be — the data was never stored, so
it cannot be recovered from disk. Every collection reads as one unknown entry equal to
its quantity until re-imported. Re-import is offered per collection with a bulk action
alongside it, and nothing starts on its own at boot.

**Change detection on the client.** The periodic state refresh currently serialises the
entire payload to decide whether anything changed. Printings roughly triple the raw
payload (they compress away almost entirely on the wire, but the parse and serialise
happen regardless), so the refresh switches to the version counter the server already
maintains for optimistic concurrency, or an ETag.

**Scope of printing-awareness.** Deck ownership and the Collections tab. Want lists,
the Sets tab and the "cards I own" search scope continue to answer by name. Wanting a
specific printing is a different feature from wanting a card and should be asked for
before it is built.

**The Collections table.** One row per card, with a column summarising the printings
held. One row per physical copy would triple the table's length to answer a rarer
question; the card view is where a specific printing is looked at, and it is already
where printings are chosen for decks.

## Testing Decisions

A good test here asserts what someone using the app would notice, and nothing about how
it is arranged internally. It drives the shipped modules — not copies of their logic —
and reads the result from the same surface a person would: the rendered table, the
ownership readout, the stored row. Tests that assert the shape of an intermediate
function are not wanted; tests that assert a collection with no printing data still
reads as owned are the whole point.

Three seams, all of which already exist in the suite. No new seam is introduced.

**Seam A — the client, driven through state hydration.** The shipped client modules are
loaded into a sandbox, a state payload is hydrated, and assertions read the rendered
output. This is the highest seam available and carries most of this spec: the four
ownership states, the Collections table's summary column, and the guarantee that
existing name-level behaviour is unchanged. Prior art: the deck-ownership suite, the
collection-owner suite, and the deck-filter suite, which all use this harness.

**Seam B — the import engine and its routes.** The upstream API is stubbed at the fetch
boundary and the shipped importer runs against it. This is where the parse is proved:
that rows become a per-identity breakdown, that the breakdown always sums to the
quantity, that a source with no printing data lands in the unknown entry, and that
quantities per printing are right when a card appears in several. The existing import
suite already tests both the engine and its routes in one file and is extended rather
than duplicated. This cannot move to seam A — the sum-to-quantity invariant has to hold
before anything reaches the client, and asserting it through rendered output would
prove it only for the cases the renderer happens to show.

**Seam C — the database's own shape helpers.** A database written in the older shape is
opened by the shipped schema module, so the migration under test is the real one. This
is where two things are held: that a collection stored before printings existed reads
as one unknown entry rather than as empty, and that adding a finish to the deck printing
field list leaves existing deck snapshots serialising byte-for-byte. Prior art: the
deck-printing suite, which was written for exactly this kind of survival question, and
the "column" layer of the collection-owner suite. This cannot move to seam A either —
byte-for-byte snapshot stability is only observable at the database boundary, and it is
the change most likely to produce a silent regression in the History panel.

Every test file in this suite opens with a prose header explaining the failure it
exists to prevent; these follow that convention. New files are registered in the test
script, as the suite requires.

## Out of Scope

- **Optimizing a deck's printings** — cheapest, most expensive, and prefer-what-I-own. Depends on this spec and is specced separately.
- **The Land Base tab.** Independent of this work.
- **Playtest.** Its own branch and document.
- **Want lists, the Sets tab and the "cards I own" search scope becoming printing-aware.** They stay name-level until a use case asks otherwise.
- **The Available@ tab.** It is the group availability calendar and has nothing to do with cards; an earlier draft listed it in error.
- **Any behaviour that depends on condition or language varying.** Both are constant in the data available today.
- **Recording printings for sources that cannot supply them.** Where an export lacks the columns, the rows go to the unknown entry rather than being guessed at.
- **Retiring the standalone Mana Base Calculator.** It is kept deliberately; it serves draft and sealed, where no deck is built on the site.

## Further Notes

The riskiest part of this work is not the parsing. It is the unknown state: every
collection in existence starts there, and a readout that treats "no printing recorded"
as "does not own it" would tell people their collections are empty. Putting the unknown
into the data as an explicit entry, rather than leaving it as an absent field each
reader must remember, is the mitigation — and it is worth testing directly rather than
incidentally.

The second risk is quieter. Adding a field to the deck printing shape touches
serialisation that deck history uses to decide whether anything changed. Appended and
omitted-when-absent is the design that avoids it, but it should be proved against a
snapshot written before the change, early rather than late.

The payload concern that motivated the change-detection work turned out to be smaller
than it looked: the new fields are highly repetitive and compress to almost nothing over
the wire. The cost that remains is parse and serialise on the client, which is why the
fix is to stop serialising the whole payload rather than to send less of it.
