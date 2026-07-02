'use strict';
// ── Local card data endpoints ─────────────────────────────────────────────────
// Served from the Scryfall bulk-data cache (scryfall-db.js) so the client
// doesn't hit api.scryfall.com for every image/metadata/autocomplete lookup.
// Responses mimic Scryfall's shapes; the client falls back to live Scryfall
// when these return 503 (bulk data not downloaded yet) or miss names.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const scrydb  = require('../scryfall-db');

const router = express.Router();
router.use(express.json({ limit: '256kb' }));

// POST /api/cards/collection  { names: ["Sol Ring", …] }
// → { object:'list', data:[card…], not_found:[name…] }   (max 500 names)
router.post('/cards/collection', requireAuth, (req, res) => {
  if (!scrydb.isReady()) return res.status(503).json({ error: 'Card database not ready yet' });
  const names = req.body?.names;
  if (!Array.isArray(names)) return res.status(400).json({ error: 'Expected { names: [...] }' });
  const result = scrydb.getCollection(names.slice(0, 500));
  res.json({ object: 'list', data: result.data, not_found: result.not_found });
});

// GET /api/cards/autocomplete?q=sol+ri[&commander=1]
// → { object:'catalog', data:[name…] }
router.get('/cards/autocomplete', requireAuth, (req, res) => {
  if (!scrydb.isReady()) return res.status(503).json({ error: 'Card database not ready yet' });
  const q = String(req.query.q || '');
  const commander = req.query.commander === '1';
  res.json({ object: 'catalog', data: scrydb.autocomplete(q, { commander }) });
});

// GET /api/cards/status — small diagnostics endpoint
router.get('/cards/status', requireAuth, (req, res) => {
  res.json({ ready: scrydb.isReady(), cards: scrydb.cardCount() });
});

module.exports = router;
