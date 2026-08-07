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

**Status:** ready-for-agent

- [ ] Cached cards carry `legalities`, `game_changer` and `produced_mana`
- [ ] The trimmed card shape carries a version marker, and changing it forces a re-import even when the upstream bulk timestamp is unchanged
- [ ] An existing install picks the new fields up on upgrade without anyone running anything by hand
- [ ] A card known to be a Game Changer reads as one, and a card known not to be does not
- [ ] `produced_mana` is present for lands and for mana-producing non-lands alike
- [ ] The growth in database size is measured and recorded in the ticket, so the cost to a self-hosted box is a known number rather than an assumption
- [ ] Consumers tolerate a missing field rather than throwing, so a half-refreshed cache degrades instead of breaking
- [ ] `npm test` is green
