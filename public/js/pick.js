// ── Random Deck Picker ────────────────────────────────────────────────────
let pickInitDone      = false;
let pickSelected      = new Set(); // player IDs chosen to play tonight
let pickExcludeOwn    = false;     // don't assign players their own decks
let pickResults       = null;      // [{player, deckEntry}] or null
let pickIncludedDeckIds = new Set(); // deck IDs opted into the pool (empty by default)

function initPick() {
  if (pickInitDone) { renderPickSetup(); renderPickPool(); return; }
  pickInitDone = true;
  renderPickSetup();
  renderPickPool();
}

// ── Setup panel ───────────────────────────────────────────────────────────

function renderPickSetup() {
  const listEl = document.getElementById('pickPlayersList');
  const infoEl = document.getElementById('pickPoolInfo');
  const btn    = document.getElementById('pickRollBtn');
  if (!listEl) return;

  const players = state.players;

  if (!players.length) {
    listEl.innerHTML = '';
    if (infoEl) infoEl.textContent = 'No players yet';
    if (btn)    btn.disabled = true;
    renderPickEmpty(0, false);
    return;
  }

  // Remove any selected IDs that no longer exist
  for (const id of pickSelected) {
    if (!players.find(p => p.id === id)) pickSelected.delete(id);
  }

  listEl.innerHTML = players.map(p => {
    const on = pickSelected.has(p.id);
    return `<button class="chip chip--select" aria-pressed="${on}"
        style="--pc:${playerColor(p)}"
        onclick="pickTogglePlayer('${p.id}')">
      <span class="chip-dot"></span>
      <span class="chip-label">${esc(p.name)}</span>
      ${on ? `<svg class="chip-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
    </button>`;
  }).join('');

  const allDecks = _allPickDecks();
  const n        = pickSelected.size;
  let   status   = '';
  let   canRoll  = false;

  if (n < 2)              status = 'Select 2–6 players';
  else if (n > 6)         status = 'Maximum 6 players';
  else if (!allDecks.length)    status = 'No decks in pool — choose some under “Deck Pool”';
  else if (allDecks.length < n) status = `Not enough decks — need ${n}, only ${allDecks.length} in pool`;
  else { status = `${allDecks.length} deck${allDecks.length !== 1 ? 's' : ''} in pool · ${n} player${n !== 1 ? 's' : ''} selected`; canRoll = true; }

  if (infoEl) infoEl.textContent = status;
  if (btn)    btn.disabled = !canRoll;

  // Sync exclude-own toggle (checkbox item inside the options "⋯" menu)
  const exCheck = document.getElementById('pickExcludeOwnCheck');
  if (exCheck) exCheck.textContent = pickExcludeOwn ? '☑' : '☐';

  renderPickEmpty(allDecks.length, canRoll);
}

/* Before the first roll the tab is a strip, a row of chips and — with the pool
 * now behind a button — nothing else. So the results area says what it is
 * waiting for, in the terms of whichever step is outstanding: an empty pool is
 * a different problem from an unchosen table, and the strip's status line is a
 * count rather than an instruction. */
function renderPickEmpty(poolSize, ready) {
  const el = document.getElementById('pickResults');
  if (!el || pickResults) return;
  const line = !state.players.length
    ? 'Add players and their decks on the Players &amp; Decks tab, and tonight’s draw can happen here.'
    : !poolSize
      ? 'Open <strong>Deck Pool</strong> and choose which decks are in tonight’s draw.'
      : ready
        ? 'Ready — <strong>Pick Decks</strong> deals one to each of them.'
        : 'Choose who’s playing tonight.';
  el.innerHTML = `<div class="empty-state">${line}</div>`;
}

function pickTogglePlayer(playerId) {
  if (pickSelected.has(playerId)) {
    pickSelected.delete(playerId);
  } else {
    if (pickSelected.size >= 6) return;
    pickSelected.add(playerId);
  }
  renderPickSetup();
}

function pickToggleExcludeOwn() {
  pickExcludeOwn = !pickExcludeOwn;
  renderPickSetup();
}

// ── Pool helpers ──────────────────────────────────────────────────────────

function _allPickDecks() {
  const list = [];
  for (const p of state.players) {
    for (const d of (p.decks || [])) {
      if (pickIncludedDeckIds.has(d.id)) list.push({ player: p, deck: d });
    }
  }
  return list;
}

function renderPickPool() {
  const el = document.getElementById('pickPoolDeckList');
  if (!el) return;
  const players = state.players;
  const btn     = document.getElementById('pickPoolBtn');

  if (!players.length) {
    el.innerHTML = '<div class="empty-state">No decks yet — add some in the Players &amp; Decks tab first.</div>';
    if (btn) btn.textContent = 'Deck Pool';
    return;
  }

  const allDecks = [];
  for (const p of players) for (const d of (p.decks || [])) allDecks.push({ p, d });
  const inPool = allDecks.filter(({ d }) => pickIncludedDeckIds.has(d.id)).length;

  // The count is on the button that opens the drawer, not inside it: it is
  // the one thing about the pool worth knowing without opening it.
  if (btn) btn.textContent = `Deck Pool · ${inPool} / ${allDecks.length}`;

  el.innerHTML = players.map(p => {
    const decks = p.decks || [];
    if (!decks.length) return '';
    return `<div class="pick-pool-group">
      <div class="pick-pool-player" style="color:${playerColor(p)};cursor:pointer" title="Toggle all of ${esc(p.name)}'s decks"
           onclick="pickTogglePlayerDecks('${p.id}')">${esc(p.name)}</div>
      <div class="pick-pool-chips">${decks.map(d => {
        const off = !pickIncludedDeckIds.has(d.id);
        return `<button class="pick-pool-chip${off ? ' pick-pool-chip-off' : ''}"
            onclick="pickToggleDeck('${d.id}')">${esc(d.name)}</button>`;
      }).join('')}</div>
    </div>`;
  }).join('');
}

function pickToggleDeck(deckId) {
  if (pickIncludedDeckIds.has(deckId)) pickIncludedDeckIds.delete(deckId);
  else pickIncludedDeckIds.add(deckId);
  renderPickPool();
  renderPickSetup();
}

// Click a player's name in the pool to toggle all of their decks at once
function pickTogglePlayerDecks(playerId) {
  const decks = state.players.find(p => p.id === playerId)?.decks || [];
  const allIn = decks.length && decks.every(d => pickIncludedDeckIds.has(d.id));
  for (const d of decks) {
    if (allIn) pickIncludedDeckIds.delete(d.id);
    else       pickIncludedDeckIds.add(d.id);
  }
  renderPickPool();
  renderPickSetup();
}

function _assignDecks(players, pool, excludeOwn) {
  // Up to 200 shuffle-attempts to find a valid assignment
  for (let attempt = 0; attempt < 200; attempt++) {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const usedIdx  = new Set();
    const results  = [];
    let ok         = true;

    for (const player of players) {
      let found = -1;
      for (let i = 0; i < shuffled.length; i++) {
        if (usedIdx.has(i)) continue;
        if (excludeOwn && shuffled[i].player.id === player.id) continue;
        found = i;
        break;
      }
      if (found === -1) { ok = false; break; }
      usedIdx.add(found);
      results.push({ player, deckEntry: shuffled[found] });
    }

    if (ok) return results;
  }
  return null;
}

// ── Roll ──────────────────────────────────────────────────────────────────

function pickRoll() {
  const players = state.players.filter(p => pickSelected.has(p.id));
  if (players.length < 2 || players.length > 6) return;

  const pool = _allPickDecks();
  const results = _assignDecks(players, pool, pickExcludeOwn);

  if (!results) {
    alert('Could not find a valid assignment. Try adding more decks or turning off "Exclude own decks".');
    return;
  }

  pickResults = results;
  renderPickResults();
  // No scrollIntoView here any more. It existed because the results were
  // below two stacked boxes and started off-screen; they are the first thing
  // under the strip now, so scrolling to them would only move a page that is
  // already showing the answer — and "Re-roll all" calls this from inside
  // the results themselves.
}

function pickRerollOne(idx) {
  if (!pickResults) return;
  const player    = pickResults[idx].player;
  const lockedIds = new Set(
    pickResults.filter((_, i) => i !== idx).map(r => r.deckEntry.deck.id)
  );

  const available = _allPickDecks().filter(d => {
    if (lockedIds.has(d.deck.id)) return false;
    if (pickExcludeOwn && d.player.id === player.id) return false;
    return true;
  });

  if (!available.length) return; // no alternatives — keep current
  pickResults[idx].deckEntry = available[Math.floor(Math.random() * available.length)];
  renderPickResults();
}

// ── Results ───────────────────────────────────────────────────────────────

function renderPickResults() {
  const el = document.getElementById('pickResults');
  if (!el || !pickResults) return;

  const tiles = pickResults.map(({ player, deckEntry }, i) => {
    const d       = deckEntry.deck;
    const owner   = deckEntry.player;
    const bg      = d.commanderImg ? `background-image:url('${d.commanderImg}')` : '';
    const cmdLine = d.commander
      ? `<div class="pick-deck-commander">${esc(d.commander)}</div>` : '';
    const ownerTag = owner.id !== player.id
      ? `<span class="pick-owner-tag" style="--oc:${playerColor(owner)}">${esc(owner.name)}'s deck</span>`
      : '';
    const viewLink = d.deckUrl
      ? `<a class="deck-tile-link" href="${esc(d.deckUrl)}" target="_blank" rel="noopener">View ↗</a>`
      : '';
    const bracket = d.bracket != null
      ? `<span class="badge-bracket">Bracket ${d.bracket}</span>` : '';

    return `<div class="pick-result-card">
      <div class="pick-result-player" style="--pc:${playerColor(player)}">
        <span class="pick-result-dot"></span>
        <span class="pick-result-name">${esc(player.name)}</span>
      </div>
      <div class="deck-tile" style="${bg};border-radius:0 0 var(--radius-md) var(--radius-md);cursor:default">
        <div class="deck-tile-overlay">
          <div class="deck-tile-top">
            ${ownerTag}${bracket}${viewLink}
          </div>
          <div class="deck-tile-middle">
            <div class="deck-tile-name">${esc(d.name)}</div>
            ${cmdLine}
          </div>
          <div class="deck-tile-bottom">
            <span class="deck-tile-count">${d.cardCount ? `${d.cardCount} cards` : ''}</span>
            <button class="btn-edit-tile" onclick="pickRerollOne(${i})">↺ Re-roll</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="pick-results-bar">
      <span class="pick-results-label">Tonight's picks</span>
      <button class="btn-secondary" style="padding:var(--space-1) var(--space-3);font-size:var(--text-sm)" onclick="pickRoll()">↺ Re-roll all</button>
    </div>
    <div class="pick-results-grid">${tiles}</div>`;
}
