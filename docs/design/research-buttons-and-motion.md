# Research — making the interface feel physical

Nothing here has been implemented. This is a design model for how motion should
work in this app, the measurements it was derived from, and an assessment of
which outside libraries are worth anything against it —
[Easing Wizard](https://easingwizard.com/), [Animista](https://animista.net/),
[Uiverse](https://uiverse.io/), and the alternatives to the last of those.

The constraints every suggestion is written against are the ones in `ui.md`: no
framework, no build step, no external network call, colour only from
`tokens.css`, sizes only from the `--text-*` / `--space-*` / `--radius-*` steps,
a surface takes a border or a shadow and never both, and every duration
multiplied by a motion token. `scripts/lint-tokens.js` enforces all of it, so
"could we paste this in" has a definite answer rather than a matter of taste.

## The model

**Physicality has two channels, and they are not the same decision.**

- **Light** — the lit hairline along an object's top edge, the shade along its
  bottom, the shadow it casts, the sheen crossing its face.
- **Weight** — how it moves. Mass, inertia, whether it settles or stops dead.

The rule this document proposes:

> **Cards get both channels. Chrome gets weight only.**

Light stays card-only, which is not a new position — `tokens.css` already
states it at [line 256](public/css/tokens.css#L256):

> Surfaces are near-neutral so that card artwork and the per-tab Magic colour
> are the only saturated things on screen.

So the interface is not going to start catching the light. What it can do is
acquire mass: a drawer that has weight, a knob that rings when you flick it, a
button that returns under its own spring. That costs nothing in colour, breaks
no existing rule, and is the whole of the opportunity here.

Three consequences follow, and they are what the rest of this document is:

1. **Not everything has mass.** A colour change doesn't. A rotating chevron
   doesn't. The set that does is much smaller than it first appears.
2. **Overshoot is the signal of mass**, and it is unsafe on some properties.
3. **Cards keep the expressive extreme of both channels**; chrome gets the
   disciplined version of one.

## The measurement

Across the four stylesheets, with comments stripped and multi-line
declarations joined:

| | count |
|---|---|
| `transition:` declarations | 50 |
| …that name an easing curve | 7 |
| …that are therefore the browser default `ease` | 43 |
| distinct duration literals | 14 (81 uses) |

**But the 43 is not one problem.** Sorted by what they animate — and they
overlap, since one declaration can touch several properties:

| touches | count |
|---|---|
| paint — colour, background, border-colour, opacity, filter | 34 |
| movement — transform, translate, rotate, scale | 17 (12 chrome, 5 cards) |
| layout — width, padding, max-width | 5 |

Two-thirds of this app's chrome does not move. It changes colour. Mass is
meaningless there, so the physical programme is not 43 transitions — it is a
subset of the 12 chrome movement declarations, and those sort cleanly into
four groups:

| group | what | declarations |
|---|---|---|
| **panels** | `.drawer` ([components.css:330](public/css/components.css#L330), [332](public/css/components.css#L332)), `.deck-col` ([tabs.css:259](public/css/tabs.css#L259), [261](public/css/tabs.css#L261)), side panel ([tabs.css:2370](public/css/tabs.css#L2370)) | 5 |
| **controls** | `.tog-pill` knob ([tabs.css:346](public/css/tabs.css#L346)), button press ([components.css:1820](public/css/components.css#L1820)), `.pile-toggle` ([components.css:908](public/css/components.css#L908)) | 3 |
| **markers** | `.chevron` ([layout.css:452](public/css/layout.css#L452)), `.mob-nav-chev` ([390](public/css/layout.css#L390)), `.side-nav-toggle svg` ([355](public/css/layout.css#L355)) | 3 |
| **reveal** | tooltip ([components.css:1184](public/css/components.css#L1184)) | 1 |

**Panels and controls have mass. Markers and the reveal do not.** A chevron is
a symbol that reports state the way a colour does — it has no travel and no
weight, and a springing caret is the single most recognisable "cheap bounce"
tell on the web. A tooltip appearing is a reveal, not a throw.

So the mass model governs **8 declarations across 6 behaviours.** That is
small. Small and correct beats large and hand-wavy, and it makes the whole
programme cheap enough to try and cheap enough to revert.

The durations tell a related story. Three values cover 68 of the 81 uses
(`.15s` ×29, `.2s` ×21, `.12s` ×18) and eleven more are one-offs. Usefully,
the existing durations already agree with the mass model without anyone having
planned it: panels sit at `.2s`, controls at `.15s` and `.08s`. Heavier is
already slower. **Only the curves are missing.**

---

## The token set

Four easing tokens, each naming a *material* rather than a maths family —
which is the convention `tokens.css` already follows, naming the job a value
does rather than the value.

```css
/* Illustrative. The shapes are settled; the exact numbers get drawn in
   Easing Wizard against the real drawer and the real knob. */

--ease-panel:   /* heavy, damped, no ring — drawers and side panels     */
--ease-control: /* light, tight ring (~y 1.15) — knobs, presses, toggles */
--ease-land:    cubic-bezier(.3, 1.5, .6, 1);
                /* cards only. The existing curve, promoted to a name.   */
--ease-tint:    /* plain deceleration — paint, markers, reveals.
                   Never overshoots.                                     */
```

`--ease-land` stays card-only deliberately. It is the best motion in the app
and it currently sits as a literal at
[components.css:743](public/css/components.css#L743) where nothing can reach
it. Naming it makes it reusable — but reusing it everywhere is exactly how it
would stop meaning "a card just landed." A card is cardboard meeting felt: soft,
a big settle. A button is spring steel: tight, quick. Different materials get
different curves.

**Durations tokenise in the same pass, and there is a specific way they have to
be written.** `lint-tokens.js` says so itself, at
[lint-tokens.js:418-422](scripts/lint-tokens.js#L418-L422):

> The check is on time *literals* […] A duration hidden behind some other
> custom property — `transition: opacity var(--whatever)` — would slip past;
> tokens.css defines no duration tokens, and the day it does, that token's own
> definition is where the guard belongs.

So the motion guard bakes into the token rather than repeating at each call
site — which is also strictly better, because it makes forgetting the guard
impossible instead of merely detectable:

```css
--dur-tint:    calc(var(--motion-ui) * .12s);  /* paint, markers        */
--dur-base:    calc(var(--motion-ui) * .15s);  /* the default — 29 uses */
--dur-panel:   calc(var(--motion-ui) * .2s);   /* drawers, side panels  */
--dur-card:    calc(var(--motion)    * .28s);  /* the card layer        */
```

Three tokens absorb 68 of the 81 durations on the first commit. The linter
needs a small change to match: it must learn that these names resolve to
guarded times, and keep rejecting a bare literal everywhere else.

## The lint rule: overshoot is transform-only

This is the one genuinely load-bearing new rule, and it is a correctness rule
rather than a taste rule.

Five transitions animate layout-affecting properties — the sidebar's `width`
([layout.css:220](public/css/layout.css#L220)), `.site-main`'s `padding-left`
([291](public/css/layout.css#L291), a matched pair with the sidebar so the
content edge tracks it), the nav label's `max-width`
([326](public/css/layout.css#L326)), and two more at
[components.css:1243](public/css/components.css#L1243) and
[tabs.css:1006](public/css/tabs.css#L1006).

An overshooting curve on any of these is a bug, not a look. The sidebar would
grow *wider than* `--sidenav-width` mid-flight while the main content's padding
overshoots alongside it — content jitters right and comes back, with scrollbar
flicker as a bonus. And `max-width` collapsing to `0` has a hard floor, so the
undershoot gets clamped and opening no longer mirrors closing.

The sting is that a naive "scaled by mass" model assigns the *most* spring to
the sidebar, which is the heaviest chrome in the app and the least able to
afford it.

> **Overshoot curves are legal only on `transform`, `translate`, `rotate`,
> `scale`, `opacity` and `filter` — properties the compositor owns and that
> cannot reflow. Layout properties get deceleration.**

Worth enforcing rather than remembering, in a repo where every other design
rule already is. It is a cheap addition to `lint-tokens.js` — the motion guard
already parses these declarations — and it carries a performance argument for
free, since the springy paths are exactly the ones that never touch layout.

---

## The press

The button proposal that opened as "give buttons lit and shaded edges" is
**withdrawn**: light is card-only, so buttons cannot have it. What is left is
better anyway, because it is a real finding rather than a taste.

Today's press, [components.css:1818-1821](public/css/components.css#L1818-L1821):

```css
.btn-primary:active, .btn-secondary:active, .btn-danger:active {
  transform: translateY(1px);
  transition: transform calc(var(--motion-ui) * .08s);
}
```

The transition is declared **only on `:active`**. Entering the pressed state
therefore animates over .08s, and leaving it falls back to the base `button`
rule ([base.css:94](public/css/base.css#L94)), which transitions `background`
and `opacity` but not `transform` — so the release is instantaneous.

**The app eases the press and snaps the release, which is backwards.** A real
key moves the instant your finger pushes it; the spring is what governs the way
back. The fix is to swap them:

```css
/* base — the way back is the spring's */
.btn-primary, .btn-secondary, .btn-danger {
  transition: transform var(--dur-base) var(--ease-control);
}
/* pressed — your finger did this, not a curve */
.btn-primary:active, .btn-secondary:active, .btn-danger:active {
  transform: translateY(1px);
  transition: none;
}
```

Two lines, and it is the cheapest change in this document that would actually
alter how the app feels under the hand. It is also worth extending past the
three classes it covers: `.btn-update`, `.btn-remove`, `.btn-sm` and
`.kebab-btn` all press today and none of them acknowledge it.

**One open question worth prototyping, not deciding here.** At 1px of travel a
1.15 overshoot is 0.15px, which is below anything anyone can see — so the curve
may do nothing until the travel is deeper. GOV.UK's tested depth is 2px. The
`--space-*` scale starts at 4px and has no 2px step, but the linter governs
`padding`/`margin`/`gap`, **not** `transform`, so a 2px translate is not
actually blocked. Worth confirming against the script before assuming either
way.

## The flip

**You cannot turn a card over.** Every render path reaches for `card_faces[0]`
and stops — [deckview-render.js:589](public/js/deckview-render.js#L589),
[deckview-panels.js:368](public/js/deckview-panels.js#L368),
[sets.js:249](public/js/sets.js#L249) and more. There is no
`backface-visibility`, no `transform-style: preserve-3d`, and no back face
anywhere in `public/`. `cardquery.js:241` knows the layouts well enough to
*filter* on them, so the data is already there.

Scale, measured against the local snapshot of ~37,000 cards:

| layout | count | motion it wants |
|---|---|---|
| `normal` | 33,235 | none — no back |
| `transform` | 401 | **turn over** |
| `modal_dfc` | 100 | **turn over** |
| `double_faced_token` | 77 | **turn over** |
| `split` | 137 | rotate 90° *in plane* — not a turn |
| `art_series` | 2,243 | has a back, but it is the card back |

So this reaches **578 cards, about 1.5%.** That is smaller than it feels, and
the case for it is information rather than polish: for those 578 the app
currently shows one side of a two-sided object, and DFCs are common in modern
Commander.

**Turn-over only.** `rotateY` for the genuinely two-sided layouts and nothing
else. Split cards are perfectly readable at rest, so rotating them solves no
problem, and turning a card over versus rotating it in the plane are different
things your hand does — one control meaning both would read as arbitrary.

Two notes that follow from existing precedent rather than from a new decision:

- **At `--motion: 0` the face should still swap, instantly.** `.card-held`
  already sets this pattern — the state change survives when the movement is
  switched off. The flip is functional, not decorative, so someone who has
  turned "Cards move" off must still be able to see the back.
- **`--card-lit` / `--card-shade` do not swap during the turn** — the top edge
  is still the top edge — but both hairlines collapse at 90° when the card is
  edge-on. Worth looking at in a prototype.

---

## The libraries, against that model

### Easing Wizard — adopt

<https://easingwizard.com/> · MIT ([roydigerhund/easingwizard](https://github.com/roydigerhund/easingwizard))

A visual editor for CSS timing functions covering **Bézier**, **Spring**,
**Bounce**, **Wiggle** and **Overshoot**, with presets named `HEAVY`, `BOUNCY`,
`DROP`, `GLIDE`, `SNAP`, `LAZY`, `ELASTIC`. Physics families export as
`linear()` with a generated stop list, since a cubic Bézier has one hump and
cannot express a bounce; Bézier mode exports the familiar four numbers.

This is the tool for drawing the four tokens above, and it costs nothing at
runtime — the output is a string in a custom property. Nothing vendored,
nothing downloaded, the offline promise untouched.

Its **Wiggle** family also expresses `@keyframes avail-shake`
([tabs.css:677](public/css/tabs.css#L677)) as a timing function on a single
transform, which is less code than the hand-rolled keyframes.

**On `linear()` and reduced motion:** no conflict. The guard collapses duration
to `0s`, and at zero duration the timing function is irrelevant. The real
caveat is different — a browser that cannot parse the timing function drops the
*whole* `transition` declaration, so the element jumps rather than degrading to
another curve. Support has been universal since 2023 (Chrome 113 / Safari 17.2
/ Firefox 112), so this is a note rather than a risk.

### Animista — one idea, as reference

<https://animista.net/> · **BSD 2-Clause (FreeBSD)**, not MIT

A picker for CSS keyframes that emits only what you select, which suits a repo
with no build step. Most of its catalogue is wrong here — an app whose rule is
"no accent colour except to mark state" has no use for `slide-in-blurred-top`.

Its `flip-horizontal-*` family is the reference implementation for the turn
described above, and that is the entire value.

**Licence note, because this repo tracks these carefully.** BSD 2-Clause
carries attribution and disclaimer requirements — heavier than MIT.
`fonts/LICENSE-Inter.txt` is the established pattern for that. In practice the
turn is thirty lines you would write yourself after looking at theirs, and a
written-here `@keyframes` has no licence to track at all. **Read it, don't
paste it.**

### Uiverse — and why the alternative is a design system

<https://uiverse.io/> · MIT · 3,000+ community elements

Essentially nothing on it can be pasted here. Every element ships hardcoded
hex, `px` padding and its own font-size — four `lint-tokens.js` failures before
anyone asks whether it fits. That part is mechanical. The real problem is that
the house style is neon glow, gradient sweep, glassmorphism and coloured
shadow, and this app forbids all four: mana colour marks state and nothing
else, a surface takes a border or a shadow but not both, and tinted shadows are
named as a violation in `ui.md`. A Uiverse button fails here because it was
designed for the aesthetic this codebase deliberately rejected.

**The structural reason generalises to every gallery.** A gallery ranks by
upvote, so it selects for novelty — a button must win attention in a grid of
two hundred thumbnails, and restraint loses that fight every time. A design
system's button has the opposite job: survive ten thousand uses in one product
without being noticed. This app needs the second kind, so the alternative is
not a better gallery. It is a design system whose CSS can be read.

**[Pico CSS](https://picocss.com/docs/button)** · MIT · pure CSS, no JS — the
honest replacement for the Uiverse tab. Styles native `<button>` with no class
at all, ten classes in the whole library, variants (`primary` / `secondary` /
`contrast`, each with `outline`) almost exactly the set this app already has.
Themed entirely through custom properties, so the button is legible as
structure rather than as a pile of literals. Browse this when the question is
"what should a restrained button look like."

**[Open Props](https://open-props.style/)** · MIT · plain CSS custom properties
— the same bet `tokens.css` makes, made publicly, and the cheapest sanity check
available on the token set above. Its easing family is directly comparable:

```
--ease-{1-5}   --ease-{in,out,in-out}-{1-5}
--ease-elastic-{in,out,in-out}-{1-5}
--ease-spring-{1-5}   --ease-bounce-{1-5}   --ease-step-{1-5}
--ease-{sine,quad,cubic,quart,quint,expo,circ}-{in,out,in-out}
```

**Read it, don't import it.** Pulling in 300 properties to use four would
invert this repo's relationship with its tokens — `tokens.css` is deliberately
a closed vocabulary where every entry names a job this app has. Note also that
Open Props names its curves after *maths* (`--ease-spring-3`) where this
document names them after *material* (`--ease-panel`). The second is right for
this codebase, which already names every token for the job it does.

**[GOV.UK Design System](https://design-system.service.gov.uk/components/button/)**
· MIT — probably the most usability-tested button on the web, and its whole
idea is the press model above: it draws a hard `box-shadow: 0 2px 0` beneath
itself and on `:active` moves down by exactly that distance, so the button
travels into its own shadow.

**That exact CSS cannot be used here, and I checked rather than assumed.** It
fails `lint-tokens.js` twice: `shadowLayers` only exempts ring layers and
`isRing` is `/^0\s+0\s+0\s+/` ([lint-tokens.js:405](scripts/lint-tokens.js#L405)),
so `0 2px 0` counts as elevation; and every remaining layer must be one of the
three `--shadow-*` overlay tokens
([lint-tokens.js:487-493](scripts/lint-tokens.js#L487-L493)). Its value here is
as corroboration: an independently, heavily tested design arriving at "a
control is a physical key" is the strongest external support the press proposal
has, and its 2px is a useful reference depth.

**[USWDS](https://designsystem.digital.gov/components/button/)** documents its
accessibility reasoning better than anyone — worth raiding for disabled and
focus states. **[Primer](https://primer.style/)** is the right register: dense,
data-heavy, dark-mode-native. Both are React-first in their current docs, so
they are reading material rather than sources of CSS.

**What survives from Uiverse itself** — mechanics, not looks: icon buttons that
reveal a label by transitioning `max-width` (the app does this once, on the
sidebar nav, [layout.css:326](public/css/layout.css#L326)), and
sliding-indicator segmented controls, directly applicable to the List/Grid/Pile
toggle in `sortui.js`.

---

## Ranked

| # | Change | Effort | Risk |
|---|---|---|---|
| 1 | Four `--ease-*` tokens + guard-baked `--dur-*`; adopt across the 50 transitions | Medium | Low — mechanical, and the linter backs it |
| 2 | Promote `cubic-bezier(.3, 1.5, .6, 1)` to `--ease-land`, card-only | Trivial | None |
| 3 | Fix the press asymmetry, and extend past three classes | Trivial | None — it is currently backwards |
| 4 | Lint rule: overshoot only on compositor properties | Small | Low — prevents a class of bug |
| 5 | Mass curves on the 8 declarations (3 panels, 3 controls) | Small | **Medium — taste. Prototype first** |
| 6 | Card turn-over for the 578 two-sided cards | Medium | Low — new feature, nothing regresses |
| 7 | Wiggle timing function replacing `@keyframes avail-shake` | Trivial | None |
| 8 | Sliding indicator on the List/Grid/Pile toggle | Small | Low |

Items 2 and 3 are free and correct regardless of whether the rest happens. Item
1 is the one that matters — it is not a new effect, it is the app finally
having an opinion about the motion it already ships.

## Deliberately not recommended

- **Animate.css, Hover.css, bttn.css.** Stylesheets of effects against
  hardcoded colours and durations; every rule would fail the motion guard.
- **GSAP / Motion.** Both excellent, both wrong here. The card layer's physics
  are hand-written against `translate` and `rotate` specifically so they
  compose with the angle a card lies at in a fanned pile; a JS animation
  library would want to own `transform` and would fight `cardlift.js`,
  `carddrag.js` and `cardmove.js` for it. No motion in this app is failing for
  want of expressiveness in CSS.
- **Scroll-reveal (AOS and similar).** The main views are dense grids of
  hundreds of cards; animating them in on scroll makes long collections slower
  to scan, which is what deliverable 3 in `ui.md` exists to protect.
- **Springing chevrons.** Named explicitly because it is the tempting one. A
  caret is notation.
- **Anything requiring a CDN, a webfont request or a build step.**

## Corrections to the first draft of this document

Recorded because the numbers were quoted and are worth not re-quoting:

- **"43 unspecified easings" was the wrong headline.** It conflated paint with
  movement. Two-thirds of those are colour changes, where easing is a matter of
  taste and mass does not apply. The physical programme is 8 declarations.
- **The "lone `150ms`" does not exist.** It appears inside a comment in
  `tokens.css` illustrating the guard syntax, not in a rule. The real figures
  are 14 distinct durations across 81 uses, not 15 across 82.
- **Battle cards were named as affected; there are none in the data.** The
  two-sided population is `transform`, `modal_dfc` and `double_faced_token`.
- **The lit/shaded button proposal is withdrawn.** It contradicted
  [tokens.css:256](public/css/tokens.css#L256), which reserves visual richness
  for cards and artwork. The press asymmetry replaces it and is better founded.
- **"Reduced motion gets harder with `linear()`" was wrong.** The guard
  collapses duration to `0s`, where the timing function is irrelevant.

## Sources

- [Easing Wizard](https://easingwizard.com/) — [source, MIT](https://github.com/roydigerhund/easingwizard)
- [Animista](https://animista.net/) — BSD 2-Clause
- [Uiverse](https://uiverse.io/) — [source, MIT](https://github.com/uiverse-io/galaxy)
- [Pico CSS](https://picocss.com/docs/button) — MIT
- [Open Props](https://open-props.style/) — [source, MIT](https://github.com/argyleink/open-props)
- [GOV.UK Design System — Button](https://design-system.service.gov.uk/components/button/) — MIT
- [USWDS — Button](https://designsystem.digital.gov/components/button/) · [Primer](https://primer.style/)
- [Create complex animation curves in CSS with `linear()`](https://developer.chrome.com/docs/css-ui/css-linear-easing-function) — Chrome for Developers
- [Springs and Bounces in Native CSS](https://www.joshwcomeau.com/animation/linear-timing-function/) — Josh Comeau
- [easings.net](https://easings.net/)
