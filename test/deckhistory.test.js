/* A deck remembering what it used to be (ticket 02, spec-deckbuilder-depth §5).
 *
 * The save path deletes every card row for a deck and re-inserts, on an 800 ms
 * debounce, so the state before a save is gone about a second after it. What
 * is asserted here is the rule that decides when a copy is kept, because that
 * rule is the whole design: snapshot every save and a cap of fifty holds a
 * minute of history, snapshot too rarely and the mis-click you wanted back
 * fell between two rows.
 *
 * So: that a burst of edits leaves one row and not one per save, that the row
 * holds the state from *before* the burst, that the four destructive
 * operations each force one of their own, that the caps evict the right end of
 * the list, and that a restored deck is one whose cards are all in piles it
 * actually has.
 *
 * The server half runs against the real module over a temp database. The
 * browser half runs the shipped public/js/deckview-*.js in a vm sandbox, the
 * way test/carddrag.test.js runs the carry, so these assert on the code the
 * browser is served rather than on a copy of it.
 */

'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const vm     = require('node:vm');

// A database of our own. DATA_FILE names a file whose *directory* becomes the
// data dir, and available-db reads it at require time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtghist-'));
process.env.DATA_FILE = path.join(tmpDir, 'state.json');

const { db }  = require('../available-db');
const history = require('../deck-history');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── A deck, in the database ───────────────────────────────────────────────

const DECK = 'deck-1';

/** Put a deck in the state the save path would leave it in. */
function store(deckId, cards, categories = []) {
  db.transaction(() => {
    db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(deckId);
    db.prepare('DELETE FROM deck_categories WHERE deck_id = ?').run(deckId);
    cards.forEach((c, i) => db.prepare(
      'INSERT INTO deck_cards (deck_id, card_name, qty, category, position, printing) VALUES (?,?,?,?,?,?)'
    ).run(deckId, c.card_name, c.qty ?? 1, c.category ?? '', c.position ?? i,
          c.printing ? JSON.stringify(c.printing) : null));
    categories.forEach((c, i) => db.prepare(
      'INSERT INTO deck_categories (deck_id, name, position) VALUES (?,?,?)'
    ).run(deckId, c.name, c.position ?? i));
  })();
}

const card = (name, category = '', qty = 1) => ({ card_name: name, qty, category });
const cat  = name => ({ name });

const SOL_RING   = card('Sol Ring', 'Ramp');
const DOOM_BLADE = card('Doom Blade', 'Removal');
const FOREST     = card('Forest', 'Lands');
const CATS       = [cat('Ramp'), cat('Removal'), cat('Lands')];

/** Every snapshot of a deck, oldest last, as the panel would be given them. */
const rowsOf = deckId => history.list(deckId).snapshots;
const names  = state => (state.cards || []).map(c => c.card_name).sort();

const SECOND = 1000;
const DAY    = 24 * 60 * 60 * 1000;

beforeEach(() => {
  db.exec('DELETE FROM deck_snapshots; DELETE FROM deck_cards; DELETE FROM deck_categories;');
  history._forget(DECK);
  history._forget('deck-2');
});

// ── Rule 1: one snapshot per editing burst ────────────────────────────────

describe('an editing burst', () => {
  test('a burst of saves leaves one snapshot, not one per save', () => {
    store(DECK, [SOL_RING], CATS);
    const t0 = Date.now();
    // Twelve saves, each a debounce apart — ten seconds of moving cards
    // around, which is the shape of every real minute in the builder.
    for (let i = 0; i < 12; i++) history.noteSave(DECK, t0 + i * 800);
    assert.equal(rowsOf(DECK).length, 1, 'twelve saves are one burst');
  });

  test('and it holds what the deck was before the burst, not after it', () => {
    // The whole point. A snapshot of the state a save *produced* is a copy of
    // something the deck already is; the state it *replaced* is the only one
    // about to stop existing.
    store(DECK, [SOL_RING, DOOM_BLADE], CATS);
    const t0 = Date.now();
    history.noteSave(DECK, t0);
    store(DECK, [SOL_RING], CATS);            // the save this snapshot ran in front of
    history.noteSave(DECK, t0 + 800);

    const [row] = rowsOf(DECK);
    assert.deepEqual(names(history.get(DECK, row.id)), ['Doom Blade', 'Sol Ring']);
  });

  test('a save after the deck has been left alone opens a new burst', () => {
    store(DECK, [SOL_RING], CATS);
    const t0 = Date.now();
    history.noteSave(DECK, t0);
    store(DECK, [SOL_RING, FOREST], CATS);
    history.noteSave(DECK, t0 + history.BURST_IDLE_MS + 1);
    assert.equal(rowsOf(DECK).length, 2, 'coming back to a deck is a new burst');
  });

  test('a gap shorter than the idle is still the same burst', () => {
    store(DECK, [SOL_RING], CATS);
    const t0 = Date.now();
    history.noteSave(DECK, t0);
    store(DECK, [SOL_RING, FOREST], CATS);
    history.noteSave(DECK, t0 + history.BURST_IDLE_MS - 1);
    assert.equal(rowsOf(DECK).length, 1, 'a pause to think is not a new session');
  });

  test('a long session of continuous editing is still one snapshot', () => {
    // The rule that separates this from "one row every thirty seconds": a
    // burst is closed by *idleness*, not by elapsed time, so two hours of
    // steady work is one row rather than two hundred and forty.
    store(DECK, [SOL_RING], CATS);
    const t0 = Date.now();
    for (let i = 0; i < 2 * 60 * 60 / 20; i++) history.noteSave(DECK, t0 + i * 20 * SECOND);
    assert.equal(rowsOf(DECK).length, 1, 'two hours at a save every twenty seconds');
  });

  test('the gap that ends a burst is getting up, not looking something up', () => {
    // The number is the whole write rate, and the write rate is what decides
    // whether a cap of fifty holds a season or a fortnight. Half a minute is
    // how long it takes to read a card's oracle text; a few minutes is how
    // long it takes to leave.
    assert.ok(history.BURST_IDLE_MS >= 2 * 60 * 1000,
      `${history.BURST_IDLE_MS}ms treats a pause to read as a new sitting`);
    assert.ok(history.BURST_IDLE_MS <= 15 * 60 * 1000,
      `${history.BURST_IDLE_MS}ms would fold two evenings' work into one row`);
  });

  test('two decks keep their own bursts', () => {
    store(DECK, [SOL_RING], CATS);
    store('deck-2', [FOREST], CATS);
    const t0 = Date.now();
    history.noteSave(DECK, t0);
    history.noteSave('deck-2', t0 + 100);
    assert.equal(rowsOf(DECK).length, 1);
    assert.equal(rowsOf('deck-2').length, 1, "editing one deck does not open the other's burst");
  });

  test("a deck that has never held a card does not open its history with nothing", () => {
    // A deck's first ever save has no state behind it to keep. A row of
    // nothing at the bottom of every deck's history is noise.
    history.noteSave(DECK, Date.now());
    assert.equal(rowsOf(DECK).length, 0);
  });
});

// ── Rule 2: forced snapshots ──────────────────────────────────────────────

describe('an operation that can lose work', () => {
  const LIVE = { cards: [SOL_RING, DOOM_BLADE, FOREST], categories: CATS };

  test('is snapshotted whatever the burst is doing, and says what it was', () => {
    store(DECK, LIVE.cards, CATS);
    const t0 = Date.now();
    history.noteSave(DECK, t0);                       // a burst is already open
    for (const reason of ['import', 'category', 'move', 'restore']) {
      // Each one carries a slightly different deck, so none of them is
      // deduped against the row before it.
      history.force(DECK, reason, { ...LIVE, cards: [...LIVE.cards, card(`Filler ${reason}`)] }, t0 + 100);
    }
    assert.deepEqual(rowsOf(DECK).map(r => r.reason),
      ['restore', 'move', 'category', 'import', 'edit'],
      'newest first, each tagged with what it was taken in front of');
  });

  test('keeps the state the browser was showing, not the one on disk', () => {
    // The autosave is 800 ms behind the person doing the editing, so a
    // snapshot read back from the database would be a snapshot of a deck
    // nobody has seen since. The client sends what is on screen.
    store(DECK, [SOL_RING], CATS);
    history.force(DECK, 'import', { cards: [SOL_RING, DOOM_BLADE], categories: CATS });
    const [row] = rowsOf(DECK);
    assert.deepEqual(names(history.get(DECK, row.id)), ['Doom Blade', 'Sol Ring']);
  });

  test('is refused a reason nobody has heard of', () => {
    assert.throws(() => history.force(DECK, 'whatever', { cards: [SOL_RING] }), /reason/);
  });

  test('cuts what it is sent down to a deck row', () => {
    // The client is the source here, so this is the boundary. Anything else
    // it puts on a card is not a thing a deck restores.
    history.force(DECK, 'import', {
      cards: [{ card_name: 'Sol Ring', qty: 2, category: 'Ramp', position: 0, mischief: '<script>' }, { qty: 4 }],
      categories: [{ name: 'Ramp', position: 0 }, { position: 1 }],
    });
    const snap = history.get(DECK, rowsOf(DECK)[0].id);
    // The board among them, filled in for a client that named none: a card in
    // a deck is in the deck unless it says otherwise.
    assert.deepEqual(snap.cards,
      [{ card_name: 'Sol Ring', qty: 2, category: 'Ramp', board: 'main', position: 0 }]);
    assert.deepEqual(snap.categories, [{ name: 'Ramp', position: 0 }]);
  });

  test('does not write a second row saying what the row before it says', () => {
    // Two operations in a row with no edit between them: the state is the
    // same state, and a panel row with nothing under "what changed" is a row
    // that wastes one of the fifty.
    store(DECK, LIVE.cards, CATS);
    const t0 = Date.now();
    history.noteSave(DECK, t0);
    history.force(DECK, 'import', LIVE, t0 + SECOND);
    assert.equal(rowsOf(DECK).length, 1);
  });

  test('but takes the row over, because a named operation says more than "editing"', () => {
    store(DECK, LIVE.cards, CATS);
    const t0 = Date.now();
    history.noteSave(DECK, t0);
    assert.equal(rowsOf(DECK)[0].reason, 'edit');
    history.force(DECK, 'category', LIVE, t0 + SECOND);
    const rows = rowsOf(DECK);
    assert.equal(rows.length, 1, 'still one state, so still one row');
    assert.equal(rows[0].reason, 'category', 'and the row now says what happened next');
    assert.equal(rows[0].taken_at, t0, 'taken when the state started being true');
  });

  test('and the save that follows it does not open a burst of its own', () => {
    // Otherwise every import writes two rows: the import's, and an 'edit' for
    // the save the import schedules a moment later.
    store(DECK, [SOL_RING], CATS);
    const t0 = Date.now();
    history.force(DECK, 'import', { cards: [SOL_RING], categories: CATS }, t0);
    store(DECK, [SOL_RING, DOOM_BLADE], CATS);
    history.noteSave(DECK, t0 + 800);
    assert.deepEqual(rowsOf(DECK).map(r => r.reason), ['import']);
  });
});

// ── Which printing the deck ran ───────────────────────────────────────────
// A snapshot selects an explicit column list, so a column that is not named
// there is a column every undo silently drops — and a printing chosen and then
// undone away is the kind of loss nobody reports, because the card is still in
// the deck and only its art has changed back.

describe('a chosen printing', () => {
  const RAV_SOL_RING = {
    id: '6e9f2eb0-8ca1-4e9d-9f2b-0a1b2c3d4e5f',
    set: 'rav',
    set_name: 'Ravnica: City of Guilds',
    collector_number: '266',
    image: 'https://cards.scryfall.io/normal/rav-sol-ring.jpg',
    price_eur: '4.50',
    chosen_at: '2026-08-14',
  };
  const RAVNICA = { ...SOL_RING, printing: RAV_SOL_RING };
  const snapshotOf = deckId => history.get(deckId, rowsOf(deckId)[0].id);

  test('comes back with the deck it was chosen in', () => {
    store(DECK, [RAVNICA, FOREST], CATS);
    history.noteSave(DECK);
    const snap = snapshotOf(DECK);
    assert.deepEqual(snap.cards.find(c => c.card_name === 'Sol Ring').printing, RAV_SOL_RING);
  });

  test('and so does one the browser sent, which is the copy on screen', () => {
    history.force(DECK, 'import', { cards: [RAVNICA, FOREST], categories: CATS });
    assert.deepEqual(snapshotOf(DECK).cards.find(c => c.card_name === 'Sol Ring').printing,
      RAV_SOL_RING);
  });

  test('while a card that is only a name carries nothing at all', () => {
    /* Absent rather than null, on both paths. A deck nobody has chosen a
     * printing in snapshots exactly the bytes it snapshotted before this
     * existed, which is what keeps the panel from showing a change nobody
     * made on the day the column arrived. */
    store(DECK, [SOL_RING], CATS);
    history.noteSave(DECK);
    assert.deepEqual(snapshotOf(DECK).cards,
      [{ card_name: 'Sol Ring', qty: 1, category: 'Ramp', board: 'main', position: 0 }]);
  });

  test('read off the database and sent by the browser are the same state', () => {
    /* The two paths into a snapshot are readDeck, where a printing is the
     * column's text, and normaliseState, where it is the client's object. If
     * they serialise differently then every forced snapshot writes a row
     * against a state that has not changed — and a restore hands the browser
     * back a printing of the wrong kind, which it would then save. */
    store(DECK, [RAVNICA, FOREST], CATS);
    const t0 = Date.now();
    history.noteSave(DECK, t0);
    history.force(DECK, 'import', { cards: [RAVNICA, FOREST], categories: CATS }, t0 + SECOND);
    assert.equal(rowsOf(DECK).length, 1, 'the same deck was recorded twice over');
  });

  test('is trimmed to its shape whichever way it arrives', () => {
    // The client is the boundary here as it is for the rest of a card row:
    // what a snapshot holds is a printing, not whatever was posted.
    history.force(DECK, 'import', {
      cards: [{ ...RAVNICA, printing: { ...RAV_SOL_RING, oracle_text: 'T: Add C.' } }],
      categories: CATS,
    });
    assert.deepEqual(snapshotOf(DECK).cards[0].printing, RAV_SOL_RING);
  });

  test('and something that is not one is no printing at all', () => {
    history.force(DECK, 'import', {
      cards: [{ ...SOL_RING, printing: 'the Ravnica one' }], categories: CATS,
    });
    assert.equal('printing' in snapshotOf(DECK).cards[0], false);
  });
});

// ── The caps ──────────────────────────────────────────────────────────────

describe('the caps', () => {
  /** n snapshots, each a day apart, each a different deck. */
  function fill(n, { spacing = DAY, until = Date.now() } = {}) {
    for (let i = n - 1; i >= 0; i--) {
      history.force(DECK, 'edit', { cards: [card(`Card ${i}`)], categories: CATS }, until - i * spacing);
    }
  }

  test('a deck keeps the newest fifty and drops the rest', () => {
    fill(history.MAX_PER_DECK + 10, { spacing: SECOND });
    const rows = rowsOf(DECK);
    assert.equal(rows.length, history.MAX_PER_DECK);
    assert.equal(history.get(DECK, rows[0].id).cards[0].card_name, 'Card 0',
      'the newest is the one kept');
  });

  test('and drops the oldest, not whichever the database returned first', () => {
    fill(3, { spacing: SECOND });
    const before = rowsOf(DECK).map(r => r.taken_at);
    fill(history.MAX_PER_DECK, { spacing: SECOND, until: Date.now() + 60 * SECOND });
    const after = rowsOf(DECK).map(r => r.taken_at);
    for (const t of before) assert.ok(!after.includes(t), 'an old row survived the cap');
  });

  test('anything older than ninety days goes', () => {
    const now = Date.now();
    fill(20, { spacing: 10 * DAY, until: now });   // 20 rows spanning 200 days
    history.prune(DECK, now);
    const rows = rowsOf(DECK);
    assert.ok(rows.length < 20, 'nothing was pruned by age at all');
    for (const row of rows.slice(0, -history.AGE_FLOOR)) {
      assert.ok(now - row.taken_at <= history.MAX_AGE_MS, 'a row older than the age cap survived');
    }
  });

  test('but never the last few, however old the deck is', () => {
    // The alternative is that a deck nobody has opened since spring answers
    // "what did this used to be" with nothing at all, which is the one thing
    // this table exists to prevent.
    const now = Date.now();
    fill(3, { spacing: DAY, until: now - 300 * DAY });
    history.prune(DECK, now);
    assert.equal(rowsOf(DECK).length, 3, 'a whole history older than the cap was wiped');
  });

  test('and one deck is not capped out by another deck being busy', () => {
    fill(history.MAX_PER_DECK + 10, { spacing: SECOND });
    history.force('deck-2', 'edit', { cards: [FOREST], categories: CATS });
    assert.equal(rowsOf('deck-2').length, 1);
  });
});

// ── The deck being deleted ────────────────────────────────────────────────

describe('a deleted deck', () => {
  test('leaves one row saying what it was, and nothing else behind', () => {
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) {
      history.force(DECK, 'edit', { cards: [card(`Card ${i}`)], categories: CATS }, t0 - (5 - i) * DAY);
    }
    history.force('deck-2', 'edit', { cards: [FOREST], categories: CATS }, t0);

    history.deckDeleted(DECK, { cards: [SOL_RING, FOREST], categories: CATS }, t0);

    const rows = rowsOf(DECK);
    assert.equal(rows.length, 1, "a deleted deck's history goes with it");
    assert.equal(rows[0].reason, 'deck-delete');
    assert.deepEqual(names(history.get(DECK, rows[0].id)), ['Forest', 'Sol Ring'],
      'and what is left is the deck as it went');
    assert.equal(rowsOf('deck-2').length, 1, "another deck's history is not touched");
  });

  test('and the wipe that follows does not overwrite that row', () => {
    // dbDeleteDeck() empties the deck through the ordinary save path straight
    // afterwards. If that save opened a burst it would snapshot the deck
    // being deleted a second time, and the row worth keeping would be one of
    // fifty rather than the one.
    const t0 = Date.now();
    history.deckDeleted(DECK, { cards: [SOL_RING], categories: CATS }, t0);
    store(DECK, [SOL_RING], CATS);
    history.noteSave(DECK, t0 + 100);
    assert.deepEqual(rowsOf(DECK).map(r => r.reason), ['deck-delete']);
  });

  test('a deck deleted having never been built leaves nothing at all', () => {
    history.deckDeleted(DECK, { cards: [], categories: [] }, Date.now());
    assert.equal(rowsOf(DECK).length, 0);
  });
});

// ── What changed ──────────────────────────────────────────────────────────

describe('the panel’s diff', () => {
  test('says what arrived, what left, what moved and what changed count', () => {
    const before = {
      cards: [SOL_RING, DOOM_BLADE, card('Island', 'Lands', 4)],
      categories: CATS,
    };
    const after = {
      cards: [SOL_RING, card('Doom Blade', 'Interaction'), card('Island', 'Lands', 7), FOREST],
      categories: [...CATS, cat('Interaction')],
    };
    const d = history.diff(before, after);
    assert.deepEqual(d.added.map(c => c.name), ['Forest']);
    assert.deepEqual(d.removed, []);
    assert.deepEqual(d.moved,
      [{ name: 'Doom Blade', from: 'Removal', to: 'Interaction', board: 'main' }]);
    assert.equal(d.qty, 1, 'Island went from four to seven');
    assert.deepEqual(d.categoriesAdded, ['Interaction']);
    assert.deepEqual(d.categoriesRemoved, []);
  });

  test('is each row against the row below it, so it reads as what happened next', () => {
    const t0 = Date.now();
    history.force(DECK, 'edit', { cards: [SOL_RING], categories: CATS }, t0);
    history.force(DECK, 'import', { cards: [SOL_RING, FOREST], categories: CATS }, t0 + SECOND);

    const rows = rowsOf(DECK);
    assert.deepEqual(rows[0].changes.added.map(c => c.name), ['Forest'],
      'the newer row shows what the older one grew into');
    assert.equal(rows[1].changes, null, 'the oldest has nothing under it to compare against');
  });

  test('and the deck as it stands is at the top of the list', () => {
    // Without it the newest snapshot is the one row in the panel with no
    // number against it — and it is the row whose number a reader wants
    // most, because it is what restoring that row would cost.
    store(DECK, [SOL_RING, FOREST], CATS);
    history.force(DECK, 'edit', { cards: [SOL_RING], categories: CATS });
    const { current } = history.list(DECK);
    assert.equal(current.cards, 2);
    assert.deepEqual(current.changes.added.map(c => c.name), ['Forest']);
  });

  test('a deck with no history at all still says how big it is', () => {
    store(DECK, [SOL_RING, card('Island', 'Lands', 4)], CATS);
    const { current, snapshots } = history.list(DECK);
    assert.deepEqual(snapshots, []);
    assert.equal(current.cards, 5, 'four Islands are four cards');
    assert.equal(current.distinct, 2);
    assert.equal(current.changes, null);
  });
});

// ── The browser half ──────────────────────────────────────────────────────
// Which operations take a snapshot before touching the deck, and what a
// restored deck looks like. The shipped modules are run together in one
// sandbox — the edit module calls the history module and vice versa — with
// the network and the mat stubbed, so what is counted is the request the app
// really makes and the order it really makes it in.

function loadBuilder(cards, cats = CATS.map(c => ({ ...c }))) {
  const sandbox = {
    dbDeck:  { id: 'd1', playerId: 'p1', commander: '' },
    dbCards: cards.map(c => ({ ...c })),
    dbCats:  cats,
    dbCardData: new Map(),
    dbSelectedCards: new Set(),
    dbSettledCats:   new Set(),
    dbSaveTimer: 0,
    dbView: 'list',
    _dbLandedCards: null,
    isMyPlayer: id => id === 'p1',
    /* Somewhere for the mat's messages to go. What a deck looks like is not
     * this file's question, but the import path writes "Importing cards…" onto
     * the mat on its way past and a null element is a crash rather than an
     * assertion. */
    document: {
      addEventListener() {},
      getElementById: () => ({ innerHTML: '', textContent: '', value: '', style: {} }),
    },
    window:   { addEventListener() {} },
    confirm:  () => true,
    alert:    () => {},
    // main.js's two escapers, which every deck-builder module writes markup
    // through. What they escape is asserted where they live.
    esc:      s => String(s),
    jsAttr:   s => String(s),
    clearTimeout() {},
    setTimeout: fn => { sandbox.saves++; return 1; },
    saves: 0,
    /* Every request the app made, in order, and what it sent. The snapshot
     * has to be able to say it went out *before* the deck changed, which is
     * a question about the body rather than about the call. */
    calls: [],
  };
  sandbox.dbRender      = () => {};
  /* deckview-core.js's: a card landing on the head of the deck puts that board
   * on the mat. Which board is showing is not this file's question. */
  sandbox._dbRevealHeadBoard = () => {};
  sandbox.dbRenderStats = () => {};
  sandbox.dbFetchCardData = async () => {};
  /* deckview-core.js's, which cannot be loaded beside these three: its
   * top-level `let dbCards` and friends would shadow the deck this harness is
   * holding. Both are about what a card is filed under rather than about when
   * a snapshot is taken, and both are stood in for by the simplest thing that
   * behaves the same way. */
  sandbox.dbEnsureCat = name => {
    if (!sandbox.dbCats.find(c => c.name === name)) sandbox.dbCats.push({ name, position: sandbox.dbCats.length });
  };
  sandbox.fetch = async (url, opts = {}) => {
    sandbox.calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  vm.createContext(sandbox);
  /* What a card's place in a deck is — the boards, and the two strings that
   * name a card and a pile. Loaded rather than stubbed: a snapshot's job is to
   * carry back exactly what the deck was, board and all. */
  vm.runInContext(read('public/js/deckview-boards.js'), sandbox);
  vm.runInContext(read('public/js/deckview-edit.js'), sandbox);
  vm.runInContext(read('public/js/deckview-panels.js'), sandbox);
  vm.runInContext(read('public/js/deckview-history.js'), sandbox);
  sandbox.dbAutoCategory = name => (name === 'Forest' || name === 'Island' ? 'Lands' : 'Other');
  const run = expr => vm.runInContext(expr, sandbox);
  return {
    sandbox,
    run,
    /** Cards carried onto a pile of the deck, which is where every card in
     *  these decks lives. What boards add is test/deckboards.test.js's. */
    move: (names, cat) => run(`dbMoveCardsTo(${JSON.stringify(names.map(n => `main/${n}`))}, ${JSON.stringify(`main/${cat}`)})`),
    /** The snapshots the app asked for, and the deck each one carried. */
    snapshots: () => sandbox.calls
      .filter(c => c.method === 'POST' && c.url.endsWith('/snapshots'))
      .map(c => ({ reason: c.body.reason, cards: c.body.cards.map(x => x.card_name).sort() })),
    categories: () => Object.fromEntries(sandbox.dbCards.map(c => [c.card_name, c.category])),
  };
}

const BUILT = [SOL_RING, DOOM_BLADE, FOREST];

describe('the builder, before it changes anything', () => {
  test('snapshots the deck before a category is deleted', () => {
    const app = loadBuilder(BUILT);
    app.run(`dbDeleteCategory('Removal')`);
    assert.deepEqual(app.snapshots(), [
      { reason: 'category', cards: ['Doom Blade', 'Forest', 'Sol Ring'] },
    ]);
    assert.equal(app.categories()['Doom Blade'], 'Uncategorised', 'and then deletes it');
  });

  test('snapshots the deck before a bulk move, with the cards still where they were', () => {
    // Taken before the first card moves rather than after: a snapshot of a
    // half-done move is a state the deck was never in.
    const app = loadBuilder(BUILT);
    app.move(['Sol Ring', 'Doom Blade'], 'Lands');
    const [snap] = app.snapshots();
    assert.equal(snap.reason, 'move');
    const sent = app.sandbox.calls[0].body.cards;
    assert.equal(sent.find(c => c.card_name === 'Sol Ring').category, 'Ramp',
      'the snapshot caught the card before it moved');
    assert.equal(app.categories()['Sol Ring'], 'Lands', 'and the move still happened');
  });

  test('but not before moving one card, which is one press of Undo away anyway', () => {
    const app = loadBuilder(BUILT);
    app.move(['Sol Ring'], 'Lands');
    assert.deepEqual(app.snapshots(), []);
  });

  test('nor before a bulk move where nothing actually moves', () => {
    // Twenty cards dropped on the pile they are already in is not an
    // operation, and it does not get a row.
    const app = loadBuilder(BUILT);
    app.move(['Sol Ring', 'Doom Blade'], 'Ramp');
    assert.deepEqual(app.snapshots(), [], 'one card moved, so this is not a bulk move');
  });

  test('snapshots the deck before an import, whichever way the list came in', async () => {
    const app = loadBuilder(BUILT);
    await app.run(`_dbImportCards([{ name: 'Island', qty: 4, category: 'Lands' }])`);
    assert.deepEqual(app.snapshots(), [
      { reason: 'import', cards: ['Doom Blade', 'Forest', 'Sol Ring'] },
    ]);
  });

  test('and snapshots a deck that is not mine to edit not at all', () => {
    const app = loadBuilder(BUILT);
    app.sandbox.dbDeck = { id: 'd1', playerId: 'someone-else' };
    app.move(['Sol Ring', 'Doom Blade'], 'Lands');
    assert.deepEqual(app.snapshots(), []);
  });

  test('sends the snapshot before the save it goes in front of', async () => {
    // The two race otherwise: the panel would list an operation as having
    // happened before the state it was taken from.
    const app = loadBuilder(BUILT);
    app.move(['Sol Ring', 'Doom Blade'], 'Lands');
    await app.run('_dbSaveNow()');
    const kinds = app.sandbox.calls.map(c => `${c.method} ${c.url.split('/').pop()}`);
    assert.deepEqual(kinds, ['POST snapshots', 'PUT cards']);
  });
});

describe('restoring', () => {
  test('puts the deck back, having first kept the deck it is replacing', async () => {
    const app = loadBuilder(BUILT);
    app.sandbox.fetch = async (url, opts = {}) => {
      app.sandbox.calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      if (opts.method === undefined && /\/snapshots\/\d+$/.test(url)) {
        return { ok: true, json: async () => ({ id: 7, cards: [SOL_RING], categories: [cat('Ramp')] }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    };
    await app.run('dbRestoreSnapshot(7)');
    assert.deepEqual(app.snapshots(), [
      { reason: 'restore', cards: ['Doom Blade', 'Forest', 'Sol Ring'] },
    ], 'undoing an undo works because the undo was snapshotted too');
    assert.deepEqual(app.sandbox.dbCards.map(c => c.card_name), ['Sol Ring']);
    assert.deepEqual(app.sandbox.dbCats.map(c => c.name), ['Ramp']);
  });

  test('does not resurrect a card into a category the snapshot does not have', () => {
    // The trap: a card can name a pile its own snapshot's category list does
    // not carry. Left alone the render invents the pile on the way past, so
    // the deck that gets saved is not the deck that was restored — and a
    // category deleted three snapshots ago comes back carrying cards.
    const app = loadBuilder(BUILT);
    app.run(`_dbApplyRestored(
      [{ card_name: 'Sol Ring', qty: 1, category: 'Ramp' },
       { card_name: 'Forest', qty: 1, category: 'A Pile That Was Deleted' },
       { card_name: 'Island', qty: 1, category: '' }],
      [{ name: 'Ramp', position: 0 }])`);

    const cats = new Set(app.sandbox.dbCats.map(c => c.name));
    for (const c of app.sandbox.dbCards) {
      assert.ok(cats.has(c.category), `${c.card_name} was put in "${c.category}", which the deck does not have`);
    }
    assert.equal(app.categories()['Sol Ring'], 'Ramp', 'a card whose pile is here stays in it');
    assert.equal(app.categories()['Forest'], 'Lands', 'and one whose pile is gone is filed by type');
    assert.equal(app.categories()['Island'], 'Lands');
    assert.ok(!cats.has('A Pile That Was Deleted'), 'the dead pile stayed dead');
  });
});
