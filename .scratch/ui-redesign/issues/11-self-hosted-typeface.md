# 11 — Self-hosted typeface and tabular figures

**What to build:** The app stops looking like the operating system default and starts looking the same for everyone in the playgroup, regardless of platform.

A single variable typeface is self-hosted — no third-party font service, because this is self-hosted software that must work offline. The current system font stack is retained as a fallback so a failed load degrades to today's appearance rather than to a serif default.

The practical win is **tabular figures**: price, quantity, mana value and collector-number columns finally align on the digit instead of sitting subtly ragged.

The legacy monospace face used for mana text is replaced by the platform monospace stack; where mana symbols can render as glyphs, glyphs are preferred.

**Blocked by:** 05

**Status:** done

- [x] The typeface is served from the application, with no third-party request
- [x] The system stack remains as a fallback and produces a usable page if the font fails to load
- [x] Price, quantity, mana value and collector-number columns align vertically
- [x] Italic is available for card flavour text

**Delivered:** Inter 4.1, four variable `.woff2` files in `public/fonts/`, 277KB
on disk and **100KB on a page of English card names** — `latin` roman and
italic. The other 177KB is the `latin-ext` pair, which a browser fetches only
when a glyph on the page needs it. The files are the `wght`-axis subsets from
`@fontsource-variable/inter@5.3.0`; each carries the whole 100–900 axis, so all
four weights the app uses (400/500/600/700) cost one download rather than four.
OFL text ships beside them, and `public/fonts/README.md` records the
provenance and the update procedure.

**The faces are declared in `tokens.css`, not `base.css`.** `login.html` loads
only the token file, and the sign-in screen has to be in the app's typeface
too. That put a second hole in the auth guard next to the existing
`/css/tokens.css` one: `express.static` sits *behind* the guard, so a font
request from the login page would have been answered with a redirect to
`/login`, the face would have failed to decode, and that one page would have
sat in the fallback stack for good. `server.js` now serves `/fonts` in front of
the guard, and `test/server.test.js` pins both routes plus a path-traversal
attempt through the new mount.

**The format hint is `format('woff2')`, not upstream's
`format('woff2-variations')`.** A browser reads the axes off the file; a format
string it does not recognise makes it skip the source silently. The
`unicode-range` values are copied from Fontsource verbatim, because they are
what keeps `latin-ext` optional.

**Two tokens, `--font-ui` and `--font-mono`, are now the only two permitted
`font-family` values** — a test asserts every other declaration in the CSS, the
HTML and the JS says `inherit`. `--font-mono` (`ui-monospace, 'SF Mono',
'Cascadia Mono', Menlo, Consolas, monospace`) retires the two `'Courier New'`
sites §6.3 names. One of them, `.td-mana`, turned out to be dead — no markup
has carried the class since the mana column started rendering mana-font glyphs
— so it is deleted rather than restacked. Mana symbols were already glyphs
everywhere `renderMana()` reaches, which is everywhere; the mono stack is what
raw `{2}{U}` text falls back to.

**Tabular figures are one block in `base.css`, not a declaration per
component.** "Every number in a column aligns" is a single promise and reads
better as a single rule. `table` covers most of it — price, quantity, mana
value and collector number all live in a `td`. The other eighteen selectors
are the columns of numbers that are not tables: grid-view copy counts, deck
rows, deck-builder piles and the curve, mana-base stats, the availability
calendar, set years. Deliberately excluded: mana cost text, which is
monospaced and so fixed-width already, and running prose, where proportional
digits read better because nothing below them has to line up.

The set browser's collector number was an inline `style=` on a span in
`sets.js`; it is now `.sf-collector`, which is what let it join the rule. Its
colour moved from `--border` to `--text-subtle` in the same line — `--border`
is a hairline colour and was never a legible thing to set text in.

**Verification.** Tests 61/61, including nine new ones in `test/fonts.test.js`.
Everything this ticket promises fails *silently* — a renamed font file, an
absolute URL creeping back, a trimmed fallback stack all still render a page,
just the wrong one, and a reviewer on a machine that is online cannot see it.
So the checks are static: every declared face resolves to a file that starts
with `wOF2`, no `src` is absolute, an italic face exists *and* `.card-flavor`
asks for it, every face spans the four weights, and `--font-ui` still ends in
the old system stack with `-apple-system`, `Segoe UI` and `Roboto` intact.

110 views captured before and after (`shots/pre-typeface`, `shots/post-typeface`).
85 differ, 25 changed height. Everything moves, which is what changing the
typeface of every glyph in the app does; the sizes are reflow. The largest
are Collections and Players on phone (56–60%), where a few pixels of row
height accumulate down a long list. `available` desktop went 1428×930 → 1440×900:
the calendar now fits the viewport and the scrollbar is gone.

**That the face is really loading was proved by removing it.** With
`public/fonts/` moved aside, Collections and Players desktop render
**byte-identical to the pre-change capture** — 0.00%, max Δ 0. That is the
fallback checkbox demonstrated rather than asserted: a failed load degrades to
exactly today's appearance, not to a serif default. Put back, the same two
views differ by 10% and 58%.

Read on screen: the Wants price column (€3.68 / €2.00 / €0.30 / €12.42 now
align on the decimal), Collections quantity and Total columns, the phone
collection cards ("5,222 cards · updated 6/3/2026"), and — outside the
harness, since the card tab is empty at rest — `#card=Lightning Bolt`, where
the flavour text is a drawn italic rather than a synthesised oblique.

The same card proves the `unicode-range` split does what it is there for. Its
artist is Milivoj **Ć**eran, and U+0106 is the only glyph on the page outside
`latin`. Capture it with the two `latin-ext` files moved aside and **197
pixels change, in one 36×14 box** — that character and nothing else. The
subset is loaded when a glyph needs it, and the other 177KB never moves on a
page that does not.

Still unexercised, because the harness captures each tab at rest and neither
has a deep link: the set browser with a set open, which is the only place
`.sf-collector` renders, and Scryfall search results. Both draw the same
`.sf-card` as the card detail's printings row, which was checked.

Untouched, and still ticket 25's: `index.html` loads mana-font and jsPDF from
two CDNs. The typeface makes no third-party request; the page as a whole still
makes two.
