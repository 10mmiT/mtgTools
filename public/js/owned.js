// ── Whose shelf holds this card ───────────────────────────────────────────
// One answer to "do we own this", for the whole app.
//
// It was the Deck Builder's for a while, and only the Deck Builder's — the
// three scopes, the shelf they resolve to, and who else has a card all lived
// in js/deckview-owned.js because the deck was the first thing that needed to
// ask. Meanwhile the Scryfall search, the Set Browser and the want lists
// answered a *different* question, counting every collection loaded, so the
// same card could wear a badge meaning "somebody owns this" on one tab and one
// meaning "*you* own this" on the next.
//
// So the ladder lives here now and the deck builder's own module is the caller
// it started as. What is left there is everything that needs a *deck* to be
// asked — how short of a card the deck is, the chips, the readout, the missing
// list. What is here is what needs only a name.
//
// Whose a collection is, is js/collections.js's colOwner(). Who *you* are is
// js/auth.js's myPlayerId(), which works in open mode too, where it is the
// browser-remembered name matched to a player.

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
const OWN_SCOPES = [
  { id: 'mine',  label: 'Mine',        hint: 'Only the collections you own' },
  { id: 'group', label: 'The group’s', hint: 'Yours, and the collections nobody owns' },
  { id: 'all',   label: 'Everyone’s',  hint: 'Every collection loaded' },
];

/* Remembered per person rather than per browser. Two people share a browser in
 * open mode — the identity there is a name typed into Available@'s "Who are
 * you?" bar — and "mine" means something different to each of them, so a scope
 * stored under one of them must not follow the other.
 *
 * The key still says `db`. It is the Deck Builder's old one, kept spelled the
 * way it was written so that a preference somebody has already set survives
 * the scope becoming the whole app's — a rename here would silently put every
 * existing browser back on the default. */
const OWN_SCOPE_KEY = 'mtgtools_db_own_scope';

function _ownScopeKey() { return `${OWN_SCOPE_KEY}:${myPlayerId() || ''}`; }

/* Which of the three is being asked, and the one place that decides it.
 *
 * "Mine" needs somebody to be. An app that cannot say who you are reads as the
 * group's whatever is stored — the control is not offered at all in that case,
 * and a stored preference from a browser that once knew must not quietly count
 * nobody's collections as yours. */
function ownScope() {
  if (!myPlayerId()) return 'group';
  try {
    const stored = localStorage.getItem(_ownScopeKey());
    return OWN_SCOPES.some(s => s.id === stored) ? stored : 'mine';
  } catch { return 'mine'; }
}

function setOwnScope(scope) {
  if (!OWN_SCOPES.some(s => s.id === scope)) return;
  try { localStorage.setItem(_ownScopeKey(), scope); } catch {}
  /* The deck builder redraws itself and everything hanging off the readout;
     every other tab redraws when it is next visited, which is when its marks
     are next looked at. Guarded because this module is loaded on pages and in
     tests where the builder is not. */
  if (typeof dbOwnershipChanged === 'function') dbOwnershipChanged();
}

/* The collections a scope counts, defaulting to the one that is set. The
 * parameter is there for the callers that ask the same question of a different
 * scope than the app is on — the search drawer's own narrowing — so there is
 * one rule about whose shelf is whose and not two that can drift apart.
 *
 * Loaded ones only. Half a collection is not a smaller shelf, it is a wrong
 * answer, and a mark that appears card by card while pages come in is worse
 * than one that appears once.
 *
 * With nobody to be, every shelf is the group's — which is both what an app
 * with no identity can honestly say and what makes the answer read as the
 * group's rather than break. */
function ownShelf(scope = ownScope()) {
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
function ownedQty(cardName) {
  let qty = 0;
  for (const col of ownShelf()) qty += col.cards.get(cardName)?.qty || 0;
  return qty;
}

/* Who *else* has it — every loaded collection that is not on the shelf being
 * counted, grouped by the person it belongs to. This is the half that answers
 * "who could lend me one", and it is what the broken bar on a card means.
 *
 * A collection nobody owns is the group's and is named as such: it is a real
 * answer, not a row somebody forgot to fill in. A card in no collection at all
 * comes back as an empty list, which is what "nobody has this" is. */
function holdersOf(cardName) {
  const counted = new Set(ownShelf().map(c => c.key));
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

// ── The name a collection is filed under ──────────────────────────────────
/* A collection is names and quantities, written by whichever importer filled
 * it, and the name it wrote is not always the name the card is asked about
 * here. EDHREC's recommendations and Scryfall's `card_faces[0].name` both say
 * "Delver of Secrets" where an Archidekt export says
 * "Delver of Secrets // Insectile Aberration", and a shelf holding the card
 * would answer "no" to the question about the card.
 *
 * It goes both ways, which is the part that is easy to get half right. An
 * exporter may write either name, and the app asks with either name, so:
 *
 *   asked long, filed short   "Delver of Secrets // Insectile Aberration"
 *                             against a shelf holding "Delver of Secrets" —
 *                             answered by cutting the name down
 *   asked short, filed long   the EDHREC recommendation and the Scryfall front
 *                             face, against an Archidekt export — answered by
 *                             the index below, because you cannot get from
 *                             "Delver of Secrets" to the whole name without
 *                             looking at what is on the shelf
 *
 * One rule, here, rather than the same fallback written at every tile that
 * draws a mark — which is how half of them would end up with only the half of
 * it that was easy. The drawer already does this for card *data*
 * (js/deckview-panels.js caches under both), and this is the same fact about
 * the same disagreement. */

/* Front face → the whole name, over every loaded shelf, built once and thrown
 * away when the shelves change. It is worth caching because the mark is drawn
 * per card and a shelf can be thousands long: a page of 240 recommendations
 * would otherwise walk every collection 240 times.
 *
 * Only names with a ' // ' in them go in it, which is a few dozen out of
 * thousands — an index of the whole shelf would cost more to hold than the
 * scan it saves. */
let _ownFrontIndex = null;
let _ownFrontStamp = '';

function _ownFrontNames() {
  const loaded = (state.collections || []).filter(c => c.status === 'loaded');
  /* Cheap enough to compute every call, and it changes on exactly the events
     that make the index wrong: a collection arriving, leaving, or being
     re-imported with a different number of cards in it. */
  const stamp = loaded.map(c => `${c.key}:${c.cards.size}`).join('|');
  if (_ownFrontIndex && stamp === _ownFrontStamp) return _ownFrontIndex;

  const index = new Map();
  for (const col of loaded) {
    for (const name of col.cards.keys()) {
      if (name.includes(' // ')) index.set(name.split(' // ')[0], name);
    }
  }
  _ownFrontIndex = index;
  _ownFrontStamp = stamp;
  return index;
}

function ownedName(cardName) {
  if (!cardName) return null;
  const loaded = (state.collections || []).filter(c => c.status === 'loaded');
  const held = name => loaded.some(c => c.cards.has(name));

  if (held(cardName)) return cardName;

  const front = String(cardName).split(' // ')[0];
  if (front !== cardName && held(front)) return front;

  return _ownFrontNames().get(cardName) || cardName;
}

// ── The mark on the card ──────────────────────────────────────────────────
/* A strip along the top edge of the card picture, and nothing at all for a
 * card nobody has.
 *
 * The third state being *absent* is the whole reason this reads as a mark
 * rather than as an annotation: a page of Scryfall results is mostly cards
 * nobody owns, and a marker on every one of them is a page of markers. The
 * text badges under the tiles have always worked this way.
 *
 * Where it goes and what it looks like is css/components.css's; three shapes
 * were drawn on real cards before this one was picked, and the bar won on a
 * fact none of it was designed around — a Magic card has a black border, and
 * the bar fits inside it. It covers no artwork, no title and no mana cost, at
 * any tile size, on any card.
 *
 * Solid is the shelf in scope. Broken is somebody else's, in their colour: the
 * same object with its fill interrupted, so colour says *whose* and fill says
 * *whether you have to ask*. That is the sentence the mat's badges make, said
 * small enough to survive at 118 pixels.
 *
 * Returns markup for the inside of a .card-turnable, or '' — so a caller can
 * always interpolate it and never has to ask whether there is one. */
function cardOwnMark(cardName) {
  const name = ownedName(cardName);
  if (!name) return '';

  const mine = ownShelf().filter(c => c.cards.has(name));
  if (mine.length) {
    const said = mine.map(c => `${c.name} ×${c.cards.get(name).qty}`).join(', ');
    return `<div class="card-own card-own-mine" title="${esc(said)}"></div>`;
  }

  /* The first holder and not all of them. This is a mark, not a list — who
     else has it, in full, is the missing list's answer and the badges'. */
  const [holder] = holdersOf(name);
  if (!holder) return '';
  return `<div class="card-own card-own-their" style="--own-ink:${holder.ink}"
    title="${esc(`${holder.who} — ${holder.collection} ×${holder.qty}`)}"></div>`;
}
