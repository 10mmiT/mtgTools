# Spec — Sorting by more than one thing

The PRD for multi-criteria sorting, settled over three rounds of grilling. Every decision below was
made deliberately; where a rejected alternative is worth knowing about, it is named and the reason
is given.

**This is what was planned. What was built is [docs/records/sorting.md](../records/sorting.md), and
where the two disagree the record is what happened.** It is kept because a PRD says *why* in a way a
record written afterwards cannot: the alternatives below were rejected before there was any code to
point at.

---

## Problem Statement

Every card view in the app sorts by exactly one field. You choose Mana Value and the two-drops
arrive in whatever order the merge happened to leave them; you choose Color and the white cards are
a block with no shape inside it. The one thing the app does for you is a name tiebreak, which is
alphabetical order — the least interesting way to arrange cards that are otherwise alike.

What people actually sort by is a sentence: *colour, then mana value, then name.* That is how a
collection gets shelved, how a deck list is read, and how a binder is laid out. The app can say the
first word of that sentence and nothing after it.

It shows worst in the views with the most cards. A collection of twelve thousand sorted by rarity
is four enormous piles. A deck sorted by type is a Creatures block that a player then has to scan
for the curve, which is the question they were really asking. The stack view makes it sharper
still: a pile is cut from the sort field, so "one pile per rarity" is all the shape the view can
ever have, when "one pile per rarity, each pile in curve order" is the thing worth looking at.

## Ground truth — what exists today

All of it lives in [public/js/sortui.js](../../public/js/sortui.js), and every card view is a caller.

**The state** is `{ field, dir }`, one per view, in the `mtgtools_sort` localStorage entry keyed by
view name. `dir` is `1` or `-1`. Five views store one each: `sets`, `collections`, `deckbuild`,
`wants`, `scryfall`.

**The control** is `mountSortControl(containerId, view, fieldKeys, apply, def)` — a `<select>` of
field labels and a button that flips an arrow. Each view passes the subset of fields it supports.

**The order** is `cardComparator(field, dir)`, which compares `sortKey(field, obj)` and then always
tiebreaks by name ascending — note *ascending*, regardless of `dir`, so a descending sort has an
ascending tail.

**The fields** are the twelve in `SORT_FIELDS`, but they are not one population:

| field | how it is ordered |
|---|---|
| `name`, `cmc`, `power`, `toughness`, `number`, `price` | a value off the card, numeric or lowercased |
| `color` | `colorRank()` — colour count first, then a base-6 WUBRG combination key |
| `rarity` | `RARITY_RANK`, common → bonus |
| `type` | `typeRank()` — the dominant type in gameplay order, then the raw type line |
| `qty` | `obj._sortQty`, which the **caller** has to have stamped onto each row |
| `wanted`, `player` | in `SORT_FIELDS` and `SORT_LABELS`, but **not in `sortKey()`** — they fall through to the name default, and `wants.js` sorts them itself with two bespoke comparators |

Collections has two more that never reach `sortui.js` at all: `total`, and `col_<i>` for each
collection's own quantity column. They are set by clicking a table header, written to the same
`mtgtools_sort` entry with `saveSort()`, and cannot be chosen from the select — `syncColSortControl()`
exists to leave the select alone when the stored field is not one of its options.

**Grouping rides on the sort field.** `cardGroups(field, cards)` and `groupLabel(field, obj)` cut
the sorted list into the piles the stack view draws, and the deliberate design decision recorded in
the file is that there is no separate grouping control: *"changing the sort restacks the view."*
Each field has its own bucketing — the curve tops out at `7+`, price falls into four bands,
collector number goes in hundreds, and anything without a bucket of its own groups on the initial
letter.

## Decisions

### A sort is a sentence

A sort is an **ordered list of up to three criteria**, each a `{ field, dir }` pair with its own
direction. Three because the fourth criterion has never changed an order anyone noticed, and per
criterion because "price descending, then name ascending" is a real request that one global arrow
cannot make.

The list is **seeded, not empty**. Every field carries a default chain that fires the moment you
choose it — pick Color and you get colour → mana value → name without touching anything else. The
list is there to edit when the default is wrong, which means the feature pays off on the first
click rather than the fifth, and nobody has to assemble a sentence by hand to get the obvious one.

### Every view, no opt-outs

All five callers get it: Collections, Deck Builder, Set Browser, Want Lists, Scryfall Search. It is
one component, and a view keeping the old single-field control is a view where the sort strip means
something different from every other tab. Two of them lead with a field that is not card metadata —
Want Lists with Most Wanted, the Set Browser with Set Number — and that is all the difference it
makes: a different first criterion.

### The first criterion cuts the piles

Grouping stays welded to the sort and there is still no grouping control. `sortui.js` records the
rule as *"changing the sort restacks the view"*, and a list of criteria keeps it and sharpens it:
**the first criterion cuts the piles, the rest order the cards inside each one.** Rarity piles,
each in curve order — which is the thing the problem statement says is worth looking at.

Nesting piles one level per criterion was considered and rejected: it is a second dimension the mat
cannot draw at any card size. A separate grouping control was rejected for re-introducing the
setting the redesign deliberately refused.

### A criterion is a criterion

The fields that currently live outside `sortKey()` all come inside it. `wanted` and `player` stop
being two bespoke comparators in `wants.js`; `qty` stops depending on the caller having stamped
`_sortQty` onto every row; `total` and `col_<i>` stop being a table-header feature that the sort
control cannot see.

This means `sortKey()` takes a **context** the view supplies — the want map, the collection index —
rather than expecting rows to arrive pre-decorated. `col_<i>` makes a view's field list dynamic,
one entry per collection, which is the price of the table header and the sort control ever agreeing
with each other.

The test: a system that cannot express *most wanted, then mana value* is the current system with
more steps. Want Lists is where the second criterion is most obviously missing, because Most Wanted
produces enormous ties by construction.

### The control says the sentence

The select and the arrow become **one button whose label is the sort** — `Sort: Color → Mana → Name`
— which opens a popover holding up to three rows: a field select, a direction toggle, and a remove.
An "Add" row greys out at three.

The label is the point. A criterion you cannot see is a criterion silently reordering your cards,
which is why the cheap version — keep the select, hide criteria two and three behind a "⋯" — is not
the answer. Inline chips in the strip were rejected too: they grow it unboundedly, wrap badly on
mobile, and drag-to-reorder is a gesture this app already spends on carrying cards. The popover is
the `col-menu` pattern already in this file, so it inherits the outside-click handling and the
styling rather than inventing either.

### Editing the tail makes it yours

Choosing a new first criterion **re-seeds the whole chain from that field's default — unless the
tail has been edited**, in which case only the first criterion is swapped and the rest is left
alone. One dirty bit on the stored sort.

A chain that is still all-default is the app's suggestion, and a better suggestion should replace
it. A chain someone edited is theirs. Always re-seeding is the rule that teaches people to stop
editing the tail, because it does not survive touching the field they are most likely to touch.

### The name tiebreak stays, and stays invisible

`cardComparator` keeps its final name tiebreak, still ascending regardless of direction, still
unshown. It is what makes a render order stable — two cards alike in every chosen criterion must
not swap places between renders. Showing it as a locked fourth row would explain something nobody
asked about and spend a row in a popover capped at three.

### The default chains

| choosing this | seeds |
|---|---|
| Color | colour → mana value → name |
| Mana Value | mana value → colour → name |
| Type | type → mana value → name |
| Rarity | rarity → colour → name |
| Price | price ↓ → name |
| Power, Toughness | that stat ↓ → mana value → name |
| Quantity, Total, a collection's count | that count ↓ → name |
| Most Wanted | wanted ↓ → mana value → name |
| Player | player → name |
| Set Number, Name | itself alone |

Anything countable seeds descending: nobody asks for their cheapest cards or their least wanted
first. Mana value is the near-universal second word because it is the one field that puts a shape
inside any block. Name and Set Number seed alone because they are already unique, so a tail would
never fire.

### An existing sort is one criterion, not a seeded chain

A stored `{ field, dir }` is read as a **one-criterion list, left at that**. Upgrading the app must
not silently reorder the collection someone left sorted by Rarity — they get exactly what they had,
and the chain seeds on their first visit to the control. The new shape is written back only when
the sort next changes.

This is the rule the card-size migration already used when it refused to inherit the retired XL
view's 300px into the grid: a preference someone chose is not an invitation to choose a different
one for them.

### The table header is a shortcut into the same model

In Collections, a plain header click **replaces the whole sort with that column's seeded chain**;
**shift-click appends** that column as the next criterion, up to three. The header stops being a
second sorting system and becomes a fast path into this one — which is what finally removes
`syncColSortControl()`, a function that exists only because the header can currently put the stored
sort into a state the select cannot display.

### A collection criterion is stored by id

`col_<i>` is a positional index into `state.collections`, so deleting the first collection makes a
stored `col_2` quietly mean a different collection's quantities. Criteria store the **collection's
id** instead, and a criterion whose collection is gone is **dropped silently** — it cannot be
honoured, and a message about it is a modal nobody wants. The sort becomes the two remaining words.

### Cards jump as their metadata lands

An uncached card gets `{}` from `scryfallMetaCache`, so `sortKey` scores it `-1` and it sorts as
though its mana value were zero. `ensureSortMeta` fetches 800 names at a time and re-renders, so a
large collection visibly reshuffles as each batch arrives. **This behaviour is kept as it is.**

The cost is known and accepted: three criteria mean more fields needing metadata and more
reshuffles, and re-renders are animated now, so the grid rearranges under the cursor rather than
just redrawing. The alternative considered — park unresolved cards at the end and let them settle
into the order — was rejected in favour of leaving the existing behaviour alone.

### Context is threaded, not registered

`cardComparator(criteria, ctx)` passes a plain context object down to `sortKey(field, card, ctx)` —
`{ wants, collections }`, or whatever the calling view has. That keeps `sortKey` a pure function of
its three arguments, which is what the existing test seam depends on.

Two alternatives were rejected. Letting views **register a resolver per field** puts sorting logic
back in the five view files, which is the thing this change exists to undo. Formalising the
**pre-decorated row** — every criterion's value stamped onto each row before sorting — is `_sortQty`
with more fields, and `_sortQty` is on the list of what goes.

### The seam is the one that is already there

`test/cardgroups.test.js` runs the shipped `public/js/sortui.js` in a `vm` sandbox against stub
globals and asserts on `groupLabel` and `cardGroups` directly, so that the tests hold "the code the
browser is served rather than a copy of it". **That same seam, one new `test/cardsort.test.js`, and
no new seams anywhere.**

What it asserts:

- a chain orders by its first criterion and reaches the second only on a tie
- each criterion's direction is independent of the others'
- the invisible name tiebreak makes the order total — sorting twice gives the same list
- choosing a field seeds the chain in the table above
- re-seeding replaces an untouched tail and leaves an edited one alone
- a stored `{ field, dir }` reads back as a one-criterion list
- a criterion naming a collection that no longer exists is dropped

The popover's DOM is not tested, exactly as `mountSortControl` is not tested today.

## How it is built

A ticket set — the repo's pattern for work this size, and what the last two efforts used at 25 and
11 tickets. The cuts are one shippable, testable change each, and the first three carry all of the
risk. One change would put a localStorage migration and a new control in the same commit, which is
the commit nobody can bisect.

It came to eight, and they are retired: `01-criteria-model`, `02-a-criterion-is-a-criterion`,
`03-collection-criteria-by-id`, `04-seeded-chains`, `05-stored-sorts-migrate`,
`06-the-control-says-the-sentence`, `07-first-criterion-cuts-the-piles` and
`08-table-header-is-a-shortcut`. What each of them settled is in the record.
