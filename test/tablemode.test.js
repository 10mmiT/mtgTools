/* Table mode: the decisions inside it.
 *
 * Which kind of panel a tab opens in, when a press becomes a drag, where the
 * view leans for a pointer, which point of the mat is under a point of the
 * screen, and where cards lie — each is written in public/js/tablemode.js as a
 * function of its inputs so that it can be asserted here rather than eyeballed
 * in a browser. What is not asserted is what the table looks like, nor the
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

test('a mat with nothing to lay, or no size, lays nothing out of place', () => {
  assert.deepStrictEqual(layout([]).spots, []);
  assert.deepStrictEqual(layout(cards(2), 0, 0).spots, [{ x: 0.5, y: 0.5, turn: 0 }, { x: 0.5, y: 0.5, turn: 0 }]);
  const one = layout(cards(1));
  assert.ok(near(one.spots[0].x, 0.5, 0.01) && near(one.spots[0].y, 0.5, 0.01), 'one card lies in the middle');
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
