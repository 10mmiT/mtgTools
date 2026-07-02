'use strict';
// ── Scryfall proxy ────────────────────────────────────────────────────────────
// The client no longer talks to api.scryfall.com directly. Reasons:
//  1. Scryfall's 429 responses carry no CORS headers, so a rate-limited browser
//     can't even read the status — it just sees a network error and can't back
//     off intelligently. Server-to-server has no CORS, so we can honor
//     Retry-After properly.
//  2. The rate limit is per IP. Client-side pacing works per *tab* — two tabs
//     (or two players behind one NAT) each pacing at 8/s still burst past
//     10/s combined. One server-side queue is the only real fix.
//  3. We can cache hot responses (sets list, search pages, card lookups) for
//     everyone at once.
const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(express.json({ limit: '256kb' }));

const SF_BASE         = 'https://api.scryfall.com/';
const SF_MIN_INTERVAL = 110;              // ms between request starts (~9 req/s)
const CACHE_TTL       = 10 * 60 * 1000;   // GET cache: 10 minutes
const CACHE_MAX       = 500;              // max cached responses

// Only these API path prefixes may be proxied
const ALLOWED = /^(cards|sets)(\/|$|\?)/;

// ── Central queue (mirrors the client-side one, but shared by all clients) ────
const _queue = [];
let _pumping  = false;
let _nextSlot = 0;

function queuedFetch(url, opts) {
  return new Promise((resolve, reject) => {
    _queue.push({ url, opts, resolve, reject });
    _pump();
  });
}

async function _pump() {
  if (_pumping) return;
  _pumping = true;
  while (_queue.length) {
    const wait = _nextSlot - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _nextSlot = Date.now() + SF_MIN_INTERVAL;
    const job = _queue.shift();
    try {
      let res = await fetch(job.url, job.opts);
      if (res.status === 429) {
        const ra    = parseInt(res.headers.get('Retry-After'), 10);
        const delay = Number.isFinite(ra) ? Math.min(ra, 70) * 1000 : 2000;
        console.warn(`[scryfall-proxy] 429 — pausing all Scryfall traffic ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
        _nextSlot = Date.now() + SF_MIN_INTERVAL;
        res = await fetch(job.url, job.opts);
      }
      job.resolve(res);
    } catch (e) { job.reject(e); }
  }
  _pumping = false;
}

// ── GET cache ─────────────────────────────────────────────────────────────────
const _cache = new Map(); // url → { at, status, body }

function cacheGet(url) {
  const hit = _cache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) { _cache.delete(url); return null; }
  return hit;
}

function cacheSet(url, status, body) {
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value); // evict oldest
  _cache.set(url, { at: Date.now(), status, body });
}

const SF_HEADERS = { 'User-Agent': 'MTGTools/1.0', 'Accept': 'application/json' };

// GET /api/scryfall/<anything scryfall serves under cards/ or sets/>
router.get(/^\/scryfall\/(.+)$/, requireAuth, async (req, res) => {
  const rest = req.params[0];
  if (!ALLOWED.test(rest)) return res.status(400).json({ error: 'Path not allowed' });
  const qs  = req.originalUrl.includes('?') ? '?' + req.originalUrl.split('?').slice(1).join('?') : '';
  const url = SF_BASE + rest + qs;

  const hit = cacheGet(url);
  if (hit) return res.status(hit.status).type('application/json').send(hit.body);

  try {
    const sfRes = await queuedFetch(url, { headers: SF_HEADERS });
    const body  = await sfRes.text();
    if (sfRes.status === 200 || sfRes.status === 404) cacheSet(url, sfRes.status, body);
    res.status(sfRes.status).type('application/json').send(body);
  } catch (e) {
    console.error(`[scryfall-proxy] ${url}: ${e.message}`);
    res.status(502).json({ error: e.message });
  }
});

// POST /api/scryfall/cards/collection  (batch identifier lookups — not cached)
router.post('/scryfall/cards/collection', requireAuth, async (req, res) => {
  try {
    const sfRes = await queuedFetch(SF_BASE + 'cards/collection', {
      method:  'POST',
      headers: { ...SF_HEADERS, 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body || {}),
    });
    res.status(sfRes.status).type('application/json').send(await sfRes.text());
  } catch (e) {
    console.error(`[scryfall-proxy] collection: ${e.message}`);
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
