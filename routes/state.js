'use strict';
const express = require('express');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db, readCollectionCards, writeCollectionCards, isHttpUrl, isImageUrl } = require('../available-db');
const { getSession, requireAuth, requirePlayerAccess } = require('../middleware/auth');
const imports = require('../collection-import');

const DATA_FILE    = process.env.DATA_FILE || require('path').join(__dirname, '..', 'data', 'state.json');
// A player's colour is one of eight theme-defined slots (--player-0…7); see
// the note in public/js/state.js, whose playerSlot() this mirrors. Records
// written before the move hold a hex from the list below instead of a slot,
// and its index is the slot, so both forms read the same.
const PLAYER_SLOTS = 8;
const LEGACY_PLAYER_COLORS =
  ['#f97316','#06b6d4','#84cc16','#e879f9','#fb7185','#34d399','#fbbf24','#60a5fa'];

function playerSlot(player) {
  if (Number.isInteger(player?.colorIdx))
    return ((player.colorIdx % PLAYER_SLOTS) + PLAYER_SLOTS) % PLAYER_SLOTS;
  const legacy = LEGACY_PLAYER_COLORS.indexOf(player?.color);
  if (legacy >= 0) return legacy;
  let h = 0;
  for (const ch of String(player?.id || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % PLAYER_SLOTS;
}

const router = express.Router();

// ── State helpers ──────────────────────────────────────────────────────────────
function readState() {
  try {
    const row = db.prepare('SELECT value_json, version FROM app_state WHERE key = ?').get('state');
    if (!row) return { players: [], version: 0 };
    const parsed = JSON.parse(row.value_json);
    parsed.version = row.version || 0;
    return parsed;
  } catch { return { players: [], version: 0 }; }
}

/* The answer to a write made against a blob that is no longer the stored one.
 * Marked, because it is not the only 409 a write can get: a deck or a name
 * that belongs to somebody else is refused with one too (playersWriteProblem),
 * and the tab has to tell "somebody got there first — reload and redo" from
 * "this change will never be taken", which reloading would not fix. */
const STALE_VERSION = Object.freeze({
  error: 'Conflict: state was modified by another session. Please refresh.',
  conflict: 'version',
});

function writeState(data, checkVersion) {
  const { players = [] } = data;
  if (checkVersion !== undefined) {
    const row     = db.prepare('SELECT version FROM app_state WHERE key = ?').get('state');
    const current = row?.version || 0;
    if (current !== checkVersion) {
      const err = new Error('Conflict'); err.status = 409; throw err;
    }
  }
  db.prepare(`
    INSERT INTO app_state (key, value_json, version) VALUES ('state', ?, 1)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, version = version + 1
  `).run(JSON.stringify({ players }));
  return (db.prepare('SELECT version FROM app_state WHERE key = ?').get('state')?.version || 1);
}

/* The revision a poll asks with — "is there anything newer than this?".
 *
 * Two counters and the viewer. The first is the version app_state already
 * keeps for optimistic concurrency, which covers the players blob: every
 * player, deck record, folder and want list. The second is the counter the
 * triggers in available-db.js push along, which covers the three tables the
 * blob knows nothing about: the shelf, the cards decks are built from, and the
 * imports still arriving.
 *
 * The viewer is part of it because the payload is not one payload. Private
 * decks are filtered per requester (canSeeDeck), so two sessions holding the
 * same two counters are not owed the same answer — and a player promoted to
 * admin mid-session would otherwise be told "unchanged" and never see the
 * decks they had just earned. It is the requester's own role and player id,
 * which is nothing they do not already know about themselves.
 *
 * Opaque to the browser, which only ever hands it back. */
function stateRev(sess) {
  const row = db.prepare(`
    SELECT (SELECT version FROM app_state WHERE key = 'state') AS playersVersion,
           (SELECT version FROM app_state WHERE key = 'rev')   AS tablesRev
  `).get() || {};
  const viewer = sess?.role === 'admin' ? 'admin' : (sess?.playerId || 'none');
  return `${row.playersVersion || 0}.${row.tablesRev || 0}.${viewer}`;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const keysA = Object.keys(a).sort(), keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) return false;
  return keysA.every(k => deepEqual(a[k], b[k]));
}

// Normalise a deck/player to the canonical client shape (public/js/state.js
// stateToJSON) so permission checks compare values, not incidental key noise
// (missing keys vs null/'' defaults added by the client round-trip).
function normalizeDeck(d = {}) {
  return {
    id: d.id, source: d.source || 'manual', deckId: d.deckId || null, url: d.url || '',
    name: d.name || '', nameStatus: d.nameStatus === 'loaded' ? 'loaded' : 'pending',
    commander: d.commander || '', commanderImg: d.commanderImg || null,
    cardCount: d.cardCount || null, bracket: d.bracket ?? null, deckUrl: d.deckUrl || '',
    folderId: d.folderId || null, private: d.private || false,
  };
}
// The colour is compared as the slot, not as whichever form the record spells
// it in. Otherwise the first save after the palette move — which sends slots
// where the stored record holds hexes — would read as a non-admin editing
// every other player, and be refused.
function normalizePlayer(p = {}) {
  return {
    id: p.id, name: p.name || '', colorIdx: playerSlot(p),
    wantList: p.wantList || [], folders: p.folders || [],
    decks: (p.decks || []).map(normalizeDeck),
  };
}
// A player as another non-admin may see them: normalised, with private decks
// dropped. The POST-merge permission check compares two of these so a requester
// who never received a neighbour's private deck (#33) is not read as having
// removed it — the hidden deck is excluded from both sides before deepEqual.
function visiblePlayer(p = {}) {
  const n = normalizePlayer(p);
  n.decks = n.decks.filter(d => !d.private);
  return n;
}

// ── Deck visibility (spec: Private decks) ───────────────────────────────────
// Owner and admin see every deck; everyone else sees only non-private ones.
// Open mode's guest is role 'admin' (see middleware/auth getSession), so
// nothing is withheld there — the private flag is inert without server-side
// identity. The one place the rule lives; the deck-card / snapshot route guards
// (a later ticket) will build their per-deckId check on the same predicate.
function canSeeDeck(session, ownerId, deck) {
  return session?.role === 'admin'
    || (ownerId != null && ownerId === session?.playerId)
    || !deck?.private;
}

// The per-deckId form of canSeeDeck, for the deck-card / snapshot route guards:
// find the deck's owner and private flag in state, then apply the same rule. A
// deckId no player owns is not private, so it stays visible — the route already
// answers emptiness on its own (and open mode's guest is admin, so nothing is
// withheld there either).
//
// Every listing of the id has to agree, not the first one found. The write
// paths below keep a deck id to one player, but state written before they did
// may hold a copy of somebody's private deck id in a second player's list —
// and "the first player listing it says public" must not be what unlocks it.
function deckVisibleTo(session, deckId) {
  for (const p of (readState().players || [])) {
    for (const deck of (p.decks || [])) {
      if (deck?.id === deckId && !canSeeDeck(session, p.id, deck)) return false;
    }
  }
  return true;
}

/* The players whose deck lists name this id — one, normally; none for a deck
 * nobody has stored yet; more only in state written before deck ids were kept
 * to one player. */
function deckOwners(deckId, players = readState().players || []) {
  return players.filter(p => (p.decks || []).some(d => d?.id === deckId)).map(p => p.id);
}

/* Who may write a deck's cards, categories and history (the routes in
 * routes/decks.js). requirePlayerAccess already holds the route's :playerId to
 * the requester; this is the other half — that the deck is that player's. An
 * admin may write any deck, and open mode's guest is one.
 *
 * A deck id no player lists is writable by whoever names it under their own
 * player, and has to be: the tab gives a legacy deck its stable id
 * (`legacy_…` / `arch_…`, js/deckview-core.js) the moment it is opened and
 * only stores it with the next whole-state save, a deck whose save fell back
 * to localStorage is still edited on the mat, and the ids the server tests
 * build decks under belong to nobody. What it may never do is reach a deck
 * another player lists. An id two players list is ambiguous and is nobody's
 * but an admin's to write. */
function deckWritableBy(session, playerId, deckId) {
  if (!session) return false;
  if (session.role === 'admin') return true;
  if (!session.playerId || session.playerId !== playerId) return false;
  return deckOwners(deckId).every(id => id === playerId);
}

// ── What a client may store (the write-side half of escaping) ─────────────
/* An id the tab draws into markup — a data attribute, an inline onclick — so
 * it is held to a shape with nothing in it that could end either. Every id
 * this app has minted fits: d_<ms>, deck_<ms>_<rand>, uuids, arch_<n>,
 * legacy_<player>_<i>, f_<ms>_<n>, p_<ms>, csv:<ms>, archidekt:<n>. */
const ID_RE = /^[\w:.\-]{1,200}$/;
const isId = v => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))
  && ID_RE.test(String(v));
const isHexColor = v => typeof v === 'string'
  && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
const isBlank = v => v === null || v === undefined || v === '';

/* A number, or a string that plainly is one (what a JSON client means by a
 * count it read out of a form). Anything else is NaN, which callers refuse. */
function readNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(v)) return Number(v);
  return NaN;
}

/* Two names that are one name to a person reading them — and to the
 * calendar's by-name check in routes/available.js, which is why it matters. */
const sameName = (a, b) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/* A deck record as a client wants it stored, checked — with its two counts
 * coerced to numbers in place. The reason it is refused, or null. */
function deckProblem(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'A deck must be an object';
  if (!isId(d.id)) return 'A deck id may only hold letters, digits and _ : . -';
  if (!isBlank(d.deckId) && !isId(d.deckId)) return 'A deck\'s source id may only hold letters, digits and _ : . -';
  if (!isBlank(d.folderId) && !isId(d.folderId)) return 'A folder id may only hold letters, digits and _ : . -';
  for (const f of ['name', 'commander', 'source', 'nameStatus']) {
    if (!isBlank(d[f]) && typeof d[f] !== 'string') return `A deck's ${f} must be text`;
  }
  for (const f of ['url', 'deckUrl']) {
    if (!isBlank(d[f]) && !isHttpUrl(d[f])) return `A deck's ${f} must be an http(s) URL`;
  }
  if (!isBlank(d.commanderImg) && !isImageUrl(d.commanderImg)) return 'A deck\'s commander art must be an http(s) image URL';
  if (!isBlank(d.cardCount)) {
    const n = readNumber(d.cardCount);
    if (Number.isNaN(n)) return 'A deck\'s cardCount must be a number';
    d.cardCount = n;
  }
  /* The bracket is the one cosmetic exception: it arrives from Archidekt's
   * deckBracket/powerLevel as well as from the tab's own control, and the tab
   * reads anything that is not a number as no bracket at all (dbBracketOf).
   * So that is what it is stored as, rather than failing the whole deck save
   * over a value Archidekt chose. */
  if (!isBlank(d.bracket)) {
    const n = readNumber(d.bracket);
    d.bracket = Number.isNaN(n) ? null : n;
  }
  return null;
}

function folderProblem(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return 'A folder must be an object';
  if (!isId(f.id)) return 'A folder id may only hold letters, digits and _ : . -';
  if (!isBlank(f.name) && typeof f.name !== 'string') return 'A folder\'s name must be text';
  if (!isBlank(f.position)) {
    const n = readNumber(f.position);
    if (Number.isNaN(n)) return 'A folder\'s position must be a number';
    f.position = n;
  }
  return null;
}

/* One player as a request wrote it, against the stored record (null for a new
 * one). A deck or folder identical to the stored one is not checked: it is
 * not this write's doing, and refusing every later save over something stored
 * before these checks existed would lock that player's state for good. */
function playerProblem(p, stored) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'A player must be an object';
  if (!stored && !isId(p.id)) return 'A player id may only hold letters, digits and _ : . -';
  if (!isBlank(p.name) && typeof p.name !== 'string') return 'A player\'s name must be text';
  if (!isBlank(p.colorIdx) && !Number.isInteger(p.colorIdx)) return 'A player\'s colour slot must be a whole number';
  if (!isBlank(p.color) && !isHexColor(p.color)) return 'A player\'s colour must be a #hex colour';
  for (const list of ['decks', 'folders']) {
    if (p[list] !== undefined && !Array.isArray(p[list])) return `A player's ${list} must be a list`;
  }
  const keep = (records, shape) => new Map((records || []).filter(Boolean)
    .map(r => [r.id, JSON.stringify(shape(r))]));
  const storedDecks   = keep(stored?.decks, normalizeDeck);
  const storedFolders = keep(stored?.folders, f => f);
  for (const d of (p.decks || [])) {
    if (d && typeof d === 'object' && storedDecks.get(d.id) === JSON.stringify(normalizeDeck(d))) continue;
    const why = deckProblem(d);
    if (why) return why;
  }
  for (const f of (p.folders || [])) {
    if (f && typeof f === 'object' && storedFolders.get(f.id) === JSON.stringify(f)) continue;
    const why = folderProblem(f);
    if (why) return why;
  }
  return null;
}

/* Accounts that answer to their username on the calendar: routes/available.js
 * falls back to it when the account is linked to no player (or to one that is
 * gone). A non-admin taking such a name for their player would be answering
 * to it there as well. Admins are not asked — an admin making player "Carol"
 * for the unlinked account "carol" is about to link the two. */
function nameOfUnlinkedAccount(name, players, exceptUsername) {
  const live = new Set(players.map(p => p?.id));
  return db.prepare("SELECT username, player_id FROM users WHERE role != 'admin'").all()
    .some(u => u.username !== exceptUsername
      && (!u.player_id || !live.has(u.player_id))
      && sameName(u.username, name));
}

/* The rules a write is held to, for the players it wrote (`written`, ids):
 *
 *   – each one is well-formed (playerProblem);
 *   – a deck id belongs to one player: a deck may not arrive under a player
 *     while another player lists its id. Otherwise listing a neighbour's
 *     private deck id under your own player makes you its owner, as far as
 *     the read guards can tell. An admin moving a deck from one player to
 *     another does it in one write, so the old listing is gone by then;
 *   – a name belongs to one player, compared trimmed and case-blind: the
 *     calendar authorises by name, so a second "Bob" could clear Bob's days.
 *
 * Only what this write *adds* is held to the last two — a deck the player
 * already listed, a name it already had — so a duplicate stored before the
 * rule existed does not make the state unwritable.
 *
 * Returns { status, error } to refuse with, or null. */
function playersWriteProblem(stored, next, written, sess) {
  const storedById = new Map(stored.filter(Boolean).map(p => [p.id, p]));
  for (const p of next) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { status: 400, error: 'A player must be an object' };
    if (!written.has(p.id)) continue;
    const before = storedById.get(p.id) || null;
    const why = playerProblem(p, before);
    if (why) return { status: 400, error: why };

    const had = new Set((before?.decks || []).map(d => d?.id));
    for (const d of (p.decks || [])) {
      if (d.id == null || had.has(d.id)) continue;
      if (next.some(q => q !== p && q?.id !== p.id && (q?.decks || []).some(o => o?.id === d.id))) {
        return { status: 409, error: `Deck ${d.id} already belongs to another player` };
      }
    }

    if (!before || !sameName(before.name, p.name)) {
      const name = String(p.name ?? '').trim();
      if (next.some(q => q !== p && q?.id !== p.id && sameName(q?.name, name))) {
        return { status: 409, error: `Another player is already called "${name}"` };
      }
      if (sess?.role !== 'admin' && name && nameOfUnlinkedAccount(name, next, sess?.username)) {
        return { status: 409, error: `"${name}" is another account's name` };
      }
    }
  }
  return null;
}

function createLinkedPlayer(username) {
  const appState = readState();
  const players  = appState.players || [];
  const playerId = uuidv4();
  const base     = username.charAt(0).toUpperCase() + username.slice(1);
  /* Never a second player answering to a name somebody already has — the
   * calendar authorises by name (routes/available.js), so an account request
   * for "bob" approved without a link would otherwise become a second Bob,
   * able to clear the first one's days. The new player gets a number instead,
   * which an admin can rename. */
  let name = base;
  for (let n = 2; players.some(p => sameName(p.name, name)); n++) name = `${base} ${n}`;
  players.push({ id: playerId, name, colorIdx: players.length % PLAYER_SLOTS, wantList: [], decks: [] });
  appState.players = players;
  writeState(appState);
  return playerId;
}

// ── One-time migrations ────────────────────────────────────────────────────────
/* state.json, from before SQLite, read into the two tables once.
 *
 * Once, and kept to once by a marker row. It used to be guarded by the tables
 * being empty, which is also what deleting every collection looks like — so
 * the next restart found an empty shelf beside the old file and put the
 * shelf from years ago back. The file is left where it is, as the backup it
 * has become.
 *
 * An install that already has a players row has been running on SQLite since
 * before the marker existed, and imported the file back then: it is marked
 * without being read. */
const LEGACY_MIGRATION = 'migration:state-json';

(function migrateLegacyStateJson() {
  if (db.prepare('SELECT 1 FROM app_state WHERE key = ?').get(LEGACY_MIGRATION)) return;
  const mark = () => db.prepare('INSERT OR IGNORE INTO app_state (key, value_json, version) VALUES (?, ?, 0)')
    .run(LEGACY_MIGRATION, JSON.stringify({ at: Date.now() }));
  if (!fs.existsSync(DATA_FILE)) return;
  if (db.prepare("SELECT 1 FROM app_state WHERE key = 'state'").get()) return mark();
  let raw;
  try { raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { console.warn('state.json migration skipped:', e.message); return; }

  db.transaction(() => {
    const cols = Array.isArray(raw) ? raw : (raw.collections || []);
    if (cols.length && db.prepare('SELECT COUNT(*) AS n FROM collections').get().n === 0) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO collections (key, name, source, col_id, color, cards_json, entries, total, saved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const c of cols)
        insert.run(c.key, c.name, c.source, c.id || null, c.color || '#a855f7',
          JSON.stringify(c.cards || {}), c.entries || 0, c.total || null, c.savedAt || null);
      console.log(`Migrated ${cols.length} collection(s) from state.json to SQLite`);
    }
    const players = Array.isArray(raw) ? [] : (raw.players || []);
    if (players.length) {
      db.prepare(`INSERT OR IGNORE INTO app_state (key, value_json) VALUES ('state', ?)`)
        .run(JSON.stringify({ players }));
      console.log(`Migrated ${players.length} player(s) from state.json to SQLite`);
    }
    mark();
  })();
})();

/* Removing a player does not remove their shelf. The cards are still in the
 * house, so the collection stays exactly as it was and becomes the group's —
 * which is what a null owner has meant all along, and is why this is a column
 * to clear rather than a row to delete.
 *
 * Run after every whole-state write, because that is the only way a player is
 * ever removed: the state is a JSON blob the client replaces wholesale, so
 * there is no delete-player endpoint to hang this off. */
function disownGonePlayers(players) {
  const ids = new Set((players || []).map(p => p.id).filter(Boolean));
  // Imports in flight too: one that lands a new collection names its owner
  // from its own row, and a player removed while it ran is not that owner.
  for (const table of ['collections', 'collection_imports']) {
    const owned = db.prepare(`SELECT key, owner_player_id FROM ${table} WHERE owner_player_id IS NOT NULL`).all();
    const clear = db.prepare(`UPDATE ${table} SET owner_player_id = NULL WHERE key = ?`);
    for (const row of owned) if (!ids.has(row.owner_player_id)) clear.run(row.key);
  }
}

// ── GET /api/state ─────────────────────────────────────────────────────────────
router.get('/state', requireAuth, (req, res) => {
  try {
    const sess = getSession(req);
    /* Read the revision before anything else, and answer a poll that already
     * holds it without building the payload at all — which is the whole point:
     * a shelf of six thousand cards is not parsed, shaped and serialised every
     * thirty seconds to say that nobody has touched it.
     *
     * Before, and not after: a write landing between the payload and the
     * revision would stamp stale data with the current number and the change
     * would never arrive. Landing between the revision and the payload costs
     * one extra full answer on the next poll, which is the harmless direction
     * for the race to fall. */
    const rev = stateRev(sess);
    if (req.query.since && req.query.since === rev) return res.json({ unchanged: true, rev });

    const { players = [], version = 0 } = readState();
    const collections = db.prepare('SELECT * FROM collections ORDER BY rowid').all().map(r => {
      try {
        return {
          key: r.key, name: r.name, source: r.source, id: r.col_id,
          /* Read through the shape helpers, so every card arrives with the
             breakdown of its printings — and a card stored before any of that
             existed arrives with one unknown entry equal to its quantity
             rather than with nothing.

             Parsed here rather than by handing over the column's text, which
             the helper would also take: a row of unreadable JSON has to reach
             the catch below and cost the collection its place in the answer.
             Swallowed, it would come back as a shelf with no cards on it,
             which is this feature's own worst failure wearing a new hat.

             The unknown entries are sent rather than left to the browser to
             infer, though it could: the whole design is that "we do not know"
             is a value and not an absence, and the fields repeat so hard that
             compression() takes them back off the wire almost entirely. */
          color: r.color, cards: readCollectionCards(JSON.parse(r.cards_json || '{}')),
          entries: r.entries, total: r.total, savedAt: r.saved_at,
          owner: r.owner_player_id || null,
        };
      } catch (e) { console.error(`Failed to parse collection ${r.key}:`, e.message); return null; }
    }).filter(Boolean);

    // Withhold other players' private decks from a non-admin — removed from the
    // players array entirely, not just hidden client-side. The requester's own
    // decks and (in open mode / for an admin) everyone's always pass.
    const visiblePlayers = players.map(p => ({
      ...p,
      decks: (p.decks || []).filter(d => canSeeDeck(sess, p.id, d)),
    }));

    // The built-deck signal: SUM(qty) per deck from deck_cards, filtered to the
    // decks the requester may see so a private deck leaks neither its existence
    // nor its size. A deck with no rows is absent — that is what "not built" is.
    const visibleDeckIds = new Set();
    for (const p of visiblePlayers) for (const d of p.decks) visibleDeckIds.add(d.id);
    const deckCardCounts = Object.fromEntries(
      db.prepare('SELECT deck_id, SUM(qty) AS n FROM deck_cards GROUP BY deck_id').all()
        .filter(r => visibleDeckIds.has(r.deck_id))
        .map(r => [r.deck_id, r.n])
    );

    /* Imports in flight ride along with the state the page already fetches on
     * load, so a tab that opens midway through one shows it immediately
     * instead of after the first poll. The poll itself uses GET /api/imports,
     * which is this list and nothing else. */
    /* `version` is the concurrency check's and stays the players blob's alone
     * — a POST hands it back and a mismatch is a 409. `rev` is the poll's, and
     * covers the shelf and the built decks as well; the two are not
     * interchangeable and neither can stand in for the other. */
    res.json({ collections, players: visiblePlayers, version, rev, deckCardCounts, imports: imports.listImports() });
  } catch (e) {
    console.error('GET /api/state error:', e.message);
    // No `rev` on the way out of the catch: an empty state that claimed the
    // current revision would leave the tab believing it had seen everything.
    res.json({ collections: [], players: [], version: 0, deckCardCounts: {}, imports: [] });
  }
});

// ── POST /api/state ────────────────────────────────────────────────────────────
router.post('/state', requireAuth, express.json({ limit: '10mb' }), (req, res) => {
  const sess     = getSession(req);
  const current  = readState();
  const curPlayers = current.players || [];
  const incoming = req.body.players || [];
  if (!Array.isArray(incoming)) return res.status(400).json({ error: 'players must be a list' });
  /* The version the tab last synced to, and not optional: this is a whole-blob
   * replace, and one sent without saying what it was made from cannot be told
   * from one made from a copy an hour old — which would quietly overwrite
   * everything written since.
   *
   * Checked before the permission rules below rather than left to writeState,
   * because those compare the other players against the stored ones, and a
   * stale copy fails that comparison too: a tab that was merely behind would
   * be told Forbidden, which reloading does not sound like it would fix. */
  const clientVersion = req.body.version;
  if (typeof clientVersion !== 'number') return res.status(400).json({ error: 'version required' });
  if (clientVersion !== (current.version || 0)) return res.status(409).json(STALE_VERSION);
  // Admins receive and write the whole blob; a non-admin's write is merged.
  let players = incoming;
  if (sess.role !== 'admin') {
    const incById = new Map(incoming.map(p => [p.id, p]));
    if (curPlayers.length !== incById.size || curPlayers.some(cp => !incById.has(cp.id)))
      return res.status(403).json({ error: 'Forbidden' });
    for (const cp of curPlayers) {
      if (cp.id === sess.playerId) continue;
      const ip = incById.get(cp.id);
      // Non-admins may only change their own player: any other player's name,
      // color, want list or visible decks must be untouched (value-equal after
      // normalisation). Private decks are dropped from both sides first — the
      // requester never received them, so they cannot echo them back (#33).
      if (!ip || !deepEqual(visiblePlayer(cp), visiblePlayer(ip)))
        return res.status(403).json({ error: 'Forbidden' });
    }
    // Merge: keep every other player's stored record exactly as it is — the
    // private decks the requester never saw included — and take only the
    // requester's own player from the blob. Keeping the whole stored player
    // (not just their decks) is deliberate: the check above already proved
    // every visible field value-equal, so nothing legitimate is dropped, and a
    // non-admin can never mutate another player's non-deck fields. Trusting the
    // blob wholesale would delete a neighbour's hidden deck never sent back.
    players = curPlayers.map(cp =>
      cp.id === sess.playerId ? (incById.get(cp.id) || cp) : cp);
  }
  // What this write changed is held to the rules a stored player is: an admin
  // wrote every player, a non-admin only their own (the merge kept the rest).
  const written = new Set(sess.role === 'admin' ? players.map(p => p?.id) : [sess.playerId]);
  const refused = playersWriteProblem(curPlayers, players, written, sess);
  if (refused) return res.status(refused.status).json({ error: refused.error });
  try {
    const newVersion = writeState({ ...current, players }, clientVersion);
    disownGonePlayers(players);
    res.json({ ok: true, version: newVersion });
  } catch (e) {
    if (e.status === 409) return res.status(409).json(STALE_VERSION);
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/players/:playerId/decks ───────────────────────────────────────────
/* A player's whole deck list, replaced with the tab's copy of it — so it is held
 * to the version the way the whole-state POST is. A stale tab's list is missing
 * whatever deck another device added since, and taking it would delete that
 * deck; the 409 sends the tab off to reload instead. */
router.put('/players/:playerId/decks', requirePlayerAccess, express.json({ limit: '1mb' }), (req, res) => {
  const { decks, version: clientVersion } = req.body || {};
  if (!Array.isArray(decks)) return res.status(400).json({ error: 'decks array required' });
  if (typeof clientVersion !== 'number') return res.status(400).json({ error: 'version required' });
  const appState = readState();
  if (clientVersion !== (appState.version || 0)) return res.status(409).json(STALE_VERSION);
  const player   = appState.players.find(p => p.id === req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const stored   = readState().players || [];
  player.decks = decks;
  // The same rules the whole-state POST holds a player to: well-formed decks,
  // and no deck id another player already lists.
  const refused = playersWriteProblem(stored, appState.players, new Set([player.id]), getSession(req));
  if (refused) return res.status(refused.status).json({ error: refused.error });
  try {
    const version = writeState(appState, clientVersion);
    res.json({ ok: true, version });
  } catch (e) {
    if (e.status === 409) return res.status(409).json(STALE_VERSION);
    res.status(500).json({ error: e.message });
  }
});

// ── Want list endpoints ────────────────────────────────────────────────────────
/* These two are patches made on the server against the stored list rather
 * than copies sent from the tab, so a tab that is behind cannot lose anything
 * through them and they ask for no version. What they answer with is the
 * version after the patch and whether they wrote at all — and the tab only
 * adopts that version when it is the one after its own (adoptPatchVersion in
 * public/js/state.js). Anything else means somebody else wrote in between,
 * and adopting it would let the tab's next whole-state save overwrite them.
 *
 * Neither writes when there is nothing to change: a version that moved for no
 * reason would send every other open tab's next save to a 409. */
router.post('/players/:playerId/wants', requirePlayerAccess, express.json(), (req, res) => {
  const { cardName } = req.body || {};
  if (!cardName?.trim()) return res.status(400).json({ error: 'cardName required' });
  const appState = readState();
  const player   = appState.players.find(p => p.id === req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  if (!player.wantList) player.wantList = [];
  const name = cardName.trim();
  const changed = !player.wantList.includes(name);
  let version = appState.version || 0;
  if (changed) { player.wantList.push(name); version = writeState(appState); }
  res.json({ ok: true, version, changed });
});

router.delete('/players/:playerId/wants/:cardName', requirePlayerAccess, (req, res) => {
  const name     = decodeURIComponent(req.params.cardName);
  const appState = readState();
  const player   = appState.players.find(p => p.id === req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const before  = player.wantList || [];
  const after   = before.filter(c => c !== name);
  const changed = after.length !== before.length;
  let version = appState.version || 0;
  if (changed) { player.wantList = after; version = writeState(appState); }
  res.json({ ok: true, version, changed });
});

// ── Collections ────────────────────────────────────────────────────────────────
/* An owner, as the database wants it: a player id, or null for the group's.
 *
 * Anything that is not a player we have heard of is refused rather than
 * stored, because an id nobody answers to reads as the group's anyway — and a
 * silent one is a collection that says it belongs to somebody and cannot say
 * who. Returns `false` for that case; null and '' both mean the group. */
function readOwner(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return false;
  return (readState().players || []).some(p => p.id === raw) ? raw : false;
}

/* Who may change a collection (product owner's rule, audit #3).
 *
 * A collection with an owner is that player's and an admin's to edit, delete
 * or give away; one with no owner is the group's, and anybody logged in may
 * change it. The same predicate answers the second question — whose a
 * non-admin may *say* a collection is: their own, or the group's. Open mode's
 * guest is admin (middleware/auth), so nothing changes there. */
const actsFor = (sess, owner) => sess?.role === 'admin' || owner == null || owner === sess?.playerId;

/* Every owner a key answers to right now: the shelved row's, and — for one
 * being imported — the owner the import was started with. Both, because an
 * import of somebody's shelf is theirs before it lands as well as after. */
function collectionOwners(key) {
  const owners = [];
  const row = db.prepare('SELECT owner_player_id FROM collections WHERE key = ?').get(key);
  if (row) owners.push(row.owner_player_id || null);
  const imp = imports.getImport(key);
  if (imp) owners.push(imp.owner_player_id || null);
  return owners;
}
const mayChangeCollection = (sess, key) => collectionOwners(key).every(owner => actsFor(sess, owner));

/* A collection as a client wants it stored, checked — with its counts coerced
 * to numbers in place. The key and colour are drawn into the tab's markup (an
 * inline onclick, a style), which is why they are held to a shape. */
function collectionProblem(body) {
  if (!isId(body.key)) return 'A collection key may only hold letters, digits and _ : . -';
  if (typeof body.name !== 'string') return 'A collection\'s name must be text';
  if (typeof body.source !== 'string' || !/^[\w-]{1,40}$/.test(body.source)) return 'A collection\'s source must be a single word';
  if (!isBlank(body.id) && !isId(body.id)) return 'A collection id may only hold letters, digits and _ : . -';
  if (!isBlank(body.color) && !isHexColor(body.color)) return 'A collection\'s colour must be a #hex colour';
  if (!isBlank(body.savedAt) && typeof body.savedAt !== 'string') return 'savedAt must be text';
  for (const f of ['entries', 'total']) {
    if (isBlank(body[f])) continue;
    const n = readNumber(body[f]);
    if (Number.isNaN(n)) return `A collection's ${f} must be a number`;
    body[f] = n;
  }
  return null;
}

const FORBIDDEN_OWNER = 'You can only make a collection yours or the group\'s';
const NOT_YOURS       = 'That collection belongs to another player';

router.post('/collections', requireAuth, express.json({ limit: '10mb' }), (req, res) => {
  const sess = getSession(req);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (!body.key || !body.name || !body.source) return res.status(400).json({ error: 'key, name, source required' });
  const bad = collectionProblem(body);
  if (bad) return res.status(400).json({ error: bad });
  if (!mayChangeCollection(sess, body.key)) return res.status(403).json({ error: NOT_YOURS });
  const { key, name, source, id, color, cards, entries, total, savedAt } = body;
  /* Whether the owner was *said*, not what it came out as. This route is the
   * whole-collection write — adding one, refreshing one, re-importing a CSV —
   * and a client that does not mention the owner must not have it cleared as
   * a side effect of a refresh. So an absent field leaves the column alone,
   * and only a stated one (a player, or null for the group) writes it. */
  const given = Object.prototype.hasOwnProperty.call(body, 'owner');
  const owner = given ? readOwner(body.owner) : null;
  if (owner === false) return res.status(400).json({ error: 'Unknown player' });
  if (given && !actsFor(sess, owner)) return res.status(403).json({ error: FORBIDDEN_OWNER });
  try {
    db.prepare(`
      INSERT INTO collections (key, name, source, col_id, color, cards_json, entries, total, saved_at, owner_player_id)
      VALUES (@key, @name, @source, @id, @color, @cards, @entries, @total, @savedAt, @owner)
      ON CONFLICT(key) DO UPDATE SET
        name=excluded.name, source=excluded.source, col_id=excluded.col_id,
        color=excluded.color, cards_json=excluded.cards_json,
        entries=excluded.entries, total=excluded.total, saved_at=excluded.saved_at,
        owner_player_id = CASE WHEN @given THEN @owner ELSE collections.owner_player_id END
    `).run({
      key, name, source, id: id || null, color: color || '#a855f7',
      cards: writeCollectionCards(cards || {}), entries: entries || 0,
      total: total || null, savedAt: savedAt || null,
      owner, given: given ? 1 : 0,
    });
    res.json({ ok: true, owner });
  } catch (e) { console.error('Collection save error:', e.message); res.status(500).json({ error: e.message }); }
});

/* Changing whose shelf it is, on its own. A route of its own and not the POST
 * above, because a collection is its cards: re-uploading five thousand of them
 * to say a different name is what an owner change would otherwise cost. */
router.put('/collections/:key/owner', requireAuth, express.json(), (req, res) => {
  const sess  = getSession(req);
  const key   = decodeURIComponent(req.params.key);
  if (!db.prepare('SELECT 1 FROM collections WHERE key = ?').get(key)) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  if (!mayChangeCollection(sess, key)) return res.status(403).json({ error: NOT_YOURS });
  const owner = readOwner((req.body || {}).owner);
  if (owner === false) return res.status(400).json({ error: 'Unknown player' });
  if (!actsFor(sess, owner)) return res.status(403).json({ error: FORBIDDEN_OWNER });
  const { changes } = db.prepare('UPDATE collections SET owner_player_id = ? WHERE key = ?').run(owner, key);
  if (!changes) return res.status(404).json({ error: 'Collection not found' });
  res.json({ ok: true, owner });
});

router.delete('/collections/:key', requireAuth, (req, res) => {
  const key = decodeURIComponent(req.params.key);
  if (!mayChangeCollection(getSession(req), key)) return res.status(403).json({ error: NOT_YOURS });
  // An import still gathering pages for this collection has to go too, or it
  // would finish minutes later and put the collection back.
  imports.clearImport(key);
  db.prepare('DELETE FROM collections WHERE key = ?').run(key);
  res.json({ ok: true });
});

/* ── Imports ───────────────────────────────────────────────────────────────
 * Adding or refreshing an Archidekt collection is a job the server runs, not
 * the tab — see collection-import.js for why. These three routes are the
 * whole of the browser's part in it: start one, watch them, stop one. CSV
 * imports never come through here; the file only exists in the browser, so
 * those still POST the finished cards to /api/collections.
 *
 * Archidekt is the only site there is to fetch from. Every other shelf comes
 * in from an export the browser parses — the CSV ones, and the Moxfield ones
 * from before api2.moxfield.com began answering 403 to this server, which the
 * tab now re-imports from the export in place rather than refreshing. So this
 * route refuses every source it cannot fetch, and needs to know the name of
 * none of them.
 */
const IMPORT_SOURCES = new Set(['archidekt']);

router.post('/collections/:key/import', requireAuth, express.json(), (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const { name, source, id, color, restart } = req.body || {};
  if (!name || !source) return res.status(400).json({ error: 'name and source required' });
  if (!IMPORT_SOURCES.has(source)) {
    return res.status(400).json({ error: `Cannot import a ${source} collection on the server` });
  }
  if (!id) return res.status(400).json({ error: 'id required' });
  // The import lands as a collection (collection-import.js _finish), so it is
  // held to the same shapes the whole-collection POST is.
  const bad = collectionProblem({ key, name, source, id, color });
  if (bad) return res.status(400).json({ error: bad });
  const sess = getSession(req);
  if (!mayChangeCollection(sess, key)) return res.status(403).json({ error: NOT_YOURS });

  // Same rule as the whole-collection POST above: an owner that is not
  // mentioned leaves the existing one alone rather than clearing it.
  const given = Object.prototype.hasOwnProperty.call(req.body || {}, 'owner');
  const owner = given ? readOwner(req.body.owner) : (imports.getImport(key)?.owner_player_id
    || db.prepare('SELECT owner_player_id FROM collections WHERE key = ?').get(key)?.owner_player_id
    || null);
  if (owner === false) return res.status(400).json({ error: 'Unknown player' });
  if (given && !actsFor(sess, owner)) return res.status(403).json({ error: FORBIDDEN_OWNER });

  // An owner named here is a change made now, not when the last page lands:
  // the finished import keeps whatever owner the shelf has by then, so that
  // one changed while it ran is not put back.
  if (given) db.prepare('UPDATE collections SET owner_player_id = ? WHERE key = ?').run(owner, key);
  const started = imports.startImport({ key, name, source, id, color, owner, restart: !!restart },
    sess?.username || null);
  res.json({ ok: true, ...started, done: undefined, imports: imports.listImports() });
});

router.get('/imports', requireAuth, (req, res) => res.json({ imports: imports.listImports() }));

/* Stopping one. `?forget=1` throws away the pages it had gathered as well —
 * that is the difference between "not now" and "never mind", and a resume
 * button in front of a job nobody wants is worse than no button. */
router.delete('/imports/:key', requireAuth, (req, res) => {
  const key = decodeURIComponent(req.params.key);
  // Stopping one, and above all forgetting its pages, is changing the shelf.
  if (!mayChangeCollection(getSession(req), key)) return res.status(403).json({ error: NOT_YOURS });
  const gone = req.query.forget ? imports.clearImport(key) : imports.cancelImport(key);
  if (!gone) return res.status(404).json({ error: 'No such import' });
  res.json({ ok: true, imports: imports.listImports() });
});

module.exports = {
  router, createLinkedPlayer, readState, writeState, deckVisibleTo, deckWritableBy,
  isBlank, readNumber,
};
