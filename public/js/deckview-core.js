// ── Deck Builder ──────────────────────────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────────────────────
let dbDeck      = null;      // {id, playerId, playerName, playerColor, name, commander, commanderImg}
let dbCards     = [];        // [{card_name, qty, category, position}]
let dbCats      = [];        // [{name, position}]
let dbCardData  = new Map(); // card name → Scryfall card object
let dbView      = 'list';
let dbLeftTab   = 'search';
let dbSrResults = [];        // Scryfall search results
let _dbDragCard = null;      // card name currently being dragged
let dbEdhrecData = null;     // parsed EDHREC cardlists
let dbAcTimer   = null;
let dbAddAcTimer = null;
let dbCmdAcTimer = null;
let dbSaveTimer  = null;
let dbSaving     = false;
let dbSortMounted = false;
let _dbInitDone  = false;
let _dbMovingCard = null;    // card name being moved between categories
let _dbBulkMoveMode = false; // true when the move modal is acting on dbSelectedCards instead of _dbMovingCard
let _dbRenamingCat = null;   // category name being renamed
let _dbCatModalReturnTo = null; // 'categories' when rename was opened from the Manage Categories modal
let _dbEdhrecLoaded = false; // whether EDHREC has been fetched for the current deck
let dbOracleFilter = '';     // lowercased search filter — matches card name or oracle text
const dbCollapsedCats = new Set(); // categories collapsed by user
const dbSelectedCards = new Set(); // card names currently selected for bulk move

const DB_DEFAULT_CATS = [
  'Commander', 'Creatures', 'Planeswalkers', 'Instants', 'Sorceries',
  'Enchantments', 'Artifacts', 'Battles', 'Lands', 'Other',
];
const DB_SORT_FIELDS = ['name', 'cmc', 'color', 'power', 'toughness', 'rarity', 'type', 'price'];

// ── Initialization ────────────────────────────────────────────────────────────
function initDeckBuilder() {
  if (!_dbInitDone) {
    document.getElementById('dbCsvInput').addEventListener('change', _dbHandleCsvImport);
    document.addEventListener('click', e => {
      if (!e.target.closest('#dbMoreMenu') && !e.target.closest('.col-menu-wrap')) dbCloseMoreMenu();
      if (!e.target.closest('.db-cat-kebab-wrap')) dbCloseCatMenus();
    });

    // Restore persisted view and scale
    const savedView = localStorage.getItem('dbView');
    if (savedView && ['list','grid','xl','pile'].includes(savedView)) dbView = savedView;
    const savedScale = localStorage.getItem('dbScale');
    if (savedScale) {
      const slider = document.getElementById('dbScaleSlider');
      if (slider) slider.value = savedScale;
      document.getElementById('dbDeckContent')?.style.setProperty('--db-card-width', savedScale + 'px');
    }

    // Keyboard shortcuts (only when deck builder tab is active and not typing in a field)
    document.addEventListener('keydown', e => {
      const dbTabActive = document.getElementById('tab-deckview')?.style.display !== 'none';
      const inField     = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
      if (!dbTabActive || inField) return;

      if (e.key === '/') {
        e.preventDefault();
        dbOpenSearchPanel();
        setTimeout(() => document.getElementById('dbSearchInput')?.focus(), 50);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        dbSelectAllVisible();
      }
    });

    // Hover card preview (list view only). Re-checks the element under the
    // cursor on every mousemove (rather than relying on mouseover/mouseout),
    // so it self-heals once the mouse moves again after a re-render destroys
    // the hovered row. The remaining gap — re-render happens while the mouse
    // is perfectly stationary (e.g. right after a click) — is covered by the
    // global click/scroll/visibility handlers in main.js.
    const preview = document.createElement('img');
    preview.id = 'dbHoverPreview';
    preview.className = 'db-hover-preview';
    preview.style.display = 'none';
    document.body.appendChild(preview);

    document.getElementById('dbDeckContent')?.addEventListener('mousemove', e => {
      if (dbView !== 'list') { preview.style.display = 'none'; return; }
      const link = e.target.closest('.card-link');
      if (!link) { preview.style.display = 'none'; return; }
      const name = link.dataset.name;
      const sf = dbCardData.get(name);
      const face = sf?.card_faces?.[0];
      const imgUrl = sf?.image_uris?.normal || face?.image_uris?.normal || '';
      if (!imgUrl) { preview.style.display = 'none'; return; }
      if (preview.dataset.name !== name) { preview.src = imgUrl; preview.dataset.name = name; }
      preview.style.display = 'block';
      preview.style.left = (e.clientX + 16) + 'px';
      preview.style.top  = Math.min(e.clientY - 40, window.innerHeight - 320) + 'px';
    });

    document.getElementById('dbDeckContent')?.addEventListener('mouseleave', () => {
      preview.style.display = 'none';
    });

    _dbInitDone = true;
  }
  // Mount the shared view toggle (re-mounts with the restored view active)
  mountViewToggle('dbViewMount', ['list', 'grid', 'xl', 'pile'], () => dbView, dbSetView);
  const scaleWrap = document.getElementById('dbScaleWrap');
  if (scaleWrap) scaleWrap.style.display = (dbView !== 'list') ? '' : 'none';
  dbPopulateDeckSel();
}

function dbPopulateDeckSel() {
  const sel = document.getElementById('dbDeckSel');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Select a deck —</option>';
  for (const player of (state.players || [])) {
    for (const deck of (player.decks || [])) {
      const opt = document.createElement('option');
      opt.value = `${player.id}|${deck.id}`;
      opt.textContent = `${player.name} · ${deck.name}`;
      if (deck.commander) opt.textContent += ` (${deck.commander})`;
      sel.appendChild(opt);
    }
  }
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  _dbPopulateNewDeckPlayers();
}

function _dbPopulateNewDeckPlayers() {
  const sel = document.getElementById('dbNewDeckPlayer');
  if (!sel) return;
  sel.innerHTML = '';
  for (const p of (state.players || [])) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  if (currentUser?.playerId) sel.value = currentUser.playerId;
}

// ── Deck selection ────────────────────────────────────────────────────────────
async function dbSelectDeck(value) {
  dbSelectedCards.clear();
  dbOracleFilter = '';
  const oracleInput = document.getElementById('dbOracleSearchInput');
  if (oracleInput) oracleInput.value = '';

  if (!value) {
    dbDeck = null; dbCards = []; dbCats = []; dbCardData = new Map();
    dbSortMounted = false; dbEdhrecData = null; _dbEdhrecLoaded = false;
    _dbHideDeckUI();
    return;
  }
  const [playerId, deckId] = value.split('|');
  const player = state.players.find(p => p.id === playerId);
  // Handle legacy decks whose id was undefined — serialised to the string "undefined"
  const deck = player?.decks?.find(d =>
    d.id === deckId || (deckId === 'undefined' && d.id == null)
  );
  if (!player || !deck) return;
  // Backfill a stable id so this deck works going forward
  if (deck.id == null) {
    const i = player.decks.indexOf(deck);
    deck.id = deck.deckId ? `arch_${deck.deckId}` : `legacy_${player.id}_${i}`;
  }
  const stableId = deck.id;  // always use this, not the raw split value

  dbDeck = { id: stableId, playerId, playerName: player.name, playerColor: player.color,
             name: deck.name, commander: deck.commander || '', commanderImg: deck.commanderImg || null };
  dbEdhrecData = null; _dbEdhrecLoaded = false;

  document.getElementById('dbDeckContent').innerHTML =
    '<div class="empty-state" style="padding:3rem 1rem">Loading deck…</div>';
  _dbShowDeckUI();

  try {
    const res  = await fetch(`/api/players/${encodeURIComponent(playerId)}/decks/${encodeURIComponent(stableId)}/cards`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    dbCards = data.cards || [];
    dbCats  = data.categories?.length ? data.categories : DB_DEFAULT_CATS.map((n, i) => ({ name: n, position: i }));

    // Auto-import Archidekt cards when the deck has never been built locally
    if (dbCards.length === 0 && deck.source === 'archidekt' && deck.deckId) {
      document.getElementById('dbDeckContent').innerHTML =
        '<div class="empty-state" style="padding:3rem 1rem">Importing from Archidekt…</div>';
      const imported = await _dbImportArchidekt(deck.deckId);
      if (imported.length) {
        dbCards = imported;
        // Resolve categories that need Scryfall type data
        await dbFetchCardData([...new Set(dbCards.map(c => c.card_name))]);
        for (const card of dbCards) {
          if (!card.category) card.category = dbAutoCategory(card.card_name);
        }
        _dbScheduleSave();
        dbRender();
        dbRenderStats();
        if (!dbSortMounted) {
          mountSortControl('dbSortMount', 'deckbuild', DB_SORT_FIELDS, dbRender, { field: 'name', dir: 1 });
          dbSortMounted = true;
        }
        return;
      }
    }

    await dbFetchCardData([...new Set(dbCards.map(c => c.card_name))]);
    dbRender();
    dbRenderStats();
    if (!dbSortMounted) {
      mountSortControl('dbSortMount', 'deckbuild', DB_SORT_FIELDS, dbRender, { field: 'name', dir: 1 });
      dbSortMounted = true;
    }
  } catch (e) {
    document.getElementById('dbDeckContent').innerHTML =
      `<div class="error-msg" style="margin:.5rem 0">${esc(e.message)}</div>`;
  }
}

function _dbShowDeckUI() {
  document.getElementById('dbDeckToolbar').style.display = '';
  document.getElementById('dbAddCardRow').style.display  = '';
  document.getElementById('dbAddCatRow').style.display   = '';
  document.getElementById('dbStatsBar').style.display    = '';
  document.getElementById('dbCategoriesBtn').style.display = '';
  document.getElementById('dbDeleteDeckBtn').style.display =
    isMyPlayer(dbDeck?.playerId) ? '' : 'none';
}

function _dbHideDeckUI() {
  document.getElementById('dbDeckToolbar').style.display = 'none';
  document.getElementById('dbAddCardRow').style.display  = 'none';
  document.getElementById('dbAddCatRow').style.display   = 'none';
  document.getElementById('dbStatsBar').style.display    = 'none';
  document.getElementById('dbCategoriesBtn').style.display = 'none';
  document.getElementById('dbDeleteDeckBtn').style.display = 'none';
  document.getElementById('dbDeckContent').innerHTML =
    '<div class="empty-state" style="padding:3rem 1rem">Select a deck or create a new one</div>';
}

// ── Delete deck ───────────────────────────────────────────────────────────────
async function dbDeleteDeck() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  if (!confirm(`Delete "${dbDeck.name}"? This removes the deck and all its cards. You can re-add it (e.g. from Archidekt) afterwards.`)) return;

  const { id: deckId, playerId } = dbDeck;

  // Wipe server-side cards/categories for this deck (no dedicated delete-deck
  // endpoint — reuse the full-replace endpoint with empty arrays).
  try {
    await fetch(`/api/players/${encodeURIComponent(playerId)}/decks/${encodeURIComponent(deckId)}/cards`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: [], categories: [] }),
    });
  } catch {}

  const player = state.players.find(p => p.id === playerId);
  if (player) player.decks = (player.decks || []).filter(d => d.id !== deckId);
  await saveToStorage();

  dbDeck = null; dbCards = []; dbCats = []; dbEdhrecData = null; _dbEdhrecLoaded = false;
  _dbHideDeckUI();
  dbPopulateDeckSel();
  const sel = document.getElementById('dbDeckSel');
  if (sel) sel.value = '';
}

// ── Archidekt import ──────────────────────────────────────────────────────────
const _ARCH_CAT = {
  commander: 'Commander', creatures: 'Creatures', creature: 'Creatures',
  planeswalkers: 'Planeswalkers', planeswalker: 'Planeswalkers',
  instants: 'Instants', instant: 'Instants',
  sorceries: 'Sorceries', sorcery: 'Sorceries',
  enchantments: 'Enchantments', enchantment: 'Enchantments',
  artifacts: 'Artifacts', artifact: 'Artifacts',
  battles: 'Battles', battle: 'Battles',
  lands: 'Lands', land: 'Lands',
};

async function _dbImportArchidekt(archidektId) {
  const res = await fetch(`/api/archidekt/deck/${encodeURIComponent(archidektId)}`);
  if (!res.ok) throw new Error(`Archidekt fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  const cards = [];
  for (const item of (data.cards || [])) {
    const name = item.card?.oracleCard?.name || item.card?.name || '';
    const qty  = item.quantity || 1;
    if (!name || qty <= 0) continue;
    // Skip sideboard / maybeboard
    const rawCats = (item.categories || []).map(c => c.trim());
    if (rawCats.some(c => /sideboard|maybeboard/i.test(c))) continue;
    // Map to our standard categories where the name matches one of ours;
    // otherwise keep Archidekt's own category name as-is (e.g. "Ramp",
    // "Removal" from their community auto-categorize feature) rather than
    // discarding it — '' means let dbAutoCategory fill it in from type.
    let category = '';
    for (const c of rawCats) {
      const mapped = _ARCH_CAT[c.toLowerCase()];
      if (mapped) { category = mapped; break; }
    }
    if (!category && rawCats.length) category = rawCats[0];
    cards.push({ card_name: name, qty, category, position: cards.length });
  }
  return cards;
}

// ── Scryfall batch-fetch ──────────────────────────────────────────────────────
async function dbFetchCardData(names) {
  const missing = names.filter(n => !dbCardData.has(n));
  if (!missing.length) return;
  const cards = await fetchCardCollection(missing);
  for (const card of cards) {
    dbCardData.set(card.name, card);
    if (card.card_faces?.[0]?.name) dbCardData.set(card.card_faces[0].name, card);
  }
}

// ── Auto-categorise ───────────────────────────────────────────────────────────
// Archidekt's "auto categories" assign staples like Sol Ring to community-voted
// functional categories (e.g. "Ramp") rather than just their card type — but
// that data is generated from crowd voting inside Archidekt itself and isn't
// exposed by any public API, so it can't be queried live for an arbitrary card.
// This is a best-effort local stand-in covering well-known staples in the same
// spirit; anything not listed here falls back to the normal type-based bucket
// below (and a real Archidekt import already preserves its own categories —
// see _dbImportArchidekt — so decks built there keep their real "Ramp" etc.).
const DB_FUNCTION_CATEGORY = {
  'sol ring': 'Ramp', 'arcane signet': 'Ramp', 'mana crypt': 'Ramp', 'mana vault': 'Ramp',
  'fellwar stone': 'Ramp', 'mind stone': 'Ramp', "wayfarer's bauble": 'Ramp',
  'birds of paradise': 'Ramp', 'llanowar elves': 'Ramp', 'elvish mystic': 'Ramp',
  'sakura-tribe elder': 'Ramp', 'rampant growth': 'Ramp', 'cultivate': 'Ramp',
  "kodama's reach": 'Ramp', 'farseek': 'Ramp', 'three visits': 'Ramp', "nature's lore": 'Ramp',
  'swords to plowshares': 'Removal', 'path to exile': 'Removal', 'beast within': 'Removal',
  'chaos warp': 'Removal', 'generous gift': 'Removal', 'anguished unmaking': 'Removal',
  'vindicate': 'Removal', 'utter end': 'Removal', 'despark': 'Removal', 'pongify': 'Removal',
  'rapid hybridization': 'Removal',
  'cyclonic rift': 'Board Wipe', 'wrath of god': 'Board Wipe', 'damnation': 'Board Wipe',
  'toxic deluge': 'Board Wipe', 'blasphemous act': 'Board Wipe', 'farewell': 'Board Wipe',
  "in garruk's wake": 'Board Wipe', 'austere command': 'Board Wipe',
  'rhystic study': 'Card Draw', 'mystic remora': 'Card Draw', 'phyrexian arena': 'Card Draw',
  'sylvan library': 'Card Draw', 'fact or fiction': 'Card Draw', "night's whisper": 'Card Draw',
  'sign in blood': 'Card Draw', 'guardian project': 'Card Draw',
  'counterspell': 'Counterspell', 'mana drain': 'Counterspell', 'swan song': 'Counterspell',
  'negate': 'Counterspell', 'arcane denial': 'Counterspell', 'force of will': 'Counterspell',
  'demonic tutor': 'Tutor', 'vampiric tutor': 'Tutor', 'mystical tutor': 'Tutor',
  'worldly tutor': 'Tutor', 'enlightened tutor': 'Tutor',
  'eternal witness': 'Recursion', 'regrowth': 'Recursion', 'reveillark': 'Recursion',
  'sun titan': 'Recursion', 'archaeomancer': 'Recursion',
  'heroic intervention': 'Protection', "teferi's protection": 'Protection',
  'swiftfoot boots': 'Protection', 'lightning greaves': 'Protection',
};

function dbAutoCategory(cardName) {
  if (cardName === dbDeck?.commander) return 'Commander';
  const fnCat = DB_FUNCTION_CATEGORY[cardName.toLowerCase()];
  if (fnCat) return fnCat;
  const sf = dbCardData.get(cardName);
  const t  = (sf?.type_line || '').toLowerCase();
  if (t.includes('creature'))             return 'Creatures';
  if (t.includes('planeswalker'))         return 'Planeswalkers';
  if (t.includes('instant'))             return 'Instants';
  if (t.includes('sorcery'))             return 'Sorceries';
  if (t.includes('enchantment'))         return 'Enchantments';
  if (t.includes('artifact'))            return 'Artifacts';
  if (t.includes('battle'))              return 'Battles';
  if (t.includes('land'))               return 'Lands';
  return 'Other';
}

// Ensure the category exists in dbCats (adds it if not)
function dbEnsureCat(name) {
  if (!dbCats.find(c => c.name === name)) {
    dbCats.push({ name, position: dbCats.length });
  }
}

// ── Oracle/name text filter ────────────────────────────────────────────────────
function dbSetOracleFilter(value) {
  dbOracleFilter = (value || '').trim().toLowerCase();
  dbRender();
}

function _dbMatchesFilter(cardName) {
  if (!dbOracleFilter) return true;
  if (cardName.toLowerCase().includes(dbOracleFilter)) return true;
  const sf = dbCardData.get(cardName);
  const text = sf?.oracle_text || (sf?.card_faces || []).map(f => f.oracle_text || '').join(' ');
  return (text || '').toLowerCase().includes(dbOracleFilter);
}
