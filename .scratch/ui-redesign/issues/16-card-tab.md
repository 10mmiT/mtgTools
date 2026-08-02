# 16 — Card tab

**What to build:** The most text-heavy screen in the app, and therefore the most important test of the reading measure. Card image on one side, text column on the other at a comfortable width, on wide displays.

Rules text and flavour text step up to the prose size rather than sharing the size of a table row. Rulings become a list rather than a table. Legality badges adopt the status colours.

The gallery of other printings at the bottom uses the full width.

**Blocked by:** 12

**Status:** done

- [x] Rules text and rulings are comfortable to read and never exceed the measure —
      727px against a 727px measure, prose leading on both
- [x] Both faces of double-faced cards still display
- [x] Rulings, legality badges, prices and outbound links all still work
- [x] The printings gallery still loads a chosen printing
- [x] The desktop modal and mobile full-page behaviours both work at the new switch width

**Delivered:** the tab's last box gone, the rulings a dated list, the legality
badges on the status colours, and the printings gallery on the app's own card
grid.

**The box was the whole of the chrome surgery here.** §9.6 gives this tab no
sections, and `.card-detail-info` was one: a `--surface-1` panel with a
hairline and its own padding, wrapped around the text that the ticket exists
to make readable. Inside the modal it was that same surface drawn a second
time, one inset from the other. What holds a column of prose together is its
measure, which the column already had.

**The measure is binding now, and worth stating exactly.** The oracle lines
run 727px against a measure of 727 — the box's padding used to hold them 52px
inside it, so removing it is what took them to the cap. Two facts sit behind
that number and neither is obvious: `body` is `--text-md`, so `72ch` resolves
at 16px, the same size as the prose it governs; and Inter's `0` is .63em, so
72 `ch` is about **87 characters** of running text, not 72. The token is the
app-wide contract and every other prose site shares it, so this ticket did not
touch it — but if the measure is ever revisited, that is the arithmetic to
revisit it with.

**Legality has four states, not three.** It was `legal` green, `restricted`
white and *everything else* grey at .65 opacity — mana colours on the one tab
whose subject is mana colour, and a "banned in Legacy" that looked exactly
like "was never printed for Standard". It is `--success` / `--warning` /
`--danger` on their soft fills (§7.9) with the absent case left as the
surface: colouring five greyed formats red on an ordinary card would say
*error* seven times a page. Restricted and banned also say the word, because a
badge whose meaning is carried by hue alone is no badge at all to someone who
cannot see the hue, and every badge carries `format: status` as its tooltip.
The pairs were already in `check-contrast.js` — status ink on its own soft
fill is one of the pairs it walks for all five themes — so this needed no new
measurement, only the colours it had been measuring.

**The rulings were a table in everything but the tag.** Two cells and a rule
under each row, with a date column taking a fifth of the measure away from the
only part anyone reads. They are a `<dl>`: the date leads its ruling at
`--text-xs`, the ruling takes the full measure at the prose step, and the
space between them is what separates them rather than a hairline per pair. The
class stayed on the `dd`, so `measure-layout.js` still finds `.card-ruling-text`
without being told about the new markup.

**The printings gallery is the app's `.card-grid`.** It had a bespoke 110px
track and a second bespoke 90px one below 900px; it now sizes like every other
grid of card images in the app — eight columns at 1440 rather than eleven, two
on a phone. The tiles keep their surface and hairline, which §7.7 would
eventually take off them: every other grid in the app still wears the same
box, and stripping it from this one gallery alone would make the card tab the
odd one out. That is one change across five tabs and belongs with the
[ui.md](../../../ui.md) card-interaction work, which the spec schedules after
this phase.

**Two small corrections while in here.** The image column's sticky offset was
`4.5rem`, a clearance for a header that does not exist at the only width where
the column is sticky — it is `--space-4`, the page padding, and the same
offset works inside the scrolling modal. And the print tile's border was
1.5px where the rest of the app's tiles are 1px.

**The fold measurement learned about this tab.** Adding `.card-grid` to the
printings gallery made `measure-layout.js` report a fold of 569px for the card
tab — the top of the gallery at the *bottom* of the page, which is the
opposite of what a fold means. `.card-detail-img` is in the fold selector now
and the tab reports 16px, the card itself. No budget: the ticket states no
number, and a budget nobody wrote down is not a budget.

**Verification.** 67/67 tests, token contract clean, contrast clean, layout
clean — chrome 78px, folds 16/60/94/102/133, no prose past the measure at
either window. Thirty-four interaction checks driven in a real browser against
a throwaway copy of the snapshot database: both faces and both face images of
a DFC, the seven badges and their computed colours against the theme's own
tokens, prices, both outbound links, the `<dl>`, the gallery's width against
the shell's, a printing chosen by clicking its tile, and the 900px switch
driven from both sides — a click at 960px opens the modal and Escape closes
it, the same click at 880px opens the full page with no modal behind it.
Twenty card-detail views captured before and after across all five themes at
both viewports, plus the modal — which hash routing cannot reach, so it takes
a click — in five themes.

**The standard 110 views are the regression half of that, not the change.**
The card tab's own entry in that set is `#card`, which is the tab with nothing
open — the empty state, which this ticket does not touch — so all ten card
views are byte-identical, and a ticket that changed the card view would look
exactly like a ticket that changed nothing. That is why the twenty
`card=<name>` views above exist. Of the other hundred, eighty are identical
and thirty are data rather than layout: the ten `sets--*` views are the set
index filling between two runs, which the README already covers; the ten
`wants--*` views differ only in the price column, because the run refreshed
the bulk cache and the figures moved a few cents; and the ten `pick--*` views
gained the "Open Deck Pool…" line, which is issue 15's — its baseline was
captured twenty minutes before its own final commit. Nothing on any other tab
moved.

**Two of the failures along the way were the harness, not the app,** and both
would have been read as this ticket breaking something.

A check that navigated from `#card=Delver` to `#card=Black Lotus` reported the
wrong legalities, because that is a *same-document* navigation: the app reads
the hash once, at load, so the second view was the first one wearing the
second one's URL. `capture-screens.js` already goes via `about:blank` between
views for exactly this reason; the throwaway driver now does too.

And "the printings gallery does not load a chosen printing" was the
**set-index sweep** starving the Scryfall queue. The sweep is ~1,400 paged
requests, Scryfall answers a burst of them with 429s carrying a 60-second
`Retry-After`, and the queue is shared, so a card lookup made while it runs
waits behind a minute of penalty and the view sits at "Loading…". Nothing to
fix in the app — one queue is the point — but it is now in the README beside
the harness's other two "the picture is not the change you made" cases.
