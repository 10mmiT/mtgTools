/* The offer to re-import a shelf that does not know its printings.
 *
 * Every collection in existence starts out not knowing which printings it
 * holds — the data was never stored, so there is nothing on disk to recover
 * it from. The Printings column says so, card by card, and that is where the
 * feature would end badly: a column reading "unknown" down its whole length
 * with nothing anywhere saying what to do about it, so the honest answer
 * looks like a broken one.
 *
 * So the failures this file exists to prevent are:
 *
 *   nothing offers      a shelf full of unknowns and no way to fix it that
 *                       does not involve knowing the ⋯ menu has a Refresh
 *   it never stops      an offer still there after it has been acted on, or
 *                       one on a shelf a re-import cannot help, is a nag
 *                       rather than an offer
 *   it is not yours     starting a four-minute job against somebody else's
 *                       collection because a button was in front of you
 *   it starts itself    a server that boots and quietly begins re-importing
 *                       every shelf it has
 *
 * Two layers, both against the shipped files:
 *
 *   the tab    js/collections.js in a vm sandbox, as
 *              test/collectionprintings.test.js runs it, with the network
 *              recorded rather than stubbed away — what is asserted is the
 *              request the offer actually makes
 *   the boot   available-db.js and collection-import.js opened over a
 *              database with an import in it, to assert that opening them
 *              starts nothing
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── The tab ───────────────────────────────────────────────────────────────
/* The same sandbox test/collectionprintings.test.js drives, with one
 * difference: fetch records what it was asked for instead of answering
 * nothing. The answer is deliberately the thinnest a server may legally
 * give — `{ ok: true }`, with no list of imports in it — because an offer
 * that only goes away once the server has said something is an offer that is
 * still on screen when somebody presses it twice. */
function loadTab({ collections, players, user, remembered } = {}) {
  const store = new Map();
  const els   = new Map();
  const calls = [];

  // Open mode's idea of who you are: the name typed into Available@'s "Who
  // are you?" bar, kept in this browser and matched to a player by name.
  if (remembered) store.set('avail_name', remembered);

  const fakeEl = () => {
    const el = {
      innerHTML: '', textContent: '', title: '', value: '', disabled: false,
      dataset: {}, attrs: {}, classes: new Set(),
      style: { setProperty() {} },
      classList: {
        add:    n => el.classes.add(n),
        remove: n => el.classes.delete(n),
        toggle: (n, on) => (on ? el.classes.add(n) : el.classes.delete(n)),
        contains: n => el.classes.has(n),
      },
      setAttribute(k, v) { el.attrs[k] = v; },
      getAttribute(k) { return el.attrs[k]; },
      addEventListener() {}, removeEventListener() {}, focus() {}, click() {},
      querySelector() { return fakeEl(); },
      querySelectorAll() { return []; },
      appendChild() {},
      getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0 }; },
      closest() { return null; },
    };
    return el;
  };
  const el = id => {
    if (!els.has(id)) els.set(id, fakeEl());
    return els.get(id);
  };

  const sandbox = {
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    document: {
      addEventListener() {}, querySelectorAll: () => [], createElement: () => fakeEl(),
      getElementById: el,
      body: { appendChild() {}, style: {} },
      visibilityState: 'visible',
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    console,
    alert() {}, confirm: () => true,
    clearTimeout() {}, setTimeout: fn => 1,
    clearInterval() {}, setInterval: () => 1,
    fetch: async (url, opts) => {
      calls.push({
        url:    String(url),
        method: (opts && opts.method) || 'GET',
        body:   opts && opts.body ? JSON.parse(opts.body) : null,
      });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    renderDeck() {}, openDrawer() {}, closeDrawers() {},
    ensureScryfallImages: async () => {},
    scryfallCache: new Map(), scryfallMetaCache: new Map(),
    deck: null, deckFilter: false,
  };
  vm.createContext(sandbox);
  for (const file of ['state.js', 'sortui.js', 'cardquery.js', 'cardstack.js',
                      'auth.js', 'collections.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run = expr => vm.runInContext(expr, sandbox);

  run(`currentUser = ${JSON.stringify(user || null)}`);
  run(`hydrateState(${JSON.stringify({ players: players || [], collections: collections || [] })})`);
  run(`viewMode = 'list'`);

  return {
    run, el, calls,
    /** The offer strip, drawn: what it says, which shelves it names, and
     *  whether it offers to do the lot in one go. */
    offer() {
      run('renderCollections()');
      const box  = el('colPrintingOffer');
      const html = box.innerHTML;
      return {
        shown: box.style.display !== 'none' && html !== '',
        text:  html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        keys:  [...html.matchAll(/reimportPrintings\('([^']+)'\)/g)].map(m => m[1]),
        all:   /reimportAllPrintings\(\)/.test(html),
      };
    },
    /** The keys of the collections an import was actually started for. */
    started() {
      return calls
        .filter(c => c.method === 'POST' && /\/import$/.test(c.url))
        .map(c => decodeURIComponent(c.url.replace(/^.*\/collections\/(.*)\/import$/, '$1')));
    },
    /** The whole-collection writes, as they went over the wire. */
    saved() {
      return calls.filter(c => c.method === 'POST' && /\/api\/collections$/.test(c.url))
                  .map(c => c.body);
    },
    /** The chip row, drawn — one chip per collection, ⋯ menu and all. */
    chips() { run('renderCollections()'); return el('collectionsChips').innerHTML; },
  };
}

const PLAYERS = [
  { id: 'p-tim', name: 'Tim', decks: [] },
  { id: 'p-sam', name: 'Sam', decks: [] },
];
const AS_TIM   = { username: 'tim',   role: 'player', playerId: 'p-tim' };
const AS_ADMIN = { username: 'admin', role: 'admin',  playerId: 'p-sam' };
// Open mode: no password is set, so there is no logged-in player to be.
const AS_GUEST = { username: 'guest', role: 'player' };

const C21 = { id: 'p-c21', set: 'c21', set_name: 'Commander 2021',
              collector_number: '263', finish: 'nonfoil', lang: 'en', condition: 'NM' };

/** A shelf as the server hands one over, printings materialised and all. */
const shelf = (key, cards, extra = {}) => ({
  key, name: key, source: 'archidekt', id: key.split(':')[1] || '1',
  color: '#a855f7', owner: 'p-tim', cards, ...extra,
});

/** A shelf that has never been re-imported: every copy an unknown. */
const unknownShelf = (key, extra) => shelf(key, {
  'Sol Ring':  { name: 'Sol Ring',  type: 'Artifact', mana: '{1}', qty: 3,
                 printings: [{ id: null, qty: 3 }] },
  'Cultivate': { name: 'Cultivate', type: 'Sorcery', mana: '{2}{G}', qty: 1,
                 printings: [{ id: null, qty: 1 }] },
}, extra);

/** One that has: at least one copy knows what it is. */
const knownShelf = (key, extra) => shelf(key, {
  'Sol Ring': { name: 'Sol Ring', type: 'Artifact', mana: '{1}', qty: 3,
                printings: [{ ...C21, qty: 3 }] },
}, extra);

describe('a shelf that does not know its printings', () => {
  test('offers to re-import itself, by name', () => {
    const tab = loadTab({ collections: [unknownShelf('archidekt:1')], players: PLAYERS, user: AS_TIM });
    const offer = tab.offer();
    assert.equal(offer.shown, true, 'a whole column of “unknown” and nothing offering to fix it');
    assert.deepEqual(offer.keys, ['archidekt:1']);
    assert.match(offer.text, /archidekt:1/, 'the offer does not say which shelf it is about');
  });

  test('says the job runs on the server, which is why closing the page is safe', () => {
    const tab = loadTab({ collections: [unknownShelf('archidekt:1')], players: PLAYERS, user: AS_TIM });
    assert.match(tab.offer().text, /close/i);
  });

  test('acting on it starts a re-import of that collection, from the beginning', async () => {
    const tab = loadTab({ collections: [unknownShelf('archidekt:1')], players: PLAYERS, user: AS_TIM });
    tab.offer();
    await tab.run(`reimportPrintings('archidekt:1')`);
    assert.deepEqual(tab.started(), ['archidekt:1']);
    const [post] = tab.calls.filter(c => c.method === 'POST');
    assert.equal(post.body.restart, true,
      'a resume would merge the new shelf into the stale one and keep every card since removed');
  });

  /* The server has said nothing but `{ ok: true }` at this point — no list of
   * imports, nothing to redraw from. The offer still has to go. */
  test('and the offer goes away the moment it is acted on', async () => {
    const tab = loadTab({ collections: [unknownShelf('archidekt:1')], players: PLAYERS, user: AS_TIM });
    assert.equal(tab.offer().shown, true);
    await tab.run(`reimportPrintings('archidekt:1')`);
    assert.equal(tab.offer().shown, false, 'the offer is still there after being taken');
  });

  test('and one already being imported is not offered again', () => {
    const tab = loadTab({ collections: [unknownShelf('archidekt:1')], players: PLAYERS, user: AS_TIM });
    tab.run(`state.imports = [{ key: 'archidekt:1', name: 'archidekt:1', source: 'archidekt',
                                color: '#a855f7', status: 'running', entries: 10, total: 100 }]`);
    assert.equal(tab.offer().shown, false);
  });

  /* A stopped import is not a shelf with no offer standing — it is one with a
   * Resume in front of it already, and two buttons for one job is worse than
   * one. */
  test('nor is one whose import stopped partway and is waiting to be resumed', () => {
    const tab = loadTab({ collections: [unknownShelf('archidekt:1')], players: PLAYERS, user: AS_TIM });
    tab.run(`state.imports = [{ key: 'archidekt:1', name: 'archidekt:1', source: 'archidekt',
                                color: '#a855f7', status: 'interrupted', entries: 10, total: 100 }]`);
    assert.equal(tab.offer().shown, false);
  });
});

describe('a shelf that does know', () => {
  test('is not offered anything', () => {
    const tab = loadTab({ collections: [knownShelf('archidekt:1')], players: PLAYERS, user: AS_TIM });
    assert.equal(tab.offer().shown, false);
  });

  /* Half a shelf accounted for is a shelf that has been re-imported — the
   * rows Archidekt could not name are the unknowns, and re-importing it again
   * would produce the same ones. */
  test('including one where only some of the copies could be named', () => {
    const part = shelf('archidekt:1', { 'Sol Ring': { name: 'Sol Ring', qty: 3,
      printings: [{ ...C21, qty: 2 }, { id: null, qty: 1 }] } });
    const tab = loadTab({ collections: [part], players: PLAYERS, user: AS_TIM });
    assert.equal(tab.offer().shown, false);
  });

  /* An empty shelf has nothing to know. Offering to spend four minutes
   * discovering that is a button that cannot do anything. */
  test('and neither is an empty one', () => {
    const tab = loadTab({ collections: [shelf('archidekt:1', {})], players: PLAYERS, user: AS_TIM });
    assert.equal(tab.offer().shown, false);
  });
});

describe('a shelf a re-import could not help', () => {
  /* The file is in the browser and the CSV has no edition column in it. An
   * offer here would be answered by re-picking the file and getting the same
   * unknowns back — a nag with no end. */
  test('a CSV collection is not offered one, because the export cannot say', () => {
    const csv = unknownShelf('csv:1', { source: 'csv-archidekt', id: null });
    const tab = loadTab({ collections: [csv], players: PLAYERS, user: AS_TIM });
    assert.equal(tab.offer().shown, false);
  });

  /* Nor is a Moxfield one, for the same reason: nothing can fetch it — their
   * API answers 403 to this server — so its way back onto the shelf is the
   * export, which is a file somebody chooses. That is the ⋯ menu's, below. */
  test('nor is a Moxfield one, whose way back is a file rather than a press', () => {
    const mox = unknownShelf('moxfield:1', { source: 'moxfield' });
    const tab = loadTab({ collections: [mox], players: PLAYERS, user: AS_TIM });
    assert.equal(tab.offer().shown, false);
  });
});

// ── The shelves Moxfield left behind ─────────────────────────────────
/* A `moxfield` shelf was imported by the tab itself, back when the tab did
 * the fetching. Nothing can create one any more and nothing can fetch one, so
 * what is left is the shelves themselves — and the failure to prevent is the
 * one the way out used to have: downloading the export and importing it lands
 * a *second* collection under a `csv:` key of its own, sitting beside the one
 * it was meant to replace. Fixing a shelf must not mean deleting your own.
 *
 * So the export goes onto the shelf that asked for it, keeping the key it has
 * always had — and everything hanging off that key, which is its name, its
 * colour and whose it is. The cards and the printings are the file's.
 */
describe('a Moxfield shelf, from before their API refused this server', () => {
  const MOX_HEAD = '"Count","Tradelist Count","Name","Edition","Condition","Language",'
    + '"Foil","Tags","Last Modified","Collector Number","Alter","Proxy","Purchase Price"';
  const MOX_EXPORT = [MOX_HEAD,
    '"1","1","Sol Ring","blc","Near Mint","English","","","2025-07-28 11:08:05.310000","129","False","False",""',
    '"3","1","Sol Ring","tdc","Near Mint","English","","","2025-08-06 10:03:40.507000","106","False","False",""',
    '"1","1","Cultivate","c21","Near Mint","English","foil","","2025-08-06 10:03:40.507000","263","False","False",""',
  ].join('\n') + '\n';

  /** The shelf as it has sat in the database for a year: a Moxfield source, a
   *  key naming the collection it was fetched from, and no printings. */
  const moxShelf = () => unknownShelf('moxfield:abc', {
    source: 'moxfield', id: 'abc', name: 'Tim’s Moxfield box', color: '#3b82f6',
  });

  /** The tab with that shelf on it, and the export chosen for it. */
  async function reimported() {
    const tab = loadTab({ collections: [moxShelf()], players: PLAYERS, user: AS_TIM });
    tab.run(`updateCollection('moxfield:abc')`);
    await tab.run(`importCsvText(${JSON.stringify(MOX_EXPORT)}, 'moxfield_haves.csv')`);
    return tab;
  }

  test('is offered the export in its ⋯ menu, not a Refresh that cannot work', () => {
    const chips = loadTab({ collections: [moxShelf()], players: PLAYERS, user: AS_TIM }).chips();
    assert.match(chips, /Re-import CSV/);
    assert.doesNotMatch(chips, /Refresh/,
      'the menu still offers to fetch a collection nothing can fetch');
  });

  test('and taking it asks for a file rather than starting an import', async () => {
    const tab = loadTab({ collections: [moxShelf()], players: PLAYERS, user: AS_TIM });
    await tab.run(`updateCollection('moxfield:abc')`);
    assert.deepEqual(tab.started(), [], 'a four-minute job that answers 403');
    assert.equal(tab.run('pendingCsvKey'), 'moxfield:abc',
      'the file picker was not told which shelf the file is for');
  });

  test('the export lands on that shelf and does not become a second one', async () => {
    const tab = await reimported();
    assert.deepEqual(tab.saved().map(c => c.key), ['moxfield:abc']);
    assert.equal(tab.run('state.collections.length'), 1,
      'fixing a shelf left a copy of it beside the original');
  });

  test('keeping its name, its colour and whose it is', async () => {
    const [saved] = (await reimported()).saved();
    assert.equal(saved.name,  'Tim’s Moxfield box');
    assert.equal(saved.color, '#3b82f6');
    assert.equal(saved.owner, 'p-tim');
  });

  /* The shelf is what the file says it is once the file has been read: a CSV
   * shelf, with no collection on somebody's server behind it any more. */
  test('and stopping being a Moxfield shelf on the way', async () => {
    const [saved] = (await reimported()).saved();
    assert.equal(saved.source, 'csv-moxfield');
    assert.equal(saved.id, null, 'a shelf that comes from a file has no id to fetch');
  });

  test('the cards and the printings are the export’s own', async () => {
    const [saved] = (await reimported()).saved();
    const sol = saved.cards['Sol Ring'];
    assert.equal(sol.qty, 4);
    assert.deepEqual(sol.printings.map(p => [p.set, p.collector_number, p.qty]),
      [['blc', '129', 1], ['tdc', '106', 3]]);
    assert.equal(saved.cards['Cultivate'].printings[0].finish, 'foil');
  });

  test('and the breakdown still sums to the quantity', async () => {
    const [saved] = (await reimported()).saved();
    for (const [name, card] of Object.entries(saved.cards)) {
      const total = (card.printings || []).reduce((n, p) => n + p.qty, 0);
      assert.equal(total, card.qty,
        `${name}: the breakdown says ${total} copies and the quantity says ${card.qty}`);
    }
  });

  /* The other half of the same rule: a shelf that *can* be fetched still is,
   * and pressing its Refresh does not open a file picker. */
  test('while an Archidekt shelf refreshes from Archidekt as it always did', async () => {
    const tab = loadTab({ collections: [unknownShelf('archidekt:1')], players: PLAYERS, user: AS_TIM });
    assert.match(tab.chips(), /Refresh/);
    await tab.run(`updateCollection('archidekt:1')`);
    assert.deepEqual(tab.started(), ['archidekt:1']);
    assert.equal(tab.run('pendingCsvKey'), null);
  });
});

describe('whose shelf it is', () => {
  test('somebody else’s is not offered — it is their time being spent', () => {
    const theirs = unknownShelf('archidekt:2', { owner: 'p-sam' });
    const tab = loadTab({ collections: [theirs], players: PLAYERS, user: AS_TIM });
    assert.equal(tab.offer().shown, false);
  });

  test('the group’s is, because it is nobody’s in particular', () => {
    const groups = unknownShelf('archidekt:3', { owner: null });
    const tab = loadTab({ collections: [groups], players: PLAYERS, user: AS_TIM });
    assert.deepEqual(tab.offer().keys, ['archidekt:3']);
  });

  test('an admin is offered every one of them', () => {
    const tab = loadTab({
      collections: [unknownShelf('archidekt:1'), unknownShelf('archidekt:2', { owner: 'p-sam' })],
      players: PLAYERS, user: AS_ADMIN,
    });
    assert.deepEqual(tab.offer().keys, ['archidekt:1', 'archidekt:2']);
  });

  /* An app that cannot say who you are makes no ownership distinction at all
   * — the scope control is not even mounted — so there is no "somebody else"
   * for this rule to protect. */
  test('and where the app cannot say who you are, every shelf is the group’s', () => {
    const tab = loadTab({
      collections: [unknownShelf('archidekt:1'), unknownShelf('archidekt:2', { owner: 'p-sam' })],
      players: PLAYERS, user: null,
    });
    assert.deepEqual(tab.offer().keys, ['archidekt:1', 'archidekt:2']);
  });

  /* Open mode has no logged-in player — everybody is `guest` — so who you are
   * is the name remembered behind Available@'s "Who are you?" bar, which is
   * how every other ownership question on this tab is asked. Asked of the
   * account instead, an app with no accounts would offer nobody their own
   * shelf and everybody nothing. */
  test('and in open mode the remembered name is what makes a shelf yours', () => {
    const tab = loadTab({
      collections: [unknownShelf('archidekt:1'), unknownShelf('archidekt:2', { owner: 'p-sam' })],
      players: PLAYERS, user: AS_GUEST, remembered: 'tim',
    });
    assert.deepEqual(tab.offer().keys, ['archidekt:1']);
  });
});

describe('the bulk action', () => {
  test('is offered once there is more than one shelf to fix', () => {
    const one = loadTab({ collections: [unknownShelf('archidekt:1')], players: PLAYERS, user: AS_TIM });
    assert.equal(one.offer().all, false, 'one shelf does not need a “do them all”');

    const two = loadTab({
      collections: [unknownShelf('archidekt:1'), unknownShelf('archidekt:2', { owner: null })],
      players: PLAYERS, user: AS_TIM,
    });
    assert.equal(two.offer().all, true);
  });

  test('re-imports every shelf that lacks printings, and nothing else', async () => {
    const tab = loadTab({
      collections: [
        unknownShelf('archidekt:1'),
        knownShelf('archidekt:2'),
        unknownShelf('archidekt:3', { owner: null }),
      ],
      players: PLAYERS, user: AS_TIM,
    });
    tab.offer();
    await tab.run(`reimportAllPrintings()`);
    assert.deepEqual(tab.started().sort(), ['archidekt:1', 'archidekt:3']);
  });

  test('leaves somebody else’s shelf alone', async () => {
    const tab = loadTab({
      collections: [unknownShelf('archidekt:1'), unknownShelf('archidekt:2', { owner: 'p-sam' })],
      players: PLAYERS, user: AS_TIM,
    });
    tab.offer();
    await tab.run(`reimportAllPrintings()`);
    assert.deepEqual(tab.started(), ['archidekt:1']);
  });

  test('and takes the whole offer away with it', async () => {
    const tab = loadTab({
      collections: [unknownShelf('archidekt:1'), unknownShelf('archidekt:3', { owner: null })],
      players: PLAYERS, user: AS_TIM,
    });
    assert.equal(tab.offer().shown, true);
    await tab.run(`reimportAllPrintings()`);
    assert.equal(tab.offer().shown, false);
  });
});

describe('the shelf with no offer at all', () => {
  test('draws nothing, rather than an empty box above the table', () => {
    const tab = loadTab({ collections: [knownShelf('archidekt:1')], players: PLAYERS, user: AS_TIM });
    tab.offer();
    assert.equal(tab.el('colPrintingOffer').innerHTML, '');
    assert.equal(tab.el('colPrintingOffer').style.display, 'none');
  });

  test('and a page with no collections on it at all is quiet too', () => {
    const tab = loadTab({ collections: [], players: PLAYERS, user: AS_TIM });
    assert.equal(tab.offer().shown, false);
  });
});

// ── The boot ──────────────────────────────────────────────────────────────
/* Nothing may re-import itself. The offer is the only thing that starts one,
 * and the place that would most plausibly forget it is a server coming back
 * up over a database full of shelves that have no printings: a sweep that
 * "helpfully" picked them up would spend hours of somebody's rate limit
 * without a person asking for a minute of it.
 *
 * So the shipped modules are opened over a database that has both — a shelf
 * with no printings, and an import that was running when the last process
 * died — with fetch counting anything that reaches the network. */
describe('a server that boots over shelves with no printings', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgreimport-'));
  const realFetch = globalThis.fetch;
  let reached = [];

  process.env.DATA_FILE              = path.join(tmpDir, 'state.json');
  process.env.MTGTOOLS_NO_BACKGROUND = '1';

  {
    const Database = require('better-sqlite3');
    const seed = new Database(path.join(tmpDir, 'available.db'));
    seed.exec(`
      CREATE TABLE collections (
        key        TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        source     TEXT NOT NULL,
        col_id     TEXT,
        color      TEXT NOT NULL,
        cards_json TEXT NOT NULL DEFAULT '{}',
        entries    INTEGER NOT NULL DEFAULT 0,
        total      INTEGER,
        saved_at   TEXT
      );
      CREATE TABLE collection_imports (
        key             TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        source          TEXT NOT NULL,
        col_id          TEXT,
        color           TEXT NOT NULL,
        owner_player_id TEXT,
        status          TEXT NOT NULL DEFAULT 'running',
        next_page       INTEGER NOT NULL DEFAULT 1,
        entries         INTEGER NOT NULL DEFAULT 0,
        total           INTEGER,
        cards_json      TEXT NOT NULL DEFAULT '{}',
        error           TEXT,
        started_by      TEXT,
        started_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    seed.prepare(`
      INSERT INTO collections (key, name, source, col_id, color, cards_json, entries, total, saved_at)
      VALUES ('archidekt:1', 'The shelf', 'archidekt', '1', '#a855f7', ?, 1, 3, '2026-01-01T00:00:00.000Z')
    `).run(JSON.stringify({ 'Sol Ring': { name: 'Sol Ring', type: 'Artifact', mana: '{1}', qty: 3 } }));
    seed.prepare(`
      INSERT INTO collection_imports
        (key, name, source, col_id, color, status, next_page, entries, total, cards_json, started_by)
      VALUES ('archidekt:2', 'The box', 'archidekt', '2', '#a855f7', 'running', 40, 1000, 6247, '{}', 'tim')
    `).run();
    seed.close();
  }

  globalThis.fetch = async url => { reached.push(String(url)); return realFetch(url); };
  const { db }  = require('../available-db');
  const imports = require('../collection-import');
  globalThis.fetch = realFetch;

  test('re-imports nothing of its own accord', () => {
    assert.deepEqual(reached, [],
      'loading the server asked Archidekt for something nobody pressed a button for');
    assert.equal(imports._running.size, 0, 'a run this process never started is somehow live');
  });

  test('and the shelf with no printings is still there, unchanged and readable', () => {
    const { readCollectionCards } = require('../available-db');
    const row = db.prepare('SELECT * FROM collections WHERE key = ?').get('archidekt:1');
    const card = readCollectionCards(row.cards_json)['Sol Ring'];
    assert.equal(card.qty, 3, 'the shelf was rewritten by something nobody asked for');
    assert.deepEqual(card.printings, [{ id: null, qty: 3 }]);
  });

  /* The other half of "you can close the page": an import cut off by the
   * process ending keeps the pages it had gathered and the page it reached,
   * and comes back as something to resume rather than as a bar that will
   * never move again. */
  test('an import the last process was running is picked up, not restarted or lost', () => {
    const [imp] = imports.listImports();
    assert.equal(imp.key, 'archidekt:2');
    assert.equal(imp.status, 'interrupted');
    assert.equal(imp.entries, 1000, 'the progress it had made was thrown away');
    assert.equal(imp.page, 40, 'the page it reached is what a resume starts from');
    assert.equal(imp.live, false, 'nothing claims to be working on it');
    assert.equal(imp.startedBy, 'tim');
  });
});
