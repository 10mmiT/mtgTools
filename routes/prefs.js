'use strict';
const express = require('express');
const { db }  = require('../available-db');
const { OPEN_MODE, getSession, requireAuth } = require('../middleware/auth');

const router = express.Router();

// The five theme ids, mirrored from THEMES in public/js/main.js (and the
// alias map beside it — 'forest' was retired when the themes were repainted).
// Mirrored rather than shared because the client list is a browser global in a
// page script, with no module boundary to import across. Validating here is
// what keeps a bad value from becoming a data-theme no stylesheet matches on
// every device the user signs in on, rather than just the one that set it.
const THEMES        = ['dark', 'light', 'contrast', 'sepia', 'dusk'];
const THEME_ALIASES = { forest: 'dusk' };
const PLAYMAT_KINDS = ['none', 'scryfall', 'preset', 'upload'];

// What a user who has never set anything has. Also what open mode always
// reports: with no ADMIN_PASSWORD there are no accounts, so there is nobody to
// hang a preference on and the browser is the whole record.
const DEFAULTS = { theme: 'dark', playmatKind: 'none', playmatRef: null, playmatUrl: null };

function rowToPrefs(row) {
  return {
    theme:       row.theme,
    playmatKind: row.playmat_kind,
    playmatRef:  row.playmat_ref,
    playmatUrl:  row.playmat_url,
  };
}

function readPrefs(username) {
  const row = db.prepare('SELECT * FROM user_prefs WHERE username = ?').get(username);
  return row ? rowToPrefs(row) : { ...DEFAULTS };
}

// `stored` is the client's answer to "is the server the record?". It is false
// in open mode and after any failure, and that is the signal to fall back to
// localStorage — without it the client cannot tell a genuine 'dark' from a
// server that has nowhere to keep the choice, and open mode would silently
// reset the theme on every load.
const withStored = (prefs, stored) => ({ ...prefs, stored });

// ── GET /api/prefs ─────────────────────────────────────────────────────────────
// The current user's, always. There is no path parameter to point at someone
// else's, which is what makes one user unable to read another's.
router.get('/prefs', requireAuth, (req, res) => {
  if (OPEN_MODE) return res.json(withStored(DEFAULTS, false));
  const sess = getSession(req);
  try {
    res.json(withStored(readPrefs(sess.username), true));
  } catch (e) {
    console.error('GET /api/prefs error:', e.message);
    res.json(withStored(DEFAULTS, false));
  }
});

// ── PUT /api/prefs ─────────────────────────────────────────────────────────────
// A patch, despite the verb the spec names it by: a body may carry the theme,
// the playmat, or both, and what it leaves out is left alone. Sending the whole
// record for a one-field change would mean the appearance popover could undo a
// playmat by picking a theme.
router.put('/prefs', requireAuth, express.json(), (req, res) => {
  const body = req.body || {};
  const next = OPEN_MODE ? { ...DEFAULTS } : readPrefs(getSession(req).username);

  if ('theme' in body) {
    const theme = THEME_ALIASES[body.theme] || body.theme;
    if (!THEMES.includes(theme)) return res.status(400).json({ error: 'Invalid theme' });
    next.theme = theme;
  }

  if ('playmatKind' in body) {
    if (!PLAYMAT_KINDS.includes(body.playmatKind))
      return res.status(400).json({ error: 'Invalid playmat kind' });
    next.playmatKind = body.playmatKind;
    // A mat of no kind has nothing to point at, so clearing the kind clears
    // the reference with it rather than leaving a dangling url behind.
    if (next.playmatKind === 'none') { next.playmatRef = null; next.playmatUrl = null; }
  }
  if (next.playmatKind !== 'none') {
    if ('playmatRef' in body) next.playmatRef = body.playmatRef || null;
    if ('playmatUrl' in body) next.playmatUrl = body.playmatUrl || null;
  }

  // Open mode accepts and validates the same body, and stores nothing: the
  // client keeps it in localStorage. Rejecting the write instead would make
  // every appearance change in open mode an error the user has to read past.
  if (OPEN_MODE) return res.json(withStored(next, false));

  try {
    db.prepare(`
      INSERT INTO user_prefs (username, theme, playmat_kind, playmat_ref, playmat_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        theme = excluded.theme, playmat_kind = excluded.playmat_kind,
        playmat_ref = excluded.playmat_ref, playmat_url = excluded.playmat_url,
        updated_at = excluded.updated_at
    `).run(getSession(req).username, next.theme, next.playmatKind,
      next.playmatRef, next.playmatUrl, Date.now());
    res.json(withStored(next, true));
  } catch (e) {
    console.error('PUT /api/prefs error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
