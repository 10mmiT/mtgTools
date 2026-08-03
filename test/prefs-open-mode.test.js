'use strict';
/**
 * MTG Tools — Open mode (no ADMIN_PASSWORD)
 * Run: npm test
 *
 * Its own file because open mode is decided once, when middleware/auth reads
 * the environment at require time, and the rest of the suite runs with an
 * admin password set. node:test runs each file in its own process, which is
 * what makes two answers to "is this app protected?" testable in one run.
 */
const { test, describe, after } = require('node:test');
const assert    = require('node:assert/strict');
const supertest = require('supertest');
const path      = require('path');
const fs        = require('fs');

const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mtgtest-open-'));
process.env.DATA_FILE = path.join(tmpDir, 'state.json');
delete process.env.ADMIN_PASSWORD;   // ← the whole point: no accounts exist
delete process.env.APP_PASSWORD;
process.env.PORT = '0';
process.env.MTGTOOLS_NO_BACKGROUND = '1';

const dbModule = require('../available-db');
const { app, server: getServer } = require('../server');
const request  = supertest(app);

describe('Open mode: /api/prefs', () => {
  test('reading preferences returns the defaults and needs no session', async () => {
    const res = await request.get('/api/prefs');
    assert.equal(res.status, 200);
    assert.equal(res.body.theme, 'dark');
    assert.equal(res.body.playmatKind, 'none');
  });

  test('the server says it is not the record, so the browser can be', async () => {
    const res = await request.get('/api/prefs');
    assert.equal(res.body.stored, false,
      'without accounts there is nobody to store a preference for — the client falls back to localStorage');
  });

  test('setting a preference succeeds rather than erroring', async () => {
    const res = await request.put('/api/prefs').send({ theme: 'sepia' });
    assert.equal(res.status, 200);
    assert.equal(res.body.theme, 'sepia');
    assert.equal(res.body.stored, false);
  });

  test('nothing is written to the database', async () => {
    await request.put('/api/prefs').send({ theme: 'light' });
    const n = dbModule.db.prepare('SELECT COUNT(*) AS n FROM user_prefs').get().n;
    assert.equal(n, 0, 'a prefs row would have no user to belong to');
    // And the next read is the defaults again, not the value just sent: the
    // browser is what remembers it, and the client knows that from `stored`.
    assert.equal((await request.get('/api/prefs')).body.theme, 'dark');
  });

  test('an invalid value is still rejected', async () => {
    assert.equal((await request.put('/api/prefs').send({ theme: 'neon' })).status, 400);
    assert.equal((await request.put('/api/prefs').send({ playmatKind: 'billboard' })).status, 400);
  });
});

describe('Open mode: playmat uploads', () => {
  const playmats = require('../playmat-store');
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  test('uploading refuses with a specific reason, not a generic failure', async () => {
    const res = await request.post('/api/prefs/playmat')
      .set('Content-Type', 'image/png')
      .send(PNG);
    assert.equal(res.status, 403);
    // The error is what the popover prints in place of the control, so it has
    // to say why there is nowhere to put the file rather than that there was
    // an error — there is no account to attach one to, and no password to set
    // that will not also create one.
    assert.match(res.body.error, /account/i);
    assert.match(res.body.error, /administrator password/i);
  });

  test('nothing is written for a user who does not exist', async () => {
    await request.post('/api/prefs/playmat').set('Content-Type', 'image/png').send(PNG);
    assert.equal(fs.existsSync(playmats.dir), false,
      'the refusal comes before the body is read, let alone stored');
  });

  test('there is no uploaded playmat to serve either', async () => {
    assert.equal((await request.get('/playmat/guest')).status, 404);
  });
});

// ── Cleanup ────────────────────────────────────────────────────────────────────
after((_, done) => {
  const srv = getServer();
  function finish() {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    done();
    setImmediate(() => process.exit(0));
  }
  if (srv && srv.listening) srv.close(finish); else finish();
});
