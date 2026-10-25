// ── Table mode ────────────────────────────────────────────────────────────
// An experiment, and an opt-in one: the whole app as a table seen from a seat.
// The user's playmat lies in the middle of it, framed by a wooden rim, and the
// table is tilted away from the viewer the way a table is when you sit at it.
// The tabs are no longer a sidebar. They are physical tabs lying on the rim —
// chips on the wood, an icon each, that show their label when pointed at — and
// pressing one lifts that tab's page up off the table to be read.
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
//   .table-scene   fixed, full-viewport, the room the table stands in
//     .table-camera  the eye: the perspective (table.css: 1400px), and the
//                    pan and zoom — its transform is written here, every
//                    frame the camera moves
//       .table-plane the table: wood, a grid of rim / mat / rim, preserve-3d,
//                    tilted away by TABLE_TILT_REST and fitted to the window
//                    here (tableFitSize)
//         .table-rim   the four edges; the tabs lie on three of them
//         .table-mat   the playmat (or the theme's felt), where cards lie
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
// ── The table, fitted ─────────────────────────────────────────────────────
// At rest the table fills the window: its near corners close to the window's
// bottom corners and its far edge — with the tabs lying on it — close to
// the top. A perspective makes that a question with an answer rather than a
// percentage to tune: tableFitSize works out the plane's laid-out size and
// place that land those edges there at the rest tilt, and tableFitTable hands
// them to table.css, measuring the far tabs to leave them their room. Again
// on every resize.
//
// ── Panning and zooming ──────────────────────────────────────────────────
// The table never changes its angle. What moves is the camera over it: the
// picture of the table slides and zooms, the way a camera on a rail with a
// zoom lens would see it. Where the pointer is over the window is where the
// camera pans to (tablePanTarget, tableCamera) — at zoom 1 only a little, as
// if leaning your head; zoomed in, far enough that the pointer at an edge or
// a corner of the window brings that edge or corner of the table into view.
// The wheel over the table zooms, from the whole table to TABLE_ZOOM_MAX of
// it, and so do + − and 0 on the keyboard; the zoom is about the point under
// the pointer, which the pan's one rule holds still by itself (tableCamera).
// The zoom is the session's, in memory, and starts at 1 each time.
//
// The pointer and the wheel only set where the camera is *going*; a frame
// loop eases it there (tableCameraStep) and stops itself when it arrives, so
// a pointer resting still costs nothing. No CSS transition is involved: a
// transition restarted on every pointer move never gets to finish. When cards
// may not move — the "Cards move" switch, or an operating system asking for
// less motion, both answered by cardMotionOn() — the camera jumps rather
// than eases, and the lean at rest goes: zoomed in, it still pans to follow
// the pointer, because that is the only way round a zoomed table.
//
// Zoomed in, the cards are drawn larger than the pictures the browser would
// decode for them, so they are laid out larger and scaled back to keep them
// sharp, and drawn from Scryfall's large pictures where the normal ones would
// be stretched (tableSharpen, and TABLE_DECODE_STEP for why).
//
// ── From the screen to the mat ───────────────────────────────────────────
// A card is dragged in the table's plane, not the screen's: it has to stay
// under the pointer while the table is tilted, foreshortened and moving. So
// the pointer's screen point is mapped back onto the mat.
//
// tablePlaneMatrix() composes the 4×4 matrix the browser itself composes for a
// point on the mat — the camera's pan and zoom, its perspective about its
// origin, the plane's place and its tilt about its own origin, the mat's place
// in the plane — from the untransformed geometry (offsetLeft and friends,
// which no transform touches) and the camera as it is. For points on a plane at height z in
// the mat's own coordinates, dropping that matrix's third column (folded into
// the fourth at z) and its third row leaves a 3×3 homography from mat to
// screen; tableUnproject() inverts it. That is the ray–plane intersection in
// closed form, exact under perspective, and the same for a card lying on the
// mat (z ≈ 0) as for one held 96px above it — which is what keeps a lifted
// card under the pointer rather than under where the pointer would be on the
// felt, and under it still while the camera pans and zooms beneath it.
//
// ── Panels ────────────────────────────────────────────────────────────────
// One host, two kinds, chosen per tab by TABLE_PANEL_KINDS:
//
//   float  lifted off the table and facing the viewer, flat and readable,
//          scrolling inside; the table dims a little behind it. Every tab
//          but the Card tab, in this first half of the work. It is fitted
//          clear of the tabs lying on the rim (tableFloatBox), because a
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
// ── Tucking a panel away ──────────────────────────────────────────────────
// A tab with cards (TABLE_CARD_TABS) floats its controls — the search box, the
// sort, the deck picker — over the very table its cards are laid on, so its
// panel can be tucked: "Show table" in its header slides it down until only
// that header shows, flat at the foot of the window and between the side
// tabs, and the table is undimmed. Pressing the header brings it back. Moved
// with `translate`, so the pane keeps the box it was laid out in and nothing
// in it reflows; what is out of sight is made invisible too, so the keyboard
// cannot Tab into it.
//
// It tucks itself in two cases, and only for a tab with cards: when cards are
// laid because of something the user did in the pane — a search finished, a
// sort chosen, a deck picked (tableShouldAutoTuck) — and when a tab with cards
// is opened straight from another one while the last thing the user chose was
// to tuck (tableTuckOnOpen). That choice is kept for the session and in
// memory only. A tab without cards never tucks on its own.
//
// ── Cards ─────────────────────────────────────────────────────────────────
// tableMode.layCards() lays a list of cards flat on the mat in tidy fanned
// piles (tableLayout). Press one and it comes up off the felt at once, quickly
// (TABLE_LIFT_MS), and leans towards you; drag it and it follows the pointer
// in the table's plane; let go and it settles where it was put down. Let go
// without having moved (tableIsDrag: under 5px) and it is picked up to be
// looked at: it goes on rising from the hand to face you, large, over the
// table, and a click or Escape puts it back where it lay — unless the card
// stands for something to open, a deck on the Decks tab, when the click opens
// it. Where a hand put a card is kept for the session and for nothing longer.
//
// The Card tab's one card is laid on its own, large, in a lane down the mat's
// right-hand side, and the sheet the tab lies on draws itself short of that
// lane (--table-sheet-lane) so the two lie side by side.
//
// While a card is being looked at, a small "Details" under it opens the Card
// tab on it (openCardPage, js/card.js) — as the sheet lying on the mat, which
// is what the tab is here, rather than the modal the app opens at this width.
//
// ── Each tab's cards ──────────────────────────────────────────────────────
// A tab with cards lays them on the mat when it is opened, and again whenever
// its pane is redrawn while it is open — a sort, a filter, a search, a deck
// edit — noticed by watching the pane rather than by asking every renderer to
// call out. What is laid is what the tab is showing, read from the renderer's
// own result through a small getter beside it, never fetched or worked out a
// second time (TABLE_SOURCES):
//
//   collections  colShownPiles()     js/collections.js  the rows on show, in the
//                                                       stack view's piles
//   deckview     dbShownPiles()      js/deckview-render.js  a pile per category
//   players      decksShown()        js/players.js      a card per deck, in its
//                                                       folder (Mine) or under
//                                                       its player (Everyone);
//                                                       clicking one opens it
//                                                       in the Deck Builder
//   scryfall     sfShownCards()      js/search.js       the results, in order
//   sets         setShownPiles()     js/sets.js         the open set, piled
//   wants        wantShownLists()    js/wants.js        a pile per want list
//   card         cardDetailShown()   js/card.js         the card, large, beside
//                                                       the sheet
//
// A pile is a group; sixty cards are shared out across the piles fairly
// (tableFairShare), so a deep first pile does not leave the rest of the table
// empty. Every other tab leaves the mat as it is. A redraw that changes
// nothing about which cards lie where — the pictures arriving, a poll that
// found the same state — puts the pictures in and moves nothing; one that
// does lays the cards again, and a card a hand moved stays where it was put
// (tableMoved, keyed by tab and card).
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
//   tableMode.layCards(cards, { hint, scope, feature })
//                                            → how many were laid (≤ 60).
//                                              cards: [{ name, imageUrl, id?,
//                                              group?, open? }] — open(), where
//                                              given, is what a click does
//                                              instead of picking the card up;
//                                              hint: what the mat says when the
//                                              list is empty; scope: whose cards
//                                              these are, so one tab's moved card
//                                              is not another's; feature: one
//                                              card, laid large beside the sheet
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
// table's fit to the window, the pointer-to-pan mapping, the wheel's zoom and
// the camera's easing, how large a card's picture is laid out and which file
// it comes from, the lift, the screen-to-mat mapping through the camera, the
// floating panel's box, the layout, what each tab lays and how it is piled,
// where a re-laid card goes, and when a panel tucks.

// ── Constants ─────────────────────────────────────────────────────────────

/* The browser's copy of the switch: '1' when on, nothing when off. */
const TABLE_MODE_KEY = 'mtgtools_tablemode';

/* How far the table leans away from the viewer at rest, in degrees. table.css
 * tilts the plane by it too, as --table-tilt, so the matrix the screen is
 * mapped back to the mat through and the table the browser draws lean by the
 * same number. */
const TABLE_TILT_REST = 24;

/* How the table is fitted to the window at rest (tableFitSize): its near
 * corners this many pixels in from the window's bottom corners, and its far
 * edge — or the tops of the tabs on it, should they ever reach past it — the
 * same gutter below the window's top, plus room for the pan at rest to carry
 * the table down by TABLE_PAN_REST without a far tab leaving the window. */
const TABLE_FIT_GUTTER = 8;

/* How far the camera slides at zoom 1 with the pointer at an edge of the
 * window, as a fraction of the window — 2%, which reads as a head leaning
 * rather than the table sliding. Zoomed in, the slide grows by itself until
 * the pointer at an edge of the window brings that edge of the table into
 * view (tableCamera). */
const TABLE_PAN_REST = 0.02;

/* How far the camera zooms: from the whole table (1) to two and a half times
 * it. A wheel zooms by TABLE_ZOOM_PER_PX for every pixel it turns — a mouse's
 * notch, a hundred-odd pixels, is about a fifth more — with a line counted as
 * TABLE_WHEEL_LINE_PX (Firefox turns a notch as three lines) and no one event
 * allowed more than TABLE_WHEEL_MAX_PX, so a wheel that reports in pages
 * cannot leap the whole range at once. A key zooms by TABLE_ZOOM_KEY a press. */
const TABLE_ZOOM_MIN      = 1;
const TABLE_ZOOM_MAX      = 2.5;
const TABLE_ZOOM_PER_PX   = Math.log(1.2) / 100;
const TABLE_WHEEL_LINE_PX = 40;
const TABLE_WHEEL_MAX_PX  = 300;
const TABLE_ZOOM_KEY      = 1.25;

/* How much of the way to the target the camera closes in a sixtieth of a
 * second — a frame on an ordinary screen; a faster screen closes less per
 * frame and a slower one more, by tableEaseFor(), so the camera takes the same
 * time to arrive at any refresh rate. The zoom and the pan close at their own
 * rates. The zoom answers a wheel the hand has just turned and should keep up
 * with it. The pan follows every movement of the pointer, so it is the one
 * that is felt as the table sliding about: at the zoom's rate it set off
 * sharply enough to read as a lurch, so it closes about a quarter less. That
 * costs the zoom about the pointer nothing: which point of the table is under
 * a still pointer does not depend on the zoom (tableCamera), so the two can
 * arrive at different times.
 *
 * And how near counts as there: a pan within a ten-thousandth of its range
 * and a zoom within a ten-thousandth of a step — each under a fifth of a pixel
 * on any desktop window, zoomed all the way in — leave the frame loop nothing
 * to draw, and it stops. */
const TABLE_FRAME_MS       = 1000 / 60;
const TABLE_ZOOM_EASE      = 0.12;
const TABLE_PAN_EASE       = 0.09;
const TABLE_SETTLED_PAN    = 0.0001;
const TABLE_SETTLED_ZOOM   = 0.0001;
const TABLE_CAMERA_KEYS    = ['zoom', 'panX', 'panY'];
const TABLE_CAMERA_REST    = Object.freeze({ zoom: 1, panX: 0, panY: 0 });

/* A press that moves less than this, in screen pixels, is a click: the card is
 * picked up to look at rather than carried. Five is what a hand wobbles by. */
const TABLE_DRAG_START = 5;

/* A card in hand: how high it comes off the felt, in the mat's own pixels; how
 * far it leans back towards the viewer once it is there, in degrees; and how
 * long it takes to get all the way up, in milliseconds, on an ease-out curve
 * (tableLiftHeight). Quick, because it starts the moment the button goes down
 * and a hand should feel the card come up with it; table.css grows the held
 * shadow over the same time. */
const TABLE_CARD_LIFT  = 96;
const TABLE_CARD_LEAN  = 12;
const TABLE_LIFT_MS    = 110;

/* How sharp a card's picture is drawn on a zoomed table.
 *
 * Firefox decodes an image at the size it is laid out at, times the scale of
 * the transforms it can see between the image and the window. It cannot see
 * through the table: a picture inside the tilted plane is decoded for its
 * laid-out size as if the camera's zoom were not there. Zoomed in two and a
 * half times, a card is drawn from a picture decoded for a card two and a
 * half times smaller, and the blur is that magnification. Measured in
 * headless Firefox, a card at zoom 2.5 came out as sharp as its zoom-1
 * picture blown up, and a fifth as sharp as the same picture drawn flat at
 * the same size. Text on the same card was crisp, so the layers themselves
 * are drawn at the zoomed scale; it is the decode alone. Nor does it count
 * the screen's device pixels there: on a hi-dpi screen the picture is
 * decoded for half the pixels it is drawn in, even at rest.
 *
 * So the picture is laid out larger than the card, by --table-card-k, and
 * scaled back down to it by a transform of its own. The scale-down is one
 * Firefox can see, and would count against the size it decodes for, except
 * that the card is a 3D context of its own (table.css): the picture is then a
 * face in the scene, and a face is decoded for its own box. The factor is the
 * zoom times the device pixel ratio, rounded up to the next TABLE_DECODE_STEP
 * so that a wheel crossing every small step does not set sixty pictures
 * decoding again each time — 1 at rest on a screen at 1x, where the picture
 * is decoded exactly as it always was. A decode is never larger than the
 * file, so the factor costs nothing past the picture's own size.
 *
 * And from a larger file, when the decode needs one. Scryfall's `normal`
 * picture is TABLE_IMG_NORMAL_W pixels wide; a card drawn wider than that in
 * device pixels — a big card, a hi-dpi screen, a deep zoom — is drawn from
 * `large` instead, the same picture at 672. TABLE_NEAR_GROWTH is how much
 * larger than its laid-out width a card at the mat's near edge is drawn, by
 * the perspective (about 1.15 at the fitted tilt), so that the nearest card
 * is the one asked about. Only when needed, because sixty large pictures are
 * about twice the download of sixty normal ones, and a screen at 1x never
 * needs them: the widest card zoomed all the way in is 450 pixels there. */
const TABLE_DECODE_STEP   = 0.5;
const TABLE_IMG_NORMAL_W  = 488;
const TABLE_NEAR_GROWTH   = 1.2;

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
 * fan is at most TABLE_FAN_MAX of a card's width, and never under a third of
 * it (TABLE_FAN_MIN) — enough of each card showing to tell it from the next;
 * a pile that would need less breaks onto further rows instead. Rows are spread
 * down the slot's height as far as it allows, a row at most a card's height
 * (TABLE_ROW_MAX) under the one above and, where the slot has the room, no less
 * than half of one (TABLE_ROW_MIN), so the top of every card — its name and
 * its art — shows. The ends of a fan turn out by TABLE_FAN_TURN degrees and
 * drop by TABLE_FAN_ARC of a card's height, the shape a hand spreads. */
const TABLE_SLOT_ASPECT = 2;
const TABLE_FAN_MAX  = 0.55;
const TABLE_FAN_MIN  = 1 / 3;
const TABLE_ROW_MIN  = 0.5;
const TABLE_ROW_MAX  = 1;
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

/* The tabs that lay cards on the mat — each has a source in TABLE_SOURCES —
 * and so the tabs whose panel can be tucked out of the way of them. */
const TABLE_CARD_TABS = Object.freeze(['collections', 'players', 'deckview', 'scryfall', 'sets', 'wants', 'card']);

/* What the mat says when a tab with cards has none to lay. */
const TABLE_EMPTY_HINT = 'No cards to show';

/* The one card the Card tab lays, large, in a lane down the mat's right-hand
 * side that the sheet leaves free: as tall as this share of the mat, but no
 * wider than TABLE_FEATURE_MAX of it, so a wide sheet is left to read in; and
 * the lane is the card and TABLE_FEATURE_PAD of its width either side. */
const TABLE_FEATURE_SHARE = 0.78;
const TABLE_FEATURE_MAX   = 0.3;
const TABLE_FEATURE_PAD   = 0.12;

/* How long after something done in a pane the cards it lays still count as
 * its answer, for tucking the panel out of their way: long enough for a
 * search to come back from Scryfall, short enough that a state poll half a
 * minute later is not mistaken for one. */
const TABLE_TUCK_WINDOW = 20000;

/* How long a pane is left to finish redrawing before its cards are read —
 * a render often lands in a few writes (the piles, then their layout, then
 * the pictures) — and the longest it is left, for a pane that keeps writing:
 * the Deck Builder's readout and its card data arrive in a stream while a deck
 * opens, and a wait that restarted on every write would never end. */
const TABLE_RELAY_MS     = 60;
const TABLE_RELAY_MAX_MS = 400;

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

/* Where the camera's pan wants to be for a pointer at (x, y) in a window of
 * the given size: panX and panY, the pointer's place as a fraction running -1
 * to 1 across and down the window, clamped, so the answer is bounded whatever
 * it is asked. What a pan of that much does to the picture is tableCamera's. */
function tablePanTarget(x, y, width, height) {
  const fraction = (along, size) =>
    (size > 0 ? Math.min(1, Math.max(-1, (Number(along) || 0) / size * 2 - 1)) : 0);
  /* `|| 0` is the sign of nothing: the middle of the window would otherwise
   * answer -0, the same place written as a different number. */
  return { panX: fraction(x, width) || 0, panY: fraction(y, height) || 0 };
}

/* The camera, as what it does to the picture of the table: { zoom, tx, ty },
 * the picture scaled by `zoom` about the window's top-left corner and then
 * moved by tx/ty pixels — a 2D move of the whole picture after the
 * perspective, which is what a camera sliding over a table and zooming its
 * lens does, and why the table's angle never changes while it pans.
 *
 * `view` is { zoom, panX, panY } (tableCameraStep eases it), `lean` the slide
 * at zoom 1 with the pointer at an edge, as a fraction of the window.
 *
 * The pan is built from one rule: the pointer at a fraction f of the way
 * across the window is over the point of the rest picture that far across a
 * band reaching `lean` of the window past each side — at every zoom. So:
 *
 *   at zoom 1 the picture slides `lean` of the window the other way from the
 *   pointer, as if you leant your head that way;
 *   zoomed in, the slide grows with the zoom, and the pointer at an edge of
 *   the window brings that edge of the band — and the table inside it — into
 *   view, the corners reaching the table's corners;
 *   and zooming with the pointer still never moves the point under it, since
 *   which point that is does not depend on the zoom: zoom about the pointer
 *   is not a second rule but this one, held.
 *
 * With the band's half-width H = size · (½ + lean), the rest point under the
 * pointer is size/2 + f·H, so the picture moves by
 *   t = (1 − zoom) · size/2 − f · (zoom · H − size/2). */
function tableCamera({ zoom = 1, panX = 0, panY = 0 } = {}, width = 0, height = 0, lean = TABLE_PAN_REST) {
  const z = Math.min(TABLE_ZOOM_MAX, Math.max(TABLE_ZOOM_MIN, Number(zoom) || 1));
  const shift = (f, size) => {
    if (!(size > 0)) return 0;
    const half = size * (0.5 + Math.max(0, Number(lean) || 0));
    return (1 - z) * size / 2 - (Number(f) || 0) * (z * half - size / 2) || 0;
  };
  return { zoom: z, tx: shift(panX, width), ty: shift(panY, height) };
}

/* One frame of the camera easing towards its target: the zoom closes
 * `zoomEase` of its gap and each of the two pans `panEase` of its own, and one
 * already within reach of its target snaps to it. `settled` is true when all
 * three have arrived, which is what stops the frame loop. */
function tableCameraStep(at, to, zoomEase = TABLE_ZOOM_EASE, panEase = TABLE_PAN_EASE) {
  const next = {};
  let settled = true;
  for (const key of TABLE_CAMERA_KEYS) {
    const gap   = to[key] - at[key];
    const zoom  = key === 'zoom';
    const reach = zoom ? TABLE_SETTLED_ZOOM : TABLE_SETTLED_PAN;
    if (Math.abs(gap) <= reach) { next[key] = to[key]; continue; }
    next[key] = at[key] + gap * (zoom ? zoomEase : panEase);
    settled = false;
  }
  return { at: next, settled };
}

/* A zoom moved by `factor`, held inside the range. */
function tableZoomBy(zoom, factor) {
  const next = (Number(zoom) || 1) * (Number(factor) > 0 ? Number(factor) : 1);
  return Math.min(TABLE_ZOOM_MAX, Math.max(TABLE_ZOOM_MIN, next));
}

/* A zoom after one wheel event: deltaY in its deltaMode — pixels (0), lines
 * (1) or pages (2, a page being `page` pixels) — counted in pixels, held to
 * TABLE_WHEEL_MAX_PX either way, and turned into a factor by the exponential,
 * so a trackpad's fifty small events zoom exactly as far as a mouse's one big
 * one of the same total, and a turn away undoes a turn towards. Turning the
 * wheel towards you (a positive deltaY) zooms out, as maps do. */
function tableWheelZoom(zoom, deltaY, deltaMode = 0, page = 800) {
  const unit = deltaMode === 1 ? TABLE_WHEEL_LINE_PX : deltaMode === 2 ? (Number(page) || 0) : 1;
  const px = Math.min(TABLE_WHEEL_MAX_PX, Math.max(-TABLE_WHEEL_MAX_PX, (Number(deltaY) || 0) * unit));
  return tableZoomBy(zoom, Math.exp(-px * TABLE_ZOOM_PER_PX));
}

/* How many times larger than the card its picture is laid out, for a camera
 * at `zoom` on a screen of `dpr` device pixels to the pixel — see
 * TABLE_DECODE_STEP. The zoom is held inside the camera's range and neither
 * is counted below 1, so a screen at 1x at rest answers exactly 1. */
function tableDecodeScale(zoom, dpr = 1) {
  const z = Math.min(TABLE_ZOOM_MAX, Math.max(1, Number(zoom) || 1));
  const k = z * Math.max(1, Number(dpr) || 1);
  return Math.ceil(k / TABLE_DECODE_STEP - 1e-9) * TABLE_DECODE_STEP;
}

/* Whether a card `width` pixels wide on the mat, under a camera at `zoom` on
 * a screen of `dpr` device pixels to the pixel, is drawn wider at the mat's
 * near edge than Scryfall's normal picture is. */
function tableNeedsLarge(width, zoom, dpr = 1) {
  const drawn = (Number(width) || 0) * (Number(zoom) || 1) * (Number(dpr) || 1) * TABLE_NEAR_GROWTH;
  return drawn > TABLE_IMG_NORMAL_W;
}

/* Scryfall's large picture for a normal one: the same path on the same host,
 * with /large/ for /normal/. Anything else — a picture from elsewhere, an
 * art crop, a size already large — is its own answer. */
function tableLargeImage(url) {
  const text = String(url || '');
  return /^https:\/\/cards\.scryfall\.io\/normal\//.test(text) ? text.replace('/normal/', '/large/') : text;
}

/* How high a card in hand is, `ms` after the button went down: all the way
 * up at TABLE_LIFT_MS, on a cubic ease-out — fast off the felt, slowing into
 * the hand — and not at all when cards may not move. */
function tableLiftHeight(ms, motion = true) {
  if (!motion) return 0;
  const t = Math.min(1, Math.max(0, (Number(ms) || 0) / TABLE_LIFT_MS));
  return TABLE_CARD_LIFT * (1 - (1 - t) ** 3);
}

/* How big the table is drawn, and where, so that at rest it fills a window
 * of `view` = { width, height }: its near corners `gutter` in from the
 * window's bottom corners and its far edge `top` below the window's top.
 *
 * Seen through a perspective of `perspective` about the window's centre and
 * tilted away by `tilt` about its own centre, a point s from the table's
 * centre along its depth lands at (oy + s·cos) · d / (d − s·sin) from the
 * window's centre, where oy is how far below the centre the table is laid.
 * Asking that of the near edge (s = +a) and the far one (s = −a) gives two
 * equations in a and oy, and they are linear in a:
 *
 *   a = (A + B) / (2·cos + (A − B)·sin / d)
 *   A = height/2 − gutter,  B = height/2 − top
 *
 * The width is then whatever puts the near corners where they are asked to
 * be, at the near edge's magnification. Returns the plane's laid-out box —
 * { left, top, width, height } in window pixels, before its tilt — or null
 * for a window or a perspective it cannot fit. */
function tableFitSize(view, { perspective, tilt = TABLE_TILT_REST, gutter = TABLE_FIT_GUTTER, top = gutter } = {}) {
  const width = Number(view?.width) || 0, height = Number(view?.height) || 0;
  const d = Number(perspective);
  if (!(width > 0) || !(height > 0)) return null;
  const sin = Math.sin(tilt * TABLE_RAD), cos = Math.cos(tilt * TABLE_RAD);
  const A = height / 2 - gutter, B = height / 2 - top;
  const flat = !(d > 0) || !Number.isFinite(d);
  const a = (A + B) / (2 * cos + (flat ? 0 : (A - B) * sin / d));
  /* The near edge's magnification, d / (d − a·sin); none without a
     perspective, and nothing at all with the near edge at or behind the eye. */
  const near = flat ? 1 : d / (d - a * sin);
  if (!(a > 0) || !(near > 0) || !Number.isFinite(near)) return null;
  const oy = A / near - a * cos;
  const w = (width - 2 * gutter) / near;
  return { left: (width - w) / 2, top: height / 2 + oy - a, width: w, height: 2 * a };
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
 * As large as its ceiling allows, but clear of the tabs lying on the rim —
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

/* CSS's scale(k) — a 2D one: x and y, never z. */
function tableScale(k) {
  return [k, 0, 0, 0,  0, k, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1];
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
 *   the camera's transform, about the window's corner — the picture moved
 *     and zoomed, after everything below has been drawn into it
 *   · the camera's perspective, about its perspective-origin
 *   · the plane's place in the camera, and its tilt about its own origin
 *   · the mat's place in the plane
 *
 *   geometry = {
 *     perspective,              the camera's, in px (Infinity for none)
 *     origin:  { x, y },        the camera's perspective-origin, px
 *     plane:   { left, top,     the plane's untransformed box in the camera
 *                origin: {x,y} } and its transform-origin within it
 *     mat:     { left, top },   the mat's content box within the plane's box
 *     tilt,                     the plane's rotateX, in degrees
 *     camera:  { zoom, tx, ty } the camera's transform, as tableCamera answers
 *   }
 *
 * The camera fills the scene, which is fixed at the window's corner, so the
 * camera's pixels are the window's. Its transform comes first — outermost —
 * because it is the camera element's own, applied to the flat picture its
 * perspective has already made of the plane: a scale and a move of x and y
 * against the projected w, which tableUnproject inverts with everything else
 * in the same closed form, so a point on the mat is found under the pointer
 * however far the camera has panned or zoomed. */
function tablePlaneMatrix({ perspective, origin, plane, mat, tilt = TABLE_TILT_REST, camera = { zoom: 1, tx: 0, ty: 0 } }) {
  return [
    tableTranslate(camera.tx, camera.ty),
    tableScale(camera.zoom),
    tableTranslate(origin.x, origin.y),
    tablePerspective(perspective),
    tableTranslate(-origin.x, -origin.y),
    tableTranslate(plane.left + plane.origin.x, plane.top + plane.origin.y),
    tableRotateX(tilt),
    tableTranslate(-plane.origin.x, -plane.origin.y),
    tableTranslate(mat.left, mat.top),
  ].reduce(tableMul);
}

/* The CSS for the camera's part, written in the order the matrix composes it
 * — so the matrix above and what the browser draws are one statement read two
 * ways — and read about the camera's corner (transform-origin: 0 0, in
 * table.css). The plane's tilt is the stylesheet's own rotateX(--table-tilt),
 * which tableBuild sets from TABLE_TILT_REST, the number the matrix tilts by. */
function tableCameraTransform({ zoom, tx, ty }) {
  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${zoom.toFixed(5)})`;
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
 * one at a readable overlap, and onto more of them than that where the slot's
 * height has room for them and the fan would otherwise be tighter than it need
 * be (tableFanRows). Every card keeps the angle its name gives it in a stack (stackJitter,
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
    const perRow = Math.ceil(count / tableFanRows(count, room, slotH, w, h));
    const lines  = Math.ceil(count / perRow);
    const stepY  = lines > 1 ? Math.max(0, Math.min(h * TABLE_ROW_MAX, (slotH - h) / (lines - 1))) : 0;
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

/* How many rows a pile of `count` cards is laid in, in a slot `room` pixels
 * wider than a card and `slotH` tall, for cards w × h. At least as many as keep
 * a third of every card showing sideways; more, up to as many as would let the
 * fan open all the way, while the slot is tall enough for each row to show at
 * least half of the cards above it. */
function tableFanRows(count, room, slotH, w, h) {
  if (!(count > 1) || !(w > 0) || !(h > 0)) return 1;
  const across = step => Math.max(1, Math.floor(Math.max(0, room) / (w * step)) + 1);
  const fewest = Math.ceil(count / across(TABLE_FAN_MIN));
  const open   = Math.ceil(count / across(TABLE_FAN_MAX));
  const tall   = Math.max(1, Math.floor(Math.max(0, slotH - h) / (h * TABLE_ROW_MIN)) + 1);
  return Math.max(fewest, Math.min(tall, open));
}

/* The size of the one card the Card tab lays, on a mat of the given size, and
 * the width of the lane it lies in down the mat's right-hand side. */
function tableFeatureSize(matWidth, matHeight) {
  const width = Math.max(0, Number(matWidth) || 0), height = Math.max(0, Number(matHeight) || 0);
  const w = Math.round(Math.min(height * TABLE_FEATURE_SHARE / TABLE_CARD_RATIO, width * TABLE_FEATURE_MAX));
  return { w, h: w * TABLE_CARD_RATIO, lane: Math.round(w * (1 + 2 * TABLE_FEATURE_PAD)) };
}

/* tableLayout's answer for that card: in the middle of its lane, at the angle
 * its name gives it. More than one card would lie on top of it; nothing lays
 * more. */
function tableFeatureLayout(cards, width, height) {
  const list = (cards || []).slice(0, TABLE_CARDS_MAX);
  const size = tableFeatureSize(width, height);
  const room = width > 0 && height > 0;
  const x = room ? Math.min(1, Math.max(0, (width - size.lane / 2) / width)) : 0.5;
  return {
    width: size.w, height: size.h, lane: room ? size.lane : 0,
    spots: list.map(card => ({
      x, y: 0.5,
      turn: room && typeof stackJitter === 'function' ? Math.round(stackJitter(card.name) * 10) / 10 || 0 : 0,
    })),
  };
}

/* How many cards of each pile are laid, for piles of the given sizes, when no
 * more than `max` can be: the same share each, a pile smaller than its share
 * giving back what it does not use to the piles after it — so a hundred cards
 * of one kind and three of another lay the three and fifty-seven, not sixty of
 * the first. Each pile's cards are taken from its front, in the tab's order. */
function tableFairShare(sizes, max = TABLE_CARDS_MAX) {
  const want = (sizes || []).map(n => Math.max(0, Math.floor(Number(n) || 0)));
  const take = want.map(() => 0);
  let left = Math.max(0, Math.floor(Number(max) || 0));
  for (;;) {
    const open = want.map((n, i) => (take[i] < n ? i : -1)).filter(i => i >= 0);
    if (!left || !open.length) return take;
    const share = Math.max(1, Math.floor(left / open.length));
    for (const i of open) {
      const more = Math.min(share, want[i] - take[i], left);
      take[i] += more;
      left -= more;
      if (!left) break;
    }
  }
}

/* A tab's piles, [{ key?, label, cards }], as the flat list the mat lays: each
 * card through `cardOf(card, pile)` — which says what it is called, what it
 * looks like and what it is known by — carrying its pile as its group, and no
 * more of each pile than tableFairShare gives it. A pile with nothing in it is
 * no pile. */
function tableFromPiles(piles, cardOf, max = TABLE_CARDS_MAX) {
  const list = (piles || []).filter(pile => pile && Array.isArray(pile.cards) && pile.cards.length);
  const counts = tableFairShare(list.map(pile => pile.cards.length), max);
  const out = [];
  list.forEach((pile, p) => {
    const group = pile.key ?? pile.label ?? p;
    for (const card of pile.cards.slice(0, counts[p])) {
      const laid = cardOf(card, pile);
      if (laid && laid.name) out.push({ ...laid, group: String(group) });
    }
  });
  return out;
}

/* The cards as the mat holds them: at most TABLE_CARDS_MAX, the nameless
 * dropped, each known by a key that is the same whenever the same card is laid
 * by the same tab — its scope, its id or else its name, and how many times
 * that has come up already in the list, for the second copy of a card. */
function tableKeyCards(list, scope = '') {
  const seen = new Map();
  const prefix = scope ? `${scope}:` : '';
  return (Array.isArray(list) ? list : [])
    .filter(card => card && card.name)
    .slice(0, TABLE_CARDS_MAX)
    .map(card => {
      const base = prefix + String(card.id ?? card.name);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return {
        key: `${base}#${n}`, name: String(card.name), imageUrl: card.imageUrl || '',
        group: card.group ?? null, open: typeof card.open === 'function' ? card.open : null,
      };
    });
}

/* What a list of cards is to the mat, as one string: which cards lie in which
 * piles, in what order, laid by whom and how. Two lists that answer the same
 * are laid the same way, so only their pictures can differ — which is what
 * lets a redraw that only brought pictures leave every card where it lies. */
function tableListSig(list, scope = '', feature = false) {
  return JSON.stringify([scope, !!feature,
    tableKeyCards(list, scope).map(card => [card.key, card.group])]);
}

/* Where each card lies once laid: where a hand last put it this session, if
 * one did — `moved` is keyed as tableKeyCards keys — and otherwise where the
 * layout puts it. */
function tablePlaceCards(cards, spots, moved) {
  return cards.map((card, i) => ({ ...(moved.get(card.key) || spots[i] || { x: 0.5, y: 0.5, turn: 0 }) }));
}

/* Whether a tab is one that lays cards. */
function tableIsCardTab(tab) {
  return TABLE_CARD_TABS.includes(tab);
}

/* Whether a panel opens tucked: a floating one, for a tab with cards, opened
 * straight from another tab with cards, when the last thing the user chose to
 * do with a panel was tuck it. `from` is the tab whose panel was open just
 * before, or null. */
function tableTuckOnOpen({ kind, from, to, kept }) {
  return kind === 'float' && !!kept && tableIsCardTab(from) && tableIsCardTab(to);
}

/* Whether cards just laid tuck the panel out of their way: a floating panel,
 * for a tab with cards, not already tucked, and something done in its pane
 * no more than TABLE_TUCK_WINDOW ago — `actedAgo`, in milliseconds, Infinity
 * when nothing has been. Typing does not count as done: a filter applied
 * letter by letter would tuck the box being typed in. */
function tableShouldAutoTuck({ kind, tab, tucked, actedAgo }) {
  return kind === 'float' && tableIsCardTab(tab) && !tucked
      && Number(actedAgo) >= 0 && Number(actedAgo) <= TABLE_TUCK_WINDOW;
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
let tableAt       = { ...TABLE_CAMERA_REST };   // where the camera is
let tableTo       = { ...TABLE_CAMERA_REST };   // where it is going
let tableFrameId  = 0;
let tableFrameAt  = 0;       // when the last frame ran, while frames are running
let tableResizeId = 0;
let tableWatch    = null;    // the observer keeping the rim in step with the sidebar
let tableScrollY  = 0;       // where the page was scrolled to before the table
let tableEscTaken = false;   // whether this Escape was somebody else's
let tablePanel    = null;    // { tab, kind, pane, mark } — the pane in the panel

let tableCards    = [];      // [{ key, name, imageUrl, group, open, x, y, turn, rank, el }]
let tableCardSize = { w: TABLE_CARD_MIN_W, h: TABLE_CARD_MIN_W * TABLE_CARD_RATIO };
let tablePlaced   = false;   // whether anything has laid cards yet
let tableHintText = TABLE_HINT;
let tableFeature  = false;   // whether the mat holds the Card tab's one large card
let tableLaid     = null;    // { tab, sig } — which tab laid what is on the mat
const tableAsked  = new Set();   // names whose pictures have been asked for
let tablePaneWatch = null;   // the observer on the pane of a tab with cards
let tableRelayId  = 0;
let tableRelaySince = 0;     // when the pane's current run of writes began
let tableActedAt  = 0;       // when something was last done in the pane, or 0
let tableTucked   = false;   // whether the panel is tucked away now
let tableTuckKept = false;   // whether the user's last choice was to tuck it
const tableMoved  = new Map();   // card key → { x, y, turn }: where a hand put it
let tableHold     = null;    // the card under a pressed pointer
let tableSwallow  = false;   // the click a drag ends with is not a click
let tableLifted   = null;    // { card, box }: a pressed card, as it was drawn held
let tableLooked   = null;    // the card picked up to be looked at
let tableDecodeK  = 1;       // how much larger than its card a picture is laid out
let tableHiRes    = false;   // whether the cards are drawn from Scryfall's large pictures
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

/* The icon of the one tab with no sidebar button to borrow one from: Leave
 * table, which puts the page back with its sidebar — so a page with a sidebar
 * down its side, drawn in the sidebar's own hand (24-unit box, 2.2 stroke,
 * round ends). */
const TABLE_LEAVE_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/>' +
  '<line x1="9" y1="3" x2="9" y2="21"/></svg>';

/* The tabs lying on one edge. Each is a slot — the button — holding a chip,
 * the face: an icon at rest, and its label beside it while it is pointed at
 * or focused (table.css). The label is drawn, so it is read; and it is the
 * button's accessible name too, said once as aria-label, so that a chip
 * whose label is folded away to nothing is still called what it is. A tab
 * carries data-tab, which is what gives it its tab's accent (tokens.css, §3)
 * for the state it marks; the Appearance one carries .appearance-trigger,
 * which is how main.js's outside-click handler knows the click that opens
 * the popover is not a click outside it. */
function tableRimHtml(edge) {
  return TABLE_RIM.map((entry, i) => {
    if (entry.edge !== edge) return '';
    const nav   = document.getElementById(tableNavId(entry) || '');
    const icon  = nav?.querySelector('svg')?.outerHTML || (entry.act === 'leave' ? TABLE_LEAVE_ICON : '');
    const cls   = `table-tab${entry.act === 'appearance' ? ' appearance-trigger' : ''}`;
    const tab   = entry.tab ? ` data-tab="${entry.tab}"` : '';
    const label = esc(tableRimLabel(entry));
    return `<button type="button" class="${cls}" data-rim="${i}"${tab} aria-label="${label}">` +
           `<span class="table-tab-face">${icon}<span class="table-tab-label" aria-hidden="true">${label}</span></span></button>`;
  }).join('');
}

function tableBuild() {
  const body  = document.body;
  const scene = document.createElement('div');
  scene.className = 'table-scene';
  scene.id = 'tableScene';
  scene.style.setProperty('--table-tilt', `${TABLE_TILT_REST}deg`);
  scene.innerHTML = `
    <div class="table-camera" id="tableCamera">
    <div class="table-plane" id="tablePlane">
      <div class="table-rim table-rim--far" role="group" aria-label="Tabs on the far edge">${tableRimHtml('far')}</div>
      <div class="table-rim table-rim--left" role="group" aria-label="Tabs on the left edge">${tableRimHtml('left')}</div>
      <div class="table-mat" id="tableMat">
        <p class="table-hint" id="tableHint" hidden></p>
      </div>
      <div class="table-rim table-rim--right" role="group" aria-label="Tabs on the right edge">${tableRimHtml('right')}</div>
      <div class="table-rim table-rim--near"></div>
    </div>
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
  /* The title is a button that only works while the panel is tucked — it is
     then all of the panel there is to press. "Show table" is offered by a tab
     with cards (data-cards, table.css). */
  panel.innerHTML = `
    <div class="drawer-hdr table-panel-hdr">
      <button type="button" class="table-panel-title" data-table-untuck disabled>
        <span class="drawer-title" id="tablePanelTitle"></span>
      </button>
      <button type="button" class="btn-secondary table-panel-tuck" data-table-tuck>Show table</button>
      <button type="button" class="drawer-close" data-table-close title="Close" aria-label="Close">✕</button>
    </div>
    <div class="table-panel-body"></div>`;

  /* Behind the card, a button the size of the window: whatever is clicked
     while a card is being looked at puts it back, and Enter does from the
     keyboard. The image is the app's .card-img, so it wears a card's corner,
     edge and shadow — and takes no pointer of its own, so js/cardlift.js never
     finds it to lift and a click on it is the button's. Under it, Details,
     which is the one thing on the window that is not "put it back". */
  const look = document.createElement('div');
  look.className = 'table-look';
  look.id = 'tableLook';
  look.hidden = true;
  look.innerHTML = `
    <button type="button" class="table-look-back"></button>
    <img class="card-img table-look-card" alt="" draggable="false">
    <button type="button" class="btn-secondary table-look-details">Details</button>`;

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
    camera:     scene.querySelector('#tableCamera'),
    plane:      scene.querySelector('#tablePlane'),
    mat:        scene.querySelector('#tableMat'),
    hint:       scene.querySelector('#tableHint'),
    panelHdr:   panel.querySelector('.table-panel-hdr'),
    panelTitle: panel.querySelector('#tablePanelTitle'),
    panelUntuck: panel.querySelector('[data-table-untuck]'),
    panelBody:  panel.querySelector('.table-panel-body'),
    lookBack:   look.querySelector('.table-look-back'),
    lookImg:    look.querySelector('img'),
    lookDetails: look.querySelector('.table-look-details'),
  };

  /* Listeners on the elements go with them when the scene is taken down. */
  tableEls.plane.addEventListener('click', tableOnPlaneClick);
  scene.addEventListener('wheel', tableOnWheel, { passive: false });
  tableEls.mat.addEventListener('pointerdown', tableOnCardDown);
  tableEls.mat.addEventListener('dragstart', e => e.preventDefault());
  panel.querySelector('[data-table-close]').addEventListener('click', () => tableClosePanel());
  panel.querySelector('[data-table-tuck]').addEventListener('click', () => tableTuckPanel(true, { byUser: true }));
  /* Tucked, the whole title bar is the way back, bar the ✕ on it — and bar
     "Show table", whose own click is still on its way up through here having
     just tucked the panel. */
  tableEls.panelHdr.addEventListener('click', e => {
    if (!tableTucked || e.target.closest('[data-table-close], [data-table-tuck]')) return;
    tableTuckPanel(false, { byUser: true });
  });
  /* What counts as the user doing something in the pane: a click, a choice
     made, Enter. Typing does not, and clears what came before it — see
     tableShouldAutoTuck. A select says `input` just before `change`, so a
     choice made from one still counts. */
  const { panelBody } = tableEls;
  const acted = () => { tableActedAt = Date.now(); };
  panelBody.addEventListener('click', acted);
  panelBody.addEventListener('change', acted);
  panelBody.addEventListener('keydown', e => { if (e.key === 'Enter') acted(); });
  panelBody.addEventListener('input', () => { tableActedAt = 0; });
  tableEls.lookBack.addEventListener('click', () => tableLookAway());
  tableEls.lookDetails.addEventListener('click', () => tableOpenDetails());
}

/* The table fitted to the window: its box worked out by tableFitSize and
 * handed to table.css as --table-x/-y/-w/-h on the scene. The far edge is
 * asked to sit a gutter below the window's top, plus the pan at rest's reach,
 * so a lean towards you never carries a far tab out of the window — and the
 * tabs on that edge are then measured and the room made bigger by whatever
 * they still reach past it. They lie flat inside the rim, so they reach past
 * nothing and the measure changes nothing; it is kept so that a tab that one
 * day stands up off the wood again is still kept in the window. Twice, since
 * a taller table places its tabs a hair differently; the second pass is a
 * fraction of a pixel. Measured with the camera at rest, and put back. */
function tableFitTable() {
  const { scene, camera, plane } = tableEls;
  const view = { width: scene.clientWidth, height: scene.clientHeight };
  const depth = parseFloat(getComputedStyle(camera).perspective);
  const want = TABLE_FIT_GUTTER + TABLE_PAN_REST * view.height;
  const write = top => {
    const box = tableFitSize(view, { perspective: depth > 0 ? depth : Infinity, top });
    if (!box) return false;
    scene.style.setProperty('--table-x', `${box.left.toFixed(2)}px`);
    scene.style.setProperty('--table-y', `${box.top.toFixed(2)}px`);
    scene.style.setProperty('--table-w', `${box.width.toFixed(2)}px`);
    scene.style.setProperty('--table-h', `${box.height.toFixed(2)}px`);
    return true;
  };
  let top = want;
  if (!write(top)) return;
  const was = camera.style.transform;
  camera.style.transform = 'none';
  for (let pass = 0; pass < 2; pass++) {
    let highest = Infinity;
    for (const btn of plane.querySelectorAll('.table-rim--far .table-tab')) {
      if (!btn.hidden) highest = Math.min(highest, btn.getBoundingClientRect().top);
    }
    if (!(highest < want - 0.25)) break;
    top += want - highest;
    write(top);
  }
  camera.style.transform = was;
}

/* The geometry the screen-to-mat mapping needs, read off the laid-out boxes
 * rather than the drawn ones: offsetLeft and its siblings are layout, which no
 * transform touches, so they say where the plane is before it is tilted. The
 * mat's content box is where its cards are placed from, so the plane's border
 * and the mat's own are counted in. The perspective is the camera's, and so
 * is the window size the pan is worked out against. */
function tableMeasure() {
  const { camera, plane, mat } = tableEls;
  const cameraStyle = getComputedStyle(camera);
  const planeStyle = getComputedStyle(plane);
  const depth = parseFloat(cameraStyle.perspective);
  tableGeom = {
    perspective: depth > 0 ? depth : Infinity,
    origin: tableParseOrigin(cameraStyle.perspectiveOrigin, camera.clientWidth, camera.clientHeight),
    view: { width: camera.clientWidth, height: camera.clientHeight },
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

/* The camera's transform for where it is now. The lean at rest is a motion of
 * its own, so it goes when cards may not move; the pan that reaches the edges
 * of a zoomed table is how the table is got round, and stays. */
function tableCam() {
  const { width, height } = tableGeom.view;
  return tableCamera(tableAt, width, height, cardMotionOn() ? TABLE_PAN_REST : 0);
}

function tableMatrix() {
  return tablePlaneMatrix({ ...tableGeom, tilt: TABLE_TILT_REST, camera: tableCam() });
}

function tableKick() {
  if (!tableFrameId) tableFrameId = requestAnimationFrame(tableFrame);
}

/* One frame: the camera closes on its target — or jumps there, when cards may
 * not move — and a card in hand is put back under the pointer for wherever
 * the camera now is, at the height it has risen to. The loop asks for
 * another frame only while something is still on its way. */
function tableFrame(now) {
  tableFrameId = 0;
  if (!tableOn) return;
  /* The first frame of a run is an ordinary one, however long the loop was
     asleep before it. */
  const dt = tableFrameAt ? now - tableFrameAt : TABLE_FRAME_MS;
  tableFrameAt = now;
  let more = false;
  if (cardMotionOn()) {
    const step = tableCameraStep(tableAt, tableTo,
      tableEaseFor(dt, TABLE_ZOOM_EASE), tableEaseFor(dt, TABLE_PAN_EASE));
    tableAt = step.at;
    more = !step.settled;
  } else {
    tableAt = { ...tableTo };
  }
  tableEls.camera.style.transform = tableCameraTransform(tableCam());
  tableSharpen();
  if (tableHold && tableCarry(now)) more = true;
  if (more) tableKick();
  else tableFrameAt = 0;
}

/* The pointer, anywhere over the window: where the camera is panning to, and
 * where a card in hand is. */
function tableOnPointerMove(e) {
  if (e.pointerType === 'touch') return;
  tableAim(e.clientX, e.clientY);

  const hold = tableHold;
  if (hold && e.pointerId === hold.id) {
    hold.pointer = { x: e.clientX, y: e.clientY };
    if (!hold.dragging && tableIsDrag(e.clientX - hold.start.x, e.clientY - hold.start.y)) hold.dragging = true;
  }
  tableKick();
}

/* The pan aimed at a window point, the zoom left as it is. */
function tableAim(x, y) {
  const { width, height } = tableGeom.view;
  tableTo = { ...tableTo, ...tablePanTarget(x, y, width, height) };
}

/* The pointer leaving the window altogether: the camera comes back to the
 * middle, at whatever zoom it is. */
function tableOnPointerOut(e) {
  if (e.relatedTarget) return;
  tableTo = { ...tableTo, panX: 0, panY: 0 };
  tableKick();
}

/* The wheel over the table zooms the camera, about the point under the
 * pointer (see tableCamera: the pan aimed at the pointer is what holds that
 * point still). Only over the table — the scene is where this listens, and the
 * floating panel, its tucked bar and the card being looked at are not in it —
 * and not over the Card tab's sheet, which lies on the mat but is a page that
 * scrolls. The wheel's own default is taken: there is nothing behind the
 * table to scroll, and a sideways swipe would otherwise go back a page. A
 * held Ctrl is the browser's own zoom, and is left to it. */
function tableOnWheel(e) {
  if (e.ctrlKey || e.target.closest?.('.table-panel')) return;
  e.preventDefault();
  tableAim(e.clientX, e.clientY);
  tableTo.zoom = tableWheelZoom(tableTo.zoom, e.deltaY, e.deltaMode, tableGeom.view.height);
  tableKick();
}

/* A field being typed in keeps its keys: + − 0 are characters there. */
function tableIsTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']
    .includes(String(el.type).toLowerCase());
}

/* + and = zoom in, − zooms out and 0 goes back to the whole table, about
 * wherever the camera is aimed. Not while a dialog is up, nor with a modifier
 * held — Ctrl with any of them is the browser's own zoom. */
function tableZoomKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || tableIsTyping(e.target)) return false;
  const factor = { '+': TABLE_ZOOM_KEY, '=': TABLE_ZOOM_KEY, '-': 1 / TABLE_ZOOM_KEY }[e.key];
  if (!factor && e.key !== '0') return false;
  if ((typeof modalIsOpen === 'function' && modalIsOpen()) || (typeof faqIsOpen === 'function' && faqIsOpen())) return false;
  tableTo.zoom = factor ? tableZoomBy(tableTo.zoom, factor) : TABLE_ZOOM_MIN;
  tableKick();
  return true;
}

/* A resize changes every size the scene is drawn in, so the table is fitted
 * to the new window, the geometry is read again and the cards are redrawn
 * from where they lie — their places are fractions of the mat, so they keep
 * them. Once per frame however many resize events the window sends. */
function tableOnResize() {
  if (tableResizeId) return;
  tableResizeId = requestAnimationFrame(() => {
    tableResizeId = 0;
    if (!tableOn) return;
    tableFitTable();
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
  if (e.defaultPrevented) return;
  if (e.key !== 'Escape') { tableZoomKey(e); return; }
  if (tableEscTaken) return;
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
  tableAt = { ...TABLE_CAMERA_REST };
  tableTo = { ...TABLE_CAMERA_REST };
  tableDecodeK = 1;
  tableHiRes = false;
  tableBuild();
  tableFitTable();
  tableMeasure();
  tableEls.camera.style.transform = tableCameraTransform(tableCam());
  tableDrawCards();
  tableListen(true);
  tableWatchRim();
  tableRimSync();
  if (!tablePlaced) tableLayFor(tablePageTab());
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
  clearTimeout(tableRelayId);
  tableFrameId = tableResizeId = tableFrameAt = tableRelayId = 0;
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
  const from = tablePanel?.tab ?? null;
  tablePutPaneBack();
  tableUntuck();
  tableActedAt = 0;

  const { panel, panelTitle, panelBody, mat, dim } = tableEls;
  panel.dataset.kind = kind;
  panel.dataset.edge = tableRimEntry(tab)?.edge || 'far';
  panel.toggleAttribute('data-cards', kind === 'float' && tableIsCardTab(tab));
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
  /* Shown before it is fitted, still closed and so still invisible: the
     tucked panel's place is measured from its header, which a hidden panel
     has no height for. */
  panel.classList.remove('is-open');
  panel.hidden = false;
  tableFitPanel();
  tableSyncLane();

  /* Read once so the closed state is drawn before the open one is asked for,
     or the browser would go straight to the end of the transition. */
  void panel.offsetWidth;
  panel.classList.add('is-open');
  dim.classList.toggle('is-on', kind === 'float');
  panel.focus({ preventScroll: true });
  tableRimSync();
  tableWatchPane(pane, tab);
  if (tableTuckOnOpen({ kind, from, to: tab, kept: tableTuckKept })) tableTuckPanel(true);
  return true;
}

function tablePutPaneBack() {
  if (!tablePanel) return;
  tableUnwatchPane();
  const { pane, mark } = tablePanel;
  if (mark.parentNode) {
    mark.parentNode.insertBefore(pane, mark);
    mark.remove();
  }
  tablePanel = null;
}

/* The box a floating panel is drawn in, written over the stylesheet's
 * default (top 10vh, min(900px, 70vw) by 80vh, centred) once the rim can be
 * measured — see tableFloatBox(). The tabs are measured with the camera at
 * rest and the gap widened by how far the pan at rest can carry them, so no
 * lean of the head walks a tab in under the panel. Put back in the same task,
 * so the rest pose is never drawn. A camera zoomed in has carried the tabs
 * elsewhere, and the panel is still fitted to where they lie at rest.
 *
 * What is measured is each tab's slot, the button, not the chip lying in it.
 * The slot is the room the chip's label opens into (table.css): on a side
 * edge the width of the rim, so a label shown under the pointer is never
 * drawn beneath the panel; and the chip sits at the slot's outer end, so on a
 * window narrow enough for the panel to reach over the slots, what it reaches
 * over first is empty wood and the chip is the last thing it would cover. */
const TABLE_FLOAT_PROPS = ['left', 'top', 'width', 'height', 'right', 'margin-inline'];

function tableFitPanel() {
  if (!tablePanel || tablePanel.kind !== 'float' || !tableEls) return;
  const { camera, plane, panel } = tableEls;
  const view = { width: window.innerWidth, height: window.innerHeight };
  const clear = { top: 0, left: 0, right: view.width };
  const was = camera.style.transform;
  camera.style.transform = 'none';
  for (const btn of plane.querySelectorAll('.table-tab')) {
    if (btn.hidden) continue;
    const at = btn.getBoundingClientRect();
    const edge = TABLE_RIM[Number(btn.dataset.rim)]?.edge;
    if (edge === 'far')       clear.top   = Math.max(clear.top, at.bottom);
    else if (edge === 'left') clear.left  = Math.max(clear.left, at.right);
    else if (edge === 'right') clear.right = Math.min(clear.right, at.left);
  }
  camera.style.transform = was;
  const box = tableFloatBox(view, clear, TABLE_PANEL_GAP + TABLE_PAN_REST * view.width);
  panel.style.left   = `${box.left.toFixed(1)}px`;
  panel.style.top    = `${box.top.toFixed(1)}px`;
  panel.style.width  = `${box.width.toFixed(1)}px`;
  panel.style.height = `${box.height.toFixed(1)}px`;
  panel.style.right  = 'auto';
  panel.style.marginInline = '0';
  /* Tucked, it slides down until its header is all that shows, a gap above
     the window's foot — the near edge, where no tabs stand — and between the
     side tabs, where it already is. */
  const header = tableEls.panelHdr.offsetHeight;
  if (header) {
    panel.style.setProperty('--table-tuck-y',
      `${Math.max(0, view.height - TABLE_PANEL_GAP - header - box.top).toFixed(1)}px`);
  }
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
  tableUntuck();
  const { panel, dim, plane } = tableEls;
  panel.hidden = true;
  panel.classList.remove('is-open');
  dim.classList.remove('is-on');
  tableSyncLane();
  tableRimSync();
  if (!quiet) plane.querySelector(`.table-tab[data-tab="${tab}"]`)?.focus({ preventScroll: true });
}

/* Tuck the panel down to its header, or bring it back up. Only a floating
 * panel tucks. `byUser` is the user's own choice — the header's two controls —
 * which is what a panel opened next remembers (tableTuckOnOpen); the panel
 * tucking itself is not a choice of theirs. A drawer open from the pane is
 * closed first: it would be left standing over a page nobody can see. */
function tableTuckPanel(on, { byUser = false } = {}) {
  if (!tablePanel || !tableEls || tablePanel.kind !== 'float') return;
  if (byUser) tableTuckKept = !!on;
  if (!!on === tableTucked) return;
  const { panel, dim, panelUntuck } = tableEls;
  if (on) {
    if (typeof closeDrawers === 'function') closeDrawers();
    tableTucked = true;
    panel.classList.add('is-tucked');
    dim.classList.remove('is-on');
    panelUntuck.disabled = false;
    panelUntuck.title = 'Bring the panel back';
    /* Focus left in the page that has just gone out of sight goes to the
       title bar, which is what is left of it. */
    if (panel.contains(document.activeElement)) panelUntuck.focus({ preventScroll: true });
  } else {
    tableUntuck();
    dim.classList.add('is-on');
    panel.focus({ preventScroll: true });
  }
}

/* The panel's tucked state put back to "not", with nothing else said — for
 * a panel being swapped or closed, which decides the rest itself. */
function tableUntuck() {
  tableTucked = false;
  if (!tableEls) return;
  const { panel, panelUntuck } = tableEls;
  panel.classList.remove('is-tucked');
  panelUntuck.disabled = true;
  panelUntuck.removeAttribute('title');
}

// ── Each tab's cards ──────────────────────────────────────────────────────

/* A picture the app already has for a card by name, or nothing. */
function tableImageOf(name) {
  return (typeof scryfallCache !== 'undefined' && scryfallCache.get(name)) || '';
}

/* A Scryfall card's picture: its own, or its front face's. */
function tableScryfallImage(card) {
  return card?.image_uris?.normal || card?.card_faces?.[0]?.image_uris?.normal || '';
}

/* What each tab with cards lays, read from what its renderer last drew — see
 * the header. Each answers { cards, hint, fetch?, feature? }: the cards as
 * layCards takes them, what the mat says if there are none, whether the
 * pictures the tab lacks should be asked for by name (the tabs whose own
 * views draw no pictures, or only some), and whether the one card is laid
 * large. The Card tab answers null while it has shown no card, which leaves
 * the mat as it is. */
const TABLE_SOURCES = Object.freeze({
  collections() {
    const piles = typeof colShownPiles === 'function' ? colShownPiles() : null;
    return {
      cards: tableFromPiles(piles, row => ({ name: row.name, imageUrl: tableImageOf(row.name) })),
      hint: TABLE_EMPTY_HINT, fetch: true,
    };
  },
  deckview() {
    const piles = typeof dbShownPiles === 'function' ? dbShownPiles() : null;
    if (!piles) return { cards: [], hint: 'Open a deck from Decks' };
    return {
      cards: tableFromPiles(piles, card => ({ name: card.name, imageUrl: card.image || tableImageOf(card.name) })),
      hint: TABLE_EMPTY_HINT, fetch: true,
    };
  },
  players() {
    const piles = (typeof decksShown === 'function' && decksShown()) || [];
    return {
      cards: tableFromPiles(piles.map(pile => ({
        key: pile.key, label: pile.label,
        cards: (pile.decks || []).map(deck => ({ deck, playerId: pile.playerId })),
      })), ({ deck, playerId }) => ({
        name: deck.name || 'Untitled deck',
        id: `${playerId}|${deck.id}`,
        imageUrl: deck.commanderImg || '',
        /* The deck's Build button, pressed: the Deck Builder, on it. */
        open: () => { if (typeof openInDeckView === 'function') openInDeckView(playerId, deck.id); },
      })),
      hint: 'No decks to show',
    };
  },
  scryfall() {
    const results = (typeof sfShownCards === 'function' && sfShownCards()) || [];
    return {
      cards: results.map(card => ({ name: card.name, id: card.id, imageUrl: tableScryfallImage(card) })),
      hint: 'Search Scryfall to lay the results here',
    };
  },
  sets() {
    const piles = typeof setShownPiles === 'function' ? setShownPiles() : null;
    if (!piles) return { cards: [], hint: 'Open a set to lay its cards here' };
    return {
      cards: tableFromPiles(piles, card => ({ name: card.name, id: card.id, imageUrl: tableScryfallImage(card) })),
      hint: TABLE_EMPTY_HINT,
    };
  },
  wants() {
    const lists = (typeof wantShownLists === 'function' && wantShownLists()) || [];
    const known = name => (typeof wantCardData !== 'undefined' ? wantCardData.get(name) : null);
    return {
      cards: tableFromPiles(lists, (name, list) => ({
        name, id: `${list.key}:${name}`,
        imageUrl: tableScryfallImage(known(name)) || tableImageOf(name),
      })),
      hint: 'No want lists yet', fetch: true,
    };
  },
  card() {
    const shown = typeof cardDetailShown === 'function' ? cardDetailShown() : null;
    if (!shown) return null;
    return { cards: [{ name: shown.name, id: shown.id, imageUrl: shown.imageUrl }], feature: true };
  },
});

/* What a tab lays, or null for a tab that lays nothing. */
function tableSourceFor(tab) {
  return Object.prototype.hasOwnProperty.call(TABLE_SOURCES, tab) ? TABLE_SOURCES[tab]() : null;
}

/* The tab the page itself is showing, which is what the table lays when it
 * comes up with no panel open. */
function tablePageTab() {
  return document.querySelector?.('.tab-btn.active')?.id?.replace(/^tab-btn-/, '') || null;
}

/* Lay what a tab is showing. A list the mat already holds, from the same tab
 * and in the same piles, is not laid again — only its pictures are brought up
 * to date — so nothing moves when nothing changed. Returns whether cards were
 * laid; a tab that lays nothing returns false and leaves the mat alone. */
function tableLayFor(tab) {
  const source = tableSourceFor(tab);
  if (!source) return false;
  const sig = tableListSig(source.cards, tab, source.feature);
  if (tableLaid && tableLaid.tab === tab && tableLaid.sig === sig) {
    tablePatchImages(source.cards, tab);
    return false;
  }
  tableLayCards(source.cards, { hint: source.hint, scope: tab, feature: source.feature });
  tableLaid = { tab, sig };
  if (source.fetch) tableFetchImages(tab);
  return true;
}

/* Pictures for the cards on the mat that have none, asked for by name — once
 * each per session, so a name Scryfall has no picture for is not asked about
 * on every redraw — and put on the cards when they come, if the same tab's
 * cards are still the ones lying there. */
function tableFetchImages(tab) {
  if (typeof ensureScryfallImages !== 'function') return;
  const names = [...new Set(tableCards.filter(card => !card.imageUrl).map(card => card.name))]
    .filter(name => !tableAsked.has(name));
  if (!names.length) return;
  for (const name of names) tableAsked.add(name);
  Promise.resolve(ensureScryfallImages(names))
    .catch(() => {})
    .then(() => { if (tableOn && tableLaid?.tab === tab) tableLayFor(tab); });
}

/* The same cards as are lying on the mat, some of them with a picture now. */
function tablePatchImages(list, scope) {
  const fresh = new Map(tableKeyCards(list, scope).map(card => [card.key, card.imageUrl]));
  for (const card of tableCards) {
    const url = fresh.get(card.key);
    if (!url || url === card.imageUrl) continue;
    card.imageUrl = url;
    if (card.el) card.el.innerHTML = tableCardFace(card);
  }
}

/* Watch a tab's pane while it is open in a panel, so that its cards are laid
 * again whenever it is redrawn. What the pane holds is what is watched, not
 * its attributes: a redraw writes markup, and a hover or a focus ring only
 * writes attributes. */
function tableWatchPane(pane, tab) {
  tableUnwatchPane();
  if (!tableIsCardTab(tab) || typeof MutationObserver !== 'function') return;
  tablePaneWatch = new MutationObserver(() => tableQueueRelay(tab));
  tablePaneWatch.observe(pane, { childList: true, subtree: true, characterData: true });
}

function tableUnwatchPane() {
  tablePaneWatch?.disconnect();
  tablePaneWatch = null;
  clearTimeout(tableRelayId);
  tableRelayId = 0;
}

/* Once the pane has finished redrawing: its cards laid again, and the panel
 * tucked out of their way if they came of something the user did in it. */
function tableQueueRelay(tab) {
  const now = Date.now();
  if (tableRelayId && now - tableRelaySince >= TABLE_RELAY_MAX_MS) return;   // it is coming
  if (!tableRelayId) tableRelaySince = now;
  clearTimeout(tableRelayId);
  const wait = Math.min(TABLE_RELAY_MS, Math.max(0, tableRelaySince + TABLE_RELAY_MAX_MS - now));
  tableRelayId = setTimeout(() => {
    tableRelayId = 0;
    if (!tableOn || tablePanel?.tab !== tab) return;
    if (!tableLayFor(tab)) return;
    const actedAgo = tableActedAt ? Date.now() - tableActedAt : Infinity;
    if (tableShouldAutoTuck({ kind: tablePanel.kind, tab, tucked: tableTucked, actedAgo })) tableTuckPanel(true);
    tableActedAt = 0;
  }, wait);
}

// ── Cards ─────────────────────────────────────────────────────────────────

/* Lay a list of cards on the mat. Each is { name, imageUrl, id?, group? };
 * cards past TABLE_CARDS_MAX are not drawn. A card is known across calls by
 * its id, or its name where it has none, numbered by how often that has come
 * up — so a card a hand moved earlier in the session lies where it was put
 * when the same list is laid again. */
function tableLayCards(list, { hint, scope = '', feature = false } = {}) {
  tablePlaced = true;
  tableLaid = null;   // whoever called, it is not a tab's list until tableLayFor says so
  if (tableHold) tableRelease({ pointerId: tableHold.id });
  tableLookAway(true);
  tableCards = tableKeyCards(list, scope)
    .map((card, i) => ({ ...card, x: 0.5, y: 0.5, turn: 0, rank: i, el: null }));
  tableFeature = !!feature && tableCards.length > 0;
  tableHintText = hint || TABLE_HINT;
  if (tableOn) tableDrawCards();
  return tableCards.length;
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

/* The picture a card is drawn from: its own, or Scryfall's large one of it
 * once the table has needed those (tableSharpen). */
function tableCardSrc(card) {
  return tableHiRes ? tableLargeImage(card.imageUrl) : card.imageUrl;
}

/* The cards' pictures kept sharp for the zoom the camera is at or on its way
 * to, whichever is the larger — so a zoom in has its pictures decoding while
 * the camera is still travelling, and a zoom out keeps them until it has
 * arrived. Both are written only when they change: --table-card-k on the
 * scene (table.css lays each picture out that many times larger, and scales
 * it back), and the switch to large pictures, which once made is kept while
 * the table is up: a zoom back out has them already, and swapping back would
 * only be a second set of requests for a smaller picture. A picture whose src
 * changes keeps showing the old one until the new one has arrived. */
function tableSharpen() {
  if (!tableEls) return;
  const zoom = Math.max(tableAt.zoom, tableTo.zoom);
  const k = tableDecodeScale(zoom, window.devicePixelRatio);
  if (k !== tableDecodeK) {
    tableDecodeK = k;
    tableEls.scene.style.setProperty('--table-card-k', String(k));
  }
  if (tableHiRes || !tableNeedsLarge(tableCardSize.w, zoom, window.devicePixelRatio)) return;
  tableHiRes = true;
  for (const card of tableCards) {
    const img = card.el?.isConnected && card.el.querySelector('.table-card-img');
    if (img) img.src = tableCardSrc(card);
  }
}

/* A card that has no picture is not drawn as one: it keeps a surface and its
 * name, as the stacks' blank does. */
function tableCardFace(card) {
  return card.imageUrl
    ? `<img class="card-img table-card-img" src="${esc(tableCardSrc(card))}" alt="" draggable="false">`
    : `<span class="table-card-blank">${esc(card.name)}</span>`;
}

function tableCardEl(card) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'table-card';
  el.setAttribute('aria-label', card.open ? `Open ${card.name}` : card.name);
  el.innerHTML = tableCardFace(card);
  el.addEventListener('click', tableOnCardClick);
  return el;
}

function tableDrawCards() {
  if (!tableEls || !tableGeom) return;
  const { mat, hint } = tableEls;
  for (const old of mat.querySelectorAll('.table-card')) old.remove();
  const { width, height } = tableGeom.mat;
  const layout = tableFeature ? tableFeatureLayout(tableCards, width, height) : tableLayout(tableCards, width, height);
  tableCardSize = { w: layout.width, h: layout.height };
  /* Asked before the pictures are written, so a large card on a hi-dpi
     screen — the Card tab's — is drawn from the large picture straight away
     rather than from the normal one and then again. */
  tableSharpen();
  const places = tablePlaceCards(tableCards, layout.spots, tableMoved);
  const cards = document.createDocumentFragment();
  tableCards.forEach((card, i) => {
    Object.assign(card, places[i]);
    card.el = tableCardEl(card);
    card.el.style.width  = `${tableCardSize.w}px`;
    card.el.style.height = `${tableCardSize.h.toFixed(2)}px`;
    cards.append(card.el);
  });
  mat.insertBefore(cards, hint);
  for (const card of tableCards) tableWriteCard(card);
  hint.textContent = tableHintText;
  hint.hidden = tableCards.length > 0;
  tableSyncLane();
}

/* The lane the Card tab's sheet leaves free down the mat's right-hand side
 * for its card — there while the sheet is open with the card lying beside it,
 * and nowhere else — handed to table.css as --table-sheet-lane. */
function tableSyncLane() {
  if (!tableEls) return;
  const lane = tablePanel?.kind === 'grow' && tableFeature && tableGeom
    ? tableFeatureSize(tableGeom.mat.width, tableGeom.mat.height).lane : 0;
  if (lane) tableEls.panel.style.setProperty('--table-sheet-lane', `${lane}px`);
  else tableEls.panel.style.removeProperty('--table-sheet-lane');
}

/* The mat changed size: the cards keep their places, which are fractions of
 * it, and take the card size the new mat wants. */
function tableResizeCards() {
  /* The large card's place is worked out from the lane, which a new mat
     width moves, so it is laid again rather than resized where it was. */
  if (tableFeature) { tableDrawCards(); return; }
  const w = tableCardWidth(tableGeom.mat.width);
  tableCardSize = { w, h: w * TABLE_CARD_RATIO };
  tableSharpen();
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

/* A press on a card picks it up at once: it is raised above every other card
 * and starts to rise off the felt on the frame loop (tableCarry), before the
 * pointer has moved at all. Whether it is then carried or looked at is
 * decided later — by the pointer travelling TABLE_DRAG_START, or not. */
function tableOnCardDown(e) {
  tableSwallow = false;
  if (e.button !== 0 || e.pointerType === 'touch' || tableLooked || tableHold) return;
  const el = e.target.closest?.('.table-card');
  const card = el && tableCards.find(c => c.el === el);
  if (!card) return;
  const hit = tableUnproject(tableMatrix(), e.clientX, e.clientY, tableCardZ(card));
  if (!hit) return;
  const { width, height } = tableGeom.mat;
  tableHold = {
    card, id: e.pointerId, dragging: false, lift: 0,
    since:   performance.now(),
    start:   { x: e.clientX, y: e.clientY },
    pointer: { x: e.clientX, y: e.clientY },
    /* Where it lay, for a press that turns out to be a click: the card rises
       keeping the hand's point under the pointer, which moves it a little
       across the mat, and a card only looked at is put back where it was. */
    from:    { x: card.x, y: card.y },
    /* Where on the card the hand closed, in the mat's pixels: the card is kept
       with that point under the pointer for the rest of the journey. */
    grab: { u: hit.u - card.x * width, v: hit.v - card.y * height },
  };
  try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
  tableRaise(card);
  el.classList.remove('is-settling');
  el.classList.add('is-held');
  tableKick();
}

/* One frame of a card in hand. It rises to its lifted height in
 * TABLE_LIFT_MS from the press (tableLiftHeight) — none when cards may not
 * move: then it is held, not lifted, and still follows the hand — and is
 * placed so that the point the hand closed on is where the pointer's ray meets
 * the plane at the card's current height, through the camera as it is this
 * frame, so a card in hand stays under the pointer while the table pans or
 * zooms beneath it. Returns whether it is still rising, which is what asks
 * for another frame. */
function tableCarry(now) {
  const hold = tableHold;
  const card = hold.card;
  const motion = cardMotionOn();
  hold.lift = tableLiftHeight(now - hold.since, motion);

  const hit = tableUnproject(tableMatrix(), hold.pointer.x, hold.pointer.y, tableCardZ(card) + hold.lift);
  if (hit) {
    const { width, height } = tableGeom.mat;
    card.x = Math.min(1, Math.max(0, (hit.u - hold.grab.u) / width));
    card.y = Math.min(1, Math.max(0, (hit.v - hold.grab.v) / height));
  }
  const lean = TABLE_CARD_LIFT ? -TABLE_CARD_LEAN * hold.lift / TABLE_CARD_LIFT : 0;
  tableWriteCard(card, hold.lift, lean);
  return hold.lift !== tableLiftHeight(Infinity, motion);
}

/* Let go. A drag puts the card down where it is, in the card layer's own
 * time (table.css, .is-settling). A press that never became a drag is left to
 * the card's own click, which comes straight after this: the card goes back
 * to where it lay, and — if the click will pick it up to look at it — the
 * box it is drawn in up here is kept for tableLookAt to rise from, so it goes
 * on up to face the viewer from where the hand had it rather than dropping
 * first. Nothing is drawn between a pointerup and its click, so the card put
 * back at rest under the picture never shows. A card the click opens, or
 * one with no picture to look at, settles back down instead. */
function tableRelease(e) {
  const hold = tableHold;
  if (!hold || (e && e.pointerId !== hold.id)) return;
  tableHold = null;
  const card = hold.card;
  if (hold.dragging) {
    tableSwallow = true;
    tableMoved.set(card.key, { x: card.x, y: card.y, turn: card.turn });
  } else {
    card.x = hold.from.x;
    card.y = hold.from.y;
  }
  if (!card.el) return;
  const el = card.el;
  const looks = !hold.dragging && !card.open && !!card.imageUrl && e?.type === 'pointerup';
  if (looks) tableLifted = { card, box: el.getBoundingClientRect() };
  el.classList.remove('is-held');
  if (!looks) el.classList.add('is-settling');
  tableWriteCard(card);
  if (!looks) tableAfter(el, () => el.classList.remove('is-settling'));
}

function tableOnCardClick(e) {
  const lifted = tableLifted;
  tableLifted = null;
  if (tableSwallow) { tableSwallow = false; return; }
  const card = tableCards.find(c => c.el === e.currentTarget);
  if (!card) return;
  if (card.open) card.open();
  else tableLookAt(card, lifted?.card === card ? lifted.box : null);
}

/* The transform that puts the large card where the small one lies on the
 * table: the same centre, the same angle, the size it is drawn at there. The
 * box the table card is measured by is its drawn box, foreshortened and
 * turned, which is what the eye sees it as — or `box`, a box it was drawn in
 * a moment ago, for a card just let go of in the hand. */
function tableFlipFrom(fromEl, toEl, turn, box = null) {
  const from = box || fromEl.getBoundingClientRect();
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
 * and comes to rest large in the middle of the window — from `from`, the box
 * it was drawn in held in the hand, when a press has just lifted it, and
 * otherwise from where it lies. The card on the mat is hidden rather than
 * moved, so its place is kept for it. */
function tableLookAt(card, from = null) {
  if (!card.imageUrl || !card.el || tableLooked) return;
  const { look, lookImg } = tableEls;
  /* A card still on its way back down from the last look is overtaken: its
     ending is this sequence number's to check, and it is no longer current. */
  tableLookSeq++;
  tableLooked = card;
  const { lookBack, lookDetails } = tableEls;
  lookImg.src = tableCardSrc(card);
  lookBack.setAttribute('aria-label', `Put ${card.name} back`);
  lookDetails.title = `Open ${card.name} on the Card tab`;
  look.classList.remove('is-up');
  look.hidden = false;
  /* Drawn first where the card lies, with no transition, then let go: the
     transition carries it from there to its place in the middle. */
  lookImg.style.transition = 'none';
  lookImg.style.transform = tableFlipFrom(card.el, lookImg, card.turn, from);
  void lookImg.offsetWidth;
  lookImg.style.removeProperty('transition');
  lookImg.style.removeProperty('transform');
  look.classList.add('is-up');
  card.el.classList.add('is-looked');
  lookBack.focus({ preventScroll: true });
}

/* And put it back, to wherever its place on the table now is — the view may
 * have moved while it was being looked at. `instant` is for the mode going
 * away, which has no time to wait for it. */
function tableLookAway(instant = false) {
  const card = tableLooked;
  if (!card || !tableEls) return;
  tableLooked = null;
  const { look, lookImg } = tableEls;
  look.classList.remove('is-up');
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

/* Details: the card being looked at put down, and opened on the Card tab —
 * which here is the sheet lying on the mat, with the card laid large beside
 * it once the tab has drawn it. */
function tableOpenDetails() {
  const card = tableLooked;
  if (!card) return;
  tableLookAway(true);
  if (typeof openCardPage === 'function') openCardPage(card.name);
}

// ── What main.js tells the table ─────────────────────────────────────────

/* Called first thing in setTab(): a tab opened from anywhere while the table
 * is up has its pane carried into a panel before its init draws into it. */
function tableModeBeforeTab(tab) {
  if (tableOn && tablePanel?.tab !== tab) tableShowPane(tab);
}

/* Called last thing in setTab(): the tab's cards on the mat, if it has any —
 * what it showed the last time it drew; a redraw the open brings on lays them
 * again (tableWatchPane) — and the news for anyone else listening. */
function tableModeAfterTab(tab) {
  if (!tableOn) return;
  tableLayFor(tab);
  document.dispatchEvent(new CustomEvent('tablemode:tab', {
    detail: { tab, kind: tablePanel?.tab === tab ? tablePanel.kind : null },
  }));
}

/* Called once the first state has arrived — on a load with the mode already
 * on, the table was set before there was anything to put on it. */
function tableModeStateLoaded() {
  if (tableOn && !tablePlaced) tableLayFor(tablePageTab());
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
