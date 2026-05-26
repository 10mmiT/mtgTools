# MTG Collection Search

Search across multiple Magic: The Gathering collections at once, compare deck lists against what you own, browse sets, track want lists, and coordinate group availability — all from a single self-hosted web app.

## Features

### Available@ tab
- Shared group availability calendar — mark which days you're free
- Enter your name once; it's remembered in the browser
- Click any future day to toggle your availability
- "Best upcoming days" panel ranks days by how many people are free
- All availability data persists across restarts

### Collections tab
- Add collections from Archidekt (URL or CSV export) or Moxfield (CSV export only — Moxfield's API blocks automated access)
- Results table shows card name, a column per collection, and a total; sortable by any column
- Grid view shows full card images with per-collection ownership badges
- Hover over any card name (list view) for a Scryfall image tooltip
- Click a card name to open it on Scryfall
- Collapsible "Add Collection" and "Collections" panels to save space
- Right-side **Deck Comparison** panel: load a deck and see which cards you own, with a toggle to filter the table to deck cards only

### Players & Decks tab
- Add players by name; each gets a unique colour
- Add decks to players — enter a deck name and commander name; the commander's card art (fetched from Scryfall) becomes the tile background
- Optionally link an Archidekt URL to load the full card list for comparison
- Any URL (Moxfield, TappedOut, etc.) can be saved as a "View ↗" link on the tile
- Edit any deck in-place (name, commander, link)
- Click **Load for comparison** to send a deck to the Deck Comparison panel and switch to the Collections tab automatically
- All deck metadata and commander art URLs persist across restarts

### Scryfall Search tab
- Full Scryfall query syntax: `t:legendary t:creature`, `c:g cmc=3`, `"exact name"`, etc.
- Results show which of your collections own each card and in what quantity
- Small (list) or large (grid) view toggle
- Search on Enter or button click — no auto-search while typing to stay within Scryfall's rate limits

### Set Browser tab
- Browse every non-digital MTG set (expansions, Commander, Masters, etc.)
- Filter sets by name or code
- Click a set to load all its cards with collection ownership shown inline
- "Only show owned cards" / "Only show unowned cards" filters
- Shows how many cards from the set are owned across all collections
- List and grid view toggle

### Want Lists tab
- Per-player want lists with Scryfall autocomplete as you type
- Combined table across all players: see who wants each card and whether anyone in the group already owns it
- Cards wanted by multiple players sort to the top
- Remove individual wants with one click
- All want lists persist across restarts

### Deck View tab
- Load a deck from an Archidekt URL or a CSV file (qty, name format)
- Cards grouped by type: Commander, Creatures, Planeswalkers, Instants, Sorceries, Enchantments, Artifacts, Battles, Lands, Other
- Clickable summary strip at the top — click a category to jump to that section
- List view (compact rows with mana cost, type, and ownership) or grid view (card images)
- **Load for Comparison** button sends the deck to the Collections tab comparison panel

### Mana Base Calculator tab
- Choose a deck size preset — 40 (Limited), 60 (Constructed), 100 (Commander) — or enter a custom size
- Enter the count of each colored mana pip (W/U/B/R/G) and colorless (C/Wastes) across your non-land cards
- Enter how many non-basic lands (duals, fetches, other) you're already including
- Instantly shows: total lands recommended, non-basics you entered, and how many basics to add
- Distributes basic lands proportionally by pip count using the largest-remainder method so the numbers always add up exactly
- Colors with no pips are hidden from the results

### General
- Dark theme by default, toggleable to light; preference saved in the browser
- Collapsible panels throughout (Add Collection, Collections, each player section)
- Per-user login system with player-linked accounts and an admin role

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### Run

```bash
docker compose up --build
```

Then open [http://localhost:3000](http://localhost:3000).

Data is stored in a Docker volume (`mtgsearch-data`) and persists across restarts and rebuilds.

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
| Environment variable | `ADMIN_PASSWORD` |

Map `/app/data` to a persistent location on your host (e.g. `/mnt/user/appdata/mtgtools` on Unraid) so all data survives container restarts. Collections are stored in `available.db` (SQLite); players, decks, and want lists are stored in `state.json`. Set `ADMIN_PASSWORD` as an environment variable directly in your container manager if you're not using `docker compose`.

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
mtgsearch/
├── server.js          # Express server — API routes, available@ calendar, auth
├── available-db.js    # SQLite setup for the availability calendar
├── public/
│   ├── index.html     # Single-page app shell
│   ├── login.html     # Password login page
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── state.js       # App state, storage, helpers
│       ├── collections.js # Collection CRUD and results rendering
│       ├── players.js     # Players and decks
│       ├── search.js      # Scryfall search tab
│       ├── sets.js        # Set browser tab
│       ├── wants.js       # Want lists tab
│       ├── available.js   # Available@ calendar tab
│       ├── lands.js       # Mana base calculator tab
│       ├── auth.js        # Session auth state, change password
│       ├── admin.js       # Admin panel (user management, account requests)
│       ├── deckview.js    # Deck View tab (Archidekt/CSV loader, categorised view)
│       ├── scryfall.js    # Scryfall image cache helpers
│       └── main.js        # Init, theme, tabs, tooltips, state polling
├── Dockerfile
├── docker-compose.yml
└── data/              # Created at runtime inside the container (Docker volume)
    ├── state.json     # Players, decks, want lists
    └── available.db   # Collections, availability calendar, user accounts (SQLite)
```

## Tech Stack & Credits

| Component | Credit |
|-----------|--------|
| **[Express](https://expressjs.com/)** | Server framework — MIT licence |
| **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** | SQLite for the availability calendar — MIT licence |
| **[Scryfall API](https://scryfall.com/docs/api)** | Card data, images, search, and autocomplete. Free to use; please follow their [rate limit guidelines](https://scryfall.com/docs/api#rate-limits). Scryfall search is triggered manually (Enter / button) rather than on every keystroke. |
| **[Archidekt](https://archidekt.com)** | Collection and deck data via their public REST API |
| **[Moxfield](https://moxfield.com)** | Collection data via CSV export |
| **[Docker](https://www.docker.com/)** | Containerisation |

Card images and search data are provided by Scryfall. Scryfall is not produced by or endorsed by Wizards of the Coast.

Magic: The Gathering is © Wizards of the Coast LLC.

