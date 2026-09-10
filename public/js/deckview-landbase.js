// ── Deck Builder — Lands: the check, the fix, and the cycles browsed ──────
// The drawer's third tab, beside Search and EDHREC. Search asks Magic a
// question you have to know how to phrase, and EDHREC asks what other people
// run. This asks the one question a deck's land slots actually pose — "what
// are my options in these colours?" — and answers it the way the game groups
// lands: by cycle. Shocks, fetches, triomes, painlands and the rest.
//
// What it draws is dbDrawerTile(), whole. The + means what it means on every
// other tile in the drawer, goes wherever the drawer's "Add to" says, wears
// the ownership mark and says when the deck already holds the card. A land
// found here and a land found by searching for it are the same card in the
// same grid, because they are drawn by the same function.
//
// Above the cycles sits the check: how many sources of each colour the deck
// holds, how many the source-count table wants, and the card that set the bar.
// The browsing is what the tab is opened for; the check is what it is *for*.
// One is a list of options and the other is the reason you are looking at it,
// which is why they are one tab and in that order.
//
// Between the two sits the fix: for a colour the check calls short, the lands
// that would close it, with the copies somebody in the house already has at
// the front. That order is the one thing on this tab Archidekt could not
// draw, because Archidekt does not know what is in our boxes — and a
// suggestion you can play tonight beats a better one you would have to buy.
//
// And underneath the check, the one control here that writes: a budget of
// basics, split across the deck's colours in proportion to its pips, shown
// before it is done and applied on a second press. Beside it one override —
// at least one basic of every colour the deck has pips in — off by default,
// because the proportional split is the honest answer and the preview says
// when it is about to cost the deck a colour outright.
//
// See docs/design/spec-landbase.md.

/* ── The check: how many sources a colour wants ────────────────────────────
 *
 * Everything below is one question — "can this deck cast its own cards?" —
 * answered out of a table rather than out of a rule of thumb. The rules of
 * thumb everybody quotes (single pip ≈ 17, double ≈ 24, triple ≈ 31) are the
 * average of this table's cells; having the table means quoting the right cell
 * instead.
 *
 * ── Where the numbers come from ───────────────────────────────────────────
 *
 * Frank Karsten's source-count simulation, re-run for the London mulligan and
 * for singleton by teryror, at a million hands per cell:
 * https://gist.github.com/teryror/881d60e08480a56043895d3bbb83c374
 *
 * Transcribed from that gist on 2026-09-04, from its "Adjustments Based on
 * Casting Costs" tables — the 60-card and 99-card ones. The 40-card and
 * 80-card tables beside them are not shipped: js/deckview-legality.js knows
 * two formats and the deck record carries no third, so a Limited table would
 * be a row nothing in this app can ask for.
 *
 * What a cell means, in the simulation's own terms: deal a hand, mulligan any
 * hand with 0, 1, 6 or 7 lands, and on the turn the spell is due, ask whether
 * the hand holds enough sources of the colour — *given that it hit its land
 * drops*. The cell is the fewest sources that clears the threshold, which
 * rises with the spell's cost (91% at one mana, up to 95% at five and above).
 * Two consequences worth knowing before arguing with a number: the mulligan is
 * only counting lands, not looking at their colours, and whether you hit your
 * land drops at all is the *land count's* question rather than this table's.
 *
 * ── Re-checking the transcription ─────────────────────────────────────────
 *
 * The gist is a static document rather than an API, and a mistyped digit in
 * here is invisible at runtime because every number in the table is plausible.
 * Two guards: test/decklands.test.js copies a handful of cells out a second
 * time and asserts the shape of every row, and the rows below are laid out one
 * per land count with the columns grouped by mana value, so a row can be read
 * back against the gist by eye.
 *
 * ── The shape of a row ────────────────────────────────────────────────────
 *
 * `rows[lands - from]` is one land count. Within it the cells run by mana
 * value, and within a mana value by how many pips of the colour the cost has:
 *
 *   [ {C}, {1}{C} {C}{C}, {2}{C} {1}{C}{C} {C}{C}{C}, … ]
 *
 * so the cell for a cost of mana value `v` with `p` pips is at
 * `v(v-1)/2 + p - 1`. Off either end — a deck four lands into being built, a
 * ten-drop past the last column — is read at the end, and the panel says which
 * row it read rather than quietly answering for a deck nobody has.
 */
const DB_SOURCE_TABLES = {
  /* 99 cards: 24–49 lands, mana values 1–8. */
  commander: { from: 24, maxCmc: 8, rows: [
    /* 24 */ [15, 15,22, 13,19,23, 11,17,21,24, 10,15,19,22,24,  9,13,17,20,22,24,  8,12,15,18,20,23,24,  7,10,13,16,19,21,23,24],
    /* 25 */ [15, 15,23, 13,20,24, 11,17,22,25, 10,15,20,23,25,  9,14,17,21,23,25,  8,12,16,19,21,24,25,  7,11,14,17,20,22,24,25],
    /* 26 */ [16, 16,23, 14,20,25, 12,18,23,26, 11,16,20,24,26,  9,14,18,21,24,26,  8,13,16,19,22,24,26,  7,11,15,18,20,23,25,26],
    /* 27 */ [16, 16,24, 14,21,26, 12,19,23,27, 11,17,21,25,27, 10,15,19,22,25,27,  9,13,17,20,23,25,27,  8,12,15,18,21,24,26,27],
    /* 28 */ [17, 16,25, 14,22,27, 13,19,24,28, 11,17,22,25,28, 10,15,19,23,26,28,  9,14,17,21,24,26,28,  8,12,16,19,22,24,27,28],
    /* 29 */ [17, 17,25, 15,22,28, 13,20,25,29, 12,18,23,26,29, 10,16,20,24,27,29,  9,14,18,22,25,27,29,  8,13,16,20,23,25,28,29],
    /* 30 */ [18, 17,26, 15,23,29, 14,20,26,30, 12,18,23,27,30, 11,16,21,25,28,30,  9,15,19,22,26,28,30,  8,13,17,20,23,26,28,30],
    /* 31 */ [18, 18,27, 16,24,30, 14,21,27,31, 13,19,24,28,31, 11,17,21,25,29,31, 10,15,19,23,26,29,31,  9,13,18,21,24,27,29,31],
    /* 32 */ [18, 18,27, 16,24,30, 14,22,27,31, 13,20,25,29,32, 11,17,22,26,30,32, 10,15,20,24,27,30,32,  9,14,18,22,25,28,30,32],
    /* 33 */ [19, 18,28, 16,25,31, 15,22,28,32, 13,20,25,30,33, 12,18,23,27,30,33, 10,16,21,25,28,31,33,  9,14,19,22,26,29,31,33],
    /* 34 */ [19, 19,29, 17,26,32, 15,23,29,33, 14,21,26,31,34, 12,18,23,28,31,34, 11,16,21,25,29,32,34, 10,15,19,23,27,30,32,34],
    /* 35 */ [20, 19,29, 17,26,33, 15,23,30,34, 14,21,27,31,35, 12,19,24,29,32,35, 11,17,22,26,30,33,35, 10,15,20,24,27,30,33,35],
    /* 36 */ [20, 19,30, 17,27,34, 16,24,30,35, 14,22,28,32,36, 13,19,25,29,33,36, 11,17,22,27,30,34,36, 10,16,20,24,28,31,34,36],
    /* 37 */ [20, 20,30, 18,27,35, 16,25,31,36, 15,22,28,33,37, 13,20,25,30,34,37, 12,18,23,27,31,35,37, 10,16,21,25,29,32,35,37],
    /* 38 */ [21, 20,31, 18,28,35, 17,25,32,37, 15,23,29,34,38, 13,20,26,31,35,38, 12,18,24,28,32,35,38, 11,17,21,26,30,33,36,38],
    /* 39 */ [21, 20,31, 18,28,36, 17,26,33,38, 15,23,30,35,39, 14,21,27,32,36,39, 12,19,24,29,33,36,39, 11,17,22,26,30,34,37,39],
    /* 40 */ [21, 21,32, 19,29,37, 17,26,33,39, 16,24,30,36,40, 14,21,27,32,37,40, 13,19,25,30,34,37,40, 11,17,23,27,31,35,38,40],
    /* 41 */ [22, 21,32, 19,29,37, 17,27,34,40, 16,24,31,36,40, 14,22,28,33,37,41, 13,20,25,30,35,38,41, 12,18,23,28,32,35,39,41],
    /* 42 */ [22, 21,33, 19,30,38, 18,27,35,40, 16,25,32,37,41, 15,22,29,34,38,42, 13,20,26,31,35,39,42, 12,18,24,28,33,36,40,42],
    /* 43 */ [22, 21,33, 20,30,39, 18,28,35,41, 17,25,32,38,42, 15,23,29,35,39,43, 13,21,26,32,36,40,43, 12,19,24,29,33,37,40,43],
    /* 44 */ [23, 22,34, 20,31,40, 18,28,36,42, 17,26,33,39,43, 15,23,30,35,40,44, 14,21,27,32,37,41,44, 12,19,25,30,34,38,41,44],
    /* 45 */ [23, 22,34, 20,31,40, 19,29,37,43, 17,26,33,39,44, 16,24,30,36,41,45, 14,21,28,33,38,42,45, 13,19,25,30,35,39,42,45],
    /* 46 */ [23, 22,35, 20,32,41, 19,29,37,44, 18,27,34,40,45, 16,24,31,37,42,46, 14,22,28,34,38,43,46, 13,20,26,31,35,40,43,46],
    /* 47 */ [23, 22,35, 21,32,41, 19,29,38,44, 18,27,35,41,46, 16,25,31,37,42,46, 15,22,29,34,39,43,47, 13,20,26,31,36,40,44,47],
    /* 48 */ [24, 22,35, 21,33,42, 19,30,38,45, 18,28,35,42,47, 16,25,32,38,43,47, 15,23,29,35,40,44,48, 13,21,27,32,37,41,45,48],
    /* 49 */ [24, 23,36, 21,33,42, 20,30,39,46, 18,28,36,42,48, 17,25,33,39,44,48, 15,23,30,35,41,45,49, 14,21,27,33,38,42,46,49],
  ] },
  /* 60 cards: 15–30 lands, mana values 1–7. */
  sixty: { from: 15, maxCmc: 7, rows: [
    /* 15 */ [10,  9,14,  8,12,15,  7,10,13,15,  6, 9,12,14,15,  5, 8,10,12,14,15,  4, 7, 9,11,13,14,15],
    /* 16 */ [10, 10,15,  8,13,16,  7,11,14,16,  6,10,12,15,16,  5, 9,11,13,15,16,  5, 7,10,12,13,15,16],
    /* 17 */ [11, 10,16,  9,14,17,  8,12,15,17,  7,10,13,16,17,  6, 9,12,14,16,17,  5, 8,10,12,14,16,17],
    /* 18 */ [11, 11,16,  9,14,18,  8,12,16,18,  7,11,14,16,18,  6,10,12,15,17,18,  5, 8,11,13,15,17,18],
    /* 19 */ [12, 11,17, 10,15,19,  9,13,16,19,  8,12,15,17,19,  7,10,13,16,18,19,  6, 9,12,14,16,18,19],
    /* 20 */ [12, 12,18, 10,16,19,  9,14,17,20,  8,12,15,18,20,  7,11,14,16,19,20,  6, 9,12,15,17,19,20],
    /* 21 */ [13, 12,19, 11,16,20,  9,14,18,21,  8,13,16,19,21,  7,11,14,17,19,21,  6,10,13,15,18,20,21],
    /* 22 */ [13, 13,19, 11,17,21, 10,15,19,22,  9,13,17,20,22,  8,12,15,18,20,22,  7,10,13,16,19,21,22],
    /* 23 */ [14, 13,20, 11,17,22, 10,15,20,23,  9,14,18,21,23,  8,12,16,19,21,23,  7,11,14,17,19,22,23],
    /* 24 */ [14, 13,20, 12,18,23, 11,16,20,24, 10,14,18,22,24,  8,13,16,19,22,24,  7,11,15,18,20,22,24],
    /* 25 */ [14, 14,21, 12,19,24, 11,17,21,25, 10,15,19,22,25,  9,13,17,20,23,25,  8,12,15,18,21,23,25],
    /* 26 */ [15, 14,22, 12,19,24, 11,17,22,25, 10,16,20,23,26,  9,14,18,21,24,26,  8,12,16,19,22,24,26],
    /* 27 */ [15, 14,22, 13,20,25, 12,18,23,26, 11,16,20,24,27,  9,14,18,22,25,27,  8,13,17,20,23,25,27],
    /* 28 */ [15, 14,23, 13,20,26, 12,18,23,27, 11,17,21,25,28, 10,15,19,23,26,28,  9,13,17,20,23,26,28],
    /* 29 */ [16, 15,23, 13,21,27, 12,19,24,28, 11,17,22,26,29, 10,15,20,23,26,29,  9,14,18,21,24,27,29],
    /* 30 */ [16, 15,23, 14,21,27, 12,19,25,29, 12,18,22,26,30, 10,16,20,24,27,30,  9,14,18,22,25,28,30],
  ] },
};

const _dbSourceTable = format => DB_SOURCE_TABLES[format] || DB_SOURCE_TABLES.sixty;

/* Which row of the table a deck's lands are read at. Its own, wherever the
 * table has one; the nearest end where it does not. A deck four lands into
 * being built is the ordinary case rather than the odd one, and a check that
 * went blank until the thirty-sixth land went in would be blank for the whole
 * of the time it was any use. */
function dbSourceRowLands(format, lands) {
  const table = _dbSourceTable(format);
  const last  = table.from + table.rows.length - 1;
  return Math.min(last, Math.max(table.from, Math.round(lands) || 0));
}

/* How many sources of one colour a cost of this shape wants, in a deck of this
 * size with this many lands. Null for a cost that does not ask for the colour
 * at all, which is not nought — nought sources would be a requirement met by
 * an empty deck, and there is no requirement here to meet.
 *
 * A cost past the last column is read at the last column. The requirement for
 * a given number of pips *falls* as the cost rises — a turn-eight spell has
 * had eight draws to find its sources — so reading a ten-drop at the eight
 * column asks for slightly more than the truth rather than slightly less. */
function dbSourcesWanted(format, lands, cmc, pips) {
  if (!(pips > 0)) return null;
  const table = _dbSourceTable(format);
  const row   = table.rows[dbSourceRowLands(format, lands) - table.from];
  const value = Math.min(table.maxCmc, Math.max(cmc, pips, 1));
  const p     = Math.min(pips, value);
  return row[(value * (value - 1)) / 2 + p - 1];
}

// ── Reading a cost as what it *demands* ───────────────────────────────────
/* js/deckview-mana.js reads a cost as a share — a hybrid symbol is half a pip
 * to each of the colours that pays it, so the pips of a deck add up to the
 * symbols in its costs, and a proportional split of basics is a split of
 * something real. The check reads the same string for something else: not "how
 * much of this deck is blue" but "what does this one card make me have before I
 * can cast it", which is a single cost paid at one moment.
 *
 * The three below are that second reading, and the check is the only thing in
 * the app that asks for it, so they live here. What they are given is one
 * face's symbols, which is dbManaSymbols() over one of dbCostFaces()' faces —
 * both public, both the mana module's, so that "what are a card's costs" stays
 * answered in one place however many ways it is read.
 */

/* What one symbol is worth towards a cost's mana value. A number is itself;
 * {2/W} is two, because two is what it costs when you pay it the way that is
 * not white; {X} is nought, because the cost is what you decide it is and
 * nought is what the rules call it on the stack. Everything else — a colour, a
 * snow symbol, a Phyrexian pip — is one. */
function _dbSymbolValue(symbol) {
  const parts = symbol.split('/');
  const nums  = parts.map(p => parseInt(p, 10)).filter(n => Number.isFinite(n));
  if (nums.length) return Math.max(...nums);
  if (parts.every(p => /^[XYZ]$/.test(p))) return 0;
  return 1;
}

/** What a cost is worth, in mana, as the game counts it. */
const _dbCostValue = symbols => symbols.reduce((n, s) => n + _dbSymbolValue(s), 0);

/* How many pips of one colour a cost *demands*, which is not the same as how
 * many it counts towards that colour's share in js/deckview-mana.js.
 *
 * Only a symbol that can be paid one way counts here. {U} demands blue. {G/U}
 * does not demand blue — it is a card you cast off green when green is what
 * you have — and {2/U} and {U/P} do not either, the other payments being two
 * generic and two life. Counting them would have the check shouting for
 * Islands at a deck that never needs one, which is exactly the failure this
 * whole panel exists to avoid: a bar nobody believes is a bar nobody reads.
 *
 * What it costs us is the deck of nothing but hybrid cards, whose colours show
 * a row with no bar on it. That is the honest answer — the table the check
 * reads has no column for "either of these two" — and the row still says what
 * the deck holds. */
const _dbHardPips = (symbols, id) => symbols.filter(s => s === id).length;

// ── The hardest cost the deck actually runs ───────────────────────────────

/* Every requirement the deck's costs put on a colour: one entry per card, per
 * face of it, per colour that face demands. Both halves of the check are read
 * off this one walk — the bar for a colour is the largest entry in it, and the
 * cards the deck cannot support are the entries above what its lands make.
 *
 * The commander is in the walk, because you cast it from the command zone more
 * often than anything else in the box and a check that left it out would be a
 * check on a different deck.
 *
 * ── The one place this adds to the table ──────────────────────────────────
 *
 * A cost that demands two colours at once is not in the table, which has one
 * column per shape of *a* colour. The gist's own instruction for those is to
 * decompose the cost and read each colour's shape separately, then add one to
 * every requirement it read — Bedevil's {B}{B}{R} wants 20 black and 13 red at
 * 26 lands, not 19 and 12. Karsten calls the +1 "an imprecise hack" and bases
 * it on a further simulation; it is the source's own reading of its own table,
 * and leaving it off would understate every gold card in the deck by a source.
 *
 * What we cannot show is the other half of that decomposition — Bedevil also
 * wants 25 lands that make black *or* red, and this panel has no row for "or".
 * The panel says so rather than implying the two per-colour numbers are all of
 * it. {C} counts as one of the two: a cost wanting colourless and blue at once
 * asks two different things of the mana base, whatever the rules call them. */
function _dbSourcesDemands(format, lands) {
  const demands = [];
  for (const row of [...dbMainCards(), ...dbCommanderCards()]) {
    const sf = dbCardData.get(row.card_name);
    if (!sf) continue;
    for (const face of dbCostFaces(sf)) {
      const symbols  = dbManaSymbols(face);
      const cmc      = _dbCostValue(symbols);
      const demanded = DB_MANA_IDS.filter(id => _dbHardPips(symbols, id) > 0);
      const gold     = demanded.length > 1;
      for (const id of demanded) {
        const pips = _dbHardPips(symbols, id);
        demands.push({ name: row.card_name, id, pips, cmc, gold,
                       want: dbSourcesWanted(format, lands, cmc, pips) + (gold ? 1 : 0) });
      }
    }
  }
  return demands;
}

/* The bar per colour, and the card that set it. Ties go to the card with more
 * pips of the colour, then to the first one the deck lists: two cards can want
 * the same number of sources for different reasons, and the triple-pip
 * three-drop is the one worth naming, because it is the one a person can look
 * at and decide the bar is wrong. */
function _dbSourcesBars(demands) {
  const bars = {};
  for (const d of demands) {
    const held = bars[d.id];
    if (!held || d.want > held.want || (d.want === held.want && d.pips > held.pips)) bars[d.id] = d;
  }
  return bars;
}

// ── The check ─────────────────────────────────────────────────────────────

/* Worked out at most once per deck, the way js/deckview-totals.js's pass and
 * js/deckview-legality.js's are — and kept against the mana pass it was read
 * from rather than against a flag of its own. That pass is already dropped
 * whenever the deck changes, so its identity is exactly the question "is this
 * still the same deck?", and this cannot go stale in a way that one is not
 * without there being a second thing to remember to invalidate. */
let _dbSourcesOf  = null;
let _dbSourcesOut = null;

/* Everything the panel says, as figures. One row per colour the deck's costs
 * ask for — a colour it neither asks for nor makes is not a finding, and a row
 * of nought against nought is not one either.
 *
 * Held is the deck's **land** sources of the colour and nothing else. The
 * simulation behind the table sleeves lands and blanks: a source count lifted
 * by Signets and dorks would report a consistency the model never claimed. The
 * rocks are counted all the same, and said on their own line, because "we did
 * not notice your Sol Ring" and "your Sol Ring is not in this number" are
 * different sentences and only one of them is true. */
function dbSourcesCheck() {
  const mana = dbDeckMana();
  if (_dbSourcesOf === mana) return _dbSourcesOut;

  const format  = dbDeckFormat().id;
  const lands   = mana.lands.total;
  const demands = _dbSourcesDemands(format, lands);
  const bars    = _dbSourcesBars(demands);

  const colours = DB_MANA_COLORS.filter(c => mana.pips[c.id] > 0).map(c => {
    const bar  = bars[c.id] || null;
    const held = mana.fromLands[c.id];
    return {
      id: c.id, label: c.label, ink: c.ink, held,
      want: bar ? bar.want : null,
      gap:  bar ? Math.max(0, bar.want - held) : null,
      card: bar ? bar.name : null,
      cmc:  bar ? bar.cmc  : null,
      pips: bar ? bar.pips : null,
      gold: !!bar?.gold,
    };
  });

  _dbSourcesOf  = mana;
  _dbSourcesOut = {
    format, lands, row: dbSourceRowLands(format, lands),
    colours,
    short: _dbSourcesShortfalls(demands, mana),
    other: mana.otherSources,
    unknown: mana.unknown,
  };
  return _dbSourcesOut;
}

/* Every card in the deck the sources cannot support, worst first — the
 * argument behind the headline, for when somebody wants to have it. A card is
 * on this list when any one colour of its cost wants more sources than the
 * deck's lands make; the shortfall named is its worst colour. */
function _dbSourcesShortfalls(demands, mana) {
  const worst = new Map();
  for (const d of demands) {
    const held = mana.fromLands[d.id];
    if (d.want <= held) continue;
    const found = worst.get(d.name);
    if (!found || d.want - held > found.gap) {
      worst.set(d.name, { name: d.name, id: d.id, want: d.want, held, gap: d.want - held });
    }
  }
  return [...worst.values()].sort((a, b) => b.gap - a.gap || a.name.localeCompare(b.name));
}

// ── The cards it could not read ───────────────────────────────────────────

/* The one sentence both halves of the tab say about them: how many there are,
 * and their names. It is said twice — under the check's numbers and over the
 * optimizer's preview — because it means something different in each place,
 * and it is written here once because the half that is the same in both is the
 * half that would otherwise drift. `clause` is what follows "and", and the
 * caller writes it for the number at hand: a deck with a single card in flight
 * told "1 card have no facts yet" reads as a bug in the numbers rather than
 * the gap in them it is. */
function _dbBlindSentence(names, clause) {
  const n = names.length;
  return `${n} card${n === 1 ? ' has' : 's have'} no facts yet, and ` +
         `${clause}: ${names.join(', ')}.`;
}

// ── The check, drawn ──────────────────────────────────────────────────────

/* Whether the per-card list is spread out. Shut to begin with and on every new
 * deck: the headline is the finding, and the list is only wanted by somebody
 * who has decided to disagree with it. */
let _dbSourcesShortOpen = false;

function dbToggleSourcesShort() {
  _dbSourcesShortOpen = !_dbSourcesShortOpen;
  _dbRenderLands();
}

function _dbSourcesHtml() {
  const check = dbSourcesCheck();
  if (!check.colours.length) return '';

  return `<div class="db-sources">
    <div class="db-sources-hdr">
      <span class="db-sources-title">The check</span>
      ${_dbSourcesShortBtn(check)}
    </div>
    ${check.colours.map(c => (c.want === null ? _dbSourcesUnaskedRow(c) : _dbSourcesRow(c))).join('')}
    ${_dbSourcesShortHtml(check)}
    ${_dbSourcesFootHtml(check)}
  </div>`;
}

/* One colour, with a bar to be measured against: what the deck's lands make,
 * what the table wants, the card that set that, and how far along it is. The
 * shape is the one thing here read faster than a number, and a colour over its
 * bar fills it. */
function _dbSourcesRow(c) {
  const along   = Math.min(100, Math.round((c.held / c.want) * 100));
  const verdict = c.gap > 0
    ? `<span class="db-sources-gap">${c.gap} short</span>`
    : '<span class="db-sources-ok">enough</span>';
  return `<div class="db-sources-row">
    ${_dbSourcesSym(c)}
    <span class="db-sources-fig"><strong>${c.held}</strong> sources</span>
    <span class="db-sources-fig">wants <strong>${c.want}</strong></span>
    <span class="db-sources-for">for ${esc(c.card)}</span>
    <span class="db-sources-bar"><span style="width:${along}%;background:${c.ink}"></span></span>
    ${verdict}
  </div>`;
}

/* And one the deck spends mana on without any single cost demanding it —
 * hybrid cards, and nothing else. No bar is drawn rather than an empty one or
 * a full one, because either would read as a verdict and "nothing demands it"
 * is the absence of one. */
function _dbSourcesUnaskedRow(c) {
  return `<div class="db-sources-row">
    ${_dbSourcesSym(c)}
    <span class="db-sources-fig"><strong>${c.held}</strong> sources</span>
    <span class="db-sources-note">no single cost demands it — every symbol asking for it can be paid another way</span>
  </div>`;
}

const _dbSourcesSym = c =>
  `<i class="ms ms-${c.id.toLowerCase()} ms-cost ms-shadow db-sources-sym" title="${esc(c.label)}"></i>`;

/* The way into the per-card list, which is only a way in when there is
 * something behind it: a deck that can cast everything it holds is a deck with
 * no argument to have. */
function _dbSourcesShortBtn(check) {
  if (!check.short.length) return '';
  const n = check.short.length;
  return `<button class="db-sources-more" aria-expanded="${_dbSourcesShortOpen}"
                  onclick="dbToggleSourcesShort()">
    ${_dbSourcesShortOpen ? '▾' : '▸'} ${n} card${n === 1 ? '' : 's'} the sources can’t support
  </button>`;
}

function _dbSourcesShortHtml(check) {
  if (!_dbSourcesShortOpen || !check.short.length) return '';
  const rows = check.short.map(c => `<div class="db-sources-short-row">
    <span class="db-sources-short-name">${esc(c.name)}</span>
    <span class="db-sources-short-fig">wants ${c.want} ${esc(dbManaColor(c.id).label)}, has ${c.held}</span>
  </div>`).join('');
  return `<div class="db-sources-short">${rows}</div>`;
}

/* Whether the assumptions under the numbers are spread out. Shut to begin
 * with, for the same reason the per-card list is: they are the small print of
 * a floor, and four lines of prose standing over three bars is a wall in front
 * of the finding somebody opened the tab for. */
let _dbSourcesFootOpen = false;

function dbToggleSourcesFoot() {
  _dbSourcesFootOpen = !_dbSourcesFootOpen;
  _dbRenderLands();
}

/* What sits under the numbers. Two things stay in the open because both change
 * what the bars above mean — the sources the table does not count, and the
 * cards it could not read — and the rest is behind a line you press. */
function _dbSourcesFootHtml(check) {
  /* The rocks, where there are any. A deck with none saying "and 0 other
     sources" would be answering a question nobody in front of it has. */
  const other = check.other
    ? `<span class="db-sources-counts">and <strong>${check.other}</strong> other ` +
      `source${check.other === 1 ? '' : 's'} — rocks and dorks, which the table does not count</span>`
    : '';
  /* Named, not just counted, and never folded away. A deck reported as wanting
     no white because eleven of its cards are still in flight is the one kind of
     wrong a mana base cannot survive, and the names are how somebody tells that
     apart from a deck that really has no white in it. */
  const n = check.unknown.length;
  const blind = n
    ? `<div class="db-sources-limit">${esc(_dbBlindSentence(check.unknown,
        `${n === 1 ? 'is' : 'are'} counted in neither half of this`))}</div>`
    : '';
  return `${other}${blind}
    <button class="db-sources-more db-sources-how" aria-expanded="${_dbSourcesFootOpen}"
            onclick="dbToggleSourcesFoot()">
      ${_dbSourcesFootOpen ? '▾' : '▸'} how this is read
    </button>
    ${_dbSourcesFootOpen ? _dbSourcesLimitsHtml(check) : ''}`;
}

/** The small print itself: where the row was read, and what it assumes. */
function _dbSourcesLimitsHtml(check) {
  const size  = check.format === 'commander' ? 99 : 60;
  const notes = [
    check.row === check.lands
      ? `Read at the ${check.lands}-land row of the ${size}-card table.`
      : check.row > check.lands
        ? `The table starts at ${check.row} lands and the deck has ${check.lands}, so it is read at ${check.row}.`
        : `The table stops at ${check.row} lands and the deck has ${check.lands}, so it is read at ${check.row}.`,
    'It assumes every source is untapped, so a deck full of taplands overstates itself.',
    check.format === 'commander'
      ? 'It asks for the spell on curve, and in multiplayer a turn late is a softer failure than that.'
      : 'It asks for the spell on curve — a deck that can cast a turn late, or a multiplayer game, is a softer deadline.',
  ];
  /* Only where a gold card actually set one of the bars above, because it is
     the sort of note that is noise until it is the answer to "why does it want
     one more than the table says". */
  if (check.colours.some(c => c.gold)) {
    notes.push('A cost that asks for two colours at once wants one source more of each — the ' +
               'table’s own rule, and an approximation: these rows cannot count the sources ' +
               'that make either colour.');
  }
  return notes.map(n => `<div class="db-sources-limit">${esc(n)}</div>`).join('');
}

// ── Optimize basics: a budget, split by pips, previewed then applied ──────
/* The one thing on this tab that writes to the deck, and the first thing in
 * the app to write a calculation into one.
 *
 * It asks for a number of *basics*, not for a number of lands. The number is a
 * budget rather than a remainder: different decks want different amounts of
 * basic land, and typing the figure directly is the whole of what stops a
 * split from crowding out the rest of the list. The deck's non-basic count is
 * not an input and neither is its land total.
 *
 * The split is proportional to the deck's pips, by largest remainder, and then
 * the check runs over the result and says what it could not fix. Gap-driven
 * solving — pour basics into whichever colour is furthest below its bar — was
 * considered and rejected: the total is fixed, so every Plains that fixes
 * white takes a source away from something else, and in a three-colour deck
 * there is frequently no basic-only split that clears every bar, because the
 * answer is duals. Proportional is close to optimal for balance, and the
 * verdict underneath is where the truth about the rest goes.
 *
 * Two presses, because it writes to the least-noticed cards in the list and
 * silent would mean finding out three games later.
 *
 * Beside it, one override: "at least 1 basic of every colour", off by default
 * and remembered the way the drawer's "Add to" is. Off is the honest answer,
 * so off is the default — but a colour the proportional split rounds to
 * nothing, in a deck where nothing else makes that colour, is said out loud in
 * the preview either way. You find out when it bites rather than having to
 * know to flick a switch first.
 *
 * See docs/design/spec-landbase.md.
 */

/** The six basic names, by the colour each one makes — the only names touched. */
const DB_BASIC_OF = new Map(DB_MANA_COLORS.map(c => [c.basic, c.id]));

/* What a preview is showing, as the number it was asked for rather than as the
 * plan itself. The plan is worked out afresh on every draw, so a deck edited
 * behind the drawer between the two presses is re-split rather than applied as
 * it was half a minute ago — and the second press writes what is on screen,
 * which is the whole of what the two presses are for. */
let _dbBasicsBudget = null;

/* The override, kept where dbAddTo() keeps its own — in localStorage, not on
 * the deck. It is a way of working rather than a fact about any one list:
 * somebody who wants a Swamp in every deck that has a black card in it wants
 * it in the next deck too, and having to find the switch again on each of them
 * is the switch not being remembered.
 *
 * Off unless it says otherwise, which is both the default and localStorage's
 * usual rule: a stored value nothing recognises is the default, not a third
 * state. */
const DB_BASICS_ONE_EACH_KEY = 'mtgtools_db_basics_one_each';

function dbBasicsOneEach() {
  try { return localStorage.getItem(DB_BASICS_ONE_EACH_KEY) === '1'; } catch { return false; }
}

/* Flicked. The preview is patched rather than the tab redrawn, for the reason
 * dbBasicsTyped() has: a redraw would take the number field out from under the
 * cursor. Nothing above or below the control is a reading of this switch —
 * the check counts the deck as it stands and the toggle changes no card — so
 * the preview is the whole of what has gone stale. */
function dbSetBasicsOneEach(on) {
  try { localStorage.setItem(DB_BASICS_ONE_EACH_KEY, on ? '1' : '0'); } catch {}
  _dbBasicsRepaint();
}

/* The deck's basics, in the two piles that matter: the ones this writes to,
 * and the ones it will not.
 *
 * Which pile a row falls in is decided by *name*, not by the type line, and
 * that is deliberate — a row called Plains is a Plains whether or not its
 * facts have arrived from Scryfall, and a prefill that read 0 because the
 * cache was mid-refresh would be a budget that quietly emptied the deck.
 *
 * Five of the six are managed wherever they appear. Wastes is the sixth, and
 * is managed only where _dbBasicsWant() puts weight on {C} — a deck whose pips
 * are colourless ones. That is the same rule the split runs on, read from the
 * same function so the two cannot disagree, and it has to be read here as well
 * as there: anywhere a colour could take the slot, {C} is given none, so a
 * Wastes counted as managed is a row the split takes to nought and
 * dbBasicsApply() then deletes. An Eldrazi-splash deck would lose its Wastes
 * to the default re-balance press, which is the optimizer removing cards
 * nobody asked it to touch.
 *
 * That one rule is the exception to the paragraph above it: the pips are read
 * from the cache, so a deck still in flight files its Wastes as spare rather
 * than as managed. Spare is the safe way round — it is the pile that is left
 * alone — and the budget does not notice either way, the prefill being the two
 * piles added together. Nothing is written while anything is in flight at all;
 * see `blind`, in dbBasicsPlan().
 *
 * The rest of the unmanaged pile is the names nobody listed, and those cannot
 * be decided by name at all: dbIsBasic() passes `Basic Snow Land — Island`.
 * Everything in that pile — the snow basics, and the Wastes of a coloured deck
 * — comes off the budget and is named in the preview, so "I asked for 14"
 * cannot mean a deck that grew by three. */
function _dbBasicsHeld() {
  const managed = dbManaZero();
  const spare   = [];
  const want    = _dbBasicsWant(dbDeckMana().pips);
  for (const row of dbMainCards()) {
    const qty = row.qty || 1;
    const id  = DB_BASIC_OF.get(row.card_name);
    if (id) {
      /* By name on the way out too: counting an unmanaged Wastes off its type
         line would have a cold cache hide it from the budget as well. */
      if (id !== 'C' || want.C > 0) managed[id] += qty;
      else spare.push({ name: row.card_name, qty });
      continue;
    }
    const sf = dbCardData.get(row.card_name);
    if (sf && dbIsBasic(sf) && dbCardType(row.card_name) === 'land') {
      spare.push({ name: row.card_name, qty });
    }
  }
  const held  = DB_MANA_IDS.reduce((n, id) => n + managed[id], 0);
  const extra = spare.reduce((n, s) => n + s.qty, 0);
  return { managed, spare, held, extra, total: held + extra };
}

/* The pips a budget is allowed to be split by, which is not every pip the
 * deck has.
 *
 * {C} sits out. A Commander deck with two colourless pips does not want two
 * Wastes, and a proportional split that hands one a slot takes that slot from
 * a colour that needed it. Unless there is no colour to take it from — a
 * Kozilek deck, a Karn deck — in which case Wastes is simply the answer. That
 * completes the rule rather than contradicting it: {C} never competes with a
 * colour, and with no colour in the deck it is not competing with anything.
 *
 * One function rather than two, because the toggle below and the flag beside
 * it both mean "every colour the deck has pips in" and it would be a poor
 * joke if the two of them disagreed about which colours those were. */
function _dbBasicsWant(pips) {
  const want     = dbManaZero();
  const colours  = DB_MANA_IDS.filter(id => id !== 'C');
  const inColour = colours.reduce((n, id) => n + (pips[id] || 0), 0);
  if (inColour > 0) for (const id of colours) want[id] = pips[id] || 0;
  else want.C = pips.C || 0;
  return want;
}

/* The split itself: landsDistribute()'s maths, over those pips.
 *
 * One-each is repaired into the finished split rather than reserved out of the
 * budget in front of it, and that is the difference between an override and a
 * second algorithm. Reserving one slot per colour and splitting the remainder
 * would move basics around on decks where every colour already had some — flick
 * the switch on a 3/13/7 and get a 4/12/7, for a deck that never had a colour
 * at risk. A switch that changes an answer it was not needed for is a switch
 * nobody can predict. Repairing means the toggle is exactly a no-op wherever
 * the proportional split already seats every colour, which is most decks.
 *
 * Who pays is not a free choice either. The basic comes off whichever colour
 * is furthest *above* its own exact share — the one holding a slot rounding
 * gave it — so the result stays as close to proportional as a whole number
 * lets it be. Never off a colour down to its own last basic: paying by
 * starving somebody else is the split going round in a circle.
 *
 * Which is why a budget too small to seat every colour seats the colours with
 * the most pips and leaves the rest at nought. There is no split of three
 * slots that gives five colours one each; what there is, is a preview that
 * says which colours the deck cannot make — see _dbBasicsStarved(). */
function dbBasicsSplit(slots, pips) {
  const want  = _dbBasicsWant(pips);
  const total = Math.max(0, Math.round(slots));
  const split = landsDistribute(total, want);
  const asked = DB_MANA_IDS.reduce((n, id) => n + want[id], 0);
  if (!dbBasicsOneEach() || !asked) return split;

  /* Sorted so that where the budget runs out before the colours do, it is the
     colour the deck asks for least that goes without. Array.sort is stable,
     so colours asking equally keep WUBRG order. */
  const needy = DB_MANA_IDS.filter(id => want[id] > 0 && split[id] === 0)
                           .sort((a, b) => want[b] - want[a]);
  const over  = id => split[id] - total * want[id] / asked;
  for (const id of needy) {
    const payer = DB_MANA_IDS.filter(o => split[o] > 1).sort((a, b) => over(b) - over(a))[0];
    if (!payer) break;   // nobody can pay, so nobody after this one can be paid for either
    split[payer]--;
    split[id]++;
  }
  return split;
}

/** Everything the preview says, as figures. */
function dbBasicsPlan(budget) {
  const mana  = dbDeckMana();
  const held  = _dbBasicsHeld();
  const slots = Math.max(0, budget - held.extra);
  const split = dbBasicsSplit(slots, mana.pips);

  const rows = DB_MANA_COLORS
    .map(c => ({ id: c.id, name: c.basic, label: c.label,
                 from: held.managed[c.id], to: split[c.id] }))
    .filter(r => r.from || r.to);
  const moved = rows.reduce((n, r) => n + (r.to - r.from), 0);

  /* Nowhere to put them: a deck with no pips at all — nothing in it yet, or
     nothing whose facts have arrived. The budget cannot be spent, and saying
     so is better than a preview of six rows of nought. */
  const placed = DB_MANA_IDS.reduce((n, id) => n + split[id], 0);
  const cards  = dbDeckTotals().cards;
  return {
    budget, slots, spare: held.spare, extra: held.extra,
    /* The cards whose facts have not arrived, which is the one thing that can
       make every number above wrong at once. The managed pile survives a cold
       cache because it is decided by name — a row called Plains is a Plains —
       but the unmanaged pile cannot be: knowing a Snow-Covered Forest is a
       basic means reading its type line. So a deck half of which is still in
       flight is a deck whose snow basics do not come off the budget, and "I
       asked for 12" becomes a deck of fifteen. Named here, and refused below,
       rather than written and found out three games later. */
    blind: mana.unknown,
    rows, changed: rows.filter(r => r.to !== r.from),
    /* The colours this leaves the deck unable to make at all — which is the
       finding the toggle exists to prevent, said out loud whether or not the
       toggle is on. Off is the default, so the moment it would have mattered
       has to arrive by itself: nobody flicks a switch against a failure they
       have not been shown. */
    starved: _dbBasicsStarved(split, mana, held.managed),
    /* And, with the override on, the colours it could not seat after all.
       Three slots cannot give five colours one each, and a promise that
       quietly is not kept is worse than one that says where it ran out — the
       more so because the sentence below would otherwise be the *off* state's
       sentence, which reads as the honest split having chosen this. */
    unseated: dbBasicsOneEach() ? _dbBasicsNought(split, mana.pips) : [],
    nowhere: slots > 0 && placed === 0,
    /* More unmanaged basics than the whole budget: the number typed cannot be
       reached by anything this is allowed to touch. */
    over: budget < held.extra,
    deck:  { from: cards,             to: cards + moved },
    lands: { from: mana.lands.total,  to: mana.lands.total + moved },
    still: _dbBasicsStill(rows, mana.lands.total + moved),
  };
}

/* A colour the split rounds to nothing, in a deck where nothing else makes it.
 *
 * Two halves, and both are needed. Rounded to nothing is dbBasicsSplit()'s
 * answer, not the deck's current basics: a deck with four Forests whose split
 * comes back with none is about to lose its green, and the row moving from 4
 * to 0 is exactly the case worth catching. Nothing else makes it is
 * dbDeckMana()'s source count with the basics this manages taken back out of
 * it — a Forest is a green source and counting it here would have the flag
 * telling us green is fine right up until the write removes it.
 *
 * Scoped to the colours a split is allowed to place, so it and the toggle
 * agree: a deck with {C} pips and no Wastes is not flagged, because {C} sits
 * out of the split by a rule of its own and the toggle would not seat it
 * either. */
function _dbBasicsStarved(split, mana, managed) {
  return _dbBasicsNought(split, mana.pips)
    .filter(c => mana.sources[c.id] - managed[c.id] <= 0);
}

/** The colours the deck asks for that a split leaves with no basic at all. */
const _dbBasicsNought = (split, pips) => {
  const want = _dbBasicsWant(pips);
  return DB_MANA_COLORS.filter(c => want[c.id] > 0 && split[c.id] === 0);
};

/* The check, run over the deck this would make — which is the line the spec
 * says the preview exists for. The case worth catching is the one where the
 * split cost three spells and fixed nothing.
 *
 * It is arithmetic rather than a second walk over a hypothetical deck: a basic
 * makes exactly its own colour, so the sources after are the sources now plus
 * what each row moved by. The bars are re-read at the new land count, because
 * more lands is a different row of the table and a split that grows the deck
 * moves the goalposts it is being measured against. */
function _dbBasicsStill(rows, lands) {
  const mana  = dbDeckMana();
  const moved = dbManaZero();
  for (const r of rows) moved[r.id] = r.to - r.from;
  const bars = _dbSourcesBars(_dbSourcesDemands(dbDeckFormat().id, lands));
  return DB_MANA_COLORS
    .filter(c => bars[c.id])
    .map(c => ({ id: c.id, label: c.label,
                 gap: bars[c.id].want - (mana.fromLands[c.id] + moved[c.id]) }))
    .filter(c => c.gap > 0);
}

// ── The optimizer, drawn ──────────────────────────────────────────────────

/* The whole control. Not drawn at all on somebody else's deck: the check above
 * it and the cycles below are readings of a deck and this is an edit of one,
 * and a button that greys out is still a button that has to be explained. */
function _dbBasicsHtml() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return '';
  const plan  = _dbBasicsBudget === null ? null : dbBasicsPlan(_dbBasicsBudget);
  /* The field holds the number a plan is up for, or — with no plan up — what
     the deck runs now, so that the default press means "re-balance the basics
     I already have" and changes the split without changing the deck's size. */
  const asked = _dbBasicsBudget === null ? _dbBasicsHeld().total : _dbBasicsBudget;
  return `<div class="db-basics">
    <div class="db-sources-hdr"><span class="db-sources-title">Optimize basics</span></div>
    <div class="db-basics-ask">
      <label class="db-basics-lbl" for="dbBasicsN">How many basics</label>
      <input id="dbBasicsN" class="db-basics-n" type="number" min="0" step="1"
             inputmode="numeric" value="${asked}"
             oninput="dbBasicsTyped()" onkeydown="if(event.key==='Enter')dbBasicsPress()">
      <button id="dbBasicsGo" class="db-basics-go" onclick="dbBasicsPress()">
        ${_dbBasicsReady(plan) ? 'Apply' : 'Preview'}</button>
    </div>
    ${_dbBasicsOneEachHtml()}
    <div id="dbBasicsPreview" class="db-basics-preview">${plan ? _dbBasicsPreviewHtml(plan) : ''}</div>
    <div class="db-sources-limit">${esc(
      'A total, not an addition — split across the colours by pips.')}</div>
  </div>`;
}

/* The override, on a line of its own under the row it modifies rather than
 * squeezed into it: the field and the button are one gesture with two steps,
 * and a third control between them would read as part of the sentence they
 * make. The label points at the box with `for` rather than wrapping it, which
 * is how the drawer's other checkbox gets to a finger's worth of tap target
 * without the box itself having to be finger-sized. */
function _dbBasicsOneEachHtml() {
  const on = dbBasicsOneEach();
  return `<span class="db-basics-one-each">
    <input type="checkbox" id="dbBasicsEachBox"${on ? ' checked' : ''}
           onchange="dbSetBasicsOneEach(this.checked)">
    <label for="dbBasicsEachBox">${esc('At least 1 basic of every colour')}</label>
  </span>`;
}

/* Whether the next press is the one that writes.
 *
 * Three things have to hold, and the two beyond "something would change" are
 * both the same hazard: this must not write a plan made against a deck it
 * cannot see. A budget with nowhere to go moves every basic to nought, which
 * is a preview saying "there is nowhere to put these" over a button that
 * empties the deck; a deck with cards still in flight is one whose basics this
 * has not finished counting. Both are drawn, and neither is pressable. */
const _dbBasicsReady = plan =>
  !!plan && plan.changed.length > 0 && !plan.nowhere && !plan.blind.length;

/* What it would do, before it does it: the rows, the resulting deck size and
 * land total, and what the check would still say. The size line is there
 * because growing the basics means other cards have to go, and the verdict
 * line because a split that cost three spells and fixed nothing is the failure
 * worth seeing before the press rather than after. */
function _dbBasicsPreviewHtml(plan) {
  const rows = plan.rows.map(r => `<div class="db-basics-row${r.to === r.from ? ' db-basics-same' : ''}">
    ${_dbSourcesSym(r)}
    <span class="db-basics-card">${esc(r.name)}</span>
    <span class="db-basics-fig">${r.from} → <strong>${r.to}</strong></span>
  </div>`).join('');

  const size = `<div class="db-basics-size">deck ${plan.deck.from} → <strong>${plan.deck.to}</strong>
    · lands ${plan.lands.from} → <strong>${plan.lands.to}</strong></div>`;

  return `${_dbBasicsBlindHtml(plan)}${_dbBasicsSpareHtml(plan)}${rows}` +
         `${plan.rows.length ? size : ''}${_dbBasicsUnseatedHtml(plan)}` +
         `${_dbBasicsStarvedHtml(plan)}${_dbBasicsStillHtml(plan)}`;
}

/* What the app has not read yet, named the way the check names it — because a
 * deck reported as wanting no white while eleven of its cards are still in
 * flight is the one kind of wrong a mana base cannot survive, and any of those
 * eleven could be a basic this budget has not counted. */
function _dbBasicsBlindHtml(plan) {
  const n = plan.blind.length;
  if (!n) return '';
  return `<div class="db-basics-verdict">${esc(
    _dbBlindSentence(plan.blind,
      `${n === 1 ? 'it' : 'any of them'} could be a basic this has not counted`) +
    ` Nothing is written until ${n === 1 ? 'it arrives' : 'they arrive'}.`)}</div>`;
}

/* The basics that came off the budget, named. We are not adding snow support;
 * we are making the edge case visible to the person who has to fix it by
 * hand, which is the whole of what this line is for. */
function _dbBasicsSpareHtml(plan) {
  if (!plan.spare.length) return '';
  const named = plan.spare.map(s => `${s.qty} ${_dbBasicsPlural(s.name, s.qty)}`).join(' and ');
  const tail  = plan.over
    ? `that is already more than ${plan.budget}, so there is nothing left to split`
    : `${plan.slots} to split`;
  return `<div class="db-basics-spare">${esc(`${named} aren’t touched — ${tail}`)}</div>`;
}

/** A card name, more than once. Enough English for six land names. */
const _dbBasicsPlural = (name, n) =>
  n === 1 || /s$/i.test(name) ? name : `${name}s`;

/* Where the override was asked for and could not be given: a budget smaller
 * than the number of colours in the deck. Said before the line below it
 * because it is the reason for it — a colour at nought under a ticked box is
 * not the proportional split having chosen that, and being told it in the
 * split's own words would be the switch failing quietly. */
function _dbBasicsUnseatedHtml(plan) {
  if (plan.nowhere || !plan.unseated.length) return '';
  const names = plan.unseated.map(c => c.label).join(' and ');
  return `<div class="db-basics-verdict">${esc(
    `a budget of ${plan.slots} cannot give every colour one — ` +
    `${names} ${plan.unseated.length === 1 ? 'goes' : 'go'} without`)}</div>`;
}

/* A colour that rounds to nothing in a deck where nothing else makes it,
 * named before the shortfalls below it — being unable to cast a colour at all
 * is a different order of finding from being four sources light of a bar, and
 * it is the one the toggle above fixes. Not a warning against pressing:
 * plenty of decks mean it, and the deck that does not now knows to say so. */
function _dbBasicsStarvedHtml(plan) {
  if (plan.nowhere || !plan.starved.length) return '';
  return plan.starved.map(c => `<div class="db-basics-verdict">${esc(
    `${c.label} rounded to 0 basics, and nothing else in the deck makes ${c.label}`)}</div>`).join('');
}

/* What the check would still say, which is the reason the preview is worth
 * reading rather than a formality on the way to the button. Named as a land
 * rather than a basic, because that is what the answer is: a colour the split
 * cannot reach needs a dual, and the fix region underneath lists them. */
function _dbBasicsStillHtml(plan) {
  if (plan.nowhere) {
    return `<div class="db-basics-verdict">${esc(
      'Nothing in the deck asks for a colour yet, so there is nowhere to put these.')}</div>`;
  }
  if (!plan.rows.length) return '';
  if (!plan.still.length) {
    return `<div class="db-basics-verdict db-basics-clear">${esc('every colour clears its bar')}</div>`;
  }
  const short = plan.still.map(c => `${c.label} ${c.gap}`).join(', ');
  return `<div class="db-basics-verdict">${esc(
    `still short: ${short} — ` +
    `${plan.still.length === 1 ? 'a land, not a basic' : 'lands, not basics'}`)}</div>`;
}

// ── The two presses ───────────────────────────────────────────────────────

/** The number in the field, read the way a budget has to be read. */
function _dbBasicsAsked() {
  const raw = String(document.getElementById('dbBasicsN')?.value ?? '').trim();
  const n   = Math.round(Number(raw));
  /* Emptied out is the prefill again, not nought. A field somebody has just
     cleared to type a new number into is not an instruction to throw every
     basic out of the deck. */
  return raw === '' || !Number.isFinite(n) ? _dbBasicsHeld().total : Math.max(0, n);
}

/* The button. Which press this is is decided by the state rather than by a
 * mode: a plan is on screen for this number, or it is not. Typing a different
 * number takes the plan down, so "press twice" cannot mean "press once, change
 * your mind, and write the first answer". */
async function dbBasicsPress() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  const asked = _dbBasicsAsked();
  if (_dbBasicsBudget === asked && _dbBasicsReady(dbBasicsPlan(asked))) return dbBasicsApply();

  /* The press that draws a preview is also the one that goes and fetches
     whatever the app is still missing, so that refusing to write against a
     half-read deck is a wait rather than a dead end: press once and the facts
     are asked for, press again and the plan is against a deck it can see all
     of. */
  const deckId = dbDeck.id;
  const blind  = dbDeckMana().unknown;
  if (blind.length) {
    await dbFetchCardData(blind);
    if (!dbDeck || dbDeck.id !== deckId || !isMyPlayer(dbDeck.playerId)) return;
  }
  /* Read again on this side of the await: an empty field means the deck's own
     count, and that count is one of the things the facts just changed. */
  _dbBasicsBudget = _dbBasicsAsked();
  _dbRenderLands();
}

/* The field, typed in. The plan goes, because it is a plan for a number that
 * is no longer the one being asked for — and it goes without redrawing the
 * tab, because a redraw would take the field out from under the cursor
 * mid-number. */
function dbBasicsTyped() {
  if (_dbBasicsBudget === null) return;
  _dbBasicsBudget = null;
  _dbBasicsRepaint();
}

/* The preview and the button, redrawn off the state without redrawing the tab
 * around them. Two elements, patched by hand, because they are the two the
 * state decides and a full redraw would move the field being typed into. With
 * no plan up this draws the empty preview and the first press, which is what
 * dbBasicsTyped() wants; with one up it re-splits, which is what the toggle
 * does. */
function _dbBasicsRepaint() {
  const plan = _dbBasicsBudget === null ? null : dbBasicsPlan(_dbBasicsBudget);
  const box  = document.getElementById('dbBasicsPreview');
  const go   = document.getElementById('dbBasicsGo');
  if (box) box.innerHTML = plan ? _dbBasicsPreviewHtml(plan) : '';
  if (go)  go.textContent = _dbBasicsReady(plan) ? 'Apply' : 'Preview';
}

/* The write. Quantities set on the rows the deck already has, not a loop of
 * dbAddCard() — that adds one copy at a time, is async, re-fetches card data
 * and re-renders on each of them. Setting quantities is what preserves a
 * Plains somebody filed under a custom "Mana Base", lets a colour going to
 * nought be properly removed instead of clamped at one by dbChangeQty(), and
 * makes the whole change one render and one save rather than fifteen.
 *
 * This is a second write path into dbCards, so it owes the hooks the edit
 * module calls — the snapshot in front of it, and dbRenderStats() behind it,
 * which is where dbManaChanged() lives and therefore where the check above
 * this control stops being a reading of the deck as it was. */
async function dbBasicsApply() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  const deckId = dbDeck.id;

  /* The facts first, for any basic the deck has never held: dbAutoCategory()
     reads the type line, and a Plains categorised before Scryfall said it was
     a land would be filed under "Other" for good. */
  const fresh = dbBasicsPlan(_dbBasicsAsked()).rows
    .filter(r => r.to > 0 && !dbFindCard(dbPlace(DB_MAIN_BOARD, r.name)) && !dbCardData.has(r.name))
    .map(r => r.name);
  if (fresh.length) await dbFetchCardData(fresh);
  if (!dbDeck || dbDeck.id !== deckId || !isMyPlayer(dbDeck.playerId)) return;

  /* Worked out again on this side of the await, against the deck as it stands
     now. Everything the preview showed is a function of the deck and the
     budget, and the deck is the half that can have moved. */
  const plan = dbBasicsPlan(_dbBasicsAsked());
  if (!_dbBasicsReady(plan)) return;

  dbForceSnapshot('basics');

  for (const r of plan.rows) {
    const ref  = dbPlace(DB_MAIN_BOARD, r.name);
    const card = dbFindCard(ref);
    if (r.to === 0) {
      if (card) { dbCards = dbCards.filter(c => c !== card); dbSelectedCards.delete(ref); }
      continue;
    }
    if (card) { card.qty = r.to; continue; }
    const cat = dbAutoCategory(r.name);
    dbEnsureCat(cat);
    dbCards.push({ card_name: r.name, qty: r.to, category: cat,
                   board: DB_MAIN_BOARD, position: dbCards.length });
  }

  _dbBasicsBudget = null;
  dbRender();
  dbRenderStats();
  dbScheduleSave();
}

// ── Fix it: the lands that would close a short colour ─────────────────────
/* The region between the check and the cycles, and the one the spec says
 * could not exist on Archidekt: Archidekt does not know what is in our boxes.
 * For a colour the check calls short, the lands that make it — and the copies
 * somebody in the house already has at the front of them, because a
 * suggestion you can play tonight beats a better one you would have to buy.
 *
 * One section per short colour, and nothing at all for a colour that clears
 * its bar: this is a list of work to do, and a section headed "green" under a
 * check that has just said green is fine is a fix for nothing.
 */

/* A fix section's id, so that one set of open sections, one cache and one
 * toggle can hold both halves of the tab. A cycle is named by its Scryfall
 * predicate and a colour by its letter, and the prefix is what keeps a colour
 * called `dual` from ever being a cycle called `dual`. */
const DB_FIX_PREFIX = 'fix:';

/** The colours short of sources, in the order the check reports them — which
 *  is one fix section each, and none at all for a colour that clears its bar.
 *  Named at length because `short` on its own is already the check's word for
 *  the cards it cannot support, and these are the other thing. */
const _dbSourcesShortColours = () =>
  dbSourcesCheck().colours.filter(c => c.gap > 0);

/* The region, drawn. Nothing at all where the check itself has nothing to say
 * — a deck with no costs in it yet is not a deck that has been found to be
 * fine — and a sentence rather than an empty region where it has. An empty
 * region under a heading reads as one that failed to load, and "nothing to
 * fix" is a finding: it is the one the tab was opened to get. */
function _dbFixHtml(colours, canAdd) {
  if (!dbSourcesCheck().colours.length) return '';
  const short = _dbSourcesShortColours();

  return `<div class="db-fix">
    <div class="db-sources-hdr"><span class="db-sources-title">Fix it</span></div>
    ${short.length
      ? short.map(c => _dbFixSectionHtml(c, colours, canAdd)).join('')
      : '<div class="db-fix-done">Nothing to fix — every colour the deck asks for has the ' +
        'sources the table wants.</div>'}
  </div>`;
}

/* One short colour, as a section of the same shape the cycles below it are —
 * the same one, drawn by the same function. The gap is in the heading because
 * the heading is what is read while the section is shut, and "blue — 10
 * short" is the whole finding. */
const _dbFixSectionHtml = (c, colours, canAdd) =>
  _dbLandSectionHtml(DB_FIX_PREFIX + c.id, colours, {
    heading: () => `${_dbSourcesSym(c)}
      <span class="db-fix-name">${esc(c.label)} — ${c.gap} short</span>`,
    body: got => _dbFixBody(c, got, canAdd),
  });

/* And one short colour, as Scryfall reads it: every land that makes it, in
 * the colours the deck may play, most-played first — which is `order=edhrec`,
 * asked for in the same place the cycles ask for it.
 *
 * `t:land` and not "anything with produced_mana": the check counts land
 * sources and nothing else, so a Signet offered here would be a suggestion
 * that cannot move the number it was offered to move.
 *
 * `-t:basic` because sorting by play rate would otherwise put Island at the
 * top of every list of what makes blue. A colour short of basics is a split
 * rather than a search. */
function dbFixQuery(colour, colours) {
  return `t:land produces:${colour.toLowerCase()} -t:basic${
    colours ? ` id<=${colours.toLowerCase()}` : ''}`;
}

/* One open colour's insides. The wait and the failure are the cycles' — this
 * half of the tab pays for a request the same way and can fail in the same
 * places — and what differs is the order, which is the point of the region. */
function _dbFixBody(c, got, canAdd) {
  const empty = `Nothing that makes ${c.label} is in the deck’s colours`;
  if (!got?.cards) return _dbLandBody(got, canAdd, empty);

  const offers = _dbFixOffers(got.cards);
  const shown  = _dbFixShown(offers);
  /* Two different nothings, and only one of them is Magic's. A colour every
     land of which is already on the mat is a deck that has done what this
     region asks; sending its owner looking for a card in front of them would
     be the panel failing at the one thing it is for. */
  if (!shown.length) {
    return _dbLandBody({ cards: [] }, canAdd, got.cards.length
      ? `Every land that makes ${c.label} in these colours is already in the deck`
      : empty);
  }

  /* And what it is showing them out of, wherever that is not all of it —
     both because the cut dropped some and because Scryfall's first page never
     held them. A region showing twelve of a hundred and forty-one without
     saying so would read as the whole answer. */
  const cut  = offers.length > shown.length || got.total > got.cards.length;
  const note = cut
    ? `<div class="help-text db-fix-note">Showing ${shown.length} of the ${got.total} lands ` +
      `that make ${esc(c.label)} in these colours — everything somebody has, then the ` +
      `most played.</div>`
    : '';
  return note + _dbLandGrid(shown.map(offer => offer.card), canAdd);
}

/* What the deck could actually be offered, in the order it is offered in: one
 * pass over what came back, and the two questions asked of each card once.
 *
 * ── Whose "somebody" ──────────────────────────────────────────────────────
 *
 * Every loaded shelf, and not the scope the rest of the app is on. The scope
 * answers "is this mine", which is the question the ownership mark on the
 * tile already answers in colour and in fill; this region asks "could we put
 * it in the deck tonight", and a land in Anna's box across the table is a yes.
 *
 * The sort is stable, so the rest of the order is Scryfall's, which is play
 * rate: the only thing this moves is a land somebody has, past the lands
 * nobody has.
 *
 * ── What it cannot rank ───────────────────────────────────────────────────
 *
 * A page of Scryfall's is 175 cards, and a colour in three-colour identity
 * has more lands than that. A copy on the shelf that Magic as a whole plays
 * less than the 175th most-played land in these colours is therefore not in
 * what came back, and nothing here can lift it. The alternative is asking for
 * every page of every colour on a queue the whole house shares — and the note
 * above says what the list is a slice of. */
function _dbFixOffers(cards) {
  const format = dbDeckFormat();
  const runs   = new Map();
  for (const row of [...dbMainCards(), ...dbCommanderCards()]) {
    runs.set(row.card_name, (runs.get(row.card_name) || 0) + (row.qty || 1));
  }
  return cards
    /* A land the deck already runs to the limit cannot close a gap, and a
       list of fixes headed by the three you already have is a list that has
       to be read past. The limit is js/deckview-legality.js's own, so the two
       tabs cannot disagree about what a deck may run: four in a 60-card deck,
       one in Commander, and however many a card that says so allows. The
       maybeboard is not counted — a card set aside is one you have not put in
       the deck. */
    .filter(card => (runs.get(card.name) || 0) < dbCopyLimit(card, format))
    .map(card => ({ card, held: _dbFixHeld(card.name) }))
    .sort((a, b) => (b.held ? 1 : 0) - (a.held ? 1 : 0));
}

/* How many suggestions are a suggestion. A dozen is about four rows of tiles
 * in the drawer, which is a list somebody reads; a hundred and forty is a
 * list somebody scrolls past.
 *
 * Everything on a shelf in the house survives the cut, however far down play
 * rate it sits — that is the region's one claim over Archidekt's, and cutting
 * it to make room for a land nobody has would be cutting the answer to keep
 * the ranking tidy. */
const DB_FIX_SHOWN = 12;

const _dbFixShown = offers => {
  const held = offers.filter(offer => offer.held);
  return held.length >= DB_FIX_SHOWN ? held : offers.slice(0, DB_FIX_SHOWN);
};

/* Whether anybody in the house has one. Asked of the name the shelves file it
 * under, because a Pathway is written both ways and a shelf holding
 * "Barkchannel Pathway" would otherwise answer "no" to the whole card's name.
 * ownedQty() counts the shelf in scope and holdersOf() everybody else, so the
 * two together are every collection loaded, whatever the scope is set to. */
const _dbFixHeld = name => {
  const filed = ownedName(name);
  return dbOwnedQty(filed) > 0 || dbHoldersOf(filed).length > 0;
};

/* ── The cycles ────────────────────────────────────────────────────────────
 *
 * `id` is the Scryfall predicate, spelled exactly: the query is `is:${id}`, so
 * the list holds one spelling of each name rather than two that can drift
 * apart.
 *
 * That spelling is the whole of the risk here, and it is a quiet one. An `is:`
 * value Scryfall does not recognise is *silently ignored* rather than refused
 * — `is:shocklnd t:land` does not error, it returns every land in Magic — so a
 * typo produces a section headed "Shocklands" holding twelve hundred cards.
 * Nothing at runtime can tell that apart from an unusually generous cycle, so
 * the guard is test/decklands.test.js, which pins the size of every cycle on
 * this list as a constant and says how to re-probe them by hand.
 *
 * Ordered by how often a deck reaches for them rather than alphabetically: the
 * answer to "what are my options" starts with the lands people are actually
 * choosing between. */
const DB_LAND_CYCLES = [
  { id: 'fetchland',    label: 'Fetchlands' },
  { id: 'shockland',    label: 'Shocklands' },
  { id: 'dual',         label: 'Original duals' },
  { id: 'triome',       label: 'Triomes' },
  { id: 'painland',     label: 'Painlands' },
  { id: 'checkland',    label: 'Checklands' },
  { id: 'fastland',     label: 'Fastlands' },
  { id: 'slowland',     label: 'Slowlands' },
  { id: 'scryland',     label: 'Scrylands' },
  { id: 'battleland',   label: 'Battlelands' },
  { id: 'pathway',      label: 'Pathways' },
  { id: 'surveilland',  label: 'Surveil lands' },
  { id: 'cycleland',    label: 'Cycling lands' },
  { id: 'triland',      label: 'Trilands' },
  { id: 'filterland',   label: 'Filter lands' },
  { id: 'bounceland',   label: 'Bounce lands' },
  { id: 'gainland',     label: 'Gain lands' },
  { id: 'canopyland',   label: 'Canopy lands' },
  { id: 'storageland',  label: 'Storage lands' },
  { id: 'creatureland', label: 'Creature lands' },
];

/* Which sections are open, what each one came back with, and what is still in
 * the air. The cache is keyed by cycle *and* colours, so a deck in different
 * colours asks again rather than being shown the last deck's answer, and the
 * same deck opening the same section twice is answered from here.
 *
 * It outlives the deck on purpose. "Shocklands in Bant" is a fact about Magic
 * rather than about a deck, so switching decks and coming back is free. What
 * does not outlive the deck is which sections were open: arriving at a new
 * deck with the last one's sections spread out is the tab having been used by
 * nobody. */
const _dbLandOpen   = new Set();   // cycle ids the reader has expanded
const _dbLandCache  = new Map();   // `${id}|${colours}` → {cards} | {error}
const _dbLandFlight = new Map();   // the same key, while its request is out
const _dbLandAsking = new Map();   // and the redraw waiting on the back of it

/** Some colours, spelled the one way every colour in this app is spelled. */
const _dbLandColours = have => [...'WUBRG'].filter(c => have.has(c)).join('');

/* The colours to filter on, as the letters `id<=` wants, or '' for no filter.
 *
 * The commander is the answer when there is one — the same identity the search
 * box's toggle and the legality tab use, so the drawer cannot disagree with
 * itself about what the deck may play. With no commander it is the union of
 * the colours the deck's own cards carry, which is a worse filter and not
 * nothing: "show me the shocklands I could run" is a fair question to ask of a
 * 60-card deck, which never has a commander at all. The deck's own cards are
 * the deck's, not the sideboard's or the maybeboard's — the same cards the
 * legality check judges a 60-card deck on.
 *
 * 'C' rather than '' for a deck with no colours in it: a colourless deck may
 * play colourless lands, and an empty filter would answer it with every land
 * in Magic. That holds on both sides of the question — a Kozilek deck and a
 * 60-card artifact pile have both been read, and what they say is
 * "colourless".
 *
 * The empty string is what is left when nothing can say, and a deck only half
 * read counts as nothing where it would change the answer. dbCommanderIdentity()
 * refuses a commander whose card has not arrived because half an identity is a
 * wrong answer rather than a smaller one, and the same refusal belongs here:
 * a deck whose Sol Ring has arrived and whose Lightning Bolt has not is not a
 * colourless deck, and calling it one answers every coloured section with
 * "nothing in this cycle is in these colours". A part-read deck that does show
 * a colour is still filtered on the colours it showed — narrower than the
 * truth, never wrong about what it did read — and the render asks again the
 * moment the rest of it lands. */
function dbLandIdentity() {
  const ci = dbCommanderIdentity();
  if (ci) return _dbLandColours(ci) || 'C';
  const seen = new Set();
  let read = 0, missing = false;
  for (const row of dbMainCards()) {
    const sf = dbCardData.get(row.card_name);
    if (!sf) { missing = true; continue; }
    read++;
    for (const c of dbIdentityOf(sf)) seen.add(c);
  }
  return _dbLandColours(seen) || (read && !missing ? 'C' : '');
}

/* Whether the deck has a commander whose colours we could not read.
 *
 * dbCommanderIdentity() answers null to two different questions — there is no
 * commander, and there is one whose card has not arrived yet — because for its
 * own purpose those are the same answer: identity goes unchecked either way.
 * Here they are not the same, and only the caption can tell them apart: a deck
 * with a commander must not be told it has none. */
const _dbLandCommanderPending = () =>
  !dbCommanderIdentity() && (dbCommanderCards().length > 0 || !!dbDeck?.commander);

/** One cycle, in one deck's colours, as Scryfall reads it. */
function dbLandQuery(id, colours) {
  return `is:${id}${colours ? ` id<=${colours.toLowerCase()}` : ''}`;
}

/* Which question a section id stands for. One cache, one set of open sections
 * and one toggle serve both halves of the tab, and this is the one place that
 * knows a fix section from a cycle. */
const _dbSectionQuery = (id, colours) => id.startsWith(DB_FIX_PREFIX)
  ? dbFixQuery(id.slice(DB_FIX_PREFIX.length), colours)
  : dbLandQuery(id, colours);

const _dbLandKey = (id, colours) => `${id}|${colours}`;

/* One section's cards, fetched once.
 *
 * Everything that can happen to a request ends up in the cache as a settled
 * answer, including both kinds of nothing: Scryfall says 404 when a query
 * matches no cards, which for a mono-white deck asking about triomes is not a
 * failure but the correct answer, and it is read as one. */
async function _dbLoadLandSection(id, colours) {
  const key = _dbLandKey(id, colours);
  if (_dbLandCache.has(key))  return _dbLandCache.get(key);
  if (_dbLandFlight.has(key)) return _dbLandFlight.get(key);

  const job = (async () => {
    let answer;
    try {
      const q   = _dbSectionQuery(id, colours);
      const res = await scryfallFetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=edhrec&unique=cards`);
      const data = await res.json();
      if (data.object === 'error') {
        answer = data.status === 404
          ? { cards: [] }
          : { error: data.details || 'Scryfall could not answer that' };
      } else {
        const cards = data.data || [];
        const total = Number.isFinite(data.total_cards) ? data.total_cards : cards.length;
        /* Into the tab's card cache on the way past, the way a search does:
           the + adds by name, and a name the tab has no card for is a second
           request for something we are already holding. */
        dbCacheCards(cards);
        answer = { cards, total };
      }
    } catch (e) {
      answer = { error: e.message };
    }
    _dbLandCache.set(key, answer);
    _dbLandFlight.delete(key);
    return answer;
  })();

  _dbLandFlight.set(key, job);
  return job;
}

/* An open section that has no answer yet asks for one, and redraws when it
 * arrives. Called from the render rather than from the press, because opening
 * a section is not the only way to want a cycle you have not got: the colours
 * are part of the question, and adding a card to a colourless-so-far deck
 * changes them under a section that is already open. Asking here is what makes
 * that section re-ask rather than sit on "Loading…" for ever.
 *
 * At most one request per cycle-and-colours in the air, and the redraw is on
 * the back of it, so the chain settles: the second render finds the answer in
 * the cache and asks for nothing. */
function _dbAskForLandSection(id, colours) {
  const key = _dbLandKey(id, colours);
  if (_dbLandAsking.has(key)) return _dbLandAsking.get(key);
  const asking = _dbLoadLandSection(id, colours).then(() => {
    _dbLandAsking.delete(key);
    /* Unless it was shut again while the request was out, in which case the
       answer is in the cache for next time and drawing it would reopen a
       section the reader has closed. */
    if (_dbLandOpen.has(id)) _dbRenderLands();
  });
  _dbLandAsking.set(key, asking);
  return asking;
}

/* A section pressed. Opening one that has not been opened in these colours is
 * the only thing on this tab that costs a request; the render is what makes
 * it, and the request is handed back here so that pressing a section is
 * something a caller can wait for. */
function dbToggleLandSection(id) {
  if (_dbLandOpen.has(id)) { _dbLandOpen.delete(id); _dbRenderLands(); return; }
  _dbLandOpen.add(id);
  /* A failure is not an answer, so it is not one this section is stuck with:
     it stays on screen while the section is open — closing it is how you say
     you have read it — and opening the section again asks Scryfall again. A
     lost connection for one second must not cost a cycle until the deck is
     switched. */
  const key = _dbLandKey(id, dbLandIdentity());
  if (_dbLandCache.get(key)?.error) _dbLandCache.delete(key);
  _dbRenderLands();
  return _dbLandAsking.get(key);
}

/** What the filter is doing, said out loud rather than left to be noticed. */
function _dbLandFilterNote(colours) {
  const shown = colours === 'C' ? 'colourless' : colours;
  if (_dbLandCommanderPending()) {
    return colours
      ? `The commander’s colours aren’t in yet — the deck’s own, for now: ${shown}`
      : 'The commander’s colours aren’t in yet — every cycle, unfiltered';
  }
  if (!colours) return 'No commander and no colours yet — every cycle, unfiltered';
  return dbCommanderIdentity()
    ? `In the commander’s colours — ${shown}`
    : `No commander, so in the deck’s own colours — ${shown}`;
}

/* The whole tab, drawn out of the sets and the cache above. Every section
 * every time rather than patching the one that changed: a tile says what the
 * deck already holds and where the + would put it, so a + pressed in one open
 * section is news to every other open section too. */
function _dbRenderLands() {
  const el = document.getElementById('dbLandsContent');
  if (!el) return;
  const colours = dbLandIdentity();
  const canAdd  = !!(dbDeck && isMyPlayer(dbDeck.playerId));

  const sections = DB_LAND_CYCLES.map(cycle =>
    _dbLandSectionHtml(cycle.id, colours, {
      heading: got => `<span class="db-land-name">${esc(cycle.label)}</span>
        ${got?.cards ? `<span class="db-land-count">${got.cards.length}</span>` : ''}`,
      body: got => _dbLandBody(got, canAdd),
    })).join('');

  el.innerHTML = _dbSourcesHtml() + _dbBasicsHtml() + _dbFixHtml(colours, canAdd) +
    `<div class="help-text db-land-note">${esc(_dbLandFilterNote(colours))}</div>${sections}` +
    _dbLandsCalcHtml();
}

/* One section of the tab, of either kind: shut until it is pressed, one
 * Scryfall request when it is, and whatever it came back with underneath.
 * Both halves draw this — a colour and a cycle are the same gesture, and what
 * differs between them is only what the heading says and what goes in the
 * body.
 *
 * The asking is here rather than at the press, for the reason
 * _dbAskForLandSection() gives: the colours are part of the question, and a
 * section already open can have them change underneath it.
 *
 * The caret is typed rather than drawn the way pileToggleHtml() draws one,
 * because that is a button of its own and the whole row is the control here —
 * a name you have to miss to hit is a row that reads as pressable and mostly
 * is not. A button cannot hold another button. */
function _dbLandSectionHtml(id, colours, { heading, body }) {
  const open = _dbLandOpen.has(id);
  const got  = open ? _dbLandCache.get(_dbLandKey(id, colours)) : null;
  if (open && !got) _dbAskForLandSection(id, colours);
  return `<div class="db-land-section">
    <button class="db-land-hdr" aria-expanded="${open}"
            onclick="dbToggleLandSection('${jsAttr(id)}')">
      <span class="db-land-caret">${open ? '▾' : '▸'}</span>
      ${heading(got)}
    </button>
    ${open ? `<div class="db-land-body">${body(got)}</div>` : ''}
  </div>`;
}

/** One open section's insides: the wait, the failure, the nothing, or the grid. */
function _dbLandBody(got, canAdd, empty = 'Nothing in this cycle is in these colours') {
  if (!got) return '<div class="empty-state" style="padding:var(--space-3)">Loading…</div>';
  if (got.error) {
    return `<div class="error-msg" style="margin:var(--space-2) 0">${esc(got.error)}</div>`;
  }
  if (!got.cards.length) {
    return `<div class="empty-state" style="padding:var(--space-3)">${esc(empty)}</div>`;
  }
  return _dbLandGrid(got.cards, canAdd);
}

/** The cards, as the drawer's own tiles. Both halves of the tab draw this one. */
const _dbLandGrid = (cards, canAdd) =>
  `<div class="sf-grid db-find-grid">${cards.map(card =>
    dbDrawerTile(card.name, {
      img: dbSfImg(card), canAdd,
      /* The price and the want-list button, the same two things the Search
         half puts on a tile: a fetchland you can play tonight and a fetchland
         you would have to buy are not the same suggestion. */
      badges: `${renderPrice(card)}${wantBtnHtml(card.name)}`,
    })).join('')}</div>`;

// ── The way in, and the one way out ───────────────────────────────────────

/* The tab, opened from outside the drawer — which is the readout's lands
 * figure and nothing else. The figure used to raise a panel of its own out of
 * that line; the check at the top of this tab is the same comparison with the
 * requirement beside it and the fix underneath, so the figure is a door here
 * rather than a second reading of the same numbers ten pixels away.
 *
 * The drawer is opened as well as switched: on the deck tab it is shut until
 * something asks for it, and a tab switched to inside a shut drawer is a press
 * that does nothing. Both halves of that are js/deckview-panels.js's, which is
 * the file this tab's furniture comes from anyway — dbDrawerTile() and the two
 * beside it, public there because this tab is one of the drawer's tabs and is
 * not in that file. */
function dbOpenLandsTab() {
  dbOpenSearchPanel();
  dbSetLeftTab('lands');
}

/* And the way out: the Mana Base Calculator, which this tab did not absorb and
 * will not. It is the only thing in the app that works with no deck loaded,
 * which is the case this tab cannot serve — every number here is read off the
 * deck on the mat. So it keeps a line through to it, worded as what it now is
 * rather than as a second opinion on the check above.
 *
 * At the foot of the tab rather than at the top, because it is a way *out* and
 * the cycles are what somebody opened this for. dbOpenInCalculator() is the
 * mana module's — it is the fill as much as the jump, and the fill is that
 * module's answer to what the deck holds. */
const _dbLandsCalcHtml = () => `<div class="db-lands-calc">
  <button class="db-lands-calc-link" onclick="dbOpenInCalculator()">Mana Base Calculator</button>
  <span class="db-lands-calc-note">— a mana base worked by hand, or one worked out for a deck that doesn’t exist yet</span>
</div>`;

/* A different deck is on the mat, so everything on this tab that was a fact
 * about the last one goes: which sections were spread out, whether the
 * argument behind the check and the small print under it were, and any plan
 * the optimizer had worked out. What was *fetched* stays fetched — what a
 * cycle holds is a fact about Magic and not about the deck that asked for it.
 *
 * All of that in one call, because all of it is what a deck change means and
 * js/deckview-core.js has three paths into one. Taking only the sections down
 * would leave an Apply button offering to write a split read off a deck that
 * is no longer here. */
function _dbLandsForgetDeck() {
  _dbLandOpen.clear();
  _dbSourcesShortOpen = false;
  _dbSourcesFootOpen  = false;
  /* And the plan, which is a plan for a deck that is no longer on the mat. */
  _dbBasicsBudget = null;
  if (dbLeftTab === 'lands') _dbRenderLands();
}
