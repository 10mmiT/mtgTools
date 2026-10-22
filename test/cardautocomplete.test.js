/* A card field is a combobox to a keyboard.
 *
 * mountCardAutocomplete() in js/sortui.js is every "type a card name" field
 * in the app — the Want List, the playmat picker and the Deck Builder's three.
 * These hold it to what a keyboard needs from one: the arrows walk the list,
 * Enter takes what was walked to or else is the field's own, Escape closes the
 * list without reaching the dialog behind it, and an answer that comes back
 * for an older query is dropped.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'sortui.js'), 'utf8');

function fakeEl(id) {
  const listeners = {};
  const attrs = {};
  const classes = new Set();
  const el = {
    id, value: '', textContent: '', style: {}, children: [],
    set innerHTML(_v) { el.children = []; },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: k => (k in attrs ? attrs[k] : null),
    removeAttribute: k => { delete attrs[k]; },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    appendChild: child => { el.children.push(child); },
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: c => classes.has(c) },
    fire: (type, e = {}) => (listeners[type] || []).forEach(fn => fn(e)),
  };
  return el;
}

function mount(opts = {}) {
  const input = fakeEl('cardInput');
  const drop  = fakeEl('cardDrop');
  const answers = [];
  const timers = [];
  const picks = [], enters = [];
  const sandbox = {
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      getElementById: id => ({ cardInput: input, cardDrop: drop }[id] || null),
      createElement: () => fakeEl(''),
      addEventListener() {},
      querySelectorAll: () => [],
    },
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    cardAutocomplete: q => new Promise(resolve => answers.push({ q, resolve })),
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  sandbox.mountCardAutocomplete('cardInput', 'cardDrop', name => picks.push(name),
    { onEnter: () => enters.push(input.value), ...opts });

  const type = async (value, names) => {
    input.value = value;
    input.fire('input');
    const done = timers.pop()();   // the debounce, run now
    answers.pop().resolve(names);  // the server, answering
    await done;
    await new Promise(setImmediate);
  };
  const key = k => {
    const e = { key: k, prevented: false, stopped: false,
                preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; } };
    input.fire('keydown', e);
    return e;
  };
  return { input, drop, type, key, picks, enters, timers, answers };
}

test('the field and its list say what they are', () => {
  const f = mount();
  assert.equal(f.input.getAttribute('role'), 'combobox');
  assert.equal(f.input.getAttribute('aria-controls'), 'cardDrop');
  assert.equal(f.drop.getAttribute('role'), 'listbox');
  assert.equal(f.input.getAttribute('aria-expanded'), 'false');
});

test('suggestions are options, and the field says the list is open', async () => {
  const f = mount();
  await f.type('sol', ['Sol Ring', 'Solemn Simulacrum']);
  assert.equal(f.drop.style.display, 'block');
  assert.equal(f.input.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(f.drop.children.map(c => c.getAttribute('role')), ['option', 'option']);
});

test('the arrows walk the list, and Enter takes the one walked to', async () => {
  const f = mount();
  await f.type('sol', ['Sol Ring', 'Solemn Simulacrum']);
  assert.ok(f.key('ArrowDown').prevented);
  f.key('ArrowDown');
  assert.equal(f.input.getAttribute('aria-activedescendant'), 'cardDrop-1');
  assert.equal(f.drop.children[1].getAttribute('aria-selected'), 'true');
  const e = f.key('Enter');
  assert.ok(e.prevented);
  assert.deepEqual(f.picks, ['Solemn Simulacrum']);
  assert.deepEqual(f.enters, [], 'the pick was also taken as the field\'s own Enter');
  assert.equal(f.drop.style.display, 'none');
});

test('walking past the end comes round to the start', async () => {
  const f = mount();
  await f.type('sol', ['Sol Ring', 'Solemn Simulacrum']);
  f.key('ArrowUp');
  assert.equal(f.input.getAttribute('aria-activedescendant'), 'cardDrop-1');
  f.key('ArrowDown');
  assert.equal(f.input.getAttribute('aria-activedescendant'), 'cardDrop-0');
});

test('Enter with nothing walked to is the field\'s own', async () => {
  const f = mount();
  await f.type('sol', ['Sol Ring']);
  f.key('Enter');
  assert.deepEqual(f.picks, []);
  assert.deepEqual(f.enters, ['sol']);
  assert.equal(f.drop.style.display, 'none');
});

test('Escape closes the list and goes no further', async () => {
  const f = mount();
  await f.type('sol', ['Sol Ring']);
  const e = f.key('Escape');
  assert.ok(e.stopped, 'the dialog the field is in would close on the same press');
  assert.equal(f.drop.style.display, 'none');
  assert.equal(f.input.getAttribute('aria-expanded'), 'false');
});

test('and with the list already closed, Escape is the dialog\'s', () => {
  const f = mount();
  assert.ok(!f.key('Escape').stopped);
});

test('an answer for what the box no longer says is dropped', async () => {
  const f = mount();
  f.input.value = 'so';
  f.input.fire('input');
  const done = f.timers.pop()();
  f.input.value = 'sol r';
  f.answers.pop().resolve(['Soldevi Adnate']);
  await done;
  assert.notEqual(f.drop.style.display, 'block');
});
