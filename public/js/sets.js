// ── Set Browser ───────────────────────────────────────────────────────────
// Two shapes of one tab (§9.3). Without a set chosen it is a picker: a grid
// of tiles, one per set, each saying how much of that set is owned. Choosing
// one swaps the tiles for its cards and the filter box for a chip naming the
// set, and the controls that act on cards appear beside it.
//
// The set list and the owned counts both come from /api/sets in one request.
// The browser cannot work the counts out for itself — a collection is card
// names, with nothing to say which set they came from — so the server keeps
// an index of what is in each set (set-index.js).

let sfSets      = null;   // [{ code, name, released, cards, owned, indexed }]
let setIndexing = null;   // { sets, indexed, filling } — the index's own progress
let currentSet  = null;   // { code, name }
let setCardsAll = [];
let setFilter   = 'all';  // 'all' | 'owned' | 'unowned'
let setView     = 'list'; // 'list' | 'grid' | 'pile'
const setSettled = new Set(); // the labels of the piles settled in the stack view; the rest are spread

const SET_PICKER_LIMIT = 120;   // tiles rendered at once; the filter reaches the rest

let _setSizeSync = null;
async function initSetBrowser() {
  mountViewToggle('setViewMount', ['list', 'grid', 'pile'], () => setView, setSetView);
  /* #setCards rather than the grid inside it, which renderSetCards replaces
     whenever the set, the filter or the view changes. */
  _setSizeSync = mountSizeControl('setSizeMount', 'sets', 'setCards', () => setView);
  const filterSel = document.getElementById('setFilterSel');
  if (filterSel) filterSel.value = setFilter;
  initSetSort();
  await loadSets();
  scheduleIndexRefresh();
}

/* The tiles are cheap to re-fetch and the owned counts move under us in two
 * ways — a collection finishing its import, and the server's index filling in
 * a set it had not reached — so the list is re-read on every visit to the tab
 * rather than cached for the session. */
async function loadSets() {
  try {
    const res = await fetch('/api/sets');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    sfSets      = json.sets || [];
    setIndexing = json.index || null;
  } catch (e) {
    document.getElementById('setPicker').innerHTML =
      `<div class="empty-state">Failed to load sets: ${esc(e.message)}</div>`;
    return;
  }
  renderSetPicker();
}

/* While the server is still indexing, tiles keep appearing behind the user's
 * back — so the list refreshes itself, but only while this tab is the one on
 * screen and only until the index is complete. */
let _indexPoll = null;
function scheduleIndexRefresh() {
  clearTimeout(_indexPoll);
  if (!setIndexing || setIndexing.indexed >= setIndexing.sets) return;
  _indexPoll = setTimeout(async () => {
    const visible = document.getElementById('tab-sets').style.display !== 'none';
    if (visible && !currentSet) await loadSets();
    scheduleIndexRefresh();
  }, 15_000);
}

function filterSets() { renderSetPicker(); }

function setSetFilter(f) {
  setFilter = f;
  renderSetCards();
}

function setSetView(v) {
  setView = v;
  /* The spread piles are kept: coming back to the table finds it the way it
     was left, rather than swept flat by having looked at the list. */
  renderSetCards();
  _setSizeSync?.();   // each view remembers its own card size
}

const SET_SORT_FIELDS = ['number', 'name', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'];
function initSetSort() {
  mountSortControl('setSortMount', 'sets', SET_SORT_FIELDS, renderSetCards, { field: 'number', dir: 1 });
}

function setMode(mode) {
  document.getElementById('tab-sets').dataset.setMode = mode;
}

// ── The picker ────────────────────────────────────────────────────────────
function renderSetPicker() {
  const host = document.getElementById('setPicker');
  if (!sfSets) return;
  const q     = (document.getElementById('setSearchInput')?.value || '').trim().toLowerCase();
  const found = q
    ? sfSets.filter(s => s.name.toLowerCase().includes(q) || s.code.includes(q))
    : sfSets;
  const shown = found.slice(0, SET_PICKER_LIMIT);

  if (!currentSet) setPickerInfo(found.length, shown.length);

  host.innerHTML = shown.length
    ? `<div class="set-grid">${shown.map(setTileHtml).join('')}</div>`
    : `<div class="empty-state">No set matches “${esc(q)}”.</div>`;
}

/* The count doubles as the index's progress report: a tile with no owned
 * figure is not broken, it is a set the server has not read yet, and this is
 * the one place that says so. */
function setPickerInfo(found, shown) {
  const parts = [`${shown.toLocaleString()} of ${found.toLocaleString()} sets`];
  if (setIndexing && setIndexing.indexed < setIndexing.sets) {
    parts.push(`indexing ${setIndexing.indexed.toLocaleString()} of ${setIndexing.sets.toLocaleString()}`);
  }
  document.getElementById('setInfo').textContent = parts.join(' · ');
}

function setTileHtml(s) {
  const year  = (s.released || '').slice(0, 4);
  const owned = s.indexed
    ? `<span class="set-tile-owned"><strong>${s.owned.toLocaleString()}</strong> / ${s.cards.toLocaleString()} owned</span>`
    : `<span class="set-tile-owned set-tile-pending">${s.cards.toLocaleString()} cards</span>`;
  return `<button class="set-tile" onclick="selectSet('${jsAttr(s.code)}')" title="${esc(s.name)}">
    <span class="set-tile-hdr">
      <span class="set-tile-code">${esc(s.code.toUpperCase())}</span>
      <span class="set-tile-year">${year}</span>
    </span>
    <span class="set-tile-name">${esc(s.name)}</span>
    ${owned}
  </button>`;
}

// ── One set's cards ───────────────────────────────────────────────────────
let _setLoadSeq = 0; // guards against interleaved loads when sets are clicked rapidly

async function selectSet(code) {
  const seq   = ++_setLoadSeq;
  const name  = sfSets?.find(s => s.code === code)?.name || code;
  currentSet  = { code, name };
  setCardsAll = [];
  setMode('cards');
  renderSetChip();

  const cardsEl = document.getElementById('setCards');
  document.getElementById('setInfo').textContent = '';
  cardsEl.innerHTML = `<div class="empty-state">Loading ${esc(name)}…</div>`;

  let url = `https://api.scryfall.com/cards/search?q=set:${code}&order=collector_number&unique=cards`;
  while (url) {
    try {
      const res  = await scryfallFetch(url);
      if (seq !== _setLoadSeq) return; // a newer set was selected — abandon this load
      if (!res.ok) { cardsEl.innerHTML = '<div class="empty-state">No cards found for this set.</div>'; return; }
      const data = await res.json();
      if (seq !== _setLoadSeq) return;
      setCardsAll.push(...(data.data || []));
      for (const c of (data.data || [])) {
        if (!scryfallMetaCache.has(c.name)) scryfallMetaCache.set(c.name, cardMetaOf(c));
      }
      url = data.has_more ? data.next_page : null;
      cardsEl.innerHTML = `<div class="empty-state">Loading… ${setCardsAll.length} cards</div>`;
    } catch (e) {
      if (seq === _setLoadSeq) cardsEl.innerHTML = `<div class="empty-state">Error: ${esc(e.message)}</div>`;
      return;
    }
  }
  renderSetCards();
}

/* Back to the picker. The loaded cards are dropped along with the selection —
 * a set is one fetch away and the proxy has just cached its pages. */
function clearSet() {
  _setLoadSeq++;
  currentSet  = null;
  setCardsAll = [];
  setMode('picker');
  document.getElementById('setCards').innerHTML = '';
  document.getElementById('setChipRow').innerHTML = '';
  renderSetPicker();
  scheduleIndexRefresh();
}

function renderSetChip() {
  document.getElementById('setChipRow').innerHTML = currentSet ? `
    <span class="chip">
      <span class="chip-code">${esc(currentSet.code.toUpperCase())}</span>
      <span class="chip-label">${esc(currentSet.name)}</span>
      <button class="chip-close" onclick="clearSet()" title="Back to all sets">✕</button>
    </span>` : '';
}

function renderSetCards() {
  const cardsEl = document.getElementById('setCards');
  if (!setCardsAll.length) return;

  const isOwned  = c => state.collections.some(col => col.status === 'loaded' && col.cards.has(c.name));
  const ownedCount = setCardsAll.filter(isOwned).length;

  let displayed = setFilter === 'owned'   ? setCardsAll.filter(isOwned)
                : setFilter === 'unowned' ? setCardsAll.filter(c => !isOwned(c))
                : setCardsAll.slice();

  /* The whole sentence orders the cards; its first word cuts the piles. */
  const { criteria } = getSortChain('sets', { field: 'number', dir: 1 }, SET_SORT_FIELDS);
  const field = criteria[0]?.field || 'name';
  displayed = displayed.slice().sort(cardComparator(criteria));

  // §9.3: the "N of M owned" figure is the toolbar's result count. What the
  // ownership filter is currently hiding is said here too, since the grid
  // below can no longer be counted by eye.
  document.getElementById('setInfo').textContent =
    `${ownedCount.toLocaleString()} of ${setCardsAll.length.toLocaleString()} owned` +
    (displayed.length !== setCardsAll.length ? ` · showing ${displayed.length.toLocaleString()}` : '');

  if (!displayed.length) {
    const msg = setFilter === 'owned'   ? 'No cards from this set are in any collection.'
              : setFilter === 'unowned' ? 'Every card in this set is owned — nice!'
              : 'No cards found.';
    cardsEl.innerHTML = `<div class="empty-state">${msg}</div>`;
    return;
  }

  if (setView === 'grid') {
    cardsEl.innerHTML = `<div class="sf-grid">${displayed.map(renderSetCardGrid).join('')}</div>`;
  } else if (setView === 'pile') {
    cardsEl.innerHTML = renderSetPiles(displayed, field);
  } else {
    cardsEl.innerHTML = `<div class="sf-results">${displayed.map(renderSetCardList).join('')}</div>`;
  }
}

// ── Stack view ────────────────────────────────────────────────────────────
// A set as piles on a table, grouped by whatever the sort control is set to:
// by rarity it is the four heights a booster is made of, by mana value it is
// the set's curve, by collector number it is the set in hundreds. There is no
// second control and nothing new stored — the sort field is the grouping, so
// changing the sort restacks the table.
//
// js/sortui.js cuts the piles and js/cardstack.js draws them. What is here is
// what a Scryfall card is to this tab: its picture and its collector number,
// the set's own name for it.
function _setStackCard(card) {
  const face = card.card_faces?.[0];
  return {
    name:  card.name,
    img:   card.image_uris?.normal || face?.image_uris?.normal || '',
    badge: card.collector_number ? `#${card.collector_number}` : '',
    href:  `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22`,
  };
}

function renderSetPiles(displayed, field) {
  const groups = cardGroups(field, displayed);
  forgetGonePiles(setSettled, groups);
  return cardPilesHtml(groups, { settled: setSettled, cardOf: _setStackCard });
}

/* The header spreads a pile and settles it; the stack under it spreads it —
 * the Collections stack view's listener, for this tab's piles and for the
 * same reasons. */
document.addEventListener('click', e => {
  if (setView !== 'pile' || !currentSet) return;
  if (document.getElementById('tab-sets')?.style.display === 'none') return;
  const pile = e.target.closest('#setCards .card-pile');
  if (!pile) return;
  const label = pile.dataset.pile;
  if (e.target.closest('.card-pile-hdr')) togglePile(setSettled, label);
  else if (setSettled.has(label)) setSettled.delete(label);
  else return;
  renderSetCards();
});

function renderSetCardList(card) {
  const face   = card.card_faces?.[0];
  const imgUrl = card.image_uris?.small || face?.image_uris?.small || '';
  const mana   = card.mana_cost         || face?.mana_cost         || '';
  const href   = `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22`;
  const owned  = sfCardOwnership(card.name);
  const price  = renderPrice(card);
  return `<div class="sf-card">
    <a href="${card.scryfall_uri}" target="_blank" rel="noopener" class="sf-thumb card-open" data-name="${esc(card.name)}">
      ${imgUrl ? `<img class="card-img" src="${imgUrl}" loading="lazy" alt="${esc(card.name)}">` : '<div class="sf-thumb-ph"></div>'}
    </a>
    <div class="sf-body">
      <div class="sf-name-row">
        <a class="sf-card-name card-link" href="${href}" target="_blank" rel="noopener" data-name="${esc(card.name)}">${esc(card.name)}</a>
        ${mana ? `<span class="sf-mana">${renderMana(mana)}</span>` : ''}
        <span class="sf-collector">#${card.collector_number || '?'}</span>
        ${price}
        ${wantBtnHtml(card.name)}
      </div>
      <div class="sf-type">${esc(card.type_line || '')}</div>
      <div class="sf-ownership">${owned || '<span class="sf-not-owned">Not in any collection</span>'}</div>
    </div>
  </div>`;
}

function renderSetCardGrid(card) {
  const face   = card.card_faces?.[0];
  const imgUrl = card.image_uris?.normal || face?.image_uris?.normal || '';
  const href   = `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22`;
  const owned  = sfCardOwnership(card.name);
  const price  = renderPrice(card);
  return `<div class="sf-card-lg">
    <a href="${card.scryfall_uri}" target="_blank" rel="noopener" class="card-open" data-name="${esc(card.name)}">
      ${imgUrl
        ? `<img class="sf-card-lg-img card-img" src="${imgUrl}" loading="lazy" alt="${esc(card.name)}">`
        : `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
    </a>
    <div class="sf-card-lg-footer">
      <div style="display:flex;align-items:center;gap:var(--space-1);margin-bottom:var(--space-1)">
        <a class="sf-card-lg-name card-link" href="${href}" target="_blank" rel="noopener"
           data-name="${esc(card.name)}" title="${esc(card.name)}" style="margin-bottom:0;flex:1">${esc(card.name)}</a>
        ${price}
        ${wantBtnHtml(card.name)}
      </div>
      <div class="sf-card-lg-badges">${owned || '<span class="sf-not-owned">—</span>'}</div>
    </div>
  </div>`;
}
