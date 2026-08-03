/* Offline operation (ticket 25, spec §"Offline operation").
 *
 * This app is installed on someone's own server, frequently one with no route
 * out. It used to fetch a Magic symbol font from jsDelivr and a PDF library
 * from cdnjs, so with the network down the mana costs turned into empty boxes
 * and the Want List could not print — and with the network up, every visitor
 * announced themselves to two strangers.
 *
 * Both failures are invisible on the developer's laptop, which has a
 * connection and a warm cache, so they are asserted here: nothing in the
 * markup or the stylesheets may name a third party, and the two libraries
 * have to be present, whole, and usable.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const VENDOR    = 'public/vendor';
const MANA_CSS  = read(`${VENDOR}/mana.min.css`);
const PAGES     = ['public/index.html', 'public/login.html'];
const SHEETS    = [
  ...fs.readdirSync(path.join(ROOT, 'public/css')).map(f => `public/css/${f}`),
  `${VENDOR}/mana.min.css`,
];

// ── Nothing is fetched from anyone else ───────────────────────────────────

test('no page loads a script or a stylesheet from another origin', () => {
  for (const page of PAGES) {
    const html = read(page);
    // Every resource the browser fetches while building the page. A plain
    // <a href> is a link the user may follow, not a load, so href is only
    // read off <link> elements.
    const urls = [
      ...[...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)/gi)].map(m => m[1]),
      ...[...html.matchAll(/<link[^>]*\shref=["']([^"']+)/gi)].map(m => m[1]),
      ...[...html.matchAll(/<img[^>]*\ssrc=["']([^"']+)/gi)].map(m => m[1]),
    ];
    assert.ok(urls.length, `${page}: found no resources at all — the scan is broken`);
    for (const url of urls) {
      assert.doesNotMatch(url, /^(https?:)?\/\//,
        `${page}: ${url} is fetched from another origin`);
    }
  }
});

test('no stylesheet reaches out either', () => {
  for (const sheet of SHEETS) {
    const css = read(sheet);
    assert.doesNotMatch(css, /@import/, `${sheet}: @import`);
    for (const [, url] of css.matchAll(/url\(\s*['"]?([^'")]+)/g)) {
      // A data: URI carries its bytes with it. The SVG ones name the SVG
      // namespace, which is an identifier and not somewhere to fetch from.
      if (url.startsWith('data:')) continue;
      assert.doesNotMatch(url, /^(https?:)?\/\//, `${sheet}: url(${url})`);
    }
  }
});

// ── The symbol font ───────────────────────────────────────────────────────

test('the symbol font is one local woff2 and nothing else', () => {
  const faces = [...MANA_CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]);
  assert.equal(faces.length, 1,
    'upstream declares four formats of Mana plus MPlantin; the vendored file declares one');

  const src = faces[0].match(/src:\s*url\(['"]?([^'")?]+)/)[1];
  const file = path.resolve(path.join(ROOT, VENDOR), src);
  assert.ok(fs.existsSync(file), `${src} is missing from ${VENDOR}`);
  // A 404 and a font that never loads look the same on the page, and so does
  // an LFS pointer committed in place of the file.
  assert.equal(fs.readFileSync(file).subarray(0, 4).toString('latin1'), 'wOF2',
    `${src} is not a woff2 file`);
  assert.match(faces[0], /font-family:\s*["']?Mana/,
    'the family the .ms rules ask for');
});

test('every symbol class the app writes is in the vendored stylesheet', () => {
  // card.js and state.js turn "{2}{W/U}{T}" into <i class="ms ms-2 ms-wu
  // ms-tap ms-cost ms-shadow">, so these are the class names the font is
  // asked for. A stylesheet trimmed to the wrong subset shows up as a blank
  // space in a mana cost, which no other test would notice.
  const written = [
    'ms', 'ms-cost', 'ms-shadow',                      // the wrappers
    'ms-w', 'ms-u', 'ms-b', 'ms-r', 'ms-g', 'ms-c',    // colours, and colourless
    'ms-0', 'ms-1', 'ms-2', 'ms-10', 'ms-20',          // generic costs
    'ms-x', 'ms-y', 'ms-z',                            // variable costs
    'ms-wu', 'ms-2w', 'ms-wp',                         // hybrid, twobrid, phyrexian
    'ms-tap', 'ms-untap',                              // {T} and {Q}
    'ms-s', 'ms-e',                                    // snow, energy
  ];
  for (const cls of written) {
    assert.match(MANA_CSS, new RegExp(`\\.${cls}[{:,]`), `.${cls} is missing`);
  }
});

test('the page asks for the symbol font last, so app rules win', () => {
  const html = read('public/index.html');
  const sheets = [...html.matchAll(/<link[^>]*\shref=["']([^"']+\.css)/gi)].map(m => m[1]);
  assert.equal(sheets.at(-1), 'vendor/mana.min.css');
  assert.ok(sheets.includes('css/tabs.css'), 'the app sheets are still there');
});

// ── The PDF library ───────────────────────────────────────────────────────

test('the PDF library ships with the app and is loaded on demand', () => {
  assert.ok(fs.existsSync(path.join(ROOT, VENDOR, 'jspdf.umd.min.js')));

  const wants = read('public/js/wants.js');
  assert.match(wants, /['"]vendor\/jspdf\.umd\.min\.js['"]/,
    'wants.js fetches it from this app');
  assert.doesNotMatch(read('public/index.html'), /jspdf/i,
    '360KB for one button does not belong in <head>');
});

test('the PDF library builds a PDF with no network and no CDN', () => {
  // The bundle runs in a context that has no fetch, no XMLHttpRequest and no
  // route out, which is the machine this ticket is about. If jsPDF needed
  // anything it did not ship with, this is where it would fail.
  const sandbox = {
    console,
    navigator: { userAgent: 'node' },
    btoa, atob, Blob, URL, setTimeout,
    document: { createElement: () => ({ style: {} }), createElementNS: () => ({ style: {} }) },
  };
  sandbox.window = sandbox;
  sandbox.self   = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read(`${VENDOR}/jspdf.umd.min.js`), sandbox, { filename: 'jspdf.umd.min.js' });

  // wants.js reads window.jspdf.jsPDF — the UMD build's global.
  assert.equal(typeof sandbox.jspdf?.jsPDF, 'function', 'window.jspdf.jsPDF');

  // And the calls wantExportPdf() makes, in the order it makes them.
  const { jsPDF } = sandbox.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  assert.ok(doc.internal.pageSize.getWidth() > 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Want List — All Players', 40, 50);
  doc.setTextColor(120);
  doc.rect(40, 60, 11, 11);          // the checkbox to tick off in the shop
  doc.text('Lightning Bolt', 61, 70);
  doc.addPage();
  doc.text('page two', 40, 50);

  const pdf = doc.output();
  assert.match(pdf.slice(0, 8), /^%PDF-1\./, 'the output is a PDF');
  assert.equal((pdf.match(/\/Type \/Page[^s]/g) || []).length, 2, 'both pages are in it');
});

// ── What we owe the people who wrote them ─────────────────────────────────

test('both libraries keep their licence and attribution', () => {
  const mana = read(`${VENDOR}/LICENSE-Mana.txt`);
  assert.match(mana, /SIL OPEN FONT LICENSE/, 'the font is OFL 1.1');
  assert.match(mana, /MIT/,                   'the stylesheet is MIT');
  assert.match(mana, /Andrew Gioia/,          'who wrote it');
  assert.match(mana, /Wizards of the Coast/,  'whose symbols they are');

  const jspdf = read(`${VENDOR}/LICENSE-jsPDF.txt`);
  assert.match(jspdf, /James Hall/);
  assert.match(jspdf, /yWorks/);
  assert.match(jspdf, /Permission is hereby granted/);

  // The header on the stylesheet is the version, which is what an update has
  // to bump and what a licence audit reads first.
  assert.match(MANA_CSS, /Mana 1\.\d+\.\d+/);
  assert.ok(fs.existsSync(path.join(ROOT, VENDOR, 'README.md')),
    'where both came from, and how to update them');
});

test('no vendored file points at a source map it does not ship', () => {
  for (const file of ['mana.min.css', 'jspdf.umd.min.js']) {
    assert.doesNotMatch(read(`${VENDOR}/${file}`), /sourceMappingURL/,
      `${file}: a map that is not here is a 404 in devtools`);
  }
});
