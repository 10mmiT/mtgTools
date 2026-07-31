# 11 — Self-hosted typeface and tabular figures

**What to build:** The app stops looking like the operating system default and starts looking the same for everyone in the playgroup, regardless of platform.

A single variable typeface is self-hosted — no third-party font service, because this is self-hosted software that must work offline. The current system font stack is retained as a fallback so a failed load degrades to today's appearance rather than to a serif default.

The practical win is **tabular figures**: price, quantity, mana value and collector-number columns finally align on the digit instead of sitting subtly ragged.

The legacy monospace face used for mana text is replaced by the platform monospace stack; where mana symbols can render as glyphs, glyphs are preferred.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] The typeface is served from the application, with no third-party request
- [ ] The system stack remains as a fallback and produces a usable page if the font fails to load
- [ ] Price, quantity, mana value and collector-number columns align vertically
- [ ] Italic is available for card flavour text
