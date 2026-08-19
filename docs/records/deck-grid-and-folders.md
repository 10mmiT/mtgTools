# The Decks tab — what was done

A record of the work on `feat/deck-folders`, written after delivery. It supersedes the ten tickets
it was driven from — GitHub issues #32 through #41 — and stands beside the spec it was written from
(`docs/design/spec-deck-grid-and-folders.md`). Where this document and a ticket disagree, this one
is what happened.

---

## The gap

> The Players tab was a list of everybody. The first thing you saw was other people's decks stacked
> above your own.

Every player was a collapsible section and every section a wall of deck tiles, in whatever order
the players happened to be in. Your own decks were somewhere in it. There was no way to group them,
no way to keep one to yourself, and the Deck Builder — the place you actually work — greeted you
with a bare `<select>` of *every deck the group owns*.

Four changes, in one shape: **the tab is your decks first, and it is yours to arrange.**

1. The Players tab became the **Decks** tab, landing on a grid of your own **built** decks.
2. **Folders** to put them in — made, renamed, removed, filled by menu or by drag.
3. **Opening** a deck moved out of the Builder and onto the tab; the Builder's empty state became a
   signpost.
4. A deck can be **private** — enforced on the server, not hidden in the browser.

---

## What the numbers say

| | before | after |
|---|---|---|
| Decks the tab shows you first | everybody's, in player order | **yours**, in folders you made |
| Ways to file a deck | — | **2** — the `⋯` menu and a drag |
| Who can read a private deck | anyone logged in | **its owner and admins** |
| Routes that enforce that | 0 | **4** — state read, state write, deck cards, snapshots |
| Fields on a deck | 9 | **11** — `folderId`, `private` |
| New browser modules | — | **1** — `public/js/deckdrag.js` |
| Test files | 38 | **47** — nine new, one per ticket that needed one |

The whole branch is +4,333 / −645 lines across 36 files, of which +2,740 are tests. The suite
goes from over 800 assertions to over 1,000; the exact figure moves between runs, so the file count
is the one worth writing down.

---

## The three decisions that shaped it

**Built means it has cards, not that it has a link.** A deck's metadata lives in the state blob; its
cards are rows in `deck_cards`. The grid shows the second kind. `GET /api/state` now returns
`deckCardCounts` — `SELECT deck_id, SUM(qty) … GROUP BY deck_id` — and `deckCardCounts[id] > 0` is
the definition of *imported*, used identically by the grid, the Builder's switcher and the Drafts
strip. Archidekt's own `cardCount` means "this link points at 99 cards", which is not the same
claim.

**Privacy meant a merge on write, not a filter on read.** This is the load-bearing part, and it is
not obvious. State moves as one whole blob: the client sends every player back on most saves. A
non-admin never *receives* another player's private decks, so their outgoing blob is missing them —
and the existing equality check would have `403`'d the save outright, while a server that trusted
the blob would have deleted the hidden deck. So `POST /api/state` (`routes/state.js:230`) keeps
every **other** player's stored record exactly as it is and takes only the requester's own player
from the blob, comparing **visible** decks only on both sides. Hidden decks survive their owner's
absence; nobody's legitimate save wedges.

One predicate carries the rule — `canSeeDeck(session, ownerId, deck)` at `routes/state.js:108`,
with `deckVisibleTo(session, deckId)` as its per-id form — and the deck-card and snapshot routes
answer **404** rather than 403 on a private deck, so a stranger cannot confirm that it exists.

**Open mode ignores the flag entirely.** With no `ADMIN_PASSWORD` there is no server-side identity:
the session is a guest and the server cannot tell owner from stranger. Rather than a hide that
looks like security and isn't, the flag is inert there — nothing is withheld, and the client hides
the control and the badge (`deckPrivacyEnforced()`, `public/js/players.js:464`). The field is still
stored and round-tripped, so a deployment that later gains accounts keeps whatever was marked.

---

## Where this diverges from the spec

**The Builder kept a deck switcher.** The spec flagged this as a minor open decision — cut it and
the tab always routes back through Decks. It was kept, but reduced: it is not on the empty tab at
all (`.db-when-deck`), it lists only your built decks, and `dbSelectDeck` writes it rather than the
three call sites poking `sel.value`. That last change fixed a real bug — Build on a tile silently
did nothing for a deck the old picker did not hold.

**The Drafts strip was kept.** The spec offered it as the one block to cut. It ships, because the
grid's promise ("your *built* decks") otherwise makes a deck you added and never opened invisible on
the tab you land on.

**A draft can still be filed from the Everyone view.** The spec says drafts "can't be foldered until
built", and the strip offers no drag and no *Move to folder*. The Everyone view draws every deck of
yours as an ordinary tile, built or not, and those tiles keep both affordances — so filing a draft
there works, and the deck appears in that folder once it is built. Not enforced, deliberately: the
acceptance criteria scope the strip and the grid to Mine, and the result is harmless.

**`docs/features.md` still heads the section "Players & Decks tab".** The tab is named Decks in the
rail, the phone dropdown and the UI; the prose heading was not renamed.

---

## What lives where

| file | what it carries |
|---|---|
| `public/js/players.js` | the tab — scope, folders, tiles, the privacy control, the Drafts strip |
| `public/js/deckdrag.js` | the drag: which tiles are pickable, which zones would take one, what a drop does |
| `public/js/state.js` | the four field whitelists the new deck fields had to be added to |
| `routes/state.js` | `canSeeDeck` / `deckVisibleTo`, `deckCardCounts`, the non-admin merge rule |
| `routes/decks.js` | the 404 guard on deck cards and snapshots |

Nine test files answer to it: `deckfields`, `deckbuilt`, `deckprivacy`, `deckprivacy-open`,
`deckscope`, `deckfolders`, `deckdrag`, `deckdoor`, `deckdrafts` — the HTTP seam for the four
routes, the vm seam for everything the tab decides.

---

## Two things left open

- **Filing a draft from the Everyone view** (above) is unenforced. Worth a ticket if the rule should
  hold everywhere rather than where the strip is.
- **The vm harness is copied three times.** `deckscope`, `deckdrag` and `deckdrafts` each carry a
  verbatim ~60-line sandbox; only their probes differ. Every one of the 47 test files here is
  self-contained, so extracting a shared helper is a change to the suite's shape rather than a
  tidy-up, and was left for its own ticket.
