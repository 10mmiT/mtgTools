# 09 — Repaint the five themes

**What to build:** All five themes get new palettes. They keep their slots but differ by **temperature rather than hue**: a cool dark, a warm dark, a cool light, a warm light, and high contrast. Surfaces go near-neutral so that card artwork and the per-tab Magic colour are the only saturated things on screen.

The primary action colour becomes near-neutral too — a near-white fill on dark themes, near-black on light — so it stops competing with the Magic colour accent.

The warm-dark theme is **renamed**, because the repainted theme is warm-neutral rather than green and the old name would misdescribe it. A stored preference for the old name must map to the new one on read, or existing users of that theme silently fall back to the default.

The high-contrast theme targets AAA contrast for body text and AA for all interface text. Where contrast and aesthetics conflict there, contrast wins.

**Blocked by:** 04 — repainting only works once colour is fully tokenised.

**Status:** ready-for-agent

- [ ] All five themes render coherently across all eleven tabs
- [ ] The high-contrast theme meets AAA for body text and AA for interface text, verified by measurement not by eye
- [ ] A stored preference for the old theme name resolves to the renamed theme
- [ ] The full screenshot set is reviewed for any pane that is illegible on any theme
