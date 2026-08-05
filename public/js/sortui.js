// ── Shared sorting + column-visibility helpers (used by every card view) ─────

// Available sort fields. Views pass the subset they support.
const SORT_FIELDS = [
  { key: 'name',      label: 'Name' },
  { key: 'cmc',       label: 'Mana Value' },
  { key: 'color',     label: 'Color' },
  { key: 'power',     label: 'Power' },
  { key: 'toughness', label: 'Toughness' },
  { key: 'rarity',    label: 'Rarity' },
  { key: 'type',      label: 'Type' },
  { key: 'price',     label: 'Price' },
  { key: 'qty',       label: 'Quantity' },
  { key: 'number',    label: 'Set Number' },
  { key: 'wanted',    label: 'Most Wanted' },
  { key: 'player',   label: 'Player' },
];
const SORT_LABELS = Object.fromEntries(SORT_FIELDS.map(f => [f.key, f.label]));

// Color ordering: mono W<U<B<R<G, then multicolour grouped by colour-count and
// WUBRG combination (so WU, WB … cluster correctly), then colourless last.
const WUBRG_INDEX = { W: 0, U: 1, B: 2, R: 3, G: 4 };
function colorRank(arr) {
  if (!arr || !arr.length) return 9e9;        // colourless → last
  const idxs = arr.map(c => WUBRG_INDEX[c]).filter(v => v !== undefined).sort((a, b) => a - b);
  if (!idxs.length) return 9e9;
  // Base-6 combination key keeps WU before WB before UB, etc.
  let combo = 0;
  for (const i of idxs) combo = combo * 6 + (i + 1);
  // Primary key = colour count, so all mono sort before all 2-colour, etc.
  return idxs.length * 1e6 + combo;
}

const RARITY_RANK = { common: 1, uncommon: 2, rare: 3, mythic: 4, special: 5, bonus: 6 };
function rarityRank(r) { return RARITY_RANK[(r || '').toLowerCase()] ?? 0; }

// Sort by the dominant card type, in a sensible gameplay order
function typeRank(t) {
  t = (t || '').toLowerCase();
  const order = ['creature', 'planeswalker', 'battle', 'instant', 'sorcery',
                 'artifact', 'enchantment', 'land'];
  for (let i = 0; i < order.length; i++) if (t.includes(order[i])) return `${i}${t}`;
  return `9${t}`;
}

function numOr(v, dflt) { const n = parseFloat(v); return isNaN(n) ? dflt : n; }

// Normalise either a full Scryfall card object or a name-keyed row into meta
function cardMetaOf(obj) {
  if (obj.type_line !== undefined || obj.cmc !== undefined) {
    const face = obj.card_faces?.[0];
    return {
      cmc:       obj.cmc,
      colors:    obj.colors || face?.colors || [],
      ci:        obj.color_identity || [],
      power:     obj.power ?? face?.power,
      toughness: obj.toughness ?? face?.toughness,
      type:      obj.type_line || face?.type_line || '',
      rarity:    obj.rarity || '',
      eur:       obj.prices?.eur ? parseFloat(obj.prices.eur) : null,
    };
  }
  return scryfallMetaCache.get(obj.name) || {};
}

function sortKey(field, obj) {
  const m = cardMetaOf(obj);
  switch (field) {
    case 'name':      return (obj.name || '').toLowerCase();
    case 'cmc':       return numOr(m.cmc, -1);
    case 'color':     return colorRank((m.ci && m.ci.length) ? m.ci : m.colors);
    case 'power':     return numOr(m.power, -1);
    case 'toughness': return numOr(m.toughness, -1);
    case 'rarity':    return rarityRank(m.rarity);
    case 'type':      return typeRank(m.type);
    case 'price':     return numOr(m.eur, -1);
    case 'qty':       return obj._sortQty ?? 0;
    case 'number':    return numOr(obj.collector_number, 0);
    default:          return (obj.name || '').toLowerCase();
  }
}

// dir: 1 = ascending, -1 = descending. Always tiebreaks by name.
function cardComparator(field, dir) {
  return (a, b) => {
    const av = sortKey(field, a), bv = sortKey(field, b);
    if (av < bv) return -dir;
    if (av > bv) return  dir;
    const an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  };
}

// ── Per-view persisted sort state ───────────────────────────────────────────
const _sortState = JSON.parse(localStorage.getItem('mtgtools_sort') || '{}');
function getSort(view, def) { return _sortState[view] || def || { field: 'name', dir: 1 }; }
function saveSort(view, field, dir) {
  _sortState[view] = { field, dir };
  localStorage.setItem('mtgtools_sort', JSON.stringify(_sortState));
}

// Build + wire a Sort control into `containerId`. `apply` re-renders the view.
function mountSortControl(containerId, view, fieldKeys, apply, def) {
  const host = document.getElementById(containerId);
  if (!host) return;
  const cur = getSort(view, def);
  if (!fieldKeys.includes(cur.field)) cur.field = fieldKeys[0];
  const opts = fieldKeys.map(k =>
    `<option value="${k}"${k === cur.field ? ' selected' : ''}>${SORT_LABELS[k]}</option>`).join('');
  host.innerHTML = `
    <div class="sort-control">
      <span class="sort-control-lbl">Sort</span>
      <select class="sort-select">${opts}</select>
      <button class="sort-dir-btn" title="Toggle ascending / descending">${cur.dir === 1 ? '↑' : '↓'}</button>
    </div>`;
  const sel = host.querySelector('.sort-select');
  const btn = host.querySelector('.sort-dir-btn');
  sel.addEventListener('change', () => { saveSort(view, sel.value, getSort(view).dir); apply(); });
  btn.addEventListener('click', () => {
    const d = getSort(view).dir * -1;
    saveSort(view, sel.value, d);
    btn.textContent = d === 1 ? '↑' : '↓';
    apply();
  });
}

// ── Per-view persisted column visibility ────────────────────────────────────
const _colState = JSON.parse(localStorage.getItem('mtgtools_cols') || '{}');
// colDefs: [{key,label,default}]. Returns {key:bool}
function getCols(view, colDefs) {
  const saved = _colState[view] || {};
  const out = {};
  colDefs.forEach(c => { out[c.key] = (c.key in saved) ? saved[c.key] : (c.default !== false); });
  return out;
}
function toggleCol(view, key, colDefs) {
  const cur = getCols(view, colDefs);
  cur[key] = !cur[key];
  _colState[view] = cur;
  localStorage.setItem('mtgtools_cols', JSON.stringify(_colState));
}

// Build + wire a "Columns ▾" menu into `containerId`. `apply` re-renders.
function mountColumnMenu(containerId, view, colDefs, apply) {
  const host = document.getElementById(containerId);
  if (!host) return;
  const cur = getCols(view, colDefs);
  const items = colDefs.map(c => `
    <label class="col-menu-item">
      <input type="checkbox" data-col="${c.key}"${cur[c.key] ? ' checked' : ''}>
      <span>${c.label}</span>
    </label>`).join('');
  host.innerHTML = `
    <div class="col-menu-wrap">
      <button class="col-menu-btn" title="Show / hide columns">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        Columns
      </button>
      <div class="col-menu">${items}</div>
    </div>`;
  const btn  = host.querySelector('.col-menu-btn');
  const menu = host.querySelector('.col-menu');
  btn.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
  menu.addEventListener('click', e => e.stopPropagation());
  menu.querySelectorAll('input[data-col]').forEach(cb => {
    cb.addEventListener('change', () => { toggleCol(view, cb.dataset.col, colDefs); apply(); });
  });
  document.addEventListener('click', () => menu.classList.remove('open'));
}

// ── Per-view persisted card size ────────────────────────────────────────────
// How big card artwork is drawn, on the tabs that draw it. A collection of
// twelve thousand cards is scanned at 80px and a single card is looked at
// properly at 300px, and which of those you want is a question about the tab
// you are on and the view you are in — not about the app — so it is stored the
// way the sort field and the visible columns already are.
//
// The Deck Builder built this control first, with its own slider, its own
// `dbScale` key and its own variable. It is this component now; the tab is a
// caller like the three browsing tabs, and `--card-width` is one variable the
// grids, the piles and the stacks all read.

/* The range, shared by every caller so that the control means the same thing
 * on every tab. 80 is a thumbnail you can scan a set at; 300 is a card you can
 * read the rules text off. */
const CARD_SIZE_MIN  = 80;
const CARD_SIZE_MAX  = 300;
const CARD_SIZE_STEP = 10;

/* Where a view starts before anyone has chosen — the widths the stylesheet
 * already draws each view at, said here as well because the slider needs a
 * position on its first render. */
const CARD_SIZE_DEFAULTS = { grid: 150, pile: 150 };

const _sizeState = JSON.parse(localStorage.getItem('mtgtools_size') || '{}');

/* The XL view is gone — the slider is what "how big?" is asked with now — so
 * the sizes stored against it are for a view nobody can reach. Dropped rather
 * than folded into the grid's: a size chosen for a grid is the size that
 * person wants their grid at, and inheriting a 300px XL over it would be this
 * change deciding that for them. */
const _staleXlSizes = Object.keys(_sizeState).filter(key => key.endsWith(':xl'));
if (_staleXlSizes.length) {
  for (const key of _staleXlSizes) delete _sizeState[key];
  localStorage.setItem('mtgtools_size', JSON.stringify(_sizeState));
}

function cardSizeDefault(mode) { return CARD_SIZE_DEFAULTS[mode] || CARD_SIZE_DEFAULTS.grid; }

/* A stored size is a number of pixels within the range, whatever arrives.
 * localStorage is a string store shared with older versions of this app and
 * with whatever a person types into a console, and a grid told to lay itself
 * out at NaN or at 4000 is a broken tab rather than a wrong preference. */
function clampCardSize(px, mode) {
  const n = Math.round(Number(px));
  if (!Number.isFinite(n)) return cardSizeDefault(mode);
  return Math.min(CARD_SIZE_MAX, Math.max(CARD_SIZE_MIN, n));
}

/* Per tab *and* per view: `deckbuild:grid` is a different setting from
 * `deckbuild:pile`, which is a different setting from `sets:grid`. One key
 * per pair, in one object, in one localStorage entry — the shape the sort and
 * column preferences already use. */
function getCardSize(view, mode) {
  const saved = _sizeState[`${view}:${mode}`];
  return saved === undefined ? cardSizeDefault(mode) : clampCardSize(saved, mode);
}
function saveCardSize(view, mode, px) {
  _sizeState[`${view}:${mode}`] = clampCardSize(px, mode);
  localStorage.setItem('mtgtools_size', JSON.stringify(_sizeState));
}

/* Build + wire a Size control into `containerId`.
 *
 *   view      the tab, as the sort and column preferences name it
 *   targetId  the element the chosen width is set on. It is inherited, so
 *             this is the container the cards are rendered into rather than
 *             each grid — the grids are replaced on every render and an
 *             inline style on one of them would go with it.
 *   getMode   the tab's current view mode.
 *
 * Returns a sync() the tab calls when its view mode changes: the control
 * belongs to the image views, and each of them remembers its own size.
 */
function mountSizeControl(containerId, view, targetId, getMode) {
  const host = document.getElementById(containerId);
  if (!host) return () => {};
  host.innerHTML = `
    <div class="size-control">
      <span class="size-control-lbl">Size</span>
      <input type="range" class="size-slider" aria-label="Card size" title="How big card artwork is drawn"
             min="${CARD_SIZE_MIN}" max="${CARD_SIZE_MAX}" step="${CARD_SIZE_STEP}">
    </div>`;
  const slider = host.querySelector('.size-slider');

  const apply = px => document.getElementById(targetId)?.style.setProperty('--card-width', px + 'px');

  const sync = () => {
    /* Artwork is what this sizes, so the list view — which has none — does not
     * carry it. Hidden rather than disabled: a control that cannot do anything
     * is furniture, and the strip is measured on how little of it there is.
     *
     * The whole mount goes, not the control inside it: an emptied host is
     * still an item in the strip's flex row and would leave a gap where the
     * slider was. It is a class rather than an inline style because two tabs
     * hide this mount for a reason of their own — no deck loaded, no set
     * chosen — and an inline display would overrule them. */
    const mode = getMode();
    host.classList.toggle('size-mount-hidden', mode === 'list');
    if (mode === 'list') return;
    const px = getCardSize(view, mode);
    slider.value = px;
    apply(px);
  };

  slider.addEventListener('input', () => {
    const mode = getMode();
    saveCardSize(view, mode, slider.value);
    apply(getCardSize(view, mode));
  });

  sync();
  return sync;
}

// ── Shared card-name autocomplete ───────────────────────────────────────────
// The Want List had the only "type a card name" field in the app, with its
// debounce, its dropdown and its outside-click listener written into wants.js.
// The playmat picker is the second, and two copies of that is how they drift
// apart — so the component moved here, beside the other mount* helpers, and
// the Want List is now one of its callers rather than its owner.
//
// The markup is the caller's: an .autocomplete-wrap holding the input and an
// empty .ac-dropdown, which is what the existing styles expect. Returns a
// handle so a caller can close the dropdown from elsewhere (the Want List
// closes it when a card is added by pressing Enter).
function mountCardAutocomplete(inputId, dropId, onPick, opts = {}) {
  const input = document.getElementById(inputId);
  const drop  = document.getElementById(dropId);
  if (!input || !drop) return null;
  const { minChars = 2, delay = 280, limit = 8, commander = false } = opts;

  let timer = null;
  const close = () => { drop.style.display = 'none'; };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < minChars) { close(); return; }
    timer = setTimeout(async () => {
      try {
        const names = (await cardAutocomplete(q, { commander })).slice(0, limit);
        // The field may have moved on while the request was in flight — two
        // more keystrokes and a slower answer would otherwise overwrite the
        // newer suggestions with older ones.
        if (input.value.trim() !== q) return;
        if (!names.length) { close(); return; }
        // Elements rather than a string of HTML: a card name with an
        // apostrophe then needs no escaping to survive being put in an
        // onclick, which is the only reason the old version reached for
        // jsAttr() — and Urza's Saga is not an edge case here.
        drop.innerHTML = '';
        for (const name of names) {
          const item = document.createElement('div');
          item.className   = 'ac-item';
          item.textContent = name;
          item.addEventListener('click', () => { close(); onPick(name); });
          drop.appendChild(item);
        }
        drop.style.display = 'block';
      } catch { close(); }
    }, delay);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete-wrap')) close();
  });

  return { close };
}

// ── Shared view toggle (List / Grid / Pile) ─────────────────────────────────
// One component for every tab's view switcher, so the same icons appear in the
// same order everywhere. `getCur` returns the current mode; `pick` sets it
// (and triggers the tab's own re-render).
//
// There was an XL view here too — a second grid, drawn at 220px instead of
// 148px. The card-size control is that question asked properly: XL was one
// answer to "how big?" nailed to a button, and a slider that goes from 80 to
// 300 says every answer it had and the ones in between. So XL is gone, and
// what it drew is what Grid draws now.
const _VT_ICONS = {
  list: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  grid: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  pile: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="4" y="2" width="16" height="6" rx="1"/><rect x="4" y="9" width="16" height="6" rx="1"/><rect x="4" y="16" width="16" height="6" rx="1"/></svg>',
};
const _VT_TITLES = { list: 'List view', grid: 'Grid view', pile: 'Pile view' };

function mountViewToggle(containerId, modes, getCur, pick) {
  const host = document.getElementById(containerId);
  if (!host) return;
  host.innerHTML = `<div class="view-toggle">${modes.map(m =>
    `<button class="view-btn${getCur() === m ? ' active' : ''}" data-mode="${m}" title="${_VT_TITLES[m]}">${_VT_ICONS[m]}</button>`
  ).join('')}</div>`;
  const sync = () => host.querySelectorAll('.view-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === getCur()));
  host.querySelectorAll('.view-btn').forEach(b =>
    b.addEventListener('click', () => { pick(b.dataset.mode); sync(); }));
  return sync;
}

// ── Shared "⋯" overflow / kebab menu ────────────────────────────────────────
// Returns an HTML snippet (safe inside template-literal renders). Items:
//   { label, onclick, danger }  — action row; onclick is an inline-JS string
//   { section }                 — small section label
//   { divider: true }           — horizontal rule
// Menus escape overflow:hidden containers (deck tiles) by being positioned
// fixed relative to the button when opened.
function kebabMenuHtml(items, opts = {}) {
  const inner = items.map(it => {
    if (it.divider) return '<div class="db-more-divider"></div>';
    if (it.section) return `<div class="db-more-section-label">${it.section}</div>`;
    return `<button class="col-menu-item${it.danger ? ' db-menu-danger' : ''}"
      onclick="event.stopPropagation();closeAllKebabs();${it.onclick}">${it.label}</button>`;
  }).join('');
  return `<div class="col-menu-wrap kebab-wrap">
    <button class="kebab-btn${opts.btnClass ? ' ' + opts.btnClass : ''}" title="${opts.title || 'More actions'}"
      onclick="toggleKebab(event)">⋯</button>
    <div class="col-menu">${inner}</div>
  </div>`;
}

function toggleKebab(e) {
  e.stopPropagation();
  const btn  = e.currentTarget;
  const menu = btn.nextElementSibling;
  if (!menu) return;
  const wasOpen = menu.classList.contains('open');
  closeAllKebabs();
  if (wasOpen) return;
  menu.classList.add('open');
  // Fixed positioning so the menu isn't clipped by overflow:hidden ancestors
  const r = btn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left  = 'auto';
  menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  menu.style.top   = (r.bottom + 5) + 'px';
  const mh = menu.offsetHeight;
  if (r.bottom + 5 + mh > window.innerHeight) {
    menu.style.top = Math.max(8, r.top - mh - 5) + 'px';
  }
}

function closeAllKebabs() {
  document.querySelectorAll('.kebab-wrap .col-menu.open').forEach(m => {
    m.classList.remove('open');
    m.style.position = m.style.top = m.style.left = m.style.right = '';
  });
}
document.addEventListener('click', closeAllKebabs);
document.addEventListener('scroll', closeAllKebabs, { capture: true, passive: true });
