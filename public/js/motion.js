// ── Card motion ───────────────────────────────────────────────────────────
// Whether cards move. One preference, kept with the person rather than the
// browser, and one override that can only take motion away.
//
// Nothing consumes it yet. It exists first so that everything built on top of
// it has a single place to ask "should this move?", and so that the answer is
// already right on every device before the first thing that moves is written.
//
// Two values reach the page, both on <html>:
//
//   data-motion-pref   what the person asked for — 'on' or 'off'
//   data-motion        what they get: the preference, reduced by the operating
//                      system's prefers-reduced-motion but never raised by it
//
// data-motion is the one to read. CSS matches on it (tokens.css turns it into
// --motion, a 1 or a 0 a duration can be multiplied by) and JS asks
// cardMotionOn(); both are reading the same attribute, so there is no second
// answer to keep in step. The preference is kept beside it because the control
// in the appearance popover shows what was chosen, not what the OS allowed.
//
// Loaded in <head> beside playmat.js, and for the same reason: a page that
// paints, then discovers motion is off, has already moved. localStorage is
// readable synchronously, so boot paints from there and syncCardMotion()
// corrects the guess once the session is known — the two halves initTheme()
// and syncPrefs() split the theme into.
//
// As in playmat.js, nothing at the top level of this file may touch anything
// but <html>: when it runs there is no body yet.

// The browser's copy of the preference. The same 'on'/'off' the server stores
// and `prefs.cardMotion` carries, so one shape travels end to end.
const MOTION_KEY = 'mtgtools_card_motion';

// The operating system's say. It is consulted, never written: the OS setting
// belongs to the OS.
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const MOTION_VALUES = ['on', 'off'];

/* Does this device's owner want less motion from everything, not just from
 * here? matchMedia is guarded because this runs on the first line of the page
 * and a motion preference is not worth an exception there. */
function motionReducedBySystem() {
  try { return !!window.matchMedia && window.matchMedia(MOTION_QUERY).matches; }
  catch { return false; }
}

/* The whole resolution rule, in one place: the OS can take motion away and
 * cannot give it back. An unrecognised preference — a stale localStorage
 * value, a hand-edited one — is treated as the default rather than as 'off',
 * so a bad string cannot quietly switch the app's motion off for good. */
function effectiveCardMotion(pref, systemReduces) {
  const wanted = MOTION_VALUES.includes(pref) ? pref : 'on';
  return systemReduces || wanted === 'off' ? 'off' : 'on';
}

/* Paint it: both attributes, from one preference. */
function applyCardMotion(pref) {
  const root = document.documentElement;
  root.dataset.motionPref = MOTION_VALUES.includes(pref) ? pref : 'on';
  root.dataset.motion     = effectiveCardMotion(pref, motionReducedBySystem());
}

/* What everything later asks. It reads the attribute rather than a variable of
 * its own, so a caller cannot get an answer the stylesheet disagrees with. */
function cardMotionOn() {
  return document.documentElement.dataset.motion !== 'off';
}

function readCardMotion() {
  try {
    const raw = localStorage.getItem(MOTION_KEY);
    return MOTION_VALUES.includes(raw) ? raw : 'on';
  } catch { return 'on'; }
}

function rememberCardMotion(pref) {
  try { localStorage.setItem(MOTION_KEY, MOTION_VALUES.includes(pref) ? pref : 'on'); }
  catch {}
}

// ── Boot ──────────────────────────────────────────────────────────────────
(function cardMotionBoot() {
  applyCardMotion(readCardMotion());

  /* The OS setting can change while the page is open — a system-wide switch
   * flipped in another window, or a "reduce motion during battery saver" rule
   * turning itself on. Re-resolving from the preference already on <html> is
   * what keeps the override live rather than a boot-time reading. */
  try {
    window.matchMedia(MOTION_QUERY).addEventListener('change', () => {
      applyCardMotion(document.documentElement.dataset.motionPref);
      if (typeof renderCardMotionControl === 'function') renderCardMotionControl();
    });
  } catch {}
})();

/* Second half of boot, called from syncPrefs() once there is a session.
 *
 * `prefs.stored` decides which side is the record, as it does for the playmat:
 * with accounts the server holds it and the browser copy is what the next load
 * paints from; in open mode there is nobody to hang it on, so the browser copy
 * is the whole record and is read back into `prefs` — after which the rest of
 * the app reads `prefs` alone and never knows which mode it is in. */
function syncCardMotion() {
  if (prefs.stored) rememberCardMotion(prefs.cardMotion);
  else prefs.cardMotion = readCardMotion();
  applyCardMotion(prefs.cardMotion);
  renderCardMotionControl();
}

// ── Choosing ──────────────────────────────────────────────────────────────
/* Paint first, then persist — savePrefs() merges the patch into `prefs` before
 * it leaves and falls back to keeping it locally when the server will not take
 * it, so the page is already right whether or not the write lands. */
async function setCardMotion(on) {
  const pref = on ? 'on' : 'off';
  applyCardMotion(pref);
  rememberCardMotion(pref);
  renderCardMotionControl();
  await savePrefs({ cardMotion: pref });
  rememberCardMotion(prefs.cardMotion);
  applyCardMotion(prefs.cardMotion);
  renderCardMotionControl();
}

// ── The control ───────────────────────────────────────────────────────────
/* The switch shows the preference, not the effective value: someone whose
 * system asks for reduced motion has not turned this off, and a box that
 * unticked itself would tell them they had. The note below it is what says
 * their system is overriding it — an explanation rather than a control that
 * silently does nothing. */
function renderCardMotionControl() {
  const root   = document.documentElement;
  const toggle = document.getElementById('cardMotionToggle');
  if (toggle) toggle.checked = root.dataset.motionPref !== 'off';
  const note = document.getElementById('cardMotionNote');
  if (note) note.hidden = !(motionReducedBySystem() && root.dataset.motionPref !== 'off');
}

/* Seed `prefs` from the browser copy, which is what boot painted from, so the
 * control is right before the server has answered — syncCardMotion() corrects
 * both together. */
function initCardMotionControl() {
  prefs.cardMotion = readCardMotion();
  renderCardMotionControl();
}
