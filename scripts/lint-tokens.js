#!/usr/bin/env node
/* Token-contract linter — the redesign's static test seam.
 *
 * The visual redesign cannot be asserted over HTTP, so the one automated
 * guarantee it can have is a machine-checkable property of the delivered
 * stylesheet. This script is that check. It reads the CSS the browser is
 * actually served, plus the inline `style=` attributes in the HTML and JS,
 * and fails on:
 *
 *   colour    raw colour outside tokens.css without an exemption comment
 *   type      a font-size not drawn from the seven --text-* steps
 *   space     padding/margin/gap not drawn from the six --space-* steps
 *   radius    a corner not drawn from the three --radius-* steps
 *   shadow    a shadow that is not one of the three overlay shadow tokens,
 *             or a shadow on a surface that also draws a border
 *   important a use of !important outside the allowlist below
 *
 * Run it with `npm run lint:tokens`; `npm test` runs it too, via
 * test/tokens.test.js.
 *
 * ── Exemption comments ────────────────────────────────────────────────────
 * A CSS comment containing the word EXEMPT suppresses the value rules. Its
 * scope is deliberately small in both directions.
 *
 * Where it applies, from where the comment sits:
 *   - inside a rule block  → the rest of that block
 *   - at the top level     → the next rule block
 *   - EXEMPT-BEGIN … EXEMPT-END → everything between the two comments
 *
 * What it applies to, from what the comment names — "EXEMPT from the radius
 * scale" escapes the radius rule and nothing else. Naming no rule escapes
 * all of them, which is almost never what is wanted.
 *
 * The comment must also say *why*; that is a review matter, not something
 * this script can check. !important is never covered by an exemption
 * comment — it has its own allowlist, so that the count is visible in one
 * place and can be watched down to zero.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* The stylesheet, in cascade order, plus the files that carry inline styles.
 * tokens.css is the token *definition* file: raw values are what it is for,
 * so the value rules skip it. It is still checked for !important. */
const TOKEN_FILE = 'public/css/tokens.css';
const CSS_FILES = [
  TOKEN_FILE,
  'public/css/base.css',
  'public/css/layout.css',
  'public/css/components.css',
  'public/css/tabs.css',
];
const MARKUP_FILES = ['public/index.html', 'public/login.html'];
const JS_DIR = 'public/js';

/* ── The scales ──────────────────────────────────────────────────────────
 * Read off tokens.css at startup rather than duplicated here, so that the
 * stylesheet stays the single written-down definition. If a step is added
 * or removed there, this linter follows without being edited. */
function readScales(source) {
  const parsed = parseCss(source);
  /* The scales are the first :root block — part 1 of tokens.css, the one
   * that does not vary by theme. Taking them from there rather than from
   * the whole file matters: --text-muted and --text-subtle are *colours*
   * that live in the palettes, and reading the whole file would let
   * `font-size: var(--text-muted)` pass the type check. */
  const scaleBlock = parsed.blocks.find(b => b.prelude === ':root');
  if (!scaleBlock) throw new Error(`${TOKEN_FILE}: no :root scale block found`);
  const inScales = prefix =>
    new Set(scaleBlock.decls.map(d => d.prop).filter(p => p.startsWith(prefix)));

  /* Shadows do vary by theme, so they are defined in the palettes. */
  const shadow = new Set(
    [...source.matchAll(/^\s*(--shadow-[\w-]+)\s*:/gm)].map(m => m[1])
  );

  const scales = {
    text: inScales('--text-'),
    space: inScales('--space-'),
    radius: inScales('--radius-'),
    shadow,
  };
  for (const [name, set] of Object.entries(scales)) {
    if (!set.size) throw new Error(`${TOKEN_FILE}: the ${name} scale is empty`);
  }
  return scales;
}

/* ── !important allowlist ────────────────────────────────────────────────
 * Every !important in the stylesheet as of the contract ticket, keyed by
 * file and selector so that the entries survive edits above them. The count
 * is the number of !important tokens in that rule, so adding one to an
 * already-listed rule is still caught.
 *
 * THIS LIST ONLY EVER SHRINKS. Each entry is a specificity fight that
 * should be won by restructuring the selectors instead. The target is zero.
 * Nothing may be added here; a new !important is a lint failure, and the
 * fix is to remove the need for it.
 *
 * Where they come from, and what would retire each one:
 *   layout.css   the two danger nav items override a `.sidenav-item svg`
 *                and a `.mob-nav-item:hover` rule that beat them on
 *                specificity — a `-danger` modifier at equal specificity
 *                removes all six.
 *   layout.css   .section-body.closed fights an inline `display` set by the
 *                section collapse script; moving that to a class removes it.
 *   components.css  three of these override a base control rule inside a
 *                media query, one hides the card modal below 900px.
 *   tabs.css     five width overrides on mobile, all fighting the same
 *                desktop `max-width` on form controls. */
const IMPORTANT_ALLOWLIST = [
  { file: 'public/css/layout.css', selector: '.sidenav-danger', count: 1 },
  { file: 'public/css/layout.css', selector: '.sidenav-danger:hover', count: 1 },
  { file: 'public/css/layout.css', selector: '.sidenav-danger svg', count: 1 },
  { file: 'public/css/layout.css', selector: '.mob-nav-item-danger', count: 1 },
  { file: 'public/css/layout.css', selector: '.mob-nav-item-danger:hover', count: 1 },
  { file: 'public/css/layout.css', selector: '.mob-nav-item-danger svg', count: 1 },
  { file: 'public/css/layout.css', selector: '.section-body.closed', count: 1 },
  { file: 'public/css/components.css', selector: '.sort-select', count: 2 },
  { file: 'public/css/components.css', selector: '.cards-grid', count: 1 },
  { file: 'public/css/components.css', selector: '.card-modal-overlay', count: 1 },
  { file: 'public/css/tabs.css', selector: '.admin-create-form input, .admin-create-form select', count: 2 },
  { file: 'public/css/tabs.css', selector: '#sfInput, #searchInput, #setSearchInput', count: 1 },
  { file: 'public/css/tabs.css', selector: '#playerNameInput', count: 1 },
  { file: 'public/css/tabs.css', selector: '.dv-url-field', count: 1 },
];
/* 14 rules, 16 declarations, on 15 source lines. The spec's audit said
 * fifteen, which is the line count — .sort-select spends two lines on one
 * rule, and the admin form packs two onto one line. The number to watch
 * down to zero is the 16. */

/* ── Elevation allowlist ─────────────────────────────────────────────────
 * The elevation rule is "a surface gets either a border or a shadow, never
 * both, and never both plus a background step". Everything below breaks it:
 * a flat surface that draws a border and a shadow at once, or an
 * accent-tinted glow, which the accent rule removes as well.
 *
 * Deciding which surfaces cast a shadow *at all* is ticket 10 — it is the
 * whole of that ticket. Doing it here would be a visual change under a
 * ticket whose contract is "screenshots unchanged", so the rule lands now
 * and the violations are held.
 *
 * THIS LIST ONLY EVER SHRINKS, to zero, in ticket 10. Nothing may be added:
 * a new shadow on a bordered surface is a lint failure.
 *
 *   border + shadow        .section and the eight surfaces that copy it
 *   accent-tinted glow     the three :hover glows, plus the accent halo on
 *                          .card-detail-img (which per the spec should have
 *                          no edge at all — the artwork is its own edge) */
const ELEVATION_ALLOWLIST = [
  { file: 'public/css/layout.css', selector: '.section' },
  { file: 'public/css/layout.css', selector: '.mob-nav-btn' },
  { file: 'public/css/layout.css', selector: '.mob-nav-menu' },
  { file: 'public/css/components.css', selector: '.ac-dropdown' },
  { file: 'public/css/components.css', selector: '.rss-panel' },
  { file: 'public/css/components.css', selector: '.col-menu' },
  { file: 'public/css/components.css', selector: '.card-modal-box' },
  { file: 'public/css/components.css', selector: '.grid-card:hover' },
  { file: 'public/css/tabs.css', selector: '.players-add-bar' },
  { file: 'public/css/tabs.css', selector: '.player-section' },
  { file: 'public/css/tabs.css', selector: '.sf-card' },
  { file: 'public/css/tabs.css', selector: '.sf-card-lg' },
  { file: 'public/css/tabs.css', selector: '.sf-card-lg:hover' },
  { file: 'public/css/tabs.css', selector: '.card-detail-img' },
  { file: 'public/css/tabs.css', selector: '.card-detail-info' },
  { file: 'public/css/tabs.css', selector: '.card-print-tile:hover' },
  { file: 'public/css/tabs.css', selector: '.db-search-panel' },
];

/* ── A small CSS parser ──────────────────────────────────────────────────
 * Enough for hand-written CSS with no build step: comments, strings, nested
 * at-rules, and declarations. Returns rule blocks with their line spans, so
 * that exemption comments can be scoped to a block. */
function parseCss(src) {
  const blocks = [];    // in the order they open
  const comments = [];
  const stack = [];
  let buf = '', bufLine = 1, line = 1, i = 0;

  const flushDecl = () => {
    const block = stack[stack.length - 1];
    const text = buf.trim();
    buf = '';
    if (!block || !text) return;
    const colon = text.indexOf(':');
    if (colon === -1) return;             // e.g. a stray at-statement
    block.decls.push({
      prop: text.slice(0, colon).trim().toLowerCase(),
      value: text.slice(colon + 1).trim(),
      line: bufLine,
    });
  };

  while (i < src.length) {
    const c = src[i];

    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      const text = src.slice(i, stop);
      comments.push({ line, text, block: stack[stack.length - 1] || null, openAt: blocks.length });
      line += (text.match(/\n/g) || []).length;
      i = stop;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j += src[j] === '\\' ? 2 : 1;
      const text = src.slice(i, Math.min(j + 1, src.length));
      buf += text;
      line += (text.match(/\n/g) || []).length;
      i = j + 1;
      continue;
    }

    if (c === '{') {
      const block = {
        prelude: buf.trim().replace(/\s+/g, ' '),
        startLine: bufLine,
        endLine: bufLine,
        decls: [],
        parent: stack[stack.length - 1] || null,
      };
      blocks.push(block);
      stack.push(block);
      buf = '';
      i++;
      continue;
    }

    if (c === '}') {
      flushDecl();
      const block = stack.pop();
      if (block) block.endLine = line;
      i++;
      continue;
    }

    if (c === ';') {
      flushDecl();
      i++;
      continue;
    }

    if (c === '\n') line++;
    if (!buf.trim() && !/\s/.test(c)) bufLine = line;
    buf += c;
    i++;
  }

  return { blocks, comments };
}

/* Rule blocks are the ones that hold declarations — an @media block holds
 * other blocks, not declarations of its own. */
const isRule = b => !b.prelude.startsWith('@') || b.decls.length > 0;

/* Which rules a given EXEMPT comment escapes, from the words it uses. An
 * empty result means "all of them". */
const RULE_WORDS = [
  [/radius|corner/i, 'radius'],
  [/token rule|colou?r/i, 'colour'],
  [/type scale|font.size/i, 'type'],
  [/spacing|space scale/i, 'space'],
  [/shadow|elevation/i, 'shadow'],
];
function namedRules(text) {
  const named = RULE_WORDS.filter(([re]) => re.test(text)).map(([, rule]) => rule);
  return named.length ? new Set(named) : null;   // null = every rule
}

/* Resolve EXEMPT comments to (line range, rules) exemptions. Anything this
 * cannot scope confidently is reported rather than assumed — an exemption
 * that quietly ran to the end of the file would switch the linter off for
 * everything below it, which is the one failure mode that must not be
 * silent. */
function exemptions(parsed, file, report) {
  const out = [];
  const { blocks, comments } = parsed;
  let openBegin = null;
  const add = (from, to, text) => out.push({ from, to, rules: namedRules(text) });

  for (const c of comments) {
    if (/EXEMPT-BEGIN/.test(c.text)) {
      if (openBegin) {
        report('exemption', { file, line: c.line, selector: '' },
          `EXEMPT-BEGIN at line ${openBegin.line} was never closed`);
      }
      openBegin = c;
      continue;
    }
    if (/EXEMPT-END/.test(c.text)) {
      if (openBegin) add(openBegin.line, c.line, openBegin.text);
      else {
        report('exemption', { file, line: c.line, selector: '' },
          'EXEMPT-END with no matching EXEMPT-BEGIN');
      }
      openBegin = null;
      continue;
    }
    if (!/\bEXEMPT\b/.test(c.text)) continue;

    // Inside a rule: the rest of that rule. A comment loose inside an
    // @media block is *not* inside a rule — it scopes to the next one, or
    // it would cover the whole media query.
    if (c.block && c.block.decls.length) {
      add(c.line, c.block.endLine, c.text);
    } else {
      const next = blocks.slice(c.openAt).find(isRule);
      if (next) add(next.startLine, next.endLine, c.text);
      else {
        report('exemption', { file, line: c.line, selector: '' },
          'EXEMPT comment has no rule to apply to');
      }
    }
  }
  if (openBegin) {
    report('exemption', { file, line: openBegin.line, selector: '' },
      'EXEMPT-BEGIN was never closed — add an EXEMPT-END comment');
  }
  return out;
}

/* ── Value predicates ────────────────────────────────────────────────────*/

/* Remove everything a colour literal cannot hide behind, so that what is
 * left can be scanned for one. Token *names* go first — --mc-gold would
 * otherwise read as the named colour `gold`. */
function stripNonColour(value) {
  return value
    .replace(/(["'])(?:\\.|(?!\1).)*\1/g, ' ')  // strings
    .replace(/url\([^)]*\)/g, ' ')
    .replace(/--[\w-]+/g, ' ');                 // token names, incl. fallbacks
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const COLOUR_FN_RE = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/;
/* Only the named colours plausible in hand-written CSS. `transparent` and
 * `currentColor` are not raw colours — they take their value from context —
 * and color-mix() on a token is permitted everywhere by the spec. */
const NAMED_RE = /\b(?:white|black|red|green|blue|yellow|orange|gold|silver|gr[ae]y|pink|purple|brown|cyan|magenta)\b/i;

const hasRawColour = value => {
  const v = stripNonColour(value);
  return HEX_RE.test(v) || COLOUR_FN_RE.test(v) || NAMED_RE.test(v);
};

/* Split a value on separators that sit outside any brackets, so that
 * var(--space-4) stays one component and color-mix(in srgb, a, b) stays one
 * shadow layer. `sep` is a predicate on the character. */
function splitTop(value, sep) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && sep(ch)) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const components = value => splitTop(value, ch => /\s/.test(ch));

const tokenRef = (comp, scale) => {
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(comp);
  return m ? scale.has(m[1]) : false;
};

/* `calc(var(--space-6) + var(--space-4))` is on the scale — it is two steps
 * added, not a new value. Legal as long as every token it names is on the
 * scale and nothing else in it carries a unit. */
const onScaleCalc = (comp, scale) => {
  if (!/^calc\(/.test(comp)) return false;
  const inner = comp.slice(5, -1);
  const names = [...inner.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]);
  if (!names.length || !names.every(n => scale.has(n))) return false;
  const rest = inner.replace(/var\([^)]*\)/g, ' ');
  return !/[a-z%]/i.test(rest);   // no bare lengths left behind
};

const onScale = (comp, scale) => tokenRef(comp, scale) || onScaleCalc(comp, scale);

/* A `0 0 0 <spread>` layer paints a ring at the element's own edge, not a
 * shadow beneath it — that is how focus rings and selected-tile outlines are
 * drawn here. The elevation rule is about depth, so rings are not its
 * business; the accent is explicitly permitted on focus rings. */
const isRing = layer => /^0\s+0\s+0\s+/.test(layer.trim());

const SPACE_PROPS = /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/;
const RADIUS_PROPS = /^border(-(top|bottom)-(left|right))?-radius$/;

/* ── The checks ──────────────────────────────────────────────────────────*/
function checkDecl(decl, ctx, report) {
  const { prop, value } = decl;
  const at = { file: ctx.file, line: decl.line, selector: ctx.selector };

  if (!ctx.isTokenFile && hasRawColour(value)) {
    report('colour', at, `raw colour in \`${prop}: ${value}\``);
  }

  if (prop === 'font-size') {
    const ok = value === 'inherit' || tokenRef(value, ctx.scales.text);
    if (!ok) report('type', at, `off-scale font-size \`${value}\``);
  }

  if (SPACE_PROPS.test(prop)) {
    const bad = components(value).filter(
      c => !/^(0|auto|inherit)$/.test(c) && !onScale(c, ctx.scales.space)
    );
    if (bad.length) report('space', at, `off-scale ${prop} \`${bad.join(' ')}\``);
  }

  if (RADIUS_PROPS.test(prop)) {
    const bad = components(value).filter(
      c => c !== '0' && c !== '/' && !onScale(c, ctx.scales.radius)
    );
    if (bad.length) report('radius', at, `off-scale ${prop} \`${bad.join(' ')}\``);
  }

  if (prop === 'box-shadow' && value !== 'none' && !ctx.elevationExempt) {
    const bad = shadowLayers(value).filter(layer => {
      const m = /var\(\s*(--shadow-[\w-]+)\s*\)/.exec(layer);
      return !m || !ctx.scales.shadow.has(m[1]);
    });
    if (bad.length) {
      report('shadow', at, `shadow not from the overlay tokens: \`${bad.join(', ')}\``);
    }
  }
}

/* Comma-separated shadow layers, minus the rings — see isRing. */
const shadowLayers = value =>
  splitTop(value, ch => ch === ',').filter(l => !isRing(l));

function checkElevation(block, ctx, guardedAt) {
  if (ctx.elevationExempt) return;
  const shadow = block.decls.find(
    d => d.prop === 'box-shadow' && d.value !== 'none' && shadowLayers(d.value).length
  );
  if (!shadow) return;
  const border = block.decls.find(
    d => /^border(-(top|right|bottom|left|inline|block))?$/.test(d.prop) &&
         !/^(none|0)\b/.test(d.value)
  );
  if (border) {
    guardedAt(shadow.line)('shadow',
      { file: ctx.file, line: shadow.line, selector: ctx.selector },
      'draws both a border and a shadow — the elevation rule allows one or the other');
  }
}

/* ── Drivers ─────────────────────────────────────────────────────────────*/
function lintCss(file, src, scales, report) {
  const parsed = parseCss(src);
  const exempt = exemptions(parsed, file, report);
  const isExempt = (line, rule) =>
    exempt.some(e => line >= e.from && line <= e.to && (!e.rules || e.rules.has(rule)));
  const isTokenFile = file === TOKEN_FILE;
  /* Report only what no exemption covering that line has named. */
  const guarded = (line) => (rule, at, message) => {
    if (!isExempt(line, rule)) report(rule, at, message);
  };

  const importantSeen = new Map();

  for (const block of parsed.blocks) {
    if (!isRule(block)) continue;
    const selector = block.prelude;
    const elevationExempt = ELEVATION_ALLOWLIST.some(
      e => e.file === file && e.selector === selector
    );
    const ctx = { file, selector, scales, isTokenFile, elevationExempt };

    for (const decl of block.decls) {
      const bangs = (decl.value.match(/!\s*important/g) || []).length;
      if (bangs) {
        const prev = importantSeen.get(selector);
        importantSeen.set(selector, {
          count: (prev ? prev.count : 0) + bangs,
          line: prev ? prev.line : decl.line,
        });
      }

      if (isTokenFile) continue;
      checkDecl({ ...decl, value: decl.value.replace(/\s*!\s*important$/, '') },
        ctx, guarded(decl.line));
    }
    if (!isTokenFile) checkElevation(block, ctx, guarded);
  }

  // !important: compare against the allowlist, in both directions.
  const allowed = new Map(
    IMPORTANT_ALLOWLIST.filter(e => e.file === file).map(e => [e.selector, e.count])
  );
  for (const [selector, { count, line }] of importantSeen) {
    const budget = allowed.get(selector) || 0;
    if (count > budget) {
      report('important', { file, line, selector },
        budget === 0
          ? `!important is not allowed here (${count}×) — the allowlist is closed`
          : `${count} !important, allowlist permits ${budget}`);
    }
  }
  /* The allowlist is a ratchet: an entry that is no longer needed has to be
   * removed, or the count would stop being the number to watch down to zero. */
  for (const [selector, count] of allowed) {
    const seen = importantSeen.has(selector) ? importantSeen.get(selector).count : 0;
    if (seen < count) {
      report('stale-allowlist', { file, line: 0, selector },
        `allowlist reserves ${count} !important but only ${seen} remain — ` +
        'lower the entry in scripts/lint-tokens.js, or delete it');
    }
  }
}

/* Inline `style=` attributes get the same rules. Declarations that
 * interpolate a template expression are skipped — their value is not
 * knowable statically. */
function lintInlineStyles(file, src, scales, report) {
  const lineOf = idx => src.slice(0, idx).split('\n').length;

  for (const m of src.matchAll(/style\s*=\s*(["'])([\s\S]*?)\1/g)) {
    const line = lineOf(m.index);
    const ctx = { file, selector: 'inline style', scales, isTokenFile: false, elevationExempt: false };
    for (const part of m[2].split(';')) {
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      const prop = part.slice(0, colon).trim().toLowerCase();
      const value = part.slice(colon + 1).trim();
      if (!prop || !value || value.includes('${')) continue;
      if (/!\s*important/.test(value)) {
        report('important', { file, line, selector: 'inline style' },
          `!important in an inline style (\`${prop}\`) — never allowed`);
        continue;
      }
      checkDecl({ prop, value, line }, ctx, report);
    }
  }
}

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const scales = () => readScales(read(TOKEN_FILE));

function lint() {
  const s = scales();
  const violations = [];
  const report = (rule, at, message) => violations.push({ rule, ...at, message });

  for (const file of CSS_FILES) lintCss(file, read(file), s, report);

  const inlineFiles = [
    ...MARKUP_FILES,
    ...fs.readdirSync(path.join(ROOT, JS_DIR))
      .filter(f => f.endsWith('.js'))
      .sort()
      .map(f => path.posix.join(JS_DIR, f)),
  ];
  for (const file of inlineFiles) lintInlineStyles(file, read(file), s, report);

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return violations;
}

/* Lint a CSS or inline-style source that is not one of the delivered files —
 * how the tests check that each rule actually fires. The file name is not
 * on either allowlist, so nothing is suppressed. */
function lintSource(src, { inline = false } = {}) {
  const out = [];
  const report = (rule, at, message) => out.push({ rule, ...at, message });
  const driver = inline ? lintInlineStyles : lintCss;
  driver('<source>', src, scales(), report);
  return out;
}

function format(violations) {
  if (!violations.length) return 'token contract: clean';
  const lines = [];
  let file = null;
  for (const v of violations) {
    if (v.file !== file) { file = v.file; lines.push(`\n${file}`); }
    lines.push(`  ${String(v.line).padStart(4)}  ${v.rule.padEnd(9)} ${v.message}`);
    if (v.selector && v.selector !== 'inline style') lines.push(`        in ${v.selector}`);
  }
  lines.push(`\n${violations.length} violation${violations.length === 1 ? '' : 's'}`);
  return lines.join('\n');
}

module.exports = { lint, lintSource, format, IMPORTANT_ALLOWLIST, ELEVATION_ALLOWLIST };

if (require.main === module) {
  const violations = lint();
  console.log(format(violations));
  process.exit(violations.length ? 1 : 0);
}
