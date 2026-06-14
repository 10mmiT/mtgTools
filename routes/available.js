'use strict';
const express = require('express');
const { db, DEFAULT_CAL_ID } = require('../available-db');
const { getSession, requireAuth } = require('../middleware/auth');
const { readState } = require('./state');

const router = express.Router();

function today() { return new Date().toISOString().slice(0, 10); }

// Initial cleanup of stale availability rows
db.prepare('DELETE FROM availability WHERE date < ?').run(today());
// Daily sweep
setInterval(() => db.prepare('DELETE FROM availability WHERE date < ?').run(today()), 86400000).unref();

router.get('/api/default', requireAuth, (req, res) => res.json({ id: DEFAULT_CAL_ID }));

router.get('/api/calendars/:id', requireAuth, (req, res) => {
  const calendar = db.prepare('SELECT id, name, description, created_at FROM calendars WHERE id = ?').get(req.params.id);
  if (!calendar) return res.status(404).json({ error: 'Calendar not found' });
  const availability = db.prepare(
    'SELECT person_name, date FROM availability WHERE calendar_id = ? AND date >= ? ORDER BY date, person_name'
  ).all(req.params.id, today());
  res.json({ ...calendar, availability });
});

router.post('/api/calendars/:id/toggle', requireAuth, express.json(), (req, res) => {
  const sess = getSession(req);
  const { person_name, date } = req.body;
  if (!person_name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!date || date < today()) return res.status(400).json({ error: 'Invalid date' });

  if (sess && sess.role !== 'admin') {
    const appState    = readState();
    const linked      = sess.playerId ? appState.players.find(p => p.id === sess.playerId) : null;
    const allowedName = linked?.name || sess.username;
    if (person_name.trim() !== allowedName)
      return res.status(403).json({ error: `You can only toggle availability for "${allowedName}"` });
  }

  const name     = person_name.trim();
  const existing = db.prepare('SELECT id FROM availability WHERE calendar_id = ? AND person_name = ? AND date = ?')
    .get(req.params.id, name, date);
  if (existing) {
    db.prepare('DELETE FROM availability WHERE calendar_id = ? AND person_name = ? AND date = ?')
      .run(req.params.id, name, date);
    res.json({ available: false });
  } else {
    db.prepare('INSERT INTO availability (calendar_id, person_name, date) VALUES (?, ?, ?)')
      .run(req.params.id, name, date);
    res.json({ available: true });
  }
});

router.delete('/api/calendars/:id/persons/:name', requireAuth, (req, res) => {
  const sess = getSession(req);
  const name = decodeURIComponent(req.params.name);
  if (sess && sess.role !== 'admin') {
    const appState    = readState();
    const linked      = sess.playerId ? appState.players.find(p => p.id === sess.playerId) : null;
    const allowedName = linked?.name || sess.username;
    if (name !== allowedName) return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM availability WHERE calendar_id = ? AND person_name = ?').run(req.params.id, name);
  res.json({ ok: true });
});

module.exports = router;
