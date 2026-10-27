# MTG Tools

Personal software for a playgroup: search everyone's collections at once, track decks,
and coordinate who is free to play. Vanilla JavaScript, no build step, no framework,
served from someone's own machine — in practice a Docker container on a Linux host,
published to Docker Hub by CI on every push to `main`.

The owner doesn't write code: the app was built almost entirely with AI. Explain changes
in plain language, say what was and wasn't verified, and don't assume they will read a
diff to catch a mistake.

## Where to read first

| Document | What it gives you |
|---|---|
| [docs/architecture.md](docs/architecture.md) | The whole file tree with a line per module, the set index, the state revision, the index of design records |
| [docs/features.md](docs/features.md) | Every tab, what it does and how a user drives it |
| [docs/testing.md](docs/testing.md) | The three test seams, the token-contract linter, the screenshot and measurement scripts |
| [docs/configuration.md](docs/configuration.md) | Accounts and roles, every environment variable, where data lives, backups, the container user |
| [docs/records/](docs/records/) | What each large body of work actually built — supersedes the plans in [docs/design/](docs/design/) |
| [docs/plans/](docs/plans/) | Plans written for particular efforts |

When a record and the design doc it was planned from disagree, the record is what happened.

## The shape of it

- **Server** — `server.js` (Express) wires up `middleware/` and `routes/`. Each root-level
  `*.js` module is one concern: `available-db.js` is the app's SQLite database,
  `scryfall-db.js` the local Scryfall bulk cache, `scryfall-queue.js` the one
  rate-limited queue every live Scryfall call goes through, `set-index.js` the background set
  sweep, `collection-import.js` + `archidekt-queue.js` server-side imports,
  `deck-history.js` deck snapshots, `backup.js` daily backups, `playmat-store.js`
  uploaded backgrounds.
- **Client** — `public/index.html` is a single-page shell loading plain `<script>` files
  from `public/js/` that share globals. Script order matters only for code that runs at
  parse time: top-level reads of another file's constants, listener registration order
  (modal.js's Escape handler runs ahead of main.js's), and markup placed after the
  scripts (bind it on `DOMContentLoaded`); function bodies routinely call files loaded
  later. Tests assert only some pairs, matching the exact string
  `<script src="js/X.js"></script>` (so adding `defer`, `type` or `?v=` breaks them), and
  **nothing checks that a new js file has a script tag at all** — an unlinked file passes
  every vm test and never runs. The Deck Builder is split across `deckview-*.js`; table
  mode (experimental, a 3D-table view of the app) is `tablemode.js` + `css/table.css`.
- **Styles** — `public/css/` is loaded in order (tokens → base → layout → components →
  tabs → table). `tokens.css` is the only place raw colours and scales may appear;
  everything else uses its custom properties. `scripts/lint-tokens.js` enforces it.
- **Data** — `data/` (git-ignored, a Docker volume at `/app/data`) holds
  `available.db` (everything users create), `scryfall.db` (a disposable cache) and
  `playmats/`. Never point a dev run or a script at real data; use a copy.
- **Vendored assets** — fonts, mana-font, jsPDF and the table textures live in
  `public/` so the app renders with no internet route out. Don't add CDN links.

## Running and testing

```bash
npm install
npm start          # http://localhost:3000; open mode (no login) unless ADMIN_PASSWORD is set
npm test           # every test/*.test.js via node:test — no browser, no network
```

`MTGTOOLS_NO_BACKGROUND=1` skips the Scryfall downloads and backups for offline runs.
CI (`.github/workflows/docker-publish.yml`, Ubuntu, Node 22) runs `npm test`,
`npm run lint:tokens` and `npm run check:contrast`, then builds and pushes the image
from `main`. Run all three before calling a change done. The Windows dev machine runs
Node 24 while CI and the image use Node 22 — don't use APIs newer than 22.
`test/archidektpace.test.js` ("spaces requests") can flake on timing under the parallel
run; rerun that file alone before treating a failure as real.

Tests assert behaviour at three seams — HTTP (supertest against a temp database), static
(the token linter), and vm (a shipped browser file loaded into a `vm` context and its
pure functions called). Nothing asserts appearance; tests do assert the page is *wired
up* (handlers exist, some scripts are served in the order they need). See
[docs/testing.md](docs/testing.md).

### Writing tests

- There is no shared test helper; copy the setup at the top of `test/server.test.js`.
  Env is set before the first require: `DATA_FILE=<mkdtemp>/state.json` (only its
  directory is used), `PORT='0'`, `MTGTOOLS_NO_BACKGROUND='1'`,
  `AUTH_RATE_LIMIT_MAX='1000'`, and `ADMIN_PASSWORD` set (auth mode) or deleted along
  with `APP_PASSWORD` (open mode). Open and auth mode therefore need separate files. Log
  in with the helper that returns the `mtg_session=…` cookie and send it with
  `.set('Cookie', …)`.
- Each file runs in its own process, in parallel. Close the server and clear timers in
  `after()` — there is no force-exit or timeout, so a leaked handle hangs `npm test`
  forever instead of failing. Never call `process.exit`. The `resetDb()` helpers are
  copied per file and list their tables, so a new table must be added to each copy.
- vm-seam tests build their own stubs and list the `public/js` files to load, in order,
  by hand; a new cross-file call breaks every harness that doesn't load the new file, so
  update the lists or guard the call with `typeof`. Top-level `const`/`let` aren't
  sandbox properties — read them with `runInContext('name')`; JSON-copy sandbox objects
  before `deepStrictEqual`.
- Ratchets in `test/tokens.test.js`: the `!important` allowlist count is asserted and may
  only go down; the elevation and motion allowlists are empty; a stale allowlist entry
  fails. The CSP test asserts there is **no** `script-src`/`default-src`, because the
  markup uses inline handlers — tightening the CSP breaks the app.

### On Windows

The app is run on Linux, but it's sometimes developed on Windows with
`core.autocrlf=true`, which checks files out with CRLF line endings. Tests that read
source text must normalise `\r\n` to `\n`, compare repository paths with forward slashes
(`path.relative` gives backslashes on Windows), and close any SQLite database before
deleting its temp directory (Windows won't remove an open file). Keep new tests to the
same rules, so the suite passes on both.

## Server rules

- **Where data lives.** `app_state` in `available-db.js` is a key/value table. Key
  `'state'` is a JSON blob `{players:[…]}` holding players, deck records, folders and
  want lists (they have no tables); `'rev'` is the trigger counter; `'migration:<name>'`
  rows mark data migrations done. Real tables: collections, deck_cards, deck_categories,
  deck_snapshots, collection_imports, users, sessions, the calendar. The deck_* tables
  are keyed by deck id with no foreign key — `writeState` cleans them up via
  deck-history's `forgetDecks`; `collections.owner_player_id` has no FK either
  (`disownGonePlayers` clears it).
- **The write contract.** Every blob write goes through `writeState(data, checkVersion)`
  in `routes/state.js` (one transaction, version+1, `forgetDecks`). Whole-copy writes
  (POST /state, PUT /players/:id/decks) must send a numeric `version`: missing → 400,
  stale → 409 `{error, conflict:'version'}`. Patch routes (wants) take no version, return
  `{version, changed}`, and must not write when nothing changed — a needless bump 409s
  every other open tab. Raw SQL that changes the blob must bump the version too. A new
  table whose data GET /state returns must be added to the trigger loop in
  `available-db.js`, or open tabs never see its changes.
- **Migrations have no schema version.** A new column goes in CREATE TABLE and in a
  guarded ALTER (a `PRAGMA table_info` check or try/catch); a primary-key change is a
  table copy in one transaction; data migrations check a `migration:<name>` marker. They
  run when the module is required and tests re-require it, so they must be idempotent.
  Triggers are created after migrations.
- **Body parsing is per route** (`express.json({limit})` after the auth middleware) —
  there is no global parser. `routes/cards.js` and `routes/scryfall-proxy.js` call
  `router.use(express.json({limit:'256kb'}))` on routers mounted at `/api`, so it applies
  to every /api request that reaches them; a router mounted after them in `server.js` is
  capped at 256kb.
- **Permissions.** The global guard in `server.js` only checks that a session exists,
  for `/api/` and `/available/api/`; anything registered above it is public. Open mode's
  guest has role admin, so permission tests need `ADMIN_PASSWORD` set. Use the existing
  guards: `requirePlayerAccess`, `requireDeckVisible`/`requireDeckWrite` (a private deck
  the viewer can't see answers 404, not 403), `deckVisibleTo`/`deckWritableBy`,
  `actsFor`/`mayChangeCollection` (a collection with no owner is the group's, editable
  by anyone). Anything new that returns deck data must filter private decks, counts
  included. A non-admin POST /state is merged: other players' records are kept from
  storage.
- **Validate on write.** The client draws stored ids, colours and URLs into inline
  onclick handlers, attributes and CSS `url()`, so the server checks them on the way in
  (`isId`, `isHexColor`, `isHttpUrl`/`isImageUrl`, `readNumber`, inside
  `deckProblem`/`playerProblem`/`collectionProblem`/`cardProblem`). A new stored field
  needs a validator there.
- **Card shapes go through their helpers**: deck cards via
  `readPrinting`/`writePrinting`/`deckCardRow`, collection cards via
  `readCollectionCards`/`writeCollectionCards`/`addCardPrinting`. `PRINTING_FIELDS` order
  is fixed (history compares with `JSON.stringify`) — append new fields at the end. A new
  deck_cards column must also reach `routes/decks.js` and deck-history.js's
  `readDeck`/`normaliseState`, where forgetting it fails silently. Changing `trimCard` in
  `scryfall-db.js` requires bumping `SHAPE_VERSION`, or existing installs never
  re-import.
- **Sessions store a copy of role and player_id**: changing a user's role or linked
  player must also UPDATE sessions (see `routes/admin.js`). SameSite=Strict cookies are
  the only CSRF defence.
- **Async route handlers are wrapped in `asyncHandler`** (Express 4 doesn't catch
  rejections; one once took the server down). Errors are always `{error: string}`.
- **Require-time behaviour.** Requiring `server.js` starts listening; env vars
  (`ADMIN_PASSWORD`/`APP_PASSWORD`, rate limits, `ARCHIDEKT_*`, `RSS_FEEDS`,
  `DATA_FILE`) are read at require time; `available-db.js` marks running imports
  'interrupted' on load. New outbound calls should use `fetch` with a timeout (tests stub
  `globalThis.fetch`; the older EDHREC/RSS code uses `https.get` and can't be stubbed
  that way). All Archidekt traffic goes through `archidekt-queue.js`. Moxfield has no
  server route (its API answers 403 to servers); Moxfield collections arrive as CSV.

## Client rules

- **Files "export" by top-level declaration only** — no modules, no `module.exports`;
  the only window global is `window.tableMode`. No top-level name may be declared in two
  files (`test/globals.test.js`; a duplicate function silently overrides, a duplicate
  const kills the later file). Use the file's prefix (`db*` deck builder, `col*`, `sf*`,
  `set*`, `want*`, `avail*`, `lands*`, `pick*`, `admin*`, `faq*`, `table*`, `card*`,
  `own*`) and a leading `_` for file-private names. To stay testable in the vm seam,
  top-level code must survive `getElementById` returning null, and calls into another
  file are guarded with `typeof fn === 'function'`.
- **Two save models.** The players blob (players, deck metadata, folders, wants) is
  saved by `saveToStorage`/`savePlayerDecks`/`writeWant` with the optimistic version (a
  409 reloads and alerts). Deck cards are saved by `dbScheduleSave()` in
  `deckview-edit.js` — 800ms debounce, no version, last write wins; call it after
  mutating `dbCards` and don't add another debounce. Collections use their own
  `/api/collections` routes.
- **A deck record field is listed in four places** — `stateToJSON`, `hydrateState`,
  `savePlayerDecks` (`public/js/state.js`) and the server's deck normaliser/validator in
  `routes/state.js`. Miss one and the field is silently dropped on the next save or poll.
- **The 30-second poll re-renders tabs with innerHTML** and wipes in-progress UI, unless
  `stateIsMidFlight()` in `state.js` says something is mid-edit. A new inline form or
  edit state must register there.
- **Escaping**: `esc()` for text and attributes, `jsAttr()` for a value inside a quoted
  inline on* handler (`esc` alone breaks on "Urza's"), `cssUrl()` for `url()` in a style.
  `kebabMenuHtml` (`sortui.js`) inserts its label raw — callers escape.
- **`isMyPlayer(id)` means "may act for"** (true for every player when admin or in open
  mode); `myPlayerId()` means identity. Use `myPlayerId` for "my shelf/decks".
- **Scryfall data in the browser**: `scryfall.js` keeps Maps keyed by card name where
  null/`{}` means "looked up, nothing there" — decide with `has()`, never a falsy
  `get()`, or you get a fetch/re-render loop. `cardMetaOf` (`sortui.js`) is the reader
  of card facts; live calls go only through `scryfallFetch`. `collection.cards` is a Map
  of name → `{qty,…}`; double-faced names are "A // B", so use `owned.js`'s
  `ownedName`/`ownedQty`/`holdersOf` rather than `cards.has`.
- **Table mode reaches into the tabs through silent `typeof` guards**: the getters in
  `TABLE_SOURCES` (`tablemode.js`: `colShownPiles`, `dbShownPiles`,
  `dbShownCommanders`, `decksShown`, `sfShownCards`, `setShownPiles`, `wantShownLists`,
  `cardDetailShown`), deck functions (`dbMoveCardsTo`, `dbPlace`, `dbAutoCategory`,
  `dbOpenSearchPanel`, `_dbRenameCategory`) and element ids/classes (`dbSearchPanel`,
  `dbAddCardInput`, `.db-drawer`, `.db-stats-bar`). Renaming any of them breaks table
  mode with no error, and the tests stub the getters so they won't catch it. Table mode
  moves the live tab pane into its panel rather than cloning it.
- **Markup opt-ins**: `.card-link`/`.card-open` + `data-name` opens card detail;
  `data-moves` plus `animateCardMove(root, rebuild)` animates a re-render; JS motion
  calls `cardMotionOn()` each time instead of caching it. Dialogs open with `modal.js`'s
  `openModal(ref, {onClose, focus, returnFocus})` (`card.js` has its own private
  `_openModal` — don't confuse them). localStorage keys are `mtgtools_*`; a sortui
  view-name string is a storage key, so renaming it orphans users' saved prefs.

## Things that must stay in sync

- **A new tab** touches: `index.html` (`#tab-X`, `#tab-btn-X`, `.mob-nav-item[data-tab]`),
  `MOB_TAB_LABELS` in `main.js` (also the hash-routing whitelist), `setTab`'s init
  dispatch and `renderAll`, the accent line in `tokens.css`, `TABLE_RIM` in
  `tablemode.js` (a test matches it to the tab-btn ids) and `TABLE_SOURCES` if it shows
  cards, `TABS` in `scripts/capture-screens.js` and `scripts/measure-layout.js`, and for
  a FAQ entry `FAQ` in `faq.js` plus `FAQ_TABS` in both `public/js/state.js` and
  `routes/prefs.js` (the server 400s unknown ids).
- **A new theme**: `THEMES` in `main.js`, `routes/prefs.js`,
  `scripts/capture-screens.js` and `scripts/check-contrast.js`, the palette in
  `tokens.css` and the picker in `index.html` (`test/themes.test.js` checks them).
- **Server ↔ client mirrors**: deck-history `REASONS` ↔ the client's snapshot reasons
  (the client ignores the reply, so a missing reason is a silent 400),
  collection-import `parseCard` ↔ `collections.js` `parseCard`, `DEFAULT_CATEGORIES` ↔
  `DB_DEFAULT_CATS`, `normalizeDeck`/`playerSlot` ↔ `public/js/state.js`.
- **A new stylesheet** must be added to `CSS_FILES` in `scripts/lint-tokens.js` or it
  isn't linted; `check-contrast.js` lists its themes and colours by hand.
- **Some section-banner comments are load-bearing**: tests cut code out of shipped files
  by them (e.g. `main.js`'s `// ── Theme ─` … `// ── View mode ─`, `// ── State refresh`,
  and `── The phone, per tab ──` in the CSS). Don't rename `// ── … ──` banners without
  grepping `test/` for them.

## Conventions

- **Branches** are `feat/…`, `fix/…`, `refactor/…`, `docs/…`, merged into
  `main` by pull request.
- **Commits** are `type: …` followed by a sentence describing the behaviour the change
  gives, in plain prose (`fix: the Card sheet on the table closes back to the view it
  was opened over`). A feature usually lands as separate `feat`, `test` and `docs`
  commits.
- **Docs move with the code, in the same change.** Before calling work done, update
  whichever of these it made wrong — nothing tests them, so a stale doc stays stale
  until somebody notices:
  - [docs/architecture.md](docs/architecture.md): a file added, removed, renamed or
    repurposed gets its line in the tree; a change to the set index or state revision
    gets its prose updated.
  - [docs/features.md](docs/features.md): a user-visible change gets its place under its
    tab, or under General.
  - [README.md](README.md): a new tab or headline feature joins the feature list; a
    change to how the app is run, built or deployed goes in Getting Started.
  - [docs/configuration.md](docs/configuration.md): a new or changed environment
    variable, role rule or data location.
  - [docs/testing.md](docs/testing.md): a new script, test seam or ratchet.
  - This file: a new rule, trap or list that must move together, or one of these
    statements coming untrue. Fix a line here rather than working around it.
  - A large effort gets a record in [docs/records/](docs/records/) once it lands.
- **Large work is planned first**: a spec in `docs/design/` or `docs/plans/`, then
  tickets under `docs/tickets/<effort>/` while it's in flight, retired into a record
  afterwards.
- **Comments explain why**, often at length — match the surrounding density.
- **The Dockerfile** copies every root `*.js` plus `middleware/`, `routes/` and
  `public/`. CI never boots the image, so these ship broken with CI green: a file outside
  what the Dockerfile copies, a new top-level directory, or a runtime dependency put in
  `devDependencies` (the image installs with `--omit=dev`). Every root `*.js` is copied
  into the image, so don't put helper scripts at the root. The build toolchain exists
  only in the builder stage; a dependency needing runtime shared libraries needs an
  `apk add` in the final stage.
- **Scryfall** is only called through `scryfall-queue.js` (under 10 req/s, honouring
  `Retry-After`); card data comes from the local bulk cache first. The daily bulk
  download in `scryfall-db.js` is the one call that bypasses the queue.
- **Local-only files**: `.scratch/` (working notes, screenshot runs, capture data),
  `.claude/` and `docs/agents/` are git-ignored. `*.png` is git-ignored everywhere, so a
  PNG added under `public/` is silently never committed (the offline test passes
  locally, fails in CI) — use WebP or SVG.

## Issues and triage

Issues live in GitHub Issues for `10mmiT/mtgTools`, driven by the `gh` CLI (`gh issue
create / view / list / comment / edit / close`). Pull requests aren't a triage surface.
The triage labels are `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`
and `wontfix`. Fuller skill configuration is in `docs/agents/` where it exists locally.

There's no `CONTEXT.md` glossary or `docs/adr/` yet; if they appear, read them before
working in the area they cover.

## Known gaps

Small issues found but not fixed — not intended design:

- PUT /prefs stores `playmatUrl` without validation.
- `routes/state.js`, `routes/decks.js` and `routes/available.js` decode `req.params` a
  second time, so a '%' in an id gives a 500 (`routes/proxy.js` has the fixed pattern).
- Availability is keyed by player name, so renaming a player orphans their future days;
  "today" is UTC.
- Docs that lag the code: testing.md says "in-memory SQLite" (it's a temp-dir file) and
  doesn't mention that `check:contrast` runs via `themes.test.js`; configuration.md
  lacks `PORT`, `DATA_FILE`, the `APP_PASSWORD` alias and the `ARCHIDEKT_*` variables.
  The comment at the top of `set-index.js` says "~750 browsable sets"; Scryfall lists
  about 320 of the types it indexes (checked October 2026), as architecture.md says.
