/* What an export actually says about its printings — and what it does not.
 *
 * Archidekt's API carries the printing of every row, and the import records
 * it. The other two ways a collection gets onto a shelf had never been looked
 * at: the CSV parser read two columns, and Moxfield was a shrug. That is the
 * failure this file exists to prevent — a limitation of somebody's export
 * showing up as a column of "unknown" that looks exactly like a bug in the
 * app, and the worse one on the other side of it, a printing invented to
 * fill the gap.
 *
 * So every fixture here is taken from a real export, header line and all:
 *
 *   archidekt-collection-export-2026-05-22.csv   6,004 rows
 *   moxfield_haves_2026-05-15-1049Z.csv          4,314 rows
 *
 * What those two files settled, and what is asserted below:
 *
 *   Archidekt   names the Scryfall ID outright, beside the edition code, the
 *               edition name, the collector number, the finish, the condition
 *               and the language. Nothing is missing from a single row
 *   Moxfield    names the edition and the collector number, the finish, the
 *               condition and the language — and no Scryfall id anywhere. A
 *               set and a number is a printing all the same: it is the same
 *               identity said the other way round
 *   the count   both exports write one row per acquisition, so a card held in
 *               four editions is four rows and the quantities are per row.
 *               The parser used to take the first row of a name and drop the
 *               rest, on the belief that Archidekt repeated an oracle-level
 *               total — it does not, and a shelf of 7,943 copies imported as
 *               5,057
 *
 * Moxfield's *API* settled itself: api2.moxfield.com answers 403 (Cloudflare)
 * to this machine, as it does to any server. A collection URL is refused
 * where it is pasted rather than accepted into a four-minute job that cannot
 * finish.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── The tab ───────────────────────────────────────────────────────────────
/* js/collections.js in a vm sandbox, as test/collectionprintings.test.js runs
 * it. Nothing here draws anything: what is under test is the parse, which is
 * a pure function of the file somebody chose. */
function loadTab() {
  const els = new Map();
  const fakeEl = () => {
    const el = {
      innerHTML: '', textContent: '', title: '', value: '', disabled: false,
      dataset: {}, attrs: {}, classes: new Set(),
      style: { setProperty() {} },
      classList: {
        add: n => el.classes.add(n), remove: n => el.classes.delete(n),
        toggle: (n, on) => (on ? el.classes.add(n) : el.classes.delete(n)),
        contains: n => el.classes.has(n),
      },
      setAttribute(k, v) { el.attrs[k] = v; },
      getAttribute(k) { return el.attrs[k]; },
      addEventListener() {}, removeEventListener() {}, focus() {},
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

  const store = new Map();
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
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    console,
    alert() {}, confirm: () => true, clearTimeout() {}, setTimeout: () => 1,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
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

  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  return {
    run, answer,
    /** A file, imported: the source it was recognised as, and its cards by
     *  name — the shape the tab hands to /api/collections. */
    csv(text) {
      const out = answer(`(() => {
        const { cards, source } = importCSV(${JSON.stringify(text)}, 'export.csv');
        return { source, cards: Object.fromEntries(cards) };
      })()`);
      return out;
    },
    /** What a pasted line is taken for. */
    input: raw => answer(`parseInput(${JSON.stringify(raw)})`),
  };
}

// ── The two exports, as they really come ──────────────────────────────────
/* Header lines copied byte for byte, rows copied from the files named above.
 * Archidekt quotes only what it must; Moxfield quotes every cell. */
const ARK_HEAD = 'Quantity,Name,Finish,Condition,Date Added,Language,Purchase Price,Tags,Edition Name,Edition Code,Multiverse Id,Scryfall ID,Collector Number';
const ARK_ROWS = {
  blc:     '1,Sol Ring,Normal,NM,2026-04-25,EN,,,Bloomburrow Commander,blc,671342,fff440c0-7e6a-46c2-9989-f1b5af20fd44,129',
  eoc:     '2,Sol Ring,Normal,NM,2025-08-06,EN,,,Edge of Eternities Commander,eoc,0,ee6e5a35-fe21-4dee-b0ef-a8f2841511ad,57',
  soc:     '1,Sol Ring,Normal,NM,2026-04-23,EN,,,Secrets of Strixhaven Commander,soc,0,870ec754-a76c-40ea-9b81-81b3dca1f62c,128',
  socAgain:'1,Sol Ring,Normal,NM,2026-04-22,EN,,,Secrets of Strixhaven Commander,soc,0,870ec754-a76c-40ea-9b81-81b3dca1f62c,128',
  bolt:    '3,Lightning Bolt,Normal,NM,2025-08-06,EN,,,Game Night: Free-for-All,gn3,582693,a6de74d2-0668-49c6-a385-bf706bfed8f7,83',
  boltFoil:'1,Lightning Bolt,Foil,NM,2025-08-06,EN,,,Double Masters 2022,2x2,571450,f29ba16f-c8fb-42fe-aabf-87089cb214a7,117',
  etched:  '1,Chance Encounter,Etched,NM,2025-08-06,EN,,,Modern Horizons 2,mh2,526248,49a4b0c9-a35b-4b55-ab27-7246bbca0d16,277',
  comma:   '1,"Abdel Adrian, Gorion\'s Ward",Normal,NM,2025-08-06,EN,,,Commander Legends: Battle for Baldur\'s Gate,clb,570248,4857125b-bd0f-4f09-9d6c-56544834a359,375',
};
const archidekt = (...rows) => [ARK_HEAD, ...rows].join('\n') + '\n';

const MOX_HEAD = '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number","Alter","Proxy","Purchase Price"';
const MOX_ROWS = {
  snc:    '"1","1","A Little Chat","snc","Near Mint","English","","","2025-07-11 18:18:54.040000","47","False","False",""',
  foil:   '"1","1","All Will Be One","one","Near Mint","English","foil","","2025-08-06 10:57:58.917000","352","False","False",""',
  etched: '"1","1","Chance Encounter","mh2","Near Mint","English","etched","","2025-07-10 08:15:57.243000","277","False","False",""',
  comma:  '"1","1","Abdel Adrian, Gorion\'s Ward","clb","Near Mint","English","","","2025-07-28 11:08:05.310000","375","False","False",""',
  ring1:  '"1","1","Sol Ring","blc","Near Mint","English","","","2025-07-28 11:08:05.310000","129","False","False",""',
  ring2:  '"3","1","Sol Ring","tdc","Near Mint","English","","","2025-08-06 10:03:40.507000","106","False","False",""',
};
const moxfield = (...rows) => [MOX_HEAD, ...rows].join('\n') + '\n';

/** The breakdown of one card, and the quantity it has to add up to. */
const card = (out, name) => out.cards[name];
const sums = (out, name) => {
  const c = card(out, name);
  const total = (c.printings || []).reduce((n, p) => n + p.qty, 0);
  assert.equal(total, c.qty,
    `${name}: the breakdown says ${total} copies and the quantity says ${c.qty}`);
  return c;
};

describe('an Archidekt CSV export', () => {
  test('records the printing every row names', () => {
    const out = loadTab().csv(archidekt(ARK_ROWS.blc));
    assert.equal(out.source, 'csv-archidekt');
    assert.deepEqual(sums(out, 'Sol Ring').printings, [{
      id: 'fff440c0-7e6a-46c2-9989-f1b5af20fd44',
      set: 'blc', set_name: 'Bloomburrow Commander', collector_number: '129',
      finish: 'nonfoil', lang: 'EN', condition: 'NM', qty: 1,
    }]);
  });

  /* The row is an acquisition and not a card: eleven Sol Ring rows in the
   * real export hold fourteen copies between them. The parser used to keep
   * the first row of a name and drop the other ten. */
  test('counts every row of a card, not just the first one it meets', () => {
    const out = loadTab().csv(archidekt(ARK_ROWS.blc, ARK_ROWS.eoc, ARK_ROWS.soc));
    assert.equal(sums(out, 'Sol Ring').qty, 4);
    assert.deepEqual(card(out, 'Sol Ring').printings.map(p => [p.set, p.qty]),
      [['blc', 1], ['eoc', 2], ['soc', 1]]);
  });

  /* A played copy and its spare are bought months apart and exported as two
   * rows. They are two copies of one printing, not two printings. */
  test('two rows of the same printing are one entry holding both copies', () => {
    const out = loadTab().csv(archidekt(ARK_ROWS.soc, ARK_ROWS.socAgain));
    const printings = sums(out, 'Sol Ring').printings;
    assert.equal(printings.length, 1, `one printing, got ${JSON.stringify(printings)}`);
    assert.equal(printings[0].qty, 2);
  });

  test('a foil is a finish of its own, not an ordinary copy', () => {
    const out = loadTab().csv(archidekt(ARK_ROWS.bolt, ARK_ROWS.boltFoil));
    assert.equal(sums(out, 'Lightning Bolt').qty, 4);
    assert.deepEqual(card(out, 'Lightning Bolt').printings.map(p => [p.finish, p.qty]),
      [['nonfoil', 3], ['foil', 1]]);
  });

  test('and an etched copy is called what the export calls it', () => {
    const out = loadTab().csv(archidekt(ARK_ROWS.etched));
    assert.equal(card(out, 'Chance Encounter').printings[0].finish, 'etched');
  });

  test('a name with a comma in it survives, printing and all', () => {
    const out = loadTab().csv(archidekt(ARK_ROWS.comma));
    const c = sums(out, "Abdel Adrian, Gorion's Ward");
    assert.equal(c.printings[0].set, 'clb');
    assert.equal(c.printings[0].collector_number, '375');
  });

  /* Columns are read by their header and not by where they sit, because the
   * only promise an export makes is the header line above the rows. */
  test('reads its columns by name rather than by position', () => {
    const head = 'Name,Quantity,Scryfall ID,Collector Number,Edition Code,Finish';
    const out  = loadTab().csv(
      `${head}\nSol Ring,2,fff440c0-7e6a-46c2-9989-f1b5af20fd44,129,blc,Foil\n`);
    assert.equal(out.source, 'csv-archidekt');
    const c = sums(out, 'Sol Ring');
    assert.equal(c.qty, 2);
    assert.deepEqual(c.printings, [{
      id: 'fff440c0-7e6a-46c2-9989-f1b5af20fd44', set: 'blc',
      collector_number: '129', finish: 'foil', qty: 2,
    }]);
  });
});

describe('a Moxfield CSV export', () => {
  /* No Scryfall id in the file, anywhere. A set and a collector number is
   * the same printing said the other way round — it is what Scryfall's own
   * /cards/:set/:number answers to — so it is recorded as one. */
  test('records the edition and collector number it names, id or no id', () => {
    const out = loadTab().csv(moxfield(MOX_ROWS.snc));
    assert.equal(out.source, 'csv-moxfield');
    assert.deepEqual(sums(out, 'A Little Chat').printings, [{
      set: 'snc', collector_number: '47', finish: 'nonfoil',
      lang: 'English', condition: 'Near Mint', qty: 1,
    }]);
  });

  test('the Foil column is a finish, and an empty one is an ordinary copy', () => {
    const out = loadTab().csv(moxfield(MOX_ROWS.snc, MOX_ROWS.foil, MOX_ROWS.etched));
    assert.equal(card(out, 'A Little Chat').printings[0].finish, 'nonfoil');
    assert.equal(card(out, 'All Will Be One').printings[0].finish, 'foil');
    assert.equal(card(out, 'Chance Encounter').printings[0].finish, 'etched');
  });

  test('sums the counts of every row of a card, and splits them by printing', () => {
    const out = loadTab().csv(moxfield(MOX_ROWS.ring1, MOX_ROWS.ring2));
    assert.equal(sums(out, 'Sol Ring').qty, 4);
    assert.deepEqual(card(out, 'Sol Ring').printings.map(p => [p.set, p.collector_number, p.qty]),
      [['blc', '129', 1], ['tdc', '106', 3]]);
  });

  test('a name with a comma in it survives, printing and all', () => {
    const out = loadTab().csv(moxfield(MOX_ROWS.comma));
    const c = sums(out, "Abdel Adrian, Gorion's Ward");
    assert.equal(c.printings[0].set, 'clb');
  });
});

describe('an export that says nothing about its printings', () => {
  /* An older export, or a file somebody made themselves. The copies are
   * still owned; nobody knows which ones they are. */
  test('lands its rows in the unknown entry, with the quantity untouched', () => {
    const out = loadTab().csv('Quantity,Name\n3,Sol Ring\n1,Cultivate\n');
    assert.equal(out.source, 'csv-archidekt');
    assert.deepEqual(sums(out, 'Sol Ring').printings, [{ id: null, qty: 3 }]);
    assert.equal(card(out, 'Cultivate').qty, 1);
  });

  test('and a row with the columns but nothing in them is the same answer', () => {
    const out = loadTab().csv(`${ARK_HEAD}\n2,Sol Ring,Normal,NM,2026-04-25,EN,,,,,,,\n`);
    assert.deepEqual(sums(out, 'Sol Ring').printings, [{ id: null, qty: 2 }]);
  });

  /* Half a printing is not a printing: a set code without a number is a
   * shelf of cards rather than a card, and nothing may be guessed from the
   * name to complete it. */
  test('a set with no collector number is unknown rather than half an answer', () => {
    const out = loadTab().csv('Count,Name,Edition\n1,Sol Ring,blc\n');
    assert.deepEqual(sums(out, 'Sol Ring').printings, [{ id: null, qty: 1 }]);
  });

  test('a file in neither shape is refused rather than half-read', () => {
    const tab = loadTab();
    assert.throws(() => tab.csv('Card,Amount\nSol Ring,3\n'), /Unrecognised CSV/);
  });
});

describe('a Moxfield collection URL', () => {
  /* api2.moxfield.com answers 403 to any server. An import started against
   * it is four minutes of nothing followed by an HTTP status, so the refusal
   * belongs where the URL is pasted — and it has to say where the way in is,
   * or it is only a wall. */
  test('is refused where it is pasted, and says where the export is', () => {
    const parsed = loadTab().input('https://moxfield.com/collection/abc123');
    assert.equal(parsed.source, undefined, 'it was accepted as something to fetch');
    assert.match(parsed.refused, /CSV/);
    assert.match(parsed.refused, /Moxfield/);
  });

  test('an Archidekt URL, and a bare id, are what they always were', () => {
    const tab = loadTab();
    assert.deepEqual(tab.input('https://archidekt.com/collection/702530'),
      { source: 'archidekt', id: '702530' });
    assert.deepEqual(tab.input('702530'), { source: 'archidekt', id: '702530' });
    assert.equal(tab.input('what?'), null);
  });
});
