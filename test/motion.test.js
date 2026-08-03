/* The card-motion preference: the resolution rule, and the CSS that reads it.
 *
 * The preference's round trip is HTTP behaviour and is asserted where the
 * other preferences are — test/server.test.js and test/prefs-open-mode.test.js
 * drive the real endpoint. What is left is the half no request can see: the
 * operating system's override, which is resolved in the browser and can only
 * ever take motion away.
 *
 * That half is asserted twice over, because it is claimed twice over. The
 * shipped public/js/motion.js is run against stub browser globals, the way
 * test/playmat.test.js runs the playmat boot script; and the delivered
 * stylesheet is read for the same promise, because a page whose script never
 * ran must still honour a system that asks for less motion.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── The boot script ───────────────────────────────────────────────────

/** Run the shipped motion.js in a sandbox that looks enough like a browser at
 *  <head> time: an <html> element, storage, and a media query with an answer
 *  of the test's choosing. */
function loadMotion({ stored = null, systemReduces = false, breakStorage = false } = {}) {
  const store = new Map();
  if (stored !== null) store.set('mtgtools_card_motion', String(stored));

  const root = { dataset: {} };
  const listeners = [];

  const storage = {
    getItem:    k => (store.has(k) ? store.get(k) : null),
    setItem:    (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  if (breakStorage) {
    storage.getItem = () => { throw new Error('storage is disabled'); };
    storage.setItem = () => { throw new Error('storage is disabled'); };
  }

  const media = {
    matches: systemReduces,
    addEventListener: (_type, fn) => listeners.push(fn),
  };

  const sandbox = {
    document: { documentElement: root, getElementById: () => null },
    localStorage: storage,
    window: { matchMedia: query => (query.includes('reduced-motion') ? media : { matches: false }) },
  };
  sandbox.window.matchMedia = sandbox.window.matchMedia.bind(sandbox.window);

  vm.createContext(sandbox);
  vm.runInContext(read('public/js/motion.js'), sandbox);

  return {
    evaluate: expr => vm.runInContext(expr, sandbox),
    effective: () => root.dataset.motion,
    preference: () => root.dataset.motionPref,
    stored: () => store.get('mtgtools_card_motion'),
    /** The OS setting changing while the page is open. */
    systemChangesTo(reduces) { media.matches = reduces; listeners.forEach(fn => fn(media)); },
  };
}

test('cards move for someone who has never said otherwise', () => {
  const app = loadMotion();
  assert.strictEqual(app.effective(), 'on');
  assert.strictEqual(app.preference(), 'on');
});

test('a stored preference is on the page before anything else has run', () => {
  const app = loadMotion({ stored: 'off' });
  assert.strictEqual(app.effective(), 'off',
    'the boot script paints from localStorage, since the session is not known yet');
  assert.strictEqual(app.preference(), 'off');
});

test('the system can take motion away', () => {
  const app = loadMotion({ stored: 'on', systemReduces: true });
  assert.strictEqual(app.effective(), 'off');
  assert.strictEqual(app.preference(), 'on',
    'the preference is untouched — the system overrode it, it did not change it');
});

test('the system cannot give motion back', () => {
  // The case the rule exists for: a person who turned motion off here, on a
  // machine whose OS has nothing to say about it.
  const app = loadMotion({ stored: 'off', systemReduces: false });
  assert.strictEqual(app.effective(), 'off');
});

test('the resolution is a function of its two inputs, all four ways', () => {
  const app = loadMotion();
  const resolve = (pref, sys) =>
    app.evaluate(`effectiveCardMotion(${JSON.stringify(pref)}, ${sys})`);
  assert.strictEqual(resolve('on',  false), 'on');
  assert.strictEqual(resolve('on',  true),  'off');
  assert.strictEqual(resolve('off', false), 'off');
  assert.strictEqual(resolve('off', true),  'off');
});

test('a value that is not a preference is read as the default, not as off', () => {
  // A stale or hand-edited storage entry should not be able to switch motion
  // off for good in a way no control can undo.
  for (const junk of ['', 'true', 'ON', '{"cardMotion":"off"}']) {
    const app = loadMotion({ stored: junk });
    assert.strictEqual(app.effective(), 'on', `${JSON.stringify(junk)} is not "off"`);
    assert.strictEqual(app.preference(), 'on');
  }
});

test('unreadable storage is not a broken page', () => {
  const app = loadMotion({ breakStorage: true });
  assert.strictEqual(app.effective(), 'on', 'private mode still gets an answer');
  assert.doesNotThrow(() => app.evaluate('rememberCardMotion("off")'),
    'and writing one back cannot throw on the first line of the page');
});

test('JS reads the effective value off the same attribute CSS matches on', () => {
  const on = loadMotion();
  assert.strictEqual(on.evaluate('cardMotionOn()'), true);

  const off = loadMotion({ stored: 'off' });
  assert.strictEqual(off.evaluate('cardMotionOn()'), false);

  // Overridden by the system, the answer JS gives has to be the one the
  // stylesheet gives — which is what reading the attribute rather than a
  // variable of its own buys.
  const overridden = loadMotion({ stored: 'on', systemReduces: true });
  assert.strictEqual(overridden.evaluate('cardMotionOn()'), false);
});

test('the override is live, not a reading taken at boot', () => {
  const app = loadMotion({ stored: 'on' });
  assert.strictEqual(app.effective(), 'on');

  app.systemChangesTo(true);
  assert.strictEqual(app.effective(), 'off', 'the system asked for less mid-session');

  app.systemChangesTo(false);
  assert.strictEqual(app.effective(), 'on',
    'and the preference underneath it is still what it was');
});

test('the browser copy is written so the next load paints it', () => {
  const app = loadMotion();
  app.evaluate('rememberCardMotion("off")');
  assert.strictEqual(app.stored(), 'off');
  assert.strictEqual(loadMotion({ stored: app.stored() }).effective(), 'off');
});

// ── The stylesheet ────────────────────────────────────────────────────
// The other half of "readable from CSS and from JS". These assert on the
// delivered tokens.css, because that is what a browser is served.

const tokens = () => read('public/css/tokens.css');

test('the effective value is a token CSS can multiply a duration by', () => {
  const css = tokens();
  assert.match(css, /--motion:\s*1/, 'the default: cards may move');
  assert.match(css, /:root\[data-motion=['"]off['"]\]\s*\{[^}]*--motion:\s*0/,
    'and the attribute the boot script sets turns it off');
});

test('the preference is entitled to the cards and not to the interface', () => {
  // The switch says "Cards move". Someone who unticks it has not asked for a
  // frozen app, so --motion-ui — every drawer, chevron and colour fade — is
  // not the preference's to switch off. Only the operating system reaches it.
  const css = tokens();
  assert.match(css, /--motion-ui:\s*1/, 'the interface may move by default');
  const pref = /:root\[data-motion=['"]off['"]\]\s*\{([^}]*)\}/.exec(css);
  assert.ok(pref, 'the preference rule is there');
  assert.doesNotMatch(pref[1], /--motion-ui/,
    'unticking "Cards move" must not still the rest of the app');
});

test('a system asking for reduced motion is honoured with no script at all', () => {
  const css = tokens();
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*--motion:\s*0/,
    'the page must not move for someone whose OS asked it not to, script or no script');
});

test('a system asking for reduced motion is asking the whole app, not the cards', () => {
  const css = tokens();
  const query = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\}/.exec(css);
  assert.ok(query, 'the reduced-motion rule is there');
  assert.match(query[0], /--motion-ui:\s*0/,
    'both multipliers go to zero, which is what makes every guarded duration ' +
    'in the stylesheet collapse to no time at all');
});

test('the system override outranks a preference of on', () => {
  const css = tokens();
  const pref  = css.search(/:root\[data-motion=['"]off['"]\]/);
  const query = css.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.ok(pref !== -1 && query !== -1);
  // Same specificity, so the later rule wins: the media query names
  // `:root[data-motion]`, an attribute selector like the one above it, and
  // sits after it. Were it earlier, or bare `:root`, a preference of 'on'
  // would beat the operating system — which is the one direction the
  // override must never go.
  assert.ok(query > pref,
    'the reduced-motion rule has to come after the preference rule to win');
  const block = css.slice(query, css.indexOf('}', css.indexOf('}', query) + 1));
  assert.match(block, /:root\[data-motion\]/,
    'and match at the same specificity as the preference rule it overrides');
});
