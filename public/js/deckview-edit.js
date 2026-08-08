// ── Deck Builder — Editing: cards, categories, move, autosave ─────────────────────────────────────────
// Split from the former monolithic deckview.js. All deck-builder scripts share
// one global scope (classic scripts), so state declared in deckview-core.js is
// visible here and functions stay global for inline onclick handlers.

// ── Card operations ───────────────────────────────────────────────────────────
async function dbAddCard(nameOverride) {
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
     commander goes rather than in with the creatures. */
  const board = name === (dbDeck.commander || '').trim() ? DB_COMMANDER_BOARD : DB_MAIN_BOARD;
  const ref = dbPlace(board, name);
  const existing = dbFindCard(ref);
  if (existing) { existing.qty = (existing.qty || 1) + 1; }
  else {
    dbCards.push({ card_name: name, qty: 1, category: cat, board, position: dbCards.length });
    _dbRevealHeadBoard(board);
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
  dbCards = dbCards.filter(c => c !== card);
  dbSelectedCards.delete(ref);
  dbRender();
  dbRenderStats();
  _dbScheduleSave();
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

  if (moving.length > 1) _dbForceSnapshot('move');
  for (const card of moving) _dbPutCard(card, place);

  /* A card has landed on the head of the deck, so the head of the deck is on
     the mat — a commander dropped into a region that was switched off would go
     out of the hand and nowhere. */
  _dbRevealHeadBoard(dbReadPlace(place).board);

  dbRender();
  _dbScheduleSave();
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
