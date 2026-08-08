# The deck builder answers questions — what was done

A record of the work on `feat/deckbuilder-depth`, written after delivery. It supersedes the twelve
tickets it was driven from — `01-card-cache-three-facts` through `12-two-pads-in-an-eight-pixel-gap`
— and stands beside the survey it was specified from
(`docs/design/spec-deckbuilder-depth.md`). Where this document and a ticket disagree, this one is
what happened.

---

## The gap

> The mat was ahead of the field on feel and behind it on analysis. Ask the tab a question about
> the deck and it had four answers.

Those four were the card count, the land count, the average mana value and a row of colour pips.
Everything else a deck builder is asked — is this legal, what does it cost, how much of it do I
own, what bracket is it, does its mana work, what did it look like last week, where do I put a card
I am only considering — was either somewhere else or nowhere. Moxfield and Archidekt answer all of
them; what neither can do is know whose shelves the cards are on, which is the one thing this app
has always known.

So the shape of the work is: **every question a deck can be asked is answered on the tab the deck is
on, and the ones only this app can answer are answered best.**

Six new browser modules carry it, each against a question rather than against a tab:

| file | the question |
|---|---|
| `public/js/deckview-boards.js` | what a card's *place* in a deck is |
| `public/js/deckview-history.js` | what the deck used to be, and putting it back |
| `public/js/deckview-owned.js` | how much of it you own, and who has the rest |
| `public/js/deckview-totals.js` | what it costs, and what it is made of |
| `public/js/deckview-legality.js` | whether it is legal, and how strong it is |
| `public/js/deckview-mana.js` | what its spells want against what its lands make |

with `deck-history.js` and four routes on the server side for the one of those that needs storage.

---

## What the numbers say

Every figure is from a run on the final commit, in headless Firefox against a copy of a real
database, not from a claim in a ticket.

| | before | after |
|---|---|---|
| Figures on the readout | 4 | **9** — legality, bracket, ownership, price and the mana panel's door |
| Boards a card can be on | 1 | **4** — main, commander, maybe, side |
| Deck-wide passes per render | one reduce per figure, on every draw | **three, memoised**, none of them on `dbRender()` |
| Fields on a cached card | — | **+3**: `legalities`, `game_changer`, `produced_mana` |
| A deck's past | gone one second after the edit | **50 snapshots per deck**, restorable |
| Controls on the strip | 14, wrapping to three rows | **5**, and a column beside the mat |
| Deck-builder modules | 4 | **10** |
| Views measured at 390px | 15 | **21** |
| Tests | 355, across 17 files | **770, across 28** |

The card cache is the one thing that got materially bigger: **+18.9 MB, +25%** on a 38,623-card
database, nearly all of it `legalities`, measured by importing the real bulk file through both
shapes and weighing the result. That is the price of the legality line and it is written down so it
can be argued with.

---

## The three rules the work is built on

Everything below is one of these three applied to a surface.

**One pass, and none of it on render.** The mat animates its own re-renders and that animation is
bounded to what is on screen; a deck-wide count running beside it would undo the care that keeps it
bounded. So the three modules that walk the whole deck — the totals, the legality check, the mana —
each memoise their answer and drop it in `dbRenderStats()`, which is called when the deck *changes*.
Being called is what "the deck changed" means on this tab. The readout, the analysis strip, the
legality panel and the mana panel cost **one pass each** between all of their figures; twenty
`dbRender()`s cost none. It is asserted by wrapping the compute functions and counting, not assumed.

**One answer per question.** Two places deciding what a land is, or how big a deck should be, is a
readout that disagrees with the panel it opens. So `dbDeckTarget()` is asked by both the count and
the legality check; `dbShortOf()` is asked by both the ownership badge and the "to finish" price;
`dbCardType()` is asked by both the type breakdown and the mana panel's land count; `colOwner()` is
the only reader of a collection's owner. Each of those is a function that exists because the second
caller turned up.

**Unknown is never nought.** A card with no Cardmarket price is not free, a card whose facts have
not arrived is not legal, and a colour nothing in the deck makes is not a colour with zero sources
quietly averaged away. Every figure that can be short says so: `(19 unpriced)`, `legal so far · 3
unchecked`, `no facts for these cards yet — counted, not checked`. A total quietly short by however
many looks exactly like a total that is right, and that is the failure this work refuses most often.

---

## The work, in the order it landed

### 01 · The cache learns three facts

`SHAPE_VERSION` in `scryfall-db.js`, and `legalities`, `game_changer` and `produced_mana` kept
verbatim in the trim. The version is the point: the daily refresh skips the download when Scryfall's
`updated_at` is unchanged, so without a version of our own a shape change would never reach an
install whose cache is already current — the new field would read `undefined` on a database that
believes it is up to date. It is written only once an import *finishes*, so a run that dies halfway
leaves the old version behind rather than claiming a conversion that did not happen.

The fields are copied unreshaped — `legalities` keeps its two dozen `not_legal` entries — because
the client falls back to `api.scryfall.com` for names this cache misses, and a check that reads one
source has to read the other the same way. Rows still in the old shape are filled on the way out of
`getCard()`, so a consumer gets `undefined` rather than a TypeError during the minutes a 24 MB
download takes.

### 02 · A deck can be put back

`deck_snapshots`, four routes, and a History drawer. **A snapshot always holds a state from
*before* a change** — the state a save produced is a copy of something the deck already is, and the
state it replaced is the only one about to stop existing. Everything else follows: restoring row N
undoes everything after it, and every row is named for what it was taken in front of.

**The burst is closed by arithmetic rather than by a timer.** The row is written at the *start* of a
burst, on its first save, and an in-memory map only answers whether the next save belongs to the
same one. Nothing is ever pending, so closing the tab mid-burst loses nothing and needs no unload
handler racing a browser that is being killed. The idle gap is five minutes rather than the spec's
thirty seconds: thirty seconds is a pause to read a card, and at that gap a deliberate hour of
building would spend the whole fifty-row cap.

Forced snapshots — before an import, a deleted category, a bulk move, a restore, a delete — carry
the *client's* copy of the deck, because at that moment the autosave is up to 800 ms behind and the
browser holds the truth.

One measured ceiling: 7.7 KB a snapshot, ~380 KB for a deck at the cap, **6.17 MB for sixteen decks
all at it** — a number nobody reaches, since it assumes fifty separate sittings per deck.

### 03 · The frame folds, and the ghost pile

Three states in a ring on one attribute — `full`, `readout`, `bare` — hidden by the stylesheet
rather than by a dozen `style.display` writes, because two tiers spread across a dozen calls are two
tiers that will disagree the first time something is added to the strip. The fold button is the one
control that never hides, `f` does it from the keyboard, and **nothing is ever revealed by pointing
at it**: the mat is a drag surface, and a card carried towards a category high on the screen would
trip a reveal every time. A test asserts there is no hover rule anywhere near the fold.

The curve came off the readout and became a strip that expands out of the toolbar — which is what
later gave the analysis, the type breakdown and the split somewhere to go, and what finally gave a
phone a curve at all.

**The ghost pile** is the pile with no name on it yet: an outline after the last category whose
`data-drop` value is the empty string, because the category it stands for does not exist until
something lands on it. No sentinel and no change to the carry. The pile is *real* before it is
named — the category is created with a placeholder, the cards move through the same
`dbMoveCardsTo()` everything else moves through, and typing over the placeholder is an ordinary
rename. Cancelling a name is not cancelling the drop.

### 04 · Boards on the mat

`deck_cards` gained a `board` and the primary key widened to `(deck_id, board, card_name)` — a table
copy, because the old key said a card is in a deck once and a maybeboard is the case where it is in
it twice. `board` is `TEXT` with no `CHECK` and the server validates nothing, which is what "the set
of boards stays open" means in practice.

The change the rest of the tab pays for is that **a card's identity within a deck is no longer its
name**. Two strings carry it, both split at the *first* slash because card names contain slashes
(`Fire // Ice`): a **ref** (`maybe/Sol Ring`) and a **place** (`main/Lands`, or `maybe` for a whole
board). A place with no slash in it is a board, which is what tells the two apart without a
sentinel. Every name-keyed thing on the mat became ref-keyed.

Three decisions the ticket did not settle: a move onto a board that already holds the card is a
merge; the boards sit at the head of the Move to… list, because on a phone a finger scrolls the mat
and a board reachable only by dragging is one half the app cannot use; and a deleted category is
cleared from every board, or a card set aside comes back carrying a name no pile answers to.

### 05 · The commander is a board

One value in `DB_BOARDS` and one flag on it. `head` means three things that are one statement — *this
board is the head of the deck rather than a holding area beside it*: drawn before the categories, on
by default whenever it holds anything, and switched on by a card landing on it, because a commander
that vanished into a hidden region would be a card thrown away.

Which boards are showing is stored as **what differs from the default** rather than as what is on. A
list of what is on cannot say "this deck's commander board is hidden" at all, and every entry
written before the change goes on meaning what it meant.

The count says the rest of it: the commander is not subtracted from the deck any more, it is simply
not in it, and the target is a hundred minus however many commanders the deck holds — so **partners
are a deck of ninety-eight** rather than one reading a card over.

The migration is two statements and a walk over the deck records, guarded by a marker row rather
than by looking for the category, since `Commander` is an ordinary category name from now on. One
pass the ticket did not ask for and the live data did: the count this replaced never read the
category — it subtracted the card the deck record *names*, wherever it was filed — and one real deck
had its commander sitting in `Lands`.

### 06 · The deck filter speaks Scryfall

Pointing the box at `parseCardQuery()` is four lines. The ticket's first criterion is the whole of
what was not: a bare word must go on meaning what it means *in this box*, which is name **or rules
text**, where Collections' bare word is the name alone. Both are right — a collection is thousands
of rows and a deck is sixty — so the parser gained one option, `{ bare: 'text' }`, and nothing else.
`CQ_SYNTAX_HELP` moved into `cardquery.js` at the same time: two copies of the tip are two syntaxes
as soon as one of them gains a filter.

**A query that cannot mean anything leaves the deck alone.** Collections replaces its table with the
error, which is right for a table you arrived at by searching; the mat is the deck you are working
on and the box is typed into one character at a time — `c:pin` is three keystrokes into `c:pink`.
So a refused query filters nothing, the deck stays whole, and the message names the filter it choked
on.

And a pile the filter emptied is not a pile the deck lost: it keeps its header and says
`None of its 33 cards match`, because it is still one of the deck's piles and still somewhere a card
can be dropped.

### 07 · A collection has an owner

One nullable column, and **the null in it is a real answer**: a shared box belongs to the group, so
it counts as the group's and never as any one person's. There is no foreign key because a player
lives inside a JSON blob; what stands in for it is `disownGonePlayers()`, run after every whole-state
write. The collection stays — the cards are still in the house, what has gone is the person.

Two write paths, because a collection *is* its cards: the whole-collection upsert takes an owner
only when the field is present, so a refresh cannot clear one as a side effect, and changing an
owner is a route of its own rather than a re-upload of five thousand cards.

`myPlayerId()` is deliberately not `isMyPlayer()`: the latter asks what you may *edit* and answers
yes to everything for an admin, and an admin looking at their own shelf is looking at one person's.
Open mode has no logged-in player at all, so it falls back to the name behind Available@'s "Who are
you?" bar. `null` — nobody to be — is what makes the last criteria one line each: no scope control
is rendered, and everything reads as the group's.

### 08 · The deck says what you own

`DB_OWN_SCOPES` is **mine → the group's → everyone's**, and the second *includes* the first. That is
the one design decision worth arguing about, and it falls out of what the number is read as: one
sentence getting looser — what I can sleeve tonight, what the group can put on the table, what
exists among us at all.

The number counts *copies* and counts the mainboard: four Forests with two on the shelf is two
short, not "owned", and a maybeboard cannot flatter it. The scope is remembered **per person**, not
per browser, because two people share a browser in open mode.

It scopes the question and never takes a card off the mat. What changes is what the badges say —
where your shelf has none of a card, the badge names whoever *does* have it, in their own colour.
The one filter is asked for by hand and is not remembered, because filtering the mat by ownership is
something you do for a minute.

The missing list opens out of the readout in two lists, because they are two problems: a card
somebody else has is an evening's borrowing, and a card nobody has is a purchase. **+ Want all**
takes no list — it recomputes what is still missing when it is pressed — and the requests go one at
a time, because the want-list route is a read-modify-write of the whole state file and twelve at
once is eleven lost cards.

### 09 · What the deck costs

`deckview-totals.js`, and `dbRenderStats()` stopped counting anything and became drawing. Two figures
on the line: what the deck costs, and — only when it is short of something — what finishing it
costs, following whichever shelf the readout is scoped to.

**The money counts the mainboard and the commander; everything else counts the mainboard alone.**
That looks like an inconsistency and is the one real decision in the ticket: "what does finishing
this cost" is a question about a box you can sleeve tonight, and a deck you cannot sit down with
because you have not bought its commander is not finished. The count, the curve and the breakdown
still leave it out, because it is not one of the ninety-nine.

A real deck off the live database has **19 of 116 cards with no EUR price**, which is why unknown is
not nought here either, and why a deck nothing can be priced at draws `—` rather than `€0.00`.

The split is permanents / spells / **lands**, three buckets rather than two: a Commander deck is a
third lands, so a line that buried thirty-seven of them in the first number would say the same thing
about every deck ever built.

The curve can be cut into colours — **one band per card, not one per colour it is**, or the bars add
up to more than the deck — off `colors` rather than `color_identity`, because the curve is about
casting things.

### 10 · Legality, and the bracket

Two questions with opposite obligations, one walk, one panel between them.

**Legality has one right answer, so the whole of the care is in never claiming it.** A card whose
facts have not arrived and a row still in the old trimmed shape are both *unchecked*: counted
towards the deck's size, judged for nothing, named in the panel. The line reads "Commander legal" in
the success colour only when everything was checked.

**The bracket has no right answer at all.** It is a floor rather than a placement, and every signal
produces a reason *whether it was found or not* — "no mass land denial" is as much of why the answer
is 2 as three Game Changers are of why it is 3, and a list of only the hits reads as an accusation.
Tutors are counted, shown, and deliberately not weighed: Wizards publish no threshold, so one here
would be ours worn as theirs. The two things it cannot see are printed under it every time.

The estimate is held nowhere and can never overwrite the declaration, because nothing writes
`bracket` on the deck record except the select. That field had been round-tripped and
permission-checked since long before anything set it; the chip it draws was already on the deck
tiles, and **Pick Night can now narrow tonight's pool by it** — a deck barred by a bracket is marked
where it was chosen rather than only being absent from a smaller number.

There is no format field and this did not add one. What a deck has is a commander, which is the same
inference the readout already made to choose between 60 and 99 — so the inference moved into
`dbDeckFormat()` and the readout reads it.

### 11 · The mana base reads the deck

The calculator had done the right maths for a long time and then asked a person to count the white
pips in their deck by hand, while the deck holding every one of those numbers sat one tab away.

Pips are read off `mana_cost`, symbol by symbol, and **every symbol is one pip shared equally
between the ways it can be paid**: `{G/U}` is half a green and half a blue, `{2/W}` and `{W/P}` are
half a white, generic and `{X}` are nothing. It is a convention rather than a fact, which is why the
panel says it out loud; what it protects is that the pips of a deck add up to the symbols in its
costs, so the proportional split of basics is a split of something real. The commander is counted —
you cast it more than anything else in the box.

Sources are `produced_mana`, counted per colour and by copies, so a dual land is two and the shares
are shares of *source slots* rather than of cards. **One finding is called a fault and no other
is**: the deck asks for a colour and nothing in it makes that colour. Everything else is two shares
side by side and a person to read them.

One press fills the calculator — the size the deck is built to, its lands, its non-basics, its pips
rounded to whole numbers — and says what it took and what it could not read. Nothing writes back,
and the tab still works with no deck loaded, which is why it is still a tab.

### 12 · Two 44px pads in an eight-pixel gap

A pre-existing failure, found while building 02 and fixed at the end: fifteen category-heading
chevrons reporting 36–41px against the 44px floor. The chevron's invisible pad and the heading's
overlapped in the header's gutter, and the heading — later in DOM order at the same stacking level —
won the hit test. Both called the same function, which is why nobody had noticed.

`.dv-section-fold` wraps the chevron, the name and the count; the click lives on the wrapper and
neither pad survives. **It costs nothing above the touch breakpoint, because up there it is not a
box**: `display: contents` by default, a flex box with a minimum height only inside the phone block,
so "nothing on the mat moves on desktop" is true by construction. It was measured anyway — every box
in all fifteen headings, to a tenth of a pixel, identical.

### And then the strip

Not a ticket. By the time all twelve had landed the control strip carried fourteen things and
wrapped to three rows, so it keeps what is used *while building* — the deck picker, the add-card
field, the deck filter — and everything else is a column at the right-hand edge of the mat, opened
from the ☰ or from `m`, in four groups: what the mat looks like, what is on it, what to look at
beside it, and what to do to the deck.

**It pushes rather than covers**, which is the whole argument for a column over the drawer shell
already on this tab. Every control in it is answered by the mat — change the size and the cards
resize, press a board and a region appears, filter by what you are missing and cards leave — and a
panel you have to close to see what it did is one you use twice and then stop using. The two drawers
on this tab cover the mat on purpose, because what they hold is somewhere else.

The ⋯ popover went with it. A popover inside a strip is what you build when the strip has no room.

---

## What was found by using it

None of this came out of the unit tests. All of it came out of driving the shipped app in headless
Firefox against a snapshot of the live database.

- **A real deck had its commander filed under Lands.** The count being replaced had never read the
  `Commander` category — it subtracted the card the deck record *names*, wherever it sat — so the
  migration would have silently taken that deck from 116/99 to 117/99. It gained a second pass for
  exactly that case.
- **Nineteen of one deck's 116 cards have no Cardmarket price.** The unknown-versus-nought rule is
  not a corner case; it is one card in six.
- **Two-thirds of the live decks had no commander in the category at all.** The migration moved
  fourteen, deleted twenty-nine categories, and left every deck's count reading what it read before.
- **A hidden board measured zero.** The reveal is a stylesheet rule off `.card-carrying`, but the
  carry measured its drop zones *before* it said a card was in hand — so the board would have been
  measured while still `display: none`, a box of no size that nothing can be dropped on. One line
  moved in `js/carddrag.js`.
- **A 117-card deck reads as two problems**, seventeen over the hundred and twenty-one copies of one
  card, with the card named and openable from the panel. Its estimate is a 3, one Game Changer off,
  with two tutors listed and not scored.
- **A real Dimir deck wants 36.5 blue pips against 49 blue sources.** The halves are hybrid cards,
  not rounding, and its red, green and colourless sources sitting at 5–6% against 0% of its pips is
  exactly what fixing a two-colour mana base looks like.

---

## What this cost, and what it did not

- **A card crossing boards lands rather than travels.** `js/cardmove.js` recognises a card across a
  rebuild by its `data-moves`, which is now its ref — so a card that changes board changes identity
  and has no "before" box to travel from. It still arrives with the landing flourish. Giving it the
  full journey means keying the animation by name and teaching it that two elements can share one.
- **The bracket estimate cannot see two-card infinite combos, and cannot reach 5.** Both are said
  under it every time it is drawn. The spec's combo service is what answers the first properly; the
  second is a declaration about how a deck is played.
- **An artifact land is bucketed under artifacts**, by the app's one type ladder, which is what the
  breakdown and the piles on the mat read. The mana panel asks that ladder rather than deciding for
  itself, so the panel and the line that opens it agree — at the price of both being wrong about
  Darksteel Citadel in the same direction. One answer beats two.
- **The cache is 25% bigger**, nearly all of it `legalities`, and most of *that* is `not_legal`
  entries. Dropping them would save ~12 MB and was rejected: it would make a cached card answer
  differently from the same card fetched live. If a self-hosted box ever finds 19 MB expensive, that
  is the lever and this is the number to weigh it against.
- **The mana panel's shares are conventions, not facts** — the hybrid halves and the double-counted
  dual. Both are printed under the numbers rather than hedged into every line, because a convention
  that is not written down is a claim.
- **The deck menu scrolls with the page rather than sticking**, deliberately: a column with its own
  `overflow-y` would clip the sort control's popover at its own bottom edge. The strip those
  controls came from scrolled away too.

---

## The clean-up that came with it

Removing the ⋯ popover made it worth reading the rest of the stylesheet the same way. Sixteen rules
naming classes no markup has worn for some time are gone — `.view-toolbar`, `.search-row`,
`.section--boxed`, `.section-actions`, `.loading-spinner`, `.dv-summary*`, `.cards-grid`,
`.dv-url-field`, `.col-header-row`, the three table-scroll rules for tables that are now strips, and
the two `.lands-*` icon rules the mana-font symbols replaced.

Two of them were holding entries open on the `!important` allowlist, which is a ratchet: it is
**8 rules and 8 declarations now, from 10**. That is the cheapest way an entry on that list is ever
retired — the rule it lived on stopped existing.

A stack-trace `console.log` firing on every state poll, and three tracing breadcrumbs beside it, went
with them.

---

## How it is kept

```
npm test                # 770 tests across 28 files, up from 355 across 17
npm run lint:tokens     # the token contract over the delivered CSS
npm run check:contrast  # every text/surface pair, in all five themes
npm run measure:mobile  # hit-tests every control at 390px, across 21 views
```

Eleven of the twenty-eight test files are this work's: `cardcache`, `deckhistory`, `deckframe`,
`deckboards`, `deckcommander`, `deckfilter`, `collectionowner`, `deckowned`, `decktotals`,
`decklegality` and `deckmana`. They use the three seams the earlier records established — the HTTP
seam for the routes and the migrations, the static seam for the token contract, the `vm` seam for
the browser modules — with one addition worth keeping:

**The passes are counted, not assumed.** A function declaration in a `vm` sandbox is a property of
its global, so wrapping `_dbComputeTotals`, `_dbComputeCheck` and `_dbComputeMana` is enough to see
every call, including the ones made from another module. "Drawing the mat costs no deck-wide pass"
is therefore an assertion rather than an intention, and it is the promise most likely to be broken
by whoever adds the next figure to that readout.

`measure:mobile` gained six views — `deckview-owned`, `deckview-analysis`, `deckview-legality`,
`deckview-mana`, `deckview-menu` and `deckview-history` — because each of those surfaces arrives
closed, and a control that has not rendered passes a touch-target measurement by not being on
screen.

What the seams cannot see was driven in headless Firefox over WebDriver BiDi against a copy of the
live database, which is where everything in "what was found by using it" came from. There is no
browser in `npm test`, by design. Both harnesses need a populated database — pass
`--data .scratch/ui-redesign/capture-data/state.json`, and always a copy, since the app writes to
whatever database it is given.
