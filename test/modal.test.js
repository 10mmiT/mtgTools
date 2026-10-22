/* A dialog is a dialog to a keyboard, too.
 *
 * js/modal.js is what every centred dialog opens and closes through. These
 * hold it to the four things that make the difference between a box drawn
 * over the page and a dialog: the focus goes in, Tab stays in, Escape closes
 * it, and the focus comes back to what opened it.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'modal.js'), 'utf8');

function load() {
  const listeners = [];
  const doc = {
    activeElement: null,
    addEventListener: (type, fn) => { if (type === 'keydown') listeners.push(fn); },
    getElementById: id => all.find(el => el.id === id) || null,
  };
  const all = [];
  const el = (id, parent = null) => {
    const node = {
      id, parent, children: [], style: {}, attrs: {}, isConnected: true,
      getClientRects: () => (node.hidden() ? [] : [{}]),
      hidden: () => node.style.display === 'none' || !!parent?.hidden(),
      focus() { doc.activeElement = node; },
      contains: other => { for (let n = other; n; n = n.parent) if (n === node) return true; return false; },
      querySelectorAll: () => {
        const out = [];
        const walk = n => n.children.forEach(c => { if (c.focusable) out.push(c); walk(c); });
        walk(node);
        return out;
      },
      querySelector: () => null,
      hasAttribute: k => k in node.attrs,
      setAttribute: (k, v) => { node.attrs[k] = v; },
    };
    if (parent) parent.children.push(node);
    all.push(node);
    return node;
  };
  const control = (id, parent) => Object.assign(el(id, parent), { focusable: true });

  const sandbox = { document: doc };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);

  const press = (key, shiftKey = false) => {
    const e = { key, shiftKey, prevented: false, stopped: false,
                preventDefault() { e.prevented = true; },
                stopImmediatePropagation() { e.stopped = true; } };
    listeners.forEach(fn => fn(e));
    return e;
  };
  return { sandbox, doc, el, control, press };
}

function page() {
  const app = load();
  const opener = app.control('opener');
  const overlay = Object.assign(app.el('dialog'), { style: { display: 'none' } });
  const a = app.control('a', overlay);
  const b = app.control('b', overlay);
  const c = app.control('c', overlay);
  opener.focus();
  return { ...app, opener, overlay, a, b, c };
}

test('opening shows it and puts the focus on its first control', () => {
  const p = page();
  p.sandbox.openModal('dialog');
  assert.equal(p.overlay.style.display, 'flex');
  assert.equal(p.doc.activeElement, p.a);
});

test('or on the control it was told to start on', () => {
  const p = page();
  p.sandbox.openModal(p.overlay, { focus: 'b' });
  assert.equal(p.doc.activeElement, p.b);
});

test('closing hides it and gives the focus back to what opened it', () => {
  const p = page();
  p.sandbox.openModal('dialog');
  assert.equal(p.sandbox.closeModal('dialog'), p.opener);
  assert.equal(p.overlay.style.display, 'none');
  assert.equal(p.doc.activeElement, p.opener);
});

test('Escape closes the dialog through its own Cancel, and nothing behind it hears', () => {
  const p = page();
  let cancelled = 0;
  p.sandbox.openModal('dialog', { onClose: () => { cancelled++; p.sandbox.closeModal('dialog'); } });
  const e = p.press('Escape');
  assert.equal(cancelled, 1);
  assert.ok(e.stopped, 'the drawer behind would close on the same press');
  assert.equal(p.doc.activeElement, p.opener);
});

test('Escape with no dialog open is left to the page', () => {
  const p = page();
  const e = p.press('Escape');
  assert.ok(!e.stopped && !e.prevented);
});

test('Tab off the last control comes round to the first, and Shift+Tab the other way', () => {
  const p = page();
  p.sandbox.openModal('dialog');
  p.c.focus();
  assert.ok(p.press('Tab').prevented);
  assert.equal(p.doc.activeElement, p.a);
  assert.ok(p.press('Tab', true).prevented);
  assert.equal(p.doc.activeElement, p.c);
});

test('and Tab in the middle is the browser\'s', () => {
  const p = page();
  p.sandbox.openModal('dialog');
  assert.ok(!p.press('Tab').prevented);
});

test('a focus that got out is brought back in by the next Tab', () => {
  const p = page();
  p.sandbox.openModal('dialog');
  p.opener.focus();
  p.press('Tab');
  assert.equal(p.doc.activeElement, p.a);
});

test('one dialog can hand the way back on to the next', () => {
  const p = page();
  const second = Object.assign(p.el('second'), { style: { display: 'none' } });
  p.control('s1', second);
  p.sandbox.openModal('dialog');
  p.b.focus();
  const back = p.sandbox.closeModal('dialog');
  p.sandbox.openModal('second', { returnFocus: back });
  p.sandbox.closeModal('second');
  assert.equal(p.doc.activeElement, p.opener);
});
