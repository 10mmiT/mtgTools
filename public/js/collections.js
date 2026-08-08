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

// ── Whose shelf ───────────────────────────────────────────────────────────
// A collection has one owner and may have none. The null case is the real
// answer for a shared box rather than a row nobody filled in: it belongs to
// the group, so it counts as the group's and never as any one person's.
//
// Everything below reads the owner through these three, and nothing else
// reads `col.owner` directly — an id is not a person until the player list
// says it is.

/* The player a collection belongs to, or null for the group's. Resolved
 * rather than trusted: an id naming a player who has been removed is the
 * group's, which is what routes/state.js makes of it in the database the
 * moment that removal is saved. */
function colOwner(col) {
  if (!col?.owner) return null;
  return state.players.find(p => p.id === col.owner) || null;
}

/* Which shelf this tab is showing — 'mine' or 'all' — and the one place that
 * decides it. "Mine" needs somebody to be, so an app that cannot say who you
 * are reads 'all' whatever is stored: the control is not offered at all in
 * that case, and a stored preference from a browser that once knew must not
 * quietly hide every collection from somebody who cannot switch it back. */
const COL_SCOPE_KEY = 'mtgtools_col_scope';

function colScope() {
  if (!myPlayerId()) return 'all';
  try { return localStorage.getItem(COL_SCOPE_KEY) === 'mine' ? 'mine' : 'all'; }
  catch { return 'all'; }
}

function setColScope(scope) {
  try { localStorage.setItem(COL_SCOPE_KEY, scope === 'mine' ? 'mine' : 'all'); } catch {}
  renderCollections();
  renderResults();
}

/* The collections this tab is *about*: every loaded one, or the ones that are
 * yours. Every count, column, quantity and card on the tab comes from this
 * list, and the indices into it are what the quantity columns are keyed by —
 * so it is asked for once per render and read in the same order throughout.
 *
 * The chip row is deliberately not filtered by it; see renderCollections. */
function colShelf() {
  const me = myPlayerId();
  if (!me || colScope() !== 'mine') return state.collections;
  return state.collections.filter(c => c.owner === me);
}

/* Whose shelf it is, changed from the ⋯ menu the chip already carries. A
 * route of its own rather than a re-save of the collection: the cards are the
 * collection, and none of them changed. */
async function setCollectionOwner(key, ownerId) {
  const col = state.collections.find(c => c.key === key);
  if (!col) return;
  const previous = col.owner;
  col.owner = ownerId || null;
  renderCollections();
  renderResults();
  try {
    const res = await fetch(`/api/collections/${encodeURIComponent(key)}/owner`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ owner: col.owner }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  } catch (e) {
    col.owner = previous;
    renderCollections();
    renderResults();
    alert(`Could not change the owner: ${e.message}`);
  }
}

/* The owner rows on a collection's ⋯ menu: the group, then every player, with
 * a tick on the one it is. Every player and not only you, because an owner is
 * a fact about the shelf rather than a claim on it — somebody adds the box
 * that lives in the cupboard and says whose it is. */
function colOwnerMenuItems(col) {
  const items = [{ section: 'Owner' }, {
    label: `${col.owner ? '' : '✓ '}The group`,
    onclick: `setCollectionOwner('${jsAttr(col.key)}', null)`,
  }];
  for (const player of state.players) {
    items.push({
      label: `${col.owner === player.id ? '✓ ' : ''}${esc(player.name)}`,
      onclick: `setCollectionOwner('${jsAttr(col.key)}', '${jsAttr(player.id)}')`,
    });
  }
  return items;
}

/* The player list, wherever a collection's owner is chosen from a select: the
 * Add drawer's field, and nowhere else so far. Yours is preselected, because
 * a shelf you are adding is usually yours — the group is one click up the
 * list, and it is what an app that cannot say who you are opens on. */
function colFillOwnerSelect(id, selected) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const chosen = selected === undefined ? (myPlayerId() || '') : (selected || '');
  sel.innerHTML = `<option value="">The group (no owner)</option>` +
    state.players.map(p =>
      `<option value="${esc(p.id)}"${p.id === chosen ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  sel.value = chosen;
}

/* The + Add button's own handler rather than openDrawer directly: the owner
 * field is a list of players, and the players are known by then. */
function openAddCollection() {
  colFillOwnerSelect('ownerInput');
  openDrawer('addColDrawer');
}

/* What the Add drawer's owner field is set to, as the record wants it. */
function colChosenOwner() {
  return document.getElementById('ownerInput')?.value || null;
}

/* Mounted once, synced on every render. Hidden — not disabled — when the app
 * cannot say who you are, per the ticket: no ownership distinction is offered
 * at all, and everything reads as the group's. The whole mount goes, the same
 * way the size control's does, so the strip does not keep a gap for it. */
function syncColScope() {
  const host = document.getElementById('colScopeMount');
  if (!host) return;
  const me = myPlayerId();
  host.classList.toggle('scope-mount-hidden', !me);
  const sel = document.getElementById('colScopeSel');
  if (sel) sel.value = colScope();
}

/* Who you are can change while the app is open — in open mode it is a name
 * typed into another tab's "Who are you?" bar — and it is what decides
 * whether this tab offers the distinction at all. Called from there. */
let _colIdentity = null;
function colIdentityChanged() {
  const now = myPlayerId();
  if (now === _colIdentity) return;
  _colIdentity = now;
  if (!_colControlsMounted) return;   // the first render will read it
  syncColScope();
  renderCollections();
  renderResults();
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
    owner:    colChosenOwner(),
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
  pendingCsvKey   = updateKey;
  pendingCsvName  = updateKey ? null : document.getElementById('nameInput').value.trim();
  // Read now, not in the reader's callback: the drawer that carries the field
  // is closed by the time the file has been read.
  pendingCsvOwner = updateKey ? null : colChosenOwner();
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
          owner:    pendingCsvOwner,
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
        pendingCsvOwner = null;
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
      owner: col.owner || null,
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
  syncColScope();
  /* The Deck Builder's readout counts these collections — "87 of 99 owned" —
     so a shelf that has just finished loading, been given an owner or been
     removed changes a number on another tab. Guarded because this file is
     loaded on its own in the tests that assert this tab. */
  if (typeof dbShelvesChanged === 'function') dbShelvesChanged();
  const row = document.getElementById('collectionsChips');

  if (!state.collections.length) { row.style.display = 'none'; row.innerHTML = ''; return; }
  row.style.display = '';

  /* Every loaded collection, including the ones whose cards this tab is not
   * showing. The chip row is the inventory — what is loaded, how big it is,
   * and the ⋯ menu that refreshes, removes and says whose it is — and a
   * collection you cannot see the menu of is one whose owner you cannot fix.
   * A chip that is off the shelf being looked at says so instead. */
  const shown = new Set(colShelf().map(c => c.key));

  row.innerHTML = state.collections.map(col => {
    const isCSV  = col.source.startsWith('csv-');
    const isBusy = col.status === 'loading' || col.updating;
    const owner  = colOwner(col);
    const off    = !shown.has(col.key);

    // The count is also the progress bar: while pages are coming in it reads
    // "1,240 / 5,600", and the left number climbs on every render.
    const count = col.status === 'error' ? 'failed'
      : col.status === 'loading'
        ? (col.total ? `${col.entries.toLocaleString()} / ${col.total.toLocaleString()}` : 'connecting…')
        : col.updating ? 'updating…'
          : [...col.cards.values()].reduce((s, c) => s + c.qty, 0).toLocaleString();

    const tip = col.status === 'error'
      ? col.error
      : [sourceLabel(col.source),
         owner ? `${owner.name}’s` : 'the group’s',
         col.savedAt ? `updated ${relTime(col.savedAt)}` : '',
         off ? 'not on the shelf you are looking at' : ''].filter(Boolean).join(' · ');

    const cls = (col.status === 'error' ? ' chip--error' : isBusy ? ' chip--busy' : '')
              + (off ? ' chip--off' : '');

    return `
      <span class="chip${cls}" title="${esc(tip)}">
        <span class="chip-dot" style="background:${col.color}"></span>
        <span class="chip-label">${esc(col.name)}</span>
        ${owner ? `<span class="chip-owner">${esc(owner.name)}</span>` : ''}
        <span class="chip-count">${count}</span>
        ${isBusy ? '' : kebabMenuHtml([
          { label: isCSV ? 'Re-import CSV' : 'Refresh', onclick: `updateCollection('${col.key}')` },
          ...colOwnerMenuItems(col),
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
          ...colShelf().map(col => ({ key: colQtyField(col.key), label: col.name }))];
}

/* What the sort needs that a card cannot answer: how many of it are owned. The
 * Total column, the Quantity field and each collection's own count all read
 * this rather than a number stamped onto every row before sorting. */
function colSortContext() { return { collections: colShelf() }; }

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
 * unanswerable sort lands.
 *
 * Gone means *removed*, and the reconcile is against every loaded collection
 * rather than the ones on the shelf being looked at. Looking at your own
 * shelf hides columns without deleting anything, so a criterion naming a
 * hidden one is filtered out of the reading — getSortChain does that against
 * the field list, and writes nothing — and comes back with the collection
 * when the scope does. Reconciling against the shelf would throw it away. */
function syncColSortFields() {
  if (!_colControlsMounted || JSON.stringify(colSortFields()) === _colSortFieldSig) return;
  reconcileColSorts(state.collections);
  mountColSortControl();
}

function initCollectionsControls() {
  _colIdentity = myPlayerId();
  syncColScope();
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

// ── What the search box means ─────────────────────────────────────────────
// It reads Scryfall's query language (js/cardquery.js), of which a bare word
// is the smallest sentence — so `sol ring` still means what it has always
// meant here, and `t:creature c:r -o:draw` now means something too.
//
// Two costs come with that, and both are paid in renderResults rather than
// here. A query can be nonsense, and says so instead of returning nothing;
// and a query that asks about anything but the name needs card facts the app
// fetches lazily, so it waits for them once per collection.

/* The examples, shown where somebody is looking when they need them: under an
 * empty result, and under a query that didn't parse. Same reasoning as the
 * Scryfall tab's own empty state — a permanent second toolbar row of syntax
 * tips is in front of everyone who already knows. */
/* The syntax tip is the language's own — CQ_SYNTAX_HELP in js/cardquery.js —
 * because the Deck Builder's filter box shows the same one, and a second copy
 * here would go stale the first time the parser learned a filter. */

/* A row as js/cardquery.js wants to see it: the name off the row, and the
 * card facts out of the cache the sort and the metadata columns fill. A name
 * with nothing cached is an empty card rather than a missing one — it matches
 * nothing but its own name, which is what an unresolved card can honestly
 * answer. */
function colQueryCard(name) {
  /* `owned` is the one field the cache cannot supply, because it is a fact
     about the collections. Every row on this tab is a row of the shelf being
     looked at, so on this tab the answer is always yes — which makes `is:owned`
     a filter that means nothing here and everything in the Deck Builder,
     where the deck is full of cards the shelf has never seen. */
  return { name, ...(scryfallMetaCache.get(name) || {}), owned: true };
}

/* Every name across every loaded collection needs its facts before a query
 * that reads them can be trusted: a filter run over half a cache is not a
 * narrower answer, it is a wrong one. So this reports whether the search can
 * run yet, and starts the fetch — in one pass, whatever the size, since
 * fetchCardCollection does its own batching — if it can't.
 *
 * Unresolved names are cached as `{}` by ensureScryfallImages, so a card the
 * local database has never heard of costs one lookup and not one per
 * keystroke. That is the postcondition this rests on — every name handed to
 * ensureScryfallImages is in scryfallMetaCache when it resolves, one way or
 * the other — and it is load-bearing: a name that came back still missing
 * would be re-fetched by the re-render this schedules, forever. */
let _colQueryMetaFetching = false;
function colQueryMetaReady() {
  const missing = new Set();
  for (const col of colShelf()) {
    for (const name of col.cards.keys()) if (!scryfallMetaCache.has(name)) missing.add(name);
  }
  if (!missing.size) return true;
  if (!_colQueryMetaFetching) {
    _colQueryMetaFetching = true;
    ensureScryfallImages([...missing]).finally(() => {
      _colQueryMetaFetching = false;
      renderResults();
    });
  }
  return false;
}

function buildRows(query) {
  const merged = new Map();
  /* The shelf, not every loaded collection: a row's `qtys` are its quantities
     in the collections this tab is showing, in their order, which is what the
     table's columns, the grid's badges and the Total all read by index. */
  const shelf = colShelf();
  shelf.forEach((col, ci) => {
    col.cards.forEach((card, name) => {
      if (!merged.has(name)) {
        merged.set(name, { name: card.name, type: card.type, mana: card.mana,
                            qtys: new Array(shelf.length).fill(0) });
      } else {
        const e = merged.get(name);
        while (e.qtys.length < shelf.length) e.qtys.push(0);
      }
      merged.get(name).qtys[ci] = card.qty;
    });
  });

  let rows = Array.from(merged.values());
  if (deckFilter && deck) rows = rows.filter(r => deck.cards.has(r.name));
  if (query) rows = rows.filter(r => query.match(colQueryCard(r.name)));

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

/* Something other than cards, said in whichever view is on screen. All three
 * of them need it and not one of them is reliably the visible one — mobile
 * defaults to the grid, which used to show a blank panel where the list view
 * showed the getting-started hint — so the message goes into all three and
 * the display rules decide who reads it. */
function colSayInstead(html, info = '') {
  document.getElementById('resultsBody').innerHTML =
    `<tr><td colspan="99" class="empty-state">${html}</td></tr>`;
  document.getElementById('cardGrid').innerHTML =
    `<div class="empty-state" style="grid-column:1/-1">${html}</div>`;
  document.getElementById('pileView').innerHTML = `<div class="empty-state">${html}</div>`;
  document.getElementById('resultInfo').textContent = info;
  const moreEl = document.getElementById('colShowMoreWrap');
  if (moreEl) moreEl.style.display = 'none';
}

// ── Render results ────────────────────────────────────────────────────────
function renderResults() {
  if (!_colControlsMounted) initCollectionsControls();
  else syncColSortFields();
  const raw     = document.getElementById('searchInput').value.trim();
  const infoEl  = document.getElementById('resultInfo');
  const moreEl  = document.getElementById('colShowMoreWrap');

  document.getElementById('listView').style.display = viewMode === 'list' ? '' : 'none';
  document.getElementById('gridView').style.display = viewMode === 'grid' ? '' : 'none';
  document.getElementById('pileView').style.display = viewMode === 'pile' ? '' : 'none';

  if (!state.collections.length) {
    // "above" was the form directly over this table; it is the toolbar's
    // + Add button now, so the hint says which button it means.
    colSayInstead('No collections yet — add one with “+ Add” in the toolbar.');
    return;
  }

  /* Collections are loaded, and none of them is yours. Not an error and not
     "no results": a person with no collection of their own is an ordinary
     thing to be, so this says which of the two questions is being asked and
     where the other one is. */
  if (!colShelf().length) {
    colSayInstead('None of the loaded collections is yours yet — set an owner from a collection’s ⋯ menu, or switch the shelf to everyone’s.', 'No collections of yours');
    return;
  }

  /* What was typed, as a filter. A search that cannot mean anything says so —
     the message names the filter it choked on — rather than quietly matching
     no cards, which is what an unknown `f:standard` would otherwise look like
     and is indistinguishable from owning none of them. */
  let query = null;
  try {
    query = parseCardQuery(raw);
  } catch (e) {
    colSayInstead(`${esc(e.message)}${CQ_SYNTAX_HELP}`, 'Invalid search');
    return;
  }

  /* A name search needs nothing but the rows. Anything else — a type, a
     colour, a word in the rules text — is a fact about the card that is
     fetched lazily everywhere else in this tab, and here it has to be in hand
     before the first row can be judged. Once, per collection, per session. */
  if (query?.needsMeta && !colQueryMetaReady()) {
    colSayInstead('Reading card data for this search…', 'Loading…');
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
  colShelf().forEach(col => {
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
    tbody.innerHTML = `<tr><td colspan="100" class="empty-state">No cards match your search.${CQ_SYNTAX_HELP}</td></tr>`;
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
    host.innerHTML = `<div class="empty-state">No cards match your search.${CQ_SYNTAX_HELP}</div>`;
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
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">No cards match your search.${CQ_SYNTAX_HELP}</div>`;
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
      const qtyBadges = colShelf().map((col, i) => {
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
