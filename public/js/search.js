// ── Scryfall Search ───────────────────────────────────────────────────────
const sfState = { query: '', nextPage: null, loading: false, timer: null, cards: [] };
let sfViewSize = 'list'; // 'list' | 'grid' | 'xl'

const SF_SORT_FIELDS = ['name', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'];

function initScryfallSort() {
  mountSortControl('sfSortMount', 'scryfall', SF_SORT_FIELDS, sfRender);
}

function setSfSize(size) {
  sfViewSize = size;
  document.getElementById('sf-size-sm').classList.toggle('active', size === 'list');
  document.getElementById('sf-size-lg').classList.toggle('active', size === 'grid');
  document.getElementById('sf-size-xl').classList.toggle('active', size === 'xl');
  sfRender();
}

function sfDebounce() {
  clearTimeout(sfState.timer);
  sfState.timer = setTimeout(doScryfallSearch, 380);
}

async function doScryfallSearch() {
  const query = document.getElementById('sfInput').value.trim();
  if (!query) {
    document.getElementById('sfResults').innerHTML = '';
    document.getElementById('sfInfo').textContent = '';
    sfState.nextPage = null;
    return;
  }
  sfState.query    = query;
  sfState.nextPage = null;
  sfState.cards    = [];
  await fetchScryfallPage(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=name`,
    false
  );
}

async function fetchScryfallPage(url, append) {
  sfState.loading = true;
  const lmBtn = document.getElementById('sfLoadMore');
  if (lmBtn) lmBtn.disabled = true;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      if (!append) {
        document.getElementById('sfResults').innerHTML =
          `<div class="empty-state">${esc(data.details || data.warnings?.[0] || 'No results found.')}</div>`;
        document.getElementById('sfInfo').textContent = '';
      }
      sfState.nextPage = null;
      return;
    }

    sfState.nextPage = data.has_more ? data.next_page : null;

    if (!append) {
      document.getElementById('sfInfo').textContent =
        `${(data.total_cards || data.data?.length || 0).toLocaleString()} cards`;
    }

    if (append) sfState.cards.push(...(data.data || []));
    else        sfState.cards = data.data || [];

    // Cache metadata so other views can sort by it too
    if (data.data) for (const c of data.data) {
      if (!scryfallMetaCache.has(c.name)) scryfallMetaCache.set(c.name, cardMetaOf(c));
    }

    sfRender();
  } catch (e) {
    if (!append) {
      document.getElementById('sfResults').innerHTML =
        `<div class="empty-state">Error: ${esc(e.message)}</div>`;
    }
  } finally {
    sfState.loading = false;
    const btn = document.getElementById('sfLoadMore');
    if (btn) btn.disabled = false;
  }
}

// Sort all loaded cards by the current sort, then render the whole set
function sfRender() {
  const container = document.getElementById('sfResults');
  if (!container) return;
  const cards = (sfState.cards || []).slice();
  if (!cards.length) return; // leave any empty/error state from the fetch

  const { field, dir } = getSort('scryfall');
  cards.sort(cardComparator(field, dir));

  const wrap = sfViewSize === 'xl' ? 'sf-grid-xl' : sfViewSize === 'grid' ? 'sf-grid' : 'sf-results';
  const html = cards.map(c =>
    sfViewSize === 'xl'   ? renderSfCardXL(c)
    : sfViewSize === 'grid' ? renderSfCardLarge(c)
    : renderSfCardSmall(c)).join('');

  container.innerHTML = `<div class="${wrap}" id="sfGrid">${html}</div>` +
    (sfState.nextPage
      ? `<button id="sfLoadMore" class="btn-secondary" style="width:100%;margin-top:.75rem;padding:.6rem"
           onclick="fetchScryfallPage(sfState.nextPage, true)">Load more results</button>`
      : '');
}

function renderSfCardSmall(card) {
  const face   = card.card_faces?.[0];
  const imgUrl = card.image_uris?.small || face?.image_uris?.small || '';
  const mana   = card.mana_cost         || face?.mana_cost         || '';
  const sfUrl  = card.scryfall_uri || `https://scryfall.com/card/${card.id}`;
  const href   = `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22`;
  const owned  = sfCardOwnership(card.name);
  const price  = renderPrice(card);
  return `<div class="sf-card">
    <a href="${sfUrl}" target="_blank" rel="noopener" class="sf-thumb card-open" data-name="${esc(card.name)}">
      ${imgUrl ? `<img src="${imgUrl}" loading="lazy" alt="${esc(card.name)}">` : '<div class="sf-thumb-ph"></div>'}
    </a>
    <div class="sf-body">
      <div class="sf-name-row">
        <a class="sf-card-name card-link" href="${href}" target="_blank" rel="noopener" data-name="${esc(card.name)}">${esc(card.name)}</a>
        ${mana ? `<span class="sf-mana">${renderMana(mana)}</span>` : ''}
        ${price}
        ${wantBtnHtml(card.name)}
      </div>
      <div class="sf-type">${esc(card.type_line || '')}</div>
      <div class="sf-ownership">${owned || '<span class="sf-not-owned">Not in any collection</span>'}</div>
    </div>
  </div>`;
}

function renderSfCardLarge(card) {
  const face   = card.card_faces?.[0];
  const imgUrl = card.image_uris?.normal || face?.image_uris?.normal || '';
  const sfUrl  = card.scryfall_uri || `https://scryfall.com/card/${card.id}`;
  const href   = `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22`;
  const owned  = sfCardOwnership(card.name);
  const price  = renderPrice(card);
  return `<div class="sf-card-lg">
    <a href="${sfUrl}" target="_blank" rel="noopener" class="card-open" data-name="${esc(card.name)}">
      ${imgUrl
        ? `<img class="sf-card-lg-img" src="${imgUrl}" loading="lazy" alt="${esc(card.name)}">`
        : `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
    </a>
    <div class="sf-card-lg-footer">
      <div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.25rem">
        <a class="sf-card-lg-name card-link" href="${href}" target="_blank" rel="noopener" data-name="${esc(card.name)}" title="${esc(card.name)}" style="margin-bottom:0;flex:1">${esc(card.name)}</a>
        ${price}
        ${wantBtnHtml(card.name)}
      </div>
      <div class="sf-card-lg-badges">${owned || '<span class="sf-not-owned">—</span>'}</div>
    </div>
  </div>`;
}

function renderSfCardXL(card) {
  const face   = card.card_faces?.[0];
  const imgUrl = card.image_uris?.large || card.image_uris?.normal || face?.image_uris?.large || face?.image_uris?.normal || '';
  const sfUrl  = card.scryfall_uri || `https://scryfall.com/card/${card.id}`;
  const href   = `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22`;
  const owned  = sfCardOwnership(card.name);
  const price  = renderPrice(card);
  const mana   = card.mana_cost || face?.mana_cost || '';
  const type   = card.type_line || face?.type_line || '';
  return `<div class="sf-card-lg">
    <a href="${sfUrl}" target="_blank" rel="noopener" class="card-open" data-name="${esc(card.name)}">
      ${imgUrl
        ? `<img class="sf-card-lg-img" src="${imgUrl}" loading="lazy" alt="${esc(card.name)}">`
        : `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
    </a>
    <div class="sf-card-lg-footer">
      <div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.2rem">
        <a class="sf-card-lg-name card-link" href="${href}" target="_blank" rel="noopener" data-name="${esc(card.name)}" title="${esc(card.name)}" style="margin-bottom:0;flex:1">${esc(card.name)}</a>
        ${price}
        ${wantBtnHtml(card.name)}
      </div>
      ${mana ? `<div style="margin-bottom:.2rem">${renderMana(mana)}</div>` : ''}
      ${type ? `<div style="font-size:.7rem;color:var(--muted);margin-bottom:.25rem">${esc(type)}</div>` : ''}
      <div class="sf-card-lg-badges">${owned || '<span class="sf-not-owned">—</span>'}</div>
    </div>
  </div>`;
}
