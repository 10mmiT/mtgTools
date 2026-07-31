# 23 — Playmat image upload

**What to build:** Bring your own image, not just card art.

This is the only part of the work with a genuine security surface, so validation is the substance of the ticket. Uploads are capped in size, restricted to raster photo formats, and **vector images are rejected outright** — they can carry script and would become a stored cross-site-scripting vector on a same-origin route. File type is determined by **inspecting the file's own bytes**, never by the client-supplied type or the filename extension.

One playmat per person: a new upload replaces and deletes the previous file, so storage cannot grow unbounded. Files live in the existing persistent data directory, which is already excluded from version control. Deleting a user removes their file.

Upload is unavailable when the app runs without an administrator password, since there is no account to attach a file to — shown with a visible explanation rather than a hidden control.

**Blocked by:** 22

**Status:** ready-for-agent

- [ ] A valid image uploads, is stored, and is served back as the playmat
- [ ] An oversized file is rejected before anything is written to disk
- [ ] A vector image is rejected
- [ ] A file whose bytes disagree with its declared type or extension is rejected
- [ ] A second upload replaces the first and the superseded file no longer exists
- [ ] Deleting the playmat removes both the preference and the file
- [ ] Deleting a user removes their file
- [ ] The serving route requires authentication
- [ ] The upload route is rate-limited
- [ ] In open mode the upload route refuses with a clear, specific error
