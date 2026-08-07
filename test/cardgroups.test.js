/* What a pile is a pile of.
 *
 * The stack view on the browsing tabs has no control of its own: the cards are
 * grouped by whatever the tab is sorted by, which is one decision — the sort
 * field's label for a card — written as a function of that card so it can be
 * asserted here rather than eyeballed in a browser. What is asserted is the
 * property the view rests on: every card lands in exactly one pile, the piles
 * come out in the order the sort put them in, and a field whose values are all
 * different is bucketed rather than drawn as a thousand piles of one.
 *
 * The shipped public/js/sortui.js is run against stub browser globals, the way
 * test/cardsize.test.js runs the size control, so these assert on the code the
 * browser is served rather than on a copy of it.
 *
 * A sort became a sentence, so this file grew a second helper and a section of
 * its own at the end: the first criterion cuts the piles and the rest order the
 * cards inside each one. Nothing above it changed except how `piles` is
 * spelled — it is `chainPiles` of a one-criterion sentence now, which is what
 * it always was — because the property every one of those tests rests on is
 * the same property, and a one-word sentence is still a sentence.
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
 *  own metadata. */
function loadSortUi() {
  const sandbox = {
    localStorage: { getItem: () => null, setItem() {} },
    document: { addEventListener() {} },
    scryfallMetaCache: new Map(),
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/sortui.js'), sandbox);
  /** Stacking as a tab does it: the whole sentence orders the cards, its first
   *  word cuts them into piles. Spread into an array of this realm's, so that a
   *  deepStrictEqual on what comes back compares the piles rather than which
   *  context built them. */
  const chainPiles = (criteria, cards, ctx) =>
    [...sandbox.cardGroups(criteria[0]?.field || 'name',
                           cards.slice().sort(sandbox.cardComparator(criteria, ctx)), ctx)];
  return {
    label:  (field, card, ctx) => sandbox.groupLabel(field, card, ctx),
    chain:  chainPiles,
    /** One field and one arrow, which is a sentence of one word. */
    piles:  (field, cards, dir = 1, ctx) => chainPiles([{ field, dir }], cards, ctx),
  };
}

const app = loadSortUi();

/** A Scryfall card, as much of one as the sort vocabulary reads. */
function card(name, props = {}) {
  return { name, cmc: 0, colors: [], color_identity: [], type_line: 'Creature', rarity: 'common', ...props };
}

const SET = [
  card('Ancestral Recall',  { cmc: 1, colors: ['U'], color_identity: ['U'], rarity: 'mythic',   type_line: 'Instant',  prices: { eur: '3000.00' }, collector_number: '48'  }),
  card('Birds of Paradise', { cmc: 1, colors: ['G'], color_identity: ['G'], rarity: 'rare',     type_line: 'Creature — Bird', prices: { eur: '8.50' }, collector_number: '112' }),
  card('Counterspell',      { cmc: 2, colors: ['U'], color_identity: ['U'], rarity: 'common',   type_line: 'Instant',  prices: { eur: '0.40' },   collector_number: '3'   }),
  card('Doom Blade',        { cmc: 2, colors: ['B'], color_identity: ['B'], rarity: 'common',   type_line: 'Instant',  prices: { eur: '0.20' },   collector_number: '204' }),
  card('Emrakul, the Aeons Torn', { cmc: 15, colors: [], color_identity: [], rarity: 'mythic',  type_line: 'Legendary Creature — Eldrazi', prices: { eur: '45.00' }, collector_number: '4' }),
  card('Forest',            { cmc: 0, colors: [], color_identity: ['G'], rarity: 'common',      type_line: 'Basic Land — Forest', prices: { eur: '0.10' }, collector_number: '300' }),
  card('Grave Titan',       { cmc: 6, colors: ['B'], color_identity: ['B'], rarity: 'mythic',   type_line: 'Creature — Giant', prices: { eur: '12.00' }, collector_number: '95' }),
  card('Lightning Helix',   { cmc: 2, colors: ['R', 'W'], color_identity: ['R', 'W'], rarity: 'uncommon', type_line: 'Instant', prices: { eur: '2.00' }, collector_number: '190' }),
];

// ── The property the view rests on ────────────────────────────────────

test('every card is in exactly one pile, whatever it is stacked by', () => {
  for (const field of ['name', 'cmc', 'color', 'rarity', 'type', 'price', 'power', 'number']) {
    const piles = app.piles(field, SET);
    const names = piles.flatMap(p => p.cards.map(c => c.name)).sort();
    assert.deepStrictEqual(names, SET.map(c => c.name).sort(),
      `stacked by ${field}, the piles do not hold the set exactly once`);
    assert.deepStrictEqual([...new Set(piles.map(p => p.label))], piles.map(p => p.label),
      `stacked by ${field}, two piles carry the same label`);
  }
});

test('the piles come out in the order the sort put the cards in', () => {
  // Which is what makes the mana-value stacking read as a curve rather than as
  // a set of piles that happen to be labelled with numbers.
  const up   = app.piles('cmc', SET, 1).map(p => p.label);
  const down = app.piles('cmc', SET, -1).map(p => p.label);
  assert.deepStrictEqual(up, ['0', '1', '2', '6', '7+'],
    'ascending mana value does not read left to right');
  assert.deepStrictEqual(down, up.slice().reverse(),
    'reversing the sort does not turn the row of stacks around');
});

test('changing the sort field restacks the table', () => {
  const byRarity = app.piles('rarity', SET).map(p => p.label);
  const byType   = app.piles('type',   SET).map(p => p.label);
  assert.deepStrictEqual(byRarity, ['Common', 'Uncommon', 'Rare', 'Mythic']);
  assert.deepStrictEqual(byType,   ['Creatures', 'Instants', 'Lands']);
});

// ── What each field's piles are ───────────────────────────────────────

test('by rarity, one pile per rarity, of the heights a booster is made of', () => {
  const piles = Object.fromEntries(app.piles('rarity', SET).map(p => [p.label, p.cards.length]));
  assert.deepStrictEqual(piles, { Common: 3, Uncommon: 1, Rare: 1, Mythic: 3 });
});

test('by name, a pile per initial letter', () => {
  assert.deepStrictEqual(app.piles('name', SET).map(p => p.label),
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'L']);
  assert.strictEqual(app.label('name', { name: '9th Edition Sample' }), '#',
    'a name that does not start with a letter has one pile with the rest of them');
});

test('by colour, the five plus multicolour and colourless', () => {
  assert.deepStrictEqual(app.piles('color', SET).map(p => p.label),
    ['Blue', 'Black', 'Green', 'Multicolor', 'Colorless']);
});

test('the curve stops where a curve stops', () => {
  // Everything from seven up is one pile: the difference between fifteen mana
  // and eight is not a shape anyone reads off a table, and a stack of one for
  // each is a row that says less than the curve does.
  assert.strictEqual(app.label('cmc', card('Emrakul, the Aeons Torn', { cmc: 15 })), '7+');
  assert.strictEqual(app.label('cmc', card('Ulamog', { cmc: 8 })), '7+');
  assert.strictEqual(app.label('cmc', card('Grave Titan', { cmc: 6 })), '6');
});

test('a field whose every value differs is bucketed, not drawn one pile per card', () => {
  // Price and collector number are unique per card. Stacking on the value
  // itself would draw four hundred stacks of one, which is a grid with worse
  // spacing.
  for (const field of ['price', 'number']) {
    const piles = app.piles(field, SET);
    assert.ok(piles.length < SET.length,
      `${field} draws ${piles.length} piles for ${SET.length} cards`);
  }
  assert.deepStrictEqual(app.piles('price', SET).map(p => p.label),
    ['< €1', '€1–5', '€5–20', '€20+']);
  assert.deepStrictEqual(app.piles('number', SET).map(p => p.label),
    ['#1–99', '#100–199', '#200–299', '#300–399']);
});

test('a pile cut on a quantity is labelled with the quantity, from the context', () => {
  /* How many of a card are owned is not on the card — it is in the collections
     the view hands over. Collections stacks by Total and by one collection's
     own count, and both used to be translated into a third field on their way
     here because the grouping had never heard of them. */
  const owned = [
    { key: 'csv:1', name: 'Binder',  cards: new Map([['Counterspell', { qty: 4 }], ['Doom Blade', { qty: 1 }]]) },
    { key: 'csv:2', name: 'Deckbox', cards: new Map([['Doom Blade',   { qty: 3 }], ['Forest',     { qty: 4 }]]) },
  ];
  const cards = [card('Counterspell'), card('Doom Blade'), card('Forest'), card('Grave Titan')];

  assert.deepStrictEqual(app.piles('qty', cards, 1, { collections: owned }).map(p => p.label),
    ['×0', '×4'], 'Grave Titan is owned none times; the other three are owned four');
  assert.deepStrictEqual(app.piles('col:csv:1', cards, 1, { collections: owned }).map(p => p.label),
    ['×0', '×1', '×4'], 'one collection is its own stacking, not the total');
  assert.deepStrictEqual(app.piles('col:csv:9', cards, 1, { collections: owned }).map(p => p.label),
    ['C', 'D', 'F', 'G'],
    'a pile cut on a collection that is not loaded is the initial letter, where every unknown field piles');
  assert.strictEqual(app.label('qty', card('Doom Blade')), '×0',
    'a quantity with no collections behind it is one pile rather than a thrown error');
});

// ── The first criterion cuts the piles ────────────────────────────────
// The rest order the cards inside each one, which is rarity piles each
// standing in curve order — the arrangement this app could not draw while a
// sort was one field and one arrow.

/** The piles as they are read off a table: what each is labelled, and what is
 *  in it top to bottom. A pile's `cards` was built inside the sandbox, so the
 *  names are copied into an array of this realm's — `deepStrictEqual` compares
 *  prototypes, and two identical lists from two contexts are not equal. */
const table = piles => piles.map(p => [p.label, [...p.cards.map(c => c.name)]]);

test('the first criterion cuts the piles, the rest order the cards inside each one', () => {
  assert.deepStrictEqual(
    table(app.chain([{ field: 'rarity', dir: 1 }, { field: 'cmc', dir: 1 }], SET)),
    [['Common',   ['Forest', 'Counterspell', 'Doom Blade']],
     ['Uncommon', ['Lightning Helix']],
     ['Rare',     ['Birds of Paradise']],
     ['Mythic',   ['Ancestral Recall', 'Grave Titan', 'Emrakul, the Aeons Torn']]],
    'the piles are not cut on rarity, or they are not standing in curve order');

  // The same piles, and every one of them in a different order: the sentence's
  // first word was left alone and its second one changed.
  assert.deepStrictEqual(
    table(app.chain([{ field: 'rarity', dir: 1 }, { field: 'price', dir: -1 }], SET)),
    [['Common',   ['Counterspell', 'Doom Blade', 'Forest']],
     ['Uncommon', ['Lightning Helix']],
     ['Rare',     ['Birds of Paradise']],
     ['Mythic',   ['Ancestral Recall', 'Emrakul, the Aeons Torn', 'Grave Titan']]]);
});

test('changing the first criterion restacks the table; changing a later one does not', () => {
  const labels = criteria => app.chain(criteria, SET).map(p => p.label);
  const byRarity = [{ field: 'rarity', dir: 1 }, { field: 'cmc', dir: 1 }];

  assert.deepStrictEqual(labels([{ field: 'rarity', dir: 1 }, { field: 'price', dir: -1 }]),
    labels(byRarity), 'a second word the piles do not read restacked the table');
  assert.deepStrictEqual(labels([{ field: 'cmc', dir: 1 }, { field: 'rarity', dir: 1 }]),
    ['0', '1', '2', '6', '7+'], 'a new first word did not restack the table');
});

test('reversing the first criterion turns the row of piles around and leaves them standing', () => {
  // Which is the direction doing one thing rather than two: the piles come out
  // in the order the sort put them in, and what is inside each one is the tail
  // of the sentence, which did not change.
  const up   = app.chain([{ field: 'rarity', dir:  1 }, { field: 'cmc', dir: 1 }], SET);
  const down = app.chain([{ field: 'rarity', dir: -1 }, { field: 'cmc', dir: 1 }], SET);
  assert.deepStrictEqual(table(down), table(up).slice().reverse());
});

test('every card is in exactly one pile, however long the sentence is', () => {
  // The property the whole view rests on does not weaken as criteria are added:
  // a card is in the pile its first criterion puts it in, and in no other.
  const chains = [
    [{ field: 'color', dir: 1 }, { field: 'cmc', dir: 1 }, { field: 'name', dir: 1 }],
    [{ field: 'cmc', dir: -1 }, { field: 'rarity', dir: -1 }, { field: 'price', dir: -1 }],
    [{ field: 'type', dir: 1 }, { field: 'price', dir: -1 }],
    [],   // no sentence at all: name ascending, where every empty chain lands
  ];
  for (const criteria of chains) {
    const piles = app.chain(criteria, SET);
    const names = piles.flatMap(p => p.cards.map(c => c.name)).sort();
    assert.deepStrictEqual(names, SET.map(c => c.name).sort(),
      `sorted by ${JSON.stringify(criteria)}, the piles do not hold the set exactly once`);
    assert.deepStrictEqual([...new Set(piles.map(p => p.label))], piles.map(p => p.label),
      `sorted by ${JSON.stringify(criteria)}, two piles carry the same label`);
  }
});

test('what the app has not been told is one pile and says so', () => {
  // Not one pile per unknown: a set whose prices have not loaded is a table
  // with one unpriced stack on it, not four hundred stacks of one card.
  const unknown = [card('A', { cmc: undefined, prices: {} }), card('B', { cmc: undefined, prices: {} })];
  const piles = app.piles('price', unknown);
  assert.strictEqual(piles.length, 1);
  assert.strictEqual(piles[0].cards.length, 2);
  assert.strictEqual(app.label('power', card('Counterspell')), app.label('power', card('Doom Blade')),
    'two cards with no power at all are in the same pile');
  assert.strictEqual(app.label('power', card('Tarmogoyf', { power: '*' })),
    app.label('power', card('Counterspell')),
    'a power that is not a number lies where the sort already puts it');
});
