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

/* Which columns of an export say what.
 *
 * Read by the header rather than by where a column sits, because the header
 * line is the only promise an export makes — and the two formats are told
 * apart by the column holding the quantity, which is the one column each has
 * and the other does not.
 *
 * The printing columns are the half of both files that was never read. Both
 * were checked against a real export before any of this was promised:
 *
 *   Archidekt  names the Scryfall ID outright, beside the edition code, the
 *              edition name and the collector number. Every row of a 6,004-row
 *              export carried all four
 *   Moxfield   names the edition and the collector number and no Scryfall id
 *              anywhere in the file — which is a printing all the same, being
 *              the same identity said the other way round
 *
 * A row that says nothing lands in the unknown entry with its copies intact.
 * Nothing here is completed from a card's name.
 *
 * What a printing is made of is not restated here: CARD_PRINTING_FIELDS in
 * js/state.js is the shape, and every column below is named for the field it
 * fills.
 */
const CSV_FORMATS = [
  { source: 'csv-archidekt',
    cols: { qty: 'quantity', name: 'name', id: 'scryfall id',
            set: 'edition code', set_name: 'edition name',
            collector_number: 'collector number', finish: 'finish',
            lang: 'language', condition: 'condition' } },
  { source: 'csv-moxfield',
    cols: { qty: 'count', name: 'name', set: 'edition',
            collector_number: 'collector number', finish: 'foil',
            lang: 'language', condition: 'condition' } },
];

/* The finish, spelled the way Scryfall spells it and the way the Archidekt
 * import already writes it down — so a shelf imported from a file and one
 * imported from the API say the same word about the same card. Archidekt
 * writes "Normal", Moxfield leaves the cell empty; both mean the copy nobody
 * paid extra for. Anything else is kept as the export said it. */
function csvFinish(cell) {
  const said = (cell || '').trim().toLowerCase();
  return !said || said === 'normal' ? 'nonfoil' : said;
}

/* A row is an acquisition, not a card: a card held in four editions is four
 * rows, and both exports write the quantity per row. This used to keep the
 * first row of a name and drop the rest, on the belief that Archidekt
 * repeated an oracle-level total on every one — it does not, and a real
 * 7,943-copy export imported as 5,057. */
function importCSV(text, filename) {
  const rows = parseCSVRows(text);
  if (rows.length < 2) throw new Error('CSV appears to be empty.');
  const header = rows[0].map(h => h.trim().toLowerCase());
  const format = CSV_FORMATS.find(f => header.includes(f.cols.qty));
  if (!format) {
    // Named by what was looked for and not found, because the file somebody
    // chose is nearly always a decklist or somebody else's site's export, and
    // "no Quantity column" is the sentence that says which.
    throw new Error('Unrecognised CSV format: no "Quantity" or "Count" column. '
      + 'Expected an Archidekt or Moxfield collection export.');
  }
  const at = Object.fromEntries(
    Object.entries(format.cols).map(([field, col]) => [field, header.indexOf(col)]));

  /* Gathered by name, and under each name by printing, because that is the
   * shape the shelf is stored in — and this tab draws what it has just parsed
   * long before the server has seen a byte of it. The fold is the one
   * addCardPrinting does on the server, said again here: an importer with its
   * own idea of what makes two copies the same card is how the two quietly
   * stop agreeing. */
  const held = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row  = rows[i];
    const cell = field => (at[field] >= 0 ? String(row[at[field]] ?? '').trim() : '');
    const name = cell('name');
    const qty  = parseInt(cell('qty'), 10) || 0;
    if (!name || qty <= 0) continue;

    let entry = held.get(name);
    if (!entry) held.set(name, entry = {
      card: { name, type: '', mana: '', qty: 0 }, printings: new Map(),
    });
    entry.card.qty += qty;

    const printing = {};
    for (const field of CARD_PRINTING_FIELDS) {
      const value = field === 'finish' ? csvFinish(cell('finish')) : cell(field);
      if (value) printing[field] = value;
    }
    const seen = entry.printings.get(cardPrintingKey(printing));
    if (seen) seen.qty += qty;
    else entry.printings.set(cardPrintingKey(printing),
      namesPrinting(printing) ? { ...printing, qty } : { id: null, qty });
  }

  const cards = new Map();
  for (const [name, entry] of held)
    cards.set(name, { ...entry.card, printings: [...entry.printings.values()] });
  return { cards, source: format.source };
}

// ── URL Parsing ───────────────────────────────────────────────────────────
/* What was pasted — a collection to fetch, a refusal with a reason, or
 * nothing recognisable.
 *
 * A Moxfield collection URL is refused by name rather than left to fall
 * through to "that is not a valid URL", because it is a perfectly valid one:
 * api2.moxfield.com is behind Cloudflare and answers 403 to this server, as
 * it does to any. Accepting it starts a four-minute job that cannot finish,
 * and refusing it silently teaches nobody where the way in is — so the
 * refusal names the export, which is a Moxfield collection's route onto a
 * shelf and carries the printings besides. */
/* The only place this is said. The server has no sentence about Moxfield at
 * all any more: nothing asks it for one, because a link is turned down here
 * and a shelf imported from Moxfield back when the tab did the fetching is
 * re-imported from the export in place — see COL_FETCH_SOURCES. */
const MOXFIELD_REFUSAL =
  'Moxfield’s API refuses this server (Cloudflare), so a collection link cannot be fetched. '
  + 'On Moxfield use Collection → Download (CSV), then Import CSV here — the export names '
  + 'the printings too.';

function parseInput(raw) {
  raw = (raw || '').trim();
  if (/moxfield\.com\/collection\//.test(raw)) return { refused: MOXFIELD_REFUSAL };
  const ark = raw.match(/archidekt\.com.*\/(\d+)\/?/);
  if (ark) return { source: 'archidekt', id: ark[1] };
  if (/^\d+$/.test(raw)) return { source: 'archidekt', id: raw };
  return null;
}

/* 'moxfield' is here to name the shelves that predate the CSV import and for
 * nothing else: nothing creates one and nothing fetches one, so this is the
 * last of that source and only until none of those shelves is left. */
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
  if (parsed?.refused) { showError(errEl, parsed.refused); return; }
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

  urlEl.value  = '';
  nameEl.value = '';
  closeDrawers();   // the import panel and the chip are what report progress

  /* The collection is not pushed onto state.collections here. It does not
   * exist yet — the server is about to spend four minutes fetching it, and
   * until it lands there are no cards to put in a row. What stands in for it
   * meanwhile is the import, which the panel and the chip row both draw. */
  startImport(col);
}

// ── Imports, which the server runs ────────────────────────────────────────
/* This used to be a loop in the tab that fetched every page itself. It cannot
 * be, any more: Archidekt's rate limit makes a big collection a four-minute
 * job (see archidekt-queue.js), and a tab that is refreshed, backgrounded on a
 * phone, or locked does not survive four minutes. Worse, the old loop wrote
 * nothing until the final page, so an interruption lost all of it.
 *
 * So the browser's whole part is now: ask the server to start, watch, and
 * pick up the finished collection. collection-import.js is the other half.
 */
async function startImport(col, { restart = false } = {}) {
  try {
    const res = await fetch(`/api/collections/${encodeURIComponent(col.key)}/import`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name: col.name, source: col.source, id: col.id, color: col.color,
        owner: col.owner ?? null, restart,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    if (Array.isArray(body.imports)) state.imports = body.imports;
  } catch (e) {
    /* A start that never took is shown as a failed import rather than an
     * alert, so it lands in the same place as every other import problem and
     * survives the user looking at another tab. */
    state.imports = [...state.imports.filter(i => i.key !== col.key), {
      key: col.key, name: col.name, source: col.source, id: col.id, color: col.color,
      status: 'error', entries: 0, total: null, error: e.message, live: false,
    }];
  }
  renderImports();
  renderCollections();
  renderImportEmptyState();
  pollImports();
}

/** Stop one. `forget` throws away the pages it had gathered as well. */
async function stopImport(key, forget = false) {
  const qs = forget ? '?forget=1' : '';
  try {
    const res  = await fetch(`/api/imports/${encodeURIComponent(key)}${qs}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (Array.isArray(body.imports)) state.imports = body.imports;
    else state.imports = state.imports.filter(i => i.key !== key);
  } catch {
    state.imports = state.imports.filter(i => i.key !== key);
  }
  renderImports();
  renderCollections();
  renderImportEmptyState();
}

/** Pick a stopped import back up from where it got to. */
function resumeImport(key) {
  const imp = state.imports.find(i => i.key === key);
  if (imp) startImport(imp);
}

/* ── The watch ──────────────────────────────────────────────────────────────
 * One timer, started when an import is running and stopped when none is. The
 * two-second beat is for the progress number to feel live at roughly a page a
 * second; the payload is a handful of counters, not the cards.
 */
const IMPORT_POLL_MS = 2000;
let _importTimer = null;

function anyImportLive() {
  return state.imports.some(i => i.status === 'running');
}

function pollImports() {
  if (_importTimer || !anyImportLive()) return;
  _importTimer = setInterval(async () => {
    // A hidden tab is not being read by anyone, and on a phone it may be
    // frozen anyway. The import does not need watching to make progress.
    if (document.visibilityState === 'hidden') return;
    try {
      const res = await fetch('/api/imports');
      if (!res.ok) return;
      const { imports = [] } = await res.json();
      const wasLive = new Set(state.imports.filter(i => i.status === 'running').map(i => i.key));
      state.imports = imports;

      // An import that was running and is now gone from the list has landed:
      // its row is deleted the moment the collection it became is written. So
      // that is the cue to go and fetch the collection itself.
      const landed = [...wasLive].some(key => !imports.find(i => i.key === key));
      if (landed) await reloadCollections();

      renderImports();
      renderCollections();
      renderImportEmptyState();
      if (!anyImportLive()) { clearInterval(_importTimer); _importTimer = null; }
    } catch {}
  }, IMPORT_POLL_MS);
}

/* The results table only needs redrawing on an import tick while it is empty,
 * where the import *is* the content ("Importing … 1,225 of 6,247"). With a
 * collection on the shelf the table is showing cards, and rebuilding every
 * card element every two seconds would flash the grid and lose the scroll
 * position for a number that is already climbing in two other places. */
function renderImportEmptyState() {
  if (!state.collections.length) renderResults();
}

/* ── The import panel ───────────────────────────────────────────────────────
 * The fuller readout, in the deck column: which collections are being
 * fetched, how far along, and the buttons to stop or resume one. It is only
 * a column at >=1280px — below that the deck column is a drawer — so this is
 * the desktop half of the pair and the chip row is the half a phone sees.
 * Neither is the other's fallback; they show the same imports at the detail
 * each surface has room for.
 */
function renderImports() {
  const panel = document.getElementById('importPanel');
  if (!panel) return;                     // tabs rendered on their own in tests

  if (!state.imports.length) { panel.style.display = 'none'; panel.innerHTML = ''; return; }
  panel.style.display = '';

  panel.innerHTML = `
    <div class="section-title">Importing</div>
    ${state.imports.map(imp => {
      const running = imp.status === 'running';
      const pct = imp.total ? Math.min(100, Math.round((imp.entries / imp.total) * 100)) : null;

      const line = running
        ? (imp.total ? `${imp.entries.toLocaleString()} of ${imp.total.toLocaleString()} cards` : 'starting…')
        : imp.status === 'error'
          ? (imp.error || 'failed')
          : `stopped at ${imp.entries.toLocaleString()} cards`;

      /* The bar is left at its last width for a stopped import rather than
       * reset or hidden: how far it got is exactly what someone deciding
       * whether to resume wants to see. */
      const bar = pct === null ? '' : `
        <div class="import-bar"><div class="import-bar-fill${running ? '' : ' is-stopped'}" style="width:${pct}%"></div></div>`;

      return `
        <div class="import-row${running ? '' : ' is-stopped'}">
          <div class="import-head">
            <span class="import-dot" style="background:${imp.color}"></span>
            <span class="import-name">${esc(imp.name)}</span>
            <span class="import-pct">${running && pct !== null ? pct + '%' : ''}</span>
          </div>
          ${bar}
          <div class="import-meta">${esc(line)}</div>
          <div class="import-actions">
            ${running
              ? `<button class="btn-secondary import-btn" onclick="stopImport('${imp.key}')">Stop</button>`
              : `<button class="btn-secondary import-btn" onclick="resumeImport('${imp.key}')">Resume</button>
                 <button class="btn-secondary import-btn import-btn--quiet" onclick="stopImport('${imp.key}', true)">Discard</button>`}
          </div>
        </div>`;
    }).join('')}
    <div class="import-note">Imports run on the server — you can close this page.</div>`;
}

/* Pull the collections back from the server after an import lands. A whole
 * /api/state read rather than a narrower one, because hydrateState is what
 * knows how to turn the payload into the shape the tab renders from. */
async function reloadCollections() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    hydrateState(await res.json());
    renderResults();
  } catch {}
}

/* getItems, getTotalCount, hasMore and parseCard used to live here, reading
 * the page shapes of the two collection APIs. Nothing in the browser fetches
 * those pages any more — the server does, so the readers moved with the loop
 * to collection-import.js rather than being kept in two places. */

// ── CSV Import ────────────────────────────────────────────────────────────
function openCsvPicker(updateKey) {
  /* A picker still waiting on an answer is let go of first. pendingCsvKey is
   * one slot and there is one file input behind it, so a second shelf asking
   * for a file used to overwrite the first shelf's claim on it and leave that
   * shelf `updating` with its offer spent — until a reload, and with the whole
   * tab's state poll held off meanwhile. Released here rather than refused,
   * because the shelf somebody just pressed is the one they mean. */
  if (pendingCsvKey && pendingCsvKey !== updateKey) cancelCsvPicker();
  pendingCsvKey   = updateKey;
  pendingCsvName  = updateKey ? null : document.getElementById('nameInput').value.trim();
  // Read now, not in the reader's callback: the drawer that carries the field
  // is closed by the time the file has been read.
  pendingCsvOwner = updateKey ? null : colChosenOwner();
  document.getElementById('csvInput').click();
}

/* The picker closed with nothing chosen, which is a thing people do — they
 * meant a different shelf, or the export is not downloaded yet.
 *
 * Opening it marks the shelf `updating` and spends the offer above the table,
 * and neither is given back by the file arriving, because no file arrives: a
 * cancelled picker fires `cancel` and never `change`. Left to itself that is a
 * chip reading "updating…" until the page is reloaded and an offer that cannot
 * be taken a second time — one bug seen from two sides. So the press is undone
 * in full, and the shelf is exactly what it was before it. */
function cancelCsvPicker() {
  const key = pendingCsvKey;
  pendingCsvKey = pendingCsvName = pendingCsvOwner = null;
  if (key) {
    const col = state.collections.find(c => c.key === key);
    if (col) col.updating = false;
    _colOffersTaken.delete(key);
  }
  renderCollections();
}

document.getElementById('csvInput').addEventListener('cancel', () => cancelCsvPicker());

document.getElementById('csvInput').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  // A browser that answers a cancelled picker with a fileless `change` rather
  // than a `cancel` says the same thing, and is answered the same way.
  if (!file) { cancelCsvPicker(); return; }

  const reader = new FileReader();
  reader.onload = ev => importCsvText(ev.target.result, file.name);
  reader.readAsText(file);
});

/* A chosen file, read and put where it goes: onto the shelf that asked for it,
 * or onto a new one. Apart from the input's change event because *where* is
 * the whole of it — openCsvPicker names a shelf when the file is a re-import
 * — and nothing past the read has anything to do with a file input. */
async function importCsvText(text, fileName) {
  try {
    const { cards, source } = importCSV(text, fileName);
    const total = [...cards.values()].reduce((s, c) => s + c.qty, 0);

    if (pendingCsvKey) {
      /* The same shelf, re-imported. Its key, its name, its colour and its
       * owner are untouched — everything anybody has hung off it stays hung
       * off it, and a second collection beside the first would mean deleting
       * your own shelf to fix it. What the export replaces is the cards, the
       * printings, and what kind of shelf this is: a Moxfield collection
       * imported back when the tab did the fetching becomes the CSV shelf its
       * export makes it, and the id it was fetched by goes with it, there
       * being nothing left to fetch. */
      const col = state.collections.find(c => c.key === pendingCsvKey);
      if (col) {
        col.cards    = cards;
        col.entries  = total;
        col.total    = cards.size;
        col.source   = source;
        col.id       = null;
        col.status   = 'loaded';
        col.error    = null;
        col.savedAt  = new Date().toISOString();
        col.updating = false;
        await saveCollection(col);
      }
      pendingCsvKey = null;
    } else {
      const name = pendingCsvName || fileName.replace(/\.csv$/i, '');
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
    // A file that turned out to be a decklist leaves the shelf untouched, so
    // it leaves the offer standing too: the next file might be the export.
    if (pendingCsvKey) cancelCsvPicker();
    renderCollections();
  }
}

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
/* How a shelf comes back onto the shelf, in two lists and one question.
 *
 * The sources there is somewhere to fetch from, which is Archidekt and nothing
 * else. The rest come back from an export somebody chooses: the CSV ones,
 * whose file only ever existed in the browser, and the Moxfield ones from
 * before api2.moxfield.com began answering 403 to this server, which are
 * fetched by nothing now and created by nothing either. Both exports name
 * their printings, so both are a real way back and not a consolation.
 *
 * Asked as "how does this come back" rather than "is this a Moxfield shelf",
 * so that a shelf whose site this app cannot reach needs no rule of its own,
 * and asked in one place because the ⋯ menu and the offer strip above the
 * table must not disagree about it. A source in neither list is a shelf
 * nothing can re-import: no Refresh in its menu, no offer above the table,
 * both of which would be buttons that do nothing. Nothing writes such a shelf
 * today — the list is what keeps that true if something ever does. */
const COL_FETCH_SOURCES = new Set(['archidekt']);
const COL_FILE_SOURCES  = new Set(['moxfield', 'csv-archidekt', 'csv-moxfield']);

/** How this shelf comes back: 'fetch' — the server has somewhere to fetch it
 *  from, so a press is the whole of it — 'file', from an export somebody
 *  chooses, or null, meaning nothing can. */
function colReimportBy(source) {
  return COL_FETCH_SOURCES.has(source) ? 'fetch'
       : COL_FILE_SOURCES.has(source)  ? 'file'
       : null;
}
const colFromFile = source => colReimportBy(source) === 'file';

function updateCollection(key) {
  const col = state.collections.find(c => c.key === key);
  if (!col || col.updating || state.imports.some(i => i.key === key && i.status === 'running')) return;
  const by = colReimportBy(col.source);
  if (!by) return;
  if (by === 'file') {
    col.updating = true;
    renderCollections();
    openCsvPicker(key);
    return;
  }
  /* A refresh starts over rather than resuming: the point of it is to replace
   * what is on the shelf with what is on Archidekt now, and a resume would
   * merge the two and keep every card since removed. The collection stays
   * readable throughout — it is only overwritten when the import lands. */
  return startImport(col, { restart: true });
}

// ── Shelves that do not know their printings ──────────────────────────────
/* The offer to re-import a collection that has no printings, and the four
 * rules that decide who is shown one.
 *
 * No collection in existence has printings until it is re-imported: the data
 * was never stored, so there is nothing on disk to recover it from. That
 * leaves the Printings column reading "unknown" the whole way down, which is
 * the honest answer and looks exactly like a broken one. This strip is what
 * makes it an answer somebody can do something about, rather than something
 * they have to work out for themselves.
 *
 * It is an offer and not a nag, so it goes away and stays away:
 *
 *   acted on   the moment it is pressed, rather than when the server answers
 *              — the start returns `{ ok: true }` long before the import is
 *              in any list to draw from, and an offer still on screen invites
 *              a second press that starts a second four-minute job
 *   under way   a collection with an import against it already has a readout
 *              and a Stop in the import panel; a stopped one has a Resume.
 *              Two buttons for one job is worse than one
 *   pointless   a shelf nothing can re-import cannot be fixed by any press,
 *              and an empty one has nothing to know. Both exports do carry
 *              their printings, so a shelf that came in as a file is offered
 *              one like any other — what it takes is a file, so its press
 *              opens the picker rather than starting a job
 *   not yours   somebody else's collection is their time to spend and their
 *              data to change. Yours, the group's, or anything at all if you
 *              are an admin or the app cannot say who you are — in which case
 *              it makes no ownership distinction anywhere else either
 */

/* What this strip can re-import is what colReimportBy answers for: a fetched
 * shelf, whose press starts the job, and a shelf that comes back from an
 * export, whose press opens the file picker. One press either way, which is
 * all a strip has. An offer to fix something no press will fix is a loop,
 * which is the one thing that rule exists to prevent. */

/* Offers taken in this page's lifetime, and given back only by a picker closed
 * with nothing chosen — see cancelCsvPicker, where a press that did nothing is
 * undone in full. A re-import that lands with printings takes the offer away on
 * its own; one that lands without them — a source that turns out to say nothing
 * after all — must not put the same offer back up, which is the nag this set
 * exists to prevent. A reload is what re-asks the question, and by then
 * something has changed. */
const _colOffersTaken = new Set();

/** Does this shelf know what any of its cards are? One printing naming a real
 *  card is enough: a shelf half accounted for has been re-imported already,
 *  and doing it again would produce the same unknowns. */
function colKnowsPrintings(col) {
  const cards = col && col.cards;
  // Not a shelf this tab can read is not a shelf to make offers about.
  if (!cards || typeof cards.values !== 'function') return true;
  for (const card of cards.values())
    if ((card.printings || []).some(namesPrinting)) return true;
  return false;
}

/** Is starting a four-minute job against this shelf ours to do?
 *
 *  Asked of myPlayerId() and not of isMyPlayer(), which is the other question
 *  and would be wrong here: it reads the logged-in account's linked player,
 *  and open mode has no logged-in player at all — everybody is `guest`, and
 *  who you are is the name remembered behind Available@'s "Who are you?" bar.
 *  Through isMyPlayer, somebody in open mode would not be offered their own
 *  shelf. Every ownership question on this tab is asked the same way. */
function colMayReimport(col) {
  const me = myPlayerId();
  return !me || currentUser?.role === 'admin' || !col.owner || col.owner === me;
}

/* The shelves being offered a re-import, in the order the tab lists them.
 * Read from the shelf being looked at rather than from every loaded
 * collection: the strip sits above the table and explains what that table is
 * saying, so it must not name a collection whose rows are not in it. */
function colPrintingOffers() {
  return colShelf().filter(col =>
    colReimportBy(col.source)
    && col.cards.size > 0
    && !colKnowsPrintings(col)
    && colMayReimport(col)
    && !_colOffersTaken.has(col.key)
    && !state.imports.some(i => i.key === col.key));
}

/* The strip itself, between the chips and the table. Absent from the flow
 * entirely when every shelf knows what it holds, which is what it becomes for
 * good once these have been re-imported. */
function renderPrintingOffers() {
  const box = document.getElementById('colPrintingOffer');
  if (!box) return;                       // tabs rendered on their own in tests

  const offers = colPrintingOffers();
  if (!offers.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';

  /* The shelves one press can sweep, which is the fetched ones and no others:
   * there is one file picker and one shelf pendingCsvKey can name, so a button
   * that opened four of them is not a thing anybody can answer. The rest keep
   * the press of their own, and the label says which shelves it takes rather
   * than saying "all" over the ones it leaves. */
  const sweep = offers.filter(col => colReimportBy(col.source) === 'fetch');
  const from  = esc([...new Set(sweep.map(col => sourceLabel(col.source)))].join(' and '));
  const filed = offers.length - sweep.length;

  const one  = offers.length === 1;
  const what = one
    ? `<strong>${esc(offers[0].name)}</strong> does not record which printings it holds`
    : `<strong>${offers.length} collections</strong> do not record which printings they hold`;

  /* Said in the terms of the shelves actually being offered: a page with
   * nothing fetchable on it must not promise a job that runs on the server,
   * and one with nothing filed must not mention a file picker nobody will see. */
  const how = [
    sweep.length
      ? `Re-importing from ${from} records them, and runs on the server — so you
         can close this page while it works.`
      : '',
    filed
      ? `${sweep.length ? 'The rest come back from' : 'Re-importing records them from'}
         the export the shelf came from, so pressing one opens the file picker.`
      : '',
  ].filter(Boolean).join(' ');

  box.innerHTML = `
    <div class="print-offer-say">
      ${what} — that is what the Printings column is saying. ${how}
    </div>
    <div class="print-offer-acts">
      ${sweep.length < 2 ? '' : `
        <button class="btn-primary print-offer-btn"
                onclick="reimportAllPrintings()">Re-import all ${sweep.length} from ${from}</button>`}
      ${offers.map(col => `
        <button class="btn-secondary print-offer-btn"
                onclick="reimportPrintings('${jsAttr(col.key)}')">
          Re-import${one ? '' : ` ${esc(col.name)}`}${colFromFile(col.source) ? '…' : ''}
        </button>`).join('')}
    </div>`;
}

/** Take one shelf's offer. */
function reimportPrintings(key) {
  if (!state.collections.some(c => c.key === key)) return;
  _colOffersTaken.add(key);
  renderPrintingOffers();
  return updateCollection(key);
}

/** Take the offers a single press can take, for somebody who owns the lot and
 *  does not want to press a button per shelf. Only the ones actually being
 *  offered — a collection that knows its printings, or that belongs to
 *  somebody else, is not swept up by a button whose label says "all" — and
 *  only the fetched ones: a shelf that comes back from a file needs a file
 *  each, and there is one picker. Those keep their own press, and the label
 *  names the source rather than claiming the lot. */
function reimportAllPrintings() {
  const offers = colPrintingOffers().filter(col => colReimportBy(col.source) === 'fetch');
  for (const col of offers) _colOffersTaken.add(col.key);
  renderPrintingOffers();
  return Promise.all(offers.map(col => updateCollection(col.key)));
}

function removeCollection(key) {
  state.collections = state.collections.filter(c => c.key !== key);
  state.imports     = state.imports.filter(i => i.key !== key);
  renderCollections();
  renderImports();
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
  renderImports();
  /* Which shelves still do not know their printings, which is a question of
     the same three things this function already redraws for: what is loaded,
     whose it is, and what is being imported. */
  renderPrintingOffers();
  const row = document.getElementById('collectionsChips');

  /* An import for a collection that is not on the shelf yet still gets a chip.
   * The chip row is the one progress readout visible at every window width —
   * the import panel lives in the deck column, which is a closed drawer below
   * 1280px, i.e. on the phone this whole feature exists for. */
  const pending = state.imports.filter(i => !state.collections.some(c => c.key === i.key));

  if (!state.collections.length && !pending.length) {
    row.style.display = 'none'; row.innerHTML = ''; return;
  }
  row.style.display = '';

  /* Every loaded collection, including the ones whose cards this tab is not
   * showing. The chip row is the inventory — what is loaded, how big it is,
   * and the ⋯ menu that refreshes, removes and says whose it is — and a
   * collection you cannot see the menu of is one whose owner you cannot fix.
   * A chip that is off the shelf being looked at says so instead. */
  const shown = new Set(colShelf().map(c => c.key));

  // A collection with an import against it is drawn from the import: the
  // shelved copy is last week's, and what the user wants to see is the run
  // that is replacing it. Pending imports have no collection at all yet.
  const impFor = key => state.imports.find(i => i.key === key) || null;

  row.innerHTML = [
    ...state.collections.map(col => chipHtml(col, impFor(col.key), shown.has(col.key))),
    ...pending.map(imp => chipHtml(null, imp, true)),
  ].join('');
}

/* One chip. Either a shelved collection, an import, or a collection with an
 * import running over it — hence both arguments, and either may be null. */
function chipHtml(col, imp, onShelf) {
  const running = imp && imp.status === 'running';
  const stopped = imp && imp.status !== 'running';
  const name    = col ? col.name   : imp.name;
  const key     = col ? col.key    : imp.key;
  const color   = col ? col.color  : imp.color;
  const source  = col ? col.source : imp.source;
  const by      = colReimportBy(source);
  const owner   = colOwner(col || imp);
  const off     = !onShelf;

  // The count is also the progress bar: while pages are coming in it reads
  // "1,240 / 5,600", and the left number climbs on every poll.
  const count = running
    ? (imp.total ? `${imp.entries.toLocaleString()} / ${imp.total.toLocaleString()}` : 'starting…')
    : stopped
      ? (imp.status === 'error' ? 'failed' : 'paused')
      : col.updating ? 'updating…'
        : col.status === 'error' ? 'failed'
          : [...col.cards.values()].reduce((s, c) => s + c.qty, 0).toLocaleString();

  const tip = imp && imp.error ? imp.error
    : running ? `importing — page ${imp.page}${imp.startedBy ? `, started by ${imp.startedBy}` : ''}`
    : stopped ? `import stopped at ${imp.entries.toLocaleString()} cards — resume from the Deck panel`
    : col.status === 'error' ? col.error
    : [sourceLabel(source),
       owner ? `${owner.name}’s` : 'the group’s',
       col.savedAt ? `updated ${relTime(col.savedAt)}` : '',
       off ? 'not on the shelf you are looking at' : ''].filter(Boolean).join(' · ');

  const busy = running || (col && col.updating);
  const bad  = (imp && imp.status === 'error') || (!imp && col && col.status === 'error');
  const cls  = (bad ? ' chip--error' : busy ? ' chip--busy' : '') + (off ? ' chip--off' : '');

  /* A chip for an import with no collection behind it has no owner menu and
   * no Remove — there is nothing on the shelf to own or take off it. Stopping
   * the run is the panel's job, and the tooltip says so. */
  const menu = busy ? ''
    : !col ? kebabMenuHtml([
        { label: 'Resume', onclick: `resumeImport('${key}')` },
        { divider: true },
        { label: 'Discard', onclick: `stopImport('${key}', true)`, danger: true },
      ], { title: 'Import actions' })
    : kebabMenuHtml([
        /* A shelf nothing can fetch is offered its export instead of a Refresh
         * that would only be turned down — the CSV shelves, and the Moxfield
         * ones from before their API began refusing this server. One that
         * neither can be fetched nor read back from a file is offered neither:
         * the menu keeps the owner and the Remove, which still work. */
        ...(by ? [{ label: by === 'file' ? 'Re-import CSV' : 'Refresh',
                    onclick: `updateCollection('${key}')` }] : []),
        ...colOwnerMenuItems(col),
        { divider: true },
        { label: 'Remove', onclick: `removeCollection('${key}')`, danger: true },
      ], { title: 'Collection actions' });

  return `
      <span class="chip${cls}" title="${esc(tip)}">
        <span class="chip-dot" style="background:${color}"></span>
        <span class="chip-label">${esc(name)}</span>
        ${owner ? `<span class="chip-owner">${esc(owner.name)}</span>` : ''}
        <span class="chip-count">${count}</span>
        ${menu}
      </span>`;
}

// ── Build merged + filtered rows ──────────────────────────────────────────
const COL_META_FIELDS = new Set(['cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price']);

const COL_COLUMNS = [
  /* Which printings the shelf holds. On by default, unlike every column
     below it: those are card facts that have to be fetched before they can be
     shown, and this is a fact about the collection itself, already in hand.
     It is the one place the tab answers "which one have I got", so it is on
     until somebody turns it off. */
  { key: 'printings', label: 'Printings',      default: true },
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
  /* The table is `width: max-content` so its columns fit the widest card
     name. A message is prose and not a column, and while it is the only row
     in there it must not set that width — a sentence wider than the window
     scrolled its own text off the right on a phone, which is where the
     shortest sentences are hardest to write. .is-empty puts the table back
     to the width of its container so the message wraps inside it. */
  document.getElementById('resultsTable').classList.add('is-empty');
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
    /* Telling someone to add a collection while the server is part way
       through fetching the one they just added is the wrong answer to the
       question they are actually asking, which is whether it is working. */
    const running = state.imports.find(i => i.status === 'running');
    if (running) {
      colSayInstead(running.total
        ? `Importing ${running.name} — ${running.entries.toLocaleString()} of ${running.total.toLocaleString()} cards so far. This runs on the server, so you can close the page.`
        : `Importing ${running.name}…`);
      return;
    }
    const stopped = state.imports[0];
    if (stopped) {
      colSayInstead(stopped.status === 'error'
        ? `Importing ${stopped.name} failed: ${stopped.error || 'unknown error'}`
        : `Importing ${stopped.name} stopped at ${stopped.entries.toLocaleString()} cards — resume it from the Deck panel.`);
      return;
    }
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
  // Real rows: the columns size themselves again. See colSayInstead.
  document.getElementById('resultsTable').classList.remove('is-empty');

  /* No stale field to reset: the chain is read against this tab's field list,
     so a criterion naming a column that is no longer on the table is dropped
     before it gets here — see colSortNow and getSortChain. */
  const cols = getCols('collections', COL_COLUMNS);

  // ── Header ──
  let h = '<th data-sort="name">Card Name</th>';
  /* No `data-sort`, and deliberately: "which printings" is not an order, and
     a header handing the sort control a field its list has never heard of is
     a table sorted on nothing. The gesture is skipped below rather than
     wired to a field that does not exist. */
  if (cols.printings) h += '<th class="th-print">Printings</th>';
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
    // A column that is not a sort says nothing about sorting and does nothing
    // when clicked. See the Printings header above.
    if (!field) return;
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
    if (cols.printings) metaCells += colPrintingsCell(r.name);
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

// ── Which printings the shelf holds ───────────────────────────────────────
/* The Printings column, and the one thing it must never say.
 *
 * No collection has printings until it is re-imported, so today every card on
 * every shelf reads *unknown* — and unknown is the whole point of the column
 * arriving before the data does. A blank cell, or a dash, would read as a
 * shelf holding none of the card, which is the app telling somebody their
 * collection has been wiped. So the copies nobody can attribute are named as
 * such, and they are counted.
 *
 * A row is a card across the whole shelf, exactly as the Total column beside
 * it is, so the copies are added up across every collection being shown.
 * Grouped by what the cell actually shows — the set and the finish — because
 * two entries that read the same are one line, and the collector number, the
 * set's full name and the finish go in the tooltip where the detail belongs.
 * Language and condition are in a printing's identity but not on this row:
 * both are one constant code in the data available today, so a column showing
 * them would be a column of the same word. */
function colPrintingLabel(printing) {
  const set = (printing.set || '').toUpperCase();
  return (set || '?') + (printing.finish === 'foil' ? ' ✦' : '');
}

/* A set code and a finish are not a printing: one set can hold the ordinary
   Sol Ring and its extended-art twin, and both read `C21` here. So the
   tooltip names every collector number in the group rather than the first
   one's — a line claiming #263 over a copy that is #514 is worse than a line
   that names neither. */
function colPrintingTitle(group) {
  const bits = [group.setName || 'Unknown set'];
  if (group.numbers.size) bits.push([...group.numbers].map(n => `#${n}`).join(', '));
  if (group.foil) bits.push('foil');
  return bits.join(' ');
}

/** The shelf's copies of one card, grouped as the cell shows them: the
 *  unknown entry last, and the rest heaviest first. */
function colPrintingsOf(name) {
  const groups = new Map();
  for (const col of colShelf()) {
    const card = col.cards.get(name);
    if (!card) continue;
    for (const printing of cardPrintings(card)) {
      const label = namesPrinting(printing) ? colPrintingLabel(printing) : null;
      let group = groups.get(label);
      if (!group) {
        group = { label, qty: 0, numbers: new Set(),
                  setName: printing.set_name || printing.set || '',
                  foil: printing.finish === 'foil' };
        groups.set(label, group);
      }
      group.qty += printing.qty;
      if (printing.collector_number) group.numbers.add(printing.collector_number);
    }
  }
  return [...groups.values()].sort((a, b) =>
    (a.label === null) - (b.label === null) ||
    b.qty - a.qty ||
    String(a.label).localeCompare(String(b.label)));
}

function colPrintingsCell(name) {
  const groups = colPrintingsOf(name);
  if (!groups.length) return '<td class="td-print">—</td>';
  /* A shelf that knows nothing about a card says one word rather than "3×
     unknown": the count is the Total column's job, and this cell is answering
     which ones, not how many. Where only *some* of the copies are accounted
     for the count comes back, because there the number is the news. */
  if (groups.length === 1 && groups[0].label === null)
    return '<td class="td-print"><span class="print-unknown" title="Nobody recorded which printings these copies are">unknown</span></td>';
  const parts = groups.map(g => g.label === null
    ? `<span class="print-unknown">${g.qty}× unknown</span>`
    : `<span title="${esc(colPrintingTitle(g))}">${g.qty}× ${esc(g.label)}</span>`);
  return `<td class="td-print">${parts.join(', ')}</td>`;
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
    /* This tab knows cards by name, so the other side comes from the cache
       ensureScryfallImages() fills beside the picture — the same answer
       js/scryfall.js gave when the card came back, kept rather than asked
       again. Nothing for a one-sided card, which is what leaves it without a
       turn control. */
    back:  scryfallFacesCache.get(row.name)?.[1] || '',
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

  /* Drawn and then put down: cardPilesHtml() hands back the piles and
     layOutPiles() decides where each one goes, so that a pile starts where the
     pile above it ended instead of in a row beginning under the tallest one.
     Both halves run on every paint, including the second one below — the piles
     are new elements, and where they went is not something new elements
     know. */
  const draw = () => {
    host.innerHTML = cardPilesHtml(groups, { settled: _colSettledPiles, cardOf: _colStackCard });
    layOutPiles(host.querySelector('.card-piles'));
  };
  draw();

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
    if (document.getElementById('pileView').style.display !== 'none') draw();
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

      const link = `<a class="grid-img-link card-open" href="${href}" target="_blank" rel="noopener" data-name="${esc(r.name)}">${imgHtml}</a>`;
      return `<div class="grid-card">
        ${cardTurnableHtml(link, scryfallFacesCache.get(r.name)?.[1])}
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
