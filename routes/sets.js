'use strict';
// ── Set Browser data ──────────────────────────────────────────────────────────
// One request answers the whole set picker: which sets to show, how big each
// one is, and how many of its cards are owned. The client used to fetch
// Scryfall's set list itself and filter it in the browser; ownership had no
// answer at all, because the browser knows card names and nothing about which
// set they came from (see set-index.js).
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { db }      = require('../available-db');
const setIndex    = require('../set-index');

const router = express.Router();

/* Every distinct card name across every loaded collection. Ownership on this
 * tab has always been "somebody has a card of this name" rather than
 * per-person — the tab's badges say who — so the names are unioned. */
function ownedNames() {
  const names = new Set();
  for (const row of db.prepare('SELECT cards_json FROM collections').all()) {
    let cards;
    try { cards = JSON.parse(row.cards_json); } catch { continue; }
    for (const name of Object.keys(cards || {})) names.add(name);
  }
  return [...names];
}

// GET /api/sets → { sets: [{ code, name, released, cards, owned, indexed }], index }
router.get('/sets', requireAuth, (req, res) => {
  try {
    res.json({ sets: setIndex.list(ownedNames()), index: setIndex.status() });
  } catch (e) {
    console.error(`[sets] ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
