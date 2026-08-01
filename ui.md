# mtgTools — "Cards on a Table" interactivity pass

## Context (read first)
- Vanilla JS, NO framework and NO build step. Every file in `public/js/` is a
  classic <script> sharing one global scope; interactions are wired via inline
  onclick handlers. Keep it that way — do not introduce a bundler, modules, or
  a framework.
- Styling is hand-written CSS in `public/css/`, loaded in cascade order:
  `tokens.css`, `base.css`, `layout.css`, `components.css`, `tabs.css`. Colours
  live in `tokens.css` and nowhere else. There are 5 themes
  (Dark/Light/High-Contrast/Sepia/Dusk — Dusk replaced the green Forest theme
  when the palettes were repainted); any new UI MUST work in all 5 and use
  existing CSS variables, not hardcoded colors. Font sizes come from the seven
  `--text-*` steps in the same file — a raw `font-size` is a bug — weights are
  limited to 400/500/600/700, and `text-transform: uppercase` is only for badges
  at `--text-2xs`. Padding, margin and gap come from the six `--space-*` steps
  and corners from the three `--radius-*` steps; a raw value in either is a bug.
  Shadows come from the `--shadow-*` overlay tokens, and a surface gets either
  a border or a shadow, never both. Decide which the surface is: **flat**
  things (sections, toolbars, table containers, tiles at rest) take a
  `--border` hairline and no shadow, **floating** things (menus, modals,
  tooltips, drag previews, a hover-lifted tile) take a shadow and no border,
  and card artwork takes neither — the art is its own edge. A tile that lifts
  on hover swaps one for the other rather than wearing both. The same rules
  apply to inline `style=`
  attributes in HTML and JS. **All of this is enforced** — `npm test` runs
  `scripts/lint-tokens.js` over the delivered CSS, so a violation fails the
  build rather than getting reviewed. A genuine one-off escapes with a comment
  naming the rule and the reason (`/* EXEMPT from the colour rule: sits over
  card artwork. */`); see README → Testing for the scoping rules. `!important`
  cannot be excused that way — it has a shrinking allowlist in the script.
- The per-tab mana `--accent` marks **state and nothing else**: the active nav
  item, the focus ring, an active toggle, a selected chip or tile. It is not a
  decorative tint — never on headings, hover fills, hover borders or tinted
  shadows — so a screen at rest shows no accent beyond the nav item it is on.
  Mana colour used as *data* is a separate thing and is untouched: the `.mc-*`
  glyph helpers, the curve chart, and the `--player-*` identity colours.
- A grouping is a `.section`, which is vertical rhythm and nothing else — no
  fill, no border, no padding. The few surfaces that genuinely need
  containment (a form, a drawer) opt in with `.section--boxed`, which adds a
  fill, a hairline and padding, and still no shadow. Headings are
  `.section-title`: sentence case, no bar, no letterspacing.
- There are exactly three breakpoints — 640, 900 and 1280 — written as range
  queries, `(width < 900px)` / `(width >= 900px)`. Any other number in an
  `@media` rule is a bug. 900 is where the nav switches between the bottom bar
  and the sidebar, and where a card switches between the full-page tab and the
  modal. JS reads the same numbers from `BP_SM`/`BP_MD` in `state.js`.
- Card images/metadata come through the server Scryfall cache/proxy
  (`scryfall.js` helpers) — the browser never calls Scryfall directly. Reuse the
  existing image cache helpers; do not add new external requests.
- Deck Builder lives across `deckview-core.js` (state/init/select/import),
  `deckview-render.js` (rendering/tiles/multiselect/stats/view toggle),
  `deckview-edit.js` (card/category edits, move modal, autosave),
  `deckview-panels.js` (search/autocomplete, drag/drop, EDHREC, import/export).
- `sortui.js` already provides a shared List/Grid/XL/Pile view toggle used by all
  tabs. Build on the existing "Pile" concept rather than inventing a parallel one.
- Check UI work with `npm run capture-screens` (see README → Testing). ALWAYS pass
  `--data .scratch/ui-redesign/capture-data/state.json`: that is a snapshot of the
  real database, and without it the repo's own `data/` is empty, so every tab
  renders an empty state and the screenshots prove nothing. The snapshot is
  git-ignored — if it is missing, ask the owner to restore it rather than
  reviewing against empty screens. Capture before and after a change and compare;
  the harness is deterministic, so unrelated views should stay byte-identical.

## Goal
Make the app feel tactile — like looking at real cards on a table — while keeping
long lists fast and readable. Three deliverables below. Preserve all existing
functionality (autosave, drag/drop, multiselect, import/export, stats bar).

## 1. Hover-to-lift (global, toggleable)
- On card hover, smoothly scale the card image up (as if picking it up off the
  table), with a subtle shadow/tilt so it reads as "lifted".
- CRITICAL: the layout hitbox must NOT change size. Enlarge only via CSS
  transform (scale/translate) on a visual layer, so the underlying element keeps
  its original bounds — the mouse never "loses" the card and it shrinks back
  instantly when the pointer leaves. Give the lifted card a raised z-index so it
  overlays neighbors instead of reflowing them.
- Add a toggle (persisted in the same prefs/localStorage store `state.js` uses,
  and respected across tabs) to turn hover-lift on/off. Default: on.
- Respect prefers-reduced-motion (no scale animation when set).

## 2. Deck Builder as a top-down playmat
- Restyle the Deck Builder canvas to look like a playmat viewed top-down:
  a felt/mat background surface (theme-aware) that the cards sit on.
- Cards laid out top-down as movable objects. Make moving cards between
  categories feel physical: drag a card and it follows the cursor; dropping it
  on another pile/category moves it there (reuse the existing drag/drop in
  `deckview-panels.js` + the move logic in `deckview-edit.js`; don't fork it).
- Piles: each category renders as a stacked/fanned pile of cards (like stacks on
  a table), with a count. Clicking/expanding a pile fans it out for inspection.
- A pile can CREATE a category: dragging a card onto empty mat space (or a
  "new pile" drop zone) creates a new category from it and moves the card in.
  Renaming the pile renames the category. Piles and categories are the same
  underlying data — don't duplicate state.
- Keep the existing stats bar (curve, pips, avg CMC) and autosave working.

## 3. Long lists stay readable + resizable images
- Long lists must still be viewable as plain text (the existing List view) so
  large decks/collections stay fast — the playmat/pile view is for building, not
  a forced replacement.
- Add a card-image size control (small ↔ large, resizable) for the image-based
  views (Grid/XL/Pile), persisted per-view like the existing sort/column prefs.
  Small images should let big piles/collections stay scannable.

## Constraints & acceptance
- No framework, no build step, no new external network calls.
- Works in all 5 themes and on mobile (the responsive layout must not break).
- Reuse existing helpers (`scryfall.js` image cache, `state.js` prefs storage,
  `sortui.js` view toggle) instead of adding parallel systems.
- Don't regress autosave, drag/drop, multiselect/bulk-move, or import/export.
- Show me a plan of which files you'll touch and the CSS/JS approach BEFORE
  writing code, then implement.