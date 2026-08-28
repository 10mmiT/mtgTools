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

const { db, readCollectionCards } = require('../available-db');
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

const ROW_UID = 'ea20208b-4f1e-4d4c-9b4a-000000000001';
const OTHER_UID = 'ea20208b-4f1e-4d4c-9b4a-000000000002';

let requested;   // every URL the import actually asked for

/** Answer every request with these payloads in turn, recording what was
 *  asked for — which is what the no-extra-requests assertion reads. */
function servePages(payloads) {
  requested = [];
  globalThis.fetch = async url => {
    requested.push(String(url));
    return Response.json(payloads[Math.min(requested.length - 1, payloads.length - 1)]);
  };
}

/** One page of Archidekt rows, and nothing after it. */
const serveRows = rows => servePages([{ count: rows.length, next: null, results: rows }]);

/** A row of Archidekt's collection API, printing and all. */
function archidektRow({ name = 'Sol Ring', qty = 1, uid = ROW_UID, set = 'c21',
                        setName = 'Commander 2021', number = '263', foil = false,
                        language = 1, condition = 1 } = {}) {
  return {
    quantity: qty, foil, language, condition,
    card: {
      uid, collectorNumber: number,
      edition: { editioncode: set, editionname: setName },
      oracleCard: { name, types: ['Artifact'], manaCost: '{1}' },
    },
  };
}

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
      rows.push(archidektRow({ name: `Card ${i}`, number: String(i), foil: i % 10 === 0 }));
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
const shelf = (key = KEY) => db.prepare('SELECT * FROM collections WHERE key = ?').get(key);

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

  /* api2.moxfield.com is behind Cloudflare and answers 403 to this server, as
   * it does to any. Starting the job anyway is four minutes of nothing
   * followed by a status code, so it is refused before it begins — and the
   * refusal has to say where the way in is, because a Moxfield collection
   * does have one and it carries the printings. */
  test('a Moxfield collection is refused — its API answers 403 to any server', async () => {
    const res = await request.post('/api/collections/moxfield%3Aabc/import')
      .set('Cookie', await cookie())
      .send({ name: 'A Moxfield shelf', source: 'moxfield', id: 'abc' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /CSV/);
    assert.equal(imports.getImport('moxfield:abc'), null, 'a job was started anyway');
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

// ── The printing on every row ─────────────────────────────────────────────
/* Archidekt names the printing of every copy it sends — the Scryfall id, the
 * set, the collector number, the finish, the language and the condition — and
 * the import kept the name and a running total and threw the rest away. So a
 * shelf knew you own three Sol Rings and not which three, and no amount of
 * asking Archidekt again would have told it: the answer was in the pages it
 * had already fetched.
 *
 * These assert the parse and the arithmetic under it, because the invariant
 * that matters — the breakdown adds up to the quantity — has to hold before
 * anything reaches a browser. A copy that cannot be attributed is the unknown
 * entry rather than a guess, which is the same rule the shelf itself keeps.
 */
/** A card of the saved shelf as everything outside the database sees one —
 *  which is where the breakdown is always an array and always adds up, and so
 *  the surface these assertions are about. */
const importedInto = (key, name) => readCollectionCards(shelf(key).cards_json)[name];
const imported = name => importedInto(KEY, name);

describe('An import that records what the printings are', () => {
  test('keeps the set, the collector number, the finish, the language and the condition', async () => {
    serveRows([archidektRow({ qty: 2 })]);
    await start().done;

    const card = imported('Sol Ring');
    assert.equal(card.qty, 2);
    assert.deepEqual(card.printings, [{
      id: ROW_UID, set: 'c21', set_name: 'Commander 2021',
      collector_number: '263', finish: 'nonfoil', lang: '1', condition: '1', qty: 2,
    }]);
  });

  test('splits a card held in more than one printing across them', async () => {
    serveRows([
      archidektRow({ qty: 2 }),
      archidektRow({ qty: 1, uid: OTHER_UID, set: 'rav', setName: 'Ravnica', number: '266' }),
    ]);
    await start().done;

    const card = imported('Sol Ring');
    assert.equal(card.qty, 3, 'the quantity is what it always was');
    assert.deepEqual(card.printings.map(p => [p.set, p.qty]), [['c21', 2], ['rav', 1]]);
  });

  test('and the breakdown adds up to what Archidekt said the quantity was', async () => {
    // Against the numbers on the served rows and not against the stored
    // quantity, which is the sum of the breakdown and would agree with itself
    // however badly a row had been counted.
    const sent = { 'Sol Ring': [2, 1], 'Llanowar Elves': [4], Forest: [7] };
    serveRows([
      archidektRow({ qty: 2 }),
      archidektRow({ qty: 1, uid: OTHER_UID, set: 'rav', number: '266' }),
      archidektRow({ name: 'Llanowar Elves', qty: 4, uid: OTHER_UID, set: 'dom', number: '168' }),
      archidektRow({ name: 'Forest', qty: 7, uid: null }),
    ]);
    await start().done;

    const shelved = readCollectionCards(shelf().cards_json);
    assert.deepEqual(Object.keys(shelved).sort(), Object.keys(sent).sort());
    for (const [name, rows] of Object.entries(sent)) {
      const owned = rows.reduce((n, q) => n + q, 0);
      assert.equal(shelved[name].qty, owned, `${name}: the quantity Archidekt sent`);
      assert.equal(shelved[name].printings.reduce((n, p) => n + p.qty, 0), owned,
        `${name}: and a breakdown that adds up to it`);
    }
  });

  test('the same printing on two pages is one entry holding the copies of both', async () => {
    // A played set and its spare are rarely next to each other in a real
    // collection, and the pages are gathered one at a time and written down
    // between whiles — so the fold has to survive the page boundary.
    servePages([
      { count: 2, next: '?page=2', results: [archidektRow({ qty: 2 })] },
      { count: 2, next: null,      results: [archidektRow({ qty: 1 })] },
    ]);
    await start().done;

    assert.equal(requested.length, 2, 'sanity: the two rows did arrive on two pages');
    const card = imported('Sol Ring');
    assert.equal(card.printings.length, 1, `one printing, got ${JSON.stringify(card.printings)}`);
    assert.equal(card.printings[0].qty, 3);
  });

  test('a foil is a printing of its own, not an ordinary copy', async () => {
    // Same Scryfall id on both rows: a foil is a finish rather than a
    // printing, so without the finish these two would be one entry of three.
    serveRows([
      archidektRow({ qty: 2 }),
      archidektRow({ qty: 1, foil: true }),
    ]);
    await start().done;

    const card = imported('Sol Ring');
    assert.equal(card.qty, 3);
    assert.deepEqual(card.printings.map(p => [p.finish, p.qty]), [['nonfoil', 2], ['foil', 1]]);
  });

  test('a row that names no printing goes to the unknown entry rather than a guess', async () => {
    serveRows([archidektRow({ qty: 3, uid: null, set: null, setName: null, number: null })]);
    await start().done;

    const card = imported('Sol Ring');
    assert.equal(card.qty, 3, 'the copies are still owned');
    assert.deepEqual(card.printings, [{ id: null, qty: 3 }]);
  });

  /* A set and a collector number is the same identity as a Scryfall id said
   * the other way round, so a row that has the first and not the second is a
   * printing rather than a shrug — which is the rule a Moxfield CSV export,
   * where no row anywhere names an id, is read by. */
  test('a row naming its edition and number but no id is still a printing', async () => {
    serveRows([archidektRow({ qty: 2, uid: null })]);
    await start().done;

    assert.deepEqual(imported('Sol Ring').printings, [{
      set: 'c21', set_name: 'Commander 2021', collector_number: '263',
      finish: 'nonfoil', lang: '1', condition: '1', qty: 2,
    }]);
  });

  test('but half of one is not: a set with no number is the unknown entry', async () => {
    serveRows([archidektRow({ qty: 2, uid: null, number: null })]);
    await start().done;

    assert.deepEqual(imported('Sol Ring').printings, [{ id: null, qty: 2 }]);
  });

  test('does not split a card on language or condition, which say nothing today', async () => {
    // Both come back as one constant code for every row in a real collection.
    // Two copies of one printing are two copies, not two printings.
    serveRows([
      archidektRow({ qty: 2 }),
      archidektRow({ qty: 1 }),
    ]);
    await start().done;

    const card = imported('Sol Ring');
    assert.equal(card.printings.length, 1, `one printing, got ${JSON.stringify(card.printings)}`);
    assert.equal(card.printings[0].qty, 3);
  });

  test('the printings gathered before an interruption survive the resume', async () => {
    // They are written down in the checkpoint and read back out of it, so a
    // resumed import comes back with the copies it had already filed rather
    // than with only the pages fetched after the stop.
    stubArchidekt(500);
    failAt = { page: 8, status: 500 };
    await start().done;
    assert.equal(row().status, 'interrupted');

    stubArchidekt(500);
    await start().done;

    assert.deepEqual(imported('Card 3').printings, [{
      id: ROW_UID, set: 'c21', set_name: 'Commander 2021',
      collector_number: '3', finish: 'nonfoil', lang: '1', condition: '1', qty: 1,
    }], 'a card from a page fetched before the stop');
    assert.equal(imported('Card 10').printings[0].finish, 'foil');
    assert.equal(imported('Card 400').printings[0].collector_number, '400',
      'and one from a page fetched after it');
  });

  test('asks for nothing beyond the pages of the collection itself', async () => {
    // The printing is on the rows the import was fetching anyway, so a shelf
    // gains all of this without a single request that was not being made
    // before — no lookup per card, and none per printing.
    servePages([
      { count: 3, next: '?page=2',
        results: [archidektRow({ qty: 2 }), archidektRow({ qty: 1, uid: OTHER_UID, set: 'rav' })] },
      { count: 3, next: null, results: [archidektRow({ name: 'Forest', qty: 7, uid: null })] },
    ]);
    await start().done;

    assert.equal(imported('Sol Ring').printings.length, 2, 'sanity: it did record them');
    assert.equal(requested.length, 2, `two pages, two requests; asked for ${requested}`);
    for (const url of requested)
      assert.match(url, /^https:\/\/archidekt\.com\/api\/collection\/702530\//);
  });

  test('leaves the collection already saved readable until the new one lands', async () => {
    // Re-importing is how a shelf gains its printings, and it takes four
    // minutes. Nobody may be left with nothing for those four minutes.
    db.prepare(`
      INSERT INTO collections (key, name, source, col_id, color, cards_json, entries, total, saved_at)
      VALUES (?, 'Tim’s shelf', 'archidekt', '702530', '#a855f7', ?, 1, 3, '2026-01-01T00:00:00.000Z')
    `).run(KEY, JSON.stringify({ 'Sol Ring': { name: 'Sol Ring', type: 'Artifact', mana: '{1}', qty: 3 } }));

    stubArchidekt(500);
    holdAt = 12;
    const { done } = start({ ...META, restart: true });
    await reachHold();

    const mid = JSON.parse(shelf().cards_json);
    assert.equal(mid['Sol Ring'].qty, 3, 'the saved shelf is still there, mid-re-import');
    assert.equal(shelf().entries, 1);

    held();
    await done;
    assert.equal(shelf().entries, 500, 'and the new one replaces it once it has landed');
  });
});
