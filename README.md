# MTG Tools

> [!NOTE]
> This app was built almost entirely with AI (Claude), by someone who doesn't code, mostly for personal use by my own playgroup. It works well for us, but expect rough edges — use at your own risk, and feel free to open an issue if something breaks.

Search across multiple Magic: The Gathering collections at once, compare deck lists against what you own, browse sets, inspect full card details, track want lists, coordinate group availability, and randomly pick decks for game night — all from a single self-hosted web app.

## Features

### Available@ tab
- Shared group availability calendar — mark which days you're free
- Logged-in players are identified automatically via their linked player — no name entry needed. The "Who are you?" bar only appears for admins and in open (no-login) mode, where it's remembered in the browser
- Click any future day to toggle your availability
- "Best upcoming days" panel ranks days by how many people are free
- On mobile, the calendar switches to a compact week-list (Mon–Sun) with prev/next week navigation
- All availability data persists across restarts

### Collections tab
- Add collections from Archidekt (URL or CSV export) or Moxfield (CSV export only — Moxfield's API blocks automated access)
- Results table shows card name, a column per collection, and a total; scrolls horizontally when many collections are loaded
- **Sort** by name, mana value, color (WUBRG order), power, toughness, rarity, type, price, or quantity owned — via the Sort control or by clicking any column header
- **Columns menu** to show/hide optional columns: Mana Value, Color (as mana pips), Type, Rarity, Power/Toughness, Price (off by default to keep the table clean)
- Grid view shows full card images with per-collection ownership badges
- On mobile, defaults to grid view; list view is still available and scrolls horizontally
- Hover over any card name (list view) for a Scryfall image tooltip
- Click any card name or image to open it in the **Card** tab (Ctrl/Cmd-click opens it on Scryfall instead)
- Collapsible "Add Collection" and "Collections" panels to save space; once you have at least one collection, the add panel auto-collapses (your manual toggle is remembered)
- Per-collection actions (Refresh / Re-import CSV / Remove) live in a "⋯" menu on each collection row
- On mobile, the results table is capped at 150 rows with a "Show all" button so the Deck Comparison panel is always within reach
- Right-side **Deck Comparison** panel: load a deck and see which cards you own, with a toggle to filter the table to deck cards only

### Players & Decks tab
- Add players via the **+ Add Player** button (admin only); each gets a unique colour
- Add decks to players — enter a deck name and commander name; the commander's card art (fetched from Scryfall) becomes the tile background
- Optionally link an Archidekt URL to load the full card list for comparison
- Any URL can be saved as a "View ↗" link on the tile
- Each deck tile shows two primary actions — **Compare** (sends the deck to the Collections tab comparison panel) and **Build** (opens it in the Deck Builder) — with Edit and Remove tucked into a per-tile "⋯" menu; removing a deck asks for confirmation
- Removing a player lives in a "⋯" menu on the player header (admin only)
- Edit any deck in-place (name, commander, link)
- All deck metadata and commander art URLs persist across restarts

### Scryfall Search tab
- Full Scryfall query syntax: `t:legendary t:creature`, `c:g cmc=3`, `"exact name"`, etc.
- Results show which collections own each card and in what quantity, plus Cardmarket price (EUR)
- Quick **+** button on each card to add it to your personal want list in one click
- **Sort** results by name, mana value, color, power, toughness, rarity, type, or price
- **List**, **Grid**, and **XL** view toggle — XL uses larger card images
- Mana costs rendered as proper MTG mana icons
- Click any card name or image to open it in the **Card** tab (Ctrl/Cmd-click opens Scryfall)
- Search on Enter or button click — no auto-search while typing to stay within Scryfall's rate limits

### Card tab
- Detailed view for a single card — on **desktop (≥1024px)** clicking any card name or image opens a dimmed **modal overlay** on the current tab (close with **✕**, **Esc**, or click outside); on **mobile** it switches to the full-page Card tab (the Card tab entry is hidden in the desktop sidebar since it's only reachable via mobile)
- Shows the full card image (both faces for double-faced cards) with oracle text rendered using proper mana symbols
- Card info: mana cost, type line, power/toughness/loyalty, set · collector number · rarity · artist
- Cardmarket (EUR) and USD prices
- Format legality badges (Standard, Pioneer, Modern, Legacy, Vintage, Commander, Pauper)
- Official **rulings** for the card, pulled from Scryfall
- Links to view the card on **Scryfall** or buy it on **Cardmarket**
- **Other Printings & Alt-Art gallery** at the bottom — every printing of the card; click any one to load that specific version
- Ctrl/Cmd-clicking a card anywhere still opens it on Scryfall in a new tab

### Set Browser tab
- Browse every non-digital MTG set (expansions, Commander, Masters, etc.)
- Filter sets by name or code
- Click a set to load all its cards with collection ownership and Cardmarket price shown inline
- Ownership dropdown to show all cards, only owned, or only unowned
- Shows how many cards from the set are owned across all collections
- **Sort** by set collector number (default), name, mana value, color, power, toughness, rarity, type, or price
- **List**, **Grid**, and **XL** view toggle
- Click any card name or image to open it in the **Card** tab (Ctrl/Cmd-click opens Scryfall)

### Want Lists tab
- Per-player want lists with card-name autocomplete as you type (served from the local card database)
- Admins can create a new player straight from the player dropdown ("+ New player…")
- Import (CSV: qty,name or name-only) and Export (CSV / printable PDF checklist) share one "⋯" menu in the toolbar
- **List view**: combined table across all players — who wants each card, Cardmarket price, and whether anyone already owns it
- **Player filter**: chip row (All / per-player) above the results to narrow down to a single player's list; defaults to showing everyone
- **Sort** by most-wanted (default), player (groups cards by which player(s) want them), name, mana value, color, power, toughness, rarity, type, or price
- **Columns menu** to show/hide optional columns: Mana Value, Color, Type, Rarity, Power/Toughness, Price, In Collections
- **Grid / XL views**: card images with Cardmarket price, coloured player-initial dots (tap your own dot to remove), and ownership badges
- Click any card name or image to open it in the **Card** tab (Ctrl/Cmd-click opens Scryfall)
- Remove individual wants from the table view with one click
- All want lists persist across restarts

### Deck Builder tab
- Full-width editing workspace for a single deck — select an existing deck or **+ New Deck** (player, name, optional commander)
- **More ▾** menu (Deck / Import / Export sections) consolidates Categories, Compare, Import CSV, Paste List, Export (clipboard/CSV/.txt), and Delete Deck, keeping the toolbar itself to just "+ New Deck" and "Search / EDHREC"
- **Delete Deck** removes the deck and its saved cards/categories entirely, so you can re-add it (e.g. re-import the same Archidekt URL from the Players & Decks tab) with a clean slate
- Cards grouped into categories — Commander, Creatures, Planeswalkers, Instants, Sorceries, Enchantments, Artifacts, Battles, Lands, Other by default — with custom categories, rename, and delete via each category's "⋯" menu, or all at once from the **Manage Categories** modal; deleting a category with cards in it moves them to "Uncategorised" instead of losing the grouping
- **Search name or oracle text** box filters the visible cards across every category live as you type
- **Multiselect**: click/tap a card (List/Grid/XL/Pile) to select it, Ctrl/Cmd-A to select all visible, or "Select all" from a category's "⋯" menu — selected cards get a **Move to…** bulk action. A dedicated "ⓘ" button (top-left on tiles, first column in list view) opens the card info popup instead of selecting; on touch devices, a long-press does the same
- **Move to…** (single card or bulk) can also **✨ Auto-categorize** — sorts staples into functional categories the way Archidekt's community auto-categories do (Sol Ring → Ramp, Swords to Plowshares → Removal, etc.), falling back to card type — or create a brand-new category and move into it in one step
- **Drag and drop** a card anywhere onto a category's column (not just its header) to move it there; auto-saves
- **Sort** cards within each category by name (default), mana value, color, power, toughness, rarity, type, or price
- **List**, **Grid**, **XL**, and **Pile** view, with a size slider for Grid/XL/Pile
- Quick **Add a card** box with card-name autocomplete (served from the local card database); **Import CSV** or **Paste List** (`1 Sol Ring` / `1x Sol Ring` / `// Category` lines) for bulk add
- **Search / EDHREC** drawer panel:
  - **Search** tab — Scryfall query search (with an optional commander color-identity filter) to find and add cards, each shown with a thumbnail
  - **EDHREC** tab — recommendations for the deck's commander, split into the same type-based categories as Archidekt (Creatures, Planeswalkers, Instants, Sorceries, Enchantments, Artifacts, Lands) plus High Synergy, Top Cards, Game Changers, and New Cards, each card shown with a thumbnail, type line, synergy %, and deck-inclusion count
- Stats bar: card/land counts vs. format target (60 or 99 for Commander), average CMC, color pip counts, and a mana curve
- **Compare** button (in the More menu) sends the deck to the Collections tab comparison panel

### Mana Base Calculator tab
- Choose a deck size preset — 40 (Limited), 60 (Constructed), 100 (Commander) — or enter a custom size
- Enter the count of each colored mana pip (W/U/B/R/G) and colorless (C/Wastes) across your non-land cards; colour icons use proper mana-font symbols
- Enter how many non-basic lands (duals, fetches, other) you're already including
- Instantly shows: total lands recommended, non-basics you entered, and how many basics to add
- Distributes basic lands proportionally by pip count using the largest-remainder method so the numbers always add up exactly

### Pick Night tab
- Select 2–6 players from the Players & Decks list for tonight's game
- **Deck Pool** panel: the pool is opt-in — no decks are selected by default. Click individual decks to add them to the draw, or click a player's name to toggle all of their decks at once
- **Exclude own decks** (in the options "⋯" menu) so players won't be assigned one of their own decks
- Click **Pick Decks** to randomly assign one unique deck per player; up to 200 shuffle attempts ensure the constraints are always satisfied
- Results shown as player-labelled commander-art tiles
- **↺ Re-roll** per player (locks everyone else's pick) or **↺ Re-roll all** to start fresh

### RSS Feed panel
- On desktop, click **RSS Feeds** at the bottom of the left sidebar; on mobile it's in the header/nav dropdown — both open the same right-side feed panel
- Configure feeds by setting `RSS_FEEDS` in `docker-compose.yml` — comma-separated RSS 2.0 or Atom URLs
- All feeds are merged and sorted newest-first; each item is tagged with its source feed name
- Feed data is fetched server-side and cached for 10 minutes; supports HTTP redirects

### General
- **5 themes** — Dark, Light, High Contrast, Sepia, and Forest. Desktop picks via a dropdown in the sidebar (with a checkmark on the active theme); mobile cycles through them with a single tap. Preference saved in the browser
- **MTG colour theming**: each tab carries its own mana-colour accent (WUBRG + gold) on the active nav item, panel headings, focus rings, and card hover glows — independent of the 5 UI themes above, since mana symbol colours represent the game, not the chrome
- Mana symbols rendered as proper MTG icons throughout (mana-font)
- **Minimal-UI conventions across all tabs**: one shared List/Grid/XL(/Pile) view toggle component, shared Sort and Columns controls, and "⋯" overflow menus for secondary/destructive actions (collection rows, deck tiles, player headers, want-list import/export, Pick Night options) — the common path stays visible, everything else is one click away
- **Sorting & column visibility** on every card view (Collections, Scryfall Search, Card, Set Browser, Want Lists, Deck Builder); your sort field/direction and which columns are shown persist per-view in the browser
- **Scryfall traffic is centralised and cached**: the server keeps a daily copy of Scryfall's bulk card data in SQLite and serves card images/metadata/autocomplete locally; the few remaining live calls (full-text search, card detail, set browsing) go through a server-side proxy with a shared rate-limit queue and a 10-minute response cache — the browser never talks to api.scryfall.com directly
- Click any card (name or image) to open the card detail — a **modal overlay on desktop (≥1024px)** or the **Card tab on mobile**; Ctrl/Cmd-click opens Scryfall instead
- **URL hash routing**: tab switches and card views update the URL (`#collections`, `#card=...`); browser **back/forward** buttons navigate between views; refresh restores your current view
- Collapsible panels throughout (Add Collection, Collections, each player section, Deck Pool, Admin's Create User) — rarely-used forms start collapsed and remember your toggle
- Per-user login system with player-linked accounts and an admin role
- **Desktop navigation**: tabs live in a collapsible left sidebar that overlays the content, with account actions (user badge, theme picker, RSS, change password, sign out) anchored to the bottom; click Collapse to shrink to icon-only mode — state persists across reloads. There's no top header on desktop — it's mobile-only
- **Mobile-friendly**: sidebar hidden on mobile, replaced by a compact dropdown plus a slim header (logo + RSS); all forms stack to full-width; inputs use a 16px font to avoid iOS zoom-on-focus; view toggles are right-aligned across all tabs

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### Run

```bash
docker compose up --build
```

Then open [http://localhost:3000](http://localhost:3000).

Data is stored in a Docker volume (`mtgtools-data`) and persists across restarts and rebuilds.

### User accounts

The app uses per-player user accounts with two roles: **player** and **admin**.

Set `ADMIN_PASSWORD` to enable auth. The `admin` account is created (or updated) automatically from this value on every startup.

Copy `.env.example` to `.env` and set your password:

```bash
cp .env.example .env
# then edit .env:
ADMIN_PASSWORD=yourpassword
```

The `docker-compose.yml` reads from `.env` automatically. Never commit `.env` — it is listed in `.gitignore`.

Without `ADMIN_PASSWORD` the app runs in **open mode** — no login required, everyone has full access (same as the old single-password behaviour).

**First-time setup:**
1. Create `.env` with `ADMIN_PASSWORD` set and start the container.
2. Sign in at `/login` as `admin` with that password.
3. Go to the **Admin** tab.
4. Create an account for each player (username + password + role = Player).
5. Link each account to the matching entry in the Players & Decks tab using the "Linked Player" dropdown — this is what drives access control.

**What each role can do:**

| Action | Player | Admin |
|--------|--------|-------|
| View everything | ✓ | ✓ |
| Add/remove from own want list | ✓ | ✓ |
| Edit other players' want lists | — | ✓ |
| Toggle own availability | ✓ | ✓ |
| Toggle others' availability | — | ✓ |
| Manage collections & decks | ✓ (own) | ✓ |
| Admin panel / user management | — | ✓ |

### Container reference

| Setting | Value |
|---------|-------|
| Container port | `3000` |
| Health check | `GET /healthz` → `{ ok: true, uptime: … }` (also wired into the Dockerfile `HEALTHCHECK`) |
| Data path (inside container) | `/app/data` |
| `ADMIN_PASSWORD` | Required to enable auth; omit for open mode |
| `RSS_FEEDS` | Optional comma-separated RSS/Atom feed URLs for the RSS panel |
| `COOKIE_SECURE` | Set to `1` to add the `Secure` flag to session cookies — recommended when running behind HTTPS |
| `AUTH_RATE_LIMIT_MAX` | Override the login rate-limit window max (default: 30 requests per 15 min per IP) |

Map `/app/data` to a persistent location on your host (e.g. `/mnt/user/appdata/mtgtools` on Unraid) so all data survives container restarts. All app data — collections, players, decks, want lists, availability, and user accounts — is stored in `available.db` (SQLite). A second database, `scryfall.db`, holds the local Scryfall bulk-data cache: on first startup the server downloads Scryfall's `oracle_cards` file (~150 MB, ~35k cards) in the background and refreshes it daily — watch for `[scryfall-db] imported … cards` in the log. The app works during/without the download; card lookups just fall back to live (proxied) Scryfall until it completes. Set `ADMIN_PASSWORD` as an environment variable directly in your container manager if you're not using `docker compose`.

### Stop

```bash
docker compose down
```

## Adding Collections

| Source | Method | Notes |
|--------|--------|-------|
| Archidekt | Paste collection URL | `archidekt.com/collection/v2/…` |
| Archidekt | Import CSV | Collection → Export → CSV |
| Moxfield | Import CSV | Collection → Download (CSV) |

Moxfield collection URLs are not supported — their API is behind Cloudflare bot protection with no public access.

## Adding Decks (Players & Decks tab)

1. Add a player by name.
2. Click **+ Add Deck** and fill in:
   - **Deck name** (required)
   - **Commander name** — looked up on Scryfall for the tile background art
   - **Link** (optional) — any URL becomes the "View ↗" button; an Archidekt URL also loads the full card list for comparison

## Project Structure

```
mtgtools/
├── server.js          # Express entry point — wires up middleware, routes, and /healthz
├── available-db.js    # SQLite setup (all persistent app data)
├── scryfall-db.js     # Scryfall bulk-data cache — daily oracle_cards download into SQLite
├── middleware/
│   └── auth.js        # Session auth helpers (requireAuth, requireAdmin)
├── routes/
│   ├── admin.js       # Admin panel API — user management, account requests
│   ├── auth.js        # Auth API — login, logout, account request, change password
│   ├── available.js   # Availability calendar API
│   ├── cards.js       # Local card endpoints — /api/cards/collection + /api/cards/autocomplete (from scryfall-db)
│   ├── scryfall-proxy.js # Live Scryfall proxy — shared rate-limit queue, Retry-After handling, 10-min GET cache
│   ├── proxy.js       # Archidekt/Moxfield collection + deck proxy, EDHREC proxy
│   ├── rss.js         # RSS feed proxy + 10-minute server-side cache
│   └── state.js       # App state API — collections, players, decks, want lists
├── test/
│   └── server.test.js # Integration tests (node:test + supertest)
├── public/
│   ├── index.html     # Single-page app shell
│   ├── login.html     # Password login page
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── state.js       # App state, storage, shared helpers (renderMana, renderPrice, …)
│       ├── sortui.js      # Shared UI components: sort control, columns menu, view toggle, "⋯" kebab menus
│       ├── scryfall.js    # Card data access: local-first lookups w/ live fallback, rate-limited proxy fetch, caches
│       ├── card.js        # Card Detail tab (oracle text, rulings, prices, alt-art printings)
│       ├── collections.js # Collection CRUD and results rendering
│       ├── players.js     # Players and decks
│       ├── search.js      # Scryfall search tab
│       ├── sets.js        # Set browser tab
│       ├── wants.js       # Want lists tab (list/grid/XL views)
│       ├── available.js   # Available@ calendar tab
│       ├── lands.js       # Mana base calculator tab
│       ├── auth.js        # Session auth, quick-add wants, change password
│       ├── admin.js       # Admin panel (user management, account requests)
│       ├── deckview-core.js    # Deck Builder: state, init, deck selection, Archidekt import, auto-categorize
│       ├── deckview-render.js   # Deck Builder: rendering, tiles/rows, multiselect, stats, view toggle
│       ├── deckview-edit.js     # Deck Builder: card/category edits, move modal, autosave
│       ├── deckview-panels.js   # Deck Builder: search/autocomplete, drag/drop, EDHREC, import/export
│       ├── pick.js        # Pick Night tab (random deck assignment)
│       ├── rss.js         # RSS feed panel (sidebar/header toggle, fetch, render)
│       └── main.js        # Init, theme, tabs, sidebar nav, mobile nav, tooltips, card-click routing, state polling
├── Dockerfile
├── docker-compose.yml
└── data/              # Created at runtime inside the container (Docker volume)
    ├── available.db   # All persistent app data: collections, players, decks,
    │                  # want lists, availability calendar, user accounts (SQLite)
    └── scryfall.db    # Local Scryfall bulk-data cache (~35k cards, refreshed daily)
```

## Testing

The project ships an integration test suite using Node's built-in `node:test` runner and `supertest`.

```bash
npm test
```

Tests spin up an isolated in-memory SQLite database and a temporary state file so they never touch production data. The suite covers auth, state, and admin API routes.

## Tech Stack & Credits

| Component | Credit |
|-----------|--------|
| **[Express](https://expressjs.com/)** | Server framework — MIT licence |
| **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** | SQLite for all persistent data — MIT licence |
| **[Scryfall API](https://scryfall.com/docs/api)** | Card data, images, search, autocomplete, prices, rulings, and printings (alt-art). Free to use; please follow their [rate limit guidelines](https://scryfall.com/docs/api#rate-limits). Per their guidance, card data is served from a daily [bulk-data](https://scryfall.com/docs/api/bulk-data) download cached in SQLite; the remaining live calls (search, card detail, sets) go through a single server-side proxy queue that stays under 10 req/s and honors `Retry-After`. Scryfall search is triggered manually (Enter / button) rather than on every keystroke. |
| **[mana-font](https://github.com/andrewgioia/mana)** | MTG mana symbol icons — MIT licence |
| **[Archidekt](https://archidekt.com)** | Collection and deck data via their public REST API |
| **[Moxfield](https://moxfield.com)** | Collection data via CSV export |
| **[Docker](https://www.docker.com/)** | Containerisation |

Cardmarket prices are sourced from Scryfall's `prices.eur` field and reflect Cardmarket marketplace data at the time of the Scryfall API response.

Card images and search data are provided by Scryfall. Scryfall is not produced by or endorsed by Wizards of the Coast.

Magic: The Gathering is © Wizards of the Coast LLC.
