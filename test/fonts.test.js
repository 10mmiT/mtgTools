/* The typeface contract (ticket 11, spec §6.1–6.3).
 *
 * Every promise this ticket makes fails *silently*: a renamed font file, an
 * absolute URL that crept back in, a trimmed fallback stack. The page still
 * renders — in the wrong font, or only while the machine has a route out.
 * Nothing about that shows up in a screenshot review of a laptop that is
 * online, so it is asserted here instead.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const TOKENS = read('public/css/tokens.css');
const FONT_DIR = path.join(ROOT, 'public', 'fonts');

// Every @font-face block in the token file, as { style, weight, src, range }.
const FACES = [...TOKENS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
  body,
  style:  (body.match(/font-style:\s*([^;]+);/)  || [])[1]?.trim(),
  weight: (body.match(/font-weight:\s*([^;]+);/) || [])[1]?.trim(),
  src:    (body.match(/src:\s*url\(['"]?([^'")]+)/) || [])[1],
  range:  (body.match(/unicode-range:\s*([^;]+);/) || [])[1]?.trim(),
}));

test('the app declares a self-hosted typeface', () => {
  assert.ok(FACES.length >= 2, 'tokens.css declares @font-face rules');
});

test('every declared face resolves to a file that ships with the app', () => {
  for (const face of FACES) {
    const file = path.resolve(path.join(ROOT, 'public', 'css'), face.src);
    assert.ok(fs.existsSync(file), `${face.src} is missing from public/fonts`);
    // A silent 404 and a silent fallback look the same in a browser, so
    // check it is really a font and not a stub or an LFS pointer.
    assert.equal(fs.readFileSync(file).subarray(0, 4).toString('latin1'), 'wOF2',
      `${face.src} is not a woff2 file`);
  }
});

test('no face is fetched from a third party', () => {
  for (const face of FACES) {
    assert.doesNotMatch(face.src, /^(https?:)?\/\//,
      'the app must render with the network unplugged');
  }
});

test('italic is available, for card flavour text', () => {
  assert.ok(FACES.some(f => f.style === 'italic'),
    'flavour text is set in italic; without a face the browser fakes an oblique');
  // And something has to ask for it.
  assert.match(read('public/css/tabs.css'), /\.card-flavor\s*\{[^}]*font-style:\s*italic/);
});

test('one variable file carries every weight the app uses', () => {
  for (const face of FACES) {
    assert.match(face.weight, /^\d+\s+\d+$/, 'a weight range, not a single weight');
    const [lo, hi] = face.weight.split(/\s+/).map(Number);
    for (const used of [400, 500, 600, 700]) {
      assert.ok(used >= lo && used <= hi, `weight ${used} is outside ${face.weight}`);
    }
  }
});

test('the subsets keep their unicode-range, so latin-ext stays optional', () => {
  for (const face of FACES) {
    assert.ok(face.range?.startsWith('U+'), `${face.src} has no unicode-range`);
  }
  // Basic Latin has to be covered by something, or the app has no text.
  assert.ok(FACES.some(f => /U\+0000-00FF/.test(f.range)));
});

test('the system stack is retained behind Inter as the fallback', () => {
  const ui = (TOKENS.match(/--font-ui:\s*([^;]+);/) || [])[1];
  assert.ok(ui, 'tokens.css defines --font-ui');
  const stack = ui.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
  assert.equal(stack[0], 'Inter', 'the self-hosted face comes first');
  assert.ok(stack.length > 2 && stack.at(-1) === 'sans-serif',
    'a failed load must degrade to the previous system stack, not to a serif');
  for (const face of ['-apple-system', 'Segoe UI', 'Roboto']) {
    assert.ok(stack.includes(face), `${face} is still in the fallback stack`);
  }
});

test('the app names no font-family other than the two tokens', () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'public/css')).map(f => `public/css/${f}`),
    ...fs.readdirSync(path.join(ROOT, 'public/js')).map(f => `public/js/${f}`),
    'public/index.html',
    'public/login.html',
  ];
  const allowed = /^(inherit|var\(--font-ui\)|var\(--font-mono\))$/;
  for (const file of files) {
    const src = read(file);
    // tokens.css is where the two stacks are written down, and @font-face
    // names the family it is defining.
    if (file.endsWith('tokens.css')) continue;
    for (const [, value] of src.matchAll(/font-family:\s*([^;"'}]+)/g)) {
      assert.match(value.trim(), allowed,
        `${file}: font-family: ${value.trim()} — use --font-ui or --font-mono`);
    }
  }
});

test('numeric content is set in tabular figures', () => {
  const base = read('public/css/base.css');
  const block = base.replace(/\/\*[^]*?\*\//g, '')   // the selectors carry comments
                    .match(/([^};]*)\{\s*font-variant-numeric:\s*tabular-nums;\s*\}/);
  assert.ok(block, 'base.css carries the tabular-figures rule');
  const selectors = block[1].split(',').map(s => s.trim());

  // Table cells are most of it — price, quantity, mana value, collector
  // number all live in a td. The rest are columns of numbers that are not
  // tables: §6.2 names each of these five kinds.
  assert.ok(selectors.includes('table'));
  for (const sel of ['.card-price', '.grid-qty', '.dv-qty', '.sf-collector', '.lands-stat-val']) {
    assert.ok(selectors.includes(sel), `${sel} is missing from the tabular rule`);
  }

  // And every class it names has to exist, or the rule is a comment.
  const css = ['layout', 'components', 'tabs'].map(f => read(`public/css/${f}.css`)).join('\n') + base;
  for (const sel of selectors.filter(s => s.startsWith('.'))) {
    assert.ok(css.includes(sel), `${sel} is styled nowhere — stale selector`);
  }
});
