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

**Status:** done

- [x] A collection can be given an owner when it is added, and the owner changed later from its overflow menu
- [x] A collection may have no owner, and one that has none reads as the group's and never as anyone's
- [x] Existing collections migrate to having no owner, and nothing about them changes otherwise
- [x] The Collections tab can show one person's shelf or everyone's, and the choice is remembered
- [x] Removing a player does not orphan or delete their collections
- [x] In open mode the browser-remembered name resolves to a player where it matches one
- [x] In open mode with no matching name, no ownership distinction is offered and everything reads as the group's
- [x] A player with no collection is not an error anywhere
- [x] Works in all five themes and at every breakpoint
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

## What was built

### One column, and the null in it is a real answer

`collections` gains **`owner_player_id TEXT`**, nullable, added by an `ALTER`
guarded the way every other migration in `available-db.js` is. A database made
before owners keeps every row exactly as it was and every collection in it
comes back owned by nobody — which is the group's, and is what a deployment
that never sets an owner goes on reading as forever.

No foreign key, because there is no players table to point at: a player lives
inside the `app_state` JSON blob. What stands in for the constraint is
`disownGonePlayers()`, run after every whole-state write — the only way a
player is ever removed — which clears the owner of any collection naming
somebody who is no longer in the list. **The collection stays.** The cards are
still in the house; what has gone is the person, so the shelf becomes the
group's.

### Two write paths, because a collection is its cards

`POST /api/collections` is the whole-collection write — adding one, refreshing
one, re-importing a CSV — and it now takes an `owner`. It takes it *only when
the field is present*: an absent one leaves the column alone, so a refresh
cannot clear an owner as a side effect. That is a `CASE WHEN @given` in the
upsert, and both halves of it are asserted.

Changing an owner is `PUT /api/collections/:key/owner`, a route of its own,
because the alternative is re-uploading five thousand cards to say a different
name. Both routes refuse an owner naming a player nobody has heard of rather
than storing it — an id that answers to nobody reads as the group's anyway, and
a silent one is a collection that says it belongs to somebody and cannot say
who.

### Who you are, asked properly

`myPlayerId()` in `js/auth.js`, beside `isMyPlayer()` and deliberately not the
same question: `isMyPlayer()` asks what you may *edit* and answers yes to
everything for an admin, and an admin looking at their own shelf is looking at
one person's, not at the eight they may edit.

Open mode has no logged-in player at all, so it falls back to the identity the
app already keeps for exactly that case — `avail_name`, the browser-remembered
name behind Available@'s "Who are you?" bar — matched to a player by name,
trimmed and case-insensitively. The key moved from `js/available.js` to
`js/state.js`, since two features read it now. A logged-in account with no
linked player gets `null` rather than the remembered name: it has an identity,
it just is not a player yet, and reading a name out of its browser would hand
it somebody else's shelf.

`null` is what makes the last two criteria one line each. No identity → the
scope control is not rendered at all (`.scope-mount-hidden`, the size control's
own trick), `colScope()` reads `all` **whatever is stored**, and every
collection is the group's. A stored `mine` from a browser that once knew who it
was cannot hide every collection from somebody who has no way to switch it
back.

### The shelf

One function, `colShelf()`, is the whole of the scoping: the sort's field list,
its context, the query's metadata sweep, the merged rows, the table's quantity
columns and the grid's badges all read it, in one order, so the `qtys` index
means the same thing everywhere. `Mine` is the collections whose owner is you —
never the group's box, per the ticket.

**The chip row is deliberately not scoped.** The ⋯ menu on a chip is where an
owner is set, so a chip you cannot see is an owner you cannot fix; every loaded
collection keeps its chip, and one whose cards are off the shelf goes hollow —
a dashed border and a lighter label, said that way rather than with an opacity
because everything on it is still text somebody may need to read, and fading it
is how a measured contrast ratio stops being the one on screen.

Hiding a column is not removing a collection, and the sort knows the
difference: `reconcileColSorts` still runs against every loaded collection, so
a criterion naming a scoped-away one is filtered out of the *reading* and comes
back when the scope does.

## How it was checked

`npm test` (591), `lint:tokens`, `check:contrast` and `measure:mobile` are
green. `test/collectionowner.test.js` is 29 assertions in three layers: the
migration and the routes against a real SQLite database made in the old shape,
the tab in a `vm` sandbox, and the markup read as text.

Then the real page in headless Firefox against a snapshot of the live database,
in open mode — the case this ticket is fussiest about. With no remembered name
the shelf control is `display: none` and all six collections load; typing `Tim`
resolves it to `p_1779868712164` and the control appears, 176x44 and hittable,
with no sideways scroll at 390px. Setting an owner from the chip reached the
server and gave nobody else one; scoping to Mine left all six chips with five
dashed, and cut the table to one quantity column and 5,554 cards. Both survived
a reload. Removing that player left the collection in place with its 6,848
entries and no owner. The chip row and the Add drawer were read in all five
themes at both widths.
