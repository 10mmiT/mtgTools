// ── Constants ─────────────────────────────────────────────────────────────
const STORAGE_KEY    = 'mtgtools_v3';
const COLORS         = ['#a855f7','#3b82f6','#10b981','#f59e0b','#ec4899','#0ea5e9','#6366f1','#ef4444'];
const PLAYER_COLORS  = ['#f97316','#06b6d4','#84cc16','#e879f9','#fb7185','#34d399','#fbbf24','#60a5fa'];
// ── State ─────────────────────────────────────────────────────────────────
const state = {
  collections: [],
  players:     [],
  sort: { field: 'name', dir: 1 },
  renderTimer: null,
};

let viewMode       = 'list';
let pendingCsvKey  = null;
let pendingCsvName = null;

// ── Storage (server DB with localStorage fallback) ────────────────────────
function stateToJSON() {
  return {
    players: state.players.map(p => ({
      id: p.id, name: p.name, color: p.color,
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
    id: p.id, name: p.name, color: p.color || PLAYER_COLORS[0],
    wantList: p.wantList || [],
    decks: (p.decks || []).map(d => ({
      id: d.id, source: d.source || 'manual', deckId: d.deckId || null, url: d.url || '',
      name: d.name || '', nameStatus: d.nameStatus || 'loaded',
      commander: d.commander || '', commanderImg: d.commanderImg || null,
      cardCount: d.cardCount || null, bracket: d.bracket || null, deckUrl: d.deckUrl || '',
      editing: false,
    })),
  }));
}

async function saveToStorage() {
  const data = stateToJSON();
  try {
    const res = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return;
  } catch (e) {
    console.warn('Server save failed, falling back to localStorage:', e.message);
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

async function loadFromStorage() {
  try {
    const res = await fetch('/api/state');
    if (res.ok) { hydrateState(await res.json()); return; }
  } catch (e) {
    console.warn('Server load failed, falling back to localStorage:', e);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) hydrateState(JSON.parse(raw));
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────
function showError(el, msg) { el.textContent = msg; el.style.display = 'block'; }

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
