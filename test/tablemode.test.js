/* Table mode: the decisions inside it.
 *
 * Which kind of panel a tab opens in, when a press becomes a drag, how the
 * table is fitted to the window, how the camera leans for a pointer, zooms
 * for a wheel and is moved round a zoomed table by the edges, a hand and the
 * keys, and how far it may go, how fast a card comes up, which point of the mat is under a
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
// Line endings normalised, so a checkout with CRLF reads as the LF the tests match.
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

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
  assert.ok(app.evaluate('TABLE_RIM_Z') > app.evaluate('TABLE_DEPTH + 2 * TABLE_CARD_GAP'),
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
const REST = 24;
const LEAN = 0.02;
const lean = (x, y, w = W, h = H) => app.call('tableLeanTarget', x, y, w, h);
/* A camera's state: a zoom, the lean for a pointer at (x, y), and a pan. */
const state = (x, y, zoom = 1, pan = {}) => ({ zoom, ...lean(x, y), panX: 0, panY: 0, ...pan });
const cam = (s, l = LEAN) => app.copy(app.sandbox.tableCamera(s, W, H, l));
/* The state after a zoom from `s` to `zoom` about the window point (x, y). */
const zoomAbout = (s, zoom, x, y, l = LEAN) =>
  ({ ...s, zoom, ...app.copy(app.sandbox.tableZoomAbout(s, zoom, { x, y }, W, H, l)) });
/* The camera for a pointer at (x, y), zoomed in about it from the whole table. */
const camera = (x, y, zoom = 1, l = LEAN) => cam(zoomAbout(state(x, y, 1), zoom, x, y, l), l);
/* Where a point of the rest picture is drawn by a camera, and which point of
 * the rest picture is under a window point. */
const draw  = (c, x, y) => ({ x: c.zoom * x + c.tx, y: c.zoom * y + c.ty });
const under = (c, x, y) => ({ x: (x - c.tx) / c.zoom, y: (y - c.ty) / c.zoom });
const same  = (a, b, eps = 1e-9) => near(a.x, b.x, eps) && near(a.y, b.y, eps);

/* The table as tableFitSize fits it to a 1440×900 window, in the
 * stylesheet's perspective, with the plane's 8px corner: the outline the pan
 * is held inside. */
const FIT = app.copy(app.sandbox.tableFitSize({ width: W, height: H }, { perspective: 1400, top: 8 + LEAN * H }));
const FIT_GEOM = {
  perspective: 1400,
  origin: { x: W / 2, y: H / 2 },
  plane: { left: FIT.left, top: FIT.top, origin: { x: FIT.width / 2, y: FIT.height / 2 },
           width: FIT.width, height: FIT.height, radius: 8 },
};
const BOUNDS = app.copy(app.sandbox.tablePanBounds(FIT_GEOM));
const clampPan = (next, prev = next, opts) =>
  ({ ...next, ...app.copy(app.sandbox.tableClampPan(next, prev, BOUNDS, W, H, opts)) });
/* The window's four corners, as points of the plane — in its own pixels from
 * its top-left outer corner — for a camera state. */
const windowOnPlane = s => {
  const m = app.evaluate(`tablePlaneMatrix(${JSON.stringify({ ...FIT_GEOM, mat: { left: 0, top: 0 }, tilt: REST, camera: cam(s, 0) })})`);
  return [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => app.copy(app.sandbox.tableUnproject(m, x, y, 0)));
};

test('a pointer in the middle of the window leaves the camera at rest', () => {
  assert.deepStrictEqual(lean(720, 450), { leanX: 0, leanY: 0 });
  assert.deepStrictEqual(app.copy(app.evaluate('TABLE_CAMERA_REST')), { zoom: 1, leanX: 0, leanY: 0, panX: 0, panY: 0 });
  assert.deepStrictEqual(cam(state(720, 450)), { zoom: 1, tx: 0, ty: 0 }, 'and the picture where it is drawn');
  assert.strictEqual(app.evaluate('TABLE_TILT_REST'), REST);
  assert.strictEqual(app.evaluate('TABLE_PAN_REST'), LEAN);
});

test('at zoom 1 the camera leans only 2% of the window, as a head leans', () => {
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const c = cam(state(x, y));
    assert.strictEqual(c.zoom, 1);
    assert.ok(near(Math.abs(c.tx), LEAN * W) && near(Math.abs(c.ty), LEAN * H), `${x},${y} slides ${c.tx},${c.ty}`);
  }
  // Leaning right shows you more of the right: the picture slides left.
  assert.ok(cam(state(W, 450)).tx < 0 && cam(state(0, 450)).tx > 0, 'the picture slides away from the lean');
  assert.ok(cam(state(720, H)).ty < 0 && cam(state(720, 0)).ty > 0, 'up and down the same');
  assert.ok(near(cam(state(1080, 450)).tx, -LEAN * W / 2), 'halfway to the edge is half the slide');
});

test('a pointer outside the window cannot lean the camera further', () => {
  assert.deepStrictEqual(lean(5000, 5000), lean(W, H));
  assert.deepStrictEqual(lean(-5000, -5000), lean(0, 0));
  assert.deepStrictEqual(lean(720, -400), lean(720, 0), 'each axis is clamped on its own');
  assert.deepStrictEqual(lean(10, 10, 0, 0), { leanX: 0, leanY: 0 }, 'a window with no size is the middle');
  assert.deepStrictEqual(lean(NaN, undefined), lean(0, 0),
    'an unreadable pointer is the window corner it falls back to, not a lean of NaN');
});

test('the lean fades out over the first 15% of the zoom, with no step anywhere', () => {
  const blend = z => app.evaluate(`tableLeanBlend(${z})`);
  assert.strictEqual(app.evaluate('TABLE_LEAN_FADE'), 1.15);
  assert.strictEqual(blend(1), 1, 'all of it at the whole table');
  assert.strictEqual(blend(1.15), 0, 'none from 1.15');
  assert.strictEqual(blend(2.5), 0);
  assert.ok(near(blend(1.075), 0.5), 'half of it halfway');
  let last = 1;
  for (let z = 1; z <= 1.2; z += 0.001) {
    const b = blend(z);
    assert.ok(b <= last + 1e-12 && last - b < 0.02, `falls smoothly at ${z}: ${last} to ${b}`);
    last = b;
  }
  // Smoothstep's ends are flat: it leaves and arrives without a kink.
  assert.ok(1 - blend(1.0015) < 0.001 && blend(1.1485) < 0.001, 'it eases out of 1 and into 0');
  // So the pointer's lean shrinks with the zoom, and is gone at 1.15.
  const slide = z => cam(state(W, 450, z)).tx - cam(state(0, 450, z)).tx;
  assert.ok(near(slide(1), -2 * LEAN * W));
  assert.ok(Math.abs(slide(1.05)) < Math.abs(slide(1)) && Math.abs(slide(1.1)) < Math.abs(slide(1.05)));
  assert.strictEqual(slide(1.15), 0);
});

test('zoomed in, the pointer moving about the window leaves the view where it is', () => {
  for (const zoom of [1.15, 1.5, 2, 2.5]) {
    for (const pan of [{}, { panX: 120, panY: -80 }]) {
      const still = cam(state(720, 450, zoom, pan));
      for (const [x, y] of [[0, 0], [W, H], [300, 820], [1100, 120], [W, 450]]) {
        assert.deepStrictEqual(cam(state(x, y, zoom, pan)), still, `at ${zoom}, a pointer at ${x},${y}`);
      }
    }
  }
});

test('the pan is the point of the rest picture at the window’s middle, at any zoom', () => {
  for (const zoom of [1, 1.5, 2.5]) {
    for (const [panX, panY] of [[0, 0], [100, -50], [-230, 140]]) {
      const c = cam(state(720, 450, zoom, { panX, panY }));
      assert.ok(same(under(c, W / 2, H / 2), { x: W / 2 + panX, y: H / 2 + panY }),
        `at ${zoom} with ${panX},${panY}: ${JSON.stringify(under(c, W / 2, H / 2))}`);
    }
  }
});

test('zooming about a point never moves the point of the table under it, wherever the view is', () => {
  const starts = [state(720, 450), state(100, 80, 1.6, { panX: -140, panY: -90 }),
                  state(1300, 820, 2.2, { panX: 210, panY: 160 }), state(W, H)];
  for (const s of starts) {
    for (const [x, y] of [[720, 450], [100, 80], [1300, 820], [37, 640], [W - 1, H - 1]]) {
      const at = under(cam(s), x, y);
      for (const zoom of [1, 1.01, 1.07, 1.3, 2, 2.5]) {
        const now = under(cam(zoomAbout(s, zoom, x, y)), x, y);
        assert.ok(same(now, at), `from ${JSON.stringify(s)} about ${x},${y} to ${zoom}: ${JSON.stringify(now)} against ${JSON.stringify(at)}`);
      }
    }
  }
  /* Through the lean's fading too: the pointer at an edge leans the view
     fully at 1 and not at all at 1.15, and the zoom counts that in. */
  const leaning = state(W - 1, 450);
  assert.ok(same(under(cam(zoomAbout(leaning, 1.15, W - 1, 450)), W - 1, 450), under(cam(leaning), W - 1, 450)));
  assert.deepStrictEqual(app.copy(app.sandbox.tableZoomAbout(state(0, 0, 1.4, { panX: 5, panY: 6 }), 2, null, W, H)),
    { panX: 5, panY: 6 }, 'with no anchor the pan is left as it was');
});

test('a wheel turned over the table zooms about the pointer step after step, held inside the table', () => {
  /* Each frame of a zoom, the pan put right about the pointer and held in the
     table, as tableCameraAdvance does: over the table, a zoom in is never held. */
  for (const [x, y] of [[720, 450], [420, 300], [1100, 650], [300, 760]]) {
    let s = state(x, y);
    const at = under(cam(s), x, y);
    for (const dy of [-100, -100, -37, -300, -4, -100]) {
      const zoom = app.evaluate(`tableWheelZoom(${s.zoom}, ${dy}, 0)`);
      s = clampPan(zoomAbout(s, zoom, x, y), s);
      assert.ok(same(under(cam(s), x, y), at, 1e-6), `${x},${y} at ${zoom}: ${JSON.stringify(under(cam(s), x, y))}`);
    }
  }
});

test('zooming back out to the whole table comes back to the rest view', () => {
  for (const [x, y] of [[0, 0], [W - 1, H - 1], [200, 700], [720, 450]]) {
    let s = clampPan(state(x, y, 2.5, { panX: -9999, panY: 9999 }), state(x, y, 2.5), { strict: true });
    let last = Infinity;
    for (let zoom = 2.5; zoom > 1; ) {
      zoom = Math.max(1, zoom / 1.1);
      s = clampPan(zoomAbout(s, zoom, x, y), s);
      const off = Math.hypot(s.panX, s.panY);
      assert.ok(off <= last + 1e-9, `the view comes back towards the middle all the way: ${off} after ${last}`);
      last = off;
    }
    assert.strictEqual(s.zoom, 1);
    assert.deepStrictEqual({ panX: s.panX, panY: s.panY }, { panX: 0, panY: 0 }, `about ${x},${y}`);
  }
});

/* The margin past the rim, in window pixels, at a zoom, across a window `size` that way. */
const margin = (zoom, size) => app.evaluate(`tablePanMargin(${zoom}, ${size})`);
const range = zoom => app.copy(app.sandbox.tablePanRange(BOUNDS, zoom, W, H));
/* The view pushed as far as it goes towards (sx, sy), each -1, 0 or 1. */
const pushed = (zoom, sx, sy) =>
  clampPan(state(720, 450, zoom, { panX: sx * 1e5, panY: sy * 1e5 }), state(720, 450, zoom), { strict: true });
/* The table's four outer corners where the camera at `s` draws them on the
 * screen: far left, far right, near left, near right. */
const cornersOnScreen = s => {
  const m = app.evaluate(`tablePlaneMatrix(${JSON.stringify({ ...FIT_GEOM, mat: { left: 0, top: 0 }, tilt: REST, camera: cam(s, 0) })})`);
  const { width: pw, height: ph } = FIT_GEOM.plane;
  return [[0, 0], [pw, 0], [0, ph], [pw, ph]].map(([u, v]) => app.copy(app.sandbox.tableProject(m, u, v, 0)));
};

test('at the whole table the view cannot be panned anywhere', () => {
  const r = range(1);
  assert.deepStrictEqual([r.x.lo, r.x.hi, r.y.lo, r.y.hi], [0, 0, 0, 0]);
  assert.strictEqual(margin(1, W), 0, 'no margin past the rim at the whole table');
  for (const pan of [{ panX: 300, panY: -200 }, { panX: -1, panY: 1 }]) {
    const s = clampPan(state(720, 450, 1, pan), state(720, 450, 1));
    assert.deepStrictEqual([s.panX, s.panY], [0, 0], JSON.stringify(pan));
  }
});

test('a little past the whole table the view can already be taken across, wherever the table runs past the window', () => {
  for (const zoom of [1.05, 1.1, 1.2, 1.3]) {
    /* The table at its widest is wider than the window shows at this zoom. */
    assert.ok((BOUNDS.right - BOUNDS.left) * zoom > W, `at ${zoom} the table runs past the window across`);
    const r = range(zoom);
    assert.ok(r.x.lo < 0 && r.x.hi > 0, `at ${zoom} the view goes left and right: ${JSON.stringify(r.x)}`);
    assert.ok(r.y.lo < 0 && r.y.hi > 0, `and up and down: ${JSON.stringify(r.y)}`);
  }
  /* At 1.2, pushed all the way left, the near-left corner — the table's
     widest point — is in view, the margin in from the window's left. */
  const left = pushed(1.2, -1, 0);
  const [, , nl] = cornersOnScreen(left);
  assert.ok(left.panX < 0, `at 1.2 the view goes left: ${left.panX}`);
  assert.ok(near(nl.x, margin(1.2, W), 1e-6), `and the near-left corner comes to the margin: ${nl.x}`);
});

test('the margin past the rim is 8% of the window, grown in over the first quarter of the zoom', () => {
  assert.strictEqual(app.evaluate('TABLE_PAN_MARGIN'), 0.08);
  assert.strictEqual(app.evaluate('TABLE_PAN_MARGIN_RAMP'), 0.25);
  assert.ok(near(margin(1.25, W), 0.08 * W) && near(margin(2.5, W), 0.08 * W), 'all of it from 1.25');
  assert.ok(near(margin(2.5, H), 0.08 * H), 'of the window that way');
  assert.ok(near(margin(1.125, W), 0.04 * W), 'half of it halfway');
  let last = -1;
  for (let z = 1; z <= 2.5; z += 0.01) {
    const m = margin(z, W);
    assert.ok(m >= last, `it only grows as the zoom goes in: ${m} after ${last} at ${z}`);
    last = m;
  }
  /* Pushed to each side, the rim's edge lands exactly the margin in from the
     window's edge: across at the table's widest, its near edge; down at the
     far and the near rim. */
  for (const zoom of [1.5, 2, 2.5]) {
    const mx = margin(zoom, W), my = margin(zoom, H);
    const [fl, , nl] = cornersOnScreen(pushed(zoom, -1, 0));
    assert.ok(near(Math.min(fl.x, nl.x), mx, 1e-6), `at ${zoom} the left rim is ${mx}px in: ${nl.x}`);
    const [, fr, , nr] = cornersOnScreen(pushed(zoom, 1, 0));
    assert.ok(near(Math.max(fr.x, nr.x), W - mx, 1e-6), `at ${zoom} the right rim is ${mx}px in: ${nr.x}`);
    const [ft] = cornersOnScreen(pushed(zoom, 0, -1));
    assert.ok(near(ft.y, my, 1e-6), `at ${zoom} the far rim is ${my}px down: ${ft.y}`);
    const [, , nb] = cornersOnScreen(pushed(zoom, 0, 1));
    assert.ok(near(nb.y, H - my, 1e-6), `at ${zoom} the near rim is ${my}px up: ${nb.y}`);
  }
});

test('at 1.2, 1.5 and 2.5 every part of the table, the whole rim and every chip on it, can be had fully in view', () => {
  /* The chips lie on the rim, inside the plane's outline: a view that holds
     a corner of the plane, with the margin round it, holds every chip by it.
     So each corner is pushed to, and must be in the window, the margin in,
     with both rims that meet there in view all the way along. */
  const corner = [[-1, -1, 0], [1, -1, 1], [-1, 1, 2], [1, 1, 3]];
  for (const zoom of [1.2, 1.5, 2.5]) {
    const mx = margin(zoom, W), my = margin(zoom, H);
    for (const [sx, sy, i] of corner) {
      const s = pushed(zoom, sx, sy);
      const c = cornersOnScreen(s)[i];
      assert.ok(c.x >= mx - 1e-6 && c.x <= W - mx + 1e-6 && c.y >= my - 1e-6 && c.y <= H - my + 1e-6,
        `at ${zoom} pushed ${sx},${sy}: the corner is drawn at ${c.x},${c.y}, inside the margin`);
      /* The rim along the side pushed to is in view from the corner to the
         window's far end of it: the side's line, at every row in the window. */
      const pts = cornersOnScreen(s);
      const [a, b] = sx < 0 ? [pts[0], pts[2]] : [pts[1], pts[3]];
      for (let t = 0; t <= 1; t += 0.125) {
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        if (y < 0 || y > H) continue;
        assert.ok(x >= -1e-6 && x <= W + 1e-6, `at ${zoom} pushed ${sx},${sy}: the side rim at row ${y} is at ${x}, in the window`);
      }
    }
    /* And the view is never taken so far that the table leaves the window's
       middle: the margin is less than half the window. */
    for (const [sx, sy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const c = cam(pushed(zoom, sx, sy), 0), mid = under(c, W / 2, H / 2);
      assert.ok(mid.x >= BOUNDS.left && mid.x <= BOUNDS.right && mid.y >= BOUNDS.top && mid.y <= BOUNDS.bottom,
        `at ${zoom} pushed ${sx},${sy}, the window's middle is still over the table: ${JSON.stringify(mid)}`);
    }
  }
});

test('the table’s outline is the box round the plane’s corners, through the tilt: across at its near edge', () => {
  const corners = cornersOnScreen(state(720, 450, 1));
  assert.ok(near(BOUNDS.left, corners[2].x, 1e-6) && near(BOUNDS.right, corners[3].x, 1e-6),
    `across, where the table is widest, its near edge: ${JSON.stringify(BOUNDS)}`);
  assert.ok(corners[0].x > BOUNDS.left && corners[1].x < BOUNDS.right, 'its far edge narrower');
  assert.ok(near(BOUNDS.top, corners[0].y, 1e-6) && near(BOUNDS.bottom, corners[2].y, 1e-6), 'down, the far rim to the near rim');
  assert.ok(near(BOUNDS.left + BOUNDS.right, W, 1e-6), 'centred across the window');
  assert.ok(BOUNDS.left > 0 && BOUNDS.right < W && BOUNDS.bottom < H && BOUNDS.top > 0,
    'and inside the window at rest, as the fit lays it');
  assert.strictEqual(app.sandbox.tablePanBounds({ ...FIT_GEOM, plane: { ...FIT_GEOM.plane, width: 0 } }), null);
  assert.deepStrictEqual(app.copy(app.sandbox.tableClampPan({ zoom: 2, panX: 7, panY: 8 }, {}, null, W, H)),
    { panX: 7, panY: 8 }, 'with nothing measured the pan is left as it was asked');
});

test('pushed into a far corner, a little of the room beyond the table shows there, and that is all', () => {
  /* The table narrows towards its far side, and across the view is held to
     its widest: pushed up and left, the window's top-left corner is off the
     table, the price of reaching the near-left corner. */
  const s = pushed(2.5, -1, -1);
  const [fl] = cornersOnScreen(s);
  assert.ok(fl.x > 0 && fl.y > 0, `the far-left corner is in view, with room past it: ${fl.x},${fl.y}`);
  const onPlane = windowOnPlane(s);
  assert.ok(onPlane[0].u < 0, 'the window’s top-left corner is past the rim');
  assert.ok(onPlane[3].u > 0 && onPlane[3].v > 0, 'and its opposite corner on the table');
});

test('a pan past the margin may only come back, never go further', () => {
  /* A view left showing more of the room beyond the rim than the margin —
     zoomed in near its corner, where nothing was held — can be panned back
     onto the table but not further off it. */
  const r = range(1.8);
  const out = state(720, 450, 1.8, { panX: r.x.lo - 100, panY: r.y.lo - 80 });
  const further = clampPan({ ...out, panX: out.panX - 50, panY: out.panY - 50 }, out);
  assert.ok(near(further.panX, out.panX, 1e-9) && near(further.panY, out.panY, 1e-9), `held where it was: ${further.panX},${further.panY}`);
  const back = clampPan({ ...out, panX: out.panX + 20, panY: out.panY + 20 }, out);
  assert.ok(near(back.panX, out.panX + 20, 1e-9) && near(back.panY, out.panY + 20, 1e-9), 'free to come back');
  /* Inside the margin the pan is free both ways. */
  const inside = state(720, 450, 1.8, { panX: r.x.lo + 10, panY: r.y.hi - 10 });
  const free = clampPan({ ...inside, panX: r.x.lo + 2, panY: r.y.hi - 3 }, inside);
  assert.ok(near(free.panX, r.x.lo + 2, 1e-9) && near(free.panY, r.y.hi - 3, 1e-9), 'and up to it, free');
  /* And resized, held to the range alone. */
  const strict = clampPan(out, out, { strict: true });
  assert.ok(near(strict.panX, r.x.lo, 1e-9) && near(strict.panY, r.y.lo, 1e-9), `a resize asks the table alone: ${strict.panY}`);
});

test('pushed to the margin, a zoom in about a point of the table still keeps that point exactly under the pointer', () => {
  for (const zoom of [1.2, 1.5]) {
    for (const [sx, sy] of [[-1, -1], [1, 1], [-1, 1], [1, 0]]) {
      for (const [x, y] of [[300, 300], [720, 450], [W - 300, H - 200], [200, H - 150]]) {
        let s = pushed(zoom, sx, sy);
        const at = under(cam(s), x, y);
        for (let z = zoom; z < 2.5; ) {
          z = Math.min(2.5, z * 1.15);
          s = clampPan(zoomAbout(s, z, x, y), s);
          assert.ok(same(under(cam(s), x, y), at, 1e-6),
            `from ${zoom} pushed ${sx},${sy}, about ${x},${y} at ${z}: ${JSON.stringify(under(cam(s), x, y))}`);
        }
      }
    }
  }
});

test('a hand on the felt pans the table one to one', () => {
  for (const zoom of [1.3, 2, 2.5]) {
    const s = state(720, 450, zoom, { panX: 40, panY: -25 });
    const from = { x: 500, y: 400 }, to = { x: 431, y: 467 };
    const after = { ...s, ...app.copy(app.sandbox.tableGrabPan(s, from, to, zoom)) };
    assert.ok(same(under(cam(after), to.x, to.y), under(cam(s), from.x, from.y)),
      `at ${zoom} the rest point under the hand stays under it`);
    /* So the point of the mat under it does too, at any height. */
    const m0 = app.evaluate(`tablePlaneMatrix(${JSON.stringify({ ...FIT_GEOM, mat: { left: 0, top: 0 }, tilt: REST, camera: cam(s) })})`);
    const m1 = app.evaluate(`tablePlaneMatrix(${JSON.stringify({ ...FIT_GEOM, mat: { left: 0, top: 0 }, tilt: REST, camera: cam(after) })})`);
    for (const z of [0, 96]) {
      const a = app.copy(app.sandbox.tableUnproject(m0, from.x, from.y, z));
      const b = app.copy(app.sandbox.tableUnproject(m1, to.x, to.y, z));
      assert.ok(Math.hypot(a.u - b.u, a.v - b.v) < 1e-6, `at ${zoom}, ${z}px up: ${JSON.stringify(a)} against ${JSON.stringify(b)}`);
    }
  }
  assert.deepStrictEqual(app.copy(app.sandbox.tableGrabPan({ panX: 3, panY: 4 }, { x: 1, y: 1 }, { x: 1, y: 1 }, 2)),
    { panX: 3, panY: 4 }, 'a hand that has not moved has not moved the table');
});

test('the edge band’s speed gathers on a smoothstep, all of it 60% of the way in', () => {
  const ramp = t => app.evaluate(`tableEdgeRamp(${t})`);
  assert.strictEqual(app.evaluate('TABLE_EDGE_FULL_AT'), 0.6);
  assert.strictEqual(ramp(0), 0, 'nothing at the band’s inner edge');
  assert.strictEqual(ramp(0.6), 1, 'all of it 60% of the way in');
  assert.strictEqual(ramp(0.8), 1, 'and all the way out');
  assert.strictEqual(ramp(1), 1);
  assert.ok(near(ramp(0.3), 0.5), 'half of it halfway there');
  assert.ok(ramp(0.45) > 0.75, `three quarters of the way there, most of it: ${ramp(0.45)}`);
  let last = 0;
  for (let t = 0; t <= 1; t += 0.01) {
    const r = ramp(t);
    assert.ok(r >= last - 1e-12 && r - last < 0.05, `it gathers smoothly at ${t}: ${last} to ${r}`);
    last = r;
  }
  assert.ok(ramp(0.006) < 0.001, 'with no step where the band begins');
  assert.strictEqual(ramp(-1), 0);
  assert.strictEqual(ramp(NaN), 0);
});

test('the edges scroll the view: none in the middle, growing through the band, both ways in a corner', () => {
  const edge = (x, y, w = W, h = H, z) => app.call('tableEdgeVelocity', x, y, w, h, z);
  const MAX = app.evaluate('TABLE_SCROLL_MAX');
  assert.strictEqual(MAX, 2200);
  assert.strictEqual(app.evaluate('tableEdgeBand(1440)'), 0.03 * 1440, 'three percent of a wide window');
  assert.strictEqual(app.evaluate('tableEdgeBand(900)'), 32, 'and never less than 32px');
  assert.deepStrictEqual(edge(720, 450), { vx: 0, vy: 0 }, 'the middle asks nothing');
  assert.deepStrictEqual(edge(W - 1 - 43.2, 450), { vx: 0, vy: 0 }, 'nor the band’s inner edge');
  assert.ok(near(edge(W - 1, 450).vx, MAX), 'the window’s last pixel is the most');
  assert.ok(near(edge(0, 450).vx, -MAX), 'the first, the most the other way');
  assert.ok(near(edge(W - 1 - 43.2 * 0.4, 450).vx, MAX), '60% of the way into the band, already the most');
  assert.ok(near(edge(W - 1 - 43.2 * 0.7, 450).vx, MAX / 2), '30% of the way in, half');
  assert.ok(edge(W - 25, 450).vx > edge(W - 35, 450).vx, 'deeper is faster');
  assert.ok(near(edge(720, H - 1).vy, MAX) && near(edge(720, 0).vy, -MAX), 'up and down the same, the far side up');
  assert.ok(near(edge(720, H - 1 - 32 * 0.7).vy, MAX / 2), 'the 32px band down');
  const corner = edge(2, 3);
  assert.ok(near(corner.vx, -MAX) && near(corner.vy, -MAX), `a corner scrolls both ways: ${JSON.stringify(corner)}`);
  for (const [x, y] of [[-1, 450], [W, 450], [720, H], [NaN, 450], [undefined, undefined]]) {
    assert.deepStrictEqual(edge(x, y), { vx: 0, vy: edge(720, y).vy }, `outside the window across, ${x},${y}, asks nothing across`);
  }
  assert.deepStrictEqual(edge(5, 5, 0, 0), { vx: 0, vy: 0 }, 'a window with no size asks nothing');
  /* Zoomed in, faster by the square root of the zoom. */
  assert.ok(near(edge(W - 1, 450, W, H, 2.5).vx, MAX * Math.sqrt(2.5)), 'at 2.5, √2.5 times as fast');
  assert.ok(near(edge(0, 450, W, H, 1.44).vx, -MAX * 1.2), 'at 1.44, 1.2 times');
});

test('the top speed grows with the square root of the zoom', () => {
  const speed = z => app.evaluate(`tableScrollSpeed(${z})`);
  assert.strictEqual(speed(1), 2200, 'at the whole table, TABLE_SCROLL_MAX');
  assert.ok(near(speed(2.5), 2200 * Math.sqrt(2.5)), `about 3500 at 2.5: ${speed(2.5)}`);
  assert.ok(near(speed(1.21), 2200 * 1.1));
  assert.strictEqual(speed(9), speed(2.5), 'a zoom past the range counts as its most');
  assert.strictEqual(speed(NaN), 2200);
  /* In the table's own distance — window pixels over the zoom — a little
     slower zoomed in, so not dragging the way straight multiplying would. */
  assert.ok(speed(2.5) / 2.5 > 2200 / 2.5 && speed(2.5) / 2.5 < 2200, 'between the two');
});

test('W A S D and the arrows ask the most speed their way, twice it with Shift, both at once on a diagonal', () => {
  const keys = (held, fast, zoom) => app.copy(app.sandbox.tableKeyVelocity(held, fast, zoom));
  assert.deepStrictEqual(keys([]), { vx: 0, vy: 0 });
  assert.deepStrictEqual(keys(['right']), { vx: 2200, vy: 0 });
  assert.deepStrictEqual(keys(['left']), { vx: -2200, vy: 0 });
  assert.deepStrictEqual(keys(['up']), { vx: 0, vy: -2200 }, 'up is the view moving up the table, to its far side');
  assert.deepStrictEqual(keys(['down']), { vx: 0, vy: 2200 });
  assert.deepStrictEqual(keys(['up', 'left']), { vx: -2200, vy: -2200 }, 'a diagonal is both');
  assert.deepStrictEqual(keys(['left', 'right']), { vx: 0, vy: 0 }, 'two ways against each other cancel');
  assert.deepStrictEqual(keys(['down', 'right'], true), { vx: 4400, vy: 4400 }, 'Shift doubles it');
  assert.strictEqual(app.evaluate('TABLE_SCROLL_FAST'), 2);
  assert.deepStrictEqual(keys(['right'], false, 1.44), { vx: 2200 * 1.2, vy: 0 }, 'zoomed in, by the root of the zoom');
  assert.ok(near(keys(['up'], true, 2.5).vy, -2 * 2200 * Math.sqrt(2.5)), 'and Shift on top of that');

  const dir = (e, focus) => app.sandbox.tablePanKeyDir(e, focus);
  assert.strictEqual(dir({ code: 'KeyW', key: 'w' }), 'up');
  assert.strictEqual(dir({ code: 'KeyA', key: 'a' }), 'left');
  assert.strictEqual(dir({ code: 'KeyS', key: 's' }), 'down');
  assert.strictEqual(dir({ code: 'KeyD', key: 'D', shiftKey: true }), 'right', 'Shift is no other shortcut');
  assert.strictEqual(dir({ code: 'KeyW', key: 'z' }), 'up', 'by its place on the keyboard, whatever it is labelled');
  assert.strictEqual(dir({ code: '', key: 's' }), 'down', 'or by its letter, where no place is named');
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.strictEqual(dir({ code: 'KeyD', key: 'd', [mod]: true }), null, `${mod} is somebody else’s`);
  }
  assert.strictEqual(dir({ code: 'KeyD', key: 'd' }, 'field'), null, 'a field keeps its letters');
  assert.strictEqual(dir({ code: 'KeyD', key: 'd' }, 'control'), 'right', 'a button does not');
  assert.strictEqual(dir({ code: 'ArrowRight', key: 'ArrowRight' }), 'right');
  assert.strictEqual(dir({ code: 'ArrowUp', key: 'ArrowUp' }), 'up');
  assert.strictEqual(dir({ code: 'ArrowUp', key: 'ArrowUp' }, 'control'), null, 'a control keeps its arrows');
  assert.strictEqual(dir({ code: 'ArrowUp', key: 'ArrowUp' }, 'field'), null);
  for (const key of ['+', '-', '0', '/', 'Escape', 'Enter', 'q']) {
    assert.strictEqual(dir({ code: '', key }), null, `${key} is not a pan`);
  }
  assert.strictEqual(dir(null), null);

  /* What the focus is on. */
  const scene = { contains: el => !!el.inScene };
  const el = (tagName, extra = {}) => ({ tagName, matches: sel => sel.split(',').map(s => s.trim()).includes(tagName.toLowerCase()), ...extra });
  const kind = e => app.sandbox.tableFocusKind(e, scene);
  assert.strictEqual(kind(null), 'free', 'nothing is the page');
  assert.strictEqual(kind(el('INPUT', { type: 'text' })), 'field');
  assert.strictEqual(kind(el('INPUT', { type: 'range', inScene: true })), 'field', 'the card-size slider is an input');
  assert.strictEqual(kind(el('TEXTAREA')), 'field');
  assert.strictEqual(kind(el('SELECT')), 'field');
  assert.strictEqual(kind(el('DIV', { isContentEditable: true })), 'field');
  assert.strictEqual(kind(el('BUTTON', { inScene: true })), 'control', 'a tab or a card on the table');
  assert.strictEqual(kind(el('DIV', { inScene: true })), 'free', 'the bare table');
  assert.strictEqual(kind(el('DIV')), 'control', 'anything off the table, a panel among them');
});

test('the view’s velocity eases in and out, and comes to a stop', () => {
  /* A time constant of 0.07s: the gap is down to 1/e of itself in it. */
  assert.strictEqual(app.evaluate('TABLE_SCROLL_EASE_S'), 0.07);
  const ease = app.evaluate('tableEaseFor(1000 / 60, TABLE_SCROLL_EASE)');
  assert.ok(near(1 - app.evaluate('tableEaseFor(70, TABLE_SCROLL_EASE)'), Math.exp(-1), 1e-9), 'the gap is 1/e of itself after 70ms');
  const step = (v, t) => app.copy(app.sandbox.tableVelocityStep(v, t, ease));
  let v = { x: 0, y: 0 };
  let frames = 0, last = 0;
  while (v.x !== 2200 && frames < 200) {
    v = step(v, { vx: 2200, vy: -2200 });
    assert.ok(v.x > last && v.x <= 2200, 'it gathers speed, never past what is asked');
    assert.strictEqual(v.y, -v.x, 'each way alike');
    last = v.x;
    frames++;
  }
  assert.ok(frames > 5, `it does not start at full speed: ${frames} frames`);
  assert.ok(frames < 60, `and is at full speed within a second: ${frames} frames`);
  frames = 0;
  while (v.x !== 0 && frames < 200) { v = step(v, { vx: 0, vy: 0 }); frames++; }
  assert.ok(frames > 5 && frames < 60, `it stops smoothly, and does stop: ${frames} frames`);
  assert.deepStrictEqual(v, { x: 0, y: 0 });
  assert.deepStrictEqual(step({ x: NaN }, null), { x: 0, y: 0 }, 'nothing readable is standing still');
});

test('the edges stand still over a control on the table, and over anything off it', () => {
  const scene = { contains: e => !!e?.inScene };
  /* An element by what it is and what it is inside: closest() finds the first
     of them that a part of the selector names. */
  const el = (chain, inScene = true) => ({
    inScene,
    closest: sel => (chain.some(c => sel.split(',').map(s => s.trim()).includes(c)) ? {} : null),
  });
  const paused = e => app.sandbox.tableScrollPaused(e, scene);
  assert.strictEqual(paused(el(['.table-mat'])), false, 'bare felt scrolls');
  assert.strictEqual(paused(el(['.table-plane'])), false, 'and bare wood');
  assert.strictEqual(paused(el(['.table-card', 'button'])), false, 'and a card lying at the edge');
  for (const control of ['.table-tab', '.table-scale', '.table-slip', '.table-bin', '.table-zone-label',
                         '.table-zone-grip', '.table-zone-chips', '.table-drawer-chips', '.table-panel']) {
    assert.strictEqual(paused(el([control])), true, `${control} keeps the view still`);
  }
  assert.strictEqual(paused(el(['.table-panel-hdr'], false)), true, 'the tucked bar, off the table');
  assert.strictEqual(paused(el(['.table-drawer'], false)), true, 'and the docked drawer');
  assert.strictEqual(paused(null), true, 'and a pointer not known');

  const grab = (e, button) => app.sandbox.tableGrabbable(e, scene, button);
  assert.strictEqual(grab(el(['.table-mat']), 0), true, 'bare felt can be taken hold of');
  assert.strictEqual(grab(el(['.table-plane']), 0), true, 'and bare wood');
  assert.strictEqual(grab(el(['.table-card', 'button']), 0), false, 'a card pressed is a card picked up');
  assert.strictEqual(grab(el(['.table-zone-label']), 0), false, 'a zone’s label carries the zone');
  assert.strictEqual(grab(el(['.table-zone-grip']), 0), false, 'and its grip resizes it');
  assert.strictEqual(grab(el(['.table-tab']), 0), false);
  assert.strictEqual(grab(el(['.table-card', 'button']), 1), true, 'the middle button takes hold over a card');
  assert.strictEqual(grab(el(['.table-tab']), 1), true, 'and anywhere on the table');
  assert.strictEqual(grab(el(['.table-slip', 'input']), 1), false, 'but a field, where it pastes');
  assert.strictEqual(grab(el(['.table-panel']), 1), false, 'or a page lying on the table');
  assert.strictEqual(grab(el(['.table-mat']), 2), false, 'the other button is the menu’s');
  assert.strictEqual(grab(el(['.table-mat'], false), 1), false, 'nothing off the table');
});

test('the camera eases its zoom and lean to their targets, carries the pan, and says when it has arrived', () => {
  let at = app.copy(app.evaluate('TABLE_CAMERA_REST'));
  at = { ...at, panX: 37, panY: -12 };
  const to = { zoom: 2.5, ...lean(W, 0) };
  let frames = 0, settled = false, last = Infinity;
  while (!settled && frames < 500) {
    const step = app.copy(app.evaluate(`tableCameraStep(${JSON.stringify(at)}, ${JSON.stringify(to)})`));
    const gap = Math.abs(to.zoom - step.at.zoom) + Math.abs(to.leanX - step.at.leanX);
    assert.ok(gap <= last, 'every frame closes on the target, never past it');
    last = gap;
    at = step.at;
    settled = step.settled;
    frames++;
  }
  assert.ok(settled, 'the loop stops itself');
  assert.ok(frames < 120, `and within two seconds of frames, not ${frames}`);
  assert.deepStrictEqual(at, { ...to, panX: 37, panY: -12 }, 'and arrives exactly, not a hair short, the pan as it was');
  const again = app.copy(app.evaluate(`tableCameraStep(${JSON.stringify(at)}, ${JSON.stringify(to)})`));
  assert.deepStrictEqual(again, { at, settled: true }, 'a camera already there is settled');
});

test('the lean eases about a quarter more gently than the zoom', () => {
  const zoomEase = app.evaluate('TABLE_ZOOM_EASE'), panEase = app.evaluate('TABLE_PAN_EASE');
  assert.strictEqual(zoomEase, 0.12, 'the zoom keeps up with the wheel as it did');
  assert.strictEqual(panEase, 0.09, 'the lean closes a quarter less of its gap a frame');
  /* One frame from rest towards a zoomed, leaning target: each part closes its own share. */
  const to = { zoom: 2, leanX: 1, leanY: -1 };
  const { at } = app.copy(app.evaluate(`tableCameraStep(TABLE_CAMERA_REST, ${JSON.stringify(to)})`));
  assert.ok(near(at.zoom, 1 + zoomEase), `the zoom closes ${zoomEase} of its gap, not ${at.zoom - 1}`);
  assert.ok(near(at.leanX, panEase) && near(at.leanY, -panEase), 'and each lean closes its own share');
});

test('the camera holds its zoom inside the range, whatever it is asked', () => {
  assert.strictEqual(cam(state(720, 450, 0.2)).zoom, 1);
  assert.strictEqual(cam(state(720, 450, 9)).zoom, 2.5);
  assert.strictEqual(cam(state(720, 450, NaN)).zoom, 1);
  assert.deepStrictEqual(app.copy(app.sandbox.tableCamera({ zoom: 2, leanX: 1, leanY: 1, panX: 9, panY: 9 }, 0, 0)), { zoom: 2, tx: 0, ty: 0 },
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

/* The frame loop's camera, driven in the sandbox: the table measured as it is
 * fitted, the keys held through the same set the key handlers fill, and a
 * frame of tableCameraAdvance at a time. */
function drive({ zoom = 2, pan = {}, keys = [], fast = false, motion = true } = {}) {
  app.evaluate(`
    tableGeom = { view: { width: ${W}, height: ${H} } };
    tableBounds = ${JSON.stringify(BOUNDS)};
    tableAt = { ...TABLE_CAMERA_REST, zoom: ${zoom}, ...${JSON.stringify(pan)} };
    tableTo = { zoom: ${zoom}, leanX: 0, leanY: 0 };
    tableVel = { x: 0, y: 0 };
    tablePointer = null; tableGrab = null; tableHold = null; tableZoneHold = null; tableLooked = null;
    tableKeysHeld = new Set(${JSON.stringify(keys)}); tableKeysFast = ${fast};`);
  const frame = () => app.evaluate(`tableCameraAdvance(TABLE_FRAME_MS, ${motion})`);
  const at = () => app.copy(app.evaluate('({ ...tableAt, vel: tableVel })'));
  const release = () => app.evaluate('tableKeysHeld.clear()');
  return { frame, at, release };
}
/* And the sandbox put back as it was, for the tests after. */
const undrive = () => app.evaluate(`
  tableAnchor = null; tableGeom = null; tableBounds = null; tableKeysHeld = new Set();
  tableAt = { ...TABLE_CAMERA_REST }; tableTo = { zoom: 1, leanX: 0, leanY: 0 }; tableVel = { x: 0, y: 0 };`);

test('holding D moves the view right, and letting go eases it to a stop', () => {
  const run = drive({ zoom: 2.5, keys: ['right'] });
  for (let i = 0; i < 10; i++) assert.strictEqual(run.frame(), true, 'it asks for another frame while it moves');
  const held = run.at();
  /* A sixth of a second at up to 2200·√2.5 window pixels a second, eased in
     over its first 0.07s: some 300 to 580 window pixels, which is 1/2.5 as
     many of the rest picture at zoom 2.5. */
  const top = 2200 * Math.sqrt(2.5) / 6 / 2.5;
  assert.ok(held.panX > top * 0.5 && held.panX < top, `a sixth of a second of D: ${held.panX} of at most ${top}`);
  assert.strictEqual(held.panY, 0, 'and only across');
  run.release();
  let frames = 0;
  while (run.frame() && frames < 200) frames++;
  const stopped = run.at();
  assert.ok(frames > 3 && frames < 60, `it eases to a stop: ${frames} frames`);
  assert.ok(stopped.panX > held.panX, 'gliding on a little as it does');
  assert.deepStrictEqual(stopped.vel, { x: 0, y: 0 });

  /* With cards still, the speed is there at once and gone at once. */
  const still = drive({ zoom: 2, keys: ['up'], fast: true, motion: false });
  still.frame();
  assert.ok(near(still.at().panY, -2 * 2200 * Math.SQRT2 / 60 / 2, 1e-6), `a frame of Shift+W at full speed: ${still.at().panY}`);
  still.release();
  assert.strictEqual(still.frame(), false, 'and stops dead');
  undrive();
});

test('the view travels as far in a fifth of a second at 30 frames a second as at 60, and a stall counts as a tenth of one', () => {
  assert.strictEqual(app.evaluate('TABLE_FRAME_MAX_MS'), 100);
  const travel = (fps, seconds = 0.2) => {
    const run = drive({ zoom: 2, keys: ['right'], motion: false });
    for (let i = 0; i < Math.round(fps * seconds); i++) app.evaluate(`tableCameraAdvance(${1000 / fps}, false)`);
    return run.at().panX;
  };
  const want = 2200 * Math.SQRT2 * 0.2 / 2;
  for (const fps of [30, 60, 120]) {
    assert.ok(near(travel(fps), want, 1e-6), `at ${fps} frames a second: ${travel(fps)} of ${want}`);
  }
  const run = drive({ zoom: 2, keys: ['right'], motion: false });
  app.evaluate('tableCameraAdvance(500, false)');
  assert.ok(near(run.at().panX, 2200 * Math.SQRT2 * 0.1 / 2, 1e-6), `a half-second stall moves it a tenth of a second’s worth: ${run.at().panX}`);
  undrive();
});

test('against the rim the view stops, and the frame loop goes to sleep', () => {
  const run = drive({ zoom: 2.5, keys: ['left', 'up'] });
  let frames = 0;
  while (run.frame() && frames < 2000) frames++;
  assert.ok(frames < 2000, 'the loop stops itself with the keys still held');
  const s = run.at();
  const r = range(2.5);
  assert.ok(near(s.panX, r.x.lo, 1e-6) && near(s.panY, r.y.lo, 1e-6), `held at the far-left corner, the margin past it: ${JSON.stringify(s)}`);
  assert.strictEqual(run.frame(), false, 'and another frame finds nothing to do');
  /* At the whole table the keys ask nothing at all. */
  const rest = drive({ zoom: 1, keys: ['right'] });
  assert.strictEqual(rest.frame(), false);
  assert.deepStrictEqual([rest.at().panX, rest.at().panY], [0, 0]);
  undrive();
});

test('a zoom eased over frames stays about its anchor, the lean’s fading counted in', () => {
  app.evaluate(`
    tableGeom = { view: { width: ${W}, height: ${H} } };
    tableBounds = ${JSON.stringify(BOUNDS)};
    tableAt = { ...TABLE_CAMERA_REST, ...tableLeanTarget(1100, 300, ${W}, ${H}) };
    tableTo = { zoom: 2.2, ...tableLeanTarget(1100, 300, ${W}, ${H}) };
    tableVel = { x: 0, y: 0 }; tableKeysHeld = new Set(); tablePointer = null;
    tableAnchor = { x: 1100, y: 300 };`);
  const view = () => app.copy(app.evaluate(`tableCamera(tableAt, ${W}, ${H}, TABLE_PAN_REST)`));
  const at = under(view(), 1100, 300);
  let frames = 0;
  while (app.evaluate('tableCameraAdvance(TABLE_FRAME_MS, true)') && frames < 300) {
    assert.ok(same(under(view(), 1100, 300), at, 1e-6), `frame ${frames}: ${JSON.stringify(under(view(), 1100, 300))}`);
    frames++;
  }
  assert.ok(near(app.evaluate('tableAt.zoom'), 2.2, 1e-12) && same(under(view(), 1100, 300), at, 1e-6), 'and when it arrives');
  undrive();
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
/* A camera zoomed in about a pointer at (x, y) from the whole table, as the
 * wheel turned there leaves it, leaning towards the pointer. */
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
  /* Step after step, in and out, each zoom about the pointer from wherever
     the last left the view — the pan is state now, not the pointer's. */
  for (const [x, y] of [[720, 450], [210, 160], [1250, 800], [40, 870]]) {
    let s = state(x, y);
    const before = unproject(matrix({ tilt: REST, camera: cam(s) }), x, y);
    const held0 = unproject(matrix({ tilt: REST, camera: cam(s) }), x, y, 96);
    for (const dy of [-100, -100, -37, -300, 120, -4]) {
      s = zoomAbout(s, app.evaluate(`tableWheelZoom(${s.zoom}, ${dy}, 0)`), x, y);
      const now = unproject(matrix({ tilt: REST, camera: cam(s) }), x, y);
      assert.ok(Math.hypot(now.u - before.u, now.v - before.v) < 1e-6,
        `${x},${y} at zoom ${s.zoom}: ${now.u},${now.v} against ${before.u},${before.v}`);
      /* At a card's height too: a card held while the wheel turns stays
         under the hand. */
      const held = unproject(matrix({ tilt: REST, camera: cam(s) }), x, y, 96);
      assert.ok(Math.hypot(held.u - held0.u, held.v - held0.v) < 1e-6, 'and at a held card’s height');
    }
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

test('no more than the deck’s ceiling of cards are laid, and every one lies on the mat', () => {
  const max = app.evaluate('TABLE_DECK_CARDS_MAX');
  assert.strictEqual(layout(cards(max + 30, i => i % 5)).spots.length, max);
  const laid = layout(cards(80, i => i % 5));
  assert.strictEqual(laid.spots.length, 80);
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

test('Collections lays the rows on show, in the stack view’s piles, at most a hundred', () => {
  const rows = n => Array.from({ length: n }, (_, i) => ({ name: `Card ${i}` }));
  const src = ask('collections', {
    colShownPiles: () => [{ label: 'Creature', cards: rows(170) }, { label: 'Land', cards: [{ name: 'Forest' }] }],
    scryfallCache: new Map([['Forest', 'forest.jpg']]),
  });
  assert.strictEqual(src.cards.length, 100);
  assert.deepStrictEqual(plain(src.cards.at(-1)), { name: 'Forest', imageUrl: 'forest.jpg', group: 'Land' },
    'the one land is laid even behind a hundred and seventy creatures');
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

// ── Putting the Card sheet down ───────────────────────────────────────────
// The Card tab, opened over another view, closes back to it. What is asserted
// is what comes back and how it is reached; the panel's own moving of panes is
// stubbed, being the smoke harness's to watch.

test('the Card sheet remembers the view it came up over, as it was left', () => {
  const ret = o => app.copy(app.sandbox.tableCardReturnFor({ to: 'card', ...o }));
  assert.deepStrictEqual(ret({ from: 'deckview' }), { tab: 'deckview', panel: 'open' });
  assert.deepStrictEqual(ret({ from: 'deckview', tucked: true }), { tab: 'deckview', panel: 'tucked' },
    'a tucked panel comes back tucked');
  assert.deepStrictEqual(ret({ from: null, laid: 'deckview' }), { tab: 'deckview', panel: 'closed' },
    'the mat alone comes back with no panel over it');
  assert.deepStrictEqual(ret({ from: 'lands', laid: 'deckview' }), { tab: 'lands', panel: 'open' },
    'the panel that was up is the view, not the cards under it');
  assert.strictEqual(ret({ from: null, laid: null }), null, 'a bare table has nothing to go back to');
  assert.strictEqual(ret({ from: null, laid: 'card' }), null, 'nor does the Card tab’s own card');
  assert.strictEqual(ret({ from: 'card' }), null, 'nor the sheet opened over itself');
  assert.strictEqual(app.sandbox.tableCardReturnFor({ to: 'deckview', from: 'sets' }), null,
    'only the Card sheet is a way back');
});

test('the sheet closes by Back only when Back is certainly the way it came', () => {
  const by = o => app.sandbox.tableReturnByBack({
    ret: { tab: 'deckview', backTo: true, token: 4 },
    state: { view: 'card', cardName: 'Sol Ring', tableOver: 4 }, ...o });
  assert.strictEqual(by({}), true, 'the card entry pushed over the deck’s, stamped');
  assert.strictEqual(by({ state: { view: 'card', cardId: 'x', tableOver: 4 } }), true,
    'a printing swapped in place is still it');
  assert.strictEqual(by({ state: { view: 'tab', tab: 'card', tableOver: 4 } }), true,
    'the tab pressed on the rim pushed this one');
  assert.strictEqual(by({ state: { view: 'card', cardName: 'Arcane Signet' } }), false,
    'a second card was opened on the sheet, an entry of its own');
  assert.strictEqual(by({ state: { view: 'card', cardName: 'Sol Ring', tableOver: 3 } }), false,
    'an older sheet’s entry, reached some other way');
  assert.strictEqual(by({ state: { view: 'tab', tab: 'sets', tableOver: 4 } }), false,
    'the entry is somebody else’s now');
  assert.strictEqual(by({ ret: { tab: 'deckview', backTo: false, token: 4 } }), false,
    'the entry under the card was not the deck’s');
  assert.strictEqual(by({ ret: null }), false);
});

/** The table with its panel moves stubbed: what tableShowPane, tableClosePanel
 *  and tableTuckPanel are asked to do, and setTab and the history, recorded. */
function tableWithSheet(ret) {
  const t = loadTableMode();
  t.evaluate(`
    _did = [];
    tableOn = true;
    tablePanel = { tab: 'card', kind: 'grow' };
    tableTucked = false;
    tableCardReturn = ${JSON.stringify(ret)};
    tableShowPane = (tab, kind) => { _did.push(['show', tab, kind]); tablePanel = { tab, kind }; tableTucked = false; return true; };
    tableClosePanel = () => { _did.push(['close']); tablePanel = null; };
    tableTuckPanel = on => { _did.push(['tuck', on]); tableTucked = on; };
    setTab = tab => { _did.push(['setTab', tab]); tableModeBeforeTab(tab); };
    history = { state: { view: 'card', cardName: 'Sol Ring', tableOver: 4 }, back() { _did.push(['back']); } };
  `);
  return t;
}

test('closing the sheet over the deck steps Back, and Back brings the deck’s panel up as it was', () => {
  const t = tableWithSheet({ tab: 'deckview', panel: 'tucked', kind: 'float', backTo: true, token: 4 });
  t.evaluate('tableDismissPanel()');
  assert.deepStrictEqual(t.copy(t.evaluate('_did')), [['back']], 'the close went anywhere but Back');
  // popstate arrives as setTab(tab, false), which tells the table first.
  t.evaluate(`tableModeBeforeTab('deckview')`);
  assert.deepStrictEqual(t.copy(t.evaluate('_did')).slice(1),
    [['show', 'deckview', 'float'], ['tuck', true]], 'the deck’s panel did not come back tucked');
  assert.strictEqual(t.evaluate('tableCardReturn'), null, 'and the way back is spent');
});

test('where Back is not certain, the close visits the tab, once', () => {
  const t = tableWithSheet({ tab: 'deckview', panel: 'open', kind: 'float', backTo: false, token: 4 });
  t.evaluate('tableDismissPanel()');
  assert.deepStrictEqual(t.copy(t.evaluate('_did')),
    [['setTab', 'deckview'], ['show', 'deckview', 'float']]);
});

test('a mat left with no panel over it comes back with none', () => {
  const t = tableWithSheet({ tab: 'deckview', panel: 'closed', kind: null, backTo: false, token: 4 });
  t.evaluate('tableDismissPanel()');
  assert.deepStrictEqual(t.copy(t.evaluate('_did')), [['setTab', 'deckview'], ['close']]);
});

test('with nothing behind it, the sheet just closes', () => {
  const t = tableWithSheet(null);
  t.evaluate('tableDismissPanel()');
  assert.deepStrictEqual(t.copy(t.evaluate('_did')), [['close']]);
});

test('the card’s entry is stamped once it has been pushed, and an entry nobody pushed is not', () => {
  /* The stamp is what lets the close step Back (tableReturnByBack), so it
   * has to land on the entry pushed for the sheet and on nothing else: the
   * microtask runs after the opener's push, and finds the deck's own entry
   * standing when there was no push at all. */
  const t = loadTableMode();
  t.evaluate(`
    _tasks = [];
    queueMicrotask = fn => _tasks.push(fn);
    history = { state: { view: 'tab', tab: 'deckview' }, replaceState(s) { this.state = s; } };
    tableCardReturn = { tab: 'deckview', panel: 'open', backTo: true, token: 7 };
    tableStampCardEntry(tableCardReturn);
    history.state = { view: 'card', cardName: 'Sol Ring' };   // openCardPage's push
    _tasks.splice(0).forEach(fn => fn());
  `);
  assert.deepStrictEqual(t.copy(t.evaluate('history.state')), { view: 'card', cardName: 'Sol Ring', tableOver: 7 });
  t.evaluate(`
    history.state = { view: 'tab', tab: 'deckview' };
    tableStampCardEntry(tableCardReturn);
    _tasks.splice(0).forEach(fn => fn());
  `);
  assert.deepStrictEqual(t.copy(t.evaluate('history.state')), { view: 'tab', tab: 'deckview' },
    'the deck’s own entry was stamped as if it were the card’s');
});

test('another tab opened over the sheet is opened, and the way back is not taken', () => {
  const t = tableWithSheet({ tab: 'deckview', panel: 'open', kind: 'float', backTo: true, token: 4 });
  t.evaluate(`tableModeBeforeTab('sets')`);
  assert.deepStrictEqual(t.copy(t.evaluate('_did')), [['show', 'sets', null]],
    'the sheet’s way back was taken for a tab it was not opened over');
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

test('the Deck Builder lays every entry of a deck of a hundred and more, up to its ceiling', () => {
  const heads = [{ name: 'A', ref: 'commander/A' }, { name: 'B', ref: 'commander/B' }];
  const entries = (n, cat) => Array.from({ length: n }, (_, i) => ({ name: `${cat}${i}`, ref: `main/${cat}${i}`, qty: 1 }));
  /* A Commander deck and more: 2 commanders and 148 entries in three categories. */
  const piles = [{ label: 'Creatures', cards: entries(90, 'c') }, { label: 'Lands', cards: entries(38, 'l') },
    { label: 'Ramp', cards: entries(20, 'r') }];
  const laid = plain(app.sandbox.tableDeckCards(heads, piles));
  assert.strictEqual(laid.length, 150, 'nothing is left off a deck under the ceiling');
  assert.deepStrictEqual(laid.map(c => c.ref), [...heads, ...piles.flatMap(p => p.cards)].map(c => c.ref),
    'every entry, in the builder’s order');
  /* And keyed for the mat, the deck scope keeps all of them too. */
  assert.strictEqual(app.sandbox.tableKeyCards(laid, 'deckview').length, 150);

  const max = app.evaluate('TABLE_DECK_CARDS_MAX');
  assert.strictEqual(max, 250);
  const huge = [{ label: 'X', cards: entries(400, 'x') }, { label: 'Y', cards: entries(5, 'y') }];
  const capped = plain(app.sandbox.tableDeckCards(heads, huge));
  assert.strictEqual(capped.length, max, 'a list past the ceiling is laid to it and no further');
  assert.deepStrictEqual(capped.slice(0, 2).map(c => c.name), ['A', 'B'], 'the commanders are never the ones left off');
  assert.strictEqual(capped.filter(c => c.group === 'Y').length, 5, 'and the room left is shared fairly');
});

test('each source lays no more than its cap: the deck its ceiling, every other tab a hundred', () => {
  const sb = app.sandbox;
  assert.strictEqual(app.evaluate('TABLE_TAB_CARDS_MAX'), 100);
  assert.strictEqual(sb.tableCardsMaxFor('deckview'), app.evaluate('TABLE_DECK_CARDS_MAX'));
  for (const scope of ['collections', 'players', 'scryfall', 'sets', 'wants', 'card', '']) {
    assert.strictEqual(sb.tableCardsMaxFor(scope), 100, `${scope || 'the API'} lays a hundred`);
  }
  const list = n => Array.from({ length: n }, (_, i) => ({ name: `Card ${i}` }));
  assert.strictEqual(sb.tableKeyCards(list(300), 'scryfall').length, 100, 'a page of search results is cut to the cap');
  assert.strictEqual(sb.tableKeyCards(list(300), '').length, 100, 'and so is a list laid through the API');
  assert.strictEqual(sb.tableKeyCards(list(300), 'deckview').length, 250, 'the deck is cut only at its ceiling');
  const src = ask('scryfall', { sfShownCards: () => list(175).map((c, i) => ({ ...c, id: `id${i}` })) });
  assert.strictEqual(sb.tableKeyCards(src.cards, 'scryfall').length, 100);
  const sets = ask('sets', { setShownPiles: () => [{ label: 'Common', cards: list(150) }, { label: 'Rare', cards: list(60) }] });
  assert.strictEqual(sets.cards.length, 100, 'a set’s piles share a hundred');
});

test('a deck entry of many copies is one card on the mat, its count on its face', () => {
  const sb = app.sandbox;
  const piles = [{ label: 'Lands', cards: [
    { name: 'Island', image: 'island.jpg', ref: 'main/Island', qty: 30 },
    { name: 'Sol Ring', image: 'sol.jpg', ref: 'main/Sol Ring', qty: 1 },
  ] }];
  const keyed = sb.tableKeyCards(sb.tableDeckCards([], piles), 'deckview');
  assert.deepStrictEqual(plain(keyed.map(c => [c.name, c.qty])), [['Island', 30], ['Sol Ring', 1]],
    'thirty Islands are one card, standing for thirty');
  assert.strictEqual(sb.tableKeyCards([{ name: 'X' }], 'collections')[0].qty, 1, 'a card with no count stands for one');
  assert.strictEqual(sb.tableKeyCards([{ name: 'X', qty: 'junk' }], '')[0].qty, 1);
  assert.strictEqual(sb.tableKeyCards([{ name: 'X', qty: 0 }], '')[0].qty, 1);

  /* The page's own esc (js/state.js) is not in the sandbox; the face only
     needs one that escapes. */
  app.evaluate(`if (typeof esc === 'undefined') globalThis.esc = s => String(s).replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');`);
  const face = card => app.evaluate(`tableCardFace(${JSON.stringify(card)})`);
  const many = face({ name: 'Island', imageUrl: 'island.jpg', qty: 30 });
  assert.match(many, /<span class="table-card-qty" aria-hidden="true">×30<\/span>$/, 'the count lies on the card, after its picture');
  assert.doesNotMatch(face({ name: 'Sol Ring', imageUrl: 'sol.jpg', qty: 1 }), /table-card-qty/, 'one copy says nothing');
  assert.match(face({ name: 'Blank', imageUrl: '', qty: 4 }), /table-card-blank.*×4/, 'a card with no picture still says it');
  assert.strictEqual(sb.tableCardLabel({ name: 'Island', qty: 30 }), 'Island, 30 copies', 'and its name says it to a screen reader');
  assert.strictEqual(sb.tableCardLabel({ name: 'Sol Ring', qty: 1 }), 'Sol Ring');
  assert.strictEqual(sb.tableCardLabel({ name: 'Deck', qty: 1, open: () => {} }), 'Open Deck');

  /* A change of count is not a new layout: the same cards, lying where they are. */
  const sig = qty => sb.tableListSig([{ name: 'Island', id: 'main/Island', group: 'Lands', qty }], 'deckview');
  assert.strictEqual(sig(30), sig(29), 'one Island binned moves nothing');

  const css = read('public/css/table.css');
  const rule = css.match(/\.table-card-qty\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /left:\s*[\d.]+%/, 'on the card’s left…');
  assert.match(rule, /bottom:\s*[\d.]+%/, '…lower corner');
  assert.match(rule, /background:\s*var\(--surface-1\)/, 'on the app’s own surface');
  assert.match(rule, /color:\s*var\(--text\)/, 'in its own text');
  assert.match(rule, /transform:\s*translateZ\(var\(--table-face-z/, 'lifted off the picture by a hair');
  assert.match(rule, /pointer-events:\s*none/, 'pressing it is pressing the card');
  assert.match(rule, /opacity:\s*var\(--table-bin-fade/, 'and it fades with the picture over the bin');
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

test('the landing mark lies where the card lands: the same spot, the same angle, the same height', () => {
  const W = MAT.width, H = MAT.height;
  const rest = 15, lift = 96, turn = -3.4;
  const grab = { u: 12, v: -30 };
  for (const v of VIEWS) {
    const m = matrix(v);
    /* The pointer, over where a hand holding the card by `grab` would have
       it lying at (400, 300), mapped at the height the card is held at. */
    const pointer = project(m, 400 + grab.u, 300 + grab.v, rest + lift);
    const hit = unproject(m, pointer.x, pointer.y, rest + lift);
    const spot = app.copy(app.sandbox.tableDropSpot(hit, grab, W, H));
    assert.ok(near(spot.x * W, 400, 1e-6) && near(spot.y * H, 300, 1e-6),
      `it lands under where it is held, by the pointer’s own mapping: ${JSON.stringify(spot)}`);
    const cast = app.copy(app.sandbox.tableCastPose(spot, turn, rest));
    assert.deepStrictEqual(cast, { x: spot.x, y: spot.y, turn, z: rest },
      'the mark’s pose is the card’s own once it is down');
  }
  /* The same arithmetic lays both. */
  const box = { w: 110, h: 110 * 88 / 63 };
  const spot = { x: 0.4, y: 0.6, turn };
  const card = app.evaluate(`tableLieTransform(${JSON.stringify(spot)}, ${JSON.stringify(box)}, ${JSON.stringify(MAT)}, ${rest})`);
  const cast = app.copy(app.sandbox.tableCastPose(spot, turn, rest));
  assert.strictEqual(app.evaluate(`tableLieTransform(${JSON.stringify(cast)}, ${JSON.stringify(box)}, ${JSON.stringify(MAT)}, ${cast.z})`), card);
  assert.match(card, /^translate3d\([\d.-]+px, [\d.-]+px, 15\.00px\) rotate\(-3\.4deg\) rotateX\(0\.00deg\)$/);
});

test('past sixty cards, a card lying still casts no shadow, and one in hand still does', () => {
  const rest = n => app.sandbox.tableRestShadows(n);
  assert.strictEqual(app.evaluate('TABLE_SHADOWS_MAX'), 60);
  for (const n of [0, 1, 60]) assert.strictEqual(rest(n), true, `${n} cards keep their shadows, as the table always drew them`);
  for (const n of [61, 100, 250]) assert.strictEqual(rest(n), false, `${n} cards lie without`);
  const css = read('public/css/table.css');
  assert.match(css, /\.table-mat\[data-many\] \.table-card-img\s*\{\s*filter:\s*none;\s*\}/, 'the mat says so, and table.css drops the filter');
  const many = css.indexOf('.table-mat[data-many] .table-card-img');
  const held = css.indexOf('.table-card.is-held .table-card-img {');
  assert.ok(many > 0 && held > many, 'before the held shadow, so the card in hand still casts its own');
  assert.match(read('public/js/tablemode.js'), /toggleAttribute\('data-many', !tableRestShadows\(tableCards\.length\)\)/,
    'written each time the cards are laid');
});

test('the depth is a budget: every card at the ceiling lies under the mark and the rim, which lie where they did', () => {
  const gap = app.evaluate('TABLE_CARD_GAP'), depth = app.evaluate('TABLE_DEPTH');
  const cast = app.evaluate('TABLE_CAST_Z'), rim = app.evaluate('TABLE_RIM_Z');
  /* The rim and the mark lie where sixty cards a quarter pixel apart put them,
     so that no number of cards raises them. */
  assert.strictEqual(rim, 66 * 0.25, 'the rim at the height it always had');
  assert.strictEqual(cast, 63 * 0.25, 'and the mark');
  const heights = n => app.copy(app.evaluate(`(() => {
    const saved = tableCards;
    tableCards = Array.from({ length: ${n} }, (_, i) => ({ rank: i }));
    const z = tableCards.map(tableCardZ);
    tableCards = saved;
    return z;
  })()`));
  for (const n of [1, 60, 100, 200, app.evaluate('TABLE_DECK_CARDS_MAX')]) {
    const z = heights(n);
    const top = Math.max(...z);
    assert.ok(top <= depth + 1e-9, `${n} cards: the highest at ${top} is inside the depth`);
    assert.ok(top + 2 * gap <= cast + 1e-9, `${n} cards lie under the mark, with room for the card in hand's two gaps`);
    assert.ok(cast < rim, 'and the mark under the rim');
    const step = z[1] - z[0] || z[0];
    assert.ok(step > 0, `${n} cards: each a plane above the one under it`);
    if (n <= 60) assert.ok(near(step, gap), `${n} cards lie a quarter pixel apart, as they always did`);
    else assert.ok(near(step, depth / n), `${n} cards share the depth, closer together`);
  }
  /* What lies on a card lies under the next card up, however close they come:
     at the ceiling, every card a zone of its own. */
  const closest = app.evaluate('tableCardGapFor(1 + 3 * TABLE_DECK_CARDS_MAX + 2)');
  assert.ok(app.evaluate('TABLE_FACE_Z') > 0 && app.evaluate('TABLE_FACE_Z') < closest / 2,
    'a card’s count is lifted off its picture by less than half the closest gap');
});

test('the landing mark is drawn above every pile and under the card in hand', () => {
  const gap = app.evaluate('TABLE_CARD_GAP'), top = app.evaluate('TABLE_CAST_Z');
  const rim = app.evaluate('TABLE_RIM_Z');
  assert.ok(top > app.evaluate('TABLE_DEPTH'), 'above the highest a card lying on the mat can be');
  assert.ok(top < rim, 'and under the side edges’ tabs, whose labels open over the mat');
  const drawZ = (rest, lift) => app.sandbox.tableCastDrawZ(rest, lift);
  assert.strictEqual(drawZ(15, 96), top, 'held well up, the mark is drawn at its own height');
  assert.strictEqual(drawZ(2, 96), top, 'however low the card lay');
  assert.ok(near(drawZ(2, 4), 2 + 4 - 2 * gap), 'while the card is still rising, under it by two gaps');
  assert.strictEqual(drawZ(2, 0), 2, 'never under the card’s own height: with cards still it lies on its mark');
});

test('drawn higher, the landing mark does not move on the screen by a hair', () => {
  const box = { w: 110, h: 110 * 88 / 63 };
  const rest = 3, turn = 7;
  const spot = { x: 0.31, y: 0.72 };
  const pose = app.copy(app.sandbox.tableCastPose(spot, turn, rest));
  const drawZ = app.evaluate('TABLE_CAST_Z');
  const num = String.raw`(-?[\d.]+)`;
  const shape = new RegExp(String.raw`^translate3d\(${num}px, ${num}px, ${num}px\) scale3d\(${num}, ${num}, ${num}\) ` +
    String.raw`translate3d\(${num}px, ${num}px, ${num}px\) (translate3d.*)$`);
  for (const v of VIEWS) {
    const m = matrix(v);
    const eye = app.copy(app.sandbox.tableEye(m));
    /* The eye is the one point the projection sends nowhere. */
    for (const row of [0, 4, 12]) {
      const r = m[row] * eye.u + m[row + 1] * eye.v + m[row + 2] * eye.z + m[row + 3];
      assert.ok(Math.abs(r) < 1e-6 * Math.max(1, Math.abs(m[row + 3])), `row ${row} vanishes at the eye: ${r}`);
    }
    assert.ok(eye.z > drawZ, 'above the table, where a seat’s eye is');
    const t = app.evaluate(`tableCastTransform(${JSON.stringify(m)}, ${JSON.stringify(pose)}, ${JSON.stringify(box)}, ${JSON.stringify(MAT)}, ${drawZ})`);
    const got = shape.exec(t);
    assert.ok(got, `a scale about the eye, round the card’s own pose: ${t}`);
    const [ox, oy, oz, s] = got.slice(1, 5).map(Number);
    assert.strictEqual(got[10], app.evaluate(`tableLieTransform(${JSON.stringify(pose)}, ${JSON.stringify(box)}, ${JSON.stringify(MAT)}, ${rest})`));
    assert.ok(near(ox, eye.u - box.w / 2, 1e-3) && near(oy, eye.v - box.h / 2, 1e-3) && near(oz, eye.z, 1e-3),
      'about the eye, put in the frame of the element’s own centre');
    /* Each corner of the card at rest, slid along its ray from the eye by
       the transform's factor: drawn at drawZ, on the very same pixel. */
    const c = Math.cos(turn * Math.PI / 180), sn = Math.sin(turn * Math.PI / 180);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const dx = a * box.w / 2, dy = b * box.h / 2;
      const P = { u: spot.x * MAT.width + dx * c - dy * sn, v: spot.y * MAT.height + dx * sn + dy * c, z: rest };
      const Q = { u: eye.u + s * (P.u - eye.u), v: eye.v + s * (P.v - eye.v), z: eye.z + s * (P.z - eye.z) };
      assert.ok(near(Q.z, drawZ, 1e-3), `drawn at the mark’s height: ${Q.z}`);
      const p = project(m, P.u, P.v, P.z), q = project(m, Q.u, Q.v, Q.z);
      assert.ok(near(p.x, q.x, 0.01) && near(p.y, q.y, 0.01), `the same pixel: ${JSON.stringify([p, q])}`);
    }
  }
  /* No perspective, no eye: drawn at its own height, as it was. */
  const flat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  assert.strictEqual(app.sandbox.tableEye(flat), null);
  assert.strictEqual(app.evaluate(`tableCastTransform(${JSON.stringify(flat)}, ${JSON.stringify(pose)}, ${JSON.stringify(box)}, ${JSON.stringify(MAT)}, ${drawZ})`),
    app.evaluate(`tableLieTransform(${JSON.stringify(pose)}, ${JSON.stringify(box)}, ${JSON.stringify(MAT)}, ${rest})`));
});

test('a card in hand lands on the mat, and lets go onto the spot its mark lay on', () => {
  const W = MAT.width, H = MAT.height;
  const spot = (u, v) => app.copy(app.sandbox.tableDropSpot({ u, v }, { u: 0, v: 0 }, W, H));
  assert.deepStrictEqual(spot(-200, 300), { x: 0, y: 300 / H }, 'its centre is kept on the mat');
  assert.deepStrictEqual(spot(400, -90), { x: 400 / W, y: 0 }, 'over the far rim too: it lands at the mat’s edge');
  assert.deepStrictEqual(spot(W + 50, H + 50), { x: 1, y: 1 });
  assert.strictEqual(app.sandbox.tableDropSpot(null, { u: 0, v: 0 }, W, H), null, 'a pointer off the plane lands nowhere new');
  assert.strictEqual(app.sandbox.tableDropSpot({ u: 1, v: 1 }, { u: 0, v: 0 }, 0, H), null);
  const js = read('public/js/tablemode.js');
  assert.match(js, /if \(hold\.land\) \{ card\.x = hold\.land\.x; card\.y = hold\.land\.y; \}/,
    'let go, the card is put down on the spot the mark was laid on');
  assert.match(js, /tableCastWrite\(hold\.dragging && !hold\.over \? tableZoneCast\(hold\) : null\)/,
    'the mark shows only while the card is carried, and not over the bin');
  assert.match(js, /function tableZoneCast\(hold\) \{\s*if \(!tableZonesActive\(\) \|\| hold\.card\.head \|\| !hold\.card\.zoneSpot\) return hold;/,
    'and is the card’s own wherever the deck is laid in piles');
  const css = read('public/css/table.css');
  assert.match(css, /\.table-cast\s*\{[^}]*outline:\s*2px solid var\(--table-land-ink\)/, 'ringed in the theme’s ink');
  assert.match(css, /\.table-cast\s*\{[^}]*border:\s*1px solid var\(--table-land-halo\)/, 'with the page’s colour inside the ring');
  assert.match(css, /\.table-cast\s*\{[^}]*background:\s*var\(--table-land-fill\)/, 'and a faint wash of the ink');
  assert.match(css, /\.table-cast\s*\{[^}]*pointer-events:\s*none/, 'taking no pointer');
  assert.doesNotMatch(css.match(/\.table-cast\s*\{[^}]*\}/)[0], /transition/, 'and never easing behind the card');
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

// ── The Deck Builder's zones ──────────────────────────────────────────────

const ZONE = {
  pad:  app.evaluate('TABLE_ZONE_PAD'),
  head: app.evaluate('TABLE_ZONE_HEAD'),
  gap:  app.evaluate('TABLE_ZONE_GAP'),
  step: app.evaluate('TABLE_ZONE_PILE_STEP'),
  title: app.evaluate('TABLE_ZONE_TITLE'),
};
const zoneFit = (n, W, H, w, h) => app.call('tableZoneFit', n, W, H, w, h);
const zoneMin = (w, h) => app.call('tableZoneMinSize', w, h);

/* Every card of a fit inside its zone — within the zone's rect, below its
   label's band — and every card placed. */
function assertFitInside(fit, n, W, H, w, h, what) {
  assert.strictEqual(fit.spots.length, n, `${what}: every card is placed`);
  for (const [i, s] of fit.spots.entries()) {
    assert.ok(s.x - w / 2 >= -1e-6 && s.x + w / 2 <= W + 1e-6, `${what}: card ${i} lies across the zone's side, ${JSON.stringify(s)}`);
    assert.ok(s.y - h / 2 >= ZONE.head - 1e-6 && s.y + h / 2 <= H + 1e-6, `${what}: card ${i} lies past the zone's top band or foot, ${JSON.stringify(s)}`);
  }
}

test('a zone lays its cards as a grid of whole cards when they fit, in the builder’s order', () => {
  const w = 100, h = 140;
  const fit = zoneFit(5, 2 * ZONE.pad + 3 * w + 2 * 6, ZONE.head + 2 * h + 6 + ZONE.pad, w, h);
  assert.strictEqual(fit.mode, 'grid');
  assert.strictEqual(fit.visible, 1);
  assertFitInside(fit, 5, 2 * ZONE.pad + 3 * w + 12, ZONE.head + 2 * h + 6 + ZONE.pad, w, h, 'grid');
  /* Three across, then two below them, reading order. */
  const rows = [...new Set(fit.spots.map(s => s.y))];
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(fit.spots.map(s => rows.indexOf(s.y)), [0, 0, 0, 1, 1]);
  for (let i = 1; i < 3; i++) assert.ok(fit.spots[i].x - fit.spots[i - 1].x >= w, 'side by side, not over each other');
  assert.ok(fit.spots[3].y - fit.spots[0].y >= h, 'the second row clear of the first');
  /* And one card at its smallest is one whole card. */
  const min = zoneMin(w, h);
  const one = zoneFit(1, min.width, min.height, w, h);
  assert.strictEqual(one.mode, 'grid');
  assertFitInside(one, 1, min.width, min.height, w, h, 'one card');
});

test('a zone too small for a grid closes its cards up, down to a third across and the name band down', () => {
  const w = 100, h = 140;
  for (const [n, W, H] of [[8, 330, 330], [6, 2 * ZONE.pad + 2.2 * w, 400], [12, 400, ZONE.head + h + 0.5 * h + ZONE.pad], [20, 500, 520]]) {
    const fit = zoneFit(n, W, H, w, h);
    assert.strictEqual(fit.mode, 'overlap', `${n} in ${W}×${H}`);
    assert.ok(fit.visible < 1 && fit.visible > 0);
    assertFitInside(fit, n, W, H, w, h, `${n} in ${W}×${H}`);
    const xs = [...new Set(fit.spots.map(s => s.x.toFixed(6)))].map(Number).sort((a, b) => a - b);
    const ys = [...new Set(fit.spots.map(s => s.y.toFixed(6)))].map(Number).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= w / 3 - 1e-6, `a third of every card shows across: ${xs}`);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= ZONE.title * h - 1e-6, `every card's name shows: ${ys}`);
    /* Each later card lies right of or below the one before: the top-left
       corner of every card, its name, is what the cards over it leave. */
    for (let i = 1; i < n; i++) {
      const a = fit.spots[i - 1], b = fit.spots[i];
      assert.ok(b.y > a.y + 1e-9 || (b.y === a.y && b.x > a.x), `card ${i} follows card ${i - 1}`);
    }
  }
});

test('a zone too small even for that piles its cards, a few to a spot, two pixels a card', () => {
  const w = 100, h = 140;
  const min = zoneMin(w, h);
  /* The last flag: whether the zone has room for more than one pile. */
  for (const [n, W, H, many] of [[40, 300, 300, true], [60, min.width + 40, min.height + 30, false],
    [9, min.width, min.height, false], [25, min.width + 10, min.height + 200, true]]) {
    const fit = zoneFit(n, W, H, w, h);
    assert.strictEqual(fit.mode, 'stack', `${n} in ${W}×${H}`);
    assertFitInside(fit, n, W, H, w, h, `${n} in ${W}×${H}`);
    /* The piles: runs of cards stepping down and right by the pile step from
       the first card of each — sized as evenly as the count goes. */
    const piles = [];
    for (const s of fit.spots) {
      const last = piles[piles.length - 1];
      const prev = last && last[last.length - 1];
      if (prev && near(s.x - prev.x, s.y - prev.y) && s.x - prev.x > 0 && s.x - prev.x <= ZONE.step + 1e-9) last.push(s);
      else piles.push([s]);
    }
    const sizes = piles.map(p => p.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `spread evenly: ${sizes}`);
    if (many) assert.ok(piles.length > 1, `${n} cards share more than one spot where there is room: ${sizes}`);
    else assert.strictEqual(piles.length, 1, `${n} cards in a zone with room for one pile: ${sizes}`);
    for (const p of piles) for (let j = 1; j < p.length; j++) {
      assert.ok(near(p[j].x - p[j - 1].x, p[0 + 1].x - p[0].x), 'one step through a pile');
    }
    const first = piles.find(p => p.length > 1);
    if (first && many) assert.ok(near(first[1].x - first[0].x, ZONE.step), `a pile steps ${ZONE.step}px a card`);
  }
});

test('however a zone is sized, its cards all lie inside it, and the fit only tightens as it shrinks', () => {
  const w = 111, h = 155;
  const min = zoneMin(w, h);
  const order = { grid: 0, overlap: 1, stack: 2 };
  for (const n of [1, 2, 3, 7, 16, 33, 60]) {
    let was = -1;
    for (let W = 1100; W >= min.width; W -= 37) {
      const H = Math.max(min.height, W * 0.6);
      const fit = zoneFit(n, W, H, w, h);
      assertFitInside(fit, n, W, H, w, h, `${n} in ${W}×${H}`);
      assert.ok(order[fit.mode] >= was, `${n} cards: shrinking to ${W} loosened the fit to ${fit.mode}`);
      was = order[fit.mode];
    }
  }
  assert.deepStrictEqual(zoneFit(0, 300, 300, w, h).spots, [], 'an empty zone lays nothing');
});

/* The real deck's shape: sixteen categories, a commander and a partner. */
const ZONE_DECK = [['Artifacts', 1], ['Clones', 1], ['Counters', 4], ['Creatures', 5], ['Draw', 12], ['Evasion', 11],
  ['Finisher', 1], ['Lands', 51], ['Protection', 1], ['Pump', 2], ['Ramp', 8], ['Recursion', 5], ['Removal', 8],
  ['Theft', 2], ['Tokens', 8], ['Tutor', 2]].map(([name, count]) => ({ name, count }));

const zoneFull = (n, w, h, maxW, maxH, aspect) => app.call('tableZoneFullSize', n, w, h, maxW, maxH, aspect);

/* The shape a first layout chose, and how far along each zone is: the one
   of TABLE_ZONE_ASPECTS, squarest first, for which every zone lies on the
   line from its smallest size to its full size in that shape — the same
   share of the way across as down, which shrinking alike and then growing
   along that line both keep. `shares` is each zone's share (1 for a zone
   whose smallest is its full size), `share` the least of them — what they
   were all shrunk to, unless every zone grew. Null when there is none. */
function zoneShape(rects, counts, W, H, w, h) {
  const min = zoneMin(w, h);
  for (const aspect of app.evaluate('TABLE_ZONE_ASPECTS')) {
    const shares = rects.map((r, i) => {
      const f = zoneFull(counts[i], w, h, W - 2 * ZONE.gap, H - 2 * ZONE.gap, aspect);
      const mine = [];
      if (f.width - min.width > 1e-6) mine.push((r.width - min.width) / (f.width - min.width));
      else if (!near(r.width, min.width)) mine.push(NaN);
      if (f.height - min.height > 1e-6) mine.push((r.height - min.height) / (f.height - min.height));
      else if (!near(r.height, min.height)) mine.push(NaN);
      if (!mine.every(s => near(s, mine[0], 1e-6) && s >= -1e-9 && s <= 1 + 1e-9)) return NaN;
      return mine.length ? mine[0] : 1;
    });
    if (shares.every(s => !Number.isNaN(s))) return { aspect, shares, share: Math.min(...shares) };
  }
  return null;
}

/* A deck's zones in its order along shelves: each next zone to the right of
   the one before it, or on a shelf further down. */
function assertShelfOrder(rects, what) {
  for (let i = 0; i + 1 < rects.length; i++) {
    const a = rects[i], b = rects[i + 1];
    assert.ok(b.left >= a.left + a.width + ZONE.gap - 1e-6 || b.top > a.top + 1e-6, `${what}: ${b.name} laid before ${a.name}`);
  }
}

test('a zone’s full size is the smallest grid, nearest square, that shows every one of its cards', () => {
  const w = 100, h = 140, gap = app.evaluate('TABLE_ZONE_CARD_GAP');
  const min = zoneMin(w, h);
  assert.deepStrictEqual(zoneFull(0, w, h), min, 'no cards: the smallest a zone is');
  assert.deepStrictEqual(zoneFull(1, w, h), min, 'one card: the same');
  const skew = s => Math.abs(Math.log(s.width / s.height));
  for (let n = 1; n <= 60; n++) {
    const size = zoneFull(n, w, h);
    const fit = zoneFit(n, size.width, size.height, w, h);
    assert.strictEqual(fit.mode, 'grid', `${n} cards in their full size lie as a grid`);
    assertFitInside(fit, n, size.width, size.height, w, h, `${n} at full size`);
    /* Every way to lay them: c columns, the rows they need — the fewest
       columns that give those rows. */
    const ways = [];
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      if (c > 1 && Math.ceil(n / (c - 1)) === r) continue;
      ways.push({ r, width: 2 * ZONE.pad + c * w + (c - 1) * gap, height: ZONE.head + ZONE.pad + r * h + (r - 1) * gap });
    }
    const mine = ways.find(way => near(way.width, size.width) && near(way.height, size.height));
    assert.ok(mine, `${n} cards: ${JSON.stringify(size)} is one of the ways to lay them`);
    for (const way of ways) {
      assert.ok(skew(size) <= skew(way) + 1e-9, `${n} cards: ${way.width}×${way.height} is nearer square than ${size.width}×${size.height}`);
      if (Math.abs(skew(size) - skew(way)) <= 1e-9) assert.ok(mine.r <= way.r, `${n} cards: of two as near square, the fewer rows`);
    }
  }
  /* Larger with its cards. */
  const area = n => { const s = zoneFull(n, w, h); return s.width * s.height; };
  for (const [a, b] of [[1, 4], [4, 9], [9, 30], [30, 60]]) assert.ok(area(a) < area(b), `${b} cards are given more room than ${a}`);
  /* Held to the room given, and never below one card. */
  assert.deepStrictEqual(zoneFull(60, w, h, 500, 400), { width: 500, height: 400 });
  assert.deepStrictEqual(zoneFull(60, w, h, 10, 10), min);
  assert.deepStrictEqual(zoneFull(2, w, h, 5000, 5000), zoneFull(2, w, h), 'room to spare changes nothing');

  /* Aimed at another shape: the way to lay them nearest it by the same
     measure, the fewer rows of two as near; square unless asked. */
  for (let n = 1; n <= 60; n++) {
    assert.deepStrictEqual(zoneFull(n, w, h, Infinity, Infinity, 1), zoneFull(n, w, h), `${n} cards: an aspect of 1 is the square`);
    for (const aspect of [1.25, 1.5, 2, 2.5, 3]) {
      const size = zoneFull(n, w, h, Infinity, Infinity, aspect);
      const off = s => Math.abs(Math.log(s.width / s.height) - Math.log(aspect));
      const rows = s => Math.round((s.height - ZONE.head - ZONE.pad + gap) / (h + gap));
      for (let c = 1; c <= n; c++) {
        const r = Math.ceil(n / c);
        if (c > 1 && Math.ceil(n / (c - 1)) === r) continue;
        const way = { width: 2 * ZONE.pad + c * w + (c - 1) * gap, height: ZONE.head + ZONE.pad + r * h + (r - 1) * gap };
        assert.ok(off(size) <= off(way) + 1e-9, `${n} cards at ${aspect}: ${way.width}×${way.height} is nearer than ${size.width}×${size.height}`);
        if (Math.abs(off(size) - off(way)) <= 1e-9) assert.ok(rows(size) <= r, `${n} cards at ${aspect}: of two as near, the fewer rows`);
      }
    }
  }
  const wide = zoneFull(24, w, h, Infinity, Infinity, 2);
  assert.ok(wide.width > wide.height && wide.width > zoneFull(24, w, h).width, 'twenty-four cards made wider when asked');
});

test('the first time, each zone is sized for its cards and packed in order: apart, on the mat, and clear of the commander', () => {
  const cases = [
    { W: 1114, H: 830, zones: ZONE_DECK, heads: 2 },
    { W: 1114, H: 830, zones: ZONE_DECK.slice(0, 3), heads: 1, full: true },
    { W: 1500, H: 1000, zones: ZONE_DECK.slice(0, 9), heads: 0 },
    { W: 1500, H: 1000, zones: ZONE_DECK.slice(0, 4), heads: 0, full: true },
    { W: 760, H: 560, zones: ZONE_DECK.slice(0, 5), heads: 1 },
    { W: 1114, H: 830, zones: [{ name: 'Lands', count: 38 }], heads: 1 },
  ];
  for (const { W, H, zones, heads, full } of cases) {
    const w = app.evaluate(`tableCardWidth(${W})`), h = w * 88 / 63;
    const band = app.call('tableHeadSpots', heads, W, H, w, h);
    const keep = heads ? app.call('tableZoneHeadRect', heads, W, H, w, h) : null;
    const rects = app.call('tableZoneAutoLayout', zones, W, H, w, h, keep);
    const what = `${zones.length} zones on ${W}×${H}`;
    assert.deepStrictEqual(rects.map(r => r.name), zones.map(z => z.name), `${what}: one zone per category, in order`);
    assert.deepStrictEqual(app.call('tableZoneAutoLayout', zones, W, H, w, h, keep), rects, `${what}: the same every time`);
    const min = zoneMin(w, h);
    for (const r of rects) {
      assert.ok(r.left >= 0 && r.top >= 0 && r.left + r.width <= W + 1e-6 && r.top + r.height <= H + 1e-6, `${what}: ${r.name} inside the mat`);
      assert.ok(r.width >= min.width - 1e-6 && r.height >= min.height - 1e-6, `${what}: ${r.name} no smaller than a card`);
      for (const s of band.spots) {
        const cw = w * 1.1, ch = h * 1.1;
        const head = { left: s.x * W - cw / 2, top: s.y * H - ch / 2, width: cw, height: ch };
        assert.ok(!app.sandbox.tableZoneOverlap(head, r), `${what}: ${r.name} over the commander`);
      }
      if (keep) assert.ok(!app.sandbox.tableZoneOverlap(keep, r), `${what}: ${r.name} over the commander's box`);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      assert.ok(!app.sandbox.tableZoneOverlap(rects[i], rects[j], ZONE.gap - 1e-6), `${what}: ${rects[i].name} not a gap from ${rects[j].name}`);
    }
    /* Laid from the top left: the deck's first zone in the mat's corner,
       unless the commander's box is in the way of it there. */
    const corner = { ...rects[0], left: ZONE.gap, top: ZONE.gap };
    if (!keep || !app.sandbox.tableZoneOverlap(corner, keep, ZONE.gap)) {
      assert.ok(near(rects[0].left, ZONE.gap) && near(rects[0].top, ZONE.gap), `${what}: ${rects[0].name} in the top-left corner`);
    }
    assertShelfOrder(rects, what);
    /* Every zone the one shape, each on the line from its smallest to its
       full size in that shape: shrunk alike, and grown along that line. */
    const shape = zoneShape(rects, zones.map(z => z.count), W, H, w, h);
    assert.ok(shape, `${what}: one shape, each zone on its own line`);
    if (full) {
      assert.ok(near(shape.share, 1) && shape.aspect === 1, `${what}: room for every zone at its full, squarest size`);
      rects.forEach((r, i) => assert.strictEqual(zoneFit(zones[i].count, r.width, r.height, w, h).mode, 'grid', `${what}: ${r.name} shows every card`));
    }
  }
  /* More of the deck than a laptop's mat holds at full size: shrunk, and
     its larger categories still the larger zones. */
  const W = 1114, H = 830, w = app.evaluate(`tableCardWidth(${W})`), h = w * 88 / 63;
  const crowd = app.call('tableZoneAutoLayout', ZONE_DECK.slice(0, 9), W, H, w, h, app.call('tableZoneHeadRect', 1, W, H, w, h));
  const lands = crowd.find(r => r.name === 'Lands'), one = crowd.find(r => r.name === 'Artifacts');
  assert.ok(lands.width * lands.height > one.width * one.height, 'fifty-one lands are given more room than one artifact');
  assert.notStrictEqual(zoneFit(51, lands.width, lands.height, w, h).mode, 'grid', 'and close up in it');
});

/* What a first layout packed before it grew, and what it grew each zone
   towards: tableZoneGrow stood in for, for one call, by one that keeps
   what it is handed. */
function zonePacked(zones, W, H, w, h, keep) {
  const grow = app.sandbox.tableZoneGrow;
  let handed = null;
  app.sandbox.tableZoneGrow = (rects, fulls, mins) => { handed = app.copy({ rects, fulls, mins }); return rects; };
  try { app.sandbox.tableZoneAutoLayout(zones, W, H, w, h, keep); } finally { app.sandbox.tableZoneGrow = grow; }
  return handed;
}

/* Whether rects lie a gap apart, a gap inside the mat and a gap clear of
   the commander's box. */
function assertZonesApart(rects, W, H, keep, what) {
  for (const r of rects) {
    assert.ok(r.left >= ZONE.gap - 1e-6 && r.top >= ZONE.gap - 1e-6 && r.left + r.width <= W - ZONE.gap + 1e-6
      && r.top + r.height <= H - ZONE.gap + 1e-6, `${what}: ${r.name} inside the mat's margin`);
    if (keep) assert.ok(!app.sandbox.tableZoneOverlap(keep, r, ZONE.gap - 1e-6), `${what}: ${r.name} a gap clear of the commander's box`);
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    assert.ok(!app.sandbox.tableZoneOverlap(rects[i], rects[j], ZONE.gap - 1e-6), `${what}: ${rects[i].name} not a gap from ${rects[j].name}`);
  }
}

test('a zone grows towards its full size into the room round it: never over another, never smaller, never past full', () => {
  const grow = (rects, fulls, mins, W, H, keep = null) => app.call('tableZoneGrow', rects, fulls, mins, W, H, keep);
  /* Alone on a mat with room: all the way, its corner where it was. */
  const lone = grow([{ name: 'A', left: 40, top: 30, width: 150, height: 200 }], [{ width: 400, height: 300 }], [{ width: 150, height: 200 }], 1000, 800);
  assert.deepStrictEqual(lone, [{ name: 'A', left: 40, top: 30, width: 400, height: 300 }]);
  /* Already full, or handed a full size smaller than it is: left be. */
  const same = [{ name: 'A', left: 12, top: 12, width: 200, height: 200 }];
  assert.deepStrictEqual(grow(same, [{ width: 200, height: 200 }], [{ width: 200, height: 200 }], 1000, 800), same);
  assert.deepStrictEqual(grow(same, [{ width: 100, height: 100 }], [{ width: 200, height: 200 }], 1000, 800), same);
  /* Hemmed in on every side: not grown, and not shrunk. */
  const hemmed = [
    { name: 'A', left: 12, top: 12, width: 100, height: 100 },
    { name: 'B', left: 124, top: 12, width: 100, height: 100 },
    { name: 'C', left: 12, top: 124, width: 100, height: 100 },
  ];
  assert.deepStrictEqual(grow(hemmed, hemmed.map(() => ({ width: 300, height: 300 })), hemmed, 236, 236), hemmed, 'no room, so nothing moves');

  /* Shelves of zones of every size, some round a commander's box: each
     grown zone a gap clear of everything, no smaller than it was laid,
     no larger than its full size, on the line between the two, never
     moved down, and still in the deck's order along the shelves. */
  let seed = 3, grew = 0, whole = 0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 40; k++) {
    const W = 700 + Math.floor(rnd() * 900), H = 500 + Math.floor(rnd() * 500);
    const keep = k % 2 ? { left: W / 2 - 60, top: 30, width: 120, height: 170 } : null;
    const below = keep ? keep.top + keep.height + ZONE.gap : 0;
    const rects = [], fulls = [];
    let x = ZONE.gap, y = ZONE.gap, shelf = 0;
    for (let i = 0; i < 12; i++) {
      const width = 120 + Math.floor(rnd() * 200), height = 180 + Math.floor(rnd() * 150);
      let at = { name: `Z${i}`, left: x, top: y, width, height };
      if (keep && app.sandbox.tableZoneOverlap(at, keep, ZONE.gap)) at.left = keep.left + keep.width + ZONE.gap;
      if (at.left + width > W - ZONE.gap) {
        y = Math.max(y + shelf + ZONE.gap, below);
        shelf = 0;
        at = { ...at, left: ZONE.gap, top: y };
      }
      if (y + height > H - ZONE.gap) break;
      rects.push(at);
      fulls.push({ width: width * (1 + rnd()), height: height * (1 + rnd()) });
      x = at.left + width + ZONE.gap;
      shelf = Math.max(shelf, height);
    }
    const what = `case ${k}, ${rects.length} zones on ${W}×${H}`;
    assertZonesApart(rects, W, H, keep, `${what}, as laid`);
    const grown = grow(rects, fulls, rects, W, H, keep);
    assert.deepStrictEqual(grow(rects, fulls, rects, W, H, keep), grown, `${what}: the same every time`);
    assertZonesApart(grown, W, H, keep, what);
    assertShelfOrder(rects, `${what}, as laid`);
    assertShelfOrder(grown, what);
    grown.forEach((r, i) => {
      const p = rects[i], f = fulls[i];
      assert.ok(r.width >= p.width - 1e-9 && r.height >= p.height - 1e-9, `${what}: ${r.name} shrank`);
      assert.ok(r.width <= f.width + 1e-6 && r.height <= f.height + 1e-6, `${what}: ${r.name} past its full size`);
      assert.ok(near((r.width - p.width) / (f.width - p.width), (r.height - p.height) / (f.height - p.height), 1e-6), `${what}: ${r.name} off its line`);
      assert.ok(r.top <= p.top + 1e-9, `${what}: ${r.name} moved down`);
      if (r.width > p.width + 1) grew++;
      if (near(r.width, f.width)) whole++;
    });
  }
  assert.ok(grew > 40 && whole > 10, `zones grew (${grew}) and some to full size (${whole})`);
});

/* The deck the table was looked at with on a 1440×900 window — a mat of
   1102×827, cards 110×154, a commander, and categories of twenty-four,
   ten, eight, six, three and one. Their full sizes add up to more than the
   mat in every shape, so they are shrunk alike onto shelves in the deck's
   order; the ten-card zone, beside the commander, then grows down into
   the height the twenty-four gives the first shelf. */
test('zones too large for the mat are shrunk alike onto shelves in the deck’s order, then each grows into the room round it', () => {
  const W = 1102, H = 827, w = 110, h = 154;
  const six = [24, 10, 8, 6, 3, 1];
  const zones = six.map((count, i) => ({ name: `Cat ${i}`, count }));
  const keep = app.call('tableZoneHeadRect', 1, W, H, w, h);
  for (const aspect of app.evaluate('TABLE_ZONE_ASPECTS')) {
    const area = six.reduce((sum, n) => { const f = zoneFull(n, w, h, W - 2 * ZONE.gap, H - 2 * ZONE.gap, aspect); return sum + f.width * f.height; }, 0);
    assert.ok(area > (W - 2 * ZONE.gap) * (H - 2 * ZONE.gap), `at ${aspect}, ${area} would fit the mat whole`);
  }
  const packed = zonePacked(zones, W, H, w, h, keep);
  assert.ok(packed, 'shrunk, and handed on to grow');
  assertShelfOrder(packed.rects, 'as packed');
  assertZonesApart(packed.rects, W, H, keep, 'as packed');
  const before = zoneShape(packed.rects, six, W, H, w, h);
  /* All shrunk alike — but the one-card zone, whose smallest is its full size. */
  assert.ok(before && before.shares.every((s, i) => six[i] === 1 || near(s, before.share, 1e-6)), `packed all shrunk alike: ${before?.shares}`);
  assert.ok(before.share > 0.55, `shrunk no further than ${before.share}`);

  const rects = app.call('tableZoneAutoLayout', zones, W, H, w, h, keep);
  assert.deepStrictEqual(app.call('tableZoneAutoLayout', zones, W, H, w, h, keep), rects, 'the same every time');
  assertShelfOrder(rects, 'grown');
  assertZonesApart(rects, W, H, keep, 'grown');
  const after = zoneShape(rects, six, W, H, w, h);
  assert.ok(after && after.aspect === before.aspect, 'grown in the shape it was packed in');
  rects.forEach((r, i) => {
    assert.ok(after.shares[i] >= before.shares[i] - 1e-9, `${r.name} smaller than it was packed`);
    assert.ok(r.width >= packed.rects[i].width - 1e-9 && r.height >= packed.rects[i].height - 1e-9, `${r.name} shrank`);
  });
  const cover = list => list.reduce((sum, r) => sum + r.width * r.height, 0);
  assert.ok(cover(rects) > cover(packed.rects) * 1.1, `the grown zones cover more of the mat: ${cover(packed.rects)} → ${cover(rects)}`);
  /* The second shelf's zones grow down to the mat's foot, the one-card zone
     at its end slid right to give them the room across: most of the mat
     covered, and each of them at least 0.4 of the way from its packed size
     to its full size, or at it. */
  const usable = (W - 2 * ZONE.gap) * (H - 2 * ZONE.gap);
  assert.ok(cover(rects) / usable >= 0.84, `${(cover(rects) / usable).toFixed(3)} of the mat covered`);
  rects.forEach((r, i) => {
    const p = packed.rects[i], f = packed.fulls[i];
    if (!(p.top > packed.rects[0].top + 1e-6)) return;
    const whole = near(r.width, f.width) && near(r.height, f.height);
    const t = f.width - p.width > 1e-6 ? (r.width - p.width) / (f.width - p.width) : (r.height - p.height) / (f.height - p.height);
    assert.ok(whole || t >= 0.4, `${r.name} on the second shelf grew only ${t}`);
  });
  assert.ok(after.shares[1] > 0.85, `the ten-card zone grows into its shelf: ${before.shares[1]} → ${after.shares[1]}`);
});

test('zones are made wider before they are made smaller', () => {
  /* Twelve cards and five small categories round a commander on a laptop's
     mat: square, the twelve-card zone makes the first shelf so tall that
     the next runs off the mat; wider, all six lie whole. */
  const W = 1114, H = 830, w = app.evaluate(`tableCardWidth(${W})`), h = w * 88 / 63;
  const counts = [12, 6, 4, 2, 1, 1];
  const keep = app.call('tableZoneHeadRect', 1, W, H, w, h);
  const rects = app.call('tableZoneAutoLayout', counts.map((count, i) => ({ name: `Cat ${i}`, count })), W, H, w, h, keep);
  assertShelfOrder(rects, 'wider');
  assertZonesApart(rects, W, H, keep, 'wider');
  const shape = zoneShape(rects, counts, W, H, w, h);
  assert.ok(shape && shape.aspect > 1 && near(shape.share, 1), `whole and wider, not ${shape?.share} at ${shape?.aspect}`);
  rects.forEach((r, i) => assert.strictEqual(zoneFit(counts[i], r.width, r.height, w, h).mode, 'grid', `${r.name} shows every card`));
});

test('more zones than the mat holds even at their smallest are still laid on it', () => {
  const W = 760, H = 560, w = app.evaluate(`tableCardWidth(${W})`), h = w * 88 / 63;
  const zones = Array.from({ length: 40 }, (_, i) => ({ name: `Cat ${i}`, count: 3 }));
  const rects = app.call('tableZoneAutoLayout', zones, W, H, w, h, app.call('tableZoneHeadRect', 1, W, H, w, h));
  assert.strictEqual(rects.length, 40);
  const min = zoneMin(w, h);
  for (const r of rects) {
    assert.ok(r.left >= 0 && r.top >= 0 && r.left + r.width <= W + 1e-6 && r.top + r.height <= H + 1e-6, `${r.name} inside the mat`);
    assert.ok(near(r.width, min.width) && near(r.height, min.height), `${r.name} at its smallest`);
  }
  assert.deepStrictEqual(app.call('tableZoneAutoLayout', [], W, H, w, h, null), []);
  assert.deepStrictEqual(app.call('tableZoneAutoLayout', zones, 0, H, w, h, null), []);
});

test('a zone’s size button shrinks one showing every card to one card, and grows any other to show them all', () => {
  const W = 1114, H = 830, w = app.evaluate(`tableCardWidth(${W})`), h = w * 88 / 63;
  const toggle = (zone, mode, n) => app.call('tableZoneToggleRect', zone, mode, n, W, H, w, h);
  const grown = zoneFull(12, w, h, W - 2 * ZONE.gap, H - 2 * ZONE.gap);
  const small = app.call('tableZoneMinFor', W, w, h);

  /* Closed up or piled: grown, its corner where it was. */
  for (const mode of ['overlap', 'stack']) {
    assert.deepStrictEqual(toggle({ left: 100, top: 300 }, mode, 12), { left: 100, top: 300, ...grown }, mode);
  }
  assert.strictEqual(zoneFit(12, grown.width, grown.height, w, h).mode, 'grid', 'grown, it shows every card');
  /* Showing every card: shrunk to one card's size, its corner where it was. */
  assert.deepStrictEqual(toggle({ left: 100, top: 300 }, 'grid', 12), { left: 100, top: 300, ...small });
  assert.notStrictEqual(zoneFit(12, small.width, small.height, w, h).mode, 'grid', 'shrunk, its cards pile');
  /* Near the mat's far corner, moved back only as far as it must be. */
  const edge = toggle({ left: 1000, top: 700 }, 'stack', 12);
  assert.ok(near(edge.left, W - grown.width) && near(edge.top, H - grown.height), JSON.stringify(edge));
  const room = toggle({ left: 1000, top: 20 }, 'stack', 12);
  assert.ok(near(room.left, W - grown.width) && near(room.top, 20), 'a direction with room is left as it is');
  /* More cards than the mat shows whole: all the mat has, a gap all round, and still on it. */
  const huge = toggle({ left: 400, top: 400 }, 'stack', 300);
  assert.ok(near(huge.width, W - 2 * ZONE.gap) && near(huge.height, H - 2 * ZONE.gap), JSON.stringify(huge));
  assert.ok(huge.left >= 0 && huge.top >= 0 && huge.left + huge.width <= W + 1e-6 && huge.top + huge.height <= H + 1e-6);
  /* And an empty zone is always the smallest. */
  assert.deepStrictEqual(toggle({ left: 50, top: 60 }, 'grid', 0), { left: 50, top: 60, ...small });
});

test('the size button lies in each editable zone’s label band, and a press on it is never a drag', () => {
  const js = read('public/js/tablemode.js');
  const css = read('public/css/table.css');
  assert.match(js, /<button type="button" class="table-zone-size"><\/button>/, 'every zone is made with its button');
  assert.match(js, /size\.addEventListener\('pointerdown', e => e\.stopPropagation\(\)\)/, 'its press stops at it');
  assert.match(js, /size\.addEventListener\('click', \(\) => tableZoneToggleSize\(/);
  assert.ok(app.evaluate('TABLE_SCROLL_PAUSE').includes('.table-zone-size'), 'the edges stand still over it');
  const onIt = { closest: sel => (sel.split(',').map(s => s.trim()).includes('.table-zone-size') ? {} : null) };
  assert.strictEqual(app.sandbox.tableGrabbable(onIt, { contains: () => true }, 0), false, 'the main button cannot take hold of the table by it');
  assert.match(css, /\.table-zone-size \{[^}]*display: none;/, 'hidden on a zone that may not be changed');
  assert.match(css, /\.table-zone\[data-editable\] \.table-zone-size \{ display: flex; \}/, 'shown on one that may');
  assert.match(css, /\.table-zone\[data-editable\] \.table-zone-label \{\s*max-width: calc\(100% - 3 \* var\(--table-zone-pad\) - var\(--table-zone-label-h\)\);/,
    'the label stops short of it');
});

test('a zone kept is laid where it was on a mat of any size, as fractions of it', () => {
  const rects = [
    { name: 'Lands', left: 12, top: 220, width: 500, height: 260 },
    { name: 'Ramp', left: 600.5, top: 300.25, width: 180, height: 210 },
  ];
  const kept = app.call('tableZoneNormalise', rects, 1114, 830);
  for (const z of kept) for (const k of ['x', 'y', 'w', 'h']) assert.ok(z[k] >= 0 && z[k] <= 1, `${z.name}.${k} is a fraction of the mat`);
  /* Through storage: JSON, as localStorage keeps it. */
  const back = app.call('tableZoneDenormalise', JSON.parse(JSON.stringify(kept)), 1114, 830, { width: 100, height: 100 });
  for (const [i, r] of rects.entries()) {
    for (const k of ['left', 'top', 'width', 'height']) assert.ok(near(back[i][k], r[k], 1e-9), `${r.name}.${k} round trip`);
    assert.strictEqual(back[i].name, r.name);
  }
  /* On a larger mat, in proportion. */
  const big = app.call('tableZoneDenormalise', kept, 2228, 1660, { width: 100, height: 100 });
  assert.ok(near(big[0].left, 24) && near(big[0].width, 1000) && near(big[1].top, 600.5));
  /* On a smaller one, no smaller than a card, and still on the mat. */
  const small = app.call('tableZoneDenormalise', kept, 557, 415, { width: 120, height: 200 });
  for (const r of small) {
    assert.ok(r.width >= 120 && r.height >= 200 && r.left + r.width <= 557 + 1e-9 && r.top + r.height <= 415 + 1e-9, JSON.stringify(r));
  }
  /* What cannot be read is not laid. */
  assert.deepStrictEqual(app.call('tableZoneDenormalise', [{ name: 'x', x: 'a' }, null, { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }], 100, 100), []);
  assert.deepStrictEqual(app.call('tableZoneDenormalise', 'nonsense', 100, 100), []);
});

test('a category new since the layout was kept gets a zone in free space; one gone loses its zone', () => {
  const W = 1114, H = 830, w = 111, h = 155;
  const keep = app.call('tableZoneHeadRect', 1, W, H, w, h);
  const first = app.call('tableZoneReconcile', null, ZONE_DECK.slice(0, 4), W, H, w, h, keep);
  assert.strictEqual(first.changed, true, 'laid out for the first time, it is kept');
  assert.deepStrictEqual(first.rects.map(r => r.name), ZONE_DECK.slice(0, 4).map(z => z.name));
  const kept = app.call('tableZoneNormalise', first.rects, W, H);
  const same = app.call('tableZoneReconcile', kept, ZONE_DECK.slice(0, 4), W, H, w, h, keep);
  assert.strictEqual(same.changed, false, 'the same deck is laid as kept');
  for (const [i, r] of same.rects.entries()) assert.ok(near(r.left, first.rects[i].left) && near(r.top, first.rects[i].top));

  /* Counters gone, Draw and a new empty category come. */
  const now = [ZONE_DECK[0], ZONE_DECK[1], ZONE_DECK[3], { name: 'Draw', count: 12 }, { name: 'New category', count: 0 }];
  const next = app.call('tableZoneReconcile', kept, now, W, H, w, h, keep);
  assert.strictEqual(next.changed, true);
  assert.deepStrictEqual(next.rects.map(r => r.name), ['Artifacts', 'Clones', 'Creatures', 'Draw', 'New category'],
    'the kept ones in their order, then the new ones');
  for (const r of next.rects.slice(0, 3)) {
    const was = first.rects.find(f => f.name === r.name);
    assert.ok(near(r.left, was.left) && near(r.top, was.top), `${r.name} stays where it was`);
  }
  for (const r of next.rects.slice(3)) {
    assert.ok(r.left >= 0 && r.top >= 0 && r.left + r.width <= W && r.top + r.height <= H, `${r.name} on the mat`);
    assert.ok(!app.sandbox.tableZoneOverlap(r, keep), `${r.name} placed over the commander`);
    for (const o of next.rects) if (o !== r) assert.ok(!app.sandbox.tableZoneOverlap(r, o), `${r.name} placed over ${o.name}`);
  }
  const min = zoneMin(w, h);
  assert.ok(next.rects[4].width >= min.width && next.rects[4].height >= min.height, 'an empty zone is still a card’s size');
});

test('a card let go is over the topmost zone under the pointer, mapped onto the mat through the camera', () => {
  const zones = [
    { name: 'Lands', left: 100, top: 200, width: 300, height: 220 },
    { name: 'Ramp', left: 350, top: 300, width: 200, height: 200 },
    { name: 'Draw', left: 600, top: 200, width: 150, height: 200 },
  ];
  const at = p => app.sandbox.tableZoneAt(p, zones);
  assert.strictEqual(at({ u: 150, v: 250 }), 0);
  assert.strictEqual(at({ u: 380, v: 350 }), 1, 'where two overlap, the one drawn last — moved last — is the one');
  assert.strictEqual(at({ u: 600, v: 400 }), 2, 'an edge counts');
  assert.strictEqual(at({ u: 575, v: 250 }), -1, 'between zones is no zone');
  assert.strictEqual(at({ u: 50, v: 50 }), -1);
  assert.strictEqual(at(null), -1, 'a pointer that misses the mat is over no zone');
  for (const v of VIEWS) {
    const m = matrix(v);
    for (const [u, w, want] of [[250, 310, 0], [450, 400, 1], [675, 300, 2], [575, 250, -1], [20, 20, -1]]) {
      const p = project(m, u, w, 0.5);
      assert.strictEqual(at(unproject(m, p.x, p.y, 0.5)), want, `${u},${w} through ${JSON.stringify(v)}`);
    }
  }
});

test('zones are offered on the Deck Builder’s table, and only the user’s own deck can be changed in them', () => {
  const rules = o => app.call('tableZoneRules', { scope: 'deckview', deckOpen: true, canEdit: true, on: true, ...o });
  assert.deepStrictEqual(rules({}), { toggle: true, zones: true, arrange: true, rename: true, add: true, move: true });
  assert.deepStrictEqual(rules({ canEdit: false }), { toggle: true, zones: true, arrange: false, rename: false, add: false, move: false },
    'somebody else’s deck can be laid in zones and looked at, not changed');
  assert.deepStrictEqual(rules({ on: false }), { toggle: true, zones: false, arrange: false, rename: false, add: false, move: false },
    'off, the chip is still there to turn them on, and nothing else is');
  for (const scope of ['collections', 'players', 'scryfall', 'sets', 'wants', 'card', '', undefined]) {
    assert.strictEqual(rules({ scope }).toggle, false, `${scope} has no zones`);
    assert.strictEqual(rules({ scope }).zones, false);
  }
  assert.strictEqual(rules({ deckOpen: false }).toggle, false, 'no deck, no zones');

  /* Which categories are zones: those with cards, and those given a zone. */
  const cats = ['Creatures', 'Planeswalkers', 'Lands', 'Battles', 'New category'].map(name => ({ name }));
  assert.deepStrictEqual(app.call('tableZoneNames', cats, { Creatures: 5, Lands: 38 }, []), ['Creatures', 'Lands'],
    'a category the deck never used lies nowhere');
  assert.deepStrictEqual(app.call('tableZoneNames', cats, { Creatures: 5, Lands: 38 }, ['New category', 'Gone']),
    ['Creatures', 'Lands', 'New category'], 'an empty one given a zone keeps it; one the deck no longer has does not');
});

test('a zone moved by its label onto the bin is the bin’s to delete, but never Uncategorised with cards in it', () => {
  const takes = o => app.sandbox.tableZoneBinAction({
    mode: 'move', dragging: true, overBin: true, name: 'Ramp', count: 9, canEdit: true, ...o });
  assert.strictEqual(takes({}), true, 'a zone carried by its label, the pointer over the bin');
  assert.strictEqual(takes({ overBin: false }), false, 'anywhere else it is only moved');
  assert.strictEqual(takes({ mode: 'resize' }), false, 'a zone being resized is never binned');
  assert.strictEqual(takes({ dragging: false }), false, 'a press that never became a drag is not a drop');
  assert.strictEqual(takes({ canEdit: false }), false, 'somebody else’s deck loses no category');
  assert.strictEqual(takes({ name: 'Uncategorised', count: 3 }), false,
    'Uncategorised with cards in it would only fill again, so the bin refuses it');
  assert.strictEqual(takes({ name: 'Uncategorised', count: 0 }), true, 'an empty one may go');
  assert.strictEqual(takes({ name: 'Uncategorised', count: undefined }), true, 'no count is no cards');
  assert.strictEqual(takes({ count: 0 }), true, 'an empty zone of any other name may go too');
});

test('the Zones chip is kept per browser, and unreadable storage is just "off"', () => {
  const app2 = loadTableMode();
  assert.strictEqual(app2.evaluate('readTableZones()'), false, 'off until it is turned on');
  app2.evaluate('rememberTableZones(true)');
  assert.strictEqual(app2.store.get('mtgtools_table_zones'), '1');
  assert.strictEqual(app2.evaluate('readTableZones()'), true);
  app2.evaluate('rememberTableZones(false)');
  assert.ok(!app2.store.has('mtgtools_table_zones'), 'off is no key at all');
  const locked = loadTableMode({ storage: false });
  assert.strictEqual(locked.evaluate('readTableZones()'), false);
  assert.doesNotThrow(() => locked.evaluate('rememberTableZones(true)'));
  assert.strictEqual(locked.evaluate('tableZoneKept("d_1")'), null, 'a deck with nothing readable kept is laid out afresh');
});

test('the zones and their cards keep under the landing mark and the rim, however many there are', () => {
  const cap = app.evaluate('TABLE_DEPTH');
  for (const layers of [1, 20, 61, 100, 300, 753]) {
    const g = app.evaluate(`tableCardGapFor(${layers})`);
    assert.ok(g > 0 && g <= app.evaluate('TABLE_CARD_GAP'), `${layers} layers`);
    assert.ok(layers * g <= cap + 1e-9, `${layers} layers fit the piles' depth`);
  }
  assert.ok(app.evaluate('TABLE_DEPTH + TABLE_CARD_GAP') < app.evaluate('TABLE_CAST_Z'),
    'a card picked up off a zone is still under the mark');
  const css = read('public/css/table.css');
  assert.match(css, /\.table-zone\s*\{[^}]*pointer-events:\s*none/, 'a zone’s felt is felt: it takes no pointer');
  assert.match(css, /\.table-zone-label\s*\{[^}]*pointer-events:\s*auto/, 'its label does');
  assert.match(css, /\.table-zone-grip\s*\{[^}]*width:\s*2rem;[^}]*height:\s*2rem/, 'its grip is a 2rem square to press');
  assert.match(read('public/js/tablemode.js'), /cardCarryDrop\(\[card\.ref\], place\)/,
    'a card goes into a zone through the builder’s own drop');
});

// ── The Deck Builder's side table ─────────────────────────────────────────

const SIDE = {
  share: app.evaluate('TABLE_SIDE_SHARE'),
  gap:   app.evaluate('TABLE_SIDE_GAP'),
};

/* The pair as tableFitPair fits it to a window, and where its corners are
 * drawn at rest: the matrix of tablePlaneMatrix with the mat at the plane's
 * corner, so u, v are the plane's own pixels and the side table's corners are
 * points of the same plane past its right-hand edge. */
function fittedPair(view, perspective = 1400, top = 30) {
  const box = app.copy(app.sandbox.tableFitSize(view, { perspective, top }));
  const pair = app.call('tableFitPair', box, { side: true });
  const m = app.sandbox.tablePlaneMatrix({
    perspective, origin: { x: view.width / 2, y: view.height / 2 },
    plane: { left: pair.left, top: pair.top, origin: { x: pair.width / 2, y: pair.height / 2 } },
    mat: { left: 0, top: 0 },
  });
  const at = (u, v) => app.copy(app.sandbox.tableProject(m, u, v, 0));
  const sideLeft = pair.width + pair.side.gap, sideRight = sideLeft + pair.side.width;
  return { box, pair, at, sideLeft, sideRight };
}

test('with the side table up the pair is fitted as the one table was, the side table a third of the table, in one plane', () => {
  for (const view of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1280, height: 800 }, { width: 2560, height: 1440 }, { width: 960, height: 1000 }]) {
    const { box, pair, at, sideLeft, sideRight } = fittedPair(view);
    const what = `${view.width}×${view.height}`;
    assert.ok(near(pair.side.width, pair.width * SIDE.share, 1e-9), `${what}: the side table is a third of the table, ${JSON.stringify(pair)}`);
    assert.strictEqual(pair.side.gap, SIDE.gap, 'with the gap of bare room between them');
    assert.ok(near(pair.width + pair.side.gap + pair.side.width, box.width, 1e-9), 'and the three are the box the one table was fitted to');
    assert.ok(pair.width < box.width, 'so the table is the narrower for it');
    assert.strictEqual(pair.left, box.left, 'the pair keeps the one table’s place: it is what is centred now');
    assert.strictEqual(pair.top, box.top, 'one far edge');
    assert.strictEqual(pair.height, box.height, 'one depth');
    /* Drawn at rest: the pair's near corners at the window's bottom corners,
       its far edge at the room asked, as the one table's were. */
    const g = 8;
    const nl = at(0, pair.height), nr = at(sideRight, pair.height);
    assert.ok(near(nl.x, g, 1e-6) && near(nl.y, view.height - g, 1e-6), `${what}: near left ${JSON.stringify(nl)}`);
    assert.ok(near(nr.x, view.width - g, 1e-6) && near(nr.y, view.height - g, 1e-6), `${what}: the side table's near right ${JSON.stringify(nr)}`);
    assert.ok(near(at(sideRight, 0).y, 30, 1e-6) && near(at(0, 0).y, 30, 1e-6), 'the far edge of both at the room asked for');
    /* In one plane, on one edge: the table's near right and the side table's
       near left are on one line, with bare room between them. */
    const tr = at(pair.width, pair.height), sl = at(sideLeft, pair.height);
    assert.ok(near(tr.y, sl.y, 1e-6), 'the two near edges are one line');
    assert.ok(sl.x > tr.x, 'and the side table stands apart, to the right');
  }
});

test('with the side table down the fit, the outline and the card in hand are the one table’s, to the pixel', () => {
  const box = app.copy(app.sandbox.tableFitSize({ width: 1440, height: 900 }, { perspective: 1400, top: 26 }));
  assert.deepStrictEqual(app.call('tableFitPair', box), { ...box, side: null });
  assert.deepStrictEqual(app.call('tableFitPair', box, { side: false }), { ...box, side: null });
  assert.strictEqual(app.sandbox.tableFitPair(null, { side: true }), null, 'no box, no pair');
  /* The outline: without a span, or with one short of the plane, the plane's own. */
  assert.deepStrictEqual(app.call('tablePanBounds', { ...FIT_GEOM, plane: { ...FIT_GEOM.plane, span: undefined } }), BOUNDS);
  assert.deepStrictEqual(app.call('tablePanBounds', { ...FIT_GEOM, plane: { ...FIT_GEOM.plane, span: 10 } }), BOUNDS);
  /* A card in hand: no reach is the mat, as it always was. */
  for (const [hit, grab] of [[{ u: 300, v: 200 }, { u: 10, v: -4 }], [{ u: -50, v: 900 }, null], [{ u: 2000, v: -3 }, { u: 0, v: 0 }]]) {
    assert.deepStrictEqual(app.call('tableDropSpot', hit, grab, 872, 573), app.call('tableDropSpot', hit, grab, 872, 573, null));
  }
  const css = read('public/css/table.css');
  assert.match(css, /\.table-side\[hidden\]\s*\{\s*display:\s*none;\s*\}/, 'and the side table is not drawn at all');
});

test('the outline the view is held inside runs on over the side table, and at the whole table the rest view is still the only one', () => {
  const view = { width: W, height: H };
  const box = app.copy(app.sandbox.tableFitSize(view, { perspective: 1400, top: 8 + LEAN * H }));
  const pair = app.call('tableFitPair', box, { side: true });
  const plane = { left: pair.left, top: pair.top, origin: { x: pair.width / 2, y: pair.height / 2 }, width: pair.width, height: pair.height };
  const geom = { perspective: 1400, origin: { x: W / 2, y: H / 2 }, plane };
  const alone = app.call('tablePanBounds', geom);
  const both = app.call('tablePanBounds', { ...geom, plane: { ...plane, span: pair.width + pair.side.gap + pair.side.width } });
  assert.ok(both.right > alone.right + 100, `the side table is inside the outline: ${alone.right} → ${both.right}`);
  assert.ok(near(both.right, W - 8, 1e-6), 'reaching the window’s edge at rest, where its near corner is drawn');
  assert.strictEqual(both.left, alone.left);
  assert.strictEqual(both.top, alone.top);
  assert.strictEqual(both.bottom, alone.bottom);
  const rest = app.copy(app.sandbox.tablePanRange(both, 1, W, H));
  assert.deepStrictEqual([rest.x.lo, rest.x.hi, rest.y.lo, rest.y.hi], [0, 0, 0, 0], 'the pair fills the window at 1');
  const zoomed = app.copy(app.sandbox.tablePanRange(both, 2.5, W, H));
  const short = app.copy(app.sandbox.tablePanRange(alone, 2.5, W, H));
  assert.ok(zoomed.x.hi > short.x.hi, 'zoomed in, the view can be taken on over the side table');
});

test('a card in hand is drawn under the pointer over both tables, and lands, if on the mat, on the mat', () => {
  const reach = { left: 0, top: 0, right: 1100, bottom: 573 };
  const over = app.call('tableDropSpot', { u: 1000, v: 300 }, { u: 0, v: 0 }, 872, 573, reach);
  assert.ok(near(over.x * 872, 1000) && near(over.y * 573, 300), `past the mat’s edge, under the pointer: ${JSON.stringify(over)}`);
  const held = app.call('tableDropSpot', { u: 1500, v: 900 }, { u: 0, v: 0 }, 872, 573, reach);
  assert.ok(near(held.x * 872, 1100) && near(held.y * 573, 573), 'and held to the reach past it');
  const land = app.call('tableDropSpot', { u: 1000, v: 300 }, { u: 0, v: 0 }, 872, 573);
  assert.strictEqual(land.x, 1, 'where it lands on the mat is still the mat’s');
});

test('the side table’s felt is a region per board, the sideboard’s at the far half and the maybeboard’s at the near, each laying its cards inside it', () => {
  const pile = (board, n = 0) => ({ board, label: board, hint: '', cards: Array.from({ length: n }, (_, i) => ({ name: `${board}${i}`, ref: `${board}/${board}${i}` })) });
  const order = piles => app.call('tableSideBoards', piles).map(p => p.board);
  assert.deepStrictEqual(order([pile('maybe'), pile('side')]), ['side', 'maybe'], 'the sideboard first, whatever order the builder lists them');
  assert.deepStrictEqual(order([pile('maybe'), pile('considering'), pile('side')]), ['side', 'maybe', 'considering'],
    'and a board added to DB_BOARDS is a region too, after them in their order');
  assert.deepStrictEqual(order([pile('maybe'), { label: 'x', cards: [] }, null]), ['maybe'], 'no board, no region; no sideboard, the rest');
  assert.deepStrictEqual(order(null), []);

  const w = 75, h = 105;
  for (const [counts, W, H] of [[[15, 3], 165, 780], [[0, 0], 165, 780], [[40, 2], 140, 600], [[4, 9, 1], 220, 900]]) {
    const regions = app.call('tableSideLayout', counts, W, H, w, h);
    const what = `${counts} on ${W}×${H}`;
    assert.strictEqual(regions.length, counts.length, `${what}: a region per board`);
    for (let i = 1; i < regions.length; i++) {
      assert.ok(regions[i].top >= regions[i - 1].top + regions[i - 1].height + ZONE.gap - 1e-9, `${what}: region ${i} lies below region ${i - 1}, apart`);
    }
    for (const [i, r] of regions.entries()) {
      assert.ok(r.left >= 0 && r.top >= 0 && r.left + r.width <= W + 1e-9 && r.top + r.height <= H + 1e-9, `${what}: region ${i} on the felt`);
      assert.ok(near(r.height, regions[0].height) && near(r.width, regions[0].width), 'the felt shared out evenly');
      assertFitInside(r, counts[i], r.width, r.height, w, h, `${what}: region ${i}`);
    }
    const share = (H - ZONE.gap) / counts.length;
    assert.ok(regions[0].top < share && regions.at(-1).top + regions.at(-1).height > H - share, 'the first at the far end, the last at the near');
  }
  assert.deepStrictEqual(app.call('tableSideLayout', [], 165, 780, w, h), [], 'no boards, no regions');
});

test('a point of the plane is over the table, a region of the side table, the side table’s rim, or nothing', () => {
  const geom = {
    width: 700, height: 500,
    side: { left: 800, top: 0, width: 160, height: 500 },
    box: { left: 744, top: -74, width: 272, height: 616 },
    boards: ['side', 'maybe'],
  };
  const at = (u, v, g = geom) => app.call('tableSideTarget', { u, v }, g);
  assert.deepStrictEqual(at(100, 100), { table: 'main' });
  assert.deepStrictEqual(at(700, 500), { table: 'main' }, 'the mat’s edge counts');
  assert.deepStrictEqual(at(850, 100), { table: 'side', board: 'side' }, 'the far half of the side table’s felt is the sideboard’s');
  assert.deepStrictEqual(at(850, 249), { table: 'side', board: 'side' });
  assert.deepStrictEqual(at(850, 251), { table: 'side', board: 'maybe' }, 'the near half the maybeboard’s');
  assert.deepStrictEqual(at(959, 499), { table: 'side', board: 'maybe' });
  assert.deepStrictEqual(at(780, 100), { table: 'side', board: null }, 'its rim is the side table, and no region of it');
  assert.deepStrictEqual(at(870, -40), { table: 'side', board: null });
  assert.strictEqual(at(720, 100), null, 'the room between the two is neither');
  assert.strictEqual(at(-20, 100), null, 'nor is the table’s own rim');
  assert.strictEqual(at(1100, 100), null);
  assert.deepStrictEqual(at(850, 100, { ...geom, boards: [] }), { table: 'side', board: null }, 'a felt with no regions is still the side table');
  assert.strictEqual(app.sandbox.tableSideTarget(null, geom), null, 'a pointer that missed the plane is over nothing');
  assert.strictEqual(at(100, 100, { ...geom, side: null }), null, 'and with no side table up, nothing is asked');

  /* Through every view the table is seen in, by the pointer mapped through
     the camera — the side table is the plane's, so the mat's mapping runs on
     across it. */
  for (const v of VIEWS) {
    const m = matrix(v);
    for (const [u, w, want] of [[400, 300, 'main'], [880, 120, 'side'], [880, 400, 'maybe'], [760, 200, null], [720, 200, undefined]]) {
      const p = project(m, u, w, 0);
      const got = app.copy(app.sandbox.tableSideTarget(unproject(m, p.x, p.y, 0), geom));
      const said = got ? (got.table === 'main' ? 'main' : got.board) : undefined;
      assert.strictEqual(said, want, `${u},${w} through ${JSON.stringify(v)}`);
    }
  }
});

test('a card let go between the tables asks the deck for a board, the mainboard or a zone’s pile — and nothing else', () => {
  const place = o => app.sandbox.tableSidePlace({ move: true, ...o });
  const region = board => ({ table: 'side', board });
  const mat = { table: 'main' };
  assert.strictEqual(place({ ref: 'main/Sol Ring', target: region('side') }), 'side', 'a card of the deck over the sideboard: that board alone');
  assert.strictEqual(place({ ref: 'main/Sol Ring', target: region('maybe') }), 'maybe');
  assert.strictEqual(place({ ref: 'side/Duress', target: mat }), 'main', 'a card of the side table over the mat: back into the category it kept');
  assert.strictEqual(place({ ref: 'side/Duress', target: mat, zone: 'Removal' }), 'main/Removal', 'over a zone, that zone’s pile');
  assert.strictEqual(place({ ref: 'maybe/Fire // Ice', target: mat, zone: 'Odd/Name' }), 'main/Odd/Name', 'a name or a category with a slash is still one');
  assert.strictEqual(place({ ref: 'side/Duress', target: region('maybe') }), 'maybe', 'over the other region: that board');
  assert.strictEqual(place({ ref: 'maybe/Fire // Ice', target: region('side') }), 'side');
  for (const [o, why] of [
    [{ ref: 'side/Duress', target: region('side') }, 'its own region'],
    [{ ref: 'side/Duress', target: region(null) }, 'the side table’s rim'],
    [{ ref: 'side/Duress', target: null }, 'the room between'],
    [{ ref: 'main/Sol Ring', target: mat }, 'a card of the mat over the mat, which is the piles’ or the zones’'],
    [{ ref: 'commander/Atraxa', head: true, target: region('side') }, 'the commander'],
    [{ ref: 'commander/Atraxa', target: region('side') }, 'the commander, by its board'],
    [{ ref: 'main/Sol Ring', target: region('side'), move: false }, 'a deck the user may only look at'],
    [{ ref: null, target: region('side') }, 'a card the deck does not know'],
    [{ ref: '', target: mat }, 'nor one with an empty ref'],
  ]) {
    assert.strictEqual(place(o), null, `nothing for ${why}`);
  }
  assert.match(read('public/js/tablemode.js'), /cardCarryDrop\(\[card\.ref\], place\)\s*\n\s*: typeof dbMoveCardsTo === 'function' && dbMoveCardsTo\(\[card\.ref\], place\);\s*\n\s*if \(moved\) \{ tableRelayDeck\(\); return true; \}\s*\n\s*if \(target\.table/,
    'and every move goes through the builder’s own drop');
});

test('the side table is offered on the Deck Builder’s table, kept per browser, and only the user’s own deck moves a card on it', () => {
  const rules = o => app.call('tableSideRules', { scope: 'deckview', deckOpen: true, canEdit: true, on: true, ...o });
  assert.deepStrictEqual(rules({}), { toggle: true, side: true, move: true });
  assert.deepStrictEqual(rules({ canEdit: false }), { toggle: true, side: true, move: false },
    'somebody else’s deck has a side table to look at, and nothing on it moves');
  assert.deepStrictEqual(rules({ on: false }), { toggle: true, side: false, move: false }, 'off, the chip is there to turn it on');
  assert.deepStrictEqual(rules({ deckOpen: false }), { toggle: false, side: false, move: false }, 'no deck, no chip');
  for (const scope of ['collections', 'players', 'scryfall', 'sets', 'wants', 'card', '', undefined]) {
    assert.deepStrictEqual(rules({ scope }), { toggle: false, side: false, move: false }, `${scope} has no side table`);
  }

  const app2 = loadTableMode();
  assert.strictEqual(app2.evaluate('readTableSide()'), false, 'off until it is turned on');
  app2.evaluate('rememberTableSide(true)');
  assert.strictEqual(app2.store.get('mtgtools_table_side'), '1');
  assert.strictEqual(app2.evaluate('readTableSide()'), true);
  app2.evaluate('rememberTableSide(false)');
  assert.ok(!app2.store.has('mtgtools_table_side'), 'off is no key at all');
  const locked = loadTableMode({ storage: false });
  assert.strictEqual(locked.evaluate('readTableSide()'), false, 'unreadable storage is just off');
  assert.doesNotThrow(() => locked.evaluate('rememberTableSide(true)'));

  const hint = (pile, canEdit) => app.sandbox.tableSideHint(pile, canEdit);
  const side = { board: 'side', hint: 'Cards you swap in between games' };
  const maybe = { board: 'maybe', hint: 'Cards you are considering' };
  assert.strictEqual(hint(side, true), 'Drag a card here to sideboard it');
  assert.strictEqual(hint(maybe, true), 'Drag a card here to set it aside');
  assert.strictEqual(hint({ board: 'considering', hint: 'Later, maybe' }, true), 'Later, maybe', 'a board with no words of its own here says its hint');
  assert.strictEqual(hint(side, false), 'Cards you swap in between games', 'and to a deck that cannot be dropped on, what the board is for');
  assert.strictEqual(hint({ board: 'x' }, false), '');
});

test('the side table’s cards are its own: keyed apart from the mat’s, laid again only when one changes board', () => {
  const piles = cards => [{ board: 'side', label: 'Sideboard', cards }];
  const keyed = app.copy(app.sandbox.tableSideKeyed(piles([
    { name: 'Sol Ring', image: 'ring.jpg', ref: 'side/Sol Ring', qty: 2 },
    { name: 'Duress', image: '', ref: 'side/Duress', qty: 1 },
  ])[0]));
  assert.deepStrictEqual(keyed.map(c => [c.key, c.ref, c.qty, c.imageUrl]), [
    ['deckview:side/Sol Ring#1', 'side/Sol Ring', 2, 'ring.jpg'],
    ['deckview:side/Duress#1', 'side/Duress', 1, ''],
  ], 'known by its ref, its count on it — never the mat’s card of the same name');
  const main = app.copy(app.sandbox.tableKeyCards([{ name: 'Sol Ring', id: 'main/Sol Ring' }], 'deckview'));
  assert.notStrictEqual(main[0].key, keyed[0].key);

  const sig = (cards, board = 'side') => app.sandbox.tableSideSig([{ board, label: board, cards }]);
  assert.strictEqual(sig([{ ref: 'side/A', qty: 1 }]), sig([{ ref: 'side/A', qty: 4, image: 'a.jpg' }]),
    'a count or a picture changed lays nothing again');
  assert.notStrictEqual(sig([{ ref: 'side/A' }]), sig([{ ref: 'maybe/A' }], 'maybe'), 'a card moved to another board does');
  assert.notStrictEqual(sig([{ ref: 'side/A' }]), sig([{ ref: 'side/A' }, { ref: 'side/B' }]), 'and so does one more card');
});

test('the Deck Builder’s source hands the side table the boards beside the deck, apart from the mat’s cards', () => {
  const boards = [{ board: 'maybe', label: 'Maybeboard', hint: '', cards: [] },
    { board: 'side', label: 'Sideboard', hint: '', cards: [{ name: 'Duress', image: '', ref: 'side/Duress', qty: 1 }] }];
  const src = ask('deckview', {
    dbShownPiles: () => [{ label: 'Ramp', cards: [{ name: 'Sol Ring', image: '', ref: 'main/Sol Ring', qty: 1 }] }],
    dbShownCommanders: () => [],
    dbSideBoardPiles: () => boards,
  });
  assert.deepStrictEqual(plain(src.side), boards);
  assert.deepStrictEqual(plain(src.cards.map(c => c.ref)), ['main/Sol Ring'], 'the side table’s cards are not laid on the mat');
  const old = ask('deckview', { dbShownPiles: () => [] });
  assert.strictEqual(old.side, null, 'a builder with no getter for them has no boards to give');
});

test('the side table is built of the table’s board, stands beyond its edge in its plane, and its regions take no pointer', () => {
  const css = read('public/css/table.css');
  const shared = css.match(/\n\.table-plane,\s*\n\.table-side\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(shared, /grid-template-columns:\s*var\(--table-rim-side\)/, 'the same rims');
  assert.match(shared, /grid-template-rows:\s*var\(--table-rim-far\)/, 'the same far rim, so its felt starts level with the table’s');
  assert.match(shared, /border:\s*var\(--table-edge\) solid var\(--table-wood-edge\)/, 'the same edge');
  assert.match(shared, /background-image:/, 'the same wood');
  assert.match(shared, /transform-style:\s*preserve-3d/);
  assert.doesNotMatch(shared, /rotateX/, 'and the tilt is the plane’s alone');
  /* Its own rule, not the one it shares: no selector list before it. */
  const side = css.match(/[^,\s]\s*\n\.table-side\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(side, /left:\s*calc\(100% \+ var\(--table-edge\) \+ var\(--table-side-gap/, 'beyond the plane’s edge and the gap');
  assert.match(side, /top:\s*calc\(-1 \* var\(--table-edge\)\)/, 'level with its top');
  assert.match(side, /height:\s*calc\(100% \+ 2 \* var\(--table-edge\)\)/, 'and its depth');
  assert.match(side, /width:\s*var\(--table-side-w/, 'as wide as the script fits it');
  assert.doesNotMatch(side, /transform/, 'a child of the plane needs no transform to lie in it');
  assert.match(css, /\.table-side-region\s*\{[^}]*pointer-events:\s*none/, 'a region’s felt is felt');
  assert.match(css, /\.table-side-region\.is-target\s*\{[^}]*outline:\s*1px solid var\(--accent/, 'lit as a zone is');
  const js = read('public/js/tablemode.js');
  assert.match(js, /tableEls\.plane\.append\(el\)/, 'the script stands it in the plane');
  assert.match(js, /class="table-mat table-side-mat"/, 'and its felt is a mat, with the playmat on it');
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
    for (const token of ['--table-wood', '--table-wood-edge', '--table-wood-img', '--table-wood-tint', '--table-wood-lit',
      '--table-land-ink', '--table-land-halo', '--table-land-fill', '--table-zone-fill', '--table-zone-line', '--table-zone-halo']) {
      assert.ok(palettes[theme][token], `the ${theme} palette does not name ${token}`);
    }
  }
  /* The dark rooms lie on walnut, the lit ones on oak, and the
     high-contrast theme on no photograph at all. */
  const wood = theme => palettes[theme]['--table-wood-img'];
  for (const theme of ['dark', 'dusk']) assert.match(wood(theme), /^url\('\.\.\/textures\/table-wood-dark\.webp'\)$/, theme);
  for (const theme of ['light', 'sepia']) assert.match(wood(theme), /^url\('\.\.\/textures\/table-wood-light\.webp'\)$/, theme);
  assert.strictEqual(wood('contrast'), 'none');
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

// ── The card-size slider ──────────────────────────────────────────────────

test('the card-size slider is held to its range and its step, and kept per browser', () => {
  const clamp = v => app.sandbox.tableCardScaleClamp(v);
  for (const nothing of [undefined, null, '', 'big', NaN, Infinity]) {
    assert.strictEqual(clamp(nothing), 1, `${String(nothing)} is the table’s own size`);
  }
  assert.strictEqual(clamp(1), 1);
  assert.strictEqual(clamp(0), 0.5, 'no smaller than half');
  assert.strictEqual(clamp(-3), 0.5);
  assert.strictEqual(clamp('0.2'), 0.5, 'a stored string is read as the number it says');
  assert.strictEqual(clamp(9), 1.5, 'no larger than half as large again');
  assert.strictEqual(clamp(0.56), 0.55, 'put on its step');
  assert.strictEqual(clamp('1.24'), 1.25);
  assert.strictEqual(clamp(0.55), 0.55, 'and a step is the number it says, not a float near it');
  assert.strictEqual(clamp(1 + 3 * 0.1), 1.3);

  const fresh = loadTableMode();
  const key = fresh.evaluate('TABLE_CARD_SCALE_KEY');
  assert.strictEqual(key, 'mtgtools_table_card_scale');
  assert.strictEqual(fresh.sandbox.readTableCardScale(), 1, 'a browser that never moved it lays the table’s own size');
  fresh.sandbox.rememberTableCardScale(1.3);
  assert.strictEqual(fresh.store.get(key), '1.3');
  assert.strictEqual(fresh.sandbox.readTableCardScale(), 1.3);
  fresh.sandbox.rememberTableCardScale(1);
  assert.ok(!fresh.store.has(key), 'nothing is kept for the table’s own size');
  fresh.store.set(key, '7');
  assert.strictEqual(fresh.sandbox.readTableCardScale(), 1.5, 'a kept value out of range is held to it');
  fresh.store.set(key, 'nonsense');
  assert.strictEqual(fresh.sandbox.readTableCardScale(), 1);

  const locked = loadTableMode({ storage: false });
  assert.strictEqual(locked.sandbox.readTableCardScale(), 1, 'storage that cannot be read is the table’s own size');
  assert.doesNotThrow(() => locked.sandbox.rememberTableCardScale(0.7), 'and storage that cannot be written is no exception');
});

test('at 100% every layout is the one the table has always laid', () => {
  const R = 88 / 63;
  for (let w = 0; w <= 2600; w += 37) {
    const before = Math.round(Math.min(150, Math.max(72, w * 0.1)));
    assert.strictEqual(app.sandbox.tableCardWidth(w), before, `card width on a ${w}px mat`);
    assert.strictEqual(app.sandbox.tableCardWidth(w, 1), before);
    assert.strictEqual(app.sandbox.tableCardWidthFor(w, 600, 1, { head: true }), before);
  }
  for (const [W, H] of [[MAT.width, MAT.height], [1102, 827], [764, 686], [1500, 420], [400, 300]]) {
    for (const list of [cards(60, i => `g${i % 6}`), deckList(1, 99, 7), deckList(2, 200, 9), cards(30)]) {
      const at = scale => app.copy(app.evaluate(`tableLayout(${JSON.stringify(list)}, ${W}, ${H}, {}, ${scale})`));
      assert.deepStrictEqual(at(1), layout(list, W, H), `${list.length} cards on ${W}×${H}`);
    }
    const feature = app.call('tableFeatureSize', W, H, 1);
    const w = Math.round(Math.min(H * 0.78 / R, W * 0.3));
    assert.deepStrictEqual(feature, { w, h: w * R, lane: Math.round(w * 1.24) }, `the Card tab’s card on ${W}×${H}`);
    assert.deepStrictEqual(app.call('tableFeatureSize', W, H), feature);
  }
});

test('at 50%, 100% and 150% every card — the commander a tenth larger still — lies whole on the mat', () => {
  /* The mats the table is fitted to at 1440×900, 1280×800 and 1024×768, a
     big window's, a short one's, and the suite's own. */
  const mats = [MAT, { width: 1102, height: 827 }, { width: 984, height: 721 }, { width: 764, height: 686 },
    { width: 1900, height: 1180 }, { width: 700, height: 420 }];
  const lists = [cards(60, i => `g${i % 6}`), deckList(1, 99, 7), deckList(2, 200, 9), cards(30), deckList(1, 12, 1)];
  for (const mat of mats) {
    const base = app.sandbox.tableCardWidth(mat.width);
    for (const list of lists) {
      for (const scale of [0.5, 1, 1.5]) {
        const laid = app.copy(app.evaluate(`tableLayout(${JSON.stringify(list)}, ${mat.width}, ${mat.height}, {}, ${scale})`));
        if (scale < 1) assert.strictEqual(laid.width, Math.round(Math.min(150, Math.max(72, mat.width * 0.1)) * scale));
        if (scale > 1) assert.ok(laid.width >= base, 'larger is never smaller than the table’s own size');
        if (scale === 1.5 && mat.height >= 600) assert.ok(laid.width > base * 1.4, `room enough on ${mat.width}×${mat.height} to grow`);
        for (let i = 0; i < list.length; i++) {
          const box = boxOf(list, laid, i, mat);
          const where = `${list[i].name} of ${list.length} at ${scale * 100}% on ${mat.width}×${mat.height}`;
          assert.ok(box.left >= -1e-6 && box.right <= mat.width + 1e-6, `${where} runs off the side`);
          assert.ok(box.top >= -1e-6 && box.bottom <= mat.height + 1e-6, `${where} runs off the end`);
        }
        const heads = list.map((c, i) => (c.head ? i : -1)).filter(i => i >= 0);
        for (const i of heads) assert.ok(near(boxOf(list, laid, i, mat).w, laid.width * HEAD_SCALE), 'the head keeps its tenth');
      }
    }
    /* The Card tab's one card, at the slider's top: whole on the mat, its lane
       leaving the sheet half the mat. */
    const one = [{ name: 'Sol Ring' }];
    for (const scale of [0.5, 1, 1.5]) {
      const f = app.copy(app.evaluate(`tableFeatureLayout(${JSON.stringify(one)}, ${mat.width}, ${mat.height}, ${scale})`));
      const x = f.spots[0].x * mat.width, y = f.spots[0].y * mat.height;
      assert.ok(x + f.width / 2 <= mat.width + 1e-6 && x - f.width / 2 >= -1e-6, `the Card tab’s card at ${scale}`);
      assert.ok(y + f.height / 2 <= mat.height + 1e-6 && y - f.height / 2 >= -1e-6);
      if (scale > 1) assert.ok(f.lane <= mat.width * 0.5 + 1 || f.width === app.call('tableFeatureSize', mat.width, mat.height, 1).w);
    }
    const small = app.call('tableFeatureSize', mat.width, mat.height, 0.5).w;
    const own = app.call('tableFeatureSize', mat.width, mat.height, 1).w;
    assert.ok(Math.abs(small - own / 2) <= 0.5, 'and half its size at 50%');
  }
});

test('a card a hand moved keeps its centre at any size, and the rest take the layout’s place at it', () => {
  const list = app.copy(app.evaluate(`tableKeyCards(${JSON.stringify(deckList(1, 40, 4))}, 'deckview')`));
  const moved = new Map([[list[5].key, { x: 0.91, y: 0.12, turn: 7 }], [list[0].key, { x: 0.2, y: 0.8, turn: -3 }]]);
  for (const scale of [0.5, 1, 1.5]) {
    const got = app.sandbox.tableScaledPlaces(list, 1102, 827, scale, moved, false);
    const laid = app.copy(app.evaluate(`tableLayout(${JSON.stringify(list)}, 1102, 827, {}, ${scale})`));
    assert.deepStrictEqual(plain(got.size), { w: laid.width, h: laid.height });
    list.forEach((card, i) => {
      assert.deepStrictEqual(plain(got.places[i]), plain(moved.get(card.key) || laid.spots[i]),
        `${card.name} at ${scale * 100}%`);
    });
  }
  const feature = app.sandbox.tableScaledPlaces([{ key: 'card:x#1', name: 'Sol Ring' }], 1102, 827, 1.5, new Map(), true);
  assert.strictEqual(feature.size.w, app.call('tableFeatureSize', 1102, 827, 1.5).w, 'the Card tab’s card at its own size');
  assert.ok(feature.lane > 0);
});

test('a card grown by the slider is drawn from the larger picture it needs, and decoded for its own box', () => {
  const at100 = app.sandbox.tableCardWidthFor(1102, 827, 1), at150 = app.sandbox.tableCardWidthFor(1102, 827, 1.5);
  assert.strictEqual(at100, 110);
  assert.strictEqual(at150, 165);
  const pic = (w, o) => plain(app.sandbox.tableCardPicture(w, o));
  /* The scale is in the box the card is laid out in, which is what Firefox
     decodes for, so k is the zoom's and the screen's at any size … */
  assert.deepStrictEqual(pic(at100, { zoom: 1, dpr: 1 }), { k: 1, large: false });
  assert.deepStrictEqual(pic(at150, { zoom: 1, dpr: 1 }), { k: 1, large: false }, 'a 1x screen at rest never needs them');
  assert.strictEqual(pic(at150, { zoom: 1.5, dpr: 2 }).k, pic(at100, { zoom: 1.5, dpr: 2 }).k);
  assert.strictEqual(pic(at100, { zoom: 1.5, dpr: 2 }).k, app.sandbox.tableDecodeScale(1.5, 2));
  /* … and the width the slider grew is what asks for the large file. */
  assert.strictEqual(pic(at100, { zoom: 1.5, dpr: 2 }).large, false, 'the table’s own size, on the normal picture');
  assert.strictEqual(pic(at150, { zoom: 1.5, dpr: 2 }).large, true, 'grown half as large again, it needs the large one');
  assert.strictEqual(pic(at100, { zoom: 1, dpr: 2, head: true }).large, false);
  assert.strictEqual(pic(at150, { zoom: 1.2, dpr: 2, head: true }).large, true, 'and the commander, a tenth larger, sooner');
  assert.strictEqual(pic(at150, { zoom: 1.2, dpr: 2 }).large, false);
});

test('the slider leaves every zone’s rect as it is, and only a smaller window still grows one', () => {
  const W = 1102, H = 827;
  const base = app.sandbox.tableCardWidth(W), baseH = base * 88 / 63;
  const min = (w, h) => plain(app.sandbox.tableZoneMinFor(W, w, h));
  assert.deepStrictEqual(min(base, baseH), plain(app.sandbox.tableZoneMinSize(base, baseH)), 'at 100%, as it always was');
  assert.deepStrictEqual(min(base * 1.5, baseH * 1.5), plain(app.sandbox.tableZoneMinSize(base, baseH)),
    'at 150%, a zone sized for the table’s own cards is not grown');
  assert.deepStrictEqual(min(base / 2, baseH / 2), plain(app.sandbox.tableZoneMinSize(base / 2, baseH / 2)));

  const rects = [
    { name: 'Creatures', left: 12, top: 300, width: 140, height: 200 },
    { name: 'Lands', left: 400, top: 300, width: 300, height: 220 },
  ];
  const kept = app.call('tableZoneNormalise', rects, W, H);
  const zones = rects.map(r => ({ name: r.name, count: 12 }));
  for (const scale of [0.5, 1, 1.5]) {
    const w = base * scale, h = baseH * scale;
    const got = app.copy(app.evaluate(`tableZoneReconcile(${JSON.stringify(kept)}, ${JSON.stringify(zones)}, ${W}, ${H}, ${w}, ${h}, null, tableZoneMinFor(${W}, ${w}, ${h}))`));
    assert.strictEqual(got.changed, false);
    got.rects.forEach((r, i) => {
      for (const k of ['left', 'top', 'width', 'height']) assert.ok(near(r[k], rects[i][k], 1e-6), `${r.name}.${k} at ${scale * 100}%`);
    });
    /* Its cards fitted to the new size inside it: larger cards close up or pile. */
    const fit = app.call('tableZoneFit', 12, rects[1].width, rects[1].height, w, h);
    assert.ok(['grid', 'overlap', 'stack'].includes(fit.mode));
  }
  const tight = app.call('tableZoneFit', 12, 300, 220, base * 1.5, baseH * 1.5);
  const loose = app.call('tableZoneFit', 12, 300, 220, base * 0.5, baseH * 0.5);
  assert.ok(tight.visible < loose.visible, 'bigger cards in the same zone show less of each');
});

test('the slider lies on every tab that lays cards, and the drawer’s chips on the Deck Builder’s', () => {
  const sb = app.sandbox;
  for (const tab of app.copy(app.evaluate('TABLE_CARD_TABS'))) assert.strictEqual(sb.tableScaleShown(tab), true, tab);
  for (const tab of ['available', 'lands', 'pick', 'admin', '', null]) assert.strictEqual(sb.tableScaleShown(tab), false, String(tab));

  const chips = o => plain(sb.tableDrawerChipsShown({ scope: 'deckview', deckOpen: true, canEdit: true, ...o }));
  assert.deepStrictEqual(chips({}), { search: true, edhrec: true, lands: true }, 'a deck the user may edit: all three');
  assert.deepStrictEqual(chips({ canEdit: false }), { search: true, edhrec: true, lands: false },
    'somebody else’s deck can still be searched and asked of EDHREC, to look');
  assert.deepStrictEqual(chips({ deckOpen: false }), { search: false, edhrec: false, lands: false }, 'no deck, no drawer');
  for (const scope of ['collections', 'players', 'card', '']) {
    assert.deepStrictEqual(chips({ scope }), { search: false, edhrec: false, lands: false }, `not on ${scope || 'the API’s'} cards`);
  }
  assert.deepStrictEqual(app.copy(app.evaluate('TABLE_DRAWER_TABS.map(t => t.tab)')), ['search', 'edhrec', 'lands'],
    'the drawer’s own three tabs, by the builder’s names for them');
  assert.match(read('public/js/deckview-panels.js'), /const DB_LEFT_TABS = \['search', 'edhrec', 'lands'\]/);
});

test('cards laid from the drawer tuck nothing away: not the drawer’s panel, and not a panel under it', () => {
  const auto = o => app.sandbox.tableShouldAutoTuck({ kind: 'float', tab: 'deckview', tucked: false, actedAgo: 100, ...o });
  assert.strictEqual(auto({}), true, 'a page floating over the table still tucks for what the user did in it');
  assert.strictEqual(auto({ drawer: true }), false, 'not while the drawer lies over the table');
  assert.strictEqual(auto({ kind: 'drawer' }), false, 'and the drawer’s own panel never');
  assert.strictEqual(auto({ kind: 'drawer', drawer: true, tab: 'scryfall' }), false);
});

test('the drawer’s panel is docked clear of the left edge’s tabs, narrow, and above a tucked bar', () => {
  const box = (view, clear) => plain(app.sandbox.tableDrawerBox(view, { top: 0, left: 0, right: view.width, bottom: 0, ...clear }, 12));
  const wide = box({ width: 1440, height: 900 }, { left: 230 });
  assert.ok(wide.width >= 420 && wide.width <= 520, `${wide.width} wide`);
  assert.strictEqual(wide.left, 242, 'a gap right of the tabs and the room their labels open into');
  assert.strictEqual(wide.top, 12);
  assert.strictEqual(wide.height, 900 - 24);
  assert.ok(wide.left + wide.width < 1440 / 2 + 100, 'most of the table stays in view beside it');
  assert.strictEqual(box({ width: 2560, height: 1440 }, { left: 200 }).width, 520, 'never wider than its ceiling');
  assert.strictEqual(box({ width: 1000, height: 800 }, { left: 200 }).width, 420, 'nor narrower than its floor');
  const tucked = box({ width: 1440, height: 900 }, { left: 230, bottom: 60 });
  assert.strictEqual(tucked.height, 900 - 24 - 60, 'a tucked panel’s bar at the foot is left uncovered');
  const below = box({ width: 1440, height: 900 }, { left: 230, top: 88 });
  assert.strictEqual(below.top, 100, 'hung below the far rim, so the slider, the slip and the chips stay in reach');
  assert.strictEqual(below.height, 900 - 100 - 12);
  const tiny = box({ width: 400, height: 300 }, { left: 300 });
  assert.ok(tiny.left >= 12 && tiny.left + tiny.width <= 400 - 12 + 1e-9, 'kept inside a window too narrow for it');
});

test('Escape in the drawer’s search field with a query in it is the field’s, and anywhere else puts the drawer away', () => {
  const t = loadTableMode();
  const sb = t.sandbox;
  t.evaluate('tableEls = { drawerHost: { contains: el => !!el && el.inDrawer } }');
  const field = (value, o = {}) => ({ tagName: 'INPUT', type: 'text', value, inDrawer: true, ...o });
  assert.strictEqual(sb.tableDrawerKeepsEscape(field('t:goblin')), false, 'no drawer out, nothing of its own');
  t.evaluate('tableDrawer = { tab: "search" }');
  assert.strictEqual(sb.tableDrawerKeepsEscape(field('t:goblin')), true, 'a query typed: the field’s');
  assert.strictEqual(sb.tableDrawerKeepsEscape(field('   ')), false, 'nothing typed: the drawer goes');
  assert.strictEqual(sb.tableDrawerKeepsEscape(field('x', { inDrawer: false })), false, 'a field elsewhere is not the drawer’s');
  assert.strictEqual(sb.tableDrawerKeepsEscape({ tagName: 'BUTTON', inDrawer: true }), false, 'a button in it: the drawer goes');
  assert.strictEqual(sb.tableDrawerKeepsEscape(field('x', { type: 'checkbox' })), false);
});

test('Add one goes through the builder’s own stepper, says what it did, and is never offered for a commander', () => {
  const sb = app.sandbox;
  const acts = o => plain(sb.tableLookActions({ toolsOn: true, ref: 'main/Forest', ...o }));
  assert.deepStrictEqual(acts({}), { remove: true, add: true });
  assert.deepStrictEqual(acts({ ref: 'maybe/Forest' }), { remove: true, add: true }, 'a card on any other board too');
  assert.deepStrictEqual(acts({ ref: 'commander/Atraxa' }), { remove: true, add: false },
    'the builder offers no second copy of a commander');
  assert.deepStrictEqual(acts({ toolsOn: false }), { remove: false, add: false }, 'nothing for a deck the user may not edit');
  assert.deepStrictEqual(acts({ ref: null }), { remove: false, add: false }, 'nor for a card that is not the deck’s');

  const calls = [];
  const deck = new Map([['main/Forest', { qty: 3 }], ['main/Sol Ring', { qty: 1 }], ['commander/Atraxa', { qty: 1 }], ['main/Stuck', { qty: 2 }]]);
  const globals = {
    dbFindCard: ref => deck.get(ref),
    dbChangeQty: (ref, d) => { calls.push(['qty', ref, d]); if (ref !== 'main/Stuck') deck.get(ref).qty += d; },
    dbRemoveCard: ref => calls.push(['remove', ref]),
    showToast: text => calls.push(['toast', text]),
  };
  const before = new Map(Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(sb, k)]));
  Object.assign(sb, globals);
  try {
    app.evaluate('tableToolsOn = true');
    assert.strictEqual(sb.tableAddOne({ name: 'Forest', ref: 'main/Forest' }), 'more');
    assert.strictEqual(sb.tableAddOne({ name: 'Sol Ring', ref: 'main/Sol Ring' }), 'more');
    assert.strictEqual(sb.tableAddOne({ name: 'Atraxa', ref: 'commander/Atraxa' }), null, 'not the commander');
    assert.strictEqual(sb.tableAddOne({ name: 'Gone', ref: 'main/Gone' }), null, 'nor a card the deck no longer holds');
    assert.strictEqual(sb.tableAddOne({ name: 'Plains' }), null);
    assert.strictEqual(sb.tableAddOne({ name: 'Stuck', ref: 'main/Stuck' }), null, 'an add the builder refused says nothing');
    assert.deepStrictEqual(plain(calls), [
      ['qty', 'main/Forest', 1], ['toast', '✓  Added one "Forest", 4 in the deck'],
      ['qty', 'main/Sol Ring', 1], ['toast', '✓  Added one "Sol Ring", 2 in the deck'],
      ['qty', 'main/Stuck', 1],
    ]);
    assert.strictEqual(deck.get('main/Forest').qty, 4);
    app.evaluate('tableToolsOn = false');
    assert.strictEqual(sb.tableAddOne({ name: 'Forest', ref: 'main/Forest' }), null, 'nothing for a deck the user may not edit');
  } finally {
    app.evaluate('tableToolsOn = false');
    for (const [k, d] of before) { if (d) Object.defineProperty(sb, k, d); else delete sb[k]; }
  }
});

test('a card’s right-click menu offers looking at it everywhere, and the deck’s edits only on a deck the user may edit', () => {
  const sb = app.sandbox;
  const acts = o => plain(sb.tableCardMenuItems(o)).map(i => i.act);
  assert.deepStrictEqual(acts({}), ['look', 'details'], 'any tab’s card');
  assert.deepStrictEqual(acts({ canLook: false }), ['details'], 'nothing to pick up without a picture');
  assert.deepStrictEqual(acts({ opens: true }), ['open'], 'a deck on the Decks tab opens');
  assert.deepStrictEqual(acts({ toolsOn: true, ref: 'main/Forest' }),
    ['look', 'details', 'step', 'commander', 'remove']);
  assert.deepStrictEqual(acts({ toolsOn: true, ref: 'main/Forest', commanders: 1 }),
    ['look', 'details', 'step', 'commander', 'partner', 'remove'], 'a partner only beside one commander');
  assert.deepStrictEqual(acts({ toolsOn: true, ref: 'main/Forest', commanders: 2 }),
    ['look', 'details', 'step', 'commander', 'remove'], 'never a third');
  assert.deepStrictEqual(acts({ toolsOn: true, ref: 'commander/Atraxa', commanders: 1 }),
    ['look', 'details', 'remove'], 'a commander has no stepper and is already the commander');
  assert.deepStrictEqual(acts({ toolsOn: false, ref: 'main/Forest' }), ['look', 'details'],
    'nothing to change on a deck the user may not edit');
  const step = plain(sb.tableCardMenuItems({ toolsOn: true, ref: 'main/Forest', qty: 3 })).find(i => i.act === 'step');
  assert.strictEqual(step.qty, 3);
});

test('the menu is wired to the table: opened by a right-click on a card, closed by Escape, the wheel and another tab', () => {
  const js = read('public/js/tablemode.js');
  const fn = name => js.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
  assert.match(fn('tableBuild'), /scene\.addEventListener\('contextmenu', tableOnContextMenu\)/);
  assert.match(fn('tableBuild'), /menu\.addEventListener\('click', tableMenuAct\)/);
  assert.match(fn('tableListen'), /\('pointerdown', tableOnMenuDown, true\)/, 'a press outside it puts it away');
  assert.match(fn('tableOnKeyCapture'), /if \(tableMenu\) \{ tableMenuClose\(\); tableEscTaken = true; return; \}/);
  assert.match(fn('tableOnWheel'), /tableMenuClose\(\)/);
  assert.match(fn('tableModeBeforeTab'), /tableMenuClose\(\)/);
  assert.match(fn('tableModeLeave'), /tableMenuClose\(\)/);
  assert.match(fn('tableModeLeave'), /tableEls\.menu,/, 'and its element goes with the scene');
});

test('opening another tab zooms the table back out, and the same tab leaves the zoom alone', () => {
  const t = loadTableMode();
  assert.strictEqual(t.evaluate(`tableZoomsOutFor('deckview', 'card')`), true);
  assert.strictEqual(t.evaluate(`tableZoomsOutFor(null, 'sets')`), true);
  assert.strictEqual(t.evaluate(`tableZoomsOutFor('deckview', 'deckview')`), false);
  assert.strictEqual(t.evaluate(`tableZoomsOutFor('deckview', null)`), false);
  t.evaluate(`
    tableOn = true;
    tablePanel = { tab: 'deckview', kind: 'float' };
    tableShowPane = () => true;
    tableTo = { zoom: 2, leanX: 0, leanY: 0 };
    tableAnchor = { x: 10, y: 10 };
    tableModeBeforeTab('deckview');
  `);
  assert.strictEqual(t.evaluate('tableTo.zoom'), 2, 'the tab already showing keeps its zoom');
  t.evaluate(`tableModeBeforeTab('card')`);
  assert.strictEqual(t.evaluate('tableTo.zoom'), 1, 'another tab is seen whole');
  assert.strictEqual(t.evaluate('tableAnchor'), null, 'about the window’s middle');
});

test('the slider’s own input is left to it, and the drawer is lent rather than copied', () => {
  const js = read('public/js/tablemode.js');
  const fn = name => js.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
  assert.match(fn('tableOnWheel'), /closest\?\.\('\.table-scale'\)\) return;/, 'the wheel over it zooms nothing');
  assert.ok(fn('tableOnWheel').indexOf('preventDefault') < fn('tableOnWheel').indexOf("'.table-scale'"),
    'and does nothing else either');
  assert.match(fn('tableZoomKey'), /closest\?\.\('\.table-scale'\)\) return false;/, '− + 0 are its own while it has the focus');
  assert.match(fn('tableOnPointerMove'), /if \(!tableScaleHeld\) tableAim/, 'the camera does not follow a hand on it');
  assert.match(fn('tableScaleBuild'), /addEventListener\('pointerdown', e => \{\s*e\.stopPropagation\(\);/,
    'a press on it picks nothing up off the mat');
  assert.match(fn('tableSetCardScale'), /requestAnimationFrame/, 'resized once a frame however many inputs');
  assert.ok(!/tableDrawCards|tableCardEl/.test(fn('tableRescaleCards')), 'and resized in place, never made again');

  assert.match(fn('tableDrawerOpen'), /getElementById\('dbSearchPanel'\)/);
  assert.match(fn('tableDrawerOpen'), /createComment\(/, 'its place in the page held, as a pane’s is');
  assert.ok(!/cloneNode/.test(fn('tableDrawerOpen')), 'never cloned');
  assert.match(fn('tableDrawerOpen'), /dbSetLeftTab\(tab\)/, 'switched by the builder’s own call');
  assert.match(fn('tableDrawerClose'), /insertBefore\(d\.el, d\.mark\)/, 'and put back where it came from');
  const css = read('public/css/table.css');
  assert.match(css, /html\[data-tablemode\] \.table-drawer > \.db-drawer \{[^}]*position: static;[^}]*transform: none;/,
    'the builder’s fixed, slid-away drawer simply fills its host on the table');
  for (const rule of ['.table-scale', '.table-scale[hidden]', '.table-drawer-chips', '.table-drawer[hidden]', '.table-look-add[hidden]', '.table-far-left', '.table-far-right']) {
    assert.ok(css.includes(rule), `table.css has no ${rule}`);
  }
});
