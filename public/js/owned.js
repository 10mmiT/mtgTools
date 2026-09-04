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

/* ── What colour a shelf speaks in ─────────────────────────────────────────
 *
 * One rule, because the app had two and they disagreed on screen. A card's
 * ownership was said in *collection* colours by the browsing tabs and in
 * *player* colours by the deck mat, so the strip on a card could be pink for
 * Kari while the chip underneath it explaining that Kari has it was blue.
 * Sometimes the two agreed by luck, which is what made it look intermittent
 * rather than broken.
 *
 * A person's colour wins where there is a person, and for two reasons beyond
 * consistency. It is a *slot* — playerColor() returns var(--player-N), so a
 * theme repaints it — where a collection's colour is a raw hex that nothing
 * repaints, which is the defect the player palette was moved out of (see
 * PLAYER_SLOTS in js/state.js). And it is not chosen by anybody: a
 * collection's colour is assigned by how many collections existed when it was
 * added, with no control anywhere to change it, so nothing is being taken away
 * by not showing it.
 *
 * A collection nobody owns has no person to speak for it, and there its own
 * colour is the only answer there is — and a real one, since it is what tells
 * two of the group's boxes apart. */
function ownerInk(col) {
  const player = colOwner(col);
  return player ? playerColor(player) : col.color;
}

/* The order a bar picks its one colour from, wherever several shelves hold the
 * card: people before the group's boxes, then by name. Stable, so the same
 * card is the same colour on every tab and after every reload — the order the
 * collections happen to arrive in is not. */
function _byHolder(a, b) {
  const person = c => (colOwner(c) ? 0 : 1);
  const who    = c => (colOwner(c)?.name || 'The group');
  return person(a) - person(b) ||
         who(a).localeCompare(who(b)) ||
         String(a.name).localeCompare(String(b.name));
}

/* Who *else* has it — every loaded collection that is not on the shelf being
 * counted. This is the half that answers "who could lend me one", and it is
 * what the broken bar on a card means.
 *
 * A collection nobody owns is the group's and is named as such: it is a real
 * answer, not a row somebody forgot to fill in. A card in no collection at all
 * comes back as an empty list, which is what "nobody has this" is.
 *
 * ── Why the order is not the order the collections happen to be in ────────
 *
 * The strip on a card is one bar and can only be one colour, so it takes the
 * first of these — and with the list in whatever order /api/state returned,
 * "first" meant a card that Kari and Ola both have wearing the colour of the
 * house box, because the house box happened to be row one. The bar was not
 * wrong about *whether* somebody has it, only about who, which is exactly the
 * shape of "the strip is sometimes the wrong colour".
 *
 * So: people before the group's boxes, then by name. A named person is a
 * better answer than "The group" because they are who you would ask, and the
 * order is stable, so the same card is the same colour on every tab and on
 * every reload. */
function holdersOf(cardName) {
  const counted = new Set(ownShelf().map(c => c.key));
  return (state.collections || [])
    .filter(col => col.status === 'loaded' && !counted.has(col.key) &&
                   (col.cards.get(cardName)?.qty || 0) > 0)
    .sort(_byHolder)
    .map(col => {
      const player = colOwner(col);
      return {
        who:        player ? player.name : 'The group',
        ink:        ownerInk(col),
        collection: col.name,
        qty:        col.cards.get(cardName).qty,
      };
    });
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

  /* qty and not has(): a row that has fallen to nought is a row, and "×0" in
     the title is not an answer to "who has this". */
  const mine = ownShelf().filter(c => (c.cards.get(name)?.qty || 0) > 0);
  if (mine.length) {
    const said = mine.map(c => `${c.name} ×${c.cards.get(name).qty}`).join(', ');

    /* ── Green means *you*, so it needs there to be a you ──────────────────
     *
     * With nobody to be, ownShelf() widens to every collection loaded — the
     * honest reading for a *count*, since the group's shelf is the only one
     * such a deployment has. But green on a card does not read as "the group
     * has this", it reads as "you have this", and on a tab showing three
     * people's binders it put the same green bar on all of them.
     *
     * So where the app cannot say who you are it keeps the solid bar — a card
     * somebody has is not the same as a card nobody has — and drops the claim
     * that it is yours, taking the colour of whose box it is in instead. That
     * is the colour of the badge underneath it, and it is the question a
     * deployment with no players is actually asking: not "is it mine" but
     * "whose is it". Set up players and link an account and the green comes
     * back, meaning what it says. */
    if (!myPlayerId()) {
      const [first] = mine.slice().sort(_byHolder);
      return `<div class="card-own card-own-mine" style="--own-ink:${ownerInk(first)}"
        title="${esc(said)}"></div>`;
    }
    return `<div class="card-own card-own-mine" title="${esc(said)}"></div>`;
  }

  /* One bar, so one colour: the first holder's, which holdersOf() has ordered
     so that it is a person rather than whichever collection came back first.
     But the *title* names every one of them — a bar in Kari's colour on a card
     that Kari and Ola both have is not wrong, and pointing at it should not
     make it look as though Ola has been forgotten. */
  const holders = holdersOf(name);
  if (!holders.length) return '';
  const said = holders.map(h => `${h.who} — ${h.collection} ×${h.qty}`).join(', ');
  return `<div class="card-own card-own-their" style="--own-ink:${holders[0].ink}"
    title="${esc(said)}"></div>`;
}
