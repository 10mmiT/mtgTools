/* Server-side collection imports.
 *
 * A six-thousand-card Archidekt collection is 250 requests paced a second
 * apart, so importing one takes four minutes. It used to be a loop inside the
 * browser tab that saved nothing until the final page — so a refresh, a
 * backgrounded phone or a locked screen threw away every page fetched so far,
 * and there was nothing to resume from. The whole point of moving it here is
 * that the tab stops mattering, so that is what these assert: the run
 * survives the caller leaving, its place is written down as it goes, and a
 * process that dies mid-import leaves something a person can pick up.
 */

'use strict';

// The queue paces real Archidekt traffic at one request a second; these tests
// serve their pages from a stub, and would otherwise spend that second each.
process.env.ARCHIDEKT_MIN_INTERVAL_MS = '1';
process.env.ARCHIDEKT_BACKOFF_MS      = '5';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const os     = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgimport-'));
process.env.DATA_FILE = path.join(tmpDir, 'state.json');
process.env.MTGTOOLS_NO_BACKGROUND = '1';

const { db }  = require('../available-db');
const imports = require('../collection-import');

// ── A stand-in for Archidekt ──────────────────────────────────────────────
// 25 rows a page, which is what the real API does whatever pageSize it is
// handed — the fact the whole design turns on.
const PER_PAGE = 25;
const realFetch = globalThis.fetch;

let served;      // pages actually requested
let failAt;      // { page, status } — one page answers with an error
let holdAt;      // page at which to pause, so a test can act mid-import
let held;        // resolve to let a held import continue

function stubArchidekt(totalRows) {
  served = [];
  failAt = null;
  holdAt = null;
  held   = null;
  globalThis.fetch = async url => {
    const page = Number(new URL(String(url)).searchParams.get('page'));
    served.push(page);

    if (holdAt === page) await new Promise(r => { held = r; });
    if (failAt && failAt.page === page) {
      return new Response('<html>no</html>', { status: failAt.status });
    }

    const first = (page - 1) * PER_PAGE;
    const rows  = [];
    for (let i = first; i < Math.min(first + PER_PAGE, totalRows); i++) {
      rows.push({ quantity: 1, card: { oracleCard: { name: `Card ${i}`, types: ['Creature'], manaCost: '{G}' } } });
    }
    return Response.json({
      count: totalRows,
      results: rows,
      next: first + PER_PAGE < totalRows ? `?page=${page + 1}` : null,
    });
  };
}

const KEY = 'archidekt:702530';
const META = { key: KEY, name: 'Tim’s shelf', source: 'archidekt', id: '702530', color: '#a855f7' };

const row  = () => db.prepare('SELECT * FROM collection_imports WHERE key = ?').get(KEY);
const shelf = () => db.prepare('SELECT * FROM collections WHERE key = ?').get(KEY);

/* Every run started by a test, so the next one can be sure none is still
 * going. A loop left running does not just linger — it keeps calling
 * globalThis.fetch, which by then is the *next* test's stub, and quietly eats
 * the pages and the hold that test set up for itself. */
let outstanding = [];

function start(meta = META, by = 'tim') {
  const handle = imports.startImport(meta, by);
  if (handle.done) outstanding.push(handle.done);
  return handle;
}

/** Wait for the run to reach the page holdAt names. */
async function reachHold() {
  while (!held) await new Promise(r => setTimeout(r, 5));
}

beforeEach(async () => {
  for (const key of [...imports._running.keys()]) imports.cancelImport(key);
  if (held) held();
  await Promise.allSettled(outstanding);
  outstanding = [];
  imports._running.clear();
  db.prepare('DELETE FROM collection_imports').run();
  db.prepare('DELETE FROM collections').run();
});
after(() => { globalThis.fetch = realFetch; });

describe('An import that runs to the end', () => {
  test('lands in collections with every card, and leaves no import row behind', async () => {
    stubArchidekt(120);                       // 5 pages
    const { started, done } = start();
    assert.equal(started, true);
    await done;

    assert.equal(row(), undefined, 'the import row should be gone once it has landed');

    const col = shelf();
    assert.ok(col, 'the collection should be on the shelf');
    assert.equal(col.entries, 120);
    assert.equal(col.total, 120);
    assert.equal(Object.keys(JSON.parse(col.cards_json)).length, 120);
    assert.equal(col.name, 'Tim’s shelf');
    assert.deepEqual(served, [1, 2, 3, 4, 5]);
  });

  test('sums the quantities of a card that appears on more than one page', async () => {
    // Two rows of the same card, which is what a played set and a spare look
    // like in a real collection.
    globalThis.fetch = async () => Response.json({
      count: 2, next: null,
      results: [
        { quantity: 2, card: { oracleCard: { name: 'Sol Ring', types: ['Artifact'], manaCost: '{1}' } } },
        { quantity: 3, card: { oracleCard: { name: 'Sol Ring', types: ['Artifact'], manaCost: '{1}' } } },
      ],
    });
    await start().done;

    const cards = JSON.parse(shelf().cards_json);
    assert.equal(cards['Sol Ring'].qty, 5);
    assert.equal(cards['Sol Ring'].type, 'Artifact');
  });
});

describe('An import the caller walks away from', () => {
  test('keeps going after the request that started it has returned', async () => {
    stubArchidekt(250);                        // 10 pages
    const { done } = start();

    // Nothing is awaited between start and here: this is the state of things
    // the instant the HTTP handler answered the browser.
    assert.equal(imports.listImports()[0].status, 'running');
    assert.equal(shelf(), undefined, 'nothing on the shelf yet');

    await done;
    assert.equal(shelf().entries, 250, 'it finished on its own');
  });

  test('writes its place down as it goes, not only at the end', async () => {
    stubArchidekt(500);                        // 20 pages
    holdAt = 15;                               // pause partway
    const { done } = start();

    // Wait for the run to reach the held page.
    await reachHold();

    const mid = row();
    assert.equal(mid.status, 'running');
    assert.ok(mid.next_page > 1, 'the page reached should be recorded');
    assert.ok(mid.entries > 0, `some cards should be checkpointed, got ${mid.entries}`);
    assert.ok(Object.keys(JSON.parse(mid.cards_json)).length > 0,
      'the cards gathered so far should be on disk, not only in memory');

    held();
    await done;
    assert.equal(shelf().entries, 500);
  });
});

describe('An import that stops', () => {
  test('can be resumed, and does not refetch or double-count what it had', async () => {
    stubArchidekt(500);                        // 20 pages
    failAt = { page: 8, status: 500 };
    await start().done;

    const stopped = row();
    assert.equal(stopped.status, 'interrupted');
    assert.equal(shelf(), undefined, 'a stopped import must not half-write the shelf');
    const gathered = stopped.entries;
    assert.ok(gathered > 0);

    // Resume against a stub that will answer page 8 this time.
    const servedBefore = [...served];
    stubArchidekt(500);
    const { resumed, done } = start();
    assert.equal(resumed, true, 'a stopped import should be picked up, not restarted');
    await done;

    assert.equal(shelf().entries, 500, 'no card counted twice, none missed');
    assert.ok(!served.includes(1), `resume should not refetch page 1; asked for ${served.slice(0, 3)}`);
    assert.ok(servedBefore.includes(1), 'sanity: the first run did fetch page 1');
  });

  test('a restart throws the gathered pages away instead of merging them', async () => {
    stubArchidekt(500);
    failAt = { page: 8, status: 500 };
    await start().done;
    assert.ok(row().entries > 0);

    // What Refresh does: the shelf should end up matching the source, not the
    // source added to what was already collected.
    stubArchidekt(500);
    await start({ ...META, restart: true }).done;

    assert.equal(shelf().entries, 500);
    assert.equal(served[0], 1, 'a restart begins at page 1');
  });

  test('a deleted collection is an error and not something to retry forever', async () => {
    stubArchidekt(500);
    failAt = { page: 3, status: 404 };
    await start().done;

    const stopped = row();
    assert.equal(stopped.status, 'error');
    assert.match(stopped.error, /404/);
  });

  test('cancelling keeps the pages already gathered; discarding does not', async () => {
    stubArchidekt(500);
    holdAt = 12;
    const { done } = start();
    await reachHold();

    imports.cancelImport(KEY);
    held();
    await done;

    const stopped = row();
    assert.equal(stopped.status, 'interrupted');
    assert.ok(stopped.entries > 0, 'a cancel should leave something to resume from');
    assert.equal(shelf(), undefined);

    assert.equal(imports.clearImport(KEY), true);
    assert.equal(row(), undefined, 'discarding forgets the run entirely');
  });
});

describe('A server that restarts mid-import', () => {
  test('leaves the import marked interrupted rather than running forever', () => {
    // The row a killed process leaves behind, and the sweep available-db.js
    // runs at boot. Without it the panel shows a progress bar that will never
    // move again, because the loop that was moving it is gone.
    db.prepare(`
      INSERT INTO collection_imports (key, name, source, col_id, color, status, next_page, entries, total, cards_json)
      VALUES (?, ?, 'archidekt', '702530', '#a855f7', 'running', 40, 1000, 6247, '{}')
    `).run(KEY, 'Tim’s shelf');

    db.prepare("UPDATE collection_imports SET status = 'interrupted' WHERE status = 'running'").run();

    const [imp] = imports.listImports();
    assert.equal(imp.status, 'interrupted');
    assert.equal(imp.entries, 1000);
    assert.equal(imp.page, 40, 'the page it reached is what Resume starts from');
    assert.equal(imp.live, false, 'and no process claims to be working on it');
  });
});

describe('listImports', () => {
  test('reports progress without handing over the cards', async () => {
    stubArchidekt(500);
    holdAt = 12;
    const { done } = start();
    await reachHold();

    const [imp] = imports.listImports();
    assert.equal(imp.key, KEY);
    assert.equal(imp.status, 'running');
    assert.equal(imp.total, 500);
    assert.equal(imp.startedBy, 'tim');
    assert.equal(imp.live, true);
    // The poll runs every two seconds while an import is going; shipping the
    // half-built card list with it would be megabytes a minute.
    assert.ok(!('cards' in imp) && !('cards_json' in imp),
      `the poll payload should carry counters, not cards: ${Object.keys(imp)}`);

    held();
    await done;
  });
});

// ── The routes the browser uses ───────────────────────────────────────────
describe('Import routes', () => {
  process.env.ADMIN_PASSWORD = 'testpass';
  process.env.PORT           = '0';
  process.env.AUTH_RATE_LIMIT_MAX = '1000';

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

  test('starting one answers immediately, before the import is anywhere near done', async () => {
    stubArchidekt(500);
    holdAt = 3;
    const res = await request.post(`/api/collections/${encodeURIComponent(KEY)}/import`)
      .set('Cookie', await cookie())
      .send({ name: 'Tim’s shelf', source: 'archidekt', id: '702530', color: '#a855f7' });

    assert.equal(res.status, 200);
    assert.equal(res.body.started, true);
    assert.equal(res.body.imports[0].status, 'running');
    // The request came back while the fetch loop is still on page 3 of 20.
    assert.equal(shelf(), undefined);

    await reachHold();
    held();
  });

  test('a CSV collection is refused — the file only exists in the browser', async () => {
    const res = await request.post('/api/collections/csv-archidekt:box/import')
      .set('Cookie', await cookie())
      .send({ name: 'A box', source: 'csv-archidekt', id: 'box' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /csv-archidekt/);
  });

  test('imports ride along with /api/state, so a tab opening mid-run sees one', async () => {
    stubArchidekt(500);
    holdAt = 3;
    start();
    await reachHold();

    const res = await request.get('/api/state').set('Cookie', await cookie());
    assert.equal(res.status, 200);
    assert.equal(res.body.imports.length, 1);
    assert.equal(res.body.imports[0].key, KEY);
    held();
  });

  test('a stopped one can be resumed, and a discarded one is gone', async () => {
    const c = await cookie();
    stubArchidekt(500);
    holdAt = 3;
    start();
    await reachHold();

    const stop = await request.delete(`/api/imports/${encodeURIComponent(KEY)}`).set('Cookie', c);
    assert.equal(stop.status, 200);
    held();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(imports.getImport(KEY).status, 'interrupted');

    const gone = await request.delete(`/api/imports/${encodeURIComponent(KEY)}?forget=1`).set('Cookie', c);
    assert.equal(gone.status, 200);
    assert.equal(imports.getImport(KEY), null);
  });

  test('removing a collection stops an import that would put it back', async () => {
    const c = await cookie();
    stubArchidekt(500);
    holdAt = 3;
    start();
    await reachHold();

    await request.delete(`/api/collections/${encodeURIComponent(KEY)}`).set('Cookie', c);
    assert.equal(imports.getImport(KEY), null, 'the import row goes with the collection');
    held();
    await new Promise(r => setTimeout(r, 50));
    assert.equal(shelf(), undefined, 'and it must not reappear minutes later');
  });

  test('the whole list needs a session', async () => {
    const res = await request.get('/api/imports');
    assert.notEqual(res.status, 200);
  });
});
