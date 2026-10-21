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

/* A basic land, off the type line — js/deckview-legality.js's rule for the copy
 * limit, written out again here rather than borrowed because there is nothing
 * to borrow: that one is a line inside a function that takes a card name and
 * reads the live cache, and dbOptimizePlan() is a function of its arguments.
 * The same rule over a card object handed in is what this is, and the two must
 * stay the same rule — a basic is four-of-any-number in one and untouchable in
 * the other, and both are the same fact about the card.
 *
 * (js/deckview-mana.js's `dbIsBasic` looks shorter and is not a third answer:
 * it is asked only of a card already known to be a land, so its caller has
 * already done the half that is missing from it.)
 *
 * The printing of a basic is chosen for how it looks and never for money, so a
 * run leaves forty Forests alone. */
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

/* The winner of a list, and the tie-break that makes a run repeatable.
 *
 * Cheapest and dearest are one walk with the comparison turned round, so they
 * are written once: two reduces differing in a `<` is two places for the
 * tie-break to be got wrong, and a run over the same deck twice proposing two
 * different things is the kind of bug nobody can reproduce on purpose. Ties go
 * to the Scryfall id rather than to whatever order the pages happened to arrive
 * in, which is the only order that is a property of the card rather than of the
 * network. */
const _dbOptBest = (list, beats) =>
  list.reduce((best, c) => (!best || beats(c, best)
    || (c.price === best.price && _dbOptId(c) < _dbOptId(best)) ? c : best), null);

const _dbOptCheapest = list => _dbOptBest(list, (c, best) => c.price < best.price);
const _dbOptDearest  = list => _dbOptBest(list, (c, best) => c.price > best.price);

/* Cheapest among the ones you own, where owning one with no price is still
   owning it. The unpriced sort last rather than first: an unknown price cannot
   win against a known one, which is the same rule the pool lives by — and
   between two unpriced copies the tie-break above is the whole answer. */
const _dbOptCheapestOwned = list => {
  const priced = list.filter(c => c.price !== null);
  return priced.length ? _dbOptCheapest(priced)
                       : _dbOptBest(list, () => false);
};


/* Which boards the deck's price counts, which is main and the commander — the
   purse in js/deckview-totals.js. The run covers every board; the total it
   promises covers the ones the readout reads, or it would promise a move the
   readout will not make. */
const DB_OPT_PURSE = [DB_MAIN_BOARD, DB_COMMANDER_BOARD];
const _dbOptInPurse = card => DB_OPT_PURSE.includes(card.board || DB_MAIN_BOARD);

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
  const untouched = { optimal: 0, unpriced: 0, inadmissible: 0, basic: 0, nodata: 0, unlooked: 0 };
  const picks = [];
  let unattributed = 0;
  let delta = 0;
  /* What the deck costs as it stands, over the boards the price readout counts
     — because "what would this deck cost in its cheapest printings" is the
     question the run exists to answer, and a signed difference says how far the
     figure moves without saying where it lands. _dbCardEur() is the readout's
     own, so the two cannot come to disagree. */
  let before = 0;
  for (const card of cards) {
    if (!_dbOptInPurse(card)) continue;
    const each = _dbCardEur(card, cardData);
    if (each !== null) before += each * Math.max(1, card.qty || 1);
  }

  for (const card of cards) {
    const name = card.card_name;
    const sf   = cardData.get(name);
    /* A name the app has no data for — one live Scryfall has never heard of,
       or one whose fetch failed. Skipped and counted, so one unknown name does
       not fail the whole run. */
    if (!sf) { untouched.nodata++; continue; }
    if (_dbOptIsBasic(sf)) { untouched.basic++; continue; }
    /* A card whose printings were never fetched, which is not the same thing
       as a card with no printing worth buying — and used to be reported as
       one. The map carries an entry for every name the fetch was asked for,
       so a name missing from it is a gap rather than an empty answer, and the
       difference is the whole of what a rate-limited run used to get wrong. */
    if (!prints.has(name)) { untouched.unlooked++; continue; }

    const candidates = _dbOptCandidates(prints.get(name));
    const pool       = candidates.filter(c => _dbOptBuyable(c.print));
    const priced     = pool.filter(c => c.price !== null);

    let winner = null;
    if (mode === 'owned') {
      /* The copies on the shelf that name a printing anything can be held
         against. A shelf that knows a copy only as a set and a number — every
         row of a Moxfield export — names none, and neither does one nobody has
         attributed at all. */
      const copies = owned.get(name) || [];
      const mine   = new Set(copies.map(printingIdentity).filter(id => id !== null));
      const held   = candidates.filter(c => mine.has(_dbOptId(c)));
      if (held.length) winner = _dbOptCheapestOwned(held);
      else {
        winner = _dbOptCheapest(priced);
        /* Fell back, and the shelf is the reason: the copies are there and
           nobody recorded which printings they are. Counted so that a
           disappointing run explains itself and names re-importing as the way
           out — which is why it counts copies nobody attributed rather than
           every fallback. Owning none of a card is a different thing and is not
           this, and so is owning one recorded down to its id that happens to
           match nothing: re-importing that shelf would change neither. */
        if (copies.some(copy => printingIdentity(copy) === null)) unattributed++;
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

    /* What the card runs today, asked of js/deckview-owned.js — the same
       function the four ownership badges are decided by, handed this plan's
       card data instead of the live cache. Two answers to "which printing does
       this card run" is how a run calls a card already optimal that the mat is
       drawing as something else. */
    const from = dbCardPrinting(card, cardData);
    if (printingIdentity(from) === _dbOptId(winner)) { untouched.optimal++; continue; }

    const to  = cardPrintingSnapshot({ ...winner.print, finish: winner.finish }, today);
    if (!to) { untouched.inadmissible++; continue; }
    const qty = Math.max(1, card.qty || 1);
    const was = _dbCardEur(card, cardData);
    const now = winner.price;
    /* Unknown counts as nought here and only here: the readout's total moves by
       exactly this, because a card leaving the unpriced bucket adds its whole
       new price to the sum and one entering it takes its whole old price away. */
    const rowDelta = ((now ?? 0) - (was ?? 0)) * qty;
    if (_dbOptInPurse(card)) delta += rowDelta;

    picks.push({
      ref: dbCardRef(card), name, board: card.board || DB_MAIN_BOARD, qty,
      /* The finish itself and not a foil flag: etched is a finish of its own,
         priced in a field of its own, and a preview calling it foil would name
         a card nobody can go and buy. */
      from, to, was, now, delta: rowDelta, finish: to.finish || '',
    });
  }

  return { mode, picks, untouched, unattributed, delta, before, after: before + delta };
}

/** The names a run has to fetch printings for: the deck's, minus the basics
 *  and minus the ones the app has no data for. Decided from the local cache
 *  before any request goes out, so a deck with thirty-seven Forests in it costs
 *  thirty-seven fewer requests than it has cards. */
function dbOptimizeNames() {
  const names = new Set();
  for (const card of dbCards) {
    const sf = dbCardData.get(card.card_name);
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

// ── Asking Scryfall ───────────────────────────────────────────────────────
/* One search per card was the first way this was written, and it does not
 * work. A Commander deck is about a hundred distinct non-basic cards, so it
 * was a hundred search requests fired back to back through the server's shared
 * Scryfall queue; measured against the live API, Scryfall starts refusing at
 * around the twenty-third, and the queue's answer to a 429 is to pause *all*
 * Scryfall traffic on the server for a minute. A run stopped a fifth of the
 * way through and every other tab stopped with it.
 *
 * The queue was not the culprit and slowing it down is not the fix. Scryfall's
 * search takes several oracle ids in one query — `oracleid:A or oracleid:B` —
 * and answers with every printing of all of them, so the right change is to
 * stop asking a hundred questions. A deck comes back in a handful of requests
 * rather than a hundred, which is both under the limit and quick.
 *
 * What it costs is the per-card response cache the proxy keeps: a run no
 * longer warms the exact URL the card gallery will ask for, so opening a card
 * after a run fetches its printings again. That was worth having and it is
 * worth less than a run that finishes. */

/* How many cards go in one query. Ten oracle ids is a URL of about six hundred
   characters, which is comfortably inside what Scryfall and every proxy
   between here and it will take, and it is the difference between a hundred
   requests and ten. */
const DB_OPT_BATCH = 10;

const DB_OPT_SEARCH = 'https://api.scryfall.com/cards/search';

/** Whether the run that started this work is still the one on screen. Cancel
 *  bumps the token, so an answer that arrives afterwards writes nothing. */
const _dbOptLive = run => _dbOptRun === run && run.token === _dbOptToken;

/** Every printing of every card named, in as few searches as it takes.
 *
 *  The answer comes back as one list of printings from several cards mixed
 *  together, so each is filed under the card it is a printing of by its oracle
 *  id — which is what the query asked by, and so cannot disagree with it.
 *
 *  A name has an entry when this returns if, and only if, something was asked
 *  about it and answered — an empty answer is still an answer, and is filed as
 *  one. A name with no entry is a card nobody looked up, which is what
 *  dbOptimizePlan() reads to keep the two apart: seeding every name with an
 *  empty list up front would report a card the run never managed to ask about
 *  as one with no printing worth buying.
 *
 *  Throws if Scryfall refuses. A run built on pages nobody fetched is a run
 *  that reports cards as unbuyable when the truth is that the app never
 *  looked. */
async function _dbOptFetchPrints(names, run) {
  const prints   = new Map();
  const byOracle = new Map();
  const alone    = [];

  for (const name of names) {
    const oracle = dbCardData.get(name)?.oracle_id;
    /* A card the app knows no oracle id for — data from before the field, or
       from a path that does not carry it. It still has a printings URL of its
       own, so it is asked for singly rather than dropped. */
    if (!oracle) { alone.push(name); continue; }
    /* Two names can share one oracle id: dbFetchCardData files a two-faced
       card under its full name and its front-face name both. */
    if (!byOracle.has(oracle)) byOracle.set(oracle, []);
    byOracle.get(oracle).push(name);
  }

  const ids     = [...byOracle.keys()];
  const batches = [];
  for (let i = 0; i < ids.length; i += DB_OPT_BATCH) batches.push(ids.slice(i, i + DB_OPT_BATCH));

  Object.assign(run, { done: 0, total: batches.length + alone.length });
  _dbOptPaint();

  for (const batch of batches) {
    if (!_dbOptLive(run)) return null;
    const q   = batch.map(id => `oracleid:${id}`).join(' or ');
    const url = `${DB_OPT_SEARCH}?order=released&unique=prints&q=${encodeURIComponent(q)}`;
    const answered = await cardAllPrints(url, { strict: true });
    /* Asked about and answered, before anything is filed: a card whose oracle
       id the search matched nothing for has an entry that is empty, which is a
       different fact from having no entry at all. */
    for (const id of batch) for (const name of byOracle.get(id)) prints.set(name, []);
    for (const print of answered) {
      for (const name of byOracle.get(print.oracle_id) || []) prints.get(name).push(print);
    }
    run.done++;
    _dbOptPaint();
  }

  for (const name of alone) {
    if (!_dbOptLive(run)) return null;
    /* No oracle id to batch it with and no printings URL to ask on its own:
       there is no question to put, so the name is left out of the map and the
       plan counts it as one nobody looked up. */
    const uri = dbCardData.get(name)?.prints_search_uri;
    if (uri) prints.set(name, await cardAllPrints(uri, { strict: true }));
    run.done++;
    _dbOptPaint();
  }
  return prints;
}

/** Run a mode: fetch every card's printings, then decide. */
async function dbOptimizeRun(mode) {
  const run = _dbOptRun;
  if (!run || !dbDeck || !isMyPlayer(dbDeck.playerId)) return null;

  const names = dbOptimizeNames();
  Object.assign(run, { phase: 'fetch', mode, done: 0, total: 0, error: '' });
  _dbOptPaint();

  let prints;
  try {
    prints = await _dbOptFetchPrints(names, run);
  } catch (e) {
    if (!_dbOptLive(run)) return null;
    /* Stopped rather than half-answered. The alternative is a preview that
       looks complete and is not, with no way for anybody reading it to tell
       which cards the app failed to look up. */
    run.phase = 'error';
    run.error = `Scryfall stopped answering (${e.message}). Nothing has been changed. `
              + 'It asks for a pause when a lot is asked of it at once — wait a minute and try again.';
    _dbOptPaint();
    return null;
  }
  if (!prints || !_dbOptLive(run)) return null;

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

  /* Ahead of the write and awaited, and the write is conditional on it —
     js/deckview-core.js's deck deletion awaits the same call for the same
     reason. Elsewhere a snapshot is not awaited on purpose, because a failed
     one must not stop an edit somebody asked for; here it is the edit's whole
     safety. Overwriting the printing of every card in a deck is worth pressing
     because one press puts it all back, and a run that wrote after a refused
     POST would be the `commander` bug again: a screen saying History has a row
     that History has never heard of. */
  const snapshot = await dbForceSnapshot(`optimize-${run.mode}`);
  /* Cancelled while the snapshot was in flight. */
  if (!_dbOptLive(run)) return 0;
  if (!snapshot) { run.phase = 'nohistory'; _dbOptPaint(); return 0; }

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
  if (u.unlooked)     bits.push(`${u.unlooked} whose printings could not be looked up`);

  const left = bits.length
    ? `<div class="db-opt-note">Left alone: ${esc(bits.join(', '))}.</div>` : '';
  /* Said as what the count actually is — cards this mode could not answer from
     the shelf — rather than as "fell back to cheapest", which is true of the
     ones that then found something and misleading about the ones that did not.
     Re-importing helps every card in the number either way: the printing it
     would find is the printing this mode wants, and prefer-owned is not bound
     by the pool, so even a Reserved List copy would then win. */
  const fell = plan.unattributed
    ? `<div class="db-opt-note">${plan.unattributed} card${plan.unattributed === 1 ? '' : 's'}
       could not be settled onto your copies, because the shelf does not record which
       printings those copies are. Re-import the collection on the Collections tab and
       it can be.</div>` : '';
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
      <td class="db-opt-to">${esc(_dbOptSaid(p.to))}${p.finish
        ? ` <span class="db-opt-foil">${esc(p.finish)}</span>` : ''}</td>
      <td class="db-opt-money">${esc(_dbOptDelta(p.delta))}</td>
    </tr>`).join('');

  /* The total is the move the deck's price readout will make, which counts the
     mainboard and the commander and no other board. So a run that also proposes
     something for a sideboard says so, rather than leaving a table whose rows
     visibly do not add up to the figure above them. */
  const outside = plan.picks.filter(p => !_dbOptInPurse(p)).length;
  return `
    <div class="db-opt-total">${plan.picks.length} card${plan.picks.length === 1 ? '' : 's'} would change
      · deck price ${esc(_dbOptEur(plan.before))} → ${esc(_dbOptEur(plan.after))}
      <span class="db-opt-aside">${esc(_dbOptDelta(plan.delta))}${outside
        ? `, ${outside} of them off the boards the price counts` : ''}</span></div>
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
    /* Requests rather than cards: the whole point of the batching is that
       those are no longer the same number, and a bar that counted cards would
       jump ten at a time. */
    return `<div class="db-opt-progress-line">Looking up printings — ${run.done} of ${run.total || '…'}</div>
      <div class="db-opt-progress"><div class="db-opt-progress-bar" style="width:${pct}%"></div></div>
      <div class="db-opt-pool">${esc(DB_OPT_POOL_SAID)}</div>
      <div class="db-opt-actions"><button class="btn-secondary" onclick="dbHideOptimize()">Cancel</button></div>`;
  }
  if (run.phase === 'error') {
    return `<div class="db-opt-note">${esc(run.error)}</div>
      <div class="db-opt-actions">
        <button class="btn-primary" onclick="dbOptimizeRun('${esc(run.mode)}')">Try again</button>
        <button class="btn-secondary" onclick="dbHideOptimize()">Cancel</button>
      </div>`;
  }
  if (run.phase === 'nohistory') {
    return `<div class="db-opt-note">The deck has been left exactly as it was: the History
      row this run would be undone from could not be saved, and without it there would be no
      way back from ${run.plan.picks.length} changed printing${run.plan.picks.length === 1 ? '' : 's'}.</div>
      <div class="db-opt-actions">
        <button class="btn-primary" onclick="dbOptimizeApply()">Try again</button>
        <button class="btn-secondary" onclick="dbHideOptimize()">Cancel</button>
      </div>`;
  }
  if (run.phase === 'done') {
    const asked = run.plan.picks.length;
    const said  = run.applied === asked
      ? `${run.applied} printing${run.applied === 1 ? '' : 's'} changed.`
      : `${run.applied} of ${asked} changed — the rest are no longer in the deck.`;
    return `<div class="db-opt-note">${esc(said)} The deck as it was is the newest row in History.</div>
      <div class="db-opt-actions"><button class="btn-primary" onclick="dbHideOptimize()">Close</button></div>`;
  }
  /* The pool is said again under the proposal, and not only on the picker: the
     preview is the screen the four-figure Sol Ring actually appears on, and a
     bound stated two screens ago is a bound nobody is reading when the result
     provokes the question. Prefer-owned is not bounded by it and does not say
     it. */
  return _dbOptPreviewHtml(run.plan)
    + (run.mode === 'owned' ? '' : `<div class="db-opt-pool">${esc(DB_OPT_POOL_SAID)}</div>`);
}

/* Drawn where it stands, from the run and nothing else — so the progress bar,
   the preview and the result are three states of one window rather than three
   windows. */
function _dbOptPaint() {
  const box = document.getElementById('dbOptimizeBody');
  if (!box || !_dbOptRun) return;
  box.innerHTML = _dbOptBodyHtml(_dbOptRun);
}
