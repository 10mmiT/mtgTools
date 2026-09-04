// ── Deck Builder — Lands: the cycles, browsed ─────────────────────────────
// The drawer's third tab, beside Search and EDHREC. Search asks Magic a
// question you have to know how to phrase, and EDHREC asks what other people
// run. This asks the one question a deck's land slots actually pose — "what
// are my options in these colours?" — and answers it the way the game groups
// lands: by cycle. Shocks, fetches, triomes, painlands and the rest.
//
// What it draws is _dbDrawerTile(), whole. The + means what it means on every
// other tile in the drawer, goes wherever the drawer's "Add to" says, wears
// the ownership mark and says when the deck already holds the card. A land
// found here and a land found by searching for it are the same card in the
// same grid, because they are drawn by the same function.
//
// The check and the optimizer that the spec puts above this — how many sources
// of each colour the deck wants, and the button that re-splits its basics —
// are not here yet. They drop into the top of this tab when they arrive; this
// is the half that makes the tab worth opening in the meantime.
//
// See docs/design/spec-landbase.md.

/* ── The cycles ────────────────────────────────────────────────────────────
 *
 * `id` is the Scryfall predicate, spelled exactly: the query is `is:${id}`, so
 * the list holds one spelling of each name rather than two that can drift
 * apart.
 *
 * That spelling is the whole of the risk here, and it is a quiet one. An `is:`
 * value Scryfall does not recognise is *silently ignored* rather than refused
 * — `is:shocklnd t:land` does not error, it returns every land in Magic — so a
 * typo produces a section headed "Shocklands" holding twelve hundred cards.
 * Nothing at runtime can tell that apart from an unusually generous cycle, so
 * the guard is test/decklands.test.js, which pins the size of every cycle on
 * this list as a constant and says how to re-probe them by hand.
 *
 * Ordered by how often a deck reaches for them rather than alphabetically: the
 * answer to "what are my options" starts with the lands people are actually
 * choosing between. */
const DB_LAND_CYCLES = [
  { id: 'fetchland',    label: 'Fetchlands' },
  { id: 'shockland',    label: 'Shocklands' },
  { id: 'dual',         label: 'Original duals' },
  { id: 'triome',       label: 'Triomes' },
  { id: 'painland',     label: 'Painlands' },
  { id: 'checkland',    label: 'Checklands' },
  { id: 'fastland',     label: 'Fastlands' },
  { id: 'slowland',     label: 'Slowlands' },
  { id: 'scryland',     label: 'Scrylands' },
  { id: 'battleland',   label: 'Battlelands' },
  { id: 'pathway',      label: 'Pathways' },
  { id: 'surveilland',  label: 'Surveil lands' },
  { id: 'cycleland',    label: 'Cycling lands' },
  { id: 'triland',      label: 'Trilands' },
  { id: 'filterland',   label: 'Filter lands' },
  { id: 'bounceland',   label: 'Bounce lands' },
  { id: 'gainland',     label: 'Gain lands' },
  { id: 'canopyland',   label: 'Canopy lands' },
  { id: 'storageland',  label: 'Storage lands' },
  { id: 'creatureland', label: 'Creature lands' },
];

/* Which sections are open, what each one came back with, and what is still in
 * the air. The cache is keyed by cycle *and* colours, so a deck in different
 * colours asks again rather than being shown the last deck's answer, and the
 * same deck opening the same section twice is answered from here.
 *
 * It outlives the deck on purpose. "Shocklands in Bant" is a fact about Magic
 * rather than about a deck, so switching decks and coming back is free. What
 * does not outlive the deck is which sections were open: arriving at a new
 * deck with the last one's sections spread out is the tab having been used by
 * nobody. */
const _dbLandOpen   = new Set();   // cycle ids the reader has expanded
const _dbLandCache  = new Map();   // `${id}|${colours}` → {cards} | {error}
const _dbLandFlight = new Map();   // the same key, while its request is out
const _dbLandAsking = new Map();   // and the redraw waiting on the back of it

/** Some colours, spelled the one way every colour in this app is spelled. */
const _dbLandColours = have => [...'WUBRG'].filter(c => have.has(c)).join('');

/* The colours to filter on, as the letters `id<=` wants, or '' for no filter.
 *
 * The commander is the answer when there is one — the same identity the search
 * box's toggle and the legality tab use, so the drawer cannot disagree with
 * itself about what the deck may play. With no commander it is the union of
 * the colours the deck's own cards carry, which is a worse filter and not
 * nothing: "show me the shocklands I could run" is a fair question to ask of a
 * 60-card deck, which never has a commander at all. The deck's own cards are
 * the deck's, not the sideboard's or the maybeboard's — the same cards the
 * legality check judges a 60-card deck on.
 *
 * 'C' rather than '' for a deck with no colours in it: a colourless deck may
 * play colourless lands, and an empty filter would answer it with every land
 * in Magic. That holds on both sides of the question — a Kozilek deck and a
 * 60-card artifact pile have both been read, and what they say is
 * "colourless".
 *
 * The empty string is what is left when nothing can say, and a deck only half
 * read counts as nothing where it would change the answer. dbCommanderIdentity()
 * refuses a commander whose card has not arrived because half an identity is a
 * wrong answer rather than a smaller one, and the same refusal belongs here:
 * a deck whose Sol Ring has arrived and whose Lightning Bolt has not is not a
 * colourless deck, and calling it one answers every coloured section with
 * "nothing in this cycle is in these colours". A part-read deck that does show
 * a colour is still filtered on the colours it showed — narrower than the
 * truth, never wrong about what it did read — and the render asks again the
 * moment the rest of it lands. */
function dbLandIdentity() {
  const ci = dbCommanderIdentity();
  if (ci) return _dbLandColours(ci) || 'C';
  const seen = new Set();
  let read = 0, missing = false;
  for (const row of dbMainCards()) {
    const sf = dbCardData.get(row.card_name);
    if (!sf) { missing = true; continue; }
    read++;
    for (const c of _dbIdentityOf(sf)) seen.add(c);
  }
  return _dbLandColours(seen) || (read && !missing ? 'C' : '');
}

/* Whether the deck has a commander whose colours we could not read.
 *
 * dbCommanderIdentity() answers null to two different questions — there is no
 * commander, and there is one whose card has not arrived yet — because for its
 * own purpose those are the same answer: identity goes unchecked either way.
 * Here they are not the same, and only the caption can tell them apart: a deck
 * with a commander must not be told it has none. */
const _dbLandCommanderPending = () =>
  !dbCommanderIdentity() && (dbCommanderCards().length > 0 || !!dbDeck?.commander);

/** One cycle, in one deck's colours, as Scryfall reads it. */
function dbLandQuery(id, colours) {
  return `is:${id}${colours ? ` id<=${colours.toLowerCase()}` : ''}`;
}

const _dbLandKey = (id, colours) => `${id}|${colours}`;

/* One section's cards, fetched once.
 *
 * Everything that can happen to a request ends up in the cache as a settled
 * answer, including both kinds of nothing: Scryfall says 404 when a query
 * matches no cards, which for a mono-white deck asking about triomes is not a
 * failure but the correct answer, and it is read as one. */
async function _dbLoadLandCycle(id, colours) {
  const key = _dbLandKey(id, colours);
  if (_dbLandCache.has(key))  return _dbLandCache.get(key);
  if (_dbLandFlight.has(key)) return _dbLandFlight.get(key);

  const job = (async () => {
    let answer;
    try {
      const q   = dbLandQuery(id, colours);
      const res = await scryfallFetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=edhrec&unique=cards`);
      const data = await res.json();
      if (data.object === 'error') {
        answer = data.status === 404
          ? { cards: [] }
          : { error: data.details || 'Scryfall could not answer that' };
      } else {
        const cards = data.data || [];
        /* Into the tab's card cache on the way past, the way a search does:
           the + adds by name, and a name the tab has no card for is a second
           request for something we are already holding. */
        _dbCacheCards(cards);
        answer = { cards };
      }
    } catch (e) {
      answer = { error: e.message };
    }
    _dbLandCache.set(key, answer);
    _dbLandFlight.delete(key);
    return answer;
  })();

  _dbLandFlight.set(key, job);
  return job;
}

/* An open section that has no answer yet asks for one, and redraws when it
 * arrives. Called from the render rather than from the press, because opening
 * a section is not the only way to want a cycle you have not got: the colours
 * are part of the question, and adding a card to a colourless-so-far deck
 * changes them under a section that is already open. Asking here is what makes
 * that section re-ask rather than sit on "Loading…" for ever.
 *
 * At most one request per cycle-and-colours in the air, and the redraw is on
 * the back of it, so the chain settles: the second render finds the answer in
 * the cache and asks for nothing. */
function _dbAskForLandCycle(id, colours) {
  const key = _dbLandKey(id, colours);
  if (_dbLandAsking.has(key)) return _dbLandAsking.get(key);
  const asking = _dbLoadLandCycle(id, colours).then(() => {
    _dbLandAsking.delete(key);
    /* Unless it was shut again while the request was out, in which case the
       answer is in the cache for next time and drawing it would reopen a
       section the reader has closed. */
    if (_dbLandOpen.has(id)) _dbRenderLands();
  });
  _dbLandAsking.set(key, asking);
  return asking;
}

/* A section pressed. Opening one that has not been opened in these colours is
 * the only thing on this tab that costs a request; the render is what makes
 * it, and the request is handed back here so that pressing a section is
 * something a caller can wait for. */
function dbToggleLandCycle(id) {
  if (_dbLandOpen.has(id)) { _dbLandOpen.delete(id); _dbRenderLands(); return; }
  _dbLandOpen.add(id);
  /* A failure is not an answer, so it is not one this section is stuck with:
     it stays on screen while the section is open — closing it is how you say
     you have read it — and opening the section again asks Scryfall again. A
     lost connection for one second must not cost a cycle until the deck is
     switched. */
  const key = _dbLandKey(id, dbLandIdentity());
  if (_dbLandCache.get(key)?.error) _dbLandCache.delete(key);
  _dbRenderLands();
  return _dbLandAsking.get(key);
}

/** What the filter is doing, said out loud rather than left to be noticed. */
function _dbLandFilterNote(colours) {
  const shown = colours === 'C' ? 'colourless' : colours;
  if (_dbLandCommanderPending()) {
    return colours
      ? `The commander’s colours aren’t in yet — the deck’s own, for now: ${shown}`
      : 'The commander’s colours aren’t in yet — every cycle, unfiltered';
  }
  if (!colours) return 'No commander and no colours yet — every cycle, unfiltered';
  return dbCommanderIdentity()
    ? `In the commander’s colours — ${shown}`
    : `No commander, so in the deck’s own colours — ${shown}`;
}

/* The whole tab, drawn out of the sets and the cache above. Every section
 * every time rather than patching the one that changed: a tile says what the
 * deck already holds and where the + would put it, so a + pressed in one open
 * section is news to every other open section too. */
function _dbRenderLands() {
  const el = document.getElementById('dbLandsContent');
  if (!el) return;
  const colours = dbLandIdentity();
  const canAdd  = !!(dbDeck && isMyPlayer(dbDeck.playerId));

  const sections = DB_LAND_CYCLES.map(cycle => {
    const open = _dbLandOpen.has(cycle.id);
    const got  = open ? _dbLandCache.get(_dbLandKey(cycle.id, colours)) : null;
    if (open && !got) _dbAskForLandCycle(cycle.id, colours);
    /* The caret is typed rather than drawn the way pileToggleHtml() draws one,
       because that is a button of its own and the whole row is the control
       here — a name you have to miss to hit is a row that reads as pressable
       and mostly is not. A button cannot hold another button. */
    return `<div class="db-land-section">
      <button class="db-land-hdr" aria-expanded="${open}"
              onclick="dbToggleLandCycle('${jsAttr(cycle.id)}')">
        <span class="db-land-caret">${open ? '▾' : '▸'}</span>
        <span class="db-land-name">${esc(cycle.label)}</span>
        ${got?.cards ? `<span class="db-land-count">${got.cards.length}</span>` : ''}
      </button>
      ${open ? `<div class="db-land-body">${_dbLandBody(got, canAdd)}</div>` : ''}
    </div>`;
  }).join('');

  el.innerHTML =
    `<div class="help-text db-land-note">${esc(_dbLandFilterNote(colours))}</div>${sections}`;
}

/** One open section's insides: the wait, the failure, the nothing, or the grid. */
function _dbLandBody(got, canAdd) {
  if (!got) return '<div class="empty-state" style="padding:var(--space-3)">Loading…</div>';
  if (got.error) {
    return `<div class="error-msg" style="margin:var(--space-2) 0">${esc(got.error)}</div>`;
  }
  if (!got.cards.length) {
    return '<div class="empty-state" style="padding:var(--space-3)">Nothing in this cycle is in these colours</div>';
  }
  return `<div class="sf-grid db-find-grid">${got.cards.map(card =>
    _dbDrawerTile(card.name, {
      img: _dbSfImg(card), canAdd,
      /* The price and the want-list button, the same two things the Search
         half puts on a tile: a fetchland you can play tonight and a fetchland
         you would have to buy are not the same suggestion. */
      badges: `${renderPrice(card)}${wantBtnHtml(card.name)}`,
    })).join('')}</div>`;
}

/* A different deck is on the mat. What was fetched stays fetched — it is a
 * fact about Magic and not about the deck that asked for it — and the sections
 * close, because which cycles you had spread out is a fact about the deck you
 * were building. */
function _dbLandsClose() {
  _dbLandOpen.clear();
  if (dbLeftTab === 'lands') _dbRenderLands();
}
