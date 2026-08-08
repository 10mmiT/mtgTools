// ── Deck Builder — Panels: search, autocomplete, drag-drop, EDHREC, import/export ─────────────────────────────────────────
// Split from the former monolithic deckview.js. All deck-builder scripts share
// one global scope (classic scripts), so state declared in deckview-core.js is
// visible here and functions stay global for inline onclick handlers.

// ── Autocomplete: add-card input ──────────────────────────────────────────────
function dbAddAcInput() {
  clearTimeout(dbAddAcTimer);
  const q = document.getElementById('dbAddCardInput')?.value.trim();
  if (q.length < 2) { closeDbAddAc(); return; }
  dbAddAcTimer = setTimeout(async () => {
    try {
      const names = (await cardAutocomplete(q)).slice(0, 8);
      const drop  = document.getElementById('dbAddAcDrop');
      if (!names.length || !drop) { closeDbAddAc(); return; }
      drop.innerHTML = names.map(n =>
        `<div class="ac-item" onclick="pickDbAddAc('${jsAttr(n)}')">${esc(n)}</div>`).join('');
      drop.style.display = 'block';
    } catch { closeDbAddAc(); }
  }, 280);
}

function pickDbAddAc(name) {
  const input = document.getElementById('dbAddCardInput');
  if (input) input.value = name;
  closeDbAddAc();
  input?.focus();
}

function closeDbAddAc() {
  const d = document.getElementById('dbAddAcDrop');
  if (d) d.style.display = 'none';
}

// ── Autocomplete: search input ────────────────────────────────────────────────
function dbAcInput() {
  clearTimeout(dbAcTimer);
  const q = document.getElementById('dbSearchInput')?.value.trim();
  if (q.length < 2) { closeDbAc(); return; }
  dbAcTimer = setTimeout(async () => {
    try {
      const names = (await cardAutocomplete(q)).slice(0, 8);
      const drop  = document.getElementById('dbAcDrop');
      if (!names.length || !drop) { closeDbAc(); return; }
      drop.innerHTML = names.map(n =>
        `<div class="ac-item" onclick="pickDbAc('${jsAttr(n)}')">${esc(n)}</div>`).join('');
      drop.style.display = 'block';
    } catch { closeDbAc(); }
  }, 280);
}

function pickDbAc(name) {
  const input = document.getElementById('dbSearchInput');
  if (input) input.value = name;
  closeDbAc();
  dbSearch();
}

function closeDbAc() {
  const d = document.getElementById('dbAcDrop');
  if (d) d.style.display = 'none';
}

// ── Autocomplete: commander input (in new deck modal) ─────────────────────────
function dbCmdAcInput() {
  clearTimeout(dbCmdAcTimer);
  const q = document.getElementById('dbNewDeckCommander')?.value.trim();
  if (q.length < 2) { _closeDbCmdAc(); return; }
  dbCmdAcTimer = setTimeout(async () => {
    try {
      const names = (await cardAutocomplete(q, { commander: true })).slice(0, 8);
      const drop  = document.getElementById('dbCmdAcDrop');
      if (!names.length || !drop) { _closeDbCmdAc(); return; }
      drop.innerHTML = names.map(n =>
        `<div class="ac-item" onclick="pickDbCmdAc('${jsAttr(n)}')">${esc(n)}</div>`).join('');
      drop.style.display = 'block';
    } catch { _closeDbCmdAc(); }
  }, 280);
}

function pickDbCmdAc(name) {
  const input = document.getElementById('dbNewDeckCommander');
  if (input) input.value = name;
  _closeDbCmdAc();
}

function _closeDbCmdAc() {
  const d = document.getElementById('dbCmdAcDrop');
  if (d) d.style.display = 'none';
}

// Close all autocompletes when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('#dbAddCardInput') && !e.target.closest('#dbAddAcDrop')) closeDbAddAc();
  if (!e.target.closest('#dbSearchInput') && !e.target.closest('#dbAcDrop')) closeDbAc();
  if (!e.target.closest('#dbNewDeckCommander') && !e.target.closest('#dbCmdAcDrop')) _closeDbCmdAc();
});

// ── Scryfall search panel ─────────────────────────────────────────────────────
async function dbSearch() {
  const input = document.getElementById('dbSearchInput');
  let   q     = (input?.value || '').trim();
  if (!q) return;

  // Auto-inject colour identity filter for commander decks (if toggle enabled)
  const ciChecked = document.getElementById('dbCiToggle')?.checked;
  if (ciChecked && dbDeck?.commander && dbCardData.has(dbDeck.commander)) {
    const ci = dbCardData.get(dbDeck.commander).color_identity || [];
    if (ci.length && !/\b(ci:|id:)/.test(q)) {
      q = `${q} ci<=${ci.join('')}`;
    }
  }

  const resultsEl = document.getElementById('dbSearchResults');
  resultsEl.innerHTML = '<div class="empty-state" style="padding:var(--space-4)">Searching…</div>';

  /* Narrowed to what we own, the query goes to the shelf instead of to
     Scryfall. It is the same sentence either way — the local parser reads
     Scryfall's syntax, colour-identity injection and all — and that is the
     whole point of asking the shelf rather than filtering what came back from
     Scryfall: a page of results cut down to the three you happen to own reads
     as a search that is broken. */
  if (_dbSearchOwnScope()) return _dbSearchShelf(q, resultsEl);

  try {
    const res  = await scryfallFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=name&page=1`);
    const data = await res.json();
    if (data.object === 'error') {
      resultsEl.innerHTML = `<div class="error-msg" style="margin:var(--space-2) 0">${esc(data.details || data.warnings?.join(' ') || 'No results')}</div>`;
      return;
    }
    dbSrResults = data.data || [];
    // Cache Scryfall data for all returned cards
    for (const card of dbSrResults) {
      dbCardData.set(card.name, card);
      if (card.card_faces?.[0]?.name) dbCardData.set(card.card_faces[0].name, card);
    }
    _dbRenderSearch();
  } catch (e) {
    resultsEl.innerHTML = `<div class="error-msg" style="margin:var(--space-2) 0">${esc(e.message)}</div>`;
  }
}

/* ── Searching the shelf instead of Magic ──────────────────────────────────
 *
 * "Build only with cards you own", put at the point where it helps: you are
 * choosing what to *add*, and the honest form of that is a search of our
 * collections rather than a filter over somebody else's search results.
 *
 * Two scopes and not three: this box asks what can be added to a deck tonight,
 * and "every collection loaded" is what the box does with the narrowing off.
 * Which collections each of the two means is js/deckview-owned.js's answer, so
 * the drawer and the readout cannot disagree about whose shelf is whose. */
function _dbSearchOwnScope() {
  const v = document.getElementById('dbSearchOwned')?.value || '';
  return v === 'mine' || v === 'group' ? v : '';
}

/** The names on the shelf that scope names — every collection's cards, merged. */
function _dbShelfNames(scope) {
  const names = new Set();
  for (const col of dbOwnShelf(scope)) for (const name of col.cards.keys()) names.add(name);
  return [...names];
}

/* The local search itself. Two passes over the shelf, and they are two
 * different caches on purpose: the *filtering* reads scryfallMetaCache, which
 * the Collections tab fills and which holds the facts a query asks about, so a
 * shelf that has been searched once on the other tab answers instantly here.
 * Only what survives the filter is then fetched as whole cards, because that
 * is what has pictures and prices on it and the shelf may be five thousand
 * cards long. */
async function _dbSearchShelf(q, resultsEl) {
  let query;
  try {
    query = parseCardQuery(q);
  } catch (e) {
    resultsEl.innerHTML = `<div class="error-msg" style="margin:var(--space-2) 0">${esc(e.message)}${CQ_SYNTAX_HELP}</div>`;
    return;
  }

  const names = _dbShelfNames(_dbSearchOwnScope());
  if (!names.length) {
    dbSrResults = [];
    resultsEl.innerHTML = `<div class="empty-state" style="padding:var(--space-4)">
      No collections on that shelf yet — add one on the Collections tab.</div>`;
    return;
  }

  /* Every name's facts before a query that reads them can be trusted: a filter
     run over half a cache is not a narrower answer, it is a wrong one. This is
     colQueryMetaReady()'s rule in js/collections.js, awaited here rather than
     answered by re-rendering, because this box is pressed rather than typed
     into. */
  await ensureScryfallImages(names);
  const hits = query
    ? names.filter(n => query.match({ name: n, ...(scryfallMetaCache.get(n) || {}), owned: true }))
    : names;
  hits.sort((a, b) => a.localeCompare(b));

  const shown = hits.slice(0, DB_SHELF_RESULTS);
  await dbFetchCardData(shown);
  dbSrResults = shown.map(n => dbCardData.get(n)).filter(Boolean);
  _dbRenderSearch(hits.length > shown.length
    ? `${hits.length} on the shelf — showing the first ${shown.length}`
    : '');
}

/* A page of results, which is what Scryfall hands back and therefore what this
 * panel is built to draw. The shelf can be thousands long and the answer to
 * that is a narrower query, not a longer scroll. */
const DB_SHELF_RESULTS = 175;

function _dbRenderSearch(note = '') {
  const el = document.getElementById('dbSearchResults');
  if (!dbSrResults.length) {
    el.innerHTML = `<div class="empty-state" style="padding:var(--space-4)">${
      _dbSearchOwnScope() ? 'Nothing on that shelf matches' : 'No results'}</div>`;
    return;
  }
  const noteHtml = note
    ? `<div class="help-text db-sr-note">${esc(note)}</div>` : '';
  const canAdd = !!(dbDeck && isMyPlayer(dbDeck.playerId));
  el.innerHTML = noteHtml + dbSrResults.map(card => {
    const face  = card.card_faces?.[0];
    const mana  = card.mana_cost || face?.mana_cost || '';
    const type  = card.type_line || face?.type_line || '';
    const img   = card.image_uris?.small || face?.image_uris?.small || '';
    const price = renderPrice(card);
    /* "Already in deck" means in the deck: a card you have set aside in the
       maybeboard is one you have not put in, and the ✓ would be telling you
       otherwise. */
    const inDeck = dbMainCards().some(c => c.card_name === card.name);
    const addBtn = canAdd
      ? `<button class="db-add-btn${inDeck ? ' db-add-btn-in' : ''}"
           onclick="dbAddCard('${jsAttr(card.name)}')" title="${inDeck ? 'Already in deck' : 'Add to deck'}">
           ${inDeck ? '✓' : '+'}
         </button>` : '';
    return `<div class="db-sr-row">
      ${img ? `<a href="#" class="card-open" data-name="${esc(card.name)}">
        <img class="db-sr-thumb card-img" src="${img}" alt="${esc(card.name)}"></a>` : ''}
      <div class="db-sr-info">
        <div class="db-sr-name">
          <a class="card-link" href="#" data-name="${esc(card.name)}">${esc(card.name)}</a>
          ${mana ? renderMana(mana) : ''}
        </div>
        <div class="db-sr-type">${esc(type)}</div>
        <div class="db-sr-foot">${price}${wantBtnHtml(card.name)}</div>
      </div>
      ${addBtn}
    </div>`;
  }).join('');
}

// ── Search drawer ─────────────────────────────────────────────────────────────
function dbOpenSearchPanel() {
  document.getElementById('dbSearchPanel')?.classList.add('open');
  document.getElementById('dbSearchBackdrop')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function dbCloseSearchPanel() {
  document.getElementById('dbSearchPanel')?.classList.remove('open');
  document.getElementById('dbSearchBackdrop')?.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Cards carried to another pile ────────────────────────────────────────────
// What a card released on a pile means, and which cards a card picked up
// brings with it: the two questions js/carddrag.js asks the mat and refuses to
// answer for it. Everything about how cards are picked up, followed, leaned,
// fanned and landed is there; what is here is that on this tab a pile is a
// category and putting cards on one moves them in — through the same
// dbMoveCardsTo() the "Move to…" modal and the bulk bar call, so the category
// assignment and the autosave have one implementation and not three.
//
// The answer matters as much as the move: false means nothing happened — the
// cards are already in that category, or the deck is not mine to edit — and
// cards that were not taken are cards that have to travel back to where they
// were picked up from. Only the carry knows how to do that, so only the carry
// is told whether it needs to.

/* Which cards come with the one being picked up, which is the whole of what
   multi-select means to a drag: a card that is part of the selection carries
   the selection, and any other card carries itself. Picking one card up is
   never a way to move twenty by accident — that takes selecting them first,
   which is a thing you can see you have done. */
function cardCarryHandful(ref) {
  return dbSelectedCards.has(ref) ? [...dbSelectedCards] : [ref];
}

/* Released on the ghost pile: the category is made here, and the cards go
 * straight into it. The one route into a category that does not exist yet —
 * before this, cardCarryDrop() would only take a pile the mat was already
 * drawing, so the only way to make one was the modal.
 *
 * The pile is real before it is named. Its cards have landed, the deck has been
 * saved, and what is left open is a name box: a category with a placeholder
 * name is a category, where a category with no name yet would be a state every
 * other thing that reads dbCats would have to know about.
 *
 * Nothing moved is nothing happened, and that has to include the category —
 * an empty pile nobody asked for, left standing on the mat with a name box
 * open in it, is a worse outcome than the drop that failed. */
function _dbDropOnGhost(refs) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return false;
  const name = _dbNewCategoryName();
  dbCats.push({ name, position: dbCats.length });

  const held = refs.filter(ref => dbSelectedCards.has(ref));
  for (const ref of held) dbSelectedCards.delete(ref);

  const place = dbPlace(DB_MAIN_BOARD, name);
  _dbNamingCat   = name;
  _dbLandedCards = _dbLandingRefs(refs, place);
  const moved = dbMoveCardsTo(refs, place);
  _dbLandedCards = null;

  if (!moved) {
    dbCats = dbCats.filter(cat => cat.name !== name);
    _dbNamingCat = null;
    for (const ref of held) dbSelectedCards.add(ref);
  }
  return moved;
}

/* Which cards the next render draws landing — the refs they will have *after*
 * the move, not the ones they were carried by. A card crossing from the
 * maybeboard into the deck is a different card on the mat when it gets there,
 * and a landing keyed to where it came from would flourish nothing. */
function _dbLandingRefs(refs, place) {
  const { board } = dbReadPlace(place);
  return new Set(refs.map(ref => dbPlace(board, dbReadRef(ref).name)));
}

function cardCarryDrop(refs, place) {
  const { board, category } = dbReadPlace(place);
  /* The pile with no name on it yet is the one place a drop *makes* something
     rather than moving cards between things that already exist. */
  if (board === DB_MAIN_BOARD && category === DB_GHOST_PILE) return _dbDropOnGhost(refs);
  /* A settled pile draws no cards — it is one stack standing for the whole
     category — so a card put into one would have nowhere to land: it would
     vanish out of the hand and a number under a stack would go up. Spreading
     the pile it was put into gives the cards somewhere to land and answers the
     question the drop asks, which is "where did they go?". Unlike a pile
     spreading itself, this is the direct result of an action aimed at that
     pile, and the arrow settles it again. Piles arrive spread, so this is the
     one that was settled on purpose and is being reopened. A board never
     settles, so a drop on one has nothing to reopen. */
  if (dbView === 'pile' && category !== null) dbSettledCats.delete(category);
  /* A selection carried somewhere is a selection spent, the way it is spent by
     the bulk bar's move: these cards have just been put where they were wanted,
     and leaving them lit afterwards would make the next click on the mat act on
     a handful nobody is still holding. Cleared before the move, because the
     selection is drawn on the cards and the move's render is the one that draws
     them in their new pile. */
  const held = refs.filter(ref => dbSelectedCards.has(ref));
  for (const ref of held) dbSelectedCards.delete(ref);
  /* The one render that draws these cards in their new pile draws them landing.
     Set around the move rather than inside it because it is true of this
     caller and not of the modal: a card chosen from a list was never in
     anybody's hand. */
  _dbLandedCards = _dbLandingRefs(refs, place);
  const moved = dbMoveCardsTo(refs, place);
  _dbLandedCards = null;
  /* Nothing moved is nothing happened, and that has to include the selection:
     the cards are on their way back to where they were picked up from, and
     they go back selected. Nothing has been drawn in between, so putting them
     back costs no render. */
  if (!moved) for (const ref of held) dbSelectedCards.add(ref);
  return moved;
}

// ── Left panel tabs ───────────────────────────────────────────────────────────
function dbSetLeftTab(tab) {
  dbLeftTab = tab;
  document.getElementById('db-ltab-search')?.classList.toggle('active', tab === 'search');
  document.getElementById('db-ltab-edhrec')?.classList.toggle('active', tab === 'edhrec');
  document.getElementById('db-left-search').style.display  = tab === 'search'  ? '' : 'none';
  document.getElementById('db-left-edhrec').style.display  = tab === 'edhrec'  ? '' : 'none';

  if (tab === 'edhrec' && !_dbEdhrecLoaded) {
    dbLoadEdhrec();
  }
}

// ── EDHREC panel ──────────────────────────────────────────────────────────────
async function dbLoadEdhrec() {
  /* Off the commander board, and off the deck record when the board is empty —
     the same order this asked in when the commander was a category, with the
     board in the category's place. A deck with partners is looked up under the
     first of them: EDHREC is asked about one commander. */
  const commanderName = dbCommanderCards()[0]?.card_name || dbDeck?.commander;
  const el = document.getElementById('dbEdhrecContent');
  if (!commanderName) {
    el.innerHTML = '<div class="empty-state" style="padding:var(--space-6) 0">Put a card on the commander board to see EDHREC recommendations</div>';
    return;
  }
  _dbEdhrecLoaded = true;
  el.innerHTML = `<div class="empty-state" style="padding:var(--space-6) var(--space-4)">Loading EDHREC recommendations for ${esc(commanderName)}…</div>`;

  try {
    const res  = await fetch(`/api/edhrec/commander/${encodeURIComponent(commanderName)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const cardlists = data?.container?.json_dict?.cardlists || [];
    dbEdhrecData = cardlists;

    // Fetch Scryfall data for every recommended card so thumbnails can render
    const allNames = [...new Set(cardlists.flatMap(s => (s.cardviews || []).map(c => c.name)))];
    await dbFetchCardData(allNames);

    _dbRenderEdhrec();
  } catch (e) {
    el.innerHTML = `<div class="error-msg" style="margin:var(--space-2) 0">${esc(e.message)}</div>`;
  }
}

// EDHREC card-type tags merged the same way Archidekt buckets categories;
// order here drives display order (top picks first, then type sections).
const DB_EDHREC_SECTIONS = [
  { tags: ['highsynergycards'], header: 'High Synergy Cards' },
  { tags: ['topcards'],         header: 'Top Cards' },
  { tags: ['gamechangers'],     header: 'Game Changers' },
  { tags: ['newcards'],         header: 'New Cards' },
  { tags: ['creatures'],        header: 'Creatures' },
  { tags: ['planeswalkers'],    header: 'Planeswalkers' },
  { tags: ['instants'],         header: 'Instants' },
  { tags: ['sorceries'],        header: 'Sorceries' },
  { tags: ['enchantments'],     header: 'Enchantments' },
  { tags: ['manaartifacts', 'utilityartifacts'], header: 'Artifacts' },
  { tags: ['lands', 'utilitylands'], header: 'Lands' },
];
const DB_EDHREC_PER_SECTION = 36;

function _dbRenderEdhrec() {
  const el = document.getElementById('dbEdhrecContent');
  if (!dbEdhrecData?.length) {
    el.innerHTML = '<div class="empty-state" style="padding:var(--space-4)">No recommendations found</div>';
    return;
  }

  const canAdd  = !!(dbDeck && isMyPlayer(dbDeck.playerId));
  const byTag   = new Map(dbEdhrecData.map(s => [s.tag, s]));
  const sections = DB_EDHREC_SECTIONS
    .map(({ tags, header }) => {
      const seen  = new Set();
      const views = tags.flatMap(t => byTag.get(t)?.cardviews || [])
        .filter(c => !seen.has(c.name) && seen.add(c.name));
      const cards = views
          .filter(c => !dbMainCards().some(d => d.card_name === c.name))
          .slice(0, DB_EDHREC_PER_SECTION).map(c => {
        const sf     = dbCardData.get(c.name);
        const face   = sf?.card_faces?.[0];
        const img    = sf?.image_uris?.small || face?.image_uris?.small || '';
        const type   = sf?.type_line || face?.type_line || '';
        const synPct   = c.synergy != null ? `${Math.round(c.synergy * 100)}%` : '';
        const incCount = c.num_decks != null ? `${c.num_decks.toLocaleString()} decks` : '';
        const addBtn   = canAdd
          ? `<button class="db-add-btn"
               onclick="dbAddCard('${jsAttr(c.name)}')">+</button>` : '';
        return `<div class="db-edh-row">
          ${img ? `<a href="#" class="card-open" data-name="${esc(c.name)}">
            <img class="db-edh-thumb card-img" src="${img}" alt="${esc(c.name)}"></a>` : ''}
          <div class="db-edh-info">
            <a class="card-link db-edh-name" href="#" data-name="${esc(c.name)}">${esc(c.name)}</a>
            ${type ? `<div class="db-edh-type">${esc(type)}</div>` : ''}
            <span class="db-edh-meta">${synPct ? `<span class="db-edh-syn">${synPct}</span>` : ''}${incCount ? `<span class="db-edh-inc">${incCount}</span>` : ''}</span>
          </div>
          ${addBtn}
        </div>`;
      }).join('');
      if (!cards) return '';
      return `<div class="db-edh-section">
        <div class="db-edh-header">${esc(header)}</div>
        ${cards}
      </div>`;
    }).join('');

  el.innerHTML = `
    ${sections || '<div class="empty-state" style="padding:var(--space-4)">No recommendations found</div>'}
    <div style="font-size:var(--text-xs);color:var(--text-muted);text-align:center;padding:var(--space-3) 0">
      Recommendations powered by <a href="https://edhrec.com" target="_blank" rel="noopener" style="color:inherit">EDHREC</a>
    </div>`;
}

// ── New Deck modal ────────────────────────────────────────────────────────────
function dbShowNewDeck() {
  _dbPopulateNewDeckPlayers();
  document.getElementById('dbNewDeckName').value      = '';
  document.getElementById('dbNewDeckCommander').value = '';
  _closeDbCmdAc();
  document.getElementById('dbNewDeckOverlay').style.display = 'flex';
  setTimeout(() => document.getElementById('dbNewDeckName').focus(), 50);
}

function dbHideNewDeck() {
  document.getElementById('dbNewDeckOverlay').style.display = 'none';
}

async function dbCreateDeck() {
  const playerId = document.getElementById('dbNewDeckPlayer')?.value;
  const name     = document.getElementById('dbNewDeckName')?.value.trim();
  const commander = document.getElementById('dbNewDeckCommander')?.value.trim();
  if (!playerId || !name) { alert('Player and Deck Name are required.'); return; }

  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  // Fetch commander image if provided
  let commanderImg = null;
  if (commander) {
    try {
      const r = await scryfallFetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(commander)}`);
      if (r.ok) {
        const d = await r.json();
        commanderImg = d.image_uris?.art_crop || d.card_faces?.[0]?.image_uris?.art_crop || null;
        // Store card data
        dbCardData.set(d.name, d);
        if (d.card_faces?.[0]?.name) dbCardData.set(d.card_faces[0].name, d);
      }
    } catch {}
  }

  const deckId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `deck_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const newDeck = {
    id: deckId, source: 'manual', deckId: null, url: '',
    name, nameStatus: 'loaded', commander: commander || '',
    commanderImg, cardCount: null, bracket: null, deckUrl: '',
  };

  player.decks = [...(player.decks || []), newDeck];
  await saveToStorage();
  dbHideNewDeck();
  dbPopulateDeckSel();

  // Auto-select the new deck
  const sel = document.getElementById('dbDeckSel');
  if (sel) {
    sel.value = `${playerId}|${deckId}`;
    await dbSelectDeck(`${playerId}|${deckId}`);
  }
}

// ── Import: CSV ────────────────────────────────────────────────────────────────
async function _dbHandleCsvImport(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !dbDeck) return;
  if (!isMyPlayer(dbDeck.playerId)) { alert('You can only edit your own decks.'); return; }
  const text = await file.text();
  const parsed = _dbParseTextList(text);
  await _dbImportCards(parsed);
}

// ── Import: text paste ────────────────────────────────────────────────────────
function dbShowImportText() {
  if (!dbDeck) { alert('Select a deck first.'); return; }
  document.getElementById('dbImportTextArea').value = '';
  document.getElementById('dbImportTextOverlay').style.display = 'flex';
  setTimeout(() => document.getElementById('dbImportTextArea').focus(), 50);
}

function dbHideImportText() {
  document.getElementById('dbImportTextOverlay').style.display = 'none';
}

async function dbImportText() {
  const text = document.getElementById('dbImportTextArea')?.value || '';
  dbHideImportText();
  const parsed = _dbParseTextList(text);
  await _dbImportCards(parsed);
}

function _dbParseTextList(text) {
  const lines   = text.split('\n');
  const results = []; // [{name, qty, category}]
  let   curCat  = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('#')) {
      curCat = line.replace(/^\/\/|^#/, '').trim();
      continue;
    }
    // "1x Card Name" or "1 Card Name" or "Card Name"
    const m = line.match(/^(\d+)[x\s]+(.+)$/) || line.match(/^(.+)$/);
    if (!m) continue;
    let qty = 1, name = '';
    if (m.length === 3) { qty = parseInt(m[1], 10) || 1; name = m[2].trim(); }
    else                { name = m[1].trim(); }
    if (name) results.push({ name, qty, category: curCat });
  }
  return results;
}

async function _dbImportCards(cards) {
  if (!cards.length || !dbDeck) return;
  /* Before the first name is looked up, let alone added. Both ways in — a
   * pasted list and a CSV file — come through here, and an import aimed at the
   * wrong deck is the one on the list that can bury a deck under someone
   * else's ninety-nine cards. */
  _dbForceSnapshot('import');
  document.getElementById('dbDeckContent').innerHTML =
    '<div class="empty-state" style="padding:var(--space-6) var(--space-4)">Importing cards…</div>';

  const names = [...new Set(cards.map(c => c.name))];
  await dbFetchCardData(names);

  for (const { name, qty, category } of cards) {
    /* A pasted list is a deck: every line of it goes into the mainboard —
       except the ones under a "// Commander" heading, which every site that
       writes one of these lists puts at the top of it and which this app's own
       export writes too. A heading is the only thing a pasted list can say
       about a board, so it is the one that is read. */
    const isCmd    = /^commander$/i.test(category || '');
    const board    = isCmd ? DB_COMMANDER_BOARD : DB_MAIN_BOARD;
    const finalCat = isCmd ? dbAutoCategory(name) : (category || dbAutoCategory(name));
    dbEnsureCat(finalCat);
    const existing = dbFindCard(dbPlace(board, name));
    if (existing) { existing.qty = (existing.qty || 1) + qty; }
    else {
      dbCards.push({ card_name: name, qty, category: finalCat, board, position: dbCards.length });
      _dbRevealHeadBoard(board);
    }
  }

  dbRender();
  dbRenderStats();
  _dbScheduleSave();
}

/* The ⋯ popover that used to hang off the strip is gone. What it held —
 * categories, history, compare, import, export, delete — is a group in the menu
 * beside the mat, because a popover inside a strip is what you build when the
 * strip has no room, and a column has room. See dbToggleMenu() in
 * js/deckview-core.js. */

// ── Export ────────────────────────────────────────────────────────────────────
/* What gets exported is the deck, and the deck is the mainboard. A maybeboard
 * pasted into somebody's deck list would be a list nobody can play.
 *
 * The commander goes at the head of it, because a Commander list without its
 * commander is not a list anybody can play either. It is the one board that
 * is exported, and it is exported first, under its own heading — which is what
 * every site that reads these lists expects to find there. */
function _dbExportText() {
  const lines = [];
  const commanders = dbCommanderCards();
  if (commanders.length) {
    lines.push('// Commander');
    for (const c of commanders) lines.push(`${c.qty || 1} ${c.card_name}`);
    lines.push('');
  }
  for (const cat of dbCats) {
    const catCards = dbMainCards().filter(c => (c.category || dbAutoCategory(c.card_name)) === cat.name);
    if (!catCards.length) continue;
    lines.push(`// ${cat.name}`);
    for (const c of catCards) lines.push(`${c.qty || 1} ${c.card_name}`);
    lines.push('');
  }
  return lines.join('\n');
}

function dbExportClipboard() {
  if (!dbDeck) return;
  navigator.clipboard.writeText(_dbExportText()).then(() => {
    _dbSetSaveStatus('Copied ✓');
    setTimeout(() => _dbSetSaveStatus(''), 2000);
  });
}

function dbExportCsv() {
  if (!dbDeck) return;
  // The commander first, then the deck — a spreadsheet has no headings to say
  // which is which, so the only thing it can be is complete.
  const rows = ['qty,name', ...[...dbCommanderCards(), ...dbMainCards()]
    .map(c => `${c.qty || 1},"${c.card_name.replace(/"/g,'""')}"`)];
  _dbDownload(`${dbDeck.name}.csv`, rows.join('\n'), 'text/csv');
}

function dbExportTxt() {
  if (!dbDeck) return;
  _dbDownload(`${dbDeck.name}.txt`, _dbExportText(), 'text/plain');
}

function _dbDownload(filename, content, type) {
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Load for comparison (sends to Collections tab) ────────────────────────────
function dbLoadForComparison() {
  if (!dbDeck || !dbCards.length) return;
  const cards = new Map();
  for (const c of dbMainCards()) {
    const ex = cards.get(c.card_name);
    if (ex) ex.qty += (c.qty || 1);
    else cards.set(c.card_name, { name: c.card_name, qty: c.qty || 1 });
  }
  deck       = { name: dbDeck.name, cards };
  deckFilter = false;
  document.getElementById('deckFilterBtn').classList.remove('active');
  setTab('collections');
  renderDeck();
  renderResults();
}

// ── Legacy DVD compatibility (dvGetCategory, dvFetchScryfall etc. removed — ──
// the old Deck View tab no longer exists. Any external reference should use ──
// the new dbXxx API instead.) ──────────────────────────────────────────────────
