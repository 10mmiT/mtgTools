'use strict';
// ── One Archidekt queue for the whole process ─────────────────────────────────
// Archidekt caps a collection page at 25 rows no matter how large a pageSize
// we ask for, so importing a six-thousand-card collection is ~250 requests,
// not the ~60 the pageSize=100 in the URL suggests. The browser awaits each
// page before asking for the next, but with no pause between them that is
// still a burst: Archidekt's limiter cut an import off around page 80 with a
// 429, which the proxy passed straight to the browser, throwing away every
// page already fetched.
//
// The pacing lives here rather than in the browser for the same reason
// scryfall-queue.js exists: the limit is per IP, so two tabs importing at once
// share one budget and can only be paced together, on the server.
//
// Archidekt publishes no limit, so these numbers were measured against the
// live API (2026-08-26): about 80 requests are allowed per minute, whatever
// rate they arrive at — an unpaced import and a 4/s one both died on request
// 81 — and the budget frees up again roughly ten seconds later. A 429 carries
// no Retry-After header to read instead.
//
// One request a second therefore has margin and holds: a full 250-page
// collection went through in 252s with nothing rejected. That makes a big
// import a four-minute job rather than a twenty-second one, which is the
// trade for it finishing at all; the browser fills its progress in as each
// page lands.
//
// The pace is adaptive on top of that, since the limit is undocumented and
// free to change: it widens every time a 429 comes back and eases off again
// once Archidekt has stopped complaining for a while.
const AD_MIN_INTERVAL = Number(process.env.ARCHIDEKT_MIN_INTERVAL_MS) || 1000;  // ms between request starts (~60/min)
const AD_MAX_INTERVAL = Number(process.env.ARCHIDEKT_MAX_INTERVAL_MS) || 4000;  // slowest the queue will pace itself
const AD_RECOVER_MS   = Number(process.env.ARCHIDEKT_RECOVER_MS)      || 10 * 60 * 1000;
const AD_BACKOFF_MS   = Number(process.env.ARCHIDEKT_BACKOFF_MS)      || 10_000; // measured recovery time; 429s name no Retry-After
const AD_MAX_RETRIES  = 5;    // attempts per request before a 429 is passed on

const AD_HEADERS = { 'User-Agent': 'MTGCollectionSearch/1.0', 'Accept': 'application/json' };

const _queue = [];
let _pumping  = false;
let _nextSlot = 0;
let _interval = AD_MIN_INTERVAL;
let _last429  = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    const job = _queue.shift();
    try { job.resolve(await _send(job.url, job.opts)); }
    catch (e) { job.reject(e); }
  }
  _pumping = false;
}

// One request, retried in place. Retrying inside the pump — rather than
// re-queueing — is what makes a 429 pause *all* Archidekt traffic and not just
// the unlucky request: everything behind it in the queue waits out the same
// backoff.
async function _send(url, opts) {
  for (let attempt = 1; ; attempt++) {
    if (_interval > AD_MIN_INTERVAL && Date.now() - _last429 > AD_RECOVER_MS) _interval = AD_MIN_INTERVAL;

    const wait = _nextSlot - Date.now();
    if (wait > 0) await sleep(wait);
    _nextSlot = Date.now() + _interval;

    const res = await fetch(url, { headers: AD_HEADERS, ...opts });
    if (res.status !== 429) return res;

    _last429  = Date.now();
    _interval = Math.min(Math.round(_interval * 1.5), AD_MAX_INTERVAL);
    // The body is drained on both paths below so the socket can be reused; a
    // 429 from Cloudflare is an HTML page, not the JSON the caller wants
    // anyway, so nothing readable is lost by consuming it here.
    await res.text().catch(() => '');

    if (attempt >= AD_MAX_RETRIES) {
      console.warn(`[archidekt-queue] 429 after ${attempt} attempts — giving up on ${url}`);
      return res;
    }

    const ra    = parseInt(res.headers.get('Retry-After'), 10);
    const delay = Number.isFinite(ra) ? Math.min(ra, 60) * 1000
                                      : Math.min(AD_BACKOFF_MS * 2 ** (attempt - 1), 60_000);
    console.warn(`[archidekt-queue] 429 — pausing all Archidekt traffic ${delay / 1000}s ` +
                 `(attempt ${attempt}/${AD_MAX_RETRIES}, pace now ${_interval}ms)`);
    _nextSlot = Date.now() + delay;
  }
}

// Test seam: the suite runs the queue with tiny intervals and needs the pace
// back at its starting value between cases.
function _reset() {
  _queue.length = 0;
  _nextSlot = 0;
  _interval = AD_MIN_INTERVAL;
  _last429  = 0;
}

module.exports = { queuedFetch, AD_HEADERS, AD_MIN_INTERVAL, AD_MAX_INTERVAL, AD_MAX_RETRIES, _reset };
