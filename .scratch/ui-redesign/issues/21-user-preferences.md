# 21 — User preferences: schema, API, theme persistence

**What to build:** Appearance stops being per-browser and starts belonging to a person. Today the theme is stored only in the browser, so it must be set again on every device.

A preferences record per user, read and updated over the API, holding the theme and — later — the playmat. The client persistence layer **already implements exactly the pattern needed** (server database with automatic local fallback); reuse it rather than building a second one.

When the app runs without an administrator password there are no user accounts at all, so preferences fall back to browser storage and everything still works.

Schema, which encodes the decision more precisely than prose:

```sql
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme         TEXT    NOT NULL DEFAULT 'dark',
  playmat_kind  TEXT    NOT NULL DEFAULT 'none',   -- none | scryfall | preset | upload
  playmat_ref   TEXT,
  playmat_url   TEXT,
  updated_at    INTEGER NOT NULL
);
```

Preferences are a separate table rather than columns on the user record, because they have a different lifetime and concern.

**Blocked by:** None — can start immediately, independent of the visual redesign.

**Status:** ready-for-agent

- [ ] Setting a theme on one device shows it on another after signing in
- [ ] Reading preferences for a user who has never set any returns defaults
- [ ] An invalid playmat kind is rejected
- [ ] One user cannot read or modify another user's preferences
- [ ] In open mode, preferences persist locally and nothing errors
- [ ] Deleting a user removes their preferences
- [ ] Tests are written at the existing request/response seam
