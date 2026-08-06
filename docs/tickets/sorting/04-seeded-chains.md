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

**Status:** todo

- [ ] Choosing a field produces that field's chain from the table above
- [ ] Countable fields seed descending; Name and Set Number seed as a single criterion
- [ ] A seeded criterion naming a field the view does not support is dropped from the chain
- [ ] Editing any criterion after the first marks the chain edited
- [ ] Changing the first criterion of an unedited chain re-seeds the whole chain
- [ ] Changing the first criterion of an edited chain swaps only that criterion and leaves the tail alone
- [ ] The dirty bit is stored with the sort and survives a reload
- [ ] Clearing the tail back to the seeded chain is possible without clearing the dirty bit by hand, or the reason it is not is stated
- [ ] `test/cardsort.test.js` asserts every row of the table, plus re-seed and no-re-seed
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
