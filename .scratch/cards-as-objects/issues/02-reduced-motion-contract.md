# 02 — Reduced motion becomes part of the token contract

**What to build:** a person who has asked their operating system for less movement gets a still app.
Today the app ships 57 transitions and 3 animations and honours that request nowhere. Every one of
them moves under a reduced-motion guard, and the token linter gains a rule that fails the build on
any transition or animation that is not guarded — enforced beside the colour, type, spacing, radius
and elevation rules, and asserted by the existing contract suite.

The guard is written per rule, applying motion only when motion is welcome. The global wildcard
override — the usual recipe — is rejected because it needs `!important`, which this codebase bans
with a shrinking allowlist, and because a blanket override cannot be verified rule by rule.

The escape hatch is an allowlist shaped like the existing `!important` ratchet: an entry that is no
longer needed is itself a failure, so the list cannot quietly refill.

This is mechanical but not wide — 57 declarations across four stylesheets, none inline in JS or HTML
— so it does not need expand–contract batching. Wrapping a transition in a guard breaks nothing, so
the migration stays green throughout and the rule turns on at the end of the same ticket.

From `spec-cards-as-objects.md` → Implementation Decisions, "Reduced motion becomes part of the token
contract".

**Blocked by:** None — can start immediately.

**Status:** done

- [x] With reduced motion set, nothing in the app animates or transitions, on any tab, in any theme
- [x] With reduced motion set the app stays fully usable — nothing waits on an animation to finish, and no state is only conveyed by movement
- [x] Every rule in the delivered CSS that declares a transition or an animation is covered by a guard
- [x] The linter fails the build on an unguarded transition or animation
- [x] The rule adds no `!important` anywhere
- [x] The rule's allowlist is a ratchet: a stale entry fails the build
- [x] The contract suite asserts both halves — the delivered stylesheet is clean, and the linter notices deliberately broken sources
- [x] For someone without the preference set, captured screens are unchanged
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green

**Built as:** two multipliers, not one. `--motion-ui` is every transition the
interface makes and only the operating system can zero it; `--motion` stays the
"Cards move" preference from ticket 01. The switch says *Cards move*, so it is
not entitled to freeze drawers and chevrons — but a system asking for less
movement is asking the whole app, so the reduced-motion query zeroes both.

The guard the linter requires is `calc(var(--motion-ui) * .15s)`: one duration,
stated once, collapsing to `0s` when the multiplier is 0. 55 transitions and 3
animations across five files came under it, login.html's own `<style>` block
included — the motion rule reaches markup stylesheets, which the value rules
still do not.

Verified in headless Firefox with `ui.prefersReducedMotion=1`: of 926 elements
on the app page and 49 on the login page, none has a non-zero transition or
animation duration or delay. Without the setting, all 110 captured screens are
pixel-identical to the ones before this change.
