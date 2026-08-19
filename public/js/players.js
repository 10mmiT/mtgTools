// ── Parse deck URL ────────────────────────────────────────────────────────
function parseDeckUrl(raw) {
  raw = (raw || '').trim();
  if (!raw) return null;
  const ark = raw.match(/archidekt\.com\/decks?\/(\d+)/i);
  if (ark) return { source: 'archidekt', deckId: ark[1] };
  return null;
}

// ── Fetch deck data from server proxy ─────────────────────────────────────
async function fetchDeckData(source, deckId) {
  const url = source === 'moxfield'
    ? `/api/moxfield/deck/${deckId}`
    : `/api/archidekt/deck/${deckId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  const name    = data.name || 'Unnamed deck';
  const cards   = new Map();
  let commander = '';
  let cardCount = 0;
  let bracket   = null;
  let deckUrl   = '';

  if (source === 'archidekt') {
    deckUrl = `https://archidekt.com/decks/${deckId}`;
    bracket = data.deckBracket ?? data.powerLevel ?? null;

    for (const item of (data.cards || [])) {
      const cardName = item.card?.oracleCard?.name || item.card?.name || '';
      const qty = item.quantity || 0;
      if (!cardName || qty <= 0) continue;
      if (!commander && (item.categories || []).some(c => /commander/i.test(c)))
        commander = cardName;
      const ex = cards.get(cardName);
      if (ex) ex.qty += qty; else cards.set(cardName, { name: cardName, qty });
      cardCount += qty;
    }
  }

  return { name, cards, commander, cardCount, bracket, deckUrl };
}

// ── Player management ─────────────────────────────────────────────────────

function addPlayerByName(name) {
  if (!name) return false;
  state.players.push({
    id:       (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `p_${Date.now()}`,
    name,
    colorIdx: state.players.length % PLAYER_SLOTS,
    decks:    [],
    wantList: [],
  });
  saveToStorage();
  renderPlayers();
  renderWantList();
  return true;
}

function confirmAddPlayer() {
  const inp = document.getElementById('playerNameInput');
  if (addPlayerByName(inp.value.trim())) { inp.value = ''; closeAddPlayer(); }
}

// Progressive disclosure: the add-player bar shows a single button until clicked
function openAddPlayer() {
  document.getElementById('addPlayerRevealBtn').style.display = 'none';
  document.getElementById('addPlayerForm').style.display = 'flex';
  document.getElementById('playerNameInput').focus();
}

function closeAddPlayer() {
  document.getElementById('addPlayerForm').style.display = 'none';
  document.getElementById('addPlayerRevealBtn').style.display = '';
}

function removePlayer(playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;
  const nDecks = (player.decks || []).length;
  if (!confirm(`Remove player "${player.name}"${nDecks ? ` and their ${nDecks} deck${nDecks !== 1 ? 's' : ''}` : ''}? This cannot be undone.`)) return;
  state.players = state.players.filter(p => p.id !== playerId);
  /* Their decks go with them; their collections do not. The cards are still
   * in the house, so a collection they owned becomes the group's — the same
   * clearing routes/state.js does to the row a moment later, done here so the
   * chip stops naming somebody who is gone before the next load. */
  for (const col of state.collections) if (col.owner === playerId) col.owner = null;
  saveToStorage();
  renderPlayers();
  renderCollections();
  renderResults();
}

// ── Deck management ───────────────────────────────────────────────────────

function openAddDeck(playerId) {
  // Close any other open add-deck forms
  document.querySelectorAll('.add-deck-form.open').forEach(el => {
    if (el.dataset.player !== playerId) el.classList.remove('open');
  });
  const form = document.getElementById(`adf_${playerId}`);
  if (form) { form.classList.toggle('open'); form.querySelector('input').focus(); }
}

async function confirmAddDeck(playerId) {
  const form         = document.getElementById(`adf_${playerId}`);
  const nameInput    = form.querySelector('[name="deckname"]');
  const cmdInput     = form.querySelector('[name="commander"]');
  const urlInput     = form.querySelector('[name="deckurl"]');

  const deckNameVal  = nameInput.value.trim();
  const commanderVal = cmdInput.value.trim();
  const urlVal       = urlInput.value.trim();

  // Need at least a deck name
  if (!deckNameVal) { nameInput.style.borderColor = 'var(--danger)'; return; }
  nameInput.style.borderColor = '';

  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  // Any URL is valid as a link; only Archidekt URLs also enable card fetching
  const normUrl = normaliseUrl(urlVal);
  const parsed  = parseDeckUrl(normUrl);

  const entry = {
    id:           `d_${Date.now()}`,
    source:       parsed ? 'archidekt' : 'manual',
    deckId:       parsed ? parsed.deckId : null,
    url:          normUrl,
    name:         deckNameVal,
    nameStatus:   'loading',
    commander:    commanderVal,
    commanderImg: null,
    cardCount:    null,
    bracket:      null,
    deckUrl:      normUrl,
    editing:      false,
  };

  player.decks.push(entry);
  nameInput.value = '';
  cmdInput.value  = '';
  urlInput.value  = '';
  form.classList.remove('open');
  renderPlayers();
  console.log(`[deck] pushed "${entry.name}" (id=${entry.id}) to player "${player.name}" — saving early`);

  await savePlayerDecks(playerId);
  console.log(`[deck] early save complete — deck is now in DB`);

  try {
    if (parsed) {
      console.log(`[deck] fetching Archidekt metadata for deck ${parsed.deckId}`);
      try {
        const data = await fetchDeckData(parsed.source, parsed.deckId);
        if (!commanderVal && data.commander) entry.commander = data.commander;
        entry.cardCount = data.cardCount;
        entry.bracket   = data.bracket;
        entry._cards    = data.cards;
        console.log(`[deck] Archidekt fetch done — commander="${entry.commander}"`);
      } catch (e) {
        console.warn('[deck] Archidekt fetch failed:', e.message);
      }
    }

    if (entry.commander) {
      console.log(`[deck] fetching Scryfall art for "${entry.commander}"`);
      await ensureScryfallImages([entry.commander]);
      entry.commanderImg = scryfallArtCache.get(entry.commander) || null;
      console.log(`[deck] Scryfall art done — commanderImg=${entry.commanderImg ? 'set' : 'null'}`);
    }
  } finally {
    const livePlayer = state.players.find(p => p.id === playerId);
    const liveDeck   = livePlayer?.decks.find(d => d.id === entry.id);
    console.log(`[deck] finally — liveDeck found in state: ${!!liveDeck} (player still in state: ${!!livePlayer})`);
    const target     = liveDeck || entry;
    target.commander    = entry.commander;
    target.commanderImg = entry.commanderImg;
    target.cardCount    = entry.cardCount;
    target.bracket      = entry.bracket;
    if (entry._cards) target._cards = entry._cards;
    target.nameStatus   = 'loaded';
    console.log(`[deck] final save — target is ${liveDeck ? 'live object' : 'ORPHANED entry (hydrateState ran!)'}`);
    await savePlayerDecks(playerId);
    renderPlayers();
  }
}

function removeDeck(playerId, deckId) {
  const player = state.players.find(p => p.id === playerId);
  const entry  = player?.decks.find(d => d.id === deckId);
  if (!entry) return;
  if (!confirm(`Remove deck "${entry.name}"? This cannot be undone.`)) return;
  player.decks = player.decks.filter(d => d.id !== deckId);
  savePlayerDecks(playerId);
  renderPlayers();
}

async function loadPlayerDeck(playerId, deckId) {
  const player = state.players.find(p => p.id === playerId);
  const entry  = player?.decks.find(d => d.id === deckId);
  if (!entry) return;

  let cards = entry._cards;
  let name  = entry.name;

  if (!cards && entry.source !== 'manual' && entry.deckId) {
    entry.nameStatus = 'loading';
    renderPlayers();
    try {
      const data = await fetchDeckData(entry.source, entry.deckId);
      cards = data.cards;
      name  = data.name;
      entry._cards = cards;
      entry.nameStatus = 'loaded';
    } catch (e) {
      entry.nameStatus = 'error';
      renderPlayers();
      alert(`Could not load deck: ${e.message}`);
      return;
    }
    renderPlayers();
  }

  if (!cards) {
    alert('This deck was added manually without a card list — add an Archidekt URL to enable comparison.');
    return;
  }

  // Load into the deck comparison panel and switch to Collections tab
  deck = { name, cards };
  deckFilter = false;
  document.getElementById('deckFilterBtn').classList.remove('active');
  setTab('collections');
  renderDeck();
  renderResults();
}

function openInDeckView(playerId, deckId) {
  setTab('deckview');
  const sel = document.getElementById('dbDeckSel');
  const val = `${playerId}|${deckId}`;
  if (sel && [...sel.options].some(o => o.value === val)) {
    sel.value = val;
    dbSelectDeck(val);
  }
}

// ── Edit deck ─────────────────────────────────────────────────────────────
function startEditDeck(playerId, deckId) {
  const player = state.players.find(p => p.id === playerId);
  const entry  = player?.decks.find(d => d.id === deckId);
  if (!entry) return;
  entry.editing = true;
  renderPlayers();
}

function cancelEditDeck(playerId, deckId) {
  const player = state.players.find(p => p.id === playerId);
  const entry  = player?.decks.find(d => d.id === deckId);
  if (!entry) return;
  entry.editing = false;
  renderPlayers();
}

async function saveEditDeck(playerId, deckId) {
  const player = state.players.find(p => p.id === playerId);
  const entry  = player?.decks.find(d => d.id === deckId);
  if (!entry) return;

  const tileEl = document.querySelector(`[data-deck-id="${deckId}"]`);
  if (!tileEl) return;

  const newName = tileEl.querySelector('[name="edit-name"]')?.value.trim() || '';
  const newCmd  = tileEl.querySelector('[name="edit-commander"]')?.value.trim() || '';
  const rawUrl  = tileEl.querySelector('[name="edit-url"]')?.value.trim() || '';

  if (!newName) {
    tileEl.querySelector('[name="edit-name"]').style.borderColor = 'var(--danger)';
    return;
  }

  const normUrl    = normaliseUrl(rawUrl);
  const parsed     = parseDeckUrl(normUrl);
  const cmdChanged = newCmd !== entry.commander;

  entry.name    = newName;
  entry.deckUrl = normUrl;
  entry.url     = normUrl;
  if (parsed) { entry.source = 'archidekt'; entry.deckId = parsed.deckId; }
  if (cmdChanged) { entry.commander = newCmd; entry.commanderImg = null; }
  entry.editing = false;

  renderPlayers();

  if (cmdChanged && newCmd) {
    await ensureScryfallImages([newCmd]);
    entry.commanderImg = scryfallArtCache.get(newCmd) || null;
    renderPlayers();
  }

  savePlayerDecks(playerId);
}

// ── Whose decks this tab is showing ─────────────────────────────────────────
// The tab lands you on a grid of your own built decks; a Mine / Everyone toggle
// flips to the old per-player sections. This mirrors the Collections tab's
// shelf scope (js/collections.js) — same "Mine needs somebody to be" rule, same
// hide-the-control-when-nobody, its own localStorage key. It differs in one
// place: the default is Mine here (the tab's headline) where Collections
// defaults to Everyone.

const DECK_SCOPE_KEY = 'mtgtools_deck_scope';

/* Which view the tab is on — 'mine' or 'all'. "Mine" needs an identity, so an
 * app that cannot say who you are reads 'all' whatever is stored: the control
 * is not offered in that case, and a preference from a browser that once knew
 * must not quietly hide every deck from somebody who cannot switch it back. */
function deckScope() {
  if (!myPlayerId()) return 'all';
  // Default Mine — the headline of the tab is your own decks. Only an explicit
  // 'all' reads as Everyone; anything else (unset, or a stale value) is Mine.
  try { return localStorage.getItem(DECK_SCOPE_KEY) === 'all' ? 'all' : 'mine'; }
  catch { return 'mine'; }
}

function setDeckScope(scope) {
  try { localStorage.setItem(DECK_SCOPE_KEY, scope === 'mine' ? 'mine' : 'all'); } catch {}
  renderPlayers();
}

/* Mounted once in the toolbar, synced on every render. Hidden — not disabled —
 * when the app cannot say who you are, the way syncColScope does it: with
 * nobody to be there is no "mine" to offer, so the whole mount goes and the tab
 * is the Everyone view. */
function syncDeckScope() {
  const host = document.getElementById('deckScopeMount');
  if (!host) return;
  const me = myPlayerId();
  host.classList.toggle('scope-mount-hidden', !me);
  const sel = document.getElementById('deckScopeSel');
  if (sel) sel.value = deckScope();
}

/* Who you are can change while the app is open — in open mode it is a name
 * typed into Available@'s "Who are you?" bar — and it decides whether this tab
 * shows your grid or everyone's sections. Called from there, mirroring
 * colIdentityChanged. */
let _deckIdentity = null;
function deckIdentityChanged() {
  const now = myPlayerId();
  if (now === _deckIdentity) return;
  _deckIdentity = now;
  renderPlayers();
}

// ── Render one deck tile ────────────────────────────────────────────────────
// The tile the grid and the sections both draw. `player` owns the deck; the
// action handlers are keyed by the pair, and `canEdit` gates the ⋯ menu.
function deckTileHtml(player, d, canEdit) {
  if (d.editing) {
    return `<div class="deck-tile-edit" data-deck-id="${d.id}">
      <div class="edit-label">Edit Deck</div>
      <input type="text" name="edit-name"       value="${esc(d.name)}"      placeholder="Deck name…">
      <input type="text" name="edit-commander"  value="${esc(d.commander)}" placeholder="Commander name…">
      <input type="text" name="edit-url"        value="${esc(d.deckUrl)}"   placeholder="Link (any URL, e.g. moxfield.com/decks/…)"
             onkeydown="if(event.key==='Enter')saveEditDeck('${player.id}','${d.id}')">
      <div style="display:flex;gap:var(--space-2);margin-top:var(--space-1)">
        <button class="btn-primary"   style="flex:1;padding:var(--space-1) var(--space-2);font-size:var(--text-sm)" onclick="saveEditDeck('${player.id}','${d.id}')">Save</button>
        <button class="btn-secondary" style="padding:var(--space-1) var(--space-2);font-size:var(--text-sm)"         onclick="cancelEditDeck('${player.id}','${d.id}')">Cancel</button>
      </div>
    </div>`;
  }

  const srcLabel     = d.source === 'archidekt' ? 'Archidekt' : 'Manual';
  const busy         = d.nameStatus === 'loading';
  const nameClass    = d.nameStatus === 'loading' ? 'loading' : d.nameStatus === 'error' ? 'error' : '';
  const bgStyle      = d.commanderImg ? `background-image:url('${d.commanderImg}')` : '';
  /* What bracket its owner says it is. Drawn by js/deckview-legality.js,
     which is where the five brackets are named and where the declaration is
     made — this tile is one of the places the answer is read. */
  const bracketBadge = dbBracketBadgeHtml(d.bracket);
  const viewLink     = d.deckUrl
    ? `<a class="deck-tile-link" href="${esc(d.deckUrl)}" target="_blank" rel="noopener">View ↗</a>` : '';
  // The count sits with the name and the commander rather than on the
  // action row: it is something the deck *is*, not something to do to
  // it, and on a 260px tile the row it used to share has only enough
  // width for the three controls.
  const countInfo    = d.cardCount ? `<div class="deck-tile-meta">${d.cardCount} cards</div>` : '';
  const cmdLine      = d.commander
    ? `<div class="deck-tile-commander">Commander: ${esc(d.commander)}</div>` : '';

  return `<div class="deck-tile" data-deck-id="${d.id}" style="${bgStyle}">
    <div class="deck-tile-overlay">
      <div class="deck-tile-top">
        <span class="deck-source-badge">${srcLabel}</span>
        ${bracketBadge}
        ${viewLink}
      </div>
      <div class="deck-tile-middle">
        <div class="deck-tile-name ${nameClass}">${esc(d.name)}</div>
        ${cmdLine}
        ${countInfo}
      </div>
      <div class="deck-tile-bottom">
        <button class="btn-load-tile" onclick="loadPlayerDeck('${player.id}','${d.id}')" ${busy ? 'disabled' : ''}>Compare</button>
        <button class="btn-dv-tile" onclick="openInDeckView('${player.id}','${d.id}')" title="Open in Deck Builder">Build</button>
        ${canEdit ? kebabMenuHtml([
          { label: 'Edit',   onclick: `startEditDeck('${player.id}','${d.id}')` },
          { divider: true },
          { label: 'Remove', onclick: `removeDeck('${player.id}','${d.id}')`, danger: true },
        ], { title: 'Deck actions', btnClass: 'kebab-btn-tile' }) : ''}
      </div>
    </div>
  </div>`;
}

// ── Render the tab ──────────────────────────────────────────────────────────

function renderPlayers() {
  const list = document.getElementById('playersList');
  if (!list) return;

  // The first render records who you are, so deckIdentityChanged can tell a
  // real change from the initial paint. syncDeckScope shows or hides the
  // toolbar control to match.
  _deckIdentity = myPlayerId();
  syncDeckScope();

  const scope = deckScope();
  // Player administration — + Add Player — lives in the Everyone view, where
  // the per-player sections are. The Mine grid is only your own decks.
  const addBtn = document.getElementById('addPlayerRevealBtn');
  if (addBtn) addBtn.style.display = scope === 'mine' ? 'none' : '';

  if (scope === 'mine') renderMineGrid(list);
  else                  renderEveryone(list);
}

// A flat grid of your own *built* decks. "Built" is the server's signal —
// deckCardCounts[id] > 0 means the Deck Builder has saved deck_cards rows for
// it; a deck that is only a name and a link never appears here.
function renderMineGrid(list) {
  const me      = myPlayerId();
  const player  = state.players.find(p => p.id === me);
  const canEdit = currentUser?.role === 'admin' || isMyPlayer(me);
  const built   = (player?.decks || []).filter(d => (state.deckCardCounts[d.id] || 0) > 0);

  const info = document.getElementById('playersInfo');
  if (info) info.textContent = built.length
    ? `${built.length} deck${built.length !== 1 ? 's' : ''}`
    : '';

  if (!built.length) {
    list.innerHTML = '<div class="empty-state">No built decks yet — open a deck in the Deck Builder to import its cards, or switch to Everyone’s decks above.</div>';
    return;
  }

  list.innerHTML =
    `<div class="deck-tiles-grid">${built.map(d => deckTileHtml(player, d, canEdit)).join('')}</div>`;
}

// The old per-player sectioned layout, demoted from default. Every player is a
// collapsible section, editing enabled only where you own the player or are an
// admin. Other players' private decks never arrive from the server, so there
// is nothing to hide here.
function renderEveryone(list) {
  const isAdmin = currentUser?.role === 'admin';

  // The strip's count, in the slot every other tab gives its result count.
  const info = document.getElementById('playersInfo');
  if (info) {
    const nPlayers = state.players.length;
    const nDecks   = state.players.reduce((n, p) => n + (p.decks || []).length, 0);
    info.textContent = nPlayers
      ? `${nPlayers} player${nPlayers !== 1 ? 's' : ''} · ${nDecks} deck${nDecks !== 1 ? 's' : ''}`
      : '';
  }

  if (!state.players.length) {
    list.innerHTML = '<div class="empty-state">No players yet — add one above to get started.</div>';
    return;
  }

  list.innerHTML = state.players.map(player => {
    const canEdit = isAdmin || isMyPlayer(player.id);

    const tilesHTML = player.decks.map(d => deckTileHtml(player, d, canEdit)).join('');

    const pCollapsed = !!collapseState[`player-${player.id}`];
    return `<div class="player-section">
      <div class="player-header" style="--pc:${playerColor(player)}" onclick="togglePlayerSection('${player.id}', event)">
        <span class="player-dot"></span>
        <span class="player-name-lbl">${esc(player.name)}</span>
        ${canEdit ? `<button class="btn-secondary" onclick="openAddDeck('${player.id}')">+ Add Deck</button>` : ''}
        ${isAdmin ? kebabMenuHtml([
          { label: 'Remove player', onclick: `removePlayer('${player.id}')`, danger: true },
        ], { title: 'Player actions' }) : ''}
        <svg class="chevron ${pCollapsed ? 'closed' : ''}" id="chv-player-${player.id}" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      ${canEdit ? `<div class="add-deck-form" id="adf_${player.id}" data-player="${player.id}">
        <input type="text" name="deckname"  placeholder="Deck name…"              style="flex:1;min-width:130px">
        <input type="text" name="commander" placeholder="Commander name…"          style="flex:1.2;min-width:160px">
        <input type="text" name="deckurl"   placeholder="Archidekt URL (optional)" style="flex:1.5;min-width:200px"
               onkeydown="if(event.key==='Enter')confirmAddDeck('${player.id}')">
        <div class="form-btns">
          <button class="btn-primary"   style="padding:var(--space-1) var(--space-3);font-size:var(--text-sm)" onclick="confirmAddDeck('${player.id}')">Add</button>
          <button class="btn-secondary" style="padding:var(--space-1) var(--space-3);font-size:var(--text-sm)" onclick="document.getElementById('adf_${player.id}').classList.remove('open')">Cancel</button>
        </div>
      </div>` : ''}
      <div class="deck-tiles-grid ${pCollapsed ? 'closed' : ''}" id="pb-player-${player.id}"
           style="${pCollapsed ? 'display:none' : ''}">${tilesHTML ||
        `<div class="player-no-decks">No decks yet${canEdit ? ' — click + Add Deck above' : ''}.</div>`
      }</div>
    </div>`;
  }).join('');
}

// ── Deck state ────────────────────────────────────────────────────────────
let deck       = null; // { name, cards: Map<name, qty> }
let deckFilter = false;

function parseDeckCSV(text, filename) {
  const rows = parseCSVRows(text);
  if (!rows.length) throw new Error('CSV appears to be empty.');
  const cards = new Map();
  for (const row of rows) {
    if (row.length < 2) continue;
    const qty  = parseInt(row[0], 10);
    const name = (row[1] || '').trim();
    if (!name || isNaN(qty) || qty <= 0) continue;
    const ex = cards.get(name);
    if (ex) ex.qty += qty; else cards.set(name, { name, qty });
  }
  if (!cards.size) throw new Error('No valid cards found in deck CSV.');
  return { name: filename.replace(/\.csv$/i, ''), cards };
}

document.getElementById('deckInput').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      deck = parseDeckCSV(ev.target.result, file.name);
      renderDeck();
      renderResults();
    } catch (err) {
      alert('Could not parse deck CSV: ' + err.message);
    }
  };
  reader.readAsText(file);
});

function clearDeck() {
  deck = null;
  if (deckFilter) { deckFilter = false; }
  renderDeck();
  renderResults();
}

function toggleDeckFilter() {
  if (!deck) return;
  deckFilter = !deckFilter;
  document.getElementById('deckFilterBtn').classList.toggle('active', deckFilter);
  renderResults();
}

function renderDeck() {
  const emptyEl  = document.getElementById('deckEmpty');
  const loadedEl = document.getElementById('deckLoaded');
  const filterBtn = document.getElementById('deckFilterBtn');

  if (!deck) {
    emptyEl.style.display  = '';
    loadedEl.style.display = 'none';
    filterBtn.classList.remove('active');
    return;
  }

  emptyEl.style.display  = 'none';
  loadedEl.style.display = 'flex';

  document.getElementById('deckName').textContent = deck.name;

  // Compute collection totals per card
  const colTotals = new Map();
  state.collections.forEach(col => {
    col.cards.forEach((card, name) => {
      colTotals.set(name, (colTotals.get(name) || 0) + card.qty);
    });
  });

  const deckCards = [...deck.cards.values()];
  const found = deckCards.filter(c => colTotals.get(c.name) > 0).length;
  document.getElementById('deckStats').textContent =
    `${found} / ${deckCards.length} cards found in collections`;

  // Sort: found first, then alpha
  const sorted = [...deckCards].sort((a, b) => {
    const af = colTotals.get(a.name) > 0, bf = colTotals.get(b.name) > 0;
    if (af !== bf) return af ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  document.getElementById('deckList').innerHTML = sorted.map(c => {
    const total  = colTotals.get(c.name) || 0;
    const isFound = total > 0;
    const href   = `https://scryfall.com/search?q=!%22${encodeURIComponent(c.name)}%22`;
    return `<div class="deck-row">
      <span class="deck-dot ${isFound ? 'dot-found' : 'dot-missing'}"></span>
      <a class="deck-card-link card-open" href="${href}" target="_blank" rel="noopener" data-name="${esc(c.name)}" title="${esc(c.name)}">${esc(c.name)}</a>
      <span class="deck-deck-qty">×${c.qty}</span>
      <span class="deck-col-qty ${isFound ? 'cq-found' : 'cq-missing'}">${total || '—'}</span>
    </div>`;
  }).join('');
}
