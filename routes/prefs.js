'use strict';
const express  = require('express');
const { db }   = require('../available-db');
const { OPEN_MODE, getSession, requireAuth } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/limits');
const playmats = require('../playmat-store');

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

// Whether cards move. Two values and not a boolean, for the reason the theme
// is a name: the effective value the client puts on <html> is the preference
// resolved against the operating system, and 'off' is a word both sides can
// write down. Validated here for the same reason a theme is — a value no
// stylesheet matches would otherwise follow the user onto every device.
const CARD_MOTION = ['on', 'off'];

// What a user who has never set anything has. Also what open mode always
// reports: with no ADMIN_PASSWORD there are no accounts, so there is nobody to
// hang a preference on and the browser is the whole record.
const DEFAULTS = {
  theme: 'dark', playmatKind: 'none', playmatRef: null, playmatUrl: null, cardMotion: 'on',
};

function rowToPrefs(row) {
  return {
    theme:       row.theme,
    playmatKind: row.playmat_kind,
    playmatRef:  row.playmat_ref,
    playmatUrl:  row.playmat_url,
    // A row written before the column existed reads back null, which is not a
    // value the client knows. The default covers it, exactly as it covers a
    // user who has no row at all.
    cardMotion:  row.card_motion || DEFAULTS.cardMotion,
  };
}

function readPrefs(username) {
  const row = db.prepare('SELECT * FROM user_prefs WHERE username = ?').get(username);
  return row ? rowToPrefs(row) : { ...DEFAULTS };
}

function writePrefs(username, prefs) {
  db.prepare(`
    INSERT INTO user_prefs
      (username, theme, playmat_kind, playmat_ref, playmat_url, card_motion, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      theme = excluded.theme, playmat_kind = excluded.playmat_kind,
      playmat_ref = excluded.playmat_ref, playmat_url = excluded.playmat_url,
      card_motion = excluded.card_motion,
      updated_at = excluded.updated_at
  `).run(username, prefs.theme, prefs.playmatKind,
    prefs.playmatRef, prefs.playmatUrl, prefs.cardMotion, Date.now());
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
// the playmat, card motion, or any combination, and what it leaves out is left
// alone. Sending the whole record for a one-field change would mean the
// appearance popover could undo a playmat by picking a theme.
router.put('/prefs', requireAuth, express.json(), (req, res) => {
  const body = req.body || {};
  const next = OPEN_MODE ? { ...DEFAULTS } : readPrefs(getSession(req).username);
  const priorKind = next.playmatKind;

  if ('theme' in body) {
    const theme = THEME_ALIASES[body.theme] || body.theme;
    if (!THEMES.includes(theme)) return res.status(400).json({ error: 'Invalid theme' });
    next.theme = theme;
  }

  if ('cardMotion' in body) {
    if (!CARD_MOTION.includes(body.cardMotion))
      return res.status(400).json({ error: 'Invalid card motion' });
    next.cardMotion = body.cardMotion;
  }

  if ('playmatKind' in body) {
    if (!PLAYMAT_KINDS.includes(body.playmatKind))
      return res.status(400).json({ error: 'Invalid playmat kind' });
    // 'upload' is a kind the server writes, never one a client asks for: it
    // means "there is a file on disk for this user", and only POST below can
    // make that true. Accepting it here would let a client claim an upload it
    // never made, with a playmat_url of its own choosing.
    if (body.playmatKind === 'upload')
      return res.status(400).json({ error: 'An uploaded playmat is set by uploading one' });
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

  const username = getSession(req).username;
  try {
    writePrefs(username, next);
    // Switching away from an upload — to a card, or to nothing — is the other
    // way a playmat file stops being the current one, and it has to take the
    // file with it. Otherwise "one playmat per person" would hold only for
    // people who replace an upload with another upload.
    if (priorKind === 'upload' && next.playmatKind !== 'upload') playmats.remove(username);
    res.json(withStored(next, true));
  } catch (e) {
    console.error('PUT /api/prefs error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/prefs/playmat ───────────────────────────────────────────────────
// Bring your own image. This is the only route in the application that turns a
// request body into a file it will later serve back on its own origin, so the
// order below is the point of the whole endpoint: authenticate, then rate
// limit, then refuse open mode, then read at most 5 MB, then look at the bytes
// — and only after all of that is anything written.

// Open mode has no accounts, so there is nobody to attach a file to. Refused
// before the body is read, and with a sentence that says why rather than a
// bare 403 — the popover replaces the control with that same sentence, for
// the same reason: an explanation beats a control that is simply not there.
function requireAccounts(req, res, next) {
  if (!OPEN_MODE) return next();
  res.status(403).json({
    error: 'Playmat uploads need an account. This server runs without an administrator '
         + 'password, so there is nobody to store a file for. A card’s artwork still works.',
  });
}

/* The body is the image itself, not a multipart form field.
 *
 * §10.3 of the design specified multipart/form-data, which is what an HTML
 * form would send; nothing here is an HTML form. Sending the bytes on their
 * own removes a parser — and with it the filename, the boundary and the part
 * headers, which are three attacker-controlled inputs this route would
 * otherwise have to be careful about and now cannot receive at all. The
 * declared Content-Type is still accepted from the client and still ignored:
 * `type: () => true` means it does not select the parser, so a lie about it
 * changes nothing except which error the sniffing below produces.
 *
 * `limit` is enforced by the body reader as the request streams, and against
 * Content-Length before a byte of it arrives. Either way the 5 MB ceiling is
 * reached without a file being opened. */
const readImageBody = express.raw({ type: () => true, limit: playmats.MAX_BYTES });

function readImage(req, res, next) {
  readImageBody(req, res, err => {
    if (!err) return next();
    if (err.type === 'entity.too.large')
      return res.status(413).json({
        error: `That image is too large — the limit is ${playmats.MAX_MB} MB.`,
      });
    console.error('POST /api/prefs/playmat body error:', err.message);
    res.status(400).json({ error: 'Could not read the uploaded image.' });
  });
}

router.post('/prefs/playmat', requireAuth, uploadLimiter, requireAccounts, readImage, (req, res) => {
  const username = getSession(req).username;
  const buf      = req.body;

  if (!Buffer.isBuffer(buf) || buf.length === 0)
    return res.status(400).json({ error: 'No image was sent.' });

  // The file's own leading bytes decide what it is. A .png extension, a
  // Content-Type of image/png and an SVG's bytes all arrive together in the
  // same request; only the last of the three is not chosen by whoever sent it.
  const format = playmats.sniff(buf);
  if (!format)
    return res.status(415).json({
      error: `That file is not a ${playmats.ACCEPTED} image. Vector images (SVG) cannot be `
           + 'used as a playmat, because they can carry script.',
    });

  try {
    const saved = playmats.save(username, buf, format);
    const next  = readPrefs(username);
    next.playmatKind = 'upload';
    next.playmatRef  = saved.name;
    next.playmatUrl  = playmats.urlFor(username, saved.version);
    writePrefs(username, next);
    res.json(withStored(next, true));
  } catch (e) {
    console.error('POST /api/prefs/playmat error:', e.message);
    // Don't leave a file behind that no preference row points at.
    try { playmats.remove(username); } catch {}
    res.status(500).json({ error: 'Could not store the image.' });
  }
});

// ── DELETE /api/prefs/playmat ─────────────────────────────────────────────────
// Take the mat off, whatever kind it is. The preference and the file go
// together — a file with no row pointing at it is storage nobody can reach,
// and a row pointing at a file that is gone is a broken background.
router.delete('/prefs/playmat', requireAuth, (req, res) => {
  if (OPEN_MODE) return res.json(withStored({ ...DEFAULTS }, false));

  const username = getSession(req).username;
  try {
    const next = { ...readPrefs(username), playmatKind: 'none', playmatRef: null, playmatUrl: null };
    writePrefs(username, next);
    playmats.remove(username);
    res.json(withStored(next, true));
  } catch (e) {
    console.error('DELETE /api/prefs/playmat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
