// ── Deck Builder — History: snapshots, the panel, restoring ───────────────────
// Split out beside the other deckview-*.js modules. All deck-builder scripts
// share one global scope (classic scripts), so state declared in
// deckview-core.js is visible here and functions stay global for inline
// onclick handlers.
//
// The rules about *when* a snapshot is written are the server's — see
// deck-history.js. What is here is the half only the browser can do: taking
// the copy in front of an operation, at the moment the person can still see
// what they are about to lose, and putting one back.

// ── Taking one ────────────────────────────────────────────────────────────

/* The deck as it is on screen, in the shape the save path sends.
 *
 * Read from the in-memory deck rather than fetched back from the server on
 * purpose: the autosave runs on an 800 ms debounce, so the stored rows can be
 * behind what is being looked at, and the state worth keeping is the one that
 * is being looked at. */
function _dbSnapshotBody(reason) {
  return {
    reason,
    cards:      dbCards.map((c, i) => ({ ...c, position: i })),
    categories: dbCats.map((c, i) => ({ ...c, position: i })),
  };
}

/* The snapshot a save has to wait behind. A forced snapshot goes out ahead of
 * an operation, and the save that operation schedules must not overtake it —
 * the server reads nothing from the database to build a forced row, but the
 * History panel would still list them out of order. _dbSave() awaits this. */
let _dbSnapshotInFlight = null;

/* Capture the deck as it is, before the caller changes it.
 *
 * Called *before* the mutation, always, and the body is built synchronously
 * here so that being called before is enough — nothing this function does
 * later can see a deck that has moved on. Callers do not await it: a failed
 * snapshot must not stop an edit the person asked for, and the save that
 * follows serialises against it anyway. */
function _dbForceSnapshot(reason) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return Promise.resolve(null);
  const body = _dbSnapshotBody(reason);
  const { playerId, id } = dbDeck;
  const p = fetch(`/api/players/${encodeURIComponent(playerId)}/decks/${encodeURIComponent(id)}/snapshots`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(res => (res.ok ? res.json() : null)).catch(() => null);
  _dbSnapshotInFlight = p;
  return p;
}

// ── The panel ─────────────────────────────────────────────────────────────

function dbOpenHistoryPanel() {
  if (!dbDeck) return;
  document.getElementById('dbHistoryPanel')?.classList.add('open');
  document.getElementById('dbHistoryBackdrop')?.classList.add('open');
  _dbLoadHistory();
}

function dbCloseHistoryPanel() {
  document.getElementById('dbHistoryPanel')?.classList.remove('open');
  document.getElementById('dbHistoryBackdrop')?.classList.remove('open');
}

async function _dbLoadHistory() {
  const box = document.getElementById('dbHistoryContent');
  if (!box || !dbDeck) return;
  box.innerHTML = '<div class="empty-state" style="padding:var(--space-6) var(--space-4)">Loading history…</div>';
  try {
    const res = await fetch(
      `/api/players/${encodeURIComponent(dbDeck.playerId)}/decks/${encodeURIComponent(dbDeck.id)}/snapshots`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    box.innerHTML = _dbHistoryHtml(await res.json(), isMyPlayer(dbDeck.playerId));
  } catch (e) {
    box.innerHTML = `<div class="error-msg" style="margin:var(--space-3)">${esc(e.message)}</div>`;
  }
}

/* What each row was taken in front of. A snapshot holds the state *before*
 * something, so every one of these reads as the moment it was taken at rather
 * than as the change itself — which is what makes "restore this" mean
 * "undo what came after". */
const DB_HISTORY_REASON = {
  edit:          'Before a stretch of editing',
  import:        'Before an import',
  category:      'Before a category was deleted',
  move:          'Before a bulk move',
  commander:     'Before the commander was switched',
  restore:       'Before a restore',
  'deck-delete': 'Before the deck was deleted',
};

/* Names, up to a few, then how many more. The full list goes in the row's
 * title — the panel is a column on a phone, and eleven card names is not a
 * summary. */
function _dbNameList(items, limit = 3) {
  const names = items.map(i => i.name);
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`;
}

/** One line of what changed, in the order the eye wants it: how many cards
 *  arrived, how many left, then the quieter kinds of change. Empty when two
 *  states differ in nothing the panel can name. */
function _dbChangeSummary(changes) {
  if (!changes) return '';
  const bits = [];
  if (changes.added.length)   bits.push(`+${changes.added.length}`);
  if (changes.removed.length) bits.push(`−${changes.removed.length}`);
  if (changes.moved.length)   bits.push(`${changes.moved.length} moved`);
  if (changes.qty)            bits.push(`${changes.qty} × changed`);
  const cats = changes.categoriesAdded.length + changes.categoriesRemoved.length;
  if (cats) bits.push(`${cats} categor${cats === 1 ? 'y' : 'ies'}`);
  return bits.join(' · ');
}

/** The same change, spelled out, for the row's tooltip. */
function _dbChangeDetail(changes) {
  if (!changes) return '';
  const lines = [];
  if (changes.added.length)   lines.push(`Added: ${_dbNameList(changes.added, 12)}`);
  if (changes.removed.length) lines.push(`Removed: ${_dbNameList(changes.removed, 12)}`);
  if (changes.moved.length)   lines.push(`Moved: ${changes.moved.map(m => `${m.name} → ${m.to || 'auto'}`).slice(0, 12).join(', ')}`);
  if (changes.categoriesAdded.length)   lines.push(`Categories added: ${changes.categoriesAdded.join(', ')}`);
  if (changes.categoriesRemoved.length) lines.push(`Categories gone: ${changes.categoriesRemoved.join(', ')}`);
  return lines.join('\n');
}

/* How long ago, at the resolution the answer is useful at. A snapshot from
 * four minutes ago is "4 min ago"; one from March is a date, because "148
 * days ago" is a number nobody converts. */
function dbHistoryWhen(takenAt, now = Date.now()) {
  const diff = Math.max(0, now - takenAt);
  if (diff < 60_000)      return 'just now';
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(takenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function _dbHistoryHtml(data, canEdit) {
  const rows = [];

  /* The deck as it stands, at the top of the list and not restorable — it is
   * already here. It is in the list because the newest snapshot's "what
   * changed" would otherwise be the one number the panel cannot show, and it
   * is the number a reader wants most: what restoring that row would cost. */
  rows.push(`
    <div class="db-hist-row db-hist-now">
      <div class="db-hist-line">
        <span class="db-hist-when">Now</span>
        <span class="db-hist-what">${data.current.cards} cards · ${data.current.distinct} different</span>
      </div>
      ${_dbHistoryChangesHtml(data.current.changes, 'since the snapshot below')}
    </div>`);

  for (const snap of data.snapshots) {
    const when   = dbHistoryWhen(snap.taken_at);
    const exact  = new Date(snap.taken_at).toLocaleString();
    const reason = DB_HISTORY_REASON[snap.reason] || 'Snapshot';
    rows.push(`
      <div class="db-hist-row">
        <div class="db-hist-line">
          <span class="db-hist-when" title="${esc(exact)}">${esc(when)}</span>
          <span class="db-hist-what">${esc(reason)} · ${snap.cards} cards</span>
          ${canEdit ? `<button class="btn-secondary db-hist-restore" onclick="dbRestoreSnapshot(${snap.id})">Restore</button>` : ''}
        </div>
        ${_dbHistoryChangesHtml(snap.changes, 'since the snapshot below')}
      </div>`);
  }

  if (!data.snapshots.length) {
    rows.push(`<div class="empty-state" style="padding:var(--space-5) var(--space-4)">
      Nothing older yet. A snapshot is taken when you start editing, and before
      an import, a bulk move or a deleted category.</div>`);
  }
  return rows.join('');
}

function _dbHistoryChangesHtml(changes, what) {
  const summary = _dbChangeSummary(changes);
  if (!summary) return '';
  return `<div class="db-hist-diff" title="${esc(_dbChangeDetail(changes))}">${esc(summary)} ${esc(what)}</div>`;
}

// ── Putting one back ──────────────────────────────────────────────────────

/** Restore, which is itself an edit and is snapshotted like one — so undoing
 *  an undo works, and a restore aimed at the wrong row is as recoverable as
 *  the thing it was trying to fix. */
async function dbRestoreSnapshot(id) {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  if (!confirm('Restore the deck to this snapshot? The deck as it is now is saved first, so you can undo this.')) return;

  const { playerId, id: deckId } = dbDeck;
  let snap;
  try {
    const res = await fetch(
      `/api/players/${encodeURIComponent(playerId)}/decks/${encodeURIComponent(deckId)}/snapshots/${id}`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    snap = await res.json();
  } catch (e) {
    alert(`Could not read that snapshot: ${e.message}`);
    return;
  }

  // Awaited, unlike every other forced snapshot: what is about to be
  // overwritten is the whole deck, and the row holding it has to exist before
  // the overwrite rather than alongside it.
  await _dbForceSnapshot('restore');

  await dbFetchCardData([...new Set((snap.cards || []).map(c => c.card_name))]);
  _dbApplyRestored(snap.cards || [], snap.categories || []);

  dbSelectedCards.clear();
  dbSettledCats.clear();
  dbRender();
  dbRenderStats();
  await _dbSaveNow();
  _dbLoadHistory();
}

/** A snapshot's two lists, made consistent with each other before either
 *  becomes the deck.
 *
 *  A card can name a category the snapshot's own category list does not have —
 *  a blank one waiting on `dbAutoCategory`, or one that was created after the
 *  card and is not in this row. Left alone, the render invents the pile on the
 *  way past (`dbEnsureCat` in _dbPaint), which means the deck that gets saved
 *  is not the deck that was restored, and a category deleted three snapshots
 *  ago comes back from the dead carrying cards. Every card is put in a
 *  category this state actually has instead, which for a card with nowhere to
 *  go is the type bucket it would have been filed in when it was added. */
function _dbApplyRestored(cards, categories) {
  const cats  = categories.map((c, i) => ({ name: c.name, position: i }));
  const known = new Set(cats.map(c => c.name));
  /* The board comes back with the card. A snapshot taken before boards existed
     names none, and every card in it was in the deck. */
  const restored = cards.map((c, i) => ({ ...c, board: c.board || DB_MAIN_BOARD, position: i }));

  for (const card of restored) {
    if (card.category && known.has(card.category)) continue;
    const cat = dbAutoCategory(card.card_name);
    card.category = cat;
    if (!known.has(cat)) { known.add(cat); cats.push({ name: cat, position: cats.length }); }
  }

  dbCats  = cats;
  dbCards = restored;
}
