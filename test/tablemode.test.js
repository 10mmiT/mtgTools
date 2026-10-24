/* Table mode: the decisions inside it.
 *
 * Which kind of panel a tab opens in, when a press becomes a drag, where the
 * view leans for a pointer, which point of the mat is under a point of the
 * screen, and where cards lie — each is written in public/js/tablemode.js as a
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

  const edge = name => rim.filter(e => e.edge === name).map(e => e.tab || e.act);
  assert.deepStrictEqual(edge('far'), ['collections', 'players', 'deckview', 'scryfall', 'sets', 'wants']);
  assert.deepStrictEqual(edge('left'), ['available', 'pick', 'lands', 'card']);
  assert.deepStrictEqual(edge('right'), ['appearance', 'rss', 'admin', 'password', 'signout', 'leave']);

  const html = read('public/index.html');
  for (const entry of rim.filter(e => e.nav)) {
    assert.match(html, new RegExp(`id="${entry.nav}"`), `${entry.act} stands for a sidebar button that is gone`);
  }
  for (const tab of tabs) {
    assert.match(html, new RegExp(`id="tab-${tab}"`), `there is no pane for ${tab} to open`);
  }
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

// ── Looking around ───────────────────────────────────────────────────────

const look = (x, y, w = 1440, h = 900) => app.call('tableLookTarget', x, y, w, h);
const REST = 24;

test('a pointer in the middle of the window leaves the table at rest', () => {
  assert.deepStrictEqual(look(720, 450), { rx: REST, ry: 0, tx: 0, ty: 0 });
  assert.deepStrictEqual(app.copy(app.evaluate('TABLE_REST')), { rx: REST, ry: 0, tx: 0, ty: 0 });
});

test('the view leans at most 3° of tilt, 4° of turn and 2% of the window', () => {
  for (const [x, y] of [[0, 0], [1440, 0], [0, 900], [1440, 900]]) {
    const v = look(x, y);
    assert.ok(near(Math.abs(v.rx - REST), 3), `${x},${y} tilts the most it may`);
    assert.ok(near(Math.abs(v.ry), 4), `${x},${y} turns the most it may`);
    assert.ok(Math.abs(v.tx) <= 0.02 * 1440 && Math.abs(v.tx) > 0, `${x},${y} shifts across by ${v.tx}`);
    assert.ok(Math.abs(v.ty) <= 0.02 * 900 && Math.abs(v.ty) > 0, `${x},${y} shifts down by ${v.ty}`);
  }
});

test('a pointer outside the window cannot lean the view further', () => {
  const corner = look(1440, 900);
  for (const [x, y] of [[5000, 5000], [1e9, 1e9]]) assert.deepStrictEqual(look(x, y), corner);
  assert.deepStrictEqual(look(-5000, -5000), look(0, 0));
  assert.deepStrictEqual(look(720, -400), look(720, 0), 'each axis is clamped on its own');
});

test('leaning follows the pointer the way a head does', () => {
  // Pointing right is leaning right: the table's right side comes round towards
  // you, which is a negative rotateY, and the table slides the other way.
  assert.ok(look(1440, 450).ry < 0, 'pointing right turns the right side towards you');
  assert.ok(look(0, 450).ry > 0, 'and pointing left the left');
  assert.ok(look(1440, 450).tx < 0, 'and the table slides away from the lean');
  // Pointing up is leaning over the table, looking down onto it.
  assert.ok(look(720, 0).rx < REST, 'pointing up tilts the table less');
  assert.ok(look(720, 900).rx > REST, 'pointing down tilts it more');
  // Proportional in between.
  assert.ok(near(look(1080, 450).ry, -2), 'halfway to the edge is half the turn');
});

test('a window with no size answers the rest position rather than NaN', () => {
  assert.deepStrictEqual(look(10, 10, 0, 0), { rx: REST, ry: 0, tx: 0, ty: 0 });
  assert.deepStrictEqual(look(NaN, undefined), look(0, 0),
    'an unreadable pointer is the window corner it falls back to, not a transform of NaN');
});

test('the view eases to its target and says when it has arrived', () => {
  let at = app.copy(app.evaluate('TABLE_REST'));
  const to = look(1440, 0);
  let frames = 0, settled = false, last = Infinity;
  while (!settled && frames < 500) {
    const step = app.copy(app.evaluate(`tableLookStep(${JSON.stringify(at)}, ${JSON.stringify(to)})`));
    const gap = Math.abs(to.ry - step.at.ry);
    assert.ok(gap <= last, 'every frame closes on the target, never past it');
    last = gap;
    at = step.at;
    settled = step.settled;
    frames++;
  }
  assert.ok(settled, 'the loop stops itself');
  assert.ok(frames < 120, `and within two seconds of frames, not ${frames}`);
  assert.deepStrictEqual(at, to, 'and arrives exactly, not a hair short');
  const again = app.copy(app.evaluate(`tableLookStep(${JSON.stringify(to)}, ${JSON.stringify(to)})`));
  assert.deepStrictEqual(again, { at: to, settled: true }, 'a view already there is settled');
});

test('the view takes the same time to arrive at any refresh rate', () => {
  const ease = dt => app.evaluate(`tableEaseFor(${dt}, 0.12)`);
  assert.ok(near(ease(1000 / 60), 0.12), 'a sixtieth of a second closes the stated share');
  assert.ok(near(1 - (1 - ease(1000 / 120)) ** 2, 0.12),
    'two frames of a 120Hz screen close exactly what one frame of a 60Hz screen does');
  assert.ok(near(ease(2000 / 60), 1 - 0.88 ** 2), 'and one slow frame what two quick ones do');
  assert.strictEqual(ease(0), 0, 'no time is no movement');
  assert.strictEqual(ease(-5), 0, 'nor is a clock that ran backwards');
  assert.strictEqual(ease(5000), ease(100), 'a frame after a long sleep is held to a tenth of a second');
  assert.ok(ease(100) < 1, 'so the view never lands in a single jump');
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
const matrix = look => app.evaluate(`tablePlaneMatrix(${JSON.stringify({ ...GEOM, look })})`);
const project = (m, u, v, z = 0) => app.copy(app.sandbox.tableProject(m, u, v, z));
const unproject = (m, x, y, z = 0) => app.copy(app.sandbox.tableUnproject(m, x, y, z));

test('with no tilt and no perspective the mat is where its box is', () => {
  const m = app.evaluate(`tablePlaneMatrix(${JSON.stringify({
    ...GEOM, perspective: Infinity, look: { rx: 0, ry: 0, tx: 0, ty: 0 } })})`);
  const at = unproject(m, 500, 400);
  assert.ok(near(at.u, 500 - 86 - 198) && near(at.v, 400 - 108 - 75),
    `the screen point minus the plane's and the mat's offsets, not ${JSON.stringify(at)}`);
});

test('a point of the mat and the screen point it lands on map back to each other', () => {
  const views = [
    { rx: REST, ry: 0, tx: 0, ty: 0 },
    look(0, 0), look(1440, 900), look(300, 820),
  ];
  for (const view of views) {
    const m = matrix(view);
    for (const z of [0, 15, 60]) {
      for (const [u, v] of [[0, 0], [MAT.width, 0], [0, MAT.height], [MAT.width, MAT.height], [311, 207]]) {
        const screen = project(m, u, v, z);
        assert.ok(screen, `${u},${v} at ${z}px is in front of the eye`);
        const back = unproject(m, screen.x, screen.y, z);
        assert.ok(near(back.u, u, 1e-6) && near(back.v, v, 1e-6),
          `${u},${v} at ${z}px came back as ${back.u},${back.v} for ${JSON.stringify(view)}`);
      }
    }
  }
});

/* The same question answered a second way, from scratch: cast the ray from the
 * eye through the screen point and intersect it with the tilted plane. The eye
 * of a CSS perspective sits `perspective` pixels in front of its origin, and
 * the plane is the mat's affine image — the matrix with no perspective in it.
 * If the closed-form inverse were wrong it could still round-trip its own
 * projection; this is what it would disagree with. */
function rayCast(view, x, y, z = 0) {
  const affine = app.evaluate(`tablePlaneMatrix(${JSON.stringify({ ...GEOM, perspective: Infinity, look: view })})`);
  const apply = (u, v, w) => [0, 1, 2].map(r => affine[r * 4] * u + affine[r * 4 + 1] * v + affine[r * 4 + 2] * w + affine[r * 4 + 3]);
  const p0 = apply(0, 0, z);
  const du = apply(1, 0, z).map((n, i) => n - p0[i]);
  const dv = apply(0, 1, z).map((n, i) => n - p0[i]);
  const eye = [GEOM.origin.x, GEOM.origin.y, GEOM.perspective];
  const dir = [x - eye[0], y - eye[1], -eye[2]];
  // eye + t·dir = p0 + u·du + v·dv  →  u·du + v·dv − t·dir = eye − p0
  const rhs = eye.map((n, i) => n - p0[i]);
  const cols = [du, dv, dir.map(n => -n)];
  const det3 = (a, b, c) =>
    a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
  const D = det3(...cols);
  return { u: det3(rhs, cols[1], cols[2]) / D, v: det3(cols[0], rhs, cols[2]) / D };
}

test('the screen-to-mat mapping is the ray from the eye meeting the tilted plane', () => {
  for (const view of [{ rx: REST, ry: 0, tx: 0, ty: 0 }, look(100, 60), look(1400, 880)]) {
    const m = matrix(view);
    for (const [x, y] of [[720, 450], [300, 200], [1200, 760], [500, 640]]) {
      for (const z of [0, 60]) {
        const fast = unproject(m, x, y, z);
        const slow = rayCast(view, x, y, z);
        assert.ok(near(fast.u, slow.u, 1e-6) && near(fast.v, slow.v, 1e-6),
          `${x},${y} at ${z}px: ${fast.u},${fast.v} against the ray's ${slow.u},${slow.v}`);
      }
    }
  }
});

test('the table leans away: its far edge is drawn narrower than its near edge', () => {
  const m = matrix({ rx: REST, ry: 0, tx: 0, ty: 0 });
  const width = v => project(m, MAT.width, v).x - project(m, 0, v).x;
  assert.ok(width(0) < MAT.width && width(MAT.height) > MAT.width,
    `far ${width(0)} and near ${width(MAT.height)} against an untilted ${MAT.width}`);
  assert.ok(project(m, 0, 0).y > GEOM.plane.top + GEOM.mat.top,
    'and the far edge is drawn lower than it is laid out, as a receding edge is');
});

test('a card held above the mat is nearer the eye than the felt under it', () => {
  const m = matrix({ rx: REST, ry: 0, tx: 0, ty: 0 });
  const felt = project(m, 120, 480, 0);
  const held = project(m, 120, 480, 60);
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
  const m = matrix({ rx: REST, ry: 0, tx: 0, ty: 0 });
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

test('the transform the table is drawn with is the one the mapping is made from', () => {
  // The CSS names the same four in the same order as the matrix composes them.
  const css = app.evaluate('tablePlaneTransform({ rx: 21, ry: -4, tx: -21.6, ty: 13.5 })');
  assert.strictEqual(css, 'translate3d(-21.60px, 13.50px, 0) rotateY(-4.000deg) rotateX(21.000deg)');
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
