# Inter, vendored

The app's typeface. Self-hosted on purpose: MTG Tools runs on someone's own
server, often on a LAN with no route out, and a font that arrives from a CDN
is both a broken page offline and a note to a third party saying who is
reading what.

| | |
|---|---|
| Family | Inter 4.1 — [rsms.me/inter](https://rsms.me/inter/) |
| Source | npm `@fontsource-variable/inter@5.3.0`, the `wght` (weight-axis) build |
| Licence | SIL Open Font License 1.1 — [LICENSE-Inter.txt](LICENSE-Inter.txt) |
| Files | `latin` and `latin-ext` subsets, roman and italic |

Each file is a variable font carrying the whole 100–900 weight axis, so the
four weights the app uses cost one download rather than four. The `opsz`
(optical size) build was not taken: it is a second axis to reason about for a
difference that is invisible at the sizes in the type scale.

The `@font-face` rules and the `unicode-range` values live in
[`../css/tokens.css`](../css/tokens.css), part 0, copied from Fontsource's
`wght.css` and `wght-italic.css` — with one edit, `format('woff2')` in place of
their `format('woff2-variations')`. The ranges are what keeps `latin-ext`
(177KB of the 277KB here) from ever being fetched on a page of English card
names.

`server.js` serves this directory from a route that sits *in front of* the
auth guard, alongside `css/tokens.css`, so the login page gets the typeface
too.

## Updating

```sh
npm pack @fontsource-variable/inter          # or a newer version
tar xzf fontsource-variable-inter-*.tgz
cp package/files/inter-latin{,-ext}-wght-{normal,italic}.woff2 public/fonts/
cp package/LICENSE public/fonts/LICENSE-Inter.txt
```

Then diff `package/wght.css` and `package/wght-italic.css` against part 0 of
`tokens.css` — if upstream changed a `unicode-range`, it has to be copied
across, and `test/fonts.test.js` will fail until it is. The filenames name the
subset and the axis, so a version bump keeps the same paths; if that ever
stops being true, the paths in `tokens.css` and the `maxAge` in `server.js`
are the two things to revisit.
