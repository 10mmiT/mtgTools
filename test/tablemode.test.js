/* Table mode: the decisions inside it.
 *
 * Which kind of panel a tab opens in, when a press becomes a drag, how the
 * table is fitted to the window, where the camera pans and zooms for a pointer
 * and a wheel, how fast a card comes up, which point of the mat is under a
 * point of the screen through all of that, and where cards lie — each is written in public/js/tablemode.js as a
 * function of its inputs so that it can be asserted here rather than eyeballed
 * in a browser — and so is what each tab lays on the mat, through the
 * renderers' getters stubbed into the sandbox, and when a panel tucks itself
 * away. What is not asserted is what the table looks like, nor the
 * listeners and the markup that wire those answers to the page: those are the
 * eye's and the smoke harness's, for the reason test/cardlift.test.js gives.
 *
 * The shipped files are run against stub browser globals, so these assert on
 * the code the browser is served. js/cardstack.js is loaded first because the
 * layout lays each card at the angle its name gives it there.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const { parsePalettes, THEMES: PALETTE_THEMES } = require('../scripts/check-contrast.js');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** The page as tablemode.js finds it at boot, reduced to what it asks of it:
 *  an <html> to put the switch on, storage to read it from, and a window that
 *  answers the desktop query however the test says. Nothing here has a body,
 *  so the table is never built — what is under test is arithmetic and the
 *  switch's own bookkeeping. */
function loadTableMode({ stored = null, allowed = false, storage = true } = {}) {
  const store = new Map();
  if (stored !== null) store.set('mtgtools_tablemode', stored);
  const root = { dataset: {} };
  const sandbox = {
    BP_MD: 900,
    document: {
      documentElement: root,
      body: null,
      getElementById: () => null,
      addEventListener() {},
      dispatchEvent() {},
    },
    localStorage: storage ? {
      getItem:    k => (store.has(k) ? store.get(k) : null),
      setItem:    (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    } : {
      getItem()    { throw new Error('storage is disabled'); },
      setItem()    { throw new Error('storage is disabled'); },
      removeItem() { throw new Error('storage is disabled'); },
    },
    matchMedia: () => ({ matches: allowed, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1440,
    innerHeight: 900,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    cardMotionOn: () => true,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/cardstack.js'), sandbox);
  vm.runInContext(read('public/js/tablemode.js'), sandbox);

  const evaluate = expr => vm.runInContext(expr, sandbox);
  /* Copied out of the sandbox: an object built in there is built from that
   * realm's Object, which nothing here would compare equal to one of ours. */
  const copy = value => JSON.parse(JSON.stringify(value));
  return { evaluate, copy, root, store, sandbox, call: (fn, ...args) => copy(sandbox[fn](...args)) };
}

const app = loadTableMode();
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── Which panel a tab opens in ────────────────────────────────────────────

/* The tabs the app has, read off the sidebar the browser is served. */
const APP_TABS = [...read('public/index.html').matchAll(/id="tab-btn-([a-z]+)"/g)].map(m => m[1]);

test('the Card tab grows on the mat and every other tab floats', () => {
  assert.ok(APP_TABS.length >= 11, `the sidebar should name the app's tabs, found ${APP_TABS}`);
  for (const tab of APP_TABS) {
    assert.strictEqual(app.evaluate(`tablePanelKind(${JSON.stringify(tab)})`),
      tab === 'card' ? 'grow' : 'float', `${tab} opens the wrong kind of panel`);
  }
  assert.strictEqual(app.evaluate('tableMode.kindFor("card")'), 'grow',
    'the API answers from the same table');
});

test('a tab the table has never heard of floats, and nothing inherited is a kind', () => {
  assert.strictEqual(app.evaluate('tablePanelKind("nonsense")'), 'float');
  assert.strictEqual(app.evaluate('tablePanelKind("toString")'), 'float',
    'a name on Object.prototype is not a panel kind');
  assert.strictEqual(app.evaluate('tablePanelKind(undefined)'), 'float');
  for (const kind of Object.values(app.copy(app.evaluate('TABLE_PANEL_KINDS')))) {
    assert.ok(['float', 'grow'].includes(kind), `${kind} is not a kind of panel`);
  }
});

test('the rim stands every tab the sidebar has, on the edges the table puts them', () => {
  const rim = app.copy(app.evaluate('TABLE_RIM'));
  const tabs = rim.filter(e => e.tab).map(e => e.tab);
  assert.deepStrictEqual([...tabs].sort(), [...APP_TABS].sort(),
    'a tab missing from the rim cannot be reached in table mode');

  /* Edge by edge and group by group, as the rim draws them. */
  const layout = app.copy(app.evaluate('tableRimLayout()'));
  const names = indices => (indices || []).map(i => rim[i].tab || rim[i].act);
  assert.deepStrictEqual(Object.keys(layout).sort(), ['left', 'right'],
    'only the side edges hold tabs: the far edge is the slip’s and the bin’s');
  assert.deepStrictEqual(names(layout.right.far), ['collections', 'players', 'deckview', 'scryfall', 'sets', 'wants'],
    'the card tabs stand down the right edge from its far corner');
  assert.deepStrictEqual(Object.keys(layout.right), ['far'], 'in one group');
  assert.deepStrictEqual(names(layout.left.far), ['available', 'pick', 'lands', 'card'],
    'the other tabs at the far end of the left edge');
  assert.deepStrictEqual(names(layout.left.near), ['appearance', 'rss', 'admin', 'password', 'signout', 'leave'],
    'and the account and the table’s own controls apart from them at its near end');
  assert.ok(rim.every(e => ['far', 'near'].includes(e.group)), 'every tab says which end of its edge it stands at');

  const html = read('public/index.html');
  for (const entry of rim.filter(e => e.nav)) {
    assert.match(html, new RegExp(`id="${entry.nav}"`), `${entry.act} stands for a sidebar button that is gone`);
  }
  for (const tab of tabs) {
    assert.match(html, new RegExp(`id="tab-${tab}"`), `there is no pane for ${tab} to open`);
  }
});

test('the tabs lie flat on the rim, an icon each, and open their label on hover and focus', () => {
  const sheet = read('public/css/table.css');
  const rule = selector => {
    const at = sheet.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]()*:"=]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    assert.ok(at, `table.css has a rule for ${selector}`);
    return at[1];
  };
  assert.doesNotMatch(sheet, /rotateX\(calc\(-1/, 'nothing is stood back up against the tilt');
  assert.doesNotMatch(rule('.table-rim'), /preserve-3d/, 'an edge is a flat picture in the table’s plane');
  assert.doesNotMatch(rule('.table-tab'), /transform/, 'and a tab on it has no transform of its own');
  const label = rule('.table-tab-label');
  assert.match(label, /max-width:\s*0/, 'folded away at rest');
  assert.match(label, /opacity:\s*0/);
  assert.match(sheet, /\.table-tab:hover \.table-tab-label,\s*\n\.table-tab:focus-visible \.table-tab-label\s*\{[^}]*opacity:\s*1/,
    'opened while pointed at or focused');
  assert.match(sheet, /\.table-tab\[aria-expanded="true"\] \.table-tab-face\s*\{[^}]*border-bottom-color:\s*var\(--accent/,
    'the open tab keeps its accent, folded or not');
  assert.match(sheet, /\.table-rim--left,\s*\n\.table-rim--right\s*\{[^}]*justify-content:\s*space-between/,
    'a side edge stands its two groups at its two ends, apart');
  assert.match(sheet, /\.table-rim--left,\s*\n\.table-rim--right\s*\{[^}]*transform:\s*translateZ\(var\(--table-rim-z/,
    'and lies above the cards, so a label opened over the mat is drawn over them');
  assert.match(sheet, /\.table-rim--left,\s*\n\.table-rim--right\s*\{[^}]*pointer-events:\s*none/,
    'while the edge itself takes no pointer from the cards beside it — only its chips do');
  assert.ok(app.evaluate('TABLE_RIM_Z') > app.evaluate('(TABLE_CARDS_MAX + 2) * TABLE_CARD_GAP'),
    'above the highest a card lying on the mat can be');
  assert.match(sheet, /grid-template-columns:\s*var\(--table-rim-side\) minmax\(0, 1fr\) var\(--table-rim-side\)/,
    'the side edges are one width, said once');
  assert.match(sheet, /--table-rim-side:\s*3\.5rem/, 'a chip’s width and a hair of wood, so the mat is nearly the whole table');
  const js = read('public/js/tablemode.js');
  assert.match(js, /aria-label="\$\{label\}"/, 'every tab is named for its label, folded or not');
  assert.match(js, /TABLE_LEAVE_ICON/, 'and Leave table, with no sidebar button to borrow from, has an icon of its own');
});

// ── Click or drag ─────────────────────────────────────────────────────────

test('a press that moves under five pixels is a click', () => {
  assert.strictEqual(app.evaluate('TABLE_DRAG_START'), 5);
  assert.strictEqual(app.evaluate('tableIsDrag(0, 0)'), false);
  assert.strictEqual(app.evaluate('tableIsDrag(4, 0)'), false);
  assert.strictEqual(app.evaluate('tableIsDrag(0, -4.9)'), false);
  assert.strictEqual(app.evaluate('tableIsDrag(3.5, 3.5)'), false,
    'a diagonal wobble of 4.95px is still a wobble');
});

test('five pixels in any direction is a drag', () => {
  assert.strictEqual(app.evaluate('tableIsDrag(5, 0)'), true);
  assert.strictEqual(app.evaluate('tableIsDrag(-5, 0)'), true);
  assert.strictEqual(app.evaluate('tableIsDrag(0, 5)'), true);
  assert.strictEqual(app.evaluate('tableIsDrag(3, 4)'), true,
    'distance, not either axis: three across and four down is five');
  assert.strictEqual(app.evaluate('tableIsDrag(2, 2, 2)'), true, 'and the threshold can be asked for');
  assert.strictEqual(app.evaluate('tableIsDrag(NaN, undefined)'), false, 'nothing measured is no movement');
});

// ── Panning and zooming ──────────────────────────────────────────────────

const W = 1440, H = 900;
const pan = (x, y, w = W, h = H) => app.call('tablePanTarget', x, y, w, h);
/* The camera for a pointer at (x, y), at a zoom, with the lean at rest the
 * table uses unless one is asked for. */
const camera = (x, y, zoom = 1, lean) =>
  app.copy(app.sandbox.tableCamera({ zoom, ...pan(x, y) }, W, H, lean));
/* Where a point of the rest picture is drawn by a camera, and which point of
 * the rest picture is under a window point. */
const draw  = (cam, x, y) => ({ x: cam.zoom * x + cam.tx, y: cam.zoom * y + cam.ty });
const under = (cam, x, y) => ({ x: (x - cam.tx) / cam.zoom, y: (y - cam.ty) / cam.zoom });
const REST = 24;
const LEAN = 0.02;

test('a pointer in the middle of the window leaves the camera at rest', () => {
  assert.deepStrictEqual(pan(720, 450), { panX: 0, panY: 0 });
  assert.deepStrictEqual(app.copy(app.evaluate('TABLE_CAMERA_REST')), { zoom: 1, panX: 0, panY: 0 });
  assert.deepStrictEqual(camera(720, 450), { zoom: 1, tx: 0, ty: 0 }, 'and the picture where it is drawn');
  assert.strictEqual(app.evaluate('TABLE_TILT_REST'), REST);
  assert.strictEqual(app.evaluate('TABLE_PAN_REST'), LEAN);
});

test('at zoom 1 the camera slides only 2% of the window, as a head leans', () => {
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const cam = camera(x, y);
    assert.strictEqual(cam.zoom, 1);
    assert.ok(near(Math.abs(cam.tx), LEAN * W) && near(Math.abs(cam.ty), LEAN * H),
      `${x},${y} slides ${cam.tx},${cam.ty}`);
  }
  // Leaning right shows you more of the right: the picture slides left.
  assert.ok(camera(W, 450).tx < 0 && camera(0, 450).tx > 0, 'the picture slides away from the lean');
  assert.ok(camera(720, H).ty < 0 && camera(720, 0).ty > 0, 'up and down the same');
  assert.ok(near(camera(1080, 450).tx, -LEAN * W / 2), 'halfway to the edge is half the slide');
});

test('a pointer outside the window cannot pan the camera further', () => {
  const corner = camera(W, H, 2);
  for (const [x, y] of [[5000, 5000], [1e9, 1e9]]) assert.deepStrictEqual(camera(x, y, 2), corner);
  assert.deepStrictEqual(camera(-5000, -5000, 2), camera(0, 0, 2));
  assert.deepStrictEqual(pan(720, -400), pan(720, 0), 'each axis is clamped on its own');
  assert.deepStrictEqual(pan(10, 10, 0, 0), { panX: 0, panY: 0 }, 'a window with no size is the middle');
  assert.deepStrictEqual(pan(NaN, undefined), pan(0, 0),
    'an unreadable pointer is the window corner it falls back to, not a pan of NaN');
});

test('zoomed in, the pointer at an edge or a corner brings that part of the table into view', () => {
  /* The table at rest fills the window to within a gutter (tableFitSize), so
     every part of it is a point of the rest picture inside the window. */
  const range = zoom => camera(0, 450, zoom).tx - camera(W, 450, zoom).tx;
  assert.ok(range(1) <= 0.05 * W, `at zoom 1 the slide is a few percent: ${range(1)}`);
  assert.ok(range(2.5) >= 1.5 * W, `at 2.5 it reaches the whole picture, ${1.5 * W}px wider than the window: ${range(2.5)}`);
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H], [0, 450], [W, 450], [720, 0], [720, H]]) {
    for (const zoom of [1.5, 2, 2.5]) {
      const cam = camera(x, y, zoom);
      const seen = draw(cam, x, y);   // the same corner of the rest picture
      assert.ok(seen.x >= -1e-9 && seen.x <= W + 1e-9 && seen.y >= -1e-9 && seen.y <= H + 1e-9,
        `at ${zoom}, pointing at ${x},${y} shows that part of the table: drawn at ${seen.x},${seen.y}`);
      /* And not much past it: what shows beyond the table is the lean's band
         and the gutter, zoomed. */
      assert.ok(Math.abs(seen.x - x) <= (LEAN * W + 8) * zoom && Math.abs(seen.y - y) <= (LEAN * H + 8) * zoom + 1e-9,
        `at ${zoom}, ${x},${y} is drawn ${seen.x - x},${seen.y - y} from the window's edge`);
    }
  }
});

test('zooming never moves the point of the table under the pointer', () => {
  for (const [x, y] of [[720, 450], [100, 80], [1300, 820], [37, 640], [W, H]]) {
    const at = under(camera(x, y, 1), x, y);
    for (const zoom of [1.01, 1.3, 2, 2.5]) {
      const now = under(camera(x, y, zoom), x, y);
      assert.ok(near(now.x, at.x, 1e-9) && near(now.y, at.y, 1e-9),
        `${x},${y} at zoom ${zoom}: ${now.x},${now.y} against ${at.x},${at.y}`);
    }
  }
});

test('with cards still, the camera does not lean, and still reaches a zoomed table’s corners', () => {
  for (const [x, y] of [[0, 0], [W, H], [300, 820]]) {
    assert.deepStrictEqual(camera(x, y, 1, 0), { zoom: 1, tx: 0, ty: 0 }, `${x},${y} at zoom 1`);
    const seen = draw(camera(x, y, 2.5, 0), x, y);
    assert.ok(near(seen.x, x, 1e-9) && near(seen.y, y, 1e-9), 'zoomed, the window’s corner shows the picture’s');
  }
});

test('the camera holds its zoom inside the range, whatever it is asked', () => {
  assert.strictEqual(camera(720, 450, 0.2).zoom, 1);
  assert.strictEqual(camera(720, 450, 9).zoom, 2.5);
  assert.strictEqual(camera(720, 450, NaN).zoom, 1);
  assert.deepStrictEqual(app.copy(app.sandbox.tableCamera({ zoom: 2, panX: 1, panY: 1 }, 0, 0)), { zoom: 2, tx: 0, ty: 0 },
    'a window with no size has nothing to pan across');
});

test('the wheel zooms smoothly by how far it turned, in pixels, lines or pages', () => {
  const wheel = (zoom, dy, mode = 0, page = 900) => app.evaluate(`tableWheelZoom(${zoom}, ${dy}, ${mode}, ${page})`);
  assert.ok(near(wheel(1, -100), 1.2, 1e-9), 'a mouse’s notch towards the screen is a fifth more');
  assert.ok(wheel(1.5, 100) < 1.5, 'turned towards you it zooms out');
  assert.strictEqual(wheel(1, 100), 1, 'never past the whole table');
  assert.strictEqual(wheel(2.4, -300), 2.5, 'nor past two and a half');
  assert.ok(near(wheel(1, -3, 1), wheel(1, -120)), 'Firefox’s three lines are a notch of 120px');
  assert.strictEqual(wheel(1, -1, 2), wheel(1, -300), 'a page is held to the most one event may turn');
  let small = 1;
  for (let i = 0; i < 25; i++) small = wheel(small, -4);
  assert.ok(near(small, wheel(1, -100), 1e-9), 'a trackpad’s many small turns zoom as far as one big one');
  assert.ok(near(wheel(wheel(1.6, -80), 80), 1.6, 1e-9), 'and a turn back undoes a turn');
  assert.strictEqual(wheel(1.7, NaN), 1.7, 'an unreadable turn is no turn');
  const key = (zoom, f) => app.evaluate(`tableZoomBy(${zoom}, ${f})`);
  assert.ok(near(key(1, app.evaluate('TABLE_ZOOM_KEY')), 1.25), 'a key press is a quarter more');
  assert.strictEqual(key(2.4, 2), 2.5);
  assert.strictEqual(key(1.2, 0.5), 1);
  assert.strictEqual(key(1.6, 0), 1.6, 'a factor that is not one is no zoom');
});

test('the camera eases to its target and says when it has arrived', () => {
  let at = app.copy(app.evaluate('TABLE_CAMERA_REST'));
  const to = { zoom: 2.5, ...pan(W, 0) };
  let frames = 0, settled = false, last = Infinity;
  while (!settled && frames < 500) {
    const step = app.copy(app.evaluate(`tableCameraStep(${JSON.stringify(at)}, ${JSON.stringify(to)})`));
    const gap = Math.abs(to.zoom - step.at.zoom) + Math.abs(to.panX - step.at.panX);
    assert.ok(gap <= last, 'every frame closes on the target, never past it');
    last = gap;
    at = step.at;
    settled = step.settled;
    frames++;
  }
  assert.ok(settled, 'the loop stops itself');
  assert.ok(frames < 120, `and within two seconds of frames, not ${frames}`);
  assert.deepStrictEqual(at, to, 'and arrives exactly, not a hair short');
  const again = app.copy(app.evaluate(`tableCameraStep(${JSON.stringify(to)}, ${JSON.stringify(to)})`));
  assert.deepStrictEqual(again, { at: to, settled: true }, 'a camera already there is settled');
});

test('the pan eases about a quarter more gently than the zoom', () => {
  const zoomEase = app.evaluate('TABLE_ZOOM_EASE'), panEase = app.evaluate('TABLE_PAN_EASE');
  assert.strictEqual(zoomEase, 0.12, 'the zoom keeps up with the wheel as it did');
  assert.strictEqual(panEase, 0.09, 'the pan closes a quarter less of its gap a frame');
  /* One frame from rest towards a zoomed, panned target: each part closes its own share. */
  const to = { zoom: 2, panX: 1, panY: -1 };
  const { at } = app.copy(app.evaluate(`tableCameraStep(TABLE_CAMERA_REST, ${JSON.stringify(to)})`));
  assert.ok(near(at.zoom, 1 + zoomEase), `the zoom closes ${zoomEase} of its gap, not ${at.zoom - 1}`);
  assert.ok(near(at.panX, panEase) && near(at.panY, -panEase), 'and each pan closes its own share');
});

test('the camera takes the same time to arrive at any refresh rate', () => {
  const ease = dt => app.evaluate(`tableEaseFor(${dt}, 0.12)`);
  assert.ok(near(ease(1000 / 60), 0.12), 'a sixtieth of a second closes the stated share');
  assert.ok(near(1 - (1 - ease(1000 / 120)) ** 2, 0.12),
    'two frames of a 120Hz screen close exactly what one frame of a 60Hz screen does');
  assert.ok(near(ease(2000 / 60), 1 - 0.88 ** 2), 'and one slow frame what two quick ones do');
  assert.strictEqual(ease(0), 0, 'no time is no movement');
  assert.strictEqual(ease(-5), 0, 'nor is a clock that ran backwards');
  assert.strictEqual(ease(5000), ease(100), 'a frame after a long sleep is held to a tenth of a second');
  assert.ok(ease(100) < 1, 'so the camera never lands in a single jump');
});

// ── Sharp pictures on a zoomed table ─────────────────────────────────────

test('a card’s picture is laid out as many times larger as the zoom and the screen draw it', () => {
  const k = (zoom, dpr) => app.evaluate(`tableDecodeScale(${zoom}, ${dpr})`);
  assert.strictEqual(k(1, 1), 1, 'at rest on a 1x screen the picture is laid out as it always was');
  assert.strictEqual(k(1.01, 1), 1.5, 'past rest it is rounded up to the next half, never down');
  assert.strictEqual(k(1.5, 1), 1.5, 'and a zoom on a step is that step');
  assert.strictEqual(k(2.5, 1), 2.5, 'all the way in, two and a half times');
  assert.strictEqual(k(1, 2), 2, 'a 2x screen is drawn in twice the pixels, even at rest');
  assert.strictEqual(k(2.5, 2), 5, 'and both together multiply');
  assert.strictEqual(k(1.2, 1.25), 1.5, 'a fractional screen is rounded up with the zoom');
  assert.strictEqual(k(9, 1), 2.5, 'a zoom past the camera’s range counts as its most');
  assert.strictEqual(k(0.2, 0.5), 1, 'and nothing counts below 1');
  assert.strictEqual(k('"nonsense"', undefined), 1, 'nor is anything unreadable more than rest');
});

test('the large picture is fetched only where a normal one would be drawn past its size', () => {
  const big = (w, zoom, dpr) => app.evaluate(`tableNeedsLarge(${w}, ${zoom}, ${dpr})`);
  const maxW = app.evaluate('TABLE_CARD_MAX_W'), maxZoom = app.evaluate('TABLE_ZOOM_MAX');
  assert.strictEqual(big(maxW, maxZoom, 1), false, 'a 1x screen never needs one, the widest card zoomed all the way in');
  assert.strictEqual(big(92, 1, 2), false, 'nor does a 2x screen at rest');
  assert.strictEqual(big(92, 2.5, 2), true, 'but a 2x screen zoomed all the way in does');
  assert.strictEqual(big(320, 1, 2), true, 'and so does the Card tab’s large card on a 2x screen at rest');
});

test('the large picture is Scryfall’s own, and anything else is left alone', () => {
  const large = url => app.evaluate(`tableLargeImage(${JSON.stringify(url)})`);
  assert.strictEqual(large('https://cards.scryfall.io/normal/front/8/8/88f4.jpg?1783935023'),
    'https://cards.scryfall.io/large/front/8/8/88f4.jpg?1783935023');
  assert.strictEqual(large('https://cards.scryfall.io/art_crop/front/8/8/88f4.jpg'),
    'https://cards.scryfall.io/art_crop/front/8/8/88f4.jpg', 'a deck’s art crop has no large');
  assert.strictEqual(large('https://example.com/normal/a.jpg'), 'https://example.com/normal/a.jpg',
    'a picture from anywhere else is not guessed at');
  assert.strictEqual(large(''), '');
});

test('a card is a 3D context, and its picture is laid out by the factor and scaled back by it', () => {
  const sheet = read('public/css/table.css');
  assert.match(sheet, /\.table-card\s*\{[^}]*transform-style:\s*preserve-3d/,
    'the card is its own 3D context, so its picture is decoded for its own box');
  const img = sheet.match(/\.table-card-img\s*\{([^}]*)\}/)[1];
  assert.match(img, /--k:\s*var\(--table-card-k,\s*1\)/, 'the factor is the script’s, 1 when it has said none');
  assert.match(img, /width:\s*calc\(100% \* var\(--k\)\)/);
  assert.match(img, /height:\s*calc\(100% \* var\(--k\)\)/);
  assert.match(img, /transform:\s*scale\(calc\(1 \/ var\(--k\)\)\)/, 'and scaled back down by the same');
  assert.match(img, /transform-origin:\s*0 0/, 'about the corner it is laid out from');
  assert.match(read('public/js/tablemode.js'), /setProperty\('--table-card-k'/, 'which the script writes');
});

// ── Picking a card up ────────────────────────────────────────────────────

test('a card in hand is all the way up in about a tenth of a second, and higher than it was', () => {
  const lift = (ms, motion = true) => app.evaluate(`tableLiftHeight(${ms}, ${motion})`);
  const top = app.evaluate('TABLE_CARD_LIFT'), ms = app.evaluate('TABLE_LIFT_MS');
  assert.strictEqual(top, 96, 'about 1.6 times the 60px it used to rise');
  assert.ok(ms >= 90 && ms <= 120, `${ms}ms to full height`);
  assert.strictEqual(lift(0), 0, 'it starts on the felt');
  assert.strictEqual(lift(ms), top);
  assert.strictEqual(lift(5000), top, 'and stays up');
  assert.ok(lift(ms / 2) > top / 2, 'fast off the felt and slowing into the hand');
  let last = -1;
  for (let t = 0; t <= ms; t += 5) { assert.ok(lift(t) >= last, 'never dipping on the way up'); last = lift(t); }
  assert.strictEqual(lift(-20), 0, 'a frame stamped before the press is the press');
  assert.strictEqual(lift(60, false), 0, 'with cards still it is held, not lifted');
});

// ── Where a floating panel goes ──────────────────────────────────────────

const box = (view, clear, gap = 12) =>
  app.copy(app.evaluate(`tableFloatBox(${JSON.stringify(view)}, ${JSON.stringify(clear)}, ${gap})`));

test('a floating panel is min(900px, 70vw) wide and 80vh tall where there is room', () => {
  const b = box({ width: 2560, height: 1440 }, { top: 100, left: 300, right: 2260 });
  assert.strictEqual(b.width, 900);
  assert.strictEqual(b.height, 1440 * 0.8);
  assert.strictEqual(b.left + b.width / 2, 1280, 'centred between the side tabs, which is the window here');
  const narrow = box({ width: 1200, height: 1440 }, { top: 0, left: 0, right: 1200 });
  assert.strictEqual(narrow.width, 840, '70vw when that is the smaller');
});

test('a floating panel keeps every tab on the rim in reach', () => {
  const view = { width: 1440, height: 900 };
  const clear = { top: 210, left: 300, right: 1140 };
  const b = box(view, clear);
  assert.ok(b.top >= clear.top + 12, 'it hangs below the far edge’s tabs');
  assert.ok(b.left >= clear.left + 12 && b.left + b.width <= clear.right - 12, 'and between the side ones');
  assert.ok(b.top + b.height <= view.height - 12, 'and inside the window');
  assert.ok(near(b.left + b.width / 2, 720), 'centred between them');
});

test('on a window too narrow for both, the page stays readable and reaches over the side tabs', () => {
  const b = box({ width: 900, height: 700 }, { top: 150, left: 260, right: 640 });
  assert.strictEqual(b.width, 560, 'the floor wins over keeping the side tabs clear');
  assert.ok(b.left >= 12 && b.left + b.width <= 900 - 12, 'but never past the window');
  assert.ok(b.top >= 162, 'and the far tabs are still kept clear');
});

test('a panel never has a negative size, whatever the rim measured', () => {
  const b = box({ width: 300, height: 200 }, { top: 400, left: 200, right: 100 });
  assert.ok(b.width >= 0 && b.height >= 0, JSON.stringify(b));
});

test('with the far edge bare of tabs, the panel hangs from the top of the window', () => {
  const view = { width: 1440, height: 900 };
  const b = box(view, { top: 0, left: 298, right: 1130 }, 41);
  assert.strictEqual(b.top, 41, 'a gap below the window’s top, nothing to hang below');
  assert.ok(near(b.left + b.width / 2, 714), 'centred between the side edges’ tabs');
  assert.ok(b.left >= 298 + 41 && b.left + b.width <= 1130 - 41, 'and clear of them, labels and all');
});

test('tucked at the foot, the panel is still between the side tabs, clear of the account’s group', () => {
  /* The tucked bar is the panel slid down, the same left and width: so the
     question is whether the box is clear of the chips at the near end of
     the left edge, which stand as low as the bar does. Measured-like
     windows: chips and their labels' reach, in window pixels. */
  const windows = [
    { view: { width: 1440, height: 900 }, chipsL: 90,  reachL: 298, chipsR: 1350, reachR: 1130 },
    { view: { width: 1280, height: 800 }, chipsL: 80,  reachL: 270, chipsR: 1200, reachR: 1010 },
    /* The narrowest the table is offered at: the labels' room leaves less
       than the floor, which wins — but only over the room labels open into,
       never as far as a chip. */
    { view: { width: 900,  height: 700 }, chipsL: 70,  reachL: 250, chipsR: 830,  reachR: 650 },
  ];
  for (const { view, chipsL, reachL, chipsR, reachR } of windows) {
    const gap = 12 + 0.02 * view.width;
    const b = box(view, { top: 0, left: reachL, right: reachR }, gap);
    assert.ok(b.left > chipsL && b.left + b.width < chipsR,
      `${view.width}×${view.height}: the bar [${b.left}, ${b.left + b.width}] reaches a chip`);
    if (reachR - reachL - 2 * gap >= 560) {
      assert.ok(b.left >= reachL + gap - 1e-9 && b.left + b.width <= reachR - gap + 1e-9,
        `${view.width}×${view.height}: and the labels’ room too`);
    } else {
      assert.strictEqual(b.width, 560, 'the floor wins on a window too narrow for both');
    }
  }
});

// ── The table, fitted to the window ──────────────────────────────────────

/* Where the plane's own outer corners are drawn at rest, for a fitted box:
 * the matrix of tablePlaneMatrix with the mat at the plane's corner, so u, v
 * are the plane's own pixels. */
function fittedCorners(view, perspective = 1400, top) {
  const box = app.copy(app.sandbox.tableFitSize(view, top === undefined ? { perspective } : { perspective, top }));
  const m = app.sandbox.tablePlaneMatrix({
    perspective, origin: { x: view.width / 2, y: view.height / 2 },
    plane: { left: box.left, top: box.top, origin: { x: box.width / 2, y: box.height / 2 } },
    mat: { left: 0, top: 0 },
  });
  const at = (u, v) => app.copy(app.sandbox.tableProject(m, u, v, 0));
  return { box, farLeft: at(0, 0), farRight: at(box.width, 0), nearLeft: at(0, box.height), nearRight: at(box.width, box.height) };
}

test('the table at rest fills the window: near corners at the bottom corners, far edge at the top', () => {
  for (const view of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1280, height: 800 }, { width: 2560, height: 1440 }, { width: 960, height: 1000 }]) {
    const c = fittedCorners(view, 1400, 30);
    const g = 8;
    const ok = (a, b) => near(a, b, 1e-6);
    assert.ok(ok(c.nearLeft.x, g) && ok(c.nearLeft.y, view.height - g), `${view.width}×${view.height} near left ${JSON.stringify(c.nearLeft)}`);
    assert.ok(ok(c.nearRight.x, view.width - g) && ok(c.nearRight.y, view.height - g), `near right ${JSON.stringify(c.nearRight)}`);
    assert.ok(ok(c.farLeft.y, 30) && ok(c.farRight.y, 30), `the far edge at the room asked for: ${c.farLeft.y}`);
    assert.ok(c.farRight.x - c.farLeft.x < c.nearRight.x - c.nearLeft.x, 'and narrower, as a far edge is');
    assert.ok(ok(c.farLeft.x + c.farRight.x, view.width), 'centred across the window');
  }
});

test('the table is fitted with no perspective too, and not at all into nothing', () => {
  const flat = app.copy(app.sandbox.tableFitSize({ width: 1000, height: 800 }, { perspective: Infinity, gutter: 0, top: 0 }));
  assert.ok(near(flat.width, 1000) && near(flat.height * Math.cos(24 * Math.PI / 180), 800),
    `flat, the tilt only foreshortens it: ${JSON.stringify(flat)}`);
  assert.strictEqual(app.sandbox.tableFitSize({ width: 0, height: 800 }, { perspective: 1400 }), null);
  assert.strictEqual(app.sandbox.tableFitSize({ width: 800, height: 800 }, { perspective: 10 }), null,
    'a near edge that would be behind the eye is no fit');
});

// ── From the screen to the mat ───────────────────────────────────────────

/* The scene as the stylesheet draws it in a 1440×900 window: the perspective
 * and its origin, the plane's untransformed box and its origin, the mat's
 * place inside it. The numbers are a plausible layout, not the measured one —
 * what is under test is the mapping, for any layout. */
const GEOM = {
  perspective: 1400,
  origin: { x: 720, y: 450 },
  plane: { left: 86, top: 108, origin: { x: 634, y: 342 } },
  mat:   { left: 198, top: 75 },
};
const MAT = { width: 872, height: 573 };
const AT_REST = { tilt: REST, camera: { zoom: 1, tx: 0, ty: 0 } };
const view = (x, y, zoom) => ({ tilt: REST, camera: camera(x, y, zoom) });
const VIEWS = [AT_REST, view(0, 0, 1), view(1440, 900, 1), view(300, 820, 1.4), view(100, 60, 2.5), view(1400, 880, 2)];
const matrix = v => app.evaluate(`tablePlaneMatrix(${JSON.stringify({ ...GEOM, ...v })})`);
const project = (m, u, v, z = 0) => app.copy(app.sandbox.tableProject(m, u, v, z));
const unproject = (m, x, y, z = 0) => app.copy(app.sandbox.tableUnproject(m, x, y, z));

test('with no tilt, no perspective and the camera at rest the mat is where its box is', () => {
  const m = app.evaluate(`tablePlaneMatrix(${JSON.stringify({ ...GEOM, perspective: Infinity, tilt: 0 })})`);
  const at = unproject(m, 500, 400);
  assert.ok(near(at.u, 500 - 86 - 198) && near(at.v, 400 - 108 - 75),
    `the screen point minus the plane's and the mat's offsets, not ${JSON.stringify(at)}`);
});

test('a point of the mat and the screen point it lands on map back to each other', () => {
  for (const v of VIEWS) {
    const m = matrix(v);
    for (const z of [0, 15, 96]) {
      for (const [u, w] of [[0, 0], [MAT.width, 0], [0, MAT.height], [MAT.width, MAT.height], [311, 207]]) {
        const screen = project(m, u, w, z);
        assert.ok(screen, `${u},${w} at ${z}px is in front of the eye`);
        const back = unproject(m, screen.x, screen.y, z);
        assert.ok(near(back.u, u, 1e-6) && near(back.v, w, 1e-6),
          `${u},${w} at ${z}px came back as ${back.u},${back.v} for ${JSON.stringify(v)}`);
      }
    }
  }
});

/* The same question answered a second way, from scratch: undo the camera —
 * a zoom and a move of the flat picture, so a window point is the picture's
 * point (x − tx) / zoom — then cast the ray from the eye through that point
 * and intersect it with the tilted plane. The eye of a CSS perspective sits
 * `perspective` pixels in front of its origin, and the plane is the mat's
 * affine image — the matrix with no perspective and no camera in it. If the
 * closed-form inverse were wrong it could still round-trip its own
 * projection; this is what it would disagree with. */
function rayCast(v, x, y, z = 0) {
  const { zoom, tx, ty } = v.camera;
  const px = (x - tx) / zoom, py = (y - ty) / zoom;
  const affine = app.evaluate(`tablePlaneMatrix(${JSON.stringify({ ...GEOM, perspective: Infinity, tilt: v.tilt })})`);
  const apply = (u, w, h) => [0, 1, 2].map(r => affine[r * 4] * u + affine[r * 4 + 1] * w + affine[r * 4 + 2] * h + affine[r * 4 + 3]);
  const p0 = apply(0, 0, z);
  const du = apply(1, 0, z).map((n, i) => n - p0[i]);
  const dv = apply(0, 1, z).map((n, i) => n - p0[i]);
  const eye = [GEOM.origin.x, GEOM.origin.y, GEOM.perspective];
  const dir = [px - eye[0], py - eye[1], -eye[2]];
  // eye + t·dir = p0 + u·du + v·dv  →  u·du + v·dv − t·dir = eye − p0
  const rhs = eye.map((n, i) => n - p0[i]);
  const cols = [du, dv, dir.map(n => -n)];
  const det3 = (a, b, c) =>
    a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
  const D = det3(...cols);
  return { u: det3(rhs, cols[1], cols[2]) / D, v: det3(cols[0], rhs, cols[2]) / D };
}

test('the screen-to-mat mapping is the ray from the eye meeting the tilted plane, through the camera', () => {
  for (const v of VIEWS) {
    const m = matrix(v);
    for (const [x, y] of [[720, 450], [300, 200], [1200, 760], [500, 640]]) {
      for (const z of [0, 96]) {
        const fast = unproject(m, x, y, z);
        const slow = rayCast(v, x, y, z);
        assert.ok(near(fast.u, slow.u, 1e-6) && near(fast.v, slow.v, 1e-6),
          `${x},${y} at ${z}px: ${fast.u},${fast.v} against the ray's ${slow.u},${slow.v} for ${JSON.stringify(v.camera)}`);
      }
    }
  }
});

test('a wheel step leaves the point of the mat under the pointer where it was', () => {
  for (const [x, y] of [[720, 450], [210, 160], [1250, 800], [40, 870]]) {
    let zoom = 1;
    const before = unproject(matrix(view(x, y, zoom)), x, y);
    for (const dy of [-100, -100, -37, -300, 120, -4]) {
      zoom = app.evaluate(`tableWheelZoom(${zoom}, ${dy}, 0)`);
      const now = unproject(matrix(view(x, y, zoom)), x, y);
      assert.ok(Math.hypot(now.u - before.u, now.v - before.v) < 1e-6,
        `${x},${y} at zoom ${zoom}: ${now.u},${now.v} against ${before.u},${before.v}`);
    }
    /* At a card's height too: a card held while the wheel turns stays under
       the hand. */
    const held0 = unproject(matrix(view(x, y, 1)), x, y, 96);
    const held1 = unproject(matrix(view(x, y, 2.2)), x, y, 96);
    assert.ok(Math.hypot(held1.u - held0.u, held1.v - held0.v) < 1e-6, 'and at a held card’s height');
  }
});

test('the table leans away: its far edge is drawn narrower than its near edge', () => {
  const m = matrix(AT_REST);
  const width = v => project(m, MAT.width, v).x - project(m, 0, v).x;
  assert.ok(width(0) < MAT.width && width(MAT.height) > MAT.width,
    `far ${width(0)} and near ${width(MAT.height)} against an untilted ${MAT.width}`);
  assert.ok(project(m, 0, 0).y > GEOM.plane.top + GEOM.mat.top,
    'and the far edge is drawn lower than it is laid out, as a receding edge is');
});

test('panning and zooming never turn the table', () => {
  /* The camera only moves and scales the picture, so a line across the mat
     is drawn level however the camera stands, and in the same proportion. */
  const shape = v => {
    const m = matrix(v);
    const a = project(m, 0, 300), b = project(m, MAT.width, 300), c = project(m, 0, 0), d = project(m, 0, MAT.height);
    return { level: b.y - a.y, ratio: (b.x - a.x) / (d.y - c.y) };
  };
  const rest = shape(AT_REST);
  for (const v of VIEWS) {
    const s = shape(v);
    assert.ok(near(s.level, 0, 1e-9), `level across for ${JSON.stringify(v.camera)}`);
    assert.ok(near(s.ratio, rest.ratio, 1e-9), `and the same shape: ${s.ratio} against ${rest.ratio}`);
  }
});

test('a card held above the mat is nearer the eye than the felt under it', () => {
  const m = matrix(AT_REST);
  const felt = project(m, 120, 480, 0);
  const held = project(m, 120, 480, 96);
  const fromCentre = p => Math.hypot(p.x - GEOM.origin.x, p.y - GEOM.origin.y);
  assert.ok(fromCentre(held) > fromCentre(felt), 'nearer is further from the vanishing point');
  /* And so the pointer over a held card is not over the same point of the
     felt: the mapping has to be asked at the card's height, or the card
     would slide out from under the hand as it rose. */
  const under = unproject(m, held.x, held.y, 0);
  assert.ok(Math.hypot(under.u - 120, under.v - 480) > 5,
    'the felt under a held card is a different point of the mat');
});

test('a point behind the eye has nowhere to land', () => {
  const m = matrix(AT_REST);
  assert.strictEqual(app.sandbox.tableProject(m, 100, 100, 5000), null);
});

test('a computed origin is read as two pixel offsets, whatever form it comes in', () => {
  const origin = (value, w = 1000, h = 600) => app.call('tableParseOrigin', value, w, h);
  assert.deepStrictEqual(origin('720px 450px'), { x: 720, y: 450 });
  assert.deepStrictEqual(origin('634px 342px 0px'), { x: 634, y: 342 }, 'a transform-origin has a z');
  assert.deepStrictEqual(origin('50% 25%'), { x: 500, y: 150 });
  assert.deepStrictEqual(origin(''), { x: 500, y: 300 }, 'nothing readable is the centre');
  assert.deepStrictEqual(origin('center center'), { x: 500, y: 300 });
});

test('the transforms the table is drawn with are the ones the mapping is made from', () => {
  // The camera's CSS names the same two in the same order as the matrix composes them.
  const css = app.evaluate('tableCameraTransform({ zoom: 1.5, tx: -21.6, ty: 13.5 })');
  assert.strictEqual(css, 'translate(-21.60px, 13.50px) scale(1.50000)');
  // And the plane's tilt is the stylesheet's, by the number the script hands it.
  const sheet = read('public/css/table.css');
  assert.match(sheet, /\.table-plane\s*\{[^}]*transform:\s*rotateX\(var\(--table-tilt/, 'the plane is tilted by --table-tilt');
  assert.match(sheet, /\.table-camera\s*\{[^}]*transform-origin:\s*0 0/, 'and the camera is read about its corner');
  assert.match(read('public/js/tablemode.js'), /setProperty\('--table-tilt', `\$\{TABLE_TILT_REST\}deg`\)/,
    'which is TABLE_TILT_REST');
});

// ── Laying cards ──────────────────────────────────────────────────────────

const cards = (n, group = () => null) =>
  Array.from({ length: n }, (_, i) => ({ name: `Card ${i}`, group: group(i) }));
const layout = (list, w = MAT.width, h = MAT.height) =>
  app.copy(app.evaluate(`tableLayout(${JSON.stringify(list)}, ${w}, ${h})`));

test('no more than sixty cards are laid, and every one lies on the mat', () => {
  const laid = layout(cards(80, i => i % 5));
  assert.strictEqual(laid.spots.length, 60);
  const halfW = laid.width / 2 / MAT.width, halfH = laid.height / 2 / MAT.height;
  for (const spot of laid.spots) {
    assert.ok(spot.x >= halfW - 1e-9 && spot.x <= 1 - halfW + 1e-9, `x ${spot.x} hangs off the mat`);
    assert.ok(spot.y >= halfH - 1e-9 && spot.y <= 1 - halfH + 1e-9, `y ${spot.y} hangs off the mat`);
    assert.ok(Math.abs(spot.turn) <= 5 + 2.5, `a card lies at ${spot.turn}°`);
  }
});

test('a card is drawn about a tenth of the mat wide, in a card’s own shape', () => {
  const laid = layout(cards(3));
  assert.ok(laid.width >= 72 && laid.width <= 150, `${laid.width}px`);
  assert.ok(near(laid.height / laid.width, 88 / 63), 'the 63×88 of a real card');
  assert.strictEqual(app.evaluate('tableCardWidth(4000)'), 150, 'a huge mat does not draw a card the size of a hand');
  assert.strictEqual(app.evaluate('tableCardWidth(100)'), 72, 'and a small one still draws a card you can see');
});

test('the same cards lie the same way every time', () => {
  const list = cards(24, i => (i < 10 ? 'Creature' : 'Land'));
  assert.deepStrictEqual(layout(list), layout(list));
});

test('a group is a pile: its cards lie together, apart from the next pile', () => {
  const list = cards(30, i => ['Creature', 'Instant', 'Land'][i % 3]);
  const { spots } = layout(list);
  const centre = g => {
    const mine = spots.filter((_, i) => list[i].group === g);
    return { x: mine.reduce((s, p) => s + p.x, 0) / mine.length, y: mine.reduce((s, p) => s + p.y, 0) / mine.length };
  };
  const groups = ['Creature', 'Instant', 'Land'];
  const centres = Object.fromEntries(groups.map(g => [g, centre(g)]));
  spots.forEach((spot, i) => {
    const own = centres[list[i].group];
    const dist = c => Math.hypot(spot.x - c.x, spot.y - c.y);
    for (const g of groups) {
      if (g === list[i].group) continue;
      assert.ok(dist(own) < dist(centres[g]), `${list[i].name} lies nearer the ${g} pile than its own`);
    }
  });
});

/* Every two cards of a pile either lie a third of a card apart across, or on
 * different rows at least half a card apart down: nothing is hidden behind
 * its neighbour but a sliver. */
function assertReadable(list, laid, label) {
  const { spots, width: w, height: h } = laid;
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      if (list[i].group !== list[j].group) continue;
      const dx = Math.abs(spots[i].x - spots[j].x) * MAT.width;
      const dy = Math.abs(spots[i].y - spots[j].y) * MAT.height;
      assert.ok(dx >= w / 3 - 0.5 || dy >= h / 2 - 0.5,
        `${label}: ${list[i].name} and ${list[j].name} lie ${dx.toFixed(1)}px across and ${dy.toFixed(1)}px down`);
    }
  }
}

test('one big pile wraps onto rows down the mat, never tighter than a third of a card', () => {
  const list = cards(60);
  const laid = layout(list);
  assertReadable(list, laid, 'sixty in one pile');
  const ys = laid.spots.map(s => s.y);
  assert.ok((Math.max(...ys) - Math.min(...ys)) * MAT.height >= MAT.height / 2,
    'the rows use the mat’s height rather than one band across its middle');
});

test('a few piles of many cards each wrap the same way inside their own slots', () => {
  for (const [n, groups] of [[60, 2], [60, 4], [45, 3], [30, 1]]) {
    const list = cards(n, i => `g${i % groups}`);
    assertReadable(list, layout(list), `${n} cards in ${groups} piles`);
  }
});

test('how many rows a pile is laid in', () => {
  const rows = (count, room, slotH, w = 87, h = 87 * 88 / 63) => app.evaluate(`tableFanRows(${count}, ${room}, ${slotH}, ${w}, ${h})`);
  assert.strictEqual(rows(1, 700, 500), 1);
  assert.strictEqual(rows(5, 700, 500), 1, 'a fan that opens all the way in one row keeps to it');
  assert.strictEqual(rows(60, 724, 512), 4, 'more rows than strictly needed when the height has room for them');
  assert.strictEqual(rows(60, 724, 130), 3, 'and only what a third of a card needs when it has not');
  assert.strictEqual(rows(60, 0, 512), 60, 'a slot no wider than a card stacks them');
});

test('a mat with nothing to lay, or no size, lays nothing out of place', () => {
  assert.deepStrictEqual(layout([]).spots, []);
  assert.deepStrictEqual(layout(cards(2), 0, 0).spots, [{ x: 0.5, y: 0.5, turn: 0 }, { x: 0.5, y: 0.5, turn: 0 }]);
  const one = layout(cards(1));
  assert.ok(near(one.spots[0].x, 0.5, 0.01) && near(one.spots[0].y, 0.5, 0.01), 'one card lies in the middle');
});

// ── Each tab's cards ──────────────────────────────────────────────────────

/* A tab's source, asked with the renderer's getters stubbed into the sandbox
 * as the page's would be — each named global the sources look for, put there
 * for the one question and taken away again. */
function ask(tab, globals = {}) {
  const sandbox = app.sandbox;
  const before = new Map(Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(sandbox, k)]));
  Object.assign(sandbox, globals);
  try {
    return sandbox.tableSourceFor(tab);
  } finally {
    for (const [k, d] of before) { if (d) Object.defineProperty(sandbox, k, d); else delete sandbox[k]; }
  }
}
const plain = value => JSON.parse(JSON.stringify(value));

test('sixty cards are shared out fairly across the piles a tab has', () => {
  const share = (sizes, max) => app.call('tableFairShare', sizes, max);
  assert.deepStrictEqual(share([100, 3], 60), [57, 3], 'a small pile is laid whole, and the rest goes to the deep one');
  assert.deepStrictEqual(share([10, 10, 10], 60), [10, 10, 10], 'what fits is laid whole');
  assert.deepStrictEqual(share([80], 60), [60]);
  assert.deepStrictEqual(share([], 60), []);
  assert.deepStrictEqual(share([5, 0, 5], 4), [2, 0, 2], 'an empty pile takes nothing');
  const many = share(Array(26).fill(9), 60);
  assert.strictEqual(many.reduce((s, n) => s + n, 0), 60);
  assert.ok(many.every(n => n >= 2 && n <= 3), `every pile of the 26 is on the table: ${many}`);
  assert.ok(share([1, 2], 1).reduce((s, n) => s + n, 0) === 1, 'never more than the cap');
});

test('a tab’s piles become one list, each card carrying its pile as its group', () => {
  const piles = [
    { label: 'Creature', cards: [{ n: 'Llanowar Elves' }, { n: 'Elvish Mystic' }] },
    { label: 'Land', cards: [] },
    { key: 'p2', label: 'Ann', cards: [{ n: 'Forest' }, { n: '' }] },
  ];
  const laid = plain(app.sandbox.tableFromPiles(piles, card => ({ name: card.n })));
  assert.deepStrictEqual(laid, [
    { name: 'Llanowar Elves', group: 'Creature' },
    { name: 'Elvish Mystic', group: 'Creature' },
    { name: 'Forest', group: 'p2' },
  ], 'an empty pile is no pile, a card with no name is not laid, and a key outranks a label');
  assert.deepStrictEqual(plain(app.sandbox.tableFromPiles(null, c => c)), []);
});

test('every tab with cards has a source, and no other tab does', () => {
  const tabs = app.copy(app.evaluate('TABLE_CARD_TABS'));
  assert.deepStrictEqual([...tabs].sort(), app.copy(app.evaluate('Object.keys(TABLE_SOURCES)')).sort());
  for (const tab of APP_TABS.filter(t => !tabs.includes(t))) {
    assert.strictEqual(ask(tab), null, `${tab} would lay cards over the ones on the mat`);
  }
  assert.strictEqual(ask('toString'), null, 'nothing inherited is a source');
});

test('Collections lays the rows on show, in the stack view’s piles, at most sixty', () => {
  const rows = n => Array.from({ length: n }, (_, i) => ({ name: `Card ${i}` }));
  const src = ask('collections', {
    colShownPiles: () => [{ label: 'Creature', cards: rows(70) }, { label: 'Land', cards: [{ name: 'Forest' }] }],
    scryfallCache: new Map([['Forest', 'forest.jpg']]),
  });
  assert.strictEqual(src.cards.length, 60);
  assert.deepStrictEqual(plain(src.cards.at(-1)), { name: 'Forest', imageUrl: 'forest.jpg', group: 'Land' },
    'the one land is laid even behind seventy creatures');
  assert.strictEqual(src.cards[0].imageUrl, '', 'a card with no picture yet is laid without one…');
  assert.strictEqual(src.fetch, true, '…and its picture is asked for');
  const none = ask('collections', { colShownPiles: () => null });
  assert.deepStrictEqual(plain(none.cards), []);
  assert.ok(none.hint);
});

test('the Deck Builder lays a pile per category, or asks for a deck', () => {
  const none = ask('deckview', { dbShownPiles: () => null });
  assert.deepStrictEqual(plain(none.cards), []);
  assert.strictEqual(none.hint, 'Open a deck from Decks');
  const src = ask('deckview', {
    dbShownPiles: () => [
      { label: 'Ramp', cards: [{ name: 'Sol Ring', image: 'printing.jpg' }, { name: 'Arcane Signet', image: '' }] },
      { label: 'Lands', cards: [{ name: 'Command Tower', image: '' }] },
    ],
    scryfallCache: new Map([['Arcane Signet', 'signet.jpg']]),
  });
  assert.deepStrictEqual(plain(src.cards), [
    { name: 'Sol Ring', imageUrl: 'printing.jpg', group: 'Ramp' },
    { name: 'Arcane Signet', imageUrl: 'signet.jpg', group: 'Ramp' },
    { name: 'Command Tower', imageUrl: '', group: 'Lands' },
  ], 'the deck’s own printing first, the oracle picture where it has none');
});

test('Decks lays one card per deck, and pressing one opens it in the Deck Builder', () => {
  const opened = [];
  const src = ask('players', {
    decksShown: () => [
      { key: '', label: '', playerId: 'p1', decks: [{ id: 'd1', name: 'Elves', commanderImg: 'art.jpg' }] },
      { key: 'f1', label: 'Cube', playerId: 'p1', decks: [{ id: 'd2', name: '', commanderImg: null }] },
    ],
    openInDeckView: (player, deck) => opened.push([player, deck]),
  });
  assert.deepStrictEqual(plain(src.cards.map(c => [c.name, c.id, c.imageUrl, c.group])), [
    ['Elves', 'p1|d1', 'art.jpg', ''],
    ['Untitled deck', 'p1|d2', '', 'f1'],
  ]);
  assert.ok(!src.fetch, 'a deck’s name is not a card’s, so no picture is asked for by it');
  const laid = app.sandbox.tableKeyCards(src.cards, 'players');
  assert.strictEqual(typeof laid[0].open, 'function', 'the open is kept on the card the mat holds');
  /* The stub has gone back out of the sandbox by now, as it would never have
     been there in the page; put it in for the press. */
  app.sandbox.openInDeckView = (player, deck) => opened.push([player, deck]);
  try { laid[1].open(); } finally { delete app.sandbox.openInDeckView; }
  assert.deepStrictEqual(opened, [['p1', 'd2']]);
});

test('Scryfall Search lays its results in their order, a two-faced card by its front', () => {
  const src = ask('scryfall', {
    sfShownCards: () => [
      { id: 'a', name: 'Shivan Dragon', image_uris: { normal: 'shivan.jpg' } },
      { id: 'b', name: 'Delver of Secrets // Insectile Aberration', card_faces: [{ image_uris: { normal: 'delver.jpg' } }, {}] },
    ],
  });
  assert.deepStrictEqual(plain(src.cards.map(c => [c.name, c.id, c.imageUrl])), [
    ['Shivan Dragon', 'a', 'shivan.jpg'],
    ['Delver of Secrets // Insectile Aberration', 'b', 'delver.jpg'],
  ]);
  assert.deepStrictEqual(plain(ask('scryfall', { sfShownCards: () => [] }).cards), []);
});

test('the Set Browser lays the open set in its piles, or asks for a set', () => {
  assert.deepStrictEqual(plain(ask('sets', { setShownPiles: () => null }).cards), []);
  assert.ok(ask('sets', { setShownPiles: () => null }).hint);
  const src = ask('sets', {
    setShownPiles: () => [{ label: 'Rare', cards: [{ id: 'r', name: 'Rare One', image_uris: { normal: 'r.jpg' } }] }],
  });
  assert.deepStrictEqual(plain(src.cards), [{ name: 'Rare One', id: 'r', imageUrl: 'r.jpg', group: 'Rare' }]);
});

test('Want Lists lays a pile per list, and a card two people want is on both', () => {
  const src = ask('wants', {
    wantShownLists: () => [
      { key: 'p1', label: 'Ann', cards: ['Sol Ring', 'Mox Opal'] },
      { key: 'p2', label: 'Bo', cards: ['Sol Ring'] },
    ],
    wantCardData: new Map([['Sol Ring', { image_uris: { normal: 'sol.jpg' } }]]),
  });
  assert.deepStrictEqual(plain(src.cards.map(c => [c.name, c.id, c.group, c.imageUrl])), [
    ['Sol Ring', 'p1:Sol Ring', 'p1', 'sol.jpg'],
    ['Mox Opal', 'p1:Mox Opal', 'p1', ''],
    ['Sol Ring', 'p2:Sol Ring', 'p2', 'sol.jpg'],
  ]);
  const keys = app.sandbox.tableKeyCards(src.cards, 'wants').map(c => c.key);
  assert.strictEqual(new Set(keys).size, 3, 'the two copies are two cards, each with its own place');
});

test('the Card tab lays its card large, and leaves the mat alone with no card', () => {
  assert.strictEqual(ask('card', { cardDetailShown: () => null }), null);
  const src = ask('card', { cardDetailShown: () => ({ name: 'Sol Ring', id: 'x', imageUrl: 'sol.jpg' }) });
  assert.deepStrictEqual(plain(src), { cards: [{ name: 'Sol Ring', id: 'x', imageUrl: 'sol.jpg' }], feature: true });
});

test('the Card tab’s card lies in a lane down the mat’s right, clear of the sheet', () => {
  const laid = app.copy(app.evaluate(`tableFeatureLayout([{ name: 'Sol Ring' }], ${MAT.width}, ${MAT.height})`));
  assert.ok(near(laid.height / laid.width, 88 / 63, 0.01));
  assert.ok(laid.height <= MAT.height * 0.78 + 1, 'it fits the mat’s height');
  assert.ok(laid.width <= MAT.width * 0.3 + 1, 'and leaves the sheet most of the width');
  assert.ok(laid.lane > laid.width && laid.lane < MAT.width / 2);
  const [spot] = laid.spots;
  const left = spot.x * MAT.width - laid.width / 2, right = spot.x * MAT.width + laid.width / 2;
  assert.ok(left > MAT.width - laid.lane, 'its left edge is inside the lane the sheet keeps clear of');
  assert.ok(right < MAT.width, 'and its right edge is on the mat');
  assert.ok(near(spot.y, 0.5));
  assert.deepStrictEqual(app.copy(app.evaluate('tableFeatureLayout([{ name: "A" }], 0, 0)')).spots, [{ x: 0.5, y: 0.5, turn: 0 }]);
});

test('a card is known by its tab, its id or name, and which copy it is', () => {
  const keys = (list, scope) => app.sandbox.tableKeyCards(list, scope).map(c => c.key);
  assert.deepStrictEqual(keys([{ name: 'Forest' }, { name: 'Forest' }, { name: 'Sol Ring', id: 'abc' }], 'collections'),
    ['collections:Forest#1', 'collections:Forest#2', 'collections:abc#1']);
  assert.deepStrictEqual(keys([{ name: 'Forest' }]), ['Forest#1'], 'a list laid through the API with no tab keeps the old keys');
  assert.deepStrictEqual(keys([{ name: 'B' }, { name: 'A' }], 'x'), ['x:B#1', 'x:A#1'],
    'a key follows its card, not its place in the list');
  assert.notDeepStrictEqual(keys([{ name: 'Sol Ring' }], 'collections'), keys([{ name: 'Sol Ring' }], 'deckview'),
    'the same card on two tabs is two cards: moving one does not move the other');
});

test('a card a hand moved keeps its place when the tab lays its cards again', () => {
  const sb = app.sandbox;
  const first = sb.tableKeyCards([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 'collections');
  const moved = new Map([[first[1].key, { x: 0.9, y: 0.1, turn: 3 }]]);
  /* Sorted the other way, one card gone and one new: B is still where it was put. */
  const again = sb.tableKeyCards([{ name: 'D' }, { name: 'C' }, { name: 'B' }], 'collections');
  const spots = [{ x: 0.2, y: 0.2, turn: 0 }, { x: 0.4, y: 0.4, turn: 1 }, { x: 0.6, y: 0.6, turn: 2 }];
  const places = plain(sb.tablePlaceCards(again, spots, moved));
  assert.deepStrictEqual(places[2], { x: 0.9, y: 0.1, turn: 3 }, 'B lies where the hand put it');
  assert.deepStrictEqual(places[0], spots[0], 'a card no hand moved takes its place in the new layout');
  assert.deepStrictEqual(places[1], spots[1]);
  const elsewhere = sb.tableKeyCards([{ name: 'B' }], 'wants');
  assert.deepStrictEqual(plain(sb.tablePlaceCards(elsewhere, spots, moved))[0], spots[0],
    'and the same name laid by another tab is not taken for it');
});

test('a redraw that only brought pictures is not a new layout', () => {
  const sig = (list, scope = 'collections', feature = false) => app.sandbox.tableListSig(list, scope, feature);
  const list = [{ name: 'A', group: 'x' }, { name: 'B', group: 'y' }];
  assert.strictEqual(sig(list), sig(list.map(c => ({ ...c, imageUrl: `${c.name}.jpg` }))));
  assert.notStrictEqual(sig(list), sig([...list].reverse()), 'a new order is a new layout');
  assert.notStrictEqual(sig(list), sig(list.map(c => ({ ...c, group: 'z' }))), 'and so are new piles');
  assert.notStrictEqual(sig(list), sig(list, 'sets'), 'and another tab’s cards');
  assert.notStrictEqual(sig(list), sig(list, 'collections', true), 'and the same card laid large');
});

test('a panel opens tucked only between tabs with cards, after the user tucked one', () => {
  const open = o => app.sandbox.tableTuckOnOpen(o);
  assert.strictEqual(open({ kind: 'float', from: 'collections', to: 'scryfall', kept: true }), true);
  assert.strictEqual(open({ kind: 'float', from: 'collections', to: 'scryfall', kept: false }), false,
    'the user brought the last one back up');
  assert.strictEqual(open({ kind: 'float', from: 'collections', to: 'lands', kept: true }), false,
    'a tab without cards never tucks on its own');
  assert.strictEqual(open({ kind: 'float', from: 'lands', to: 'collections', kept: true }), false,
    'nor does one opened from a tab without cards');
  assert.strictEqual(open({ kind: 'float', from: null, to: 'collections', kept: true }), false,
    'nor one opened onto a bare table');
  assert.strictEqual(open({ kind: 'grow', from: 'collections', to: 'card', kept: true }), false,
    'the Card tab’s sheet lies on the table and never tucks');
});

test('cards laid by something done in the pane tuck the panel; typing and polls do not', () => {
  const auto = o => app.sandbox.tableShouldAutoTuck({ kind: 'float', tab: 'scryfall', tucked: false, ...o });
  assert.strictEqual(auto({ actedAgo: 1500 }), true, 'a search came back');
  assert.strictEqual(auto({ actedAgo: Infinity }), false, 'nothing was done: a poll, the pictures, typing');
  assert.strictEqual(auto({ actedAgo: 60000 }), false, 'too long ago to be its answer');
  assert.strictEqual(auto({ actedAgo: 1500, tucked: true }), false, 'already tucked');
  assert.strictEqual(auto({ actedAgo: 1500, tab: 'admin' }), false, 'a tab without cards');
  assert.strictEqual(auto({ actedAgo: 1500, tab: 'card', kind: 'grow' }), false, 'a sheet on the mat');
  assert.strictEqual(auto({ actedAgo: -5 }), false, 'a clock that went backwards is not an action');
});

// ── The Deck Builder's table: the commander, the slip and the bin ──────────

/* A card's box on the mat, in the mat's pixels, unturned: its centre from its
 * spot and its size from the layout, a head card's TABLE_HEAD_SCALE times. */
const HEAD_SCALE = app.evaluate('TABLE_HEAD_SCALE');
function boxOf(list, laid, i, mat = MAT) {
  const k = list[i].head ? HEAD_SCALE : 1;
  const w = laid.width * k, h = laid.height * k;
  const cx = laid.spots[i].x * mat.width, cy = laid.spots[i].y * mat.height;
  return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2, w, h };
}
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const deckList = (heads, n, groups = 4) => [
  ...Array.from({ length: heads }, (_, i) => ({ name: `Commander ${i}`, head: true, group: 'commander' })),
  ...cards(n, i => `cat${i % groups}`),
];

test('the commander lies front and centre at the far side, a tenth larger than the rest', () => {
  assert.ok(near(HEAD_SCALE, 1.1), 'about a tenth larger');
  const list = deckList(1, 40);
  const laid = layout(list);
  const head = boxOf(list, laid, 0);
  assert.ok(near(laid.spots[0].x, 0.5, 1e-9), 'centred across the mat');
  for (let i = 1; i < list.length; i++) {
    assert.ok(head.top <= boxOf(list, laid, i).top, `${list[i].name} lies further back than the commander`);
  }
  assert.ok(head.top >= 0, 'and it is on the mat');
  assert.ok(near(head.w, laid.width * 1.1) && near(head.h / head.w, 88 / 63), 'in a card’s shape, scaled');
});

test('no pile reaches into the commander’s place, however full the deck', () => {
  for (const [heads, n, groups] of [[1, 59, 8], [2, 58, 8], [1, 59, 1], [2, 20, 3], [1, 5, 2]]) {
    const list = deckList(heads, n, groups);
    const laid = layout(list);
    for (let h = 0; h < heads; h++) {
      const head = boxOf(list, laid, h);
      for (let i = heads; i < list.length; i++) {
        assert.ok(!overlaps(head, boxOf(list, laid, i)),
          `${heads} commander(s), ${n} cards in ${groups} piles: ${list[i].name} lies across ${list[h].name}`);
      }
    }
  }
});

test('two commanders lie side by side, apart, and centred together', () => {
  const list = deckList(2, 30);
  const laid = layout(list);
  const [a, b] = [boxOf(list, laid, 0), boxOf(list, laid, 1)];
  assert.ok(near(laid.spots[0].y, laid.spots[1].y, 1e-9), 'on one line');
  assert.ok(a.right < b.left, 'not overlapping, the first on the left');
  assert.ok(near(b.left - a.right, laid.width * app.evaluate('TABLE_HEAD_GAP')), 'a quarter of a card apart');
  assert.ok(near((laid.spots[0].x + laid.spots[1].x) / 2, 0.5, 1e-9), 'the pair centred across the mat');
});

test('a deck with no commander is laid exactly as before', () => {
  const list = cards(40, i => `cat${i % 5}`);
  const plainLaid = layout(list);
  assert.deepStrictEqual(app.copy(app.evaluate(`tableLayout(${JSON.stringify(list)}, ${MAT.width}, ${MAT.height}, {})`)), plainLaid);
  assert.deepStrictEqual(app.call('tableHeadSpots', 0, MAT.width, MAT.height, 87, 120), { spots: [], bottom: 0 },
    'no head band at all');
});

test('a band kept along the near edge has no pile card in it', () => {
  const list = deckList(1, 59, 6);
  const band = 80;
  const laid = app.copy(app.evaluate(`tableLayout(${JSON.stringify(list)}, ${MAT.width}, ${MAT.height}, { bottom: ${band} })`));
  for (let i = 0; i < list.length; i++) {
    assert.ok(boxOf(list, laid, i).bottom <= MAT.height - band + 1e-6, `${list[i].name} lies in the slip’s band`);
  }
  const huge = app.copy(app.evaluate(`tableLayout(${JSON.stringify(cards(4))}, ${MAT.width}, ${MAT.height}, { bottom: 99999 })`));
  assert.ok(huge.spots.every(s => Number.isFinite(s.x) && Number.isFinite(s.y)), 'a band past the mat lays nothing out of reach');
});

test('the Deck Builder lays its commanders first, at the head, known by their ref', () => {
  const src = ask('deckview', {
    dbShownPiles: () => [
      { label: 'Ramp', cards: [{ name: 'Sol Ring', image: 'ring.jpg', ref: 'main/Sol Ring', qty: 1 }] },
      { label: 'Creatures', cards: [{ name: 'Tymna the Weaver', image: '', ref: 'main/Tymna the Weaver', qty: 1 }] },
    ],
    dbShownCommanders: () => [
      { name: 'Kraum, Ludevic’s Opus', image: 'kraum.jpg', ref: 'commander/Kraum, Ludevic’s Opus', qty: 1 },
      { name: 'Tymna the Weaver', image: 'tymna.jpg', ref: 'commander/Tymna the Weaver', qty: 1 },
    ],
  });
  assert.deepStrictEqual(plain(src.cards.map(c => [c.name, c.ref, !!c.head, c.group])), [
    ['Kraum, Ludevic’s Opus', 'commander/Kraum, Ludevic’s Opus', true, 'commander'],
    ['Tymna the Weaver', 'commander/Tymna the Weaver', true, 'commander'],
    ['Sol Ring', 'main/Sol Ring', false, 'Ramp'],
    ['Tymna the Weaver', 'main/Tymna the Weaver', false, 'Creatures'],
  ]);
  const keyed = app.sandbox.tableKeyCards(src.cards, 'deckview');
  assert.deepStrictEqual(plain(keyed.map(c => c.key)), [
    'deckview:commander/Kraum, Ludevic’s Opus#1', 'deckview:commander/Tymna the Weaver#1',
    'deckview:main/Sol Ring#1', 'deckview:main/Tymna the Weaver#1',
  ], 'a commander and a mainboard copy of one name are two cards on the mat');
  assert.deepStrictEqual(plain(keyed.map(c => c.ref)), plain(src.cards.map(c => c.ref)), 'and each keeps its ref');
  assert.strictEqual(keyed[0].head, true);

  const none = ask('deckview', { dbShownPiles: () => [{ label: 'Lands', cards: [{ name: 'Forest', image: '', ref: 'main/Forest' }] }],
    dbShownCommanders: () => [] });
  assert.deepStrictEqual(plain(none.cards.map(c => [c.name, !!c.head])), [['Forest', false]], 'no commander, no head');
  const old = ask('deckview', { dbShownPiles: () => [{ label: 'Lands', cards: [{ name: 'Forest', image: '' }] }] });
  assert.strictEqual(old.cards.length, 1, 'a builder with no commander getter still lays its piles');
});

test('the commanders and the piles together are still no more than sixty', () => {
  const heads = [{ name: 'A', ref: 'commander/A' }, { name: 'B', ref: 'commander/B' }];
  const piles = [{ label: 'X', cards: Array.from({ length: 80 }, (_, i) => ({ name: `c${i}`, ref: `main/c${i}` })) }];
  const laid = plain(app.sandbox.tableDeckCards(heads, piles));
  assert.strictEqual(laid.length, 60);
  assert.deepStrictEqual(laid.slice(0, 2).map(c => c.name), ['A', 'B'], 'the commanders are never the ones left off');
});

test('a commander moving between boards is a new card to the mat, not the old one laid again', () => {
  const sig = list => app.sandbox.tableListSig(list, 'deckview');
  const before = [{ name: 'Atraxa', id: 'main/Atraxa', group: 'Creatures' }];
  const after = [{ name: 'Atraxa', id: 'commander/Atraxa', group: 'commander', head: true }];
  assert.notStrictEqual(sig(before), sig(after));
  assert.notStrictEqual(sig([{ name: 'A', group: 'g' }]), sig([{ name: 'A', group: 'g', head: true }]),
    'and a card laid at the head is laid differently from one in a pile');
});

test('the slip and the bin lie only on the Deck Builder’s table, for a deck the user may edit', () => {
  const shown = o => app.sandbox.tableToolsShown({ scope: 'deckview', deckOpen: true, canEdit: true, ...o });
  assert.strictEqual(shown({}), true);
  assert.strictEqual(shown({ canEdit: false }), false, 'another player’s deck is looked at, not changed');
  assert.strictEqual(shown({ deckOpen: false }), false, 'no deck, nothing to add to');
  for (const scope of ['collections', 'players', 'scryfall', 'sets', 'wants', 'card', '', undefined]) {
    assert.strictEqual(shown({ scope }), false, `${scope} lays no deck`);
  }
});

test('the bin is hit on the mat, by the pointer mapped through the camera', () => {
  const inRect = (p, r) => app.sandbox.tableInMatRect(p, r);
  const bin = { left: 800, top: 500, width: 56, height: 56 };
  assert.strictEqual(inRect({ u: 828, v: 528 }, bin), true, 'the middle');
  assert.strictEqual(inRect({ u: 800, v: 556 }, bin), true, 'an edge counts');
  assert.strictEqual(inRect({ u: 799.5, v: 528 }, bin), false);
  assert.strictEqual(inRect({ u: 828, v: 556.5 }, bin), false);
  assert.strictEqual(inRect(null, bin), false, 'a pointer that misses the mat is over nothing');
  assert.strictEqual(inRect({ u: 1, v: 1 }, null), false);

  /* Through every view the table is seen in: the window point the bin's
     middle is drawn at maps back inside it, and the point the far corner of
     the mat is drawn at does not — at the height the bin lies at. */
  for (const v of VIEWS) {
    const m = matrix(v);
    const z = 15;
    const mid = project(m, 828, 528, z);
    assert.strictEqual(inRect(unproject(m, mid.x, mid.y, z), bin), true, `the bin's middle, ${JSON.stringify(v)}`);
    const far = project(m, 10, 10, z);
    assert.strictEqual(inRect(unproject(m, far.x, far.y, z), bin), false);
  }
});

test('the bin is hit on the far rim, by the pointer mapped onto the plane past the mat’s edge', () => {
  const inRect = (p, r) => app.sandbox.tableInMatRect(p, r);
  /* The bin's box in the mat's pixels, lying on the far rim: above the mat's
     top edge, so its top is negative — the mat in GEOM starts 75px into the
     plane, so the rim runs from -75 to 0 there. */
  const bin = { left: 760, top: -63, width: 56, height: 56 };
  const z = app.evaluate('tableToolsZ()');
  assert.ok(z > 0 && z <= 0.5, 'it lies on the wood, a hair above it, in the table’s plane');
  for (const v of VIEWS) {
    const m = matrix(v);
    const mid = project(m, 788, -35, z);
    const back = unproject(m, mid.x, mid.y, z);
    assert.ok(near(back.u, 788, 1e-6) && near(back.v, -35, 1e-6),
      `the mapping runs on past the mat’s edge across the rim: ${JSON.stringify(back)}`);
    assert.strictEqual(inRect(back, bin), true, `the bin's middle, ${JSON.stringify(v)}`);
    for (const [u, w] of [[761, -62], [815, -8]]) {
      const p = project(m, u, w, z);
      assert.strictEqual(inRect(unproject(m, p.x, p.y, z), bin), true, `its corner ${u},${w}`);
    }
    for (const [u, w] of [[788, 4], [788, -70], [740, -35], [830, -35]]) {
      const p = project(m, u, w, z);
      assert.strictEqual(inRect(unproject(m, p.x, p.y, z), bin), false, `${u},${w} is beside the bin, not in it`);
    }
  }
  const css = read('public/css/table.css');
  assert.match(css, /\.table-slip,\s*\n\.table-bin\s*\{[^}]*bottom:\s*calc\(100% \+ 1px \+ \(var\(--table-rim-far\) - var\(--table-tool-h\)\) \/ 2\)/,
    'the stylesheet lays the slip and the bin above the mat’s top edge, centred in the far rim');
  assert.match(css, /\.table-slip-pop \.table-slip-drop\s*\{[^}]*top:\s*0;[^}]*bottom:\s*auto/,
    'and the slip’s suggestions hang down from below it, over the table');
  assert.match(read('public/js/tablemode.js'), /t\.pop\.style\.top\s*=\s*`\$\{\(at\.bottom \+ TABLE_POP_GAP\)/,
    'from the slip’s drawn foot');
});

test('over the bin a card becomes small enough for the bin to show round it, however large it is laid', () => {
  const held = (w, b) => app.sandbox.tableBinHeldShrink(w, b);
  const shrink = app.evaluate('TABLE_BIN_HELD_SHRINK'), fit = app.evaluate('TABLE_BIN_HELD_FIT');
  assert.strictEqual(held(60, 56), shrink, 'a small card shrinks by the look’s own amount');
  assert.ok(near(held(110, 56) * 110, 56 * fit), 'a large one to a share of the bin’s width');
  assert.ok(held(150, 56) * 150 < 56, 'never wider than the bin');
  assert.strictEqual(held(0, 56), shrink);
  assert.strictEqual(held(110, 0), shrink, 'no bin to measure asks nothing further');
  const pose = app.copy(app.sandbox.tableBinPose(1, held(110, 56)));
  assert.ok(near(pose.shrink, held(110, 56)), 'and the look goes all the way to it');
});

test('a card with copies to spare loses one, and the last copy is taken out', () => {
  const action = q => app.sandbox.tableBinAction(q);
  assert.strictEqual(action(4), 'less');
  assert.strictEqual(action(2), 'less');
  assert.strictEqual(action(1), 'remove');
  assert.strictEqual(action(undefined), 'remove', 'a row with no quantity is one card');
  assert.strictEqual(action(0), 'remove');
});

test('over the bin, a card in hand goes over to a smaller, fainter look, eased both ways in the lift’s time', () => {
  const progress = (...a) => app.sandbox.tableBinProgress(...a);
  const pose = t => app.copy(app.sandbox.tableBinPose(t));
  const lift = app.evaluate('TABLE_LIFT_MS');
  assert.ok(near(progress(0, true, lift / 2), 0.5), 'half way in half the lift’s time');
  assert.strictEqual(progress(0.5, true, lift * 3), 1, 'and no further than all the way');
  assert.ok(near(progress(1, false, lift / 4), 0.75), 'leaving, it comes back at the same rate');
  assert.strictEqual(progress(0.3, false, lift * 2), 0);
  assert.strictEqual(progress(0, true, 1, false), 1, 'with cards still it switches at once');
  assert.strictEqual(progress(1, false, 1, false), 0);

  assert.deepStrictEqual(pose(0), { k: 0, shrink: 1, opacity: 1, pull: 0 }, 'off the bin, the held look is untouched');
  const full = pose(1);
  assert.ok(near(full.shrink, 0.55) && near(full.opacity, 0.85) && near(full.pull, 0.5), JSON.stringify(full));
  const half = pose(0.5);
  assert.ok(half.k > 0.5 && half.k < 1, 'on an ease-out, quick at first');
  assert.ok(half.shrink < 1 && half.shrink > 0.55);
});

test('the fade is on the card’s picture, never on the card, whose 3D context it would flatten', () => {
  const css = read('public/css/table.css');
  assert.match(css, /\.table-card-img \{ opacity: var\(--table-bin-fade, 1\); \}/);
  assert.ok(!/\.table-card(\.is-held)? \{[^}]*--table-bin-fade/.test(css), 'not on the card itself');
});

test('the table’s edits go through the builder’s own, and only what the deck still holds', () => {
  const calls = [];
  const deck = new Map([['main/Forest', { qty: 3 }], ['main/Sol Ring', { qty: 1 }], ['commander/Atraxa', { qty: 1 }]]);
  const sb = app.sandbox;
  const globals = {
    dbFindCard: ref => deck.get(ref),
    dbChangeQty: (ref, d) => { calls.push(['qty', ref, d]); deck.get(ref).qty += d; },
    dbRemoveCard: ref => { calls.push(['remove', ref]); deck.delete(ref); },
    showToast: text => calls.push(['toast', text]),
  };
  const before = new Map(Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(sb, k)]));
  Object.assign(sb, globals);
  try {
    app.evaluate('tableToolsOn = true');
    assert.strictEqual(sb.tableRemoveOne({ name: 'Forest', ref: 'main/Forest' }), 'less');
    assert.strictEqual(sb.tableRemoveOne({ name: 'Sol Ring', ref: 'main/Sol Ring' }), 'remove');
    assert.strictEqual(sb.tableRemoveOne({ name: 'Atraxa', ref: 'commander/Atraxa' }), 'remove',
      'the commander is taken out the way the builder takes it out');
    assert.strictEqual(sb.tableRemoveOne({ name: 'Sol Ring', ref: 'main/Sol Ring' }), null, 'a card already gone');
    assert.strictEqual(sb.tableRemoveOne({ name: 'Plains' }), null, 'a card with no ref is not the deck’s');
    assert.deepStrictEqual(plain(calls.filter(c => c[0] !== 'toast')), [
      ['qty', 'main/Forest', -1], ['remove', 'main/Sol Ring'], ['remove', 'commander/Atraxa'],
    ]);
    assert.ok(calls.some(c => c[0] === 'toast' && /Forest/.test(c[1]) && /2 left/.test(c[1])), 'the notice says what is left');
    app.evaluate('tableToolsOn = false');
    assert.strictEqual(sb.tableRemoveOne({ name: 'Forest', ref: 'main/Forest' }), null,
      'nothing is taken out of a deck the slip and bin are not lying beside');
  } finally {
    app.evaluate('tableToolsOn = false');
    for (const [k, d] of before) { if (d) Object.defineProperty(sb, k, d); else delete sb[k]; }
  }
});

test('the slip’s field and its suggestions are the app’s own, and the stylesheet lays them', () => {
  const js = read('public/js/tablemode.js');
  assert.match(js, /mountCardAutocomplete\('tableSlipInput', 'tableSlipDrop'/,
    'the slip reuses the builder’s autocomplete rather than a copy of it');
  const css = read('public/css/table.css');
  for (const rule of ['.table-slip', '.table-bin', '.table-bin.is-over', '.table-slip-pop', '.table-card.is-binned']) {
    assert.ok(css.includes(rule), `table.css has no ${rule}`);
  }
  assert.match(css, /\.table-slip\[hidden\],\s*\.table-bin\[hidden\]\s*\{\s*display:\s*none/,
    'hidden means hidden, whatever the display they are laid out with');
});

// ── The switch ────────────────────────────────────────────────────────────

test('the switch is honoured only where the desktop query says it can be', () => {
  const narrow = loadTableMode({ stored: '1', allowed: false });
  assert.strictEqual(narrow.evaluate('tableMode.isOn()'), false);
  assert.ok(!('tablemode' in narrow.root.dataset), 'a phone or a touchscreen never gets the attribute');
  assert.strictEqual(narrow.evaluate('readTableMode()'), true, 'though the answer is kept for a wider window');
  assert.strictEqual(narrow.evaluate('tableModeQuery()'), '(width >= 900px) and (hover: hover)',
    'the app’s desktop breakpoint, and a pointer that hovers');
});

test('the switch is kept per browser, and unreadable storage is just "off"', () => {
  const app2 = loadTableMode();
  app2.evaluate('setTableMode(true)');
  assert.strictEqual(app2.store.get('mtgtools_tablemode'), '1');
  app2.evaluate('setTableMode(false)');
  assert.ok(!app2.store.has('mtgtools_tablemode'), 'off is no key at all');
  const locked = loadTableMode({ storage: false });
  assert.strictEqual(locked.evaluate('readTableMode()'), false);
  assert.doesNotThrow(() => locked.evaluate('setTableMode(true)'));
});

test('the API the next half of the work builds on is there, and frozen', () => {
  const api = app.evaluate('Object.keys(tableMode).sort()');
  assert.deepStrictEqual(app.copy(api),
    ['cards', 'closePanel', 'isOn', 'kindFor', 'layCards', 'openPanel', 'panel'].sort());
  assert.strictEqual(app.evaluate('Object.isFrozen(tableMode)'), true);
  assert.strictEqual(app.evaluate('tableMode.openPanel("collections")'), false, 'nothing opens with the mode off');
  assert.strictEqual(app.evaluate('tableMode.layCards([{ name: "Sol Ring" }, {}, null])'), 1,
    'cards are kept with the mode off, for when it comes on — and a card with no name is not one');
});

// ── What the page has to carry for it ─────────────────────────────────────

test('every palette says what its table is made of', () => {
  const palettes = parsePalettes(read('public/css/tokens.css'));
  for (const theme of PALETTE_THEMES) {
    for (const token of ['--table-wood', '--table-wood-edge']) {
      assert.ok(palettes[theme][token], `the ${theme} palette does not name ${token}`);
    }
  }
});

test('the table’s stylesheet is served after the tabs’ and held to the token contract', () => {
  const html = read('public/index.html');
  const sheets = [...html.matchAll(/<link[^>]*\shref=["']([^"']+\.css)/gi)].map(m => m[1]);
  assert.strictEqual(sheets.indexOf('css/table.css'), sheets.indexOf('css/tabs.css') + 1);
  assert.match(read('scripts/lint-tokens.js'), /'public\/css\/table\.css'/,
    'a stylesheet the linter does not read is one the token contract does not hold');
});

test('the script is served before main.js, which tells it about every tab', () => {
  const html = read('public/index.html');
  const at = name => html.indexOf(`<script src="js/${name}"></script>`);
  for (const before of ['state.js', 'cardstack.js', 'faq.js']) {
    assert.ok(at(before) >= 0 && at(before) < at('tablemode.js'), `${before} is needed first`);
  }
  assert.ok(at('tablemode.js') < at('main.js'));

  const main = read('public/js/main.js');
  const setTab = main.match(/function setTab\([\s\S]*?\n\}/)[0];
  assert.ok(setTab.indexOf('tableModeBeforeTab(tab)') < setTab.indexOf('.tab-pane'),
    'the pane has to be in its panel before setTab shows it and draws into it');
  assert.ok(setTab.trimEnd().endsWith('tableModeAfterTab(tab);\n}'), 'and the table is told last');
  assert.match(main, /tableModeStateLoaded\(\)/, 'and when the first state has arrived');
});
