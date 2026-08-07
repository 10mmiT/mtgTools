# Scryfall syntax in the Collections search — what was done

A record written after delivery, of one change asked for in one line: *add scryfall syntax to
collection search*. There was no ticket and no spec; this document is the whole of the design record.
It stands beside `docs/records/sorting.md`, whose card-facts cache it extends and whose comparator it
leaves alone.

---

## The change

> The Collections search box reads Scryfall's query language, run against the cards you own.

It used to read one line of code:

```js
if (query) rows = rows.filter(r => r.name.toLowerCase().includes(query));
```

Which is the only question a collection row can answer about itself. Every other question people
actually have about their own shelves — *which red creatures do we own under two mana*, *what have we
got that draws* — had to be asked on the Scryfall tab, where the answer is the whole of Magic and not
the shelf in the next room. The tab could already **sort** by mana value, colour, rarity and type; it
could not **filter** by any of them.

It now parses the same language the Scryfall tab takes, and evaluates it locally:

```
t:creature c:r mv<=2        o:"draw a card" -t:land        t:goblin OR t:elf
c=wu t:instant              m:{G}{G}                       is:mdfc        eur>=50
```

A bare word is still a name search, so `sol ring` means exactly what it always meant — that is the
smallest sentence in the language rather than a compatibility shim.

**Nothing is sent to Scryfall.** The query runs against `scryfallMetaCache`, the card facts the app
already keeps, filled from the server's own copy of Scryfall's bulk data (`scryfall-db.js`). Against
the live snapshot — 12,788 distinct cards across six collections — a keystroke costs 17–36ms
including the DOM write, which is inside a frame at the 80ms debounce the box already had.

### What it understands

| | |
|---|---|
| names | bare words, `name:`/`n:`, `"quoted phrase"`, `!"exact name"` |
| card text | `t:`ype, `o:`racle (with `~` for the card's own name) |
| numbers | `mv`/`cmc`, `pow`, `tou`, `usd`, `eur` |
| colours | `c:`olor, `id:`entity — letters, colour names, guild and shard names, `c` and `m` |
| the rest | `r:`arity (ordered, not alphabetical), `m:`ana cost, `s:`et, `layout:`, `is:`/`not:` |
| joining | juxtaposition is AND, `-` is not, `OR` and `AND` and parentheses |

Every operator Scryfall has — `: = != < <= > >=` — on every filter, with Scryfall's own meanings:
`c:rg` is *at least* red and green, `c=rg` is exactly those two, `c<=rg` is nothing outside them, and
`m:{R}` is every cost with a red pip in it rather than the mono-red ones.

---

## Three decisions worth the words

**It is a parser, not a `switch` on a prefix.** A recursive-descent parse over a four-line grammar
was chosen over pattern-matching a few common shapes, because the shapes people actually type
compose: `-`, `OR` and parentheses are the difference between a syntax and a list of tricks, and they
are nine lines once there is a grammar at all. The compiled query is a `{ needsMeta, match }`, and an
`OR` of two filters is indistinguishable from a filter to whoever runs it.

**A filter this app cannot answer is refused by name.** The local cache holds oracle cards — one
printing each, no legality, no artist, no printing year. `f:commander` could have been an unknown
filter, or worse, silently matched nothing. Either way the person typing it is looking at an empty
table that means *you own none of these*, and no amount of re-typing gets them to the truth. So
`CQ_ABSENT` names sixteen real Scryfall filters and what each one searches, and the message says
which tab can answer it:

> `"f:"` searches format legality, which the local card data doesn't carry — try it on the Scryfall tab.

Typos get the same treatment from the other side: `zzz:1` is *Unknown filter "zzz:"*.

**Typing is not an error.** The box filters as you type, so `t:` exists on the way to `t:creature`. A
filter with nothing after it yet matches everything rather than throwing, and the table does not
flash a red message between two keystrokes. Only a query that cannot ever mean anything — an unclosed
quote, a rarity that is not one, an unknown filter — is refused.

`OR` and `AND` are operators **only in capitals**, which is Scryfall's rule and was kept rather than
improved on. "Now or Never" is a card, and a search language that quietly rewrites a typed name is
worse than one that wants a shift key. It is in the README and it is the one thing here that will
surprise somebody.

---

## What else had to change

**There is one cache of card facts, and it grew four fields.** `cardMetaOf` in `sortui.js` is the
single shape the app keeps card facts in, and it now carries `oracle`, `mana`, `set`, `layout` and
`usd` beside the eight things it already held. Nothing sorts by any of them; they are what `o:`,
`m:`, `s:` and `is:dfc` ask about.

Putting them there rather than in a query cache of its own is the point. Two caches of card facts
filled from the same fetch would drift, and a card the search knows about but the sort does not is a
card that vanishes when the piles are cut. `scryfall.js` had a hand-written copy of that same object
literal, which is exactly how a field added for one reader reaches half the cards; it calls
`cardMetaOf` now, and the duplicate is gone.

A double-faced card's oracle text lives on its faces and not on the card, so both faces are joined —
`o:draw` on an MDFC should find the half that draws. Its `type_line` already reads "A // B" and is
left as printed, because the metadata column shows it.

**A search that reads a card waits for the cards, once.** A name search needs nothing but the rows and
stays instant. Anything else has to have the facts for *every* name in the collection before the
first row can be judged — a filter run over half a cache is not a narrower answer, it is a wrong one
— so `colQueryMetaReady` reports whether the search can run yet and starts the fetch if it can't. The
tab says *Reading card data for this search…* meanwhile, in all three views. On the live snapshot
that pause is under a second, and it happens once per session.

**`ensureScryfallImages` now says what it guarantees.** It gates on the image cache but fills three,
and the new caller waits on the *metadata* one by re-rendering when the promise settles. A name that
came back in one cache and not the other would be a name still missing on that re-render, which is a
fetch, which is a re-render — a loop with a browser at the bottom of it. The two maps happen to be
written together everywhere in the file, so the old image-only test was right by coincidence; it asks
about both now and is right by construction. This was found by reading, not by a failure.

**Three empty states became one function.** `colSayInstead` paints a message into the list, the grid
and the pile view, because the parse error, the loading state and the getting-started hint all need
all three — mobile defaults to the grid, which is how the original hint came to be invisible there.
The syntax examples ride along on the empty result and the parse error, which is where somebody
needing them is looking; the Scryfall tab's own empty state made the same call, and its `.sf-syntax`
class is `.syntax-tip` now that two tabs use it.

---

## What this cost, and what was left out

- **Memory, a little.** Five extra fields per card across every name in every collection, oracle text
  being the large one. On the live snapshot that is 12,788 cards' worth, and it is loaded only once a
  metadata search or a metadata column asks for it — which the sort and the columns already did.
- **The first metadata search is not instant**, and it is the only place in this tab that stops to
  fetch before showing anything. It could have rendered partial results and filled them in, which
  would have been worse: rows appearing and disappearing under a filter reads as a bug.
- **`s:` is not a way to browse a set.** An oracle-card cache holds one printing per card, so `s:zen`
  asks *is that the printing this cache has* and not *was it ever printed there*. The Set Browser is
  the other question, and this is written into the code beside the filter.
- **No collection-side filters.** `qty>=4`, or "cards only Vegard owns", are the questions this tab
  is uniquely able to answer and Scryfall cannot express — the sort control already knows every
  collection as a field. They are deliberately not here: the ask was Scryfall syntax, and the
  quantity fields want their own vocabulary rather than a borrowed one. It is the obvious next thing.
- **No regex, no `fo:`, no `pow>tou`.** Scryfall has more syntax than this. What went in is what the
  local card data can answer honestly.

---

## Tests

`test/cardquery.test.js` is 34 tests, run against the shipped `public/js/cardquery.js` in a `vm`
sandbox the way `cardsort.test.js` runs the sort control, so they assert on the code the browser is
served. Five cards carry the fixture, and each assertion reads as the list somebody would have
expected in the table. What they hold down: a bare word still means what it meant; every filter reads
the field it claims to; `c:`, `c=`, `c<=` and `m:`, `m=`, `m<=` are set comparisons and not string
ones; rarity is ordered; a query that cannot mean anything says so; a half-typed filter matches
everything; and `needsMeta` is honest — a false one there is a filter run against an unfilled cache,
which returns a wrong answer rather than a slow one.

Three of them failed first as wrong *expectations*, all in the same direction: `:` is a superset
test, so `m:{R}` and `c:r` catch the two-colour cards too. The tests were corrected and now say so
out loud, since it is the thing about the language most likely to be misread.

`npm test` is 372 tests across 16 files, green, along with `lint:tokens` and `check:contrast`.

Beyond that, a throwaway script drove the shipped app in headless Firefox against a snapshot of the
live database — six collections, 12,788 distinct cards — and typed fourteen queries into the real
box. That is what produced the counts and the millisecond figures above, and it is how the cold-start
loading state was seen at all. See the `browser-smoke-harness` note for the plumbing.
