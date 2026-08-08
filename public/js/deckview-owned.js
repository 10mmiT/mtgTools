// ── Deck Builder — What of this deck you already own ──────────────────────
// Every card on the mat has worn an ownership badge for a long time, and the
// deck has never had an answer: you could see that *this* card is in somebody's
// box and not that eighty-seven of your ninety-nine are in yours. This module
// is that answer — "87 of 99 owned", the twelve that are not, and who has them.
//
// ── What it scopes, and what it refuses to ────────────────────────────────
//
// It changes the *question* the readout and the badges answer — yours, the
// group's, or every collection loaded — and it never changes what is on the
// mat. Every card in the deck stays drawn at every scope, because a deck
// builder that hides cards which are in your deck is hiding your deck: the
// count, the curve and the shape of the piles would all stop describing the
// thing being built. The one exception is asked for by hand and is off until
// it is — the chip below.
//
// Narrowing to what you own belongs where you are *choosing* what to add, and
// that is the search drawer's scope select (js/deckview-panels.js), which
// queries the shelf rather than throwing away results that came back from
// Scryfall. A page of search results narrowed to the three you happen to own
// reads as broken, and "find me a card I own that does X" is a question about
// our shelves, not about Magic.
//
// Whose a collection is, is js/collections.js's — colOwner() and nothing else
// reads the field. Who *you* are is js/auth.js's myPlayerId(), which is the
// same identity the Collections tab's shelf control uses and works in open
// mode, where it is the browser-remembered name matched to a player.

/* ── The three questions ───────────────────────────────────────────────────
 *
 * A widening ladder rather than three unrelated shelves, because the number it
 * produces is read as one sentence getting looser: what I can sleeve tonight,
 * what the group can put on the table, and what exists among us at all. The
 * group's includes yours for that reason — a shared box belongs to everybody,
 * so it is not a *different* set of cards from yours, it is more of them.
 *
 * Mine is the default: "can I sleeve this tonight" is the question somebody
 * building a deck is actually asking. */
const DB_OWN_SCOPES = [
  { id: 'mine',  label: 'Mine',        hint: 'Only the collections you own' },
  { id: 'group', label: 'The group’s', hint: 'Yours, and the collections nobody owns' },
  { id: 'all',   label: 'Everyone’s',  hint: 'Every collection loaded' },
];

/* Remembered per person rather than per browser. Two people share a browser in
 * open mode — the identity there is a name typed into Available@'s "Who are
 * you?" bar — and "mine" means something different to each of them, so a scope
 * stored under one of them must not follow the other. */
const DB_OWN_SCOPE_KEY = 'mtgtools_db_own_scope';

function _dbOwnScopeKey() { return `${DB_OWN_SCOPE_KEY}:${myPlayerId() || ''}`; }

/* Which of the three is being asked, and the one place that decides it.
 *
 * "Mine" needs somebody to be. An app that cannot say who you are reads as the
 * group's whatever is stored — the control is not offered at all in that case,
 * and a stored preference from a browser that once knew must not quietly count
 * nobody's collections as yours. */
function dbOwnScope() {
  if (!myPlayerId()) return 'group';
  try {
    const stored = localStorage.getItem(_dbOwnScopeKey());
    return DB_OWN_SCOPES.some(s => s.id === stored) ? stored : 'mine';
  } catch { return 'mine'; }
}

function dbSetOwnScope(scope) {
  if (!DB_OWN_SCOPES.some(s => s.id === scope)) return;
  try { localStorage.setItem(_dbOwnScopeKey(), scope); } catch {}
  dbOwnershipChanged();
}

/* The collections a scope counts, defaulting to the one the strip is set to.
 * The parameter is there for the search drawer, which asks the same question of
 * a different scope than the readout is on — so there is one rule about whose
 * shelf is whose and not two that can drift apart.
 *
 * Loaded ones only, which is the
 * rule sfCardOwnership() has always followed: half a collection is not a
 * smaller shelf, it is a wrong answer, and a badge that appears card by card
 * while pages come in is worse than one that appears once.
 *
 * With nobody to be, every shelf is the group's — which is both what an app
 * with no identity can honestly say and what makes the readout read as the
 * group's rather than break. */
function dbOwnShelf(scope = dbOwnScope()) {
  const loaded = (state.collections || []).filter(c => c.status === 'loaded');
  const me = myPlayerId();
  if (!me) return loaded;
  switch (scope) {
    case 'mine':  return loaded.filter(c => c.owner === me);
    /* colOwner() and not `!c.owner`: an id naming a player who has been removed
       is the group's, which is what the database makes of it the moment that
       removal is saved. */
    case 'group': return loaded.filter(c => c.owner === me || !colOwner(c));
    default:      return loaded;
  }
}

/** How many copies of a card the shelf in scope holds. Nought is an answer. */
function dbOwnedQty(cardName) {
  let qty = 0;
  for (const col of dbOwnShelf()) qty += col.cards.get(cardName)?.qty || 0;
  return qty;
}

/* Who *else* has it — every loaded collection that is not on the shelf being
 * counted, grouped by the person it belongs to. This is the half that answers
 * "who could lend me the rest", and it is why the missing list is worth opening
 * rather than being a number on a line.
 *
 * A collection nobody owns is the group's and is named as such: it is a real
 * answer, not a row somebody forgot to fill in. A card in no collection at all
 * comes back as an empty list, which is what "nobody has this" is. */
function dbHoldersOf(cardName) {
  const counted = new Set(dbOwnShelf().map(c => c.key));
  const holders = [];
  for (const col of (state.collections || [])) {
    if (col.status !== 'loaded' || counted.has(col.key)) continue;
    const qty = col.cards.get(cardName)?.qty || 0;
    if (!qty) continue;
    const player = colOwner(col);
    holders.push({
      who:        player ? player.name : 'The group',
      ink:        player ? playerColor(player) : 'var(--text-muted)',
      collection: col.name,
      qty,
    });
  }
  return holders;
}

/* ── The number, and the twelve behind it ──────────────────────────────────
 *
 * The mainboard, and only the mainboard. The commander is on its own board and
 * a maybeboard holds cards that are *not in the deck* — counting either would
 * make "87 of 99" describe something nobody is building, which is the same
 * argument every other number on the readout is made of (see dbRenderStats).
 *
 * Copies, not rows: a deck asking for four Forests with two on the shelf is
 * two short, and a readout that called that "owned" would be lying about the
 * only thing it is for. */
function dbDeckOwnership() {
  let total = 0, owned = 0;
  const short = [];
  for (const card of dbMainCards()) {
    const need = card.qty || 1;
    const have = Math.min(need, dbOwnedQty(card.card_name));
    total += need;
    owned += have;
    if (have < need) {
      short.push({ name: card.card_name, need, have, holders: dbHoldersOf(card.card_name) });
    }
  }
  short.sort((a, b) => a.name.localeCompare(b.name));
  return { total, owned, short };
}

/* Whether the deck is short of a card, which is the question all three chips
 * and the missing list are cut from — asked of the row rather than the name, so
 * that four Forests with two on the shelf is short by the same reckoning the
 * readout counts by. */
const dbShortOf = card => Math.max(0, (card.qty || 1) - dbOwnedQty(card.card_name));

// ── The chip on the mat ───────────────────────────────────────────────────
/* Off by default, and not remembered. Filtering the mat by ownership is for
 * the cases that want it — "show me what I still have to buy" — and it is a
 * thing you do for a minute, not a state a deck should come back in. The deck's
 * own filter box is not remembered either, for the same reason.
 *
 * One at a time: the three are the three answers to one question, so a pair of
 * them switched on together would be a filter that matches nothing. */
const DB_OWN_CHIPS = [
  { id: 'missing',   label: 'Missing',   hint: 'Only the cards the deck is short of' },
  { id: 'owned',     label: 'Owned',     hint: 'Only the cards you have every copy of' },
  { id: 'elsewhere', label: 'Borrowable', hint: 'Only the cards you are short of that somebody else has' },
];
let dbOwnChip = null;

function dbToggleOwnChip(chip) {
  dbOwnChip = dbOwnChip === chip ? null : chip;
  _dbRenderOwnChips();
  dbRender();
}

function _dbRenderOwnChips() {
  const mount = document.getElementById('dbOwnChips');
  if (!mount) return;
  mount.innerHTML = DB_OWN_CHIPS.map(c => {
    const on = dbOwnChip === c.id;
    return `<button class="btn-secondary db-own-chip${on ? ' db-own-chip-on' : ''}"
      onclick="dbToggleOwnChip('${jsAttr(c.id)}')" aria-pressed="${on ? 'true' : 'false'}"
      title="${esc(c.hint)}">${esc(c.label)}</button>`;
  }).join('');
}

/** Whether the chip lets this card onto the mat. No chip is every card. */
function dbOwnChipShows(card) {
  if (!dbOwnChip) return true;
  const short = dbShortOf(card);
  switch (dbOwnChip) {
    case 'owned':     return short === 0;
    case 'missing':   return short > 0;
    case 'elsewhere': return short > 0 && dbHoldersOf(card.card_name).length > 0;
  }
  return true;
}

// ── The badges on a card ──────────────────────────────────────────────────
/* What the mat draws where sfCardOwnership() used to be drawn. Two differences,
 * and both are this ticket:
 *
 * It is scoped. A badge saying a card is owned when the question on the strip
 * is "do *I* own it" is the badge answering a question nobody asked.
 *
 * And when the shelf in scope has none of it, whoever does is named instead —
 * in their own colour, marked as somebody else's. That is the same sentence the
 * missing list makes, said on the card, and it is what makes the Borrowable
 * chip legible: a dimmed name is a card you would have to ask for. */
function dbCardOwnership(cardName) {
  const mine = dbOwnShelf()
    .filter(c => c.cards.has(cardName))
    .map(c => `<span class="sf-badge" style="border-color:${c.color}">
        <span class="sf-dot" style="background:${c.color}"></span>
        ${esc(c.name)} ×${c.cards.get(cardName).qty}
      </span>`).join('');
  if (mine) return mine;

  return dbHoldersOf(cardName).map(h =>
    `<span class="sf-badge db-badge-elsewhere" style="border-color:${h.ink}"
       title="${esc(`${h.who} — ${h.collection} ×${h.qty}`)}">
      <span class="sf-dot" style="background:${h.ink}"></span>
      ${esc(h.who)} ×${h.qty}
    </span>`).join('');
}

// ── The line on the readout ───────────────────────────────────────────────
/* "87 of 99 owned", and it is a button: the twelve are the point, and a number
 * you cannot open is a number you have to go and count somewhere else.
 *
 * The word after the number changes with the scope, because "owned" alone
 * cannot say whose — and in a deployment that has no way to say who you are it
 * is the only honest word there is, which is the case the label reads as the
 * group's rather than breaking. */
function dbRenderOwnStat() {
  const el = document.getElementById('dbStatOwned');
  if (!el) return;
  const { total, owned } = dbDeckOwnership();
  const scope = DB_OWN_SCOPES.find(s => s.id === dbOwnScope()) || DB_OWN_SCOPES[0];
  const whose = !myPlayerId() ? 'the group owns'
              : dbOwnScope() === 'mine' ? 'you own'
              : dbOwnScope() === 'group' ? 'the group owns'
              : 'we own';
  const all = total > 0 && owned === total;
  el.innerHTML = `<strong style="color:${all ? 'var(--success)' : ''}">${owned}</strong> of ${total} ${esc(whose)}`;
  el.title = `${esc(scope.hint)} — open for what is missing`;
}

// ── What is missing, and who has it ───────────────────────────────────────
let _dbOwnedPanelOpen = false;

function dbToggleOwnedPanel() {
  _dbOwnedPanelOpen = !_dbOwnedPanelOpen;
  /* The other two panels rise out of the same line and would lie under this
     one, so opening any of the three puts the other two away. */
  if (_dbOwnedPanelOpen) { dbCloseCheckPanel(); dbCloseManaPanel(); }
  _dbSyncOwnedPanel();
}

function dbCloseOwnedPanel() {
  if (!_dbOwnedPanelOpen) return;
  _dbOwnedPanelOpen = false;
  _dbSyncOwnedPanel();
}

function _dbSyncOwnedPanel() {
  const panel = document.getElementById('dbOwnedPanel');
  const btn   = document.getElementById('dbStatOwned');
  btn?.setAttribute('aria-expanded', _dbOwnedPanelOpen ? 'true' : 'false');
  if (!panel) return;
  panel.style.display = _dbOwnedPanelOpen ? '' : 'none';
  if (_dbOwnedPanelOpen) panel.innerHTML = _dbOwnedPanelHtml();
}

/* Two lists, because they are two different problems. A card somebody else has
 * is an evening's borrowing; a card nobody has is a purchase, and it is the one
 * that belongs on a want list. The holders are named and drawn in their own
 * player colour — the same colours the rest of the app draws people in — so
 * "who could lend me this" is answered by looking rather than by reading. */
function _dbOwnedPanelHtml() {
  const { total, owned, short } = dbDeckOwnership();
  if (!short.length) {
    return `<div class="db-owned-hdr">
        <span class="db-owned-title">Every one of the ${total} is on the shelf</span>
        ${_dbOwnedCloseHtml()}
      </div>`;
  }

  const borrowable = short.filter(s => s.holders.length);
  const nobodys    = short.filter(s => !s.holders.length);
  const missing    = short.reduce((n, s) => n + (s.need - s.have), 0);

  const section = (title, rows, note) => rows.length ? `
    <div class="db-owned-group">
      <div class="db-owned-group-hdr">${esc(title)}<span class="db-owned-note">${esc(note)}</span></div>
      ${rows.join('')}
    </div>` : '';

  return `
    <div class="db-owned-hdr">
      <span class="db-owned-title">${missing} of ${total} missing — ${owned} on the shelf</span>
      ${_dbWantAllHtml()}
      ${_dbOwnedCloseHtml()}
    </div>
    ${section('Somebody else has these', borrowable.map(_dbOwnedRowHtml),
              'ask, or buy your own')}
    ${section('Nobody has these', nobodys.map(_dbOwnedRowHtml),
              'not in any collection loaded')}`;
}

function _dbOwnedCloseHtml() {
  return `<button class="db-owned-close" onclick="dbCloseOwnedPanel()" title="Close">✕</button>`;
}

function _dbOwnedRowHtml(entry) {
  const shortBy = entry.need - entry.have;
  const holders = entry.holders.map(h =>
    `<span class="sf-badge db-owned-holder" style="border-color:${h.ink}"
       title="${esc(`${h.collection} ×${h.qty}`)}">
      <span class="sf-dot" style="background:${h.ink}"></span>${esc(h.who)}
    </span>`).join('');
  return `<div class="db-owned-row">
    <a class="card-link db-owned-name" href="#" data-name="${esc(entry.name)}">${esc(entry.name)}</a>
    ${shortBy > 1 ? `<span class="db-owned-qty">×${shortBy}</span>` : ''}
    <span class="db-owned-holders">${holders}</span>
    ${_dbWantOneHtml(entry.name)}
  </div>`;
}

// ── Sending them to your want list ────────────────────────────────────────
/* One action for the lot, which is what the ticket asks for, and one per row
 * for the times you only want the three you have decided to buy.
 *
 * Both go through myPlayerId() rather than currentUser.playerId — the identity
 * the whole of this module is scoped by — so the button is there in open mode,
 * where the app knows who you are from a remembered name and not from an
 * account. With no identity at all there is no want list to add to and no
 * button is drawn: there is nobody to want the card. */
function _dbWantOneHtml(cardName) {
  const player = _dbWantListOwner();
  if (!player) return '';
  const already = (player.wantList || []).includes(cardName);
  return `<button class="want-quick-btn db-owned-want${already ? ' want-quick-added' : ''}"
    onclick="dbWantCards(['${jsAttr(cardName)}'], this)"
    title="${already ? 'Already on your want list' : 'Add to my wants'}"
    ${already ? 'disabled' : ''}>${already ? '✓' : '+'}</button>`;
}

/* The one action the ticket asks for. It takes no list: the button recomputes
 * what is still missing and still unwanted when it is pressed, so a card added
 * from a row a moment ago is not sent a second time, and no card name has to
 * survive a trip through an inline attribute to get here. */
function _dbWantAllHtml() {
  const names = dbMissingUnwanted();
  if (!names.length) return '';
  return `<button class="btn-secondary db-owned-want-all" onclick="dbWantAllMissing(this)">
    + Want all ${names.length}</button>`;
}

function _dbWantListOwner() {
  const me = myPlayerId();
  return me ? (state.players || []).find(p => p.id === me) || null : null;
}

/** Every card the deck is short of that is not already on your want list. */
function dbMissingUnwanted() {
  const player = _dbWantListOwner();
  if (!player) return [];
  const wanted = new Set(player.wantList || []);
  return dbDeckOwnership().short.map(s => s.name).filter(n => !wanted.has(n));
}

function dbWantAllMissing(btn) { return dbWantCards(dbMissingUnwanted(), btn); }

/* One at a time and awaited, because the want-list route is a read-modify-write
 * of the whole state file: firing twelve of them at once is twelve reads of the
 * same state and eleven lost cards. Twelve round trips is also why the button
 * says it is working. */
async function dbWantCards(names, btn) {
  const player = _dbWantListOwner();
  if (!player || !names.length) return;
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  const added = [];
  try {
    for (const name of names) {
      if ((player.wantList || []).includes(name)) continue;
      const res = await fetch(`/api/players/${encodeURIComponent(player.id)}/wants`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardName: name }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const json = await res.json().catch(() => ({}));
      if (typeof json.version === 'number') state.version = json.version;
      if (!player.wantList) player.wantList = [];
      player.wantList.push(name);
      added.push(name);
    }
    /* One card gets the app's usual toast. Twelve do not need one: every row
     * they came from has just been redrawn with a ✓ on it, which is the same
     * confirmation and is where the eye already is. */
    if (added.length === 1) _showWantToast(added[0]);
  } catch (e) {
    alert(`Could not add to wants: ${e.message}`);
  }
  /* Redrawn rather than the button being ticked in place: a want that landed
   * turns that row's + into a ✓, and the "Want all" count above it has just
   * changed by however many went. */
  _dbSyncOwnedPanel();
}

// ── Keeping the tab in step ───────────────────────────────────────────────
/* The scope control, mounted once in the markup and synced here. Hidden — not
 * disabled — where the app cannot say who you are, exactly as the Collections
 * tab's shelf control is: no distinction is offered at all, and everything
 * reads as the group's. The whole mount goes so the strip keeps no gap for it. */
function dbSyncOwnScope() {
  const host = document.getElementById('dbOwnScopeMount');
  if (host) host.classList.toggle('scope-mount-hidden', !myPlayerId());
  const sel = document.getElementById('dbOwnScopeSel');
  if (sel) sel.value = dbOwnScope();
}

/* What has to be redrawn when the answer changes. The mat is in it because the
 * badges on the cards answer the same question the readout does; dbRender() and
 * dbRenderStats() both no-op without a deck. */
function dbOwnershipChanged() {
  dbSyncOwnScope();
  _dbRenderOwnChips();
  if (!dbDeck) return;
  dbRenderStats();
  dbRender();
  if (_dbOwnedPanelOpen) _dbSyncOwnedPanel();
}

/* The same, for the caller that is not a person: js/collections.js redraws its
 * chips once per page of a hundred cards, so a shelf arriving is fifty of these
 * and each of them would otherwise repaint the whole mat. Coalesced rather than
 * ignored, because the last one carries the number that is finally true. */
let _dbShelfRedraw = null;
function dbShelvesChanged() {
  clearTimeout(_dbShelfRedraw);
  _dbShelfRedraw = setTimeout(() => { _dbShelfRedraw = null; dbOwnershipChanged(); }, 60);
}
