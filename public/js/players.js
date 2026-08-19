// ── Parse deck URL ────────────────────────────────────────────────────────
function parseDeckUrl(raw) {
  raw = (raw || '').trim();
  if (!raw) return null;
  const ark = raw.match(/archidekt\.com\/decks?\/(\d+)/i);
  if (ark) return { source: 'archidekt', deckId: ark[1] };
  return null;
}

// ── Fetch deck data from server proxy ─────────────────────────────────────
async function fetchDeckData(source, deckId) {
  const url = source === 'moxfield'
    ? `/api/moxfield/deck/${deckId}`
    : `/api/archidekt/deck/${deckId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  const name    = data.name || 'Unnamed deck';
  const cards   = new Map();
  let commander = '';
  let cardCount = 0;
  let bracket   = null;
  let deckUrl   = '';

  if (source === 'archidekt') {
    deckUrl = `https://archidekt.com/decks/${deckId}`;
    bracket = data.deckBracket ?? data.powerLevel ?? null;

    for (const item of (data.cards || [])) {
      const cardName = item.card?.oracleCard?.name || item.card?.name || '';
      const qty = item.quantity || 0;
      if (!cardName || qty <= 0) continue;
      if (!commander && (item.categories || []).some(c => /commander/i.test(c)))
        commander = cardName;
      const ex = cards.get(cardName);
      if (ex) ex.qty += qty; else cards.set(cardName, { name: cardName, qty });
      cardCount += qty;
    }
  }

  return { name, cards, commander, cardCount, bracket, deckUrl };
}

// ── Player management ─────────────────────────────────────────────────────

function addPlayerByName(name) {
  if (!name) return false;
  state.players.push({
    id:       (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `p_${Date.now()}`,
    name,
    colorIdx: state.players.length % PLAYER_SLOTS,
    decks:    [],
    wantList: [],
    folders:  [],
  });
  saveToStorage();
  renderPlayers();
  renderWantList();
  return true;
}

function confirmAddPlayer() {
  const inp = document.getElementById('playerNameInput');
  if (addPlayerByName(inp.value.trim())) { inp.value = ''; closeAddPlayer(); }
}

// Progressive disclosure: the add-player bar shows a single button until clicked
function openAddPlayer() {
  document.getElementById('addPlayerRevealBtn').style.display = 'none';
  document.getElementById('addPlayerForm').style.display = 'flex';
  document.getElementById('playerNameInput').focus();
}

function closeAddPlayer() {
  document.getElementById('addPlayerForm').style.display = 'none';
  document.getElementById('addPlayerRevealBtn').style.display = '';
}

function removePlayer(playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;
  const nDecks = (player.decks || []).length;
  if (!confirm(`Remove player "${player.name}"${nDecks ? ` and their ${nDecks} deck${nDecks !== 1 ? 's' : ''}` : ''}? This cannot be undone.`)) return;
  state.players = state.players.filter(p => p.id !== playerId);
  /* Their decks go with them; their collections do not. The cards are still
   * in the house, so a collection they owned becomes the group's — the same
   * clearing routes/state.js does to the row a moment later, done here so the
   * chip stops naming somebody who is gone before the next load. */
  for (const col of state.collections) if (col.owner === playerId) col.owner = null;
  saveToStorage();
  renderPlayers();
  renderCollections();
  renderResults();
}

// ── Deck management ───────────────────────────────────────────────────────

function openAddDeck(playerId) {
  // Close any other open add-deck forms
  document.querySelectorAll('.add-deck-form.open').forEach(el => {
    if (el.dataset.player !== playerId) el.classList.remove('open');
  });
  const form = document.getElementById(`adf_${playerId}`);
  if (form) { form.classList.toggle('open'); form.querySelector('input').focus(); }
}

async function confirmAddDeck(playerId) {
  const form         = document.getElementById(`adf_${playerId}`);
  const nameInput    = form.querySelector('[name="deckname"]');
  const cmdInput     = form.querySelector('[name="commander"]');
  const urlInput     = form.querySelector('[name="deckurl"]');

  const deckNameVal  = nameInput.value.trim();
  const commanderVal = cmdInput.value.trim();
  const urlVal       = urlInput.value.trim();

  // Need at least a deck name
  if (!deckNameVal) { nameInput.style.borderColor = 'var(--danger)'; return; }
  nameInput.style.borderColor = '';

  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  // Any URL is valid as a link; only Archidekt URLs also enable card fetching
  const normUrl = normaliseUrl(urlVal);
  const parsed  = parseDeckUrl(normUrl);

  const entry = {
    id:           `d_${Date.now()}`,
    source:       parsed ? 'archidekt' : 'manual',
    deckId:       parsed ? parsed.deckId : null,
    url:          normUrl,
    name:         deckNameVal,
    nameStatus:   'loading',
    commander:    commanderVal,
    commanderImg: null,
    cardCount:    null,
    bracket:      null,
    deckUrl:      normUrl,
    // Public, said out loud: privacy is a deliberate act from the tile's ⋯,
    // not a thing a deck can arrive already wearing.
    private:      false,
    editing:      false,
  };

  player.decks.push(entry);
  nameInput.value = '';
  cmdInput.value  = '';
  urlInput.value  = '';
  form.classList.remove('open');
  renderPlayers();
  console.log(`[deck] pushed "${entry.name}" (id=${entry.id}) to player "${player.name}" — saving early`);

  await savePlayerDecks(playerId);
  console.log(`[deck] early save complete — deck is now in DB`);

  try {
    if (parsed) {
      console.log(`[deck] fetching Archidekt metadata for deck ${parsed.deckId}`);
      try {
        const data = await fetchDeckData(parsed.source, parsed.deckId);
        if (!commanderVal && data.commander) entry.commander = data.commander;
        entry.cardCount = data.cardCount;
        entry.bracket   = data.bracket;
        entry._cards    = data.cards;
        console.log(`[deck] Archidekt fetch done — commander="${entry.commander}"`);
      } catch (e) {
        console.warn('[deck] Archidekt fetch failed:', e.message);
      }
    }

    if (entry.commander) {
      console.log(`[deck] fetching Scryfall art for "${entry.commander}"`);
      await ensureScryfallImages([entry.commander]);
      entry.commanderImg = scryfallArtCache.get(entry.commander) || null;
      console.log(`[deck] Scryfall art done — commanderImg=${entry.commanderImg ? 'set' : 'null'}`);
    }
  } finally {
    const livePlayer = state.players.find(p => p.id === playerId);
    const liveDeck   = livePlayer?.decks.find(d => d.id === entry.id);
    console.log(`[deck] finally — liveDeck found in state: ${!!liveDeck} (player still in state: ${!!livePlayer})`);
    const target     = liveDeck || entry;
    target.commander    = entry.commander;
    target.commanderImg = entry.commanderImg;
    target.cardCount    = entry.cardCount;
    target.bracket      = entry.bracket;
    if (entry._cards) target._cards = entry._cards;
    target.nameStatus   = 'loaded';
    console.log(`[deck] final save — target is ${liveDeck ? 'live object' : 'ORPHANED entry (hydrateState ran!)'}`);
    await savePlayerDecks(playerId);
    renderPlayers();
  }
}

function removeDeck(playerId, deckId) {
  const player = state.players.find(p => p.id === playerId);
  const entry  = player?.decks.find(d => d.id === deckId);
  if (!entry) return;
  if (!confirm(`Remove deck "${entry.name}"? This cannot be undone.`)) return;
  player.decks = player.decks.filter(d => d.id !== deckId);
  savePlayerDecks(playerId);
  renderPlayers();
}

async function loadPlayerDeck(playerId, deckId) {
  const player = state.players.find(p => p.id === playerId);
  const entry  = player?.decks.find(d => d.id === deckId);
  if (!entry) return;

  let cards = entry._cards;
  let name  = entry.name;

  if (!cards && entry.source !== 'manual' && entry.deckId) {
    entry.nameStatus = 'loading';
    renderPlayers();
    try {
      const data = await fetchDeckData(entry.source, entry.deckId);
      cards = data.cards;
      name  = data.name;
      entry._cards = cards;
      entry.nameStatus = 'loaded';
    } catch (e) {
      entry.nameStatus = 'error';
      renderPlayers();
      alert(`Could not load deck: ${e.message}`);
      return;
    }
    renderPlayers();
  }

  if (!cards) {
    alert('This deck was added manually without a card list — add an Archidekt URL to enable comparison.');
    return;
  }

  // Load into the deck comparison panel and switch to Collections tab
  deck = { name, cards };
  deckFilter = false;
  document.getElementById('deckFilterBtn').classList.remove('active');
  setTab('collections');
  renderDeck();
  renderResults();
}

function openInDeckView(playerId, deckId) {
  setTab('deckview');
  const sel = document.getElementById('dbDeckSel');
  const val = `${playerId}|${deckId}`;
  if (sel && [...sel.options].some(o => o.value === val)) {
    sel.value = val;
    dbSelectDeck(val);
  }
}

// ── Edit deck ─────────────────────────────────────────────────────────────
function startEditDeck(playerId, deckId) {
  const player = state.players.find(p => p.id === playerId);
  const entry  = player?.decks.find(d => d.id === deckId);
  if (!entry) return;
  entry.editing = true;
  renderPlayers();
}

function cancelEditDeck(playerId, deckId) {
  const player = state.players.find(p => p.id === playerId);
  const entry  = player?.decks.find(d => d.id === deckId);
  if (!entry) return;
  entry.editing = false;
  renderPlayers();
}

async function saveEditDeck(playerId, deckId) {
  const player = state.players.find(p => p.id === playerId);
  const entry  = player?.decks.find(d => d.id === deckId);
  if (!entry) return;

  const tileEl = document.querySelector(`[data-deck-id="${deckId}"]`);
  if (!tileEl) return;

  const newName = tileEl.querySelector('[name="edit-name"]')?.value.trim() || '';
  const newCmd  = tileEl.querySelector('[name="edit-commander"]')?.value.trim() || '';
  const rawUrl  = tileEl.querySelector('[name="edit-url"]')?.value.trim() || '';

  if (!newName) {
    tileEl.querySelector('[name="edit-name"]').style.borderColor = 'var(--danger)';
    return;
  }

  const normUrl    = normaliseUrl(rawUrl);
  const parsed     = parseDeckUrl(normUrl);
  const cmdChanged = newCmd !== entry.commander;

  entry.name    = newName;
  entry.deckUrl = normUrl;
  entry.url     = normUrl;
  if (parsed) { entry.source = 'archidekt'; entry.deckId = parsed.deckId; }
  if (cmdChanged) { entry.commander = newCmd; entry.commanderImg = null; }
  entry.editing = false;

  renderPlayers();

  if (cmdChanged && newCmd) {
    await ensureScryfallImages([newCmd]);
    entry.commanderImg = scryfallArtCache.get(newCmd) || null;
    renderPlayers();
  }

  savePlayerDecks(playerId);
}

// ── Whose decks this tab is showing ─────────────────────────────────────────
// The tab lands you on a grid of your own built decks; a Mine / Everyone toggle
// flips to the old per-player sections. This mirrors the Collections tab's
// shelf scope (js/collections.js) — same "Mine needs somebody to be" rule, same
// hide-the-control-when-nobody, its own localStorage key. It differs in one
// place: the default is Mine here (the tab's headline) where Collections
// defaults to Everyone.

const DECK_SCOPE_KEY = 'mtgtools_deck_scope';

/* Which view the tab is on — 'mine' or 'all'. "Mine" needs an identity, so an
 * app that cannot say who you are reads 'all' whatever is stored: the control
 * is not offered in that case, and a preference from a browser that once knew
 * must not quietly hide every deck from somebody who cannot switch it back. */
function deckScope() {
  if (!myPlayerId()) return 'all';
  // Default Mine — the headline of the tab is your own decks. Only an explicit
  // 'all' reads as Everyone; anything else (unset, or a stale value) is Mine.
  try { return localStorage.getItem(DECK_SCOPE_KEY) === 'all' ? 'all' : 'mine'; }
  catch { return 'mine'; }
}

function setDeckScope(scope) {
  try { localStorage.setItem(DECK_SCOPE_KEY, scope === 'mine' ? 'mine' : 'all'); } catch {}
  renderPlayers();
}

/* Mounted once in the toolbar, synced on every render. Hidden — not disabled —
 * when the app cannot say who you are, the way syncColScope does it: with
 * nobody to be there is no "mine" to offer, so the whole mount goes and the tab
 * is the Everyone view. */
function syncDeckScope() {
  const host = document.getElementById('deckScopeMount');
  if (!host) return;
  const me = myPlayerId();
  host.classList.toggle('scope-mount-hidden', !me);
  const sel = document.getElementById('deckScopeSel');
  if (sel) sel.value = deckScope();
}

/* Who you are can change while the app is open — in open mode it is a name
 * typed into Available@'s "Who are you?" bar — and it decides whether this tab
 * shows your grid or everyone's sections. Called from there, mirroring
 * colIdentityChanged. */
let _deckIdentity = null;
function deckIdentityChanged() {
  const now = myPlayerId();
  if (now === _deckIdentity) return;
  _deckIdentity = now;
  renderPlayers();
}

// ── Folders ─────────────────────────────────────────────────────────────────
// Flat, per player, kept in the state blob beside their decks. A folder is how
// *that person* organizes *their* decks; everyone else reads it. Creating,
// renaming and removing one is a change to the player, so it goes through the
// whole-state save; which folder a deck is in is a change to the deck, so that
// goes through savePlayerDecks.

/* Ids follow the deck convention (`d_…`), with a counter for the case that
 * costs nothing to rule out: two folders made inside the same millisecond. */
/* The order the sections are drawn in, and the order `position` is renumbered
 * against. Stored order is not it: `position` is the field that carries the
 * order, and drag-reorder (#39) will write it without touching the array. */
function sortedFolders(player) {
  return [...(player.folders || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
}

function newFolderId(folders) {
  const stamp = `f_${Date.now()}`;
  if (!folders.some(f => f.id === stamp)) return stamp;
  let n = 1;
  while (folders.some(f => f.id === `${stamp}_${n}`)) n++;
  return `${stamp}_${n}`;
}

function addFolder(playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;
  const name = (prompt('New folder name:') || '').trim();
  if (!name) return;
  player.folders.push({ id: newFolderId(player.folders), name, position: player.folders.length });
  renderPlayers();
  saveToStorage();
}

/* The name is the whole of a folder, so renaming is prompt-and-save. The id
 * stays what it was: a deck names its folder by id, and a rename that minted a
 * new one would empty the folder it just renamed. */
function renameFolder(playerId, folderId) {
  const player = state.players.find(p => p.id === playerId);
  const folder = player?.folders.find(f => f.id === folderId);
  if (!folder) return;
  const name = (prompt('Rename folder:', folder.name) || '').trim();
  if (!name || name === folder.name) return;
  folder.name = name;
  renderPlayers();
  saveToStorage();
}

/* Removing a folder is removing the shelf, not the decks on it. Their
 * `folderId` is left naming a folder that is no longer there, which the grid
 * reads as loose — the whole reason this needs no migration. */
function removeFolder(playerId, folderId) {
  const player = state.players.find(p => p.id === playerId);
  const folder = player?.folders.find(f => f.id === folderId);
  if (!folder) return;
  const n = player.decks.filter(d => d.folderId === folderId).length;
  if (!confirm(`Remove the folder "${folder.name}"?${n ? ` Its ${n} deck${n !== 1 ? 's go' : ' goes'} back to loose.` : ''}`)) return;
  // Renumbered, not just removed: `position` is what orders the sections, and
  // a gap left in it would let the next folder made claim a place another one
  // already holds.
  player.folders = sortedFolders(player).filter(f => f.id !== folderId)
    .map((f, i) => ({ ...f, position: i }));
  renderPlayers();
  saveToStorage();
}

/* Which folder a deck is in is a fact about the deck, so this goes through the
 * granular deck save rather than the whole state. Optimistic like the rest of
 * the tab: the tile moves, then the save follows. */
function moveDeckToFolder(playerId, deckId, folderId) {
  const player = state.players.find(p => p.id === playerId);
  const deck   = player?.decks.find(d => d.id === deckId);
  if (!deck) return;
  const next = folderId || null;
  if (deck.folderId === next) return;
  deck.folderId = next;
  renderPlayers();
  savePlayerDecks(playerId);
}

// ── Private decks ───────────────────────────────────────────────────────────
// A private deck is visible to its owner and to admins and to nobody else,
// enforced by the server (routes/state.js) rather than by this tab. What lives
// here is the way to say so — the ⋯ row that sets the flag — and the badge that
// says it is set.

/* Whether the flag means anything in this deployment.
 *
 * Open mode has no accounts, so the server cannot tell owner from stranger and
 * cannot enforce privacy: the decision (docs/design/spec-deck-grid-and-folders.md)
 * is that the flag is *inert* there rather than half-kept. So the tab offers no
 * way to set it and draws no badge claiming it — a lock that keeps nobody out
 * is worse than no lock at all. The flag itself is left alone, in state and
 * through every save, so a deployment that later gains accounts keeps whatever
 * was marked.
 *
 * Open mode is the `guest` session, the same test available.js and playmat.js
 * make. Not myPlayerId(): open mode can say who you are (the remembered name
 * behind Available@'s "Who are you?" bar) and still have nobody to enforce it. */
function deckPrivacyEnforced() {
  return !!currentUser && currentUser.username !== 'guest';
}

/* Marked private, or public again. Optimistic like the rest of the tab, and
 * rolled back the way setCollectionOwner does it (js/collections.js): the tile
 * changes, the save follows, and a server that will not take it gets the deck
 * put back rather than left looking private to nobody but this browser. */
async function setDeckPrivate(playerId, deckId, makePrivate) {
  const player = state.players.find(p => p.id === playerId);
  const deck   = player?.decks.find(d => d.id === deckId);
  if (!deck) return;
  const previous = !!deck.private;
  const next     = !!makePrivate;
  if (previous === next) return;

  deck.private = next;
  renderPlayers();

  if (await savePlayerDecks(playerId)) return;

  // Unless the save was a 409, which reloads the whole state and replaces every
  // deck object with the server's. There is then nothing of ours left to put
  // back, and writing the old value onto the fresh state would undo what the
  // reload just told us — including a change another session made to this very
  // flag. That path has already said its piece, so this one stays quiet.
  const live = state.players.find(p => p.id === playerId)?.decks.find(d => d.id === deckId);
  if (live !== deck) return;

  deck.private = previous;
  renderPlayers();
  // The refused save left the optimistic value in the offline cache on its way
  // past, and that cache is what an unreachable server is loaded from next
  // time. Put the rolled-back state in there too, or the change comes back
  // after the app has said it did not take.
  cacheStateLocally();
  alert(`Could not make "${deck.name}" ${next ? 'private' : 'public'} — the change was not saved, so the deck is still ${previous ? 'private' : 'public'}.`);
}

/* The privacy row on a deck's ⋯, shaped like deckFolderMenuItems below: one
 * row saying which way the deck is currently facing, and no rows at all where
 * the flag would not be enforced. */
function deckPrivacyMenuItems(player, deck) {
  if (!deckPrivacyEnforced()) return [];
  return [{
    label:   deck.private ? 'Make public' : 'Make private',
    onclick: `setDeckPrivate('${jsAttr(player.id)}','${jsAttr(deck.id)}',${deck.private ? 'false' : 'true'})`,
  }];
}

/* The badge a private deck wears. Text beside the lock rather than the lock
 * alone: the tile's other two badges are words, and a padlock on its own has to
 * be guessed at. Drawn only where the flag is enforced.
 *
 * Drawn off the flag alone, not off whose deck it is. The spec scopes the badge
 * to "yours, or any as an admin", which is the same set as the decks that reach
 * you at all — the server withholds everyone else's (routes/state.js). Gating
 * it again here would buy nothing today, and on the day that filter regressed
 * it would hide the leak: a stranger's private deck on your screen should be
 * wearing the lock that makes it obvious, not passing for an ordinary deck. */
function deckPrivateBadgeHtml(deck) {
  if (!deckPrivacyEnforced() || !deck.private) return '';
  return `<span class="deck-private-badge" title="Private — only you and an admin can see this deck">🔒 Private</span>`;
}

/* The folder rows on a deck's ⋯ menu, shaped like the owner rows on a
 * collection's (js/collections.js colOwnerMenuItems): a section label, every
 * folder with a tick on the one it is in, and — only when it is in one — the
 * way back out. kebabMenuHtml has no submenus, so "Move to folder →" is that
 * label with its choices under it. */
function deckFolderMenuItems(player, deck) {
  const folders = sortedFolders(player);
  if (!folders.length) return [];
  const inOne = folders.some(f => f.id === deck.folderId);
  const items = [{ section: 'Move to folder' }];
  for (const f of folders) {
    items.push({
      label: `${deck.folderId === f.id ? '✓ ' : ''}${esc(f.name)}`,
      onclick: `moveDeckToFolder('${jsAttr(player.id)}','${jsAttr(deck.id)}','${jsAttr(f.id)}')`,
    });
  }
  if (inOne) items.push({
    label: 'Remove from folder',
    onclick: `moveDeckToFolder('${jsAttr(player.id)}','${jsAttr(deck.id)}',null)`,
  });
  return items;
}

// ── Render one deck tile ────────────────────────────────────────────────────
// The tile the grid and the sections both draw. `player` owns the deck; the
// action handlers are keyed by the pair, and `canEdit` gates the ⋯ menu.
function deckTileHtml(player, d, canEdit) {
  if (d.editing) {
    return `<div class="deck-tile-edit" data-deck-id="${d.id}">
      <div class="edit-label">Edit Deck</div>
      <input type="text" name="edit-name"       value="${esc(d.name)}"      placeholder="Deck name…">
      <input type="text" name="edit-commander"  value="${esc(d.commander)}" placeholder="Commander name…">
      <input type="text" name="edit-url"        value="${esc(d.deckUrl)}"   placeholder="Link (any URL, e.g. moxfield.com/decks/…)"
             onkeydown="if(event.key==='Enter')saveEditDeck('${player.id}','${d.id}')">
      <div style="display:flex;gap:var(--space-2);margin-top:var(--space-1)">
        <button class="btn-primary"   style="flex:1;padding:var(--space-1) var(--space-2);font-size:var(--text-sm)" onclick="saveEditDeck('${player.id}','${d.id}')">Save</button>
        <button class="btn-secondary" style="padding:var(--space-1) var(--space-2);font-size:var(--text-sm)"         onclick="cancelEditDeck('${player.id}','${d.id}')">Cancel</button>
      </div>
    </div>`;
  }

  const srcLabel     = d.source === 'archidekt' ? 'Archidekt' : 'Manual';
  const busy         = d.nameStatus === 'loading';
  const nameClass    = d.nameStatus === 'loading' ? 'loading' : d.nameStatus === 'error' ? 'error' : '';
  const bgStyle      = d.commanderImg ? `background-image:url('${d.commanderImg}')` : '';
  /* What bracket its owner says it is. Drawn by js/deckview-legality.js,
     which is where the five brackets are named and where the declaration is
     made — this tile is one of the places the answer is read. */
  const bracketBadge = dbBracketBadgeHtml(d.bracket);
  /* draggable="false" on the link: an <a href> is draggable without being
     asked, so a tile picked up by its View ↗ would start a drag of the URL
     inside the drag of the deck. The tile is one object to the hand. */
  const viewLink     = d.deckUrl
    ? `<a class="deck-tile-link" href="${esc(d.deckUrl)}" target="_blank" rel="noopener" draggable="false">View ↗</a>` : '';
  // The count sits with the name and the commander rather than on the
  // action row: it is something the deck *is*, not something to do to
  // it, and on a 260px tile the row it used to share has only enough
  // width for the three controls.
  const countInfo    = d.cardCount ? `<div class="deck-tile-meta">${d.cardCount} cards</div>` : '';
  const cmdLine      = d.commander
    ? `<div class="deck-tile-commander">Commander: ${esc(d.commander)}</div>` : '';
  // Where it could be filed, if its owner has made anywhere to file it.
  const folderItems  = deckFolderMenuItems(player, d);
  // Which way it is facing, where that means anything.
  const privacyItems = deckPrivacyMenuItems(player, d);

  // Pickable up where its ⋯ is (js/deckdrag.js), which is the drag's whole
  // relationship to the menu: the same decks, the same move, one hand quicker.
  const drag = deckDragAttrs(player.id, d.id, canEdit);

  return `<div class="deck-tile" data-deck-id="${d.id}" style="${bgStyle}"${drag}>
    <div class="deck-tile-overlay">
      <div class="deck-tile-top">
        <span class="deck-source-badge">${srcLabel}</span>
        ${bracketBadge}
        ${deckPrivateBadgeHtml(d)}
        ${viewLink}
      </div>
      <div class="deck-tile-middle">
        <div class="deck-tile-name ${nameClass}">${esc(d.name)}</div>
        ${cmdLine}
        ${countInfo}
      </div>
      <div class="deck-tile-bottom">
        <button class="btn-load-tile" onclick="loadPlayerDeck('${player.id}','${d.id}')" ${busy ? 'disabled' : ''}>Compare</button>
        <button class="btn-dv-tile" onclick="openInDeckView('${player.id}','${d.id}')" title="Open in Deck Builder">Build</button>
        ${canEdit ? kebabMenuHtml([
          { label: 'Edit',   onclick: `startEditDeck('${player.id}','${d.id}')` },
          ...privacyItems,
          { divider: true },
          ...folderItems,
          ...(folderItems.length ? [{ divider: true }] : []),
          { label: 'Remove', onclick: `removeDeck('${player.id}','${d.id}')`, danger: true },
        ], { title: 'Deck actions', btnClass: 'kebab-btn-tile' }) : ''}
      </div>
    </div>
  </div>`;
}

// ── Render the tab ──────────────────────────────────────────────────────────

function renderPlayers() {
  const list = document.getElementById('playersList');
  if (!list) return;

  // The first render records who you are, so deckIdentityChanged can tell a
  // real change from the initial paint. syncDeckScope shows or hides the
  // toolbar control to match.
  _deckIdentity = myPlayerId();
  syncDeckScope();

  const scope = deckScope();
  // Player administration — + Add Player — lives in the Everyone view, where
  // the per-player sections are. The Mine grid is only your own decks.
  const addBtn = document.getElementById('addPlayerRevealBtn');
  if (addBtn) addBtn.style.display = scope === 'mine' ? 'none' : '';

  if (scope === 'mine') renderMineGrid(list);
  else                  renderEveryone(list);
}

// A flat grid of your own *built* decks. "Built" is the server's signal —
// deckCardCounts[id] > 0 means the Deck Builder has saved deck_cards rows for
// it; a deck that is only a name and a link never appears here.
function renderMineGrid(list) {
  const me      = myPlayerId();
  const player  = state.players.find(p => p.id === me);
  const canEdit = currentUser?.role === 'admin' || isMyPlayer(me);
  const built   = (player?.decks || []).filter(d => (state.deckCardCounts[d.id] || 0) > 0);

  const info = document.getElementById('playersInfo');
  if (info) info.textContent = built.length
    ? `${built.length} deck${built.length !== 1 ? 's' : ''}`
    : '';

  if (!built.length && !(player?.folders || []).length) {
    list.innerHTML = '<div class="empty-state">No built decks yet — open a deck in the Deck Builder to import its cards, or switch to Everyone’s decks above.</div>';
    return;
  }

  list.innerHTML = folderedDecksHtml(player, built, canEdit);
}

// ── Decks, in their folders ─────────────────────────────────────────────────
// The loose zone first — decks in no folder, which is where a deck starts and
// where a deck whose folder was removed comes back to — then a section per
// folder in `position` order. Both views draw decks through here, so a folder
// means the same thing whether you are looking at your grid or at everyone's
// sections.

/* Which decks belong where. A `folderId` naming a folder that is not in the
 * list reads as loose: removing a folder is meant to cost nothing, so nothing
 * rewrites the decks that were in it. */
function groupDecksByFolder(folders, decks) {
  const known = new Set(folders.map(f => f.id));
  const loose = decks.filter(d => !d.folderId || !known.has(d.folderId));
  const inFolder = new Map(folders.map(f => [f.id, []]));
  for (const d of decks) if (d.folderId && known.has(d.folderId)) inFolder.get(d.folderId).push(d);
  return { loose, inFolder };
}

function deckGridHtml(player, decks, canEdit) {
  return `<div class="deck-tiles-grid">${decks.map(d => deckTileHtml(player, d, canEdit)).join('')}</div>`;
}

function folderedDecksHtml(player, decks, canEdit) {
  const folders = sortedFolders(player);
  const { loose, inFolder } = groupDecksByFolder(folders, decks);

  // Somewhere to put a dragged tile down (js/deckdrag.js). The zones already
  // say which player and which folder they are, for the tests to read the
  // layout back; the drop reads the same two attributes.
  const drop = deckZoneAttrs(canEdit);

  const looseZone = `<div class="folder-zone folder-loose" data-player-id="${jsAttr(player.id)}" data-folder-id=""${drop}>
    ${loose.length ? deckGridHtml(player, loose, canEdit)
      : `<div class="player-no-decks">${decks.length ? 'Every deck is in a folder.' : 'No decks yet.'}</div>`}
  </div>`;

  const sections = folders.map(f => {
    const held = inFolder.get(f.id);
    return `<div class="folder-zone folder-section" data-player-id="${jsAttr(player.id)}" data-folder-id="${jsAttr(f.id)}"${drop}>
      <div class="folder-header">
        <span class="folder-name">${esc(f.name)}</span>
        <span class="folder-count">${held.length} deck${held.length !== 1 ? 's' : ''}</span>
        ${canEdit ? kebabMenuHtml([
          { label: 'Rename', onclick: `renameFolder('${jsAttr(player.id)}','${jsAttr(f.id)}')` },
          { divider: true },
          { label: 'Remove folder', onclick: `removeFolder('${jsAttr(player.id)}','${jsAttr(f.id)}')`, danger: true },
        ], { title: 'Folder actions' }) : ''}
      </div>
      ${held.length ? deckGridHtml(player, held, canEdit)
        : '<div class="player-no-decks">Nothing filed here yet.</div>'}
    </div>`;
  }).join('');

  const newFolder = canEdit
    ? `<button class="btn-secondary folder-add" onclick="addFolder('${jsAttr(player.id)}')">+ New folder</button>`
    : '';

  return `${looseZone}${sections}${newFolder}`;
}

// The old per-player sectioned layout, demoted from default. Every player is a
// collapsible section, editing enabled only where you own the player or are an
// admin. Other players' private decks never arrive from the server, so there
// is nothing to hide here.
function renderEveryone(list) {
  const isAdmin = currentUser?.role === 'admin';

  // The strip's count, in the slot every other tab gives its result count.
  const info = document.getElementById('playersInfo');
  if (info) {
    const nPlayers = state.players.length;
    const nDecks   = state.players.reduce((n, p) => n + (p.decks || []).length, 0);
    info.textContent = nPlayers
      ? `${nPlayers} player${nPlayers !== 1 ? 's' : ''} · ${nDecks} deck${nDecks !== 1 ? 's' : ''}`
      : '';
  }

  if (!state.players.length) {
    list.innerHTML = '<div class="empty-state">No players yet — add one above to get started.</div>';
    return;
  }

  list.innerHTML = state.players.map(player => {
    const canEdit = isAdmin || isMyPlayer(player.id);

    // Foldered exactly as the Mine grid is — a folder is a fact about the
    // decks, so it cannot mean one thing in your grid and another in the
    // section somebody else reads them in. That includes somebody with folders
    // and nothing in them yet: their shelves are still theirs to manage.
    const tilesHTML = folderedDecksHtml(player, player.decks, canEdit);

    const pCollapsed = !!collapseState[`player-${player.id}`];
    return `<div class="player-section">
      <div class="player-header" style="--pc:${playerColor(player)}" onclick="togglePlayerSection('${player.id}', event)">
        <span class="player-dot"></span>
        <span class="player-name-lbl">${esc(player.name)}</span>
        ${canEdit ? `<button class="btn-secondary" onclick="openAddDeck('${player.id}')">+ Add Deck</button>` : ''}
        ${isAdmin ? kebabMenuHtml([
          { label: 'Remove player', onclick: `removePlayer('${player.id}')`, danger: true },
        ], { title: 'Player actions' }) : ''}
        <svg class="chevron ${pCollapsed ? 'closed' : ''}" id="chv-player-${player.id}" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      ${canEdit ? `<div class="add-deck-form" id="adf_${player.id}" data-player="${player.id}">
        <input type="text" name="deckname"  placeholder="Deck name…"              style="flex:1;min-width:130px">
        <input type="text" name="commander" placeholder="Commander name…"          style="flex:1.2;min-width:160px">
        <input type="text" name="deckurl"   placeholder="Archidekt URL (optional)" style="flex:1.5;min-width:200px"
               onkeydown="if(event.key==='Enter')confirmAddDeck('${player.id}')">
        <div class="form-btns">
          <button class="btn-primary"   style="padding:var(--space-1) var(--space-3);font-size:var(--text-sm)" onclick="confirmAddDeck('${player.id}')">Add</button>
          <button class="btn-secondary" style="padding:var(--space-1) var(--space-3);font-size:var(--text-sm)" onclick="document.getElementById('adf_${player.id}').classList.remove('open')">Cancel</button>
        </div>
      </div>` : ''}
      <div class="player-decks ${pCollapsed ? 'closed' : ''}" id="pb-player-${player.id}"
           style="${pCollapsed ? 'display:none' : ''}">${tilesHTML}</div>
    </div>`;
  }).join('');
}

// ── Deck state ────────────────────────────────────────────────────────────
let deck       = null; // { name, cards: Map<name, qty> }
let deckFilter = false;

function parseDeckCSV(text, filename) {
  const rows = parseCSVRows(text);
  if (!rows.length) throw new Error('CSV appears to be empty.');
  const cards = new Map();
  for (const row of rows) {
    if (row.length < 2) continue;
    const qty  = parseInt(row[0], 10);
    const name = (row[1] || '').trim();
    if (!name || isNaN(qty) || qty <= 0) continue;
    const ex = cards.get(name);
    if (ex) ex.qty += qty; else cards.set(name, { name, qty });
  }
  if (!cards.size) throw new Error('No valid cards found in deck CSV.');
  return { name: filename.replace(/\.csv$/i, ''), cards };
}

document.getElementById('deckInput').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      deck = parseDeckCSV(ev.target.result, file.name);
      renderDeck();
      renderResults();
    } catch (err) {
      alert('Could not parse deck CSV: ' + err.message);
    }
  };
  reader.readAsText(file);
});

function clearDeck() {
  deck = null;
  if (deckFilter) { deckFilter = false; }
  renderDeck();
  renderResults();
}

function toggleDeckFilter() {
  if (!deck) return;
  deckFilter = !deckFilter;
  document.getElementById('deckFilterBtn').classList.toggle('active', deckFilter);
  renderResults();
}

function renderDeck() {
  const emptyEl  = document.getElementById('deckEmpty');
  const loadedEl = document.getElementById('deckLoaded');
  const filterBtn = document.getElementById('deckFilterBtn');

  if (!deck) {
    emptyEl.style.display  = '';
    loadedEl.style.display = 'none';
    filterBtn.classList.remove('active');
    return;
  }

  emptyEl.style.display  = 'none';
  loadedEl.style.display = 'flex';

  document.getElementById('deckName').textContent = deck.name;

  // Compute collection totals per card
  const colTotals = new Map();
  state.collections.forEach(col => {
    col.cards.forEach((card, name) => {
      colTotals.set(name, (colTotals.get(name) || 0) + card.qty);
    });
  });

  const deckCards = [...deck.cards.values()];
  const found = deckCards.filter(c => colTotals.get(c.name) > 0).length;
  document.getElementById('deckStats').textContent =
    `${found} / ${deckCards.length} cards found in collections`;

  // Sort: found first, then alpha
  const sorted = [...deckCards].sort((a, b) => {
    const af = colTotals.get(a.name) > 0, bf = colTotals.get(b.name) > 0;
    if (af !== bf) return af ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  document.getElementById('deckList').innerHTML = sorted.map(c => {
    const total  = colTotals.get(c.name) || 0;
    const isFound = total > 0;
    const href   = `https://scryfall.com/search?q=!%22${encodeURIComponent(c.name)}%22`;
    return `<div class="deck-row">
      <span class="deck-dot ${isFound ? 'dot-found' : 'dot-missing'}"></span>
      <a class="deck-card-link card-open" href="${href}" target="_blank" rel="noopener" data-name="${esc(c.name)}" title="${esc(c.name)}">${esc(c.name)}</a>
      <span class="deck-deck-qty">×${c.qty}</span>
      <span class="deck-col-qty ${isFound ? 'cq-found' : 'cq-missing'}">${total || '—'}</span>
    </div>`;
  }).join('');
}
