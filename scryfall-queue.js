'use strict';
// ── One Scryfall queue for the whole process ──────────────────────────────────
// Scryfall's rate limit is per IP, so pacing has to be per *server*, not per
// caller. This was the proxy's private queue while the proxy was the only
// thing here that talked to Scryfall; set-index.js is the second, and two
// queues each pacing at ~9 req/s would put the server at 18.
//
// Callers are expected to await one request before making the next, so the
// queue stays short and a user-facing request never waits behind more than
// the one job already in flight.
const SF_MIN_INTERVAL = 110;   // ms between request starts (~9 req/s)

const SF_HEADERS = { 'User-Agent': 'MTGTools/1.0', 'Accept': 'application/json' };

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
        console.warn(`[scryfall-queue] 429 — pausing all Scryfall traffic ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
        _nextSlot = Date.now() + SF_MIN_INTERVAL;
        res = await fetch(job.url, job.opts);
      }
      job.resolve(res);
    } catch (e) { job.reject(e); }
  }
  _pumping = false;
}

// Scryfall is Cloudflare-fronted — if something between us and them (a bot
// challenge, a captive portal, a network block) intercepts the request, we can
// get an HTML page back with a 200 status instead of JSON. Callers verify the
// body actually parses before trusting or caching it.
function isValidJson(body) {
  try { JSON.parse(body); return true; } catch { return false; }
}

module.exports = { queuedFetch, isValidJson, SF_HEADERS, SF_MIN_INTERVAL };
