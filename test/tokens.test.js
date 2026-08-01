/* The token contract, asserted against the delivered stylesheet.
 *
 * This is the redesign's second test seam. The suite has two halves and
 * needs both: the first asserts that the real CSS is clean, the second
 * asserts that the linter would actually notice if it were not. A linter
 * that passes because it checks nothing is worse than no linter, because it
 * reads as a guarantee.
 */

const test = require('node:test');
const assert = require('node:assert');
const { lint, lintSource, format, IMPORTANT_ALLOWLIST, ELEVATION_ALLOWLIST } =
  require('../scripts/lint-tokens.js');

const rules = src => lintSource(src).map(v => v.rule);
const inlineRules = src => lintSource(src, { inline: true }).map(v => v.rule);

test('the delivered stylesheet satisfies the token contract', () => {
  const violations = lint();
  assert.deepStrictEqual(violations, [], format(violations));
});

test('no superseded token survives anywhere', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const gone = ['--card', '--card-2', '--muted', '--danger-lt', '--radius', '--shadow'];

  const files = [
    ...fs.readdirSync(path.join(root, 'public/css')).map(f => `public/css/${f}`),
    ...fs.readdirSync(path.join(root, 'public/js')).map(f => `public/js/${f}`),
    'public/index.html',
    'public/login.html',
  ];
  for (const file of files) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    for (const token of gone) {
      // Both the definition and any reference to it.
      const def = new RegExp(`^\\s*${token}\\s*:`, 'm');
      const ref = new RegExp(`var\\(\\s*${token}\\s*[),]`);
      assert.ok(!def.test(src), `${file} still defines ${token}`);
      assert.ok(!ref.test(src), `${file} still references ${token}`);
    }
  }
});

test('a raw colour outside the token file is caught', () => {
  assert.deepStrictEqual(rules('.a { color: #ff0000; }'), ['colour']);
  assert.deepStrictEqual(rules('.a { background: rgba(0,0,0,.5); }'), ['colour']);
  assert.deepStrictEqual(rules('.a { border: 1px solid white; }'), ['colour']);
  assert.deepStrictEqual(rules('.a { color: var(--text, #fff); }'), ['colour'],
    'a raw colour hiding in a var() fallback still counts');
});

test('tokens, color-mix and transparent are not raw colours', () => {
  assert.deepStrictEqual(rules('.a { color: var(--text-muted); }'), []);
  assert.deepStrictEqual(
    rules('.a { background: color-mix(in srgb, var(--primary) 20%, transparent); }'), []);
  assert.deepStrictEqual(rules('.a { border-color: transparent; }'), []);
  assert.deepStrictEqual(rules('.a { color: currentColor; }'), []);
  assert.deepStrictEqual(rules('.a { color: var(--mc-gold); }'), [],
    'a token whose name contains a colour word is not a raw colour');
});

test('an off-scale font size is caught', () => {
  assert.deepStrictEqual(rules('.a { font-size: 15px; }'), ['type']);
  assert.deepStrictEqual(rules('.a { font-size: .9rem; }'), ['type']);
  assert.deepStrictEqual(rules('.a { font-size: var(--text-sm); }'), []);
  assert.deepStrictEqual(rules('.a { font-size: var(--text-muted); }'), ['type'],
    '--text-muted is a colour, not a step on the type scale');
});

test('off-scale spacing is caught, and calc of two steps is not', () => {
  assert.deepStrictEqual(rules('.a { padding: 7px; }'), ['space']);
  assert.deepStrictEqual(rules('.a { gap: 10px; }'), ['space']);
  assert.deepStrictEqual(rules('.a { margin: 0 auto; }'), []);
  assert.deepStrictEqual(rules('.a { padding: var(--space-2) var(--space-4); }'), []);
  assert.deepStrictEqual(
    rules('.a { padding-top: calc(var(--space-6) + var(--space-4)); }'), [],
    'two steps added is still on the scale');
  assert.deepStrictEqual(rules('.a { padding-top: calc(var(--space-6) + 3px); }'), ['space'],
    'a bare length smuggled into a calc is not');
});

test('an off-scale radius is caught', () => {
  assert.deepStrictEqual(rules('.a { border-radius: 10px; }'), ['radius']);
  assert.deepStrictEqual(rules('.a { border-radius: var(--radius-md); }'), []);
  assert.deepStrictEqual(rules('.a { border-top-left-radius: 0; }'), []);
});

test('a shadow outside the overlay tokens is caught', () => {
  assert.deepStrictEqual(rules('.a { box-shadow: 0 2px 12px rgba(0,0,0,.45); }'),
    ['colour', 'shadow']);
  assert.deepStrictEqual(rules('.a { box-shadow: var(--shadow-overlay); }'), []);
  assert.deepStrictEqual(rules('.a { box-shadow: var(--shadow-raised); }'), ['shadow'],
    'there is deliberately no raised shadow, so the name is not on the scale');
  assert.deepStrictEqual(rules('.a { box-shadow: none; }'), []);
});

test('a focus ring is not a shadow', () => {
  assert.deepStrictEqual(
    rules('.a:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }'),
    [], 'a spread-only layer paints a ring at the edge, not depth beneath it');
});

test('the elevation rule allows a border or a shadow, not both', () => {
  assert.deepStrictEqual(
    rules('.a { border: 1px solid var(--border); box-shadow: var(--shadow-modal); }'),
    ['shadow']);
  assert.deepStrictEqual(
    rules('.a { border: none; box-shadow: var(--shadow-modal); }'), []);
  assert.deepStrictEqual(
    rules('.a { border: 1px solid var(--border); }'), []);
  assert.deepStrictEqual(
    rules('.a { border: 1px solid var(--border); box-shadow: 0 0 0 2px var(--accent); }'),
    [], 'a ring alongside a border is not an elevation conflict');
});

test('!important is caught, and no exemption comment can excuse it', () => {
  assert.deepStrictEqual(rules('.a { color: var(--text) !important; }'), ['important']);
  assert.deepStrictEqual(
    rules('/* EXEMPT, honestly */\n.a { color: var(--text) !important; }'),
    ['important'], 'the allowlist is the only route, so the count stays visible');
});

test('an exemption comment escapes only the rule it names', () => {
  const src = `
    /* EXEMPT from the colour rule: over card artwork. */
    .a { color: #fff; font-size: 15px; }`;
  assert.deepStrictEqual(rules(src), ['type'],
    'the colour goes, the off-scale font size stays');
});

test('an exemption comment naming nothing escapes everything', () => {
  const src = `
    /* EXEMPT — no rule named. */
    .a { color: #fff; font-size: 15px; }`;
  assert.deepStrictEqual(rules(src), []);
});

test('an exemption comment stops at the end of its scope', () => {
  const oneRule = `
    /* EXEMPT from the colour rule: over card artwork. */
    .a { color: #fff; }
    .b { color: #fff; }`;
  assert.deepStrictEqual(rules(oneRule), ['colour'],
    'a top-level comment covers the next rule and no more');

  const inside = `
    .a {
      color: var(--text);
      /* EXEMPT from the colour rule: over card artwork. */
      background: #fff;
    }
    .b { color: #fff; }`;
  assert.deepStrictEqual(rules(inside), ['colour'],
    'a comment inside a rule covers the rest of that rule and no more');

  const range = `
    /* EXEMPT-BEGIN from the colour rule: over card artwork. */
    .a { color: #fff; }
    .b { color: #fff; }
    /* EXEMPT-END */
    .c { color: #fff; }`;
  assert.deepStrictEqual(rules(range), ['colour'],
    'a BEGIN/END pair covers exactly what is between it');
});

test('inline styles are held to the same rules', () => {
  assert.deepStrictEqual(inlineRules('<div style="color:#fff">'), ['colour']);
  assert.deepStrictEqual(inlineRules('<div style="font-size:15px">'), ['type']);
  assert.deepStrictEqual(inlineRules('<div style="color:var(--text-muted)">'), []);
  assert.deepStrictEqual(
    inlineRules('`<div style="color:${playerColour}">`'), [],
    'an interpolated value is not knowable statically, so it is left alone');
});

test('the allowlists are a ratchet that only shrinks', () => {
  /* The counts are the point of the allowlists: they are what a later
   * ticket watches down to zero. If either total moves, it must move down,
   * and this assertion is what has to be edited to record it. */
  const important = IMPORTANT_ALLOWLIST.reduce((n, e) => n + e.count, 0);
  assert.strictEqual(IMPORTANT_ALLOWLIST.length, 14, '14 rules use !important');
  assert.strictEqual(important, 16, '16 !important declarations, targeting zero');
  assert.strictEqual(ELEVATION_ALLOWLIST.length, 17,
    '17 surfaces break the elevation rule, targeting zero in ticket 10');
});
