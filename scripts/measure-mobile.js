#!/usr/bin/env node
'use strict';

/**
 * Measure the two mobile rules that are numbers, at a 390px window, because
 * the phone criteria are numeric and a contact sheet cannot produce a number.
 *
 * Two questions, one per criterion:
 *
 *   overflow  Does the page scroll sideways? A phone has no horizontal
 *             scrollbar to warn you, so a pane one pixel too wide reads as
 *             a page that drifts under the thumb. Must be zero — with the
 *             deliberate exception of a wide table, which is *supposed* to
 *             scroll, inside its own container rather than the document.
 *   targets   Is every control at least 44x44? Below that a finger misses,
 *             and the miss is invisible on a mouse-driven desktop.
 *
 * Sibling of scripts/measure-layout.js, which asks the same kind of
 * question at 1440px. The browser plumbing is capture-screens.js's,
 * imported rather than copied.
 *
 *   node scripts/measure-mobile.js --data .scratch/ui-redesign/capture-data/state.json
 *   node scripts/measure-mobile.js --tabs collections --json
 */

const fs = require('fs');
const {
  BidiSession, startServer, startFirefox, assertOpenMode, waitForHttp, parseArgs, TABS,
} = require('./capture-screens.js');

/* The phone the spec names. One width, not a sweep: 390 is where the
 * redesign's mobile decisions were taken, and a rule that holds at 390 and
 * breaks at 360 is a rule with a hardcoded width in it, which the token
 * contract already forbids. */
const VIEWPORT = { name: 'phone', width: 390, height: 844 };

/* Views that have no tab of their own, each measured as its own pass.
 *
 * The two drawers are full-height surfaces on a phone carrying controls
 * nothing else in the app has, and each is measured separately from the tab
 * it belongs to because an open drawer covers the page behind it — every
 * control back there would otherwise report as unhittable.
 *
 * Collections' list view is here for the opposite reason: a tab is measured
 * as it arrives, and Collections arrives as a grid of card art, so its table
 * — the densest in the app, and the one place a padded card name has a
 * neighbour close enough to swallow it — was never being looked at. It was
 * hiding a row two pixels short. */
const EXTRA_VIEWS = {
  'deckview-search':  'deckview',
  'deckview-history': 'deckview',
  'deckview-owned':   'deckview',
  'deckview-analysis': 'deckview',
  'deckview-legality': 'deckview',
  'deckview-mana':    'deckview',
  'deckview-menu':    'deckview',
  'rss-panel':        'available',
  'collections-list': 'collections',
  'collections-pile': 'collections',
  /* The tab's note, which every other pass has had to be told it has already
     read — see seedNotesAsRead() below. It is a dialog over the whole page, so
     it is measured here, once, in the only pass that asks for it. */
  faq:                'deckview',
};

/* Every note marked as read before anything is measured.
 *
 * The harness meets the note the way a new account does: a fresh profile
 * against an open-mode server has read nothing, so the first tab it opens
 * comes with a dialog over it. What that costs is not the tab it covers — a
 * control 44px in its own right is never hit-tested — but the two padded
 * targets in the builder, whose whole point is a hit area larger than the box
 * they paint, and which report as covered because they are.
 *
 * The ids come from the page's own FAQ_TABS rather than from a list here, so
 * this cannot be the second copy of the seven that goes stale. */
const SEED_SEEN = `(() => {
  if (typeof FAQ_TABS === 'undefined') return 'false';
  localStorage.setItem('mtgtools_faq_seen', FAQ_TABS.join(','));
  return 'true';
})()`;

/* And the one pass that wants it after all. Whose note it is does not matter —
   the dialog is one element reused by all of them — so it is the first the
   registry lists rather than a tab named twice. */
const OPEN_FAQ = `(() => {
  const tab = typeof FAQ === 'object' && Object.keys(FAQ)[0];
  if (!tab || typeof openFaq !== 'function') return 'false';
  openFaq(tab);
  return 'true';
})()`;

/* A view opened as an overlay is measured only within itself. The mat
 * behind an open drawer is unreachable by design — that is what an overlay
 * is for — and counting its controls as unhittable would report the drawer
 * working as a fault. */
const SCOPES = {
  'deckview-search':  '#dbSearchPanel',
  'deckview-history': '#dbHistoryPanel',
  'rss-panel':        '#rssPanel',
  faq:                '#faqModal',
};

const TARGET_MIN = 44;   // px, per the mobile criterion

/* Geometry does not depend on the palette, so the measurement runs on one
 * theme; the five-theme review is the contact sheet's job. */
const THEME = 'dark';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Tabs that show nothing until asked. Reused verbatim in spirit from
 * measure-layout.js's FOLD_PREP: a control that has not rendered cannot be
 * too small, so the tabs whose content is opt-in have to be opened or they
 * pass by being empty. */
const PREP = {
  scryfall: `(() => {
    const input = document.getElementById('sfInput');
    if (!input) return 'false';
    input.value = 't:creature c:r';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 'true';
  })()`,
  sets: `(() => {
    const tile = document.querySelector('#setPicker .set-tile');
    if (!tile) return 'false';
    tile.click();
    return 'true';
  })()`,
  /* The builder is the densest tab in the app and, until a deck is chosen,
   * the emptiest — an unprepared Deck Builder passes this measurement by
   * having nothing on it to hit. */
  deckview: `(() => {
    const sel = document.getElementById('dbDeckSel');
    const opt = sel && [...sel.options].find(o => o.value);
    if (!opt) return 'false';
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'true';
  })()`,
  'rss-panel': `(() => {
    if (typeof toggleRssPanel !== 'function') return 'false';
    toggleRssPanel();
    return 'true';
  })()`,
  'collections-list': `(() => {
    const pane = [...document.querySelectorAll('.tab-pane')].find(p => p.style.display !== 'none');
    const btn = pane && pane.querySelector('.view-btn[data-mode="list"]');
    if (!btn) return 'false';
    btn.click();
    return 'true';
  })()`,
  /* The stack view, for the same reason as the list: a tab is measured as it
   * arrives, and it arrives as a grid. Stacks are the widest thing this tab
   * draws — a pile column is a card and the room a pile lying askew needs —
   * so a phone is where a row of them would push the page sideways.
   *
   * Nothing is opened here any more. The view arrives with every pile spread,
   * so switching to it is the whole of the state worth measuring — and it is
   * the dense one: fifteen hundred cards overlapping down a 390px screen,
   * where a card that has not held its own height is a card the rest of the
   * fan lands on top of. */
  'collections-pile': `(() => {
    const pane = [...document.querySelectorAll('.tab-pane')].find(p => p.style.display !== 'none');
    const btn = pane && pane.querySelector('.view-btn[data-mode="pile"]');
    if (!btn) return 'false';
    btn.click();
    return 'true';
  })()`,
  'deckview-search': `(() => {
    const sel = document.getElementById('dbDeckSel');
    const opt = sel && [...sel.options].find(o => o.value);
    if (!opt) return 'false';
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof dbOpenSearchPanel !== 'function') return 'false';
    dbOpenSearchPanel();
    return 'true';
  })()`,
  /* The other drawer, and the one whose rows are written rather than laid
     out: a snapshot's date, what it was taken in front of and a Restore
     button share a line, and a phone is where that line runs out of room.
     A deck with no history at all draws an empty state and nothing to
     measure, so this waits for a row before reporting itself ready. */
  'deckview-history': `(() => {
    const sel = document.getElementById('dbDeckSel');
    const opt = sel && [...sel.options].find(o => o.value);
    if (!opt) return 'false';
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof dbOpenHistoryPanel !== 'function') return 'false';
    /* A deck this app has never edited has no snapshots, and an empty state
       is not a row — the Restore button is the control worth measuring. One
       is taken here rather than seeded into the fixture so the row measured
       is a row the app wrote. */
    _dbForceSnapshot('edit').then(dbOpenHistoryPanel);
    return 'true';
  })()`,
  /* The curve, the type breakdown and the split, expanded out of the toolbar.
     Closed when the tab arrives — it is asked for rather than owed mat space —
     so an unopened analysis strip passes this measurement by not being there,
     and the curve's colour toggle is a control only this state has. */
  'deckview-analysis': `(() => {
    const sel = document.getElementById('dbDeckSel');
    const opt = sel && [...sel.options].find(o => o.value);
    if (!opt) return 'false';
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof dbToggleAnalysis !== 'function') return 'false';
    /* The deck's cards arrive over the network, and a deck with none of them
       yet draws an empty strip with nothing on it to hit. */
    setTimeout(() => { if (!dbAnalysisOpen) dbToggleAnalysis(); }, 1500);
    return 'true';
  })()`,
  /* What of the deck you own, opened out of the readout. Not a drawer — it
     rises out of the bottom line rather than covering the page — so it is not
     scoped: the mat behind it is still reachable and its controls still count.
     Every card missing carries a + that puts it on a want list, which is the
     densest row this ticket added and the one a thumb has to find. */
  'deckview-owned': `(() => {
    const sel = document.getElementById('dbDeckSel');
    const opt = sel && [...sel.options].find(o => o.value);
    if (!opt) return 'false';
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof dbToggleOwnedPanel !== 'function') return 'false';
    /* The deck's cards arrive over the network, and a deck with none of them
       yet is a readout saying "0 of 0" with nothing under it to measure. */
    const open = () => { if (!_dbOwnedPanelOpen) dbToggleOwnedPanel(); };
    setTimeout(open, 1500);
    return 'true';
  })()`,
  /* What the deck breaks and what bracket it looks like, out of the same line
     as the missing list. It carries two controls nothing else on this tab has —
     the ✕ that closes it, and the select that declares a bracket — and on a
     phone it is the *only* way to either of them, because the readout's bracket
     item is one of the things that width takes away. */
  'deckview-legality': `(() => {
    const sel = document.getElementById('dbDeckSel');
    const opt = sel && [...sel.options].find(o => o.value);
    if (!opt) return 'false';
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof dbToggleCheckPanel !== 'function') return 'false';
    /* The deck's cards arrive over the network, and a deck with none of them
       yet is a panel with one line in it and no reasoning to measure. */
    setTimeout(() => { if (!_dbCheckPanelOpen) dbToggleCheckPanel(); }, 1500);
    return 'true';
  })()`,
  /* What the deck's spells want against what its lands make, out of the same
     line again. Two controls in its header — the ✕ and the way through to the
     calculator — and the second is the small one: a button that stands beside
     a title on a desktop rather than beside other buttons is the kind that
     arrives on a phone too short to hit. */
  'deckview-mana': `(() => {
    const sel = document.getElementById('dbDeckSel');
    const opt = sel && [...sel.options].find(o => o.value);
    if (!opt) return 'false';
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof dbToggleManaPanel !== 'function') return 'false';
    /* The deck's cards arrive over the network, and a deck with none of them
       yet is a panel saying it has nothing to compare. */
    setTimeout(() => { if (!_dbManaPanelOpen) dbToggleManaPanel(); }, 1500);
    return 'true';
  })()`,
  /* Every control this tab has that is not the picker, the add field or the
     filter. It arrives closed at this width — a column that takes the top of
     the page is asked for rather than owed it — so without its own view the
     whole of it would pass this measurement by not being on screen. */
  'deckview-menu': `(() => {
    const sel = document.getElementById('dbDeckSel');
    const opt = sel && [...sel.options].find(o => o.value);
    if (!opt) return 'false';
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof dbToggleMenu !== 'function') return 'false';
    /* After the deck's cards arrive: the size control hides its own mount in
       list view, and the board toggles are drawn from what the deck holds. */
    setTimeout(() => { if (!dbMenuOpen) dbToggleMenu(); }, 1500);
    return 'true';
  })()`,
  faq: OPEN_FAQ,
  pick: `(() => {
    const click = (sel, i) => {
      const el = document.querySelectorAll(sel)[i];
      if (!el) return false;
      el.click();
      return true;
    };
    for (let i = 0; i < 4; i++) if (!click('#pickPoolDeckList .pick-pool-chip', i)) return 'false';
    for (let i = 0; i < 2; i++) if (!click('#pickPlayersList .chip--select', i)) return 'false';
    const roll = document.getElementById('pickRollBtn');
    if (!roll || roll.disabled) return 'false';
    roll.click();
    return 'true';
  })()`,
};

/* ── The measurement, as it runs in the page ──────────────────────────────
 * A string because it is evaluated in the browser, not here. It returns
 * JSON so the driver side stays free of DOM types. */
const MEASURE = scope => `(() => {
  /* Sideways scroll is always the whole document's business; touch targets
     are only the scoped view's, when a view is scoped at all. */
  const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
  if (!root) return JSON.stringify({ error: 'nothing matches ${scope}' });
  const viewport = document.documentElement.clientWidth;
  /* Read before anything below scrolls the page around looking for
     targets, so both halves of the report describe the same layout. */
  const scrollWidth = Math.round(document.documentElement.scrollWidth);

  /* ── Overflow ────────────────────────────────────────────────────────
   * The document's own scroll width is the symptom; the culprits are the
   * elements sticking out past the right edge. An element inside a
   * container that scrolls horizontally *on purpose* is not one of them —
   * that is a wide table doing exactly what §9 asks of it — so the walk up
   * the ancestors stops at the first scroller and the element is excused. */
  const scrolls = el => {
    const o = getComputedStyle(el).overflowX;
    return (o === 'auto' || o === 'scroll') && el.scrollWidth > el.clientWidth + 1;
  };
  const insideAScroller = el => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (scrolls(n)) return true;
    }
    return false;
  };

  const name = el => {
    const cls = el.className && el.className.toString().split(/\\s+/).filter(Boolean);
    return el.tagName.toLowerCase()
      + (el.id ? '#' + el.id : '')
      + (cls && cls.length ? '.' + cls.slice(0, 3).join('.') : '');
  };

  /* A closed drawer is not "hidden" in any way a computed style admits to:
     the RSS panel and the builder's search panel collapse to zero width
     with their contents clipped, so every button inside them still has a
     rect, and it sits out past the edge of the screen. An element whose
     box falls entirely outside a clipping ancestor is not on the page. */
  const clipped = el => {
    const r = el.getBoundingClientRect();
    for (let n = el.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const nr = n.getBoundingClientRect();
      if (cs.overflowX !== 'visible' && (r.right <= nr.left || r.left >= nr.right)) return true;
      if (cs.overflowY !== 'visible' && (r.bottom <= nr.top || r.top >= nr.bottom)) return true;
    }
    return false;
  };

  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    return !clipped(el);
  };

  const over = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    /* position:fixed chrome measured against the viewport is the same test;
     * what matters is that nothing paints past the right edge or before the
     * left one. A 1px slack absorbs subpixel layout. */
    if (r.right <= viewport + 1 && r.left >= -1) continue;
    if (insideAScroller(el)) continue;
    over.push(el);
  }
  /* Only worth naming when the document actually scrolls: an off-canvas
   * drawer parked past the right edge sticks out of the viewport on
   * purpose and drags no scrollbar with it.
   *
   * And then only the innermost of each nest — an overflowing child drags
   * its parents out with it, so reporting the whole chain buries the one
   * element that is actually too wide. An element with an overflowing
   * descendant is a symptom, not a cause. */
  const culprits = scrollWidth <= viewport + 1 ? [] : over
    .filter(el => !over.some(other => other !== el && el.contains(other)))
    .slice(0, 20)
    .map(el => {
      const r = el.getBoundingClientRect();
      return { selector: name(el), left: Math.round(r.left), right: Math.round(r.right) };
    });

  /* ── Touch targets ───────────────────────────────────────────────────
   * Everything a finger is meant to hit. An inline link inside running
   * text is prose, not a control, and is excluded: it cannot be 44px tall
   * without breaking the line box it lives in. */
  const CONTROL = 'button, a[href], input, select, textarea, summary, [role="button"], [onclick]';
  const PROSE = 'p, .card-oracle, .card-flavor, .card-ruling-text, .help-text, .empty-state';

  /* What is measured is the area a finger can land on, not the box the
   * control paints, because on a phone those are deliberately not the same
   * thing: a ✕ set into a dense table keeps its small painted box and
   * gains an invisible pad around it. A bounding rect cannot see that pad;
   * a hit test can, so the area is found the way a tap finds it — by
   * asking the document what is under a point and walking outwards until
   * the answer changes.
   *
   * It also catches the two failures a rect would miss entirely: a target
   * whose pad is covered by something painted over it, and two neighbours
   * whose pads overlap so that one of them swallows the other's edge. */
  const hits = (el, label, x, y) => {
    const t = document.elementFromPoint(x, y);
    if (!t) return false;
    return t === el || el.contains(t) || (label && (t === label || label.contains(t)));
  };

  /* How far the target reaches in one direction, found by bisection
   * between the centre and the point where the answer changes. Bisection
   * rather than a walk because the answer wanted is a distance, not a
   * count of pixels, and the boundary does not land on whole ones. */
  const reach = (el, label, cx, cy, dx, dy, limit) => {
    if (hits(el, label, cx + dx * limit, cy + dy * limit)) return limit;
    let lo = 0, hi = limit;
    for (let i = 0; i < 14; i++) {
      const m = (lo + hi) / 2;
      if (hits(el, label, cx + dx * m, cy + dy * m)) lo = m; else hi = m;
    }
    return lo;
  };

  const hitArea = el => {
    /* elementFromPoint answers about the viewport, so a control below the
     * fold has to be brought into it first. Centred, to keep it out from
     * under the sticky header. */
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    /* A closed off-canvas drawer parks itself past the edge of the screen
       with a transform rather than by clipping, so scrolling cannot bring
       it into view and there is nothing under its centre to hit. Not a
       finding: it is shut. */
    if (cx < 0 || cy < 0 || cx >= viewport || cy >= document.documentElement.clientHeight) return null;
    /* A label pointing at the control is part of its target: clicking the
     * text of a checkbox's label activates the checkbox. */
    const label = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    if (!hits(el, label, cx, cy)) return { ok: false, width: 0, height: 0, covered: true };
    const limit = ${TARGET_MIN};
    const width  = reach(el, label, cx, cy, -1, 0, limit) + reach(el, label, cx, cy, 1, 0, limit);
    const height = reach(el, label, cx, cy, 0, -1, limit) + reach(el, label, cx, cy, 0, 1, limit);
    /* A pixel of slack, and it is the ruler's rather than the design's:
     * Firefox snaps the far edge of a hit region down to a whole pixel, so
     * a control laid out on a fractional boundary — which at these widths
     * is most of them — hit-tests up to a pixel narrower than the 44 its
     * computed style says it is. Reporting that as a failure would be
     * reporting the browser's rasterisation as a design fault. */
    return {
      ok: width >= ${TARGET_MIN} - 1 && height >= ${TARGET_MIN} - 1,
      width:  Math.round(width * 10) / 10,
      height: Math.round(height * 10) / 10,
      covered: false,
    };
  };

  const small = [];
  for (const el of root.querySelectorAll(CONTROL)) {
    if (!visible(el)) continue;
    if (el.type === 'hidden') continue;
    if (el.closest(PROSE)) continue;
    /* A control nested inside another control is one target, not two. */
    if (el.parentElement && el.parentElement.closest(CONTROL)) continue;
    /* A box already big enough needs no hit test — the pad can only add. */
    const r = el.getBoundingClientRect();
    if (r.width >= ${TARGET_MIN} - 0.5 && r.height >= ${TARGET_MIN} - 0.5) continue;
    const a = hitArea(el);
    if (!a || a.ok) continue;
    small.push({
      selector: name(el),
      width: a.width,
      height: a.height,
      covered: a.covered,
    });
  }

  /* The same control repeated down a list is one finding, not forty. */
  const tally = new Map();
  for (const s of small) {
    const key = s.selector + '|' + s.width + 'x' + s.height;
    const seen = tally.get(key);
    if (seen) seen.count++;
    else tally.set(key, { ...s, count: 1 });
  }

  return JSON.stringify({
    viewport,
    scrollWidth,
    overflow: scrollWidth - viewport,
    culprits,
    targets: [...tally.values()].sort((a, b) => a.width * a.height - b.width * b.height),
  });
})()`;

/* Once, on the app's own origin, before the first measurement: localStorage
 * belongs to the origin rather than to the document, so one visit is enough
 * for every load that follows — and it has to be a visit, because the ids are
 * read out of the page's own script. */
async function seedNotesAsRead(session, context, base) {
  await session.send('browsingContext.navigate', { context, url: base, wait: 'complete' });
  await session.waitForNetworkIdle();
  const res = await session.send('script.evaluate', {
    expression: SEED_SEEN, target: { context }, awaitPromise: false,
  });
  if (res.type === 'exception') throw new Error(res.exceptionDetails.text);
  if (res.result.value !== 'true') throw new Error('the app served no FAQ_TABS to seed from');
}

async function measureTab(session, context, url, tab) {
  await session.send('browsingContext.navigate', { context, url: 'about:blank', wait: 'complete' });
  await session.send('browsingContext.setViewport', {
    context, viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
  });
  await session.send('browsingContext.navigate', { context, url, wait: 'complete' });
  await session.waitForNetworkIdle();
  await sleep(400);

  if (PREP[tab]) {
    await session.send('script.evaluate', {
      expression: PREP[tab], target: { context }, awaitPromise: false,
    });
    await session.waitForNetworkIdle({ timeoutMs: 45_000 });
    await sleep(1200);
  }

  const res = await session.send('script.evaluate', {
    expression: MEASURE(SCOPES[tab]), target: { context }, awaitPromise: false,
  });
  if (res.type === 'exception') throw new Error(res.exceptionDetails.text);
  return JSON.parse(res.result.value);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if ('help' in opts || 'h' in opts) {
    console.log(`Usage: node scripts/measure-mobile.js [options]

  --url <base>      Measure an already-running app instead of starting one
  --port <port>     Port for the app server this script starts (default: 3402)
  --data <file>     DATA_FILE for the app server (default: the repo's data/)
  --browser <path>  Firefox binary (default: firefox)
  --tabs <a,b>      Subset of ${[...TABS, ...Object.keys(EXTRA_VIEWS)].join(',')}
  --card <name>     Card to open on the card tab (default: Lightning Bolt)
  --json            Machine-readable output`);
    return;
  }

  const views = [...TABS, ...Object.keys(EXTRA_VIEWS)];
  const tabs = opts.tabs ? opts.tabs.split(',').map(s => s.trim()).filter(Boolean) : views;
  const card = opts.card || 'Lightning Bolt';
  const cleanups = [];
  const rows = [];
  const failures = [];

  try {
    let base = opts.url;
    if (base) {
      base = base.replace(/\/$/, '');
      await waitForHttp(`${base}/healthz`, 5_000, 'the app server');
    } else {
      const port = Number(opts.port || 3402);
      const server = await startServer(port, opts.data);
      cleanups.push(() => server.child.kill('SIGTERM'));
      base = server.base;
    }
    await assertOpenMode(base);

    const debugPort = 9225;
    const firefox = await startFirefox(opts.browser || 'firefox', debugPort);
    cleanups.push(() => {
      firefox.child.kill('SIGTERM');
      fs.rmSync(firefox.profile, { recursive: true, force: true });
    });
    const session = await Promise.race([BidiSession.connect(debugPort), firefox.failed]);
    cleanups.push(() => session.close());
    await session.send('session.new', { capabilities: { alwaysMatch: {} } });
    await session.send('session.subscribe', {
      events: ['network.beforeRequestSent', 'network.responseCompleted', 'network.fetchError'],
    });
    const tree    = await session.send('browsingContext.getTree', {});
    const context = tree.contexts[0].context;
    await seedNotesAsRead(session, context, base);

    for (const tab of tabs) {
      const hash = tab === 'card' ? `card=${encodeURIComponent(card)}` : (EXTRA_VIEWS[tab] || tab);
      const m = await measureTab(session, context, `${base}/?theme=${THEME}#${hash}`, tab);
      if (m.error) { failures.push(`${tab}: ${m.error}`); continue; }
      rows.push({ tab, ...m });

      if (m.overflow > 0) {
        failures.push(`${tab}: page scrolls ${m.overflow}px sideways`);
        for (const c of m.culprits.slice(0, 6)) {
          failures.push(`    ${c.selector} spans ${c.left}…${c.right}`);
        }
      }
      for (const t of m.targets) {
        const how = t.covered
          ? 'is not hittable at its own centre — something is painted over it'
          : `has a ${t.width}x${t.height} hit area`;
        failures.push(`${tab}: ${t.selector} ${how}`
          + (t.count > 1 ? ` (x${t.count})` : ''));
      }
    }
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try { cleanup(); } catch { /* best effort */ }
    }
  }

  if ('json' in opts) {
    console.log(JSON.stringify({ rows, failures }, null, 2));
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(`${pad('tab', 17)}${pad('overflow', 10)}undersized targets`);
    for (const r of rows) {
      const under = r.targets.reduce((n, t) => n + t.count, 0);
      console.log(pad(r.tab, 17) + pad(r.overflow ? `${r.overflow}px  ✗` : '—', 10)
        + (under ? `${under}  ✗` : '—'));
    }
  }

  if (failures.length) {
    console.error(`\nmobile: ${failures.length} problem(s) at ${VIEWPORT.width}px`);
    for (const f of failures) console.error(`  ${f}`);
    process.exitCode = 1;
  } else if (!('json' in opts)) {
    /* Not on stdout under --json: the caller is parsing it. */
    console.log(`\nmobile: no sideways scroll, every target at least ${TARGET_MIN}x${TARGET_MIN}`);
  }
}

if (require.main === module) {
  main().then(
    () => process.exit(process.exitCode || 0),
    err => { console.error(`\nmeasure-mobile: ${err.message}`); process.exit(1); },
  );
}
