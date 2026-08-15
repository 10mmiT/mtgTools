/* Choosing which printing the deck runs, from the card's own gallery.
 *
 * The card detail's *Other Printings & Alt-Art* gallery has always been a way
 * to go and look at another printing. Opened from a card in a deck you can
 * edit, it becomes a way to *choose* one: the section says which deck it is
 * choosing for, the deck's printing is ringed, and a press makes that printing
 * the deck's instead of navigating to it.
 *
 * Opened from anywhere else — the Scryfall tab, a collection, a want list — it
 * is the gallery it has always been, and that is asserted here too: this is a
 * feature that arrives by a door, and every other door has to stay shut.
 *
 * Two harnesses, both against the shipped files:
 *
 *   the gallery   js/card.js in a vm sandbox with the deck stubbed out, so
 *                 what a tile *is* can be asked without a deck existing
 *   the tab       the deck-builder modules and js/card.js together over a real
 *                 deck, as test/deckprinting.test.js runs them: Inspect, the
 *                 press, and the art the mat draws afterwards
 *
 * The column the choice lands in is test/deckprinting.test.js's and the route
 * that carries it is test/server.test.js's; what is here is the choosing.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const RAV_ART = 'https://cards.scryfall.io/normal/rav-sol-ring.jpg';
const C21_ART = 'https://cards.scryfall.io/normal/c21-sol-ring.jpg';
const LEA_ART = 'https://cards.scryfall.io/normal/lea-sol-ring.jpg';

/* Three printings of Sol Ring as Scryfall answers with them, cut to the fields
 * the gallery reads. The Commander 2021 one is the default — it is the card
 * `/cards/named` hands back — the Ravnica one is the pretty one somebody would
 * go looking for, and the Alpha one has no Cardmarket price, which is a real
 * state and not an edge case: nobody is selling those. */
const C21 = {
  id: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
  set: 'c21', set_name: 'Commander 2021', collector_number: '263',
  image_uris: { normal: C21_ART }, prices: { eur: '1.20', usd: '1.40' },
};
const RAV = {
  id: '6e9f2eb0-8ca1-4e9d-9f2b-0a1b2c3d4e5f',
  set: 'rav', set_name: 'Ravnica: City of Guilds', collector_number: '266',
  image_uris: { normal: RAV_ART }, prices: { eur: '4.50', usd: '5.10' },
};
const LEA = {
  id: 'cc99dd88-ee77-ff66-aa55-bb4433221100',
  set: 'lea', set_name: 'Limited Edition Alpha', collector_number: '270',
  image_uris: { normal: LEA_ART }, prices: { eur: null, usd: null },
};
const PRINTS = [C21, RAV, LEA];

/** The card the detail was opened on: Sol Ring, in its default printing. */
const CARD = { ...C21, name: 'Sol Ring', prints_search_uri: 'https://api.scryfall.com/prints' };

/** The Ravnica printing as the snapshot the deck stores — the seven fields, in
 *  the order available-db.js's readPrinting() writes them. */
const RAV_SNAPSHOT = {
  id: RAV.id,
  set: 'rav',
  set_name: 'Ravnica: City of Guilds',
  collector_number: '266',
  image: RAV_ART,
  price_eur: '4.50',
  chosen_at: '2026-08-15',
};

/** The context the deck's Inspect hands the gallery. */
const CTX = { deckId: 'd1', playerId: 'p1', deckName: 'A deck', ref: 'main/Sol Ring' };

/** Every `onclick` in a run of markup, in the order the tiles are drawn. */
const presses = html => [...html.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
/** The `src` of every picture in it. */
const pictures = html => [...html.matchAll(/<img[^>]*\bsrc="([^"]*)"/g)].map(m => m[1]);

// ── The gallery ───────────────────────────────────────────────────────────
// js/card.js on its own. The deck is two stubbed functions — what it runs, and
// being told what it runs now — because what a tile is does not depend on a
// deck existing, and asserting it without one is what keeps the gallery a
// function of what it was handed.

function loadGallery({ runs = null, accept = true } = {}) {
  const els = {};
  const el = id => (els[id] ||= { innerHTML: '', style: {} });
  const chosen = [];

  const sandbox = {
    document: {
      getElementById: id => el(id),
      body: { style: {} },
      addEventListener() {},
    },
    window:  { innerWidth: 1440, addEventListener() {} },
    history: { state: null, pushState() {}, replaceState() {}, back() {} },
    BP_MD: 900,
    esc: s => String(s),
    setTab() {},
    scryfallFetch: async () => ({ ok: true, json: async () => ({ data: PRINTS }) }),
    // The deck, as the gallery sees it: it can be asked what it runs, and told.
    dbPrintingFor: () => runs,
    /* Copied out of the sandbox rather than kept as it arrives: an object made
       inside a vm context has that context's Object.prototype, and a strict
       deep-equal against one made out here fails on the prototype alone. */
    dbChoosePrinting: (ctx, printing) => {
      chosen.push(JSON.parse(JSON.stringify({ ctx, printing })));
      return accept;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/card.js'), sandbox);

  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));
  return {
    run, answer,
    /** What the deck was told to run, in the order it was told. */
    chosen: () => chosen,
    /** The printings section, drawn — with a deck context or without one. */
    section: async (forDeck = null) => {
      run(`_cardForDeck = ${JSON.stringify(forDeck)}`);
      await run(`loadPrints(${JSON.stringify(CARD)}, _cardReqSeq, 'prints')`);
      return el('prints').innerHTML;
    },
    section_: () => el('prints').innerHTML,
  };
}

// ── The snapshot a press takes ────────────────────────────────────────────
// What is written onto the deck's card. It has to come out of the browser in
// exactly the shape the column stores, because the deck's history compares two
// states by serialising them: a field out of order, or an empty string where
// the server would have written nothing, is a row in the History panel for a
// change nobody made.

test('a printing is snapshotted to the seven fields, in the order the column keeps them', () => {
  const app = loadGallery();
  assert.deepStrictEqual(
    app.answer(`cardPrintingSnapshot(${JSON.stringify(RAV)}, '2026-08-15')`), RAV_SNAPSHOT);
  assert.strictEqual(
    app.run(`JSON.stringify(cardPrintingSnapshot(${JSON.stringify(RAV)}, '2026-08-15'))`),
    JSON.stringify(RAV_SNAPSHOT), 'the fields came out in a different order than the column keeps');
});

test('a printing nobody is selling has no price, rather than a free one', () => {
  // The rule the deck's total already lives by: null is not nought. The field
  // is absent, which is what available-db.js's readPrinting() would have made
  // of an empty one anyway.
  const snap = loadGallery().answer(`cardPrintingSnapshot(${JSON.stringify(LEA)}, '2026-08-15')`);
  assert.strictEqual('price_eur' in snap, false, 'an unpriced printing was written down as free');
  assert.strictEqual(snap.image, LEA_ART, 'and it is still a picture');
});

test('a two-faced printing is snapshotted by its front', () => {
  const app  = loadGallery();
  const dfc  = { id: 'dd11', set: 'isd', set_name: 'Innistrad', collector_number: '51',
                 card_faces: [{ image_uris: { normal: 'https://x/delver.jpg' } }] };
  assert.strictEqual(app.answer(`cardPrintingSnapshot(${JSON.stringify(dfc)}, '2026-08-15')`).image,
    'https://x/delver.jpg');
});

test('and something with no id is no printing at all', () => {
  // The id is what makes the snapshot point at a real card, which is the same
  // thing the server refuses a printing for.
  const app = loadGallery();
  assert.strictEqual(app.answer(`cardPrintingSnapshot(null, '2026-08-15')`), null);
  assert.strictEqual(app.answer(`cardPrintingSnapshot({ set: 'rav' }, '2026-08-15')`), null);
});

// ── Opened from anywhere else ─────────────────────────────────────────────
// The gallery it has always been. This is the half of the feature that is a
// promise not to change anything.

test('without a deck, a tile still navigates to the printing', async () => {
  const app = loadGallery();
  assert.deepStrictEqual(presses(await app.section()), PRINTS.map(p => `openCardById('${p.id}')`));
});

test('and it is the printing you are looking at that is ringed', async () => {
  const html = await loadGallery().section();
  const ringed = [...html.matchAll(/<button class="card-print-tile( current)?"[^>]*onclick="openCardById\('([^']*)'\)/g)]
    .filter(m => m[1]).map(m => m[2]);
  assert.deepStrictEqual(ringed, [CARD.id], 'the ring is on the printing the detail is showing');
});

test('and the section says nothing about any deck', async () => {
  const html = await loadGallery().section();
  assert.match(html, /Other Printings/);
  assert.doesNotMatch(html, /A deck/);
  assert.doesNotMatch(html, /€/, 'a price appeared on a gallery nobody is choosing from');
});

test('opening a card by name with nothing behind it clears a deck left over', () => {
  /* The context is a property of the opening and not of the tab. A card opened
   * from the Scryfall tab after one opened from a deck must not still be
   * choosing for that deck — which is what would happen if the field were only
   * ever written and never cleared. */
  const app = loadGallery();
  app.run(`_cardForDeck = ${JSON.stringify(CTX)}`);
  app.run(`openCardByName('Arcane Signet')`);
  assert.strictEqual(app.answer('_cardForDeck'), null);
});

test('and so does going to look at a printing by its id', () => {
  const app = loadGallery();
  app.run(`_cardForDeck = ${JSON.stringify(CTX)}`);
  app.run(`openCardById('${RAV.id}')`);
  assert.strictEqual(app.answer('_cardForDeck'), null);
});

test('an Inspect that carries a deck is the one thing that sets it', () => {
  const app = loadGallery();
  app.run(`openCardByName('Sol Ring', ${JSON.stringify(CTX)})`);
  assert.deepStrictEqual(app.answer('_cardForDeck'), CTX);
});

// ── Opened from a deck ────────────────────────────────────────────────────

test('the section says which deck it is choosing for', async () => {
  const html = await loadGallery().section(CTX);
  assert.match(html, /A deck/, 'the gallery does not say what it is choosing for');
});

test('each tile carries its set, its collector number and its price', async () => {
  const html = await loadGallery().section(CTX);
  assert.match(html, /RAV · #266/);
  assert.match(html, /€4\.50/);
});

test('and a printing with no price says so rather than saying nothing', async () => {
  /* A tile with a blank where the others have a number reads as a tile that is
   * still loading. Unknown is a thing to say. */
  const html = await loadGallery().section(CTX);
  const alpha = html.slice(html.indexOf('LEA'));
  assert.doesNotMatch(alpha.slice(0, 200), /€/, 'an unpriced printing was given a price');
  assert.match(alpha.slice(0, 200), /—/, 'an unpriced printing said nothing at all');
});

test('the printing the deck runs is the one that is ringed', async () => {
  const app  = loadGallery({ runs: RAV_SNAPSHOT });
  const html = await app.section(CTX);
  const tiles = [...html.matchAll(/<button class="card-print-tile( current)?"/g)].map(m => !!m[1]);
  assert.deepStrictEqual(tiles, [false, true, false], 'the ring is not on the deck’s printing');
});

test('and where the deck has chosen none, it is the one the app picks', async () => {
  // Which is the default printing — the card the detail was opened on. A deck
  // that has never chosen is running that one, and the ring says so.
  const app  = loadGallery({ runs: null });
  const html = await app.section(CTX);
  const tiles = [...html.matchAll(/<button class="card-print-tile( current)?"/g)].map(m => !!m[1]);
  assert.deepStrictEqual(tiles, [true, false, false]);
});

test('a press chooses the printing rather than going to look at it', async () => {
  const app  = loadGallery();
  const html = await app.section(CTX);
  assert.deepStrictEqual(presses(html), PRINTS.map(p => `cardChoosePrinting('${p.id}')`));
});

test('and what it hands the deck is the snapshot for the tile that was pressed', async () => {
  const app = loadGallery();
  await app.section(CTX);
  app.run(`cardChoosePrinting('${RAV.id}')`);
  const [told] = app.chosen();
  assert.deepStrictEqual(told.ctx, CTX, 'the deck was not told which deck');
  assert.deepStrictEqual(
    { ...told.printing, chosen_at: '2026-08-15' }, RAV_SNAPSHOT,
    'the deck was told about a different printing than the one pressed');
  assert.match(told.printing.chosen_at, /^\d{4}-\d{2}-\d{2}$/,
    'the snapshot does not say what day its price was the price on');
});

test('and the ring moves to it', async () => {
  /* The gallery is open in front of you when you press, so it has to answer.
   * The mat behind it is redrawn by the deck; this is the modal's own half. */
  const app = loadGallery();
  await app.section(CTX);
  app.run(`_cardForDeck = ${JSON.stringify(CTX)}`);
  // The deck now runs what it was told, which is what the redraw asks it for.
  app.run(`dbPrintingFor = () => (${JSON.stringify(RAV_SNAPSHOT)})`);
  app.run(`cardChoosePrinting('${RAV.id}')`);
  const tiles = [...app.section_().matchAll(/<button class="card-print-tile( current)?"/g)]
    .map(m => !!m[1]);
  assert.deepStrictEqual(tiles, [false, true, false]);
});

test('a press the deck will not take moves nothing', async () => {
  /* The deck is asked again at the moment of the press — it may have been
   * closed, or the card taken out of it, while the gallery stood open. The
   * ring staying where it is *is* the press doing nothing: a ring that moved
   * would be the modal claiming a choice the deck never made. */
  const app = loadGallery({ accept: false });
  await app.section(CTX);
  const before = app.section_();
  app.run(`cardChoosePrinting('${RAV.id}')`);
  assert.strictEqual(app.section_(), before, 'the gallery redrew for a choice that did not happen');
});

test('and a press with no deck behind it chooses nothing', async () => {
  const app = loadGallery();
  await app.section(null);
  assert.strictEqual(app.answer(`cardChoosePrinting('${RAV.id}')`), false);
  assert.deepStrictEqual(app.chosen(), [], 'a gallery with no deck told one about a printing');
});

// ── The tab ───────────────────────────────────────────────────────────────
// The deck-builder modules and js/card.js over a real deck, as
// test/deckprinting.test.js runs them. What is asserted here is the path the
// ticket describes end to end: Inspect from a card on the mat, a press in the
// gallery, and the art the mat draws afterwards.

function loadTab({ playerId = 'p1' } = {}) {
  const mat = { innerHTML: '', classList: { toggle() {} } };
  const els = {};
  const el  = id => (els[id] ||= {
    innerHTML: '', textContent: '', title: '', value: '', style: {},
    setAttribute(k, v) { (this.attrs ||= {})[k] = v; },
    querySelector: () => null,
    classList: { toggle() {}, add() {}, remove() {} },
  });
  const store = new Map();
  const calls = [];

  const sandbox = {
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    document: {
      addEventListener() {}, querySelectorAll: () => [], createElement: () => el('made'),
      getElementById: id => (id === 'dbDeckContent' ? mat : el(id)),
      body: { appendChild() {}, style: {} },
      scrollingElement: { scrollTop: 0 },
      documentElement:  { scrollTop: 0 },
    },
    window:  { addEventListener() {}, innerWidth: 1440, innerHeight: 900 },
    history: { state: null, pushState() {}, replaceState() {}, back() {} },
    BP_MD: 900,
    setTab() {},
    isMyPlayer: id => id === 'p1',
    confirm: () => true,
    alert: () => {},
    clearTimeout() {},
    fetch: async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    scryfallFetch: async () => ({ ok: true, json: async () => ({ data: PRINTS }) }),
    /* Sol Ring has one side, and what the mat does with a card that has two is
       test/deckart.test.js's. */
    scryfallBackFace: () => '',
    esc: s => String(s),
    jsAttr: s => String(s),
    renderMana: () => '', renderPrice: () => '', sfCardOwnership: () => '',
    state: { collections: [], players: [{ id: 'p1', name: 'P1', decks: [{ id: 'd1', name: 'A deck' }] }] },
    myPlayerId: () => 'p1', colOwner: () => null, playerColor: () => '',
    scryfallMetaCache: new Map(),
    animateCardMove: (_el, paint) => paint(),
  };
  sandbox.setTimeout = () => 1;
  sandbox.dbFetchCardData = async () => {};
  vm.createContext(sandbox);
  /* cardturn.js for real, so a tile is asserted as the browser draws it once
     the picture is wrapped in its turn control. Whether a card *has* another
     side is scryfallBackFace()'s and is stubbed above: the printings under
     test are Sol Ring's, which has one side, and the real file would replace
     this sandbox's scryfallFetch with the queue it stands in for. */
  for (const file of ['cardturn.js',
                      'sortui.js', 'cardstack.js', 'card.js', 'deckview-boards.js',
                      'deckview-core.js', 'deckview-render.js',
                      'deckview-edit.js', 'deckview-panels.js', 'deckview-history.js',
                      'deckview-owned.js', 'deckview-totals.js', 'deckview-legality.js',
                      'deckview-mana.js']) {
    vm.runInContext(read(`public/js/${file}`), sandbox);
  }
  const run    = expr => vm.runInContext(expr, sandbox);
  const answer = expr => JSON.parse(run(`JSON.stringify(${expr})`));

  run(`dbDeck = { id: 'd1', playerId: ${JSON.stringify(playerId)}, name: 'A deck', commander: '' }`);
  /* Sol Ring alone in its pile, because a settled stack draws one picture — the
     first card in the current sort — and a pile that also held a Forest would
     be a pile whose face is the Forest. */
  run(`dbCards = ${JSON.stringify([
    { card_name: 'Sol Ring', qty: 1, category: 'Ramp',  board: 'main', position: 0 },
    { card_name: 'Forest',   qty: 9, category: 'Lands', board: 'main', position: 1 },
  ])}`);
  run(`dbCats = [{ name: 'Ramp', position: 0 }, { name: 'Lands', position: 1 }]`);
  run(`dbShownBoards = new Set()`);
  run(`dbCardData = new Map(${JSON.stringify([
    ['Sol Ring', { name: 'Sol Ring', type_line: 'Artifact', cmc: 1, color_identity: [],
                   image_uris: { normal: C21_ART } }],
    ['Forest',   { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, color_identity: ['G'] }],
  ])})`);

  return {
    run, answer,
    printing: name => answer(
      `dbCards.find(c => c.card_name === ${JSON.stringify(name)})?.printing || null`),
    /** The mat in one of its views, drawn. */
    paint: (view, settled = null) => {
      run(`dbView = ${JSON.stringify(view)}`);
      run(`dbSettledCats.clear()`);
      if (settled) run(`dbSettledCats.add(${JSON.stringify(settled)})`);
      run('dbRender()');
      return mat.innerHTML;
    },
    saved: async () => {
      await run('_dbSaveNow()');
      const put = calls.filter(c => c.method === 'PUT').pop();
      return put ? put.body : null;
    },
  };
}

// ── The door ──────────────────────────────────────────────────────────────

test('Inspect on a card in your own deck opens the gallery for that deck', () => {
  const tab = loadTab();
  tab.run(`dbInspectCard('main/Sol Ring')`);
  assert.deepStrictEqual(tab.answer('_cardForDeck'),
    { deckId: 'd1', playerId: 'p1', deckName: 'A deck', ref: 'main/Sol Ring' });
});

test('Inspect on somebody else’s deck opens the card and nothing more', () => {
  // The gallery chooses for a deck you can edit. On a deck you are only
  // looking at, Inspect is what it has always been.
  const tab = loadTab({ playerId: 'p2' });
  tab.run(`dbInspectCard('main/Sol Ring')`);
  assert.strictEqual(tab.answer('_cardForDeck'), null);
});

test('and Inspect on a card that is not in the deck carries no deck either', () => {
  const tab = loadTab();
  tab.run(`dbInspectCard('main/Black Lotus')`);
  assert.strictEqual(tab.answer('_cardForDeck'), null);
});

test('the card menu’s Inspect is the one that goes through it', () => {
  // Both of the mat's ⓘ entries — the menu's and the list row's — so that the
  // feature is reachable from every view the ticket says the art changes in.
  const tab  = loadTab();
  const menu = tab.run(`dbCardMenuItems(dbCardMenuState('main/Sol Ring'))`);
  assert.match(menu, /dbInspectCard\('main\/Sol Ring'\)/);
  assert.match(tab.paint('list'), /dbInspectCard\('main\/Sol Ring'\)/,
    'the list row’s ⓘ opens a gallery that cannot choose');
});

// ── The press, and the mat behind it ──────────────────────────────────────

test('a press in the gallery makes that printing the deck’s', async () => {
  const tab = loadTab();
  tab.run(`dbInspectCard('main/Sol Ring')`);
  await tab.run(`loadPrints(${JSON.stringify(CARD)}, _cardReqSeq, 'prints')`);
  tab.run(`cardChoosePrinting('${RAV.id}')`);
  assert.deepStrictEqual({ ...tab.printing('Sol Ring'), chosen_at: '2026-08-15' }, RAV_SNAPSHOT);
  assert.strictEqual(tab.printing('Forest'), null, 'the press reached a card it was not about');
});

test('and the mat is drawing that art by the time the card is closed', () => {
  /* The modal is redrawn over a mat that has already changed, so closing it is
   * the whole of what is left to do. All three views that draw a deck card's
   * picture, through the one helper the prefactor left. */
  const tab = loadTab();
  tab.run(`dbChoosePrinting(dbPrintingContext('main/Sol Ring'), ${JSON.stringify(RAV_SNAPSHOT)})`);
  assert.strictEqual(pictures(tab.paint('grid'))[0], RAV_ART, 'the grid tile');
  assert.strictEqual(pictures(tab.paint('pile'))[0], RAV_ART, 'a card in a spread pile');
  assert.strictEqual(pictures(tab.paint('pile', 'Ramp'))[0], RAV_ART, 'the face of a settled stack');
});

test('a card nobody has chosen a printing for draws what it always drew', () => {
  const tab = loadTab();
  assert.strictEqual(pictures(tab.paint('grid'))[0], C21_ART);
});

test('and the choice rides home on the deck’s ordinary save', async () => {
  // There is no request of its own: choosing a printing is an edit to the
  // deck, and the deck already knows how to save itself.
  const tab = loadTab();
  tab.run(`dbChoosePrinting(dbPrintingContext('main/Sol Ring'), ${JSON.stringify(RAV_SNAPSHOT)})`);
  const body = await tab.saved();
  assert.deepStrictEqual(body.cards.find(c => c.card_name === 'Sol Ring').printing, RAV_SNAPSHOT);
});

// ── The deck, checked again at the press ──────────────────────────────────
// The gallery may have stood open for a while. Everything it was told when it
// was drawn is asked again here, against the deck as it stands now.

test('a press does nothing once the deck has been closed', () => {
  const tab = loadTab();
  const ctx = tab.answer(`dbPrintingContext('main/Sol Ring')`);
  tab.run(`dbDeck = null`);
  assert.strictEqual(tab.answer(`dbChoosePrinting(${JSON.stringify(ctx)}, ${JSON.stringify(RAV_SNAPSHOT)})`), false);
});

test('or once another deck has been opened in its place', () => {
  const tab = loadTab();
  const ctx = tab.answer(`dbPrintingContext('main/Sol Ring')`);
  tab.run(`dbDeck = { id: 'd2', playerId: 'p1', name: 'Another deck', commander: '' }`);
  assert.strictEqual(tab.answer(`dbChoosePrinting(${JSON.stringify(ctx)}, ${JSON.stringify(RAV_SNAPSHOT)})`), false);
  assert.strictEqual(tab.printing('Sol Ring'), null, 'the printing landed on the deck that is open now');
});

test('or once the card has been taken out of it', () => {
  const tab = loadTab();
  const ctx = tab.answer(`dbPrintingContext('main/Sol Ring')`);
  tab.run(`dbCards = dbCards.filter(c => c.card_name !== 'Sol Ring')`);
  assert.strictEqual(tab.answer(`dbChoosePrinting(${JSON.stringify(ctx)}, ${JSON.stringify(RAV_SNAPSHOT)})`), false);
});

test('and a deck you cannot edit is not chosen for however the press arrives', () => {
  const tab = loadTab({ playerId: 'p2' });
  const ctx = { deckId: 'd1', playerId: 'p2', deckName: 'A deck', ref: 'main/Sol Ring' };
  assert.strictEqual(tab.answer(`dbChoosePrinting(${JSON.stringify(ctx)}, ${JSON.stringify(RAV_SNAPSHOT)})`), false);
  assert.strictEqual(tab.printing('Sol Ring'), null);
});

test('choosing again replaces the printing rather than adding one', () => {
  const tab = loadTab();
  tab.run(`dbChoosePrinting(dbPrintingContext('main/Sol Ring'), ${JSON.stringify(RAV_SNAPSHOT)})`);
  const c21 = { ...RAV_SNAPSHOT, id: C21.id, set: 'c21', set_name: 'Commander 2021',
                collector_number: '263', image: C21_ART, price_eur: '1.20' };
  tab.run(`dbChoosePrinting(dbPrintingContext('main/Sol Ring'), ${JSON.stringify(c21)})`);
  assert.deepStrictEqual(tab.printing('Sol Ring'), c21);
});

test('and what the deck runs is what the gallery asks for when it draws', () => {
  const tab = loadTab();
  tab.run(`dbChoosePrinting(dbPrintingContext('main/Sol Ring'), ${JSON.stringify(RAV_SNAPSHOT)})`);
  assert.deepStrictEqual(tab.answer(`dbPrintingFor(dbPrintingContext('main/Sol Ring'))`), RAV_SNAPSHOT);
  tab.run(`dbCards = dbCards.filter(c => c.card_name !== 'Sol Ring')`);
  assert.strictEqual(tab.answer(`dbPrintingFor({ deckId: 'd1', ref: 'main/Sol Ring' })`), null);
});
