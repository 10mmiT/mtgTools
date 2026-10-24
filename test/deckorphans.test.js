/* A deck no player lists any more takes its rows with it.
 *
 * A deck is a record in the app_state blob, and its cards, piles and history
 * are rows keyed by its id with no table behind it. Removing a deck, or a
 * player and every deck of theirs, only ever rewrote the blob — so the rows
 * stayed, for ever, under an id nothing would ask about again. What is
 * asserted is that a whole-state write removes them, and that the one case
 * that looks like a removal from a single player's side — a deck moved to
 * another player in the same write — removes nothing.
 */

'use strict';

const { test, beforeEach, after } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const os       = require('node:os');
const path     = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgorphans-'));
process.env.DATA_FILE              = path.join(tmpDir, 'state.json');
process.env.ADMIN_PASSWORD         = 'testpass';
process.env.PORT                   = '0';
process.env.AUTH_RATE_LIMIT_MAX    = '1000';
process.env.MTGTOOLS_NO_BACKGROUND = '1';

const { app, server: getServer } = require('../server');
const request = require('supertest')(app);

// Requiring the server starts it listening; close it so the run ends by itself.
after(() => new Promise(done => getServer().close(() => done())));
const { db }  = require('../available-db');

const deck = id => ({ id, name: id });
const P1 = (decks) => ({ id: 'p1', name: 'One', colorIdx: 0, wantList: [], decks: decks.map(deck) });
const P2 = (decks) => ({ id: 'p2', name: 'Two', colorIdx: 1, wantList: [], decks: decks.map(deck) });

let cookie;
async function save(players) {
  const version = (await request.get('/api/state').set('Cookie', cookie)).body.version;
  const res = await request.post('/api/state').set('Cookie', cookie).send({ players, version });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

function plant(deckId) {
  db.prepare("INSERT INTO deck_cards (deck_id, card_name, qty) VALUES (?, 'Sol Ring', 1)").run(deckId);
  db.prepare("INSERT INTO deck_categories (deck_id, name) VALUES (?, 'Ramp')").run(deckId);
  db.prepare("INSERT INTO deck_snapshots (deck_id, taken_at, reason, state_json) VALUES (?, ?, 'edit', '{}')")
    .run(deckId, Date.now());
}
/** The row deck-history.js deckDeleted() leaves: what the deck was as it went. */
const tombstone = (deckId, takenAt) => db.prepare(
  "INSERT INTO deck_snapshots (deck_id, taken_at, reason, state_json) VALUES (?, ?, 'deck-delete', '{}')"
).run(deckId, takenAt);
const rows = (table, deckId) =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE deck_id = ?`).get(deckId).n;
const has = deckId => ['deck_cards', 'deck_categories', 'deck_snapshots'].map(t => rows(t, deckId));

beforeEach(async () => {
  db.exec(`DELETE FROM app_state WHERE key = 'state'; DELETE FROM deck_cards;
           DELETE FROM deck_categories; DELETE FROM deck_snapshots;`);
  const res = await request.post('/api/auth/login').send({ username: 'admin', password: 'testpass' });
  cookie = [].concat(res.headers['set-cookie'])[0].split(';')[0];
  await save([P1(['d1', 'd2']), P2(['d3'])]);
  for (const id of ['d1', 'd2', 'd3']) plant(id);
});

test('a deck taken off its player’s list loses its cards, piles and history', async () => {
  await save([P1(['d2']), P2(['d3'])]);
  assert.deepEqual(has('d1'), [0, 0, 0]);
  assert.deepEqual(has('d2'), [1, 1, 1], 'a deck still listed lost its rows');
});

test('a removed player’s decks go with them', async () => {
  await save([P1(['d1', 'd2'])]);
  assert.deepEqual(has('d3'), [0, 0, 0]);
  assert.deepEqual(has('d1'), [1, 1, 1]);
});

test('a deck moved to another player in the same write keeps everything', async () => {
  await save([P1(['d1']), P2(['d3', 'd2'])]);
  assert.deepEqual(has('d2'), [1, 1, 1]);
});

test('and so does one moved off a removed player onto one who stays', async () => {
  await save([P2(['d3', 'd1', 'd2'])]);
  for (const id of ['d1', 'd2', 'd3']) assert.deepEqual(has(id), [1, 1, 1], id);
});

test('the snapshot a deleted deck left for its re-add is kept while it is young', async () => {
  tombstone('d1', Date.now());
  tombstone('d2', Date.now() - 400 * 24 * 60 * 60 * 1000);
  await save([P2(['d3'])]);
  assert.deepEqual(has('d1'), [0, 0, 1], 'the deck-delete row went with the rest');
  assert.equal(db.prepare("SELECT reason FROM deck_snapshots WHERE deck_id = 'd1'").get().reason, 'deck-delete');
  assert.deepEqual(has('d2'), [0, 0, 0], 'a year-old tombstone outlived the age cap');
});

test('replacing one player’s deck list cleans up the same way', async () => {
  const version = (await request.get('/api/state').set('Cookie', cookie)).body.version;
  const res = await request.put('/api/players/p1/decks').set('Cookie', cookie)
    .send({ decks: [deck('d2')], version });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(has('d1'), [0, 0, 0]);
  assert.deepEqual(has('d2'), [1, 1, 1]);
});
