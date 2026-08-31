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
    ${cardShelfSectionHtml(card.name)}
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

// ── What of this card is on the shelf ─────────────────────────────────────
/* Which printings of this card are held, and how many of each.
 *
 * The Collections table answers the same question in one line of a row
 * somebody is scanning past — `2× C21, 1× STA ✦` — and that is all a row has
 * room to be. This is where the detailed answer lives, which is why it lives
 * *here*: the card is already where a printing is looked at properly and
 * already where one is chosen for a deck, so the printings you have and the
 * printings there are stand one above the other.
 *
 * It reads the shelf through js/deckview-owned.js, and that is the point
 * rather than a borrowing. There is one rule in this app about whose shelf is
 * whose — yours, the group's, everyone's — and the mark on a card in a deck,
 * the count above it and this list all have to be answering the same
 * question, or the card contradicts the mat that opened it.
 *
 * Drawn from state as the card is drawn, rather than fetched: every copy of
 * this is already in the browser. A shelf that changes while the card stands
 * open is not redrawn, which is the same bargain the rest of the detail makes
 * — it is a card as it was when you opened it. */

/** The copies in scope, ordered for reading: the ones nobody attributed last,
 *  because they are the answer that is not an edition, and the rest heaviest
 *  first. Ties go by set and number so a redraw does not shuffle them. */
function cardShelfHeld(name) {
  const key = p => `${p.set || ''} ${p.collector_number || ''}`;
  return dbOwnedPrintings(name).sort((a, b) =>
    (!namesPrinting(a)) - (!namesPrinting(b)) ||
    b.qty - a.qty ||
    key(a).localeCompare(key(b)));
}

/* Whose shelf the list just answered for, said under the heading. A number of
 * copies that does not say whose is a number somebody will read as the whole
 * playgroup's — and with nobody to be there is no "mine" to narrow to, which
 * is dbOwnShelf() handing back every loaded collection and is said as such
 * rather than as the group's. */
function cardShelfScope() {
  const id = myPlayerId() ? dbOwnScope() : 'all';
  return DB_OWN_SCOPES.find(s => s.id === id) || DB_OWN_SCOPES[0];
}

/** One line: how many, and of what.
 *
 *  The unattributed copies are counted like any other line and named as what
 *  they are. A shelf that has not been re-imported holds every copy of every
 *  card in this state, so drawing it as a shorter list — or as no list — is
 *  the app telling somebody their collection is empty. */
function cardShelfRowHtml(p) {
  const qty = `<span class="card-shelf-qty">${p.qty}×</span>`;
  if (!namesPrinting(p)) {
    return `<li class="card-shelf-row">${qty}
      <span class="print-unknown" title="Nobody recorded which printings these copies are">unknown printing</span></li>`;
  }
  /* The set's own name and the code the rest of the app says it by, because
     this is the page with room for both — and the code alone where a shelf
     recorded one without the other, rather than "C21 (C21)". A shelf that
     knows the printing by its set and number and not by a Scryfall id — every
     row of a Moxfield export — has only the code, and says it. */
  const set  = (p.set || '').toUpperCase();
  const said = p.set_name ? `${esc(p.set_name)}${set ? ` (${esc(set)})` : ''}`
             : set ? esc(set) : 'Unknown set';
  const finish = p.finish && p.finish !== CARD_ORDINARY_FINISH ? p.finish : '';
  return `<li class="card-shelf-row">${qty}
    <span class="card-shelf-print">${said}${p.collector_number ? ` #${esc(p.collector_number)}` : ''}</span>${
    finish ? `<span class="card-shelf-finish" title="${esc(finish)}">${esc(cardFinishMark(finish))}</span>` : ''}</li>`;
}

/* Nothing in scope, which is two different pieces of news. Nobody at all has
   the card, or you do not and somebody else does — and the second is the
   sentence the badges on the mat already make: an empty answer scoped to you
   is not "nobody has this", and the person who does is the point. */
function cardShelfNoneHtml(name) {
  const holders = dbHoldersOf(name);
  if (!holders.length) return `<div class="help-text card-shelf-note">No copies on the shelf.</div>`;
  return `<div class="help-text card-shelf-note">No copies on the shelf — somebody else has one.</div>
    <div class="card-shelf-elsewhere">${holders.map(h => `
      <span class="sf-badge db-badge-elsewhere" style="border-color:${h.ink}"
        title="${esc(`${h.who} — ${h.collection} ×${h.qty}`)}">
        <span class="sf-dot" style="background:${h.ink}"></span>
        ${esc(h.who)} ×${h.qty}
      </span>`).join('')}</div>`;
}

/** The section, or nothing at all where there is no shelf to answer about —
 *  an app nobody has loaded a collection into has no shelf, and a card that
 *  said "no copies" there would be reporting an absence of collections as a
 *  fact about the card. */
function cardShelfSectionHtml(name) {
  if (!(state.collections || []).some(c => c.status === 'loaded')) return '';
  const held  = cardShelfHeld(name);
  const total = held.reduce((n, p) => n + p.qty, 0);
  return `<div class="card-detail-section content-prose card-shelf">
    <div class="section-title">On the shelf${total ? ` (${total})` : ''}</div>
    <div class="help-text card-shelf-scope">${esc(cardShelfScope().hint)}</div>
    ${held.length ? `<ul class="card-shelf-list">${held.map(cardShelfRowHtml).join('')}</ul>`
                  : cardShelfNoneHtml(name)}</div>`;
}

/* Which finishes a printing was made in, and what each of them is worth.
 *
 * A foil is not a printing of its own in Scryfall's model: one id carries a
 * `finishes` list and a price per finish, so "the foil Sol Ring" is a printing
 * *and* a finish, and a deck that could not say the second could not say which
 * of the two it runs.
 *
 * The ordinary finish is the absence. nonfoil is what a card is unless somebody
 * says otherwise, and written down it would be a default value sitting beside
 * printings chosen before the field existed, which carry nothing — two
 * spellings of one card, and the History panel calls the difference a change.
 * available-db.js's readPrinting() drops it on the way in for the same reason. */
const CARD_ORDINARY_FINISH = 'nonfoil';

/** The finishes a printing can be run in, named as the snapshot names them —
 *  the empty string for the ordinary one. A printing that does not say was only
 *  ever made the ordinary way, which is what saying nothing means everywhere
 *  else here too. */
function cardPrintFinishes(print) {
  const made = Array.isArray(print?.finishes) && print.finishes.length
    ? print.finishes : [CARD_ORDINARY_FINISH];
  return made.map(finish => (finish === CARD_ORDINARY_FINISH ? '' : finish));
}

/** What Cardmarket quotes this printing in this finish at. Each finish has a
 *  price field of its own, and one nobody has quoted is unknown — never the
 *  price of the finish standing next to it, which is a different card to buy. */
const cardFinishPrice = (print, finish) =>
  (finish ? print?.prices?.[`eur_${finish}`] : print?.prices?.eur);

/** How a finish is said on a tile: the foil's mark, which is the one the
 *  Collections table already reads as foil, and the word itself for the rarer
 *  ones nobody has a symbol for. */
const cardFinishMark = finish =>
  (finish ? (finish === 'foil' ? ' ✦' : ` ${finish}`) : '');

/* A printing, as the deck records one: the trimmed snapshot specified in
   docs/design/spec-printings.md, taken on the day it was chosen.
 *
 * The eight fields in that order and nothing else, and a field that is missing
 * stays missing. Both halves of that matter and neither is tidiness. The order
 * is because the deck's history decides whether a state has changed by
 * serialising it, and the same eight keys in two orders are two states — a row
 * in the History panel for a change nobody made. The absence is the rule the
 * deck's total already lives by: a printing Cardmarket has no price for is
 * unknown, and unknown is not free.
 *
 * The finish comes in on the printing rather than as an argument of its own,
 * because what is being snapshotted is the pair — this printing, in this
 * finish — and that pair is what a tile is. Scryfall's own record has no such
 * field, so nothing is being overwritten by putting it there.
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
  const finish = print.finish === CARD_ORDINARY_FINISH ? '' : (print.finish || '');
  const from = {
    id:               print.id,
    set:              print.set,
    set_name:         print.set_name,
    collector_number: print.collector_number,
    // The picture the mat will draw. A two-faced printing is its front, as
    // every other picture of one in the app is. Both finishes of a printing
    // are the same picture: what a foil costs differs, what it looks like
    // is not something Scryfall has a second scan of.
    image:            print.image_uris?.normal || print.card_faces?.[0]?.image_uris?.normal,
    price_eur:        cardFinishPrice(print, finish),
    chosen_at:        today,
    finish,
  };
  const snapshot = {};
  for (const field of ['id', 'set', 'set_name', 'collector_number', 'image',
                       'price_eur', 'chosen_at', 'finish']) {
    if (typeof from[field] === 'string' && from[field] !== '') snapshot[field] = from[field];
  }
  return snapshot;
}

/* The gallery, as markup. A function of what it is handed and nothing else —
   no deck is read here, the way the card menu's entries read none — so that
   the question worth asking about it can be asked without a browser: given
   these printings and this situation, what is on offer and what does pressing
   one do?

   `currentId` and `currentFinish` are the tile that is ringed. Outside a deck
   that is the printing you are looking at, which is what the ring has always
   meant here; inside one it is the printing the deck runs, which is the same
   fact pointed at something else — the tile with the ring is the one you
   already have. Both halves have to match, because the foil beside the card
   the deck runs is a card the deck does not run.

   `forDeck` is what turns a gallery into a chooser. It adds the price, because
   what a printing costs is part of choosing one and no part of browsing them;
   it splits a printing into one tile per finish, for the same reason twice
   over — a foil is a different thing to run and a different thing to pay for,
   and the same thing to look at; and it changes what a press does. */
function cardPrintsHtml(prints, { currentId = '', currentFinish = '', forDeck = null } = {}) {
  return prints.flatMap(p => {
    const img = p.image_uris?.normal || p.image_uris?.large || p.card_faces?.[0]?.image_uris?.normal;
    const label = `${esc(p.set_name)} #${esc(p.collector_number || '')}`;
    const finishes = forDeck ? cardPrintFinishes(p) : [''];
    /* Which of this printing's tiles the ring would go on. The finish the deck
       named, and the first tile when it named one this printing does not come
       in — a card sold only as a foil is one tile, and a deck that chose it
       before the field existed named no finish at all. The ring says "this is
       the printing you run", so it belongs somewhere rather than nowhere. */
    const ringAt = Math.max(finishes.indexOf(currentFinish), 0);
    return finishes.map((finish, i) => {
      const isCurrent = p.id === currentId && i === ringAt;
      const price = cardFinishPrice(p, finish);
      /* A press on the tile is the choice, rather than a second control in its
         corner: arriving from a deck changes what the gallery is for, so the
         tile does the thing you came to do. The ordinary finish is not named
         in the press, as it is not named in the snapshot the press takes. */
      const press = forDeck
        ? `cardChoosePrinting('${p.id}'${finish ? `, '${jsAttr(finish)}'` : ''})`
        : `openCardById('${p.id}')`;
      const named = finish ? `${label} (${esc(finish)})` : label;
      const title = forDeck ? `Run ${named} in ${esc(forDeck.deckName || 'this deck')}` : label;
      return `<button class="card-print-tile${isCurrent ? ' current' : ''}" onclick="${press}" title="${title}">
      ${img ? `<img class="card-img" loading="lazy" src="${img}" alt="${esc(p.set_name)}">` : `<div class="card-print-ph"></div>`}
      <span class="card-print-set">${(p.set || '').toUpperCase()} · #${esc(p.collector_number || '')}${cardFinishMark(finish)}</span>
      ${forDeck ? `<span class="card-print-price">${price ? `€${esc(price)}` : '—'}</span>` : ''}
    </button>`;
    });
  }).join('');
}

/** The whole section: what it is, who it is for, and the tiles.
 *
 *  The em dash is a printing nobody is selling rather than one that is free,
 *  and it is drawn rather than left blank because a tile with a gap where the
 *  others have a number reads as a tile that has not finished loading. */
function cardPrintsSectionHtml(prints, opts = {}) {
  const { forDeck = null } = opts;
  /* The count is of printings and the tiles are of printings in a finish, so a
     card made in foil has more tiles than the heading says. Said out loud in
     the line below rather than counted differently: the section is a list of
     what else this card has been printed as, and a foil is the same printing. */
  // The app's own card grid (§9.6), so the gallery is sized like every other
  // grid of card images rather than by a number written for this tab alone.
  return `<div class="section-title">Other Printings &amp; Alt-Art (${prints.length})</div>
    ${forDeck ? `<div class="help-text">Press one to run it in <strong>${esc(forDeck.deckName || 'this deck')}</strong>. The ring is the printing it runs now, and a printing sold in more than one finish has a tile for each.</div>` : ''}
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
    /* A deck that has chosen nothing is running the printing the app picks, in
       the finish a card is unless somebody says otherwise — so the ring lands
       on the ordinary tile, never on the foil beside it. */
    currentFinish: chosen?.finish || '',
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
function cardChoosePrinting(id, finish = '') {
  if (!_cardForDeck) return false;
  const print = _cardPrints.find(p => p.id === id);
  const printing = print && cardPrintingSnapshot({ ...print, finish });
  if (!printing || !dbChoosePrinting(_cardForDeck, printing)) return false;
  _cardPaintPrints();
  return true;
}

/** Every printing behind a `prints_search_uri`, to the end of the pages.
 *
 *  Scryfall pages a search at 175 cards and says so with `has_more`, and a
 *  loader that took the first page and stopped was silently telling somebody
 *  that a card comes in fewer printings than it does — the alt-art you are
 *  looking for simply not there, with nothing on screen to say a page was
 *  dropped. Which is a gallery bug and, since the printing optimiser reads the
 *  same list, a pool cut off at 175 candidates too. One loader, so the two
 *  cannot come to disagree about what printings a card has.
 *
 *  A page that fails ends the walk rather than failing the lot: the printings
 *  that did arrive are a shorter answer, and no answer at all is a worse one. */
async function cardAllPrints(url) {
  const out = [];
  let next = url;
  while (next) {
    let page;
    try {
      const res = await scryfallFetch(next);
      if (!res.ok) break;
      page = await res.json();
    } catch { break; }
    out.push(...(page.data || []));
    next = page.has_more ? page.next_page : null;
  }
  return out;
}

async function loadPrints(card, seq, sectionId = 'cardDetail-prints') {
  const el = document.getElementById(sectionId);
  if (!card.prints_search_uri) { if (el) el.style.display = 'none'; return; }
  const prints = await cardAllPrints(card.prints_search_uri);
  if (seq !== _cardReqSeq || !el) return;
  if (!prints.length) { el.style.display = 'none'; return; }

  _cardPrints    = prints;
  _cardPrintCard = card;
  _cardPrintsAt  = sectionId;
  _cardPaintPrints();
}
