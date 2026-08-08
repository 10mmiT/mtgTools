/* The card cache's shape (ticket 01, spec-deckbuilder-depth §Dependencies).
 *
 * `trimCard()` throws away most of the Scryfall bulk file and keeps what the
 * client uses. Three facts it used to throw away — format legality, Wizards'
 * Game Changers flag, and what mana a card produces — are the inputs to the
 * legality line, the bracket estimate and the mana-base panel, so they are
 * kept now.
 *
 * The interesting half of this is not the three lines that keep them. It is
 * that the refresh skips the download when Scryfall's timestamp is unchanged,
 * so a build that changes the shape has no way to reach an install whose cache
 * already believes it is current: every row would keep the old shape, and the
 * feature reading a new field would see `undefined` from a database reporting
 * itself up to date. The shape carries a version of its own for that reason,
 * and the tests below are mostly about it — that it forces a re-import on its
 * own, that a run dying halfway does not claim one happened, and that rows
 * still in the old shape read as "we don't know" rather than throwing.
 *
 * Scryfall is stubbed: the fixtures are real card objects taken from the
 * oracle_cards bulk file, trimmed to the fields these tests care about.
 */

'use strict';

const { test, describe, before, beforeEach, after } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const os       = require('node:os');
const path     = require('node:path');
const { Readable } = require('node:stream');

// A cache of our own, in a temp dir. DATA_FILE names a file whose *directory*
// becomes the data dir, and scryfall-db reads it at require time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgcache-'));
process.env.DATA_FILE = path.join(tmpDir, 'state.json');

const scrydb = require('../scryfall-db');
const { trimCard, SHAPE_VERSION, refreshBulk, getCard, getCollection, db } = scrydb;

// ── Fixtures ──────────────────────────────────────────────────────────────
// Real Scryfall objects, cut down. Between them they cover every answer the
// three new fields can give: legal, banned, restricted and not_legal; a Game
// Changer and three cards that are not; mana produced by a land, by a
// non-land, and by neither.
const RHYSTIC_STUDY = {
  id: 'f1f1f6a4-0000-4000-8000-000000000001', oracle_id: 'aaaa0001',
  name: 'Rhystic Study', layout: 'normal', mana_cost: '{2}{U}', cmc: 3,
  type_line: 'Enchantment', colors: ['U'], color_identity: ['U'], rarity: 'common',
  game_changer: true,
  legalities: { standard: 'not_legal', modern: 'not_legal', legacy: 'legal', vintage: 'legal',
                commander: 'legal', paupercommander: 'banned', duel: 'legal' },
};
const SOL_RING = {
  id: 'f1f1f6a4-0000-4000-8000-000000000002', oracle_id: 'aaaa0002',
  name: 'Sol Ring', layout: 'normal', mana_cost: '{1}', cmc: 1,
  type_line: 'Artifact', colors: [], color_identity: [], rarity: 'uncommon',
  game_changer: false, produced_mana: ['C'],
  legalities: { standard: 'not_legal', modern: 'not_legal', legacy: 'banned', vintage: 'restricted',
                commander: 'legal', paupercommander: 'not_legal', duel: 'banned' },
};
const ISLAND = {
  id: 'f1f1f6a4-0000-4000-8000-000000000003', oracle_id: 'aaaa0003',
  name: 'Island', layout: 'normal', mana_cost: '', cmc: 0,
  type_line: 'Basic Land — Island', colors: [], color_identity: ['U'], rarity: 'common',
  game_changer: false, produced_mana: ['U'],
  legalities: { standard: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal',
                commander: 'legal', paupercommander: 'legal', duel: 'legal' },
};
const LIGHTNING_BOLT = {
  id: 'f1f1f6a4-0000-4000-8000-000000000004', oracle_id: 'aaaa0004',
  name: 'Lightning Bolt', layout: 'normal', mana_cost: '{R}', cmc: 1,
  type_line: 'Instant', colors: ['R'], color_identity: ['R'], rarity: 'common',
  game_changer: false,
  legalities: { standard: 'not_legal', modern: 'legal', legacy: 'legal', vintage: 'legal',
                commander: 'legal', paupercommander: 'legal', duel: 'legal' },
};
const BULK = [RHYSTIC_STUDY, SOL_RING, ISLAND, LIGHTNING_BOLT];

// ── A stubbed Scryfall ────────────────────────────────────────────────────
// Two fetches per refresh: the bulk index, then the file itself. The stub
// counts downloads, because "did this refresh actually re-import?" is the
// question most of these tests ask.
const UPDATED_AT = '2026-08-07T09:02:54.151+00:00';
let realFetch;

function stubScryfall({ updatedAt = UPDATED_AT, cards = BULK } = {}) {
  const calls = { index: 0, download: 0 };
  global.fetch = async (url) => {
    if (String(url).includes('api.scryfall.com/bulk-data')) {
      calls.index++;
      return { ok: true, json: async () => ({ data: [{
        type: 'oracle_cards', updated_at: updatedAt,
        // No .gz suffix: the importer only gunzips when the URL says so, and
        // these fixtures are small enough to hand over as plain text.
        jsonl_download_uri: 'https://data.scryfall.test/oracle-cards.jsonl',
        compressed_size: 1234,
      }] }) };
    }
    calls.download++;
    const body = cards.map(c => JSON.stringify(c)).join('\n') + '\n';
    return { ok: true, body: Readable.toWeb(Readable.from([Buffer.from(body)])) };
  };
  return calls;
}

const getMeta = key => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
const setMeta = (key, value) => db.prepare(
  `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
).run(key, value);

before(() => { realFetch = global.fetch; });
after(() => { global.fetch = realFetch; fs.rmSync(tmpDir, { recursive: true, force: true }); });
beforeEach(() => { db.exec('DELETE FROM cards; DELETE FROM meta;'); });

// ── The three new facts ───────────────────────────────────────────────────

describe('the trimmed card shape', () => {
  test('legality survives the trim, exactly as Scryfall states it', () => {
    // Verbatim, including the not_legal entries: the client falls back to
    // api.scryfall.com for cards this cache misses, and one lookup must not
    // answer differently from the other.
    assert.deepEqual(trimCard(SOL_RING).legalities, SOL_RING.legalities);
    assert.equal(trimCard(SOL_RING).legalities.vintage, 'restricted');
    assert.equal(trimCard(SOL_RING).legalities.legacy, 'banned');
    assert.equal(trimCard(RHYSTIC_STUDY).legalities.paupercommander, 'banned');
  });

  test('a Game Changer reads as one, and a card that is not does not', () => {
    assert.equal(trimCard(RHYSTIC_STUDY).game_changer, true);
    assert.equal(trimCard(SOL_RING).game_changer, false);
    assert.equal(trimCard(LIGHTNING_BOLT).game_changer, false);
  });

  test('produced_mana is kept for lands and for mana-producing non-lands alike', () => {
    assert.deepEqual(trimCard(ISLAND).produced_mana, ['U']);        // a land
    assert.deepEqual(trimCard(SOL_RING).produced_mana, ['C']);      // an artifact
    // Absent on a card that makes no mana — which is Scryfall's own shape,
    // not an omission of ours.
    assert.equal(trimCard(LIGHTNING_BOLT).produced_mana, undefined);
  });

  test('the fields the cache already carried are untouched', () => {
    const c = trimCard(SOL_RING);
    assert.equal(c.name, 'Sol Ring');
    assert.equal(c.cmc, 1);
    assert.equal(c.type_line, 'Artifact');
    assert.equal(c.object, 'card');
  });
});

describe('an imported card', () => {
  test('carries the three facts back out of SQLite', async () => {
    stubScryfall();
    const r = await refreshBulk();
    assert.equal(r.imported, BULK.length);

    const solRing = getCard('Sol Ring');
    assert.equal(solRing.legalities.commander, 'legal');
    assert.equal(solRing.legalities.legacy, 'banned');
    assert.equal(solRing.game_changer, false);
    assert.deepEqual(solRing.produced_mana, ['C']);

    assert.equal(getCard('Rhystic Study').game_changer, true);
    assert.deepEqual(getCard('Island').produced_mana, ['U']);
  });

  test('carries them through a collection lookup too', async () => {
    stubScryfall();
    await refreshBulk();
    const { data } = getCollection(['Island', 'Rhystic Study']);
    assert.deepEqual(data.map(c => c.produced_mana ?? null), [['U'], null]);
    assert.deepEqual(data.map(c => c.game_changer), [false, true]);
  });
});

// ── The version marker ────────────────────────────────────────────────────

describe('the shape version', () => {
  test('is recorded when an import finishes', async () => {
    stubScryfall();
    await refreshBulk();
    assert.equal(getMeta('shape_version'), String(SHAPE_VERSION));
  });

  test('lets an unchanged bulk file skip the download', async () => {
    const calls = stubScryfall();
    await refreshBulk();
    assert.equal(calls.download, 1);

    const again = await refreshBulk();
    assert.equal(again.upToDate, true);
    assert.equal(calls.download, 1, 'nothing upstream changed, so nothing was downloaded');
  });

  test('forces a re-import when it moves, though the bulk file has not', async () => {
    const calls = stubScryfall();
    await refreshBulk();
    assert.equal(calls.download, 1);

    // What an upgrade looks like from the database's side: same Scryfall
    // timestamp, same rows, a build that wants a shape they are not in.
    setMeta('shape_version', String(SHAPE_VERSION - 1));
    const r = await refreshBulk();
    assert.equal(r.upToDate, undefined, 'a stale shape is not "up to date"');
    assert.equal(r.imported, BULK.length);
    assert.equal(calls.download, 2, 'the shape moved, so the file came down again');
    assert.equal(getMeta('shape_version'), String(SHAPE_VERSION));
  });

  test('treats a cache from before the marker existed as stale', async () => {
    // An install upgrading from a build that never wrote the key at all. This
    // is the one that matters in the field: it has to re-import with no-one
    // running anything by hand.
    const calls = stubScryfall();
    await refreshBulk();
    db.prepare(`DELETE FROM meta WHERE key = 'shape_version'`).run();

    const r = await refreshBulk();
    assert.equal(r.imported, BULK.length);
    assert.equal(calls.download, 2);
    assert.equal(getMeta('shape_version'), String(SHAPE_VERSION));
  });

  test('is not claimed by an import that failed', async () => {
    global.fetch = async (url) => {
      if (String(url).includes('api.scryfall.com/bulk-data')) {
        return { ok: true, json: async () => ({ data: [{
          type: 'oracle_cards', updated_at: UPDATED_AT,
          jsonl_download_uri: 'https://data.scryfall.test/oracle-cards.jsonl',
        }] }) };
      }
      return { ok: false, status: 503, body: null };
    };
    const r = await refreshBulk();
    assert.ok(r.error, 'the download failed');
    assert.equal(getMeta('shape_version'), null, 'so the shape is not recorded as current');

    // And the next run — the one that can reach Scryfall — does the import.
    const calls = stubScryfall();
    await refreshBulk();
    assert.equal(calls.download, 1);
    assert.equal(getMeta('shape_version'), String(SHAPE_VERSION));
  });
});

// ── A cache that is halfway there ─────────────────────────────────────────

describe('a row written by an older build', () => {
  // The re-import is not instant: it downloads 24 MB in the background while
  // the app serves requests, so for the first minutes after an upgrade every
  // row is one of these.
  const OLD_SHAPE = { object: 'card', id: 'old', name: 'Counterspell', type_line: 'Instant',
                      mana_cost: '{U}{U}', cmc: 2, colors: ['U'], color_identity: ['U'] };

  beforeEach(() => {
    db.prepare('INSERT INTO cards (name, front_name, type_line, json) VALUES (?, ?, ?, ?)')
      .run(OLD_SHAPE.name, null, OLD_SHAPE.type_line, JSON.stringify(OLD_SHAPE));
  });

  test('reads back without throwing, with the missing facts as "we know of none"', () => {
    const card = getCard('Counterspell');
    assert.deepEqual(card.legalities, {});
    assert.equal(card.game_changer, false);
    // The reads a consumer will actually write, none of which may throw.
    assert.equal(card.legalities.commander, undefined, 'unknown, not "not_legal"');
    assert.deepEqual(card.produced_mana ?? [], []);
  });

  test('is never mistaken for a banned card or a Game Changer', () => {
    const card = getCard('Counterspell');
    assert.notEqual(card.legalities.commander, 'banned');
    assert.equal(card.game_changer, false);
  });

  test('degrades the same way through a collection lookup', () => {
    const { data } = getCollection(['Counterspell']);
    assert.equal(data.length, 1);
    assert.deepEqual(data[0].legalities, {});
    assert.equal(data[0].game_changer, false);
  });

  test('is replaced, not patched, once the re-import runs', async () => {
    stubScryfall({ cards: [...BULK, { ...LIGHTNING_BOLT, name: 'Counterspell',
      legalities: { commander: 'legal' }, game_changer: false }] });
    await refreshBulk();
    assert.deepEqual(getCard('Counterspell').legalities, { commander: 'legal' });
  });
});
