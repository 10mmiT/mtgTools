# 07 — The first criterion cuts the piles

**What to build:** the stack view keeps having no grouping control, and the rule in `sortui.js` —
*"changing the sort restacks the view"* — keeps holding. It just reads the chain now: **the first
criterion cuts the piles, and the rest order the cards inside each one.**

That is rarity piles each standing in curve order, which is the arrangement the PRD's problem
statement says is worth looking at and which the app has never been able to draw.

`cardGroups(field, cards)` and `groupLabel(field, obj)` need no new vocabulary — they are handed
the first criterion's field. What changes is that the list they cut was ordered by the whole chain,
so a pile's contents are in the chain's order rather than alphabetical. The property `cardGroups`
already rests on must survive: every card in exactly one pile, and the piles in the order the sort
put them in.

Two things are explicitly not built. **Nesting piles**, one level per criterion, is a second
dimension the mat cannot draw at any card size. **A separate grouping control** re-introduces the
setting the redesign deliberately refused.

From `docs/design/spec-sorting.md` → "The first criterion cuts the piles".

**Blocked by:** 01 — A sort is a list of criteria.

**Status:** done

- [x] Piles are cut from the first criterion's field — both stack views read it off the chain that
      ordered their cards. The Set Browser already did; Collections was cutting them from
      `state.sort.field`, the mirror of that field three other places keep writing, and now reads
      `colSortCriteria()[0]`
- [x] Cards within a pile are ordered by the remaining criteria, then the name tiebreak — the list
      handed to `cardGroups` was sorted by the whole chain, so this needed no new code, only the
      test that says it is true
- [x] Changing the first criterion restacks the view; changing a later one reorders within piles without restacking
- [x] Every card lands in exactly one pile, and the piles come out in the order the sort put them in
- [x] Reversing the first criterion's direction turns the row of piles around without consulting the grouping
- [x] `test/cardgroups.test.js` still passes unchanged, or each change to it is justified in its header
      — the nine tests that were there are untouched and pass; `piles` is now `chainPiles` of a
      one-word sentence, and the header says so
- [x] Confirmed in the browser as well as in the `vm`: the Collections tab, with a stored
      *Quantity ↓ → Binder ↓*, draws ×5 ×3 ×2 with each pile in Binder order, and swapping only the
      second word leaves the same three piles holding their cards in a different order
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
