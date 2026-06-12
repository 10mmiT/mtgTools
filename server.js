'use strict';
const express    = require('express');
const https      = require('https');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcryptjs');
const { randomBytes, createHash } = require('crypto');
const { v4: uuidv4 } = require('uuid');

const DATA_FILE      = process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD || '';
const OPEN_MODE      = !ADMIN_PASSWORD; // no auth if no password configured
const RSS_FEEDS      = (process.env.RSS_FEEDS || '').split(',').map(s => s.trim()).filter(Boolean);

const { db, DEFAULT_CAL_ID } = require('./available-db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Sessions (SQLite-backed; 30-day cookie) ───────────────────────────────
const SESSION_COOKIE = 'mtg_session';
const SESSION_TTL    = 30 * 24 * 60 * 60 * 1000;

function generateToken() { return randomBytes(32).toString('hex'); }
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

// ── Bootstrap admin account from env var ─────────────────────────────────────
if (ADMIN_PASSWORD) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  // Preserve existing player_id linkage when updating password
  db.prepare(`
    INSERT INTO users (username, password_hash, role, player_id) VALUES ('admin', ?, 'admin', NULL)
    ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin'
  `).run(hash);
  console.log('Admin account configured from ADMIN_PASSWORD');
}

// ── State helpers (SQLite-backed) ─────────────────────────────────────────────
function readState() {
  try {
    const row = db.prepare('SELECT value_json FROM app_state WHERE key = ?').get('state');
    if (!row) return { players: [] };
    return JSON.parse(row.value_json);
  } catch { return { players: [] }; }
}

function writeState(data) {
  const { players = [] } = data;
  db.prepare(`
    INSERT INTO app_state (key, value_json) VALUES ('state', ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
  `).run(JSON.stringify({ players }));
}

// ── Login page — always public ────────────────────────────────────────────────
app.get('/login',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ── Auth endpoints — no session required ──────────────────────────────────────
app.post('/api/auth/login', express.json(), (req, res) => {
  if (OPEN_MODE) return res.json({ ok: true, user: { username: 'guest', role: 'admin', playerId: null } });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password.trim(), user.password_hash))
    return res.status(401).json({ error: 'Invalid username or password' });
  const token = createSession(user.username, user.role, user.player_id);
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${30 * 24 * 3600}${secure}`);
  res.json({ ok: true, user: { username: user.username, role: user.role, playerId: user.player_id } });
});

app.post('/api/auth/logout', (req, res) => {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k.trim() === SESSION_COOKIE) deleteSession(decodeURIComponent(v.join('=')));
  }
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ username: sess.username, role: sess.role, playerId: sess.playerId });
});

app.post('/api/auth/change-password', requireAuth, express.json(), (req, res) => {
  if (OPEN_MODE) return res.status(400).json({ error: 'Not applicable in open mode' });
  const sess = getSession(req);
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword?.trim())
    return res.status(400).json({ error: 'Current and new password required' });
  if (newPassword.trim().length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(sess.username);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(401).json({ error: 'Current password is incorrect' });
  db.prepare('UPDATE users SET password_hash = ? WHERE username = ?')
    .run(bcrypt.hashSync(newPassword.trim(), 10), sess.username);
  res.json({ ok: true });
});

// ── Account requests (public — no auth needed) ───────────────────────────────
app.post('/api/auth/request-account', express.json(), (req, res) => {
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
  const hash = bcrypt.hashSync(password.trim(), 10);
  db.prepare('INSERT INTO account_requests (username, password_hash) VALUES (?, ?)').run(uname, hash);
  res.json({ ok: true });
});

app.get('/api/admin/account-requests', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, username, requested_at FROM account_requests ORDER BY requested_at').all());
});

app.post('/api/admin/account-requests/:id/approve', requireAdmin, express.json(), (req, res) => {
  const pending = db.prepare('SELECT * FROM account_requests WHERE id = ?').get(req.params.id);
  if (!pending) return res.status(404).json({ error: 'Request not found' });
  if (db.prepare('SELECT username FROM users WHERE username = ?').get(pending.username))
    return res.status(409).json({ error: 'Username already exists' });
  const { role = 'player', playerId = null } = req.body || {};
  if (!['player', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const resolvedPlayer = playerId || createLinkedPlayer(pending.username);
  db.prepare('INSERT INTO users (username, password_hash, role, player_id) VALUES (?, ?, ?, ?)')
    .run(pending.username, pending.password_hash, role, resolvedPlayer);
  db.prepare('DELETE FROM account_requests WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/account-requests/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM account_requests WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Legacy compat
app.get('/api/auth-status', (req, res) =>
  res.json({ protected: !OPEN_MODE, authenticated: !!getSession(req) }));

// ── Global auth guard ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (OPEN_MODE) return next();
  const sess = getSession(req);
  if (req.path.startsWith('/api/') || req.path.startsWith('/available/api/')) {
    if (!sess) return res.status(401).json({ error: 'Unauthorized' });
    return next();
  }
  if (!sess) return res.redirect('/login');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Auto-create a linked player when making a new account ────────────────────
const PLAYER_COLORS = ['#f97316','#06b6d4','#84cc16','#e879f9','#fb7185','#34d399','#fbbf24','#60a5fa'];

function createLinkedPlayer(username) {
  const appState = readState();
  const players  = appState.players || [];
  const playerId = uuidv4();
  const name     = username.charAt(0).toUpperCase() + username.slice(1);
  players.push({ id: playerId, name, color: PLAYER_COLORS[players.length % PLAYER_COLORS.length], wantList: [], decks: [] });
  appState.players = players;
  writeState(appState);
  return playerId;
}

// ── Admin: user management ────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT username, role, player_id, created_at FROM users ORDER BY created_at').all());
});

app.post('/api/admin/users', requireAdmin, express.json(), (req, res) => {
  const { username, password, role = 'player', playerId = null } = req.body || {};
  if (!username?.trim() || !password?.trim()) return res.status(400).json({ error: 'Username and password required' });
  if (!['player', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const uname = username.trim().toLowerCase();
  if (db.prepare('SELECT username FROM users WHERE username = ?').get(uname))
    return res.status(409).json({ error: 'Username already taken' });
  const hash           = bcrypt.hashSync(password.trim(), 10);
  const resolvedPlayer = playerId || createLinkedPlayer(uname);
  db.prepare('INSERT INTO users (username, password_hash, role, player_id) VALUES (?, ?, ?, ?)').run(
    uname, hash, role, resolvedPlayer
  );
  res.json({ ok: true });
});

app.patch('/api/admin/users/:username', requireAdmin, express.json(), (req, res) => {
  const uname = req.params.username.toLowerCase();
  const { password, role, playerId } = req.body || {};
  if (!db.prepare('SELECT username FROM users WHERE username = ?').get(uname))
    return res.status(404).json({ error: 'User not found' });
  if (password?.trim())
    db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(bcrypt.hashSync(password.trim(), 10), uname);
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

app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const uname = req.params.username.toLowerCase();
  if (uname === 'admin') return res.status(400).json({ error: 'Cannot delete the admin account' });
  db.prepare('DELETE FROM users WHERE username = ?').run(uname);
  db.prepare('DELETE FROM sessions WHERE username = ?').run(uname);
  res.json({ ok: true });
});

// ── Want list endpoints ───────────────────────────────────────────────────────
app.post('/api/players/:playerId/wants', requirePlayerAccess, express.json(), (req, res) => {
  const { cardName } = req.body || {};
  if (!cardName?.trim()) return res.status(400).json({ error: 'cardName required' });
  const appState = readState();
  const player   = appState.players.find(p => p.id === req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  if (!player.wantList) player.wantList = [];
  const name = cardName.trim();
  if (!player.wantList.includes(name)) { player.wantList.push(name); writeState(appState); }
  res.json({ ok: true });
});

app.delete('/api/players/:playerId/wants/:cardName', requirePlayerAccess, (req, res) => {
  const name     = decodeURIComponent(req.params.cardName);
  const appState = readState();
  const player   = appState.players.find(p => p.id === req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  player.wantList = (player.wantList || []).filter(c => c !== name);
  writeState(appState);
  res.json({ ok: true });
});

// ── Available@ API ────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }
db.prepare('DELETE FROM availability WHERE date < ?').run(today());
setInterval(() => db.prepare('DELETE FROM availability WHERE date < ?').run(today()), 86400000);

app.get('/available/api/default', requireAuth, (req, res) => res.json({ id: DEFAULT_CAL_ID }));

app.get('/available/api/calendars/:id', requireAuth, (req, res) => {
  const calendar = db.prepare('SELECT id, name, description, created_at FROM calendars WHERE id = ?').get(req.params.id);
  if (!calendar) return res.status(404).json({ error: 'Calendar not found' });
  const availability = db.prepare(
    'SELECT person_name, date FROM availability WHERE calendar_id = ? AND date >= ? ORDER BY date, person_name'
  ).all(req.params.id, today());
  res.json({ ...calendar, availability });
});

app.post('/available/api/calendars/:id/toggle', requireAuth, express.json(), (req, res) => {
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
  const existing = db.prepare('SELECT id FROM availability WHERE calendar_id = ? AND person_name = ? AND date = ?').get(req.params.id, name, date);
  if (existing) {
    db.prepare('DELETE FROM availability WHERE calendar_id = ? AND person_name = ? AND date = ?').run(req.params.id, name, date);
    res.json({ available: false });
  } else {
    db.prepare('INSERT INTO availability (calendar_id, person_name, date) VALUES (?, ?, ?)').run(req.params.id, name, date);
    res.json({ available: true });
  }
});

app.delete('/available/api/calendars/:id/persons/:name', requireAuth, (req, res) => {
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

// ── One-time migration: move collections from state.json → SQLite ─────────────
(function migrateCollections() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM collections').get().n;
  if (count > 0) return;
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw  = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const cols = Array.isArray(raw) ? raw : (raw.collections || []);
    if (!cols.length) return;
    const insert = db.prepare(`
      INSERT OR IGNORE INTO collections (key, name, source, col_id, color, cards_json, entries, total, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of cols) {
      insert.run(c.key, c.name, c.source, c.id || null, c.color || '#a855f7',
        JSON.stringify(c.cards || {}), c.entries || 0, c.total || null, c.savedAt || null);
    }
    console.log(`Migrated ${cols.length} collection(s) from state.json to SQLite`);
  } catch (e) { console.warn('Collection migration skipped:', e.message); }
})();

// ── One-time migration: move players/decks/want-lists from state.json → SQLite ─
(function migrateStateJson() {
  const row = db.prepare('SELECT value_json FROM app_state WHERE key = ?').get('state');
  if (row) return; // already migrated
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw     = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const players = Array.isArray(raw) ? [] : (raw.players || []);
    if (!players.length) return;
    db.prepare(`INSERT OR IGNORE INTO app_state (key, value_json) VALUES ('state', ?)`)
      .run(JSON.stringify({ players }));
    console.log(`Migrated ${players.length} player(s) from state.json to SQLite`);
  } catch (e) { console.warn('State migration skipped:', e.message); }
})();

// ── MTG Collection state ──────────────────────────────────────────────────────
app.get('/api/state', requireAuth, (req, res) => {
  try {
    const { players = [] } = readState();
    const collections = db.prepare('SELECT * FROM collections ORDER BY rowid').all().map(r => {
      try {
        return {
          key: r.key, name: r.name, source: r.source, id: r.col_id,
          color: r.color, cards: JSON.parse(r.cards_json || '{}'),
          entries: r.entries, total: r.total, savedAt: r.saved_at,
        };
      } catch (e) {
        console.error(`Failed to parse collection ${r.key}:`, e.message);
        return null;
      }
    }).filter(Boolean);
    res.json({ collections, players });
  } catch (e) {
    console.error('GET /api/state error:', e.message);
    res.json({ collections: [], players: [] });
  }
});

// Deep-equal for plain JSON-compatible values (no circular refs, no functions)
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) return false;
  return keysA.every(k => deepEqual(a[k], b[k]));
}

app.post('/api/state', requireAuth, express.json({ limit: '10mb' }), (req, res) => {
  const sess    = getSession(req);
  const current = readState();
  const players = req.body.players || [];
  if (sess.role !== 'admin') {
    // Non-admin cannot add or remove players
    const curIds = new Set((current.players || []).map(p => p.id));
    const incIds = new Set(players.map(p => p.id));
    if (curIds.size !== incIds.size || [...curIds].some(id => !incIds.has(id)))
      return res.status(403).json({ error: 'Forbidden' });
    // Non-admin cannot modify other players' decks
    for (const cp of (current.players || [])) {
      if (cp.id === sess.playerId) continue;
      const ip = players.find(p => p.id === cp.id);
      if (!ip || !deepEqual(cp.decks, ip.decks))
        return res.status(403).json({ error: 'Forbidden' });
    }
  }
  try {
    writeState({ ...current, players });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Collections (SQLite-backed) ───────────────────────────────────────────────
app.post('/api/collections', requireAuth, express.json({ limit: '10mb' }), (req, res) => {
  const { key, name, source, id, color, cards, entries, total, savedAt } = req.body || {};
  if (!key || !name || !source) return res.status(400).json({ error: 'key, name, source required' });
  try {
    db.prepare(`
      INSERT INTO collections (key, name, source, col_id, color, cards_json, entries, total, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        name=excluded.name, source=excluded.source, col_id=excluded.col_id,
        color=excluded.color, cards_json=excluded.cards_json,
        entries=excluded.entries, total=excluded.total, saved_at=excluded.saved_at
    `).run(key, name, source, id || null, color || '#a855f7',
      JSON.stringify(cards || {}), entries || 0, total || null, savedAt || null);
    res.json({ ok: true });
  } catch (e) {
    console.error('Collection save error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/collections/:key', requireAuth, (req, res) => {
  db.prepare('DELETE FROM collections WHERE key = ?').run(decodeURIComponent(req.params.key));
  res.json({ ok: true });
});

// ── Archidekt / Moxfield proxies ──────────────────────────────────────────────
function proxyGet(url, headers, res) {
  https.get(url, { headers }, apiRes => {
    console.log(`${apiRes.statusCode} ${url}`);
    res.status(apiRes.statusCode).setHeader('Content-Type', 'application/json');
    apiRes.pipe(res);
  }).on('error', err => { console.error(`Proxy error: ${err.message}`); res.status(500).json({ error: err.message }); });
}

app.get('/api/archidekt/collection/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { page = 1, pageSize = 100 } = req.query;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid collection ID' });
  proxyGet(`https://archidekt.com/api/collection/${id}/?page=${page}&pageSize=${pageSize}`,
    { 'User-Agent': 'MTGCollectionSearch/1.0' }, res);
});

app.get('/api/moxfield/collection/:slug/cards', requireAuth, (req, res) => {
  const { slug } = req.params;
  const { pageNumber = 1, pageSize = 100 } = req.query;
  if (!/^[\w-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid collection slug' });
  proxyGet(
    `https://api2.moxfield.com/v2/collection/${slug}/cards?pageNumber=${pageNumber}&pageSize=${pageSize}`,
    { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept': 'application/json, text/plain, */*', 'Referer': 'https://moxfield.com/', 'Origin': 'https://moxfield.com' },
    res);
});

app.get('/api/archidekt/deck/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid deck ID' });
  proxyGet(`https://archidekt.com/api/decks/${id}/`, { 'User-Agent': 'MTGCollectionSearch/1.0' }, res);
});

app.get('/api/collection/:id', requireAuth, (req, res) =>
  res.redirect(`/api/archidekt/collection/${req.params.id}?${new URLSearchParams(req.query)}`));

// ── RSS feed proxy + parser ───────────────────────────────────────────────────
const rssCache = new Map(); // url -> { data, fetchedAt }
const RSS_TTL  = 10 * 60 * 1000; // 10 min

function fetchRssUrl(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 4) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : require('http');
    const req = mod.get(url, { headers: { 'User-Agent': 'MTGTools/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchRssUrl(res.headers.location, hops + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => { buf += c; if (buf.length > 2_000_000) req.destroy(); });
      res.on('end', () => resolve(buf));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function rssExtractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function rssStripHtml(s) {
  return s.replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/\s+/g,' ').trim();
}

function parseRssFeed(xml, url) {
  const isAtom   = /<feed[\s>]/i.test(xml);
  const rawTitle = rssExtractTag(xml, 'title') || url;
  const title    = rssStripHtml(rawTitle);
  const itemTag  = isAtom ? 'entry' : 'item';
  const itemRe   = new RegExp(`<${itemTag}[\\s>]([\\s\\S]*?)<\\/${itemTag}>`, 'gi');
  const items    = [];
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 15) {
    const chunk = m[1];
    const iTitle = rssStripHtml(rssExtractTag(chunk, 'title') || '(no title)');
    let   iLink  = '';
    if (isAtom) {
      iLink = (chunk.match(/<link[^>]+href="([^"]+)"/) || [])[1] || rssExtractTag(chunk, 'link');
    } else {
      iLink = rssExtractTag(chunk, 'link');
    }
    const iDate  = rssExtractTag(chunk, isAtom ? 'updated' : 'pubDate') ||
                   rssExtractTag(chunk, 'published');
    const iDesc  = rssStripHtml(
      rssExtractTag(chunk, isAtom ? 'summary' : 'description') ||
      rssExtractTag(chunk, 'content')
    ).slice(0, 220);
    items.push({ title: iTitle, link: iLink.trim(), date: iDate.trim(), description: iDesc });
  }
  return { title, url, items };
}

app.get('/api/rss', requireAuth, async (req, res) => {
  if (!RSS_FEEDS.length) return res.json([]);
  const results = await Promise.all(RSS_FEEDS.map(async url => {
    const cached = rssCache.get(url);
    if (cached && Date.now() - cached.fetchedAt < RSS_TTL) return cached.data;
    try {
      const xml  = await fetchRssUrl(url);
      const data = parseRssFeed(xml, url);
      rssCache.set(url, { data, fetchedAt: Date.now() });
      return data;
    } catch (e) {
      console.error(`[rss] ${url}: ${e.message}`);
      return { title: url, url, items: [], error: e.message };
    }
  }));
  res.json(results);
});

app.listen(PORT, () => console.log(`MTG Tools → http://localhost:${PORT}`));
