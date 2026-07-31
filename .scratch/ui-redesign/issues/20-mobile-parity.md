# 20 — Mobile parity pass

**What to build:** Everything above, designed rather than merely surviving, on a phone.

The app has substantial existing mobile behaviour — a bottom navigation bar, a week-list calendar, grid as the default view, a capped result count. None of it may regress. But several decisions taken for desktop are meaningless or wrong on a phone: full width, a collapsed sidebar, and a large background image all need explicit mobile answers rather than inherited ones.

**Blocked by:** 13, 14, 15, 16, 17, 18, 19

**Status:** ready-for-agent

- [ ] Every tab reviewed at phone width across all five themes
- [ ] All touch targets are at least 44 by 44 pixels
- [ ] Bottom navigation, the week-list calendar, the default grid view and the capped result count all behave as before
- [ ] No horizontal overflow on any tab
- [ ] Dense tables remain usable and scroll within their own container
