# 06 — The deck filter speaks Scryfall syntax

**What to build:** the Deck Builder's filter box reads the same query language the Collections
search now does, run against the deck in front of you.

Today it is a substring test against name and oracle text, which answers one question. The parser
that answers the rest already exists — it was written for Collections, it runs against the same
local card facts the mat reads, it compiles once per keystroke, and it already refuses filters the
local cache cannot answer by naming them rather than quietly matching nothing. This ticket points
the deck's filter at it.

**A bare word must go on meaning what it means today.** Typing `goblin` is a name search, not a
syntax error and not a lesson in a query language. Only a recognised filter turns the box into a
query.

The deck is a far smaller population than a collection, so nothing here is a performance question —
it is the same parser doing less work.

Two predicates that belong in this language arrive with later tickets rather than this one:
ownership from ticket 08 and Game Changers from ticket 10. Leave room for them; do not block on
them.

From `spec-deckbuilder-depth.md` → proposal 7.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A bare word still filters by name, exactly as before
- [ ] Type, colour, mana value, oracle text, rarity and price filters work against the open deck
- [ ] Negation, `OR` and parentheses work, and lower-case `or` is still a word in a card name
- [ ] A filter the local card cache cannot answer is refused by name, and says why
- [ ] An unknown filter says it is unknown rather than matching nothing
- [ ] Filtering composes with the sort and with the view, and hides nothing outside the deck
- [ ] Filtering a category to empty leaves the category visible rather than silently gone
- [ ] Clearing the box restores every card
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
