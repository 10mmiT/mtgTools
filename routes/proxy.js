'use strict';
const https   = require('https');
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { queuedFetch: archidektFetch } = require('../archidekt-queue');
const { asyncHandler } = require('../middleware/async-handler');

const router = express.Router();

// ── EDHREC cache ──────────────────────────────────────────────────────────────
const edhrecCache = new Map(); // slug → { data, fetchedAt }
const EDHREC_TTL  = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;

function makeEdhrecSlug(name) {
  return name.toLowerCase()
    .replace(/[',]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    // The timeout aborts the request, and the abort arrives as the 'error'
    // below — a rejection the route already turns into a 502.
    https.get(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }, apiRes => {
      if (apiRes.statusCode !== 200) {
        apiRes.resume();
        return reject(new Error(`HTTP ${apiRes.statusCode}`));
      }
      let buf = '';
      apiRes.on('error', reject);
      apiRes.on('data', c => {
        buf += c;
        if (buf.length > 5_000_000) { apiRes.destroy(); reject(new Error('Response too large')); }
      });
      apiRes.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch { reject(new Error('Invalid JSON')); }
      });
    }).on('error', reject);
  });
}

router.get('/edhrec/commander/:name', requireAuth, asyncHandler(async (req, res) => {
  // Express has already decoded the param once, which is all the client
  // encoded it. A second decode threw on any name with a '%' left in it.
  const name = req.params.name;
  /* One commander, or two partners joined with '|'. EDHREC keys a partner pair
     under both slugs sorted alphabetically and joined with '-' — the same page
     whichever partner you name first. */
  const slug = name.split('|')
    .map(makeEdhrecSlug)
    .filter(Boolean)
    .sort()
    .join('-');
  const cached = edhrecCache.get(slug);
  if (cached && Date.now() - cached.fetchedAt < EDHREC_TTL) return res.json(cached.data);
  try {
    const data = await fetchJson(
      `https://json.edhrec.com/pages/commanders/${slug}.json`,
      { 'User-Agent': 'MTGTools/1.0', 'Accept': 'application/json' }
    );
    edhrecCache.set(slug, { data, fetchedAt: Date.now() });
    res.json(data);
  } catch (e) {
    console.error(`[edhrec] ${slug}: ${e.message}`);
    res.status(502).json({ error: e.message });
  }
}));

// Archidekt goes through archidekt-queue.js rather than a bare https.get, so
// that an import's couple of hundred page requests are paced and a 429 is waited out
// here rather than ending the import in the browser.
async function proxyArchidekt(url, res) {
  let apiRes;
  try {
    apiRes = await archidektFetch(url);
  } catch (err) {
    console.error(`Proxy error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
  console.log(`${apiRes.status} ${url}`);

  // A 429 that survived the queue's retries has been rate-limited for long
  // enough that waiting further is the user's call. Archidekt's own 429 body
  // is an HTML page, so it is replaced with something the client can read and
  // show: without it the browser reports a bare "HTTP 429".
  if (apiRes.status === 429) {
    return res.status(429).json({
      error: 'Archidekt is rate-limiting this server. Wait a few minutes and update the collection again.',
    });
  }

  const body = await apiRes.text().catch(() => '');
  res.status(apiRes.status).type('application/json').send(body);
}

// Both numbers go into Archidekt's URL as they arrive, so they have to be
// numbers. Archidekt serves 25 rows a page whatever is asked for; 100 is what
// the import asks for, and nothing has a reason to ask for more.
router.get('/archidekt/collection/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = '1', pageSize = '100' } = req.query;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid collection ID' });
  if (!/^\d{1,6}$/.test(page) || !/^\d{1,6}$/.test(pageSize))
    return res.status(400).json({ error: 'Invalid page' });
  const size = Math.min(Math.max(Number(pageSize), 1), 100);
  await proxyArchidekt(`https://archidekt.com/api/collection/${id}/?page=${Number(page)}&pageSize=${size}`, res);
}));

/* There is no Moxfield collection route. It was the browser's, from before
 * the import loop moved to the server, and api2.moxfield.com answers 403
 * (Cloudflare) to this machine as it does to any: a collection comes in from
 * Moxfield's CSV export instead, parsed in the tab, printings and all. */

router.get('/archidekt/deck/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid deck ID' });
  await proxyArchidekt(`https://archidekt.com/api/decks/${id}/`, res);
}));

// Legacy redirect
router.get('/collection/:id', requireAuth, (req, res) =>
  res.redirect(`/api/archidekt/collection/${req.params.id}?${new URLSearchParams(req.query)}`));

module.exports = router;
