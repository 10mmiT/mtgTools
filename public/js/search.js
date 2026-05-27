// ── Scryfall Search ───────────────────────────────────────────────────────
const sfState = { query: '', nextPage: null, loading: false, timer: null };
let sfViewSize = 'list'; // 'list' | 'grid' | 'xl'

function setSfSize(size) {
  sfViewSize = size;
  document.getElementById('sf-size-sm').classList.toggle('active', size === 'list');
  document.getElementById('sf-size-lg').classList.toggle('active', size === 'grid');
  document.getElementById('sf-size-xl').classList.toggle('active', size === 'xl');
  // Re-render existing results in the new size
  const container = document.getElementById('sfResults');
  if (container.dataset.cards) {
    const cards = JSON.parse(container.dataset.cards);
    container.innerHTML = '';
    container.removeAttribute('data-cards');
    renderSfPage(cards, false);
  }
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

    renderSfPage(data.data || [], append);
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

function renderSfPage(cards, append) {
  const container = document.getElementById('sfResults');
  const oldMore   = document.getElementById('sfLoadMore');
  if (oldMore) oldMore.remove();
  if (!append) {
    container.innerHTML = '';
    container.removeAttribute('data-cards');
    // Wrap in correct container element based on size
    container.insertAdjacentHTML('beforeend',
      sfViewSize === 'xl'   ? '<div class="sf-grid-xl" id="sfGrid"></div>'
      : sfViewSize === 'grid' ? '<div class="sf-grid" id="sfGrid"></div>'
      : '<div class="sf-results" id="sfGrid"></div>'
    );
  }

  const grid = document.getElementById('sfGrid');

  // Store all cards so we can re-render on size toggle
  const prev = container.dataset.cards ? JSON.parse(container.dataset.cards) : [];
  container.dataset.cards = JSON.stringify(append ? [...prev, ...cards] : cards);

  const html = sfViewSize === 'xl'   ? cards.map(card => renderSfCardXL(card)).join('')
             : sfViewSize === 'grid' ? cards.map(card => renderSfCardLarge(card)).join('')
             : cards.map(card => renderSfCardSmall(card)).join('');

  grid.insertAdjacentHTML('beforeend', html);

  if (sfState.nextPage) {
    container.insertAdjacentHTML('beforeend',
      `<button id="sfLoadMore" class="btn-secondary" style="width:100%;margin-top:.75rem;padding:.6rem"
         onclick="fetchScryfallPage(sfState.nextPage, true)">Load more results</button>`);
  }
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
    <a href="${sfUrl}" target="_blank" rel="noopener" class="sf-thumb">
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
    <a href="${sfUrl}" target="_blank" rel="noopener">
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
    <a href="${sfUrl}" target="_blank" rel="noopener">
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
