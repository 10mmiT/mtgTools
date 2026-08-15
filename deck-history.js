'use strict';
/* A deck remembers what it used to be.
 *
 * `PUT …/decks/:id/cards` deletes every card row for a deck and re-inserts,
 * and the client fires it on an 800 ms debounce. So a deleted category, a bulk
 * move aimed at the wrong pile, or a paste-import into the wrong deck is
 * unrecoverable about a second after it happens. This module is the copy taken
 * before that.
 *
 * ── When a snapshot is written is the whole design ────────────────────────
 *
 * Snapshotting every save would write a row a second, and a cap of fifty would
 * then hold about a minute of history — silently evicting the state worth
 * having. Two rules together instead:
 *
 *   1. One snapshot per editing burst, holding what the deck looked like
 *      *before* the burst. A burst is saves with no gap longer than
 *      BURST_IDLE_MS between them, so a two-hour building session is one row
 *      and not two hundred.
 *
 *   2. Plus a forced snapshot immediately before anything bulk or destructive
 *      — an import, a deleted category, a bulk move, a restore, a deleted deck
 *      — tagged with which operation caused it.
 *
 * Every row therefore holds a state that existed *before* a change, which is
 * the only kind of state worth keeping: restoring row N undoes everything that
 * happened after it was taken.
 *
 * ── Why the burst is closed by arithmetic and not by a timer ──────────────
 *
 * The obvious reading of rule 1 is "wait for the idle to pass, then write the
 * row" — which means holding the pre-burst state somewhere until the idle
 * arrives, and losing it if the process restarts first. The row is written at
 * the *start* of the burst instead, the moment the first save of it arrives,
 * and `lastSaveAt` below only answers whether the next save belongs to the
 * same burst or opens a new one. Nothing is ever pending: a tab closed or a
 * deck switched away from mid-burst has already been captured, and the map is
 * a cache whose loss costs one extra snapshot rather than a lost one.
 */

const { db, readPrinting, deckCardRow } = require('./available-db');

/* The board a row is on when it does not say — routes/decks.js's default, said
 * again here because a snapshot arrives from the client and may predate
 * boards. */
const MAIN_BOARD = 'main';

/* Saves closer together than this are one burst.
 *
 * The unit being aimed at is a sitting — what the deck looked like when you
 * sat down — so the question this number answers is "how long a gap means you
 * got up". The spec proposed thirty seconds, and thirty seconds is a pause to
 * read a card's oracle text: at that gap a slow, deliberate hour of building
 * writes thirty or forty rows, and the cap below would then hold a fortnight
 * of heavy use rather than the months it is supposed to. Five minutes is
 * getting up. It costs granularity — restoring puts you at the start of the
 * sitting rather than five minutes ago — which is the trade the whole design
 * already makes, and it costs nothing on the operations that actually lose
 * work, because those force a row of their own. */
const BURST_IDLE_MS = 5 * 60 * 1000;

/* The caps, whichever bites first. At two to eight rows a session, fifty is a
 * season of real building rather than one afternoon, and it costs about 7.7 KB
 * a row for a Commander deck — under 400 KB for a deck sitting at the cap. The
 * age cap never takes the newest AGE_FLOOR rows: a deck untouched for a year
 * should still be able to say what it was, and an empty History panel is the
 * one thing this whole module exists to prevent. */
const MAX_PER_DECK  = 50;
const MAX_AGE_MS    = 90 * 24 * 60 * 60 * 1000;
const AGE_FLOOR     = 5;

/** The reasons a snapshot can carry. A forced snapshot names the operation it
 *  was taken in front of; 'edit' is rule 1's. */
const REASONS = new Set(['edit', 'import', 'category', 'move', 'restore', 'deck-delete']);

// ── The deck as it is stored ──────────────────────────────────────────────

/** What a deck is, read back in the shape the save path writes and the
 *  snapshot stores — one function, so the two can never drift.
 *
 *  The board comes along with the rest: a deck restored without it is a deck
 *  whose maybeboard has been played, which is a worse loss than the one this
 *  module exists to prevent. Which printing the deck runs comes with it for the
 *  same reason — and this is the one place where forgetting a column is quiet,
 *  because the card is still in the deck afterwards and only its art has
 *  changed back. */
function readDeck(deckId) {
  return {
    cards: db.prepare(
      'SELECT card_name, qty, category, board, position, printing FROM deck_cards WHERE deck_id = ? ORDER BY position, card_name, board'
    ).all(deckId).map(deckCardRow),
    categories: db.prepare(
      'SELECT name, position FROM deck_categories WHERE deck_id = ? ORDER BY position'
    ).all(deckId),
  };
}

/* A state as one string, for comparing two of them. Both sides come out of
 * readDeck() or through normaliseState(), so the ordering is already settled
 * and this is a plain equality test rather than a diff. */
const stateKey = state => JSON.stringify(state);

/** A state as the client sent it, cut down to the fields a deck row has and
 *  sorted the way readDeck() returns them. A forced snapshot carries the
 *  client's own copy — it is taken before the mutation, at a moment when the
 *  browser holds the truth and the database is up to 800 ms behind — so this
 *  is the boundary where that copy stops being anything it likes.
 *
 *  Down to the same shape readDeck() reads, printing and all: the two are
 *  compared as strings by stateKey(), so a field that differed between them by
 *  so much as its key order would make every forced snapshot a new state and
 *  write a panel row for a change nobody made. */
function normaliseState(raw) {
  const cards = (Array.isArray(raw?.cards) ? raw.cards : [])
    .filter(c => c && typeof c.card_name === 'string' && c.card_name)
    .map((c, i) => {
      const card = {
        card_name: c.card_name,
        qty:       Number.isFinite(c.qty) ? c.qty : 1,
        category:  typeof c.category === 'string' ? c.category : '',
        board:     (typeof c.board === 'string' && c.board.trim()) || MAIN_BOARD,
        position:  Number.isFinite(c.position) ? c.position : i,
      };
      // Last, and only where there is one — a card that is a name says nothing
      // about printings, exactly as it did before the column existed.
      const printing = readPrinting(c.printing);
      if (printing) card.printing = printing;
      return card;
    });
  const categories = (Array.isArray(raw?.categories) ? raw.categories : [])
    .filter(c => c && typeof c.name === 'string' && c.name)
    .map((c, i) => ({ name: c.name, position: Number.isFinite(c.position) ? c.position : i }));
  /* The same order readDeck() reads in, board included: two rows can now share
   * a name and a position, and a state that serialises two ways is a state
   * that looks changed when nothing has. */
  cards.sort((a, b) => a.position - b.position
    || a.card_name.localeCompare(b.card_name)
    || a.board.localeCompare(b.board));
  categories.sort((a, b) => a.position - b.position);
  return { cards, categories };
}

// ── Writing ───────────────────────────────────────────────────────────────

/* deck_id → when its most recent save was seen. Deliberately not persisted;
 * see the header. */
const lastSaveAt = new Map();

const newest = deckId => db.prepare(
  'SELECT id, taken_at, reason, state_json FROM deck_snapshots WHERE deck_id = ? ORDER BY taken_at DESC, id DESC LIMIT 1'
).get(deckId);

/** Both caps in one statement: everything past the newest MAX_PER_DECK rows,
 *  plus anything older than MAX_AGE_MS that is not one of the newest
 *  AGE_FLOOR. Applied to one deck on write, and to every deck at startup so
 *  the age cap is not something only an edited deck is subject to. */
function prune(deckId = null, now = Date.now()) {
  return db.prepare(`
    DELETE FROM deck_snapshots WHERE id IN (
      SELECT id FROM (
        SELECT id, taken_at,
               ROW_NUMBER() OVER (PARTITION BY deck_id ORDER BY taken_at DESC, id DESC) AS rn
          FROM deck_snapshots
         WHERE (? IS NULL OR deck_id = ?)
      )
      WHERE rn > ? OR (taken_at < ? AND rn > ?)
    )
  `).run(deckId, deckId, MAX_PER_DECK, now - MAX_AGE_MS, AGE_FLOOR).changes;
}

/** Record a state, unless the newest row already says the same thing.
 *
 *  A snapshot identical to the one before it is not history — it is a second
 *  copy of a state already kept, and it would draw a row in the panel with
 *  nothing under "what changed". When one turns up the reason is written onto
 *  the existing row instead of inserting beside it, because a forced reason
 *  says more than 'edit' does: the state is the same either way, and this is
 *  the difference between "you were editing" and "you were about to delete a
 *  category". The row keeps its original time — the state has not changed, so
 *  neither has when it started being true.
 *
 *  Returns the row, or null when nothing was recorded because the caller asked
 *  to snapshot a deck that has never had a card in it. */
function record(deckId, reason, state, now = Date.now()) {
  if (!REASONS.has(reason)) throw new Error(`unknown snapshot reason: ${reason}`);
  lastSaveAt.set(deckId, now);

  const last = newest(deckId);
  const json = stateKey(state);

  // Nothing has ever been in this deck and nothing is in it now: there is no
  // state here to lose, and a history that opens with a row of nothing is
  // noise on every deck's first edit.
  if (!last && !state.cards.length && !state.categories.length) return null;

  if (last && last.state_json === json) {
    if (last.reason !== reason && reason !== 'edit') {
      db.prepare('UPDATE deck_snapshots SET reason = ? WHERE id = ?').run(reason, last.id);
      return { id: last.id, taken_at: last.taken_at, reason };
    }
    return { id: last.id, taken_at: last.taken_at, reason: last.reason };
  }

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO deck_snapshots (deck_id, taken_at, reason, state_json) VALUES (?,?,?,?)'
  ).run(deckId, now, reason, json);
  prune(deckId, now);
  return { id: Number(lastInsertRowid), taken_at: now, reason };
}

/** Rule 2, called from the client immediately before the operation, carrying
 *  the state the browser is showing. */
function force(deckId, reason, rawState, now = Date.now()) {
  return record(deckId, reason, normaliseState(rawState), now);
}

/** Rule 1, called from the save path *before* it replaces anything. Writes the
 *  pre-burst state when this save opens a burst, and nothing at all when it is
 *  the fourth save of one — which is the common case, and costs two queries
 *  less than the first because the deck is never read. */
function noteSave(deckId, now = Date.now()) {
  const last = lastSaveAt.get(deckId) ?? -Infinity;
  lastSaveAt.set(deckId, now);
  if (now - last < BURST_IDLE_MS) return null;
  return record(deckId, 'edit', readDeck(deckId), now);
}

/** The deck is gone.
 *
 *  Its history goes with it — rows keyed by a deck id nothing will ever ask
 *  for again are the definition of orphaned, and fifty of them per deleted
 *  deck is a database that only grows. What is left behind is one row holding
 *  what the deck was at the moment it was deleted, which is what makes
 *  "delete deck" one of the operations rule 2 protects rather than the one
 *  operation it cannot. A deck imported from Archidekt keeps its id across a
 *  delete and a re-add (`arch_<id>`) — which the delete confirmation already
 *  invites — so re-adding it finds this row waiting in the History panel. It
 *  is subject to the age cap like anything else. */
function deckDeleted(deckId, rawState, now = Date.now()) {
  return db.transaction(() => {
    db.prepare('DELETE FROM deck_snapshots WHERE deck_id = ?').run(deckId);
    // record() marks the burst open on its way past, which is what stops the
    // wipe that follows this call from snapshotting the deck a second time.
    return record(deckId, 'deck-delete', normaliseState(rawState), now);
  })();
}

// ── Reading ───────────────────────────────────────────────────────────────

/** What one state has that another does not.
 *
 *  Computed on read rather than stored, because both sides are a few hundred
 *  short strings and the answer is only ever wanted for the panel that is
 *  open. `from` is the older state; the answer describes getting from it to
 *  `to`, so it reads as what happened next. */
function diff(from, to) {
  /* Keyed by board *and* name, because that is what a card in a deck is now:
   * one in the maybeboard and one in the deck are two cards with two
   * quantities, and a diff that took them for one would report a quantity
   * change where a card was set aside. A card that changes board therefore
   * reads as one leaving and one arriving, which is what it is — the board it
   * is on rides along on each entry so the panel can say which. */
  const key    = c => `${c.board || MAIN_BOARD}/${c.card_name}`;
  const before = new Map((from?.cards || []).map(c => [key(c), c]));
  const after  = new Map((to?.cards   || []).map(c => [key(c), c]));
  const added = [], removed = [], moved = [];
  let qty = 0;

  for (const [id, card] of after) {
    const board = card.board || MAIN_BOARD;
    const was = before.get(id);
    if (!was) { added.push({ name: card.card_name, qty: card.qty, board }); continue; }
    if ((was.qty || 1) !== (card.qty || 1)) qty++;
    if ((was.category || '') !== (card.category || '')) {
      moved.push({ name: card.card_name, from: was.category || '', to: card.category || '', board });
    }
  }
  for (const [id, card] of before) {
    if (!after.has(id)) removed.push({ name: card.card_name, qty: card.qty, board: card.board || MAIN_BOARD });
  }

  const catsBefore = new Set((from?.categories || []).map(c => c.name));
  const catsAfter  = new Set((to?.categories   || []).map(c => c.name));
  return {
    added, removed, moved, qty,
    categoriesAdded:   [...catsAfter].filter(n => !catsBefore.has(n)),
    categoriesRemoved: [...catsBefore].filter(n => !catsAfter.has(n)),
  };
}

/** How big a deck is, said the two ways the panel says it — and the mainboard
 *  only, because that is the deck. A row saying "104 cards" for a deck of 99
 *  and five maybes would be describing something nobody is building. What is
 *  in the other boards is still snapshotted and still restored; it is simply
 *  not what "how big" means. */
const sizeOf = state => {
  const cards = (state?.cards || []).filter(c => (c.board || MAIN_BOARD) === MAIN_BOARD);
  return {
    cards:    cards.reduce((n, c) => n + (c.qty || 1), 0),
    distinct: cards.length,
  };
};

/** The whole history of a deck, newest first, each row carrying what changed
 *  relative to the row below it — and, at the top, the deck as it is now.
 *
 *  The current state is in the list because otherwise the newest snapshot's
 *  diff is the only one in the panel with nothing to compare against, and it
 *  is the one the reader most wants a number for: it is what restoring the
 *  newest row would cost. It is not a snapshot and carries no id, so there is
 *  nothing to restore it to. */
function list(deckId) {
  const rows = db.prepare(
    'SELECT id, taken_at, reason, state_json FROM deck_snapshots WHERE deck_id = ? ORDER BY taken_at DESC, id DESC'
  ).all(deckId).map(r => ({ ...r, state: JSON.parse(r.state_json) }));

  const snapshots = rows.map((row, i) => ({
    id:       row.id,
    taken_at: row.taken_at,
    reason:   row.reason,
    ...sizeOf(row.state),
    // The row below this one in the panel is the state this one grew out of.
    // The oldest has nothing under it, and nothing to say about what changed.
    changes:  i + 1 < rows.length ? diff(rows[i + 1].state, row.state) : null,
  }));

  const current = readDeck(deckId);
  return {
    current: {
      ...sizeOf(current),
      changes: rows.length ? diff(rows[0].state, current) : null,
    },
    snapshots,
  };
}

/** One snapshot, whole, for restoring from. */
function get(deckId, id) {
  const row = db.prepare(
    'SELECT id, taken_at, reason, state_json FROM deck_snapshots WHERE deck_id = ? AND id = ?'
  ).get(deckId, id);
  if (!row) return null;
  return { id: row.id, taken_at: row.taken_at, reason: row.reason, ...JSON.parse(row.state_json) };
}

/** The age cap, applied to every deck rather than only the one being written
 *  to. Called once at startup: a deck nobody has opened in a year is exactly
 *  the deck whose rows would otherwise never be looked at again. */
function init() {
  const gone = prune();
  if (gone) console.log(`[deck-history] pruned ${gone} snapshot(s) past the cap`);
}

module.exports = {
  BURST_IDLE_MS, MAX_PER_DECK, MAX_AGE_MS, AGE_FLOOR, REASONS,
  init, noteSave, force, deckDeleted, list, get, prune,
  readDeck, normaliseState, diff,
  /* Tests reach for this to put a deck back in the state of never having been
   * saved; nothing else should. */
  _forget: deckId => lastSaveAt.delete(deckId),
};
