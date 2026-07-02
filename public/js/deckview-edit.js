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

  const existing = dbCards.find(c => c.card_name === name);
  if (existing) { existing.qty = (existing.qty || 1) + 1; }
  else {
    dbCards.push({ card_name: name, qty: 1, category: cat, position: dbCards.length });
  }

  // Fetch card data if we don't have it yet
  if (!dbCardData.has(name)) {
    await dbFetchCardData([name]);
    // Re-check category now that we have type data
    if (existing === undefined) {
      const card = dbCards.find(c => c.card_name === name);
      if (card) card.category = dbAutoCategory(name);
    }
  }

  dbRender();
  dbRenderStats();
  _dbScheduleSave();
}

async function dbRemoveCard(name) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  dbCards = dbCards.filter(c => c.card_name !== name);
  dbRender();
  dbRenderStats();
  _dbScheduleSave();
}

async function dbChangeQty(name, delta) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  const card = dbCards.find(c => c.card_name === name);
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

function dbDeleteCategory(name) {
  if (name === 'Commander') return;
  if (!confirm(`Delete category "${name}"? Cards will move to Uncategorised.`)) return;
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
  if (name === 'Commander') return;
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

function dbConfirmRenameCat() {
  const newName = document.getElementById('dbRenameCatInput')?.value.trim();
  if (!newName || !_dbRenamingCat) return dbHideRenameCat();
  if (dbCats.find(c => c.name === newName && c.name !== _dbRenamingCat)) {
    alert('That category already exists.'); return;
  }
  for (const c of dbCards) if (c.category === _dbRenamingCat) c.category = newName;
  const cat = dbCats.find(c => c.name === _dbRenamingCat);
  if (cat) cat.name = newName;
  dbHideRenameCat();
  dbRender();
  _dbScheduleSave();
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
    const isLocked = cat.name === 'Commander';
    const count = dbCards
      .filter(c => (c.category || dbAutoCategory(c.card_name)) === cat.name)
      .reduce((s, c) => s + (c.qty || 1), 0);
    const actions = canEdit ? `
      <button class="db-cat-btn" title="Rename" onclick="dbRenameCatFromModal('${jsAttr(cat.name)}')"${isLocked ? ' style="display:none"' : ''}>✎</button>
      <button class="db-cat-btn db-cat-del" title="Delete" onclick="dbDeleteCategory('${jsAttr(cat.name)}')"${isLocked ? ' style="display:none"' : ''}>×</button>` : '';
    return `<div class="db-catmodal-row">
      <span class="db-catmodal-name">${esc(cat.name)}</span>
      <span class="db-catmodal-count">${count}</span>
      ${actions}
    </div>`;
  }).join('') || '<div class="empty-state" style="padding:1rem">No categories yet</div>';
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
function dbShowMoveCard(name) {
  _dbMovingCard   = name;
  _dbBulkMoveMode = false;
  document.getElementById('dbMoveCardTitle').textContent = `Move: ${name}`;
  const card    = dbCards.find(c => c.card_name === name);
  const current = card?.category || '';
  const list    = document.getElementById('dbMoveCatList');
  list.innerHTML = _dbAutoCatButtonHtml() + dbCats.map(c =>
    `<button class="btn-${c.name === current ? 'primary' : 'secondary'}" style="text-align:left"
       onclick="dbConfirmMoveCard('${jsAttr(c.name)}')">${esc(c.name)}</button>`
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
  dbConfirmMoveCard(name);
}

function dbConfirmMoveCard(catName) {
  if (_dbBulkMoveMode) {
    for (const name of dbSelectedCards) {
      const card = dbCards.find(c => c.card_name === name);
      if (card) card.category = catName;
    }
    dbSelectedCards.clear();
    dbHideMoveCard();
    dbRender();
    _dbScheduleSave();
    return;
  }
  if (!_dbMovingCard) return dbHideMoveCard();
  const card = dbCards.find(c => c.card_name === _dbMovingCard);
  if (card) { card.category = catName; }
  dbHideMoveCard();
  dbRender();
  _dbScheduleSave();
}

// ── Auto-save ─────────────────────────────────────────────────────────────────
function _dbScheduleSave() {
  clearTimeout(dbSaveTimer);
  _dbSetSaveStatus('saving…');
  dbSaveTimer = setTimeout(_dbSave, 800);
}

async function _dbSave() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
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
