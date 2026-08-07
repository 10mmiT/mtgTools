# 08 — The deck says what you own

**What to build:** the deck answers *can I sleeve this tonight*, and then *who could lend me the
rest*.

Every card on the mat already wears an ownership badge. What is missing is the deck-level answer and
any way to act on it. This ticket adds **"87 of 99 owned"** to the readout — meaning owned by *you*
— which opens to break the missing twelve out: the ones sitting in somebody else's collection, named
and in their own colour, and the ones nobody in the group has at all.

**It scopes what "owned" means; it does not filter the mat.** Every card in the deck stays on the
mat, always. A deck builder that hides cards which are in your deck is hiding your deck — the count,
the curve and the pile shape would all stop describing the thing being built. What changes is the
question the badges and the readout answer: yours by default, then the group's, then every
collection loaded, chosen from the toolbar and remembered.

**Filtering belongs where you are choosing what to add.** The search panel gets an *owned by me /
owned by the group* toggle — the "build only with cards you own" idea, put at the point where it
helps. It must query the local shelf rather than filtering results that came back from elsewhere: a
page of search results narrowed to the three you happen to own reads as broken, and "find me a card
I own that does X" is a question about our shelves, not about Magic. A filter chip on the mat —
missing, owned, owned by someone else — stays available for the cases that want it, off by default.

Cards nobody owns can be **sent to your want list** in one action.

From `spec-deckbuilder-depth.md` → proposal 1. Rejected there: defaulting the mat to only cards you
own, and dimming unowned cards on the mat.

**Blocked by:** 07 — A collection has an owner.

**Status:** ready-for-agent

- [ ] The readout says how many of the deck you own, defaulting to your own collections
- [ ] The scope can be changed to the group's shelves or to every collection, and is remembered per person
- [ ] Opening the readout lists what is missing, separating what someone else has — named — from what nobody has
- [ ] Every card in the deck stays on the mat at every scope
- [ ] The search panel can narrow to cards you own or the group owns, answered from the local shelves rather than by discarding results
- [ ] Missing cards can be sent to your want list in one action, and arrive there
- [ ] The mat's ownership filter chip exists and is off by default
- [ ] The readout counts the mainboard, and does not count the maybeboard
- [ ] In open mode with no resolvable identity, the readout reads as the group's rather than breaking
- [ ] A card in no collection at all is reported as owned by nobody, not as an error
- [ ] Works in all five themes and at every breakpoint
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
