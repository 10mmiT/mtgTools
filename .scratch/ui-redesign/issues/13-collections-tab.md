# 13 — Collections tab

**What to build:** The worst offender, fixed. Today someone opening their collection scrolls past four stacked boxes — an Add Collection form, a list of loaded collections, a search row, and a view toolbar — before reaching a single card, roughly 400 pixels down the page.

Afterwards: one toolbar and one row of collection chips, then cards. The Add Collection form moves into a drawer opened on demand, because it is a task performed rarely that currently occupies space used constantly. Each collection becomes a chip showing its name and card count, keeping its existing refresh, re-import and remove actions in an overflow menu. The search row and view toolbar merge into a single strip.

The Deck Comparison panel stays alongside on wide displays and becomes a drawer below that.

**Blocked by:** 12

**Status:** ready-for-agent

- [ ] Card art is visible within roughly 100 pixels of the top of the viewport
- [ ] Adding a collection by URL and by file import both still work, from the drawer
- [ ] Refresh, re-import and remove still work per collection
- [ ] Deck comparison still works, including the filter-to-deck-cards toggle
- [ ] Sorting, column selection and the view toggle behave as before
