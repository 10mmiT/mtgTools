'use strict';
/**
 * Uploaded playmat images: where they live, what counts as one, and the two
 * operations the rest of the app needs (replace, remove).
 *
 * Everything here exists because an upload route is the one place in this
 * application where a user's bytes become a file the application later serves
 * back on its own origin. The rules are therefore in one module rather than
 * spread across the route that writes and the route that reads: a format is
 * accepted, a filename is derived, and a content type is served, all from the
 * same table below.
 */
const fs   = require('fs');
const path = require('path');

// The cap the upload route enforces. Five megabytes is generous for a
// background image and small enough that the whole thing can be held in
// memory while it is checked — which is what "rejected before anything is
// written to disk" means in practice: nothing is written until the bytes have
// been looked at.
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_MB    = MAX_BYTES / (1024 * 1024);

// Beside the database, in the same directory DATA_FILE names — already the
// established persistence location, and already excluded from version control.
const dataDir = path.dirname(process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json'));
const dir     = path.resolve(path.join(dataDir, 'playmats'));

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* The accepted formats, as an allowlist of byte signatures.
 *
 * An allowlist and not a blocklist, which is the whole reason SVG cannot get
 * in: it is not that vector images are named and refused, it is that only
 * these three raster containers are named and everything else — an SVG, an
 * HTML file, a zip with a .png on the end — matches nothing and is refused.
 * A blocklist would have to anticipate every markup format that a browser
 * will execute script from.
 *
 * `matches` reads the file's own leading bytes. The client's Content-Type and
 * the name it gave the file are never consulted, here or by the caller: both
 * are attacker-chosen strings, and the point of sniffing is that the bytes
 * are the only thing that is not.
 */
const FORMATS = [
  {
    ext: 'jpg', type: 'image/jpeg',
    matches: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: 'png', type: 'image/png',
    matches: b => b.length >= 8 && b.subarray(0, 8).equals(PNG_MAGIC),
  },
  {
    // RIFF container with a WEBP form type: bytes 0–3 are 'RIFF', 4–7 are the
    // chunk length, and 8–11 say which kind of RIFF file it is.
    ext: 'webp', type: 'image/webp',
    matches: b => b.length >= 12
      && b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

const EXTENSIONS = FORMATS.map(f => f.ext);
const ACCEPTED   = 'JPEG, PNG or WebP';

/** The format these bytes actually are, or null if they are none of them. */
function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return null;
  return FORMATS.find(f => f.matches(buf)) || null;
}

/* A username is a primary key, not a path component: nothing has ever
 * constrained it to characters that are safe in a filename, so it is
 * percent-encoded on the way into one. That is reversible and collision-free
 * — two usernames cannot encode to the same base — and it leaves no '/' and
 * no bare '..' behind. pathFor() then re-checks the result lands directly in
 * the playmat directory, because a path guard that is only as good as its
 * encoder is not a guard. */
function baseName(username) {
  const base = encodeURIComponent(String(username || '').toLowerCase());
  if (!base) throw new Error('playmat: no username to store a file for');
  return base;
}

function pathFor(username, ext) {
  const file = path.resolve(path.join(dir, `${baseName(username)}.${ext}`));
  if (path.dirname(file) !== dir)
    throw new Error('playmat: refusing a path outside the playmat directory');
  return file;
}

/** The user's current playmat file, or null. */
function find(username) {
  for (const format of FORMATS) {
    const file = pathFor(username, format.ext);
    if (fs.existsSync(file)) return { ...format, file, name: path.basename(file) };
  }
  return null;
}

/* Remove whatever the user has. Every extension, not just the one the
 * preference row names: one playmat per person is a storage guarantee, and a
 * guarantee that depends on the database agreeing with the filesystem is not
 * one. Returns how many files went, which is 0 or 1 in practice. */
function remove(username) {
  let removed = 0;
  for (const ext of EXTENSIONS) {
    try {
      fs.unlinkSync(pathFor(username, ext));
      removed++;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return removed;
}

/* Replace the user's playmat with these bytes. The previous file is deleted
 * first, so an upload can change format without leaving the old one behind —
 * that, and not a cleanup pass, is what keeps storage bounded at one file per
 * person.
 *
 * The directory is created here rather than at boot: a deployment where
 * nobody uploads anything should not grow an empty directory for it. */
function save(username, buf, format) {
  fs.mkdirSync(dir, { recursive: true });
  remove(username);
  const file = pathFor(username, format.ext);
  fs.writeFileSync(file, buf);
  // The version the URL carries. The path is stable per user, so without it a
  // second upload would be hidden behind the first one's cache entry; with it
  // the URL changes on every upload and the file can be cached hard.
  return { ...format, file, name: path.basename(file), version: Date.now() };
}

/* The URL the browser fetches it from, which is what goes in playmat_url.
 * Same-origin and under /playmat/, which is what public/js/playmat.js will
 * agree to write into a CSS url(). */
function urlFor(username, version) {
  return `/playmat/${encodeURIComponent(String(username).toLowerCase())}?v=${version}`;
}

module.exports = {
  MAX_BYTES, MAX_MB, ACCEPTED, EXTENSIONS, dir,
  sniff, find, save, remove, urlFor, pathFor,
};
