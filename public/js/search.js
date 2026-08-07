// ── Scryfall Search ───────────────────────────────────────────────────────
// Searching happens on Enter or the Search button, never while typing: a
// Scryfall query is only valid once it is finished, and every keystroke of
// `t:creature c:r` is either a different search or a syntax error. The
// debounce that used to sit here was already unreachable — nothing had called
// it since the input stopped having an `oninput` — and is deleted rather than
// left as an invitation.
const sfState = { query: '', nextPage: null, loading: false, cards: [] };
let sfViewSize = 'list'; // 'list' | 'grid'

/* What the results area says before anyone has searched, and again when the
 * query is cleared. It carries the syntax examples that used to occupy a
 * permanent second row of the toolbar — in front of the person who has not
 * searched yet, and gone for everyone else. */
const SF_EMPTY = `<div class="empty-state">
  Search Scryfall’s whole catalogue — the full query syntax works.
  <div class="help-text sf-syntax">
    <code>t:creature c:r</code> · <code>cmc=3</code> · <code>"exact name"</code> ·
    <code>o:draw</code> · <code>r:mythic</code>
  </div>
</div>`;

const SF_SORT_FIELDS = ['name', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'];

let _sfSizeSync = null;
function initScryfallSort() {
  mountSortControl('sfSortMount', 'scryfall', SF_SORT_FIELDS, sfRender);
  mountViewToggle('sfViewMount', ['list', 'grid'], () => sfViewSize, setSfSize);
  /* #sfResults rather than the grid inside it: sfRender replaces the grid on
     every search, and an inline width set on it would go with it. */
  _sfSizeSync = mountSizeControl('sfSizeMount', 'scryfall', 'sfResults', () => sfViewSize);
  // The tab is hidden until this runs, so the empty state is painted here
  // rather than written into index.html as a second copy of the same markup.
  if (!sfState.cards.length) document.getElementById('sfResults').innerHTML = SF_EMPTY;
}

function setSfSize(size) {
  sfViewSize = size;
  sfRender();
  _sfSizeSync?.();   // each view remembers its own card size
}

async function doScryfallSearch() {
  const query = document.getElementById('sfInput').value.trim();
  if (!query) {
    document.getElementById('sfResults').innerHTML = SF_EMPTY;
    document.getElementById('sfInfo').textContent = '';
    sfState.cards    = [];
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
    const res = await scryfallFetch(url);
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

  cards.sort(cardComparator(getSortChain('scryfall', null, SF_SORT_FIELDS).criteria));

  const wrap = sfViewSize === 'grid' ? 'sf-grid' : 'sf-results';
  const html = cards.map(c =>
    sfViewSize === 'grid' ? renderSfCardLarge(c) : renderSfCardSmall(c)).join('');

  container.innerHTML = `<div class="${wrap}" id="sfGrid">${html}</div>` +
    (sfState.nextPage
      ? `<button id="sfLoadMore" class="btn-secondary" style="width:100%;margin-top:var(--space-3);padding:var(--space-2)"
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
      ${imgUrl ? `<img class="card-img" src="${imgUrl}" loading="lazy" alt="${esc(card.name)}">` : '<div class="sf-thumb-ph"></div>'}
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
        ? `<img class="sf-card-lg-img card-img" src="${imgUrl}" loading="lazy" alt="${esc(card.name)}">`
        : `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
    </a>
    <div class="sf-card-lg-footer">
      <div style="display:flex;align-items:center;gap:var(--space-1);margin-bottom:var(--space-1)">
        <a class="sf-card-lg-name card-link" href="${href}" target="_blank" rel="noopener" data-name="${esc(card.name)}" title="${esc(card.name)}" style="margin-bottom:0;flex:1">${esc(card.name)}</a>
        ${price}
        ${wantBtnHtml(card.name)}
      </div>
      <div class="sf-card-lg-badges">${owned || '<span class="sf-not-owned">—</span>'}</div>
    </div>
  </div>`;
}
