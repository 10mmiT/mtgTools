/* Whose is it — the write side of every shared thing, held to its owner.
 *
 * An audit reproduced five holes, and each describe below is one of them,
 * closed, over a real server in account mode:
 *
 *   1. a deck's cards, categories and history could be written by any player
 *      who put their own id in the URL — nothing tied the deck to them;
 *   2. listing a neighbour's deck id under your own player made you its owner
 *      as far as the read guard could tell, private deck and all;
 *   3. any player could edit, delete or give away anybody's collection;
 *   4. a player could rename themselves to somebody else's name, and the
 *      calendar authorises by name;
 *   5. ids, colours, counts and picture URLs were stored as sent and drawn
 *      into markup unescaped.
 *
 * Each also proves the legitimate flow beside the hole still works: your own
 * deck made and saved the way the tab does it, a group collection edited by
 * anyone, an admin doing what an admin does. The last describe is the browser
 * half of 5 — the shipped js/state.js, js/players.js and js/card.js in a vm
 * sandbox, drawing hostile values that the server would now refuse but that a
 * database written before the refusal may still hold.
 */
'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert    = require('node:assert/strict');
const supertest = require('supertest');
const fs        = require('node:fs');
const path      = require('node:path');
const os        = require('node:os');
const vm        = require('node:vm');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgownership-'));
process.env.DATA_FILE      = path.join(tmpDir, 'state.json');
process.env.ADMIN_PASSWORD = 'testpass';
process.env.PORT           = '0';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.MTGTOOLS_NO_BACKGROUND = '1';

const dbModule = require('../available-db');
const { app }  = require('../server');
const request  = supertest(app);
const db       = dbModule.db;

async function loginAs(username, password) {
  const res = await request.post('/api/auth/login').send({ username, password });
  const setCookie = res.headers['set-cookie'];
  assert.ok(setCookie, `${username} could not log in`);
  return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
}

// ── The house ─────────────────────────────────────────────────────────────
// Alice and Bob are real accounts, made through the admin API the way the
// Admin tab makes them, so each is linked to a player createLinkedPlayer made.
let adminCookie, aliceCookie, bobCookie, ALICE, BOB;

const BOB_PUBLIC  = 'd_1780000000001';
const BOB_PRIVATE = 'd_1780000000002';
const ALICE_DECK  = 'd_1780000000003';

const seedPlayers = () => [
  { id: ALICE, name: 'Alice', colorIdx: 0, wantList: [], folders: [], decks: [
    { id: ALICE_DECK, source: 'manual', name: 'Alice’s deck', private: false },
  ] },
  { id: BOB, name: 'Bob', colorIdx: 1, wantList: [], folders: [], decks: [
    { id: BOB_PUBLIC,  source: 'manual', name: 'Bob’s public',  private: false },
    { id: BOB_PRIVATE, source: 'manual', name: 'Bob’s private', private: true },
  ] },
];

const BOB_CARDS = [{ card_name: 'Sol Ring', qty: 1, category: 'Ramp', position: 0 }];
const BOB_CATS  = [{ name: 'Ramp', position: 0 }];

before(async () => {
  adminCookie = await loginAs('admin', 'testpass');
  for (const username of ['alice', 'bob']) {
    const res = await request.post('/api/admin/users').set('Cookie', adminCookie)
      .send({ username, password: `${username}pw`, role: 'player' });
    assert.equal(res.status, 200, res.text);
  }
  const users = Object.fromEntries(db.prepare('SELECT username, player_id FROM users').all()
    .map(u => [u.username, u.player_id]));
  ALICE = users.alice;
  BOB   = users.bob;
  assert.ok(ALICE && BOB, 'both accounts were given a player');
  aliceCookie = await loginAs('alice', 'alicepw');
  bobCookie   = await loginAs('bob', 'bobpw');
});

const history = require('../deck-history');

beforeEach(async () => {
  db.exec(`
    DELETE FROM app_state; DELETE FROM deck_cards; DELETE FROM deck_categories;
    DELETE FROM deck_snapshots; DELETE FROM collections; DELETE FROM collection_imports;
    DELETE FROM availability;
    DELETE FROM users WHERE username NOT IN ('admin', 'alice', 'bob');
  `);
  db.prepare("INSERT INTO app_state (key, value_json, version) VALUES ('state', ?, 0)")
    .run(JSON.stringify({ players: seedPlayers() }));
  for (const id of [BOB_PUBLIC, BOB_PRIVATE, ALICE_DECK, 'd_new_alice', 'deck_unlisted']) history._forget(id);

  // Bob builds both his decks the way the tab does: his own player, his own
  // deck, a full-replace save. Twice, so each has a history row to lose.
  for (const deck of [BOB_PUBLIC, BOB_PRIVATE]) {
    let res = await request.put(`/api/players/${BOB}/decks/${deck}/cards`).set('Cookie', bobCookie)
      .send({ cards: BOB_CARDS, categories: BOB_CATS });
    assert.equal(res.status, 200, 'the owner saves his own deck');
    res = await request.post(`/api/players/${BOB}/decks/${deck}/snapshots`).set('Cookie', bobCookie)
      .send({ reason: 'import', cards: BOB_CARDS, categories: BOB_CATS });
    assert.equal(res.status, 200, 'and snapshots it');
  }
});

const cardsOf = deckId => db.prepare(
  'SELECT card_name, qty, category FROM deck_cards WHERE deck_id = ? ORDER BY position').all(deckId);
const catsOf  = deckId => db.prepare(
  'SELECT name FROM deck_categories WHERE deck_id = ? ORDER BY position').all(deckId).map(c => c.name);
const snapsOf = deckId => db.prepare('SELECT COUNT(*) AS n FROM deck_snapshots WHERE deck_id = ?').get(deckId).n;
const storedPlayers = () => JSON.parse(db.prepare("SELECT value_json FROM app_state WHERE key = 'state'").get().value_json).players;
// The version the granular deck save has to name, the way the tab names the one it last synced to.
const storedVersion = () => db.prepare("SELECT version FROM app_state WHERE key = 'state'").get().version;

/** The whole-state save the tab makes, with `change` applied to what the
 *  requester was sent — exactly as saveToStorage() sends it back. */
async function saveState(cookie, change) {
  const got = await request.get('/api/state').set('Cookie', cookie);
  const players = got.body.players;
  change(players);
  return request.post('/api/state').set('Cookie', cookie).send({ players, version: got.body.version });
}
const playerIn = (players, id) => players.find(p => p.id === id);

// ── 1 ─────────────────────────────────────────────────────────────────────
describe('a deck is written only by its owner (or an admin)', () => {
  test('Alice cannot replace the cards on Bob’s deck, under her own id or his', async () => {
    const before = cardsOf(BOB_PUBLIC);
    const asHerself = await request.put(`/api/players/${ALICE}/decks/${BOB_PUBLIC}/cards`)
      .set('Cookie', aliceCookie).send({ cards: [], categories: [] });
    assert.equal(asHerself.status, 403, 'her own id in the URL is not his deck');
    const asHim = await request.put(`/api/players/${BOB}/decks/${BOB_PUBLIC}/cards`)
      .set('Cookie', aliceCookie).send({ cards: [], categories: [] });
    assert.equal(asHim.status, 403, 'and his id in the URL is not her');
    assert.deepEqual(cardsOf(BOB_PUBLIC), before, 'Bob’s deck is untouched');
  });

  test('every other write route refuses her too', async () => {
    const base = `/api/players/${ALICE}/decks/${BOB_PUBLIC}`;
    const tries = [
      request.post(`${base}/cards/add`).send({ card_name: 'Black Lotus' }),
      request.delete(`${base}/cards/Sol%20Ring`),
      request.patch(`${base}/cards/Sol%20Ring`).send({ qty: 40 }),
      request.put(`${base}/categories`).send({ categories: [{ name: 'Mine now', position: 0 }] }),
      request.post(`${base}/snapshots`).send({ reason: 'edit', cards: [], categories: [] }),
    ];
    for (const req of tries) assert.equal((await req.set('Cookie', aliceCookie)).status, 403);
    assert.deepEqual(cardsOf(BOB_PUBLIC), [{ card_name: 'Sol Ring', qty: 1, category: 'Ramp' }]);
    assert.deepEqual(catsOf(BOB_PUBLIC), ['Ramp']);
  });

  test('a deck-delete snapshot from Alice does not wipe Bob’s history', async () => {
    const before = snapsOf(BOB_PUBLIC);
    assert.ok(before > 0, 'there is history to lose');
    const res = await request.post(`/api/players/${ALICE}/decks/${BOB_PUBLIC}/snapshots`)
      .set('Cookie', aliceCookie).send({ reason: 'deck-delete', cards: [], categories: [] });
    assert.equal(res.status, 403);
    assert.equal(snapsOf(BOB_PUBLIC), before, 'every row is still there');
  });

  test('a write aimed at a private deck she cannot see is a 404, not a confirmation it exists', async () => {
    const res = await request.put(`/api/players/${ALICE}/decks/${BOB_PRIVATE}/cards`)
      .set('Cookie', aliceCookie).send({ cards: [], categories: [] });
    assert.equal(res.status, 404);
    assert.equal(cardsOf(BOB_PRIVATE).length, 1);
  });

  test('Alice writes her own deck, and a deck id nobody lists yet (the tab saves ahead of the blob)', async () => {
    for (const deck of [ALICE_DECK, 'deck_unlisted']) {
      const res = await request.put(`/api/players/${ALICE}/decks/${deck}/cards`)
        .set('Cookie', aliceCookie).send({ cards: BOB_CARDS, categories: BOB_CATS });
      assert.equal(res.status, 200, deck);
      assert.equal(cardsOf(deck).length, 1);
    }
  });

  test('an admin may write anybody’s deck', async () => {
    const res = await request.put(`/api/players/${BOB}/decks/${BOB_PRIVATE}/cards`)
      .set('Cookie', adminCookie).send({ cards: [], categories: [] });
    assert.equal(res.status, 200);
    assert.equal(cardsOf(BOB_PRIVATE).length, 0);
  });

  test('a deck id two players list (state from before the rule) is nobody’s but an admin’s', async () => {
    // Written straight into the blob, the way a pre-fix spoof would have left it.
    const players = seedPlayers();
    players[0].decks.push({ id: BOB_PRIVATE, source: 'manual', name: 'Spoofed', private: false });
    db.prepare("UPDATE app_state SET value_json = ? WHERE key = 'state'").run(JSON.stringify({ players }));
    const read = await request.get(`/api/players/${ALICE}/decks/${BOB_PRIVATE}/cards`).set('Cookie', aliceCookie);
    assert.equal(read.status, 404, 'her public copy of the listing does not unlock his private deck');
    const write = await request.put(`/api/players/${ALICE}/decks/${BOB_PRIVATE}/cards`)
      .set('Cookie', aliceCookie).send({ cards: [], categories: [] });
    assert.notEqual(write.status, 200);
    assert.equal(cardsOf(BOB_PRIVATE).length, 1);
  });
});

// ── 2 ─────────────────────────────────────────────────────────────────────
describe('a deck id belongs to one player', () => {
  test('Alice cannot list Bob’s public deck under herself', async () => {
    const res = await saveState(aliceCookie, players =>
      playerIn(players, ALICE).decks.push({ id: BOB_PUBLIC, source: 'manual', name: 'Mine now' }));
    assert.equal(res.status, 409);
    assert.deepEqual(playerIn(storedPlayers(), ALICE).decks.map(d => d.id), [ALICE_DECK]);
  });

  test('nor his private one, whose id she was never sent', async () => {
    const res = await saveState(aliceCookie, players =>
      playerIn(players, ALICE).decks.push({ id: BOB_PRIVATE, source: 'manual', name: 'Mine now' }));
    assert.equal(res.status, 409);
    const read = await request.get(`/api/players/${ALICE}/decks/${BOB_PRIVATE}/cards`).set('Cookie', aliceCookie);
    assert.equal(read.status, 404, 'and his private deck stays hidden from her');
  });

  test('nor through the granular deck save', async () => {
    const res = await request.put(`/api/players/${ALICE}/decks`).set('Cookie', aliceCookie)
      .send({ decks: [{ id: ALICE_DECK, source: 'manual', name: 'Alice’s deck' },
                      { id: BOB_PRIVATE, source: 'manual', name: 'Mine now' }],
              version: storedVersion() });
    assert.equal(res.status, 409);
    assert.deepEqual(playerIn(storedPlayers(), ALICE).decks.map(d => d.id), [ALICE_DECK]);
  });

  test('an admin cannot list one deck under two players, but can move one in a single write', async () => {
    const dup = await saveState(adminCookie, players =>
      playerIn(players, ALICE).decks.push({ id: BOB_PUBLIC, source: 'manual', name: 'Copy' }));
    assert.equal(dup.status, 409);

    const move = await saveState(adminCookie, players => {
      const bob = playerIn(players, BOB);
      const deck = bob.decks.find(d => d.id === BOB_PUBLIC);
      bob.decks = bob.decks.filter(d => d !== deck);
      playerIn(players, ALICE).decks.push(deck);
    });
    assert.equal(move.status, 200, move.text);
    const res = await request.put(`/api/players/${ALICE}/decks/${BOB_PUBLIC}/cards`)
      .set('Cookie', aliceCookie).send({ cards: [], categories: [] });
    assert.equal(res.status, 200, 'the deck is hers to write now');
  });

  test('Alice makes a deck of her own the way the tab does, and saves it', async () => {
    const id = 'd_new_alice';
    const made = await request.put(`/api/players/${ALICE}/decks`).set('Cookie', aliceCookie).send({ decks: [
      { id: ALICE_DECK, source: 'manual', name: 'Alice’s deck' },
      { id, source: 'archidekt', deckId: '20254010', url: 'https://archidekt.com/decks/20254010/x',
        deckUrl: 'https://archidekt.com/decks/20254010/x', name: 'New', nameStatus: 'loaded',
        commander: 'Atraxa', commanderImg: 'https://cards.scryfall.io/art_crop/front/a/b/c.jpg?1',
        cardCount: '100', bracket: 3, folderId: null, private: false },
    ], version: storedVersion() });
    assert.equal(made.status, 200, made.text);
    const stored = playerIn(storedPlayers(), ALICE).decks.find(d => d.id === id);
    assert.equal(stored.cardCount, 100, 'a count sent as a numeric string is stored as the number');
    const saved = await request.put(`/api/players/${ALICE}/decks/${id}/cards`).set('Cookie', aliceCookie)
      .send({ cards: BOB_CARDS, categories: BOB_CATS });
    assert.equal(saved.status, 200);
    const back = await request.get(`/api/players/${ALICE}/decks/${id}/cards`).set('Cookie', aliceCookie);
    assert.deepEqual(back.body.cards.map(c => c.card_name), ['Sol Ring']);
  });
});

// ── 3 ─────────────────────────────────────────────────────────────────────
describe('a collection with an owner is its owner’s; one without is the group’s', () => {
  const put = (cookie, body) => request.post('/api/collections').set('Cookie', cookie)
    .send({ name: body.key, source: 'csv-moxfield', cards: {}, ...body });
  const row = key => db.prepare('SELECT name, owner_player_id AS owner FROM collections WHERE key = ?').get(key);

  beforeEach(async () => {
    for (const [key, owner] of [['csv:bob', BOB], ['csv:alice', ALICE], ['csv:group', null]]) {
      const res = await put(adminCookie, { key, owner });
      assert.equal(res.status, 200, res.text);
    }
  });

  test('Alice cannot edit, re-own or delete Bob’s collection', async () => {
    assert.equal((await put(aliceCookie, { key: 'csv:bob', name: 'pwned' })).status, 403);
    assert.equal((await put(aliceCookie, { key: 'csv:bob', name: 'pwned', owner: null })).status, 403);
    for (const owner of [null, ALICE]) {
      const res = await request.put('/api/collections/csv%3Abob/owner').set('Cookie', aliceCookie).send({ owner });
      assert.equal(res.status, 403, `re-owning to ${owner}`);
    }
    assert.equal((await request.delete('/api/collections/csv%3Abob').set('Cookie', aliceCookie)).status, 403);
    assert.deepEqual(row('csv:bob'), { name: 'csv:bob', owner: BOB }, 'Bob’s shelf is as it was');
  });

  test('she can edit the group’s collection, and make it hers — not Bob’s', async () => {
    assert.equal((await put(aliceCookie, { key: 'csv:group', name: 'The house box' })).status, 200);
    assert.equal(row('csv:group').name, 'The house box');
    const toBob = await request.put('/api/collections/csv%3Agroup/owner').set('Cookie', aliceCookie).send({ owner: BOB });
    assert.equal(toBob.status, 403, 'a non-admin may only say a collection is hers or the group’s');
    const toHer = await request.put('/api/collections/csv%3Agroup/owner').set('Cookie', aliceCookie).send({ owner: ALICE });
    assert.equal(toHer.status, 200);
    assert.equal(row('csv:group').owner, ALICE);
  });

  test('she can delete the group’s collection', async () => {
    assert.equal((await request.delete('/api/collections/csv%3Agroup').set('Cookie', aliceCookie)).status, 200);
    assert.equal(row('csv:group'), undefined);
  });

  test('a new collection is hers or the group’s, never somebody else’s', async () => {
    assert.equal((await put(aliceCookie, { key: 'csv:1', owner: BOB })).status, 403);
    assert.equal(row('csv:1'), undefined);
    assert.equal((await put(aliceCookie, { key: 'csv:2', owner: ALICE })).status, 200);
    assert.equal((await put(aliceCookie, { key: 'csv:3', owner: null })).status, 200);
    assert.equal((await put(aliceCookie, { key: 'csv:4' })).status, 200);
  });

  test('her own collection is hers to edit, give to the group and delete', async () => {
    assert.equal((await put(aliceCookie, { key: 'csv:alice', name: 'Binder', owner: ALICE })).status, 200);
    const res = await request.put('/api/collections/csv%3Aalice/owner').set('Cookie', aliceCookie).send({ owner: null });
    assert.equal(res.status, 200);
    assert.equal((await request.delete('/api/collections/csv%3Aalice').set('Cookie', aliceCookie)).status, 200);
  });

  test('an admin may do all of it to Bob’s', async () => {
    assert.equal((await put(adminCookie, { key: 'csv:bob', name: 'Renamed' })).status, 200);
    const res = await request.put('/api/collections/csv%3Abob/owner').set('Cookie', adminCookie).send({ owner: ALICE });
    assert.equal(res.status, 200);
    assert.equal((await request.delete('/api/collections/csv%3Abob').set('Cookie', adminCookie)).status, 200);
  });

  test('an import of Bob’s collection is his: Alice can neither start one over it nor stop it', async () => {
    db.prepare(`INSERT INTO collection_imports (key, name, source, col_id, color, owner_player_id, status)
                VALUES ('archidekt:42', 'Bob’s Archidekt', 'archidekt', '42', '#10b981', ?, 'interrupted')`).run(BOB);
    // Refused before anything is fetched: the guard runs ahead of startImport.
    const start = await request.post('/api/collections/archidekt%3A42/import').set('Cookie', aliceCookie)
      .send({ name: 'x', source: 'archidekt', id: '42', color: '#10b981', owner: null });
    assert.equal(start.status, 403);
    const stop = await request.delete('/api/imports/archidekt%3A42?forget=1').set('Cookie', aliceCookie);
    assert.equal(stop.status, 403);
    assert.ok(db.prepare("SELECT 1 FROM collection_imports WHERE key = 'archidekt:42'").get(), 'the pages are kept');
    const own = await request.delete('/api/imports/archidekt%3A42?forget=1').set('Cookie', bobCookie);
    assert.equal(own.status, 200, 'Bob can stop his own');
  });
});

// ── 4 ─────────────────────────────────────────────────────────────────────
describe('a name belongs to one player', () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  test('Alice cannot rename herself to Bob, however it is spelled — so Bob’s days stay his', async () => {
    const toggled = await request.post('/available/api/calendars/default/toggle').set('Cookie', bobCookie)
      .send({ person_name: 'Bob', date: tomorrow });
    assert.equal(toggled.status, 200, toggled.text);

    for (const name of ['Bob', ' bob ', 'BOB']) {
      const res = await saveState(aliceCookie, players => { playerIn(players, ALICE).name = name; });
      assert.equal(res.status, 409, JSON.stringify(name));
    }
    assert.equal(playerIn(storedPlayers(), ALICE).name, 'Alice');
    const wipe = await request.delete('/available/api/calendars/default/persons/Bob').set('Cookie', aliceCookie);
    assert.equal(wipe.status, 403);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM availability WHERE person_name = 'Bob'").get().n, 1);
  });

  test('a rename to a name nobody has goes through', async () => {
    const res = await saveState(aliceCookie, players => { playerIn(players, ALICE).name = 'Alicia'; });
    assert.equal(res.status, 200, res.text);
    assert.equal(playerIn(storedPlayers(), ALICE).name, 'Alicia');
  });

  test('nor to the username of an account with no player, which the calendar answers to', async () => {
    db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES ('carol', 'x', 'player', NULL)").run();
    const res = await saveState(aliceCookie, players => { playerIn(players, ALICE).name = 'Carol'; });
    assert.equal(res.status, 409);
  });

  test('an admin cannot make a second Bob either, by adding or renaming', async () => {
    const add = await saveState(adminCookie, players =>
      players.push({ id: 'p_1780000000009', name: 'bob', colorIdx: 2, wantList: [], folders: [], decks: [] }));
    assert.equal(add.status, 409);
    const rename = await saveState(adminCookie, players => { playerIn(players, ALICE).name = 'Bob'; });
    assert.equal(rename.status, 409);
    const fine = await saveState(adminCookie, players =>
      players.push({ id: 'p_1780000000009', name: 'Dave', colorIdx: 2, wantList: [], folders: [], decks: [] }));
    assert.equal(fine.status, 200, fine.text);
  });

  test('an account approved without a link never becomes a second player of an existing name', async () => {
    const dave = await saveState(adminCookie, players =>
      players.push({ id: 'p_1780000000010', name: 'Dave', colorIdx: 2, wantList: [], folders: [], decks: [] }));
    assert.equal(dave.status, 200);
    const res = await request.post('/api/admin/users').set('Cookie', adminCookie)
      .send({ username: 'dave', password: 'davepw', role: 'player' });
    assert.equal(res.status, 200, res.text);
    const names = storedPlayers().map(p => p.name).filter(n => /^dave/i.test(n)).sort();
    assert.deepEqual(names, ['Dave', 'Dave 2']);
  });
});

// ── 5 (server) ────────────────────────────────────────────────────────────
describe('what is drawn into markup is refused on the way in', () => {
  const addDeck = (cookie, deck) => saveState(cookie, players =>
    playerIn(players, ALICE).decks.push({ id: 'd_new_alice', source: 'manual', name: 'X', ...deck }));

  test('a deck id, picture, link or count that is not one is a 400', async () => {
    const hostile = [
      { id: "x');alert(1)//" },
      { id: '"><img src=x onerror=alert(1)>' },
      { commanderImg: 'javascript:alert(1)' },
      { commanderImg: "https://cards.scryfall.io/a.jpg');background:url('//evil" },
      { deckUrl: 'javascript:alert(1)' },
      { url: 'data:text/html,<script>alert(1)</script>' },
      { cardCount: '<img src=x onerror=alert(1)>' },
      { folderId: "f');alert(1)//" },
    ];
    for (const deck of hostile) {
      const res = await addDeck(aliceCookie, deck);
      assert.equal(res.status, 400, JSON.stringify(deck));
    }
    assert.deepEqual(playerIn(storedPlayers(), ALICE).decks.map(d => d.id), [ALICE_DECK]);
    // The bracket is cosmetic and arrives from Archidekt as well: a value that
    // is not a number is stored as no bracket, which is how the tab reads it.
    const bracket = await addDeck(aliceCookie, { bracket: '<img src=x onerror=alert(1)>' });
    assert.equal(bracket.status, 200, bracket.text);
    assert.equal(playerIn(storedPlayers(), ALICE).decks.find(d => d.id === 'd_new_alice').bracket, null);
    const granular = await request.put(`/api/players/${ALICE}/decks`).set('Cookie', aliceCookie)
      .send({ decks: [{ id: '<b>', source: 'manual', name: 'X' }], version: storedVersion() });
    assert.equal(granular.status, 400);
  });

  test('an admin is held to the same shapes, for players as well as decks', async () => {
    const res = await addDeck(adminCookie, { commanderImg: 'javascript:alert(1)' });
    assert.equal(res.status, 400);
    const player = await saveState(adminCookie, players =>
      players.push({ id: "p');alert(1)//", name: 'Eve', wantList: [], folders: [], decks: [] }));
    assert.equal(player.status, 400);
    const colour = await saveState(adminCookie, players => { playerIn(players, BOB).color = 'red;x:expression(1)'; });
    assert.equal(colour.status, 400);
  });

  test('a stored deck the client echoes back unchanged is not re-judged', async () => {
    // Written before the rule existed: the save of an unrelated change must not fail over it.
    const players = seedPlayers();
    players[1].decks[0].commanderImg = 'javascript:alert(1)';
    db.prepare("UPDATE app_state SET value_json = ? WHERE key = 'state'").run(JSON.stringify({ players }));
    const res = await saveState(adminCookie, ps => { playerIn(ps, ALICE).name = 'Alicia'; });
    assert.equal(res.status, 200, res.text);
  });

  test('a collection key, colour or count that is not one is a 400', async () => {
    const bad = [
      { key: "csv:1');alert(1)//" },
      { key: 'csv:1', color: 'red' },
      { key: 'csv:1', color: '#fff;background:url(//evil)' },
      { key: 'csv:1', entries: 'many' },
      { key: 'csv:1', source: '<b>' },
      { key: 'csv:1', id: "1'" },
    ];
    for (const body of bad) {
      const res = await request.post('/api/collections').set('Cookie', adminCookie)
        .send({ name: 'X', source: 'csv-moxfield', cards: {}, ...body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    const imp = await request.post('/api/collections/archidekt%3A7/import').set('Cookie', adminCookie)
      .send({ name: 'X', source: 'archidekt', id: '7', color: 'red' });
    assert.equal(imp.status, 400, 'an import is held to the same shapes, before it starts');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collections').get().n, 0);
    const good = await request.post('/api/collections').set('Cookie', adminCookie)
      .send({ key: 'csv:1', name: 'X', source: 'csv-moxfield', color: '#10b981', entries: '12', cards: {} });
    assert.equal(good.status, 200, good.text);
  });

  test('a card’s printing picture and numbers are checked on every way into a deck', async () => {
    const base = `/api/players/${BOB}/decks/${BOB_PUBLIC}`;
    const bad = { card_name: 'Sol Ring', qty: 1, printing: { id: 'abc', image: 'javascript:alert(1)' } };
    let res = await request.put(`${base}/cards`).set('Cookie', bobCookie).send({ cards: [bad], categories: [] });
    assert.equal(res.status, 400);
    res = await request.put(`${base}/cards`).set('Cookie', bobCookie)
      .send({ cards: [{ card_name: 'Sol Ring', qty: '<img src=x onerror=alert(1)>' }], categories: [] });
    assert.equal(res.status, 400);
    res = await request.post(`${base}/snapshots`).set('Cookie', bobCookie)
      .send({ reason: 'edit', cards: [bad], categories: [] });
    assert.equal(res.status, 400);
    res = await request.post(`${base}/cards/add`).set('Cookie', bobCookie).send({ card_name: 'Mox', qty: 'lots' });
    assert.equal(res.status, 400);
    assert.deepEqual(cardsOf(BOB_PUBLIC), [{ card_name: 'Sol Ring', qty: 1, category: 'Ramp' }]);

    const image = 'https://cards.scryfall.io/normal/front/6/e/6e9f.jpg?1562';
    res = await request.put(`${base}/cards`).set('Cookie', bobCookie)
      .send({ cards: [{ card_name: 'Sol Ring', qty: 2, printing: { id: 'abc', image } }], categories: BOB_CATS });
    assert.equal(res.status, 200);
    const back = await request.get(`${base}/cards`).set('Cookie', bobCookie);
    assert.equal(back.body.cards[0].printing.image, image, 'a real picture is kept');
  });

  test('a stored printing picture that is not one never reaches the browser', async () => {
    db.prepare('UPDATE deck_cards SET printing = ? WHERE deck_id = ?')
      .run(JSON.stringify({ id: 'abc', image: 'javascript:alert(1)' }), BOB_PUBLIC);
    const back = await request.get(`/api/players/${BOB}/decks/${BOB_PUBLIC}/cards`).set('Cookie', bobCookie);
    assert.deepEqual(back.body.cards[0].printing, { id: 'abc' });
  });
});

// ── 5 (browser) ───────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const readSrc = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function loadTab() {
  const el = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, addEventListener() {},
    appendChild() {}, querySelector: () => null, querySelectorAll: () => [],
  });
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, querySelectorAll: () => [], createElement: el,
                getElementById: el, body: { appendChild() {}, style: {} } },
    window: { addEventListener() {}, innerWidth: 1200, innerHeight: 800, location: {} },
    history: { state: null, pushState() {}, replaceState() {}, back() {} },
    alert() {}, confirm: () => true, prompt: () => null, setTimeout: () => 1, clearTimeout() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    kebabMenuHtml: items => `<span class="kebab">${items.map(i => `<b onclick="${i.onclick}">${i.label}</b>`).join('')}</span>`,
    dbBracketBadgeHtml: () => '',
    collapseState: {}, scryfallArtCache: new Map(),
  };
  vm.createContext(sandbox);
  for (const file of ['state.js', 'auth.js', 'players.js', 'deckdrag.js', 'card.js']) {
    vm.runInContext(readSrc(`public/js/${file}`), sandbox, { filename: file });
  }
  return expr => vm.runInContext(expr, sandbox);
}

describe('the tab escapes what it draws', () => {
  const run = loadTab();

  test('esc() takes anything, and escapes both quotes', () => {
    assert.equal(run(`esc("a'b\\"c<d>&")`), 'a&#39;b&quot;c&lt;d&gt;&amp;');
    assert.equal(run('esc(0)'), '0', 'a zero is a zero, not nothing');
    assert.equal(run('esc(null) + esc(undefined) + esc()'), '');
    assert.equal(run('esc(12)'), '12', 'a number no longer throws');
    // jsAttr still survives an attribute: the quote it escaped for the JS
    // string is an entity the HTML parser hands back as \'.
    assert.equal(run(`jsAttr("Urza's")`), 'Urza\\&#39;s');
  });

  test('cssUrl() keeps an http(s) picture and nothing else, with nothing in it to close the url(', () => {
    assert.equal(run(`cssUrl('javascript:alert(1)')`), '');
    assert.equal(run(`cssUrl(null)`), '');
    assert.equal(run(`cssUrl('https://cards.scryfall.io/a.jpg?1')`), 'https://cards.scryfall.io/a.jpg?1');
    assert.equal(run(`cssUrl("https://x/a.jpg');background:url('y")`),
      'https://x/a.jpg%27%29;background:url%28%27y');
  });

  test('a deck tile drawn from hostile stored values has no way out of its attributes', () => {
    const html = run(`deckTileHtml(
      { id: "p');alert('p", name: 'Bob', decks: [], folders: [] },
      { id: "d');alert('d", name: '<img src=x onerror=alert(1)>', source: 'manual',
        commanderImg: "https://x/a.jpg');background:url('//evil", cardCount: '<b>9</b>',
        deckUrl: 'https://archidekt.com/decks/1', private: false },
      true)`);
    assert.doesNotMatch(html, /<img src=x/, 'the name is text');
    assert.doesNotMatch(html, /<b>9<\/b>/, 'the count is text');
    assert.doesNotMatch(html, /'\);alert\(/, 'no id closes the string it is quoted in');
    assert.match(html, /url\('https:\/\/x\/a\.jpg%27%29;background:url%28%27\/\/evil'\)/,
      'the picture cannot close the url(');
    const editing = run(`deckTileHtml({ id: 'p1', name: 'Bob', decks: [], folders: [] },
      { id: "d');alert('d", name: 'x', editing: true }, true)`);
    assert.doesNotMatch(editing, /'\);alert\(/);
    assert.match(editing, /data-deck-id="d&#39;\);alert\(&#39;d"/);
  });

  test('a mana cost is drawn by the one rule — every slash, the symbol escaped', () => {
    const cost = run(`cardManaSymbols('{G/U/P}{2/W}{T}')`);
    assert.match(cost, /ms-gup\b/, 'a three-part hybrid loses both slashes');
    assert.match(cost, /ms-2w\b/);
    assert.match(cost, /ms-tap\b/);
    assert.equal(cost, run(`renderMana('{G/U/P}{2/W}{T}')`));
    assert.match(run(`cardOracleHtml('Pay {G/U/P}.')`), /ms-gup\b/);
    assert.doesNotMatch(run(`cardManaSymbols('{"><img src=x>}')`), /<img src=x>/);
  });
});
