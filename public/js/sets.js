// ── Set Browser ───────────────────────────────────────────────────────────
const SET_TYPES = new Set(['expansion','core','masters','draft_innovation',
  'commander','starter','planechase','archenemy','duel_deck','premium_deck',
  'from_the_vault','spellbook','box']);

let sfSets      = null;
let currentSet  = null; // { code, name }
let setCardsAll = [];
let setFilter   = 'all';  // 'all' | 'owned' | 'unowned'
let setView     = 'list'; // 'list' | 'grid'

async function initSetBrowser() {
  if (sfSets) { renderSetList(); return; }
  try {
    const res  = await fetch('https://api.scryfall.com/sets');
    const data = await res.json();
    sfSets = (data.data || [])
      .filter(s => SET_TYPES.has(s.set_type) && !s.digital)
      .sort((a, b) => (b.released_at || '').localeCompare(a.released_at || ''));
  } catch (e) {
    document.getElementById('setList').innerHTML =
      `<span style="color:var(--danger);font-size:.82rem">Failed to load sets: ${esc(e.message)}</span>`;
    return;
  }
  renderSetList();
}

function filterSets() { renderSetList(); }

function setSetFilter(f) {
  setFilter = f;
  ['all','owned','unowned'].forEach(v => {
    document.getElementById(`setFilter${v.charAt(0).toUpperCase()+v.slice(1)}`)
      ?.classList.toggle('active', v === f);
  });
  renderSetCards();
}

function setSetView(v) {
  setView = v;
  document.getElementById('setViewList')?.classList.toggle('active', v === 'list');
  document.getElementById('setViewGrid')?.classList.toggle('active', v === 'grid');
  renderSetCards();
}

function renderSetList() {
  const q    = (document.getElementById('setSearchInput')?.value || '').toLowerCase();
  const list = document.getElementById('setList');
  if (!sfSets) return;
  const shown = (q
    ? sfSets.filter(s => s.name.toLowerCase().includes(q) || s.code.includes(q))
    : sfSets).slice(0, 120);
  list.innerHTML = shown.map(s => `
    <button class="set-pill ${s.code === currentSet?.code ? 'active' : ''}"
            onclick="selectSet('${s.code}')">
      <span class="set-pill-code">${s.code.toUpperCase()}</span>
      ${esc(s.name)}
      <span class="set-pill-year">${(s.released_at || '').slice(0,4)}</span>
    </button>`).join('');
}

async function selectSet(code) {
  const name  = sfSets.find(s => s.code === code)?.name || code;
  currentSet  = { code, name };
  setCardsAll = [];
  renderSetList();

  const cardsEl = document.getElementById('setCards');
  const infoBar = document.getElementById('setInfoBar');
  infoBar.style.display = 'none';
  cardsEl.innerHTML = `<div class="empty-state">Loading ${esc(name)}…</div>`;

  let url = `https://api.scryfall.com/cards/search?q=set:${code}&order=collector_number&unique=cards`;
  while (url) {
    try {
      const res  = await fetch(url);
      if (!res.ok) { cardsEl.innerHTML = '<div class="empty-state">No cards found for this set.</div>'; return; }
      const data = await res.json();
      setCardsAll.push(...(data.data || []));
      url = data.has_more ? data.next_page : null;
      cardsEl.innerHTML = `<div class="empty-state">Loading… ${setCardsAll.length} cards</div>`;
    } catch (e) {
      cardsEl.innerHTML = `<div class="empty-state">Error: ${esc(e.message)}</div>`; return;
    }
  }
  renderSetCards();
}

function renderSetCards() {
  const cardsEl = document.getElementById('setCards');
  const infoBar = document.getElementById('setInfoBar');
  if (!setCardsAll.length) return;

  const isOwned  = c => state.collections.some(col => col.status === 'loaded' && col.cards.has(c.name));
  const ownedCount = setCardsAll.filter(isOwned).length;
  const unownedCount = setCardsAll.length - ownedCount;

  const displayed = setFilter === 'owned'   ? setCardsAll.filter(isOwned)
                  : setFilter === 'unowned' ? setCardsAll.filter(c => !isOwned(c))
                  : setCardsAll;

  infoBar.style.display = '';
  infoBar.innerHTML = `
    <strong>${esc(currentSet?.name)}</strong>
    <span>${setCardsAll.length} cards in set</span>
    <span style="color:#10b981">${ownedCount} owned</span>
    <span style="color:var(--muted)">${unownedCount} unowned</span>
    ${displayed.length !== setCardsAll.length ? `<span>(showing ${displayed.length})</span>` : ''}`;

  if (!displayed.length) {
    const msg = setFilter === 'owned'   ? 'No cards from this set are in any collection.'
              : setFilter === 'unowned' ? 'Every card in this set is owned — nice!'
              : 'No cards found.';
    cardsEl.innerHTML = `<div class="empty-state">${msg}</div>`;
    return;
  }

  if (setView === 'grid') {
    cardsEl.innerHTML = `<div class="sf-grid">${displayed.map(renderSetCardGrid).join('')}</div>`;
  } else {
    cardsEl.innerHTML = `<div class="sf-results">${displayed.map(renderSetCardList).join('')}</div>`;
  }
}

function renderSetCardList(card) {
  const face   = card.card_faces?.[0];
  const imgUrl = card.image_uris?.small || face?.image_uris?.small || '';
  const mana   = card.mana_cost         || face?.mana_cost         || '';
  const href   = `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22`;
  const owned  = sfCardOwnership(card.name);
  return `<div class="sf-card">
    <a href="${card.scryfall_uri}" target="_blank" rel="noopener" class="sf-thumb">
      ${imgUrl ? `<img src="${imgUrl}" loading="lazy" alt="${esc(card.name)}">` : '<div class="sf-thumb-ph"></div>'}
    </a>
    <div class="sf-body">
      <div class="sf-name-row">
        <a class="sf-card-name card-link" href="${href}" target="_blank" rel="noopener" data-name="${esc(card.name)}">${esc(card.name)}</a>
        ${mana ? `<span class="sf-mana">${renderMana(mana)}</span>` : ''}
        <span style="font-size:.68rem;color:var(--border)">#${card.collector_number || '?'}</span>
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
  return `<div class="sf-card-lg">
    <a href="${card.scryfall_uri}" target="_blank" rel="noopener">
      ${imgUrl
        ? `<img class="sf-card-lg-img" src="${imgUrl}" loading="lazy" alt="${esc(card.name)}">`
        : `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
    </a>
    <div class="sf-card-lg-footer">
      <div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.25rem">
        <a class="sf-card-lg-name card-link" href="${href}" target="_blank" rel="noopener"
           data-name="${esc(card.name)}" title="${esc(card.name)}" style="margin-bottom:0;flex:1">${esc(card.name)}</a>
        ${wantBtnHtml(card.name)}
      </div>
      <div class="sf-card-lg-badges">${owned || '<span class="sf-not-owned">—</span>'}</div>
    </div>
  </div>`;
}
