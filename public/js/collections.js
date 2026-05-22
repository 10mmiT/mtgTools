// ── CSV Parsing ───────────────────────────────────────────────────────────
function parseCSVRows(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { field += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      row.push(field); field = '';
    } else if ((c === '\n' || (c === '\r' && text[i + 1] === '\n')) && !inQ) {
      if (c === '\r') i++;
      row.push(field); rows.push(row);
      row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field || row.length) { row.push(field); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

function importCSV(text, filename) {
  const rows = parseCSVRows(text);
  if (rows.length < 2) throw new Error('CSV appears to be empty.');
  const header = rows[0].map(h => h.trim().toLowerCase());
  const cards  = new Map();

  if (header[0] === 'quantity') {
    // Archidekt: Quantity is the oracle-card total repeated per row — take first occurrence.
    const qi = 0, ni = 1;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const qty  = parseInt(r[qi], 10) || 0;
      const name = (r[ni] || '').trim();
      if (!name || qty <= 0 || cards.has(name)) continue;
      cards.set(name, { name, type: '', mana: '', qty });
    }
    return { cards, source: 'csv-archidekt' };

  } else if (header[0] === 'count') {
    // Moxfield: Count, Tradelist Count, Name, ...
    const qi = 0, ni = 2;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const qty  = parseInt(r[qi], 10) || 0;
      const name = (r[ni] || '').trim();
      if (!name || qty <= 0) continue;
      const existing = cards.get(name);
      if (existing) existing.qty += qty;
      else cards.set(name, { name, type: '', mana: '', qty });
    }
    return { cards, source: 'csv-moxfield' };

  } else {
    throw new Error(`Unrecognised CSV format (first column: "${header[0]}"). Expected Archidekt or Moxfield export.`);
  }
}

// ── URL Parsing ───────────────────────────────────────────────────────────
function parseInput(raw) {
  raw = (raw || '').trim();
  const mox = raw.match(/moxfield\.com\/collection\/([\w-]+)/);
  if (mox) return { source: 'moxfield', id: mox[1] };
  const ark = raw.match(/archidekt\.com.*\/(\d+)\/?/);
  if (ark) return { source: 'archidekt', id: ark[1] };
  if (/^\d+$/.test(raw)) return { source: 'archidekt', id: raw };
  return null;
}

function apiPageUrl(col, page) {
  if (col.source === 'moxfield') {
    if (!USE_LOCAL) return null;
    return `/api/moxfield/collection/${col.id}/cards?pageNumber=${page}&pageSize=100`;
  }
  if (USE_LOCAL) return `/api/archidekt/collection/${col.id}?page=${page}&pageSize=100`;
  const t = encodeURIComponent(`https://archidekt.com/api/collection/${col.id}/?page=${page}&pageSize=100`);
  return `https://api.allorigins.win/raw?url=${t}`;
}

function sourceLabel(source) {
  return { archidekt: 'Archidekt', moxfield: 'Moxfield',
           'csv-archidekt': 'CSV (Archidekt)', 'csv-moxfield': 'CSV (Moxfield)' }[source] || source;
}

// ── Add from URL ──────────────────────────────────────────────────────────
function addFromUrl() {
  const urlEl  = document.getElementById('urlInput');
  const nameEl = document.getElementById('nameInput');
  const errEl  = document.getElementById('addError');

  const parsed = parseInput(urlEl.value);
  if (!parsed) { showError(errEl, 'Enter a valid Archidekt URL/ID or Moxfield collection URL.'); return; }

  const key = `${parsed.source}:${parsed.id}`;
  if (state.collections.find(c => c.key === key)) { showError(errEl, 'That collection is already loaded.'); return; }

  if (parsed.source === 'moxfield' && !USE_LOCAL) {
    showError(errEl, 'Moxfield requires the local server. Open this app via http://localhost:3000 (run with Docker).');
    return;
  }

  errEl.style.display = 'none';

  const col = {
    key,
    name:     nameEl.value.trim() || `Collection ${parsed.id}`,
    source:   parsed.source,
    id:       parsed.id,
    color:    COLORS[state.collections.length % COLORS.length],
    cards:    new Map(),
    status:   'loading',
    entries:  0,
    total:    null,
    error:    null,
    savedAt:  null,
    updating: false,
  };

  state.collections.push(col);
  urlEl.value  = '';
  nameEl.value = '';

  renderCollections();
  renderResults();
  fetchAllPages(col);
}

// ── Fetch all API pages ───────────────────────────────────────────────────
async function fetchAllPages(col) {
  let page = 1;
  col.cards   = new Map();
  col.entries = 0;
  col.error   = null;

  try {
    while (true) {
      const url = apiPageUrl(col, page);
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status} from ${col.source} API`);
      }

      const data = await res.json();
      if (col.total === null) col.total = getTotalCount(data, col.source);

      for (const item of getItems(data, col.source)) {
        const card = parseCard(item, col.source);
        if (!card.name) continue;
        const ex = col.cards.get(card.name);
        if (ex) ex.qty += card.qty;
        else col.cards.set(card.name, card);
        col.entries++;
      }

      renderCollections();
      renderResults();
      if (!hasMore(data, col.source)) break;
      page++;
    }

    col.status   = 'loaded';
    col.savedAt  = new Date().toISOString();
    col.updating = false;
    saveToStorage();
  } catch (err) {
    col.status   = 'error';
    col.error    = err.message;
    col.updating = false;
  }

  renderCollections();
  renderResults();
}

function getItems(data, source) {
  return source === 'moxfield' ? (data.data || data.items || []) : (data.results || []);
}

function hasMore(data, source) {
  if (source === 'moxfield') return data.pageNumber * data.pageSize < data.totalResults;
  return !!data.next;
}

function getTotalCount(data, source) {
  return source === 'moxfield' ? (data.totalResults ?? null) : (data.count ?? null);
}

function parseCard(item, source) {
  if (source === 'moxfield') {
    const c = item.card || item;
    return { name: c.name || '', type: c.type || c.typeLine || '', mana: c.manaCost || '', qty: item.quantity || item.count || 1 };
  }
  const name = item.card?.oracleCard?.name || item.card?.name || '';
  return { name, type: (item.card?.oracleCard?.types || []).join(', '), mana: item.card?.oracleCard?.manaCost || '', qty: item.quantity || 0 };
}

// ── CSV Import ────────────────────────────────────────────────────────────
function openCsvPicker(updateKey) {
  pendingCsvKey  = updateKey;
  pendingCsvName = updateKey ? null : document.getElementById('nameInput').value.trim();
  document.getElementById('csvInput').click();
}

document.getElementById('csvInput').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const { cards, source } = importCSV(ev.target.result, file.name);
      const total = [...cards.values()].reduce((s, c) => s + c.qty, 0);

      if (pendingCsvKey) {
        const col = state.collections.find(c => c.key === pendingCsvKey);
        if (col) {
          col.cards    = cards;
          col.entries  = total;
          col.total    = cards.size;
          col.source   = source;
          col.status   = 'loaded';
          col.error    = null;
          col.savedAt  = new Date().toISOString();
          col.updating = false;
        }
        pendingCsvKey = null;
      } else {
        const name = pendingCsvName || file.name.replace(/\.csv$/i, '');
        document.getElementById('addError').style.display = 'none';

        state.collections.push({
          key:      `csv:${Date.now()}`,
          name,
          source,
          id:       null,
          color:    COLORS[state.collections.length % COLORS.length],
          cards,
          status:   'loaded',
          entries:  total,
          total:    cards.size,
          error:    null,
          savedAt:  new Date().toISOString(),
          updating: false,
        });
        document.getElementById('nameInput').value = '';
      }

      saveToStorage();
      renderCollections();
      renderResults();
    } catch (err) {
      alert('Could not parse CSV: ' + err.message);
      if (pendingCsvKey) {
        const col = state.collections.find(c => c.key === pendingCsvKey);
        if (col) col.updating = false;
        pendingCsvKey = null;
      }
      renderCollections();
    }
  };
  reader.readAsText(file);
});

// ── Update / Remove collection ────────────────────────────────────────────
function updateCollection(key) {
  const col = state.collections.find(c => c.key === key);
  if (!col || col.updating || col.status === 'loading') return;
  col.updating = true;
  renderCollections();
  if (col.source.startsWith('csv-')) {
    openCsvPicker(key);
  } else {
    col.status = 'loading';
    col.total  = null;
    fetchAllPages(col);
  }
}

function removeCollection(key) {
  state.collections = state.collections.filter(c => c.key !== key);
  saveToStorage();
  renderCollections();
  renderResults();
}

// ── Render collections ────────────────────────────────────────────────────
function renderCollections() {
  renderDeck();
  const panel = document.getElementById('collectionsPanel');
  const list  = document.getElementById('collectionsList');

  if (!state.collections.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  list.innerHTML = state.collections.map(col => {
    const pct      = col.total ? Math.min(100, Math.round(col.entries / col.total * 100)) : 0;
    const isCSV    = col.source.startsWith('csv-');
    const isBusy   = col.status === 'loading' || col.updating;
    const badgeCls = col.status === 'loading' ? 'badge-loading' : col.status === 'error' ? 'badge-error' : 'badge-loaded';
    const badgeTxt = col.status === 'loading' ? 'Loading' : col.status === 'error' ? 'Error' : 'Loaded';

    const statusLine = col.status === 'error'
      ? `<span style="color:var(--danger)">${esc(col.error)}</span>`
      : col.status === 'loading'
        ? (col.total ? `${col.entries.toLocaleString()} / ${col.total.toLocaleString()} cards` : 'Connecting…')
        : `${[...col.cards.values()].reduce((s,c)=>s+c.qty,0).toLocaleString()} cards · updated ${relTime(col.savedAt)}`;

    const updateLabel = col.updating ? 'Updating…' : (isCSV ? 'Re-import CSV' : 'Refresh');

    return `
      <div class="col-row">
        <div class="col-dot" style="background:${col.color}"></div>
        <div class="col-info">
          <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
            <span class="col-name">${esc(col.name)}</span>
            <span class="badge badge-source">${sourceLabel(col.source)}</span>
            <span class="badge ${badgeCls}">${badgeTxt}</span>
          </div>
          <div class="col-meta">${statusLine}</div>
          ${col.status === 'loading' && col.total ? `
            <div class="progress-bar">
              <div class="progress-fill" style="width:${pct}%;background:${col.color}"></div>
            </div>` : ''}
        </div>
        <div class="col-actions">
          <button class="btn-update" onclick="updateCollection('${col.key}')" ${isBusy ? 'disabled' : ''}>${updateLabel}</button>
          <button class="btn-remove" onclick="removeCollection('${col.key}')" ${isBusy ? 'disabled' : ''}>Remove</button>
        </div>
      </div>`;
  }).join('');
}

// ── Build merged + filtered rows ──────────────────────────────────────────
const VALID_SORT_FIELDS = new Set(['name', 'total']);

function buildRows(query) {
  const merged = new Map();
  state.collections.forEach((col, ci) => {
    col.cards.forEach((card, name) => {
      if (!merged.has(name)) {
        merged.set(name, { name: card.name, type: card.type, mana: card.mana,
                            qtys: new Array(state.collections.length).fill(0) });
      } else {
        const e = merged.get(name);
        while (e.qtys.length < state.collections.length) e.qtys.push(0);
      }
      merged.get(name).qtys[ci] = card.qty;
    });
  });

  let rows = Array.from(merged.values());
  if (deckFilter && deck) rows = rows.filter(r => deck.cards.has(r.name));
  if (query) rows = rows.filter(r => r.name.toLowerCase().includes(query));

  const { field, dir } = state.sort;
  rows.sort((a, b) => {
    let av, bv;
    if      (field === 'name')  { av = a.name; bv = b.name; }
    else if (field === 'total') { av = a.qtys.reduce((s,q)=>s+q,0); bv = b.qtys.reduce((s,q)=>s+q,0); }
    else if (field.startsWith('col_')) { const i=+field.slice(4); av=a.qtys[i]||0; bv=b.qtys[i]||0; }
    if (av < bv) return -dir;
    if (av > bv) return  dir;
    return 0;
  });

  return rows;
}

// ── Schedule render ───────────────────────────────────────────────────────
function scheduleRender() {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(renderResults, 80);
}

// ── Render results ────────────────────────────────────────────────────────
function renderResults() {
  const query  = document.getElementById('searchInput').value.trim().toLowerCase();
  const infoEl = document.getElementById('resultInfo');

  document.getElementById('listView').style.display = viewMode === 'list' ? '' : 'none';
  document.getElementById('gridView').style.display = viewMode === 'grid' ? '' : 'none';

  if (!state.collections.length) {
    document.getElementById('resultsBody').innerHTML =
      `<tr><td colspan="99" class="empty-state">Add a collection above to get started.</td></tr>`;
    document.getElementById('cardGrid').innerHTML = '';
    infoEl.textContent = '';
    return;
  }

  const rows = buildRows(query);
  const MAX  = viewMode === 'grid' ? 200 : 500;

  infoEl.textContent = rows.length === 0
    ? 'No results'
    : `${rows.length.toLocaleString()} card${rows.length !== 1 ? 's' : ''}${rows.length > MAX ? ` (showing first ${MAX})` : ''}`;

  if (viewMode === 'list') renderListView(rows, MAX);
  else                     renderGridView(rows, MAX);
}

// ── List view ─────────────────────────────────────────────────────────────
function renderListView(rows, MAX) {
  const tbody  = document.getElementById('resultsBody');
  const header = document.getElementById('headerRow');

  const FIXED = 1;
  while (header.children.length > FIXED + 1) header.removeChild(header.children[FIXED]);
  state.collections.forEach((col, i) => {
    const th = document.createElement('th');
    th.dataset.sort = `col_${i}`;
    th.textContent  = col.name;
    th.style.borderBottom = `3px solid ${col.color}`;
    header.insertBefore(th, header.lastElementChild);
  });

  // Reset stale sort field if it referenced a removed column
  if (!VALID_SORT_FIELDS.has(state.sort.field) && !state.sort.field.startsWith('col_'))
    state.sort.field = 'name';

  header.querySelectorAll('th').forEach(th => {
    th.onclick = () => {
      const f = th.dataset.sort;
      if (state.sort.field === f) state.sort.dir *= -1;
      else { state.sort.field = f; state.sort.dir = 1; }
      renderResults();
    };
    const sorted = th.dataset.sort === state.sort.field;
    th.classList.toggle('sorted-asc',  sorted && state.sort.dir ===  1);
    th.classList.toggle('sorted-desc', sorted && state.sort.dir === -1);
  });

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="100" class="empty-state">No cards match your search.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.slice(0, MAX).map(r => {
    const total = r.qtys.reduce((s,q)=>s+q,0);
    const qtyCells = r.qtys.map(q =>
      `<td class="td-qty ${q ? 'qty-some' : 'qty-zero'}">${q || '—'}</td>`
    ).join('');
    const href = `https://scryfall.com/search?q=!%22${encodeURIComponent(r.name)}%22`;
    return `<tr>
      <td class="td-name"><a class="card-link" href="${href}" target="_blank" rel="noopener" data-name="${esc(r.name)}">${esc(r.name)}</a></td>
      ${qtyCells}
      <td class="td-total">${total}</td>
    </tr>`;
  }).join('');
}

// ── Grid view ─────────────────────────────────────────────────────────────
async function renderGridView(rows, MAX) {
  const grid = document.getElementById('cardGrid');

  if (!rows.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">No cards match your search.</div>`;
    return;
  }

  const displayed = rows.slice(0, MAX);

  function buildGridHTML(withImages) {
    return displayed.map(r => {
      const href = `https://scryfall.com/search?q=!%22${encodeURIComponent(r.name)}%22`;
      const imgUri = scryfallCache.get(r.name);
      const imgHtml = imgUri
        ? `<img src="${imgUri}" alt="${esc(r.name)}" onerror="this.style.display='none'">`
        : `<div class="grid-img-placeholder">
             <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
           </div>`;
      const qtyBadges = state.collections.map((col, i) => {
        const q = r.qtys[i] || 0;
        if (!q) return '';
        return `<span class="grid-qty">
          <span class="grid-dot" style="background:${col.color}"></span>
          ${esc(col.name)} ×${q}
        </span>`;
      }).join('');

      return `<div class="grid-card">
        <a class="grid-img-link" href="${href}" target="_blank" rel="noopener">${imgHtml}</a>
        <div class="grid-footer">
          <div class="grid-name" title="${esc(r.name)}">${esc(r.name)}</div>
          <div class="grid-qtys">${qtyBadges}</div>
        </div>
      </div>`;
    }).join('');
  }

  // Render immediately with whatever is already cached (placeholders for the rest)
  grid.innerHTML = buildGridHTML();

  // Fetch missing image URLs in batches, then re-render with real images
  const missing = displayed.filter(r => !scryfallCache.has(r.name)).map(r => r.name);
  if (missing.length) {
    await ensureScryfallImages(missing);
    // Only re-render if this grid is still the active view
    if (document.getElementById('gridView').style.display !== 'none') {
      grid.innerHTML = buildGridHTML();
    }
  }
}
