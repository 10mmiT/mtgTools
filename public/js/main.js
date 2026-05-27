// ── Collapsible panels ────────────────────────────────────────────────────
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

// ── Theme ─────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('mtgtools_theme') || 'dark';
  document.documentElement.dataset.theme = saved;
  document.getElementById('themeToggle').textContent = saved === 'dark' ? '☀ Light' : '🌙 Dark';
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('mtgtools_theme', next);
  document.getElementById('themeToggle').textContent = next === 'dark' ? '☀ Light' : '🌙 Dark';
}

// ── View mode ─────────────────────────────────────────────────────────────
function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('btnList').classList.toggle('active', mode === 'list');
  document.getElementById('btnGrid').classList.toggle('active', mode === 'grid');
  renderResults();
}

// ── State refresh ─────────────────────────────────────────────────────────
let _lastRefresh = 0;

async function refreshState() {
  if (document.visibilityState === 'hidden') return;
  // Skip if a collection is currently loading to avoid clobbering it
  if (state.collections.some(c => c.status === 'loading' || c.status === 'updating')) return;
  // Skip if any deck is mid-add (nameStatus:'loading') — hydrateState would replace
  // state.players before saveToStorage runs, permanently losing the new deck
  if (state.players.some(p => p.decks.some(d => d.nameStatus === 'loading'))) return;
  // Rate-limit to once every 15 seconds
  if (Date.now() - _lastRefresh < 15_000) return;
  _lastRefresh = Date.now();
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    hydrateState(await res.json());
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

// ── Tab switching ─────────────────────────────────────────────────────────
function setTab(tab) {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.getElementById(`tab-${tab}`).style.display = '';
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tab-btn-${tab}`).classList.add('active');
  if (tab === 'sets')      initSetBrowser();
  if (tab === 'wants')     renderWantList();
  if (tab === 'available') initAvailable();
  if (tab === 'lands')     initLands();
  if (tab === 'admin')   { initAdmin(); adminRenderPlayerOpts(); }
  // Refresh shared data when switching to any tab that shows other users' content
  if (['players', 'wants', 'collections', 'sets', 'deckview'].includes(tab)) refreshState();
}

// auth functions are in auth.js (logout, authInit)

// ── Card image tooltip (list view) ────────────────────────────────────────
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

// ── Event listeners ───────────────────────────────────────────────────────
document.getElementById('urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') addFromUrl(); });
document.getElementById('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') addFromUrl(); });
document.getElementById('playerNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAddPlayer(); });

// ── Init ──────────────────────────────────────────────────────────────────
initTheme();
authInit().then(() => {
  loadFromStorage().then(() => {
    _lastRefresh = Date.now(); // don't re-fetch immediately after the initial load
    initCollapses();
    renderPlayers();
    renderCollections();
    renderResults();
  });
});
