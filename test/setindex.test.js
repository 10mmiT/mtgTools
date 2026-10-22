/* The set index's sweep, and what it does with a set that fails.
 *
 * It used to give a set three tries and then never again. Three transient
 * failures in a row are an ordinary bad evening on somebody's network, and
 * the production database had `pcy` stuck at attempts = 3 — a set the Set
 * Browser would never count owned cards for. These assert the backoff that
 * replaced the cap: a failed set waits and is tried again, a failure that is
 * nobody's set in particular costs no set anything, and the daily list
 * refresh starts every set over.
 */

'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const os     = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgsetindex-'));
process.env.DATA_FILE = path.join(tmpDir, 'state.json');

const setIndex = require('../set-index');
const { db }   = require('../scryfall-db');

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

const HOUR = 60 * 60 * 1000;

let asked;
/** Scryfall, answering every search with `answer(url)`. */
function serve(answer) {
  asked = [];
  globalThis.fetch = async url => { asked.push(String(url)); return answer(String(url)); };
}
const onePage = names => Response.json({ data: names.map(name => ({ name })), has_more: false });

function seed(code, { attempts = 0, lastAttempt = null } = {}) {
  db.prepare(`INSERT INTO sets (code, name, released_at, set_type, card_count, attempts, last_attempt_at)
              VALUES (?, ?, '2025-01-01', 'expansion', 2, ?, ?)`).run(code, code, attempts, lastAttempt);
}
const set = code => db.prepare('SELECT * FROM sets WHERE code = ?').get(code);

beforeEach(() => db.exec('DELETE FROM sets; DELETE FROM set_cards;'));

describe('a set that failed', () => {
  test('is tried again once its wait is over, however many times it failed', async () => {
    seed('pcy', { attempts: 3, lastAttempt: Date.now() - 25 * HOUR });
    serve(() => onePage(['Card A', 'Card B']));
    await setIndex.sweep();
    assert.equal(set('pcy').indexed, 2, 'a set with three failures was never tried again');
    assert.equal(set('pcy').attempts, 0);
  });

  test('is not tried again straight away', async () => {
    seed('pcy', { attempts: 1, lastAttempt: Date.now() - 5 * 60 * 1000 });
    serve(() => onePage(['Card A']));
    await setIndex.sweep();
    assert.equal(asked.length, 0, 'a set that failed five minutes ago was asked for again');
    assert.equal(set('pcy').indexed, null);
  });

  test('waits longer the more often it has failed', async () => {
    // Two hours is past the first wait and short of the third.
    seed('one', { attempts: 1, lastAttempt: Date.now() - 2 * HOUR });
    seed('thr', { attempts: 3, lastAttempt: Date.now() - 2 * HOUR });
    serve(() => onePage(['Card A']));
    await setIndex.sweep();
    assert.equal(set('one').indexed, 1);
    assert.equal(set('thr').indexed, null);
  });

  test('a failure that is the set’s own is counted, and timed', async () => {
    seed('bad');
    serve(() => new Response('oops', { status: 500 }));
    const before = Date.now();
    await setIndex.sweep();
    assert.equal(set('bad').attempts, 1);
    assert.ok(set('bad').last_attempt_at >= before);
  });

  test('the daily list refresh starts every set over', async () => {
    seed('pcy', { attempts: 3, lastAttempt: Date.now() });
    serve(url => url.endsWith('/sets')
      ? Response.json({ data: [{ code: 'pcy', name: 'Prophecy', set_type: 'expansion', card_count: 2 }] })
      : onePage([]));
    await setIndex.refreshSets();
    assert.equal(set('pcy').attempts, 0);
    assert.equal(set('pcy').last_attempt_at, null);
  });
});

describe('a failure that is not the set’s', () => {
  test('a network that refuses costs the set nothing', async () => {
    seed('pcy');
    serve(() => { throw new TypeError('fetch failed'); });
    await setIndex.sweep();
    assert.equal(set('pcy').attempts, 0, 'the set was blamed for the network');
    assert.equal(set('pcy').last_attempt_at, null);
  });

  test('nor does Scryfall rate-limiting us', async () => {
    seed('pcy');
    serve(() => new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } }));
    await setIndex.sweep();
    assert.equal(set('pcy').attempts, 0, 'the set was blamed for the rate limit');
  });

  test('and it ends the sweep rather than running down every other set', async () => {
    seed('aaa'); seed('bbb');
    serve(() => { throw new TypeError('fetch failed'); });
    await setIndex.sweep();
    assert.equal(asked.length, 1, `the sweep went on to ask for ${asked.length} sets`);
    setIndex.stop();   // and the retry it scheduled
  });
});
