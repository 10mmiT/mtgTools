# 01 — The card-motion preference

**What to build:** a switch that decides whether cards move, kept with the person rather than the
browser. It sits in the appearance popover beside theme and playmat, defaults to on, and survives a
reload and a different browser signed in as the same person. In open mode there is nobody to hang it
on, so the browser is the whole record and the client is told so. The operating system's
reduced-motion setting resolves against it into a single effective value that both CSS and JS read
from the root element — the OS can only take motion away, never add it back.

Nothing consumes the preference yet. This ticket exists so that everything after it has one place to
ask "should this move?", and so the answer is already correct on every device before any motion is
built.

From `spec-cards-as-objects.md` → Implementation Decisions, "Motion has one preference and one
override". Follow the playmat preference's existing shape exactly, including its patch semantics and
its two-stage boot.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] The appearance popover carries a card-motion control beside theme and playmat, defaulting to on
- [x] A signed-in person's choice survives a reload, and appears on a second browser signed in as the same person
- [x] In open mode the choice survives a reload in the same browser, and the response reports that the server is not the record
- [x] Setting card motion leaves theme and playmat untouched; setting either of those leaves card motion untouched
- [x] An invalid value is rejected rather than stored
- [x] Someone who has never set it gets the default
- [x] One person can neither read nor write another's
- [x] The effective value — the preference resolved against the operating system's reduced-motion setting, which can only reduce — is readable from CSS and from JS
- [x] The preference is painted from local storage before the session is known and corrected from the server afterwards, as theme and playmat already are
- [x] HTTP-seam tests cover round-trip, rejection, patch semantics in both directions, the default, open mode, and cross-person isolation
- [x] `npm test`, `npm run lint:tokens` and `npm run check:contrast` are green

**Built as:** the playmat's shape, followed to the letter. `card_motion` on
`user_prefs` through the existing try/catch `ALTER TABLE` migration, a validated
`on`/`off` field on the same patch endpoint, and `js/motion.js` loaded in
`<head>` beside `js/playmat.js` — a page that paints and then discovers motion
is off has already moved.

Two values reach `<html>`, not one: `data-motion-pref` is what the person chose
and `data-motion` is what they get. The resolution rule lives in one function of
two inputs, and it only ever subtracts. CSS reads the result as `--motion`, a 1
or a 0 to multiply a duration by; `cardMotionOn()` reads the same attribute
rather than a variable of its own, so the two cannot give different answers. The
`prefers-reduced-motion` rule is last in the file at equal specificity, which is
how it beats a preference of `on` with no `!important` — and it stands alone if
no script ever runs. Ticket 02 later split the multiplier in two: `--motion` is
still this preference, and `--motion-ui` is the interface's own movement, which
this switch is not entitled to freeze.

The switch shows the preference, not the effective value. Someone whose system
asks for less motion has not turned this off, and a box that unticked itself
would tell them they had; a note below it says what happened instead.

Verified in headless Firefox on three paths the HTTP tests cannot see: open mode
(toggle, reload, toggle back — `data-motion`, `--motion` and localStorage agree
throughout); signed in, where a second browser profile with empty storage
corrects itself to the server's answer; and `ui.prefersReducedMotion=1`, where a
preference of `on` still yields `--motion: 0`, and still does with the attribute
deleted or forced to `on`.
