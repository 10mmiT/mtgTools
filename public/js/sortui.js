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

// ── Shared view toggle (List / Grid / XL / Pile) ────────────────────────────
// One component for every tab's view switcher, so the same icons appear in the
// same order everywhere. `getCur` returns the current mode; `pick` sets it
// (and triggers the tab's own re-render).
const _VT_ICONS = {
  list: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  grid: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  xl:   'XL',
  pile: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="4" y="2" width="16" height="6" rx="1"/><rect x="4" y="9" width="16" height="6" rx="1"/><rect x="4" y="16" width="16" height="6" rx="1"/></svg>',
};
const _VT_TITLES = { list: 'List view', grid: 'Grid view', xl: 'Extra-large grid', pile: 'Pile view' };

function mountViewToggle(containerId, modes, getCur, pick) {
  const host = document.getElementById(containerId);
  if (!host) return;
  host.innerHTML = `<div class="view-toggle">${modes.map(m =>
    `<button class="view-btn${getCur() === m ? ' active' : ''}" data-mode="${m}" title="${_VT_TITLES[m]}"${m === 'xl' ? ' style="font-size:.72rem;font-weight:700"' : ''}>${_VT_ICONS[m]}</button>`
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
