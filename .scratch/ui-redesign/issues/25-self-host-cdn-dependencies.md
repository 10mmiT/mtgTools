# 25 — Self-host the CDN dependencies

**What to build:** The app works with no internet connection.

This is self-hosted software, but it currently loads two third-party libraries at runtime — a Magic symbol font and a PDF generation library — from external content delivery networks. Without a connection, mana symbols fail to render and printable export breaks. Each external request also discloses the user's address to a third party.

Both are served from the application instead.

**Blocked by:** None — can start immediately, independent of everything else.

**Status:** done

- [x] No external network request is made at runtime
- [x] Mana symbols render correctly with the network disabled
- [x] Printable export still works with the network disabled
- [x] Both libraries keep their licence and attribution intact

**How it landed**

**Both libraries live in [public/vendor/](public/vendor/), next to the Inter
files issue 11 put in `public/fonts/`, and for the same two reasons.** A LAN
with no route out is the ordinary case for this app, not the edge case, and a
page that fetches its symbol font from jsDelivr is a page whose mana costs are
empty boxes on that LAN. The second reason costs nothing to fix and is worth
more: every load told two CDNs the address of whoever was reading a card list.
`public/vendor/README.md` records where each file came from, what was changed,
and the commands that reproduce it — the update path, not just the provenance.

**Mana 1.18.0 is upstream's `mana.min.css` byte for byte, apart from its
`@font-face` blocks.** Upstream declares `eot`, `woff`, `ttf` and `svg` — and
not `woff2`, though the package ships one. So the two faces are replaced by
one written by hand: `mana.woff2`, 187KB against `mana.woff`'s 400KB, and the
other 2.9MB of formats for browsers that predate this application stay out of
the repository. The second face was MPlantin, the card-text serif, used only
by overlay classes this app never writes; those classes fall back to the serif
stack upstream already names beside it. `font-display: block` rather than the
typeface's `swap`: a swap period on an icon font is a row of tofu where the
mana costs go, and the file is local, so the block period is over before it is
visible. The 46KB of unused symbol classes stay — a clean diff against
upstream is worth more than the bytes, which compress away.

**jsPDF is fetched when the button is pressed, not when the page loads.** It
was a render-blocking `<script>` in `<head>`; self-hosting it unchanged would
have moved 360KB from a CDN onto the app's own first paint, for a feature most
sessions never touch. `_loadJsPdf()` in [wants.js](public/js/wants.js) injects
the script on the first *Export → PDF* and caches the promise; a failed load
drops the cached promise, so a second press retries rather than remembering the
failure for the life of the tab. `wantExportPdf()` is `async` now, and the old
"check your connection" message is gone — there is no connection to check, so
a failure there means the file is missing from the install, not that the user
is offline.

**Neither file points at a source map it does not ship.** Upstream's trailing
`sourceMappingURL` comment on both is dropped: a map that is not there is a
404 the moment anyone opens devtools, which is exactly the sort of stray
request this ticket exists to remove.

**Licences.** `LICENSE-jsPDF.txt` is upstream's file. Mana ships no licence
file at all — not in the npm package, not in the repository — so
`LICENSE-Mana.txt` quotes the "License" section of its README verbatim (font
under OFL 1.1, CSS under MIT, symbol images copyright Wizards of the Coast)
and copies both licence texts in full underneath.

**Tests:** nine in a new [offline.test.js](test/offline.test.js), plus one in
[server.test.js](test/server.test.js). The file-level ones assert what cannot
be seen on a connected laptop: no `<script>`, `<link>` or `<img>` in either
page names another origin, no stylesheet does either through `url()` or
`@import`, the vendored CSS declares exactly one face and it resolves to a
file that starts with `wOF2`, and every symbol class the app actually writes —
colours, generic costs, hybrids, twobrids, Phyrexian, `{T}`, `{Q}`, snow,
energy — is in the stylesheet, since a missing class is a blank space in a
mana cost that nothing else would catch. The PDF library is *run*: the bundle
is evaluated in a `vm` context with no fetch, no `XMLHttpRequest` and no route
out, and the same calls `wantExportPdf()` makes produce a two-page `%PDF-1.3`.
The server test asserts the three files are actually served, with the content
types that make a browser use them. `playmat.test.js` had pinned the head
order against the CDN link by name and now pins it against the first
stylesheet.

**Verified in a browser**, driving the real app in headless Firefox through
the screenshot harness's plumbing:

- 34 resources fetched on load, **0 of them from another origin**.
- `vendor/mana.min.css` among them; nothing matching `jspdf` — it is not
  fetched at boot.
- The `Mana` face reports `status: loaded`, and `document.fonts.check()` for
  U+E604 — the private-use codepoint the `.ms-g` rule asks for — is true.
- A rendered `{2}{W}{U}{B}{R}{G}{C}{X}{T}{W/U}{2/W}{W/P}{S}` screenshots as
  thirteen correct symbols, hybrids and Phyrexian included, as does an oracle
  line through `cardOracleHtml()`.
- Calling `_loadJsPdf()` in the page fetches
  `http://127.0.0.1:3401/vendor/jspdf.umd.min.js` and returns a working
  `jsPDF`, which produces a `%PDF-1.3`.
