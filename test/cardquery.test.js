/* What the Collections search box understands.
 *
 * The search box reads Scryfall's query language and runs it against the card
 * facts the app already caches, so the questions people ask about their own
 * shelves — "which red creatures under three mana do we own" — are asked in
 * the language they already use on the Scryfall tab.
 *
 * What is asserted here is what the tab rests on: a bare word still means
 * what it has always meant, every filter reads the field it claims to, a
 * query that cannot mean anything says so rather than matching nothing, and
 * `needsMeta` is honest — because a false one there is a filter run against a
 * cache that isn't filled yet, which returns a wrong answer rather than a
 * slow one.
 *
 * The shipped public/js/cardquery.js is run against an empty sandbox, the way
 * test/cardsort.test.js runs the sort control, so these assert on the code the
 * browser is served rather than on a copy of it. The file is pure — it reads
 * no globals at all — which is why the sandbox below is bare.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function loadCardQuery() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/cardquery.js'), sandbox);
  /* `parseCardQuery` is a top-level function declaration, so it is on the
   * sandbox object; the rest of the file's helpers are its own business. */
  return sandbox.parseCardQuery;
}

const parseCardQuery = loadCardQuery();

/* A card as the search sees one: the name off a collection row, spread with
 * the facts out of scryfallMetaCache. The defaults are what an unresolved
 * card looks like — everything empty — so a test only says the fields it is
 * actually about. */
function card(name, meta = {}) {
  return {
    name, cmc: 0, colors: [], ci: [], type: '', oracle: '', mana: '',
    rarity: '', set: '', layout: '', power: undefined, toughness: undefined,
    eur: null, usd: null, ...meta,
  };
}

const BOLT   = card('Lightning Bolt', {
  cmc: 1, colors: ['R'], ci: ['R'], type: 'Instant', mana: '{R}',
  oracle: 'Lightning Bolt deals 3 damage to any target.', rarity: 'common',
  set: 'lea', layout: 'normal', eur: 3.5, usd: 4,
});
const GOBLIN = card('Goblin Guide', {
  cmc: 1, colors: ['R'], ci: ['R'], type: 'Creature — Goblin Scout', mana: '{R}',
  oracle: 'Haste\nWhenever Goblin Guide attacks, defending player reveals the top card of their library.',
  power: '2', toughness: '2', rarity: 'rare', set: 'zen', layout: 'normal', eur: 12,
});
const HYDRA  = card('Ghalta, Primal Hunger', {
  cmc: 12, colors: ['G'], ci: ['G'], type: 'Legendary Creature — Elder Dinosaur',
  mana: '{10}{G}{G}', oracle: 'Trample\nGhalta, Primal Hunger costs {X} less to cast…',
  power: '12', toughness: '12', rarity: 'rare', set: 'rix', layout: 'normal',
});
const FIRES  = card('Fires of Victory', {
  cmc: 4, colors: ['U', 'R'], ci: ['U', 'R'], type: 'Instant', mana: '{2}{U}{R}',
  oracle: 'Draw a card.', rarity: 'uncommon', set: 'apc', layout: 'normal',
});
const WASTES = card('Wastes', {
  cmc: 0, colors: [], ci: [], type: 'Basic Land', mana: '',
  oracle: '{T}: Add {C}.', rarity: 'common', set: 'ogw', layout: 'normal',
});

const ALL = [BOLT, GOBLIN, HYDRA, FIRES, WASTES];

/* Which of the five a query keeps, by name, in the order they are listed
 * above — so an assertion reads as the answer somebody would have expected to
 * see in the table. */
function found(text) {
  const q = parseCardQuery(text);
  return ALL.filter(c => q.match(c)).map(c => c.name);
}

// ── A bare word is still a name search ────────────────────────────────────
test('a bare word matches card names, case-insensitively', () => {
  assert.deepStrictEqual(found('bolt'),    ['Lightning Bolt']);
  assert.deepStrictEqual(found('GOBLIN'),  ['Goblin Guide']);
});

test('two bare words both have to match the name', () => {
  assert.deepStrictEqual(found('lightning bolt'), ['Lightning Bolt']);
  assert.deepStrictEqual(found('lightning ghalta'), []);
});

test('a quoted phrase matches as one string', () => {
  assert.deepStrictEqual(found('"primal hunger"'), ['Ghalta, Primal Hunger']);
  assert.deepStrictEqual(found('"hunger primal"'), []);
});

test('! is an exact name', () => {
  assert.deepStrictEqual(found('!"Lightning Bolt"'), ['Lightning Bolt']);
  assert.deepStrictEqual(found('!"Lightning"'),      []);
});

test('a name search needs nothing but the row', () => {
  assert.strictEqual(parseCardQuery('bolt').needsMeta, false);
  assert.strictEqual(parseCardQuery('"primal hunger"').needsMeta, false);
  assert.strictEqual(parseCardQuery('!Wastes').needsMeta, false);
});

test('an empty search is not a filter', () => {
  assert.strictEqual(parseCardQuery(''),    null);
  assert.strictEqual(parseCardQuery('   '), null);
});

// ── Types and text ────────────────────────────────────────────────────────
test('t: reads the type line', () => {
  assert.deepStrictEqual(found('t:creature'), ['Goblin Guide', 'Ghalta, Primal Hunger']);
  assert.deepStrictEqual(found('t:goblin'),   ['Goblin Guide']);
  assert.deepStrictEqual(found('t:"legendary creature"'), ['Ghalta, Primal Hunger']);
});

test('o: reads the rules text and not the name', () => {
  assert.deepStrictEqual(found('o:draw'),     ['Fires of Victory']);
  assert.deepStrictEqual(found('o:trample'),  ['Ghalta, Primal Hunger']);
  assert.deepStrictEqual(found('o:library'),  ['Goblin Guide']);
  /* Wastes is named Wastes and its rules text says "{T}: Add {C}.", so the
     two searches cannot both be a name search. */
  assert.deepStrictEqual(found('wastes'),     ['Wastes']);
  assert.deepStrictEqual(found('o:wastes'),   []);
});

test('~ in o: is the card’s own name', () => {
  assert.deepStrictEqual(found('o:"~ deals"'), ['Lightning Bolt']);
});

// ── Numbers ───────────────────────────────────────────────────────────────
test('mv compares, and : means =', () => {
  assert.deepStrictEqual(found('mv:1'),   ['Lightning Bolt', 'Goblin Guide']);
  assert.deepStrictEqual(found('mv=1'),   ['Lightning Bolt', 'Goblin Guide']);
  assert.deepStrictEqual(found('mv>=4'),  ['Ghalta, Primal Hunger', 'Fires of Victory']);
  assert.deepStrictEqual(found('cmc<1'),  ['Wastes']);
});

test('power and toughness compare, and a card without them matches nothing', () => {
  assert.deepStrictEqual(found('pow>=12'), ['Ghalta, Primal Hunger']);
  assert.deepStrictEqual(found('tou<3'),   ['Goblin Guide']);
  assert.deepStrictEqual(found('pow>=0'),  ['Goblin Guide', 'Ghalta, Primal Hunger']);
});

test('prices compare', () => {
  assert.deepStrictEqual(found('eur>5'),  ['Goblin Guide']);
  assert.deepStrictEqual(found('usd<=4'), ['Lightning Bolt']);
});

// ── Colours ───────────────────────────────────────────────────────────────
test('c: is "at least these colours"', () => {
  assert.deepStrictEqual(found('c:r'),  ['Lightning Bolt', 'Goblin Guide', 'Fires of Victory']);
  assert.deepStrictEqual(found('c:ur'), ['Fires of Victory']);
});

test('c= is exactly these colours', () => {
  assert.deepStrictEqual(found('c=r'),  ['Lightning Bolt', 'Goblin Guide']);
  assert.deepStrictEqual(found('c=ur'), ['Fires of Victory']);
});

test('c<= is "nothing outside these"', () => {
  assert.deepStrictEqual(found('c<=r'), ['Lightning Bolt', 'Goblin Guide', 'Wastes']);
});

test('colour names and guild names are colours', () => {
  assert.deepStrictEqual(found('c:red'),    found('c:r'));
  assert.deepStrictEqual(found('c:izzet'),  ['Fires of Victory']);
  assert.deepStrictEqual(found('c:white'),  []);
});

test('c:m is multicolour and c:c is colourless', () => {
  assert.deepStrictEqual(found('c:m'), ['Fires of Victory']);
  assert.deepStrictEqual(found('c:c'), ['Wastes']);
});

test('id: reads colour identity', () => {
  assert.deepStrictEqual(found('id<=ur'), ['Lightning Bolt', 'Goblin Guide', 'Fires of Victory', 'Wastes']);
});

// ── Rarity, sets, mana costs, shapes ──────────────────────────────────────
test('rarity is ordered, not alphabetical', () => {
  assert.deepStrictEqual(found('r:rare'),   ['Goblin Guide', 'Ghalta, Primal Hunger']);
  assert.deepStrictEqual(found('r>=rare'),  ['Goblin Guide', 'Ghalta, Primal Hunger']);
  assert.deepStrictEqual(found('r<rare'),   ['Lightning Bolt', 'Fires of Victory', 'Wastes']);
  assert.deepStrictEqual(found('r:c'),      found('r:common'));
});

test('s: is the set code', () => {
  assert.deepStrictEqual(found('s:zen'), ['Goblin Guide']);
  assert.deepStrictEqual(found('e:LEA'), ['Lightning Bolt']);
});

/* `:` is a superset test, so `m:{R}` finds the two mono-red cards *and* the
 * {2}{U}{R} instant — every cost with a red pip in it. `=` is the whole cost,
 * which is how you ask for the one-mana ones. */
test('m: is "the cost contains at least this", m= is the whole cost', () => {
  assert.deepStrictEqual(found('m:{R}'),      ['Lightning Bolt', 'Goblin Guide', 'Fires of Victory']);
  assert.deepStrictEqual(found('m:{G}{G}'),   ['Ghalta, Primal Hunger']);
  assert.deepStrictEqual(found('m:2UR'),      ['Fires of Victory']);
  assert.deepStrictEqual(found('m={R}'),      ['Lightning Bolt', 'Goblin Guide']);
  assert.deepStrictEqual(found('m={G}{G}'),   []);
  assert.deepStrictEqual(found('m<={R}'),     ['Lightning Bolt', 'Goblin Guide', 'Wastes']);
});

test('is: asks about the shape of a card', () => {
  assert.deepStrictEqual(found('is:permanent'), ['Goblin Guide', 'Ghalta, Primal Hunger', 'Wastes']);
  assert.deepStrictEqual(found('is:spell'),     ['Lightning Bolt', 'Goblin Guide', 'Ghalta, Primal Hunger', 'Fires of Victory']);
  assert.deepStrictEqual(found('is:multicolor'), ['Fires of Victory']);
  assert.deepStrictEqual(found('not:land'),     ['Lightning Bolt', 'Goblin Guide', 'Ghalta, Primal Hunger', 'Fires of Victory']);
});

// ── Putting terms together ────────────────────────────────────────────────
test('terms side by side all have to hold', () => {
  assert.deepStrictEqual(found('t:creature c:r'), ['Goblin Guide']);
  assert.deepStrictEqual(found('t:creature mv>=10 c:g'), ['Ghalta, Primal Hunger']);
});

test('- is not', () => {
  assert.deepStrictEqual(found('c:r -t:creature'), ['Lightning Bolt', 'Fires of Victory']);
  assert.deepStrictEqual(found('-c:r'),            ['Ghalta, Primal Hunger', 'Wastes']);
});

test('OR is or, and parentheses group', () => {
  assert.deepStrictEqual(found('t:goblin OR t:dinosaur'), ['Goblin Guide', 'Ghalta, Primal Hunger']);
  assert.deepStrictEqual(found('c:g OR (c=r t:instant)'), ['Lightning Bolt', 'Ghalta, Primal Hunger']);
  assert.deepStrictEqual(found('-(c:r OR c:g)'),          ['Wastes']);
});

test('AND may be said out loud', () => {
  assert.deepStrictEqual(found('t:creature AND c:r'), found('t:creature c:r'));
});

/* Scryfall's own rule, kept rather than improved on: only capitals are
 * operators, because "Now or Never" is a card and a search language that
 * quietly rewrites a typed name is worse than one that wants a shift key. */
test('lower-case or is a word in a name, not an operator', () => {
  assert.deepStrictEqual(found('t:goblin or t:dinosaur'), []);
});

// ── Anything that reads a card needs the cache filled ─────────────────────
test('needsMeta is true as soon as a term reads more than the name', () => {
  for (const q of ['t:creature', 'o:draw', 'c:r', 'mv>2', 'r:rare', 'm:{R}',
                   's:zen', 'is:land', 'eur>1', 'pow>2', 'bolt t:instant',
                   'bolt OR t:instant', '-t:land']) {
    assert.strictEqual(parseCardQuery(q).needsMeta, true, q);
  }
});

// ── A query that cannot mean anything says so ─────────────────────────────
test('an unknown filter is refused by name', () => {
  assert.throws(() => parseCardQuery('zzz:1'), /Unknown filter "zzz:"/);
});

test('a real Scryfall filter this app cannot answer says why', () => {
  assert.throws(() => parseCardQuery('f:commander'), /format legality/);
  assert.throws(() => parseCardQuery('a:"Rebecca Guay"'), /artist/);
});

test('a value that is not one is refused', () => {
  assert.throws(() => parseCardQuery('mv:soon'),  /expected a number/);
  assert.throws(() => parseCardQuery('r:shiny'),  /is not a rarity/);
  assert.throws(() => parseCardQuery('c:pink'),   /is not a colour/);
  assert.throws(() => parseCardQuery('is:foil'),  /isn’t one of/);
});

test('unbalanced quotes and parentheses are refused', () => {
  assert.throws(() => parseCardQuery('"unclosed'),   /Unclosed quote/);
  assert.throws(() => parseCardQuery('(c:r'),        /Unclosed \(/);
  assert.throws(() => parseCardQuery('c:r)'),        /Unmatched \)/);
});

/* Typing is not an error. `t:` on its way to `t:creature` is a filter with
 * nothing in it yet, and the table it is filtering must not flash a red
 * message between two keystrokes. */
test('a filter with nothing after it yet matches everything', () => {
  assert.deepStrictEqual(found('t:'), ALL.map(c => c.name));
  assert.deepStrictEqual(found('c:r t:'), ['Lightning Bolt', 'Goblin Guide', 'Fires of Victory']);
});

// ── A card the local database never resolved ──────────────────────────────
/* Unresolved names are cached as `{}`, so this is what a filter sees for a
 * card nothing is known about: it answers about its own name and declines
 * everything else, rather than throwing halfway down a table. */
test('a card with no facts matches its name and nothing else', () => {
  const unknown = { name: 'Some Proxy' };
  assert.strictEqual(parseCardQuery('proxy').match(unknown), true);
  assert.strictEqual(parseCardQuery('t:creature').match(unknown), false);
  assert.strictEqual(parseCardQuery('c:c').match(unknown), true);
  assert.strictEqual(parseCardQuery('mv>=0').match(unknown), false);
});
