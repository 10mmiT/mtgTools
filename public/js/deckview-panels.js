// ── Deck Builder — Panels: search, autocomplete, drag-drop, EDHREC, import/export ─────────────────────────────────────────
// Split from the former monolithic deckview.js. All deck-builder scripts share
// one global scope (classic scripts), so state declared in deckview-core.js is
// visible here and functions stay global for inline onclick handlers.

// ── Autocomplete: add-card input ──────────────────────────────────────────────
function dbAddAcInput() {
  clearTimeout(dbAddAcTimer);
  const q = document.getElementById('dbAddCardInput')?.value.trim();
  if (q.length < 2) { closeDbAddAc(); return; }
  dbAddAcTimer = setTimeout(async () => {
    try {
      const names = (await cardAutocomplete(q)).slice(0, 8);
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
      const names = (await cardAutocomplete(q)).slice(0, 8);
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
      const names = (await cardAutocomplete(q, { commander: true })).slice(0, 8);
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
    const res  = await scryfallFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=name&page=1`);
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
      const r = await scryfallFetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(commander)}`);
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

// ── Topbar "More" menu ──────────────────────────────────────────────────────
function dbToggleMoreMenu(e) {
  e?.stopPropagation();
  document.getElementById('dbMoreMenu')?.classList.toggle('open');
}

function dbCloseMoreMenu() {
  document.getElementById('dbMoreMenu')?.classList.remove('open');
}

// ── Export ────────────────────────────────────────────────────────────────────
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
}

function dbExportCsv() {
  if (!dbDeck) return;
  const rows = ['qty,name', ...dbCards.map(c => `${c.qty || 1},"${c.card_name.replace(/"/g,'""')}"`)];
  _dbDownload(`${dbDeck.name}.csv`, rows.join('\n'), 'text/csv');
}

function dbExportTxt() {
  if (!dbDeck) return;
  _dbDownload(`${dbDeck.name}.txt`, _dbExportText(), 'text/plain');
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
