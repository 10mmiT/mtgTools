'use strict';
/**
 * Collection imports, run by the server rather than by the browser tab.
 *
 * Archidekt serves 25 rows a page whatever pageSize it is asked for, and its
 * limiter allows about 80 requests a minute, so archidekt-queue.js paces us at
 * one a second and a six-thousand-card collection takes four minutes. That is
 * far too long to hold a phone awake for. The old client-side loop lost every
 * page it had fetched the moment the tab was refreshed, backgrounded hard
 * enough, or locked — and it saved nothing until the very last page, so there
 * was nothing to come back to.
 *
 * Here the tab only starts the job and watches it. The loop lives in this
 * process and checkpoints into collection_imports as it goes, so closing the
 * tab costs nothing and a crash costs the last few pages.
 *
 * CSV imports are deliberately not here: the file is in the browser, and the
 * server has no way to read it. Neither is Moxfield — api2.moxfield.com is
 * behind Cloudflare and answers 403 to this server, so a Moxfield collection
 * arrives as its CSV export like any other file — a link to one is refused
 * where it is pasted, and the shelves that predate that are re-imported from
 * the export in place.
 */
const { db, writeCollectionCards, addCardPrinting } = require('./available-db');
const { queuedFetch: archidektFetch } = require('./archidekt-queue');

// How often the gathered cards are written down. Every page would mean
// rewriting a growing JSON blob 250 times — at six thousand cards that is
// megabytes of churn to save a few seconds of refetching. Every tenth page
// costs a crash ten pages, which is ten seconds of work. The blob is three
// times the size now each card carries the printings behind its quantity,
// which is the same trade at three times the price and still the cheap side
// of rewriting it 25 times as often.
const CHECKPOINT_EVERY = 10;

// A page that fails for a reason retrying cannot fix (a deleted collection, a
// collection made private) should stop the import rather than hammer at it.
// The rate limit is not in this class: archidekt-queue.js has already waited
// that out by the time a 429 reaches us.
const FATAL_STATUSES = new Set([400, 401, 403, 404, 410]);

// key -> { cancelled } for the imports this process is actually running. The
// table says what *should* be running; this says what is.
const _running = new Map();

const nowIso = () => new Date().toISOString();

// ── Rows ──────────────────────────────────────────────────────────────────
function getImport(key) {
  return db.prepare('SELECT * FROM collection_imports WHERE key = ?').get(key) || null;
}

function listImports() {
  return db.prepare('SELECT * FROM collection_imports ORDER BY started_at').all().map(r => ({
    key:       r.key,
    name:      r.name,
    source:    r.source,
    id:        r.col_id,
    color:     r.color,
    owner:     r.owner_player_id || null,
    status:    r.status,
    page:      r.next_page,
    entries:   r.entries,
    total:     r.total,
    error:     r.error || null,
    startedBy: r.started_by || null,
    startedAt: r.started_at,
    updatedAt: r.updated_at,
    // Whether this process is the one working on it, which is not the same
    // question as what the row says: a row can read 'running' for the moment
    // between a restart and the boot sweep in available-db.js.
    live: _running.has(r.key),
  }));
}

function touch(key, fields) {
  const sets = Object.keys(fields).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE collection_imports SET ${sets}, updated_at = @updated_at WHERE key = @key`)
    .run({ ...fields, key, updated_at: nowIso() });
}

// ── Page shapes ───────────────────────────────────────────────────────────
// Archidekt's, and only Archidekt's. api2.moxfield.com is behind Cloudflare
// and answers 403 to this server, so there is no second page shape to read —
// routes/state.js starts a job for no other source, and a Moxfield shelf
// comes in from the CSV export the browser parses.
const pageUrl = (id, page) =>
  `https://archidekt.com/api/collection/${id}/?page=${page}&pageSize=100`;

const itemsOf = data => data.results || [];
const totalOf = data => data.count ?? null;
const hasMore = data => !!data.next;

function parseCard(item) {
  // Field for field what parseCard in public/js/collections.js reads, down to
  // the array join and the zero default. A collection imported here and one
  // imported in the browser have to come out identical, or re-importing an
  // existing collection would silently rewrite every row in it.
  const o = item.card?.oracleCard || {};
  return {
    name: o.name || item.card?.name || '',
    type: (o.types || []).join(', '),
    mana: o.manaCost || '',
    qty:  item.quantity || 0,
  };
}

/* A field of a page as a printing records one: text, or nothing at all.
 * Archidekt sends its collector number, its condition and its language as
 * numbers, and a printing is written down in strings — the value is kept as
 * the source spells it rather than being interpreted, because two of the
 * three are codes whose meaning this app has never had to know. */
const asText = v => (typeof v === 'string' || typeof v === 'number') ? String(v).trim() : '';

/* Archidekt's word for a finish, in Scryfall's spelling.
 *
 * Every row carries `item.modifier`, and `item.card.options` beside it
 * enumerates the finishes that printing comes in — the set the modifier is
 * drawn from. Over all 3,319 rows of a sampled public collection those options
 * hold three values and no others: Normal, Foil and Etched, which are
 * Scryfall's nonfoil, foil and etched said in Archidekt's voice. The CSV
 * export's Finish column spells them the same way, so the two ways a
 * collection reaches a shelf now agree on the word as well as the card.
 *
 * A modifier nobody has seen before is the ordinary copy rather than a fourth
 * finish of its own. Scryfall knows three, a shelf is read by fifteen things
 * that know those three, and a spelling invented here would be a finish none
 * of them could say anything about — worse than the small, visible wrong of
 * calling it plain.
 */
const FINISHES = { normal: 'nonfoil', foil: 'foil', etched: 'etched' };

/* The finish of one row.
 *
 * `item.foil` is not consulted, and this is the whole of why the import used
 * to be wrong. It is not a field that merely fails to mention etched: it is
 * `false` on every row of a real collection, on all 16 foils of the sampled
 * one as much as on the 3,303 ordinary copies. Reading it filed every foil
 * somebody paid extra for as a card they did not buy — the etched complaint
 * was one case of that, and the narrower one.
 */
const finishOf = item => FINISHES[String(item.modifier || '').trim().toLowerCase()]
                      || 'nonfoil';

/**
 * Which printing a row is — the half of every page the import used to throw
 * away, so a shelf knew you own three Sol Rings and not which three. It is all
 * on the row already, so recording it costs no request that was not being made
 * anyway.
 *
 * A row that says nothing is not downgraded quietly: readCardPrinting turns
 * whatever this hands back into the unknown entry where it names no printing,
 * so those copies are counted and never guessed at.
 */
function parsePrinting(item) {
  const card    = item.card || {};
  const edition = card.edition || {};
  return {
    // A Scryfall id, confirmed against the real API. Where a row has none,
    // the edition code and the collector number below are the same identity
    // said the other way round and stand in for it; a row with neither is the
    // unknown entry, which is readCardPrinting's answer and not one made here.
    id:               asText(card.uid),
    set:              asText(edition.editioncode),
    set_name:         asText(edition.editionname),
    collector_number: asText(card.collectorNumber),
    // Never left silent. A finish is not a printing of its own in Scryfall's
    // model — it is a face on the same id, priced separately — so it has to be
    // in a copy's identity or a foil and the ordinary card collapse into one
    // entry. Which word, and why not item.foil, is finishOf above.
    finish:           finishOf(item),
    // Both are one constant code across every row of a real collection. They
    // are recorded because identity asks for them, and nothing may lean on
    // them varying until they do — recorded identically, they split nothing.
    lang:             asText(item.language),
    condition:        asText(item.condition),
  };
}

// ── Starting and stopping ─────────────────────────────────────────────────
/**
 * Start an import, or resume one that stopped. Returns at once — the work
 * happens on its own after this call.
 *
 * Re-starting one this process is already running is a no-op rather than an
 * error: two tabs pressing Refresh is a normal thing to do, and the honest
 * answer to the second is that it is already happening.
 */
function startImport(meta, startedBy) {
  const { key, name, source, id, color, owner } = meta;
  if (_running.has(key)) return { started: false, reason: 'already running' };

  const prior = getImport(key);
  // Only a stopped import is picked up where it left off. A fresh start, or
  // one the caller asked to redo, begins at page 1 with nothing gathered —
  // otherwise a Refresh would merge the new collection into the stale one and
  // every card since removed would live forever.
  const resume = !!(prior && prior.status === 'interrupted' && !meta.restart);

  db.prepare(`
    INSERT INTO collection_imports
      (key, name, source, col_id, color, owner_player_id, status, next_page, entries, total, cards_json, error, started_by, started_at, updated_at)
    VALUES (@key, @name, @source, @id, @color, @owner, 'running', @next_page, @entries, @total, @cards, NULL, @by, @at, @at)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name, source = excluded.source, col_id = excluded.col_id,
      color = excluded.color, owner_player_id = excluded.owner_player_id,
      status = 'running', next_page = excluded.next_page, entries = excluded.entries,
      total = excluded.total, cards_json = excluded.cards_json, error = NULL,
      started_by = excluded.started_by, started_at = excluded.started_at,
      updated_at = excluded.updated_at
  `).run({
    key, name, source, id: id || null, color: color || '#a855f7', owner: owner || null,
    next_page: resume ? prior.next_page  : 1,
    entries:   resume ? prior.entries    : 0,
    total:     resume ? prior.total      : null,
    cards:     resume ? prior.cards_json : '{}',
    by: startedBy || null,
    at: nowIso(),
  });

  const handle = { cancelled: false };
  _running.set(key, handle);
  // Deliberately not awaited: the HTTP request that asked for this returns
  // immediately, and the loop reports itself through the table from here on.
  const done = _run(key, handle).catch(e => {
    console.error(`[import] ${key} died: ${e.message}`);
    _running.delete(key);
    try { touch(key, { status: 'interrupted', error: e.message }); } catch {}
  });
  // The promise is handed back for the tests, which have to be able to wait
  // for a run they started. Nothing in the routes reads it.
  return { started: true, resumed: resume, done };
}

/** Stop an import. The pages already gathered stay, so it can be resumed. */
function cancelImport(key) {
  const handle = _running.get(key);
  if (handle) handle.cancelled = true;
  const row = getImport(key);
  if (!row) return false;
  // 'interrupted' and not a 'cancelled' of its own: the two are the same thing
  // to everyone downstream — a stopped import with its place kept — and one
  // name for one state is fewer than two.
  touch(key, { status: 'interrupted' });
  return true;
}

/** Forget a stopped import, including the pages it had gathered. */
function clearImport(key) {
  const handle = _running.get(key);
  if (handle) handle.cancelled = true;
  const { changes } = db.prepare('DELETE FROM collection_imports WHERE key = ?').run(key);
  return changes > 0;
}

// ── The loop ──────────────────────────────────────────────────────────────
async function _run(key, handle) {
  const row    = getImport(key);
  const cards  = new Map(Object.entries(JSON.parse(row.cards_json || '{}')));
  let page     = row.next_page;
  let entries  = row.entries;
  let total    = row.total;

  const checkpoint = status => touch(key, {
    status, next_page: page, entries, total,
    cards_json: JSON.stringify(Object.fromEntries(cards)),
  });

  while (true) {
    if (handle.cancelled) { checkpoint('interrupted'); _running.delete(key); return; }

    const res = await archidektFetch(pageUrl(row.col_id, page));

    if (!res.ok) {
      const detail = res.status === 429
        ? 'Archidekt is rate-limiting this server. Resume in a few minutes.'
        : `HTTP ${res.status} from Archidekt`;
      // A rate limit or a server-side wobble is worth resuming from; a 404 is
      // not. Both keep the pages already gathered — the difference is only
      // whether the user is offered a Resume or told what went wrong.
      checkpoint(FATAL_STATUSES.has(res.status) ? 'error' : 'interrupted');
      touch(key, { error: detail });
      _running.delete(key);
      return;
    }

    const data = await res.json();
    if (total === null) total = totalOf(data);

    for (const item of itemsOf(data)) {
      const card = parseCard(item);
      if (!card.name) continue;
      const seen = cards.get(card.name);
      if (seen) seen.qty += card.qty;
      else cards.set(card.name, card);
      // The row's copies, filed under the printing they are of. The quantity
      // above and the breakdown here are counted from the same number, which
      // is what keeps the breakdown summing to the quantity for every card on
      // every shelf, whether or not the row named a printing.
      const of = seen || card;
      of.printings = addCardPrinting(of.printings, { ...parsePrinting(item), qty: card.qty });
      entries++;
    }

    const finished = !hasMore(data);
    // The checkpoint records the page to ask for *next*, so the increment
    // comes first: a crash between the two must not refetch a page whose
    // cards are already counted, or every quantity on it would double.
    page++;
    if (!finished && page % CHECKPOINT_EVERY === 0) checkpoint('running');
    if (finished) break;
  }

  _finish(key, row, cards, entries, total);
  _running.delete(key);
}

/* The finished collection, moved into the table the rest of the app reads.
 * One transaction: the import row must not disappear before the collection it
 * became exists, or a refresh landing in between shows neither. */
function _finish(key, row, cards, entries, total) {
  db.transaction(() => {
    db.prepare(`
      INSERT INTO collections (key, name, source, col_id, color, cards_json, entries, total, saved_at, owner_player_id)
      VALUES (@key, @name, @source, @id, @color, @cards, @entries, @total, @savedAt, @owner)
      ON CONFLICT(key) DO UPDATE SET
        name = excluded.name, source = excluded.source, col_id = excluded.col_id,
        color = excluded.color, cards_json = excluded.cards_json,
        entries = excluded.entries, total = excluded.total, saved_at = excluded.saved_at,
        owner_player_id = excluded.owner_player_id
    `).run({
      key, name: row.name, source: row.source, id: row.col_id, color: row.color,
      cards: writeCollectionCards(Object.fromEntries(cards)),
      entries, total, savedAt: nowIso(), owner: row.owner_player_id || null,
    });
    db.prepare('DELETE FROM collection_imports WHERE key = ?').run(key);
  })();
  console.log(`[import] ${key} finished: ${entries} rows`);
}

module.exports = { startImport, cancelImport, clearImport, listImports, getImport, _running };
