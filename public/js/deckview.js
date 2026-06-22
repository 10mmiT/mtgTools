// ── Deck Builder ──────────────────────────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────────────────────
let dbDeck      = null;      // {id, playerId, playerName, playerColor, name, commander, commanderImg}
let dbCards     = [];        // [{card_name, qty, category, position}]
let dbCats      = [];        // [{name, position}]
let dbCardData  = new Map(); // card name → Scryfall card object
let dbView      = 'list';
let dbLeftTab   = 'search';
let dbSrResults = [];        // Scryfall search results
let _dbDragCard = null;      // card name currently being dragged
let dbEdhrecData = null;     // parsed EDHREC cardlists
let dbAcTimer   = null;
let dbAddAcTimer = null;
let dbCmdAcTimer = null;
let dbSaveTimer  = null;
let dbSaving     = false;
let dbSortMounted = false;
let _dbInitDone  = false;
let _dbMovingCard = null;    // card name being moved between categories
let _dbRenamingCat = null;   // category name being renamed
let _dbEdhrecLoaded = false; // whether EDHREC has been fetched for the current deck
const dbCollapsedCats = new Set(); // categories collapsed by user

const DB_DEFAULT_CATS = [
  'Commander', 'Creatures', 'Planeswalkers', 'Instants', 'Sorceries',
  'Enchantments', 'Artifacts', 'Battles', 'Lands', 'Other',
];
const DB_SORT_FIELDS = ['name', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'];

// ── Initialization ────────────────────────────────────────────────────────────
function initDeckBuilder() {
  if (!_dbInitDone) {
    document.getElementById('dbCsvInput').addEventListener('change', _dbHandleCsvImport);
    document.addEventListener('click', e => {
      if (!e.target.closest('#dbExportMenu') && !e.target.closest('.db-export-wrap'))
        document.getElementById('dbExportMenu').style.display = 'none';
    });

    // Restore persisted view and scale
    const savedView = localStorage.getItem('dbView');
    if (savedView && ['list','grid','xl','pile'].includes(savedView)) dbView = savedView;
    const savedScale = localStorage.getItem('dbScale');
    if (savedScale) {
      const slider = document.getElementById('dbScaleSlider');
      if (slider) slider.value = savedScale;
      document.getElementById('dbDeckContent')?.style.setProperty('--db-card-width', savedScale + 'px');
    }

    // Keyboard "/" shortcut to open search panel (only when deck builder tab is active)
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)
          && document.getElementById('tab-deckview')?.style.display !== 'none') {
        e.preventDefault();
        dbOpenSearchPanel();
        setTimeout(() => document.getElementById('dbSearchInput')?.focus(), 50);
      }
    });

    // Hover card preview (list view only)
    const preview = document.createElement('img');
    preview.id = 'dbHoverPreview';
    preview.className = 'db-hover-preview';
    preview.style.display = 'none';
    document.body.appendChild(preview);

    document.getElementById('dbDeckContent')?.addEventListener('mousemove', e => {
      if (dbView !== 'list') { preview.style.display = 'none'; return; }
      const link = e.target.closest('.card-link');
      if (!link) { preview.style.display = 'none'; return; }
      const name = link.dataset.name;
      const sf = dbCardData.get(name);
      const face = sf?.card_faces?.[0];
      const imgUrl = sf?.image_uris?.normal || face?.image_uris?.normal || '';
      if (!imgUrl) { preview.style.display = 'none'; return; }
      if (preview.dataset.name !== name) { preview.src = imgUrl; preview.dataset.name = name; }
      preview.style.display = 'block';
      preview.style.left = (e.clientX + 16) + 'px';
      preview.style.top  = Math.min(e.clientY - 40, window.innerHeight - 320) + 'px';
    });

    document.getElementById('dbDeckContent')?.addEventListener('mouseleave', () => {
      preview.style.display = 'none';
    });

    _dbInitDone = true;
  }
  // Sync view button active states + scale wrap visibility from restored view
  ['list','grid','xl','pile'].forEach(x =>
    document.getElementById(`db-view-${x}`)?.classList.toggle('active', x === dbView));
  const scaleWrap = document.getElementById('dbScaleWrap');
  if (scaleWrap) scaleWrap.style.display = (dbView !== 'list') ? '' : 'none';
  dbPopulateDeckSel();
}

function dbPopulateDeckSel() {
  const sel = document.getElementById('dbDeckSel');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Select a deck —</option>';
  for (const player of (state.players || [])) {
    for (const deck of (player.decks || [])) {
      const opt = document.createElement('option');
      opt.value = `${player.id}|${deck.id}`;
      opt.textContent = `${player.name} · ${deck.name}`;
      if (deck.commander) opt.textContent += ` (${deck.commander})`;
      sel.appendChild(opt);
    }
  }
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
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
  if (!value) {
    dbDeck = null; dbCards = []; dbCats = []; dbCardData = new Map();
    dbSortMounted = false; dbEdhrecData = null; _dbEdhrecLoaded = false;
    _dbHideDeckUI();
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

  dbDeck = { id: stableId, playerId, playerName: player.name, playerColor: player.color,
             name: deck.name, commander: deck.commander || '', commanderImg: deck.commanderImg || null };
  dbEdhrecData = null; _dbEdhrecLoaded = false;

  document.getElementById('dbDeckContent').innerHTML =
    '<div class="empty-state" style="padding:3rem 1rem">Loading deck…</div>';
  _dbShowDeckUI();

  try {
    const res  = await fetch(`/api/players/${encodeURIComponent(playerId)}/decks/${encodeURIComponent(stableId)}/cards`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    dbCards = data.cards || [];
    dbCats  = data.categories?.length ? data.categories : DB_DEFAULT_CATS.map((n, i) => ({ name: n, position: i }));

    // Auto-import Archidekt cards when the deck has never been built locally
    if (dbCards.length === 0 && deck.source === 'archidekt' && deck.deckId) {
      document.getElementById('dbDeckContent').innerHTML =
        '<div class="empty-state" style="padding:3rem 1rem">Importing from Archidekt…</div>';
      const imported = await _dbImportArchidekt(deck.deckId);
      if (imported.length) {
        dbCards = imported;
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
      `<div class="error-msg" style="margin:.5rem 0">${esc(e.message)}</div>`;
  }
}

function _dbShowDeckUI() {
  document.getElementById('dbDeckToolbar').style.display = '';
  document.getElementById('dbAddCardRow').style.display  = '';
  document.getElementById('dbAddCatRow').style.display   = '';
  document.getElementById('dbStatsBar').style.display    = '';
  document.getElementById('dbDeleteDeckBtn').style.display =
    isMyPlayer(dbDeck?.playerId) ? '' : 'none';
}

function _dbHideDeckUI() {
  document.getElementById('dbDeckToolbar').style.display = 'none';
  document.getElementById('dbAddCardRow').style.display  = 'none';
  document.getElementById('dbAddCatRow').style.display   = 'none';
  document.getElementById('dbStatsBar').style.display    = 'none';
  document.getElementById('dbDeleteDeckBtn').style.display = 'none';
  document.getElementById('dbDeckContent').innerHTML =
    '<div class="empty-state" style="padding:3rem 1rem">Select a deck or create a new one</div>';
}

// ── Delete deck ───────────────────────────────────────────────────────────────
async function dbDeleteDeck() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  if (!confirm(`Delete "${dbDeck.name}"? This removes the deck and all its cards. You can re-add it (e.g. from Archidekt) afterwards.`)) return;

  const { id: deckId, playerId } = dbDeck;

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
  const sel = document.getElementById('dbDeckSel');
  if (sel) sel.value = '';
}

// ── Archidekt import ──────────────────────────────────────────────────────────
const _ARCH_CAT = {
  commander: 'Commander', creatures: 'Creatures', creature: 'Creatures',
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
    // Skip sideboard / maybeboard
    const rawCats = (item.categories || []).map(c => c.trim());
    if (rawCats.some(c => /sideboard|maybeboard/i.test(c))) continue;
    // Map to our categories; '' means let dbAutoCategory fill it from Scryfall type
    let category = '';
    for (const c of rawCats) {
      const mapped = _ARCH_CAT[c.toLowerCase()];
      if (mapped) { category = mapped; break; }
    }
    cards.push({ card_name: name, qty, category, position: cards.length });
  }
  return cards;
}

// ── Scryfall batch-fetch ──────────────────────────────────────────────────────
async function dbFetchCardData(names) {
  const missing = names.filter(n => !dbCardData.has(n));
  if (!missing.length) return;
  const BATCH = 75;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    try {
      const res  = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map(n => ({ name: n.split(' // ')[0] })) }),
      });
      const data = await res.json();
      for (const card of (data.data || [])) {
        dbCardData.set(card.name, card);
        if (card.card_faces?.[0]?.name) dbCardData.set(card.card_faces[0].name, card);
      }
      if (i + BATCH < missing.length) await new Promise(r => setTimeout(r, 100));
    } catch {}
  }
}

// ── Auto-categorise ───────────────────────────────────────────────────────────
function dbAutoCategory(cardName) {
  const sf = dbCardData.get(cardName);
  const t  = (sf?.type_line || '').toLowerCase();
  if (cardName === dbDeck?.commander)     return 'Commander';
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

// ── Render ────────────────────────────────────────────────────────────────────
function dbRender() {
  if (!dbDeck) return;
  const { field, dir } = getSort('deckbuild', { field: 'name', dir: 1 });
  const cmp = cardComparator(field, dir);

  // Group cards by category, preserving cat order
  const groups = new Map(dbCats.map(c => [c.name, []]));
  for (const card of dbCards) {
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
  _dbContent.innerHTML =
    sections.length ? sections.join('') : '<div class="empty-state" style="padding:2rem 1rem">No cards yet</div>';
  _dbContent.classList.toggle('db-pile-layout', dbView === 'pile');
}

function _dbRenderSection(catName, cards, canEdit) {
  const count    = cards.reduce((s, c) => s + (c.qty || 1), 0);
  const isLocked = catName === 'Commander';
  const collapsed = dbCollapsedCats.has(catName);
  const catActions = canEdit ? `
    <button class="db-cat-btn" title="Rename" onclick="dbShowRenameCat('${jsAttr(catName)}')"${isLocked ? ' style="display:none"' : ''}>✎</button>
    <button class="db-cat-btn db-cat-del" title="Delete" onclick="dbDeleteCategory('${jsAttr(catName)}')"${isLocked ? ' style="display:none"' : ''}>×</button>` : '';

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
  const moveBtn = canEdit
    ? `<button class="db-row-btn" title="Move to…" onclick="dbShowMoveCard('${jsAttr(card.card_name)}')">⇄</button>` : '';
  const delBtn = canEdit
    ? `<button class="db-row-btn db-row-del" title="Remove" onclick="dbRemoveCard('${jsAttr(card.card_name)}')">×</button>` : '';
  const qtyEl = canEdit
    ? `<span class="db-qty-wrap">
        <button class="db-qty-btn" onclick="dbChangeQty('${jsAttr(card.card_name)}',-1)">−</button>
        <span class="dv-qty">×${card.qty || 1}</span>
        <button class="db-qty-btn" onclick="dbChangeQty('${jsAttr(card.card_name)}',1)">+</button>
       </span>`
    : `<span class="dv-qty">×${card.qty || 1}</span>`;

  const dragAttrs = canEdit
    ? `draggable="true" ondragstart="dbDragStart(event,'${jsAttr(card.card_name)}')" ondragend="dbDragEnd(event)"` : '';

  return `<div class="dv-row${canEdit ? ' db-draggable' : ''}" ${dragAttrs}>
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
  const btns  = canEdit ? `
    <div class="db-tile-btns">
      <button class="db-tile-btn db-tile-move" title="Move to…" onclick="dbShowMoveCard('${jsAttr(card.card_name)}')">⇄</button>
      <button class="db-tile-btn db-tile-del"  title="Remove"   onclick="dbRemoveCard('${jsAttr(card.card_name)}')">×</button>
    </div>` : '';
  const dragAttrs = canEdit
    ? `draggable="true" ondragstart="dbDragStart(event,'${jsAttr(card.card_name)}')" ondragend="dbDragEnd(event)"` : '';
  return `<div class="sf-card-lg db-tile${canEdit ? ' db-draggable' : ''}" ${dragAttrs}>
    ${btns}
    <a href="#" class="card-open" data-name="${esc(card.card_name)}">
      ${img ? `<img class="sf-card-lg-img" src="${img}" loading="lazy" alt="${esc(card.card_name)}">` :
              `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
    </a>
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
  const btns  = canEdit ? `
    <div class="db-tile-btns">
      <button class="db-tile-btn db-tile-move" title="Move to…" onclick="dbShowMoveCard('${jsAttr(card.card_name)}')">⇄</button>
      <button class="db-tile-btn db-tile-del"  title="Remove"   onclick="dbRemoveCard('${jsAttr(card.card_name)}')">×</button>
    </div>` : '';
  const dragAttrs = canEdit
    ? `draggable="true" ondragstart="dbDragStart(event,'${jsAttr(card.card_name)}')" ondragend="dbDragEnd(event)"` : '';
  return `<div class="sf-card-lg db-tile${canEdit ? ' db-draggable' : ''}" ${dragAttrs}>
    ${btns}
    <a href="#" class="card-open" data-name="${esc(card.card_name)}">
      ${img ? `<img class="sf-card-lg-img" src="${img}" loading="lazy" alt="${esc(card.card_name)}">` :
              `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
    </a>
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
  const btns = canEdit ? `
    <div class="db-tile-btns">
      <button class="db-tile-btn db-tile-move" title="Move to…" onclick="dbShowMoveCard('${jsAttr(card.card_name)}')">⇄</button>
      <button class="db-tile-btn db-tile-del"  title="Remove"   onclick="dbRemoveCard('${jsAttr(card.card_name)}')">×</button>
    </div>` : '';
  const dragAttrs = canEdit
    ? `draggable="true" ondragstart="dbDragStart(event,'${jsAttr(card.card_name)}')" ondragend="dbDragEnd(event)"` : '';
  return `<div class="db-pile-card${canEdit ? ' db-draggable' : ''}" ${dragAttrs}>
    ${(card.qty || 1) > 1 ? `<span class="db-pile-qty">×${card.qty}</span>` : ''}
    ${btns}
    <a href="#" class="card-open" data-name="${esc(card.card_name)}">
      ${img ? `<img src="${img}" loading="lazy" alt="${esc(card.card_name)}">` :
              `<div style="width:var(--db-card-width,150px);aspect-ratio:5/7;background:var(--card-2);border-radius:8px"></div>`}
    </a>
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
function dbAddCategory() {
  const input = document.getElementById('dbNewCatInput');
  const name  = (input?.value || '').trim();
  if (!name || dbCats.find(c => c.name === name)) { input?.focus(); return; }
  dbCats.push({ name, position: dbCats.length });
  if (input) input.value = '';
  dbRender();
  _dbScheduleSave();
}

function dbDeleteCategory(name) {
  if (name === 'Commander') return;
  if (!confirm(`Delete category "${name}"? Cards will move to Other.`)) return;
  for (const c of dbCards) if (c.category === name) c.category = 'Other';
  dbCats = dbCats.filter(c => c.name !== name);
  dbEnsureCat('Other');
  dbRender();
  dbRenderStats();
  _dbScheduleSave();
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

// ── Move card modal ───────────────────────────────────────────────────────────
function dbShowMoveCard(name) {
  _dbMovingCard = name;
  document.getElementById('dbMoveCardTitle').textContent = `Move: ${name}`;
  const card    = dbCards.find(c => c.card_name === name);
  const current = card?.category || '';
  const list    = document.getElementById('dbMoveCatList');
  list.innerHTML = dbCats.map(c =>
    `<button class="btn-${c.name === current ? 'primary' : 'secondary'}" style="text-align:left"
       onclick="dbConfirmMoveCard('${jsAttr(c.name)}')">${esc(c.name)}</button>`
  ).join('');
  document.getElementById('dbMoveCardOverlay').style.display = 'flex';
}

function dbHideMoveCard() {
  _dbMovingCard = null;
  document.getElementById('dbMoveCardOverlay').style.display = 'none';
}

function dbConfirmMoveCard(catName) {
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

// ── Autocomplete: add-card input ──────────────────────────────────────────────
function dbAddAcInput() {
  clearTimeout(dbAddAcTimer);
  const q = document.getElementById('dbAddCardInput')?.value.trim();
  if (q.length < 2) { closeDbAddAc(); return; }
  dbAddAcTimer = setTimeout(async () => {
    try {
      const res  = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const names = (data.data || []).slice(0, 8);
      const drop  = document.getElementById('dbAddAcDrop');
      if (!names.length || !drop) { closeDbAddAc(); return; }
      drop.innerHTML = names.map(n =>
        `<div class="ac-item" onclick="pickDbAddAc('${jsAttr(n)}')">${esc(n)}</div>`).join('');
      drop.style.display = 'block';
    } catch { closeDbAddAc(); }
  }, 280);
}

function pickDbAddAc(name) {
  const input = document.getElementById('dbAddCardInput');
  if (input) input.value = name;
  closeDbAddAc();
  input?.focus();
}

function closeDbAddAc() {
  const d = document.getElementById('dbAddAcDrop');
  if (d) d.style.display = 'none';
}

// ── Autocomplete: search input ────────────────────────────────────────────────
function dbAcInput() {
  clearTimeout(dbAcTimer);
  const q = document.getElementById('dbSearchInput')?.value.trim();
  if (q.length < 2) { closeDbAc(); return; }
  dbAcTimer = setTimeout(async () => {
    try {
      const res  = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const names = (data.data || []).slice(0, 8);
      const drop  = document.getElementById('dbAcDrop');
      if (!names.length || !drop) { closeDbAc(); return; }
      drop.innerHTML = names.map(n =>
        `<div class="ac-item" onclick="pickDbAc('${jsAttr(n)}')">${esc(n)}</div>`).join('');
      drop.style.display = 'block';
    } catch { closeDbAc(); }
  }, 280);
}

function pickDbAc(name) {
  const input = document.getElementById('dbSearchInput');
  if (input) input.value = name;
  closeDbAc();
  dbSearch();
}

function closeDbAc() {
  const d = document.getElementById('dbAcDrop');
  if (d) d.style.display = 'none';
}

// ── Autocomplete: commander input (in new deck modal) ─────────────────────────
function dbCmdAcInput() {
  clearTimeout(dbCmdAcTimer);
  const q = document.getElementById('dbNewDeckCommander')?.value.trim();
  if (q.length < 2) { _closeDbCmdAc(); return; }
  dbCmdAcTimer = setTimeout(async () => {
    try {
      const res  = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}+t:legendary+t:creature`);
      const data = await res.json();
      const names = (data.data || []).slice(0, 8);
      const drop  = document.getElementById('dbCmdAcDrop');
      if (!names.length || !drop) { _closeDbCmdAc(); return; }
      drop.innerHTML = names.map(n =>
        `<div class="ac-item" onclick="pickDbCmdAc('${jsAttr(n)}')">${esc(n)}</div>`).join('');
      drop.style.display = 'block';
    } catch { _closeDbCmdAc(); }
  }, 280);
}

function pickDbCmdAc(name) {
  const input = document.getElementById('dbNewDeckCommander');
  if (input) input.value = name;
  _closeDbCmdAc();
}

function _closeDbCmdAc() {
  const d = document.getElementById('dbCmdAcDrop');
  if (d) d.style.display = 'none';
}

// Close all autocompletes when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('#dbAddCardInput') && !e.target.closest('#dbAddAcDrop')) closeDbAddAc();
  if (!e.target.closest('#dbSearchInput') && !e.target.closest('#dbAcDrop')) closeDbAc();
  if (!e.target.closest('#dbNewDeckCommander') && !e.target.closest('#dbCmdAcDrop')) _closeDbCmdAc();
});

// ── Scryfall search panel ─────────────────────────────────────────────────────
async function dbSearch() {
  const input = document.getElementById('dbSearchInput');
  let   q     = (input?.value || '').trim();
  if (!q) return;

  // Auto-inject colour identity filter for commander decks (if toggle enabled)
  const ciChecked = document.getElementById('dbCiToggle')?.checked;
  if (ciChecked && dbDeck?.commander && dbCardData.has(dbDeck.commander)) {
    const ci = dbCardData.get(dbDeck.commander).color_identity || [];
    if (ci.length && !/\b(ci:|id:)/.test(q)) {
      q = `${q} ci<=${ci.join('')}`;
    }
  }

  const resultsEl = document.getElementById('dbSearchResults');
  resultsEl.innerHTML = '<div class="empty-state" style="padding:1rem">Searching…</div>';

  try {
    const res  = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=name&page=1`);
    const data = await res.json();
    if (data.object === 'error') {
      resultsEl.innerHTML = `<div class="error-msg" style="margin:.5rem 0">${esc(data.details || data.warnings?.join(' ') || 'No results')}</div>`;
      return;
    }
    dbSrResults = data.data || [];
    // Cache Scryfall data for all returned cards
    for (const card of dbSrResults) {
      dbCardData.set(card.name, card);
      if (card.card_faces?.[0]?.name) dbCardData.set(card.card_faces[0].name, card);
    }
    _dbRenderSearch();
  } catch (e) {
    resultsEl.innerHTML = `<div class="error-msg" style="margin:.5rem 0">${esc(e.message)}</div>`;
  }
}

function _dbRenderSearch() {
  const el = document.getElementById('dbSearchResults');
  if (!dbSrResults.length) {
    el.innerHTML = '<div class="empty-state" style="padding:1rem">No results</div>';
    return;
  }
  const canAdd = !!(dbDeck && isMyPlayer(dbDeck.playerId));
  el.innerHTML = dbSrResults.map(card => {
    const face  = card.card_faces?.[0];
    const mana  = card.mana_cost || face?.mana_cost || '';
    const type  = card.type_line || face?.type_line || '';
    const img   = card.image_uris?.small || face?.image_uris?.small || '';
    const price = renderPrice(card);
    const inDeck = dbCards.some(c => c.card_name === card.name);
    const addBtn = canAdd
      ? `<button class="db-add-btn${inDeck ? ' db-add-btn-in' : ''}"
           onclick="dbAddCard('${jsAttr(card.name)}')" title="${inDeck ? 'Already in deck' : 'Add to deck'}">
           ${inDeck ? '✓' : '+'}
         </button>` : '';
    return `<div class="db-sr-row">
      ${img ? `<a href="#" class="card-open" data-name="${esc(card.name)}">
        <img class="db-sr-thumb" src="${img}" alt="${esc(card.name)}"></a>` : ''}
      <div class="db-sr-info">
        <div class="db-sr-name">
          <a class="card-link" href="#" data-name="${esc(card.name)}">${esc(card.name)}</a>
          ${mana ? renderMana(mana) : ''}
        </div>
        <div class="db-sr-type">${esc(type)}</div>
        <div class="db-sr-foot">${price}${wantBtnHtml(card.name)}</div>
      </div>
      ${addBtn}
    </div>`;
  }).join('');
}

// ── Search drawer ─────────────────────────────────────────────────────────────
function dbOpenSearchPanel() {
  document.getElementById('dbSearchPanel')?.classList.add('open');
  document.getElementById('dbSearchBackdrop')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function dbCloseSearchPanel() {
  document.getElementById('dbSearchPanel')?.classList.remove('open');
  document.getElementById('dbSearchBackdrop')?.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Drag-and-drop between categories ─────────────────────────────────────────
function dbDragStart(event, cardName) {
  _dbDragCard = cardName;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', cardName);
  setTimeout(() => event.target.classList.add('db-dragging'), 0);
}

function dbDragEnd(event) {
  event.target.classList.remove('db-dragging');
  document.querySelectorAll('.db-drop-target').forEach(el => el.classList.remove('db-drop-target'));
  _dbDragCard = null;
}

function dbDragOver(event) {
  if (!_dbDragCard) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('db-drop-target');
}

function dbDragLeave(event) {
  event.currentTarget.classList.remove('db-drop-target');
}

async function dbDrop(event, targetCategory) {
  event.preventDefault();
  event.currentTarget.classList.remove('db-drop-target');
  const cardName = _dbDragCard || event.dataTransfer.getData('text/plain');
  if (!cardName || !dbDeck) return;
  const card = dbCards.find(c => c.card_name === cardName);
  if (!card || card.category === targetCategory) return;

  card.category = targetCategory;
  dbRender();
  _dbScheduleSave();
}

// ── Left panel tabs ───────────────────────────────────────────────────────────
function dbSetLeftTab(tab) {
  dbLeftTab = tab;
  document.getElementById('db-ltab-search')?.classList.toggle('active', tab === 'search');
  document.getElementById('db-ltab-edhrec')?.classList.toggle('active', tab === 'edhrec');
  document.getElementById('db-left-search').style.display  = tab === 'search'  ? '' : 'none';
  document.getElementById('db-left-edhrec').style.display  = tab === 'edhrec'  ? '' : 'none';

  if (tab === 'edhrec' && !_dbEdhrecLoaded) {
    dbLoadEdhrec();
  }
}

// ── EDHREC panel ──────────────────────────────────────────────────────────────
async function dbLoadEdhrec() {
  const commanderCard = dbCards.find(c => c.category === 'Commander');
  const commanderName = commanderCard?.card_name || dbDeck?.commander;
  const el = document.getElementById('dbEdhrecContent');
  if (!commanderName) {
    el.innerHTML = '<div class="empty-state" style="padding:2rem 0">Add a card to the Commander category to see EDHREC recommendations</div>';
    return;
  }
  _dbEdhrecLoaded = true;
  el.innerHTML = `<div class="empty-state" style="padding:2rem 1rem">Loading EDHREC recommendations for ${esc(commanderName)}…</div>`;

  try {
    const res  = await fetch(`/api/edhrec/commander/${encodeURIComponent(commanderName)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const cardlists = data?.container?.json_dict?.cardlists || [];
    dbEdhrecData = cardlists;

    // Fetch Scryfall data for every recommended card so thumbnails can render
    const allNames = [...new Set(cardlists.flatMap(s => (s.cardviews || []).map(c => c.name)))];
    await dbFetchCardData(allNames);

    _dbRenderEdhrec();
  } catch (e) {
    el.innerHTML = `<div class="error-msg" style="margin:.5rem 0">${esc(e.message)}</div>`;
  }
}

// EDHREC card-type tags merged the same way Archidekt buckets categories;
// order here drives display order (top picks first, then type sections).
const DB_EDHREC_SECTIONS = [
  { tags: ['highsynergycards'], header: 'High Synergy Cards' },
  { tags: ['topcards'],         header: 'Top Cards' },
  { tags: ['gamechangers'],     header: 'Game Changers' },
  { tags: ['newcards'],         header: 'New Cards' },
  { tags: ['creatures'],        header: 'Creatures' },
  { tags: ['planeswalkers'],    header: 'Planeswalkers' },
  { tags: ['instants'],         header: 'Instants' },
  { tags: ['sorceries'],        header: 'Sorceries' },
  { tags: ['enchantments'],     header: 'Enchantments' },
  { tags: ['manaartifacts', 'utilityartifacts'], header: 'Artifacts' },
  { tags: ['lands', 'utilitylands'], header: 'Lands' },
];
const DB_EDHREC_PER_SECTION = 36;

function _dbRenderEdhrec() {
  const el = document.getElementById('dbEdhrecContent');
  if (!dbEdhrecData?.length) {
    el.innerHTML = '<div class="empty-state" style="padding:1rem">No recommendations found</div>';
    return;
  }

  const canAdd  = !!(dbDeck && isMyPlayer(dbDeck.playerId));
  const byTag   = new Map(dbEdhrecData.map(s => [s.tag, s]));
  const sections = DB_EDHREC_SECTIONS
    .map(({ tags, header }) => {
      const seen  = new Set();
      const views = tags.flatMap(t => byTag.get(t)?.cardviews || [])
        .filter(c => !seen.has(c.name) && seen.add(c.name));
      const cards = views
          .filter(c => !dbCards.some(d => d.card_name === c.name))
          .slice(0, DB_EDHREC_PER_SECTION).map(c => {
        const sf     = dbCardData.get(c.name);
        const face   = sf?.card_faces?.[0];
        const img    = sf?.image_uris?.small || face?.image_uris?.small || '';
        const type   = sf?.type_line || face?.type_line || '';
        const synPct   = c.synergy != null ? `${Math.round(c.synergy * 100)}%` : '';
        const incCount = c.num_decks != null ? `${c.num_decks.toLocaleString()} decks` : '';
        const addBtn   = canAdd
          ? `<button class="db-add-btn"
               onclick="dbAddCard('${jsAttr(c.name)}')">+</button>` : '';
        return `<div class="db-edh-row">
          ${img ? `<a href="#" class="card-open" data-name="${esc(c.name)}">
            <img class="db-edh-thumb" src="${img}" alt="${esc(c.name)}"></a>` : ''}
          <div class="db-edh-info">
            <a class="card-link db-edh-name" href="#" data-name="${esc(c.name)}">${esc(c.name)}</a>
            ${type ? `<div class="db-edh-type">${esc(type)}</div>` : ''}
            <span class="db-edh-meta">${synPct ? `<span class="db-edh-syn">${synPct}</span>` : ''}${incCount ? `<span class="db-edh-inc">${incCount}</span>` : ''}</span>
          </div>
          ${addBtn}
        </div>`;
      }).join('');
      if (!cards) return '';
      return `<div class="db-edh-section">
        <div class="db-edh-header">${esc(header)}</div>
        ${cards}
      </div>`;
    }).join('');

  el.innerHTML = `
    ${sections || '<div class="empty-state" style="padding:1rem">No recommendations found</div>'}
    <div style="font-size:.72rem;color:var(--muted);text-align:center;padding:.75rem 0">
      Recommendations powered by <a href="https://edhrec.com" target="_blank" rel="noopener" style="color:inherit">EDHREC</a>
    </div>`;
}

// ── New Deck modal ────────────────────────────────────────────────────────────
function dbShowNewDeck() {
  _dbPopulateNewDeckPlayers();
  document.getElementById('dbNewDeckName').value      = '';
  document.getElementById('dbNewDeckCommander').value = '';
  _closeDbCmdAc();
  document.getElementById('dbNewDeckOverlay').style.display = 'flex';
  setTimeout(() => document.getElementById('dbNewDeckName').focus(), 50);
}

function dbHideNewDeck() {
  document.getElementById('dbNewDeckOverlay').style.display = 'none';
}

async function dbCreateDeck() {
  const playerId = document.getElementById('dbNewDeckPlayer')?.value;
  const name     = document.getElementById('dbNewDeckName')?.value.trim();
  const commander = document.getElementById('dbNewDeckCommander')?.value.trim();
  if (!playerId || !name) { alert('Player and Deck Name are required.'); return; }

  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  // Fetch commander image if provided
  let commanderImg = null;
  if (commander) {
    try {
      const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(commander)}`);
      if (r.ok) {
        const d = await r.json();
        commanderImg = d.image_uris?.art_crop || d.card_faces?.[0]?.image_uris?.art_crop || null;
        // Store card data
        dbCardData.set(d.name, d);
        if (d.card_faces?.[0]?.name) dbCardData.set(d.card_faces[0].name, d);
      }
    } catch {}
  }

  const deckId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `deck_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const newDeck = {
    id: deckId, source: 'manual', deckId: null, url: '',
    name, nameStatus: 'loaded', commander: commander || '',
    commanderImg, cardCount: null, bracket: null, deckUrl: '',
  };

  player.decks = [...(player.decks || []), newDeck];
  await saveToStorage();
  dbHideNewDeck();
  dbPopulateDeckSel();

  // Auto-select the new deck
  const sel = document.getElementById('dbDeckSel');
  if (sel) {
    sel.value = `${playerId}|${deckId}`;
    await dbSelectDeck(`${playerId}|${deckId}`);
  }
}

// ── Import: CSV ────────────────────────────────────────────────────────────────
async function _dbHandleCsvImport(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !dbDeck) return;
  if (!isMyPlayer(dbDeck.playerId)) { alert('You can only edit your own decks.'); return; }
  const text = await file.text();
  const parsed = _dbParseTextList(text);
  await _dbImportCards(parsed);
}

// ── Import: text paste ────────────────────────────────────────────────────────
function dbShowImportText() {
  if (!dbDeck) { alert('Select a deck first.'); return; }
  document.getElementById('dbImportTextArea').value = '';
  document.getElementById('dbImportTextOverlay').style.display = 'flex';
  setTimeout(() => document.getElementById('dbImportTextArea').focus(), 50);
}

function dbHideImportText() {
  document.getElementById('dbImportTextOverlay').style.display = 'none';
}

async function dbImportText() {
  const text = document.getElementById('dbImportTextArea')?.value || '';
  dbHideImportText();
  const parsed = _dbParseTextList(text);
  await _dbImportCards(parsed);
}

function _dbParseTextList(text) {
  const lines   = text.split('\n');
  const results = []; // [{name, qty, category}]
  let   curCat  = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('#')) {
      curCat = line.replace(/^\/\/|^#/, '').trim();
      continue;
    }
    // "1x Card Name" or "1 Card Name" or "Card Name"
    const m = line.match(/^(\d+)[x\s]+(.+)$/) || line.match(/^(.+)$/);
    if (!m) continue;
    let qty = 1, name = '';
    if (m.length === 3) { qty = parseInt(m[1], 10) || 1; name = m[2].trim(); }
    else                { name = m[1].trim(); }
    if (name) results.push({ name, qty, category: curCat });
  }
  return results;
}

async function _dbImportCards(cards) {
  if (!cards.length || !dbDeck) return;
  document.getElementById('dbDeckContent').innerHTML =
    '<div class="empty-state" style="padding:2rem 1rem">Importing cards…</div>';

  const names = [...new Set(cards.map(c => c.name))];
  await dbFetchCardData(names);

  for (const { name, qty, category } of cards) {
    const finalCat = category || dbAutoCategory(name);
    dbEnsureCat(finalCat);
    const existing = dbCards.find(c => c.card_name === name);
    if (existing) { existing.qty = (existing.qty || 1) + qty; }
    else          { dbCards.push({ card_name: name, qty, category: finalCat, position: dbCards.length }); }
  }

  dbRender();
  dbRenderStats();
  _dbScheduleSave();
}

// ── Export ────────────────────────────────────────────────────────────────────
function dbToggleExport(e) {
  e?.stopPropagation();
  const menu = document.getElementById('dbExportMenu');
  if (menu) menu.style.display = menu.style.display === 'none' ? '' : 'none';
}

function _dbExportText() {
  const lines = [];
  for (const cat of dbCats) {
    const catCards = dbCards.filter(c => (c.category || dbAutoCategory(c.card_name)) === cat.name);
    if (!catCards.length) continue;
    lines.push(`// ${cat.name}`);
    for (const c of catCards) lines.push(`${c.qty || 1} ${c.card_name}`);
    lines.push('');
  }
  return lines.join('\n');
}

function dbExportClipboard() {
  if (!dbDeck) return;
  navigator.clipboard.writeText(_dbExportText()).then(() => {
    _dbSetSaveStatus('Copied ✓');
    setTimeout(() => _dbSetSaveStatus(''), 2000);
  });
  document.getElementById('dbExportMenu').style.display = 'none';
}

function dbExportCsv() {
  if (!dbDeck) return;
  const rows = ['qty,name', ...dbCards.map(c => `${c.qty || 1},"${c.card_name.replace(/"/g,'""')}"`)];
  _dbDownload(`${dbDeck.name}.csv`, rows.join('\n'), 'text/csv');
  document.getElementById('dbExportMenu').style.display = 'none';
}

function dbExportTxt() {
  if (!dbDeck) return;
  _dbDownload(`${dbDeck.name}.txt`, _dbExportText(), 'text/plain');
  document.getElementById('dbExportMenu').style.display = 'none';
}

function _dbDownload(filename, content, type) {
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Load for comparison (sends to Collections tab) ────────────────────────────
function dbLoadForComparison() {
  if (!dbDeck || !dbCards.length) return;
  const cards = new Map();
  for (const c of dbCards) {
    const ex = cards.get(c.card_name);
    if (ex) ex.qty += (c.qty || 1);
    else cards.set(c.card_name, { name: c.card_name, qty: c.qty || 1 });
  }
  deck       = { name: dbDeck.name, cards };
  deckFilter = false;
  document.getElementById('deckFilterBtn').classList.remove('active');
  setTab('collections');
  renderDeck();
  renderResults();
}

// ── Legacy DVD compatibility (dvGetCategory, dvFetchScryfall etc. removed — ──
// the old Deck View tab no longer exists. Any external reference should use ──
// the new dbXxx API instead.) ──────────────────────────────────────────────────
