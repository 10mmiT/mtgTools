// ── Deck Builder — Render & stats ─────────────────────────────────────────
// Split from the former monolithic deckview.js. All deck-builder scripts share
// one global scope (classic scripts), so state declared in deckview-core.js is
// visible here and functions stay global for inline onclick handlers.

// ── Render ────────────────────────────────────────────────────────────────────
function dbRender() {
  if (!dbDeck) return;
  // Rebuilding the deck list (and the bulk-action bar above it) can shift
  // page height enough to scroll the cards you're looking at out from under
  // the cursor. Freeze the scroll position across the rebuild so it doesn't.
  const _scroller  = document.scrollingElement || document.documentElement;
  const _scrollTop = _scroller.scrollTop;

  const { field, dir } = getSort('deckbuild', { field: 'name', dir: 1 });
  const cmp = cardComparator(field, dir);

  // Drop selections for cards no longer in the deck (removed/deleted elsewhere)
  for (const name of [...dbSelectedCards]) {
    if (!dbCards.some(c => c.card_name === name)) dbSelectedCards.delete(name);
  }

  // Group cards by category, preserving cat order; apply the search filter
  const groups = new Map(dbCats.map(c => [c.name, []]));
  for (const card of dbCards) {
    if (!_dbMatchesFilter(card.card_name)) continue;
    const cat = card.category || dbAutoCategory(card.card_name);
    if (!groups.has(cat)) { dbEnsureCat(cat); groups.set(cat, []); }
    groups.get(cat).push(card);
  }

  // Sort within each group
  for (const [, arr] of groups) {
    arr.sort((a, b) => cmp(
      dbCardData.get(a.card_name) || { name: a.card_name },
      dbCardData.get(b.card_name) || { name: b.card_name }
    ));
  }

  const canEdit = isMyPlayer(dbDeck.playerId);
  const sections = [];
  for (const cat of dbCats) {
    const cards = groups.get(cat.name) || [];
    if (!cards.length && cat.name !== 'Commander') continue; // hide empty non-Commander cats
    sections.push(_dbRenderSection(cat.name, cards, canEdit));
  }

  const _dbContent = document.getElementById('dbDeckContent');
  const emptyMsg = dbOracleFilter
    ? 'No cards match your search'
    : 'No cards yet';
  _dbContent.innerHTML =
    sections.length ? sections.join('') : `<div class="empty-state" style="padding:2rem 1rem">${esc(emptyMsg)}</div>`;
  _dbContent.classList.toggle('db-pile-layout', dbView === 'pile');

  _dbRenderBulkBar();

  _scroller.scrollTop = _scrollTop;
}

// ── Multiselect → bulk move ─────────────────────────────────────────────────
// Clicking a card row/tile selects it (desktop click or mobile tap); a
// dedicated "ⓘ" button (top-left on tiles, first column in list view) opens
// the card info popup instead. On touch devices, a long-press also opens the
// info popup in place of needing to find/tap that small button.
let _dbLongPressTimer = null;
let _dbLongPressFired = false;
const DB_LONG_PRESS_MS = 500;

function dbTouchStart(e, name) {
  _dbLongPressFired = false;
  clearTimeout(_dbLongPressTimer);
  _dbLongPressTimer = setTimeout(() => {
    _dbLongPressFired = true;
    openCardByName(name);
  }, DB_LONG_PRESS_MS);
}

function dbTouchMove() { clearTimeout(_dbLongPressTimer); }
function dbTouchEnd()  { clearTimeout(_dbLongPressTimer); }

// preventDefault here also suppresses the global .card-link → openCardByName
// click routing (it checks e.defaultPrevented), so the name text inside the
// row/tile can keep the .card-link class (for the hover-preview tooltip)
// without also opening the info popup on a plain click.
function dbCardClick(e, name) {
  e.preventDefault();
  if (_dbLongPressFired) { _dbLongPressFired = false; return; }
  dbToggleSelectCard(e, name);
}

function _dbCardClickAttrs(name) {
  const n = jsAttr(name);
  return `onclick="dbCardClick(event,'${n}')" ontouchstart="dbTouchStart(event,'${n}')" ontouchmove="dbTouchMove()" ontouchend="dbTouchEnd()"`;
}

function dbToggleSelectCard(event, name) {
  event.stopPropagation();
  if (dbSelectedCards.has(name)) dbSelectedCards.delete(name);
  else dbSelectedCards.add(name);
  dbRender();
}

function dbClearSelection() {
  dbSelectedCards.clear();
  dbRender();
}

// Ctrl/Cmd-A — select every card currently visible (respects the search filter)
function dbSelectAllVisible() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  for (const card of dbCards) {
    if (_dbMatchesFilter(card.card_name)) dbSelectedCards.add(card.card_name);
  }
  dbRender();
}

// Select every (visible) card in one category, via the category header menu
function dbSelectCategory(catName) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  for (const card of dbCards) {
    const cat = card.category || dbAutoCategory(card.card_name);
    if (cat === catName && _dbMatchesFilter(card.card_name)) dbSelectedCards.add(card.card_name);
  }
  dbRender();
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
    <div style="border-top:1px solid var(--border);margin:.15rem 0"></div>`;
}

function dbAutoCategorizeMove() {
  const names = _dbBulkMoveMode ? [...dbSelectedCards] : (_dbMovingCard ? [_dbMovingCard] : []);
  if (!names.length) return dbHideMoveCard();
  for (const name of names) {
    const card = dbCards.find(c => c.card_name === name);
    if (!card) continue;
    const cat = dbAutoCategory(name);
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
  list.innerHTML = _dbAutoCatButtonHtml() + dbCats.map(c =>
    `<button class="btn-secondary" style="text-align:left" onclick="dbConfirmMoveCard('${jsAttr(c.name)}')">${esc(c.name)}</button>`
  ).join('');
  const newCatInput = document.getElementById('dbMoveNewCatInput');
  if (newCatInput) newCatInput.value = '';
  document.getElementById('dbMoveCardOverlay').style.display = 'flex';
}

function _dbRenderSection(catName, cards, canEdit) {
  const count    = cards.reduce((s, c) => s + (c.qty || 1), 0);
  const isLocked = catName === 'Commander';
  const collapsed = dbCollapsedCats.has(catName);
  const catActions = canEdit ? `
    <div class="db-cat-kebab-wrap">
      <button class="db-cat-btn" title="Category actions" onclick="dbToggleCatMenu(event)">⋯</button>
      <div class="col-menu db-cat-menu">
        <button class="col-menu-item" onclick="dbCloseCatMenus();dbSelectCategory('${jsAttr(catName)}')">Select all</button>
        <button class="col-menu-item" onclick="dbCloseCatMenus();dbShowRenameCat('${jsAttr(catName)}')"${isLocked ? ' style="display:none"' : ''}>Rename</button>
        <button class="col-menu-item db-menu-danger" onclick="dbCloseCatMenus();dbDeleteCategory('${jsAttr(catName)}')"${isLocked ? ' style="display:none"' : ''}>Delete</button>
      </div>
    </div>` : '';

  const dropAttrs = canEdit
    ? `ondragover="dbDragOver(event)" ondragleave="dbDragLeave(event)" ondrop="dbDrop(event,'${jsAttr(catName)}')"` : '';

  let cardsHtml;
  if (dbView === 'list') {
    cardsHtml = `<div class="dv-list">${cards.map(c => _dbListRow(c, canEdit)).join('')}</div>`;
  } else if (dbView === 'grid') {
    cardsHtml = `<div class="sf-grid">${cards.map(c => _dbGridTile(c, canEdit)).join('')}</div>`;
  } else if (dbView === 'pile') {
    cardsHtml = `<div class="db-pile">${cards.map(c => _dbPileTile(c, canEdit)).join('')}</div>`;
  } else {
    cardsHtml = `<div class="sf-grid-xl">${cards.map(c => _dbGridTileXL(c, canEdit)).join('')}</div>`;
  }

  return `<div class="dv-section${collapsed ? ' collapsed' : ''} db-cat-drop" ${dropAttrs}>
    <div class="dv-section-hdr">
      <span class="dv-section-title db-collapsible" onclick="dbToggleCat('${jsAttr(catName)}')">${esc(catName)}</span>
      <span class="dv-section-count">${count}</span>
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
  const owned = sfCardOwnership(card.card_name);
  const price = renderPrice(sf);
  const selected = dbSelectedCards.has(card.card_name);
  const infoEl  = `<button class="db-row-btn" title="Card info" onclick="event.stopPropagation();openCardByName('${jsAttr(card.card_name)}')">ⓘ</button>`;
  const moveBtn = canEdit
    ? `<button class="db-row-btn" title="Move to…" onclick="event.stopPropagation();dbShowMoveCard('${jsAttr(card.card_name)}')">⇄</button>` : '';
  const delBtn = canEdit
    ? `<button class="db-row-btn db-row-del" title="Remove" onclick="event.stopPropagation();dbRemoveCard('${jsAttr(card.card_name)}')">×</button>` : '';
  const qtyEl = canEdit
    ? `<span class="db-qty-wrap">
        <button class="db-qty-btn" onclick="event.stopPropagation();dbChangeQty('${jsAttr(card.card_name)}',-1)">−</button>
        <span class="dv-qty">×${card.qty || 1}</span>
        <button class="db-qty-btn" onclick="event.stopPropagation();dbChangeQty('${jsAttr(card.card_name)}',1)">+</button>
       </span>`
    : `<span class="dv-qty">×${card.qty || 1}</span>`;

  const dragAttrs = canEdit
    ? `draggable="true" ondragstart="dbDragStart(event,'${jsAttr(card.card_name)}')" ondragend="dbDragEnd(event)"` : '';
  const clickAttrs = canEdit ? _dbCardClickAttrs(card.card_name) : '';

  return `<div class="dv-row${canEdit ? ' db-draggable' : ''}${selected ? ' db-row-selected' : ''}" ${dragAttrs} ${clickAttrs}>
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
  const owned = sfCardOwnership(card.card_name);
  const price = renderPrice(sf);
  const selected = dbSelectedCards.has(card.card_name);
  const infoBtn = `<button class="db-tile-btn" title="Card info" onclick="event.stopPropagation();openCardByName('${jsAttr(card.card_name)}')">ⓘ</button>`;
  const btns  = canEdit ? `
    <div class="db-tile-btns">
      <button class="db-tile-btn db-tile-move" title="Move to…" onclick="event.stopPropagation();dbShowMoveCard('${jsAttr(card.card_name)}')">⇄</button>
      <button class="db-tile-btn db-tile-del"  title="Remove"   onclick="event.stopPropagation();dbRemoveCard('${jsAttr(card.card_name)}')">×</button>
    </div>` : '';
  const dragAttrs = canEdit
    ? `draggable="true" ondragstart="dbDragStart(event,'${jsAttr(card.card_name)}')" ondragend="dbDragEnd(event)"` : '';
  const clickAttrs = canEdit ? _dbCardClickAttrs(card.card_name) : '';
  return `<div class="sf-card-lg db-tile${canEdit ? ' db-draggable' : ''}${selected ? ' db-tile-selected' : ''}" ${dragAttrs} ${clickAttrs}>
    <div class="db-tile-info-wrap">${infoBtn}</div>
    ${btns}
    <div data-name="${esc(card.card_name)}">
      ${img ? `<img class="sf-card-lg-img" src="${img}" loading="lazy" alt="${esc(card.card_name)}">` :
              `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
    </div>
    <div class="sf-card-lg-footer">
      <div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.25rem">
        <a class="sf-card-lg-name card-link" href="#" data-name="${esc(card.card_name)}"
           style="flex:1;margin-bottom:0">${esc(card.card_name)}</a>
        ${card.qty > 1 ? `<span style="font-size:.72rem;font-weight:700;color:var(--muted)">×${card.qty}</span>` : ''}
        ${price}
      </div>
      <div class="sf-card-lg-badges">${owned || '<span class="sf-not-owned">—</span>'}</div>
    </div>
  </div>`;
}

function _dbGridTileXL(card, canEdit) {
  const sf    = dbCardData.get(card.card_name);
  const face  = sf?.card_faces?.[0];
  const img   = sf?.image_uris?.large || sf?.image_uris?.normal || face?.image_uris?.large || face?.image_uris?.normal || '';
  const mana  = sf?.mana_cost || face?.mana_cost || '';
  const type  = sf?.type_line || face?.type_line || '';
  const owned = sfCardOwnership(card.card_name);
  const price = renderPrice(sf);
  const selected = dbSelectedCards.has(card.card_name);
  const infoBtn = `<button class="db-tile-btn" title="Card info" onclick="event.stopPropagation();openCardByName('${jsAttr(card.card_name)}')">ⓘ</button>`;
  const btns  = canEdit ? `
    <div class="db-tile-btns">
      <button class="db-tile-btn db-tile-move" title="Move to…" onclick="event.stopPropagation();dbShowMoveCard('${jsAttr(card.card_name)}')">⇄</button>
      <button class="db-tile-btn db-tile-del"  title="Remove"   onclick="event.stopPropagation();dbRemoveCard('${jsAttr(card.card_name)}')">×</button>
    </div>` : '';
  const dragAttrs = canEdit
    ? `draggable="true" ondragstart="dbDragStart(event,'${jsAttr(card.card_name)}')" ondragend="dbDragEnd(event)"` : '';
  const clickAttrs = canEdit ? _dbCardClickAttrs(card.card_name) : '';
  return `<div class="sf-card-lg db-tile${canEdit ? ' db-draggable' : ''}${selected ? ' db-tile-selected' : ''}" ${dragAttrs} ${clickAttrs}>
    <div class="db-tile-info-wrap">${infoBtn}</div>
    ${btns}
    <div data-name="${esc(card.card_name)}">
      ${img ? `<img class="sf-card-lg-img" src="${img}" loading="lazy" alt="${esc(card.card_name)}">` :
              `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
    </div>
    <div class="sf-card-lg-footer">
      <div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.2rem">
        <a class="sf-card-lg-name card-link" href="#" data-name="${esc(card.card_name)}"
           style="flex:1;margin-bottom:0">${esc(card.card_name)}</a>
        ${card.qty > 1 ? `<span style="font-size:.72rem;font-weight:700;color:var(--muted)">×${card.qty}</span>` : ''}
        ${price}
      </div>
      ${mana ? `<div style="margin-bottom:.2rem">${renderMana(mana)}</div>` : ''}
      ${type ? `<div style="font-size:.7rem;color:var(--muted);margin-bottom:.25rem">${esc(type)}</div>` : ''}
      <div class="sf-card-lg-badges">${owned || '<span class="sf-not-owned">—</span>'}</div>
    </div>
  </div>`;
}

// ── Pile tile ─────────────────────────────────────────────────────────────────
function _dbPileTile(card, canEdit) {
  const sf   = dbCardData.get(card.card_name);
  const face = sf?.card_faces?.[0];
  const img  = sf?.image_uris?.normal || face?.image_uris?.normal || '';
  const selected = dbSelectedCards.has(card.card_name);
  const infoBtn = `<button class="db-tile-btn" title="Card info" onclick="event.stopPropagation();openCardByName('${jsAttr(card.card_name)}')">ⓘ</button>`;
  const btns = canEdit ? `
    <div class="db-tile-btns">
      <button class="db-tile-btn db-tile-move" title="Move to…" onclick="event.stopPropagation();dbShowMoveCard('${jsAttr(card.card_name)}')">⇄</button>
      <button class="db-tile-btn db-tile-del"  title="Remove"   onclick="event.stopPropagation();dbRemoveCard('${jsAttr(card.card_name)}')">×</button>
    </div>` : '';
  const dragAttrs = canEdit
    ? `draggable="true" ondragstart="dbDragStart(event,'${jsAttr(card.card_name)}')" ondragend="dbDragEnd(event)"` : '';
  const clickAttrs = canEdit ? _dbCardClickAttrs(card.card_name) : '';
  return `<div class="db-pile-card${canEdit ? ' db-draggable' : ''}${selected ? ' db-tile-selected' : ''}" ${dragAttrs} ${clickAttrs}>
    ${(card.qty || 1) > 1 ? `<span class="db-pile-qty">×${card.qty}</span>` : ''}
    <div class="db-tile-info-wrap">${infoBtn}</div>
    ${btns}
    <div data-name="${esc(card.card_name)}">
      ${img ? `<img src="${img}" loading="lazy" alt="${esc(card.card_name)}">` :
              `<div style="width:var(--db-card-width,150px);aspect-ratio:5/7;background:var(--card-2);border-radius:8px"></div>`}
    </div>
  </div>`;
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function dbRenderStats() {
  if (!dbDeck) return;
  const total    = dbCards.reduce((s, c) => s + (c.qty || 1), 0);
  const isCmd    = (dbDeck.commander || '').trim();
  const target   = isCmd ? 99 : 60; // Commander = 99 (excluding commander itself)
  const nonCmd   = dbCards.filter(c => c.card_name !== dbDeck.commander).reduce((s, c) => s + (c.qty || 1), 0);
  const display  = isCmd ? nonCmd : total;
  const landCount = dbCards
    .filter(c => (dbCardData.get(c.card_name)?.type_line || '').toLowerCase().includes('land'))
    .reduce((s, c) => s + (c.qty || 1), 0);
  const nonLands = dbCards.filter(c =>
    !(dbCardData.get(c.card_name)?.type_line || '').toLowerCase().includes('land') &&
    c.card_name !== dbDeck.commander);
  const avgCmc = nonLands.length
    ? (nonLands.reduce((s, c) => {
        const cmc = dbCardData.get(c.card_name)?.cmc ?? 0;
        return s + cmc * (c.qty || 1);
      }, 0) / nonLands.reduce((s, c) => s + (c.qty || 1), 0)).toFixed(2)
    : '—';

  // Color pip counts
  const pipCount = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of dbCards) {
    const ci = dbCardData.get(card.card_name)?.color_identity || [];
    for (const c of ci) if (pipCount[c] !== undefined) pipCount[c] += (card.qty || 1);
  }
  const pipHtml = ['W','U','B','R','G']
    .filter(c => pipCount[c] > 0)
    .map(c => `<i class="ms ms-${c.toLowerCase()} ms-cost" title="${c}"></i><span style="font-size:.75rem">${pipCount[c]}</span>`)
    .join(' ');

  // Mana curve (CMC 0–7+)
  const cmcBuckets = new Array(8).fill(0);
  for (const card of nonLands) {
    const cmc = Math.min(7, Math.round(dbCardData.get(card.card_name)?.cmc ?? 0));
    cmcBuckets[cmc] += (card.qty || 1);
  }
  const maxBucket = Math.max(...cmcBuckets, 1);
  const curveHtml = cmcBuckets.map((n, i) =>
    `<div class="db-curve-bar" style="height:${Math.round((n/maxBucket)*32)}px" title="${i === 7 ? '7+' : i}: ${n} cards"></div>`
  ).join('');

  const cardsEl  = document.getElementById('dbStatCards');
  const landsEl  = document.getElementById('dbStatLands');
  const cmcEl    = document.getElementById('dbStatCmc');
  const colorsEl = document.getElementById('dbStatColors');
  const curveEl  = document.getElementById('dbCurve');

  const over = display > target;
  if (cardsEl)  cardsEl.innerHTML  = `<strong style="color:${over ? 'var(--danger)' : display === target ? 'var(--success, #22c55e)' : ''}">${display}/${target}</strong> cards`;
  if (landsEl)  landsEl.innerHTML  = `<strong>${landCount}</strong> lands`;
  if (cmcEl)    cmcEl.innerHTML    = `avg CMC <strong>${avgCmc}</strong>`;
  if (colorsEl) colorsEl.innerHTML = pipHtml || '<span style="color:var(--muted)">colorless</span>';
  if (curveEl)  curveEl.innerHTML  = curveHtml;
}

// ── View toggle ───────────────────────────────────────────────────────────────
function dbSetView(v) {
  dbView = v;
  localStorage.setItem('dbView', v);
  ['list','grid','xl','pile'].forEach(x =>
    document.getElementById(`db-view-${x}`)?.classList.toggle('active', x === v));
  const scaleWrap = document.getElementById('dbScaleWrap');
  if (scaleWrap) scaleWrap.style.display = (v !== 'list') ? '' : 'none';
  dbRender();
}

function dbSetScale(value) {
  const n = parseInt(value, 10);
  document.getElementById('dbDeckContent')?.style.setProperty('--db-card-width', n + 'px');
  localStorage.setItem('dbScale', n);
}

function dbToggleCat(name) {
  if (dbCollapsedCats.has(name)) dbCollapsedCats.delete(name);
  else dbCollapsedCats.add(name);
  dbRender();
}
