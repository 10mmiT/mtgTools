# Deck Builder Tab — Implementation Prompt

## Goal

Replace the read-only **Deck View** tab with a full **Deck Builder** tab for Commander (EDH) deck construction. The user picks a commander, discovers cards via Scryfall search and EDHREC recommendations, organises them into custom categories, and can import/export their list. The deck and its card list persist server-side in SQLite.

---

## Existing Codebase (read before starting)

This is a Node.js + Express + SQLite (better-sqlite3) + vanilla JS SPA. No frameworks, no bundler, no TypeScript.

**Key files to read first:**
- `server.js` — Express entry point, mounts routes
- `available-db.js` — SQLite setup, all table definitions
- `routes/state.js` — app state API (players, decks, collections, want lists). Decks are stored as JSON in `app_state`. Uses optimistic concurrency (version field, 409 on conflict)
- `routes/proxy.js` — Archidekt/Scryfall proxy routes
- `public/js/deckview.js` — current Deck View tab (will be replaced/rewritten)
- `public/js/state.js` — client-side state management, `stateToJSON()`, `hydrateState()`, server polling
- `public/js/wants.js` — want list tab. Has Scryfall autocomplete and batch-fetch patterns you should reuse
- `public/js/sortui.js` — shared sort/column controls (reuse for deck card sorting)
- `public/js/card.js` — card detail modal (clicking any card opens this)
- `public/js/search.js` — Scryfall search tab
- `public/js/main.js` — tab routing, URL hash, sidebar nav, card-click handler
- `public/index.html` — all HTML panes; the `#tab-deckview` section gets replaced
- `public/css/style.css` — all styles; dark/light theme via CSS vars
- `middleware/auth.js` — `requireAuth`, `requireAdmin`, `requirePlayerAccess`

**Patterns to follow:**
- All API routes go in `routes/`. Mount them in `server.js`
- All external API calls (Scryfall, Archidekt, now EDHREC) go through server-side proxies in `routes/proxy.js` to avoid CORS and control rate limits
- Scryfall rate limit: 10 req/sec max. Batch with `/cards/collection` (75 cards/batch). Add 100ms delay between batches
- Client fetches state via `GET /api/state`, saves via `POST /api/state`. State polling happens every 5s in `main.js`
- Card clicks everywhere use `openCard(cardName, printingId)` which opens the modal/Card tab
- Mana symbols use mana-font CSS classes (`<i class="ms ms-w ms-cost">`)
- Use the existing sort/column system from `sortui.js` — call `mountSortControl()` and `mountColumnMenu()`
- Auth: all API routes that modify data require auth. Use `requireAuth` for logged-in users, `requirePlayerAccess` for player-specific data
- No npm additions unless absolutely necessary. The existing deps (express, better-sqlite3, bcryptjs, helmet, compression, express-rate-limit, uuid, supertest) should cover everything

---

## Data Model

### Current deck structure (in app_state JSON)

Decks live inside players:
```json
{
  "players": [
    {
      "id": "abc123",
      "name": "Tim",
      "decks": [
        {
          "id": "deck-uuid",
          "name": "Atraxa Superfriends",
          "commander": "Atraxa, Praetors' Voice",
          "commanderImg": "https://cards.scryfall.io/...",
          "source": "archidekt",
          "deckId": "123456",
          "deckUrl": "https://archidekt.com/decks/123456",
          "cardCount": 100,
          "bracket": 3
        }
      ]
    }
  ]
}
```

Currently decks are **metadata-only**. The card list only exists temporarily in `deckview.js` when loaded from Archidekt/CSV. It's not persisted.

### New: persist deck card lists

Add a new SQLite table in `available-db.js`:

```sql
CREATE TABLE IF NOT EXISTS deck_cards (
  deck_id   TEXT NOT NULL,
  card_name TEXT NOT NULL,
  qty       INTEGER NOT NULL DEFAULT 1,
  category  TEXT NOT NULL DEFAULT '',
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (deck_id, card_name)
);
CREATE INDEX IF NOT EXISTS idx_deck_cards_deck ON deck_cards(deck_id);

CREATE TABLE IF NOT EXISTS deck_categories (
  deck_id  TEXT NOT NULL,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (deck_id, name)
);
CREATE INDEX IF NOT EXISTS idx_deck_categories_deck ON deck_categories(deck_id);
```

This keeps card lists separate from the app_state JSON (which stays for player/deck metadata). Benefits: no giant JSON blob, can query individual decks, no concurrency issues with the main state.

### New API endpoints

Add in a new `routes/decks.js` (or extend `routes/state.js`):

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/decks/:deckId/cards` | requireAuth | Get full card list + categories for a deck |
| `PUT` | `/api/decks/:deckId/cards` | requirePlayerAccess | Save full card list + categories (replace all) |
| `POST` | `/api/decks/:deckId/cards/add` | requirePlayerAccess | Add one card (name, qty, category) |
| `DELETE` | `/api/decks/:deckId/cards/:cardName` | requirePlayerAccess | Remove one card |
| `PATCH` | `/api/decks/:deckId/cards/:cardName` | requirePlayerAccess | Update qty or move to different category |
| `GET` | `/api/decks/:deckId/categories` | requireAuth | Get custom categories for a deck |
| `PUT` | `/api/decks/:deckId/categories` | requirePlayerAccess | Save category list (name + order) |

The PUT endpoints do a full replace (delete all + re-insert in a transaction). The granular POST/DELETE/PATCH are for real-time single-card operations so the UI feels snappy.

---

## EDHREC Integration

### API

EDHREC exposes a public JSON endpoint. **Proxy it server-side** in `routes/proxy.js`:

```
GET /api/edhrec/commander/:name
→ proxies https://json.edhrec.com/pages/commanders/{slug}.json
```

The slug is the commander name lowercased, spaces → hyphens, strip special chars (apostrophes, commas). Example: `Atraxa, Praetors' Voice` → `atraxa-praetors-voice`.

### Response structure

```json
{
  "container": {
    "json_dict": {
      "cardlists": [
        {
          "tag": "newcards",
          "header": "New Cards",
          "cardviews": [
            {
              "name": "Card Name",
              "synergy": 0.27,
              "inclusion": 27529,
              "num_decks": 27529
            }
          ]
        },
        { "tag": "highsynergycards", "header": "High Synergy Cards", ... },
        { "tag": "topcards", "header": "Top Cards", ... },
        { "tag": "gamechangers", "header": "Game Changers", ... },
        { "tag": "creatures", "header": "Creatures", ... },
        { "tag": "instants", "header": "Instants", ... },
        { "tag": "sorceries", "header": "Sorceries", ... },
        { "tag": "enchantments", "header": "Enchantments", ... },
        { "tag": "artifacts", "header": "Artifacts", ... },
        { "tag": "planeswalkers", "header": "Planeswalkers", ... },
        { "tag": "utility-lands", "header": "Utility Lands", ... },
        { "tag": "lands", "header": "Lands", ... },
        { "tag": "mana-artifacts", "header": "Mana Artifacts", ... }
      ],
      "card": {
        "name": "Atraxa, Praetors' Voice",
        "color_identity": ["W","U","B","G"],
        ...
      }
    }
  }
}
```

### What to show

- **Tabs/sections** for: High Synergy, Top Cards, New Cards (these are the most useful)
- Each card shows: name, synergy score (as %), inclusion count, and a **+ Add** button
- Cache the response client-side for the session (don't re-fetch on every tab switch)
- Show a "Powered by EDHREC" attribution link

### Rate limiting

EDHREC doesn't publish rate limits but be respectful. Cache server-side for 30 minutes (similar to RSS caching pattern in `routes/rss.js`). One request per commander lookup.

---

## Card Search Panel

### Scryfall search (repurpose from search.js)

- Text input with Scryfall query syntax
- Auto-prepend colour identity filter: if commander is Atraxa (WUBG), add `ci<=wubg` to every query unless the user explicitly includes a `ci:` or `id:` clause
- Results show: card image (or name in list mode), mana cost, type, price, and a **+ Add** button
- Clicking the card name/image opens the card detail modal (existing behaviour)
- Scryfall autocomplete on the input (same pattern as want list)
- Trigger search on Enter or button click (not on every keystroke — Scryfall rate limits)

### Combined UI

The search/recommendations panel sits on the left (desktop) or above (mobile). Two tabs within it:
- **Search** — Scryfall query box + results
- **Recommendations** — EDHREC data, sectioned by High Synergy / Top Cards / New Cards

---

## Custom Categories

### Default categories

When a deck is created or has no custom categories, start with:
`Commander, Creatures, Instants, Sorceries, Enchantments, Artifacts, Planeswalkers, Lands, Other`

### Auto-categorise

When a card is added without an explicit category:
1. If it's the commander → "Commander"
2. Else, look up its Scryfall type_line and assign: Creature → Creatures, Instant → Instants, etc.
3. Fallback → "Other"

(This is already implemented in `dvGetCategory()` — reuse that logic.)

### User operations

- **Add category**: text input at the bottom of the category list → creates new empty section
- **Rename**: click the category header text to edit it inline (except "Commander" which is locked)
- **Delete**: X button on category header → moves all its cards to "Other" (or to a user-chosen category)
- **Reorder categories**: drag category headers to rearrange (or up/down buttons if drag is too complex)
- **Move cards between categories**: drag a card and drop on a different category header, OR right-click / dropdown menu → "Move to…"

### Persistence

Categories are stored per-deck in the `deck_categories` table. Card-to-category assignment is stored in `deck_cards.category`.

---

## Deck List Panel (right side)

Shows the current deck contents grouped by category.

### Per category
- Collapsible header showing: category name, card count, and action buttons (rename, delete, collapse)
- Cards listed within, each showing: quantity (editable inline or ±), card name (clickable → card modal), mana cost icons, and a remove (×) button
- Sort within each category using the existing sort system (name, cmc, color, type, price — default by name)

### Stats bar (bottom or top)

- **Card count**: `87/99` format (99 for Commander — exclude the commander itself from the count). Turns red if over, green when exactly right
- **Land count**: highlighted, with a warning colour if <33 or >40 for a 100-card deck
- **Average mana value**: excluding lands
- **Mana curve**: tiny inline bar chart (CMC 0–7+), using CSS bars
- **Colour pip distribution**: show WUBRG pip counts as mana icons with numbers

### View modes

Keep the existing list/grid/XL toggle from Deck View. List is default for the builder since it's more compact. Grid/XL show card images.

---

## Import / Export

### Import (extend existing)

- **Archidekt URL** (already works — keep it)
- **CSV upload** (already works — `qty,name` format)
- **Plain text paste**: add a textarea modal where users can paste a deck list in common formats:
  - `1 Sol Ring`
  - `1x Sol Ring`
  - `Sol Ring` (assumes qty 1)
  - Lines starting with `//` or `#` are treated as category headers
- When importing, auto-categorise all cards using Scryfall type data

### Export

- **Copy to clipboard** button — plain text format: `1 Card Name` per line, grouped by category with `// Category Name` headers
- **Download CSV** — `qty,name` columns
- **Download text** — same as clipboard format but as a .txt file download

---

## Tab Replacement

### Rename

- Tab button: change from "Deck View" to "Deck Builder"
- Update `main.js` tab map: `deckview` → keep the id (or rename to `deckbuild` — your choice, but update all references)
- URL hash: `#deckview` (keep for backward compat) or `#deckbuild`

### Deck selection

The tab needs a way to select which deck to edit:
- **Dropdown/selector** at the top listing all decks from the current player (pulled from state.players)
- **"+ New Deck"** button to create a fresh deck (prompts for name + commander)
- **Link from Players & Decks tab**: the existing "Compare" button could get a sibling "Edit" button that opens the deck in the builder
- If no deck is selected, show an empty state with "Select a deck or create a new one"

### Commander input

When creating a new deck or editing the commander:
- Scryfall autocomplete input filtered to legendary creatures (`t:legendary t:creature`)
- On selection: fetch the card from Scryfall, extract `color_identity`, store the commander card data
- Commander's image shown next to the input
- Changing the commander updates the colour identity filter for search but does NOT remove existing cards (user might be switching intentionally)

---

## Mobile Layout

- **Desktop (≥1024px)**: side-by-side — search/recommendations panel (left ~40%) and deck list (right ~60%)
- **Mobile (<1024px)**: stacked — deck list on top (collapsible), search/recommendations below. Or a toggle between "Deck" and "Search" sub-views
- Stats bar always visible at the bottom (sticky)
- Category management (add/rename/delete) via tap and modal instead of inline editing
- Card drag-and-drop replaced with a "Move to…" dropdown on mobile

---

## Build Order

Implement in this order. Each phase should be testable on its own:

### Phase 1: Data layer + basic deck CRUD
1. Add `deck_cards` and `deck_categories` tables to `available-db.js`
2. Create `routes/decks.js` with GET/PUT card list endpoints
3. Mount in `server.js`
4. Add integration tests in `test/server.test.js`

### Phase 2: Basic builder UI
1. Replace `#tab-deckview` HTML in `index.html` with builder layout
2. Rewrite `deckview.js` → deck builder with:
   - Deck selector dropdown
   - Commander input with Scryfall autocomplete
   - Card list grouped by default categories
   - Add card input (Scryfall autocomplete) with + button
   - Remove card (×) button
   - Stats bar (card count, land count)
3. Wire save/load to the new API

### Phase 3: Custom categories
1. Add category CRUD UI (add, rename, delete)
2. Card ↔ category movement (dropdown "Move to…")
3. Category ordering
4. Persist to `deck_categories` table

### Phase 4: Search panel
1. Add Scryfall search sub-panel (lift from search.js, add colour identity filter)
2. Search results with + Add button
3. Desktop split layout (search left, deck right)

### Phase 5: EDHREC integration
1. Add EDHREC proxy route in `routes/proxy.js` with 30-min cache
2. Recommendations sub-panel with High Synergy / Top Cards / New Cards sections
3. + Add button on each recommendation
4. "Powered by EDHREC" attribution

### Phase 6: Import / Export
1. Keep existing Archidekt URL and CSV import
2. Add plain text paste import
3. Add export: copy to clipboard, download CSV, download text

### Phase 7: Polish
1. Mana curve mini-chart
2. Colour pip distribution
3. Drag-and-drop for cards between categories (desktop only)
4. Mobile layout pass
5. Edit button on Players & Decks tab deck tiles

---

## Style Guide

- Follow the existing dark theme. Use CSS variables: `--bg`, `--surface`, `--border`, `--text`, `--muted`, `--accent`, `--danger`
- Card hover glow (existing `.card-hover-glow` class)
- Buttons: `.btn-primary`, `.btn-secondary`, `.btn-outline`
- Panels: `.panel` + `.panel-title`
- Mana icons: `<i class="ms ms-{symbol} ms-cost">` (mana-font)
- Sort controls: reuse `mountSortControl()` from sortui.js
- Keep it consistent with the rest of the app. Look at existing tabs for patterns

---

## Constraints

- **No new npm packages** unless genuinely required (drag-and-drop can be done with native HTML5 drag API)
- **No build step** — vanilla JS, loaded via `<script>` tags
- **Scryfall rate limit**: max 10 requests/sec, use batch endpoints, 100ms delay between batches
- **EDHREC**: cache aggressively, one request per commander, attribute them
- **Auth**: all write endpoints require authentication. Players can only edit their own decks
- **Backward compatibility**: existing Deck View functionality (loading from Archidekt URL/CSV and viewing) must still work within the new builder — it's now just one way to populate the deck
