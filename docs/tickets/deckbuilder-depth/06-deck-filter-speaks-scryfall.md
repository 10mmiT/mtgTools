# 06 — The deck filter speaks Scryfall syntax

**What to build:** the Deck Builder's filter box reads the same query language the Collections
search now does, run against the deck in front of you.

Today it is a substring test against name and oracle text, which answers one question. The parser
that answers the rest already exists — it was written for Collections, it runs against the same
local card facts the mat reads, it compiles once per keystroke, and it already refuses filters the
local cache cannot answer by naming them rather than quietly matching nothing. This ticket points
the deck's filter at it.

**A bare word must go on meaning what it means today.** Typing `goblin` is a name search, not a
syntax error and not a lesson in a query language. Only a recognised filter turns the box into a
query.

The deck is a far smaller population than a collection, so nothing here is a performance question —
it is the same parser doing less work.

Two predicates that belong in this language arrive with later tickets rather than this one:
ownership from ticket 08 and Game Changers from ticket 10. Leave room for them; do not block on
them.

From `spec-deckbuilder-depth.md` → proposal 7.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A bare word still filters by name, exactly as before
- [x] Type, colour, mana value, oracle text, rarity and price filters work against the open deck
- [x] Negation, `OR` and parentheses work, and lower-case `or` is still a word in a card name
- [x] A filter the local card cache cannot answer is refused by name, and says why
- [x] An unknown filter says it is unknown rather than matching nothing
- [x] Filtering composes with the sort and with the view, and hides nothing outside the deck
- [x] Filtering a category to empty leaves the category visible rather than silently gone
- [x] Clearing the box restores every card
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

## What was built

### One word of the language is the caller's

Pointing the box at `parseCardQuery()` is four lines. The ticket's first
criterion is the whole of what was not: **a bare word must go on meaning what
it means today**, and what it means *today in this box* is name **or rules
text** — the placeholder said so, and the spec asks for "the substring search
they are today". Scryfall's own answer, which Collections keeps, is the name
alone.

Both are right in their own box. A collection is thousands of rows and a bare
word that also read the rules text would match half of them; a deck is sixty
cards, where the wider net still lands on a handful and where everyone typing
into that box already expects it. So the parser gained one option and nothing
else:

```js
parseCardQuery(text, { bare: 'text' })     // the deck: name or rules text
parseCardQuery(text)                       // Collections: the name, as Scryfall reads it
```

`CQ_BARE` holds the two, and reading the rules text sets `needsMeta` because
it is reading a fact off the card. Everything else — every filter, the
operators, the refusals — is one language in both boxes, which is the point of
pointing the second box at the first box's parser rather than growing a second
syntax. `CQ_SYNTAX_HELP` moved into `cardquery.js` for the same reason:
Collections had its own copy of the tip, and two copies are two syntaxes as
soon as one of them gains a filter.

### A query that cannot mean anything leaves the deck alone

Collections replaces its table with the error, which is right for a table you
arrived at by searching. The mat is not that: it is the deck you are working
on, and the box is typed into one character at a time — `c:pin` is three
keystrokes into `c:pink`, and neither is a colour. Emptying the mat on those
keystrokes is a mat that flickers.

So a refused query **compiles to nothing and filters nothing**. The deck goes
on being drawn, whole, with the message above it naming the filter it choked on
(`"f:" searches format legality, which the local card data doesn't carry`) and
the syntax tip under that. The box itself carries `.is-invalid` and
`aria-invalid`, which outranks `:focus` on purpose — the box being typed into
is the box that is wrong.

### A pile the filter emptied is not a pile the deck lost

`_dbPaint()` used to filter as it grouped, so a category the search emptied
came off the mat entirely — indistinguishable from a category somebody had
deleted, and no way to see that a deck's nine creatures contain no red one.

It groups first and filters after, and now knows two counts per category
instead of one: how many cards it holds, and how many the filter is showing. A
category the *deck* has emptied is still a header and a gap, as before. A
category the *filter* has emptied keeps its header — it is still one of the
deck's piles and still somewhere a card can be dropped — with a line under it
saying `None of its 33 cards match`.

The exception is a search that matched nothing anywhere: nine empty headers say
the same thing nine times, so that falls back to the one sentence the mat
already had.

### What the filter is not allowed to touch

Nothing but what is drawn. The deck's rows are untouched, no save is triggered,
and every number on the readout goes on counting the deck — `dbRenderStats()`
reads `dbMainCards()` and never sees the filter. Sort and view compose with it
for free, since the filter is one `Array.filter` between the grouping and the
drawing.

## How it was checked

`test/deckfilter.test.js` — 21 tests in the two layers `test/deckboards.test.js`
uses: the shipped deck-builder modules in a `vm` sandbox over a deck whose card
data is real trimmed Scryfall objects, and the markup and stylesheet read as
text. Three more went into `test/cardquery.test.js` for the option itself,
including that Collections' bare word did *not* change.

Then the real page in headless Firefox against a snapshot of the live database,
on a 96-card deck: `draw` found 15 cards by name and rules text, `t:creature`
24, `mv<=2 t:creature` 6, `c:r OR c:g` 13, `-t:land` 64, `t:land or t:sorcery`
none (lower-case `or` is a word), `t:planeswalker OR t:battle` 2 with four
categories left standing and saying what the filter did. `f:commander`,
`zzz:1`, `is:gamechanger` and `c:pin` each named themselves and left all 96
cards on the mat with the box marked invalid; `t:` mid-word did the same
without an error. The readout read `96/99 cards` throughout, and clearing the
box brought all 96 back.

## What was left

The two predicates the ticket names as later work are still later work, and
`CQ_IS` carries a comment saying where each lands: `is:owned` (ticket 08) is a
fact about the collections rather than about the card, and `is:gamechanger`
(ticket 10) waits on the bracket work that reads Wizards' list. Both are one
line in that table when they arrive; nothing above them has to move.
