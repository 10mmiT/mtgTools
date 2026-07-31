# 25 — Self-host the CDN dependencies

**What to build:** The app works with no internet connection.

This is self-hosted software, but it currently loads two third-party libraries at runtime — a Magic symbol font and a PDF generation library — from external content delivery networks. Without a connection, mana symbols fail to render and printable export breaks. Each external request also discloses the user's address to a third party.

Both are served from the application instead.

**Blocked by:** None — can start immediately, independent of everything else.

**Status:** ready-for-agent

- [ ] No external network request is made at runtime
- [ ] Mana symbols render correctly with the network disabled
- [ ] Printable export still works with the network disabled
- [ ] Both libraries keep their licence and attribution intact
