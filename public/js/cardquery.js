// ── Scryfall query syntax, read off the local card cache ──────────────────
// The Collections search box used to be one line of code — `name.includes(q)`
// — which is the only question a collection row can answer about itself. Every
// other question people actually have about their own cards ("which red
// creatures do we own", "what have we got under two mana that draws") had to
// be asked on the Scryfall tab, where the answer is the whole of Magic and not
// the shelf in the next room.
//
// This file is the other half of that: Scryfall's own query language, parsed
// here and run against the card facts the app already caches (see
// `cardMetaOf` in js/sortui.js — the same cache the sort and the metadata
// columns read). Nothing is sent to Scryfall. A query is compiled once per
// keystroke and then evaluated per row, so a five-thousand-card collection
// filters inside a frame.
//
// What it deliberately is not: a reimplementation of Scryfall. Scryfall
// searches every printing of every card and knows things — format legality,
// artist, printing year, watermarks — that the local oracle-card cache does
// not carry. Those filters are recognised and turned down by name rather than
// silently returning nothing, which is the failure mode of a half-syntax:
// see CQ_ABSENT.
//
// Grammar, smallest first:
//
//   query  := or
//   or     := and ('OR' and)*
//   and    := unary ('AND'? unary)*
//   unary  := '-' unary | '(' or ')' | term
//   term   := '!' value | value | key op value
//
// `OR` and `AND` are operators only in capitals, which is Scryfall's own rule
// and is kept rather than improved on. Lower-case `or` is a word in a card
// name — "Now or Never" — and a search language that quietly changes what a
// typed name means is worse than one that asks for a shift key.
//
// Two boxes read this file now: the Collections search and the Deck Builder's
// filter. They differ in one word — what a *bare* word asks about; see
// CQ_BARE — and in nothing else, which is the point of pointing the second box
// at the first box's parser rather than growing a second syntax.

/* Two card names that mean the same field. Scryfall's aliases, plus the
 * spellings this app's own UI uses elsewhere (`mv`, `price`). */
const CQ_ALIASES = {
  n: 'name', name: 'name',
  t: 'type', type: 'type',
  o: 'oracle', oracle: 'oracle', text: 'oracle',
  m: 'mana', mana: 'mana', cost: 'mana',
  mv: 'cmc', cmc: 'cmc', manavalue: 'cmc',
  c: 'color', color: 'color', colour: 'color',
  id: 'identity', ci: 'identity', identity: 'identity', commander: 'identity',
  r: 'rarity', rarity: 'rarity',
  pow: 'power', power: 'power',
  tou: 'toughness', toughness: 'toughness',
  s: 'set', set: 'set', e: 'set', edition: 'set',
  is: 'is', has: 'is', not: 'not',
  layout: 'layout',
  usd: 'usd', eur: 'eur', price: 'eur',
};

/* Filters that are real Scryfall syntax and are not answerable here, with the
 * reason. A query using one is refused by name — "f: (format legality) needs
 * data the local card cache doesn't carry" — because the alternative is a
 * search that looks like it worked and returns nothing, and no amount of
 * re-typing gets the person to the truth. */
const CQ_ABSENT = {
  f: 'format legality',        format: 'format legality',
  legal: 'format legality',    banned: 'format legality',
  restricted: 'format legality',
  a: 'artist',                 artist: 'artist',
  ft: 'flavour text',          flavor: 'flavour text', flavour: 'flavour text',
  year: 'printing year',       date: 'printing date',
  cn: 'collector number',      number: 'collector number',
  wm: 'watermark',             watermark: 'watermark',
  border: 'border treatment',  frame: 'frame treatment',
  kw: 'keyword list',          keyword: 'keyword list',
  lang: 'language',            language: 'language',
  in: 'printings',             rr: 'ruling text',
  loyalty: 'loyalty',          l: 'loyalty',
};

const CQ_OPS = new Set([':', '=', '!=', '<', '<=', '>', '>=']);

// ── Colours ───────────────────────────────────────────────────────────────
const CQ_COLOR_LETTERS = { w: 'W', u: 'U', b: 'B', r: 'R', g: 'G' };
const CQ_COLOR_WORDS = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  azorius: 'WU', dimir: 'UB', rakdos: 'BR', gruul: 'RG', selesnya: 'GW',
  orzhov: 'WB', izzet: 'UR', golgari: 'BG', boros: 'RW', simic: 'GU',
  bant: 'GWU', esper: 'WUB', grixis: 'UBR', jund: 'BRG', naya: 'RGW',
  abzan: 'WBG', jeskai: 'URW', sultai: 'BGU', mardu: 'RWB', temur: 'GUR',
};

/* A colour value as the comparisons below need it: which colours were named,
 * and whether the word was one of the two that name a shape rather than a
 * set — `c` (colourless, the empty set) and `m` (multicolour, "two or more of
 * anything"). */
function cqParseColors(raw, key) {
  const v = raw.toLowerCase();
  if (v === 'c' || v === 'colorless' || v === 'colourless') return { set: new Set(), colorless: true };
  if (v === 'm' || v === 'multi' || v === 'multicolor' || v === 'multicolour') return { set: new Set(), multi: true };
  if (CQ_COLOR_WORDS[v]) return { set: new Set(CQ_COLOR_WORDS[v]) };
  const set = new Set();
  for (const ch of v) {
    const letter = CQ_COLOR_LETTERS[ch];
    if (!letter) throw new Error(`${key}: "${raw}" is not a colour — use w, u, b, r, g, c, m, a colour name, or a guild name.`);
    set.add(letter);
  }
  if (!set.size) throw new Error(`${key}: expected a colour.`);
  return { set };
}

/* Scryfall's colour comparisons, which are set comparisons and not string
 * ones: `c:rg` is "at least red and green", `c=rg` is "exactly those two",
 * `c<=rg` is "nothing outside them". */
function cqColorTest(have, op, spec) {
  const mine = new Set(have || []);
  if (spec.multi)     return op === '!=' ? mine.size < 2 : mine.size >= 2;
  if (spec.colorless) return op === '!=' ? mine.size > 0 : mine.size === 0;

  const want = spec.set;
  const contains = [...want].every(c => mine.has(c));
  const within   = [...mine].every(c => want.has(c));
  switch (op) {
    case ':': case '>=': return contains;
    case '=':            return contains && within;
    case '!=':           return !(contains && within);
    case '<=':           return within;
    case '<':            return within && mine.size < want.size;
    case '>':            return contains && mine.size > want.size;
  }
  return false;
}

// ── Mana costs ────────────────────────────────────────────────────────────
/* A mana cost as a bag of symbols plus a generic count, so `m:{G}{G}` can ask
 * "does this cost contain two greens" without caring what else is in it.
 * Both spellings are read: `{2}{G}{G}` as Scryfall writes it, and `2GG` as
 * people type it. */
function cqParseMana(raw) {
  const symbols = new Map();
  let generic = 0;
  const add = sym => symbols.set(sym, (symbols.get(sym) || 0) + 1);

  const braced = raw.match(/\{[^}]*\}/g);
  if (braced) {
    for (const b of braced) {
      const inner = b.slice(1, -1).toUpperCase();
      if (/^\d+$/.test(inner)) generic += parseInt(inner, 10);
      else add(inner);
    }
    return { symbols, generic };
  }
  for (const m of raw.toUpperCase().matchAll(/\d+|[WUBRGCXYZSP]/g)) {
    if (/^\d+$/.test(m[0])) generic += parseInt(m[0], 10);
    else add(m[0]);
  }
  return { symbols, generic };
}

function cqManaTest(cost, op, want) {
  const have = cqParseMana(cost || '');
  const keys = new Set([...have.symbols.keys(), ...want.symbols.keys()]);
  const contains = have.generic >= want.generic &&
    [...keys].every(k => (have.symbols.get(k) || 0) >= (want.symbols.get(k) || 0));
  const within = have.generic <= want.generic &&
    [...keys].every(k => (have.symbols.get(k) || 0) <= (want.symbols.get(k) || 0));
  switch (op) {
    case ':': case '>=': return contains;
    case '=':            return contains && within;
    case '!=':           return !(contains && within);
    case '<=':           return within;
    case '<':            return within && !contains;
    case '>':            return contains && !within;
  }
  return false;
}

// ── Ordered and numeric values ────────────────────────────────────────────
const CQ_RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5 };
const CQ_RARITY_WORDS = { c: 'common', u: 'uncommon', r: 'rare', m: 'mythic', s: 'special', b: 'bonus' };

function cqCompare(actual, op, want) {
  if (actual === null || actual === undefined || Number.isNaN(actual)) return false;
  switch (op) {
    case ':': case '=': return actual === want;
    case '!=':          return actual !== want;
    case '<':           return actual <  want;
    case '<=':          return actual <= want;
    case '>':           return actual >  want;
    case '>=':          return actual >= want;
  }
  return false;
}

function cqNumber(raw, key) {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) throw new Error(`${key}: expected a number, got "${raw}".`);
  return n;
}

/* Power and toughness are strings on a card because some of them are `*`. A
 * `*` compares to nothing and matches nothing, which is what cqCompare does
 * with the NaN this hands it. */
function cqStat(v) {
  if (v === null || v === undefined || v === '') return null;
  return parseFloat(String(v).replace('*', ''));
}

// ── is: ───────────────────────────────────────────────────────────────────
/* The `is:` values the local card cache can actually decide. Every one of
 * these reads a field the app already stores; the ones that would need a
 * printing (`is:foil`, `is:promo`, `is:reprint`) are absent by the same rule
 * as CQ_ABSENT and are refused by name below.
 *
 * `is:owned` is the exception and is now in it: it is a fact about the
 * collections rather than about the card, so the *caller* supplies it on the
 * card it hands in — `true` on the Collections tab, where a row is on the shelf
 * being looked at by definition, and "the deck has every copy it asks for" in
 * the Deck Builder, where the shelf is whichever of the three the strip is
 * scoped to. A caller that says nothing about it gets `false`, which is what a
 * box with no collections behind it can honestly answer.
 *
 * `is:gamechanger` is the newest of them and reads Wizards' list off the card,
 * which the cache has carried since the trimmed shape went to version 2. It is
 * the one filter here that is about a *format's* opinion of a card rather than
 * about the card, and it earns its place beside the others because the bracket
 * a deck is in turns on counting them: "which of these are Game Changers" is a
 * question somebody with the readout open now actually has. */
const CQ_IS = {
  permanent:  c => /\b(artifact|creature|enchantment|land|planeswalker|battle)\b/i.test(c.type || ''),
  spell:      c => !!(c.type || '') && !/\bland\b/i.test(c.type),
  land:       c => /\bland\b/i.test(c.type || ''),
  creature:   c => /\bcreature\b/i.test(c.type || ''),
  vanilla:    c => /\bcreature\b/i.test(c.type || '') && !(c.oracle || '').trim(),
  colorless:  c => !((c.colors || []).length),
  multicolor: c => (c.colors || []).length >= 2,
  monocolor:  c => (c.colors || []).length === 1,
  hybrid:     c => /\{[^}]*\/[^}]*\}/.test(c.mana || '') && !/\/P\}/i.test(c.mana || ''),
  phyrexian:  c => /\/P\}/i.test(c.mana || ''),
  split:      c => c.layout === 'split',
  flip:       c => c.layout === 'flip',
  transform:  c => c.layout === 'transform',
  meld:       c => c.layout === 'meld',
  mdfc:       c => c.layout === 'modal_dfc',
  dfc:        c => c.layout === 'transform' || c.layout === 'modal_dfc',
  adventure:  c => c.layout === 'adventure',
  leveler:    c => c.layout === 'leveler',
  saga:       c => /\bsaga\b/i.test(c.type || ''),
  owned:      c => !!c.owned,
  gamechanger: c => !!c.gameChanger,
};
const CQ_IS_ALIASES = {
  multicolored: 'multicolor', multicolour: 'multicolor', multicoloured: 'multicolor',
  colourless: 'colorless', mono: 'monocolor', monocolored: 'monocolor',
  doublefaced: 'dfc', 'double-faced': 'dfc', modaldfc: 'mdfc',
  /* Scryfall writes it as one word; the app's own prose does not. */
  'game-changer': 'gamechanger', gamechangers: 'gamechanger',
};

// ── Terms ─────────────────────────────────────────────────────────────────
/* One filter, compiled. `needsMeta` is what tells the caller whether this
 * query can be answered from the row alone: a plain name search reads nothing
 * but the name and stays instant, while anything else has to wait for the
 * card facts to be in the cache. It is the difference between typing "sol"
 * and typing "t:artifact" in a collection nobody has looked up yet. */
function cqTerm(key, op, raw) {
  const field = CQ_ALIASES[key];
  if (!field) {
    const absent = CQ_ABSENT[key];
    if (absent) throw new Error(`"${key}:" searches ${absent}, which the local card data doesn’t carry — try it on the Scryfall tab.`);
    throw new Error(`Unknown filter "${key}:".`);
  }
  if (raw === '') return null;   // a half-typed `t:` is not yet a filter

  const lower = raw.toLowerCase();
  const has = (text, needle) => (text || '').toLowerCase().includes(needle);

  switch (field) {
    case 'name':
      return { needsMeta: false, match: c =>
        op === '=' ? c.name.toLowerCase() === lower : has(c.name, lower) };

    case 'type':
      return { needsMeta: true, match: c => has(c.type, lower) };

    /* `~` is the card's own name, so `o:"~ enters tapped"` reads the way the
       card is written rather than the way it is printed. */
    case 'oracle':
      return { needsMeta: true, match: c =>
        has(c.oracle, lower.split('~').join(c.name.toLowerCase())) };

    case 'mana': {
      const want = cqParseMana(raw);
      return { needsMeta: true, match: c => cqManaTest(c.mana, op, want) };
    }

    case 'cmc': {
      const n = cqNumber(raw, key);
      return { needsMeta: true, match: c => cqCompare(c.cmc ?? null, op, n) };
    }

    case 'color': {
      const spec = cqParseColors(raw, key);
      return { needsMeta: true, match: c => cqColorTest(c.colors, op, spec) };
    }

    case 'identity': {
      const spec = cqParseColors(raw, key);
      /* Colour identity defaults to the card's colours when the cache has no
         identity for it, so a collection whose data predates this filter
         answers approximately rather than answering "no". */
      return { needsMeta: true, match: c => cqColorTest(c.ci?.length ? c.ci : c.colors, op, spec) };
    }

    case 'rarity': {
      const word = CQ_RARITY_WORDS[lower] || lower;
      if (!(word in CQ_RARITY_ORDER)) {
        throw new Error(`${key}: "${raw}" is not a rarity — use common, uncommon, rare, mythic, special or bonus.`);
      }
      const n = CQ_RARITY_ORDER[word];
      return { needsMeta: true, match: c => cqCompare(CQ_RARITY_ORDER[c.rarity] ?? null, op, n) };
    }

    case 'power': {
      const n = cqNumber(raw, key);
      return { needsMeta: true, match: c => cqCompare(cqStat(c.power), op, n) };
    }

    case 'toughness': {
      const n = cqNumber(raw, key);
      return { needsMeta: true, match: c => cqCompare(cqStat(c.toughness), op, n) };
    }

    /* One printing per card is what an oracle-card cache holds — whichever
       Scryfall calls the card's default — so this asks "is that the printing"
       and not "was it ever printed there". Which is why it is a `set:` that
       narrows an already-owned list rather than a way to browse a set; the
       Sets tab is that. */
    case 'set':
      return { needsMeta: true, match: c => (c.set || '').toLowerCase() === lower };

    case 'layout':
      return { needsMeta: true, match: c => (c.layout || '').toLowerCase() === lower };

    case 'usd': case 'eur': {
      const n = cqNumber(raw, key);
      return { needsMeta: true, match: c => cqCompare(c[field] ?? null, op, n) };
    }

    case 'is': case 'not': {
      const name = CQ_IS_ALIASES[lower] || lower;
      const test = CQ_IS[name];
      if (!test) throw new Error(`${key}: "${raw}" isn’t one of ${Object.keys(CQ_IS).join(', ')}.`);
      return { needsMeta: true, match: field === 'not' ? c => !test(c) : test };
    }
  }
  return null;
}

// ── Tokenizer ─────────────────────────────────────────────────────────────
/* Quotes are dropped as they are read, so `t:"legendary creature"` arrives
 * here as one token reading `t:legendary creature`. Whether the token *began*
 * with a quote is kept, though, and it is the whole difference between
 * `o:draw` and `"o:draw"` — the second is a card whose name contains a colon,
 * and there are a few. */
function cqTokenize(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { out.push({ k: c }); i++; continue; }
    if (c === '-' && i + 1 < text.length && !/[\s)]/.test(text[i + 1])) { out.push({ k: '-' }); i++; continue; }

    let raw = '', inQ = false, opened = false;
    const start = i;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') { inQ = !inQ; if (i === start) opened = true; i++; continue; }
      if (!inQ && (/\s/.test(ch) || ch === '(' || ch === ')')) break;
      raw += ch; i++;
    }
    if (inQ) throw new Error('Unclosed quote in search.');
    if (raw || opened) out.push({ k: 'term', raw, opened });
  }
  return out;
}

/* A bare token, split into filter and value if it is one. `!Sol Ring` and a
 * token that opened with a quote are names and nothing else. */
function cqSplitTerm(tok) {
  if (tok.opened) return { key: null, op: ':', value: tok.raw };
  if (tok.raw[0] === '!') return { key: 'name', op: '=', value: tok.raw.slice(1) };
  const m = tok.raw.match(/^([a-zA-Z]+)(>=|<=|!=|[:=<>])([\s\S]*)$/);
  if (!m) return { key: null, op: ':', value: tok.raw };
  const op = m[2];
  if (!CQ_OPS.has(op)) return { key: null, op: ':', value: tok.raw };
  return { key: m[1].toLowerCase(), op, value: m[3] };
}

// ── What a bare word asks about ───────────────────────────────────────────
/* Scryfall's answer is the name, and Collections keeps it: a collection is
 * thousands of rows, and a word that read the rules text as well would match
 * half of them — `draw` is in a third of Magic.
 *
 * The Deck Builder's filter box has always searched the name *and* the rules
 * text, and at sixty cards that is the better answer: the deck is small enough
 * that the wider net still lands on a handful, and it is how everyone using
 * that box already types. So the caller says which it wants, and the language
 * is otherwise one language — `o:` is still the way to ask about rules text on
 * purpose, in either box.
 *
 * Reading the oracle text is reading a fact off the card, so `text` needs the
 * cache filled where `name` does not. That is what `needsMeta` is for. */
const CQ_BARE = {
  name: word => ({ needsMeta: false,
    match: c => (c.name || '').toLowerCase().includes(word) }),
  text: word => ({ needsMeta: true,
    match: c => (c.name || '').toLowerCase().includes(word) ||
                (c.oracle || '').toLowerCase().includes(word) }),
};

/* The language, said in eight examples, for showing beside a box that has just
 * refused what was typed into it. It lives here rather than in either tab
 * because it describes this file; two copies would be two syntaxes as soon as
 * one of them gained a filter. */
const CQ_SYNTAX_HELP = `<div class="help-text syntax-tip">
  <code>t:creature</code> · <code>c:rg</code> · <code>mv&lt;=2</code> ·
  <code>o:draw</code> · <code>r:mythic</code> · <code>-t:land</code> ·
  <code>"exact phrase"</code> · <code>t:goblin OR t:elf</code>
</div>`;

// ── Parser ────────────────────────────────────────────────────────────────
/* Recursive descent over the grammar at the top of the file. Each level hands
 * back a `{ needsMeta, match }` of the same shape a single term has, so an
 * `OR` of two filters is indistinguishable from a filter to whoever runs it. */
function cqParse(tokens, bare) {
  let pos = 0;
  const peek = () => tokens[pos];
  const isWord = (tok, word) => tok?.k === 'term' && !tok.opened && tok.raw === word;

  function parseOr() {
    const parts = [parseAnd()];
    while (isWord(peek(), 'OR')) { pos++; parts.push(parseAnd()); }
    return parts.length === 1 ? parts[0] : combine(parts, true);
  }

  function parseAnd() {
    const parts = [];
    while (pos < tokens.length) {
      const tok = peek();
      if (tok.k === ')' || isWord(tok, 'OR')) break;
      if (isWord(tok, 'AND')) { pos++; continue; }
      parts.push(parseUnary());
    }
    if (!parts.length) throw new Error('Search is missing a term.');
    return parts.length === 1 ? parts[0] : combine(parts, false);
  }

  function parseUnary() {
    const tok = peek();
    if (tok.k === '-') {
      pos++;
      const inner = parseUnary();
      return { needsMeta: inner.needsMeta, match: c => !inner.match(c) };
    }
    if (tok.k === '(') {
      pos++;
      const inner = parseOr();
      if (peek()?.k !== ')') throw new Error('Unclosed ( in search.');
      pos++;
      return inner;
    }
    if (tok.k === ')') throw new Error('Unmatched ) in search.');
    pos++;
    const { key, op, value } = cqSplitTerm(tok);
    if (key === null) return bare(value.toLowerCase());
    /* A filter with nothing after it yet — the `t:` of a `t:creature` still
       being typed — matches everything rather than failing, so the results
       don't flash an error between two keystrokes. */
    return cqTerm(key, op, value) || { needsMeta: false, match: () => true };
  }

  function combine(parts, any) {
    const needsMeta = parts.some(p => p.needsMeta);
    return any
      ? { needsMeta, match: c => parts.some(p => p.match(c)) }
      : { needsMeta, match: c => parts.every(p => p.match(c)) };
  }

  const q = parseOr();
  if (pos < tokens.length) throw new Error('Unmatched ) in search.');
  return q;
}

/* The one way in. Throws on a query that cannot mean anything — an unknown
 * filter, an unclosed quote, a rarity that isn't one — with a message written
 * to be shown to the person who typed it. Returns null for an empty search,
 * which is not an error and not a filter either.
 *
 * `card` is `{ name, ...cardMetaOf(card) }`: the name off the row and the
 * facts out of the cache the sort already fills.
 *
 * `opts.bare` is which of CQ_BARE a word with no filter on it means, and
 * defaults to Scryfall's own answer — the name. */
function parseCardQuery(text, opts = {}) {
  const tokens = cqTokenize(String(text || '').trim());
  if (!tokens.length) return null;
  return cqParse(tokens, CQ_BARE[opts.bare] || CQ_BARE.name);
}
