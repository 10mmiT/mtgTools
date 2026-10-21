/* Switching decks in the middle of something.
 *
 * The Deck Builder holds one deck at a time in a handful of globals — dbDeck,
 * dbCards, dbCats — and three things used to read those globals *after* an
 * await, by when the mat could be showing a different deck:
 *
 *   the autosave   an edit schedules a write 800 ms out, and the write read
 *                  whatever deck was open when it fired — so an edit to one
 *                  deck followed by a switch wrote its cards into the next
 *   the load       opening a deck set dbDeck before its cards arrived and
 *                  never asked afterwards whether it was still wanted, so a
 *                  slow load (or a slow Archidekt import) could land on a deck
 *                  opened after it; and a failed load left the last deck's
 *                  cards on the mat for the next edit to save into this one
 *   EDHREC         recommendations asked for one deck arrived on another
 *
 * The shipped deck-builder modules in one vm sandbox, as test/deckdoor.test.js
 * loads them, with the network answered per request — and held, where the test
 * is about what happens while it is out — and the autosave's timer captured
 * rather than run, so the test decides when 800 ms have passed.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const PLAYERS = [
  { id: 'p-tim', name: 'Tim', decks: [
    { id: 'd-a',    name: 'Krenko', commander: 'Krenko, Mob Boss', source: 'manual' },
    { id: 'd-b',    name: 'Tymna',  commander: '',                 source: 'manual' },
    { id: 'd-arch', name: 'Imported', commander: '', source: 'archidekt', deckId: '123' },
  ] },
];

const card = (name, qty = 1) => ({ card_name: name, qty, category: 'Other', board: 'main', position: 0 });
const DECK_CARDS = {
  'd-a':    [card('Sol Ring')],
  'd-b':    [card('Forest', 30)],
  'd-arch': [],
};

/** A promise and the means to settle it, for an answer the test holds. */
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

/** Let every promise that can settle, settle. */
const settle = () => new Promise(r => setImmediate(r));

function loadBuilder() {
  const store = new Map();
  const mat   = { innerHTML: '', classList: { toggle() {} }, addEventListener() {} };
  const sel   = { options: [], value: '', innerHTML: '', appendChild(o) { this.options.push(o); } };
  const els   = {};
  const el = id => (els[id] ||= {
    innerHTML: '', textContent: '', title: '', value: '', style: {},
    setAttribute() {}, getAttribute() {}, addEventListener() {}, appendChild() {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  });

  const calls  = [];
  const timers = [];
  /** Requests the test holds, by URL, until it answers them. */
  const held   = new Map();

  const sandbox = {
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    document: {
      addEventListener() {}, querySelectorAll: () => [],
      createElement: () => ({ value: '', textContent: '', style: {}, appendChild() {} }),
      getElementById: id => (id === 'dbDeckSel' ? sel : id === 'dbDeckContent' ? mat : el(id)),
      body: { appendChild() {}, style: {} },
      scrollingElement: { scrollTop: 0 },
      documentElement:  { scrollTop: 0 },
    },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800 },
    state: { players: JSON.parse(JSON.stringify(PLAYERS)), deckCardCounts: {}, collections: [] },
    myPlayerId: () => 'p-tim',
    currentUser: { username: 'tim', role: 'player', playerId: 'p-tim' },
    isMyPlayer: id => id === 'p-tim',
    confirm: () => true, alert: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    fetch: async (url, opts = {}) => {
      const call = { url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null };
      calls.push(call);
      if (held.has(url)) return held.get(url).promise;
      const deckCards = url.match(/\/decks\/([^/]+)\/cards$/);
      if (deckCards && call.method === 'GET') {
        return reply({ cards: DECK_CARDS[deckCards[1]] || [], categories: [] });
      }
      return reply({ ok: true });
    },
    esc: s => String(s), jsAttr: s => String(s),
    renderMana: () => '', renderPrice: () => '', sfCardOwnership: () => '',
    colOwner: () => null, playerColor: () => '', renderPlayers() {}, savePlayerDecks: async () => true,
    scryfallMetaCache: new Map(), openCardByName() {},
    animateCardMove: (_el, paint) => paint(),
    console,
  };
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  for (const file of ['sortui.js', 'cardstack.js', 'owned.js', 'cardturn.js', 'deckview-boards.js',
                      'deckview-core.js', 'deckview-render.js', 'deckview-edit.js',
                      'deckview-panels.js', 'deckview-history.js', 'deckview-owned.js',
                      'deckview-totals.js', 'deckview-legality.js', 'deckview-mana.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  return {
    run, answer, mat, el, calls,
    /** Hold the next request for `url` until the test answers it. */
    hold(url) { const d = deferred(); held.set(url, d); return d; },
    /** The autosave's 800 ms, passed: every write still waiting goes. */
    async elapse() {
      for (const t of timers.filter(t => t.ms === 800 && !t.cleared)) { t.cleared = true; t.fn(); }
      await settle();
    },
    puts: () => calls.filter(c => c.method === 'PUT' && /\/cards$/.test(c.url)),
    onMat: () => answer('dbCards.map(c => c.card_name)'),
  };
}

const CARDS_OF = deck => `/api/players/p-tim/decks/${deck}/cards`;

// ── The autosave ──────────────────────────────────────────────────────────

test('an edit made just before switching is written to the deck it was made on, first', async () => {
  const tab = loadBuilder();
  await tab.run(`dbSelectDeck('p-tim|d-a')`);
  tab.run(`dbCards[0].qty = 3; dbScheduleSave()`);   // inside the 800 ms

  await tab.run(`dbSelectDeck('p-tim|d-b')`);

  const puts = tab.puts();
  assert.deepStrictEqual(puts.map(p => p.url), [CARDS_OF('d-a')],
    'the edit was not written, or was written to the deck opened after it');
  assert.deepStrictEqual(puts[0].body.cards.map(c => [c.card_name, c.qty]), [['Sol Ring', 3]],
    'what was written is not the edit');
  const order = tab.calls.map(c => `${c.method} ${c.url}`);
  assert.ok(order.indexOf(`PUT ${CARDS_OF('d-a')}`) < order.indexOf(`GET ${CARDS_OF('d-b')}`),
    'the next deck was asked for before the last one’s edit had gone');
  assert.deepStrictEqual(tab.onMat(), ['Forest']);

  await tab.elapse();
  assert.strictEqual(tab.puts().length, 1, 'the flushed save went a second time when its timer fired');
});

test('a save that goes out late still goes to the deck it was made on', async () => {
  /* What the flush rests on: the write carries its deck and its cards from
   * the moment the change was made, not from the moment the timer fires. */
  const tab = loadBuilder();
  await tab.run(`dbSelectDeck('p-tim|d-a')`);
  tab.run(`dbCards[0].qty = 4; dbScheduleSave()`);
  tab.run(`dbDeck = { id: 'd-b', playerId: 'p-tim' }; dbCards = [{ card_name: 'Forest', qty: 30, board: 'main' }]`);

  await tab.elapse();
  const puts = tab.puts();
  assert.deepStrictEqual(puts.map(p => p.url), [CARDS_OF('d-a')],
    'the timer wrote to whichever deck happened to be open when it fired');
  assert.deepStrictEqual(puts[0].body.cards.map(c => [c.card_name, c.qty]), [['Sol Ring', 4]]);
});

test('a deck being deleted does not get its waiting edit written back afterwards', async () => {
  const tab = loadBuilder();
  await tab.run(`dbSelectDeck('p-tim|d-a')`);
  tab.run(`dbCards[0].qty = 2; dbScheduleSave()`);
  tab.run(`saveToStorage = async () => true`);
  await tab.run('dbDeleteDeck()');
  await tab.elapse();
  const puts = tab.puts();
  assert.deepStrictEqual(puts.map(p => p.body.cards.length), [0],
    'something other than the wipe was written to the deleted deck');
});

// ── The load ──────────────────────────────────────────────────────────────

test('a load that comes back after another deck was opened is not shown', async () => {
  const tab = loadBuilder();
  const slow = tab.hold(CARDS_OF('d-a'));
  const first = tab.run(`dbSelectDeck('p-tim|d-a')`);
  await settle();
  await tab.run(`dbSelectDeck('p-tim|d-b')`);
  assert.deepStrictEqual(tab.onMat(), ['Forest']);

  slow.resolve(reply({ cards: DECK_CARDS['d-a'], categories: [] }));
  await first;
  assert.strictEqual(tab.run('dbDeck.id'), 'd-b', 'the slower deck took the mat back');
  assert.deepStrictEqual(tab.onMat(), ['Forest'], 'the first deck’s cards landed on the second');
});

test('a failed load leaves nothing of the last deck for the next edit to save into this one', async () => {
  const tab = loadBuilder();
  await tab.run(`dbSelectDeck('p-tim|d-a')`);
  const broken = tab.hold(CARDS_OF('d-b'));
  const opening = tab.run(`dbSelectDeck('p-tim|d-b')`);
  assert.deepStrictEqual(tab.onMat(), [], 'the last deck’s cards were still on the mat while this one loaded');
  broken.resolve(reply({ error: 'nope' }, 500));
  await opening;

  assert.deepStrictEqual(tab.onMat(), [], 'a failed load left the last deck’s cards behind');
  assert.match(tab.mat.innerHTML, /500/, 'the failure was not said');
  // Something added after the failure is not a save over the deck's real list.
  tab.run(`dbCards.push({ card_name: 'Island', qty: 1, board: 'main', category: 'Lands' }); dbScheduleSave()`);
  await tab.elapse();
  await tab.run('_dbSaveNow()');
  assert.deepStrictEqual(tab.puts(), [], 'a deck whose cards never arrived was saved over');
});

test('an Archidekt import that finishes after a switch does not land on the new deck', async () => {
  const tab = loadBuilder();
  const archidekt = tab.hold('/api/archidekt/deck/123');
  const importing = tab.run(`dbSelectDeck('p-tim|d-arch')`);
  await settle();
  assert.ok(tab.calls.some(c => c.url === '/api/archidekt/deck/123'), 'the import never started');

  await tab.run(`dbSelectDeck('p-tim|d-b')`);
  archidekt.resolve(reply({ cards: [{ card: { name: 'Lightning Bolt' }, quantity: 1, categories: ['Instant'] }] }));
  await importing;
  await tab.elapse();

  assert.strictEqual(tab.run('dbDeck.id'), 'd-b');
  assert.deepStrictEqual(tab.onMat(), ['Forest'], 'the import replaced the deck opened after it');
  assert.deepStrictEqual(tab.puts(), [], 'the import was saved — into one deck or the other');
});

// ── EDHREC ────────────────────────────────────────────────────────────────

test('recommendations asked for one deck are not put up on the next', async () => {
  const tab = loadBuilder();
  await tab.run(`dbSelectDeck('p-tim|d-a')`);
  const url = `/api/edhrec/commander/${encodeURIComponent('Krenko, Mob Boss')}`;
  const edhrec = tab.hold(url);
  const asking = tab.run('dbLoadEdhrec()');
  await settle();
  assert.ok(tab.calls.some(c => c.url === url), 'EDHREC was never asked');

  await tab.run(`dbSelectDeck('p-tim|d-b')`);
  edhrec.resolve(reply({ container: { json_dict: { cardlists: [
    { tag: 'topcards', cardviews: [{ name: 'Goblin Chieftain' }] },
  ] } } }));
  await asking;

  assert.strictEqual(tab.run('dbEdhrecData'), null, 'the last deck’s recommendations are this one’s now');
  assert.doesNotMatch(tab.el('dbEdhrecContent').innerHTML, /Goblin Chieftain/,
    'the last deck’s recommendations were drawn over this one');
});
