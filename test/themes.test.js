/* The five themes: their contrast floors, and the rename migration.
 *
 * Like the token contract next door, this suite has two halves and needs
 * both. The first asserts that the delivered palettes clear their floors;
 * the second asserts that the measurement would actually notice if they did
 * not, because a checker that passes because it measures nothing reads as a
 * guarantee while being none.
 *
 * The migration half runs the shipped theme code rather than a copy of it —
 * the section is sliced out of public/js/main.js and evaluated with stub
 * browser globals, so a change to the real logic is what these assert on.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const { measure, check, format, ratio, parseColour, THEMES: PALETTE_THEMES } =
  require('../scripts/check-contrast.js');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ── Contrast ──────────────────────────────────────────────────────────

test('every theme clears its contrast floors', () => {
  const violations = check();
  assert.deepStrictEqual(violations, [], format(violations));
});

test('the high-contrast theme meets AAA for body text and AA for the rest', () => {
  const rows = measure().filter(r => r.theme === 'contrast');
  assert.ok(rows.length > 40, 'the contrast theme should be measured on every pair');

  for (const row of rows.filter(r => r.role === 'body')) {
    assert.ok(row.ratio >= 7,
      `AAA: ${row.fg} on ${row.bg} (${row.where}) is ${row.ratio}:1`);
  }
  for (const row of rows.filter(r => r.role === 'ui' || r.role === 'subtle')) {
    assert.ok(row.ratio >= 4.5,
      `AA: ${row.fg} on ${row.bg} (${row.where}) is ${row.ratio}:1`);
  }
});

test('the measurement is arithmetic, not opinion', () => {
  // The two anchors of the WCAG scale, plus one published pair.
  assert.strictEqual(ratio(parseColour('#ffffff'), parseColour('#000000')), 21);
  assert.strictEqual(ratio(parseColour('#777777'), parseColour('#777777')), 1);
  assert.strictEqual(
    Math.round(ratio(parseColour('#777777'), parseColour('#ffffff')) * 100) / 100, 4.48);
});

test('a palette that fails its floor is caught', () => {
  const src = read('public/css/tokens.css');

  // Mid-grey body text on the dark theme's background: 3.6:1, under every
  // floor in the table.
  const broken = src.replace(/(\n  --text:\s*)#e7eaee/, '$1#6d7480');
  assert.notStrictEqual(broken, src, 'the dark theme should define --text');

  const violations = check(broken);
  assert.ok(violations.length > 0, 'a 3.6:1 body text should not pass');
  assert.ok(violations.every(v => v.theme === 'dark'),
    'and only the theme that was broken should fail');
});

test('the contrast theme is held to a higher floor than the others', () => {
  const src = read('public/css/tokens.css');

  /* Muted body text — AA on both themes' header, but under the contrast
     theme's AAA body floor: 5.4:1 on dark's header, 6.7:1 on contrast's.
     Passing one and failing the other is the whole assertion.

     It probes --hdr-fg rather than --text, which has one pair per theme
     against a backdrop of the theme's own choosing. --text lands on six
     backdrops of differing lightness — the lightest being a selected player
     chip, which is --text over that player's colour at 18% (issue 15) — so
     dimming it puts the fixture in a band bounded by the *lightest* of them
     while the floor being tested is about the darkest. That band is empty:
     a value dim enough to fail contrast's 7:1 already fails 4.5:1 on the
     chip, in both themes at once, and the result says nothing about floors. */
  const dim = value => src
    .replace(/(\n  --hdr-fg:\s*)#e7eaee/, `$1${value}`)
    .replace(/(\n  --hdr-fg:\s*)#ffffff/, `$1${value}`);

  const failures = check(dim('#8a929e'));
  assert.deepStrictEqual([...new Set(failures.map(f => f.theme))], ['contrast'],
    'the same colour that satisfies the dark theme must fail the contrast one');
  assert.ok(failures.every(f => f.role === 'body'),
    'and it must fail on the body floor, which is the one that differs');
});

// ── The rename ────────────────────────────────────────────────────────

/** Run the theme section of the shipped main.js against stub browser globals. */
function loadThemeCode({ stored = null, search = '' } = {}) {
  const src   = read('public/js/main.js');
  const start = src.indexOf('// ── Theme ─');
  const end   = src.indexOf('// ── View mode ─');
  assert.ok(start !== -1 && end > start,
    'main.js should still carry a Theme section between its banners');

  const store = new Map();
  if (stored !== null) store.set('mtgtools_theme', stored);

  const el = () => ({
    textContent: '', dataset: {}, style: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  });
  const sandbox = {
    document: {
      documentElement: { dataset: {} },
      getElementById: () => null,
      querySelectorAll: () => [],
      querySelector: () => el(),
      addEventListener: () => {},
    },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    location: { search },
    URLSearchParams,
  };

  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, end), sandbox);
  return {
    ...sandbox,
    // const/let bindings are lexical, so they are not properties of the
    // sandbox — reaching them means evaluating in the same context.
    evaluate: expr => vm.runInContext(expr, sandbox),
    stored: () => store.get('mtgtools_theme'),
    applied: () => sandbox.document.documentElement.dataset.theme,
  };
}

test('a stored preference for the retired theme resolves to the renamed one', () => {
  const app = loadThemeCode({ stored: 'forest' });
  app.initTheme();
  assert.strictEqual(app.applied(), 'dusk');
  assert.strictEqual(app.stored(), 'dusk',
    'and the retired id is rewritten, so the mapping is paid once');
});

test('every other stored preference is left alone', () => {
  for (const id of ['dark', 'light', 'contrast', 'sepia', 'dusk']) {
    const app = loadThemeCode({ stored: id });
    app.initTheme();
    assert.strictEqual(app.applied(), id);
  }
  const fresh = loadThemeCode();
  fresh.initTheme();
  assert.strictEqual(fresh.applied(), 'dark', 'no stored preference means the default');
});

test('the retired id is also accepted from the URL override', () => {
  const app = loadThemeCode({ stored: 'light', search: '?theme=forest' });
  app.initTheme();
  assert.strictEqual(app.applied(), 'dusk');

  const bogus = loadThemeCode({ stored: 'sepia', search: '?theme=chartreuse' });
  bogus.initTheme();
  assert.strictEqual(bogus.applied(), 'sepia', 'an unknown id falls back to the stored one');
});

test('the theme list, the palettes and the picker agree on the five ids', () => {
  // The list crosses a realm boundary out of the vm, so it is copied into a
  // host array before comparison — deepStrictEqual compares prototypes.
  const ids = [...loadThemeCode().evaluate('THEMES')].map(t => t.id);

  assert.deepStrictEqual([...ids].sort(), [...PALETTE_THEMES].sort(),
    'every listed theme has a palette in tokens.css, and vice versa');

  const picker = [...read('public/index.html')
    .matchAll(/class="col-menu-item theme-pick-item" data-theme="([a-z]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(picker, ids, 'the sidebar picker offers exactly those, in order');

  const captured = /const THEMES = \[([^\]]+)\]/.exec(read('scripts/capture-screens.js'))[1];
  assert.deepStrictEqual(
    captured.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean).sort(),
    [...ids].sort(), 'and the screenshot harness captures exactly those');
});

/* The rename is only safe if the old id is gone from everything that can
 * select a theme. It may still be named where it is being mapped away or
 * explained — and there, the line has to say what it maps to. */
test('the retired id survives only alongside its replacement', () => {
  const shipped = [
    ...fs.readdirSync(path.join(ROOT, 'public/css')).map(f => `public/css/${f}`),
    ...fs.readdirSync(path.join(ROOT, 'public/js')).map(f => `public/js/${f}`),
    'public/index.html',
    'public/login.html',
    'scripts/capture-screens.js',
  ];
  for (const file of shipped) {
    // Case-sensitive throughout: the theme id is lowercase, while "Forest"
    // the basic land is a card name the app will always have to say.
    const src = read(file);
    if (!/forest/.test(src)) continue;

    assert.match(src, /dusk/,
      `${file} names the retired theme but never says what replaced it`);

    for (const line of src.split('\n')) {
      assert.ok(!/data-theme="forest"|setTheme\('forest'\)|\bid: 'forest'/.test(line),
        `${file} can still select the retired theme: ${line.trim()}`);
    }
  }
});
