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
    return `/api/moxfield/collection/${col.id}/cards?pageNumber=${page}&pageSize=100`;
  }
  return `/api/archidekt/collection/${col.id}?page=${page}&pageSize=100`;
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
  if (!parsed) { showError(errEl, 'Enter a valid Archidekt collection URL or numeric ID.'); return; }

  const key = `${parsed.source}:${parsed.id}`;
  if (state.collections.find(c => c.key === key)) { showError(errEl, 'That collection is already loaded.'); return; }


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
  closeDrawers();   // the chip that replaces this form is what reports progress

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

    col.savedAt  = new Date().toISOString();
    col.updating = false;
    // Keep status 'loading' while saving so refreshState doesn't run and
    // overwrite in-memory state before the SQLite write completes.
    try {
      await saveCollection(col);
    } catch (e) {
      col.status = 'error';
      col.error  = `Saved locally but failed to persist: ${e.message}`;
      renderCollections();
      renderResults();
      return;
    }
    col.status = 'loaded';
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
  reader.onload = async ev => {
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
          await saveCollection(col);
        }
        pendingCsvKey = null;
      } else {
        const name = pendingCsvName || file.name.replace(/\.csv$/i, '');
        document.getElementById('addError').style.display = 'none';

        const col = {
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
        };
        state.collections.push(col);
        await saveCollection(col);
        document.getElementById('nameInput').value = '';
        closeDrawers();
      }

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

// ── Collection persistence (SQLite-backed via server) ─────────────────────
async function saveCollection(col) {
  const res = await fetch('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: col.key, name: col.name, source: col.source, id: col.id,
      color: col.color, cards: Object.fromEntries(col.cards),
      entries: col.entries, total: col.total, savedAt: col.savedAt,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

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
  renderCollections();
  renderResults();
  fetch(`/api/collections/${encodeURIComponent(key)}`, { method: 'DELETE' })
    .catch(e => console.warn('Collection remove failed:', e.message));
}

// ── Render collections ────────────────────────────────────────────────────
// One chip per collection, in a single row under the toolbar (§9.1). A chip
// is the name, the one number, and the ⋯ menu the old row carried. Everything
// else that row said — source, "Loaded", when it was last updated — is on the
// chip's tooltip, because it answers a question nobody asks while looking for
// a card.
function renderCollections() {
  renderDeck();
  const row = document.getElementById('collectionsChips');

  if (!state.collections.length) { row.style.display = 'none'; row.innerHTML = ''; return; }
  row.style.display = '';

  row.innerHTML = state.collections.map(col => {
    const isCSV  = col.source.startsWith('csv-');
    const isBusy = col.status === 'loading' || col.updating;

    // The count is also the progress bar: while pages are coming in it reads
    // "1,240 / 5,600", and the left number climbs on every render.
    const count = col.status === 'error' ? 'failed'
      : col.status === 'loading'
        ? (col.total ? `${col.entries.toLocaleString()} / ${col.total.toLocaleString()}` : 'connecting…')
        : col.updating ? 'updating…'
          : [...col.cards.values()].reduce((s, c) => s + c.qty, 0).toLocaleString();

    const tip = col.status === 'error'
      ? col.error
      : `${sourceLabel(col.source)}${col.savedAt ? ` · updated ${relTime(col.savedAt)}` : ''}`;

    const cls = col.status === 'error' ? ' chip--error' : isBusy ? ' chip--busy' : '';

    return `
      <span class="chip${cls}" title="${esc(tip)}">
        <span class="chip-dot" style="background:${col.color}"></span>
        <span class="chip-label">${esc(col.name)}</span>
        <span class="chip-count">${count}</span>
        ${isBusy ? '' : kebabMenuHtml([
          { label: isCSV ? 'Re-import CSV' : 'Refresh', onclick: `updateCollection('${col.key}')` },
          { divider: true },
          { label: 'Remove', onclick: `removeCollection('${col.key}')`, danger: true },
        ], { title: 'Collection actions' })}
      </span>`;
  }).join('');
}

// ── Build merged + filtered rows ──────────────────────────────────────────
const COL_META_FIELDS = new Set(['cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price']);

const COL_COLUMNS = [
  { key: 'mana',   label: 'Mana Value',        default: false },
  { key: 'color',  label: 'Color',             default: false },
  { key: 'type',   label: 'Type',              default: false },
  { key: 'rarity', label: 'Rarity',            default: false },
  { key: 'pt',     label: 'Power / Toughness', default: false },
  { key: 'price',  label: 'Price',             default: false },
];
const COL_SORT_FIELDS = ['name', 'qty', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'];

/* This tab's field list is not a constant. Every loaded collection is a field
 * of its own — its quantity column in the table below, which was a sort the
 * control could not say and could not display — so the list is one entry per
 * collection longer than the fields above, labelled with that collection's
 * own name. Built when the control is mounted, and rebuilt when the
 * collections change under it.
 *
 * The field is the collection's id and the label is its name, which is what
 * makes a rename a relabelling: the stored sort still names the same
 * collection, and only the word in the select and the header changes. */
function colSortFields() {
  return [...COL_SORT_FIELDS,
          ...state.collections.map(col => ({ key: colQtyField(col.key), label: col.name }))];
}

/* What the sort needs that a card cannot answer: how many of it are owned. The
 * Total column, the Quantity field and each collection's own count all read
 * this rather than a number stamped onto every row before sorting. */
function colSortContext() { return { collections: state.collections }; }

/* The sentence this tab is sorted by, and the one answer to what it is sorted
 * by: the rows' order, the piles the stack view cuts from its first word, and
 * the marks the table header draws. There is no `state.sort` mirror of the
 * first criterion any more — the header was the only thing that wrote one, and
 * it goes through the control now.
 *
 * The field list goes over, so that a stored criterion naming a column this tab
 * has not got is dropped rather than sorting the table on nothing. Which means
 * the same rule reconcileColSorts is called under: the list has to be real. It
 * is — the collections are hydrated before anything renders, and every change
 * to them re-enters through syncColSortFields.
 *
 * No default goes over. This tab's is name ascending, which is what an entry
 * with nothing readable in it falls back to anyway. */
function colSortNow()      { return getSortChain('collections', null, colSortFields()); }
function colSortCriteria() { return colSortNow().criteria; }

let _colControlsMounted = false;
let _colSizeSync = null;
let _colSort = null;
let _colSortFieldSig = '';

function mountColSortControl() {
  const fields = colSortFields();
  _colSortFieldSig = JSON.stringify(fields);
  _colSort = mountSortControl('colSortMount', 'collections', fields, renderResults);
}

/* Collections are added, removed and renamed while this tab is on screen, and
 * each of them is one of the fields above — so the control is rebuilt whenever
 * its list would no longer match. Asked on every render because a render is
 * what every one of those changes ends in.
 *
 * A collection that has gone takes its criterion with it: the stored sort is
 * reconciled against the list as it now is, and this tab re-reads what that
 * left. Silently, and with no modal — a sort naming a column that is not on
 * the table is the tab falling back to name ascending, which is where every
 * unanswerable sort lands. */
function syncColSortFields() {
  if (!_colControlsMounted || JSON.stringify(colSortFields()) === _colSortFieldSig) return;
  reconcileColSorts(state.collections);
  mountColSortControl();
}

function initCollectionsControls() {
  mountColSortControl();
  mountColumnMenu('colColumnsMount', 'collections', COL_COLUMNS, renderResults);
  /* #colResults, the box the views are drawn in, rather than the grid inside
     it: the size applies to the grid and to the stacks, and both are replaced
     on every render. */
  _colSizeSync = mountSizeControl('colSizeMount', 'collections', 'colResults', () => viewMode);
  _colControlsMounted = true;
}

/* Called when the view changes; see setViewMode. Null until the first render
 * has mounted the strip's controls. */
function syncColSize() { _colSizeSync?.(); }

// Lazily pull card metadata from Scryfall when a meta sort/column needs it
let _colMetaFetching = false;
function ensureSortMeta(rows) {
  const cols = getCols('collections', COL_COLUMNS);
  /* Every word of the sort, not only the first: a chain of most-owned then
     mana value needs the mana values as much as one of mana value alone. */
  const needed = colSortCriteria().some(c => COL_META_FIELDS.has(c.field))
    || cols.mana || cols.color || cols.type || cols.rarity || cols.pt || cols.price;
  if (!needed || _colMetaFetching) return;
  const need = rows.map(r => r.name).filter(n => !scryfallMetaCache.has(n)).slice(0, 800);
  if (!need.length) return;
  _colMetaFetching = true;
  ensureScryfallImages(need).then(() => { _colMetaFetching = false; renderResults(); });
}

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

  /* One comparator for every field this tab offers, quantities included. The
     three special cases that used to be here — Total, Quantity, and one per
     collection — are criteria in js/sortui.js now, reading the collections off
     the context rather than a `_sortQty` this function had to stamp onto every
     row before it could sort them. */
  rows.sort(cardComparator(colSortCriteria(), colSortContext()));

  return rows;
}

// ── Schedule render ───────────────────────────────────────────────────────
let _mobileShowAll = false;

function scheduleRender() {
  _mobileShowAll = false; // new search → reset mobile cap
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(renderResults, 80);
}

// ── Render results ────────────────────────────────────────────────────────
function renderResults() {
  if (!_colControlsMounted) initCollectionsControls();
  else syncColSortFields();
  const query   = document.getElementById('searchInput').value.trim().toLowerCase();
  const infoEl  = document.getElementById('resultInfo');
  const moreEl  = document.getElementById('colShowMoreWrap');

  document.getElementById('listView').style.display = viewMode === 'list' ? '' : 'none';
  document.getElementById('gridView').style.display = viewMode === 'grid' ? '' : 'none';
  document.getElementById('pileView').style.display = viewMode === 'pile' ? '' : 'none';

  if (!state.collections.length) {
    // Both views need the empty state — mobile defaults to grid view, which
    // otherwise showed a blank panel instead of the getting-started hint.
    // "above" was the form directly over this table; it is the toolbar's
    // + Add button now, so the hint says which button it means.
    const hint = 'No collections yet — add one with “+ Add” in the toolbar.';
    document.getElementById('resultsBody').innerHTML =
      `<tr><td colspan="99" class="empty-state">${hint}</td></tr>`;
    document.getElementById('cardGrid').innerHTML =
      `<div class="empty-state" style="grid-column:1/-1">${hint}</div>`;
    document.getElementById('pileView').innerHTML = `<div class="empty-state">${hint}</div>`;
    infoEl.textContent = '';
    if (moreEl) moreEl.style.display = 'none';
    return;
  }

  const rows      = buildRows(query);
  ensureSortMeta(rows);
  const isMobile  = window.innerWidth < BP_SM;
  const MOBILE_CAP = 150;
  const fullMax   = viewMode === 'grid' ? 200 : 500;
  /* The stack view is handed every row and needs no "show all": what a pile
     says about itself is how many cards are in it, and a collection cut off at
     its first two hundred rows would be four stacks of the wrong heights. The
     cost is bounded by the fan rather than by the row count — every pile
     arrives spread now, so the table draws its piles times STACK_FAN_MAX and
     not its cards; see cardstack.js. */
  const MAX       = viewMode === 'pile' ? rows.length
                  : (isMobile && !_mobileShowAll) ? MOBILE_CAP : fullMax;

  infoEl.textContent = rows.length === 0
    ? 'No results'
    : `${rows.length.toLocaleString()} card${rows.length !== 1 ? 's' : ''}${rows.length > MAX ? ` (showing first ${MAX})` : ''}`;

  if (viewMode === 'list')      renderListView(rows, MAX);
  else if (viewMode === 'pile') renderPileView(rows);
  else                          renderGridView(rows, MAX);

  // Show "Show all" button on mobile when results are capped
  if (moreEl) {
    const capped = viewMode !== 'pile' && isMobile && !_mobileShowAll && rows.length > MOBILE_CAP;
    if (capped) {
      moreEl.style.display = '';
      moreEl.innerHTML = `<button class="btn-secondary" style="width:100%;padding:var(--space-2);font-size:var(--text-base)"
        onclick="_mobileShowAll=true;renderResults()">Show all ${rows.length.toLocaleString()} cards ↓</button>`;
    } else {
      moreEl.style.display = 'none';
    }
  }
}

// ── List view ─────────────────────────────────────────────────────────────
function renderListView(rows, MAX) {
  const tbody  = document.getElementById('resultsBody');
  const header = document.getElementById('headerRow');

  /* No stale field to reset: the chain is read against this tab's field list,
     so a criterion naming a column that is no longer on the table is dropped
     before it gets here — see colSortNow and getSortChain. */
  const cols = getCols('collections', COL_COLUMNS);

  // ── Header ──
  let h = '<th data-sort="name">Card Name</th>';
  if (cols.mana)   h += '<th data-sort="cmc">MV</th>';
  if (cols.color)  h += '<th data-sort="color">Color</th>';
  if (cols.type)   h += '<th data-sort="type">Type</th>';
  if (cols.rarity) h += '<th data-sort="rarity">Rarity</th>';
  if (cols.pt)     h += '<th data-sort="power">P/T</th>';
  if (cols.price)  h += '<th data-sort="price">Price</th>';
  state.collections.forEach(col => {
    h += `<th data-sort="${esc(colQtyField(col.key))}" style="border-bottom:3px solid ${col.color}">${esc(col.name)}</th>`;
  });
  /* Total and the sort control's "Quantity" are one field: how many of this
     card are owned altogether. The header writes the field the control can
     name, so clicking it and choosing Quantity are the same sort said two
     ways, and the arrow lands on this column either way. */
  h += '<th data-sort="qty">Total</th>';
  header.innerHTML = h;

  /* Two gestures, both of them the sort control's own operations said faster —
     a click makes this column the sort, a shift-click adds it as the next
     word. Neither writes the stored entry: they hand a chain to the control,
     which stores it, relabels itself and re-renders the tab, so the sentence
     on the strip and the marks on this row cannot come apart. See
     chooseSortColumn / appendSortColumn in js/sortui.js for what each means.

     Shift-click has no keyboard or touch equivalent here, and is not given
     one: a `<th>` is not focusable, making the whole header row so is a tab
     stop per column on the way to the table, and a phone has no shift. **The
     sort control is that path** — its popover adds, reorders, flips and
     removes criteria, and it is directly above this table, fully operable by
     keyboard, and the thing this header is a shortcut *into*. The tooltip
     below is what says the shortcut exists to somebody holding a mouse. */
  const sort = colSortNow();
  header.querySelectorAll('th').forEach(th => {
    const field = th.dataset.sort;
    th.title = 'Sort by this column — shift-click to add it to the sort';
    th.onclick = e => _colSort?.set(
      (e.shiftKey ? appendSortColumn : chooseSortColumn)(colSortNow(), field, colSortFields()));

    /* What the marks say. The column that cuts the piles carries the arrow it
       has always carried; a column carrying a later word of the sentence
       carries its position as well, because a shift-click nobody can see the
       result of is a feature nobody knows they used. `aria-sort` is the first
       criterion's alone — it is the one the table is ordered by, and the
       attribute has no way to say "and then". */
    const at = sortColumnAt(sort.criteria, field);
    if (at === -1) return;
    const desc = sort.criteria[at].dir === -1;
    if (at) th.classList.add('sorted-next');
    th.dataset.sortMark = (at ? String(at + 1) : '') + (desc ? '↓' : '↑');
    if (!at) th.setAttribute('aria-sort', desc ? 'descending' : 'ascending');
  });

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="100" class="empty-state">No cards match your search.</td></tr>`;
    return;
  }

  // ── Rows ──
  tbody.innerHTML = rows.slice(0, MAX).map(r => {
    const total = r.qtys.reduce((s, q) => s + q, 0);
    const m = scryfallMetaCache.get(r.name) || {};
    let metaCells = '';
    if (cols.mana)   metaCells += `<td class="td-meta">${colMV(m)}</td>`;
    if (cols.color)  metaCells += `<td class="td-meta">${colColor(m)}</td>`;
    if (cols.type)   metaCells += `<td class="td-meta">${esc(colType(m))}</td>`;
    if (cols.rarity) metaCells += `<td class="td-meta">${colRarity(m)}</td>`;
    if (cols.pt)     metaCells += `<td class="td-meta">${colPT(m)}</td>`;
    if (cols.price)  metaCells += `<td class="td-meta">${m.eur != null ? '€' + m.eur : '—'}</td>`;
    const qtyCells = r.qtys.map(q =>
      `<td class="td-qty ${q ? 'qty-some' : 'qty-zero'}">${q || '—'}</td>`
    ).join('');
    const href = `https://scryfall.com/search?q=!%22${encodeURIComponent(r.name)}%22`;
    return `<tr>
      <td class="td-name"><a class="card-link" href="${href}" target="_blank" rel="noopener" data-name="${esc(r.name)}">${esc(r.name)}</a></td>
      ${metaCells}
      ${qtyCells}
      <td class="td-total">${total}</td>
    </tr>`;
  }).join('');
}

// ── Metadata cell renderers ───────────────────────────────────────────────
function colMV(m)    { return (m.cmc !== undefined && m.cmc !== null) ? Math.trunc(m.cmc) : '—'; }
function colColor(m) {
  const cs = (m.ci && m.ci.length ? m.ci : m.colors) || [];
  if (!cs.length) return '<i class="ms ms-c ms-cost"></i>';
  return cs.map(c => `<i class="ms ms-${c.toLowerCase()} ms-cost"></i>`).join(' ');
}
function colType(m) {
  if (!m.type) return '—';
  const main = m.type.split('//')[0].split('—')[0].trim();
  const words = main.split(' ').filter(Boolean);
  return words[words.length - 1] || '—';
}
function colRarity(m) {
  if (!m.rarity) return '—';
  return `<span class="rarity-tag r-${m.rarity}">${m.rarity[0].toUpperCase()}${m.rarity.slice(1)}</span>`;
}
function colPT(m) {
  return (m.power != null && m.toughness != null) ? `${esc(String(m.power))}/${esc(String(m.toughness))}` : '—';
}

// ── Stack view ────────────────────────────────────────────────────────────
// The same cards as the grid, put in piles — and what belongs in a pile is
// whatever the tab is sorted by, so sorting by rarity gives four stacks of
// visibly different heights and sorting by mana value stands the curve up off
// the table. js/sortui.js cuts the piles and js/cardstack.js draws them; what
// is here is what a Collections card is (its picture, and how many of it are
// owned) and what clicking a pile means.

/* Which piles have been settled. Empty is the table as it arrives — every pile
 * spread — and any number of them may be settled, for the reason
 * js/cardstack.js gives. Not persisted: a reload is a fully spread table. */
const _colSettledPiles = new Set();

/* A merged collection row, seen as a card on a table. The badge is the number
   the list view's Total column says: how many of it are owned across every
   collection, which is this tab's own figure for a card. */
function _colStackCard(row) {
  const total = row.qtys.reduce((s, q) => s + q, 0);
  return {
    name:  row.name,
    img:   scryfallCache.get(row.name),
    badge: `×${total}`,
    href:  `https://scryfall.com/search?q=!%22${encodeURIComponent(row.name)}%22`,
  };
}

async function renderPileView(rows) {
  const host = document.getElementById('pileView');

  if (!rows.length) {
    host.innerHTML = `<div class="empty-state">No cards match your search.</div>`;
    return;
  }

  /* Already in sort order — buildRows sorted them, and a pile is a run of that
     order rather than a second arrangement of it. The field goes over as it
     is: the quantity fields that had to be translated into `qty` here, because
     the grouping had never heard of them, are fields it knows now.

     Cut from the first word of the same sentence buildRows sorted by. There
     used to be a `state.sort` mirroring that word for the table header to draw
     its arrow on, and this read the chain rather than the mirror so the two
     could not disagree about what the piles were; the header reads the chain
     too now, and the mirror is gone. The rest of the chain never reaches here:
     it has already done its work, ordering the cards inside each pile. */
  const groups = cardGroups(colSortCriteria()[0]?.field || 'name', rows, colSortContext());
  forgetGonePiles(_colSettledPiles, groups);

  const draw = () => cardPilesHtml(groups, { settled: _colSettledPiles, cardOf: _colStackCard });
  host.innerHTML = draw();

  /* Only what is actually drawn needs a picture: the cards each spread pile
     fans, and the one card on top of each settled one. A spread pile is a fan
     rather than the whole pile, so this is bounded by STACK_FAN_MAX per pile
     however large the collection is — which is what a table arriving spread
     costs, and the reason it is a fan and not the pile. */
  const missing = [];
  for (const group of groups) {
    const drawn = _colSettledPiles.has(group.label)
      ? group.cards.slice(0, 1) : group.cards.slice(0, STACK_FAN_MAX);
    for (const card of drawn) if (!scryfallCache.has(card.name)) missing.push(card.name);
  }
  if (missing.length) {
    await ensureScryfallImages(missing);
    // Only re-render if the stack view is still the one on screen
    if (document.getElementById('pileView').style.display !== 'none') host.innerHTML = draw();
  }
}

/* What clicking a pile does. One listener rather than a handler per pile,
 * because the view is rebuilt on every change.
 *
 * The header — the arrow and the name beside it — says "the other thing",
 * whichever way the pile is lying: it is the one part of a pile that is about
 * the pile rather than about the cards in it, so it is where both halves of
 * the answer live. The stack below it says "open this one", which is the
 * gesture it has always had. And anywhere else on a pile that is already open
 * is a click on a card in it — opening a card must not tidy the pile it came
 * from — so it is the one click here that does nothing. */
document.addEventListener('click', e => {
  if (viewMode !== 'pile') return;
  if (document.getElementById('tab-collections')?.style.display === 'none') return;
  const pile = e.target.closest('#pileView .card-pile');
  if (!pile) return;
  const label = pile.dataset.pile;
  if (e.target.closest('.card-pile-hdr')) togglePile(_colSettledPiles, label);
  else if (_colSettledPiles.has(label)) _colSettledPiles.delete(label);
  else return;
  renderResults();
});

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
        ? `<img class="card-img" src="${imgUri}" alt="${esc(r.name)}" onerror="this.style.display='none';this.parentNode.classList.add('img-failed')">`
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
        <a class="grid-img-link card-open" href="${href}" target="_blank" rel="noopener" data-name="${esc(r.name)}">${imgHtml}</a>
        <div class="grid-footer">
          <div class="grid-name card-open" title="${esc(r.name)}" data-name="${esc(r.name)}" style="cursor:pointer">${esc(r.name)}</div>
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
