# 04 — Choosing a field seeds the sentence

**What to build:** picking a field does not give you one criterion, it gives you the sentence that
field usually belongs to. Choose Color and you are sorted colour → mana value → name without
touching anything else.

The chains:

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

Anything countable seeds descending — nobody asks for their cheapest cards or their least wanted
first. Mana value is the near-universal second word because it is the one field that puts a shape
inside any block. Name and Set Number seed alone because they are already unique, so a tail would
never fire.

Seeding is what makes the feature pay off on the first click rather than the fifth, so it carries a
rule about ownership: **choosing a new first criterion re-seeds the whole chain, unless the tail
has been edited.** A chain that is still all-default is the app's suggestion and a better
suggestion should replace it; a chain someone edited is theirs. That is one dirty bit stored
alongside the criteria. Always re-seeding is the rule that teaches people to stop editing the tail,
because it does not survive touching the field they are most likely to touch.

A seeded chain that names a field the current view does not support drops that criterion — the Set
Browser has no Quantity, and a chain must never contain a field its view cannot sort on.

From `docs/design/spec-sorting.md` → "The default chains" and "Editing the tail makes it yours".

**Blocked by:** 02 — Every field is a real criterion.

**Status:** done

- [x] Choosing a field produces that field's chain from the table above — `seedChain(field, fields)`
- [x] Countable fields seed descending; Name and Set Number seed as a single criterion
- [x] A seeded criterion naming a field the view does not support is dropped from the chain — the
      view's own field list is what `seedChain` is filtered against
- [x] Editing any criterion after the first marks the chain edited — `editSortChain()`, which decides
      on the tail it was handed rather than on which row was touched
- [x] Changing the first criterion of an unedited chain re-seeds the whole chain — `chooseSortField()`
- [x] Changing the first criterion of an edited chain swaps only that criterion and leaves the tail alone
- [x] The dirty bit is stored with the sort and survives a reload — the `mtgtools_sort` entry is
      `{ criteria, edited }`, read back by `getSortChain()`
- [x] Clearing the tail back to the seeded chain is possible without clearing the dirty bit by hand —
      `reseedSortChain()` re-seeds from the first criterion and drops the bit, keeping the arrow that
      criterion was left pointing. It has no control to reach it until 06 puts one in the popover
- [x] `test/cardsort.test.js` asserts every row of the table, plus re-seed and no-re-seed
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

Four things settled here:

- **The five views sort by the whole chain now.** The seeded sentence would otherwise be stored and
  never heard — the views were still reading one field and one arrow — and this ticket's own headline
  is that choosing Color *sorts you* colour → mana value → name. So each view reads `getSortChain()`
  and hands the criteria to `cardComparator`. The select is still one word wide until 06; what it
  writes is the whole sentence.
- **A view's default is seeded; a stored sort is not.** A default is the app's suggestion rather than
  anybody's preference, so it is the one chain seeded without being asked for — which is how a first
  visit to the Want List is most-wanted then mana value rather than one enormous block per number of
  people who want a card. A stored `{ field, dir }` stays one criterion, which is 05's rule, arriving
  early because chains had to be readable the moment they were writable.
- **A chain never says the same field twice.** Swapping the first criterion of an edited chain for a
  field already in the tail would otherwise leave "Price → Price → Name": the second occurrence can
  never fire, so it is dropped. It is the one place the tail of an edited chain is touched, and the
  alternative is a sentence that reads like a bug.
- **The bit is stored rather than derived.** It could be worked out by comparing the tail against
  what the field seeds today, and that would clear itself when someone undid their edit by hand. It
  is stored anyway, because this table is the app's opinion and will be edited again — a chain
  somebody made theirs must not fall back into the app's hands because a later version changed its
  mind about what Rarity suggests.
