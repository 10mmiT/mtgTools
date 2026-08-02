#!/usr/bin/env node
'use strict';

/**
 * Contrast measurement for the five themes.
 *
 * The repaint asks for a promise that cannot be kept by eye: the high-contrast
 * theme meets WCAG AAA (7:1) for body text and AA (4.5:1) for every other
 * piece of interface text. This script measures it, and measures the other
 * four against their own floors so a repaint cannot quietly regress one.
 *
 * It reads the palettes straight out of public/css/tokens.css — the delivered
 * stylesheet, not a copy — resolves each foreground/background pair the app
 * actually puts on screen, and reports the ratio. `npm test` fails on a
 * violation; run it directly to see the whole table:
 *
 *   node scripts/check-contrast.js            # violations only
 *   node scripts/check-contrast.js --all      # every pair, every theme
 *   node scripts/check-contrast.js --theme contrast --all
 *
 * What it cannot see: text drawn directly on card artwork (deck tiles, grid
 * badges — the backdrop is an image, and those sites carry the documented
 * over-art exemption), and anything whose colour is set from data at runtime
 * beyond the eight player colours.
 *
 * The playmat is the one image it *can* see, because the veil over it is a
 * known colour at a known alpha and the art beneath it is bounded: no
 * artwork is brighter than white or darker than black. Compositing the veil
 * over both is what turns "text stays legible over any card art" from a
 * hope into a measurement — see the playmat pairs below.
 */

const fs   = require('node:fs');
const path = require('node:path');

const ROOT       = path.join(__dirname, '..');
const TOKEN_FILE = 'public/css/tokens.css';

// ── Colour ────────────────────────────────────────────────────────────
// Everything is resolved to {r,g,b} in 0-255. Alpha is composited against a
// known backdrop at parse time; nothing carries alpha past that point.

function parseColour(value) {
  const v = value.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  // rgb(1 2 3 / .8) and rgba(1,2,3,.8) — the alpha is kept so the caller can
  // composite it; the scrim is the only token that needs this.
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const [r, g, b, a = 1] = parts;
    return { r, g, b, a };
  }

  return null;
}

/** Composite `fg` at `pct`% over `bg` — the srgb color-mix() the sheet uses. */
function mix(fg, bg, pct) {
  const k = pct / 100;
  return {
    r: Math.round(fg.r * k + bg.r * (1 - k)),
    g: Math.round(fg.g * k + bg.g * (1 - k)),
    b: Math.round(fg.b * k + bg.b * (1 - k)),
  };
}

const luminance = ({ r, g, b }) => {
  const ch = c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};

/** WCAG 2.1 contrast ratio, 1–21. */
function ratio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

// ── Reading the palettes ──────────────────────────────────────────────

const THEMES = ['dark', 'dusk', 'light', 'sepia', 'contrast'];

/**
 * Pull one complete palette per theme out of the token file. The default
 * theme is the second `:root` block (the first holds the non-theme scales);
 * the rest are `html[data-theme="id"]` blocks.
 */
function parsePalettes(src) {
  const themeSection = src.slice(src.indexOf('── 2. Themes'));
  const palettes = {};

  const blocks = [...themeSection.matchAll(/(:root|html\[data-theme="([a-z]+)"\])\s*\{([^}]*)\}/g)];
  for (const [, selector, id, body] of blocks) {
    const name = selector === ':root' ? 'dark' : id;
    const decls = {};
    for (const [, token, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      decls[token] = value.trim();
    }
    palettes[name] = decls;
  }

  for (const theme of THEMES) {
    if (!palettes[theme]) throw new Error(`${TOKEN_FILE}: no palette for theme "${theme}"`);
  }
  return palettes;
}

/** Resolve a token to a colour, following one level of var() indirection. */
function colourOf(palette, token) {
  let value = palette[token];
  if (value === undefined) throw new Error(`no ${token} in palette`);
  const indirect = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value);
  if (indirect) value = palette[indirect[1]];
  const colour = parseColour(value);
  if (!colour) throw new Error(`${token}: cannot read colour from "${value}"`);
  return colour;
}

// ── What is measured ──────────────────────────────────────────────────
/* Four roles, four floors. `body` is running text the user reads — the AAA
 * target in the contrast theme. `ui` is every other piece of text: labels,
 * status, badges, text on a fill. `subtle` is placeholder and disabled text,
 * which WCAG exempts but which should still be findable. `chrome` is not
 * text at all — hairlines and focus borders. A hairline is deliberately
 * faint in this design (a divider, not an edge), so its floor is only
 * "distinguishable from the surface"; in the contrast theme it is a real
 * 3:1 boundary, which is why that palette's --border is visibly lighter. */
const FLOORS = {
  body:   { normal: 4.5,  contrast: 7   },
  ui:     { normal: 4.5,  contrast: 4.5 },
  subtle: { normal: 3,    contrast: 4.5 },
  chrome: { normal: 1.15, contrast: 3   },
};

const SURFACES = ['--bg', '--surface-1', '--surface-2', '--surface-3', '--mat'];
const MANA     = ['--mc-w', '--mc-u', '--mc-b', '--mc-r', '--mc-g', '--mc-c', '--mc-gold'];
const PLAYERS  = [0, 1, 2, 3, 4, 5, 6, 7].map(n => `--player-${n}`);

/**
 * Every pair the interface puts on screen, as {role, fg, bg, where}.
 * `fg`/`bg` are either a token name or a {token, over, pct} mix.
 */
function pairs(palette) {
  const out = [];
  const add = (role, fg, bg, where) => out.push({ role, fg, bg, where });

  // Body text on every surface it can land on.
  for (const surface of SURFACES) add('body', '--text', surface, 'body text');
  add('body', '--primary-tx', '--primary-lt', 'text on the selected fill');
  add('body', '--hdr-fg', '--hdr-bg', 'mobile header chrome');

  // Secondary and de-emphasised text.
  for (const surface of ['--bg', '--surface-1', '--surface-2', '--surface-3']) {
    add('ui', '--text-muted', surface, 'labels, captions, help text');
    add('subtle', '--text-subtle', surface, 'placeholders, disabled');
  }

  // Text on a filled control.
  add('ui', '--primary-fg', '--primary', 'text on the primary button');
  add('ui', '--primary-fg', '--primary-dk', 'text on the primary button, hovered');
  for (const status of ['success', 'warning', 'danger']) {
    add('ui', `--${status}-fg`, `--${status}`, `text on a ${status} fill`);
    add('ui', `--${status}`, '--surface-1', `${status} text on a section`);
    add('ui', `--${status}`, '--bg', `${status} text on the page`);
    add('ui', `--${status}`, `--${status}-soft`, `${status} text on its soft badge`);
  }

  // The primary colour used as ink rather than as a fill — outline buttons,
  // active links, the want-quick-add ring.
  add('ui', '--primary', '--surface-1', 'outline button label');
  add('ui', '--primary', '--bg', 'outline button label on the page');

  // Mana colours are game data, but they are drawn as glyphs and as the
  // active-nav accent, so they are held to the text floor.
  for (const mc of MANA) {
    add('ui', mc, '--surface-1', 'mana glyph on a section');
    add('ui', mc, '--bg', 'mana glyph on the page');
  }

  // Player chips: the name is drawn in the player's colour on a 20% wash of
  // the same colour (.name-tag in tabs.css, which issue 18 gave the slot
  // rather than an index of its own), and the avatar dot draws initials in
  // --primary-fg over a full-strength fill.
  /* The four things a player's slot colour does, as issue 15 left them. The
   * first two are the colour used as ink: the Want List's tick and its column
   * rule, and the pool's player headings. The third is the one that changed
   * shape — a selected chip is --text over the slot colour at 18%, not the
   * slot colour used as its own label, which is what made the old light-theme
   * chips unreadable. The last is unchanged. */
  for (const player of PLAYERS) {
    add('ui', player, '--surface-1', 'want-list tick, player column rule');
    add('ui', player, '--bg', 'player heading on the page');
    add('ui', '--text', { token: player, over: '--surface-2', pct: 18 }, 'label on a selected player chip');
    add('ui', '--primary-fg', player, 'initials on a player dot');
  }

  /* Over the playmat (§8.5). A user may set the art of any card as the page
   * background, and the app has no say in what that art looks like — so the
   * two extremes stand in for all of it, and every text token is measured
   * against the veil composited over each. Passing both means passing every
   * image in between, which is the guarantee the veil exists to give.
   *
   * This is the reason --scrim is per theme rather than one value: the veil
   * that makes a Plains safe on the dark themes is not the one that makes a
   * Swamp safe on the light ones.
   *
   * Two tokens that are measured on every other surface are deliberately
   * absent here, and both omissions are load-bearing:
   *
   * --text-subtle is placeholder and disabled text, and every one of its
   * uses in the stylesheet is inside an opaque fill — a form control, a
   * search row, a set tile, a toggle knob — so no art ever gets behind it.
   *
   * --border is the hairline, and it is the one pair the veil provably
   * cannot satisfy. On the light themes the veiled backdrop passes straight
   * through the hairline's own lightness on its way from the art to --bg:
   * over black art it reads 1.22:1 at .84 alpha, 1.02:1 at .92, and does not
   * recover to its 1.15 floor before .99, by which point there is no artwork
   * left to see. The floors it is caught between are not both about the same
   * thing: text must be legible at every point along its run, while a
   * hairline over art is a divider between two things that are both lying on
   * the mat, with the art itself doing most of the separating. So the veil
   * is tuned to the text, and the hairline is left to the art. */
  for (const [art, backdrop] of [['#ffffff', 'the brightest art'], ['#000000', 'the darkest art']]) {
    const veil = { token: '--scrim', over: art };
    add('body', '--text',       veil, `body text over the playmat, ${backdrop}`);
    add('ui',   '--text-muted', veil, `labels over the playmat, ${backdrop}`);
  }

  // Non-text: the hairline has to be findable, and the focused-input border
  // is a UI component boundary.
  add('chrome', '--border', '--surface-1', 'hairline divider');
  add('chrome', '--border', '--bg', 'hairline on the page');
  add('chrome', '--border-strong', '--surface-1', 'focused input, active tile');

  return out.map(p => ({ ...p, palette }));
}

/* A pair's side is a token, or a mix of one over another. `over` is a token
 * name, or a literal colour for the two the palette cannot name — white and
 * black art under the playmat's veil. `pct` is the mix, defaulting to the
 * token's own alpha, which is what a veil carries and no other token does. */
const resolve = (palette, spec) => {
  if (typeof spec === 'string') return colourOf(palette, spec);
  const fg = colourOf(palette, spec.token);
  const bg = spec.over.startsWith('--') ? colourOf(palette, spec.over) : parseColour(spec.over);
  return mix(fg, bg, spec.pct ?? (fg.a ?? 1) * 100);
};

const label = spec =>
  typeof spec === 'string'
    ? spec
    : `${spec.pct === undefined ? '' : `${spec.pct}% `}${spec.token} on ${spec.over}`;

// ── The check ─────────────────────────────────────────────────────────

/** Measure every pair in every theme. Returns one row per pair. */
function measure(src = fs.readFileSync(path.join(ROOT, TOKEN_FILE), 'utf8')) {
  const palettes = parsePalettes(src);
  const rows = [];

  for (const theme of THEMES) {
    const palette = palettes[theme];
    for (const pair of pairs(palette)) {
      const value = ratio(resolve(palette, pair.fg), resolve(palette, pair.bg));
      const floor = FLOORS[pair.role][theme === 'contrast' ? 'contrast' : 'normal'];
      rows.push({
        theme, role: pair.role, where: pair.where,
        fg: label(pair.fg), bg: label(pair.bg),
        ratio: Math.round(value * 100) / 100,
        floor,
        pass: value >= floor,
      });
    }
  }
  return rows;
}

const check = src => measure(src).filter(row => !row.pass);

const formatRow = r =>
  `  ${r.theme.padEnd(9)} ${String(r.ratio).padStart(5)}:1  (floor ${r.floor})  ` +
  `${r.fg} on ${r.bg} — ${r.where}`;

const format = rows =>
  rows.length ? `${rows.length} contrast violation(s):\n${rows.map(formatRow).join('\n')}` : '';

// ── CLI ───────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv  = process.argv.slice(2);
  const all   = argv.includes('--all');
  const theme = argv[argv.indexOf('--theme') + 1];

  let rows = measure();
  if (argv.includes('--theme')) rows = rows.filter(r => r.theme === theme);
  if (!all) rows = rows.filter(r => !r.pass);

  if (!rows.length) {
    console.log('All pairs clear their floor.');
  } else {
    for (const t of THEMES) {
      const themeRows = rows.filter(r => r.theme === t);
      if (!themeRows.length) continue;
      console.log(`\n${t}`);
      for (const r of themeRows) {
        console.log(`  ${r.pass ? ' ' : '!'} ${String(r.ratio).padStart(5)}:1 ` +
          `(${r.role}, floor ${r.floor})  ${r.fg} on ${r.bg} — ${r.where}`);
      }
    }
    const failed = rows.filter(r => !r.pass).length;
    console.log(`\n${failed} violation(s) of ${measure().length} pairs measured.`);
    if (failed) process.exitCode = 1;
  }
}

module.exports = { measure, check, format, ratio, parseColour, parsePalettes, mix, THEMES, FLOORS };
