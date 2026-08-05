#!/usr/bin/env node
'use strict';

/**
 * Measure the two width behaviours (§8.3) in the running app, because the
 * layout ticket's acceptance criteria are numbers and eyeballing a
 * screenshot cannot produce one.
 *
 * Four questions, one per criterion:
 *
 *   chrome  How much of the window is not content? Everything horizontal
 *           the page spends on itself — the sidebar, the shell's inline
 *           padding — at a 1440px window. Must be under 80px.
 *   prose   Is any block of running text wider than the reading measure?
 *           Must be none.
 *   wide    Do grids and tables actually use what is left? Measured at an
 *           ultrawide window, where a surviving cap would be obvious.
 *   fold    How far down the window is the first card? The vertical twin
 *           of chrome: what a tab spends on itself before showing the
 *           thing it is for. Budgeted per tab, since a tab with no card
 *           grid has no answer.
 *
 * Sibling of scripts/check-contrast.js: both take a property the redesign
 * claims, measure it against the app as served, and fail if it does not
 * hold. The browser plumbing is capture-screens.js's, imported rather than
 * copied.
 *
 *   node scripts/measure-layout.js
 *   node scripts/measure-layout.js --tabs collections,card --json
 */

const fs = require('fs');
const {
  BidiSession, startServer, startFirefox, assertOpenMode, waitForHttp, parseArgs,
} = require('./capture-screens.js');

/* Every tab, plus the card detail, which has no tab of its own. Narrowing
 * this to the interesting-looking tabs is exactly how a stray paragraph gets
 * missed: the run that first measured five of them passed, and the Mana Base
 * tab it skipped had three paragraphs running 965px. */
const TABS = [
  'available', 'collections', 'players', 'scryfall', 'card',
  'sets', 'wants', 'lands', 'deckview', 'pick', 'admin',
];

/* Windows. 1440 is the criterion's width; 2560 is where a surviving cap
 * would show up as empty margin rather than as a slightly narrower grid. */
const VIEWPORTS = [
  { name: 'desktop',   width: 1440, height: 900 },
  { name: 'ultrawide', width: 2560, height: 1080 },
];

const CHROME_BUDGET = 80;   // px, at 1440 (§8.4 predicts ~78)

/* Vertical chrome, per tab, at 1440. Only the tabs whose tickets state a
 * number are listed: a budget nobody wrote down is not a budget, and the
 * remaining tabs' card grids arrive with issues 15-19. */
const FOLD_BUDGETS = {
  collections: 105,   // §9.1 predicts ~96, criterion says ~100
  scryfall:    70,    // §9.2 — one strip and nothing else above the results
  sets:        70,    // §9.3 — the same strip, with the set as a chip on it
  wants:       105,   // §9.4 — the strip plus the player filter row, as Collections
  pick:        150,   // §9.7 — the strip, the players row, and the results' own bar
};

/* Three of those tabs show nothing until asked, and a fold measured against an
 * empty page is not a measurement. So they are asked, the way a person would:
 * a query typed and entered, a set tile clicked, an evening's decks picked. A
 * tab absent from here needs no preparation; one whose step finds nothing to
 * click reports no fold, which fails its budget rather than passing it
 * quietly. */
const FOLD_PREP = {
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
  /* Pick Night's pool is opt-in and starts empty, so an evening has to be set
   * up before there is anything to measure: four decks into the pool, two
   * players chosen, roll. Each click re-renders the row it was in, which is
   * why every one of them re-queries rather than walking a NodeList captured
   * before the first click — those nodes are detached by the time the second
   * click lands. */
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── The measurement, as it runs in the page ──────────────────────────────
 * A string because it is evaluated in the browser, not here. It returns
 * JSON so the driver side stays free of DOM types. */
const MEASURE = `(() => {
  const shell = document.querySelector('.content-wide');
  if (!shell) return JSON.stringify({ error: 'no .content-wide shell on the page' });

  // documentElement.clientWidth, not innerWidth: the latter counts the
  // scrollbar, which would flatter the chrome number by ~15px.
  const windowWidth = document.documentElement.clientWidth;

  const cs = getComputedStyle(shell);
  const contentWidth =
    shell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);

  // The measure in pixels, resolved the same way the stylesheet resolves it
  // — 72ch depends on the font actually in use, so it is asked of a probe
  // rather than assumed.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--measure)';
  shell.appendChild(probe);
  const measure = probe.getBoundingClientRect().width;
  probe.remove();

  // Running text, and only running text. A table cell holding a long card
  // name is data in a column, not a paragraph, and is not this rule's
  // business.
  // 'p' is here so the list does not have to stay complete by hand: a
  // paragraph element is prose by definition, whatever it is called. The
  // named classes are the blocks of running text that are not <p>.
  const PROSE = [
    'p', '.content-prose', '.empty-state', '.card-oracle', '.card-flavor',
    '.card-ruling-text', '.help-text', '.login-sub',
  ];

  // The criterion is about *lines*, not boxes, so what is measured is the
  // rendered line box: a Range over the element's contents returns one rect
  // per line. Measuring the container instead reports a short centred
  // sentence in a full-width table cell as a 2482px line, which it plainly
  // is not — and would still miss nothing, since a line can never be wider
  // than the box it wraps inside.
  const widestLine = el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    let widest = 0;
    for (const r of range.getClientRects()) widest = Math.max(widest, r.width);
    return widest;
  };
  const visible = el => el.getBoundingClientRect().width > 0 && el.textContent.trim();
  const prose = [...document.querySelectorAll(PROSE.join(','))]
    .filter(visible)
    .map(el => ({
      selector: el.className.toString().split(/\\s+/).filter(Boolean).map(c => '.' + c).join('') || el.tagName.toLowerCase(),
      width: Math.round(widestLine(el)),
    }));

  // .deck-tiles-grid is a grid of commander art rather than of card images,
  // but the question this column asks — does the widest thing on the tab
  // take what the window gives it — is the same one, and on Players & Decks
  // it is the only thing that can answer it.
  const WIDE = ['.card-grid', '.cards-grid', '.deck-tiles-grid', '.table-wrap', 'table'];
  const wide = [...document.querySelectorAll(WIDE.join(','))]
    .filter(visible)
    .map(el => Math.round(el.getBoundingClientRect().width));

  return JSON.stringify({
    windowWidth,
    contentWidth: Math.round(contentWidth),
    chrome: Math.round(windowWidth - contentWidth),
    measure: Math.round(measure),
    prose,
    widest: wide.length ? Math.max(...wide) : null,
  });
})()`;

/* ── The fold ─────────────────────────────────────────────────────────────
 * Asked in two steps, and after the measurement above, because the first
 * step changes the page: the criterion is about *card art*, and a tab
 * whose list view is the default is showing no art at all. So the view
 * toggle is clicked the way a person would click it, and then the top of
 * the first card is read off the viewport. A tab with no grid returns
 * null rather than a number that would mean nothing. */
const SHOW_GRID = `(() => {
  const pane = [...document.querySelectorAll('.tab-pane')].find(p => p.style.display !== 'none');
  const btn = pane && pane.querySelector('.view-btn[data-mode="grid"]');
  if (btn) btn.click();
  return String(!!btn);
})()`;

/* .sf-grid is beside .card-grid here because the app has two card grids: the
 * Collections one and the one the Scryfall, Set Browser, Want List and Deck
 * Builder views share. §7.7 describes them as one component and they are not
 * one yet; until they are, the fold has to know both names.
 *
 * .pick-results-grid is a third thing and not a card grid at all — its tiles
 * are commander art rather than card images — but the question the fold asks
 * is "how far down is the thing this tab is for", and on Pick Night that is
 * the picked deck.
 *
 * .card-detail-img is here for the same reason. The card tab's only grid is
 * the printings gallery at the *bottom* of the page, so without it that tab
 * reported how far down its footnote sits rather than how far down the card
 * is. The image is the first of these in the document, and document order is
 * what querySelector answers with. */
const FOLD = `(() => {
  const pane = [...document.querySelectorAll('.tab-pane')].find(p => p.style.display !== 'none');
  const card = pane && pane.querySelector('.card-detail-img, .grid-card, .card-grid > *, .sf-grid > *, .pick-results-grid > *');
  if (!card) return 'null';
  return String(Math.round(card.getBoundingClientRect().top));
})()`;

async function measureView(session, context, url, viewport, tab) {
  await session.send('browsingContext.navigate', { context, url: 'about:blank', wait: 'complete' });
  await session.send('browsingContext.setViewport', {
    context, viewport: { width: viewport.width, height: viewport.height },
  });
  await session.send('browsingContext.navigate', { context, url, wait: 'complete' });
  await session.waitForNetworkIdle();
  await sleep(400);

  const res = await session.send('script.evaluate', {
    expression: MEASURE, target: { context }, awaitPromise: false,
  });
  if (res.type === 'exception') throw new Error(res.exceptionDetails.text);
  const m = JSON.parse(res.result.value);

  if (FOLD_PREP[tab]) {
    await session.send('script.evaluate', {
      expression: FOLD_PREP[tab], target: { context }, awaitPromise: false,
    });
    await session.waitForNetworkIdle({ timeoutMs: 45_000 });
    await sleep(1200);   // the results render, then their images arrive
  }

  const shown = await session.send('script.evaluate', {
    expression: SHOW_GRID, target: { context }, awaitPromise: false,
  });
  if (shown.type !== 'exception' && shown.result.value === 'true') {
    await session.waitForNetworkIdle();
    await sleep(600);   // the grid renders placeholders, then the images
  }
  const fold = await session.send('script.evaluate', {
    expression: FOLD, target: { context }, awaitPromise: false,
  });
  m.fold = fold.type === 'exception' || fold.result.value === 'null'
    ? null : Number(fold.result.value);
  return m;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if ('help' in opts || 'h' in opts) {
    console.log(`Usage: node scripts/measure-layout.js [options]

  --url <base>      Measure an already-running app instead of starting one
  --port <port>     Port for the app server this script starts (default: 3401)
  --data <file>     DATA_FILE for the app server (default: the repo's data/)
  --browser <path>  Firefox binary (default: firefox)
  --tabs <a,b>      Subset of ${TABS.join(',')}
  --card <name>     Card to open on the card tab (default: Lightning Bolt)
  --json            Machine-readable output`);
    return;
  }

  const tabs = opts.tabs ? opts.tabs.split(',').map(s => s.trim()).filter(Boolean) : TABS;
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
      const port = Number(opts.port || 3401);
      const server = await startServer(port, opts.data);
      cleanups.push(() => server.child.kill('SIGTERM'));
      base = server.base;
    }
    await assertOpenMode(base);

    const debugPort = 9224;
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

    for (const viewport of VIEWPORTS) {
      for (const tab of tabs) {
        // The card tab is empty until a card is opened, and an empty card
        // tab has no prose to measure.
        const hash = tab === 'card' ? `card=${encodeURIComponent(card)}` : tab;
        const m = await measureView(session, context, `${base}/#${hash}`, viewport, tab);
        if (m.error) { failures.push(`${tab} @ ${viewport.name}: ${m.error}`); continue; }

        const overrun = m.prose.filter(p => p.width > m.measure + 1);
        rows.push({ tab, viewport: viewport.name, ...m, overrun });

        if (viewport.width === 1440 && m.chrome >= CHROME_BUDGET) {
          failures.push(`${tab} @ ${viewport.name}: ${m.chrome}px of chrome, budget is ${CHROME_BUDGET}`);
        }
        if (viewport.width === 1440 && FOLD_BUDGETS[tab] != null) {
          if (m.fold == null) {
            failures.push(`${tab} @ ${viewport.name}: no card grid found to measure the fold against`);
          } else if (m.fold > FOLD_BUDGETS[tab]) {
            failures.push(`${tab} @ ${viewport.name}: first card at ${m.fold}px, budget is ${FOLD_BUDGETS[tab]}`);
          }
        }
        for (const p of overrun) {
          failures.push(`${tab} @ ${viewport.name}: ${p.selector} is ${p.width}px, measure is ${m.measure}`);
        }
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
    console.log(`${pad('tab', 13)}${pad('window', 11)}${pad('chrome', 9)}${pad('content', 9)}${pad('widest grid', 13)}${pad('fold', 8)}prose ≤ measure`);
    for (const r of rows) {
      const proseNote = r.prose.length
        ? `${Math.max(...r.prose.map(p => p.width))} ≤ ${r.measure}${r.overrun.length ? '  ✗' : ''}`
        : '—';
      console.log(
        pad(r.tab, 13) + pad(`${r.windowWidth}px`, 11) + pad(`${r.chrome}px`, 9) +
        pad(`${r.contentWidth}px`, 9) + pad(r.widest == null ? '—' : `${r.widest}px`, 13) +
        pad(r.fold == null ? '—' : `${r.fold}px`, 8) + proseNote);
    }
  }

  if (failures.length) {
    console.error(`\nlayout: ${failures.length} problem(s)`);
    for (const f of failures) console.error(`  ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nlayout: chrome and fold within budget, no prose past the measure');
  }
}

if (require.main === module) {
  main().then(
    () => process.exit(process.exitCode || 0),
    err => { console.error(`\nmeasure-layout: ${err.message}`); process.exit(1); },
  );
}
