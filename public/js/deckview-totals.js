// ── Deck Builder — What the deck is, counted once ─────────────────────────
// Every number the readout and the analysis strip say about a deck, worked out
// in one pass and held until the deck changes.
//
// Before this the readout was a handful of reduces written where they were
// drawn. What this ticket adds — what the deck costs, what finishing it costs,
// the type breakdown, the split, and a curve that can be cut into colours — is
// four more deck-wide passes of the same kind, and four more written the same
// way is how a mat starts to feel slow.
//
// ── One pass, and none of it on render ────────────────────────────────────
//
// The mat's animation is bounded to what is on screen and a deck-wide analysis
// running beside it would undo that, so nothing here is reached from
// dbRender(). It is reached from dbRenderStats(), which is called when the deck
// changes — an edit, an import, a restore, a shelf arriving, the ownership
// scope moving — and the answer is then kept. Opening the analysis strip,
// cutting the curve into colours and folding it back again cost no pass at all:
// they are three ways of drawing an answer that has already been worked out.
//
// ── What counts ───────────────────────────────────────────────────────────
//
// The deck is the mainboard. The count, the curve, the average mana value, the
// type breakdown and the split all read it alone, which is the whole of what
// makes a maybeboard somewhere you can put a card without breaking the
// ninety-nine — and it is why the commander does not bend the curve either: it
// is not one of the ninety-nine.
//
// The money is the exception, and the one place the commander is added in.
// "What does finishing this deck cost" is a question about a box you can sleeve
// tonight, and a deck you cannot sit down with because you have not bought its
// commander is not finished. So the two figures on the readout answer two
// different questions on purpose: "87 of 99 you own" goes on counting the deck,
// and the price counts what you would have to buy.

/* The one pass, kept. Null means nobody has asked since the deck changed. */
let _dbTotals = null;

/* The deck changed — say it again from scratch next time somebody asks.
 * dbRenderStats() calls this, because being called *is* what "the deck
 * changed" means on this tab: every one of its callers is a moment one of the
 * three things this pass reads has moved. */
function dbTotalsChanged() { _dbTotals = null; }

/** Everything the readout and the analysis strip say, worked out at most once. */
function dbDeckTotals() {
  return _dbTotals || (_dbTotals = _dbComputeTotals());
}

// ── The vocabulary ────────────────────────────────────────────────────────

/* The buckets a card falls into, in the order they are tested. It is
 * dbAutoCategory()'s order and not a second opinion of it — an Artifact
 * Creature is a creature in both, so the breakdown reads like the piles on the
 * mat rather than disagreeing with them by four. Each card lands in exactly one
 * bucket, which is what lets the breakdown add up to the deck. */
const DB_TYPES = [
  { id: 'creature',     one: 'creature',     many: 'creatures',     match: 'creature' },
  { id: 'planeswalker', one: 'planeswalker', many: 'planeswalkers', match: 'planeswalker' },
  { id: 'instant',      one: 'instant',      many: 'instants',      match: 'instant' },
  { id: 'sorcery',      one: 'sorcery',      many: 'sorceries',     match: 'sorcery' },
  { id: 'enchantment',  one: 'enchantment',  many: 'enchantments',  match: 'enchantment' },
  { id: 'artifact',     one: 'artifact',     many: 'artifacts',     match: 'artifact' },
  { id: 'battle',       one: 'battle',       many: 'battles',       match: 'battle' },
  { id: 'land',         one: 'land',         many: 'lands',         match: 'land' },
  { id: 'other',        one: 'other',        many: 'other',         match: null },
];

/* Which of those is a permanent, which is a spell, and which is neither
 * argument. Lands are permanents by the rules and are pulled out of the split
 * anyway: a Commander deck is a third lands, so a "permanents vs spells" line
 * that buried thirty-seven of them in the first number would say the same thing
 * about every deck ever built. Taken out, the split says the thing it is for —
 * of the cards you cast, how many stay on the table. */
const DB_SPELL_TYPES = new Set(['instant', 'sorcery']);

/* The bands a curve bar is cut into. One band per *card*, not one per colour a
 * card is: a gold card counted under each of its colours would make the bars
 * add up to more than the deck, and a curve that does not add up to the deck is
 * not a curve. Multicolour is a band of its own for that reason, in the gold
 * the rest of the app already draws it in.
 *
 * The tokens are named rather than the hexes repeated, the way js/lands.js
 * names them: this is Magic colour used as data, and which hue each theme tunes
 * it to is the theme's. */
const DB_CURVE_COLORS = [
  { id: 'W', label: 'white',       ink: 'var(--mc-w)' },
  { id: 'U', label: 'blue',        ink: 'var(--mc-u)' },
  { id: 'B', label: 'black',       ink: 'var(--mc-b)' },
  { id: 'R', label: 'red',         ink: 'var(--mc-r)' },
  { id: 'G', label: 'green',       ink: 'var(--mc-g)' },
  { id: 'M', label: 'multicolour', ink: 'var(--mc-gold)' },
  { id: 'C', label: 'colourless',  ink: 'var(--mc-c)' },
];

/* Eight bars, 0 to 7-and-up, which is what the curve has always drawn. */
const DB_CURVE_TOP = 7;

// ── Reading a card ────────────────────────────────────────────────────────

/* What Cardmarket quotes one copy of this card at, as it was written down —
 * the app's one answer, asked of the deck's card rather than of its name, the
 * way js/deckview-render.js's _dbCardImg() is.
 *
 * A card carrying a printing is quoted at that printing: the deck runs that
 * card, so a figure off whichever printing Scryfall calls the default is a
 * figure for a deck nobody is holding. The snapshot is the whole of the answer
 * and the cache is not consulted behind it — a printing snapshotted with no
 * price is one nobody was selling on the day it was chosen, and quietly
 * quoting a different printing's price instead would be the same lie the mat
 * refuses to tell about the artwork.
 *
 * The mat reads this too, so the tile and the readout cannot come to disagree
 * about what a card costs. */
function dbCardPrice(card) {
  return card.printing ? card.printing.price_eur : dbCardData.get(card.card_name)?.prices?.eur;
}

/* Cardmarket in euros, which is what every price in this app is quoted in —
 * the readout is not the place to grow a currency selector.
 *
 * Null is the answer when we do not know, and it is never nought. A card with
 * no Cardmarket price silently costed at zero is how a deck total becomes a
 * number nobody can act on: it looks like an answer and it is short by however
 * many of those the deck holds. */
function _dbCardEur(card) {
  const raw = dbCardPrice(card);
  const eur = raw == null ? NaN : parseFloat(raw);
  return Number.isFinite(eur) ? eur : null;
}

const _dbTypeLine = cardName => (dbCardData.get(cardName)?.type_line || '').toLowerCase();

/* Which bucket a card is in — the app's one answer, not this module's.
 * js/deckview-mana.js asks it what a land is so that "38 lands" on the readout
 * and the 38 the mana panel splits into basics and non-basics are the same
 * thirty-eight. Two ways of deciding what a land is, in two places, is how a
 * readout starts disagreeing with the panel it opens. */
const dbCardType = cardName => {
  const line = _dbTypeLine(cardName);
  return (DB_TYPES.find(t => t.match && line.includes(t.match)) || DB_TYPES[DB_TYPES.length - 1]).id;
};

/* What colour a card is drawn as on the curve. `colors` — what it costs to
 * cast — rather than `color_identity`, which is what a deck is allowed to hold:
 * a colourless artifact with one green activation ability has G in its identity
 * and belongs in the colourless band of a curve, because the curve is about
 * casting things.
 *
 * A transforming card carries no `colors` of its own and keeps them on its
 * faces; the front is the one you cast. */
function _dbCurveColor(cardName) {
  const sf     = dbCardData.get(cardName);
  const colors = sf?.colors || sf?.card_faces?.[0]?.colors || [];
  if (colors.length > 1) return 'M';
  return colors[0] || 'C';
}

// ── The pass ──────────────────────────────────────────────────────────────

function _dbComputeTotals() {
  const main = dbMainCards();
  /* The money's deck, which is the only one the commander is in. */
  const purse = [...main, ...dbCommanderCards()];

  const types  = new Map(DB_TYPES.map(t => [t.id, 0]));
  /* How many cards of the deck have each colour in their identity, which is
   * what the row of mana symbols on the readout has always drawn. It is a
   * count of *cards*, and it is not pips: a card costing {1}{G} demands one
   * green pip and a card costing {G}{G}{G} demands three, and both are one
   * card here. What the deck's costs actually ask for is
   * js/deckview-mana.js's, counted off `mana_cost` where it can be counted. */
  const colorCards = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const curve  = Array.from({ length: DB_CURVE_TOP + 1 }, () => ({
    n: 0, bands: Object.fromEntries(DB_CURVE_COLORS.map(c => [c.id, 0])),
  }));

  let cards = 0, lands = 0, nonLands = 0, cmcSum = 0;

  for (const card of main) {
    const name = card.card_name;
    const qty  = card.qty || 1;
    const type = dbCardType(name);
    cards += qty;
    types.set(type, types.get(type) + qty);

    for (const c of dbCardData.get(name)?.color_identity || []) {
      if (colorCards[c] !== undefined) colorCards[c] += qty;
    }

    if (type === 'land') { lands += qty; continue; }

    /* The average mana value and the curve are both the deck's non-lands, and
     * they are the same walk: a land in a curve is a bar at nought as tall as
     * a third of the deck, which flattens the shape the curve exists to show. */
    const cmc = dbCardData.get(name)?.cmc ?? 0;
    nonLands += qty;
    cmcSum   += cmc * qty;
    const bar = curve[Math.min(DB_CURVE_TOP, Math.max(0, Math.round(cmc)))];
    bar.n += qty;
    bar.bands[_dbCurveColor(name)] += qty;
  }

  return {
    cards, lands,
    avgCmc: nonLands ? cmcSum / nonLands : null,
    colorCards,
    curve,
    types: DB_TYPES.map(t => ({ id: t.id, one: t.one, many: t.many, n: types.get(t.id) })),
    permanents: DB_TYPES
      .filter(t => t.id !== 'land' && !DB_SPELL_TYPES.has(t.id))
      .reduce((sum, t) => sum + types.get(t.id), 0),
    spells: [...DB_SPELL_TYPES].reduce((sum, id) => sum + types.get(id), 0),

    /* What the deck costs, and what finishing it costs. The second is the one
     * the group actually argues about, and it is why the shortfall is asked of
     * js/deckview-owned.js rather than counted again here: "missing" has to
     * mean exactly what the badges and "87 of 99" mean by it, scope and all,
     * or the readout is two answers to one question. */
    price:   _dbPriceOf(purse, card => card.qty || 1),
    missing: _dbPriceOf(purse, dbShortOf),
  };
}

/* What some number of copies of each of these cards comes to, and how many
 * copies we could not price. Two numbers and not one, because a card with no
 * price is unknown rather than free. */
function _dbPriceOf(cards, copies) {
  let eur = 0, priced = 0, unknown = 0;
  for (const card of cards) {
    const n = copies(card);
    if (n <= 0) continue;
    const each = _dbCardEur(card);
    if (each === null) { unknown += n; continue; }
    eur    += each * n;
    priced += n;
  }
  return { eur, priced, unknown };
}

// ── The price, on the readout ─────────────────────────────────────────────

const _dbEur = n => `€${n.toFixed(2)}`;

/* A figure and what is missing from it. A total with three cards it could not
 * price is not a total, so it says so rather than quietly being short — and a
 * figure with *nothing* priced is not a number at all, it is a dash. */
function _dbPriceHtml(price) {
  const sum = price.priced ? `<strong>${_dbEur(price.eur)}</strong>` : '—';
  const note = price.unknown
    ? ` <span class="db-stat-unpriced">(${price.unknown} unpriced)</span>` : '';
  return sum + note;
}

/* The line: what the deck costs, and — when you are short of anything — what
 * finishing it costs. That second figure follows whichever shelf the readout is
 * counting, so switching the scope from yours to the group's moves it, exactly
 * as it moves "87 of 99". */
function dbRenderPriceStat() {
  const el = document.getElementById('dbStatPrice');
  if (!el) return;
  const { price, missing } = dbDeckTotals();
  const short = missing.priced || missing.unknown;
  el.innerHTML = _dbPriceHtml(price)
    + (short ? ` · ${_dbPriceHtml(missing)} to finish` : '');
  el.title = short
    ? 'What the deck costs on Cardmarket, and what the copies you are short of would cost'
    : 'What the deck costs on Cardmarket';
}

// ── The curve, the types and the split ────────────────────────────────────

/* Merged or cut into colours. In memory rather than stored, like the strip it
 * lives in: a curve you turned over to look at something is not a preference. */
let dbCurveByColor = false;

function dbToggleCurveColors() {
  dbCurveByColor = !dbCurveByColor;
  const btn = document.getElementById('dbCurveModeBtn');
  btn?.setAttribute('aria-pressed', dbCurveByColor ? 'true' : 'false');
  btn?.classList.toggle('db-analysis-open', dbCurveByColor);
  /* Redrawn off the pass that has already been done. Cutting a bar into bands
   * is a different way of drawing the same count, not a different count. */
  dbRenderAnalysis();
}

const DB_CURVE_HEIGHT = 32;   // px, the box .db-curve gives its bars

function _dbCurveHtml() {
  const { curve } = dbDeckTotals();
  const tallest   = Math.max(...curve.map(bar => bar.n), 1);
  return curve.map((bar, i) => {
    const at  = i === DB_CURVE_TOP ? `${DB_CURVE_TOP}+` : String(i);
    const box = Math.round((bar.n / tallest) * DB_CURVE_HEIGHT);
    if (!dbCurveByColor) {
      return `<div class="db-curve-bar" style="height:${box}px" title="${at}: ${bar.n} cards"></div>`;
    }
    /* The same bar, cut into bands. Its height is the height it had merged —
     * which is the point of the toggle: it is one shape read two ways, not two
     * charts. */
    const bands = DB_CURVE_COLORS
      .filter(c => bar.bands[c.id] > 0)
      .map(c => ({ ...c, n: bar.bands[c.id] }));
    const made = bands.map(c =>
      `<span class="db-curve-band" style="height:${(c.n / bar.n) * 100}%;background:${c.ink}"></span>`).join('');
    const said = bands.map(c => `${c.n} ${c.label}`).join(', ');
    return `<div class="db-curve-bar db-curve-stack" style="height:${box}px"
      title="${esc(`${at}: ${bar.n} cards${said ? ` — ${said}` : ''}`)}">${made}</div>`;
  }).join('');
}

/* A number and the thing it counts. One sorcery is not "1 sorceries": these
 * lines are read at a glance and a plural that does not agree is the kind of
 * wrongness the eye stops on instead of reading past. */
const _dbCount = (n, one, many) =>
  `<span class="db-count-item"><strong>${n}</strong> ${esc(n === 1 ? one : many)}</span>`;

function _dbTypesHtml() {
  const { types } = dbDeckTotals();
  const shown = types.filter(t => t.n > 0);
  if (!shown.length) return `<span class="db-analysis-none">nothing in the deck yet</span>`;
  return shown.map(t => _dbCount(t.n, t.one, t.many)).join('');
}

function _dbSplitHtml() {
  const { permanents, spells, lands } = dbDeckTotals();
  return _dbCount(permanents, 'permanent', 'permanents')
       + _dbCount(spells, 'spell', 'spells')
       + _dbCount(lands, 'land', 'lands');
}

/** The strip that expands out of the toolbar, written whether it is open or not. */
function dbRenderAnalysis() {
  const curve = document.getElementById('dbCurve');
  const types = document.getElementById('dbTypes');
  const split = document.getElementById('dbSplit');
  if (curve) curve.innerHTML = _dbCurveHtml();
  if (types) types.innerHTML = _dbTypesHtml();
  if (split) split.innerHTML = _dbSplitHtml();
}
