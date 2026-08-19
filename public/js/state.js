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

/* The name this browser remembers, behind Available@'s "Who are you?" bar.
 *
 * The key lives here rather than in js/available.js because it is read by two
 * features now: the calendar it was written for, and myPlayerId() in
 * js/auth.js, which is how a deployment with no accounts at all still knows
 * whose shelf is whose. One key, one spelling of it. */
const AVAIL_NAME_KEY = 'avail_name';

// Breakpoints — the JS half of the three in css/tokens.css (--bp-sm/md/lg).
// Compare with < and >= so a boundary width lands on the same side here as it
// does in the stylesheet's (width < 900px) / (width >= 900px) rules.
const BP_SM = 640;   // compact phone
const BP_MD = 900;   // nav switches: bottom bar <-> sidebar, card modal <-> card tab
// ── State ─────────────────────────────────────────────────────────────────
const state = {
  collections: [],
  players:     [],
  /* No `sort` here. Every view's sort is a chain in the `mtgtools_sort`
   * preference, read through getSortChain — this held a mirror of the
   * Collections tab's first criterion for the table header to write and draw
   * an arrow on, and the header is a shortcut into that chain now. */
  renderTimer: null,
  version: 0,  // optimistic-concurrency version from server
  /* SUM(qty) per deck_id, server→client only (no whitelist). The built-deck
   * signal the Decks grid keys off — `deckCardCounts[id] > 0` is "imported" —
   * and already ownership-filtered by the server, so a deck missing here is
   * either unbuilt or one this requester may not see. */
  deckCardCounts: {},
};

let viewMode        = window.innerWidth < BP_SM ? 'grid' : 'list';
let pendingCsvKey   = null;
let pendingCsvName  = null;
let pendingCsvOwner = null;

// ── Storage (server DB with localStorage fallback) ────────────────────────
function stateToJSON() {
  return {
    players: state.players.map(p => ({
      // colorIdx and not color: the hex is dropped on the first save after
      // the palette move, having already been read for the slot it encoded.
      id: p.id, name: p.name, colorIdx: playerSlot(p),
      wantList: p.wantList || [],
      folders: p.folders || [],
      decks: p.decks.map(d => ({
        id: d.id, source: d.source, deckId: d.deckId || null, url: d.url || '',
        name: d.name, nameStatus: d.nameStatus === 'loaded' ? 'loaded' : 'pending',
        commander: d.commander || '', commanderImg: d.commanderImg || null,
        cardCount: d.cardCount || null, bracket: d.bracket || null, deckUrl: d.deckUrl || '',
        folderId: d.folderId || null, private: d.private || false,
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
    // Whose shelf it is, or null for the group's. A record written before
    // collections had owners has no field at all, and that is the same answer.
    owner: d.owner || null,
  }));

  /* A sort can name one collection's own quantities, so a stored sort is only
   * readable against the list of collections — which is this line, and only
   * this line. Asked here rather than when the Collections tab first renders,
   * because a tab that renders before its collections have arrived would read
   * every criterion naming one as naming a collection that is gone. See
   * reconcileColSorts in sortui.js. */
  reconcileColSorts(state.collections);

  // The server's ownership-filtered built-deck counts. Server→client only, so
  // it is read here but never written back through stateToJSON.
  state.deckCardCounts = data.deckCardCounts || {};

  state.players = (data.players || []).map(p => ({
    id: p.id, name: p.name, colorIdx: playerSlot(p),
    wantList: p.wantList || [],
    folders: p.folders || [],
    decks: (p.decks || []).map((d, i) => ({
      id: d.id || (d.deckId ? `arch_${d.deckId}` : `legacy_${p.id}_${i}`),
      source: d.source || 'manual', deckId: d.deckId || null, url: d.url || '',
      name: d.name || '', nameStatus: d.nameStatus || 'loaded',
      commander: d.commander || '', commanderImg: d.commanderImg || null,
      cardCount: d.cardCount || null, bracket: d.bracket || null, deckUrl: d.deckUrl || '',
      folderId: d.folderId || null, private: d.private || false,
      editing: false,
    })),
  }));
}

/* The offline cache — the blob loadFromStorage falls back to when the server
 * cannot be reached. Written by the save path below when the server refuses,
 * and re-written by a caller that rolled its change back afterwards: a refused
 * save has already put the optimistic value in here, so a rollback that left it
 * standing would hand the change back on the next offline load, after the app
 * had told the person it did not take. */
function cacheStateLocally() {
  const data = stateToJSON();
  if (typeof state.version === 'number') data.version = state.version;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

/* Save the whole state blob. Answers whether the *server* took it: a caller
 * that changed something on the strength of it (setDeckPrivate) has to be able
 * to put it back, and a write that only reached localStorage is a change the
 * next device will never see. Every caller that just wants the state saved can
 * go on ignoring the answer. */
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
      return false;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const json = await res.json().catch(() => ({}));
    if (typeof json.version === 'number') state.version = json.version;
    console.log(`[save] ✓ server accepted (version ${state.version})`);
    return true;
  } catch (e) {
    console.warn(`[save] ✗ server rejected (${e.message}), falling back to localStorage`);
  }
  cacheStateLocally();
  return false;
}

async function loadFromStorage() {
  try {
    const res = await fetch('/api/state');
    if (res.ok) {
      const json = await res.json();
      if (typeof json.version === 'number') state.version = json.version;
      hydrateState(json);
      return;
    }
  } catch (e) {
    console.warn('[load] server failed, falling back to localStorage:', e);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) hydrateState(JSON.parse(raw));
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
  // Which tabs' notes have been read. A list rather than the comma-separated
  // string the server stores, and never null: everything that reads it asks
  // `.includes(tab)`, and it has to be answerable on the first frame — before
  // any fetch has landed — or the first tab you open re-announces itself.
  faqSeen: [],
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

// ── Which notes have been read ────────────────────────────────────────────
/* The seen set's browser copy, which is the same two-sided arrangement the
 * theme and card motion have: with an account the server is the record and
 * this is a mirror the next load can read before the fetch lands; in open mode
 * there is nobody to hang it on, so this is the whole record. Either way the
 * rest of the app reads `prefs.faqSeen` and never knows which mode it is in.
 *
 * The ids are mirrored from FAQ's keys the way routes/prefs.js mirrors them
 * server-side. Storage is hand-editable, so what comes out of it is filtered
 * on the way in — an unknown id would otherwise be sent to the server, which
 * refuses it, and the browser would go on believing something the account
 * does not. */
const FAQ_SEEN_KEY = 'mtgtools_faq_seen';
const FAQ_TABS = ['deckview', 'collections', 'scryfall', 'sets', 'pick', 'lands', 'available'];

const knownFaqTabs = ids => [...new Set((ids || []).filter(id => FAQ_TABS.includes(id)))];

function readFaqSeen() {
  try { return knownFaqTabs((localStorage.getItem(FAQ_SEEN_KEY) || '').split(',')); }
  catch { return []; }
}

function rememberFaqSeen(ids) {
  try { localStorage.setItem(FAQ_SEEN_KEY, knownFaqTabs(ids).join(',')); } catch {}
}

// Second half of boot, called from syncPrefs() once there is a session.
function syncFaqSeen() {
  if (prefs.stored) rememberFaqSeen(prefs.faqSeen);
  else prefs.faqSeen = readFaqSeen();
}

/* A note has been read. The local set is updated and mirrored *first* and the
 * write follows, so a server that will not take it costs you the note on your
 * next device rather than a second dialog in this session. */
async function saveFaqSeen(tab) {
  if (!FAQ_TABS.includes(tab) || prefs.faqSeen.includes(tab)) return prefs;
  const next = [...prefs.faqSeen, tab];
  prefs.faqSeen = next;
  rememberFaqSeen(next);
  await savePrefs({ faqSeen: next });
  return prefs;
}

// ── Granular deck save (3.2) ──────────────────────────────────────────
// Answers whether the server took it, the way saveToStorage does — the
// fallback to the whole-state POST carries that answer through.
async function savePlayerDecks(playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return saveToStorage();
  const decks = player.decks.map(d => ({
    id: d.id, source: d.source, deckId: d.deckId || null, url: d.url || '',
    name: d.name, nameStatus: d.nameStatus === 'loaded' ? 'loaded' : 'pending',
    commander: d.commander || '', commanderImg: d.commanderImg || null,
    cardCount: d.cardCount || null, bracket: d.bracket || null, deckUrl: d.deckUrl || '',
    folderId: d.folderId || null, private: d.private || false,
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
      return true;
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
