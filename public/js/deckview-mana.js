// ── Deck Builder — What the deck's mana wants, against what it makes ──────
// The Mana Base Calculator has done the right maths since long before this
// module existed: basics split proportionally by pip count, by largest
// remainder so the numbers always add up. And then it asked a person to count
// the white pips in their deck by hand and type them in, while the deck holding
// every one of those numbers sat one tab away. Two features that share a domain
// and do not speak.
//
// This is the speaking. It is one pass over the open deck for two questions —
// what its spells demand, and what its lands and rocks make — and the answer is
// drawn in two places: a panel out of the readout, and the calculator's own
// fields, filled.
//
// ── Pips are what a card costs, not what a deck may hold ──────────────────
//
// The readout has always drawn a row of mana symbols off `color_identity`, and
// that is the right answer to "what colours is this deck" and the wrong one to
// "how many Plains". A card that costs {1}{G} demands one green pip whatever
// its identity says; Deathrite Shaman's identity is BG and its cost is one
// black-or-green symbol. So the pips here are read out of `mana_cost`, symbol
// by symbol, and the colour row on the readout goes on counting cards and now
// says on its tooltip that that is what it counts.
//
// ── A symbol is one pip, however many ways it can be paid ─────────────────
//
// Every symbol in a cost is worth one pip, shared equally between the ways it
// can be paid. {G} is one green. {G/U} is half a green and half a blue —
// either will do, and counting it as a whole pip of each would make a deck of
// hybrid cards demand twice the mana it actually does. {2/W} is half a white,
// because the other way to pay it is two generic and generic buys no basics.
// {W/P} is half a white for the same reason, the other payment being two life.
// {C} is one colourless pip and is why the calculator has a Wastes field.
// Generic and {X} are not pips at all: they say how much mana, not which.
//
// This is a convention rather than a fact, which is why it is written down here
// and said out loud in the panel. What it protects is the only property that
// matters to the maths downstream — the pips of a deck add up to the symbols in
// its costs, so the proportional split of basics is a split of something real.
//
// ── A source is a card that makes mana, land or not ───────────────────────
//
// `produced_mana` is ticket 01's third field and it is what makes the other
// half of this panel possible. A dual land is a source of each of its two
// colours; Birds of Paradise is a source of all five; Sol Ring is a source of
// colourless and is not a land. Counting sources by copies rather than by cards
// is deliberate — a deck with two Command Towers has two of every colour it
// plays — and it is why the source shares are shares of *source slots* rather
// than of cards, which the panel says where it says the number.

/* WUBRG and colourless, in the order every colour list in this app is written
 * in. The ink names the theme's mana tokens rather than repeating hex, the way
 * js/lands.js and js/deckview-totals.js name them: this is Magic colour used as
 * data, and which hue each theme tunes it to is the theme's business. */
const DB_MANA_COLORS = [
  { id: 'W', label: 'white',      basic: 'Plains',   ink: 'var(--mc-w)' },
  { id: 'U', label: 'blue',       basic: 'Island',   ink: 'var(--mc-u)' },
  { id: 'B', label: 'black',      basic: 'Swamp',    ink: 'var(--mc-b)' },
  { id: 'R', label: 'red',        basic: 'Mountain', ink: 'var(--mc-r)' },
  { id: 'G', label: 'green',      basic: 'Forest',   ink: 'var(--mc-g)' },
  { id: 'C', label: 'colourless', basic: 'Wastes',   ink: 'var(--mc-c)' },
];

const DB_MANA_IDS = DB_MANA_COLORS.map(c => c.id);

const _dbManaZero = () => Object.fromEntries(DB_MANA_IDS.map(id => [id, 0]));

// ── Reading a cost ────────────────────────────────────────────────────────

/* Every symbol in a mana cost, as the strings between the braces. Scryfall
 * writes a split card's cost as "{1}{R} // {1}{U}", and the separator carries
 * no braces, so both halves are read and neither is invented — which is the
 * right answer for a card you may cast either way round. */
const _dbManaSymbols = cost => [...String(cost || '').matchAll(/\{([^}]*)\}/g)].map(m => m[1].toUpperCase());

/* What one symbol demands, as a share per colour. The ways it can be paid are
 * its slash-separated parts; each part takes an equal share of the one pip, and
 * the parts that are not a colour — a number, an X, a P — take their share out
 * of the count altogether rather than handing it to a colour that was never
 * required. See the note at the top for why that is the convention. */
function _dbSymbolPips(symbol) {
  const parts = symbol.split('/');
  const each  = 1 / parts.length;
  const out   = {};
  for (const part of parts) {
    if (DB_MANA_IDS.includes(part)) out[part] = (out[part] || 0) + each;
  }
  return out;
}

/* A card's cost. The top-level `mana_cost` when there is one — it already holds
 * both halves of a split card — and the faces' costs when there is not, which
 * is how Scryfall writes a transforming card: nothing on the card, the cost on
 * the front face and usually none at all on the back. */
function _dbManaCostOf(sf) {
  if (sf.mana_cost) return sf.mana_cost;
  return (sf.card_faces || []).map(f => f.mana_cost).filter(Boolean).join('');
}

/* What a card makes. Absent on a card that makes no mana, which is Scryfall's
 * own shape and the reason this is written as a fallback rather than indexed
 * into — a row still in the pre-ticket-01 trim has no `produced_mana` at all,
 * and a card we have no facts about is not a source. */
const _dbProducedBy = sf => sf.produced_mana || [];

/* A basic, of a card already known to be a land. Off the type line, the way
 * js/deckview-legality.js reads the same fact for the copy limit — a basic land
 * says so on itself, and a list of their names is a list that goes stale the
 * next time Wizards prints one. */
const _dbIsBasic = sf => (sf.type_line || '').toLowerCase().includes('basic');

// ── The pass ──────────────────────────────────────────────────────────────
/* One walk, kept until the deck changes — the same shape as
 * js/deckview-totals.js's and js/deckview-legality.js's, and dropped from the
 * same place. Nothing here is reached from dbRender(): the mat's animation is
 * bounded to what is on screen and a deck-wide pass beside it would undo that,
 * which is the promise those two tickets made and this one inherits. */
let _dbMana = null;

function dbManaChanged() { _dbMana = null; }

/** What the deck's spells want and what its lands make, worked out at most once. */
function dbDeckMana() {
  return _dbMana || (_dbMana = _dbComputeMana());
}

function _dbComputeMana() {
  /* The deck, and the card it is built around. The commander is in both halves
   * of this one — you cast it from the command zone, more often than anything
   * else in the box, and a mana base that ignores what it costs is a mana base
   * for a different deck. That is a different rule from the count on the
   * readout, which leaves the commander out because it is not one of the
   * ninety-nine, and the panel says which deck it counted. */
  const cards = [...dbMainCards(), ...dbCommanderCards()];

  const pips    = _dbManaZero();
  const sources = _dbManaZero();
  const unknown = [];   // cards whose facts have not arrived — see below

  let lands = 0, basics = 0, sourceCards = 0, landSources = 0;

  for (const row of cards) {
    const qty = row.qty || 1;
    const sf  = dbCardData.get(row.card_name);

    /* A cache mid-refresh, or a name the batch lookup has not come back with.
     * Counted as nothing and named in the panel: a deck reported as wanting no
     * white because eleven of its cards have not loaded yet is the one kind of
     * wrong a mana base cannot survive. */
    if (!sf) { unknown.push(row.card_name); continue; }

    const isLand = dbCardType(row.card_name) === 'land';
    if (isLand) {
      lands += qty;
      if (_dbIsBasic(sf)) basics += qty;
    }

    for (const symbol of _dbManaSymbols(_dbManaCostOf(sf))) {
      for (const [id, share] of Object.entries(_dbSymbolPips(symbol))) pips[id] += share * qty;
    }

    const makes = _dbProducedBy(sf).filter(c => DB_MANA_IDS.includes(c));
    if (makes.length) {
      sourceCards += qty;
      if (isLand) landSources += qty;
      for (const id of makes) sources[id] += qty;
    }
  }

  const totalPips    = DB_MANA_IDS.reduce((n, id) => n + pips[id], 0);
  const totalSources = DB_MANA_IDS.reduce((n, id) => n + sources[id], 0);

  return {
    pips, sources, totalPips, totalSources,
    /* The one finding this panel is willing to call a fault, because it is the
     * only one that is not a matter of taste: the deck asks for a colour and
     * nothing in it makes that colour. Everything else is two shares side by
     * side and a person to read them. */
    unmade: DB_MANA_IDS.filter(id => pips[id] > 0 && sources[id] === 0),
    lands: { total: lands, basic: basics, nonBasic: lands - basics },
    sourceCards, landSources, otherSources: sourceCards - landSources,
    unknown: [...new Set(unknown)].sort((a, b) => a.localeCompare(b)),
  };
}

// ── The figures, written ──────────────────────────────────────────────────

/* A pip count that may be a half. Hybrid symbols make halves by construction —
 * see the note at the top — and a count rounded on the way to the eye would
 * make two decks with different mana bases show the same number. Whole numbers
 * are written whole, because most of them are. */
const _dbPipNum = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const _dbShare = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0);

// ── The item on the readout ───────────────────────────────────────────────
/* The lands figure, which has been on this line since the tab was written and
 * is now the way into what the lands are *for*. It is the item that opens this
 * panel rather than the row of colour symbols beside it for one reason worth
 * writing down: the symbols leave the line below 900px, and a panel whose only
 * door is hidden on a phone is a panel a phone does not have. */
function dbRenderManaStat() {
  const el = document.getElementById('dbStatLands');
  if (!el) return;
  const { lands, unmade } = dbDeckMana();

  const gap = unmade.length
    ? ` <span class="db-mana-gap">(${unmade.length} colour${unmade.length === 1 ? '' : 's'} unmade)</span>` : '';
  el.innerHTML = `<strong>${lands.total}</strong> lands${gap}`;
  el.title = unmade.length
    ? `The deck asks for ${unmade.map(id => _dbManaColor(id).label).join(' and ')} and nothing in it makes ${unmade.length === 1 ? 'that' : 'those'} — open for the comparison`
    : 'What the deck’s spells want against what its lands make — open for the comparison';
}

const _dbManaColor = id => DB_MANA_COLORS.find(c => c.id === id);

// ── The panel, out of the readout ─────────────────────────────────────────
/* The third panel to rise out of this one thin line, and the third to put the
 * other two away when it opens. They are anchored to the same edge of the same
 * bar, so any two of them open at once would lie on top of each other. */
let _dbManaPanelOpen = false;

function dbToggleManaPanel() {
  _dbManaPanelOpen = !_dbManaPanelOpen;
  if (_dbManaPanelOpen) { dbCloseOwnedPanel(); dbCloseCheckPanel(); }
  _dbSyncManaPanel();
}

function dbCloseManaPanel() {
  if (!_dbManaPanelOpen) return;
  _dbManaPanelOpen = false;
  _dbSyncManaPanel();
}

function _dbSyncManaPanel() {
  const panel = document.getElementById('dbManaPanel');
  document.getElementById('dbStatLands')?.setAttribute('aria-expanded', _dbManaPanelOpen ? 'true' : 'false');
  if (!panel) return;
  panel.style.display = _dbManaPanelOpen ? '' : 'none';
  if (_dbManaPanelOpen) panel.innerHTML = _dbManaPanelHtml();
}

function _dbManaPanelHtml() {
  const mana = dbDeckMana();
  return `
    <div class="db-mana-hdr">
      <span class="db-mana-title">Mana</span>
      <button class="btn-secondary db-mana-calc" onclick="dbOpenInCalculator()"
              title="Fill the Mana Base Calculator from this deck and go to it">Open in the calculator</button>
      <button class="db-mana-close" onclick="dbCloseManaPanel()" title="Close">✕</button>
    </div>
    ${_dbManaRowsHtml(mana)}
    ${_dbManaFootHtml(mana)}`;
}

/* One row per colour the deck touches — one it asks for, or one it makes, or
 * both. A colour that is in neither is not a gap in the deck and does not get a
 * line saying nought against nought. */
function _dbManaRowsHtml(mana) {
  const shown = DB_MANA_COLORS.filter(c => mana.pips[c.id] > 0 || mana.sources[c.id] > 0);

  if (!shown.length) {
    return `<div class="db-mana-none">${mana.unknown.length
      ? 'No cards with facts yet — nothing to compare.'
      : 'Nothing in this deck costs or makes coloured mana.'}</div>`;
  }

  const rows = shown.map(c => {
    const pips    = mana.pips[c.id];
    const sources = mana.sources[c.id];
    const pipPct  = _dbShare(pips, mana.totalPips);
    const srcPct  = _dbShare(sources, mana.totalSources);
    /* Two bars, one over the other, both in the colour's own ink: the share of
       the deck's pips this colour is, and the share of its sources. Reading
       one against the other is the whole of what this panel is for, and a
       shape does that faster than two numbers ever will. */
    const bars = `<span class="db-mana-bars">
        <span class="db-mana-bar"><span style="width:${pipPct}%;background:${c.ink}"></span></span>
        <span class="db-mana-bar"><span style="width:${srcPct}%;background:${c.ink}"></span></span>
      </span>`;
    const said = sources === 0
      ? `<span class="db-mana-warn">nothing makes it</span>`
      : `<span class="db-mana-pct">${pipPct}% of pips · ${srcPct}% of sources</span>`;
    return `<div class="db-mana-row">
      <i class="ms ms-${c.id.toLowerCase()} ms-cost ms-shadow db-mana-sym" title="${esc(c.label)}"></i>
      <span class="db-mana-fig"><strong>${_dbPipNum(pips)}</strong> pips</span>
      ${bars}
      <span class="db-mana-fig"><strong>${sources}</strong> sources</span>
      ${said}
    </div>`;
  }).join('');

  return `<div class="db-mana-group">
    <div class="db-mana-group-hdr">Sources against pips
      <span class="db-mana-note">what the spells want, and what the deck makes</span>
    </div>
    ${rows}
  </div>`;
}

/* What the rows are counted from, said once underneath them rather than
 * hedged into every line: which cards were read, how the halves happen, and
 * the cards nobody could read at all. */
function _dbManaFootHtml(mana) {
  const { lands, otherSources, unknown } = mana;
  const said = [
    `<strong>${lands.total}</strong> land${lands.total === 1 ? '' : 's'} — ` +
      `${lands.basic} basic, ${lands.nonBasic} non-basic`,
    `<strong>${otherSources}</strong> card${otherSources === 1 ? '' : 's'} that make mana without being lands`,
  ];
  const notes = [
    'Pips are counted off mana costs, commander included; a hybrid symbol is half a pip to each of the colours that pays it.',
    'A source is counted for each colour it makes, so a dual land is two — the shares are of source slots, not of cards.',
  ];
  if (unknown.length) {
    notes.push(`${unknown.length} card${unknown.length === 1 ? ' has' : 's have'} no facts yet and ` +
               `${unknown.length === 1 ? 'is' : 'are'} counted in neither: ${unknown.join(', ')}.`);
  }
  return `<div class="db-mana-group">
    <div class="db-mana-counts">${said.map(s => `<span class="db-count-item">${s}</span>`).join('')}</div>
    ${notes.map(n => `<div class="db-mana-limit">${esc(n)}</div>`).join('')}
  </div>`;
}

// ── The calculator, filled ────────────────────────────────────────────────

/* Everything the Mana Base Calculator asks a person to type, as the open deck
 * answers it. Null when there is no deck, which is what leaves the calculator
 * working exactly as it always has for somebody building a mana base before
 * there is a deck to read — that tab is not a view of this one.
 *
 * The pips are rounded here and nowhere else. The calculator's fields are whole
 * numbers, its maths is a proportional split, and half a pip either way cannot
 * move a basic; the panel above keeps the halves because that is where the
 * number is read rather than used. */
function dbManaForCalculator() {
  if (typeof dbDeck === 'undefined' || !dbDeck) return null;
  const mana = dbDeckMana();
  return {
    deckName: dbDeck.name || 'this deck',
    /* What the deck is *for*, not how far along it is: a half-built Commander
       deck is still a hundred cards, and the recommended land count that comes
       off this number is advice about the finished thing. */
    size: dbDeckTarget() + dbCommanderCount(),
    lands: mana.lands.total,
    nonBasics: mana.lands.nonBasic,
    pips: Object.fromEntries(DB_MANA_IDS.map(id => [id, Math.round(mana.pips[id])])),
    unknown: mana.unknown.length,
  };
}

/** Fill the calculator from this deck and go there — the panel's one action. */
function dbOpenInCalculator() {
  if (typeof setTab === 'function') setTab('lands');
  if (typeof landsUseDeck === 'function') landsUseDeck();
}
