# 10 — Legality, and the bracket the deck is

**What to build:** the deck says whether it is actually legal, and roughly how strong it is.

**Legality** is table stakes and we have none of it. The readout gains a line for the deck's format:
legal, or the specific reason it is not — the wrong number of cards, a card outside the commander's
colour identity, a banned card, too many copies of something. Colour identity is the one that
actually bites Commander players and is the one we can already compute.

**The bracket** is the interesting half. Wizards' five-bracket system is defined largely by the Game
Changers list, with tutors, extra turns, mass land denial and two-card infinite combos as the other
inputs. Count the Game Changers in the deck, flag what can be flagged from oracle text, and place
the deck in a bracket **with the reasoning shown**.

The deck record already carries a bracket field. It is written, round-tripped and permission-checked
— and nothing has ever read or set it. That field is where the player's **declared** bracket goes,
and the estimate is shown beside it rather than instead of it. **This is an estimate and must never
read as a verdict**: Wizards' own system is a self-assessment, and a tool that tells someone their
deck is bracket 4 without saying why is picking a fight it cannot finish.

Then the payoff that only this app can have: the declared bracket becomes a **chip on the deck tile**
where the decks live, and **Pick Night can narrow its pool by bracket** — so "tonight is a bracket 2
night" becomes something the app can arrange rather than something four people negotiate.

From `spec-deckbuilder-depth.md` → proposal 3. Note that proposal 9's combo service offers a proper
bracket classification later; this ticket's heuristic is meant to be replaced by it, not defended.

**Blocked by:** 01 — The card cache learns three new facts.

**Status:** ready-for-agent

- [ ] The readout says whether the deck is legal for its format
- [ ] An illegal deck says which rule it breaks, naming the offending card where there is one
- [ ] A card outside the commander's colour identity is caught
- [ ] The estimated bracket is shown with the reasons that produced it
- [ ] The player can declare a bracket, and it is stored on the field that already exists
- [ ] Declared and estimated are visibly different things, and the estimate never overwrites the declaration
- [ ] The deck tile carries the declared bracket
- [ ] Pick Night can restrict its pool by bracket, and says so when the restriction empties the pool
- [ ] A deck with no commander is judged against its own format rather than against Commander
- [ ] A deck whose cards predate the current cache refresh does not report a false legality result
- [ ] Works in all five themes and at every breakpoint
- [ ] `npm test`, `npm run lint:tokens`, `npm run check:contrast` and `npm run measure:mobile` are green
