# MTG Tools

> [!NOTE]
> This app was built almost entirely with AI (Claude), by someone who doesn't code, mostly for personal use by my own playgroup. It works well for us, but expect rough edges — use at your own risk, and feel free to open an issue if something breaks.

Search across multiple Magic: The Gathering collections at once, compare deck lists against what you own, browse sets, inspect full card details, track want lists, coordinate group availability, and randomly pick decks for game night — all from a single self-hosted web app.

## Features

### Available@ tab
- Shared group availability calendar — mark which days you're free
- Logged-in players are identified automatically via their linked player — no name entry needed. The "Who are you?" bar is a toolbar item at the top of the tab, and only appears for admins and in open (no-login) mode, where it's remembered in the browser
- Click any future day to toggle your availability
- Each name on the calendar is drawn in that player's own identity colour — the same one their chip wears on Players, Want Lists and Pick Night (a name with no player record, which open mode allows, gets a stable colour of its own)
- "Best upcoming days" column ranks days by how many people are free
- On mobile, the calendar switches to a compact week-list (Mon–Sun) with prev/next week navigation
- All availability data persists across restarts

### Collections tab
- Add collections from Archidekt (URL or CSV export) or Moxfield (CSV export only — Moxfield's API blocks automated access)
- Results table shows card name, a column per collection, and a total; scrolls horizontally when many collections are loaded
- **A collection has an owner** — chosen when it is added, changed later from its `⋯` menu — and it may have none: a shared box belongs to the group, so it counts as the group's and never as any one person's. The **Shelf** control switches the tab between *everyone's* collections and *your own*, and remembers which. Chips for collections that are loaded but off the shelf you are looking at stay on the row (their `⋯` menu is where an owner is set) and go hollow. Collections that existed before owners did have none, and nothing else about them changed
  - With no password set there is no logged-in player, so "yours" falls back to the name you type into Available@'s **"Who are you?"** bar, matched to a player. If it matches nobody the distinction is not offered at all and everything reads as the group's
  - Removing a player never removes their collections: the cards are still in the house, so the shelf becomes the group's
- **Search in Scryfall syntax.** A bare word is still a card-name search, so `sol ring` means what it always did — but the box now reads the same query language as the Scryfall tab, run against the cards you actually own: `t:creature c:r mv<=2`, `o:"draw a card" -t:land`, `r:mythic`, `t:goblin OR t:elf`, `c=wu`, `m:{G}{G}`, `is:mdfc`, `eur>=50`, `!"Sol Ring"`. Filters combine with spaces (all must hold), `-` for not, `OR` and parentheses for the rest. Supported: `name` `t`(ype) `o`(racle) `m`(ana) `mv`/`cmc` `c`(olor) `id`entity `r`(arity) `pow` `tou` `s`(et) `is`/`not` `layout` `usd` `eur`, each with `: = != < <= > >=`
  - It runs entirely on the local card database — nothing is sent to Scryfall, and typing filters ~13,000 cards in well under a frame. The first non-name search in a session pauses for a second to read the card data it needs
  - Filters that need data the local oracle-card cache doesn't carry (`f:` format legality, `a:`rtist, `year:`, `kw:` …) are refused **by name** rather than quietly matching nothing, and point you at the Scryfall tab. So are typos: `zzz:1` says *Unknown filter "zzz:"*
  - As on Scryfall, `OR` and `AND` are operators only in capitals — lower-case `or` is a word in a card name
- **Sort** by name, mana value, color (WUBRG order), power, toughness, rarity, type, price, quantity owned, or any single collection's own count — as a sentence of up to three, e.g. *Rarity → Mana Value → Name*
- **The column headers are a shortcut into the same sort.** Click a heading to make that column the sort; **shift-click** to add it as the next criterion. Clicking the column already leading flips its direction. A sorted column is marked `↑`, and a column carrying a later criterion is marked `2↑` or `3↓` so you can see where in the sentence it comes
- **Columns menu** to show/hide optional columns: Mana Value, Color (as mana pips), Type, Rarity, Power/Toughness, Price (off by default to keep the table clean)
- Grid view shows full card images with per-collection ownership badges
- **Pile view** draws the collection as stacks of cards on a table, cut by the **first** criterion of the sort — sort by rarity and you get four stacks of visibly different heights, by mana value and you get your curve standing up off the table, by name and it buckets on the initial letter. The rest of the sentence orders the cards *inside* each pile, so *Rarity → Mana Value* is four piles each standing in curve order. Each stack shows its count, and the table arrives with every pile already spread — clicking a pile's header settles it back into a stack
- **Size** slider beside the view toggle sizes the card art from thumbnails to full-size (grid and pile views; remembered per view)
- On mobile, defaults to grid view; list view is still available and scrolls horizontally
- Hover over any card name (list view) for a Scryfall image tooltip
- Click any card name or image to open it in the **Card** tab (Ctrl/Cmd-click opens it on Scryfall instead)
- Collapsible "Add Collection" and "Collections" panels to save space; once you have at least one collection, the add panel auto-collapses (your manual toggle is remembered)
- Per-collection actions (Refresh / Re-import CSV / Remove) live in a "⋯" menu on each collection row
- On mobile, the results table is capped at 150 rows with a "Show all" button so the Deck Comparison panel is always within reach
- Right-side **Deck Comparison** panel: load a deck and see which cards you own, with a toggle to filter the table to deck cards only

### Players & Decks tab
- Add players via the **+ Add Player** button (admin only); each gets one of eight identity colours, repainted per theme so a player's chip is legible on all five (the record stores which of the eight, not a colour value)
- Add decks to players — enter a deck name and commander name; the commander's card art (fetched from Scryfall) becomes the tile background
- Optionally link an Archidekt URL to load the full card list for comparison
- Any URL can be saved as a "View ↗" link on the tile
- Each deck tile shows two primary actions — **Compare** (sends the deck to the Collections tab comparison panel) and **Build** (opens it in the Deck Builder) — with Edit and Remove tucked into a per-tile "⋯" menu; removing a deck asks for confirmation
- Removing a player lives in a "⋯" menu on the player header (admin only)
- Edit any deck in-place (name, commander, link)
- The tab is one control strip — **+ Add Player** and a count of players and decks — over full-width rows of art tiles; each player is a heading carrying their identity colour, which folds their decks away when clicked
- All deck metadata and commander art URLs persist across restarts

### Scryfall Search tab
- Full Scryfall query syntax: `t:legendary t:creature`, `c:g cmc=3`, `"exact name"`, etc.
- Results show which collections own each card and in what quantity, plus Cardmarket price (EUR)
- Quick **+** button on each card to add it to your personal want list in one click
- **Sort** results by name, mana value, color, power, toughness, rarity, type, or price — as a sentence of up to three
- **List** and **Grid** view toggle
- **Size** slider beside the view toggle sizes the card art from thumbnails to full-size (grid view only; remembered per view)
- Mana costs rendered as proper MTG mana icons
- Click any card name or image to open it in the **Card** tab (Ctrl/Cmd-click opens Scryfall)
- Search on Enter or button click — no auto-search while typing to stay within Scryfall's rate limits

### Card tab
- Detailed view for a single card — on **desktop (≥900px)** clicking any card name or image opens a dimmed **modal overlay** on the current tab (close with **✕**, **Esc**, or click outside); on **mobile** it switches to the full-page Card tab (the Card tab entry is hidden in the desktop sidebar since it's only reachable via mobile)
- Shows the full card image (both faces for double-faced cards) with oracle text rendered using proper mana symbols
- Card info: mana cost, type line, power/toughness/loyalty, set · collector number · rarity · artist
- Cardmarket (EUR) and USD prices
- Format legality badges (Standard, Pioneer, Modern, Legacy, Vintage, Commander, Pauper)
- Official **rulings** for the card, pulled from Scryfall
- Links to view the card on **Scryfall** or buy it on **Cardmarket**
- **Other Printings & Alt-Art gallery** at the bottom — every printing of the card; click any one to load that specific version
- Ctrl/Cmd-clicking a card anywhere still opens it on Scryfall in a new tab

### Set Browser tab
- Opens on a grid of **set tiles** — every non-digital MTG set (expansions, Commander, Masters, etc.), each showing its code, year, and **how many of its cards you already own**
- Filter sets by name or code
- Click a tile to load that set's cards, with collection ownership and Cardmarket price shown inline; the set becomes a chip on the toolbar whose ✕ goes back to the tiles
- Ownership dropdown to show all cards, only owned, or only unowned
- The "N of M owned" figure is the toolbar's result count
- **Sort** by set collector number (default), name, mana value, color, power, toughness, rarity, type, or price — as a sentence of up to three
- **List**, **Grid**, and **Pile** view toggle — pile view stacks the set by the sort's first criterion, the same way Collections does, and arrives with every pile spread
- **Size** slider beside the view toggle sizes the card art from thumbnails to full-size (grid and pile views; remembered per view)
- Click any card name or image to open it in the **Card** tab (Ctrl/Cmd-click opens Scryfall)

### Want Lists tab
- Per-player want lists with card-name autocomplete as you type (served from the local card database)
- Admins can create a new player straight from the player dropdown ("+ New player…")
- Import (CSV: qty,name or name-only) and Export (CSV / printable PDF checklist) share one "⋯" menu in the toolbar
- **List view**: combined table across all players — who wants each card, Cardmarket price, and whether anyone already owns it
- **Player filter**: chip row under the toolbar (All / per-player, each with its card count) to narrow down to a single player's list; defaults to showing everyone, and the toolbar's count says what the filter has done ("12 of 85 cards")
- **Sort** by most-wanted (default), player (groups cards by which player(s) want them), name, mana value, color, power, toughness, rarity, type, or price — as a sentence of up to three. Most Wanted produces enormous ties by construction, so it defaults to *Most Wanted ↓ → Mana Value → Name*, which is the curve inside each block rather than one undifferentiated block per number of people who want a card
- **Columns menu** to show/hide optional columns: Mana Value, Color, Type, Rarity, Power/Toughness, Price, In Collections
- **Grid view**: card images with Cardmarket price, coloured player-initial dots (tap your own dot to remove), and ownership badges, with the same **Size** slider
- Click any card name or image to open it in the **Card** tab (Ctrl/Cmd-click opens Scryfall)
- Remove individual wants from the table view with one click
- All want lists persist across restarts

### Deck Builder tab
- Full-width editing workspace for a single deck — select an existing deck or **+ New Deck** (player, name, optional commander)
- **The deck menu, beside the mat.** The control strip had grown to fourteen things and wrapped to three rows, so it keeps only what is used while building — the deck picker, the add-card field and the deck filter — and everything else is a column at the right-hand edge of the mat, opened from the ☰ (or `m`): **Mat** (view, size, sort), **Show** (which boards are drawn, and the missing/owned/borrowable filter with the shelf it counts against), **Look at** (Analysis, Search / EDHREC, History, Compare, Categories) and **Deck** (New deck, Import CSV, Paste List, the three exports, Delete Deck). It **pushes the mat rather than covering it** — every one of those controls is answered by the mat, so a panel you had to close to see what you did would be the wrong shape — and whether it is open is remembered. Below 900px the row becomes a column and the menu takes the top of it, arriving closed. The old **⋯** popover is gone: it existed because the strip had no room
- **Delete Deck** removes the deck and its saved cards/categories entirely, so you can re-add it (e.g. re-import the same Archidekt URL from the Players & Decks tab) with a clean slate. Its history goes with it, apart from one snapshot of what the deck was as it went — an Archidekt deck re-added under the same URL finds that waiting in the History panel
- **History** drawer — what this deck used to be, and putting it back. The deck saves by replacing every card row, so before this the state a save overwrote was gone about a second after the edit. Now a snapshot is taken **once per sitting** (the first save after a few minutes' gap, holding what the deck looked like before you started), **plus one immediately before anything that can lose work** — an import, a deleted category, a bulk move, a restore, a deleted deck — tagged with which. The panel lists them newest first with the deck as it stands at the top, each row saying what changed relative to the one below it (`+12 · −1 · 3 moved`, with the card names in the tooltip), and **Restore** puts any of them back. Restoring saves the deck it is replacing first, so undoing an undo works. Kept per deck: the newest 50, and nothing older than 90 days except the last few — about 7.7 KB a snapshot for a Commander deck
- Cards grouped into categories — Commander, Creatures, Planeswalkers, Instants, Sorceries, Enchantments, Artifacts, Battles, Lands, Other by default — with custom categories, rename, and delete via each category's "⋯" menu, or all at once from the **Manage Categories** modal; deleting a category with cards in it moves them to "Uncategorised" instead of losing the grouping
- **Filter box in Scryfall syntax** — the same query language the Collections search reads (`js/cardquery.js`), run against the deck in front of you and applied live as you type: `t:creature mv<=2`, `c:r OR c:g`, `-t:land`, `o:draw`, `r:mythic`, `"exact phrase"`. A bare word is still a plain search of card name *and* rules text, exactly as this box has always worked, so nothing has to be learned to type `goblin`. A filter the local card data can't answer (`f:commander`, `a:artist`) or one that isn't a filter at all is named and explained above the cards rather than silently matching nothing, and the deck stays drawn while you're still typing. A category the filter empties keeps its header — it is still one of the deck's piles, and still somewhere a card can be dropped
- **Multiselect**: click/tap a card (List/Grid/Pile) to select it, Ctrl/Cmd-A to select all visible, or "Select all" from a category's "⋯" menu — selected cards get a **Move to…** bulk action
- **Right-click a card** (or hold a finger on it) for what can be done to it: **Inspect**, **Move to…**, **Remove**. Grid tiles and pile cards carry no buttons of their own — the picture is the card — while list rows keep their inline ⓘ ⇄ × as well
- **Move to…** (single card or bulk) can also **✨ Auto-categorize** — sorts staples into functional categories the way Archidekt's community auto-categories do (Sol Ring → Ramp, Swords to Plowshares → Removal, etc.), falling back to card type — or create a brand-new category and move into it in one step
- **Carry a card** with the mouse or a stylus onto any category to move it there; auto-saves. The card follows the cursor with a little lag and leans into the direction it is travelling, the pile that would receive it lights up before you let go, and releasing settles it into place with a short overshoot. Released anywhere else it goes back where it came from and nothing changes. Dragging a card that is part of the current selection carries the **whole selection as a fan** with a count on it, and drops it through the same bulk move; dragging an unselected card carries that card alone and leaves the selection untouched
- Dragging is for pointing devices — a finger scrolls the mat instantly, with no press-and-hold delay, and **Move to…** stays the way to recategorise on a phone
- **The mat animates its own re-renders**: any change measures where each card was and where it ended up, and every card that moved travels there — so a removal, a sort or a move is something you watch happen rather than a result you have to work out. Only what can be seen is animated, so a four-hundred-card deck costs the same as a four-thousand-card one
- **Sort** cards within each category by name (default), mana value, color, power, toughness, rarity, type, or price — as a sentence of up to three
- **List**, **Grid**, and **Pile** view, with the shared **Size** slider for Grid and Pile (remembered per view, as on every other tab). A pile is a real stack — the face card on top with the edges of the cards beneath showing, getting visibly thicker as the category grows, so you can read the shape of a deck without counting. Each card's slight angle comes from its name, so the same card sits the same way on every render and the mat never reshuffles itself behind your back. Categories arrive spread; the arrow on a category's header settles it back into a stack
- Quick **Add a card** box with card-name autocomplete (served from the local card database); **Import CSV** or **Paste List** (`1 Sol Ring` / `1x Sol Ring` / `// Category` lines) for bulk add
- **Search / EDHREC** drawer panel:
  - **Search** tab — Scryfall query search (with an optional commander color-identity filter) to find and add cards, each shown with a thumbnail
  - **EDHREC** tab — recommendations for the deck's commander, split into the same type-based categories as Archidekt (Creatures, Planeswalkers, Instants, Sorceries, Enchantments, Artifacts, Lands) plus High Synergy, Top Cards, Game Changers, and New Cards, each card shown with a thumbnail, type line, synergy %, and deck-inclusion count
- **The readout line**: card/land counts vs. format target (60 or 99 for Commander), average CMC and color pip counts — one thin line of what the deck *is*, which is where the numbers the rest of the builder produces end up
- **The lands figure opens the mana panel**: what the deck's spells want against what its lands make, colour by colour — the pips counted off actual mana costs (commander included, a hybrid symbol half a pip to each colour that pays it) against the sources counted off what each card produces, so a mana rock and a dual land are both in it. A colour the deck asks for and nothing in it makes is said on the line as well as in the panel. **Open in the calculator** carries all of it to the Mana Base Calculator with every field filled
- **Analysis** expands the curve, the type breakdown and the split out of the toolbar rather than laying them permanently across the mat, so it is there when you ask for it — including on a phone, where it used to be hidden outright
- **The frame folds, in two tiers.** One press on the ⌃ at the end of the strip hides everything you act *with* — the picker, the add field, the filter, the whole deck menu beside the mat, the analysis strip, the bulk bar and the add-category row — leaving the readout line. A second press hides that too, for a mat with nothing on it but cards. A third brings it all back, and `f` does the same from the keyboard. Where you left it is remembered, so a deck read at full mat comes back at full mat. Nothing is ever revealed by pointing at it: the mat is a drag surface, and a card carried towards a category near the top of the screen must not trip anything
- **The ghost pile**: an empty outline after the last category, faint at rest and lit while a card is in hand. Drop cards on it and it becomes a real category with those cards in it, its name waiting to be typed in the heading it has just been given — the only way to make a category without going through a modal first. Being visible when your hands are empty is the point, and it is on the mat rather than in the toolbar, because a drop target inside chrome that folds away is one you cannot reach. Releasing a card anywhere else on the mat still means cancel
- **Boards — a maybeboard and a sideboard on the mat.** Somewhere to put a card that is not in the deck: before this, a card you were considering either went in and broke the count, or lived in your head. Each is a region below the categories, worked with the same carry — drop a card on the **Maybeboard** and it leaves the deck without leaving the deck record; drop it back on the deck, or on any category, and it is in again. **The card count, the curve, the average mana value and the export all read the mainboard alone**, so setting a card aside costs the deck nothing. **The same card can sit in a board and in the deck at once**, with a quantity of its own on each side — and carrying one onto a board that already holds it adds the copies together rather than claiming the card twice
- **Boards are off until you ask for one**, toggled from the deck menu and remembered against that deck, so a deck you never sideboard for is never asked to spend mat space on one. **A hidden board reveals itself while a card is in hand** and hides again when you let go — a board you switched off is still somewhere you can put something. On a phone, where a finger scrolls the mat rather than picking cards up, the boards are at the head of the **Move to…** list
- **A board draws flat** — one region, one count, no category headers. A maybeboard is a holding area, not a second deck. Each card keeps the category it was filed under while it lies there, so **one promoted back into the deck lands in the pile it came from** rather than arriving uncategorised
- **Compare** (in the deck menu) sends the deck to the Collections tab comparison panel

### Mana Base Calculator tab
- **Use this deck** fills every field from the deck open in the Deck Builder — the size it is built to, its land count, its non-basics, and the pips its costs actually ask for. The fields can be typed over afterwards, and the tab still works with no deck loaded at all, which is the case it exists for
- Choose a deck size preset — 40 (Limited), 60 (Constructed), 100 (Commander) — or enter a custom size
- Enter the count of each colored mana pip (W/U/B/R/G) and colorless (C/Wastes) across your non-land cards; colour icons use proper mana-font symbols
- Enter how many non-basic lands (duals, fetches, other) you're already including
- Instantly shows: total lands recommended, non-basics you entered, and how many basics to add
- Distributes basic lands proportionally by pip count using the largest-remainder method so the numbers always add up exactly

### Pick Night tab
- Select 2–6 players for tonight's game from the chip row under the toolbar
- **Deck Pool** drawer, opened from the toolbar button, which carries the count (`Deck Pool · 12 / 63`): the pool is opt-in — no decks are selected by default. Click individual decks to add them to the draw, or click a player's name to toggle all of their decks at once
- **Exclude own decks** (in the options "⋯" menu) so players won't be assigned one of their own decks
- Click **Pick Decks** to randomly assign one unique deck per player; up to 200 shuffle attempts ensure the constraints are always satisfied
- Results shown as large player-labelled commander-art tiles — the deck name is the one place in the app that uses the display type size
- **↺ Re-roll** per player (locks everyone else's pick) or **↺ Re-roll all** to start fresh

### RSS Feed panel
- On desktop, click **RSS Feeds** at the bottom of the left sidebar; on mobile it's in the header/nav dropdown — both open the same right-side feed panel
- Configure feeds by setting `RSS_FEEDS` in `docker-compose.yml` — comma-separated RSS 2.0 or Atom URLs
- All feeds are merged and sorted newest-first; each item is tagged with its source feed name
- Feed data is fetched server-side and cached for 10 minutes; supports HTTP redirects

### General
- **Appearance popover** — one menu for everything about how the app looks: the theme, the playmat, and whether cards move. Opened from the sidebar on a desktop and from the nav dropdown on a phone
- **5 themes** — Dark, Light, High Contrast, Sepia, and Dusk, picked from the Appearance popover (with a checkmark on the active one). **The choice is saved to your account**, so it follows you to any device you sign in on; the browser keeps a copy too, which is what paints the first frame and what remembers the theme in open mode (no `ADMIN_PASSWORD`), where there are no accounts. A `?theme=` URL parameter (`/?theme=light`, ids: `dark`, `light`, `contrast`, `sepia`, `dusk`) overrides and replaces the saved preference — handy for sharing a link in a specific theme, or for recovering from an unreadable stored one; an unknown id is ignored
- **Playmat** — set any card's artwork as the page background by name, or upload your own image (JPEG/PNG/WebP, up to 5 MB; uploads need an account). Saved to your account like the theme, painted before the first frame, and off by default on phones with a per-device switch to turn it on
- **MTG colour theming**: each tab carries its own mana-colour accent (WUBRG + gold) on the active nav item, panel headings, focus rings, and card hover glows — independent of the 5 UI themes above, since mana symbol colours represent the game, not the chrome
- Mana symbols rendered as proper MTG icons throughout (mana-font)
- **Minimal-UI conventions across all tabs**: one shared List/Grid(/Pile) view toggle component, shared Sort, Size and Columns controls, and "⋯" overflow menus for secondary/destructive actions (collection rows, deck tiles, player headers, want-list import/export, Pick Night options) — the common path stays visible, everything else is one click away
- **Sorting is a sentence, on every card view** (Collections, Scryfall Search, Set Browser, Want Lists, Deck Builder). A sort is an ordered list of up to three criteria, each with its own direction — *Color → Mana Value → Name* — and the control is one button whose label is that sentence, opening a popover to add, reorder, flip or remove a word. **Choosing a field seeds the whole sentence** rather than giving you one word: pick Color and you are sorted colour → mana value → name without touching anything else, pick Price and the expensive cards come first. Edit the tail and the chain becomes yours — changing the first field then swaps only that word instead of re-seeding, with "Reset to suggested" as the way back. Your sort and which columns are shown persist per-view in the browser; a sort stored by an older version of the app is read as the single criterion it was, and never silently re-seeded
- **Card size** on every view that draws card art (Collections, Scryfall Search, Set Browser, Want Lists, Deck Builder): one shared slider on the tab's strip, hidden in list views, remembered per tab *and* per view — so a collection scanned at thumbnails leaves the deck you are building at the size you build it at. It replaces the old XL view, which was this question answered once at 220px and nailed to a button
- **Cards are objects, not tiles.** Card artwork is drawn with no frame around it — the picture is the card. Its shadow follows its own rounded silhouette rather than a box, a lit top edge and shaded bottom edge give it thickness, and the corners are a real card's corner as a ratio, so they stay right at every size the slider reaches
- **Pointing at a card picks it up**: it lifts, scales, leans a few degrees towards the pointer, and a sheen crosses its face. The card's layout box never changes, so the pointer can't fall off a card that grew underneath it and the grid never reflows — crossing a grid quickly leaves no trail of half-animated cards. Touch pointers never lift anything, so no hover state outlives the finger that caused it
- **"Cards move" switch** in the Appearance popover turns all of that off, saved to your account like the theme. **If your operating system asks for reduced motion the whole app is still** — every transition and animation in the app is written under that guard, and the token linter fails the build on one that isn't. The system setting can only take motion away, never add it back, so it wins over the switch; the switch shows what you chose rather than silently unticking itself, with a note saying what happened
- **Scryfall traffic is centralised and cached**: the server keeps a daily copy of Scryfall's bulk card data in SQLite and serves card images/metadata/autocomplete locally; the few remaining live calls (full-text search, card detail, set browsing) go through a server-side proxy with a shared rate-limit queue and a 10-minute response cache — the browser never talks to api.scryfall.com directly
- Click any card (name or image) to open the card detail — a **modal overlay on desktop (≥900px)** or the **Card tab on mobile**; Ctrl/Cmd-click opens Scryfall instead
- **URL hash routing**: tab switches and card views update the URL (`#collections`, `#card=...`); browser **back/forward** buttons navigate between views; refresh restores your current view
- Rarely-used panels live in slide-over **drawers** opened from the tab's toolbar (Add Collection, Deck Comparison below 1280px, Deck Pool); the one thing left that collapses in place is a player's row of deck tiles, folded from the player's own header
- Per-user login system with player-linked accounts and an admin role
- **Desktop navigation**: tabs live in a collapsible left sidebar that overlays the content, with account actions (user badge, Appearance, RSS, change password, sign out) anchored to the bottom; click Collapse to shrink to icon-only mode — state persists across reloads. There's no top header on desktop — it's mobile-only
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
| `MTGTOOLS_NO_BACKGROUND` | Set to `1` to skip both Scryfall background jobs — the daily bulk download and the set-index sweep. For tests and offline runs; the app then serves whatever those two last cached |
| `COOKIE_SECURE` | Set to `1` to add the `Secure` flag to session cookies — recommended when running behind HTTPS |
| `AUTH_RATE_LIMIT_MAX` | Override the login rate-limit window max (default: 30 requests per 15 min per IP) |
| `UPLOAD_RATE_LIMIT_MAX` | Override the playmat-upload rate-limit window max (default: 20 uploads per 15 min per IP) |

Map `/app/data` to a persistent location on your host (e.g. `/mnt/user/appdata/mtgtools` on Unraid) so all data survives container restarts. All app data — collections, players, decks, want lists, availability, and user accounts — is stored in `available.db` (SQLite). Uploaded playmat backgrounds are the one thing kept outside it, as files under `data/playmats/` — one per user, at most 5 MB each, deleted when the user replaces the image or the account goes. A second database, `scryfall.db`, holds the local Scryfall bulk-data cache: on first startup the server downloads Scryfall's `oracle_cards` file (~24 MB gzipped, ~38k cards) in the background and refreshes it daily — watch for `[scryfall-db] imported … cards` in the log. It costs about 95 MB on disk. The app works during/without the download; card lookups just fall back to live (proxied) Scryfall until it completes. An upgrade that changes what the cache keeps per card re-downloads the file once even though Scryfall has published nothing new — `[scryfall-db] cached card shape is v… — re-importing` in the log is that, and it needs nothing from you. Set `ADMIN_PASSWORD` as an environment variable directly in your container manager if you're not using `docker compose`.

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
├── deck-history.js    # Deck snapshots — when one is written, the caps, and the diff on read
├── scryfall-db.js     # Scryfall bulk-data cache — daily oracle_cards download into SQLite
├── scryfall-queue.js  # One rate-limited Scryfall queue for the whole process (~9 req/s, Retry-After)
├── set-index.js       # What is in each set — background-filled, for the Set Browser's owned counts
├── playmat-store.js   # Uploaded playmat images — one file per user, under data/playmats/
├── middleware/
│   ├── auth.js        # Session auth helpers (requireAuth, requireAdmin)
│   └── limits.js      # The app's rate limiters — auth and playmat upload, two budgets
├── routes/
│   ├── admin.js       # Admin panel API — user management, account requests
│   ├── auth.js        # Auth API — login, logout, account request, change password
│   ├── available.js   # Availability calendar API
│   ├── cards.js       # Local card endpoints — /api/cards/collection + /api/cards/autocomplete (from scryfall-db)
│   ├── decks.js       # Deck Builder API — a deck's cards, its categories, and its snapshots
│   ├── prefs.js       # Per-account preferences — theme, playmat, card motion
│   ├── scryfall-proxy.js # Live Scryfall proxy — shared rate-limit queue, Retry-After handling, 10-min GET cache
│   ├── proxy.js       # Archidekt/Moxfield collection + deck proxy, EDHREC proxy
│   ├── rss.js         # RSS feed proxy + 10-minute server-side cache
│   ├── sets.js        # Set Browser data — /api/sets: the set list with per-set owned counts
│   └── state.js       # App state API — collections, players, decks, want lists
├── test/              # 24 files, run by `npm test`
│   ├── server.test.js       # HTTP seam — auth, state, admin, decks, prefs
│   ├── prefs-open-mode.test.js  # Preferences with no accounts to hang them on
│   ├── tokens.test.js       # Token-contract lint, asserted over the delivered CSS
│   ├── themes.test.js       # All five palettes define every token
│   ├── fonts.test.js        # The vendored typeface is served and self-hosted
│   ├── playmat.test.js      # Upload, replace, remove, and what counts as an image
│   ├── offline.test.js      # The app renders with no route out
│   ├── motion.test.js       # The preference resolved against the OS setting
│   ├── cardlift.test.js     # The lean, at the extremes and at the centre
│   ├── cardstack.test.js    # Layers from count, angle from name
│   ├── cardgroups.test.js   # Which pile a card belongs in, per sort field
│   ├── cardsort.test.js     # A sort as a chain — order, seeding, ownership, migration
│   ├── cardquery.test.js    # Scryfall syntax — what each filter reads, and what is refused
│   ├── cardsize.test.js     # The size store, keyed per tab and per view
│   ├── cardmove.test.js     # What travels on a re-render, and what is skipped
│   ├── carddrag.test.js     # Hit-testing piles, the fan, the drop's effect
│   ├── cardmenu.test.js     # Where a menu asked for at a point is drawn
│   ├── cardcache.test.js    # The cached card's shape, and the version that re-imports it
│   ├── deckhistory.test.js  # When a deck is snapshotted, the caps, and what a restore puts back
│   ├── deckframe.test.js    # The builder's frame — what folds away, and what stays
│   ├── deckboards.test.js   # Two Sol Rings — the maybeboard, the sideboard, and the count
│   ├── deckcommander.test.js # The commander as a board rather than a category
│   ├── deckfilter.test.js   # The deck's filter box — the query language run over one deck
│   ├── collectionowner.test.js # Whose shelf is whose — the column, the shelf, the open-mode name
│   ├── deckowned.test.js    # "87 of 99 owned" — the scopes, the missing twelve, and who has them
│   └── decklegality.test.js # Legal or the reason it is not, the bracket estimate, and tonight's bracket
├── scripts/
│   ├── capture-screens.js # Screenshot harness — every tab × theme × viewport
│   ├── measure-layout.js  # Layout measurement — horizontal chrome, prose measure
│   ├── measure-mobile.js  # Mobile measurement — sideways scroll, 44px touch targets
│   ├── check-contrast.js  # Contrast measurement — every fg/bg pair, all five themes
│   └── lint-tokens.js     # Token-contract linter (colour, type, spacing,
│                          # radius, elevation, !important)
├── public/
│   ├── index.html     # Single-page app shell
│   ├── login.html     # Password login page
│   ├── fonts/         # Inter, vendored — the app renders the same with no route out
│   ├── vendor/        # mana-font and jsPDF, vendored for the same reason
│   ├── css/           # Loaded in this order; later files may override earlier
│   │   ├── tokens.css     # The only file allowed raw colours: five theme palettes,
│   │   │                  # the type/spacing/radius scales, the three breakpoints,
│   │   │                  # per-tab accent colours. Enforced by scripts/lint-tokens.js
│   │   ├── base.css       # Element defaults and shared text utilities
│   │   ├── layout.css     # Page shell, header, navigation, sections, the wide width
│   │   ├── components.css # Controls and widgets shared across tabs
│   │   └── tabs.css       # Rules owned by a single tab
│   └── js/
│       ├── playmat.js     # Loaded in <head>: paints the background before first paint, and its picker
│       ├── motion.js      # Loaded in <head>: resolves the card-motion preference against the OS
│       ├── state.js       # App state, storage, shared helpers (renderMana, renderPrice, …)
│       ├── sortui.js      # The sort model — a chain of criteria, what each field is worth, what a
│       │                  # field seeds, what is stored — plus the shared controls: the sort button
│       │                  # and its popover, columns menu, view toggle, card-size control, "⋯" kebab menus
│       ├── cardlift.js    # Picking a card up: the hover lift, lean and sheen on every card image
│       ├── cardstack.js   # Drawing a group of cards as a stack: thickness from count, angle from name
│       ├── cardmove.js    # Cards travelling to where a re-render put them: measured before and after
│       ├── carddrag.js    # Carrying a card, or a handful: the lag, the lean, the fan, the pile that would take it
│       ├── scryfall.js    # Card data access: local-first lookups w/ live fallback, rate-limited proxy fetch, caches
│       ├── card.js        # Card Detail tab (oracle text, rulings, prices, alt-art printings)
│       ├── cardquery.js   # Scryfall query syntax, parsed and run against the local card cache
│       ├── collections.js # Collection CRUD and results rendering
│       ├── players.js     # Players and decks
│       ├── search.js      # Scryfall search tab
│       ├── sets.js        # Set browser tab
│       ├── wants.js       # Want lists tab (list/grid views)
│       ├── available.js   # Available@ calendar tab
│       ├── lands.js       # Mana base calculator tab
│       ├── auth.js        # Session auth, quick-add wants, change password
│       ├── admin.js       # Admin panel (user management, account requests)
│       ├── deckview-boards.js   # Deck Builder: what a card's place in a deck is — the boards, and the strings that name a card and a pile
│       ├── deckview-core.js    # Deck Builder: state, init, deck selection, board visibility, Archidekt import, auto-categorize
│       ├── deckview-render.js   # Deck Builder: rendering, tiles/rows, multiselect, stats, view toggle
│       ├── deckview-edit.js     # Deck Builder: card/category edits, move modal, autosave
│       ├── deckview-panels.js   # Deck Builder: search/autocomplete, drag/drop, EDHREC, import/export
│       ├── deckview-history.js  # Deck Builder: snapshots, the History drawer, restoring
│       ├── deckview-owned.js    # Deck Builder: what of the deck you own — the scopes, the missing list, the want-list send
│       ├── deckview-totals.js   # Deck Builder: one pass over the deck — what it costs, what finishing it costs, the curve, the types, the split
│       ├── deckview-legality.js # Deck Builder: whether the deck is legal, and the bracket it looks like — with the reasoning
│       ├── deckview-mana.js     # Deck Builder: the pips the deck's costs ask for against the sources its lands make, and the calculator filled from it
│       ├── pick.js        # Pick Night tab (random deck assignment, restrictable by bracket)
│       ├── rss.js         # RSS feed panel (sidebar/header toggle, fetch, render)
│       └── main.js        # Init, theme, tabs, sidebar nav, mobile nav, tooltips, card-click routing, state polling
├── docs/
│   ├── design/          # What was planned — briefs and PRDs, kept as context
│   │   ├── ui.md                    # The "Cards on a Table" interactivity brief — the
│   │   │                            # design intent behind how cards behave; built
│   │   ├── spec-cards-as-objects.md # The PRD that work was specified from
│   │   └── spec-sorting.md          # The PRD for multi-criteria sorting
│   └── records/         # …and what was actually built, written after delivery
│       ├── ui-redesign.md           # The visual redesign that came first
│       ├── cards-as-objects.md
│       ├── sorting.md               # A sort becomes a sentence of up to three criteria
│       ├── piles-expanded.md        # A table of stacks arrives spread
│       └── collection-query.md      # Scryfall syntax, run against the cards you own
├── Dockerfile
├── docker-compose.yml
└── data/              # Created at runtime inside the container (Docker volume)
    ├── available.db   # All persistent app data: collections, players, decks,
    │                  # want lists, availability calendar, user accounts (SQLite)
    ├── scryfall.db    # Local Scryfall bulk-data cache (~38k cards, refreshed daily)
    │                  # plus the set index — what is in each set, for owned counts
    └── playmats/      # Uploaded playmat backgrounds, one file per user. Created
                       # on the first upload; empty until somebody makes one
```

## The set index

The Set Browser's tiles say how many of a set's cards you own before you open it, and nothing in the app could answer that. A collection is card names and quantities — Archidekt and Moxfield both report an edition per row and the importer drops it, and even if it did not, you would only learn about the printings someone happens to own. The bulk cache is Scryfall's `oracle_cards` file: one entry per card *name*, so it knows which set a name came from but not which names a set contains.

So `set-index.js` keeps that the other way round: two tables in `scryfall.db`, one row per set and one per (set, card name). It is filled by a background sweep through Scryfall's search API — roughly 1,400 paged requests for the ~315 browsable sets, a few minutes at the shared queue's pace — and then it is effectively permanent, because a released set does not change. A set that does change, a spoiler-season set growing week by week, is re-indexed when Scryfall's `card_count` for it moves.

The sweep is sequential on purpose: one request in the shared queue at a time, so a search someone is waiting for never queues behind more than the job already in flight. Until it reaches a set, that set's tile shows how big it is instead of how much of it you own, and the toolbar's count says how far the sweep has got.

`GET /api/sets` answers the whole picker in one request — the set list, filtered and sorted, with each set's card count and owned count. "Owned" means what it has always meant on that tab: a card counts if any collection holds a card of that name, whichever printing. Both sides ask Scryfall the same `unique=cards` question, so a tile reading "176 / 286 owned" opens onto 286 cards with 176 ownership badges.

Deleting `scryfall.db` costs nothing but the refill.

## Design records

Five pieces of work were large enough to be worth writing up afterwards, and each has a record in [docs/records/](docs/records/) that supersedes whatever it was planned from. They are written for whoever picks the code up next — what was built, what it cost, where the build departed from the plan, and what was found only by using it.

| document | what it covers |
|---|---|
| [docs/records/ui-redesign.md](docs/records/ui-redesign.md) | The visual redesign — the token contract, the layout rules, the measurement scripts, the playmat |
| [docs/records/cards-as-objects.md](docs/records/cards-as-objects.md) | Cards as objects — the motion preference and its contract, the card treatment, the lift, stacks and the pile views, the shared size control, animated re-renders, carrying a card and a handful, and the card menu |
| [docs/records/sorting.md](docs/records/sorting.md) | Sorting by more than one thing — a sort as a chain of up to three criteria, every field a real criterion, seeded sentences and who owns them, the control that says the sentence, and the table header as a shortcut into it |
| [docs/records/piles-expanded.md](docs/records/piles-expanded.md) | Piles land expanded — a table of stacks arrives spread, and settling one is the thing you do |
| [docs/records/collection-query.md](docs/records/collection-query.md) | Scryfall syntax in the Collections search — the query language parsed and run locally against the cards you own, one cache of card facts for the sort and the search both, and the filters that are refused by name because the local data can't answer them |

What each was planned from is kept beside them in [docs/design/](docs/design/): [ui.md](docs/design/ui.md), the interactivity brief the second of those was written against, [spec-cards-as-objects.md](docs/design/spec-cards-as-objects.md), its PRD, and [spec-sorting.md](docs/design/spec-sorting.md), the PRD for the third. Where any of them disagrees with its record, the record is what happened.

Work large enough to need planning is cut into tickets first — one shippable, testable change each — under a `docs/tickets/<effort>/` directory that exists only while that effort is in flight. A ticket set is retired into a record once it lands.

One effort is in flight: [docs/tickets/deckbuilder-depth/](docs/tickets/deckbuilder-depth/), eleven tickets cut from [spec-deckbuilder-depth.md](docs/design/spec-deckbuilder-depth.md) — the deck builder's analysis surface, the boards it has never had, and the frame that keeps the cards the content while all of it lands. Each ticket names the tickets that block it; six are blocked by nothing. A twelfth was added to the same directory rather than cut from the spec: a pre-existing mobile touch-target failure on the builder's category headings, found while building ticket 02, which the last checkbox of every other ticket here trips over.

## Testing

The project ships a test suite using Node's built-in `node:test` runner and `supertest` — over 450 tests across 21 files, needing no browser and no network.

```bash
npm test
```

Tests are written at three seams, all of which assert externally observable behaviour rather than which function called which:

- **The HTTP seam** drives the Express app through a client against an isolated in-memory SQLite database and a temporary state file, so they never touch production data. It covers auth, state, admin, deck and preference routes — anything that is request/response behaviour, including the whole playmat and the card-motion preference.
- **The static seam** is the token linter below, because a visual contract cannot be asserted over HTTP and its most valuable guarantee is a property of the delivered stylesheet.
- **The vm seam** loads a shipped browser file into a `vm` context and calls its decisions directly. Everything the card behaviour decides about *where something goes* is written as a pure function of its inputs and exported from the file that ships — how thick a stack of *n* cards is, what angle a card's name gives it, which pile a card belongs in for the sort's first criterion, how far a card leans, which pile a released card would land in, where each card lies in a carried fan, where a menu asked for at a point is drawn. Sorting is the same seam pointed at the same file: what a chain orders, what a field seeds, what makes a chain somebody's own, what a stored preference from an older version means now, and that no gesture on a table header can reach a chain the control's label cannot say. So those are asserted at their boundaries rather than eyeballed through a browser.

Nothing asserts markup: this work churned markup deliberately.

### Token-contract linter

`npm test` also runs `scripts/lint-tokens.js`, which reads the CSS the browser is actually served — plus the inline `style=` attributes in the HTML and JS — and fails on anything that has drifted off the design token contract:

| rule | fails on |
| --- | --- |
| `colour` | a raw `#hex`, `rgb()` or named colour outside `tokens.css` |
| `type` | a `font-size` that is not one of the seven `--text-*` steps |
| `space` | `padding`/`margin`/`gap` that is not one of the six `--space-*` steps |
| `radius` | a corner that is not one of the `--radius-*` steps — the three UI steps plus `--radius-card`, a physical card's corner as a ratio |
| `shadow` | a shadow that is not one of the `--shadow-*` overlay tokens, or a surface drawing a border *and* a shadow |
| `motion` | a `transition` or `animation` whose duration is not multiplied by a motion token, so it would still move for someone who asked for less movement |
| `important` | an `!important` outside the allowlist in the script |

Run it alone with `npm run lint:tokens`. The scales are read out of `tokens.css` at startup rather than duplicated in the script, so that file stays the single written-down definition.

A genuine one-off escapes with a CSS comment containing `EXEMPT`, which must say **which rule** it is escaping and **why** — `/* EXEMPT from the colour rule: this sits over card artwork. */`. The scope is the rest of the enclosing rule, or the next rule if the comment is at the top level, or an explicit `EXEMPT-BEGIN` … `EXEMPT-END` span. Naming no rule escapes all of them, which is almost never what you want. `!important` can never be excused this way; it has an allowlist instead, so the count stays visible in one place. Both allowlists are ratchets — they only ever shrink, and a test asserts their current size.

### Screenshot harness

For reviewing visual changes, `scripts/capture-screens.js` renders every screen of the app — 11 tabs × 5 themes × 2 viewports (1440×900 and 390×844) = 110 full-page PNGs, plus an `index.html` contact sheet showing them all at once.

Two further viewports, `tablet` (880px) and `tablet-wide` (960px), sit either side of the 900px breakpoint and are not in the default set. Pass `--viewports tablet,tablet-wide` when a change touches responsive behaviour: the default pair never crosses that boundary, so a rule that only misbehaves at tablet width does not show up in a standard capture.

```bash
DATA=--data=.scratch/ui-redesign/capture-data/state.json
npm run capture-screens -- $DATA --name baseline   # before a change
npm run capture-screens -- $DATA --name after      # after it, then compare
```

It starts its own copy of the server in open mode (no login needed) and drives the locally installed Firefox headless over WebDriver BiDi — no extra dependencies. Each view is loaded through the app's own URL routing (`/?theme=sepia#wants`) and captured once the page stops fetching. Tall pages are clipped to 4000px (`--max-height`), since a real collection runs to five figures. Output lands in `.scratch/ui-redesign/shots/<name>/` and is git-ignored.

**Always pass `--data`.** Screens are only as interesting as the data behind them, and the repo's own `data/` is empty, so without it every tab renders an empty state and the comparison proves nothing. `.scratch/ui-redesign/capture-data/` holds a git-ignored snapshot of a populated database for exactly this; if it is missing, restore it before capturing. `DATA_FILE` names a file whose *directory* is used as the data directory, so `available.db` and `scryfall.db` sit beside the `state.json` path you pass. Always use a copy — the app writes to whatever database it is given.

Runs are deterministic: capturing twice with no changes gives byte-identical PNGs, so `sha256sum` is a fair way to confirm that a change left unrelated views alone.

**With two exceptions.** The **Set Browser**'s tiles are only as complete as the set index in the `scryfall.db` you point it at — a snapshot whose index is half filled shows "262 cards" where a filled one shows "41 / 262 owned", and a new set announced between two runs adds a tile at the front. Let the index finish before capturing anything you intend to compare. **Available@** draws a calendar around today, so any pair of captures that straddles midnight differs on the highlighted day and the "best upcoming days" list. Capture the before and after close together, or discount those tabs. If a diff looks far too big for what you changed, check the maximum per-channel delta before assuming the worst: a restyle moves pixels a little across a wide area, whereas reordered content moves a few pixels a lot.

**A card detail is a third case, for a different reason.** `--tabs 'card=Sol Ring'` captures an open card, and that view is three live Scryfall requests deep — the card, then its rulings and its printings. They share one server-side queue with the set-index sweep, which is ~1,400 paged requests and draws 429s with a 60-second `Retry-After`; while it is running, a card lookup can queue behind a minute of penalty and the shot is of "Loading…". Capture card views against a server whose index has already finished, and raise `--settle` if they still come out mid-load.

This is a review aid, not an automated assertion: nothing compares the images. Useful flags — `--tabs`, `--themes`, `--viewports` to narrow a run, `--url` to point at an already-running app, `--help` for the rest.

### Layout measurement

Three of the layout rules are numbers, and a screenshot cannot produce a number, so `npm run measure:layout` measures them in the running app. It reuses the harness above — same open-mode server, same headless Firefox — and reports one line per tab per window:

```bash
npm run measure:layout -- --data .scratch/ui-redesign/capture-data/available.db
```

- **Horizontal chrome** — everything the page spends on itself rather than on content: the sidebar plus the shell's inline padding. Budget is 80px at a 1440px window; it currently measures 78.
- **The reading measure** — no line of running text may be wider than `--measure`. What is measured is the rendered *line box*, via a `Range`, not the container: a short sentence centred in a full-width table cell is not a long line. The measure itself is read from a probe element rather than assumed, since `72ch` depends on the typeface in use.
- **Grid width** — the widest grid or table on the page, reported rather than asserted. It is there to be read at the 2560px window, where a width cap that had crept back in would show up as a number that stopped growing.
- **The fold** — how far down the window the first card sits: the vertical twin of chrome, what a tab spends on itself before showing the thing it is for. The tab's view toggle is clicked to grid first, since the criterion is about card *art* and a list view has none. Budgeted per tab in `FOLD_BUDGETS`: Collections 105px (measures 102), Want Lists 105px (measures 94), Scryfall Search and Set Browser 70px (both measure 60), Pick Night 150px (measures 133 — a strip, the players row, and the results' own bar). Three of those show nothing until asked, so `FOLD_PREP` asks — a query typed and entered, a set tile clicked, an evening's decks picked — which means measuring the first two needs Scryfall reachable, as the Set Browser always has. Pick Night's "card" is a commander-art tile rather than a card image; the question the fold asks is how far down the thing the tab is *for* sits, and there that is the picked deck.

It exits non-zero if the chrome or fold budget is blown or any line of prose runs past the measure, so it can be wired into CI later; it is not part of `npm test`, which needs neither a browser nor a populated database.

### Mobile measurement

Two of the mobile rules are numbers as well, and `npm run measure:mobile` asks them at a 390×844 window — same open-mode server and headless Firefox as the two scripts above.

```bash
npm run measure:mobile -- --data .scratch/ui-redesign/capture-data/state.json
```

- **Sideways scroll** — a phone has no horizontal scrollbar to warn you, so a pane one pixel too wide reads as a page that drifts under the thumb. The budget is zero. When it is blown the elements sticking out past the right edge are named, innermost first, since an overflowing child drags its parents out with it and reporting the whole chain buries the one element that is actually too wide. A wide table is excused: it is *supposed* to scroll, and the walk up the ancestors stops at the first container that scrolls on purpose.
- **Touch targets** — every control at least 44×44. What is measured is the area a finger can land on, not the box the control paints, because on a phone those are deliberately not the same thing: a ✕ set into a dense table keeps its small painted box and gains an invisible pad around it (see the touch-target rule in `components.css`). So the size is found the way a tap finds it — `elementFromPoint`, bisecting outwards from the centre until the answer changes. That also catches the two failures a bounding rect cannot see at all: a target with something painted over it, and two neighbours whose pads overlap so that one swallows the other's edge. Inline links inside running prose are excluded; they cannot be 44px tall without breaking the line box they live in.

One pixel of slack is allowed on the target size, and it is the ruler's rather than the design's: Firefox snaps the far edge of a hit region down to a whole pixel, so a control laid out on a fractional boundary hit-tests up to a pixel narrower than the 44 its computed style says it is.

Five views have no tab of their own and are measured as extra passes, listed in `EXTRA_VIEWS`. The Deck Builder's two drawers — Search/EDHREC and History — and the RSS panel are full-height surfaces on a phone carrying controls nothing else does, and each is scoped to itself — the page behind an open drawer is unreachable by design, and counting its controls as unhittable would report the drawer working as a fault. Collections' list view is there for the opposite reason: a tab is measured as it arrives, and Collections arrives as a grid of card art, so its table — the densest in the app — was not being looked at at all. Otherwise the sweep still sees each tab in its default view, so a control that appears only after switching views is not covered; add it to `EXTRA_VIEWS` with a `PREP` step that opens it.

It exits non-zero on either count. Like `measure:layout` it needs a browser and a populated database, so it is not part of `npm test`.

## Tech Stack & Credits

| Component | Credit |
|-----------|--------|
| **[Express](https://expressjs.com/)** | Server framework — MIT licence |
| **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** | SQLite for all persistent data — MIT licence |
| **[Scryfall API](https://scryfall.com/docs/api)** | Card data, images, search, autocomplete, prices, rulings, and printings (alt-art). Free to use; please follow their [rate limit guidelines](https://scryfall.com/docs/api#rate-limits). Per their guidance, card data is served from a daily [bulk-data](https://scryfall.com/docs/api/bulk-data) download cached in SQLite; the remaining live calls (search, card detail, sets) go through a single server-side proxy queue that stays under 10 req/s and honors `Retry-After`. Scryfall search is triggered manually (Enter / button) rather than on every keystroke. |
| **[mana-font](https://github.com/andrewgioia/mana)** | MTG mana symbol icons — MIT licence |
| **[Inter](https://rsms.me/inter/)** | The application typeface — SIL Open Font License 1.1. Vendored into `public/fonts/` rather than loaded from a font service: the app has to render the same, and render at all, on a server with no route out. See [public/fonts/README.md](public/fonts/README.md) |
| **[Archidekt](https://archidekt.com)** | Collection and deck data via their public REST API |
| **[Moxfield](https://moxfield.com)** | Collection data via CSV export |
| **[Docker](https://www.docker.com/)** | Containerisation |

Cardmarket prices are sourced from Scryfall's `prices.eur` field and reflect Cardmarket marketplace data at the time of the Scryfall API response.

Card images and search data are provided by Scryfall. Scryfall is not produced by or endorsed by Wizards of the Coast.

Magic: The Gathering is © Wizards of the Coast LLC.

## License

This project's code is released under the [MIT License](LICENSE). Card data, images, and Magic: The Gathering IP remain the property of their respective owners (see credits above).
