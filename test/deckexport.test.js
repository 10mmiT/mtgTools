/* What an exported deck says about which printing it runs.
 *
 * A deck leaves the app three ways — the clipboard, a .txt and a .csv — and all
 * three of them are somebody else's input: Archidekt's, Moxfield's, a proxy
 * printer's, a spreadsheet's. So a card whose printing was chosen has to name
 * that printing in a shape those sites already read, and a card nobody has
 * touched has to go on being a bare name that lets the other side decide.
 *
 * The second half of that is the one worth guarding. Exporting is a feature
 * people already rely on, and a deck in which nobody has chosen anything is
 * every deck that exists today — so what is asserted hardest here is that such
 * a deck leaves byte-for-byte as it always has.
 *
 * Against the shipped files, in the vm sandbox test/deckboards.test.js runs the
 * mat in.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** A printing as the gallery snapshots one, and as a deck row carries it. */
const RAV_SOL_RING = {
  id: '6e9f2eb0-8ca1-4e9d-9f2b-0a1b2c3d4e5f',
  set: 'rav',
  set_name: 'Ravnica: City of Guilds',
  collector_number: '266',
  image: 'https://cards.scryfall.io/normal/rav-sol-ring.jpg',
  price_eur: '4.50',
  chosen_at: '2026-08-14',
};

/** The tab over a deck, with the network, the clipboard and the drawing
 *  surface stubbed. What is downloaded and what is copied are both caught,
 *  because a .txt and a .csv are files the browser never lets a test see. */
function loadTab(cards, cats = ['Ramp', 'Lands']) {
  const mat = { innerHTML: '', classList: { toggle() {} } };
  const els = {};
  const el  = id => (els[id] ||= {
    innerHTML: '', textContent: '', title: '', value: '', style: {},
    setAttribute(k, v) { (this.attrs ||= {})[k] = v; },
    classList: { toggle() {}, add() {}, remove() {} },
  });

  const sandbox = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      addEventListener() {}, querySelectorAll: () => [], createElement: () => el('made'),
      getElementById: id => (id === 'dbDeckContent' ? mat : el(id)),
      body: { appendChild() {}, style: {} },
      scrollingElement: { scrollTop: 0 },
      documentElement:  { scrollTop: 0 },
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    navigator: { clipboard: { writeText: text => { sandbox.copied.push(text); return Promise.resolve(); } } },
    isMyPlayer: id => id === 'p1',
    confirm: () => true,
    alert: () => {},
    clearTimeout() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    copied: [],
    esc: s => String(s),
    jsAttr: s => String(s),
    renderMana: () => '', renderPrice: () => '', sfCardOwnership: () => '',
    state: { collections: [], players: [] },
    myPlayerId: () => null, colOwner: () => null, playerColor: () => '',
    scryfallMetaCache: new Map(),
    openCardByName() {},
    animateCardMove: (_el, paint) => paint(),
  };
  sandbox.setTimeout = () => 1;
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  for (const file of ['sortui.js', 'cardstack.js', 'deckview-boards.js',
                      'deckview-core.js', 'deckview-render.js',
                      'deckview-edit.js', 'deckview-panels.js', 'deckview-history.js',
                      'deckview-owned.js', 'deckview-totals.js', 'deckview-legality.js',
                      'deckview-mana.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run = expr => vm.runInContext(expr, sandbox);

  run(`dbDeck = { id: 'd1', playerId: 'p1', name: 'A deck', commander: '' }`);
  run(`dbCards = ${JSON.stringify(cards.map((c, i) => ({ qty: 1, board: 'main', position: i, ...c })))}`);
  run(`dbCats = ${JSON.stringify(cats.map((name, i) => ({ name, position: i })))}`);
  run(`dbShownBoards = new Set()`);
  run(`dbCardData = new Map(${JSON.stringify([
    ['Sol Ring',      { name: 'Sol Ring',      type_line: 'Artifact', cmc: 1, color_identity: [] }],
    ['Arcane Signet', { name: 'Arcane Signet', type_line: 'Artifact', cmc: 2, color_identity: [] }],
    ['Krark',         { name: 'Krark',         type_line: 'Legendary Creature — Goblin', cmc: 3, color_identity: ['R'] }],
  ])})`);

  /* What the .txt and the .csv are made of. _dbDownload is the last thing
     either of them does and the browser is on the other side of it, so it is
     replaced here rather than stubbed further out. */
  run(`_dbDownload = (filename, content, type) => { downloads.push({ filename, content, type }); }`);
  const downloads = [];
  sandbox.downloads = downloads;

  return {
    run,
    text:      () => run('_dbExportText()'),
    csv:       () => { run('dbExportCsv()'); return downloads[downloads.length - 1].content; },
    txt:       () => { run('dbExportTxt()'); return downloads[downloads.length - 1]; },
    clipboard: () => { run('dbExportClipboard()'); return sandbox.copied[sandbox.copied.length - 1]; },
  };
}

/* A deck of two Ramp cards, one of which the deck has chosen a printing of.
   The other is what every card in every deck looks like today. */
const DECK = [
  { card_name: 'Sol Ring',      category: 'Ramp', printing: RAV_SOL_RING },
  { card_name: 'Arcane Signet', category: 'Ramp' },
];

const PLAIN = [
  { card_name: 'Sol Ring',      category: 'Ramp' },
  { card_name: 'Arcane Signet', category: 'Ramp' },
];

// ── The list ──────────────────────────────────────────────────────────────

test('a card whose printing was chosen exports as that printing', () => {
  // The shape every site that reads one of these lists already parses.
  const text = loadTab(DECK).text();
  assert.ok(text.includes('1 Sol Ring (RAV) 266'), text);
});

test('and a card nobody has touched exports as a bare name', () => {
  // Which is the whole of what it says: pick the printing yourselves.
  const text = loadTab(DECK).text();
  assert.ok(text.includes('1 Arcane Signet\n'), text);
  assert.ok(!/Arcane Signet \(/.test(text), 'a card with no chosen printing named one');
});

test('a deck nobody has chosen a printing in exports exactly what it did before', () => {
  assert.strictEqual(loadTab(PLAIN).text(), '// Ramp\n1 Sol Ring\n1 Arcane Signet\n');
});

test('the commander at the head of the list names its printing too', () => {
  // It is exported first and under its own heading, and it is a card in the
  // deck like the rest — so it is chosen for like the rest.
  const tab = loadTab([
    { card_name: 'Krark', category: 'Ramp', board: 'commander', printing: { ...RAV_SOL_RING, set: 'mh2', collector_number: '134' } },
    ...DECK,
  ]);
  assert.ok(tab.text().startsWith('// Commander\n1 Krark (MH2) 134\n'), tab.text());
});

test('the clipboard copies the same list the file does', () => {
  const tab = loadTab(DECK);
  assert.strictEqual(tab.clipboard(), tab.text());
  assert.strictEqual(tab.txt().content, tab.text());
});

// ── The spreadsheet ───────────────────────────────────────────────────────

test('the csv carries the set and the collector number in columns of their own', () => {
  const rows = loadTab(DECK).csv().split('\n');
  assert.strictEqual(rows[0], 'qty,name,set,collector_number');
  assert.strictEqual(rows[1], '1,"Sol Ring",RAV,266');
});

test('and leaves them blank where nothing was chosen, so every row is the same width', () => {
  // A spreadsheet whose rows have different widths is worse than one with
  // blanks in it: the blanks are read by everything that opens a .csv.
  const rows = loadTab(DECK).csv().split('\n');
  assert.strictEqual(rows[2], '1,"Arcane Signet",,');
  assert.ok(rows.every(r => r.split(',').length === 4), rows.join('\n'));
});

// ── And back in again ─────────────────────────────────────────────────────

test('a list this app wrote is a list this app can read back', () => {
  /* The export is a clipboard away from the paste box, and a round trip
     through the two of them is the commonest thing anybody does with either.
     A named printing is read and dropped: an import adds cards by name, as it
     always has — but it must not add a card called "Sol Ring (RAV) 266", which
     is a card that does not exist. */
  const tab = loadTab(DECK);
  const parsed = tab.run(`JSON.stringify(_dbParseTextList(_dbExportText()))`);
  assert.deepStrictEqual(JSON.parse(parsed), [
    { name: 'Sol Ring',      qty: 1, category: 'Ramp' },
    { name: 'Arcane Signet', qty: 1, category: 'Ramp' },
  ]);
});

test('and a card whose own name ends in brackets keeps them', () => {
  // Un-sets name cards things like this. What is stripped is a set code and a
  // collector number, not everything in brackets.
  const parsed = loadTab(DECK).run(
    `JSON.stringify(_dbParseTextList('1 Erase (Not the Urza\\'s Legacy One)'))`);
  assert.strictEqual(JSON.parse(parsed)[0].name, "Erase (Not the Urza's Legacy One)");
});

test('a card whose name has a quote in it is still quoted the way it always was', () => {
  // The columns are new; the escaping is not, and nothing here may change it.
  const csv = loadTab([{ card_name: 'Yawgmoth, Thran "Physician"', category: 'Ramp' }]).csv();
  assert.ok(csv.includes('1,"Yawgmoth, Thran ""Physician""",,'), csv);
});
