'use strict';
const express = require('express');
const { db }  = require('../available-db');
const { requireAuth, requirePlayerAccess } = require('../middleware/auth');

const router = express.Router();

const DEFAULT_CATEGORIES = [
  'Commander', 'Creatures', 'Planeswalkers', 'Instants', 'Sorceries',
  'Enchantments', 'Artifacts', 'Battles', 'Lands', 'Other',
];

// GET /api/players/:playerId/decks/:deckId/cards
router.get('/players/:playerId/decks/:deckId/cards', requireAuth, (req, res) => {
  const { deckId } = req.params;
  const cards = db.prepare(
    'SELECT card_name, qty, category, position FROM deck_cards WHERE deck_id = ? ORDER BY position, card_name'
  ).all(deckId);
  let categories = db.prepare(
    'SELECT name, position FROM deck_categories WHERE deck_id = ? ORDER BY position'
  ).all(deckId);
  if (!categories.length) {
    categories = DEFAULT_CATEGORIES.map((name, i) => ({ name, position: i }));
  }
  res.json({ cards, categories });
});

// PUT /api/players/:playerId/decks/:deckId/cards — full replace
router.put('/players/:playerId/decks/:deckId/cards', requirePlayerAccess,
  express.json({ limit: '2mb' }), (req, res) => {
  const { deckId } = req.params;
  const { cards = [], categories = [] } = req.body;

  const save = db.transaction(() => {
    db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(deckId);
    db.prepare('DELETE FROM deck_categories WHERE deck_id = ?').run(deckId);
    const insCard = db.prepare(
      'INSERT INTO deck_cards (deck_id, card_name, qty, category, position) VALUES (?,?,?,?,?)'
    );
    cards.forEach((c, i) => insCard.run(deckId, c.card_name, c.qty ?? 1, c.category ?? '', c.position ?? i));
    const insCat = db.prepare(
      'INSERT INTO deck_categories (deck_id, name, position) VALUES (?,?,?)'
    );
    categories.forEach((c, i) => insCat.run(deckId, c.name, c.position ?? i));
  });

  try { save(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/players/:playerId/decks/:deckId/cards/add
router.post('/players/:playerId/decks/:deckId/cards/add', requirePlayerAccess,
  express.json(), (req, res) => {
  const { deckId } = req.params;
  const { card_name, qty = 1, category = '' } = req.body || {};
  if (!card_name?.trim()) return res.status(400).json({ error: 'card_name required' });
  const name = card_name.trim();

  try {
    const existing = db.prepare(
      'SELECT qty FROM deck_cards WHERE deck_id = ? AND card_name = ?'
    ).get(deckId, name);
    if (existing) {
      db.prepare(
        'UPDATE deck_cards SET qty = qty + ? WHERE deck_id = ? AND card_name = ?'
      ).run(qty, deckId, name);
    } else {
      const maxPos = db.prepare(
        'SELECT COALESCE(MAX(position), -1) AS m FROM deck_cards WHERE deck_id = ?'
      ).get(deckId)?.m ?? -1;
      db.prepare(
        'INSERT INTO deck_cards (deck_id, card_name, qty, category, position) VALUES (?,?,?,?,?)'
      ).run(deckId, name, qty, category, maxPos + 1);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/players/:playerId/decks/:deckId/cards/:cardName
router.delete('/players/:playerId/decks/:deckId/cards/:cardName', requirePlayerAccess, (req, res) => {
  const { deckId, cardName } = req.params;
  db.prepare('DELETE FROM deck_cards WHERE deck_id = ? AND card_name = ?')
    .run(deckId, decodeURIComponent(cardName));
  res.json({ ok: true });
});

// PATCH /api/players/:playerId/decks/:deckId/cards/:cardName
router.patch('/players/:playerId/decks/:deckId/cards/:cardName', requirePlayerAccess,
  express.json(), (req, res) => {
  const { deckId, cardName } = req.params;
  const name    = decodeURIComponent(cardName);
  const { qty, category } = req.body || {};
  const sets = []; const params = [];
  if (qty      !== undefined) { sets.push('qty = ?');      params.push(qty); }
  if (category !== undefined) { sets.push('category = ?'); params.push(category); }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(deckId, name);
  try {
    db.prepare(`UPDATE deck_cards SET ${sets.join(', ')} WHERE deck_id = ? AND card_name = ?`)
      .run(...params);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/players/:playerId/decks/:deckId/categories
router.put('/players/:playerId/decks/:deckId/categories', requirePlayerAccess,
  express.json(), (req, res) => {
  const { deckId } = req.params;
  const { categories = [] } = req.body || {};
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

module.exports = router;
