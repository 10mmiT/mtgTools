# Spec: UI Redesign — "The cards are the content"

**Triage label:** `ready-for-agent`
**Companion documents:** the implementation-level design spec (tokens, per-tab layouts, exact
palettes) and the "Cards on a Table" interactivity brief.

---

## Problem Statement

MTG Tools is a card app whose interface gets in the way of looking at cards.

On a normal laptop window, roughly a fifth of the screen width is spent on application chrome
before a single card image appears. On the Collections tab — the tab most used — a person must
scroll past three or four stacked boxes ("Add Collection", the collections list, a search row, a
view toolbar) before reaching their cards. On a wide monitor the situation is worse in a
different way: the layout stops expanding partway across the screen and simply leaves the rest
of the display empty, so a large monitor shows no more cards than a small one.

The chrome is also visually loud. Every panel draws itself three times over — a background, a
border, and a drop shadow — so boxes compete with card art for attention. Headings are small,
uppercase and letterspaced with coloured bars beside them. The overall impression is dated, and
the owner describes it as looking amateur.

Underneath, the visual language has drifted. There is no type scale (38 different text sizes are
in use), no spacing rhythm (22 different gaps, 99 different padding declarations), and no radius
convention (eight different corner sizes). Roughly ninety colour decisions were never entered
into the theme system at all, which means the app's five themes are not equally supported: the
per-player colours used throughout the app have no light-theme values whatsoever, and status
colours such as "you own this card" are hardcoded to dark-theme values. Anyone using the light,
sepia or high-contrast themes sees a partially broken interface.

Finally, the app is personal software for a playgroup, but it looks like nobody's in particular.
There is no way to make it feel like *your* table.

## Solution

Rebuild the visual layer around a single principle: **the cards are the content, and the
interface is not.**

Concretely, the interface recedes and the cards expand:

**The chrome shrinks.** The stacked boxes on each tab collapse into one compact toolbar. The
"Add Collection" form moves into a drawer opened on demand, and the list of loaded collections
becomes a single row of chips. The sidebar opens in its narrow icon-only state by default. Card
grids and result tables use the entire width of the display, with no artificial cap — so a wide
monitor genuinely shows more cards. Long-form text (a card's rules text, its rulings, admin
forms) keeps a comfortable reading width instead of stretching into unreadable ribbons.

**The chrome quietens.** Panels stop drawing themselves three ways at once; a surface gets a
hairline or a shadow, never both, and only floating things like menus and modals get shadows at
all. Card images become the only raised objects on the page. The app's distinctive per-tab
Magic colour accent survives, but only as a state signal — the active navigation item and focus
rings — so a screen at rest carries no interface colour and all the colour on screen comes from
card art.

**The themes get fixed and repainted.** All five theme slots remain, but they are repainted as
near-neutral surfaces that differ by warmth rather than hue: a cool dark, a warm dark, a cool
light, a warm light, and a high-contrast theme meeting AAA text contrast. Every colour decision
in the app enters the token system, including the missing per-player palette and the missing
"owned" and "warning" status colours, so all five themes are correct on every tab for the first
time.

**The type becomes deliberate.** A single self-hosted typeface replaces the operating-system
default, so the app looks the same for everyone and gains true tabular figures — meaning price
and quantity columns finally line up. The 38 text sizes collapse to seven, the spacing values to
six, the corner radii to three, and the seven inconsistent responsive breakpoints to three.

**And the app becomes personal.** A new **playmat** feature lets each person set a background
for their own account: the art from any Magic card, a bundled preset, or an image they upload.
Because the panel boxes are gone, the playmat is what card grids now sit on, visible through the
gaps between cards — cards on a table. A theme-tuned veil always sits between the playmat and
the content so any artwork stays safe to read against, and data tables and forms keep an opaque
surface so dense text is never laid over artwork.

## User Stories

### Seeing more cards

1. As a collector browsing my collection, I want the card grid to fill the full width of my
   monitor, so that a larger display actually shows me more cards.
2. As a collector on an ultrawide monitor, I want no empty margins beside my results, so that I
   am not paying for screen space the app refuses to use.
3. As a collector opening the Collections tab, I want my cards visible without scrolling, so
   that I can start looking at cards immediately rather than scrolling past forms.
4. As a collector, I want the "Add Collection" form hidden until I ask for it, so that a task I
   perform rarely stops occupying space I use constantly.
5. As a collector with several collections loaded, I want them summarised as a compact row
   rather than a stacked list, so that they cost one line instead of a whole panel.
6. As a collector, I want the search field, result count, view toggle, sorting and column
   controls on one row, so that the controls take one strip instead of several boxes.
7. As a returning user, I want the sidebar to start narrow and icon-only, so that navigation
   costs a sliver of the window instead of a column of it.
8. As a user who prefers labelled navigation, I want to expand the sidebar and have it stay
   expanded, so that my preference is respected across visits.
9. As a user scanning a grid, I do not want the sidebar to expand when my pointer crosses it, so
   that the layout never shifts underneath me while I am reading.
10. As a person reading a card's rules text, I want a comfortable line length, so that long
    paragraphs are readable rather than stretched across the entire monitor.
11. As an admin filling in a form, I want the fields at a sensible width, so that inputs are not
    absurdly wide on a large display.

### A quieter interface

12. As a user, I want card art to be the most visually prominent thing on screen, so that the
    app feels like it is about Magic cards.
13. As a user, I want panels to stop drawing a background, a border and a shadow at once, so
    that the interface stops looking heavy and dated.
14. As a user, I want section headings in normal sentence case, so that the app stops shouting
    small uppercase labels at me.
15. As a user, I want an idle screen to show no interface colour beyond the active tab
    indicator, so that colour on screen means something.
16. As a Magic player, I still want each tab to carry its Magic colour identity, so that the app
    retains the character that makes it feel purpose-built.
17. As a keyboard user, I want a single consistent, clearly visible focus indicator, so that I
    always know where I am.
18. As a user, I want consistent corner radii and spacing throughout, so that the app feels
    built rather than assembled.

### Themes that actually work

19. As a light-theme user, I want per-player colours designed for a light background, so that
    player chips are legible instead of showing dark-theme colours.
20. As a light-theme user, I want "you own this card" indicators that suit my theme, so that
    ownership status is readable.
21. As a sepia-theme user, I want a full, correct theme rather than a partial one, so that my
    chosen theme is not visibly second-class.
22. As a low-vision user, I want a high-contrast theme meeting AAA contrast for body text, so
    that I can use the app comfortably.
23. As a user who likes dark interfaces, I want two distinct dark themes — one cool, one warm —
    so that I can pick the one that suits my room and screen.
24. As a user who likes light interfaces, I want two distinct light themes for the same reason.
25. As a user, I want my theme choice to follow me between my laptop and my phone, so that I set
    it once rather than per device.
26. As a maintainer, I want every colour in the app to come from the theme system, so that a new
    feature cannot silently ship broken on four of five themes.

### Type and data

27. As a collector comparing prices, I want price columns to align on the decimal, so that I can
    scan values down a column.
28. As a collector, I want quantities, mana values and collector numbers to align in their
    columns for the same reason.
29. As a user, I want the app to look the same on Windows, macOS and Linux, so that the
    experience is consistent for everyone in my playgroup.
30. As a user reading rules text and rulings, I want prose set at a comfortable reading size
    rather than the same size as table rows.
31. As a user, I want a small, consistent set of text sizes, so that hierarchy reads clearly.

### The playmat

32. As a player, I want to set a background for the app, so that my copy feels like my table.
33. As a player, I want to choose the artwork from any Magic card as my playmat, so that I can
    use a card that means something to me.
34. As a player, I want to upload my own image as a playmat, so that I am not limited to card
    artwork.
35. As a player without a strong preference, I want a small set of ready-made presets, so that I
    can get a good result without hunting.
36. As a player, I want my playmat visible through the gaps between cards in a grid, so that the
    cards genuinely look like they are lying on it.
37. As a player, I want to remove my playmat and return to a plain background at any time.
38. As a player, I want my playmat to follow me across devices, so that I set it once.
39. As a player who picks a bright artwork, I want the app to remain readable, so that a bad
    choice cannot make the app unusable.
40. As a player reading a dense table, I want the table to sit on a solid surface rather than
    over artwork, so that small text stays legible.
41. As a player on mobile data, I do not want a large background image downloaded by default, so
    that the app stays fast and cheap on a phone.
42. As a player on a phone who wants it anyway, I want to switch the playmat on explicitly.
43. As a deck builder, I want the Deck Builder's mat surface to be my chosen playmat, so that
    building a deck feels like laying cards out on my own table.
44. As an administrator, I want image uploads validated and size-limited, so that the feature
    cannot be used to fill the server's disk or serve hostile content.
45. As an operator running the app without a password, I want the appearance settings to still
    work, so that open mode is not a degraded experience.

### Mobile

46. As a phone user, I want the same visual improvements as on desktop, so that the app does not
    look dated on the device I most often carry.
47. As a phone user, I want touch targets large enough to hit reliably.
48. As a phone user, I want the bottom navigation and week-list calendar to keep working exactly
    as they do today, so that nothing I rely on is lost.

### Confidence in the change

49. As the owner, I want every feature described in the project README to still work afterwards,
    so that the redesign costs me no functionality.
50. As the owner, I want to compare before-and-after views of every tab in every theme, so that
    I can see what changed rather than trusting an assurance.
51. As the owner, I want an automated check that the colour, type and spacing rules are actually
    being followed, so that the system does not quietly drift back.
52. As the owner, I want the work delivered in phases, so that I can stop, judge and change
    direction without an all-or-nothing rewrite.
53. As the owner, I want the app to work with no internet connection, so that a self-hosted app
    does not depend on third-party content delivery networks.

## Implementation Decisions

### Approach

- This is a **refinement of the existing visual system, not a replacement**. The existing
  architecture — vanilla JavaScript, no build step, no framework, a single-page app with tab
  panes — is retained. No bundler or framework is introduced.
- All eleven tab panes are specified, with mobile at full parity. Implementation is **phased**,
  starting with the card-centric tabs, so the work can be judged and halted at any point.

### Design token system

- A **semantic token contract** is introduced. Tokens name the job a value does (surface,
  border, muted text) rather than the value itself, so they can be repainted per theme without
  renaming.
- **Raw colour values are permitted in the token definition module only.** Two documented
  exemptions: text and controls layered over card artwork may use fixed white or black, since
  their backdrop is an image rather than a theme surface; and colour-mixing an existing token is
  permitted anywhere.
- Fixed scales replace ad-hoc values: **seven type steps** (replacing 38 sizes), **six spacing
  steps** (replacing 22 gap values and 99 padding declarations), **three radii** (replacing
  eight), and **three responsive breakpoints** (replacing seven).
- Two tokens that did not previously exist are added — a **success/owned** colour and a
  **warning** colour — plus a **per-player categorical palette** of eight colours defined per
  theme. The per-player colours currently have no theme variants at all.

### Elevation rule

The single rule that produces the "recede" effect:

> A surface gets **either** a border **or** a shadow — never both, and never both plus a
> background step.

- Flat surfaces (sections, toolbars, table containers) get a hairline border and no shadow.
- Only floating things — dropdown menus, modals, tooltips, drag previews, and a hover-lifted
  card — get a shadow, and they get no border.
- Card images get neither at rest; the artwork is its own edge.

### Themes

- Five theme slots are retained but **repainted**. They differ by temperature rather than hue:
  cool dark, warm dark, cool light, warm light, and high contrast.
- The primary action colour becomes **near-neutral** (a near-white fill on dark themes, a
  near-black fill on light ones) so that it no longer competes with the per-tab Magic colour
  accent for the eye.
- The existing warm-dark theme is renamed, because the repainted theme is warm-neutral rather
  than green and the old name would misdescribe it. **A stored preference for the old name is
  migrated to the new one on read**, so nobody loses their setting.
- The high-contrast theme targets **WCAG AAA (7:1)** for body text and AA (4.5:1) for all
  interface text. Where contrast and aesthetics conflict in that theme, contrast wins.

### Magic colour accent

- The existing per-tab accent mapping is unchanged — each tab keeps the Magic colour it already
  has.
- What changes is **where the accent may appear**. It is permitted on the active navigation
  item, focus rings, active view/sort toggles, and selected filter chips. It is removed from
  section-heading bars, hover background tints, hover borders on cards and tiles, and
  accent-tinted shadows.
- Magic colour used as **data** — mana symbols, mana-curve charts on the Mana Base tab — is
  unaffected. That is card information, not interface chrome.

### Layout

- The fixed maximum content width is removed. Two width behaviours replace it: a **wide**
  behaviour for card grids and data tables that uses the full available width, and a **prose**
  behaviour capped at a readable measure for rules text, rulings, forms, admin screens, login,
  and empty states.
- The Deck Builder already escapes the width cap through a bespoke mechanism; that mechanism is
  replaced by the shared wide behaviour and the pane returns to the normal application shell.
- The sidebar **defaults to its collapsed icon-only state** on desktop. The collapse mechanism
  and its persistence already exist; only the default changes. Hover does not auto-expand,
  because that causes layout movement while a user is scanning a grid.
- Per-tab chrome consolidation: each tab's stacked panels collapse into a single sticky toolbar,
  ordered search field → result count → spacer → view toggle → card-size control → sort →
  columns → overflow menu. Anything else moves into the overflow menu or a drawer.

### Typography

- A **single self-hosted variable typeface** is added, with the current system font stack
  retained as a fallback so that a failed load degrades to today's appearance. No web font is
  loaded from a third party — this is a self-hosted application and must work offline.
- **Tabular figures** are applied to all numeric table content: prices, quantities, mana values,
  collector numbers and counts.
- The monospaced font used for mana text is changed from a specific legacy face to the platform
  monospace stack; where mana symbols can render as glyphs, glyphs are preferred.

### Playmat feature

- A playmat has one of four sources: **none** (default), **the art crop of a Magic card**, **a
  bundled preset**, or **an uploaded image**.
- Card art is sourced through the **existing Scryfall proxy and client-side image cache**. No
  new external network calls are introduced. The card picker reuses the existing want-list
  autocomplete component — which meant extracting that component from the want list into the
  shared UI helpers, so that there is one implementation with two callers rather than two. The
  **art crop** is used rather than the full card image, because it is the artwork without frame
  or text box — which is precisely what a playmat is. The stored reference is the card's
  **name**: it is what identifies a card everywhere else in this application, and it is what
  the picker must print back to say which card the mat is.
- Preferences are stored **per user on the server**, with automatic fallback to browser storage.
  The client persistence module already implements exactly this pattern (server database with
  local fallback); **it is reused rather than duplicated**. Theme selection moves into the same
  store, so appearance follows a user across devices.
- Preferences live in a **new table keyed by user**, not as columns on the user record, because
  they have a different lifetime and concern:

  ```sql
  CREATE TABLE IF NOT EXISTS user_prefs (
    username     TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
    theme        TEXT    NOT NULL DEFAULT 'dark',
    playmat_kind TEXT    NOT NULL DEFAULT 'none',   -- none | scryfall | preset | upload
    playmat_ref  TEXT,                              -- card id | preset id | filename
    playmat_url  TEXT,                              -- resolved image URL
    updated_at   INTEGER NOT NULL
  );
  ```

  The key is the username, which is what identifies a user in this application — the user
  record has no separate integer id.

  This follows the existing create-if-not-exists migration convention used elsewhere in the
  application's schema.

- **API contract**: read current preferences; update theme and/or playmat with server-side
  validation of the playmat kind; upload a playmat image; delete a playmat; and serve an
  uploaded playmat. The serving route is authenticated like every other non-public route. The
  upload route is rate-limited using the rate limiter already configured in the application.
- **Upload validation**: maximum 5 MB enforced before anything is written to disk; JPEG, PNG and
  WebP accepted; **SVG explicitly rejected**, because it can carry script and would become a
  stored cross-site-scripting vector on a same-origin route; file type determined by **inspecting
  the file's magic bytes**, never by the client-supplied content type or the filename extension.
  One playmat per user — uploading replaces and deletes the previous file. Files are written
  under the existing persistent data directory, which is already excluded from version control.
  Deleting a user cascades the preference row and deletes the file in the same operation.
- **Rendering**: the playmat and its veil are two fixed full-viewport layers behind all content.
  The image is applied at boot, before first paint, to avoid a flash. Data tables, forms, the
  toolbar and the sidebar remain **fully opaque** and are never made translucent.
- **The veil is always on and is not user-adjustable.** Card artwork has no controlled range of
  brightness — a bright Plains and a black Swamp require opposite treatments — so a fixed
  per-theme veil is what makes arbitrary artwork safe on every theme. Each theme's veil is
  **measured rather than chosen**: the contrast checker composites it over both white and black
  and holds the text colours to their floors against both, and each theme carries the lowest
  value that clears them, because everything above it is artwork nobody can see.
- **Attachment**: fixed on desktop, scrolling on mobile, because fixed attachment causes severe
  scroll stuttering on mobile browsers.
- **Mobile default is off**, since the image costs bandwidth and paint time for something almost
  entirely hidden behind a full-width grid; a user can enable it explicitly, on that device.
  That opt-in is the one appearance preference kept per browser rather than per person: it is a
  statement about a data plan, not about taste. The reduced-data preference is respected, and
  overrides the opt-in rather than the other way round.
- **Open mode**: when the application runs without an administrator password there are no user
  accounts, so preferences persist to browser storage, card art and presets work, and **upload is
  disabled with a visible explanation** rather than a hidden control.
- The Deck Builder's mat surface uses a dedicated per-theme token, and **when a user has set a
  playmat, the Deck Builder mat becomes that image** — unifying the app-wide background with the
  builder's table surface rather than having two competing notions of "playmat".

### Stylesheet organisation

- The single large stylesheet is split into **five files loaded in cascade order**: tokens,
  base, layout, components, and per-tab rules. Load order is cascade order — later files may
  override earlier ones, never the reverse.
- No build step is added. Response compression is already enabled, so the split costs additional
  requests rather than additional bytes.
- The token definitions live in their own small file specifically so that the raw-colour rule is
  auditable by looking at one place.

### Offline operation

- Two third-party content-delivery-network dependencies currently loaded at runtime (a Magic
  symbol font and a PDF generation library) are **self-hosted**, so that the application renders
  and functions with no internet connection.

## Testing Decisions

### What makes a good test here

A good test asserts **externally observable behaviour** — the response a client receives, or a
machine-checkable property of the delivered stylesheet. It does not assert internal structure:
not which function was called, not how a value is stored in memory, and not the specific markup
a component renders, since this redesign deliberately churns markup.

### Seams

**Two seams total.** Both were chosen to be the highest available, and one already exists.

**1. The existing HTTP seam (preferred, already in use).** The application's entire test suite
already drives the Express application through an HTTP client, against a temporary SQLite
database created per run. Every piece of playmat behaviour that can be tested is tested here,
because all of it is request/response behaviour:

- Reading preferences returns defaults for a user who has never set any.
- Updating preferences persists theme and playmat selection and returns the updated state.
- An invalid playmat kind is rejected.
- One user cannot read or modify another user's preferences.
- Uploading a valid JPEG, PNG or WebP succeeds and the image is subsequently served.
- Uploading an oversized file is rejected before anything is written to disk.
- Uploading an SVG is rejected.
- A file whose magic bytes disagree with its declared content type or extension is rejected —
  the declared type is never trusted.
- A second upload replaces the first, and the superseded file no longer exists.
- Deleting a playmat clears the preference and removes the file.
- Deleting a user cascades the preference row and removes the file.
- The serving route requires authentication.
- In open mode, reading preferences returns defaults and the upload route refuses with a clear
  error rather than a generic failure.

**2. A new static seam: the token-contract linter.** The visual redesign cannot be asserted over
HTTP, and its most valuable guarantee is a static property of the stylesheet. One new script
checks the delivered CSS and fails on:

- Raw colour values outside the token file that lack an exemption comment.
- Text sizes not drawn from the type scale.
- Spacing values not drawn from the spacing scale.
- Corner radii not drawn from the radius scale.
- Shadows applied to non-overlay surfaces.
- Uses of `!important` beyond a shrinking allowlist, currently fifteen, targeting zero.

This is the mechanism that stops the system drifting back into the state that caused this work.

### Not a test seam: screenshot capture

A capture script renders every tab in every theme at two viewport sizes — 110 views — using the
browser already installed on the development machine, the application's existing URL-based tab
routing, and a small new URL parameter for selecting a theme. This is a **human review aid, not
an automated assertion**: image diffing was considered and rejected, because during a redesign
every intentional change would produce a failure, training the owner to ignore the output.

Each phase of the work ends by capturing the set, comparing it against the previous phase, and
confirming that no pane is blank, no text is illegible on any theme, and the existing test suite
still passes.

### Prior art

The existing test suite is the model: `node:test` with a supertest client, a temporary database
per run, an administrator account seeded in setup, and tests grouped by behaviour rather than by
route. Existing coverage of authentication, permission rules and optimistic-concurrency
conflicts demonstrates the established pattern for authenticated request tests, which the
preference and upload tests follow directly.

## Out of Scope

- **Information architecture.** The eleven tabs remain eleven tabs, with their current names and
  purposes. This work does not merge, split, reorder or rename them.
- **Feature behaviour.** Nothing a user can do today stops working. Sorting, filtering, column
  selection, imports, exports, comparison, autosave, drag and drop, and multi-select all retain
  their current behaviour; only their appearance changes.
- **Any framework or build step.** No bundler, no module system, no component library. The
  application remains vanilla JavaScript served directly.
- **Backend changes beyond the playmat feature.** No other schema changes, no other endpoints,
  no changes to authentication, sessions or the Scryfall caching layer.
- **Card-level interaction design** — hover-lift, pile-based deck building, and the resizable
  card-image control are specified in the companion "Cards on a Table" brief and are not
  delivered by this spec. This spec defines the grid, toolbar and mat surface they build on, and
  that work should follow the card-tab phase of this one.
- **Image-diff regression testing.** Considered and rejected for the reasons given above.
- **Per-user or per-group theme authoring.** Users select from the five provided themes; they
  cannot define their own palettes. The playmat is the personalisation mechanism.

## Further Notes

- **Two decisions carry an explicit migration risk** and should be verified at tablet width
  during the layout phase: the navigation switch between bottom bar and sidebar moves from
  roughly 860 pixels to 900, and the card detail view's switch between modal and full page moves
  from roughly 1024 pixels to 900. Both are deliberate consequences of consolidating seven
  breakpoints into three.
- **The renamed theme** requires a read-time migration mapping the stored old value to the new
  one. Without it, existing users of that theme will silently fall back to the default.
- **One open question remains** between this spec and the companion interactivity brief: the
  brief names the warm-dark theme by its original name, while this spec renames it. Either the
  brief is updated to the new name, or the theme is repainted warm-green to keep the old name
  honest. The former is recommended.
- **Phase ordering is deliberate.** The wide-reaching global work happens first, while the
  before-and-after screenshot baseline is newest and comparison is most meaningful. The playmat
  feature is independent of the per-tab work and can be brought forward if desired.
- **The elevation rule and the hover-lift in the companion brief do not conflict**, though they
  appear to. A lifted card is a transient floating object, which the rule explicitly permits to
  cast a shadow; the rule only forbids shadows on flat surfaces at rest.
- **Measured baselines**, for judging whether the work succeeded: horizontal chrome of 284
  pixels at a 1440-pixel window, reducible to roughly 78; card art beginning roughly 400 pixels
  down the Collections tab, reducible to under 100; 38 text sizes, 22 gap values, 99 padding
  declarations, 8 radii, 7 breakpoints, and approximately 89 colour declarations outside the
  theme system.
