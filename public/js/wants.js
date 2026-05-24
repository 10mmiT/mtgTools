// ── Want List ─────────────────────────────────────────────────────────────
let wantAcTimer = null;

function wantAcInput() {
  clearTimeout(wantAcTimer);
  const q = document.getElementById('wantCardInput').value.trim();
  if (q.length < 2) { closeAc(); return; }
  wantAcTimer = setTimeout(async () => {
    try {
      const res  = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const drop = document.getElementById('wantAcDrop');
      const names = (data.data || []).slice(0, 8);
      if (!names.length) { closeAc(); return; }
      drop.innerHTML = names.map(n =>
        `<div class="ac-item" onclick="pickAc('${esc(n)}')">${esc(n)}</div>`).join('');
      drop.style.display = 'block';
    } catch { closeAc(); }
  }, 280);
}

function pickAc(name) {
  document.getElementById('wantCardInput').value = name;
  closeAc();
}

function closeAc() {
  const d = document.getElementById('wantAcDrop');
  if (d) d.style.display = 'none';
}

document.addEventListener('click', e => { if (!e.target.closest('.autocomplete-wrap')) closeAc(); });

function parseWantCSV(text) {
  const names = new Set();
  for (const row of parseCSVRows(text)) {
    if (!row.length) continue;
    const first = (row[0] || '').trim();
    // Skip header rows
    if (/^(quantity|count|name|card(\s*name)?)$/i.test(first)) continue;
    // qty,name format
    if (/^\d+$/.test(first) && row.length >= 2) {
      const name = (row[1] || '').trim();
      if (name) names.add(name);
    } else if (first) {
      names.add(first);
    }
  }
  return [...names];
}

document.getElementById('wantCsvInput').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const playerId = document.getElementById('wantPlayerSel').value;
  if (!playerId) { alert('Select a player first, then import.'); return; }
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const names = parseWantCSV(ev.target.result);
    if (!names.length) { alert('No card names found in that file.'); return; }
    if (!player.wantList) player.wantList = [];
    let added = 0;
    for (const name of names) {
      if (!player.wantList.includes(name)) { player.wantList.push(name); added++; }
    }
    saveToStorage();
    renderWantList();
    if (added === 0) alert('All cards from that file are already on the want list.');
  };
  reader.readAsText(file);
});

async function addWant() {
  const playerId = document.getElementById('wantPlayerSel').value;
  const cardName = document.getElementById('wantCardInput').value.trim();
  if (!playerId || !cardName) return;
  if (!isMyPlayer(playerId)) { alert('You can only add to your own want list.'); return; }
  try {
    const res = await fetch(`/api/players/${encodeURIComponent(playerId)}/wants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardName }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed');
    const player = state.players.find(p => p.id === playerId);
    if (player) { if (!player.wantList) player.wantList = []; if (!player.wantList.includes(cardName)) player.wantList.push(cardName); }
    document.getElementById('wantCardInput').value = '';
    closeAc();
    renderWantList();
  } catch (e) { alert(`Could not add to wants: ${e.message}`); }
}

async function removeWant(playerId, cardName) {
  if (!isMyPlayer(playerId)) { alert('You can only remove from your own want list.'); return; }
  try {
    const res = await fetch(`/api/players/${encodeURIComponent(playerId)}/wants/${encodeURIComponent(cardName)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed');
    const player = state.players.find(p => p.id === playerId);
    if (player) player.wantList = (player.wantList || []).filter(c => c !== cardName);
    renderWantList();
  } catch (e) { alert(`Could not remove: ${e.message}`); }
}

function renderWantList() {
  // Populate player dropdown
  const sel = document.getElementById('wantPlayerSel');
  if (sel) {
    const prev    = sel.value || currentUser?.playerId || '';
    const visible = currentUser?.role === 'admin'
      ? state.players
      : state.players.filter(p => p.id === currentUser?.playerId);
    sel.innerHTML = '<option value="">Select player…</option>' +
      visible.map(p =>
        `<option value="${p.id}" ${p.id === prev ? 'selected' : ''}>${esc(p.name)}</option>`
      ).join('');
  }

  const container = document.getElementById('wantResults');
  if (!container) return;

  // Aggregate all wants: cardName → Map<playerId, true>
  const allWants = new Map();
  for (const p of state.players) {
    for (const card of (p.wantList || [])) {
      if (!allWants.has(card)) allWants.set(card, new Set());
      allWants.get(card).add(p.id);
    }
  }

  if (!allWants.size) {
    container.innerHTML = `<div class="empty-state" style="padding:2.5rem">
      No want lists yet — add a player above then start adding cards.
    </div>`;
    return;
  }

  // Players who have at least one want
  const activePlayers = state.players.filter(p => (p.wantList || []).length > 0);

  // Sort: most-wanted first, then alpha
  const rows = [...allWants.entries()]
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));

  const colHeaders = activePlayers.map(p =>
    `<th style="border-bottom:3px solid ${p.color};white-space:nowrap">${esc(p.name)}</th>`
  ).join('');

  const tableRows = rows.map(([cardName, wanterIds]) => {
    const href  = `https://scryfall.com/search?q=!%22${encodeURIComponent(cardName)}%22`;
    const cells = activePlayers.map(p => {
      if (!wanterIds.has(p.id)) return `<td style="text-align:center;color:var(--border)">—</td>`;
      const canEdit = isMyPlayer(p.id);
      return `<td style="text-align:center">
        <span class="want-check" style="color:${p.color}">✓
          ${canEdit ? `<button class="want-rm" onclick="removeWant('${p.id}','${esc(cardName)}')" title="Remove">✕</button>` : ''}
        </span>
      </td>`;
    }).join('');
    const owned = sfCardOwnership(cardName);
    return `<tr>
      <td class="td-name">
        <a class="card-link" href="${href}" target="_blank" rel="noopener" data-name="${esc(cardName)}">${esc(cardName)}</a>
      </td>
      ${cells}
      <td><div class="sf-ownership">${owned || '<span class="sf-not-owned">Nobody owns this</span>'}</div></td>
    </tr>`;
  }).join('');

  container.innerHTML = `<div class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Card</th>
          ${colHeaders}
          <th>In Collections</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  </div>`;
}
