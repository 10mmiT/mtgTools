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
  rate-limited queue every Scryfall call goes through, `set-index.js` the background set
  sweep, `collection-import.js` + `archidekt-queue.js` server-side imports,
  `deck-history.js` deck snapshots, `backup.js` daily backups, `playmat-store.js`
  uploaded backgrounds.
- **Client** — `public/index.html` is a single-page shell loading plain `<script>` files
  from `public/js/` that share globals. **Script order in `index.html` matters**: a file
  may only use what an earlier one defined, and tests assert the order. The Deck Builder
  is split across `deckview-*.js`; table mode (experimental, a 3D-table view of the app)
  is `tablemode.js` + `css/table.css`.
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
from `main`. Run all three before calling a change done.

Tests assert behaviour at three seams — HTTP (supertest against a temp database), static
(the token linter), and vm (a shipped browser file loaded into a `vm` context and its
pure functions called). Nothing asserts appearance; tests do assert the page is *wired
up* (handlers exist, scripts are served in the order they need). See
[docs/testing.md](docs/testing.md).

### On Windows

The app is run on Linux, but it's sometimes developed on Windows with
`core.autocrlf=true`, which checks files out with CRLF line endings. Tests that read
source text must normalise `\r\n` to `\n`, compare repository paths with forward slashes
(`path.relative` gives backslashes on Windows), and close any SQLite database before
deleting its temp directory (Windows won't remove an open file). Keep new tests to the
same rules, so the suite passes on both.

## Conventions

- **Branches** are `feat/…`, `fix/…`, `refactor/…`, `docs/…`, merged into
  `main` by pull request.
- **Commits** are `type: …` followed by a sentence describing the behaviour the change
  gives, in plain prose (`fix: the Card sheet on the table closes back to the view it
  was opened over`). A feature usually lands as separate `feat`, `test` and `docs`
  commits.
- **Docs move with the code.** A new module gets its line in the
  [architecture.md](docs/architecture.md) tree; a user-visible change gets its place in
  [features.md](docs/features.md); a large effort gets a record in
  [docs/records/](docs/records/) once it lands.
- **Large work is planned first**: a spec in `docs/design/` or `docs/plans/`, then
  tickets under `docs/tickets/<effort>/` while it's in flight, retired into a record
  afterwards.
- **Comments explain why**, often at length — match the surrounding density.
- **The Dockerfile** copies every root `*.js` plus `middleware/`, `routes/` and
  `public/`. A new top-level directory the server needs must be added to it.
- **Scryfall** is only called through `scryfall-queue.js` (under 10 req/s, honouring
  `Retry-After`); card data comes from the local bulk cache first.
- **Local-only files**: `.scratch/` (working notes, screenshot runs, capture data),
  `.claude/` and `docs/agents/` are git-ignored.

## Issues and triage

Issues live in GitHub Issues for `10mmiT/mtgTools`, driven by the `gh` CLI (`gh issue
create / view / list / comment / edit / close`). Pull requests aren't a triage surface.
The triage labels are `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`
and `wontfix`. Fuller skill configuration is in `docs/agents/` where it exists locally.

There's no `CONTEXT.md` glossary or `docs/adr/` yet; if they appear, read them before
working in the area they cover.
