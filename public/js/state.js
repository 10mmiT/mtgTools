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
  /* Collections the *server* is fetching right now, newest run last. Not a
   * mirror of `collections`: an import has no cards to show until it lands,
   * and one that was cut off outlives the tab that started it. Server to
   * client only — the browser starts and stops imports through their own
   * routes, never by writing this back. See collection-import.js. */
  imports:     [],
  /* No `sort` here. Every view's sort is a chain in the `mtgtools_sort`
   * preference, read through getSortChain — this held a mirror of the
   * Collections tab's first criterion for the table header to write and draw
   * an arrow on, and the header is a shortcut into that chain now. */
  renderTimer: null,
  version: 0,  // optimistic-concurrency version from server
  /* The revision the last whole payload arrived stamped with, and what the
   * next poll asks "anything newer than this?" with — not `version`, which is
   * narrower and is the concurrency check's; see stateRev in routes/state.js
   * for what each covers. Server→client only, and opaque: never ours to read
   * a part of.
   *
   * Set only where a whole payload is taken in, never from a save's answer —
   * a POST tells us our own write landed, not what else has happened
   * elsewhere since we last looked. */
  rev: null,
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

/** A field somebody actually filled in. */
const printingSaid = v => typeof v === 'string' && v.trim() !== '';

/* Whether an entry points at a real card, which is what tells a printing from
 * the unknown entry. namesPrinting in available-db.js is the same rule, said
 * again because there is no module system spanning public/js and the server:
 * a Scryfall id, or a set with a collector number — and Moxfield's CSV export
 * carries only the second, no id anywhere in the file. A set code with no
 * number is not half a printing; it is the unknown entry, and the card's name
 * may not be used to finish it. */
const namesPrinting = p =>
  !!p && (printingSaid(p.id) || (printingSaid(p.set) && printingSaid(p.collector_number)));

/* The fields that make a printing, in the order they are written down, and
 * what two copies have to agree on to be the same physical card — the browser
 * side of CARD_PRINTING_FIELDS and printingKey in available-db.js, said again
 * for the same reason namesPrinting is. A collection parsed in this tab folds
 * its copies with this long before the server has seen a byte of it, and an
 * importer with its own idea of what makes two copies the same card is how
 * the two quietly stop agreeing. */
const CARD_PRINTING_FIELDS =
  ['id', 'set', 'set_name', 'collector_number', 'finish', 'lang', 'condition'];

const cardPrintingKey = p =>
  namesPrinting(p) ? CARD_PRINTING_FIELDS.map(f => p[f] || '').join(' ') : ' unknown';

/* Which printings of a card are on a shelf — the browser's one answer to it.
 *
 * The server sends the breakdown on every card, unknown entries and all (see
 * readCardPrintings in available-db.js), so most of the time this is just the
 * field. It exists anyway, and everything reads printings through it, because
 * a collection the browser built itself — a CSV parsed in this tab, which has
 * never been near the server's shape helpers — has no such field, and the
 * honest answer for it is *unknown* and never *owns none*.
 *
 * Derived where it is read rather than stamped onto every card at hydration:
 * a twelve-thousand-card shelf is re-hydrated on every poll, and the few
 * hundred rows actually on screen are the only ones anybody asks about. */
function cardPrintings(card) {
  const qty  = Math.max(0, Math.trunc(Number(card?.qty)) || 0);
  const list = Array.isArray(card?.printings) ? card.printings : [];
  const out  = [];
  let attributed = 0;
  for (const p of list) {
    const n = Math.max(0, Math.trunc(Number(p?.qty)) || 0);
    if (!n) continue;
    out.push({ ...p, id: typeof p.id === 'string' && p.id ? p.id : null, qty: n });
    attributed += n;
  }
  if (attributed < qty) {
    const unknown = out.find(p => !namesPrinting(p));
    if (unknown) unknown.qty += qty - attributed;
    else out.push({ id: null, qty: qty - attributed });
  }
  return out;
}

/* Whether two copies are the same card to somebody asking whether they own
 * one. Narrower than the shelf's own idea of a copy's identity, and
 * deliberately: the shelf files a copy under its Scryfall id, its finish, its
 * language *and* its condition, because those are what tell two physical
 * cards apart in a box. None of that makes a lightly played German Sol Ring a
 * different card from the one a deck runs — you own it, and you can sleeve
 * it — so language and condition roll up here and finish does not. A foil is
 * priced separately and is a different thing to run, which is the whole
 * reason a deck can name one.
 *
 * Null for the copies nobody has attributed to a printing — and null too for
 * the ones a shelf knows only as a set and a number, which is everything a
 * Moxfield CSV holds. Those are a printing to look at and to count; they are
 * not one to hold against a deck's chosen id, because the deck names a
 * Scryfall id and nothing here can say whether it is this one without asking
 * Scryfall. Both must never answer for a printing, which is what keeps "we do
 * not know which" from reading as "the wrong one".
 *
 * The ordinary finish is the absence of one — the same spelling readPrinting()
 * enforces on the way in — so a printing that says `nonfoil` out loud and one
 * that says nothing are one printing here rather than two. */
const printingIdentity = printing =>
  printing && typeof printing.id === 'string' && printing.id
    ? `${printing.id} ${printing.finish && printing.finish !== 'nonfoil' ? printing.finish : ''}`
    : null;

function hydrateState(raw) {
  // Migrate old bare-array format
  const data = Array.isArray(raw) ? { collections: raw, players: [] } : raw;

  /* The revision this payload was cut at, adopted here because here is where
   * every whole payload lands — the first load, a reload after an import, the
   * poll. A blob restored from localStorage has none, and leaving the old one
   * standing is right: it says what the server last told us, and the next poll
   * is what corrects it. */
  if (typeof data.rev === 'string') state.rev = data.rev;

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

  /* Imports ride along with /api/state so a tab opening mid-import shows it at
   * once. A payload that predates the feature has no field, which is not the
   * same as "none running" — but the only readers are the chips and the
   * panel, and both draw nothing for an empty list, so the two agree here. */
  if (Array.isArray(data.imports)) state.imports = data.imports;

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

// ── Saves in flight ───────────────────────────────────────────────────────
/* Every write this tab makes to the shared state moves this twice: once as it
 * leaves and once as it lands. The poll (refreshState in main.js) reads it
 * before it asks and again when the answer arrives, and a number that moved in
 * between means the answer was cut on one side of a save of ours and is
 * arriving on the other. Hydrating it would put the screen back to before the
 * save — and the version with it, so the next save would be refused as stale
 * by the server it had just been accepted by. That answer is thrown away, and
 * the next poll asks again.
 *
 * The count beside it is the other half: a save that left before the poll
 * asked and is still out when the answer lands moved the number before the
 * poll read it, so only "is one still out?" can catch it. */
let stateSaveSeq       = 0;
let stateSavesInFlight = 0;

async function _trackStateSave(write) {
  stateSaveSeq++;
  stateSavesInFlight++;
  try { return await write(); }
  finally { stateSaveSeq++; stateSavesInFlight--; }
}

// ── When a save does not take ─────────────────────────────────────────────
/* Said where it can be seen, and without stopping anything. The want toast
 * (js/auth.js) is the app's one notice that is not a dialog, so this is that
 * same component in the danger pair — non-blocking because a save that did not
 * take is something to know rather than something to answer, and the next edit
 * should not have to get past a dialog first. Its own element rather than the
 * toast's, so a "✓ Added" a moment later is not drawn in red.
 *
 * A save the server refused says the server's reason instead of this: "Deck …
 * already belongs to another player" is not something reloading will fix. */
const SAVE_FAILED_NOTICE = 'Couldn’t save — your change is only on this device. Reload to retry.';

function showSaveNotice(text = SAVE_FAILED_NOTICE) {
  // A notice that cannot be drawn is no reason for the save path to throw.
  try {
    if (typeof document === 'undefined' || !document.body) return;
    let notice = document.getElementById('saveNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'saveNotice';
      notice.className = 'want-toast want-toast--error';
      notice.setAttribute('role', 'alert');
      document.body.appendChild(notice);
    }
    notice.textContent = text;
    notice.classList.add('visible');
    clearTimeout(notice._timer);
    // Longer than the toast's 2.8 s: this is a sentence with an instruction in it.
    notice._timer = setTimeout(() => notice.classList.remove('visible'), 6000);
  } catch {}
}

/* A 401 has nobody to save as: the session ended, by expiring or by signing
 * out in another tab. The same way out authInit takes. */
function goToLogin() {
  if (typeof window !== 'undefined' && window.location) window.location.href = '/login';
}

/* A save that never reached the server, or one the server could not answer:
 * kept in the offline cache, and said. */
function _stateSaveFailed() {
  cacheStateLocally();
  showSaveNotice();
  return false;
}

/* A save the server answered with something other than yes. Answers false,
 * for the caller to pass on. */
async function _stateSaveRefused(status, body = {}) {
  if (status === 401) { goToLogin(); return false; }
  if (status === 409 && body.conflict === 'version') {
    // Conflict: another session wrote state while we were editing.
    // Re-fetch the latest state and notify the user.
    console.warn('[save] 409 Conflict — re-fetching latest state');
    await loadFromStorage();
    if (typeof renderAll === 'function') renderAll();
    alert('Your changes could not be saved because another session updated the state at the same time. The page has been refreshed with the latest data — please redo your change.');
    return false;
  }
  if (status === 400 || status === 403 || status === 409) {
    /* Refused: a deck or a name that is somebody else's, a value it will not
     * store, a player that is not yours to change. Sending it again sends the
     * same thing, so the tab is put back to what the server holds and told
     * why. Left on screen, the refused change would ride along with every
     * save after it and sink each of them the same way. */
    console.warn(`[save] ✗ server refused (${status}: ${body.error || 'no reason given'}) — re-fetching`);
    await loadFromStorage();
    if (typeof renderAll === 'function') renderAll();
    showSaveNotice(body.error ? `Couldn’t save: ${body.error}` : SAVE_FAILED_NOTICE);
    return false;
  }
  console.warn(`[save] ✗ server failed (${status}), falling back to localStorage`);
  return _stateSaveFailed();
}

/* Save the whole state blob. Answers whether the *server* took it: a caller
 * that changed something on the strength of it (setDeckPrivate) has to be able
 * to put it back, and a write that only reached localStorage is a change the
 * next device will never see. Every caller that just wants the state saved can
 * go on ignoring the answer — a save that did not take says so itself. */
async function saveToStorage() {
  const data = stateToJSON();
  // The version this copy was made from — required, and held to it: see
  // POST /api/state.
  if (typeof state.version === 'number') data.version = state.version;
  const deckSummary = data.players.map(p => `${p.name}:[${p.decks.map(d => d.name).join(',')}]`).join(' ');
  console.log(`[save] POST /api/state — players: ${deckSummary || '(none)'}`);
  return _trackStateSave(async () => {
    let res, body;
    try {
      res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      console.warn(`[save] ✗ server unreachable (${e.message}), falling back to localStorage`);
      return _stateSaveFailed();
    }
    if (!res.ok) return _stateSaveRefused(res.status, body);
    if (typeof body.version === 'number') state.version = body.version;
    console.log(`[save] ✓ server accepted (version ${state.version})`);
    return true;
  });
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

/* Is anything half-arrived that a poll would land on top of?
 *
 * Two things in this app exist in the tab before they exist on the server: a
 * CSV being read out of a file the browser was handed, and a deck whose name
 * is still being fetched from Archidekt. Hydrating a payload over either
 * throws away the half that is only in memory, so the poll asks this first and
 * waits for the next one.
 *
 * A server-side import is not one of them. Its cards are nowhere in memory to
 * be hydrated over — they sit in collection_imports until the whole thing
 * lands — so refreshing during one is safe, and refusing to for the four
 * minutes an import takes would freeze every other tab's data.
 *
 * Two more things are half-arrived in the same sense. A save of ours still in
 * the air: the poll's answer may have been cut before it landed (see
 * stateSaveSeq above). And a form somebody is typing into — a deck's Edit, a
 * player's + Add Deck — which the render a poll ends in would rebuild from
 * scratch, closing it and taking what was typed with it. The poll waits for
 * the form to be saved or put away; the save that follows a form that is
 * stale by then is answered with a 409 and a reload, which is the safe way for
 * that to fall. */
function stateIsMidFlight() {
  return stateSavesInFlight > 0
      || state.collections.some(c => c.status === 'loading' || c.status === 'updating' || c.updating)
      || state.players.some(p => (p.decks || []).some(d => d.nameStatus === 'loading' || d.editing))
      || (typeof document !== 'undefined' && !!document.querySelector?.('.add-deck-form.open'));
}

/* A polled payload, taken in — or not. Answers whether it was, so the caller
 * knows whether there is anything new to draw.
 *
 * `saves` is what stateSaveSeq read when the poll asked. If it has moved, a
 * save of ours left or landed while the answer was on its way, and the answer
 * may be from before it: thrown away, and the next poll asks again. So is one
 * that would arrive on top of something half-arrived (stateIsMidFlight), which
 * may have started since the poll asked.
 *
 * And the version is never lowered. A payload older than the version this tab
 * already holds was cut before something this tab has since seen land, and is
 * not the newer of the two however it got here. */
function takePolledState(json, saves) {
  if (!json || saves !== stateSaveSeq || stateIsMidFlight()) return false;
  if (typeof json.version === 'number') {
    if (json.version < state.version) return false;
    state.version = json.version;
  }
  hydrateState(json);
  return true;
}

/* The poll's fetch: the whole state, but only when there is a new one.
 *
 * The revision goes up with the ask and the server answers `unchanged` without
 * building a payload at all, which is the point — this used to be a full
 * download every thirty seconds, stringified at both ends to discover that
 * nobody had touched anything. Nothing here serialises the payload, and
 * nothing may: the answer to "did it change?" is the server's.
 *
 * Answers with the payload to render from, or null for nothing to do —
 * unchanged, unreachable, or refused all read the same to a caller whose only
 * other option is to try again in thirty seconds. */
async function fetchStateIfChanged() {
  try {
    const res = await fetch('/api/state' + (state.rev ? `?since=${encodeURIComponent(state.rev)}` : ''));
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.unchanged ? null : json;
  } catch { return null; }
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
//
// It replaces the player's whole deck list with this tab's copy, so it names
// the version that copy was made from and the server holds it to it, as it
// does the whole-state POST: a stale copy is missing whatever deck another
// device added since, and would delete it. A refusal is the server's answer
// about this list and is answered here; only a server that could not answer
// at all is worth the second try down the whole-state path.
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
  const version = state.version;
  const answer = await _trackStateSave(async () => {
    try {
      const res = await fetch(`/api/players/${encodeURIComponent(playerId)}/decks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decks, version }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        // The version after this write — one past the version it was held
        // to, so nothing else is in it and it is ours to adopt.
        if (typeof body.version === 'number') state.version = body.version;
        console.log(`[save] ✓ PUT /api/players/${playerId}/decks (version ${state.version})`);
        return true;
      }
      if (res.status < 500 && res.status !== 404) return _stateSaveRefused(res.status, body);
      console.warn(`[save] granular deck save returned ${res.status}, falling back`);
    } catch (e) {
      console.warn('[save] granular deck save failed, falling back:', e.message);
    }
    return null;
  });
  return answer === null ? saveToStorage() : answer;
}

// ── Want lists ────────────────────────────────────────────────────────────
/* Whether a want-list patch's version keeps this tab in step — adopting it
 * when it does.
 *
 * The patch was made on the server against whatever was stored, not against
 * this tab's copy (see the want routes in routes/state.js), so the version it
 * answers with is only this tab's to adopt when nothing else was written in
 * between: one past its own when the patch wrote, its own when there was
 * nothing to write. Anything else is somebody else's write the tab has not
 * seen, and adopting that number would hand the next whole-state save a
 * version it never synced to — which the server would accept, and overwrite
 * them with. */
function adoptPatchVersion(answer) {
  const version = answer?.version;
  if (typeof version !== 'number') return true;
  if (answer.changed === false) return version === state.version;
  if (version === state.version + 1) { state.version = version; return true; }
  return false;
}

/* The tab has learnt its copy of the state is behind the server's. Asked for
 * now rather than at the next poll — and through the poll (refreshStateNow in
 * main.js), so the same rules about saves in flight and open forms decide
 * whether it may land yet. A tab without it — a test harness — waits for a
 * poll that never comes, which is the same as the next save's 409. */
function stateFellBehind() {
  if (typeof refreshStateNow === 'function') refreshStateNow();
}

/* A card onto a player's want list, or off it. Every place that does either —
 * the Want Lists tab, the quick-add beside a card, the deck's "Want all" —
 * comes through here, because what the answer means for this tab's copy of
 * the state is one rule (adoptPatchVersion) and four copies of it would be
 * four chances to adopt a version that was not ours.
 *
 * Answers the server's reply, or null when there is no session to write it as
 * (and the page is on its way to the login). Throws with the server's reason
 * when it is refused, for the caller to say. */
async function writeWant(playerId, cardName, remove = false) {
  const base = `/api/players/${encodeURIComponent(playerId)}/wants`;
  let behind = false;
  const answer = await _trackStateSave(async () => {
    const res = await fetch(remove ? `${base}/${encodeURIComponent(cardName)}` : base, remove
      ? { method: 'DELETE' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardName }) });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) { goToLogin(); return null; }
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    behind = !adoptPatchVersion(body);
    return body;
  });
  // Once this save has landed, or the refresh would be waiting on it.
  if (behind) stateFellBehind();
  return answer;
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
    return `<i class="ms ms-${esc(cls)} ms-cost ms-shadow" title="${esc(match)}"></i>`;
  });
}

/* Text made safe for HTML — an element's content or a quoted attribute, either
 * quote. Anything at all comes in: a number is its digits (0 included, which
 * used to come out as nothing) and only null/undefined are empty. */
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* A picture's address for a style attribute's url('…'), or '' for anything
 * that is not http(s). The server refuses anything else on the way in, and
 * this is the same rule where it is drawn: the characters that would close the
 * quotes or the url( are percent-encoded — which a real address already is —
 * and esc() around the result still does the attribute's part. */
function cssUrl(u) {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return '';
  // encodeURIComponent covers all of them but the three it leaves alone.
  return u.replace(/["'()\\\s<>]/g, c => ({ "'": '%27', '(': '%28', ')': '%29' })[c] || encodeURIComponent(c));
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
