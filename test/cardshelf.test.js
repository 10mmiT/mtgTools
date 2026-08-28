/* Which printings of this card are on the shelf, read on the card itself.
 *
 * The Collections table summarises — `2× C21, 1× STA ✦` on a row a person is
 * scanning past — and the card is where the detailed answer belongs: every
 * printing held, named in full, beside the gallery that is already there for
 * choosing which one a deck runs.
 *
 * The failure this file exists to prevent is the one the whole printings
 * effort keeps circling. No collection knows its printings until somebody
 * re-imports it, so the common case today is a shelf that holds three copies
 * and cannot say which three. Drawn as an empty list — or as no section at
 * all — that reads as a shelf holding none of the card, which is the app
 * telling somebody their collection has been wiped. It has to say *unknown*,
 * and it has to say it with the copies counted.
 *
 * The second thing held here is whose shelf is being answered for. Ownership
 * has one scope in this app — yours, the group's, everyone's — and a card view
 * that ignored it would answer a question nobody asked, on a page opened from
 * the deck the scope belongs to.
 *
 * One seam: the shipped browser files in a vm sandbox — js/card.js drawing a
 * card over a hydrated state, with js/deckview-owned.js's shelf underneath it,
 * as test/cardprintings.test.js drives the same tab.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* Two printings of Sol Ring as a re-imported shelf records them, and the
   Mystical Archive one is a foil: the copy somebody paid rather more for is
   the one that must not be folded into the ordinary one. */
const C21 = { id: 'p-c21', set: 'c21', set_name: 'Commander 2021',
              collector_number: '263', finish: 'nonfoil', lang: 'en', condition: 'nm' };
const STA = { id: 'p-sta', set: 'sta', set_name: 'Mystical Archive',
              collector_number: '5', finish: 'foil', lang: 'en', condition: 'nm' };

/* The card, as Scryfall answers with it. No rulings and no prints URI, because
   both of those are a fetch this file has no opinion about — what is under
   test is drawn from the shelf and needs no network at all. */
const CARD = {
  id: 'p-c21', name: 'Sol Ring', mana_cost: '{1}', type_line: 'Artifact',
  oracle_text: '{T}: Add {C}{C}.', set: 'c21', set_name: 'Commander 2021',
  collector_number: '263', rarity: 'uncommon',
};

const PLAYERS = [{ id: 'p-tim', name: 'Tim', decks: [] },
                 { id: 'p-ana', name: 'Ana', decks: [] }];
const AS_TIM  = { username: 'tim', role: 'player', playerId: 'p-tim' };

/** A shelf as the server hands one over. */
const shelf = (key, owner, cards) => ({
  key, name: key, source: 'archidekt', color: '#a855f7', owner, cards,
});

/** The copies of one card, as a collection carries them. */
const held = (qty, printings) =>
  ({ 'Sol Ring': { name: 'Sol Ring', type: 'Artifact', qty, printings } });

function loadCard({ collections = [], user = AS_TIM, scope = null } = {}) {
  const els   = new Map();
  const store = new Map();
  const fakeEl = () => ({
    innerHTML: '', textContent: '', title: '', value: '', style: {},
    dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, addEventListener() {}, querySelector: () => null,
    querySelectorAll: () => [], appendChild() {},
  });
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
    },
    window:  { addEventListener() {}, innerWidth: 1440, innerHeight: 900 },
    history: { state: null, pushState() {}, replaceState() {}, back() {} },
    console,
    alert() {}, confirm: () => true, clearTimeout() {}, setTimeout: () => 1,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    scryfallFetch: async () => ({ ok: false }),
    /* Sol Ring has one side; what the picture does with a card that has two is
       test/deckart.test.js's. */
    scryfallBackFace: () => '',
    playerColor: () => '#3b82f6',
    scryfallCache: new Map(), scryfallMetaCache: new Map(),
    ensureScryfallImages: async () => {},
    renderDeck() {}, openDrawer() {}, closeDrawers() {}, setTab() {},
    dbDeck: null, dbCardData: new Map(),
  };
  vm.createContext(sandbox);
  for (const file of ['state.js', 'auth.js', 'sortui.js', 'cardstack.js', 'cardturn.js',
                      'collections.js', 'card.js', 'deckview-owned.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run = expr => vm.runInContext(expr, sandbox);
  run(`currentUser = ${JSON.stringify(user)}`);
  run(`hydrateState(${JSON.stringify({ players: PLAYERS, collections })})`);
  if (scope) store.set(`mtgtools_db_own_scope:${user?.playerId || ''}`, scope);

  return {
    run,
    answer: expr => JSON.parse(run(`JSON.stringify(${expr})`)),
    /** The card, drawn. */
    async draw(card = CARD) {
      await run(`renderCard(${JSON.stringify(card)}, _cardReqSeq, 'cardDetail')`);
      return el('cardDetail').innerHTML;
    },
  };
}

const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/** What the shelf section lists, one string per line, as a person reads them. */
const lines = html => [...html.matchAll(/<li class="card-shelf-row[^"]*">([\s\S]*?)<\/li>/g)]
  .map(m => strip(m[1]));
/** What it says instead of a list, where there is nothing to list. */
const note  = html => strip((html.match(/class="[^"]*card-shelf-note[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [, ''])[1]);
/** The heading, and the line under it saying whose shelf was asked. */
const heading = html => strip((html.match(/card-shelf[^>]*>\s*<div class="section-title">([^<]*)</) || [, ''])[1]);
const whose   = html => strip((html.match(/class="[^"]*card-shelf-scope[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [, ''])[1]);

// ── What the shelf holds ──────────────────────────────────────────────────

test('the card lists the printings of it that are held, and how many of each', async () => {
  const app = loadCard({ collections: [shelf('c:tim', 'p-tim',
    held(3, [{ ...C21, qty: 2 }, { ...STA, qty: 1 }]))] });
  const html = await app.draw();
  assert.deepStrictEqual(lines(html), [
    '2× Commander 2021 (C21) #263',
    '1× Mystical Archive (STA) #5 ✦',
  ]);
});

test('and the foil is not the ordinary copy somebody paid less for', async () => {
  const app = loadCard({ collections: [shelf('c:tim', 'p-tim',
    held(2, [{ ...C21, qty: 1 }, { ...C21, finish: 'foil', qty: 1 }]))] });
  const rows = lines(await app.draw());
  assert.strictEqual(rows.length, 2, 'the foil was counted as an ordinary copy');
  assert.ok(rows.some(r => /✦/.test(r)), 'nothing on the card says one of them is a foil');
});

test('copies of one printing spread over two boxes are one line, added up', async () => {
  const app = loadCard({ collections: [
    shelf('c:a', 'p-tim', held(1, [{ ...C21, qty: 1 }])),
    shelf('c:b', 'p-tim', held(2, [{ ...C21, qty: 2 }])),
  ] });
  assert.deepStrictEqual(lines(await app.draw()), ['3× Commander 2021 (C21) #263']);
});

test('a lightly played German copy is the same printing, not a second one', async () => {
  // Language and condition tell two cards apart in a box and tell nobody
  // anything about which printing they are.
  const app = loadCard({ collections: [shelf('c:tim', 'p-tim', held(2, [
    { ...C21, qty: 1 },
    { ...C21, lang: 'de', condition: 'lp', qty: 1 },
  ]))] });
  assert.deepStrictEqual(lines(await app.draw()), ['2× Commander 2021 (C21) #263']);
});

test('the section says how many copies are on the shelf altogether', async () => {
  const app = loadCard({ collections: [shelf('c:tim', 'p-tim',
    held(3, [{ ...C21, qty: 2 }, { ...STA, qty: 1 }]))] });
  assert.match(heading(await app.draw()), /3/);
});

test('and it sits with the gallery that chooses a printing, not away from it', async () => {
  const app  = loadCard({ collections: [shelf('c:tim', 'p-tim', held(1, [{ ...C21, qty: 1 }]))] });
  const html = await app.draw();
  assert.ok(html.indexOf('card-shelf') < html.indexOf('cardDetail-prints'),
    'the shelf is drawn somewhere other than beside the printings gallery');
});

// ── The shelf that cannot say ─────────────────────────────────────────────
// Every collection in existence, until somebody re-imports it.

test('a shelf that has not been re-imported says so, and counts the copies', async () => {
  const app = loadCard({ collections: [shelf('c:tim', 'p-tim', held(3, [{ id: null, qty: 3 }]))] });
  const html = await app.draw();
  assert.deepStrictEqual(lines(html), ['3× unknown printing']);
  assert.doesNotMatch(note(html), /No copies/,
    'a shelf holding three copies read as a shelf holding none');
});

test('a card carrying no breakdown at all is unknown, never owned-none', async () => {
  // A collection the browser built itself — a CSV parsed in this tab — has
  // never been near the server's shape helpers and has no field to read.
  const app = loadCard({ collections: [shelf('c:tim', 'p-tim',
    { 'Sol Ring': { name: 'Sol Ring', qty: 2 } })] });
  assert.deepStrictEqual(lines(await app.draw()), ['2× unknown printing']);
});

test('half an answer is drawn as half an answer', async () => {
  const app = loadCard({ collections: [shelf('c:tim', 'p-tim',
    held(3, [{ ...C21, qty: 2 }, { id: null, qty: 1 }]))] });
  assert.deepStrictEqual(lines(await app.draw()), [
    '2× Commander 2021 (C21) #263',
    '1× unknown printing',
  ]);
});

test('and where there is no shelf at all, the card says nothing about one', async () => {
  /* A collection nobody has loaded is not a shelf holding none of the card:
     it is no shelf. Saying "no copies" there would report the absence of
     collections as a fact about the card, on every card in the app. */
  const html = await loadCard({ collections: [] }).draw();
  assert.doesNotMatch(html, /card-shelf/);
  assert.match(html, /Other Printings/, 'and the rest of the card is still drawn');
});

test('a card nobody has says that, rather than a list of nothing', async () => {
  const app  = loadCard({ collections: [shelf('c:tim', 'p-tim', {})] });
  const html = await app.draw();
  assert.deepStrictEqual(lines(html), []);
  assert.match(note(html), /No copies/);
});

// ── Whose shelf ───────────────────────────────────────────────────────────

test('somebody else’s box is not on your shelf', async () => {
  const app = loadCard({ scope: 'mine', collections: [
    shelf('c:tim', 'p-tim', held(1, [{ ...C21, qty: 1 }])),
    shelf('c:ana', 'p-ana', held(2, [{ ...STA, qty: 2 }])),
  ] });
  assert.deepStrictEqual(lines(await app.draw()), ['1× Commander 2021 (C21) #263']);
});

test('and it is on everyone’s', async () => {
  const app = loadCard({ scope: 'all', collections: [
    shelf('c:tim', 'p-tim', held(1, [{ ...C21, qty: 1 }])),
    shelf('c:ana', 'p-ana', held(2, [{ ...STA, qty: 2 }])),
  ] });
  assert.deepStrictEqual(lines(await app.draw()), [
    '2× Mystical Archive (STA) #5 ✦',
    '1× Commander 2021 (C21) #263',
  ]);
});

test('the card says whose shelf it just answered for', async () => {
  const mine = await loadCard({ scope: 'mine',
    collections: [shelf('c:tim', 'p-tim', held(1, [{ ...C21, qty: 1 }]))] }).draw();
  const all  = await loadCard({ scope: 'all',
    collections: [shelf('c:tim', 'p-tim', held(1, [{ ...C21, qty: 1 }]))] }).draw();
  assert.notStrictEqual(whose(mine), '', 'the card does not say whose shelf it is answering for');
  assert.notStrictEqual(whose(mine), whose(all),
    'two different questions were answered with the same words');
});

test('a card only somebody else has names them rather than saying nobody does', async () => {
  /* The sentence the mat's badges already make: an empty answer scoped to you
     is not "nobody has this", and the person who does is the point. */
  const app = loadCard({ scope: 'mine', collections: [
    shelf('c:tim', 'p-tim', {}),
    shelf('c:ana', 'p-ana', held(2, [{ ...STA, qty: 2 }])),
  ] });
  const html = await app.draw();
  assert.deepStrictEqual(lines(html), []);
  assert.match(html, /Ana/, 'the one person who has it was not named');
});

test('with nobody to be, the shelf is the group’s and the card still answers', async () => {
  // Open mode: no account, no player, and every collection is the group's.
  const app = loadCard({ user: null, collections: [
    shelf('c:one', null, held(2, [{ ...C21, qty: 2 }])),
  ] });
  const html = await app.draw();
  assert.deepStrictEqual(lines(html), ['2× Commander 2021 (C21) #263']);
  assert.notStrictEqual(whose(html), '');
});
