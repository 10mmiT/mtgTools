// ── Deck Builder — Whether the deck is legal, and how strong it is ────────
// Two questions the app has never been able to answer about a deck it holds
// every card of. The first is table stakes and has one right answer: a deck of
// ninety-eight is not a Commander deck, and a card outside the commander's
// colour identity is not in the deck however much you want it to be. The second
// has no right answer at all, and most of the care here is about the difference.
//
// ── An estimate is not a verdict ──────────────────────────────────────────
//
// Wizards' five brackets are a *self-assessment*. They are defined mostly by
// the Game Changers list, which we can count exactly, and by four things we
// cannot — mass land denial, extra turns, tutoring and two-card infinite
// combos — of which this reads three out of oracle text and the fourth not at
// all. So the number this produces is offered with the whole of its reasoning
// beside it, including what it looked for and did not find, and it never
// touches the field the player declares. A tool that tells somebody their deck
// is a 4 without saying why has picked a fight it cannot finish.
//
// The declared bracket goes in `bracket` on the deck record — written,
// round-tripped and permission-checked since long before anything set it. The
// estimate is held nowhere: it is a fact about the cards, recomputed with the
// rest of the readout, and there is no moment at which it could overwrite a
// declaration because nothing here writes that field except dbDeclareBracket().
//
// ── What the deck is judged as ────────────────────────────────────────────
//
// The deck record carries no format, and this ticket does not add one. What it
// has is a commander, and that is the same inference the readout has always
// made to say whether a deck is 60 cards or 99 — so the inference moves here
// and the readout reads it, rather than the tab holding two answers to "what
// is this deck". A deck with no commander is judged as sixty cards of *some*
// constructed format, which is exactly what can be honestly checked without
// one: a size and a four-copy limit. Which ban list applies is not something
// the deck says, so no ban list is consulted and the panel says so.
//
// ── The five names, and who reads them ────────────────────────────────────
//
// DB_BRACKETS is the app's vocabulary rather than this tab's: Pick Night reads
// it to restrict tonight's pool, and the deck tiles in Players & Decks read it
// to name the chip they have been drawing since the field arrived. It lives
// here because everything else about brackets does.

/* Wizards' five, in order. A bracket is a number on the deck record and a name
 * everywhere a person reads it. */
const DB_BRACKETS = [
  { n: 1, label: 'Exhibition', hint: 'Ultra-casual — built around a theme rather than a win' },
  { n: 2, label: 'Core',       hint: 'A precon, or a deck of about that power' },
  { n: 3, label: 'Upgraded',   hint: 'Stronger than a precon, up to three Game Changers' },
  { n: 4, label: 'Optimized',  hint: 'The strongest build of the deck, short of cEDH' },
  { n: 5, label: 'cEDH',       hint: 'Playing to win against a metagame' },
];

const dbBracketName = n => DB_BRACKETS.find(b => b.n === n) || null;

/* The chip a declared bracket wears wherever a deck is drawn — the tiles in
 * Players & Decks, tonight's picks, the readout on this tab. One function
 * because it is one fact, and because "Bracket 3" does not say what a 3 is:
 * the name and what it means go on the tooltip.
 *
 * Any number draws a chip, not only the five. Archidekt's importer has been
 * filling this field from `powerLevel` since before brackets existed, and a
 * deck that came in as a 7 is a deck somebody rated 7 — dropping its chip
 * because the number is not one of ours would lose what it says. */
/* The number on a deck record, as a number or as nothing. Archidekt's importer
 * has been filling this field since before brackets existed and the state file
 * has been round-tripping whatever it put there, so what comes back is not
 * guaranteed to be the number it went in as. One reading of it, here, rather
 * than three places each deciding what counts. */
function dbBracketOf(deck) {
  const raw = deck?.bracket;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function dbBracketBadgeHtml(value) {
  const n = dbBracketOf({ bracket: value });
  if (n === null) return '';
  const b = dbBracketName(n);
  const said = b ? `${b.label} — ${b.hint}` : 'A power level from elsewhere, not one of Wizards’ five brackets';
  return `<span class="badge-bracket" title="${esc(said)}">Bracket ${n}</span>`;
}

/* ── The two formats this app can judge ───────────────────────────────────
 *
 * Not a list of Magic's formats. It is a list of the questions we can answer
 * about a deck from what the deck itself says it is, and there are two: a
 * Commander deck, which names a commander and is therefore judged by
 * Commander's rules all the way down; and everything else, which is sixty
 * cards and a four-copy limit and nothing more, because a deck with no
 * commander has not told us which ban list it wants to be held to.
 *
 * `legalities` is the key in Scryfall's own `legalities` object, or null for
 * "there is no ban list to consult". A null there is the difference between
 * "checked, and legal" and "not checked" — and saying which is the whole of
 * criterion ten. */
const DB_FORMATS = [
  {
    id: 'commander', label: 'Commander', legalities: 'commander',
    size: 100,        // the deck and its commanders together, exactly
    copies: 1,        // singleton
    identity: true,   // and inside the commanders' colours
    brackets: true,
  },
  {
    id: 'sixty', label: '60-card', legalities: null,
    min: 60,          // at least, rather than exactly
    copies: 4,
    identity: false,
    brackets: false,
  },
];

const dbFormatById = id => DB_FORMATS.find(f => f.id === id) || DB_FORMATS[1];

/** How many cards the deck is built around — nought, one or two of them. */
const dbCommanderCount = () =>
  dbCommanderCards().reduce((n, c) => n + (c.qty || 1), 0);

/* What this deck is. A commander on the mat says so; so does a commander named
 * on the record and not yet given a card, which is a Commander deck somebody
 * has started rather than a sixty-card pile. */
function dbDeckFormat() {
  const named = !!(dbDeck?.commander || '').trim();
  return dbFormatById(dbCommanderCount() > 0 || named ? 'commander' : 'sixty');
}

/* How big the deck is meant to be, which the readout prints as "98/99" and the
 * legality check holds it to. A hundred minus however many commanders it has
 * is what makes a pair of partners a deck of ninety-eight rather than one that
 * reads as one over; a deck whose record names a commander it has no card for
 * is still a Commander deck, at ninety-nine. */
function dbDeckTarget() {
  const format = dbDeckFormat();
  return format.size ? format.size - Math.max(dbCommanderCount(), 1) : format.min;
}

// ── Reading a card ────────────────────────────────────────────────────────

/* Every word of rules text a card has, front and back. The same join
 * cardMetaOf() makes, for the same reason: a transforming card's back face is
 * still a thing the card does. */
function _dbOracle(sf) {
  const faces = sf.card_faces || [];
  return [sf.oracle_text, ...faces.map(f => f.oracle_text)].filter(Boolean).join('\n');
}

/* A card's colour identity, which for a transforming card is the whole card's
 * and not the front face's — Scryfall puts one `color_identity` on the object
 * for exactly that reason. */
const _dbIdentityOf = sf => sf.color_identity || [];

const _dbTypeLineOf = sf =>
  (sf.type_line || sf.card_faces?.map(f => f.type_line).join(' ') || '').toLowerCase();

/* How many of this card the format lets a deck hold. Two exceptions, both of
 * them facts on the card rather than lists we would have to keep: a basic land
 * is unlimited by its own type line, and Relentless Rats and its cousins say so
 * in their rules text. Neither is a special case we invented — the cards are
 * written that way, and reading them is what keeps this from being a list that
 * goes stale the next time Wizards prints another one. */
const DB_ANY_NUMBER = /a deck can have any number of cards named/i;

function _dbCopyLimit(sf, format) {
  const type = _dbTypeLineOf(sf);
  if (type.includes('basic') && type.includes('land')) return Infinity;
  if (DB_ANY_NUMBER.test(_dbOracle(sf))) return Infinity;
  return format.copies;
}

/* ── What the bracket estimate looks for ──────────────────────────────────
 *
 * Three of Wizards' four soft inputs, read out of oracle text. They are
 * patterns rather than lists of card names for the same reason the copy limit
 * is: a list of every extra-turn spell ever printed is a list somebody has to
 * maintain, and the cards say it themselves.
 *
 * The fourth — two-card infinite combos — is not here and cannot be. Nothing
 * in a card's text says what it combines with, and guessing would be the one
 * kind of wrong this feature cannot afford. The panel says so out loud rather
 * than letting an absent check read as a passed one; proposal 9's combo
 * service is what answers it properly.
 *
 * The apostrophe is written both ways because Scryfall's oracle text uses the
 * typewriter one and a card name quoted elsewhere in the app may not. */
const DB_EXTRA_TURN  = /takes? an extra turn/i;
const DB_LAND_DENIAL = new RegExp([
  'destroy all (nonbasic )?lands',
  'each player sacrifices[^.]*lands?',
  'lands? (don[’\']t|do not) untap',
  'sacrifices? a land unless',
].join('|'), 'i');

/* A tutor is a search of your library that is not a search for a land. Ramp
 * looks identical to a tutor from a regex's seat — "search your library for a
 * basic land card" — and counting Cultivate as a tutor would put the reasoning
 * in the panel beyond anybody's patience. Each search clause is read on its
 * own, so a card that fetches a land *and* anything else still counts. */
function _dbIsTutor(oracle) {
  return [...oracle.matchAll(/search your library for ([^.;]*)/gi)]
    .some(m => !/\bland/i.test(m[1]));
}

// ── The pass ──────────────────────────────────────────────────────────────
/* One walk over the deck for both answers, kept until the deck changes — the
 * same shape and the same reasons as js/deckview-totals.js's, and dropped from
 * the same place: dbRenderStats(), where being called *is* what "the deck
 * changed" means. Nothing here is reached from dbRender(). */
let _dbCheck = null;

function dbCheckChanged() { _dbCheck = null; }

/** Whether the deck is legal and what bracket it looks like, worked out once. */
function dbDeckCheck() {
  return _dbCheck || (_dbCheck = _dbComputeCheck());
}

/* The colours the deck is allowed to hold, or null when nothing can say.
 *
 * The commanders on the mat are the answer. A deck whose record names one it
 * has not been given a card for is the case that returns null: we know it is a
 * Commander deck — that is what sets the format — and we do not know what
 * colours it may play, so identity goes unchecked rather than every card in the
 * deck being reported as outside a colourless commander's. */
function dbCommanderIdentity() {
  const cards = dbCommanderCards();
  if (!cards.length) {
    /* Named on the record and in hand anyway: the commander of an imported
     * deck is often a card the deck also holds, and its facts are already in
     * this tab's cache. */
    const sf = dbCardData.get((dbDeck?.commander || '').trim());
    return sf ? new Set(_dbIdentityOf(sf)) : null;
  }
  const ci = new Set();
  for (const card of cards) {
    const sf = dbCardData.get(card.card_name);
    if (!sf) return null;   // half an identity is a wrong answer, not a smaller one
    for (const c of _dbIdentityOf(sf)) ci.add(c);
  }
  return ci;
}

function _dbComputeCheck() {
  const format = dbDeckFormat();

  /* What the format judges. For Commander that is the deck and the cards it is
   * built around together — the hundred, the singleton rule and the colour
   * identity all span both — and for anything else it is the deck. A
   * maybeboard is in neither: it holds cards that are *not in the deck*, which
   * is the whole of what it is for. */
  const judged = format.id === 'commander'
    ? [...dbMainCards(), ...dbCommanderCards()]
    : dbMainCards();

  const identity = format.identity ? dbCommanderIdentity() : null;

  /* Copies by name rather than by row, because a card in the deck and the same
   * card on the commander board is two copies of it however it got there. */
  const copies = new Map();
  let cards = 0;
  for (const row of judged) {
    const qty = row.qty || 1;
    cards += qty;
    copies.set(row.card_name, (copies.get(row.card_name) || 0) + qty);
  }

  const unchecked = [];   // cards this app cannot answer for — see below
  const tooMany = [], outside = [], banned = [], notLegal = [];
  const gameChangers = [], extraTurns = [], landDenial = [], tutors = [];

  for (const [name, n] of copies) {
    const sf = dbCardData.get(name);

    /* A card whose facts have not arrived — a cache mid-refresh, a name the
     * batch lookup has not come back with — is *unknown*, and unknown is not
     * legal. It is counted in the size, because a card in the deck is in the
     * deck whatever we know about it, and it is judged for nothing else. */
    if (!sf) { unchecked.push(name); continue; }

    if (n > _dbCopyLimit(sf, format)) tooMany.push({ name, n });
    if (identity && !_dbIdentityOf(sf).every(c => identity.has(c))) outside.push(name);

    /* The ban list, when the format names one. A row still in the old trimmed
     * shape has `legalities: {}` filled in on the way out of the cache, so this
     * reads `undefined` — unknown — rather than throwing or, far worse,
     * reading as legal. */
    if (format.legalities) {
      const says = sf.legalities?.[format.legalities];
      if (says === undefined)       unchecked.push(name);
      else if (says === 'banned')   banned.push(name);
      else if (says === 'not_legal') notLegal.push(name);
    }

    if (sf.game_changer) gameChangers.push(name);
    const oracle = _dbOracle(sf);
    if (DB_EXTRA_TURN.test(oracle))  extraTurns.push(name);
    if (DB_LAND_DENIAL.test(oracle)) landDenial.push(name);
    if (_dbIsTutor(oracle))          tutors.push(name);
  }

  return {
    format,
    cards,
    legality: _dbLegality(format, cards, { unchecked, tooMany, outside, banned, notLegal, identity }),
    bracket: format.brackets
      ? _dbEstimate({ gameChangers, extraTurns, landDenial, tutors })
      : null,
  };
}

// ── Legal, or the reason it is not ────────────────────────────────────────
/* Each problem names the rule it breaks and the cards that break it, because
 * "illegal" on its own is a readout telling you to go and find out why. The
 * order is the order they are worth fixing in: how big the deck is, then how
 * many of a thing it holds, then which colours, then the two ban lists. */
function _dbLegality(format, cards, found) {
  const { unchecked, tooMany, outside, banned, notLegal, identity } = found;
  const problems = [];
  const say = (id, text, names = []) => problems.push({ id, text, cards: names });

  if (format.size) {
    /* The hundred, commanders included — and ninety-nine for a deck whose
       commander is named on the record and has no card on the mat yet, which
       is the same arithmetic the readout beside this prints. */
    const want = dbDeckTarget() + dbCommanderCount();
    if (cards !== want) {
      const off = Math.abs(cards - want);
      say('size', `${cards} cards — ${off} ${cards > want ? 'over' : 'short of'} the ` +
                  `${want} ${format.label} wants`);
    }
  } else if (cards < format.min) {
    say('size', `${cards} cards — ${format.min - cards} short of the ${format.min} a deck needs`);
  }

  for (const { name, n } of tooMany) {
    /* The card is named beside the sentence rather than inside it, which is
       what lets it be a link you can open. */
    say('copies', format.copies === 1
      ? `${n} copies — ${format.label} is singleton`
      : `${n} copies — ${format.copies} is the limit`, [name]);
  }

  if (outside.length) {
    const colours = [...(identity || [])].join('') || 'colourless';
    say('identity',
      `outside the commander’s colour identity (${colours})`, outside);
  }

  if (banned.length)   say('banned',   `banned in ${format.label}`, banned);
  if (notLegal.length) say('notlegal', `not legal in ${format.label} at all`, notLegal);

  /* Not a problem, and never counted as one. It is the reason a clean check
   * still may not say "legal": a card we have no facts about has been judged
   * for nothing, and a green tick over it would be this feature's worst
   * failure — a confident wrong answer. */
  return {
    problems,
    unchecked: [...new Set(unchecked)].sort((a, b) => a.localeCompare(b)),
    checked: !!format.legalities,
    legal: problems.length === 0,
  };
}

// ── The bracket, estimated ────────────────────────────────────────────────
/* A floor rather than a placement: what the deck holds can only push it up.
 * Four Game Changers make a deck Optimized whatever else is true of it; one
 * makes it at least Upgraded; a deck with none of the four signals is a 2 or a
 * 1, and nothing in a card list separates those two — the difference is how the
 * deck is played.
 *
 * Every signal produces a reason whether it was found or not, because "no mass
 * land denial" is as much a part of why the answer is 2 as three Game Changers
 * are of why it is 3. A list of only the hits reads as an accusation. */
function _dbEstimate({ gameChangers, extraTurns, landDenial, tutors }) {
  const reasons = [];
  let n = 2;
  const at = (least, text, cards = []) => { n = Math.max(n, least); reasons.push({ text, cards }); };

  if (gameChangers.length >= 4) {
    at(4, `${gameChangers.length} Game Changers — four or more is what Optimized means`, gameChangers);
  } else if (gameChangers.length) {
    at(3, `${gameChangers.length} Game Changer${gameChangers.length === 1 ? '' : 's'} — ` +
          `up to three is as far as Upgraded reaches`, gameChangers);
  } else {
    at(2, 'No cards from the Game Changers list');
  }

  if (extraTurns.length) at(3, `${extraTurns.length} card${extraTurns.length === 1 ? '' : 's'} that take an extra turn`, extraTurns);
  else                   at(2, 'Nothing that takes an extra turn');

  if (landDenial.length) at(3, `${landDenial.length} card${landDenial.length === 1 ? '' : 's'} that look like mass land denial`, landDenial);
  else                   at(2, 'No mass land denial');

  /* Counted and shown, and deliberately not weighed. Wizards' brackets talk
   * about tutors without giving a number anywhere, so a threshold here would be
   * ours invented and worn as theirs. It belongs in the conversation the panel
   * is trying to start, which is what showing it without scoring it does. */
  reasons.push({
    text: tutors.length
      ? `${tutors.length} tutor${tutors.length === 1 ? '' : 's'} — part of the conversation, but no bracket turns on a count of them`
      : 'No tutors',
    cards: tutors,
  });

  return {
    n,
    label: dbBracketName(n).label,
    reasons,
    /* What the estimate cannot see, said every time it is read. */
    limits: [
      'Two-card infinite combos are not looked for — nothing in a card’s text says what it combines with.',
      n === 2
        ? 'A 2 and a 1 look the same in a card list; which one this is depends on how it is played.'
        : 'Nothing here can reach 5 — cEDH is a declaration about how a deck is played, not a list of cards.',
    ],
  };
}

// ── The declared bracket ──────────────────────────────────────────────────
/* The deck record, live, rather than the copy dbDeck holds: the bracket is
 * stored on the record and read from it by the deck tiles and by Pick Night, so
 * a second copy of it in this tab would be a second thing to keep in step. */
function dbDeckRecord() {
  if (!dbDeck) return null;
  const player = (state.players || []).find(p => p.id === dbDeck.playerId);
  return player?.decks?.find(d => d.id === dbDeck.id) || null;
}

const dbDeclaredBracket = () => dbBracketOf(dbDeckRecord());

/** Whether the person looking at this deck is allowed to say what it is. */
const dbCanDeclare = () => !!dbDeck && isMyPlayer(dbDeck.playerId);

/* Declaring one. It writes the field that has existed all along and nothing
 * else — the estimate is not consulted, cannot be consulted, and has no way to
 * arrive here. Drawn before the save rather than after it: this is a person
 * answering a question about their own deck, and it should land like one. */
async function dbDeclareBracket(value) {
  if (!dbCanDeclare()) return;
  const deck = dbDeckRecord();
  if (!deck) return;
  /* Any number the control offered, which is the five and — for a deck that
     came in with a power level from somewhere else — the one it already had.
     Not "one of the five": re-declaring what is already on the record must not
     silently do nothing. */
  const n = String(value ?? '') === '' ? null : Number(value);
  if (n !== null && !Number.isFinite(n)) return;

  deck.bracket = n;
  dbRenderCheckStats();
  _dbSyncCheckPanel();
  /* The chip on the deck tile is the same fact seen from the other tab, and
   * Pick Night's pool is that fact used. Both read the record, so both need
   * only to be drawn again. */
  if (typeof renderPlayers === 'function') renderPlayers();
  await savePlayerDecks(dbDeck.playerId);
}

// ── The two items on the readout ──────────────────────────────────────────
/* Written by dbRenderStats() with the rest of the line. Both open the same
 * panel, because they are two halves of one question — is this deck legal, and
 * how strong is it — and two panels rising out of the same thin line would
 * cover each other. */
function dbRenderCheckStats() {
  _dbRenderLegalStat();
  _dbRenderBracketStat();
}

function _dbRenderLegalStat() {
  const el = document.getElementById('dbStatLegal');
  if (!el) return;
  const { format, legality } = dbDeckCheck();
  const bad     = legality.problems.length;
  const unknown = legality.unchecked.length;

  /* Green is "we checked, and it is fine". A deck with cards this app has no
     facts about has not been checked, so it says what it did and does not
     colour it: the point of the whole feature is that it never claims more
     than it knows. */
  const body = bad
    ? `<strong style="color:var(--danger)">${bad} problem${bad === 1 ? '' : 's'}</strong>`
    : unknown
      ? `<strong>${esc(format.label)} legal so far</strong>`
      : `<strong style="color:var(--success)">${esc(format.label)} legal</strong>`;
  const note = unknown
    ? ` <span class="db-check-unknown">(${unknown} unchecked)</span>` : '';

  el.innerHTML = body + note;
  el.title = bad
    ? `What this deck breaks in ${format.label} — open for which cards`
    : unknown
      ? `Nothing broken in what could be checked; ${unknown} card${unknown === 1 ? ' has' : 's have'} no facts yet`
      : `Checked against ${format.label} — open for what was checked`;
}

/* The declaration and the estimate, side by side and never the same shape: the
 * declared bracket is a number in the app's bracket badge, the estimate is
 * prefixed "est" and drawn in the muted colour every caption in the app uses.
 * A deck with no declaration says so rather than borrowing the estimate to fill
 * the gap, which is the one thing this line must never do. */
function _dbRenderBracketStat() {
  const el  = document.getElementById('dbStatBracket');
  const sep = document.getElementById('dbStatSepBracket');
  if (!el) return;
  const { bracket } = dbDeckCheck();

  /* Brackets are Commander's. A sixty-card deck is not un-bracketed, it is
     outside the system, so the item leaves the line rather than standing on it
     saying nothing. */
  const show = !!bracket;
  el.style.display  = show ? '' : 'none';
  if (sep) sep.style.display = show ? '' : 'none';
  if (!show) return;

  const declared = dbDeclaredBracket();
  const said = declared === null
    ? `<span class="db-check-undeclared">not declared</span>`
    : dbBracketBadgeHtml(declared);
  el.innerHTML = `${said} <span class="db-check-est">est ${bracket.n}</span>`;
  el.title = declared === null
    ? `Nobody has said what bracket this deck is — the estimate is ${bracket.n}, ${bracket.label}`
    : `Declared bracket ${declared} — this app’s estimate is ${bracket.n}, ${bracket.label}`;
}

// ── The panel, opened out of either of them ───────────────────────────────
let _dbCheckPanelOpen = false;

function dbToggleCheckPanel() {
  _dbCheckPanelOpen = !_dbCheckPanelOpen;
  /* Three panels rise out of the same line and would lie on top of each other,
     so opening this one puts the other two away. */
  if (_dbCheckPanelOpen) { dbCloseOwnedPanel(); dbCloseManaPanel(); }
  _dbSyncCheckPanel();
}

function dbCloseCheckPanel() {
  if (!_dbCheckPanelOpen) return;
  _dbCheckPanelOpen = false;
  _dbSyncCheckPanel();
}

function _dbSyncCheckPanel() {
  const panel = document.getElementById('dbCheckPanel');
  for (const id of ['dbStatLegal', 'dbStatBracket']) {
    document.getElementById(id)?.setAttribute('aria-expanded', _dbCheckPanelOpen ? 'true' : 'false');
  }
  if (!panel) return;
  panel.style.display = _dbCheckPanelOpen ? '' : 'none';
  if (_dbCheckPanelOpen) panel.innerHTML = _dbCheckPanelHtml();
}

function _dbCheckPanelHtml() {
  const { format, legality, bracket } = dbDeckCheck();
  return `
    <div class="db-check-hdr">
      <span class="db-check-title">Judged as ${esc(format.label)}</span>
      <button class="db-check-close" onclick="dbCloseCheckPanel()" title="Close">✕</button>
    </div>
    ${_dbLegalSectionHtml(format, legality)}
    ${bracket ? _dbBracketSectionHtml(bracket) : ''}`;
}

const _dbCardsHtml = names => names.map(n =>
  `<a class="card-link db-check-card" href="#" data-name="${esc(n)}">${esc(n)}</a>`).join('');

/* One line of the panel: what kind of thing it is, what it says, and the cards
 * it says it about. Four kinds — something broken, something checked and fine,
 * something found that the estimate weighed, and something nobody can answer —
 * marked by a glyph rather than by colour alone, which is the same rule the
 * ownership badges follow. */
const DB_CHECK_MARKS = { bad: '✕', ok: '✓', found: '•', unknown: '?' };

function _dbCheckRow(mark, text, names) {
  return `<div class="db-check-row">
    <span class="db-check-mark db-check-mark-${mark}">${DB_CHECK_MARKS[mark]}</span>
    <span class="db-check-said">${esc(text)}</span>
    <span class="db-check-cards">${_dbCardsHtml(names || [])}</span>
  </div>`;
}

function _dbLegalSectionHtml(format, legality) {
  const rows = legality.problems.map(p => _dbCheckRow('bad', p.text, p.cards));

  if (!rows.length) {
    rows.push(_dbCheckRow('ok', legality.unchecked.length
      ? `Nothing wrong with what could be checked`
      : `Legal in ${format.label}`));
  }
  if (legality.unchecked.length) {
    /* The cache mid-refresh, and the honest half of criterion ten. These cards
       have been counted towards the deck's size and judged for nothing else. */
    rows.push(_dbCheckRow('unknown',
      `no facts for ${legality.unchecked.length === 1 ? 'this card' : 'these cards'} yet — counted, not checked`,
      legality.unchecked));
  }
  if (!format.legalities) {
    rows.push(_dbCheckRow('unknown',
      'no ban list was consulted — a deck with no commander does not say which format it is for'));
  }

  return `<div class="db-check-group">
    <div class="db-check-group-hdr">Legality<span class="db-check-note">the rules, which have one answer</span></div>
    ${rows.join('')}
  </div>`;
}

function _dbBracketSectionHtml(bracket) {
  const reasons = bracket.reasons
    .map(r => _dbCheckRow(r.cards.length ? 'found' : 'ok', r.text, r.cards)).join('');
  const limits = bracket.limits
    .map(l => `<div class="db-check-limit">${esc(l)}</div>`).join('');

  return `<div class="db-check-group">
    <div class="db-check-group-hdr">Bracket<span class="db-check-note">an estimate, and here is why</span></div>
    <div class="db-check-verdict">
      ${_dbDeclareHtml()}
      <span class="db-check-estimate">This app’s estimate: <strong>${bracket.n}</strong> ${esc(bracket.label)}</span>
    </div>
    ${reasons}
    ${limits}
  </div>`;
}

/* Where the player says what their deck is. A select rather than five buttons
 * because it is answered once and then left alone — and it is the *declaration*
 * that is offered, never the estimate applied: there is no "use the estimate"
 * button here, and that is on purpose. Somebody else's deck reads what they
 * said and cannot change it. */
function _dbDeclareHtml() {
  const declared = dbDeclaredBracket();
  const named    = dbBracketName(declared);
  if (!dbCanDeclare()) {
    return `<span class="db-check-declared">${declared === null
      ? 'The owner has not declared a bracket'
      : `Declared: <strong>${declared}</strong> ${esc(named ? named.label : 'from elsewhere')}`}</span>`;
  }
  const options = [`<option value="">Not declared</option>`, ...DB_BRACKETS.map(b =>
    `<option value="${b.n}"${b.n === declared ? ' selected' : ''}>${b.n} — ${esc(b.label)}</option>`)];
  /* A number that is not one of the five — an Archidekt power level, imported
     long before brackets — is offered as what it is rather than being quietly
     shown as undeclared. Choosing anything else replaces it, which is the
     point of the control. */
  if (declared !== null && !named) {
    options.push(`<option value="${declared}" selected>${declared} — from elsewhere</option>`);
  }
  return `<label class="db-check-declare">Declared
    <select id="dbBracketSel" onchange="dbDeclareBracket(this.value)"
            title="What bracket you are telling the table this deck is">${options.join('')}</select>
  </label>`;
}
