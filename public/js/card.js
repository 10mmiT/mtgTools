// ── Card Detail tab ─────────────────────────────────────────────────────────
// Shows full info for a single card: oracle text, stats, rulings, store links
// and every other printing (alt-art) at the bottom. Opened by clicking any
// card name or image anywhere in the app (see the delegated handler in main.js).

const _cardCache = new Map(); // key: `name:<name>` or `id:<id>` → scryfall card object
let _cardReqSeq = 0;          // guards against out-of-order async renders

/* The deck the printings gallery is choosing for, or null for the gallery this
   tab has always had.

   Opened from a card in a deck you can edit, the gallery stops being a way to
   go and look at another printing and becomes a way to choose one — so this is
   what the whole bottom half of the card reads to know which of the two it is.
   It is a property of the opening rather than of the tab: openCardByName() is
   handed one by the deck's own Inspect and by nothing else in the app, and
   every other way of opening a card writes null over it. A context left
   standing is a press on the Scryfall tab silently repainting somebody's deck.

   { deckId, playerId, deckName, ref } — enough to say which deck and which card
   in it, and no more: what the deck actually holds is asked of the deck at the
   moment of the press, because the gallery may have stood open for a while. */
let _cardForDeck = null;

/* The printings the gallery last drew, as Scryfall gave them, and where it drew
   them. A press names a printing by id and the snapshot is taken from the
   record here rather than from the markup, so what is written onto the deck is
   the printing itself and not a re-reading of the tile. */
let _cardPrints    = [];
let _cardPrintCard = null;
let _cardPrintsAt  = '';

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

// At and above the nav breakpoint the card opens as a modal; below it, as the
// full-page card tab. BP_MD lives in state.js beside the CSS token it mirrors,
// and components.css hides the overlay on the same boundary.
function _useModal() { return window.innerWidth >= BP_MD; }

function _openModal(hostId) {
  const overlay = document.getElementById('cardModal');
  if (!overlay) return null;
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  return document.getElementById(hostId);
}

function _closeModal() {
  const overlay = document.getElementById('cardModal');
  if (!overlay) return;
  overlay.style.display = 'none';
  document.body.style.overflow = '';
}

// Called by backdrop click, close button, Esc key
function closeCardModal() {
  _closeModal();
  // Pop the history entry pushed when the modal opened
  if (history.state?.view === 'card-modal') history.back();
}

// When navigating card→card inside the already-open modal (e.g. clicking an
// alt-art print tile), replace the history entry instead of pushing a new one.
// Otherwise closeCardModal()'s single history.back() lands on the previous
// card-modal entry and the popstate handler immediately re-opens the modal.
function _modalHistoryNav(state, hash) {
  if (history.state?.view === 'card-modal') history.replaceState(state, '', hash);
  else history.pushState(state, '', hash);
}

/* `forDeck` is the deck's Inspect saying "and this is the deck I came from".
   Defaulted rather than optional-in-effect: every other caller in the app
   passes one argument, and the assignment is what clears a context left over
   from the last card. */
function openCardByName(name, forDeck = null) {
  _cardForDeck = forDeck;
  if (_useModal()) {
    const host = _openModal('cardModalDetail');
    if (host) {
      _modalHistoryNav({ view: 'card-modal', cardName: name }, '#card=' + encodeURIComponent(name));
      loadCard({ name }, 'cardModalDetail');
      return;
    }
  }
  // Fallback: full-page tab
  setTab('card', false);
  history.pushState({ view: 'card', cardName: name }, '', '#card=' + encodeURIComponent(name));
  loadCard({ name }, 'cardDetail');
}

/* A printing, looked at. Never a choice — the tiles that choose do not come
   here — so this is one of the doors that clears the deck behind it. */
function openCardById(id) {
  _cardForDeck = null;
  if (_useModal()) {
    const host = _openModal('cardModalDetail');
    if (host) {
      _modalHistoryNav({ view: 'card-modal', cardId: id }, '#cardid=' + encodeURIComponent(id));
      loadCard({ id }, 'cardModalDetail');
      return;
    }
  }
  setTab('card', false);
  history.pushState({ view: 'card', cardId: id }, '', '#cardid=' + encodeURIComponent(id));
  loadCard({ id }, 'cardDetail');
}

async function loadCard({ name, id }, hostId = 'cardDetail') {
  const seq = ++_cardReqSeq;
  const host = document.getElementById(hostId);
  const key = id ? `id:${id}` : `name:${name}`;

  if (_cardCache.has(key)) {
    renderCard(_cardCache.get(key), seq, hostId);
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
    let res = await scryfallFetch(url);
    // Fall back to fuzzy front-face lookup for tricky/DFC names
    if (!res.ok && name) {
      res = await scryfallFetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name.split(' // ')[0])}`);
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
  renderCard(card, seq, hostId);
}

async function renderCard(card, seq, hostId = 'cardDetail') {
  if (seq !== _cardReqSeq) return;
  const host = document.getElementById(hostId);

  const faces = card.card_faces && card.card_faces.length && card.card_faces[0].oracle_text !== undefined
    ? card.card_faces : null;

  /* The card's picture: its own, or its front face's for a card whose faces
     carry them. One picture, because a two-sided card is one card — it is
     drawn here as its front and the control that turns it over, the same
     wrapper and the same helper the grids use (js/cardturn.js), rather than as
     both faces stacked down the column. Two images in a column is two pictures
     of two things; this view is the one place large enough to read a card
     properly and it should show a card.

     The picture takes the card's own name rather than the front face's, as
     every other turnable card in the app does: "Delver of Secrets // Insectile
     Aberration" names the object, so it is still true once it has been turned
     over. And a card with no picture at all is not wrapped, since a control
     that turned a "No image" box over would be a control with nothing to
     turn. */
  const front = card.image_uris?.normal
    || (faces || []).map(f => f.image_uris?.normal).find(Boolean) || '';
  const imgHtml = front
    ? cardTurnableHtml(
        `<img class="card-detail-img card-img" src="${front}" alt="${esc(card.name)}">`,
        scryfallBackFace(card))
    : `<div class="card-detail-img card-detail-img-ph">No image</div>`;

  /* Both faces' text stays, and stays unturned. The picture shows one side at
     a time because a card does; the oracle text of a transforming card is
     something you read both halves of at once, to see what it becomes. */
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

  const rId = `${hostId}-rulings`;
  const pId = `${hostId}-prints`;
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
    <!-- Rulings are prose and take the reading measure; the printings below
         them are a grid of card images and take the full width (§8.3). -->
    <div class="card-detail-section content-prose" id="${rId}"><div class="section-title">Rulings</div><div class="help-text">Loading rulings…</div></div>
    <div class="card-detail-section" id="${pId}"><div class="section-title">Other Printings &amp; Alt-Art</div><div class="help-text">Loading printings…</div></div>
  `;

  // Rulings + printings load async (independent of each other)
  loadRulings(card, seq, rId);
  loadPrints(card, seq, pId);
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

// Legality is a status, so it is drawn in the status colours (§7.9): legal is
// success, restricted is warning, banned is danger, and a format the card was
// simply never printed for is none of those — it is the absent case, and
// colouring five greyed formats red on a typical card would say "error" seven
// times a page. The two loud states also say the word, since a badge whose
// meaning is carried by hue alone is unreadable to anyone who cannot see it.
const LEGAL_STATUS = {
  legal:      { cls: 'leg-legal',      note: '' },
  restricted: { cls: 'leg-restricted', note: 'restricted' },
  banned:     { cls: 'leg-banned',     note: 'banned' },
};
const LEGAL_NONE = { cls: 'leg-none', note: '' };

function cardLegalitiesHtml(legalities) {
  if (!legalities) return '';
  const formats = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper'];
  const pills = formats.map(fmt => {
    const status = legalities[fmt] || 'not_legal';
    const { cls, note } = LEGAL_STATUS[status] || LEGAL_NONE;
    const label = note ? `${fmt} · ${note}` : fmt;
    return `<span class="card-legal ${cls}" title="${esc(fmt)}: ${esc(status.replace('_', ' '))}">${esc(label)}</span>`;
  }).join('');
  return `<div class="card-legalities">${pills}</div>`;
}

async function loadRulings(card, seq, sectionId = 'cardDetail-rulings') {
  const el = document.getElementById(sectionId);
  if (!card.rulings_uri) { if (el) el.style.display = 'none'; return; }
  let rulings = [];
  try {
    const res = await scryfallFetch(card.rulings_uri);
    if (res.ok) rulings = (await res.json()).data || [];
  } catch {}
  if (seq !== _cardReqSeq || !el) return;
  if (!rulings.length) {
    el.innerHTML = `<div class="section-title">Rulings</div><div class="help-text">No rulings for this card.</div>`;
    return;
  }
  // A dated list, not a two-column table (§9.6): the date belongs to the
  // ruling rather than beside it, and a date column would take a fifth of the
  // measure away from the only part anyone reads.
  el.innerHTML = `<div class="section-title">Rulings (${rulings.length})</div>` +
    `<dl class="card-rulings">` + rulings.map(r => `
      <dt class="card-ruling-date">${esc((r.published_at || '').slice(0, 10))}</dt>
      <dd class="card-ruling-text">${cardOracleHtml(r.comment)}</dd>`).join('') + `</dl>`;
}

/* A printing, as the deck records one: the trimmed snapshot specified in
   docs/design/spec-printings.md, taken on the day it was chosen.
 *
 * The seven fields in that order and nothing else, and a field that is missing
 * stays missing. Both halves of that matter and neither is tidiness. The order
 * is because the deck's history decides whether a state has changed by
 * serialising it, and the same seven keys in two orders are two states — a row
 * in the History panel for a change nobody made. The absence is the rule the
 * deck's total already lives by: a printing Cardmarket has no price for is
 * unknown, and unknown is not free.
 *
 * available-db.js's readPrinting() is the same shape from the other side, and
 * has to be: what the browser sends here is what the column stores, and a
 * snapshot the server would have trimmed differently is a deck that changes
 * the moment it is saved.
 *
 * The day is an argument so that what a snapshot says about itself can be
 * asserted; nothing but a test passes one. */
function cardPrintingSnapshot(print, today = new Date().toISOString().slice(0, 10)) {
  if (!print?.id) return null;
  const from = {
    id:               print.id,
    set:              print.set,
    set_name:         print.set_name,
    collector_number: print.collector_number,
    // The picture the mat will draw. A two-faced printing is its front, as
    // every other picture of one in the app is.
    image:            print.image_uris?.normal || print.card_faces?.[0]?.image_uris?.normal,
    price_eur:        print.prices?.eur,
    chosen_at:        today,
  };
  const snapshot = {};
  for (const field of ['id', 'set', 'set_name', 'collector_number', 'image', 'price_eur', 'chosen_at']) {
    if (typeof from[field] === 'string' && from[field] !== '') snapshot[field] = from[field];
  }
  return snapshot;
}

/* The gallery, as markup. A function of what it is handed and nothing else —
   no deck is read here, the way the card menu's entries read none — so that
   the question worth asking about it can be asked without a browser: given
   these printings and this situation, what is on offer and what does pressing
   one do?

   `currentId` is the printing that is ringed. Outside a deck that is the one
   you are looking at, which is what the ring has always meant here; inside one
   it is the printing the deck runs, which is the same fact pointed at
   something else — the tile with the ring is the one you already have.

   `forDeck` is what turns a gallery into a chooser. It adds the price, because
   what a printing costs is part of choosing one and no part of browsing them,
   and it changes what a press does. */
function cardPrintsHtml(prints, { currentId = '', forDeck = null } = {}) {
  return prints.map(p => {
    const img = p.image_uris?.normal || p.image_uris?.large || p.card_faces?.[0]?.image_uris?.normal;
    const isCurrent = p.id === currentId;
    const label = `${esc(p.set_name)} #${esc(p.collector_number || '')}`;
    /* A press on the tile is the choice, rather than a second control in its
       corner: arriving from a deck changes what the gallery is for, so the
       tile does the thing you came to do. */
    const press = forDeck ? `cardChoosePrinting('${p.id}')` : `openCardById('${p.id}')`;
    const title = forDeck ? `Run ${label} in ${esc(forDeck.deckName || 'this deck')}` : label;
    return `<button class="card-print-tile${isCurrent ? ' current' : ''}" onclick="${press}" title="${title}">
      ${img ? `<img class="card-img" loading="lazy" src="${img}" alt="${esc(p.set_name)}">` : `<div class="card-print-ph"></div>`}
      <span class="card-print-set">${(p.set || '').toUpperCase()} · #${esc(p.collector_number || '')}</span>
      ${forDeck ? `<span class="card-print-price">${p.prices?.eur ? `€${esc(p.prices.eur)}` : '—'}</span>` : ''}
    </button>`;
  }).join('');
}

/** The whole section: what it is, who it is for, and the tiles.
 *
 *  The em dash is a printing nobody is selling rather than one that is free,
 *  and it is drawn rather than left blank because a tile with a gap where the
 *  others have a number reads as a tile that has not finished loading. */
function cardPrintsSectionHtml(prints, opts = {}) {
  const { forDeck = null } = opts;
  // The app's own card grid (§9.6), so the gallery is sized like every other
  // grid of card images rather than by a number written for this tab alone.
  return `<div class="section-title">Other Printings &amp; Alt-Art (${prints.length})</div>
    ${forDeck ? `<div class="help-text">Press one to run it in <strong>${esc(forDeck.deckName || 'this deck')}</strong>. The ring is the printing it runs now.</div>` : ''}
    <div class="card-grid">${cardPrintsHtml(prints, opts)}</div>`;
}

/* The gallery, drawn where it stands. Called once when the printings arrive and
   again after a press, because the ring has moved and the ring is the modal's
   half of the answer — the mat behind it is the deck's.
 *
 * What the deck runs is asked of the deck each time rather than remembered:
 * this is the same question the press asks, and asking it in one way is what
 * keeps the ring and the deck from disagreeing. */
function _cardPaintPrints() {
  const el = document.getElementById(_cardPrintsAt);
  if (!el || !_cardPrintCard) return;
  const chosen = _cardForDeck ? dbPrintingFor(_cardForDeck) : null;
  el.innerHTML = cardPrintsSectionHtml(_cardPrints, {
    currentId: chosen?.id || _cardPrintCard.id,
    forDeck:   _cardForDeck,
  });
}

/* One press, from a gallery that is choosing for a deck.
 *
 * The deck is checked again here, inside dbChoosePrinting(), rather than
 * trusted from when the gallery was drawn: the modal may have stood open while
 * the deck was closed, or another one opened, or this very card taken out. A
 * press in any of those situations does nothing at all — including moving the
 * ring, because a ring that moved would be the card detail claiming a choice
 * the deck never made. */
function cardChoosePrinting(id) {
  if (!_cardForDeck) return false;
  const printing = cardPrintingSnapshot(_cardPrints.find(p => p.id === id));
  if (!printing || !dbChoosePrinting(_cardForDeck, printing)) return false;
  _cardPaintPrints();
  return true;
}

async function loadPrints(card, seq, sectionId = 'cardDetail-prints') {
  const el = document.getElementById(sectionId);
  if (!card.prints_search_uri) { if (el) el.style.display = 'none'; return; }
  let prints = [];
  try {
    const res = await scryfallFetch(card.prints_search_uri);
    if (res.ok) prints = (await res.json()).data || [];
  } catch {}
  if (seq !== _cardReqSeq || !el) return;
  if (!prints.length) { el.style.display = 'none'; return; }

  _cardPrints    = prints;
  _cardPrintCard = card;
  _cardPrintsAt  = sectionId;
  _cardPaintPrints();
}
