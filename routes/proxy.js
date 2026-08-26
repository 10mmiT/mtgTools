'use strict';
const https   = require('https');
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { queuedFetch: archidektFetch } = require('../archidekt-queue');

const router = express.Router();

// ── EDHREC cache ──────────────────────────────────────────────────────────────
const edhrecCache = new Map(); // slug → { data, fetchedAt }
const EDHREC_TTL  = 30 * 60 * 1000;

function makeEdhrecSlug(name) {
  return name.toLowerCase()
    .replace(/[',]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, apiRes => {
      if (apiRes.statusCode !== 200) {
        apiRes.resume();
        return reject(new Error(`HTTP ${apiRes.statusCode}`));
      }
      let buf = '';
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

router.get('/edhrec/commander/:name', requireAuth, async (req, res) => {
  const name = decodeURIComponent(req.params.name);
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
});

function proxyGet(url, headers, res) {
  https.get(url, { headers }, apiRes => {
    console.log(`${apiRes.statusCode} ${url}`);
    res.status(apiRes.statusCode).setHeader('Content-Type', 'application/json');
    apiRes.pipe(res);
  }).on('error', err => {
    console.error(`Proxy error: ${err.message}`);
    res.status(500).json({ error: err.message });
  });
}

// Archidekt goes through archidekt-queue.js instead of proxyGet, so that an
// import's couple of hundred page requests are paced and a 429 is waited out
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

router.get('/archidekt/collection/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { page = 1, pageSize = 100 } = req.query;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid collection ID' });
  proxyArchidekt(`https://archidekt.com/api/collection/${id}/?page=${page}&pageSize=${pageSize}`, res);
});

router.get('/moxfield/collection/:slug/cards', requireAuth, (req, res) => {
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

router.get('/archidekt/deck/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid deck ID' });
  proxyArchidekt(`https://archidekt.com/api/decks/${id}/`, res);
});

// Legacy redirect
router.get('/collection/:id', requireAuth, (req, res) =>
  res.redirect(`/api/archidekt/collection/${req.params.id}?${new URLSearchParams(req.query)}`));

module.exports = router;
