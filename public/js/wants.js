// ── Want List ─────────────────────────────────────────────────────────────
let wantAcTimer  = null;
let wantView     = 'list'; // 'list' | 'grid' | 'xl'
let wantCardData = new Map(); // card name → Scryfall card object
let _wantFetching = false;

const WANT_SORT_FIELDS = ['wanted', 'player', 'name', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'];
let wantFilterPlayer = '';
let _wantExportRows    = []; // [cardName, Set<playerId>][] — last rendered, filtered + sorted
let _wantExportPlayers = []; // players with at least one want, last rendered
const WANT_COLUMNS = [
  { key: 'mana',   label: 'Mana Value',        default: false },
  { key: 'color',  label: 'Color',             default: false },
  { key: 'type',   label: 'Type',              default: false },
  { key: 'rarity', label: 'Rarity',            default: false },
  { key: 'pt',     label: 'Power / Toughness', default: false },
  { key: 'price',  label: 'Price',             default: true },
  { key: 'owned',  label: 'In Collections',    default: true },
];
let _wantControlsMounted = false;
function initWantControls() {
  mountSortControl('wantSortMount', 'wants', WANT_SORT_FIELDS, renderWantList, { field: 'wanted', dir: -1 });
  mountColumnMenu('wantColumnsMount', 'wants', WANT_COLUMNS, renderWantList);
  mountViewToggle('wantViewMount', ['list', 'grid', 'xl'], () => wantView, setWantView);
  _wantControlsMounted = true;
}

// "+ New player…" option in the player select (replaces the old add-player bar)
function wantPlayerSelChange(sel) {
  if (sel.value !== '__new') return;
  sel.value = '';
  const name = prompt('New player name:');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  if (addPlayerByName(trimmed)) {
    const p = state.players.find(pl => pl.name === trimmed);
    if (p) sel.value = p.id;
  }
}

// ── Player filter ─────────────────────────────────────────────────────────
function setWantFilterPlayer(id) {
  wantFilterPlayer = id;
  renderWantList();
}

// ── View toggle ───────────────────────────────────────────────────────────
function setWantView(v) {
  wantView = v;
  renderWantList();
}

// ── Scryfall batch-fetch for want list cards ──────────────────────────────
async function fetchWantCardData(names) {
  if (!names.length) return;
  const cards = await fetchCardCollection(names);
  for (const card of cards) {
    wantCardData.set(card.name, card);
    if (card.card_faces?.[0]?.name) wantCardData.set(card.card_faces[0].name, card);
  }
  // Negative-cache names that couldn't be resolved (typos, custom cards).
  // Without this, every render sees them as "missing" and re-fetches —
  // an endless request loop that eventually trips Scryfall's rate limit.
  for (const n of names) {
    if (!wantCardData.has(n)) wantCardData.set(n, null);
  }
}

// ── Autocomplete ──────────────────────────────────────────────────────────
function wantAcInput() {
  clearTimeout(wantAcTimer);
  const q = document.getElementById('wantCardInput').value.trim();
  if (q.length < 2) { closeAc(); return; }
  wantAcTimer = setTimeout(async () => {
    try {
      const drop = document.getElementById('wantAcDrop');
      const names = (await cardAutocomplete(q)).slice(0, 8);
      if (!names.length) { closeAc(); return; }
      drop.innerHTML = names.map(n =>
        `<div class="ac-item" onclick="pickAc('${jsAttr(n)}')">${esc(n)}</div>`).join('');
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

// ── CSV import ────────────────────────────────────────────────────────────
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

// ── Add / Remove ──────────────────────────────────────────────────────────
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
    const json = await res.json().catch(() => ({}));
    if (typeof json.version === 'number') state.version = json.version;
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
    const json = await res.json().catch(() => ({}));
    if (typeof json.version === 'number') state.version = json.version;
    const player = state.players.find(p => p.id === playerId);
    if (player) player.wantList = (player.wantList || []).filter(c => c !== cardName);
    renderWantList();
  } catch (e) { alert(`Could not remove: ${e.message}`); }
}

// ── Render ────────────────────────────────────────────────────────────────
async function renderWantList() {
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
      ).join('') +
      (currentUser?.role === 'admin' ? '<option value="__new">+ New player…</option>' : '');
  }

  const container = document.getElementById('wantResults');
  if (!container) return;

  // Aggregate all wants: cardName → Set<playerId>
  const allWants = new Map();
  for (const p of state.players) {
    for (const card of (p.wantList || [])) {
      if (!allWants.has(card)) allWants.set(card, new Set());
      allWants.get(card).add(p.id);
    }
  }

  if (!allWants.size) {
    container.innerHTML = `<div class="empty-state" style="padding:2.5rem">
      No want lists yet — select a player above and start adding cards.
    </div>`;
    return;
  }

  // Players who have at least one want
  const activePlayers = state.players.filter(p => (p.wantList || []).length > 0);

  if (!_wantControlsMounted) initWantControls();

  // ── Player filter chips ───────────────────────────────────────────────
  const filterMount = document.getElementById('wantFilterMount');
  if (filterMount && activePlayers.length > 1) {
    filterMount.innerHTML = `<div style="display:flex;gap:.35rem;flex-wrap:wrap;align-items:center;padding:.5rem 0 .1rem">
      <span class="section-label" style="flex-shrink:0">Filter:</span>
      <button class="pick-chip ${!wantFilterPlayer ? 'pick-chip-on' : ''}"
        onclick="setWantFilterPlayer('')" style="--pc:var(--primary)">All</button>
      ${activePlayers.map(p =>
        `<button class="pick-chip ${wantFilterPlayer === p.id ? 'pick-chip-on' : ''}"
          style="--pc:${p.color}" onclick="setWantFilterPlayer('${jsAttr(p.id)}')">
          <span class="pick-chip-dot" style="background:${p.color}"></span>${esc(p.name)}
        </button>`
      ).join('')}
    </div>`;
  } else if (filterMount) {
    filterMount.innerHTML = '';
  }

  // Sort by the chosen field ("Most Wanted" = count of players wanting it)
  const { field, dir } = getSort('wants', { field: 'wanted', dir: -1 });
  const rows = [...allWants.entries()];
  if (field === 'wanted') {
    rows.sort((a, b) => (a[1].size - b[1].size) * dir || a[0].localeCompare(b[0]));
  } else if (field === 'player') {
    rows.sort((a, b) => {
      const aN = activePlayers.filter(p => a[1].has(p.id)).map(p => p.name).join('\0');
      const bN = activePlayers.filter(p => b[1].has(p.id)).map(p => p.name).join('\0');
      return aN.localeCompare(bN) * dir;
    });
  } else {
    const cmp = cardComparator(field, dir);
    rows.sort((a, b) => cmp(wantCardData.get(a[0]) || { name: a[0] }, wantCardData.get(b[0]) || { name: b[0] }));
  }

  // Apply player filter (default '' = show all)
  const visibleRows = wantFilterPlayer
    ? rows.filter(([, wanterIds]) => wanterIds.has(wantFilterPlayer))
    : rows;

  // Keep the currently filtered/sorted rows around for Export, so CSV/PDF
  // exports always match what's on screen (including the player filter).
  _wantExportRows    = visibleRows;
  _wantExportPlayers = activePlayers;

  // ── List (table) view ─────────────────────────────────────────────────
  if (wantView === 'list') {
    const vc = getCols('wants', WANT_COLUMNS);
    const colHeaders = activePlayers.map(p =>
      `<th style="border-bottom:3px solid ${p.color};white-space:nowrap">${esc(p.name)}</th>`
    ).join('');

    let metaHead = '';
    if (vc.mana)   metaHead += '<th>MV</th>';
    if (vc.color)  metaHead += '<th>Color</th>';
    if (vc.type)   metaHead += '<th>Type</th>';
    if (vc.rarity) metaHead += '<th>Rarity</th>';
    if (vc.pt)     metaHead += '<th>P/T</th>';

    const tableRows = visibleRows.map(([cardName, wanterIds]) => {
      const href  = `https://scryfall.com/search?q=!%22${encodeURIComponent(cardName)}%22`;
      const cells = activePlayers.map(p => {
        if (!wanterIds.has(p.id)) return `<td style="text-align:center;color:var(--border)">—</td>`;
        const canEdit = isMyPlayer(p.id);
        return `<td style="text-align:center">
          <span class="want-check" style="color:${p.color}">✓
            ${canEdit ? `<button class="want-rm" onclick="removeWant('${p.id}','${jsAttr(cardName)}')" title="Remove">✕</button>` : ''}
          </span>
        </td>`;
      }).join('');
      const owned = sfCardOwnership(cardName);
      const card  = wantCardData.get(cardName);
      const m     = cardMetaOf(card || { name: cardName });
      const price = renderPrice(card);
      let metaCells = '';
      if (vc.mana)   metaCells += `<td class="td-meta">${colMV(m)}</td>`;
      if (vc.color)  metaCells += `<td class="td-meta">${colColor(m)}</td>`;
      if (vc.type)   metaCells += `<td class="td-meta">${esc(colType(m))}</td>`;
      if (vc.rarity) metaCells += `<td class="td-meta">${colRarity(m)}</td>`;
      if (vc.pt)     metaCells += `<td class="td-meta">${colPT(m)}</td>`;
      return `<tr>
        <td class="td-name">
          <a class="card-link" href="${href}" target="_blank" rel="noopener" data-name="${esc(cardName)}">${esc(cardName)}</a>
        </td>
        ${cells}
        ${metaCells}
        ${vc.price ? `<td style="white-space:nowrap">${price}</td>` : ''}
        ${vc.owned ? `<td><div class="sf-ownership">${owned || '<span class="sf-not-owned">Nobody owns this</span>'}</div></td>` : ''}
      </tr>`;
    }).join('');

    container.innerHTML = `<div class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Card</th>
            ${colHeaders}
            ${metaHead}
            ${vc.price ? '<th>Price</th>' : ''}
            ${vc.owned ? '<th>In Collections</th>' : ''}
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;

    // Async-fetch any missing prices, then re-render once
    const missing = [...visibleRows.map(([n]) => n)].filter(n => !wantCardData.has(n));
    if (missing.length && !_wantFetching) {
      _wantFetching = true;
      fetchWantCardData(missing).then(() => {
        _wantFetching = false;
        renderWantList();
      });
    }
    return;
  }

  // ── Grid / XL views ───────────────────────────────────────────────────
  // Need Scryfall data — show loading state then fetch if missing
  const missingGrid = visibleRows.map(([n]) => n).filter(n => !wantCardData.has(n));
  if (missingGrid.length) {
    container.innerHTML = `<div class="empty-state" style="padding:3rem 1rem">Loading card images…</div>`;
    await fetchWantCardData(missingGrid);
  }

  const gridClass = wantView === 'xl' ? 'sf-grid-xl' : 'sf-grid';
  const tiles = visibleRows.map(([cardName, wanterIds]) => {
    const card   = wantCardData.get(cardName);
    const face   = card?.card_faces?.[0];
    const imgUrl = wantView === 'xl'
      ? (card?.image_uris?.large || card?.image_uris?.normal || face?.image_uris?.large || face?.image_uris?.normal || '')
      : (card?.image_uris?.normal || face?.image_uris?.normal || '');
    const href   = `https://scryfall.com/search?q=!%22${encodeURIComponent(cardName)}%22`;
    const sfUrl  = card?.scryfall_uri || href;
    const owned  = sfCardOwnership(cardName);
    const price  = renderPrice(card);
    const mana   = wantView === 'xl' ? (card?.mana_cost || face?.mana_cost || '') : '';
    const type   = wantView === 'xl' ? (card?.type_line || face?.type_line || '') : '';

    // Colored player dots for who wants this card
    const playerDots = activePlayers
      .filter(p => wanterIds.has(p.id))
      .map(p => {
        const initial = esc(p.name.charAt(0).toUpperCase());
        const canEdit = isMyPlayer(p.id);
        return `<span class="want-dot" style="background:${p.color};cursor:${canEdit?'pointer':'default'}" title="${esc(p.name)}"
          ${canEdit ? `onclick="removeWant('${p.id}','${jsAttr(cardName)}')"` : ''}
        >${initial}</span>`;
      }).join('');

    return `<div class="sf-card-lg">
      <a href="${sfUrl}" target="_blank" rel="noopener" class="card-open" data-name="${esc(cardName)}">
        ${imgUrl
          ? `<img class="sf-card-lg-img" src="${imgUrl}" loading="lazy" alt="${esc(cardName)}">`
          : `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
      </a>
      <div class="sf-card-lg-footer">
        <div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.2rem">
          <a class="sf-card-lg-name card-link" href="${href}" target="_blank" rel="noopener"
             data-name="${esc(cardName)}" title="${esc(cardName)}" style="margin-bottom:0;flex:1">${esc(cardName)}</a>
          ${price}
        </div>
        ${mana ? `<div style="margin-bottom:.2rem">${renderMana(mana)}</div>` : ''}
        ${type ? `<div style="font-size:.7rem;color:var(--muted);margin-bottom:.25rem">${esc(type)}</div>` : ''}
        <div style="display:flex;gap:.25rem;flex-wrap:wrap;margin-bottom:.25rem">${playerDots}</div>
        <div class="sf-card-lg-badges">${owned || '<span class="sf-not-owned">—</span>'}</div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `<div class="${gridClass}">${tiles}</div>`;
}

// ── Export (CSV / PDF) ───────────────────────────────────────────────────
// Exports always reflect the currently selected player filter, so picking
// a player chip and exporting gives just that player's want list.
function toggleWantExportMenu(e) {
  e?.stopPropagation();
  document.getElementById('wantExportMenu')?.classList.toggle('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('#wantExportMenu') && !e.target.closest('.col-menu-btn'))
    document.getElementById('wantExportMenu')?.classList.remove('open');
});

function _wantExportLabel() {
  if (!wantFilterPlayer) return 'All Players';
  return state.players.find(p => p.id === wantFilterPlayer)?.name || 'Want List';
}

function _wantExportFilenameBase() {
  return `want-list-${_wantExportLabel().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

function _wantDownload(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function _csvField(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function wantExportCsv() {
  document.getElementById('wantExportMenu')?.classList.remove('open');
  if (!_wantExportRows.length) { alert('No cards to export.'); return; }

  const header = wantFilterPlayer ? ['Card'] : ['Card', ..._wantExportPlayers.map(p => p.name)];
  const lines  = [header.map(_csvField).join(',')];
  for (const [cardName, wanterIds] of _wantExportRows) {
    const row = [cardName];
    if (!wantFilterPlayer) for (const p of _wantExportPlayers) row.push(wanterIds.has(p.id) ? 'x' : '');
    lines.push(row.map(_csvField).join(','));
  }
  _wantDownload(`${_wantExportFilenameBase()}.csv`, lines.join('\n'), 'text/csv');
}

function wantExportPdf() {
  document.getElementById('wantExportMenu')?.classList.remove('open');
  if (!_wantExportRows.length) { alert('No cards to export.'); return; }
  if (!window.jspdf?.jsPDF) { alert('PDF library failed to load — check your connection and try again.'); return; }

  const { jsPDF } = window.jspdf;
  const doc      = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW    = doc.internal.pageSize.getWidth();
  const pageH    = doc.internal.pageSize.getHeight();
  const marginX  = 40;
  let   y        = 50;

  const label = _wantExportLabel();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`Want List — ${label}`, marginX, y);
  y += 20;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  const count = _wantExportRows.length;
  doc.text(`${count} card${count === 1 ? '' : 's'} · generated ${new Date().toLocaleDateString()}`, marginX, y);
  doc.setTextColor(0);
  y += 24;

  const boxSize = 11;
  const lineH   = 20;
  doc.setFontSize(11);
  for (const [cardName, wanterIds] of _wantExportRows) {
    if (y > pageH - 50) { doc.addPage(); y = 50; }

    doc.rect(marginX, y - boxSize + 1, boxSize, boxSize); // checkbox to tick off
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(cardName, marginX + boxSize + 10, y);

    if (!wantFilterPlayer) {
      const names = _wantExportPlayers.filter(p => wanterIds.has(p.id)).map(p => p.name).join(', ');
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(names, pageW - marginX, y, { align: 'right' });
    }
    y += lineH;
  }

  doc.save(`${_wantExportFilenameBase()}.pdf`);
}
