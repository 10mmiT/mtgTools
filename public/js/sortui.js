// ── Shared sorting + column-visibility helpers (used by every card view) ─────

// Available sort fields. Views pass the subset they support.
const SORT_FIELDS = [
  { key: 'name',      label: 'Name' },
  { key: 'cmc',       label: 'Mana Value' },
  { key: 'color',     label: 'Color' },
  { key: 'power',     label: 'Power' },
  { key: 'toughness', label: 'Toughness' },
  { key: 'rarity',    label: 'Rarity' },
  { key: 'type',      label: 'Type' },
  { key: 'price',     label: 'Price' },
  { key: 'qty',       label: 'Quantity' },
  { key: 'number',    label: 'Set Number' },
  { key: 'wanted',    label: 'Most Wanted' },
  { key: 'player',   label: 'Player' },
];
const SORT_LABELS = Object.fromEntries(SORT_FIELDS.map(f => [f.key, f.label]));

/* A view's own field list. Most views pass keys out of the list above, but not
 * every field the app can sort by is knowable here: Collections has one field
 * per loaded collection, whose label is that collection's name, so a view may
 * pass `{ key, label }` pairs of its own alongside the plain keys. Which is
 * what makes a field list something built at mount time rather than a
 * constant — the fields change when the collections do. */
function sortFieldsOf(fieldKeys) {
  return (fieldKeys || []).map(f =>
    typeof f === 'string' ? { key: f, label: SORT_LABELS[f] || f } : f);
}

// Color ordering: mono W<U<B<R<G, then multicolour grouped by colour-count and
// WUBRG combination (so WU, WB … cluster correctly), then colourless last.
const WUBRG_INDEX = { W: 0, U: 1, B: 2, R: 3, G: 4 };
function colorRank(arr) {
  if (!arr || !arr.length) return 9e9;        // colourless → last
  const idxs = arr.map(c => WUBRG_INDEX[c]).filter(v => v !== undefined).sort((a, b) => a - b);
  if (!idxs.length) return 9e9;
  // Base-6 combination key keeps WU before WB before UB, etc.
  let combo = 0;
  for (const i of idxs) combo = combo * 6 + (i + 1);
  // Primary key = colour count, so all mono sort before all 2-colour, etc.
  return idxs.length * 1e6 + combo;
}

const RARITY_RANK = { common: 1, uncommon: 2, rare: 3, mythic: 4, special: 5, bonus: 6 };
function rarityRank(r) { return RARITY_RANK[(r || '').toLowerCase()] ?? 0; }

// The dominant card type, in a sensible gameplay order. The index is its own
// function because two things ask for it: the sort key below, and the stack
// view's grouping, which needs the same answer said as a word.
const TYPE_ORDER = ['creature', 'planeswalker', 'battle', 'instant', 'sorcery',
                    'artifact', 'enchantment', 'land'];
function typeIndex(t) {
  const text = (t || '').toLowerCase();
  for (let i = 0; i < TYPE_ORDER.length; i++) if (text.includes(TYPE_ORDER[i])) return i;
  return TYPE_ORDER.length;
}

// Sort by the dominant card type, in a sensible gameplay order
function typeRank(t) {
  t = (t || '').toLowerCase();
  return `${typeIndex(t)}${t}`;
}

function numOr(v, dflt) { const n = parseFloat(v); return isNaN(n) ? dflt : n; }

/* Normalise either a full Scryfall card object or a name-keyed row into meta.
 *
 * This is the one shape the app keeps card facts in — `scryfallMetaCache` is
 * a map of name to exactly this — and it is read by two things now: the sort
 * and the grouping here, and the Collections search box, which runs Scryfall
 * query syntax against it (js/cardquery.js).
 *
 * That second reader is why there are fields below that nothing sorts by.
 * Oracle text, the printed mana cost, the set code and the layout are not
 * sortable and are not columns; they are what `o:`, `m:`, `s:` and `is:dfc`
 * ask about. Keeping them here rather than in a cache of their own is the
 * point: two caches of card facts filled from the same fetch would drift, and
 * a card the search knows about but the sort does not is a card that vanishes
 * when the piles are cut.
 *
 * A double-faced card's oracle text lives on its faces and not on the card,
 * so both faces are joined — `o:draw` on an MDFC should find the half that
 * draws. Its `type_line` already reads "A // B" and is left as printed, since
 * the metadata column shows it. */
function cardMetaOf(obj) {
  if (obj.type_line !== undefined || obj.cmc !== undefined) {
    const faces = obj.card_faces || [];
    const face  = faces[0];
    return {
      cmc:       obj.cmc,
      colors:    obj.colors || face?.colors || [],
      ci:        obj.color_identity || [],
      power:     obj.power ?? face?.power,
      toughness: obj.toughness ?? face?.toughness,
      type:      obj.type_line || face?.type_line || '',
      rarity:    obj.rarity || '',
      eur:       obj.prices?.eur ? parseFloat(obj.prices.eur) : null,
      usd:       obj.prices?.usd ? parseFloat(obj.prices.usd) : null,
      oracle:    [obj.oracle_text, ...faces.map(f => f.oracle_text)].filter(Boolean).join('\n'),
      mana:      obj.mana_cost || faces.map(f => f.mana_cost).filter(Boolean).join('') || '',
      set:       obj.set    || '',
      layout:    obj.layout || '',
    };
  }
  return scryfallMetaCache.get(obj.name) || {};
}

// ── What a card cannot answer on its own ────────────────────────────────────
// Some of what people sort by is not on the card. How many of it are owned is
// a fact about the collections; how badly it is wanted is a fact about the
// players. Those fields used to be sorted outside sortKey() — two bespoke
// comparators in wants.js, a `_sortQty` the caller had to stamp onto every row
// first, and two Collections table-header fields the sort control never saw —
// which meant they could only ever be the whole sort, never a word in one.
//
// They are criteria like any other now, and what they read is a **context**:
// a plain object the view hands to cardComparator, `{ wants, players,
// collections }` or whichever of those that view has. Threaded rather than
// registered, so sortKey stays a pure function of its three arguments.
//
// Every reader below tolerates its part of the context being absent, and
// answers the same value for every card when it is. A view that sorts by a
// field it supplied no context for then falls through to the name tiebreak: a
// stable order rather than a thrown error, because a wrong order is a wrong
// sort and an exception is a blank tab.

/* How many of a card are owned, across every loaded collection. A collection
 * is `{ key, cards: Map<name, { qty }> }`, the shape the Collections tab
 * already holds them in and the same numbers its Total column prints. */
function ownedQty(cols, name) {
  let total = 0;
  for (const col of cols || []) total += col.cards?.get(name)?.qty || 0;
  return total;
}

/* A criterion naming one collection's own count: `col:<id>`, where the id is
 * the `key` the rest of the app already identifies a collection by — the one
 * its chip is removed by and the one the server stores it under.
 *
 * It was `col_<i>`, a position in the list, until deleting the first
 * collection was noticed to turn a stored `col_2` into a different
 * collection's quantities: a sort that is not wrong so much as quietly about
 * something else. Named by id, reordering the collections is no change at all,
 * and renaming one changes the label the control prints and nothing more.
 *
 * The id is whatever `key` holds — `archidekt:12345`, `csv:1699…` — colons
 * included, so the prefix is stripped rather than the field split. */
const COL_QTY_PREFIX = 'col:';
function colQtyField(id) { return COL_QTY_PREFIX + id; }
function colQtyId(field) {
  return typeof field === 'string' && field.startsWith(COL_QTY_PREFIX)
    ? field.slice(COL_QTY_PREFIX.length) : null;
}

/* How many of a card are in one collection — or null when no collection of
 * that id is loaded, because a card owned none of and a card in a collection
 * that no longer exists are not the same fact, and only one of them is a
 * number to sort on. */
function ownedIn(cols, id, name) {
  const col = (cols || []).find(c => c.key === id);
  return col ? (col.cards?.get(name)?.qty || 0) : null;
}

/* Who wants a card, as one string that sorts. The players are taken in the
 * order the view lists them, so cards wanted by the same people sort together;
 * a card nobody wants is the empty string and sorts first, which is where the
 * Want List's own comparator put it. The separator is one no name contains, so
 * that "Ann" and "Anna, Bo" cannot collide. */
function wanterNames(ctx, name) {
  const wanters = ctx.wants?.get(name);
  if (!wanters || !ctx.players) return '';
  return ctx.players.filter(p => wanters.has(p.id))
    .map(p => (p.name || '').toLowerCase()).join('\0');
}

function sortKey(field, obj, ctx = {}) {
  const m = cardMetaOf(obj);
  switch (field) {
    case 'name':      return (obj.name || '').toLowerCase();
    case 'cmc':       return numOr(m.cmc, -1);
    case 'color':     return colorRank((m.ci && m.ci.length) ? m.ci : m.colors);
    case 'power':     return numOr(m.power, -1);
    case 'toughness': return numOr(m.toughness, -1);
    case 'rarity':    return rarityRank(m.rarity);
    case 'type':      return typeRank(m.type);
    case 'price':     return numOr(m.eur, -1);
    case 'number':    return numOr(obj.collector_number, 0);
    /* Quantity and Total are one field said twice: the select calls it
     * Quantity, the Collections table header calls it Total, and both mean how
     * many of this card are owned altogether. The header writes `qty` now;
     * `total` is here because it is what earlier versions of this app wrote
     * into the stored sort, and a preference someone chose still orders their
     * table the way they left it. */
    case 'qty':
    case 'total':     return ownedQty(ctx.collections, obj.name);
    case 'wanted':    return ctx.wants?.get(obj.name)?.size ?? 0;
    case 'player':    return wanterNames(ctx, obj.name);
    default: {
      const id = colQtyId(field);
      if (id !== null) {
        const qty = ownedIn(ctx.collections, id, obj.name);
        if (qty !== null) return qty;
      }
      /* A field nothing here knows, and a collection that is no longer
       * loaded, are the same answer: the name, which is the order this app
       * falls back to everywhere. A criterion the chain kept would then be
       * one that changes nothing rather than one that throws — though the
       * chain drops it before it gets here; see liveCriteria. */
      return (obj.name || '').toLowerCase();
    }
  }
}

/* How many criteria a sort can be. Three, because the fourth has never changed
 * an order anyone noticed — and it is the cap the control offers, so a longer
 * list is a stored preference from elsewhere or a caller's mistake. */
const SORT_CRITERIA_MAX = 3;

/* The criteria a context can still honour. A criterion naming a collection
 * that is not loaded — deleted from another tab, or gone since the sort was
 * stored — is **dropped silently**: it cannot be answered, and a message about
 * it is a modal nobody wants. The words either side of it still say what they
 * said, so a three-word sort becomes a two-word one rather than a broken one,
 * and a chain left with nothing in it is name ascending, the same as a sort
 * with nothing in it.
 *
 * Every other field stays whatever it is. A view is handed sorts stored by
 * other views and by older versions of this app, and a field this one has
 * never heard of already degrades to the name in sortKey — dropping those too
 * would be the same order by a longer road. */
function liveCriteria(criteria, ctx = {}) {
  return (criteria || []).filter(c => {
    const id = colQtyId(c?.field);
    return id === null || (ctx.collections || []).some(col => col.key === id);
  });
}

/* A sort is an ordered list of `{ field, dir }` criteria — colour, then mana
 * value, then name — compared in turn, the first one that separates two cards
 * deciding it. `dir` is 1 ascending / -1 descending and belongs to its own
 * criterion, so "price descending, then name ascending" is one sort rather
 * than two irreconcilable arrows.
 *
 * The final name tiebreak is not a criterion and is not shown anywhere: it is
 * what makes the order total, so two cards alike in everything chosen cannot
 * swap places between renders. It is ascending whatever any criterion says,
 * because it is about render stability rather than about what you asked for.
 *
 * A list longer than three is truncated rather than rejected: the first three
 * words of the sentence are still the sort you asked for, and a view that
 * throws is a blank tab. An empty list is the name tiebreak on its own, which
 * is name ascending — the order this app falls back to everywhere.
 *
 * `ctx` is the calling view's context — see above — and is handed to every
 * criterion in the chain rather than to the one that asked for it, because
 * which criterion needs it is sortKey's business and not the caller's.
 */
function cardComparator(criteria, ctx = {}) {
  const chain = liveCriteria(criteria, ctx).slice(0, SORT_CRITERIA_MAX)
    .map(c => ({ field: c.field, dir: c.dir === -1 ? -1 : 1 }));
  return (a, b) => {
    for (const { field, dir } of chain) {
      const av = sortKey(field, a, ctx), bv = sortKey(field, b, ctx);
      if (av < bv) return -dir;
      if (av > bv) return  dir;
    }
    const an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  };
}

// ── The sentence a field usually belongs to ─────────────────────────────────
// Choosing a field does not give you one criterion, it gives you the sentence
// that field usually belongs to: pick Color and you are sorted colour → mana
// value → name without touching anything else. A list somebody has to assemble
// by hand is a list nobody assembles, so the chain is seeded rather than
// empty, and the feature pays off on the first click rather than on the fifth.
//
// Mana value is the near-universal second word because it is the one field
// that puts a shape inside any block. Name and Set Number seed alone: they are
// already unique, so a tail would never fire.

/* What each field brings with it, after itself and ascending. A field that is
 * not in here seeds alone, which is the safe answer for one this table has
 * never heard of. */
const SEED_TAILS = {
  name:      [],
  number:    [],
  color:     ['cmc', 'name'],
  cmc:       ['color', 'name'],
  type:      ['cmc', 'name'],
  rarity:    ['color', 'name'],
  price:     ['name'],
  power:     ['cmc', 'name'],
  toughness: ['cmc', 'name'],
  qty:       ['name'],
  total:     ['name'],
  wanted:    ['cmc', 'name'],
  player:    ['name'],
};

/* Anything countable seeds descending: nobody asks for their cheapest cards,
 * their least wanted, or the one copy before the four. A collection's own
 * count is a count under a name only that collection knows, so it is asked
 * rather than listed. */
const SEED_DESCENDING = new Set(['price', 'power', 'toughness', 'qty', 'total', 'wanted']);

function seedDir(field)  { return (SEED_DESCENDING.has(field) || colQtyId(field) !== null) ? -1 : 1; }
function seedTail(field) { return colQtyId(field) !== null ? ['name'] : (SEED_TAILS[field] || []); }

/* A chain, tidied: no more words than a sort can hold, every direction one of
 * the two, no field the view cannot sort on, and no field said twice.
 *
 * `fields` is the calling view's field list — the same one mountSortControl is
 * handed, keys or `{ key, label }` pairs — and a chain is filtered against it
 * only where a view has said what it supports. A seeded chain naming a field
 * the view has not got loses that word: the Set Browser has no Quantity, and a
 * chain must never hold a criterion its view cannot sort on.
 *
 * A repeat of a field earlier in the chain goes the same way, because the
 * second occurrence can never fire — everything it could separate, the first
 * already did. It happens when the first criterion of an edited chain is
 * swapped for a field that is already in the tail: "Mana → Mana → Name" reads
 * like a bug and sorts like two words. */
function tidyChain(criteria, fields) {
  const supported = fields ? new Set(sortFieldsOf(fields).map(f => f.key)) : null;
  const seen = new Set();
  const chain = [];
  for (const c of criteria || []) {
    const field = c?.field;
    if (typeof field !== 'string' || !field || seen.has(field)) continue;
    if (supported && !supported.has(field)) continue;
    seen.add(field);
    chain.push({ field, dir: c.dir === -1 ? -1 : 1 });
  }
  return chain.slice(0, SORT_CRITERIA_MAX);
}

/* The whole sentence a field seeds — the field itself, pointed the way that
 * field is usually read, and the tail it usually carries. */
function seedChain(field, fields) {
  return tidyChain([{ field, dir: seedDir(field) },
                    ...seedTail(field).map(f => ({ field: f, dir: 1 }))], fields);
}

// ── Whose chain it is ───────────────────────────────────────────────────────
// A sort is its criteria and one bit: whether the tail is still the app's
// suggestion or has become somebody's own. Choosing a new first criterion
// re-seeds the whole chain — unless the tail has been edited, in which case
// only the first word is swapped and the rest is left exactly as it is.
//
// A chain that is still all-default is a suggestion, and a better suggestion
// should replace it; a chain someone edited is theirs. Always re-seeding is
// the rule that teaches people to stop editing the tail, because it does not
// survive touching the field they are most likely to touch.
//
// The bit is stored rather than worked out by comparing the tail against what
// the field would seed today, because the table above is the app's opinion and
// will be edited again: a chain somebody made theirs must not fall back into
// the app's hands because a later version changed its mind about what Rarity
// suggests.

/* What the first criterion is is the app's business until somebody edits the
 * tail. The first word's own direction is not an edit — the arrow on the field
 * you chose is the control this app has always had — so flipping it leaves the
 * chain the app's to re-seed. */
const _tailOf = criteria => JSON.stringify((criteria || []).slice(1));

/* Choosing a field: the whole chain, or one word of it. A swapped first
 * criterion takes its own seeded direction with it, so choosing Price gets you
 * the expensive cards first whichever chain it lands in front of. */
function chooseSortField(sort, field, fields) {
  if (!sort?.edited) return { criteria: seedChain(field, fields), edited: false };
  const tail = tidyChain(sort.criteria, fields).slice(1);
  return { criteria: tidyChain([{ field, dir: seedDir(field) }, ...tail], fields), edited: true };
}

/* Any other change to the chain — a tail criterion's field or direction, one
 * added, one removed. It is the tail that decides ownership: a chain whose
 * tail came out different from the one that went in is a chain somebody has
 * made theirs, and stays theirs. */
function editSortChain(sort, criteria, fields) {
  const before = tidyChain(sort?.criteria, fields);
  const after  = tidyChain(criteria, fields);
  return { criteria: after, edited: !!sort?.edited || _tailOf(after) !== _tailOf(before) };
}

/* Back to the chain the first criterion seeds, and the app's again — the way
 * out of an edited tail that does not ask anyone to know there is a bit to
 * clear. The first word keeps the direction it was left pointing, because that
 * arrow was never part of what made the chain yours. */
function reseedSortChain(sort, fields) {
  const head = tidyChain(sort?.criteria, fields)[0];
  if (!head) return { criteria: [], edited: false };
  const criteria = seedChain(head.field, fields);
  if (criteria.length) criteria[0].dir = head.dir;
  return { criteria, edited: false };
}

// ── A column header is a shortcut into the same model ───────────────────────
// The Collections table header used to be a second sorting system: it wrote
// `{ field, dir }` straight into the stored entry, including two fields the
// select had never heard of, and `syncColSortControl()` existed to stop the
// control from contradicting it. It is two gestures into the chain now —
// a click and a shift-click — and both of them are the operations the popover
// already offers, said faster.
//
// Which is why they are here rather than in collections.js: a header click has
// to mean exactly what choosing that field in the control's first row means,
// and the way to guarantee that is for it to be the same function.

/* A plain click: the column becomes the sort.
 *
 * On the column that is already leading, it flips that column's direction —
 * the gesture this header has always had, and the one thing a click on the
 * first column cannot be, since re-seeding a chain onto its own head would
 * throw away the arrow you were toggling.
 *
 * Everywhere else it is `chooseSortField`, so it seeds the whole sentence on a
 * chain that is still the app's suggestion and swaps one word of a chain that
 * has become somebody's own. The alternative — always seeding — would mean a
 * chain built by hand in the popover could be wiped by a click on a column
 * heading, and the `edited` bit exists precisely so that it cannot be. */
function chooseSortColumn(sort, field, fields) {
  const criteria = tidyChain(sort?.criteria, fields);
  if (criteria[0]?.field !== field) return chooseSortField(sort, field, fields);
  criteria[0] = { field, dir: criteria[0].dir === -1 ? 1 : -1 };
  return editSortChain(sort, criteria, fields);
}

/* A shift-click: "…and then this one." The column is appended as the next
 * criterion, pointed the way that field is usually read — the same direction
 * choosing it anywhere else would give it.
 *
 * Two cases are not an append, and both are stated because neither is visible
 * in the gesture:
 *
 *   **A column already in the chain is flipped where it stands**, rather than
 *   duplicated or moved to the end. A chain cannot say the same field twice —
 *   `tidyChain` drops the second occurrence — and moving it would silently
 *   reorder a sentence somebody wrote. So shift-clicking a word of the sort
 *   means "that word, the other way", wherever in the sort it is.
 *
 *   **At three criteria it replaces the last word** rather than doing nothing.
 *   The popover's Add button greys out at three and can say why in a tooltip;
 *   a shift-click has nowhere to put that sentence, and a gesture that
 *   silently does nothing is a gesture people conclude is broken. The word it
 *   spends is the last one, which is the one separating the fewest cards, and
 *   the control directly above prints the whole chain on the same render — so
 *   what was traded for what is legible immediately.
 *
 * Either way the chain comes back edited: a sentence somebody assembled a word
 * at a time is theirs, and re-seeding it out from under them on their next
 * click on a heading is the behaviour the `edited` bit exists to prevent. */
function appendSortColumn(sort, field, fields) {
  const criteria = tidyChain(sort?.criteria, fields);
  const at = criteria.findIndex(c => c.field === field);
  if (at !== -1) criteria[at] = { field, dir: criteria[at].dir === -1 ? 1 : -1 };
  else if (criteria.length < SORT_CRITERIA_MAX) criteria.push({ field, dir: seedDir(field) });
  else criteria[SORT_CRITERIA_MAX - 1] = { field, dir: seedDir(field) };
  return editSortChain(sort, criteria, fields);
}

/* Where a field sits in the chain, as the header draws it: 0 for the criterion
 * that cuts the piles and sets the arrow, 1 and 2 for the words that only
 * order the cards inside them, -1 for a column the sort does not mention.
 *
 * A criterion the view cannot honour is not in the chain the comparator ran —
 * see liveCriteria — but a marked-up column is about what the sort *says*, and
 * the control's own label says all three words whether or not the context can
 * answer them. So this reads the chain as stored, the same as chainLabel. */
function sortColumnAt(criteria, field) {
  return (criteria || []).findIndex(c => c.field === field);
}

// ── Grouping, for the tabs that draw their cards as stacks ──────────────────
// A stack view is a sorted list with the cards that belong together put in one
// pile, and what belongs together is the question the sort control is already
// answering: sort by rarity and a collection is four piles, sort by mana value
// and it is the curve standing up off the table, sort by name and it buckets
// on the initial letter. So there is no grouping control and no stored
// grouping preference — changing the sort restacks the view.
//
// A sort is a sentence now, and the rule reads off it: **the first criterion
// cuts the piles, and the rest order the cards inside each one.** Rarity piles
// each standing in curve order, which is an arrangement this app could not
// draw while a sort was one field. Nothing here needs new vocabulary for it —
// groupLabel is handed the first criterion's field, and the list it cuts was
// ordered by the whole chain — so what a later criterion changes is the order
// within a pile, and only the first one restacks the table.
//
// Piles are not nested one level per criterion: that is a second dimension the
// mat cannot draw at any card size.
//
// This lives beside sortKey() because it is the same vocabulary said a
// different way: sortKey turns a field into an order, groupLabel turns it into
// a name a pile can be labelled with. Every label is a function of the same
// metadata the sort key reads, so a pile is always contiguous in the sorted
// list it was cut from.
//
// The labels are short on purpose. A row of stacks is read at a glance and the
// sort control directly above already says which field they are stacked by, so
// a pile is "3" rather than "Mana Value 3".

/* Where the curve stops. Everything from here up is one pile, the way the
 * Deck Builder's own mana curve already buckets it: the difference between
 * seven and eight mana is not a shape anyone reads, and drawing a stack of one
 * for each is a row of stacks that says less than the curve does. */
const GROUP_CMC_TOP = 7;

const GROUP_COLOR_LABELS = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
const GROUP_TYPE_LABELS  = ['Creatures', 'Planeswalkers', 'Battles', 'Instants',
                            'Sorceries', 'Artifacts', 'Enchantments', 'Lands', 'Other'];

/* Nothing to bucket on: a card whose price, power or mana value the app has
 * not been told. One pile rather than one pile each, and it says so. */
const GROUP_NONE = '—';

/* The pile a card belongs in, from the field the view is sorted by — and, for
 * the fields that read one, the same context the sort key read, so that a pile
 * is labelled with the number it was cut on. */
function groupLabel(field, obj, ctx = {}) {
  const m = cardMetaOf(obj);
  switch (field) {
    case 'cmc': {
      const n = Math.trunc(numOr(m.cmc, -1));
      if (n < 0) return GROUP_NONE;
      return n >= GROUP_CMC_TOP ? `${GROUP_CMC_TOP}+` : String(n);
    }
    case 'color': {
      const cs = (m.ci && m.ci.length ? m.ci : m.colors) || [];
      if (!cs.length)     return 'Colorless';
      if (cs.length > 1)  return 'Multicolor';
      return GROUP_COLOR_LABELS[cs[0]] || 'Colorless';
    }
    case 'power':
    case 'toughness': {
      /* A power written as ✳ or 1+✳ is not a number and cannot be a pile of
       * its own without inventing an order for it; it lies with the cards that
       * have no power at all, which is where the sort key already puts it. */
      const n = numOr(field === 'power' ? m.power : m.toughness, null);
      return n === null ? GROUP_NONE : String(n);
    }
    case 'rarity': {
      const r = (m.rarity || '').toLowerCase();
      return r ? r[0].toUpperCase() + r.slice(1) : GROUP_NONE;
    }
    case 'type':  return GROUP_TYPE_LABELS[typeIndex(m.type)];
    case 'price': {
      /* Buckets, not values: grouping on the number itself would draw a
       * thousand stacks of one card. These are the bands people actually sort
       * their binders into. */
      const eur = numOr(m.eur, -1);
      if (eur < 0)  return GROUP_NONE;
      if (eur < 1)  return '< €1';
      if (eur < 5)  return '€1–5';
      if (eur < 20) return '€5–20';
      return '€20+';
    }
    case 'qty':
    case 'total': return `×${ownedQty(ctx.collections, obj.name)}`;
    case 'number': {
      /* Same reason as price: a collector number is unique, so the set's own
       * numbering is only a grouping in hundreds. */
      const n = numOr(obj.collector_number, -1);
      if (n < 0) return GROUP_NONE;
      const lo = Math.floor(n / 100) * 100;
      return `#${lo || 1}–${lo + 99}`;
    }
    /* Name, and any field with no bucketing of its own: the initial. It is the
     * one grouping every card can answer, and it is what a shelf of binders
     * does. A collection's own count is a count, so it piles as one — the
     * stack view used to be handed `qty` in its place, because a field the
     * sort key did not know would have fallen through to the initial letter
     * here and drawn the alphabet instead of the quantities. */
    default: {
      const id = colQtyId(field);
      if (id !== null) {
        const qty = ownedIn(ctx.collections, id, obj.name);
        if (qty !== null) return `×${qty}`;
      }
      const first = (obj.name || '').trim()[0] || '';
      return /\p{L}/u.test(first) ? first.toUpperCase() : '#';
    }
  }
}

/* Cut an already-sorted list of cards into piles, in the order the piles first
 * appear — which for every field above is the sorted order, ascending or
 * descending, so the first criterion's direction turns the row of stacks
 * around without being consulted.
 *
 * `field` is the first criterion's, and `cards` is in the whole chain's order:
 * the pile a card is in is decided by one word of the sentence, where in its
 * pile it lies by the rest of them.
 *
 * Cards carrying the same label are collected into one pile even if they are
 * not adjacent, so a field whose label is not strictly monotonic in its sort
 * key draws one stack per label rather than the same label several times. */
function cardGroups(field, cards, ctx = {}) {
  const groups = new Map();
  for (const card of cards) {
    const label = groupLabel(field, card, ctx);
    const group = groups.get(label);
    if (group) group.cards.push(card);
    else groups.set(label, { label, cards: [card] });
  }
  return [...groups.values()];
}

// ── Per-view persisted preferences ──────────────────────────────────────────

/* What is in one of this app's preference entries, as an object.
 *
 * Every one of them is a `{ key: value }` map under one localStorage key, and
 * localStorage is a string store shared with older versions of this app, with
 * every other tab this app is open in, and with whatever anyone types into a
 * console. A entry holding `undefined`, a truncated write, or a list where an
 * object belongs is not a preference — but `JSON.parse` throwing on one takes
 * this whole file down with it, and the file the tabs get their sort control,
 * their columns and their card size from is not a file that can fail to load.
 *
 * So: an object, or nothing. The same answer a missing entry gives, which is
 * every view at its own default. */
function readPrefs(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

const _sortState = readPrefs('mtgtools_sort');

/* Fields that have been renamed since somebody's preference was stored. Total
 * and Quantity are one field said twice — how many of this card are owned
 * altogether — and `qty` is the name the control can display and the header now
 * writes. A stored `total` is renamed on the way in rather than dropped for
 * naming a word this app retired, because it is a sort somebody chose and it
 * still means exactly what it meant. `sortKey` answers both either way; this is
 * about the entry being readable, not about it being sortable. */
const STORED_FIELD_ALIASES = { total: 'qty' };

/* The criteria in a stored entry, or null where there is no sort in it.
 *
 * Two shapes are a sort. A chain is read as it is. A `{ field, dir }` — what
 * every version before chains wrote — is read as a **list of exactly one**, and
 * left at that. Anything else at all is null: a string, a number, a list, an
 * object with no field on it, whatever half a write left behind. */
function storedCriteria(stored) {
  const list = Array.isArray(stored?.criteria) ? stored.criteria
             : typeof stored?.field === 'string' ? [stored] : null;
  return list?.map(c => {
    const alias = c && STORED_FIELD_ALIASES[c.field];
    return alias ? { ...c, field: alias } : c;
  }) ?? null;
}

/* A view's sort, as `{ criteria, edited }`, whatever shape the entry is in.
 *
 * A stored one-criterion sort is **not seeded from**: upgrading must not
 * silently reorder the collection somebody left sorted by Rarity, so they get
 * exactly what they had and the chain seeds the next time they choose a field.
 * Nor is the entry rewritten in the new shape on the way past — reading a
 * preference is not a reason to change it, so somebody who never touches
 * sorting keeps the entry they have.
 *
 * `fields` is the calling view's field list, and what is stored is read against
 * it: a criterion naming a field this view has never offered is dropped, and an
 * entry left with nothing in it falls to the default below rather than sorting
 * the tab on a column that is not on it. Views that have not said what they
 * support are filtered against nothing, the same as everywhere else this list
 * is optional.
 *
 * A view's default is the one place a chain is seeded without being asked for,
 * because a default is the app's suggestion rather than anybody's preference —
 * which is how a first visit to the Want List is most-wanted then mana value
 * rather than one enormous block per number of people who want a card. The
 * default's own direction wins over the seed's, since a view asking for
 * descending has said which way it wants reading. */
function getSortChain(view, def, fields) {
  const stored = _sortState[view];
  const from   = storedCriteria(stored);
  if (from) {
    const criteria = tidyChain(from, fields);
    if (criteria.length) return { criteria, edited: !!stored.edited };
  }
  const d = (def && typeof def.field === 'string') ? def : { field: 'name', dir: 1 };
  const criteria = seedChain(d.field, fields);
  if (criteria.length) criteria[0].dir = d.dir === -1 ? -1 : 1;
  /* A default the view cannot sort on either is the caller's mistake rather
   * than anybody's preference, and the name is what this app falls back to
   * everywhere — including in the comparator, which reads an empty chain as
   * name ascending, so the two agree whatever the field list holds. */
  return { criteria: criteria.length ? criteria : seedChain('name', fields), edited: false };
}

function saveSortChain(view, sort) {
  _sortState[view] = { criteria: tidyChain(sort?.criteria), edited: !!sort?.edited };
  localStorage.setItem('mtgtools_sort', JSON.stringify(_sortState));
}

/* The first criterion, as the one field and one arrow the app used to have —
 * the head of the chain, with an empty one answering the name ascending the
 * comparator would have read it as.
 *
 * Its writing half, `saveSort(view, field, dir)`, is gone: the Collections
 * table header was the last caller, and a second way to write this entry is
 * the thing that made the header and the control able to disagree. What is
 * left is a read, kept because it is how the migration's tests ask a stored
 * entry what it came out as. */
function getSort(view, def, fields) {
  const [first] = getSortChain(view, def, fields).criteria;
  return first ? { field: first.field, dir: first.dir } : { field: 'name', dir: 1 };
}

/* What a stored sort naming a collection means now the collections are known.
 *
 * Two things are settled here, both against the list as it actually is:
 *
 *   - a `col_<i>` written by an older version of this app is the collection at
 *     that index, and becomes its id. Once. The index is only ever read here,
 *     and only against the list the app has just been handed.
 *   - a criterion naming a collection that is not in the list is dropped, and
 *     the view falls back to its default — name ascending — rather than
 *     sorting on a column nobody can see. An index that is past the end of the
 *     list goes the same way, because there is nothing it could be migrated to.
 *
 * Which means the **caller must know the list is real**: called with an empty
 * list because the collections have not arrived yet, this would throw away a
 * preference that was never wrong. It is called from hydrateState, the moment
 * the list becomes known, and from the Collections tab when one is added or
 * removed under it. */
const LEGACY_COL_FIELD = /^col_(\d+)$/;

/* One criterion, against the list as it now is: itself, or nothing where the
 * collection it names has gone and there is nothing to migrate it to. */
function reconcileCriterion(cols, criterion) {
  const field  = typeof criterion?.field === 'string' ? criterion.field : '';
  const legacy = LEGACY_COL_FIELD.exec(field);
  if (legacy) {
    const col = cols[+legacy[1]];
    return col ? { ...criterion, field: colQtyField(col.key) } : null;
  }
  const id = colQtyId(field);
  return (id === null || cols.some(c => c.key === id)) ? criterion : null;
}

function reconcileColSorts(collections) {
  const cols = collections || [];
  let changed = false;
  for (const [view, sort] of Object.entries(_sortState)) {
    /* A chain is every criterion asked the same question, and an entry left
     * with no criteria at all is an entry naming nothing — dropped, so the
     * view falls back to its default rather than to a column nobody can see. */
    if (Array.isArray(sort?.criteria)) {
      const next = sort.criteria.map(c => reconcileCriterion(cols, c)).filter(Boolean);
      if (next.length === sort.criteria.length &&
          next.every((c, i) => c === sort.criteria[i])) continue;
      changed = true;
      if (next.length) sort.criteria = next;
      else delete _sortState[view];
      continue;
    }
    /* The one-criterion shape every version before chains wrote. It is asked
     * the same question and written back in the shape it arrived in — reading
     * an entry is not a reason to rewrite it. */
    const next = reconcileCriterion(cols, sort);
    if (next === sort) continue;
    changed = true;
    if (next) sort.field = next.field;
    else      delete _sortState[view];
  }
  if (changed) localStorage.setItem('mtgtools_sort', JSON.stringify(_sortState));
}

// ── The control says the sentence ───────────────────────────────────────────
// The select and the arrow are one button whose label is the sort —
// `Sort: Color → Mana Value → Name` — opening a popover of up to three rows,
// each a field, a direction and a remove.
//
// The label is the point. A criterion you cannot see is a criterion silently
// reordering your cards, which is why keeping the select and hiding the second
// and third words behind a "⋯" was not the answer. Inline chips on the strip
// were rejected too: the strip is measured on how little of it there is, they
// wrap badly on a phone, and drag-to-reorder is a gesture this app already
// spends on carrying cards.
//
// The popover is the `.col-menu` the Columns menu already opens — its markup,
// its styling and its outside-click handling — rather than a second kind of
// menu that would drift from it.

/* The sentence the button says. A descending word carries its arrow and an
 * ascending one does not: ascending is how a sort is read unless it says
 * otherwise, so three arrows would be three characters spent saying "as
 * usual" in a label that has to fit on a strip. It is the notation the spec's
 * own table of default chains is written in.
 *
 * A field the view's list does not name is printed as its key rather than
 * dropped — the chain is what the comparator will actually do, and a word
 * missing from the label is the thing this control exists to prevent. */
function chainLabel(criteria, fields) {
  const labels = Object.fromEntries(sortFieldsOf(fields).map(f => [f.key, f.label]));
  const words = (criteria || []).map(c =>
    (labels[c.field] || SORT_LABELS[c.field] || c.field) + (c.dir === -1 ? ' ↓' : ''));
  /* An empty chain is name ascending in the comparator, so it says so here.
     It is not reachable through this control — see the remove button — but a
     stored entry can be anything. */
  return words.join(' → ') || 'Name';
}

// Build + wire a Sort control into `containerId`. `apply` re-renders the view.
// `fieldKeys` is the view's field list — keys, or `{ key, label }` pairs for
// the fields only the view can name; see sortFieldsOf. A view whose list
// changes while it is on screen re-mounts this.
//
// Returns `{ sync, set }`. `sync()` redraws the control from the stored chain,
// for a caller whose field list changed under it; `set(next)` stores a chain,
// redraws and re-renders, which is how the Collections table header commits.
// The header used to write the stored entry itself and leave the control to be
// re-synced afterwards — the whole of why `syncColSortControl()` existed — and
// going through `set` is what makes it a shortcut into this control rather
// than a second writer that can disagree with it.
//
// Two decisions the popover had to take, both stated here because neither is
// visible in the markup:
//
//   **Reordering is a ↑ on every row but the first, not a drag.** Dragging is
//   what this app carries cards with, and a row holding five controls is a row
//   that fits nowhere on a phone. Swapping a row with the one above it reaches
//   every order of three, so one button per row is the whole of it.
//
//   **The last criterion cannot be removed.** A sort with nothing in it is
//   name ascending in the comparator — but an entry with no criteria in it
//   falls back to the *view's default* the next time it is read, so removing
//   the last word would not survive the render that removing it triggers. The
//   ✕ is unavailable there instead, and changing that row's field is what
//   taking it away means.
function mountSortControl(containerId, view, fieldKeys, apply, def) {
  const host = document.getElementById(containerId);
  if (!host) return { sync: () => {}, set: () => {} };
  const fields = sortFieldsOf(fieldKeys);

  host.innerHTML = `
    <div class="sort-control col-menu-wrap">
      <button class="col-menu-btn sort-btn" aria-haspopup="true" aria-expanded="false"
              title="What these cards are sorted by">
        <span class="sort-control-lbl">Sort:</span>
        <span class="sort-chain"></span>
      </button>
      <div class="col-menu sort-menu" role="group" aria-label="Sort criteria"></div>
    </div>`;
  const btn  = host.querySelector('.sort-btn');
  const lbl  = host.querySelector('.sort-chain');
  const menu = host.querySelector('.sort-menu');

  const sortNow = () => getSortChain(view, def, fields);

  /* One row per criterion. Every control on it carries `data-k`, which is how
   * it is found again after an edit: the popover stays open across a change,
   * so what was clicked has to still be under the cursor and still hold the
   * focus a keyboard left on it. */
  function rowHtml(c, i, criteria) {
    const used = new Set(criteria.map(x => x.field));
    /* The first row offers every field; the rest offer only what no other row
     * has taken. A chain cannot say the same field twice — the second
     * occurrence can never fire, and tidyChain drops it silently — so the rows
     * that can avoid making one do. The first row cannot: the field you most
     * want to lead with is usually already the last word of the sentence, and
     * a Name you have to delete before you can sort by it is not a control.
     * Choosing it there drops the duplicate below it, which is the row it was
     * replacing anyway.
     *
     * A label may be a collection's name, which is whatever someone typed. */
    const opts = fields.filter(f => i === 0 || f.key === c.field || !used.has(f.key))
      .map(f => `<option value="${esc(f.key)}"${f.key === c.field ? ' selected' : ''}>${esc(f.label)}</option>`)
      .join('');
    const asc  = c.dir !== -1;
    const last = criteria.length < 2;
    return `
      <div class="sort-row">
        <button class="sort-row-btn" data-act="up" data-i="${i}" data-k="up${i}"
                title="Move up" aria-label="Move up"${i ? '' : ' disabled'}>↑</button>
        <select class="sort-field" data-act="field" data-i="${i}" data-k="f${i}"
                aria-label="Sort by">${opts}</select>
        <button class="sort-dir-btn" data-act="dir" data-i="${i}" data-k="d${i}"
                title="Toggle ascending / descending"
                aria-label="${asc ? 'Ascending' : 'Descending'}">${asc ? '↑' : '↓'}</button>
        <button class="sort-row-btn" data-act="drop" data-i="${i}" data-k="x${i}"
                aria-label="Remove"
                title="${last ? 'A sort is at least one criterion' : 'Remove'}"${last ? ' disabled' : ''}>✕</button>
      </div>`;
  }

  // The fields no row has taken — what Add would append, and whether it can.
  const spareFields = criteria => fields.filter(f => !criteria.some(c => c.field === f.key));

  function menuHtml(sort) {
    const rows  = sort.criteria.map((c, i) => rowHtml(c, i, sort.criteria)).join('');
    const spare = spareFields(sort.criteria);
    const full  = sort.criteria.length >= SORT_CRITERIA_MAX || !spare.length;
    /* Reset is offered only on a chain somebody has edited, because on any
       other chain it would do nothing — the way back to the app's suggestion
       is reseedSortChain, and an unedited chain is already it. */
    return `${rows}
      <button class="col-menu-item sort-add" data-act="add" data-k="add"
              title="${full ? 'A sort is at most three criteria' : ''}"${full ? ' disabled' : ''}>+ Add a criterion</button>
      ${sort.edited ? `<div class="sort-menu-sep"></div>
      <button class="col-menu-item sort-reseed" data-act="reseed" data-k="reseed"
              title="Back to the sentence this field usually belongs to">Reset to suggested</button>` : ''}`;
  }

  /* The label and the rows are one function of the stored chain, so every
     change redraws both and neither can say something the other does not.
     The label is what sizes the button, so an open popover is placed against
     it again — a criterion added under a two-word sentence widens the button
     out from under a popover that was hung on the old one. */
  function draw() {
    const sort = sortNow();
    lbl.textContent = chainLabel(sort.criteria, fields);
    menu.innerHTML  = menuHtml(sort);
    if (isOpen()) place();
  }

  /* Every change to the chain is the same three steps: store it, redraw the
     control from what was stored, re-render the view. Nothing else may write
     this view's entry — a caller that did would be a second opinion about the
     sort, and the label would go stale the moment the two disagreed. */
  /* `focusKey` is the popover's half of it. An edit made in the popover
     replaces the row that was clicked, so the focus is put back on that row's
     equivalent — and on the button itself where there is no equivalent, since
     the control an edit removed must not leave a keyboard nowhere. It is put
     back before the view re-renders, because a re-render is what can re-mount
     this control and leave the row we were reaching for detached.

     A caller reaching in from outside — the table header — passes no key and
     the focus is not moved at all: what it clicked is elsewhere on the page,
     and pulling the focus into the sort button would be this control stealing
     the keyboard from the column heading somebody is using. */
  function commit(next, focusKey) {
    saveSortChain(view, next);
    draw();
    if (focusKey) (menu.querySelector(`[data-k="${focusKey}"]:not([disabled])`) || btn).focus();
    apply();
  }

  const isOpen = () => menu.classList.contains('open');
  const setOpen = on => {
    menu.classList.toggle('open', on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) place();
  };

  /* Where the popover lands. Every other .col-menu in the app hangs from its
     button's right edge and that is enough for them, because they open from
     the end of a strip or the corner of a tile. This one does not: the sort
     control sits in the middle of a row that wraps, so on a phone a
     fixed-width popover pinned to either of its edges leaves the window —
     off the right at one end of the row and off the left at the other.

     So it is offered its right edge and then clamped to the window, which is
     the kebab menus' two lines without their `position: fixed`. Staying
     absolute is the point: the popover travels with the strip when the page
     scrolls under it, and needs no close-on-scroll to hide the fact that it
     does not. */
  const EDGE = 4;   // px of daylight left between the popover and the window
  function place() {
    const wrap = menu.offsetParent?.getBoundingClientRect() || btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    const room = Math.max(EDGE, window.innerWidth - EDGE - w);
    const left = Math.min(room, Math.max(EDGE, btn.getBoundingClientRect().right - w));
    menu.style.left  = (left - wrap.left) + 'px';
    menu.style.right = 'auto';
  }

  btn.addEventListener('click', e => { e.stopPropagation(); setOpen(!isOpen()); });

  menu.addEventListener('click', e => {
    e.stopPropagation();
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const sort = sortNow();
    const criteria = sort.criteria.map(c => ({ ...c }));
    const i = +el.dataset.i;
    switch (el.dataset.act) {
      case 'up':
        [criteria[i - 1], criteria[i]] = [criteria[i], criteria[i - 1]];
        commit(editSortChain(sort, criteria, fields), `up${i - 1}`);
        break;
      case 'dir':
        criteria[i].dir = criteria[i].dir === -1 ? 1 : -1;
        commit(editSortChain(sort, criteria, fields), `d${i}`);
        break;
      case 'drop':
        criteria.splice(i, 1);
        // Focus lands on the row that took this one's place, or on the last.
        commit(editSortChain(sort, criteria, fields), `x${Math.min(i, criteria.length - 1)}`);
        break;
      case 'add': {
        /* Name is the word a sentence is finished with wherever it is still
           free, and the first field the view has left over otherwise. */
        const spare = spareFields(criteria);
        const f = spare.find(x => x.key === 'name') || spare[0];
        if (!f) return;
        criteria.push({ field: f.key, dir: seedDir(f.key) });
        commit(editSortChain(sort, criteria, fields), `f${criteria.length - 1}`);
        break;
      }
      case 'reseed':
        commit(reseedSortChain(sort, fields), 'reseed');
        break;
    }
  });

  menu.addEventListener('change', e => {
    const sel = e.target.closest('select[data-act="field"]');
    if (!sel) return;
    const sort = sortNow();
    const i = +sel.dataset.i;
    /* The first word is chosen rather than edited: it seeds the whole sentence
       on a chain that is still the app's, and swaps one word of a chain that
       has become somebody's own. */
    if (!i) { commit(chooseSortField(sort, sel.value, fields), 'f0'); return; }
    /* Any other word takes the direction its field is usually read in, the
       same as choosing it at the front would — Price is the expensive cards
       first wherever in the chain it lands. */
    const criteria = sort.criteria.map((c, n) =>
      n === i ? { field: sel.value, dir: seedDir(sel.value) } : { ...c });
    commit(editSortChain(sort, criteria, fields), `f${i}`);
  });

  /* Escape closes it and hands the focus back to the button that opened it,
     from anywhere inside — the listener is on the host, so it goes when the
     control is re-mounted rather than outliving it. */
  host.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.stopPropagation();
    setOpen(false);
    btn.focus();
  });
  document.addEventListener('click', () => setOpen(false));

  draw();
  return { sync: draw, set: next => commit(next) };
}

// ── Per-view persisted column visibility ────────────────────────────────────
const _colState = readPrefs('mtgtools_cols');
// colDefs: [{key,label,default}]. Returns {key:bool}
function getCols(view, colDefs) {
  const saved = _colState[view] || {};
  const out = {};
  colDefs.forEach(c => { out[c.key] = (c.key in saved) ? saved[c.key] : (c.default !== false); });
  return out;
}
function toggleCol(view, key, colDefs) {
  const cur = getCols(view, colDefs);
  cur[key] = !cur[key];
  _colState[view] = cur;
  localStorage.setItem('mtgtools_cols', JSON.stringify(_colState));
}

// Build + wire a "Columns ▾" menu into `containerId`. `apply` re-renders.
function mountColumnMenu(containerId, view, colDefs, apply) {
  const host = document.getElementById(containerId);
  if (!host) return;
  const cur = getCols(view, colDefs);
  const items = colDefs.map(c => `
    <label class="col-menu-item">
      <input type="checkbox" data-col="${c.key}"${cur[c.key] ? ' checked' : ''}>
      <span>${c.label}</span>
    </label>`).join('');
  host.innerHTML = `
    <div class="col-menu-wrap">
      <button class="col-menu-btn" title="Show / hide columns">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        Columns
      </button>
      <div class="col-menu">${items}</div>
    </div>`;
  const btn  = host.querySelector('.col-menu-btn');
  const menu = host.querySelector('.col-menu');
  btn.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
  menu.addEventListener('click', e => e.stopPropagation());
  menu.querySelectorAll('input[data-col]').forEach(cb => {
    cb.addEventListener('change', () => { toggleCol(view, cb.dataset.col, colDefs); apply(); });
  });
  document.addEventListener('click', () => menu.classList.remove('open'));
}

// ── Per-view persisted card size ────────────────────────────────────────────
// How big card artwork is drawn, on the tabs that draw it. A collection of
// twelve thousand cards is scanned at 80px and a single card is looked at
// properly at 300px, and which of those you want is a question about the tab
// you are on and the view you are in — not about the app — so it is stored the
// way the sort field and the visible columns already are.
//
// The Deck Builder built this control first, with its own slider, its own
// `dbScale` key and its own variable. It is this component now; the tab is a
// caller like the three browsing tabs, and `--card-width` is one variable the
// grids, the piles and the stacks all read.

/* The range, shared by every caller so that the control means the same thing
 * on every tab. 80 is a thumbnail you can scan a set at; 300 is a card you can
 * read the rules text off. */
const CARD_SIZE_MIN  = 80;
const CARD_SIZE_MAX  = 300;
const CARD_SIZE_STEP = 10;

/* Where a view starts before anyone has chosen — the widths the stylesheet
 * already draws each view at, said here as well because the slider needs a
 * position on its first render. */
const CARD_SIZE_DEFAULTS = { grid: 150, pile: 150 };

const _sizeState = readPrefs('mtgtools_size');

/* The XL view is gone — the slider is what "how big?" is asked with now — so
 * the sizes stored against it are for a view nobody can reach. Dropped rather
 * than folded into the grid's: a size chosen for a grid is the size that
 * person wants their grid at, and inheriting a 300px XL over it would be this
 * change deciding that for them. */
const _staleXlSizes = Object.keys(_sizeState).filter(key => key.endsWith(':xl'));
if (_staleXlSizes.length) {
  for (const key of _staleXlSizes) delete _sizeState[key];
  localStorage.setItem('mtgtools_size', JSON.stringify(_sizeState));
}

function cardSizeDefault(mode) { return CARD_SIZE_DEFAULTS[mode] || CARD_SIZE_DEFAULTS.grid; }

/* A stored size is a number of pixels within the range, whatever arrives.
 * localStorage is a string store shared with older versions of this app and
 * with whatever a person types into a console, and a grid told to lay itself
 * out at NaN or at 4000 is a broken tab rather than a wrong preference. */
function clampCardSize(px, mode) {
  const n = Math.round(Number(px));
  if (!Number.isFinite(n)) return cardSizeDefault(mode);
  return Math.min(CARD_SIZE_MAX, Math.max(CARD_SIZE_MIN, n));
}

/* Per tab *and* per view: `deckbuild:grid` is a different setting from
 * `deckbuild:pile`, which is a different setting from `sets:grid`. One key
 * per pair, in one object, in one localStorage entry — the shape the sort and
 * column preferences already use. */
function getCardSize(view, mode) {
  const saved = _sizeState[`${view}:${mode}`];
  return saved === undefined ? cardSizeDefault(mode) : clampCardSize(saved, mode);
}
function saveCardSize(view, mode, px) {
  _sizeState[`${view}:${mode}`] = clampCardSize(px, mode);
  localStorage.setItem('mtgtools_size', JSON.stringify(_sizeState));
}

/* Build + wire a Size control into `containerId`.
 *
 *   view      the tab, as the sort and column preferences name it
 *   targetId  the element the chosen width is set on. It is inherited, so
 *             this is the container the cards are rendered into rather than
 *             each grid — the grids are replaced on every render and an
 *             inline style on one of them would go with it.
 *   getMode   the tab's current view mode.
 *
 * Returns a sync() the tab calls when its view mode changes: the control
 * belongs to the image views, and each of them remembers its own size.
 */
function mountSizeControl(containerId, view, targetId, getMode) {
  const host = document.getElementById(containerId);
  if (!host) return () => {};
  host.innerHTML = `
    <div class="size-control">
      <span class="size-control-lbl">Size</span>
      <input type="range" class="size-slider" aria-label="Card size" title="How big card artwork is drawn"
             min="${CARD_SIZE_MIN}" max="${CARD_SIZE_MAX}" step="${CARD_SIZE_STEP}">
    </div>`;
  const slider = host.querySelector('.size-slider');

  const apply = px => document.getElementById(targetId)?.style.setProperty('--card-width', px + 'px');

  const sync = () => {
    /* Artwork is what this sizes, so the list view — which has none — does not
     * carry it. Hidden rather than disabled: a control that cannot do anything
     * is furniture, and the strip is measured on how little of it there is.
     *
     * The whole mount goes, not the control inside it: an emptied host is
     * still an item in the strip's flex row and would leave a gap where the
     * slider was. It is a class rather than an inline style because two tabs
     * hide this mount for a reason of their own — no deck loaded, no set
     * chosen — and an inline display would overrule them. */
    const mode = getMode();
    host.classList.toggle('size-mount-hidden', mode === 'list');
    if (mode === 'list') return;
    const px = getCardSize(view, mode);
    slider.value = px;
    apply(px);
  };

  slider.addEventListener('input', () => {
    const mode = getMode();
    saveCardSize(view, mode, slider.value);
    apply(getCardSize(view, mode));
  });

  sync();
  return sync;
}

// ── Shared card-name autocomplete ───────────────────────────────────────────
// The Want List had the only "type a card name" field in the app, with its
// debounce, its dropdown and its outside-click listener written into wants.js.
// The playmat picker is the second, and two copies of that is how they drift
// apart — so the component moved here, beside the other mount* helpers, and
// the Want List is now one of its callers rather than its owner.
//
// The markup is the caller's: an .autocomplete-wrap holding the input and an
// empty .ac-dropdown, which is what the existing styles expect. Returns a
// handle so a caller can close the dropdown from elsewhere (the Want List
// closes it when a card is added by pressing Enter).
function mountCardAutocomplete(inputId, dropId, onPick, opts = {}) {
  const input = document.getElementById(inputId);
  const drop  = document.getElementById(dropId);
  if (!input || !drop) return null;
  const { minChars = 2, delay = 280, limit = 8, commander = false } = opts;

  let timer = null;
  const close = () => { drop.style.display = 'none'; };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < minChars) { close(); return; }
    timer = setTimeout(async () => {
      try {
        const names = (await cardAutocomplete(q, { commander })).slice(0, limit);
        // The field may have moved on while the request was in flight — two
        // more keystrokes and a slower answer would otherwise overwrite the
        // newer suggestions with older ones.
        if (input.value.trim() !== q) return;
        if (!names.length) { close(); return; }
        // Elements rather than a string of HTML: a card name with an
        // apostrophe then needs no escaping to survive being put in an
        // onclick, which is the only reason the old version reached for
        // jsAttr() — and Urza's Saga is not an edge case here.
        drop.innerHTML = '';
        for (const name of names) {
          const item = document.createElement('div');
          item.className   = 'ac-item';
          item.textContent = name;
          item.addEventListener('click', () => { close(); onPick(name); });
          drop.appendChild(item);
        }
        drop.style.display = 'block';
      } catch { close(); }
    }, delay);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete-wrap')) close();
  });

  return { close };
}

// ── Shared view toggle (List / Grid / Pile) ─────────────────────────────────
// One component for every tab's view switcher, so the same icons appear in the
// same order everywhere. `getCur` returns the current mode; `pick` sets it
// (and triggers the tab's own re-render).
//
// There was an XL view here too — a second grid, drawn at 220px instead of
// 148px. The card-size control is that question asked properly: XL was one
// answer to "how big?" nailed to a button, and a slider that goes from 80 to
// 300 says every answer it had and the ones in between. So XL is gone, and
// what it drew is what Grid draws now.
const _VT_ICONS = {
  list: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  grid: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  pile: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="4" y="2" width="16" height="6" rx="1"/><rect x="4" y="9" width="16" height="6" rx="1"/><rect x="4" y="16" width="16" height="6" rx="1"/></svg>',
};
const _VT_TITLES = { list: 'List view', grid: 'Grid view', pile: 'Pile view' };

function mountViewToggle(containerId, modes, getCur, pick) {
  const host = document.getElementById(containerId);
  if (!host) return;
  host.innerHTML = `<div class="view-toggle">${modes.map(m =>
    `<button class="view-btn${getCur() === m ? ' active' : ''}" data-mode="${m}" title="${_VT_TITLES[m]}">${_VT_ICONS[m]}</button>`
  ).join('')}</div>`;
  const sync = () => host.querySelectorAll('.view-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === getCur()));
  host.querySelectorAll('.view-btn').forEach(b =>
    b.addEventListener('click', () => { pick(b.dataset.mode); sync(); }));
  return sync;
}

// ── Shared "⋯" overflow / kebab menu ────────────────────────────────────────
// Returns an HTML snippet (safe inside template-literal renders). Items:
//   { label, onclick, danger }  — action row; onclick is an inline-JS string
//   { section }                 — small section label
//   { divider: true }           — horizontal rule
// Menus escape overflow:hidden containers (deck tiles) by being positioned
// fixed relative to the button when opened.
function kebabMenuHtml(items, opts = {}) {
  const inner = items.map(it => {
    if (it.divider) return '<div class="db-more-divider"></div>';
    if (it.section) return `<div class="db-more-section-label">${it.section}</div>`;
    return `<button class="col-menu-item${it.danger ? ' db-menu-danger' : ''}"
      onclick="event.stopPropagation();closeAllKebabs();${it.onclick}">${it.label}</button>`;
  }).join('');
  return `<div class="col-menu-wrap kebab-wrap">
    <button class="kebab-btn${opts.btnClass ? ' ' + opts.btnClass : ''}" title="${opts.title || 'More actions'}"
      onclick="toggleKebab(event)">⋯</button>
    <div class="col-menu">${inner}</div>
  </div>`;
}

function toggleKebab(e) {
  e.stopPropagation();
  const btn  = e.currentTarget;
  const menu = btn.nextElementSibling;
  if (!menu) return;
  const wasOpen = menu.classList.contains('open');
  closeAllKebabs();
  if (wasOpen) return;
  menu.classList.add('open');
  // Fixed positioning so the menu isn't clipped by overflow:hidden ancestors
  const r = btn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left  = 'auto';
  menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  menu.style.top   = (r.bottom + 5) + 'px';
  const mh = menu.offsetHeight;
  if (r.bottom + 5 + mh > window.innerHeight) {
    menu.style.top = Math.max(8, r.top - mh - 5) + 'px';
  }
}

function closeAllKebabs() {
  document.querySelectorAll('.kebab-wrap .col-menu.open').forEach(m => {
    m.classList.remove('open');
    m.style.position = m.style.top = m.style.left = m.style.right = '';
  });
}
document.addEventListener('click', closeAllKebabs);
document.addEventListener('scroll', closeAllKebabs, { capture: true, passive: true });
