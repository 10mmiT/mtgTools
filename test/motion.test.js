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

/* The duration tokens are the one change that could break the promise above
 * quietly. The linter reads time *literals*, so a duration behind a custom
 * property is invisible to it at the call site; the guard moves into the
 * token's own definition to compensate, and this is the assertion that it is
 * actually there. Every one of them is a product with a multiplier that goes
 * to zero, so at zero the duration is no time at all. */
const durations = () =>
  [...tokens().matchAll(/^\s*(--dur-[\w-]+)\s*:\s*([^;]+);/gm)]
    .map(([, name, value]) => ({ name, value }));

test('every duration token is a time multiplied by a motion switch', () => {
  const defs = durations();
  assert.ok(defs.length >= 4, 'the duration scale is there');
  for (const { name, value } of defs) {
    assert.match(value, /calc\(\s*var\(\s*--motion[\w-]*\s*\)\s*\*\s*[\d.]+m?s\s*\)/,
      `${name} is written as ${value}, which is a time the switches cannot reach`);
  }
});

test('the card duration answers to the card switch, and the rest to the interface one', () => {
  for (const { name, value } of durations()) {
    const expected = name === '--dur-card' ? '--motion' : '--motion-ui';
    assert.match(value, new RegExp(`var\\(\\s*${expected}\\s*\\)`),
      `${name} must be guarded by ${expected}`);
    if (expected === '--motion-ui') {
      assert.doesNotMatch(value, /var\(\s*--motion\s*\)/,
        `${name} is interface movement, which "Cards move" is not entitled to still`);
    }
  }
});

// ── The press ─────────────────────────────────────────────────────────
// A key moves the instant your finger lands and springs back under its own
// power. Both halves of that live in the delivered components.css and nowhere
// else, and the direction is easy to get backwards — it was, until #21 — so
// the asymmetry is asserted rather than left to the eye. What the ring looks
// like is not asserted; that is the screenshot harness's business and the
// eye's.

const components = () => read('public/css/components.css');

/** Every rule block in a stylesheet, as { selector, body }. Comments go first,
 *  so a rule someone commented out cannot answer for the live one. */
function rules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body: body.trim() }));
}

const selectorList = sel => sel.split(',').map(s => s.trim()).filter(Boolean);

/** The rule that moves a control under the finger, and the resting rule for
 *  the same controls — the pair the press is made of. */
function pressPair() {
  const all = rules(components());
  const pressed = all.find(r => /:active/.test(r.selector) && /translateY/.test(r.body));
  assert.ok(pressed, 'a control travels when it is pressed');
  const resting = selectorList(pressed.selector).map(s => s.replace(':active', ''));
  const base = all.find(r =>
    selectorList(r.selector).join(',') === resting.join(',') && /transition/.test(r.body));
  assert.ok(base, `the same controls have a resting rule: ${resting.join(', ')}`);
  return { pressed, base, controls: resting };
}

test('the press is the finger and the release is the spring', () => {
  const { pressed, base } = pressPair();
  assert.match(pressed.body, /transition:\s*none/,
    'the pressed state runs no curve — your finger moved it, so it moves now');
  assert.match(base.body, /transform\s+var\(--dur-base\)\s+var\(--ease-control\)/,
    'and the way back is the spring\'s: the resting rule transitions transform ' +
    'on the control curve, so releasing rings rather than snapping');
});

test('the press reaches every control that presses', () => {
  const { controls } = pressPair();
  // The four the research found pressing and saying nothing, alongside the
  // three that already acknowledged it: a dense corner of the app should not
  // feel less finished than a dialog's footer.
  for (const control of ['.btn-primary', '.btn-secondary', '.btn-danger',
                         '.btn-update', '.btn-remove', '.btn-sm', '.kebab-btn']) {
    assert.ok(controls.includes(control), `${control} acknowledges the press`);
  }
});

// ── The panels ────────────────────────────────────────────────────────
// The heavy end of the mass model. A drawer is a slab: it is damped, it does
// not ring, and it leaves the way it arrived. The last of those is the one a
// stylesheet can lose quietly, because each panel writes its two directions as
// two rules — the closed rule and the .open rule — which can drift apart
// without anything looking wrong in either one alone.

const tabs = () => read('public/css/tabs.css');

/** The rules that move each sliding panel, in whichever direction. A panel
 *  that states its travel once, on the rule both directions inherit, is as
 *  correct as one that states it twice; what matters is that every rule that
 *  does state it says the same thing. */
function panelRules() {
  const all = [...rules(components()), ...rules(tabs())];
  return ['.drawer', '.deck-col', '.db-drawer'].map(panel => ({
    panel,
    movers: all.filter(r =>
      selectorList(r.selector).some(s => s === panel || s === `${panel}.open`) &&
      /transition:\s*[^;]*transform/.test(r.body)),
  }));
}

test('the three sliding panels arrive with weight', () => {
  for (const { panel, movers } of panelRules()) {
    assert.ok(movers.length, `${panel} travels`);
    for (const rule of movers) {
      assert.match(rule.body, /transition:[^;]*transform\s+var\(--dur-panel\)\s+var\(--ease-panel\)/,
        `${rule.selector} moves on the panel duration and the panel curve, ` +
        'not on whatever a browser picks when a stylesheet says nothing');
    }
  }
});

test('a panel leaves the way it arrived', () => {
  for (const { panel, movers } of panelRules()) {
    const travels = movers.map(r =>
      /transition:[^;]*?(transform\s+[^,;]+)/.exec(r.body)[1].replace(/\s+/g, ' '));
    assert.strictEqual(new Set(travels).size, 1,
      `${panel} opens and closes on one curve, so the two directions are one ` +
      `reversible action: ${travels.join(' / ')}`);
  }
});

test('a closing panel is unfocusable exactly when it has finished leaving', () => {
  // visibility flips in one step, and only the closing direction waits for the
  // travel to finish — see .drawer for why the opening direction must not. The
  // delay and the travel name the same token, which is the only way they
  // cannot drift: too short and a tab stop walks into a panel that is still
  // sliding away, too long and the panel is still focusable after it is gone.
  for (const { movers } of panelRules()) {
    for (const rule of movers.filter(r => /visibility/.test(r.body))) {
      const closing = !/\.open\b/.test(rule.selector);
      assert.match(rule.body,
        closing ? /visibility\s+0s\s+var\(--dur-panel\)\s*[,;]?\s*$/ : /visibility\s+0s\s*[,;]?\s*$/,
        closing
          ? `${rule.selector} holds visibility for exactly the length of the travel`
          : `${rule.selector} takes focus the instant it opens, so its ` +
            'visibility carries no delay at all');
    }
  }
});

test('a panel is damped: its curve does not pass its mark', () => {
  const def = /--ease-panel:\s*([^;]+);/.exec(tokens());
  assert.ok(def, 'the panel curve is a token');
  const points = /cubic-bezier\(([^)]*)\)/.exec(def[1])[1].split(',').map(Number);
  for (const y of [points[1], points[3]]) {
    assert.ok(y >= 0 && y <= 1,
      `${def[1].trim()} rings, and a drawer that bounced would read as light`);
  }
});

// ── The controls ──────────────────────────────────────────────────────
// The light end of the same model. A knob you flick is spring steel: it is
// quick in both directions and it rings as it lands, where a drawer arrives
// damped. Two rules carry that — the filter toggle's knob and the pile
// toggle — and neither may spend the ring on a property that is not the
// compositor's, which is a correctness rule and not a taste one. The linter
// enforces it across the whole stylesheet; this asserts it where the only two
// deliberate overshoots in the chrome actually live.

/** The rules that move each sprung control. Like the panels, the moving
 *  declaration and the state that sets the destination are different rules;
 *  this finds the one that states the travel. */
function controlRules() {
  const all = [...rules(components()), ...rules(tabs())];
  return ['.tog-pill::after', '.pile-toggle'].map(control => ({
    control,
    movers: all.filter(r =>
      selectorList(r.selector).includes(control) &&
      /transition:\s*[^;]*transform/.test(r.body)),
  }));
}

test('the two controls ring when you use them', () => {
  for (const { control, movers } of controlRules()) {
    assert.ok(movers.length, `${control} moves when it is operated`);
    for (const rule of movers) {
      assert.match(rule.body, /transform\s+var\(--dur-base\)\s+var\(--ease-control\)/,
        `${rule.selector} lands on the control curve, so it reads as sprung ` +
        'rather than as drawn — and on a named duration, which is what makes ' +
        'it instant for someone who asked their system for less movement');
    }
  }
});

test('a control spends its ring on a property the compositor owns', () => {
  // The linter says this of every rule in the app. It is asserted here as
  // well because these two are the only chrome rules that deliberately
  // overshoot: the cheapest way to break the rule is to widen one of these
  // transitions onto the colour beside it, which is one word of a diff.
  const compositor = new Set(['transform', 'translate', 'rotate', 'scale', 'opacity', 'filter']);
  for (const { movers } of controlRules()) {
    for (const rule of movers) {
      const list = /transition:([^;]*)/.exec(rule.body)[1];
      for (const part of list.split(',')) {
        if (!/--ease-control/.test(part)) continue;
        const prop = part.trim().split(/\s+/)[0];
        assert.ok(compositor.has(prop),
          `${rule.selector} rings on \`${prop}\`, which the compositor does ` +
          'not own — an overshoot there passes its mark and takes the page ' +
          'layout with it on the way back');
      }
    }
  }
});

test('a control is sprung: its curve passes its mark', () => {
  const def = /--ease-control:\s*([^;]+);/.exec(tokens());
  assert.ok(def, 'the control curve is a token');
  const points = /cubic-bezier\(([^)]*)\)/.exec(def[1])[1].split(',').map(Number);
  assert.ok([points[1], points[3]].some(y => y < 0 || y > 1),
    `${def[1].trim()} is damped, and a control that did not ring would be the ` +
    'panel curve wearing a second name');
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
