# Spec — Cards as objects

Successor to the interactivity brief `ui.md`, which the UI redesign scoped out and left
outstanding. Where this document and `ui.md` disagree, this one is the decision; `ui.md`'s
context section remains accurate and is still worth reading first.

---

## Problem Statement

The app is about cards, and the redesign made the cards the content — the interface receded,
the grids went full-bleed, and the mat gave the page something to be. But a card on screen
still reads as a picture in a box rather than as an object on a table.

Four things cause it, and all four are ours rather than the artwork's:

- **The tile is the object, not the card.** A card image is rendered inside a filled tile with a
  hairline border and a metadata footer, and the image's top corners are clipped to the tile's
  radius. Scryfall's image already carries the card's own black rounded frame, so the app draws a
  second frame around a card that has one. The eye sees a UI tile containing a picture.
- **Every shadow is cast by a rectangle.** The lift shadow comes from the tile's box, not from the
  card's rounded silhouette, and it is the same shadow a menu and a modal cast. Nothing suggests a
  card has an edge or a thickness.
- **Hover is a single three-pixel nudge**, identical for a card, a deck tile and a table row.
  Picking a card up feels like nothing.
- **Piles are impossibly tidy.** The Deck Builder's pile view fans cards at an exact overlap with
  every card pixel-aligned to its neighbour, and a forty-card pile looks precisely as thick as a
  four-card one. Real stacks are never square, and a big stack is visibly big.

Separately, moving a card between categories in the Deck Builder has no physicality at all. A drop
mutates the deck and re-renders the whole mat, so the card being moved is destroyed and rebuilt
somewhere else: it vanishes from one pile and appears in another with no motion between. The
browser's own drag ghost is a translucent screenshot of the whole tile, footer and all — the user
is dragging a UI element, not carrying a card.

And the app honours `prefers-reduced-motion` nowhere. It ships around sixty transitions and zero
guards, so a user who has asked their operating system for less movement gets all of it.

## Solution

Cards become objects that are handled.

**At rest, a card is a card.** The tile frame comes off the artwork, which already has a frame of
its own. The shadow follows the card's silhouette instead of a box, so it hugs the rounded corners
and reads as thickness. A hairline of light along the top edge and a darker one along the bottom
give the card a lit edge under a single, consistent light source — the same one every shadow in the
app already falls away from. Cards in a stack sit at slight, stable angles to each other, the way
cards actually land.

**On interaction, a card is picked up.** Hovering lifts and scales it, tilts it a few degrees
towards the pointer, and sweeps a soft sheen across its face as though light were catching a
laminated surface. It rises above its neighbours rather than pushing them aside: the element's
layout box never changes size, so the pointer cannot lose the card it is over and the card settles
back the instant the pointer leaves. A single preference turns all of this off, kept with the
person rather than the browser, and `prefers-reduced-motion` turns it off without being asked.

**In the Deck Builder, a card is carried.** Dragging is rebuilt on pointer events: the card follows
the cursor with a little lag and tilts into the direction it is travelling, the pile beneath it
responds as a place to put something down, and releasing it settles it into its new pile with a
short overshoot instead of a teleport. Every re-render of the mat — a move, a quantity change, a
sort, a category rename — animates cards from where they were to where they now are, so the mat
never rearranges itself behind the user's back. Dragging is for pointing devices; on touch the
existing "Move to…" modal remains the way to recategorise, exactly as today.

**Stacks are stacks.** One renderer draws a group of cards as a physical stack: a face card with
the edges of the cards beneath it showing, thickness that grows with the count, and the small
rotations that make a stack look stacked. Clicking one fans it out for inspection and clicking away
settles it. It draws the Deck Builder's category piles, and it gives Collections and the Set
Browser a stack view of their own, stacked by whichever sort field is currently selected — sort by
rarity and the collection becomes four stacks, sort by colour and it becomes the colour pie, sort by
mana value and it becomes the curve, standing up off the table.

## User Stories

**Card as object**

1. As someone browsing my collection, I want a card's shadow to follow the shape of the card rather
   than the shape of a box, so that it reads as an object lying on a surface.
2. As someone browsing my collection, I want the app to stop drawing a second frame around artwork
   that already has its own frame, so that I am looking at a card and not at a picture of a card.
3. As someone browsing my collection, I want a card to carry a lit edge and a shaded one, so that it
   appears to have thickness under a consistent light.
4. As someone browsing my collection, I want a card's corners to match the corners of a real card at
   the size it is drawn, so that nothing about its outline says "web page".
5. As someone browsing my collection, I want every card in the app to be treated the same way,
   whether I am in Collections, Scryfall Search, the Set Browser, Want Lists, Pick Night or the Deck
   Builder, so that a card is one kind of thing wherever I meet it.
6. As someone browsing my collection, I want a screen at rest to stay calm, so that the physicality
   is something I discover by reaching for a card rather than something that competes for attention
   while I read.

**Picking a card up**

7. As someone browsing cards, I want a card to lift and grow when I point at it, so that I feel like
   I have picked it up off the table.
8. As someone browsing cards, I want the lifted card to tilt towards my pointer, so that it responds
   to where my hand is rather than simply getting bigger.
9. As someone browsing cards, I want light to sweep across the card's face as it tilts, so that it
   reads as a physical, laminated surface rather than a flat image scaled up.
10. As someone browsing cards, I want the lifted card to rise above its neighbours, so that it is
    fully visible without the grid reflowing around it.
11. As someone browsing cards, I want the card's clickable area to stay exactly where it was while
    it is lifted, so that my pointer never falls off the card that grew under it.
12. As someone browsing cards, I want the card to settle back immediately when I point elsewhere, so
    that moving across a grid never leaves a trail of half-animated cards.
13. As someone who finds movement distracting, I want one switch that turns the lift, tilt and sheen
    off everywhere, so that I can have the calm version of the app without giving up the app.
14. As someone who has asked my operating system to reduce motion, I want the app to respect that
    without my finding a setting, so that the default is already right for me.
15. As someone who has asked my operating system to reduce motion, I want *every* animation in the
    app to respect it and not only the new ones, so that the guarantee is worth something.
16. As someone with an account, I want my motion preference to follow me to my other devices, so
    that I set it once rather than on each browser.
17. As someone using the app with no accounts configured, I want my motion preference to persist in
    my browser, so that open mode is not a worse experience than a signed-in one.

**Carrying a card in the Deck Builder**

18. As someone building a deck, I want the thing under my cursor while dragging to look like a card,
    so that I am carrying a card rather than dragging a user-interface element.
19. As someone building a deck, I want the carried card to trail slightly behind my cursor and tilt
    into its motion, so that it feels like it has weight.
20. As someone building a deck, I want the pile under my cursor to show that it will accept the
    card, so that I know where it will land before I let go.
21. As someone building a deck, I want a dropped card to settle into its new pile with a short
    overshoot, so that the move looks like a card landing rather than a screen redrawing.
22. As someone building a deck, I want a card that changes category to visibly travel from its old
    pile to its new one, so that I can see what just happened without hunting for it.
23. As someone building a deck, I want cards to animate to their new positions whenever the mat
    rearranges — a quantity change, a sort, a category rename — so that the layout never changes
    behind my back.
24. As someone building a deck, I want to drag a multi-selected group as a small fan of cards, so
    that a bulk move feels like moving a handful rather than firing an invisible command.
25. As someone building a deck, I want the scroll position and my selection preserved across a move,
    so that animating the change does not cost me my place.
26. As someone building a deck, I want autosave, import, export, multiselect and the stats bar to
    keep working exactly as they do now, so that a cosmetic improvement costs me no function.
27. As someone building a deck on a phone or tablet, I want the "Move to…" modal to remain the way I
    recategorise a card, so that the tab works on touch exactly as well as it does today.
28. As someone building a deck on a phone or tablet, I want scrolling the mat to stay instant and
    unambiguous, so that no press-and-hold delay comes between me and the deck list.
29. As someone building a deck with a stylus, I want dragging to work as it does with a mouse, so
    that a pen is a pointing device and not a finger.

**Stacks**

30. As someone building a deck, I want a category to look like a stack of cards with the edges of
    the cards beneath showing, so that the mat reads as a table with piles on it.
31. As someone building a deck, I want a stack of thirty cards to look visibly thicker than a stack
    of four, so that I can read the shape of my deck at a glance without counting.
32. As someone building a deck, I want the cards in a stack to sit at slight angles to one another,
    so that a pile looks like it was put there by hand.
33. As someone building a deck, I want a stack's angles to stay the same every time I look at it, so
    that the mat is not visibly reshuffling itself on every render.
34. As someone building a deck, I want to click a stack to fan it out and inspect every card in it,
    so that a stack is a way of tidying the mat and not a way of hiding cards.
35. As someone building a deck, I want a fanned stack to settle back when I click away, so that
    inspection is a temporary state rather than a mode I have to leave.
36. As someone building a deck, I want to drop a card onto a stack, so that stacking is how I sort
    my deck and not merely how it is drawn.
37. As someone building a deck, I want the card-size control to size stacks as it sizes the grid, so
    that one control governs how big cards are on this tab.
38. As someone looking at my collection, I want a stack view alongside list, grid and XL, so that I
    can see my collection as objects when I want to and as data when I want that.
39. As someone looking at my collection, I want the stacks to be grouped by whatever I am currently
    sorting by, so that stacking teaches me nothing new and needs no second control.
40. As someone looking at my collection sorted by rarity, I want to see four stacks of visibly
    different heights, so that I can see the shape of what I own.
41. As someone looking at my collection sorted by mana value, I want a row of stacks that is my
    mana curve made out of cards, so that a chart and a pile are the same fact.
42. As someone browsing a set, I want the same stack view with the same behaviour, so that the two
    card-browsing tabs work alike.
43. As someone browsing a set of four hundred cards, I want stacks to stay fast and readable, so
    that a physical metaphor does not cost me the ability to find a card.
44. As someone with a very large collection, I want the list view to remain untouched and fast, so
    that the stack view is an option and never a tax.
45. As someone looking at a stack, I want to see how many cards are in it, so that the impression the
    thickness gives me is confirmed by a number.

**Keeping the redesign**

46. As the person who owns this app, I want every new surface to obey the token contract, so that the
    linter keeps failing the build rather than my having to review colours by eye.
47. As the person who owns this app, I want any genuine exemption to name the rule it escapes and
    why, so that the exemption lists stay short and auditable.
48. As the person who owns this app, I want all of this to work in all five themes, so that a light
    theme does not get a dark theme's lighting.
49. As the person who owns this app, I want every control to stay at least 44×44 on a phone, so that
    the mobile measurement stays at zero.
50. As the person who owns this app, I want no framework, no build step and no new external requests,
    so that the app stays a folder of files served from my own machine.
51. As the person who owns this app, I want the whole thing to degrade to today's behaviour if a card
    image fails to load, so that physicality is a treatment of artwork and not a dependency on it.

## Implementation Decisions

**Intensity: tactile on interaction.** At rest the treatment is materials only — silhouette shadow,
lit edge, real corners, stack jitter. Lift, scale, tilt and sheen exist only while a card is being
pointed at or carried. This keeps the redesign's principle that a screen at rest carries no
interface, while putting the physicality exactly where the user's attention already is.

**Scope: every card image in the app.** The treatment lands on the shared card-image classes rather
than per tab, so Collections, Scryfall Search, the Set Browser, Want Lists, Pick Night and the Deck
Builder inherit one behaviour. This is less code than doing it per tab, not more.

**The card is the element; the tile is deleted around it.** Tiles stop drawing a fill and a hairline
around artwork. Metadata that currently sits in a footer stays legible but stops being a box the card
lives inside. The placeholder shown while an image is missing keeps a hairline, because a placeholder
is a surface and not a card.

**Shadows on cards are drawn with `filter: drop-shadow()`, not `box-shadow`.** A drop shadow follows
the image's alpha silhouette, which is what a card-shaped shadow requires; a box shadow follows a
rectangle. This is also the property the elevation contract does not govern, so the change is
compatible with the token linter by construction rather than by exemption. The shadow's offset,
blur and colour continue to derive from the per-theme shadow tokens' values so that all shadows in
the app still fall from the same light.

**Tilt is bounded and pointer-derived.** A small rotation on two axes, driven by the pointer's
position within the card's own box, with a maximum of a few degrees. The card's transform is applied
to a visual layer so the element's layout box is untouched; a raised stacking context puts the lifted
card above its neighbours.

**The sheen is a gradient overlay whose angle tracks the same pointer position.** It exists only
while the card is lifted and is composited over card artwork, which is the exemption the app already
grants to controls that sit on artwork. It carries a comment naming that rule and that reason.

**Stack jitter is deterministic, derived from the card's name.** A stable hash maps a card to a small
rotation, so the same card sits at the same angle on every render and the mat does not reshuffle
itself. Randomness at render time is explicitly rejected: it would make every re-render visibly
different and would make the pile view untestable.

**A stack draws a bounded number of layers.** Thickness is a function of the card count, but the
number of drawn elements is capped, so a four-hundred-card stack costs the same to paint as a
forty-card one. The function from count to layers is deliberately a pure function so that it can be
asserted rather than eyeballed.

**One stack renderer, three callers.** The Deck Builder's category piles, Collections' stack view and
the Set Browser's stack view are the same component. The Deck Builder's existing card-width variable
governs stack size on that tab; the browsing tabs get the same control, which is `ui.md`'s third
deliverable and is currently implemented only in the Deck Builder.

**Stacks on browsing tabs are grouped by the current sort field.** Collections and the Set Browser
already share one sort-field vocabulary — name, mana value, colour, rarity, type, price, power,
toughness, plus quantity and collector number respectively — through the shared sort control. The
stack view buckets on whatever that field is set to, reusing the existing sort-key function. No new
grouping concept, no new persisted state, and no second control: changing the sort restacks the view.
Grouping by name buckets on the initial letter.

**Drag is rebuilt on pointer events, gated to mouse and pen.** The HTML5 drag-and-drop path in the
Deck Builder's panels module is replaced by pointer handlers; a touch pointer never begins a drag, so
the tab's touch behaviour is unchanged and the existing "Move to…" modal remains the recategorisation
path on phones. This deliberately introduces no press-and-hold gesture, because a press-and-hold
would put a delay between a finger and scrolling the mat. The drop's effect on deck state — the
category assignment, the autosave scheduling — is the existing logic in the edit module, called from
the new drag path rather than reimplemented.

**Re-renders animate by measuring before and after.** The mat's render is wrapped so that card
positions are recorded before the rebuild and again after, and each card that moved plays the inverse
of its displacement. This makes every mat re-render animate — a move, a quantity change, a sort, a
rename — rather than only a drag, and it is what lets the drop's landing animation exist at all given
that the drop rebuilds the mat. Cards are keyed by card name, which the markup already carries.
The existing scroll-position restoration and scroll-anchoring suppression are preserved.

**Multi-select drags a fan.** When a drag begins on a card that is part of the current selection, the
carried object is a small fan of the selected cards, and the drop applies the existing bulk-move
logic. Beginning a drag on an unselected card carries that card alone and does not disturb the
selection.

**Motion has one preference and one override.** A card-motion preference joins theme and playmat in
the preferences record: a new column on the user preferences table added through the existing
migration pattern, a new validated field on the preferences patch endpoint, and a control in the
appearance popover alongside theme and playmat. It follows the established shape exactly — the
endpoint is a patch, so setting motion cannot clear a playmat; open mode validates the same field,
stores nothing and reports that the browser is the record; the client paints from local storage
before the session is known and corrects from the server afterwards. `prefers-reduced-motion`
overrides the preference towards less motion and never towards more.

**Reduced motion becomes part of the token contract.** A new rule in the token linter requires that
any rule declaring a transition or an animation be covered by a reduced-motion guard, enforced with
the colour, type, spacing, radius and elevation rules and asserted by the existing static test. The
roughly sixty existing unguarded transitions are brought under the guard in the same pass, because a
contract with a large grandfathered exception is not a contract. The rule's escape hatch is an
allowlist shaped like the existing `!important` ratchet: an entry that is no longer needed is itself
a failure, so the list cannot quietly refill.

**The decisions are extracted as pure functions in the shipped client code.** Stack layer count from
card count, jitter angle from card name, which pile a point falls within, the tilt angle from a
pointer position within a box, and the effect of a drop on deck state are written as functions of
their inputs, with the DOM wiring around them. This is what makes them assertable without a browser;
it is not a new module boundary, and it does not introduce a bundler, modules or a framework.

**Sequencing.** The motion preference and the reduced-motion contract rule land first, because every
later change is gated on them and because retro-fitting the guard is a wide, mechanical diff best kept
out of the diffs that change how things look. Materials and hover-lift land next, as one change across
the shared card classes. The stack renderer follows, in the Deck Builder first where the pile concept
and the size control already exist, then on the two browsing tabs. The drag rewrite lands last and
alone, because it is the only change in the set that can break existing function.

## Testing Decisions

A good test here asserts something externally observable — a response a client receives, a
machine-checkable property of the delivered stylesheet, or the output of a function for a given
input. It does not assert which function was called, and it does not assert the markup a component
renders: the redesign churned markup deliberately and will churn it again here. Screenshot capture
and the layout measurements remain review aids, not assertions, for the reason the redesign already
recorded — during a visual change every intentional difference is a failure, and that trains you to
ignore the output.

Three seams carry this feature, and all three already exist. No new seam is introduced.

**The HTTP seam** — the suite that drives the Express application through a client against a
temporary database — carries the motion preference in full, because all of it is request and
response behaviour. It asserts: the field round-trips; an invalid value is rejected; the patch
semantics hold in both directions, so setting motion leaves theme and playmat alone and setting a
theme leaves motion alone; a user who has never set it gets the default; open mode validates the
same body, stores nothing and reports that the server is not the record; and one user cannot read or
write another's. The playmat preference's existing suite is the prior art and the shape to copy.

**The static seam** — the token linter, asserted by the existing contract suite — carries the CSS.
Compliance of the new rules is automatic, since the linter already runs over the delivered
stylesheet: a raw colour in a sheen gradient or an off-scale radius on a stack fails the build with
no new test written. The new reduced-motion rule is added to that linter and asserted in both
directions, following the pattern the existing suite established: one half asserts that the delivered
stylesheet is clean, the other feeds the linter deliberately broken sources and asserts that it
notices — because a rule that passes by checking nothing reads as a guarantee while being none. The
new allowlist is asserted to be a ratchet, meaning a stale entry fails.

**The vm seam** — the technique the theme suite established, slicing shipped client code out of its
file and evaluating it with stub browser globals — carries the extracted decisions. It asserts on the
real shipped code rather than a copy. Covered: layer count is monotonic in card count and bounded
above, so a large stack cannot paint unboundedly; jitter is stable for a given card name across calls
and bounded to its permitted range; hit-testing a point against pile bounds picks the expected pile,
including at boundaries and outside every pile; tilt is bounded at the extremes of a card's box and
is zero at its centre; the drop's effect on deck state moves the intended card, moves the whole
selection for a multi-select drag, and is a no-op when the target is the card's current category. The
sort-key function that the stack grouping reuses is already exercised by the tabs that use it and
needs no separate coverage for a second caller.

Not tested, deliberately: the DOM wiring, the visual result of a transform, and whether an animation
looks right. Those are what the screenshot harness and the eye are for.

## Out of Scope

- **A full three-dimensional presentation** — perspective on the mat itself, stacks rendered as
  volumetric objects, cards that rotate freely. Considered and rejected: striking in a screenshot,
  costly to read, and the first thing to feel gimmicky.
- **Touch dragging in any form**, including press-and-hold to pick up and a drag handle on each card.
  The modal remains the touch path. This is not a regression, since browser drag-and-drop has never
  worked on touch.
- **Card flipping** for double-faced cards, and any animation of turning a card over.
- **Sound.**
- **Physics** — inertia, collision, cards that push each other aside, a pile that topples.
- **A free-positioning mat** where cards are dropped at arbitrary coordinates and remember them.
  Cards belong to categories; categories are laid out by the app.
- **Creating a category by dragging a card to empty mat space**, which `ui.md` §2 proposes. It is a
  reasonable feature and it is a separate one from making cards feel physical; it should be specified
  on its own terms.
- **Retiring the existing pile view's column layout.** Stacks replace how a pile is drawn, not how
  the mat is arranged.
- **Any change to the list views**, which stay exactly as fast and as plain as they are.
- **Changes to the playmat, themes, tokens or contrast floors**, beyond the new linter rule.

## Further Notes

The elevation rule already anticipated this work: the redesign record notes that a lifted card is a
transient floating object and so is permitted its shadow, which is why the hover treatment needs no
new exemption for existing. What it does need is for the shadow to stop being cast by a rectangle.

Two exemptions are expected and both have precedent. The sheen composites a gradient over card
artwork, which is the exemption already granted to the buttons that sit on card artwork. Stack
overlap is a fraction of a card's own width and therefore cannot come from the spacing scale, which
is the exemption the current pile view already carries and states. No exemption is expected for
radius: a real card's corner at the sizes cards are drawn here is already close to the medium step.

The card-size control is the third of `ui.md`'s deliverables and is already built in the Deck
Builder, slider and persistence included. Extending it to the browsing tabs is a smaller job than the
brief implies and is folded into the stack work here rather than specified separately.

The screenshot harness needs a populated database to prove anything; the repository's own data
directory is empty and every tab renders an empty state without one. Capture before and after each
change against a restored snapshot, and always against a copy, since the application writes to
whatever database it is given.
