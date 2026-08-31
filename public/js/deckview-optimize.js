// ── Deck Builder — Optimizing a deck's printings ──────────────────────────
// A deck can already say which printing of a card it runs, and the readout
// costs the deck from those printings. But choosing one is a per-card act —
// open the card, scroll to its printings, press the tile — and a ninety-nine
// card deck is ninety-nine of those, so in practice nobody does it. The deck
// runs whatever printing Scryfall hands back for each name, and the total on
// the readout is an accident rather than a decision.
//
// This is the one action that walks the whole deck: three modes, a proposal
// you read before anything is written, and a single History entry so a run
// that went the wrong way is one press to undo.
//
// ── Where the decision lives ──────────────────────────────────────────────
//
// dbOptimizePlan() below is the whole of it, and it is a pure function: the
// deck's cards, the local card data, the printings fetched per card, the shelf
// in scope, the mode and the day go in; the picks, a count of untouched cards
// by reason and a count of prefer-owned fallbacks come out. It fetches nothing
// and reads no globals. Everything else in this file is a thin caller around
// it — a fetch, a modal, an apply — which is what makes the feature testable
// at one seam rather than through a browser.
//
// ── The pool, and what it governs ─────────────────────────────────────────
//
// Cheapest and dearest propose a purchase, so they are bounded to printings it
// is sane to go and buy: paper, priced, not Reserved List, not oversized, not
// serialized, released on or after 8th Edition. Prefer-owned proposes none —
// the card is already in the box — so it reaches outside that bound and takes
// what you have, Reserved List, serialized, unpriced and all.
//
// The rule is: the pool decides what the app will send you to buy, not what it
// will let you keep.
//
// Every (printing, finish) pair is a candidate of its own, because a foil is a
// finish on the same Scryfall id and is priced separately — so a foil that is
// genuinely cheaper can win, and one that is dearer cannot sneak in.

/* 8th Edition, the first set in the modern card frame. Cards from before it
   are collectors' items to be hunted rather than stock to be ordered, and a
   "cheapest" that could be won by a Revised Sol Ring at half a euro is a
   shopping list nobody can shop from. */
const DB_OPT_FROM = '2003-07-28';

/* The three modes, in the order they are offered. Each carries the sentence
   the modal says under it, because "most expensive" needs explaining before it
   is pressed rather than after it lands on a four-figure Sol Ring. */
const DB_OPT_MODES = [
  { id: 'cheapest', label: 'Cheapest',
    hint: 'The least expensive printing of every card, in whichever finish is cheaper.' },
  { id: 'dearest',  label: 'Most expensive',
    hint: 'The dearest printing of every card — what the deck is worth rather than what it costs.' },
  { id: 'owned',    label: 'Prefer printings I own',
    hint: 'The copies already on the shelf, falling back to the cheapest where you own none.' },
];

const dbOptMode = id => DB_OPT_MODES.find(m => m.id === id) || DB_OPT_MODES[0];

/* What the bound is, in words, said on screen. A four-figure result reads as a
   bug unless the question it is the honest answer to is written beside it. */
const DB_OPT_POOL_SAID =
  'Cheapest and most expensive consider paper printings from 8th Edition (2003) '
  + 'onwards that somebody is quoting a price for, and leave out the Reserved '
  + 'List, oversized cards and serialized ones. Printings you already own are '
  + 'not bound by any of that.';

// ── Reading a printing ────────────────────────────────────────────────────

/* A basic land, off the type line — js/deckview-legality.js's rule for the
 * copy limit and js/deckview-mana.js's for the split, said a third time here
 * because this module must answer it before any request goes out and cannot
 * reach either of them without the tab. The printing of a basic is chosen for
 * how it looks and never for money, so a run leaves forty Forests alone. */
const _dbOptIsBasic = sf => {
  const line = (sf?.type_line || '').toLowerCase();
  return line.includes('basic') && line.includes('land');
};

/** Every (printing, finish) pair one card comes in, each carrying its own
 *  price. cardPrintFinishes() and cardFinishPrice() are js/card.js's, which is
 *  where what a finish is and what one costs are decided — the gallery draws a
 *  tile per pair for the same reason this makes a candidate per pair. */
function _dbOptCandidates(prints) {
  const out = [];
  for (const print of prints || []) {
    for (const finish of cardPrintFinishes(print)) {
      const raw = cardFinishPrice(print, finish);
      const eur = raw == null ? NaN : parseFloat(raw);
      out.push({ print, finish, price: Number.isFinite(eur) ? eur : null });
    }
  }
  return out;
}

/* Whether this is a printing the app will send somebody out to buy.
 *
 * The price is deliberately not part of it, so that "nobody is selling this"
 * and "this is not a thing to buy" stay two different answers — the footer of
 * the preview names them separately, and a card whose printings are all
 * unpriced is a different disappointment from one that has no modern printing
 * at all.
 *
 * A printing with no release date fails: unknown is not "recent", the same way
 * unknown is not free. */
function _dbOptBuyable(print) {
  if (!(print.games || []).includes('paper')) return false;
  if (print.reserved || print.oversized) return false;
  if ((print.promo_types || []).includes('serialized')) return false;
  return String(print.released_at || '') >= DB_OPT_FROM;
}

/* The identity of a candidate, in the one spelling the whole app compares
   printings in — so a candidate can be held against a copy on the shelf and
   against the printing the deck already runs without three ideas of sameness. */
const _dbOptId = c => printingIdentity({ id: c.print.id, finish: c.finish });

/* Cheapest, and dearest, and the tie-break that makes both repeatable. A run
   over the same deck twice must propose the same thing, so ties go to the
   Scryfall id rather than to whatever order the pages happened to arrive in. */
const _dbOptCheapest = list =>
  list.reduce((best, c) => (!best || c.price < best.price
    || (c.price === best.price && _dbOptId(c) < _dbOptId(best)) ? c : best), null);

const _dbOptDearest = list =>
  list.reduce((best, c) => (!best || c.price > best.price
    || (c.price === best.price && _dbOptId(c) < _dbOptId(best)) ? c : best), null);

/* Cheapest among the ones you own, where owning one with no price is still
   owning it. The unpriced sort last rather than first: an unknown price cannot
   win against a known one, which is the same rule the pool lives by. */
const _dbOptCheapestOwned = list => {
  const priced = list.filter(c => c.price !== null);
  return priced.length ? _dbOptCheapest(priced)
       : list.slice().sort((a, b) => (_dbOptId(a) < _dbOptId(b) ? -1 : 1))[0] || null;
};

/** The printing this card of the deck runs today — the chosen one, or the one
 *  Scryfall hands back for the name, which is what the mat has been drawing all
 *  along. js/deckview-owned.js's dbCardPrinting() says the same thing off the
 *  live cache; this is it against a card-data map handed in, so the plan can
 *  stay a function of its arguments. */
function _dbOptCurrent(card, sf) {
  if (card.printing?.id) return card.printing;
  return sf?.id
    ? { id: sf.id, set: sf.set, set_name: sf.set_name, collector_number: sf.collector_number }
    : null;
}

/* What one copy of this card costs as the deck stands — js/deckview-totals.js's
   dbCardPrice() and _dbCardEur() together, against the map handed in. Null is
   unknown and is never nought, which matters here because the delta a pick
   promises has to be the move the readout will actually make. */
function _dbOptWas(card, sf) {
  const raw = card.printing ? card.printing.price_eur : sf?.prices?.eur;
  const eur = raw == null ? NaN : parseFloat(raw);
  return Number.isFinite(eur) ? eur : null;
}

/* Which boards the deck's price counts, which is main and the commander — the
   purse in js/deckview-totals.js. The run covers every board; the total it
   promises covers the ones the readout reads, or it would promise a move the
   readout will not make. */
const _dbOptInPurse = card =>
  [DB_MAIN_BOARD, DB_COMMANDER_BOARD].includes(card.board || DB_MAIN_BOARD);

// ── The decision ──────────────────────────────────────────────────────────

/** The plan: what this run would do to this deck, and what it would leave.
 *
 *  @param cards     the deck's rows, every board
 *  @param cardData  name → the local oracle card, for the type line, the price
 *                   and the printing a deck that has chosen nothing runs
 *  @param prints    name → every printing of it, all pages
 *  @param owned     name → the printings the shelf in scope holds, as
 *                   dbOwnedPrintings() rolls them up
 *  @param mode      one of DB_OPT_MODES
 *  @param today     the day a chosen printing records itself as chosen on
 *
 *  Untouched cards come back as counts by reason rather than as rows: the
 *  preview lists what would change, and "why didn't it touch my Sol Ring" is
 *  answered by one footer line rather than by ninety-nine of them.
 */
function dbOptimizePlan({ cards = [], cardData = new Map(), prints = new Map(),
                          owned = new Map(), mode = 'cheapest',
                          today = new Date().toISOString().slice(0, 10) } = {}) {
  const untouched = { optimal: 0, unpriced: 0, inadmissible: 0, basic: 0, nodata: 0 };
  const picks = [];
  let unattributed = 0;
  let delta = 0;

  for (const card of cards) {
    const name = card.card_name;
    const sf   = cardData.get(name);
    /* A name the app has no data for — one live Scryfall has never heard of,
       or one whose fetch failed. Skipped and counted, so one unknown name does
       not fail the whole run. */
    if (!sf) { untouched.nodata++; continue; }
    if (_dbOptIsBasic(sf)) { untouched.basic++; continue; }

    const candidates = _dbOptCandidates(prints.get(name));
    const pool       = candidates.filter(c => _dbOptBuyable(c.print));
    const priced     = pool.filter(c => c.price !== null);

    let winner = null;
    if (mode === 'owned') {
      /* The copies on the shelf that name a printing anything can be held
         against. A shelf that knows a copy only as a set and a number — every
         row of a Moxfield export — names none, and neither does one nobody has
         attributed at all. */
      const mine = new Set((owned.get(name) || []).map(printingIdentity).filter(id => id !== null));
      const held = candidates.filter(c => mine.has(_dbOptId(c)));
      if (held.length) winner = _dbOptCheapestOwned(held);
      else {
        winner = _dbOptCheapest(priced);
        /* Fell back, and the shelf is the reason: the copies are there and
           nobody recorded which printings they are. Counted so that a
           disappointing run explains itself and names re-importing as the way
           out. Owning none of a card is a different thing and is not this. */
        if ((owned.get(name) || []).length) unattributed++;
      }
    } else {
      winner = mode === 'dearest' ? _dbOptDearest(priced) : _dbOptCheapest(priced);
    }

    if (!winner) {
      /* Two different disappointments. Something to buy that nobody has
         quoted, or nothing to buy at all. */
      if (pool.length) untouched.unpriced++;
      else             untouched.inadmissible++;
      continue;
    }

    const from = _dbOptCurrent(card, sf);
    if (printingIdentity(from) === _dbOptId(winner)) { untouched.optimal++; continue; }

    const to  = cardPrintingSnapshot({ ...winner.print, finish: winner.finish }, today);
    if (!to) { untouched.inadmissible++; continue; }
    const qty = Math.max(1, card.qty || 1);
    const was = _dbOptWas(card, sf);
    const now = winner.price;
    /* Unknown counts as nought here and only here: the readout's total moves by
       exactly this, because a card leaving the unpriced bucket adds its whole
       new price to the sum and one entering it takes its whole old price away. */
    const rowDelta = ((now ?? 0) - (was ?? 0)) * qty;
    if (_dbOptInPurse(card)) delta += rowDelta;

    picks.push({
      ref: dbCardRef(card), name, board: card.board || DB_MAIN_BOARD, qty,
      from, to, was, now, delta: rowDelta, foil: !!to.finish,
    });
  }

  return { mode, picks, untouched, unattributed, delta };
}

/** The names a run has to fetch printings for: the deck's, minus the basics
 *  and minus the ones the app has no data for. Decided from the local cache
 *  before any request goes out, so a deck with thirty-seven Forests in it costs
 *  thirty-seven fewer requests than it has cards. */
function dbOptimizeNames(cards = dbCards, cardData = dbCardData) {
  const names = new Set();
  for (const card of cards) {
    const sf = cardData.get(card.card_name);
    if (sf && !_dbOptIsBasic(sf)) names.add(card.card_name);
  }
  return [...names];
}

// ── The run ───────────────────────────────────────────────────────────────
/* The modal is the run. It opens on the mode picker, fetches with a progress
 * bar you can abandon, and becomes the preview in place when the fetching is
 * done — so there is one thing on screen throughout rather than a spinner that
 * turns into a window.
 *
 * Cancel abandons the run entirely at any point. A partial preview is an answer
 * to a question nobody asked. */

/* The run in front of somebody, or null. `token` is what a fetch checks itself
 * against: a cancelled run is a run whose token no longer matches, so an
 * in-flight request that lands after Cancel writes nothing. */
let _dbOptRun = null;
let _dbOptToken = 0;

function dbShowOptimize() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return false;
  _dbOptRun = { phase: 'pick', mode: '', done: 0, total: 0, plan: null, token: ++_dbOptToken };
  const overlay = document.getElementById('dbOptimizeOverlay');
  if (overlay) overlay.style.display = 'flex';
  _dbOptPaint();
  return true;
}

function dbHideOptimize() {
  /* Bumping the token is the cancel: whatever is in flight comes back to a run
     that is not the current one and stops there. */
  _dbOptToken++;
  _dbOptRun = null;
  const overlay = document.getElementById('dbOptimizeOverlay');
  if (overlay) overlay.style.display = 'none';
}

/** Run a mode: fetch every card's printings, then decide. */
async function dbOptimizeRun(mode) {
  const run = _dbOptRun;
  if (!run || !dbDeck || !isMyPlayer(dbDeck.playerId)) return null;

  const names = dbOptimizeNames();
  Object.assign(run, { phase: 'fetch', mode, done: 0, total: names.length });
  _dbOptPaint();

  const prints = new Map();
  for (const name of names) {
    if (_dbOptRun !== run || run.token !== _dbOptToken) return null;
    const uri = dbCardData.get(name)?.prints_search_uri;
    prints.set(name, uri ? await cardAllPrints(uri) : []);
    run.done++;
    _dbOptPaint();
  }
  if (_dbOptRun !== run || run.token !== _dbOptToken) return null;

  run.plan = dbOptimizePlan({
    cards: dbCards, cardData: dbCardData, prints, mode,
    owned: new Map(names.map(n => [n, dbOwnedPrintings(n)])),
  });
  run.phase = 'preview';
  _dbOptPaint();
  return run.plan;
}

/** Apply the proposal: one snapshot, then one write.
 *
 *  Every pick is re-resolved against the deck as it stands rather than trusted
 *  from when the plan was made — the preview may have stood open while a card
 *  was taken out, and a printing written onto a card that has left the deck is
 *  a row nobody asked for. dbPrintingContext() answers null for those and
 *  dbChoosePrintings() drops them, which is how a partial apply happens and
 *  why the count comes back to be reported. */
async function dbOptimizeApply() {
  const run = _dbOptRun;
  if (!run?.plan?.picks.length || !dbDeck || !isMyPlayer(dbDeck.playerId)) return 0;

  /* Ahead of the write, so a run that went the wrong way is one press in the
     History panel — which is the safety the whole preview is built around. */
  _dbForceSnapshot(`optimize-${run.mode}`);

  const applied = dbChoosePrintings(run.plan.picks.map(p =>
    ({ ctx: dbPrintingContext(p.ref), printing: p.to })));

  run.phase   = 'done';
  run.applied = applied;
  _dbOptPaint();
  return applied;
}

// ── What it looks like ────────────────────────────────────────────────────

const _dbOptEur = n => `€${Math.abs(n).toFixed(2)}`;

/* A price difference, signed and read as money going one way or the other. */
const _dbOptDelta = n =>
  (Math.abs(n) < 0.005 ? '—' : `${n < 0 ? '−' : '+'}${_dbOptEur(n)}`);

/* A printing, said the way the Collections table says one. The finish comes
   with it, because the whole reason cheapest can surprise somebody is that it
   sometimes swaps a card to foil. */
function _dbOptSaid(printing) {
  if (!printing?.id) return 'whatever Scryfall picks';
  const set = (printing.set || '').toUpperCase();
  return `${set || '?'} #${printing.collector_number || '?'}${cardFinishMark(printing.finish || '')}`;
}

function _dbOptModesHtml(mode) {
  return DB_OPT_MODES.map(m => `
    <button class="db-opt-mode${m.id === mode ? ' current' : ''}" onclick="dbOptimizeRun('${m.id}')">
      <span class="db-opt-mode-name">${esc(m.label)}</span>
      <span class="db-opt-mode-hint">${esc(m.hint)}</span>
    </button>`).join('');
}

/** The footer: every card the run did not touch, by reason, and — in
 *  prefer-owned — how many settled for the cheapest because nobody recorded
 *  which printings their copies are. */
function _dbOptFooterHtml(plan) {
  const u = plan.untouched;
  const bits = [];
  if (u.optimal)      bits.push(`${u.optimal} already running the pick`);
  if (u.unpriced)     bits.push(`${u.unpriced} nobody is quoting a price for`);
  if (u.inadmissible) bits.push(`${u.inadmissible} with no printing in the pool`);
  if (u.basic)        bits.push(`${u.basic} basic land${u.basic === 1 ? '' : 's'}`);
  if (u.nodata)       bits.push(`${u.nodata} the app has no card data for`);

  const left = bits.length
    ? `<div class="db-opt-note">Left alone: ${esc(bits.join(', '))}.</div>` : '';
  const fell = plan.unattributed
    ? `<div class="db-opt-note">${plan.unattributed} card${plan.unattributed === 1 ? '' : 's'}
       fell back to the cheapest printing because your copies do not say which printing
       they are. Re-import the collection on the Collections tab to fix that.</div>` : '';
  return left + fell;
}

function _dbOptPreviewHtml(plan) {
  if (!plan.picks.length) {
    return `<div class="empty-state db-opt-empty">Nothing to change — this deck is already
      running ${esc(dbOptMode(plan.mode).label.toLowerCase())} everywhere it can.</div>`
      + _dbOptFooterHtml(plan);
  }
  const rows = plan.picks.map(p => `
    <tr>
      <td class="db-opt-name">${esc(p.name)}${p.qty > 1 ? ` <span class="db-opt-qty">×${p.qty}</span>` : ''}</td>
      <td class="db-opt-from">${esc(_dbOptSaid(p.from))}</td>
      <td class="db-opt-to">${esc(_dbOptSaid(p.to))}${p.foil ? ' <span class="db-opt-foil">foil</span>' : ''}</td>
      <td class="db-opt-money">${esc(_dbOptDelta(p.delta))}</td>
    </tr>`).join('');

  return `
    <div class="db-opt-total">${plan.picks.length} card${plan.picks.length === 1 ? '' : 's'} would change
      · deck price ${esc(_dbOptDelta(plan.delta))}</div>
    <div class="db-opt-scroll">
      <table class="db-opt-table">
        <thead><tr><th>Card</th><th>Runs now</th><th>Would run</th><th>Change</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${_dbOptFooterHtml(plan)}
    <div class="db-opt-actions">
      <button class="btn-primary" onclick="dbOptimizeApply()">Apply ${plan.picks.length} change${plan.picks.length === 1 ? '' : 's'}</button>
      <button class="btn-secondary" onclick="dbHideOptimize()">Cancel</button>
    </div>`;
}

function _dbOptBodyHtml(run) {
  if (run.phase === 'pick') {
    return `<div class="db-opt-modes">${_dbOptModesHtml(run.mode)}</div>
      <div class="db-opt-pool">${esc(DB_OPT_POOL_SAID)}</div>
      <div class="db-opt-actions"><button class="btn-secondary" onclick="dbHideOptimize()">Cancel</button></div>`;
  }
  if (run.phase === 'fetch') {
    const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
    return `<div class="db-opt-progress-line">Looking up printings — ${run.done} of ${run.total}</div>
      <div class="db-opt-progress"><div class="db-opt-progress-bar" style="width:${pct}%"></div></div>
      <div class="db-opt-pool">${esc(DB_OPT_POOL_SAID)}</div>
      <div class="db-opt-actions"><button class="btn-secondary" onclick="dbHideOptimize()">Cancel</button></div>`;
  }
  if (run.phase === 'done') {
    const asked = run.plan.picks.length;
    const said  = run.applied === asked
      ? `${run.applied} printing${run.applied === 1 ? '' : 's'} changed.`
      : `${run.applied} of ${asked} changed — the rest are no longer in the deck.`;
    return `<div class="db-opt-note">${esc(said)} The deck as it was is the newest row in History.</div>
      <div class="db-opt-actions"><button class="btn-primary" onclick="dbHideOptimize()">Close</button></div>`;
  }
  return _dbOptPreviewHtml(run.plan);
}

/* Drawn where it stands, from the run and nothing else — so the progress bar,
   the preview and the result are three states of one window rather than three
   windows. */
function _dbOptPaint() {
  const box = document.getElementById('dbOptimizeBody');
  if (!box || !_dbOptRun) return;
  box.innerHTML = _dbOptBodyHtml(_dbOptRun);
}
