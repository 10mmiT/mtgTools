# Research — picking lands for a deck

An assessment of what it would take to answer "which lands should this deck
run" inside the Deck Builder, prompted by Archidekt's **Landbase** tab — the
third tab of its drawer, beside Search and EDH Recs.

The finding is that we can build a better version of it than Archidekt's,
because the two hard parts are already solved here and the third is a lookup
table. Archidekt's tab is a *browser* — it lists lands and leaves the judgement
to you. Ours can be a browser that also answers the question the browsing is
for, because this app already knows what the deck's spells cost
([deckview-mana.js](../../public/js/deckview-mana.js)) and which lands are in a
box in the room ([deckview-owned.js](../../public/js/deckview-owned.js)).

The constraints are `ui.md`'s: no framework, no build step, no new network call
if one can be avoided, colour only from `tokens.css`, every duration through a
motion token.

## What Archidekt actually does

> "Commander decks have access to EDH Recs, Landbase, and Combos. […] The
> Landbase tab shows you land cards based on popularity or cycle, all within
> your commander's color identity."
> — [EDHREC, *How To Use Archidekt*](https://edhrec.com/guides/how-to-use-archidekt-the-mtg-deckbuilding-site)

So it is two axes over one filter:

| axis | what it lists |
|---|---|
| **cycle** | the lands grouped by the cycle they belong to — shocks, fetches, triomes, painlands, and so on |
| **popularity** | the lands other people run, most-played first |
| *filter* | colour identity, taken from the commander |

And a `+` on each card, the same one Search and EDH Recs already have.

What it does **not** do is tell you whether the mana base you have assembled
works. That is the whole of the interesting part, and it is left to the reader.

## What we already have

Four of the five pieces, and none of them know about each other yet.

| piece | where | what it gives a landbase tab |
|---|---|---|
| the drawer, with tabs | `dbSetLeftTab()` [deckview-panels.js:515](../../public/js/deckview-panels.js#L515), [index.html:1077](../../public/index.html#L1077) | a third tab is about six lines; the switcher already toggles two |
| the tile with the `+` | `_dbDrawerTile()` [deckview-panels.js:198](../../public/js/deckview-panels.js#L198) | the card grid, the "already in Deck ×1" badge, the ownership mark, the "Add to" destination — all of it, free |
| pips and sources, per colour | `dbDeckMana()` [deckview-mana.js:122](../../public/js/deckview-mana.js#L122) | what the deck's costs demand, counted off `mana_cost`, and what its lands make, counted off `produced_mana` |
| whose shelf it is on | `dbCardOwnership()` [deckview-owned.js:139](../../public/js/deckview-owned.js#L139) | a landbase suggestion you can play tonight, rather than one you would have to buy |
| the Scryfall proxy | [routes/scryfall-proxy.js:52](../../routes/scryfall-proxy.js#L52) | any `cards/search` query, rate-limited once for the whole house and cached ten minutes |

The missing piece is the judgement: *how many sources of each colour does this
deck actually need*. Neither the mana panel nor the Mana Base Calculator asks
it. The panel puts two shares side by side — "24% of pips · 19% of sources" —
and leaves a person to read them; the calculator splits basics proportionally,
which is the right maths for *dividing* a fixed number of slots and says nothing
about whether that number is enough.

## Finding 1 — Scryfall knows the cycles by name

Archidekt's cycle list does not have to be curated by hand. Scryfall ships an
`is:` predicate per land cycle, and every one of them resolves. Verified against
`api.scryfall.com/cards/search` on 2026-09-04:

| predicate | cards | the cycle |
|---|--:|---|
| `is:fetchland` | 10 | Flooded Strand and friends |
| `is:shockland` | 10 | Steam Vents |
| `is:triome` | 10 | Raugrin Triome |
| `is:triland` | 10 | Crumbling Necropolis |
| `is:checkland` | 10 | Dragonskull Summit |
| `is:painland` | 10 | Karplusan Forest |
| `is:fastland` | 10 | Blackcleave Cliffs |
| `is:slowland` | 10 | Deathcap Glade |
| `is:scryland` | 10 | Temple of Malice |
| `is:battleland` / `is:tangoland` | 10 | Cinder Glade |
| `is:pathway` | 10 | Riverglide Pathway |
| `is:surveilland` | 10 | Undercity Sewers |
| `is:cycleland` / `is:bikeland` | 10 | Irrigated Farmland |
| `is:dual` | 10 | the original ABUR duals **only** |
| `is:filterland` | 22 | Mystic Gate |
| `is:bounceland` / `is:karoo` | 17 | Azorius Chancery |
| `is:gainland` | 15 | Blossoming Sands |
| `is:storageland` | 12 | Calciform Pools |
| `is:canopyland` / `is:horizonland` | 6 | Horizon Canopy |
| `is:creatureland` / `is:manland` | 49 | Celestial Colonnade |

Combined with `id<=` for colour identity and `order=edhrec` for popularity, one
request answers a whole section:

```
/api/scryfall/cards/search?q=is:shockland id<=wug&order=edhrec&unique=cards
```

— which returns 3 cards for a Bant deck, in play-rate order. Both of Archidekt's
axes are one query shape.

**The trap, and it is a real one.** An `is:` value Scryfall does not recognise is
*silently ignored* rather than refused. `is:bogusfoo t:land` returns 1224 cards —
every land in Magic — which is exactly what `t:land` alone returns. So a typo in
a cycle name, or a cycle Scryfall renames, does not produce an error message: it
produces a section headed "Shocklands" containing all 1224 lands. Whatever holds
the cycle list has to assert its own counts, the way `test/themes.test.js`
asserts every palette defines every token.

## Finding 2 — popularity is already in the building

The `lands` and `utilitylands` cardlists come back in the EDHREC payload this app
already fetches and already renders — `DB_EDHREC_SECTIONS`
[deckview-panels.js:568](../../public/js/deckview-panels.js#L568) merges them
into one "Lands" section at the bottom of the EDHREC tab, capped at 36 cards,
each carrying `synergy` and `num_decks`.

So the popularity axis costs *nothing*: it is a second view of a response already
in `dbEdhrecData`, and it comes with a play rate per card, which is more than
Scryfall's `order=edhrec` gives (a rank, not a number). The honest reading is
that we have had half of Archidekt's Landbase tab for as long as we have had the
EDHREC tab — buried under nine other sections and cut off at 36.

## Finding 3 — "enough sources" is a table, and we can look it up

This is the part worth building, and the part Archidekt does not have.

Frank Karsten's source-count work, re-simulated for the London mulligan and for
99-card singleton by
[teryror's expansion](https://gist.github.com/teryror/881d60e08480a56043895d3bbb83c374)
(five million hands per cell), gives the minimum number of sources of a colour
needed to cast a spell on curve without colour screw. For Commander at the normal
land counts:

| lands | `C` | `1C` | `CC` | `2C` | `1CC` | `CCC` | `3C` | `2CC` | `1CCC` |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 36 | 20 | 19 | 29 | 17 | 26 | 33 | 16 | 24 | 30 |
| 37 | 20 | 19 | 30 | 17 | 27 | 34 | 16 | 24 | 31 |
| 38 | 21 | 20 | 30 | 18 | 27 | 35 | 16 | 25 | 31 |

Read as: a 37-land deck wanting to cast a `{1}{U}{U}` card on turn three needs
**27 blue sources**. The rules of thumb that fall out — single pip ≈ 17–20,
double ≈ 24–30, triple ≈ 31–35 — are the ones the community quotes, and having
the table means we can quote the *right cell* rather than the average of all of
them.

We can compute the input side of that lookup today, with no new data:

- the deck's **land count** and **sources per colour** — `dbDeckMana()` returns
  both, counting a dual as a source of each colour it makes;
- the **hardest requirement per colour** — walk `mana_cost` for every card and
  find the most demanding shape per colour (`{1}{U}{U}` beats `{3}{U}`), which is
  one more pass over the symbols `_dbManaSymbols()` already parses.

So the tab can say, per colour: **"blue: 21 sources — wants 27, for Cryptic
Command on turn three"** — and then list the lands that would fix it, sorted by
who in the group owns one. That is a landbase tool. The rest is a card grid.

The caveats belong on the panel rather than hidden: the table assumes every
source is untapped and available, so a deck of taplands overstates itself; rocks
and dorks are counted as sources here although they die and cost mana; and
Commander is multiplayer, where the turn-three deadline is softer than the
model's. The numbers are a floor to argue with, not a verdict.

## What it would look like

A third tab, `Lands`, in the drawer that already holds Search and EDHREC. Three
stacked regions, top to bottom:

1. **The check** — one row per colour the deck touches: sources it has, sources
   it wants, the gap. The same two-bar shape as the mana panel, so it reads as
   the same idea seen from the other end. A colour that is fine says so and gets
   out of the way.
2. **Fix it** — for a colour that is short, the lands that make it, ranked: ones
   the group owns first, then by play rate. This is the one screen that could not
   exist on Archidekt, because Archidekt does not know what is in our boxes.
3. **Browse** — the cycles, collapsed, in colour identity. Shocks, fetches,
   triomes and the rest, each a row that opens into a grid of
   `_dbDrawerTile()`s.

The `+` means what it already means, and goes wherever the drawer's "Add to"
says.

### Where the code goes

- `public/js/deckview-lands.js` — new; the cycle list, the requirement table, the
  per-colour hardest-cost pass, the render. Sits beside the other `deckview-*.js`
  files and is loaded the same way.
- `dbSetLeftTab()` [deckview-panels.js:515](../../public/js/deckview-panels.js#L515)
  — a third branch, and a third `display` toggle.
- [index.html:1079](../../public/index.html#L1079) — one more `.db-ltab`, one
  more `.db-drawer-content`.
- `dbManaChanged()` [deckview-mana.js:119](../../public/js/deckview-mana.js#L119)
  — the lands tab's derived figures drop from the same place, for the same
  reason.
- `test/decklands.test.js` — the requirement lookup at its boundaries, the
  hardest-cost pass over a hybrid and a split card, and the cycle list asserting
  its own Scryfall counts so a silently-ignored `is:` cannot pass.

Nothing on the mat changes, and nothing here is reached from `dbRender()` — the
same promise the totals, legality and mana tickets made.

## What this does not solve

- **Taplands.** "How many of these enter tapped" is the second question every
  Commander mana base asks, and `oracle_text` is in the local cache
  ([scryfall-db.js:96](../../scryfall-db.js#L96)) so it is answerable by regex —
  but a regex over "enters tapped unless…" is a guess, and a wrong one on
  Pathways and check lands specifically. Worth its own ticket, not worth blocking
  this on.
- **Utility lands.** Command Tower is in no cycle predicate, and the colourless
  staples (Reliquary Tower, Rogue's Passage) are the ones people actually want
  suggested. EDHREC's `utilitylands` list covers this and the cycles do not.
- **Budget.** Prices are already rendered elsewhere (`renderPrice`), so an
  "under £5" filter on the fix list is cheap — but it is a preference, and the
  ownership scope answers most of what it is for.
- **The Mana Base Calculator's future.** If this lands, the calculator becomes
  the tab you use when there is *no* deck, which is what
  [lands.js:44](../../public/js/lands.js#L44) already says it is for. It should
  stay; "Open in the calculator" becomes the way out of the new tab as well as
  out of the mana panel.

## Sources

- [EDHREC — How To Use Archidekt, the MTG Deckbuilding Site](https://edhrec.com/guides/how-to-use-archidekt-the-mtg-deckbuilding-site) — what the Landbase tab is
- [teryror — Mulligans and Mana Bases](https://gist.github.com/teryror/881d60e08480a56043895d3bbb83c374) — the 99-card source-requirement tables, re-simulated from Karsten's method
- [Frank Karsten — How Many Lands Do You Need to Consistently Hit Your Land Drops?](https://strategy.channelfireball.com/all-strategy/channelmagic/channelmagic-articles/how-many-lands-do-you-need-to-consistently-hit-your-land-drops/) — the original
- `api.scryfall.com/cards/search` — the `is:` cycle predicates, probed directly; the counts in Finding 1 are from that probe
