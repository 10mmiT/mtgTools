#!/usr/bin/env node
'use strict';

/**
 * Capture every screen of the app — 11 tabs × 5 themes × 2 viewports = 110 PNGs
 * plus a contact sheet that shows them all on one page.
 *
 * This is a human review aid, not an assertion: nothing here compares images.
 * Capture a set before a change and a set after it, then look at both.
 *
 *   node scripts/capture-screens.js --name baseline
 *   node scripts/capture-screens.js --name phase-2 --tabs collections,wants
 *   node scripts/capture-screens.js --url http://localhost:3000   # already-running app
 *   node scripts/capture-screens.js --viewports tablet,tablet-wide  # 900px boundary
 *
 * No new dependencies: the app server is started in open mode (so no login is
 * needed), and the Firefox already installed on the machine is driven headless
 * over WebDriver BiDi, which Node can speak with its built-in WebSocket.
 */

const { spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// The eleven tabs, in sidebar order. Each is reached through the app's own
// hash routing, so the capture exercises the same entry point a deep link does.
const TABS = [
  'available', 'collections', 'players', 'scryfall', 'card',
  'sets', 'wants', 'lands', 'deckview', 'pick', 'admin',
];

const THEMES = ['dark', 'light', 'contrast', 'sepia', 'dusk'];

// The two tablet widths straddle the 900px breakpoint deliberately, and are
// not in the default set — they exist to check the band the breakpoint
// consolidation moved, which neither 1440 nor 390 passes through.
const VIEWPORTS = [
  { name: 'desktop',     width: 1440, height:  900 },
  { name: 'phone',       width:  390, height:  844 },
  { name: 'tablet',      width:  880, height: 1000 },  // just below 900: bottom nav, card tab
  { name: 'tablet-wide', width:  960, height: 1000 },  // just above 900: sidebar, card modal
];

const DEFAULT_VIEWPORTS = ['desktop', 'phone'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Arguments ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const eq = arg.indexOf('=');
    if (eq !== -1) opts[arg.slice(2, eq)] = arg.slice(eq + 1);
    else opts[arg.slice(2)] = argv[++i] ?? '';
  }
  return opts;
}

function pickList(value, all, label, fallback = all) {
  if (!value) return fallback;
  const picked = value.split(',').map(s => s.trim()).filter(Boolean);
  // Anything containing '=' is passed through as a literal hash rather than
  // checked against the list. That is how a view with no tab of its own gets
  // captured — an open card detail is `--tabs 'card=Sol Ring'`. The default
  // set is still the eleven tabs, so the standard run stays at 110 shots.
  const unknown = picked.filter(p => !all.includes(p) && !p.includes('='));
  if (unknown.length) throw new Error(`Unknown ${label}: ${unknown.join(', ')} (known: ${all.join(', ')})`);
  return picked;
}

// ── App server (open mode) ────────────────────────────────────────────
async function waitForHttp(url, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what} at ${url}`);
    await sleep(200);
  }
}

async function startServer(port, dataFile) {
  // Blanking both password vars puts server.js in open mode, which is what
  // makes an unattended capture possible — no session cookie to obtain.
  const env = { ...process.env, PORT: String(port), ADMIN_PASSWORD: '', APP_PASSWORD: '' };
  if (dataFile) env.DATA_FILE = path.resolve(dataFile);
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  child.stdout.on('data', d => log.push(d.toString()));
  child.stderr.on('data', d => log.push(d.toString()));
  child.on('exit', code => {
    if (code !== 0 && code !== null) console.error(log.join(''));
  });

  const base = `http://127.0.0.1:${port}`;
  await waitForHttp(`${base}/healthz`, 20_000, 'the app server');
  return { child, base };
}

async function assertOpenMode(base) {
  const res  = await fetch(`${base}/api/auth-status`);
  const json = await res.json();
  if (json.protected) {
    throw new Error(
      `${base} is running with a password set. Capture needs open mode — ` +
      'start the app without ADMIN_PASSWORD/APP_PASSWORD, or drop --url.');
  }
}

// ── Firefox over WebDriver BiDi ───────────────────────────────────────
function startFirefox(binary, port) {
  // Its own profile and --no-remote: the capture must not attach to, or
  // disturb, whatever Firefox window the machine's owner already has open.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgtools-capture-'));
  const child = spawn(binary, [
    '--headless', '--no-remote',
    '--profile', profile,
    '--remote-debugging-port', String(port),
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const errors = [];
  child.stderr.on('data', d => errors.push(d.toString()));
  child.on('exit', code => { if (code) console.error(errors.join('')); });

  // A missing binary surfaces as an async 'error' event, so it has to be raced
  // against the connect attempt rather than waited out as a 30s timeout.
  const failed = new Promise((_, reject) => child.on('error', err => reject(
    new Error(`Could not start ${binary} (${err.message}). Pass --browser <path> if Firefox lives elsewhere.`))));
  failed.catch(() => { /* only meaningful when raced */ });

  return { child, profile, failed };
}

/**
 * The slice of WebDriver BiDi this script needs: request/response correlation
 * by id, plus a count of in-flight requests so a screenshot can wait until the
 * page has stopped fetching rather than after a guessed delay.
 */
class BidiSession {
  constructor(ws) {
    this.ws       = ws;
    this.nextId   = 1;
    this.pending  = new Map();
    this.inflight = 0;
    this.lastNetworkActivity = 0;

    ws.addEventListener('message', e => this._onMessage(JSON.parse(e.data)));
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('Browser connection closed'));
      this.pending.clear();
    });
  }

  /**
   * Firefox no longer speaks CDP, so there is no HTTP endpoint to poll while it
   * boots — the BiDi socket coming up is itself the readiness signal.
   */
  static async connect(port, { timeoutMs = 30_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
      const opened = await new Promise(resolve => {
        ws.addEventListener('open',  () => resolve(true),  { once: true });
        ws.addEventListener('error', () => resolve(false), { once: true });
      });
      if (opened) return new BidiSession(ws);
      try { ws.close(); } catch { /* never opened */ }
      if (Date.now() > deadline) throw new Error(`Firefox did not open a WebDriver BiDi socket on port ${port}`);
      await sleep(250);
    }
  }

  _onMessage(msg) {
    if (msg.type === 'event') {
      if (msg.method === 'network.beforeRequestSent') this.inflight++;
      else if (msg.method === 'network.responseCompleted' || msg.method === 'network.fetchError') {
        this.inflight = Math.max(0, this.inflight - 1);
      } else return;
      this.lastNetworkActivity = Date.now();
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (msg.type === 'success') entry.resolve(msg.result);
    else entry.reject(new Error(`${msg.error}: ${msg.message}`));
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  /** Resolves once nothing has been fetched for `idleMs`, or on timeout. */
  async waitForNetworkIdle({ idleMs = 500, timeoutMs = 15_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    this.lastNetworkActivity = Date.now();
    while (Date.now() < deadline) {
      if (this.inflight === 0 && Date.now() - this.lastNetworkActivity >= idleMs) return true;
      await sleep(50);
    }
    return false; // a request is wedged; capture what is on screen anyway
  }

  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

// ── Capture ───────────────────────────────────────────────────────────
async function captureView(session, context, { url, viewport, file, settleMs, maxHeight }) {
  // about:blank first: the app reads the theme parameter and the tab hash once,
  // at load, so every view needs its own document rather than a hash change.
  await session.send('browsingContext.navigate', { context, url: 'about:blank', wait: 'complete' });
  await session.send('browsingContext.setViewport', {
    context, viewport: { width: viewport.width, height: viewport.height },
  });
  await session.send('browsingContext.navigate', { context, url, wait: 'complete' });

  const quiet = await session.waitForNetworkIdle();
  await sleep(settleMs);

  // A tab holding a real collection runs to tens of thousands of pixels, which
  // is neither reviewable nor thumbnailable — so the capture is the top of the
  // document, deep enough to judge the design, and no deeper.
  const size = await session.send('script.evaluate', {
    expression: 'JSON.stringify({w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight})',
    target: { context }, awaitPromise: false,
  });
  const { w, h } = JSON.parse(size.result.value);
  const width  = Math.max(w, viewport.width);
  const height = maxHeight > 0 ? Math.min(h, maxHeight) : h;

  let result;
  try {
    result = await session.send('browsingContext.captureScreenshot', {
      context, origin: 'document',
      clip: { type: 'box', x: 0, y: 0, width, height },
    });
  } catch (err) {
    // Some panes still exceed the browser's maximum surface size — falling back
    // to the visible viewport beats losing the view entirely.
    console.warn(`    full-page capture failed (${err.message}); falling back to viewport`);
    result = await session.send('browsingContext.captureScreenshot', { context, origin: 'viewport' });
  }
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  return { quiet, clippedFrom: height < h ? h : 0 };
}

// ── Contact sheet ─────────────────────────────────────────────────────
function writeContactSheet(outDir, shots, meta) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const groups = [];
  for (const viewport of meta.viewports) {
    for (const theme of meta.themes) {
      const items = shots.filter(s => s.viewport === viewport.name && s.theme === theme);
      if (items.length) groups.push({ title: `${theme} — ${viewport.name}`, items });
    }
  }

  const html = `<!doctype html>
<meta charset="utf-8">
<title>MTG Tools screens — ${esc(meta.name)}</title>
<style>
  body { margin: 0; padding: 24px; background: #14161a; color: #e6e8ec;
         font: 14px/1.5 system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #8b93a1; margin-bottom: 28px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .08em;
       color: #8b93a1; margin: 32px 0 12px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  figure { margin: 0; background: #1c1f26; border: 1px solid #2a2f3a; border-radius: 8px; overflow: hidden; }
  figcaption { padding: 8px 10px; font-size: 12px; color: #b9c0cc; }
  img { display: block; width: 100%; height: 220px; object-fit: cover; object-position: top; background: #000; }
  a { color: inherit; text-decoration: none; }
</style>
<h1>MTG Tools screens — ${esc(meta.name)}</h1>
<div class="meta">${shots.length} views · captured ${esc(meta.capturedAt)} · ${esc(meta.commit)}</div>
${groups.map(g => `<h2>${esc(g.title)}</h2>
<div class="grid">
${g.items.map(s => `  <figure><a href="${esc(s.fileName)}" target="_blank">
    <img src="${esc(s.fileName)}" alt="${esc(s.tab)}" loading="lazy">
    <figcaption>${esc(s.tab)}</figcaption>
  </a></figure>`).join('\n')}
</div>`).join('\n')}
`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if ('help' in opts || 'h' in opts) {
    console.log(`Usage: node scripts/capture-screens.js [options]

  --name <name>       Output folder under .scratch/ui-redesign/shots (default: latest)
  --out <dir>         Output directory outright, overriding --name
  --url <base>        Capture an already-running app instead of starting one
  --port <port>       Port for the app server this script starts (default: 3399)
  --data <file>       DATA_FILE for the app server, to capture a different
                      database (default: the repo's data/ directory)
  --browser <path>    Firefox binary (default: firefox)
  --tabs <a,b>        Subset of tabs (default: all 11)
  --themes <a,b>      Subset of themes (default: all 5)
  --viewports <a,b>   desktop, phone, tablet (880px), tablet-wide (960px)
                      (default: desktop,phone — the tablet pair straddles the
                      900px breakpoint and is opt-in)
  --settle <ms>       Pause after the network goes quiet (default: 400)
  --max-height <px>   Clip tall pages to this height, 0 for none (default: 4000)`);
    return;
  }

  const tabs      = pickList(opts.tabs, TABS, 'tabs');
  const themes    = pickList(opts.themes, THEMES, 'themes');
  const viewports = pickList(opts.viewports, VIEWPORTS.map(v => v.name), 'viewports', DEFAULT_VIEWPORTS)
    .map(name => VIEWPORTS.find(v => v.name === name));
  const settleMs  = Number(opts.settle ?? 400);
  const maxHeight = Number(opts['max-height'] ?? 4000);
  const name      = opts.name || 'latest';
  const outDir    = path.resolve(opts.out || path.join(ROOT, '.scratch', 'ui-redesign', 'shots', name));

  fs.mkdirSync(outDir, { recursive: true });
  for (const stale of fs.readdirSync(outDir)) {
    if (stale.endsWith('.png') || stale === 'index.html') fs.rmSync(path.join(outDir, stale));
  }

  const cleanups = [];
  let failures = 0;
  try {
    let base = opts.url;
    if (base) {
      base = base.replace(/\/$/, '');
      await waitForHttp(`${base}/healthz`, 5_000, 'the app server');
    } else {
      const port = Number(opts.port || 3399);
      console.log(`Starting the app in open mode on port ${port}…`);
      const server = await startServer(port, opts.data);
      cleanups.push(() => server.child.kill('SIGTERM'));
      base = server.base;
    }
    await assertOpenMode(base);

    const debugPort = 9223;
    console.log('Starting headless Firefox…');
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

    const total = tabs.length * themes.length * viewports.length;
    const shots = [];
    let done = 0;

    for (const viewport of viewports) {
      for (const theme of themes) {
        for (const tab of tabs) {
          const slug = tab.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
          const fileName = `${slug}--${theme}--${viewport.name}.png`;
          const url = `${base}/?theme=${theme}#${tab}`;
          done++;
          process.stdout.write(`[${String(done).padStart(3)}/${total}] ${fileName} `);
          try {
            const { quiet, clippedFrom } = await captureView(session, context, {
              url, viewport, file: path.join(outDir, fileName), settleMs, maxHeight,
            });
            console.log([
              'ok',
              clippedFrom ? `clipped from ${clippedFrom}px` : '',
              quiet ? '' : 'network still busy',
            ].filter(Boolean).join(' — '));
            shots.push({ fileName, tab, theme, viewport: viewport.name });
          } catch (err) {
            failures++;
            console.log(`FAILED — ${err.message}`);
          }
        }
      }
    }

    let commit = 'unknown commit';
    try {
      commit = require('child_process')
        .execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    } catch { /* not a checkout */ }

    writeContactSheet(outDir, shots, {
      name, themes, viewports, commit,
      capturedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
    });

    console.log(`\n${shots.length}/${total} views captured${failures ? `, ${failures} failed` : ''}`);
    console.log(`Contact sheet: ${path.join(outDir, 'index.html')}`);
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try { cleanup(); } catch { /* best effort */ }
    }
  }
  process.exitCode = failures ? 1 : 0;
}

main().then(
  () => process.exit(process.exitCode || 0),
  err => { console.error(`\ncapture-screens: ${err.message}`); process.exit(1); },
);
