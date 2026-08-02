'use strict';
// ── Set index ─────────────────────────────────────────────────────────────────
// What is in each set, so the Set Browser's tiles can say how many of a set's
// cards are owned before you open it.
//
// That number cannot be worked out from what the app already stores. A
// collection is card names and quantities — Archidekt and Moxfield both give
// an edition per row and the importer drops it, and re-importing every
// collection would still only cover the printings people happen to own. The
// bulk cache in scryfall-db.js is the `oracle_cards` file: one entry per card
// *name*, so it knows a name's set but not a set's names.
//
// So the set's contents are fetched from Scryfall's search API and kept here:
// one row per (set, card name). It is slow to build once — roughly 1,400
// paged requests for the ~750 browsable sets, a few minutes at the shared
// queue's pace — and then effectively permanent, because a released set does
// not change. Sets that do change (a spoiler-season set growing week by week)
// are re-indexed when Scryfall's card_count for them moves.
//
// "Owned" here means the same thing it means on the tab itself: a card counts
// as owned if a collection holds a card of that name, whichever printing.
// Both sides use the same `unique=cards` query, so the tile's "41 / 262"
// matches the 262 cards and 41 badges you see after clicking it.
const { queuedFetch, isValidJson, SF_HEADERS } = require('./scryfall-queue');
const { db } = require('./scryfall-db');

// The set types the Set Browser offers. This is the only copy: the client
// used to filter Scryfall's whole set list itself and now asks this server
// for the list it should show.
const SET_TYPES = ['expansion', 'core', 'masters', 'draft_innovation',
  'commander', 'starter', 'planechase', 'archenemy', 'duel_deck',
  'premium_deck', 'from_the_vault', 'spellbook', 'box'];

const SETS_URL     = 'https://api.scryfall.com/sets';
const REFRESH_MS   = 24 * 60 * 60 * 1000;
const FILL_PAUSE   = 200;   // ms between sets — the sweep is never in a hurry
const MAX_ATTEMPTS = 3;     // give up on a set that keeps failing

db.exec(`
  CREATE TABLE IF NOT EXISTS sets (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    released_at TEXT,
    set_type    TEXT NOT NULL DEFAULT '',
    card_count  INTEGER NOT NULL DEFAULT 0,   -- printings, as Scryfall counts them
    indexed     INTEGER,                      -- distinct cards stored (NULL = never)
    indexed_of  INTEGER,                      -- card_count at the time we indexed
    indexed_at  TEXT,
    attempts    INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS set_cards (
    code TEXT NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (code, name)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_set_cards_name ON set_cards(name);
`);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── The set list ──────────────────────────────────────────────────────────────
const _upsertSet = db.prepare(`
  INSERT INTO sets (code, name, released_at, set_type, card_count)
  VALUES (@code, @name, @released_at, @set_type, @card_count)
  ON CONFLICT(code) DO UPDATE SET
    name        = excluded.name,
    released_at = excluded.released_at,
    set_type    = excluded.set_type,
    -- A set that grew has to be indexed again, so reset the attempt counter
    -- with the count: a spoiler-season failure must not disqualify the set
    -- for good.
    attempts    = CASE WHEN excluded.card_count <> sets.card_count THEN 0 ELSE sets.attempts END,
    card_count  = excluded.card_count
`);

async function refreshSets() {
  const res  = await queuedFetch(SETS_URL, { headers: SF_HEADERS });
  const body = await res.text();
  if (!res.ok || !isValidJson(body)) throw new Error(`sets list HTTP ${res.status}`);
  const rows = (JSON.parse(body).data || [])
    .filter(s => SET_TYPES.includes(s.set_type) && !s.digital)
    .map(s => ({
      code: s.code, name: s.name, released_at: s.released_at || null,
      set_type: s.set_type, card_count: s.card_count || 0,
    }));
  if (!rows.length) throw new Error('sets list came back empty');
  db.transaction(rs => { for (const r of rs) _upsertSet.run(r); })(rows);
  return rows.length;
}

// ── Filling one set ───────────────────────────────────────────────────────────
const _nextToFill = db.prepare(`
  SELECT code, card_count FROM sets
  WHERE attempts < ? AND (indexed IS NULL OR indexed_of IS NOT card_count)
  ORDER BY released_at DESC LIMIT 1
`);
const _clearSet  = db.prepare('DELETE FROM set_cards WHERE code = ?');
const _addCard   = db.prepare('INSERT OR IGNORE INTO set_cards (code, name) VALUES (?, ?)');
const _markDone  = db.prepare(`
  UPDATE sets SET indexed = ?, indexed_of = ?, indexed_at = datetime('now'), attempts = 0
  WHERE code = ?
`);
const _markFail  = db.prepare('UPDATE sets SET attempts = attempts + 1 WHERE code = ?');

/* One set, however many pages it takes. `unique=cards` is the Set Browser's
 * own query, so the count stored here is the count the tab will show.
 *
 * A set with no cards yet — announced but unreleased — answers 404, which is
 * an answer rather than a failure: it is indexed as empty, and the card_count
 * moving off zero is what brings it back here later. */
async function fillSet(code, cardCount) {
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`set:${code}`)}&unique=cards&order=collector_number`;
  const names = [];
  while (url) {
    const res  = await queuedFetch(url, { headers: SF_HEADERS });
    const body = await res.text();
    // 404 on the first page is Scryfall's "no cards match", which for a set
    // is an answer. On a later page it is a broken pagination and has to be
    // an error, or a partial list would be stored as a complete one.
    if (res.status === 404 && !names.length) break;
    if (!res.ok || !isValidJson(body)) throw new Error(`search HTTP ${res.status}`);
    const data = JSON.parse(body);
    for (const c of (data.data || [])) if (c.name) names.push(c.name);
    url = data.has_more ? data.next_page : null;
  }
  db.transaction(() => {
    _clearSet.run(code);
    for (const n of names) _addCard.run(code, n);
    _markDone.run(names.length, cardCount, code);
  })();
  return names.length;
}

let _sweeping = false;
let _stopped  = false;

/* The sweep. Sequential on purpose: one request in the shared queue at a
 * time, so a search someone is waiting for is never behind more than the job
 * already in flight. */
async function sweep() {
  if (_sweeping) return;
  _sweeping = true;
  try {
    let filled = 0;
    while (!_stopped) {
      const next = _nextToFill.get(MAX_ATTEMPTS);
      if (!next) break;
      try {
        const n = await fillSet(next.code, next.card_count);
        filled++;
        if (filled % 50 === 0) {
          const s = status();
          console.log(`[set-index] ${s.indexed} of ${s.sets} sets indexed`);
        }
        if (n === 0) console.log(`[set-index] ${next.code}: no cards yet`);
      } catch (e) {
        _markFail.run(next.code);
        console.warn(`[set-index] ${next.code}: ${e.message}`);
      }
      await sleep(FILL_PAUSE);
    }
    if (filled) {
      const s = status();
      console.log(`[set-index] sweep done — ${s.indexed} of ${s.sets} sets indexed`);
    }
  } finally {
    _sweeping = false;
  }
}

// ── Reading it back ───────────────────────────────────────────────────────────
const _allSets = db.prepare(`
  SELECT code, name, released_at, card_count, indexed
  FROM sets ORDER BY released_at DESC, code ASC
`);
const _counts = db.prepare('SELECT COUNT(*) AS sets, COUNT(indexed) AS indexed FROM sets');

function status() {
  const row = _counts.get();
  return { sets: row.sets, indexed: row.indexed, filling: _sweeping };
}

/* Owned counts for every indexed set, in one query.
 *
 * The owned names go into a temp table rather than an IN (…) list because
 * there can be ten thousand of them, and SQLite's parameter limit is not the
 * place to find that out. Both name columns are NOCASE, so "lightning bolt"
 * from a hand-rolled CSV still matches. */
function ownedCounts(names) {
  db.exec(`CREATE TEMP TABLE IF NOT EXISTS _owned (name TEXT PRIMARY KEY COLLATE NOCASE);
           DELETE FROM _owned;`);
  const insert = db.prepare('INSERT OR IGNORE INTO _owned (name) VALUES (?)');
  db.transaction(ns => { for (const n of ns) if (n) insert.run(n); })(names);
  const rows = db.prepare(`
    SELECT sc.code AS code, COUNT(*) AS owned
    FROM set_cards sc JOIN _owned o ON o.name = sc.name
    GROUP BY sc.code
  `).all();
  const out = new Map();
  for (const r of rows) out.set(r.code, r.owned);
  return out;
}

/* The Set Browser's whole payload: every browsable set, newest first, with
 * the two numbers a tile shows. `cards` is the indexed count where we have
 * one — the number of cards the tab will actually list — and Scryfall's
 * printing count as a stand-in where we do not, which is why `indexed` says
 * which of the two it is. `owned` is null rather than 0 for an unindexed set:
 * nothing is a different claim from none. */
function list(ownedNames) {
  const owned = ownedNames && ownedNames.length ? ownedCounts(ownedNames) : new Map();
  return _allSets.all().map(s => ({
    code:     s.code,
    name:     s.name,
    released: s.released_at,
    cards:    s.indexed != null ? s.indexed : s.card_count,
    indexed:  s.indexed != null,
    owned:    s.indexed != null ? (owned.get(s.code) || 0) : null,
  }));
}

// ── Scheduling ────────────────────────────────────────────────────────────────
async function refreshAndSweep() {
  try {
    await refreshSets();
  } catch (e) {
    console.warn(`[set-index] set list refresh failed: ${e.message}`);
  }
  await sweep();
}

function init() {
  const s = status();
  console.log(`[set-index] ${s.indexed} of ${s.sets} sets indexed`);
  // Background, like the bulk cache — never block startup, never crash it
  refreshAndSweep().catch(e => console.warn(`[set-index] ${e.message}`));
  setInterval(() => refreshAndSweep().catch(() => {}), REFRESH_MS).unref();
}

function stop() { _stopped = true; }

module.exports = { init, stop, list, status, refreshSets, sweep, fillSet, SET_TYPES };
