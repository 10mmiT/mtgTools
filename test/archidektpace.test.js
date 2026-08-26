/* Archidekt import pacing.
 *
 * Archidekt hands back 25 collection rows per page whatever pageSize the URL
 * asks for, so importing a six-thousand-card collection is around 250
 * requests, not the sixty the pageSize=100 in the URL implies. The browser
 * fired them back to back, Archidekt's limiter cut in around page 80, and the
 * proxy piped that 429 straight through — the import failed with
 * "GET .../collection/702530?page=81 429 (Too Many Requests)" and every page
 * already fetched was thrown away.
 *
 * So: the server paces Archidekt requests, waits out a 429 instead of
 * forwarding it, and slows its own pace when one arrives. The last resort — a
 * 429 that outlives every retry — has to reach the browser as readable JSON,
 * because Archidekt's own 429 body is an HTML page the client can't parse and
 * would report as a bare "HTTP 429".
 */

'use strict';

// Small enough that the pacing is measurable without the suite waiting on it.
process.env.ARCHIDEKT_MIN_INTERVAL_MS = '30';
process.env.ARCHIDEKT_MAX_INTERVAL_MS = '300';
process.env.ARCHIDEKT_BACKOFF_MS      = '10';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const queue = require('../archidekt-queue');
const { queuedFetch, AD_MIN_INTERVAL } = queue;

// ── A stand-in for Archidekt ──────────────────────────────────────────────
const realFetch = globalThis.fetch;
let calls;      // { url, at } per request the queue actually made
let replies;    // statuses to answer with, in order; the last one repeats

function stubArchidekt(statuses, headers = {}) {
  replies = [...statuses];
  calls   = [];
  globalThis.fetch = async url => {
    calls.push({ url: String(url), at: Date.now() });
    const status = replies.length > 1 ? replies.shift() : replies[0];
    return new Response(status === 200 ? '{"count":1,"results":[],"next":null}' : '<html>rate limited</html>', {
      status,
      headers: status === 429 ? headers : { 'Content-Type': 'application/json' },
    });
  };
}

beforeEach(() => queue._reset());
after(() => { globalThis.fetch = realFetch; });

describe('Archidekt queue', () => {
  test('spaces requests instead of firing them back to back', async () => {
    stubArchidekt([200]);
    const url = 'https://archidekt.com/api/collection/1/?page=';
    await Promise.all([1, 2, 3, 4].map(p => queuedFetch(url + p)));

    assert.equal(calls.length, 4);
    for (let i = 1; i < calls.length; i++) {
      const gap = calls[i].at - calls[i - 1].at;
      // setTimeout can fire a hair early; a couple of ms of slack keeps this
      // from being a flaky assertion about the event loop.
      assert.ok(gap >= AD_MIN_INTERVAL - 5,
        `request ${i + 1} came ${gap}ms after the one before, wanted >= ${AD_MIN_INTERVAL}ms`);
    }
  });

  test('waits out a 429 and returns the page that follows it', async () => {
    stubArchidekt([429, 429, 200], { 'Retry-After': '0' });
    const res = await queuedFetch('https://archidekt.com/api/collection/1/?page=81');

    assert.equal(res.status, 200);
    assert.equal(calls.length, 3, 'the two 429s should have been retried, not forwarded');
    assert.deepEqual(await res.json(), { count: 1, results: [], next: null });
  });

  test('slows its own pace once Archidekt has complained', async () => {
    stubArchidekt([429, 200], { 'Retry-After': '0' });
    await queuedFetch('https://archidekt.com/api/collection/1/?page=1');

    stubArchidekt([200]);
    const before = Date.now();
    await queuedFetch('https://archidekt.com/api/collection/1/?page=2');
    await queuedFetch('https://archidekt.com/api/collection/1/?page=3');

    const elapsed = Date.now() - before;
    assert.ok(elapsed > AD_MIN_INTERVAL * 2,
      `two requests took ${elapsed}ms; the pace should have widened past ${AD_MIN_INTERVAL}ms each`);
  });

  test('gives the 429 back rather than throwing when it outlives every retry', async () => {
    stubArchidekt([429], { 'Retry-After': '0' });
    const res = await queuedFetch('https://archidekt.com/api/collection/1/?page=81');

    assert.equal(res.status, 429);
    assert.equal(calls.length, queue.AD_MAX_RETRIES, 'should stop after its retry budget, not keep going');
  });

  test('never paces itself slower than the ceiling', async () => {
    stubArchidekt([429], { 'Retry-After': '0' });
    for (let i = 0; i < 4; i++) await queuedFetch('https://archidekt.com/api/collection/1/?page=1');

    stubArchidekt([200]);
    const before = Date.now();
    await queuedFetch('https://archidekt.com/api/collection/1/?page=2');
    assert.ok(Date.now() - before <= Number(process.env.ARCHIDEKT_MAX_INTERVAL_MS) + 60,
      'the widened pace should be capped');
  });
});

// ── The proxy route ───────────────────────────────────────────────────────
// Booted after the queue suite so the stub above is already in place: the
// server must not reach the real Archidekt from a test run.
describe('GET /api/archidekt/collection/:id', () => {
  const fs   = require('node:fs');
  const path = require('node:path');
  const os   = require('node:os');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgpace-'));
  process.env.DATA_FILE      = path.join(tmpDir, 'state.json');
  process.env.ADMIN_PASSWORD = 'testpass';
  process.env.PORT           = '0';
  process.env.AUTH_RATE_LIMIT_MAX   = '1000';
  process.env.MTGTOOLS_NO_BACKGROUND = '1';

  const supertest = require('supertest');
  const { app }   = require('../server');
  const request   = supertest(app);

  async function cookie() {
    const res = await request.post('/api/auth/login')
      .send({ username: 'admin', password: 'testpass' })
      .set('Content-Type', 'application/json');
    const raw = res.headers['set-cookie'];
    return (Array.isArray(raw) ? raw[0] : raw).split(';')[0];
  }

  test('a rate limit that outlives the retries arrives as JSON the client can show', async () => {
    stubArchidekt([429], { 'Retry-After': '0' });
    const res = await request.get('/api/archidekt/collection/702530?page=81&pageSize=100')
      .set('Cookie', await cookie());

    assert.equal(res.status, 429);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.match(res.body.error, /rate-limit/i,
      'the HTML body Archidekt sends should never reach the browser');
  });

  test('a page Archidekt serves is passed through untouched', async () => {
    stubArchidekt([200]);
    const res = await request.get('/api/archidekt/collection/702530?page=1&pageSize=100')
      .set('Cookie', await cookie());

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { count: 1, results: [], next: null });
    assert.match(calls[0].url, /archidekt\.com\/api\/collection\/702530\/\?page=1/);
  });
});
