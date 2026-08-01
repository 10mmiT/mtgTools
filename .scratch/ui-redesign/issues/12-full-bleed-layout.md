# 12 — Full-bleed layout and sidebar default

**What to build:** The cards get the room. Three changes together take horizontal chrome from roughly a fifth of the window to about a twentieth.

The fixed maximum content width is removed, replaced by two behaviours: **wide** for card grids and data tables, which use the entire available width; and **prose** for rules text, rulings, forms, admin screens, login and empty states, which keep a comfortable reading measure. A wide monitor now genuinely shows more cards, while long text does not stretch into unreadable ribbons.

The sidebar defaults to its narrow icon-only state. The collapse mechanism and its persistence already exist — only the default changes. Hover must **not** auto-expand it; that causes the layout to move while someone is scanning a grid.

The Deck Builder's bespoke full-width mechanism is replaced by the shared wide behaviour.

**Blocked by:** 07, 10

**Status:** done

- [x] Card grids and tables use the full width, with no cap, on an ultrawide display —
      the Collections table goes 1062px → 2182px between a 1440 and a 2560 window,
      the admin tables 1362 → 2482. Both grow by exactly what the window gained.
- [x] No prose line exceeds the reading measure — measured across all eleven tabs
      plus the card detail, at both widths.
- [x] The sidebar starts collapsed, expands on click, and remembers an expanded choice
- [x] Crossing the sidebar with the pointer does not change the layout
- [x] Horizontal chrome measures 78px at a 1440-pixel window, against a budget of 80

**Delivered:** the 1400px cap replaced by two named behaviours, the sidebar
default flipped, the Deck Builder folded back into the shell — and
`scripts/measure-layout.js`, because three of the five boxes above are numbers
and a screenshot cannot produce one.

**`.container` is gone rather than trimmed.** The spec deletes its `max-width`
and adds `.content-wide` / `.content-prose` beside it, which would have left
three names for two behaviours and one of them a no-op — the shell *is* the
wide behaviour, so a `.content-wide` inside it would say nothing. The shell
element is now `.content-wide` itself, `.content-prose` caps the sub-trees
that are text, and there is no third name.

One departure from the spec's snippet, which is `padding-inline` only: the
shell keeps block padding too. There is no header on desktop — it folds into
the sidebar — so inline-only padding puts the first row of cards against the
top of the viewport.

**Where the 206px went**, at 1440: sidebar 186 → 46 (140), page padding 24 → 16
a side (16), and the cap was not binding at this width so it contributed
nothing here — it is what the 2560px case is about. 284px → 78px, a fifth of
the window down to a twentieth.

**The prose sites.** `.content-prose` on the card text column, the rulings
list, the Add Collection form and the admin Create User form; the measure
composed directly into `.empty-state` and `.lands-sub`, which are written from
too many places to tag by hand. The login page needed nothing — its card was
already a centred 360px, narrower than the measure.

Two of these are worth their reasoning:

- **The card detail** caps `.card-detail-info`, not the grid track. A track of
  `minmax(0, --measure)` is not flexible, so it takes its growth limit
  regardless of the container and would have overflowed `.card-modal-box`,
  which is 900px — the same view, rendered in the modal, is narrower than the
  measure already. Capping the box leaves the track free to shrink.
- **`.empty-state`** is often a `<td colspan>`, where `max-width` is inert.
  That is fine and is why the measurement checks line boxes rather than
  containers: a centred "No users yet." in a full-width row is a 90px line,
  not a 2482px one.

**Deck Builder.** `.db-full-width` carried a copy of the page padding purely
to compensate for living outside the shell. It is `.db-pane` now, inside the
shell, and holds one declaration: `padding-bottom: --space-6`, the clearance
its fixed stats bar needs, stated as what it adds rather than as a total it
restates.

**Two sidebar tokens, and a bug they closed.** `--sidenav-width` /
`--sidenav-collapsed-width`. Six rules across two files have to agree on that
one number, and they had already drifted: `.db-stats-bar` was written as
`var(--sidenav-width, 200px)` against tokens that were never defined, so the
fallbacks were what shipped — 200/48 under a sidebar that is 186/46. The bar
sat 14px out expanded and 2px out collapsed. Defining the tokens fixes it, and
the collapsed default is what would have made that 2px permanent.

**Hover was already correct** — no rule and no handler on the nav changes
geometry, only colour. The criterion is met by construction, so nothing was
added to meet it.

**The measurement found something the eye had passed over.** Its first run
covered five tabs, chosen as the interesting ones, and reported clean. Mana
Base was not among them, and had three paragraphs running 965px. The tab list
is all eleven now, and `p` is in the prose selector list so it does not depend
on someone remembering to add the next class name.

**Verification.** 61/61 tests, token contract clean, contrast clean. All 110
views recaptured against `post-typeface`: 65 changed, 45 identical. Sixty of
the changes are this ticket — all 55 desktop views, plus the five Deck Builder
phone views where the pane moved — and the phone views of the other ten tabs
are byte-identical, which is the shape this change should have. The remaining
five are the `available` phone views, and are not this change: that pane is a
week list around the current date, and the date rolled over mid-session. It
belongs beside the Set Browser in the README's note about panes whose content
moves on its own. Tablet
and tablet-wide captured as well, since the shell straddles 900px: below it
the mobile header and dropdown are untouched, above it the pane is full width
under a collapsed sidebar.
