// ── Deck Viewer ───────────────────────────────────────────────────────────────
let dvDeck     = null;          // { name, cards: [{name,qty,categories}], bracket }
let dvCardData = new Map();     // card name → Scryfall card object
let dvView     = 'list';

const DV_CATEGORIES = [
  'Commander','Creatures','Planeswalkers','Instants','Sorceries',
  'Enchantments','Artifacts','Battles','Lands','Other',
];

function dvGetCategory(deckCard) {
  if ((deckCard.categories || []).some(c => /commander/i.test(c))) return 'Commander';
  const sf = dvCardData.get(deckCard.name);
  const t  = (sf?.type_line || '').toLowerCase();
  if (t.includes('creature'))     return 'Creatures';
  if (t.includes('planeswalker')) return 'Planeswalkers';
  if (t.includes('instant'))      return 'Instants';
  if (t.includes('sorcery'))      return 'Sorceries';
  if (t.includes('enchantment'))  return 'Enchantments';
  if (t.includes('artifact'))     return 'Artifacts';
  if (t.includes('battle'))       return 'Battles';
  if (t.includes('land'))         return 'Lands';
  return 'Other';
}

// Batch-fetch Scryfall card objects for an array of card names
async function dvFetchScryfall(names) {
  const BATCH = 75;
  const map   = new Map();
  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    try {
      const res  = await fetch('https://api.scryfall.com/cards/collection', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Strip the back-face from DFC names ("A // B" → "A") so Scryfall's
        // fuzzy lookup succeeds. Scryfall returns card.name as the full oracle
        // name, so map keys ("A // B") still match what's in the deck list.
        body:    JSON.stringify({ identifiers: batch.map(n => ({ name: n.split(' // ')[0] })) }),
      });
      const data = await res.json();
      for (const card of (data.data || [])) {
        map.set(card.name, card);
        if (card.card_faces?.[0]?.name) map.set(card.card_faces[0].name, card);
      }
      if (i + BATCH < names.length) await new Promise(r => setTimeout(r, 100));
    } catch (e) { console.warn('Scryfall batch error:', e); }
  }
  return map;
}

// ── Load handlers ─────────────────────────────────────────────────────────────

async function dvLoadUrl() {
  const raw   = document.getElementById('dvUrlInput').value.trim();
  const errEl = document.getElementById('dvError');
  errEl.style.display = 'none';
  const match = raw.match(/archidekt\.com\/decks?\/(\d+)/i);
  if (!match) {
    errEl.textContent = 'Please enter a valid Archidekt deck URL (archidekt.com/decks/…).';
    errEl.style.display = 'block';
    return;
  }
  await _dvLoad(async () => {
    const res  = await fetch(`/api/archidekt/deck/${match[1]}`);
    if (!res.ok) throw new Error(`Archidekt returned HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const merged = new Map();
    for (const item of (data.cards || [])) {
      const name = item.card?.oracleCard?.name || item.card?.name || '';
      const qty  = item.quantity || 0;
      if (!name || qty <= 0) continue;
      if (merged.has(name)) {
        merged.get(name).qty += qty;
      } else {
        merged.set(name, { name, qty, categories: item.categories || [] });
      }
    }
    return {
      name:    data.name || 'Unnamed Deck',
      bracket: data.deckBracket ?? data.powerLevel ?? null,
      cards:   [...merged.values()],
    };
  });
}

document.getElementById('dvCsvInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  await _dvLoad(() => {
    const rows  = parseCSVRows(text);
    const cards = [];
    for (const row of rows) {
      if (row.length < 2) continue;
      const qty  = parseInt(row[0], 10);
      const name = (row[1] || '').trim();
      if (!name || isNaN(qty) || qty <= 0) continue;
      const ex = cards.find(c => c.name === name);
      if (ex) ex.qty += qty;
      else cards.push({ name, qty, categories: [] });
    }
    if (!cards.length) throw new Error('No valid cards found in that CSV.');
    return { name: file.name.replace(/\.[^.]+$/, ''), bracket: null, cards };
  });
});

async function _dvLoad(fetcher) {
  const errEl   = document.getElementById('dvError');
  const content = document.getElementById('dvContent');
  const infoBar = document.getElementById('dvInfoBar');
  errEl.style.display   = 'none';
  infoBar.style.display = 'none';
  content.innerHTML     = '<div class="empty-state" style="padding:3rem 1rem">Loading deck…</div>';
  try {
    dvDeck = await fetcher();
    const names = [...new Set(dvDeck.cards.map(c => c.name))];
    content.innerHTML = `<div class="empty-state" style="padding:3rem 1rem">Fetching card data for ${names.length} cards…</div>`;
    dvCardData = await dvFetchScryfall(names);
    dvRender();
  } catch (e) {
    content.innerHTML   = '';
    errEl.textContent   = e.message;
    errEl.style.display = 'block';
    dvDeck = null;
  }
}

// ── View toggle + load for comparison ────────────────────────────────────────

const DV_SORT_FIELDS = ['name', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'];
let _dvControlsMounted = false;
function initDeckViewSort() {
  mountSortControl('dvSortMount', 'deckview', DV_SORT_FIELDS, dvRender, { field: 'name', dir: 1 });
  _dvControlsMounted = true;
}

function dvSetView(v) {
  dvView = v;
  document.getElementById('dv-list-btn')?.classList.toggle('active', v === 'list');
  document.getElementById('dv-grid-btn')?.classList.toggle('active', v === 'grid');
  document.getElementById('dv-xl-btn')?.classList.toggle('active', v === 'xl');
  if (dvDeck) dvRender();
}

function dvLoadForComparison() {
  if (!dvDeck) return;
  const cards = new Map();
  for (const c of dvDeck.cards) {
    const ex = cards.get(c.name);
    if (ex) ex.qty += c.qty;
    else cards.set(c.name, { name: c.name, qty: c.qty });
  }
  deck       = { name: dvDeck.name, cards };
  deckFilter = false;
  document.getElementById('deckFilterBtn').classList.remove('active');
  setTab('collections');
  renderDeck();
  renderResults();
}

// ── Render ────────────────────────────────────────────────────────────────────

function dvRender() {
  if (!dvDeck) return;
  const infoBar = document.getElementById('dvInfoBar');
  const content = document.getElementById('dvContent');

  const totalCards  = dvDeck.cards.reduce((s, c) => s + c.qty, 0);
  const uniqueCards = dvDeck.cards.length;
  document.getElementById('dvDeckName').textContent  = dvDeck.name;
  document.getElementById('dvDeckStats').textContent =
    `${uniqueCards} unique · ${totalCards} cards` +
    (dvDeck.bracket != null ? ` · Bracket ${dvDeck.bracket}` : '');
  infoBar.style.display = '';

  if (!_dvControlsMounted) initDeckViewSort();

  // Group and sort cards (within each category) by the chosen sort field
  const { field, dir } = getSort('deckview', { field: 'name', dir: 1 });
  const cmp = cardComparator(field, dir);
  const groups = {};
  for (const cat of DV_CATEGORIES) groups[cat] = [];
  for (const card of dvDeck.cards) groups[dvGetCategory(card)].push(card);
  for (const cat of DV_CATEGORIES) {
    groups[cat].sort((a, b) => cmp(dvCardData.get(a.name) || { name: a.name }, dvCardData.get(b.name) || { name: b.name }));
  }

  // Summary strip
  const summaryItems = DV_CATEGORIES
    .filter(cat => groups[cat].length > 0)
    .map(cat => {
      const count = groups[cat].reduce((s, c) => s + c.qty, 0);
      return `<span class="dv-summary-pill" onclick="document.getElementById('dv-sec-${cat}')?.scrollIntoView({behavior:'smooth',block:'start'})">
        <span class="dv-summary-cat">${cat}</span>
        <span class="dv-summary-n">${count}</span>
      </span>`;
    }).join('');

  const sectionsHtml = DV_CATEGORIES
    .filter(cat => groups[cat].length > 0)
    .map(cat => {
      const count = groups[cat].reduce((s, c) => s + c.qty, 0);
      return dvView === 'xl'   ? dvGridSectionXL(cat, count, groups[cat])
           : dvView === 'grid' ? dvGridSection(cat, count, groups[cat])
           : dvListSection(cat, count, groups[cat]);
    }).join('');

  content.innerHTML = `
    <div class="dv-summary">${summaryItems}</div>
    ${sectionsHtml}`;
}

function dvListSection(cat, count, cards) {
  const rows = cards.map(c => {
    const sf    = dvCardData.get(c.name);
    const face  = sf?.card_faces?.[0];
    const mana  = sf?.mana_cost  || face?.mana_cost  || '';
    const type  = sf?.type_line  || face?.type_line  || '';
    const href  = `https://scryfall.com/search?q=!%22${encodeURIComponent(c.name)}%22`;
    const owned = sfCardOwnership(c.name);
    const price = renderPrice(sf);
    return `<div class="dv-row">
      <span class="dv-qty">×${c.qty}</span>
      <a class="dv-name card-link" href="${href}" target="_blank" rel="noopener" data-name="${esc(c.name)}">${esc(c.name)}</a>
      ${mana ? `<span class="dv-mana">${renderMana(mana)}</span>` : '<span class="dv-mana"></span>'}
      <span class="dv-type">${esc(type)}</span>
      <span class="dv-price">${price}</span>
      <span class="dv-own">${owned || ''}</span>
    </div>`;
  }).join('');
  return `<div class="dv-section" id="dv-sec-${cat}">
    <div class="dv-section-hdr">
      <span class="dv-section-title">${cat}</span>
      <span class="dv-section-count">${count}</span>
    </div>
    <div class="dv-list">${rows}</div>
  </div>`;
}

function dvGridSection(cat, count, cards) {
  const tiles = cards.map(c => {
    const sf     = dvCardData.get(c.name);
    const face   = sf?.card_faces?.[0];
    const imgUrl = sf?.image_uris?.normal || face?.image_uris?.normal || '';
    const href   = `https://scryfall.com/search?q=!%22${encodeURIComponent(c.name)}%22`;
    const owned  = sfCardOwnership(c.name);
    const price  = renderPrice(sf);
    return `<div class="sf-card-lg">
      <a href="${sf?.scryfall_uri || href}" target="_blank" rel="noopener" class="card-open" data-name="${esc(c.name)}">
        ${imgUrl
          ? `<img class="sf-card-lg-img" src="${imgUrl}" loading="lazy" alt="${esc(c.name)}">`
          : `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
      </a>
      <div class="sf-card-lg-footer">
        <div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.25rem">
          <a class="sf-card-lg-name card-link" href="${href}" target="_blank" rel="noopener"
             data-name="${esc(c.name)}" title="${esc(c.name)}" style="margin-bottom:0;flex:1">${esc(c.name)}</a>
          ${c.qty > 1 ? `<span style="font-size:.72rem;font-weight:700;color:var(--muted)">×${c.qty}</span>` : ''}
          ${price}
        </div>
        <div class="sf-card-lg-badges">${owned || '<span class="sf-not-owned">—</span>'}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="dv-section" id="dv-sec-${cat}">
    <div class="dv-section-hdr">
      <span class="dv-section-title">${cat}</span>
      <span class="dv-section-count">${count}</span>
    </div>
    <div class="sf-grid">${tiles}</div>
  </div>`;
}

function dvGridSectionXL(cat, count, cards) {
  const tiles = cards.map(c => {
    const sf     = dvCardData.get(c.name);
    const face   = sf?.card_faces?.[0];
    const imgUrl = sf?.image_uris?.large || sf?.image_uris?.normal || face?.image_uris?.large || face?.image_uris?.normal || '';
    const mana   = sf?.mana_cost || face?.mana_cost || '';
    const type   = sf?.type_line || face?.type_line || '';
    const href   = `https://scryfall.com/search?q=!%22${encodeURIComponent(c.name)}%22`;
    const owned  = sfCardOwnership(c.name);
    const price  = renderPrice(sf);
    return `<div class="sf-card-lg">
      <a href="${sf?.scryfall_uri || href}" target="_blank" rel="noopener" class="card-open" data-name="${esc(c.name)}">
        ${imgUrl
          ? `<img class="sf-card-lg-img" src="${imgUrl}" loading="lazy" alt="${esc(c.name)}">`
          : `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
      </a>
      <div class="sf-card-lg-footer">
        <div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.2rem">
          <a class="sf-card-lg-name card-link" href="${href}" target="_blank" rel="noopener"
             data-name="${esc(c.name)}" title="${esc(c.name)}" style="margin-bottom:0;flex:1">${esc(c.name)}</a>
          ${c.qty > 1 ? `<span style="font-size:.72rem;font-weight:700;color:var(--muted)">×${c.qty}</span>` : ''}
          ${price}
        </div>
        ${mana ? `<div style="margin-bottom:.2rem">${renderMana(mana)}</div>` : ''}
        ${type ? `<div style="font-size:.7rem;color:var(--muted);margin-bottom:.25rem">${esc(type)}</div>` : ''}
        <div class="sf-card-lg-badges">${owned || '<span class="sf-not-owned">—</span>'}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="dv-section" id="dv-sec-${cat}">
    <div class="dv-section-hdr">
      <span class="dv-section-title">${cat}</span>
      <span class="dv-section-count">${count}</span>
    </div>
    <div class="sf-grid-xl">${tiles}</div>
  </div>`;
}
