# UI Redesign — what was done

A record of the work on `docs/ui-redesign` (32 commits, `2ad4567..fede17c`), written after
delivery. It supersedes the three planning documents the work was driven from — the PRD
(`spec-ui-redesign.md`), the implementation design spec (`ui-redesign.md`, no relation to this
file), and the 25 tickets in `.scratch/ui-redesign/issues/`. None of the three is still in the
repo. Where this document and those disagree, this one is what happened.

The companion interactivity brief (`docs/design/ui.md`) is **not** covered here, because it was not built.
See [Not delivered](#not-delivered).

---

## The principle

> The cards are the content, and the interface is not.

Everything below is that sentence applied to a specific surface. The app is personal software
for a playgroup: vanilla JavaScript, no build step, no framework, served from someone's own
machine. None of that changed.

## What the numbers say

Baselines were measured before the work, and the same script measures the result. `npm run
measure:layout`, `npm run measure:mobile`, `npm run check:contrast` and `npm test` are the
sources; every figure here is from a run on the final commit, not from a claim in a ticket.

| | before | after |
|---|---|---|
| Horizontal chrome @ 1440px | 284px | **78px** |
| Content width @ 2560px | capped at 1400px | **2482px** (uncapped) |
| Collections — window to first card art | ~400px | **60px** |
| Text sizes | 38 | **7** (187 declarations) |
| Spacing values | 53 raw across 544 declarations | **6 steps** |
| Corner radii | 16 raw across 127 declarations | **3 steps** |
| Breakpoints | 7 (720/860/861/1023/1024/…) | **3** — 640, 900, 1280 |
| Colour declarations outside the token file | 116 | **31**, each carrying a named exemption |
| `!important` | 16 declarations | **12**, on a ratchet that only shrinks |
| Undersized touch targets @ 390px | 507 | **0** |
| Third-party runtime dependencies | 2 CDNs | **0** |
| Tests | 60 | **125**, in 15 suites |

Prose is capped at a 727px measure on every tab that carries it; card grids and tables take the
whole window.

---

## The work, in the order it landed

### Groundwork (tickets 1–2)

**A way to see the change before making it.** `scripts/capture-screens.js` renders all 110 views
— 11 tabs × 5 themes × 2 viewports — plus a contact sheet, driving the locally installed Firefox
over WebDriver BiDi. It needed a `?theme=` URL parameter to select a theme directly, which is
also the only way to recover from an unreadable stored preference without dev tools. Image
diffing was considered and rejected: during a redesign every intentional change is a failure, and
that trains you to ignore the output. It is a review aid, not an assertion.

**The stylesheet split into five files** — `tokens`, `base`, `layout`, `components`, `tabs` —
linked in that order, so load order is cascade order. A pure move: all 633 top-level rules kept
their text and their relative order. The token definitions live alone specifically so the
raw-colour rule is auditable by looking at one file.

### The token contract (tickets 3–8)

Sequenced as **expand → migrate → contract** rather than as vertical slices, because the token
refactor touches one shared stylesheet: a single edit breaks hundreds of call sites at once and
no vertical slice can land green.

- **Expand.** `tokens.css` went from 122 custom properties to 284, adding 41 colour tokens across
  five themes plus the theme-invariant type, spacing, radius and breakpoint scales. Values
  preserved the app's appearance at the time; new names aliased old ones. Nothing consumed them
  yet.
- **Colour.** 116 colour-bearing declarations outside `tokens.css` down to 31, each with a comment
  naming its exemption. The visible fix: the eight per-player chips had *no* theme variants at
  all, so light themes drew dark-theme pastels.
- **Type.** 238 declarations across 39 values → 187 across 7 steps. Weights to 400/500/600/700;
  uppercase confined to five badge classes at `--text-2xs`. Nearest-step mapping, so the largest
  shrink any running text took was half a pixel.
- **Spacing and radius.** 544 spacing declarations across 53 raw values → the six `--space-*`
  steps; 127 radius declarations across 16 raw values → three. Inline `style=` attributes moved
  in the same pass. Ties round down, because the redesign tightens.
- **Breakpoints.** Seven → three, written as range queries (`(width < 900px)` / `(width >=
  900px)`). The range syntax is what keeps the count at three: the old min/max pairs each needed
  an off-by-one twin, and the halves had drifted apart. JS reads `BP_SM`/`BP_MD` from `state.js`
  with the same comparisons, so a boundary width lands on the same side in both.
- **Contract.** Six superseded tokens deleted across all five themes and 233 call sites. Four
  were aliases created for exactly this step, so the move is provably pixel-neutral.

**And the enforcement.** `scripts/lint-tokens.js` (574 lines) parses the delivered CSS and fails
the build on: a raw colour outside the token file, an off-scale size/spacing/radius, a shadow on a
non-overlay surface, a border *and* a shadow on the same surface, and `!important` outside a
closed allowlist. Inline styles in HTML and JS are held to the same rules. A genuine one-off
escapes with a comment naming the rule and the reason; `!important` cannot be excused that way.
Both allowlists are ratchets — an entry that is no longer needed is a lint failure, so they cannot
quietly refill.

### The look (tickets 9–11)

**Five themes repainted.** They keep their slots but now differ by *temperature* rather than hue:
cool dark, warm dark, cool light, warm light, high contrast. The primary action colour went
near-neutral — near-white on dark themes, near-black on light — so it stops competing with the
per-tab mana accent. The green Forest theme became **Dusk**, with a read-time migration so nobody
loses their stored setting.

The measurement is the deliverable, not the palette: `scripts/check-contrast.js` holds every
text/surface pair to a floor, AAA (7:1) for body text on the contrast theme and AA elsewhere.
Where contrast and aesthetics conflict there, contrast wins.

**Recede.** One rule produces the effect:

> A surface gets **either** a border **or** a shadow — never both, and never both plus a
> background step.

Flat things (sections, toolbars, table containers) take a hairline. Only floating things (menus,
modals, tooltips, drag previews) take a shadow. Card artwork takes neither — the art is its own
edge. The seventeen surfaces the linter had parked in an allowlist were each *resolved* by
deciding which of the two they are, not re-scoped; the elevation allowlist is now empty.

The mana `--accent` was cut back to marking **state and nothing else**: active nav item, focus
ring, active toggle, selected chip. Off headings, hover fills, hover borders and tinted shadows.
A screen at rest carries no interface colour. Mana used as *data* — the `.mc-*` glyphs, the curve
chart, the `--player-*` identities — is untouched, because that is card information.

`.panel` was renamed to `.section` in a commit of its own, to keep the rename out of the diff that
changes how the surface looks.

**One typeface.** Inter 4.1 vendored into `public/fonts` — four wght-axis variable woff2 files,
~100KB. Each carries the whole 100–900 axis, so four weights cost one download. Tabular figures
throughout, so price and quantity columns finally line up. The system stack stays behind it as a
fallback, and a test asserts the app is still usable if the font fails to load.

### Layout and per-tab work (tickets 12–20)

**Full bleed.** The 1400px cap is gone, replaced by two behaviours that each say what they are
for: `.content-wide` (no cap) for the shell, card grids and tables, and a prose cap at a readable
measure for rules text, rulings, forms, admin and empty states. With the sidebar defaulting to
icon-only (186px → 46px) and page padding down a step, chrome fell 284px → 78px.

Then each tab's stacked boxes collapsed into one sticky `.toolbar`:

- **Collections** — four boxes (Add form, collections list, search row, view toolbar) → one strip
  and one row of chips. The Add form moved into a drawer; it is used once and then not for
  months, and it was holding space used constantly. ~400px of chrome → 102px, and to 60px once
  ticket 14 landed. This ticket produced `.toolbar`, `.chip` and `.drawer`, which the next five
  inherited.
- **Scryfall Search & Set Browser** — search row + view toolbar → one strip each. The Set
  Browser's picker became a grid of 120 set tiles and the tab's landing view. The "owned" figure
  on a tile had no possible source, so `set-index.js` was added: one row per (set, card name),
  filled by a background sweep and thereafter permanent. That required extracting the proxy's
  rate limiter into `scryfall-queue.js` first — Scryfall's limit is per IP, and a second module
  pacing itself would have put the server at 18 req/s against a limit of 10.
- **Want Lists & Pick Night** — two rows inside a box → one strip plus a chip row (229px above
  the cards → 94px). Pick Night's deck pool became a drawer. The real work was the palette: the
  app had been painting players from an eight-hex list held *in the data*, indexed by the name's
  position in a sorted list — so a person was one colour here and another there, and a new name
  early in the alphabet repainted everybody. A player's colour is now a slot; what it looks like
  is the theme's.
- **Card** — the last box off the app's prose case. Legality gained a fourth state: it had been
  mana colours on the one tab whose subject *is* mana colour, with "banned in Legacy" looking
  identical to "never printed for Standard". Now `--success` / `--warning` / `--danger`, and the
  two loud states also say the word, since a badge whose meaning is only hue is no badge to
  someone who cannot see it. Rulings became a `<dl>`.
- **Deck Builder** — three control rows → one strip with two shapes driven by one attribute
  (replacing six `style.display` writes). `#dbDeckContent` became the mat.
- **Available@ & Mana Base** — one strip each; the calendar grid starts 104px down instead of
  210. The mana calculator takes the *prose* width, not the wide one: uncapped at 2560px it put
  the six pip fields against one edge and the answer against the other, 1318px apart.
- **Players & Decks and Admin** — boxes off the tiles; five tiles across where there were four.
  Admin's Create User was the last boxed collapsible in the app, and `toggleSection()` went with
  it. That retired four `!important` — not by re-scoping but by removing what they were fighting.
- **Mobile parity.** Every tab reviewed at 390px across all five themes. 507 undersized controls
  — 24 distinct ones repeated down lists — almost all measuring exactly *N* × 44, because the
  existing rule set `min-height` and nothing else. One rule, obeyed two ways: a control standing
  alone in a strip **grows**; a control in dense content keeps its painted box and **pads** its
  hit area with a centred `::after`. `scripts/measure-mobile.js` hit-tests rather than reading
  boxes, so it sees pads — and catches one a neighbour has swallowed. 507 → 0.

### The playmat (tickets 21–24)

The panel boxes are gone, so a card grid sits on the page itself. The playmat gives the page
something to be, visible through the gutters between cards.

**Preferences moved off the browser and onto the person.** A `user_prefs` table keyed by
`username` (the users table has no integer id) holding theme and playmat, read and written over
`/api/prefs`. `PUT` is a patch despite the verb, so setting a theme cannot clear a playmat. Every
response carries `stored`, answering "is the server the record?" — false in open mode and after
any failure, which is what tells the client to fall back to localStorage. Boot is in two halves:
paint from localStorage before the session is known, then correct from the server.

**A playmat is one of four things**: none, a card's art crop, a bundled preset, or an upload. The
art crop rather than the card image, because that is the artwork without frame or text box — which
is precisely what a playmat is. It comes through the existing Scryfall proxy and image cache; no
new external request. Reusing the Want List's autocomplete meant *extracting* it, so
`mountCardAutocomplete` now lives in `sortui.js` with two callers instead of two implementations.

**Uploads accept only what the bytes say they are.** The request body *is* the image, not
`multipart/form-data` as the spec first drew it — nothing in this app is an HTML form, so
multipart would have added only a parser, and the parser is the exposure: filename, boundary and
part headers are three inputs chosen by whoever is uploading. As raw bytes the route cannot
receive any of them. The declared Content-Type is still accepted and still ignored, which makes
the indifference testable both ways. The three accepted formats are an **allowlist of byte
signatures**, so rejecting an SVG needs no rule about SVGs — it matches nothing. A blocklist would
have to anticipate every markup format a browser will run script from. The 5 MB cap is structural
(`express.raw` against Content-Length and again as it streams), not a check. One playmat per
person is enforced in three places, because one is not enough. The serving route sits ahead of the
global auth guard and guards itself, answering 401 rather than redirecting — it is fetched by a
CSS `url()`, and a login page arriving with a 200 is a broken background, not a sign-in prompt.
Usernames are percent-encoded into filenames and the result re-checked to land in the playmat
directory. A second rate limiter sits beside the sign-in one, so a burst of uploads cannot lock
anybody out of their account.

**The veil is measured, not chosen.** Card artwork has no controlled brightness — a bright Plains
and a black Swamp want opposite treatments — so a fixed per-theme veil is what makes arbitrary
artwork safe. `check-contrast.js` composites `--scrim` over both white and black and holds the
text colours to their floors against both; each theme carries the *lowest* alpha that passes,
because everything above it is artwork nobody can see. The repaint's 0.82 and 0.84 failed it.

Fixed attachment on desktop, scrolling on mobile (fixed attachment stutters badly on mobile
browsers). **Mobile default is off** — the image costs bandwidth and paint time for something
almost entirely hidden behind a full-width grid — and that opt-in is the one preference kept per
browser rather than per person: it is a statement about a data plan, not about taste.
`prefers-reduced-data` overrides the opt-in, not the other way round. Open mode has no accounts,
so upload is disabled with a visible sentence rather than a hidden control.

**One mat, not two.** The Deck Builder's mat and the app's playmat were two things called the same
word. With a playmat set, the builder's mat goes transparent and the existing fixed layers show
through the rectangle — rather than compositing the same art a second time, which would have been
a second thing to keep in step with the first.

### Offline (ticket 25)

The mana symbol font came off jsDelivr and the PDF library off cdnjs. On a LAN with no route out
— the ordinary case for this app — mana costs rendered as empty boxes and the Want List could not
print. Both are in `public/vendor/` now with their licences. jsPDF was a render-blocking script in
`<head>`; self-hosting it unchanged would have moved 360KB onto first paint for a button most
sessions never press, so `wants.js` fetches it on the first Export → PDF. `offline.test.js`
asserts no page or stylesheet names another origin, and runs the PDF bundle in a vm with no
network.

### Also fixed along the way

**The card cache had been silently frozen.** Scryfall changed its bulk-data index — `download_uri`
and `size` replaced by `jsonl_download_uri` and `compressed_size`, and the file itself went from an
uncompressed JSON array to gzipped JSONL. The daily refresh had been failing once a day, caught
and swallowed, with the app carrying on against whatever was last imported. Both spellings are
read now, newest first, and the file is gunzipped when the URL says `.gz`. Verified against the
live file: 38,485 cards imported.

---

## How it is kept

Four checks, all runnable locally, all green on the final commit:

```
npm test                # 125 tests, 15 suites — HTTP behaviour, tokens, themes, fonts, playmat, offline
npm run lint:tokens     # the token contract over the delivered CSS
npm run check:contrast  # every text/surface pair, and the veil over white and black
npm run measure:layout  # chrome, content width, grid width, fold, prose measure — per tab, two widths
npm run measure:mobile  # hit-tests every control at 390px
npm run capture-screens # 110 views for human review
```

Two seams carry the tests, both chosen to be the highest available. The **HTTP seam** already
existed — the suite drives the Express app through a client against a temporary SQLite database —
and every piece of playmat behaviour is tested there, because all of it is request/response
behaviour. The **static seam** is the token linter, because the visual redesign cannot be asserted
over HTTP and its most valuable guarantee is a property of the delivered stylesheet.

Tests assert externally observable behaviour: the response a client receives, or a
machine-checkable property of the CSS. Not which function was called, and not the markup a
component renders — this redesign deliberately churned markup.

`npm run capture-screens` and `measure-*` need a populated database. Pass
`--data .scratch/ui-redesign/capture-data/available.db`; the repo's own `data/` is empty, so
without it every tab renders an empty state and the comparison proves nothing. That snapshot is
git-ignored — restore it rather than reviewing against empty screens. Always use a copy; the app
writes to whatever database it is given.

---

## Where the build departed from the plan

Each of these was a deliberate reversal during implementation, and the reason is worth keeping:

- **Upload is a raw body, not multipart.** The parser was the whole exposure, and no HTML form
  exists anywhere in the app to justify it.
- **The veil's alpha is measured, not designed.** The repainted values failed their own contrast
  floors.
- **The playmat layer switch is an inline attribute, not a CSS variable.** A variable set on
  `<html>` beats any stylesheet rule, so the mobile and reduced-data defaults could not have been
  media queries without an `!important` the contract bans. They are `display: none`, which is also
  what stops the browser fetching the image at all.
- **The Mana Base calculator takes the prose width**, though §9.10 asked for `.content-wide`. A
  calculator is a form.
- **The toolbar's block padding is `--space-1`**, not the spec's `--space-2`. The controls are
  36px tall themselves, so the padding is the whole discretionary part of the strip, and the fold
  is what the tab is measured on.
- **Nav switches at 900px, not ~860; the card modal at 900px, not ~1024.** Both are deliberate
  consequences of consolidating seven breakpoints into three, and both were checked at tablet
  width.
- **The redesign spec described a "bottom bar ↔ sidebar" switch.** The app has never had a bottom
  bar; the mobile nav is a dropdown at the *top* of the page (`.mob-nav`).

## Not delivered

> **Since superseded.** All three deliverables below were built afterwards, on
> `feat/cards-as-objects`. See [cards-as-objects.md](cards-as-objects.md) for what each
> turned into and the one clause of §2 that was left undone. The rest of this section is kept as it
> was written, because it is what the next piece of work was specified from.

`docs/design/ui.md` — the **"Cards on a Table" interactivity brief** — was written alongside the redesign and
is still outstanding. Its three deliverables are:

1. **Hover-to-lift** — scale a card up on hover via transform only, so the layout hitbox never
   changes size, with a toggle and `prefers-reduced-motion` respected.
2. **Deck Builder as a top-down playmat** — categories as stacked/fanned piles, dragging a card
   onto empty mat space creating a category, piles and categories as one underlying state.
3. **A card-image size control** for the Grid/XL/Pile views, persisted per view.

Nothing in the codebase implements any of the three. The existing Pile view in `sortui.js` is the
pre-existing shared view toggle, not the pile-as-category concept the brief describes. The
redesign explicitly scoped these out and built the grid, toolbar and mat surface they would sit
on; the elevation rule permits the hover-lift's shadow, because a lifted card is a transient
floating object and the rule only forbids shadows on flat surfaces at rest.

`docs/design/ui.md` is therefore kept, not retired. It is the file an agent is told to read first, and its
context section is current.
