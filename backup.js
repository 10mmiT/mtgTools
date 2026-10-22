'use strict';
/* A copy of available.db a day, the last week of them kept.
 *
 * available.db is everything the group has typed in — players, decks, every
 * card in every deck, the shelves, the accounts — and it has been one file
 * with no second copy anywhere. A bad write, a bad migration or a bad disk
 * was the end of it. scryfall.db is not backed up: it is a cache of a file
 * Scryfall publishes, and the next refresh rebuilds it.
 *
 * db.backup() is SQLite's online backup, so the copy is consistent while the
 * app keeps serving. It is written under a temporary name and renamed into
 * place, so a process that dies mid-copy leaves no half a database posing as
 * today's backup.
 */
const fs   = require('fs');
const path = require('path');
const { db } = require('./available-db');

const DAY_MS = 24 * 60 * 60 * 1000;
const NAME   = /^available-(\d{4}-\d{2}-\d{2})\.db$/;

const keepDays = () => {
  const n = parseInt(process.env.MTGTOOLS_BACKUP_DAYS ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 7;
};

const backupDir = () =>
  path.join(path.dirname(process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json')), 'backups');

/** Today's backup, unless there already is one; then the old ones pruned.
 *  Returns the file written, or null when there was nothing to do. */
async function backupNow(now = new Date()) {
  const keep = keepDays();
  if (keep === 0) return null;
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `available-${now.toISOString().slice(0, 10)}.db`);
  let wrote = null;
  if (!fs.existsSync(file)) {
    const tmp = `${file}.partial`;
    try {
      await db.backup(tmp);
      fs.renameSync(tmp, file);
      wrote = file;
      console.log(`[backup] ${path.basename(file)}`);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      throw e;
    }
  }
  prune(dir, keep);
  return wrote;
}

/** Every dated backup past the newest `keep`. The names sort by date. */
function prune(dir, keep) {
  const dated = fs.readdirSync(dir).filter(f => NAME.test(f)).sort().reverse();
  for (const f of dated.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
}

function init() {
  const run = () => backupNow().catch(e => console.warn(`[backup] failed: ${e.message}`));
  run();
  // Hourly rather than daily: the check is one stat, and a daily timer
  // started at 23:59 would be a backup dated tomorrow that skipped today.
  setInterval(run, DAY_MS / 24).unref();
}

module.exports = { init, backupNow, backupDir };
