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
    id:       `p_${Date.now()}`,
    name,
    color:    PLAYER_COLORS[state.players.length % PLAYER_COLORS.length],
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
  if (addPlayerByName(inp.value.trim())) inp.value = '';
}

function confirmWantAddPlayer() {
  const inp = document.getElementById('wantNewPlayerInput');
  if (addPlayerByName(inp.value.trim())) inp.value = '';
}

function removePlayer(playerId) {
  state.players = state.players.filter(p => p.id !== playerId);
  saveToStorage();
  renderPlayers();
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

  // If Archidekt URL given, fetch extra metadata (card count, bracket, etc.)
  if (parsed && USE_LOCAL) {
    try {
      const data = await fetchDeckData(parsed.source, parsed.deckId);
      // Only override commander if the user left it blank
      if (!commanderVal && data.commander) entry.commander = data.commander;
      entry.cardCount = data.cardCount;
      entry.bracket   = data.bracket;
      entry._cards    = data.cards;
    } catch (e) {
      console.warn('Archidekt deck fetch failed:', e.message);
    }
  }

  // Fetch commander art crop from Scryfall
  if (entry.commander) {
    await ensureScryfallImages([entry.commander]);
    entry.commanderImg = scryfallArtCache.get(entry.commander) || null;
  }

  entry.nameStatus = 'loaded';
  saveToStorage();
  renderPlayers();
}

function removeDeck(playerId, deckId) {
  const player = state.players.find(p => p.id === playerId);
  if (player) player.decks = player.decks.filter(d => d.id !== deckId);
  saveToStorage();
  renderPlayers();
}

async function loadPlayerDeck(playerId, deckId) {
  const player = state.players.find(p => p.id === playerId);
  const entry  = player?.decks.find(d => d.id === deckId);
  if (!entry) return;

  let cards = entry._cards;
  let name  = entry.name;

  if (!cards && entry.source !== 'manual' && entry.deckId && USE_LOCAL) {
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

  saveToStorage();
}

// ── Render players ────────────────────────────────────────────────────────

function renderPlayers() {
  const list = document.getElementById('playersList');
  if (!list) return;

  if (!state.players.length) {
    list.innerHTML = `<div style="color:var(--muted);font-size:.9rem;text-align:center;padding:3rem 1rem">
      No players yet — add one above to get started.
    </div>`;
    return;
  }

  list.innerHTML = state.players.map(player => {
    const tilesHTML = player.decks.map(d => {
      if (d.editing) {
        return `<div class="deck-tile-edit" data-deck-id="${d.id}">
          <div class="edit-label">Edit Deck</div>
          <input type="text" name="edit-name"       value="${esc(d.name)}"      placeholder="Deck name…">
          <input type="text" name="edit-commander"  value="${esc(d.commander)}" placeholder="Commander name…">
          <input type="text" name="edit-url"        value="${esc(d.deckUrl)}"   placeholder="Link (any URL, e.g. moxfield.com/decks/…)"
                 onkeydown="if(event.key==='Enter')saveEditDeck('${player.id}','${d.id}')">
          <div style="display:flex;gap:.4rem;margin-top:.1rem">
            <button class="btn-primary"   style="flex:1;padding:.35rem .6rem;font-size:.82rem" onclick="saveEditDeck('${player.id}','${d.id}')">Save</button>
            <button class="btn-secondary" style="padding:.35rem .6rem;font-size:.82rem"         onclick="cancelEditDeck('${player.id}','${d.id}')">Cancel</button>
          </div>
        </div>`;
      }

      const srcLabel     = d.source === 'archidekt' ? 'Archidekt' : 'Manual';
      const busy         = d.nameStatus === 'loading';
      const nameClass    = d.nameStatus === 'loading' ? 'loading' : d.nameStatus === 'error' ? 'error' : '';
      const bgStyle      = d.commanderImg ? `background-image:url('${d.commanderImg}')` : '';
      const bracketBadge = d.bracket != null ? `<span class="badge-bracket">Bracket ${d.bracket}</span>` : '';
      const viewLink     = d.deckUrl
        ? `<a class="deck-tile-link" href="${esc(d.deckUrl)}" target="_blank" rel="noopener">View ↗</a>` : '';
      const countInfo    = d.cardCount ? `${d.cardCount} cards` : '';
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
          </div>
          <div class="deck-tile-bottom">
            <span class="deck-tile-count">${countInfo}</span>
            <button class="btn-load-tile"  onclick="loadPlayerDeck('${player.id}','${d.id}')" ${busy ? 'disabled' : ''}>Load</button>
            <button class="btn-edit-tile"  onclick="startEditDeck('${player.id}','${d.id}')">Edit</button>
            <button class="btn-remove-tile" onclick="removeDeck('${player.id}','${d.id}')">✕</button>
          </div>
        </div>
      </div>`;
    }).join('');

    const pCollapsed = !!collapseState[`player-${player.id}`];
    return `<div class="player-section">
      <div class="player-header" style="--pc:${player.color}" onclick="togglePlayerSection('${player.id}', event)">
        <span class="player-name-lbl">${esc(player.name)}</span>
        <button class="btn-player-add-deck" onclick="openAddDeck('${player.id}')">+ Add Deck</button>
        <button class="btn-player-remove" onclick="removePlayer('${player.id}')">✕</button>
        <svg class="chevron ${pCollapsed ? 'closed' : ''}" id="chv-player-${player.id}" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="add-deck-form" id="adf_${player.id}" data-player="${player.id}">
        <input type="text" name="deckname"  placeholder="Deck name…"              style="flex:1;min-width:130px">
        <input type="text" name="commander" placeholder="Commander name…"          style="flex:1.2;min-width:160px">
        <input type="text" name="deckurl"   placeholder="Archidekt URL (optional)" style="flex:1.5;min-width:200px"
               onkeydown="if(event.key==='Enter')confirmAddDeck('${player.id}')">
        <div class="form-btns">
          <button class="btn-primary"   style="padding:.35rem .7rem;font-size:.82rem" onclick="confirmAddDeck('${player.id}')">Add</button>
          <button class="btn-secondary" style="padding:.35rem .7rem;font-size:.82rem" onclick="document.getElementById('adf_${player.id}').classList.remove('open')">Cancel</button>
        </div>
      </div>
      <div class="deck-tiles-grid ${pCollapsed ? 'closed' : ''}" id="pb-player-${player.id}"
           style="${pCollapsed ? 'display:none' : ''}">${tilesHTML ||
        `<div style="color:var(--muted);font-size:.85rem;font-style:italic;padding:.5rem 0">No decks yet — click + Add Deck above.</div>`
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
      <a class="deck-card-link" href="${href}" target="_blank" rel="noopener" title="${esc(c.name)}">${esc(c.name)}</a>
      <span class="deck-deck-qty">×${c.qty}</span>
      <span class="deck-col-qty ${isFound ? 'cq-found' : 'cq-missing'}">${total || '—'}</span>
    </div>`;
  }).join('');
}
