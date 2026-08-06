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

**Status:** todo

- [ ] Piles are cut from the first criterion's field
- [ ] Cards within a pile are ordered by the remaining criteria, then the name tiebreak
- [ ] Changing the first criterion restacks the view; changing a later one reorders within piles without restacking
- [ ] Every card lands in exactly one pile, and the piles come out in the order the sort put them in
- [ ] Reversing the first criterion's direction turns the row of piles around without consulting the grouping
- [ ] `test/cardgroups.test.js` still passes unchanged, or each change to it is justified in its header
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
