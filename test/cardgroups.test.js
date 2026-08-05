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
  return {
    label:  (field, card) => sandbox.groupLabel(field, card),
    /** Grouping as a tab does it: the sorted list, cut into piles. Spread into
     *  an array of this realm's, so that a deepStrictEqual on what comes back
     *  compares the piles rather than which context built them. */
    piles:  (field, cards, dir = 1) =>
      [...sandbox.cardGroups(field, cards.slice().sort(sandbox.cardComparator(field, dir)))],
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
