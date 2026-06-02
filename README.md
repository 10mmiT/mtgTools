# MTG Tools

Search across multiple Magic: The Gathering collections at once, compare deck lists against what you own, browse sets, track want lists, coordinate group availability, and randomly pick decks for game night — all from a single self-hosted web app.

## Features

### Available@ tab
- Shared group availability calendar — mark which days you're free
- Enter your name once; it's remembered in the browser
- Click any future day to toggle your availability
- "Best upcoming days" panel ranks days by how many people are free
- On mobile, the calendar switches to a compact week-list (Mon–Sun) with prev/next week navigation
- All availability data persists across restarts

### Collections tab
- Add collections from Archidekt (URL or CSV export) or Moxfield (CSV export only — Moxfield's API blocks automated access)
- Results table shows card name, a column per collection, and a total; sortable by any column; scrolls horizontally when many collections are loaded
- Grid view shows full card images with per-collection ownership badges
- On mobile, defaults to grid view; list view is still available and scrolls horizontally
- Hover over any card name (list view) for a Scryfall image tooltip
- Click a card name to open it on Scryfall
- Collapsible "Add Collection" and "Collections" panels to save space
- On mobile, the results table is capped at 150 rows with a "Show all" button so the Deck Comparison panel is always within reach
- Right-side **Deck Comparison** panel: load a deck and see which cards you own, with a toggle to filter the table to deck cards only

### Players & Decks tab
- Add players by name; each gets a unique colour
- Add decks to players — enter a deck name and commander name; the commander's card art (fetched from Scryfall) becomes the tile background
- Optionally link an Archidekt URL to load the full card list for comparison
- Any URL can be saved as a "View ↗" link on the tile
- Edit any deck in-place (name, commander, link)
- **Compare** button sends a deck to the Deck Comparison panel and switches to the Collections tab automatically
- **View** button (Archidekt decks) opens the deck directly in the Deck View tab
- All deck metadata and commander art URLs persist across restarts

### Scryfall Search tab
- Full Scryfall query syntax: `t:legendary t:creature`, `c:g cmc=3`, `"exact name"`, etc.
- Results show which collections own each card and in what quantity, plus Cardmarket price (EUR)
- Quick **+** button on each card to add it to your personal want list in one click
- **List**, **Grid**, and **XL** view toggle — XL uses larger card images
- Mana costs rendered as proper MTG mana icons
- Search on Enter or button click — no auto-search while typing to stay within Scryfall's rate limits

### Set Browser tab
- Browse every non-digital MTG set (expansions, Commander, Masters, etc.)
- Filter sets by name or code
- Click a set to load all its cards with collection ownership and Cardmarket price shown inline
- Filter to only owned or only unowned cards
- Shows how many cards from the set are owned across all collections
- **List**, **Grid**, and **XL** view toggle

### Want Lists tab
- Per-player want lists with Scryfall autocomplete as you type
- Import want lists from CSV (qty,name or name-only format)
- **List view**: combined table across all players — who wants each card, Cardmarket price, and whether anyone already owns it; cards wanted by multiple players sort to the top
- **Grid / XL views**: card images with Cardmarket price, coloured player-initial dots (tap your own dot to remove), and ownership badges
- Remove individual wants from the table view with one click
- All want lists persist across restarts

### Deck View tab
- Load a deck from an Archidekt URL or a CSV file (qty, name format)
- Cards grouped by type: Commander, Creatures, Planeswalkers, Instants, Sorceries, Enchantments, Artifacts, Battles, Lands, Other
- Clickable summary strip at the top — click a category to jump to that section
- **List** view: compact rows with mana icons, type line, Cardmarket price, and ownership
- **Grid** view: card images with price and ownership badges
- **XL** view: larger card images with mana, type, price, and ownership
- Supports double-faced cards (DFCs) in all views
- **Load for Comparison** button sends the deck to the Collections tab comparison panel

### Mana Base Calculator tab
- Choose a deck size preset — 40 (Limited), 60 (Constructed), 100 (Commander) — or enter a custom size
- Enter the count of each colored mana pip (W/U/B/R/G) and colorless (C/Wastes) across your non-land cards; colour icons use proper mana-font symbols
- Enter how many non-basic lands (duals, fetches, other) you're already including
- Instantly shows: total lands recommended, non-basics you entered, and how many basics to add
- Distributes basic lands proportionally by pip count using the largest-remainder method so the numbers always add up exactly

### Pick Night tab
- Select 2–6 players from the Players & Decks list for tonight's game
- Toggle **Exclude own decks** so players won't be assigned one of their own decks
- **Deck Pool** panel: view all decks grouped by player and click individual decks to exclude them from the draw
- Click **Pick Decks** to randomly assign one unique deck per player; up to 200 shuffle attempts ensure the constraints are always satisfied
- Results shown as player-labelled commander-art tiles
- **↺ Re-roll** per player (locks everyone else's pick) or **↺ Re-roll all** to start fresh

### RSS Feed panel
- Click the **RSS** button in the header to open a right-side feed panel
- Configure feeds by setting `RSS_FEEDS` in `docker-compose.yml` — comma-separated RSS 2.0 or Atom URLs
- All feeds are merged and sorted newest-first; each item is tagged with its source feed name
- Feed data is fetched server-side and cached for 10 minutes; supports HTTP redirects

### General
- Dark theme by default, toggleable to light; preference saved in the browser
- Mana symbols rendered as proper MTG icons throughout (mana-font)
- Collapsible panels throughout (Add Collection, Collections, each player section)
- Per-user login system with player-linked accounts and an admin role
- **Desktop navigation**: tabs live in a collapsible left sidebar that overlays the content; click Collapse to shrink to icon-only mode — state persists across reloads
- **Mobile-friendly**: sidebar hidden on mobile, replaced by a compact dropdown; all forms stack to full-width; view toggles are right-aligned across all tabs

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
| Data path (inside container) | `/app/data` |
| `ADMIN_PASSWORD` | Required to enable auth; omit for open mode |
| `RSS_FEEDS` | Optional comma-separated RSS/Atom feed URLs for the header panel |

Map `/app/data` to a persistent location on your host (e.g. `/mnt/user/appdata/mtgtools` on Unraid) so all data survives container restarts. All data — collections, players, decks, want lists, availability, and user accounts — is stored in `available.db` (SQLite). Set `ADMIN_PASSWORD` as an environment variable directly in your container manager if you're not using `docker compose`.

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
├── server.js          # Express server — API routes, available@ calendar, auth
├── available-db.js    # SQLite setup (all persistent data)
├── public/
│   ├── index.html     # Single-page app shell
│   ├── login.html     # Password login page
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── state.js       # App state, storage, shared helpers (renderMana, renderPrice, …)
│       ├── collections.js # Collection CRUD and results rendering
│       ├── players.js     # Players and decks
│       ├── search.js      # Scryfall search tab
│       ├── sets.js        # Set browser tab
│       ├── wants.js       # Want lists tab (list/grid/XL views)
│       ├── available.js   # Available@ calendar tab
│       ├── lands.js       # Mana base calculator tab
│       ├── auth.js        # Session auth, quick-add wants, change password
│       ├── admin.js       # Admin panel (user management, account requests)
│       ├── deckview.js    # Deck View tab (Archidekt/CSV loader, categorised view)
│       ├── pick.js        # Pick Night tab (random deck assignment)
│       ├── rss.js         # RSS feed panel (header toggle, fetch, render)
│       ├── scryfall.js    # Scryfall image cache helpers
│       └── main.js        # Init, theme, tabs, sidebar nav, mobile nav, tooltips, state polling
├── Dockerfile
├── docker-compose.yml
└── data/              # Created at runtime inside the container (Docker volume)
    └── available.db   # All persistent data: collections, players, decks,
                       # want lists, availability calendar, user accounts (SQLite)
```

## Tech Stack & Credits

| Component | Credit |
|-----------|--------|
| **[Express](https://expressjs.com/)** | Server framework — MIT licence |
| **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** | SQLite for all persistent data — MIT licence |
| **[Scryfall API](https://scryfall.com/docs/api)** | Card data, images, search, autocomplete, and prices. Free to use; please follow their [rate limit guidelines](https://scryfall.com/docs/api#rate-limits). Scryfall search is triggered manually (Enter / button) rather than on every keystroke. |
| **[mana-font](https://github.com/andrewgioia/mana)** | MTG mana symbol icons — MIT licence |
| **[Archidekt](https://archidekt.com)** | Collection and deck data via their public REST API |
| **[Moxfield](https://moxfield.com)** | Collection data via CSV export |
| **[Docker](https://www.docker.com/)** | Containerisation |

Cardmarket prices are sourced from Scryfall's `prices.eur` field and reflect Cardmarket marketplace data at the time of the Scryfall API response.

Card images and search data are provided by Scryfall. Scryfall is not produced by or endorsed by Wizards of the Coast.

Magic: The Gathering is © Wizards of the Coast LLC.
