// ── Deck Builder — Boards: what a card's place in a deck is ───────────────
// The vocabulary the rest of the tab is written in, and nothing else: a list
// of boards, and the two strings that say where a card is and where a card is
// going. It holds no state of its own — the deck it reads is
// js/deckview-core.js's — which is what lets the modules that move cards be
// loaded and asserted without a mat to draw them on.
//
// ── Boards ────────────────────────────────────────────────────────────────
//
// The mainboard is the deck. The rest are cards that belong to the deck
// without being in it — the commander, one you are considering, one you
// sideboard in. The count, the curve, the average mana value and the export
// all read the mainboard alone, which is what makes a maybeboard somewhere you
// can put a card without breaking the ninety-nine.
//
// **This list is the whole set of boards.** The column that stores one is TEXT
// with no constraint on it and the server validates nothing, so a format that
// wants another board later costs an entry here — a value, not a migration.
// Nothing in this tab names a board except through this list, and that is the
// point: the toggles, the regions on the mat, the Move to… list and the reveal
// are written once, over whatever is in it.
//
// The commander is one of them rather than a category, which is what makes two
// commanders — partners, a Background, a Doctor's Companion — two cards in a
// board and not a decision about the single-string `commander` field on the
// deck record. That field goes on naming the tile art and the recommendations
// lookup; what the *deck* holds is here.
const DB_MAIN_BOARD      = 'main';
const DB_COMMANDER_BOARD = 'commander';

/* `head` — this board is the head of the deck rather than a holding area
 * beside it, and three things follow from the one flag:
 *
 *   it is drawn *before* the deck's categories instead of after them;
 *   it is on the mat by default whenever it holds anything, where a maybeboard
 *     stays off until it is asked for;
 *   a card landing on it switches it on, because a commander that vanished
 *     into a switched-off region would be a card thrown away.
 *
 * They are one flag because they are one statement — a maybeboard is consulted
 * and a commander is looked at. Hiding it is still the toolbar's, and still
 * remembered; see _dbLoadShownBoards() in js/deckview-core.js. */
const DB_BOARDS = [
  { id: DB_MAIN_BOARD, label: 'Mainboard' },
  { id: DB_COMMANDER_BOARD, label: 'Commander', hint: 'The card the deck is built around', head: true },
  { id: 'maybe', label: 'Maybeboard', hint: 'Cards you are considering' },
  { id: 'side',  label: 'Sideboard',  hint: 'Cards you swap in between games' },
];

/* The pile that has no name yet — the ghost, and the category js/carddrag.js
 * hands back off it. A place's category is *which pile the cards would go
 * into*; the ghost's is empty because the pile it stands for does not exist
 * until something lands on it. Which is also why nothing can collide with it:
 * a category name is trimmed and non-empty everywhere one is made, so no real
 * pile ever answers to the empty string. */
const DB_GHOST_PILE = '';

/* ── Where a card is, and where a card is going ────────────────────────────
 *
 * Two strings, one grammar: the board first, then the thing on it, split at
 * the *first* slash. A board id never contains one; a card name does — "Fire
 * // Ice" — and so may a category, which is exactly why the split is at the
 * first and not at any of them.
 *
 *   a card's ref     "main/Sol Ring"   the card in the deck
 *                    "maybe/Sol Ring"  the copy being considered, a different
 *                                      card with a quantity of its own
 *
 *   a place          "main/Lands"      the Lands pile of the mainboard
 *                    "main/"           the pile with no name yet — the ghost
 *                    "maybe"           the maybeboard itself, which has no
 *                                      categories to aim at
 *
 * A place with no slash in it is a whole board. That is what makes the two
 * unambiguous without a sentinel: a pile is aimed at as `board/category`, a
 * board as `board`, and neither can be mistaken for the other however anything
 * is named.
 *
 * The mat writes refs into data-carry and data-moves and places into
 * data-drop, so js/carddrag.js goes on knowing only that it picked something
 * up and let it go somewhere. */
function dbPlace(board, category) {
  return category === null || category === undefined ? board : `${board}/${category}`;
}

function dbReadPlace(key) {
  const at = String(key ?? '').indexOf('/');
  return at < 0
    ? { board: String(key ?? ''), category: null }
    : { board: key.slice(0, at), category: key.slice(at + 1) };
}

const dbCardRef = card => `${card.board || DB_MAIN_BOARD}/${card.card_name}`;

/* Is this one of the boards? Asked wherever a board id arrives from outside the
 * tab — a stored preference, a control's value — so that an id nothing answers
 * to falls back rather than making a region of the mat nobody can reach. */
const _dbBoardExists = id => DB_BOARDS.some(b => b.id === id);

/* The boards a card can be *added* to, in the order they are offered.
 *
 * Every board except the ones at the head of the deck. A head board is what
 * the deck is built around rather than somewhere cards go — the commander is
 * chosen from the mat, by ♛ Make commander on a card that is already in front
 * of you, and offering it in a list beside "Maybeboard" would be a second
 * answer to a question that is already answered better. Which is a rule about
 * the flag and not a list of ids, so a board added to DB_BOARDS is offered
 * here the moment it exists. */
const dbAddBoards = () => DB_BOARDS.filter(b => !b.head);

function dbReadRef(ref) {
  const { board, category } = dbReadPlace(ref);
  return { board, name: category ?? '' };
}

/* The one row a ref names. Both halves have to match: a card in the deck and
 * the same card in the maybeboard are two rows, and the whole of what boards
 * add is that touching one must never touch the other. */
function dbFindCard(ref) {
  const { board, name } = dbReadRef(ref);
  return dbCards.find(c => c.card_name === name && (c.board || DB_MAIN_BOARD) === board);
}

const dbBoardCards = board => dbCards.filter(c => (c.board || DB_MAIN_BOARD) === board);

/* The deck itself, which is what every number about the deck counts. */
const dbMainCards = () => dbBoardCards(DB_MAIN_BOARD);

/* What the deck is built around — nought, one, or two of them. The deck record
 * still names one, and still does the two jobs it always did; this is what the
 * deck actually holds, and it is what the count leaves out and what draws at
 * the head of the mat. */
const dbCommanderCards = () => dbBoardCards(DB_COMMANDER_BOARD);

/* Whether a board is on the mat when nobody has said otherwise. A head board
 * is, as soon as it has something on it — the alternative is a deck whose
 * commander is not drawn until you go and ask for it. Everything else is off:
 * a maybeboard is consulted, and a region of the mat you did not ask for is
 * the vertical spend the frame exists to fight. */
const dbBoardOnByDefault = board =>
  !!board.head && board.id !== DB_MAIN_BOARD && dbBoardCards(board.id).length > 0;
