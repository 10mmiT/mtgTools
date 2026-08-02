# MTG Tools — UI Redesign Spec

**Status:** approved, not yet implemented
**Date:** 2026-07-31
**Type:** visual redesign — refinement of the existing system, not a reinvention
**Companion doc:** [ui.md](ui.md) — the "Cards on a Table" interactivity brief. See §15 for how
the two relate, including three points where they must be reconciled before building.

---

## 1. The principle

> **The cards are the content. The UI is not.**

Every rule in this document serves that sentence. Where two rules conflict, the one that
gives more room and more attention to card imagery wins.

Today the interface competes with the cards: on a 1440px window the Collections tab spends
**284px (~20% of the width)** on chrome before a single card renders, stacks **five `.panel`
boxes** vertically, and nests surfaces three deep (`.container` → `.panel` → `.grid-card`).
This document is the plan to stop that.

---

## 2. Scope

**In scope**

- All 11 tab panes, desktop and mobile at full parity
- The token system, type scale, spacing scale, radii, elevation, breakpoints
- All 5 themes, repainted
- Layout: full-bleed grids, readable measure for prose, sidebar defaults
- A new **playmat background** feature (per-user, with backend support)
- CSS file architecture
- Screenshot-based verification tooling

**Out of scope**

- Information architecture — the 11 tabs stay 11 tabs, named as they are
- Feature behaviour — nothing a user can currently do stops working
- Any JS framework or build step. The app stays vanilla, no bundler
- Backend changes beyond what the playmat feature requires

---

## 3. Decision record

Each decision, with the reasoning, so future changes know what they'd be overturning.

| # | Decision | Why |
|---|---|---|
| 1 | Refine, don't reinvent | 634 rules across 11 tabs with **no CSS tests**. A ground-up reskin has nothing catching regressions. |
| 2 | Kill vertical chrome | 3–5 stacked `.panel` boxes before the first card is the single largest space cost. |
| 3 | Flatten surfaces | `container → panel → card` triple nesting is why chrome reads as heavy. Cards become the only raised surface. |
| 4 | Sidebar collapsed by default | The 46px collapsed state already exists; it buys a full extra card column (7 → 8 at 1440px). |
| 5 | Full-bleed grids/tables, measured prose | `max-width: 1400px` wastes ~1160px on a 2560px monitor. But oracle text at 2500px is unreadable, so prose keeps a measure. |
| 6 | "Recede" aesthetic | One separation signal per surface, not background + border + shadow simultaneously. |
| 7 | Mana accent survives, shrunk to state only | It's the app's one distinctive idea. Confining it to active/focus states costs nothing against recession. |
| 8 | 5 themes kept, repainted neutral | The 5 slots already map to 2 dark + 2 light + contrast. Only the palettes were the problem. |
| 9 | Token contract, raw hex banned | Root cause of broken themes is ~89 theme-blind colour declarations, not the theme count. |
| 10 | Self-hosted variable font | Fixes the default-OS-font look, gives tabular figures for price columns, adds no external dependency. |
| 11 | Playmat: Scryfall art **and** upload | Scryfall art needs no new infrastructure; upload is what makes it personal. |
| 12 | Playmat per-user in DB | Uploads must live server-side anyway; per-user means your look follows you across devices. |
| 13 | Always-on per-theme scrim | Card art has no controlled value range — a bright Plains and a black Swamp need opposite treatments. A scrim makes any art safe. |
| 14 | CSS splits into 5 files | The token contract is only auditable if it lives in one small file, not buried in a 98KB sheet. |
| 15 | Headless-Firefox screenshot verification | 11 tabs × 5 themes × 2 viewports = 110 screens per phase. Manual checking will be skipped; automated won't. |

---

## 4. Token contract

### 4.1 The rule

> **Raw colour values (`#hex`, `rgb()`, `rgba()`, `hsl()`) are permitted in `tokens.css` only.**
> Everywhere else, colour comes from a `var(--token)`.

Two narrow exemptions, which must carry a comment saying so:

1. Text and controls layered **over card art** (deck tiles, playmat overlays) may use fixed
   white/black, because the backdrop is an image, not a theme surface.
2. `color-mix()` on an existing token is allowed anywhere.

Same rule applies to `font-size`, `padding`, `gap`, `margin` and `border-radius`: use a scale
token. One-off values are a bug.

### 4.2 Naming

Tokens are **semantic, not literal**. `--surface-2`, never `--dark-grey-800`. A token names the
job it does so it can be repainted per theme without renaming.

```
--bg                 page backdrop (behind everything, incl. playmat)
--surface-1          primary raised surface: cards, modals, menus
--surface-2          recessed/secondary: table stripes, inset fields
--surface-3          tertiary: hover states, disabled fills
--border             hairline divider — the default separator
--border-strong      emphasised border: focused inputs, active tiles
--text               primary body text
--text-muted         secondary text, labels, help
--text-subtle        de-emphasised: placeholders, disabled
--primary            primary action fill (near-neutral, high contrast vs --bg)
--primary-fg         text/icon on --primary
--success            owned / found / confirmed
--warning            caution, pending, partial
--danger             destructive, error
--*-fg / --*-soft    on-colour text, and a soft tinted background per status
--accent             per-tab mana colour (set by the tab rules, see §4.7)
--scrim              playmat overlay colour+alpha (theme-tuned)
--mc-w/u/b/r/g/c/gold   MTG colour identity (game data, not UI chrome)
--player-0…7         categorical palette for player identity
```

### 4.3 Type scale

Base 16px. Seven steps replacing the current **38 distinct `font-size` values**.

| Token | Value | px | Use |
|---|---|---|---|
| `--text-2xs` | `.6875rem` | 11 | Badges, pips, dense metadata |
| `--text-xs` | `.75rem` | 12 | Table secondary, captions, help text |
| `--text-sm` | `.8125rem` | 13 | Table body, chips, buttons |
| `--text-base` | `.875rem` | 14 | **App default** — dense data app, not a blog |
| `--text-md` | `1rem` | 16 | Prose: oracle text, rulings, long-form |
| `--text-lg` | `1.25rem` | 20 | Section headings, card name in detail |
| `--text-xl` | `1.75rem` | 28 | Page/tab title, the only display size |

Weights: **400, 500, 600, 700 only.** No 800 — the current `font-weight: 800` on brand text
and badges goes to 700.

Leading: `--leading-tight: 1.25` (headings, table rows), `--leading-normal: 1.5` (prose).

`text-transform: uppercase` is **banned except** on `--text-2xs` badges. The uppercase +
letterspaced `.72rem` panel title is one of the strongest dated tells in the current sheet
and is removed by §7.2.

### 4.4 Spacing scale

4px base. Six steps replacing **22 distinct `gap` values and 99 distinct `padding` declarations**.

| Token | Value | px | Use |
|---|---|---|---|
| `--space-1` | `.25rem` | 4 | Icon-to-label, pip gaps |
| `--space-2` | `.5rem` | 8 | Inside controls, chip padding |
| `--space-3` | `.75rem` | 12 | Grid gutters, control gaps |
| `--space-4` | `1rem` | 16 | Section padding, toolbar padding |
| `--space-5` | `1.5rem` | 24 | Between major sections |
| `--space-6` | `2rem` | 32 | Page top/bottom rhythm |

### 4.5 Radius and elevation

Three radii replacing the current 3/4/5/6/7/8/9/10px spread:

```
--radius-sm:   4px    /* chips, badges, inputs, small buttons */
--radius-md:   8px    /* cards, panels, modals, images */
--radius-full: 999px  /* pills, avatars, toggles */
```

**Elevation rule — this is the core of "recede":**

> A surface gets **either** a border **or** a shadow. Never both, and never both plus a
> background step.

- **Flat surfaces** (sections, toolbars, table containers): `--border` hairline only. No shadow.
- **Overlays only** (dropdown menus, modals, tooltips, drag previews, the card modal, and a
  hover-lifted card — see §15.2): shadow, no border.
- **Card images**: no border, no shadow at rest — the art is its own edge. A `--border` hairline
  is permitted only on placeholder/loading states.

```
--shadow-overlay: 0 4px 16px -2px rgb(0 0 0 / .30), 0 1px 3px rgb(0 0 0 / .15);
--shadow-modal:   0 16px 48px -8px rgb(0 0 0 / .40);
--shadow-lift:    0 8px 24px -4px rgb(0 0 0 / .35);   /* hover-lift, see §15.2 */
```

Light themes override these to roughly half alpha. There is no `--shadow-raised` — flat
surfaces do not get one. This deletes the current `0 2px 12px rgba(0,0,0,.45)` from every panel.

> **Delivered** (issue 10): all three of the contrast theme's shadow tokens lead with
> `0 0 0 1px var(--border)`. "Overlays get a shadow and no border" assumes the lifted surface
> reads as a step above the page, and on that palette it does not — `--bg` is `#000000` and
> `--surface-1` is `#0a0a0a`, 1.06:1, under a black shadow — so a borderless dropdown or modal
> lost its edge on the one theme that can least afford it. A ring sits at the element's own
> edge rather than being cast beneath it, so the surface still declares one thing and still
> draws no border; it is the same distinction the linter makes when it exempts
> `0 0 0 <spread>` layers. The two side drawers (`.rss-panel`, `.db-search-panel`) are treated
> as flat rather than as overlays: pinned to the viewport edge, they have one visible edge, and
> these tokens all cast downward.

### 4.6 Breakpoints and measure

Three breakpoints replacing the current seven (640 / 720 / 860 / 861 / 900 / 1023 / 1024):

```
--bp-sm:  640px   /* compact phone */
--bp-md:  900px   /* nav switches: bottom bar ↔ sidebar; single ↔ two column */
--bp-lg: 1280px   /* wide desktop: denser grids, wider tables */
```

> **Migration note:** the sidebar/bottom-nav switch moves from 860/861px to 900px, and the
> Card-tab modal-vs-page switch moves from 1023/1024px to 900px. Both are deliberate; verify
> on a tablet-width viewport during Phase 4.

```
--measure: 72ch   /* max line length for prose */
```

### 4.7 Mana accent — reduced surface area

The per-tab `--accent` mapping is **kept exactly as it is** ([style.css:151-161](public/css/style.css#L151-L161)):

| Tab | Accent | Tab | Accent |
|---|---|---|---|
| Available@ | `--mc-u` blue | Set Browser | `--mc-w` white |
| Collections | `--mc-g` green | Want Lists | `--mc-b` black |
| Players & Decks | `--mc-gold` | Mana Base | `--mc-g` green |
| Scryfall Search | `--mc-r` red | Deck Builder | `--mc-u` blue |
| Card | `--mc-gold` | Pick Night / Admin | `--primary` |

What changes is **where it is allowed to appear**:

| Allowed | Removed |
|---|---|
| Active nav item — text + 2px indicator | The 3px bar on every `.panel-title` (`::before`) |
| Focus ring on inputs and buttons | `color-mix(… 16%)` hover background tints |
| Active state of view/sort toggles | Accent borders on hover for cards and tiles |
| Selected chip in a filter row | Accent-tinted box-shadows on focused tiles |

Net effect: an idle screen has **no accent colour** except the one active nav item. Colour on
screen comes from card art.

> **Delivered** (issue 10): seven sites survive, all of them states — the focus ring, the
> active item in each of the three navs, the active RSS toggle, the active theme-picker row,
> and the selected printing tile on the Card tab. The last of those is visible at rest, which
> the "no accent when idle" line reads as forbidding and the *selected chip* row above permits;
> selected state won. The view toggle was **not** moved onto the accent this table allows it:
> the repaint left `--primary` near-neutral, so leaving it there recedes further than taking
> the licence would.

---

## 5. The five themes

All five slots are kept and repainted. They differ by **temperature, not hue** — surfaces are
near-neutral so the mana accent and the card art are the only saturated things on screen.

| id | Name | Character | Replaces |
|---|---|---|---|
| `dark` | Dark | Cool near-black | `dark` |
| `dusk` | Dusk | Warm near-black | `forest` |
| `light` | Light | Cool off-white | `light` |
| `sepia` | Sepia | Warm paper | `sepia` |
| `contrast` | High Contrast | Pure black, AAA text | `contrast` |

> **Migration:** `localStorage.mtgtools_theme === 'forest'` maps to `'dusk'` on read. `forest`
> is retired because the repainted theme is warm-neutral, not green — the name would lie.
> **This conflicted with [ui.md](ui.md), which named Forest as a theme to support; resolved in
> favour of Dusk — see §15.1.**

> **Delivered:** the palettes below are the design intent; `public/css/tokens.css` is the
> authority on the values actually shipped. They differ where measurement disagreed with the
> eye: `scripts/check-contrast.js` measures every foreground/background pair on screen, and
> the light and sepia player colours, their yellow mana colours, `--text-subtle`, and the
> contrast theme's `--border` were all darkened or lightened until each cleared its floor.
> The palettes here also do not name `--primary-dk/-lt/-tx`, `--hdr-bg/-fg` or the `*-fg`
> status inks, all of which the app uses and the token file defines.

### 5.1 `dark` — cool (default)

```css
:root, html[data-theme="dark"] {
  --bg:            #0e1013;
  --surface-1:     #15181c;
  --surface-2:     #1c2026;
  --surface-3:     #242931;
  --border:        #262c34;
  --border-strong: #39414b;
  --text:          #e7eaee;
  --text-muted:    #98a1ad;
  --text-subtle:   #6b7381;
  --primary:       #e7eaee;   /* near-white fill on dark */
  --primary-fg:    #0e1013;
  --success:       #4ec78a;  --success-soft: #12291f;
  --warning:       #e0b055;  --warning-soft: #2a2214;
  --danger:        #f0736b;  --danger-soft:  #2e1614;
  --scrim:         rgb(14 16 19 / .82);
  --mat:           #171b20;   /* Deck Builder felt surface, see §15.3 */

  --mc-w: #e3d7a1; --mc-u: #6ba8dd; --mc-b: #a596bd;
  --mc-r: #e2665a; --mc-g: #59b077; --mc-c: #a3aab8; --mc-gold: #d9b955;

  --player-0: #7aa2f7; --player-1: #6cc58c; --player-2: #e0a458; --player-3: #e2707a;
  --player-4: #d7c65a; --player-5: #b28cf0; --player-6: #5fc9d8; --player-7: #e589c0;
}
```

### 5.2 `dusk` — warm dark

```css
html[data-theme="dusk"] {
  --bg:            #121010;
  --surface-1:     #191614;
  --surface-2:     #201d19;
  --surface-3:     #292520;
  --border:        #2d2823;
  --border-strong: #453e37;
  --text:          #eeeae5;
  --text-muted:    #a89e94;
  --text-subtle:   #7a7168;
  --primary:       #eeeae5;
  --primary-fg:    #121010;
  --success:       #5cc088;  --success-soft: #16261d;
  --warning:       #dfae5c;  --warning-soft: #2b2214;
  --danger:        #ef7466;  --danger-soft:  #2e1815;
  --scrim:         rgb(18 16 16 / .82);
  --mat:           #1c1815;

  --mc-w: #e6d9a4; --mc-u: #74a6d4; --mc-b: #a998b6;
  --mc-r: #e26b58; --mc-g: #5faf73; --mc-c: #a8a49b; --mc-gold: #dbb95e;

  --player-0: #85a3ef; --player-1: #74c28c; --player-2: #e3a75c; --player-3: #e4767c;
  --player-4: #d9c463; --player-5: #b490e8; --player-6: #6cc4cd; --player-7: #e58cb9;
}
```

### 5.3 `light` — cool

```css
html[data-theme="light"] {
  --bg:            #f5f6f8;
  --surface-1:     #ffffff;
  --surface-2:     #f0f2f5;
  --surface-3:     #e6e9ee;
  --border:        #e0e4ea;
  --border-strong: #c2c9d3;
  --text:          #14181d;
  --text-muted:    #5b636e;
  --text-subtle:   #858d99;
  --primary:       #14181d;   /* near-black fill on light */
  --primary-fg:    #ffffff;
  --success:       #1a7f4f;  --success-soft: #e4f4ea;
  --warning:       #96660c;  --warning-soft: #fbf0dc;
  --danger:        #bf3025;  --danger-soft:  #fbe6e4;
  --scrim:         rgb(245 246 248 / .84);
  --mat:           #e9ecf1;

  --mc-w: #8f7118; --mc-u: #2a6ba8; --mc-b: #5f5180;
  --mc-r: #b83a2e; --mc-g: #2a7a4a; --mc-c: #616875; --mc-gold: #a8821a;

  --player-0: #2f5fbf; --player-1: #24794c; --player-2: #a4650f; --player-3: #b03445;
  --player-4: #8a7410; --player-5: #6d3fb5; --player-6: #16707f; --player-7: #a83c7e;
}
```

### 5.4 `sepia` — warm light

```css
html[data-theme="sepia"] {
  --bg:            #f7f3ec;
  --surface-1:     #fffdf8;
  --surface-2:     #f2ece1;
  --surface-3:     #eae2d4;
  --border:        #e5ddce;
  --border-strong: #cdc1ac;
  --text:          #1f1b15;
  --text-muted:    #6b6151;
  --text-subtle:   #948977;
  --primary:       #1f1b15;
  --primary-fg:    #fffdf8;
  --success:       #1f7a4c;  --success-soft: #e6f1e4;
  --warning:       #8e6209;  --warning-soft: #f7ecd6;
  --danger:        #b53228;  --danger-soft:  #f7e3de;
  --scrim:         rgb(247 243 236 / .84);
  --mat:           #ece4d6;

  --mc-w: #8a6d17; --mc-u: #2d6699; --mc-b: #635541;
  --mc-r: #b03c2c; --mc-g: #2f7548; --mc-c: #6b6354; --mc-gold: #9c7a1f;

  --player-0: #33589f; --player-1: #2a7048; --player-2: #97600f; --player-3: #a83b3d;
  --player-4: #806c10; --player-5: #6a4099; --player-6: #1c6a72; --player-7: #9c3c70;
}
```

### 5.5 `contrast` — high contrast

Target **WCAG AAA (7:1)** for body text, minimum AA (4.5:1) for all UI text. This is the
accessibility theme; contrast ratios take priority over aesthetics.

```css
html[data-theme="contrast"] {
  --bg:            #000000;
  --surface-1:     #0a0a0a;
  --surface-2:     #141414;
  --surface-3:     #1f1f1f;
  --border:        #555555;   /* deliberately visible, unlike other themes */
  --border-strong: #808080;
  --text:          #ffffff;
  --text-muted:    #d6d6d6;
  --text-subtle:   #adadad;
  --primary:       #ffffff;
  --primary-fg:    #000000;
  --success:       #66e0a0;  --success-soft: #06231a;
  --warning:       #ffd166;  --warning-soft: #241d08;
  --danger:        #ff9184;  --danger-soft:  #2b100c;
  --scrim:         rgb(0 0 0 / .90);   /* strongest scrim — legibility first */
  --mat:           #0f0f0f;

  --mc-w: #f5e6ad; --mc-u: #8ccbff; --mc-b: #d2c2ea;
  --mc-r: #ff9484; --mc-g: #7ee0a0; --mc-c: #d0d5e0; --mc-gold: #ffd966;

  --player-0: #9dbcff; --player-1: #85dba4; --player-2: #f5bd76; --player-3: #ff9099;
  --player-4: #ecd977; --player-5: #c9a8ff; --player-6: #7fdbe8; --player-7: #f5a3d0;
}
```

### 5.6 What this fixes

- **`.p0`–`.p7` player colours** ([style.css:1547-1554](public/css/style.css#L1547-L1554)) currently
  have **zero per-theme overrides** — they are dark-theme values shown on every theme. They
  become `--player-0…7` tokens, defined per theme. Chip backgrounds use
  `color-mix(in srgb, var(--player-N) 18%, transparent)` rather than a hardcoded `33` alpha suffix.

  > **Delivered in two halves.** Issue 09 defined the tokens per theme; issue 15 moved the app
  > onto them, which was the harder half — the colours are not in the stylesheet at all but in
  > the *data*, one hex per player record, so a player's colour had to become a slot the theme
  > paints (`playerSlot()` in [state.js](public/js/state.js), mirrored server-side). The mix is
  > over `--surface-2` rather than `transparent`: a chip on the page and a chip on a section
  > would otherwise be two different colours.
- **`--success` and `--warning` did not exist.** The raw `#10b981` (owned/found) and `#fbbf24`
  (warning) values scattered through the sheet become tokens.
- **~89 theme-blind declarations** (45 hex + 44 `rgba()` outside the theme blocks) are converted,
  minus the documented over-art exemptions.

---

## 6. Typography

### 6.1 Font

**Inter Variable**, self-hosted. No build step, no external request.

```
public/fonts/InterVariable.woff2          (roman)
public/fonts/InterVariable-Italic.woff2   (italic — needed for card flavour text)
```

```css
@font-face {
  font-family: 'Inter';
  src: url('../fonts/InterVariable.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
/* + matching italic face */

:root {
  --font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace;
}
```

The system stack is retained as fallback so a failed font load degrades to today's appearance
rather than to Times New Roman.

### 6.2 Tabular figures

Prices, quantities, collector numbers, mana values and counts **must** align in columns:

```css
.td-num, .price, .qty, .cmc, .collector-no, table td { font-variant-numeric: tabular-nums; }
```

### 6.3 Mana text

`'Courier New'` ([style.css:511](public/css/style.css#L511), [style.css:1194](public/css/style.css#L1194))
is replaced by `--font-mono`. Where mana symbols render as glyphs via mana-font, prefer the
glyphs over monospaced text.

---

## 7. Component rules

### 7.1 Section (replaces `.panel`)

`.panel` is renamed to `.section` and loses its box treatment.

```css
.section {
  background: transparent;      /* was var(--card) */
  border: none;                 /* was 1px solid var(--border) */
  box-shadow: none;             /* was var(--shadow) */
  padding: 0;                   /* was 1.25rem 1.5rem */
  margin-bottom: var(--space-5);
}
```

A section that genuinely needs containment (a form, a collapsed drawer) opts in with
`.section--boxed`, which adds `background: var(--surface-1)`, a `--border` hairline and
`--radius-md` — **still no shadow**.

### 7.2 Section heading (replaces `.panel-title`)

```css
.section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  text-transform: none;          /* was uppercase */
  letter-spacing: normal;        /* was .7px */
  color: var(--text-muted);
  margin-bottom: var(--space-3);
  padding-left: 0;               /* was .7rem — the accent bar is gone */
}
```

The `::before` 3px accent bar is deleted.

### 7.3 Toolbar

The unified control strip that replaces stacked panels. One horizontal row, sticky under the
page title on scroll.

```css
.toolbar {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 5;
  background: var(--bg);
}
```

Order, left to right: **search input → result count → spacer → view toggle → card-size control
→ sort → columns → `⋯` overflow.** Anything that isn't one of those goes in the `⋯` menu or a
drawer. (Card-size control is from [ui.md](ui.md) §3 — see §15.4.)

> **Delivered** (issue 13) with three changes. The block padding is `--space-1`, not
> `--space-2`: the controls are 36px tall on their own, so the padding is the whole of what
> the strip costs above the cards, and §9.1's fold is the number the tab is measured
> against. There is no separate spacer element — the result count is `flex: 1` and does the
> pushing, ellipsising rather than wrapping so the strip stays one row. And `top: 0` holds
> only above 900px: below it the mobile header is sticky and opaque, so the toolbar stops at
> `--hdr-h`, which `js/main.js` measures off that header rather than restating as a constant
> that would drift.

### 7.4 Buttons

| Class | Treatment |
|---|---|
| `.btn-primary` | `background: var(--primary)`, `color: var(--primary-fg)`, `--radius-sm`, no shadow |
| `.btn-secondary` | transparent fill, `--border` hairline, `--text` label |
| `.btn-ghost` | no fill, no border; `--surface-3` on hover |
| `.btn-danger` | `--danger-soft` fill, `--danger` label |

Sizes: `--text-sm`, `padding: var(--space-2) var(--space-3)`, icon-only buttons square at the
same height. Minimum touch target **44×44px** on mobile.

> **`.btn-danger` delivered** (issue 18). Two rules in components.css already named it — the
> 44px touch target and the press feedback — against a class no stylesheet defined and no
> element wore, so both were quietly matching nothing. Available@'s "Remove me" was the
> treatment written out under a name of its own; it is the class now.

### 7.5 Focus

One rule, applied globally — this is where `--accent` earns its keep:

```css
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--accent, var(--primary));
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

The current `box-shadow: 0 0 0 3px color-mix(…)` focus rings are removed.

> **Delivered** (issue 10) with two changes. The selector is an explicit list rather than
> `:where()`, which has zero specificity and would have lost the `outline` property to the
> typed `input[type="text"]` selectors in `base.css`. And the `border-radius` is dropped: it
> reshapes the element while it is focused — squaring off the pill buttons and round avatars —
> and browsers already follow the element's own radius when drawing an outline.

### 7.6 Tables

- Container: `--surface-1` background (**opaque — required over playmat**, see §8.5),
  `--border` hairline, `--radius-md`, `overflow: auto`
- Header: `--surface-2`, sticky, `--text-xs`, weight 600, `--text-muted`
- Rows: `--text-sm`, `--leading-tight`, hairline `--border` bottom, no zebra striping
- Hover: `--surface-2`
- Numeric columns: right-aligned, `tabular-nums`
- Density: `padding: var(--space-2) var(--space-3)`

### 7.7 Card grid

Covers the List / Grid / XL / **Pile** modes already provided by
[sortui.js:171-181](public/js/sortui.js#L171-L181).

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--card-w), 1fr));
  gap: var(--space-3);
}
:root         { --card-w: 150px; }   /* user-adjustable — see §15.4 */
@media (max-width: 640px)  { :root { --card-w: 120px; } }
@media (min-width: 1280px) { :root { --card-w: 168px; } }
.card-grid--xl { --card-w: 220px; }
```

Grid cards have **no background, no border, no shadow at rest** — the card image is the object.
Ownership badges and quantity pips overlay the image directly. This is what lets the playmat
show through the gutters.

### 7.8 Overlays

Dropdown menus, the card modal, tooltips, drag previews: `--surface-1` fill, `--shadow-overlay`
(or `--shadow-modal`), `--radius-md`, **no border**. Modal backdrop: `rgb(0 0 0 / .5)` plus
`backdrop-filter: blur(2px)`.

### 7.9 Status colours

| Meaning | Token | Where |
|---|---|---|
| Owned / found | `--success` | Collection ownership dots, `.cq-found`, comparison ticks |
| Partial / pending | `--warning` | Partial ownership, account requests, stale data |
| Missing / error | `--danger` | Not owned, failed imports, destructive actions |

Soft variants (`--success-soft` etc.) are for chip and badge backgrounds only.

---

## 8. Layout

### 8.1 Shell

```
┌──────┬─────────────────────────────────────────────┐
│ nav  │  page title + toolbar (sticky)              │
│ 46px │─────────────────────────────────────────────│
│      │  content — full-bleed grids / measured prose│
└──────┴─────────────────────────────────────────────┘
```

### 8.2 Sidebar

- Desktop (≥900px): **defaults to collapsed, 46px**, icon-only. Expands to 186px on click;
  state persists in `localStorage.mtgtools_sidenav` (mechanism already exists,
  [main.js:50](public/js/main.js#L50) — only the default flips).
- Hover does **not** auto-expand — it causes layout thrash while scanning a grid.
- Below 900px: unchanged bottom nav.
- Active item: `--accent` text plus a 2px `--accent` indicator on the leading edge. No fill tint.

### 8.3 Width

`.container`'s `max-width: 1400px` is deleted. Replaced by two classes:

```css
.content-wide  { width: 100%; padding-inline: var(--space-4); }   /* grids, tables */
.content-prose { max-width: var(--measure); }                     /* prose, forms */
```

`.content-wide` applies to: Collections results, Scryfall results, Set Browser, Want Lists,
Deck Builder, Pick Night results, Available@ calendar.

`.content-prose` applies to: Card tab oracle text / rulings / legality, Add Collection form,
all Admin forms, login page, empty and error states.

> Deck Builder already does this via `.db-full-width` ([index.html:688](public/index.html#L688)).
> That class is replaced by `.content-wide` and the pane moves back inside the normal shell.

### 8.4 Page padding

Page inline padding drops from `1.5rem` to `--space-4` (1rem), and the section-level padding
is removed entirely (§7.1). Combined with the collapsed sidebar, horizontal chrome falls from
**284px to ~78px** at 1440px — from 20% of the window to 5%.

### 8.5 Playmat layering

```
z-index  content
  -2     body::before   → playmat image (fixed, cover, center)
  -1     body::after    → --scrim (fixed, full-viewport)
   0     page content   → grids show playmat through gutters
   1     data surfaces  → tables, forms: OPAQUE --surface-1, never translucent
   5     toolbar        → opaque --bg
   9     sidebar        → opaque --surface-1
```

```css
body::before {
  content: ''; position: fixed; inset: 0; z-index: -2;
  background-image: var(--playmat-image, none);
  background-size: cover; background-position: center;
}
body::after {
  content: ''; position: fixed; inset: 0; z-index: -1;
  background: var(--scrim);
  display: var(--playmat-scrim-display, none);
}
```

`--playmat-image` is set inline on `<html>` at boot from the user's preference. When unset,
both layers are inert and `--bg` shows through — zero cost for users without a playmat.

**The scrim is not optional and not user-adjustable.** Card art has no controlled value range;
the scrim is what makes arbitrary art safe on every theme.

---

## 9. Per-tab layout specs

Measured current state, and the target. Panel counts are from [index.html](public/index.html).

### 9.1 Collections — *worst offender: 5 sections, 3 titles, 2 toolbars*

**Now:** "Add Collection" section → "Collections" list section → search row section → view
toolbar → results. Cards start roughly 400px down the page.

**Target:**
- "Add Collection" moves into a **slide-over drawer**, opened from a `+ Add` button in the toolbar.
  Delete the auto-collapse behaviour — the drawer replaces it.
- The collections list becomes a **horizontal chip row** directly under the toolbar: one chip per
  collection showing name and card count, with its `⋯` menu (Refresh / Re-import / Remove) intact.
- Search row and view toolbar **merge into one `.toolbar`** (§7.3).
- Deck Comparison panel stays right-side on ≥1280px; below that it becomes a drawer from the
  same edge.
- Results grid becomes `.content-wide`.

**Result:** one toolbar + one chip row before cards. Chrome above the fold: ~400px → ~96px.

> **Delivered** (issue 13) at 102px, measured by `scripts/measure-layout.js` rather than
> eyeballed. Two notes. The chip row does not wrap — it scrolls sideways, because it is the
> last thing above the cards and has to cost one line whatever is in it. And the row's status
> badges and progress bar are gone rather than moved: the count *is* the progress
> ("1,240 / 5,600" while pages arrive), its colour is the status, and the source and update
> time sit on the chip's tooltip.

### 9.2 Scryfall Search — *1 section, 2 toolbars*

Merge the search row and view toolbar into one `.toolbar`. Results `.content-wide`. The
list/grid/XL/pile toggle uses §7.7 sizes. Remove the section box around results.

> **Delivered** (issue 14) at a 60px fold, measured. Two notes. The tip line that shared the
> second row — the query-syntax examples — is in the results empty state now rather than in
> the `⋯` menu §7.3 would send it to: it is for the person who has not searched yet, and
> that is precisely who is looking at the empty state. And the box "around results" was
> already gone: what wrapped this tab was a `.section` around the two control rows, and
> `.section` stopped being a box in issue 10. Deleting it is the merge.

### 9.3 Set Browser — *1 section, 2 toolbars*

Same merge as Scryfall. The set picker becomes a `.content-wide` grid of set tiles (code +
name + owned count), replacing the current list. Ownership dropdown and sort join the toolbar.
The "N of M owned" figure sits in the toolbar as the result count.

> **Delivered** (issue 14) at a 60px fold. **The picker is the tab's landing view**, not a
> band above the results: 120 tiles cannot sit permanently above a card grid the way a 220px
> scrolling box of pills could. Choosing a set replaces the tiles with its cards and puts the
> set on the toolbar as a `.chip` whose ✕ goes back — so the strip has two shapes, and the
> controls that act on cards (ownership, view, sort) exist only in the second.
>
> **The owned count needed a server to answer it.** Nothing in the app knew which cards are
> in a set: a collection is names and quantities, and the bulk cache is `oracle_cards`, one
> entry per name. `set-index.js` keeps the inverse — one row per (set, card name), filled by
> a background sweep of Scryfall's search API and thereafter permanent, since a released set
> does not change. Until the sweep reaches a set its tile says how big the set is instead,
> and the toolbar count says how far the sweep has got. The two sides of the number are
> computed independently — the tile from the index, the toolbar from the cards Scryfall
> returns — and a check asserts they agree.

### 9.4 Want Lists — *1 section, 1 title, 1 toolbar*

Player filter chip row stays but adopts the chip component (§7.9 soft backgrounds, `--player-N`).
Import/Export `⋯` menu stays in the toolbar. Table gets §7.6 treatment — this is a
prose-dense table, so the opaque surface rule matters most here.

> **Delivered** (issue 15) at a 94px fold, from 229. Four notes.
>
> **The add controls stayed on the strip.** Collections' add form went to a drawer because
> loading a collection is done once and then not for months; adding a card to a want list is
> what this tab is *for*. So the player select, the card field and `+ Add` are three of the
> strip's eight controls rather than a button that opens a form.
>
> **The chip carries the player's colour at 18% behind `--text`**, not as the label's own
> colour. That is what makes the criterion "legible on all five themes" hold by construction
> rather than by luck: of the forty label/fill pairs — eight slots on five themes — the worst
> is 8.99:1 against a 4.5 floor.
>
> **The palette moved from a stored hex to a stored slot.** `--player-0…7` were defined per
> theme by issue 09 and used by nothing — the app was still painting from an eight-hex list
> written for the dark theme, which is exactly why a light-theme chip was neon on white. A
> player's record holds `colorIdx` now; records written before the move hold a hex, and its
> index in the old list *is* the slot, so one derivation reads either form. `normalizePlayer`
> on the server derives it too, because the non-admin write guard compares every other player
> value-by-value and would otherwise refuse the first save after an upgrade.
>
> **§7.6's opaque container went on `.table-wrap`**, so it is every table in the app and not
> just this one — Collections' and Admin's tables are the same component and the same §8.5
> requirement applies to them. Sections stopped being boxes in issue 10 and grid cards have no
> surface at all; a table is the one thing in the app that is only text.

### 9.5 Deck Builder — *already full-width*

`.db-full-width` → `.content-wide`; pane returns inside the normal shell. `.db-topbar` adopts
`.toolbar`. The four deckview files keep their behaviour; only classes change. Category columns
use `--space-3` gutters.

> This is the tab [ui.md](ui.md) §2 rebuilds as a top-down playmat with piles. This spec
> defines the *surface* (`--mat`, §15.3) and the toolbar; ui.md defines the *interaction*.

> **Delivered** (issue 17), with the strip going one step further than the sentence above.
> `.db-topbar` was one of *three* control rows — the picker, the view/sort/filter row and the
> add-card row — and adopting `.toolbar` for the first of them alone would have left a bordered
> sticky strip with two loose rows under it. All three are the one strip, in the Set Browser's
> two shapes (§9.3): `[data-db-mode]` on the pane, and `.db-when-deck` on everything that acts
> on a deck's cards. What did not fit the strip's order went behind its `⋯` — New Deck, which
> is rare, and Search / EDHREC, which is a drawer button reduced to its icon.
>
> The save status is the strip's `.result-info`, in the position every other tab gives its
> result count: a deck's counts are on the stats bar, and what this tab has to say about the
> state of its data is whether the last edit is saved.
>
> **The mat is `#dbDeckContent`**, on `--mat` with a hairline — the one filled box left on the
> tab, and deliberately so. The token was defined by issue 09 and unused until now.

### 9.6 Card — *0 sections, prose-heavy*

The **most important `.content-prose` case.** Two-column on ≥900px: card image left (sticky),
text column right at `--measure`. Oracle text and flavour at `--text-md` / `--leading-normal`.
Rulings become a definition list, not a table. Legality badges use `--success-soft` /
`--danger-soft`. Printings gallery at the bottom is `.content-wide` `.card-grid`.

The desktop modal switch moves from 1024px to `--bp-md` (900px).

### 9.7 Pick Night — *2 sections, 2 titles*

Merge to one toolbar (player select + pick button). Results grid `.content-wide`, using
`.card-grid--xl` since the result is the point. The picked-deck reveal is the one place a
larger display size (`--text-xl`) is warranted.

> **Delivered** (issue 15) at a 133px fold. Three notes.
>
> **"Player select" stayed a chip row**, not a `<select>`. Choosing two to six people is a
> multiple selection, and it is the same control the Want List filters by — one component now
> (`.chip--select`), where `.pick-chip` had been written here and borrowed across tabs.
>
> **The deck pool is a drawer**, the second use of issue 13's component: sixty-three decks
> grouped by player is a long list, consulted at the start of an evening and then not again.
> Its count is on the button that opens it — `Deck Pool · 12 / 63` — since that is the one
> thing about the pool worth knowing without opening it.
>
> **The results area is not empty before the first roll.** With the pool behind a button, a
> tab that had been a page of deck names became a strip, a row of chips and nothing, so the
> results area says which step is outstanding — an empty pool and an unchosen table are
> different problems, and the strip's status line is a count rather than an instruction.
>
> On the grid: `.card-grid--xl`'s 220px is a *card* width, and these are landscape art tiles,
> so the same intent is 260px here — and `auto-fit` rather than `auto-fill`, which matters
> more than the number. There are never more than six results, and auto-fill's empty tracks
> would hold four picks at the minimum width and leave a third of a 1440px row blank.

### 9.8 Available@ — *3 sections, 1 title*

Calendar and "Best upcoming days" become a two-column `.content-wide` layout at ≥900px, single
column below. The "Who are you?" bar (admin/open-mode only) becomes a toolbar item, not its own
section. Availability dots use `--player-N`. Week-list mobile view keeps its behaviour, restyled
to §7.6 density.

> **Delivered** (issue 18). The bar is the tab's `.toolbar` rather than an item on someone
> else's — this tab has no search, count or view toggle, so the strip it earns is the one
> field it has. The calendar grid starts 104px down the window, from 210.
>
> "Availability dots use `--player-N`" was half true and the wrong half: the tags already
> named those tokens, through eight `.pN` classes, but the *N* was the name's position in a
> sorted list rather than the player's own slot. One person was one colour here and another
> on the four tabs that read `playerColor()`, and adding a name early in the alphabet
> repainted everybody. The slot is looked up per §5.6 now, with a hash of the name for the
> open-mode names that have no player record, and the eight classes are gone — `.name-tag`
> takes `--player` the way every other tab hands a colour to a chip.
>
> The ranking column is a fixed 320px rather than a fraction: what the window gains goes to
> the calendar cells, which use it, and not to the row a date and four names sit on.

### 9.9 Players & Decks — *0 sections, art tiles*

Deck tiles already use commander art as background — they are the model the rest of the app is
moving toward, and they keep their fixed white-over-art text under the §4.1 exemption. Changes:
tile grid `minmax(300px)` → `minmax(260px)` with `--space-3` gutters and `.content-wide`; tile
radius to `--radius-md`; the `rgba(99,102,241,.45)` hover on `.btn-dv-tile` becomes a neutral
white-alpha since the indigo belongs to no palette.

### 9.10 Mana Base — *4 sections, 5 titles*

Second-worst chrome ratio. The five titled sections collapse to two `.content-wide` columns
with `.section-title` headings and no boxes. Charts inherit `--mc-*` for colour identity —
this is the one place mana colour is data, not chrome, so it stays saturated.

> **Delivered** (issue 18), and three of the four sentences above had already happened by
> the time it was picked up: §7.1 took the boxes off every section in the app, issue 04 put
> the charts on `--mc-*`, and the two columns were the tab's own layout. What was left was
> the fifth heading — "Total Lands" was a title floating inside the deck-size section,
> held off it by an inline margin, and is a section of its own now, so the five headings
> are five sections — and the width.
>
> **`.content-wide` is the one instruction here that was wrong.** A calculator is a form,
> and §8.3 gives forms the reading behaviour: uncapped, a 2560px window put the six pip
> fields at one edge and the answer they produce at the other, 1318px apart with nothing in
> between. The layout is capped at 1240px — the pip row, the results column and the gap —
> which leaves 76px between the last field and the answer at any width above it.

### 9.11 Admin — *3 sections, 3 titles, 1 toolbar*

All forms `.content-prose`. The three sections become one page with `.section-title` headings.
User and request tables get §7.6 treatment. Admin is intentionally low-density and
text-forward; it does not need to be dense.

---

## 10. Playmat feature

### 10.1 Behaviour

A user picks a background: **none** (default), **a Scryfall card's art**, **a bundled preset**,
or **an uploaded image**. It renders behind all content, under a theme-tuned scrim, and shows
through the gutters of card grids.

### 10.2 Storage

Prefs reuse the **existing storage layer in [state.js](public/js/state.js)** — server DB with
automatic `localStorage` fallback ([state.js:18](public/js/state.js#L18),
[state.js:89-111](public/js/state.js#L89-L111)). Do **not** add a parallel prefs system.

```sql
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme         TEXT    NOT NULL DEFAULT 'dark',
  playmat_kind  TEXT    NOT NULL DEFAULT 'none',   -- none | scryfall | preset | upload
  playmat_ref   TEXT,                              -- scryfall id | preset id | filename
  playmat_url   TEXT,                              -- resolved image URL (scryfall/preset)
  updated_at    INTEGER NOT NULL
);
```

Follows the existing `CREATE TABLE IF NOT EXISTS` migration style in
[available-db.js](available-db.js). No column is added to `users`; prefs are a separate concern
with a separate lifetime.

### 10.3 Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/prefs` | Current user's prefs. Open mode: returns defaults. |
| `PUT` | `/api/prefs` | Update theme and/or playmat. Validates `playmat_kind`. |
| `POST` | `/api/prefs/playmat` | `multipart/form-data` upload. **403 in open mode.** |
| `DELETE` | `/api/prefs/playmat` | Clears playmat, deletes any uploaded file. |
| `GET` | `/playmat/:userId` | Serves the uploaded file. Auth-guarded like other routes. |

Rate-limit the upload endpoint via the existing `express-rate-limit` setup.

### 10.4 Upload constraints

- **Max 5 MB**, enforced before the file is written to disk
- **JPEG, PNG, WebP only.** **SVG is rejected** — it can carry script and would be a stored XSS
  vector on a same-origin route
- Type determined by **magic-byte sniffing**, not the client-supplied `Content-Type` or extension
- **One playmat per user.** Uploading replaces and deletes the previous file
- Stored at `data/playmats/<user_id>.<ext>` — [data/](data/) is already gitignored and is the
  established persistence location
- Served with the sniffed `Content-Type`. Helmet already sets `X-Content-Type-Options: nosniff`
- On user deletion, cascade removes the row; the file is deleted in the same handler

### 10.5 Scryfall source

Uses the existing [routes/scryfall-proxy.js](routes/scryfall-proxy.js) and the
[scryfall.js](public/js/scryfall.js) image cache — **no new external network calls**, matching
the constraint in [ui.md](ui.md). The picker is a card search (reusing the Want List
autocomplete component) whose result stores the card's `art_crop` URL in `playmat_url`.
`art_crop` rather than `normal`: it's the art without frame or text box, which is exactly a
playmat.

### 10.6 Rendering and mobile

- Applied via `--playmat-image` set on `<html>` at boot, before first paint, to avoid a flash
- `background-attachment: fixed` on desktop; **`scroll` on mobile** — `fixed` causes severe
  scroll jank on mobile Safari
- **Off by default on mobile** (<900px): costs bandwidth and paint time for something almost
  entirely hidden behind a full-width grid. Users can enable it explicitly
- Respects `prefers-reduced-data: reduce` — playmat suppressed
- The scrim (§8.5) is always on when a playmat is set

### 10.7 UI

Playmat picker lives in the sidebar next to the theme picker, in a shared **Appearance** popover:
theme selection, playmat source, hover-lift toggle ([ui.md](ui.md) §1), card-size control, and a
Remove action.

### 10.8 Open mode

No users exist, so: theme and playmat choice persist to `localStorage` via the existing
[state.js](public/js/state.js) fallback path; Scryfall art and presets work; **upload is
disabled** with an explanatory note rather than a hidden control.

---

## 11. CSS architecture

`public/css/style.css` (98KB, 634 rules) splits into five files, loaded in this order:

| File | Contents | Raw hex? |
|---|---|---|
| `tokens.css` | `:root` + all 5 theme blocks, every scale token | **Yes — only here** |
| `base.css` | Reset, `@font-face`, element defaults, typography, `.content-prose` | No |
| `layout.css` | App shell, sidebar, toolbar, `.content-wide`, breakpoints, playmat layers | No |
| `components.css` | Buttons, inputs, tables, chips, badges, menus, modals, card grid | No |
| `tabs.css` | Per-pane rules for all 11 tabs | No |

```html
<link rel="stylesheet" href="css/tokens.css">
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/layout.css">
<link rel="stylesheet" href="css/components.css">
<link rel="stylesheet" href="css/tabs.css">
```

Load order **is** cascade order — later files may override earlier ones, never the reverse.
`compression` is already enabled in [server.js](server.js), so five files cost five cheap
round trips locally, not five uncompressed payloads.

### 11.1 Enforcement

A `scripts/lint-css.sh` run manually (or from a pre-commit hook) fails on:

1. Any `#hex`, `rgb(`, `rgba(`, `hsl(` outside `tokens.css` without an exemption comment
2. Any `font-size` not referencing `var(--text-*)`
3. Any `padding` / `margin` / `gap` with a raw rem/px value not in the scale
4. Any `border-radius` not referencing `var(--radius-*)`
5. Any `box-shadow` on a non-overlay selector
6. Any `!important` beyond an allowlist (currently 15 occurrences; target 0)

---

## 12. Verification

### 12.1 `?theme=` override

[main.js:84](public/js/main.js#L84) currently reads only `localStorage`. It gains a URL
override, checked first:

```js
const urlTheme = new URLSearchParams(location.search).get('theme');
applyTheme(urlTheme || localStorage.getItem('mtgtools_theme') || 'dark');
```

Validated against the known theme ids. Useful for debugging beyond screenshots — a bad theme
preference currently can't be cleared without devtools.

### 12.2 Screenshot script

`scripts/shoot.sh` — no new dependencies; uses the installed Firefox and the existing hash
routing ([main.js:256](public/js/main.js#L256), [main.js:296](public/js/main.js#L296)).

```
for tab   in available collections players scryfall card sets wants lands deckview pick admin
for theme in dark dusk light sepia contrast
for size  in 1440x900 390x844
  firefox --headless --window-size=$W,$H \
          --screenshot "$OUT/$tab-$theme-$size.png" \
          "http://localhost:3000/?theme=$theme#$tab"
```

Output to `screens/before/` and `screens/after/` (gitignored). Run against open mode
(`ADMIN_PASSWORD` unset) so no login is needed.

**110 screens** per run: 11 tabs × 5 themes × 2 viewports.

### 12.3 Per-phase gate

Every phase ends with: capture, compare against the previous phase, and confirm no pane is
blank, no text is illegible on any theme, and `npm test` still passes. A phase is not done
until this runs clean.

---

## 13. Build plan

Phases are ordered so the risky, wide-reaching work happens while the safety net is newest.

| # | Phase | Work | Done when |
|---|---|---|---|
| **0** | Scaffolding | Split CSS into 5 files (pure move, zero visual change). Add Inter. Add `?theme=`. Write `shoot.sh`. Capture `screens/before/`. | 110 baseline screens captured; app looks **identical** to before |
| **1** | Token contract | Add all scale tokens. Convert the ~89 theme-blind declarations. Add `--success`/`--warning`, `--player-0…7`. Write `lint-css.sh`. | Lint passes; no visual change beyond corrected colours |
| **2** | Theme repaint | Replace all 5 palettes (§5). Map `forest` → `dusk` (pending §15.1). | All 5 themes coherent; contrast theme hits AAA body text |
| **3** | Recede | Elevation rule: strip shadows/borders from flat surfaces. `.panel` → `.section`. Kill the uppercase title and its accent bar. Reduce accent surface area (§4.7). Apply type and spacing scales. | Idle screen shows no accent colour except active nav |
| **4** | Layout | Delete `max-width: 1400px`. `.content-wide` / `.content-prose`. Sidebar collapsed by default. Consolidate 7 breakpoints to 3. | Grids full-bleed; oracle text ≤72ch; horizontal chrome ~78px at 1440px |
| **5** | Card tabs | Chrome surgery on Collections, Scryfall, Sets, Wants, Deck Builder, Card, Pick (§9.1–9.7). | Collections shows cards within ~96px of the top |
| **6** | Remaining tabs | Available@, Players & Decks, Mana Base, Admin (§9.8–9.11). | No pane still uses boxed panels |
| **7** | Mobile | Verify and design every above decision at 390px. Touch targets ≥44px. | Mobile screens pass the same gate |
| **8** | Playmat | Schema, endpoints, upload validation, picker UI, scrim, mobile default-off (§10). | Playmat works on all 5 themes with tables still legible |
| **9** | Offline | Self-host mana-font and jsPDF, removing both CDN `<link>`/`<script>` tags. | App renders fully with the network disabled |

Phases 0–4 are global and sequential. Phases 5–6 are per-tab and can be done one tab at a
time. Phase 8 is independent of 5–7 and can be reordered if you want the playmat sooner.

**The [ui.md](ui.md) interactivity work should land after Phase 5** — hover-lift, piles and the
size control all depend on the card grid and toolbar defined here.

---

## 14. Acceptance criteria

The redesign is done when all of these hold:

1. **Space** — at 1440px, horizontal chrome ≤80px (from 284px); Collections renders card art
   within 100px of the viewport top (from ~400px)
2. **Recede** — no screen at rest displays accent colour except the active nav item; no flat
   surface carries both a border and a shadow
3. **Themes** — all 5 themes correct on all 11 tabs; `lint-css.sh` reports zero raw colour
   outside `tokens.css`; player chips are theme-correct
4. **Type** — ≤7 font sizes in use; all numeric columns tabular; no uppercase outside badges
5. **Full width** — grids and tables use all available width; no prose line exceeds 72ch
6. **Playmat** — settable from Scryfall art or upload, per-user, legible on every theme, with
   tables and forms fully opaque
7. **Mobile** — all of the above verified at 390px; touch targets ≥44px
8. **Nothing lost** — `npm test` passes; every feature listed in [README.md](README.md) still works
9. **Offline** — no external network request at runtime

---

## 15. Reconciliation with ui.md

[ui.md](ui.md) — the "Cards on a Table" brief — was written independently of this spec. The two
are complementary: **this document defines the visual system; ui.md defines interaction.** Four
points need resolving before either is built.

### 15.1 Theme names — **decided: (a)**

ui.md named the five themes *Dark / Light / High-Contrast / Sepia / **Forest***. This spec
retires `forest` and replaces it with `dusk` (warm neutral dark), because the repainted theme
has no green in it. The options were:

- **(a)** Accept `dusk`, and update ui.md's theme list — recommended, the name should match the
  paint; or
- **(b)** Keep the id and name `forest`, and repaint it warm-green rather than warm-neutral,
  accepting one hue-bearing theme in an otherwise neutral set.

**(a) was taken** in the theme repaint (issue 09): ui.md's list now says Dusk, `THEME_ALIASES`
in `public/js/main.js` maps a stored `forest` to `dusk` on read, and `public/login.html`
repeats the mapping because it reads the preference before the app's own code runs.

Everything else in ui.md's theming constraint ("must work in all 5 themes, use existing CSS
variables, not hardcoded colors") is exactly §4.1 and is already satisfied.

### 15.2 Hover-lift vs. "recede" — **compatible, no conflict**

ui.md §1 wants a hover-lift with shadow and tilt. This spec removes shadows from *flat surfaces*
at rest — a lifted card is a **transient overlay**, which §7.8 explicitly permits. Use
`--shadow-lift` (§4.5). The two rules coexist:

- At rest: card images have no shadow and no border
- On hover: `transform: scale()` + `--shadow-lift` + raised `z-index`

ui.md's constraint that the **layout hitbox must not change** is correct and is the right call —
transform-only lifting keeps the grid stable and avoids reflow thrash.

### 15.3 Two different "playmats" — **both, unified**

The word means different things in the two documents:

- **ui.md §2**: a felt mat *surface inside the Deck Builder* that piles sit on
- **This spec §10**: a *user-chosen background image* behind the whole app

They should unify rather than compete: the Deck Builder mat uses the `--mat` token (defined per
theme in §5) as its base, and **when the user has set a playmat image, the Deck Builder mat is
that image** — under the same §8.5 scrim, with pile surfaces staying opaque. A user who has set
Underground Sea's art as their playmat builds their deck on it. That is the best version of both
ideas.

### 15.4 Card-size control supersedes fixed `--card-w`

ui.md §3 wants a user-adjustable card image size, persisted per view. That **replaces** the
fixed `--card-w` values in §7.7: the token stays, but its value becomes user-controlled, with
the §7.7 numbers as defaults and the responsive overrides as floors. The control belongs in the
`.toolbar` (§7.3) and the Appearance popover (§10.7).

ui.md's requirement that **List view stays a plain fast text view** is consistent with §7.6 —
the table treatment is deliberately dense and has no images.
