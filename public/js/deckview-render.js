// ── Deck Builder — Render & stats ─────────────────────────────────────────
// Split from the former monolithic deckview.js. All deck-builder scripts share
// one global scope (classic scripts), so state declared in deckview-core.js is
// visible here and functions stay global for inline onclick handlers.

// ── Render ────────────────────────────────────────────────────────────────────
/* The mat animates its own re-renders. Every caller below — a quantity
 * changing, a sort, a rename, a move, a selection — already calls dbRender(),
 * so wrapping it here is what makes all of them animate rather than the ones
 * someone remembered to. js/cardmove.js does the measuring; what this file
 * owes it is _dbMoves() on everything that has a place on the mat, and a
 * render that can be handed over whole. */
function dbRender() {
  if (!dbDeck) return;
  animateCardMove(document.getElementById('dbDeckContent'), _dbPaint);
}

/* What a thing on the mat is, as one string, so that it can be recognised
 * across a rebuild that shares no elements with the one before it. A card is
 * its ref — board and name, because a card in the deck and the same card in
 * the maybeboard are two things on the mat and moving one must not animate the
 * other — and a settled stack is its category, said differently so that a
 * category and a card that happen to share a name are not taken for each
 * other. */
function _dbMoves(kind, name) {
  return `data-moves="${esc(kind)}:${esc(name)}"`;
}

/* A card that can be picked up, said the way js/carddrag.js reads it: the
   value is the card, and carrying it somewhere is what the attribute means.
   It replaces the browser's draggable="true" and the three inline handlers
   that went with it — a card is carried now rather than dragged. */
function _dbCarry(ref, canEdit) {
  return canEdit ? `data-carry="${esc(ref)}"` : '';
}

/* The card that has just been put down, for the one render that draws it in
   its new pile. It arrives there travelling — js/cardmove.js is measuring the
   mat around this render, and a carried card is measured in the hand it was
   released from — and this is what gives that one journey the overshoot of
   something landing rather than the ease of something sliding. */
function _dbLanded(ref) {
  return _dbLandedCards?.has(ref) ? ' card-landed' : '';
}

function _dbPaint() {
  // Rebuilding the deck list (and the bulk-action bar above it) can shift
  // page height enough to scroll the cards you're looking at out from under
  // the cursor. Freeze the scroll position across the rebuild so it doesn't.
  const _scroller  = document.scrollingElement || document.documentElement;
  const _scrollTop = _scroller.scrollTop;

  const cmp = cardComparator(
    getSortChain('deckbuild', { field: 'name', dir: 1 }, DB_SORT_FIELDS).criteria);

  // Drop selections for cards no longer in the deck (removed/deleted elsewhere)
  for (const ref of [...dbSelectedCards]) {
    if (!dbFindCard(ref)) dbSelectedCards.delete(ref);
  }

  /* Group cards by category, preserving cat order. The mainboard only: the
     categories are the deck's, and a card set aside in another board keeps the
     category it was filed under without drawing a pile on the mat for it.

     Grouped before the filter runs rather than after, so that a category is
     the deck's piles and not the search's — see below, where the two counts
     are what decide whether an emptied pile stays on the mat. */
  const groups = new Map(dbCats.map(c => [c.name, []]));
  for (const card of dbMainCards()) {
    const cat = card.category || dbAutoCategory(card.card_name);
    if (!groups.has(cat)) { dbEnsureCat(cat); groups.set(cat, []); }
    groups.get(cat).push(card);
  }

  // Sort within each group
  for (const [, arr] of groups) arr.sort(_dbSortCards(cmp));

  /* A category the deck no longer has is not a settled pile — it is a label
     nothing answers to, and a name that comes back comes back as a new pile,
     spread like every other. Against dbCats rather than against the sections
     actually drawn: a category the search has emptied is still a category of
     this deck, and clearing the search should find it lying the way it was
     left rather than sprung open. */
  forgetGonePiles(dbSettledCats, dbCats.map(cat => ({ label: cat.name })));

  const canEdit = isMyPlayer(dbDeck.playerId);

  /* Each of the deck's categories, and which of its cards the filter is
     showing. A pile with nothing in it is a header and a gap — but a pile the
     *filter* emptied is a different fact and stays on the mat, because a
     header that disappears mid-search reads as a category somebody deleted,
     and because knowing this deck has nine creatures and none of them red is
     the answer to what was typed.

     The exception is a search that matched nothing anywhere: nine empty
     headers say the same thing nine times, and one sentence says it once. */
  const piles = dbCats.map(cat => {
    const all = groups.get(cat.name) || [];
    return { name: cat.name, all, cards: all.filter(c => _dbMatchesFilter(c)) };
  });
  const anyShown = piles.some(p => p.cards.length);

  const sections = [];
  for (const pile of piles) {
    if (!pile.all.length) continue;
    if (!pile.cards.length && !anyShown) continue;
    sections.push(_dbRenderSection(pile.name, pile.cards, canEdit,
      pile.all.reduce((s, c) => s + (c.qty || 1), 0)));
  }

  /* The boards, in the order DB_BOARDS lists them, and on the side of the deck
     their flag puts them: a head board is the head of the deck and is drawn
     before its categories, the rest lie beside it and are drawn after.

     Drawn whether or not they are showing — a board that is off is hidden by
     the stylesheet, which is what lets it reveal itself while a card is in
     hand without the mat being rebuilt mid-carry. Somebody else's deck grows
     no region for a board it has nothing in: there is nothing to look at and
     nothing to drop. */
  const drawn = DB_BOARDS
    .filter(b => b.id !== DB_MAIN_BOARD)
    .filter(b => canEdit || dbShownBoards.has(b.id) || dbBoardCards(b.id).length)
    .map(b => ({ head: !!b.head, html: _dbRenderBoard(b,
      dbBoardCards(b.id).filter(c => _dbMatchesFilter(c)).sort(_dbSortCards(cmp)),
      canEdit) }));
  const head   = drawn.filter(b => b.head).map(b => b.html).join('');
  const beside = drawn.filter(b => !b.head).map(b => b.html).join('');

  const _dbContent = document.getElementById('dbDeckContent');
  const emptyMsg = dbFilterText
    ? 'No cards match your search'
    : 'No cards yet';
  /* A filter that cannot mean anything is said where the cards are, and the
     deck goes on being drawn below it unfiltered: the message names the filter
     it choked on, which is the whole reason the parser refuses `f:commander`
     by name rather than quietly matching nothing. */
  const filterMsg = dbFilterError
    ? `<div class="db-filter-error">${esc(dbFilterError)}${CQ_SYNTAX_HELP}</div>`
    : '';
  _dbContent.innerHTML = filterMsg + head
    + (sections.length ? sections.join('') : `<div class="empty-state" style="padding:var(--space-6) var(--space-4)">${esc(emptyMsg)}</div>`)
    + (canEdit ? _dbGhostPileHtml() : '')
    + beside;
  _dbContent.classList.toggle('db-pile-layout', dbView === 'pile');
  /* Each pile put down where the one above it ended, rather than in a row as
     tall as the tallest category on it — js/cardstack.js, the same pass the
     browsing tabs' tables of piles get. Here rather than after the paint,
     because the mat is measured twice around this function for the movement
     (js/cardmove.js) and the second reading has to be of piles that are where
     they are going to be. Before the scroll is put back, for the same reason:
     laying the piles out is what decides how tall the mat is. */
  if (dbView === 'pile') layOutPiles(_dbContent);
  else clearPileLayout(_dbContent);

  _dbRenderBulkBar();

  /* The name of a pile that has just been made, ready to be typed over. Asked
   * for here because this is the render that drew the box: the box is made
   * fresh by every paint, so focus has to be put back on it by every paint.
   * Without scrolling, for the reason the scroll position is frozen above — a
   * mat that jumps is a mat that has moved the cards you were looking at. */
  if (_dbNamingCat) {
    const input = document.getElementById('dbCatNameInput');
    input?.focus({ preventScroll: true });
    input?.select();
  }

  _scroller.scrollTop = _scrollTop;
}

// ── Multiselect → bulk move ─────────────────────────────────────────────────
// Clicking a card row/tile selects it (desktop click or mobile tap). What can
// be *done* to a card is asked for rather than hung on it: right-click, or a
// finger held on it, opens the card menu below.
let _dbLongPressTimer = null;
let _dbLongPressFired = false;
const DB_LONG_PRESS_MS = 500;

/* Where the finger is, so that a menu it asks for opens under it. Read at the
 * start of the press rather than at the end of it: the point that matters is
 * where the finger came down, and a touch that has moved has cancelled the
 * press anyway. */
function dbTouchStart(e, ref) {
  _dbLongPressFired = false;
  const touch = e.touches && e.touches[0];
  const at = { x: touch ? touch.clientX : 0, y: touch ? touch.clientY : 0 };
  clearTimeout(_dbLongPressTimer);
  _dbLongPressTimer = setTimeout(() => {
    _dbLongPressFired = true;
    dbOpenCardMenu(at.x, at.y, ref);
  }, DB_LONG_PRESS_MS);
}

function dbTouchMove() { clearTimeout(_dbLongPressTimer); }
function dbTouchEnd()  { clearTimeout(_dbLongPressTimer); }

// preventDefault here also suppresses the global .card-link → openCardByName
// click routing (it checks e.defaultPrevented), so the name text inside the
// row/tile can keep the .card-link class (for the hover-preview tooltip)
// without also opening the info popup on a plain click.
function dbCardClick(e, ref) {
  e.preventDefault();
  if (_dbLongPressFired) { _dbLongPressFired = false; return; }
  dbToggleSelectCard(e, ref);
}

function _dbCardClickAttrs(ref) {
  const r = jsAttr(ref);
  return `onclick="dbCardClick(event,'${r}')" ontouchstart="dbTouchStart(event,'${r}')" ontouchmove="dbTouchMove()" ontouchend="dbTouchEnd()"`;
}

function dbToggleSelectCard(event, ref) {
  event.stopPropagation();
  if (dbSelectedCards.has(ref)) dbSelectedCards.delete(ref);
  else dbSelectedCards.add(ref);
  dbRender();
}

function dbClearSelection() {
  dbSelectedCards.clear();
  dbRender();
}

/* Ctrl/Cmd-A — select every card currently visible (respects the search
   filter). Visible is the word: a card in a board nobody has switched on is
   not on the mat, and selecting what cannot be seen is how a bulk move takes
   twenty cards you had forgotten about with it.

   A head board is left out even when it is showing. Select-all is the first
   half of a bulk move, and the commander is not something a sweep over the
   deck should be able to file into Lands — it is moved deliberately, from its
   own card menu, or it is not moved at all. */
function dbSelectAllVisible() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  const heads = new Set(DB_BOARDS.filter(b => b.head).map(b => b.id));
  for (const card of dbCards) {
    const board = card.board || DB_MAIN_BOARD;
    if (heads.has(board)) continue;
    if (board !== DB_MAIN_BOARD && !dbShownBoards.has(board)) continue;
    if (_dbMatchesFilter(card)) dbSelectedCards.add(dbCardRef(card));
  }
  dbRender();
}

// Select every (visible) card in one category, via the category header menu
function dbSelectCategory(catName) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  for (const card of dbMainCards()) {
    const cat = card.category || dbAutoCategory(card.card_name);
    if (cat === catName && _dbMatchesFilter(card)) dbSelectedCards.add(dbCardRef(card));
  }
  dbRender();
}

// ── What can be done to a card ───────────────────────────────────────────────
// A card's actions used to hang off the card: a ⓘ in one corner of the picture
// and a ⇄ and a × in the other, appearing when the pointer arrived. They are a
// menu now, asked for by right-clicking the card or holding a finger on it.
//
// Three reasons, in the order they were noticed. The ⓘ was unreachable: a card
// under the pointer is lifted, and js/cardlift.js raises the picture above the
// furniture lying on it, so the one button you had to point at to reach was
// the one the pointing hid. A hover-reveal control is also a control a finger
// cannot find, and the long-press that stood in for it could only ever reach
// one of the three. And a card is a card — the picture is the thing, and three
// buttons floating on it are the tile the redesign is taking apart.
//
// What is *on* a card is what a card has: its name, its price, how many you
// own. What can be done to it is a question, and this is where it is answered.
// The list view keeps its own row of buttons: a row is not a picture, nothing
// is lifted over it, and a line of small controls is what a table is for.

/* Which card a point on the mat is on, from what the mat already says about
   itself. js/cardmove.js's data-moves names everything on the mat as
   "kind:name" so that it can be recognised across a rebuild, and a card is the
   one kind that has anything to answer here — a settled stack stands for a
   category and is the arrow's business, not a card's. */
function _dbCardAt(target) {
  const el = target && target.closest ? target.closest('[data-moves^="card:"]') : null;
  return el ? el.dataset.moves.replace(/^card:/, '') : null;
}

/* Where a menu asked for at a point on the screen is drawn, given how big it
 * is and how big the window is.
 *
 * At the point, so that it opens out of the card that was asked about — but
 * never over an edge: a menu asked for near the bottom of the window opens
 * upwards from the point instead, the way a menu asked for near the right
 * opens leftwards, because a menu you have to scroll to is not an answer. A
 * menu bigger than the window it is in has nowhere to flip to and is put in
 * the corner, which is the one place it can be. */
function dbMenuPlacement(point, menu, view, gap = 4) {
  const along = (at, size, limit) => {
    const past = at + size + gap > limit;
    return Math.max(gap, Math.min(past ? at - size : at, limit - size - gap));
  };
  return {
    left: along(point.x, menu.width,  view.width),
    top:  along(point.y, menu.height, view.height),
  };
}

/* What may be done to this card, as the entries that say so. The items are
   written each time rather than shown and hidden, because what can be done to a
   card depends on whose deck it is: anybody may look a card up, and only the
   deck's owner may move or remove one.

   A function of what it is handed and nothing else — no deck is read here — so
   that the one question worth asking about a menu can be asked without a
   browser: given a card in this situation, what is on it? The ref and the name
   arrive already written for a script attribute; escaping is the caller's,
   which is where the card was looked up.

   The two counting entries are why this is a menu and not a list of verbs. How
   many the deck runs of a card has been a pair of buttons in the list view
   since the beginning, and the two views that draw a card as a picture had
   nothing: there the count is printed on the artwork, and a number on a card is
   something to read rather than something to press. So it is asked for here,
   from the menu everything else about a card is asked from, and it lands in the
   same dbChangeQty() those buttons call.

   Neither is offered on the commander board — that board holds the card the
   deck is built around, and a deck does not run two of those — and taking one
   away is not offered at a single copy: there is no copy to take, only the
   card, and × Remove at the foot of the menu is already that. Left out rather
   than greyed out, the way every other entry here that does not apply is. */
function dbCardMenuItems({ ref, name, canEdit, isCommander, canPartner, qty }) {
  return `
    <button class="col-menu-item" onclick="dbCloseCardMenu();openCardByName('${name}')">ⓘ Inspect</button>
    ${canEdit ? `
    ${isCommander ? '' : `
    <button class="col-menu-item" onclick="dbCloseCardMenu();dbChangeQty('${ref}', 1)">＋ Add a copy</button>
    ${(qty || 1) < 2 ? '' :
    `<button class="col-menu-item" onclick="dbCloseCardMenu();dbChangeQty('${ref}', -1)">− Remove a copy</button>`}`}
    <button class="col-menu-item" onclick="dbCloseCardMenu();dbShowMoveCard('${ref}')">⇄ Move to…</button>
    ${isCommander ? '' :
    `<button class="col-menu-item" onclick="dbCloseCardMenu();dbMakeCommander('${ref}')"
       title="Build the deck around this card — whatever is on the commander board goes back into the deck">♛ Make commander</button>`}
    ${!canPartner ? '' :
    `<button class="col-menu-item" onclick="dbCloseCardMenu();dbAddPartner('${ref}')"
       title="Run this card as a second commander alongside the one you have — Partner, a Background, a Doctor’s companion">♛ Add as partner</button>`}
    <button class="col-menu-item db-menu-danger" onclick="dbCloseCardMenu();dbRemoveCard('${ref}')">× Remove</button>` : ''}`;
}

/* Open it on a card. Opened before it is placed, since a menu that is not being
   displayed has no size to place. */
function dbOpenCardMenu(x, y, ref) {
  const menu = document.getElementById('dbCardMenu');
  if (!menu || !dbDeck) return;
  const held = dbReadRef(ref);
  menu.innerHTML = dbCardMenuItems({
    ref: jsAttr(ref),
    /* Looking a card up is a question about the card; everything else is about
       this copy of it, which is why one takes the name and the others take the
       ref. */
    name: jsAttr(held.name),
    canEdit: isMyPlayer(dbDeck.playerId),
    /* Nothing to offer a card that is already the commander: making a commander
       is how a deck is switched to a different one, and switching to the card
       you are pointing at is not a change. Going the other way is Move to…,
       which every card on every board has. */
    isCommander: held.board === DB_COMMANDER_BOARD,
    /* A partner is offered only alongside a commander there already is. With
       none, adding a partner is making a commander and that entry says so; with
       two, there is no third to add. */
    canPartner: held.board !== DB_COMMANDER_BOARD && dbCommanderCards().length === 1,
    qty: dbFindCard(ref)?.qty || 1,
  });
  menu.classList.add('open');
  const box = menu.getBoundingClientRect();
  const at  = dbMenuPlacement({ x, y }, { width: box.width, height: box.height },
                              { width: window.innerWidth, height: window.innerHeight });
  menu.style.left = `${at.left}px`;
  menu.style.top  = `${at.top}px`;
}

function dbCloseCardMenu() {
  document.getElementById('dbCardMenu')?.classList.remove('open');
}

// ── Category header "⋯" menu ─────────────────────────────────────────────────
function dbToggleCatMenu(e) {
  e.stopPropagation();
  const wrap = e.currentTarget.closest('.db-cat-kebab-wrap');
  const menu = wrap?.querySelector('.db-cat-menu');
  const wasOpen = menu?.classList.contains('open');
  dbCloseCatMenus();
  if (menu && !wasOpen) menu.classList.add('open');
}

function dbCloseCatMenus() {
  document.querySelectorAll('.db-cat-menu.open').forEach(m => m.classList.remove('open'));
}

function _dbRenderBulkBar() {
  const bar = document.getElementById('dbBulkBar');
  if (!bar) return;
  if (!dbSelectedCards.size) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  const n = dbSelectedCards.size;
  document.getElementById('dbBulkCount').textContent = `${n} card${n === 1 ? '' : 's'} selected`;
}

// Shared "Auto-categorize" entry shown atop the move modal — sorts the
// card(s) into a category via dbAutoCategory — known staples go to their
// functional category (e.g. Sol Ring → Ramp), everything else by card type
// (Creatures, Instants, Sorceries, etc.), creating any missing category.
function _dbAutoCatButtonHtml() {
  return `<button class="btn-primary" style="text-align:left" onclick="dbAutoCategorizeMove()"
       title="Known staples go to a functional category like Ramp or Removal; everything else by card type">
       ✨ Auto-categorize</button>
    <div style="border-top:1px solid var(--border);margin:var(--space-1) 0"></div>`;
}

/* Filing cards by what they are, which is a question about the card and not
   about where it is lying: a card in the maybeboard is auto-categorised where
   it lies, ready for the pile it will land in if it is ever promoted. */
function dbAutoCategorizeMove() {
  const refs = _dbBulkMoveMode ? [...dbSelectedCards] : (_dbMovingCard ? [_dbMovingCard] : []);
  if (!refs.length) return dbHideMoveCard();
  for (const ref of refs) {
    const card = dbFindCard(ref);
    if (!card) continue;
    const cat = dbAutoCategory(card.card_name);
    dbEnsureCat(cat);
    card.category = cat;
  }
  if (_dbBulkMoveMode) dbSelectedCards.clear();
  dbHideMoveCard();
  dbRender();
  _dbScheduleSave();
}

function dbBulkMove() {
  if (!dbSelectedCards.size) return;
  _dbMovingCard   = null;
  _dbBulkMoveMode = true;
  const n = dbSelectedCards.size;
  document.getElementById('dbMoveCardTitle').textContent = `Move ${n} card${n === 1 ? '' : 's'} to…`;
  const list = document.getElementById('dbMoveCatList');
  /* No board is the one the selection came from — a handful can be gathered
     from several — so the boards are offered plain. */
  list.innerHTML = _dbAutoCatButtonHtml() + _dbMoveBoardsHtml(null) + dbCats.map(c =>
    `<button class="btn-secondary" style="text-align:left"
       onclick="dbConfirmMoveCard('${jsAttr(dbPlace(DB_MAIN_BOARD, c.name))}')">${esc(c.name)}</button>`
  ).join('');
  const newCatInput = document.getElementById('dbMoveNewCatInput');
  if (newCatInput) newCatInput.value = '';
  document.getElementById('dbMoveCardOverlay').style.display = 'flex';
}

/* The ghost pile — an empty outline after the last category, faint at rest and
 * lit while a card is being carried. Drop on it and it becomes a real category
 * with those cards in it, named in place.
 *
 * **Permanent is the point.** The affordance is on the mat when your hands are
 * empty, so making a category by hand is something that can be found rather
 * than stumbled into — and it is on the mat rather than in the toolbar,
 * because a drop target inside chrome that folds away is a drop target that
 * cannot be reached.
 *
 * It is not a button. A click on it would have to make an empty category, and
 * an empty category is not drawn — it would be a press with nothing to show
 * for it. Making one from the keyboard is what the New category field below
 * the mat is for, and it is a field, so it works with a finger too. */
function _dbGhostPileHtml() {
  return `<div class="db-ghost" data-drop="${esc(dbPlace(DB_MAIN_BOARD, DB_GHOST_PILE))}"
    title="Drop cards here to start a new category">
    <span class="db-ghost-label">New category</span>
  </div>`;
}

/* How the cards inside one pile are ordered — the tab's sort, over whatever
 * this app knows about each card. One function because two things are sorted
 * now, the deck's categories and the boards beside them, and a board sorted
 * differently from the piles above it would be a second answer to a question
 * the strip's sort control has already asked. */
function _dbSortCards(cmp) {
  return (a, b) => cmp(
    dbCardData.get(a.card_name) || { name: a.card_name },
    dbCardData.get(b.card_name) || { name: b.card_name }
  );
}

/* A board, drawn flat: one region, one count, and no category headers.
 *
 * A maybeboard is a holding area and not a second deck — giving it ten headers
 * to scroll past is exactly what makes somewhere-to-put-things not worth
 * having, and the frame this all sits in exists to fight that kind of vertical
 * spend. So the cards are drawn the way the view draws cards and nothing else
 * is: no collapse, no settle, no ⋯ menu.
 *
 * Each card keeps the category it was filed under while it lies here, which is
 * why nothing here writes one. It is what makes promoting a card land it in a
 * pile rather than in "Other".
 *
 * The region is a place cards can be put down, and the place is the board
 * itself — a place with no slash in it. Which is also what says "keep your
 * category": there is no category in the answer to change it to. */
function _dbRenderBoard(board, cards, canEdit) {
  const count  = cards.reduce((s, c) => s + (c.qty || 1), 0);
  const off    = !dbShownBoards.has(board.id);
  const drop   = canEdit ? `data-drop="${esc(dbPlace(board.id, null))}"` : '';
  const fanned = dbView === 'pile';

  let cardsHtml;
  if (!cards.length) {
    cardsHtml = `<div class="db-board-empty">${esc(board.hint || 'Nothing here yet')}</div>`;
  } else if (dbView === 'list') {
    cardsHtml = `<div class="dv-list">${cards.map(c => _dbListRow(c, canEdit)).join('')}</div>`;
  } else if (dbView === 'pile') {
    /* Always spread. A board is one pile of cards lying to one side of the
       table, and settling it into a stack would be hiding the one thing the
       region is for. */
    cardsHtml = `<div class="db-pile card-fan">${cards.map(c => _dbPileTile(c, canEdit)).join('')}</div>`;
  } else {
    cardsHtml = `<div class="sf-grid">${cards.map(c => _dbGridTile(c, canEdit)).join('')}</div>`;
  }

  return `<div class="dv-section db-board${board.head ? ' db-board-head' : ''}${off ? ' db-board-off' : ''}${fanned ? ' db-pile-open' : ''}"
    data-board="${esc(board.id)}" ${drop}>
    <div class="dv-section-hdr db-board-hdr">
      <span class="dv-section-title">${esc(board.label)}</span>
      <span class="dv-section-count">${count}</span>
    </div>
    ${cardsHtml}
  </div>`;
}

/* `inDeck` is how many cards the category holds before the filter, counted the
 * way the header counts them. It is read only when the filter has emptied the
 * pile, which is the one thing the cards this was handed cannot say. */
function _dbRenderSection(catName, cards, canEdit, inDeck = 0) {
  const count = cards.reduce((s, c) => s + (c.qty || 1), 0);
  /* Not in pile view, where the header spreads the pile rather than hiding it:
   * a category collapsed in the list view and then looked at as a stack would
   * be a stack that was not drawn, with the one control that could bring it
   * back now doing something else. Kept rather than cleared, so that going
   * back to the list finds it folded away where you left it. */
  const collapsed = dbView !== 'pile' && dbCollapsedCats.has(catName);
  const catActions = canEdit ? `
    <div class="db-cat-kebab-wrap">
      <button class="db-cat-btn" title="Category actions" onclick="dbToggleCatMenu(event)">⋯</button>
      <div class="col-menu db-cat-menu">
        <button class="col-menu-item" onclick="dbCloseCatMenus();dbSelectCategory('${jsAttr(catName)}')">Select all</button>
        <button class="col-menu-item" onclick="dbCloseCatMenus();dbShowRenameCat('${jsAttr(catName)}')">Rename</button>
        <button class="col-menu-item db-menu-danger" onclick="dbCloseCatMenus();dbDeleteCategory('${jsAttr(catName)}')">Delete</button>
      </div>
    </div>` : '';

  /* A place a card can be put down, and what putting it there means: this
     category, on the mainboard. js/carddrag.js reads nothing else from the mat
     — it hit-tests the pointer against these boxes and hands the answer back
     through cardCarryDrop(). A category is a mainboard thing, so a card
     carried out of a board onto one is a card being promoted into the deck. */
  const dropAttrs = canEdit ? `data-drop="${esc(dbPlace(DB_MAIN_BOARD, catName))}"` : '';

  /* A pile made by dropping a card on the ghost is named where it lies, in the
   * heading it has just been given, rather than in a modal over the mat you
   * were just working on. Until it is named the heading is the box; after it,
   * it is a heading like any other. */
  const naming = catName === _dbNamingCat;
  const titleEl = naming
    ? `<input class="db-cat-name" id="dbCatNameInput" value="${esc(catName)}"
        aria-label="Name this category" onclick="event.stopPropagation()"
        onkeydown="dbCatNameKey(event)" onblur="dbCommitCatName(this)">`
    : `<span class="dv-section-title">${esc(catName)}</span>`;

  const fanned = dbView === 'pile' && !dbSettledCats.has(catName);
  let cardsHtml;
  if (!cards.length) {
    /* Filtered to nothing. The header stays — this is still one of the deck's
       piles, and it is still somewhere a card can be dropped — and the gap
       under it says what the filter did rather than leaving it to be inferred
       from a heading with nothing beneath it. */
    cardsHtml = `<div class="db-cat-filtered">${
      inDeck === 1 ? 'Its one card doesn’t match' : `None of its ${inDeck} cards match`}</div>`;
  } else if (dbView === 'list') {
    cardsHtml = `<div class="dv-list">${cards.map(c => _dbListRow(c, canEdit)).join('')}</div>`;
  } else if (dbView === 'pile') {
    /* Fanned out, a category is a fan — the spread components.css draws for
       every tab that has one. Settled, it is a single stack and needs none of
       it. */
    cardsHtml = `<div class="db-pile${fanned ? ' card-fan' : ''}">${_dbStackHtml(catName, cards, canEdit, fanned)}</div>`;
  } else {
    cardsHtml = `<div class="sf-grid">${cards.map(c => _dbGridTile(c, canEdit)).join('')}</div>`;
  }

  /* The chevron, the name and the count are one control drawn as three pieces:
   * all three fold the category, so .dv-section-fold is where the click lives
   * and none of them carries a handler of its own. It used to be two — a
   * handler on the arrow and another on the name — and on a phone each of them
   * wanted an invisible 44px pad in an eight-pixel gutter, so the pads
   * overlapped and the arrow lost half of its own target to the name beside
   * it. tabs.css says the rest.
   *
   * The "⋯" menu stays outside the fold, because it is a different action and
   * because a control nested inside a control is one target as far as
   * scripts/measure-mobile.js is concerned — folding it in would have hidden
   * it from the measurement rather than sized it. */
  return `<div class="dv-section${collapsed ? ' collapsed' : ''}${fanned ? ' db-pile-open' : ''}"
    data-cat="${esc(catName)}" ${dropAttrs}>
    <div class="dv-section-hdr">
      <div class="dv-section-fold db-collapsible" onclick="dbToggleCat('${jsAttr(catName)}')">
        ${pileToggleHtml(dbView === 'pile' ? fanned : !collapsed, {
          title: dbView === 'pile'
            ? (fanned ? `Settle ${catName}` : `Spread ${catName} out`)
            : (collapsed ? 'Show these cards' : 'Hide these cards'),
        })}
        ${titleEl}
        <span class="dv-section-count">${count}</span>
      </div>
      <span class="db-cat-actions">${catActions}</span>
    </div>
    ${cardsHtml}
  </div>`;
}

function _dbListRow(card, canEdit) {
  const sf    = dbCardData.get(card.card_name);
  const face  = sf?.card_faces?.[0];
  const mana  = sf?.mana_cost || face?.mana_cost || '';
  const type  = sf?.type_line || face?.type_line || '';
  /* Not sfCardOwnership(), which walks every collection that happens to be
     loaded: on this tab the badge answers whichever of the three questions the
     strip is asking — see js/deckview-owned.js. */
  const owned = dbCardOwnership(card.card_name);
  const price = renderPrice(sf);
  /* Which row on the mat this is, board and all: the buttons on it act on this
     copy of the card and not on the one lying in another board. */
  const ref   = dbCardRef(card);
  const r     = jsAttr(ref);
  const selected = dbSelectedCards.has(ref);
  const infoEl  = `<button class="db-row-btn" title="Card info" onclick="event.stopPropagation();openCardByName('${jsAttr(card.card_name)}')">ⓘ</button>`;
  const moveBtn = canEdit
    ? `<button class="db-row-btn" title="Move to…" onclick="event.stopPropagation();dbShowMoveCard('${r}')">⇄</button>` : '';
  const delBtn = canEdit
    ? `<button class="db-row-btn db-row-del" title="Remove" onclick="event.stopPropagation();dbRemoveCard('${r}')">×</button>` : '';
  const qtyEl = canEdit
    ? `<span class="db-qty-wrap">
        <button class="db-qty-btn" onclick="event.stopPropagation();dbChangeQty('${r}',-1)">−</button>
        <span class="dv-qty">×${card.qty || 1}</span>
        <button class="db-qty-btn" onclick="event.stopPropagation();dbChangeQty('${r}',1)">+</button>
       </span>`
    : `<span class="dv-qty">×${card.qty || 1}</span>`;

  const clickAttrs = canEdit ? _dbCardClickAttrs(ref) : '';

  return `<div class="dv-row${selected ? ' db-row-selected' : ''}${_dbLanded(ref)}"
    ${_dbMoves('card', ref)} ${_dbCarry(ref, canEdit)} ${clickAttrs}>
    ${infoEl}
    ${qtyEl}
    <a class="dv-name card-link" href="#" data-name="${esc(card.card_name)}"
      >${esc(card.card_name)}</a>
    ${mana ? `<span class="dv-mana">${renderMana(mana)}</span>` : '<span class="dv-mana"></span>'}
    <span class="dv-type">${esc(type)}</span>
    <span class="dv-price">${price}</span>
    <span class="dv-own">${owned || ''}</span>
    <span class="db-row-actions">${moveBtn}${delBtn}</span>
  </div>`;
}

function _dbGridTile(card, canEdit) {
  const sf    = dbCardData.get(card.card_name);
  const face  = sf?.card_faces?.[0];
  const img   = sf?.image_uris?.normal || face?.image_uris?.normal || '';
  const owned = dbCardOwnership(card.card_name);
  const price = renderPrice(sf);
  const ref = dbCardRef(card);
  const selected = dbSelectedCards.has(ref);
  /* No buttons on the picture: what can be done to this card is the card
     menu's answer, and it is asked for by right-clicking the card. */
  const clickAttrs = canEdit ? _dbCardClickAttrs(ref) : '';
  return `<div class="sf-card-lg db-tile${selected ? ' db-tile-selected' : ''}${_dbLanded(ref)}"
    ${_dbMoves('card', ref)} ${_dbCarry(ref, canEdit)} ${clickAttrs}>
    <div data-name="${esc(card.card_name)}">
      ${img ? `<img class="sf-card-lg-img card-img" src="${img}" loading="lazy" alt="${esc(card.card_name)}">` :
              `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
    </div>
    <div class="sf-card-lg-footer">
      <div style="display:flex;align-items:center;gap:var(--space-1);margin-bottom:var(--space-1)">
        <a class="sf-card-lg-name card-link" href="#" data-name="${esc(card.card_name)}"
           style="flex:1;margin-bottom:0">${esc(card.card_name)}</a>
        ${card.qty > 1 ? `<span style="font-size:var(--text-xs);font-weight:700;color:var(--text-muted)">×${card.qty}</span>` : ''}
        ${price}
      </div>
      <div class="sf-card-lg-badges">${owned || '<span class="sf-not-owned">—</span>'}</div>
    </div>
  </div>`;
}

// ── Pile view: a category is a stack of cards ────────────────────────────────
// A category settles into a stack — the face card with the edges of the cards
// beneath it showing, and its count under them — and clicking it fans that
// stack out into the pile it used to always be, where every card can be seen
// and acted on. Clicking away settles it again: a stack is a way of tidying
// the mat, not a way of hiding cards, so inspection is a state you fall out of
// rather than a mode you have to leave.
//
// js/cardstack.js draws the settled stack, and draws it for Collections and
// the Set Browser too. What is here is what a category is: which card is the
// face (the first in the current sort), what the count counts (copies, not
// rows) and what clicking one means.
function _dbCardImg(name) {
  const sf = dbCardData.get(name);
  return sf?.image_uris?.normal || sf?.card_faces?.[0]?.image_uris?.normal || '';
}

function _dbStackHtml(catName, cards, canEdit, fanned) {
  if (!cards.length) return '';
  if (fanned) return cards.map(c => _dbPileTile(c, canEdit)).join('');
  /* A settled stack is the one thing on the mat that is not a card: it stands
   * for a whole category, so it is what moves when a category is deleted or
   * another one is fanned out beside it. */
  return cardStackHtml(
    cards.map(c => ({ name: c.card_name, img: _dbCardImg(c.card_name) })),
    { count: cards.reduce((sum, c) => sum + (c.qty || 1), 0),
      attrs: _dbMoves('stack', catName) }
  );
}

/* The other way to spread a pile: reaching for the stack itself, which is the
 * gesture the mat had before it had an arrow. One listener rather than a
 * handler per stack, because the mat is rebuilt on every change.
 *
 * Only ever opens. Settling is the arrow's, and it is the arrow's alone —
 * clicking somewhere else no longer tidies the mat, because that would be one
 * stray click undoing an arrangement somebody made on purpose. There is
 * nothing to guard against a click on a spread pile here: a spread pile draws
 * no stack, so there is no .card-stack under the pointer to have hit. */
function dbStackClick(e) {
  if (dbView !== 'pile' || !dbDeck) return;
  if (!e.target.closest('.card-stack')) return;
  const cat = e.target.closest('.dv-section')?.dataset.cat ?? null;
  if (cat === null || !dbSettledCats.has(cat)) return;
  dbSettledCats.delete(cat);
  dbRender();
}

/* One card in a fanned-out stack. It lies at the angle its name gives it, the
 * same angle its edge had while the stack was settled, so fanning a stack out
 * spreads the pile that was there rather than replacing it with a tidy one. */
function _dbPileTile(card, canEdit) {
  const img  = _dbCardImg(card.card_name);
  const ref  = dbCardRef(card);
  const selected = dbSelectedCards.has(ref);
  /* As the grid's tile: the picture is the card, and what can be done to it is
     asked for rather than drawn on it. A fanned pile leaves only the top of
     each card showing, which is where the buttons were and where the least
     room for them is. */
  const clickAttrs = canEdit ? _dbCardClickAttrs(ref) : '';
  return `<div class="db-pile-card${selected ? ' db-tile-selected' : ''}${_dbLanded(ref)}"
    style="--stack-turn:${stackJitter(card.card_name)}deg"
    ${_dbMoves('card', ref)} ${_dbCarry(ref, canEdit)} ${clickAttrs}>
    ${(card.qty || 1) > 1 ? `<span class="db-pile-qty">×${card.qty}</span>` : ''}
    <div data-name="${esc(card.card_name)}">
      ${img ? `<img class="card-img" src="${img}" loading="lazy" alt="${esc(card.card_name)}">` :
              /* Artwork that is missing is a surface and not a card, which is
                 one rule said in one place — components.css's, the same shape
                 a stack's face falls back to. It was written out inline here
                 in tokens that happened to agree with it; now it is the rule,
                 so a card with no picture is ringed when it is chosen like any
                 other. */
              `<div class="card-stack-blank"></div>`}
    </div>
  </div>`;
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
/* The readout and the analysis strip, drawn. What every number on them *is* is
 * js/deckview-totals.js's one pass over the deck — this function does no
 * counting of its own beyond the deck's target size, which is a fact about the
 * format rather than about the cards.
 *
 * Being called is what "the deck changed" means here: every caller is an edit,
 * an import, a restore, a deck arriving, a shelf arriving or the ownership
 * scope moving. So the pass is dropped on the way in and done once on the way
 * through, however many of these numbers ask for it. Nothing on this path is
 * reached from dbRender(): a deck-wide analysis running with the mat's
 * animation would undo the care that keeps it bounded to what is on screen. */
function dbRenderStats() {
  if (!dbDeck) return;
  dbTotalsChanged();
  dbCheckChanged();
  dbManaChanged();
  const totals = dbDeckTotals();

  /* How big the deck is *meant* to be, asked of js/deckview-legality.js rather
     than worked out here — because the legality line holds the deck to the same
     number, and two answers to "how many cards should this have" is exactly the
     kind of disagreement a readout cannot survive. What that number is, and why
     a pair of partners makes it ninety-eight, is said where it is decided. */
  const target   = dbDeckTarget();
  const display  = totals.cards;
  const avgCmc   = totals.avgCmc === null ? '—' : totals.avgCmc.toFixed(2);

  /* How many cards of each colour the deck holds — *cards*, by colour
     identity, which is the right answer to "what colours is this deck" and the
     wrong one to "how many Plains". The tooltip says which of the two it is,
     because a number beside a mana symbol reads as a pip count otherwise, and
     what the deck's costs actually ask for is a walk over `mana_cost` in the
     panel the lands figure opens. */
  const pipHtml = ['W','U','B','R','G']
    .filter(c => totals.colorCards[c] > 0)
    .map(c => `<i class="ms ms-${c.toLowerCase()} ms-cost" title="${c}"></i><span style="font-size:var(--text-xs)">${totals.colorCards[c]}</span>`)
    .join(' ');

  const cardsEl  = document.getElementById('dbStatCards');
  const cmcEl    = document.getElementById('dbStatCmc');
  const colorsEl = document.getElementById('dbStatColors');

  const over = display > target;
  if (cardsEl)  cardsEl.innerHTML  = `<strong style="color:${over ? 'var(--danger)' : display === target ? 'var(--success)' : ''}">${display}/${target}</strong> cards`;
  if (cmcEl)    cmcEl.innerHTML    = `avg CMC <strong>${avgCmc}</strong>`;
  if (colorsEl) {
    colorsEl.innerHTML = pipHtml || '<span style="color:var(--text-muted)">colorless</span>';
    colorsEl.title = 'Cards by colour identity — what the deck’s costs ask for is in the mana panel';
  }

  /* "87 of 99 owned" — the one figure on this line that is not a fact about
     the cards, and the reason it is written by another module. It counts the
     same mainboard everything above it counts. */
  dbRenderOwnStat();
  /* What the deck costs and what finishing it costs, which is the other figure
     the shelf decides — and then the curve, the type breakdown and the split,
     which are drawn whether or not the strip holding them is open. */
  dbRenderPriceStat();
  dbRenderAnalysis();
  /* Whether the deck is legal, and what bracket it looks like. Both are facts
     about the cards, so both change when the deck does — and the panel behind
     them is redrawn if it is standing open while cards move. */
  dbRenderCheckStats();
  _dbSyncCheckPanel();
  /* And the lands figure, which is now the door to what the lands are for:
     what the deck's spells want against what its lands make. Written by
     js/deckview-mana.js off its own pass, for the same reason the two above
     are — it is a fact about the cards, so it moves when they do. */
  dbRenderManaStat();
  _dbSyncManaPanel();
}

// ── View toggle ───────────────────────────────────────────────────────────────
function dbSetView(v) {
  dbView = v;
  /* The spread piles are kept, as the collapsed categories already were:
   * looking at the deck as a list and coming back to the mat finds the mat
   * the way it was left, rather than swept flat by having looked away. */
  localStorage.setItem('dbView', v);
  dbRender();
  _dbSizeSync?.();   // the mat's cards, the grid's and the piles' — one size per view
}

/* What the category name does when you click it, which is not the same
 * question in every view.
 *
 * In list and grid it hides the cards, because there they are laid out flat
 * and a category you are done with is a screenful of mat between you and the
 * next one.
 *
 * In pile view it settles the pile into a stack instead, and spreads it out
 * again. A settled stack is already the category folded away — it says what it
 * holds and takes one card's room — so hiding it as well was a fold on top of
 * a fold, and this is the control for the other direction.
 *
 * The mat arrives with every category spread, so settling is what is done to
 * it rather than what has to be undone. Any number of piles may be settled,
 * and one settling is never the price of another spreading: a deck is read by
 * holding two categories up against each other. js/cardstack.js says why, for
 * the three tabs that all work this way. */
function dbToggleCat(name) {
  if (dbView === 'pile') togglePile(dbSettledCats, name);
  else if (dbCollapsedCats.has(name)) dbCollapsedCats.delete(name);
  else dbCollapsedCats.add(name);
  dbRender();
}
