'use strict';
// ── Scryfall bulk-data cache ───────────────────────────────────────────────────
// Downloads Scryfall's "oracle_cards" bulk file (one entry per card name,
// ~35k cards) into a local SQLite database and refreshes it daily. The
// /api/cards/* endpoints (routes/cards.js) serve card lookups + autocomplete
// from this DB so the client barely needs to talk to Scryfall directly —
// per Scryfall's own guidance for high-volume consumers:
// https://scryfall.com/docs/api/bulk-data
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const readline = require('readline');
const { Readable } = require('stream');

const dataDir = path.dirname(process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json'));
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'scryfall.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    name       TEXT PRIMARY KEY COLLATE NOCASE,
    front_name TEXT COLLATE NOCASE,
    type_line  TEXT NOT NULL DEFAULT '',
    json       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cards_front ON cards(front_name);
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

const BULK_INDEX_URL = 'https://api.scryfall.com/bulk-data';
const BULK_TYPE      = 'oracle_cards';
const REFRESH_MS     = 24 * 60 * 60 * 1000;

let _refreshing = false;

// Keep only the fields the client actually uses — cuts the DB (and response
// payloads) to a fraction of the full bulk file.
function trimImageUris(u) {
  if (!u) return undefined;
  return { small: u.small, normal: u.normal, large: u.large, art_crop: u.art_crop };
}

function trimCard(c) {
  return {
    object:            'card',
    id:                c.id,
    oracle_id:         c.oracle_id,
    name:              c.name,
    layout:            c.layout,
    mana_cost:         c.mana_cost,
    cmc:               c.cmc,
    type_line:         c.type_line,
    oracle_text:       c.oracle_text,
    colors:            c.colors,
    color_identity:    c.color_identity,
    power:             c.power,
    toughness:         c.toughness,
    rarity:            c.rarity,
    set:               c.set,
    set_name:          c.set_name,
    collector_number:  c.collector_number,
    scryfall_uri:      c.scryfall_uri,
    rulings_uri:       c.rulings_uri,
    prints_search_uri: c.prints_search_uri,
    prices:            c.prices ? { usd: c.prices.usd, usd_foil: c.prices.usd_foil, eur: c.prices.eur, eur_foil: c.prices.eur_foil } : undefined,
    image_uris:        trimImageUris(c.image_uris),
    card_faces:        c.card_faces?.map(f => ({
      name:        f.name,
      mana_cost:   f.mana_cost,
      type_line:   f.type_line,
      oracle_text: f.oracle_text,
      colors:      f.colors,
      power:       f.power,
      toughness:   f.toughness,
      image_uris:  trimImageUris(f.image_uris),
    })),
  };
}

const _upsert = db.prepare(`
  INSERT INTO cards (name, front_name, type_line, json) VALUES (?, ?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET front_name = excluded.front_name,
    type_line = excluded.type_line, json = excluded.json
`);
const _setMeta = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
const _getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');

function getMeta(key) { return _getMeta.get(key)?.value ?? null; }

// ── Bulk download + import ────────────────────────────────────────────────────
// Scryfall bulk files are a JSON array with one card object per line, so we
// stream line-by-line instead of JSON.parse-ing a ~150MB string (which would
// spike memory well past what a small container has).
async function refreshBulk(force = false) {
  if (_refreshing) return { skipped: 'already refreshing' };
  _refreshing = true;
  try {
    const idxRes = await fetch(BULK_INDEX_URL, { headers: { 'User-Agent': 'MTGTools/1.0' } });
    if (!idxRes.ok) throw new Error(`bulk index HTTP ${idxRes.status}`);
    const idx   = await idxRes.json();
    const entry = (idx.data || []).find(d => d.type === BULK_TYPE);
    if (!entry) throw new Error(`no "${BULK_TYPE}" entry in bulk index`);

    if (!force && getMeta('updated_at') === entry.updated_at && cardCount() > 0) {
      console.log('[scryfall-db] bulk data already up to date');
      return { upToDate: true };
    }

    console.log(`[scryfall-db] downloading ${BULK_TYPE} (${Math.round((entry.size || 0) / 1e6)} MB)…`);
    const res = await fetch(entry.download_uri, { headers: { 'User-Agent': 'MTGTools/1.0' } });
    if (!res.ok || !res.body) throw new Error(`bulk download HTTP ${res.status}`);

    const rl = readline.createInterface({ input: Readable.fromWeb(res.body), crlfDelay: Infinity });
    let batch = [], imported = 0, failed = 0;
    const insertBatch = db.transaction(rows => { for (const r of rows) _upsert.run(...r); });

    for await (let line of rl) {
      line = line.trim();
      if (!line.startsWith('{')) continue;           // skip "[" / "]" array delimiters
      if (line.endsWith(',')) line = line.slice(0, -1);
      let card;
      try { card = JSON.parse(line); } catch { failed++; continue; }
      if (!card?.name) continue;
      const front = card.card_faces?.[0]?.name || null;
      batch.push([card.name, front !== card.name ? front : null, card.type_line || '', JSON.stringify(trimCard(card))]);
      if (batch.length >= 1000) { insertBatch(batch); imported += batch.length; batch = []; }
    }
    if (batch.length) { insertBatch(batch); imported += batch.length; }

    if (imported === 0) throw new Error(`imported 0 cards (${failed} unparseable lines) — file format changed?`);
    _setMeta.run('updated_at', entry.updated_at);
    _setMeta.run('imported_at', new Date().toISOString());
    console.log(`[scryfall-db] imported ${imported.toLocaleString()} cards${failed ? ` (${failed} lines skipped)` : ''}`);
    return { imported, failed };
  } catch (e) {
    console.error(`[scryfall-db] refresh failed: ${e.message}`);
    return { error: e.message };
  } finally {
    _refreshing = false;
  }
}

function cardCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
}

function isReady() { return cardCount() > 0; }

// ── Lookups ───────────────────────────────────────────────────────────────────
const _byName  = db.prepare('SELECT json FROM cards WHERE name = ?');
const _byFront = db.prepare('SELECT json FROM cards WHERE front_name = ?');

function getCard(name) {
  const row = _byName.get(name) || _byFront.get(name) ||
              (name.includes(' // ') ? (_byName.get(name.split(' // ')[0]) || _byFront.get(name.split(' // ')[0])) : null);
  return row ? JSON.parse(row.json) : null;
}

// Mimics Scryfall's POST /cards/collection response shape
function getCollection(names) {
  const data = [], notFound = [];
  for (const name of names) {
    if (typeof name !== 'string' || !name.trim()) continue;
    const card = getCard(name.trim());
    if (card) data.push(card);
    else notFound.push(name);
  }
  return { data, not_found: notFound };
}

// Prefix matches first (shortest names first, like Scryfall), then
// contains-matches to fill up to the limit.
const _acPrefix = db.prepare(`
  SELECT name FROM cards WHERE name LIKE ? ESCAPE '\\'
  ORDER BY length(name) LIMIT ?
`);
const _acContains = db.prepare(`
  SELECT name FROM cards WHERE name LIKE ? ESCAPE '\\' AND name NOT LIKE ? ESCAPE '\\'
  ORDER BY length(name) LIMIT ?
`);
// Commander filter mirrors the previous live query (+t:legendary+t:creature)
const _acPrefixCmd = db.prepare(`
  SELECT name FROM cards WHERE name LIKE ? ESCAPE '\\'
    AND type_line LIKE '%Legendary%' AND type_line LIKE '%Creature%'
  ORDER BY length(name) LIMIT ?
`);
const _acContainsCmd = db.prepare(`
  SELECT name FROM cards WHERE name LIKE ? ESCAPE '\\' AND name NOT LIKE ? ESCAPE '\\'
    AND type_line LIKE '%Legendary%' AND type_line LIKE '%Creature%'
  ORDER BY length(name) LIMIT ?
`);

function escLike(s) { return s.replace(/[\\%_]/g, ch => '\\' + ch); }

function autocomplete(q, { commander = false, limit = 12 } = {}) {
  q = (q || '').trim();
  if (q.length < 2) return [];
  const esc      = escLike(q);
  const prefix   = commander ? _acPrefixCmd : _acPrefix;
  const contains = commander ? _acContainsCmd : _acContains;
  const out = prefix.all(`${esc}%`, limit).map(r => r.name);
  if (out.length < limit) {
    for (const r of contains.all(`%${esc}%`, `${esc}%`, limit - out.length)) out.push(r.name);
  }
  return out;
}

// ── Scheduling ────────────────────────────────────────────────────────────────
function init() {
  const n = cardCount();
  console.log(`[scryfall-db] SQLite database: ${dbPath} (${n.toLocaleString()} cards cached)`);
  // Refresh in the background — never block server startup
  refreshBulk().catch(() => {});
  setInterval(() => refreshBulk().catch(() => {}), REFRESH_MS).unref();
}

module.exports = { db, init, refreshBulk, isReady, cardCount, getCard, getCollection, autocomplete };
