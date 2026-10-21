'use strict';
const express = require('express');
const { db, writePrinting, deckCardRow, isImageUrl } = require('../available-db');
const history = require('../deck-history');
const { requireAuth, requirePlayerAccess, getSession } = require('../middleware/auth');
const { deckVisibleTo, deckWritableBy, isBlank, readNumber } = require('./state');

const router = express.Router();

/* The read guard for a deck named by id. The reads below are requireAuth only,
 * so anyone logged in could otherwise pull a private deck's cards or history by
 * id. A non-owner asking after a private deck gets a 404 — its existence is
 * hidden, not confirmed with a 403. deckVisibleTo carries the open-mode no-op
 * (the guest session is admin) and the owner/admin rule, shared with the
 * /api/state filter. */
function requireDeckVisible(req, res, next) {
  if (deckVisibleTo(getSession(req), req.params.deckId)) return next();
  res.status(404).json({ error: 'Not found' });
}

/* The write guard, after requirePlayerAccess. That one only proves the URL's
 * :playerId is the requester; nothing tied the deck to that player, so
 * `PUT /players/<me>/decks/<your deck>/cards` replaced your deck, and a
 * `deck-delete` snapshot wiped its history. deckWritableBy (routes/state.js)
 * is the rule: an admin, or the deck is :playerId's — or nobody's yet. A deck
 * the requester could not even read is answered as the read guard answers it,
 * so a write is no way to learn a private deck exists. */
function requireDeckWrite(req, res, next) {
  const sess = getSession(req);
  if (deckWritableBy(sess, req.params.playerId, req.params.deckId)) return next();
  if (!deckVisibleTo(sess, req.params.deckId)) return res.status(404).json({ error: 'Not found' });
  res.status(403).json({ error: 'Forbidden' });
}

/* What a deck's rows may hold, checked on the way in. The numbers are numbers
 * (a string where a count goes is drawn into the tile as markup later), and a
 * chosen printing's picture is an http(s) image URL — refused rather than
 * dropped, so a client that sent one learns it did not take. Each returns the
 * reason, or null, and coerces a number written as a string in place. */
function numberFields(row, fields, what) {
  for (const f of fields) {
    if (isBlank(row[f])) { row[f] = undefined; continue; }
    const n = readNumber(row[f]);
    if (Number.isNaN(n)) return `${what} ${f} must be a number`;
    row[f] = n;
  }
  return null;
}
function textFields(row, fields, what) {
  for (const f of fields) {
    if (row[f] !== undefined && row[f] !== null && typeof row[f] !== 'string') return `${what} ${f} must be text`;
  }
  return null;
}
function printingProblem(value) {
  let raw = value;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return null; } }
  if (raw && typeof raw === 'object' && !isBlank(raw.image) && !isImageUrl(raw.image)) {
    return 'A printing\'s image must be an http(s) image URL';
  }
  return null;
}
function cardProblem(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'A card must be an object';
  if (typeof c.card_name !== 'string' || !c.card_name) return 'card_name required';
  return numberFields(c, ['qty', 'position'], 'A card\'s')
    || textFields(c, ['category', 'board'], 'A card\'s')
    || printingProblem(c.printing);
}
function categoryProblem(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'A category must be an object';
  if (typeof c.name !== 'string') return 'A category\'s name must be text';
  return numberFields(c, ['position'], 'A category\'s');
}
/* The first problem in a list of rows, or null; a list that is not one is
 * itself the problem. */
function listProblem(list, check, what) {
  if (!Array.isArray(list)) return `${what} must be a list`;
  for (const row of list) { const why = check(row); if (why) return why; }
  return null;
}

/* No Commander among them. The commander is a board — see DB_BOARDS in
 * public/js/deckview-boards.js — and a category of the same name would be a
 * second place for it to be. The client's DB_DEFAULT_CATS says the same list;
 * this one is what a deck that has never been opened in the tab comes back
 * with. */
const DEFAULT_CATEGORIES = [
  'Creatures', 'Planeswalkers', 'Instants', 'Sorceries',
  'Enchantments', 'Artifacts', 'Battles', 'Lands', 'Other',
];

/* Which board a row that does not name one is on. A card in a deck is in the
 * deck unless it says otherwise — that is what makes the column's arrival cost
 * no migration of anybody's data, and what a client written before boards
 * keeps meaning after them. The set of boards itself is the client's: nothing
 * here validates the value, so a board added later needs no change on this
 * side either. */
const MAIN_BOARD = 'main';
const boardOf = value => (typeof value === 'string' && value.trim()) || MAIN_BOARD;

// GET /api/players/:playerId/decks/:deckId/cards
router.get('/players/:playerId/decks/:deckId/cards', requireAuth, requireDeckVisible, (req, res) => {
  const { deckId } = req.params;
  const cards = db.prepare(
    'SELECT card_name, qty, category, board, position, printing FROM deck_cards WHERE deck_id = ? ORDER BY position, card_name'
  /* deckCardRow is where the printing column stops being text and becomes the
   * field the mat, the price and the export read — the same shaping a snapshot
   * of the deck goes through, so a restore hands the tab exactly what a load
   * does. */
  ).all(deckId).map(deckCardRow);
  let categories = db.prepare(
    'SELECT name, position FROM deck_categories WHERE deck_id = ? ORDER BY position'
  ).all(deckId);
  if (!categories.length) {
    categories = DEFAULT_CATEGORIES.map((name, i) => ({ name, position: i }));
  }
  res.json({ cards, categories });
});

// PUT /api/players/:playerId/decks/:deckId/cards — full replace
router.put('/players/:playerId/decks/:deckId/cards', requirePlayerAccess, requireDeckWrite,
  express.json({ limit: '2mb' }), (req, res) => {
  const { deckId } = req.params;
  const { cards = [], categories = [] } = req.body || {};
  const bad = listProblem(cards, cardProblem, 'cards') || listProblem(categories, categoryProblem, 'categories');
  if (bad) return res.status(400).json({ error: bad });

  // Before the replace, not inside it: what this save is about to overwrite is
  // the only copy of the state it overwrites. Most saves write nothing here —
  // see the burst rule in deck-history.js.
  try { history.noteSave(deckId); }
  catch (e) { console.error('[deck-history] snapshot failed:', e.message); }

  const save = db.transaction(() => {
    db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(deckId);
    db.prepare('DELETE FROM deck_categories WHERE deck_id = ?').run(deckId);
    const insCard = db.prepare(
      'INSERT INTO deck_cards (deck_id, card_name, qty, category, board, position, printing) VALUES (?,?,?,?,?,?,?)'
    );
    /* The printing comes through here and nowhere else: this is the save the
     * tab makes after every edit, so a printing chosen in the gallery rides
     * home on the deck's ordinary debounced save rather than on a request of
     * its own. writePrinting is what decides that a card carries one. */
    cards.forEach((c, i) => insCard.run(
      deckId, c.card_name, c.qty ?? 1, c.category ?? '', boardOf(c.board), c.position ?? i,
      writePrinting(c.printing)));
    const insCat = db.prepare(
      'INSERT INTO deck_categories (deck_id, name, position) VALUES (?,?,?)'
    );
    categories.forEach((c, i) => insCat.run(deckId, c.name, c.position ?? i));
  });

  try { save(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/players/:playerId/decks/:deckId/cards/add
router.post('/players/:playerId/decks/:deckId/cards/add', requirePlayerAccess, requireDeckWrite,
  express.json(), (req, res) => {
  const { deckId } = req.params;
  const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  if (typeof body.card_name !== 'string' || !body.card_name.trim()) {
    return res.status(400).json({ error: 'card_name required' });
  }
  const bad = numberFields(body, ['qty'], 'A card\'s') || textFields(body, ['category', 'board'], 'A card\'s');
  if (bad) return res.status(400).json({ error: bad });
  const { card_name, qty = 1, category = '', board } = body;
  const name = card_name.trim();
  const onBoard = boardOf(board);

  try {
    /* Keyed by the board as well as the name: adding a card to the maybeboard
     * while one sits in the deck is a second row, not a copy more of the
     * first. */
    const existing = db.prepare(
      'SELECT qty FROM deck_cards WHERE deck_id = ? AND board = ? AND card_name = ?'
    ).get(deckId, onBoard, name);
    if (existing) {
      db.prepare(
        'UPDATE deck_cards SET qty = qty + ? WHERE deck_id = ? AND board = ? AND card_name = ?'
      ).run(qty, deckId, onBoard, name);
    } else {
      const maxPos = db.prepare(
        'SELECT COALESCE(MAX(position), -1) AS m FROM deck_cards WHERE deck_id = ?'
      ).get(deckId)?.m ?? -1;
      db.prepare(
        'INSERT INTO deck_cards (deck_id, card_name, qty, category, board, position) VALUES (?,?,?,?,?,?)'
      ).run(deckId, name, qty, category, onBoard, maxPos + 1);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/players/:playerId/decks/:deckId/cards/:cardName?board=maybe
 *
 * One board's copy of the card, not every board's: removing a card from the
 * maybeboard must not take the one in the deck with it. Which board is a query
 * parameter and defaults to the mainboard, so a caller that has never heard of
 * boards goes on removing from the deck. */
router.delete('/players/:playerId/decks/:deckId/cards/:cardName', requirePlayerAccess, requireDeckWrite, (req, res) => {
  const { deckId, cardName } = req.params;
  db.prepare('DELETE FROM deck_cards WHERE deck_id = ? AND board = ? AND card_name = ?')
    .run(deckId, boardOf(req.query.board), decodeURIComponent(cardName));
  res.json({ ok: true });
});

// PATCH /api/players/:playerId/decks/:deckId/cards/:cardName
router.patch('/players/:playerId/decks/:deckId/cards/:cardName', requirePlayerAccess, requireDeckWrite,
  express.json(), (req, res) => {
  const { deckId, cardName } = req.params;
  const name    = decodeURIComponent(cardName);
  const body    = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  const bad     = (body.qty !== undefined && numberFields(body, ['qty'], 'A card\'s'))
    || textFields(body, ['category', 'board'], 'A card\'s');
  if (bad) return res.status(400).json({ error: bad });
  const { qty, category, board } = body;
  const sets = []; const params = [];
  if (qty      !== undefined) { sets.push('qty = ?');      params.push(qty); }
  if (category !== undefined) { sets.push('category = ?'); params.push(category); }
  /* Which row is being patched, and which board it is being moved to, are two
   * different questions with the same answer's shape: `board` in the body is
   * where the card is going, and the row it comes from is named by
   * ?board= — the mainboard when nobody says otherwise. */
  if (board    !== undefined) { sets.push('board = ?');    params.push(boardOf(board)); }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(deckId, boardOf(req.query.board), name);
  try {
    db.prepare(`UPDATE deck_cards SET ${sets.join(', ')} WHERE deck_id = ? AND board = ? AND card_name = ?`)
      .run(...params);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/players/:playerId/decks/:deckId/categories
router.put('/players/:playerId/decks/:deckId/categories', requirePlayerAccess, requireDeckWrite,
  express.json(), (req, res) => {
  const { deckId } = req.params;
  const { categories = [] } = req.body || {};
  const bad = listProblem(categories, categoryProblem, 'categories');
  if (bad) return res.status(400).json({ error: bad });
  const save = db.transaction(() => {
    db.prepare('DELETE FROM deck_categories WHERE deck_id = ?').run(deckId);
    const ins = db.prepare(
      'INSERT INTO deck_categories (deck_id, name, position) VALUES (?,?,?)'
    );
    categories.forEach((c, i) => ins.run(deckId, c.name, c.position ?? i));
  });
  try { save(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── History ───────────────────────────────────────────────────────────────
// What the deck used to be, and putting it back. The rules about when a
// snapshot is written live in deck-history.js; these are four ways in.

// GET /api/players/:playerId/decks/:deckId/snapshots — the list, with diffs
router.get('/players/:playerId/decks/:deckId/snapshots', requireAuth, requireDeckVisible, (req, res) => {
  res.json(history.list(req.params.deckId));
});

// GET /api/players/:playerId/decks/:deckId/snapshots/:id — one, whole
router.get('/players/:playerId/decks/:deckId/snapshots/:id', requireAuth, requireDeckVisible, (req, res) => {
  const snap = history.get(req.params.deckId, Number(req.params.id));
  if (!snap) return res.status(404).json({ error: 'No such snapshot' });
  res.json(snap);
});

/* POST /api/players/:playerId/decks/:deckId/snapshots — a forced snapshot.
 *
 * The state comes from the client rather than being read back here, because
 * this is called in front of an operation at a moment when the browser holds
 * the truth: the autosave is on an 800 ms debounce, so the stored rows can be
 * most of a second behind what the person is looking at, and the state worth
 * keeping is the one they can see. deck-history.js cuts what arrives down to
 * the shape a deck row has. */
router.post('/players/:playerId/decks/:deckId/snapshots', requirePlayerAccess, requireDeckWrite,
  express.json({ limit: '2mb' }), (req, res) => {
  const { reason, cards, categories } = req.body || {};
  if (!history.REASONS.has(reason)) return res.status(400).json({ error: 'Unknown reason' });
  // deck-history.js cuts the rest down to a row's shape; the picture is the
  // one field it would carry into markup, so it is refused here as on a save.
  const bad = Array.isArray(cards) && cards.map(c => printingProblem(c?.printing)).find(Boolean);
  if (bad) return res.status(400).json({ error: bad });
  try {
    const snapshot = reason === 'deck-delete'
      ? history.deckDeleted(req.params.deckId, { cards, categories })
      : history.force(req.params.deckId, reason, { cards, categories });
    res.json({ ok: true, snapshot });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
