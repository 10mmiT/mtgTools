/* The playmat, asserted where it can be: the boot script's own logic, and
 * the shape of the CSS it drives.
 *
 * There is no HTTP seam here — issue 21 built the endpoints and tests them
 * over supertest, and this issue adds none. What it adds is a background
 * image applied before first paint from a preference that may have come off
 * a server, and three promises about it that are worth more than a
 * screenshot: that a URL is checked before it becomes CSS, that a phone does
 * not download the image unless it was asked to, and that the veil over the
 * art is never optional.
 *
 * The first is tested by running the shipped public/js/playmat.js against
 * stub browser globals, the way test/themes.test.js runs the theme code. The
 * other two are properties of the delivered stylesheet, which is where they
 * are enforced — the whole point of putting them in media queries is that no
 * script has to be trusted to get them right.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── The boot script ───────────────────────────────────────────────────

/** Run the shipped playmat.js in a sandbox that looks enough like a browser
 *  at <head> time: an <html> element and nothing else, which is all the file
 *  is allowed to touch. */
function loadPlaymat({ stored = null, mobile = false } = {}) {
  const store = new Map();
  if (stored !== null) store.set('mtgtools_playmat', JSON.stringify(stored));
  if (mobile) store.set('mtgtools_playmat_mobile', '1');

  const props = new Map();
  const root  = {
    dataset: {},
    style: {
      setProperty:    (k, v) => props.set(k, v),
      removeProperty: k => props.delete(k),
    },
    hasAttribute: name => name === 'data-playmat-mobile' && 'playmatMobile' in root.dataset,
  };

  const sandbox = {
    document: { documentElement: root, getElementById: () => null },
    localStorage: {
      getItem:    k => (store.has(k) ? store.get(k) : null),
      setItem:    (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    location: { href: 'https://mtg.example/', origin: 'https://mtg.example' },
    URL,
  };

  vm.createContext(sandbox);
  vm.runInContext(read('public/js/playmat.js'), sandbox);
  return {
    evaluate: expr => vm.runInContext(expr, sandbox),
    src:      () => props.get('--playmat-src'),
    kind:     () => root.dataset.playmat,
    onMobile: () => 'playmatMobile' in root.dataset,
    stored:   () => JSON.parse(store.get('mtgtools_playmat') || 'null'),
  };
}

const ART = 'https://cards.scryfall.io/art_crop/front/a/b/abc.jpg';

test('a stored playmat is on the page before anything else has run', () => {
  const app = loadPlaymat({
    stored: { playmatKind: 'scryfall', playmatRef: 'Lightning Bolt', playmatUrl: ART },
  });
  assert.strictEqual(app.src(), `url("${ART}")`);
  assert.strictEqual(app.kind(), 'scryfall');
});

test('no stored playmat sets nothing at all', () => {
  const app = loadPlaymat();
  assert.strictEqual(app.src(), undefined, 'no image means no background-image to fetch');
  assert.strictEqual(app.kind(), undefined, 'and no attribute, so the veil stays off');
});

test('a playmat of no kind is not painted, whatever url it carries', () => {
  const app = loadPlaymat({ stored: { playmatKind: 'none', playmatUrl: ART } });
  assert.strictEqual(app.src(), undefined);
  assert.strictEqual(app.kind(), undefined);
});

test('unreadable storage is not a broken page', () => {
  const app = loadPlaymat({ stored: null });
  app.evaluate('localStorage.getItem = () => "{ not json"');
  app.evaluate('applyPlaymat(readPlaymat())');
  assert.strictEqual(app.src(), undefined);
});

/* The url becomes a CSS url(), so it is checked at that boundary rather than
 * where it was stored. Each of these is a value the app cannot have produced
 * — the last is the one that would matter. */
test('a url the app could not have produced is refused', () => {
  const app = loadPlaymat();
  const refused = [
    'javascript:alert(1)',
    'https://evil.example/art.jpg',
    'http://cards.scryfall.io/art_crop/a.jpg',   // the CDN, unencrypted
    'https://cards.scryfall.io.evil.example/a.jpg',
    '/uploads/../etc/passwd',
    'not a url at all',
    '',
    null,
  ];
  for (const url of refused) {
    assert.strictEqual(app.evaluate(`playmatUrlOk(${JSON.stringify(url)})`), false,
      `${url} should not reach a stylesheet`);
  }
});

test('the two origins the app can produce are accepted', () => {
  const app = loadPlaymat();
  assert.strictEqual(app.evaluate(`playmatUrlOk(${JSON.stringify(ART)})`), true,
    "Scryfall's image CDN, which is where card art comes from");
  assert.strictEqual(app.evaluate('playmatUrlOk("/playmat/alice")'), true,
    "the app's own upload route (issue 23)");
});

test('a url that would break out of the url() is neutralised, not trusted', () => {
  // Reaching the CDN check with quotes and whitespace in the path is the case
  // worth pinning: it is accepted as a URL, and what lands in the stylesheet
  // is the percent-encoded serialisation rather than the string as given.
  const hostile = 'https://cards.scryfall.io/a") ;} html { display: none } /*';
  const app = loadPlaymat({ stored: { playmatKind: 'scryfall', playmatUrl: hostile } });
  const src = app.src();
  assert.ok(src.startsWith('url("https://cards.scryfall.io/'), src);
  assert.ok(!/["\s]/.test(src.slice(5, -2)), `the url still carries a quote or a space: ${src}`);
});

test('the per-device mobile switch is a browser preference, not a user one', () => {
  const off = loadPlaymat();
  assert.strictEqual(off.onMobile(), false, 'off unless this browser was told otherwise');

  const on = loadPlaymat({ mobile: true });
  assert.strictEqual(on.onMobile(), true);

  // And it is set and cleared without touching the playmat itself.
  off.evaluate('togglePlaymatOnMobile(true)');
  assert.strictEqual(off.onMobile(), true);
  off.evaluate('togglePlaymatOnMobile(false)');
  assert.strictEqual(off.onMobile(), false);
});

// ── The layers ────────────────────────────────────────────────────────

const layout = () => read('public/css/layout.css');

test('the image and the veil are two layers behind the content', () => {
  const css = layout();
  assert.match(css, /body::before[\s\S]{0,400}background-image:\s*var\(--playmat-src, none\)/,
    'the image layer reads the variable the boot script sets');
  assert.match(css, /body::after\s*\{[^}]*background:\s*var\(--scrim\)/,
    'and the veil is the theme token, not a value of its own');
  assert.match(css, /body::before\s*\{[^}]*z-index:\s*-2/);
  assert.match(css, /body::after\s*\{[^}]*z-index:\s*-1/);
});

test('the veil is not adjustable and cannot be switched off on its own', () => {
  // Comments stripped first: they are full of the word body::before, and a
  // selector must be checked against what it selects, not what it is
  // explained by.
  const css = layout().replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .map(m => ({ sel: m[1].trim(), body: m[2] }))
    .filter(r => /body::(before|after)/.test(r.sel) && /display:/.test(r.body));

  assert.ok(rules.length >= 4, 'the layers should be switched on and off by display');
  // The two layers are switched together or not at all. A rule that hid the
  // veil alone would be a way to put text on raw card art; one that hid the
  // image alone would leave the veil flattening a page with nothing under it.
  for (const { sel, body } of rules) {
    assert.ok(sel.includes('body::before') && sel.includes('body::after'),
      `${body.trim()} reaches one layer without the other: ${sel}`);
  }
  assert.ok(!/--scrim-alpha|--playmat-scrim(?!-)/.test(css + read('public/js/playmat.js')),
    'and nothing exposes a knob for it');
});

test('a phone does not fetch the image unless this device asked for it', () => {
  const css = layout();
  const mobile = /@media \(width < 900px\) \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(mobile, 'layout.css should carry the mobile block the playmat is cancelled in');
  assert.match(mobile[1], /html\[data-playmat\]:not\(\[data-playmat-mobile\]\)[\s\S]*?display:\s*none/,
    'display:none, not a script guard — a guarded image is an image already downloaded');
  assert.match(mobile[1], /body::before\s*\{[^}]*background-attachment:\s*scroll/,
    'and fixed attachment goes with it, since it stutters when scrolled');
});

test('a reduced-data preference wins over the phone opt-in', () => {
  const css = layout();
  const reduced = css.indexOf('@media (prefers-reduced-data: reduce)');
  const mobile  = css.indexOf('@media (width < 900px)');
  assert.ok(reduced !== -1, 'the playmat should answer prefers-reduced-data');
  assert.ok(reduced > mobile,
    'and it must come after the opt-in, since equal specificity is settled by source order');
  assert.match(css.slice(reduced), /^[\s\S]{0,400}display:\s*none/);
});

// ── No flash ──────────────────────────────────────────────────────────

test('the playmat is applied before the page it sits behind is parsed', () => {
  const html = read('public/index.html');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /<script src="js\/playmat\.js"><\/script>/,
    'the one script in <head>: a background applied after first paint is one the user watches appear');
  assert.ok(!/<script[^>]*js\/playmat\.js/.test(html.slice(html.indexOf('</head>'))),
    'and it is not loaded a second time at the foot of the body');
  assert.ok(head.indexOf('js/playmat.js') < head.indexOf('cdn.jsdelivr.net'),
    'above the CDN stylesheet, since a script after a <link> waits for that sheet');
});

// ── The surfaces the art must not reach ───────────────────────────────

test('dense text keeps an opaque surface under it', () => {
  const components = read('public/css/components.css');
  assert.match(components, /\.table-wrap\s*\{[^}]*background:\s*var\(--surface-1\)/,
    'a table is only text, and art must never show through a column of card names');

  const base = read('public/css/base.css');
  assert.match(base, /select\s*\{[\s\S]{0,120}background:\s*var\(--surface-2\)/,
    'and a form control is a fill, which is also why --text-subtle never meets the playmat');
});
