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
// read in three places: the lands figure on the readout, the drawer's Lands tab
// (js/deckview-landbase.js), which is what that figure opens, and the
// calculator's own fields, filled.
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
// This is a convention rather than a fact, which is why it is written down
// here. It used to be said out loud on the panel that drew the halves, and
// nothing downstream draws them now — the Lands tab's check reads whole costs
// a card at a time and names the card, and the calculator rounds them on the
// way into its fields. What the convention protects is the only property that
// matters to the maths downstream — the pips of a deck add up to the symbols in
// its costs, so the proportional split of basics is a split of something real.
//
// ── A source is a card that makes mana, land or not ───────────────────────
//
// `produced_mana` is ticket 01's third field and it is what makes the other
// half of the comparison possible. A dual land is a source of each of its two
// colours; Birds of Paradise is a source of all five; Sol Ring is a source of
// colourless and is not a land. Counting sources by copies rather than by cards
// is deliberate — a deck with two Command Towers has two of every colour it
// plays — and it is why a source count is a count of *source slots* rather than
// of cards. Read per colour, which is how the Lands tab reads it, the two are
// the same number: a dual land is one blue source and one white one.

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

/* A tally with a nought against every colour, in WUBRG order. Public: the
 * Lands tab counts sources, wants and moved basics into one of these, so that
 * every per-colour figure in the tab arrives with the same keys in the same
 * order as the pass's own. */
const dbManaZero = () => Object.fromEntries(DB_MANA_IDS.map(id => [id, 0]));

// ── Reading a cost ────────────────────────────────────────────────────────

/* Every symbol in a mana cost, as the strings between the braces. Scryfall
 * writes a split card's cost as "{1}{R} // {1}{U}", and the separator carries
 * no braces, so both halves are read and neither is invented — which is the
 * right answer for a card you may cast either way round.
 *
 * Public: the Lands tab's check reads one face's symbols out of this and then
 * asks its own questions of them. Where a cost is split into faces first, that
 * is dbCostFaces() below. */
const dbManaSymbols = cost => [...String(cost || '').matchAll(/\{([^}]*)\}/g)].map(m => m[1].toUpperCase());

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

/* Every symbol a card costs, wherever the card keeps them: the costs of its
 * faces where it has any, and its own where it has not. Which faces those are
 * is dbCostFaces() below, so that "what are this card's costs" is answered in
 * one place and read here as a total and there one cost at a time.
 *
 * Both halves of a split card are counted, and both halves of an Adventure,
 * which is the right answer for a card you may cast either way round: the pips
 * of a deck are a proportion, and a Stomp cast off two black is black mana
 * somebody had to have. */
const _dbManaCostOf = sf => dbCostFaces(sf).join('');

/* What a card makes. Absent on a card that makes no mana, which is Scryfall's
 * own shape and the reason this is written as a fallback rather than indexed
 * into — a row still in the pre-ticket-01 trim has no `produced_mana` at all,
 * and a card we have no facts about is not a source. */
const _dbProducedBy = sf => sf.produced_mana || [];

/* A basic, of a card already known to be a land. Off the type line, the way
 * js/deckview-legality.js reads the same fact for the copy limit — a basic land
 * says so on itself, and a list of their names is a list that goes stale the
 * next time Wizards prints one.
 *
 * Public: the Lands tab's optimizer decides what it is allowed to touch with
 * it, which is the one place in the app where getting this wrong rewrites
 * somebody's deck. */
const dbIsBasic = sf => (sf.type_line || '').toLowerCase().includes('basic');

/* ── Reading a cost the other way: what it *demands* ──────────────────────
 *
 * Everything in this file reads a cost as a share — a hybrid symbol is half a
 * pip to each of the colours that pays it, so the pips of a deck add up to the
 * symbols in its costs. The Lands tab's check asks a different question of the
 * same string: not "how much of this deck is blue" but "what does this one
 * card make me have before I can cast it", which is a single cost paid at one
 * moment rather than a proportion.
 *
 * That reading lives in js/deckview-landbase.js, beside the only thing that
 * asks it. It used to live here, next to this one, so that the difference
 * between the two was visible rather than discovered — and the difference is
 * worth seeing, which is why this note stays behind pointing at it. What the
 * two readings share is dbCostFaces() below: "what are a card's costs" is
 * answered in one place, read here as a total and there one cost at a time.
 */

/* Every way a card can be cast, as its own cost. Public: the Lands tab's check
 * reads the same faces one cost at a time.
 *
 * A card with faces has one cost per face, and each is a real cost somebody
 * pays on its own: the two halves of a split card, the front of a transforming
 * card (its back is usually free), and — the one that is easy to miss — an
 * Adventure, whose creature and whose spell are two costs on one card. So the
 * faces are read where there are any, and the whole card only where there are
 * not.
 *
 * The `//` fall-back is for a split card whose faces did not come with it:
 * Scryfall writes that cost as "{1}{R} // {W}", both halves in one string, and
 * read whole it is a three-mana spell wanting red and white at once, which is
 * a card that does not exist. */
function dbCostFaces(sf) {
  const faces = (sf.card_faces || []).map(f => f.mana_cost).filter(Boolean);
  if (faces.length) return faces;
  const cost = sf.mana_cost || '';
  if (cost.includes('//')) return cost.split('//').map(s => s.trim()).filter(Boolean);
  return cost ? [cost] : [];
}

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
   * ninety-nine, and the Lands tab says which cards it counted. */
  const cards = [...dbMainCards(), ...dbCommanderCards()];

  const pips    = dbManaZero();
  const sources = dbManaZero();
  /* The same count again, of lands only. Two counts of the same thing looks
   * like a duplicate and is not: this panel's question is "what makes mana in
   * this deck", and the Lands tab's check asks a narrower one, because the
   * simulation its numbers come from sleeves lands and blanks and knows
   * nothing about a Signet. Both are true; they are true about different
   * questions. */
  const fromLands = dbManaZero();
  const unknown   = [];   // cards whose facts have not arrived — see below

  let lands = 0, basics = 0, sourceCards = 0, landSources = 0;

  for (const row of cards) {
    const qty = row.qty || 1;
    const sf  = dbCardData.get(row.card_name);

    /* A cache mid-refresh, or a name the batch lookup has not come back with.
     * Counted as nothing and named on the Lands tab: a deck reported as wanting
     * no white because eleven of its cards have not loaded yet is the one kind
     * of wrong a mana base cannot survive. */
    if (!sf) { unknown.push(row.card_name); continue; }

    const isLand = dbCardType(row.card_name) === 'land';
    if (isLand) {
      lands += qty;
      if (dbIsBasic(sf)) basics += qty;
    }

    for (const symbol of dbManaSymbols(_dbManaCostOf(sf))) {
      for (const [id, share] of Object.entries(_dbSymbolPips(symbol))) pips[id] += share * qty;
    }

    const makes = _dbProducedBy(sf).filter(c => DB_MANA_IDS.includes(c));
    if (makes.length) {
      sourceCards += qty;
      if (isLand) landSources += qty;
      for (const id of makes) {
        sources[id] += qty;
        if (isLand) fromLands[id] += qty;
      }
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
    /* Per colour, the half of `sources` that is lands — what the Lands tab's
     * check holds against the source-count table, and the only half that
     * table's simulation ever had in it. */
    fromLands,
    sourceCards, landSources, otherSources: sourceCards - landSources,
    unknown: [...new Set(unknown)].sort((a, b) => a.localeCompare(b)),
  };
}

// ── The item on the readout ───────────────────────────────────────────────
/* The lands figure, which has been on this line since the tab was written and
 * is now the door to what the lands are *for*. It is the item that opens the
 * Lands tab rather than the row of colour symbols beside it for one reason
 * worth writing down: the symbols leave the line below 900px, and a door that
 * is hidden on a phone is a door a phone does not have. */
function dbRenderManaStat() {
  const el = document.getElementById('dbStatLands');
  if (!el) return;
  const { lands, unmade } = dbDeckMana();

  const gap = unmade.length
    ? ` <span class="db-mana-gap">(${unmade.length} colour${unmade.length === 1 ? '' : 's'} unmade)</span>` : '';
  el.innerHTML = `<strong>${lands.total}</strong> lands${gap}`;
  el.title = unmade.length
    ? `The deck asks for ${unmade.map(id => dbManaColor(id).label).join(' and ')} and nothing in it makes ${unmade.length === 1 ? 'that' : 'those'} — open the Lands tab for the check`
    : 'What the deck’s spells want against what its lands make — open the Lands tab for the check';
}

/* One colour's row of DB_MANA_COLORS — its label, its basic, its ink. Public:
 * the Lands tab names a short colour with it, and its optimizer buys the basic
 * off it. */
const dbManaColor = id => DB_MANA_COLORS.find(c => c.id === id);

// ── The calculator, filled ────────────────────────────────────────────────

/* Everything the Mana Base Calculator asks a person to type, as the open deck
 * answers it. Null when there is no deck, which is what leaves the calculator
 * working exactly as it always has for somebody building a mana base before
 * there is a deck to read — that tab is not a view of this one.
 *
 * The pips are rounded here and nowhere else. The calculator's fields are whole
 * numbers, its maths is a proportional split, and half a pip either way cannot
 * move a basic; the pass above keeps the halves because that is where the
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

/* Fill the calculator from this deck and go there — the Lands tab's one way
 * out. The drawer is shut on the way past because it is the deck tab's and we
 * are leaving that tab: setTab() closes the drawers it knows about, and this
 * one is not one of them — left open it would hold the body's scroll lock over
 * a calculator taller than the window. */
function dbOpenInCalculator() {
  if (typeof dbCloseSearchPanel === 'function') dbCloseSearchPanel();
  if (typeof setTab === 'function') setTab('lands');
  if (typeof landsUseDeck === 'function') landsUseDeck();
}
