/* Turning a card over from the keyboard: the decisions inside one key.
 *
 * The turn itself is not asserted here — test/motion.test.js has the switch it
 * obeys and the eye has what a turning card looks like. What is asserted is
 * everything the key decides before it gets there: which card it acts on, when
 * it refuses, and that what it finally does is the card's own control being
 * pressed rather than a second way to turn a card over. That last one is the
 * whole point of the ticket, so it is asserted twice — once by comparing the
 * key against a click on the same card, and once by reading the key's own
 * source for the class and src writes it is not allowed to make.
 *
 * The shipped public/js/cardturn.js is run against stub browser globals, the
 * way test/cardlift.test.js runs the lift, so these assert on the code the
 * browser is served rather than on a copy of it. The document it is given is a
 * stub too: `:hover` is a question only a browser with a pointer in it can
 * answer, so what is checked is that the question is asked — live, of the
 * document, on every press — and what is done with the answer.
 */

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const SOURCE = read('public/js/cardturn.js');

// ── A card, as much of one as the turn touches ────────────────────────

/** classList, to the four calls the turn makes of it. */
function classList(...initial) {
  const set = new Set(initial);
  return {
    add:      (...names) => names.forEach(n => set.add(n)),
    remove:   (...names) => names.forEach(n => set.delete(n)),
    contains: name => set.has(name),
    toggle:   (name, on) => {
      const want = on === undefined ? !set.has(name) : on;
      if (want) set.add(name); else set.delete(name);
      return want;
    },
    /** Sorted, so two cards' states can be compared as values. */
    names: () => [...set].sort(),
  };
}

/** A double-faced card as the app draws it: a picture and the control that
 *  turns it, inside the wrapper cardTurnableHtml() puts them in. The
 *  animations are hand-run — nothing here has a compositor — so a turn can be
 *  watched at its halfway point, which is where the swap is. */
function turnableCard({ front = 'front.jpg', back = 'back.jpg', turning = false } = {}) {
  const ends = [];
  const img = {
    src: front,
    dataset: {},
    classList: classList(...(turning ? ['card-turning-away'] : [])),
    getAttribute: name => (name === 'src' ? img.src : null),
    addEventListener: (type, fn) => { if (type === 'animationend') ends.push(fn); },
    parentElement: { classList: classList() },
  };
  const button = {
    dataset: { turn: back },
    attributes: {},
    setAttribute: (name, value) => { button.attributes[name] = value; },
    closest: sel => (sel === '.card-turnable' ? wrapper : null),
  };
  const wrapper = {
    querySelector: sel => (sel === 'img.card-img' ? img : null),
  };
  return {
    img, button, wrapper,
    /** One half of the turn finishing. */
    finishHalf: () => ends.shift()?.(),
    /** Both halves, for a card watched from one side to the other. */
    finishTurn() { this.finishHalf(); this.finishHalf(); },
    /** Everything about the card the turn is allowed to have changed. */
    state: () => ({
      src: img.src,
      front: img.dataset.cardFront,
      classes: img.classList.names(),
      host: img.parentElement.classList.names(),
      pressed: button.attributes['aria-pressed'],
    }),
  };
}

// ── The app, with a pointer we can put where we like ──────────────────

function loadCardTurn() {
  /* What the stub document answers with. `hovered` is the control on the card
   * the pointer is over — null both for a card with one face, which is never
   * wrapped and so cannot match, and for a pointer over no card at all. */
  const at = { hovered: null, detail: null };
  const asked = [];
  const listeners = {};

  const overlay = {
    style: { display: 'none' },
    querySelector: () => at.detail,
  };

  const sandbox = {
    document: {
      addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
      querySelector: sel => { asked.push(sel); return sel.includes(':hover') ? at.hovered : null; },
      getElementById: id => (id === 'cardModal' ? overlay : null),
    },
    /* Motion is on unless a test unticks it, which is the app's default and
     * the harder path: the turn then runs in halves and has a middle. */
    cardMotionOn: () => sandbox.motion,
    motion: true,
    /* The tab's note, over the page or not. js/faq.js's own predicate, stubbed
     * the way the motion switch is: what this file asserts is that the key
     * asks it, not how the note decides — test/faq.test.js has that half. */
    faqIsOpen: () => sandbox.noteOpen,
    noteOpen: false,
    Image: function Image() {},
    esc: s => String(s),
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);

  const fire = (type, event) => {
    const seen = { prevented: false, ...event };
    seen.preventDefault = () => { seen.prevented = true; };
    (listeners[type] || []).forEach(fn => fn(seen));
    return seen.prevented;
  };

  return {
    at, asked, sandbox,
    evaluate: expr => vm.runInContext(expr, sandbox),
    /** The pointer is over this card, or over none at all. */
    point: card => { at.hovered = card ? card.button : null; },
    /** The card detail is open in its dialog, showing this card. */
    openDetail: card => {
      overlay.style.display = card ? 'flex' : 'none';
      at.detail = card ? card.button : null;
    },
    /** A press of a key. The target defaults to the page itself, which is
     *  where a press lands when nothing has the focus. */
    press: (key, { target = { tagName: 'BODY' }, ...rest } = {}) =>
      fire('keydown', { key, target, ...rest }),
    /** The same turn asked for with the pointer, which is the control this
     *  key exists to press. */
    click: card => fire('click', { target: { closest: sel => (sel === '.card-turn' ? card.button : null) } }),
  };
}

// ── The card it acts on ───────────────────────────────────────────────

test('the card under the pointer turns over, and turns back', () => {
  const app  = loadCardTurn();
  const card = turnableCard();
  app.point(card);

  app.press('f');
  card.finishTurn();
  assert.strictEqual(card.state().src, 'back.jpg', 'it went over');

  app.press('f');
  card.finishTurn();
  assert.strictEqual(card.state().src, 'front.jpg', 'and the same key brought it back');
});

test('the pointer is asked about live, on every press', () => {
  // Not tracked from pointermove and not read off the held card: the document
  // already knows where the pointer is, and asking it is what makes this key
  // work in every view that draws the control — the two grids, the fanned
  // piles, the set browser, the card detail — and in the seventh one drawn
  // next year, without a list of views anywhere.
  const app = loadCardTurn();
  app.point(turnableCard());

  app.press('f');
  app.press('f');
  const hovers = app.asked.filter(sel => sel.includes(':hover'));
  assert.strictEqual(hovers.length, 2, 'each press asked the document afresh');
  assert.match(hovers[0], /\.card-turnable:hover/,
    'and asked it about the card the pointer is on');
});

test('a card with one face does not respond, and neither does empty space', () => {
  // Neither is a case this file knows about: a one-faced card is drawn with no
  // wrapper and no control, so the selector finds nothing — the same nothing a
  // pointer over the mat finds. There is no list of layouts here, and there is
  // nothing to keep in step with the one in js/scryfall.js.
  const app = loadCardTurn();
  app.point(null);
  assert.strictEqual(app.press('f'), false,
    'the press was left to the page rather than swallowed');
});

test('with the pointer over nothing, the card open in the dialog turns', () => {
  // The one place a card is on the screen without being under the pointer:
  // you opened it to read it, and the pointer is off in the text.
  const app  = loadCardTurn();
  const card = turnableCard();
  app.openDetail(card);
  app.point(null);

  app.press('f');
  card.finishTurn();
  assert.strictEqual(card.state().src, 'back.jpg');
});

test('a card under the pointer beats the one in the dialog', () => {
  // Both can be true at once — the dialog draws cards you can point at — and
  // the one you are pointing at is the one you mean.
  const app     = loadCardTurn();
  const pointed = turnableCard({ front: 'pointed-front.jpg', back: 'pointed-back.jpg' });
  const opened  = turnableCard();
  app.openDetail(opened);
  app.point(pointed);

  app.press('f');
  pointed.finishTurn();
  opened.finishTurn();
  assert.strictEqual(pointed.state().src, 'pointed-back.jpg');
  assert.strictEqual(opened.state().src, 'front.jpg', 'the card in the dialog was left alone');
});

test('a closed dialog is not a card to turn', () => {
  const app  = loadCardTurn();
  const card = turnableCard();
  app.openDetail(card);
  app.openDetail(null);   // and the card is still in the markup behind it
  app.point(null);
  assert.strictEqual(app.press('f'), false);
});

// ── That it is the card's own turn ────────────────────────────────────

test('the key does exactly what pressing the control does', () => {
  // The whole of the ticket. Two identical cards, one turned by the key and
  // one by the pointer, compared at the halfway point of the turn and again
  // when it lands: same movement, same swap at the edge, same face at rest.
  // A second path that knew how to turn a card over would be a second place
  // for "what has a back", "what if motion is off" and "what about a turn
  // already running" to be answered differently.
  const app  = loadCardTurn();
  const keyed   = turnableCard();
  const clicked = turnableCard();

  app.point(keyed);
  app.press('f');
  app.click(clicked);
  assert.deepStrictEqual(keyed.state(), clicked.state(), 'the same first half');

  keyed.finishHalf(); clicked.finishHalf();
  assert.deepStrictEqual(keyed.state(), clicked.state(), 'the same swap, at the same moment');

  keyed.finishHalf(); clicked.finishHalf();
  assert.deepStrictEqual(keyed.state(), clicked.state(), 'and the same card at rest');
});

test('with "Cards move" unticked the face swaps and nothing turns', () => {
  // Inherited rather than re-decided: a switch about animation must not cost
  // anybody the other side of a card, and the key never learns that rule.
  const app  = loadCardTurn();
  const card = turnableCard();
  app.sandbox.motion = false;
  app.point(card);

  app.press('f');
  assert.strictEqual(card.state().src, 'back.jpg', 'it is showing its back already');
  assert.deepStrictEqual(card.state().classes, ['card-turned'],
    'and no half of a turn was ever drawn');
});

test('a turn already under way is left alone rather than raced', () => {
  // Two turns racing swap the picture twice and land the card on the side it
  // started on, which is a card that ignored you rather than one that turned
  // twice. Also inherited: the key holds down `f` and this is what answers.
  const app  = loadCardTurn();
  const card = turnableCard({ turning: true });
  app.point(card);

  app.press('f');
  assert.strictEqual(card.state().src, 'front.jpg', 'the turn in flight kept the card');
});

test('the key writes no picture and no class of its own', () => {
  // Read off the delivered file, because the two tests above would still pass
  // if the key reached the same end by its own means, and the point is that
  // there is one turn in this app rather than two that agree today.
  const key = SOURCE.slice(SOURCE.indexOf("'keydown'"));
  assert.match(key, /turnCard\(/, 'it presses the control');
  assert.doesNotMatch(key, /\.src\s*=/,   'rather than swapping the picture itself');
  assert.doesNotMatch(key, /classList/,   'or drawing the turn itself');
});

test('the control the key presses is still a button on the card', () => {
  // Nothing becomes keyboard-only. The key is an accelerator for something
  // already on the screen, already clickable and already in the tab order —
  // and nothing becomes pointer-only either, which is the other half of it.
  const app  = loadCardTurn();
  const html = app.evaluate(`cardTurnHtml('back.jpg')`);
  assert.match(html, /<button/, 'it is a button');
  assert.doesNotMatch(html, /tabindex/,    'no tab order of its own to fall out of');
  assert.doesNotMatch(html, /aria-hidden/, 'and not hidden from anybody');
});

// ── When it refuses ───────────────────────────────────────────────────

test('the key is ignored while a field has the press', () => {
  // Typing "goblin" into the Deck Builder's filter must filter for goblins,
  // not turn over the card on the mat behind it.
  const app  = loadCardTurn();
  const card = turnableCard();
  app.point(card);

  for (const target of [
    { tagName: 'INPUT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
  ]) {
    assert.strictEqual(app.press('f', { target }), false,
      `${target.tagName} kept the f`);
    assert.strictEqual(card.state().src, 'front.jpg');
  }
});

test('and while the tab\'s note is open over the page', () => {
  /* The note is a dialog about the tab, and one of the things it says is that
   * f turns the card under the pointer over. A press while somebody is reading
   * that sentence belongs to the note — including over the card detail, which
   * the note is drawn on top of and which the pointer need not be on for the
   * card there to be the one this key would otherwise take. */
  const app  = loadCardTurn();
  const card = turnableCard();
  app.point(card);
  app.sandbox.noteOpen = true;

  assert.strictEqual(app.press('f'), false, 'the note let the press through to the mat');
  assert.strictEqual(card.state().src, 'front.jpg');

  app.openDetail(turnableCard());
  app.point(null);
  assert.strictEqual(app.press('f'), false, 'and through to the card underneath it');

  app.sandbox.noteOpen = false;
  app.point(card);
  app.press('f');
  card.finishTurn();
  assert.strictEqual(card.state().src, 'back.jpg', 'and kept it after it was closed');
});

test('a key with a modifier on it belongs to the browser', () => {
  // Ctrl+F is find and Cmd+F is find. A card under the pointer must not cost
  // anybody the browser's own keyboard.
  const app  = loadCardTurn();
  const card = turnableCard();
  app.point(card);

  for (const held of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    assert.strictEqual(app.press('f', held), false, `${Object.keys(held)[0]} was swallowed`);
    assert.strictEqual(card.state().src, 'front.jpg');
  }
});

test('the key is the character, not the place on the keyboard', () => {
  // A layout where f is somewhere else still reaches it, and the physical F
  // key of a layout that puts something else there does not.
  const app  = loadCardTurn();
  const card = turnableCard();
  app.point(card);

  app.press('f', { code: 'KeyT' });
  card.finishTurn();
  assert.strictEqual(card.state().src, 'back.jpg', 'the character is what was matched');

  assert.strictEqual(app.press('ø', { code: 'KeyF' }), false,
    'and the key in f\'s usual place is not f');
});

test('a press that turns a card is the card\'s, and one that does not is the page\'s', () => {
  const app  = loadCardTurn();
  const card = turnableCard();
  app.point(card);
  assert.strictEqual(app.press('f'), true, 'the turn took the press');
  app.point(null);
  assert.strictEqual(app.press('f'), false, 'and nothing else was taken from anybody');
});

// ── The one key, everywhere ───────────────────────────────────────────

test('nothing else in the app answers to f', () => {
  // The Deck Builder used to fold its chrome on `f`, which is the tab this key
  // is most useful on: pointing at a card on the mat would have turned it over
  // *and* folded the frame away from under it. The fold moved to `c`; this is
  // what stops it, or anything else, from coming back to f.
  const answers = fs.readdirSync(path.join(ROOT, 'public/js'))
    .filter(file => file.endsWith('.js') && file !== 'cardturn.js')
    .filter(file => /key\s*===\s*'f'/i.test(read(`public/js/${file}`)));
  assert.deepStrictEqual(answers, [], 'these files also answer to f');
});

test('the Deck Builder still folds its chrome from the keyboard', () => {
  // Moved rather than dropped: the fold is the tab's own key and every control
  // it hides is one press from being back.
  const deckview = read('public/js/deckview-core.js');
  assert.match(deckview, /key === 'c' \|\| e\.key === 'C'/, 'c folds the chrome');
  assert.match(deckview, /dbFoldChrome\(\)/);
});

test('the fold button names the key that does the same thing', () => {
  // The button is the only place the fold's key is written down for somebody
  // who has not read the FAQ note, so a label still offering `f` would be the
  // app teaching the wrong key — and teaching it in the one place you look
  // when you are hunting for the right one.
  const deckview = read('public/js/deckview-core.js');
  const labels = deckview.slice(deckview.indexOf('const DB_FOLD_LABELS'),
                                deckview.indexOf('const DB_FOLD_LABELS') + 300);
  assert.doesNotMatch(labels, /\(f\)/, 'the labels no longer offer f');
  assert.match(labels, /\(c\)/, 'and offer the key that folds');
});

test('the Deck Builder\'s keys leave the browser\'s own alone', () => {
  // Ctrl+C is copy and Ctrl+F is find, on a tab whose keys are bare letters —
  // so a letter with something held down has to fall through rather than be
  // taken. The tab has answered to letters since long before the fold moved
  // onto one of the two the browser cares about; what makes this worth
  // asserting is that `c` is now one of them.
  const deckview = read('public/js/deckview-core.js');
  const block = deckview.slice(deckview.indexOf('// Keyboard shortcuts'),
                               deckview.indexOf('_dbInitDone = true'));
  const letters = (block.match(/if \(.*e\.key === '[a-zA-Z]'.*\) \{/g) || []);
  assert.ok(letters.length >= 2, 'the tab still answers to letters');
  for (const branch of letters) {
    assert.match(branch, /bare/,
      `${branch.trim()} takes its letter whatever is held down with it`);
  }
  assert.match(block, /bare = !e\.ctrlKey && !e\.metaKey && !e\.altKey/,
    'and what a bare letter is is said once');
});
