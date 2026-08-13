# Spec — the interface gets weight, and two-sided cards turn over

Derived from `docs/design/research-buttons-and-motion.md`. That document holds
the measurements and the rejected alternatives; this one holds the decisions.

## Problem Statement

The cards in this app feel like objects. They catch a light along their top
edge, drop a shadow shaped like their own silhouette, lean towards the pointer,
and settle when they land in a new pile. Somebody thought hard about what a
card feels like.

The interface around them did not get that treatment. The drawer slides, the
sidebar collapses, the toggle knob slides and the tab pane fades — all on the
timing curve a browser uses when a stylesheet says nothing at all. The app
knows exactly what a card feels like and has no opinion about what a drawer
feels like, and the result is that the chrome reads as a web page wrapped
around a table rather than as part of the same room.

The button press is a specific instance of this and is currently backwards.
Pressing a button eases over 80ms; releasing it snaps instantly. A real key
does the opposite — your finger moves it the moment you push, and the spring
governs the way back — so the one piece of tactile feedback the controls have
is the wrong way round.

Separately, and for a smaller but real audience: a two-sided card only ever
shows one side. The back is reachable today in the hover preview, which lays
both faces out beside each other as two cards. That preview is driven by the
mouse, so it does not exist on a touchscreen at all, and it deliberately
suppresses itself once the card is already displayed at preview size — which
is exactly the card detail view, where someone reading a transforming card
most wants to see its back. So on a phone, the back of a modal double-faced
card cannot be seen at all.

## Solution

**Physicality splits into two channels, and they are separate decisions.**

- **Light** — the lit hairline along an object's top edge, the shade along its
  bottom, the shadow it casts, the sheen crossing its face.
- **Weight** — how it moves. Mass, inertia, whether it settles or stops dead.

**Cards get both channels. Chrome gets weight only.**

Light stays card-only. That is not a new position — the token file already
states that surfaces are near-neutral so that card artwork and the per-tab
mana colour are the only saturated things on screen. The interface is not going
to start catching the light.

What the interface can acquire is mass. A drawer with weight behind it, a knob
that rings when you flick it, a button that returns under its own spring. That
costs nothing in colour, breaks no existing rule, and is the whole of the
opportunity.

Three things follow, and they are the shape of the work:

1. **Not everything has mass.** A colour change does not. A rotating chevron
   does not. Only six behaviours in the entire chrome do.
2. **Overshoot is the signal of mass, and it is unsafe on some properties.**
   A spring on anything that affects layout is a bug, not a look.
3. **Cards keep the expressive extreme of both channels.** The chrome gets the
   disciplined version of one, so a card landing never sounds like a button
   returning.

Alongside that, a two-sided card becomes something you can turn over in place —
one card with two sides, rather than two cards side by side — which also makes
the back reachable on a touchscreen for the first time.

## User Stories

1. As someone building a deck, I want the interface around the mat to move with
   the same care the cards do, so that the whole app feels like one room rather
   than a web page wrapped around a table.
2. As someone opening the deck drawer, I want it to arrive with weight behind
   it, so that it reads as a heavy panel sliding rather than a rectangle
   appearing.
3. As someone closing the deck drawer, I want it to leave the same way it
   arrived, so that opening and closing feel like one reversible action.
4. As someone flicking a filter toggle, I want the knob to ring slightly as it
   lands, so that the control feels sprung rather than drawn.
5. As someone pressing a button, I want it to move the instant my finger lands,
   so that the app feels responsive to me rather than animated at me.
6. As someone releasing a button, I want it to spring back under its own power,
   so that the press reads as a physical key rather than a colour change.
7. As someone using a small button in a table row, I want it to acknowledge my
   press the same way the large buttons do, so that the app does not feel
   half-finished in its denser corners.
8. As someone opening an accordion, I do **not** want the chevron to bounce, so
   that the app does not read as cheap.
9. As someone hovering a card for a preview, I do **not** want the tooltip to
   spring into place, so that a transient reveal does not compete with the card
   I am trying to read.
10. As someone collapsing the sidebar, I want the content beside it to track its
    edge exactly, so that nothing jitters or overshoots and the page does not
    flicker a scrollbar.
11. As someone who has asked their operating system for reduced motion, I want
    every one of these movements to become instant, so that the app respects a
    setting I did not set lightly.
12. As someone who has unticked "Cards move", I want the interface to keep
    moving, so that a preference about cards is not silently a preference about
    the whole app.
13. As someone reading a transforming card, I want to turn it over in place, so
    that I can read its back without leaving the view I am in.
14. As someone on a phone reading a modal double-faced card, I want to be able
    to see its back at all, so that the app is not withholding half the card
    from me because I have no mouse.
15. As someone reading a card in the detail view, I want the turn control to be
    available there, so that the one place large enough to read a card properly
    is not the one place that hides its other half.
16. As someone browsing a set that contains transforming cards, I want to turn
    one over without losing my place in the grid, so that checking a back face
    is not a navigation.
17. As someone looking at a split card or a Room, I do **not** want a turn
    control, so that the app does not offer me an action that means nothing.
18. As someone looking at an ordinary one-sided card, I do **not** want a turn
    control, so that the affordance means something when it does appear.
19. As someone who has unticked "Cards move", I still want to see the back of a
    two-sided card, so that a preference about animation does not cost me
    information.
20. As someone turning a card over, I want it to turn rather than cross-fade,
    so that it reads as one object with two sides rather than two pictures
    swapping.
21. As a developer adding a transition, I want a named duration to reach for, so
    that I am not choosing between fourteen values that mean roughly the same
    thing.
22. As a developer adding a transition, I want a named curve to reach for, so
    that the default is a decision someone made rather than whatever the browser
    does when told nothing.
23. As a developer adding a transition, I want the reduced-motion guard to be
    impossible to forget, so that the promise the app makes about motion holds
    by construction rather than by review.
24. As a developer, I want the build to reject an overshoot curve on a property
    that affects layout, so that a whole class of jitter bug cannot be
    introduced by someone who did not know the rule.
25. As a developer reading the stylesheet, I want each curve named for the
    material it describes rather than for its maths, so that choosing one is a
    question about the thing being moved.
26. As a maintainer, I want the card-landing curve to have a name, so that the
    best motion in the app stops being a magic number buried in one rule.
27. As a maintainer, I want that curve to stay reserved for cards, so that it
    keeps meaning "a card just landed" rather than becoming the app's generic
    bounce.
28. As a maintainer, I want the number of new test seams to be zero, so that
    this work does not enlarge the surface the suite has to hold.

## Implementation Decisions

### The token vocabulary

Four easing tokens join the fixed scales in the token file, each named for the
**material** it describes rather than for a maths family — matching the file's
existing convention of naming the job a value does rather than the value.

```
--ease-panel     heavy, damped, no ring     drawers, side panels
--ease-control   light, tight ring          knobs, presses, toggles
--ease-land      cubic-bezier(.3,1.5,.6,1)  CARDS ONLY — the existing curve, named
--ease-tint      plain deceleration         paint, markers, reveals. Never overshoots.
```

`--ease-land` is the curve that already exists in the card layer, promoted to a
name. It stays card-only by decision, not by accident: reusing it for controls
is precisely how it would stop meaning "a card just landed". A card is
cardboard meeting felt — soft, a big settle. A button is spring steel — tight
and quick. Different materials get different curves.

The exact numbers for `--ease-panel` and `--ease-control` are to be drawn in
Easing Wizard against the real drawer and the real knob. The shapes are
settled; the digits are not, and should not be invented at spec time.

### Durations carry their own motion guard

Duration tokens join the same section, and the guard is baked into each token's
own definition rather than repeated at every call site:

```
--dur-tint    .12s guarded by the UI motion token    paint, markers
--dur-base    .15s guarded by the UI motion token    the default
--dur-panel   .2s  guarded by the UI motion token    drawers, side panels
--dur-card    .28s guarded by the CARD motion token  the card layer
```

This is not a stylistic choice. The linter checks time **literals**, so a
duration hidden behind a custom property would slip past its motion guard
entirely — the linter's own source says so, and says that the day duration
tokens exist, the token's definition is where the guard belongs. Baking it in
makes forgetting the guard impossible rather than merely detectable.

Three of these absorb 68 of the 81 existing duration uses on the first commit.
The remaining one-offs are converted case by case or left as guarded literals.

The linter must learn that these names resolve to guarded times, and must keep
rejecting a bare literal everywhere else. The existing motion allowlist ratchet
is unaffected.

### What has mass, and what does not

The chrome's movement declarations sort into four groups. **Panels and controls
have mass. Markers and the reveal do not.**

| group | members | treatment |
|---|---|---|
| panels | the collection drawer, the deck column, the side panel | `--ease-panel` — damped, no ring |
| controls | the filter toggle knob, the button press, the pile toggle | `--ease-control` — tight ring |
| markers | the three chevrons and carets | `--ease-tint` — **never overshoots** |
| reveal | the card hover tooltip | `--ease-tint` — **never overshoots** |

A chevron is a symbol that reports state the way a colour does. It has no
travel and no weight, and a springing caret is the most recognisable cheap-bounce
tell on the web. A tooltip appearing is a reveal, not a throw. Both are
excluded deliberately and the exclusion is part of the spec, not an oversight.

The existing durations already agree with this model without anyone having
planned it — panels sit at .2s, controls at .15s and .08s. Heavier is already
slower. Only the curves are missing.

### The new lint rule: overshoot is compositor-only

> **An overshoot curve is legal only on `transform`, `translate`, `rotate`,
> `scale`, `opacity` and `filter` — properties the compositor owns and that
> cannot reflow. Properties that affect layout get deceleration.**

This is a correctness rule, not a taste rule. Five transitions in the app
animate layout-affecting properties, including the sidebar's width and the main
content's left padding, which are a matched pair so the content edge tracks the
sidebar. An overshoot there grows the sidebar wider than its own width token
mid-flight while the content padding overshoots alongside it — content jitters
right and comes back, with scrollbar flicker as a bonus. The nav label's
max-width collapses to zero, which is a hard floor, so its undershoot gets
clamped and opening stops mirroring closing.

The sting is that a naive "scale the spring by mass" model assigns the *most*
spring to the sidebar, which is the heaviest chrome in the app and the least
able to afford it. Hence a rule rather than a guideline.

It joins the linter's existing rule vocabulary and reuses the parsing the
motion guard already does. It carries a performance argument for free, since
the springy paths become exactly the ones that never touch layout.

### The press

The press transition is currently declared only on the pressed state, so
entering it animates and leaving it falls back to a base rule that does not
transition transform at all. The app eases the press and snaps the release,
which is backwards.

The decision: **the pressed state carries no transition** — your finger moved
it, not a curve — **and the base state carries `--ease-control`**, so the
release rings back under the spring. This inverts the current arrangement and
is two lines.

The press also extends beyond the three button classes it covers today. Every
control that visibly depresses should acknowledge it, including the small
in-row buttons and the kebab menu button.

**Open, to be settled by prototype during implementation:** the travel is
currently 1px, where a 1.15 overshoot amounts to 0.15px — below anything
visible, so the curve may do nothing until the travel is deeper. GOV.UK's
tested depth is 2px. The spacing scale starts at 4px and has no 2px step, but
the linter governs padding, margin and gap and **not** transform, so a 2px
translate is not blocked. Confirm against the linter rather than assuming, and
pick the depth that makes the curve legible.

### The turn

**The seam already exists.** The Scryfall helpers module already has a function
that answers "what pictures does this card have", returning a card's face
images or nothing. It derives the answer from the data rather than from a list
of layouts, and correctly answers "one" for a split card or a Room — those have
face records but the image lives on the card, so asking each face for a picture
finds none. That is exactly the turn-over semantic this feature wants, it is
already populated into a cache keyed by card name, and it is already asserted
in the tooltip's test file.

**The turn is therefore a second consumer of an existing helper, not a new
module.** No new face-selection logic is written. If the helper returns
nothing, no turn control appears.

Decisions:

- **Turn-over only.** A rotation about the vertical axis, for genuinely
  two-sided cards. Split cards and Kamigawa flip cards are excluded: a split
  card is perfectly readable at rest, and turning a card over versus rotating
  it in its own plane are different things a hand does. One control meaning
  both would read as arbitrary.
- **The turned state is a DOM class on the card, with no persistence**,
  following the pattern the card-lift script already uses for the card being
  held and the card being lifted. It is set by a click handler and forgotten on
  re-render. Turning a card is like holding one — it lasts as long as you are
  looking at it. This adds no module, no stored state and no seam.
- **The turn is guarded by the card motion token**, like the lift and the
  travel, so it collapses to no time at all for someone who has asked for less
  movement.
- **At zero motion the face still swaps, instantly.** The card-held class
  already sets this precedent: the state change survives when the movement is
  switched off. The turn is functional rather than decorative, so someone who
  has unticked "Cards move" must still be able to see the back.
- **The lit and shaded edges do not swap during the turn** — the top edge is
  still the top edge — but both hairlines collapse at ninety degrees when the
  card is edge-on. Look at this in a prototype; it may need no treatment at all.

## Testing Decisions

**What makes a good test here.** These assert external behaviour: what the
delivered stylesheet promises, and what a pure function returns. They do not
assert class names, listener wiring, or what a moving thing looks like. The
repo has already recorded why — during a visual change every intentional
difference is a failure, and that trains you to ignore the output. What a
turning card looks like belongs to the screenshot harness and the eye, not to
the suite.

**Three seams, all of which already exist. No new seam is introduced.**

### Seam 1 — the linter's source-level entry point

The existing token-contract test file already has the right shape and it should
be extended rather than joined by a new file. That file asserts two halves and
needs both: that the real stylesheet is clean, and that the linter would
actually notice if it were not. A linter that passes because it checks nothing
is worse than no linter, because it reads as a guarantee.

New assertions:

- The delivered stylesheet still satisfies the whole contract after the sweep.
- A duration token's own definition carries a motion guard; one that does not
  is rejected.
- A transition that names a duration token is accepted by the motion guard,
  where a bare literal is still rejected.
- An overshoot curve on a layout-affecting property is rejected.
- An overshoot curve on a compositor property is accepted.
- A curve used anywhere in the delivered stylesheet comes from the four named
  easing tokens.

### Seam 2 — the delivered stylesheet, read for the reduced-motion promise

The card-motion test file already reads the shipped stylesheet to assert that a
page whose script never ran still honours a system asking for less motion.
Tokenising durations is the one change that could silently break that promise,
because the guard moves from the call site to the token. Extend that file to
assert that the promise still holds with the times behind tokens.

### Seam 3 — the face helper

Already asserted in the tooltip's test file, which evaluates the helper
directly in a sandbox and covers the two-faced case. Extend it with the cases
the turn depends on: a one-sided card yields nothing, a split card yields
nothing, a genuinely two-sided card yields both pictures. These may already be
covered — check before adding.

**Prior art for all three:** the token contract file for linter assertions, and
the card-motion and card-lift files for running shipped browser scripts against
stub globals in a sandbox.

**Screenshots.** Capture before and after with the real database snapshot, as
the UI documentation requires. The harness is deterministic, so unrelated views
should stay byte-identical — that is the regression check for a sweep that
touches every stylesheet. Note that a static frame cannot catch mid-transition
jitter, so the sidebar's behaviour under the new rule wants a look in a live
browser rather than in a capture.

## Out of Scope

- **Any lighting on the chrome.** Lit and shaded edges on buttons were proposed
  and are withdrawn — they contradict the token file's stated rule that
  surfaces stay near-neutral so cards and artwork are the only rich things on
  screen. Light is card-only. This is a decision, not a deferral.
- **Rotating split cards, Rooms, or Kamigawa flip cards.** Different motion,
  different meaning, and split cards are readable at rest.
- **Persisting which cards are turned.** A turned card is closer to scroll
  position than to a preference.
- **Replacing the shake keyframes with a wiggle timing function.** Real, small,
  and unrelated to mass. Separate ticket.
- **A sliding indicator on the List/Grid/Pile toggle.** Unrelated to
  physicality. Separate ticket.
- **Any JS animation library.** The card layer's physics are hand-written
  against individual transform properties specifically so they compose with the
  angle a card lies at in a fanned pile; a library would want to own transform
  and would fight the lift, drag and move scripts for it. No motion in this app
  is failing for want of expressiveness in CSS.
- **Importing any token or component library.** Open Props, Pico and the
  government design systems are reading material. The token file is
  deliberately a closed vocabulary where every entry names a job this app has.
- **Scroll-triggered animation.** The main views are dense grids of hundreds of
  cards; animating them in on scroll makes long collections slower to scan,
  which the UI documentation exists in part to protect.
- **New network requests, a build step, a CDN, or a framework.**

## Further Notes

**Sequencing.** Naming the card-landing curve and fixing the press asymmetry
are free and correct on their own, and neither depends on the rest. They are
the sensible first commits. The token sweep is the largest piece and is
mechanical once the four curves are drawn. The mass curves themselves are the
only part carrying real taste risk and should be looked at in a browser before
being committed — the whole model governs eight declarations, which is small
enough to try and small enough to revert.

**Why the model is deliberately small.** The research document's first draft
claimed 43 transitions needed fixing. That number conflated paint with
movement: two-thirds of this app's chrome does not move at all, it changes
colour, and mass is meaningless there. The physical programme is eight
declarations across six behaviours. Small and correct beats large and
hand-wavy.

**On the turn's reach.** Roughly 578 cards in a snapshot of about 37,000 are
genuinely two-sided — about 1.5%. That is smaller than it feels, and the case
for the work is information rather than polish: for those cards the app shows
one side of a two-sided object, double-faced cards are common in modern
Commander, and on a touchscreen the existing hover preview does not exist.

**Corroboration for the press.** The GOV.UK Design System's button is
independently the same idea — a hard shadow beneath the button that it travels
into when pressed — arrived at after far more user testing than this project
will do. Its CSS cannot be used here (it fails the elevation rule twice, since
a solid offset shadow is neither a ring nor one of the three overlay tokens),
but its 2px depth is a useful reference for the open question above.
