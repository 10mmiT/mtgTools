# Sorting by more than one thing — what was done

A record of the work on `feat/multi-criteria-sort`, written after delivery. It supersedes the eight
tickets it was driven from — `01-criteria-model` through `08-table-header-is-a-shortcut` — and stands
beside the PRD (`docs/design/spec-sorting.md`), which is what the work was specified from. Where this
document and a ticket disagree, this one is what happened.

---

## The principle

> A sort is a sentence — colour, then mana value, then name — not a word.

Every card view in the app sorted by exactly one field. You chose Mana Value and the two-drops
arrived in whatever order the merge happened to leave them; you chose Color and the white cards were
a block with no shape inside it. The one thing the app did for you was a name tiebreak, which is the
least interesting way to arrange cards that are otherwise alike.

It showed worst in the views with the most cards. A collection of twelve thousand sorted by rarity is
four enormous piles. The stack view made it sharper still: a pile is cut from the sort field, so "one
pile per rarity" was all the shape that view could ever have, when "one pile per rarity, each pile in
curve order" is the thing worth looking at.

All of it lives in `public/js/sortui.js`, and all five card views are callers. No view learned
anything new about sorting; four of them lost code.

---

## What the numbers say

Every figure is from a run on the final commit, not from a claim in a ticket.

| | before | after |
|---|---|---|
| A sort | one field, one arrow | **up to three criteria**, each with its own direction |
| Fields `sortKey()` can answer | 10 of the 12 in `SORT_FIELDS` | **all 12**, plus one per loaded collection |
| Fields sorted *outside* `sortKey()` | 4 | **0** |
| Bespoke comparators in `wants.js` | 2 | **0** — the file no longer branches on the sort field |
| Rows pre-decorated before sorting | every row, with `_sortQty` | **none** — the context is threaded |
| Ways to write the stored sort | 2 — the control, and the header's `saveSort()` | **1** |
| A collection criterion | `col_<i>`, a position in the list | **`col:<key>`**, the collection's id |
| The sort control | a `<select>` and an arrow button | **one button whose label is the sentence** |
| Collections' table header | a second sorting system | **a shortcut into the first** |
| `!important` allowlist | 11 rules, 12 declarations | **10 and 10** |
| `public/js/sortui.js` | 538 lines | 1,317 |
| Tests | 276 across 15 files | **338 across 16** |

The new file is `test/cardsort.test.js` — 53 tests. `test/cardgroups.test.js` went from 9 to 14,
which is the chain reaching the piles.

---

## The model, in one place

Six functions carry the whole of it, and everything else in the app is a caller:

| function | what it decides |
|---|---|
| `cardComparator(criteria, ctx)` | the order — each criterion in turn, then the invisible name tiebreak |
| `sortKey(field, card, ctx)` | what one field is worth for one card |
| `seedChain(field, fields)` | the sentence a field usually belongs to |
| `chooseSortField` / `editSortChain` / `reseedSortChain` | the four things that can happen to a chain |
| `getSortChain` / `saveSortChain` | what is stored, and what a stored thing means now |
| `chooseSortColumn` / `appendSortColumn` | what a click and a shift-click on a column heading mean |

`sortKey` stays a pure function of its three arguments, which is what the `vm` test seam depends on.

**Context is threaded, not registered.** Some of what people sort by is not on the card: how many are
owned is a fact about the collections, how badly a card is wanted is a fact about the players. Those
fields used to be sorted outside `sortKey` entirely — two comparators in `wants.js`, a `_sortQty` the
caller stamped onto every row, and two Collections header fields the control never saw — which is why
none of them could ever be a *word in* a sort rather than the whole of one. They read a plain
`{ wants, players, collections }` the view hands over. Two alternatives were rejected: letting views
register a resolver per field puts sorting logic back in the five view files, and formalising the
pre-decorated row is `_sortQty` with more fields.

Every reader tolerates its part of the context being absent and answers the same value for every card
when it is, so a view that sorts by a field it supplied no context for falls through to the name
tiebreak. A wrong order is a wrong sort; an exception is a blank tab.

---

## The work, in the order it landed

### 1–3 · The model, the fields, and the id

`cardComparator` took a list instead of a field and an arrow, and every caller passed a list of one.
Nothing changed shape: the ticket existed to be the seam the other seven were built on, and its test
writes out the replaced comparator as the reference a one-criterion list is held against.

Then the four outsiders came inside. `wanted` and `player` stopped being comparators in `wants.js`;
`qty` stopped depending on the caller; `total` and the per-collection counts stopped being table-header
state the control could not see. Two ties resolve differently on purpose as a result: Most Wanted
tiebroke on `localeCompare` and now uses the same lowercased name tiebreak as every other field, and
Player had no tiebreak at all, so its ties were left in whatever order they arrived in.

Making a collection a field made a view's field list **dynamic** — one entry per collection, labelled
with that collection's name, rebuilt when the collections change. That is the price of the header and
the control ever agreeing.

`col_<i>` was a position in the list, so deleting the first collection quietly turned a stored `col_2`
into a different collection's quantities: a sort that is not wrong so much as about something else. A
criterion names the collection's `key` now — `archidekt:12345`, `csv:1699…`, colons included, so the
prefix is stripped rather than the field split. A criterion naming a collection that is gone is
**dropped silently**, from the chain and from localStorage both; a message about it is a modal nobody
wants, and one that survives in storage comes back the next time that view is opened.

### 4–5 · Seeding, ownership, and what is already on disk

Choosing a field gives you the sentence that field usually belongs to, not one criterion. A list
somebody has to assemble by hand is a list nobody assembles, so the feature pays off on the first
click rather than the fifth. Anything countable seeds descending — nobody asks for their cheapest
cards or their least wanted first — and Name and Set Number seed alone, because they are already
unique so a tail would never fire.

Seeding carries a rule about ownership, stored as one bit: **choosing a new first criterion re-seeds
the whole chain, unless the tail has been edited**, in which case only the first word is swapped. A
chain that is still all-default is the app's suggestion and a better suggestion should replace it; a
chain somebody edited is theirs. The first word's own arrow is not an edit — it is the control this
app has always had.

The bit is stored rather than derived by comparing the tail against what the field would seed today.
Deriving it would clear itself when somebody undid an edit by hand, and, more to the point, this
table is the app's opinion and will be edited again: a chain somebody made theirs must not fall back
into the app's hands because a later version changes its mind about what Rarity suggests.

A stored `{ field, dir }` — what every version before chains wrote — is read as **a list of exactly
one, and left at that**. Upgrading must not silently reorder the collection somebody left sorted by
Rarity. Nor is the entry rewritten on the way past, so somebody who never touches sorting keeps the
entry they have. This is the rule the card-size migration already used when it refused to inherit the
retired XL view's 300px into the grid.

### 6 · The control says the sentence

The select and the arrow became one button whose label is the sort — `Sort: Color → Mana Value → Name`
— opening a popover of up to three rows, each a field, a direction and a remove.

The label is the point. A criterion you cannot see is a criterion silently reordering your cards,
which is why keeping the select and hiding words two and three behind a "⋯" was not the answer.
Inline chips on the strip were rejected too: the strip is measured on how little of it there is, they
wrap badly on a phone, and drag-to-reorder is a gesture this app already spends on carrying cards.

The popover is the `.col-menu` the Columns menu already opens, so it inherits the outside-click
handling and the styling rather than becoming a second kind of menu that would drift from it. Two
things it had to answer for itself: **reordering is a ↑ on every row but the first, not a drag** —
swapping a row with the one above reaches every order of three, for half the clutter of an up/down
pair — and **the last criterion cannot be removed**, because `saveSortChain` would write an empty
`criteria` and `getSortChain` reads that as *the view's default*, so the removal would be undone by
the render that removing it triggers.

### 7 · The first criterion cuts the piles

There is still no grouping control and still no stored grouping preference; `sortui.js`'s rule —
*"changing the sort restacks the view"* — held and sharpened: **the first criterion cuts the piles,
and the rest order the cards inside each one.** That is rarity piles each standing in curve order,
which is the arrangement the problem statement says is worth looking at and which this app could not
draw while a sort was one field.

It needed almost no code. `cardGroups` is handed the first criterion's field, and the list it cuts was
already ordered by the whole chain — so what a later criterion changes is the order *within* a pile,
and only the first one restacks the table. What it needed was the test saying so.

Nesting piles one level per criterion was rejected: a second dimension the mat cannot draw at any card
size.

### 8 · The table header is a shortcut into the same model

A plain click on a column heading makes that column the sort; a shift-click adds it as the next word,
up to three. Neither writes the stored entry. They hand a chain to the control's `set()`, which is the
only thing that writes it — so the sentence on the strip and the marks on the header row cannot come
apart, and `syncColSortControl()`, which existed only to stop them from doing so, is gone. So are the
two things that only existed for it: `saveSort()`, the second writer, and `state.sort`, the mirror of
the first criterion that the header drew its arrow on.

The marks say more than they did. `↑` on the column that cuts the piles, `2↑` and `3↓` on the columns
that only order the cards inside them, the first in `--primary` and the rest in `--text-muted` — because
a shift-click nobody can see the result of is a feature nobody knows they used.

---

## Where the build departed from the plan

- **A plain header click is `chooseSortField`, not an unconditional re-seed.** The ticket said it
  "replaces the whole sort with that column's seeded chain", drawn against shift-click's *append*, and
  on unedited chains the two readings agree. They part on a chain somebody built in the popover, and
  there the header follows the model: it swaps one word and leaves the tail. A header that ignored the
  `edited` bit would let one click destroy a three-word sort with no undo, while the popover doing the
  same thing preserved it — which is the header being a second system again, in a subtler place. Every
  column is asserted to give the same answer as the select's first row.
- **A shift-click at three criteria spends the last word** rather than doing nothing. The popover's Add
  greys out at three and can say why in a tooltip; a shift-click has nowhere to put that sentence, and
  a gesture that silently does nothing is one people conclude is broken.
- **A shift-click on a column already in the sort flips it where it stands.** Duplicating is impossible
  — `tidyChain` drops a repeated field, since the second occurrence could never fire — which left
  moving it to the end or flipping it. Moving silently reorders a sentence somebody wrote.
- **Quantity and Total turned out to be one field said twice.** They were always the same number under
  two names; the header writes the one the control can say, and `total` survives in `sortKey` and in a
  small alias table on the read path because it is what earlier versions wrote into the stored sort.
- **`readPrefs()` was not in any ticket.** `JSON.parse` on a truncated `mtgtools_sort` did not give the
  sort a bad value — it threw as `sortui.js` loaded, taking down the file every tab gets its sort
  control, its column menu and its card-size slider from. That is a blank app rather than a lost
  preference, and the same line was under `mtgtools_cols` and `mtgtools_size`, so all three read
  through one defensive parse now.
- **Renaming a collection has no UI to reach it.** A collection is named when it is added and nothing
  edits that afterwards, so a rename means editing the database. The behaviour — the field is the key,
  the label is the name, so a rename changes the word in the select and the header and nothing else —
  is asserted at the unit level rather than in the tab.

---

## What this cost, and what it did not

**Cards still jump as their metadata lands, and that was left alone.** An uncached card gets `{}` from
`scryfallMetaCache`, so `sortKey` scores it `-1` and it sorts as though its mana value were zero;
`ensureSortMeta` fetches 800 names at a time and re-renders. Three criteria mean more fields needing
metadata and more reshuffles, and re-renders are animated now, so the grid rearranges under the cursor
rather than just redrawing. The alternative — park unresolved cards at the end and let them settle —
was considered and rejected in favour of leaving existing behaviour alone. The cost is known and
accepted.

**The label can be clipped.** 240px is the widest the control can be before the Collections and Want
List strips wrap a row earlier than the select and arrow made them, measured in the real page against
a worktree at `HEAD`. What clips is the end of the sentence, which is where the words separating the
fewest cards are. Collections used to wrap at 1280px and now holds to 1000.

**Shift-click has no keyboard or touch equivalent, deliberately.** A `<th>` is not focusable, making the
header row so is a tab stop per column on the way into the table, and a phone has no shift key. The
sort control is that path: its popover adds, reorders, flips and removes criteria, sits directly above
the table, and is fully operable by keyboard. A tooltip on every heading is what tells somebody holding
a mouse that the shortcut exists.

**Three, not four.** The fourth criterion has never changed an order anyone noticed. A stored list
longer than three is truncated rather than rejected — the first three words are still the sort you
asked for, and a view that throws is a blank tab.

**The `!important` ratchet moved down.** `.sort-select` took two declarations with it — they had been
shouting a padding and a font-size over a base control rule, and the select they were on is gone. That
is the fifth entry retired the way the list asks for: by removing what it was fighting rather than
re-scoping it.

---

## How it is kept

Five checks, all runnable locally, all green on the final commit:

```
npm test                # 338 tests across 16 files, up from 276 across 15
npm run lint:tokens     # the token contract over the delivered CSS
npm run check:contrast  # every text/surface pair, in all five themes
npm run measure:mobile  # hit-tests every control at 390px
npm run capture-screens # 110 views for human review
```

**No new seams.** `test/cardgroups.test.js` already ran the shipped `public/js/sortui.js` in a `vm`
sandbox against stub globals; `test/cardsort.test.js` is the same seam pointed at the same file, so
both assert on the code the browser is served rather than on a copy of it. What it covers: a chain
orders by its first criterion and reaches the second only on a tie; each criterion's direction is
independent; the name tiebreak makes the order total, so sorting twice gives the same list; every row
of the seed table; re-seeding replaces an untouched tail and leaves an edited one alone; a stored
`{ field, dir }` reads back as a one-criterion list; a criterion naming a collection that no longer
exists is dropped; and no header gesture can reach a chain the control's label cannot say.

The popover's DOM is not tested, exactly as `mountSortControl` never has been. The label is, because
it is a function of the chain and the view's field list rather than of anything rendered.

What the seam cannot see was driven in headless Firefox over WebDriver BiDi against a seeded
two-collection database, in the dark and light palettes: seven header clicks, each checked against the
control's label, the stored entry, the marks on the header row and the order of the rows, plus a reload
proving the round trip. The migration was checked the same way — a browser handed `{"collections":{"field":`
for its sort, `[[` for its columns and `"300"` for its size still draws the table, mounts the slider,
and sorts by name. Those runs are not automated; there is no browser in `npm test` by design.
