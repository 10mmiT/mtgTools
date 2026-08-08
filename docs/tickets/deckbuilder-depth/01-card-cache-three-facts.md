# 01 — The card cache learns three new facts

**What to build:** the local card cache carries three facts it currently throws away — whether a
card is legal in each format, whether it is on Wizards' Game Changers list, and what mana it can
produce. Nothing visible changes; three tickets downstream stop being impossible.

This is one ticket rather than three field-additions folded into the features that want them,
because the bulk refresh re-downloads the entire compressed bulk file and skips when the upstream
timestamp is unchanged. Every change to the trimmed card shape therefore costs a forced full
re-download on whatever box the app is self-hosted on. Adding the three fields together costs one;
adding them a ticket at a time costs three.

There is a quieter trap the ticket has to close. Rows imported before the shape changed keep the
old shape, and the refresh skips when the upstream timestamp matches — so a feature reading a new
field sees `undefined` rather than an error, on a cache that believes it is up to date. The trimmed
shape needs a version marker of its own, so that changing it forces a re-import independently of
whether Scryfall has published anything new.

From `spec-deckbuilder-depth.md` → Dependencies: *"The three `trimCard` additions are one small
ticket that unblocks three proposals, and worth doing first for that reason alone."*

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Cached cards carry `legalities`, `game_changer` and `produced_mana`
- [x] The trimmed card shape carries a version marker, and changing it forces a re-import even when the upstream bulk timestamp is unchanged
- [x] An existing install picks the new fields up on upgrade without anyone running anything by hand
- [x] A card known to be a Game Changer reads as one, and a card known not to be does not
- [x] `produced_mana` is present for lands and for mana-producing non-lands alike
- [x] The growth in database size is measured and recorded in the ticket, so the cost to a self-hosted box is a known number rather than an assumption
- [x] Consumers tolerate a missing field rather than throwing, so a half-refreshed cache degrades instead of breaking
- [x] `npm test` is green

## What was built

`SHAPE_VERSION` in `scryfall-db.js`, currently 2, written to the `meta` table only
once an import finishes. The daily refresh skips the download when Scryfall's
`updated_at` is unchanged *and* the stored shape version matches; either being stale
downloads the file. So an upgrade re-imports on the next start with nobody typing
anything, and a run that dies halfway leaves the old version behind rather than
claiming a conversion that did not finish.

The three fields are copied **verbatim** — `legalities` keeps its two dozen
`not_legal` entries, `game_changer` keeps its `false` — because the client falls back
to `api.scryfall.com` for names this cache misses, and a check reading one source has
to read the other the same way. `produced_mana` stays absent on cards that make no
mana, which is Scryfall's own shape.

Rows still in the old shape are filled on the way out of `getCard()`: `legalities: {}`
and `game_changer: false`. A consumer writing `card.legalities[fmt]` gets `undefined`
— unknown — rather than a TypeError, and a stale row is never mistaken for a banned
card or a Game Changer. This matters for minutes, not seconds: the container serves
requests while 24 MB downloads in the background, and for the first of them every row
is a stale one.

## What it costs

Measured against the real `oracle_cards` file of 2026-08-07 — 38,623 cards — by
importing it twice through both shapes and weighing the databases:

| | JSON in the table | file, vacuumed |
|---|---|---|
| before (shape v1) | 54.2 MB | 74.6 MB |
| after (shape v2) | 74.6 MB | 93.5 MB |

**+18.9 MB, +25%.** An existing install upgrades in place rather than from empty,
which fragments: 74.6 MB → **96.0 MB** without a `VACUUM`. Card responses grow too —
a 100-card collection lookup goes from 140.6 KB to 192.5 KB, which is 24.2 KB to
26.3 KB over the wire, since `compression()` is on and two dozen legality lines per
card are about as compressible as text gets.

Nearly all of it is `legalities`: 19.5 MB of the 20.4 MB of new JSON, and most of
*that* is the `not_legal` entries. Dropping them would save ~12 MB and was rejected —
it would make a cached card answer differently from the same card fetched live, which
is a bug waiting for whoever writes the legality line. If a self-hosted box ever finds
19 MB expensive, that is the lever, and this is the number to weigh it against.
