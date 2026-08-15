// ── Deck Builder — Editing: cards, categories, move, autosave ─────────────────────────────────────────
// Split from the former monolithic deckview.js. All deck-builder scripts share
// one global scope (classic scripts), so state declared in deckview-core.js is
// visible here and functions stay global for inline onclick handlers.

// ── Card operations ───────────────────────────────────────────────────────────
/* Add a card by name.
 *
 * `board` is where it is being put, and the whole of what the drawer's "Add to"
 * control does. Left out — the toolbar's Add a card field, and every caller
 * that predates the control — it is answered the way it always was, below. */
async function dbAddCard(nameOverride, board) {
  if (!dbDeck) return;
  const input   = document.getElementById('dbAddCardInput');
  const name    = (nameOverride || input?.value || '').trim();
  if (!name) return;
  if (!isMyPlayer(dbDeck.playerId)) return;

  closeDbAddAc();
  if (input) input.value = '';

  const cat = dbAutoCategory(name);
  dbEnsureCat(cat);

  /* Into the deck, which is the mainboard: a card added by name is a card you
     are putting in. A copy of it sitting in the maybeboard is a different card
     with a quantity of its own, and adding one must not go up.

     Unless it is the card the deck is named after. That used to be answered a
     level down, by dbAutoCategory() handing back the Commander category; the
     commander is a board now, so it is answered here — and it is the same
     rule, which is why adding your commander by name still puts it where the
     commander goes rather than in with the creatures.

     An asked-for board beats both. Somebody who has said "maybeboard" and then
     typed the name of their own commander means the maybeboard: the rule above
     is a guess about where a bare name belongs, and a guess does not get to
     overrule an instruction. */
  const into = _dbBoardExists(board)
    ? board
    : (name === (dbDeck.commander || '').trim() ? DB_COMMANDER_BOARD : DB_MAIN_BOARD);
  const ref = dbPlace(into, name);
  const existing = dbFindCard(ref);
  if (existing) { existing.qty = (existing.qty || 1) + 1; }
  else {
    dbCards.push({ card_name: name, qty: 1, category: cat, board: into, position: dbCards.length });
    /* Whatever it landed in is on the mat now. A card added by *name* has none
       of what a card put there by hand has — no carry, no board lighting up to
       receive it, nothing on screen that moved — so a maybeboard that stayed
       switched off would answer the press with a deck that looks unchanged and
       a card nowhere in it. That is the reason a head board is revealed on a
       drop, and it is the same reason. */
    _dbRevealBoard(into);
  }

  // Fetch card data if we don't have it yet
  if (!dbCardData.has(name)) {
    await dbFetchCardData([name]);
    // Re-check category now that we have type data
    if (existing === undefined) {
      const card = dbFindCard(ref);
      if (card) card.category = dbAutoCategory(name);
    }
  }

  dbRender();
  dbRenderStats();
  _dbScheduleSave();
}

/* One copy of the card, on the board it was asked about. Removing a card from
   the maybeboard is not removing it from the deck — that is the whole of what
   the second copy is for. */
async function dbRemoveCard(ref) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  const card = dbFindCard(ref);
  if (!card) return;
  const wasCommander = (card.board || DB_MAIN_BOARD) === DB_COMMANDER_BOARD;
  dbCards = dbCards.filter(c => c !== card);
  dbSelectedCards.delete(ref);
  dbRender();
  dbRenderStats();
  _dbScheduleSave();
  /* Taking one of two commanders off the board leaves the other one the card
     the deck is named after. */
  if (wasCommander) _dbSyncCommanderRecord();
}

async function dbChangeQty(ref, delta) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  const card = dbFindCard(ref);
  if (!card) return;
  card.qty = Math.max(1, (card.qty || 1) + delta);
  dbRender();
  dbRenderStats();
  _dbScheduleSave();
}

// ── Which printing the deck runs ──────────────────────────────────────────
/* A card in a deck is a name, and the app picks the printing. Choosing one is
 * done from the card's own gallery — ⓘ Inspect, and the printings at the bottom
 * of the card — so what is here is the deck's half of that conversation: the
 * three questions js/card.js asks it, and nothing about galleries.
 *
 * The gallery is a modal that can stand open for as long as anyone likes, so
 * none of these trusts what it was told when it opened. Every one of them
 * starts from the deck as it stands now, which is what makes "the deck was
 * closed while you were looking" a press that does nothing rather than a
 * printing written onto whatever is open instead. */

/** The card a gallery context names, or null if it no longer names one.
 *
 *  Four things have to hold, and each of them is something that can stop
 *  holding while the modal is up: a deck is open, it is the deck the gallery
 *  came from, it is yours to edit, and the card is still in it. */
function _dbPrintingCard(ctx) {
  if (!ctx || !dbDeck || dbDeck.id !== ctx.deckId) return null;
  if (!isMyPlayer(dbDeck.playerId)) return null;
  return dbFindCard(ctx.ref) || null;
}

/** What the gallery hands back when it wants to choose for this card — or null
 *  for a card the gallery may only look at, which is what every card in
 *  somebody else's deck is. */
function dbPrintingContext(ref) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId) || !dbFindCard(ref)) return null;
  return { deckId: dbDeck.id, playerId: dbDeck.playerId, deckName: dbDeck.name, ref };
}

/** Which printing the deck runs of that card, for the ring in the gallery.
 *  Null is a card the deck has chosen nothing for, and the gallery rings the
 *  printing the app picks — which is the one it is showing. */
function dbPrintingFor(ctx) {
  return _dbPrintingCard(ctx)?.printing || null;
}

/* The choice itself. One printing per card and not per copy, so this is a field
 * being written and there is nothing to accumulate: ten Forests are ten of the
 * same Forest.
 *
 * The mat is redrawn behind the modal, so closing the card shows the new art
 * with nothing further to press, and the deck's ordinary debounced save is what
 * carries it to the server — choosing a printing is an edit to the deck, and
 * the deck already knows how to save itself.
 *
 * Answers whether it happened, because the gallery has a ring to move and must
 * not move it for a press the deck refused. */
function dbChoosePrinting(ctx, printing) {
  const card = _dbPrintingCard(ctx);
  if (!card || !printing?.id) return false;
  card.printing = printing;
  dbRender();
  dbRenderStats();
  _dbScheduleSave();
  return true;
}

/* ⓘ Inspect, from the mat. The one door in the app that opens a gallery which
 * can choose, which is why it is here rather than a bare openCardByName() in
 * the markup: the context is read from the deck at the moment of the press, so
 * a menu written a moment ago cannot carry a stale one.
 *
 * On somebody else's deck dbPrintingContext() answers null and this is exactly
 * what Inspect has always been — a card, looked up. */
function dbInspectCard(ref) {
  openCardByName(dbReadRef(ref).name, dbPrintingContext(ref));
}

// ── Switching commanders ──────────────────────────────────────────────────
// Building a Commander deck starts with choosing what it is built around, and
// changing your mind about that is an ordinary thing to do. Until now it was
// the one thing about a deck that could not be done from the Deck Builder: the
// commander board was the mat's and the deck record's `commander` field was the
// Players & Decks tab's, so switching meant editing on one tab, coming back to
// the other, carrying the old commander out and the new one in — and in between
// the deck's tile showed the art of a card it no longer ran.
//
// One card is the whole of it now, from the same menu everything else about a
// card is asked from.

/* Make this card the commander. It comes onto the commander board and whatever
 * was lying there goes back into the deck.
 *
 * Not a swap of two cards. The board holds however many the format allows —
 * partners, a Background, a Doctor's Companion are two cards on it — so what
 * "switching" means is that the board now holds this one, which is a clear-out
 * and an arrival rather than a trade. A second commander is added the way it
 * always was, by carrying it onto the board or filing it there from Move to…,
 * neither of which goes through here. */
function dbMakeCommander(ref) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return false;
  const card = dbFindCard(ref);
  if (!card || (card.board || DB_MAIN_BOARD) === DB_COMMANDER_BOARD) return false;

  /* One press moving several cards, from a menu, and the thing it replaces is
     the decision the whole deck was built around. Worth being able to get
     back. */
  _dbForceSnapshot('commander');

  for (const held of dbCommanderCards()) {
    held.board = DB_MAIN_BOARD;
    /* Filed under the pile it belongs in. A card keeps its category while it
       lies on a board, which is what makes promoting one land it back where it
       came from — but a commander that has been on that board since the day
       the board was made may still carry `Commander`, the category the
       migration left on it, and that is not one of the deck's piles any more.
       So what it is is asked again rather than trusted. */
    if (!dbCats.some(c => c.name === held.category)) {
      held.category = dbAutoCategory(held.card_name);
      dbEnsureCat(held.category);
    }
  }
  card.board = DB_COMMANDER_BOARD;
  _dbRevealHeadBoard(DB_COMMANDER_BOARD);

  dbRender();
  dbRenderStats();
  _dbScheduleSave();
  _dbSyncCommanderRecord();
  return true;
}

/* Run this card *alongside* the commander, rather than instead of it.
 *
 * The board has always been able to hold two — that is what made partners, a
 * Background and a Doctor's Companion free the day it stopped being a category
 * — and carrying a second card onto it has always worked. What it had was no
 * name. "Make commander" clears the board, which is the right thing for the
 * word it uses and exactly wrong for the deck you are actually building, and a
 * capability whose only door is a drag onto a region is a capability nobody
 * finds.
 *
 * The record is untouched on purpose: it holds one string, it names the first
 * of them, and a partner arriving does not change what the deck is called or
 * whose art the tile wears. _dbSyncCommanderRecord() already says the same
 * thing from the other side — it reads the first card on the board — so this
 * calls it and nothing happens, which is better than this knowing why.
 *
 * Whether the two may actually be a pair is not asked here. It is the legality
 * panel's, which reads it off the cards (dbPartnerPairing in
 * js/deckview-legality.js) and says so where the deck's other rule-breaking is
 * said. That split is the app's habit rather than a compromise: a card that is
 * banned goes in the deck too, and the panel is where a deck is told what is
 * wrong with it. */
function dbAddPartner(ref) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return false;
  const card = dbFindCard(ref);
  if (!card || (card.board || DB_MAIN_BOARD) === DB_COMMANDER_BOARD) return false;
  /* A second commander, and only a second. With the board empty this is
     "make commander" and says so; with two on it there is no third to add. */
  if (dbCommanderCards().length !== 1) return false;

  card.board = DB_COMMANDER_BOARD;
  _dbRevealHeadBoard(DB_COMMANDER_BOARD);

  dbRender();
  dbRenderStats();
  _dbScheduleSave();
  _dbSyncCommanderRecord();
  return true;
}

/* ── The record follows the board ──────────────────────────────────────────
 *
 * A deck holds its commanders on a board, and the deck *record* names one as a
 * single string. That string is not decoration: it is the art the deck's tile
 * is drawn on, the card EDHREC is asked about, and the colour identity the
 * search panel filters by. Two places, and before this only one of them could
 * be changed from the Deck Builder, so they could disagree — and a deck whose
 * tile shows a commander it does not run is a deck lying about itself on the
 * one screen where decks are read at a glance.
 *
 * So there is a truth and a follower: **the board is what the deck holds, and
 * the record follows it.** Whatever lies first on the commander board is what
 * the deck is named after — the same card EDHREC is already asked about, so a
 * deck with partners does not have to decide anything the record cannot hold.
 *
 * An **empty board changes nothing.** A deck whose record names a commander it
 * has no card for is an ordinary deck, not a broken one — added on the Players
 * tab with a name and nothing else, or an Archidekt import that has not landed
 * yet — and clearing the record because the mat is empty would throw away the
 * only thing such a deck knows about itself. It is also what keeps the
 * following one-way: the board is where a commander is chosen, and emptying it
 * is not choosing anything.
 *
 * The art is a fetch, so it arrives after the switch rather than with it. The
 * record is written twice for that reason and the tab redrawn twice, which is
 * exactly what saving an edited commander on the Players & Decks tab does. */
async function _dbSyncCommanderRecord() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  const name = dbCommanderCards()[0]?.card_name;
  if (!name || name === dbDeck.commander) return;

  const entry = state.players.find(p => p.id === dbDeck.playerId)
    ?.decks.find(d => d.id === dbDeck.id);

  const write = (commander, commanderImg) => {
    dbDeck.commander = commander;
    dbDeck.commanderImg = commanderImg;
    if (entry) { entry.commander = commander; entry.commanderImg = commanderImg; }
    renderPlayers();
    savePlayerDecks(dbDeck.playerId);
  };

  write(name, null);

  /* The recommendations were for the card that is no longer the commander.
     Dropped rather than refetched, unless the panel is open on them — where
     dropping them alone would leave the last commander's list on the screen
     under the new commander's name. */
  dbEdhrecData = null;
  const showing = _dbEdhrecLoaded && dbLeftTab === 'edhrec';
  _dbEdhrecLoaded = false;
  if (showing) dbLoadEdhrec();

  await ensureScryfallImages([name]);
  write(name, scryfallArtCache.get(name) || null);
}

// ── Category operations ───────────────────────────────────────────────────────
function _dbAddCategoryByName(name) {
  name = (name || '').trim();
  if (!name || dbCats.find(c => c.name === name)) return false;
  dbCats.push({ name, position: dbCats.length });
  dbRender();
  _dbScheduleSave();
  return true;
}

function dbAddCategory() {
  const input = document.getElementById('dbNewCatInput');
  if (_dbAddCategoryByName(input?.value)) { if (input) input.value = ''; }
  else input?.focus();
}

/* Every category can be renamed and deleted now. Commander used to be the one
 * that could not, because the deck kept its commander in it; the commander is
 * a board, so a pile called Commander is a pile somebody made and theirs to
 * unmake. */
function dbDeleteCategory(name) {
  if (!confirm(`Delete category "${name}"? Cards will move to Uncategorised.`)) return;
  // Before a card is touched: this is one of the four operations that can take
  // a shape of the deck away in a single press.
  _dbForceSnapshot('category');
  /* Every card filed under it, on every board: a category belongs to the deck
     rather than to the mainboard, and a card set aside still carrying a name
     no pile answers to would bring the deleted category back with it the
     moment it was promoted. */
  let moved = false;
  for (const c of dbCards) if (c.category === name) { c.category = 'Uncategorised'; moved = true; }
  dbCats = dbCats.filter(c => c.name !== name);
  if (moved) dbEnsureCat('Uncategorised');
  dbRender();
  dbRenderStats();
  _dbScheduleSave();
  _dbRenderCategoriesModalList();
}

function dbShowRenameCat(name) {
  _dbRenamingCat = name;
  const input = document.getElementById('dbRenameCatInput');
  if (input) input.value = name;
  document.getElementById('dbRenameCatOverlay').style.display = 'flex';
  setTimeout(() => input?.focus(), 50);
}

function dbHideRenameCat() {
  _dbRenamingCat = null;
  document.getElementById('dbRenameCatOverlay').style.display = 'none';
  if (_dbCatModalReturnTo === 'categories') {
    _dbCatModalReturnTo = null;
    dbShowCategoriesModal();
  }
}

/* A category's name changed, and the cards filed under it brought along. Two
 * ways in now — the modal below, and a pile made by a drop being named where it
 * lies — and a rename is the same change to the deck whichever way it was
 * asked for. */
function _dbRenameCategory(from, to) {
  for (const c of dbCards) if (c.category === from) c.category = to;
  const cat = dbCats.find(c => c.name === from);
  if (cat) cat.name = to;
  dbRender();
  _dbScheduleSave();
}

function dbConfirmRenameCat() {
  const newName = document.getElementById('dbRenameCatInput')?.value.trim();
  if (!newName || !_dbRenamingCat) return dbHideRenameCat();
  if (dbCats.find(c => c.name === newName && c.name !== _dbRenamingCat)) {
    alert('That category already exists.'); return;
  }
  const from = _dbRenamingCat;
  dbHideRenameCat();
  _dbRenameCategory(from, newName);
}

// ── Naming a pile made by a drop ──────────────────────────────────────────────
/* The name a brand-new pile is given before anyone has typed one. It has to be
 * a name — the pile is real the moment the cards land in it, and a nameless
 * category is a category the save, the Move to… list and the sort would all
 * have to special-case — so it is a placeholder that is already unique, and
 * typing over it is a rename like any other. */
function _dbNewCategoryName() {
  const base = 'New category';
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!dbCats.some(c => c.name === name)) return name;
  }
}

/* Enter, or clicking away: what is in the box becomes the pile's name. Escape
 * leaves it with the name it was given — the cards have already moved, and
 * cancelling a name is not cancelling the drop. */
function dbCatNameKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); dbCommitCatName(e.currentTarget); }
  else if (e.key === 'Escape') { e.preventDefault(); _dbNamingCat = null; dbRender(); }
}

function dbCommitCatName(input) {
  const from = _dbNamingCat;
  if (!from) return false;   // already committed — the render that closed the box blurred it
  const to = (input?.value || '').trim();
  _dbNamingCat = null;
  /* Nothing typed, the name it already has, or a name another pile already
   * answers to: the placeholder stands and the cards stay where they were put.
   * A pile that could not be named is still a pile, and renaming it again is
   * the ⋯ menu's Rename — which is where the "that name is taken" conversation
   * belongs, rather than in an alert over a box you are typing in. */
  if (!to || to === from || dbCats.some(c => c.name === to)) { dbRender(); return false; }
  _dbRenameCategory(from, to);
  return true;
}

// ── Manage Categories modal ───────────────────────────────────────────────────
function dbShowCategoriesModal() {
  if (!dbDeck) return;
  _dbRenderCategoriesModalList();
  document.getElementById('dbCategoriesOverlay').style.display = 'flex';
}

function dbHideCategoriesModal() {
  document.getElementById('dbCategoriesOverlay').style.display = 'none';
}

function _dbRenderCategoriesModalList() {
  const list = document.getElementById('dbCategoriesModalList');
  if (!list || !dbDeck) return;
  const canEdit = isMyPlayer(dbDeck.playerId);
  document.getElementById('dbCategoriesModalAddRow').style.display = canEdit ? '' : 'none';
  list.innerHTML = dbCats.map(cat => {
    const count = dbCards
      .filter(c => (c.category || dbAutoCategory(c.card_name)) === cat.name)
      .reduce((s, c) => s + (c.qty || 1), 0);
    const actions = canEdit ? `
      <button class="db-cat-btn" title="Rename" onclick="dbRenameCatFromModal('${jsAttr(cat.name)}')">✎</button>
      <button class="db-cat-btn db-cat-del" title="Delete" onclick="dbDeleteCategory('${jsAttr(cat.name)}')">×</button>` : '';
    return `<div class="db-catmodal-row">
      <span class="db-catmodal-name">${esc(cat.name)}</span>
      <span class="db-catmodal-count">${count}</span>
      ${actions}
    </div>`;
  }).join('') || '<div class="empty-state" style="padding:var(--space-4)">No categories yet</div>';
}

function dbAddCategoryFromModal() {
  const input = document.getElementById('dbModalNewCatInput');
  if (_dbAddCategoryByName(input?.value)) {
    if (input) input.value = '';
    _dbRenderCategoriesModalList();
  } else input?.focus();
}

function dbRenameCatFromModal(name) {
  dbHideCategoriesModal();
  _dbCatModalReturnTo = 'categories';
  dbShowRenameCat(name);
}

// ── Move card modal ───────────────────────────────────────────────────────────

/* The boards, at the head of the Move to… list, above the categories.
 *
 * A board is meant to be worked with the carry — it is a region of the mat, not
 * a modal — but a finger never picks a card up, by design: the mat is scrolled
 * with it and js/carddrag.js will not guess which was meant. So on a phone this
 * list is the only way into a board, and a maybeboard you cannot reach from a
 * phone is a maybeboard half the app cannot use.
 *
 * A board keeps the card's category, so "Mainboard" here is the promote: the
 * card goes back into the deck under the pile it was filed in. Choosing a
 * category instead says which pile, which is the other half of the same
 * question and why they are one list. */
function _dbMoveBoardsHtml(from) {
  const buttons = DB_BOARDS.map(b =>
    `<button class="btn-${b.id === from ? 'primary' : 'secondary'}" style="text-align:left"
       onclick="dbConfirmMoveCard('${jsAttr(dbPlace(b.id, null))}')"
       title="${esc(b.hint || b.label)}">${esc(b.label)}</button>`).join('');
  return `<div class="db-move-group-label">Boards</div>${buttons}
    <div style="border-top:1px solid var(--border);margin:var(--space-1) 0"></div>
    <div class="db-move-group-label">Categories</div>`;
}
function dbShowMoveCard(ref) {
  _dbMovingCard   = ref;
  _dbBulkMoveMode = false;
  const card = dbFindCard(ref);
  document.getElementById('dbMoveCardTitle').textContent = `Move: ${dbReadRef(ref).name}`;
  const current = card?.category || '';
  const list    = document.getElementById('dbMoveCatList');
  list.innerHTML = _dbAutoCatButtonHtml()
    + _dbMoveBoardsHtml(card ? (card.board || DB_MAIN_BOARD) : DB_MAIN_BOARD)
    + dbCats.map(c =>
    `<button class="btn-${c.name === current ? 'primary' : 'secondary'}" style="text-align:left"
       onclick="dbConfirmMoveCard('${jsAttr(dbPlace(DB_MAIN_BOARD, c.name))}')">${esc(c.name)}</button>`
  ).join('');
  const newCatInput = document.getElementById('dbMoveNewCatInput');
  if (newCatInput) newCatInput.value = '';
  document.getElementById('dbMoveCardOverlay').style.display = 'flex';
}

function dbHideMoveCard() {
  _dbMovingCard   = null;
  _dbBulkMoveMode = false;
  document.getElementById('dbMoveCardOverlay').style.display = 'none';
}

// Create a brand-new category right from the move modal and move the
// card(s) into it in one step, instead of needing Manage Categories first.
function dbMoveToNewCategory() {
  const input = document.getElementById('dbMoveNewCatInput');
  const name  = (input?.value || '').trim();
  if (!name) { input?.focus(); return; }
  if (!dbCats.find(c => c.name === name)) dbEnsureCat(name);
  dbConfirmMoveCard(dbPlace(DB_MAIN_BOARD, name));
}

/* Where a card would end up, given where it is being put. A place is a pile on
 * a board — "main/Lands" — or a whole board — "maybe" — and the difference
 * between them is the whole of what a board region means: aimed at a pile, a
 * card is filed under it; aimed at a board, it keeps the category it was
 * carrying. That is what makes a card promoted out of the maybeboard land
 * where it belongs rather than arriving uncategorised.
 *
 * A card with no category at all — imported without one, and never drawn —
 * gets the one it would have been given when it was added, because a card
 * arriving in the deck under no pile at all is a card that has gone missing. */
function _dbPlaceFor(card, place) {
  const { board, category } = dbReadPlace(place);
  return {
    board,
    category: category === null ? (card.category || dbAutoCategory(card.card_name)) : category,
    /* Whether the place named a pile, which is also whether it may refile a
     * card it merges into. */
    filed: category !== null,
  };
}

/* Put one card in its place, merging where the place is already holding a copy
 * of it.
 *
 * The merge is not an optimisation — it is what stops the deck from claiming a
 * card is in the mainboard twice. A card's identity in a deck is its board and
 * its name, so carrying the maybeboard's Sol Ring onto the deck's Ramp pile
 * when a Sol Ring is already lying there is one card with two copies of it,
 * and the row that arrives is spent into the row that was there. */
function _dbPutCard(card, place) {
  const to = _dbPlaceFor(card, place);
  /* A card promoted into the deck brings its own category with it, and that
     category may be one the deck no longer draws a pile for — it has been
     lying in a board while the mat moved on. Aimed at a pile, there is nothing
     to ensure: the pile is what was aimed at. */
  if (to.board === DB_MAIN_BOARD && !to.filed) dbEnsureCat(to.category);
  const twin = dbCards.find(c => c !== card
    && c.card_name === card.card_name && (c.board || DB_MAIN_BOARD) === to.board);
  if (twin) {
    twin.qty = (twin.qty || 1) + (card.qty || 1);
    if (to.filed) twin.category = to.category;
    dbCards = dbCards.filter(c => c !== card);
  } else {
    card.board    = to.board;
    card.category = to.category;
  }
}

/* Put cards in a place — a pile on the mainboard, or a board of its own. The
 * one place in the app where a card changes either: the move modal calls it,
 * the bulk bar calls it, and a card carried across the mat calls it through
 * cardCarryDrop() — so a card moved by hand and a card moved from a list are
 * moved by the same code, and the autosave fires the same once either way.
 *
 * It answers whether anything actually moved, which is not the same question as
 * whether it was asked to. A card dropped on the pile it is already in has
 * nothing to change, and a caller with something to undo — a card in hand,
 * waiting to find out whether it is staying — needs to be able to tell that
 * from a move. The deck is not rebuilt and nothing is saved for a no-op, so an
 * accidental drop back on the pile a card came from is not a save and not a
 * re-render either.
 *
 * Which cards will move is worked out before any of them does, because a bulk
 * move is snapshotted and a snapshot taken after the first card has moved is a
 * snapshot of the wrong deck. It is also what makes "a bulk move" mean cards
 * that actually change pile: dropping twenty cards on the pile nineteen of
 * them are already in is one card moving, and not an operation worth a row in
 * the history. */
function dbMoveCardsTo(refs, place) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return false;
  const moving = refs
    .map(ref => dbFindCard(ref))
    .filter(card => {
      if (!card) return false;
      const to = _dbPlaceFor(card, place);
      /* Already there is nothing to do — on both halves of where "there" is.
         A card dropped on the pile it is in has not moved, and neither has one
         dropped on the board it is already lying in. */
      return (card.board || DB_MAIN_BOARD) !== to.board
        || (to.filed && card.category !== to.category);
    });
  if (!moving.length) return false;

  /* Asked before anything moves, for the same reason the list above is: a card
     arriving on the commander board or leaving it changes what the deck is
     named after, and afterwards there is no telling which it was. */
  const commanders = dbReadPlace(place).board === DB_COMMANDER_BOARD
    || moving.some(card => (card.board || DB_MAIN_BOARD) === DB_COMMANDER_BOARD);

  if (moving.length > 1) _dbForceSnapshot('move');
  for (const card of moving) _dbPutCard(card, place);

  /* A card has landed on the head of the deck, so the head of the deck is on
     the mat — a commander dropped into a region that was switched off would go
     out of the hand and nowhere. */
  _dbRevealHeadBoard(dbReadPlace(place).board);

  dbRender();
  _dbScheduleSave();
  if (commanders) _dbSyncCommanderRecord();
  return true;
}

function dbConfirmMoveCard(place) {
  const bulk = _dbBulkMoveMode;
  const refs = bulk ? [...dbSelectedCards] : (_dbMovingCard ? [_dbMovingCard] : []);
  if (bulk) dbSelectedCards.clear();
  dbHideMoveCard();
  /* The selection is gone whether or not a card went anywhere, and a selection
   * is drawn on the cards — so a bulk move that moved nothing still has a mat
   * to redraw. */
  if (!dbMoveCardsTo(refs, place) && bulk) dbRender();
}

// ── Auto-save ─────────────────────────────────────────────────────────────────
function _dbScheduleSave() {
  clearTimeout(dbSaveTimer);
  _dbSetSaveStatus('saving…');
  dbSaveTimer = setTimeout(_dbSave, 800);
}

/* Save now rather than in 800 ms. For the changes too big to leave sitting in
 * a browser that might be closed in the next second — a restore is the whole
 * deck — and for anything that has to know the save landed before it goes on. */
function _dbSaveNow() {
  clearTimeout(dbSaveTimer);
  return _dbSave();
}

async function _dbSave() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  /* A forced snapshot goes out in front of the operation that scheduled this
   * save. It carries its own copy of the deck, so nothing here depends on it
   * having finished — but the History panel would list the two the wrong way
   * round if the save overtook it. */
  if (_dbSnapshotInFlight) await _dbSnapshotInFlight;
  dbSaving = true;
  try {
    const body = {
      cards:      dbCards.map((c, i) => ({ ...c, position: i })),
      categories: dbCats.map((c, i) => ({ ...c, position: i })),
    };
    const res = await fetch(
      `/api/players/${encodeURIComponent(dbDeck.playerId)}/decks/${encodeURIComponent(dbDeck.id)}/cards`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _dbSetSaveStatus('Saved ✓');
    setTimeout(() => _dbSetSaveStatus(''), 2000);
  } catch (e) {
    _dbSetSaveStatus('Save failed ✗');
  } finally {
    dbSaving = false;
  }
}

function _dbSetSaveStatus(msg) {
  const el = document.getElementById('dbSaveStatus');
  if (el) el.textContent = msg;
}
