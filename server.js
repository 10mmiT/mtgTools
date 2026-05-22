const express = require('express');
const https = require('https');
const path = require('path');
const fs = require('fs');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json');
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const COOKIE_NAME = 'mtgsearch_auth';

const { db, DEFAULT_CAL_ID } = require('./available-db');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Cookie helpers ────────────────────────────────────────────────────────────

function parseAuthCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE_NAME) return decodeURIComponent(v.join('='));
  }
  return null;
}

function isAuthenticated(req) {
  if (!APP_PASSWORD) return true;
  return parseAuthCookie(req) === APP_PASSWORD;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireAuthPage(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.redirect('/login');
}

// ── Static files (login page always accessible) ───────────────────────────────

app.use('/login', express.static(path.join(__dirname, 'public', 'login.html')));
app.use('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ── Auth endpoints ────────────────────────────────────────────────────────────

app.post('/api/login', express.json(), (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  if (req.body?.password === APP_PASSWORD) {
    res.setHeader('Set-Cookie',
      `${COOKIE_NAME}=${encodeURIComponent(APP_PASSWORD)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=2592000`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/auth-status', (req, res) => {
  res.json({ protected: !!APP_PASSWORD, authenticated: isAuthenticated(req) });
});

// ── Protect main page and all other routes ────────────────────────────────────

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/available/api/')) {
    return requireAuth(req, res, next);
  }
  if (req.path === '/' || req.path === '/index.html' || req.path.match(/\.(js|css|html)$/)) {
    if (APP_PASSWORD && req.path !== '/login' && !isAuthenticated(req)) {
      return res.redirect('/login');
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Available@ API ────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Cleanup old entries daily
db.prepare('DELETE FROM availability WHERE date < ?').run(today());
setInterval(() => db.prepare('DELETE FROM availability WHERE date < ?').run(today()), 86400000);

app.get('/available/api/default', requireAuth, (req, res) => {
  res.json({ id: DEFAULT_CAL_ID });
});

app.get('/available/api/calendars/:id', requireAuth, (req, res) => {
  const calendar = db.prepare('SELECT id, name, description, created_at FROM calendars WHERE id = ?').get(req.params.id);
  if (!calendar) return res.status(404).json({ error: 'Calendar not found' });

  const availability = db.prepare(
    'SELECT person_name, date FROM availability WHERE calendar_id = ? AND date >= ? ORDER BY date, person_name'
  ).all(req.params.id, today());

  res.json({ ...calendar, protected: false, availability });
});

app.post('/available/api/calendars/:id/toggle', requireAuth, express.json(), (req, res) => {
  const { person_name, date } = req.body;
  if (!person_name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!date || date < today()) return res.status(400).json({ error: 'Invalid date' });

  const name = person_name.trim();
  const existing = db.prepare(
    'SELECT id FROM availability WHERE calendar_id = ? AND person_name = ? AND date = ?'
  ).get(req.params.id, name, date);

  if (existing) {
    db.prepare('DELETE FROM availability WHERE calendar_id = ? AND person_name = ? AND date = ?').run(req.params.id, name, date);
    res.json({ available: false });
  } else {
    db.prepare('INSERT INTO availability (calendar_id, person_name, date) VALUES (?, ?, ?)').run(req.params.id, name, date);
    res.json({ available: true });
  }
});

app.delete('/available/api/calendars/:id/persons/:name', requireAuth, (req, res) => {
  db.prepare('DELETE FROM availability WHERE calendar_id = ? AND person_name = ?').run(
    req.params.id, decodeURIComponent(req.params.name)
  );
  res.json({ ok: true });
});

// ── MTG Collection state ──────────────────────────────────────────────────────

app.get('/api/state', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(DATA_FILE)) return res.json({ collections: [], players: [] });
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(raw)) return res.json({ collections: raw, players: [] });
    res.json(raw);
  } catch {
    res.json({ collections: [], players: [] });
  }
});

app.post('/api/state', requireAuth, express.json({ limit: '10mb' }), (req, res) => {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Archidekt / Moxfield proxies ──────────────────────────────────────────────

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
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://moxfield.com/',
      'Origin': 'https://moxfield.com',
    },
    res
  );
});

app.get('/api/archidekt/deck/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid deck ID' });
  proxyGet(`https://archidekt.com/api/decks/${id}/`,
    { 'User-Agent': 'MTGCollectionSearch/1.0' }, res);
});

function proxyGet(url, headers, res) {
  https.get(url, { headers }, (apiRes) => {
    console.log(`${apiRes.statusCode} ${url}`);
    res.status(apiRes.statusCode);
    res.setHeader('Content-Type', 'application/json');
    apiRes.pipe(res);
  }).on('error', (err) => {
    console.error(`Proxy error: ${err.message}`);
    res.status(500).json({ error: err.message });
  });
}

app.get('/api/collection/:id', requireAuth, (req, res) =>
  res.redirect(`/api/archidekt/collection/${req.params.id}?${new URLSearchParams(req.query)}`));

app.listen(PORT, () => {
  console.log(`MTG Collection Search → http://localhost:${PORT}`);
});
