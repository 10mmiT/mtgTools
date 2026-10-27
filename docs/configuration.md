# Configuration & deployment

Setup basics live in the [README](../README.md#getting-started); this covers user accounts, environment variables, and where data lives.

## User accounts

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
| Manage collections | ✓ (own, and the group's — a collection with no owner) | ✓ |
| Manage decks | ✓ (own) | ✓ |
| Admin panel / user management | — | ✓ |

## Container reference

| Setting | Value |
|---------|-------|
| Container port | `3000` |
| Health check | `GET /healthz` → `{ ok: true, uptime: … }` (also wired into the Dockerfile `HEALTHCHECK`) |
| Data path (inside container) | `/app/data` |
| `ADMIN_PASSWORD` | Required to enable auth; omit for open mode |
| `APP_PASSWORD` | Older name for `ADMIN_PASSWORD`, still read when that one is unset. Prefer `ADMIN_PASSWORD` |
| `PORT` | Port the server listens on (default `3000`). The Dockerfile's `EXPOSE` and `HEALTHCHECK` assume 3000, so change the host side of the port mapping instead when running the image |
| `DATA_FILE` | Path to a `state.json` whose *directory* becomes the data directory (default `data/state.json` beside the server). `available.db`, `scryfall.db`, `playmats/` and `backups/` all live there. The file itself is read only once, to migrate data from the app's oldest versions, and need not exist. Mostly for tests and scripts pointing the app at a copy of the data |
| `RSS_FEEDS` | Optional comma-separated RSS/Atom feed URLs for the RSS panel |
| `MTGTOOLS_NO_BACKGROUND` | Set to `1` to skip the background jobs — the two Scryfall ones (the daily bulk download and the set-index sweep) and the daily backup. For tests and offline runs; the app then serves whatever the Scryfall jobs last cached, and takes no backups |
| `MTGTOOLS_BACKUP_DAYS` | How many daily backups of `available.db` to keep (default `7`); `0` turns the backup off |
| `COOKIE_SECURE` | Set to `1` to add the `Secure` flag to session cookies — recommended when running behind HTTPS |
| `TRUST_PROXY` | Set when running behind a reverse proxy, so the rate limits see each client's address instead of the proxy's. Takes Express's `trust proxy` values: a hop count (`1`), `true`, or names and subnets (`loopback`, `10.0.0.0/8`, comma-separated). Leave unset when the app is reached directly — trusting `X-Forwarded-For` from clients lets them choose their own address |
| `AUTH_RATE_LIMIT_MAX` | Override the login rate-limit window max (default: 30 requests per 15 min per IP) |
| `UPLOAD_RATE_LIMIT_MAX` | Override the playmat-upload rate-limit window max (default: 20 uploads per 15 min per IP) |
| `ARCHIDEKT_MIN_INTERVAL_MS` | Archidekt import pacing: the normal gap between requests (default `1000`, one a second). Archidekt publishes no limit; about 80 requests a minute was measured, so the defaults have margin and rarely need changing |
| `ARCHIDEKT_MAX_INTERVAL_MS` | The slowest the pacing widens to after Archidekt answers 429 (default `4000`) |
| `ARCHIDEKT_BACKOFF_MS` | First wait before retrying a 429, doubling per attempt up to a minute (default `10000`) |
| `ARCHIDEKT_RECOVER_MS` | How long Archidekt must go without a 429 before the pacing drops back to normal (default `600000`, ten minutes) |

Map `/app/data` to a persistent location on your host (e.g. `/mnt/user/appdata/mtgtools` on Unraid) so all data survives container restarts. All app data — collections, players, decks, want lists, availability, and user accounts — is stored in `available.db` (SQLite). Uploaded playmat backgrounds are the one thing kept outside it, as files under `data/playmats/` — one per user, at most 5 MB each, deleted when the user replaces the image or the account goes. A second database, `scryfall.db`, holds the local Scryfall bulk-data cache: on first startup the server downloads Scryfall's `oracle_cards` file (~24 MB gzipped, ~38k cards) in the background and refreshes it daily — watch for `[scryfall-db] imported … cards` in the log. It costs about 95 MB on disk. The app works during/without the download; card lookups just fall back to live (proxied) Scryfall until it completes. An upgrade that changes what the cache keeps per card re-downloads the file once even though Scryfall has published nothing new — `[scryfall-db] cached card shape is v… — re-importing` in the log is that, and it needs nothing from you. Set `ADMIN_PASSWORD` as an environment variable directly in your container manager if you're not using `docker compose`.

### Backups

Once a day the server copies `available.db` to `data/backups/available-YYYY-MM-DD.db` and deletes all but the newest seven (`MTGTOOLS_BACKUP_DAYS` changes the count). It uses SQLite's online backup, so the copy is consistent while the app is serving, and it is taken at startup and checked hourly after that — a server restarted several times a day still makes one a day. `scryfall.db` is not backed up; it is a cache that the next refresh rebuilds. Playmat images under `data/playmats/` aren't backed up either.

To restore one, stop the container, replace `data/available.db` with the backup (and delete any `available.db-wal` and `available.db-shm` beside it), then start the container again. These copies sit on the same disk as the database, so they don't protect you if the disk fails: include `data/backups/` in whatever backs up the host.

### Container user and restarts

The container runs as the unprivileged `node` user, uid 1000, so the host folder mapped to `/app/data` must be writable by that uid: `chown -R 1000:1000` it once. On Unraid, where appdata belongs to `nobody:users`, run the container with `--user 99:100` (Extra Parameters in the template) and `chown -R 99:100 /mnt/user/appdata/mtgtools` instead. `docker-compose.yml` sets `restart: unless-stopped`; set the same restart policy in your container manager if you're not using it.
