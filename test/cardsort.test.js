/* What a sort is.
 *
 * A sort is a sentence — colour, then mana value, then name — so the
 * comparator takes an ordered list of `{ field, dir }` criteria rather than
 * one field and one arrow. What is asserted here is what the views rest on:
 * the second criterion is reached only on a tie, each criterion's direction is
 * its own, and the invisible name tiebreak leaves an order that is total, so
 * two renders of the same cards cannot disagree.
 *
 * The shipped public/js/sortui.js is run against stub browser globals, the way
 * test/cardgroups.test.js runs the grouping, so these assert on the code the
 * browser is served rather than on a copy of it.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** The file reads its stored preferences and hangs two listeners as it loads,
 *  and reads card metadata for the cards it is not handed in full — the app's
 *  Scryfall cache, which is empty here because every card below carries its
 *  own metadata.
 *
 *  `SORT_FIELDS` is a top-level const, so it is in the context's lexical scope
 *  rather than on the sandbox object, and is asked for as an expression. */
function loadSortUi(stored = {}, raw = {}) {
  const store = { mtgtools_sort: JSON.stringify(stored), ...raw };
  const sandbox = {
    localStorage: {
      getItem: k => store[k] ?? null,
      setItem(k, v) { store[k] = v; },
    },
    document: { addEventListener() {} },
    scryfallMetaCache: new Map(),
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/sortui.js'), sandbox);
  /* Anything built inside the sandbox is built from that context's own
   * Object, which deepStrictEqual compares prototypes on. Everything handed
   * back is a plain value of this realm's. */
  const plain = v => JSON.parse(JSON.stringify(v));
  return {
    compare: (criteria, ctx) => sandbox.cardComparator(criteria, ctx),
    sortKey: (field, card, ctx) => sandbox.sortKey(field, card, ctx),
    /** The chain a field seeds, and the four things that can happen to one. */
    seed:    (field, fields)          => plain(sandbox.seedChain(field, fields)),
    choose:  (sort, field, fields)    => plain(sandbox.chooseSortField(sort, field, fields)),
    edit:    (sort, criteria, fields) => plain(sandbox.editSortChain(sort, criteria, fields)),
    reseed:  (sort, fields)           => plain(sandbox.reseedSortChain(sort, fields)),
    /** The two gestures the Collections table header is: a click on a column
     *  heading and a shift-click on one. What they draw is asked for too —
     *  where in the chain a column is, which is the whole of what the header's
     *  marks are a function of. */
    click:      (sort, field, fields) => plain(sandbox.chooseSortColumn(sort, field, fields)),
    shiftClick: (sort, field, fields) => plain(sandbox.appendSortColumn(sort, field, fields)),
    columnAt:   (criteria, field)     => sandbox.sortColumnAt(criteria, field),
    /** The chain a view is sorted by, and storing one. `fields` is the view's
     *  own field list, which is what a stored sort is read against. */
    chainOf:   (view, def, fields) => plain(sandbox.getSortChain(view, def, fields)),
    saveChain: (view, sort)        => sandbox.saveSortChain(view, sort),
    /** Sorting as a view does it, answered as the names in order. */
    order:   (criteria, cards, ctx) =>
      cards.slice().sort(sandbox.cardComparator(criteria, ctx)).map(c => c.name),
    fields:  [...vm.runInContext('SORT_FIELDS.map(f => f.key)', sandbox)],
    /** The stored sorts, and what the collections that exist make of them. */
    reconcile: cols => sandbox.reconcileColSorts(cols),
    sortOf:    (view, fields) => ({ ...sandbox.getSort(view, null, fields) }),
    /** What is actually in localStorage afterwards, as the next load reads it. */
    written:   () => JSON.parse(store.mtgtools_sort),
    /** And the string itself, for asserting nothing was written at all. */
    rawWritten: () => store.mtgtools_sort,
    colField:  id => sandbox.colQtyField(id),
    /** The sentence the control's button says. The popover's DOM is not
     *  tested — mountSortControl never has been — but the label is what the
     *  whole control exists to put on the strip, and it is a function of the
     *  chain and the view's field list rather than of anything rendered. */
    label:     (criteria, fields) => sandbox.chainLabel(criteria, fields),
  };
}

const app = loadSortUi();

/** A Scryfall card, as much of one as the sort vocabulary reads. */
function card(name, props = {}) {
  return { name, cmc: 0, colors: [], color_identity: [], type_line: 'Creature',
           rarity: 'common', collector_number: '1', ...props };
}

/* Ties on purpose, and no accidental agreement: inside every colour the curve
 * order differs from the alphabetical one, and the two green one-drops are
 * separated only by price. So a chain that quietly stopped after its first
 * criterion — or after its second — would come out in a different order than
 * the one asserted, rather than being covered for by the name tiebreak. */
const SET = [
  card('Brainstorm',        { cmc: 1, colors: ['U'], color_identity: ['U'], type_line: 'Instant', prices: { eur: '1.20' }, collector_number: '50' }),
  card('Ponder',            { cmc: 1, colors: ['U'], color_identity: ['U'], type_line: 'Sorcery', prices: { eur: '0.30' }, collector_number: '61' }),
  card('Cryptic Command',   { cmc: 4, colors: ['U'], color_identity: ['U'], rarity: 'rare', type_line: 'Instant', prices: { eur: '15.00' }, collector_number: '33' }),
  card('Thoughtseize',      { cmc: 1, colors: ['B'], color_identity: ['B'], rarity: 'rare', type_line: 'Sorcery', prices: { eur: '18.00' }, collector_number: '109' }),
  card('Doom Blade',        { cmc: 2, colors: ['B'], color_identity: ['B'], type_line: 'Instant', prices: { eur: '0.20' }, collector_number: '204' }),
  card('Grave Titan',       { cmc: 6, colors: ['B'], color_identity: ['B'], rarity: 'mythic', type_line: 'Creature — Giant', power: '6', toughness: '6', prices: { eur: '12.00' }, collector_number: '95' }),
  card('Birds of Paradise', { cmc: 1, colors: ['G'], color_identity: ['G'], rarity: 'rare', type_line: 'Creature — Bird', power: '0', toughness: '1', prices: { eur: '8.50' }, collector_number: '112' }),
  card('Llanowar Elves',    { cmc: 1, colors: ['G'], color_identity: ['G'], type_line: 'Creature — Elf', power: '1', toughness: '1', prices: { eur: '0.50' }, collector_number: '188' }),
];

/* What a card cannot answer about itself, as the plain object a view hands
 * over — two collections it is owned in, three players who want some of it.
 * Nothing is stamped onto the cards above: that a criterion reads the context
 * rather than a decorated row is the thing being asserted, so the fixtures are
 * cards as Scryfall sends them.
 *
 * The numbers are laid out so that each field is its own order. One
 * collection's counts do not agree with the total across both; and the cards
 * three people want, two people want and one person wants are chosen so that
 * curve order inside a tie is the *reverse* of the alphabetical order the name
 * tiebreak would otherwise leave them in. */
const OWNED = [
  { key: 'archidekt:1', name: 'Binder',  cards: new Map([
    ['Brainstorm',        { qty: 4 }], ['Cryptic Command', { qty: 1 }],
    ['Doom Blade',        { qty: 2 }], ['Grave Titan',     { qty: 1 }],
    ['Birds of Paradise', { qty: 1 }], ['Llanowar Elves',  { qty: 4 }],
  ]) },
  { key: 'csv:1699', name: 'Deckbox', cards: new Map([
    ['Ponder',            { qty: 3 }], ['Thoughtseize',    { qty: 2 }],
    ['Doom Blade',        { qty: 1 }], ['Birds of Paradise', { qty: 3 }],
  ]) },
];

const PLAYERS = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Bo' }, { id: 'p3', name: 'Cy' }];
const WANTS = new Map([
  ['Thoughtseize',    new Set(['p1', 'p2', 'p3'])],
  ['Cryptic Command', new Set(['p1', 'p2'])],
  ['Doom Blade',      new Set(['p2', 'p3'])],
  ['Ponder',          new Set(['p1', 'p3'])],
  ['Grave Titan',     new Set(['p3'])],
]);

const CTX = { collections: OWNED, players: PLAYERS, wants: WANTS };

/** A criterion naming one collection's own count, said the way the tab says
 *  it: the collection's id, not where it happens to sit in the list. */
const BINDER  = 'col:archidekt:1';
const DECKBOX = 'col:csv:1699';

// ── A sort is a sentence ──────────────────────────────────────────────

test('the second criterion is reached only where the first ties', () => {
  // Colour, then mana value: the colour blocks are in colour order and the
  // cards inside each are in curve order. Which is the thing a one-field sort
  // cannot say — blue is a block with no shape inside it.
  assert.deepStrictEqual(
    app.order([{ field: 'color', dir: 1 }, { field: 'cmc', dir: 1 }], SET),
    ['Brainstorm', 'Ponder', 'Cryptic Command',          // blue, 1 1 4
     'Thoughtseize', 'Doom Blade', 'Grave Titan',        // black, 1 2 6
     'Birds of Paradise', 'Llanowar Elves']);            // green, 1 1
});

test('a criterion decides on its own, and the rest of the chain is not consulted', () => {
  // Mana value first: the one-drops come out together whatever colour they
  // are, which is the same list read in the other order.
  assert.deepStrictEqual(
    app.order([{ field: 'cmc', dir: 1 }, { field: 'color', dir: 1 }], SET),
    ['Brainstorm', 'Ponder', 'Thoughtseize', 'Birds of Paradise', 'Llanowar Elves',
     'Doom Blade',
     'Cryptic Command',
     'Grave Titan']);
});

test("a criterion's direction is its own", () => {
  // Colour ascending with mana value descending: the colour blocks stay in
  // colour order and only the cards inside them turn around. One global arrow
  // cannot ask this.
  assert.deepStrictEqual(
    app.order([{ field: 'color', dir: 1 }, { field: 'cmc', dir: -1 }], SET),
    ['Cryptic Command', 'Brainstorm', 'Ponder',
     'Grave Titan', 'Doom Blade', 'Thoughtseize',
     'Birds of Paradise', 'Llanowar Elves']);

  // And the mirror: the blocks turn around, the cards inside them do not.
  assert.deepStrictEqual(
    app.order([{ field: 'color', dir: -1 }, { field: 'cmc', dir: 1 }], SET),
    ['Birds of Paradise', 'Llanowar Elves',
     'Thoughtseize', 'Doom Blade', 'Grave Titan',
     'Brainstorm', 'Ponder', 'Cryptic Command']);
});

test('three criteria are three words of the same sentence', () => {
  // The third fires only for the pairs the first two leave tied — the two blue
  // one-drops and the two green ones — and it puts each pair in price order
  // rather than the alphabetical order they would otherwise fall into.
  assert.deepStrictEqual(
    app.order([{ field: 'color', dir: 1 }, { field: 'cmc', dir: 1 }, { field: 'price', dir: 1 }], SET),
    ['Ponder', 'Brainstorm', 'Cryptic Command',
     'Thoughtseize', 'Doom Blade', 'Grave Titan',
     'Llanowar Elves', 'Birds of Paradise']);
});

// ── The tiebreak nobody is shown ──────────────────────────────────────

test('the name tiebreak fires last and ascending, whatever the criteria say', () => {
  // Every criterion descending, and the cards it cannot separate still come
  // out alphabetically. It is not a criterion — it is what stops two cards
  // alike in everything chosen from swapping places between renders.
  const tied = [card('Zephyr'), card('Aether'), card('Mox')];
  assert.deepStrictEqual(app.order([{ field: 'cmc', dir: -1 }], tied),
    ['Aether', 'Mox', 'Zephyr']);
  assert.deepStrictEqual(app.order([{ field: 'rarity', dir: -1 }, { field: 'type', dir: -1 }], tied),
    ['Aether', 'Mox', 'Zephyr']);
});

test('the order is total, so sorting an already-sorted list changes nothing', () => {
  for (const criteria of [[], [{ field: 'rarity', dir: -1 }],
                          [{ field: 'color', dir: 1 }, { field: 'cmc', dir: -1 }]]) {
    const once  = SET.slice().sort(app.compare(criteria));
    const twice = once.slice().sort(app.compare(criteria));
    assert.deepStrictEqual(twice.map(c => c.name), once.map(c => c.name),
      `sorting twice by ${JSON.stringify(criteria)} moved something`);
  }

  // Total means no two distinct cards compare equal: a comparator that
  // returns 0 for a pair leaves their order to whatever the engine did last.
  const cmp = app.compare([{ field: 'rarity', dir: 1 }]);
  for (const a of SET) for (const b of SET) {
    if (a === b) assert.strictEqual(cmp(a, b), 0);
    else assert.notStrictEqual(cmp(a, b), 0, `${a.name} and ${b.name} compare equal`);
  }
});

// ── A list of one is what the app did before ──────────────────────────

test('a one-criterion list orders every field the way a single field and arrow did', () => {
  /* The comparator this replaced, written out: compare on the field, then
   * tiebreak by name ascending. Every view passes a list of one today, so
   * every view has to render exactly as it rendered before. */
  const single = (field, dir) => (a, b) => {
    const av = app.sortKey(field, a, CTX), bv = app.sortKey(field, b, CTX);
    if (av < bv) return -dir;
    if (av > bv) return  dir;
    const an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  };

  assert.ok(app.fields.length >= 12, 'the field list did not come back from the sandbox');
  for (const field of [...app.fields, BINDER, DECKBOX]) {
    for (const dir of [1, -1]) {
      assert.deepStrictEqual(
        app.order([{ field, dir }], SET, CTX),
        SET.slice().sort(single(field, dir)).map(c => c.name),
        `a one-criterion list on ${field} ${dir === 1 ? 'ascending' : 'descending'} reorders the view`);
    }
  }
});

// ── A criterion is a criterion ────────────────────────────────────────
// The fields that used to sort themselves outside sortKey — the Want List's
// two bespoke comparators, a quantity the caller had to stamp onto every row,
// and two Collections table-header fields the sort control never saw. Each of
// them is a word a sort can be said in now, in any slot of the chain.

test('most wanted, then mana value — the sort the old Want List could not say', () => {
  // Most Wanted produces enormous ties by construction: everything wanted by
  // one person is one block, and the second criterion is the only thing that
  // can put a shape inside it. Here the three cards two people want come out
  // in curve order, which is the reverse of the alphabetical order the name
  // tiebreak leaves them in on its own.
  assert.deepStrictEqual(
    app.order([{ field: 'wanted', dir: -1 }, { field: 'cmc', dir: 1 }], SET, CTX),
    ['Thoughtseize',                                   // all three want it
     'Ponder', 'Doom Blade', 'Cryptic Command',        // two each: 1, 2, 4
     'Grave Titan',                                    // one
     'Birds of Paradise', 'Brainstorm', 'Llanowar Elves']);  // nobody, all one-drops

  // Most Wanted on its own is the same list with that middle block left in the
  // order the tiebreak found it — which is what the tab did before, and why
  // the second criterion is the point.
  assert.deepStrictEqual(
    app.order([{ field: 'wanted', dir: -1 }], SET, CTX).slice(1, 4),
    ['Cryptic Command', 'Doom Blade', 'Ponder']);
});

test('who wants a card is an order, and it puts the same wanters together', () => {
  // Ada's cards, then Bo's, then Cy's — cards wanted by the same people are
  // adjacent, which is what makes this worth sorting by. Nobody's come first.
  assert.deepStrictEqual(
    app.order([{ field: 'player', dir: 1 }], SET, CTX),
    ['Birds of Paradise', 'Brainstorm', 'Llanowar Elves',  // wanted by nobody
     'Cryptic Command',                                    // Ada, Bo
     'Thoughtseize',                                       // Ada, Bo, Cy
     'Ponder',                                             // Ada, Cy
     'Doom Blade',                                         // Bo, Cy
     'Grave Titan']);                                      // Cy
});

test('how many are owned is read off the collections, not off the row', () => {
  // Quantity is the total across every collection; a collection's own count is
  // a field of its own, and they are different orders. Nothing was stamped
  // onto these cards — the numbers are in the context.
  assert.deepStrictEqual(
    app.order([{ field: 'qty', dir: 1 }], SET, CTX),
    ['Cryptic Command', 'Grave Titan',                 // 1 each
     'Thoughtseize',                                   // 2
     'Doom Blade', 'Ponder',                           // 3
     'Birds of Paradise', 'Brainstorm', 'Llanowar Elves']); // 4

  assert.deepStrictEqual(
    app.order([{ field: BINDER, dir: 1 }], SET, CTX),
    ['Ponder', 'Thoughtseize',                         // not in the Binder
     'Birds of Paradise', 'Cryptic Command', 'Grave Titan',
     'Doom Blade',
     'Brainstorm', 'Llanowar Elves']);
});

test('Total and Quantity are one field under two names', () => {
  // The Collections table header says Total and the sort control says
  // Quantity, and both mean how many of this card are owned altogether. The
  // header writes `qty`; `total` is what earlier versions wrote into the
  // stored sort, and it still orders that table the way it was left.
  assert.deepStrictEqual(app.order([{ field: 'total', dir: -1 }], SET, CTX),
                         app.order([{ field: 'qty',   dir: -1 }], SET, CTX));
});

test('a criterion whose context is missing leaves the order stable, not thrown', () => {
  // A view that sorts by a field it supplied no context for — a stored sort
  // from another tab, a collection that is no longer loaded. Every card scores
  // alike, so the name tiebreak orders them: a wrong sort is a wrong order,
  // and an exception is a blank tab.
  const alphabetical = SET.map(c => c.name).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
  for (const field of ['wanted', 'player', 'qty', 'total', BINDER]) {
    assert.deepStrictEqual(app.order([{ field, dir: -1 }], SET), alphabetical,
      `${field} with no context at all did not fall back to the name tiebreak`);
  }
});

// ── A collection criterion is stored by id ────────────────────────────
// `col_<i>` was a position in the list, so deleting the first collection
// turned a stored `col_2` into a different collection's quantities — a sort
// that is not wrong so much as quietly about something else. A criterion names
// the collection, and the list it sits in is nobody's business.

const GONE = 'col:moxfield:deleted';

test('a collection criterion means the same collection wherever it sits in the list', () => {
  // The same sort, asked of the same two collections in the other order. Under
  // an index this is the other collection's counts and nobody is told.
  const reordered = { ...CTX, collections: [OWNED[1], OWNED[0]] };
  assert.deepStrictEqual(app.order([{ field: BINDER, dir: -1 }], SET, CTX),
                         app.order([{ field: BINDER, dir: -1 }], SET, reordered),
                         'reordering the collections reordered the cards');
  assert.deepStrictEqual(app.order([{ field: DECKBOX, dir: -1 }], SET, CTX),
                         app.order([{ field: DECKBOX, dir: -1 }], SET, reordered));

  // And the two are genuinely different sorts, so the above is agreement
  // rather than two fields that happen to answer alike.
  assert.notDeepStrictEqual(app.order([{ field: BINDER,  dir: -1 }], SET, CTX),
                            app.order([{ field: DECKBOX, dir: -1 }], SET, CTX));
});

test('renaming a collection changes what it is called and nothing else', () => {
  // The name is the label the control prints; the criterion names the id. So a
  // renamed collection is the same criterion, sorting the same way.
  const renamed = { ...CTX, collections: [{ ...OWNED[0], name: 'The Big Binder' }, OWNED[1]] };
  assert.deepStrictEqual(app.order([{ field: BINDER, dir: -1 }], SET, CTX),
                         app.order([{ field: BINDER, dir: -1 }], SET, renamed));
});

test('a criterion naming a collection that is gone is dropped, and the rest still says what it said', () => {
  // Deleted from the chips, or from another tab while this one was open. It
  // cannot be honoured, so it is not honoured — silently, because a modal
  // about a word of a sort is worse than the sort being one word shorter.
  const alphabetical = SET.map(c => c.name).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
  assert.deepStrictEqual(app.order([{ field: GONE, dir: 1 }], SET, CTX), alphabetical,
    'a sort left with nothing in it is not name ascending');

  // The words either side of it are untouched: a dropped first criterion
  // leaves the sort to the ones after it rather than blanking the tab.
  assert.deepStrictEqual(
    app.order([{ field: GONE, dir: 1 }, { field: 'cmc', dir: -1 }], SET, CTX),
    app.order([{ field: 'cmc', dir: -1 }], SET, CTX));
  assert.deepStrictEqual(
    app.order([{ field: 'color', dir: 1 }, { field: GONE, dir: 1 }, { field: 'cmc', dir: 1 }], SET, CTX),
    app.order([{ field: 'color', dir: 1 }, { field: 'cmc', dir: 1 }], SET, CTX));
});

// ── Choosing a field seeds the sentence ───────────────────────────────
// Picking a field does not give you one criterion, it gives you the chain that
// field usually belongs to. A list somebody has to assemble by hand is a list
// nobody assembles, so the feature has to pay off on the first click.

/** A chain written the way the spec's table writes one: the fields in order,
 *  with a ↓ on the ones that seed descending. */
const chain = (...words) => words.map(w =>
  w.endsWith('↓') ? { field: w.slice(0, -1), dir: -1 } : { field: w, dir: 1 });

/** Every row of the table in docs/design/spec-sorting.md. */
const SEEDED = [
  ['color',     chain('color', 'cmc', 'name')],
  ['cmc',       chain('cmc', 'color', 'name')],
  ['type',      chain('type', 'cmc', 'name')],
  ['rarity',    chain('rarity', 'color', 'name')],
  ['price',     chain('price↓', 'name')],
  ['power',     chain('power↓', 'cmc', 'name')],
  ['toughness', chain('toughness↓', 'cmc', 'name')],
  ['qty',       chain('qty↓', 'name')],
  ['total',     chain('total↓', 'name')],
  [BINDER,      chain(BINDER + '↓', 'name')],
  ['wanted',    chain('wanted↓', 'cmc', 'name')],
  ['player',    chain('player', 'name')],
  ['number',    chain('number')],
  ['name',      chain('name')],
];

test('choosing a field seeds the sentence that field usually belongs to', () => {
  for (const [field, expected] of SEEDED)
    assert.deepStrictEqual(app.seed(field), expected, `${field} seeded the wrong chain`);

  // Every field the app can sort by has an answer here, so nothing falls
  // through to seeding alone by accident.
  for (const field of app.fields)
    assert.ok(SEEDED.some(([f]) => f === field), `${field} is not in the seed table`);
});

test('anything countable seeds descending, and what is unique seeds alone', () => {
  // Nobody asks for their cheapest cards, their least wanted, or the one copy
  // they own before the four.
  for (const field of ['price', 'power', 'toughness', 'qty', 'total', 'wanted', BINDER])
    assert.strictEqual(app.seed(field)[0].dir, -1, `${field} did not seed descending`);

  // Name and Set Number are already unique, so a tail would never fire.
  for (const field of ['name', 'number'])
    assert.strictEqual(app.seed(field).length, 1, `${field} seeded a tail that cannot fire`);
});

test('a seeded chain sorts the way its sentence reads', () => {
  // Colour, then the curve inside each colour — the shape a one-field sort
  // cannot say, off a single click on Color.
  assert.deepStrictEqual(app.order(app.seed('color'), SET),
    ['Brainstorm', 'Ponder', 'Cryptic Command',
     'Thoughtseize', 'Doom Blade', 'Grave Titan',
     'Birds of Paradise', 'Llanowar Elves']);

  // And Price is the expensive cards first, without anyone touching an arrow.
  assert.deepStrictEqual(app.order(app.seed('price'), SET),
    ['Thoughtseize', 'Cryptic Command', 'Grave Titan', 'Birds of Paradise',
     'Brainstorm', 'Llanowar Elves', 'Ponder', 'Doom Blade']);
});

test('a seeded word the view cannot sort on is dropped from the chain', () => {
  // A chain must never hold a criterion its view has no field for — the Set
  // Browser has no Quantity, and a tab cannot sort on a column it does not
  // offer. What is left still says what it can.
  const noCurve = ['name', 'color', 'price'];
  assert.deepStrictEqual(app.seed('color', noCurve), chain('color', 'name'));
  assert.deepStrictEqual(app.seed('price', noCurve), chain('price↓', 'name'));

  const noName = ['color', 'cmc'];
  assert.deepStrictEqual(app.seed('color', noName), chain('color', 'cmc'));
});

// ── Editing the tail makes it yours ───────────────────────────────────
// A chain that is still all-default is the app's suggestion, and a better
// suggestion should replace it. A chain somebody edited is theirs.

const SEEDED_COLOR = { criteria: chain('color', 'cmc', 'name'), edited: false };

test('choosing a new first criterion re-seeds a chain nobody has edited', () => {
  // The whole sentence, not the first word of the old one: choosing Rarity
  // gives rarity → colour → name, and the mana value that was there goes.
  assert.deepStrictEqual(app.choose(SEEDED_COLOR, 'rarity'),
    { criteria: chain('rarity', 'color', 'name'), edited: false });
  assert.deepStrictEqual(app.choose(SEEDED_COLOR, 'price'),
    { criteria: chain('price↓', 'name'), edited: false });
});

test("editing anything after the first word makes the chain theirs", () => {
  for (const [what, next] of [
    ['a different field', chain('color', 'price↓', 'name')],
    ['a different arrow', chain('color', 'cmc↓', 'name')],
    ['one word fewer',    chain('color', 'cmc')],
  ]) assert.strictEqual(app.edit(SEEDED_COLOR, next).edited, true,
    `${what} in the tail left the chain the app's`);

  // A word added is an edit too.
  const price = { criteria: chain('price↓', 'name'), edited: false };
  assert.strictEqual(app.edit(price, chain('price↓', 'cmc', 'name')).edited, true);

  // The first word's own arrow is not: it is the control this app has always
  // had, and the field people are most likely to touch.
  assert.deepStrictEqual(app.edit(SEEDED_COLOR, chain('color↓', 'cmc', 'name')),
    { criteria: chain('color↓', 'cmc', 'name'), edited: false });
});

test('choosing a new first criterion of an edited chain leaves the tail alone', () => {
  const mine = app.edit(SEEDED_COLOR, chain('color', 'price↓', 'name'));
  assert.strictEqual(mine.edited, true);

  // Rarity would seed rarity → colour → name. It does not: only the first word
  // is swapped, and it arrives pointed the way its own field is usually read.
  assert.deepStrictEqual(app.choose(mine, 'rarity'),
    { criteria: chain('rarity', 'price↓', 'name'), edited: true });
  assert.deepStrictEqual(app.choose(mine, 'wanted'),
    { criteria: chain('wanted↓', 'price↓', 'name'), edited: true });

  // A first word that is already in the tail is not said twice — the second
  // occurrence could never fire, and "Price → Price → Name" reads like a bug.
  assert.deepStrictEqual(app.choose(mine, 'price'),
    { criteria: chain('price↓', 'name'), edited: true });
});

test('a chain that is theirs stays theirs until it is re-seeded', () => {
  const mine = app.edit(SEEDED_COLOR, chain('color', 'price↓', 'name'));

  // Put back by hand, and still theirs: the bit is stored rather than worked
  // out from what the field would seed today, because this app's opinion about
  // what Colour suggests will be edited again and a chain somebody made theirs
  // must not fall back into its hands when it is.
  assert.strictEqual(app.edit(mine, chain('color', 'cmc', 'name')).edited, true);

  // Re-seeding is the way back, and it does not ask anyone to know there is a
  // bit to clear. The first word keeps the arrow it was left pointing.
  const desc = app.edit(mine, chain('color↓', 'price↓', 'name'));
  assert.deepStrictEqual(app.reseed(desc),
    { criteria: chain('color↓', 'cmc', 'name'), edited: false });
});

// ── What is already in localStorage ───────────────────────────────────

test('a stored col_<i> becomes the id of the collection at that index', () => {
  const app2 = loadSortUi({ collections: { field: 'col_1', dir: -1 } });
  app2.reconcile(OWNED);
  assert.deepStrictEqual(app2.sortOf('collections'), { field: DECKBOX, dir: -1 },
    'the second collection at the time of the upgrade is not the one the sort now names');
  // Written through, so the index is read once and never again.
  assert.deepStrictEqual(app2.written(), { collections: { field: DECKBOX, dir: -1 } });

  // And it is that collection from then on, wherever the list puts it.
  app2.reconcile([OWNED[1], OWNED[0]]);
  assert.strictEqual(app2.sortOf('collections').field, DECKBOX);
});

test('a stored sort naming a collection that no longer exists is dropped, not repointed', () => {
  // Both shapes of it: an index past the end of the list, which has nothing to
  // migrate to, and an id nothing answers to. Each falls back to the view's
  // default — name ascending — rather than to whichever collection is there.
  for (const field of ['col_7', GONE]) {
    const app2 = loadSortUi({ collections: { field, dir: -1 } });
    app2.reconcile(OWNED);
    assert.deepStrictEqual(app2.sortOf('collections'), { field: 'name', dir: 1 },
      `a stored ${field} did not fall back to name ascending`);
    assert.deepStrictEqual(app2.written(), {}, `a stored ${field} was left in localStorage`);
  }
});

test('reconciling leaves every other view, and every other field, alone', () => {
  // The entry is shared by all five views and only one of them can name a
  // collection. A Want List sorted by Most Wanted is not this migration's
  // business, and neither is a field this app has never heard of.
  const stored = {
    collections: { field: 'col:archidekt:1', dir: 1 },
    wants:       { field: 'wanted', dir: -1 },
    sets:        { field: 'number', dir: 1 },
    scryfall:    { field: 'col_0', dir: 1 },
    deckbuild:   { field: 'nonsense', dir: -1 },
  };
  const app2 = loadSortUi(stored);
  app2.reconcile(OWNED);
  assert.deepStrictEqual(app2.sortOf('wants'),     { field: 'wanted', dir: -1 });
  assert.deepStrictEqual(app2.sortOf('sets'),      { field: 'number', dir: 1 });
  assert.deepStrictEqual(app2.sortOf('deckbuild'), { field: 'nonsense', dir: -1 });
  // Every entry is migrated, not only the Collections one: a `col_<i>` under
  // another view's name is still an index into the same list, and leaving it
  // there is leaving something that will never be readable again.
  assert.deepStrictEqual(app2.sortOf('scryfall'),  { field: BINDER, dir: 1 });
  // A live id is left exactly as it is — reconciling twice is reconciling once.
  assert.deepStrictEqual(app2.sortOf('collections'), { field: BINDER, dir: 1 });
  app2.reconcile(OWNED);
  assert.deepStrictEqual(app2.sortOf('collections'), { field: BINDER, dir: 1 });
});

test('a stored sort that is not a sort at all does not stop the rest being read', () => {
  // localStorage is shared with older versions of this app and with whatever
  // anyone types into a console. Ticket 05 settles what each view does with a
  // value of the wrong shape; what matters here is that reconciling walks past
  // it rather than throwing on the way to the entry that does need migrating.
  const app2 = loadSortUi({ wants: 'rubbish', sets: null, scryfall: 42,
                            collections: { field: 'col_0', dir: 1 } });
  app2.reconcile(OWNED);
  assert.strictEqual(app2.sortOf('collections').field, BINDER);
});

test('the dirty bit is stored with the chain and survives a reload', () => {
  const app2 = loadSortUi();
  app2.saveChain('collections', app2.edit(SEEDED_COLOR, chain('color', 'price↓', 'name')));

  const next = loadSortUi(app2.written());
  assert.deepStrictEqual(next.chainOf('collections'),
    { criteria: chain('color', 'price↓', 'name'), edited: true });
  // So the tail is still theirs a reload later, and choosing a field swaps one
  // word rather than throwing the sentence away.
  assert.deepStrictEqual(next.choose(next.chainOf('collections'), 'rarity').criteria,
    chain('rarity', 'price↓', 'name'));
});

test('a sort stored before chains is one criterion, and is not seeded from', () => {
  // Upgrading must not silently reorder the collection somebody left sorted by
  // Rarity: they get exactly what they had. The chain seeds when they next
  // choose a field, because nobody has edited this one.
  const app2 = loadSortUi({ collections: { field: 'rarity', dir: -1 } });
  assert.deepStrictEqual(app2.chainOf('collections'),
    { criteria: chain('rarity↓'), edited: false });
  assert.deepStrictEqual(app2.choose(app2.chainOf('collections'), 'color').criteria,
    chain('color', 'cmc', 'name'));
});

// ── An existing sort is one criterion, not a chain ────────────────────
// The entry on somebody's machine was written by a version of this app that
// had one field and one arrow, and it is still shared with older versions and
// with whatever anyone types into a console. What is in it is read as what it
// is; what is not a sort resolves to the view's default rather than to a
// broken tab; and none of it is written back until the sort next changes.

/** The five views' field lists, as each view declares them. A stored sort is
 *  read against the list of the view it belongs to, so these are what say
 *  whether a stored field is one that view has ever offered. */
const VIEW_FIELDS = {
  scryfall:  ['name', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'],
  deckbuild: ['name', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'],
  sets:      ['number', 'name', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'],
  wants:     ['wanted', 'player', 'name', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'],
  // Plus one field per loaded collection; see colSortFields.
  collections: ['name', 'qty', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'],
};
const COL_FIELDS = [...VIEW_FIELDS.collections, BINDER, DECKBOX];

/** Everything that can be in the entry and is not a sort. Half a write, a
 *  console experiment, a shape from a version of this app nobody remembers. */
const NOT_A_SORT = [
  'rarity', 42, null, true, [], {}, { dir: -1 }, { field: 5 }, { field: null },
  { criteria: 'name' }, { criteria: 3 }, { criteria: [1, 2, 3] },
  { criteria: [{ dir: 1 }] }, { criteria: [] }, { criteria: null, edited: true },
];

test('reading a sort stored before chains does not rewrite it', () => {
  // A preference somebody chose is not an invitation to write a different one
  // for them — and an entry rewritten on the way past is one older versions of
  // this app, still open in another tab, can no longer read.
  const stored = { collections: { field: 'rarity', dir: -1 } };
  const app2   = loadSortUi(stored);
  const before = app2.rawWritten();

  for (let i = 0; i < 3; i++) {
    app2.chainOf('collections', null, COL_FIELDS);
    app2.sortOf('collections', COL_FIELDS);
  }
  assert.strictEqual(app2.rawWritten(), before, 'reading the entry rewrote it');
  assert.deepStrictEqual(app2.written(), stored);

  // The new shape lands the first time the sort actually changes.
  app2.saveChain('collections', app2.choose(app2.chainOf('collections', null, COL_FIELDS), 'color'));
  assert.deepStrictEqual(app2.written(), {
    collections: { criteria: chain('color', 'cmc', 'name'), edited: false } });
});

test('a stored value that is not a sort at all is the view\'s default', () => {
  for (const value of NOT_A_SORT) {
    const app2 = loadSortUi({ wants: value });
    assert.deepStrictEqual(
      app2.chainOf('wants', { field: 'wanted', dir: -1 }, VIEW_FIELDS.wants),
      { criteria: chain('wanted↓', 'cmc', 'name'), edited: false },
      `a stored ${JSON.stringify(value)} did not fall back to the view's default`);
    // And nothing is written on the way past, so a value nobody can explain is
    // still there to be looked at rather than quietly replaced.
    assert.deepStrictEqual(app2.written(), { wants: value });
  }
});

test('a stored field the view has never supported is the view\'s default', () => {
  // The Set Browser has no Quantity, and a tab cannot sort on a column it does
  // not offer: it is a stored preference for a view somewhere else, or for a
  // column this app retired.
  const app2 = loadSortUi({ sets: { field: 'qty', dir: -1 } });
  assert.deepStrictEqual(app2.chainOf('sets', { field: 'number', dir: 1 }, VIEW_FIELDS.sets).criteria,
    chain('number'));

  // Card Search has neither Most Wanted, nor a set's numbering, nor a
  // collection's own count — each of them a preference stored by a tab that
  // does. Its default is name ascending, and that is where they land.
  for (const field of ['wanted', 'player', 'number', BINDER])
    assert.deepStrictEqual(
      loadSortUi({ scryfall: { field, dir: -1 } })
        .chainOf('scryfall', null, VIEW_FIELDS.scryfall),
      { criteria: chain('name'), edited: false },
      `a stored ${field} on Card Search is not the view's default`);

  // One unsupported word in a chain loses that word and no more — the same
  // thing a criterion naming a collection that is gone does.
  const app3 = loadSortUi({ sets: { criteria: [
    { field: 'qty', dir: -1 }, { field: 'cmc', dir: 1 }], edited: true } });
  assert.deepStrictEqual(app3.chainOf('sets', { field: 'number', dir: 1 }, VIEW_FIELDS.sets),
    { criteria: chain('cmc'), edited: true });

  // A view that has not said what it supports is filtered against nothing, so
  // this is the field list doing it rather than the field being unknown.
  assert.deepStrictEqual(app2.chainOf('sets', { field: 'number', dir: 1 }).criteria,
    chain('qty↓'));
});

test('a stored Total is the Quantity it has always meant', () => {
  // The Collections header wrote `total` before it wrote `qty`, and they are
  // one field: how many of this card are owned altogether. So it is renamed
  // rather than dropped for naming a word the control can no longer display.
  const app2 = loadSortUi({ collections: { field: 'total', dir: -1 } });
  assert.deepStrictEqual(app2.chainOf('collections', null, COL_FIELDS),
    { criteria: chain('qty↓'), edited: false });
  // Still one criterion, still not seeded from, and still not written back.
  assert.deepStrictEqual(app2.written(), { collections: { field: 'total', dir: -1 } });
});

test('a stored chain longer than three is truncated to three', () => {
  const app2 = loadSortUi({ wants: { criteria: [
    { field: 'wanted', dir: -1 }, { field: 'color', dir: 1 }, { field: 'cmc', dir: 1 },
    { field: 'rarity', dir: 1 }, { field: 'price', dir: -1 }], edited: true } });
  assert.deepStrictEqual(app2.chainOf('wants', { field: 'wanted', dir: -1 }, VIEW_FIELDS.wants),
    { criteria: chain('wanted↓', 'color', 'cmc'), edited: true });
});

test('reading the entry never throws, whatever is in it', () => {
  // Not only per view: the entry itself. A truncated write, a list where an
  // object belongs, `undefined` stringified — and JSON.parse throwing on one
  // of them takes down the file every tab gets its controls from, which is a
  // blank app rather than a lost preference.
  for (const raw of ['', '{', '{"wants":', 'undefined', 'null', '[]', '"rarity"', '7', 'NaN']) {
    const app2 = loadSortUi({}, { mtgtools_sort: raw, mtgtools_cols: raw, mtgtools_size: raw });
    assert.deepStrictEqual(
      app2.chainOf('wants', { field: 'wanted', dir: -1 }, VIEW_FIELDS.wants).criteria,
      chain('wanted↓', 'cmc', 'name'), `an entry of ${raw} did not read as nothing stored`);
    // And the migration walks it without throwing either.
    app2.reconcile(OWNED);
  }
});

test('each view migrates on its own — one broken entry is one broken entry', () => {
  // The five views share one localStorage entry, and what is under one view's
  // name is not the other four's business.
  const app2 = loadSortUi({
    collections: { field: 'total', dir: -1 },
    wants:       'rubbish',
    sets:        { criteria: [{ field: 'number', dir: -1 }], edited: true },
    scryfall:    { field: 'wanted', dir: 1 },
    deckbuild:   { field: 'rarity', dir: -1 },
  });
  assert.deepStrictEqual(app2.chainOf('collections', null, COL_FIELDS).criteria, chain('qty↓'));
  assert.deepStrictEqual(app2.chainOf('wants', { field: 'wanted', dir: -1 }, VIEW_FIELDS.wants).criteria,
    chain('wanted↓', 'cmc', 'name'));
  assert.deepStrictEqual(app2.chainOf('sets', { field: 'number', dir: 1 }, VIEW_FIELDS.sets),
    { criteria: chain('number↓'), edited: true });
  assert.deepStrictEqual(app2.chainOf('scryfall', null, VIEW_FIELDS.scryfall).criteria, chain('name'));
  assert.deepStrictEqual(app2.chainOf('deckbuild', { field: 'name', dir: 1 }, VIEW_FIELDS.deckbuild).criteria,
    chain('rarity↓'));
});

test("a view with nothing stored is its own default, seeded", () => {
  // A default is the app's suggestion rather than anybody's preference, so it
  // is the one chain seeded without being asked for — which is why a first
  // visit to the Want List is most-wanted then mana value rather than one
  // enormous block per number of people who want a card.
  const app2 = loadSortUi();
  assert.deepStrictEqual(app2.chainOf('wants', { field: 'wanted', dir: -1 }).criteria,
    chain('wanted↓', 'cmc', 'name'));
  assert.deepStrictEqual(app2.chainOf('sets', { field: 'number', dir: 1 }).criteria,
    chain('number'));
  // And nothing is written until the sort is next changed.
  assert.deepStrictEqual(app2.written(), {});
});

test('a stored chain naming a collection that is gone loses that word', () => {
  const app2 = loadSortUi({ collections: {
    criteria: [{ field: GONE, dir: -1 }, { field: 'cmc', dir: 1 }], edited: true } });
  app2.reconcile(OWNED);
  assert.deepStrictEqual(app2.chainOf('collections'), { criteria: chain('cmc'), edited: true });

  // A chain left with nothing in it goes entirely, rather than sitting in
  // localStorage naming a collection nobody has.
  const app3 = loadSortUi({ collections: { criteria: [{ field: GONE, dir: -1 }], edited: true } });
  app3.reconcile(OWNED);
  assert.deepStrictEqual(app3.written(), {});
});

// ── What arrives that should not ──────────────────────────────────────

test('a chain longer than three is truncated, not honoured and not thrown at', () => {
  // Four criteria can only come from a stored preference or a caller's bug.
  // The first three still say what you asked for; a view that throws is a
  // blank tab.
  const pair = [card('Beta', { prices: { eur: '99.00' } }), card('Alpha', { prices: { eur: '0.10' } })];
  const chain = [{ field: 'cmc', dir: 1 }, { field: 'color', dir: 1 },
                 { field: 'rarity', dir: 1 }, { field: 'price', dir: -1 }];
  // The two are alike in the first three, so only the dropped fourth could
  // put the expensive one first.
  assert.deepStrictEqual(app.order(chain, pair), ['Alpha', 'Beta']);
});

test('a sort with nothing in it is name ascending rather than a thrown error', () => {
  const names = SET.map(c => c.name).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
  assert.deepStrictEqual(app.order([], SET), names);
  assert.deepStrictEqual(app.order(undefined, SET), names,
    'a view that has not read its sort yet still gets a comparator');
});

test('a criterion with no direction is read as ascending', () => {
  // A stored sort from elsewhere, or a chain a caller built by hand: a missing
  // arrow is the arrow every control starts at, not NaN comparisons that leave
  // the list in whatever order it arrived in.
  assert.deepStrictEqual(app.order([{ field: 'cmc' }], SET),
    app.order([{ field: 'cmc', dir: 1 }], SET));
});

// ── The control says the sentence ─────────────────────────────────────

test('the label is the whole chain, in the order it is compared in', () => {
  assert.strictEqual(app.label(chain('color', 'cmc', 'name')),
    'Color → Mana Value → Name');
  assert.strictEqual(app.label(chain('rarity')), 'Rarity');
});

test('a descending word carries its arrow and an ascending one does not', () => {
  // Ascending is how a sort is read unless it says otherwise, so the arrows
  // are spent only where they change the answer.
  assert.strictEqual(app.label(chain('price↓', 'name')), 'Price ↓ → Name');
  assert.strictEqual(app.label(chain('wanted↓', 'cmc↓', 'name')),
    'Most Wanted ↓ → Mana Value ↓ → Name');
});

test("a collection's criterion is labelled with that collection's name", () => {
  // The label is whatever somebody typed, and only the view knows it — which
  // is why the field list is what the label is read against.
  const fields = ['name', 'cmc', { key: BINDER, label: 'Binder' }];
  assert.strictEqual(app.label(chain(`${BINDER}↓`, 'name'), fields), 'Binder ↓ → Name');
});

test('a chain with nothing in it says what the comparator would do with it', () => {
  // Not reachable through the control — the last criterion cannot be removed
  // — but a stored entry can hold anything, and an empty chain is the name
  // tiebreak on its own.
  assert.strictEqual(app.label([]), 'Name');
  assert.strictEqual(app.label(undefined), 'Name');
});

// ── The table header is a shortcut into the same model ────────────────
// The Collections header used to write `{ field, dir }` into the stored entry
// itself, including two fields the control had never heard of. It is two
// gestures into the chain now, and what is asserted here is that they are the
// control's own operations rather than a second sorting system: whatever a
// header click leaves behind, the control can say it and the popover could
// have produced it.

test('a plain click on a column is the sort that column seeds', () => {
  // The same thing choosing it in the control's first row does — the whole
  // sentence, off one click on a heading.
  assert.deepStrictEqual(app.click(SEEDED_COLOR, 'rarity'),
    { criteria: chain('rarity', 'color', 'name'), edited: false });
  assert.deepStrictEqual(app.click(SEEDED_COLOR, 'price'),
    { criteria: chain('price↓', 'name'), edited: false });

  // Including the columns only this tab has: a collection's own quantities is
  // a field like any other now, so its heading seeds like one.
  assert.deepStrictEqual(app.click(SEEDED_COLOR, BINDER, COL_FIELDS),
    { criteria: chain(BINDER + '↓', 'name'), edited: false });
});

test('clicking the column that is already first flips its direction', () => {
  // The gesture this header has always had, and the one thing a click on the
  // leading column cannot be: re-seeding a chain onto its own head would throw
  // away the arrow being toggled.
  const desc = app.click(SEEDED_COLOR, 'color');
  assert.deepStrictEqual(desc, { criteria: chain('color↓', 'cmc', 'name'), edited: false });
  assert.deepStrictEqual(app.click(desc, 'color'), SEEDED_COLOR);

  // The tail is untouched, so the chain is still the app's to re-seed — the
  // first word's arrow was never what made a chain somebody's own.
  const mine = app.edit(SEEDED_COLOR, chain('color', 'price↓', 'name'));
  assert.deepStrictEqual(app.click(mine, 'color'),
    { criteria: chain('color↓', 'price↓', 'name'), edited: true });
});

test('a plain click on an edited chain swaps one word, as the control does', () => {
  // A sentence somebody assembled in the popover is not thrown away by a click
  // on a heading. This is the whole of what the `edited` bit is for, and the
  // header goes through it rather than around it.
  const mine = app.edit(SEEDED_COLOR, chain('color', 'price↓', 'name'));
  assert.deepStrictEqual(app.click(mine, 'rarity'),
    { criteria: chain('rarity', 'price↓', 'name'), edited: true });

  // Which is the select's first row, said faster — the same answer, gesture
  // for gesture, for every column on the table.
  for (const field of [...VIEW_FIELDS.collections, BINDER, DECKBOX])
    if (field !== 'color')
      assert.deepStrictEqual(app.click(mine, field, COL_FIELDS),
        app.choose(mine, field, COL_FIELDS), `clicking ${field} is not choosing it`);
});

test('a shift-click appends the column as the next criterion', () => {
  // "…and then this one", pointed the way that field is usually read.
  const two = app.shiftClick({ criteria: chain('color'), edited: false }, 'price');
  assert.deepStrictEqual(two, { criteria: chain('color', 'price↓'), edited: true });

  // A third word goes on the end of the second.
  assert.deepStrictEqual(app.shiftClick(two, 'name'),
    { criteria: chain('color', 'price↓', 'name'), edited: true });

  // A chain a word was added to is that person's own, so a later click on a
  // heading swaps one word rather than re-seeding the sentence out from under
  // them — and the control offers them Reset to suggested.
  assert.strictEqual(two.edited, true);
});

test('a shift-click on a column already in the chain flips it where it stands', () => {
  // Not duplicated — a chain cannot say the same field twice, and the second
  // occurrence could never fire. Not moved to the end either: that would
  // silently reorder a sentence somebody wrote.
  const flipped = app.shiftClick(SEEDED_COLOR, 'cmc');
  assert.deepStrictEqual(flipped, { criteria: chain('color', 'cmc↓', 'name'), edited: true });
  assert.deepStrictEqual(app.shiftClick(flipped, 'cmc').criteria, chain('color', 'cmc', 'name'));

  // Including the first word, so the gesture means the same thing wherever in
  // the sentence the column it lands on is.
  assert.deepStrictEqual(app.shiftClick(SEEDED_COLOR, 'color').criteria,
    chain('color↓', 'cmc', 'name'));

  // And the length never grows past what was there.
  for (const field of ['color', 'cmc', 'name'])
    assert.strictEqual(app.shiftClick(SEEDED_COLOR, field).criteria.length, 3);
});

test('a shift-click at three criteria spends the last word', () => {
  // Rather than doing nothing. The popover's Add greys out at three and can
  // say why in a tooltip; a shift-click has nowhere to put that sentence, and
  // a gesture that silently does nothing is one people conclude is broken.
  assert.deepStrictEqual(app.shiftClick(SEEDED_COLOR, 'rarity'),
    { criteria: chain('color', 'cmc', 'rarity'), edited: true });

  // The word spent is the last one, which is the one separating the fewest
  // cards — the first two say what they said.
  assert.deepStrictEqual(app.shiftClick(SEEDED_COLOR, 'rarity').criteria.slice(0, 2),
    chain('color', 'cmc'));
});

test('every header click leaves a chain the control can say', () => {
  // The header stops being a second sorting system exactly here: there is no
  // gesture on it that reaches a chain the sort control cannot display, which
  // is the state syncColSortControl() existed to cope with.
  const offered = new Set(COL_FIELDS);
  let sort = { criteria: chain('name'), edited: false };
  for (const field of [...VIEW_FIELDS.collections, BINDER, DECKBOX, 'qty', 'color']) {
    for (const gesture of ['click', 'shiftClick']) {
      sort = app[gesture](sort, field, COL_FIELDS);
      assert.ok(sort.criteria.length >= 1 && sort.criteria.length <= 3,
        `${gesture} on ${field} left ${sort.criteria.length} criteria`);
      // Every word is a field this tab offers, and no word is said twice.
      const seen = new Set();
      for (const c of sort.criteria) {
        assert.ok(offered.has(c.field), `${gesture} on ${field} left an unknown word ${c.field}`);
        assert.ok(!seen.has(c.field), `${gesture} on ${field} said ${c.field} twice`);
        seen.add(c.field);
        assert.ok(c.dir === 1 || c.dir === -1, 'a word with no direction');
      }
      // And the label says the whole of it rather than falling back to Name.
      assert.strictEqual(app.label(sort.criteria, COL_FIELDS).split(' → ').length,
        sort.criteria.length);
    }
  }
});

test('a column carrying a later criterion knows where in the chain it is', () => {
  // What the header's marks are a function of: 0 is the arrow the column that
  // cuts the piles has always carried, 1 and 2 are the words a shift-click
  // added, and -1 is a column the sort does not mention. Without the position
  // a shift-click is an invisible feature.
  const three = chain('color', 'cmc↓', 'name');
  assert.strictEqual(app.columnAt(three, 'color'), 0);
  assert.strictEqual(app.columnAt(three, 'cmc'), 1);
  assert.strictEqual(app.columnAt(three, 'name'), 2);
  assert.strictEqual(app.columnAt(three, 'rarity'), -1);
  assert.strictEqual(app.columnAt([], 'name'), -1);
  assert.strictEqual(app.columnAt(undefined, 'name'), -1);
});
