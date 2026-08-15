// ── What a tab is for, said once ──────────────────────────────────────────
// Every tab in this app is discoverable by poking at it, which is another way
// of saying that none of them says what it is for. The mat you can drag a card
// onto empty felt to make a pile with is real, and it is announced nowhere.
// This is the note that says so: it opens itself the first time you arrive on
// a tab, says what the tab is and which keys it answers to, and then never
// appears again.
//
// A dialog rather than a panel at the top of the pane, which would have been
// gentler. A note nobody reads is worse than a note that interrupts once, and
// the cost is held down by the "once" being once per tab *for ever, across
// devices* — dismissed on the desktop is dismissed on a phone you have never
// signed in on, and there are four ways to dismiss each one.
//
// Nothing in this file knows which tabs exist. FAQ below is the only place
// that decides, and everything downstream — what opens, what is drawn, and
// which tabs grow the `?` button that opens it again — reads it rather than
// keeping a second list. Two hand-kept lists drift, and the failure is silent
// both ways round: a button for a tab with no note, or a note with no way back.

/* The notes. `points` are the things you would otherwise have to discover by
 * poking, not a description of what is already on the screen, and `keys` are
 * the ones particular to this tab — the ones every note shares are appended by
 * the renderer, below, so they are said once and cannot come to be described
 * differently on two tabs.
 *
 * The other six tabs are ticket 05. The ids are mirrored in FAQ_TABS in
 * js/state.js and in routes/prefs.js, the way THEMES is, because a page script
 * has no module boundary to import across; test/faq.test.js asserts this
 * object against both. */
const FAQ = {
  deckview: {
    title:  'Deck Builder',
    blurb:  'Your deck as cards on a mat, seen from above.',
    points: [
      'Drag a card onto empty mat to start a new pile — the pile is the category.',
      'Point at a card in a spread pile and the cards lying on it move aside.',
      'Right-click a card for its menu: inspect, move, change printing, remove.',
      'The filter field reads the same query language as the Collections search.',
    ],
    keys: [
      ['f', 'turn the card under the pointer over'],
      ['c', 'fold the controls away, a tier at a time'],
      ['m', 'the menu beside the mat'],
      ['/', 'search for a card to add'],
    ],
  },
};

/* True of every note, so written on none of them. */
const FAQ_SHARED_KEYS = [
  ['?', 'open this note again'],
  ['Escape', 'close this note'],
];

// ── What is on the screen ─────────────────────────────────────────────────
/* Which tab's note is open, or none. The dialog is one element reused by all
 * seven, so this is what says whose it is — and it is what a dismissal reads
 * to know which tab it has just marked as read. */
let _faqShowing = null;

/* A tab you arrived at before the answer came back, and whether it has.
 *
 * Whether you have read a note arrives from /api/prefs, and that is a fetch;
 * the first tab is on the screen long before it lands. A note that asked the
 * empty set it starts as would be told "not read" every single time, and would
 * re-open on every reload something you dismissed last week. So a tab arrived
 * at before the answer is held here and the answer is what opens it.
 *
 * One tab and not a queue: if you have switched tabs twice while the fetch was
 * in flight, the note that matters is the one for the tab you are looking at
 * now, and the ones you passed through are not notes you asked for. */
let _faqPending  = null;
let _faqAnswered = false;

/* The tab you are on, which is whose note `?` reopens. Recorded by the arrival
 * hook below rather than asked of main.js, because that hook is called for
 * every tab — including the four that have no note — so this is the same
 * answer the auto-open is judged against and the two cannot come to disagree
 * about where you are. */
let _faqTab = null;

// ── Drawing one ───────────────────────────────────────────────────────────

/* The note, as HTML. Everything in it comes from the entry except the shared
 * keys, which are appended rather than repeated seven times. */
function faqHtml(note) {
  const keys = [...(note.keys || []), ...FAQ_SHARED_KEYS];
  return `
    <h2 class="faq-title" id="faqTitle">${esc(note.title)}</h2>
    <p class="faq-blurb">${esc(note.blurb)}</p>
    <ul class="faq-points">${
      note.points.map(p => `<li>${esc(p)}</li>`).join('')
    }</ul>
    <h3 class="faq-keys-title">Keys</h3>
    <dl class="faq-keys">${
      keys.map(([key, what]) => `<dt><kbd>${esc(key)}</kbd></dt><dd>${esc(what)}</dd>`).join('')
    }</dl>`;
}

function openFaq(tab) {
  const note    = FAQ[tab];
  const overlay = document.getElementById('faqModal');
  const body    = document.getElementById('faqBody');
  if (!note || !overlay || !body) return;
  body.innerHTML = faqHtml(note);
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  _faqShowing = tab;
  /* Focus lands on Got it, which is deliberately the opposite of what
     openDrawer() does. A drawer focuses its first field because opening a
     drawer in order to dismiss it is not the task; here dismissing is
     precisely the task. */
  document.getElementById('faqGotIt')?.focus();
}

function closeFaq() {
  const overlay = document.getElementById('faqModal');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  _faqShowing = null;
}

/* Whether a note is over the page. Asked by js/cardturn.js, which must not
 * turn a card over from behind it: the note is a dialog about the tab and one
 * of the things it says is that `f` turns the card under the pointer over, so
 * a press while you are reading that sentence belongs to the note. One
 * predicate rather than a second file reading the overlay's display, which is
 * a second place for "open" to be decided. */
function faqIsOpen() { return _faqShowing !== null; }

/* Read, by any of the four ways of saying so.
 *
 * The set is marked before the write goes out — saveFaqSeen() adds the tab
 * locally and mirrors it into this browser first — so a server that will not
 * take it costs you the note on your next device rather than a second dialog
 * in this session. That order is state.js's and this is its one caller for the
 * note: writing prefs.faqSeen here instead would be a second path, and the two
 * would disagree about what this browser has seen. */
function faqDismiss() {
  const tab = _faqShowing;
  closeFaq();
  if (tab) saveFaqSeen(tab);
}

/* Asked for rather than owed: `?`, or the `?` on the tab's strip.
 *
 * It closes the same way it opened itself, through faqDismiss(), so a note
 * looked up is a note read — and reading it again cannot un-read it, because
 * saveFaqSeen() has nothing to add to a set the tab is already in. A tab you
 * have dismissed stays dismissed however many times you come back to look
 * something up, which is what the button is for. */
function faqToggle(tab) {
  if (_faqShowing) faqDismiss();
  else openFaq(tab);
}

// ── When it opens ─────────────────────────────────────────────────────────

/* You arrived on a tab. The one hook this feature has into the app's own flow,
 * called from setTab() — which every arrival goes through, including the one
 * that restores a deep link on load, so landing on a tab is the same case as
 * switching to it. */
function faqOnTab(tab) {
  _faqTab = tab;
  if (!FAQ[tab]) return;
  if (!_faqAnswered) { _faqPending = tab; return; }
  if (prefs.faqSeen.includes(tab)) return;
  openFaq(tab);
}

/* The answer arrived. Called from syncPrefs() after syncFaqSeen(), which is
 * what decides whether the record is the account's or — in open mode, where
 * there is nobody to hang it on — this browser's.
 *
 * The pending tab is taken rather than read, so an answer that arrives twice
 * does not open the same note twice, and it is put back through faqOnTab()
 * rather than opened here: the set is judged at this moment and not at the one
 * the tab was recorded in, which is the whole reason the question was
 * postponed. */
function faqPrefsArrived() {
  _faqAnswered = true;
  const tab = _faqPending;
  _faqPending = null;
  if (tab) faqOnTab(tab);
}

// ── The way back to it ────────────────────────────────────────────────────

/* A `?` on the control strip of every tab that has a note, and on no other.
 *
 * Mounted by walking the registry rather than written into index.html seven
 * times, which is the same decision as everything else downstream of FAQ and
 * for the same reason: two hand-kept lists drift, and this one would fail
 * silently in both directions — a button that opens nothing, or a note with no
 * way back at all on a phone, where there is no keyboard to press `?` on.
 *
 * The strip is the row six of the seven panes already have. test/faq.test.js
 * asserts every tab in the registry has one, so a note added to a pane with no
 * strip fails there rather than quietly losing its button here. */
function faqMountButtons() {
  for (const tab of Object.keys(FAQ)) {
    const strip = document.querySelector(`#tab-${tab} .toolbar`);
    if (!strip) continue;
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'btn-secondary faq-btn';
    btn.id        = `faqBtn-${tab}`;
    btn.textContent = '?';
    /* A glyph on its own says nothing, and the label is also where the key is
       written down for somebody who has not opened the note — the same job the
       fold button's title does for `c`. */
    btn.title = 'What this tab is for (?)';
    btn.setAttribute('aria-label', 'What this tab is for');
    btn.addEventListener('click', () => faqToggle(tab));
    strip.appendChild(btn);
  }
}

/* Where a character is a character rather than a key. Typing `?` into a
 * Scryfall query has to search for it, which is the same rule — and, for now,
 * the same three tag names and the same question about contenteditable — that
 * js/cardturn.js applies to `f`. */
function faqTyping(target) {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)
    || !!target?.isContentEditable;
}

// ── The dialog's own controls ─────────────────────────────────────────────
/* Bound once. The #faqModal markup sits after the <script> tags in
 * index.html, the way #cardModal does, so this waits for the parse. */
function initFaq() {
  const overlay = document.getElementById('faqModal');
  if (!overlay) return;
  faqMountButtons();

  document.getElementById('faqClose')?.addEventListener('click', faqDismiss);
  document.getElementById('faqGotIt')?.addEventListener('click', faqDismiss);

  /* A click outside the box. The overlay is the padding around the note and
     nothing else, so a click that lands on it is a click that missed — no
     separate backdrop element is needed to catch it. */
  overlay.addEventListener('click', e => { if (e.target === overlay) faqDismiss(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (_faqShowing) faqDismiss(); return; }
    /* The character the key produced rather than the key itself, so a layout
       that does not put ? on Shift+/ still reaches this. */
    if (e.key !== '?') return;
    /* And bare: a letter or a punctuation mark with something held down is the
       browser's, the way Ctrl+F is find. */
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (faqTyping(e.target)) return;
    /* A tab with no note has none to open — but one that is open closes on ?
       wherever it was opened from, so the toggle is asked before the tab is. */
    if (!_faqShowing && !FAQ[_faqTab]) return;
    e.preventDefault();
    faqToggle(_faqTab);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFaq);
else initFaq();
