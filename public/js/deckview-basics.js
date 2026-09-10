// ── Deck Builder — Lands: the basics optimizer ────────────────────────────
// The one control on the Lands tab that *writes*. Everything else in the tab
// is a reading of a deck — the check, the fix region, the cycles — and this is
// an edit of one: a budget of basic lands, split across the deck's colours in
// proportion to the pips its costs ask for, shown before it is done and
// written on a second press.
//
// It lives in its own file because it is the tab's only reason to change that
// is not about reading. It owns state nothing else owns — the plan in flight,
// and the "at least 1 basic of every colour" override kept in localStorage —
// and a history reason of its own, `dbForceSnapshot('basics')`, because a
// write that moves eight rows at once is one thing somebody did and wants back
// in one press.
//
// ── One module, two files ─────────────────────────────────────────────────
//
// This file is the write half of the land base module, not a sibling of it. It
// requires js/deckview-landbase.js: it reads that file's tables through
// dbSourcesDemands() and dbSourcesBars() to run the check over the deck a
// split would make, draws with its dbSourcesSym() and dbBlindSentence() so the
// two halves of the tab say things the same way, and asks dbRenderLands() to
// redraw. So it is served immediately after it, and test/decklands.test.js
// asserts that order.
//
// The dependency runs one way only. The land base module treats *this* file as
// optional, the way js/deckview-render.js has always treated it: it asks
// whether dbBasicsHtml() is there before drawing the control, and whether
// dbBasicsForgetPlan() is there before dropping a plan. A tab drawn without
// this file is a tab with three readings and no Apply button, which is a
// sensible thing for a harness that does not care about basics to get.
//
// See docs/design/spec-landbase.md, "Optimize basics".

/* The one thing on this tab that writes to the deck, and the first thing in
 * the app to write a calculation into one.
 *
 * It asks for a number of *basics*, not for a number of lands. The number is a
 * budget rather than a remainder: different decks want different amounts of
 * basic land, and typing the figure directly is the whole of what stops a
 * split from crowding out the rest of the list. The deck's non-basic count is
 * not an input and neither is its land total.
 *
 * The split is proportional to the deck's pips, by largest remainder, and then
 * the check runs over the result and says what it could not fix. Gap-driven
 * solving — pour basics into whichever colour is furthest below its bar — was
 * considered and rejected: the total is fixed, so every Plains that fixes
 * white takes a source away from something else, and in a three-colour deck
 * there is frequently no basic-only split that clears every bar, because the
 * answer is duals. Proportional is close to optimal for balance, and the
 * verdict underneath is where the truth about the rest goes.
 *
 * Two presses, because it writes to the least-noticed cards in the list and
 * silent would mean finding out three games later.
 *
 * Beside it, one override: "at least 1 basic of every colour", off by default
 * and remembered the way the drawer's "Add to" is. Off is the honest answer,
 * so off is the default — but a colour the proportional split rounds to
 * nothing, in a deck where nothing else makes that colour, is said out loud in
 * the preview either way. You find out when it bites rather than having to
 * know to flick a switch first.
 *
 * See docs/design/spec-landbase.md.
 */

/** The six basic names, by the colour each one makes — the only names touched. */
const DB_BASIC_OF = new Map(DB_MANA_COLORS.map(c => [c.basic, c.id]));

/* What a preview is showing, as the number it was asked for rather than as the
 * plan itself. The plan is worked out afresh on every draw, so a deck edited
 * behind the drawer between the two presses is re-split rather than applied as
 * it was half a minute ago — and the second press writes what is on screen,
 * which is the whole of what the two presses are for. */
let _dbBasicsBudget = null;

/* The override, kept where dbAddTo() keeps its own — in localStorage, not on
 * the deck. It is a way of working rather than a fact about any one list:
 * somebody who wants a Swamp in every deck that has a black card in it wants
 * it in the next deck too, and having to find the switch again on each of them
 * is the switch not being remembered.
 *
 * Off unless it says otherwise, which is both the default and localStorage's
 * usual rule: a stored value nothing recognises is the default, not a third
 * state. */
const DB_BASICS_ONE_EACH_KEY = 'mtgtools_db_basics_one_each';

function dbBasicsOneEach() {
  try { return localStorage.getItem(DB_BASICS_ONE_EACH_KEY) === '1'; } catch { return false; }
}

/* Flicked. The preview is patched rather than the tab redrawn, for the reason
 * dbBasicsTyped() has: a redraw would take the number field out from under the
 * cursor. Nothing above or below the control is a reading of this switch —
 * the check counts the deck as it stands and the toggle changes no card — so
 * the preview is the whole of what has gone stale. */
function dbSetBasicsOneEach(on) {
  try { localStorage.setItem(DB_BASICS_ONE_EACH_KEY, on ? '1' : '0'); } catch {}
  _dbBasicsRepaint();
}

/* The deck's basics, in the two piles that matter: the ones this writes to,
 * and the ones it will not.
 *
 * Which pile a row falls in is decided by *name*, not by the type line, and
 * that is deliberate — a row called Plains is a Plains whether or not its
 * facts have arrived from Scryfall, and a prefill that read 0 because the
 * cache was mid-refresh would be a budget that quietly emptied the deck.
 *
 * Five of the six are managed wherever they appear. Wastes is the sixth, and
 * is managed only where _dbBasicsWant() puts weight on {C} — a deck whose pips
 * are colourless ones. That is the same rule the split runs on, read from the
 * same function so the two cannot disagree, and it has to be read here as well
 * as there: anywhere a colour could take the slot, {C} is given none, so a
 * Wastes counted as managed is a row the split takes to nought and
 * dbBasicsApply() then deletes. An Eldrazi-splash deck would lose its Wastes
 * to the default re-balance press, which is the optimizer removing cards
 * nobody asked it to touch.
 *
 * That one rule is the exception to the paragraph above it: the pips are read
 * from the cache, so a deck still in flight files its Wastes as spare rather
 * than as managed. Spare is the safe way round — it is the pile that is left
 * alone — and the budget does not notice either way, the prefill being the two
 * piles added together. Nothing is written while anything is in flight at all;
 * see `blind`, in dbBasicsPlan().
 *
 * The rest of the unmanaged pile is the names nobody listed, and those cannot
 * be decided by name at all: dbIsBasic() passes `Basic Snow Land — Island`.
 * Everything in that pile — the snow basics, and the Wastes of a coloured deck
 * — comes off the budget and is named in the preview, so "I asked for 14"
 * cannot mean a deck that grew by three. */
function _dbBasicsHeld() {
  const managed = dbManaZero();
  const spare   = [];
  const want    = _dbBasicsWant(dbDeckMana().pips);
  for (const row of dbMainCards()) {
    const qty = row.qty || 1;
    const id  = DB_BASIC_OF.get(row.card_name);
    if (id) {
      /* By name on the way out too: counting an unmanaged Wastes off its type
         line would have a cold cache hide it from the budget as well. */
      if (id !== 'C' || want.C > 0) managed[id] += qty;
      else spare.push({ name: row.card_name, qty });
      continue;
    }
    const sf = dbCardData.get(row.card_name);
    if (sf && dbIsBasic(sf) && dbCardType(row.card_name) === 'land') {
      spare.push({ name: row.card_name, qty });
    }
  }
  const held  = DB_MANA_IDS.reduce((n, id) => n + managed[id], 0);
  const extra = spare.reduce((n, s) => n + s.qty, 0);
  return { managed, spare, held, extra, total: held + extra };
}

/* The pips a budget is allowed to be split by, which is not every pip the
 * deck has.
 *
 * {C} sits out. A Commander deck with two colourless pips does not want two
 * Wastes, and a proportional split that hands one a slot takes that slot from
 * a colour that needed it. Unless there is no colour to take it from — a
 * Kozilek deck, a Karn deck — in which case Wastes is simply the answer. That
 * completes the rule rather than contradicting it: {C} never competes with a
 * colour, and with no colour in the deck it is not competing with anything.
 *
 * One function rather than two, because the toggle below and the flag beside
 * it both mean "every colour the deck has pips in" and it would be a poor
 * joke if the two of them disagreed about which colours those were. */
function _dbBasicsWant(pips) {
  const want     = dbManaZero();
  const colours  = DB_MANA_IDS.filter(id => id !== 'C');
  const inColour = colours.reduce((n, id) => n + (pips[id] || 0), 0);
  if (inColour > 0) for (const id of colours) want[id] = pips[id] || 0;
  else want.C = pips.C || 0;
  return want;
}

/* The split itself: landsDistribute()'s maths, over those pips.
 *
 * One-each is repaired into the finished split rather than reserved out of the
 * budget in front of it, and that is the difference between an override and a
 * second algorithm. Reserving one slot per colour and splitting the remainder
 * would move basics around on decks where every colour already had some — flick
 * the switch on a 3/13/7 and get a 4/12/7, for a deck that never had a colour
 * at risk. A switch that changes an answer it was not needed for is a switch
 * nobody can predict. Repairing means the toggle is exactly a no-op wherever
 * the proportional split already seats every colour, which is most decks.
 *
 * Who pays is not a free choice either. The basic comes off whichever colour
 * is furthest *above* its own exact share — the one holding a slot rounding
 * gave it — so the result stays as close to proportional as a whole number
 * lets it be. Never off a colour down to its own last basic: paying by
 * starving somebody else is the split going round in a circle.
 *
 * Which is why a budget too small to seat every colour seats the colours with
 * the most pips and leaves the rest at nought. There is no split of three
 * slots that gives five colours one each; what there is, is a preview that
 * says which colours the deck cannot make — see _dbBasicsStarved(). */
function dbBasicsSplit(slots, pips) {
  const want  = _dbBasicsWant(pips);
  const total = Math.max(0, Math.round(slots));
  const split = landsDistribute(total, want);
  const asked = DB_MANA_IDS.reduce((n, id) => n + want[id], 0);
  if (!dbBasicsOneEach() || !asked) return split;

  /* Sorted so that where the budget runs out before the colours do, it is the
     colour the deck asks for least that goes without. Array.sort is stable,
     so colours asking equally keep WUBRG order. */
  const needy = DB_MANA_IDS.filter(id => want[id] > 0 && split[id] === 0)
                           .sort((a, b) => want[b] - want[a]);
  const over  = id => split[id] - total * want[id] / asked;
  for (const id of needy) {
    const payer = DB_MANA_IDS.filter(o => split[o] > 1).sort((a, b) => over(b) - over(a))[0];
    if (!payer) break;   // nobody can pay, so nobody after this one can be paid for either
    split[payer]--;
    split[id]++;
  }
  return split;
}

/** Everything the preview says, as figures. */
function dbBasicsPlan(budget) {
  const mana  = dbDeckMana();
  const held  = _dbBasicsHeld();
  const slots = Math.max(0, budget - held.extra);
  const split = dbBasicsSplit(slots, mana.pips);

  const rows = DB_MANA_COLORS
    .map(c => ({ id: c.id, name: c.basic, label: c.label,
                 from: held.managed[c.id], to: split[c.id] }))
    .filter(r => r.from || r.to);
  const moved = rows.reduce((n, r) => n + (r.to - r.from), 0);

  /* Nowhere to put them: a deck with no pips at all — nothing in it yet, or
     nothing whose facts have arrived. The budget cannot be spent, and saying
     so is better than a preview of six rows of nought. */
  const placed = DB_MANA_IDS.reduce((n, id) => n + split[id], 0);
  const cards  = dbDeckTotals().cards;
  return {
    budget, slots, spare: held.spare, extra: held.extra,
    /* The cards whose facts have not arrived, which is the one thing that can
       make every number above wrong at once. The managed pile survives a cold
       cache because it is decided by name — a row called Plains is a Plains —
       but the unmanaged pile cannot be: knowing a Snow-Covered Forest is a
       basic means reading its type line. So a deck half of which is still in
       flight is a deck whose snow basics do not come off the budget, and "I
       asked for 12" becomes a deck of fifteen. Named here, and refused below,
       rather than written and found out three games later. */
    blind: mana.unknown,
    rows, changed: rows.filter(r => r.to !== r.from),
    /* The colours this leaves the deck unable to make at all — which is the
       finding the toggle exists to prevent, said out loud whether or not the
       toggle is on. Off is the default, so the moment it would have mattered
       has to arrive by itself: nobody flicks a switch against a failure they
       have not been shown. */
    starved: _dbBasicsStarved(split, mana, held.managed),
    /* And, with the override on, the colours it could not seat after all.
       Three slots cannot give five colours one each, and a promise that
       quietly is not kept is worse than one that says where it ran out — the
       more so because the sentence below would otherwise be the *off* state's
       sentence, which reads as the honest split having chosen this. */
    unseated: dbBasicsOneEach() ? _dbBasicsNought(split, mana.pips) : [],
    nowhere: slots > 0 && placed === 0,
    /* More unmanaged basics than the whole budget: the number typed cannot be
       reached by anything this is allowed to touch. */
    over: budget < held.extra,
    deck:  { from: cards,             to: cards + moved },
    lands: { from: mana.lands.total,  to: mana.lands.total + moved },
    still: _dbBasicsStill(rows, mana.lands.total + moved),
  };
}

/* A colour the split rounds to nothing, in a deck where nothing else makes it.
 *
 * Two halves, and both are needed. Rounded to nothing is dbBasicsSplit()'s
 * answer, not the deck's current basics: a deck with four Forests whose split
 * comes back with none is about to lose its green, and the row moving from 4
 * to 0 is exactly the case worth catching. Nothing else makes it is
 * dbDeckMana()'s source count with the basics this manages taken back out of
 * it — a Forest is a green source and counting it here would have the flag
 * telling us green is fine right up until the write removes it.
 *
 * Scoped to the colours a split is allowed to place, so it and the toggle
 * agree: a deck with {C} pips and no Wastes is not flagged, because {C} sits
 * out of the split by a rule of its own and the toggle would not seat it
 * either. */
function _dbBasicsStarved(split, mana, managed) {
  return _dbBasicsNought(split, mana.pips)
    .filter(c => mana.sources[c.id] - managed[c.id] <= 0);
}

/** The colours the deck asks for that a split leaves with no basic at all. */
const _dbBasicsNought = (split, pips) => {
  const want = _dbBasicsWant(pips);
  return DB_MANA_COLORS.filter(c => want[c.id] > 0 && split[c.id] === 0);
};

/* The check, run over the deck this would make — which is the line the spec
 * says the preview exists for. The case worth catching is the one where the
 * split cost three spells and fixed nothing.
 *
 * It is arithmetic rather than a second walk over a hypothetical deck: a basic
 * makes exactly its own colour, so the sources after are the sources now plus
 * what each row moved by. The bars are re-read at the new land count, because
 * more lands is a different row of the table and a split that grows the deck
 * moves the goalposts it is being measured against. */
function _dbBasicsStill(rows, lands) {
  const mana  = dbDeckMana();
  const moved = dbManaZero();
  for (const r of rows) moved[r.id] = r.to - r.from;
  const bars = dbSourcesBars(dbSourcesDemands(dbDeckFormat().id, lands));
  return DB_MANA_COLORS
    .filter(c => bars[c.id])
    .map(c => ({ id: c.id, label: c.label,
                 gap: bars[c.id].want - (mana.fromLands[c.id] + moved[c.id]) }))
    .filter(c => c.gap > 0);
}

// ── The optimizer, drawn ──────────────────────────────────────────────────

/* The whole control. Not drawn at all on somebody else's deck: the check above
 * it and the cycles below are readings of a deck and this is an edit of one,
 * and a button that greys out is still a button that has to be explained. */
/* Public: the land base module draws this into the tab between the check and
 * the fix region, and asks whether it is there first — see the header. */
function dbBasicsHtml() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return '';
  const plan  = _dbBasicsBudget === null ? null : dbBasicsPlan(_dbBasicsBudget);
  /* The field holds the number a plan is up for, or — with no plan up — what
     the deck runs now, so that the default press means "re-balance the basics
     I already have" and changes the split without changing the deck's size. */
  const asked = _dbBasicsBudget === null ? _dbBasicsHeld().total : _dbBasicsBudget;
  return `<div class="db-basics">
    <div class="db-sources-hdr"><span class="db-sources-title">Optimize basics</span></div>
    <div class="db-basics-ask">
      <label class="db-basics-lbl" for="dbBasicsN">How many basics</label>
      <input id="dbBasicsN" class="db-basics-n" type="number" min="0" step="1"
             inputmode="numeric" value="${asked}"
             oninput="dbBasicsTyped()" onkeydown="if(event.key==='Enter')dbBasicsPress()">
      <button id="dbBasicsGo" class="db-basics-go" onclick="dbBasicsPress()">
        ${_dbBasicsReady(plan) ? 'Apply' : 'Preview'}</button>
    </div>
    ${_dbBasicsOneEachHtml()}
    <div id="dbBasicsPreview" class="db-basics-preview">${plan ? _dbBasicsPreviewHtml(plan) : ''}</div>
    <div class="db-sources-limit">${esc(
      'A total, not an addition — split across the colours by pips.')}</div>
  </div>`;
}

/* The override, on a line of its own under the row it modifies rather than
 * squeezed into it: the field and the button are one gesture with two steps,
 * and a third control between them would read as part of the sentence they
 * make. The label points at the box with `for` rather than wrapping it, which
 * is how the drawer's other checkbox gets to a finger's worth of tap target
 * without the box itself having to be finger-sized. */
function _dbBasicsOneEachHtml() {
  const on = dbBasicsOneEach();
  return `<span class="db-basics-one-each">
    <input type="checkbox" id="dbBasicsEachBox"${on ? ' checked' : ''}
           onchange="dbSetBasicsOneEach(this.checked)">
    <label for="dbBasicsEachBox">${esc('At least 1 basic of every colour')}</label>
  </span>`;
}

/* Whether the next press is the one that writes.
 *
 * Three things have to hold, and the two beyond "something would change" are
 * both the same hazard: this must not write a plan made against a deck it
 * cannot see. A budget with nowhere to go moves every basic to nought, which
 * is a preview saying "there is nowhere to put these" over a button that
 * empties the deck; a deck with cards still in flight is one whose basics this
 * has not finished counting. Both are drawn, and neither is pressable. */
const _dbBasicsReady = plan =>
  !!plan && plan.changed.length > 0 && !plan.nowhere && !plan.blind.length;

/* What it would do, before it does it: the rows, the resulting deck size and
 * land total, and what the check would still say. The size line is there
 * because growing the basics means other cards have to go, and the verdict
 * line because a split that cost three spells and fixed nothing is the failure
 * worth seeing before the press rather than after. */
function _dbBasicsPreviewHtml(plan) {
  const rows = plan.rows.map(r => `<div class="db-basics-row${r.to === r.from ? ' db-basics-same' : ''}">
    ${dbSourcesSym(r)}
    <span class="db-basics-card">${esc(r.name)}</span>
    <span class="db-basics-fig">${r.from} → <strong>${r.to}</strong></span>
  </div>`).join('');

  const size = `<div class="db-basics-size">deck ${plan.deck.from} → <strong>${plan.deck.to}</strong>
    · lands ${plan.lands.from} → <strong>${plan.lands.to}</strong></div>`;

  return `${_dbBasicsBlindHtml(plan)}${_dbBasicsSpareHtml(plan)}${rows}` +
         `${plan.rows.length ? size : ''}${_dbBasicsUnseatedHtml(plan)}` +
         `${_dbBasicsStarvedHtml(plan)}${_dbBasicsStillHtml(plan)}`;
}

/* What the app has not read yet, named the way the check names it — because a
 * deck reported as wanting no white while eleven of its cards are still in
 * flight is the one kind of wrong a mana base cannot survive, and any of those
 * eleven could be a basic this budget has not counted. */
function _dbBasicsBlindHtml(plan) {
  const n = plan.blind.length;
  if (!n) return '';
  return `<div class="db-basics-verdict">${esc(
    dbBlindSentence(plan.blind,
      `${n === 1 ? 'it' : 'any of them'} could be a basic this has not counted`) +
    ` Nothing is written until ${n === 1 ? 'it arrives' : 'they arrive'}.`)}</div>`;
}

/* The basics that came off the budget, named. We are not adding snow support;
 * we are making the edge case visible to the person who has to fix it by
 * hand, which is the whole of what this line is for. */
function _dbBasicsSpareHtml(plan) {
  if (!plan.spare.length) return '';
  const named = plan.spare.map(s => `${s.qty} ${_dbBasicsPlural(s.name, s.qty)}`).join(' and ');
  const tail  = plan.over
    ? `that is already more than ${plan.budget}, so there is nothing left to split`
    : `${plan.slots} to split`;
  return `<div class="db-basics-spare">${esc(`${named} aren’t touched — ${tail}`)}</div>`;
}

/** A card name, more than once. Enough English for six land names. */
const _dbBasicsPlural = (name, n) =>
  n === 1 || /s$/i.test(name) ? name : `${name}s`;

/* Where the override was asked for and could not be given: a budget smaller
 * than the number of colours in the deck. Said before the line below it
 * because it is the reason for it — a colour at nought under a ticked box is
 * not the proportional split having chosen that, and being told it in the
 * split's own words would be the switch failing quietly. */
function _dbBasicsUnseatedHtml(plan) {
  if (plan.nowhere || !plan.unseated.length) return '';
  const names = plan.unseated.map(c => c.label).join(' and ');
  return `<div class="db-basics-verdict">${esc(
    `a budget of ${plan.slots} cannot give every colour one — ` +
    `${names} ${plan.unseated.length === 1 ? 'goes' : 'go'} without`)}</div>`;
}

/* A colour that rounds to nothing in a deck where nothing else makes it,
 * named before the shortfalls below it — being unable to cast a colour at all
 * is a different order of finding from being four sources light of a bar, and
 * it is the one the toggle above fixes. Not a warning against pressing:
 * plenty of decks mean it, and the deck that does not now knows to say so. */
function _dbBasicsStarvedHtml(plan) {
  if (plan.nowhere || !plan.starved.length) return '';
  return plan.starved.map(c => `<div class="db-basics-verdict">${esc(
    `${c.label} rounded to 0 basics, and nothing else in the deck makes ${c.label}`)}</div>`).join('');
}

/* What the check would still say, which is the reason the preview is worth
 * reading rather than a formality on the way to the button. Named as a land
 * rather than a basic, because that is what the answer is: a colour the split
 * cannot reach needs a dual, and the fix region underneath lists them. */
function _dbBasicsStillHtml(plan) {
  if (plan.nowhere) {
    return `<div class="db-basics-verdict">${esc(
      'Nothing in the deck asks for a colour yet, so there is nowhere to put these.')}</div>`;
  }
  if (!plan.rows.length) return '';
  if (!plan.still.length) {
    return `<div class="db-basics-verdict db-basics-clear">${esc('every colour clears its bar')}</div>`;
  }
  const short = plan.still.map(c => `${c.label} ${c.gap}`).join(', ');
  return `<div class="db-basics-verdict">${esc(
    `still short: ${short} — ` +
    `${plan.still.length === 1 ? 'a land, not a basic' : 'lands, not basics'}`)}</div>`;
}

// ── The two presses ───────────────────────────────────────────────────────

/** The number in the field, read the way a budget has to be read. */
function _dbBasicsAsked() {
  const raw = String(document.getElementById('dbBasicsN')?.value ?? '').trim();
  const n   = Math.round(Number(raw));
  /* Emptied out is the prefill again, not nought. A field somebody has just
     cleared to type a new number into is not an instruction to throw every
     basic out of the deck. */
  return raw === '' || !Number.isFinite(n) ? _dbBasicsHeld().total : Math.max(0, n);
}

/* The button. Which press this is is decided by the state rather than by a
 * mode: a plan is on screen for this number, or it is not. Typing a different
 * number takes the plan down, so "press twice" cannot mean "press once, change
 * your mind, and write the first answer". */
async function dbBasicsPress() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  const asked = _dbBasicsAsked();
  if (_dbBasicsBudget === asked && _dbBasicsReady(dbBasicsPlan(asked))) return dbBasicsApply();

  /* The press that draws a preview is also the one that goes and fetches
     whatever the app is still missing, so that refusing to write against a
     half-read deck is a wait rather than a dead end: press once and the facts
     are asked for, press again and the plan is against a deck it can see all
     of. */
  const deckId = dbDeck.id;
  const blind  = dbDeckMana().unknown;
  if (blind.length) {
    await dbFetchCardData(blind);
    if (!dbDeck || dbDeck.id !== deckId || !isMyPlayer(dbDeck.playerId)) return;
  }
  /* Read again on this side of the await: an empty field means the deck's own
     count, and that count is one of the things the facts just changed. */
  _dbBasicsBudget = _dbBasicsAsked();
  dbRenderLands();
}

/* Drop the plan in flight, without drawing anything. Public: the land base
 * module calls this when the deck on the mat changes, because a plan is a plan
 * for one deck and an Apply button offering to write a split read off a deck
 * that has gone is worse than no button. It draws nothing because the caller
 * is already on its way to redrawing the whole tab. */
function dbBasicsForgetPlan() {
  _dbBasicsBudget = null;
}

/* The field, typed in. The plan goes, because it is a plan for a number that
 * is no longer the one being asked for — and it goes without redrawing the
 * tab, because a redraw would take the field out from under the cursor
 * mid-number. */
function dbBasicsTyped() {
  if (_dbBasicsBudget === null) return;
  _dbBasicsBudget = null;
  _dbBasicsRepaint();
}

/* The preview and the button, redrawn off the state without redrawing the tab
 * around them. Two elements, patched by hand, because they are the two the
 * state decides and a full redraw would move the field being typed into. With
 * no plan up this draws the empty preview and the first press, which is what
 * dbBasicsTyped() wants; with one up it re-splits, which is what the toggle
 * does. */
function _dbBasicsRepaint() {
  const plan = _dbBasicsBudget === null ? null : dbBasicsPlan(_dbBasicsBudget);
  const box  = document.getElementById('dbBasicsPreview');
  const go   = document.getElementById('dbBasicsGo');
  if (box) box.innerHTML = plan ? _dbBasicsPreviewHtml(plan) : '';
  if (go)  go.textContent = _dbBasicsReady(plan) ? 'Apply' : 'Preview';
}

/* The write. Quantities set on the rows the deck already has, not a loop of
 * dbAddCard() — that adds one copy at a time, is async, re-fetches card data
 * and re-renders on each of them. Setting quantities is what preserves a
 * Plains somebody filed under a custom "Mana Base", lets a colour going to
 * nought be properly removed instead of clamped at one by dbChangeQty(), and
 * makes the whole change one render and one save rather than fifteen.
 *
 * This is a second write path into dbCards, so it owes the hooks the edit
 * module calls — the snapshot in front of it, and dbRenderStats() behind it,
 * which is where dbManaChanged() lives and therefore where the check above
 * this control stops being a reading of the deck as it was. */
async function dbBasicsApply() {
  if (!dbDeck || !isMyPlayer(dbDeck.playerId)) return;
  const deckId = dbDeck.id;

  /* The facts first, for any basic the deck has never held: dbAutoCategory()
     reads the type line, and a Plains categorised before Scryfall said it was
     a land would be filed under "Other" for good. */
  const fresh = dbBasicsPlan(_dbBasicsAsked()).rows
    .filter(r => r.to > 0 && !dbFindCard(dbPlace(DB_MAIN_BOARD, r.name)) && !dbCardData.has(r.name))
    .map(r => r.name);
  if (fresh.length) await dbFetchCardData(fresh);
  if (!dbDeck || dbDeck.id !== deckId || !isMyPlayer(dbDeck.playerId)) return;

  /* Worked out again on this side of the await, against the deck as it stands
     now. Everything the preview showed is a function of the deck and the
     budget, and the deck is the half that can have moved. */
  const plan = dbBasicsPlan(_dbBasicsAsked());
  if (!_dbBasicsReady(plan)) return;

  dbForceSnapshot('basics');

  for (const r of plan.rows) {
    const ref  = dbPlace(DB_MAIN_BOARD, r.name);
    const card = dbFindCard(ref);
    if (r.to === 0) {
      if (card) { dbCards = dbCards.filter(c => c !== card); dbSelectedCards.delete(ref); }
      continue;
    }
    if (card) { card.qty = r.to; continue; }
    const cat = dbAutoCategory(r.name);
    dbEnsureCat(cat);
    dbCards.push({ card_name: r.name, qty: r.to, category: cat,
                   board: DB_MAIN_BOARD, position: dbCards.length });
  }

  _dbBasicsBudget = null;
  dbRender();
  dbRenderStats();
  dbScheduleSave();
}
