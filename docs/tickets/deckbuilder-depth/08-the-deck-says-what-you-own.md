# 08 — The deck says what you own

**What to build:** the deck answers *can I sleeve this tonight*, and then *who could lend me the
rest*.

Every card on the mat already wears an ownership badge. What is missing is the deck-level answer and
any way to act on it. This ticket adds **"87 of 99 owned"** to the readout — meaning owned by *you*
— which opens to break the missing twelve out: the ones sitting in somebody else's collection, named
and in their own colour, and the ones nobody in the group has at all.

**It scopes what "owned" means; it does not filter the mat.** Every card in the deck stays on the
mat, always. A deck builder that hides cards which are in your deck is hiding your deck — the count,
the curve and the pile shape would all stop describing the thing being built. What changes is the
question the badges and the readout answer: yours by default, then the group's, then every
collection loaded, chosen from the toolbar and remembered.

**Filtering belongs where you are choosing what to add.** The search panel gets an *owned by me /
owned by the group* toggle — the "build only with cards you own" idea, put at the point where it
helps. It must query the local shelf rather than filtering results that came back from elsewhere: a
page of search results narrowed to the three you happen to own reads as broken, and "find me a card
I own that does X" is a question about our shelves, not about Magic. A filter chip on the mat —
missing, owned, owned by someone else — stays available for the cases that want it, off by default.

Cards nobody owns can be **sent to your want list** in one action.

From `spec-deckbuilder-depth.md` → proposal 1. Rejected there: defaulting the mat to only cards you
own, and dimming unowned cards on the mat.

**Blocked by:** 07 — A collection has an owner.

**Status:** done

- [x] The readout says how many of the deck you own, defaulting to your own collections
- [x] The scope can be changed to the group's shelves or to every collection, and is remembered per person
- [x] Opening the readout lists what is missing, separating what someone else has — named — from what nobody has
- [x] Every card in the deck stays on the mat at every scope
- [x] The search panel can narrow to cards you own or the group owns, answered from the local shelves rather than by discarding results
- [x] Missing cards can be sent to your want list in one action, and arrive there
- [x] The mat's ownership filter chip exists and is off by default
- [x] The readout counts the mainboard, and does not count the maybeboard
- [x] In open mode with no resolvable identity, the readout reads as the group's rather than breaking
- [x] A card in no collection at all is reported as owned by nobody, not as an error
- [x] Works in all five themes and at every breakpoint
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

## What was built

`public/js/deckview-owned.js` — one module, and everything on the tab that has
an opinion about ownership now asks it rather than answering for itself.

### Three questions, on a ladder

`DB_OWN_SCOPES` is **mine**, **the group's**, **everyone's**, and the second
includes the first. That is the one design decision worth arguing about, and it
falls out of what the number is read as: one sentence getting looser — what I
can sleeve tonight, what the group can put on the table, what exists among us at
all. A shared box belongs to everybody, so it is not a *different* set of cards
from yours; it is more of them. Mine is the default, because "can I sleeve this
tonight" is the question somebody building a deck is actually asking.

`dbOwnShelf(scope)` is the whole of the scoping, and it takes the scope as an
argument for exactly one caller: the search drawer asks the same question of a
different scope than the readout is on, and one rule about whose shelf is whose
is better than two that can drift apart. Whose a collection is stays
`colOwner()`'s — ticket 07's rule that nothing else reads the field holds.

The scope is remembered **per person**, keyed by `myPlayerId()`, not per
browser. Two people share a browser in open mode, where being somebody is a name
typed into Available@'s bar, and "mine" means something different to each of
them.

### The number counts copies, and counts the mainboard

Both halves have a way of quietly going wrong and both are asserted. Four
Forests with two on the shelf is **two short**, not "owned" — the readout would
otherwise be lying about the only thing it is for. And it is `dbMainCards()`, so
a maybeboard cannot flatter it: the whole reason to have somewhere to put a card
you are considering is that putting it there costs the deck nothing.

### It scopes the question; it never takes a card off the mat

The mat draws every card in the deck at every scope. What changes is what the
badges say: `dbCardOwnership()` draws the shelf's badges, and where the shelf has
none of a card it names whoever *does* have it, in that person's own colour and
set back a step. That is "who could lend me the rest", said on the card.

The one filter is asked for by hand and is off until it is: three chips —
**Missing**, **Owned**, **Borrowable** — one at a time, and not remembered,
because filtering the mat by ownership is a thing you do for a minute and not a
state a deck should come back in. Putting a deck down clears it, the way it
clears the filter box.

`is:owned` also lands in `js/cardquery.js`, which had been holding a line open
for it. It is a fact about the collections rather than about the card, so the
*caller* supplies it: `true` on the Collections tab, where a row is on the shelf
being looked at by definition, and "the deck has every copy it asks for" in the
builder. The chip is the discoverable form; the box is the composable one —
`-is:owned t:artifact` is a sentence now.

### The missing list

Opened out of the readout — a number you cannot open is a number you have to go
and count somewhere else — and anchored inside `.db-stats-bar` so it rises out of
the line it belongs to, goes where that line goes at each width, and disappears
with it on the second fold.

Two lists, because they are two problems: a card somebody else has is an
evening's borrowing, and a card nobody has is a purchase. **+ Want all** takes no
list — it recomputes what is still missing and still unwanted when it is
pressed, so a card added from a row a moment ago is not sent twice. The requests
go one at a time and awaited: the want-list route is a read-modify-write of the
whole state file, and twelve at once is eleven lost cards.

### Narrowing belongs where you choose what to add

The search drawer's scope select queries **the shelf**, not Scryfall — a page of
results cut down to the three you happen to own reads as broken. It is the same
sentence either way, colour-identity injection included, because `cardquery.js`
reads Scryfall's syntax. Two passes and two caches on purpose: the filtering
reads `scryfallMetaCache`, which the Collections tab already fills, so a shelf
searched once over there answers instantly here; only what survives is fetched as
whole cards, since that is what has pictures and prices and the shelf may be five
thousand long.

### Nobody to be

`myPlayerId()` null — open mode with no remembered name — is a real state, not a
degenerate one. The scope control is not offered at all, every loaded collection
is the group's, and the readout says "the group owns" rather than "you own".
There is nobody to want a card either, so no want button is drawn.

## How it was checked

`npm test` (622), `lint:tokens`, `check:contrast` and `measure:mobile` are
green. `measure:mobile` gained a **deckview-owned** view, so the missing list's
✕ and its per-row want buttons are measured rather than assumed;
`test/deckowned.test.js` is 31 assertions in three layers — the shelf, the whole
tab drawn in a `vm` sandbox with the *real* `js/collections.js` and `js/auth.js`
beside it, and the markup and stylesheet read as text.

Then the real page in headless Firefox against a snapshot of the live database.
In open mode with no name the scope control is `display: none`, all six
collections count, and a 116-card deck reads "99 of 116 the group owns" with 89
cards still on the mat. Remembering `Tim` and giving two collections owners
through the app's own route makes the ladder real: 97 mine, 99 the group's, 99
everyone's — and 89 cards on the mat at every one of them. The missing list
opened above the bar (109px tall, clear of it), named the holder, and **+ Want
all 1** put Temple of Deceit on the server's copy of Tim's want list, after which
the button was gone and the row was ticked. The chip cut the mat from 89 to 1 and
back. `t:creature mv<=2` scoped to the group's shelves returned 2,139 hits from
the local collections with no Scryfall request, showing the first 175.
