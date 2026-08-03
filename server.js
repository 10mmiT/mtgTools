'use strict';
const express   = require('express');
const path      = require('path');
const bcrypt    = require('bcryptjs');
const helmet    = require('helmet');
const compression = require('compression');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD || '';
const PORT           = process.env.PORT || 3000;

const { db }  = require('./available-db');

// ── Bootstrap admin account from env var ──────────────────────────────────────
if (ADMIN_PASSWORD) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare(`
    INSERT INTO users (username, password_hash, role, player_id) VALUES ('admin', ?, 'admin', NULL)
    ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin'
  `).run(hash);
  console.log('Admin account configured from ADMIN_PASSWORD');
}

const { createLinkedPlayer } = require('./routes/state');

// ── App setup ──────────────────────────────────────────────────────────────────
const app = express();

// Security + compression
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

// Inject shared helpers into app.locals so routes can access them
app.locals.createLinkedPlayer = createLinkedPlayer;

// ── Login page (public) ────────────────────────────────────────────────────────
app.get('/login',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// The login page reads its palette from the app's token file instead of
// inlining a copy, so that file has to clear the auth guard below — the
// static mount is behind it. Design tokens carry nothing private.
app.get('/css/tokens.css', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'css', 'tokens.css')));

// tokens.css declares the @font-face rules, so the faces need the same
// exemption: behind the guard, a font request from the login page would be
// answered with a redirect to /login, the face would fail to decode, and the
// sign-in screen alone would sit in the fallback stack. A typeface carries
// nothing private either. Long-lived caching is safe because the filenames
// name the subset and the axis — a different font is a different filename.
app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts'), {
  maxAge: '30d',
}));

// ── Auth routes (public — no global guard yet) ─────────────────────────────────
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// ── Legacy auth-status compat ─────────────────────────────────────────────────
const { getSession, requireAuth } = require('./middleware/auth');
const OPEN_MODE = !ADMIN_PASSWORD;
app.get('/api/auth-status', (req, res) =>
  res.json({ protected: !OPEN_MODE, authenticated: !!getSession(req) }));

// ── Health check (public, before global auth guard) ────────────────────────────
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── Uploaded playmats ─────────────────────────────────────────────────────────
// Ahead of the global guard, and guarded itself, so that a request without a
// session is answered 401 rather than redirected to /login: this route is
// fetched by a CSS url(), and a login page returned with a 200 in place of an
// image is a broken background, not a sign-in prompt.
//
// Owner-only. The username in the path is what makes one user's mat a
// different URL from another's — which is what keeps them apart in a shared
// browser's cache — and the file that is served is always derived from the
// session, never from the path, so there is no name a request can put there
// to reach a file that is not its own.
const playmats = require('./playmat-store');
app.get('/playmat/:username', requireAuth, (req, res) => {
  const sess = getSession(req);
  if (req.params.username.toLowerCase() !== String(sess.username).toLowerCase())
    return res.status(403).json({ error: 'Forbidden' });
  const mat = playmats.find(sess.username);
  if (!mat) return res.status(404).json({ error: 'No playmat' });
  // The sniffed type, set before send() can infer one, and cached hard: the
  // path is stable per user but the URL carries the upload's version, so a
  // replacement is a different URL rather than a stale hit. Private, because
  // it is one person's image behind an authenticated route.
  res.setHeader('Content-Type', mat.type);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(mat.file);
});

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

// ── Static files ───────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ─────────────────────────────────────────────────────────────────
const { router: stateRouter } = require('./routes/state');
app.use('/api', stateRouter);
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/prefs'));
app.use('/api', require('./routes/proxy'));
app.use('/api', require('./routes/rss'));
app.use('/api', require('./routes/decks'));
app.use('/api', require('./routes/cards'));
app.use('/api', require('./routes/sets'));
app.use('/api', require('./routes/scryfall-proxy'));

// ── Background jobs against Scryfall ──────────────────────────────────────────
// The bulk-data cache (a daily oracle_cards download) and the set index (what
// is in each set, for the Set Browser's owned counts). Both share scryfall.db
// and the one rate-limited queue, so they pace themselves behind live
// requests.
//
// MTGTOOLS_NO_BACKGROUND=1 skips both. The test suite sets it: requiring this
// file is how the tests get an app, and neither job has anything to do with
// what they assert — without the switch every `npm test` starts a 24MB
// download it then abandons.
const scrydb   = require('./scryfall-db');
const setIndex = require('./set-index');
if (process.env.MTGTOOLS_NO_BACKGROUND !== '1') {
  scrydb.init();
  setIndex.init();
}

// ── Available@ calendar routes ─────────────────────────────────────────────────
app.use('/available', require('./routes/available'));



// ── Graceful shutdown ──────────────────────────────────────────────────────────
let server;

function shutdown(signal) {
  console.log(`\n[server] Received ${signal} — shutting down gracefully`);
  setIndex.stop();   // let the sweep finish its current set and stand down
  if (server) {
    server.close(() => {
      console.log('[server] HTTP server closed');
      db.close();
      scrydb.db.close();
      console.log('[server] Database closed');
      process.exit(0);
    });
    // Force-exit after 10s if connections don't drain
    setTimeout(() => { console.error('[server] Forced exit'); process.exit(1); }, 10_000).unref();
  } else {
    db.close();
    scrydb.db.close();
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Start ──────────────────────────────────────────────────────────────────────
server = app.listen(PORT, () => console.log(`MTG Tools → http://localhost:${PORT}`));

module.exports = { app, server: () => server }; // for tests
