# Architecture

How the code is laid out, the two pieces of derived data worth explaining (the set index and the state revision), and the records that supersede what each large effort was planned from. For the test suite and measurement tooling see [testing.md](testing.md).

## Project Structure

```
mtgtools/
├── server.js          # Express entry point — wires up middleware, routes, and /healthz
├── available-db.js    # SQLite setup (all persistent app data)
├── deck-history.js    # Deck snapshots — when one is written, the caps, and the diff on read
├── scryfall-db.js     # Scryfall bulk-data cache — daily oracle_cards download into SQLite
├── scryfall-queue.js  # One rate-limited Scryfall queue for the whole process (~9 req/s, Retry-After)
├── set-index.js       # What is in each set — background-filled, for the Set Browser's owned counts
├── playmat-store.js   # Uploaded playmat images — one file per user, under data/playmats/
├── middleware/
│   ├── auth.js        # Session auth helpers (requireAuth, requireAdmin)
│   └── limits.js      # The app's rate limiters — auth and playmat upload, two budgets
├── routes/
│   ├── admin.js       # Admin panel API — user management, account requests
│   ├── auth.js        # Auth API — login, logout, account request, change password
│   ├── available.js   # Availability calendar API
│   ├── cards.js       # Local card endpoints — /api/cards/collection + /api/cards/autocomplete (from scryfall-db)
│   ├── decks.js       # Deck Builder API — a deck's cards, its categories, and its snapshots
│   ├── prefs.js       # Per-account preferences — theme, playmat, card motion
│   ├── scryfall-proxy.js # Live Scryfall proxy — shared rate-limit queue, Retry-After handling, 10-min GET cache
│   ├── proxy.js       # Archidekt/Moxfield collection + deck proxy, EDHREC proxy
│   ├── rss.js         # RSS feed proxy + 10-minute server-side cache
│   ├── sets.js        # Set Browser data — /api/sets: the set list with per-set owned counts
│   └── state.js       # App state API — collections, players, decks, want lists
├── test/              # 54 files, run by `npm test`
│   ├── server.test.js       # HTTP seam — auth, state, admin, decks, prefs
│   ├── prefs-open-mode.test.js  # Preferences with no accounts to hang them on
│   ├── tokens.test.js       # Token-contract lint, asserted over the delivered CSS
│   ├── themes.test.js       # All five palettes define every token
│   ├── fonts.test.js        # The vendored typeface is served and self-hosted
│   ├── playmat.test.js      # Upload, replace, remove, and what counts as an image
│   ├── offline.test.js      # The app renders with no route out
│   ├── motion.test.js       # The preference resolved against the OS setting
│   ├── cardlift.test.js     # The lean, at the extremes and at the centre
│   ├── cardstack.test.js    # Layers from count, angle from name
│   ├── cardgroups.test.js   # Which pile a card belongs in, per sort field
│   ├── cardsort.test.js     # A sort as a chain — order, seeding, ownership, migration
│   ├── cardquery.test.js    # Scryfall syntax — what each filter reads, and what is refused
│   ├── cardsize.test.js     # The size store, keyed per tab and per view
│   ├── cardmove.test.js     # What travels on a re-render, and what is skipped
│   ├── carddrag.test.js     # Hit-testing piles, the fan, the drop's effect
│   ├── cardmenu.test.js     # Where a menu asked for at a point is drawn
│   ├── cardcache.test.js    # The cached card's shape, and the version that re-imports it
│   ├── cardshelf.test.js    # Which printings of this card are held, and the shelf that cannot say
│   ├── deckdrag.test.js     # Picking a deck tile up, the zone that would take it, and where it lands
│   ├── deckhistory.test.js  # When a deck is snapshotted, the caps, and what a restore puts back
│   ├── deckframe.test.js    # The builder's frame — what folds away, and what stays
│   ├── deckboards.test.js   # Two Sol Rings — the maybeboard, the sideboard, and the count
│   ├── deckcommander.test.js # The commander as a board rather than a category
│   ├── deckfilter.test.js   # The deck's filter box — the query language run over one deck
│   ├── collectioncsv.test.js # What a real CSV export says about its printings, and what it does not
│   ├── collectionowner.test.js # Whose shelf is whose — the column, the shelf, the open-mode name
│   ├── deckowned.test.js    # "87 of 99 owned" — the scopes, the missing twelve, and
│   │                        # whether it is the printing the deck runs
│   ├── decklegality.test.js # Legal or the reason it is not, the bracket estimate, and tonight's bracket
│   └── decklands.test.js    # The Lands tab — the cycles' pinned sizes and what one open section costs; the check: the source-count table at its boundaries, the hardest cost per colour, and what is allowed to count as a source; the fix: the query a short colour asks, and the copies in the house sorting above the play rate; and the basics optimizer: the split, the basics it will not touch, the three rules about {C} — the third of which is whether Wastes is one of those, the "at least 1 basic of every colour" override in both its states, and the write
├── scripts/
│   ├── capture-screens.js # Screenshot harness — every tab × theme × viewport
│   ├── measure-layout.js  # Layout measurement — horizontal chrome, prose measure
│   ├── measure-mobile.js  # Mobile measurement — sideways scroll, 44px touch targets
│   ├── check-contrast.js  # Contrast measurement — every fg/bg pair, all five themes
│   └── lint-tokens.js     # Token-contract linter (colour, type, spacing,
│                          # radius, elevation, motion, overshoot, !important)
├── public/
│   ├── index.html     # Single-page app shell
│   ├── login.html     # Password login page
│   ├── fonts/         # Inter, vendored — the app renders the same with no route out
│   ├── vendor/        # mana-font and jsPDF, vendored for the same reason
│   ├── css/           # Loaded in this order; later files may override earlier
│   │   ├── tokens.css     # The only file allowed raw colours: five theme palettes,
│   │   │                  # the type/spacing/radius scales, the motion vocabulary
│   │   │                  # (--dur-*, --ease-*), the three breakpoints, per-tab
│   │   │                  # accent colours. Enforced by scripts/lint-tokens.js
│   │   ├── base.css       # Element defaults and shared text utilities
│   │   ├── layout.css     # Page shell, header, navigation, sections, the wide width
│   │   ├── components.css # Controls and widgets shared across tabs
│   │   └── tabs.css       # Rules owned by a single tab
│   └── js/
│       ├── playmat.js     # Loaded in <head>: paints the background before first paint, and its picker
│       ├── motion.js      # Loaded in <head>: resolves the card-motion preference against the OS
│       ├── state.js       # App state, storage, shared helpers (renderMana, renderPrice, …)
│       ├── sortui.js      # The sort model — a chain of criteria, what each field is worth, what a
│       │                  # field seeds, what is stored — plus the shared controls: the sort button
│       │                  # and its popover, columns menu, view toggle, card-size control, "⋯" kebab menus
│       ├── cardlift.js    # Picking a card up: the hover lift, lean and sheen on every card image
│       ├── cardturn.js    # Turning a two-sided card over where it lies: the control, and the two halves of the turn
│       ├── cardstack.js   # Drawing a group of cards as a stack: thickness from count, angle from name
│       ├── cardmove.js    # Cards travelling to where a re-render put them: measured before and after
│       ├── carddrag.js    # Carrying a card, or a handful: the lag, the lean, the fan, the pile that would take it
│       ├── scryfall.js    # Card data access: local-first lookups w/ live fallback, rate-limited proxy fetch, caches
│       ├── card.js        # Card Detail tab (oracle text, rulings, prices, the printings of it
│       │                  # on the shelf, alt-art printings)
│       ├── cardquery.js   # Scryfall query syntax, parsed and run against the local card cache
│       ├── collections.js # Collection CRUD and results rendering
│       ├── players.js     # Players and decks
│       ├── deckdrag.js    # Dragging a deck tile onto a folder: what is in hand, and which zone would take it
│       ├── search.js      # Scryfall search tab
│       ├── sets.js        # Set browser tab
│       ├── wants.js       # Want lists tab (list/grid views)
│       ├── available.js   # Available@ calendar tab
│       ├── lands.js       # Mana base calculator tab
│       ├── auth.js        # Session auth, quick-add wants, change password
│       ├── admin.js       # Admin panel (user management, account requests)
│       ├── deckview-boards.js   # Deck Builder: what a card's place in a deck is — the boards, and the strings that name a card and a pile
│       ├── deckview-core.js    # Deck Builder: state, init, deck selection, board visibility, Archidekt import, auto-categorize
│       ├── deckview-render.js   # Deck Builder: rendering, tiles/rows, multiselect, stats, view toggle
│       ├── deckview-edit.js     # Deck Builder: card/category edits, move modal, autosave
│       ├── deckview-panels.js   # Deck Builder: search/autocomplete, drag/drop, EDHREC, import/export
│       ├── deckview-history.js  # Deck Builder: snapshots, the History drawer, restoring
│       ├── deckview-owned.js    # Deck Builder: what of the deck you own — the scopes, the four printing states, the missing list, the want-list send
│       ├── deckview-totals.js   # Deck Builder: one pass over the deck — what it costs, what finishing it costs, the curve, the types, the split
│       ├── deckview-legality.js # Deck Builder: whether the deck is legal, and the bracket it looks like — with the reasoning
│       ├── deckview-mana.js     # Deck Builder: the pips the deck's costs ask for against the sources its lands make, and the calculator filled from it
│       ├── deckview-landbase.js # Deck Builder: the drawer's Lands tab, everything in it that only *reads* the deck — the check (sources held against the source-count table's requirement, and the card that set it), the fix for a colour it calls short (the lands that make it, the copies somebody in the house has first), Magic's land cycles, collapsed, each fetched in the deck's colours when it is opened, and the one line out to the Mana Base Calculator. Opened from the readout's lands figure, which used to raise a mana panel of its own
│       ├── deckview-basics.js   # Deck Builder: the write half of the Lands tab, in its own file and served straight after it — the basics optimizer: a budget split by pips, with an "at least 1 basic of every colour" override kept in localStorage, previewed and then written as quantities on the deck's own rows. The land base module treats it as optional and asks before drawing it; it requires the land base module in return
│       ├── deckview-optimize.js # Deck Builder: picking a printing for every card at once — the three modes, the admissible pool, the preview and the bulk apply
│       ├── pick.js        # Pick Night tab (random deck assignment, restrictable by bracket)
│       ├── rss.js         # RSS feed panel (sidebar/header toggle, fetch, render)
│       └── main.js        # Init, theme, tabs, sidebar nav, mobile nav, tooltips, card-click routing, state polling
├── docs/
│   ├── design/          # What was planned — briefs and PRDs, kept as context
│   │   ├── ui.md                    # The "Cards on a Table" interactivity brief — the
│   │   │                            # design intent behind how cards behave; built
│   │   ├── spec-cards-as-objects.md # The PRD that work was specified from
│   │   ├── spec-sorting.md          # The PRD for multi-criteria sorting
│   │   └── spec-deckbuilder-depth.md # What the deck builder still couldn't do, surveyed
│   │                                 # against Moxfield, Archidekt and the rest
│   └── records/         # …and what was actually built, written after delivery
│       ├── ui-redesign.md           # The visual redesign that came first
│       ├── cards-as-objects.md
│       ├── sorting.md               # A sort becomes a sentence of up to three criteria
│       ├── piles-expanded.md        # A table of stacks arrives spread
│       ├── collection-query.md      # Scryfall syntax, run against the cards you own
│       └── deckbuilder-depth.md     # The deck builder answers questions about the deck
├── Dockerfile
├── docker-compose.yml
└── data/              # Created at runtime inside the container (Docker volume)
    ├── available.db   # All persistent app data: collections, players, decks,
    │                  # want lists, availability calendar, user accounts (SQLite)
    ├── scryfall.db    # Local Scryfall bulk-data cache (~38k cards, refreshed daily)
    │                  # plus the set index — what is in each set, for owned counts
    └── playmats/      # Uploaded playmat backgrounds, one file per user. Created
                       # on the first upload; empty until somebody makes one
```

## The set index

The Set Browser's tiles say how many of a set's cards you own before you open it, and nothing in the app could answer that. A collection is card names and quantities, and now the printings behind them — but even a fully re-imported shelf only tells you about the printings someone happens to own. The bulk cache is Scryfall's `oracle_cards` file: one entry per card *name*, so it knows which set a name came from but not which names a set contains.

So `set-index.js` keeps that the other way round: two tables in `scryfall.db`, one row per set and one per (set, card name). It is filled by a background sweep through Scryfall's search API — roughly 1,400 paged requests for the ~315 browsable sets, a few minutes at the shared queue's pace — and then it is effectively permanent, because a released set does not change. A set that does change, a spoiler-season set growing week by week, is re-indexed when Scryfall's `card_count` for it moves.

The sweep is sequential on purpose: one request in the shared queue at a time, so a search someone is waiting for never queues behind more than the job already in flight. Until it reaches a set, that set's tile shows how big it is instead of how much of it you own, and the toolbar's count says how far the sweep has got.

`GET /api/sets` answers the whole picker in one request — the set list, filtered and sorted, with each set's card count and owned count. "Owned" means what it has always meant on that tab: a card counts if any collection holds a card of that name, whichever printing. Both sides ask Scryfall the same `unique=cards` question, so a tile reading "176 / 286 owned" opens onto 286 cards with 176 ownership badges.

Deleting `scryfall.db` costs nothing but the refill.

## The state revision

An open tab polls `GET /api/state` every thirty seconds so that a collection imported on somebody else's laptop, a deck renamed on a phone or a card added to a want list turns up without a reload. Almost every one of those polls finds nothing. The first version of it downloaded the whole payload — every collection, every card on every shelf — and stringified it to compare against the last one, which is a full serialisation on the server and another in the tab, twice a minute, to learn nothing. On a phone it was the most expensive thing the page did while sitting still.

So the poll asks with a revision, and a server that has nothing newer answers `{ unchanged: true }` without building a payload at all. The revision is `stateRev()` in `routes/state.js`: two counters and the viewer.

The first counter is the `version` on the `app_state` row, which already existed for optimistic concurrency — it moves whenever the players blob is written, which covers every player, deck record, folder and want list. The second is a counter of its own, because half of what the route answers with is not in that blob: the shelf is the `collections` table, the built-deck counts are `deck_cards`, and an import in flight is `collection_imports`, any of which can change without the version moving. Nine triggers in `available-db.js` push that counter along on every insert, update and delete against those three tables — by trigger rather than by each route, because the writers are spread across `routes/state.js`, `routes/decks.js` and `collection-import.js`, and one that forgot would show as a tab that never caught up. It also means a second process against the same database is covered for free.

The viewer is the third part because the payload is not one payload: private decks are filtered per requester, so two sessions holding the same two counters are not owed the same answer.

An import is the one thing that moves the counter often — it checkpoints every page for four minutes — and it is in there deliberately: a tab that did not start it learns about it the same way it always did, from the `imports` list riding along in the payload. That does mean a full payload on each poll while an import runs, which is exactly what every poll cost before this change, and only while something really is arriving. A tab watching an import does not wait on it: that has its own two-second `/api/imports` poll.

`version` and `rev` are not interchangeable and neither can stand in for the other: `version` is the concurrency check's, handed back on a POST and answered with a 409 on a mismatch, and it stays the players blob's alone.

## Design records

Six pieces of work were large enough to be worth writing up afterwards, and each has a record in [records/](records/) that supersedes whatever it was planned from. They are written for whoever picks the code up next — what was built, what it cost, where the build departed from the plan, and what was found only by using it.

| document | what it covers |
|---|---|
| [records/ui-redesign.md](records/ui-redesign.md) | The visual redesign — the token contract, the layout rules, the measurement scripts, the playmat |
| [records/cards-as-objects.md](records/cards-as-objects.md) | Cards as objects — the motion preference and its contract, the card treatment, the lift, stacks and the pile views, the shared size control, animated re-renders, carrying a card and a handful, and the card menu |
| [records/sorting.md](records/sorting.md) | Sorting by more than one thing — a sort as a chain of up to three criteria, every field a real criterion, seeded sentences and who owns them, the control that says the sentence, and the table header as a shortcut into it |
| [records/piles-expanded.md](records/piles-expanded.md) | Piles land expanded — a table of stacks arrives spread, and settling one is the thing you do |
| [records/collection-query.md](records/collection-query.md) | Scryfall syntax in the Collections search — the query language parsed and run locally against the cards you own, one cache of card facts for the sort and the search both, and the filters that are refused by name because the local data can't answer them |
| [records/deckbuilder-depth.md](records/deckbuilder-depth.md) | The deck builder answers questions — boards and a commander board, deck history, ownership and price, legality and bracket, the mana base read off the deck, the frame that folds and the menu beside the mat |

What each was planned from is kept beside them in [design/](design/): [ui.md](design/ui.md), the interactivity brief the second of those was written against, [spec-cards-as-objects.md](design/spec-cards-as-objects.md), its PRD, [spec-sorting.md](design/spec-sorting.md), the PRD for the third, and [spec-deckbuilder-depth.md](design/spec-deckbuilder-depth.md), the survey the sixth was cut from. Where any of them disagrees with its record, the record is what happened.

Work large enough to need planning is cut into tickets first — one shippable, testable change each — under a `docs/tickets/<effort>/` directory that exists only while that effort is in flight. A ticket set is retired into a record once it lands, which is why there is no such directory here now.
