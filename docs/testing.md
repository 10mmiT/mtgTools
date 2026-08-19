# Testing & tooling

The test suite, the token-contract linter, and the screenshot/measurement scripts used to review changes.

## Testing

The project ships a test suite using Node's built-in `node:test` runner and `supertest` — over 1,000 tests across 47 files, needing no browser and no network.

```bash
npm test
```

Tests are written at three seams, all of which assert externally observable behaviour rather than which function called which:

- **The HTTP seam** drives the Express app through a client against an isolated in-memory SQLite database and a temporary state file, so they never touch production data. It covers auth, state, admin, deck and preference routes — anything that is request/response behaviour, including the whole playmat and the card-motion preference.
- **The static seam** is the token linter below, because a visual contract cannot be asserted over HTTP and its most valuable guarantee is a property of the delivered stylesheet.
- **The vm seam** loads a shipped browser file into a `vm` context and calls its decisions directly. Everything the card behaviour decides about *where something goes* is written as a pure function of its inputs and exported from the file that ships — how thick a stack of *n* cards is, what angle a card's name gives it, which pile a card belongs in for the sort's first criterion, how far a card leans, which pile a released card would land in, where each card lies in a carried fan, where a menu asked for at a point is drawn. Sorting is the same seam pointed at the same file: what a chain orders, what a field seeds, what makes a chain somebody's own, what a stored preference from an older version means now, and that no gesture on a table header can reach a chain the control's label cannot say. So those are asserted at their boundaries rather than eyeballed through a browser.

Nothing asserts markup: this work churned markup deliberately.

## Token-contract linter

`npm test` also runs `scripts/lint-tokens.js`, which reads the CSS the browser is actually served — plus the inline `style=` attributes in the HTML and JS — and fails on anything that has drifted off the design token contract:

| rule | fails on |
| --- | --- |
| `colour` | a raw `#hex`, `rgb()` or named colour outside `tokens.css` |
| `type` | a `font-size` that is not one of the seven `--text-*` steps |
| `space` | `padding`/`margin`/`gap` that is not one of the six `--space-*` steps |
| `radius` | a corner that is not one of the `--radius-*` steps — the three UI steps plus `--radius-card`, a physical card's corner as a ratio |
| `shadow` | a shadow that is not one of the `--shadow-*` overlay tokens, or a surface drawing a border *and* a shadow |
| `motion` | a `transition` or `animation` whose duration is not multiplied by a motion token, so it would still move for someone who asked for less movement — or one that names a custom property the script cannot read a duration out of. The `--dur-*` tokens are the exception, and their own definitions are checked for the guard instead |
| `overshoot` | a curve that passes its mark and comes back, applied to a property that affects layout rather than one the compositor owns. Mass on a `width` grows the element past its own token mid-flight and reflows the page on the way |
| `important` | an `!important` outside the allowlist in the script |

Run it alone with `npm run lint:tokens`. The scales are read out of `tokens.css` at startup rather than duplicated in the script, so that file stays the single written-down definition.

A genuine one-off escapes with a CSS comment containing `EXEMPT`, which must say **which rule** it is escaping and **why** — `/* EXEMPT from the colour rule: this sits over card artwork. */`. The scope is the rest of the enclosing rule, or the next rule if the comment is at the top level, or an explicit `EXEMPT-BEGIN` … `EXEMPT-END` span. Naming no rule escapes all of them, which is almost never what you want. `!important` can never be excused this way; it has an allowlist instead, so the count stays visible in one place. Both allowlists are ratchets — they only ever shrink, and a test asserts their current size. `overshoot` cannot be excused either, and has no allowlist for the opposite reason: it is not a house style with exceptions, it is a description of a bug.

## Screenshot harness

For reviewing visual changes, `scripts/capture-screens.js` renders every screen of the app — 11 tabs × 5 themes × 2 viewports (1440×900 and 390×844) = 110 full-page PNGs, plus an `index.html` contact sheet showing them all at once.

Two further viewports, `tablet` (880px) and `tablet-wide` (960px), sit either side of the 900px breakpoint and are not in the default set. Pass `--viewports tablet,tablet-wide` when a change touches responsive behaviour: the default pair never crosses that boundary, so a rule that only misbehaves at tablet width does not show up in a standard capture.

```bash
DATA=--data=.scratch/ui-redesign/capture-data/state.json
npm run capture-screens -- $DATA --name baseline   # before a change
npm run capture-screens -- $DATA --name after      # after it, then compare
```

It starts its own copy of the server in open mode (no login needed) and drives the locally installed Firefox headless over WebDriver BiDi — no extra dependencies. Each view is loaded through the app's own URL routing (`/?theme=sepia#wants`) and captured once the page stops fetching. Tall pages are clipped to 4000px (`--max-height`), since a real collection runs to five figures. Output lands in `.scratch/ui-redesign/shots/<name>/` and is git-ignored.

**Always pass `--data`.** Screens are only as interesting as the data behind them, and the repo's own `data/` is empty, so without it every tab renders an empty state and the comparison proves nothing. `.scratch/ui-redesign/capture-data/` holds a git-ignored snapshot of a populated database for exactly this; if it is missing, restore it before capturing. `DATA_FILE` names a file whose *directory* is used as the data directory, so `available.db` and `scryfall.db` sit beside the `state.json` path you pass. Always use a copy — the app writes to whatever database it is given.

Runs are deterministic: capturing twice with no changes gives byte-identical PNGs, so `sha256sum` is a fair way to confirm that a change left unrelated views alone.

**With two exceptions.** The **Set Browser**'s tiles are only as complete as the set index in the `scryfall.db` you point it at — a snapshot whose index is half filled shows "262 cards" where a filled one shows "41 / 262 owned", and a new set announced between two runs adds a tile at the front. Let the index finish before capturing anything you intend to compare. **Available@** draws a calendar around today, so any pair of captures that straddles midnight differs on the highlighted day and the "best upcoming days" list. Capture the before and after close together, or discount those tabs. If a diff looks far too big for what you changed, check the maximum per-channel delta before assuming the worst: a restyle moves pixels a little across a wide area, whereas reordered content moves a few pixels a lot.

**A card detail is a third case, for a different reason.** `--tabs 'card=Sol Ring'` captures an open card, and that view is three live Scryfall requests deep — the card, then its rulings and its printings. They share one server-side queue with the set-index sweep, which is ~1,400 paged requests and draws 429s with a 60-second `Retry-After`; while it is running, a card lookup can queue behind a minute of penalty and the shot is of "Loading…". Capture card views against a server whose index has already finished, and raise `--settle` if they still come out mid-load.

This is a review aid, not an automated assertion: nothing compares the images. Useful flags — `--tabs`, `--themes`, `--viewports` to narrow a run, `--url` to point at an already-running app, `--help` for the rest.

## Layout measurement

Three of the layout rules are numbers, and a screenshot cannot produce a number, so `npm run measure:layout` measures them in the running app. It reuses the harness above — same open-mode server, same headless Firefox — and reports one line per tab per window:

```bash
npm run measure:layout -- --data .scratch/ui-redesign/capture-data/available.db
```

- **Horizontal chrome** — everything the page spends on itself rather than on content: the sidebar plus the shell's inline padding. Budget is 80px at a 1440px window; it currently measures 78.
- **The reading measure** — no line of running text may be wider than `--measure`. What is measured is the rendered *line box*, via a `Range`, not the container: a short sentence centred in a full-width table cell is not a long line. The measure itself is read from a probe element rather than assumed, since `72ch` depends on the typeface in use.
- **Grid width** — the widest grid or table on the page, reported rather than asserted. It is there to be read at the 2560px window, where a width cap that had crept back in would show up as a number that stopped growing.
- **The fold** — how far down the window the first card sits: the vertical twin of chrome, what a tab spends on itself before showing the thing it is for. The tab's view toggle is clicked to grid first, since the criterion is about card *art* and a list view has none. Budgeted per tab in `FOLD_BUDGETS`: Collections 105px (measures 102), Want Lists 105px (measures 94), Scryfall Search and Set Browser 70px (both measure 60), Pick Night 150px (measures 133 — a strip, the players row, and the results' own bar). Three of those show nothing until asked, so `FOLD_PREP` asks — a query typed and entered, a set tile clicked, an evening's decks picked — which means measuring the first two needs Scryfall reachable, as the Set Browser always has. Pick Night's "card" is a commander-art tile rather than a card image; the question the fold asks is how far down the thing the tab is *for* sits, and there that is the picked deck.

It exits non-zero if the chrome or fold budget is blown or any line of prose runs past the measure, so it can be wired into CI later; it is not part of `npm test`, which needs neither a browser nor a populated database.

## Mobile measurement

Two of the mobile rules are numbers as well, and `npm run measure:mobile` asks them at a 390×844 window — same open-mode server and headless Firefox as the two scripts above.

```bash
npm run measure:mobile -- --data .scratch/ui-redesign/capture-data/state.json
```

- **Sideways scroll** — a phone has no horizontal scrollbar to warn you, so a pane one pixel too wide reads as a page that drifts under the thumb. The budget is zero. When it is blown the elements sticking out past the right edge are named, innermost first, since an overflowing child drags its parents out with it and reporting the whole chain buries the one element that is actually too wide. A wide table is excused: it is *supposed* to scroll, and the walk up the ancestors stops at the first container that scrolls on purpose.
- **Touch targets** — every control at least 44×44. What is measured is the area a finger can land on, not the box the control paints, because on a phone those are deliberately not the same thing: a ✕ set into a dense table keeps its small painted box and gains an invisible pad around it (see the touch-target rule in `components.css`). So the size is found the way a tap finds it — `elementFromPoint`, bisecting outwards from the centre until the answer changes. That also catches the two failures a bounding rect cannot see at all: a target with something painted over it, and two neighbours whose pads overlap so that one swallows the other's edge. Inline links inside running prose are excluded; they cannot be 44px tall without breaking the line box they live in.

One pixel of slack is allowed on the target size, and it is the ruler's rather than the design's: Firefox snaps the far edge of a hit region down to a whole pixel, so a control laid out on a fractional boundary hit-tests up to a pixel narrower than the 44 its computed style says it is.

Five views have no tab of their own and are measured as extra passes, listed in `EXTRA_VIEWS`. The Deck Builder's two drawers — Search/EDHREC and History — and the RSS panel are full-height surfaces on a phone carrying controls nothing else does, and each is scoped to itself — the page behind an open drawer is unreachable by design, and counting its controls as unhittable would report the drawer working as a fault. Collections' list view is there for the opposite reason: a tab is measured as it arrives, and Collections arrives as a grid of card art, so its table — the densest in the app — was not being looked at at all. Otherwise the sweep still sees each tab in its default view, so a control that appears only after switching views is not covered; add it to `EXTRA_VIEWS` with a `PREP` step that opens it.

It exits non-zero on either count. Like `measure:layout` it needs a browser and a populated database, so it is not part of `npm test`.
