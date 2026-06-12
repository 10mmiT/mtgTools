'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db }  = require('../available-db');
const {
  OPEN_MODE, SESSION_COOKIE,
  createSession, getSession, deleteSession,
  requireAuth, requireAdmin,
} = require('../middleware/auth');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// ── Login ──────────────────────────────────────────────────────────────────────
router.post('/login', authLimiter, express.json(), async (req, res) => {
  if (OPEN_MODE) return res.json({ ok: true, user: { username: 'guest', role: 'admin', playerId: null } });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user  = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  const valid = user && await bcrypt.compare(password.trim(), user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid username or password' });
  const token  = createSession(user.username, user.role, user.player_id);
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${30 * 24 * 3600}${secure}`);
  res.json({ ok: true, user: { username: user.username, role: user.role, playerId: user.player_id } });
});

// ── Logout ─────────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k.trim() === SESSION_COOKIE) deleteSession(decodeURIComponent(v.join('=')));
  }
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

// ── Me ────────────────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ username: sess.username, role: sess.role, playerId: sess.playerId });
});

// ── Change password ────────────────────────────────────────────────────────────
router.post('/change-password', requireAuth, express.json(), async (req, res) => {
  if (OPEN_MODE) return res.status(400).json({ error: 'Not applicable in open mode' });
  const sess = getSession(req);
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword?.trim())
    return res.status(400).json({ error: 'Current and new password required' });
  if (newPassword.trim().length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const user  = db.prepare('SELECT * FROM users WHERE username = ?').get(sess.username);
  const valid = user && await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  const newHash = await bcrypt.hash(newPassword.trim(), 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(newHash, sess.username);
  res.json({ ok: true });
});

// ── Account requests ───────────────────────────────────────────────────────────
router.post('/request-account', authLimiter, express.json(), async (req, res) => {
  if (OPEN_MODE) return res.status(400).json({ error: 'Not applicable in open mode' });
  const { username, password } = req.body || {};
  if (!username?.trim() || !password?.trim())
    return res.status(400).json({ error: 'Username and password required' });
  const uname = username.trim().toLowerCase();
  if (uname.length < 2 || uname.length > 30)
    return res.status(400).json({ error: 'Username must be 2–30 characters' });
  if (/\s/.test(uname))
    return res.status(400).json({ error: 'Username cannot contain spaces' });
  if (password.trim().length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT username FROM users WHERE username = ?').get(uname))
    return res.status(409).json({ error: 'Username already taken' });
  if (db.prepare('SELECT id FROM account_requests WHERE username = ?').get(uname))
    return res.status(409).json({ error: 'A request for this username is already pending' });
  const hash = await bcrypt.hash(password.trim(), 10);
  db.prepare('INSERT INTO account_requests (username, password_hash) VALUES (?, ?)').run(uname, hash);
  res.json({ ok: true });
});

// ── Legacy compat ─────────────────────────────────────────────────────────────
router.get('/status', (req, res) =>
  res.json({ protected: !OPEN_MODE, authenticated: !!getSession(req) }));

module.exports = router;
