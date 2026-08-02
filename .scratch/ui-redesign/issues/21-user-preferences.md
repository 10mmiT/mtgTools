# 21 — User preferences: schema, API, theme persistence

**What to build:** Appearance stops being per-browser and starts belonging to a person. Today the theme is stored only in the browser, so it must be set again on every device.

A preferences record per user, read and updated over the API, holding the theme and — later — the playmat. The client persistence layer **already implements exactly the pattern needed** (server database with automatic local fallback); reuse it rather than building a second one.

When the app runs without an administrator password there are no user accounts at all, so preferences fall back to browser storage and everything still works.

Schema, which encodes the decision more precisely than prose:

```sql
CREATE TABLE IF NOT EXISTS user_prefs (
  username     TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
  theme        TEXT    NOT NULL DEFAULT 'dark',
  playmat_kind TEXT    NOT NULL DEFAULT 'none',   -- none | scryfall | preset | upload
  playmat_ref  TEXT,
  playmat_url  TEXT,
  updated_at   INTEGER NOT NULL
);
```

Preferences are a separate table rather than columns on the user record, because they have a different lifetime and concern.

The key is `username`, not the `user_id INTEGER REFERENCES users(id)` this issue was written with: the `users` table has no integer id — `username` is its primary key, and it is what a session carries. Same decision, spelled in this schema's own terms.

**Blocked by:** None — can start immediately, independent of the visual redesign.

**Status:** done

- [x] Setting a theme on one device shows it on another after signing in
- [x] Reading preferences for a user who has never set any returns defaults
- [x] An invalid playmat kind is rejected
- [x] One user cannot read or modify another user's preferences
- [x] In open mode, preferences persist locally and nothing errors
- [x] Deleting a user removes their preferences
- [x] Tests are written at the existing request/response seam

**How it landed**

- `user_prefs` in [available-db.js](available-db.js), created in the same `CREATE TABLE IF NOT EXISTS` block as every other table. `foreign_keys` is already ON, so deleting a user takes the row with it.
- [routes/prefs.js](routes/prefs.js): `GET /api/prefs` and `PUT /api/prefs`, both for the current session's user and no one else's — there is no path parameter to name another user with, so one user being unable to read another's is structural. `PUT` is a patch, so setting a theme cannot clear a playmat. Theme and playmat kind are both validated; the retired `forest` id maps to `dusk` on write, as it does on the client.
- Every response carries `stored`, which answers "is the server the record?". It is false in open mode and after any failure, and that is what tells the client to fall back to `localStorage` — without it, open mode could not tell a genuine `dark` from a server with nowhere to keep the choice, and would reset the theme on every load.
- The client reuses the storage pattern in [state.js](public/js/state.js) rather than adding a second one: `loadPrefs`/`savePrefs` sit beside `loadFromStorage`/`saveToStorage`. Boot is in two halves — [main.js](public/js/main.js) paints from `localStorage` before the session is known, then `syncPrefs()` corrects it from the server. Waiting for the fetch would show the wrong theme on every load.
- `?theme=` still wins over both, and is now written through to the server as well: a stored theme that follows you between devices is one you cannot escape by clearing site data, so the recovery link has to reach the server too.
- Tests: a `/api/prefs` block in [test/server.test.js](test/server.test.js), plus [test/prefs-open-mode.test.js](test/prefs-open-mode.test.js) — its own file because open mode is decided once, when the middleware reads the environment at require time, and `node:test` gives each file its own process.

**Left for the playmat issues (22, 23)**

The `playmat_*` columns are written and validated here, but nothing reads them yet: `POST`/`DELETE /api/prefs/playmat`, `GET /playmat/:userId`, upload sniffing and the rendering layers all belong to those issues.
