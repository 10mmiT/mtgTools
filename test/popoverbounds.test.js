/* Where a popover can be seen.
 *
 * The Sort, Columns and deck-category popovers are `position: absolute` and
 * used to be kept inside the window. Table mode lends a tab's pane to a
 * floating panel that clips its overflow, and a popover kept inside the window
 * was drawn half outside the panel, its first words cut off. What is asserted
 * here is the seam that fixed it: the span a popover can be seen in is the
 * window narrowed to every ancestor that clips sideways — from its containing
 * block up, padding box only — and with no such ancestor it is the window,
 * so a page that never clipped places its popovers exactly as before.
 *
 * The shipped public/js/sortui.js is run against stub browser globals, the way
 * test/cardsort.test.js runs it. The DOM is a hand-built chain of boxes, each
 * answering only what popoverBounds and keepPopoverInView ask of an element.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');

/** A box in viewport pixels. `overflowX` is its computed overflow; `border`
 *  and `scrollbar` are the widths `clientLeft`/`clientWidth` leave out. */
function box({ left, width, overflowX = 'visible', border = 0, scrollbar = 0, parent = null }) {
  return {
    parentElement: parent,
    overflowX,
    clientLeft: border,
    clientWidth: width - 2 * border - scrollbar,
    getBoundingClientRect: () => ({ left, right: left + width, width }),
  };
}

function load(innerWidth) {
  const root = box({ left: 0, width: innerWidth });
  const body = box({ left: 0, width: innerWidth, overflowX: 'hidden', parent: root });
  const sandbox = {
    localStorage: { getItem: () => null, setItem() {} },
    document: { addEventListener() {}, documentElement: root, body },
    window: { innerWidth },
    getComputedStyle: el => ({ overflowX: el.overflowX }),
    scryfallMetaCache: new Map(),
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js/sortui.js'), 'utf8'), sandbox);
  const plain = v => JSON.parse(JSON.stringify(v));
  return {
    root, body,
    bounds: el => plain(sandbox.popoverBounds(el)),
    clamp:  (...a) => sandbox.clampPopoverLeft(...a),
    keep:   (...a) => sandbox.keepPopoverInView(...a),
  };
}

/** A popover hung from `wrap` (its containing block), `width` wide, drawn by
 *  the stylesheet at `cssLeft` until an inline `left` says otherwise. */
function popover(wrap, cssLeft, width) {
  const el = {
    offsetParent: wrap,
    parentElement: wrap,
    style: { left: '', right: '' },
    getBoundingClientRect() {
      const wr = wrap.getBoundingClientRect();
      const left = el.style.left ? wr.left + wrap.clientLeft + parseFloat(el.style.left) : cssLeft;
      return { left, right: left + width, width };
    },
  };
  return el;
}

test('a page with nothing clipping sideways shows a popover across the whole window', () => {
  const dom  = load(1440);
  const main = box({ left: 0, width: 1440, parent: dom.body });
  const wrap = box({ left: 800, width: 120, parent: main });
  assert.deepStrictEqual(dom.bounds(popover(wrap, 700, 170)), { left: 0, right: 1440 });
});

test("the body's and the root's own overflow are the viewport's, and do not narrow it", () => {
  const dom  = load(1280);
  dom.body.getBoundingClientRect = () => ({ left: 10, right: 1000, width: 990 });
  const wrap = box({ left: 300, width: 100, parent: dom.body });
  assert.deepStrictEqual(dom.bounds(popover(wrap, 230, 170)), { left: 0, right: 1280 });
});

test('a clipping ancestor narrows it to its padding box, without its border or scrollbar', () => {
  const dom   = load(1440);
  const panel = box({ left: 370, width: 700, overflowX: 'hidden', border: 2, parent: dom.body });
  const body  = box({ left: 372, width: 696, overflowX: 'auto', scrollbar: 12, parent: panel });
  const wrap  = box({ left: 400, width: 120, parent: body });
  assert.deepStrictEqual(dom.bounds(popover(wrap, 350, 170)), { left: 372, right: 1056 });
});

test('a non-positioned ancestor below the containing block does not clip, and is not asked', () => {
  const dom  = load(1440);
  const wrap = box({ left: 400, width: 120, parent: dom.body });
  const el   = popover(wrap, 350, 170);
  el.parentElement = box({ left: 450, width: 20, overflowX: 'hidden', parent: wrap });
  assert.deepStrictEqual(dom.bounds(el), { left: 0, right: 1440 });
});

test('a popover with no containing block — fixed, or not displayed — has the window', () => {
  const dom = load(900);
  assert.deepStrictEqual(dom.bounds({ offsetParent: null }), { left: 0, right: 900 });
});

test('a popover is kept inside its bounds, and one wider than them starts at their left edge', () => {
  const { clamp } = load(1440);
  const b = { left: 372, right: 1056 };
  assert.strictEqual(clamp(500, 170, b, 4), 500, 'room enough: where it wants to be');
  assert.strictEqual(clamp(287, 173, b, 4), 376, 'past the left edge: pulled in');
  assert.strictEqual(clamp(1000, 170, b, 4), 1056 - 4 - 170, 'past the right edge: pulled in');
  assert.strictEqual(clamp(300, 900, b, 4), 376, 'wider than the room: its first words show');
});

test("against the window it is the sort control's old clamp, to the pixel", () => {
  const { clamp } = load(375);
  const EDGE = 4, W = 375;
  const old = (want, w) => Math.min(Math.max(EDGE, W - EDGE - w), Math.max(EDGE, want));
  for (const [want, w] of [[34.7, 288], [-60, 288], [200, 288], [100, 400], [0, 170], [371, 170]]) {
    assert.strictEqual(clamp(want, w, { left: 0, right: W }, EDGE), old(want, w), `want ${want}, w ${w}`);
  }
});

test('a stylesheet-placed popover that fits is left where it is, with no inline style', () => {
  const dom  = load(1440);
  const wrap = box({ left: 800, width: 120, parent: dom.body });
  const el   = popover(wrap, 750, 170);
  dom.keep(el);
  assert.deepStrictEqual({ ...el.style }, { left: '', right: '' });
});

test('one that does not fit is moved just inside what shows it', () => {
  const dom   = load(1280);
  const panel = box({ left: 338, width: 592, overflowX: 'hidden', parent: dom.body });
  const wrap  = box({ left: 360, width: 100, border: 1, parent: panel });
  const el    = popover(wrap, 287, 173);
  dom.keep(el);
  assert.strictEqual(el.getBoundingClientRect().left, 338 + 4);
  assert.strictEqual(el.style.right, 'auto');
});
