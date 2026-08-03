# Third-party libraries, vendored

Two libraries the app loads at runtime. Both used to come off a CDN — a
stylesheet from jsDelivr and a script from cdnjs — and both are served from
here instead.

MTG Tools runs on someone's own server, often on a LAN with no route out. A
dependency fetched from a third party is two problems: with the network down
the page loses its mana symbols and the Want List cannot print, and with the
network up every visitor's address is disclosed to a CDN that has no business
knowing who is reading a card list. The same reasoning put Inter in
[`../fonts/`](../fonts/); see that directory's README.

| | Mana | jsPDF |
|---|---|---|
| Version | 1.18.0 | 2.5.1 |
| Home | [mana.andrewgioia.com](https://mana.andrewgioia.com) | [github.com/parallax/jsPDF](https://github.com/parallax/jsPDF) |
| Source | npm `mana-font@1.18.0` | npm `jspdf@2.5.1` |
| Licence | OFL 1.1 (font) + MIT (CSS) — [LICENSE-Mana.txt](LICENSE-Mana.txt) | MIT — [LICENSE-jsPDF.txt](LICENSE-jsPDF.txt) |
| Files | `mana.min.css`, `mana.woff2` | `jspdf.umd.min.js` |
| Loaded by | `<link>` in `index.html` | `_loadJsPdf()` in [`../js/wants.js`](../js/wants.js) |

The symbol images themselves are Wizards of the Coast's, as the Mana licence
file records.

## Mana

The app writes `<i class="ms ms-g ms-cost">` and lets the font draw the pip —
`renderMana()` in [`../js/state.js`](../js/state.js) and `card.js` are where
the Scryfall cost strings turn into those elements.

Upstream's `css/mana.min.css` is here byte for byte apart from its two
`@font-face` blocks, which are replaced by one written by hand at the top of
the file. Three reasons to swap them:

- Upstream lists `eot`, `woff`, `ttf` and `svg` and **not** `woff2`, though
  the package ships one. `mana.woff2` is 187KB against `mana.woff`'s 400KB,
  and every browser that can run this app reads it.
- The other four formats exist for browsers that predate this application.
  Not shipping them keeps 2.9MB of dead font out of the repository.
- The second face is MPlantin, the card-text serif, used only by the
  `.ms-loyalty-*` / `.ms-saga` / `.ms-defense` overlay classes that this app
  never writes. Those classes now fall back to the serif stack beside it in
  upstream's own declaration.

`font-display: block` rather than the `swap` the typeface uses: a swap period
on an icon font is a row of tofu boxes where the mana costs go, and the file
is local, so the block period is over before it is visible.

Nothing else is trimmed. The unused symbol classes are text in a file that
compresses well, and a diff against upstream is worth more than the bytes.

## jsPDF

One caller — the Want List's **Export → PDF**, which draws a checklist to tick
off in a shop. `jspdf.umd.min.js` is the UMD build, which defines
`window.jspdf.jsPDF`; it is loaded on demand rather than from `<head>`,
because 360KB on every page load is a poor trade for a button most sessions
never press.

The file is upstream's, minus its trailing `sourceMappingURL` comment: the map
is not shipped, and a comment pointing at a file that is not there turns into
a 404 the moment anyone opens devtools.

The library's optional extras (html2canvas, canvg, dompurify) are needed only
by `.html()` and `.svg()`, which nothing here calls. The bundle looks for them
as globals and finds none, which is the supported way to go without them.

## Updating

```sh
npm pack mana-font                       # or a newer version
npm pack jspdf@2.5.1
tar xzf mana-font-*.tgz && tar xzf jspdf-*.tgz   # both unpack to ./package
cp package/fonts/mana.woff2 public/vendor/       # mind the order — same dir name
cp package/dist/jspdf.umd.min.js public/vendor/  # then drop the last line
cp package/LICENSE public/vendor/LICENSE-jsPDF.txt
```

`mana.min.css` is the one file that is not a copy. Rebuild it from the
unpacked package with:

```sh
node -e '
  const fs = require("fs");
  let css = fs.readFileSync("package/css/mana.min.css", "utf8").replace(/^﻿/, "");
  css = css.replace(/@font-face\{[^}]*\}/g, "")            // upstream faces + MPlantin
           .replace(/\/\*# sourceMappingURL=[^*]*\*\/\s*$/, "");
  if (/@font-face|url\(/.test(css)) throw new Error("a face or a url() survived");
  const head = fs.readFileSync("public/vendor/mana.min.css", "utf8");
  fs.writeFileSync("public/vendor/mana.min.css",
    head.slice(0, head.indexOf("\n.ms{")) + "\n" + css.trimStart() + "\n");
'
```

That keeps the hand-written header and replaces everything from `.ms{` on. Bump
the version in the header comment, in this file, and in the table above.

`test/offline.test.js` asserts what matters here — no absolute URL in the
markup or the stylesheets, both files present and of the right kind, the
`@font-face` pointing at a file that ships. It fails before a broken update
reaches a page.
