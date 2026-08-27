// ── Deck Builder — What of this deck you already own ──────────────────────
// Every card on the mat has worn an ownership badge for a long time, and the
// deck has never had an answer: you could see that *this* card is in somebody's
// box and not that eighty-seven of your ninety-nine are in yours. This module
// is that answer — "87 of 99 owned", the twelve that are not, and who has them.
//
// ── What it scopes, and what it refuses to ────────────────────────────────
//
// It changes the *question* the readout and the badges answer — yours, the
// group's, or every collection loaded — and it never changes what is on the
// mat. Every card in the deck stays drawn at every scope, because a deck
// builder that hides cards which are in your deck is hiding your deck: the
// count, the curve and the shape of the piles would all stop describing the
// thing being built. The one exception is asked for by hand and is off until
// it is — the chip below.
//
// Narrowing to what you own belongs where you are *choosing* what to add, and
// that is the search drawer's scope select (js/deckview-panels.js), which
// queries the shelf rather than throwing away results that came back from
// Scryfall. A page of search results narrowed to the three you happen to own
// reads as broken, and "find me a card I own that does X" is a question about
// our shelves, not about Magic.
//
// Whose a collection is, is js/collections.js's — colOwner() and nothing else
// reads the field. Who *you* are is js/auth.js's myPlayerId(), which is the
// same identity the Collections tab's shelf control uses and works in open
// mode, where it is the browser-remembered name matched to a player.

/* ── The three questions ───────────────────────────────────────────────────
 *
 * A widening ladder rather than three unrelated shelves, because the number it
 * produces is read as one sentence getting looser: what I can sleeve tonight,
 * what the group can put on the table, and what exists among us at all. The
 * group's includes yours for that reason — a shared box belongs to everybody,
 * so it is not a *different* set of cards from yours, it is more of them.
 *
 * Mine is the default: "can I sleeve this tonight" is the question somebody
 * building a deck is actually asking. */
const DB_OWN_SCOPES = [
  { id: 'mine',  label: 'Mine',        hint: 'Only the collections you own' },
  { id: 'group', label: 'The group’s', hint: 'Yours, and the collections nobody owns' },
  { id: 'all',   label: 'Everyone’s',  hint: 'Every collection loaded' },
];

/* Remembered per person rather than per browser. Two people share a browser in
 * open mode — the identity there is a name typed into Available@'s "Who are
 * you?" bar — and "mine" means something different to each of them, so a scope
 * stored under one of them must not follow the other. */
const DB_OWN_SCOPE_KEY = 'mtgtools_db_own_scope';

function _dbOwnScopeKey() { return `${DB_OWN_SCOPE_KEY}:${myPlayerId() || ''}`; }

/* Which of the three is being asked, and the one place that decides it.
 *
 * "Mine" needs somebody to be. An app that cannot say who you are reads as the
 * group's whatever is stored — the control is not offered at all in that case,
 * and a stored preference from a browser that once knew must not quietly count
 * nobody's collections as yours. */
function dbOwnScope() {
  if (!myPlayerId()) return 'group';
  try {
    const stored = localStorage.getItem(_dbOwnScopeKey());
    return DB_OWN_SCOPES.some(s => s.id === stored) ? stored : 'mine';
  } catch { return 'mine'; }
}

function dbSetOwnScope(scope) {
  if (!DB_OWN_SCOPES.some(s => s.id === scope)) return;
  try { localStorage.setItem(_dbOwnScopeKey(), scope); } catch {}
  dbOwnershipChanged();
}

/* The collections a scope counts, defaulting to the one the strip is set to.
 * The parameter is there for the search drawer, which asks the same question of
 * a different scope than the readout is on — so there is one rule about whose
 * shelf is whose and not two that can drift apart.
 *
 * Loaded ones only, which is the
 * rule sfCardOwnership() has always followed: half a collection is not a
 * smaller shelf, it is a wrong answer, and a badge that appears card by card
 * while pages come in is worse than one that appears once.
 *
 * With nobody to be, every shelf is the group's — which is both what an app
 * with no identity can honestly say and what makes the readout read as the
 * group's rather than break. */
function dbOwnShelf(scope = dbOwnScope()) {
  const loaded = (state.collections || []).filter(c => c.status === 'loaded');
  const me = myPlayerId();
  if (!me) return loaded;
  switch (scope) {
    case 'mine':  return loaded.filter(c => c.owner === me);
    /* colOwner() and not `!c.owner`: an id naming a player who has been removed
       is the group's, which is what the database makes of it the moment that
       removal is saved. */
    case 'group': return loaded.filter(c => c.owner === me || !colOwner(c));
    default:      return loaded;
  }
}

/** How many copies of a card the shelf in scope holds. Nought is an answer. */
function dbOwnedQty(cardName) {
  let qty = 0;
  for (const col of dbOwnShelf()) qty += col.cards.get(cardName)?.qty || 0;
  return qty;
}

// ── Which printing, not just which card ───────────────────────────────────
/* The sharper question, and the reason the shelf learned to record printings
 * at all. A deck that reads as fully owned may still be a deck nobody can
 * sleeve, because the box holds a different edition of half of it — so the
 * mat answers four things rather than two:
 *
 *   owned    the shelf has the printing this deck runs
 *   other    the shelf has the card, in a printing this deck does not run
 *   unknown  the shelf has the card and nobody recorded which printing
 *   none     the shelf has no copy at all
 *
 * The third is the one that must not be got wrong, and it is not an edge
 * case: every collection in existence is in it until somebody re-imports it.
 * Read as `none` it would tell a whole playgroup their shelves are empty;
 * read as `other` it would tell them to go and buy cards they already own.
 * So it is a state of its own and it outranks a mismatch — a copy nobody
 * wrote down might well be the one the deck runs, and the honest answer to
 * "is it" is that we do not know.
 *
 * dbOwnedQty() above is untouched by any of this. The name-level count is
 * what "87 of 99" has always meant and what the want list, the Sets tab and
 * the search scope all still ask; the printing is a second question asked
 * beside it, never a correction to it. */

/** Which printings of a card the shelf in scope holds, and how many of each.
 *
 *  Folded across the shelves, because "do I own it" is asked of the shelf and
 *  not of one box on it, and across language and condition, because
 *  printingIdentity() says those do not make it a different card. The unknown
 *  entry comes back in the list like any other: it is an answer, and dropping
 *  it here is how every reader downstream would come to forget it. */
function dbOwnedPrintings(cardName) {
  const merged = new Map();
  for (const col of dbOwnShelf()) {
    const card = col.cards.get(cardName);
    if (!card) continue;
    for (const held of cardPrintings(card)) {
      const seen = merged.get(printingIdentity(held));
      if (seen) { seen.qty += held.qty; continue; }
      /* The two fields the rollup just threw away are dropped from the row as
         well rather than left showing whichever copy happened to be first: a
         breakdown saying `de` over copies in three languages is worse than
         one that says nothing. */
      const { lang, condition, ...rest } = held;
      merged.set(printingIdentity(held), { ...rest });
    }
  }
  return [...merged.values()];
}

/** Whether the shelf in scope holds a particular printing of a card.
 *
 *  Never true of a printing nobody can name, which is both halves of the
 *  unknown case: a deck that has chosen nothing does not own "the printing it
 *  runs", and a shelf full of unattributed copies does not answer for one.
 *
 *  The plain yes-or-no, for anybody asking about a printing that is not a
 *  card in a deck — the gallery ringing what you own, and the printing
 *  optimiser's "prefer the ones I have". Inside this module the question is
 *  always four-valued and dbPrintingVerdict is what answers it: a yes/no here
 *  would fold "we do not know" into "no", which is the one thing this ticket
 *  exists to stop. */
function dbOwnsPrinting(cardName, printing) {
  return printingIdentity(printing) !== null
      && dbPrintingVerdict(dbOwnedPrintings(cardName), printing) === 'owned';
}

/** Which of the four a set of held copies makes of the printing a deck runs.
 *
 *  The order is the whole rule. A copy that matches is the answer whatever
 *  else is in the box; an unattributed copy beats a mismatch; and a mismatch
 *  is only reported where every copy on the shelf has been accounted for and
 *  none of them is the one. */
function dbPrintingVerdict(held, wanted) {
  if (!held.length) return 'none';
  const want = printingIdentity(wanted);
  /* No printing to ask about — the card data has not arrived, or there is
     none. Not an answer of "the wrong one" and not one of "we do not know
     which you own": we know perfectly well which printings are on the shelf
     and simply have nothing to hold them against, so the question falls back
     to the name-level one it was before any of this existed. */
  if (want === null) return 'owned';
  let unknown = false;
  for (const p of held) {
    if (printingIdentity(p) === want) return 'owned';
    if (p.id === null) unknown = true;
  }
  return unknown ? 'unknown' : 'other';
}

/** The printing this card of the deck runs.
 *
 *  A deck names one only where somebody has chosen it, and a deck where
 *  nobody has is not a deck running no printing — it is a deck running the
 *  one Scryfall hands back, which is the printing the mat has been drawing
 *  all along (see _dbCardImg). Treating the two differently would put the
 *  whole question out of reach of every deck nobody has hand-picked art in,
 *  which is nearly all of them.
 *
 *  Null only where the app has no card data for the name at all — a card
 *  whose data has not arrived yet, or one live Scryfall has never heard of.
 *  There is genuinely no printing to ask about there, and guessing at one
 *  would mark a card over data that is merely late. */
function dbCardPrinting(card) {
  if (card.printing?.id) return card.printing;
  const sf = dbCardData.get(card.card_name);
  /* No finish, deliberately: the default is the ordinary card. A foil is
     something somebody chooses, never something a deck falls into. */
  return sf?.id
    ? { id: sf.id, set: sf.set, set_name: sf.set_name, collector_number: sf.collector_number }
    : null;
}

/** Which of the four one card of the deck is, against the shelf in scope. */
function dbPrintingState(card) {
  return dbPrintingVerdict(dbOwnedPrintings(card.card_name), dbCardPrinting(card));
}

/** What to call the printings in a breakdown, for somebody reading. The
 *  unattributed copies drop out: they are not a printing anybody can name,
 *  and "C21, unknown" in a list of editions reads as an edition. */
const dbPrintingLabels = printings =>
  printings.filter(p => p.id !== null).map(colPrintingLabel);

/** And the deck's, as a count of cards in each of the four.
 *
 *  Cards and not copies, unlike every other number on the readout, because a
 *  printing is chosen once per card and not once per copy: eight Forests are
 *  eight of the same Forest, and a deck "8 in another printing" over one line
 *  of the list would be counting the same wrong decision eight times. */
function dbPrintingCounts() {
  const counts = { owned: 0, other: 0, unknown: 0, none: 0 };
  for (const card of dbMainCards()) counts[dbPrintingState(card)]++;
  return counts;
}

/** The cards you own but not as the deck names them: what it runs, and what
 *  you have instead. The actionable half — each of these is a decision
 *  between changing the deck's printing and buying the one it names.
 *
 *  The shelf is walked once per card rather than once for the verdict and
 *  again for the labels: this runs on every draw of the panel, and the shelf
 *  it walks is every collection loaded. */
function dbOtherPrintings() {
  const rows = [];
  for (const card of dbMainCards()) {
    const held = dbOwnedPrintings(card.card_name);
    const runs = dbCardPrinting(card);
    if (dbPrintingVerdict(held, runs) !== 'other') continue;
    rows.push({
      name:   card.card_name,
      runs:   colPrintingLabel(runs),
      /* Whether anybody actually asked for that printing, because the two are
         different problems: a printing somebody chose is one they may want to
         change their mind about, and a printing the deck merely fell into is
         one nobody has thought about yet. */
      chosen: !!card.printing?.id,
      held:   dbPrintingLabels(held),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/* Who *else* has it — every loaded collection that is not on the shelf being
 * counted, grouped by the person it belongs to. This is the half that answers
 * "who could lend me the rest", and it is why the missing list is worth opening
 * rather than being a number on a line.
 *
 * A collection nobody owns is the group's and is named as such: it is a real
 * answer, not a row somebody forgot to fill in. A card in no collection at all
 * comes back as an empty list, which is what "nobody has this" is. */
function dbHoldersOf(cardName) {
  const counted = new Set(dbOwnShelf().map(c => c.key));
  const holders = [];
  for (const col of (state.collections || [])) {
    if (col.status !== 'loaded' || counted.has(col.key)) continue;
    const qty = col.cards.get(cardName)?.qty || 0;
    if (!qty) continue;
    const player = colOwner(col);
    holders.push({
      who:        player ? player.name : 'The group',
      ink:        player ? playerColor(player) : 'var(--text-muted)',
      collection: col.name,
      qty,
    });
  }
  return holders;
}

/* ── The number, and the twelve behind it ──────────────────────────────────
 *
 * The mainboard, and only the mainboard. The commander is on its own board and
 * a maybeboard holds cards that are *not in the deck* — counting either would
 * make "87 of 99" describe something nobody is building, which is the same
 * argument every other number on the readout is made of (see dbRenderStats).
 *
 * Copies, not rows: a deck asking for four Forests with two on the shelf is
 * two short, and a readout that called that "owned" would be lying about the
 * only thing it is for. */
function dbDeckOwnership() {
  let total = 0, owned = 0;
  const short = [];
  for (const card of dbMainCards()) {
    const need = card.qty || 1;
    const have = Math.min(need, dbOwnedQty(card.card_name));
    total += need;
    owned += have;
    if (have < need) {
      short.push({ name: card.card_name, need, have, holders: dbHoldersOf(card.card_name) });
    }
  }
  short.sort((a, b) => a.name.localeCompare(b.name));
  return { total, owned, short };
}

/* Whether the deck is short of a card, which is the question all three chips
 * and the missing list are cut from — asked of the row rather than the name, so
 * that four Forests with two on the shelf is short by the same reckoning the
 * readout counts by. */
const dbShortOf = card => Math.max(0, (card.qty || 1) - dbOwnedQty(card.card_name));

// ── The chip on the mat ───────────────────────────────────────────────────
/* Off by default, and not remembered. Filtering the mat by ownership is for
 * the cases that want it — "show me what I still have to buy" — and it is a
 * thing you do for a minute, not a state a deck should come back in. The deck's
 * own filter box is not remembered either, for the same reason.
 *
 * One at a time: the three are the three answers to one question, so a pair of
 * them switched on together would be a filter that matches nothing. */
const DB_OWN_CHIPS = [
  { id: 'missing',   label: 'Missing',   hint: 'Only the cards the deck is short of' },
  { id: 'owned',     label: 'Owned',     hint: 'Only the cards you have every copy of' },
  { id: 'elsewhere', label: 'Borrowable', hint: 'Only the cards you are short of that somebody else has' },
];
let dbOwnChip = null;

function dbToggleOwnChip(chip) {
  dbOwnChip = dbOwnChip === chip ? null : chip;
  _dbRenderOwnChips();
  dbRender();
}

function _dbRenderOwnChips() {
  const mount = document.getElementById('dbOwnChips');
  if (!mount) return;
  mount.innerHTML = DB_OWN_CHIPS.map(c => {
    const on = dbOwnChip === c.id;
    return `<button class="btn-secondary db-own-chip${on ? ' db-own-chip-on' : ''}"
      onclick="dbToggleOwnChip('${jsAttr(c.id)}')" aria-pressed="${on ? 'true' : 'false'}"
      title="${esc(c.hint)}">${esc(c.label)}</button>`;
  }).join('');
}

/** Whether the chip lets this card onto the mat. No chip is every card. */
function dbOwnChipShows(card) {
  if (!dbOwnChip) return true;
  const short = dbShortOf(card);
  switch (dbOwnChip) {
    case 'owned':     return short === 0;
    case 'missing':   return short > 0;
    case 'elsewhere': return short > 0 && dbHoldersOf(card.card_name).length > 0;
  }
  return true;
}

// ── The badges on a card ──────────────────────────────────────────────────
/* What the mat draws where sfCardOwnership() used to be drawn. Two
 * differences from it, and both are ownership tickets:
 *
 * It is scoped. A badge saying a card is owned when the question on the strip
 * is "do *I* own it" is the badge answering a question nobody asked.
 *
 * And when the shelf in scope has none of it, whoever does is named instead —
 * in their own colour, marked as somebody else's. That is the same sentence
 * the missing list makes, said on the card, and it is what makes the
 * Borrowable chip legible: a dimmed name is a card you would have to ask for.
 *
 * The printing is not a third difference, because it is not a fact about a
 * badge. A badge is one box; the question is one shelf. Marking each box with
 * its own verdict would put a ⇄ on the box holding the Ravnica Sol Ring while
 * the box beside it holds the one the deck runs — a warning on a card with
 * nothing wrong with it, contradicting the readout, which folds the shelf
 * together and would rightly say nothing at all. So the mark is one mark, it
 * comes after the badges, and it answers exactly what the readout answers. */
const DB_PRINT_MARKS = {
  /* ⇄ for a swap that would have to happen, ? for a question nobody has
     answered. Marks beside the badges rather than colours over them: the
     badge's colour is whose box it is and has been for a long time. */
  other:   { cls: 'db-print-mark-other',   glyph: '⇄' },
  unknown: { cls: 'db-print-mark-unknown', glyph: '?' },
};

/* "runs" where somebody chose it and "defaults to" where nobody did. The
   distinction is the reader's to act on: a printing this deck fell into is
   one to point at your own copy, and a printing somebody picked is one to
   think again about. */
function _dbPrintMarkTitle(state, card, held) {
  const runs = colPrintingLabel(dbCardPrinting(card));
  const says = card.printing?.id ? 'this deck runs' : 'this deck defaults to';
  return state === 'unknown'
    ? `Nobody recorded which printings these copies are — ${says} ${runs}`
    : `You have ${dbPrintingLabels(held).join(', ')} — not the ${runs} ${says}`;
}

/** Whether the shelf has the printing this card runs, said in one glyph.
 *  Nothing at all where it has, which is what the three states that are not a
 *  problem have always looked like. */
function _dbPrintMarkHtml(card) {
  const held  = dbOwnedPrintings(card.card_name);
  const state = dbPrintingVerdict(held, dbCardPrinting(card));
  const mark  = DB_PRINT_MARKS[state];
  if (!mark) return '';
  return `<span class="db-print-mark ${mark.cls}"
    title="${esc(_dbPrintMarkTitle(state, card, held))}">${mark.glyph}</span>`;
}

/* Takes the deck's card rather than its name, because the printing the deck
 * runs is half the question now and it lives on the row. */
function dbCardOwnership(card) {
  const mine = dbOwnShelf()
    .filter(c => c.cards.has(card.card_name))
    .map(c => `<span class="sf-badge" style="border-color:${c.color}">
        <span class="sf-dot" style="background:${c.color}"></span>
        ${esc(c.name)} ×${c.cards.get(card.card_name).qty}
      </span>`).join('');
  if (mine) return mine + _dbPrintMarkHtml(card);

  /* Somebody else's box carries no mark. What is on offer there is a phone
     call, and which printing they have is a thing to settle with the person
     once they have said yes — a ⇄ on a card you do not have is detail about a
     card you cannot use. */
  return dbHoldersOf(card.card_name).map(h =>
    `<span class="sf-badge db-badge-elsewhere" style="border-color:${h.ink}"
       title="${esc(`${h.who} — ${h.collection} ×${h.qty}`)}">
      <span class="sf-dot" style="background:${h.ink}"></span>
      ${esc(h.who)} ×${h.qty}
    </span>`).join('');
}

// ── The line on the readout ───────────────────────────────────────────────
/* "87 of 99 owned", and it is a button: the twelve are the point, and a number
 * you cannot open is a number you have to go and count somewhere else.
 *
 * The word after the number changes with the scope, because "owned" alone
 * cannot say whose — and in a deployment that has no way to say who you are it
 * is the only honest word there is, which is the case the label reads as the
 * group's rather than breaking. */
function dbRenderOwnStat() {
  const el = document.getElementById('dbStatOwned');
  if (!el) return;
  const { total, owned } = dbDeckOwnership();
  const scope = DB_OWN_SCOPES.find(s => s.id === dbOwnScope()) || DB_OWN_SCOPES[0];
  const whose = !myPlayerId() ? 'the group owns'
              : dbOwnScope() === 'mine' ? 'you own'
              : dbOwnScope() === 'group' ? 'the group owns'
              : 'we own';
  /* The second sentence, and only when there is one to say. Cards owned in a
     printing this deck does not run are not missing — the count beside them
     is right and stays right — but they are what stands between the deck and
     being sleeved as it is written, which is the question the whole line is
     asked for. A deck with none of them says nothing about printings, which
     is every deck whose shelves have not been re-imported yet: unknown is not
     news, and a permanent note about it would be the app nagging.
     Cards and not copies, which is why it says so: the number in front of it
     counts copies, and two units in one line that did not name themselves
     would be read as one. */
  const other = dbPrintingCounts().other;
  /* The green is the count's and stays the count's. It has meant "you own
     every copy of this" since long before printings existed, the count has
     not moved by a copy, and a second question answered beside it is not a
     reason to take the first question's answer away. */
  const all = total > 0 && owned === total;
  el.innerHTML = `<strong style="color:${all ? 'var(--success)' : ''}">${owned}</strong> of ${total} ${esc(whose)}`
    + (other ? ` <span class="db-stat-otherprint">${other} card${other === 1 ? '' : 's'} in another printing</span>` : '');
  el.title = `${esc(scope.hint)} — open for what is missing`
    + (other ? `, and the ${other} you have in another printing` : '');
}

// ── What is missing, and who has it ───────────────────────────────────────
let _dbOwnedPanelOpen = false;

function dbToggleOwnedPanel() {
  _dbOwnedPanelOpen = !_dbOwnedPanelOpen;
  /* The other two panels rise out of the same line and would lie under this
     one, so opening any of the three puts the other two away. */
  if (_dbOwnedPanelOpen) { dbCloseCheckPanel(); dbCloseManaPanel(); }
  _dbSyncOwnedPanel();
}

function dbCloseOwnedPanel() {
  if (!_dbOwnedPanelOpen) return;
  _dbOwnedPanelOpen = false;
  _dbSyncOwnedPanel();
}

function _dbSyncOwnedPanel() {
  const panel = document.getElementById('dbOwnedPanel');
  const btn   = document.getElementById('dbStatOwned');
  btn?.setAttribute('aria-expanded', _dbOwnedPanelOpen ? 'true' : 'false');
  if (!panel) return;
  panel.style.display = _dbOwnedPanelOpen ? '' : 'none';
  if (_dbOwnedPanelOpen) panel.innerHTML = _dbOwnedPanelHtml();
}

/* Two lists, because they are two different problems. A card somebody else has
 * is an evening's borrowing; a card nobody has is a purchase, and it is the one
 * that belongs on a want list. The holders are named and drawn in their own
 * player colour — the same colours the rest of the app draws people in — so
 * "who could lend me this" is answered by looking rather than by reading. */
function _dbOwnedPanelHtml() {
  const { total, owned, short } = dbDeckOwnership();
  /* A third list, and a third problem. These are cards you have — the count
     above counts them — in an edition the deck does not name, so neither of
     the other two sections is true of them and neither is a want list: you
     already own the card. What is on offer is a choice. */
  const others = dbOtherPrintings();
  /* Said in two places — on its own where there is nothing else to report,
     and as the header over the printings where there is — so it is written
     once. Two copies of one sentence is two sentences the day somebody
     edits one of them. */
  const allHere = `Every one of the ${total} is on the shelf`;
  if (!short.length && !others.length) {
    return `<div class="db-owned-hdr">
        <span class="db-owned-title">${allHere}</span>
        ${_dbOwnedCloseHtml()}
      </div>`;
  }

  const borrowable = short.filter(s => s.holders.length);
  const nobodys    = short.filter(s => !s.holders.length);
  const missing    = short.reduce((n, s) => n + (s.need - s.have), 0);

  const section = (title, rows, note) => rows.length ? `
    <div class="db-owned-group">
      <div class="db-owned-group-hdr">${esc(title)}<span class="db-owned-note">${esc(note)}</span></div>
      ${rows.join('')}
    </div>` : '';

  return `
    <div class="db-owned-hdr">
      <span class="db-owned-title">${short.length
        ? `${missing} of ${total} missing — ${owned} on the shelf`
        : allHere}</span>
      ${_dbWantAllHtml()}
      ${_dbOwnedCloseHtml()}
    </div>
    ${section('Somebody else has these', borrowable.map(_dbOwnedRowHtml),
              'ask, or buy your own')}
    ${section('Nobody has these', nobodys.map(_dbOwnedRowHtml),
              'not in any collection loaded')}
    ${section('You have these in another printing', others.map(_dbOtherPrintingRowHtml),
              'change the deck’s printing, or buy the one it names')}`;
}

/* No want button on these rows. The card is on the shelf — what is wanted is
   a particular printing of it, and wanting a printing is a different feature
   from wanting a card. Until somebody asks for it, the row says what the deck
   runs and what the shelf has, and the decision is the reader's. */
function _dbOtherPrintingRowHtml(entry) {
  return `<div class="db-owned-row">
    <a class="card-link db-owned-name" href="#" data-name="${esc(entry.name)}">${esc(entry.name)}</a>
    <span class="db-owned-print">${entry.chosen ? 'runs' : 'defaults to'}
      <strong>${esc(entry.runs)}</strong>
      — you have <strong>${esc(entry.held.join(', '))}</strong></span>
  </div>`;
}

function _dbOwnedCloseHtml() {
  return `<button class="db-owned-close" onclick="dbCloseOwnedPanel()" title="Close">✕</button>`;
}

function _dbOwnedRowHtml(entry) {
  const shortBy = entry.need - entry.have;
  const holders = entry.holders.map(h =>
    `<span class="sf-badge db-owned-holder" style="border-color:${h.ink}"
       title="${esc(`${h.collection} ×${h.qty}`)}">
      <span class="sf-dot" style="background:${h.ink}"></span>${esc(h.who)}
    </span>`).join('');
  return `<div class="db-owned-row">
    <a class="card-link db-owned-name" href="#" data-name="${esc(entry.name)}">${esc(entry.name)}</a>
    ${shortBy > 1 ? `<span class="db-owned-qty">×${shortBy}</span>` : ''}
    <span class="db-owned-holders">${holders}</span>
    ${_dbWantOneHtml(entry.name)}
  </div>`;
}

// ── Sending them to your want list ────────────────────────────────────────
/* One action for the lot, which is what the ticket asks for, and one per row
 * for the times you only want the three you have decided to buy.
 *
 * Both go through myPlayerId() rather than currentUser.playerId — the identity
 * the whole of this module is scoped by — so the button is there in open mode,
 * where the app knows who you are from a remembered name and not from an
 * account. With no identity at all there is no want list to add to and no
 * button is drawn: there is nobody to want the card. */
function _dbWantOneHtml(cardName) {
  const player = _dbWantListOwner();
  if (!player) return '';
  const already = (player.wantList || []).includes(cardName);
  return `<button class="want-quick-btn db-owned-want${already ? ' want-quick-added' : ''}"
    onclick="dbWantCards(['${jsAttr(cardName)}'], this)"
    title="${already ? 'Already on your want list' : 'Add to my wants'}"
    ${already ? 'disabled' : ''}>${already ? '✓' : '+'}</button>`;
}

/* The one action the ticket asks for. It takes no list: the button recomputes
 * what is still missing and still unwanted when it is pressed, so a card added
 * from a row a moment ago is not sent a second time, and no card name has to
 * survive a trip through an inline attribute to get here. */
function _dbWantAllHtml() {
  const names = dbMissingUnwanted();
  if (!names.length) return '';
  return `<button class="btn-secondary db-owned-want-all" onclick="dbWantAllMissing(this)">
    + Want all ${names.length}</button>`;
}

function _dbWantListOwner() {
  const me = myPlayerId();
  return me ? (state.players || []).find(p => p.id === me) || null : null;
}

/** Every card the deck is short of that is not already on your want list. */
function dbMissingUnwanted() {
  const player = _dbWantListOwner();
  if (!player) return [];
  const wanted = new Set(player.wantList || []);
  return dbDeckOwnership().short.map(s => s.name).filter(n => !wanted.has(n));
}

function dbWantAllMissing(btn) { return dbWantCards(dbMissingUnwanted(), btn); }

/* One at a time and awaited, because the want-list route is a read-modify-write
 * of the whole state file: firing twelve of them at once is twelve reads of the
 * same state and eleven lost cards. Twelve round trips is also why the button
 * says it is working. */
async function dbWantCards(names, btn) {
  const player = _dbWantListOwner();
  if (!player || !names.length) return;
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  const added = [];
  try {
    for (const name of names) {
      if ((player.wantList || []).includes(name)) continue;
      const res = await fetch(`/api/players/${encodeURIComponent(player.id)}/wants`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardName: name }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const json = await res.json().catch(() => ({}));
      if (typeof json.version === 'number') state.version = json.version;
      if (!player.wantList) player.wantList = [];
      player.wantList.push(name);
      added.push(name);
    }
    /* One card gets the app's usual toast. Twelve do not need one: every row
     * they came from has just been redrawn with a ✓ on it, which is the same
     * confirmation and is where the eye already is. */
    if (added.length === 1) _showWantToast(added[0]);
  } catch (e) {
    alert(`Could not add to wants: ${e.message}`);
  }
  /* Redrawn rather than the button being ticked in place: a want that landed
   * turns that row's + into a ✓, and the "Want all" count above it has just
   * changed by however many went. */
  _dbSyncOwnedPanel();
}

// ── Keeping the tab in step ───────────────────────────────────────────────
/* The scope control, mounted once in the markup and synced here. Hidden — not
 * disabled — where the app cannot say who you are, exactly as the Collections
 * tab's shelf control is: no distinction is offered at all, and everything
 * reads as the group's. The whole mount goes so the strip keeps no gap for it. */
function dbSyncOwnScope() {
  const host = document.getElementById('dbOwnScopeMount');
  if (host) host.classList.toggle('scope-mount-hidden', !myPlayerId());
  const sel = document.getElementById('dbOwnScopeSel');
  if (sel) sel.value = dbOwnScope();
}

/* What has to be redrawn when the answer changes. The mat is in it because the
 * badges on the cards answer the same question the readout does; dbRender() and
 * dbRenderStats() both no-op without a deck. */
function dbOwnershipChanged() {
  dbSyncOwnScope();
  _dbRenderOwnChips();
  if (!dbDeck) return;
  dbRenderStats();
  dbRender();
  if (_dbOwnedPanelOpen) _dbSyncOwnedPanel();
}

/* The same, for the caller that is not a person: js/collections.js redraws its
 * chips once per page of a hundred cards, so a shelf arriving is fifty of these
 * and each of them would otherwise repaint the whole mat. Coalesced rather than
 * ignored, because the last one carries the number that is finally true. */
let _dbShelfRedraw = null;
function dbShelvesChanged() {
  clearTimeout(_dbShelfRedraw);
  _dbShelfRedraw = setTimeout(() => { _dbShelfRedraw = null; dbOwnershipChanged(); }, 60);
}
