# MTG Tools

> [!NOTE]
> This app was built almost entirely with AI (Claude), by someone who doesn't code, mostly for personal use by my own playgroup. It works well for us, but expect rough edges — use at your own risk, and feel free to open an issue if something breaks.

Search across multiple Magic: The Gathering collections at once, compare deck lists against what you own, browse sets, inspect full card details, track want lists, coordinate group availability, and randomly pick decks for game night — all from a single self-hosted web app.

## Features

A quick tour of the tabs — see [docs/features.md](docs/features.md) for the full, detailed rundown.

- **Available@** — shared group availability calendar; mark which days you're free and see the best upcoming nights.
- **Collections** — import from Archidekt/Moxfield and search everything you own in Scryfall syntax, with list/grid/pile views, multi-criteria sort, and a deck-comparison panel.
- **Players & Decks** — players with identity colours and decks shown as commander-art tiles; compare or build any deck.
- **Scryfall Search** — full Scryfall query syntax, with per-collection ownership, prices, and one-click add to a want list.
- **Card** — full card detail: image, oracle text, prices, legality, rulings, and every printing / alt-art.
- **Set Browser** — every set as a tile showing how many of its cards you own, then the set's cards inline.
- **Want Lists** — per-player want lists with autocomplete, CSV/PDF import & export, and combined views.
- **Deck Builder** — a full editing mat: categories, boards, drag-to-recategorise, history, ownership & price, legality, mana analysis, EDHREC recommendations, and chosen printings.
- **Mana Base Calculator** — recommended land split from your deck's pip counts.
- **Pick Night** — randomly assign one unique deck per player for game night.
- **RSS panel** — merged MTG news feeds, configured via `RSS_FEEDS`.

Across every tab: 5 themes, per-tab mana-colour accents, a card-as-object hover treatment with a reduced-motion switch, custom playmats, card-name hover previews, URL hash routing, and a mobile-friendly layout. See [docs/features.md](docs/features.md) for detail.

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### Run

```bash
docker compose up --build
```

Then open [http://localhost:3000](http://localhost:3000).

Data is stored in a Docker volume (`mtgtools-data`) and persists across restarts and rebuilds.

### Accounts, in brief

Set `ADMIN_PASSWORD` (via `.env`) to enable per-player accounts with **player** and **admin** roles; leave it unset to run in **open mode** — no login, everyone has full access. Full first-time setup, the role matrix, all environment variables, and where data lives are in [docs/configuration.md](docs/configuration.md).

### Stop

```bash
docker compose down
```

## Documentation

| Document | What's in it |
|---|---|
| [docs/features.md](docs/features.md) | The full, tab-by-tab feature rundown, plus how to add collections and decks |
| [docs/configuration.md](docs/configuration.md) | User accounts & roles, environment variables, the container reference, and data storage |
| [docs/architecture.md](docs/architecture.md) | Project structure, the set index, and the design-record index |
| [docs/testing.md](docs/testing.md) | The test suite, the token-contract linter, and the screenshot / measurement tooling |
| [docs/records/](docs/records/) | What was actually built for each large effort — supersedes the plans in [docs/design/](docs/design/) |

## Tech Stack & Credits

| Component | Credit |
|-----------|--------|
| **[Express](https://expressjs.com/)** | Server framework — MIT licence |
| **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** | SQLite for all persistent data — MIT licence |
| **[Scryfall API](https://scryfall.com/docs/api)** | Card data, images, search, autocomplete, prices, rulings, and printings (alt-art). Free to use; please follow their [rate limit guidelines](https://scryfall.com/docs/api#rate-limits). Per their guidance, card data is served from a daily [bulk-data](https://scryfall.com/docs/api/bulk-data) download cached in SQLite; the remaining live calls (search, card detail, sets) go through a single server-side proxy queue that stays under 10 req/s and honors `Retry-After`. Scryfall search is triggered manually (Enter / button) rather than on every keystroke. |
| **[mana-font](https://github.com/andrewgioia/mana)** | MTG mana symbol icons — MIT licence |
| **[Inter](https://rsms.me/inter/)** | The application typeface — SIL Open Font License 1.1. Vendored into `public/fonts/` rather than loaded from a font service: the app has to render the same, and render at all, on a server with no route out. See [public/fonts/README.md](public/fonts/README.md) |
| **[Archidekt](https://archidekt.com)** | Collection and deck data via their public REST API |
| **[Moxfield](https://moxfield.com)** | Collection data via CSV export |
| **[Docker](https://www.docker.com/)** | Containerisation |

Cardmarket prices are sourced from Scryfall's `prices.eur` field and reflect Cardmarket marketplace data at the time of the Scryfall API response.

Card images and search data are provided by Scryfall. Scryfall is not produced by or endorsed by Wizards of the Coast.

Magic: The Gathering is © Wizards of the Coast LLC.

## License

This project's code is released under the [MIT License](LICENSE). Card data, images, and Magic: The Gathering IP remain the property of their respective owners (see credits above).
