# 07 — A collection has an owner

**What to build:** the app learns whose shelf is whose.

A session already knows which player you are, and players already own decks and want lists. But a
collection belongs to nobody — the record carries a name, a source and a colour, and the ownership
badge on a card simply walks every collection that happens to be loaded. So the app can say *"this
card is owned"* and cannot say *"you own this card"*, which is the question a person building a deck
is actually asking.

A collection gains **one owner, and it may have none**. The null case is real rather than a
loophole: a shared box belongs to the group, so it counts as the group's and never as any one
person's. An owner is chosen when a collection is added and can be changed afterwards from the
overflow menu each collection row already has.

This ticket is worth having on its own, before anything in the Deck Builder uses it: the Collections
tab gets the same distinction, so a person can look at their own shelf rather than at everyone's.

**Open mode has no logged-in player.** With no admin password there is no player to be — so fall
back to the identity the app already keeps for exactly this case, the browser-remembered name behind
the "Who are you?" bar, matched to a player by name. If it matches nothing, the distinction is not
offered at all and everything reads as the group's. No new idea of identity is introduced here.

From `spec-deckbuilder-depth.md` → proposal 1, "Prerequisite — collections have no owner" and "Open
mode has no logged-in player". Rejected there: a many-to-many owners table, and storing "which
collections are mine" as a per-user preference.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A collection can be given an owner when it is added, and the owner changed later from its overflow menu
- [ ] A collection may have no owner, and one that has none reads as the group's and never as anyone's
- [ ] Existing collections migrate to having no owner, and nothing about them changes otherwise
- [ ] The Collections tab can show one person's shelf or everyone's, and the choice is remembered
- [ ] Removing a player does not orphan or delete their collections
- [ ] In open mode the browser-remembered name resolves to a player where it matches one
- [ ] In open mode with no matching name, no ownership distinction is offered and everything reads as the group's
- [ ] A player with no collection is not an error anywhere
- [ ] Works in all five themes and at every breakpoint
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
