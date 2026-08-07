# 08 — The table header is a shortcut into the same model

**What to build:** in Collections' list view, a plain header click **replaces the whole sort with
that column's seeded chain**, and a shift-click **appends** that column as the next criterion, up
to three. Clicking the column that is already first flips its direction, as it does today.

The header stops being a second sorting system. Today it writes fields into `mtgtools_sort` that
the select cannot display — which is the only reason `syncColSortControl()` exists, and that
function goes with this ticket.

The sorted-column indicators have to say more than they do. A header carrying the first criterion
is marked as it is now; a header carrying a later one needs to show that it is in the chain and
where — otherwise shift-click is an invisible feature and a user who used it cannot tell why their
cards are in that order.

From `docs/design/spec-sorting.md` → "The table header is a shortcut into the same model".

**Blocked by:** 04 — Choosing a field seeds the sentence; 06 — The control says the sentence.

**Status:** done

- [x] A plain header click replaces the chain with that column's seeded chain — through
      `chooseSortField`, so it is the control's first row said faster. Which means it seeds the whole
      sentence on a chain that is still the app's and swaps one word of a chain somebody has edited;
      see the first note below, because that is a reading of this line rather than the letter of it
- [x] A shift-click appends that column as the next criterion — `appendSortColumn`, in the direction
      that field is usually read
- [x] Shift-clicking at three criteria is a no-op, or replaces the last, and which is stated —
      **it replaces the last**, and why is in the second note below and in the comment on the function
- [x] Shift-clicking a column already in the chain moves or flips it rather than duplicating it —
      **it flips it where it stands**, first word included, so the gesture means one thing wherever
      it lands
- [x] Clicking the column that is already the first criterion flips its direction — the one thing a
      click on the leading column cannot be is a re-seed, which would throw away the arrow being
      toggled
- [x] Every header click leaves the sort control's label showing the same chain — structurally, not
      by being kept in step: the header hands a chain to the control's `set()`, which is the only
      thing that writes this view's entry. Asserted both ways — in the `vm`, that no gesture reaches
      a chain `chainLabel` cannot say; and in the browser, that the label after each of seven clicks
      is the sentence the marks draw
- [x] A header carrying a later criterion is visibly marked, and its position in the chain is legible
      — `↑` on the column that cuts the piles, `2↑` and `3↓` on the ones that only order the cards
      inside them, the first in `--primary` and the rest in `--text-muted`. `aria-sort` goes on the
      first criterion alone: it is the one the table is ordered by, and the attribute has no way to
      say "and then"
- [x] `syncColSortControl()` is gone — and so are the two things that only existed for it:
      `saveSort()`, the second writer of the stored entry, and `state.sort`, the mirror of the first
      criterion the header drew its arrow on. Confirmed absent from the running page, not only from
      the source
- [x] The per-collection quantity columns work through the same path as every other column — they are
      `col:<id>` fields in this tab's field list, so the header does nothing special with them.
      Smoke-tested: Binder and Deckbox both shift-click into the chain, and Deckbox replaces Binder
      at three
- [x] Correct in all five themes, using existing tokens only — two token colours and no new value.
      `--primary` on `--surface-2` is a pair `check-contrast.js` was not measuring; it is now, and
      clears 13.6–18.4:1 against a 4.5 floor in the five palettes
- [x] Shift-click has a reachable equivalent for keyboard and touch, or the sort control is documented
      as that path — **the sort control is that path**, and the comment over the header wiring says so
      and says why. A `<th>` is not focusable, making the row so is a tab stop per column on the way
      into the table, and a phone has no shift key. The popover adds, reorders, flips and removes
      criteria, sits directly above the table and is fully keyboard-operable. A tooltip on every
      heading is what tells somebody holding a mouse that the shortcut exists
- [x] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
- [x] Confirmed in the browser as well as in the `vm`, on the dark and light palettes: seven clicks
      through a two-collection table, each one checked against the control's label, the stored entry,
      the marks on the row and the order of the rows, plus a reload proving the round trip

Three things settled here:

- **A plain click is `chooseSortField`, not an unconditional re-seed.** The ticket's wording —
  "replaces the whole sort with that column's seeded chain" — is drawn against shift-click's *append*,
  and on the chains it describes the two readings agree: an unedited chain is re-seeded whole. They
  part on a chain somebody built in the popover, and there the header follows the model rather than
  the sentence. The `edited` bit exists exactly so that a tail somebody wrote survives a change of
  first word, and a header that ignored it would let one click on a heading destroy a three-word sort
  with no undo and no warning — while the popover, doing the same thing, preserved it. That is the
  header being a second system again, in a subtler place. Every column is asserted to give the same
  answer as the select's first row, which is the property "a shortcut into the same model" means.
- **At three criteria a shift-click spends the last word rather than doing nothing.** The popover's
  Add greys out at three and can say why in its tooltip; a shift-click has nowhere to put that
  sentence, and a gesture that silently does nothing is one people conclude is broken and stop using.
  The word it spends is the last, which separates the fewest cards, and the control directly above
  prints the whole chain on the same render — so what was traded for what is legible immediately.
- **A shift-click on a column already in the sort flips it in place.** Duplicating is impossible —
  `tidyChain` drops a repeated field, since the second occurrence could never fire — which leaves
  moving it to the end or flipping it. Moving silently reorders a sentence somebody wrote; flipping
  makes the gesture mean "that word, the other way" wherever the word is, which is one rule instead
  of two and is the same thing a plain click does to the first column.
