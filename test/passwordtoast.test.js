/* The toast after a password change says what happened.
 *
 * Changing a password borrowed the want list's toast, and that toast only
 * knows one sentence: "Added "<card>" to your wants". So a changed password
 * was announced as `Added "Password changed successfully" to your wants`.
 *
 * js/auth.js in a vm sandbox, the change-password form filled in and the
 * server answering yes; what the toast reads is the assertion.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function loadAuth() {
  const els = {};
  const el  = id => (els[id] ||= {
    id, value: '', textContent: '', style: {}, disabled: false, className: '',
    setAttribute() {},
    classList: { add() {}, remove() {}, toggle() {} },
  });
  const sandbox = {
    console,
    document: {
      getElementById: id => els[id] || (id.startsWith('cp') ? el(id) : null),
      createElement: () => ({ style: {}, setAttribute() {}, classList: { add() {}, remove() {} } }),
      body: { appendChild(node) { els[node.id] = node; } },
    },
    window: { location: {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    setTimeout: () => 1, clearTimeout() {},
    closeModal() {}, openModal() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/auth.js'), sandbox, { filename: 'auth.js' });
  return { run: expr => vm.runInContext(expr, sandbox), el, els };
}

test('a changed password is announced as one, not as a card added to your wants', async () => {
  const tab = loadAuth();
  tab.el('cpCurrentPw').value = 'old-secret';
  tab.el('cpNewPw').value     = 'new-secret';
  tab.el('cpConfirmPw').value = 'new-secret';

  await tab.run('submitChangePassword()');

  const toast = tab.els.wantToast;
  assert.ok(toast, 'no toast was shown');
  assert.doesNotMatch(toast.textContent, /wants|Added/, `the toast reads "${toast.textContent}"`);
  assert.match(toast.textContent, /Password changed/);
  assert.strictEqual(toast.className, 'want-toast', 'the toast is not the same component');
});

test('the want toast still says what it said', () => {
  const tab = loadAuth();
  tab.run(`_showWantToast('Sol Ring')`);
  assert.match(tab.els.wantToast.textContent, /Added "Sol Ring" to your wants/);
});
