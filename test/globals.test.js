/* One global scope, one name per idea.
 *
 * Every file in public/js is served as a plain script into one shared global
 * scope — no modules, no imports, by design: the tab's files call each other
 * by name and the tests load them into a vm sandbox the same way. The price of
 * that is that two files declaring the same top-level name are not two
 * functions, they are one, and the later `<script>` wins silently.
 *
 * That is not hypothetical. js/owned.js grew an `ownedQty(cardName)` — the
 * shelf in scope — beside js/sortui.js's older `ownedQty(cols, name)` — every
 * loaded collection. owned.js is served second, so every sort by Quantity was
 * calling it with a collection array where it wanted a card name, scoring
 * every row nought, and the ×N beside the sort printed ×0. Nothing threw and
 * no test failed: the tables simply stopped ordering.
 *
 * So the rule is asserted rather than remembered. This is the static seam, the
 * same one the token linter uses: read the files the browser is actually
 * served and hold them to a property of the delivered app.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const JS = path.join(__dirname, '..', 'public', 'js');

/* Top-level declarations only — a name indented by anything is inside a
   function or a block and belongs to whoever owns that scope. */
const DECLARED = /^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/;

test('no two shipped modules declare the same top-level name', () => {
  const where = new Map();
  for (const file of fs.readdirSync(JS).filter(f => f.endsWith('.js')).sort()) {
    for (const line of fs.readFileSync(path.join(JS, file), 'utf8').split('\n')) {
      const name = line.match(DECLARED)?.[1];
      if (!name) continue;
      if (!where.has(name)) where.set(name, new Set());
      where.get(name).add(file);
    }
  }
  const clashes = [...where].filter(([, files]) => files.size > 1)
    .map(([name, files]) => `${name} — ${[...files].join(' and ')}`);
  assert.deepStrictEqual(clashes, [],
    `two files declare one name, so the second one served is the only one there is:\n  ${clashes.join('\n  ')}`);
});
