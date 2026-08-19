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

// ── Where the drawer puts things ──────────────────────────────────────────
// The drawer is two ways of finding a card and one way of taking it: Search
// asks Magic or the shelf, EDHREC asks what other people run, and both hand
// back a grid of cards with a + on each. What the + *meant* was the deck, and
// only the deck — so a card you were merely considering had to go into the
// ninety-nine and be dragged out to the maybeboard afterwards, which is the
// deck being broken on the way to not breaking it.
//
// So the + has a destination, and it is one control for the whole drawer
// rather than a choice on every tile. Choosing where cards go is a mode you
// are in for a while — you sit down to fill a maybeboard, or to build — and a
// menu on each of two hundred tiles would be asking the same question two
// hundred times. It is in the drawer's header, above both tabs, because it is
// a fact about the drawer and not about either way of searching.
//
// The options are dbAddBoards(), so the commander is deliberately not among
// them and a board added to DB_BOARDS appears here without this file changing.

const DB_ADD_TO_KEY = 'mtgtools_db_add_to';

/* Where the + puts a card. Stored rather than reset per deck: it is a way of
 * working, and somebody filling maybeboards is filling them for the evening.
 * Read through the board list on the way out for localStorage's usual reason —
 * a stored id nothing answers to is the mainboard, not a region of the mat
 * nobody can reach. */
function dbAddTo() {
  let stored = null;
  try { stored = localStorage.getItem(DB_ADD_TO_KEY); } catch {}
  return dbAddBoards().some(b => b.id === stored) ? stored : DB_MAIN_BOARD;
}

function dbSetAddTo(board) {
  try { localStorage.setItem(DB_ADD_TO_KEY, board); } catch {}
  /* Both panes say where a card already is, per board, so both are wrong the
     moment this changes. */
  _dbRefreshDrawer();
}

/* The control itself, written once into a header both tabs share. */
function _dbRenderAddTo() {
  const el = document.getElementById('dbAddToWrap');
  if (!el) return;
  const now = dbAddTo();
  el.innerHTML = `<label class="db-add-to">Add to
    <select id="dbAddToSel" onchange="dbSetAddTo(this.value)"
            title="Where the + on a card puts it">
      ${dbAddBoards().map(b =>
        `<option value="${esc(b.id)}"${b.id === now ? ' selected' : ''}>${esc(
          b.id === DB_MAIN_BOARD ? 'Deck' : b.label)}</option>`).join('')}
    </select></label>`;
}

/* Whatever the drawer is showing, drawn again.
 *
 * Adding a card used to change nothing you could see. The mat redrew behind
 * the drawer, and the tile you had just pressed went on saying + — so a second
 * press was the obvious thing to do and it silently made two copies. The
 * drawer is a view of the deck as much as the mat is, and this is what makes
 * it one. */
function _dbRefreshDrawer() {
  if (dbLeftTab === 'edhrec') { if (dbEdhrecData) _dbRenderEdhrec(); }
  else if (dbSrResults.length) _dbRenderSearch();
  _dbRenderAddTo();
}

// ── One card, in either half of the drawer ────────────────────────────────
// Search results and EDHREC recommendations were two lists of the same thing
// drawn twice, each a 186-pixel row of a big picture beside three short lines
// and a lot of nothing. Four fitted on a screen. EDHREC hands back two hundred
// and forty cards, which was forty thousand pixels of scrolling.
//
// They are one grid of card art now — the app's own .sf-grid, the same one the
// Collections, Scryfall and Set Browser tabs draw, so a page of cards looks
// like a page of cards everywhere in the app. What differs between the two
// halves is what a card has to say about itself: a price here, a synergy
// percentage and a deck count there. That is the `badges` argument and it is
// the whole of the difference.

/* Where the deck already has this card, board by board. Every board, not just
 * the mainboard: the point of a destination is that a card can be in the deck
 * *and* set aside, and a tile that only knew about the deck would say nothing
 * about the copy you put in the maybeboard a minute ago. */
function _dbHeldOn(name) {
  return dbCards
    .filter(c => c.card_name === name)
    .map(c => ({ board: c.board || DB_MAIN_BOARD, qty: c.qty || 1 }));
}

const _dbBoardLabel = id => id === DB_MAIN_BOARD
  ? 'Deck' : (DB_BOARDS.find(b => b.id === id)?.label || id);

/* One card in the drawer: the picture, its name, whatever this half of the
 * drawer knows about it, and the + that takes it.
 *
 * The + says where it would go and what is already there. It stays pressable
 * once the card is in — a second Forest is a real thing to want, and in a
 * sixty-card deck so is a fourth Lightning Bolt — but it can no longer be
 * pressed *blindly*: the count is on it, so a second copy is something you
 * chose rather than something that happened while you were clicking. */
function _dbDrawerTile(name, { img, badges = '', canAdd }) {
  const into  = dbAddTo();
  const held  = _dbHeldOn(name);
  const here  = held.find(h => h.board === into);
  const there = held.filter(h => h.board !== into)
    .map(h => `<span class="db-find-where">${esc(_dbBoardLabel(h.board))}${
      h.qty > 1 ? ` ×${h.qty}` : ''}</span>`).join('');

  const add = canAdd
    ? `<button class="db-add-btn db-find-add${here ? ' db-add-btn-in' : ''}"
         onclick="dbAddFromDrawer('${jsAttr(name)}')"
         title="${here ? `${here.qty} already in ${_dbBoardLabel(into)} — add another`
                       : `Add to ${_dbBoardLabel(into)}`}"
        >${here ? `✓${here.qty > 1 ? here.qty : ''}` : '+'}</button>` : '';

  return `<div class="db-find-tile">
    <div class="db-find-art">
      <a href="#" class="card-open" data-name="${esc(name)}">
        ${img ? `<img class="sf-card-lg-img card-img" src="${img}" loading="lazy" alt="${esc(name)}">`
              : `<div class="sf-card-lg-img sf-thumb-ph" style="aspect-ratio:5/7"></div>`}
      </a>
      ${add}
    </div>
    <div class="sf-card-lg-footer db-find-foot">
      <a class="sf-card-lg-name card-link" href="#" data-name="${esc(name)}">${esc(name)}</a>
      <div class="db-find-badges">${badges}${there}</div>
    </div>
  </div>`;
}

/* The + pressed. The drawer redraws itself afterwards, which is what turns a
 * press into something you can see happen. */
async function dbAddFromDrawer(name) {
  await dbAddCard(name, dbAddTo());
  _dbRefreshDrawer();
}

// ── Scryfall search panel ─────────────────────────────────────────────────────
async function dbSearch() {
  const input = document.getElementById('dbSearchInput');
  let   q     = (input?.value || '').trim();
  if (!q) return;

  // Auto-inject colour identity filter for commander decks (if toggle enabled).
  // The whole commander board answers, so a pair of partners is searched in the
  // colours of both — the same union the legality tab judges the deck against.
  const ciChecked = document.getElementById('dbCiToggle')?.checked;
  if (ciChecked && !/\b(ci:|id:)/.test(q)) {
    const ci = dbCommanderIdentity();
    if (ci?.size) {
      q = `${q} ci<=${[...ci].join('')}`;
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

/* What the last search had to say about itself — that the shelf holds more
 * than a page of them — kept so that redrawing the grid does not lose it. The
 * grid is redrawn on every add now, and a note that vanished on the first
 * press would read as the search having changed. */
let _dbSearchNote = '';

function _dbRenderSearch(note = _dbSearchNote) {
  _dbSearchNote = note;
  const el = document.getElementById('dbSearchResults');
  if (!dbSrResults.length) {
    el.innerHTML = `<div class="empty-state" style="padding:var(--space-4)">${
      _dbSearchOwnScope() ? 'Nothing on that shelf matches' : 'No results'}</div>`;
    return;
  }
  const noteHtml = note
    ? `<div class="help-text db-sr-note">${esc(note)}</div>` : '';
  const canAdd = !!(dbDeck && isMyPlayer(dbDeck.playerId));
  el.innerHTML = noteHtml + `<div class="sf-grid db-find-grid">` + dbSrResults.map(card => {
    const face  = card.card_faces?.[0];
    const img   = card.image_uris?.normal || face?.image_uris?.normal || '';
    /* The price and the want-list button, which are what this half of the
       drawer knows about a card beyond its picture. The mana cost and the type
       line are gone from the tile and not lost: they are on the card, which is
       the picture, and a type line under a full-art thumbnail is the app
       reading the card out to you. */
    return _dbDrawerTile(card.name, {
      img, canAdd, badges: `${renderPrice(card)}${wantBtnHtml(card.name)}`,
    });
  }).join('') + `</div>`;
}

// ── Search drawer ─────────────────────────────────────────────────────────────
function dbOpenSearchPanel() {
  document.getElementById('dbSearchPanel')?.classList.add('open');
  document.getElementById('dbSearchBackdrop')?.classList.add('open');
  document.body.style.overflow = 'hidden';
  /* Drawn on the way in rather than at boot: the boards it lists are a fact
     about this deck's tab, and the drawer is where somebody is about to use
     it. Redrawing what the deck holds with it, because the deck may have moved
     on since the drawer was last looked at. */
  _dbRefreshDrawer();
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
  } else {
    /* The half being switched to was drawn against a deck that may have
       changed while the other half was showing — a card added over there is a
       ✓ over here. */
    _dbRefreshDrawer();
  }
}

// ── EDHREC panel ──────────────────────────────────────────────────────────────
async function dbLoadEdhrec() {
  /* Off the commander board, and off the deck record when the board is empty —
     the same order this asked in when the commander was a category, with the
     board in the category's place. Both partners go to EDHREC, which keys the
     pair under its own combined page — the recommendations for the two together
     are not the recommendations for either one alone. */
  const names = dbCommanderCards().map(c => c.card_name);
  if (!names.length && dbDeck?.commander) names.push(dbDeck.commander);
  const el = document.getElementById('dbEdhrecContent');
  if (!names.length) {
    el.innerHTML = '<div class="empty-state" style="padding:var(--space-6) 0">Put a card on the commander board to see EDHREC recommendations</div>';
    return;
  }
  _dbEdhrecLoaded = true;
  el.innerHTML = `<div class="empty-state" style="padding:var(--space-6) var(--space-4)">Loading EDHREC recommendations for ${esc(names.join(' + '))}…</div>`;

  try {
    const res  = await fetch(`/api/edhrec/commander/${encodeURIComponent(names.join('|'))}`);
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
      /* A recommendation for a card already in the deck is not a
         recommendation, so the mainboard is filtered out — but only the
         mainboard. A card you have set aside in the maybeboard is one you have
         *not* put in, and dropping it here would answer "should I run this?"
         by hiding the question; it stays, wearing what the tile says about
         where it already is. */
      const cards = views
          .filter(c => !dbMainCards().some(d => d.card_name === c.name))
          .slice(0, DB_EDHREC_PER_SECTION).map(c => {
        const sf     = dbCardData.get(c.name);
        const face   = sf?.card_faces?.[0];
        const img    = sf?.image_uris?.normal || face?.image_uris?.normal || '';
        const synPct   = c.synergy != null ? `${Math.round(c.synergy * 100)}%` : '';
        const incCount = c.num_decks != null ? `${c.num_decks.toLocaleString()} decks` : '';
        return _dbDrawerTile(c.name, { img, canAdd, badges:
          `${synPct ? `<span class="db-edh-syn">${synPct}</span>` : ''}${
            incCount ? `<span class="db-edh-inc">${incCount}</span>` : ''}` });
      }).join('');
      if (!cards) return '';
      return `<div class="db-edh-section">
        <div class="db-edh-header">${esc(header)}</div>
        <div class="sf-grid db-find-grid">${cards}</div>
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
    // Public, like a deck made from the Decks tab: privacy is a deliberate act
    // from the tile's ⋯, never a thing a deck arrives already wearing.
    commanderImg, cardCount: null, bracket: null, deckUrl: '', private: false,
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
    /* "Sol Ring (RAV) 266" — a line naming which printing it means, which is
       what this app's own export now writes and what every site that reads one
       of these lists writes too. The name is what is imported: a card added by
       name has no chosen printing, deliberately, and a card called "Sol Ring
       (RAV) 266" is a card that does not exist.
       A set code and a collector number, not everything in brackets: cards
       whose own names end in them are named that way in the deck too. */
    name = name.replace(/\s+\([A-Za-z0-9]{2,6}\)\s+\S+$/, '').trim();
    if (name) results.push({ name, qty, category: curCat });
  }
  return results;
}

/* A heading naming a board rather than a pile. Every site that writes these
 * lists puts the commander under one, and most write a Sideboard or Maybeboard
 * section too — cards that are *not in the deck*. Read as a category, they land
 * in the mainboard and are counted as if they were in it; read as the board
 * they name, they go where they belong and the deck size leaves them out.
 * Anything else is an ordinary category. */
function _dbImportBoard(heading) {
  const h = (heading || '').trim();
  if (/^commander$/i.test(h))          return DB_COMMANDER_BOARD;
  if (/^side(board)?$/i.test(h))       return 'side';
  if (/^maybe(board)?$/i.test(h))      return 'maybe';
  return null;
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
       except the ones under a heading that names a board. Commander, Sideboard
       and Maybeboard are the three every site that writes one of these lists
       puts its off-deck cards under, and which this app's own export writes for
       the commander too. A heading is the only thing a pasted list can say
       about a board, so it is the one that is read; on a board, the heading is
       spent and the pile comes from the card's own type. */
    const board    = _dbImportBoard(category) || DB_MAIN_BOARD;
    const onBoard  = board !== DB_MAIN_BOARD;
    const finalCat = onBoard ? dbAutoCategory(name) : (category || dbAutoCategory(name));
    dbEnsureCat(finalCat);
    const existing = dbFindCard(dbPlace(board, name));
    if (existing) { existing.qty = (existing.qty || 1) + qty; }
    else {
      dbCards.push({ card_name: name, qty, category: finalCat, board, position: dbCards.length });
      _dbRevealBoard(board);
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

/* What a card says about its printing on the way out — the set code and the
 * collector number, or nothing at all.
 *
 * Nothing at all is the answer for every card nobody has chosen a printing of,
 * which is every card in every deck that existed before the feature: such a
 * deck exports byte-for-byte as it always did, and that is the point. A card
 * that does name one names it in full or not at all, because half of it —
 * a set with no number — is not a printing any site can look up.
 *
 * The set is upper-cased because that is how these lists are written and read
 * everywhere else, while Scryfall stores it lower. */
function _dbExportPrinting(card) {
  const { set, collector_number: number } = card.printing || {};
  return set && number ? { set: set.toUpperCase(), number } : null;
}

function _dbExportLine(card) {
  const printing = _dbExportPrinting(card);
  return `${card.qty || 1} ${card.card_name}${printing ? ` (${printing.set}) ${printing.number}` : ''}`;
}

function _dbExportText() {
  const lines = [];
  const commanders = dbCommanderCards();
  if (commanders.length) {
    lines.push('// Commander');
    for (const c of commanders) lines.push(_dbExportLine(c));
    lines.push('');
  }
  for (const cat of dbCats) {
    const catCards = dbMainCards().filter(c => (c.category || dbAutoCategory(c.card_name)) === cat.name);
    if (!catCards.length) continue;
    lines.push(`// ${cat.name}`);
    for (const c of catCards) lines.push(_dbExportLine(c));
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
  //
  // The set and the collector number are columns of the sheet rather than
  // something appended to the name: a spreadsheet is read a column at a time,
  // and they are left empty on the rows of cards nobody has chosen a printing
  // of, because rows of different widths are worse than blanks.
  const rows = ['qty,name,set,collector_number', ...[...dbCommanderCards(), ...dbMainCards()]
    .map(c => {
      const printing = _dbExportPrinting(c);
      return `${c.qty || 1},"${c.card_name.replace(/"/g,'""')}",${printing ? `${printing.set},${printing.number}` : ','}`;
    })];
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
