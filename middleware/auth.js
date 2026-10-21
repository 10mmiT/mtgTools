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
}, 3_600_000).unref();

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
      // A cookie that is not valid percent-encoding is nobody's session. Left
      // to throw, it failed every API request the browser made with a 500.
      let token;
      try { token = decodeURIComponent(v.join('=')); } catch { return null; }
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

// A password change signs the account out everywhere but the browser that
// made it. `keepToken` may be absent (or belong to someone else, when an
// admin resets another user's password), and then every session goes.
function deleteOtherSessions(username, keepToken) {
  db.prepare('DELETE FROM sessions WHERE username = ? AND token_hash != ?')
    .run(username, keepToken ? hashToken(keepToken) : '');
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
  createSession, getSession, deleteSession, deleteOtherSessions,
  requireAuth, requireAdmin, requirePlayerAccess,
};
