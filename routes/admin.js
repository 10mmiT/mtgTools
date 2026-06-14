'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const { db }  = require('../available-db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// createLinkedPlayer is injected via app.locals to avoid circular deps
function getCreateLinkedPlayer(req) {
  return req.app.locals.createLinkedPlayer;
}

// ── Account request approval (admin) ──────────────────────────────────────────
router.get('/account-requests', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, username, requested_at FROM account_requests ORDER BY requested_at').all());
});

router.post('/account-requests/:id/approve', requireAdmin, express.json(), (req, res) => {
  const pending = db.prepare('SELECT * FROM account_requests WHERE id = ?').get(req.params.id);
  if (!pending) return res.status(404).json({ error: 'Request not found' });
  if (db.prepare('SELECT username FROM users WHERE username = ?').get(pending.username))
    return res.status(409).json({ error: 'Username already exists' });
  const { role = 'player', playerId = null } = req.body || {};
  if (!['player', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const resolvedPlayer = playerId || getCreateLinkedPlayer(req)(pending.username);
  db.prepare('INSERT INTO users (username, password_hash, role, player_id) VALUES (?, ?, ?, ?)')
    .run(pending.username, pending.password_hash, role, resolvedPlayer);
  db.prepare('DELETE FROM account_requests WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.delete('/account-requests/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM account_requests WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── User CRUD ─────────────────────────────────────────────────────────────────
router.get('/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT username, role, player_id, created_at FROM users ORDER BY created_at').all());
});

router.post('/users', requireAdmin, express.json(), async (req, res) => {
  const { username, password, role = 'player', playerId = null } = req.body || {};
  if (!username?.trim() || !password?.trim()) return res.status(400).json({ error: 'Username and password required' });
  if (!['player', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const uname = username.trim().toLowerCase();
  if (db.prepare('SELECT username FROM users WHERE username = ?').get(uname))
    return res.status(409).json({ error: 'Username already taken' });
  const hash           = await bcrypt.hash(password.trim(), 10);
  const resolvedPlayer = playerId || getCreateLinkedPlayer(req)(uname);
  db.prepare('INSERT INTO users (username, password_hash, role, player_id) VALUES (?, ?, ?, ?)').run(
    uname, hash, role, resolvedPlayer
  );
  res.json({ ok: true });
});

router.patch('/users/:username', requireAdmin, express.json(), async (req, res) => {
  const uname = req.params.username.toLowerCase();
  const { password, role, playerId } = req.body || {};
  if (!db.prepare('SELECT username FROM users WHERE username = ?').get(uname))
    return res.status(404).json({ error: 'User not found' });
  if (password?.trim()) {
    const ph = await bcrypt.hash(password.trim(), 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(ph, uname);
  }
  if (role && ['player', 'admin'].includes(role))
    db.prepare('UPDATE users SET role = ? WHERE username = ?').run(role, uname);
  if ('playerId' in (req.body || {}))
    db.prepare('UPDATE users SET player_id = ? WHERE username = ?').run(playerId || null, uname);
  // Refresh live sessions in DB
  if (role && ['player', 'admin'].includes(role))
    db.prepare('UPDATE sessions SET role = ? WHERE username = ?').run(role, uname);
  if ('playerId' in (req.body || {}))
    db.prepare('UPDATE sessions SET player_id = ? WHERE username = ?').run(playerId || null, uname);
  res.json({ ok: true });
});

router.delete('/users/:username', requireAdmin, (req, res) => {
  const uname = req.params.username.toLowerCase();
  if (uname === 'admin') return res.status(400).json({ error: 'Cannot delete the admin account' });
  db.prepare('DELETE FROM users WHERE username = ?').run(uname);
  db.prepare('DELETE FROM sessions WHERE username = ?').run(uname);
  res.json({ ok: true });
});

module.exports = router;
