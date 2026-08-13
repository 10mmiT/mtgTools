/* The card held over the page.
 *
 * Pointing at a card's name and being shown the card — one implementation, and
 * that is the first thing asserted here, because there used to be two. The
 * Deck Builder drew its own preview from its own cache on its own mousemove,
 * beside the one main.js draws on every .card-link in the app, and since the
 * mat's rows carry .card-link both fired at once: two copies of one card,
 * twenty pixels apart and ten pixels different in width.
 *
 * Three decisions live in the survivor and all three are written as functions
 * of their inputs so they can be asserted rather than eyeballed:
 *
 *   tipWanted()      whether the preview is worth drawing at all — a size
 *                    rather than a list of views, so it holds for views that
 *                    do not exist yet
 *   tipPlacement()   where it goes, from the pointer and the *measured* size,
 *                    which is what lets a two-faced card be twice as wide
 *                    without hanging off the window
 *   _scryfallFaces() how many pictures a card actually has, which is the whole
 *                    of the double-faced question
 *
 * The shipped files are what run: the tooltip section is sliced out of
 * public/js/main.js by its banners, the way test/themes.test.js slices the
 * theme section, and js/scryfall.js is run whole.
 *
 * What is not asserted is what the preview looks like. That is the eye's.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── There is one of them ──────────────────────────────────────────────

test('the Deck Builder no longer draws a preview of its own', () => {
  const core = read('public/js/deckview-core.js');
  assert.ok(!core.includes('dbHoverPreview'),
    'the tab is building a second card-above-the-page');
  assert.ok(!read('public/css/tabs.css').includes('.db-hover-preview'),
    'the stylesheet still dresses one');
  assert.ok(!read('public/js/main.js').includes('dbHoverPreview'),
    'main.js is still reaching for one to hide');
});

test('and the one that is left is written into the page empty', () => {
  // Its contents are per-hover now — one picture or two — so a single <img>
  // baked into the markup would be a face that could never be the second.
  const html = read('public/index.html');
  assert.ok(html.includes('<div id="cardTooltip"></div>'));
  assert.ok(!html.includes('tooltipImg'), 'the single baked-in face is still there');
});

// ── The decisions ─────────────────────────────────────────────────────

/** The tooltip section of the shipped main.js, over stub browser globals. */
function loadTooltip() {
  const src   = read('public/js/main.js');
  const start = src.indexOf('// ── The card held over the page ─');
  const end   = src.indexOf('// ── Event listeners ─');
  assert.ok(start !== -1 && end > start,
    'main.js should still carry the preview between its banners');

  const tip = {
    style: { display: 'none' }, innerHTML: '',
    addEventListener() {},
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
  };
  const sandbox = {
    document: {
      getElementById: () => tip,
      addEventListener() {},
    },
    window: { innerWidth: 1440, innerHeight: 900 },
    clearTimeout() {}, setTimeout() { return 1; },
    esc: s => String(s),
    scryfallCache: new Map(),
    scryfallFacesCache: new Map(),
    ensureScryfallImages: async () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, end), sandbox);
  return {
    tip, sandbox,
    run: expr => vm.runInContext(expr, sandbox),
    width: vm.runInContext('TIP_CARD_WIDTH', sandbox),
    wanted: (art, w) => vm.runInContext(
      `tipWanted(${JSON.stringify(art)}${w === undefined ? '' : `, ${JSON.stringify(w)}`})`, sandbox),
    place: (at, box, view) => JSON.parse(vm.runInContext(
      `JSON.stringify(tipPlacement(${JSON.stringify(at)}, ${JSON.stringify(box)}, ${JSON.stringify(view)}))`,
      sandbox)),
  };
}

const app = loadTooltip();

test('a name standing on its own wants the card', () => {
  assert.strictEqual(app.wanted(0), true);
});

test('and so does a name beside a picture too small to read', () => {
  /* The drawer's tiles are 118px and the Scryfall list's thumbnails smaller
     still: those are exactly the places the preview is the point. */
  assert.strictEqual(app.wanted(40), true, 'a list thumbnail suppressed the preview');
  assert.strictEqual(app.wanted(118), true, 'a drawer tile suppressed the preview');
});

test('but a card already on screen at full size does not', () => {
  // The Deck Builder's grid with the size slider up, without this rule having
  // to know that the Deck Builder or its slider exist.
  assert.strictEqual(app.wanted(app.width), false, 'the same size still drew a second copy');
  assert.strictEqual(app.wanted(324), false);
});

test('the size it compares against is the size it draws', () => {
  // A number the stylesheet alone knew could not be compared with anything.
  assert.strictEqual(app.width, 210);
  assert.ok(read('public/css/components.css').includes('.tip-face { width: 210px;'),
    'the stylesheet and TIP_CARD_WIDTH disagree about how wide a face is');
});

test('a missing measurement is a name with no picture, not a picture of nothing', () => {
  // NaN and undefined mean "nothing was measured", and the preview is what the
  // hover is for — failing open is the only safe direction.
  assert.strictEqual(app.wanted(NaN), true);
  assert.strictEqual(app.wanted(undefined), true);
});

// ── Where it goes ─────────────────────────────────────────────────────

const VIEW = { width: 1440, height: 900 };
const ONE  = { width: 224, height: 310 };
const TWO  = { width: 456, height: 310 };   // a transforming card: two faces and the gap

test('the card is drawn to the right of the pointer, below it', () => {
  assert.deepStrictEqual(app.place({ x: 100, y: 300 }, ONE, VIEW), { left: 114, top: 280 });
});

test('and flips to the left when it would run off the edge', () => {
  assert.deepStrictEqual(app.place({ x: 1400, y: 300 }, ONE, VIEW), { left: 1162, top: 280 });
});

test('a two-faced card flips where a two-faced card has to', () => {
  /* The whole reason the size is measured rather than written down: the old
     216 was one card's width, and a card with two faces would have hung off
     the right of every window it was ever shown in. Same pointer, same
     window — only the thing being placed is different. */
  assert.strictEqual(app.place({ x: 1100, y: 300 }, ONE, VIEW).left, 1114,
    'one face fits at this pointer and should not have flipped');
  assert.strictEqual(app.place({ x: 1100, y: 300 }, TWO, VIEW).left, 630,
    'two faces do not fit and should have flipped to the left of the pointer');
});

test('and is held inside the window when neither side has room', () => {
  assert.strictEqual(app.place({ x: 100, y: 880 }, ONE, VIEW).top, 900 - 310 - 8,
    'it hung off the bottom');
  assert.strictEqual(app.place({ x: 100, y: 10 }, ONE, VIEW).top, 0,
    'a pointer near the top placed it above the page');
  // A narrow window is where a two-faced card fits on neither side of the
  // pointer: it goes to the edge rather than off it.
  assert.strictEqual(app.place({ x: 400, y: 300 }, TWO, { width: 600, height: 900 }).left, 0,
    'a wide preview was placed off the left of the page');
});

// ── One picture, or two ───────────────────────────────────────────────

/** js/scryfall.js, whole, for the one question this asks of a card. */
function loadFaces() {
  const sandbox = { document: { addEventListener() {} }, window: {}, state: { collections: [] }, esc: s => s };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/scryfall.js'), sandbox);
  /* Back across the vm boundary as JSON: an array made inside the context has
     a different Array prototype, which deepStrictEqual counts as a difference
     and no reader would. */
  const call = (fn, card) => JSON.parse(vm.runInContext(
    `JSON.stringify(${fn}(${JSON.stringify(card)}))`, sandbox));
  return {
    faces: card => call('_scryfallFaces', card),
    back:  card => call('scryfallBackFace', card),
  };
}

const sf    = loadFaces();
const faces = sf.faces;

test('a plain card has one picture', () => {
  assert.strictEqual(faces({ name: 'Sol Ring', image_uris: { normal: 'a.jpg' } }), null);
});

test('a transforming card has two, in the order they are printed', () => {
  assert.deepStrictEqual(faces({
    name: 'Delver of Secrets // Insectile Aberration',
    card_faces: [
      { name: 'Delver of Secrets',    image_uris: { normal: 'front.jpg' } },
      { name: 'Insectile Aberration', image_uris: { normal: 'back.jpg' } },
    ],
  }), ['front.jpg', 'back.jpg']);
});

test('but a split card has one, because it is one piece of cardboard', () => {
  /* A split card and a Room have card_faces too, and they are printed once:
     the picture is on the card rather than on its faces, so asking each face
     for one correctly finds none. That is the card's own answer, and it is why
     there is no list of layouts here to keep up to date. */
  assert.strictEqual(faces({
    name: 'Fire // Ice',
    image_uris: { normal: 'whole.jpg' },
    card_faces: [{ name: 'Fire' }, { name: 'Ice' }],
  }), null);
});

test('and so does a Room, for the same reason and without being named here', () => {
  /* A Room is the newest card with two halves printed on one piece of
     cardboard, and it arrived after this helper was written. Nothing had to be
     added for it: it answers the same way a split card does because the
     question is about pictures rather than about layouts. */
  assert.strictEqual(faces({
    name: 'Bottomless Pool // Locker Room',
    layout: 'room',
    image_uris: { normal: 'whole.jpg' },
    card_faces: [{ name: 'Bottomless Pool' }, { name: 'Locker Room' }],
  }), null);
});

// ── The other side of it ──────────────────────────────────────────────
// Which is what the turn control asks, and the whole of what decides whether
// a card gets one. The same helper above, said as one picture instead of two,
// for the tabs that hold the card itself rather than its name.

test('a card with a back offers it, and a card without offers nothing', () => {
  assert.strictEqual(sf.back({
    name: 'Delver of Secrets // Insectile Aberration',
    card_faces: [
      { name: 'Delver of Secrets',    image_uris: { normal: 'front.jpg' } },
      { name: 'Insectile Aberration', image_uris: { normal: 'back.jpg' } },
    ],
  }), 'back.jpg', 'a transforming card did not offer its second picture');

  assert.strictEqual(sf.back({ name: 'Sol Ring', image_uris: { normal: 'a.jpg' } }), '',
    'an ordinary card offered a back and would be drawn a turn control');
  assert.strictEqual(sf.back({
    name: 'Fire // Ice',
    image_uris: { normal: 'whole.jpg' },
    card_faces: [{ name: 'Fire' }, { name: 'Ice' }],
  }), '', 'a split card offered a back and would be drawn a turn control');
});

// ── What gets drawn ───────────────────────────────────────────────────

test('one face is one picture, and two faces are two', () => {
  app.sandbox.scryfallCache.set('Sol Ring', 'sol.jpg');
  app.sandbox.scryfallCache.set('Delver', 'front.jpg');
  app.sandbox.scryfallFacesCache.set('Delver', ['front.jpg', 'back.jpg']);

  const one = app.run(`_tipCardsHtml('Sol Ring')`);
  assert.strictEqual((one.match(/<img/g) || []).length, 1);
  assert.ok(one.includes('sol.jpg'));

  const two = app.run(`_tipCardsHtml('Delver')`);
  assert.strictEqual((two.match(/<img/g) || []).length, 2,
    'a transforming card was drawn with one of its two faces');
  assert.ok(two.indexOf('front.jpg') < two.indexOf('back.jpg'),
    'the back was drawn in front of the front');
});

test('a card whose picture never arrived draws nothing at all', () => {
  app.sandbox.scryfallCache.set('Nowhere', null);
  assert.strictEqual(app.run(`_tipCardsHtml('Nowhere')`), '');
});
