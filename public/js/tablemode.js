// ── Table mode ────────────────────────────────────────────────────────────
// An experiment, and an opt-in one: the whole app as a table seen from a seat.
// The user's playmat lies in the middle of it, framed by a wooden rim, and the
// table is tilted away from the viewer the way a table is when you sit at it.
// The tabs are no longer a sidebar. They are physical tabs lying on the rim —
// chips on the wood down the two side edges, an icon each, that show their
// label when pointed at — and pressing one lifts that tab's page up off the
// table to be read.
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
//         .table-rim   the four edges; the tabs lie on the two side ones —
//                      the card tabs down the right, the rest and the
//                      account in two groups down the left
//         .table-mat   the playmat (or the theme's felt), where cards lie,
//                      and the landing mark of the card in hand; the Deck
//                      Builder's slip and bin are its children too, laid out
//                      over the far rim above it
//   .table-dim     the slight veil over the table while a panel floats
//   .table-panel   the panel host — see "Panels" below
//   .table-look    a card picked up to be looked at, facing the viewer
//   .table-slip-pop  the slip's suggestions, flat over the window
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
// bottom corners and its far edge close to the top. A perspective makes that
// a question with an answer rather than a percentage to tune: tableFitSize
// works out the plane's laid-out size and place that land those edges there
// at the rest tilt, and tableFitTable hands them to table.css. Again on every
// resize. The side rims are one chip wide, so nearly all of the width the
// fit gives the table is mat.
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
//          between the tabs lying down the two side edges, and the room
//          their labels open into (tableFloatBox), because a tab has to stay
//          pressable while its page floats: pressed again it puts the page
//          down, and any other tab swaps it.
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
// The Card sheet opened over another view — from a card's "Details", or its
// tab pressed while another tab's panel was up or another tab's cards lay on
// the mat — closes back to that view rather than to an empty table: the tab
// it was opened over, its panel open, tucked or closed as it was left, and
// its cards laid again where a hand had put them (tableCardReturnFor,
// tableDismissPanel, tableRestoreView). Where the history allows it the close
// is the browser's Back (tableReturnByBack), so the close and Back pressed
// with the sheet up are one path through setTab() and never two steps.
//
// ── Tucking a panel away ──────────────────────────────────────────────────
// A tab with cards (TABLE_CARD_TABS) floats its controls — the search box, the
// sort, the deck picker — over the very table its cards are laid on, so its
// panel can be tucked: "Show table" in its header slides it down until only
// that header shows, flat at the foot of the window and between the side
// tabs — clear of the account's group at the near end of the left edge — and
// the table is undimmed. Pressing the header brings it back. Moved
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
// in the table's plane, with a landing mark — the card's outline, ringed
// in the theme's ink — on the spot it would land on if let go now
// (tableDropSpot, tableCastPose), drawn over the piles it falls across but
// under the card in hand (tableCastTransform) — the very spot it comes down
// onto when it is, so the mark is never a guess. Let go
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
//   deckview     dbShownPiles()      js/deckview-render.js  a pile per category,
//                dbShownCommanders()                         and the commander —
//                                                            a board of its own,
//                                                            not a category — at
//                                                            the head of the mat
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
// A pile is a group; a tab's hundred cards (TABLE_TAB_CARDS_MAX) are shared
// out across the piles fairly (tableFairShare), so a deep first pile does not
// leave the rest of the table empty. The Deck Builder is the exception: it
// lays the whole deck, a card for each entry with its count on it when it has
// more than one copy (TABLE_DECK_CARDS_MAX). Every other tab leaves the mat
// as it is. A redraw that changes
// nothing about which cards lie where — the pictures arriving, a poll that
// found the same state — puts the pictures in and moves nothing; one that
// does lays the cards again, and a card a hand moved stays where it was put
// (tableMoved, keyed by tab and card).
//
// ── The Deck Builder's table ─────────────────────────────────────────────
// The deck is not only shown on the table; it can be changed from it, for a
// deck the user may edit (tableToolsShown), through the builder's own edits
// in js/deckview-edit.js so that the category rules, the save and the
// history stay the builder's:
//
//   the commander  lies at the head of the mat, at the far side, a tenth
//                  larger than the rest (TABLE_HEAD_SCALE), with its partner
//                  beside it; the piles are laid below it, never across it
//   the slip       lies on the far rim, in the middle: a field on the app's
//                  own card autocomplete, whose suggestions float flat over
//                  the window below it. Enter, or a suggestion, adds one
//                  copy (dbAddCard), and the card comes in from the slip to
//                  its pile. `/` puts the field in hand.
//   the bin        lies on the far rim, towards its right-hand end. A card
//                  carried over it lights it — hit-tested in the table's
//                  plane, by the pointer mapped through the camera as the
//                  card in hand is, the rim being the same plane as the mat —
//                  and let go there, one copy goes (tableBinAction:
//                  dbChangeQty by -1, or dbRemoveCard for the last) and the
//                  card goes into the bin. "Remove one" under a card being
//                  looked at does the same. The app's notice says what went;
//                  there is no undo beyond the deck's history. "Add one"
//                  beside it puts one more copy in, by the builder's own
//                  stepper (tableAddOne: dbChangeQty by +1), the count on the
//                  card changing where it lies — never for a commander, which
//                  the builder offers no second copy of.
//   the drawer     Search, EDHREC and Lands, the builder's drawer's three tabs,
//                  a chip each on the far rim right of the slip: the drawer
//                  itself lent to a panel of its own docked to the left of the
//                  window, beside the table, where a card added from it is
//                  seen landing and the drawer stays as it was for the next.
//                  See "The Deck Builder's drawer, on the table", below.
//
// A table card knows its deck card by its ref — board and name, the builder's
// own key for it (dbCardRef) — carried from the getters through the source
// and kept on the card, and keyed by it, so a commander and a mainboard copy
// of the same name are two cards on the mat.
//
// And the deck can be laid a zone per category instead of a pile per one: the
// Zones chip on the far rim beside the slip, kept per browser. A zone is a
// rectangle on the felt that lays its own cards out to fit it, moved by its
// label, resized by its grip, renamed in place; a card carried into another
// zone moves into that category by the builder's own drop. Off, the piles are
// exactly as they were. See "The Deck Builder's zones", its own section below.
//
// ── The card-size slider ─────────────────────────────────────────────────
// On the far rim's left-hand end, on every tab that lays cards: the cards
// drawn from half their size to half as large again, kept per browser
// (TABLE_CARD_SCALE_*). At its rest, 100%, every layout is the one the table
// has always laid; moved, it resizes the cards where they lie rather than
// laying them again. See its own section below.
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
//                                            → how many were laid (≤ 100,
//                                              or ≤ 250 for scope 'deckview').
//                                              cards: [{ name, imageUrl, id?,
//                                              group?, open?, qty? }] — qty, the
//                                              copies one card stands for, is
//                                              said on it past 1; open(), where
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
// test/tablemode.test.js: the panel kind per tab, which tab stands on which
// edge and in which group, the drag threshold, the table's fit to the window, the pointer-to-pan mapping, the wheel's zoom and
// the camera's easing, how large a card's picture is laid out and which file
// it comes from, the lift, the screen-to-mat mapping through the camera, the
// floating panel's box, the layout and its head band, what each tab lays and
// how it is piled, where a re-laid card goes, when a panel tucks, where a
// card in hand lands and its landing mark lies, and the Deck Builder's slip and
// bin: when they show, the bin's hit on the rim, and what a card put in it
// does to the deck — and its zones: how a zone fits its cards, how the zones
// are laid out the first time and kept, which zone a card is let go over, and
// who may change them; the card-size slider's range and keeping, the layouts
// at its every size, and the pictures it asks for; the drawer's chips, where
// its panel docks, and what it leaves untucked; and what Add one does.

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
 * edge the same gutter below the window's top, plus room for the pan at rest
 * to carry the table down by TABLE_PAN_REST without the far rim, and what
 * lies on it, leaving the window. */
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

/* How many cards the mat lays: two caps, because the two kinds of tab ask
 * different things of it. The Deck Builder lays the deck — every entry of it,
 * the commanders and each category's cards, one table card an entry however
 * many copies it has (a count on the card says how many, tableCardFace) — so
 * a deck is never shown with a third of it missing, and a card carried into
 * another zone is never one the mat then has no room for. Up to
 * TABLE_DECK_CARDS_MAX entries, a ceiling no real deck reaches and only there
 * so that a pasted list of thousands cannot lay thousands. Every other tab —
 * Collections, Search, Sets, Wants, Decks — shows a slice of something that
 * can run to thousands, and lays TABLE_TAB_CARDS_MAX of it, shared fairly
 * among its piles (tableFairShare). Which cap applies is the scope's
 * (tableCardsMaxFor); the deck's is also the most the mat ever holds, which
 * is what its depth is budgeted for, below. */
const TABLE_DECK_CARDS_MAX = 250;
const TABLE_TAB_CARDS_MAX  = 100;

/* How many cards may lie on the mat each casting its own shadow at rest. A
 * card's shadow is a drop-shadow filter on its picture, and a filter on a
 * face of a 3D scene is drawn on its own surface and blurred again every
 * frame the camera moves — most of what a card costs to draw: measured over
 * a pan in headless Firefox at 1440×900, 206 cards drew a frame in about
 * 200ms with their shadows and 95ms without, against 47ms for the table with
 * no cards at all. Up to sixty, as many as the table always drew, every card
 * keeps its shadow and the table is what it was. Past that, a card lying
 * still casts none (table.css, .table-mat[data-many]) — in a pile of a
 * hundred most of each shadow falls on the card under it, out of sight —
 * and the one card in hand, or coming down, casts its own as it always did:
 * so a deck of two hundred costs no more to pan or to carry a card across
 * than the sixty-card table did. */
const TABLE_SHADOWS_MAX = 60;

/* Whether the cards lying on a mat of `count` cast their shadows at rest. */
function tableRestShadows(count) {
  return (Number(count) || 0) <= TABLE_SHADOWS_MAX;
}

/* How far apart, in z, two cards lying on each other are. Cards share one
 * plane, and coplanar faces in a 3D scene are a coin toss for which is drawn on
 * top — so each lies a hair above the one under it: a quarter of a pixel
 * each, or less when there are more cards than TABLE_DEPTH holds at that.
 *
 * TABLE_DEPTH is the height every card lying on the mat shares, however many
 * there are: the fifteen pixels sixty cards a quarter pixel apart always
 * took, nothing an eye sees as height. The number of cards does not decide
 * how high the table's furniture lies — the rim's tabs and the landing mark
 * lie a few quarter pixels over TABLE_DEPTH — so a hundred cards, or the
 * deck's ceiling of them, are laid closer together (tableCardGapFor) instead
 * of the rim rising over a taller pile of them. 250 cards are 0.06px apart,
 * which is still a plane apart to the browser's depth sort: depth there is
 * floating point in the scene's pixels, nowhere near that coarse. The zones
 * share the same depth by the same rule (tableZonesLayer). */
const TABLE_CARD_GAP = 0.25;
const TABLE_DEPTH    = 15;

/* How far above a card's picture what lies on the card is — its count of
 * copies (tableQtyBadge). A card is a 3D context of its own (table.css), so
 * the count is a face of the scene beside the picture, and coplanar with it
 * would be the coin toss above; lifted, it must still be under the next card
 * up, or it would show through it. So less than half the closest two cards
 * can ever lie: at the deck's ceiling with every card a zone of its own —
 * its felt, its card and its label, three layers a card — 0.0199px apart. */
const TABLE_FACE_Z = 0.008;

/* How high the side edges' tabs lie above the wood, in the plane's pixels:
 * above the highest a card lying on the mat can be — TABLE_DEPTH — and the
 * slip and the bin over those, by a few gaps more. A chip whose label opens
 * inwards over the mat's edge is then drawn over whatever cards lie there,
 * and is what the pointer finds first; a card in hand, held well above all
 * of it, still passes over the tabs. table.css lifts the side edges by it,
 * as --table-rim-z. */
const TABLE_RIM_Z = TABLE_DEPTH + 6 * TABLE_CARD_GAP;

/* How high the landing mark is drawn, in the plane's pixels: above every
 * card that can be lying on the mat — TABLE_DEPTH, however many — and the
 * slip and the bin, by a few gaps, so no pile it falls across is drawn over
 * it; and under the side edges' tabs, whose labels still open over it. The
 * card in hand is held far above this, so it passes over the mark — and
 * while it is still rising towards that, the mark is kept under it
 * (tableCastDrawZ). Drawn this high, it is not *at* this height as the eye
 * sees it: it is moved along the eye's rays to it, so it lands on the screen
 * exactly where a card lying at its own height would (tableCastTransform). */
const TABLE_CAST_Z = TABLE_DEPTH + 3 * TABLE_CARD_GAP;

/* How far apart `layers` things lying on each other are, for all of them to
 * fit in TABLE_DEPTH: TABLE_CARD_GAP while they do at that, and closer
 * together when there are more. The piles' cards are one layer each; the
 * zones add their felt and their labels (tableZonesLayer). */
function tableCardGapFor(layers) {
  return Math.min(TABLE_CARD_GAP, TABLE_DEPTH / Math.max(1, Number(layers) || 1));
}

/* The most cards a scope lays: the Deck Builder's ceiling for its deck, and
 * TABLE_TAB_CARDS_MAX for every other tab and for a list laid through the
 * API. */
function tableCardsMaxFor(scope) {
  return scope === 'deckview' ? TABLE_DECK_CARDS_MAX : TABLE_TAB_CARDS_MAX;
}

/* A card on the mat, sized against the mat: a real playmat is about ten cards
 * wide. Bounded, so a small window still draws a card you can see and a huge
 * one does not draw a card the size of a hand. 88/63 is a card's own shape. */
const TABLE_CARD_SHARE = 0.1;
const TABLE_CARD_MIN_W = 72;
const TABLE_CARD_MAX_W = 150;
const TABLE_CARD_RATIO = 88 / 63;

/* The card-size slider on the far rim: every card the table lays drawn at
 * this share of the size above, from half of it to half as large again. 1
 * is the size above exactly — the slider at rest lays every tab as the table
 * always has, to the pixel (tableCardWidth). Kept per browser, like the
 * switch and the Zones chip (TABLE_CARD_SCALE_KEY), and not per tab: a hand
 * that wants bigger cards wants them on every tab. The range steps by
 * TABLE_CARD_SCALE_STEP, and the − and + beside it by TABLE_CARD_SCALE_NUDGE,
 * so ten presses cross the whole range.
 *
 * Larger is bounded by the mat as well as by the slider: a card grown past
 * what a pile — and the commander's band above it — can lie on the mat whole
 * in is grown only as far as that (tableCardWidthFor), never shrunk below
 * the size at 1. TABLE_HEAD_PAD is the padding the layout keeps round the
 * piles and above the head band, as a share of a card's width — the number
 * tableLayout and tableHeadSpots pad by, and the reckoning counts. */
const TABLE_CARD_SCALE_KEY   = 'mtgtools_table_card_scale';
const TABLE_CARD_SCALE_MIN   = 0.5;
const TABLE_CARD_SCALE_MAX   = 1.5;
const TABLE_CARD_SCALE_STEP  = 0.05;
const TABLE_CARD_SCALE_NUDGE = 0.1;
const TABLE_HEAD_PAD         = 0.35;

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

/* The Deck Builder's drawer — Search, EDHREC and Lands, its three tabs —
 * floated over the table in a panel of its own, opened by a chip each on the
 * far rim (tableDrawerOpen). Narrower than a floating page: TABLE_DRAWER_VW
 * of the window, held between TABLE_DRAWER_MIN_W and TABLE_DRAWER_MAX_W, and
 * docked to one side, so the table it adds cards to stays in view beside it
 * (tableDrawerBox). Each chip names the drawer's tab it opens (dbSetLeftTab's
 * name for it), the label it wears and its icon, drawn in the sidebar's own
 * hand (a 24-unit box, a 2.2 stroke, round ends): a lens for Search, as the
 * sidebar's Scryfall Search wears; a rising line for EDHREC, what other
 * decks run most; a mountain for Lands, as the sidebar's Mana Base wears.
 * `look` is whether it is offered for a deck the user may only look at
 * (tableDrawerChipsShown). */
const TABLE_DRAWER_MIN_W = 420;
const TABLE_DRAWER_MAX_W = 520;
const TABLE_DRAWER_VW    = 0.34;
const TABLE_DRAWER_ICON_OPEN =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const TABLE_DRAWER_TABS = Object.freeze([
  { tab: 'search', label: 'Search', look: true,
    icon: `${TABLE_DRAWER_ICON_OPEN}<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>` },
  { tab: 'edhrec', label: 'EDHREC', look: true,
    icon: `${TABLE_DRAWER_ICON_OPEN}<polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>` },
  { tab: 'lands',  label: 'Lands',  look: false,
    icon: `${TABLE_DRAWER_ICON_OPEN}<path d="M3 20l5-10 4 7 3-5 6 8H3z"/><line x1="3" y1="20" x2="21" y2="20"/></svg>` },
]);

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

/* And how far the card-size slider may grow that card: no taller than
 * TABLE_FEATURE_FIT of the mat, and with its lane no wider than
 * TABLE_FEATURE_WIDE of it, so that at the slider's top it still lies whole
 * on the mat and the sheet beside it keeps half the mat to be read in. At 1
 * neither is reached: the lane is then at most TABLE_FEATURE_MAX of the mat
 * and its padding. */
const TABLE_FEATURE_FIT   = 0.96;
const TABLE_FEATURE_WIDE  = 0.5;

/* A card at the head of the mat — the Deck Builder's commander, or both of a
 * pair of partners — lies front and centre at the far side, a tenth larger
 * than the cards in the piles: it is what the deck is built around, and the
 * eye should find it first. Two lie side by side, a quarter of a card apart.
 * The piles are laid below them, never across them (tableLayout). */
const TABLE_HEAD_SCALE = 1.1;
const TABLE_HEAD_GAP   = 0.25;

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
 * would show them. The one with no sidebar button carries its own label.
 *
 * Only the two side edges hold tabs, which is what lets the side rims be
 * thin and the mat wide: a side edge is one chip wide, and a chip's label
 * opens inwards over the mat's edge rather than into room kept for it on
 * the wood. The far edge is bare of tabs, for the Deck Builder's slip and
 * bin to lie on while a deck is open there. The right edge holds the six
 * main card tabs, from the far corner down. The left edge holds two groups,
 * one at each end of it (`group`): the other tabs at the far end, and the
 * account and the table's own controls at the near end, apart from them by
 * whatever the edge has to spare. */
const TABLE_RIM = [
  { edge: 'left',  group: 'far',  tab: 'available' },
  { edge: 'left',  group: 'far',  tab: 'pick' },
  { edge: 'left',  group: 'far',  tab: 'lands' },
  { edge: 'left',  group: 'far',  tab: 'card' },
  { edge: 'left',  group: 'near', act: 'appearance', nav: 'sidenavAppearanceBtn' },
  { edge: 'left',  group: 'near', act: 'rss',        nav: 'sidenavRssBtn' },
  { edge: 'left',  group: 'near', tab: 'admin' },
  { edge: 'left',  group: 'near', act: 'password',   nav: 'sidenavChangePwBtn' },
  { edge: 'left',  group: 'near', act: 'signout',    nav: 'sidenavLogoutBtn' },
  { edge: 'left',  group: 'near', act: 'leave',      label: 'Leave table' },
  { edge: 'right', group: 'far',  tab: 'collections' },
  { edge: 'right', group: 'far',  tab: 'players' },
  { edge: 'right', group: 'far',  tab: 'deckview' },
  { edge: 'right', group: 'far',  tab: 'scryfall' },
  { edge: 'right', group: 'far',  tab: 'sets' },
  { edge: 'right', group: 'far',  tab: 'wants' },
];

/* The edges and their groups, as the rim draws them: which tabs stand at
 * each end of each edge, in order — the table above read edge by edge. A
 * group with no tab in it is not drawn. */
function tableRimLayout(rim = TABLE_RIM) {
  const out = {};
  rim.forEach((entry, index) => {
    const edge  = out[entry.edge] || (out[entry.edge] = {});
    const group = entry.group || 'far';
    (edge[group] || (edge[group] = [])).push(index);
  });
  return out;
}

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
 * `clear` = { top, left, right }: the lowest edge of anything on the far
 * edge it must hang below (0 for nothing: the far edge holds no tabs now),
 * the rightmost reach of the left edge's tabs and the leftmost of the right
 * edge's, in window pixels — so that every tab can still be pressed while
 * the panel floats, the open one to put it down and any other to swap it. It
 * hangs below `top` and is centred between the side tabs, which is also
 * where it lies tucked at the window's foot, so the tabs at the near end of
 * a side edge are as clear of the tucked bar as of the panel. Where the side
 * tabs leave less room than TABLE_PANEL_MIN_W, the floor wins and the panel
 * reaches over the room their labels open into — never far enough, on any
 * window the table is offered at, to reach the chips themselves. */
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

/* How wide a card is drawn on a mat this wide, at `scale` of the table's own
 * size (the card-size slider's, TABLE_CARD_SCALE_*). The bounds are the
 * size's at 1, and the slider scales what they leave — so at 1 this is the
 * width the table has always drawn, rounded the same way, and the slider's
 * range is the same share of it on any window. */
function tableCardWidth(matWidth, scale = 1) {
  const share = (Number(matWidth) || 0) * TABLE_CARD_SHARE;
  const base = Math.min(TABLE_CARD_MAX_W, Math.max(TABLE_CARD_MIN_W, share));
  return Math.round(base * tableCardScaleClamp(scale));
}

/* The width a card is drawn at on a mat of the given size, at `scale`, for
 * the piles: tableCardWidth's, except that a card grown past 1 is grown no
 * further than lets it lie on the mat whole — `head`, whether a commander
 * lies at the head of the mat, decides how much of the mat's height the
 * piles have. With no head, a card no taller than the mat; with one, the
 * head band — its padding and the head card, TABLE_HEAD_SCALE times a card
 * — and a whole card of pile below it, which is what tableLayout needs to
 * keep every centre a half card inside the mat (its clamp). And no wider
 * than the mat, nor the head card either. Never smaller than at 1: the cap
 * only holds the growth back, so at 1 and below it is tableCardWidth. */
function tableCardWidthFor(matWidth, matHeight, scale = 1, { head = false } = {}) {
  const base = tableCardWidth(matWidth);
  const want = tableCardWidth(matWidth, scale);
  if (!(want > base)) return want;
  const width = Math.max(0, Number(matWidth) || 0), height = Math.max(0, Number(matHeight) || 0);
  const tall = head ? TABLE_HEAD_PAD + (TABLE_HEAD_SCALE + 1) * TABLE_CARD_RATIO : TABLE_CARD_RATIO;
  const fit = Math.min(width / (head ? TABLE_HEAD_SCALE : 1), height / tall);
  return Math.max(base, Math.min(want, Math.floor(fit)));
}

/* A value for the card-size slider: a number, held inside its range and put
 * on its step — a stored string included — and 1, the table's own size, for
 * anything that is not a number at all. Rounded to the hundredth after the
 * step, so 0.55 is 0.55 and not the float the division left. */
function tableCardScaleClamp(value) {
  if (value == null || value === '') return 1;
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  const held = Math.min(TABLE_CARD_SCALE_MAX, Math.max(TABLE_CARD_SCALE_MIN, n));
  return Math.round(Math.round(held / TABLE_CARD_SCALE_STEP) * TABLE_CARD_SCALE_STEP * 100) / 100;
}

/* The slider's kept value, guarded as the switch's is: storage that cannot
 * be read is the table's own size. Nothing is kept for 1, so a browser that
 * never moved the slider keeps nothing. */
function readTableCardScale() {
  try { return tableCardScaleClamp(localStorage.getItem(TABLE_CARD_SCALE_KEY)); }
  catch { return 1; }
}

function rememberTableCardScale(scale) {
  const s = tableCardScaleClamp(scale);
  try {
    if (s === 1) localStorage.removeItem(TABLE_CARD_SCALE_KEY);
    else         localStorage.setItem(TABLE_CARD_SCALE_KEY, String(s));
  } catch {}
}

/* Whether the slider lies on the far rim: on every tab that lays cards, for
 * as long as that tab's cards are the ones on the mat (`scope`, the tab that
 * laid them). A list laid through the API is nobody's tab, and has none. */
function tableScaleShown(scope) {
  return tableIsCardTab(scope);
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
 * A card marked `head` is not in a pile: it lies at the head of the mat, in a
 * band across its far side, TABLE_HEAD_SCALE times the size of the rest and
 * side by side with any other head card (tableHeadSpots); the piles share out
 * the mat below that band, so none of them reaches into it. And `reserve` =
 * { bottom } keeps a band of that many pixels clear along the mat's near
 * edge, for anything laid there instead of cards — nothing is, now that the
 * Deck Builder's slip and bin lie on the far rim, off the mat. With no head
 * card and nothing reserved, the piles have the whole mat.
 *
 * At most TABLE_DECK_CARDS_MAX cards; a centre is kept far enough inside the mat
 * that the card does not hang off it, or into either band. Returns the card's
 * size in pixels too, since that is decided here — the size of a card in a
 * pile; a head card is drawn TABLE_HEAD_SCALE times it.
 *
 * `scale` is the card-size slider's (tableCardWidthFor): at 1 every answer
 * is the one this has always given. Larger or smaller, everything below is
 * worked out from the card's size and so follows it — the padding, the
 * slots' fit, the rows a pile breaks onto and the overlap of a fan — and a
 * card grown past what the mat holds whole is grown only that far. */
function tableLayout(cards, width, height, reserve = {}, scale = 1) {
  const list = (cards || []).slice(0, TABLE_DECK_CARDS_MAX);
  const below = Math.max(0, Number(reserve?.bottom) || 0);
  const w = tableCardWidthFor(width, Math.max(0, (Number(height) || 0) - below), scale,
    { head: list.some(card => card && card.head) });
  const h = w * TABLE_CARD_RATIO;
  if (!list.length || !(width > 0) || !(height > 0)) {
    return { width: w, height: h, spots: list.map(() => ({ x: 0.5, y: 0.5, turn: 0 })) };
  }
  const pad   = w * TABLE_HEAD_PAD;
  const spots = new Array(list.length);

  /* The head band first: what it holds decides where the piles may begin. */
  const heads = [];
  list.forEach((card, i) => { if (card.head) heads.push(i); });
  const head = tableHeadSpots(heads.length, width, height, w, h);
  heads.forEach((index, j) => {
    const turn = typeof stackJitter === 'function' ? stackJitter(list[index].name) : 0;
    spots[index] = { ...head.spots[j], turn: Math.round(turn * 10) / 10 || 0 };
  });

  const piles = [];
  const byGroup = new Map();
  list.forEach((card, i) => {
    if (card.head) return;
    const key = card.group == null ? '' : String(card.group);
    if (!byGroup.has(key)) { byGroup.set(key, []); piles.push(byGroup.get(key)); }
    byGroup.get(key).push(i);
  });
  if (!piles.length) return { width: w, height: h, spots };

  /* The part of the mat the piles share: below the head band, and above the
     band kept clear along the near edge — both held inside the mat, so a
     reserve asked for past it is the mat's height and no more. */
  const areaTop = Math.min(height, head.bottom);
  const areaBot = Math.max(areaTop, height - Math.max(0, Number(reserve?.bottom) || 0));
  const areaH   = areaBot - areaTop;
  const cols  = Math.max(1, Math.min(piles.length,
    Math.round(Math.sqrt(piles.length * (width / Math.max(1, areaH)) / TABLE_SLOT_ASPECT)) || 1));
  const rows  = Math.ceil(piles.length / cols);
  const slotW = (width - 2 * pad) / cols;
  const slotH = Math.max(0, areaH - 2 * pad) / rows;
  const room  = Math.max(0, slotW - w);
  const clamp = (n, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, n)));

  piles.forEach((pile, p) => {
    const left = pad + (p % cols) * slotW;
    const top  = areaTop + pad + Math.floor(p / cols) * slotH;
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
        y: clamp(cy, areaTop + h / 2, areaBot - h / 2) / height,
        turn: Math.round(turn * 10) / 10 || 0,
      };
    });
  });
  return { width: w, height: h, spots };
}

/* Where `count` head cards lie on a mat of the given size, for cards w × h in
 * the piles: drawn TABLE_HEAD_SCALE times that, side by side across the
 * middle of the far side a pile's padding in from the edge, TABLE_HEAD_GAP of
 * a card apart. `spots` are their centres, as fractions of the mat; `bottom`
 * is where the band they lie in ends, in pixels from the far edge — the
 * cards' foot, and 0 with none to lay, which leaves the whole mat to the
 * piles. */
function tableHeadSpots(count, width, height, w, h) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!n || !(width > 0) || !(height > 0)) return { spots: [], bottom: 0 };
  const pad = w * TABLE_HEAD_PAD;
  const W = w * TABLE_HEAD_SCALE, H = h * TABLE_HEAD_SCALE;
  const step = W + w * TABLE_HEAD_GAP;
  const y = Math.min(height / 2, pad + H / 2);
  const spots = Array.from({ length: n }, (_, i) => {
    const cx = width / 2 + (i - (n - 1) / 2) * step;
    return { x: Math.min(width - W / 2, Math.max(W / 2, cx)) / width, y: y / height };
  });
  return { spots, bottom: y + H / 2 };
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
 * the width of the lane it lies in down the mat's right-hand side — at
 * `scale`, the card-size slider's: smaller in proportion, and larger only
 * as far as TABLE_FEATURE_FIT and TABLE_FEATURE_WIDE let it grow, never
 * below its size at 1. At 1 it is the size it has always been. */
function tableFeatureSize(matWidth, matHeight, scale = 1) {
  const width = Math.max(0, Number(matWidth) || 0), height = Math.max(0, Number(matHeight) || 0);
  const base = Math.min(height * TABLE_FEATURE_SHARE / TABLE_CARD_RATIO, width * TABLE_FEATURE_MAX);
  const fit  = Math.min(height * TABLE_FEATURE_FIT / TABLE_CARD_RATIO,
    width * TABLE_FEATURE_WIDE / (1 + 2 * TABLE_FEATURE_PAD));
  const w = Math.round(Math.min(base * tableCardScaleClamp(scale), Math.max(base, fit)));
  return { w, h: w * TABLE_CARD_RATIO, lane: Math.round(w * (1 + 2 * TABLE_FEATURE_PAD)) };
}

/* tableLayout's answer for that card: in the middle of its lane, at the angle
 * its name gives it. More than one card would lie on top of it; nothing lays
 * more. */
function tableFeatureLayout(cards, width, height, scale = 1) {
  const list = (cards || []).slice(0, TABLE_DECK_CARDS_MAX);
  const size = tableFeatureSize(width, height, scale);
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
 * giving back what it does not use to the piles after it — so, of a hundred
 * to lay, two hundred cards of one kind and three of another lay the three
 * and ninety-seven, not a hundred of the first. Each pile's cards are taken
 * from its front, in the tab's order. */
function tableFairShare(sizes, max = TABLE_TAB_CARDS_MAX) {
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
function tableFromPiles(piles, cardOf, max = TABLE_TAB_CARDS_MAX) {
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

/* The cards as the mat holds them: at most as many as the scope lays
 * (tableCardsMaxFor), the nameless dropped, each known by a key that is the
 * same whenever the same card is laid by the same tab — its scope, its id or
 * else its name, and how many times that has come up already in the list,
 * for the second copy of a card. A card may carry `head`, which lays it at
 * the head of the mat (tableLayout), `ref`, which is what the tab knows it by
 * to edit it — the Deck Builder's board and name — or null for a card
 * nothing can edit from the table, and `qty`, how many copies of it the one
 * card stands for: 1 unless a deck entry says more, which the card then
 * says on its face. */
function tableKeyCards(list, scope = '') {
  const seen = new Map();
  const prefix = scope ? `${scope}:` : '';
  return (Array.isArray(list) ? list : [])
    .filter(card => card && card.name)
    .slice(0, tableCardsMaxFor(scope))
    .map(card => {
      const base = prefix + String(card.id ?? card.name);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return {
        key: `${base}#${n}`, name: String(card.name), imageUrl: card.imageUrl || '',
        group: card.group ?? null, open: typeof card.open === 'function' ? card.open : null,
        head: !!card.head, ref: card.ref == null ? null : String(card.ref),
        qty: tableQty(card.qty),
      };
    });
}

/* How many copies a laid card stands for: a whole number, at least one. */
function tableQty(qty) {
  return Math.max(1, Math.floor(Number(qty) || 1));
}

/* What a list of cards is to the mat, as one string: which cards lie in which
 * piles, or at the head of the mat, in what order, laid by whom and how. Two
 * lists that answer the same are laid the same way, so only their pictures
 * can differ — which is what lets a redraw that only brought pictures leave
 * every card where it lies. */
function tableListSig(list, scope = '', feature = false) {
  return JSON.stringify([scope, !!feature,
    tableKeyCards(list, scope).map(card => [card.key, card.group, card.head])]);
}

/* The Deck Builder's cards as the mat lays them: the commanders first, at the
 * head of the mat, then a pile per category — every entry of the deck, one
 * table card an entry with its count on it, up to TABLE_DECK_CARDS_MAX; only
 * a deck past that has the room left after the commanders shared out among
 * its categories. Each card is known by its ref — so a card in the mainboard
 * and the same card on the commander board are two cards to the mat as they
 * are to the deck — and carries it, so the bin and "Remove one" can ask the
 * builder to take one copy of it out. */
function tableDeckCards(heads, piles, imageOf = () => '', max = TABLE_DECK_CARDS_MAX) {
  const top = (heads || []).filter(card => card && card.name).slice(0, max);
  const laid = card => ({
    name: card.name, id: card.ref, ref: card.ref, imageUrl: card.image || imageOf(card.name), qty: card.qty,
  });
  return [
    ...top.map(card => ({ ...laid(card), head: true, group: 'commander' })),
    ...tableFromPiles(piles, laid, max - top.length),
  ];
}

/* Where each card lies once laid: where a hand last put it this session, if
 * one did — `moved` is keyed as tableKeyCards keys — and otherwise where the
 * layout puts it. */
function tablePlaceCards(cards, spots, moved) {
  return cards.map((card, i) => ({ ...(moved.get(card.key) || spots[i] || { x: 0.5, y: 0.5, turn: 0 }) }));
}

/* The cards on a mat of the given size laid at the card-size slider's
 * `scale`: the size a card is drawn at, the Card tab's lane (0 for any other
 * layout), and where each card lies — the layout's answer at that scale for
 * every card no hand has moved, and for every card one has, the spot it was
 * left on (tablePlaceCards, `moved` keyed as tableMoved is). A spot is a
 * card's centre, so a moved card grown or shrunk by the slider is grown or
 * shrunk about where it lies, and lies there still. The same answer whether
 * the cards are being laid (tableDrawCards) or only resized and moved in
 * place as the slider is dragged (tableRescaleCards). */
function tableScaledPlaces(cards, width, height, scale = 1, moved = new Map(), feature = false) {
  const layout = feature
    ? tableFeatureLayout(cards, width, height, scale)
    : tableLayout(cards, width, height, {}, scale);
  return {
    size: { w: layout.width, h: layout.height },
    lane: layout.lane || 0,
    places: tablePlaceCards(cards, layout.spots, moved),
  };
}

/* How a card's picture is drawn, for cards `cardW` wide on the mat — the
 * width the card-size slider has laid them at; a head card is drawn
 * TABLE_HEAD_SCALE times it — under a camera at `zoom` on a screen of `dpr`
 * device pixels to the pixel: `k`, how much larger than its card the picture
 * is laid out (tableDecodeScale), and `large`, whether it is drawn from
 * Scryfall's large file (tableNeedsLarge).
 *
 * The slider's scale is in the card's laid-out box, never in a transform: a
 * card at 150% is laid out half as large again, and Firefox decodes a
 * picture for the box it is laid out in (see TABLE_DECODE_STEP). So k stays
 * the zoom's and the screen's, the same at every size — counting the scale
 * in it as well would decode a 150% card for a card half as large again as
 * it is — and what carries the slider is the width asked of tableNeedsLarge:
 * a card grown past what the normal file holds sharp is drawn from the large
 * one, at a zoom or a screen that never needed it for the table's own size. */
function tableCardPicture(cardW, { head = false, zoom = 1, dpr = 1 } = {}) {
  const widest = (Number(cardW) || 0) * (head ? TABLE_HEAD_SCALE : 1);
  return { k: tableDecodeScale(zoom, dpr), large: tableNeedsLarge(widest, zoom, dpr) };
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

/* What the Card sheet is opened over, and so what putting it down brings back
 * — { tab, panel } with panel 'open', 'tucked' or 'closed' — or null when
 * there is nothing to go back to.
 *
 * The Card tab here is a look at one card on the way to somewhere else: you
 * pick a card up off the Deck Builder's piles, press Details, read it, and
 * put it down. Putting it down has to be going back, then, and not merely
 * the sheet going away — the mat had been holding the deck, and a closed
 * sheet over the one large card it leaves behind is the deck gone.
 *
 * `from` is the tab whose panel was open when the sheet came up, and
 * `tucked` whether that panel was tucked at the time: the view comes back as
 * it was left. With no panel open the view was the mat itself, and `laid` —
 * the tab whose cards lie on it (tableLaid) — is what comes back, with its
 * panel still closed. The Card tab opened over itself, or over a mat nothing
 * has been laid on, has nothing behind it to return to. Where each card lay
 * is not part of the answer: tableMoved keeps it per card for the whole
 * session, so laying the same tab's cards again puts them back by itself. */
function tableCardReturnFor({ to, from = null, tucked = false, laid = null }) {
  if (to !== 'card') return null;
  if (from) return from === 'card' ? null : { tab: from, panel: tucked ? 'tucked' : 'open' };
  return laid && laid !== 'card' ? { tab: laid, panel: 'closed' } : null;
}

/* Whether a history entry is the Card tab's: openCardPage's card, or the
 * tab's own entry pushed by setTab() for a press on the rim. */
function tableIsCardEntry(state) {
  return state?.view === 'card' || (state?.view === 'tab' && state?.tab === 'card');
}

/* Whether putting the Card sheet down should be the browser's Back rather
 * than a fresh visit to the tab it was opened over.
 *
 * Opening the sheet pushed one history entry — openCardPage's card, or
 * setTab's for a press on the rim — on top of the view it was opened over.
 * Stepping back off it is then the exact undo: the history ends where it
 * stood before, and Back afterwards leaves the app's view rather than
 * walking into the card a second time. And popstate goes through setTab(),
 * whose tableModeBeforeTab() restores the view, so Back pressed with the
 * sheet open and the sheet's own close are one path, not two that could come
 * to disagree.
 *
 * Only when that is certainly what Back would do, which is two things: the
 * entry under the card's was that tab's (`ret.backTo`, read as the sheet came
 * up), and the entry standing now is the very one pushed over it. That one is
 * stamped with the sheet's token as it is pushed (tableStampCardEntry), so a
 * second card opened on the sheet — a new entry, unstamped — or an entry
 * reached some other way answers no. The history's length cannot say it: a
 * push over forward entries cuts them away and leaves the length where it
 * was. A printing swapped in place replaces the entry and keeps the stamp
 * (cardSwapPrinting, js/card.js), since it is still the same visit to the
 * card. Anything else, and Back would land somewhere nobody asked for, so the
 * caller visits the tab instead. */
function tableReturnByBack({ ret, state }) {
  if (!ret || !ret.backTo || ret.token == null) return false;
  return tableIsCardEntry(state) && state.tableOver === ret.token;
}

/* Whether cards just laid tuck the panel out of their way: a floating panel,
 * for a tab with cards, not already tucked, and something done in its pane
 * no more than TABLE_TUCK_WINDOW ago — `actedAgo`, in milliseconds, Infinity
 * when nothing has been. Typing does not count as done: a filter applied
 * letter by letter would tuck the box being typed in.
 *
 * Never while the Deck Builder's drawer lies over the table in a panel of its
 * own (`drawer`, tableDrawerOpen), and never that panel itself (kind
 * 'drawer'): the drawer is where cards are being added from, one after
 * another, and it is docked to the side so that each one is seen landing on
 * the table beside it. Tucking it — or anything — out of the way of the
 * cards it has just laid would take away the results the next one is to be
 * picked from. */
function tableShouldAutoTuck({ kind, tab, tucked, actedAgo, drawer = false }) {
  return kind === 'float' && !drawer && tableIsCardTab(tab) && !tucked
      && Number(actedAgo) >= 0 && Number(actedAgo) <= TABLE_TUCK_WINDOW;
}

/* Whether the Deck Builder's slip and bin lie on the mat: while the cards on
 * it are the Deck Builder's (`scope`, the tab that laid them), a deck is open,
 * and it is one the user may edit — somebody else's deck can be looked at on
 * the table and not changed from it, as in the builder. */
function tableToolsShown({ scope, deckOpen, canEdit }) {
  return scope === 'deckview' && !!deckOpen && !!canEdit;
}

/* Which of the drawer's chips lie on the far rim (TABLE_DRAWER_TABS): each
 * by the slip's rule — the Deck Builder's cards on the mat, a deck open, one
 * the user may edit — except that a chip marked `look` is there for a deck
 * the user may only look at too, since Search and EDHREC are ways of looking
 * as much as of adding, and the builder draws their results for such a deck
 * without a + on them. { search, edhrec, lands }, each a boolean. */
function tableDrawerChipsShown({ scope, deckOpen, canEdit }) {
  const deck = scope === 'deckview' && !!deckOpen;
  return Object.fromEntries(TABLE_DRAWER_TABS.map(chip => [chip.tab, deck && (chip.look || !!canEdit)]));
}

/* Where the drawer's panel goes in a window of `view` = { width, height }:
 * docked to the left — the side away from the card tabs down the right edge
 * — a gap clear of the left edge's tabs and the room their labels open into
 * (`clear.left`, measured as for a floating panel, tableRimClear), so every
 * tab on that edge is still in reach beside it; TABLE_DRAWER_VW of the
 * window wide, held between TABLE_DRAWER_MIN_W and TABLE_DRAWER_MAX_W, so
 * most of the table stays in view; from a gap below `clear.top` — the far
 * rim's foot, so what lies on it stays in reach — to a gap above the
 * window's foot, and above `clear.bottom` more, the height a tucked panel's
 * bar lies in at the foot, which it would otherwise cover. Kept inside the
 * window on one too narrow for all of that. */
function tableDrawerBox(view, clear, gap = TABLE_PANEL_GAP) {
  const room  = Math.max(0, view.width - 2 * gap);
  const width = Math.min(room, TABLE_DRAWER_MAX_W, Math.max(TABLE_DRAWER_MIN_W, view.width * TABLE_DRAWER_VW));
  const left  = Math.max(gap, Math.min((Number(clear.left) || 0) + gap, view.width - gap - width));
  const top   = Math.max(gap, (Number(clear.top) || 0) + gap);
  const foot  = Math.max(0, Number(clear.bottom) || 0);
  return { left, top, width, height: Math.max(0, view.height - top - gap - foot) };
}

/* What a card being looked at offers besides Details, on the Deck Builder's
 * table: Remove one for any card of a deck the user may edit (`toolsOn`, the
 * slip and bin's rule) that the deck knows by its ref, and Add one for the
 * same — except a commander, since the builder offers no second copy of one:
 * its own stepper is not on a commander's menu (dbCardMenuItems), and a
 * commander is one card. `ref` is the builder's, board first
 * (dbCardRef: "board/name"). */
function tableLookActions({ toolsOn, ref }) {
  const deck = !!toolsOn && ref != null && String(ref) !== '';
  const board = deck ? String(ref).split('/')[0] : '';
  const commander = typeof DB_COMMANDER_BOARD === 'string' ? DB_COMMANDER_BOARD : 'commander';
  return { remove: deck, add: deck && board !== commander };
}

/* Whether a point of the mat, { u, v } in the mat's own pixels, is inside a
 * rect of it, { left, top, width, height } in the same pixels — the edges
 * counted in. A point that missed the mat altogether (null) is inside nothing.
 * The point is the pointer's, mapped onto the mat through the camera by
 * tableUnproject, the same mapping a card in hand is carried by: so the bin
 * answers to where the pointer is over the tilted, panned and zoomed table,
 * not to where its box would be on a flat screen. */
function tableInMatRect(point, rect) {
  if (!point || !rect) return false;
  const u = Number(point.u), v = Number(point.v);
  return u >= rect.left && u <= rect.left + rect.width && v >= rect.top && v <= rect.top + rect.height;
}

/* What putting one card in the bin does to the deck: a card with copies to
 * spare loses one ('less', dbChangeQty by -1), and the last copy is taken out
 * ('remove', dbRemoveCard) — the two things the builder's own − and Remove
 * do, which keep the save, the history and the commander record theirs. */
function tableBinAction(qty) {
  return (Number(qty) || 1) > 1 ? 'less' : 'remove';
}

/* How far a card in hand has gone over to its "going in the bin" look, as
 * progress 0…1: towards 1 while the pointer is over the bin and back towards
 * 0 when it leaves, the whole way in TABLE_LIFT_MS — `dt` is the frame's
 * length — and at once when cards may not move. */
function tableBinProgress(t, over, dt, motion = true) {
  if (!motion) return over ? 1 : 0;
  const step = Math.max(0, Number(dt) || 0) / TABLE_LIFT_MS;
  const at = Math.min(1, Math.max(0, Number(t) || 0));
  return over ? Math.min(1, at + step) : Math.max(0, at - step);
}

/* How small a card in hand becomes over the bin, for a card `cardW` wide
 * and a bin `binW` wide: TABLE_BIN_HELD_SHRINK of itself, or as small as it
 * takes to be no wider than TABLE_BIN_HELD_FIT of the bin, whichever is the
 * smaller — the look is the lit bin showing round the card, and a card is
 * laid larger on a larger mat while the bin stays the size it is. A bin or
 * a card with no width asks nothing further of it. */
function tableBinHeldShrink(cardW, binW) {
  const card = Number(cardW) || 0, bin = Number(binW) || 0;
  if (!(card > 0) || !(bin > 0)) return TABLE_BIN_HELD_SHRINK;
  return Math.min(TABLE_BIN_HELD_SHRINK, bin * TABLE_BIN_HELD_FIT / card);
}

/* That look, for a progress t: `k`, how much of it there is, on the lift's
 * cubic ease-out; the card's size, its opacity, and how far its centre is
 * drawn from the pointer to the bin's — each nothing at 0 and all of it at 1.
 * `held` is how small the card is at 1 (tableBinHeldShrink). */
function tableBinPose(t, held = TABLE_BIN_HELD_SHRINK) {
  const at = Math.min(1, Math.max(0, Number(t) || 0));
  const k = 1 - (1 - at) ** 3;
  return {
    k,
    shrink:  1 - (1 - held) * k,
    opacity: 1 - (1 - TABLE_BIN_HELD_FADE) * k,
    pull:    TABLE_BIN_HELD_PULL * k,
  };
}

/* Where a card in hand lands if it is let go now, as fractions of the mat:
 * the point the hand closed on — `grab`, in the mat's pixels from the card's
 * centre — put at `hit`, the pointer mapped onto the plane at the height the
 * card is held at (which is what keeps the card under the pointer), with the
 * card's centre kept on the mat. Let go, the card comes straight down onto
 * this spot (tableRelease), and the landing mark is drawn on it while the
 * card is carried (tableCastWrite): one answer, asked once a frame, so the
 * mark is where the card will lie. Null for a pointer that missed the
 * plane, or a mat with no size. */
function tableDropSpot(hit, grab, width, height) {
  if (!hit || !(width > 0) || !(height > 0)) return null;
  const at = (n, size) => Math.min(1, Math.max(0, n / size));
  return { x: at(hit.u - (Number(grab?.u) || 0), width), y: at(hit.v - (Number(grab?.v) || 0), height) };
}

/* The transform that lays something card-sized on the mat: `spot` = { x, y,
 * turn } its centre as fractions of `mat` = { width, height } and the angle
 * it lies at, `box` = { w, h } its size, `z` how high above the felt; and for
 * a card in hand, how far it leans back towards the viewer and how small it
 * has become going into the bin. One string, so a card settling eases every
 * part of it at once — and one function, so a card and its landing mark
 * are laid by the same arithmetic. */
function tableLieTransform(spot, box, mat, z, lean = 0, shrink = 1) {
  return `translate3d(${(spot.x * mat.width - box.w / 2).toFixed(2)}px, ${(spot.y * mat.height - box.h / 2).toFixed(2)}px, ` +
    `${z.toFixed(2)}px) rotate(${spot.turn}deg) rotateX(${lean.toFixed(2)}deg)` +
    (shrink !== 1 ? ` scale(${shrink.toFixed(3)})` : '');
}

/* The landing mark's pose, for a card that lands on `spot` at the angle
 * `turn` and comes to rest `z` above the felt: the same place, the same angle
 * — the card turns no further on the way down — and the same height, lying
 * flat. Exactly the pose the card itself will lie in, so the mark the eye
 * sees is the card's outline once it is down. Where it is *drawn* is another
 * matter (tableCastTransform): at that height, it would be a coin toss
 * against the cards it falls across, and hidden under the piles drawn after
 * it. */
function tableCastPose(spot, turn, z) {
  return { x: spot.x, y: spot.y, turn: Number(turn) || 0, z: Math.max(0, Number(z) || 0) };
}

/* How high to draw the mark for a card resting `rest` above the felt and
 * held `lift` above that: TABLE_CAST_Z, over every card lying on the mat —
 * but never within two gaps of the card in hand, which is to pass over it,
 * and never under the card's own resting height, which is where the mark
 * would be without any of this. With cards still the card is never lifted,
 * so it lies on its own mark, as it does where it will land. */
function tableCastDrawZ(rest, lift) {
  const z = Math.max(0, Number(rest) || 0);
  const top = Math.min(TABLE_CAST_Z, z + (Number(lift) || 0) - 2 * TABLE_CARD_GAP);
  return Math.max(z, top);
}

/* Where the eye is, in the mat's own coordinates, for the 4×4 `m` that takes
 * a point on the mat to the window (tablePlaneMatrix): the one point the
 * projection cannot send anywhere, its x, y and w rows all 0 there. Three
 * equations in u, v and z, solved by Cramer's rule. Null for a matrix with
 * no single such point — no perspective — which the mark then does without. */
function tableEye(m) {
  const a = m[0],  b = m[1],  c = m[2],  p = -m[3];
  const d = m[4],  e = m[5],  f = m[6],  q = -m[7];
  const g = m[12], h = m[13], i = m[14], r = -m[15];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!det || !Number.isFinite(det)) return null;
  return {
    u: (p * (e * i - f * h) - b * (q * i - f * r) + c * (q * h - e * r)) / det,
    v: (a * (q * i - f * r) - p * (d * i - f * g) + c * (d * r - q * g)) / det,
    z: (a * (e * r - q * h) - b * (d * r - q * g) + p * (d * h - e * g)) / det,
  };
}

/* The landing mark's transform: laid in `pose` (tableCastPose), the card's
 * own landing pose, and then drawn `drawZ` above the felt without moving on
 * the screen at all. Every point of it is slid along the ray from the eye
 * through it — a scale about the eye, by the one factor that takes the
 * pose's height to drawZ — and a point anywhere on its ray is drawn on the
 * same pixel, by what a perspective is. So the mark lies above the piles in
 * the scene's depth, which is what the browser sorts by, and on the screen
 * exactly where the card will lie: not a pixel's guess of a parallax, but the
 * same picture of the same quadrilateral, nearer the eye and a hair smaller
 * in the plane to match. The eye is the camera's as it is this frame, so it
 * holds while the table pans and zooms; the scale is about the element's own
 * transform-origin, its centre, which the outer translation accounts for.
 * Without an eye (`m` with no perspective), or with the eye level with the
 * mark, it is drawn at the pose's own height, as it was before. */
function tableCastTransform(m, pose, box, mat, drawZ) {
  const lie = tableLieTransform(pose, box, mat, pose.z);
  const eye = m && tableEye(m);
  const s = eye ? (drawZ - eye.z) / (pose.z - eye.z) : NaN;
  if (!(s > 0) || !Number.isFinite(s) || s === 1) return lie;
  const ox = eye.u - box.w / 2, oy = eye.v - box.h / 2, oz = eye.z;
  return `translate3d(${ox.toFixed(3)}px, ${oy.toFixed(3)}px, ${oz.toFixed(3)}px) scale3d(${s.toFixed(6)}, ${s.toFixed(6)}, ${s.toFixed(6)}) ` +
    `translate3d(${(-ox).toFixed(3)}px, ${(-oy).toFixed(3)}px, ${(-oz).toFixed(3)}px) ${lie}`;
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
/* What the Card sheet was opened over: tableCardReturnFor()'s answer, with
   the kind of panel the tab was in, whether the history entry under the
   card's is that tab's (backTo) and the token the card's entry is stamped
   with — see tableReturnByBack(). Null while the sheet is not up, or has
   nothing behind it. */
let tableCardReturn = null;
let tableCardSeq    = 0;     // the last token a Card sheet's history entry was stamped with
const tableMoved  = new Map();   // card key → { x, y, turn }: where a hand put it
let tableHold     = null;    // the card under a pressed pointer
let tableSwallow  = false;   // the click a drag ends with is not a click
let tableLifted   = null;    // { card, box }: a pressed card, as it was drawn held
let tableLooked   = null;    // the card picked up to be looked at
let tableDecodeK  = 1;       // how much larger than its card a picture is laid out
let tableHiRes    = false;   // whether the cards are drawn from Scryfall's large pictures
let tableLookSeq  = 0;
let tableScope    = '';      // the tab the cards on the mat were laid for, '' through the API
let tableTools    = null;    // the Deck Builder's slip and bin, made once — see tableToolsMake()
let tableToolsOn  = false;   // whether they lie on the mat now (tableToolsShown)
let tableBinOver  = false;   // whether the card in hand is over the bin
let tableArrival  = null;    // { name, x, y, until }: a card just added from the slip, on its way
let tableCardScale = 1;      // the card-size slider's value, read from the browser as the table comes up
let tableSlider   = null;    // { box, input, value, less, more }: the card-size slider, made with each scene
let tableScaleHeld = false;  // whether a pointer is pressed on the slider, which the camera does not follow
let tableScaleFrameId = 0;   // the frame the cards are next resized in, while the slider moves
let tableDrawer   = null;    // { tab, el, mark, watch, paneWatch }: the builder's drawer, lying in its own panel
let tableDrawerChips = null; // { box, buttons }: the drawer's chips on the far rim, made with each scene

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
 * the popover is not a click outside it.
 *
 * An edge's tabs stand in its groups (tableRimLayout), each a column of its
 * own at its end of the edge, far first, so the keyboard meets them in the
 * order the eye reads them down the edge. */
function tableRimHtml(edge) {
  const groups = tableRimLayout()[edge] || {};
  return ['far', 'near'].filter(group => groups[group]).map(group =>
    `<div class="table-rim-group" data-group="${group}">${groups[group].map(tableTabHtml).join('')}</div>`).join('');
}

/* One tab: the rim entry at index `i` of TABLE_RIM, as its button. */
function tableTabHtml(i) {
  const entry = TABLE_RIM[i];
  const nav   = document.getElementById(tableNavId(entry) || '');
  const icon  = nav?.querySelector('svg')?.outerHTML || (entry.act === 'leave' ? TABLE_LEAVE_ICON : '');
  const cls   = `table-tab${entry.act === 'appearance' ? ' appearance-trigger' : ''}`;
  const tab   = entry.tab ? ` data-tab="${entry.tab}"` : '';
  const label = esc(tableRimLabel(entry));
  return `<button type="button" class="${cls}" data-rim="${i}"${tab} aria-label="${label}">` +
         `<span class="table-tab-face">${icon}<span class="table-tab-label" aria-hidden="true">${label}</span></span></button>`;
}

function tableBuild() {
  const body  = document.body;
  const scene = document.createElement('div');
  scene.className = 'table-scene';
  scene.id = 'tableScene';
  scene.style.setProperty('--table-tilt', `${TABLE_TILT_REST}deg`);
  scene.style.setProperty('--table-rim-z', `${TABLE_RIM_Z.toFixed(2)}px`);
  scene.style.setProperty('--table-face-z', `${TABLE_FACE_Z}px`);
  /* The far edge holds no tabs: what lies on it, the Deck Builder's slip and
     bin, are the mat's own children, laid out over it (table.css), so that
     where they are is said in the mat's pixels like everything else the hand
     meets on the table. The landing mark is the mat's too: first in it, but
     drawn over the cards after it by its height (tableCastTransform), since
     in a 3D scene depth decides, not order. */
  scene.innerHTML = `
    <div class="table-camera" id="tableCamera">
    <div class="table-plane" id="tablePlane">
      <div class="table-rim table-rim--far"></div>
      <div class="table-rim table-rim--left" role="group" aria-label="Tabs on the left edge">${tableRimHtml('left')}</div>
      <div class="table-mat" id="tableMat">
        <div class="table-cast" id="tableCast" hidden></div>
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
     and beside that — for a card of a deck the user may edit, on the Deck
     Builder's table — Add one and Remove one (tableLookActions): the things
     on the window that are not "put it back". */
  const look = document.createElement('div');
  look.className = 'table-look';
  look.id = 'tableLook';
  look.hidden = true;
  look.innerHTML = `
    <button type="button" class="table-look-back"></button>
    <img class="card-img table-look-card" alt="" draggable="false">
    <div class="table-look-actions">
      <button type="button" class="btn-secondary table-look-details">Details</button>
      <button type="button" class="btn-secondary table-look-add" hidden>Add one</button>
      <button type="button" class="btn-secondary table-look-remove" hidden>Remove one</button>
    </div>`;

  /* The panel the Deck Builder's drawer is lent to (tableDrawerOpen): a
     host and nothing else, since the drawer brings its own header — its
     tabs, where its + puts a card, its ✕. Fixed, with no z-index and no
     transform once it is up, so that, like the floating panel, it is
     neither a stacking context nor a containing block, and anything the
     drawer opens from inside it lands on the window as it does in the page;
     after the panel in the page, so it lies over a tucked one. */
  const drawerHost = document.createElement('section');
  drawerHost.className = 'table-drawer';
  drawerHost.id = 'tableDrawer';
  drawerHost.hidden = true;
  drawerHost.tabIndex = -1;
  drawerHost.setAttribute('role', 'dialog');

  /* Straight after the page shell rather than at the end of the body, so the
     table comes first in the keyboard's order: what follows the shell is
     furniture that floats — the drawer scrim, the Appearance popover, the RSS
     panel, whose controls stay focusable while it is folded to no width — and
     a first Tab should land on the rim, not in a panel nobody can see. Every
     one of those carries a z-index of its own, so coming after them in the
     page buys the table nothing in the stacking order. */
  const tools = tableToolsMake();
  const shell = document.querySelector('.site-main');
  if (shell) shell.after(scene, dim, panel, drawerHost, look, tools.pop);
  else body.append(scene, dim, panel, drawerHost, look, tools.pop);
  scene.querySelector('#tableMat').append(tools.slip, tools.bin);
  tableToolsMount();

  tableEls = {
    scene, dim, panel, look, drawerHost,
    camera:     scene.querySelector('#tableCamera'),
    plane:      scene.querySelector('#tablePlane'),
    mat:        scene.querySelector('#tableMat'),
    cast:       scene.querySelector('#tableCast'),
    hint:       scene.querySelector('#tableHint'),
    panelHdr:   panel.querySelector('.table-panel-hdr'),
    panelTitle: panel.querySelector('#tablePanelTitle'),
    panelUntuck: panel.querySelector('[data-table-untuck]'),
    panelBody:  panel.querySelector('.table-panel-body'),
    lookBack:   look.querySelector('.table-look-back'),
    lookImg:    look.querySelector('img'),
    lookDetails: look.querySelector('.table-look-details'),
    lookAdd:    look.querySelector('.table-look-add'),
    lookRemove: look.querySelector('.table-look-remove'),
  };

  /* Listeners on the elements go with them when the scene is taken down. */
  tableEls.plane.addEventListener('click', tableOnPlaneClick);
  scene.addEventListener('wheel', tableOnWheel, { passive: false });
  tableEls.mat.addEventListener('pointerdown', tableOnCardDown);
  tableEls.mat.addEventListener('dragstart', e => e.preventDefault());
  panel.querySelector('[data-table-close]').addEventListener('click', () => tableDismissPanel());
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
  tableEls.lookAdd.addEventListener('click', () => tableLookAdd());
  tableEls.lookRemove.addEventListener('click', () => tableLookRemove());
  /* The card-size slider, and the Deck Builder's drawer chips, on the far
     rim; the zones' chips beside the slip, and their own listeners on the
     mat. */
  tableScaleBuild();
  tableDrawerBuild();
  tableZonesBuild();
}

/* The table fitted to the window: its box worked out by tableFitSize and
 * handed to table.css as --table-x/-y/-w/-h on the scene. The far edge is
 * asked to sit a gutter below the window's top, plus the pan at rest's reach,
 * so a lean towards you never carries the far rim — and the slip and bin
 * lying on it — out of the window. Everything on the rim lies flat in the
 * table's plane, so nothing on it reaches past the plane's own edges, and
 * the plane's box is all there is to fit. */
function tableFitTable() {
  const { scene, camera } = tableEls;
  const view = { width: scene.clientWidth, height: scene.clientHeight };
  const depth = parseFloat(getComputedStyle(camera).perspective);
  const top = TABLE_FIT_GUTTER + TABLE_PAN_REST * view.height;
  const box = tableFitSize(view, { perspective: depth > 0 ? depth : Infinity, top });
  if (!box) return;
  scene.style.setProperty('--table-x', `${box.left.toFixed(2)}px`);
  scene.style.setProperty('--table-y', `${box.top.toFixed(2)}px`);
  scene.style.setProperty('--table-w', `${box.width.toFixed(2)}px`);
  scene.style.setProperty('--table-h', `${box.height.toFixed(2)}px`);
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
  if (tableZoneHold && tableZoneStep(now)) more = true;
  /* Asked every frame a card is in hand rather than on every pointer move:
     the camera can carry the bin under a pointer that is holding still —
     and tableCarry has just asked it, for the card's own look. */
  tableBinLight(!!tableHold?.over);
  tableSlipPlace();
  if (more) tableKick();
  else tableFrameAt = 0;
}

/* The pointer, anywhere over the window: where the camera is panning to, and
 * where a card in hand is. */
function tableOnPointerMove(e) {
  if (e.pointerType === 'touch') return;
  /* Not while the card-size slider is pressed: the slider lies on the
     table, and a camera that followed the hand dragging its thumb would
     carry the slider out from under it. */
  if (!tableScaleHeld) tableAim(e.clientX, e.clientY);

  const hold = tableHold;
  if (hold && e.pointerId === hold.id) {
    hold.pointer = { x: e.clientX, y: e.clientY };
    if (!hold.dragging && tableIsDrag(e.clientX - hold.start.x, e.clientY - hold.start.y)) hold.dragging = true;
  }
  tableZoneOnPointerMove(e);
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
 * held Ctrl is the browser's own zoom, and is left to it. Nor over the Deck
 * Builder's slip, which is a field being typed in; its suggestions float
 * outside the scene and are never asked. */
function tableOnWheel(e) {
  if (e.ctrlKey || e.target.closest?.('.table-panel, .table-slip')) return;
  e.preventDefault();
  /* Nor over the card-size slider, a control lying on the rim: a wheel
     turned over it zooms nothing — and does nothing else, since there is
     nothing behind the table to scroll either. */
  if (e.target.closest?.('.table-scale')) return;
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
  /* The card-size slider in hand keeps its keys: a range is no field being
     typed in, but − and + beside it, and 0, are about the slider then. */
  if (e.target?.closest?.('.table-scale')) return false;
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
    tableDrawerFit();
    tableSlipPlace();
    tableKick();
  });
}

/* Escape is the table's only when nothing else had a claim on it at the moment
 * it was pressed. Asked in the capture phase, before main.js's own Escape
 * handler has closed whatever drawer or menu it was for — by the time the key
 * reaches the bubble phase that evidence is gone.
 *
 * And `/`, which is the slip's while it is on the mat (tableSlipKey) — taken
 * here, before the document hears it, and stopped there: the Deck Builder's
 * own shortcuts listen on the document, and their `/` opens the builder's
 * search drawer, which would float the page up over the table the slip is
 * lying on. Whenever the slip does not take it, it goes on to them. */
function tableOnKeyCapture(e) {
  if (e.key === '/') { if (tableSlipKey(e)) e.stopPropagation(); return; }
  if (e.key !== 'Escape') return;
  const dialog = (typeof modalIsOpen === 'function' && modalIsOpen())
              || (typeof faqIsOpen === 'function' && faqIsOpen());
  if (dialog) { tableEscTaken = true; return; }
  if (tableLooked) { tableEscTaken = false; return; }
  /* A field in the Deck Builder's drawer with something typed in it keeps
     its Escape — the drawer's own, which closes the field's suggestions —
     and the drawer stays up round it. */
  if (tableDrawerKeepsEscape(e.target)) { tableEscTaken = true; return; }
  tableEscTaken = !!document.querySelector(
    '[data-drawer].open, .col-menu.open, .db-drawer-backdrop.open, .rss-panel.open');
}

/* Escape puts down whatever is in front: the card being looked at; then the
 * Deck Builder's drawer, when the focus is in it or nothing else is up —
 * it lies over everything on the table but that card; then the panel. */
function tableOnKey(e) {
  if (e.defaultPrevented) return;
  if (e.key !== 'Escape') { tableZoomKey(e); return; }
  if (tableEscTaken) return;
  if (tableLooked) { tableLookAway(); return; }
  if (tableDrawer && (!tablePanel || tableEls?.drawerHost.contains(document.activeElement))) {
    tableDrawerClose();
    return;
  }
  if (tablePanel) tableDismissPanel();
}

/* The window losing the pointer mid-drag: the card is put down where it is. */
function tableOnBlur() {
  if (tableHold) tableRelease({ pointerId: tableHold.id });
  if (tableZoneHold) tableZoneRelease({ pointerId: tableZoneHold.id });
  tableScaleLetGo();
}

function tableListen(on) {
  const method = on ? 'addEventListener' : 'removeEventListener';
  window[method]('pointermove', tableOnPointerMove, { passive: true });
  window[method]('pointerup', tableRelease);
  window[method]('pointercancel', tableRelease);
  window[method]('pointerup', tableZoneRelease);
  window[method]('pointercancel', tableZoneRelease);
  window[method]('pointerup', tableScaleLetGo);
  window[method]('pointercancel', tableScaleLetGo);
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
  tableCardScale = readTableCardScale();
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
  /* The drawer first: it goes home into the Deck Builder's pane, which the
     panel is about to put home in its turn. */
  tableDrawerClose({ refocus: false });
  tableClosePanel({ quiet: true });
  tableCardReturn = null;   // the mode going away is not a way back to anything
  tableListen(false);
  tableWatch?.disconnect();
  tableWatch = null;
  cancelAnimationFrame(tableFrameId);
  cancelAnimationFrame(tableResizeId);
  cancelAnimationFrame(tableScaleFrameId);
  clearTimeout(tableRelayId);
  tableFrameId = tableResizeId = tableFrameAt = tableRelayId = tableScaleFrameId = 0;
  tableScaleHeld = false;
  for (const card of tableCards) card.el = null;
  tableTools?.ac?.close();
  for (const el of [tableEls.scene, tableEls.dim, tableEls.panel, tableEls.drawerHost, tableEls.look, tableTools?.pop]) el?.remove();
  tableSlider = tableDrawerChips = null;
  tableToolsOn = tableBinOver = false;
  tableArrival = null;
  tableZoneHold = tableZoneEdit = tableZoneTarget = tableZoneLanding = tableZoneChips = null;
  tableZones = [];
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
    if (tablePanel?.tab === entry.tab) tableDismissPanel();
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
 * floating as it always does; only where it opens is new — beside the tab's
 * chip, towards the middle of the window from whichever edge the tab is on
 * (the left, at the near end), which toggleAppearance() cannot know about
 * since its sidebar opens it rightwards from the sidebar. Kept inside the
 * window, so a chip low on the edge opens it upwards from its foot.
 * closeAppearance() undoes all of it. */
function tableOpenAppearance(btn) {
  const menu = document.getElementById('appearanceMenu');
  if (!menu) return;
  if (menu.classList.contains('open')) { closeAppearance(); return; }
  menu.classList.add('open');
  const at   = (btn.querySelector('.table-tab-face') || btn).getBoundingClientRect();
  const box  = menu.getBoundingClientRect();
  const edge = 8;
  const inward = at.left + at.width / 2 < window.innerWidth / 2
    ? at.right + edge : at.left - box.width - edge;
  const left = Math.max(edge, Math.min(inward, window.innerWidth - box.width - edge));
  const top  = Math.max(edge, Math.min(at.top, window.innerHeight - box.height - edge));
  Object.assign(menu.style, {
    position: 'fixed', left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto',
  });
}

// ── Panels ────────────────────────────────────────────────────────────────

/* Put the pane in the panel. The pane's place in the page is held by a
 * comment, so going home is one replace and needs no record of its
 * neighbours. Returns whether a pane is now showing. */
function tableShowPane(tab, kind = tablePanelKind(tab), { keepDrawer = false } = {}) {
  if (!tableOn) return false;
  const pane = document.getElementById(`tab-${tab}`);
  if (!pane) return false;
  if (tablePanel && tablePanel.tab === tab && tablePanel.kind === kind) return true;
  const from = tablePanel?.tab ?? null;
  /* The view the Card sheet is coming up over, remembered before the panel
     it was in is put away — see tableCardReturnFor(). Read here, the one
     place every way of opening a tab passes through, while history.state is
     still the entry under the card's: openCardPage and setTab both push the
     card's own entry after this has run. Any other tab opened clears it, so
     a sheet that was swapped for something else does not later send the
     user back to a view they had already left. */
  if (tab === 'card') {
    const ret = tableCardReturnFor({ to: tab, from, tucked: tableTucked, laid: tableLaid?.tab ?? null });
    const before = typeof history !== 'undefined' ? history.state : null;
    tableCardReturn = ret && {
      ...ret,
      kind: from ? tablePanel.kind : null,
      backTo: before?.view === 'tab' && before.tab === ret.tab,
      token: ++tableCardSeq,
    };
    if (tableCardReturn?.backTo) tableStampCardEntry(tableCardReturn);
  } else {
    tableCardReturn = null;
  }
  tablePutPaneBack();
  tableUntuck();
  tableActedAt = 0;

  const { panel, panelTitle, panelBody, mat, dim } = tableEls;
  panel.dataset.kind = kind;
  panel.dataset.edge = tableRimEntry(tab)?.edge || 'far';
  panel.toggleAttribute('data-cards', kind === 'float' && tableIsCardTab(tab));
  panel.setAttribute('role', kind === 'float' ? 'dialog' : 'region');
  if (kind === 'grow') {
    /* Lying on the mat, above every card on it: over the highest, by two
       of the widest gaps — no higher, so a sheet over one card lies as low
       as that card does. */
    for (const prop of TABLE_FLOAT_PROPS) panel.style.removeProperty(prop);
    const top = tableCards.length * tableCardGapFor(tableCards.length);
    panel.style.setProperty('--table-sheet-z', `${(top + 2 * TABLE_CARD_GAP).toFixed(2)}px`);
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
  /* A page floating up over the table puts the Deck Builder's drawer away:
     the drawer floats beside the table, never beside a page lying over it
     — unless the page is about to be tucked again, as a view coming back
     tucked is (`keepDrawer`, tableRestoreView). The Card sheet lies on the
     mat, and the drawer stays over it. */
  if (kind === 'float' && !tableTucked && !keepDrawer) tableDrawerClose();
  tableDrawerFit();
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
 * What is measured is each chip and the room its label opens into. A side
 * edge is one chip wide, and a chip's label opens inwards from it over the
 * mat (table.css), so the reach measured is the chip as it lies at rest and
 * its label's own width beyond it — the words, and the --space-3 the label
 * opens with (table.css) — at the scale the chip is drawn at there.
 * A label pointed at while a panel floats then opens beside the panel, not
 * under it. The far edge holds no tabs, so the panel hangs from a gap below
 * the window's top; the near edge holds none either, so the panel tucks to
 * the window's foot between the side edges' tabs — clear of the account's
 * group at the near end of the left edge, as of every other. */
const TABLE_FLOAT_PROPS = ['left', 'top', 'width', 'height', 'right', 'margin-inline'];

function tableFitPanel() {
  if (!tablePanel || tablePanel.kind !== 'float' || !tableEls) return;
  const { panel } = tableEls;
  const view = { width: window.innerWidth, height: window.innerHeight };
  const clear = tableRimClear(view);
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

/* How far into the window the side edges' tabs reach, with the camera at
 * rest: { top, left, right } as tableFloatBox and tableDrawerBox take them —
 * the rightmost reach of the left edge's tabs and the leftmost of the right
 * edge's, each chip and the room its label opens into, and 0 for the far
 * edge, which holds no tabs — and `far`, the foot of the far rim, where the
 * slider, the slip, the bin and the chips lie, for a panel that keeps them
 * in reach (tableDrawerFit). Put back in the same task, so the rest pose is
 * never drawn. See tableFitPanel for why the label's room is counted. */
function tableRimClear(view) {
  const { camera, plane } = tableEls;
  const clear = { top: 0, left: 0, right: view.width, far: 0 };
  const was = camera.style.transform;
  camera.style.transform = 'none';
  clear.far = plane.querySelector('.table-rim--far')?.getBoundingClientRect().bottom || 0;
  const pad = tableLabelPad();
  for (const btn of plane.querySelectorAll('.table-tab')) {
    if (btn.hidden) continue;
    const face  = btn.querySelector('.table-tab-face');
    const label = btn.querySelector('.table-tab-label');
    const at = face.getBoundingClientRect();
    const scale = face.offsetWidth ? at.width / face.offsetWidth : 1;
    const reach = ((label?.scrollWidth || 0) + pad) * scale;
    const edge = TABLE_RIM[Number(btn.dataset.rim)]?.edge;
    if (edge === 'left')       clear.left  = Math.max(clear.left, at.right + reach);
    else if (edge === 'right') clear.right = Math.min(clear.right, at.left - reach);
  }
  camera.style.transform = was;
  return clear;
}

/* The padding a tab's label opens with, in pixels: --space-3, the token
 * table.css opens it with, read by laying out a probe that wide — a custom
 * property is handed back as written, in rem, rather than in pixels. */
function tableLabelPad() {
  const probe = document.createElement('span');
  probe.style.cssText = 'position: absolute; visibility: hidden; width: var(--space-3, 0px)';
  tableEls.plane.append(probe);
  const px = probe.offsetWidth;
  probe.remove();
  return px;
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
  tableDrawerFit();
  if (!quiet) plane.querySelector(`.table-tab[data-tab="${tab}"]`)?.focus({ preventScroll: true });
}

/* The Card sheet's own history entry stamped with its token, once whoever
 * opened the sheet has pushed it — openCardPage and setTab() both push after
 * the pane is shown, in the same task, so a microtask is after the push and
 * before anything else can move the history. If what stands then is not a
 * card entry, nothing was pushed (setTab skips a repeat of the entry it is
 * on) and nothing is stamped, so the close will not step Back off an entry
 * that is not the sheet's. See tableReturnByBack(). */
function tableStampCardEntry(ret) {
  if (typeof history === 'undefined' || typeof queueMicrotask !== 'function') return;
  queueMicrotask(() => {
    if (tableCardReturn !== ret) return;
    const state = history.state;
    if (!tableIsCardEntry(state)) return;
    history.replaceState({ ...state, tableOver: ret.token }, '');
  });
}

/* The panel put down by the user — its ✕, Escape, or its tab on the rim
 * pressed again. Every panel just closes, bar the Card sheet opened over
 * another view, which goes back to that view (tableCardReturnFor): by the
 * browser's Back where that is certainly the same thing, and otherwise by
 * opening the tab again. Either way it is setTab() that arrives, and
 * tableModeBeforeTab() that restores — so nothing here moves a pane itself,
 * and the history is stepped at most once. */
function tableDismissPanel() {
  const back = tablePanel?.tab === 'card' ? tableCardReturn : null;
  if (!back) { tableClosePanel(); return; }
  if (tableReturnByBack({ ret: back, state: history.state })) {
    history.back();
    return;
  }
  setTab(back.tab);
}

/* The view the Card sheet was opened over, put back as it was: the tab's
 * panel open, or tucked, or — when it was the mat alone — no panel at all,
 * the sheet simply put away. Called from tableModeBeforeTab(), so setTab()
 * goes on to draw the tab and lay its cards again (tableModeAfterTab), and
 * those land where a hand last put them (tableMoved).
 *
 * Opening the tab's pane may tuck it by itself — the Card tab is a tab with
 * cards too, so tableTuckOnOpen can answer yes for a user who last tucked
 * one — and the panel is then set to what it was, not to that guess. */
function tableRestoreView(back) {
  if (back.panel === 'closed') { tableClosePanel(); return; }
  const tuck = back.panel === 'tucked';
  tableShowPane(back.tab, back.kind || tablePanelKind(back.tab), { keepDrawer: tuck });
  if (tuck !== tableTucked) tableTuckPanel(tuck);
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
    /* Up again over the table, the page puts the drawer away (tableShowPane). */
    tableDrawerClose({ refocus: false });
  }
  tableDrawerFit();
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
    /* The commander is not one of the piles — it is a board of its own, and
       the piles are the mainboard's categories — so it is asked for apart. */
    const heads = (typeof dbShownCommanders === 'function' && dbShownCommanders()) || [];
    return { cards: tableDeckCards(heads, piles, tableImageOf), hint: TABLE_EMPTY_HINT, fetch: true };
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
 * and in the same piles, is not laid again — only its pictures and its cards'
 * counts are brought up to date — so nothing moves when nothing changed. Returns whether cards were
 * laid; a tab that lays nothing returns false and leaves the mat alone. */
function tableLayFor(tab) {
  const source = tableSourceFor(tab);
  if (!source) return false;
  const sig = tableListSig(source.cards, tab, source.feature);
  if (tableLaid && tableLaid.tab === tab && tableLaid.sig === sig) {
    tablePatchCards(source.cards, tab);
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

/* The same cards as are lying on the mat, some of them with a picture now,
 * or a different count of copies — one taken out by the bin, one more added
 * from the slip of a card the deck already has. Neither moves a card, so
 * each is put on the card where it lies. */
function tablePatchCards(list, scope) {
  const fresh = new Map(tableKeyCards(list, scope).map(card => [card.key, card]));
  for (const card of tableCards) {
    const now = fresh.get(card.key);
    if (!now) continue;
    const url = now.imageUrl || card.imageUrl;
    if (url === card.imageUrl && now.qty === card.qty) continue;
    card.imageUrl = url;
    card.qty = now.qty;
    if (!card.el) continue;
    card.el.innerHTML = tableCardFace(card);
    card.el.setAttribute('aria-label', tableCardLabel(card));
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
    if (!tableOn) return;
    /* The pane is watched while it is open in a panel, and the Deck
       Builder's while its drawer lies over the table too (tableDrawerWatch):
       a card added from the drawer is laid where it lands even with no panel
       up to notice the deck redrawn. */
    const inPanel = tablePanel?.tab === tab;
    if (!inPanel && !(tab === 'deckview' && tableDrawer)) return;
    /* Nothing new to lay may still be a count changed in a zone's label. */
    if (!tableLayFor(tab)) { if (tab === 'deckview') tableZonesRefresh(); return; }
    const actedAgo = tableActedAt ? Date.now() - tableActedAt : Infinity;
    if (inPanel && tableShouldAutoTuck({
      kind: tablePanel.kind, tab, tucked: tableTucked, actedAgo, drawer: !!tableDrawer,
    })) tableTuckPanel(true);
    tableActedAt = 0;
  }, wait);
}

// ── Cards ─────────────────────────────────────────────────────────────────

/* Lay a list of cards on the mat. Each is { name, imageUrl, id?, group?,
 * qty? }; cards past the scope's cap (tableCardsMaxFor) are not drawn. A card is known across calls by
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
  tableScope = String(scope || '');
  tableHintText = hint || TABLE_HINT;
  if (tableOn) tableDrawCards();
  return tableCards.length;
}

function tableCardZ(card) {
  /* Laid in zones, a card lies at the height its zone gives it (tableZonesLayer). */
  if (card.zoneZ != null) return card.zoneZ;
  return (card.rank + 1) * tableCardGapFor(tableCards.length);
}

/* The size a card is drawn at: a pile's card size, or TABLE_HEAD_SCALE times
 * it for a card at the head of the mat. Laid out at that size rather than
 * scaled to it, so its picture is decoded for the size it is drawn at. */
function tableCardBox(card) {
  const k = card?.head ? TABLE_HEAD_SCALE : 1;
  return { w: tableCardSize.w * k, h: tableCardSize.h * k };
}

function tableSizeCard(card) {
  if (!card.el) return;
  const { w, h } = tableCardBox(card);
  card.el.style.width  = `${w.toFixed(2)}px`;
  card.el.style.height = `${h.toFixed(2)}px`;
}

/* A card's transform: where it lies, how high above the felt, the angle it
 * lies at, and how far it leans back towards the viewer — and `shrink`, how
 * small it has become going into the bin. One string, so a card settling
 * eases every part of it at once. */
function tableWriteCard(card, lift = 0, lean = 0, shrink = 1) {
  if (!card.el || !tableGeom) return;
  card.el.style.transform =
    tableLieTransform(card, tableCardBox(card), tableGeom.mat, tableCardZ(card) + lift, lean, shrink);
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
  /* tableCardSize is the size the slider has laid the cards at, so a card
     grown by it asks for the large pictures by itself (tableCardPicture). */
  const { k, large } = tableCardPicture(tableCardSize.w, {
    head: tableCards.some(card => card.head), zoom, dpr: window.devicePixelRatio,
  });
  if (k !== tableDecodeK) {
    tableDecodeK = k;
    tableEls.scene.style.setProperty('--table-card-k', String(k));
  }
  if (tableHiRes || !large) return;
  tableHiRes = true;
  for (const card of tableCards) {
    const img = card.el?.isConnected && card.el.querySelector('.table-card-img');
    if (img) img.src = tableCardSrc(card);
  }
}

/* A card that has no picture is not drawn as one: it keeps a surface and its
 * name, as the stacks' blank does. A card standing for more than one copy —
 * thirty Islands are one card on the mat, not thirty — says how many in a
 * small count lying on its lower-left corner (tableQtyBadge). */
function tableCardFace(card) {
  const face = card.imageUrl
    ? `<img class="card-img table-card-img" src="${esc(tableCardSrc(card))}" alt="" draggable="false">`
    : `<span class="table-card-blank">${esc(card.name)}</span>`;
  return face + tableQtyBadge(card.qty);
}

/* The count a card carries for its copies: "×30", or nothing for one. It is
 * drawn, so it is read; the card's own name says it to a screen reader
 * (tableCardLabel), so the badge is hidden from one. */
function tableQtyBadge(qty) {
  const n = tableQty(qty);
  return n > 1 ? `<span class="table-card-qty" aria-hidden="true">×${n}</span>` : '';
}

/* What a card is called to a screen reader: its name, its copies past one,
 * and what pressing it does when that is to open something. */
function tableCardLabel(card) {
  const n = tableQty(card.qty);
  const name = n > 1 ? `${card.name}, ${n} copies` : card.name;
  return card.open ? `Open ${name}` : name;
}

function tableCardEl(card) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'table-card';
  el.dataset.key = card.key;
  el.setAttribute('aria-label', tableCardLabel(card));
  el.innerHTML = tableCardFace(card);
  el.addEventListener('click', tableOnCardClick);
  return el;
}

function tableDrawCards() {
  if (!tableEls || !tableGeom) return;
  const { mat, hint } = tableEls;
  const before = new Set([...mat.querySelectorAll('.table-card')].map(el => el.dataset.key));
  for (const old of mat.querySelectorAll('.table-card')) old.remove();
  /* The slip and the bin lie on the far rim, not on the mat, so they take
     none of it from the piles; they are only shown or not for the cards
     about to be laid. Nor do the card-size slider and the drawer's chips
     beside them. */
  tableSyncTools();
  tableScaleSync();
  tableDrawerSyncChips();
  const { width, height } = tableGeom.mat;
  mat.toggleAttribute('data-many', !tableRestShadows(tableCards.length));
  /* At the card-size slider's scale (tableScaledPlaces); at 1, the layout
     the table has always laid. */
  const { size, places } = tableScaledPlaces(tableCards, width, height, tableCardScale, tableMoved, tableFeature);
  tableCardSize = size;
  /* Asked before the pictures are written, so a large card on a hi-dpi
     screen — the Card tab's — is drawn from the large picture straight away
     rather than from the normal one and then again. */
  tableSharpen();
  const cards = document.createDocumentFragment();
  tableCards.forEach((card, i) => {
    Object.assign(card, places[i]);
    card.el = tableCardEl(card);
    tableSizeCard(card);
    cards.append(card.el);
  });
  mat.insertBefore(cards, hint);
  /* Laid in zones instead, when they are on: the zones place every card
     they hold over the piles' places. */
  tableZonesPlace();
  for (const card of tableCards) tableWriteCard(card);
  tableArrive(before);
  tableZoneLand();
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
    ? tableFeatureSize(tableGeom.mat.width, tableGeom.mat.height, tableCardScale).lane : 0;
  if (lane) tableEls.panel.style.setProperty('--table-sheet-lane', `${lane}px`);
  else tableEls.panel.style.removeProperty('--table-sheet-lane');
}

/* The mat changed size: the cards keep their places, which are fractions of
 * it, and take the card size the new mat wants. */
function tableResizeCards() {
  /* The large card's place is worked out from the lane, which a new mat
     width moves, so it is laid again rather than resized where it was. */
  if (tableFeature) { tableDrawCards(); return; }
  const w = tableCardWidthFor(tableGeom.mat.width, tableGeom.mat.height, tableCardScale,
    { head: tableCards.some(card => card.head) });
  tableCardSize = { w, h: w * TABLE_CARD_RATIO };
  tableSharpen();
  for (const card of tableCards) {
    if (!card.el) continue;
    tableSizeCard(card);
    tableWriteCard(card);
  }
  /* Zones are fractions of the mat too, and fit the new card size again. */
  if (tableZones.length) tableZonesRefresh();
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
  tableZonePickUp(card);
  const hit = tableUnproject(tableMatrix(), e.clientX, e.clientY, tableCardZ(card));
  if (!hit) return;
  const { width, height } = tableGeom.mat;
  tableHold = {
    card, id: e.pointerId, dragging: false, lift: 0,
    since:   performance.now(),
    /* How far it has gone over to the bin's look (tableBinProgress), and when
       that was last asked, for the length of the next frame. */
    binT: 0, binAt: performance.now(), over: false,
    /* Where it would land if let go now (tableDropSpot), asked each frame
       it is carried; the landing mark is laid on it. */
    land: null,
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
 * zooms beneath it. That place, kept on the mat, is where it would land
 * (tableDropSpot), and the landing mark is laid there in the same frame.
 * Returns whether it is still rising, which is what asks for another frame. */
function tableCarry(now) {
  const hold = tableHold;
  const card = hold.card;
  const motion = cardMotionOn();
  const rise = tableLiftHeight(now - hold.since, motion);

  /* Over the bin, the card goes over to the look that says it is going in
     (tableBinPose): down towards the bin, smaller, fainter and drawn towards
     its middle — eased both ways in the lift's time. Whether it is over is
     the pointer's question, never the card's, so the card being drawn
     towards the bin cannot change the answer. */
  hold.over = !!hold.dragging && !!card.ref && tableOverBin(hold.pointer);
  tableZoneHover(hold);
  hold.binT = tableBinProgress(hold.binT, hold.over, now - hold.binAt, motion);
  hold.binAt = now;
  const pose = tableBinPose(hold.binT,
    tableBinHeldShrink(tableCardBox(card).w, tableTools?.bin.offsetWidth || 0));
  /* Down to TABLE_BIN_HOVER above the bin, wherever the card's own place in
     the pile is: a lift below nothing is a card held lower than it lay. */
  const hover = tableToolsZ() + TABLE_BIN_HOVER - tableCardZ(card);
  hold.lift = rise + (hover - rise) * pose.k;

  const hit = tableUnproject(tableMatrix(), hold.pointer.x, hold.pointer.y, tableCardZ(card) + hold.lift);
  const { width, height } = tableGeom.mat;
  const land = tableDropSpot(hit, hold.grab, width, height);
  if (land) {
    hold.land = land;
    let u = land.x * width, v = land.y * height;
    /* The bin lies on the far rim, off the mat, so the card going in is
       drawn towards it unheld by the mat's edges — the spot it would land
       on, were it let go somewhere else, is still on the mat. */
    if (pose.k > 0) {
      const bin = tableBinRect();
      const bu = bin.left + bin.width / 2, bv = bin.top + bin.height / 2;
      u += (hit.u + (bu - hit.u) * TABLE_BIN_HELD_PULL - u) * pose.k;
      v += (hit.v + (bv - hit.v) * TABLE_BIN_HELD_PULL - v) * pose.k;
    }
    card.x = u / width;
    card.y = v / height;
  }
  const lean = TABLE_CARD_LIFT ? -TABLE_CARD_LEAN * rise / TABLE_CARD_LIFT * (1 - pose.k) : 0;
  tableWriteCard(card, hold.lift, lean, pose.shrink);
  /* Fainter on its picture, a leaf, rather than on the card: opacity under 1
     on the card would flatten the 3D context its picture is kept sharp by. */
  if (pose.k > 0) card.el?.style.setProperty('--table-bin-fade', pose.opacity.toFixed(3));
  else card.el?.style.removeProperty('--table-bin-fade');
  tableCastWrite(hold.dragging && !hold.over ? tableZoneCast(hold) : null);
  return rise !== tableLiftHeight(Infinity, motion) || hold.binT !== (hold.over ? 1 : 0);
}

/* The landing mark: laid where the card in hand would land — `hold.land`,
 * the very spot tableRelease puts it down on — at the card's own angle, size
 * and resting height (tableCastPose), and drawn above every pile on the mat
 * yet under the card in hand (tableCastDrawZ) without moving on the screen
 * (tableCastTransform); or put away, for no hold. Written in the frame the
 * card is, after the camera, with no easing of its own, so it is never a
 * frame behind the card or the table, and with cards still it simply
 * tracks. One element, kept for the scene. */
function tableCastWrite(hold) {
  const cast = tableEls?.cast;
  if (!cast) return;
  if (!hold?.land || !tableGeom) { cast.hidden = true; return; }
  const card = hold.card;
  const box = tableCardBox(card);
  const pose = tableCastPose(hold.land, card.turn, tableCardZ(card));
  cast.style.width  = `${box.w.toFixed(2)}px`;
  cast.style.height = `${box.h.toFixed(2)}px`;
  cast.style.transform = tableCastTransform(tableMatrix(), pose, box, tableGeom.mat,
    tableCastDrawZ(pose.z, hold.lift));
  cast.hidden = false;
}

/* Let go. The landing mark goes, and a drag puts the card down on the
 * spot the mark lay on, in the card layer's own time (table.css,
 * .is-settling). A press that never became a drag is left to
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
  tableCastWrite(null);
  const card = hold.card;
  card.el?.style.removeProperty('--table-bin-fade');
  /* Let go over the bin: one copy of it out of the deck, and the card into
     the bin rather than lying where the hand left it — so it is not kept
     there for the next time the deck is laid (tableBinCard). */
  const binned = hold.dragging && e?.type === 'pointerup' && !!card.ref && tableOverBin(hold.pointer);
  tableBinLight(false);
  if (binned) {
    tableSwallow = true;
    tableBinCard(card, hold.from);
    return;
  }
  /* Laid in zones, a card carried goes into a zone or back to its own. */
  if (hold.dragging && tableZoneDrop(hold, e)) return;
  if (hold.dragging) {
    tableSwallow = true;
    /* Down onto the spot the landing mark lay on — the one the card is
       drawn over in hand, except while it is still easing back from the
       bin's look, when it is drawn part of the way towards the bin. */
    if (hold.land) { card.x = hold.land.x; card.y = hold.land.y; }
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
  const finish = e => {
    /* Its own, not one of its children's: the picture inside a card eases its
       shadow on a shorter clock, and that transition's end bubbles up here. */
    if (finished || (e && e.target !== el)) return;
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
  const acts = tableLookActions({ toolsOn: tableToolsOn, ref: card.ref });
  tableEls.lookRemove.hidden = !acts.remove;
  tableEls.lookRemove.title = `Take one ${card.name} out of the deck`;
  tableEls.lookAdd.hidden = !acts.add;
  tableEls.lookAdd.title = `Put one more ${card.name} in the deck`;
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

// ── The Deck Builder's slip and bin ──────────────────────────────────────

/* The bin's icon, drawn in the sidebar's own hand — a 24-unit box, a 2.2
 * stroke, round ends — with its lid as a group of its own, so that it can
 * lift open while a card is held over it (table.css). */
const TABLE_BIN_ICON =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<g class="table-bin-lid"><path d="M3 6h18"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></g>' +
  '<path d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

/* How far below the slip its suggestions float, in window pixels; how long a
 * card added from the slip is still looked for among the cards laid next, to
 * come in from the slip — long enough for a card the deck has no data for to
 * be fetched first, which dbAddCard waits for before it redraws; and how
 * small a card has become by the time it is in the bin. */
const TABLE_POP_GAP     = 6;
const TABLE_ARRIVAL_MS  = 10000;
const TABLE_BIN_SHRINK  = 0.2;

/* A card in hand over the bin says it is going in, and stops hiding the bin:
 * it comes down towards the bin — to TABLE_BIN_HOVER pixels above it — shrinks
 * to TABLE_BIN_HELD_SHRINK of its size, or further, to TABLE_BIN_HELD_FIT of
 * the bin's width, for a card too big for that to leave the bin showing
 * (tableBinHeldShrink); fades to TABLE_BIN_HELD_FADE; and its centre is
 * drawn TABLE_BIN_HELD_PULL of the way from the pointer to the bin's centre,
 * so the lit bin shows round it. In the time a card takes to come up off the
 * felt, TABLE_LIFT_MS, on the same ease-out, both ways. */
const TABLE_BIN_HELD_SHRINK = 0.55;
const TABLE_BIN_HELD_FIT    = 0.8;
const TABLE_BIN_HELD_FADE   = 0.85;
const TABLE_BIN_HELD_PULL   = 0.5;
const TABLE_BIN_HOVER       = 8;

/* The slip, its suggestions and the bin, made once and kept for the session:
 * the slip's field is mounted on the app's own card autocomplete
 * (mountCardAutocomplete, js/sortui.js) — the one the builder's Add a card
 * field is — and that adds a listener to the document of its own for the
 * click outside it. Made once, it is added once, however often the table is
 * put up and taken down; the elements go into each new scene and come out of
 * it with the scene.
 *
 * The slip lies on the far rim, in the table's plane, at the middle of it;
 * the bin lies on the far rim too, towards its right-hand end. Both are the
 * mat's children, laid out above its top edge (table.css), so their boxes
 * are in the mat's pixels — negative ones, up there — like everything else
 * the hand meets on the table. Both lie on the wood, a hair above it
 * (--table-tools-z, tableToolsZ). The slip's suggestions do not lie in the
 * plane: a list tilted
 * away with the table would be hard to read, so they float flat over the
 * window, outside the scene, hung below wherever the slip is drawn
 * (tableSlipPlace). */
function tableToolsMake() {
  if (tableTools) return tableTools;
  const slip = document.createElement('div');
  slip.className = 'table-slip';
  slip.dataset.tab = 'deckview';
  slip.hidden = true;
  slip.innerHTML = `
    <div class="autocomplete-wrap table-slip-field">
      <input type="text" id="tableSlipInput" class="table-slip-input" aria-label="Add a card to this deck"
             placeholder="Add a card…" autocomplete="off" spellcheck="false">
    </div>`;

  const pop = document.createElement('div');
  pop.className = 'table-slip-pop';
  pop.innerHTML = '<div id="tableSlipDrop" class="ac-dropdown table-slip-drop" style="display:none"></div>';

  const bin = document.createElement('div');
  bin.className = 'table-bin';
  bin.dataset.tab = 'deckview';
  bin.hidden = true;
  bin.setAttribute('role', 'img');
  bin.setAttribute('aria-label', 'Bin: a card dropped here takes one copy of it out of the deck');
  bin.title = 'Drop a card here to take one copy of it out of the deck';
  bin.innerHTML = TABLE_BIN_ICON;

  const input = slip.querySelector('input');
  const drop  = pop.firstElementChild;
  /* A press on the slip is a press on a field: it is not a card picked up,
     and nothing under it on the mat is told about it. */
  slip.addEventListener('pointerdown', e => e.stopPropagation());
  /* Escape with no suggestions open puts the field down, so the next key is
     the table's again. With them open it is the autocomplete's, which closes
     them and says so by preventing it. */
  input.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.stopPropagation();
    input.blur();
  });
  tableTools = { slip, input, pop, drop, bin, ac: null, mounted: false };
  /* The autocomplete opens and closes its list by its display; whenever it
     does, the list is hung above the slip where it is drawn now. Only the
     host is written to, never the list, so this cannot answer itself. */
  if (typeof MutationObserver === 'function') {
    new MutationObserver(tableSlipPlace).observe(drop, { attributes: true, attributeFilter: ['style'] });
  }
  return tableTools;
}

/* Mounted the first time the field is in the page, where the autocomplete
 * looks for it by id. Enter takes what is typed, or the suggestion walked to;
 * a click takes the one clicked. */
function tableToolsMount() {
  const t = tableTools;
  if (!t || t.mounted || typeof mountCardAutocomplete !== 'function') return;
  t.ac = mountCardAutocomplete('tableSlipInput', 'tableSlipDrop', name => tableSlipAdd(name),
    { onEnter: () => tableSlipAdd(t.input.value) });
  t.mounted = !!t.ac;
}

/* The slip and bin shown or not, by tableToolsShown, for the cards on the mat
 * now and the deck open now — asked every time cards are drawn. Put away,
 * the slip lets go of its field and its suggestions, and the bin of its
 * light. Both lie on the wood, a hair above it (tableToolsZ). */
function tableSyncTools() {
  const t = tableTools;
  if (!t || !tableEls) return;
  const deck = typeof dbDeck !== 'undefined' ? dbDeck : null;
  const on = tableToolsShown({
    scope: tableScope,
    deckOpen: !!deck,
    canEdit: !!deck && typeof isMyPlayer === 'function' && isMyPlayer(deck.playerId),
  });
  tableToolsOn = on;
  t.slip.hidden = !on;
  t.bin.hidden = !on;
  const z = `${tableToolsZ().toFixed(2)}px`;
  t.slip.style.setProperty('--table-tools-z', z);
  t.bin.style.setProperty('--table-tools-z', z);
  if (!on) {
    t.ac?.close();
    if (document.activeElement === t.input) t.input.blur();
    tableBinLight(false);
  }
}

/* How high above the wood the slip and the bin lie: a card's gap, the
 * height of the first card on a mat — on the wood, in the table's plane, and
 * a hair above it so that they are never a coin toss against it. They lie on
 * the far rim, where no card is laid; a card a hand leaves hanging over the
 * mat's far edge lies over them, as it would over anything on the wood. */
function tableToolsZ() {
  return TABLE_CARD_GAP;
}

/* The bin's box in the mat's own pixels. It lies on the far rim, above the
 * mat's top edge, so its top is negative: the mat's pixels run on past the
 * mat's edges across the whole of the table's plane, which the rim shares,
 * and the bin's laid-out box is read in them like a card's (offsetTop and
 * friends, against the mat it is a child of — no transform touches them). */
function tableBinRect() {
  const { bin } = tableTools;
  return { left: bin.offsetLeft, top: bin.offsetTop, width: bin.offsetWidth, height: bin.offsetHeight };
}

/* Whether a window point is over the bin: the point mapped onto the table's
 * plane at the height the bin lies at, through the camera as it is now — the
 * mapping a card in hand is carried by — and asked against the bin's box
 * there. The mapping is the plane's, not only the mat's: tableUnproject
 * answers for any point of the plane, the rim's included, in the mat's
 * pixels, so a bin lying on the rim is hit exactly as one on the mat was. */
function tableOverBin(pointer) {
  if (!tableToolsOn || !tableGeom || !pointer) return false;
  const hit = tableUnproject(tableMatrix(), pointer.x, pointer.y, tableToolsZ());
  return tableInMatRect(hit, tableBinRect());
}

/* The bin, lit — in its tab's accent, a little larger and with its lid up —
 * while a card in hand is over it. Written only when that changes. */
function tableBinLight(on) {
  if (!!on === tableBinOver) return;
  tableBinOver = !!on;
  tableTools?.bin.classList.toggle('is-over', tableBinOver);
}

/* A card put in the bin: it goes in, shrinking and fading as it does, and
 * one copy of it comes out of the deck once it is in (tableRemoveOne). The
 * last copy goes from the mat with the redraw that edit brings; a card with
 * copies to spare comes back out to where it lay before it was picked up —
 * `from` — since the rest of it is still in the deck. With cards still the
 * transitions are none: the card is simply gone, or simply back. The bin's
 * place is not where a hand put the card, so it is not kept as one. */
function tableBinCard(card, from) {
  const el = card.el;
  if (!el || !tableGeom) return;
  const { width, height } = tableGeom.mat;
  const rect = tableBinRect();
  el.classList.remove('is-held', 'is-settling');
  el.classList.add('is-binned');
  card.x = (rect.left + rect.width / 2) / width;
  card.y = (rect.top + rect.height / 2) / height;
  tableWriteCard(card, Math.max(0, tableToolsZ() - tableCardZ(card)), 0, TABLE_BIN_SHRINK);
  tableAfter(el, () => {
    const action = tableRemoveOne(card);
    card.x = from.x;
    card.y = from.y;
    if (action === 'remove' && !el.isConnected) return;
    if (action === 'remove') { tableWriteCard(card, 0, 0, TABLE_BIN_SHRINK); return; }
    /* Still in the deck — a copy to spare, or the edit refused: it fades
       back in where it lay, without sliding back out of the bin. */
    el.classList.add('is-unbinning');
    el.classList.remove('is-binned');
    tableWriteCard(card);
    tableAfter(el, () => el.classList.remove('is-unbinning'));
  });
}

/* One copy of a card out of the open deck, through the builder's own edits —
 * see tableBinAction — with the app's notice saying so. The app has no undo
 * for an edit like this one beyond the deck's history, so the notice says
 * what was done and offers nothing. The mat is laid again from the deck at
 * once, whether or not its panel is open to notice the redraw. Returns what
 * was done, or null for a card the deck no longer has, or may not change. */
function tableRemoveOne(card) {
  if (!tableToolsOn || !card?.ref || typeof dbFindCard !== 'function') return null;
  const row = dbFindCard(card.ref);
  if (!row) return null;
  const action = tableBinAction(row.qty);
  if (action === 'less') dbChangeQty(card.ref, -1);
  else dbRemoveCard(card.ref);
  if (typeof showToast === 'function') {
    showToast(action === 'less'
      ? `✓  Removed one "${card.name}", ${row.qty || 1} left`
      : `✓  Removed "${card.name}"`);
  }
  tableRelayDeck();
  return action;
}

/* The Deck Builder's cards laid again from the deck as it is now — for an
 * edit made from the table, which the pane's watcher only sees while the
 * pane is open in a panel. A deck that did not change lays nothing. */
function tableRelayDeck() {
  if (tableOn && tableScope === 'deckview' && !tableLayFor('deckview')) tableZonesRefresh();
}

/* Remove one, pressed under a card being looked at: the card put back down
 * at once, and into the bin from where it lies, as if it had been carried
 * there. */
function tableLookRemove() {
  const card = tableLooked;
  if (!card || !card.ref || !tableToolsOn) return;
  tableLookAway(true);
  tableBinCard(card, { x: card.x, y: card.y });
}

/* One more copy of a card in the open deck, through the builder's own
 * stepper — dbChangeQty by +1, what its + on a row and on a card's menu
 * press, which saves the deck and keeps its history — with the app's notice
 * saying so in Remove one's words. Only what tableLookActions offers Add one
 * for: a card the deck holds by its ref, in a deck the user may edit, and no
 * commander. The mat is brought up to date from the deck at once
 * (tableRelayDeck); the card's place is unchanged, so only the count on it is
 * written (tablePatchCards), and nothing is laid again. Returns 'more', or
 * null for a card nothing was added to. */
function tableAddOne(card) {
  if (!card?.ref || !tableLookActions({ toolsOn: tableToolsOn, ref: card.ref }).add) return null;
  if (typeof dbFindCard !== 'function' || typeof dbChangeQty !== 'function') return null;
  const row = dbFindCard(card.ref);
  if (!row) return null;
  /* dbChangeQty writes the count before anything it waits on, so the row
     says the new one by the time the notice is written — and a count that
     did not move is an add the builder refused, which says nothing. */
  const before = row.qty || 1;
  dbChangeQty(card.ref, 1);
  const now = row.qty || 1;
  if (!(now > before)) return null;
  if (typeof showToast === 'function') showToast(`✓  Added one "${card.name}", ${now} in the deck`);
  tableRelayDeck();
  return 'more';
}

/* Add one, pressed under a card being looked at: one more copy, and the card
 * still in hand, so a second press is a second copy — the count on it, under
 * the card being looked at, is written as it goes, and the notice says it. */
function tableLookAdd() {
  const card = tableLooked;
  if (!card) return;
  tableAddOne(card);
}

/* A card added from the slip: one copy, through the builder's own add —
 * which files it in its category, saves the deck and keeps its history —
 * and the field cleared and kept for the next. The builder's own Add a card
 * field is cleared by that add as it always is; what was typed there is put
 * back, since it was not what was added. Nothing about the panel changes:
 * it is not opened, and not brought up from tucked. The card is looked for
 * among the cards laid next, to come in from the slip (tableArrive). */
function tableSlipAdd(raw) {
  const t = tableTools;
  if (!t) return;
  const name = String(raw || '').trim();
  t.input.value = '';
  t.ac?.close();
  t.input.focus({ preventScroll: true });
  if (!name || !tableToolsOn || typeof dbAddCard !== 'function' || !tableGeom) return;
  const { width, height } = tableGeom.mat;
  tableArrival = {
    name,
    x: (t.slip.offsetLeft + t.slip.offsetWidth / 2) / width,
    y: (t.slip.offsetTop + t.slip.offsetHeight / 2) / height,
    until: Date.now() + TABLE_ARRIVAL_MS,
  };
  const builder = document.getElementById('dbAddCardInput');
  const kept = builder ? builder.value : '';
  const added = dbAddCard(name);
  if (builder) builder.value = kept;
  Promise.resolve(added).catch(() => {}).then(tableRelayDeck);
}

/* The card just added from the slip, if it is among the cards just drawn and
 * was not on the mat before them (`before`, the keys that were): drawn first
 * at the slip, then let settle to its place in the card layer's own time. Not
 * when cards may not move — it is simply in its pile. */
function tableArrive(before) {
  const arrival = tableArrival;
  if (!arrival) return;
  if (Date.now() > arrival.until) { tableArrival = null; return; }
  const card = tableCards.find(c => c.name === arrival.name && c.el && !before.has(c.key));
  if (!card) return;
  tableArrival = null;
  if (!cardMotionOn()) return;
  const at = { x: card.x, y: card.y };
  card.x = arrival.x;
  card.y = arrival.y;
  tableWriteCard(card);
  void card.el.offsetWidth;
  card.x = at.x;
  card.y = at.y;
  card.el.classList.add('is-settling');
  tableWriteCard(card);
  const el = card.el;
  tableAfter(el, () => el.classList.remove('is-settling'));
}

/* The slip's suggestions hung below the slip as it is drawn now — its drawn
 * box, through the tilt and the camera — flat and as wide as it, while they
 * are open. Below, because the slip lies on the far rim, at the top of the
 * window: the list drops down over the table, where there is room for it.
 * Asked when they open and on every frame the camera moves. */
function tableSlipPlace() {
  const t = tableTools;
  if (!t || !tableOn || t.slip.hidden || t.drop.style.display !== 'block') return;
  const at = t.slip.getBoundingClientRect();
  t.pop.style.left  = `${at.left.toFixed(1)}px`;
  t.pop.style.top   = `${(at.bottom + TABLE_POP_GAP).toFixed(1)}px`;
  t.pop.style.width = `${at.width.toFixed(1)}px`;
}

/* `/` puts the slip's field in hand, while the slip is on the mat and the
 * table is what is in front: not with a card being looked at, a dialog up, or
 * a panel floating over the table, and not with a field already being typed
 * in, where `/` is a character. */
function tableSlipKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || tableIsTyping(e.target)) return false;
  if (!tableToolsOn || !tableTools || tableLooked) return false;
  if ((typeof modalIsOpen === 'function' && modalIsOpen()) || (typeof faqIsOpen === 'function' && faqIsOpen())) return false;
  if (tablePanel && tablePanel.kind === 'float' && !tableTucked) return false;
  e.preventDefault();
  tableTools.input.focus({ preventScroll: true });
  return true;
}

// ── The card-size slider ─────────────────────────────────────────────────
// A chip lying on the far rim, at its left-hand end: − , a range, + and the
// size it is at, from TABLE_CARD_SCALE_MIN to TABLE_CARD_SCALE_MAX of the
// size the table lays its cards at. On every tab that lays cards
// (tableScaleShown), and kept per browser (TABLE_CARD_SCALE_KEY).
//
// Every layout takes the size from it — the piles, the commander's head spot
// (still a tenth larger than the piles), the zones' fit, the Card tab's one
// card and the Decks tab — and a hand dragging it is answered every frame at
// most, and cheaply: the cards are resized and moved where they are, never
// made again (tableRescaleCards). A card a hand has moved keeps its centre and
// grows or shrinks about it. A zone keeps its rect; its cards are fitted into
// it again, closer together or piled as they grow.
//
// It is a control lying on the table, and the table leaves it alone: a press
// on it is no card picked up and no zone taken in hand, the camera does not
// follow the pointer while it is pressed, the wheel over it zooms nothing,
// and its keys — the arrows, and − + 0 — are its own while it has the focus.

/* The − and + beside the range, in the sidebar's own hand. */
const TABLE_SCALE_LESS_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const TABLE_SCALE_MORE_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/>' +
  '<line x1="5" y1="12" x2="19" y2="12"/></svg>';

/* The slider, made with each scene and laid on the far rim (table.css). The
 * range counts in whole percent, so the value it hands back is never a
 * float's approximation of a step. Its range is the app's own .size-slider,
 * the control every grid's card size is set with. */
function tableScaleBuild() {
  const box = document.createElement('div');
  box.className = 'table-scale';
  box.hidden = true;
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Card size on the table');
  const pct = n => Math.round(n * 100);
  box.innerHTML = `
    <button type="button" class="table-scale-step" data-scale-step="-1" title="Smaller cards" aria-label="Smaller cards">${TABLE_SCALE_LESS_ICON}</button>
    <input type="range" class="size-slider table-scale-range" aria-label="Card size"
           min="${pct(TABLE_CARD_SCALE_MIN)}" max="${pct(TABLE_CARD_SCALE_MAX)}" step="${pct(TABLE_CARD_SCALE_STEP)}">
    <button type="button" class="table-scale-step" data-scale-step="1" title="Larger cards" aria-label="Larger cards">${TABLE_SCALE_MORE_ICON}</button>
    <output class="table-scale-value" aria-hidden="true"></output>`;
  const input = box.querySelector('input');
  tableSlider = {
    box, input,
    value: box.querySelector('output'),
    less:  box.querySelector('[data-scale-step="-1"]'),
    more:  box.querySelector('[data-scale-step="1"]'),
  };
  /* A press on it is a press on a control: not a card or a zone picked up
     off the mat under it — and, until it is let go, the camera stays where
     it is (tableOnPointerMove). */
  box.addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (e.button === 0) tableScaleHeld = true;
  });
  input.addEventListener('input', () => tableSetCardScale(Number(input.value) / 100));
  for (const btn of [tableSlider.less, tableSlider.more]) {
    btn.addEventListener('click', () => tableSetCardScale(tableCardScale + Number(btn.dataset.scaleStep) * TABLE_CARD_SCALE_NUDGE));
  }
  tableFarStrip('left').append(box);
  tableScaleWrite(tableCardScale);
}

/* One of the far rim's two strips either side of the slip (table.css): the
 * left-hand one holds the slider and the Zones chips, the right-hand one the
 * drawer's chips, so that the chips lying on the rim share its length rather
 * than being laid over each other on a narrow window. Made the first time it
 * is asked for in a scene, lying on the wood at the slip's height. */
function tableFarStrip(side) {
  const { mat } = tableEls;
  let strip = mat.querySelector(`:scope > .table-far-${side}`);
  if (!strip) {
    strip = document.createElement('div');
    strip.className = `table-far-${side}`;
    strip.style.setProperty('--table-tools-z', `${tableToolsZ().toFixed(2)}px`);
    mat.append(strip);
  }
  return strip;
}

/* The pointer let go of anywhere — or the window losing it — and the camera
 * follows it again. */
function tableScaleLetGo() {
  tableScaleHeld = false;
}

/* The slider shown or not for the cards on the mat now — and, put away, it
 * lets go of the focus. Asked every time cards are drawn. */
function tableScaleSync() {
  const t = tableSlider;
  if (!t) return;
  t.box.hidden = !tableScaleShown(tableScope);
  if (t.box.hidden && t.box.contains(document.activeElement)) document.activeElement.blur();
}

/* The slider saying `scale`: the range, the readout, what a screen reader is
 * told, and − or + switched off at either end. */
function tableScaleWrite(scale) {
  const t = tableSlider;
  if (!t) return;
  const pct = Math.round(scale * 100);
  if (Number(t.input.value) !== pct) t.input.value = String(pct);
  t.input.setAttribute('aria-valuetext', `${pct}%`);
  t.value.textContent = `${pct}%`;
  t.less.disabled = scale <= TABLE_CARD_SCALE_MIN;
  t.more.disabled = scale >= TABLE_CARD_SCALE_MAX;
}

/* A new size from the slider: held in its range and on its step, said on
 * the slider, kept for the browser, and the cards resized to it on the next
 * frame — however many input events the frame brings, one resize. */
function tableSetCardScale(value) {
  const s = tableCardScaleClamp(value);
  tableScaleWrite(s);
  if (s === tableCardScale) return;
  tableCardScale = s;
  rememberTableCardScale(s);
  if (!tableOn || tableScaleFrameId) return;
  tableScaleFrameId = requestAnimationFrame(() => {
    tableScaleFrameId = 0;
    tableRescaleCards();
  });
}

/* The cards on the mat resized to the slider's scale where they lie: each
 * given the size and the place the layout gives it at that scale
 * (tableScaledPlaces) — where a hand put it, for a card one has — and its
 * element resized and moved, not made again; a card in hand is resized and
 * left where the hand has it. The zones keep their rects and fit their cards
 * to the new size; the pictures are asked to stay sharp for it; and the Card
 * tab's sheet draws itself short of its card's new lane. */
function tableRescaleCards() {
  if (!tableOn || !tableEls || !tableGeom) return;
  const { width, height } = tableGeom.mat;
  const { size, places } = tableScaledPlaces(tableCards, width, height, tableCardScale, tableMoved, tableFeature);
  tableCardSize = size;
  tableCards.forEach((card, i) => {
    if (tableHold?.card !== card) Object.assign(card, places[i]);
    tableSizeCard(card);
  });
  tableSharpen();
  /* With zones on, every card a zone holds is placed in it over the piles'
     place — as when the cards are laid. */
  tableZonesPlace();
  for (const card of tableCards) if (tableHold?.card !== card) tableWriteCard(card);
  if (tableHold) tableKick();
  tableSyncLane();
}

// ── The Deck Builder's drawer, on the table ──────────────────────────────
// The builder's drawer — Search, EDHREC and Lands, the three ways it has of
// finding a card for the deck — opened from the table by a chip each on the
// far rim, beside the Zones chip (TABLE_DRAWER_TABS, tableDrawerChipsShown).
//
// It is the drawer itself, not a copy and not the builder's whole page: the
// element #dbSearchPanel is lent to a panel of its own, docked to the left of
// the window (tableDrawerBox), the way a tab's pane is lent to the floating
// panel — its place in the page held by a comment, and put back there when
// it closes. Its tab is switched by the builder's own dbSetLeftTab, and its
// search field is put in hand for Search. Everything it does is still the
// builder's: its results, its + and where the + puts a card, the counts on
// its tiles, its own ✕. The builder's whole pane is not floated over the
// table for it, so there is no hunting for a drawer inside a page.
//
// A card added from it lands on the table beside it, in its pile or zone:
// the builder's pane is watched while the drawer is out (tableDrawerWatch),
// whether or not a panel is up to notice the deck redrawn. And the drawer
// stays as it was — open, its results and its scroll where they were, so the
// next card can be added from the same list — because nothing the table
// does when cards are laid touches it, and no panel tucks itself away for
// cards laid while it is out (tableShouldAutoTuck).
//
// The chip pressed again closes it, and another chip switches its tab. So do
// its own ✕ and Escape — bar an Escape pressed in a field of it with something
// typed in it, which is the field's (tableDrawerKeepsEscape). A page floating
// up over the table puts it away: it lies beside the table, not beside a
// page lying over it.

/* The drawer's chips on the far rim, made with each scene: one per entry of
 * TABLE_DRAWER_TABS, in the Zones chip's make, each saying by aria-expanded
 * whether its tab is the one the drawer is lying open at. A press on them is
 * a press on a control, not on the mat. */
function tableDrawerBuild() {
  const box = document.createElement('div');
  box.className = 'table-drawer-chips';
  box.dataset.tab = 'deckview';
  box.hidden = true;
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Find cards for this deck');
  box.innerHTML = TABLE_DRAWER_TABS.map(chip => `
    <button type="button" class="table-zone-chip table-drawer-chip" data-drawer-tab="${chip.tab}"
            aria-expanded="false" aria-controls="tableDrawer" hidden
            title="${esc(`The Deck Builder's ${chip.label}, beside the table`)}">${chip.icon}<span>${esc(chip.label)}</span></button>`).join('');
  const buttons = new Map([...box.querySelectorAll('[data-drawer-tab]')].map(btn => [btn.dataset.drawerTab, btn]));
  box.addEventListener('pointerdown', e => e.stopPropagation());
  for (const [tab, btn] of buttons) btn.addEventListener('click', () => tableDrawerToggle(tab));
  tableFarStrip('right').append(box);
  tableDrawerChips = { box, buttons };
}

/* The chips' rules for the cards on the mat and the deck open now. */
function tableDrawerShownNow() {
  const deck = typeof dbDeck !== 'undefined' ? dbDeck : null;
  return tableDrawerChipsShown({
    scope: tableScope,
    deckOpen: !!deck,
    canEdit: !!deck && typeof isMyPlayer === 'function' && isMyPlayer(deck.playerId),
  });
}

/* The chips shown and marked as the rules and the drawer say — asked every
 * time cards are drawn, and as the drawer opens, closes and switches tab.
 * The drawer itself is put away once its chips are gone: another tab's cards
 * on the mat, or the deck closed. */
function tableDrawerSyncChips() {
  const chips = tableDrawerChips;
  if (!chips) return;
  const shown = tableDrawerShownNow();
  chips.box.hidden = !Object.values(shown).some(Boolean);
  for (const [tab, btn] of chips.buttons) {
    btn.hidden = !shown[tab];
    btn.setAttribute('aria-expanded', String(tableDrawer?.tab === tab));
  }
  if (tableDrawer && chips.box.hidden) tableDrawerClose({ refocus: false });
}

/* A chip pressed: its tab's drawer opened, or switched to — or, for the tab
 * the drawer is already lying open at, the drawer put away. */
function tableDrawerToggle(tab) {
  if (tableDrawer?.tab === tab) tableDrawerClose();
  else tableDrawerOpen(tab);
}

/* The drawer lent to its panel, at `tab`. The first time, the drawer is
 * carried out of the builder's pane and opened by the builder's own
 * dbOpenSearchPanel — which redraws what it shows against the deck as it is
 * now, and says on the builder's strip that it is open — less the scrim it
 * hangs behind itself in the page, since here the table is to be seen
 * beside it. A page floating over the table is tucked to its header first,
 * so the table is in view. Then its tab: switched by the builder, and the
 * search field put in hand for Search; for the others, the panel itself, so
 * that Escape and the keyboard start in it. Returns whether it is open. */
function tableDrawerOpen(tab) {
  if (!tableOn || !tableEls) return false;
  const chip = TABLE_DRAWER_TABS.find(entry => entry.tab === tab);
  const el = document.getElementById('dbSearchPanel');
  if (!chip || !el || typeof dbSetLeftTab !== 'function' || !tableDrawerShownNow()[tab]) return false;
  if (tableLooked) tableLookAway(true);
  if (tablePanel?.kind === 'float' && !tableTucked) tableTuckPanel(true);
  const host = tableEls.drawerHost;
  if (!tableDrawer) {
    const mark = document.createComment(' #dbSearchPanel is lying on the table ');
    el.before(mark);
    host.append(el);
    tableDrawer = { tab, el, mark, watch: null, paneWatch: null };
    if (typeof dbOpenSearchPanel === 'function') dbOpenSearchPanel();
    else el.classList.add('open');
    document.getElementById('dbSearchBackdrop')?.classList.remove('open');
    tableDrawerWatch();
    host.classList.remove('is-open');
    host.hidden = false;
    tableDrawerFit();
    /* Read once so the closed state is drawn before the open one, as the
       floating panel is. */
    void host.offsetWidth;
    host.classList.add('is-open');
  }
  tableDrawer.tab = tab;
  if (typeof dbLeftTab === 'undefined' || dbLeftTab !== tab) dbSetLeftTab(tab);
  host.setAttribute('aria-label', `Deck Builder: ${chip.label}`);
  tableDrawerSyncChips();
  const field = tab === 'search' ? document.getElementById('dbSearchInput') : null;
  if (field && host.contains(field)) field.focus({ preventScroll: true });
  else host.focus({ preventScroll: true });
  return true;
}

/* The drawer put home, into the builder's pane where it came from, closed
 * the builder's own way (dbCloseSearchPanel) — unless it is the builder that
 * closed it, its ✕ or a way out of the tab, and it is closed already. The
 * focus, if it was in the drawer, goes back to the chip that opened it. */
function tableDrawerClose({ refocus = true } = {}) {
  const d = tableDrawer;
  if (!d) return;
  tableDrawer = null;
  d.watch?.disconnect();
  d.paneWatch?.disconnect();
  const host = tableEls?.drawerHost;
  const hadFocus = !!host && host.contains(document.activeElement);
  if (d.el.classList.contains('open')) {
    if (typeof dbCloseSearchPanel === 'function') dbCloseSearchPanel();
    else d.el.classList.remove('open');
  }
  if (d.mark.parentNode) {
    d.mark.parentNode.insertBefore(d.el, d.mark);
    d.mark.remove();
  }
  if (host) {
    host.hidden = true;
    host.classList.remove('is-open');
    host.removeAttribute('aria-label');
  }
  tableDrawerSyncChips();
  const chip = tableDrawerChips?.buttons.get(d.tab);
  if (hadFocus && refocus && chip && !chip.hidden) chip.focus({ preventScroll: true });
}

/* What the table keeps an eye on while the drawer is out: the drawer, for
 * the builder closing it (its ✕, the Lands tab's way out to the calculator)
 * and for its own tabs pressed inside it, which the chips follow; and the
 * builder's pane, for the deck redrawn by a card added from the drawer,
 * which lays the table again (tableQueueRelay). The drawer's own redraws
 * are not the pane's — it is out of the pane — so its results drawing
 * themselves again lays nothing. */
function tableDrawerWatch() {
  const d = tableDrawer;
  if (!d || typeof MutationObserver !== 'function') return;
  d.watch = new MutationObserver(() => {
    if (tableDrawer !== d) return;
    if (!d.el.classList.contains('open')) { tableDrawerClose(); return; }
    const now = typeof dbLeftTab !== 'undefined' ? dbLeftTab : d.tab;
    if (now !== d.tab) { d.tab = now; tableDrawerSyncChips(); }
  });
  d.watch.observe(d.el, { attributes: true, attributeFilter: ['class'], subtree: true });
  const pane = document.getElementById('tab-deckview');
  if (pane) {
    d.paneWatch = new MutationObserver(() => tableQueueRelay('deckview'));
    d.paneWatch.observe(pane, { childList: true, subtree: true, characterData: true });
  }
}

/* The drawer's panel fitted to the window (tableDrawerBox): clear of the
 * left edge's tabs, measured as for a floating panel; below the far rim, so
 * that what lies on it — the card-size slider, the slip, the Zones chips and
 * the drawer's own chips — stays in reach while cards are being added; and
 * above a tucked panel's bar at the window's foot, which it would otherwise
 * lie over. */
function tableDrawerFit() {
  if (!tableDrawer || !tableEls) return;
  const { drawerHost: host, panelHdr } = tableEls;
  const view = { width: window.innerWidth, height: window.innerHeight };
  const clear = tableRimClear(view);
  clear.top = clear.far;
  const tucked = tablePanel?.kind === 'float' && tableTucked;
  clear.bottom = tucked ? panelHdr.offsetHeight + TABLE_PANEL_GAP : 0;
  const box = tableDrawerBox(view, clear, TABLE_PANEL_GAP + TABLE_PAN_REST * view.width);
  host.style.left   = `${box.left.toFixed(1)}px`;
  host.style.top    = `${box.top.toFixed(1)}px`;
  host.style.width  = `${box.width.toFixed(1)}px`;
  host.style.height = `${box.height.toFixed(1)}px`;
}

/* Whether an Escape pressed with the focus on `target` is a field of the
 * drawer's own to answer rather than the table's: a field being typed in,
 * inside the drawer while it lies over the table, with something typed in
 * it — the search box with a query in it. Its suggestions, open, close on
 * that Escape; closed, nothing happens to it, and the drawer stays up. An
 * empty field, or the focus anywhere else in the drawer, and Escape puts the
 * drawer away. */
function tableDrawerKeepsEscape(target) {
  if (!tableDrawer || !target || !tableEls?.drawerHost.contains(target)) return false;
  return tableIsTyping(target) && String(target.value ?? target.textContent ?? '').trim() !== '';
}

// ── The Deck Builder's zones ─────────────────────────────────────────────
// A second way of laying the deck, chosen by the "Zones" chip on the far rim
// beside the slip and kept per browser (TABLE_ZONES_KEY): every category of
// the deck is a zone, a rectangle lying on the felt with its name and count
// on a chip at its top-left corner and a grip at its bottom-right, and the
// zone lays its own cards out to fit inside it (tableZoneFit). With the chip
// off, nothing here runs and the mat is laid in its piles exactly as before;
// where a hand put a card in the piles is kept for them, since nothing here
// writes to it.
//
//   a zone       a category the deck's mainboard has cards in, or one that
//                was given a zone here (+ Zone, a rename) and so has a place
//                kept for it however empty it is — not every category the
//                deck has ever had, which would be nine default ones lying
//                empty on a deck that never used them (tableZoneNames). The
//                commander keeps its spot at the head of the mat and is no
//                zone.
//   moving one   the label, pressed and dragged: the zone rises a little with
//                all its cards and follows the pointer through the same
//                screen-to-mat mapping a card in hand does, and settles where
//                it is let go. The last one moved, or resized, lies on top.
//   resizing     the grip: the zone's cards are fitted again every frame,
//                which only rewrites their transforms — the cheap path.
//   a card       carried and let go over another zone moves into that
//                category through the builder's own drop (cardCarryDrop, the
//                same call a card carried between piles in the builder makes,
//                so the save and the history are the builder's); let go over
//                its own zone, or over no zone, it goes back to its place in
//                its zone, and its landing mark says so. Over another zone
//                there is no mark, since where the card lands in it is the
//                builder's sort to decide: the zone lights instead.
//   + Zone       a new category, by the builder's own add and its own unique
//                placeholder name, with an empty zone in free space.
//   renaming     a double-click on the label (or Enter, or F2, on it focused)
//                opens a field on it; Enter, or clicking away, renames through
//                the builder's own rename, and Escape leaves the name be.
//
// Somebody else's deck can be laid in zones, to be looked at that way, and
// not changed: no zone moves, grows, is renamed or is added, and no card goes
// from one to another (tableZoneRules).
//
// Where each zone lies is kept per deck in the browser (TABLE_ZONE_RECTS_KEY
// and the deck's id), as fractions of the mat, so a window of another size
// lays them in proportion. The first time a deck is laid in zones they are
// laid out for it in a tidy grid below the commander (tableZoneAutoLayout); a
// category that turns up later is given a zone in free space, and one the
// deck no longer has loses its zone.
//
// Depth: the zones and their cards share the TABLE_DEPTH of height the piles
// have (tableCardGapFor), each zone a run of it — its felt, its
// cards, and its chip and grip above them — so the landing mark, the slip,
// the bin and the rim's tabs keep lying above all of it as they do above the
// piles, and a zone on top of another is drawn over that one's cards too.

/* The browser's copy of the Zones chip: '1' when on, nothing when off. And
 * the prefix of each deck's kept layout: the deck's id follows it. */
const TABLE_ZONES_KEY      = 'mtgtools_table_zones';
const TABLE_ZONE_RECTS_KEY = 'mtgtools_table_zones:';

/* A zone's insides, in the mat's own pixels: the padding round its cards,
 * the band across its top that its label lies in (TABLE_ZONE_HEAD, the
 * label TABLE_ZONE_LABEL_H tall in the middle of it), the gap between two
 * zones the layout leaves, and the gap between two cards of a zone that has
 * room to lay them apart. table.css is handed the three it draws with. */
const TABLE_ZONE_PAD      = 8;
const TABLE_ZONE_HEAD     = 32;
const TABLE_ZONE_LABEL_H  = 22;
const TABLE_ZONE_GAP      = 12;
const TABLE_ZONE_CARD_GAP = 6;

/* How far a zone's cards may close up on each other before they are piled
 * instead: across, to a third of a card showing (TABLE_FAN_MIN, the fans'
 * own floor), and down, to the band along a card's top its name is printed
 * in — about TABLE_ZONE_TITLE of its height. Piled, each card lies
 * TABLE_ZONE_PILE_STEP pixels right of and below the one under it. */
const TABLE_ZONE_TITLE     = 0.16;
const TABLE_ZONE_PILE_STEP = 2;

/* How high a zone comes up off the felt while it is carried, in the mat's
 * pixels — a quarter of a card's lift: a whole region of the table is being
 * slid, not a card picked up — and the step the search for free space for a
 * new zone moves by. */
const TABLE_ZONE_LIFT = 24;
const TABLE_ZONE_SCAN = 8;

/* The two chips' icons, in the sidebar's own hand: four tiles for the zones,
 * and a plus for a new one. The grip's mark is three dots on the diagonal of
 * the zone's corner. */
const TABLE_ZONES_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1"/>' +
  '<rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/>' +
  '<rect x="13" y="13" width="8" height="8" rx="1"/></svg>';
const TABLE_ZONE_ADD_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/>' +
  '<line x1="5" y1="12" x2="19" y2="12"/></svg>';
const TABLE_ZONE_GRIP_ICON =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="10" cy="4" r="1.2"/><circle cx="7" cy="7" r="1.2"/>' +
  '<circle cx="4" cy="10" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="7" cy="10" r="1.2"/>' +
  '<circle cx="10" cy="10" r="1.2"/></svg>';

// ── The zones' decisions ──

/* What the zones may do, for the cards on the mat now: the chip is offered
 * while the Deck Builder's cards lie there with a deck open; the zones are
 * laid while it is on; and they may be changed — moved, resized, renamed,
 * added to, and cards moved between them — only for a deck the user may
 * edit. */
function tableZoneRules({ scope, deckOpen, canEdit, on }) {
  const toggle = scope === 'deckview' && !!deckOpen;
  const zones  = toggle && !!on;
  const edit   = zones && !!canEdit;
  return { toggle, zones, arrange: edit, rename: edit, add: edit, move: edit };
}

/* Which categories are zones, in the deck's own order of them: `cats` the
 * deck's categories ([{ name }] or names), `counts` how many cards each has
 * in the mainboard (a Map, or an object), `kept` the names a zone is kept for
 * (an array or a Set). A category with cards, or a kept zone the deck still
 * has; never one the deck no longer has. */
function tableZoneNames(cats, counts, kept) {
  const count = name => Number(counts instanceof Map ? counts.get(name) : counts?.[name]) || 0;
  const keep = kept instanceof Set ? kept : new Set(kept || []);
  const names = (cats || []).map(cat => (typeof cat === 'string' ? cat : cat?.name)).filter(Boolean).map(String);
  return [...new Set(names)].filter(name => count(name) > 0 || keep.has(name));
}

/* The smallest a zone may be, for cards w × h: one card and its padding,
 * with the label's band over it. */
function tableZoneMinSize(cardW, cardH) {
  return { width: (Number(cardW) || 0) + 2 * TABLE_ZONE_PAD, height: TABLE_ZONE_HEAD + (Number(cardH) || 0) + TABLE_ZONE_PAD };
}

/* Where `count` cards w × h lie in a zone zoneW × zoneH: their centres, in
 * the zone's own pixels from its top-left corner, in the builder's order —
 * the first at the top left, reading across and then down, each later card
 * lying over the one before. Inside the zone's padding and below its label's
 * band, three ways, the first that fits:
 *
 *   grid     full cards, a TABLE_ZONE_CARD_GAP apart, as many across as the
 *            zone takes — when the rows they need fit down it;
 *   overlap  the same, closed up: across to a third of a card showing and
 *            down to its name's band. Of the ways to lay them in columns and
 *            rows that close up no further than that, the one that shows the
 *            most of each card — the top-left corner the cards over it leave
 *            uncovered — and the fewest rows of those;
 *   stack    cards share spots, in piles of as few as will do: each pile a
 *            box a card and TABLE_ZONE_PILE_STEP pixels a card larger, laid
 *            out as in an overlap, the cards spread evenly over the piles in
 *            order, each TABLE_ZONE_PILE_STEP right of and below the one
 *            under it.
 *
 * And when not even one pile of all of them fits — a zone at its smallest
 * size — one pile whose step closes up to whatever the padding leaves.
 * `mode` says which; `visible` is how much of each card shows, 0…1, which is
 * what the layout of a whole deck weighs (tableZoneAutoLayout). A zone no
 * larger than a card, which its smallest size never is, lays every card at
 * its corner. */
function tableZoneFit(count, zoneW, zoneH, cardW, cardH, {
  pad = TABLE_ZONE_PAD, head = TABLE_ZONE_HEAD, gap = TABLE_ZONE_CARD_GAP,
} = {}) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const w = Math.max(0, Number(cardW) || 0), h = Math.max(0, Number(cardH) || 0);
  const A = Math.max(0, (Number(zoneW) || 0) - 2 * pad);
  const B = Math.max(0, (Number(zoneH) || 0) - head - pad);
  if (!n || !(w > 0) || !(h > 0)) return { mode: 'grid', visible: 1, spots: Array.from({ length: n }, () => ({ x: pad, y: head })) };

  /* m boxes bw × bh in columns and rows: the best of c columns, 1 to m. A
     column step under a third of a box is never needed — more columns only
     close it further — so the search stops there. */
  const arrange = (m, bw, bh) => {
    if (A + 1e-9 < bw || B + 1e-9 < bh) return null;
    let best = null;
    for (let c = 1; c <= m; c++) {
      const r = Math.ceil(m / c);
      const sx = c > 1 ? Math.min(bw + gap, (A - bw) / (c - 1)) : 0;
      if (c > 1 && sx < bw * TABLE_FAN_MIN - 1e-9) break;
      const sy = r > 1 ? Math.min(bh + gap, (B - bh) / (r - 1)) : 0;
      if (r > 1 && sy < bh * TABLE_ZONE_TITLE - 1e-9) continue;
      const vis = (c > 1 ? Math.min(sx, bw) : bw) * (r > 1 ? Math.min(sy, bh) : bh) / (bw * bh);
      if (!best || vis > best.vis + 1e-9 || (Math.abs(vis - best.vis) <= 1e-9 && r < best.r)) best = { c, r, sx, sy, vis };
    }
    return best;
  };
  /* Box k's centre, of boxes bw × bh arranged as `fit`. */
  const at = (fit, bw, bh, k) => ({
    x: pad + bw / 2 + (k % fit.c) * fit.sx,
    y: head + bh / 2 + Math.floor(k / fit.c) * fit.sy,
  });

  const flat = arrange(n, w, h);
  if (flat) {
    const grid = (flat.c === 1 || flat.sx >= w) && (flat.r === 1 || flat.sy >= h);
    return { mode: grid ? 'grid' : 'overlap', visible: flat.vis, spots: Array.from({ length: n }, (_, k) => at(flat, w, h, k)) };
  }

  /* n cards over `piles` piles, as evenly as they go and in order, a pile's
     cards stepping `step` from its box's top-left corner. */
  const pile = (piles, spotOf, step) => {
    const spots = [];
    const base = Math.floor(n / piles), extra = n % piles;
    for (let i = 0; i < piles; i++) {
      const spot = spotOf(i);
      for (let j = 0; j < base + (i < extra ? 1 : 0); j++) spots.push({ x: spot.x + j * step, y: spot.y + j * step });
    }
    return spots;
  };
  for (let depth = 2; depth <= n; depth++) {
    const piles = Math.ceil(n / depth);
    const reach = TABLE_ZONE_PILE_STEP * (depth - 1);
    const fit = arrange(piles, w + reach, h + reach);
    if (!fit) continue;
    return {
      mode: 'stack', visible: fit.vis / depth,
      spots: pile(piles, i => {
        const box = at(fit, w + reach, h + reach, i);
        return { x: box.x - reach / 2, y: box.y - reach / 2 };
      }, TABLE_ZONE_PILE_STEP),
    };
  }
  /* One pile, its step closed up into the padding to its right and below —
     still inside the zone. */
  const room = Math.min(A + pad - w, B + pad - h);
  const step = n > 1 ? Math.max(0, Math.min(TABLE_ZONE_PILE_STEP, room / (n - 1))) : 0;
  return { mode: 'stack', visible: 1 / n, spots: pile(1, () => ({ x: pad + w / 2, y: head + h / 2 }), step) };
}

/* A zone a new category is given: wide enough for a few of its cards side by
 * side — three, or as many as it has, at least one — on a mat `width` wide,
 * and a row of cards tall. */
function tableZoneDefaultSize(count, cardW, cardH, width = Infinity) {
  const min = tableZoneMinSize(cardW, cardH);
  const cols = Math.min(3, Math.max(1, Math.floor(Number(count) || 0)));
  const w = 2 * TABLE_ZONE_PAD + cols * cardW + (cols - 1) * TABLE_ZONE_CARD_GAP;
  return { width: Math.max(min.width, Math.min(w, Number(width) - 2 * TABLE_ZONE_GAP)), height: min.height };
}

/* Whether two rects overlap, `gap` apart counting as touching. */
function tableZoneOverlap(a, b, gap = 0) {
  return a.left < b.left + b.width + gap && b.left < a.left + a.width + gap
      && a.top < b.top + b.height + gap && b.top < a.top + a.height + gap;
}

/* Where a zone `size` = { width, height } goes on a mat of the given size,
 * among the zones there already (`rects`) and round the commander's box
 * (`keepOut`, tableZoneHeadRect, or null): the first place, reading across
 * and down from the mat's far corner, that is clear of every one of them by
 * a TABLE_ZONE_GAP — and with no such place, the one overlapping them the
 * least. Returns its top-left corner, { left, top }. */
function tableZoneFree(rects, size, width, height, keepOut = null) {
  const W = Number(width) || 0, H = Number(height) || 0;
  const w = Math.min(size.width, W), h = Math.min(size.height, H);
  const top0 = Math.min(Math.max(0, H - h), TABLE_ZONE_GAP);
  const xMax = Math.max(0, W - w - TABLE_ZONE_GAP), yMax = Math.max(0, H - h - TABLE_ZONE_GAP);
  const others = [...(rects || []), ...(keepOut ? [keepOut] : [])];
  let best = null;
  for (let y = top0; y <= Math.max(top0, yMax) + 1e-9; y += TABLE_ZONE_SCAN) {
    for (let x = Math.min(TABLE_ZONE_GAP, xMax); x <= xMax + 1e-9; x += TABLE_ZONE_SCAN) {
      const at = { left: x, top: y, width: w, height: h };
      let cover = 0;
      for (const r of others) {
        if (!tableZoneOverlap(at, r, TABLE_ZONE_GAP)) continue;
        cover += Math.max(1, (Math.min(x + w, r.left + r.width) - Math.max(x, r.left))
                           * (Math.min(y + h, r.top + r.height) - Math.max(y, r.top)));
      }
      if (!cover) return { left: x, top: y };
      if (!best || cover < best.cover) best = { left: x, top: y, cover };
    }
  }
  return best ? { left: best.left, top: best.top } : { left: 0, top: top0 };
}

/* The box the commander lies in — or both of a pair, side by side — on a mat
 * of the given size for cards w × h in the piles: what no zone is laid over
 * the first time, nor a new zone put on. Null with no commander. */
function tableZoneHeadRect(count, width, height, cardW, cardH) {
  const head = tableHeadSpots(count, width, height, cardW, cardH);
  if (!head.spots.length) return null;
  const W = cardW * TABLE_HEAD_SCALE, H = cardH * TABLE_HEAD_SCALE;
  const xs = head.spots.map(s => s.x * width), ys = head.spots.map(s => s.y * height);
  const left = Math.min(...xs) - W / 2, top = Math.min(...ys) - H / 2;
  return { left, top, width: Math.max(...xs) + W / 2 - left, height: Math.max(...ys) + H / 2 - top };
}

/* A deck's zones laid out for the first time, on a mat of the given size for
 * cards w × h: `zones` = [{ name, count }], in the deck's order, round the
 * commander's box (`keepOut`, tableZoneHeadRect, or null).
 *
 * In rows of one height, a TABLE_ZONE_GAP apart and from the mat's edges;
 * a row level with the commander is two runs, one each side of it. The
 * categories are shared out over the rows in order — no row given more
 * zones than fit across it at their smallest — so that the cards to a pixel
 * of width are as even as they can be from row to row, and in each run a
 * zone is as wide as its share of the run's cards: sized in proportion to
 * them. Of the numbers of rows that fit, the one whose zones show the most
 * of their cards (tableZoneFit, weighed by how many cards that is) — and of
 * those, the one whose zones are nearest square. More zones than fit at
 * their smallest are laid below the commander in rows that overlap, still
 * on the mat. Returns [{ name, left, top, width, height }] in the order
 * asked, in pixels. */
function tableZoneAutoLayout(zones, width, height, cardW, cardH, keepOut = null) {
  const list = zones || [];
  const W = Number(width) || 0, H = Number(height) || 0;
  const n = list.length;
  if (!n || !(W > 0) || !(H > 0)) return [];
  const gap = TABLE_ZONE_GAP;
  const min = tableZoneMinSize(cardW, cardH);
  const weight = list.map(z => Math.max(1, Number(z.count) || 0));
  const fits = len => Math.max(0, Math.floor((len + gap + 1e-9) / (min.width + gap)));
  const AH = H - 2 * gap;
  let best = null;

  for (let R = 1; R <= n; R++) {
    const rowH = (AH - (R - 1) * gap) / R;
    if (rowH + 1e-9 < min.height) break;
    /* Each row's runs: the whole width, or the two sides of the commander. */
    const rows = Array.from({ length: R }, (_, r) => {
      const top = gap + r * (rowH + gap);
      const level = keepOut && top < keepOut.top + keepOut.height + gap && keepOut.top < top + rowH + gap;
      const runs = level
        ? [[gap, keepOut.left - gap], [keepOut.left + keepOut.width + gap, W - gap]]
        : [[gap, W - gap]];
      const spans = runs.map(([a, b]) => ({ left: a, width: Math.max(0, b - a) }));
      return { top, spans, cap: spans.reduce((s, sp) => s + fits(sp.width), 0), room: spans.reduce((s, sp) => s + sp.width, 0) };
    });
    if (rows.reduce((s, row) => s + row.cap, 0) < n) continue;

    /* The categories over the rows, in order: the cut that keeps the most
       cards to a pixel of any row lowest, each row within its capacity. */
    const prefix = [0];
    weight.forEach((wt, i) => prefix.push(prefix[i] + wt));
    const cost = Array.from({ length: R + 1 }, () => new Array(n + 1).fill(Infinity));
    const from = Array.from({ length: R + 1 }, () => new Array(n + 1).fill(-1));
    cost[0][0] = 0;
    for (let r = 1; r <= R; r++) {
      const row = rows[r - 1];
      for (let j = 0; j <= n; j++) {
        for (let i = Math.max(0, j - row.cap); i <= j; i++) {
          if (cost[r - 1][i] === Infinity) continue;
          const load = j > i ? (prefix[j] - prefix[i]) / Math.max(1, row.room) : 0;
          const c = Math.max(cost[r - 1][i], load);
          if (c < cost[r][j] - 1e-12) { cost[r][j] = c; from[r][j] = i; }
        }
      }
    }
    if (cost[R][n] === Infinity) continue;
    const cuts = [n];
    for (let r = R; r > 0; r--) cuts.unshift(from[r][cuts[0]]);

    const rects = new Array(n);
    let ok = true;
    rows.forEach((row, r) => {
      const idx = [];
      for (let i = cuts[r]; i < cuts[r + 1]; i++) idx.push(i);
      /* A row in two runs: its zones split between them where the cards to
         a pixel come out most even, in order, each run within its fit. */
      let parts = [idx];
      if (row.spans.length === 2) {
        let pick = null;
        for (let k = 0; k <= idx.length; k++) {
          const a = idx.slice(0, k), b = idx.slice(k);
          if (a.length > fits(row.spans[0].width) || b.length > fits(row.spans[1].width)) continue;
          const wa = a.reduce((s, i) => s + weight[i], 0), wb = b.reduce((s, i) => s + weight[i], 0);
          const skew = Math.abs(wa / Math.max(1, row.spans[0].width) - wb / Math.max(1, row.spans[1].width));
          if (!pick || skew < pick.skew - 1e-12) pick = { skew, parts: [a, b] };
        }
        if (!pick) { ok = false; return; }
        parts = pick.parts;
      }
      parts.forEach((part, s) => {
        const span = row.spans[s];
        const partWeight = part.reduce((sum, i) => sum + weight[i], 0);
        const spare = span.width - part.length * min.width - (part.length - 1) * gap;
        let x = span.left;
        for (const i of part) {
          const zw = min.width + Math.max(0, spare) * weight[i] / Math.max(1, partWeight);
          rects[i] = { name: list[i].name, left: x, top: row.top, width: zw, height: rowH };
          x += zw + gap;
        }
      });
    });
    if (!ok) continue;

    let score = 0, square = 0;
    rects.forEach((rect, i) => {
      score  += weight[i] * tableZoneFit(list[i].count, rect.width, rect.height, cardW, cardH).visible;
      square += Math.min(rect.width / rect.height, rect.height / rect.width);
    });
    if (!best || score > best.score + 1e-6 || (Math.abs(score - best.score) <= 1e-6 && square > best.square)) {
      best = { rects, score, square };
    }
  }
  if (best) return best.rects;

  /* Too many for the mat at their smallest: below the commander, as many
     across as fit, and the rows stepped down the room there is,
     overlapping, each kept on the mat. */
  const top0 = keepOut ? keepOut.top + keepOut.height + gap : gap;
  const cols = Math.max(1, fits(W - 2 * gap));
  const rowsN = Math.ceil(n / cols);
  const room = Math.max(0, H - gap - top0 - min.height);
  const stepY = rowsN > 1 ? Math.min(min.height + gap, room / (rowsN - 1)) : 0;
  return list.map((z, i) => ({
    name: z.name,
    left: Math.max(0, Math.min(W - min.width, gap + (i % cols) * (min.width + gap))),
    top:  Math.max(0, Math.min(H - min.height, top0 + Math.floor(i / cols) * stepY)),
    width: Math.min(W, min.width), height: Math.min(H, min.height),
  }));
}

/* Rects in a mat's pixels as fractions of it, for keeping — and back, on a
 * mat of any size: each kept at least `min` = { width, height } (a smaller
 * window lays larger cards than fit a zone sized for a larger one's), no
 * larger than the mat, and inside it. Anything unreadable in what was kept
 * is dropped rather than laid. */
function tableZoneNormalise(rects, width, height) {
  const W = Number(width) || 1, H = Number(height) || 1;
  return (rects || []).map(r => ({ name: String(r.name), x: r.left / W, y: r.top / H, w: r.width / W, h: r.height / H }));
}

function tableZoneDenormalise(list, width, height, min = { width: 0, height: 0 }) {
  const W = Number(width) || 0, H = Number(height) || 0;
  const ok = n => Number.isFinite(n) && n >= 0;
  return (Array.isArray(list) ? list : [])
    .filter(z => z && typeof z.name === 'string' && z.name && ok(z.x) && ok(z.y) && ok(z.w) && ok(z.h))
    .map(z => {
      const w = Math.min(W, Math.max(min.width, z.w * W));
      const h = Math.min(H, Math.max(min.height, z.h * H));
      return {
        name: z.name, width: w, height: h,
        left: Math.max(0, Math.min(W - w, z.x * W)),
        top:  Math.max(0, Math.min(H - h, z.y * H)),
      };
    });
}

/* The zones of a deck, in pixels on a mat of the given size, from what was
 * kept for it (`kept`, normalised, in the order they are drawn, or null for a
 * deck never laid in zones) and the zones it should have now (`zones` =
 * [{ name, count }]): never kept, laid out afresh; kept, each zone the deck
 * still has where it was, in its order, and a zone new since then in free
 * space after them. `changed` says whether that is other than what was kept,
 * which is when it is kept again. */
function tableZoneReconcile(kept, zones, width, height, cardW, cardH, keepOut = null, min = tableZoneMinSize(cardW, cardH)) {
  const list = zones || [];
  if (!Array.isArray(kept)) {
    return { rects: tableZoneAutoLayout(list, width, height, cardW, cardH, keepOut), changed: list.length > 0 };
  }
  const wanted = new Set(list.map(z => z.name));
  const rects = tableZoneDenormalise(kept, width, height, min).filter(r => wanted.has(r.name));
  const have = new Set(rects.map(r => r.name));
  let changed = rects.length !== kept.length;
  for (const z of list) {
    if (have.has(z.name)) continue;
    const size = tableZoneDefaultSize(z.count, cardW, cardH, width);
    rects.push({ name: z.name, ...tableZoneFree(rects, size, width, height, keepOut), ...size });
    have.add(z.name);
    changed = true;
  }
  return { rects, changed };
}

/* The smallest a kept zone is held to on a mat `width` wide, for cards
 * cardW × cardH: tableZoneMinSize's, for the smaller of those cards and the
 * cards the table lays there at the slider's 1 (tableCardWidth). So the
 * card-size slider never changes a zone's rect — grown past 1, a zone sized
 * for the table's own cards keeps its size and its cards close up or pile
 * in it — while a window made smaller, which lays larger cards for the
 * same zones, still grows a zone to hold one, as it always has. At 1 the two
 * are the same cards. */
function tableZoneMinFor(width, cardW, cardH) {
  const base = tableCardWidth(width);
  if (!((Number(cardW) || 0) > base)) return tableZoneMinSize(cardW, cardH);
  return tableZoneMinSize(base, base * TABLE_CARD_RATIO);
}

/* Which zone a point of the mat — the pointer, mapped onto it — is over: the
 * index of the topmost zone holding it, the last drawn, or -1 for none. */
function tableZoneAt(point, rects) {
  if (!point) return -1;
  for (let i = (rects || []).length - 1; i >= 0; i--) if (tableInMatRect(point, rects[i])) return i;
  return -1;
}

// ── The zones on the table ──

let tableZones       = [];     // [{ name, count, left, top, width, height, z0, topZ, mode, cards, el, label, … }], drawn in order
let tableZoneMemo    = null;   // { deckId, list }: the deck's kept layout, normalised, as last read or written
let tableZoneHold    = null;   // a zone being moved or resized by its label or grip
let tableZoneTarget  = null;   // the zone lit under the card in hand
let tableZoneEdit    = null;   // { name, input }: the zone being renamed
let tableZoneChips   = null;   // { box, toggle, add }: the chips on the far rim, made with each scene
let tableZoneLanding = null;   // { key, x, y, until }: a card just let go into another zone, on its way

function readTableZones() {
  try { return localStorage.getItem(TABLE_ZONES_KEY) === '1'; }
  catch { return false; }
}

function rememberTableZones(on) {
  try {
    if (on) localStorage.setItem(TABLE_ZONES_KEY, '1');
    else    localStorage.removeItem(TABLE_ZONES_KEY);
  } catch {}
}

/* A deck's kept layout — normalised, as tableZoneDenormalise reads it — or
 * null for one never laid in zones. Kept in memory too, so storage that
 * cannot be written still keeps the session's layout. */
function tableZoneKept(deckId) {
  if (tableZoneMemo?.deckId === deckId) return tableZoneMemo.list;
  let list = null;
  try {
    const raw = JSON.parse(localStorage.getItem(TABLE_ZONE_RECTS_KEY + deckId) || 'null');
    if (Array.isArray(raw?.zones)) list = raw.zones;
  } catch { list = null; }
  tableZoneMemo = { deckId, list };
  return list;
}

function tableZoneKeep(deckId, rects) {
  if (!deckId || !tableGeom) return;
  const list = tableZoneNormalise(rects, tableGeom.mat.width, tableGeom.mat.height);
  tableZoneMemo = { deckId, list };
  try { localStorage.setItem(TABLE_ZONE_RECTS_KEY + deckId, JSON.stringify({ zones: list })); } catch {}
}

function tableZoneDeck() {
  return typeof dbDeck !== 'undefined' ? dbDeck : null;
}

/* The rules as they stand for the cards on the mat and the deck open now. */
function tableZoneRulesNow() {
  const deck = tableZoneDeck();
  return tableZoneRules({
    scope: tableScope,
    deckOpen: !!deck && !tableFeature,
    canEdit: !!deck && typeof isMyPlayer === 'function' && isMyPlayer(deck.playerId),
    on: readTableZones(),
  });
}

function tableZonesActive() {
  return tableOn && !!tableGeom && tableZoneRulesNow().zones;
}

/* How many cards each category has in the deck's mainboard — the count the
 * builder's own pile headings give, whatever the filter is showing. */
function tableZoneCounts() {
  const counts = new Map();
  const main = typeof dbMainCards === 'function' ? dbMainCards() : [];
  for (const card of main) {
    const cat = card.category || (typeof dbAutoCategory === 'function' ? dbAutoCategory(card.card_name) : '');
    if (cat) counts.set(cat, (counts.get(cat) || 0) + (card.qty || 1));
  }
  return counts;
}

/* The commander's box on the mat now (tableZoneHeadRect), which the zones
 * are laid round the first time and a new zone is kept off; null with no
 * commander lying there. */
function tableZoneKeepOut() {
  const heads = tableCards.filter(card => card.head).length;
  if (!heads || !tableGeom) return null;
  const { width, height } = tableGeom.mat;
  return tableZoneHeadRect(heads, width, height, tableCardSize.w, tableCardSize.h);
}

/* The chips on the far rim, beside the slip, made with each scene: Zones,
 * which says whether it is on by aria-pressed and its tab's accent, and
 * + Zone. Their own listeners go with them. A press on either is a press on
 * a control, not on the mat under it. And the zones' own listeners on the
 * mat: a label or a grip pressed, a label double-clicked or keyed. */
function tableZonesBuild() {
  const { scene, mat } = tableEls;
  scene.style.setProperty('--table-zone-pad', `${TABLE_ZONE_PAD}px`);
  scene.style.setProperty('--table-zone-head', `${TABLE_ZONE_HEAD}px`);
  scene.style.setProperty('--table-zone-label-h', `${TABLE_ZONE_LABEL_H}px`);
  const box = document.createElement('div');
  box.className = 'table-zone-chips';
  box.dataset.tab = 'deckview';
  box.hidden = true;
  box.innerHTML = `
    <button type="button" class="table-zone-chip" data-zone-toggle aria-pressed="false"
            title="Lay each category of the deck in a zone of its own">${TABLE_ZONES_ICON}<span>Zones</span></button>
    <button type="button" class="table-zone-chip" data-zone-add hidden
            title="A new category, in a zone of its own">${TABLE_ZONE_ADD_ICON}<span>Zone</span></button>`;
  const toggle = box.querySelector('[data-zone-toggle]');
  const add = box.querySelector('[data-zone-add]');
  box.addEventListener('pointerdown', e => e.stopPropagation());
  toggle.addEventListener('click', () => tableZonesToggle());
  add.addEventListener('click', () => tableZoneAdd());
  /* At the slip's end of the far rim's left-hand strip, beside the
     card-size slider (tableFarStrip). */
  tableFarStrip('left').append(box);
  mat.addEventListener('pointerdown', tableOnZoneDown);
  mat.addEventListener('dblclick', tableOnZoneDblClick);
  mat.addEventListener('keydown', tableOnZoneKey);
  tableZoneChips = { box, toggle, add };
}

/* The chips shown, pressed and offered as the rules say — asked every time
 * cards are drawn. They lie on the wood at the slip's height, as the strip
 * they are in does (tableFarStrip). */
function tableZonesSyncChips(rules) {
  const chips = tableZoneChips;
  if (!chips) return;
  chips.box.hidden = !rules.toggle;
  chips.toggle.setAttribute('aria-pressed', String(rules.zones));
  chips.add.hidden = !rules.add;
}

/* Zones on, or off: the deck laid again in the other way. A rename in
 * progress is dropped and a zone in hand put down first. */
function tableZonesToggle() {
  tableZoneEndEdit(false, { refocus: false });
  tableZoneHold = null;
  rememberTableZones(!readTableZones());
  tableDrawCards();
}

/* The zones laid, for the cards about to be drawn: asked by tableDrawCards
 * once every card has its place in the piles and an element, before any is
 * written. With zones on, each zone is placed — as kept, or laid out afresh —
 * and every card the zones hold is given its place in its zone and its
 * height in the zones' depth (card.zoneZ, which tableCardZ answers with); the
 * commander, which is no zone's, keeps its place at the head of the mat, and
 * is given a height over the zones. With zones off there are none, and every
 * card keeps the place the piles gave it. Returns whether zones are laid. */
function tableZonesPlace() {
  const rules = tableZoneRulesNow();
  tableZonesSyncChips(rules);
  tableZoneLight(null);
  if (!rules.zones || !tableGeom || !tableEls) { tableZonesClear(); return false; }
  const deck = tableZoneDeck();
  const { width, height } = tableGeom.mat;
  const { w, h } = tableCardSize;
  /* Laid again with a zone in hand — the deck redrawn under it — the zones
     are kept where they are first, the one in hand where the hand has it,
     and the hand is given the zone of that name as it is laid now. */
  const held = tableZoneHold?.zone?.name;
  if (held != null && tableZones.length) tableZoneKeep(deck.id, tableZones);
  const counts = tableZoneCounts();
  const kept = tableZoneKept(deck.id);
  const cats = typeof dbCats !== 'undefined' ? dbCats : [];
  const names = tableZoneNames(cats, counts, (kept || []).map(z => z.name));
  /* Sized for the cards each will hold on the mat — one an entry —
     rather than for the deck's copies of them, which its label says. */
  const laid = new Map();
  for (const card of tableCards) if (!card.head) laid.set(String(card.group), (laid.get(String(card.group)) || 0) + 1);
  const { rects, changed } = tableZoneReconcile(kept, names.map(name => ({ name, count: laid.get(name) || 0 })),
    width, height, w, h, tableZoneKeepOut(), tableZoneMinFor(width, w, h));
  if (changed) tableZoneKeep(deck.id, rects);

  const before = new Map(tableZones.map(zone => [zone.name, zone]));
  tableZones = rects.map(rect => ({ ...(before.get(rect.name) || {}), ...rect, count: counts.get(rect.name) || 0, cards: [] }));
  const byName = new Map(tableZones.map(zone => [zone.name, zone]));
  for (const [name, zone] of before) if (!byName.has(name)) zone.el?.remove();
  for (const card of tableCards) {
    delete card.zoneSpot;
    if (!card.head) byName.get(String(card.group))?.cards.push(card);
  }
  tableZonesLayer();
  for (const zone of tableZones) {
    tableZoneFitCards(zone);
    tableZoneDraw(zone, 0, rules);
  }
  if (held != null) {
    const zone = byName.get(held);
    if (zone) tableZoneHold.zone = zone;
    else tableZoneHold = null;
  }
  return true;
}

/* No zones: their elements gone, and the cards' heights in them forgotten,
 * so each card lies at the height its rank gives it in the piles. */
function tableZonesClear() {
  tableZoneEndEdit(false, { refocus: false });
  tableZoneHold = null;
  for (const zone of tableZones) zone.el?.remove();
  tableZones = [];
  for (const card of tableCards) { delete card.zoneZ; delete card.zoneSpot; }
}

/* The zones' depth, shared out in order: for each zone a layer for its
 * felt, one for each of its cards and one for its label and grip; then one
 * for each card no zone holds — the commander — over all of them. The
 * first layer is a gap above the mat, never on it. However many zones and
 * cards there are, they fit in TABLE_DEPTH (tableCardGapFor), under the
 * landing mark and the rim. */
function tableZonesLayer() {
  const zoned = new Set(tableZones.flatMap(zone => zone.cards));
  const loose = tableCards.filter(card => !zoned.has(card));
  const g = tableCardGapFor(1 + tableZones.reduce((s, zone) => s + zone.cards.length + 2, 0) + loose.length);
  let at = 1;
  for (const zone of tableZones) {
    zone.z0 = at * g;
    zone.topZ = (zone.cards.length + 1) * g;
    zone.cards.forEach((card, j) => { card.zoneZ = (at + j + 1) * g; });
    at += zone.cards.length + 2;
  }
  loose.forEach((card, i) => { card.zoneZ = (at + i) * g; });
}

/* A zone's cards placed to fit it, as fractions of the mat — and where in
 * the zone each lies, so that a zone being moved carries them along without
 * fitting them again. Square to the zone: the angle a card lies at in a
 * pile would turn its corners out past the zone's edge. A card in hand is
 * left where the hand has it. */
function tableZoneFitCards(zone) {
  const { width, height } = tableGeom.mat;
  const fit = tableZoneFit(zone.cards.length, zone.width, zone.height, tableCardSize.w, tableCardSize.h);
  zone.mode = fit.mode;
  zone.cards.forEach((card, j) => {
    card.zoneSpot = fit.spots[j];
    if (tableHold?.card === card) return;
    card.x = (zone.left + card.zoneSpot.x) / width;
    card.y = (zone.top + card.zoneSpot.y) / height;
    card.turn = 0;
  });
}

/* The zone's cards moved with it: each where its place in the zone now is,
 * `lift` above the height it lies at. */
function tableZoneCarryCards(zone, lift = 0) {
  const { width, height } = tableGeom.mat;
  for (const card of zone.cards) {
    if (!card.zoneSpot || tableHold?.card === card) continue;
    card.x = (zone.left + card.zoneSpot.x) / width;
    card.y = (zone.top + card.zoneSpot.y) / height;
    tableWriteCard(card, lift);
  }
}

/* A zone's element, made the first time and written each time after: its
 * box, its place and height (and `lift` above that, while it is carried),
 * the height of its label and grip over its cards, its name and count, and
 * whether it can be changed. Laid out at its size, not scaled to it, so its
 * hairline and its label stay their own size whatever size it is. */
function tableZoneDraw(zone, lift = 0, rules = tableZoneRulesNow()) {
  if (!zone.el) {
    const el = document.createElement('div');
    el.className = 'table-zone';
    el.dataset.tab = 'deckview';
    el.innerHTML = `
      <div class="table-zone-label"><span class="table-zone-name"></span><span class="table-zone-count"></span></div>
      <span class="table-zone-grip" title="Drag to resize the zone">${TABLE_ZONE_GRIP_ICON}</span>`;
    zone.el = el;
    tableEls.mat.insertBefore(el, tableEls.hint);
  }
  const { el } = zone;
  const label = el.querySelector('.table-zone-label');
  el.dataset.zone = zone.name;
  el.dataset.fit = zone.mode || 'grid';
  el.toggleAttribute('data-editable', rules.arrange);
  el.style.width  = `${zone.width.toFixed(2)}px`;
  el.style.height = `${zone.height.toFixed(2)}px`;
  el.style.transform = `translate3d(${zone.left.toFixed(2)}px, ${zone.top.toFixed(2)}px, ${(zone.z0 + lift).toFixed(3)}px)`;
  el.style.setProperty('--table-zone-top', `${zone.topZ.toFixed(3)}px`);
  label.querySelector('.table-zone-name').textContent = zone.name;
  label.querySelector('.table-zone-count').textContent = String(zone.count);
  const said = `${zone.name}, ${zone.count} card${zone.count === 1 ? '' : 's'}`;
  if (rules.arrange) {
    label.setAttribute('role', 'button');
    label.tabIndex = 0;
    label.setAttribute('aria-label', `${said}. Drag to move the zone; double-click, Enter or F2 to rename it`);
    label.title = 'Drag to move the zone · double-click to rename it';
  } else {
    label.removeAttribute('role');
    label.removeAttribute('tabindex');
    label.setAttribute('aria-label', said);
    label.removeAttribute('title');
  }
}

/* Every zone and card written where it is now: after the zones' order — and
 * so their depth — has changed. */
function tableZonesWrite(rules = tableZoneRulesNow()) {
  for (const zone of tableZones) tableZoneDraw(zone, 0, rules);
  for (const card of tableCards) if (tableHold?.card !== card) tableWriteCard(card);
}

/* The zones laid again from the deck as it is now, without the cards being
 * made again — a count changed, a zone added or renamed that took no card
 * with it, the window resized. Not while a zone is in hand or being renamed,
 * nor a card in hand: their next release lays them. Zones that are no
 * longer on — the deck closed, the chip off — have their cards laid in the
 * piles again. */
function tableZonesRefresh() {
  if (!tableOn || !tableEls || !tableGeom || tableHold || tableZoneHold || tableZoneEdit) return;
  const had = tableZones.length > 0;
  if (tableZonesPlace()) tableZonesWrite();
  else if (had) tableDrawCards();
}

/* Which zone the window point `pointer` is over, through the camera as it
 * is now, at the felt's height — or null. */
function tableZoneUnder(pointer) {
  if (!pointer || !tableGeom || !tableZones.length) return null;
  const hit = tableUnproject(tableMatrix(), pointer.x, pointer.y, tableZones[0].z0 || 0);
  const i = tableZoneAt(hit, tableZones);
  return i >= 0 ? tableZones[i] : null;
}

/* A zone lit in its tab's accent while a card in hand is over it — or none.
 * Written only when that changes. */
function tableZoneLight(zone) {
  if (zone === tableZoneTarget) return;
  tableZoneTarget?.el?.classList.remove('is-target');
  tableZoneTarget = zone || null;
  tableZoneTarget?.el?.classList.add('is-target');
}

/* A card picked up off a zone comes up over every zone's layers, so that held
 * without a lift — cards still — it still lies over the cards round it. The
 * piles do this by raising its rank; here a rank is not a height. */
function tableZonePickUp(card) {
  if (tableZonesActive()) card.zoneZ = TABLE_DEPTH + TABLE_CARD_GAP;
}

/* A frame of a card carried over the zones: the zone under the pointer, lit
 * if the card can be moved into it — not over the bin, not the commander,
 * and only for a deck the user may edit. */
function tableZoneHover(hold) {
  const rules = tableZonesActive() ? tableZoneRulesNow() : null;
  const zone = rules && hold.dragging && !hold.over && !hold.card.head ? tableZoneUnder(hold.pointer) : null;
  hold.zone = zone;
  tableZoneLight(rules?.move ? zone : null);
}

/* The landing mark for a card carried over the zones, which is always where
 * it will lie: over another zone it will go into, nowhere this side of the
 * builder's sort — so no mark, the lit zone says it; anywhere else, its own
 * place in its own zone, where it goes back to. A card no zone holds is
 * marked as in the piles. */
function tableZoneCast(hold) {
  if (!tableZonesActive() || hold.card.head || !hold.card.zoneSpot) return hold;
  if (hold.zone && hold.zone.name !== String(hold.card.group) && tableZoneRulesNow().move) return null;
  return { card: hold.card, lift: hold.lift, land: hold.from };
}

/* A card carried over the zones, let go: into the zone under the pointer
 * through the builder's own drop, if that is another zone and the deck the
 * user's — the deck then laid again, the card coming in from where it was
 * let go (tableZoneLand) — and otherwise back to its place in its zone. True
 * when this was the zones' to answer, which a card no zone holds is not. */
function tableZoneDrop(hold, e) {
  const card = hold.card;
  if (!tableZonesActive() || card.head || !card.zoneSpot) return false;
  tableSwallow = true;
  /* Only a hand letting go moves a card: a card put down for it — the window
     losing the pointer, the deck laid again under it — goes back. */
  const zone = e?.type === 'pointerup' ? tableZoneUnder(hold.pointer) : null;
  tableZoneLight(null);
  const main = typeof DB_MAIN_BOARD === 'string' ? DB_MAIN_BOARD : 'main';
  if (zone && zone.name !== String(card.group) && tableZoneRulesNow().move
      && card.ref && card.ref.startsWith(`${main}/`) && typeof dbPlace === 'function') {
    tableZoneLanding = { key: card.key, x: card.x, y: card.y, until: Date.now() + TABLE_ARRIVAL_MS };
    const place = dbPlace(main, zone.name);
    const moved = typeof cardCarryDrop === 'function' ? cardCarryDrop([card.ref], place)
      : typeof dbMoveCardsTo === 'function' && dbMoveCardsTo([card.ref], place);
    if (moved) { tableRelayDeck(); return true; }
    tableZoneLanding = null;
  }
  card.x = hold.from.x;
  card.y = hold.from.y;
  const el = card.el;
  el?.classList.remove('is-held');
  el?.classList.add('is-settling');
  if (tableZonesPlace()) tableZonesWrite();
  if (el) tableAfter(el, () => el.classList.remove('is-settling'));
  return true;
}

/* The card just let go into another zone, among the cards just laid: drawn
 * first where the hand let it go, then let settle to its place in its new
 * zone, in the card layer's own time. Not when cards may not move. */
function tableZoneLand() {
  const landing = tableZoneLanding;
  tableZoneLanding = null;
  if (!landing || Date.now() > landing.until || !cardMotionOn()) return;
  const card = tableCards.find(c => c.key === landing.key && c.el);
  if (!card) return;
  const at = { x: card.x, y: card.y };
  card.x = landing.x;
  card.y = landing.y;
  tableWriteCard(card);
  void card.el.offsetWidth;
  card.x = at.x;
  card.y = at.y;
  card.el.classList.add('is-settling');
  tableWriteCard(card);
  const el = card.el;
  tableAfter(el, () => el.classList.remove('is-settling'));
}

/* A zone's label or grip pressed: the zone is taken in hand, to be moved by
 * its label or resized by its grip once the pointer has gone TABLE_DRAG_START
 * — a press that goes nowhere is a click, and two of them a rename. Where
 * the hand closed is kept, in the mat's pixels at the label's height, so that
 * point stays under the pointer. Only for a zone that may be changed. */
function tableOnZoneDown(e) {
  if (e.button !== 0 || e.pointerType === 'touch' || tableLooked || tableHold || tableZoneHold) return;
  const handle = e.target.closest?.('.table-zone-label, .table-zone-grip');
  if (!handle || !tableZonesActive() || !tableZoneRulesNow().arrange) return;
  const zone = tableZones.find(z => z.el?.contains(handle));
  if (!zone) return;
  const resize = handle.classList.contains('table-zone-grip');
  const hit = tableUnproject(tableMatrix(), e.clientX, e.clientY, zone.z0 + zone.topZ);
  if (!hit) return;
  tableZoneHold = {
    zone, id: e.pointerId, mode: resize ? 'resize' : 'move', dragging: false, since: 0, lift: 0,
    start: { x: e.clientX, y: e.clientY }, pointer: { x: e.clientX, y: e.clientY },
    grab: resize
      ? { u: zone.left + zone.width - hit.u, v: zone.top + zone.height - hit.v }
      : { u: hit.u - zone.left, v: hit.v - zone.top },
  };
  try { handle.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
}

/* The pointer, moved with a zone in hand: where it is, and — once it has
 * gone far enough — the zone taken up: to the top of the zones, so that it
 * and its cards are drawn over any it is carried across. */
function tableZoneOnPointerMove(e) {
  const hold = tableZoneHold;
  if (!hold || e.pointerId !== hold.id) return;
  hold.pointer = { x: e.clientX, y: e.clientY };
  if (hold.dragging || !tableIsDrag(e.clientX - hold.start.x, e.clientY - hold.start.y)) return;
  hold.dragging = true;
  hold.since = performance.now();
  tableZones = [...tableZones.filter(z => z !== hold.zone), hold.zone];
  tableZonesLayer();
  tableZonesWrite();
  hold.zone.el.classList.remove('is-settling');
  hold.zone.el.classList.add(hold.mode === 'move' ? 'is-lifted' : 'is-resizing');
  for (const card of hold.zone.cards) card.el?.classList.remove('is-settling');
}

/* One frame of a zone in hand. Moved, it rises to TABLE_ZONE_LIFT in a
 * card's lift time (none when cards may not move) and is put where the
 * point the hand closed on is under the pointer, at the height the label is
 * risen to, kept on the mat — its cards carried with it. Resized, its corner
 * follows the pointer, no smaller than its smallest and no further than the
 * mat's edge, and its cards are fitted again. Returns whether it is still
 * rising. */
function tableZoneStep(now) {
  const hold = tableZoneHold;
  if (!hold?.dragging || !tableGeom) return false;
  const zone = hold.zone;
  const { width: W, height: H } = tableGeom.mat;
  const clamp = (n, lo, hi) => Math.min(Math.max(lo, hi), Math.max(lo, n));
  if (hold.mode === 'move') {
    const motion = cardMotionOn();
    const rise = tableLiftHeight(now - hold.since, motion) * TABLE_ZONE_LIFT / TABLE_CARD_LIFT;
    hold.lift = rise;
    const hit = tableUnproject(tableMatrix(), hold.pointer.x, hold.pointer.y, zone.z0 + zone.topZ + rise);
    if (hit) {
      zone.left = clamp(hit.u - hold.grab.u, 0, W - zone.width);
      zone.top  = clamp(hit.v - hold.grab.v, 0, H - zone.height);
    }
    tableZoneDraw(zone, rise);
    tableZoneCarryCards(zone, rise);
    return rise !== tableLiftHeight(Infinity, motion) * TABLE_ZONE_LIFT / TABLE_CARD_LIFT;
  }
  const hit = tableUnproject(tableMatrix(), hold.pointer.x, hold.pointer.y, zone.z0 + zone.topZ);
  if (hit) {
    const min = tableZoneMinFor(W, tableCardSize.w, tableCardSize.h);
    zone.width  = clamp(hit.u + hold.grab.u - zone.left, min.width, W - zone.left);
    zone.height = clamp(hit.v + hold.grab.v - zone.top, min.height, H - zone.top);
  }
  tableZoneFitCards(zone);
  tableZoneDraw(zone);
  for (const card of zone.cards) tableWriteCard(card);
  return false;
}

/* Let go of a zone: it comes down where it is, its cards with it, in the
 * card layer's own time, and the deck's layout is kept. A press that never
 * moved changes nothing. */
function tableZoneRelease(e) {
  const hold = tableZoneHold;
  if (!hold || (e && e.pointerId !== hold.id)) return;
  tableZoneHold = null;
  if (!hold.dragging || !tableEls) return;
  const zone = hold.zone;
  const settle = [zone.el, ...zone.cards.map(card => card.el)].filter(Boolean);
  zone.el?.classList.remove('is-lifted', 'is-resizing');
  for (const el of settle) el.classList.add('is-settling');
  tableZoneDraw(zone);
  tableZoneCarryCards(zone);
  for (const el of settle) tableAfter(el, () => el.classList.remove('is-settling'));
  tableZoneKeep(tableZoneDeck()?.id, tableZones);
}

/* A new zone: a new category through the builder's own add, under the
 * builder's own placeholder name — already unique — and a zone for it in
 * free space, kept before the category is added so that the redraw the add
 * brings finds it. An add the builder refuses keeps no zone. */
function tableZoneAdd() {
  const rules = tableZoneRulesNow();
  const deck = tableZoneDeck();
  if (!rules.add || !deck || !tableGeom || typeof _dbAddCategoryByName !== 'function') return;
  const cats = typeof dbCats !== 'undefined' ? dbCats : [];
  let name = typeof _dbNewCategoryName === 'function' ? _dbNewCategoryName() : '';
  for (let n = 1; !name || cats.some(c => c.name === name); n++) name = n === 1 ? 'New category' : `New category ${n}`;
  const { width, height } = tableGeom.mat;
  const size = tableZoneDefaultSize(0, tableCardSize.w, tableCardSize.h, width);
  const at = tableZoneFree(tableZones, size, width, height, tableZoneKeepOut());
  const before = tableZones.map(({ name: n, left, top, width: w, height: h }) => ({ name: n, left, top, width: w, height: h }));
  tableZoneKeep(deck.id, [...before, { name, ...at, ...size }]);
  if (!_dbAddCategoryByName(name)) { tableZoneKeep(deck.id, before); return; }
  tableRelayDeck();
}

/* A label double-clicked, or Enter or F2 on it focused: renamed, for a deck
 * the user may edit. */
function tableOnZoneDblClick(e) {
  const label = e.target.closest?.('.table-zone-label');
  if (!label || !tableZoneRulesNow().rename) return;
  const zone = tableZones.find(z => z.el?.contains(label));
  if (zone) tableZoneBeginEdit(zone);
}

function tableOnZoneKey(e) {
  if (e.key !== 'Enter' && e.key !== 'F2') return;
  const label = e.target.closest?.('.table-zone-label');
  if (!label || e.target !== label || !tableZoneRulesNow().rename) return;
  const zone = tableZones.find(z => z.el?.contains(label));
  if (!zone) return;
  e.preventDefault();
  tableZoneBeginEdit(zone);
}

/* The rename field, laid over the label where it lies, in the table's plane
 * as the slip's field is: the name in it, chosen, to be typed over. Enter
 * renames, Escape does not, and leaving the field renames as the builder's
 * own name box does. Its keys are its own: Escape, Enter and the table's
 * shortcuts stop at it. */
function tableZoneBeginEdit(zone) {
  tableZoneEndEdit(false, { refocus: false });
  if (!zone.el) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'table-zone-rename';
  input.value = zone.name;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', `Rename the category ${zone.name}`);
  input.addEventListener('pointerdown', e => e.stopPropagation());
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    tableZoneEndEdit(e.key === 'Enter');
  });
  input.addEventListener('blur', () => { if (tableZoneEdit?.input === input) tableZoneEndEdit(true, { blur: true }); });
  zone.el.classList.add('is-renaming');
  zone.el.append(input);
  tableZoneEdit = { name: zone.name, input };
  input.focus({ preventScroll: true });
  input.select();
}

/* The rename field put away — renaming, if `commit` and the name is a new
 * one: through the builder's own rename, the zone keeping its place under
 * its new name. A name another category has is refused as the builder's
 * rename refuses it: said, with the field kept open for another — or, the
 * field having been left, not renamed. */
function tableZoneEndEdit(commit, { blur = false, refocus = !blur } = {}) {
  const edit = tableZoneEdit;
  if (!edit) return;
  const from = edit.name;
  const to = edit.input.value.trim();
  const cats = typeof dbCats !== 'undefined' ? dbCats : [];
  const fresh = commit && !!to && to !== from;
  if (fresh && cats.some(c => c.name === to)) {
    if (!blur) {
      if (typeof showToast === 'function') showToast('That category already exists');
      edit.input.select();
      return;
    }
    commit = false;
  }
  tableZoneEdit = null;
  const zone = tableZones.find(z => z.name === from);
  zone?.el?.classList.remove('is-renaming');
  edit.input.remove();
  if (fresh && commit && tableZoneRulesNow().rename && typeof _dbRenameCategory === 'function') {
    tableZoneRename(from, to);
  }
  if (refocus) tableZones.find(z => z.name === (fresh && commit ? to : from))?.el
    ?.querySelector('.table-zone-label')?.focus({ preventScroll: true });
}

/* A category renamed from its zone: the zone's place kept under the new
 * name first, then the builder's own rename — which saves the deck and
 * redraws it — and the mat laid again from that. */
function tableZoneRename(from, to) {
  const deck = tableZoneDeck();
  for (const zone of tableZones) if (zone.name === from) zone.name = to;
  tableZoneKeep(deck?.id, tableZones);
  _dbRenameCategory(from, to);
  tableRelayDeck();
}

// ── What main.js tells the table ─────────────────────────────────────────

/* Called first thing in setTab(): a tab opened from anywhere while the table
 * is up has its pane carried into a panel before its init draws into it. */
function tableModeBeforeTab(tab) {
  if (!tableOn) return;
  /* The view the Card sheet was opened over, arrived at again — by the
     sheet's own close, or by Back — comes back as it was left rather than
     as a freshly opened panel. */
  const back = tableCardReturn;
  if (back && tablePanel?.tab === 'card' && tab === back.tab) {
    tableCardReturn = null;
    tableRestoreView(back);
    return;
  }
  if (tablePanel?.tab !== tab) tableShowPane(tab);
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
