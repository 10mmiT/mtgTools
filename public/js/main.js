// ── Collapsible panels ────────────────────────────────────────────────
const collapseState = JSON.parse(localStorage.getItem('mtgtools_collapse') || '{}');

function togglePanel(id) {
  collapseState[id] = !collapseState[id];
  localStorage.setItem('mtgtools_collapse', JSON.stringify(collapseState));
  applyCollapse(id);
}

function applyCollapse(id) {
  const body = document.getElementById(`pb-${id}`);
  const chv  = document.getElementById(`chv-${id}`);
  const closed = !!collapseState[id];
  if (body) body.classList.toggle('closed', closed);
  if (chv)  chv.classList.toggle('closed', closed);
}

function initCollapses() {
  ['add-col', 'collections'].forEach(applyCollapse);
  if (collapseState['pick-pool'] === undefined) collapseState['pick-pool'] = true;
  applyCollapse('pick-pool');
}

function togglePlayerSection(playerId, event) {
  // Don't collapse when clicking the action buttons
  if (event.target.closest('button')) return;
  const id  = `player-${playerId}`;
  collapseState[id] = !collapseState[id];
  localStorage.setItem('mtgtools_collapse', JSON.stringify(collapseState));
  const body = document.getElementById(`pb-${id}`);
  const chv  = document.getElementById(`chv-${id}`);
  const closed = !!collapseState[id];
  if (body) body.style.display = closed ? 'none' : '';
  if (chv)  chv.classList.toggle('closed', closed);
}

// ── Sidebar nav ───────────────────────────────────────────────────────
function toggleSideNav() {
  const nav = document.getElementById('sideNav');
  if (!nav) return;
  const collapsed = nav.classList.toggle('collapsed');
  document.body.classList.toggle('sidenav-collapsed', collapsed);
  localStorage.setItem('mtgtools_sidenav', collapsed ? '1' : '0');
}

function initSideNav() {
  if (localStorage.getItem('mtgtools_sidenav') === '1') {
    document.getElementById('sideNav')?.classList.add('collapsed');
    document.body.classList.add('sidenav-collapsed');
  }
}

// ── Theme ─────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('mtgtools_theme') || 'dark';
  document.documentElement.dataset.theme = saved;
  document.getElementById('themeToggle').textContent = saved === 'dark' ? '☀ Light' : '🌙 Dark';
  const lbl = document.getElementById('mobNavThemeLabel');
  if (lbl) lbl.textContent = saved === 'dark' ? '☀ Light mode' : '🌙 Dark mode';
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('mtgtools_theme', next);
  document.getElementById('themeToggle').textContent = next === 'dark' ? '☀ Light' : '🌙 Dark';
  const lbl = document.getElementById('mobNavThemeLabel');
  if (lbl) lbl.textContent = next === 'dark' ? '☀ Light mode' : '🌙 Dark mode';
}

// ── View mode ─────────────────────────────────────────────────────────
function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('btnList').classList.toggle('active', mode === 'list');
  document.getElementById('btnGrid').classList.toggle('active', mode === 'grid');
  renderResults();
}

// ── Mobile navigation dropdown ────────────────────────────────────────
const MOB_TAB_LABELS = {
  available:   'Available@',
  collections: 'Collections',
  players:     'Players & Decks',
  scryfall:    'Scryfall Search',
  card:        'Card',
  sets:        'Set Browser',
  wants:       'Want Lists',
  lands:       'Mana Base',
  deckview:    'Deck View',
  pick:        'Pick Night',
  admin:       'Admin',
};

function toggleMobNav() {
  const menu = document.getElementById('mobNavMenu');
  const chev = document.getElementById('mobNavChev');
  if (!menu) return;
  const opening = !menu.classList.contains('open');
  menu.classList.toggle('open', opening);
  if (chev) chev.classList.toggle('open', opening);
}

function closeMobNav() {
  document.getElementById('mobNavMenu')?.classList.remove('open');
  document.getElementById('mobNavChev')?.classList.remove('open');
}

// Close dropdown when clicking anywhere outside it
document.addEventListener('click', e => {
  if (!e.target.closest('#mobNav')) closeMobNav();
});

// ── State refresh ─────────────────────────────────────────────────────
let _lastRefresh = 0;
let _lastStateSig = null;

async function refreshState() {
  if (document.visibilityState === 'hidden') return;
  if (state.collections.some(c => c.status === 'loading' || c.status === 'updating')) {
    console.log('[refresh] skipped — collection loading');
    return;
  }
  if (state.players.some(p => p.decks.some(d => d.nameStatus === 'loading'))) {
    console.log('[refresh] skipped — deck loading');
    return;
  }
  if (Date.now() - _lastRefresh < 15_000) {
    console.log(`[refresh] skipped — rate limited (${Math.round((Date.now()-_lastRefresh)/1000)}s since last)`);
    return;
  }
  console.log('[refresh] FIRING — will call hydrateState', new Error().stack.split('\n')[2]?.trim());
  _lastRefresh = Date.now();
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    const json = await res.json();

    // Skip the re-render entirely when nothing actually changed on the server.
    // Re-rendering rebuilds every card/image element, which flashes the grid and
    // jumps the scroll position — pointless when the data is identical.
    const sig = JSON.stringify(json);
    if (sig === _lastStateSig) return;
    _lastStateSig = sig;

    const deckSummary = (json.players||[]).map(p=>`${p.name}:[${(p.decks||[]).map(d=>d.name).join(',')}]`).join(' ');
    console.log(`[refresh] hydrateState — players: ${deckSummary || '(none)'}`);
    hydrateState(json);
    renderPlayers();
    renderCollections();
    const activeTab = document.querySelector('.tab-btn.active')?.id?.replace('tab-btn-', '');
    if (activeTab === 'collections') renderResults();
    if (activeTab === 'wants')       renderWantList();
    if (activeTab === 'sets' && currentSet) renderSetCards();
  } catch {}
}

// Poll every 30 seconds while the page is open
setInterval(refreshState, 30_000);

// ── Tab switching ─────────────────────────────────────────────────────
// push = whether to add a browser-history entry (false when restoring from
// a back/forward navigation or on initial load).
function setTab(tab, push = true) {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.getElementById(`tab-${tab}`).style.display = '';
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tab-btn-${tab}`).classList.add('active');

  // Sync mobile dropdown label + active item
  const mobLabel = document.getElementById('mobNavLabel');
  if (mobLabel) mobLabel.textContent = MOB_TAB_LABELS[tab] || tab;
  document.querySelectorAll('.mob-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  closeMobNav();

  if (tab === 'scryfall')  initScryfallSort();
  if (tab === 'sets')      initSetBrowser();
  if (tab === 'wants')     renderWantList();
  if (tab === 'available') initAvailable();
  if (tab === 'lands')     initLands();
  if (tab === 'pick')      initPick();
  if (tab === 'admin')   { initAdmin(); adminRenderPlayerOpts(); }
  // Refresh shared data when switching to any tab that shows other users' content
  if (['players', 'wants', 'collections', 'sets', 'deckview'].includes(tab)) refreshState();

  // Add a history entry unless this came from back/forward, skipping no-op repeats
  if (push) {
    const cur = history.state;
    if (!(cur && cur.view === 'tab' && cur.tab === tab)) {
      history.pushState({ view: 'tab', tab }, '', '#' + tab);
    }
  }
}

// ── Browser back/forward (History API) ────────────────────────────────
window.addEventListener('popstate', e => {
  const s = e.state;
  if (!s) return;
  if (s.view === 'card') {
    setTab('card', false);
    if (s.cardName)    loadCard({ name: s.cardName });
    else if (s.cardId) loadCard({ id: s.cardId });
  } else if (s.view === 'tab') {
    setTab(s.tab, false);
  }
});

// On load, restore a deep-linked view from the URL hash, else record the
// default view so the first back press leaves the app cleanly.
function initRouting() {
  const raw = location.hash.replace(/^#/, '');
  if (raw.startsWith('card=')) {
    const name = decodeURIComponent(raw.slice(5));
    setTab('card', false);
    history.replaceState({ view: 'card', cardName: name }, '', location.hash);
    loadCard({ name });
    return;
  }
  if (raw.startsWith('cardid=')) {
    const id = decodeURIComponent(raw.slice(7));
    setTab('card', false);
    history.replaceState({ view: 'card', cardId: id }, '', location.hash);
    loadCard({ id });
    return;
  }
  if (raw && MOB_TAB_LABELS[raw]) {
    setTab(raw, false);
    history.replaceState({ view: 'tab', tab: raw }, '', '#' + raw);
    return;
  }
  history.replaceState({ view: 'tab', tab: 'available' }, ''); // default view, URL unchanged
}

// ── Card click → open Card Detail tab ─────────────────────────────────
// Delegated: any card name (.card-link) or card image (.card-open) routes to
// the Card tab instead of jumping straight to Scryfall. Ctrl/Cmd/middle-click
// still opens the external link in a new tab.
document.addEventListener('click', e => {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const el = e.target.closest('.card-link, .card-open');
  if (!el) return;
  const name = el.dataset.name;
  if (!name) return;
  e.preventDefault();
  openCardByName(name);
});

// auth functions are in auth.js (logout, authInit)

// ── Card image tooltip (list view) ────────────────────────────────────
const _tip    = document.getElementById('cardTooltip');
const _tipImg = document.getElementById('tooltipImg');
let _tipTimer = null;

document.addEventListener('mouseover', e => {
  const link = e.target.closest('.card-link');
  if (!link) return;
  clearTimeout(_tipTimer);
  _tipTimer = setTimeout(async () => {
    const name = link.dataset.name;
    if (!scryfallCache.has(name)) await ensureScryfallImages([name]);
    const uri = scryfallCache.get(name);
    if (!uri) return;
    _tipImg.src = uri;
    _tip.style.display = 'block';
  }, 120);
});

document.addEventListener('mouseout', e => {
  if (!e.target.closest('.card-link')) return;
  clearTimeout(_tipTimer);
  _tip.style.display = 'none';
});

document.addEventListener('mousemove', e => {
  if (_tip.style.display === 'none') return;
  const W = 216, H = 300, pad = 14;
  const left = (e.clientX + pad + W > window.innerWidth)  ? e.clientX - pad - W : e.clientX + pad;
  const top  = (e.clientY - 20 + H > window.innerHeight)  ? window.innerHeight - H - 8 : e.clientY - 20;
  _tip.style.left = left + 'px';
  _tip.style.top  = top  + 'px';
});

_tipImg.addEventListener('error', () => { _tip.style.display = 'none'; });

// ── Event listeners ───────────────────────────────────────────────────
document.getElementById('urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') addFromUrl(); });
document.getElementById('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') addFromUrl(); });
document.getElementById('playerNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAddPlayer(); });

// ── Init ──────────────────────────────────────────────────────────────
initTheme();
initSideNav();
authInit().then(() => {
  loadFromStorage().then(() => {
    _lastRefresh = Date.now(); // don't re-fetch immediately after the initial load
    initCollapses();
    renderPlayers();
    renderCollections();
    setViewMode(viewMode); // syncs list/grid buttons and calls renderResults
    initAvailable(); // Available is the default tab — start loading it immediately
    initRouting();   // wire up browser back/forward + restore any deep-linked view
  });
});
