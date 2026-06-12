'use strict';
const { randomBytes, createHash } = require('crypto');
const { db } = require('../available-db');

const OPEN_MODE      = !(process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD || '');
const SESSION_COOKIE = 'mtg_session';
const SESSION_TTL    = 30 * 24 * 60 * 60 * 1000;

function generateToken()  { return randomBytes(32).toString('hex'); }
function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }

// Periodic sweep: delete expired sessions (runs every hour)
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}, 3_600_000);

function createSession(username, role, playerId) {
  const token     = generateToken();
  const expiresAt = Date.now() + SESSION_TTL;
  db.prepare(
    'INSERT OR REPLACE INTO sessions (token_hash, username, role, player_id, expires_at) VALUES (?,?,?,?,?)'
  ).run(hashToken(token), username, role, playerId || null, expiresAt);
  return token;
}

function getSession(req) {
  if (OPEN_MODE) return { username: 'guest', role: 'admin', playerId: null };
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k.trim() === SESSION_COOKIE) {
      const token = decodeURIComponent(v.join('='));
      const row   = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));
      if (!row) return null;
      if (row.expires_at <= Date.now()) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
        return null;
      }
      return { username: row.username, role: row.role, playerId: row.player_id, _token: token };
    }
  }
  return null;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function requireAuth(req, res, next) {
  if (getSession(req)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  const sess = getSession(req);
  if (sess?.role === 'admin') return next();
  res.status(403).json({ error: 'Admin required' });
}

function requirePlayerAccess(req, res, next) {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  if (sess.role === 'admin') return next();
  if (sess.playerId === req.params.playerId) return next();
  res.status(403).json({ error: 'Forbidden' });
}

module.exports = {
  OPEN_MODE, SESSION_COOKIE, SESSION_TTL,
  createSession, getSession, deleteSession,
  requireAuth, requireAdmin, requirePlayerAccess,
};
