/* A card Scryfall has renamed since a collection was imported.
 *
 * A collection is names, and a name is fixed at the moment of the import. A
 * card Scryfall renames afterwards — Unfinity's "________ Goblin" is
 * "_____ Goblin" now — is a name the local bulk copy no longer has, so the
 * lookup falls through to live Scryfall, which finds the card and answers with
 * it under its new name. js/scryfall.js used to file the picture under that new
 * name only, mark the name it was asked about as having no picture, and never
 * ask again: the collection's card was drawn as a blank everywhere it was
 * drawn. These hold the pairing it reads instead — Scryfall's answers come back
 * in the order they were asked, the unfound left out — and that the picture is
 * filed under the name the app will look it up by.
 *
 * js/scryfall.js is run whole against stub browser globals, as the page runs it.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'scryfall.js'), 'utf8');

/** The file, with the local endpoint and live Scryfall answering as told. */
function load({ local, live }) {
  const respond = body => ({ ok: true, json: async () => body });
  const sandbox = {
    document: { addEventListener() {} }, window: {}, state: { collections: [] }, esc: s => s,
    cardMetaOf: card => ({ type: card.type_line || '' }),
    fetch: async () => respond(local),
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  sandbox.scryfallFetch = async () => respond(live);
  /* The caches are `const`s at the top of the file: global, but lexical, so
     they are reached by name inside the context rather than as properties. */
  sandbox.picture = (cache, name) => vm.runInContext(`${cache}.get(${JSON.stringify(name)})`, sandbox);
  return sandbox;
}

const plain = value => JSON.parse(JSON.stringify(value));

test('Scryfall’s answers are paired with the names asked, the unfound left out', () => {
  const sb = load({ local: {}, live: {} });
  const pairs = sb.scryfallAnswers(['A', 'B // C', 'D'], [{ name: 'A1' }, { name: 'D1' }], [{ name: 'B' }]);
  assert.deepStrictEqual(plain(pairs), [['A', { name: 'A1' }], ['D', { name: 'D1' }]]);
  assert.deepStrictEqual(plain(sb.scryfallAnswers(['A', 'B'], [{ name: 'A' }], [])), [],
    'counts that do not add up pair nothing rather than guess');
});

test('a renamed card’s picture is filed under the name the collection knows it by', async () => {
  const sb = load({
    local: { data: [{ name: 'Sol Ring', image_uris: { normal: 'sol.jpg' } }], not_found: ['________ Goblin'] },
    live:  { data: [{ name: '_____ Goblin', image_uris: { normal: 'goblin.jpg', art_crop: 'goblin-art.jpg' } }], not_found: [] },
  });
  await sb.ensureScryfallImages(['Sol Ring', '________ Goblin']);
  assert.strictEqual(sb.picture('scryfallCache', '________ Goblin'), 'goblin.jpg');
  assert.strictEqual(sb.picture('scryfallArtCache', '________ Goblin'), 'goblin-art.jpg');
  assert.strictEqual(sb.picture('scryfallCache', '_____ Goblin'), 'goblin.jpg', 'and under its own name, as before');
  assert.strictEqual(sb.picture('scryfallCache', 'Sol Ring'), 'sol.jpg');
});

test('a name nobody knows is still remembered as having no picture', async () => {
  const sb = load({
    local: { data: [], not_found: ['Not A Card'] },
    live:  { data: [], not_found: [{ name: 'Not A Card' }] },
  });
  await sb.ensureScryfallImages(['Not A Card']);
  assert.strictEqual(sb.picture('scryfallCache', 'Not A Card'), null);
});

test('a two-faced card asked by its full name is not taken for a rename', async () => {
  const sb = load({
    local: { data: [], not_found: ['Delver of Secrets // Insectile Aberration'] },
    live:  { data: [{ name: 'Delver of Secrets // Insectile Aberration', card_faces: [{ image_uris: { normal: 'd.jpg' } }, {}] }], not_found: [] },
  });
  const renamed = new Map();
  await sb.fetchCardCollection(['Delver of Secrets // Insectile Aberration'], renamed);
  assert.strictEqual(renamed.size, 0);
});
