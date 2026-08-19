# Spec — The Decks tab: your decks, in a grid, in folders (and some of them private)

Today the Players tab is a list of everybody. Every player is a collapsible section, every
section a wall of deck tiles, and the first thing you see is other people's decks stacked above
your own. The Deck Builder has its own front door: open the tab and it hands you a bare `<select>`
of *every deck the group owns* plus a **New deck** button.

This spec does four things:

1. Makes **your own decks the thing you see first** on the renamed **Decks** tab, in a grid.
2. Gives you **folders** to put them in.
3. Moves **opening an existing deck** out of the Deck Builder and onto the Decks tab. The Deck
   Builder's empty state becomes a **pointer** — a line of text and a button that takes you to the
   Decks tab. **New deck** stays in the Builder.
4. Lets you mark a deck **private**, so other players cannot see it — enforced on the server, not
   just hidden in the UI.

---

## What is being built

- The **Players tab is renamed to Decks**. Its default view is **a grid of your imported decks**,
  grouped into folders you make.
- **Imported** means *built* — a deck with cards saved in the `deck_cards` table, i.e. one opened
  in the Deck Builder at least once. A deck that is only a name and a link, never opened, is not on
  the grid but is not lost (see *Drafts*).
- A **Mine / Everyone** scope toggle sits in the toolbar. Default **Mine**. Flip it and the old
  per-player sectioned view is what you get, read-only for players that aren't yours.
- **Folders** are flat (one level, no nesting), belong to a player, and are made, renamed and
  removed from the grid. A deck is dragged into a folder, or moved with its `⋯` menu. Decks in no
  folder sit loose above the folders.
- The **Deck Builder**, opened with no deck selected, shows **a message pointing at the Decks tab**
  (with a button that switches to it) instead of the open-existing dropdown. The **New deck**
  button stays. A compact deck switcher remains available *once a deck is open* (see
  *Deck Builder*).
- A deck can be **private**. A private deck is visible to its **owner and to admins**, and to
  nobody else — the server withholds both its metadata and its card data from other players. New
  decks are **public** by default; privacy is a toggle on the deck's `⋯` menu.

Nothing here changes what a deck *is* or how the Builder saves cards. It changes what you land on,
adds two fields to a deck (`folderId`, `private`) and one list to a player (`folders`), and adds
ownership-aware filtering to three read routes.

---

## Ground truth — what exists today

Worth writing down because it sets what is reuse, what is new, and where the private-deck work has
to reach.

**A deck lives in two places.** Its *metadata* — `id`, `name`, `commander`, `commanderImg`,
`source` (`archidekt` | `manual`), `deckId`, `cardCount`, `bracket`, `deckUrl` — is an entry in
`player.decks[]`, inside the `{players}` JSON blob at `app_state`. Its *cards* are rows in the
`deck_cards` table, keyed by `deck_id` — and `deck_id` **is** the metadata entry's stable `id`
(`d_…`, `arch_…`, `legacy_…`). See [routes/decks.js](../../routes/decks.js) and
[available-db.js](../../available-db.js).

**State is written as one whole blob.** The client sends the entire `players` array to
`POST /api/state` on most saves ([state.js `saveToStorage`](../../public/js/state.js#L128)); the
server stores it verbatim ([routes/state.js `writeState`](../../routes/state.js#L40)). There is
also a granular door, `PUT /api/players/:id/decks` (`savePlayerDecks`), that replaces one player's
decks. **This whole-blob model is the crux of the private-deck work** — see *Private decks*.

**Non-admins may only change their own player.** `POST /api/state` refuses a non-admin whose
incoming array differs (after `normalizeDeck`/`normalizePlayer`) from the stored one on any player
but their own ([routes/state.js:177](../../routes/state.js#L177)). `PUT …/decks` is guarded by
`requirePlayerAccess` (owner or admin).

**The grid of tiles already exists** — `renderPlayers()` in
[public/js/players.js](../../public/js/players.js#L311) draws `.deck-tile` cards with commander art,
a bracket badge, card count, and Compare / Build / `⋯` buttons. This is the tile we reuse.

**Scope-toggle precedent is the Collections tab.** `colScope` / `setColScope` / `syncColScope`
([collections.js:107](../../public/js/collections.js#L107)) do "Mine / All" against `myPlayerId()`,
persist to `localStorage`, and *hide the control* when the app can't say who you are. We mirror it,
key `mtgtools_deck_scope`.

**Identity** is `myPlayerId()` ([auth.js:126](../../public/js/auth.js#L126)): the linked player,
or in open mode the name behind Available@'s "Who are you?" bar, or `null`.

**Editability** is `isMyPlayer(playerId)` / admin ([auth.js:102](../../public/js/auth.js#L102)).

**The Deck Builder's front door** is `dbDeckSel` (the open dropdown) and `_dbHideDeckUI()` for the
empty state ([deckview-core.js:209](../../public/js/deckview-core.js#L209),
[dbSelectDeck](../../public/js/deckview-core.js#L241)). Opening an Archidekt deck with no local
rows auto-imports its cards on first open ([deckview-core.js:306](../../public/js/deckview-core.js#L306)).

**Server-side identity does not exist in open mode.** With no `ADMIN_PASSWORD` the session is
`guest` with no `playerId`; identity there is a browser-remembered name the server never sees. This
is the limitation the private-deck section has to be honest about.

**What is missing.** The client has no idea which decks have `deck_cards` rows — `/api/state`
returns metadata only.

---

## Data model

### A folder — per player, in the state blob

```js
player.folders = [
  { id: 'f_1699…', name: 'Commander', position: 0 },
  { id: 'f_1700…', name: 'Retired',   position: 1 },
];
```

Flat. No `parentId`. `position` orders them; reserved now, wired to drag-reorder later.

### A deck gains two fields

```js
deck.folderId = 'f_1699…' | null   // null/missing = loose, above the folders
deck.private  = true | false       // default false; hidden from non-owners when true
```

A `folderId` naming a folder that no longer exists reads as `null` — deleting a folder drops its
decks to loose, no migration needed.

### The "is it built" signal — new server data

The grid filters to built decks and wants a real card count, neither of which the client has. Add
a **live, ownership-filtered** count map to `GET /api/state` (see *Private decks* for why it must
be filtered):

```js
// routes/state.js, in the /state handler, after resolving who may see what
const rows = db.prepare('SELECT deck_id, SUM(qty) AS n FROM deck_cards GROUP BY deck_id').all();
// keep only decks the requester is allowed to see
const deckCardCounts = Object.fromEntries(
  rows.filter(r => visibleDeckIds.has(r.deck_id)).map(r => [r.deck_id, r.n])
);
res.json({ collections, players: visiblePlayers, version, deckCardCounts });
```

`deckCardCounts[deck.id] > 0` is the definition of **imported**, and the value is the count badge
(preferred over the metadata `cardCount`, which is Archidekt's number, not what was built).

---

## Private decks — the server enforcement

You chose **server-enforced**, **owner + admin can see**, **default public**. Because state moves
as one whole blob, "hide it on read" is not enough on its own — the same blob comes back on write,
and a naive filter would either delete the hidden deck or wedge every non-admin save. Three routes
change, plus one merge rule.

### 1. `GET /api/state` — withhold, don't just omit

Resolve the requester (`getSession(req)` → `playerId`, `role`). Build the players array so that
for every player who is **not** the requester and when the requester is **not** admin, decks with
`private: true` are removed. Build `visibleDeckIds` (every deck the requester may see) and filter
`deckCardCounts` by it, so a private deck leaks neither its existence nor its size.

### 2. `POST /api/state` — merge, so a hidden deck survives its owner's absence

A non-admin never receives other players' private decks, so their outgoing blob is missing them. If
the server trusted that blob it would delete them — and today's equality check would `403` the save
outright (the stored player has a private deck the incoming one lacks). Both are wrong. The rule
becomes:

> For a non-admin write, the server keeps every **other** player's decks exactly as stored
> (private ones included) and takes only the **requester's own** player from the incoming blob. The
> per-player equality check compares only the **visible** decks (private decks of others are
> excluded from both sides before `deepEqual`).

This preserves hidden decks, keeps the "non-admins edit only themselves" guarantee, and never
wedges a legitimate save. Admins receive and write the whole blob unchanged. The requester's *own*
private decks are always in their blob (they can see them), so their own writes are lossless.

### 3. `PUT /api/players/:id/decks` — already owner-scoped, but must not lose privacy

`requirePlayerAccess` means only the owner or an admin calls it, and both see all of that player's
decks — so this door already carries private decks. It is the door `savePlayerDecks` uses for deck
adds and folder moves, so most deck mutation is safely owner-scoped. Just ensure the client's
`savePlayerDecks` whitelist includes `private` (below) so the flag round-trips.

### 4. Deck card + history routes — guard by owner/admin/public

`GET …/decks/:deckId/cards` and the snapshot routes are `requireAuth` only today — anyone logged in
can read any deck's cards by id. Add a guard: look up the deck's owner and `private` flag from
state by `deckId`; if it is private and the requester is neither owner nor admin, **404** (hide
existence, don't confirm it with a 403). A small helper — `deckVisibleTo(session, deckId)` — is
shared by these routes and by the `/api/state` filter so the rule lives once.

### Open mode — the flag is ignored

In open mode there is no server-side identity, so the server cannot tell owner from stranger and
**cannot enforce privacy**. The decision: **in open mode the `private` flag is ignored entirely** —
every deck is visible, `GET /api/state` filters nothing, the merge rule and route guards no-op, and
the UI shows no lock badge and no Make-private control. This is more honest than a hide that looks
like security but isn't, and it fits open mode's nature — a trusted single-household LAN deploy with
no passwords, where there is nobody to keep a deck secret *from*.

Concretely: the server distinguishes the two modes the way the rest of the app does —
`session.role !== 'guest'` (equivalently, an `ADMIN_PASSWORD` is set) means an account deployment
where enforcement is real; a `guest` session means open mode where the flag is inert. The `private`
field is still stored and round-tripped in both modes (a deployment that later gains accounts keeps
whatever was marked), it simply has no effect while the app is open. The Make-private control is
hidden when `myPlayerId()`'s deployment has no accounts, so nobody sets a flag that does nothing.

Everything below the mode check assumes account deployments, where enforcement is real.

---

## The four whitelists (where new fields must be added)

The client round-trips through explicit field lists, so `folderId`, `private`, and `folders` are
silently dropped unless added to each:

1. [state.js `stateToJSON()`](../../public/js/state.js#L75) — `folders` on the player map;
   `folderId`, `private` on the deck map.
2. [state.js `savePlayerDecks()`](../../public/js/state.js#L277) — `folderId`, `private` on the
   deck map.
3. [state.js `hydrateState()`](../../public/js/state.js#L92) — read `p.folders || []`,
   `d.folderId || null`, `d.private || false`.
4. [routes/state.js `normalizeDeck` / `normalizePlayer`](../../routes/state.js#L72) — same fields,
   so the non-admin permission `deepEqual` compares them.

`deckCardCounts` is server→client only and needs no whitelist.

---

## Persistence paths for the new mutations

| Action | State touched | Save call |
|---|---|---|
| Create / rename / remove / reorder a folder | `player.folders` | `saveToStorage()` (whole state) |
| Move a deck into / out of a folder | `deck.folderId` | `savePlayerDecks(playerId)` |
| Toggle a deck private / public | `deck.private` | `savePlayerDecks(playerId)` |

All optimistic: mutate in memory, re-render, fire the save, roll back and alert on failure — the
pattern `setCollectionOwner` uses ([collections.js:136](../../public/js/collections.js#L136)).

---

## The Decks tab UI

One renderer for the tab, driven by scope:

- **`scope: 'mine'`** — decks of `myPlayerId()` only, grouped by folder. Loose decks first, then a
  section per folder in `position` order. Only *built* decks (`deckCardCounts[id] > 0`), ending in
  the *Drafts* strip.
- **`scope: 'all'`** — the existing per-player sectioned layout
  ([players.js:332](../../public/js/players.js#L332)), each player's folders within their section,
  editing enabled only where `isMyPlayer(playerId)` / admin. Other players' **private decks never
  arrive from the server**, so there is nothing to hide client-side here.

The tile is today's `.deck-tile`, with two additions:
- A **lock badge** on private decks (yours, or any as an admin).
- The `⋯` menu gains **Make private / Make public** (owner or admin only) and **Move to folder →**
  (a submenu of folders + "Remove from folder"). `kebabMenuHtml`
  ([players.js:383](../../public/js/players.js#L383)) is the existing builder — the touch/keyboard
  path that must always work.

Around the tiles: **folder headers** (name, count, rename/remove in a `⋯`), a **loose zone** and
each **folder as a drop target**, and a **"+ New folder"** affordance.

**Drag and drop.** Tiles get `draggable="true"` carrying `{ playerId, deckId }`; folders and the
loose zone are drop targets that set `folderId` and call `savePlayerDecks`. Disabled for players
you can't edit. Drag is the mouse accelerator over the `⋯` menu, not a replacement for it.

**The scope toggle** mirrors Collections: default Mine; when `myPlayerId()` is `null` force Everyone
and **hide the toggle** (as `syncColScope` does). Re-render when the open-mode name changes, the way
`colIdentityChanged` ([collections.js:219](../../public/js/collections.js#L219)) does.

**Player administration** — **+ Add Player**, **Remove player** — lives in the **Everyone** view,
where the per-player sections are. The Mine view is only your decks and folders.

### Drafts — decks that aren't built yet

The Mine view ends in a muted **"Not built yet"** strip: your not-imported decks as small link rows
(name, source, **Build** → opens in the Deck Builder, which auto-imports Archidekt cards on first
open). They can't be foldered until built. This keeps the promise ("the *grid* is your built
decks") without hiding anything. If you'd rather they not show, this strip is the one block to cut.

---

## The Deck Builder, after the move

- **Empty state (no deck selected):** replace the open-existing dropdown with a short message —
  *"Open a deck from the Decks tab"* — and a **button that switches to the Decks tab** (`setTab
  ('decks')`). Keep the **New deck** button beside it.
- **New deck** is unchanged and stays here — it is the one place a deck is created from scratch.
- **Once a deck is open:** a compact deck switcher stays for jumping between *your* built decks
  without leaving the tab (populated from `dbPopulateDeckSel`, filtered to what you may see). This
  is the only surviving use of the old dropdown; if you'd rather the Builder never opens an
  existing deck at all, cut it and the tab always routes back through Decks. **Minor decision —
  flagged.**

---

## Decisions, and what each one beat

**Imported = has `deck_cards` rows, not = has Archidekt metadata.** You chose "opened in Deck
Builder." `cardCount` means "this link points at 99 cards," not "I have built this." Keying off
`deck_cards` makes the grid exactly the decks the Builder can open.

**A toggle, not a new tab.** Keeps eleven tabs, reuses Collections' scope machinery, and puts
"mine" and "everyone" one switch apart. The Everyone view is the old sectioned layout — demoted
from default, not deleted.

**Flat folders, per player, in the state blob.** No schema migration, no new table, no nesting tree
to validate. A folder is how *that person* organizes *their* decks; others read it.

**Opening moves to Decks; New deck stays in the Builder.** You chose to keep creation where the mat
is. Opening — picking among many — belongs with the gallery of decks; creating — one blank deck —
belongs where you'll build it. The empty Builder becomes a signpost, not a chooser.

**Privacy enforced on the server, owner + admin, default public.** You chose real enforcement.
Because state is a whole blob, that meant a *merge* on write, not just a filter on read — otherwise
hiding a deck would delete it or wedge the owner's neighbours' saves. Admins keep their usual full
view; new decks stay public so privacy is a deliberate act, not a thing you forget you turned on.
Open mode ignores the flag outright — with no server identity there is no honest way to enforce it,
and a fake hide is worse than none.

---

## Build order

1. **`private` + `folderId` + `folders` through the whitelists** (four places). No behaviour yet;
   fields round-trip and persist. Verifiable by save-then-reload.
2. **Server signal + privacy filter on `GET /api/state`** — add `deckCardCounts`, filter players
   and counts by `deckVisibleTo`. Store `state.deckCardCounts` in `hydrateState`.
3. **`POST /api/state` merge rule** for non-admins (keep others' stored decks; compare visible
   only). This is the load-bearing change — test it before any UI.
4. **Deck cards / snapshot route guards** via the shared `deckVisibleTo` helper.
5. **Rename the tab to Decks; scope toggle; Mine grid (ungrouped, built decks only).** Ship — the
   headline change.
6. **Folders** — create / rename / remove; folder sections; `⋯` Move-to-folder; private toggle +
   lock badge. Working without any drag.
7. **Drag-drop** as the mouse accelerator on top of (6).
8. **Deck Builder empty state → pointer + button**; keep New deck; optional in-session switcher.
9. **Drafts strip** (or drop it).

## Test surface

The repo tests each concern as its own file (`deckboards`, `deckowned`, `deckhistory`, …). To match:

- `deckprivacy.test.js` — a non-admin's `GET /api/state` omits another player's private decks and
  their `deckCardCounts` entries; a non-admin `POST /api/state` that lacks another player's private
  deck **preserves** it (merge) and still succeeds; `GET …/decks/:id/cards` and the snapshot routes
  **404** for a non-owner on a private deck and succeed for the owner and an admin; a private deck's
  own owner round-trips it losslessly; and in **open mode** (`guest` session) the flag is inert —
  every deck's metadata and cards are returned to everyone.
- `deckfolders.test.js` — `folderId` / `folders` survive `stateToJSON` → `POST /api/state` →
  `hydrateState`; a non-admin moving *their own* deck between folders is accepted, touching
  *another* player's folders is `403`; a `folderId` for a removed folder reads as loose.
- `deckbuilt.test.js` (or extend `server.test.js`) — `deckCardCounts` counts `deck_cards` rows per
  `deck_id`, omits decks with none, reflects a build immediately, and never counts a deck the
  requester may not see.
- Scope default is Mine with an identity, forced Everyone (control hidden) without one.
