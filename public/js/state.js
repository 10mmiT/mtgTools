// ── Constants ─────────────────────────────────────────────────────────────
const STORAGE_KEY    = 'mtgtools_v3';
// NOT exempt from the token rule, just not this ticket's to move: a default
// written into stored collection records, so replacing it means migrating
// rows that already hold a hex value — and there is no --collection-N token
// to move it onto. The player palette that stood beside it has moved; see
// PLAYER_SLOTS below.
const COLORS         = ['#a855f7','#3b82f6','#10b981','#f59e0b','#ec4899','#0ea5e9','#6366f1','#ef4444'];

// ── Player colour (§5.6, --player-0…7) ────────────────────────────────────
// A player's colour is a *slot*, not a value: which of the eight it has is
// the player's, what that slot looks like is the theme's. That is the whole
// point of the move — the old hex palette was written for the dark theme and
// nothing repainted it, so a light-theme chip was neon on white.
//
// The slot lives in the record as `colorIdx`. Records written before this
// change hold a hex instead, and it says the same thing: the palette was
// assigned by position, so a stored colour's index in it *is* the slot.
// Hence one derivation, used everywhere, which reads either form.
const PLAYER_SLOTS = 8;
// Read-only. The colours no longer paint anything; the list is how a record
// written before the move says which slot it has.
const LEGACY_PLAYER_COLORS =
  ['#f97316','#06b6d4','#84cc16','#e879f9','#fb7185','#34d399','#fbbf24','#60a5fa'];

function playerSlot(player) {
  if (Number.isInteger(player?.colorIdx))
    return ((player.colorIdx % PLAYER_SLOTS) + PLAYER_SLOTS) % PLAYER_SLOTS;
  const legacy = LEGACY_PLAYER_COLORS.indexOf(player?.color);
  if (legacy >= 0) return legacy;
  // Neither form: a record with no colour at all, or one holding a hex from
  // some other palette. Anything but a constant — a shared default would put
  // every such player on slot 0 and make them indistinguishable.
  let h = 0;
  for (const ch of String(player?.id || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % PLAYER_SLOTS;
}

// The value to put in CSS. Interpolated into style="" attributes across four
// tabs, so it returns the var() reference rather than a resolved colour —
// resolving it here would freeze the theme in place at render time.
function playerColor(player) { return `var(--player-${playerSlot(player)})`; }

// Breakpoints — the JS half of the three in css/tokens.css (--bp-sm/md/lg).
// Compare with < and >= so a boundary width lands on the same side here as it
// does in the stylesheet's (width < 900px) / (width >= 900px) rules.
const BP_SM = 640;   // compact phone
const BP_MD = 900;   // nav switches: bottom bar <-> sidebar, card modal <-> card tab
// ── State ─────────────────────────────────────────────────────────────────
const state = {
  collections: [],
  players:     [],
  sort: { field: 'name', dir: 1 },
  renderTimer: null,
  version: 0,  // optimistic-concurrency version from server
};

let viewMode       = window.innerWidth < BP_SM ? 'grid' : 'list';
let pendingCsvKey  = null;
let pendingCsvName = null;

// ── Storage (server DB with localStorage fallback) ────────────────────────
function stateToJSON() {
  return {
    players: state.players.map(p => ({
      // colorIdx and not color: the hex is dropped on the first save after
      // the palette move, having already been read for the slot it encoded.
      id: p.id, name: p.name, colorIdx: playerSlot(p),
      wantList: p.wantList || [],
      decks: p.decks.map(d => ({
        id: d.id, source: d.source, deckId: d.deckId || null, url: d.url || '',
        name: d.name, nameStatus: d.nameStatus === 'loaded' ? 'loaded' : 'pending',
        commander: d.commander || '', commanderImg: d.commanderImg || null,
        cardCount: d.cardCount || null, bracket: d.bracket || null, deckUrl: d.deckUrl || '',
      })),
    })),
  };
}

function hydrateState(raw) {
  // Migrate old bare-array format
  const data = Array.isArray(raw) ? { collections: raw, players: [] } : raw;

  state.collections = (data.collections || []).map(d => ({
    key: d.key, name: d.name, source: d.source, id: d.id || null,
    color: d.color || COLORS[0], cards: new Map(Object.entries(d.cards || {})),
    status: 'loaded', entries: d.entries || 0, total: d.total || null,
    error: null, savedAt: d.savedAt || null, updating: false,
  }));

  state.players = (data.players || []).map(p => ({
    id: p.id, name: p.name, colorIdx: playerSlot(p),
    wantList: p.wantList || [],
    decks: (p.decks || []).map((d, i) => ({
      id: d.id || (d.deckId ? `arch_${d.deckId}` : `legacy_${p.id}_${i}`),
      source: d.source || 'manual', deckId: d.deckId || null, url: d.url || '',
      name: d.name || '', nameStatus: d.nameStatus || 'loaded',
      commander: d.commander || '', commanderImg: d.commanderImg || null,
      cardCount: d.cardCount || null, bracket: d.bracket || null, deckUrl: d.deckUrl || '',
      editing: false,
    })),
  }));
}

async function saveToStorage() {
  const data = stateToJSON();
  // Include the current version for optimistic concurrency check
  if (typeof state.version === 'number') data.version = state.version;
  const deckSummary = data.players.map(p => `${p.name}:[${p.decks.map(d => d.name).join(',')}]`).join(' ');
  console.log(`[save] POST /api/state — players: ${deckSummary || '(none)'}`);
  try {
    const res = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.status === 409) {
      // Conflict: another session wrote state while we were editing.
      // Re-fetch the latest state and notify the user.
      console.warn('[save] 409 Conflict — re-fetching latest state');
      await loadFromStorage();
      if (typeof window !== 'undefined' && typeof renderAll === 'function') renderAll();
      alert('Your changes could not be saved because another session updated the state at the same time. The page has been refreshed with the latest data — please redo your change.');
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const json = await res.json().catch(() => ({}));
    if (typeof json.version === 'number') state.version = json.version;
    console.log(`[save] ✓ server accepted (version ${state.version})`);
    return;
  } catch (e) {
    console.warn(`[save] ✗ server rejected (${e.message}), falling back to localStorage`);
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

async function loadFromStorage() {
  console.log('[load] loadFromStorage called');
  try {
    const res = await fetch('/api/state');
    if (res.ok) {
      const json = await res.json();
      const deckSummary = (json.players || []).map(p => `${p.name}:[${(p.decks||[]).map(d=>d.name).join(',')}]`).join(' ');
      console.log(`[load] server returned — players: ${deckSummary || '(none)'}, version: ${json.version}`);
      if (typeof json.version === 'number') state.version = json.version;
      hydrateState(json);
      return;
    }
  } catch (e) {
    console.warn('[load] server failed, falling back to localStorage:', e);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { console.log('[load] using localStorage fallback'); hydrateState(JSON.parse(raw)); }
  } catch {}
}

// ── Appearance preferences (server DB with localStorage fallback) ─────────
// The same shape as the storage above, for the same reason: a preference that
// lives only in a browser has to be set again on every device. What differs is
// which side wins. State is the server's and the browser is the fallback;
// appearance is painted before the fetch can land, so the browser paints first
// and the server corrects it — see initTheme/syncPrefs in main.js.
//
// `stored` says whether the server is keeping any of this. It is false in open
// mode, where there are no accounts, and false whenever the request fails; in
// both cases localStorage is the whole record.
const prefs = {
  ...{ theme: null, playmatKind: 'none', playmatRef: null, playmatUrl: null, cardMotion: 'on' },
  stored: false,
};

async function loadPrefs() {
  try {
    const res = await fetch('/api/prefs');
    if (res.ok) { Object.assign(prefs, await res.json()); return prefs; }
    console.warn(`[prefs] server returned ${res.status} — using local preferences`);
  } catch (e) {
    console.warn(`[prefs] load failed (${e.message}) — using local preferences`);
  }
  prefs.stored = false;
  return prefs;
}

// Takes a patch, not the whole record: the server merges it onto what is
// already there, so setting a theme cannot clear a playmat.
async function savePrefs(patch) {
  Object.assign(prefs, patch);
  try {
    const res = await fetch('/api/prefs', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    });
    if (res.ok) { Object.assign(prefs, await res.json()); return prefs; }
    console.warn(`[prefs] server rejected (${res.status}) — kept locally only`);
  } catch (e) {
    console.warn(`[prefs] save failed (${e.message}) — kept locally only`);
  }
  prefs.stored = false;
  return prefs;
}

// ── Granular deck save (3.2) ──────────────────────────────────────────
async function savePlayerDecks(playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return saveToStorage();
  const decks = player.decks.map(d => ({
    id: d.id, source: d.source, deckId: d.deckId || null, url: d.url || '',
    name: d.name, nameStatus: d.nameStatus === 'loaded' ? 'loaded' : 'pending',
    commander: d.commander || '', commanderImg: d.commanderImg || null,
    cardCount: d.cardCount || null, bracket: d.bracket || null, deckUrl: d.deckUrl || '',
  }));
  try {
    const res = await fetch(`/api/players/${encodeURIComponent(playerId)}/decks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decks }),
    });
    if (res.ok) {
      // Server bumps the state version on granular writes — adopt it so the
      // next whole-state POST doesn't 409 with a stale version.
      const json = await res.json().catch(() => ({}));
      if (typeof json.version === 'number') state.version = json.version;
      console.log(`[save] ✓ PUT /api/players/${playerId}/decks (version ${state.version})`);
      return;
    }
    console.warn(`[save] granular deck save returned ${res.status}, falling back`);
  } catch (e) {
    console.warn('[save] granular deck save failed, falling back:', e.message);
  }
  return saveToStorage();
}

// ── Helpers ───────────────────────────────────────────────────────────────
function showError(el, msg) { el.textContent = msg; el.style.display = 'block'; }

// Render a Cardmarket (EUR) price from a Scryfall card object.
function renderPrice(card) {
  const eur = card?.prices?.eur;
  if (!eur) return '';
  return `<span class="card-price">€${parseFloat(eur).toFixed(2)}</span>`;
}

// Render a Scryfall mana cost string like "{2}{W}{B}" as mana-font icons.
// Falls back to escaped text for any symbol the font doesn't cover.
function renderMana(cost) {
  if (!cost) return '';
  return cost.replace(/\{([^}]+)\}/g, (match, sym) => {
    let cls = sym.toLowerCase().replace(/\//g, ''); // {W/U} → wu
    if (cls === 't')  cls = 'tap';
    if (cls === 'q')  cls = 'untap';
    return `<i class="ms ms-${cls} ms-cost ms-shadow" title="${esc(match)}"></i>`;
  });
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Escape a value for safe use inside a single-quoted JS string in an inline
// on* handler, e.g. onclick="fn('${jsAttr(name)}')". esc() alone does not
// escape the single quote, so apostrophes (Urza's Saga) break the handler and
// the click silently fails. This also escapes backslashes.
function jsAttr(s) {
  if (s == null) return '';
  return esc(String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

// ── Relative time ─────────────────────────────────────────────────────────
function relTime(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Normalise URL ─────────────────────────────────────────────────────────
function normaliseUrl(raw) {
  raw = (raw || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  return raw;
}
