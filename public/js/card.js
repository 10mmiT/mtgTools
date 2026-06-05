// ── Card Detail tab ─────────────────────────────────────────────────────────
// Shows full info for a single card: oracle text, stats, rulings, store links
// and every other printing (alt-art) at the bottom. Opened by clicking any
// card name or image anywhere in the app (see the delegated handler in main.js).

const _cardCache = new Map(); // key: `name:<name>` or `id:<id>` → scryfall card object
let _cardReqSeq = 0;          // guards against out-of-order async renders

// Convert "{2}{W}{U/P}{T}" → mana-font icons
function cardManaSymbols(cost) {
  if (!cost) return '';
  return cost.replace(/\{([^}]+)\}/g, (_, sym) => {
    let code = sym.toLowerCase().replace('/', '');
    if (code === 't') code = 'tap';
    if (code === 'q') code = 'untap';
    return `<i class="ms ms-${code} ms-cost ms-shadow" title="{${sym}}"></i>`;
  });
}

// Replace {symbol} runs inside oracle text with inline mana icons
function cardOracleHtml(text) {
  if (!text) return '';
  return esc(text)
    .replace(/\{([^}]+)\}/g, (_, sym) => {
      let code = sym.toLowerCase().replace('/', '');
      if (code === 't') code = 'tap';
      if (code === 'q') code = 'untap';
      return `<i class="ms ms-${code} ms-cost" title="{${sym}}"></i>`;
    })
    .replace(/\n/g, '<br>');
}

function openCardByName(name) {
  setTab('card', false); // switch tab without its own history entry…
  history.pushState({ view: 'card', cardName: name }, '', '#card=' + encodeURIComponent(name));
  loadCard({ name });
}
function openCardById(id) {
  setTab('card', false);
  history.pushState({ view: 'card', cardId: id }, '', '#cardid=' + encodeURIComponent(id));
  loadCard({ id });
}

async function loadCard({ name, id }) {
  const seq = ++_cardReqSeq;
  const host = document.getElementById('cardDetail');
  const key = id ? `id:${id}` : `name:${name}`;

  if (_cardCache.has(key)) {
    renderCard(_cardCache.get(key), seq);
    return;
  }

  host.innerHTML = `<div class="card-detail-loading">Loading ${esc(name || 'card')}…</div>`;

  let card;
  try {
    let url;
    if (id) {
      url = `https://api.scryfall.com/cards/${encodeURIComponent(id)}`;
    } else {
      url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`;
    }
    let res = await fetch(url);
    // Fall back to fuzzy front-face lookup for tricky/DFC names
    if (!res.ok && name) {
      res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name.split(' // ')[0])}`);
    }
    if (!res.ok) throw new Error('not found');
    card = await res.json();
  } catch {
    if (seq === _cardReqSeq) {
      host.innerHTML = `<div class="card-detail-empty">Couldn't load <strong>${esc(name || id)}</strong> from Scryfall.</div>`;
    }
    return;
  }

  _cardCache.set(key, card);
  _cardCache.set(`id:${card.id}`, card);
  renderCard(card, seq);
}

async function renderCard(card, seq) {
  if (seq !== _cardReqSeq) return;
  const host = document.getElementById('cardDetail');

  const faces = card.card_faces && card.card_faces.length && card.card_faces[0].oracle_text !== undefined
    ? card.card_faces : null;

  // Card images (one per face for DFCs)
  const imgs = [];
  if (card.image_uris?.normal) imgs.push({ src: card.image_uris.normal, alt: card.name });
  else if (faces) faces.forEach(f => { if (f.image_uris?.normal) imgs.push({ src: f.image_uris.normal, alt: f.name }); });

  const imgHtml = imgs.length
    ? imgs.map(i => `<img class="card-detail-img" src="${i.src}" alt="${esc(i.alt)}">`).join('')
    : `<div class="card-detail-img card-detail-img-ph">No image</div>`;

  // Text block(s)
  const textBlocks = faces
    ? faces.map(f => cardFaceBlock(f)).join('<div class="card-face-divider"></div>')
    : cardFaceBlock(card);

  const setLine = `${esc(card.set_name)} (${(card.set || '').toUpperCase()}) · #${esc(card.collector_number || '')} · ${esc((card.rarity || '').replace(/^./, c => c.toUpperCase()))}`;
  const eur = card.prices?.eur, usd = card.prices?.usd;
  const priceBits = [];
  if (eur) priceBits.push(`<span class="card-price">€${eur}</span>`);
  if (usd) priceBits.push(`<span class="card-price card-price-usd">$${usd}</span>`);

  const cmUrl = card.purchase_uris?.cardmarket;
  const sfUrl = card.scryfall_uri;

  host.innerHTML = `
    <div class="card-detail-top">
      <div class="card-detail-imgcol">${imgHtml}</div>
      <div class="card-detail-info">
        <h2 class="card-detail-name">${esc(card.name)}
          ${card.mana_cost ? `<span class="card-detail-cost">${cardManaSymbols(card.mana_cost)}</span>` : ''}
        </h2>
        <div class="card-detail-set help-text">${setLine}${card.artist ? ` · 🖌 ${esc(card.artist)}` : ''}</div>
        ${priceBits.length ? `<div class="card-detail-prices">${priceBits.join('')}</div>` : ''}
        <div class="card-detail-text">${textBlocks}</div>
        ${cardLegalitiesHtml(card.legalities)}
        <div class="card-detail-links">
          ${sfUrl ? `<a class="btn-secondary card-ext-link" href="${sfUrl}" target="_blank" rel="noopener">View on Scryfall ↗</a>` : ''}
          ${cmUrl ? `<a class="btn-secondary card-ext-link" href="${cmUrl}" target="_blank" rel="noopener">Buy on Cardmarket ↗</a>` : ''}
        </div>
      </div>
    </div>
    <div class="card-detail-section" id="cardRulings"><div class="panel-title">Rulings</div><div class="help-text">Loading rulings…</div></div>
    <div class="card-detail-section" id="cardPrints"><div class="panel-title">Other Printings &amp; Alt-Art</div><div class="help-text">Loading printings…</div></div>
  `;

  // Rulings + printings load async (independent of each other)
  loadRulings(card, seq);
  loadPrints(card, seq);
}

function cardFaceBlock(f) {
  const stats = [];
  if (f.power !== undefined && f.toughness !== undefined) stats.push(`${esc(f.power)}/${esc(f.toughness)}`);
  if (f.loyalty !== undefined) stats.push(`Loyalty ${esc(f.loyalty)}`);
  if (f.defense !== undefined) stats.push(`Defense ${esc(f.defense)}`);
  return `
    <div class="card-face">
      ${f.type_line ? `<div class="card-face-type">${esc(f.type_line)}
        ${f.mana_cost && f.name ? `<span class="card-face-cost">${cardManaSymbols(f.mana_cost)}</span>` : ''}</div>` : ''}
      ${f.oracle_text ? `<div class="card-oracle">${cardOracleHtml(f.oracle_text)}</div>` : ''}
      ${f.flavor_text ? `<div class="card-flavor">${cardOracleHtml(f.flavor_text)}</div>` : ''}
      ${stats.length ? `<div class="card-stats">${stats.join(' · ')}</div>` : ''}
    </div>`;
}

function cardLegalitiesHtml(legalities) {
  if (!legalities) return '';
  const formats = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper'];
  const pills = formats.map(fmt => {
    const ok = legalities[fmt] === 'legal';
    const restricted = legalities[fmt] === 'restricted';
    const cls = ok ? 'leg-ok' : restricted ? 'leg-restricted' : 'leg-no';
    return `<span class="card-legal ${cls}">${fmt}</span>`;
  }).join('');
  return `<div class="card-legalities">${pills}</div>`;
}

async function loadRulings(card, seq) {
  const el = document.getElementById('cardRulings');
  if (!card.rulings_uri) { if (el) el.style.display = 'none'; return; }
  let rulings = [];
  try {
    const res = await fetch(card.rulings_uri);
    if (res.ok) rulings = (await res.json()).data || [];
  } catch {}
  if (seq !== _cardReqSeq || !el) return;
  if (!rulings.length) {
    el.innerHTML = `<div class="panel-title">Rulings</div><div class="help-text">No rulings for this card.</div>`;
    return;
  }
  el.innerHTML = `<div class="panel-title">Rulings (${rulings.length})</div>` +
    rulings.map(r => `<div class="card-ruling">
      <span class="card-ruling-date">${esc((r.published_at || '').slice(0, 10))}</span>
      <span class="card-ruling-text">${cardOracleHtml(r.comment)}</span>
    </div>`).join('');
}

async function loadPrints(card, seq) {
  const el = document.getElementById('cardPrints');
  if (!card.prints_search_uri) { if (el) el.style.display = 'none'; return; }
  let prints = [];
  try {
    const res = await fetch(card.prints_search_uri);
    if (res.ok) prints = (await res.json()).data || [];
  } catch {}
  if (seq !== _cardReqSeq || !el) return;
  if (!prints.length) { el.style.display = 'none'; return; }

  const tiles = prints.map(p => {
    const img = p.image_uris?.normal || p.image_uris?.large || p.card_faces?.[0]?.image_uris?.normal;
    const isCurrent = p.id === card.id;
    return `<button class="card-print-tile${isCurrent ? ' current' : ''}" onclick="openCardById('${p.id}')" title="${esc(p.set_name)} #${esc(p.collector_number || '')}">
      ${img ? `<img loading="lazy" src="${img}" alt="${esc(p.set_name)}">` : `<div class="card-print-ph"></div>`}
      <span class="card-print-set">${(p.set || '').toUpperCase()} · #${esc(p.collector_number || '')}</span>
    </button>`;
  }).join('');

  el.innerHTML = `<div class="panel-title">Other Printings &amp; Alt-Art (${prints.length})</div>
    <div class="card-prints-grid">${tiles}</div>`;
}
