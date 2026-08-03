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
//
// The queue itself moved to scryfall-queue.js when the set index became the
// second thing on this server that talks to Scryfall — the pacing has to be
// shared, since Scryfall's limit is per IP and not per module.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { queuedFetch, isValidJson, SF_HEADERS } = require('../scryfall-queue');

const router = express.Router();
router.use(express.json({ limit: '256kb' }));

const SF_BASE   = 'https://api.scryfall.com/';
const CACHE_TTL = 10 * 60 * 1000;   // GET cache: 10 minutes
const CACHE_MAX = 500;              // max cached responses

// Only these API path prefixes may be proxied
const ALLOWED = /^(cards|sets)(\/|$|\?)/;

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

// isValidJson comes from scryfall-queue.js: an intercepted response would
// otherwise reach the client as a confusing "JSON.parse: unexpected
// character", and a cached GET would serve the broken body to everyone for
// ten minutes.

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

    if (!isValidJson(body)) {
      console.error(`[scryfall-proxy] non-JSON response from ${url} (status ${sfRes.status}): ${body.slice(0, 200)}`);
      return res.status(502).json({ error: 'Scryfall returned an unexpected (non-JSON) response — try again shortly' });
    }

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
    const body = await sfRes.text();
    if (!isValidJson(body)) {
      console.error(`[scryfall-proxy] non-JSON response from cards/collection (status ${sfRes.status}): ${body.slice(0, 200)}`);
      return res.status(502).json({ error: 'Scryfall returned an unexpected (non-JSON) response — try again shortly' });
    }
    res.status(sfRes.status).type('application/json').send(body);
  } catch (e) {
    console.error(`[scryfall-proxy] collection: ${e.message}`);
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
