// ── Table mode ────────────────────────────────────────────────────────────
// An experiment, and an opt-in one: the whole app as a table seen from a seat.
// The user's playmat lies in the middle of it, framed by a wooden rim, and the
// table is tilted away from the viewer the way a table is when you sit at it.
// The tabs are no longer a sidebar. They are physical tabs standing on the rim,
// and pressing one lifts that tab's page up off the table to be read.
//
// Nothing about the app changes underneath. A tab's page is the same element it
// always was — the #tab-… pane setTab() shows — and table mode only *moves* it:
// into a panel while it is open, and back to exactly where it came from when it
// is closed or the mode is switched off. It is never cloned, so every handler,
// every input's half-typed value and every piece of state on it keeps working,
// and every renderer runs unchanged, because the only way a tab is opened here
// is by calling setTab() like the sidebar does.
//
// ── The switch ────────────────────────────────────────────────────────────
// A checkbox in the Appearance popover, kept per browser rather than per
// person (mtgtools_tablemode) — like the playmat's phone switch, it is a
// statement about this machine: a perspective scene is a desktop thing. It is
// honoured only at the desktop width and with a pointer that hovers, the query
// in tableModeQuery(), and the row that offers it hides itself everywhere else
// (table.css). The stored answer outlives a narrow window: shrink one below the
// breakpoint and the table folds away, widen it and the table comes back.
//
// The mode is one attribute on <html>, data-tablemode, and every rule in
// table.css hangs off it. Switching it on builds the scene; switching it off
// takes the scene down, puts every pane home and removes every listener this
// file added for it — the one listener left is the media query's, which is
// what lets the mode return when the window allows it again.
//
// ── The scene ─────────────────────────────────────────────────────────────
//
//   .table-scene   fixed, full-viewport, the perspective (table.css: 1400px)
//     .table-plane the table: wood, a grid of rim / mat / rim, preserve-3d.
//                  Its transform is written here, every frame it moves.
//       .table-rim   the four edges; the tabs stand on three of them
//       .table-mat   the playmat (or the theme's felt), where cards lie
//   .table-dim     the slight veil over the table while a panel floats
//   .table-panel   the panel host — see "Panels" below
//   .table-look    a card picked up to be looked at, facing the viewer
//
// The dim, the floating panel and the card being looked at are siblings of the
// scene rather than children of it, on purpose. The scene is position: fixed,
// so it is a stacking context of its own, and the plane is transformed, so it
// is a containing block for anything fixed inside it. A pane carried into
// either would take its drawers with it — Collections' Add drawer and the
// Deck Builder's stats bar are position: fixed, and a fixed element inside a
// transformed one is pinned to that element instead of to the window. The
// floating panel is position: absolute with no z-index and no transform at
// rest, which makes it neither, so a drawer opened from inside it still lands
// on the window's right edge above its scrim, as it does in the page.
//
// ── Looking around ───────────────────────────────────────────────────────
// Where the pointer is over the window moves the view a little — a few degrees
// of tilt and turn and a small sideways shift, as if leaning your head. The
// pointer only sets where the view is *going* (tableLookTarget); a frame loop
// eases the view towards it (tableLookStep) and stops itself when it arrives,
// so a pointer resting still costs nothing. No CSS transition is involved: a
// transition restarted on every pointer move never gets to finish. When cards
// may not move — the "Cards move" switch, or an operating system asking for
// less motion, both answered by cardMotionOn() — the table holds its rest tilt.
//
// ── From the screen to the mat ───────────────────────────────────────────
// A card is dragged in the table's plane, not the screen's: it has to stay
// under the pointer while the table is tilted, foreshortened and moving. So
// the pointer's screen point is mapped back onto the mat.
//
// tablePlaneMatrix() composes the 4×4 matrix the browser itself composes for a
// point on the mat — the scene's perspective about its origin, the plane's
// place and its transform about its own origin, the mat's place in the plane —
// from the untransformed geometry (offsetLeft and friends, which no transform
// touches) and the view's current angles. For points on a plane at height z in
// the mat's own coordinates, dropping that matrix's third column (folded into
// the fourth at z) and its third row leaves a 3×3 homography from mat to
// screen; tableUnproject() inverts it. That is the ray–plane intersection in
// closed form, exact under perspective, and the same for a card lying on the
// mat (z ≈ 0) as for one held 60px above it — which is what keeps a lifted
// card under the pointer rather than under where the pointer would be on the
// felt.
//
// ── Panels ────────────────────────────────────────────────────────────────
// One host, two kinds, chosen per tab by TABLE_PANEL_KINDS:
//
//   float  lifted off the table and facing the viewer, flat and readable,
//          scrolling inside; the table dims a little behind it. Every tab
//          but the Card tab, in this first half of the work. It is fitted
//          clear of the tabs standing on the rim (tableFloatBox), because a
//          tab has to stay pressable while its page floats: pressed again it
//          puts the page down, and any other tab swaps it.
//   grow   unfolding from the tab's edge and lying ON the mat, in the tilted
//          plane — for content that belongs on the table. The Card tab.
//          Being inside the plane, it is inside a transformed element: a
//          pane that opens drawers or carries cards by hand (carddrag.js
//          measures the page in screen pixels) should float, not grow.
//
// Close button, Escape, and pressing the open tab again all close it. Escape
// is only taken when nothing else on the page wanted it: a dialog, a drawer, a
// menu or the RSS panel open at the time of the key press each keep it.
//
// ── Cards ─────────────────────────────────────────────────────────────────
// tableMode.layCards() lays a list of cards flat on the mat in tidy fanned
// piles (tableLayout). Press and drag one and it comes up off the felt, leans
// towards you and follows the pointer in the table's plane; let go and it
// settles where it was put down. Press without moving (tableIsDrag: under 5px)
// and it is picked up to be looked at: it rises to face you, large, over the
// table, and a click or Escape puts it back. Where a hand put a card is kept
// for the session and for nothing longer.
//
// Until the next half of this work gives each tab its own cards, entering the
// mode lays the first cards of the first collection there is, as a stand-in.
//
// ── For the next half: the API ────────────────────────────────────────────
//
//   tableMode.isOn()                         → boolean
//   tableMode.openPanel(tab, { kind })       → boolean. kind: 'float' | 'grow',
//                                              default kindFor(tab). Calls
//                                              setTab(tab) once the pane is in
//                                              the panel, so its init draws into
//                                              a box it can measure.
//   tableMode.closePanel()                   → puts the pane home
//   tableMode.panel()                        → { tab, kind } | null
//   tableMode.kindFor(tab)                   → 'float' | 'grow'
//   tableMode.layCards(cards, { hint })      → how many were laid (≤ 60).
//                                              cards: [{ name, imageUrl, id?,
//                                              group? }]; hint: what the mat says
//                                              when the list is empty
//   tableMode.cards()                        → [{ key, name, x, y, turn }],
//                                              x/y as fractions of the mat
//
//   document 'tablemode:tab'     after every setTab() while the mode is on,
//                                detail { tab, kind } — kind null if the tab
//                                opened no panel
//   document 'tablemode:change'  on entering and leaving, detail { on }
//
// main.js calls three hooks: tableModeBeforeTab() at the top of setTab() — so a
// tab opened from anywhere (a deck tile, the back button, a deep link) lands in
// a panel before its init runs — tableModeAfterTab() at the end of it, and
// tableModeStateLoaded() once the first state has arrived.
//
// The decisions are written as functions of their inputs and asserted in
// test/tablemode.test.js: the panel kind per tab, the drag threshold, the
// pointer-to-view mapping and its easing, the screen-to-mat mapping, the
// floating panel's box and the layout.

// ── Constants ─────────────────────────────────────────────────────────────

/* The browser's copy of the switch: '1' when on, nothing when off. */
const TABLE_MODE_KEY = 'mtgtools_tablemode';

/* How far the table leans away from the viewer at rest, in degrees. table.css
 * reads it too, as --table-tilt, so the tabs standing on the rim can be stood
 * square to the eye by the same number. */
const TABLE_TILT_REST = 24;

/* How far looking around may move the view: degrees of tilt (rotateX) either
 * side of rest, degrees of turn (rotateY), and the sideways and up-and-down
 * shift as a fraction of the window — under the 2% that still reads as a head
 * moving rather than the table sliding. */
const TABLE_LOOK_TILT  = 3;
const TABLE_LOOK_TURN  = 4;
const TABLE_LOOK_SHIFT = 0.015;

/* How much of the way to the target the view closes in a sixtieth of a
 * second — a frame on an ordinary screen; a faster screen closes less per
 * frame and a slower one more, by tableEaseFor(), so the view takes the same
 * time to arrive at any refresh rate. And how near counts as there: under a
 * hundredth of a degree and a tenth of a pixel the frame loop has nothing
 * left to draw and stops. */
const TABLE_FRAME_MS     = 1000 / 60;
const TABLE_LOOK_EASE    = 0.12;
const TABLE_SETTLED_DEG  = 0.01;
const TABLE_SETTLED_PX   = 0.1;
const TABLE_LOOK_KEYS    = ['rx', 'ry', 'tx', 'ty'];
const TABLE_REST = Object.freeze({ rx: TABLE_TILT_REST, ry: 0, tx: 0, ty: 0 });

/* A press that moves less than this, in screen pixels, is a click: the card is
 * picked up to look at rather than carried. Five is what a hand wobbles by. */
const TABLE_DRAG_START = 5;

/* A card in hand: how high it comes off the felt, in the mat's own pixels; how
 * far it leans back towards the viewer once it is there, in degrees; and how
 * much of the way up it gets in a sixtieth of a second. */
const TABLE_CARD_LIFT  = 60;
const TABLE_CARD_LEAN  = 12;
const TABLE_LIFT_EASE  = 0.25;

/* How far apart, in z, two cards lying on each other are. Cards share one
 * plane, and coplanar faces in a 3D scene are a coin toss for which is drawn on
 * top — so each lies a hair above the one under it. A quarter of a pixel each
 * is sixty cards in fifteen pixels, nothing an eye sees as height. */
const TABLE_CARD_GAP = 0.25;

/* The most cards the mat draws at once. Each one is a picture in a 3D scene,
 * which costs more to composite than a picture in a grid. */
const TABLE_CARDS_MAX = 60;

/* A card on the mat, sized against the mat: a real playmat is about ten cards
 * wide. Bounded, so a small window still draws a card you can see and a huge
 * one does not draw a card the size of a hand. 88/63 is a card's own shape. */
const TABLE_CARD_SHARE = 0.1;
const TABLE_CARD_MIN_W = 72;
const TABLE_CARD_MAX_W = 150;
const TABLE_CARD_RATIO = 88 / 63;

/* The fans the layout draws. A pile's slot is about this many times as wide as
 * it is tall, because a fan spreads sideways. The step between two cards in a
 * fan is at most TABLE_FAN_MAX of a card's width and at least TABLE_FAN_MIN
 * before the fan breaks onto another row; a row under it sits TABLE_FAN_ROW of
 * a card's height lower. The ends of a fan turn out by TABLE_FAN_TURN degrees
 * and drop by TABLE_FAN_ARC of a card's height, the shape a hand spreads. */
const TABLE_SLOT_ASPECT = 2;
const TABLE_FAN_MAX  = 0.55;
const TABLE_FAN_MIN  = 0.22;
const TABLE_FAN_ROW  = 0.32;
const TABLE_FAN_TURN = 5;
const TABLE_FAN_ARC  = 0.06;

/* A floating panel's ceiling — min(900px, 70vw) wide and 80vh tall — and
 * its floor, the narrowest a tab's page is still worth reading in, which wins
 * over keeping the side tabs clear on a window too narrow for both. The gap is
 * what is left between the panel and the tabs it keeps clear of. */
const TABLE_PANEL_MAX_W  = 900;
const TABLE_PANEL_MAX_VW = 0.7;
const TABLE_PANEL_MAX_VH = 0.8;
const TABLE_PANEL_MIN_W  = 560;
const TABLE_PANEL_GAP    = 12;

/* What the mat says when there is nothing on it. */
const TABLE_HINT = 'Choose a tab from the rim';

/* Which kind of panel a tab opens. Anything not named floats. */
const TABLE_PANEL_KINDS = Object.freeze({ card: 'grow' });

/* The tabs on the rim, edge by edge, in the order they stand. A tab entry is a
 * pane setTab() can show; an `act` entry does something else. Each names the
 * sidebar button it stands for (`nav`, or tab-btn-<tab>), which is where its
 * label and its icon are read from and whose visibility it follows — the Admin
 * tab, Sign out and Change password stand on the rim only when the sidebar
 * would show them. The one with no sidebar button carries its own label. */
const TABLE_RIM = [
  { edge: 'far',   tab: 'collections' },
  { edge: 'far',   tab: 'players' },
  { edge: 'far',   tab: 'deckview' },
  { edge: 'far',   tab: 'scryfall' },
  { edge: 'far',   tab: 'sets' },
  { edge: 'far',   tab: 'wants' },
  { edge: 'left',  tab: 'available' },
  { edge: 'left',  tab: 'pick' },
  { edge: 'left',  tab: 'lands' },
  { edge: 'left',  tab: 'card' },
  { edge: 'right', act: 'appearance', nav: 'sidenavAppearanceBtn' },
  { edge: 'right', act: 'rss',        nav: 'sidenavRssBtn' },
  { edge: 'right', tab: 'admin' },
  { edge: 'right', act: 'password',   nav: 'sidenavChangePwBtn' },
  { edge: 'right', act: 'signout',    nav: 'sidenavLogoutBtn' },
  { edge: 'right', act: 'leave',      label: 'Leave table' },
];

// ── The decisions ─────────────────────────────────────────────────────────

/* Which kind of panel a tab's page opens in. */
function tablePanelKind(tab) {
  return Object.prototype.hasOwnProperty.call(TABLE_PANEL_KINDS, tab) ? TABLE_PANEL_KINDS[tab] : 'float';
}

/* Whether a press has become a drag: the pointer has travelled at least the
 * threshold from where it went down, in any direction. Distance rather than
 * either axis alone, so a diagonal wobble counts the same as a straight one. */
function tableIsDrag(dx, dy, threshold = TABLE_DRAG_START) {
  return Math.hypot(Number(dx) || 0, Number(dy) || 0) >= threshold;
}

/* Where the view wants to be for a pointer at (x, y) in a window of the given
 * size: rx the tilt and ry the turn, in degrees, tx/ty the shift in pixels.
 *
 * The pointer's place is a fraction running -1 to 1 across and down the
 * window, clamped, so the answer is bounded whatever it is asked. Pointing to
 * the right is leaning to the right: you see the table from further round that
 * way, so its right side comes towards you (a negative rotateY) and the whole
 * of it slides the other way. Pointing up is leaning over the table and
 * looking down onto it, which tilts it less; pointing down is sitting back. */
function tableLookTarget(x, y, width, height) {
  const fraction = (along, size) =>
    (size > 0 ? Math.min(1, Math.max(-1, (Number(along) || 0) / size * 2 - 1)) : 0);
  const across = fraction(x, width);
  const down   = fraction(y, height);
  /* `|| 0` is the sign of nothing: the middle of the window would otherwise
   * answer -0, the same place written as a different number. */
  return {
    rx: TABLE_TILT_REST + down * TABLE_LOOK_TILT,
    ry: -across * TABLE_LOOK_TURN || 0,
    tx: (width  > 0 ? -across * TABLE_LOOK_SHIFT * width  : 0) || 0,
    ty: (height > 0 ? -down   * TABLE_LOOK_SHIFT * height : 0) || 0,
  };
}

/* One frame of the view easing towards its target: each of the four closes the
 * same fraction of its gap, and one already within reach of its target snaps
 * to it. `settled` is true when all four have arrived, which is what stops the
 * frame loop. */
function tableLookStep(at, to, ease = TABLE_LOOK_EASE) {
  const next = {};
  let settled = true;
  for (const key of TABLE_LOOK_KEYS) {
    const gap   = to[key] - at[key];
    const reach = key === 'tx' || key === 'ty' ? TABLE_SETTLED_PX : TABLE_SETTLED_DEG;
    if (Math.abs(gap) <= reach) { next[key] = to[key]; continue; }
    next[key] = at[key] + gap * ease;
    settled = false;
  }
  return { at: next, settled };
}

/* The share of the gap to close in a frame `dt` milliseconds long, for an
 * easing that closes `ease` of it in a sixtieth of a second. Compounded, not
 * scaled: two short frames close exactly what one long one does. A frame is
 * held to a tenth of a second, so a tab coming back from the background does
 * not land the view in a single jump. */
function tableEaseFor(dt, ease) {
  const frames = Math.min(100, Math.max(0, Number(dt) || 0)) / TABLE_FRAME_MS;
  return 1 - Math.pow(1 - ease, frames);
}

/* Where a floating panel goes in a window of `view` = { width, height }.
 *
 * As large as its ceiling allows, but clear of the tabs standing on the rim —
 * `clear` = { top, left, right }: the lowest edge of the far edge's tabs, the
 * rightmost edge of the left edge's and the leftmost of the right edge's, in
 * window pixels — so that every tab can still be pressed while the panel
 * floats, the open one to put it down and any other to swap it. It hangs
 * below the far tabs and is centred between the side ones. Where the side
 * tabs leave less room than TABLE_PANEL_MIN_W, the floor wins and the panel
 * reaches over their inner ends: a tab half covered can still be pressed by
 * the half that is not. */
function tableFloatBox(view, clear, gap = TABLE_PANEL_GAP) {
  const room  = Math.max(0, clear.right - clear.left - 2 * gap);
  const floor = Math.min(TABLE_PANEL_MIN_W, Math.max(0, view.width - 2 * gap));
  const width = Math.min(TABLE_PANEL_MAX_W, view.width * TABLE_PANEL_MAX_VW, Math.max(room, floor));
  const top   = Math.max(gap, clear.top + gap);
  const height = Math.max(0, Math.min(view.height * TABLE_PANEL_MAX_VH, view.height - top - gap));
  const centre = clear.right > clear.left ? (clear.left + clear.right) / 2 : view.width / 2;
  const left  = Math.min(Math.max(gap, centre - width / 2), Math.max(gap, view.width - gap - width));
  return { left, top, width, height };
}

/* ── 4×4 matrices ──
 * Row-major, m[row * 4 + column], acting on column vectors — the convention
 * CSS's own matrices are written in, so each one below reads like the CSS
 * function it stands for. */
const TABLE_RAD = Math.PI / 180;

function tableMul(a, b) {
  const out = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

function tableTranslate(x, y, z = 0) {
  return [1, 0, 0, x,  0, 1, 0, y,  0, 0, 1, z,  0, 0, 0, 1];
}

function tableRotateX(deg) {
  const c = Math.cos(deg * TABLE_RAD), s = Math.sin(deg * TABLE_RAD);
  return [1, 0, 0, 0,  0, c, -s, 0,  0, s, c, 0,  0, 0, 0, 1];
}

function tableRotateY(deg) {
  const c = Math.cos(deg * TABLE_RAD), s = Math.sin(deg * TABLE_RAD);
  return [c, 0, s, 0,  0, 1, 0, 0,  -s, 0, c, 0,  0, 0, 0, 1];
}

/* CSS's perspective(d). An infinite distance is no perspective at all. */
function tablePerspective(d) {
  const w = d > 0 && Number.isFinite(d) ? -1 / d : 0;
  return [1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0, 0, w, 1];
}

/* The matrix taking a point on the mat — in the mat's own pixels, from its
 * top-left inner corner — to the window, composed the way the browser composes
 * it for the mat's children:
 *
 *   the scene's perspective, about the scene's perspective-origin
 *   · the plane's place in the scene, and its transform about its own origin
 *   · the mat's place in the plane
 *
 *   geometry = {
 *     perspective,              the scene's, in px (Infinity for none)
 *     origin:  { x, y },        the scene's perspective-origin, px
 *     plane:   { left, top,     the plane's untransformed box in the scene
 *                origin: {x,y} } and its transform-origin within it
 *     mat:     { left, top },   the mat's content box within the plane's box
 *     look:    { rx, ry, tx, ty } the plane's transform, as tablePlaneTransform
 *   }
 *
 * The scene is fixed at the window's corner, so the scene's pixels are the
 * window's. */
function tablePlaneMatrix({ perspective, origin, plane, mat, look }) {
  return [
    tableTranslate(origin.x, origin.y),
    tablePerspective(perspective),
    tableTranslate(-origin.x, -origin.y),
    tableTranslate(plane.left + plane.origin.x, plane.top + plane.origin.y),
    tableTranslate(look.tx, look.ty),
    tableRotateY(look.ry),
    tableRotateX(look.rx),
    tableTranslate(-plane.origin.x, -plane.origin.y),
    tableTranslate(mat.left, mat.top),
  ].reduce(tableMul);
}

/* The CSS for the same transform, written in the same order — so the matrix
 * above and what the browser draws are one statement read two ways. */
function tablePlaneTransform({ rx, ry, tx, ty }) {
  return `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) ` +
         `rotateY(${ry.toFixed(3)}deg) rotateX(${rx.toFixed(3)}deg)`;
}

/* Where a point (u, v) on the mat, z pixels above it, lands in the window.
 * Null for a point behind the eye, which has nowhere to land. */
function tableProject(m, u, v, z = 0) {
  const x = m[0]  * u + m[1]  * v + m[2]  * z + m[3];
  const y = m[4]  * u + m[5]  * v + m[6]  * z + m[7];
  const w = m[12] * u + m[13] * v + m[14] * z + m[15];
  return w > 0 ? { x: x / w, y: y / w } : null;
}

/* The inverse: which point on the mat, at height z above it, is under the
 * window point (x, y). For points of one plane the 4×4 above collapses to a
 * 3×3 homography — the u, v and constant columns, the x, y and w rows, with z
 * folded into the constant — and a homography inverts in closed form. Null
 * when the ray runs parallel to the plane, or meets it behind the eye. */
function tableUnproject(m, x, y, z = 0) {
  const a = m[0],  b = m[1],  c = m[2]  * z + m[3];
  const d = m[4],  e = m[5],  f = m[6]  * z + m[7];
  const g = m[12], h = m[13], i = m[14] * z + m[15];

  /* The adjugate, written out. Its determinant would scale all three of
   * U, V and W alike, so it divides out and is only asked whether it is 0. */
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const D = c * h - b * i, E = a * i - c * g, F = b * g - a * h;
  const G = b * f - c * e, H = c * d - a * f, I = a * e - b * d;
  if (!(a * A + b * B + c * C)) return null;

  const U = A * x + D * y + G;
  const V = B * x + E * y + H;
  const W = C * x + F * y + I;
  if (!W) return null;
  const u = U / W, v = V / W;
  /* In front of the eye: the forward mapping's w for that point is positive. */
  if (!(g * u + h * v + i > 0)) return null;
  return { u, v };
}

/* A computed origin — perspective-origin, transform-origin — as two pixel
 * offsets. Browsers resolve both to pixels; a percentage is read against the
 * box in case one does not, and anything unreadable is the centre, which is
 * what both properties default to. */
function tableParseOrigin(value, width, height) {
  const parts = String(value || '').trim().split(/\s+/);
  const read = (part, size) => {
    if (part && part.endsWith('%')) return parseFloat(part) / 100 * size;
    const n = parseFloat(part);
    return Number.isFinite(n) ? n : size / 2;
  };
  return { x: read(parts[0], width), y: read(parts[1], height) };
}

/* How wide a card is drawn on a mat this wide. */
function tableCardWidth(matWidth) {
  const share = (Number(matWidth) || 0) * TABLE_CARD_SHARE;
  return Math.round(Math.min(TABLE_CARD_MAX_W, Math.max(TABLE_CARD_MIN_W, share)));
}

/* Where each card lies on a mat of the given size, as fractions of it: the
 * centre of each card, and the angle it lies at.
 *
 * Cards with the same `group` are one pile, and the piles are laid out in the
 * order their first card appears, in a grid of slots shaped for fans. Each
 * pile is a fan — the cards overlapping sideways, the ends turned out and
 * dropped a little — breaking onto further rows when a slot cannot hold it in
 * one. Every card keeps the angle its name gives it in a stack (stackJitter,
 * js/cardstack.js) on top of its place in the fan, so a card lies the same way
 * on the table as it does in a pile anywhere else in the app.
 *
 * At most TABLE_CARDS_MAX cards; a centre is kept far enough inside the mat
 * that the card does not hang off it. Returns the card's size in pixels too,
 * since that is decided here. */
function tableLayout(cards, width, height) {
  const list = (cards || []).slice(0, TABLE_CARDS_MAX);
  const w = tableCardWidth(width);
  const h = w * TABLE_CARD_RATIO;
  if (!list.length || !(width > 0) || !(height > 0)) {
    return { width: w, height: h, spots: list.map(() => ({ x: 0.5, y: 0.5, turn: 0 })) };
  }

  const piles = [];
  const byGroup = new Map();
  list.forEach((card, i) => {
    const key = card.group == null ? '' : String(card.group);
    if (!byGroup.has(key)) { byGroup.set(key, []); piles.push(byGroup.get(key)); }
    byGroup.get(key).push(i);
  });

  const cols  = Math.max(1, Math.min(piles.length,
    Math.round(Math.sqrt(piles.length * (width / height) / TABLE_SLOT_ASPECT)) || 1));
  const rows  = Math.ceil(piles.length / cols);
  const pad   = w * 0.35;
  const slotW = (width  - 2 * pad) / cols;
  const slotH = (height - 2 * pad) / rows;
  const room  = Math.max(0, slotW - w);
  const clamp = (n, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, n)));

  const spots = new Array(list.length);
  piles.forEach((pile, p) => {
    const left = pad + (p % cols) * slotW;
    const top  = pad + Math.floor(p / cols) * slotH;
    const count  = pile.length;
    const perRow = Math.max(1, Math.min(count, Math.floor(room / (w * TABLE_FAN_MIN)) + 1));
    const lines  = Math.ceil(count / perRow);
    const stepY  = lines > 1 ? Math.max(0, Math.min(h * TABLE_FAN_ROW, (slotH - h) / (lines - 1))) : 0;
    const blockH = h + stepY * (lines - 1);

    pile.forEach((index, j) => {
      const line   = Math.floor(j / perRow);
      const inLine = line < lines - 1 ? perRow : count - perRow * (lines - 1);
      const at     = j - line * perRow;
      const stepX  = inLine > 1 ? Math.min(w * TABLE_FAN_MAX, room / (inLine - 1)) : 0;
      const rowW   = w + stepX * (inLine - 1);
      const t      = inLine > 1 ? at / (inLine - 1) * 2 - 1 : 0;   // -1 … 1 along the fan
      const cx = left + (slotW - rowW) / 2 + w / 2 + at * stepX;
      const cy = top + (slotH - blockH) / 2 + h / 2 + line * stepY + t * t * h * TABLE_FAN_ARC;
      const turn = t * TABLE_FAN_TURN + (typeof stackJitter === 'function' ? stackJitter(list[index].name) : 0);
      spots[index] = {
        x: clamp(cx, w / 2, width  - w / 2) / width,
        y: clamp(cy, h / 2, height - h / 2) / height,
        turn: Math.round(turn * 10) / 10 || 0,
      };
    });
  });
  return { width: w, height: h, spots };
}

// ── The switch ────────────────────────────────────────────────────────────

/* Desktop only: the app's desktop breakpoint, and a pointer that hovers — the
 * whole interaction is pointing at a table, and a finger has no pointer to
 * lean with. BP_MD is js/state.js's, the same 900 the stylesheet's
 * (width >= 900px) says. */
function tableModeQuery() {
  return `(width >= ${typeof BP_MD === 'number' ? BP_MD : 900}px) and (hover: hover)`;
}

function tableModeAllowed() {
  try { return !!window.matchMedia && window.matchMedia(tableModeQuery()).matches; }
  catch { return false; }
}

/* The stored answer, guarded as playmat.js guards its own: storage can be
 * unreadable, and an experiment is not worth an exception. */
function readTableMode() {
  try { return localStorage.getItem(TABLE_MODE_KEY) === '1'; }
  catch { return false; }
}

function rememberTableMode(on) {
  try {
    if (on) localStorage.setItem(TABLE_MODE_KEY, '1');
    else    localStorage.removeItem(TABLE_MODE_KEY);
  } catch {}
}

/* The checkbox. It shows what was chosen; whether this window can honour it
 * is the row's own media query, which hides it where it cannot. */
function renderTableModeControl() {
  const toggle = document.getElementById('tableModeToggle');
  if (toggle) toggle.checked = readTableMode();
}

/* Make the page agree with the stored answer and the window. */
function tableModeSync() {
  const want = readTableMode() && tableModeAllowed();
  if (want && !tableOn) tableModeEnter();
  else if (!want && tableOn) tableModeLeave();
}

/* The checkbox's change, and the rim's Leave table. The popover is closed
 * either way: it was positioned against a button that is about to stop being
 * on the screen. */
function setTableMode(on) {
  rememberTableMode(!!on);
  if (typeof closeAppearance === 'function') closeAppearance();
  tableModeSync();
  renderTableModeControl();
}

// ── The scene ─────────────────────────────────────────────────────────────

let tableOn       = false;
let tableEls      = null;    // the elements this file put into the page
let tableGeom     = null;    // their untransformed geometry, see tableMeasure()
let tableAt       = { ...TABLE_REST };   // where the view is
let tableTo       = { ...TABLE_REST };   // where it is going
let tableFrameId  = 0;
let tableFrameAt  = 0;       // when the last frame ran, while frames are running
let tableResizeId = 0;
let tableWatch    = null;    // the observer keeping the rim in step with the sidebar
let tableScrollY  = 0;       // where the page was scrolled to before the table
let tableEscTaken = false;   // whether this Escape was somebody else's
let tablePanel    = null;    // { tab, kind, pane, mark } — the pane in the panel

let tableCards    = [];      // [{ key, name, imageUrl, group, x, y, turn, rank, el }]
let tableCardSize = { w: TABLE_CARD_MIN_W, h: TABLE_CARD_MIN_W * TABLE_CARD_RATIO };
let tablePlaced   = false;   // whether anything has laid cards yet
let tableHintText = TABLE_HINT;
const tableMoved  = new Map();   // card key → { x, y, turn }: where a hand put it
let tableHold     = null;    // the card under a pressed pointer
let tableSwallow  = false;   // the click a drag ends with is not a click
let tableLooked   = null;    // the card picked up to be looked at
let tableLookSeq  = 0;

/* The sidebar button a rim entry stands for. */
function tableNavId(entry) {
  return entry.nav || (entry.tab ? `tab-btn-${entry.tab}` : null);
}

/* A rim entry's words: the sidebar button's own label, so the rim and the
 * sidebar cannot come to call one tab two things. */
function tableRimLabel(entry) {
  const nav = document.getElementById(tableNavId(entry) || '');
  const text = nav?.querySelector('.tab-btn-label')?.textContent?.trim();
  return text || entry.label || entry.tab || '';
}

function tableRimEntry(tab) {
  return TABLE_RIM.find(entry => entry.tab === tab) || null;
}

/* The tabs standing on one edge. A tab carries data-tab, which is what gives
 * it its tab's accent (tokens.css, §3) for the state it marks; the Appearance
 * one carries .appearance-trigger, which is how main.js's outside-click
 * handler knows the click that opens the popover is not a click outside it. */
function tableRimHtml(edge) {
  return TABLE_RIM.map((entry, i) => {
    if (entry.edge !== edge) return '';
    const nav  = document.getElementById(tableNavId(entry) || '');
    const icon = nav?.querySelector('svg')?.outerHTML || '';
    const cls  = `table-tab${entry.act === 'appearance' ? ' appearance-trigger' : ''}`;
    const tab  = entry.tab ? ` data-tab="${entry.tab}"` : '';
    return `<button type="button" class="${cls}" data-rim="${i}"${tab}>` +
           `${icon}<span>${esc(tableRimLabel(entry))}</span></button>`;
  }).join('');
}

function tableBuild() {
  const body  = document.body;
  const scene = document.createElement('div');
  scene.className = 'table-scene';
  scene.id = 'tableScene';
  scene.style.setProperty('--table-tilt', `${TABLE_TILT_REST}deg`);
  scene.innerHTML = `
    <div class="table-plane" id="tablePlane">
      <div class="table-rim table-rim--far" role="group" aria-label="Tabs on the far edge">${tableRimHtml('far')}</div>
      <div class="table-rim table-rim--left" role="group" aria-label="Tabs on the left edge">${tableRimHtml('left')}</div>
      <div class="table-mat" id="tableMat">
        <p class="table-hint" id="tableHint" hidden></p>
      </div>
      <div class="table-rim table-rim--right" role="group" aria-label="Tabs on the right edge">${tableRimHtml('right')}</div>
      <div class="table-rim table-rim--near"></div>
    </div>`;

  const dim = document.createElement('div');
  dim.className = 'table-dim';
  dim.id = 'tableDim';

  /* The header is the drawer's, reused: a title and a ✕ over a body that
     scrolls is what a drawer already is, and the app has one look for it. */
  const panel = document.createElement('section');
  panel.className = 'table-panel';
  panel.id = 'tablePanel';
  panel.hidden = true;
  panel.tabIndex = -1;
  panel.setAttribute('aria-labelledby', 'tablePanelTitle');
  panel.innerHTML = `
    <div class="drawer-hdr">
      <span class="drawer-title" id="tablePanelTitle"></span>
      <button type="button" class="drawer-close" data-table-close title="Close" aria-label="Close">✕</button>
    </div>
    <div class="table-panel-body"></div>`;

  /* A button the size of the window: whatever is clicked while a card is
     being looked at puts it back, and Enter does from the keyboard. The image
     is the app's .card-img, so it wears a card's corner, edge and shadow — and
     takes no pointer of its own, so js/cardlift.js never finds it to lift. */
  const look = document.createElement('button');
  look.type = 'button';
  look.className = 'table-look';
  look.id = 'tableLook';
  look.hidden = true;
  look.innerHTML = '<img class="card-img table-look-card" alt="" draggable="false">';

  /* Straight after the page shell rather than at the end of the body, so the
     table comes first in the keyboard's order: what follows the shell is
     furniture that floats — the drawer scrim, the Appearance popover, the RSS
     panel, whose controls stay focusable while it is folded to no width — and
     a first Tab should land on the rim, not in a panel nobody can see. Every
     one of those carries a z-index of its own, so coming after them in the
     page buys the table nothing in the stacking order. */
  const shell = document.querySelector('.site-main');
  if (shell) shell.after(scene, dim, panel, look);
  else body.append(scene, dim, panel, look);

  tableEls = {
    scene, dim, panel, look,
    plane:      scene.querySelector('#tablePlane'),
    mat:        scene.querySelector('#tableMat'),
    hint:       scene.querySelector('#tableHint'),
    panelTitle: panel.querySelector('#tablePanelTitle'),
    panelBody:  panel.querySelector('.table-panel-body'),
    lookImg:    look.querySelector('img'),
  };

  /* Listeners on the elements go with them when the scene is taken down. */
  tableEls.plane.addEventListener('click', tableOnPlaneClick);
  tableEls.mat.addEventListener('pointerdown', tableOnCardDown);
  tableEls.mat.addEventListener('dragstart', e => e.preventDefault());
  panel.querySelector('[data-table-close]').addEventListener('click', () => tableClosePanel());
  look.addEventListener('click', () => tableLookAway());
}

/* The geometry the screen-to-mat mapping needs, read off the laid-out boxes
 * rather than the drawn ones: offsetLeft and its siblings are layout, which no
 * transform touches, so they say where the plane is before it is tilted. The
 * mat's content box is where its cards are placed from, so the plane's border
 * and the mat's own are counted in. */
function tableMeasure() {
  const { scene, plane, mat } = tableEls;
  const sceneStyle = getComputedStyle(scene);
  const planeStyle = getComputedStyle(plane);
  const depth = parseFloat(sceneStyle.perspective);
  tableGeom = {
    perspective: depth > 0 ? depth : Infinity,
    origin: tableParseOrigin(sceneStyle.perspectiveOrigin, scene.clientWidth, scene.clientHeight),
    plane: {
      left: plane.offsetLeft,
      top:  plane.offsetTop,
      origin: tableParseOrigin(planeStyle.transformOrigin, plane.offsetWidth, plane.offsetHeight),
    },
    mat: {
      left:   plane.clientLeft + mat.offsetLeft + mat.clientLeft,
      top:    plane.clientTop  + mat.offsetTop  + mat.clientTop,
      width:  mat.clientWidth,
      height: mat.clientHeight,
    },
  };
}

function tableMatrix() {
  return tablePlaneMatrix({ ...tableGeom, look: tableAt });
}

function tableKick() {
  if (!tableFrameId) tableFrameId = requestAnimationFrame(tableFrame);
}

/* One frame: the view closes on its target, and a card in hand is put back
 * under the pointer for wherever the view now is. The loop asks for another
 * frame only while something is still on its way. */
function tableFrame(now) {
  tableFrameId = 0;
  if (!tableOn) return;
  /* The first frame of a run is an ordinary one, however long the loop was
     asleep before it. */
  const dt = tableFrameAt ? now - tableFrameAt : TABLE_FRAME_MS;
  tableFrameAt = now;
  let more = false;
  if (cardMotionOn()) {
    const step = tableLookStep(tableAt, tableTo, tableEaseFor(dt, TABLE_LOOK_EASE));
    tableAt = step.at;
    more = !step.settled;
  } else {
    tableAt = { ...TABLE_REST };
    tableTo = { ...TABLE_REST };
  }
  tableEls.plane.style.transform = tablePlaneTransform(tableAt);
  if (tableHold?.dragging && tableCarry(dt)) more = true;
  if (more) tableKick();
  else tableFrameAt = 0;
}

/* The pointer, anywhere over the window: where the view is going, and where a
 * card in hand is. Read on every move rather than once, because "Cards move"
 * can be unticked while the table is up. */
function tableOnPointerMove(e) {
  if (e.pointerType === 'touch') return;
  tableTo = cardMotionOn()
    ? tableLookTarget(e.clientX, e.clientY, window.innerWidth, window.innerHeight)
    : { ...TABLE_REST };

  const hold = tableHold;
  if (hold && e.pointerId === hold.id) {
    hold.pointer = { x: e.clientX, y: e.clientY };
    if (!hold.dragging && tableIsDrag(e.clientX - hold.start.x, e.clientY - hold.start.y)) tableBeginCarry();
  }
  tableKick();
}

/* The pointer leaving the window altogether: sit back up. */
function tableOnPointerOut(e) {
  if (e.relatedTarget) return;
  tableTo = { ...TABLE_REST };
  tableKick();
}

/* A resize changes every size the scene is drawn in, so the geometry is read
 * again and the cards are redrawn from where they lie — their places are
 * fractions of the mat, so they keep them. Once per frame however many resize
 * events the window sends. */
function tableOnResize() {
  if (tableResizeId) return;
  tableResizeId = requestAnimationFrame(() => {
    tableResizeId = 0;
    if (!tableOn) return;
    tableMeasure();
    tableResizeCards();
    tableFitPanel();
    tableKick();
  });
}

/* Escape is the table's only when nothing else had a claim on it at the moment
 * it was pressed. Asked in the capture phase, before main.js's own Escape
 * handler has closed whatever drawer or menu it was for — by the time the key
 * reaches the bubble phase that evidence is gone. */
function tableOnKeyCapture(e) {
  if (e.key !== 'Escape') return;
  const dialog = (typeof modalIsOpen === 'function' && modalIsOpen())
              || (typeof faqIsOpen === 'function' && faqIsOpen());
  if (dialog) { tableEscTaken = true; return; }
  if (tableLooked) { tableEscTaken = false; return; }
  tableEscTaken = !!document.querySelector(
    '[data-drawer].open, .col-menu.open, .db-drawer-backdrop.open, .rss-panel.open');
}

function tableOnKey(e) {
  if (e.key !== 'Escape' || e.defaultPrevented || tableEscTaken) return;
  if (tableLooked) { tableLookAway(); return; }
  if (tablePanel) tableClosePanel();
}

/* The window losing the pointer mid-drag: the card is put down where it is. */
function tableOnBlur() {
  if (tableHold) tableRelease({ pointerId: tableHold.id });
}

function tableListen(on) {
  const method = on ? 'addEventListener' : 'removeEventListener';
  window[method]('pointermove', tableOnPointerMove, { passive: true });
  window[method]('pointerup', tableRelease);
  window[method]('pointercancel', tableRelease);
  window[method]('pointerout', tableOnPointerOut);
  window[method]('resize', tableOnResize);
  window[method]('keydown', tableOnKeyCapture, true);
  window[method]('keydown', tableOnKey);
  window[method]('blur', tableOnBlur);
}

/* The rim follows the sidebar: which of its tabs stand, from whether the
 * sidebar shows their button — auth.js decides that after the first paint, by
 * setting a style, so the buttons are watched rather than read once — and
 * which are open, from the panel, the RSS panel and the Appearance popover. */
function tableRimSync() {
  if (!tableEls) return;
  const rss  = document.getElementById('rssPanel');
  const menu = document.getElementById('appearanceMenu');
  for (const btn of tableEls.plane.querySelectorAll('.table-tab')) {
    const entry = TABLE_RIM[Number(btn.dataset.rim)];
    const nav = document.getElementById(tableNavId(entry) || '');
    btn.hidden = !!nav && nav.style.display === 'none';
    let open = null;
    if (entry.tab)                     open = tablePanel?.tab === entry.tab;
    else if (entry.act === 'rss')        open = !!rss?.classList.contains('open');
    else if (entry.act === 'appearance') open = !!menu?.classList.contains('open');
    if (open === null) btn.removeAttribute('aria-expanded');
    else btn.setAttribute('aria-expanded', String(open));
  }
}

function tableWatchRim() {
  if (typeof MutationObserver !== 'function') return;
  tableWatch = new MutationObserver(tableRimSync);
  for (const entry of TABLE_RIM) {
    const nav = document.getElementById(tableNavId(entry) || '');
    if (nav) tableWatch.observe(nav, { attributes: true, attributeFilter: ['style'] });
  }
  for (const id of ['rssPanel', 'appearanceMenu']) {
    const el = document.getElementById(id);
    if (el) tableWatch.observe(el, { attributes: true, attributeFilter: ['class'] });
  }
}

function tableModeEnter() {
  if (tableOn || !document.body) return;
  tableOn = true;
  tableScrollY = window.scrollY || 0;
  document.documentElement.dataset.tablemode = '';
  tableAt = { ...TABLE_REST };
  tableTo = { ...TABLE_REST };
  tableBuild();
  tableEls.plane.style.transform = tablePlaneTransform(tableAt);
  tableMeasure();
  tableDrawCards();
  tableListen(true);
  tableWatchRim();
  tableRimSync();
  if (!tablePlaced) tablePlaceholder();
  document.dispatchEvent(new CustomEvent('tablemode:change', { detail: { on: true } }));
}

/* Everything back the way it was: the card in hand put down, the card being
 * looked at put back, the pane put home, every listener taken off and every
 * element taken out — and the page scrolled to where it had been. What is
 * kept is where the cards lie, which is the session's. */
function tableModeLeave() {
  if (!tableOn) return;
  if (tableHold) tableRelease({ pointerId: tableHold.id });
  tableLookAway(true);
  tableClosePanel({ quiet: true });
  tableListen(false);
  tableWatch?.disconnect();
  tableWatch = null;
  cancelAnimationFrame(tableFrameId);
  cancelAnimationFrame(tableResizeId);
  tableFrameId = tableResizeId = tableFrameAt = 0;
  for (const card of tableCards) card.el = null;
  for (const el of [tableEls.scene, tableEls.dim, tableEls.panel, tableEls.look]) el.remove();
  tableEls = null;
  tableGeom = null;
  tableOn = false;
  delete document.documentElement.dataset.tablemode;
  window.scrollTo(0, tableScrollY);
  document.dispatchEvent(new CustomEvent('tablemode:change', { detail: { on: false } }));
}

// ── The rim ───────────────────────────────────────────────────────────────

function tableOnPlaneClick(e) {
  const btn = e.target.closest?.('.table-tab');
  if (!btn) return;
  const entry = TABLE_RIM[Number(btn.dataset.rim)];
  if (!entry) return;
  if (entry.tab) {
    /* The open tab, pressed again, is put back down. */
    if (tablePanel?.tab === entry.tab) tableClosePanel();
    else tableOpenPanel(entry.tab);
    return;
  }
  switch (entry.act) {
    case 'appearance': tableOpenAppearance(btn); break;
    case 'rss':        toggleRssPanel(); break;
    case 'password':   openChangePassword(); break;
    case 'signout':    logout(); break;
    case 'leave':      setTableMode(false); break;
  }
}

/* The Appearance popover, opened from the rim. It is the app's own popover,
 * floating as it always does; only where it opens is new — beside the right
 * edge's tab, on the side the window has room on, which toggleAppearance()
 * cannot know about since its sidebar opens it rightwards. Kept inside the
 * window. closeAppearance() undoes all of it. */
function tableOpenAppearance(btn) {
  const menu = document.getElementById('appearanceMenu');
  if (!menu) return;
  if (menu.classList.contains('open')) { closeAppearance(); return; }
  menu.classList.add('open');
  const at   = btn.getBoundingClientRect();
  const box  = menu.getBoundingClientRect();
  const edge = 8;
  const left = Math.max(edge, at.left - box.width - edge);
  const top  = Math.max(edge, Math.min(at.top, window.innerHeight - box.height - edge));
  Object.assign(menu.style, {
    position: 'fixed', left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto',
  });
}

// ── Panels ────────────────────────────────────────────────────────────────

/* Put the pane in the panel. The pane's place in the page is held by a
 * comment, so going home is one replace and needs no record of its
 * neighbours. Returns whether a pane is now showing. */
function tableShowPane(tab, kind = tablePanelKind(tab)) {
  if (!tableOn) return false;
  const pane = document.getElementById(`tab-${tab}`);
  if (!pane) return false;
  if (tablePanel && tablePanel.tab === tab && tablePanel.kind === kind) return true;
  tablePutPaneBack();

  const { panel, panelTitle, panelBody, mat, dim } = tableEls;
  panel.dataset.kind = kind;
  panel.dataset.edge = tableRimEntry(tab)?.edge || 'far';
  panel.setAttribute('role', kind === 'float' ? 'dialog' : 'region');
  if (kind === 'grow') {
    /* Lying on the mat, above every card on it. */
    for (const prop of TABLE_FLOAT_PROPS) panel.style.removeProperty(prop);
    panel.style.setProperty('--table-sheet-z', `${((tableCards.length + 2) * TABLE_CARD_GAP).toFixed(2)}px`);
    mat.append(panel);
  } else {
    panel.style.removeProperty('--table-sheet-z');
    dim.after(panel);
  }
  panelTitle.textContent = tableRimLabel(tableRimEntry(tab) || { tab });

  const mark = document.createComment(` #tab-${tab} is lying on the table `);
  pane.before(mark);
  panelBody.append(pane);
  panelBody.scrollTop = 0;
  tablePanel = { tab, kind, pane, mark };
  tableFitPanel();

  panel.classList.remove('is-open');
  panel.hidden = false;
  /* Read once so the closed state is drawn before the open one is asked for,
     or the browser would go straight to the end of the transition. */
  void panel.offsetWidth;
  panel.classList.add('is-open');
  dim.classList.toggle('is-on', kind === 'float');
  panel.focus({ preventScroll: true });
  tableRimSync();
  return true;
}

function tablePutPaneBack() {
  if (!tablePanel) return;
  const { pane, mark } = tablePanel;
  if (mark.parentNode) {
    mark.parentNode.insertBefore(pane, mark);
    mark.remove();
  }
  tablePanel = null;
}

/* The box a floating panel is drawn in, written over the stylesheet's
 * default (top 10vh, min(900px, 70vw) by 80vh, centred) once the rim can be
 * measured — see tableFloatBox(). The tabs are measured with the table at
 * rest and the gap widened by how far looking around can carry them, so no
 * lean of the head walks a tab in under the panel. Put back in the same task,
 * so the rest pose is never drawn. */
const TABLE_FLOAT_PROPS = ['left', 'top', 'width', 'height', 'right', 'margin-inline'];

function tableFitPanel() {
  if (!tablePanel || tablePanel.kind !== 'float' || !tableEls) return;
  const { plane, panel } = tableEls;
  const view = { width: window.innerWidth, height: window.innerHeight };
  const clear = { top: 0, left: 0, right: view.width };
  plane.style.transform = tablePlaneTransform(TABLE_REST);
  for (const btn of plane.querySelectorAll('.table-tab')) {
    if (btn.hidden) continue;
    const at = btn.getBoundingClientRect();
    const edge = TABLE_RIM[Number(btn.dataset.rim)]?.edge;
    if (edge === 'far')       clear.top   = Math.max(clear.top, at.bottom);
    else if (edge === 'left') clear.left  = Math.max(clear.left, at.right);
    else if (edge === 'right') clear.right = Math.min(clear.right, at.left);
  }
  plane.style.transform = tablePlaneTransform(tableAt);
  const box = tableFloatBox(view, clear, TABLE_PANEL_GAP + TABLE_LOOK_SHIFT * view.width);
  panel.style.left   = `${box.left.toFixed(1)}px`;
  panel.style.top    = `${box.top.toFixed(1)}px`;
  panel.style.width  = `${box.width.toFixed(1)}px`;
  panel.style.height = `${box.height.toFixed(1)}px`;
  panel.style.right  = 'auto';
  panel.style.marginInline = '0';
}

/* Open a tab: its pane into a panel, then setTab(), which draws it — into a
 * box it can measure, because the pane is already showing. */
function tableOpenPanel(tab, { kind } = {}) {
  if (!tableOn) return false;
  if (!tableShowPane(tab, kind === 'grow' || kind === 'float' ? kind : tablePanelKind(tab))) return false;
  setTab(tab);
  return true;
}

/* Close the panel and put the pane home. A drawer it opened is closed with
 * it: the drawer goes home with the pane, but the scrim behind it is the
 * page's and would otherwise stay over the table. Focus goes back to the tab
 * that stands for the pane, unless this is the mode itself going away. */
function tableClosePanel({ quiet = false } = {}) {
  if (!tablePanel || !tableEls) return;
  const tab = tablePanel.tab;
  if (typeof closeDrawers === 'function') closeDrawers();
  tablePutPaneBack();
  const { panel, dim, plane } = tableEls;
  panel.hidden = true;
  panel.classList.remove('is-open');
  dim.classList.remove('is-on');
  tableRimSync();
  if (!quiet) plane.querySelector(`.table-tab[data-tab="${tab}"]`)?.focus({ preventScroll: true });
}

// ── Cards ─────────────────────────────────────────────────────────────────

/* Lay a list of cards on the mat. Each is { name, imageUrl, id?, group? };
 * cards past TABLE_CARDS_MAX are not drawn. A card is known across calls by
 * its id, or its name where it has none, numbered by how often that has come
 * up — so a card a hand moved earlier in the session lies where it was put
 * when the same list is laid again. */
function tableLayCards(list, { hint } = {}) {
  tablePlaced = true;
  if (tableHold) tableRelease({ pointerId: tableHold.id });
  tableLookAway(true);
  const seen = new Map();
  tableCards = (Array.isArray(list) ? list : [])
    .filter(card => card && card.name)
    .slice(0, TABLE_CARDS_MAX)
    .map((card, i) => {
      const base = String(card.id ?? card.name);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return {
        key: `${base}#${n}`, name: String(card.name), imageUrl: card.imageUrl || '',
        group: card.group ?? null, x: 0.5, y: 0.5, turn: 0, rank: i, el: null,
      };
    });
  tableHintText = hint || TABLE_HINT;
  if (tableOn) tableDrawCards();
  return tableCards.length;
}

/* The stand-in until each tab lays its own cards: the first cards of the first
 * collection with any, in piles by what kind of card they are. A deck's cards
 * are not in `state` — they are fetched per deck — so a collection it is. */
async function tablePlaceholder() {
  if (typeof state === 'undefined') return;
  const shelf = state.collections.find(c => c.status === 'loaded' && c.cards && c.cards.size);
  if (!shelf) return;
  const names = [...shelf.cards.keys()].slice(0, TABLE_CARDS_MAX);
  try { await ensureScryfallImages(names); } catch { /* laid without pictures, then */ }
  if (!tableOn || tablePlaced) return;
  tableLayCards(names.map(name => ({
    name, imageUrl: scryfallCache.get(name) || '', group: tableCardKind(name),
  })));
}

/* The first of a card's types that a table would sort it by. */
function tableCardKind(name) {
  const type = (typeof scryfallMetaCache !== 'undefined' && scryfallMetaCache.get(name)?.type) || '';
  const kinds = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'];
  return kinds.find(kind => type.includes(kind)) || 'Other';
}

function tableCardZ(card) {
  return (card.rank + 1) * TABLE_CARD_GAP;
}

/* A card's transform: where it lies, how high above the felt, the angle it
 * lies at, and how far it leans back towards the viewer. One string, so a card
 * settling eases every part of it at once. */
function tableWriteCard(card, lift = 0, lean = 0) {
  if (!card.el || !tableGeom) return;
  const { width, height } = tableGeom.mat;
  const { w, h } = tableCardSize;
  card.el.style.transform =
    `translate3d(${(card.x * width - w / 2).toFixed(2)}px, ${(card.y * height - h / 2).toFixed(2)}px, ` +
    `${(tableCardZ(card) + lift).toFixed(2)}px) rotate(${card.turn}deg) rotateX(${lean.toFixed(2)}deg)`;
}

/* A card that has no picture is not drawn as one: it keeps a surface and its
 * name, as the stacks' blank does. */
function tableCardEl(card) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'table-card';
  el.setAttribute('aria-label', card.name);
  el.innerHTML = card.imageUrl
    ? `<img class="card-img table-card-img" src="${esc(card.imageUrl)}" alt="" draggable="false">`
    : `<span class="table-card-blank">${esc(card.name)}</span>`;
  el.addEventListener('click', tableOnCardClick);
  return el;
}

function tableDrawCards() {
  if (!tableEls || !tableGeom) return;
  const { mat, hint } = tableEls;
  for (const old of mat.querySelectorAll('.table-card')) old.remove();
  const layout = tableLayout(tableCards, tableGeom.mat.width, tableGeom.mat.height);
  tableCardSize = { w: layout.width, h: layout.height };
  const cards = document.createDocumentFragment();
  tableCards.forEach((card, i) => {
    Object.assign(card, tableMoved.get(card.key) || layout.spots[i]);
    card.el = tableCardEl(card);
    card.el.style.width  = `${tableCardSize.w}px`;
    card.el.style.height = `${tableCardSize.h.toFixed(2)}px`;
    cards.append(card.el);
  });
  mat.insertBefore(cards, hint);
  for (const card of tableCards) tableWriteCard(card);
  hint.textContent = tableHintText;
  hint.hidden = tableCards.length > 0;
}

/* The mat changed size: the cards keep their places, which are fractions of
 * it, and take the card size the new mat wants. */
function tableResizeCards() {
  const w = tableCardWidth(tableGeom.mat.width);
  tableCardSize = { w, h: w * TABLE_CARD_RATIO };
  for (const card of tableCards) {
    if (!card.el) continue;
    card.el.style.width  = `${w}px`;
    card.el.style.height = `${tableCardSize.h.toFixed(2)}px`;
    tableWriteCard(card);
  }
}

/* The card that was picked up goes to the top of everything, and the rest
 * close up beneath it — ranks stay 0…n-1, so the cards' heights stay inside
 * the hair's breadth TABLE_CARD_GAP is chosen for however many times cards
 * are moved. */
function tableRaise(card) {
  card.rank = Infinity;
  [...tableCards].sort((a, b) => a.rank - b.rank).forEach((c, i) => { c.rank = i; });
  for (const c of tableCards) if (c !== card) tableWriteCard(c);
}

function tableOnCardDown(e) {
  tableSwallow = false;
  if (e.button !== 0 || e.pointerType === 'touch' || tableLooked) return;
  const el = e.target.closest?.('.table-card');
  const card = el && tableCards.find(c => c.el === el);
  if (!card) return;
  const hit = tableUnproject(tableMatrix(), e.clientX, e.clientY, tableCardZ(card));
  if (!hit) return;
  const { width, height } = tableGeom.mat;
  tableHold = {
    card, id: e.pointerId, dragging: false, lift: 0,
    start:   { x: e.clientX, y: e.clientY },
    pointer: { x: e.clientX, y: e.clientY },
    /* Where on the card the hand closed, in the mat's pixels: the card is kept
       with that point under the pointer for the rest of the journey. */
    grab: { u: hit.u - card.x * width, v: hit.v - card.y * height },
  };
  try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
}

function tableBeginCarry() {
  const hold = tableHold;
  hold.dragging = true;
  tableRaise(hold.card);
  hold.card.el.classList.remove('is-settling');
  hold.card.el.classList.add('is-held');
  tableKick();
}

/* One frame of a card in hand. It rises towards its lifted height — none when
 * cards may not move: then it is held, not lifted, and still follows the hand
 * — and is placed so that the point the hand closed on is where the pointer's
 * ray meets the plane at the card's current height. Returns whether it is
 * still rising, which is what asks for another frame. */
function tableCarry(dt) {
  const hold = tableHold;
  const card = hold.card;
  const target = cardMotionOn() ? TABLE_CARD_LIFT : 0;
  const gap = target - hold.lift;
  hold.lift = Math.abs(gap) < 0.5 ? target : hold.lift + gap * tableEaseFor(dt, TABLE_LIFT_EASE);

  const hit = tableUnproject(tableMatrix(), hold.pointer.x, hold.pointer.y, tableCardZ(card) + hold.lift);
  if (hit) {
    const { width, height } = tableGeom.mat;
    card.x = Math.min(1, Math.max(0, (hit.u - hold.grab.u) / width));
    card.y = Math.min(1, Math.max(0, (hit.v - hold.grab.v) / height));
  }
  const lean = TABLE_CARD_LIFT ? -TABLE_CARD_LEAN * hold.lift / TABLE_CARD_LIFT : 0;
  tableWriteCard(card, hold.lift, lean);
  return hold.lift !== target;
}

/* Let go. A press that never became a drag is left to the card's own click,
 * which picks it up to look at; a drag puts the card down where it is, in the
 * card layer's own time (table.css, .is-settling). */
function tableRelease(e) {
  const hold = tableHold;
  if (!hold || (e && e.pointerId !== hold.id)) return;
  tableHold = null;
  if (!hold.dragging) return;
  tableSwallow = true;
  const card = hold.card;
  tableMoved.set(card.key, { x: card.x, y: card.y, turn: card.turn });
  if (!card.el) return;
  const el = card.el;
  el.classList.remove('is-held');
  el.classList.add('is-settling');
  tableWriteCard(card);
  tableAfter(el, () => el.classList.remove('is-settling'));
}

function tableOnCardClick(e) {
  if (tableSwallow) { tableSwallow = false; return; }
  const card = tableCards.find(c => c.el === e.currentTarget);
  if (card) tableLookAt(card);
}

/* The transform that puts the large card where the small one lies on the
 * table: the same centre, the same angle, the size it is drawn at there. The
 * box the table card is measured by is its drawn box, foreshortened and
 * turned, which is what the eye sees it as. */
function tableFlipFrom(fromEl, toEl, turn) {
  const from = fromEl.getBoundingClientRect();
  const to   = toEl.getBoundingClientRect();
  if (!to.width || !to.height) return '';
  const scale = Math.min(from.width / to.width, from.height / to.height);
  const dx = from.left + from.width  / 2 - (to.left + to.width  / 2);
  const dy = from.top  + from.height / 2 - (to.top  + to.height / 2);
  return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale.toFixed(4)}) rotate(${turn}deg)`;
}

/* Run `done` when an element's transition has finished — or now, when cards
 * do not move and there is no transition to wait for, or after a ceiling, in
 * case the transition never ran. */
function tableAfter(el, done) {
  if (!cardMotionOn()) { done(); return; }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    el.removeEventListener('transitionend', finish);
    done();
  };
  el.addEventListener('transitionend', finish);
  setTimeout(finish, 700);
}

/* Pick a card up to look at it: it rises off the table, turning to face you,
 * and comes to rest large in the middle of the window. The card on the mat is
 * hidden rather than moved, so its place is kept for it. */
function tableLookAt(card) {
  if (!card.imageUrl || !card.el || tableLooked) return;
  const { look, lookImg } = tableEls;
  /* A card still on its way back down from the last look is overtaken: its
     ending is this sequence number's to check, and it is no longer current. */
  tableLookSeq++;
  tableLooked = card;
  lookImg.src = card.imageUrl;
  look.setAttribute('aria-label', `Put ${card.name} back`);
  look.hidden = false;
  /* Drawn first where the card lies, with no transition, then let go: the
     transition carries it from there to its place in the middle. */
  lookImg.style.transition = 'none';
  lookImg.style.transform = tableFlipFrom(card.el, lookImg, card.turn);
  void lookImg.offsetWidth;
  lookImg.style.removeProperty('transition');
  lookImg.style.removeProperty('transform');
  card.el.classList.add('is-looked');
  look.focus({ preventScroll: true });
}

/* And put it back, to wherever its place on the table now is — the view may
 * have moved while it was being looked at. `instant` is for the mode going
 * away, which has no time to wait for it. */
function tableLookAway(instant = false) {
  const card = tableLooked;
  if (!card || !tableEls) return;
  tableLooked = null;
  const { look, lookImg } = tableEls;
  const seq = ++tableLookSeq;
  const done = () => {
    if (seq !== tableLookSeq) return;
    look.hidden = true;
    lookImg.style.removeProperty('transform');
    card.el?.classList.remove('is-looked');
  };
  if (instant || !card.el?.isConnected) { done(); return; }
  lookImg.style.transform = tableFlipFrom(card.el, lookImg, card.turn);
  card.el.focus({ preventScroll: true });
  tableAfter(lookImg, done);
}

// ── What main.js tells the table ─────────────────────────────────────────

/* Called first thing in setTab(): a tab opened from anywhere while the table
 * is up has its pane carried into a panel before its init draws into it. */
function tableModeBeforeTab(tab) {
  if (tableOn && tablePanel?.tab !== tab) tableShowPane(tab);
}

/* Called last thing in setTab(): the hook the next half of this work hangs
 * each tab's cards on. */
function tableModeAfterTab(tab) {
  if (!tableOn) return;
  document.dispatchEvent(new CustomEvent('tablemode:tab', {
    detail: { tab, kind: tablePanel?.tab === tab ? tablePanel.kind : null },
  }));
}

/* Called once the first state has arrived — on a load with the mode already
 * on, the table was set before there was anything to put on it. */
function tableModeStateLoaded() {
  if (tableOn && !tablePlaced) tablePlaceholder();
}

window.tableMode = Object.freeze({
  isOn:       () => tableOn,
  openPanel:  (tab, options) => tableOpenPanel(tab, options),
  closePanel: () => tableClosePanel(),
  panel:      () => (tablePanel ? { tab: tablePanel.tab, kind: tablePanel.kind } : null),
  kindFor:    tab => tablePanelKind(tab),
  layCards:   (cards, options) => tableLayCards(cards, options),
  cards:      () => tableCards.map(({ key, name, x, y, turn }) => ({ key, name, x, y, turn })),
});

// ── Boot ──────────────────────────────────────────────────────────────────
// Served with the other scripts at the foot of the body, before main.js: the
// sidebar the rim reads its labels from is already parsed, and nothing here
// needs main.js until something is clicked. A window that crosses the
// breakpoint, or gains or loses a hovering pointer, is answered live.
(function tableModeBoot() {
  try {
    window.matchMedia(tableModeQuery()).addEventListener('change', tableModeSync);
  } catch { /* no media queries to listen to, so nothing will change */ }
  tableModeSync();
  renderTableModeControl();
})();
