// ── Playmat ───────────────────────────────────────────────────────────────
// The background the app is played on: the art crop of a card the user chose.
//
// This is the one script loaded in <head> rather than at the end of <body>.
// A background applied after first paint is a background the user watches
// appear, and the preference that decides it lives on the server, a fetch
// away. localStorage is readable synchronously, so boot paints from there and
// syncPlaymat() corrects the guess once the session is known — the same two
// halves initTheme()/syncPrefs() split the theme into, for the same reason.
//
// Because of that, nothing at the top level of this file may touch anything
// but <html>: when it runs there is no body yet, and no other script has
// loaded. Everything below the boot call is called from an event handler or
// from main.js, by which time the whole app is present.

// The browser's copy of the preference: {playmatKind, playmatRef, playmatUrl},
// the same keys `prefs` uses in state.js, so one shape travels end to end.
const PLAYMAT_KEY = 'mtgtools_playmat';

// Whether this device shows a playmat below the mobile breakpoint. Kept per
// browser rather than per user, unlike everything else here: it is a statement
// about this device's data plan and screen, not about taste, and a phone
// should not inherit the answer given on a desktop.
const PLAYMAT_MOBILE_KEY = 'mtgtools_playmat_mobile';

// Scryfall's image CDN. Card art is loaded from it directly, as every other
// card image in the app is — the proxy in routes/scryfall-proxy.js carries the
// JSON that names this URL, not the bytes behind it.
const PLAYMAT_ART_HOST = 'cards.scryfall.io';

/* A playmat URL is written into a CSS url(), so it is checked against the two
 * origins this app can produce one from: Scryfall's image CDN, and its own
 * /playmat/ route (issue 23's uploads). Anything else is refused rather than
 * rendered — including a value crafted to close the url() and start a
 * declaration of its own. The check belongs here, at the point the string
 * becomes CSS, rather than at the point it is stored. */
function playmatUrlOk(raw) {
  if (typeof raw !== 'string' || !raw) return false;
  let url;
  try { url = new URL(raw, location.href); } catch { return false; }
  if (url.origin === location.origin) return url.pathname.startsWith('/playmat/');
  return url.protocol === 'https:' && url.hostname === PLAYMAT_ART_HOST;
}

/* Paint it. Two things reach the stylesheet: --playmat-src, which is the
 * image, and data-playmat, which is the switch every rule in the playmat
 * block of layout.css hangs off — including the veil, which must not appear
 * when there is no art under it to veil. */
function applyPlaymat(mat) {
  const root = document.documentElement;
  const kind = mat?.playmatKind;
  if (kind && kind !== 'none' && playmatUrlOk(mat.playmatUrl)) {
    // The URL object's own serialisation, which percent-encodes the quote and
    // the whitespace that could break out of the url() above.
    root.style.setProperty('--playmat-src', `url("${new URL(mat.playmatUrl, location.href).href}")`);
    root.dataset.playmat = kind;
  } else {
    root.style.removeProperty('--playmat-src');
    delete root.dataset.playmat;
  }
}

function readPlaymat() {
  try { return JSON.parse(localStorage.getItem(PLAYMAT_KEY) || 'null') || {}; }
  catch { return {}; }
}

function rememberPlaymat(mat) {
  try {
    localStorage.setItem(PLAYMAT_KEY, JSON.stringify({
      playmatKind: mat.playmatKind || 'none',
      playmatRef:  mat.playmatRef  || null,
      playmatUrl:  mat.playmatUrl  || null,
    }));
  } catch {}
}

// ── Boot ──────────────────────────────────────────────────────────────────
// Runs on the way past, before the body is parsed. localStorage may be
// unreadable (private mode, storage disabled); a playmat is not worth an
// exception on the first line of the page, so every read here is guarded.
(function playmatBoot() {
  let onMobile = false;
  try { onMobile = localStorage.getItem(PLAYMAT_MOBILE_KEY) === '1'; } catch {}
  if (onMobile) document.documentElement.dataset.playmatMobile = '';
  applyPlaymat(readPlaymat());
})();

/* Second half of boot, called from syncPrefs() once there is a session.
 *
 * `prefs.stored` is what decides which side is the record. With accounts the
 * server holds it and the browser copy is a cache to paint from next time;
 * in open mode there is nobody to hang a preference on, so the browser copy
 * is the whole record and is read back into `prefs` — after which the rest of
 * the app can read `prefs` alone and never know which mode it is in. */
function syncPlaymat() {
  if (prefs.stored) rememberPlaymat(prefs);
  else Object.assign(prefs, readPlaymat());
  applyPlaymat(prefs);
  renderPlaymatPicker();
}

// ── Choosing one ──────────────────────────────────────────────────────────
/* The art crop, not the full card: it is the artwork without the frame or the
 * text box, which is precisely what a playmat is. It comes from the image
 * cache in scryfall.js — the same cache the grids and the hover preview fill,
 * so a card already on screen costs nothing to set as the mat.
 *
 * playmat_ref holds the card's name and not its Scryfall id, which is what
 * the schema comment suggests. The name is this app's identifier for a card:
 * every cache in scryfall.js is keyed by it, the picker searches by it, and
 * it is what the popover has to print back. An id would have to be resolved
 * to a name before it could be shown, over the network, on every load. */
async function setPlaymatCard(name) {
  const note = document.getElementById('playmatCurrent');
  if (note) note.textContent = `Finding ${name}…`;
  await ensureScryfallImages([name]);
  const url = scryfallArtCache.get(name);
  if (!url) {
    if (note) note.textContent = `No artwork found for ${name}.`;
    return;
  }
  await savePlaymat({ playmatKind: 'scryfall', playmatRef: name, playmatUrl: url });
}

function removePlaymat() {
  return savePlaymat({ playmatKind: 'none', playmatRef: null, playmatUrl: null });
}

/* Paint first, then persist. savePrefs() merges the patch into `prefs` before
 * it leaves, and falls back to keeping it locally when the server will not
 * take it — so the mat is already correct on screen whether or not the write
 * lands, and the browser copy is written either way. */
async function savePlaymat(patch) {
  applyPlaymat(patch);
  rememberPlaymat(patch);
  renderPlaymatPicker();
  await savePrefs(patch);
  rememberPlaymat(prefs);
  renderPlaymatPicker();
}

/* The per-device switch. Below 900px the mat is off unless this is set; the
 * rule that enforces it is a media query in layout.css, so switching it here
 * is one attribute and the browser does the rest — including not fetching the
 * image at all while it is off, which is the point of the default. */
function togglePlaymatOnMobile(on) {
  const root = document.documentElement;
  try {
    if (on) localStorage.setItem(PLAYMAT_MOBILE_KEY, '1');
    else    localStorage.removeItem(PLAYMAT_MOBILE_KEY);
  } catch {}
  if (on) root.dataset.playmatMobile = '';
  else    delete root.dataset.playmatMobile;
}

// ── Picker ────────────────────────────────────────────────────────────────
// Deliberately without a thumbnail: the mat is the page behind the popover,
// which is a better preview than any 40px square, and a thumbnail would fetch
// the full art crop on the one device the default exists to spare.
function renderPlaymatPicker() {
  const note = document.getElementById('playmatCurrent');
  if (note) {
    const kind = prefs.playmatKind;
    if (!kind || kind === 'none') {
      note.textContent = 'None — the page keeps its plain background.';
    } else {
      note.innerHTML =
        `<span class="playmat-current-name">${esc(prefs.playmatRef || 'Custom image')}</span>` +
        `<button class="playmat-remove" onclick="removePlaymat()">Remove</button>`;
    }
  }
  const toggle = document.getElementById('playmatMobileToggle');
  if (toggle) toggle.checked = document.documentElement.hasAttribute('data-playmat-mobile');
}

/* The picker is the Want List's card field, mounted a second time — see
 * mountCardAutocomplete() in sortui.js. The input is cleared on pick because
 * the chosen card is reported by the line above it, not by the search box. */
function initPlaymatPicker() {
  mountCardAutocomplete('playmatCardInput', 'playmatAcDrop', name => {
    document.getElementById('playmatCardInput').value = '';
    setPlaymatCard(name);
  });
  // Seed `prefs` from the browser copy, which is what boot painted from. The
  // server has not answered yet — syncPlaymat() will correct both together —
  // and without this the popover would name no playmat for as long as that
  // takes, while one is on screen behind it.
  Object.assign(prefs, readPlaymat());
  renderPlaymatPicker();
}
