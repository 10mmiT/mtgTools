// ── Deck Builder ──────────────────────────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────────────────────
let dbDeck      = null;      // {id, playerId, playerName, name, commander, commanderImg}
let dbCards     = [];        // [{card_name, qty, category, position}]
let dbCats      = [];        // [{name, position}]
let dbCardData  = new Map(); // card name → Scryfall card object
let dbView      = 'list';
let dbFold      = 'full';    // how much of the frame is showing — see DB_FOLDS
let dbLeftTab   = 'search';
let dbSrResults = [];        // Scryfall search results
let _dbLandedCards = null;   // the cards this one render draws landing, after being carried there
let dbEdhrecData = null;     // parsed EDHREC cardlists
let dbAcTimer   = null;
let dbAddAcTimer = null;
let dbCmdAcTimer = null;
let dbSaveTimer  = null;
let dbSaving     = false;
let dbSortMounted = false;
let _dbSizeSync  = null;     // the shared card-size control, told when the view changes
let _dbInitDone  = false;
let _dbMovingCard = null;    // card name being moved between categories
let _dbBulkMoveMode = false; // true when the move modal is acting on dbSelectedCards instead of _dbMovingCard
let _dbRenamingCat = null;   // category name being renamed
let _dbCatModalReturnTo = null; // 'categories' when rename was opened from the Manage Categories modal
let _dbEdhrecLoaded = false; // whether EDHREC has been fetched for the current deck
let dbFilterText  = '';      // what is in the filter box, as typed
let dbFilterQuery = null;    // that, compiled — see dbSetFilter()
let dbFilterError = '';      // why what is in the box isn't a query yet, if it isn't
let _dbNamingCat = null;     // a category just made by a drop, being named in place
let dbAnalysisOpen = false;  // whether the curve is expanded out of the toolbar
const dbCollapsedCats = new Set(); // categories collapsed by user
const dbSelectedCards = new Set(); // card names currently selected for bulk move
const dbSettledCats = new Set(); // the categories settled into a stack, in pile view; the rest are fanned out

/* No Commander among them: the commander is a board now, drawn at the head of
 * the mat, and a category of the same name would be a second place for it to
 * be. Every deck used to spend a header, a pile and a row of mat on one card
 * that never moves and never sorts. */
const DB_DEFAULT_CATS = [
  'Creatures', 'Planeswalkers', 'Instants', 'Sorceries',
  'Enchantments', 'Artifacts', 'Battles', 'Lands', 'Other',
];

/* Which of this deck's boards are on the mat. Off by default and remembered
 * per deck — see getShownBoards() in js/sortui.js. A board that is off is
 * still drawn into the mat and hidden by the stylesheet, because a hidden
 * board has to reveal itself the moment a card is picked up: a board you
 * cannot put anything in is not somewhere to put things.
 *
 * What a board *is* — the list of them, and the two strings that say where a
 * card is and where it is going — is js/deckview-boards.js's. */
let dbShownBoards = new Set();
const DB_SORT_FIELDS = ['name', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'];

/* ── How much of the frame is showing ──────────────────────────────────────
 *
 * Three states rather than a toggle, because "chrome" is two different things
 * and they are wanted at different moments:
 *
 *   full     everything — the controls, the readout, the mat
 *   readout  every control gone, and one thin line of what the deck *is*
 *   bare     the mat and the cards on it, and the way back
 *
 * The order is the order the presses go in, and it wraps: a third press on a
 * bare mat brings the whole tab back, so the control is one button rather than
 * two and nothing is ever more than one press from being reachable.
 *
 * It is *not* revealed by pointing at anything. The mat is a drag surface, and
 * a card carried towards a category high on the screen would trip a
 * reveal-on-hover every time — which is the accidental-hover problem
 * spec-cards-as-objects.md was careful to design out. Folding is asked for. */
const DB_FOLDS = ['full', 'readout', 'bare'];

/* What the next press does, which is the only thing the button can honestly
 * say about itself: it is the same button in all three states. */
const DB_FOLD_LABELS = {
  full:    'Hide the controls (c)',
  readout: 'Hide the deck’s readout too (c)',
  bare:    'Bring the controls back (c)',
};

// The empty mat, taken from the markup at boot rather than written out a
// second time here: putting a deck down has to land on the same thing a cold
// load shows, and one sentence in two files is one sentence to drift.
let _dbEmptyMat = '';

// ── Initialization ────────────────────────────────────────────────────────────
function initDeckBuilder() {
  if (!_dbInitDone) {
    _dbEmptyMat = document.getElementById('dbDeckContent').innerHTML;
    document.getElementById('dbCsvInput').addEventListener('change', _dbHandleCsvImport);
    document.addEventListener('click', e => {
      if (!e.target.closest('.db-cat-kebab-wrap')) dbCloseCatMenus();
      if (!e.target.closest('#dbCardMenu')) dbCloseCardMenu();
      dbStackClick(e);
    });

    /* What can be done to a card, asked for the way anything is asked for of a
     * thing on a screen. The browser's own menu is refused only over a card:
     * everywhere else on the page — a name to copy, a picture to save — it is
     * still the browser's to offer. */
    document.getElementById('dbDeckContent')?.addEventListener('contextmenu', e => {
      const name = _dbCardAt(e.target);
      if (!name) return;
      e.preventDefault();
      dbOpenCardMenu(e.clientX, e.clientY, name);
    });

    /* An open menu belongs to the card it was opened on, and both of these
     * take that card out from under it: the mat scrolling away beneath it, and
     * a hand reaching for another card and carrying it off. */
    window.addEventListener('scroll', dbCloseCardMenu, { passive: true });
    document.addEventListener('pointerdown', e => {
      if (e.button !== 2 && !e.target.closest('#dbCardMenu')) dbCloseCardMenu();
    }, true);

    // Restore persisted view. A tab left in the XL view comes back in the
    // grid: XL was a second grid at a fixed size, and the size control is
    // that question asked properly.
    const savedView = localStorage.getItem('dbView');
    if (savedView === 'xl') { dbView = 'grid'; localStorage.setItem('dbView', 'grid'); }
    else if (savedView && ['list','grid','pile'].includes(savedView)) dbView = savedView;
    _dbAdoptLegacyScale();

    /* A deck read at full mat comes back at full mat. Restored before the mat
     * is drawn rather than after, so a folded tab is never briefly unfolded. */
    dbFold = getChromeFold('deckbuild', DB_FOLDS);
    _dbSyncFold();
    /* And the menu beside the mat, for the same reason and at the same moment:
     * the mat is about to be drawn and it is drawn into whatever width the menu
     * leaves it. */
    _dbLoadMenu();

    // Keyboard shortcuts (only when deck builder tab is active and not typing in a field)
    document.addEventListener('keydown', e => {
      const dbTabActive = document.getElementById('tab-deckview')?.style.display !== 'none';
      const inField     = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
      if (!dbTabActive || inField) return;

      /* A letter with something held down is not this tab's letter: Ctrl+C is
       * copy and Ctrl+F is find, and a tab whose keys are bare letters has to
       * say so or it takes them. Ctrl+A is the one that is genuinely ours to
       * mean something else by, and it says so where it is answered. */
      const bare = !e.ctrlKey && !e.metaKey && !e.altKey;

      if (e.key === 'Escape') {
        dbCloseCardMenu();
      } else if (bare && (e.key === 'c' || e.key === 'C')) {
        /* Every control the fold hides is one press from being back, without
         * reaching for the one button left on the strip.
         *
         * It was `f`, which is the card turn's now (js/cardturn.js) and had to
         * be: this is the tab where pointing at a card and pressing a key is
         * most obviously about the card, and one key cannot both turn the card
         * over and fold the frame away from under it. `c` is the chrome it
         * collapses, and it is the only letter this tab spends on it. */
        e.preventDefault();
        if (dbDeck) dbFoldChrome();
      } else if (bare && (e.key === 'm' || e.key === 'M')) {
        /* The controls, without reaching for the strip either. The column is
         * where they all live now, so it earns a key beside the fold's. */
        e.preventDefault();
        dbToggleMenu();
      } else if (bare && e.key === '/') {
        e.preventDefault();
        dbOpenSearchPanel();
        setTimeout(() => document.getElementById('dbSearchInput')?.focus(), 50);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        dbSelectAllVisible();
      }
    });

    /* No hover preview here. This tab used to draw its own — its own element,
       its own cache, its own mousemove — beside the one main.js draws on every
       .card-link in the app, and since the mat's rows carry .card-link both of
       them fired: two copies of the same card, twenty pixels apart and ten
       pixels different in width, which reads as a rendering fault. The one in
       js/main.js is the survivor, and it is better than either was. */

    _dbInitDone = true;
  }
  // Mount the shared view toggle (re-mounts with the restored view active)
  mountViewToggle('dbViewMount', ['list', 'grid', 'pile'], () => dbView, dbSetView);
  /* This tab's slider is the shared control now, sizing the mat by the same
     variable the browsing tabs size their grids by. #dbDeckContent is the
     element the width is set on, so grids, piles and stacks all inherit it. */
  _dbSizeSync = mountSizeControl('dbSizeMount', 'deckbuild', 'dbDeckContent', () => dbView);
  /* Whose collections count as owned, and the chips that filter the mat by the
     answer. Written from their own lists rather than out of the markup, the
     way the board toggles are. */
  dbSyncOwnScope();
  _dbRenderOwnChips();
  dbPopulateDeckSel();
}

/* The size this tab was left at, from before the control was shared. It was
 * one number for every view; the shared control keeps one per view, so the
 * old number seeds both rather than being dropped on the floor. Run once —
 * the key is removed, and a browser that never had it does nothing. */
function _dbAdoptLegacyScale() {
  const legacy = localStorage.getItem('dbScale');
  if (!legacy) return;
  for (const mode of ['grid', 'pile']) saveCardSize('deckbuild', mode, legacy);
  localStorage.removeItem('dbScale');
}

/* The switcher, which is what is left of this tab's front door.
 *
 * It used to be every deck the group owns, standing in front of an empty mat.
 * Opening a deck is the Decks tab's job now — picking among many belongs with
 * the gallery of them — so this is the smaller question the tab kept: stepping
 * between *your own* built decks without leaving the mat. "Built" is the
 * server's signal, the same one the Decks grid keys off (deckCardCounts[id] >
 * 0); a deck that is only a name and a link has nothing here to open.
 *
 * Whatever is open is on the list whether or not that rule would put it there
 * — somebody else's deck opened from the Everyone view, or a deck made a
 * moment ago that has saved no rows yet. A control that could not name the
 * deck in front of you would be reading as some other deck's. (The one deck
 * it cannot name is one whose player has left the state entirely, and that is
 * a deck that no longer exists: the control falls back to naming none.)
 *
 * A deployment that cannot say who you are has no "yours" to offer, so it gets
 * every deck it may see, the way the Decks tab's scope falls back to Everyone.
 * Only then are the decks named by their player: the prefix is there to say
 * "this one is not yours", and on your own list it would be on every line.
 */
function dbPopulateDeckSel() {
  const sel = document.getElementById('dbDeckSel');
  if (!sel) return;
  const me   = myPlayerId();
  const open = dbDeck ? `${dbDeck.playerId}|${dbDeck.id}` : '';

  sel.innerHTML = '';
  const add = (value, label) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  };
  // The way back to the signpost, which is the only thing an empty choice can
  // honestly do now that choosing is not what this control is for.
  add('', '— Close deck —');

  for (const player of (state.players || [])) {
    const yours = !!me && player.id === me;
    for (const deck of (player.decks || [])) {
      const value  = `${player.id}|${deck.id}`;
      const built  = (state.deckCardCounts?.[deck.id] || 0) > 0;
      const listed = value === open || (built && (yours || !me));
      if (!listed) continue;
      const name = yours ? deck.name : `${player.name} · ${deck.name}`;
      add(value, deck.commander ? `${name} (${deck.commander})` : name);
    }
  }
  sel.value = open;
  _dbPopulateNewDeckPlayers();
}

function _dbPopulateNewDeckPlayers() {
  const sel = document.getElementById('dbNewDeckPlayer');
  if (!sel) return;
  sel.innerHTML = '';
  for (const p of (state.players || [])) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  if (currentUser?.playerId) sel.value = currentUser.playerId;
}

// ── Deck selection ────────────────────────────────────────────────────────────
async function dbSelectDeck(value) {
  dbCloseHistoryPanel();  // one deck's history is not another's
  dbCloseOwnedPanel();    // and one deck's missing twelve are not another's
  dbCloseCheckPanel();    // nor is one deck's colour identity another's
  dbSelectedCards.clear();
  _dbNamingCat = null;    // a half-typed name belongs to the deck it was typed on
  dbSettledCats.clear();  // another deck's settled piles are not this one's, and a mat arrives spread
  /* One deck's filter is not another's — and a box left reading `t:goblin`
   * over a deck with no goblins in it is a deck that looks empty. */
  const filterBox = document.getElementById('dbFilterInput');
  if (filterBox) filterBox.value = '';
  _dbCompileFilter('');
  /* The ownership chip goes with it, and for the same reason: a mat left
     showing only what you are missing, over a deck you own all of, is a deck
     that looks empty. */
  dbOwnChip = null;
  _dbRenderOwnChips();

  if (!value) {
    dbDeck = null; dbCards = []; dbCats = []; dbCardData = new Map();
    dbSortMounted = false; dbEdhrecData = null; _dbEdhrecLoaded = false;
    dbShownBoards = new Set();  // another deck's boards are not this one's
    _dbRenderBoardToggles();
    _dbHideDeckUI();
    dbPopulateDeckSel();
    return;
  }
  const [playerId, deckId] = value.split('|');
  const player = state.players.find(p => p.id === playerId);
  // Handle legacy decks whose id was undefined — serialised to the string "undefined"
  const deck = player?.decks?.find(d =>
    d.id === deckId || (deckId === 'undefined' && d.id == null)
  );
  if (!player || !deck) return;
  // Backfill a stable id so this deck works going forward
  if (deck.id == null) {
    const i = player.decks.indexOf(deck);
    deck.id = deck.deckId ? `arch_${deck.deckId}` : `legacy_${player.id}_${i}`;
  }
  const stableId = deck.id;  // always use this, not the raw split value

  dbDeck = { id: stableId, playerId, playerName: player.name,
             name: deck.name, commander: deck.commander || '', commanderImg: deck.commanderImg || null };
  dbEdhrecData = null; _dbEdhrecLoaded = false;
  dbShownBoards = new Set();      // the last deck's boards are not this one's
  _dbRenderBoardToggles();

  /* The strip's switcher is written around whatever is open, here rather than
     at the call sites: a deck is opened from a tile on the Decks tab, from the
     switcher itself and from a deck made a moment ago, and all three have to
     leave the control naming the deck the mat is showing. */
  dbPopulateDeckSel();

  document.getElementById('dbDeckContent').innerHTML =
    '<div class="empty-state" style="padding:var(--space-6) var(--space-4)">Loading deck…</div>';
  _dbShowDeckUI();

  try {
    const res  = await fetch(`/api/players/${encodeURIComponent(playerId)}/decks/${encodeURIComponent(stableId)}/cards`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    /* A row that names no board is in the deck. Filled in on the way in rather
     * than everywhere it is read: a card carries its board from here on, so
     * nothing below has to keep asking what a missing one meant. */
    dbCards = (data.cards || []).map(c => ({ ...c, board: c.board || DB_MAIN_BOARD }));
    dbCats  = data.categories?.length ? data.categories : DB_DEFAULT_CATS.map((n, i) => ({ name: n, position: i }));
    /* Which boards this deck was left showing — after its cards, because a
     * head board is on by default when it holds something and there is nothing
     * to ask that of until they have arrived. */
    _dbLoadShownBoards(stableId);

    // Auto-import Archidekt cards when the deck has never been built locally
    if (dbCards.length === 0 && deck.source === 'archidekt' && deck.deckId) {
      document.getElementById('dbDeckContent').innerHTML =
        '<div class="empty-state" style="padding:var(--space-6) var(--space-4)">Importing from Archidekt…</div>';
      const imported = await _dbImportArchidekt(deck.deckId);
      if (imported.length) {
        dbCards = imported;
        _dbLoadShownBoards(stableId);   // a deck that arrived with a commander shows it
        // Resolve categories that need Scryfall type data
        await dbFetchCardData([...new Set(dbCards.map(c => c.card_name))]);
        for (const card of dbCards) {
          if (!card.category) card.category = dbAutoCategory(card.card_name);
        }
        _dbScheduleSave();
        dbRender();
        dbRenderStats();
        if (!dbSortMounted) {
          mountSortControl('dbSortMount', 'deckbuild', DB_SORT_FIELDS, dbRender, { field: 'name', dir: 1 });
          dbSortMounted = true;
        }
        return;
      }
    }

    await dbFetchCardData([...new Set(dbCards.map(c => c.card_name))]);
    dbRender();
    dbRenderStats();
    if (!dbSortMounted) {
      mountSortControl('dbSortMount', 'deckbuild', DB_SORT_FIELDS, dbRender, { field: 'name', dir: 1 });
      dbSortMounted = true;
    }
  } catch (e) {
    document.getElementById('dbDeckContent').innerHTML =
      `<div class="error-msg" style="margin:var(--space-2) 0">${esc(e.message)}</div>`;
  }
}

// The controls that act on a deck's cards are on the one strip with the deck
// picker, and exist only once there is a deck: one attribute on the pane
// switches all of them (.db-when-deck in tabs.css), so this stays a statement
// about which shape the tab is in rather than a list of elements to keep in
// step with the markup. Deleting a deck is the exception — it also depends on
// whose deck it is, which no attribute on the pane knows.
function _dbSetMode(mode) {
  document.getElementById('tab-deckview')?.setAttribute('data-db-mode', mode);
}

// ── Folding the frame away ────────────────────────────────────────────────────
/* One press further into the mat, and round again. The tiers are DB_FOLDS and
 * the wrap is what makes one button enough. */
function dbFoldChrome() {
  const at = DB_FOLDS.indexOf(dbFold);
  dbSetFold(DB_FOLDS[(at + 1) % DB_FOLDS.length]);
}

function dbSetFold(fold) {
  dbFold = DB_FOLDS.includes(fold) ? fold : DB_FOLDS[0];
  saveChromeFold('deckbuild', dbFold);
  _dbSyncFold();
}

/* What is showing, said once on the pane so the stylesheet can do the hiding —
 * the same call [data-db-mode] makes for the controls that need a deck. Six
 * style.display writes would be six places for the two tiers to disagree.
 *
 * The button's own label is written here too, because it is the same button in
 * all three states and the only thing it can say is what the next press does. */
function _dbSyncFold() {
  document.getElementById('tab-deckview')?.setAttribute('data-db-fold', dbFold);
  const btn = document.getElementById('dbFoldBtn');
  if (!btn) return;
  btn.title = DB_FOLD_LABELS[dbFold];
  btn.setAttribute('aria-label', DB_FOLD_LABELS[dbFold]);
}

// ── The menu beside the mat ───────────────────────────────────────────────
/* The strip had grown to fourteen controls and wrapped to three rows on an
 * ordinary window. What was on it that is *not* the deck picker, the add field
 * or the filter is now a column at the right-hand edge of the mat: the view,
 * the size, the sort, the boards, the ownership chips and scope, the analysis
 * strip's switch, the drawers, and everything the ⋯ popover used to hold.
 *
 * It **pushes rather than covers**, which is the whole argument for a column
 * over the drawer shell already on this tab. Every one of those controls is
 * answered by the mat — change the size and the cards resize, press a board
 * and a region appears, filter by what you are missing and cards leave — and a
 * panel lying over the mat behind a scrim would make you close it to see what
 * you did. The two drawers on this tab cover the mat because what they hold is
 * somewhere *else*: search results, and a list of past versions.
 *
 * Open or closed is remembered the way the fold is, and the same press of `c`
 * takes it away with the rest of the controls, because it is the rest of the
 * controls. */
let dbMenuOpen = true;

/* Below this the row becomes a column and the menu takes the top of it, which
 * is a screenful on a phone — so a narrow window arrives closed however this
 * browser left it. The preference is not overwritten: it is a desktop
 * preference being read on a phone, not a decision the phone gets to make. */
const DB_MENU_PUSH_WIDTH = 900;

function _dbLoadMenu() {
  const saved = localStorage.getItem('dbMenu');
  dbMenuOpen = saved === null ? true : saved === 'open';
  if (window.innerWidth < DB_MENU_PUSH_WIDTH) dbMenuOpen = false;
  _dbSyncMenu();
}

function dbToggleMenu() {
  dbMenuOpen = !dbMenuOpen;
  localStorage.setItem('dbMenu', dbMenuOpen ? 'open' : 'closed');
  _dbSyncMenu();
}

function dbCloseMenu() {
  if (!dbMenuOpen) return;
  dbToggleMenu();
}

/* One attribute on the pane, the same call [data-db-mode] and [data-db-fold]
 * make: the stylesheet does the showing, so there is one place for "the menu is
 * open" to be true rather than one per element it changes. */
function _dbSyncMenu() {
  document.getElementById('tab-deckview')?.setAttribute('data-db-menu', dbMenuOpen ? 'open' : 'closed');
  const btn = document.getElementById('dbMenuBtn');
  if (!btn) return;
  btn.setAttribute('aria-expanded', dbMenuOpen ? 'true' : 'false');
  btn.classList.toggle('db-analysis-open', dbMenuOpen);
  btn.title = dbMenuOpen ? 'Hide the deck controls (m)' : 'Deck controls (m)';
}

// ── Showing a board ───────────────────────────────────────────────────────
/* The toggles, written from DB_BOARDS rather than out of the markup, so that a
 * board added later arrives on the strip with the rest of it. The mainboard
 * has no toggle: it is the deck, and a deck you can switch off is a blank tab
 * with a card count on it.
 *
 * They are buttons rather than checkboxes because that is what the rest of
 * this strip is, and `aria-pressed` is what says a button is a state rather
 * than an action — the same pair the view toggle uses. */
function _dbRenderBoardToggles() {
  const mount = document.getElementById('dbBoardMount');
  if (!mount) return;
  mount.innerHTML = DB_BOARDS.filter(b => b.id !== DB_MAIN_BOARD).map(b => {
    const on = dbShownBoards.has(b.id);
    return `<button class="btn-secondary db-board-toggle${on ? ' db-board-on' : ''}"
      onclick="dbToggleBoard('${jsAttr(b.id)}')" aria-pressed="${on ? 'true' : 'false'}"
      title="${esc(b.hint || b.label)}">${esc(b.label)}</button>`;
  }).join('');
}

/* On the mat, or off it — and remembered against this deck, because whether
 * you are sideboarding is a fact about the deck you are looking at. Written as
 * the press happens, the way the fold is: a browser closed a moment later
 * comes back showing the same boards. */
function dbToggleBoard(board) {
  if (!dbDeck) return;
  if (dbShownBoards.has(board)) dbShownBoards.delete(board);
  else dbShownBoards.add(board);
  _dbSaveShownBoards();
  _dbRenderBoardToggles();
  dbRender();
}

/* ── What is stored is what differs from the default ───────────────────────
 *
 * Not "which boards are showing". A maybeboard is off unless asked for and a
 * commander board is on as soon as it holds a commander, so a list of what is
 * *on* could not say "this deck's commander board is hidden" at all — and a
 * board that came back every time you closed it is not a board that hides.
 *
 * The stored value is unchanged for the boards that were there before: their
 * default is off, so a name in the list still means on. It is read the other
 * way round for a head board, and that is the whole of the migration. */
function _dbDeviatingBoards() {
  return DB_BOARDS
    .filter(b => b.id !== DB_MAIN_BOARD && dbShownBoards.has(b.id) !== dbBoardOnByDefault(b))
    .map(b => b.id);
}

function _dbSaveShownBoards() {
  if (dbDeck) saveShownBoards(dbDeck.id, _dbDeviatingBoards());
}

/* Which boards this deck is showing: each board's default, flipped where this
 * deck says so. Filtered against DB_BOARDS on the way in for localStorage's
 * usual reason, and the mainboard is never in the set — it has no toggle and
 * is never hidden, so keeping it there would be a second way to say something
 * that is already always true.
 *
 * Read *after* the deck's cards are in hand, because a head board's default
 * asks whether it holds anything. */
function _dbLoadShownBoards(deckId) {
  const flipped = new Set(getShownBoards(deckId));
  dbShownBoards = new Set(DB_BOARDS
    .filter(b => b.id !== DB_MAIN_BOARD && (dbBoardOnByDefault(b) !== flipped.has(b.id)))
    .map(b => b.id));
  _dbRenderBoardToggles();
}

/* A board has been given something, so the board is on.
 *
 * The stored preference is rewritten with it, even when the board was already
 * showing, because what has just changed is the *default*: an empty commander
 * board switched on by hand is a deck deviating from off, and the moment a card
 * lands on it that same stored entry would start reading as "hidden".
 *
 * The mainboard is not a board that can be hidden, so it is not one that can be
 * revealed either. */
function _dbRevealBoard(boardId) {
  if (boardId === DB_MAIN_BOARD || !_dbBoardExists(boardId)) return;
  const was = dbShownBoards.has(boardId);
  dbShownBoards.add(boardId);
  _dbSaveShownBoards();
  if (!was) _dbRenderBoardToggles();
}

/* The narrower rule the *drop* path wants: only a head board.
 *
 * A commander dropped into a region that was switched off would disappear out
 * of the hand, so the head of the deck comes on. The holding areas deliberately
 * do not — a hidden board shows itself for as long as a card is in hand and
 * goes back to hidden when you let go, which is what makes a board you switched
 * off still somewhere you can put something. That is a decision about carrying,
 * and it is why this is not simply _dbRevealBoard(): adding a card *by name*
 * has no hand and no reveal, so it reveals whatever it filled. */
function _dbRevealHeadBoard(boardId) {
  if (!DB_BOARDS.find(b => b.id === boardId)?.head) return;
  _dbRevealBoard(boardId);
}

/* The curve, out of the toolbar and back into it. In memory rather than
 * stored: a panel you opened to look at something is not a preference, and it
 * is inside the tier that folds away with the rest of the controls. */
function dbToggleAnalysis() {
  dbAnalysisOpen = !dbAnalysisOpen;
  const panel = document.getElementById('dbAnalysis');
  const btn   = document.getElementById('dbCurveBtn');
  if (panel) panel.style.display = dbAnalysisOpen ? '' : 'none';
  btn?.setAttribute('aria-expanded', dbAnalysisOpen ? 'true' : 'false');
  btn?.classList.toggle('db-analysis-open', dbAnalysisOpen);
}

function _dbShowDeckUI() {
  _dbSetMode('deck');
  document.getElementById('dbDeleteDeckBtn').style.display =
    isMyPlayer(dbDeck?.playerId) ? '' : 'none';
}

function _dbHideDeckUI() {
  _dbSetMode('none');
  document.getElementById('dbDeckContent').innerHTML = _dbEmptyMat;
}

// ── Delete deck ───────────────────────────────────────────────────────────────
async function dbDeleteDeck() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  if (!confirm(`Delete "${dbDeck.name}"? This removes the deck and all its cards. You can re-add it (e.g. from Archidekt) afterwards.`)) return;

  const { id: deckId, playerId } = dbDeck;

  /* First, and awaited, because the wipe below is what it is protecting
   * against. It also ends this deck's history: rows keyed by a deck nothing
   * will ask for again are orphans, so the server keeps only this one — what
   * the deck was as it went. A deck re-added afterwards under the same id, as
   * the confirmation above invites, finds it in the History panel. */
  await _dbForceSnapshot('deck-delete');

  // Wipe server-side cards/categories for this deck (no dedicated delete-deck
  // endpoint — reuse the full-replace endpoint with empty arrays).
  try {
    await fetch(`/api/players/${encodeURIComponent(playerId)}/decks/${encodeURIComponent(deckId)}/cards`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: [], categories: [] }),
    });
  } catch {}

  const player = state.players.find(p => p.id === playerId);
  if (player) player.decks = (player.decks || []).filter(d => d.id !== deckId);
  await saveToStorage();

  dbDeck = null; dbCards = []; dbCats = []; dbEdhrecData = null; _dbEdhrecLoaded = false;
  _dbHideDeckUI();
  dbPopulateDeckSel();
}

// ── Archidekt import ──────────────────────────────────────────────────────────
/* No commander here: Archidekt's Commander category is a board of ours, not a
 * pile, and it is read out of rawCats below. */
const _ARCH_CAT = {
  creatures: 'Creatures', creature: 'Creatures',
  planeswalkers: 'Planeswalkers', planeswalker: 'Planeswalkers',
  instants: 'Instants', instant: 'Instants',
  sorceries: 'Sorceries', sorcery: 'Sorceries',
  enchantments: 'Enchantments', enchantment: 'Enchantments',
  artifacts: 'Artifacts', artifact: 'Artifacts',
  battles: 'Battles', battle: 'Battles',
  lands: 'Lands', land: 'Lands',
};

async function _dbImportArchidekt(archidektId) {
  const res = await fetch(`/api/archidekt/deck/${encodeURIComponent(archidektId)}`);
  if (!res.ok) throw new Error(`Archidekt fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  const cards = [];
  for (const item of (data.cards || [])) {
    const name = item.card?.oracleCard?.name || item.card?.name || '';
    const qty  = item.quantity || 1;
    if (!name || qty <= 0) continue;
    /* A sideboard or maybeboard card used to be dropped on the floor here,
     * because there was nowhere in a deck to put a card that is not in it.
     * There is now, so it arrives on the board it was already on — and its
     * category rides along with it, which is what makes promoting one land in
     * a pile rather than in "Other".
     *
     * Archidekt's Commander is one of those boards rather than one of its
     * categories, which is also how two commanders arrive as two cards. */
    const rawCats = (item.categories || []).map(c => c.trim());
    const boarded = rawCats.find(c => /sideboard|maybeboard|^commander$/i.test(c));
    const board   = !boarded ? DB_MAIN_BOARD
                  : /^commander$/i.test(boarded) ? DB_COMMANDER_BOARD
                  : /side/i.test(boarded) ? 'side' : 'maybe';
    // Map to our standard categories where the name matches one of ours;
    // otherwise keep Archidekt's own category name as-is (e.g. "Ramp",
    // "Removal" from their community auto-categorize feature) rather than
    // discarding it — '' means let dbAutoCategory fill it in from type.
    let category = '';
    for (const c of rawCats) {
      const mapped = _ARCH_CAT[c.toLowerCase()];
      if (mapped) { category = mapped; break; }
    }
    if (!category && rawCats.length) category = rawCats.find(c => c !== boarded) || '';
    cards.push({ card_name: name, qty, category, board, position: cards.length });
  }
  return cards;
}

// ── Scryfall batch-fetch ──────────────────────────────────────────────────────
async function dbFetchCardData(names) {
  const missing = names.filter(n => !dbCardData.has(n));
  if (!missing.length) return;
  const cards = await fetchCardCollection(missing);
  for (const card of cards) {
    dbCardData.set(card.name, card);
    if (card.card_faces?.[0]?.name) dbCardData.set(card.card_faces[0].name, card);
  }
}

// ── Auto-categorise ───────────────────────────────────────────────────────────
// Archidekt's "auto categories" assign staples like Sol Ring to community-voted
// functional categories (e.g. "Ramp") rather than just their card type — but
// that data is generated from crowd voting inside Archidekt itself and isn't
// exposed by any public API, so it can't be queried live for an arbitrary card.
// This is a best-effort local stand-in covering well-known staples in the same
// spirit; anything not listed here falls back to the normal type-based bucket
// below (and a real Archidekt import already preserves its own categories —
// see _dbImportArchidekt — so decks built there keep their real "Ramp" etc.).
const DB_FUNCTION_CATEGORY = {
  'sol ring': 'Ramp', 'arcane signet': 'Ramp', 'mana crypt': 'Ramp', 'mana vault': 'Ramp',
  'fellwar stone': 'Ramp', 'mind stone': 'Ramp', "wayfarer's bauble": 'Ramp',
  'birds of paradise': 'Ramp', 'llanowar elves': 'Ramp', 'elvish mystic': 'Ramp',
  'sakura-tribe elder': 'Ramp', 'rampant growth': 'Ramp', 'cultivate': 'Ramp',
  "kodama's reach": 'Ramp', 'farseek': 'Ramp', 'three visits': 'Ramp', "nature's lore": 'Ramp',
  'swords to plowshares': 'Removal', 'path to exile': 'Removal', 'beast within': 'Removal',
  'chaos warp': 'Removal', 'generous gift': 'Removal', 'anguished unmaking': 'Removal',
  'vindicate': 'Removal', 'utter end': 'Removal', 'despark': 'Removal', 'pongify': 'Removal',
  'rapid hybridization': 'Removal',
  'cyclonic rift': 'Board Wipe', 'wrath of god': 'Board Wipe', 'damnation': 'Board Wipe',
  'toxic deluge': 'Board Wipe', 'blasphemous act': 'Board Wipe', 'farewell': 'Board Wipe',
  "in garruk's wake": 'Board Wipe', 'austere command': 'Board Wipe',
  'rhystic study': 'Card Draw', 'mystic remora': 'Card Draw', 'phyrexian arena': 'Card Draw',
  'sylvan library': 'Card Draw', 'fact or fiction': 'Card Draw', "night's whisper": 'Card Draw',
  'sign in blood': 'Card Draw', 'guardian project': 'Card Draw',
  'counterspell': 'Counterspell', 'mana drain': 'Counterspell', 'swan song': 'Counterspell',
  'negate': 'Counterspell', 'arcane denial': 'Counterspell', 'force of will': 'Counterspell',
  'demonic tutor': 'Tutor', 'vampiric tutor': 'Tutor', 'mystical tutor': 'Tutor',
  'worldly tutor': 'Tutor', 'enlightened tutor': 'Tutor',
  'eternal witness': 'Recursion', 'regrowth': 'Recursion', 'reveillark': 'Recursion',
  'sun titan': 'Recursion', 'archaeomancer': 'Recursion',
  'heroic intervention': 'Protection', "teferi's protection": 'Protection',
  'swiftfoot boots': 'Protection', 'lightning greaves': 'Protection',
};

/* What pile a card belongs in, which is a question about the card. It no
 * longer answers "Commander" for the deck's commander: where the commander
 * goes is a board and not a pile, and dbAddCard() asks that question one level
 * coarser before it gets here. A commander that ever does land in the deck
 * proper is filed by what it is, like anything else. */
function dbAutoCategory(cardName) {
  const fnCat = DB_FUNCTION_CATEGORY[cardName.toLowerCase()];
  if (fnCat) return fnCat;
  const sf = dbCardData.get(cardName);
  const t  = (sf?.type_line || '').toLowerCase();
  if (t.includes('creature'))             return 'Creatures';
  if (t.includes('planeswalker'))         return 'Planeswalkers';
  if (t.includes('instant'))             return 'Instants';
  if (t.includes('sorcery'))             return 'Sorceries';
  if (t.includes('enchantment'))         return 'Enchantments';
  if (t.includes('artifact'))            return 'Artifacts';
  if (t.includes('battle'))              return 'Battles';
  if (t.includes('land'))               return 'Lands';
  return 'Other';
}

// Ensure the category exists in dbCats (adds it if not)
function dbEnsureCat(name) {
  if (!dbCats.find(c => c.name === name)) {
    dbCats.push({ name, position: dbCats.length });
  }
}

// ── The deck's filter ─────────────────────────────────────────────────────────
/* The box over the mat reads the same query language the Collections search
 * does — js/cardquery.js, Scryfall's syntax run against the card facts this
 * tab already has in hand. It used to be one substring test against name and
 * oracle text, which answers one question; the rest of them ("what am I
 * holding under two mana", "which of these are red") had to be counted by eye.
 *
 * A bare word still means what it has always meant here: name *or* rules text,
 * which is CQ_BARE's `text` and the reason that option exists. Nobody has to
 * learn a language to type "goblin".
 *
 * Compiled once per keystroke rather than per card, which is the parser's own
 * design; a deck is sixty cards, so the running of it is free. */
function dbSetFilter(value) {
  _dbCompileFilter(value);
  dbRender();
}

/* The same, without the repaint, for the moments the mat is about to be drawn
 * anyway — putting one deck down and picking another one up. */
function _dbCompileFilter(value) {
  dbFilterText = String(value || '').trim();
  try {
    dbFilterQuery = parseCardQuery(dbFilterText, { bare: 'text' });
    dbFilterError = '';
  } catch (e) {
    /* Not a query — yet, or at all. `c:pin` is half of `c:pink` and `c:pink`
     * is not a colour; `f:commander` is a filter the local cache cannot
     * answer. Either way the deck goes on being drawn exactly as it was and
     * the mat says why, because a box typed into a character at a time cannot
     * empty the mat between two keystrokes. */
    dbFilterQuery = null;
    dbFilterError = e.message;
  }
  const box = document.getElementById('dbFilterInput');
  if (box) {
    box.classList.toggle('is-invalid', !!dbFilterError);
    box.setAttribute('aria-invalid', dbFilterError ? 'true' : 'false');
  }
}

/* A card as js/cardquery.js wants to see one: the name off the mat, and the
 * card's facts out of this tab's cache in the one shape the app keeps them in
 * — cardMetaOf()'s, which is what the sort and the metadata columns read too.
 * A card whose data has not arrived yet is an empty card: it answers about its
 * own name and honestly nothing else.
 *
 * `owned` is the one field on here that is not a fact about the card at all —
 * it is a fact about our collections, which is why `is:owned` waited for the
 * ownership work to land before it could be answered. It is asked of the *row*
 * rather than of the name, so a deck asking for four Forests with two on the
 * shelf does not read as owned. js/deckview-owned.js says what the shelf is. */
function dbQueryCard(card) {
  const sf = dbCardData.get(card.card_name);
  return {
    name: card.card_name,
    ...(sf ? cardMetaOf(sf) : {}),
    owned: dbShortOf(card) === 0,
  };
}

/* Which cards the mat draws, which is two questions and not one: what is in
 * the filter box, and which of the ownership chips is pressed. Both are off by
 * default and neither ever reaches outside the deck — a card the mat is not
 * drawing is still in the deck, still counted and still exported. */
function _dbMatchesFilter(card) {
  if (!dbOwnChipShows(card)) return false;
  if (!dbFilterQuery) return true;   // an empty box, or one that means nothing yet
  return dbFilterQuery.match(dbQueryCard(card));
}
