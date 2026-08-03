# 23 — Playmat image upload

**What to build:** Bring your own image, not just card art.

This is the only part of the work with a genuine security surface, so validation is the substance of the ticket. Uploads are capped in size, restricted to raster photo formats, and **vector images are rejected outright** — they can carry script and would become a stored cross-site-scripting vector on a same-origin route. File type is determined by **inspecting the file's own bytes**, never by the client-supplied type or the filename extension.

One playmat per person: a new upload replaces and deletes the previous file, so storage cannot grow unbounded. Files live in the existing persistent data directory, which is already excluded from version control. Deleting a user removes their file.

Upload is unavailable when the app runs without an administrator password, since there is no account to attach a file to — shown with a visible explanation rather than a hidden control.

**Blocked by:** 22

**Status:** done

- [x] A valid image uploads, is stored, and is served back as the playmat
- [x] An oversized file is rejected before anything is written to disk
- [x] A vector image is rejected
- [x] A file whose bytes disagree with its declared type or extension is rejected
- [x] A second upload replaces the first and the superseded file no longer exists
- [x] Deleting the playmat removes both the preference and the file
- [x] Deleting a user removes their file
- [x] The serving route requires authentication
- [x] The upload route is rate-limited
- [x] In open mode the upload route refuses with a clear, specific error

**How it landed**

- **The upload body is the image, not a multipart form.** §10.3 specified `multipart/form-data`,
  which is what an HTML form sends; nothing in this app is an HTML form. Multipart would have
  added a parser, and the parser *is* the surface — the boundary, the part headers and the
  filename are three attacker-chosen inputs the route would then have to be careful with, and
  as raw bytes it cannot receive any of them. The declared `Content-Type` is still accepted and
  still ignored (`type: () => true` means it does not select a parser), which is what lets the
  tests show indifference in both directions: an SVG calling itself `image/png` is refused, and
  a real PNG calling itself `image/svg+xml` is stored and served as a PNG.
- The three accepted formats are an **allowlist of byte signatures** in
  [playmat-store.js](playmat-store.js), so rejecting a vector image needs no rule about vector
  images: an SVG matches nothing. A blocklist would have to know every markup format a browser
  will run script from.
- **Rejected before anything is written** is structural rather than checked: `express.raw` caps
  the body at 5 MB — against `Content-Length` before a byte arrives, and again as it streams —
  and `save()` is not reached until `sniff()` has returned a format. The 413 and the 415 both
  come back as JSON with a sentence in them, because the popover prints the server's `error`
  string verbatim.
- **One playmat per person is enforced in three places, not one.** `save()` unlinks every
  extension rather than the one the row names, so the guarantee does not depend on the database
  agreeing with the filesystem; `PUT /api/prefs` deletes the file when the kind moves away from
  `upload`, so choosing a card after an upload does not orphan it; `DELETE /api/prefs/playmat`
  clears the row and the file together. That last one is why `removePlaymat()` in the client
  moved off `PUT` — a mat can be a file, and the preference is only half of it.
- `playmat_kind = 'upload'` is now a value the server writes and `PUT` **refuses**. It means
  "there is a file on disk for this user", and only the upload route can make that true.
- `GET /playmat/:username` sits **ahead of the global auth guard** and guards itself, so a
  request without a session gets `401` instead of a redirect to `/login`: the route is fetched
  by a CSS `url()`, and a login page arriving with a `200` where an image was expected is a
  broken background, not a sign-in prompt. The name in the path keeps two users' mats apart in a
  shared browser's cache; the file served is derived from the **session**, so there is no name a
  request can put there to reach a file that is not its own. `playmat_url` carries `?v=<upload
  time>`, which is what lets the response be cached hard and a replacement still be seen.
- A username is a primary key and has never been constrained to characters that are safe in a
  path, so it is percent-encoded into the filename — reversible, collision-free, and free of
  `/` — and `pathFor()` then re-checks the result lands directly in the playmat directory.
- `authLimiter` moved to [middleware/limits.js](middleware/limits.js) so the upload route could
  have one beside it. Two budgets and not one: a burst of uploads must not lock anyone out of
  signing in.
- **The popover grew a status line.** Progress and refusals used to be written onto the line
  that names the current mat, which meant a rejected upload took that mat's **Remove** button
  down with it — the wrong control to lose at exactly that moment. The card search's messages
  moved onto the new line too, so there is one message slot rather than two conventions.
- Tests: twelve endpoint tests in [test/server.test.js](test/server.test.js) covering every box
  above, plus three in [test/prefs-open-mode.test.js](test/prefs-open-mode.test.js) for the
  refusal, and two added to [test/playmat.test.js](test/playmat.test.js) — that a versioned
  upload URL is accepted by the CSS-boundary guard and that `/playmat/` on somebody else's
  origin is not.

**Verified in a browser**, driving the real app in headless Firefox against a server with a
password set: an image made in a canvas and uploaded through the app's own control paints as the
playmat, is served back at 1200×800, and survives a reload. An SVG lying about its type is
refused with the server's sentence, and the mat already set stays on screen with its Remove
button. A 6 MB file is refused before it is sent. Remove clears the page and leaves the playmat
directory empty. In open mode the sentence stands where the upload control was, and the endpoint
returns 403 with the reason. No console errors in any of it.
