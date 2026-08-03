# 24 — Deck Builder mat uses the playmat

**What to build:** The two meanings of "playmat" become one. The Deck Builder's mat surface, until now a flat theme colour, becomes the user's chosen playmat image when they have set one — under the same veil, with pile and card surfaces staying opaque.

Someone who has set their favourite land's artwork as their playmat now builds their deck on it.

Falls back to the flat per-theme mat colour when no playmat is set.

**Blocked by:** 22, 17

**Status:** done

- [x] With a playmat set, the Deck Builder surface shows it
- [x] With no playmat set, the flat theme mat colour is used
- [x] Card and category surfaces remain legible over any artwork
- [x] Autosave, drag and drop, multi-select and statistics are unaffected

**How it landed**

**The mat does not fetch the art, veil it, or draw it — it stops covering it.**
The playmat and its veil have been two fixed full-viewport layers behind every
piece of content since issue 22, and the mat was the one surface painting over
them. So the change is that `.db-mat` goes transparent and the layers already
there show through the rectangle. Four lines of CSS, and the reason to prefer
them over giving the mat its own `background-image` is not brevity: a second
composite of the same art under the same veil is a second thing to keep in
step with the first, and `check-contrast.js` measures the veil — not a copy of
it. Text on the mat needed no new measurement because it is now on the surface
the checker was already holding `--text` and `--text-muted` to their floors
against.

**`--mat-fill` is set beside every rule that switches the layers, and nowhere
else.** `.db-mat` reads `var(--mat-fill, var(--mat))`, so unset — a page with
no playmat — is the flat per-theme token and no rule has to say so. What the
switch cannot do is drift from what it is switching: a transparent mat with
the layers off is not a table, it is a hole in one, and that is exactly what a
phone (mat off by default) and a reduced-data preference would have produced
had the condition been restated near the mat instead of written beside the
layers. Hence `layout.css` and not `tabs.css`, and hence the test below.

**The mat keeps its hairline and its radius**, so it is still a bounded table
rather than the whole page — but the border is the one pair the veil provably
cannot hold to its floor on the light themes, which issue 22 measured and
documented. Over art it is the art that separates the mat from the page, and
the hairline is a hint rather than an edge.

**One pair added to the contrast checker:** `--text-muted` on `--mat`. The mat
carries labels as well as body text — category counts, type lines, mana costs,
quantities — and only `--text` had ever been measured against that surface.
Now that the mat is the flat colour *or* the veiled playmat, the same tokens
have to clear both, and the veil's half was already there. It passes on all
five themes (4.82:1 sepia at the tightest, floor 4.5).

**One thing worth knowing that this ticket did not change.** `.dv-price` draws
in `--success` at `--text-xs`, and on the two light themes that green has
always been under the 4.5:1 UI floor on the mat — 4.45:1 light, 4.22:1 sepia —
which no pair measured, because `--mat` carried only body text. Over the
veiled playmat it moves to 4.07:1 and 4.04:1 against the darkest possible art.
It is not added to the checker as a failing pair, and it is not fixed here:
the fix is a darker green in two palettes, which is every green in the app on
those themes and a repaint decision rather than a Deck Builder one. Nothing
else on the mat is close — `--text`, `--text-muted` and `--primary-tx` (the
category titles) clear their floors on every theme against both extremes.

**Tests:** two in [playmat.test.js](test/playmat.test.js). The first walks the
three gate conditions in `layout.css` — the page, the phone default, a
reduced-data preference — and asserts for each that the mat's fill and the
layers' `display` agree *and* that the selector asking the question is
literally the same one; drop the reduced-data restore and it fails. The second
pins the fallback, and that `--mat-fill` is not set from `tabs.css`, where the
layers' conditions are not visible.

**Verified in a browser**, driving the real app in headless Firefox through the
screenshot harness's plumbing, against a throwaway copy of the snapshot
database — 40 checks, all passing:

- All five themes with no playmat: `#dbDeckContent`'s computed background
  equals that theme's own `--mat`, and neither layer is painted.
- A 99-card deck loaded, then *Wooded Foothills* set as the playmat through the
  Appearance popover's own card search: the two layers come on with the art
  from Scryfall's CDN, the mat's background goes from `rgb(23, 27, 32)` to
  `rgba(0, 0, 0, 0)`, and the deck is still on it. Same in pile and grid view,
  which is where the art shows between the cards rather than behind the text.
- All five themes with it on, each with the deck loaded — the mat is the
  playmat, under that theme's own veil.
- The builder still builds, with art behind the mat: multi-select selects,
  a quantity change reports `Saved ✓` and comes back after a reload, a
  synthetic drag moves a card between categories and that survives a reload
  too, and the statistics bar counts.
- A phone: the playmat is set but not painted and the mat has its flat colour
  back; switched on for that device, both come on together.
- Remove: the mat is the flat colour again.
- Nothing on the console at `error` or `warn` level, collected from BiDi's own
  log events rather than a page-side shim.

Screenshots in `.scratch/ui-redesign/shots/t24-mat/`. The standard 110-view set
was **not** recaptured: the harness runs in open mode with a fresh browser
profile, so no playmat is set in any of those views and every one of them takes
the fallback — which is the colour they already show.
