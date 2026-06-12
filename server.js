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
app.use('/api', require('./routes/proxy'));
app.use('/api', require('./routes/rss'));

// ── Available@ calendar routes ─────────────────────────────────────────────────
app.use('/available', require('./routes/available'));



// ── Graceful shutdown ──────────────────────────────────────────────────────────
let server;

function shutdown(signal) {
  console.log(`\n[server] Received ${signal} — shutting down gracefully`);
  if (server) {
    server.close(() => {
      console.log('[server] HTTP server closed');
      db.close();
      console.log('[server] Database closed');
      process.exit(0);
    });
    // Force-exit after 10s if connections don't drain
    setTimeout(() => { console.error('[server] Forced exit'); process.exit(1); }, 10_000).unref();
  } else {
    db.close();
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Start ──────────────────────────────────────────────────────────────────────
server = app.listen(PORT, () => console.log(`MTG Tools → http://localhost:${PORT}`));

module.exports = { app }; // for tests
