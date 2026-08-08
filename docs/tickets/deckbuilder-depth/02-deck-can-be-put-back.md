# 02 — A deck can be put back

**What to build:** a deck remembers what it used to be, and can be returned to it. Today the save
path deletes every card row for a deck and re-inserts, on an 800 ms debounce — so a deleted
category, a bulk move aimed at the wrong pile, or a paste-import into the wrong deck is
unrecoverable about a second after it happens. This is the only ticket in the effort that is
insurance rather than capability, and it is first for that reason.

**When a snapshot is written is the whole design.** Snapshotting every save would write a row a
second, and any sane cap would then hold a few minutes of history — silently evicting the state
worth having. So two rules together:

- **One snapshot per editing burst.** Changes settle, a stretch of idle passes, or the deck is
  switched away from or the tab closed — and one row is written. The unit is *what the deck looked
  like when I sat down*.
- **Plus a forced snapshot immediately before anything bulk or destructive** — paste-import, CSV
  import, deleting a category, a bulk move, deleting the deck — recording what it was about to do.
  Those are the operations that lose work, so the state before them is captured exactly rather
  than whenever idle next happened to fall.

A History panel lists the snapshots, each showing what changed since the one before it, and
restores any of them. Restoring writes a snapshot first, so undoing an undo works.

From `spec-deckbuilder-depth.md` → proposal 5. The rejected alternatives are recorded there:
snapshot-on-every-save, manual versions as the only mechanism, and an in-memory undo stack.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A burst of edits produces one snapshot, not one per save
- [x] Switching deck or closing the tab mid-burst still captures that burst
- [x] Importing, deleting a category, bulk-moving or deleting a deck each force a snapshot of the state immediately before, tagged with which operation caused it
- [x] Snapshots are capped by count and by age, and the cap holds months of real history at the write rate above rather than one session's
- [x] The History panel lists snapshots with what changed relative to the previous one
- [x] Restoring returns the deck to that state, and writes a snapshot first so it can be undone
- [x] A deck deleted and its snapshots removed with it leaves nothing orphaned
- [x] Restoring a snapshot taken before a card was added does not resurrect cards into categories that no longer exist
- [x] The panel works in all five themes and at every breakpoint
- [x] `npm test`, `npm run lint:tokens` and `npm run check:contrast` are green. `npm run measure:mobile` reports the History drawer clean and fails on `deckview` — see *What was left* below

## What was built

`deck-history.js`, a `deck_snapshots` table, four routes on `routes/decks.js`, and
`public/js/deckview-history.js` behind a **History** item in the More menu.

**A snapshot always holds a state from *before* a change.** That is the one idea the
rest follows from: the state a save *produced* is a copy of something the deck already
is, and the state it *replaced* is the only one about to stop existing. So restoring
row N undoes everything that happened after it, and every row in the panel is named for
what it was taken in front of — "Before an import", "Before a category was deleted".

**The burst is closed by arithmetic rather than by a timer.** The obvious reading of the
ticket — wait for the idle to pass, then write the row — means holding the pre-burst
state somewhere until the idle arrives, and losing it if the process restarts first. The
row is written at the *start* of the burst instead, on the first save of it, and an
in-memory `deck_id → last save` map only answers whether the next save belongs to the
same burst. Nothing is ever pending, so *"switching deck or closing the tab mid-burst
still captures that burst"* is true because the burst was captured before the tab
closed, and it needs nothing from the client — no beacon, no unload handler, no race
with a browser that is being killed. Losing the map to a restart costs one extra
snapshot rather than a lost one.

**The idle gap is five minutes, not the spec's thirty seconds.** Thirty seconds is a
pause to read a card's oracle text: at that gap a slow, deliberate hour of building
writes thirty or forty rows, and a cap of fifty would then hold a fortnight of heavy use
— which is the eviction failure the ticket exists to avoid, arrived at from the other
side. Five minutes is getting up. It costs granularity, and costs it only on rule 1:
every operation that can actually lose work forces a row of its own.

**Forced snapshots carry the client's copy of the deck.** They are taken in front of an
operation, at a moment when the autosave is up to 800 ms behind and the browser holds
the truth — a snapshot read back from the database would be a snapshot of a deck nobody
has seen since. `normaliseState()` is the boundary that cuts what arrives down to the
four fields a deck row has. They go out *before* the mutation, synchronously, and
`_dbSave()` awaits the one in flight so the panel cannot list an operation as having
happened before the state it was taken from.

**A snapshot that says what the row before it says takes that row over instead of
sitting beside it.** Two operations with no edit between them are one state, and a panel
row with nothing under "what changed" wastes one of the fifty. The reason is written
onto the existing row, because "you were about to delete a category" says more than "you
were editing"; the time is not, because the state has not changed.

### The two lines that read as contradicting each other

*"Deleting a deck forces a snapshot of the state immediately before"* and *"a deck
deleted and its snapshots removed with it leaves nothing orphaned"* only both mean
something if the pre-delete row is the one thing that survives. So `deckDeleted()`
deletes every snapshot for the deck and writes one tagged `deck-delete` in the same
transaction. The history goes with the deck; what is left is what the deck was as it
went, and it is subject to the age cap like anything else. It is not a formality: an
Archidekt deck keeps its id across a delete and a re-add (`arch_<id>`), which the delete
confirmation already invites you to do, so re-adding it finds that row waiting in the
History panel.

### Restoring, and the pile that comes back from the dead

A card can name a category its own snapshot's category list does not carry. Left alone,
`_dbPaint()` invents the pile on the way past via `dbEnsureCat()` — so the deck that gets
saved is not the deck that was restored, and a category deleted three snapshots ago comes
back carrying cards. `_dbApplyRestored()` reconciles the two lists before either becomes
the deck: a card with nowhere to go is filed in the type bucket it would have been filed
in when it was added.

## What it costs

Measured against the real decks in the capture fixture — sixteen decks, 94–96 rows each:

| | |
|---|---|
| one snapshot of a Commander deck | **7.7 KB** of JSON |
| one deck sitting at the cap of 50 | **~380 KB** |
| all sixteen decks at the cap, vacuumed | **6.17 MB** |

Six megabytes is the ceiling for a playgroup's whole database, and it is a ceiling
nobody reaches: it assumes every deck has been edited on fifty separate occasions. At
two to eight rows a sitting, fifty rows is a season of real building.

## What was left

`npm run measure:mobile` fails on the **deckview** tab: fifteen `button.pile-toggle`
controls report a 36–41px hit area against the 44px floor. This is not from this ticket —
the same fifteen failures, at the same widths, are there with these changes stashed.

It was diagnosed rather than left as a number. The chevron's invisible 44px pad and the
one on `.dv-section-title.db-collapsible` beside it overlap in the header's eight-pixel
gutter, and the title — later in DOM order at the same stacking level — is what
`elementFromPoint()` returns there, so the chevron loses the right-hand half of its pad.
Both call `dbToggleCat()`, which is why nobody has noticed. It is written up as
[ticket 12](12-two-pads-in-an-eight-pixel-gap.md), because the fix is a decision about
what a tap on a category *heading* does and the collision is a pattern rather than an
incident — not something to settle inside a deck-history ticket.

The new **deckview-history** view is measured — it is in `EXTRA_VIEWS` and `SCOPES`, with
a `PREP` that takes a real snapshot so there is a row with a Restore button to measure —
and it reports clean: no sideways scroll, every target at least 44×44.

**Since fixed.** Ticket 12 is done: the heading is one target now rather than two competing
ones, and `npm run measure:mobile` reports deckview clean too.
