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

**Status:** ready-for-agent

- [ ] A burst of edits produces one snapshot, not one per save
- [ ] Switching deck or closing the tab mid-burst still captures that burst
- [ ] Importing, deleting a category, bulk-moving or deleting a deck each force a snapshot of the state immediately before, tagged with which operation caused it
- [ ] Snapshots are capped by count and by age, and the cap holds months of real history at the write rate above rather than one session's
- [ ] The History panel lists snapshots with what changed relative to the previous one
- [ ] Restoring returns the deck to that state, and writes a snapshot first so it can be undone
- [ ] A deck deleted and its snapshots removed with it leaves nothing orphaned
- [ ] Restoring a snapshot taken before a card was added does not resurrect cards into categories that no longer exist
- [ ] The panel works in all five themes and at every breakpoint
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
