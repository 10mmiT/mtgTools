# 19 — Players & Decks and Admin

**What to build:** Deck tiles already use commander art as their background — they are the model the rest of the app is moving toward, and they keep their fixed light text over artwork under the documented exemption. They gain slightly tighter tiles on the shared spacing and radius scales, use the full width, and lose a hover colour that belongs to no palette.

Admin becomes one page of plain sections with its forms at a readable measure. It is intentionally low-density and text-forward; it does not need to be dense.

**Blocked by:** 12

**Status:** done

- [x] Adding, editing and removing players and decks still work, with confirmation on removal —
      driven in a browser and re-read from the server's API, including a refused confirm that
      leaves the deck and the player where they were
- [x] Compare and Build actions still work from a deck tile — Compare loads 93 rows into the
      Collections comparison panel, Build opens the deck selected in the Deck Builder
- [x] Commander art still loads as the tile background — 59 of 63 tiles, the other four being
      decks with no commander recorded
- [x] Every admin function still works: user management, account requests, role changes —
      create, edit, role change, player link, delete, approve at a chosen role, deny
- [x] Admin forms are at a readable width rather than stretched — the form is 727px against a
      727px measure at both a 1440 and a 2560 window, while the user table takes 1362 and 2482

**Delivered:** the two boxes off Players & Decks, the last box and the last collapsible off
Admin — and four of the linter's sixteen `!important`, three of them retired by removing what
they were fighting rather than by re-scoping.

**Two of §9.9's four instructions had already happened.** The tile radius was `--radius-md`,
and issue 10 had already replaced the indigo hover — reaching the same conclusion this ticket
would have, that `--primary` cannot be the replacement because it is near-white on the dark
themes and a white wash under white text over artwork is unreadable. What was left was the
tile size and the width.

**`.content-wide` had nothing to hold on to until the boxes came off.** The shell has been the
wide behaviour since issue 12, so the tiles were already inside it — and inside a `--surface-1`
player box, a `--surface-2` header bar and `--space-4` of grid padding. A player is a heading
and a grid now, the §7.1 grouping the rest of the app already had. The tile row is the pane:
1350px at 1440 and 2470px at 2560, from 1316, and **five tiles across where there were four**.

**The add-player box is the tab's strip**, the move Available@ made in issue 18: one control, so
the one control is the whole strip, with `9 players · 63 decks` in the `.result-info` slot every
other tab gives its count. The player's colour is a dot rather than a 4px rule down the left of
a header bar — without the bar that rule is an accent stripe beside a heading, which is what
§4.7 spent the redesign deleting.

**The card count moved off the action row, and that is the one change here that is not
cosmetic.** Three controls and "100 cards" want 275px of a 234px row, and flex wraps before it
shrinks, so at 260px half the tiles grew a second row holding a single `⋯`. The count is a line
under the commander now — what the deck *is*, rather than something to do to it — and every
tile's action row is the same three controls. Pick Night's result tiles are wide enough to keep
theirs where it was and are byte-identical after this.

**Admin's measurable half was already true.** Issue 12 gave the Create User form
`.content-prose` and issue 15 gave every `.table-wrap` §7.6's opaque surface. What was left was
the word *plain*: Create User was a `.section--boxed` collapsible, shut by default — the last
box on the page and the last collapsible in the app. It is an open form under a heading, and
the page is three sentence-case headings over two full-width tables and one form at the measure.

**The collapse machinery went with it** — `toggleSection()`, `applyCollapse()`,
`.section-title.collapsible`, `.section-body` and `.section-body.closed`. A form of four fields
on the app's least dense screen has nowhere sensible to put a lid, and the chevron stays because
a player's row of decks still folds.

**The ratchet: 16 `!important` down to 12.** `.section-body.closed` went with the collapsible.
The other three were mobile width overrides beating an *inline* `width` on a form control; the
widths are `.admin-field` and `.players-name-input` now, so the media query matches them at
equal specificity and wins on source order — which is exactly the fix the allowlist's comment
asks for.

**And an alignment bug they had been half-hiding.** The admin form's mobile rule sat in the
responsive section *above* the rule it overrides, so its `align-items: stretch` lost to
`flex-end` and every field on a phone sat against the right edge of the column. The two
`!important` covered the widths; nothing covered the alignment, and the boxed section was shut
by default, so no screenshot had ever shown it. The rule lives beside the one it overrides now.

**Verification.** 67/67 tests, token contract clean, contrast clean, layout clean — chrome 78px
at both windows, no prose past the measure, folds unchanged. Forty-seven interaction checks
driven in a real browser against a throwaway copy of the snapshot database: every acceptance
criterion above, both confirm dialogs answered each way, the strip's count following an add and
a removal, the fold and its persistence, and the phone layout of both tabs including the
alignment bug and a check that neither tab scrolls sideways at 390px.

`scripts/measure-layout.js` gained `.deck-tiles-grid` in its widest-grid list, because "use the
full width" is a number and this tab had nothing in the list that could answer it.

All 110 views recaptured against `post-avail-lands`: thirty changed, eighty byte-identical. The
twenty `players--*` and `admin--*` views are this ticket. The other ten are `sets--*` and are
not — the set index went from 301 of 315 to 314 while this was in progress, which is the first
of the README's two harness caveats.
