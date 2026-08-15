const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.dirname(process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json'));
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'available.db');
console.log(`[db] Data directory : ${dataDir}`);
console.log(`[db] SQLite database: ${dbPath}`);

// Warn when running inside a Docker container with no volume mounted at /app/data.
// The VOLUME declaration in the Dockerfile creates an anonymous volume, which Docker
// discards whenever the container is recreated (e.g. Unraid image updates / Apply).
// Map /app/data to a persistent host path to avoid data loss.
const isDocker = fs.existsSync('/.dockerenv');
const isMounted = (() => {
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    return mounts.split('\n').some(line => {
      const mp = line.split(' ')[1];
      return mp && (dataDir === mp || dataDir.startsWith(mp + '/'));
    });
  } catch { return true; } // can't tell — assume OK
})();
if (isDocker && !isMounted) {
  console.warn('[db] WARNING: /app/data does not appear to be on a mounted volume.');
  console.warn('[db]          Data will be lost when the container is recreated.');
  console.warn('[db]          Map /app/data to a persistent host path (e.g. on Unraid:');
  console.warn('[db]          Container Path=/app/data → Host Path=/mnt/user/appdata/mtgtools).');
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS calendars (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS availability (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    person_name TEXT NOT NULL,
    date        TEXT NOT NULL,
    UNIQUE(calendar_id, person_name, date)
  );
  CREATE INDEX IF NOT EXISTS idx_avail_cal ON availability(calendar_id, date);
  CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'player',
    player_id     TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS account_requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    requested_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Whose shelf this is. One owner, and it may have none: a shared box belongs
  -- to the group, so a null here is the honest answer rather than a row nobody
  -- got round to filling in — it counts as the group's and never as any one
  -- person's.
  --
  -- No foreign key, because there is no players table to point at: a player
  -- lives inside the app_state JSON blob. What keeps a dead id from meaning
  -- anything is routes/state.js, which clears the owner of a collection whose
  -- player has gone — the collection itself stays, and becomes the group's.
  CREATE TABLE IF NOT EXISTS collections (
    key             TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    source          TEXT NOT NULL,
    col_id          TEXT,
    color           TEXT NOT NULL,
    cards_json      TEXT NOT NULL DEFAULT '{}',
    entries         INTEGER NOT NULL DEFAULT 0,
    total           INTEGER,
    saved_at        TEXT,
    owner_player_id TEXT
  );
  CREATE TABLE IF NOT EXISTS app_state (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL DEFAULT '{}',
    version    INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'player',
    player_id  TEXT,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  -- A card's place in a deck is a board and a category, and the board is the
  -- coarser of the two: the mainboard is the deck, and the rest — a maybeboard
  -- of cards being considered, a sideboard, the commander — are cards that are
  -- *not* in the deck but belong to it. So the key is (deck, board, card): the
  -- same card can sit in the maybeboard while a copy is in the deck, with a
  -- quantity of its own on each side.
  --
  -- TEXT and no CHECK, deliberately. The set of boards is open — a format that
  -- wants another one later costs a new value in DB_BOARDS and nothing here.
  --
  -- printing is which printing of the card the deck runs, or NULL for the app's
  -- pick — see readPrinting below for what is in it and why it is one column of
  -- JSON rather than six columns of its own. One printing per card and not per
  -- copy: ten Forests are ten of the same Forest, and the key above is what
  -- that buys — every path that finds a card by name goes on being able to.
  CREATE TABLE IF NOT EXISTS deck_cards (
    deck_id   TEXT NOT NULL,
    card_name TEXT NOT NULL,
    qty       INTEGER NOT NULL DEFAULT 1,
    category  TEXT NOT NULL DEFAULT '',
    board     TEXT NOT NULL DEFAULT 'main',
    position  INTEGER NOT NULL DEFAULT 0,
    printing  TEXT,
    PRIMARY KEY (deck_id, board, card_name)
  );
  CREATE INDEX IF NOT EXISTS idx_deck_cards_deck ON deck_cards(deck_id);
  CREATE TABLE IF NOT EXISTS deck_categories (
    deck_id  TEXT NOT NULL,
    name     TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (deck_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_deck_categories_deck ON deck_categories(deck_id);
  -- What a deck used to be. The save path is a full replace of every card row,
  -- so the state before a save is gone the instant it runs; a row here is a
  -- copy of that state, taken before something that could lose it.
  --
  -- state_json rather than the spec's cards_json: it holds the categories too,
  -- and a deck restored without them is a deck whose piles are gone.
  --
  -- No foreign key, because there is no decks table to point at — a deck lives
  -- inside the app_state JSON blob, and deck_cards has always been keyed the
  -- same loose way. deck-history.js is what keeps these rows from outliving
  -- their deck; see the cap and the tombstone there.
  CREATE TABLE IF NOT EXISTS deck_snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id    TEXT    NOT NULL,
    taken_at   INTEGER NOT NULL,   -- epoch ms
    reason     TEXT    NOT NULL,   -- edit | import | category | move | restore | deck-delete
    state_json TEXT    NOT NULL    -- {cards:[…], categories:[…]}
  );
  CREATE INDEX IF NOT EXISTS idx_deck_snapshots_deck ON deck_snapshots(deck_id, taken_at DESC);
  -- Appearance, per person rather than per browser. Keyed by username because
  -- that is what identifies a user here: the users table has no integer id,
  -- and a session carries the name, not a row number. Deleting a user takes
  -- their preferences with them — foreign_keys is ON above, so the cascade is
  -- real rather than decorative.
  --
  -- A separate table and not columns on users: preferences have their own
  -- lifetime and their own concern. playmat_* is written by the playmat work
  -- that follows; the row is created the first time anything is set.
  CREATE TABLE IF NOT EXISTS user_prefs (
    username     TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
    theme        TEXT    NOT NULL DEFAULT 'dark',
    playmat_kind TEXT    NOT NULL DEFAULT 'none',   -- none | scryfall | preset | upload
    playmat_ref  TEXT,                              -- card id | preset id | filename
    playmat_url  TEXT,                              -- resolved image URL
    card_motion  TEXT    NOT NULL DEFAULT 'on',     -- on | off
    updated_at   INTEGER NOT NULL
  );
`);

// ── Schema migrations ────────────────────────────────────────────────────────
// Add version column to app_state if it doesn't exist yet (migration from pre-3.1)
try {
  db.exec('ALTER TABLE app_state ADD COLUMN version INTEGER NOT NULL DEFAULT 0');
  console.log('[db] Migrated: added version column to app_state');
} catch { /* column already exists — ignore */ }

// Whether cards move. Declared in the CREATE above for a database made from
// now on, and added here for one made before — the default is what everyone
// who has already set a theme or a playmat gets, which is the same 'on' a new
// row starts at, so the migration cannot change what anybody sees.
try {
  db.exec("ALTER TABLE user_prefs ADD COLUMN card_motion TEXT NOT NULL DEFAULT 'on'");
  console.log('[db] Migrated: added card_motion column to user_prefs');
} catch { /* column already exists — ignore */ }

/* Whose shelf a collection is. Declared in the CREATE above for a database
 * made from now on, and added here for one made before — where every existing
 * collection gets a null, which is the group's. That is the migration in
 * full: nothing else about a collection changes, and a deployment that never
 * sets an owner reads exactly as it did. */
try {
  db.exec('ALTER TABLE collections ADD COLUMN owner_player_id TEXT');
  console.log('[db] Migrated: added owner_player_id column to collections');
} catch { /* column already exists — ignore */ }

/* Which board a card is on. Added to a table that predates boards, where every
 * row is a card in the deck proper — so every existing row is 'main' and
 * nothing moves.
 *
 * A table copy rather than an ALTER, because the primary key changes with the
 * column: (deck_id, card_name) says a card is in a deck once, and the whole
 * point of a maybeboard is that it can be in it twice. SQLite cannot alter a
 * primary key in place, and the rebuild is what the copy is for.
 *
 * Guarded by the column rather than by a version number, and run inside one
 * transaction: a database that already has the column is left alone, and one
 * that dies halfway through still has its old table. */
const deckCardCols = db.prepare('PRAGMA table_info(deck_cards)').all();
if (deckCardCols.length && !deckCardCols.some(c => c.name === 'board')) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE deck_cards_boards (
        deck_id   TEXT NOT NULL,
        card_name TEXT NOT NULL,
        qty       INTEGER NOT NULL DEFAULT 1,
        category  TEXT NOT NULL DEFAULT '',
        board     TEXT NOT NULL DEFAULT 'main',
        position  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (deck_id, board, card_name)
      );
      INSERT INTO deck_cards_boards (deck_id, card_name, qty, category, board, position)
        SELECT deck_id, card_name, qty, category, 'main', position FROM deck_cards;
      DROP TABLE deck_cards;
      ALTER TABLE deck_cards_boards RENAME TO deck_cards;
      CREATE INDEX IF NOT EXISTS idx_deck_cards_deck ON deck_cards(deck_id);
    `);
  })();
  console.log('[db] Migrated: deck_cards gained a board, keyed (deck_id, board, card_name)');
}

/* Which printing of the card the deck runs. Added to a table where every row is
 * a name, and a name is what every row goes on being: NULL means what it has
 * always meant — the app picks the printing, the mat draws its art and the
 * price is its price.
 *
 * An ALTER and not the table copy the board column needed, because the primary
 * key does not change with it: a card in a deck is still one row however many
 * printings exist of it. Guarded by the column rather than by a version number,
 * in the pattern owner_player_id uses, and read fresh rather than reusing the
 * PRAGMA above because the migration before this one may have rebuilt the
 * table out from under it. */
if (!db.prepare('PRAGMA table_info(deck_cards)').all().some(c => c.name === 'printing')) {
  db.exec('ALTER TABLE deck_cards ADD COLUMN printing TEXT');
  console.log('[db] Migrated: deck_cards gained a printing');
}

/* The commander stops being a category and becomes a board.
 *
 * Every deck in the app paid for the old arrangement: a category header, a
 * pile and a row of mat, spent on one card that never moves and never sorts,
 * and known to the deck already — the record names it, the count leaves it
 * out, the recommendations key off it. As a board it is one of the things
 * ticket 04 built, and partners cost nothing: two commanders are two cards in
 * a board, rather than a decision about a single-string field.
 *
 * So the cards move and the category goes. Guarded by a marker row rather than
 * by looking for the category, because "Commander" is an ordinary category
 * name from now on — somebody may make one, and a migration that ran again
 * would take it away from them. One transaction, so a process that dies
 * halfway leaves a deck whole.
 *
 * A deck whose cards say who the commander is but whose record does not adopts
 * the first of them. That state is reachable — a deck imported from Archidekt
 * has the category filled in and the field empty — and the field still has two
 * jobs to do afterwards: it names the tile art, and it is what EDHREC is asked
 * about. Losing the card instead is the one outcome worth writing code to
 * avoid. */
const COMMANDER_MIGRATION = 'migration:commander-board';
if (!db.prepare('SELECT 1 FROM app_state WHERE key = ?').get(COMMANDER_MIGRATION)) {
  db.transaction(() => {
    const promoted = db.prepare(
      "SELECT deck_id, card_name FROM deck_cards WHERE board = 'main' AND category = 'Commander' ORDER BY position, card_name"
    ).all();

    // The deck records, which live in the app_state blob rather than in a
    // table of their own — so this is a read, a walk and a write-back.
    const stateRow = db.prepare("SELECT value_json FROM app_state WHERE key = 'state'").get();
    if (stateRow && promoted.length) {
      const first = new Map();
      for (const row of promoted) if (!first.has(row.deck_id)) first.set(row.deck_id, row.card_name);
      try {
        const state = JSON.parse(stateRow.value_json);
        let adopted = 0;
        for (const player of (state.players || [])) {
          for (const deck of (player.decks || [])) {
            if ((deck.commander || '').trim() || !first.has(deck.id)) continue;
            deck.commander = first.get(deck.id);
            adopted++;
          }
        }
        if (adopted) {
          /* The version goes up with the value, as every other write to this
           * row does: a browser left open across the restart holds the state
           * from before, and it has to be told to refresh rather than allowed
           * to save the old commanders back over these. */
          db.prepare("UPDATE app_state SET value_json = ?, version = version + 1 WHERE key = 'state'")
            .run(JSON.stringify({ players: state.players || [] }));
          console.log(`[db] Migrated: ${adopted} deck(s) adopted the commander their cards already named`);
        }
      } catch (e) {
        console.warn('[db] Commander adoption skipped:', e.message);
      }
    }

    db.exec(`
      UPDATE deck_cards SET board = 'commander' WHERE board = 'main' AND category = 'Commander';
      DELETE FROM deck_categories WHERE name = 'Commander';
    `);

    /* And the commanders that were never in the category. The count this
     * replaces did not read the category at all — it subtracted the card whose
     * name the deck record holds, wherever in the deck it happened to be
     * filed. A deck whose commander drifted into Lands was still a deck of
     * ninety-nine, and it has to stay one: the same card, taken out of the
     * mainboard by the same rule, one last time.
     *
     * Only where the category left the board empty. A deck that had both — the
     * category naming one card and the record another — keeps exactly the one
     * it was already counting, which is the one that was in the category. */
    if (stateRow) {
      try {
        const named = db.prepare(
          "SELECT 1 FROM deck_cards WHERE deck_id = ? AND board = 'commander'");
        const move = db.prepare(
          "UPDATE deck_cards SET board = 'commander' WHERE deck_id = ? AND board = 'main' AND card_name = ?");
        let loose = 0;
        for (const player of (JSON.parse(stateRow.value_json).players || [])) {
          for (const deck of (player.decks || [])) {
            const name = (deck.commander || '').trim();
            if (!name || !deck.id || named.get(deck.id)) continue;
            loose += move.run(deck.id, name).changes;
          }
        }
        if (loose)
          console.log(`[db] Migrated: ${loose} commander(s) out of the deck itself and onto the board`);
      } catch (e) {
        console.warn('[db] Loose commanders skipped:', e.message);
      }
    }
    db.prepare('INSERT INTO app_state (key, value_json, version) VALUES (?, ?, 0)')
      .run(COMMANDER_MIGRATION, JSON.stringify({ at: Date.now() }));
    if (promoted.length)
      console.log(`[db] Migrated: ${promoted.length} commander(s) out of the category and onto the board`);
  })();
}

const DEFAULT_CAL_ID = 'default';

// Ensure the default calendar exists
const exists = db.prepare('SELECT id FROM calendars WHERE id = ?').get(DEFAULT_CAL_ID);
if (!exists) {
  db.prepare('INSERT INTO calendars (id, name, description) VALUES (?, ?, ?)').run(
    DEFAULT_CAL_ID, 'Group Availability', 'When is everyone free?'
  );
}

// ── Which printing a deck card runs ──────────────────────────────────────────
/* What the printing column holds.
 *
 * A trimmed snapshot of one real Scryfall printing, taken on the day it was
 * chosen — not a key into a cache. The mat's art, the deck's price and an
 * export's `(RAV) 266` are then all answerable from the row itself, which is
 * what keeps this feature off the nightly job and the second table a live
 * lookup would have cost. The price is the price on the day, deliberately and
 * visibly: chosen_at is what says so, and what a later re-pricing pass will
 * read.
 *
 * One column of JSON rather than seven columns of their own because nothing on
 * this side ever queries these fields — the export, the mat and the readout are
 * all the browser's, and the row is carried whole — and because it is the shape
 * scryfall.db already stores a card in.
 *
 * These functions are the only way in and out, so the shape is one thing rather
 * than a convention. All of them are total: anything that is not a printing is
 * null, which is the same answer as a card nobody has chosen one for. */
const PRINTING_FIELDS =
  ['id', 'set', 'set_name', 'collector_number', 'image', 'price_eur', 'chosen_at'];

/** A printing, from the column's text or from a client's object — trimmed to
 *  the fields above, in that order, or null if it names no printing.
 *
 *  The fixed order is not tidiness: the deck's history decides whether a state
 *  has changed by serialising it, and two orderings of the same seven keys
 *  would be two states — a row in the History panel for a change nobody made.
 *
 *  A field that is missing stays missing rather than becoming an empty string.
 *  A printing Cardmarket has no price for is unknown, and unknown is not free. */
function readPrinting(value) {
  let raw = value;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return null; } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  // The id is what makes this point at a real card. Without one there is
  // nothing to re-price later and nothing to have chosen.
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  const printing = {};
  for (const field of PRINTING_FIELDS) {
    if (typeof raw[field] === 'string' && raw[field] !== '') printing[field] = raw[field];
  }
  return printing;
}

/** The same, as the column stores it: JSON, or NULL. */
const writePrinting = value => {
  const printing = readPrinting(value);
  return printing && JSON.stringify(printing);
};

/** A deck card as everything outside this database sees one — the row the cards
 *  endpoint answers with, and the row a snapshot of the deck holds.
 *
 *  A card is a name unless somebody has said otherwise, so the field is an
 *  object where a printing was chosen and is simply not there where none was.
 *  Absent and null mean the same thing, and the shorter of the two is what a
 *  deck full of cards nobody has touched carries — which is what keeps such a
 *  deck snapshotting byte-for-byte as it did before the column existed. */
const deckCardRow = ({ printing, ...card }) => {
  const chosen = readPrinting(printing);
  return chosen ? { ...card, printing: chosen } : card;
};

module.exports = { db, DEFAULT_CAL_ID, readPrinting, writePrinting, deckCardRow };
