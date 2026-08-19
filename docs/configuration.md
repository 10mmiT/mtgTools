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
| Manage collections & decks | ✓ (own) | ✓ |
| Admin panel / user management | — | ✓ |

## Container reference

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
