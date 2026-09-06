// ── Deck Builder — Lands: the check, the fix, and the cycles browsed ──────
// The drawer's third tab, beside Search and EDHREC. Search asks Magic a
// question you have to know how to phrase, and EDHREC asks what other people
// run. This asks the one question a deck's land slots actually pose — "what
// are my options in these colours?" — and answers it the way the game groups
// lands: by cycle. Shocks, fetches, triomes, painlands and the rest.
//
// What it draws is _dbDrawerTile(), whole. The + means what it means on every
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
// The optimizer the spec puts beside it — the button that re-splits the
// deck's basics — is not here yet. It drops in underneath the check.
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
    for (const face of _dbCostFaces(sf)) {
      const symbols  = _dbManaSymbols(face);
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
    <span class="db-sources-short-fig">wants ${c.want} ${esc(_dbManaColor(c.id).label)}, has ${c.held}</span>
  </div>`).join('');
  return `<div class="db-sources-short">${rows}</div>`;
}

/* What the numbers were read from and what they assume, underneath them rather
 * than hedged into every line. The limits are the panel's own: a floor to
 * argue with, and the things most likely to make the floor wrong. */
function _dbSourcesFootHtml(check) {
  const size  = check.format === 'commander' ? 99 : 60;
  const notes = [
    check.row === check.lands
      ? `Read at the ${check.lands}-land row of the ${size}-card table.`
      : check.row > check.lands
        ? `The table starts at ${check.row} lands and the deck has ${check.lands}, so it is read at ${check.row}.`
        : `The table stops at ${check.row} lands and the deck has ${check.lands}, so it is read at ${check.row}.`,
    'The table assumes every source is untapped and available, so a deck full of taplands overstates itself here.',
    check.format === 'commander'
      ? 'It also asks for the spell on curve, and Commander is multiplayer, where being a turn late is a softer failure than the model counts it as.'
      : 'It also asks for the spell on curve — a deck that can afford to cast a turn late, or a multiplayer game, is a softer deadline than that.',
  ];
  /* Only where a gold card actually set one of the bars above, because it is
     the sort of note that is noise until it is the answer to "why does it want
     one more than the table says". */
  if (check.colours.some(c => c.gold)) {
    notes.push('A cost that asks for two colours at once wants one source more of each than its shape alone — ' +
               'the table’s own rule for gold costs, and an admitted approximation. It also wants sources ' +
               'that make either colour, which these rows have no way to say.');
  }
  /* Named, not just counted. A deck reported as wanting no white because
     eleven of its cards are still in flight is the one kind of wrong a mana
     base cannot survive, and the names are how somebody tells that apart from
     a deck that really has no white in it. */
  if (check.unknown.length) {
    const n = check.unknown.length;
    notes.push(`${n} card${n === 1 ? ' has' : 's have'} no facts yet, and ` +
               `${n === 1 ? 'is' : 'are'} counted in neither half of this: ` +
               `${check.unknown.join(', ')}.`);
  }
  /* The rocks, where there are any. A deck with none saying "and 0 other
     sources" would be answering a question nobody in front of it has. */
  const other = check.other
    ? `<span class="db-sources-counts">and <strong>${check.other}</strong> other ` +
      `source${check.other === 1 ? '' : 's'} — rocks and dorks, which the table does not count</span>`
    : '';
  return `${other}${notes.map(n => `<div class="db-sources-limit">${esc(n)}</div>`).join('')}`;
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

/** The colours to offer a fix for, in the order the check reports them. */
const _dbSourcesFix = () => dbSourcesCheck().colours.filter(c => c.gap > 0);

/* The region, drawn. Nothing at all where the check itself has nothing to say
 * — a deck with no costs in it yet is not a deck that has been found to be
 * fine — and a sentence rather than an empty region where it has. An empty
 * region under a heading reads as one that failed to load, and "nothing to
 * fix" is a finding: it is the one the tab was opened to get. */
function _dbFixHtml(colours, canAdd) {
  if (!dbSourcesCheck().colours.length) return '';
  const short = _dbSourcesFix();

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
    .filter(card => (runs.get(card.name) || 0) < _dbCopyLimit(card, format))
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
    for (const c of _dbIdentityOf(sf)) seen.add(c);
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
        _dbCacheCards(cards);
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

  el.innerHTML = _dbSourcesHtml() + _dbFixHtml(colours, canAdd) +
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
    _dbDrawerTile(card.name, {
      img: _dbSfImg(card), canAdd,
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
 * a file this one already reaches into unguarded for the drawer's own tile. */
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

/* A different deck is on the mat. What was fetched stays fetched — it is a
 * fact about Magic and not about the deck that asked for it — and the sections
 * close, because which cycles you had spread out is a fact about the deck you
 * were building. */
function _dbLandsClose() {
  _dbLandOpen.clear();
  _dbSourcesShortOpen = false;
  if (dbLeftTab === 'lands') _dbRenderLands();
}
