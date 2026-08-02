// ── Collapsible player sections ─────────────────────────────────────────
// The generic collapse machinery — initCollapses(), toggleSection(),
// applyCollapse() and the .section-body / .section-title.collapsible pair
// they drove — is gone with the last section that used it. Collections' add
// form became a drawer and its list a chip row (§9.1), Pick Night's deck
// pool became a drawer (§9.7), and Admin's Create User is a plain open form
// on a page of plain sections (§9.11). What is left is one collapsible that
// is not a section: a player's row of decks, which is a person's whole
// shelf and is worth folding away.
const collapseState = JSON.parse(localStorage.getItem('mtgtools_collapse') || '{}');

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
  closeAppearance(); // its position depends on the sidebar width
  const collapsed = nav.classList.toggle('collapsed');
  document.body.classList.toggle('sidenav-collapsed', collapsed);
  localStorage.setItem('mtgtools_sidenav', collapsed ? '1' : '0');
  _labelSideNavToggle(collapsed);
}

/* The button's label is hidden while the sidebar is collapsed, so the tooltip
 * is the only thing left saying what it does — and collapsed is now the state
 * most people are in. It used to read "Collapse sidebar" in both states. */
function _labelSideNavToggle(collapsed) {
  const btn = document.getElementById('sideNavToggle');
  if (!btn) return;
  btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
}

/* Collapsed is the default (§8.2). Only the default flipped — the toggle and
 * its persistence are unchanged, and someone who expands the sidebar still
 * finds it expanded next time.
 *
 * The stored value is now read for '0' rather than '1', so the absence of a
 * preference means collapsed. That silently re-collapses the sidebar for
 * anyone who had never touched the toggle, which is the intent: 140px of
 * every window was spent on eleven labels that are legible as icons.
 *
 * Nothing expands it on hover, deliberately — moving the pointer across the
 * nav on the way to a card would slide the whole grid sideways. */
function initSideNav() {
  if (localStorage.getItem('mtgtools_sidenav') === '0') { _labelSideNavToggle(false); return; }
  document.getElementById('sideNav')?.classList.add('collapsed');
  document.body.classList.add('sidenav-collapsed');
  _labelSideNavToggle(true);
}

/* ── Mobile header height ──────────────────────────────────────────────
 * Below 900px the header is sticky at the top of the window, and so is
 * each tab's toolbar; the toolbar has to stop under the header rather
 * than behind it. The header's height is its contents' — a logo, a badge
 * and a button, all of which can change — so it is measured rather than
 * written down as a number that would quietly stop matching. Above 900px
 * there is no header (it folds into the sidebar) and the toolbar's own
 * media query ignores this. */
function syncHeaderHeight() {
  const hdr = document.querySelector('header');
  const h = hdr && getComputedStyle(hdr).display !== 'none' ? hdr.offsetHeight : 0;
  document.documentElement.style.setProperty('--hdr-h', `${h}px`);
}
syncHeaderHeight();
window.addEventListener('resize', syncHeaderHeight);

// ── Theme ─────────────────────────────────────────────────────────────
// Five slots, differing by temperature rather than hue: cool dark, warm
// dark, cool light, warm light, high contrast.
const THEMES = [
  { id: 'dark',     label: 'Dark' },
  { id: 'light',    label: 'Light' },
  { id: 'contrast', label: 'High Contrast' },
  { id: 'sepia',    label: 'Sepia' },
  { id: 'dusk',     label: 'Dusk' },
];

// Retired ids, mapped on read: 'forest' was a green dark theme, and the slot
// was repainted warm-neutral and renamed 'dusk' because the old name would
// misdescribe it. Without this map, everyone who had chosen 'forest' falls
// silently back to Dark. public/login.html carries the same mapping, because
// it reads the preference before any of this has run.
const THEME_ALIASES = { forest: 'dusk' };

const _canonicalTheme = id => THEME_ALIASES[id] || id;

// applyTheme paints and remembers *in this browser*; it does not tell the
// server. The server is told by _pickTheme() below, which is what an explicit
// choice goes through — boot applies a theme too, and a boot that wrote back
// would overwrite the stored preference with the local one on every load,
// which is the exact opposite of following a user between devices.
function applyTheme(rawId) {
  // Canonicalising here rather than in initTheme means the retired id is
  // also rewritten in storage, so the mapping is paid once per user.
  const id = _canonicalTheme(rawId);
  document.documentElement.dataset.theme = id;
  localStorage.setItem('mtgtools_theme', id);
  // The two buttons that used to be labelled with the theme's name now say
  // "Appearance" and open a picker that ticks the current theme instead —
  // which is the same fact, told once, in the place it can be changed.
  document.querySelectorAll('.theme-pick-item').forEach(el =>
    el.classList.toggle('active', el.dataset.theme === id));
}

// A `?theme=` URL parameter overrides the stored preference (and is then stored
// itself, so the link is also the only way to clear a bad stored value without
// dev tools). An unknown id is ignored rather than applied, which would leave
// the page styled by a data-theme no stylesheet matches.
function _themeFromUrl() {
  const id = _canonicalTheme(new URLSearchParams(location.search).get('theme'));
  return THEMES.some(t => t.id === id) ? id : null;
}

// The theme is a person's, not a browser's: it is stored per user on the
// server (/api/prefs) so it follows them to the next device. Boot is in two
// halves because of that. This half runs before the session is even known and
// paints the first frame from localStorage — waiting for the fetch would show
// the wrong theme for as long as it takes, on every load. syncPrefs() below is
// the second half, and corrects the guess if the server disagrees.
let _urlTheme = null;

function initTheme() {
  _urlTheme = _themeFromUrl();
  applyTheme(_urlTheme || localStorage.getItem('mtgtools_theme') || 'dark');
}

/* Second half of boot, once there is a session to read a preference for.
 *
 * A `?theme=` parameter still wins, and is now written through to the server
 * as well as the browser. That matters more than it did: the link is the way
 * to recover from a stored theme that has made the app unreadable, and a
 * stored theme that follows you between devices is one you cannot escape by
 * clearing site data. */
async function syncPrefs() {
  const p = await loadPrefs();
  // The playmat's half of the same correction, and it runs either way: a
  // ?theme= link overrides the theme, not the mat.
  syncPlaymat();
  if (_urlTheme) { if (p.stored) savePrefs({ theme: _urlTheme }); return; }
  if (p.stored && p.theme) applyTheme(p.theme);
}

// An explicit choice: paint it, remember it here, and tell the server. Read
// back off the element rather than trusting the argument, so a retired id is
// stored under the name it was canonicalised to.
function _pickTheme(id) {
  applyTheme(id);
  _urlTheme = null;   // a pick supersedes whatever link opened the page
  savePrefs({ theme: document.documentElement.dataset.theme });
}

// A pick from the Appearance popover, which stays open: the point of putting
// the themes beside the playmat is being able to see one over the other, and
// a menu that shut on every pick would make comparing them a chore.
function setTheme(id) { _pickTheme(id); }

// ── Appearance popover (§10.7) ────────────────────────────────────────
// Theme, playmat, and the playmat's per-device switch, in one menu opened
// from the sidebar on a desktop and from the nav dropdown on a phone.
//
// It is always positioned against the button that opened it rather than
// living inside one of them. The theme menu already had to do this in its
// most common case — a collapsed sidebar is a 46px-wide overflow:hidden
// scroll container, and an absolutely-positioned menu is clipped inside it —
// so making it the only case removes a branch rather than adding one.
function toggleAppearance(e) {
  e?.stopPropagation();
  const menu = document.getElementById('appearanceMenu');
  if (!menu) return;
  if (menu.classList.contains('open')) { closeAppearance(); return; }

  // Opened from the phone's nav dropdown, the anchor is the dropdown's own
  // button: the menu below it is about to close, and a menu positioned
  // against a row inside it would be left pointing at nothing.
  const trigger = e?.currentTarget;
  const anchor  = trigger?.closest('#mobNav') ? document.getElementById('mobNavBtn') : trigger;
  const r = anchor?.getBoundingClientRect();
  closeMobNav();
  menu.classList.add('open');
  if (!r) return;

  menu.style.position = 'fixed';
  if (window.innerWidth >= BP_MD) {
    // Beside the sidebar button, bottom-aligned with it: the button sits at
    // the foot of the nav, with nothing below it to drop into.
    menu.style.left   = (r.right + 8) + 'px';
    menu.style.right  = 'auto';
    menu.style.top    = 'auto';
    menu.style.bottom = Math.max(8, window.innerHeight - r.bottom) + 'px';
  } else {
    menu.style.top    = (r.bottom + 6) + 'px';
    menu.style.right  = Math.max(8, window.innerWidth - r.right) + 'px';
    menu.style.left   = 'auto';
    menu.style.bottom = 'auto';
  }
}

function closeAppearance() {
  const menu = document.getElementById('appearanceMenu');
  if (!menu) return;
  menu.classList.remove('open');
  menu.style.position = menu.style.left = menu.style.right = menu.style.top = menu.style.bottom = '';
}

document.addEventListener('click', e => {
  if (!e.target.closest('#appearanceMenu, .appearance-trigger')) closeAppearance();
});

// ── Drawers ───────────────────────────────────────────────────────────
// A drawer is any element marked data-drawer: the Add Collection form, and
// the deck comparison panel below 1280px. One opens at a time and one scrim
// sits behind whichever it is, so closing is a single call from three places
// — the scrim, the ✕ and Escape.
function openDrawer(id) {
  const el = document.getElementById(id);
  if (!el) return;
  closeDrawers();
  el.classList.add('open');
  document.getElementById('drawerScrim')?.classList.add('open');
  // Focus the first field so the drawer can be typed into straight away.
  // Never the close button: opening a drawer to dismiss it is not the task.
  // The offsetHeight read is what makes it land: a closed drawer is
  // visibility: hidden, nothing hidden can take focus, and the class above
  // does not reach layout until something asks for it.
  const field = el.querySelector('input:not([type=file]), textarea, select');
  if (field) { void el.offsetHeight; field.focus(); }
}

function closeDrawers() {
  document.querySelectorAll('[data-drawer].open').forEach(el => el.classList.remove('open'));
  document.getElementById('drawerScrim')?.classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeDrawers(); closeAppearance(); }
});

// ── View mode ─────────────────────────────────────────────────────────
function setViewMode(mode) {
  viewMode = mode;
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
  deckview:    'Deck Builder',
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
    if (typeof json.version === 'number') state.version = json.version;
    hydrateState(json);
    renderPlayers();
    renderCollections();
    const activeTab = document.querySelector('.tab-btn.active')?.id?.replace('tab-btn-', '');
    if (activeTab === 'collections') renderResults();
    if (activeTab === 'wants')       renderWantList();
    if (activeTab === 'sets' && currentSet) renderSetCards();
    if (activeTab === 'deckview')    dbPopulateDeckSel();
  } catch {}
}

// Poll every 30 seconds while the page is open
setInterval(refreshState, 30_000);

// ── Tab switching ─────────────────────────────────────────────────────
// push = whether to add a browser-history entry (false when restoring from
// a back/forward navigation or on initial load).
function setTab(tab, push = true) {
  // A drawer belongs to the tab it is in, but the scrim behind it does not —
  // hiding the pane would leave the veil over the next tab with nothing
  // under it to dismiss.
  closeDrawers();
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
  if (tab === 'deckview')  initDeckBuilder();
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
  if (s.view === 'card-modal') {
    // Navigating back into a modal state — re-open it
    const host = document.getElementById('cardModalDetail');
    if (host && window.innerWidth >= BP_MD) {
      document.getElementById('cardModal').style.display = 'flex';
      document.body.style.overflow = 'hidden';
      if (s.cardName)    loadCard({ name: s.cardName }, 'cardModalDetail');
      else if (s.cardId) loadCard({ id: s.cardId }, 'cardModalDetail');
    } else {
      // Window is now below the modal breakpoint (resized/rotated since the
      // entry was pushed) — fall back to the full-page card tab so back/forward
      // doesn't silently do nothing.
      setTab('card', false);
      if (s.cardName)    loadCard({ name: s.cardName }, 'cardDetail');
      else if (s.cardId) loadCard({ id: s.cardId }, 'cardDetail');
    }
  } else if (s.view === 'card') {
    // Close modal if open
    const overlay = document.getElementById('cardModal');
    if (overlay) { overlay.style.display = 'none'; document.body.style.overflow = ''; }
    setTab('card', false);
    if (s.cardName)    loadCard({ name: s.cardName }, 'cardDetail');
    else if (s.cardId) loadCard({ id: s.cardId }, 'cardDetail');
  } else if (s.view === 'tab') {
    // Close modal if open when navigating to a different tab
    const overlay = document.getElementById('cardModal');
    if (overlay) { overlay.style.display = 'none'; document.body.style.overflow = ''; }
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
// Relies on mouseover/mouseout on the hovered .card-link to show/hide. This
// app re-renders lists by replacing innerHTML wholesale, so if that happens
// while the cursor sits over a link (e.g. clicking +/- qty, a checkbox, or
// the 30s background refresh), the element is destroyed without ever firing
// mouseout — the tooltip would otherwise be stuck on screen indefinitely.
// _tipLink + the isConnected check below catch that on the next mousemove;
// the click/scroll/visibility listeners catch it immediately even if the
// cursor never moves again.
const _tip    = document.getElementById('cardTooltip');
const _tipImg = document.getElementById('tooltipImg');
let _tipTimer = null;
let _tipLink  = null;

function _hideCardTooltip() {
  clearTimeout(_tipTimer);
  _tipLink = null;
  _tip.style.display = 'none';
}

document.addEventListener('mouseover', e => {
  const link = e.target.closest('.card-link');
  if (!link) return;
  clearTimeout(_tipTimer);
  _tipLink = link;
  _tipTimer = setTimeout(async () => {
    const name = link.dataset.name;
    if (!scryfallCache.has(name)) await ensureScryfallImages([name]);
    const uri = scryfallCache.get(name);
    if (!uri || !link.isConnected) return;
    _tipImg.src = uri;
    _tip.style.display = 'block';
  }, 120);
});

document.addEventListener('mouseout', e => {
  if (!e.target.closest('.card-link')) return;
  _hideCardTooltip();
});

document.addEventListener('mousemove', e => {
  if (_tip.style.display === 'none') return;
  if (_tipLink && !_tipLink.isConnected) { _hideCardTooltip(); return; }
  const W = 216, H = 300, pad = 14;
  const left = (e.clientX + pad + W > window.innerWidth)  ? e.clientX - pad - W : e.clientX + pad;
  const top  = (e.clientY - 20 + H > window.innerHeight)  ? window.innerHeight - H - 8 : e.clientY - 20;
  _tip.style.left = left + 'px';
  _tip.style.top  = top  + 'px';
});

_tipImg.addEventListener('error', _hideCardTooltip);

// Belt-and-suspenders: hide any open card tooltip/preview on click, scroll,
// or tab-hide, since those are the moments a stuck tooltip is most likely
// (and most jarring) — covers cases the per-element mouseout/isConnected
// checks above can't (no element to check against, or cursor never moves
// again after the click that triggered a re-render).
function _hideAllCardPreviews() {
  _hideCardTooltip();
  const dbPreview = document.getElementById('dbHoverPreview');
  if (dbPreview) dbPreview.style.display = 'none';
}
document.addEventListener('click', _hideAllCardPreviews, { capture: true });
document.addEventListener('scroll', _hideAllCardPreviews, { capture: true, passive: true });
document.addEventListener('visibilitychange', _hideAllCardPreviews);

// ── Event listeners ───────────────────────────────────────────────────
document.getElementById('urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') addFromUrl(); });
document.getElementById('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') addFromUrl(); });
document.getElementById('playerNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAddPlayer(); });

// ── Card modal events (Phase 5.1) ────────────────────────────────────
// The #cardModal markup sits after the <script> tags in index.html, so we
// must wait for DOMContentLoaded before binding (otherwise getElementById
// returns null and the close button / backdrop never get listeners).
function initCardModal() {
  const overlay  = document.getElementById('cardModal');
  const backdrop = document.getElementById('cardModalBackdrop');
  const closeBtn = document.getElementById('cardModalClose');
  if (!overlay) return;

  function close() { if (typeof closeCardModal === 'function') closeCardModal(); }

  backdrop?.addEventListener('click', close);
  closeBtn?.addEventListener('click', close);

  // Click on the overlay's padding area (outside the box) also closes
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') close();
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCardModal);
} else {
  initCardModal();
}

// ── Init ──────────────────────────────────────────────────────────────
initTheme();
initSideNav();
initPlaymatPicker();  // the mat itself was applied in <head>; this is its picker
initWantField();      // the other card field in static markup; see mountCardAutocomplete
authInit().then(() => {
  syncPrefs();   // not awaited: appearance is already painted, this only corrects it
  loadFromStorage().then(() => {
    _lastRefresh = Date.now(); // don't re-fetch immediately after the initial load
    renderPlayers();
    renderCollections();
    mountViewToggle('colViewMount', ['list', 'grid'], () => viewMode, setViewMode);
    setViewMode(viewMode); // renders results with the restored view mode
    initAvailable(); // Available is the default tab — start loading it immediately
    initRouting();   // wire up browser back/forward + restore any deep-linked view
  });
});
