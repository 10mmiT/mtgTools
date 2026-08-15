/* What a tab is for, said once.
 *
 * The note is a dialog that opens itself the first time you arrive on a tab
 * and then never again, on that device or any other you sign in on. Three
 * decisions are worth asserting and the looks are not:
 *
 *   the registry   one object says which tabs have a note and what each says,
 *                  so a tab is in the feature or it is not — decided once,
 *                  with nothing downstream keeping a second list
 *   the race       whether you have read it arrives from a fetch, and the tab
 *                  is already on the screen. A note that asked an empty set
 *                  would re-open on every reload something you dismissed last
 *                  week, so a tab arrived at before the answer is *pending*
 *                  and the answer is what opens it
 *   the dismissal  four ways to do it, one path through, and the local set
 *                  written before the request goes out — so a write the
 *                  server refuses costs you the note on the next device
 *                  rather than a second dialog in this session
 *
 * Run against the shipped public/js/faq.js, in a context holding the shipped
 * public/js/state.js too: `prefs` and `saveFaqSeen()` are the real ones, so
 * "a failed write does not show it twice" is asserted through the code that
 * actually decides it rather than through a stub that agrees with the test.
 * The document is a stub — a dialog is a thing only a browser can draw, and
 * what is checked is which questions are asked of it and in what order.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const FAQ_SOURCE = read('public/js/faq.js');
const HTML       = read('public/index.html');
const CSS        = read('public/css/components.css');

/** The panes, as the markup delivers them: a tab's own <div id="tab-…"> and
 *  everything up to the next one's. */
const PANES = new Map(HTML.split(/^(?=<div id="tab-)/m)
  .map(part => [part.match(/^<div id="tab-([\w-]+)"/)?.[1], part])
  .filter(([tab]) => tab));

// ── The app, with a dialog it can be asked about ──────────────────────────

/** An element, to the handful of things the note does with one. */
function fakeEl(id) {
  const listeners = {};
  const el = {
    id,
    style: {},
    innerHTML: '',
    textContent: '',
    attrs: {},
    children: [],
    focused: 0,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    setAttribute: (name, value) => { el.attrs[name] = value; },
    appendChild: child => { el.children.push(child); return child; },
    focus() { el.focused++; },
    fire(type, event = {}) {
      const seen = { target: el, ...event };
      seen.preventDefault = () => { seen.prevented = true; };
      (listeners[type] || []).forEach(fn => fn(seen));
      return seen;
    },
  };
  return el;
}

/** The shipped note, over the shipped preferences.
 *
 *  `faqSeen` is what the server will say when the fetch lands; `local` is what
 *  this browser already had in storage. Nothing has resolved until a test
 *  calls `resolve()`, which is the whole point of the harness — the window
 *  between the first paint and the answer is where the race lives. */
function loadFaq({ faqSeen = [], stored = true, local = null, failWrites = false } = {}) {
  const store = new Map();
  if (local !== null) store.set('mtgtools_faq_seen', local);

  const record = {
    theme: 'dark', playmatKind: 'none', playmatRef: null, playmatUrl: null,
    cardMotion: 'on', faqSeen,
  };
  const writes = [];

  const els = {
    faqModal: fakeEl('faqModal'),
    faqBody:  fakeEl('faqBody'),
    faqClose: fakeEl('faqClose'),
    faqGotIt: fakeEl('faqGotIt'),
  };
  const docListeners = {};

  /* A control strip per tab, including tabs with no note: what the mount does
   * with the ones it was not asked about is half of what is under test. The
   * seven are the ids the browser and the server will store, so a strip
   * missing here would be a tab the registry could name and this harness
   * could not answer for. */
  const strips = new Map(
    [...JSON.parse(read('public/js/state.js').match(/FAQ_TABS\s*=\s*(\[[^\]]*\])/)[1]
      .replace(/'/g, '"')), 'players']
      .map(tab => [tab, fakeEl(`toolbar-${tab}`)]),
  );

  const sandbox = {
    console,
    localStorage: {
      getItem:    k => (store.has(k) ? store.get(k) : null),
      setItem:    (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    window: { innerWidth: 1280 },
    document: {
      readyState: 'complete',
      body: { style: {} },
      addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
      getElementById: id => els[id] || null,
      querySelector: sel => {
        const m = sel.match(/^#tab-([\w-]+) \.toolbar$/);
        assert.ok(m, `the note asked the document for "${sel}", which is not a tab's strip`);
        return strips.get(m[1]) || null;
      },
      createElement: tag => Object.assign(fakeEl(`<${tag}>`), { tag }),
    },
    async fetch(_url, init) {
      if (init?.method === 'PUT') {
        writes.push(JSON.parse(init.body));
        if (failWrites) throw new Error('offline');
        Object.assign(record, JSON.parse(init.body));
      }
      return { ok: true, json: async () => ({ ...record, stored }) };
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/state.js'), sandbox, { filename: 'state.js' });
  vm.runInContext(FAQ_SOURCE, sandbox, { filename: 'faq.js' });

  const evaluate = expr => vm.runInContext(expr, sandbox);
  const json = expr => JSON.parse(evaluate(`JSON.stringify(${expr})`));

  return {
    els, evaluate, json, writes, store, strips,
    /** The registry, as a value this file can walk. */
    registry: () => json('FAQ'),
    /** The `?` buttons that were mounted, by the tab whose strip they are on. */
    buttons: () => new Map([...strips]
      .filter(([, strip]) => strip.children.length)
      .map(([tab, strip]) => [tab, strip.children[0]])),
    /** Which tabs the account has read, right now. */
    seen: () => json('prefs.faqSeen'),
    /** Whose note is on the screen, or none. Both halves are read, so a note
     *  that thinks it is open behind a hidden overlay is not mistaken for one
     *  somebody can see. */
    open: () => {
      const showing = evaluate('_faqShowing');
      const drawn   = els.faqModal.style.display === 'flex';
      assert.equal(drawn, showing !== null, 'the overlay and the note disagree about being open');
      return showing;
    },
    /** You arrived on a tab. */
    arrive: tab => evaluate(`faqOnTab(${JSON.stringify(tab)})`),
    /** The preferences fetch landed. Both halves, in the order boot runs them. */
    resolve: async () => {
      await evaluate('loadPrefs()');
      evaluate('syncFaqSeen()');
      evaluate('faqPrefsArrived()');
    },
    /** A key, pressed with nothing focused unless a target is named. */
    press: (key, target = { tagName: 'BODY' }, held = {}) => {
      const seen = { key, target, ...held };
      seen.preventDefault = () => { seen.prevented = true; };
      (docListeners.keydown || []).forEach(fn => fn(seen));
      return seen;
    },
  };
}

/** A note for a tab that has none, so that what reads the registry can be
 *  asked about a tab this app does not actually have one for. The registry is
 *  data; what is under test is everything downstream of it. */
const addEntry = (app, tab) => app.evaluate(`FAQ[${JSON.stringify(tab)}] = {
  title: 'A Tab', blurb: 'What it is.', points: ['A thing it does.'], keys: [],
}`);

// ── The registry ──────────────────────────────────────────────────────────

describe('the registry', () => {
  test('a note cannot be half-added: title, blurb, and something to say', () => {
    const app = loadFaq();
    const registry = app.registry();
    assert.ok(Object.keys(registry).length > 0, 'the registry is empty');
    for (const [tab, note] of Object.entries(registry)) {
      assert.equal(typeof note.title, 'string', `${tab} has no title`);
      assert.ok(note.title.trim(), `${tab}'s title is empty`);
      assert.equal(typeof note.blurb, 'string', `${tab} has no blurb`);
      assert.ok(note.blurb.trim(), `${tab}'s blurb is empty`);
      assert.ok(Array.isArray(note.points) && note.points.length >= 1,
        `${tab} lists nothing you would otherwise have to discover`);
    }
  });

  test('a key is a key and what it does, both of them', () => {
    const app = loadFaq();
    for (const [tab, note] of Object.entries(app.registry())) {
      assert.ok(Array.isArray(note.keys), `${tab} has no keys list`);
      for (const row of note.keys) {
        assert.ok(Array.isArray(row) && row.length === 2, `${tab} has a malformed key row`);
        assert.ok(String(row[0]).trim() && String(row[1]).trim(),
          `${tab} has a key with nothing said about it`);
      }
    }
  });

  test('every tab with a note is one the browser and the server will store', () => {
    // Three copies of the seven ids, because a page script has no module
    // boundary to import across — the way THEMES is already mirrored. This is
    // the check that keeps them from drifting: a note whose id the server
    // refuses is a note that opens for ever.
    const app  = loadFaq();
    const ids  = list => JSON.parse(list.replace(/'/g, '"'));
    const both = [
      ['state.js',        read('public/js/state.js')],
      ['routes/prefs.js', read('routes/prefs.js')],
    ];
    for (const [where, source] of both) {
      const m = source.match(/FAQ_TABS\s*=\s*(\[[^\]]*\])/);
      assert.ok(m, `${where} has no FAQ_TABS to check against`);
      const known = ids(m[1]);
      for (const tab of Object.keys(app.registry())) {
        assert.ok(known.includes(tab), `${where} would refuse the id "${tab}"`);
      }
    }
  });

  test('and every tab the browser and the server will store has one', () => {
    /* The drift the test above cannot see, which is the same list read the
     * other way round: an id in the stored set with no entry behind it is a
     * tab that never says what it is, and — because the button is mounted from
     * the registry — one nobody could ask either. The four deliberately left
     * out are not in FAQ_TABS, so they are not asked for here. */
    const app   = loadFaq();
    const known = JSON.parse(read('public/js/state.js')
      .match(/FAQ_TABS\s*=\s*(\[[^\]]*\])/)[1].replace(/'/g, '"'));
    assert.deepEqual(Object.keys(app.registry()).sort(), known.slice().sort());
  });

  test('the keys every note shares are appended rather than written into one', () => {
    // Said once, so two tabs cannot come to describe Escape differently.
    const app    = loadFaq();
    const shared = app.json('FAQ_SHARED_KEYS').map(([key]) => key);
    assert.ok(shared.includes('Escape'), 'the note does not say how to close it');
    for (const [tab, note] of Object.entries(app.registry())) {
      for (const [key] of note.keys) {
        assert.ok(!shared.includes(key), `${tab} writes the shared key ${key} into its own list`);
      }
    }
  });

  test('no note promises f on a tab that draws no card to turn over', () => {
    /* `f` turns the card under the pointer over, so a row promising it on a
     * tab with no card to point at is a lie told on arrival — and one nobody
     * would catch, because the way to find out is to press it and watch
     * nothing happen.
     *
     * Which tabs draw cards is read off the delivered scripts rather than
     * listed here. The shared card-size control is mounted on exactly the
     * views that draw card art, so the pane a mountSizeControl() names is a
     * pane with cards in it — and both directions are asserted, because a card
     * tab whose note leaves `f` out is the same list drifting the other way. */
    const app = loadFaq();
    const draws = new Set();
    for (const file of fs.readdirSync(path.join(ROOT, 'public/js'))) {
      for (const m of read(path.join('public/js', file)).matchAll(/mountSizeControl\('([\w-]+)'/g)) {
        for (const [tab, pane] of PANES) if (pane.includes(`id="${m[1]}"`)) draws.add(tab);
      }
    }
    assert.ok(draws.size, 'nothing in public/js mounts the card-size control');
    for (const [tab, note] of Object.entries(app.registry())) {
      const promises = note.keys.some(([key]) => key === 'f');
      assert.equal(promises, draws.has(tab), promises
        ? `${tab} promises f and draws no card to turn over`
        : `${tab} draws cards and its note does not say f turns one over`);
    }
  });

  test('every key a note lists is a key the app answers to', () => {
    /* The one claim in the note that can be wrong without anybody noticing:
     * a row promising a key that does nothing. Read off every keydown in the
     * delivered scripts rather than from a list kept here. */
    const app  = loadFaq();
    const answered = new Set();
    for (const file of fs.readdirSync(path.join(ROOT, 'public/js'))) {
      const source = read(path.join('public/js', file));
      for (const m of source.matchAll(/e\.key\s*[!=]==\s*'([^']+)'/g)) answered.add(m[1]);
    }
    const listed = [
      ...Object.values(app.registry()).flatMap(note => note.keys),
      ...app.json('FAQ_SHARED_KEYS'),
    ];
    for (const [key, what] of listed) {
      assert.ok(answered.has(key), `the note promises "${key}" (${what}) and nothing listens for it`);
    }
  });
});

// ── Arriving on a tab ─────────────────────────────────────────────────────

describe('arriving on a tab', () => {
  test('a tab whose note you have not read opens it', async () => {
    const app = loadFaq({ faqSeen: [] });
    await app.resolve();
    app.arrive('deckview');
    assert.equal(app.open(), 'deckview');
  });

  test('a tab whose note you have read opens nothing', async () => {
    const app = loadFaq({ faqSeen: ['deckview'] });
    await app.resolve();
    app.arrive('deckview');
    assert.equal(app.open(), null);
  });

  test('a tab with no note opens nothing', async () => {
    // The four left out — a card, a list of people, a want list, a table of
    // users — and any tab added later that nobody has written a note for.
    const app = loadFaq({ faqSeen: [] });
    await app.resolve();
    app.arrive('players');
    assert.equal(app.open(), null);
  });

  test('the note that opens is the entry, drawn out', async () => {
    const app = loadFaq({ faqSeen: [] });
    await app.resolve();
    app.arrive('deckview');
    const html = app.els.faqBody.innerHTML;
    const note = app.registry().deckview;
    assert.ok(html.includes(note.title), 'it does not say which tab it is about');
    assert.ok(html.includes(note.blurb), 'it does not say what the tab is for');
    for (const point of note.points) assert.ok(html.includes(point), `it dropped "${point}"`);
    for (const [key] of note.keys) assert.ok(html.includes(key), `it dropped the key ${key}`);
    for (const [key] of app.json('FAQ_SHARED_KEYS')) {
      assert.ok(html.includes(key), `it dropped the shared key ${key}`);
    }
  });
});

// ── The race ──────────────────────────────────────────────────────────────

describe('the race between the tab and the answer', () => {
  test('a tab arrived at before the answer opens nothing yet', () => {
    // The naive version asks an empty set, is told no, and shows you on every
    // reload a note you dismissed last week.
    const app = loadFaq({ faqSeen: ['deckview'] });
    app.arrive('deckview');
    assert.equal(app.open(), null, 'it opened before it knew');
    assert.equal(app.evaluate('_faqPending'), 'deckview', 'and it forgot you were there');
  });

  test('and the answer is what opens it', async () => {
    const app = loadFaq({ faqSeen: [] });
    app.arrive('deckview');
    await app.resolve();
    assert.equal(app.open(), 'deckview');
  });

  test('an answer that says you have read it opens nothing', async () => {
    const app = loadFaq({ faqSeen: ['deckview'] });
    app.arrive('deckview');
    await app.resolve();
    assert.equal(app.open(), null);
  });

  test('and neither does one the browser answered on its own', async () => {
    // Open mode: there is no row, so the browser is the whole record and the
    // answer arrives from storage instead of from the server. The pending tab
    // is judged when it is flushed rather than when it was recorded, which is
    // what makes this the same case as the one above.
    const app = loadFaq({ stored: false, faqSeen: [], local: 'deckview' });
    app.arrive('deckview');
    await app.resolve();
    assert.equal(app.open(), null);
  });

  test('one pending tab and not a queue: the note is the tab you are on', async () => {
    const app = loadFaq({ faqSeen: [] });
    app.arrive('deckview');
    app.arrive('sets');
    await app.resolve();
    assert.equal(app.open(), 'sets', 'it opened the tab you have already left');
    assert.equal(app.evaluate('_faqPending'), null,
      'the pending tab is one value, taken when it is used, rather than a queue');
  });

  test('the answer, once it has arrived, does not keep re-opening things', async () => {
    const app = loadFaq({ faqSeen: [] });
    app.arrive('deckview');
    await app.resolve();
    app.evaluate('closeFaq()');
    app.evaluate('faqPrefsArrived()');
    assert.equal(app.open(), null, 'the pending tab was still there to be flushed twice');
  });
});

// ── Dismissing it ─────────────────────────────────────────────────────────

describe('dismissing it', () => {
  const opened = async (over = {}) => {
    const app = loadFaq({ faqSeen: [], ...over });
    await app.resolve();
    app.arrive('deckview');
    assert.equal(app.open(), 'deckview', 'the note under test never opened');
    return app;
  };

  test('Got it closes it, and reads it', async () => {
    const app = await opened();
    app.els.faqGotIt.fire('click');
    assert.equal(app.open(), null);
    assert.deepEqual(app.seen(), ['deckview']);
  });

  test('the close button closes it, and reads it', async () => {
    const app = await opened();
    app.els.faqClose.fire('click');
    assert.equal(app.open(), null);
    assert.deepEqual(app.seen(), ['deckview']);
  });

  test('Escape closes it, and reads it', async () => {
    const app = await opened();
    app.press('Escape');
    assert.equal(app.open(), null);
    assert.deepEqual(app.seen(), ['deckview']);
  });

  test('a click outside the box closes it, and one inside does not', async () => {
    const app = await opened();
    app.els.faqModal.fire('click', { target: { id: 'the box' } });
    assert.equal(app.open(), 'deckview', 'a click on the note itself dismissed it');
    app.els.faqModal.fire('click');
    assert.equal(app.open(), null);
    assert.deepEqual(app.seen(), ['deckview']);
  });

  test('once dismissed, arriving again opens nothing', async () => {
    const app = await opened();
    app.els.faqGotIt.fire('click');
    app.arrive('deckview');
    assert.equal(app.open(), null);
  });

  test('a dismissal is written to the browser before it is sent', async () => {
    // saveFaqSeen()'s order, reached through the one path: local set, browser
    // copy, then the request. A second path that wrote prefs directly would
    // leave the two disagreeing about what this browser has seen.
    const app = await opened();
    app.els.faqGotIt.fire('click');
    assert.equal(app.store.get('mtgtools_faq_seen'), 'deckview');
  });

  test('a note is never shown twice because a write failed', async () => {
    const app = await opened({ failWrites: true });
    app.els.faqGotIt.fire('click');
    await new Promise(r => setImmediate(r));
    assert.deepEqual(app.seen(), ['deckview'],
      'the failure took the dismissal back');
    app.arrive('deckview');
    assert.equal(app.open(), null, 'and the note came back in the same session');
  });

  test('a dismissal is one tab, not all of them', async () => {
    const app = await opened();
    app.els.faqGotIt.fire('click');
    app.arrive('sets');
    assert.equal(app.open(), 'sets', 'reading one note read the others too');
  });
});

// ── Getting it back ───────────────────────────────────────────────────────
/* A note you have dismissed is not gone. The button and the key are two ways
 * to the same call, and the thing worth asserting about the button is not that
 * it works but where it came from: the registry, walked, rather than seven
 * hand-written into index.html beside seven entries here. */

describe('the ? button', () => {
  test('every tab with a note grows one, and no tab without a note does', async () => {
    const app = loadFaq({ faqSeen: [] });
    await app.resolve();
    assert.deepEqual([...app.buttons().keys()].sort(), Object.keys(app.registry()).sort());
  });

  test('and it is the registry that decides, not a list kept beside it', () => {
    // The failure this guards is silent in both directions: a button that
    // opens nothing, or a note with no way back — which on a phone, where
    // there is no keyboard to press ? on, is no way back at all.
    const app = loadFaq({ faqSeen: [] });
    app.strips.forEach(strip => { strip.children.length = 0; });
    addEntry(app, 'players');
    app.evaluate('faqMountButtons()');
    assert.deepEqual([...app.buttons().keys()].sort(),
      [...Object.keys(app.registry())].sort());
    assert.ok(app.buttons().has('players'), 'the mount kept a list of its own');
  });

  test('it opens the note for the tab it is on, and closes it again', async () => {
    const app = loadFaq({ faqSeen: ['deckview'] });
    await app.resolve();
    app.arrive('deckview');
    assert.equal(app.open(), null, 'a note already read opened itself');
    app.buttons().get('deckview').fire('click');
    assert.equal(app.open(), 'deckview');
    app.buttons().get('deckview').fire('click');
    assert.equal(app.open(), null);
  });

  test('it says what it is, and where the key is written down', () => {
    const app = loadFaq();
    const btn = app.buttons().get('deckview');
    /* A button rather than something with a click on it, which is the whole of
       what it takes to be in the tab order and to answer to Enter. */
    assert.equal(btn.tag, 'button');
    assert.ok(String(btn.attrs['aria-label'] || '').trim(),
      'a ? on its own says nothing to a screen reader');
    assert.match(btn.title, /\?/, 'the label is the only place the key is written down');
  });

  test('no tab writes one into its own markup', () => {
    // Mounted by the feature, so index.html cannot come to hold a button for a
    // tab the registry has never heard of.
    assert.ok(!HTML.includes('faq-btn'), 'index.html hand-writes a ? button');
  });

  test('every tab with a note has a strip to put it on', () => {
    /* The one half of the mount this file's stub document cannot see. A pane
     * with no .toolbar takes no button, and a note with no way back is exactly
     * what the mount exists to make impossible — so the markup is asked here
     * rather than left to be noticed on a phone. */
    const panes = new Map();
    for (const part of HTML.split(/^(?=<div id="tab-)/m)) {
      const m = part.match(/^<div id="tab-([\w-]+)"/);
      if (m) panes.set(m[1], part);
    }
    const app = loadFaq();
    for (const tab of Object.keys(app.registry())) {
      const pane = panes.get(tab);
      assert.ok(pane, `index.html has no pane for ${tab}`);
      assert.match(pane, /class="toolbar"/, `${tab} has no control strip to mount a ? on`);
    }
  });
});

describe('the ? key', () => {
  const on = async (tab, over = {}) => {
    const app = loadFaq({ faqSeen: ['deckview'], ...over });
    await app.resolve();
    app.arrive(tab);
    assert.equal(app.open(), null, 'the tab under test opened a note of its own');
    return app;
  };

  test('it opens the note for the tab you are on', async () => {
    const app = await on('deckview');
    assert.equal(app.press('?').prevented, true, 'the character was left to the page');
    assert.equal(app.open(), 'deckview');
  });

  test('and pressing it again closes it', async () => {
    const app = await on('deckview');
    app.press('?');
    app.press('?');
    assert.equal(app.open(), null);
  });

  test('on a tab with no note it does nothing', async () => {
    const app = await on('players');
    assert.equal(app.press('?').prevented, undefined, 'it took the character anyway');
    assert.equal(app.open(), null);
  });

  test('it is refused while a field has the focus', async () => {
    // Typing ? into a Scryfall query has to search for it.
    for (const target of [
      { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
    ]) {
      const app = await on('deckview');
      app.press('?', target);
      assert.equal(app.open(), null, `${target.tagName} let the note open over what was being typed`);
    }
  });

  test('and while a modifier is held', async () => {
    for (const held of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const app = await on('deckview');
      app.press('?', { tagName: 'BODY' }, held);
      assert.equal(app.open(), null, `${Object.keys(held)[0]} + ? was taken from the browser`);
    }
  });

  test('it is matched on the character, not on Shift and the key under it', () => {
    /* A layout that does not put ? on Shift+/ still reaches it, which is only
     * true while nothing here reads shiftKey or a physical code. */
    const source = read('public/js/faq.js');
    assert.match(source, /e\.key !== '\?'/, "the key is not matched on the character it produced");
    assert.ok(!/shiftKey|e\.code/.test(source), 'it reads a physical key rather than a character');
  });

  test('looking a note up again does not un-read it', async () => {
    // The button is for looking something up, not for resetting the state: a
    // tab you have dismissed stays dismissed however often you come back.
    const app = await on('deckview');
    app.press('?');
    app.press('?');
    assert.deepEqual(app.seen(), ['deckview']);
    app.arrive('deckview');
    assert.equal(app.open(), null, 'reopening it put the note back on the next arrival');
  });

  test('a note asked for on a tab you have not read is read by closing it', async () => {
    /* The one case where ? reaches a note that had not been dismissed: it was
     * asked for before the answer arrived, so nothing had opened it yet.
     * Closing it is a dismissal like any other — there is one way out. */
    const app = loadFaq({ faqSeen: [] });
    app.arrive('deckview');
    assert.equal(app.open(), null, 'it opened before it knew');
    app.press('?');
    assert.equal(app.open(), 'deckview');
    app.press('?');
    assert.deepEqual(app.seen(), ['deckview']);
  });
});

// ── The dialog ────────────────────────────────────────────────────────────

describe('the dialog', () => {
  test('focus lands on Got it', async () => {
    /* The opposite of openDrawer()'s rule, deliberately: a drawer focuses its
     * first field because opening a drawer in order to dismiss it is not the
     * task, and here dismissing is precisely the task. */
    const app = loadFaq({ faqSeen: [] });
    await app.resolve();
    app.arrive('deckview');
    assert.equal(app.els.faqGotIt.focused, 1);
  });

  test('it reads as a dialog, and says which one it is', () => {
    const modal = HTML.match(/<div id="faqModal"[^>]*>/);
    assert.ok(modal, 'index.html has no #faqModal');
    assert.match(modal[0], /role="dialog"/);
    assert.match(modal[0], /aria-modal="true"/);
    assert.match(modal[0], /aria-labelledby="faqTitle"/,
      'the dialog is announced by its own title, which is drawn per tab');
    assert.match(HTML, /id="faqClose"[^>]*aria-label=/,
      'the close button is a glyph, so it needs a name');
  });

  test('it says whether it is open, which is what the card turn asks it', async () => {
    /* js/cardturn.js refuses `f` from behind the note, and this is the
     * question it asks — one predicate, rather than a second file reading the
     * overlay's display and deciding for itself what open means. */
    const app = loadFaq({ faqSeen: [] });
    await app.resolve();
    assert.equal(app.evaluate('faqIsOpen()'), false);
    app.arrive('deckview');
    assert.equal(app.evaluate('faqIsOpen()'), true);
    app.press('Escape');
    assert.equal(app.evaluate('faqIsOpen()'), false);
  });

  test('it is a floating surface: a shadow, and no border', () => {
    // The house rule, and lint:tokens fails a surface that draws both.
    const box = CSS.match(/\.faq-box\s*\{[^}]*\}/);
    assert.ok(box, 'components.css does not style the note');
    assert.match(box[0], /box-shadow:\s*var\(--shadow-/, 'it does not float');
    assert.ok(!/\bborder:\s*(?!none)/.test(box[0]), 'a floating surface takes no border');
  });
});

// ── Its two hooks into the app ────────────────────────────────────────────

test('the app opens notes from setTab and flushes them from syncPrefs', () => {
  /* The whole of the feature's reach into main.js, asserted because a hook in
   * the wrong place is exactly the failure the harness above cannot see: a
   * note wired to initDeckBuilder() would never open on the tab you land on,
   * and one flushed before syncFaqSeen() would read the set the fetch has not
   * corrected yet. */
  const main = read('public/js/main.js');
  const setTab = main.match(/function setTab\([\s\S]*?\n\}/);
  assert.ok(setTab && /faqOnTab\(tab\)/.test(setTab[0]),
    'setTab does not tell the note which tab you are on');
  const sync = main.match(/async function syncPrefs\([\s\S]*?\n\}/);
  assert.ok(sync, 'main.js has no syncPrefs');
  assert.ok(sync[0].indexOf('syncFaqSeen()') < sync[0].indexOf('faqPrefsArrived()'),
    'the pending tab is flushed before the set it is judged against is read');
});

test('and the tab the app opens on is arrived at like any other', () => {
  /* The one arrival that does not go through setTab: a load with no hash on
   * it shows the default tab from the markup and only records the history
   * entry. Landing on a tab and switching to it are the same thing to the
   * person doing it, so they have to be the same thing here — otherwise the
   * note for whichever tab the app opens on is the one note that never
   * opens, and nothing about it would look broken. */
  const main = read('public/js/main.js');
  const routing = main.match(/function initRouting\([\s\S]*?\n\}/);
  assert.ok(routing, 'main.js has no initRouting');
  assert.match(routing[0], /faqOnTab\(DEFAULT_TAB\)/,
    'the default landing does not tell the note which tab you are on');
  assert.match(routing[0], /history\.replaceState\(\{ view: 'tab', tab: DEFAULT_TAB \}/,
    'the default tab is named twice, so the two can come to disagree');
});
