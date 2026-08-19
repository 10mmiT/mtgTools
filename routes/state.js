'use strict';
const express = require('express');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db }  = require('../available-db');
const { getSession, requireAuth, requirePlayerAccess } = require('../middleware/auth');

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

function createLinkedPlayer(username) {
  const appState = readState();
  const players  = appState.players || [];
  const playerId = uuidv4();
  const name     = username.charAt(0).toUpperCase() + username.slice(1);
  players.push({ id: playerId, name, colorIdx: players.length % PLAYER_SLOTS, wantList: [], decks: [] });
  appState.players = players;
  writeState(appState);
  return playerId;
}

// ── One-time migrations ────────────────────────────────────────────────────────
(function migrateCollections() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM collections').get().n;
  if (count > 0) return;
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw  = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const cols = Array.isArray(raw) ? raw : (raw.collections || []);
    if (!cols.length) return;
    const insert = db.prepare(`
      INSERT OR IGNORE INTO collections (key, name, source, col_id, color, cards_json, entries, total, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of cols)
      insert.run(c.key, c.name, c.source, c.id || null, c.color || '#a855f7',
        JSON.stringify(c.cards || {}), c.entries || 0, c.total || null, c.savedAt || null);
    console.log(`Migrated ${cols.length} collection(s) from state.json to SQLite`);
  } catch (e) { console.warn('Collection migration skipped:', e.message); }
})();

(function migrateStateJson() {
  const row = db.prepare('SELECT value_json FROM app_state WHERE key = ?').get('state');
  if (row) return;
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw     = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const players = Array.isArray(raw) ? [] : (raw.players || []);
    if (!players.length) return;
    db.prepare(`INSERT OR IGNORE INTO app_state (key, value_json) VALUES ('state', ?)`)
      .run(JSON.stringify({ players }));
    console.log(`Migrated ${players.length} player(s) from state.json to SQLite`);
  } catch (e) { console.warn('State migration skipped:', e.message); }
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
  const owned = db.prepare('SELECT key, owner_player_id FROM collections WHERE owner_player_id IS NOT NULL').all();
  const clear = db.prepare('UPDATE collections SET owner_player_id = NULL WHERE key = ?');
  for (const row of owned) if (!ids.has(row.owner_player_id)) clear.run(row.key);
}

// ── GET /api/state ─────────────────────────────────────────────────────────────
router.get('/state', requireAuth, (req, res) => {
  try {
    const sess = getSession(req);
    const { players = [], version = 0 } = readState();
    const collections = db.prepare('SELECT * FROM collections ORDER BY rowid').all().map(r => {
      try {
        return {
          key: r.key, name: r.name, source: r.source, id: r.col_id,
          color: r.color, cards: JSON.parse(r.cards_json || '{}'),
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

    res.json({ collections, players: visiblePlayers, version, deckCardCounts });
  } catch (e) {
    console.error('GET /api/state error:', e.message);
    res.json({ collections: [], players: [], version: 0, deckCardCounts: {} });
  }
});

// ── POST /api/state ────────────────────────────────────────────────────────────
router.post('/state', requireAuth, express.json({ limit: '10mb' }), (req, res) => {
  const sess    = getSession(req);
  const current = readState();
  const players = req.body.players || [];
  if (sess.role !== 'admin') {
    const curIds = new Set((current.players || []).map(p => p.id));
    const incIds = new Set(players.map(p => p.id));
    if (curIds.size !== incIds.size || [...curIds].some(id => !incIds.has(id)))
      return res.status(403).json({ error: 'Forbidden' });
    for (const cp of (current.players || [])) {
      if (cp.id === sess.playerId) continue;
      const ip = players.find(p => p.id === cp.id);
      // Non-admins may only change their own player: any other player's name,
      // color, want list or decks must be untouched (value-equal after
      // normalisation), not just their decks.
      if (!ip || !deepEqual(normalizePlayer(cp), normalizePlayer(ip)))
        return res.status(403).json({ error: 'Forbidden' });
    }
  }
  try {
    const clientVersion = typeof req.body.version === 'number' ? req.body.version : undefined;
    const newVersion    = writeState({ ...current, players }, clientVersion);
    disownGonePlayers(players);
    res.json({ ok: true, version: newVersion });
  } catch (e) {
    if (e.status === 409) return res.status(409).json({ error: 'Conflict: state was modified by another session. Please refresh.' });
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/players/:playerId/decks ───────────────────────────────────────────
router.put('/players/:playerId/decks', requirePlayerAccess, express.json({ limit: '1mb' }), (req, res) => {
  const { decks } = req.body || {};
  if (!Array.isArray(decks)) return res.status(400).json({ error: 'decks array required' });
  const appState = readState();
  const player   = appState.players.find(p => p.id === req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  player.decks = decks;
  const version = writeState(appState);
  res.json({ ok: true, version });
});

// ── Want list endpoints ────────────────────────────────────────────────────────
router.post('/players/:playerId/wants', requirePlayerAccess, express.json(), (req, res) => {
  const { cardName } = req.body || {};
  if (!cardName?.trim()) return res.status(400).json({ error: 'cardName required' });
  const appState = readState();
  const player   = appState.players.find(p => p.id === req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  if (!player.wantList) player.wantList = [];
  const name = cardName.trim();
  let version = appState.version || 0;
  if (!player.wantList.includes(name)) { player.wantList.push(name); version = writeState(appState); }
  res.json({ ok: true, version });
});

router.delete('/players/:playerId/wants/:cardName', requirePlayerAccess, (req, res) => {
  const name     = decodeURIComponent(req.params.cardName);
  const appState = readState();
  const player   = appState.players.find(p => p.id === req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  player.wantList = (player.wantList || []).filter(c => c !== name);
  const version = writeState(appState);
  res.json({ ok: true, version });
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

router.post('/collections', requireAuth, express.json({ limit: '10mb' }), (req, res) => {
  const { key, name, source, id, color, cards, entries, total, savedAt } = req.body || {};
  if (!key || !name || !source) return res.status(400).json({ error: 'key, name, source required' });
  /* Whether the owner was *said*, not what it came out as. This route is the
   * whole-collection write — adding one, refreshing one, re-importing a CSV —
   * and a client that does not mention the owner must not have it cleared as
   * a side effect of a refresh. So an absent field leaves the column alone,
   * and only a stated one (a player, or null for the group) writes it. */
  const given = Object.prototype.hasOwnProperty.call(req.body || {}, 'owner');
  const owner = given ? readOwner(req.body.owner) : null;
  if (owner === false) return res.status(400).json({ error: 'Unknown player' });
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
      cards: JSON.stringify(cards || {}), entries: entries || 0,
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
  const key   = decodeURIComponent(req.params.key);
  const owner = readOwner((req.body || {}).owner);
  if (owner === false) return res.status(400).json({ error: 'Unknown player' });
  const { changes } = db.prepare('UPDATE collections SET owner_player_id = ? WHERE key = ?').run(owner, key);
  if (!changes) return res.status(404).json({ error: 'Collection not found' });
  res.json({ ok: true, owner });
});

router.delete('/collections/:key', requireAuth, (req, res) => {
  db.prepare('DELETE FROM collections WHERE key = ?').run(decodeURIComponent(req.params.key));
  res.json({ ok: true });
});

module.exports = { router, createLinkedPlayer, readState, writeState };
